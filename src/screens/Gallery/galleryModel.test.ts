import { describe, expect, it } from 'vitest'
import type { ArtSlot } from '../../art/types'
import { bundledEntry } from '../../data/bundled'
import type { BetrayalEvent, Character } from '../../types'
import {
  dragOffset,
  endingArtScene,
  endingArtTitle,
  favoriteSlots,
  galleryGroups,
  groupSlotTitle,
  groupSlotsFor,
  imageFileName,
  importErrorText,
  joinNames,
  reachableEndings,
  slotKicker,
  slotScene,
  slotTitle,
  stepIndex,
  swipeDirection,
  unlockedLabel,
  unlockedTierCount,
  visibleSlot,
  withFavorites,
} from './galleryModel'

const nova = bundledEntry('nova')!.character
const kai = bundledEntry('kai')!.character

describe('slot words', () => {
  it('names tiers from the card, endings from the card or the ending, groups from their slot', () => {
    expect(slotTitle(nova, { kind: 'tier', characterId: 'nova', tier: 3 })).toBe('Rain check')
    expect(slotTitle({ gallery: [] }, { kind: 'tier', characterId: 'x', tier: 2 })).toBe('Tier 2')
    expect(slotTitle(nova, { kind: 'ending', characterId: 'nova', ending: 'good' })).toBe('The good ending')
    const own: Pick<Character, 'gallery' | 'endings'> = { gallery: nova.gallery, endings: { bitter: { title: 'Last call', scene: 'Closing time.' } } }
    expect(endingArtTitle(own, 'bitter')).toBe('Last call')
    expect(endingArtScene(own, 'bitter')).toBe('Closing time.')
    // Without its own ending scene the tier 5 scene stands in.
    expect(endingArtScene(nova, 'good')).toBe(nova.gallery.find((t) => t.tier === 5)!.scene.trim())
    expect(slotTitle(nova, { kind: 'group', characterIds: ['kai', 'nova'], slot: 'polycule' })).toBe('The polycule')
    expect(groupSlotTitle('group-date')).toBe('Group date')
    expect(groupSlotTitle('  ')).toBe('Together')
  })

  it('has a scene line for tiers and endings only', () => {
    expect(slotScene(nova, { kind: 'tier', characterId: 'nova', tier: 1 })).toContain('headphone')
    expect(slotScene(nova, { kind: 'group', characterIds: ['kai', 'nova'], slot: 'polycule' })).toBe('')
  })

  it('says which tier, ending or who else is in the picture', () => {
    const names = { nova: 'Nova Castellanos', kai: 'Kai Okoro', sol: 'Sol Reyes' }
    expect(slotKicker({ kind: 'tier', characterId: 'nova', tier: 4 })).toBe('Tier 4')
    expect(slotKicker({ kind: 'ending', characterId: 'nova', ending: 'open' })).toBe('Ending')
    expect(slotKicker({ kind: 'group', characterIds: ['kai', 'nova', 'sol'], slot: 'polycule' }, names, 'nova')).toBe('With Kai and Sol')
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C')
    expect(joinNames(['A'])).toBe('A')
  })

  it('counts unlocked tiers once each, out of five', () => {
    expect(unlockedTierCount({ tiersUnlocked: [1, 2, 2, 3] })).toBe(3)
    expect(unlockedTierCount(undefined)).toBe(0)
    expect(unlockedLabel(3)).toEqual({ short: '3/5', spoken: '3 of 5 unlocked' })
    expect(unlockedLabel(9).short).toBe('5/5')
  })
})

describe('group pictures', () => {
  it('finds the group slots a character is in, generated rows folded in', () => {
    const keys = ['group:kai+nova:polycule#generated', 'group:kai+nova:polycule', 'group:jules+sol:polycule', 'nova:tier-1', 'nonsense']
    expect(groupSlotsFor('nova', keys)).toEqual([{ kind: 'group', characterIds: ['kai', 'nova'], slot: 'polycule' }])
    expect(groupSlotsFor('priya', keys)).toEqual([])
  })
})

describe('the viewer', () => {
  it('steps without wrapping', () => {
    expect(stepIndex(0, 3, -1)).toBe(0)
    expect(stepIndex(0, 3, 1)).toBe(1)
    expect(stepIndex(2, 3, 1)).toBe(2)
    expect(stepIndex(0, 0, 1)).toBe(0)
  })

  it('reads a sideways drag as a swipe, and ignores short or mostly vertical ones', () => {
    expect(swipeDirection(-120, 10, 400)).toBe(1)
    expect(swipeDirection(120, -10, 400)).toBe(-1)
    expect(swipeDirection(-40, 0, 400)).toBe(0)
    expect(swipeDirection(-100, 150, 400)).toBe(0)
    // Wide screens need a longer swipe (18% of the width).
    expect(swipeDirection(-100, 0, 1000)).toBe(0)
    expect(swipeDirection(-200, 0, 1000)).toBe(1)
  })

  it('lets the picture follow the finger, a third of the way past either end', () => {
    expect(dragOffset(-90, 1, 3)).toBe(-90)
    expect(dragOffset(90, 0, 3)).toBe(30)
    expect(dragOffset(-90, 2, 3)).toBe(-30)
  })

  it('names a saved image after the character and the slot, with the type extension', () => {
    expect(imageFileName('Nova Castellanos', 'Rain check', 'image/webp')).toBe('nova-castellanos-rain-check.webp')
    expect(imageFileName('Zoë', 'Café noir', 'image/jpeg')).toBe('zoe-cafe-noir.jpg')
    expect(imageFileName('', '', 'application/octet-stream')).toBe('crushlab-art.png')
  })

  it("passes the engine's own import messages on, and says storage in plain words", () => {
    expect(importErrorText(new Error('That picture is over 20 MB. Pick a smaller one.'))).toBe('That picture is over 20 MB. Pick a smaller one.')
    expect(importErrorText(new Error('QuotaExceededError: the quota has been exceeded'))).toMatch(/storage may be full/)
    expect(importErrorText('nope')).toMatch(/storage may be full/)
  })
})

