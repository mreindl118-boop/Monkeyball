import { describe, expect, it } from 'vitest'
import novaJson from '../data/sets/afterhours/characters/nova.json'
import type { Character, SetManifest } from '../types'
import { normalizeCharacter } from './normalize'
import { validateCharacter, validateManifest, type ValidateContext } from './validate'

const nova = (): Character => normalizeCharacter(novaJson)
const ctx: ValidateContext = { setCharacterIds: ['nova', 'kai'] }
const fields = (c: Character, x: ValidateContext = ctx) => validateCharacter(c, x).map((i) => i.field)
const messages = (c: Character, x: ValidateContext = ctx) => validateCharacter(c, x).map((i) => i.message)

describe('validateCharacter', () => {
  it('passes the reference card', () => {
    expect(validateCharacter(nova(), ctx)).toEqual([])
  })

  it('rejects a typed 18 with a clear message, and accepts 21', () => {
    const c = nova()
    c.age = 18
    expect(validateCharacter(c, ctx)).toEqual([
      { field: 'age', message: "Age 18 isn't allowed. Every character in crushLAB is 21 or older, with an adult life and job." },
    ])
    c.age = 20
    expect(fields(c)).toEqual(['age'])
    c.age = 21
    expect(validateCharacter(c, ctx)).toEqual([])
    c.age = 64
    expect(validateCharacter(c, ctx)).toEqual([])
  })

  it('wants a whole-number age that is there', () => {
    const c = nova()
    c.age = 25.5
    expect(messages(c)).toEqual(['Age must be a whole number.'])
    c.age = Number.NaN
    expect(messages(c)).toEqual(['Age is required. Every character is 21 or older.'])
    expect(fields(normalizeCharacter({ ...novaJson, age: '18' }))).toEqual(['age'])
  })

  it('requires the text fields', () => {
    const c = nova()
    c.name = ' '
    c.look = ''
    c.opener = ''
    expect(fields(c)).toEqual(['name', 'look', 'opener'])
  })

  it('needs attractions from the three genders', () => {
    const c = nova()
    c.attractedTo = []
    expect(fields(c)).toEqual(['attractedTo'])
    expect(fields(normalizeCharacter({ ...novaJson, attractedTo: ['women', 'robots'] }))).toEqual(['attractedTo[1]'])
    expect(fields(normalizeCharacter({ ...novaJson, gender: 'robot' }))).toEqual(['gender'])
  })

  it('checks the enums', () => {
    const c = normalizeCharacter({ ...novaJson, relationshipStyle: 'swinging', jealousy: 'none', difficulty: 'brutal' })
    expect(fields(c)).toEqual(['relationshipStyle', 'jealousy', 'difficulty'])
  })

  it('rejects duplicate trait ids within and across the four lists', () => {
    const c = nova()
    c.turnOns = [...c.turnOns, { id: 'vinyl', label: 'Records, again' }]
    c.dislikes = [...c.dislikes, { id: 'phones', label: 'Phones, again' }]
    const issues = validateCharacter(c, ctx)
    expect(issues.map((i) => i.field)).toEqual(['dislikes[4].id', 'turnOns[4].id'])
    expect(issues[0].message).toBe('Trait id "phones" is used twice in dislikes. Every trait id on a card must be different.')
    expect(issues[1].message).toBe('Trait id "vinyl" is used in both likes and turn-ons. Every trait id on a card must be different.')
  })

  it('wants trait ids and labels, and at least one trait per list', () => {
    const c = nova()
    c.likes = [{ id: '', label: 'Something' }, { id: 'Bad Id', label: '' }]
    c.turnOffs = []
    expect(fields(c)).toEqual(['likes[0].id', 'likes[1].label', 'likes[1].id', 'turnOffs'])
  })

  it('rejects unknown venues and gifts, repeats and contradictions', () => {
    const c = nova()
    c.favoriteVenues = ['record-store', 'moon-base', 'record-store']
    c.hatedVenues = ['record-store']
    c.lovedGifts = ['rare-vinyl', 'yacht']
    const issues = validateCharacter(c, ctx)
    expect(issues).toEqual([
      { field: 'favoriteVenues[1]', message: '"moon-base" isn\'t a known venue.' },
      { field: 'favoriteVenues[2]', message: '"record-store" is listed twice.' },
      { field: 'lovedGifts[1]', message: '"yacht" isn\'t a known gift.' },
      { field: 'hatedVenues', message: '"record-store" can\'t be both a favorite and a hated venue.' },
    ])
  })

  it('uses the known venue and gift lists it is given', () => {
    const c = nova()
    expect(fields(c, { ...ctx, knownVenueIds: ['record-store'], knownGiftIds: ['rare-vinyl', 'hot-sauce', 'flowers'] })).toEqual([
      'favoriteVenues[1]',
      'favoriteVenues[2]',
      'hatedVenues[0]',
      'hatedVenues[1]',
    ])
  })

  it('needs a favorite venue for the epilogue', () => {
    const c = nova()
    c.favoriteVenues = []
    expect(fields(c)).toEqual(['favoriteVenues'])
  })

  it('wants partners in the same set', () => {
    const c = nova()
    expect(validateCharacter(c, { setCharacterIds: ['nova'] })).toEqual([
      {
        field: 'partners[0].characterId',
        message: 'Partner "kai" isn\'t in this set. Partners and exes must be characters in the same set.',
      },
    ])
    c.partners = [{ characterId: 'nova', relation: 'ex' }]
    expect(messages(c)).toEqual(["A character can't be their own partner."])
    c.partners = [{ characterId: 'kai', relation: 'lover' as never }]
    expect(fields(c)).toEqual(['partners[0].relation'])
  })

  it('checks the gallery: five tiers at 20, 40, 60, 80 and 100', () => {
    const c = nova()
    c.gallery = c.gallery.slice(0, 4)
    expect(messages(c)).toEqual(['The gallery needs exactly five tiers, 1 to 5 (it has 4).'])
    const d = nova()
    d.gallery[2] = { ...d.gallery[2], unlockAt: 50 as never }
    expect(messages(d)).toEqual(['Tier 3 unlocks at 60 affection.'])
    const e = nova()
    e.gallery[4] = { ...e.gallery[4], tier: 4 }
    expect(fields(e)).toEqual(['gallery[4].tier', 'gallery[4].unlockAt', 'gallery'])
    const f = nova()
    f.gallery[0] = { ...f.gallery[0], title: '', scene: '' }
    expect(fields(f)).toEqual(['gallery[0].title', 'gallery[0].scene'])
  })

  it('wants a hex accent', () => {
    const c = nova()
    c.accent = 'teal'
    expect(fields(c)).toEqual(['accent'])
    c.accent = '#3fb'
    expect(fields(c)).toEqual([])
    expect(normalizeCharacter({ ...novaJson, accent: '3FB8AF' }).accent).toBe('#3FB8AF')
  })

  it('wants secrets that unlock between 0 and 100', () => {
    const c = nova()
    c.secrets = [
      { unlockAt: 60, text: 'ok' },
      { unlockAt: 120, text: 'too late' },
      { unlockAt: Number.NaN, text: 'never' },
      { unlockAt: 0, text: '' },
    ]
    expect(fields(c)).toEqual(['secrets[1].unlockAt', 'secrets[2].unlockAt', 'secrets[3].text'])
  })

  it('checks the ace spectrum', () => {
    const c = nova()
    c.aceSpectrum = { label: '', heatCap: 7 as never, heatUnlockTrust: 140 }
    expect(fields(c)).toEqual(['aceSpectrum.label', 'aceSpectrum.heatCap', 'aceSpectrum.heatUnlockTrust'])
  })

  it('rejects an id that is taken, reserved or badly formed', () => {
    const c = nova()
    expect(messages(c, { ...ctx, existingIds: ['nova'] })).toEqual([
      'Another character already uses the id "nova". Pick a different one.',
    ])
    expect(messages(c, { ...ctx, reservedIds: ['nova'] })).toEqual([
      'The id "nova" is kept for a character in a set that ships with crushLAB. Pick a different one.',
    ])
    c.id = 'Nova Castellanos'
    expect(fields(c)).toEqual(['id'])
    c.id = ''
    expect(fields(c)).toEqual(['id'])
  })

  it('includes the safety scan', () => {
    const c = nova()
    c.look = 'Looks about 17, teal undercut'
    expect(validateCharacter(c, ctx)).toEqual([
      { field: 'look', message: 'Look says "Looks about 17". Every character is 21 or older, and looks it.' },
    ])
  })

  it('checks optional endings', () => {
    const c = nova()
    c.endings = { good: { title: 'Encore', scene: '' }, weird: { title: 'x', scene: 'y' } } as never
    expect(fields(c)).toEqual(['endings.good', 'endings.weird'])
  })
})

