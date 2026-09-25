// Group dates (Phase 6; docs/SPEC.md, "Discovery & Secrets": group dates; ARCHITECTURE, Date flow).
// Two characters and the player at one venue. Built on the single date's pure steps: every
// character keeps their own session (src/engine/dateFlow.ts, DateSession.group.members), and each
// step runs the single-date function on that character's view of the shared record.
//
//   createGroupDate  -> a session in 'opening'
//   openGroupDate    -> venue for each and the gift for the one it's for (applyOpening per
//                       character), then the reveal (each learns the player is seeing the other:
//                       knownOthers, checkBetrayal how 'group'), then the opening beat, then chips
//   sendGroupMessage -> player turn, one judge call per character still there (in parallel), each
//                       applied with that character's difficulty, cap and early exit (applyJudge),
//                       then one story reply that voices both ("Nova: ..." lines parsed into turns)
//   retryGroupReply  -> the story call again after a failed one
//   finishGroupDate  -> memory for each, +1 date each, consistency trust, metamour approval by how the
//                       date went, gossip and rekindles (one date on the count), a recap per character
//
// When one character walks out (their date total reaches -20) the next reply writes their exit
// and the date goes on with the other; it ends early only when everyone left. The scene plays at
// the lowest effective heat of the two. Define the relationship isn't offered on a group date.

import type { ArtSlot } from '../art/types'
import { dragNightNote, venueById } from '../data/venues'
import { coerceSuggestions, neutralJudge } from '../llm/coerce'
import { REFUSAL_NOTE, refusalBeat } from '../llm/index'
import {
  buildGroupStoryPrompt,
  buildSuggestionsPrompt,
  giftReactionFor,
  groupHeat,
  groupTurnNote,
  makeGroupStoryMessages,
  makeSuggestionsMessages,
  noPeriod,
  sentence,
  speakerTags,
  suggestionKeys,
  type GroupStoryContext,
} from '../prompts/build'
import type {
  AgreementType,
  BetrayalEvent,
  Character,
  DateRecap,
  DateRecord,
  DateTurn,
  GameState,
  Jealousy,
  NewsItem,
  Relationship,
  Route,
  SetRelationKind,
  SetRelationship,
  Suggestions,
} from '../types'
import { alreadyCounted, checkBetrayal, datedSinceAgreement, firstName, isJealous, recentlyDated, recordBetrayal, seeing, seenIn } from './agreements'
import {
  applyJudge,
  applyOpening,
  conversation,
  createDate,
  describeStoryError,
  giftPhrase,
  HOME_NOTE,
  judgeRequest,
  lastPlayerJudge,
  meterRoom,
  needsReply,
  passRumors,
  playerTurnCount,
  routeOf,
  routeOfId,
  sanitizeJudge,
  storyContext,
  totalsOf,
  withoutErrorNotices,
  type DateHooks,
  type DateLlm,
  type DateSession,
  type DateWorld,
  type GroupState,
  type ModelRequest,
} from './dateFlow'
import { applyTopics, detectTopics } from './discovery'
import { afterDateWorld, settleSecondhand, type WorldUpdate } from './gossip'
import { addTrust, applyAffection, clampAffection, clampTrust, emptyTotals, giftReaction, leftEarly } from './math'
import { appendMemory, applyCompression, cleanSummary, compressionRequest, memoryRequest, needsCompression } from './memory'
import { adjustApproval, approval, DISCLOSURE_APPROVAL, groupApprovalDelta, metamourTrust } from './metamour'
import { characterRecap } from './recap'
import { rollRekindles } from './rekindle'
import { joinAnd } from './stages'
import { applyTrustDelta, consistencyTrust, forgive } from './trust'
import { applyUnlocks } from './unlocks'

// ---------------------------------------------------------------------------
// Between them (pure; the date setup shows the same facts)

/** The gallery slot a pair's group date paints (group:{ids}:group-date, one per pair). */
export const GROUP_DATE_SLOT = 'group-date'

/** The pair's shared picture: one per pair, whatever the venue. */
export function groupArtSlot(ids: readonly string[]): ArtSlot {
  return { kind: 'group', characterIds: [...new Set(ids)].sort(), slot: GROUP_DATE_SLOT }
}

/** What two characters are to each other: the set relationships between them (romantic first). */
export interface PairHistory {
  relations: { kind: SetRelationKind; note: string }[]
  /** They move in the same circles (the same set, or a relationship links them). */
  known: boolean
}

const KIND_ORDER: readonly SetRelationKind[] = [
  'partner',
  'situationship',
  'ex',
  'rival',
  'housemate',
  'roommate',
  'bandmate',
  'coworker',
  'family',
  'friend',
  'neighbor',
]

/** Characters of these two sets know each other: the same set, or a manifest's `knows` links them. */
export function linkedByKnows(setKnows: Readonly<Record<string, readonly string[]>> | undefined): (a: string, b: string) => boolean {
  return (a, b) => a === b || !!setKnows?.[a]?.includes(b) || !!setKnows?.[b]?.includes(a)
}

/**
 * The relationships between a and b (each kind once, romantic ones first, notes kept). `linked`
 * says whether two set ids know each other (a manifest's `knows`); the same set always does.
 */
export function pairHistory(
  a: string,
  b: string,
  relations: readonly SetRelationship[],
  setOf?: Readonly<Record<string, string>>,
  linked?: (setA: string, setB: string) => boolean,
): PairHistory {
  const out: PairHistory['relations'] = []
  for (const r of relations ?? []) {
    if (!((r.a === a && r.b === b) || (r.a === b && r.b === a))) continue
    const have = out.find((o) => o.kind === r.kind)
    if (have) {
      if (!have.note && r.note) have.note = r.note
      continue
    }
    out.push({ kind: r.kind, note: String(r.note ?? '').trim() })
  }
  out.sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind))
  const sa = setOf?.[a]
  const sb = setOf?.[b]
  const sameCircle = !!sa && !!sb && (sa === sb || !!linked?.(sa, sb))
  return { relations: out, known: out.length > 0 || sameCircle }
}

/** How one character on the group date feels about the player dating the other. */
export interface GroupFeeling {
  id: string
  other: string
  /** The route the player is on with this character. */
  route: Route
  /**
   * Where the player stands with the other: a friend route, 'new' (a romantic route but no recent
   * date: tonight is a first date with them), 'dated' (been out lately, not seeing() yet) or
   * 'seeing' (seeing() in src/engine/agreements.ts).
   */
  standing: 'friend' | 'new' | 'dated' | 'seeing'
  /** The player has been out with the other lately on a romantic route ('dated' or 'seeing'). */
  otherRomantic: boolean
  /** They already knew the player is seeing the other. */
  knew: boolean
  agreement: AgreementType
  /** Meeting the other breaks their agreement: exclusive, and the player went out with the other since. */
  breaks: boolean
  jealousy: Jealousy
  /** Metamour approval of the other, 0-100. */
  approval: number
  trust: number
  /** The player has learned this character's relationship style (so how they take it can be shown). */
  styleKnown: boolean
}

