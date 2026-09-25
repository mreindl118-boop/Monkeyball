// Phase 4 acceptance scenarios (docs/SPEC.md, "Acceptance checks", Phase 4), played through the
// date flow against a scripted model and a seeded random source.

import { describe, expect, it } from 'vitest'
import type { AgreementResult, BetrayalEvent, JudgeResult, Relationship } from '../types'
import { checkBetrayal } from './agreements'
import {
  canOpenDtr,
  closeDtr,
  createDate,
  createEpilogue,
  type DateSession,
  type DateWorld,
  finishDate,
  mentions,
  openDate,
  openDtr,
  othersOf,
  sendPlayerMessage,
} from './dateFlow'
import { newGameState } from './relationship'
import {
  afterhoursCharacters,
  afterhoursWorld,
  card,
  fakeLlm,
  lastJudge,
  lastStory,
  recorder,
  rel,
  type Script,
  scripted,
  T0,
} from './testKit'

type Llm = ReturnType<typeof fakeLlm>

async function start(world: DateWorld, venueId: string, llm: Llm['llm'], hooks = recorder().hooks, maxTurns = 10) {
  return openDate(createDate(world, { venueId, maxTurns }), llm, hooks)
}

async function say(s: DateSession, text: string, llm: Llm['llm'], hooks = recorder().hooks) {
  return sendPlayerMessage(s, text, llm, hooks)
}

async function end(s: DateSession, llm: Llm['llm'], hooks = recorder().hooks) {
  return (await finishDate(s, 'ended', llm, hooks)).session
}

const inRange = (e: BetrayalEvent) => {
  expect(e.affectionDelta).toBeGreaterThanOrEqual(-20)
  expect(e.affectionDelta).toBeLessThanOrEqual(-10)
  expect(e.trustDelta).toBeGreaterThanOrEqual(-30)
  expect(e.trustDelta).toBeLessThanOrEqual(-15)
  expect(Math.abs(e.trustDelta)).toBeGreaterThan(Math.abs(e.affectionDelta))
}

const judge = (p: Partial<JudgeResult>): Partial<JudgeResult> => p

// ---------------------------------------------------------------------------

describe('trust and affection are separate', () => {
  it('moves them on their own, and a caught lie drops trust more than affection', async () => {
    const rels = { nova: rel('nova', { affection: 50, trust: 50, dates: 2, lastDateAt: T0 - 100_000 }) }
    const { llm, calls } = fakeLlm({
      judges: [judge({ delta: 3, trustDelta: 0 }), judge({ delta: 0, trustDelta: 4 }), judge({ delta: -15, trustDelta: -9, breach: true, mood: 'betrayed' })],
    })
    let s = await start(afterhoursWorld({ id: 'nova', rels }), 'arcade', llm)
    s = await say(s, 'That cabinet is older than both of us.', llm)
    expect(s.rel).toMatchObject({ affection: 53, trust: 50 })
    s = await say(s, 'Honestly, I was nervous about tonight.', llm)
    expect(s.rel).toMatchObject({ affection: 53, trust: 54 })

    s = await say(s, 'I was home alone all night, I swear.', llm)
    const turn = s.record.turns.filter((t) => t.role === 'player').at(-1)!
    const applied = turn.applied!.nova
    expect(applied.affection).toBeLessThan(0)
    expect(Math.abs(applied.trust)).toBeGreaterThan(Math.abs(applied.affection))
    expect(s.rel.betrayals).toHaveLength(1)
    const e = s.rel.betrayals[0]
    expect(e).toMatchObject({ kind: 'lie', how: 'lie' })
    inRange(e)
    expect(s.rel.affection).toBe(53 + e.affectionDelta)
    expect(s.rel.trust).toBe(54 + e.trustDelta)
    expect(s.rel.jealous).toBe(true)
    expect(s.rel.memory.at(-1)).toBe(e.memory)
    expect(e.memory).toMatch(/^I caught a lie/)

    // The reply knows it landed as a breach, and her memory has the line.
    const reply = lastStory(calls)
    expect(reply).toContain('It broke something the two of you agreed on.')
    expect(reply).toContain('I caught a lie on our date')
    // The judge's opinion carries it on the next message.
    s = await say(s, 'Okay. I lied. I was out.', llm)
    expect(lastJudge(calls)).toContain("current opinion: caught the player in a lie and hasn't let it go; still hurts\n")
  })
})

