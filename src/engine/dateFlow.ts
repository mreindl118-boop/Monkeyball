// The date, turn by turn (docs/ARCHITECTURE.md, "Date flow"). The model calls, the clock, the
// random source and storage are injected, so a whole date runs against a scripted fake in tests.
//
//   createDate  -> a session in 'opening' (nothing applied yet)
//   openDate    -> venue and gift deltas and reactions, then the opening beat (turn 0), then chips
//   sendPlayerMessage -> player turn, judge, apply (small pure steps, TURN_STEPS), story (streamed),
//                  then chips; the last turn and the early exit end the date (finishDate)
//   retryLastReply -> the story call again after a failed one (the judge result is kept)
//   finishDate  -> memory (+ compression), +1 date, consistency trust, recap on the record
//
// Sessions are immutable: every step returns a new object and hands it to hooks.onUpdate, so a
// store can simply replace its copy. Model problems never throw past the caller: a failed judge is
// neutral, failed chips are none, a failed story call becomes a system turn and the date waits for
// a retry. After the caller aborts (hooks.signal), no further model calls are made and onUpdate is
// no longer called; storage is still brought in line with the returned session.

import { giftById, giftNoun } from '../data/gifts'
import { dragNightNote, venueById } from '../data/venues'
import { coerceJudge, coerceSuggestions, neutralJudge } from '../llm/coerce'
import type { ChatMessage } from '../llm/client'
import { explainRoleError, REFUSAL_NOTE, refusalBeat } from '../llm/index'
import {
  buildJudgePrompt,
  buildStoryPrompt,
  buildSuggestionsPrompt,
  giftReactionFor,
  makeJudgeMessages,
  makeStoryMessages,
  makeSuggestionsMessages,
  sentence,
  type RelationLine,
  type StoryContext,
  type StorySpecial,
  suggestionKeys,
  venueFeelingFor,
} from '../prompts/build'
import type {
  Character,
  DateKind,
  DateRecap,
  DateRecord,
  DateTurn,
  DiscoveredTrait,
  JudgeResult,
  PlayerProfile,
  Relationship,
  Route,
  Settings,
  Suggestions,
  TierNumber,
} from '../types'
import { applyTopics, detectTopics, knownHits, recordGift, recordVenue, revealHits } from './discovery'
import {
  addTrust,
  affectionRoom,
  applyAffection,
  applyDifficulty,
  clampAffection,
  dateRiseRoom,
  type DateTotals,
  emptyTotals,
  giftDelta,
  giftReaction,
  leftEarly,
  venueDelta,
  venueReaction,
} from './math'
import { appendMemory, applyCompression, cleanSummary, compressionRequest, memoryRequest, needsCompression } from './memory'
import { buildRecap } from './recap'
import { routeFor } from './stages'
import { applyTrust, consistencyTrust } from './trust'
import { applyUnlocks } from './unlocks'

// ---------------------------------------------------------------------------
// Contract

export type DateMessage = ChatMessage

/**
 * The model calls a date needs. `messages` is the full request, starting with the system message
 * whose content is `system` (kept separately for the debug panel). The story role serves story and
 * memory; the judge role serves judge and suggestions.
 */
export interface DateLlm {
  /**
   * Streamed story turn. `onDelta` gets each new piece of text. When the model declines, resolve
   * with `refused: true` (text may be an in-world beat such as refusalBeat(name), or empty).
   * Throw for network, HTTP and setup problems.
   */
  story(a: { system: string; messages: DateMessage[]; onDelta: (chunk: string) => void; signal?: AbortSignal }): Promise<{
    text: string
    refused: boolean
  }>
  /** Judge call. `ok: false` with the neutral fallback when the reply wasn't usable. */
  judge(a: { system: string; messages: DateMessage[]; signal?: AbortSignal }): Promise<{ value: JudgeResult; ok: boolean }>
  /** Suggestion chips for these keys, or null. */
  suggestions(a: { system: string; messages: DateMessage[]; keys: string[]; signal?: AbortSignal }): Promise<Suggestions | null>
  /** Memory summary (and compression) call: plain text. */
  memory(a: { system: string; messages: DateMessage[]; signal?: AbortSignal }): Promise<string>
}

