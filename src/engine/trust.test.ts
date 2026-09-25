import { describe, expect, it } from 'vitest'
import { bundledEntry } from '../data/bundled'
import { neutralJudge } from '../llm/coerce'
import type { Character, JudgeResult, Relationship } from '../types'
import { newRelationship } from './relationship'
import { applyTrust, BASE_TRUST_RULES, consistencyTrust, trustDeltaFor, type TrustRule } from './trust'

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
