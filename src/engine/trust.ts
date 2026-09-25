// Trust (docs/SPEC.md, "Affection & Trust"; ARCHITECTURE, Engine, trust.ts). Pure.
//
// Phase 3 basics: the judge's trustDelta is scaled by difficulty and trust stays within 0-100;
// every completed date adds +1 for consistency. The judge delta goes through a list of small rules
// (TRUST_RULES = difficulty, then the grudge).
//
// Phase 4, betrayal recovery: after any betrayal, positive trust gains are multiplied by a grudge
// factor (compersion and low 0.75, medium 0.5, high 0.34, rounded down), so trust rebuilds slower
// than it was earned; losses are never softened. The +1 for a completed date thins out the same way
// (it lands on a share of dates: 3 in 4, 1 in 2, 1 in 3). Compersion and low-jealousy characters
// forgive: once trust is back to 60 their grudge lifts (Relationship.forgivenAt) until the next
// betrayal; medium and high hold it for the rest of the game. A caught lie always costs more trust
// than affection: the date flow turns a judge breach into a betrayal whose trust drop (-15 to -30)
// is larger than its affection drop (-10 to -20) (agreements.ts). Misgendering always costs trust
// (misgenderingRule), whatever the judge's trustDelta says.

import type { Character, DateRecord, Jealousy, JudgeResult, Relationship } from '../types'
import { applyDifficulty, clampTrust } from './math'

/** What a trust rule can look at. */
export interface TrustContext {
  character: Character
  /** The relationship before this change. */
  rel: Relationship
  judge: JudgeResult
}

/** One step of the trust pipeline: takes the delta so far and returns the new one. */
export type TrustRule = (delta: number, ctx: TrustContext) => number

/** Difficulty scales trust like it scales affection (easy x1.25, normal x1, hard x0.75). */
export const difficultyRule: TrustRule = (delta, ctx) => applyDifficulty(delta, ctx.character.difficulty)

/** The Phase 3 trust rules. */
export const BASE_TRUST_RULES: readonly TrustRule[] = [difficultyRule]

// ---------------------------------------------------------------------------
// The grudge (Phase 4)

/** How much of a trust gain lands after a betrayal, by jealousy. */
export const GRUDGE_FACTOR: Readonly<Record<Jealousy, number>> = {
  compersion: 0.75,
  low: 0.75,
  medium: 0.5,
  high: 0.34,
}

/** Trust at which a compersion or low-jealousy character forgives (their grudge lifts). */
export const FORGIVE_TRUST = 60

type GrudgeRel = Pick<Relationship, 'betrayals'> & Partial<Pick<Relationship, 'forgivenAt'>>

/** The grudge lifted after the last betrayal (a forgiving character got back to 60 since). */
export function forgiven(rel: GrudgeRel): boolean {
  const betrayals = rel.betrayals ?? []
  if (betrayals.length === 0 || rel.forgivenAt == null) return false
  const last = Math.max(...betrayals.map((b) => (Number.isFinite(b.at) ? b.at : 0)))
  return rel.forgivenAt >= last
}

/** 1 before any betrayal (or once a forgiving character forgave it); the grudge factor after one. */
export function grudgeFactor(c: Pick<Character, 'jealousy'>, rel: GrudgeRel): number {
  if ((rel.betrayals ?? []).length === 0 || forgiven(rel)) return 1
  return GRUDGE_FACTOR[c.jealousy] ?? GRUDGE_FACTOR.medium
}

/** Compersion and low jealousy forgive; medium and high hold a grudge for the rest of the game. */
export function forgives(c: Pick<Character, 'jealousy'>): boolean {
  return c.jealousy === 'compersion' || c.jealousy === 'low'
}

/**
 * A forgiving character (compersion or low) whose trust is back to 60 since their last betrayal
 * forgives it: forgivenAt is stamped, so the grudge stays lifted (until a new betrayal). Returns the
 * same object otherwise.
 */
export function forgive(c: Pick<Character, 'jealousy'>, rel: Relationship, now: number): Relationship {
  if (!forgives(c) || (rel.betrayals ?? []).length === 0 || forgiven(rel)) return rel
  if ((rel.trust ?? 0) < FORGIVE_TRUST) return rel
  return { ...rel, forgivenAt: now }
}

/** A trust change after the grudge: gains scaled and rounded down, losses as they are. */
export function withGrudge(delta: number, c: Pick<Character, 'jealousy'>, rel: GrudgeRel): number {
  if (!Number.isFinite(delta)) return 0
  if (delta <= 0) return Math.trunc(delta) || 0
  return Math.floor(delta * grudgeFactor(c, rel))
}