export interface DateWorld {
  character: Character
  setId: string
  profile: PlayerProfile
  settings: Settings
  /** The relationship when the date starts. */
  rel: Relationship
  /** Display names by character id (the character, partners, people the player is seeing). */
  names: Record<string, string>
  now: () => number
  rng: () => number
  /** Optional: ids of other characters the player is seeing (the judge's {others}). Default none. */
  others?: string[]
  /** Optional: the set manifest's relationships for this character (partner and ex notes). */
  relations?: RelationLine[]
}

export type DateStatus = 'opening' | 'awaiting-player' | 'judging' | 'replying' | 'suggesting' | 'closing' | 'ended'

export interface DateSession {
  record: DateRecord
  world: DateWorld
  /** Live relationship, updated every turn. */
  rel: Relationship
  relBefore: Relationship
  status: DateStatus
  /** Text of the reply being streamed ('' otherwise). */
  streaming: string
  lastJudge?: JudgeResult
  suggestions: Suggestions | null
  /** The character is walking out: the date ends after the exit reply. */
  leaving: boolean
  /** Optional: the last story problem shown in the date; cleared by the next good reply. */
  error?: string
}

export interface DateHooks {
  /** Called on every state and stream change (not after an abort). */
  onUpdate(s: DateSession): void
  /**
   * Called after every applied step (player turn, judge applied, reply landed, date finished).
   * A Dexie `add` that sets record.id in place is kept: later records are copies of this one.
   * A rejection is swallowed (the store reports storage problems itself).
   */
  persist(rel: Relationship, record: DateRecord): Promise<void>
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Session helpers (pure)

/** The route this date is played on. */
export function routeOf(world: Pick<DateWorld, 'character' | 'profile' | 'settings'>): Route {
  return routeFor(world.character, world.profile, world.settings.orientationMode)
}

/** Player messages sent so far (the turn counter: 1..maxTurns). */
export function playerTurnCount(record: Pick<DateRecord, 'turns'>): number {
  return record.turns.filter((t) => t.role === 'player').length
}

/** Turns the models see (system notes left out). */
export function conversation(turns: readonly DateTurn[]): DateTurn[] {
  return turns.filter((t) => t.role !== 'system')
}

/** True when the last thing said was the player's (or nothing was said): a reply is missing. */
export function needsReply(s: Pick<DateSession, 'record'>): boolean {
  const conv = conversation(s.record.turns)
  return conv.length === 0 || conv[conv.length - 1].role === 'player'
}

/**
 * The player can send a message now. Not while a reply is missing (a failed or stopped story
 * call): the date waits for retryLastReply, so the opening beat and each LANDED result reach the
 * story model in order.
 */
export function canSend(s: DateSession): boolean {
  return s.status === 'awaiting-player' && !s.leaving && !needsReply(s) && playerTurnCount(s.record) < s.record.maxTurns
}

/**
 * The player could send once the chips still loading are skipped (a store aborts them first): the
 * composer's Send stays usable while the suggestions call runs.
 */
export function canQueueSend(s: DateSession): boolean {
  return canSend(s.status === 'suggesting' ? { ...s, status: 'awaiting-player' } : s)
}

/** A reply failed (or was stopped) and can be asked for again. */
export function canRetry(s: DateSession): boolean {
  return s.status === 'awaiting-player' && needsReply(s)
}

/** The date is over and its recap is on the record. */
export function isEnded(s: DateSession): boolean {
  return s.status === 'ended'
}

function totalsOf(record: DateRecord, id: string): DateTotals {
  const t = record.totals?.[id]
  return t ? { affection: t.affection ?? 0, trust: t.trust ?? 0, gained: t.gained ?? 0 } : emptyTotals()
}

/**
 * How far the meter can still rise on this date: what the route allows (friend route 59, else
 * 100), and the gain cap less the meter's net rise since the date began (world.rel).
 */
function meterRoom(world: DateWorld, affection: number, route: Route): number {
  return Math.min(affectionRoom(affection, route), dateRiseRoom(world.rel.affection, affection, world.settings.gainCap))
}

/**
 * How much of the date's gain allowance is used: the larger of the ledger's net total and the
 * meter's net rise since the date began (they differ once a loss was taken at 0). A gain is held
 * back by the date's limit once this reaches the gain cap.
 */
export function dateGainUsed(s: Pick<DateSession, 'record' | 'world' | 'rel'>): number {
  const id = s.world.character.id
  return Math.max(totalsOf(s.record, id).affection, s.rel.affection - s.world.rel.affection)
}

/** The judge result stored on the last player turn, if any. */
function lastPlayerJudge(s: DateSession): JudgeResult | undefined {
  const id = s.world.character.id
  for (let i = s.record.turns.length - 1; i >= 0; i--) {
    const t = s.record.turns[i]
    if (t.role === 'player') return t.judge?.[id]
  }
  return undefined
}

/** A new session: nothing applied yet; openDate() starts it. */
export function createDate(
  world: DateWorld,
  opts: { venueId: string; giftId?: string; maxTurns: number; kind?: DateKind },
): DateSession {
  const id = world.character.id
  const maxTurns = Number.isFinite(opts.maxTurns) ? Math.max(1, Math.round(opts.maxTurns)) : 10
  const record: DateRecord = {
    kind: opts.kind ?? 'single',
    characterIds: [id],
    venueId: opts.venueId,
    startedAt: world.now(),
    maxTurns,
    turns: [],
    totals: { [id]: emptyTotals() },
  }
  if (opts.giftId) record.giftId = opts.giftId
  return {
    record,
    world,
    rel: world.rel,
    relBefore: world.rel,
    status: 'opening',
    streaming: '',
    suggestions: null,
    leaving: false,
  }
}

/** Judge output made safe: coerced to the spec ranges (neutral when unusable), unknown hit ids dropped. */
export function sanitizeJudge(character: Character, raw: unknown): JudgeResult {
  const j = coerceJudge(raw) ?? neutralJudge()
  return { ...j, hits: knownHits(character, j.hits) }
}

// ---------------------------------------------------------------------------
// The opening (pure)

/**
 * Venue and gift deltas (they count toward the date's total and gain cap; difficulty doesn't scale
 * them), the reactions recorded on the relationship, and any tier that crossing a threshold opens.
 */
export function applyOpening(s: DateSession): DateSession {
  const { character, settings } = s.world
  const id = character.id
  const route = routeOf(s.world)
  let rel = s.rel
  const before = totalsOf(s.record, id)
  const venue = applyAffection(before, venueDelta(character, s.record.venueId), settings.gainCap, meterRoom(s.world, rel.affection, route))
  rel = { ...rel, affection: clampAffection(rel.affection + venue.applied, route, rel.affection) }
  const gift = applyAffection(
    venue.totals,
    giftDelta(character, s.record.giftId),
    settings.gainCap,
    meterRoom(s.world, rel.affection, route),
  )
  rel = { ...rel, affection: clampAffection(rel.affection + gift.applied, route, rel.affection) }
  rel = recordGift(character, recordVenue(character, rel, s.record.venueId), s.record.giftId)
  rel = applyUnlocks(character, rel, route).rel
  return {
    ...s,
    rel,
    record: {
      ...s.record,
      totals: { ...s.record.totals, [id]: gift.totals },
      opening: { ...s.record.opening, [id]: { venue: venue.applied, gift: gift.applied } },
    },
  }
}

// ---------------------------------------------------------------------------
// A turn's effects: small pure steps (Phase 4 adds disclosure, betrayal and grudge steps here)

export interface TurnState {
  world: DateWorld
  route: Route
  /** The player's message. */
  message: string
  judge: JudgeResult
  at: number
  rel: Relationship
  totals: DateTotals
  /** What counted this turn: affection toward the date's total, trust as it landed on the meter. */
  applied: { affection: number; trust: number }
  found: DiscoveredTrait[]
  tiers: TierNumber[]
  secrets: number[]
}

export type TurnStep = (t: TurnState) => TurnState

/** Trust first: the judge's trustDelta through the trust rules (difficulty), clamped 0-100. */
export const trustStep: TurnStep = (t) => {
  const r = applyTrust({ character: t.world.character, rel: t.rel, judge: t.judge })
  return { ...t, rel: r.rel, totals: addTrust(t.totals, r.applied), applied: { ...t.applied, trust: r.applied } }
}

/**
 * Affection: difficulty, then the date's gain cap (on the ledger and on the meter's rise since the
 * date began), then 0-100 and the friend-route cap.
 */
export const affectionStep: TurnStep = (t) => {
  const scaled = applyDifficulty(t.judge.delta, t.world.character.difficulty)
  const r = applyAffection(t.totals, scaled, t.world.settings.gainCap, meterRoom(t.world, t.rel.affection, t.route))
  const affection = clampAffection(t.rel.affection + r.applied, t.route, t.rel.affection)
  return {
    ...t,
    rel: affection === t.rel.affection ? t.rel : { ...t.rel, affection },
    totals: r.totals,
    applied: { ...t.applied, affection: r.applied },
  }
}

/** Traits the judge hit are revealed, with its hint as the caption. */
export const revealStep: TurnStep = (t) => {
  const r = revealHits(t.world.character, t.rel, t.judge, t.at)
  return r.found.length ? { ...t, rel: r.rel, found: [...t.found, ...r.found] } : t
}

/** Attractions and style reveal when they come up; the character learns how the player dates. */
export const topicsStep: TurnStep = (t) => {
  const rel = applyTopics(t.rel, detectTopics(t.message, 'player'))
  return rel === t.rel ? t : { ...t, rel }
}

/**
 * A rough measure of real connection (Relationship.connection, read by the Hollow ending): +1 per
 * like hit, +1 for an honest moment (trustDelta 3 or more), -1 for a turn-on win with neither.
 */
export const connectionStep: TurnStep = (t) => {
  const likes = t.judge.hits.filter((h) => h.type === 'like').length
  const honest = t.judge.trustDelta >= 3 ? 1 : 0
  const heatOnly = likes === 0 && honest === 0 && t.judge.hits.some((h) => h.type === 'turnOn') ? 1 : 0
  const change = likes + honest - heatOnly
  return change ? { ...t, rel: { ...t.rel, connection: (t.rel.connection ?? 0) + change } } : t
}

/** Tiers and secrets reached this turn (each exactly once). */
export const unlockStep: TurnStep = (t) => {
  const r = applyUnlocks(t.world.character, t.rel, t.route)
  if (r.tiers.length === 0 && r.secrets.length === 0) return t
  return { ...t, rel: r.rel, tiers: [...t.tiers, ...r.tiers], secrets: [...t.secrets, ...r.secrets] }
}

/** The judge's mood, for the profile and the hub. */
export const moodStep: TurnStep = (t) => {
  const mood = t.judge.mood?.trim()
  return mood && mood !== t.rel.lastMood ? { ...t, rel: { ...t.rel, lastMood: mood } } : t
}

/** The order the spec gives: difficulty, trust, affection with the caps, reveals, topics, unlocks. */
export const TURN_STEPS: readonly TurnStep[] = [
  trustStep,
  affectionStep,
  revealStep,
  topicsStep,
  connectionStep,
  unlockStep,
  moodStep,
]

export function runTurnSteps(t: TurnState, steps: readonly TurnStep[] = TURN_STEPS): TurnState {
  return steps.reduce((state, step) => step(state), t)
}

/**
 * Apply a judge result to the session's last player turn: the steps above, the judge and applied
 * deltas on the turn, the date's totals, and `leaving` once the total reaches -20.
 */
export function applyJudge(
  s: DateSession,
  judge: JudgeResult,
  message: string,
  steps: readonly TurnStep[] = TURN_STEPS,
): DateSession {
  const id = s.world.character.id
  const result = runTurnSteps(
    {
      world: s.world,
      route: routeOf(s.world),
      message,
      judge,
      at: s.world.now(),
      rel: s.rel,
      totals: totalsOf(s.record, id),
      applied: { affection: 0, trust: 0 },
      found: [],
      tiers: [],
      secrets: [],
    },
    steps,
  )
  const turns = s.record.turns.slice()
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role !== 'player') continue
    turns[i] = {
      ...turns[i],
      judge: { ...turns[i].judge, [id]: judge },
      applied: { ...turns[i].applied, [id]: result.applied },
    }
    break
  }
  return {
    ...s,
    rel: result.rel,
    lastJudge: judge,
    leaving: s.leaving || leftEarly(result.totals.affection),
    record: { ...s.record, turns, totals: { ...s.record.totals, [id]: result.totals } },
  }
}

