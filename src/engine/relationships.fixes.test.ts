// Phase 4 review fixes, played through the date flow against a scripted model: breaches counted
// once, honesty read as honesty, disclosure needing a dating context, who still counts as "seeing",
// what the story and the judge are told (betrayal turns, rumors relayed, the character's own talk,
// what the player said about how they date, rekindles), and how the date ends (one save).

import { describe, expect, it } from 'vitest'
import type { AgreementResult, BetrayalEvent, JudgeResult, Relationship } from '../types'
import {
  closeDtr,
  createDate,
  type DateHooks,
  type DateSession,
  type DateWorld,
  finishDate,
  openDate,
  openDtr,
  sendPlayerMessage,
  talksAboutDating,
} from './dateFlow'
import { newGameState } from './relationship'
import { afterhoursCharacters, afterhoursWorld, card, fakeLlm, lastJudge, lastStory, recorder, rel, T0 } from './testKit'

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

const judge = (p: Partial<JudgeResult>): Partial<JudgeResult> => p
const exclusive = (madeAt: number) => ({ type: 'exclusive' as const, terms: 'Just us.', madeAt })

// ---------------------------------------------------------------------------

describe('misgendering without the judge picking a trust drop', () => {
  it('still costs trust and at least -8 affection for every character', async () => {
    for (const id of Object.keys(afterhoursCharacters())) {
      const rels = { [id]: rel(id, { affection: 40, trust: 40, dates: 2 }) }
      const { llm } = fakeLlm({ judges: [judge({ delta: -2, trustDelta: 0, hits: [{ type: 'turnOff', id: 'misgendering' }], mood: 'flat' })] })
      let s = await start(afterhoursWorld({ id, rels, rng: () => 0.9 }), 'arcade', llm)
      const before = s.rel
      s = await say(s, 'Wrong pronouns, on purpose.', llm)
      const applied = s.record.turns.filter((t) => t.role === 'player').at(-1)!.applied![id]
      expect(applied.trust).toBeLessThan(0)
      // -8 before difficulty: -10 easy, -8 normal, -6 hard.
      expect(applied.affection).toBeLessThanOrEqual(-6)
      expect(s.rel.trust).toBeLessThan(before.trust)
      expect(s.rel.affection).toBeLessThan(before.affection)
    }
  })
})

describe('rumors relayed wrong', () => {
  it('cost trust even when the judge scores the message as neutral', async () => {
    const game = { ...newGameState(T0 - 1_000_000), rumors: [{ rumorId: 'kai-getting-fired', heardFrom: 'dex', at: T0 - 10_000, relayedTo: [] }] }
    const rels = { kai: rel('kai', { affection: 30, trust: 30, dates: 2 }) }
    const { llm } = fakeLlm({ judges: [judge({ delta: 0, trustDelta: 0 }), judge({ delta: 0, trustDelta: 0 })] })
    let s = await start(afterhoursWorld({ id: 'kai', rels, game }), 'boardwalk', llm)
    s = await say(s, "Dex says you've been in the office with the owner every night and you're getting fired.", llm)
    expect(s.relayed).toEqual(['kai-getting-fired'])
    expect(s.rel.trust).toBeLessThan(30)
    const turn = s.record.turns.filter((t) => t.role === 'player').at(-1)!
    expect(turn.relayed).toEqual({ kai: ['kai-getting-fired'] })
    // Only once: saying it again isn't a second relay.
    const trust = s.rel.trust
    s = await say(s, 'So Dex says you are in the office with the owner every night, getting fired.', llm)
    expect(s.rel.trust).toBe(trust)
  })
})

