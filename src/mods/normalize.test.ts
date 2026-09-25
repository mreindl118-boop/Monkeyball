import { describe, expect, it } from 'vitest'
import novaJson from '../data/sets/afterhours/characters/nova.json'
import { emptyCharacter, normalizeAttractions, normalizeCharacter, normalizeManifest, slugify } from './normalize'

describe('normalizeCharacter', () => {
  it("folds Nova's plural genders to the singular values", () => {
    expect(novaJson.attractedTo).toEqual(['women', 'men', 'nonbinary'])
    const nova = normalizeCharacter(novaJson)
    expect(nova.attractedTo).toEqual(['woman', 'man', 'nonbinary'])
    expect(nova.gender).toBe('woman')
    expect(nova.likes).toEqual(novaJson.likes)
    expect(nova.gallery).toEqual(novaJson.gallery)
    expect(nova.partners).toEqual([{ characterId: 'kai', relation: 'ex' }])
  })

  it('accepts variant gender words, strings and "everyone"', () => {
    expect(normalizeAttractions(['Women', 'enbies', 'men'])).toEqual(['woman', 'nonbinary', 'man'])
    expect(normalizeAttractions('women, men and nonbinary people')).toEqual(['woman', 'man', 'nonbinary'])
    expect(normalizeAttractions('everyone')).toEqual(['woman', 'man', 'nonbinary'])
    expect(normalizeAttractions(['woman', 'women'])).toEqual(['woman'])
    // Unknown words are kept so the validator can name them.
    expect(normalizeAttractions(['women', 'robots'])).toEqual(['woman', 'robots'])
    expect(normalizeCharacter({ gender: 'Female' }).gender).toBe('woman')
  })

  it('fills missing optional arrays and leaves optional fields unset', () => {
    const c = normalizeCharacter({ id: 'sam', name: 'Sam', age: 30, gender: 'man' })
    for (const key of ['likes', 'dislikes', 'turnOns', 'turnOffs', 'favoriteVenues', 'hatedVenues', 'lovedGifts', 'hatedGifts', 'secrets', 'gallery'] as const) {
      expect(c[key]).toEqual([])
    }
    expect(c.attractedTo).toEqual([])
    expect(c.partners).toBeUndefined()
    expect(c.aceSpectrum).toBeUndefined()
    expect(c.bodyNotes).toBeUndefined()
    expect('identity' in c).toBe(false)
    expect(c.difficulty).toBe('normal')
  })

  it('reads loose forms: numeric strings, string traits, snake_case, aliases', () => {
    const c = normalizeCharacter({
      id: ' sam ',
      age: ' 34 ',
      attracted_to: ['men'],
      relationship_style: 'Poly',
      jealousy: 'LOW',
      accent: '3fb8af',
      art_tags: ['adult man', '34 years old'],
      likes: ['Slow dancing in an empty room', { label: 'Rainy nights' }],
      turn_ons: [{ id: 'banter', text: 'Getting out-bantered' }],
      favorite_venues: 'arcade, boardwalk',
      partners: [{ id: 'kai', kind: 'Ex' }],
      aceSpectrum: 'Demisexual',
      gallery: [{ tier: '2', title: 'T', scene: 'S' }],
      secrets: [{ unlockAt: '60', text: 'x' }],
    })
    expect(c.id).toBe('sam')
    expect(c.age).toBe(34)
    expect(c.attractedTo).toEqual(['man'])
    expect(c.relationshipStyle).toBe('polyamorous')
    expect(c.jealousy).toBe('low')
    expect(c.accent).toBe('#3fb8af')
    expect(c.artTags).toBe('adult man, 34 years old')
    expect(c.likes).toEqual([
      { id: 'slow-dancing-in-an-empty-room', label: 'Slow dancing in an empty room' },
      { id: 'rainy-nights', label: 'Rainy nights' },
    ])
    expect(c.turnOns).toEqual([{ id: 'banter', label: 'Getting out-bantered' }])
    expect(c.favoriteVenues).toEqual(['arcade', 'boardwalk'])
    expect(c.partners).toEqual([{ characterId: 'kai', relation: 'ex' }])
    expect(c.aceSpectrum).toEqual({ label: 'Demisexual' })
    expect(c.gallery).toEqual([{ tier: 2, unlockAt: 40, title: 'T', scene: 'S' }])
    expect(c.secrets).toEqual([{ unlockAt: 60, text: 'x' }])
  })

  it('keeps a typed 18 as 18 (the validator rejects it) and a missing age as NaN', () => {
    expect(normalizeCharacter({ age: 18 }).age).toBe(18)
    expect(normalizeCharacter({ age: '18' }).age).toBe(18)
    expect(normalizeCharacter({}).age).toBeNaN()
    expect(normalizeCharacter({ age: 'old enough' }).age).toBeNaN()
  })

  it('never throws on junk', () => {
    for (const junk of [null, undefined, 42, 'nova', [], { likes: 'x', gallery: {}, partners: 3 }]) {
      expect(() => normalizeCharacter(junk)).not.toThrow()
    }
  })

  it('makes a blank card with the gallery laid out', () => {
    const c = emptyCharacter('new')
    expect(c.id).toBe('new')
    expect(c.gallery.map((t) => [t.tier, t.unlockAt])).toEqual([[1, 20], [2, 40], [3, 60], [4, 80], [5, 100]])
  })
})

describe('normalizeManifest', () => {
  it('accepts aliases and character objects', () => {
    const m = normalizeManifest({
      id: 'my-pack',
      title: 'My pack',
      description: 'A pack.',
      author: 'Me',
      heatRecommendation: '3',
      characters: [{ id: 'sam' }, 'lee'],
      relationships: [{ a: 'sam', b: 'lee', type: 'Friend', note: 'Old friends.' }],
      rumors: [{ id: 'r1', teller: 'sam', about: 'lee', text: 'x', truth: 'True' }],
      knows: 'afterhours',
    })
    expect(m).toEqual({
      id: 'my-pack',
      name: 'My pack',
      blurb: 'A pack.',
      author: 'Me',
      heat: 3,
      characters: ['sam', 'lee'],
      relationships: [{ a: 'sam', b: 'lee', kind: 'friend', note: 'Old friends.' }],
      rumors: [{ id: 'r1', teller: 'sam', about: ['lee'], text: 'x', truth: 'true' }],
      knows: ['afterhours'],
    })
  })

  it('defaults missing lists', () => {
    expect(normalizeManifest({ id: 'x' })).toEqual({ id: 'x', name: '', blurb: '', characters: [], relationships: [] })
  })
})

describe('slugify', () => {
  it('makes ids from labels', () => {
    expect(slugify('3am diner food!')).toBe('3am-diner-food')
    expect(slugify('Café au lait')).toBe('cafe-au-lait')
    expect(slugify('x'.repeat(60))).toHaveLength(40)
  })
})
