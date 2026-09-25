import { describe, expect, it } from 'vitest'
import { bundledEntry } from '../data/bundled'
import { neutralJudge } from '../llm/coerce'
import type { Character, JudgeResult, Relationship } from '../types'
import { newRelationship } from './relationship'
import {
  applyTrust,
  applyTrustDelta,
  BASE_TRUST_RULES,
  consistencyTrust,
  GRUDGE_FACTOR,
  grudgeFactor,
  TRUST_RULES,
  trustDeltaFor,
  type TrustRule,
  withGrudge,
} from './trust'

const nova = bundledEntry('nova')!.character
const as = (difficulty: Character['difficulty']): Character => ({ ...nova, difficulty })
const rel = (trust: number): Relationship => ({ ...newRelationship('nova'), trust })
const judge = (trustDelta: number): JudgeResult => ({ ...neutralJudge(), trustDelta })

describe('trust', () => {
  it('scales the judge trustDelta by difficulty, toward zero', () => {
    expect(trustDeltaFor({ character: as('easy'), rel: rel(10), judge: judge(4) })).toBe(5)
    expect(trustDeltaFor({ character: as('normal'), rel: rel(10), judge: judge(4) })).toBe(4)
    expect(trustDeltaFor({ character: as('hard'), rel: rel(10), judge: judge(4) })).toBe(3)
    expect(trustDeltaFor({ character: as('hard'), rel: rel(10), judge: judge(-10) })).toBe(-7)
  })

  it('clamps trust to 0-100 and reports what landed on the meter', () => {
    const low = applyTrust({ character: nova, rel: rel(3), judge: judge(-8) })
    expect(low.rel.trust).toBe(0)
    expect(low.applied).toBe(-3)
    const high = applyTrust({ character: nova, rel: rel(97), judge: judge(8) })
    expect(high.rel.trust).toBe(100)
    expect(high.applied).toBe(3)
    const none = rel(50)
    expect(applyTrust({ character: nova, rel: none, judge: judge(0) }).rel).toBe(none)
  })

  it('runs extra rules after the base ones (the Phase 4 hook)', () => {
    const halveGains: TrustRule = (d) => (d > 0 ? d * 0.5 : d)
    const r = applyTrust({ character: as('easy'), rel: rel(10), judge: judge(8) }, [...BASE_TRUST_RULES, halveGains])
    expect(r.applied).toBe(5) // 8 x 1.25 = 10, halved
  })

  it('adds +1 for a completed date only', () => {
    expect(consistencyTrust(rel(10), 'completed')).toMatchObject({ applied: 1, rel: { trust: 11 } })
    expect(consistencyTrust(rel(10), 'left').applied).toBe(0)
    expect(consistencyTrust(rel(10), 'ended').applied).toBe(0)
    expect(consistencyTrust(rel(100), 'completed').applied).toBe(0)
  })
})

describe('the grudge (Phase 4)', () => {
  const betrayed = (trust: number, dates = 0): Relationship => ({
    ...rel(trust),
    dates,
    betrayals: [{ at: 1, kind: 'lie', note: '', affectionDelta: -10, trustDelta: -15 }],
  })
  const j = (jealousy: Character['jealousy']): Character => ({ ...nova, jealousy })

  it('slows gains after a betrayal by jealousy, rounded down, and never softens losses', () => {
    expect(grudgeFactor(nova, rel(10))).toBe(1)
    expect(GRUDGE_FACTOR).toEqual({ compersion: 0.75, low: 0.75, medium: 0.5, high: 0.34 })
    expect(withGrudge(4, j('compersion'), betrayed(10))).toBe(3)
    expect(withGrudge(4, j('low'), betrayed(10))).toBe(3)
    expect(withGrudge(4, j('medium'), betrayed(10))).toBe(2)
    expect(withGrudge(4, j('high'), betrayed(10))).toBe(1)
    expect(withGrudge(-4, j('high'), betrayed(10))).toBe(-4)
    expect(withGrudge(4, j('high'), rel(10))).toBe(4)
  })

  it('runs as a trust rule after difficulty', () => {
    const ctx = { character: { ...j('medium'), difficulty: 'easy' as const }, rel: betrayed(10), judge: judge(8) }
    expect(trustDeltaFor(ctx, BASE_TRUST_RULES)).toBe(10)
    expect(trustDeltaFor(ctx, TRUST_RULES)).toBe(5)
    expect(trustDeltaFor({ ...ctx, judge: judge(-8) }, TRUST_RULES)).toBe(-10)
  })

  it('applies other trust changes through it', () => {
    expect(applyTrustDelta(betrayed(10), 4, j('medium')).trust).toBe(12)
    expect(applyTrustDelta(betrayed(10), -4, j('medium')).trust).toBe(6)
    expect(applyTrustDelta(rel(98), 4, nova).trust).toBe(100)
    const same = betrayed(10)
    expect(applyTrustDelta(same, 1, j('high'))).toBe(same)
  })

  it('thins the +1 for a completed date to a share of dates', () => {
    const landed = (jealousy: Character['jealousy']) =>
      Array.from({ length: 12 }, (_, i) => consistencyTrust(betrayed(10, i + 1), 'completed', j(jealousy)).applied).reduce((a, b) => a + b, 0)
    expect(landed('low')).toBe(9)
    expect(landed('medium')).toBe(6)
    expect(landed('high')).toBe(4)
    expect(consistencyTrust(rel(10), 'completed', j('high')).applied).toBe(1)
    expect(consistencyTrust(betrayed(10, 2), 'ended', j('low')).applied).toBe(0)
  })
})