// ---------------------------------------------------------------------------
// Requests (pure; exported for the debug panel and tests)

export interface ModelRequest {
  system: string
  messages: DateMessage[]
}

/** Home is the player's place, not the character's. */
export const HOME_NOTE = 'your place'

/** The venue's note in {venue}: "your place" for home, the Thursday drag night at the queer bar. */
function venueNote(venueId: string, at: number): string | null {
  if (venueId === 'home') return HOME_NOTE
  return dragNightNote(new Date(at), venueId)
}

/** The gift as it reads mid-sentence: "a poetry book", "rare vinyl" (unknown ids as they are). */
export function giftPhrase(giftId: string): string {
  const gift = giftById(giftId)
  return gift ? giftNoun(gift) : giftId
}

/** The story call for a turn: turn 0 is the opening beat; a judge result fills the LANDED section. */
export function storyRequest(
  s: DateSession,
  opts: { turn: number; judge?: JudgeResult; special?: StorySpecial },
): ModelRequest {
  const { character, settings, profile, names, relations } = s.world
  const { venueId, giftId } = s.record
  const venue = venueById(venueId)
  const note = venueNote(venueId, s.world.now())
  const ctx: StoryContext = {
    character,
    rel: s.rel,
    profile,
    heat: settings.heat,
    route: routeOf(s.world),
    venue: {
      name: venue?.name ?? venueId,
      feeling: venueFeelingFor(s.rel.venues?.[venueId] ?? venueReaction(character, venueId)),
      ...(note ? { note } : {}),
    },
    turn: opts.turn,
    maxTurns: s.record.maxTurns,
    firstDate: (s.relBefore.dates ?? 0) === 0,
    names,
  }
  if (giftId) {
    const reaction = giftReactionFor(s.rel.gifts?.[giftId] ?? giftReaction(character, giftId))
    ctx.gift = { name: giftPhrase(giftId), reaction }
  }
  if (opts.special) ctx.special = opts.special
  if (opts.turn > 0 && opts.judge) ctx.judge = opts.judge
  if (relations) ctx.relations = relations
  const system = buildStoryPrompt(ctx, character.prompts?.story)
  return { system, messages: makeStoryMessages(system, conversation(s.record.turns), opts.turn === 0) }
}