describe('seeing two people with no agreement', () => {
  const rels0 = () => ({
    nova: rel('nova', { affection: 45, trust: 40, dates: 2, lastDateAt: T0 - 50_000 }),
    kai: rel('kai', { affection: 30, trust: 20, dates: 1, lastDateAt: T0 - 40_000 }),
  })

  it('is no betrayal, even when each learns about the other', async () => {
    const { llm, calls } = fakeLlm()
    const { hooks, world } = recorder()
    // 0.1 makes every gossip roll land: Kai hears about the Nova date through the ex link.
    let s = await start(afterhoursWorld({ id: 'nova', rels: rels0(), rng: () => 0.1 }), 'arcade', llm, hooks)
    s = await say(s, 'I went to see Kai at The Low Tide last night.', llm, hooks)
    expect(s.rel.knownOthers).toEqual(['kai'])
    expect(s.rel.betrayals).toEqual([])
    expect(s.rel.jealous).toBe(false)
    expect(lastStory(calls)).toContain('that Nova Castellanos knows about: Kai Okoro\n')
    s = await end(s, llm, hooks)

    const after = s.worldAfter!
    expect(after.betrayals).toEqual([])
    expect(after.rels.kai.knownOthers).toEqual(['nova'])
    expect(after.rels.kai.betrayals).toEqual([])
    // Kai (medium jealousy) minds, which is jealousy, not betrayal.
    expect(after.rels.kai.jealous).toBe(true)
    expect(after.news.map((n) => n.text)).toEqual(["Kai heard you've been out with Nova."])
    expect(world[0].rels.map((r) => r.characterId)).toEqual(['kai'])
    expect(s.record.recap!.world!.news).toHaveLength(1)
  })
})

