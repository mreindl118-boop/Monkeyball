import { describe, expect, it } from 'vitest'
import { bundledEntry } from '../data/bundled'
import type { DateRecord, Relationship } from '../types'
import { buildRecap } from './recap'
import { newRelationship } from './relationship'

const nova = bundledEntry('nova')!.character

const record = (p: Partial<DateRecord> = {}): DateRecord => ({
  kind: 'single',
  characterIds: ['nova'],
  venueId: 'record-store',
  giftId: 'flowers',
  startedAt: 1,
  endedAt: 2,
  maxTurns: 10,
  turns: [],
  totals: { nova: { affection: 20, trust: 4, gained: 26 } },
  outcome: 'completed',
  ...p,
})

describe('buildRecap', () => {
  it('reports the meters, stages and what this date earned', () => {
    const before: Relationship = {
      ...newRelationship('nova'),
      affection: 35,
      trust: 10,
      discovered: [{ type: 'like', id: 'vinyl', hint: 'old', at: 1 }],
      tiersUnlocked: [1],
    }
    const after: Relationship = {
      ...before,
      affection: 62,
      trust: 15,
      discovered: [...before.discovered, { type: 'turnOn', id: 'banter', hint: 'She grins', at: 5 }],
      tiersUnlocked: [1, 2, 3],
      secretsUnlocked: [0],
      venues: { 'record-store': 'favorite' },
      gifts: { flowers: 'hated' },
      revealed: { attractions: true, style: false },
      knowsPlayerStyle: true,
    }
    const recap = buildRecap(before, after, record(), nova, 'romantic', { memory: 'We dug through crates.' })
    expect(recap.perCharacter.nova).toEqual({
      affectionBefore: 35,
      affectionAfter: 62,
      trustBefore: 10,
      trustAfter: 15,
      stageBefore: 'acquaintance',
      stageAfter: 'crush',
      traits: [{ type: 'turnOn', id: 'banter', hint: 'She grins', at: 5 }],
      secrets: [0],
      rumors: [],
      tiers: [2, 3],
      betrayals: [],
      gossip: [],
      left: false,
      route: 'romantic',
      revealed: { attractions: true, style: false, playerStyle: true },
      venueReaction: 'favorite',
      giftReaction: 'hated',
      venueNew: true,
      giftNew: true,
      memory: 'We dug through crates.',
    })
  })

  it('marks venue and gift reactions the player already knew as not new', () => {
    const before: Relationship = { ...newRelationship('nova'), venues: { 'record-store': 'favorite' } }
    const after: Relationship = { ...before, gifts: { flowers: 'hated' } }
    const r = buildRecap(before, after, record(), nova, 'romantic').perCharacter.nova
    expect(r.venueReaction).toBe('favorite')
    expect(r.venueNew).toBe(false)
    expect(r.giftReaction).toBe('hated')
    expect(r.giftNew).toBe(true)
  })

  it('marks a date the character left, and leaves out the gift when there was none', () => {
    const rel = newRelationship('nova')
    const recap = buildRecap(rel, { ...rel, affection: 0 }, record({ outcome: 'left', giftId: undefined }), nova, 'friend')
    const r = recap.perCharacter.nova
    expect(r.left).toBe(true)
    expect(r.route).toBe('friend')
    expect(r.giftReaction).toBeUndefined()
    expect(r.venueReaction).toBe('favorite') // read from the card when the relationship has no record
    expect(r.agreementBefore).toBeUndefined()
  })

  it('shows an agreement that changed', () => {
    const before = newRelationship('nova')
    const after = { ...before, agreement: { type: 'open' as const, terms: 'Tell me the big stuff', madeAt: 9 } }
    const r = buildRecap(before, after, record(), nova, 'romantic').perCharacter.nova
    expect(r.agreementBefore).toEqual(before.agreement)
    expect(r.agreementAfter).toEqual(after.agreement)
  })
})
