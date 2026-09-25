import { describe, expect, it } from 'vitest'
import { defaultRelationship } from '../store/defaults'
import { newGameState, newRelationship, withGameDefaults, withRelationshipDefaults } from './relationship'

describe('newRelationship', () => {
  it('starts as strangers with every field defaulted', () => {
    expect(newRelationship('nova')).toEqual({
      characterId: 'nova',
      affection: 0,
      trust: 0,
      discovered: [],
      venues: {},
      gifts: {},
      revealed: { attractions: false, style: false },
      knowsPlayerStyle: false,
      secretsUnlocked: [],
      agreement: { type: 'none', terms: '', madeAt: 0 },
      knownOthers: [],
      memory: [],
      tiersUnlocked: [],
      betrayals: [],
      dates: 0,
      lastDateAt: 0,
      connection: 0,
      heatPushes: 0,
      jealous: false,
    })
  })

  it('matches the Phase 1 default in src/store/defaults.ts', () => {
    expect(newRelationship('kai')).toEqual(defaultRelationship('kai'))
  })

  it('never shares arrays or objects between calls', () => {
    const a = newRelationship('nova')
    const b = newRelationship('nova')
    a.discovered.push({ type: 'like', id: 'vinyl', hint: '', at: 1 })
    a.agreement.type = 'open'
    a.revealed.style = true
    expect(b.discovered).toEqual([])
    expect(b.agreement.type).toBe('none')
    expect(b.revealed.style).toBe(false)
  })
})

describe('newGameState', () => {
  it('is empty and stamped', () => {
    expect(newGameState(123)).toEqual({
      startedAt: 123,
      news: [],
      rumors: [],
      metamours: {},
      rekindled: [],
      endingsSeen: {},
    })
  })
})

describe('repairing stored state', () => {
  it('fills missing relationship fields and keeps what is there', () => {
    const rel = withRelationshipDefaults({ characterId: 'nova', affection: 42, agreement: { type: 'open' }, rekindledWith: 'kai' })
    expect(rel.affection).toBe(42)
    expect(rel.trust).toBe(0)
    expect(rel.agreement).toEqual({ type: 'open', terms: '', madeAt: 0 })
    expect(rel.discovered).toEqual([])
    expect(rel.rekindledWith).toBe('kai')
    expect(rel.revealed).toEqual({ attractions: false, style: false })
  })

  it('replaces mistyped fields', () => {
    const rel = withRelationshipDefaults({ characterId: 'kai', affection: 'lots', memory: 'x', jealous: 1 })
    expect(rel.affection).toBe(0)
    expect(rel.memory).toEqual([])
    expect(rel.jealous).toBe(false)
    expect(withRelationshipDefaults(null, 'sam').characterId).toBe('sam')
  })

  it('fills missing game fields', () => {
    const g = withGameDefaults({ startedAt: 5, news: [{ id: 'n' }] }, 9)
    expect(g.startedAt).toBe(5)
    expect(g.news).toHaveLength(1)
    expect(g.metamours).toEqual({})
    expect(withGameDefaults(undefined, 9)).toEqual(newGameState(9))
  })
})
