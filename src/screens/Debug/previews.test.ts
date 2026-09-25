import { describe, expect, it } from 'vitest'
import { FRIEND_MODIFIER, HEAT_MODIFIERS, IMAGE_SAFETY } from '../../art/imagePrompt'
import { bundledEntry } from '../../data/bundled'
import { defaultRelationship, DEFAULT_SETTINGS } from '../../store/defaults'
import type { PlayerProfile } from '../../types'
import { maskKey } from './mask'
import { buildPreviews, previewCharacter, previewTier } from './previews'

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

describe('the image prompt preview', () => {
  const priya = bundledEntry('priya')!.character
  const heat = (h: 1 | 2 | 3 | 4 | 5) => ({ ...DEFAULT_SETTINGS, heat: h })

  it("states Nova's adult age and carries the locked safety text", () => {
    const { image } = buildPreviews({ profile, settings: DEFAULT_SETTINGS })
    expect(image).toContain('adult woman, 28 years old')
    expect(image).toContain(IMAGE_SAFETY.positiveClause)
    expect(image).toContain(IMAGE_SAFETY.negative)
    expect(image).not.toMatch(/Couldn't build/)
  })

  it('Grok Imagine: the clause is in the prompt itself', () => {
    const settings = { ...DEFAULT_SETTINGS, image: { ...DEFAULT_SETTINGS.image, provider: 'grok' as const } }
    const { image } = buildPreviews({ profile, settings })
    expect(image).toContain(IMAGE_SAFETY.grokClause)
    expect(image).toContain('Grok Imagine has no negative prompt')
  })

  it('follows the heat, and paints the highest unlocked tier', () => {
    const low = buildPreviews({ profile, settings: heat(2) }).image
    const high = buildPreviews({ profile, settings: heat(4) }).image
    expect(low).not.toEqual(high)
    expect(low).toContain('Heat 2')
    expect(high).toContain('Heat 4')
    expect(previewTier({ tiersUnlocked: [1, 3, 2] })).toBe(3)
    expect(previewTier({ tiersUnlocked: [] })).toBe(1)
  })

  it("Priya's ace gate: at heat 4 both prompts stay at 2 until her trust is over 60", () => {
    const gated = buildPreviews({ profile, settings: heat(4), character: priya, rel: { ...defaultRelationship('priya'), trust: 40 } })
    const open = buildPreviews({ profile, settings: heat(4), character: priya, rel: { ...defaultRelationship('priya'), trust: 70 } })
    expect(gated.image).toContain('Heat 4, painted at 2 (their pace)')
    expect(open.image).toContain('Heat 4\n')
    expect(gated.image).not.toEqual(open.image)
    expect(gated.story).not.toEqual(open.story)
    // Body notes only once the gate is open (heat 4).
    expect(open.image).toContain('birthmark on her collarbone')
    expect(gated.image).not.toContain('birthmark on her collarbone')
    expect(gated.image).toContain('adult woman, 30 years old')
    expect(open.image).toContain('adult woman, 30 years old')
  })

  it('paints a friend-route character platonically, like the app does', () => {
    // Jules is into men; Marisol counts as a woman in realistic mode.
    const jules = bundledEntry('jules')!.character
    const rel = { ...defaultRelationship('jules'), trust: 90, tiersUnlocked: [2] as (1 | 2)[] }
    const friend = buildPreviews({ profile, settings: heat(5), character: jules, rel }).image
    expect(friend).toContain(FRIEND_MODIFIER)
    expect(friend).toContain('Heat 5, painted at 1 (friend route, platonic)')
    expect(friend.split('Negative prompt:')[0]).not.toMatch(/\bnude\b|explicit/)
    expect(friend).toContain('the friend is an adult woman, 21 or older')
    const everyone = buildPreviews({ profile, settings: { ...heat(5), orientationMode: 'everyone' }, character: jules, rel }).image
    expect(everyone).toContain(HEAT_MODIFIERS[5])
    expect(everyone).toContain('the partner is an adult woman, 21 or older')
  })
})

describe('maskKey', () => {
  it('hides most of the key', () => {
    expect(maskKey('')).toBe('')
    expect(maskKey('short')).toBe('••••')
    expect(maskKey('sk-or-v1-abcdef123456')).toBe('sk-••••3456')
  })
})
