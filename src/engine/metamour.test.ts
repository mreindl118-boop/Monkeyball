import { describe, expect, it } from 'vitest'
import { adjustApproval, allApprove, approval, baselineApproval, metamourTrust, pairKey } from './metamour'
import { newGameState } from './relationship'
import { afterhoursRelations, rel } from './testKit'

const relations = afterhoursRelations()

describe('metamour approval', () => {
  it('starts from what they are to each other', () => {
    expect(baselineApproval('dex', 'imani', relations)).toBe(70)
    expect(baselineApproval('nova', 'imani', relations)).toBe(60)
    expect(baselineApproval('sasha', 'priya', relations)).toBe(60)
    expect(baselineApproval('rook', 'vesper', relations)).toBe(55)
    expect(baselineApproval('nova', 'sasha', relations)).toBe(50)
    expect(baselineApproval('dex', 'kai', relations)).toBe(40)
    expect(baselineApproval('nova', 'kai', relations)).toBe(35)
  })

  it('stores moves under the sorted pair key, clamped 0-100', () => {
    const g = adjustApproval(newGameState(0), 'nova', 'kai', 5, relations)
    expect(g.metamours).toEqual({ 'kai|nova': 40 })
    expect(approval(g, 'kai', 'nova', relations)).toBe(40)
    expect(pairKey('nova', 'kai')).toBe('kai|nova')
    expect(adjustApproval(g, 'kai', 'nova', -90, relations).metamours['kai|nova']).toBe(0)
    expect(adjustApproval(g, 'kai', 'kai', 5, relations)).toBe(g)
  })

  it('checks every pair for the polycule threshold', () => {
    const g = { ...newGameState(0), metamours: { 'marlowe|nova': 60, 'marlowe|rook': 61, 'nova|rook': 59 } }
    expect(allApprove(g, ['nova', 'marlowe'], relations)).toBe(true)
    expect(allApprove(g, ['nova', 'marlowe', 'rook'], relations)).toBe(false)
  })

  it('moves trust under poly by how they feel about the others', () => {
    const poly = (knownOthers: string[]) => rel('nova', { agreement: { type: 'poly', terms: '', madeAt: 1 }, knownOthers })
    expect(metamourTrust(newGameState(0), 'nova', poly(['imani']), relations)).toBe(1)
    expect(metamourTrust(newGameState(0), 'nova', poly(['kai']), relations)).toBe(-1)
    expect(metamourTrust(newGameState(0), 'nova', poly(['sasha']), relations)).toBe(0)
    expect(metamourTrust(newGameState(0), 'nova', rel('nova', { knownOthers: ['imani'] }), relations)).toBe(0)
  })
})