/** The judge call for the player's new message, with the turns before it. */
export function judgeRequest(s: DateSession, message: string, before: readonly DateTurn[]): ModelRequest {
  const { character, names } = s.world
  const system = buildJudgePrompt(
    {
      character,
      rel: s.rel,
      route: routeOf(s.world),
      names,
      others: s.world.others ?? [],
      recent: conversation(before),
      message,
    },
    character.prompts?.judge,
  )
  return { system, messages: makeJudgeMessages(system) }
}

/** The suggestions call, with the last 4 turns. */
export function suggestionsRequest(s: DateSession): ModelRequest & { keys: string[] } {
  const { character, names, settings } = s.world
  const route = routeOf(s.world)
  const system = buildSuggestionsPrompt(
    { character, rel: s.rel, route, heat: settings.heat },
    character.prompts?.suggestions,
  )
  return {
    system,
    messages: makeSuggestionsMessages(system, conversation(s.record.turns), { characterName: character.name, names }),
    keys: [...suggestionKeys(route)],
  }
}

// ---------------------------------------------------------------------------
// Running it

function aborted(hooks: DateHooks): boolean {
  return !!hooks.signal?.aborted
}

function emit(s: DateSession, hooks: DateHooks): void {
  if (!aborted(hooks)) hooks.onUpdate(s)
}

