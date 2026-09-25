import { describe, expect, it } from 'vitest'
import { coerceAgreement, coerceJudge, coerceSuggestions, neutralJudge } from './coerce'

describe('coerceJudge', () => {
  it('accepts a full result', () => {
    const raw = { delta: 6, trustDelta: 1, hits: [{ type: 'turnOn', id: 'banter' }], mood: 'delighted', hint: 'A laugh.', jealousy: false, breach: false }
    expect(coerceJudge(raw)).toEqual(raw)
  })

  it('defaults missing fields, normalizes types, clamps and rounds', () => {
    expect(
      coerceJudge({ delta: '-30', trust_delta: 12.4, hits: [{ type: 'turn-off', id: 'cute' }, { type: 'nope', id: 'x' }, { type: 'like' }] }),
    ).toEqual({ delta: -20, trustDelta: 10, hits: [{ type: 'turnOff', id: 'cute' }], mood: 'neutral', hint: '', jealousy: false, breach: false })
    expect(coerceJudge({ delta: 3.6, jealousy: 'true', breach: 1 })?.delta).toBe(4)
    expect(coerceJudge({ delta: 3.6, jealousy: 'true' })?.jealousy).toBe(true)
  })

  it('rejects results without a numeric delta', () => {
    expect(coerceJudge({ mood: 'ok' })).toBeNull()
    expect(coerceJudge(null)).toBeNull()
    expect(coerceJudge([1])).toBeNull()
  })

  it('has a neutral fallback', () => {
    expect(neutralJudge()).toMatchObject({ delta: 0, trustDelta: 0, hits: [] })
  })
})

describe('coerceAgreement', () => {
  it('parses and clamps', () => {
    expect(coerceAgreement({ agreement: 'Polyamorous', accepted: true, terms: 'We tell each other.', trustDelta: 9 })).toEqual({
      agreement: 'poly',
      accepted: true,
      terms: 'We tell each other.',
      trustDelta: 5,
    })
    expect(coerceAgreement({ agreement: 'none', accepted: true })?.accepted).toBe(false)
    expect(coerceAgreement({ agreement: 'marriage' })).toBeNull()
  })
})

describe('coerceSuggestions', () => {
  it('needs every key', () => {
    const romantic = coerceSuggestions(['sweet', 'flirty', 'bold'])
    expect(romantic({ sweet: 'a', flirty: '"b"', bold: 'c' })).toEqual({ sweet: 'a', flirty: 'b', bold: 'c' })
    expect(romantic({ sweet: 'a', curious: 'b', honest: 'c' })).toBeNull()
  })
})
