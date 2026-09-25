// Group dates (Phase 6): the prompt, the speaker tags, per-character math, one of them walking out,
// and the betrayal a group date reveals under exclusive.

import { describe, expect, it } from 'vitest'
import { heatDescription } from '../data/heat'
import { neutralJudge } from '../llm/coerce'
import { storySection, TEMPLATES } from '../prompts/build'
import type { JudgeResult, Relationship } from '../types'
import { storyRequest, type DateLlm, type DateSession } from './dateFlow'
import {
  applyGroupOpening,
  applyGroupReveal,
  createGroupDate,
  finishGroupDate,
  groupArtSlot,
  groupFeelings,
  groupJudgeNote,
  groupStoryRequest,
  groupSuggestionsRequest,
  linkedByKnows,
  memberView,
  openGroupDate,
  pairHistory,
  parseGroupReply,
  presentIds,
  sendGroupMessage,
} from './groupDate'
import { alreadyCounted, checkBetrayal } from './agreements'
import { approval, pairKey } from './metamour'
import { newGameState } from './relationship'
import { afterhoursRelations, afterhoursWorld, recorder, rel, T0 } from './testKit'

/** A model that judges by who's being scored (the judge prompt names them first). */
function groupLlm(opts: { judges?: Record<string, Partial<JudgeResult>[]>; stories?: string[] } = {}) {
  const judges: Record<string, Partial<JudgeResult>[]> = Object.fromEntries(
    Object.entries(opts.judges ?? {}).map(([k, v]) => [k, [...v]]),
  )
  const stories = [...(opts.stories ?? [])]
  const calls = { story: [] as string[], judge: [] as { who: string; system: string; id?: string }[], memory: [] as string[] }
  const llm: DateLlm = {
    async story(a) {
      calls.story.push(a.system)
      const text = stories.shift() ?? 'Nova: *grins* "Hey."\n\nKai: *nods* "Hi."'
      a.onDelta(text)
      return { text, refused: false }
    },
    async judge(a) {
      const who = /CHARACTER\n(.+?), stage/.exec(a.system)?.[1] ?? ''
      calls.judge.push({ who, system: a.system, ...(a.characterId ? { id: a.characterId } : {}) })
      const next = judges[who]?.shift() ?? {}
      return { value: { ...neutralJudge(), ...next }, ok: true }
    },
    async suggestions(a) {
      return Object.fromEntries(a.keys.map((k) => [k, `A ${k} line`]))
    },
    async memory(a) {
      calls.memory.push(a.characterId ?? '')
      return `Memory for ${a.characterId ?? 'someone'}.`
    },
  }
  return { llm, calls }
}

function worlds(rels: Record<string, Relationship> = {}, ids = ['nova', 'kai'], extra: Parameters<typeof afterhoursWorld>[0] = { id: '' }) {
  const game = extra.game ?? newGameState(T0 - 1_000_000)
  let t = T0
  const now = () => (t += 1000)
  return ids.map((id) => ({ ...afterhoursWorld({ ...extra, id, rels, game }), now }))
}

function group(rels: Record<string, Relationship> = {}, opts: { venueId?: string; giftId?: string; giftTo?: string; maxTurns?: number; ids?: string[]; settings?: object } = {}) {
  return createGroupDate(worlds(rels, opts.ids, { id: '', ...(opts.settings ? { settings: opts.settings } : {}) }), {
    venueId: opts.venueId ?? 'record-store',
    ...(opts.giftId ? { giftId: opts.giftId } : {}),
    ...(opts.giftTo ? { giftTo: opts.giftTo } : {}),
    maxTurns: opts.maxTurns ?? 10,
  })
}

const lines = (text: string) => text.split('\n')

