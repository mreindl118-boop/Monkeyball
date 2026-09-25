import { describe, expect, it } from 'vitest'
import { dragNightNote, isVenueUnlocked, VENUE_IDS, VENUES, venueById, venueLock } from './venues'

/** docs/SPEC.md, "Venues (14)", in order. */
const SPEC_VENUES = [
  'record-store', 'rooftop-bar', 'karaoke-box', 'arcade', 'boardwalk', 'art-museum', 'night-market',
  'climbing-gym', 'fancy-restaurant', 'bookstore-cafe', 'amusement-park', 'hot-spring', 'queer-bar', 'home',
]

describe('venues', () => {
  it('are exactly the fourteen SPEC venues, in order', () => {
    expect(VENUES).toHaveLength(14)
    expect(VENUES.map((v) => v.id)).toEqual(SPEC_VENUES)
    expect([...VENUE_IDS]).toEqual(SPEC_VENUES)
  })

  it.each(SPEC_VENUES)('%s has a name, a one-line description and a gradient backdrop with 2 to 5 shapes', (id) => {
    const v = venueById(id)!
    expect(v.name).toMatch(/^[A-Z][a-z]/)
    expect(v.name.slice(1)).toBe(v.name.slice(1).toLowerCase()) // sentence case
    expect(v.description.length).toBeGreaterThan(20)
    expect(v.description).not.toContain('\n')
    expect(v.description).not.toMatch(/·/)
    expect(v.backdrop).toMatch(/gradient\(/)
    expect(v.backdrop).not.toMatch(/url\(/)
    // Layered: at least three gradients.
    expect(v.backdrop.match(/gradient\(/g)!.length).toBeGreaterThanOrEqual(3)
    // Balanced parentheses, so the CSS value parses.
    let depth = 0
    for (const ch of v.backdrop) {
      depth += ch === '(' ? 1 : ch === ')' ? -1 : 0
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
    expect(v.shapes!.length).toBeGreaterThanOrEqual(2)
    expect(v.shapes!.length).toBeLessThanOrEqual(5)
    for (const s of v.shapes!) {
      expect(['circle', 'rect', 'line', 'stripe']).toContain(s.kind)
      for (const n of [s.x, s.y, s.w, s.h]) {
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThanOrEqual(100)
      }
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i)
      if (s.opacity != null) expect(s.opacity).toBeLessThanOrEqual(1)
      if (s.blur != null) expect(s.blur).toBeLessThanOrEqual(16) // cheap on mid-range phones
    }
  })

  it('mentions Thursday drag night at the queer bar', () => {
    expect(venueById('queer-bar')!.description).toMatch(/Thursday.*drag night/i)
  })

  it('locks home until Lover and nothing else', () => {
    const home = venueById('home')!
    expect(home.requiresAffection).toBe(80)
    expect(isVenueUnlocked(home, 79)).toBe(false)
    expect(isVenueUnlocked(home, 80)).toBe(true)
    expect(venueLock(home, 10)).toBe('Needs Lover')
    expect(venueLock(home, 95)).toBeNull()
    // A friend route stops at 59, so home is out of reach there.
    expect(venueLock(home, 10, 'friend')).toBe('Friendship-locked')
    expect(venueLock(home, 10, 'romantic')).toBe('Needs Lover')
    expect(venueLock(venueById('arcade')!, 0, 'friend')).toBeNull()
    for (const v of VENUES.filter((x) => x.id !== 'home')) {
      expect(v.requiresAffection).toBeUndefined()
      expect(isVenueUnlocked(v, 0)).toBe(true)
    }
  })

  it('returns undefined for an unknown id', () => {
    expect(venueById('moon-base')).toBeUndefined()
  })

  it('has a drag night note on Thursdays only, for the queer bar', () => {
    const thursday = new Date(2026, 8, 24) // 24 Sep 2026
    const friday = new Date(2026, 8, 25)
    expect(thursday.getDay()).toBe(4)
    expect(dragNightNote(thursday)).toBe("It's Thursday: drag night.")
    expect(dragNightNote(thursday, 'queer-bar')).toBe("It's Thursday: drag night.")
    expect(dragNightNote(friday)).toBeNull()
    expect(dragNightNote(thursday, 'arcade')).toBeNull()
  })
})