describe('a breach counts once, and honesty reads as honesty', () => {
  const kaiSince = (madeAt: number) => rel('kai', { affection: 30, trust: 20, dates: 2, lastDateAt: madeAt + 60_000 })

  it('after a gossip betrayal, owning up and talking about it adds nothing; a denial is one lie per date', async () => {
    const madeAt = T0 - 500_000
    const betrayal: BetrayalEvent = {
      at: madeAt + 70_000,
      kind: 'agreement',
      about: 'kai',
      how: 'gossip',
      agreement: 'exclusive',
      note: 'Heard about Kai through the grapevine after you agreed to be exclusive.',
      affectionDelta: -15,
      trustDelta: -22,
    }
    const nova = rel('nova', { affection: 50, trust: 38, dates: 5, agreement: exclusive(madeAt), knownOthers: ['kai'], betrayals: [betrayal] })
    const { llm, calls } = fakeLlm({
      judges: [
        judge({ delta: -3, trustDelta: -8, breach: true, mood: 'hurt' }),
        judge({ delta: -2, trustDelta: -8, breach: true, mood: 'hurt' }),
        judge({ delta: -10, trustDelta: -9, breach: true, mood: 'betrayed' }),
        judge({ delta: -10, trustDelta: -9, breach: true, mood: 'betrayed' }),
      ],
    })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova, kai: kaiSince(madeAt) }, rng: () => 0.9 }), 'arcade', llm)
    s = await say(s, "You heard right. I went out with Kai. I'm sorry.", llm)
    s = await say(s, "It was one date with Kai, and it didn't mean anything.", llm)
    expect(s.rel.betrayals).toHaveLength(1)
    // The judge's breach wasn't counted, so the story isn't told it was.
    expect(lastStory(calls)).not.toContain('It broke something')
    s = await say(s, "Honestly? I haven't seen Kai in months, I swear.", llm)
    expect(s.rel.betrayals).toHaveLength(2)
    expect(s.rel.betrayals[1]).toMatchObject({ kind: 'lie' })
    s = await say(s, "I haven't seen Kai, I swear.", llm)
    expect(s.rel.betrayals).toHaveLength(2)
  })

  it('under exclusive, someone dated only before the agreement is neither "seen" for the judge nor a breach', async () => {
    const madeAt = T0 - 100_000
    const nova = rel('nova', { affection: 55, trust: 50, dates: 5, agreement: exclusive(madeAt), lastDateAt: T0 - 50_000 })
    const kai = rel('kai', { affection: 30, trust: 20, dates: 1, lastDateAt: T0 - 900_000 })
    const { llm, calls } = fakeLlm({ judges: [judge({ delta: 0, trustDelta: 2, breach: true })] })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova, kai } }), 'arcade', llm)
    s = await say(s, 'Before we got serious I went out with Kai once.', llm)
    expect(lastJudge(calls)).toContain('People the player is seeing: nobody.')
    expect(s.rel.betrayals).toEqual([])
    expect(s.rel.knownOthers).toEqual(['kai'])
    // And the judge isn't told she knows about Kai as someone the player is seeing now.
    s = await say(s, 'Anyway. Tell me about the jukebox.', llm)
    expect(lastJudge(calls)).toContain('Of those, Nova Castellanos knows about: nobody.')
    expect(lastJudge(calls)).toContain("current opinion: thinks we agreed to be exclusive\n")
  })

  it('an honest confession with no name is the softer betrayal, told to the story as an admission', async () => {
    const nova = rel('nova', { affection: 55, trust: 50, dates: 5, agreement: exclusive(T0 - 100_000) })
    const { llm, calls } = fakeLlm({ judges: [judge({ delta: -8, trustDelta: 3, breach: true, mood: 'shaken' })] })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova }, profile: { name: 'Robin' } }), 'arcade', llm)
    s = await say(s, 'I have to tell you something. I slept with someone at the after-party. I am so sorry.', llm)
    const e = s.rel.betrayals.at(-1)!
    expect(e).toMatchObject({ kind: 'agreement', how: 'player', agreement: 'exclusive', note: 'Heard it from you: you broke the exclusive agreement.' })
    expect(e.memory).toMatch(/^Robin told me to my face that it happened\./)
    expect(lastStory(calls)).toContain('It broke something the two of you agreed on. It admitted breaking the exclusive agreement: honest, and it still hurts.')
    expect(lastStory(calls)).toContain('Mood: hurt.')
  })

  it("a betrayal turn's LANDED section says what broke, whatever mood the judge picked", async () => {
    const madeAt = T0 - 500_000
    const nova = rel('nova', { affection: 55, trust: 50, dates: 5, agreement: exclusive(madeAt) })
    const { llm, calls } = fakeLlm({ judges: [judge({ delta: 1, trustDelta: 1, mood: 'warm', hint: 'She grins at the story.' })] })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova, kai: kaiSince(madeAt) } }), 'arcade', llm)
    s = await say(s, 'I had a drink with Kai last night. It was fun.', llm)
    const story = lastStory(calls)
    expect(story).toContain('Mood: hurt.')
    expect(story).not.toContain('Mood: warm.')
    expect(story).toContain('It told Nova Castellanos about Kai Okoro, which breaks the exclusive agreement.')
    const turn = s.record.turns.filter((t) => t.role === 'player').at(-1)!
    expect(turn.betrayal?.nova).toMatchObject({ kind: 'agreement', about: 'kai', how: 'player' })
  })
})

