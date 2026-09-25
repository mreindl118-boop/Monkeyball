import { describe, expect, it } from 'vitest'
import { BUNDLED_CHARACTERS, BUNDLED_SETS } from '../../data/bundled'
import { newRelationship } from '../../engine/relationship'
import { customSetManifest, type RosterData } from '../../store/roster'
import type { Character, PlayerProfile, Relationship, RosterEntry } from '../../types'
import {
  discoveredCount,
  effectiveSetFilter,
  greetingFor,
  highestTier,
  hubCard,
  hubView,
  regularsText,
  sortCards,
  totalTraits,
  type HubInput,
} from './hubModel'

const data: RosterData = {
  sets: [...BUNDLED_SETS],
  entries: Object.fromEntries(BUNDLED_CHARACTERS.map((e) => [e.character.id, e])),
}

const woman: PlayerProfile = {
  name: 'Ana',
  gender: 'woman',
  pronouns: 'she/her',
  bodyNotes: '',
  relationshipStyle: 'monogamous',
}

function rel(id: string, patch: Partial<Relationship> = {}): Relationship {
  return { ...newRelationship(id), ...patch }
}

function input(patch: Partial<HubInput['settings']> = {}, relationships: Record<string, Relationship> = {}): HubInput {
  return {
    settings: {
      activeSets: ['afterhours'],
      showMe: 'everyone',
      hubSetFilter: 'all',
      hubSort: 'affection',
      orientationMode: 'realistic',
      ...patch,
    },
    relationships,
    profile: woman,
  }
}

const nova = data.entries.nova.character

describe('trait counts', () => {
  it('totals the four lists', () => {
    expect(totalTraits(nova)).toBe(nova.likes.length + nova.dislikes.length + nova.turnOns.length + nova.turnOffs.length)
  })

  it('counts each discovered trait once, and only traits still on the card', () => {
    const r = rel('nova', {
      discovered: [
        { type: 'like', id: 'vinyl', hint: 'She grins', at: 1 },
        { type: 'like', id: 'vinyl', hint: 'Again', at: 2 },
        { type: 'turnOff', id: 'cute', hint: 'Her jaw tightens', at: 3 },
        { type: 'like', id: 'gone-from-card', hint: '', at: 4 },
        // Right id, wrong list: doesn't count.
        { type: 'dislike', id: 'vinyl', hint: '', at: 5 },
      ],
    })
    expect(discoveredCount(nova, r)).toBe(2)
  })
})

describe('highestTier', () => {
  it('is the top unlocked tier, or undefined', () => {
    expect(highestTier(rel('x'))).toBeUndefined()
    expect(highestTier(rel('x', { tiersUnlocked: [1, 3, 2] }))).toBe(3)
  })
})

describe('sortCards', () => {
  const cards = ['nova', 'kai', 'dex'].map((id, i) =>
    hubCard(data.entries[id], rel(id, { affection: [30, 50, 30][i], trust: [10, 5, 40][i] }), woman, 'realistic'),
  )
  const ids = (list: typeof cards) => list.map((c) => c.entry.character.id)

  it('sorts by affection high to low, ties by name', () => {
    expect(ids(sortCards(cards, 'affection'))).toEqual(['kai', 'dex', 'nova'])
  })

  it('sorts by trust high to low', () => {
    expect(ids(sortCards(cards, 'trust'))).toEqual(['dex', 'nova', 'kai'])
  })

  it('sorts by name A to Z', () => {
    expect(ids(sortCards(cards, 'name'))).toEqual(['dex', 'kai', 'nova'])
  })

  it("doesn't change the input", () => {
    const before = ids(cards)
    sortCards(cards, 'name')
    expect(ids(cards)).toEqual(before)
  })
})

describe('effectiveSetFilter', () => {
  it('keeps an active set and falls back to all otherwise', () => {
    expect(effectiveSetFilter('afterhours', ['afterhours'])).toBe('afterhours')
    expect(effectiveSetFilter('gone', ['afterhours'])).toBe('all')
    expect(effectiveSetFilter('all', [])).toBe('all')
  })
})

describe('hubView', () => {
  it('groups the active set with every character, sorted', () => {
    const v = hubView(data, input({}, { priya: rel('priya', { affection: 70 }) }))
    expect(v.groups).toHaveLength(1)
    expect(v.groups[0].set.id).toBe('afterhours')
    expect(v.shown).toBe(12)
    expect(v.groups[0].cards[0].entry.character.id).toBe('priya')
  })

  it('shows nothing when no set is active', () => {
    const v = hubView(data, input({ activeSets: [] }))
    expect(v.activeCount).toBe(0)
    expect(v.groups).toEqual([])
  })

  it('filters by Show me without losing the active count', () => {
    const men = hubView(data, input({ showMe: 'men' }))
    expect(men.activeCount).toBe(12)
    expect(men.groups[0].cards.every((c) => c.entry.character.gender === 'man')).toBe(true)
    expect(men.shown).toBe(men.groups[0].cards.length)
  })

  it('marks the friend route from the orientation mode', () => {
    // Sasha is into women only; Jules into men only.
    const realistic = hubView(data, input())
    const jules = realistic.groups[0].cards.find((c) => c.entry.character.id === 'jules')
    const sasha = realistic.groups[0].cards.find((c) => c.entry.character.id === 'sasha')
    expect(jules?.route).toBe('friend')
    expect(sasha?.route).toBe('romantic')
    const everyone = hubView(data, input({ orientationMode: 'everyone' }))
    expect(everyone.groups[0].cards.every((c) => c.route === 'romantic')).toBe(true)
  })

  it('applies the set filter and ignores a stale one', () => {
    const custom: Character = { ...nova, id: 'sam', name: 'Sam Ortiz', partners: undefined }
    const entry: RosterEntry = { character: custom, setId: 'custom', source: 'custom' }
    const two: RosterData = { sets: [...data.sets, customSetManifest(['sam'])], entries: { ...data.entries, sam: entry } }
    const both = hubView(two, input({ activeSets: ['afterhours', 'custom'] }))
    expect(both.groups.map((g) => g.set.id)).toEqual(['afterhours', 'custom'])
    const onlyCustom = hubView(two, input({ activeSets: ['afterhours', 'custom'], hubSetFilter: 'custom' }))
    expect(onlyCustom.groups.map((g) => g.set.id)).toEqual(['custom'])
    const stale = hubView(two, input({ activeSets: ['afterhours'], hubSetFilter: 'custom' }))
    expect(stale.setFilter).toBe('all')
    expect(stale.groups.map((g) => g.set.id)).toEqual(['afterhours'])
  })
})

describe('copy', () => {
  it('pluralizes regulars', () => {
    expect(regularsText(1)).toBe('1 regular')
    expect(regularsText(12)).toBe('12 regulars')
  })

  it('greets by the hour', () => {
    expect(greetingFor(2)).toBe('Still up')
    expect(greetingFor(9)).toBe('Morning')
    expect(greetingFor(15)).toBe('Afternoon')
    expect(greetingFor(22)).toBe('Evening')
  })
})
