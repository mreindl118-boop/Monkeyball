import { describe, expect, it } from 'vitest'
import type { BetrayalEvent, EndingType, GameState, Relationship } from '../types'
import { ENDING_PRIORITY, ENDINGS, endingDescription, endingDirection, headingLine, polyculeGroup, selectEnding } from './endings'
import { newGameState } from './relationship'
import { afterhoursCharacters, afterhoursNames, afterhoursRelations, rel } from './testKit'

const characters = afterhoursCharacters()
const relations = afterhoursRelations()
const names = afterhoursNames()
const betrayal: BetrayalEvent = { at: 1, kind: 'agreement', about: 'kai', note: 'n', affectionDelta: -15, trustDelta: -22 }
const agreement = (type: 'none' | 'exclusive' | 'open' | 'poly' | 'casual') => ({ type, terms: '', madeAt: 1 })
const won = (id: string, p: Partial<Relationship> = {}) => rel(id, { affection: 100, trust: 75, connection: 12, dates: 12, agreement: agreement('exclusive'), ...p })

function pick(id: string, rels: Record<string, Relationship>, game: GameState = newGameState(0)) {
  return selectEnding({ characterId: id, characters, rels, game, relations, names })
}

describe('selectEnding', () => {
  it('reaches all seven', () => {
    const seen = new Set<EndingType>()
    const polyGame = { ...newGameState(0), metamours: { 'marlowe|nova': 60 } }
    const cases: [EndingType, ReturnType<typeof pick>][] = [
      ['polycule', pick('nova', { nova: won('nova', { agreement: agreement('poly') }), marlowe: rel('marlowe', { affection: 85, agreement: agreement('poly') }) }, polyGame)],
      ['reconciliation', pick('nova', { nova: won('nova', { betrayals: [betrayal], trust: 65 }) })],
      ['bitter', pick('nova', { nova: won('nova', { betrayals: [betrayal], trust: 45 }) })],
      ['sacrifice', pick('nova', { nova: won('nova', { rekindledWith: 'kai' }) })],
      ['hollow', pick('nova', { nova: won('nova', { trust: 35 }) })],
      ['open', pick('nova', { nova: won('nova', { agreement: agreement('open') }) })],
      ['good', pick('nova', { nova: won('nova') })],
    ]
    for (const [type, choice] of cases) {
      expect(choice.type).toBe(type)
      expect(choice.reason).toMatch(/^[A-Z].*\.$/)
      seen.add(choice.type)
    }
    expect(seen.size).toBe(7)
    expect(cases[0][1].group).toEqual(['nova', 'marlowe'])
    expect(cases[3][1].reason).toBe('Nova got back together with Kai while you were busy.')
  })

  it('needs two Lover+ characters on poly agreements approving of each other: 60 passes, 59 fails', () => {
    const rels = { nova: won('nova', { agreement: agreement('poly') }), marlowe: rel('marlowe', { affection: 80, agreement: agreement('poly') }) }
    expect(pick('nova', rels, { ...newGameState(0), metamours: { 'marlowe|nova': 60 } }).type).toBe('polycule')
    const at59 = pick('nova', rels, { ...newGameState(0), metamours: { 'marlowe|nova': 59 } })
    expect(at59.type).toBe('open')
    expect(at59.group).toBeUndefined()
    // Below Lover, or not on poly, doesn't count.
    const game = { ...newGameState(0), metamours: { 'marlowe|nova': 90 } }
    expect(pick('nova', { ...rels, marlowe: { ...rels.marlowe, affection: 79 } }, game).type).toBe('open')
    expect(pick('nova', { ...rels, marlowe: { ...rels.marlowe, agreement: agreement('open') } }, game).type).toBe('open')
    // Strangers start at 50, so approval has to be earned.
    expect(pick('nova', rels).type).toBe('open')
  })

  it('keeps everyone in the polycule approving of everyone', () => {
    const rels = {
      nova: won('nova', { agreement: agreement('poly') }),
      marlowe: rel('marlowe', { affection: 90, agreement: agreement('poly') }),
      rook: rel('rook', { affection: 85, agreement: agreement('poly') }),
    }
    const game = { ...newGameState(0), metamours: { 'marlowe|nova': 70, 'nova|rook': 70, 'marlowe|rook': 40 } }
    expect(polyculeGroup({ characterId: 'nova', characters, rels, game, relations })).toEqual(['nova', 'marlowe'])
    const all = { ...game, metamours: { ...game.metamours, 'marlowe|rook': 60 } }
    expect(polyculeGroup({ characterId: 'nova', characters, rels, game: all, relations })).toEqual(['nova', 'marlowe', 'rook'])
  })

  it('only reconciles after a betrayal', () => {
    expect(pick('nova', { nova: won('nova', { trust: 90 }) }).type).toBe('good')
    expect(pick('nova', { nova: won('nova', { trust: 90, betrayals: [betrayal] }) }).type).toBe('reconciliation')
    expect(pick('nova', { nova: won('nova', { trust: 59, betrayals: [betrayal] }) }).type).toBe('bitter')
  })

  it('sacrifices a monogamous character the player never made an agreement with', () => {
    expect(pick('kai', { kai: won('kai', { agreement: agreement('none') }) }).type).toBe('sacrifice')
    expect(pick('kai', { kai: won('kai', { agreement: agreement('casual') }) }).type).toBe('sacrifice')
    expect(pick('kai', { kai: won('kai') }).type).toBe('good')
    expect(pick('nova', { nova: won('nova', { agreement: agreement('none') }) }).type).toBe('good')
  })

  it('is hollow on low trust or little connection, and open only with an open or poly agreement', () => {
    expect(pick('nova', { nova: won('nova', { connection: 7 }) }).type).toBe('hollow')
    expect(pick('nova', { nova: won('nova', { trust: 39 }) }).reason).toBe("Trust is only 39: the affection is real, the connection isn't.")
    expect(pick('nova', { nova: won('nova', { agreement: agreement('poly') }) }).type).toBe('open')
    expect(pick('nova', { nova: won('nova', { agreement: agreement('casual') }) }).type).toBe('good')
  })

  it('words the reason from the numbers: trust 40 to 59 is steady, not high', () => {
    expect(pick('nova', { nova: won('nova', { trust: 41 }) })).toMatchObject({
      type: 'good',
      reason: 'Affection with Nova is all the way up, and trust is steady at 41, with no betrayal on the way.',
    })
    expect(pick('nova', { nova: won('nova', { trust: 75 }) }).reason).toBe('High trust and affection with Nova, and honest the whole way.')
    expect(pick('nova', { nova: won('nova', { trust: 45, agreement: agreement('open') }) }).reason).toBe(
      'You and Nova are on an open agreement you both like, and trust is steady at 45.',
    )
  })

  it('says "both" for a polycule of two', () => {
    const rels = { nova: won('nova', { agreement: agreement('poly') }), marlowe: rel('marlowe', { affection: 85, agreement: agreement('poly') }) }
    expect(pick('nova', rels, { ...newGameState(0), metamours: { 'marlowe|nova': 60 } }).reason).toBe(
      'Nova and Marlowe are both Lover or above on poly agreements, and approve of each other.',
    )
  })

  it('checks in priority order', () => {
    expect(ENDING_PRIORITY).toEqual(['polycule', 'reconciliation', 'bitter', 'sacrifice', 'hollow', 'open', 'good'])
    // A polycule wins over a betrayal; a betrayal over a rekindle; a rekindle over low trust.
    const game = { ...newGameState(0), metamours: { 'marlowe|nova': 60 } }
    const poly = { nova: won('nova', { agreement: agreement('poly'), betrayals: [betrayal], trust: 20 }), marlowe: rel('marlowe', { affection: 85, agreement: agreement('poly') }) }
    expect(pick('nova', poly, game).type).toBe('polycule')
    expect(pick('nova', { nova: won('nova', { betrayals: [betrayal], rekindledWith: 'kai', trust: 30 }) }).type).toBe('bitter')
    expect(pick('nova', { nova: won('nova', { rekindledWith: 'kai', trust: 30 }) }).type).toBe('sacrifice')
  })
})