describe('the group story prompt', () => {
  it('has a CHARACTER, HIDDEN PREFERENCES and RELATIONSHIP block for each, and the locked sections verbatim', () => {
    const s = applyGroupReveal(applyGroupOpening(group({ nova: rel('nova'), kai: rel('kai') })))
    const system = groupStoryRequest(s, { turn: 0 }).system
    expect(system.startsWith('You are the story engine of crushLAB, an adults-only dating sim. You play Nova Castellanos and Kai Okoro')).toBe(true)
    // Each character's blocks are exactly what their single date's prompt says.
    for (const id of ['nova', 'kai']) {
      const single = storyRequest(memberView(s, id), { turn: 0 }).system
      for (const header of ['CHARACTER', 'HIDDEN PREFERENCES', 'RELATIONSHIP']) {
        const block = single.split('\n\n').find((b) => b.startsWith(header))!
        expect(block).toBeTruthy()
        expect(system).toContain(block)
      }
      // WORLD RULES, PLAYER and CONTENT: every line of the single prompt's section, word for word.
      for (const header of ['WORLD RULES', 'PLAYER', 'CONTENT']) {
        const block = single.split('\n\n').find((b) => b.startsWith(header))!
        for (const line of lines(block)) expect(system).toContain(line)
      }
    }
    // The locked text itself, straight from the template.
    for (const header of ['WORLD RULES', 'CONTENT']) {
      for (const line of lines(storySection(header))) {
        for (const piece of line.split(/\{[^{}\n]+\}/).map((p) => p.trim()).filter((p) => p.length > 12)) {
          expect(system).toContain(piece)
        }
      }
    }
    expect(system.match(/^CHARACTER$/gm)).toHaveLength(2)
    expect(system.match(/^HIDDEN PREFERENCES/gm)).toHaveLength(2)
    expect(system.match(/^RELATIONSHIP$/gm)).toHaveLength(2)
    expect(system.match(/^WORLD RULES$/gm)).toHaveLength(1)
    expect(system).toContain('- Nova Castellanos is an original character.')
    expect(system).toContain('- Kai Okoro is an original character.')
    // BETWEEN THEM: their history (the manifest's note) and how each feels about it.
    expect(system).toContain('BETWEEN THEM\nNova Castellanos and Kai Okoro are exes: Dated for a year;')
    expect(system).toMatch(/Nova Castellanos .*Kai Okoro/)
    expect(system).toContain('Open the date: Nova Castellanos and Kai Okoro arrive and greet the player, and each other.')
    expect(system).toContain('Start every paragraph with the name of the character it follows and a colon, like "Nova: ..."')
    // No judge yet: no LANDED section.
    expect(system).not.toContain("HOW THE PLAYER'S LAST MESSAGE LANDED")
    expect(TEMPLATES.groupStory).toContain('{worldRules}')
  })

  it('has a LANDED line for each once they judged, and plays at the lowest heat', async () => {
    const { llm, calls } = groupLlm({ judges: { 'Nova Castellanos': [{ delta: 3, mood: 'warm', hits: [{ type: 'like', id: 'vinyl' }] }] } })
    let s = group({ nova: rel('nova'), priya: rel('priya', { trust: 20 }) }, { ids: ['nova', 'priya'], settings: { heat: 4 } })
    s = await openGroupDate(s, llm, recorder().hooks)
    s = await sendGroupMessage(s, 'Tell me about the vinyl.', llm, recorder().hooks)
    const system = calls.story[calls.story.length - 1]
    expect(system).toContain("HOW THE PLAYER'S LAST MESSAGE LANDED (private; never mention it)\nNova Castellanos: Mood: warm. It touched a like:")
    expect(system).toContain('Priya Raman: Mood: neutral.')
    // Priya's demisexual pace (heat 2 until trust 60) holds the whole scene.
    expect(system).toContain(`Intensity: ${heatDescription(2)}`)
    expect(system).toContain('Body: Not relevant at this heat.')
    expect(s.status).toBe('awaiting-player')
  })
})