describe('exclusive with Nova, then a date with Kai', () => {
  const kai0 = rel('kai', { affection: 30, trust: 20, dates: 1, lastDateAt: T0 - 80_000 })

  /** Nova and the player agree to be exclusive through Define the relationship. */
  async function goExclusive() {
    const rels = { nova: rel('nova', { affection: 45, trust: 40, dates: 3, lastDateAt: T0 - 90_000 }), kai: kai0 }
    const agreement: AgreementResult = { agreement: 'exclusive', accepted: true, terms: 'Just us, and we say so if that changes.', trustDelta: 3 }
    const { llm, calls } = fakeLlm({ judges: [judge({ delta: 2, trustDelta: 1 })], agreements: [agreement] })
    let s = await start(afterhoursWorld({ id: 'nova', rels, rng: () => 0.9 }), 'arcade', llm)
    expect(canOpenDtr(s)).toBe(true)
    s = openDtr(s, 'exclusive', 'player')
    expect(s.record.dtr).toMatchObject({ requested: 'exclusive', by: 'player' })
    s = await say(s, 'Can we make this just us? Only each other.', llm)
    const talk = s.record.turns.slice(-2)
    expect(talk.map((t) => [t.role, t.dtr])).toEqual([
      ['player', true],
      ['character', true],
    ])
    expect(lastStory(calls)).toContain(
      'The player wants to define what you two are and is asking for exclusive (only each other). Answer as Nova Castellanos would',
    )
    const trustBefore = s.rel.trust
    s = await closeDtr(s, llm, recorder().hooks)
    expect(calls.agreement).toHaveLength(1)
    expect(calls.agreement[0].system).toContain('The player asked for: exclusive (only each other).')
    expect(calls.agreement[0].system).toContain('Player: Can we make this just us? Only each other.')
    expect(s.rel.agreement).toMatchObject({ type: 'exclusive', terms: 'Just us, and we say so if that changes.' })
    expect(s.rel.agreement.madeAt).toBeGreaterThan(T0)
    expect(s.rel.trust).toBe(trustBefore + 3)
    expect(s.record.dtr).toMatchObject({ closedAt: expect.any(Number), result: agreement })
    expect(s.status).toBe('awaiting-player')

    // The talk is over: the next turn is not flagged and the note is gone.
    s = await say(s, 'I really like this.', llm)
    expect(s.record.turns.at(-1)!.dtr).toBeUndefined()
    expect(lastStory(calls)).not.toContain('define what you two are')
    s = await end(s, llm)
    expect(calls.agreement).toHaveLength(1)
    const recap = s.record.recap!.perCharacter.nova
    expect(recap.agreementBefore?.type).toBe('none')
    expect(recap.agreementAfter?.type).toBe('exclusive')
    expect(recap.dtr?.result?.accepted).toBe(true)
    return s.rel
  }

  it('Nova hears about the Kai date through her ex link: a betrayal in her voice, in her next prompts', async () => {
    const nova = await goExclusive()
    const { llm } = fakeLlm()
    const { hooks, world } = recorder()
    // An hour later, a date with Kai. 0.1: the gossip roll to Nova (ex, 0.3) lands.
    let s = await start(afterhoursWorld({ id: 'kai', rels: { nova, kai: kai0 }, rng: () => 0.1, start: T0 + 3_600_000 }), 'boardwalk', llm, hooks)
    s = await say(s, 'This boardwalk at night is something else.', llm, hooks)
    s = await end(s, llm, hooks)

    const after = s.worldAfter!
    expect(after.betrayals.map((b) => b.characterId)).toEqual(['nova'])
    const e = after.betrayals[0].event
    expect(e).toMatchObject({ kind: 'agreement', about: 'kai', how: 'gossip', agreement: 'exclusive' })
    inRange(e)
    const novaAfter = after.rels.nova
    expect(novaAfter.betrayals).toEqual([e])
    expect(novaAfter.affection).toBe(nova.affection + e.affectionDelta)
    expect(novaAfter.trust).toBe(nova.trust + e.trustDelta)
    expect(novaAfter.jealous).toBe(true)
    expect(novaAfter.knownOthers).toEqual(['kai'])
    expect(novaAfter.memory.at(-1)).toBe(e.memory)
    expect(e.memory).toMatch(/^We agreed to be exclusive, and I had to hear about Kai from someone else\. /)
    expect(after.news.map((n) => n.text)).toContain('Nova heard about Kai through the grapevine, and you two had agreed to be exclusive.')
    expect(s.record.recap!.world!.betrayals).toEqual(after.betrayals)
    expect(world[0].rels.find((r) => r.characterId === 'nova')?.betrayals).toHaveLength(1)

    // The next date with Nova: her story prompt and her judge know.
    const { llm: llm2, calls } = fakeLlm()
    let n = await start(afterhoursWorld({ id: 'nova', rels: after.rels, start: T0 + 7_200_000 }), 'record-store', llm2)
    const opening = lastStory(calls)
    expect(opening).toContain(
      'Other people the player is seeing that Nova Castellanos knows about: Kai Okoro, which breaks the exclusive agreement Nova Castellanos made with the player\n',
    )
    expect(opening).toContain(e.memory!)
    expect(opening).toContain('Agreement: exclusive: Just us, and we say so if that changes')
    n = await say(n, 'Hey. Can we talk?', llm2)
    expect(lastJudge(calls)).toContain(
      "Nova Castellanos's current opinion: thinks we agreed to be exclusive and just heard about Kai Okoro; it breaks that agreement; still hurts\n",
    )
    expect(lastJudge(calls)).toContain('Of those, Nova Castellanos knows about: Kai Okoro.')
    expect(n.rel.betrayals).toHaveLength(1)
  })

  it('or the player mentions Kai to her', async () => {
    const nova = await goExclusive()
    const kai = rel('kai', { affection: 32, trust: 22, dates: 2, lastDateAt: nova.agreement.madeAt + 60_000 })
    const { llm, calls } = fakeLlm({ judges: [judge({ delta: 1, trustDelta: 2 })] })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova, kai }, start: T0 + 7_200_000 }), 'arcade', llm)
    const before = s.rel
    s = await say(s, 'I had a drink with Kai last night.', llm)
    const e = s.rel.betrayals.at(-1)!
    expect(e).toMatchObject({ kind: 'agreement', about: 'kai', how: 'player', agreement: 'exclusive' })
    inRange(e)
    // The betrayal's drop replaces the judge's +1 and +2.
    expect(s.rel.affection).toBe(before.affection + e.affectionDelta)
    expect(s.rel.trust).toBe(before.trust + e.trustDelta)
    expect(s.rel.knownOthers).toEqual(['kai'])
    expect(s.rel.jealous).toBe(true)
    expect(e.memory).toContain('straight from the source')
    expect(s.disclosed).toEqual(['kai'])
    expect(lastStory(calls)).toContain('knows about: Kai Okoro, which breaks the exclusive agreement Nova Castellanos made with the player')
    // Hearing it from someone else is worse than hearing it from the player.
    const gossip = checkBetrayal(card('nova'), nova, 'kai', 'gossip', kai, T0, () => 0.5)!
    expect(gossip.trustDelta).toBeLessThan(e.trustDelta)
  })
})

