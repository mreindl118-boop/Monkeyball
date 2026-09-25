import { describe, expect, it } from 'vitest'
import { BUNDLED_CHARACTERS, BUNDLED_SET_IDS, bundledSet } from '../../data/bundled'
import type { ImportResult } from '../../mods/pack'
import { validateManifest } from '../../mods/validate'
import { CUSTOM_SET_ID, type ImportOutcome } from '../../store/roster'
import type { Character, RosterEntry, SetManifest } from '../../types'
import {
  characterCount,
  errorWhere,
  heatText,
  importReport,
  removeMessage,
  replaceMessage,
  packManifest,
  relationKindText,
  setRelationLines,
  setSource,
  withPartners,
} from './setsModel'

const entries: Record<string, RosterEntry> = Object.fromEntries(BUNDLED_CHARACTERS.map((e) => [e.character.id, e]))
const afterhours = bundledSet('afterhours')!

function custom(id: string, partners: Character['partners'] = []): RosterEntry {
  const base = entries.nova.character
  return { character: { ...base, id, name: id.toUpperCase(), partners }, setId: CUSTOM_SET_ID, source: 'custom' }
}

describe('labels', () => {
  it('knows where a set came from', () => {
    expect(setSource('afterhours', BUNDLED_SET_IDS)).toBe('bundled')
    expect(setSource(CUSTOM_SET_ID, BUNDLED_SET_IDS)).toBe('custom')
    expect(setSource('night-owls', BUNDLED_SET_IDS)).toBe('imported')
  })

  it('counts and heat', () => {
    expect(characterCount(1)).toBe('1 character')
    expect(characterCount(12)).toBe('12 characters')
    expect(heatText(2)).toBe('2, Flirty')
    expect(heatText(undefined)).toBe('')
  })

  it('reads relation kinds as plural phrases', () => {
    expect(relationKindText('ex')).toBe('exes')
    expect(relationKindText('situationship')).toBe('a situationship')
    expect(relationKindText('roommate')).toBe('roommates')
  })
})

describe('setRelationLines', () => {
  it("lists the manifest's relationships with names and notes, each pair once", () => {
    const lines = setRelationLines(afterhours, entries)
    const exes = lines.find((l) => l.a === 'nova' && l.b === 'kai')
    expect(exes).toMatchObject({ aName: 'Nova Castellanos', kind: 'ex' })
    expect(exes?.note).toMatch(/ended loud/)
    // Nova's card also lists Kai as an ex: not repeated.
    expect(lines.filter((l) => l.kind === 'ex' && [l.a, l.b].includes('nova'))).toHaveLength(1)
  })

  it('adds partners that only a card declares', () => {
    const a = custom('aa', [{ characterId: 'bb', relation: 'partner' }])
    const b = custom('bb', [{ characterId: 'aa', relation: 'partner' }])
    const set: SetManifest = { id: CUSTOM_SET_ID, name: 'My characters', blurb: '', characters: ['aa', 'bb'], relationships: [] }
    const lines = setRelationLines(set, { aa: a, bb: b })
    expect(lines).toEqual([{ a: 'aa', b: 'bb', aName: 'AA', bName: 'BB', kind: 'partner', note: '' }])
  })
})

describe('withPartners', () => {
  it('brings partners in the same set along, transitively', () => {
    const all = {
      aa: custom('aa', [{ characterId: 'bb', relation: 'ex' }]),
      bb: custom('bb', [{ characterId: 'cc', relation: 'partner' }]),
      cc: custom('cc'),
      dd: custom('dd'),
    }
    expect(withPartners('aa', all).map((c) => c.id)).toEqual(['aa', 'bb', 'cc'])
    expect(withPartners('dd', all).map((c) => c.id)).toEqual(['dd'])
    expect(withPartners('missing', all)).toEqual([])
  })

  it("doesn't cross sets", () => {
    const aa = custom('aa', [{ characterId: 'kai', relation: 'ex' }])
    expect(withPartners('aa', { ...entries, aa }).map((c) => c.id)).toEqual(['aa'])
  })
})