describe('ENDINGS', () => {
  it('has a sentence-case title, a description and a direction for each', () => {
    for (const type of ENDING_PRIORITY) {
      const e = ENDINGS[type]
      expect(e.title).toMatch(/^The [a-z]+ ending$/)
      expect(e.description).toMatch(/^[A-Z].*\.$/)
      const d = e.direction({ name: 'Nova Castellanos', player: 'Robin' })
      expect(d).toContain('Nova Castellanos')
      expect(d).not.toMatch(/\{|\}/)
    }
    expect(endingDirection({ type: 'polycule', group: ['nova', 'marlowe'] }, { characterId: 'nova', name: 'Nova Castellanos', names })).toContain(
      'Nova Castellanos, Marlowe Achebe and the player are one polycule now',
    )
  })

  it('never picks a pronoun for them, and follows why the ending was chosen', () => {
    const sacrifice = (p: Parameters<typeof endingDirection>[1]) => endingDirection({ type: 'sacrifice' }, p)
    const base = { characterId: 'sasha', name: 'Sasha Volkova', player: 'Robin' }
    expect(sacrifice(base)).toBe(
      'Sasha Volkova chooses work, or a life that was already waiting, over Robin. Robin was great; something mattered more. Play it as a kind, sad goodbye with no villain.',
    )
    expect(sacrifice({ ...base, unpromised: true })).toContain(
      "Sasha Volkova wanted a promise Robin never asked for, and has chosen a life that doesn't wait on one.",
    )
    expect(sacrifice({ ...base, rival: 'Priya Raman' })).toContain('Sasha Volkova chooses Priya Raman over Robin.')
    expect(sacrifice(base)).not.toMatch(/\btheir\b/)
    expect(endingDirection({ type: 'open' }, { characterId: 'marlowe', name: 'Marlowe Achebe', agreement: 'poly' })).toContain('on a poly agreement they both actually like')
    expect(endingDirection({ type: 'open' }, { characterId: 'nova', name: 'Nova Castellanos', agreement: 'open' })).toContain('on an open agreement')
  })
})

