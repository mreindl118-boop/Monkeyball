import { describe, expect, it } from 'vitest'
import type { Relationship } from '../types'
import { newGameState } from './relationship'
import { openToMore, rekindleCandidates, rollRekindles } from './rekindle'
import { afterhoursCharacters, afterhoursNames, afterhoursRelations, afterhoursSetOf, card, rel } from './testKit'

const characters = afterhoursCharacters()
const relations = afterhoursRelations()
const names = afterhoursNames()
const high = (id: string, p: Partial<Relationship> = {}) => rel(id, { affection: 85, trust: 65, dates: 6, ...p })

function roll(rels: Record<string, Relationship>, rng: () => number, game = newGameState(0)) {
  return rollRekindles({ characters, rels, relations, game, now: 5000, rng, names, setOf: afterhoursSetOf() })
}

describe('rekindles', () => {
  it('fires on a 20% roll for exes both at 80+ and 60+, and closes the door for a mono pair', () => {
    const rels = { nova: high('nova'), kai: high('kai') }
    const r = roll(rels, () => 0.19)
    expect(r.rels.nova.rekindledWith).toBe('kai')
    expect(r.rels.kai.rekindledWith).toBe('nova')
    expect(r.game.rekindled).toEqual(['kai|nova'])
    expect(r.news).toHaveLength(1)
    expect(r.news[0]).toMatchObject({ kind: 'rekindle', characterIds: ['kai', 'nova'] })
    expect(r.news[0].text).toBe('Kai and Nova got close again while you were busy. For now, the door is closing.')
    expect(r.game.news).toEqual(r.news)
    // Once per pair.
    expect(roll({ nova: high('nova'), kai: high('kai') }, () => 0, r.game).news).toEqual([])
  })

  it("doesn't fire on a miss, and can fire on a later date", () => {
    const rels = { nova: high('nova'), kai: high('kai') }
    const miss = roll(rels, () => 0.2)
    expect(miss.news).toEqual([])
    expect(miss.game.rekindled).toEqual([])
    expect(miss.rels).toBe(rels)
    expect(roll(rels, () => 0.1, miss.game).news).toHaveLength(1)
  })

  it('never fires when either is exclusive with the player, or below the thresholds', () => {
    const excl = { type: 'exclusive' as const, terms: '', madeAt: 1 }
    expect(roll({ nova: high('nova', { agreement: excl }), kai: high('kai') }, () => 0).news).toEqual([])
    expect(roll({ nova: high('nova'), kai: high('kai', { agreement: excl }) }, () => 0).news).toEqual([])
    expect(roll({ nova: high('nova', { affection: 79 }), kai: high('kai') }, () => 0).news).toEqual([])
    expect(roll({ nova: high('nova'), kai: high('kai', { trust: 59 }) }, () => 0).news).toEqual([])
    expect(roll({ nova: high('nova') }, () => 0).news).toEqual([])
  })

  it('invites the player in when both are open to more, and leaves it on both relationships', () => {
    const r = roll({ dex: high('dex'), imani: high('imani') }, () => 0)
    expect(r.news[0].text).toBe("Dex and Imani have been falling for each other again while you were busy, and they'd like you to join them some night.")
    expect(r.rels.dex.rekindledWith).toBeUndefined()
    expect(r.rels.dex.rekindle).toEqual({ with: 'imani', invite: true, at: 5000 })
    expect(r.rels.imani.rekindle).toEqual({ with: 'dex', invite: true, at: 5000 })
    // Each knows about the other now, and they approve of sharing the player.
    expect(r.rels.dex.knownOthers).toEqual(['imani'])
    expect(r.rels.imani.knownOthers).toEqual(['dex'])
    expect(r.game.metamours['dex|imani'] ?? 70).toBeGreaterThanOrEqual(60)
    expect(r.game.rekindled).toEqual(['dex|imani'])
  })

  it('keeps the door-closing outcome on both, and skips pairs with someone from the date that just ended', () => {
    const r = roll({ nova: high('nova'), kai: high('kai') }, () => 0)
    expect(r.rels.nova.rekindle).toEqual({ with: 'kai', invite: false, at: 5000 })
    expect(r.rels.kai.rekindle).toEqual({ with: 'nova', invite: false, at: 5000 })
    const away = rollRekindles({ characters, rels: { nova: high('nova'), kai: high('kai') }, relations, game: newGameState(0), now: 5000, rng: () => 0, names, exclude: ['nova'] })
    expect(away.news).toEqual([])
    expect(away.game.rekindled).toEqual([])
  })

  it('reads flexible characters by their agreement with the player', () => {
    expect(openToMore(card('theo'), rel('theo'))).toBe(false)
    expect(openToMore(card('theo'), rel('theo', { agreement: { type: 'open', terms: '', madeAt: 1 } }))).toBe(true)
    expect(openToMore(card('rook'), undefined)).toBe(true)
    expect(rekindleCandidates({ characters, rels: { theo: high('theo'), jules: high('jules') }, relations, game: newGameState(0) })).toEqual([
      { a: 'jules', b: 'theo', kind: 'ex' },
    ])
  })
})