describe('disclosure needs a dating context', () => {
  it('a passing mention of a name tells nothing', async () => {
    const madeAt = T0 - 500_000
    const nova = rel('nova', { affection: 55, trust: 50, dates: 5, agreement: exclusive(madeAt) })
    const kai = rel('kai', { affection: 30, trust: 20, dates: 2, lastDateAt: madeAt + 60_000 })
    const { llm } = fakeLlm({ judges: [judge({ delta: 1 })] })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova, kai } }), 'arcade', llm)
    s = await say(s, 'Kai poured me the worst drink of my life at The Low Tide on Monday.', llm)
    expect(s.rel.knownOthers).toEqual([])
    expect(s.rel.betrayals).toEqual([])
    expect(s.rel.jealous).toBe(false)
  })

  it('reads dating words in the sentence that names them', () => {
    expect(talksAboutDating('I had a drink with Kai last night.', 'Kai Okoro')).toBe(true)
    expect(talksAboutDating("I'm poly, and I've been seeing Imani too.", 'Imani Clarke')).toBe(true)
    expect(talksAboutDating('I was out with Dex on Tuesday.', 'Dex Adeyemi')).toBe(true)
    expect(talksAboutDating('I was with Kai last night.', 'Kai Okoro')).toBe(true)
    expect(talksAboutDating('Kai poured me the worst drink of my life.', 'Kai Okoro')).toBe(false)
    expect(talksAboutDating('I know Imani got caught with a bartender at a staff party.', 'Imani Clarke')).toBe(false)
    expect(talksAboutDating('We went out. Kai was working the bar.', 'Kai Okoro')).toBe(false)
  })
})

describe('who still counts as seeing', () => {
  it('someone the player stopped seeing drops out of what the judge and the story are told', async () => {
    const nova = rel('nova', { affection: 55, trust: 60, dates: 7, knownOthers: ['kai'], lastDateIndex: 9 })
    const kai = rel('kai', { affection: 30, trust: 20, dates: 1, lastDateAt: T0 - 900_000, lastDateIndex: 2 })
    const game = { ...newGameState(T0 - 1_000_000), dateCount: 9 }
    const { llm, calls } = fakeLlm()
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova, kai }, game }), 'arcade', llm)
    expect(lastStory(calls)).toContain('that Nova Castellanos knows about: nobody, as far as Nova Castellanos knows\n')
    s = await say(s, "It's just you now.", llm)
    expect(lastJudge(calls)).toContain('People the player is seeing: nobody. Of those, Nova Castellanos knows about: nobody.')
    s = await end(s, llm)
    expect(s.rel.lastDateIndex).toBe(10)
    expect(s.worldAfter!.game.dateCount).toBe(10)
  })
})

describe('what the player said about how they date', () => {
  it('a poly player asking for exclusive is known for asking, not for the profile', async () => {
    const nova = rel('nova', { affection: 45, trust: 40, dates: 3 })
    const accepted: AgreementResult = { agreement: 'exclusive', accepted: true, terms: 'Just us.', trustDelta: 2 }
    const { llm, calls } = fakeLlm({ agreements: [accepted] })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova }, profile: { relationshipStyle: 'polyamorous' }, rng: () => 0.9 }), 'arcade', llm)
    s = openDtr(s, 'exclusive', 'player')
    s = await say(s, 'I only want you.', llm)
    s = await closeDtr(s, llm, recorder().hooks)
    s = await say(s, 'So. Exclusive.', llm)
    const story = lastStory(calls)
    expect(story).toContain('What Nova Castellanos knows about how the player dates: Asked for exclusive (only each other).')
    expect(story).not.toContain('Polyamorous: has or wants more than one relationship')
  })

  it('the style a player claims is what the character knows, even when it hides the profile', async () => {
    const kai = rel('kai', { affection: 30, trust: 30, dates: 2 })
    const { llm, calls } = fakeLlm()
    let s = await start(afterhoursWorld({ id: 'kai', rels: { kai }, profile: { relationshipStyle: 'polyamorous' } }), 'boardwalk', llm)
    s = await say(s, "I'm monogamous, one person at a time, always.", llm)
    expect(s.rel.toldStyle).toEqual({ style: 'monogamous' })
    expect(lastStory(calls)).toContain('knows about how the player dates: Monogamous: one partner at a time.')
  })
})

