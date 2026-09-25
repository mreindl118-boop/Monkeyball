// Agreements, jealousy and betrayal (docs/SPEC.md, "Affection & Trust": relationship styles,
// agreements, betrayal, recovery; ARCHITECTURE, Engine, agreements.ts). Pure: no React, no Dexie.
//
// Seeing several people is not betrayal; breaking an agreement or lying is:
// - no agreement, casual, or open without disclosure terms: the character can know about anyone and
//   nothing is broken (they may still mind, which is jealousy, not betrayal);
// - exclusive: any other person dated after the agreement was made is a betrayal, however they find
//   out (hearing it from the player is honest, so it lands a little softer);
// - poly, and open with terms about telling or knowing: disclosure is expected, so hearing it from
//   the player (or meeting them on a group date) is fine; gossip that gets there first only adds
//   to what they know (heardSecondhand), and it's a smaller betrayal when their next date ends
//   without the player bringing that person up (dateFlow settleWorld);
// - a lie the judge catches (breach) is a betrayal of its own; owning up to breaking an exclusive
//   agreement without a name is the softer confession (confessionBetrayal).
// Who counts as "seeing" lapses after SEEING_WINDOW dates with other people (seeing, stillRecent),
// and people the player no longer sees drop out of what a character "knows you're seeing".
// Severity is scaled by the character's jealousy inside the spec's ranges: affection -10 to -20,
// trust -15 to -30, so a betrayal always costs more trust than affection.

import { defaultOpinion, noPeriod, sentence } from '../prompts/build'
import type {
  Agreement,
  AgreementResult,
  AgreementType,
  BetrayalEvent,
  BetrayalHow,
  Character,
  Jealousy,
  Relationship,
  Route,
} from '../types'
import { clamp100 } from './math'
import { joinAnd } from './stages'
import { applyTrustDelta } from './trust'

// ---------------------------------------------------------------------------
// Who the player is seeing

/** Affection at which a romantic-route character counts as someone the player is seeing. */
export const SEEING_AFFECTION = 20

/**
 * "Seeing" lapses: once the player has finished this many dates since their last date with
 * someone (GameState.dateCount against Relationship.lastDateIndex), they no longer count.
 */
export const SEEING_WINDOW = 6

/**
 * Their last date is recent enough to still count as seeing them: fewer than SEEING_WINDOW dates
 * finished since. Without a count (older saves, tests) it never lapses; a relationship from before
 * the count existed reads as index 0.
 */
export function stillRecent(rel: Pick<Relationship, 'lastDateIndex'> | undefined, dateCount?: number): boolean {
  if (dateCount == null || !Number.isFinite(dateCount)) return true
  const idx = rel && Number.isFinite(rel.lastDateIndex) ? (rel.lastDateIndex as number) : 0
  return dateCount - idx < SEEING_WINDOW
}

/**
 * The player is seeing this character: romantic route, at least one date, affection 20 or more,
 * and (given the game's date count) a date recent enough (stillRecent).
 */
export function seeing(rel: Relationship | undefined, route: Route, dateCount?: number): boolean {
  return (
    !!rel &&
    route === 'romantic' &&
    (rel.dates ?? 0) >= 1 &&
    (rel.affection ?? 0) >= SEEING_AFFECTION &&
    stillRecent(rel, dateCount)
  )
}

/** Everyone the player is seeing except `exceptId`, sorted by id (the judge's {others}). */
export function othersSeen(
  rels: Readonly<Record<string, Relationship>>,
  routeOf: (id: string) => Route,
  exceptId: string,
  dateCount?: number,
): string[] {
  return Object.keys(rels)
    .filter((id) => id !== exceptId && seeing(rels[id], routeOf(id), dateCount))
    .sort()
}

/**
 * The player has been out with them lately: romantic route, a date, recent enough (stillRecent),
 * whatever the affection. What a character "knows you're seeing" lapses on this, not on seeing()'s
 * affection line: a date that went badly is still a date they heard about.
 */
