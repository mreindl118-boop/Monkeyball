import { describe, expect, it } from 'vitest'
import { bundledEntry } from '../../data/bundled'
import { normalizeCharacter } from '../../mods/normalize'
import { validateCharacter } from '../../mods/validate'
import { TEMPLATES } from '../../prompts/build'
import {
  AGE_MESSAGE,
  anchorFor,
  cleanDraft,
  draftOf,
  editorIssues,
  fieldLabel,
  inFormOrder,
  issuesByAnchor,
  newDraft,
  parseAge,
  parseOptionalNumber,
  toggleIn,
  savedTraitIds,
  withLabel,
  worldRules,
} from './editorModel'

const nova = bundledEntry('nova')!.character

describe('drafts', () => {
  it('starts a new card with one blank row per trait list and five tiers', () => {
    const d = newDraft()
    expect(d.likes).toEqual([{ id: '', label: '' }])
    expect(d.turnOffs).toHaveLength(1)
    expect(d.gallery.map((t) => [t.tier, t.unlockAt])).toEqual([
      [1, 20],
      [2, 40],
      [3, 60],
      [4, 80],
      [5, 100],
    ])
    expect(d.difficulty).toBe('normal')
    expect(Number.isNaN(d.age)).toBe(true)
  })

  it('copies a card with the gallery in tier order, without touching the original', () => {
    const shuffled = { ...nova, gallery: [...nova.gallery].reverse() }
    const d = draftOf(shuffled)
    expect(d.gallery.map((t) => t.tier)).toEqual([1, 2, 3, 4, 5])
    d.likes[0].label = 'changed'
    expect(nova.likes[0].label).not.toBe('changed')
  })

  it('a bundled card survives the draft round trip unchanged and valid', () => {
    const card = cleanDraft(draftOf(nova))
    expect(card).toEqual(normalizeCharacter(nova))
    expect(validateCharacter(card, { setCharacterIds: ['nova', 'kai'] })).toEqual([])
  })

  it('trims text and drops empty optional fields', () => {
    const d = { ...draftOf(nova), name: '  Nova  ', identity: '   ', orientation: ' bi ', bodyNotes: '', partners: [] }
    const c = cleanDraft(d)
    expect(c.name).toBe('Nova')
    expect(c.orientation).toBe('bi')
    expect('identity' in c).toBe(false)
    expect('bodyNotes' in c).toBe(false)
    expect('partners' in c).toBe(false)
  })

  it('keeps the ace spectrum only with its parts set', () => {
    const on = cleanDraft({ ...draftOf(nova), aceSpectrum: { label: ' Demisexual ', heatUnlockTrust: Number.NaN } })
    expect(on.aceSpectrum).toEqual({ label: 'Demisexual' })
    const off = cleanDraft({ ...draftOf(nova), aceSpectrum: undefined })
    expect('aceSpectrum' in off).toBe(false)
  })
})

describe('trait ids follow labels until edited', () => {
  it('fills an empty id from the label', () => {
    expect(withLabel({ id: '', label: '' }, 'Slow dancing')).toEqual({ id: 'slow-dancing', label: 'Slow dancing' })
  })

  it('keeps following while the id is still the old slug', () => {
    expect(withLabel({ id: 'slow-dancing', label: 'Slow dancing' }, 'Slow dancing alone')).toEqual({
      id: 'slow-dancing-alone',
      label: 'Slow dancing alone',
    })
  })

  it('leaves a hand-written id alone', () => {
    expect(withLabel({ id: 'slow-dance', label: 'Slow dancing' }, 'Slow dancing alone').id).toBe('slow-dance')
  })

  it("never moves an id the saved card already had (discoveries are stored by id)", () => {
    const saved = savedTraitIds({
      likes: [{ id: 'late-night-diners', label: 'Late night diners' }],
      dislikes: [],
      turnOns: [],
      turnOffs: [{ id: '', label: '' }],
    })
    expect([...saved]).toEqual(['late-night-diners'])
    expect(withLabel({ id: 'late-night-diners', label: 'Late night diners' }, 'Late-night diners with friends', saved)).toEqual({
      id: 'late-night-diners',
      label: 'Late-night diners with friends',
    })
    // A row added in this session still follows its label.
    expect(withLabel({ id: 'karaoke', label: 'Karaoke' }, 'Karaoke duets', saved).id).toBe('karaoke-duets')
    expect(savedTraitIds(null).size).toBe(0)
  })
})