/** After a betrayal, positive gains are slowed by the grudge factor. */
export const grudgeRule: TrustRule = (delta, ctx) => (delta > 0 ? delta * grudgeFactor(ctx.character, ctx.rel) : delta)

/** The universal turn-off every character has (discovery.ts UNIVERSAL_TRAITS). */
export const MISGENDERING_ID = 'misgendering'

/** Trust a misgendering hit costs at least (softer than a caught lie). */
export const MISGENDERING_TRUST = -5

/** Affection a misgendering hit costs at least (the judge's range is -8 to -15). */
export const MISGENDERING_AFFECTION = -8

/** The judge reported the misgendering turn-off on this message. */
export function misgendered(judge: Pick<JudgeResult, 'hits'>): boolean {
  return (judge.hits ?? []).some((h) => h.type === 'turnOff' && h.id === MISGENDERING_ID)
}

/** Misgendering drops trust for every character, whatever trustDelta the judge picked. */
export const misgenderingRule: TrustRule = (delta, ctx) => (misgendered(ctx.judge) ? Math.min(delta, MISGENDERING_TRUST) : delta)

/** The Phase 4 trust rules the date flow uses: difficulty, misgendering, then the grudge. */
export const TRUST_RULES: readonly TrustRule[] = [difficultyRule, misgenderingRule, grudgeRule]

/**
 * Move trust by a delta that doesn't come from the judge (an agreement talk, metamour approval):
 * positive gains go through the grudge, the result is clamped to 0-100.
 */
export function applyTrustDelta(rel: Relationship, delta: number, c: Pick<Character, 'jealousy'>): Relationship {
  const d = withGrudge(delta, c, rel)
  if (!d) return rel
  const trust = clampTrust(clampTrust(rel.trust) + d)
  return trust === rel.trust ? rel : { ...rel, trust }
}

/** The judge's trustDelta after every rule, as a whole number. */
export function trustDeltaFor(ctx: TrustContext, rules: readonly TrustRule[] = BASE_TRUST_RULES): number {
  let delta = Number.isFinite(ctx.judge.trustDelta) ? ctx.judge.trustDelta : 0
  for (const rule of rules) delta = rule(delta, ctx)
  const whole = Math.trunc(delta)
  return whole === 0 ? 0 : whole
}

/**
 * Apply the judge's trust change. Returns the relationship with the new trust and the change that
 * actually landed on the meter (after rules and the 0-100 clamp).
 */
export function applyTrust(
  ctx: TrustContext,
  rules: readonly TrustRule[] = BASE_TRUST_RULES,
): { rel: Relationship; applied: number } {
  const delta = trustDeltaFor(ctx, rules)
  const before = clampTrust(ctx.rel.trust)
  const trust = clampTrust(before + delta)
  const applied = trust - before
  if (trust === ctx.rel.trust) return { rel: ctx.rel, applied }
  return { rel: { ...ctx.rel, trust }, applied }
}

/** Trust gained for showing up and seeing a date through. */
export const CONSISTENCY_TRUST = 1

/**
 * After a betrayal the +1 for a completed date lands on a share of dates set by the grudge factor
 * (floor(n x f) steps up), counted on `rel.dates` (the finished date already included).
 */
export function consistencyLands(c: Pick<Character, 'jealousy'>, rel: Pick<Relationship, 'betrayals' | 'dates'> & Partial<Pick<Relationship, 'forgivenAt'>>): boolean {
  const f = grudgeFactor(c, rel)
  if (f >= 1) return true
  const n = Math.max(1, Math.trunc(rel.dates ?? 1))
  return Math.floor(n * f + 1e-9) > Math.floor((n - 1) * f + 1e-9)
}

/**
 * +1 trust for a completed date (not one the character left or the player ended early). With the
 * character (Phase 4), a betrayal thins it out (consistencyLands).
 */
export function consistencyTrust(
  rel: Relationship,
  outcome: DateRecord['outcome'],
  c?: Pick<Character, 'jealousy'>,
): { rel: Relationship; applied: number } {
  if (outcome !== 'completed') return { rel, applied: 0 }
  if (c && !consistencyLands(c, rel)) return { rel, applied: 0 }
  const before = clampTrust(rel.trust)
  const trust = clampTrust(before + CONSISTENCY_TRUST)
  return { rel: trust === rel.trust ? rel : { ...rel, trust }, applied: trust - before }
}
