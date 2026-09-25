import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../store/defaults'
import type { PlayerProfile } from '../../types'
import { maskKey } from './mask'
import { buildPreviews, previewCharacter } from './previews'

const profile: PlayerProfile = {
  name: 'Marisol',
  gender: 'custom',
  customGender: 'genderfluid',
  matchAs: 'woman',
  pronouns: 'she/they',
  bodyNotes: 'broad shoulders and a gap-toothed grin',
  relationshipStyle: 'open',
}

describe('debug prompt previews', () => {
  it('normalizes Nova for the builders', () => {
    expect(previewCharacter().attractedTo).toEqual(['woman', 'man', 'nonbinary'])
  })

  it('puts the player profile into the story prompt', () => {
    const p = buildPreviews({ profile, settings: DEFAULT_SETTINGS })
    expect(p.story).toContain('Marisol')
    expect(p.story).toContain('she/they')
    expect(p.story).toContain('genderfluid')
    expect(p.story).not.toMatch(/Couldn't build/)
    for (const text of Object.values(p)) expect(text).not.toMatch(/Couldn't build/)
  })

  it('follows the heat setting', () => {
    const low = buildPreviews({ profile, settings: { ...DEFAULT_SETTINGS, heat: 1 } })
    const high = buildPreviews({ profile, settings: { ...DEFAULT_SETTINGS, heat: 5 } })
    expect(low.story).not.toEqual(high.story)
    expect(high.story).toContain('broad shoulders')
    expect(low.story).not.toContain('broad shoulders')
    expect(low.suggestions).not.toEqual(high.suggestions)
  })

  it('renders without a profile', () => {
    const p = buildPreviews({ profile: null, settings: DEFAULT_SETTINGS })
    expect(p.story).toContain('Player')
  })
})

describe('maskKey', () => {
  it('hides most of the key', () => {
    expect(maskKey('')).toBe('')
    expect(maskKey('short')).toBe('••••')
    expect(maskKey('sk-or-v1-abcdef123456')).toBe('sk-••••3456')
  })
})