async function save(s: DateSession, hooks: DateHooks): Promise<void> {
  try {
    await hooks.persist(s.rel, s.record)
  } catch {
    // The store records storage failures and warns the player; the date keeps going in memory.
  }
}

/** One line for a failed story call: what went wrong and what to do. */
export function describeStoryError(err: unknown, settings: Settings): string {
  try {
    const p = explainRoleError(err, settings.connection, 'story')
    return [sentence(p.message), sentence(p.fix)].filter(Boolean).join(' ')
  } catch {
    return sentence(err instanceof Error ? err.message : String(err)) || 'Something went wrong.'
  }
}

/** The system note for a reply that didn't come through. */
export function storyErrorNote(name: string, detail: string): string {
  return `${name}'s reply didn't come through. ${detail}`.trim()
}

function withoutErrorNotices(turns: readonly DateTurn[]): DateTurn[] {
  let end = turns.length
  while (end > 0 && turns[end - 1].role === 'system' && turns[end - 1].notice === 'error') end--
  return turns.slice(0, end)
}

function storyFailed(s: DateSession, err: unknown): DateSession {
  const name = s.world.character.name
  const detail = describeStoryError(err, s.world.settings)
  const turn: DateTurn = { role: 'system', text: storyErrorNote(name, detail), at: s.world.now(), notice: 'error' }
  return {
    ...s,
    status: 'awaiting-player',
    streaming: '',
    error: detail,
    record: { ...s.record, turns: [...withoutErrorNotices(s.record.turns), turn] },
  }
}