export interface FeelingInput {
  observer: Character
  rel: Relationship
  otherId: string
  /** The player's relationship with the other (for dates since the agreement). */
  otherRel?: Relationship
  route: Route
  otherRoute: Route
  approval: number
  /** GameState.dateCount (dates lapse after a while; see recentlyDated). */
  dateCount?: number
}

/** How `observer` feels about the player dating `otherId`, as the group date starts. */
export function groupFeeling(i: FeelingInput): GroupFeeling {
  const agreement = i.rel.agreement?.type ?? 'none'
  const standing: GroupFeeling['standing'] =
    i.otherRoute !== 'romantic'
      ? 'friend'
      : seeing(i.otherRel, i.otherRoute, i.dateCount)
        ? 'seeing'
        : recentlyDated(i.otherRel, i.otherRoute, i.dateCount)
          ? 'dated'
          : 'new'
  const otherRomantic = standing === 'dated' || standing === 'seeing'
  const knew = (i.rel.knownOthers ?? []).includes(i.otherId) && !(i.rel.heardSecondhand ?? []).includes(i.otherId)
  const breaks =
    otherRomantic &&
    agreement === 'exclusive' &&
    datedSinceAgreement(i.rel, i.otherRel) &&
    !alreadyCounted(i.rel, i.otherId, i.otherRel)
  return {
    id: i.observer.id,
    other: i.otherId,
    route: i.route,
    standing,
    otherRomantic,
    knew,
    agreement,
    breaks,
    jealousy: i.observer.jealousy,
    approval: Math.round(i.approval),
    trust: Math.round(i.rel.trust ?? 0),
    styleKnown: !!i.rel.revealed?.style,
  }
}

const KIND_PHRASE: Record<SetRelationKind, string> = {
  partner: 'are partners',
  ex: 'are exes',
  situationship: 'have a situationship going',
  friend: 'are friends',
  rival: 'are rivals',
  roommate: 'are roommates',
  housemate: 'share a house',
  coworker: 'work together',
  bandmate: 'are in a band together',
  neighbor: 'are neighbors',
  family: 'are family',
}

const JEALOUSY_WORDS: Record<Jealousy, string> = {
  compersion: 'happy about it',
  low: 'mostly relaxed about it',
  medium: 'not sure how to feel about it',
  high: 'jealous, more than it shows',
}

function approvalWords(n: number, other: string): string {
  return n >= 60 ? `likes ${other}` : n >= 40 ? `is undecided about ${other}` : `doesn't much like ${other}`
}

function trustWords(n: number): string {
  return n >= 60 ? 'trusts the player' : n >= 30 ? 'trusts the player only so far' : "doesn't trust the player much"
}

/** One BETWEEN THEM line for the story: how `f.id` feels about the player dating `f.other`. */
export function feelingPromptLine(f: GroupFeeling, names: Readonly<Record<string, string>>): string {
  const a = names[f.id] ?? f.id
  const b = names[f.other] ?? f.other
  if (f.route === 'friend') {
    return `${a} is here as the player's friend and doesn't mind who else the player sees; ${a} ${approvalWords(f.approval, b)}, and ${trustWords(f.trust)}.`
  }
  if (f.standing === 'new') {
    return `The player hasn't been out with ${b} before tonight, so there is nothing yet for ${a} to find out or mind; ${a} ${approvalWords(f.approval, b)}, and ${trustWords(f.trust)}.`
  }
  const been = f.standing === 'seeing' ? 'is seeing' : 'has been out with'
  const know = !f.otherRomantic
    ? `${a} knows the player and ${b} are only friends`
    : f.knew
      ? `${a} already knew the player ${been} ${b}`
      : `${a} finds out tonight that the player ${been} ${b}`
  const deal = !f.otherRomantic
    ? ''
    : f.agreement === 'exclusive'
      ? f.breaks
        ? `, which breaks the exclusive agreement ${a} made with the player`
        : `, and ${a} and the player agreed to be exclusive`
      : f.agreement === 'poly'
        ? `, and their poly agreement expects exactly this kind of openness`
        : f.agreement === 'open'
          ? `, and they agreed to keep it open`
          : f.agreement === 'casual'
            ? `, and they keep it casual`
            : ''
  const feel = f.otherRomantic ? `${a} is ${JEALOUSY_WORDS[f.jealousy] ?? JEALOUSY_WORDS.medium}, ` : `${a} `
  return `${know}${deal}. ${feel}${approvalWords(f.approval, b)}, and ${trustWords(f.trust)}.`
}

/** What the two are to each other, as prompt sentences ("Nova and Kai are exes: ..."). */
export function historySentences(a: string, b: string, history: PairHistory): string[] {
  if (!history.relations.length) {
    return [history.known ? `${a} and ${b} know each other from around, nothing more.` : `${a} and ${b} have never met before tonight.`]
  }
  return history.relations.map((r) => sentence(`${a} and ${b} ${KIND_PHRASE[r.kind] ?? `are ${r.kind}s`}${r.note ? `: ${noPeriod(r.note)}` : ''}`))
}

