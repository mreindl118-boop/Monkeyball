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
// Phase 4 (relationships), all optional so a date without them plays exactly as in Phase 3:
//   openDtr / closeDtr -> Define the relationship: turns flagged `dtr`, the DTR note in the story's
//                  turnNote, then the Agreement prompt once (closing the talk or ending the date)
//   createEpilogue -> the 6-turn epilogue at their first favorite venue, the ending's direction in
//                  every turnNote
//   openDate may set `dtrOffer` (the character wants to define it) and friend-route gossip
//   the turn steps add name-mention disclosure, betrayal (agreements and caught lies), the grudge,
//   heat pushes and the jealousy mark; secrets that unlock pass rumors on
//   finishDate, given the world (DateWorld.characters and .game), spreads gossip, rolls rekindles,
//   records an epilogue's ending, and hands the other relationships and the game state to
//   hooks.persistWorld (also on session.worldAfter)
//
// Sessions are immutable: every step returns a new object and hands it to hooks.onUpdate, so a
// store can simply replace its copy. Model problems never throw past the caller: a failed judge is
// neutral, failed chips are none, a failed story call becomes a system turn and the date waits for
// a retry. After the caller aborts (hooks.signal), no further model calls are made and onUpdate is
// no longer called; storage is still brought in line with the returned session.

