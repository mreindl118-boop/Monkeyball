// Agreements, jealousy and betrayal (docs/SPEC.md, "Affection & Trust": relationship styles,
// agreements, betrayal, recovery; ARCHITECTURE, Engine, agreements.ts). Pure: no React, no Dexie.
//
// Seeing several people is not betrayal; breaking an agreement or lying is:
// - no agreement, casual, or open without disclosure terms: the character can know about anyone and
//   nothing is broken (they may still mind, which is jealousy, not betrayal);
// - exclusive: any other person dated after the agreement was made is a betrayal, however they find
//   out (hearing it from the player is honest, so it lands a little softer);
// - poly, and open with terms about telling or knowing: disclosure is expected, so hearing it from
//   the player (or meeting them on a group date) is fine, and hearing it through gossip is a smaller
//   betrayal;
// - a lie the judge catches (breach) is a betrayal of its own.
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

/** The player is seeing this character: romantic route, at least one date, affection 20 or more. */
export function seeing(rel: Relationship | undefined, route: Route): boolean {
  return !!rel && route === 'romantic' && (rel.dates ?? 0) >= 1 && (rel.affection ?? 0) >= SEEING_AFFECTION
}

/** Everyone the player is seeing except `exceptId`, sorted by id (the judge's {others}). */
export function othersSeen(
  rels: Readonly<Record<string, Relationship>>,
  routeOf: (id: string) => Route,
  exceptId: string,
): string[] {
  return Object.keys(rels)
    .filter((id) => id !== exceptId && seeing(rels[id], routeOf(id)))
    .sort()
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
 * high, or low with an exclusive agreement. Compersion never minds.
 */
export function isJealous(c: Pick<Character, 'jealousy' | 'id'>, rel: Relationship): boolean {
  const known = (rel.knownOthers ?? []).filter((id) => id !== c.id)
  if (known.length === 0 || c.jealousy === 'compersion') return false
  if (c.jealousy === 'medium' || c.jealousy === 'high') return true
  return rel.agreement?.type === 'exclusive'
}

/** Trust at which a betrayal counts as worked through (the jealousy mark lifts; Reconciliation). */
export const RECONCILED_TRUST = 60

/**
 * The hub's jealousy mark: they know about someone and mind (isJealous), or a betrayal is still
 * raw (trust under 60 since it).
 */
export function jealousNow(c: Pick<Character, 'jealousy' | 'id'>, rel: Relationship): boolean {
  return isJealous(c, rel) || ((rel.betrayals ?? []).length > 0 && (rel.trust ?? 0) < RECONCILED_TRUST)
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

function betrayalPhrase(e: BetrayalEvent, names: Record<string, string> | undefined): string {
  if (e.kind === 'lie') return 'caught the player in a lie and hasn\'t let it go'
  const who = e.about ? nameOf(e.about, names) : 'someone else'
  if (e.agreement === 'exclusive') {
    return e.how === 'player'
      ? `thinks we agreed to be exclusive, and heard about ${who} from the player; it breaks that agreement`
      : `thinks we agreed to be exclusive and just heard about ${who}; it breaks that agreement`
  }
  return `we agreed to tell each other about other people, and heard about ${who} from someone else instead`
}

/**
 * The judge's {opinion}: where this character thinks the two of them stand. The agreement and who
 * they know about (as defaultOpinion words it), sharpened by the last betrayal while trust is still
 * under 60 ("thinks we agreed to be exclusive and just heard about Kai Okoro; it breaks that
 * agreement"), and by a betrayal they have worked through.
 */
export function opinionText(c: Character, rel: Relationship, names: Record<string, string>): string {
  const betrayals = rel.betrayals ?? []
  const last = betrayals[betrayals.length - 1]
  const base = defaultOpinion(c, rel, names)
  if (!last) return base
  if ((rel.trust ?? 0) < RECONCILED_TRUST) {
    const minds = c.jealousy === 'high' ? 'still stings badly' : c.jealousy === 'compersion' ? 'trying to let it go' : 'still hurts'
    return `${betrayalPhrase(last, names)}; ${minds}`
  }
  return `${base}; there was a betrayal once, and trust has been rebuilt since`
}

// ---------------------------------------------------------------------------
// Define the relationship

/** Affection at which either side can open Define the relationship (Friend). */
export const DTR_AFFECTION = 40

/** Define the relationship is on offer from Friend stage (affection 40+), on either route. */
export function dtrAvailable(rel: Relationship, _route: Route): boolean {
  return (rel.affection ?? 0) >= DTR_AFFECTION
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
  return `Heard about ${other} from someone else, though your ${agreement} agreement expects you to say so.`
}

/** True when a betrayal about `about` was already counted since that person's last date. */
function alreadyCounted(rel: Relationship, about: string, otherRel: Relationship | undefined): boolean {
  const since = otherRel?.lastDateAt ?? 0
  return (rel.betrayals ?? []).some((b) => b.kind === 'agreement' && b.about === about && b.at >= since)
}

export interface BetrayalOptions {
  /** Display names by character id (the note and the memory line use the other person's first name). */
  names?: Record<string, string>
}

/**
 * Does learning this make it a betrayal? `observer` learns about `learnedAbout` (someone the player
 * sees; `otherRel` is the player's relationship with them) through `how`:
 * - 'lie': the judge caught a lie (breach): always a betrayal of kind 'lie', a bit worse than the
 *   jealousy alone would make it.
 * - exclusive: a betrayal when the player went out with them after the agreement was made (a
 *   later date than any betrayal about them already counted); hearing it from the player softens it.
 * - poly, or open with disclosure terms: a smaller betrayal, only when it comes through gossip (and
 *   the date with them was after the agreement); from the player or a group date it's disclosure.
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
    const datedSince = (otherRel.dates ?? 0) > 0 && (otherRel.lastDateAt ?? 0) > (agreement.madeAt ?? 0)
    if (!datedSince || alreadyCounted(rel, learnedAbout, otherRel)) return null
    kind = 'agreement'
    if (forbidsOthers(agreement)) {
      severity = how === 'gossip' ? base + 0.15 : how === 'player' ? base - 0.25 : base
    } else if (disclosureRequired(agreement)) {
      if (how !== 'gossip') return null
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
 * Record a betrayal without moving the meters (the date flow counts its deltas on the date's
 * ledger): the event, the memory line, the person they now know about, and the jealousy mark.
 */
export function recordBetrayal(rel: Relationship, e: BetrayalEvent): Relationship {
  const knownOthers =
    e.about && !(rel.knownOthers ?? []).includes(e.about) ? [...(rel.knownOthers ?? []), e.about] : rel.knownOthers ?? []
  const line = String(e.memory ?? '').trim()
  return {
    ...rel,
    betrayals: [...(rel.betrayals ?? []), e],
    memory: line ? [...(rel.memory ?? []), line] : [...(rel.memory ?? [])],
    knownOthers,
    jealous: true,
  }
}

/**
 * Apply a betrayal between dates: affection and trust drop by the event's deltas (affection drops
 * but isn't reset), then recordBetrayal (the event, the memory line in their voice, jealous).
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
 * The story's {knownOthers}: names, each marked when it breaks the agreement ("Kai Okoro, which
 * breaks the exclusive agreement Nova Castellanos made with the player"). Plain names when nothing
 * was broken; the empty text when they know about nobody.
 */
export function knownOthersText(c: Character, rel: Relationship, names: Record<string, string>): string {
  const known = (rel.knownOthers ?? []).filter((id) => id && id !== c.id)
  if (known.length === 0) return `nobody, as far as ${c.name} knows`
  const parts = known.map((id) => {
    const name = nameOf(id, names)
    const broke = [...(rel.betrayals ?? [])].reverse().find((b) => b.kind === 'agreement' && b.about === id)
    if (!broke) return name
    if (broke.agreement === 'exclusive') return `${name}, which breaks the exclusive agreement ${c.name} made with the player`
    return `${name}, whom ${c.name} heard about from someone else though their ${broke.agreement ?? 'poly'} agreement expects the player to say so`
  })
  return parts.some((p) => p.includes(',')) ? parts.join('; ') : joinAnd(parts)
}

/** One line for the profile or the polycule map: "Knows you're seeing Kai Okoro and doesn't mind." */
export function standingLine(c: Character, rel: Relationship, names: Record<string, string>): string {
  const first = firstName(c.name)
  const known = (rel.knownOthers ?? []).filter((id) => id && id !== c.id).map((id) => nameOf(id, names))
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
  return isJealous(c, rel) ? `${first} knows you're seeing ${who} and minds.` : `${first} knows you're seeing ${who} and doesn't mind.`
}