/** Add the character's reply (and the refusal note when the model declined). */
function landReply(s: DateSession, result: { text: string; refused: boolean }): DateSession {
  const { character } = s.world
  const at = s.world.now()
  const text = String(result.text ?? '').trim()
  const turns = withoutErrorNotices(s.record.turns)
  let rel = s.rel
  if (result.refused) {
    turns.push({ role: 'character', speaker: character.id, text: text || refusalBeat(character.name), at })
    turns.push({ role: 'system', text: REFUSAL_NOTE, at, notice: 'refused' })
  } else {
    turns.push({ role: 'character', speaker: character.id, text, at })
    rel = applyTopics(rel, detectTopics(text, 'character'))
    rel = applyUnlocks(character, rel, routeOf(s.world)).rel
  }
  const { error: _error, ...rest } = s
  return { ...rest, rel, streaming: '', record: { ...s.record, turns } }
}

/** The story call for the current turn, then either the end of the date or the chips. */
async function replyStep(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  const turn = playerTurnCount(s0.record)
  const final = turn >= s0.record.maxTurns
  const special: StorySpecial | undefined = s0.leaving ? { kind: 'exit' } : final && turn > 0 ? { kind: 'final' } : undefined
  const req = storyRequest(s0, { turn, judge: turn > 0 ? lastPlayerJudge(s0) : undefined, special })
  let s: DateSession = { ...s0, status: 'replying', streaming: '' }
  emit(s, hooks)
  if (aborted(hooks)) return { ...s, status: 'awaiting-player' }

  let result: { text: string; refused: boolean }
  try {
    result = await llm.story({
      ...req,
      signal: hooks.signal,
      onDelta: (chunk) => {
        if (aborted(hooks) || !chunk) return
        s = { ...s, streaming: s.streaming + chunk }
        emit(s, hooks)
      },
    })
  } catch (e) {
    if (aborted(hooks)) return { ...s, status: 'awaiting-player', streaming: '' }
    s = storyFailed(s, e)
    await save(s, hooks)
    emit(s, hooks)
    return s
  }
  if (!result || (!result.refused && !String(result.text ?? '').trim())) {
    s = storyFailed(s, new Error('The reply came back empty.'))
    await save(s, hooks)
    emit(s, hooks)
    return s
  }

  s = landReply(s, result)
  const over = s.leaving || (final && turn > 0)
  if (!over) s = { ...s, status: aborted(hooks) ? 'awaiting-player' : 'suggesting' }
  await save(s, hooks)
  emit(s, hooks)
  if (over) return (await finishDate(s, s.leaving ? 'left' : 'completed', llm, hooks)).session
  // Decided after the save: an abort that lands while it runs must not leave the date 'suggesting'.
  if (aborted(hooks)) return { ...s, status: 'awaiting-player' }
  return suggestStep(s, llm, hooks)
}