describe('poly and open agreements', () => {
  const kaiAfter = (madeAt: number) => rel('kai', { affection: 30, trust: 20, dates: 2, lastDateAt: madeAt + 10_000 })

  it('poly: telling her adds trust through the judge and moves metamour approval', async () => {
    const madeAt = T0 - 50_000
    const nova = rel('nova', { affection: 60, trust: 50, dates: 4, agreement: { type: 'poly', terms: 'We tell each other about everyone.', madeAt } })
    const { llm } = fakeLlm({ judges: [judge({ delta: 1, trustDelta: 3, mood: 'warm' })] })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova, kai: kaiAfter(madeAt) }, rng: () => 0.9 }), 'arcade', llm)
    s = await say(s, "I've been seeing Kai, and I wanted you to hear it from me.", llm)
    expect(s.rel.betrayals).toEqual([])
    expect(s.rel.trust).toBe(53)
    expect(s.rel.knownOthers).toEqual(['kai'])
    s = await end(s, llm)
    // Exes start at 35; the player's disclosure under poly adds 5.
    expect(s.worldAfter!.game.metamours).toEqual({ 'kai|nova': 40 })
  })

  it('poly: learning it through gossip is a smaller betrayal', async () => {
    const madeAt = T0 - 50_000
    const agreement = { type: 'poly' as const, terms: 'We tell each other about everyone.', madeAt }
    const nova = rel('nova', { affection: 60, trust: 50, dates: 4, agreement })
    const { llm } = fakeLlm()
    let s = await start(afterhoursWorld({ id: 'kai', rels: { nova, kai: kaiAfter(madeAt) }, rng: () => 0.1 }), 'boardwalk', llm)
    s = await end(await say(s, 'Hi.', llm), llm)
    const e = s.worldAfter!.betrayals[0].event
    expect(e).toMatchObject({ kind: 'agreement', how: 'gossip', agreement: 'poly', about: 'kai' })
    inRange(e)
    expect(e.memory).toContain("We said we'd tell each other about other people")
    // Smaller than breaking exclusive, for the same person heard the same way.
    const exclusive = checkBetrayal(card('nova'), { ...nova, agreement: { ...agreement, type: 'exclusive' } }, 'kai', 'gossip', s.worldAfter!.rels.kai, T0 + 10_000_000, () => 0.1)!
    expect(e.affectionDelta).toBeGreaterThan(exclusive.affectionDelta)
    expect(e.trustDelta).toBeGreaterThan(exclusive.trustDelta)
    // Hearing it through gossip under poly costs metamour approval.
    expect(s.worldAfter!.game.metamours['kai|nova']).toBe(25)
  })

  it('open without disclosure terms: no betrayal; open with them: a betrayal', async () => {
    const madeAt = T0 - 50_000
    for (const [terms, betrayed] of [
      ['Open. What you do elsewhere is your business.', false],
      ["Open, but tell me before anything happens with someone.", true],
    ] as const) {
      const nova = rel('nova', { affection: 60, trust: 50, dates: 4, agreement: { type: 'open', terms, madeAt } })
      const { llm } = fakeLlm()
      let s = await start(afterhoursWorld({ id: 'kai', rels: { nova, kai: kaiAfter(madeAt) }, rng: () => 0.1 }), 'boardwalk', llm)
      s = await end(await say(s, 'Hi.', llm), llm)
      expect(s.worldAfter!.rels.nova.knownOthers).toEqual(['kai'])
      expect(s.worldAfter!.betrayals.length > 0).toBe(betrayed)
    }
  })
})