describe('the character list', () => {
  const sets = [
    { id: 'afterhours', name: 'Afterhours', characters: ['nova', 'kai', 'ghost'] },
    { id: 'polycule', name: 'The Polycule', characters: ['sol'] },
  ]
  const entries = {
    nova: { setId: 'afterhours', character: { id: 'nova', name: 'Nova Castellanos' } },
    kai: { setId: 'afterhours', character: { id: 'kai', name: 'Kai Okoro' } },
    sol: { setId: 'polycule', character: { id: 'sol', name: 'Sol' } },
  }
  const rels = { nova: { tiersUnlocked: [1, 2] as (1 | 2)[] } }
  const favorites = new Set(['nova:tier-2', 'group:kai+nova:polycule', 'kai:ending-good', 'sol:tier-1'])

  it('lists the active sets in order with unlocked counts and favorites', () => {
    const groups = galleryGroups(sets, entries, ['afterhours'], rels, favorites)
    expect(groups).toHaveLength(1)
    expect(groups[0].rows).toEqual([
      { id: 'nova', name: 'Nova Castellanos', unlocked: 2, favorites: 2 },
      { id: 'kai', name: 'Kai Okoro', unlocked: 0, favorites: 2 },
    ])
    expect(withFavorites(galleryGroups(sets, entries, ['afterhours', 'polycule'], rels, new Set(['nova:tier-1'])))).toEqual([
      { setId: 'afterhours', name: 'Afterhours', rows: [{ id: 'nova', name: 'Nova Castellanos', unlocked: 2, favorites: 1 }] },
    ])
  })

  it('orders favorites by character, then tiers, endings and group pictures', () => {
    const out = favoriteSlots(favorites, ['nova', 'kai'])
    expect(out.map((f) => [f.key, f.owner])).toEqual([
      ['nova:tier-2', 'nova'],
      // A group picture goes with whoever of them comes first in the list.
      ['group:kai+nova:polycule', 'nova'],
      ['kai:ending-good', 'kai'],
    ])
    // Sol isn't in the order given (their set is off): left out.
    expect(out.some((f) => f.owner === 'sol')).toBe(false)
  })
})

describe('endings in a gallery', () => {
  const betrayal: BetrayalEvent = { at: 1, kind: 'lie', note: '', affectionDelta: -5, trustDelta: -10 }

  it('shows none on a friend route', () => {
    expect(reachableEndings(nova, undefined, 'friend')).toEqual([])
  })

  it('offers Open and Polycule by how they date, Reconciliation only after a betrayal', () => {
    // Kai is monogamous: no Open or Polycule ending, unless the agreement already says so.
    expect(reachableEndings(kai, { agreement: { type: 'none', terms: '', madeAt: 0 }, betrayals: [] }, 'romantic')).toEqual([
      'good',
      'bitter',
      'hollow',
      'sacrifice',
    ])
    expect(reachableEndings(kai, { agreement: { type: 'poly', terms: '', madeAt: 1 }, betrayals: [betrayal] }, 'romantic')).toEqual([
      'good',
      'open',
      'polycule',
      'bitter',
      'hollow',
      'sacrifice',
      'reconciliation',
    ])
    // Nova dates openly.
    expect(reachableEndings(nova, undefined, 'romantic')).toContain('open')
  })

  it('keeps seen endings and reachable locked ones, drops the rest', () => {
    const good: ArtSlot = { kind: 'ending', characterId: 'kai', ending: 'good' }
    const poly: ArtSlot = { kind: 'ending', characterId: 'kai', ending: 'polycule' }
    const reachable = reachableEndings(kai, undefined, 'romantic')
    expect(visibleSlot({ slot: good, unlocked: false }, reachable)).toBe(true)
    expect(visibleSlot({ slot: poly, unlocked: false }, reachable)).toBe(false)
    expect(visibleSlot({ slot: poly, unlocked: true }, reachable)).toBe(true)
    expect(visibleSlot({ slot: { kind: 'tier', characterId: 'kai', tier: 5 }, unlocked: false }, [])).toBe(true)
  })
})
