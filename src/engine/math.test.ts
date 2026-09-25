import { describe, expect, it } from 'vitest'
import { bundledEntry } from '../data/bundled'
import {
  affectionRoom,
  applyAffection,
  applyDifficulty,
  clampAffection,
  clampTrust,
  emptyTotals,
  giftDelta,
  giftReaction,
  leftEarly,
  venueDelta,
  venueReaction,
} from './math'

const nova = bundledEntry('nova')!.character

describe('applyDifficulty', () => {
  it('scales by 1.25, 1 and 0.75 and rounds toward zero', () => {
    expect(applyDifficulty(10, 'easy')).toBe(12) // 12.5
    expect(applyDifficulty(-10, 'easy')).toBe(-12) // -12.5
    expect(applyDifficulty(3, 'easy')).toBe(3) // 3.75
    expect(applyDifficulty(7, 'normal')).toBe(7)
    expect(applyDifficulty(-7, 'normal')).toBe(-7)
    expect(applyDifficulty(10, 'hard')).toBe(7) // 7.5
    expect(applyDifficulty(-10, 'hard')).toBe(-7) // -7.5
    expect(applyDifficulty(1, 'hard')).toBe(0)
    expect(Object.is(applyDifficulty(-1, 'hard'), 0)).toBe(true) // never -0
    expect(applyDifficulty(Number.NaN, 'easy')).toBe(0)
  })
})

describe('venue and gift deltas', () => {
  it('favorite venue +3, hated -5, other 0', () => {
    expect(venueDelta(nova, 'record-store')).toBe(3)
    expect(venueDelta(nova, 'fancy-restaurant')).toBe(-5)
    expect(venueDelta(nova, 'arcade')).toBe(0)
    expect(venueReaction(nova, 'record-store')).toBe('favorite')
    expect(venueReaction(nova, 'climbing-gym')).toBe('hated')
    expect(venueReaction(nova, 'arcade')).toBe('neutral')
  })

  it('loved gift +5, hated -5, other +1, none 0', () => {
    expect(giftDelta(nova, 'rare-vinyl')).toBe(5)
    expect(giftDelta(nova, 'flowers')).toBe(-5)
    expect(giftDelta(nova, 'plushie')).toBe(1)
    expect(giftDelta(nova, undefined)).toBe(0)
    expect(giftReaction(nova, 'hot-sauce')).toBe('loved')
    expect(giftReaction(nova, 'flowers')).toBe('hated')
    expect(giftReaction(nova, 'plushie')).toBe('neutral')
  })
})

describe('applyAffection', () => {
  it('clips gains so the net total never passes the cap', () => {
    let totals = emptyTotals()
    const applied: number[] = []
    for (const d of [10, 10, 10, 10]) {
      const r = applyAffection(totals, d, 25)
      applied.push(r.applied)
      totals = r.totals
    }
    expect(applied).toEqual([10, 10, 5, 0])
    expect(totals).toEqual({ affection: 25, trust: 0, gained: 25 })
  })

  it('never caps losses, and lets the date climb back up to the cap', () => {
    let r = applyAffection({ affection: 25, trust: 0, gained: 25 }, -30, 25)
    expect(r.applied).toBe(-30)
    expect(r.totals.affection).toBe(-5)
    r = applyAffection(r.totals, 10, 25)
    expect(r.applied).toBe(10)
    r = applyAffection(r.totals, 50, 25)
    expect(r.applied).toBe(20)
    expect(r.totals.affection).toBe(25)
    expect(r.totals.gained).toBe(55)
  })

  it('does not spend the allowance on gains the meter cannot hold', () => {
    const r = applyAffection(emptyTotals(), 10, 25, 4)
    expect(r.applied).toBe(4)
    expect(r.totals.affection).toBe(4)
    expect(applyAffection(emptyTotals(), 10, 25, 0).applied).toBe(0)
    expect(applyAffection(emptyTotals(), -10, 25, 0).applied).toBe(-10)
  })

  it('treats a zero or negative cap as no gains at all', () => {
    expect(applyAffection(emptyTotals(), 5, 0).applied).toBe(0)
    expect(applyAffection(emptyTotals(), 5, -3).applied).toBe(0)
  })

  it('does not mutate the totals it was given', () => {
    const t = emptyTotals()
    applyAffection(t, 5, 25)
    expect(t).toEqual(emptyTotals())
  })
})

describe('leftEarly and clamps', () => {
  it('leaves at a running total of -20 or worse', () => {
    expect(leftEarly(-19)).toBe(false)
    expect(leftEarly(-20)).toBe(true)
    expect(leftEarly(-35)).toBe(true)
  })

  it('clamps affection to 0-100 and the friend-route cap of 59', () => {
    expect(clampAffection(120, 'romantic')).toBe(100)
    expect(clampAffection(-4, 'romantic')).toBe(0)
    expect(clampAffection(70, 'friend')).toBe(59)
    expect(clampAffection(55, 'friend')).toBe(55)
  })

  it('does not pull affection down to the friend cap when it was already above it', () => {
    expect(clampAffection(72, 'friend', 72)).toBe(72)
    expect(clampAffection(80, 'friend', 72)).toBe(72)
    expect(clampAffection(65, 'friend', 72)).toBe(65)
    expect(affectionRoom(72, 'friend')).toBe(0)
    expect(affectionRoom(50, 'friend')).toBe(9)
    expect(affectionRoom(98, 'romantic')).toBe(2)
  })

  it('clamps trust to 0-100', () => {
    expect(clampTrust(104)).toBe(100)
    expect(clampTrust(-2)).toBe(0)
    expect(clampTrust(Number.NaN)).toBe(0)
  })
})
