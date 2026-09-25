import { describe, expect, it } from 'vitest'
import type { Character, PlayerProfile } from '../types'
import {
  aceNote,
  affectionCap,
  describeAttractions,
  effectiveHeat,
  nextStage,
  normalizeGender,
  playerBucket,
  routeFor,
  STAGES,
  stageFor,
  stageIndex,
  stageLabel,
} from './stages'

const profile = (p: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Alex',
  gender: 'woman',
  pronouns: 'she/her',
  bodyNotes: '',
  relationshipStyle: 'open',
  ...p,
})

const char = (attractedTo: string[], aceSpectrum?: Character['aceSpectrum']) =>
  ({ attractedTo, aceSpectrum }) as unknown as Character

describe('stages', () => {
  it('maps affection to the spec stages at every boundary', () => {
    const cases: [number, string][] = [
      [0, 'stranger'],
      [19, 'stranger'],
      [20, 'acquaintance'],
      [39, 'acquaintance'],
      [40, 'friend'],
      [59, 'friend'],
      [60, 'crush'],
      [79, 'crush'],
      [80, 'lover'],
      [99, 'lover'],
      [100, 'won'],
      [-5, 'stranger'],
      [140, 'won'],
      [59.9, 'friend'],
      [Number.NaN, 'stranger'],
    ]
    for (const [a, s] of cases) expect(stageFor(a), `affection ${a}`).toBe(s)
  })

  it('has labels, mins and indexes in order', () => {
    expect(STAGES.map((s) => [s.label, s.min])).toEqual([
      ['Stranger', 0],
      ['Acquaintance', 20],
      ['Friend', 40],
      ['Crush', 60],
      ['Lover', 80],
      ['Won', 100],
    ])
    expect(stageLabel('crush')).toBe('Crush')
    expect(stageIndex('stranger')).toBe(0)
    expect(stageIndex('won')).toBe(5)
    expect(nextStage(45)?.id).toBe('crush')
    expect(nextStage(100)).toBeNull()
  })
})

describe('genders and routes', () => {
  it('normalizes plurals and variants', () => {
    expect(normalizeGender('women')).toBe('woman')
    expect(normalizeGender('Men')).toBe('man')
    expect(normalizeGender('nonbinary people')).toBe('nonbinary')
    expect(normalizeGender('non-binary')).toBe('nonbinary')
    expect(normalizeGender('enby')).toBe('nonbinary')
    expect(normalizeGender('woman')).toBe('woman')
    expect(normalizeGender('dragons')).toBeNull()
  })

  it('describes attractions as a readable list', () => {
    expect(describeAttractions(['women', 'men', 'nonbinary'])).toBe('women, men and nonbinary people')
    expect(describeAttractions(['woman', 'nonbinary'])).toBe('women and nonbinary people')
    expect(describeAttractions(['man'])).toBe('men')
    expect(describeAttractions(['woman', 'women'])).toBe('women')
  })

  it('buckets the player, custom genders use matchAs (default nonbinary)', () => {
    expect(playerBucket(profile({ gender: 'man' }))).toBe('man')
    expect(playerBucket(profile({ gender: 'custom', customGender: 'genderfluid', matchAs: 'woman' }))).toBe('woman')
    expect(playerBucket(profile({ gender: 'custom', customGender: 'agender' }))).toBe('nonbinary')
    expect(playerBucket(null)).toBe('nonbinary')
  })

  it('realistic mode gives the friend route when the player is not in attractedTo', () => {
    const sasha = char(['woman'])
    expect(routeFor(sasha, profile({ gender: 'woman' }), 'realistic')).toBe('romantic')
    expect(routeFor(sasha, profile({ gender: 'man' }), 'realistic')).toBe('friend')
    expect(routeFor(sasha, profile({ gender: 'nonbinary' }), 'realistic')).toBe('friend')
    // Plural card values still work.
    expect(routeFor(char(['women', 'nonbinary']), profile({ gender: 'nonbinary' }), 'realistic')).toBe('romantic')
    // Custom gender counts as its matchAs bucket.
    expect(
      routeFor(sasha, profile({ gender: 'custom', customGender: 'butch', matchAs: 'woman' }), 'realistic'),
    ).toBe('romantic')
  })

  it("everyone's-into-you mode is always romantic", () => {
    expect(routeFor(char(['woman']), profile({ gender: 'man' }), 'everyone')).toBe('romantic')
  })

  it('caps affection on the friend route at 59', () => {
    expect(affectionCap('friend')).toBe(59)
    expect(affectionCap('romantic')).toBe(100)
    expect(stageFor(affectionCap('friend'))).toBe('friend')
  })
})

describe('heat and the ace spectrum', () => {
  it('leaves heat alone without an aceSpectrum', () => {
    expect(effectiveHeat(char(['woman']), 0, 5)).toBe(5)
  })

  it('applies heatCap', () => {
    const minh = char(['woman'], { label: 'asexual, panromantic', heatCap: 2 })
    expect(effectiveHeat(minh, 100, 5)).toBe(2)
    expect(effectiveHeat(minh, 100, 1)).toBe(1)
  })

  it('holds heat at 2 until trust is over heatUnlockTrust', () => {
    const priya = char(['woman'], { label: 'demisexual', heatUnlockTrust: 60 })
    expect(effectiveHeat(priya, 10, 4)).toBe(2)
    expect(effectiveHeat(priya, 60, 4)).toBe(2)
    expect(effectiveHeat(priya, 61, 4)).toBe(4)
    expect(effectiveHeat(priya, { trust: 70 }, 5)).toBe(5)
    expect(effectiveHeat(priya, 0, 1)).toBe(1)
  })

  it('combines both rules', () => {
    const c = char(['woman'], { label: 'demi', heatCap: 3, heatUnlockTrust: 50 })
    expect(effectiveHeat(c, 10, 5)).toBe(2)
    expect(effectiveHeat(c, 90, 5)).toBe(3)
  })

  it('writes the ace note like the architecture examples', () => {
    expect(aceNote(char(['woman'], { label: 'demisexual', heatUnlockTrust: 60 }))).toBe(
      'Demisexual: nothing past heat 2 until trust is over 60, and that is who they are, not a puzzle.',
    )
    expect(aceNote(char(['woman'], { label: 'asexual', heatCap: 2 }))).toBe(
      'Asexual: heat never goes past 2, and that is who they are, not a puzzle.',
    )
    expect(aceNote(char(['woman']))).toBe('')
    expect(aceNote(char(['woman'], { label: 'demi', heatCap: 3, heatUnlockTrust: 50 }))).toBe(
      'Demi: nothing past heat 2 until trust is over 50, never past heat 3, and that is who they are, not a puzzle.',
    )
  })

  it('names the character in the ace note when it has a name, so pronouns never slip', () => {
    const priya = { ...char(['man'], { label: 'demisexual', heatUnlockTrust: 60 }), name: 'Priya Raman' }
    expect(aceNote(priya)).toBe('Demisexual: nothing past heat 2 until trust is over 60, and that is who Priya Raman is, not a puzzle.')
    const pace = { ...char(['woman'], { label: 'ace' }), name: 'Minh' }
    expect(aceNote(pace)).toBe('Ace: Minh sets the pace, and that is who Minh is, not a puzzle.')
  })
})