describe('the friend route', () => {
  // Sasha is into women; the player is a man. Priya (bi) is into him at 65.
  const rels0 = () => ({
    sasha: rel('sasha', { affection: 50, trust: 57, dates: 3, lastDateAt: T0 - 100_000 }),
    priya: rel('priya', { affection: 65, trust: 30, dates: 3, lastDateAt: T0 - 90_000 }),
    dex: rel('dex', { affection: 10, trust: 5, dates: 1, lastDateAt: T0 - 80_000 }),
  })
  const man = { gender: 'man' as const, pronouns: 'he/him' }

  it('caps affection at 59, unlocks tiers 1-2 only, earns secrets on trust, and her gossip reaches the story', async () => {
    const tens = Array.from({ length: 4 }, () => judge({ delta: 10, trustDelta: 4, mood: 'easy' }))
    const { llm, calls } = fakeLlm({ judges: tens })
    let s = await start(afterhoursWorld({ id: 'sasha', rels: rels0(), profile: man, rng: seeded7() }), 'hot-spring', llm)
    expect(s.dtrOffer).toBeUndefined()
    expect(s.gossip!.lines).toHaveLength(3)
    expect(s.gossip!.lines[0]).toBe('Priya Raman is into you, properly')
    const opening = lastStory(calls)
    expect(opening).toContain('Route: friend.')
    expect(opening).toContain(`Gossip Sasha Volkova is happy to share: ${s.gossip!.lines.join('; ')}.`)
    for (let i = 0; i < 4; i++) s = await say(s, `Tell me about the ER, part ${i + 1}.`, llm)
    expect(s.rel.affection).toBe(59)
    expect(s.rel.tiersUnlocked).toEqual([1, 2])
    // Hard difficulty: +4 trust lands as +3; 57 -> 60 unlocks the first secret on trust.
    expect(s.rel.secretsUnlocked).toContain(0)
    expect(lastStory(calls)).toContain('Gossip Sasha Volkova is happy to share:')
    s = await end(s, llm)
    expect(s.record.recap!.perCharacter.sasha.gossip).toEqual(s.gossip!.lines)
    const revealed = s.gossip!.reveals.filter((r) => r.characterId in rels0())
    for (const r of revealed) {
      const after = s.worldAfter!.rels[r.characterId].revealed
      if (r.attractions) expect(after.attractions).toBe(true)
      if (r.style) expect(after.style).toBe(true)
    }
  })

  it("is romantic in everyone's-into-you mode: no gossip, no cap", async () => {
    const tens = Array.from({ length: 4 }, () => judge({ delta: 10, trustDelta: 4 }))
    const { llm, calls } = fakeLlm({ judges: tens })
    let s = await start(
      afterhoursWorld({ id: 'sasha', rels: rels0(), profile: man, settings: { orientationMode: 'everyone' }, rng: seeded7() }),
      'hot-spring',
      llm,
    )
    expect(s.gossip).toBeUndefined()
    expect(lastStory(calls)).toContain('Route: romantic.')
    for (let i = 0; i < 4; i++) s = await say(s, 'Tell me more.', llm)
    expect(s.rel.affection).toBeGreaterThan(59)
  })
})

function seeded7() {
  // A fixed pattern, so the gossip shuffle is the same every run.
  let i = 0
  const values = [0.13, 0.71, 0.42, 0.88, 0.05, 0.57, 0.33, 0.96, 0.24, 0.64]
  return () => values[i++ % values.length]
}

describe('misgendering', () => {
  it('lands as a turn-off with a trust drop for every character', async () => {
    const all = afterhoursCharacters()
    for (const id of Object.keys(all)) {
      const rels = { [id]: rel(id, { affection: 30, trust: 30, dates: 2 }) }
      const { llm, calls } = fakeLlm({
        judges: [judge({ delta: -10, trustDelta: -6, hits: [{ type: 'turnOff', id: 'misgendering' }], mood: 'hurt', hint: 'A flat, tired look' })],
      })
      let s = await start(afterhoursWorld({ id, rels }), 'arcade', llm)
      const before = s.rel
      s = await say(s, 'Wrong name, wrong pronouns, on purpose.', llm)
      expect(lastJudge(calls)).toMatch(/Turn-offs: .*misgendering: Being misgendered or deadnamed/)
      const turn = s.record.turns.filter((t) => t.role === 'player').at(-1)!
      expect(turn.judge![id].hits).toEqual([{ type: 'turnOff', id: 'misgendering' }])
      expect(turn.applied![id].affection).toBeLessThan(0)
      expect(turn.applied![id].trust).toBeLessThan(0)
      expect(s.rel.affection).toBeLessThan(before.affection)
      expect(s.rel.trust).toBeLessThan(before.trust)
      expect(lastStory(calls)).toContain('It hit a turn-off: Being misgendered or deadnamed')
      // Everyone has it, so it isn't a discovery on the profile.
      expect(s.rel.discovered).toEqual(before.discovered)
    }
  })
})