/** Fill the three chips when the setting is on; they never block the date. */
async function suggestStep(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  if (!s0.world.settings.suggestions) {
    const s: DateSession = { ...s0, status: 'awaiting-player', suggestions: null }
    emit(s, hooks)
    return s
  }
  let s: DateSession = { ...s0, status: 'suggesting', suggestions: null }
  if (s0.status !== 'suggesting') emit(s, hooks)
  const req = suggestionsRequest(s)
  let chips: Suggestions | null = null
  try {
    chips = coerceSuggestions(req.keys)(await llm.suggestions({ ...req, signal: hooks.signal }))
  } catch {
    chips = null
  }
  if (aborted(hooks)) return { ...s, status: 'awaiting-player', suggestions: null }
  s = { ...s, status: 'awaiting-player', suggestions: chips }
  emit(s, hooks)
  return s
}

/**
 * Start the date: venue and gift deltas and reactions (persisted), then the opening beat (turn 0,
 * no judge; a first date uses the opener line), then the chips. Only from 'opening'.
 */
export async function openDate(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  if (s0.status !== 'opening' || s0.record.turns.length > 0) return s0
  const s = applyOpening(s0)
  emit(s, hooks)
  await save(s, hooks)
  if (aborted(hooks)) return { ...s, status: 'awaiting-player' }
  return replyStep(s, llm, hooks)
}

/**
 * The player's turn: append it (persisted), judge it (neutral on failure), apply it (persisted),
 * stream the reply, then the chips. After the last turn, or once the date's total reaches -20 (the
 * reply is then the character leaving), the date finishes and the returned session is 'ended' with
 * the recap on its record. Does nothing unless canSend(s). An abort before the judge answers takes
 * the message back (the returned session doesn't have it).
 */
