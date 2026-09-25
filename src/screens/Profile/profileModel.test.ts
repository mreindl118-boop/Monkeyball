import { describe, expect, it } from 'vitest'
import { bundledEntry } from '../../data/bundled'
import { newRelationship } from '../../engine/relationship'
import type { Relationship } from '../../types'
import {
  HIDDEN,
  ageLine,
  agreementView,
  attractionsText,
  friendshipLocked,
  gallerySlots,
  giftReactionText,
  isPartnerRelation,
  nextStageText,
  partnersKnown,
  routeExplanation,
  secretLockText,
  secretRows,
  styleText,
  tierLockText,
  traitGroups,
  venueReactionText,
} from './profileModel'

const nova = bundledEntry('nova')!.character
const priya = bundledEntry('priya')!.character

function rel(patch: Partial<Relationship> = {}): Relationship {
  return { ...newRelationship('nova'), ...patch }
}

describe('secret unlock conditions', () => {
  it('reads affection on a romantic route and trust on a friend route', () => {
    expect(secretLockText({ unlockAt: 60 }, 'romantic')).toBe('Unlocks at 60 affection')
    expect(secretLockText({ unlockAt: 80 }, 'friend')).toBe('Unlocks at 80 trust')
  })

  it('shows earned secrets and the condition for locked ones', () => {
    const rows = secretRows(nova, rel({ secretsUnlocked: [0] }), 'romantic')
    expect(rows[0]).toEqual({ index: 0, earned: true, text: nova.secrets[0].text })
    expect(rows[1]).toEqual({ index: 1, earned: false, text: 'Unlocks at 80 affection' })
  })
})

describe('gallery locks', () => {
  it('says what unlocks each tier', () => {
    expect(tierLockText(3, 'romantic')).toBe('Unlocks at 60')
    expect(tierLockText(5, 'romantic')).toBe('Unlocks at 100')
    expect(tierLockText(2, 'friend')).toBe('Unlocks at 40')
    expect(tierLockText(3, 'friend')).toBe('Friendship-locked')
  })

  it('friendship-locks tiers 3 to 5 only on a friend route', () => {
    expect(friendshipLocked(2, 'friend')).toBe(false)
    expect(friendshipLocked(3, 'friend')).toBe(true)
    expect(friendshipLocked(5, 'romantic')).toBe(false)
  })

  it('lays out five slots with titles, unlocked or not', () => {
    const slots = gallerySlots(nova, rel({ tiersUnlocked: [1, 2] }), 'friend')
    expect(slots.map((s) => s.tier)).toEqual([1, 2, 3, 4, 5])
    expect(slots[0]).toMatchObject({ unlocked: true, lock: '', title: 'Behind the decks' })
    expect(slots[2]).toMatchObject({ unlocked: false, lock: 'Friendship-locked', title: 'Rain check' })
  })

  it('falls back to "Tier n" for a missing tier', () => {
    expect(gallerySlots({ gallery: [] }, rel(), 'romantic')[3].title).toBe('Tier 4')
  })
})

describe('traits', () => {
  it('shows discovered traits with the hint and hides the rest', () => {
    const groups = traitGroups(nova, rel({ discovered: [{ type: 'like', id: 'vinyl', hint: 'She lights up', at: 1 }] }))
    expect(groups.map((g) => g.title)).toEqual(['Likes', 'Dislikes', 'Turn-ons', 'Turn-offs'])
    const likes = groups[0]
    expect(likes.discovered).toBe(1)
    expect(likes.total).toBe(nova.likes.length)
    expect(likes.rows[0]).toEqual({ id: 'vinyl', discovered: true, label: nova.likes[0].label, hint: 'She lights up' })
    expect(likes.rows[1].label).toBe(HIDDEN)
    expect(groups[1].discovered).toBe(0)
  })
})

describe('stage and route text', () => {
  it('names the next stage, or the friend route ceiling', () => {
    expect(nextStageText(0, 'romantic')).toBe('Next: Acquaintance at 20.')
    expect(nextStageText(65, 'romantic')).toBe('Next: Lover at 80.')
    expect(nextStageText(100, 'romantic')).toBe('')
    expect(nextStageText(25, 'friend')).toBe('Next: Friend at 40.')
    expect(nextStageText(45, 'friend')).toBe('Friend is as far as this goes.')
  })

  it('explains the route', () => {
    expect(routeExplanation('Jules', 'friend', 'realistic')).toMatch(/^Jules isn't into your gender/)
    expect(routeExplanation('Nova', 'romantic', 'everyone')).toMatch(/Everyone's into you/)
    expect(routeExplanation('Nova', 'romantic', 'realistic')).toMatch(/^Nova could fall for you/)
  })
})

describe('agreement', () => {
  it('reads none yet, or the type and terms', () => {
    expect(agreementView(undefined)).toMatchObject({ title: 'None yet', made: false })
    expect(agreementView({ type: 'open', terms: ' Tell me first. ', madeAt: 5 })).toEqual({
      title: 'Open',
      detail: 'Tell me first.',
      made: true,
    })
  })
})

describe('attractions and style', () => {
  it('reads orientation, attractions and the ace spectrum', () => {
    expect(attractionsText(nova)).toBe('Bi. Into women, men and nonbinary people.')
    expect(attractionsText(priya)).toBe('Bi. Into women and men. Demisexual.')
  })

  it('reads style with jealousy', () => {
    expect(styleText(nova)).toBe('Open, low jealousy.')
    expect(styleText({ relationshipStyle: 'polyamorous', jealousy: 'compersion' })).toBe(
      'Polyamorous, happy when you are happy with others.',
    )
  })
})

describe('small facts', () => {
  it('reactions', () => {
    expect(venueReactionText('favorite')).toBe('Loves it')
    expect(venueReactionText('hated')).toBe("Can't stand it")
    expect(giftReactionText('neutral')).toBe('It was fine')
  })

  it('partners come up at 20 affection or 20 trust', () => {
    expect(partnersKnown({ affection: 19, trust: 19 })).toBe(false)
    expect(partnersKnown({ affection: 20, trust: 0 })).toBe(true)
    expect(partnersKnown({ affection: 0, trust: 20 })).toBe(true)
  })

  it('knows the partner relations', () => {
    expect(isPartnerRelation('ex')).toBe(true)
    expect(isPartnerRelation('friend')).toBe(false)
  })

  it('age and pronouns without a middle dot', () => {
    expect(ageLine(nova)).toBe('28, she/her')
    expect(ageLine({ age: Number.NaN, pronouns: 'they/them' })).toBe('they/them')
  })
})