describe('speaker tags', () => {
  const speakers = [
    { id: 'nova', name: 'Nova Castellanos' },
    { id: 'kai', name: 'Kai Okoro' },
  ]
  it('splits the reply into per-character turns', () => {
    const out = parseGroupReply('Nova: *grins* "Hey, trouble."\n\nKai: *rolls their eyes* "Here we go."\nStill Kai.\n\nNova: "Relax."', speakers, 'nova')
    expect(out).toEqual([
      { speaker: 'nova', text: '*grins* "Hey, trouble."' },
      { speaker: 'kai', text: '*rolls their eyes* "Here we go."\nStill Kai.' },
      { speaker: 'nova', text: '"Relax."' },
    ])
  })
  it('reads bold tags, full names and any case, and gives untagged narration to the fallback', () => {
    const out = parseGroupReply('*The bar is loud.*\n**Kai:** "Drink?"\nNOVA CASTELLANOS: "Two."\n*Kai:* fine\nnova: "Cheers."', speakers, 'nova')
    expect(out.map((l) => l.speaker)).toEqual(['nova', 'kai', 'nova', 'kai', 'nova'])
    expect(out[0].text).toBe('*The bar is loud.*')
    expect(out[1].text).toBe('"Drink?"')
    expect(out[2].text).toBe('"Two."')
    expect(out[3].text).toBe('fine')
  })
  it('keeps an action that starts with the name in the current part', () => {
    const out = parseGroupReply('Kai: "Hi."\n*Nova laughs at that.*', speakers, 'nova')
    expect(out).toEqual([{ speaker: 'kai', text: '"Hi."\n*Nova laughs at that.*' }])
  })
  it('merges parts of one speaker', () => {
    expect(parseGroupReply('Kai: one\nKai: two', speakers, 'nova')).toEqual([{ speaker: 'kai', text: 'one\n\ntwo' }])
  })
})