export async function sendPlayerMessage(s0: DateSession, text: string, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  const message = String(text ?? '').trim()
  if (!message || !canSend(s0)) return s0
  const { character } = s0.world
  const before = s0.record.turns
  const playerTurn: DateTurn = { role: 'player', text: message, at: s0.world.now() }
  const { error: _error, ...rest } = s0
  let s: DateSession = {
    ...rest,
    status: 'judging',
    streaming: '',
    suggestions: null,
    record: { ...s0.record, turns: [...before, playerTurn] },
  }
  emit(s, hooks)
  await save(s, hooks)

  const takeBack = async () => {
    await save(s0, hooks)
    return s0
  }
  if (aborted(hooks)) return takeBack()

  let judge: JudgeResult
  try {
    const r = await llm.judge({ ...judgeRequest(s, message, before), signal: hooks.signal })
    judge = sanitizeJudge(character, r?.value)
  } catch {
    if (aborted(hooks)) return takeBack()
    judge = neutralJudge()
  }
  if (aborted(hooks)) return takeBack()

  s = applyJudge(s, judge, message)
  emit(s, hooks)
  await save(s, hooks)
  return replyStep(s, llm, hooks)
}

/**
 * Ask for the missing reply again (after a failed or stopped story call): the judge result already
 * applied is kept, the error note is removed on success. Does nothing unless canRetry(s).
 */
export async function retryLastReply(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  if (!canRetry(s0)) return s0
  const { error: _error, ...rest } = s0
  return replyStep({ ...rest, record: { ...s0.record, turns: withoutErrorNotices(s0.record.turns) } }, llm, hooks)
}

/**
 * End the date: the memory summary (compressed past ~250 words), +1 date, +1 trust for a completed
 * date, the recap on the record, then persist. `reason`: 'completed' (every turn played), 'left'
 * (the character walked out) or 'ended' (the player pressed End date); a session that is leaving
 * always finishes as 'left'. Calling it on an ended session returns its recap. If a model call may
 * be running for this session, abort it and await it first, then pass the session it returned.
 */
export async function finishDate(
  s0: DateSession,
  reason: 'completed' | 'left' | 'ended',
  llm: DateLlm,
  hooks: DateHooks,
): Promise<{ session: DateSession; recap: DateRecap }> {
  if (s0.status === 'ended' && s0.record.recap) return { session: s0, recap: s0.record.recap }
  const { character, names } = s0.world
  const id = character.id
  const route = routeOf(s0.world)
  const outcome = s0.leaving ? 'left' : reason
  let s: DateSession = { ...s0, status: 'closing', streaming: '', suggestions: null }
  emit(s, hooks)

  let summary = ''
  const said = conversation(s.record.turns)
  if (said.some((t) => t.role === 'player') && !aborted(hooks)) {
    const req = memoryRequest(character, said, {
      characterName: character.name,
      names,
      // The summary is in the character's voice: the player by name, so it doesn't say "the player".
      playerLabel: s.world.profile.name?.trim() || 'Player',
      venue: venueById(s.record.venueId)?.name ?? s.record.venueId,
      ...(s.record.giftId ? { gift: giftPhrase(s.record.giftId) } : {}),
    })
    try {
      summary = cleanSummary(await llm.memory({ ...req, signal: hooks.signal }))
    } catch {
      summary = ''
    }
  }
  let memory = appendMemory(s.rel.memory ?? [], summary)
  if (needsCompression(memory) && !aborted(hooks)) {
    try {
      memory = applyCompression(memory, await llm.memory({ ...compressionRequest(character, memory), signal: hooks.signal }))
    } catch {
      // Keep the memory uncompressed; the next date tries again.
    }
  }

  const now = s.world.now()
  let rel: Relationship = { ...s.rel, memory, dates: (s.rel.dates ?? 0) + 1, lastDateAt: now }
  const consistency = consistencyTrust(rel, outcome)
  rel = applyUnlocks(character, consistency.rel, route).rel
  const totals = addTrust(totalsOf(s.record, id), consistency.applied)
  const ended: DateRecord = {
    ...s.record,
    endedAt: now,
    outcome,
    totals: { ...s.record.totals, [id]: totals },
  }
  const recap = buildRecap(s.relBefore, rel, ended, character, route, { memory: summary })
  s = { ...s, rel, status: 'ended', record: { ...ended, recap } }
  await save(s, hooks)
  emit(s, hooks)
  return { session: s, recap }
}
