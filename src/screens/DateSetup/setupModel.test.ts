import { describe, expect, it } from 'vitest'
import { GIFTS, giftById } from '../../data/gifts'
import { venueById } from '../../data/venues'
import { newRelationship } from '../../engine/relationship'
import {
  giftOptions,
  knownGiftText,
  knownVenueText,
  setupSummary,
  validGift,
  validVenue,
  venueOptions,
} from './setupModel'

describe('venue options', () => {
  it('lists all 14 venues, with home locked before Lover', () => {
    const rel = newRelationship('nova')
    const opts = venueOptions(rel, 'romantic')
    expect(opts).toHaveLength(14)
    expect(opts.find((o) => o.venue.id === 'home')?.lock).toBe('Needs Lover')
    expect(opts.filter((o) => o.lock)).toHaveLength(1)
    expect(venueOptions({ ...rel, affection: 80 }, 'romantic').every((o) => !o.lock)).toBe(true)
  })

  it('shows home as friendship-locked on a friend route', () => {
    const opts = venueOptions(newRelationship('kai'), 'friend')
    expect(opts.find((o) => o.venue.id === 'home')?.lock).toBe('Friendship-locked')
  })

  it('carries reactions from earlier dates', () => {
    const rel = { ...newRelationship('nova'), venues: { 'record-store': 'favorite' as const } }
    const opts = venueOptions(rel, 'romantic')
    expect(opts.find((o) => o.venue.id === 'record-store')?.known).toBe('favorite')
    expect(opts.find((o) => o.venue.id === 'arcade')?.known).toBeUndefined()
  })
})

describe('gift options', () => {
  it('lists all 14 gifts, lingerie locked until Crush and heat 3', () => {
    const rel = newRelationship('nova')
    const opts = giftOptions(rel, 'romantic', 2)
    expect(opts).toHaveLength(14)
    expect(opts.find((o) => o.gift.id === 'lingerie')?.lock).toBe('Needs Crush and heat 3+')
    expect(giftOptions({ ...rel, affection: 60 }, 'romantic', 3).find((o) => o.gift.id === 'lingerie')?.lock).toBeNull()
  })

  it('carries reactions from earlier dates', () => {
    const rel = { ...newRelationship('nova'), gifts: { flowers: 'hated' as const } }
    expect(giftOptions(rel, 'romantic', 2).find((o) => o.gift.id === 'flowers')?.known).toBe('hated')
  })
})

describe('picks', () => {
  const rel = newRelationship('nova')
  const venues = venueOptions(rel, 'romantic')
  const gifts = giftOptions(rel, 'romantic', 2)

  it('refuses locked or unknown picks', () => {
    expect(validVenue(venues, 'record-store')).toBe('record-store')
    expect(validVenue(venues, 'home')).toBeNull()
    expect(validVenue(venues, 'moon')).toBeNull()
    expect(validVenue(venues, null)).toBeNull()
    expect(validGift(gifts, 'rare-vinyl')).toBe('rare-vinyl')
    expect(validGift(gifts, 'lingerie')).toBeNull()
    expect(validGift(gifts, undefined)).toBeNull()
  })

  it('words known reactions', () => {
    expect(knownVenueText('favorite')).toBe('Loves it')
    expect(knownVenueText('hated')).toBe("Can't stand it")
    expect(knownGiftText('neutral')).toBe('It was fine')
  })

  it('summarizes the plan', () => {
    expect(setupSummary('Nova', venueById('record-store'), giftById('rare-vinyl'))).toBe(
      'The record store with Nova, bringing rare vinyl.',
    )
    expect(setupSummary('Nova', venueById('arcade'), undefined)).toBe('The arcade with Nova, no gift.')
    expect(setupSummary('Nova', venueById('home'), undefined)).toBe('A night in with Nova, no gift.')
    expect(setupSummary('Nova', undefined, undefined)).toBe('Pick a venue first.')
  })

  it('reads well with every gift: count nouns take an article', () => {
    const lines = GIFTS.map((g) => setupSummary('Nova', venueById('arcade'), g))
    expect(lines).toContain('The arcade with Nova, bringing a video game.')
    expect(lines).toContain('The arcade with Nova, bringing a silver necklace.')
    expect(lines).toContain('The arcade with Nova, bringing hot sauce.')
    for (const line of lines) {
      expect(line).not.toMatch(/bringing (video game|poetry book|plushie|sketchbook|silver necklace|houseplant)\./)
    }
  })
})
