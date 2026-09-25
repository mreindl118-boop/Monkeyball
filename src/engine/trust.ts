// Trust (docs/SPEC.md, "Affection & Trust"; ARCHITECTURE, Engine, trust.ts). Pure.
//
// Phase 3 basics: the judge's trustDelta is scaled by difficulty and trust stays within 0-100;
// every completed date adds +1 for consistency. The judge delta goes through a list of small rules
// so Phase 4 can add its own (the grudge factor after a betrayal, the extra breach penalty) without
// touching the date flow: pass `[...BASE_TRUST_RULES, grudgeRule, breachRule]`.

import type { Character, DateRecord, JudgeResult, Relationship } from '../types'
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

/** The Phase 3 trust rules. Phase 4 appends its grudge and breach rules. */
export const BASE_TRUST_RULES: readonly TrustRule[] = [difficultyRule]

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

/** +1 trust for a completed date (not one the character left or the player ended early). */
export function consistencyTrust(rel: Relationship, outcome: DateRecord['outcome']): { rel: Relationship; applied: number } {
  if (outcome !== 'completed') return { rel, applied: 0 }
  const before = clampTrust(rel.trust)
  const trust = clampTrust(before + CONSISTENCY_TRUST)
  return { rel: trust === rel.trust ? rel : { ...rel, trust }, applied: trust - before }
}
