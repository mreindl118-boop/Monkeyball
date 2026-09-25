import { describe, expect, it } from 'vitest'
import { FRIENDSHIP_LOCKED, GIFT_IDS, GIFTS, giftById, giftLock, giftNoun, isGiftUnlocked } from './gifts'

/** docs/SPEC.md, "Gifts (14)", in order. */
const SPEC_GIFTS = [
  'flowers', 'chocolates', 'rare-vinyl', 'hot-sauce', 'video-game', 'perfume', 'poetry-book', 'plushie',
  'red-wine', 'concert-tickets', 'sketchbook', 'silver-necklace', 'houseplant', 'lingerie',
]

describe('gifts', () => {
  it('are exactly the fourteen SPEC gifts, in order', () => {
    expect(GIFTS).toHaveLength(14)
    expect(GIFTS.map((g) => g.id)).toEqual(SPEC_GIFTS)
    expect([...GIFT_IDS]).toEqual(SPEC_GIFTS)
  })

  it.each(SPEC_GIFTS)('%s has a sentence-case name and a one-line description', (id) => {
    const g = giftById(id)!
    expect(g.name).toMatch(/^[A-Z]/)
    expect(g.name.slice(1)).toBe(g.name.slice(1).toLowerCase())
    expect(g.description.length).toBeGreaterThan(20)
    expect(g.description).not.toContain('\n')
  })

  it('only lingerie is locked, behind Crush and heat 3', () => {
    const lingerie = giftById('lingerie')!
    expect(lingerie).toMatchObject({ requiresAffection: 60, requiresHeat: 3 })
    for (const g of GIFTS.filter((x) => x.id !== 'lingerie')) {
      expect(giftLock(g, 0, 1)).toBeNull()
    }
  })

  it('says what a locked gift needs', () => {
    const lingerie = giftById('lingerie')!
    expect(giftLock(lingerie, 10, 2)).toBe('Needs Crush and heat 3+')
    expect(giftLock(lingerie, 59, 5)).toBe('Needs Crush')
    expect(giftLock(lingerie, 60, 2)).toBe('Needs heat 3+')
    expect(giftLock(lingerie, 60, 3)).toBeNull()
    expect(giftLock(lingerie, 100, 5)).toBeNull()
    expect(isGiftUnlocked(lingerie, 60, 3)).toBe(true)
    expect(isGiftUnlocked(lingerie, 61, 1)).toBe(false)
  })

  it('says a friend route can never reach lingerie', () => {
    const lingerie = giftById('lingerie')!
    expect(giftLock(lingerie, 59, 5, 'friend')).toBe(FRIENDSHIP_LOCKED)
    expect(giftLock(lingerie, 10, 2, 'friend')).toBe('Friendship-locked')
    expect(giftLock(lingerie, 10, 2, 'romantic')).toBe('Needs Crush and heat 3+')
    expect(isGiftUnlocked(lingerie, 59, 5, 'friend')).toBe(false)
    expect(giftLock(giftById('flowers')!, 0, 1, 'friend')).toBeNull()
  })

  it('names the stage for other thresholds and heat 5', () => {
    expect(giftLock({ id: 'x', name: 'X', description: 'x', requiresAffection: 80 }, 0, 2)).toBe('Needs Lover')
    expect(giftLock({ id: 'x', name: 'X', description: 'x', requiresHeat: 5 }, 0, 4)).toBe('Needs heat 5')
  })
})

/** Every gift as it reads mid-sentence ("You brought {gift}."): count nouns take an article. */
const GIFT_NOUNS: Record<string, string> = {
  flowers: 'flowers',
  chocolates: 'chocolates',
  'rare-vinyl': 'rare vinyl',
  'hot-sauce': 'hot sauce',
  'video-game': 'a video game',
  perfume: 'perfume',
  'poetry-book': 'a poetry book',
  plushie: 'a plushie',
  'red-wine': 'red wine',
  'concert-tickets': 'concert tickets',
  sketchbook: 'a sketchbook',
  'silver-necklace': 'a silver necklace',
  houseplant: 'a houseplant',
  lingerie: 'lingerie',
}

describe('gift nouns', () => {
  it.each(SPEC_GIFTS)('%s reads as a noun phrase mid-sentence', (id) => {
    expect(giftNoun(giftById(id)!)).toBe(GIFT_NOUNS[id])
  })
})
