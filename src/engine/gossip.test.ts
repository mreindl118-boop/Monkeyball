import { describe, expect, it } from 'vitest'
import type { Agreement, Relationship } from '../types'
import {
  afterDateWorld,
  applyGossipReveals,
  friendGossipLines,
  GOSSIP_CHANCE,
  listeners,
  relaysRumor,
  rumorsOnSecretUnlock,
  SAME_SET_CHANCE,
  sharedSecretsText,
} from './gossip'
import { newGameState } from './relationship'
import {
  afterhoursCharacters,
  afterhoursNames,
  afterhoursRelations,
  afterhoursRumors,
  afterhoursSetOf,
  card,
  rel,
  scripted,
  seeded,
} from './testKit'

const characters = afterhoursCharacters()
const relations = afterhoursRelations()
const names = afterhoursNames()
const setOf = afterhoursSetOf()
const rumors = afterhoursRumors()
const romantic = () => 'romantic' as const
const exclusive = (madeAt = 1000): Agreement => ({ type: 'exclusive', terms: 'Just us.', madeAt })

function world(rels: Record<string, Relationship>, rng: () => number, extra: { setOf?: Record<string, string> } = {}) {
  return afterDateWorld({ datedIds: ['kai'], characters, rels, relations, routeOf: romantic, game: newGameState(0), now: 9000, rng, names, ...extra })
}

describe('listeners', () => {
  it('has the chance by relation, then the rest of the set at 0.1', () => {
    const l = listeners('kai', relations, setOf)
    expect(l.slice(0, 4)).toEqual([
      { id: 'nova', chance: GOSSIP_CHANCE.ex },
      { id: 'jules', chance: GOSSIP_CHANCE.friend },
      { id: 'dex', chance: GOSSIP_CHANCE.rival },
      { id: 'imani', chance: GOSSIP_CHANCE.rival },
    ])
    expect(l.slice(4).every((x) => x.chance === SAME_SET_CHANCE)).toBe(true)
    expect(l).toHaveLength(11)
    expect(listeners('kai', relations)).toHaveLength(4)
    expect(listeners('sasha', relations)[0]).toEqual({ id: 'priya', chance: 0.5 })
  })

  it('never crosses sets without a declared relationship', () => {
    const other = { ...setOf, wren: 'polycule' }
    expect(listeners('kai', relations, other).some((x) => x.id === 'wren')).toBe(false)
  })
})

describe('afterDateWorld', () => {
  const base = () => ({
    nova: rel('nova', { dates: 3, affection: 50, trust: 40, lastDateAt: 500 }),
    kai: rel('kai', { dates: 2, affection: 30, lastDateAt: 8000 }),
  })

  it('spreads word of the date by the roll: under the chance hears it, at the chance does not', () => {
    const heard = world(base(), scripted([0.29]))
    expect(heard.rels.nova.knownOthers).toEqual(['kai'])
    expect(heard.news).toHaveLength(1)
    expect(heard.news[0]).toMatchObject({ kind: 'gossip', characterIds: ['nova', 'kai'], read: false, at: 9000 })
    expect(heard.game.news).toEqual(heard.news)
    const missed = world(base(), scripted([0.3]))
    expect(missed.rels.nova.knownOthers).toEqual([])
    expect(missed.news).toEqual([])
  })

  it("only reaches people who have met the player, and skips friend-route dates", () => {
    const rels = { kai: rel('kai', { dates: 2, affection: 30, lastDateAt: 8000 }), jules: rel('jules') }
    expect(world(rels, () => 0).rels.jules.knownOthers).toEqual([])
    const friend = afterDateWorld({ datedIds: ['kai'], characters, rels: base(), relations, routeOf: () => 'friend', game: newGameState(0), now: 9000, rng: () => 0, names })
    expect(friend.news).toEqual([])
  })

  it('turns a broken agreement into a betrayal with news, once per date', () => {
    const rels = { ...base(), nova: { ...base().nova, agreement: exclusive() } }
    const r = world(rels, () => 0.1)
    expect(r.betrayals).toHaveLength(1)
    expect(r.betrayals[0]).toMatchObject({ characterId: 'nova', event: { how: 'gossip', about: 'kai' } })
    expect(r.rels.nova.betrayals).toHaveLength(1)
    expect(r.rels.nova.jealous).toBe(true)
    expect(r.news.map((n) => n.kind)).toEqual(['betrayal'])
    // The same date heard again changes nothing.
    const again = world(r.rels, () => 0.1)
    expect(again.betrayals).toEqual([])
    expect(again.news).toEqual([])
  })

  it('costs metamour approval when heard through gossip under poly', () => {
    const rels = { ...base(), nova: { ...base().nova, agreement: { type: 'poly' as const, terms: '', madeAt: 1000 } } }
    expect(world(rels, () => 0.1).game.metamours).toEqual({ 'kai|nova': 25 })
  })

  it('is seeded: the same seed spreads the same way', () => {
    const rels: Record<string, Relationship> = {}
    for (const id of Object.keys(characters)) rels[id] = rel(id, { dates: 1, affection: 25, lastDateAt: 100 })
    rels.kai = { ...rels.kai, lastDateAt: 8000 }
    let novaHeard = 0
    for (let seed = 1; seed <= 60; seed++) {
      const a = world(rels, seeded(seed), { setOf })
      const b = world(rels, seeded(seed), { setOf })
      expect(a.news).toEqual(b.news)
      expect(a.news.every((n) => n.characterIds[1] === 'kai')).toBe(true)
      if (a.rels.nova.knownOthers.includes('kai')) novaHeard++
    }
    // Nova is Kai's ex (0.3): some seeds carry it to her, most don't.
    expect(novaHeard).toBeGreaterThan(5)
    expect(novaHeard).toBeLessThan(35)
  })
})