describe('rumors', () => {
  it("unlocking Jules's secret passes his rumors on (seeded), and they reach his story prompt", async () => {
    // Karaoke is his favorite: +3 takes him from 58 to 61, past his first secret. Jules is into
    // men, so the player is one (a friend route would earn his secrets on trust instead).
    const rels = { jules: rel('jules', { affection: 58, trust: 30, dates: 3 }) }
    const { llm, calls } = fakeLlm()
    const profile = { gender: 'man' as const, pronouns: 'he/him' }
    let s = await start(afterhoursWorld({ id: 'jules', rels, profile, rng: scripted([0.2, 0.7]) }), 'karaoke-box', llm)
    expect(s.rel.secretsUnlocked).toEqual([0])
    expect(s.heard?.map((h) => [h.rumorId, h.heardFrom])).toEqual([['breakup-kai-side', 'jules']])
    expect(lastStory(calls)).toContain(
      'Rumors Jules Ferreira has passed on: Nova was on a date with someone new nine days after she and Kai split.',
    )
    s = await end(await say(s, 'Tell me everything.', llm), llm)
    expect(s.record.recap!.perCharacter.jules.rumors).toEqual(['breakup-kai-side'])
    expect(s.worldAfter!.game.rumors).toEqual([{ rumorId: 'breakup-kai-side', heardFrom: 'jules', at: expect.any(Number), relayedTo: [] }])
  })

  it('relaying a false rumor to its subject reaches the judge with its truth', async () => {
    const game = { ...newGameState(T0 - 1_000_000), rumors: [{ rumorId: 'kai-getting-fired', heardFrom: 'dex', at: T0 - 10_000, relayedTo: [] }] }
    const rels = { kai: rel('kai', { affection: 30, trust: 30, dates: 2 }) }
    const { llm, calls } = fakeLlm({ judges: [judge({ delta: -4, trustDelta: -3, mood: 'stung' })] })
    let s = await start(afterhoursWorld({ id: 'kai', rels, game }), 'boardwalk', llm)
    s = await say(s, "Dex says you've been in the office with the owner every night and you're getting fired.", llm)
    const prompt = lastJudge(calls)
    expect(prompt).toContain(
      `Known secrets shared with Kai Okoro: the player heard from Dex Adeyemi that "Kai's been in The Low Tide's office with the owner every night this week.`,
    )
    expect(prompt).toContain("(false; what's actually true: The Low Tide's owner is retiring and has offered Kai the bar)\n")
    expect(s.relayed).toEqual(['kai-getting-fired'])
    s = await end(s, llm)
    expect(s.worldAfter!.game.rumors[0].relayedTo).toEqual(['kai'])
  })
})

describe('betrayal recovery', () => {
  it('slows trust gains after a betrayal and keeps affection', async () => {
    const e: BetrayalEvent = { at: T0 - 5000, kind: 'lie', note: 'Caught you in a lie.', affectionDelta: -14, trustDelta: -22 }
    const judges = [judge({ delta: 2, trustDelta: 4 })]
    const clean = await (async () => {
      const { llm } = fakeLlm({ judges: [...judges] })
      const s = await start(afterhoursWorld({ id: 'kai', rels: { kai: rel('kai', { affection: 56, trust: 30, dates: 5 }) } }), 'arcade', llm)
      return say(s, 'I brought your favorite.', llm)
    })()
    const grudging = await (async () => {
      const { llm } = fakeLlm({ judges: [...judges] })
      const s = await start(
        afterhoursWorld({ id: 'kai', rels: { kai: rel('kai', { affection: 56, trust: 30, dates: 5, betrayals: [e] }) } }),
        'arcade',
        llm,
      )
      return say(s, 'I brought your favorite.', llm)
    })()
    // Kai is hard (x0.75): +4 is +3 before a betrayal, and +1 after (medium grudge x0.5).
    expect(clean.rel.trust - 30).toBe(3)
    expect(grudging.rel.trust - 30).toBe(1)
    // Affection moves the same either way: it dropped once, it isn't reset.
    expect(grudging.rel.affection).toBe(clean.rel.affection)
  })
})

