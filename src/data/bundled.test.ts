// Every bundled card and manifest must pass the same validator the editor and the importer use.

import { describe, expect, it } from 'vitest'
import { scanManifestSafety, scanSafety } from '../mods/safety'
import { validateCharacter, validateManifest } from '../mods/validate'
import {
  BUNDLED_CHARACTER_IDS,
  BUNDLED_CHARACTERS,
  BUNDLED_SET_IDS,
  BUNDLED_SETS,
  bundledEntry,
  bundledSet,
  RAW_BUNDLED_FILES,
} from './bundled'
import { GIFTS } from './gifts'
import { VENUES } from './venues'

describe('bundled sets', () => {
  it('load every manifest and every card file', () => {
    expect(BUNDLED_SETS.length).toBe(Object.keys(RAW_BUNDLED_FILES.manifests).length)
    expect(BUNDLED_CHARACTERS.length).toBe(Object.keys(RAW_BUNDLED_FILES.characters).length)
    expect(BUNDLED_SET_IDS[0]).toBe('afterhours')
    expect(bundledSet('afterhours')?.name).toBe('Afterhours')
    expect(bundledSet('afterhours')?.characters).toHaveLength(12)
  })

  it('tag every character with its set and the bundled source, in manifest order', () => {
    for (const set of BUNDLED_SETS) {
      const inSet = BUNDLED_CHARACTERS.filter((e) => e.setId === set.id)
      expect(inSet.map((e) => e.character.id)).toEqual(set.characters)
      for (const e of inSet) expect(e.source).toBe('bundled')
    }
    expect(bundledEntry('nova')?.setId).toBe('afterhours')
    expect(bundledEntry('nobody')).toBeUndefined()
  })

  it('never reuse a character id across sets', () => {
    expect(new Set(BUNDLED_CHARACTER_IDS).size).toBe(BUNDLED_CHARACTER_IDS.length)
    expect(new Set(BUNDLED_SET_IDS).size).toBe(BUNDLED_SET_IDS.length)
  })

  it('normalize the cards (Nova ships plural genders)', () => {
    const raw = Object.entries(RAW_BUNDLED_FILES.characters).find(([p]) => p.endsWith('/nova.json'))![1] as {
      attractedTo: string[]
    }
    expect(raw.attractedTo).toEqual(['women', 'men', 'nonbinary'])
    expect(bundledEntry('nova')!.character.attractedTo).toEqual(['woman', 'man', 'nonbinary'])
  })
})

describe.each(BUNDLED_SETS.map((s) => [s.id, s] as const))('the %s set', (_id, set) => {
  const others = BUNDLED_CHARACTERS.filter((e) => e.setId !== set.id).map((e) => e.character.id)

  it('has a valid manifest', () => {
    expect(validateManifest(set, { characterIds: set.characters })).toEqual([])
    expect(scanManifestSafety(set)).toEqual([])
  })

  it.each(BUNDLED_CHARACTERS.filter((e) => e.setId === set.id).map((e) => [e.character.id, e] as const))(
    '%s validates with zero issues',
    (_cid, entry) => {
      const issues = validateCharacter(entry.character, {
        setCharacterIds: set.characters,
        knownVenueIds: VENUES.map((v) => v.id),
        knownGiftIds: GIFTS.map((g) => g.id),
        existingIds: others,
      })
      expect(issues).toEqual([])
      expect(scanSafety(entry.character)).toEqual([])
    },
  )
})