export function recentlyDated(rel: Relationship | undefined, route: Route, dateCount?: number): boolean {
  return !!rel && route === 'romantic' && (rel.dates ?? 0) >= 1 && stillRecent(rel, dateCount)
}

/**
 * A predicate "the player is still going out with this id" (recentlyDated), for the helpers below
 * that take `seen`: people who lapsed drop out of what a character knows you're seeing. With the
 * observer's relationship, under an exclusive agreement only people dated since it count, so
 * someone the player saw before promising isn't talked about as someone they're seeing now.
 */
export function seenIn(
  rels: Readonly<Record<string, Relationship>>,
  routeOf: (id: string) => Route,
  dateCount?: number,
  observer?: Pick<Relationship, 'agreement'>,
): (id: string) => boolean {
  const exclusive = observer?.agreement?.type === 'exclusive'
  return (id) => recentlyDated(rels[id], routeOf(id), dateCount) && (!exclusive || datedSinceAgreement(observer!, rels[id]))
}

/** Optional context for what a character knows: who the player is still seeing, and their route. */
export interface KnowsOptions {
  /** The player is still seeing this id (lapsed people drop out of what they "know you're seeing"). */
  seen?: (id: string) => boolean
  /** Their route: a friend never minds who else you see. */
  route?: Route
}

/** The partner they got back together with in a rekindle, if any. */
export function rekindledPartner(rel: Pick<Relationship, 'rekindle' | 'rekindledWith'>): string | undefined {
  return rel.rekindle?.with || rel.rekindledWith || undefined
}

/**
 * The people they know the player is seeing, as it stands: their knownOthers without themselves,
 * without anyone the player no longer sees (opts.seen), and without the partner they rekindled with
 * unless `keepRekindled`.
 */
export function knownSeen(
  c: Pick<Character, 'id'>,
  rel: Pick<Relationship, 'knownOthers' | 'rekindle' | 'rekindledWith'>,
  opts: KnowsOptions & { keepRekindled?: boolean } = {},
): string[] {
  const partner = rekindledPartner(rel)
  return (rel.knownOthers ?? []).filter(
    (id) => !!id && id !== c.id && (opts.keepRekindled || id !== partner) && (!opts.seen || id === partner || opts.seen(id)),
  )
}

// ---------------------------------------------------------------------------
// Agreements

/** Words in open-agreement terms that ask to be told: tell, know, disclose, heads-up, in the loop... */
const DISCLOSURE_WORDS =
  /\b(?:tell|tells|telling|told|know|knows|knowing|disclos\w*|heads[- ]up|in the loop|keep (?:me|each other|us) posted|hear about|hear it from|report|check (?:in|with)|ask first|say so|let (?:me|each other|us) know|no secrets|honest|upfront|up front|transparen\w*)\b/i

/** A negation before the disclosure words in the same clause: "don't need to know", "no need to tell". */
const NEGATED_DISCLOSURE =
  /\b(?:don'?t|do not|doesn'?t|does not|no need to|never|without|not|nor|no)\b(?:\s+\w+){0,3}?\s+(?:tell|tells|telling|told|know|knows|knowing|disclos\w*|report|hear|ask)\b/i

/**
 * Disclosure is part of the deal: always for poly; for open only when the terms ask to be told
 * ("open, but tell me before anything happens"). "Don't ask, don't tell" and "I don't need to know"
 * don't count. Other agreements: never (exclusive has nothing to disclose, it's just broken).
 */