describe('a group date, turn by turn', () => {
  it('applies each judge to its own character with their own difficulty, and the venue and gift to each', async () => {
    const { llm, calls } = groupLlm({
      judges: { 'Nova Castellanos': [{ delta: 8, trustDelta: 4 }], 'Kai Okoro': [{ delta: 8, trustDelta: 4 }] },
    })
    const hooks = recorder()
    // Record store: Nova's favorite (+3), neutral for Kai. Rare vinyl is for Nova (loved, +5).
    let s = group({ nova: rel('nova'), kai: rel('kai') }, { giftId: 'rare-vinyl', giftTo: 'nova' })
    s = await openGroupDate(s, llm, hooks.hooks)
    expect(s.record.opening).toEqual({ nova: { venue: 3, gift: 5 }, kai: { venue: 0, gift: 0 } })
    expect(s.group!.members.nova.rel.gifts['rare-vinyl']).toBe('loved')
    expect(s.group!.members.kai.rel.gifts['rare-vinyl']).toBeUndefined()
    expect(s.record.turns.filter((t) => t.role === 'character').map((t) => t.speaker)).toEqual(['nova', 'kai'])

    s = await sendGroupMessage(s, 'So how do you two know each other?', llm, hooks.hooks)
    expect(calls.judge.map((j) => j.who).sort()).toEqual(['Kai Okoro', 'Nova Castellanos'])
    expect(calls.judge.map((j) => j.id).sort()).toEqual(['kai', 'nova'])
    expect(calls.judge.find((j) => j.who === 'Nova Castellanos')!.system).toContain('tonight is a group date and Kai Okoro is here too')
    const player = s.record.turns.filter((t) => t.role === 'player')[0]
    // Nova is normal (x1), Kai is hard (x0.75, toward zero).
    expect(player.applied).toEqual({ nova: { affection: 8, trust: 4 }, kai: { affection: 6, trust: 3 } })
    expect(s.group!.members.nova.rel.affection).toBe(3 + 5 + 8)
    expect(s.group!.members.kai.rel.affection).toBe(6)
    expect(s.record.totals.nova.affection).toBe(16)
    expect(s.record.totals.kai.affection).toBe(6)
    // Both were saved after the step.
    const last = hooks.persisted.slice(-2).map((p) => p.rel.characterId).sort()
    expect(last).toEqual(['kai', 'nova'])
  })

  it('goes on with the other when one walks out, and the story writes the exit', async () => {
    const { llm, calls } = groupLlm({
      judges: { 'Kai Okoro': [{ delta: -20 }, { delta: -20 }], 'Nova Castellanos': [{ delta: 2 }, { delta: 2 }, { delta: 2 }] },
      stories: [
        'Nova: "Hey."\n\nKai: "Hi."',
        'Nova: "Huh."\n\nKai: "Wow."',
        'Kai: *stands* "I\'m done."\n\nNova: "Okay then."',
        'Nova: "Just us now."',
      ],
    })
    let s = group({ nova: rel('nova'), kai: rel('kai') }, { venueId: 'arcade' })
    s = await openGroupDate(s, llm, recorder().hooks)
    s = await sendGroupMessage(s, 'Kai, your toasties are overrated.', llm, recorder().hooks)
    expect(s.record.totals.kai.affection).toBe(-15)
    expect(s.group!.gone).toEqual([])
    s = await sendGroupMessage(s, 'Seriously overrated.', llm, recorder().hooks)
    // -30 for Kai: the reply wrote the exit and Kai is gone; the date goes on.
    const exitPrompt = calls.story[calls.story.length - 1]
    expect(exitPrompt).toContain('The date has gone badly for Kai Okoro: write Kai Okoro leaving, and the date goes on with Nova Castellanos.')
    expect(s.group!.gone).toEqual(['kai'])
    expect(s.status).toBe('awaiting-player')
    expect(s.leaving).toBe(false)
    expect(presentIds(s)).toEqual(['nova'])

    const judged = calls.judge.length
    s = await sendGroupMessage(s, 'Just us, then.', llm, recorder().hooks)
    expect(calls.judge.length).toBe(judged + 1)
    expect(calls.judge[calls.judge.length - 1].who).toBe('Nova Castellanos')
    const after = calls.story[calls.story.length - 1]
    expect(after).toContain('Kai Okoro already left; Nova Castellanos stayed.')
    expect(after).not.toMatch(/^Kai Okoro, \d+/m)

    const done = await finishGroupDate(s, 'ended', llm, recorder().hooks)
    expect(done.session.record.outcome).toBe('ended')
    expect(done.recap.perCharacter.kai.left).toBe(true)
    expect(done.recap.perCharacter.nova.left).toBe(false)
    expect(calls.memory.sort()).toEqual(['kai', 'nova'])
  })

  it('ends as left when everyone walks out', async () => {
    const { llm } = groupLlm({
      judges: { 'Kai Okoro': [{ delta: -20 }, { delta: -20 }], 'Nova Castellanos': [{ delta: -20 }, { delta: -20 }] },
    })
    let s = group({ nova: rel('nova'), kai: rel('kai') }, { venueId: 'arcade' })
    s = await openGroupDate(s, llm, recorder().hooks)
    s = await sendGroupMessage(s, '[tank]', llm, recorder().hooks)
    s = await sendGroupMessage(s, '[tank]', llm, recorder().hooks)
    expect(s.status).toBe('ended')
    expect(s.record.outcome).toBe('left')
  })

  it('finishes with a memory, a date and a recap for each, one date on the count, and approval by how it went', async () => {
    const { llm } = groupLlm({ judges: { 'Nova Castellanos': [{ delta: 6 }], 'Kai Okoro': [{ delta: 8 }] } })
    const rels = { nova: rel('nova', { dates: 1, affection: 30 }), kai: rel('kai', { dates: 1, affection: 30 }) }
    let s = group(rels, { venueId: 'karaoke-box', maxTurns: 1 })
    s = await openGroupDate(s, llm, recorder().hooks)
    const hooks = recorder()
    const all: { rel: Relationship; others: Relationship[] }[] = []
    hooks.hooks.persistAll = async (r, _record, others) => {
      all.push({ rel: structuredClone(r), others: structuredClone(others) })
    }
    s = await sendGroupMessage(s, 'This is fun.', llm, hooks.hooks)
    expect(s.status).toBe('ended')
    expect(s.record.outcome).toBe('completed')
    const recap = s.record.recap!
    expect(Object.keys(recap.perCharacter).sort()).toEqual(['kai', 'nova'])
    expect(recap.perCharacter.nova.memory).toBe('Memory for nova.')
    expect(recap.perCharacter.kai.memory).toBe('Memory for kai.')
    expect(s.group!.members.nova.rel.dates).toBe(2)
    expect(s.group!.members.kai.rel.dates).toBe(2)
    const world = s.worldAfter!
    expect(world.game.dateCount).toBe(1)
    expect(world.rels.nova.lastDateIndex).toBe(1)
    expect(world.rels.kai.lastDateIndex).toBe(1)
    // Both warmed up (karaoke is a favorite of both): approval of each other rises from the exes' 35.
    expect(approval(world.game, 'nova', 'kai', afterhoursRelations())).toBe(45)
    expect(world.game.metamours[pairKey('kai', 'nova')]).toBe(45)
    expect(world.news.some((n) => n.kind === 'metamour' && n.text === 'Nova and Kai got on well tonight.')).toBe(true)
    // Each knows the player is seeing the other now.
    expect(world.rels.nova.knownOthers).toContain('kai')
    expect(world.rels.kai.knownOthers).toContain('nova')
    // One save with everything: Nova's relationship, Kai's with the rest of the world.
    expect(all).toHaveLength(1)
    expect(all[0].rel.characterId).toBe('nova')
    expect(all[0].others.map((r) => r.characterId)).toContain('kai')
  })
})