describe('the character brings up defining the relationship', () => {
  it('says so on the opening beat, in the talk, and to the Agreement prompt', async () => {
    const nova = rel('nova', { affection: 45, trust: 55, dates: 3 })
    const { llm, calls } = fakeLlm({ agreements: [{ agreement: 'open', accepted: true, terms: 'Open.', trustDelta: 1 }] })
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova }, rng: () => 0.2 }), 'arcade', llm)
    expect(s.dtrOffer).toBe('open')
    expect(lastStory(calls)).toContain('Nova Castellanos wants to talk about what you two are (thinking open (free to see other people)); bring it up early.')
    s = openDtr(s, 'open', 'character')
    s = await say(s, "Okay, let's talk about it.", llm)
    expect(lastStory(calls)).toContain('Nova Castellanos brought up what you two are and wants open (free to see other people). The player agreed to talk')
    expect(lastStory(calls)).not.toContain('The player wants to define what you two are')
    s = await closeDtr(s, llm, recorder().hooks)
    expect(calls.agreement[0].system).toContain('The player asked for: open (free to see other people), which Nova Castellanos proposed.')
    // The player didn't ask for it, so nothing says they did.
    expect(s.rel.toldStyle?.asked).toBeUndefined()
  })
})

describe('an Agreement reply that is unusable', () => {
  it('keeps the talk open to try again; the end of the date closes it without a result', async () => {
    const nova = rel('nova', { affection: 45, trust: 40, dates: 3 })
    const { llm, calls } = fakeLlm()
    const unusable = { ...llm, agreement: async () => ({ value: { agreement: 'none' as const, accepted: false, terms: '', trustDelta: 0 }, ok: false }) }
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova }, rng: () => 0.9 }), 'arcade', llm)
    s = openDtr(s, 'casual', 'player')
    s = await say(s, 'Can we keep this light?', llm)
    const kept = await closeDtr(s, unusable, recorder().hooks)
    expect(kept.record.dtr?.closedAt).toBeUndefined()
    s = await end(kept, unusable)
    expect(s.record.dtr?.closedAt).toEqual(expect.any(Number))
    expect(s.record.dtr?.result).toBeUndefined()
    expect(calls.agreement).toHaveLength(0)
  })
})

describe('rekindles reach the story', () => {
  it('the next date with either of them brings it up once, and {partners} keeps it', async () => {
    const nova = rel('nova', {
      affection: 85,
      trust: 65,
      dates: 6,
      rekindledWith: 'kai',
      rekindle: { with: 'kai', invite: false, at: T0 - 5000 },
    })
    const { llm, calls } = fakeLlm()
    let s = await start(afterhoursWorld({ id: 'nova', rels: { nova } }), 'arcade', llm)
    const opening = lastStory(calls)
    expect(opening).toContain('Early on, Nova Castellanos tells the player that they and Kai Okoro got back together while the player was busy; the door is closing, kindly.')
    expect(opening).toContain('Kai Okoro (ex, back together lately: they got close again while the player was busy, and Nova Castellanos is gently closing the door on the player)')
    s = await end(await say(s, 'Hi.', llm), llm)
    expect(s.rel.rekindle?.told).toBe(true)
    const { llm: l2, calls: c2 } = fakeLlm()
    await start(afterhoursWorld({ id: 'nova', rels: { nova: s.rel }, start: T0 + 3_600_000 }), 'arcade', l2)
    expect(lastStory(c2)).not.toContain('Early on, Nova Castellanos tells the player')
    expect(lastStory(c2)).toContain('back together lately')
  })
})