describe('the character asks to define the relationship', () => {
  const nova = () => rel('nova', { affection: 45, trust: 55, dates: 3 })

  it('offers what they want at date start (25%), and the talk opens with it', async () => {
    const { llm, calls } = fakeLlm({
      judges: [judge({ delta: 2 })],
      agreements: [{ agreement: 'open', accepted: true, terms: 'Open, and no surprises.', trustDelta: 2 }],
    })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova: nova() }, rng: () => 0.2 }), 'arcade', llm)
    expect(s.dtrOffer).toBe('open')
    s = openDtr(s, s.dtrOffer!, 'character')
    expect(s.dtrOffer).toBeUndefined()
    expect(s.record.dtr).toMatchObject({ requested: 'open', by: 'character' })
    s = await say(s, 'Yes. Let us talk about it.', llm)
    // Ending the date settles the talk: the Agreement prompt runs once.
    s = await end(s, llm)
    expect(calls.agreement).toHaveLength(1)
    expect(s.rel.agreement).toMatchObject({ type: 'open', terms: 'Open, and no surprises.' })
    expect(s.record.dtr?.closedAt).toEqual(expect.any(Number))
    expect(s.rel.revealed.style).toBe(true)
  })

  it("doesn't ask on a 0.25 roll or under the thresholds", async () => {
    const { llm } = fakeLlm()
    expect((await start(afterhoursWorld({ id: 'nova', rels: { nova: nova() }, rng: () => 0.25 }), 'arcade', llm)).dtrOffer).toBeUndefined()
    const low = rel('nova', { affection: 45, trust: 49, dates: 3 })
    expect((await start(afterhoursWorld({ id: 'nova', rels: { nova: low }, rng: () => 0 }), 'arcade', llm)).dtrOffer).toBeUndefined()
  })

  it('keeps the agreement when declined, applies the trust, and skips the call when nothing was said', async () => {
    const { llm, calls } = fakeLlm({ agreements: [{ agreement: 'exclusive', accepted: false, terms: '', trustDelta: -2 }] })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova: nova() }, rng: () => 0.9 }), 'arcade', llm)
    s = openDtr(s, 'exclusive', 'player')
    expect(canOpenDtr(s)).toBe(false)
    const quiet = await closeDtr(s, llm, recorder().hooks)
    expect(calls.agreement).toHaveLength(0)
    expect(quiet.record.dtr?.closedAt).toEqual(expect.any(Number))
    s = await say(s, 'I want it to be just us.', llm)
    const trust = s.rel.trust
    s = await closeDtr(s, llm, recorder().hooks)
    expect(calls.agreement).toHaveLength(1)
    expect(s.rel.agreement.type).toBe('none')
    expect(s.rel.trust).toBe(trust - 2)
  })

  it('is not on offer below Friend or on an epilogue', async () => {
    const { llm } = fakeLlm()
    const s = await start(afterhoursWorld({ id: 'nova', rels: { nova: rel('nova', { affection: 30, dates: 2 }) } }), 'arcade', llm)
    expect(canOpenDtr(s)).toBe(false)
    expect(openDtr(s, 'exclusive', 'player')).toBe(s)
  })
})

describe('the epilogue', () => {
  it('plays 6 turns at their first favorite venue with the ending in every turnNote, then records it', async () => {
    const nova = rel('nova', { affection: 100, trust: 80, dates: 12, connection: 12, agreement: { type: 'exclusive', terms: 'Just us.', madeAt: 1 } })
    const { llm, calls } = fakeLlm()
    const { hooks } = recorder()
    const world = afterhoursWorld({ id: 'nova', rels: { nova } })
    let s = createEpilogue(world, { type: 'good' })
    expect(s.record).toMatchObject({ kind: 'epilogue', maxTurns: 6, venueId: 'record-store', endingType: 'good' })
    s = await openDate(s, llm, hooks)
    expect(s.dtrOffer).toBeUndefined()
    expect(lastStory(calls)).toContain('Epilogue: Nova Castellanos and Robin are together, and it')
    for (let i = 0; i < 6; i++) s = await say(s, `Line ${i + 1}.`, llm, hooks)
    expect(s.status).toBe('ended')
    expect(calls.story).toHaveLength(7)
    for (const c of calls.story) expect(c.system).toContain('Epilogue: ')
    expect(lastStory(calls)).toContain('Turn 6 of 6. Last turn:')
    expect(s.rel.ending).toEqual({ type: 'good', playedAt: expect.any(Number) })
    expect(s.worldAfter!.game.endingsSeen).toEqual({ nova: ['good'] })
    expect(s.worldAfter!.news).toEqual([])
    expect(s.record.recap!.world).toBeUndefined()
  })

  it('names the polycule and the one they chose instead', () => {
    const world = afterhoursWorld({ id: 'nova', rels: { nova: rel('nova', { affection: 100, rekindledWith: 'kai' }) } })
    expect(createEpilogue(world, { type: 'polycule', group: ['nova', 'marlowe'] }).ending!.direction).toContain(
      'Nova Castellanos, Marlowe Achebe and Robin are one polycule now',
    )
    expect(createEpilogue(world, { type: 'sacrifice' }).ending!.direction).toContain('Nova Castellanos chooses Kai Okoro over Robin.')
  })
})