describe('inputs', () => {
  it('toggles ids in pick order', () => {
    expect(toggleIn(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(toggleIn(['a', 'b'], 'a', true)).toEqual(['a', 'b'])
    expect(toggleIn(['a', 'b'], 'a', false)).toEqual(['b'])
  })

  it('parses ages and optional numbers', () => {
    expect(parseAge('28')).toBe(28)
    expect(Number.isNaN(parseAge(''))).toBe(true)
    expect(Number.isNaN(parseAge('abc'))).toBe(true)
    expect(parseOptionalNumber('')).toBeUndefined()
    expect(parseOptionalNumber('60')).toBe(60)
  })
})

describe('age rule', () => {
  it('rejects under 21 in the editor wording', () => {
    const card = { ...draftOf(nova), age: 18 }
    const issues = editorIssues(validateCharacter(card, { setCharacterIds: ['nova', 'kai'] }), card.age)
    expect(issues).toEqual([{ field: 'age', message: `${AGE_MESSAGE}.` }])
    expect(AGE_MESSAGE).toBe('Characters must be 21 or older')
  })

  it('keeps the validator wording for a missing age', () => {
    const card = { ...draftOf(nova), age: Number.NaN }
    const issues = editorIssues(validateCharacter(card, { setCharacterIds: ['nova', 'kai'] }), card.age)
    expect(issues[0].field).toBe('age')
    expect(issues[0].message).toMatch(/required/)
  })
})

describe('where messages go', () => {
  it('maps field paths to control ids', () => {
    expect(anchorFor('name')).toBe('ed-name')
    expect(anchorFor('likes[2].id')).toBe('ed-likes-2-id')
    expect(anchorFor('favoriteVenues[1]')).toBe('ed-favoriteVenues')
    expect(anchorFor('attractedTo[0]')).toBe('ed-attractedTo')
    expect(anchorFor('gallery[3].unlockAt')).toBe('ed-gallery-3-title')
    expect(anchorFor('aceSpectrum.heatCap')).toBe('ed-aceSpectrum-heatCap')
    expect(anchorFor('endings.good')).toBe('')
    expect(anchorFor('prompts.story')).toBe('')
  })

  it('groups messages by control, without repeats', () => {
    const map = issuesByAnchor([
      { field: 'hatedVenues[0]', message: 'A' },
      { field: 'hatedVenues[1]', message: 'A' },
      { field: 'hatedVenues', message: 'B' },
      { field: 'endings.good', message: 'C' },
    ])
    expect(map.get('ed-hatedVenues')).toEqual(['A', 'B'])
    expect(map.size).toBe(1)
  })

  it('names fields for the summary', () => {
    expect(fieldLabel('age')).toBe('Age')
    expect(fieldLabel('likes[2].id')).toBe('Like 3 id')
    expect(fieldLabel('turnOffs[0].label')).toBe('Turn-off 1')
    expect(fieldLabel('gallery[1].scene')).toBe('Tier 2 scene')
    expect(fieldLabel('gallery[4].unlockAt')).toBe('Tier 5 title')
    expect(fieldLabel('partners[0].characterId')).toBe('Partner 1')
    expect(fieldLabel('secrets[1].unlockAt')).toBe('Secret 2 unlock')
    expect(fieldLabel('favoriteVenues[3]')).toBe('Favorite venues')
    expect(fieldLabel('endings.good.scene')).toBe('Endings')
  })
})

describe('inFormOrder', () => {
  it('sorts issues the way the form reads, rows in order, stable otherwise', () => {
    const sorted = inFormOrder([
      { field: 'opener', message: 'o' },
      { field: 'likes[1].id', message: 'l1' },
      { field: 'endings.good', message: 'e' },
      { field: 'name', message: 'n' },
      { field: 'likes[0].label', message: 'l0' },
      { field: 'id', message: 'i' },
      { field: 'look', message: 'x1' },
      { field: 'look', message: 'x2' },
    ])
    expect(sorted.map((i) => i.message)).toEqual(['n', 'i', 'x1', 'x2', 'o', 'l0', 'l1', 'e'])
  })
})

describe('world rules', () => {
  it('quotes the story prompt block with the name filled in', () => {
    const rules = worldRules(TEMPLATES.story, 'Sam')
    expect(rules).toHaveLength(3)
    expect(rules[0]).toMatch(/^Everyone in this world is a fictional adult aged 21 or older/)
    expect(rules.join(' ')).toContain('Sam shuts it down in character')
    expect(rules.join(' ')).not.toContain('{name}')
    expect(rules.every((r) => !r.startsWith('-'))).toBe(true)
  })

  it('is empty for a template without the block', () => {
    expect(worldRules('no rules here', 'Sam')).toEqual([])
  })
})