describe('ending copy for the player', () => {
  it('names the character instead of "they", and says what a hollow ending was won on', () => {
    expect(endingDescription('hollow', 'Nova', 'trust')).toBe("You won Nova on affection more than trust. Nova is with you, and knows it isn't real. Nova might leave.")
    expect(endingDescription('hollow', 'Nova', 'connection')).toMatch(/^You won Nova on affection and heat without building real connection/)
    for (const t of ENDING_PRIORITY.filter((x) => x !== 'polycule')) expect(endingDescription(t, 'Nova')).not.toMatch(/\b(they|them)\b/i)
    const pick = selectEnding({ characterId: 'nova', characters, rels: { nova: won('nova', { trust: 31 }) }, game: newGameState(1), relations, names })
    expect(pick).toMatchObject({ type: 'hollow', cause: 'trust' })
  })
  it('says where it is heading from Lover while trust is under 40', () => {
    expect(headingLine(rel('nova', { affection: 85, trust: 31 }), 'romantic')).toBe('Where this is heading: trust 31. Trust of 40 or more is what makes it real.')
    expect(headingLine(rel('nova', { affection: 85, trust: 31 }), 'romantic', false)).toBe('Trust is 31. Trust of 40 or more is what makes it real.')
    expect(headingLine(rel('nova', { affection: 70, trust: 31 }), 'romantic')).toBe('')
    expect(headingLine(rel('nova', { affection: 90, trust: 45 }), 'romantic')).toBe('')
  })
})