describe('importReport', () => {
  const result = (errors: ImportResult['errors'] = []): ImportResult => ({ name: 'pack.zip', kind: 'pack', characters: [], art: [], errors })
  const outcome = (saved: string[], errors: ImportOutcome['errors'] = [], setId: string | null = 'night-owls'): ImportOutcome => ({
    ok: errors.length === 0,
    setId: saved.length ? setId : null,
    saved,
    errors,
  })

  it('a clean import says where the characters went', () => {
    const r = importReport(result(), outcome(['a', 'b']), 'Night Owls')
    expect(r).toMatchObject({ ok: true, title: 'Imported 2 characters' })
    expect(r.summary).toBe("They're in Night Owls, which is now in play.")
  })

  it('a partial import counts what was left out', () => {
    const r = importReport(
      result([{ file: 'characters/sam.json', characterId: 'sam', field: 'age', message: 'Age 18 is not allowed.' }]),
      outcome(['a']),
      'Night Owls',
    )
    expect(r.ok).toBe(false)
    expect(r.title).toBe('Imported 1 of 2 characters')
    expect(r.errors).toHaveLength(1)
  })

  it("doesn't count a note about a saved card as a character left out", () => {
    const note = { file: 'sam.json', characterId: 'sam', field: 'partners', message: 'Left out partner "lee".' }
    const r = importReport(result([note]), outcome(['sam'], [], CUSTOM_SET_ID), undefined)
    expect(r.title).toBe('Imported 1 character')
    expect(r.summary).toBe("They're in My characters, which is now in play. Some things were left out:")
    expect(r.errors).toEqual([note])
  })

  it('says what a pack replacement removed and kept', () => {
    const r = importReport(result(), { ...outcome(['a']), removed: ['b', 'c'], kept: ['d'] }, 'Night Owls', (id) => id.toUpperCase())
    expect(r.ok).toBe(true)
    expect(r.summary).toBe(
      "They're in Night Owls, which is now in play. 2 characters from the earlier version of the pack left the roster. Kept the earlier card for D, since the new one has problems.",
    )
  })

  it('explains a pack replacement before it happens', () => {
    const base = { setId: 'harbor', oldName: 'Harbor', oldAuthor: 'A', newName: 'Harbor', newAuthor: 'A', removes: [] }
    expect(replaceMessage({ ...base, removes: [{ id: 'lee', name: 'Lee Park' }] })).toBe(
      "This file is a new version of Harbor by A, which is already on this device. Lee Park isn't in the new file and will leave the roster. Progress with everyone is kept, and characters you made in the pack stay in it.",
    )
    expect(replaceMessage({ ...base, newName: 'Docks', newAuthor: 'B' })).toMatch(
      /^This file is Docks by B\. It uses the same pack id as Harbor by A, which is already on this device, so importing it replaces that pack\./,
    )
  })

  it('says which of your own characters a removed pack leaves behind', () => {
    expect(removeMessage(2, [])).toBe(
      'Its 2 characters leave the roster and the editor. Your progress with them is kept, so importing the pack again picks up where you left off.',
    )
    expect(removeMessage(1, ['Mia'])).toMatch(/1 character leaves .* Mia, who you made in this pack, moves to My characters, without partners from the pack\.$/)
  })

  it('nothing imported', () => {
    const r = importReport(result([{ file: 'x.json', message: "x.json isn't valid JSON." }]), outcome([]), undefined)
    expect(r).toMatchObject({ ok: false, title: 'Nothing was imported' })
  })

  it('loose characters land in My characters', () => {
    const r = importReport(result(), outcome(['a'], [], CUSTOM_SET_ID), undefined)
    expect(r.summary).toBe("They're in My characters, which is now in play.")
  })

  it('deduplicates repeated problems', () => {
    const e = { file: 'f', message: 'm' }
    expect(importReport(result([e, e]), outcome([], [e]), undefined).errors).toHaveLength(1)
  })

  it('lists the age rule first, then the rest in order', () => {
    const errors = [
      { file: 'x.json', characterId: 'x', field: 'pronouns', message: 'Pronouns is required.' },
      { file: 'x.json', characterId: 'x', field: 'look', message: 'Look is required.' },
      { file: 'x.json', characterId: 'x', field: 'age', message: "Age 18 isn't allowed." },
    ]
    expect(importReport(result(errors), outcome([]), undefined).errors.map((e) => e.field)).toEqual(['age', 'pronouns', 'look'])
  })

  it('says where a problem is', () => {
    expect(errorWhere({ file: 'characters/sam.json', characterId: 'sam', message: '' })).toBe('sam (characters/sam.json)')
    expect(errorWhere({ file: 'pack.zip', message: '' })).toBe('pack.zip')
  })
})

describe('packManifest', () => {
  it('builds a manifest that validates, keeping only relationships inside the pack', () => {
    const chars = [entries.nova.character, entries.kai.character]
    const m = packManifest(
      { name: ' Night Owls ', id: 'night-owls', author: '', blurb: 'Two people and a bar.', heat: 3 },
      chars,
      afterhours.relationships,
    )
    expect(m).toMatchObject({ id: 'night-owls', name: 'Night Owls', heat: 3, characters: ['nova', 'kai'] })
    expect('author' in m).toBe(false)
    expect(m.relationships.every((r) => ['nova', 'kai'].includes(r.a) && ['nova', 'kai'].includes(r.b))).toBe(true)
    expect(validateManifest(m, { characterIds: ['nova', 'kai'] })).toEqual([])
  })

  it('reports a missing id and name', () => {
    const m = packManifest({ name: '', id: '', author: '', blurb: '', heat: null }, [entries.nova.character])
    const fields = validateManifest(m).map((i) => i.field)
    expect(fields).toEqual(expect.arrayContaining(['id', 'name', 'blurb']))
  })
})