export function disclosureRequired(a: Agreement | undefined): boolean {
  if (!a) return false
  if (a.type === 'poly') return true
  if (a.type !== 'open') return false
  const clauses = String(a.terms ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .split(/[,.;:!?]|\bbut\b|\band\b|\bexcept\b/)
  return clauses.some((clause) => DISCLOSURE_WORDS.test(clause) && !NEGATED_DISCLOSURE.test(clause))
}

/** Agreement types that make seeing others a breach no matter how it comes out. */
function forbidsOthers(a: Agreement | undefined): boolean {
  return a?.type === 'exclusive'
}

/**
 * The character knows about someone else the player is seeing and minds it: jealousy medium or
 * high, or low with an exclusive agreement. Compersion never minds, a friend-route character
 * (opts.route) never minds, and nobody minds the partner they rekindled with or someone the player
 * no longer sees (opts.seen). This is the hub's jealousy mark.
 */
export function isJealous(c: Pick<Character, 'jealousy' | 'id'>, rel: Relationship, opts: KnowsOptions = {}): boolean {
  if (opts.route === 'friend') return false
  const known = knownSeen(c, rel, opts)
  if (known.length === 0 || c.jealousy === 'compersion') return false
  if (c.jealousy === 'medium' || c.jealousy === 'high') return true
  return rel.agreement?.type === 'exclusive'
}

/** Trust at which a betrayal counts as worked through (the jealousy mark lifts; Reconciliation). */
export const RECONCILED_TRUST = 60

/** A betrayal is still raw: there was one and trust is under 60 since. */
export function betrayalRaw(rel: Pick<Relationship, 'betrayals' | 'trust'>): boolean {
  return (rel.betrayals ?? []).length > 0 && (rel.trust ?? 0) < RECONCILED_TRUST
}

/**
 * Any tension at all: they know about someone and mind (isJealous), or a betrayal is still raw
 * (trust under 60 since). The map's lipstick threads; the hub's mark is isJealous alone.
 */
export function jealousNow(c: Pick<Character, 'jealousy' | 'id'>, rel: Relationship, opts: KnowsOptions = {}): boolean {
  return isJealous(c, rel, opts) || betrayalRaw(rel)
}

// ---------------------------------------------------------------------------
// Names

/** The name people use day to day: a quoted nickname ('Roxanne "Rox" Delacroix'), else the first word. */
export function firstName(name: string): string {
  const s = String(name ?? '').trim()
  const nick = /["“]([^"”]+)["”]/.exec(s)
  if (nick) return nick[1].trim()
  return s.split(/\s+/)[0] ?? s
}

function nameOf(id: string, names: Record<string, string> | undefined): string {
  const n = names?.[id]?.trim()
  if (n) return n
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : 'someone'
}

// ---------------------------------------------------------------------------
// Opinion (the judge's {opinion})

function betrayalPhrase(e: BetrayalEvent, rel: Relationship, names: Record<string, string> | undefined): string {
  if (e.kind === 'lie') return "caught the player in a lie and hasn't let it go"
  const who = e.about ? nameOf(e.about, names) : ''
  const current = rel.agreement?.type ?? 'none'
  if (e.agreement && e.agreement !== current) {
    return `hasn't got over ${who ? `${who} breaking` : 'the player breaking'} the ${e.agreement} agreement they had`
  }
  if (e.agreement === 'exclusive') {
    if (!who) return 'thinks we agreed to be exclusive, and the player admitted breaking it'
    return e.how === 'player'
      ? `thinks we agreed to be exclusive, and heard about ${who} from the player; it breaks that agreement`
      : `thinks we agreed to be exclusive and just heard about ${who}; it breaks that agreement`
  }
  return `we agreed to tell each other about other people, and heard about ${who || 'someone'} from someone else instead`
}

/** What a rekindle means for where they stand, for the judge's {opinion}. */
function rekindlePhrase(c: Character, rel: Relationship, names: Record<string, string> | undefined): string {
  const r = rel.rekindle ?? (rel.rekindledWith ? { with: rel.rekindledWith, invite: false } : undefined)
  if (!r?.with) return ''
  const who = nameOf(r.with, names)
  return r.invite
    ? `got close again with ${who} lately, and they'd like the player to join them`
    : `got back together with ${who} lately, and ${c.name} is gently closing the door on the player`
}

/** People they heard about secondhand and are waiting for the player to bring up. */
function secondhand(c: Character, rel: Relationship, opts: KnowsOptions): string[] {
  if (!disclosureRequired(rel.agreement)) return []
  return (rel.heardSecondhand ?? []).filter((id) => id && id !== c.id && (!opts.seen || opts.seen(id)))
}

/**
 * The judge's {opinion}: where this character thinks the two of them stand. The agreement and who
 * they know about (as defaultOpinion words it; people the player no longer sees drop out), sharpened
 * by the last betrayal while trust is still under 60 ("thinks we agreed to be exclusive and just
 * heard about Kai Okoro; it breaks that agreement"), by a betrayal they have worked through, by
 * gossip they're waiting for the player to confirm, and by a rekindle.
 */
export function opinionText(c: Character, rel: Relationship, names: Record<string, string>, opts: KnowsOptions = {}): string {
  const betrayals = rel.betrayals ?? []
  const last = betrayals[betrayals.length - 1]
  const parts: string[] = []
  if (last && (rel.trust ?? 0) < RECONCILED_TRUST) {
    const minds = c.jealousy === 'high' ? 'still stings badly' : c.jealousy === 'compersion' ? 'trying to let it go' : 'still hurts'
    parts.push(`${betrayalPhrase(last, rel, names)}; ${minds}`)
  } else {
    parts.push(defaultOpinion(c, rel, names, knownSeen(c, rel, opts)))
    if (last) parts.push('there was a betrayal once, and trust has been rebuilt since')
  }
  const waiting = secondhand(c, rel, opts)
  if (waiting.length) {
    parts.push(`heard about ${joinAnd(waiting.map((id) => nameOf(id, names)))} from someone else, and is waiting to see if the player brings it up`)
  }
  const rk = rekindlePhrase(c, rel, names)
  if (rk) parts.push(rk)
  return parts.join('; ')
}

// ---------------------------------------------------------------------------
// Define the relationship

/** Affection at which either side can open Define the relationship (Friend). */
export const DTR_AFFECTION = 40

/**
 * Define the relationship is on offer from Friend stage (affection 40+) on a romantic route. A
 * friend-route character never asks, and an agreement with a friend would make later gossip a
 * betrayal from a friend, so the talk isn't offered there.
 */
export function dtrAvailable(rel: Relationship, route: Route): boolean {
  return route === 'romantic' && (rel.affection ?? 0) >= DTR_AFFECTION
}

/** The chance a character who could ask does ask, at date start. */
export const DTR_WISH_CHANCE = 0.25

/** What a character would ask for, by style and jealousy. */
export function wantedAgreement(c: Pick<Character, 'relationshipStyle' | 'jealousy'>): AgreementType {
  switch (c.relationshipStyle) {
    case 'monogamous':
      return 'exclusive'
    case 'polyamorous':
      return 'poly'
    case 'open':
      return 'open'
    default:
      return c.jealousy === 'high' || c.jealousy === 'medium' ? 'exclusive' : 'casual'
  }
}

/**
 * At date start, a character may want to define the relationship themselves: Friend or above,
 * trust 50+, three dates or more, no agreement yet, then a 25% roll. Returns what they'd want, or
 * null. The roll is only made when they could ask, so the random source isn't touched otherwise.
 * A friend-route character (optional `route`) never asks.
 */
export function characterDtrWish(
  c: Character,
  rel: Relationship,
  rng: () => number,
  route?: Route,
): AgreementType | null {
  if (route === 'friend') return null
  if ((rel.affection ?? 0) < DTR_AFFECTION) return null
  if ((rel.trust ?? 0) < 50) return null
  if ((rel.dates ?? 0) < 3) return null
  if ((rel.agreement?.type ?? 'none') !== 'none') return null
  return rng() < DTR_WISH_CHANCE ? wantedAgreement(c) : null
}

/**
 * Apply the Agreement prompt's answer: its trustDelta always (how the talk went; positive gains
 * slowed by a grudge when `c` is given), and, when accepted, the new agreement. A new type starts
 * the clock (madeAt = now); the same type again only updates the terms, so re-agreeing can't wipe
 * what happened since it was first made. A declined talk leaves the agreement as it was.
 */
export function applyAgreementResult(
  rel: Relationship,
  r: AgreementResult,
  now: number,
  c?: Character,
): Relationship {
  let out = rel
  const delta = Number.isFinite(r.trustDelta) ? Math.trunc(r.trustDelta) : 0
  if (delta) {
    out = c ? applyTrustDelta(out, delta, c) : { ...out, trust: clamp100((out.trust ?? 0) + delta) }
  }
  if (r.accepted && r.agreement !== 'none') {
    const before = out.agreement ?? { type: 'none', terms: '', madeAt: 0 }
    const terms = String(r.terms ?? '').trim()
    const madeAt = before.type === r.agreement && before.madeAt ? before.madeAt : now
    out = { ...out, agreement: { type: r.agreement, terms, madeAt } }
  }
  return out
}

// ---------------------------------------------------------------------------
// Betrayal

/** Base severity by jealousy (0 mildest, 1 worst): scales within the spec's ranges. */
export const JEALOUSY_SEVERITY: Readonly<Record<Jealousy, number>> = {
  compersion: 0,
  low: 0.35,
  medium: 0.65,
  high: 1,
}

/** Spec ranges: affection -10 to -20, trust -15 to -30. */
export const BETRAYAL_AFFECTION: readonly [number, number] = [-10, -20]
export const BETRAYAL_TRUST: readonly [number, number] = [-15, -30]

/** Deltas for a severity from 0 to 1. Trust always drops more than affection. */
export function betrayalDeltas(severity: number): { affectionDelta: number; trustDelta: number } {
  const s = Math.min(1, Math.max(0, Number.isFinite(severity) ? severity : 0))
  return {
    affectionDelta: Math.round(BETRAYAL_AFFECTION[0] + (BETRAYAL_AFFECTION[1] - BETRAYAL_AFFECTION[0]) * s),
    trustDelta: Math.round(BETRAYAL_TRUST[0] + (BETRAYAL_TRUST[1] - BETRAYAL_TRUST[0]) * s),
  }
}

const FEELING: Readonly<Record<Jealousy, string>> = {
  compersion: "I want to be happy for us anyway, and today I can't quite get there.",
  low: "I'm trying to be cool about it, and I'm not.",
  medium: "I don't know what to do with that yet.",
  high: 'I keep replaying it, and it gets worse every time.',
}

/** The memory line in the character's own voice. */
function betrayalMemory(c: Character, kind: 'agreement' | 'lie', how: BetrayalHow, agreement: AgreementType, other: string): string {
  const feeling = FEELING[c.jealousy] ?? FEELING.medium
  if (kind === 'lie') return `I caught a lie on our date, and I can't stop turning it over. ${feeling}`
  if (agreement === 'exclusive') {
    if (how === 'player') return `We agreed to be exclusive, and then I heard about ${other}, straight from the source. At least it wasn't secondhand. ${feeling}`
    if (how === 'group') return `We agreed to be exclusive, and then ${other} was right there with us. ${feeling}`
    return `We agreed to be exclusive, and I had to hear about ${other} from someone else. ${feeling}`
  }
  return `We said we'd tell each other about other people, and I heard about ${other} from someone else instead. ${feeling}`
}

/** A short note for the profile, the recap and the news. */
function betrayalNote(kind: 'agreement' | 'lie', how: BetrayalHow, agreement: AgreementType, other: string): string {
  if (kind === 'lie') return 'Caught you in a lie.'
  if (agreement === 'exclusive') {
    if (how === 'player') return `Heard about ${other} from you after you agreed to be exclusive.`
    if (how === 'group') return `Met ${other} on a group date after you agreed to be exclusive.`
    return `Heard about ${other} through the grapevine after you agreed to be exclusive.`
  }
  return `Heard about ${other} from someone else, and you never brought it up, though your ${agreement} agreement expects you to say so.`
}

/** The other person was dated after this agreement was made. */
export function datedSinceAgreement(rel: Pick<Relationship, 'agreement'>, otherRel: Relationship | undefined): boolean {
  return !!otherRel && (otherRel.dates ?? 0) > 0 && (otherRel.lastDateAt ?? 0) > (rel.agreement?.madeAt ?? 0)
}

/** True when a betrayal about `about` was already counted since that person's last date. */
export function alreadyCounted(rel: Pick<Relationship, 'betrayals'>, about: string, otherRel: Relationship | undefined): boolean {
  const since = otherRel?.lastDateAt ?? 0
  return (rel.betrayals ?? []).some((b) => b.kind === 'agreement' && b.about === about && b.at >= since)
}

export interface BetrayalOptions {
  /** Display names by character id (the note and the memory line use the other person's first name). */
  names?: Record<string, string>
  /** The player's name, for a confession's memory line. */
  player?: string
}

/**
 * Does learning this make it a betrayal? `observer` learns about `learnedAbout` (someone the player
 * sees; `otherRel` is the player's relationship with them) through `how`:
 * - 'lie': the judge caught a lie (breach): always a betrayal of kind 'lie', a bit worse than the
 *   jealousy alone would make it.
 * - exclusive: a betrayal when the player went out with them after the agreement was made (a
 *   later date than any betrayal about them already counted); hearing it from the player softens it.
 * - poly, or open with disclosure terms: a smaller betrayal, only when it comes through gossip that
 *   the player never confirmed (the date flow checks at the end of the observer's next date), and
 *   only for a date after the agreement. Someone they already heard about from the player, or
 *   met on a group date, is disclosure, not betrayal.
 * - no agreement, casual, open without disclosure terms: never.
 * `rng` adds a little variation (at most 0.05 severity either way). Returns null when nothing broke.
 */
export function checkBetrayal(
  observer: Character,
  rel: Relationship,
  learnedAbout: string,
  how: BetrayalHow,
  otherRel: Relationship | undefined,
  now: number,
  rng: () => number,
  opts: BetrayalOptions = {},
): BetrayalEvent | null {
  const agreement = rel.agreement ?? { type: 'none', terms: '', madeAt: 0 }
  const base = JEALOUSY_SEVERITY[observer.jealousy] ?? JEALOUSY_SEVERITY.medium
  const jitter = () => (rng() - 0.5) * 0.1
  const other = learnedAbout ? firstName(nameOf(learnedAbout, opts.names)) : ''

  let kind: 'agreement' | 'lie'
  let severity: number
  if (how === 'lie') {
    kind = 'lie'
    severity = base + 0.1
  } else {
    if (!learnedAbout || learnedAbout === observer.id || !otherRel) return null
    if (!datedSinceAgreement(rel, otherRel) || alreadyCounted(rel, learnedAbout, otherRel)) return null
    kind = 'agreement'
    if (forbidsOthers(agreement)) {
      severity = how === 'gossip' ? base + 0.15 : how === 'player' ? base - 0.25 : base
    } else if (disclosureRequired(agreement)) {
      if (how !== 'gossip') return null
      // Heard it from the player before: they already know, and that was the disclosure.
      const known = (rel.knownOthers ?? []).includes(learnedAbout)
      const secondhandOnly = (rel.heardSecondhand ?? []).includes(learnedAbout)
      if (known && !secondhandOnly) return null
      severity = base * 0.5
    } else {
      return null
    }
  }
  const { affectionDelta, trustDelta } = betrayalDeltas(severity + jitter())
  const event: BetrayalEvent = {
    at: now,
    kind,
    note: betrayalNote(kind, how, agreement.type, other),
    affectionDelta,
    trustDelta,
    how,
    memory: betrayalMemory(observer, kind, how, agreement.type, other),
  }
  if (kind === 'agreement') event.about = learnedAbout
  if (agreement.type !== 'none') event.agreement = agreement.type
  return event
}

/**
 * The player owns up to breaking an exclusive agreement without naming anyone ("I slept with
 * someone at the after-party. I'm sorry."): a betrayal, but the softer one of hearing it from the
 * player. Null unless the agreement is exclusive.
 */
export function confessionBetrayal(
  observer: Character,
  rel: Relationship,
  now: number,
  rng: () => number,
  opts: BetrayalOptions = {},
): BetrayalEvent | null {
  if (!forbidsOthers(rel.agreement)) return null
  const base = JEALOUSY_SEVERITY[observer.jealousy] ?? JEALOUSY_SEVERITY.medium
  const { affectionDelta, trustDelta } = betrayalDeltas(base - 0.25 + (rng() - 0.5) * 0.1)
  const who = opts.player?.trim()
  const feeling = FEELING[observer.jealousy] ?? FEELING.medium
  return {
    at: now,
    kind: 'agreement',
    note: 'Heard it from you: you broke the exclusive agreement.',
    affectionDelta,
    trustDelta,
    how: 'player',
    agreement: 'exclusive',
    memory: `${who ? `${who} told me` : 'I heard it'} to my face that it happened. At least it wasn't secondhand. ${feeling}`,
  }
}

// ---------------------------------------------------------------------------
// Honesty (the date flow reads a judge breach through these)

/** A denial: "I swear", "nothing happened", "I was home", "no one else", "I haven't seen them". */
const DENIAL =
  /\b(?:i swear|swear to (?:god|you)|nothing happened|nothing's going on|nothing is going on|i was (?:home|at home|alone|working|asleep)|no one else|nobody else|there'?s no one|there is no one|haven'?t seen|have not seen|never (?:even )?(?:looked|saw|seen|touched|kissed|slept|met|went)|didn'?t (?:see|do|go|sleep|kiss|touch|meet)|wasn'?t with|was not with|i would never|i'd never|that'?s not true|it'?s not true|that never happened|not seeing anyone|i'?m not seeing|made that up|just (?:a )?friends?)\b/i

/** An admission: owning up, apologising, "to be honest", "the truth is", "I slept with". */
const ADMISSION =
  /\b(?:i have to tell you|i need to tell you|i should tell you|i want(?:ed)? you to (?:know|hear)|i'?m sorry|i am sorry|i apologi[sz]e|i owe you|i slept with|i kissed|i went out with|i hooked up|to be honest|honestly|the truth is|truth be told|i messed up|i screwed up|i confess|i admit|you heard right|it'?s true|that'?s true|i did)\b/i

function plain(text: string): string {
  return String(text ?? '').replace(/[‘’ʼ`]/g, "'")
}

/** The message reads as denying something. */
export function readsAsDenial(message: string): boolean {
  return DENIAL.test(plain(message))
}

/** The message reads as owning up to something (and not denying it). */
export function readsAsAdmission(message: string): boolean {
  const text = plain(message)
  return ADMISSION.test(text) && !DENIAL.test(text)
}

/**
 * Record a betrayal without moving the meters (the date flow counts its deltas on the date's
 * ledger): the event, the memory line, the person they now know about (no longer only secondhand),
 * and the jealousy mark when someone else is involved (a lie about nobody doesn't make them jealous).
 */
export function recordBetrayal(rel: Relationship, e: BetrayalEvent): Relationship {
  const knownOthers =
    e.about && !(rel.knownOthers ?? []).includes(e.about) ? [...(rel.knownOthers ?? []), e.about] : rel.knownOthers ?? []
  const line = String(e.memory ?? '').trim()
  const out: Relationship = {
    ...rel,
    betrayals: [...(rel.betrayals ?? []), e],
    memory: line ? [...(rel.memory ?? []), line] : [...(rel.memory ?? [])],
    knownOthers,
    jealous: e.about ? true : !!rel.jealous,
  }
  if (e.about && (rel.heardSecondhand ?? []).includes(e.about)) {
    out.heardSecondhand = (rel.heardSecondhand ?? []).filter((id) => id !== e.about)
  }
  return out
}

/**
 * Apply a betrayal between dates: affection and trust drop by the event's deltas (affection drops
 * but isn't reset), then recordBetrayal (the event, the memory line in their voice, jealousy).
 */
export function applyBetrayal(rel: Relationship, e: BetrayalEvent): Relationship {
  const moved: Relationship = {
    ...rel,
    affection: clamp100((rel.affection ?? 0) + (Number.isFinite(e.affectionDelta) ? e.affectionDelta : 0)),
    trust: clamp100((rel.trust ?? 0) + (Number.isFinite(e.trustDelta) ? e.trustDelta : 0)),
  }
  return recordBetrayal(moved, e)
}

// ---------------------------------------------------------------------------
// What the story prompt says about the people they know about

/**
 * The last agreement betrayal about `id`, and whether it's still current: made under the agreement
 * they have now (same type, since it was made) with trust still under 60.
 */
function brokeOver(rel: Relationship, id: string): { b: BetrayalEvent; current: boolean } | null {
  const b = [...(rel.betrayals ?? [])].reverse().find((x) => x.kind === 'agreement' && x.about === id)
  if (!b) return null
  const type = rel.agreement?.type ?? 'none'
  if (b.agreement && b.agreement !== type) return null
  const current = b.at >= (rel.agreement?.madeAt ?? 0) && (rel.trust ?? 0) < RECONCILED_TRUST
  return { b, current }
}

/**
 * The story's {knownOthers}: the people they know the player is seeing (lapsed ones left out with
 * opts.seen), each marked when it matters: breaking the agreement they have now ("Kai Okoro, which
 * breaks the exclusive agreement Nova Castellanos made with the player"), a break they worked
 * through (in the past tense), gossip they're waiting for the player to confirm, the partner they
 * rekindled with. Plain names when nothing applies; "nobody, as far as {name} knows" when empty.
 */
export function knownOthersText(c: Character, rel: Relationship, names: Record<string, string>, opts: KnowsOptions = {}): string {
  const known = knownSeen(c, rel, { ...opts, keepRekindled: true })
  if (known.length === 0) return `nobody, as far as ${c.name} knows`
  const partner = rekindledPartner(rel)
  const waiting = new Set(secondhand(c, rel, opts))
  const parts = known.map((id) => {
    const name = nameOf(id, names)
    if (id === partner) {
      return rel.rekindle?.invite
        ? `${name} (${c.name} and ${name} got close again lately, and they've talked about inviting the player in)`
        : `${name} (back together with ${c.name} lately; ${c.name} is gently closing the door on the player)`
    }
    const broke = brokeOver(rel, id)
    if (broke?.current) {
      if (broke.b.agreement === 'exclusive') return `${name}, which breaks the exclusive agreement ${c.name} made with the player`
      return `${name}, whom ${c.name} heard about from someone else though their ${broke.b.agreement ?? 'poly'} agreement expects the player to say so`
    }
    if (broke) return `${name} (that broke the ${broke.b.agreement ?? 'exclusive'} agreement once; ${c.name} has worked through it)`
    if (waiting.has(id)) return `${name} (${c.name} heard about it from someone else and is waiting to see if the player brings it up)`
    return name
  })
  return parts.some((p) => p.includes(',') || p.includes('(')) ? parts.join('; ') : joinAnd(parts)
}

/**
 * One line for the profile: "Nova knows you're seeing Kai and doesn't mind." A raw betrayal comes
 * first (its note), people are named by first name, and a compersion character is happy for you.
 */
export function standingLine(c: Character, rel: Relationship, names: Record<string, string>, opts: KnowsOptions = {}): string {
  const first = firstName(c.name)
  const known = knownSeen(c, rel, opts).map((id) => firstName(nameOf(id, names)))
  const agreement = rel.agreement?.type ?? 'none'
  const last = (rel.betrayals ?? [])[(rel.betrayals ?? []).length - 1]
  if (last && (rel.trust ?? 0) < RECONCILED_TRUST) {
    const note = noPeriod(last.note)
    return sentence(`${first} ${note.charAt(0).toLowerCase()}${note.slice(1)}`)
  }
  if (known.length === 0) {
    return agreement === 'exclusive'
      ? `${first} thinks you two agreed to be exclusive.`
      : `${first} doesn't know about anyone else.`
  }
  const who = joinAnd(known)
  if (isJealous(c, rel, opts)) return `${first} knows you're seeing ${who} and minds.`
  if (c.jealousy === 'compersion') return `${first} knows you're seeing ${who} and is happy for you.`
  return `${first} knows you're seeing ${who} and doesn't care.`
}