import { giftById, giftNoun } from '../data/gifts'
import { dragNightNote, venueById } from '../data/venues'
import { coerceAgreement, coerceJudge, coerceSuggestions, neutralJudge, noAgreementResult } from '../llm/coerce'
import type { ChatMessage } from '../llm/client'
import { explainRoleError, REFUSAL_NOTE, refusalBeat } from '../llm/index'
import {
  buildAgreementPrompt,
  buildJudgePrompt,
  buildStoryPrompt,
  buildSuggestionsPrompt,
  giftReactionFor,
  makeAgreementMessages,
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
  AgreementResult,
  AgreementType,
  BetrayalEvent,
  Character,
  DateKind,
  DateRecap,
  DateRecord,
  DateTurn,
  DiscoveredTrait,
  DtrBy,
  EndingType,
  GameState,
  HeardRumor,
  JudgeResult,
  PlayerProfile,
  Relationship,
  Route,
  Rumor,
  SetRelationship,
  Settings,
  Suggestions,
  TierNumber,
} from '../types'
import {
  applyAgreementResult,
  characterDtrWish,
  checkBetrayal,
  dtrAvailable,
  firstName,
  jealousNow,
  knownOthersText,
  opinionText,
  othersSeen,
  recordBetrayal,
  seeing,
} from './agreements'
import { applyTopics, detectTopics, knownHits, recordGift, recordVenue, revealHits, UNIVERSAL_TRAITS } from './discovery'
import { endingDirection } from './endings'
import {
  afterDateWorld,
  applyGossipReveals,
  friendGossipLines,
  GOSSIP_AFFECTION,
  type GossipLines,
  relaysRumor,
  rumorsOnSecretUnlock,
  sharedSecretsText,
  type WorldUpdate,
} from './gossip'
import {
  addTrust,
  affectionRoom,
  applyAffection,
  applyDifficulty,
  clampAffection,
  clampTrust,
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
import { adjustApproval, DISCLOSURE_APPROVAL, metamourTrust } from './metamour'
import { buildRecap } from './recap'
import { rollRekindles } from './rekindle'
import { effectiveHeat, routeFor } from './stages'
import { applyTrust, applyTrustDelta, consistencyTrust, TRUST_RULES } from './trust'
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
  /**
   * Optional (Phase 4): the Agreement prompt when a Define-the-relationship talk closes (judge
   * role). `ok: false` with the declined fallback when the reply wasn't usable. Without it a talk
   * closes with no agreement.
   */
  agreement?(a: { system: string; messages: DateMessage[]; signal?: AbortSignal }): Promise<{ value: AgreementResult; ok: boolean }>
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

  // Phase 4, all optional: without them the date plays as in Phase 3.
  /** Every active character by id (routes of the others, gossip, rekindles). */
  characters?: Record<string, Character>
  /** Every relationship when the date starts (who else the player is seeing). */
  rels?: Record<string, Relationship>
  /** The game state when the date starts (rumors heard, metamour approval). finishDate needs it. */
  game?: GameState
  /** The active sets' relationships, card partners included (gossip, metamours, rekindles). */
  setRelations?: SetRelationship[]
  /** The active sets' rumors. */
  rumors?: Rumor[]
  /** Set id per active character (same-set gossip). */
  setOf?: Record<string, string>
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

  // Phase 4, all optional.
  /** Set by openDate when the character wants to define the relationship (the sheet opens pre-filled). */
  dtrOffer?: AgreementType
  /** An epilogue date: the ending it plays and its story direction. */
  ending?: { type: EndingType; group?: string[]; direction: string }
  /** Friend-route gossip the character shares on this date, and what it reveals about others. */
  gossip?: GossipLines
  /** Rumors passed on to the player on this date. */
  heard?: HeardRumor[]
  /** Rumor ids the player passed on to this character on this date. */
  relayed?: string[]
  /** People this character learned about from the player on this date (name mentions). */
  disclosed?: string[]
  /** After finishDate with the world given: every relationship, the game state, news, betrayals. */
  worldAfter?: WorldUpdate
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
  /**
   * Optional (Phase 4): after finishDate settles the world, the other relationships it changed and
   * the new game state (news, rumors, metamours, rekindles, endings seen). Called before the last
   * persist. A rejection is swallowed.
   */
  persistWorld?(rels: Relationship[], game: GameState): Promise<void>
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

// ---------------------------------------------------------------------------
// Phase 4 helpers (pure)

/** The route of any character in the world: the date's own, or another active character's. */
export function routeOfId(world: DateWorld, id: string): Route {
  if (id === world.character.id) return routeOf(world)
  const c = world.characters?.[id]
  return c ? routeFor(c, world.profile, world.settings.orientationMode) : 'romantic'
}

/** The relationships of characters in play (all of world.rels when the active characters aren't given). */
function relsInPlay(world: DateWorld): Record<string, Relationship> | undefined {
  const { rels, characters } = world
  if (!rels || !characters) return rels
  return Object.fromEntries(Object.entries(rels).filter(([x]) => x in characters))
}

/**
 * The other people the player is seeing (the judge's {others}): from world.rels when given
 * (romantic route, a date, affection 20+; characters of sets switched off don't count), else
 * world.others.
 */
export function othersOf(world: DateWorld): string[] {
  const id = world.character.id
  const rels = relsInPlay(world)
  if (rels) return othersSeen(rels, (x) => routeOfId(world, x), id)
  return (world.others ?? []).filter((x) => x !== id)
}

/** A Define-the-relationship talk is open on this date. */
export function dtrOpen(s: Pick<DateSession, 'record'>): boolean {
  return !!s.record.dtr && s.record.dtr.closedAt == null
}

/**
 * Define the relationship can be opened now: the player's turn (chips may still load), a turn left
 * to talk, Friend stage or above, not an epilogue, and not already opened on this date.
 */
export function canOpenDtr(s: DateSession): boolean {
  return canQueueSend(s) && !s.record.dtr && s.record.kind !== 'epilogue' && dtrAvailable(s.rel, routeOf(s.world))
}

/** Every rumor the player has heard: before this date (world.game) and on it. */
export function heardAll(s: Pick<DateSession, 'world' | 'heard'>): HeardRumor[] {
  return [...(s.world.game?.rumors ?? []), ...(s.heard ?? [])]
}

/** Rumor texts this character has passed on (the story's {secrets}). */
function rumorsTold(s: DateSession): string[] {
  const id = s.world.character.id
  const byId = new Map((s.world.rumors ?? []).map((r) => [r.id, r]))
  return heardAll(s)
    .filter((h) => h.heardFrom === id)
    .map((h) => byId.get(h.rumorId)?.text ?? '')
    .filter(Boolean)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The message names this person: the full name in any case, the first name capitalized as in
 * the name ("Kai"), or in lower case when the whole message is typed in lower case ("i saw kai").
 * Otherwise a capital is needed, so "my rook took your knight" doesn't name Rook.
 */
export function mentions(message: string, name: string): boolean {
  const text = String(message ?? '')
  const full = String(name ?? '').trim()
  if (!text || !full) return false
  if (new RegExp(`\\b${escapeRe(full)}\\b`, 'i').test(text)) return true
  const first = firstName(full)
  if (first.length < 2) return false
  if (new RegExp(`\\b${escapeRe(first)}\\b`).test(text)) return true
  return text === text.toLowerCase() && new RegExp(`\\b${escapeRe(first.toLowerCase())}\\b`).test(text)
}

/**
 * People whose names count as the player telling this character about them: anyone the player is
 * seeing, and (with world.rels) anyone the player went out with since this character's agreement.
 */
function disclosable(world: DateWorld, rel: Relationship): string[] {
  const id = world.character.id
  const rels = relsInPlay(world)
  if (!rels) return othersOf(world)
  const madeAt = rel.agreement?.type && rel.agreement.type !== 'none' ? rel.agreement.madeAt ?? 0 : Number.POSITIVE_INFINITY
  return Object.keys(rels)
    .filter((x) => {
      if (x === id) return false
      const r = rels[x]
      if (routeOfId(world, x) !== 'romantic' || (r.dates ?? 0) < 1) return false
      return seeing(r, 'romantic') || (r.lastDateAt ?? 0) > madeAt
    })
    .sort()
}

/** Secrets the player earned from other characters that mention this one (the judge's {sharedSecrets}). */
function earnedSecretsAbout(world: DateWorld): string[] {
  const id = world.character.id
  const first = firstName(world.character.name)
  if (!world.rels || !world.characters || first.length < 2) return []
  const re = new RegExp(`\\b${escapeRe(first)}\\b`, 'i')
  const out: string[] = []
  for (const o of Object.keys(world.rels).sort()) {
    const c = world.characters[o]
    if (o === id || !c) continue
    for (const i of world.rels[o].secretsUnlocked ?? []) {
      const text = c.secrets?.[i]?.text
      if (text && re.test(text)) out.push(`${c.name}'s secret: ${text}`)
    }
  }
  return out
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
  const unlocked = applyUnlocks(character, rel, route)
  rel = unlocked.rel
  return passRumors(
    {
      ...s,
      rel,
      record: {
        ...s.record,
        totals: { ...s.record.totals, [id]: gift.totals },
        opening: { ...s.record.opening, [id]: { venue: venue.applied, gift: gift.applied } },
      },
    },
    unlocked.secrets,
  )
}

// ---------------------------------------------------------------------------
// A turn's effects: small pure steps

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
  /** Optional (Phase 4): the betrayal this turn set off; its deltas replace the judge's. */
  betrayal?: BetrayalEvent
  /** Optional (Phase 4): people this character learned about from the player's message. */
  learned?: string[]
}

export type TurnStep = (t: TurnState) => TurnState

/**
 * Name-mention disclosure: naming someone the player is seeing (or went out with since this
 * character's agreement) tells this character about them (knownOthers), and may break the
 * agreement (checkBetrayal, how 'player'). Only the first betrayal of a turn counts.
 */
export const disclosureStep: TurnStep = (t) => {
  const { world } = t
  const c = world.character
  const named = disclosable(world, t.rel).filter((id) => mentions(t.message, world.names[id] ?? id))
  if (named.length === 0) return t
  const known = t.rel.knownOthers ?? []
  const learned = named.filter((id) => !known.includes(id))
  let rel = learned.length ? { ...t.rel, knownOthers: [...known, ...learned] } : t.rel
  let betrayal = t.betrayal
  for (const id of named) {
    if (betrayal) break
    const e = checkBetrayal(c, rel, id, 'player', world.rels?.[id], t.at, world.rng, { names: world.names })
    if (e) betrayal = e
  }
  return {
    ...t,
    rel,
    ...(learned.length ? { learned: [...(t.learned ?? []), ...learned] } : {}),
    ...(betrayal ? { betrayal } : {}),
  }
}

/** A lie the judge caught (breach) is a betrayal, unless this turn already set one off. */
export const breachStep: TurnStep = (t) => {
  if (!t.judge.breach || t.betrayal) return t
  const e = checkBetrayal(t.world.character, t.rel, '', 'lie', undefined, t.at, t.world.rng, { names: t.world.names })
  return e ? { ...t, betrayal: e } : t
}

/**
 * Trust: the judge's trustDelta through the trust rules (difficulty, then the grudge after a
 * betrayal), clamped 0-100. On a betrayal turn the betrayal's own drop (-15 to -30) counts instead,
 * so a caught lie always costs more trust than affection.
 */
export const trustStep: TurnStep = (t) => {
  if (t.betrayal) {
    const before = clampTrust(t.rel.trust)
    const trust = clampTrust(before + t.betrayal.trustDelta)
    const applied = trust - before
    return {
      ...t,
      rel: trust === t.rel.trust ? t.rel : { ...t.rel, trust },
      totals: addTrust(t.totals, applied),
      applied: { ...t.applied, trust: applied },
    }
  }
  const r = applyTrust({ character: t.world.character, rel: t.rel, judge: t.judge }, TRUST_RULES)
  return { ...t, rel: r.rel, totals: addTrust(t.totals, r.applied), applied: { ...t.applied, trust: r.applied } }
}

/**
 * Affection: difficulty, then the date's gain cap (on the ledger and on the meter's rise since the
 * date began), then 0-100 and the friend-route cap. On a betrayal turn the betrayal's drop (-10 to
 * -20) counts instead of the judge's delta (it counts toward the date's -20 exit like any loss).
 */
export const affectionStep: TurnStep = (t) => {
  const scaled = t.betrayal ? t.betrayal.affectionDelta : applyDifficulty(t.judge.delta, t.world.character.difficulty)
  const r = applyAffection(t.totals, scaled, t.world.settings.gainCap, meterRoom(t.world, t.rel.affection, t.route))
  const affection = clampAffection(t.rel.affection + r.applied, t.route, t.rel.affection)
  return {
    ...t,
    rel: affection === t.rel.affection ? t.rel : { ...t.rel, affection },
    totals: r.totals,
    applied: { ...t.applied, affection: r.applied },
  }
}

/** The betrayal goes on the record: the event, the memory line in their voice, the jealousy mark. */
export const betrayalStep: TurnStep = (t) => (t.betrayal ? { ...t, rel: recordBetrayal(t.rel, t.betrayal) } : t)

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

/**
 * Heat pushed past their comfort (Relationship.heatPushes): the player's heat is above what this
 * character is at (their ace cap, or heat 2 before their trust threshold) and the message landed
 * badly (a turn-off, or -6 or worse).
 */
export const heatStep: TurnStep = (t) => {
  const heat = t.world.settings.heat
  if (!(heat > effectiveHeat(t.world.character, t.rel.trust, heat))) return t
  const bad = t.judge.delta <= -6 || t.judge.hits.some((h) => h.type === 'turnOff')
  return bad ? { ...t, rel: { ...t.rel, heatPushes: (t.rel.heatPushes ?? 0) + 1 } } : t
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

/**
 * The hub's jealousy mark: they know about someone and mind, or a betrayal is still raw
 * (jealousNow); always on in the turn a betrayal lands.
 */
export const jealousStep: TurnStep = (t) => {
  const jealous = t.betrayal ? true : jealousNow(t.world.character, t.rel)
  return jealous === !!t.rel.jealous ? t : { ...t, rel: { ...t.rel, jealous } }
}

/**
 * The order: disclosure and betrayal first (they decide what counts), then trust and affection
 * with the caps, the betrayal's record, reveals, topics, connection, heat, unlocks, mood, jealousy.
 */
export const TURN_STEPS: readonly TurnStep[] = [
  disclosureStep,
  breachStep,
  trustStep,
  affectionStep,
  betrayalStep,
  revealStep,
  topicsStep,
  connectionStep,
  heatStep,
  unlockStep,
  moodStep,
  jealousStep,
]

export function runTurnSteps(t: TurnState, steps: readonly TurnStep[] = TURN_STEPS): TurnState {
  return steps.reduce((state, step) => step(state), t)
}

/** Rumors passed on for secrets that just unlocked (one roll per rumor per secret). */
function rumorsForSecrets(s: DateSession, secrets: readonly number[]): HeardRumor[] {
  const rumors = s.world.rumors ?? []
  if (secrets.length === 0 || rumors.length === 0) return []
  const id = s.world.character.id
  const out: HeardRumor[] = []
  for (let i = 0; i < secrets.length; i++) {
    out.push(...rumorsOnSecretUnlock(id, rumors, [...heardAll(s), ...out], s.world.rng, s.world.now()))
  }
  return out
}

/** Add rumors passed on for these new secrets to the session. */
function passRumors(s: DateSession, secrets: readonly number[]): DateSession {
  const heard = rumorsForSecrets(s, secrets)
  return heard.length ? { ...s, heard: [...(s.heard ?? []), ...heard] } : s
}

/** Rumors about this character that the player's message passes on to them. */
function noteRelays(s: DateSession, message: string): DateSession {
  const id = s.world.character.id
  const byId = new Map((s.world.rumors ?? []).map((r) => [r.id, r]))
  const relayed = [...(s.relayed ?? [])]
  for (const h of heardAll(s)) {
    const r = byId.get(h.rumorId)
    if (!r || !r.about.includes(id) || relayed.includes(r.id) || (h.relayedTo ?? []).includes(id)) continue
    if (relaysRumor(message, r, id, s.world.names)) relayed.push(r.id)
  }
  return relayed.length === (s.relayed ?? []).length ? s : { ...s, relayed }
}

/**
 * Apply a judge result to the session's last player turn: the steps above, the judge and applied
 * deltas on the turn, the date's totals, and `leaving` once the total reaches -20. Phase 4: people
 * the player named (disclosed), rumors passed on for new secrets, rumors the player relayed.
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
  let next: DateSession = {
    ...s,
    rel: result.rel,
    lastJudge: judge,
    leaving: s.leaving || leftEarly(result.totals.affection),
    record: { ...s.record, turns, totals: { ...s.record.totals, [id]: result.totals } },
  }
  if (result.learned?.length) {
    next = { ...next, disclosed: [...new Set([...(s.disclosed ?? []), ...result.learned])] }
  }
  next = passRumors(next, result.secrets)
  return noteRelays(next, message)
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
  // Phase 4: who they know about (marked where it breaks the agreement), gossip, rumors passed on,
  // and the traits every character has (the LANDED line names a misgendering hit).
  if ((s.rel.knownOthers ?? []).length > 0) ctx.knownOthersText = knownOthersText(character, s.rel, names)
  if (s.gossip?.lines.length) ctx.gossip = s.gossip.lines
  const rumors = rumorsTold(s)
  if (rumors.length) ctx.rumors = rumors
  ctx.extraTraits = UNIVERSAL_TRAITS
  const system = buildStoryPrompt(ctx, character.prompts?.story)
  return { system, messages: makeStoryMessages(system, conversation(s.record.turns), opts.turn === 0) }
}

/**
 * The turnNote's special for a story call: the exit, else an open Define-the-relationship talk,
 * else the epilogue's direction, else the last turn. (The last-turn note is added by turn number
 * whatever the special.)
 */
export function storySpecial(s: DateSession, turn: number): StorySpecial | undefined {
  if (s.leaving) return { kind: 'exit' }
  const dtr = s.record.dtr
  if (dtr && dtr.closedAt == null) return { kind: 'dtr', requested: dtr.requested }
  if (s.ending) return { kind: 'epilogue', direction: s.ending.direction }
  if (turn >= s.record.maxTurns && turn > 0) return { kind: 'final' }
  return undefined
}

/**
 * The judge call for the player's new message, with the turns before it. {others} is everyone else
 * the player is seeing plus anyone this character knows about; {opinion} where they think the two
 * of them stand (opinionText); {sharedSecrets} the rumors the player has heard about them, with
 * the truth, and secrets the player earned that concern them.
 */
export function judgeRequest(s: DateSession, message: string, before: readonly DateTurn[]): ModelRequest {
  const { character, names } = s.world
  const known = s.rel.knownOthers ?? []
  const others = [...new Set([...othersOf(s.world), ...known])].filter((x) => x !== character.id)
  const shared = sharedSecretsText(character.id, heardAll(s), s.world.rumors ?? [], earnedSecretsAbout(s.world), names)
  const system = buildJudgePrompt(
    {
      character,
      rel: s.rel,
      route: routeOf(s.world),
      names,
      others,
      opinion: opinionText(character, s.rel, names),
      ...(shared !== 'none' ? { sharedSecretsText: shared } : {}),
      extraTraits: UNIVERSAL_TRAITS,
      recent: conversation(before),
      message,
    },
    character.prompts?.judge,
  )
  return { system, messages: makeJudgeMessages(system) }
}

/** The Agreement prompt for the Define-the-relationship talk on this date (only its `dtr` turns). */
export function agreementRequest(s: DateSession): ModelRequest {
  const { character, names, relations } = s.world
  const requested = s.record.dtr?.requested ?? 'casual'
  const system = buildAgreementPrompt({
    character,
    rel: s.rel,
    requested,
    names,
    turns: conversation(s.record.turns).filter((t) => t.dtr),
    ...(relations ? { relations } : {}),
  })
  return { system, messages: makeAgreementMessages(system) }
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
  const dtr = dtrOpen(s) ? { dtr: true } : {}
  let rel = s.rel
  let secrets: number[] = []
  if (result.refused) {
    turns.push({ role: 'character', speaker: character.id, text: text || refusalBeat(character.name), at, ...dtr })
    turns.push({ role: 'system', text: REFUSAL_NOTE, at, notice: 'refused' })
  } else {
    turns.push({ role: 'character', speaker: character.id, text, at, ...dtr })
    rel = applyTopics(rel, detectTopics(text, 'character'))
    const unlocked = applyUnlocks(character, rel, routeOf(s.world))
    rel = unlocked.rel
    secrets = unlocked.secrets
  }
  const { error: _error, ...rest } = s
  return passRumors({ ...rest, rel, streaming: '', record: { ...s.record, turns } }, secrets)
}

/** The story call for the current turn, then either the end of the date or the chips. */
async function replyStep(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  const turn = playerTurnCount(s0.record)
  const final = turn >= s0.record.maxTurns
  const special = storySpecial(s0, turn)
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
 * Phase 4 at date start (after the venue and gift): a character who wants to define the
 * relationship says so (dtrOffer, characterDtrWish), and a friend-route character at Acquaintance
 * or above brings gossip (friendGossipLines, when the world's characters and relationships are
 * given). Not on an epilogue. The random source is only used when one of them can happen.
 */
export function withDateStart(s: DateSession): DateSession {
  if (s.record.kind === 'epilogue') return s
  const { character, rng } = s.world
  const route = routeOf(s.world)
  let out = s
  const wish = s.record.dtr ? null : characterDtrWish(character, s.rel, rng, route)
  if (wish) out = { ...out, dtrOffer: wish }
  const { characters, rels } = s.world
  if (route === 'friend' && characters && rels && (s.rel.affection ?? 0) >= GOSSIP_AFFECTION && !s.gossip) {
    const gossip = friendGossipLines(character, {
      characters,
      rels,
      relations: s.world.setRelations ?? [],
      routeOf: (x) => routeOfId(s.world, x),
      names: s.world.names,
      rng,
      ...(s.world.setOf ? { setOf: s.world.setOf } : {}),
    })
    if (gossip.lines.length) out = { ...out, gossip }
  }
  return out
}

/**
 * Start the date: venue and gift deltas and reactions (persisted), then the opening beat (turn 0,
 * no judge; a first date uses the opener line), then the chips. Only from 'opening'. Phase 4: may
 * set `dtrOffer` and friend-route gossip (withDateStart).
 */
export async function openDate(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  if (s0.status !== 'opening' || s0.record.turns.length > 0) return s0
  const s = withDateStart(applyOpening(s0))
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
  const playerTurn: DateTurn = { role: 'player', text: message, at: s0.world.now(), ...(dtrOpen(s0) ? { dtr: true } : {}) }
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

// ---------------------------------------------------------------------------
// Define the relationship (Phase 4)

/**
 * Open Define the relationship, asking for `requested` (the player picked it, or accepted what the
 * character wanted: by 'character'). From now until the talk closes, turns are flagged `dtr` and
 * every story call carries the DTR note. Does nothing unless canOpenDtr(s); clears dtrOffer.
 * Pure: the next step persists it.
 */
export function openDtr(s: DateSession, requested: AgreementType, by: DtrBy): DateSession {
  if (requested === 'none' || !canOpenDtr(s)) return s
  const { dtrOffer: _offer, ...rest } = s
  return { ...rest, record: { ...s.record, dtr: { requested, by, openedAt: s.world.now() } } }
}

/** The player waved off the character's wish to define the relationship. */
export function dismissDtrOffer(s: DateSession): DateSession {
  if (!s.dtrOffer) return s
  const { dtrOffer: _offer, ...rest } = s
  return rest
}

/**
 * Close the talk: the Agreement prompt once over the talk's turns (skipped when the player said
 * nothing in it, or when the model call isn't there), its result applied (applyAgreementResult:
 * trust for how it went, the agreement when accepted), the character's style and the player's out
 * in the open, and record.dtr closed with the result. `keepOpen`: when the call fails or is stopped
 * the talk stays open (unchanged session) instead of closing with nothing settled. Not persisted or
 * emitted.
 */
async function settleDtr(s: DateSession, llm: DateLlm, hooks: DateHooks, keepOpen = false): Promise<DateSession> {
  const dtr = s.record.dtr
  if (!dtr || dtr.closedAt != null) return s
  const { character } = s.world
  const id = character.id
  const talked = conversation(s.record.turns).some((t) => t.dtr && t.role === 'player')
  let result: AgreementResult | undefined
  if (talked && llm.agreement) {
    if (aborted(hooks)) {
      if (keepOpen) return s
    } else {
      try {
        const r = await llm.agreement({ ...agreementRequest(s), signal: hooks.signal })
        result = coerceAgreement(r?.value) ?? noAgreementResult()
      } catch {
        if (keepOpen) return s
        result = undefined
      }
      if (aborted(hooks)) {
        if (keepOpen) return s
        result = undefined
      }
    }
  }
  const now = s.world.now()
  let rel = s.rel
  let totals = totalsOf(s.record, id)
  if (result) {
    const before = clampTrust(rel.trust)
    rel = applyAgreementResult(rel, result, now, character)
    totals = addTrust(totals, clampTrust(rel.trust) - before)
  }
  rel = applyTopics(rel, { attractions: false, style: true, playerStyle: true })
  const unlocked = applyUnlocks(character, rel, routeOf(s.world))
  const record: DateRecord = {
    ...s.record,
    totals: { ...s.record.totals, [id]: totals },
    dtr: { ...dtr, closedAt: now, ...(result ? { result } : {}) },
  }
  return passRumors({ ...s, rel: unlocked.rel, record }, unlocked.secrets)
}

/**
 * The player closes the Define-the-relationship talk: the Agreement prompt runs once and its result
 * is applied (see settleDtr), persisted, and the date goes on (status 'judging' while the call
 * runs). Only on the player's turn with a talk open. When the call fails or is stopped the talk
 * stays open (dtrOpen is still true): close it again, or it settles when the date ends.
 */
export async function closeDtr(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  if (!dtrOpen(s0) || (s0.status !== 'awaiting-player' && s0.status !== 'suggesting')) return s0
  let s: DateSession = { ...s0, status: 'judging' }
  emit(s, hooks)
  s = await settleDtr(s, llm, hooks, true)
  if (dtrOpen(s)) {
    const back: DateSession = { ...s0, status: 'awaiting-player' }
    emit(back, hooks)
    return back
  }
  s = { ...s, status: 'awaiting-player' }
  await save(s, hooks)
  emit(s, hooks)
  return s
}

// ---------------------------------------------------------------------------
// The epilogue (Phase 4)

/** Player turns on an epilogue date. */
export const EPILOGUE_TURNS = 6

/**
 * The epilogue date for a character at 100 affection: 6 turns at their first favorite venue, no
 * gift, the ending's story direction in every turnNote (storySpecial). openDate starts it as usual;
 * finishDate records the ending on the relationship and in GameState.endingsSeen.
 */
export function createEpilogue(world: DateWorld, ending: { type: EndingType; group?: string[] }): DateSession {
  const c = world.character
  const venueId = c.favoriteVenues?.find(Boolean) ?? 'rooftop-bar'
  const base = createDate(world, { venueId, maxTurns: EPILOGUE_TURNS, kind: 'epilogue' })
  const rival = world.rel.rekindledWith ? world.names[world.rel.rekindledWith] ?? world.rel.rekindledWith : undefined
  const direction = endingDirection(ending, {
    characterId: c.id,
    name: c.name,
    ...(world.profile.name?.trim() ? { player: world.profile.name.trim() } : {}),
    names: world.names,
    ...(rival && ending.type === 'sacrifice' ? { rival } : {}),
  })
  return {
    ...base,
    record: { ...base.record, endingType: ending.type },
    ending: { type: ending.type, ...(ending.group?.length ? { group: [...ending.group] } : {}), direction },
  }
}

// ---------------------------------------------------------------------------
// Finishing

/**
 * The world after this date (Phase 4, when DateWorld.characters and .game are given): rumors heard
 * and relayed, metamour approval for what the player disclosed under poly, friend-route gossip
 * reveals, then word of the date spreading (afterDateWorld) and rekindle rolls (not after an
 * epilogue), and an epilogue's ending recorded. Returns the date character's relationship as it
 * stands after all that, and the update.
 */
function settleWorld(s: DateSession, rel: Relationship, now: number): { rel: Relationship; world?: WorldUpdate } {
  const w = s.world
  const id = w.character.id
  const epilogue = s.record.kind === 'epilogue'
  const endingType = epilogue ? (s.ending?.type ?? s.record.endingType) : undefined
  let out = rel
  if (endingType) out = { ...out, ending: { type: endingType, playedAt: now } }
  if (!w.characters || !w.game) return { rel: out }
  const characters = { ...w.characters, [id]: w.character }
  const relations = w.setRelations ?? []
  let rels: Record<string, Relationship> = { ...(w.rels ?? {}), [id]: out }
  let game: GameState = w.game
  const news: WorldUpdate['news'] = []
  const betrayals: WorldUpdate['betrayals'] = []

  if ((s.heard ?? []).length || (s.relayed ?? []).length) {
    const relayed = new Set(s.relayed ?? [])
    const rumors = [...(game.rumors ?? []), ...(s.heard ?? [])].map((h) =>
      relayed.has(h.rumorId) && !(h.relayedTo ?? []).includes(id) ? { ...h, relayedTo: [...(h.relayedTo ?? []), id] } : h,
    )
    game = { ...game, rumors }
  }
  if (out.agreement?.type === 'poly') {
    for (const o of s.disclosed ?? []) game = adjustApproval(game, id, o, DISCLOSURE_APPROVAL, relations)
  }
  if (s.gossip?.reveals.length) rels = applyGossipReveals(rels, s.gossip.reveals)

  if (!epilogue) {
    const routeOfX = (x: string) => routeOfId(w, x)
    const after = afterDateWorld({
      datedIds: [id],
      characters,
      rels,
      relations,
      routeOf: routeOfX,
      game,
      now,
      rng: w.rng,
      names: w.names,
      ...(w.setOf ? { setOf: w.setOf } : {}),
    })
    rels = after.rels
    game = after.game
    news.push(...after.news)
    betrayals.push(...after.betrayals)
    const rk = rollRekindles({
      characters,
      rels,
      relations,
      game,
      now,
      rng: w.rng,
      names: w.names,
      ...(w.setOf ? { setOf: w.setOf } : {}),
    })
    rels = rk.rels
    game = rk.game
    news.push(...rk.news)
  } else if (endingType) {
    const who = [id, ...(s.ending?.group ?? []).filter((g) => g !== id)]
    const seen = { ...(game.endingsSeen ?? {}) }
    for (const g of who) seen[g] = [...new Set([...(seen[g] ?? []), endingType])]
    game = { ...game, endingsSeen: seen }
  }
  return { rel: rels[id] ?? out, world: { rels, game, news, betrayals } }
}

/** The relationships the world update changed, other than the date character's. */
function changedOthers(s: DateSession, world: WorldUpdate): Relationship[] {
  const id = s.world.character.id
  const before = s.world.rels ?? {}
  return Object.keys(world.rels)
    .filter((x) => x !== id && world.rels[x] !== before[x])
    .sort()
    .map((x) => world.rels[x])
}

/**
 * End the date: an open Define-the-relationship talk settles (the Agreement prompt once), the
 * memory summary (compressed past ~250 words), +1 date, +1 trust for a completed date (thinned by a
 * grudge), metamour trust under poly, rumors for secrets that unlock, the world after the date
 * (settleWorld: gossip, betrayals elsewhere, rekindles, an epilogue's ending; handed to
 * hooks.persistWorld and kept on session.worldAfter), the recap on the record, then persist.
 * `reason`: 'completed' (every turn played), 'left' (the character walked out) or 'ended' (the
 * player pressed End date); a session that is leaving always finishes as 'left'. Calling it on an
 * ended session returns its recap. If a model call may be running for this session, abort it and
 * await it first, then pass the session it returned.
 */
export async function finishDate(
  s0: DateSession,
  reason: 'completed' | 'left' | 'ended',
  llm: DateLlm,
  hooks: DateHooks,
): Promise<{ session: DateSession; recap: DateRecap; world?: WorldUpdate }> {
  if (s0.status === 'ended' && s0.record.recap) {
    return { session: s0, recap: s0.record.recap, ...(s0.worldAfter ? { world: s0.worldAfter } : {}) }
  }
  const { character, names } = s0.world
  const id = character.id
  const route = routeOf(s0.world)
  const outcome = s0.leaving ? 'left' : reason
  let s: DateSession = { ...s0, status: 'closing', streaming: '', suggestions: null }
  emit(s, hooks)

  if (dtrOpen(s)) s = await settleDtr(s, llm, hooks)

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
  const consistency = consistencyTrust(rel, outcome, character)
  rel = consistency.rel
  let trustMoved = consistency.applied
  if (outcome === 'completed' && s.world.game) {
    const d = metamourTrust(s.world.game, id, rel, s.world.setRelations ?? [])
    if (d) {
      const before = clampTrust(rel.trust)
      rel = applyTrustDelta(rel, d, character)
      trustMoved += clampTrust(rel.trust) - before
    }
  }
  const unlocked = applyUnlocks(character, rel, route)
  rel = unlocked.rel
  s = passRumors({ ...s, rel }, unlocked.secrets)

  const settled = settleWorld(s, rel, now)
  rel = settled.rel
  // The jealousy mark follows what they know and how raw a betrayal still is (kept on through the
  // date a betrayal landed on).
  const jealous = jealousNow(character, rel)
  if (jealous !== !!rel.jealous && !(rel.betrayals ?? []).some((b) => b.at >= s.record.startedAt)) rel = { ...rel, jealous }
  const world = settled.world ? { ...settled.world, rels: { ...settled.world.rels, [id]: rel } } : undefined

  const totals = addTrust(totalsOf(s.record, id), trustMoved)
  const ended: DateRecord = {
    ...s.record,
    endedAt: now,
    outcome,
    totals: { ...s.record.totals, [id]: totals },
  }
  const recap = buildRecap(s.relBefore, rel, ended, character, route, {
    memory: summary,
    ...(s.gossip?.lines.length ? { gossip: s.gossip.lines } : {}),
    ...((s.heard ?? []).length ? { rumors: (s.heard ?? []).map((h) => h.rumorId) } : {}),
    ...(world ? { world: { news: world.news, betrayals: world.betrayals } } : {}),
  })
  s = { ...s, rel, status: 'ended', record: { ...ended, recap }, ...(world ? { worldAfter: world } : {}) }
  if (world && hooks.persistWorld) {
    try {
      await hooks.persistWorld(changedOthers(s, world), world.game)
    } catch {
      // The store reports storage problems itself.
    }
  }
  await save(s, hooks)
  emit(s, hooks)
  return { session: s, recap, ...(world ? { world } : {}) }
}