describe('rumors from a secret reached after the last reply', () => {
  it('wait for the next date, where the opening beat lets them slip', async () => {
    // Friend route (Sasha is into women; the player is a man): secrets unlock on trust, and the
    // completed date's +1 takes her from 59 to 60, past her first secret, after the last reply.
    const sasha = rel('sasha', { affection: 30, trust: 59, dates: 3 })
    const man = { gender: 'man' as const, pronouns: 'he/him' }
    const { llm } = fakeLlm({ judges: [judge({ delta: 0, trustDelta: 0 })] })
    let s = await start(afterhoursWorld({ id: 'sasha', rels: { sasha }, profile: man, rng: () => 0.9 }), 'arcade', llm, recorder().hooks, 1)
    s = await say(s, 'Tell me about the ER.', llm)
    expect(s.status).toBe('ended')
    expect(s.rel.secretsUnlocked).toContain(0)
    expect(s.rel.rumorRollsOwed).toBe(1)
    expect(s.record.recap!.perCharacter.sasha.rumors).toEqual([])
    const { llm: l2, calls } = fakeLlm()
    const n = await start(
      afterhoursWorld({ id: 'sasha', rels: { sasha: s.rel }, profile: man, rng: () => 0.1, start: T0 + 3_600_000, game: s.worldAfter!.game }),
      'arcade',
      l2,
    )
    expect(n.heard?.map((h) => h.rumorId)).toEqual(['priya-radio-crush'])
    expect(n.rel.rumorRollsOwed).toBeUndefined()
    expect(lastStory(calls)).toContain('In this reply, Sasha Volkova lets something slip about other people:')
  })
})

describe('the end of a date', () => {
  it('saves the date and the world together through persistAll when the store offers it', async () => {
    const rels = {
      nova: rel('nova', { affection: 30, dates: 1, lastDateAt: 1 }),
      imani: rel('imani', { affection: 50, trust: 50, dates: 2, lastDateAt: 5, agreement: exclusive(10) }),
    }
    const { llm } = fakeLlm()
    const saved: { persist: number; world: number; all: { rel: Relationship; others: string[] }[] } = { persist: 0, world: 0, all: [] }
    const hooks: DateHooks = {
      onUpdate: () => undefined,
      persist: async () => {
        saved.persist++
      },
      persistWorld: async () => {
        saved.world++
      },
      persistAll: async (r, record, others) => {
        expect(record.outcome).toBe('ended')
        saved.all.push({ rel: r, others: others.map((o) => o.characterId) })
      },
    }
    let s = await start(afterhoursWorld({ id: 'nova', rels, rng: () => 0.1 }), 'arcade', llm, hooks)
    const before = saved.persist
    s = (await finishDate(s, 'ended', llm, hooks)).session
    expect(saved.all).toHaveLength(1)
    expect(saved.all[0].others).toEqual(['imani'])
    expect(saved.world).toBe(0)
    expect(saved.persist).toBe(before)
    expect(s.worldAfter!.betrayals.map((b) => b.characterId)).toEqual(['imani'])
  })

  it('a forgiving character forgives once trust is back to 60; a medium one keeps the grudge', async () => {
    const e: BetrayalEvent = { at: T0 - 50_000, kind: 'lie', note: 'Caught you in a lie.', affectionDelta: -12, trustDelta: -20 }
    for (const [id, forgiven] of [
      ['nova', true],
      ['kai', false],
    ] as const) {
      const r = rel(id, { affection: 60, trust: 59, dates: 5, betrayals: [e], lastDateAt: T0 - 40_000 })
      const { llm } = fakeLlm({ judges: [judge({ delta: 1, trustDelta: 3 })] })
      let s = await start(afterhoursWorld({ id, rels: { [id]: r } }), 'arcade', llm, recorder().hooks, 1)
      s = await say(s, 'I brought your favorite.', llm)
      expect(s.status).toBe('ended')
      if (forgiven) {
        expect(s.rel.trust).toBeGreaterThanOrEqual(60)
        expect(s.rel.forgivenAt).toEqual(expect.any(Number))
      } else {
        expect(s.rel.forgivenAt).toBeUndefined()
      }
    }
  })
})

describe('the friend route', () => {
  it("offers no Define the relationship, and a friend who hears you're seeing someone doesn't mind", async () => {
    const sasha = rel('sasha', { affection: 50, trust: 40, dates: 3, knownOthers: ['priya'], agreement: exclusive(1) })
    const priya = rel('priya', { affection: 40, dates: 2, lastDateAt: T0 - 10_000 })
    const { llm } = fakeLlm()
    const s = await start(afterhoursWorld({ id: 'sasha', rels: { sasha, priya }, profile: { gender: 'man', pronouns: 'he/him' } }), 'arcade', llm)
    expect(openDtr(s, 'exclusive', 'player')).toBe(s)
    const after = await say(s, 'Nice night.', llm)
    expect(after.rel.jealous).toBe(false)
    expect(card('sasha').jealousy).toBe('high')
  })
})