/** The whole BETWEEN THEM value: what they are to each other, then how each feels. */
export function betweenText(
  ids: readonly string[],
  history: PairHistory,
  feelings: readonly GroupFeeling[],
  names: Readonly<Record<string, string>>,
): string {
  const [a, b] = ids.map((id) => names[id] ?? id)
  const lines: string[] = historySentences(a, b, history)
  for (const f of feelings) lines.push(feelingPromptLine(f, names))
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Speaker tags

export interface GroupSpeaker {
  id: string
  name: string
}

export interface GroupLine {
  speaker: string
  text: string
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Lowercase with accents dropped ("Sebastián" and "sebastian" match). */
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** A line folded (foldName), with where each folded character came from in the original. */
function foldLine(line: string): { text: string; at: number[] } {
  let text = ''
  const at: number[] = []
  let i = 0
  for (const ch of line) {
    const f = foldName(ch)
    for (let k = 0; k < f.length; k++) at.push(i)
    text += f
    i += ch.length
  }
  at.push(line.length)
  return { text, at }
}

/**
 * The names a model may tag a character's line with: the full name, the speaker tag, the first
 * name, and for a card with a quoted nickname ('Roxanne "Rox" Delacroix') the name without it
 * ("Roxanne Delacroix"), the given name ("Roxanne") and the nickname with the surname ("Rox
 * Delacroix"). Folded (foldName).
 */
export function speakerAliases(name: string, tag?: string): string[] {
  const full = String(name ?? '').trim().replace(/\s+/g, ' ')
  const out = new Set<string>([full, tag ?? '', firstName(full)])
  const nick = /["“”]([^"“”]+)["“”]/.exec(full)?.[1]?.trim()
  const plain = full.replace(/\s*["“”][^"“”]+["“”]\s*/g, ' ').replace(/\s+/g, ' ').trim()
  if (plain) out.add(plain)
  const words = plain.split(' ').filter(Boolean)
  if (words.length) out.add(words[0])
  if (nick) {
    out.add(nick)
    if (words.length > 1) out.add(`${nick} ${words[words.length - 1]}`)
  }
  return [...out].map((a) => foldName(a.trim())).filter(Boolean)
}

/**
 * Split a group reply into per-character turns. A line that starts with a character's name (see
 * speakerAliases; any case, accents optional) and a colon starts that character's part: "Nova:
 * ...", "**Kai:** ...", "***Kai:***", "- Nova: ...", "* Nova: ...", "> Kai: ...", "Nova (laughing):
 * ...". Lines after it belong to them until the next tag. Text before any tag goes to `fallback`.
 * Consecutive parts of one speaker are merged. A narration line with no colon ("*Nova laughs.*")
 * isn't a tag.
 */
export function parseGroupReply(text: string, speakers: readonly GroupSpeaker[], fallback: string): GroupLine[] {
  const aliases: { alias: string; id: string }[] = []
  const tags = speakerTags(speakers.map((s) => s.name))
  const lists = speakers.map((s, i) => speakerAliases(s.name, tags[i]))
  lists.forEach((list, i) => {
    for (const alias of list) {
      // A name two of them share ("Alex") tags nobody; their full names still do.
      if (lists.some((other, j) => j !== i && other.includes(alias))) continue
      aliases.push({ alias, id: speakers[i].id })
    }
  })
  aliases.sort((x, y) => y.alias.length - x.alias.length)
  const out: GroupLine[] = []
  let current: GroupLine | null = null
  const re = aliases.length
    ? new RegExp(
        `^\\s*(?:[-•>]\\s+|\\*\\s+(?=[^*\\s]))?([*_]{0,3})\\s*(${aliases.map((a) => escapeRe(a.alias)).join('|')})\\s*(?:\\([^)]{0,40}\\))?\\s*(?:\\1\\s*(?:\\([^)]{0,40}\\))?\\s*:|:\\s*\\1)\\s*`,
        'u',
      )
    : null
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const folded = re ? foldLine(line) : null
    const m = folded ? re!.exec(folded.text) : null
    if (m && folded) {
      const id = aliases.find((a) => a.alias === m[2])?.id ?? fallback
      current = { speaker: id, text: line.slice(folded.at[m[0].length] ?? line.length) }
      out.push(current)
    } else if (current) {
      current.text += `\n${line}`
    } else {
      current = { speaker: fallback, text: line }
      out.push(current)
    }
  }
  const merged: GroupLine[] = []
  for (const l of out) {
    const t = l.text.replace(/\n{3,}/g, '\n\n').trim()
    if (!t) continue
    const last = merged[merged.length - 1]
    if (last && last.speaker === l.speaker) last.text = `${last.text}\n\n${t}`
    else merged.push({ speaker: l.speaker, text: t })
  }
  return merged
}

// ---------------------------------------------------------------------------
// The session (pure)

function group(s: DateSession): GroupState {
  if (!s.group) throw new Error('Not a group date.')
  return s.group
}

/** A group date session. */
export function isGroup(s: Pick<DateSession, 'group'> | null | undefined): boolean {
  return !!s?.group
}

/** The characters still on the date, in order. */
export function presentIds(s: DateSession): string[] {
  const g = group(s)
  return g.ids.filter((id) => !g.gone.includes(id))
}

/**
 * One character's view of the date: their own session with the group's record (the gift only on
 * the view of the one it's for), the group's settings and status. Single-date functions run on it.
 */
export function memberView(s: DateSession, id: string): DateSession {
  const g = group(s)
  const m = g.members[id]
  if (!m) throw new Error(`${id} isn't on this date.`)
  const { giftId: _gift, ...noGift } = s.record
  const record: DateRecord = g.giftTo === id ? s.record : noGift
  return { ...m, record, world: { ...m.world, settings: s.world.settings }, status: s.status, streaming: '', suggestions: null }
}

/** Keep the members' records in step and mirror the first character on the session itself. */
function sync(s: DateSession): DateSession {
  const g = group(s)
  const members: Record<string, DateSession> = {}
  for (const id of g.ids) members[id] = { ...g.members[id], record: s.record }
  const first = members[g.ids[0]]
  const leaving = g.ids.every((id) => g.gone.includes(id) || members[id].leaving)
  const out: DateSession = {
    ...s,
    world: { ...first.world, settings: s.world.settings },
    rel: first.rel,
    relBefore: first.relBefore,
    leaving,
    group: { ...g, members },
  }
  if (first.lastJudge) out.lastJudge = first.lastJudge
  else delete out.lastJudge
  return out
}

/** Put a character's session (from a single-date function) back: their state, the record's turns and totals. */
function putMember(s: DateSession, id: string, m: DateSession): DateSession {
  const g = group(s)
  const record: DateRecord = {
    ...s.record,
    turns: m.record.turns,
    totals: { ...s.record.totals, ...m.record.totals },
    ...(m.record.opening ? { opening: { ...s.record.opening, ...m.record.opening } } : {}),
  }
  return sync({ ...s, record, group: { ...g, members: { ...g.members, [id]: m } } })
}

/**
 * A new group date (at least two characters; the date setup offers two): each character's world as
 * a single date would get it (the store builds one per character). The gift goes to `giftTo` (the
 * first character when it isn't one of them).
 */
export function createGroupDate(
  worlds: readonly DateWorld[],
  opts: { venueId: string; giftId?: string; giftTo?: string; maxTurns: number },
): DateSession {
  const list: DateWorld[] = []
  for (const w of worlds) if (!list.some((x) => x.character.id === w.character.id)) list.push(w)
  if (list.length < 2) throw new Error('A group date needs two characters.')
  const ids = list.map((w) => w.character.id)
  const members: Record<string, DateSession> = {}
  for (const w of list) members[w.character.id] = createDate(w, { venueId: opts.venueId, maxTurns: opts.maxTurns, kind: 'group' })
  const base = members[ids[0]]
  const record: DateRecord = {
    kind: 'group',
    characterIds: ids,
    venueId: opts.venueId,
    startedAt: base.record.startedAt,
    maxTurns: base.record.maxTurns,
    turns: [],
    totals: Object.fromEntries(ids.map((id) => [id, emptyTotals()])),
  }
  const giftTo = opts.giftId ? (opts.giftTo && ids.includes(opts.giftTo) ? opts.giftTo : ids[0]) : undefined
  if (opts.giftId) record.giftId = opts.giftId
  return sync({ ...base, record, group: { ids, members, gone: [], ...(giftTo ? { giftTo } : {}) } })
}

/**
 * A group date rebuilt from its stored record (an interrupted date being finished): `relsBefore`
 * are the relationships when it started (in the worlds), `relsNow` as they were last saved.
 */
export function resumeGroupDate(
  worlds: readonly DateWorld[],
  record: DateRecord,
  relsNow: Readonly<Record<string, Relationship>>,
  giftTo?: string,
): DateSession {
  const created = createGroupDate(worlds, {
    venueId: record.venueId,
    ...(record.giftId ? { giftId: record.giftId } : {}),
    ...(giftTo ? { giftTo } : {}),
    maxTurns: record.maxTurns,
  })
  const g = group(created)
  const members: Record<string, DateSession> = {}
  const gone: string[] = []
  for (const id of g.ids) {
    const left = leftEarly(record.totals?.[id]?.affection ?? 0)
    if (left) gone.push(id)
    members[id] = { ...g.members[id], rel: relsNow[id] ?? g.members[id].rel, leaving: left }
  }
  return sync({ ...created, record, status: 'awaiting-player', group: { ...g, members, gone } })
}

/** Each character's venue delta, and the gift's for the one it's for (applyOpening per character). */
export function applyGroupOpening(s: DateSession): DateSession {
  let out = s
  for (const id of presentIds(s)) out = putMember(out, id, applyOpening(memberView(out, id)))
  return out
}

/**
 * They see each other on the date: each learns the player has been out with the other (knownOthers,
 * only when the player was already going out with the other before tonight, recentlyDated: a first
 * date with someone is nothing to find out; no longer only secondhand), and checkBetrayal decides
 * whether that breaks their agreement (how 'group': exclusive, the other dated since). A betrayal
 * counts on the date's ledger like a betrayal turn (it can make them walk out) and goes on record.
 */
export function applyGroupReveal(s: DateSession): DateSession {
  const g = group(s)
  let out = s
  const knewBefore: Record<string, boolean> = {}
  const reveals: Record<string, BetrayalEvent> = { ...g.reveals }
  for (const x of g.ids) {
    let m = group(out).members[x]
    const w = m.world
    let rel = m.rel
    let totals = totalsOf(out.record, x)
    knewBefore[x] = false
    for (const y of g.ids) {
      if (y === x || !recentlyDated(w.rels?.[y], routeOfId(w, y), w.game?.dateCount)) continue
      const knew = (rel.knownOthers ?? []).includes(y) && !(rel.heardSecondhand ?? []).includes(y)
      if (knew) knewBefore[x] = true
      const e = reveals[x] ? null : checkBetrayal(w.character, rel, y, 'group', w.rels?.[y], w.now(), w.rng, { names: w.names })
      if (!(rel.knownOthers ?? []).includes(y)) rel = { ...rel, knownOthers: [...(rel.knownOthers ?? []), y] }
      if ((rel.heardSecondhand ?? []).includes(y)) rel = { ...rel, heardSecondhand: (rel.heardSecondhand ?? []).filter((z) => z !== y) }
      if (!e) continue
      const route = routeOf(w)
      const trustBefore = clampTrust(rel.trust)
      const trust = clampTrust(trustBefore + e.trustDelta)
      totals = addTrust(totals, trust - trustBefore)
      const a = applyAffection(totals, e.affectionDelta, w.settings.gainCap, meterRoom(w, rel.affection, route))
      totals = a.totals
      rel = recordBetrayal({ ...rel, trust, affection: clampAffection(rel.affection + a.applied, route, rel.affection) }, e)
      reveals[x] = e
    }
    m = { ...m, rel, leaving: m.leaving || leftEarly(totals.affection) }
    out = putMember({ ...out, record: { ...out.record, totals: { ...out.record.totals, [x]: totals } } }, x, {
      ...m,
      record: { ...out.record, totals: { ...out.record.totals, [x]: totals } },
    })
  }
  const next = group(out)
  return sync({ ...out, group: { ...next, knewBefore, ...(Object.keys(reveals).length ? { reveals } : {}) } })
}

/** How each character feels about the player dating the other, as things stand on the date. */
export function groupFeelings(s: DateSession): GroupFeeling[] {
  const g = group(s)
  const out: GroupFeeling[] = []
  for (const x of g.ids) {
    const m = g.members[x]
    const w = m.world
    for (const y of g.ids) {
      if (y === x) continue
      const f = groupFeeling({
        observer: w.character,
        rel: m.relBefore,
        otherId: y,
        otherRel: w.rels?.[y],
        route: routeOf(w),
        otherRoute: routeOfId(w, y),
        approval: w.game ? approval(w.game, x, y, w.setRelations ?? []) : 50,
        ...(w.game?.dateCount != null ? { dateCount: w.game.dateCount } : {}),
      })
      out.push({ ...f, knew: g.knewBefore?.[x] ?? f.knew, breaks: !!g.reveals?.[x] || f.breaks, trust: Math.round(m.rel.trust ?? 0) })
    }
  }
  return out
}

/** The story's BETWEEN THEM for this date. */
export function groupBetween(s: DateSession): string {
  const g = group(s)
  const w = g.members[g.ids[0]].world
  return betweenText(g.ids, groupHistory(s), groupFeelings(s), w.names)
}

/** What the first two on the date are to each other (set relationships, same or linked sets). */
export function groupHistory(s: DateSession): PairHistory {
  const g = group(s)
  const w = g.members[g.ids[0]].world
  return pairHistory(g.ids[0], g.ids[1] ?? g.ids[0], w.setRelations ?? [], w.setOf, linkedByKnows(w.setKnows))
}

/** Speaker tags for everyone on the date (first names; full names when two share one). */
export function groupTags(s: DateSession): Record<string, string> {
  const g = group(s)
  const tags = speakerTags(g.ids.map((id) => g.members[id].world.character.name))
  return Object.fromEntries(g.ids.map((id, i) => [id, tags[i]]))
}

/** The heat the scene plays at: the lowest effective heat of everyone still there. */
export function groupHeatOf(s: DateSession): ReturnType<typeof groupHeat> {
  const g = group(s)
  return groupHeat(
    presentIds(s).map((id) => ({ character: g.members[id].world.character, trust: g.members[id].rel.trust })),
    s.world.settings.heat,
  )
}

// ---------------------------------------------------------------------------
// Requests (pure; exported for the debug panel and tests)

function venueNoteOf(venueId: string, at: number): string | null {
  if (venueId === 'home') return HOME_NOTE
  return dragNightNote(new Date(at), venueId)
}

/** The group story call for a turn: turn 0 opens the date; each character's judge result fills their LANDED line. */
export function groupStoryRequest(s: DateSession, opts: { turn: number }): ModelRequest {
  const g = group(s)
  const ids = presentIds(s)
  const names = s.world.names
  const notes: string[] = []
  const members = ids.map((id) => {
    const v = memberView(s, id)
    const judge = opts.turn > 0 ? lastPlayerJudge(v) : undefined
    const ctx = storyContext(v, { turn: opts.turn, ...(judge ? { judge } : {}) })
    notes.push(...(ctx.notes ?? []))
    return ctx
  })
  if (opts.turn === 0) {
    for (const id of ids) {
      const e = g.reveals?.[id]
      if (!e?.about) continue
      const who = names[id] ?? id
      const other = names[e.about] ?? e.about
      notes.push(`${who} realizes tonight that the player has been seeing ${other}, which breaks the exclusive agreement ${who} made with the player; it shows, one way or another`)
    }
  }
  const venue = venueById(s.record.venueId)
  const note = venueNoteOf(s.record.venueId, s.world.now())
  const ctx: GroupStoryContext = {
    members,
    heat: s.world.settings.heat,
    turn: opts.turn,
    maxTurns: s.record.maxTurns,
    venue: { name: venue?.name ?? s.record.venueId, ...(note ? { note } : {}) },
    between: groupBetween(s),
    turnNote: groupTurnNote({
      members: ids.map((id) => {
        const m = g.members[id]
        return { name: m.world.character.name, opener: m.world.character.opener, firstDate: (m.relBefore.dates ?? 0) === 0, leaving: m.leaving }
      }),
      departed: g.gone.map((id) => names[id] ?? id),
      turn: opts.turn,
      maxTurns: s.record.maxTurns,
      notes,
    }),
  }
  const giftId = s.record.giftId
  if (giftId && g.giftTo && ids.includes(g.giftTo)) {
    const m = g.members[g.giftTo]
    const c = m.world.character
    ctx.gift = { name: giftPhrase(giftId), to: g.giftTo, reaction: giftReactionFor(m.rel.gifts?.[giftId] ?? giftReaction(c, giftId)) }
  }
  const overrides = ids.map((id) => g.members[id].world.character.prompts?.story)
  const system = buildGroupStoryPrompt(ctx, overrides)
  return { system, messages: makeGroupStoryMessages(system, conversation(s.record.turns), groupTags(s), opts.turn === 0) }
}

/**
 * The judge's note for one character on a group date: who else is there, whose message it may be,
 * what the two are to each other and how this character feels about the player dating the other
 * (the same lines as the story's BETWEEN THEM), so jealousy, tension or support can move the meters.
 */
export function groupJudgeNote(s: DateSession, id: string): string {
  const g = group(s)
  const names = s.world.names
  const otherIds = g.ids.filter((x) => x !== id)
  const others = otherIds.map((x) => names[x] ?? x)
  const who = names[id] ?? id
  const parts = [
    `tonight is a group date and ${joinAnd(others)} is here too, so the player's message may be meant for ${joinAnd(others)}; score how it lands with ${who}`,
  ]
  if (otherIds.length) parts.push(noPeriod(historySentences(who, others[0], groupHistory(s)).join(' ')))
  for (const f of groupFeelings(s).filter((x) => x.id === id)) {
    parts.push(noPeriod(feelingPromptLine(f, names)))
    const other = names[f.other] ?? f.other
    if (f.route !== 'romantic') continue
    if (f.breaks || (f.otherRomantic && (f.jealousy === 'high' || f.jealousy === 'medium' || f.agreement === 'exclusive'))) {
      parts.push(`attention the player pays ${other} may sting ${who}: flirting with ${other} in front of ${who} can be a turn-off, and reassurance can land`)
    } else if (f.jealousy === 'compersion' || (f.otherRomantic && f.agreement === 'poly')) {
      parts.push(`${who} likes seeing the player get on with ${other}; including ${who} lands well, and there is no sting in it`)
    }
  }
  return parts.join('; ')
}

/** One judge call per character still on the date. */
export function groupJudgeRequests(s: DateSession, message: string, before: readonly DateTurn[]): { id: string; req: ModelRequest }[] {
  return presentIds(s).map((id) => ({ id, req: judgeRequest(memberView(s, id), message, before, { opinionNote: groupJudgeNote(s, id) }) }))
}

/**
 * Chips for the group, at the scene's heat: flirty and bold keys when either is on a romantic route
 * (curious and honest when both are friends), with a note naming each one's route and what is
 * between them, asking for a line to each by name and one to both.
 */
export function groupSuggestionsRequest(s: DateSession): ModelRequest & { keys: string[] } {
  const ids = presentIds(s)
  const g = group(s)
  const here = ids.length ? ids : [g.ids[0]]
  const romantic = here.filter((id) => routeOf(g.members[id].world) === 'romantic')
  const lead = g.members[romantic[0] ?? here[0]]
  const route: Route = romantic.length ? 'romantic' : 'friend'
  const names = here.map((id) => g.members[id].world.character.name)
  let system = buildSuggestionsPrompt(
    { character: { ...lead.world.character, name: joinAnd(names) }, rel: lead.rel, route, heat: groupHeatOf(s) },
    lead.world.character.prompts?.suggestions,
  )
  if (here.length >= 2) {
    const routes = here.map((id) => {
      const n = g.members[id].world.character.name
      return routeOf(g.members[id].world) === 'romantic'
        ? `${n} is on a romantic route`
        : `${n} is here as a friend, so lines to ${n} stay friendly and never flirt`
    })
    const firsts = here.map((id) => firstName(g.members[id].world.character.name))
    system = [
      system,
      '',
      `This is a group date. ${sentence(routes.join('; '))}`,
      `Between them:\n${groupBetween(s)}`,
      `Spread the three lines out: at least one to ${firsts[0]} by name, one to ${firsts[1]} by name, and one to both of them.${romantic.length && romantic.length < here.length ? ' The flirty and bold lines go only to someone on a romantic route.' : ''}`,
    ].join('\n')
  }
  return {
    system,
    messages: makeSuggestionsMessages(system, conversation(s.record.turns), { characterName: lead.world.character.name, names: s.world.names }),
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

/** Every character's relationship with the record (the store saves each with the record, in one transaction each). */
async function save(s: DateSession, hooks: DateHooks): Promise<void> {
  const g = group(s)
  for (const id of g.ids) {
    try {
      await hooks.persist(g.members[id].rel, s.record)
    } catch {
      // The store records storage failures and warns the player.
    }
  }
}

/** First names on the date, for notes: "Nova and Kai". */
function firstNames(s: DateSession, ids: readonly string[] = group(s).ids): string {
  const g = group(s)
  return joinAnd(ids.map((id) => firstName(g.members[id].world.character.name)))
}

function storyFailed(s: DateSession, err: unknown): DateSession {
  const detail = describeStoryError(err, s.world.settings)
  const turn: DateTurn = {
    role: 'system',
    text: `The reply from ${firstNames(s, presentIds(s))} didn't come through. ${detail}`.trim(),
    at: s.world.now(),
    notice: 'error',
  }
  return { ...s, status: 'awaiting-player', streaming: '', error: detail, record: { ...s.record, turns: [...withoutErrorNotices(s.record.turns), turn] } }
}

/**
 * Land the reply: split into per-character turns (speaker tags), what each said reveals about them
 * (detectTopics) and may unlock, the rumors the notes carried are said, and whoever was leaving is
 * now gone.
 */
export function landGroupReply(s: DateSession, result: { text: string; refused: boolean }, voiced: Record<string, readonly string[]> = {}): DateSession {
  const g = group(s)
  const ids = presentIds(s)
  const at = s.world.now()
  const text = String(result.text ?? '').trim()
  const turns = withoutErrorNotices(s.record.turns)
  const lead = ids[0] ?? g.ids[0]
  let lines: { speaker: string; text: string }[] = []
  if (result.refused) {
    turns.push({ role: 'character', speaker: lead, text: text || refusalBeat(firstNames(s, ids)), at })
    turns.push({ role: 'system', text: REFUSAL_NOTE, at, notice: 'refused' })
  } else {
    // Everyone on the date is a speaker, so a line the model still writes for someone who already
    // left is recognized, and dropped, instead of landing in the next character's turn.
    const speakers = g.ids.map((id) => ({ id, name: g.members[id].world.character.name }))
    lines = parseGroupReply(text, speakers, lead).filter((l) => ids.includes(l.speaker))
    if (!lines.length) lines = [{ speaker: lead, text }]
    for (const l of lines) turns.push({ role: 'character', speaker: l.speaker, text: l.text, at })
  }
  const { error: _error, ...rest } = s
  let out: DateSession = { ...rest, streaming: '', record: { ...s.record, turns } }
  for (const id of ids) {
    let m = memberView(out, id)
    const said = lines.filter((l) => l.speaker === id).map((l) => l.text).join('\n\n')
    let rel = m.rel
    let secrets: number[] = []
    if (said) {
      rel = applyTopics(rel, detectTopics(said, 'character'))
      const u = applyUnlocks(m.world.character, rel, routeOf(m.world))
      rel = u.rel
      secrets = u.secrets
    }
    const { slips: _slips, ...mrest } = m
    const slips = result.refused ? (m.slips ?? []) : (m.slips ?? []).filter((r) => !(voiced[id] ?? []).includes(r))
    m = passRumors({ ...mrest, rel, ...(slips.length ? { slips } : {}) }, secrets)
    out = putMember(out, id, m)
  }
  const now = group(out)
  const gone = [...new Set([...now.gone, ...ids.filter((id) => now.members[id].leaving)])]
  const goneAt = { ...now.goneAt }
  for (const id of gone) if (!now.gone.includes(id)) goneAt[id] = turns.length
  return sync({ ...out, group: { ...now, gone, ...(Object.keys(goneAt).length ? { goneAt } : {}) } })
}

async function replyStep(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  const turn = playerTurnCount(s0.record)
  const final = turn >= s0.record.maxTurns
  const req = groupStoryRequest(s0, { turn })
  const voiced: Record<string, string[]> = {}
  for (const id of presentIds(s0)) voiced[id] = [...(group(s0).members[id].slips ?? [])]
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

  s = landGroupReply(s, result, voiced)
  const over = presentIds(s).length === 0 || (final && turn > 0)
  if (!over) s = { ...s, status: aborted(hooks) ? 'awaiting-player' : 'suggesting' }
  await save(s, hooks)
  emit(s, hooks)
  if (over) return (await finishGroupDate(s, presentIds(s).length === 0 ? 'left' : 'completed', llm, hooks)).session
  if (aborted(hooks)) return { ...s, status: 'awaiting-player' }
  return suggestStep(s, llm, hooks)
}

async function suggestStep(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  if (!s0.world.settings.suggestions) {
    const s: DateSession = { ...s0, status: 'awaiting-player', suggestions: null }
    emit(s, hooks)
    return s
  }
  let s: DateSession = { ...s0, status: 'suggesting', suggestions: null }
  if (s0.status !== 'suggesting') emit(s, hooks)
  const req = groupSuggestionsRequest(s)
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
 * Start the group date: venue for each and the gift for the one it's for, the reveal (persisted),
 * then the opening beat and the chips. Only from 'opening'.
 */
export async function openGroupDate(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  if (s0.status !== 'opening' || s0.record.turns.length > 0) return s0
  const s = applyGroupReveal(applyGroupOpening(s0))
  emit(s, hooks)
  await save(s, hooks)
  if (aborted(hooks)) return { ...s, status: 'awaiting-player' }
  return replyStep(s, llm, hooks)
}

/**
 * The player's turn: append it (persisted), one judge call per character still there, in parallel
 * (neutral on failure), each applied with their own difficulty, gain cap and early exit (applyJudge
 * on their view), then one reply voicing both. Does nothing unless canSend(s). An abort before the
 * judges answer takes the message back.
 */
export async function sendGroupMessage(s0: DateSession, text: string, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  const message = String(text ?? '').trim()
  if (!message || s0.status !== 'awaiting-player' || s0.leaving || needsReply(s0) || playerTurnCount(s0.record) >= s0.record.maxTurns) {
    return s0
  }
  const before = s0.record.turns
  const playerTurn: DateTurn = { role: 'player', text: message, at: s0.world.now() }
  const { error: _error, ...rest } = s0
  let s: DateSession = { ...rest, status: 'judging', streaming: '', suggestions: null, record: { ...s0.record, turns: [...before, playerTurn] } }
  s = sync(s)
  emit(s, hooks)
  await save(s, hooks)
  const takeBack = async () => {
    await save(s0, hooks)
    return s0
  }
  if (aborted(hooks)) return takeBack()

  const g = group(s)
  const calls = groupJudgeRequests(s, message, before).map(async ({ id, req }) => {
    const c = g.members[id].world.character
    try {
      const r = await llm.judge({ ...req, signal: hooks.signal, characterId: id })
      return { id, judge: sanitizeJudge(c, r?.value) }
    } catch {
      return { id, judge: neutralJudge() }
    }
  })
  const results = await Promise.all(calls)
  if (aborted(hooks)) return takeBack()

  for (const { id, judge } of results) s = putMember(s, id, applyJudge(memberView(s, id), judge, message))
  emit(s, hooks)
  await save(s, hooks)
  return replyStep(s, llm, hooks)
}

/** Ask for the missing reply again (after a failed or stopped story call). */
export async function retryGroupReply(s0: DateSession, llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  if (!(s0.status === 'awaiting-player' && needsReply(s0))) return s0
  const { error: _error, ...rest } = s0
  return replyStep({ ...rest, record: { ...s0.record, turns: withoutErrorNotices(s0.record.turns) } }, llm, hooks)
}

// ---------------------------------------------------------------------------
// Finishing

function newsItem(id: string, at: number, text: string, characterIds: string[]): NewsItem {
  return { id: `metamour-${at.toString(36)}-${id}`, at, kind: 'metamour', text, characterIds, read: false }
}

/**
 * The world after a group date (with DateWorld.characters and .game): one date on the count (both
 * get it as their last date), rumors heard and relayed, gossip each was waiting to hear from the
 * player (the other on the date counts as brought up: they met), metamour approval (+5 per metamour
 * talked about under poly, and the pair's approval by how the date went), word of it spreading and
 * rekindle rolls (not for the pair).
 */
function settleGroupWorld(
  s: DateSession,
  rels0: Record<string, Relationship>,
  now: number,
  results: { id: string; affection: number; left: boolean }[],
): { rels: Record<string, Relationship>; world?: WorldUpdate } {
  const g = group(s)
  const w = g.members[g.ids[0]].world
  if (!w.characters || !w.game) return { rels: rels0 }
  const characters: Record<string, Character> = { ...w.characters }
  for (const id of g.ids) characters[id] = g.members[id].world.character
  const relations = w.setRelations ?? []
  let game: GameState = w.game
  const dateCount = (game.dateCount ?? 0) + 1
  game = { ...game, dateCount }
  let rels: Record<string, Relationship> = { ...(w.rels ?? {}) }
  for (const id of g.ids) rels[id] = { ...rels0[id], lastDateIndex: dateCount }
  const news: NewsItem[] = []

  const heard = g.ids.flatMap((id) => g.members[id].heard ?? [])
  if (heard.length || g.ids.some((id) => (g.members[id].relayed ?? []).length)) {
    let rumors = [...(game.rumors ?? []), ...heard]
    for (const id of g.ids) {
      const relayed = new Set(g.members[id].relayed ?? [])
      if (!relayed.size) continue
      rumors = rumors.map((h) => (relayed.has(h.rumorId) && !(h.relayedTo ?? []).includes(id) ? { ...h, relayedTo: [...(h.relayedTo ?? []), id] } : h))
    }
    game = { ...game, rumors }
  }
  for (const id of g.ids) {
    const m = g.members[id]
    const mentioned = [...new Set([...(m.mentioned ?? []), ...g.ids.filter((x) => x !== id)])]
    if ((rels[id].heardSecondhand ?? []).length) {
      const settled = settleSecondhand({ character: m.world.character, rel: rels[id], mentioned, rels, relations, game, now, rng: w.rng, names: w.names })
      rels = { ...rels, [id]: settled.rel }
      game = settled.game
    }
    if (rels[id].agreement?.type === 'poly') {
      for (const o of mentioned) game = adjustApproval(game, id, o, DISCLOSURE_APPROVAL, relations)
    }
  }
  const delta = groupApprovalDelta(results)
  if (delta && g.ids.length >= 2) {
    for (let i = 0; i < g.ids.length; i++) {
      for (let j = i + 1; j < g.ids.length; j++) game = adjustApproval(game, g.ids[i], g.ids[j], delta, relations)
    }
    const who = firstNames(s)
    const text = delta > 0 ? `${who} got on well tonight.` : `${who} didn't warm to each other tonight.`
    const item = newsItem(g.ids.join('-'), now, text, [...g.ids])
    news.push(item)
    game = { ...game, news: [...(game.news ?? []), item] }
  }

  const routeOfX = (x: string) => routeOfId(w, x)
  const after = afterDateWorld({
    datedIds: [...g.ids],
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
  const rk = rollRekindles({
    characters,
    rels,
    relations,
    game,
    now,
    rng: w.rng,
    names: w.names,
    exclude: [...g.ids],
    ...(w.setOf ? { setOf: w.setOf } : {}),
  })
  rels = rk.rels
  game = rk.game
  news.push(...rk.news)
  return { rels, world: { rels, game, news, betrayals: after.betrayals } }
}

/**
 * End the group date: a memory for each (in parallel, compressed past ~250 words), +1 date each,
 * +1 trust for each who stayed to the end of a completed date, metamour trust under poly, the
 * world (settleGroupWorld), a recap per character (a character who walked out is marked `left`),
 * then one save with everything (hooks.persistAll: the first character's relationship, the others
 * with the rest of the world). `reason` as finishDate's; the date is 'left' only when everyone left.
 */
export async function finishGroupDate(
  s0: DateSession,
  reason: 'completed' | 'left' | 'ended',
  llm: DateLlm,
  hooks: DateHooks,
): Promise<{ session: DateSession; recap: DateRecap; world?: WorldUpdate }> {
  if (s0.status === 'ended' && s0.record.recap) {
    return { session: s0, recap: s0.record.recap, ...(s0.worldAfter ? { world: s0.worldAfter } : {}) }
  }
  const g0 = group(s0)
  const everyoneLeft = g0.ids.every((id) => g0.gone.includes(id) || g0.members[id].leaving)
  const outcome = everyoneLeft ? 'left' : reason === 'left' ? 'ended' : reason
  let s: DateSession = { ...s0, status: 'closing', streaming: '', suggestions: null }
  emit(s, hooks)

  const names = s.world.names
  const g = group(s)
  const venueName = venueById(s.record.venueId)?.name ?? s.record.venueId
  const summaries = await Promise.all(
    g.ids.map(async (id) => {
      // Someone who walked out remembers the date up to when they left.
      const cut = g.goneAt?.[id]
      const said = conversation(cut != null ? s.record.turns.slice(0, cut) : s.record.turns)
      if (!said.some((t) => t.role === 'player') || aborted(hooks)) return ''
      const c = g.members[id].world.character
      const req = memoryRequest(c, said, {
        characterName: c.name,
        names,
        playerLabel: s.world.profile.name?.trim() || 'Player',
        venue: venueName,
        ...(s.record.giftId && g.giftTo === id ? { gift: giftPhrase(s.record.giftId) } : {}),
      })
      try {
        return cleanSummary(await llm.memory({ ...req, signal: hooks.signal, characterId: id }))
      } catch {
        return ''
      }
    }),
  )

  const now = s.world.now()
  const rels: Record<string, Relationship> = {}
  const trustMoved: Record<string, number> = {}
  for (let i = 0; i < g.ids.length; i++) {
    const id = g.ids[i]
    const m = g.members[id]
    const c = m.world.character
    let memory = appendMemory(m.rel.memory ?? [], summaries[i])
    if (needsCompression(memory) && !aborted(hooks)) {
      try {
        memory = applyCompression(memory, await llm.memory({ ...compressionRequest(c, memory), signal: hooks.signal, characterId: id }))
      } catch {
        // Kept uncompressed; the next date tries again.
      }
    }
    const left = g.gone.includes(id) || m.leaving
    const own = left ? 'left' : outcome
    let rel: Relationship = { ...m.rel, memory, dates: (m.rel.dates ?? 0) + 1, lastDateAt: now }
    // They were there: each saw the player out with the other (so it's never news later, alreadyCounted)
    // and, on a romantic route with the other, knows the player has been out with them.
    const met: Record<string, number> = { ...rel.metOnGroupDate }
    for (const y of g.ids) {
      if (y === id) continue
      met[y] = now
      if (routeOfId(m.world, y) === 'romantic' && !(rel.knownOthers ?? []).includes(y)) rel = { ...rel, knownOthers: [...(rel.knownOthers ?? []), y] }
      if ((rel.heardSecondhand ?? []).includes(y)) rel = { ...rel, heardSecondhand: (rel.heardSecondhand ?? []).filter((z) => z !== y) }
    }
    rel = { ...rel, metOnGroupDate: met }
    const consistency = consistencyTrust(rel, own, c)
    rel = consistency.rel
    let moved = consistency.applied
    if (own === 'completed' && m.world.game) {
      const d = metamourTrust(m.world.game, id, rel, m.world.setRelations ?? [])
      if (d) {
        const before = clampTrust(rel.trust)
        rel = applyTrustDelta(rel, d, c)
        moved += clampTrust(rel.trust) - before
      }
    }
    const unlocked = applyUnlocks(c, rel, routeOf(m.world))
    rel = unlocked.rel
    if (unlocked.secrets.length && (m.world.rumors ?? []).some((r) => r.teller === id)) {
      rel = { ...rel, rumorRollsOwed: (rel.rumorRollsOwed ?? 0) + unlocked.secrets.length }
    }
    rels[id] = rel
    trustMoved[id] = moved
  }

  const results = g.ids.map((id) => ({
    id,
    affection: totalsOf(s.record, id).affection,
    left: g.gone.includes(id) || g.members[id].leaving,
  }))
  const settled = settleGroupWorld(s, rels, now, results)
  const allRels = settled.rels
  const lead = g.members[g.ids[0]].world
  const count = settled.world?.game.dateCount ?? lead.game?.dateCount
  for (const id of g.ids) {
    const m = g.members[id]
    let rel = forgive(m.world.character, allRels[id] ?? rels[id], now)
    const route = routeOf(m.world)
    const seen = allRels && Object.keys(allRels).length ? seenIn(allRels, (x) => routeOfId(m.world, x), count, rel) : undefined
    const jealous = isJealous(m.world.character, rel, { route, ...(seen ? { seen } : {}) })
    if (jealous !== !!rel.jealous && !(rel.betrayals ?? []).some((b) => b.at >= s.record.startedAt && b.about)) rel = { ...rel, jealous }
    rels[id] = rel
  }
  const world = settled.world ? { ...settled.world, rels: { ...settled.world.rels, ...rels } } : undefined

  const totals = { ...s.record.totals }
  for (const id of g.ids) totals[id] = addTrust(totalsOf(s.record, id), trustMoved[id] ?? 0)
  const ended: DateRecord = { ...s.record, endedAt: now, outcome, totals }
  const recap: DateRecap = { perCharacter: {} }
  const heardAll = g.ids.flatMap((id) => (g.members[id].heard ?? []).map((h) => h.rumorId))
  g.ids.forEach((id, i) => {
    const m = g.members[id]
    const own: DateRecord = g.giftTo === id ? ended : { ...ended, giftId: undefined }
    if (!own.giftId) delete own.giftId
    const r = characterRecap(m.relBefore, rels[id], own, m.world.character, routeOf(m.world), {
      memory: summaries[i],
      ...(i === 0 && heardAll.length ? { rumors: heardAll } : {}),
    })
    r.left = g.gone.includes(id) || m.leaving
    recap.perCharacter[id] = r
  })
  if (world && (world.news.length > 0 || world.betrayals.length > 0)) recap.world = { news: world.news, betrayals: world.betrayals }

  const members: Record<string, DateSession> = {}
  for (const id of g.ids) members[id] = { ...g.members[id], rel: rels[id] }
  s = sync({ ...s, status: 'ended', record: { ...ended, recap }, group: { ...g, members }, ...(world ? { worldAfter: world } : {}) })

  const lead0 = g.ids[0]
  if (world && hooks.persistAll) {
    const before = lead.rels ?? {}
    const others = Object.keys(world.rels)
      .filter((x) => x !== lead0 && (g.ids.includes(x) || world.rels[x] !== before[x]))
      .sort()
      .map((x) => world.rels[x])
    try {
      await hooks.persistAll(rels[lead0], s.record, others, world.game)
    } catch {
      // The store reports storage problems itself.
    }
  } else {
    if (world && hooks.persistWorld) {
      const before = lead.rels ?? {}
      const others = Object.keys(world.rels)
        .filter((x) => !g.ids.includes(x) && world.rels[x] !== before[x])
        .map((x) => world.rels[x])
      try {
        await hooks.persistWorld(others, world.game)
      } catch {
        // The store reports storage problems itself.
      }
    }
    await save(s, hooks)
  }
  emit(s, hooks)
  return { session: s, recap: s.record.recap!, ...(world ? { world } : {}) }
}
