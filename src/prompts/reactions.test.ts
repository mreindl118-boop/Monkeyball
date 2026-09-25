import { describe, expect, it } from 'vitest'
import { giftReactionFor, venueFeelingFor } from './build'

describe('reaction helpers for the story prompt', () => {
  it('maps a stored venue reaction to {venueFeeling}', () => {
    expect(venueFeelingFor('favorite')).toBe('loves')
    expect(venueFeelingFor('hated')).toBe('hates')
    expect(venueFeelingFor('neutral')).toBe('fine')
    expect(venueFeelingFor(undefined)).toBe('fine')
  })

  it('maps a stored gift reaction to the gift line reaction', () => {
    expect(giftReactionFor('loved')).toBe('loved')
    expect(giftReactionFor('hated')).toBe('hated')
    expect(giftReactionFor('neutral')).toBe('neutral')
    expect(giftReactionFor(undefined)).toBe('neutral')
  })
})
