import { describe, expect, it } from 'vitest'
import { bundledEntry } from '../data/bundled'
import type { Relationship } from '../types'
import { newRelationship } from './relationship'
import { applyUnlocks, newSecrets, newTiers } from './unlocks'

const nova = bundledEntry('nova')!.character // secrets at 60 and 80
const rel = (p: Partial<Relationship>): Relationship => ({ ...newRelationship('nova'), ...p })

describe('newTiers', () => {
  it('unlocks every tier whose threshold affection has reached (romantic)', () => {
    expect(newTiers(nova, rel({ affection: 19 }), 'romantic')).toEqual([])
    expect(newTiers(nova, rel({ affection: 20 }), 'romantic')).toEqual([1])
    expect(newTiers(nova, rel({ affection: 65 }), 'romantic')).toEqual([1, 2, 3])
    expect(newTiers(nova, rel({ affection: 100 }), 'romantic')).toEqual([1, 2, 3, 4, 5])
  })

  it('only unlocks tiers 1 and 2 on a friend route', () => {
    expect(newTiers(nova, rel({ affection: 59 }), 'friend')).toEqual([1, 2])
    expect(newTiers(nova, rel({ affection: 80 }), 'friend')).toEqual([1, 2])
  })

  it('never unlocks a tier twice', () => {
    expect(newTiers(nova, rel({ affection: 45, tiersUnlocked: [1] }), 'romantic')).toEqual([2])
    expect(newTiers(nova, rel({ affection: 10, tiersUnlocked: [1, 2] }), 'romantic')).toEqual([])
  })
})

describe('newSecrets', () => {
  it('romantic route: on affection', () => {
    expect(newSecrets(nova, rel({ affection: 59, trust: 90 }), 'romantic')).toEqual([])
    expect(newSecrets(nova, rel({ affection: 60 }), 'romantic')).toEqual([0])
    expect(newSecrets(nova, rel({ affection: 85 }), 'romantic')).toEqual([0, 1])
  })

  it('friend route: on trust', () => {
    expect(newSecrets(nova, rel({ affection: 59, trust: 10 }), 'friend')).toEqual([])
    expect(newSecrets(nova, rel({ affection: 20, trust: 60 }), 'friend')).toEqual([0])
    expect(newSecrets(nova, rel({ affection: 20, trust: 80 }), 'friend')).toEqual([0, 1])
  })

  it('never unlocks a secret twice', () => {
    expect(newSecrets(nova, rel({ affection: 90, secretsUnlocked: [0] }), 'romantic')).toEqual([1])
  })
})

describe('applyUnlocks', () => {
  it('adds what is new and reports it once', () => {
    const first = applyUnlocks(nova, rel({ affection: 62 }), 'romantic')
    expect(first.tiers).toEqual([1, 2, 3])
    expect(first.secrets).toEqual([0])
    expect(first.rel.tiersUnlocked).toEqual([1, 2, 3])
    expect(first.rel.secretsUnlocked).toEqual([0])
    const again = applyUnlocks(nova, first.rel, 'romantic')
    expect(again.tiers).toEqual([])
    expect(again.secrets).toEqual([])
    expect(again.rel).toBe(first.rel)
  })

  it('keeps what was unlocked when affection drops', () => {
    const dropped = applyUnlocks(nova, rel({ affection: 10, tiersUnlocked: [1, 2, 3], secretsUnlocked: [0] }), 'romantic')
    expect(dropped.rel.tiersUnlocked).toEqual([1, 2, 3])
    expect(dropped.rel.secretsUnlocked).toEqual([0])
  })
})