describe('what a group date reveals', () => {
  it('breaks an exclusive agreement when the other was dated since, with how "group"', async () => {
    const rels = {
      nova: rel('nova', { dates: 3, affection: 50, trust: 60, agreement: { type: 'exclusive', terms: 'Only us.', madeAt: T0 - 100_000 } }),
      kai: rel('kai', { dates: 1, affection: 30, lastDateAt: T0 - 50_000 }),
    }
    const { llm, calls } = groupLlm()
    let s: DateSession = group(rels, { venueId: 'boardwalk' })
    s = await openGroupDate(s, llm, recorder().hooks)
    const nova = s.group!.members.nova.rel
    const e = nova.betrayals[nova.betrayals.length - 1]
    expect(e.how).toBe('group')
    expect(e.about).toBe('kai')
    expect(e.agreement).toBe('exclusive')
    expect(e.note).toBe('Met Kai on a group date after you agreed to be exclusive.')
    expect(e.trustDelta).toBeLessThanOrEqual(-15)
    expect(e.affectionDelta).toBeLessThanOrEqual(-10)
    expect(nova.knownOthers).toContain('kai')
    expect(nova.trust).toBe(60 + e.trustDelta)
    // It counts on the date's ledger (the boardwalk is neutral for Nova).
    expect(s.record.totals.nova.affection).toBe(e.affectionDelta)
    expect(s.group!.reveals?.nova).toEqual(e)
    // Kai had no agreement: learns about Nova, nothing breaks.
    expect(s.group!.members.kai.rel.betrayals).toEqual([])
    expect(s.group!.members.kai.rel.knownOthers).toContain('nova')
    const opening = calls.story[0]
    expect(opening).toContain('which breaks the exclusive agreement Nova Castellanos made with the player')
    expect(opening).toContain('Nova Castellanos realizes tonight that the player has been seeing Kai Okoro')
  })

  it("doesn't break exclusive when the other wasn't dated since the agreement", async () => {
    const rels = {
      nova: rel('nova', { dates: 3, affection: 50, agreement: { type: 'exclusive', terms: '', madeAt: T0 - 100_000 } }),
      kai: rel('kai', { dates: 1, affection: 30, lastDateAt: T0 - 200_000 }),
    }
    const s = applyGroupReveal(applyGroupOpening(group(rels)))
    expect(s.group!.members.nova.rel.betrayals).toEqual([])
    expect(s.group!.members.nova.rel.knownOthers).toContain('kai')
  })

  it('under poly, meeting them is disclosure, not betrayal', () => {
    const rels = {
      nova: rel('nova', { dates: 3, affection: 50, agreement: { type: 'poly', terms: '', madeAt: T0 - 100_000 }, heardSecondhand: ['kai'], knownOthers: ['kai'] }),
      kai: rel('kai', { dates: 1, affection: 30, lastDateAt: T0 - 50_000 }),
    }
    const s = applyGroupReveal(applyGroupOpening(group(rels)))
    expect(s.group!.members.nova.rel.betrayals).toEqual([])
    expect(s.group!.members.nova.rel.heardSecondhand).toEqual([])
  })
})

describe('between them', () => {
  it('lists what they are to each other, romantic first, with the notes', () => {
    const h = pairHistory('kai', 'nova', afterhoursRelations())
    expect(h.relations[0].kind).toBe('ex')
    expect(h.relations[0].note).toContain('Dated for a year')
    expect(h.known).toBe(true)
    expect(pairHistory('kai', 'priya', afterhoursRelations(), { kai: 'afterhours', priya: 'afterhours' })).toEqual({ relations: [], known: true })
    expect(pairHistory('kai', 'x', [])).toEqual({ relations: [], known: false })
  })
  it('has one group art slot per pair', () => {
    expect(groupArtSlot(['nova', 'kai'])).toEqual({ kind: 'group', characterIds: ['kai', 'nova'], slot: 'group-date' })
  })
})