describe('friendGossipLines', () => {
  const ctx = (rels: Record<string, Relationship>, rng: () => number) => ({ characters, rels, relations, routeOf: romantic, names, rng })

  it("leads with who's into the player, then facts they haven't found, three at most", () => {
    const rels = { priya: rel('priya', { affection: 65 }), dex: rel('dex') }
    const g = friendGossipLines(card('sasha'), ctx(rels, seeded(3)))
    expect(g.lines).toHaveLength(3)
    expect(g.lines[0]).toBe('Priya Raman is into you, properly')
    for (const line of g.lines.slice(1)) expect(line).toMatch(/^(Priya Raman|Dex Adeyemi) /)
    expect(g.reveals.length).toBeGreaterThan(0)
  })

  it('tells who is with whom from the relationships', () => {
    const g = friendGossipLines(card('sasha'), ctx({ dex: rel('dex', { revealed: { attractions: true, style: true } }) }, () => 0.5))
    const pool = [0, 0.3, 0.6, 0.9].flatMap((v) =>
      friendGossipLines(card('sasha'), ctx({ dex: rel('dex', { revealed: { attractions: true, style: true } }), priya: rel('priya', { revealed: { attractions: true, style: true } }) }, () => v)).lines,
    )
    expect([...g.lines, ...pool]).toContain('Dex Adeyemi and Imani Clarke are together: together six years and open for the last two; it works because they talk about it constantly')
  })

  it('reveals attractions and style facts on those characters', () => {
    const rels = { dex: rel('dex'), priya: rel('priya') }
    const out = applyGossipReveals(rels, [{ characterId: 'dex', attractions: true }, { characterId: 'priya', style: true }, { characterId: 'nobody', style: true }])
    expect(out.dex.revealed).toEqual({ attractions: true, style: false })
    expect(out.priya.revealed).toEqual({ attractions: false, style: true })
    expect(applyGossipReveals(rels, [])).toBe(rels)
  })
})

describe('rumors', () => {
  it("passes on each of the teller's unheard rumors on a 50% roll", () => {
    expect(rumorsOnSecretUnlock('jules', rumors, [], scripted([0.4, 0.6]), 7).map((h) => h.rumorId)).toEqual(['breakup-kai-side'])
    expect(rumorsOnSecretUnlock('jules', rumors, [], scripted([0.6, 0.4]), 7).map((h) => h.rumorId)).toEqual(['cass-and-theo'])
    const heard = [{ rumorId: 'breakup-kai-side', heardFrom: 'jules', at: 1, relayedTo: [] }]
    let rolls = 0
    const r = rumorsOnSecretUnlock('jules', rumors, heard, () => (rolls++, 0), 7)
    expect(r).toEqual([{ rumorId: 'cass-and-theo', heardFrom: 'jules', at: 7, relayedTo: [] }])
    expect(rolls).toBe(1)
    expect(rumorsOnSecretUnlock('nobody', rumors, [], () => 0, 7)).toEqual([])
  })

  it("gives the judge the rumors about its character, with the truth", () => {
    const heard = [
      { rumorId: 'kai-getting-fired', heardFrom: 'dex', at: 1, relayedTo: [] },
      { rumorId: 'breakup-kai-side', heardFrom: 'jules', at: 2, relayedTo: ['kai'] },
      { rumorId: 'staff-party', heardFrom: 'cass', at: 3, relayedTo: [] },
    ]
    const text = sharedSecretsText('kai', heard, rumors, ['Rook Halvorsen saw the ring'], names)
    expect(text).toContain(`the player heard from Dex Adeyemi that "Kai's been in The Low Tide's office`)
    expect(text).toContain("(false; what's actually true: The Low Tide's owner is retiring and has offered Kai the bar)")
    expect(text).toContain('(exaggerated; what\'s actually true: Kai wanted monogamy')
    expect(text).toContain('; the player has already brought it up with them)')
    expect(text).not.toContain('staff party')
    expect(text).toContain('the player knows this secret: Rook Halvorsen saw the ring')
    expect(sharedSecretsText('sasha', heard, rumors, [])).toBe('none')
  })

  it('notices a rumor being passed on', () => {
    const fired = rumors.find((r) => r.id === 'kai-getting-fired')!
    expect(relaysRumor("Dex says you've been in the office with the owner every night and you're getting fired.", fired, 'kai', names)).toBe(true)
    expect(relaysRumor('The boardwalk is lovely tonight.', fired, 'kai', names)).toBe(false)
    const breakup = rumors.find((r) => r.id === 'breakup-kai-side')!
    expect(relaysRumor('Is it true Nova was dating nine days after?', breakup, 'kai', names)).toBe(true)
    expect(relaysRumor('Nine days is a long time.', breakup, 'kai', names)).toBe(false)
  })
})