describe('without relationship features', () => {
  it('plays exactly as a Phase 3 date: same prompts, no news, no world changes', async () => {
    const script: Script = {
      judges: [judge({ delta: 3, trustDelta: 1, hits: [{ type: 'like', id: 'vinyl' }] }), judge({ delta: -8, hits: [{ type: 'turnOff', id: 'cute' }] })],
    }
    const run = async (full: boolean) => {
      const { llm, calls } = fakeLlm(structuredClone(script))
      const rels: Record<string, Relationship> = { nova: rel('nova', { affection: 22, trust: 10, dates: 1 }) }
      let s = await start(afterhoursWorld({ id: 'nova', rels, full, rng: () => 0.5 }), 'record-store', llm, recorder().hooks, 3)
      for (const m of ['Is that a first pressing?', 'You look cute tonight.', 'Same time next week?']) s = await say(s, m, llm)
      return { s, calls }
    }
    const phase3 = await run(false)
    const phase4 = await run(true)
    expect(phase4.calls.story.map((c) => c.system)).toEqual(phase3.calls.story.map((c) => c.system))
    expect(phase4.calls.judge.map((c) => c.system)).toEqual(phase3.calls.judge.map((c) => c.system))
    expect(phase4.s.rel).toEqual(phase3.s.rel)
    expect(phase3.s.worldAfter).toBeUndefined()
    expect(phase4.s.worldAfter).toMatchObject({ news: [], betrayals: [] })
    expect(phase4.s.record.recap).toEqual(phase3.s.record.recap)
  })
})

describe('closing the talk when the Agreement call fails', () => {
  it('keeps the talk open, and the end of the date settles it', async () => {
    const { llm, calls } = fakeLlm({ agreements: [{ agreement: 'casual', accepted: true, terms: 'No labels.', trustDelta: 1 }] })
    const failing = { ...llm, agreement: async () => Promise.reject(new Error('offline')) }
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova: rel('nova', { affection: 45, trust: 40, dates: 3 }) }, rng: () => 0.9 }), 'arcade', llm)
    s = openDtr(s, 'casual', 'player')
    s = await say(s, 'Can we keep this light?', llm)
    const kept = await closeDtr(s, failing, recorder().hooks)
    expect(kept.record.dtr?.closedAt).toBeUndefined()
    expect(kept.status).toBe('awaiting-player')
    const stopped = new AbortController()
    stopped.abort()
    expect((await closeDtr(s, llm, { ...recorder().hooks, signal: stopped.signal })).record.dtr?.closedAt).toBeUndefined()
    expect(calls.agreement).toHaveLength(0)
    s = await end(kept, llm)
    expect(calls.agreement).toHaveLength(1)
    expect(s.rel.agreement.type).toBe('casual')
  })
})

describe('who counts', () => {
  it('reads names the way players type them', () => {
    expect(mentions('I saw Kai last night.', 'Kai Okoro')).toBe(true)
    expect(mentions('i saw kai last night', 'Kai Okoro')).toBe(true)
    expect(mentions('I saw kai last night.', 'Kai Okoro')).toBe(false)
    expect(mentions('Have you met kai okoro?', 'Kai Okoro')).toBe(true)
    expect(mentions('My rook took your knight.', 'Rook Halvorsen')).toBe(false)
    expect(mentions('Rook fixed the cabinet.', 'Rook Halvorsen')).toBe(true)
    expect(mentions('Kaiser rolls.', 'Kai Okoro')).toBe(false)
  })

  it('leaves characters of sets that are switched off out of {others}', () => {
    const rels = {
      nova: rel('nova', { affection: 30, dates: 2 }),
      kai: rel('kai', { affection: 30, dates: 2 }),
      wren: rel('wren', { affection: 40, dates: 3 }),
    }
    expect(othersOf(afterhoursWorld({ id: 'nova', rels }))).toEqual(['kai'])
    expect(othersOf({ ...afterhoursWorld({ id: 'nova', rels, full: false }), rels })).toEqual(['kai', 'wren'])
    expect(othersOf({ ...afterhoursWorld({ id: 'nova', full: false }), others: ['kai', 'nova'] })).toEqual(['kai'])
  })
})