describe('group date review fixes', () => {
  const speakers = [
    { id: 'nova', name: 'Nova Castellanos' },
    { id: 'kai', name: 'Kai Okoro' },
  ]

  it('reads list markers, parentheticals and heavy emphasis as tags', () => {
    const cases: [string, string[]][] = [
      ['- Nova: "Hey."\n- Kai: "Hi."', ['nova', 'kai']],
      ['Nova (laughing): "Hey."\nKai (dry): "Hi."', ['nova', 'kai']],
      ['Nova: "Hey."\n***Kai:*** "Hi."', ['nova', 'kai']],
      ['* Nova: hi\n* Kai: yo', ['nova', 'kai']],
      ['> Nova: hi\n> Kai: yo', ['nova', 'kai']],
      ['**Nova** (grinning): hi\n**Kai:** yo', ['nova', 'kai']],
    ]
    for (const [text, who] of cases) {
      const out = parseGroupReply(text, speakers, 'nova')
      expect(out.map((l) => l.speaker), text).toEqual(who)
      expect(out.every((l) => !/Kai:|Nova:/.test(l.text)), text).toBe(true)
    }
    expect(parseGroupReply('***Kai:*** "Hi."', speakers, 'nova')).toEqual([{ speaker: 'kai', text: '"Hi."' }])
    // Narration without a colon is still narration.
    expect(parseGroupReply('Kai: "Hi."\n*Nova laughs at that.*', speakers, 'nova')).toHaveLength(1)
  })

  it('knows a nicknamed character by given name, full name, nickname and surname, and without accents', () => {
    const nick = [
      { id: 'rox', name: 'Roxanne "Rox" Delacroix' },
      { id: 'bash', name: 'Sebastián "Bash" Quintero' },
    ]
    for (const text of ['Roxanne: hi\nSebastian: yo', 'Roxanne Delacroix: hi\nSebastián Quintero: yo', 'Rox Delacroix: hi\nBash Quintero: yo', 'ROX: hi\nsebastián: yo']) {
      expect(parseGroupReply(text, nick, 'rox'), text).toEqual([
        { speaker: 'rox', text: 'hi' },
        { speaker: 'bash', text: 'yo' },
      ])
    }
  })

  it("never says the player is seeing someone they haven't been out with", () => {
    const s = applyGroupReveal(applyGroupOpening(group({ nova: rel('nova'), kai: rel('kai') })))
    const f = groupFeelings(s)
    expect(f.map((x) => x.standing)).toEqual(['new', 'new'])
    expect(s.group!.members.nova.rel.knownOthers).toEqual([])
    expect(s.group!.members.kai.rel.knownOthers).toEqual([])
    const system = groupStoryRequest(s, { turn: 0 }).system
    expect(system).not.toMatch(/finds out tonight/)
    expect(system).not.toMatch(/player is seeing Kai|player is seeing Nova/)
    expect(system).toContain("The player hasn't been out with Kai Okoro before tonight")
  })

  it('tells each judge how that character feels about the other being there', () => {
    const rels = {
      nova: rel('nova', { dates: 3, affection: 50, agreement: { type: 'exclusive', terms: '', madeAt: T0 - 100_000 } }),
      kai: rel('kai', { dates: 1, affection: 30, lastDateAt: T0 - 200_000 }),
    }
    const s = applyGroupReveal(applyGroupOpening(group(rels)))
    const note = groupJudgeNote(s, 'nova')
    expect(note).toContain('Nova Castellanos and Kai Okoro are exes')
    expect(note).toContain('agreed to be exclusive')
    expect(note).toContain('attention the player pays Kai Okoro may sting Nova Castellanos')
  })

  it('counts a manifest knows link as knowing each other', () => {
    const linked = linkedByKnows({ backstage: ['afterhours'] })
    const setOf = { rox: 'backstage', nova: 'afterhours', sol: 'slow-burn' }
    expect(pairHistory('rox', 'nova', [], setOf, linked).known).toBe(true)
    expect(pairHistory('nova', 'rox', [], setOf, linked).known).toBe(true)
    expect(pairHistory('rox', 'sol', [], setOf, linked).known).toBe(false)
  })

  it("isn't counted again as dating the other behind an exclusive partner's back", async () => {
    const rels = {
      nova: rel('nova', { dates: 3, affection: 50, trust: 60, agreement: { type: 'exclusive', terms: '', madeAt: T0 - 100_000 } }),
      kai: rel('kai', { dates: 1, affection: 30, lastDateAt: T0 - 500_000 }),
    }
    const { llm } = groupLlm()
    let s = group(rels, { venueId: 'karaoke-box', maxTurns: 1 })
    s = await openGroupDate(s, llm, recorder().hooks)
    s = await sendGroupMessage(s, 'This is fun.', llm, recorder().hooks)
    expect(s.status).toBe('ended')
    const nova = s.worldAfter!.rels.nova
    const kai = s.worldAfter!.rels.kai
    expect(nova.betrayals).toEqual([])
    expect(nova.metOnGroupDate?.kai).toBeGreaterThan(0)
    expect(alreadyCounted(nova, 'kai', kai)).toBe(true)
    // The next single date: the player mentions Kai. Nothing new to learn.
    expect(checkBetrayal(card0('nova'), nova, 'kai', 'player', kai, T0 + 10_000_000, () => 0.5)).toBeNull()
    expect(checkBetrayal(card0('nova'), nova, 'kai', 'gossip', kai, T0 + 10_000_000, () => 0.5)).toBeNull()
    // A date with Kai alone afterwards counts as it should.
    const later = { ...kai, lastDateAt: T0 + 20_000_000 }
    expect(checkBetrayal(card0('nova'), nova, 'kai', 'player', later, T0 + 30_000_000, () => 0.5)).not.toBeNull()
  })

  it("drops a line for someone who already left, and remembers only what they saw", async () => {
    const { llm, calls } = groupLlm({
      judges: { 'Kai Okoro': [{ delta: -20 }, { delta: -20 }], 'Nova Castellanos': [{ delta: 2 }, { delta: 2 }, { delta: 2 }] },
      stories: [
        'Nova: "Hey."\n\nKai: "Hi."',
        'Nova: "Huh."\n\nKai: "Wow."',
        'Kai: *stands* "I\'m done."\n\nNova: "Okay then."',
        'Nova: "Just us." SECRET-AFTER-KAI-LEFT\n\nKai: *calls from the street* "Still here."',
      ],
    })
    const memoryPrompts: Record<string, string> = {}
    const memory = llm.memory
    llm.memory = async (a) => {
      memoryPrompts[a.characterId ?? ''] = JSON.stringify(a.messages)
      return memory(a)
    }
    let s = group({ nova: rel('nova'), kai: rel('kai') }, { venueId: 'arcade' })
    s = await openGroupDate(s, llm, recorder().hooks)
    s = await sendGroupMessage(s, 'Kai, your toasties are overrated.', llm, recorder().hooks)
    s = await sendGroupMessage(s, 'Seriously overrated.', llm, recorder().hooks)
    expect(s.group!.gone).toEqual(['kai'])
    s = await sendGroupMessage(s, 'Just us, then.', llm, recorder().hooks)
    const last = s.record.turns.filter((t) => t.role === 'character').slice(-1)[0]
    expect(last.speaker).toBe('nova')
    expect(last.text).not.toContain('Still here')
    expect(calls.story[calls.story.length - 1]).toContain('Kai Okoro is gone and does not speak again.')
    await finishGroupDate(s, 'ended', llm, recorder().hooks)
    expect(memoryPrompts.nova).toContain('SECRET-AFTER-KAI-LEFT')
    expect(memoryPrompts.kai).not.toContain('SECRET-AFTER-KAI-LEFT')
  })
})

describe('group chips', () => {
  it('fit both routes and ask for a line to each by name and one to both', () => {
    const s = applyGroupReveal(applyGroupOpening(group({ nova: rel('nova'), kai: rel('kai') })))
    const req = groupSuggestionsRequest(s)
    expect(req.system).toContain('This is a group date.')
    expect(req.system).toContain('at least one to Nova by name, one to Kai by name, and one to both of them')
    expect(req.system).toContain('Between them:')
  })
})

function card0(id: string) {
  return afterhoursWorld({ id }).character
}