describe('validateManifest', () => {
  const base = (): SetManifest => ({
    id: 'my-pack',
    name: 'My pack',
    blurb: 'Two people and a bar.',
    heat: 2,
    characters: ['sam', 'lee'],
    relationships: [{ a: 'sam', b: 'lee', kind: 'ex', note: 'It ended fine.' }],
    rumors: [{ id: 'r1', teller: 'sam', about: ['lee'], text: 'Lee sings in the shower.', truth: 'true' }],
  })

  it('passes a good manifest', () => {
    expect(validateManifest(base(), { characterIds: ['sam', 'lee'] })).toEqual([])
  })

  it('requires id, name, blurb and characters', () => {
    const m = { ...base(), id: '', name: '', blurb: '', characters: [], relationships: [], rumors: [] }
    expect(validateManifest(m).map((i) => i.field)).toEqual(['id', 'name', 'blurb', 'characters'])
  })

  it('checks heat, duplicates and missing cards', () => {
    const m = { ...base(), heat: 9 as never, characters: ['sam', 'lee', 'sam'] }
    expect(validateManifest(m, { characterIds: ['sam'] }).map((i) => i.field)).toEqual([
      'heat',
      'characters[1]', // lee has no card
      'characters[2]', // sam twice
    ])
  })

  it('keeps relationships and rumors inside the set', () => {
    const m = base()
    m.relationships.push({ a: 'sam', b: 'nova', kind: 'friend', note: 'x' }, { a: 'sam', b: 'lee', kind: 'lover' as never, note: '' })
    m.rumors!.push({ id: 'r1', teller: 'kai', about: [], text: '', truth: 'maybe' as never })
    expect(validateManifest(m).map((i) => i.field)).toEqual([
      'relationships[1].b',
      'relationships[2].kind',
      'rumors[1].id',
      'rumors[1].teller',
      'rumors[1].about',
      'rumors[1].text',
      'rumors[1].truth',
    ])
  })

  it('lets a set that knows other sets pair its characters with theirs', () => {
    const m = { ...base(), knows: ['afterhours'] }
    m.relationships.push({ a: 'sam', b: 'nova', kind: 'friend', note: 'Regular at the Low Tide.' })
    expect(validateManifest(m)).toEqual([])
    m.relationships.push({ a: 'kai', b: 'nova', kind: 'friend', note: 'Not ours.' })
    expect(validateManifest(m).map((i) => i.field)).toEqual(['relationships[2].a', 'relationships[2].b'])
  })

  it('keeps partners and exes inside the set, even with knows', () => {
    for (const kind of ['partner', 'ex', 'situationship'] as const) {
      const m = { ...base(), knows: ['afterhours'] }
      m.relationships.push({ a: 'sam', b: 'nova', kind, note: '' })
      expect(validateManifest(m).map((i) => i.field)).toEqual(['relationships[1].kind'])
    }
  })

  it('checks that the other character is in a set it knows, when the roster is at hand', () => {
    const m = { ...base(), knows: ['afterhours'] }
    m.relationships.push({ a: 'sam', b: 'nova', kind: 'friend', note: '' }, { a: 'lee', b: 'mia', kind: 'rival', note: '' })
    const sets: Record<string, string> = { nova: 'afterhours', mia: 'other-pack' }
    const issues = validateManifest(m, { setOfCharacter: (id) => sets[id] })
    expect(issues.map((i) => i.field)).toEqual(['relationships[2].b'])
    expect(issues[0].message).toMatch(/"other-pack", a set this one doesn't list under knows/)
    expect(validateManifest(m, { setOfCharacter: (id) => (id === 'nova' ? 'afterhours' : undefined) }).map((i) => i.field)).toEqual([
      'relationships[2].b',
    ])
  })

  it('rejects a taken set id and runs the safety scan', () => {
    expect(validateManifest(base(), { existingSetIds: ['my-pack'] }).map((i) => i.field)).toEqual(['id'])
    expect(validateManifest({ ...base(), blurb: 'Teen drama.' }).map((i) => i.field)).toEqual(['blurb'])
  })
})
