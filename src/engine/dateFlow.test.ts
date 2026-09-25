import { describe, expect, it } from 'vitest'
import { bundledEntry } from '../data/bundled'
import { heatDescription } from '../data/heat'
import { neutralJudge } from '../llm/coerce'
import { REFUSAL_NOTE, refusalBeat } from '../llm/index'
import { DATE_BEGINS } from '../prompts/build'
import { defaultSettings } from '../store/defaults'
import type { Character, DateRecord, JudgeResult, PlayerProfile, Relationship, Settings } from '../types'
import { GIFTS } from '../data/gifts'
import {
  canQueueSend,
  canRetry,
  canSend,
  createDate,
  type DateHooks,
  type DateLlm,
  type DateSession,
  dateGainUsed,
  finishDate,
  openDate,
  playerTurnCount,
  retryLastReply,
  sendPlayerMessage,
  storyRequest,
} from './dateFlow'
import { newRelationship } from './relationship'

const nova = bundledEntry('nova')!.character
const priya = bundledEntry('priya')!.character
const NAME = nova.name
const LAST_TURN = 'Last turn: bring the date to a natural close'
const EXIT = `The date has gone badly: write ${NAME} leaving.`
const LANDED = "HOW THE PLAYER'S LAST MESSAGE LANDED"

// ---------------------------------------------------------------------------
// A scripted fake model

type StoryScript = string | { text: string; refused: boolean } | Error
type JudgeScript = Partial<JudgeResult> | Error

interface FakeOptions {
  judges?: JudgeScript[]
  stories?: StoryScript[]
  summary?: string
  compressed?: string
  /** Called with each story request before it streams (e.g. to abort mid-call). */
  onStory?: (a: Parameters<DateLlm['story']>[0], n: number) => void
  onJudge?: (a: Parameters<DateLlm['judge']>[0], n: number) => void
}

function abortError(): Error {
  const e = new Error('The operation was aborted.')
  e.name = 'AbortError'
  return e
}

function fakeLlm(opts: FakeOptions = {}) {
  const judges = [...(opts.judges ?? [])]
  const stories = [...(opts.stories ?? [])]
  const log: string[] = []
  const calls = {
    story: [] as Parameters<DateLlm['story']>[0][],
    judge: [] as Parameters<DateLlm['judge']>[0][],
    suggestions: [] as Parameters<DateLlm['suggestions']>[0][],
    memory: [] as Parameters<DateLlm['memory']>[0][],
  }
  const llm: DateLlm = {
    async story(a) {
      log.push('story')
      calls.story.push(a)
      opts.onStory?.(a, calls.story.length)
      const next = stories.shift() ?? `Reply ${calls.story.length}.`
      if (next instanceof Error) throw next
      const r = typeof next === 'string' ? { text: next, refused: false } : next
      if (!r.refused) {
        const mid = Math.ceil(r.text.length / 2)
        for (const chunk of [r.text.slice(0, mid), r.text.slice(mid)]) {
          if (a.signal?.aborted) throw abortError()
          a.onDelta(chunk)
        }
        if (a.signal?.aborted) throw abortError()
      }
      return r
    },
    async judge(a) {
      log.push('judge')
      calls.judge.push(a)
      opts.onJudge?.(a, calls.judge.length)
      if (a.signal?.aborted) throw abortError()
      const next = judges.shift() ?? {}
      if (next instanceof Error) throw next
      return { value: { ...neutralJudge(), ...next }, ok: true }
    },
    async suggestions(a) {
      log.push('suggestions')
      calls.suggestions.push(a)
      return Object.fromEntries(a.keys.map((k) => [k, `A ${k} line`]))
    },
    async memory(a) {
      const compress = a.messages.some((m) => m.content.includes('Compress all of these'))
      log.push(compress ? 'compress' : 'memory')
      calls.memory.push(a)
      return compress ? (opts.compressed ?? 'Compressed paragraph.') : (opts.summary ?? 'We dug through crates and I laughed more than I meant to.')
    },
  }
  return { llm, log, calls }
}

function recorder(signal?: AbortSignal) {
  const updates: DateSession[] = []
  const persisted: { rel: Relationship; record: DateRecord }[] = []
  const hooks: DateHooks = {
    onUpdate: (s) => updates.push(s),
    persist: async (rel, record) => {
      persisted.push({ rel: structuredClone(rel), record: structuredClone(record) })
    },
    signal,
  }
  return { hooks, updates, persisted }
}

const PROFILE: PlayerProfile = {
  name: 'Robin',
  gender: 'nonbinary',
  pronouns: 'they/them',
  bodyNotes: '',
  relationshipStyle: 'figuring',
}

// A Monday, so the queer bar's Thursday note never shows up by accident.
const T0 = new Date(2026, 8, 21, 22, 0, 0).getTime()

function world(
  p: {
    character?: Character
    rel?: Partial<Relationship>
    settings?: Partial<Settings>
    profile?: Partial<PlayerProfile>
  } = {},
) {
  const character = p.character ?? nova
  let t = T0
  return {
    character,
    setId: 'afterhours',
    profile: { ...PROFILE, ...p.profile },
    settings: { ...defaultSettings(), ...p.settings },
    rel: { ...newRelationship(character.id), ...p.rel },
    names: { nova: NAME, kai: 'Kai Okoro', [character.id]: character.name },
    now: () => (t += 1000),
    rng: () => 0.5,
  }
}

async function play(s0: DateSession, messages: string[], llm: DateLlm, hooks: DateHooks): Promise<DateSession> {
  let s = s0
  for (const m of messages) s = await sendPlayerMessage(s, m, llm, hooks)
  return s
}

const tenMessages = Array.from({ length: 10 }, (_, i) => `Message ${i + 1}`)

// ---------------------------------------------------------------------------

describe('a full 10-turn date', () => {
  it('opens, judges before every reply, reveals, ends on the last-turn note and finishes', async () => {
    const { llm, log, calls } = fakeLlm({
      judges: [
        { delta: 3, trustDelta: 2, hits: [{ type: 'like', id: 'vinyl' }], mood: 'delighted', hint: 'Her eyes light up' },
        { delta: -8, trustDelta: -1, hits: [{ type: 'turnOff', id: 'cute' }], mood: 'annoyed', hint: 'Her jaw tightens' },
      ],
    })
    const { hooks, persisted, updates } = recorder()
    let s = createDate(world(), { venueId: 'record-store', giftId: 'plushie', maxTurns: 10 })
    expect(s.status).toBe('opening')

    s = await openDate(s, llm, hooks)
    // Venue +3 (favorite) and gift +1 (other) count toward the date.
    expect(s.rel.affection).toBe(4)
    expect(s.record.opening).toEqual({ nova: { venue: 3, gift: 1 } })
    expect(s.rel.venues).toEqual({ 'record-store': 'favorite' })
    expect(s.rel.gifts).toEqual({ plushie: 'neutral' })
    // The opening beat: no judge, no LANDED section, the opener on a first date.
    expect(calls.judge).toHaveLength(0)
    const opening = calls.story[0]
    expect(opening.messages).toEqual([
      { role: 'system', content: opening.system },
      { role: 'user', content: DATE_BEGINS },
    ])
    expect(opening.system).not.toContain(LANDED)
    expect(opening.system).toContain(`Use this line: ${nova.opener}`)
    expect(opening.system).toContain('Turn 0 of 10.')
    expect(s.record.turns).toEqual([{ role: 'character', speaker: 'nova', text: 'Reply 1.', at: expect.any(Number) }])
    expect(s.status).toBe('awaiting-player')
    expect(s.suggestions).toEqual({ sweet: 'A sweet line', flirty: 'A flirty line', bold: 'A bold line' })

    // Turn 1: a like, revealed with the judge's hint.
    s = await sendPlayerMessage(s, 'That Coltrane pressing is a first run, look at the label.', llm, hooks)
    expect(s.rel.affection).toBe(7)
    expect(s.rel.trust).toBe(2)
    expect(s.rel.discovered).toEqual([{ type: 'like', id: 'vinyl', hint: 'Her eyes light up', at: expect.any(Number) }])
    expect(calls.story[1].system).toContain('Mood: delighted. It touched a like: Vinyl records and liner-note trivia.')

    // Turn 2: a turn-off drops affection, and the reply is told how it landed.
    s = await sendPlayerMessage(s, "You're so cute when you nerd out.", llm, hooks)
    expect(s.rel.affection).toBe(0) // 7 - 8, floored at 0
    expect(s.record.totals.nova.affection).toBe(-1) // 4 + 3 - 8: the date's total isn't floored
    expect(s.record.turns.at(-2)?.applied).toEqual({ nova: { affection: -8, trust: -1 } })
    expect(s.lastJudge?.hits).toEqual([{ type: 'turnOff', id: 'cute' }])
    expect(calls.story[2].system).toContain('Mood: annoyed. It hit a turn-off: Being called cute.')
    expect(s.rel.lastMood).toBe('annoyed')

    // Turns 3 to 10.
    s = await play(s, tenMessages.slice(2), llm, hooks)
    expect(playerTurnCount(s.record)).toBe(10)
    expect(calls.judge).toHaveLength(10)
    expect(calls.story).toHaveLength(11)
    // The judge ran before every reply, and the chips after every reply but the last.
    expect(log.slice(0, 5)).toEqual(['story', 'suggestions', 'judge', 'story', 'suggestions'])
    expect(log.slice(-3)).toEqual(['judge', 'story', 'memory'])
    expect(log.filter((l) => l === 'suggestions')).toHaveLength(10)
    expect(log.indexOf('memory')).toBe(log.length - 1)
    // Only the tenth reply gets the last-turn note; nothing got the exit note.
    const lastNotes = calls.story.map((c) => c.system.includes(LAST_TURN))
    expect(lastNotes).toEqual([...Array(10).fill(false), true])
    expect(calls.story.some((c) => c.system.includes(EXIT))).toBe(false)
    expect(calls.story[10].system).toContain('Turn 10 of 10.')
    // Only the first date's opening uses the opener.
    expect(calls.story.filter((c) => c.system.includes('Use this line:'))).toHaveLength(1)

    // The date finished by itself.
    expect(s.status).toBe('ended')
    expect(s.record.outcome).toBe('completed')
    expect(s.record.endedAt).toBeGreaterThan(s.record.startedAt)
    expect(s.rel.dates).toBe(1)
    expect(s.rel.trust).toBe(2) // +2 -1 on the date, +1 for seeing it through
    expect(s.rel.memory).toEqual(['We dug through crates and I laughed more than I meant to.'])
    const recap = s.record.recap!.perCharacter.nova
    expect(recap).toMatchObject({
      affectionBefore: 0,
      affectionAfter: 0,
      trustBefore: 0,
      trustAfter: 2,
      stageBefore: 'stranger',
      stageAfter: 'stranger',
      venueReaction: 'favorite',
      giftReaction: 'neutral',
      left: false,
      route: 'romantic',
      memory: 'We dug through crates and I laughed more than I meant to.',
    })
    expect(recap.traits.map((t) => t.id)).toEqual(['vinyl', 'cute'])
    expect(canSend(s)).toBe(false)
    expect(await sendPlayerMessage(s, 'One more?', llm, hooks)).toBe(s)

    // Persisted after every turn: each player turn shows up judged and applied, then answered.
    for (let n = 1; n <= 10; n++) {
      const judged = persisted.find(
        (p) => playerTurnCount(p.record) === n && p.record.turns.filter((t) => t.role === 'player').at(-1)?.judge?.nova,
      )
      expect(judged, `turn ${n} judged and persisted`).toBeDefined()
      const answered = persisted.find(
        (p) => playerTurnCount(p.record) === n && p.record.turns.at(-1)?.role === 'character',
      )
      expect(answered, `turn ${n} answered and persisted`).toBeDefined()
    }
    expect(persisted.at(-1)?.record.outcome).toBe('completed')
    expect(persisted.at(-1)?.rel.dates).toBe(1)
    // The UI saw the reply stream in.
    expect(updates.some((u) => u.status === 'replying' && u.streaming === 'Repl')).toBe(true)
    expect(updates.at(-1)?.status).toBe('ended')
  })

  it('sends the last 4 turns to the judge and the chips', async () => {
    const { llm, calls } = fakeLlm()
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 10 }), llm, hooks)
    s = await play(s, ['one', 'two', 'three'], llm, hooks)
    const judge = calls.judge[2].system
    // Before "three": Reply 1, one, Reply 2, two, Reply 3 -> the last 4 leave out the opening.
    expect(judge).toContain('Player: one\nNova Castellanos: Reply 2.\nPlayer: two\nNova Castellanos: Reply 3.')
    expect(judge).not.toContain('Reply 1.')
    expect(judge).toContain("Player's new message: three")
    const chips = calls.suggestions.at(-1)!
    expect(chips.keys).toEqual(['sweet', 'flirty', 'bold'])
    expect(chips.messages[1].content).toContain('Player: three\nNova Castellanos: Reply 4.')
  })
})

describe('the gain cap and the early exit', () => {
  it('stops a flood of +10s at +25 net, venue and gift included', async () => {
    const { llm } = fakeLlm({ judges: Array.from({ length: 10 }, () => ({ delta: 10, mood: 'thrilled' })) })
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'record-store', giftId: 'rare-vinyl', maxTurns: 10 }), llm, hooks)
    expect(s.rel.affection).toBe(8)
    s = await play(s, tenMessages, llm, hooks)
    const applied = s.record.turns.filter((t) => t.role === 'player').map((t) => t.applied?.nova.affection)
    expect(applied).toEqual([10, 7, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(s.record.totals.nova.affection).toBe(25)
    expect(s.rel.affection).toBe(25)
    expect(s.record.recap?.perCharacter.nova.tiers).toEqual([1])
  })

  it('scales judge deltas by difficulty before the cap', async () => {
    const { llm } = fakeLlm({ judges: [{ delta: 10 }, { delta: -10 }] })
    const { hooks } = recorder()
    const hard: Character = { ...nova, difficulty: 'hard' }
    let s = await openDate(createDate(world({ character: hard, rel: { affection: 30 } }), { venueId: 'arcade', maxTurns: 10 }), llm, hooks)
    s = await play(s, ['a', 'b'], llm, hooks)
    expect(s.record.turns.filter((t) => t.role === 'player').map((t) => t.applied?.nova.affection)).toEqual([7, -7])
    expect(s.rel.affection).toBe(30)
  })

  it('leaves at -20: the exit note, no chips, and the date ends as left', async () => {
    const { llm, calls, log } = fakeLlm({ judges: [{ delta: -10, mood: 'done', hits: [{ type: 'turnOff', id: 'pushy' }] }] })
    const { hooks } = recorder()
    // Hated venue -5 and hated gift -5, then -10: exactly -20.
    let s = await openDate(
      createDate(world({ rel: { affection: 30, trust: 20 } }), { venueId: 'fancy-restaurant', giftId: 'flowers', maxTurns: 10 }),
      llm,
      hooks,
    )
    expect(s.record.totals.nova.affection).toBe(-10)
    s = await sendPlayerMessage(s, 'Come on, just come home with me.', llm, hooks)
    expect(calls.story).toHaveLength(2)
    expect(calls.story[1].system).toContain(EXIT)
    expect(calls.story[1].system).not.toContain(LAST_TURN)
    expect(log.slice(-3)).toEqual(['judge', 'story', 'memory'])
    expect(s.status).toBe('ended')
    expect(s.record.outcome).toBe('left')
    expect(s.record.totals.nova.affection).toBe(-20)
    expect(s.rel.affection).toBe(10)
    expect(s.rel.trust).toBe(20) // no consistency trust for a date they walked out of
    expect(s.rel.dates).toBe(1)
    expect(s.record.recap?.perCharacter.nova).toMatchObject({ left: true, affectionBefore: 30, affectionAfter: 10 })
    expect(canSend(s)).toBe(false)
  })
})

describe('the friend route', () => {
  const straightNova: Character = { ...nova, attractedTo: ['woman'] }
  const man = { gender: 'man' as const, pronouns: 'he/him' }

  it('caps affection at 59, unlocks only tiers 1-2 and earns secrets on trust', async () => {
    const { llm, calls } = fakeLlm({
      judges: Array.from({ length: 6 }, () => ({ delta: 8, trustDelta: 3, mood: 'warm' })),
    })
    const { hooks } = recorder()
    let s = createDate(world({ character: straightNova, profile: man, rel: { affection: 45, trust: 50 } }), {
      venueId: 'arcade',
      maxTurns: 6,
    })
    s = await openDate(s, llm, hooks)
    expect(s.rel.tiersUnlocked).toEqual([1, 2])
    expect(calls.story[0].system).toContain('Route: friend.')
    expect(s.suggestions).toEqual({ sweet: 'A sweet line', curious: 'A curious line', honest: 'A honest line' })
    s = await play(s, ['a', 'b', 'c', 'd', 'e', 'f'], llm, hooks)
    expect(s.rel.affection).toBe(59)
    expect(s.record.totals.nova.affection).toBe(14) // only what the meter could hold counts
    expect(s.rel.tiersUnlocked).toEqual([1, 2])
    expect(s.rel.trust).toBe(69) // 50 + 6 x 3, +1 for a completed date
    expect(s.rel.secretsUnlocked).toEqual([0]) // trust 60 reached; 80 not yet
    expect(s.record.recap?.perCharacter.nova).toMatchObject({ route: 'friend', secrets: [0], tiers: [1, 2] })
  })

  it('is romantic in everyone mode', async () => {
    const { llm, calls } = fakeLlm()
    const { hooks } = recorder()
    const s = createDate(world({ character: straightNova, profile: man, settings: { orientationMode: 'everyone' } }), {
      venueId: 'arcade',
      maxTurns: 3,
    })
    await openDate(s, llm, hooks)
    expect(calls.story[0].system).toContain('Route: romantic.')
  })
})

describe('openers, heat and memory', () => {
  it('uses the opener on the first date only', async () => {
    const first = fakeLlm()
    await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 3 }), first.llm, recorder().hooks)
    expect(first.calls.story[0].system).toContain(`Use this line: ${nova.opener}`)
    const later = fakeLlm()
    await openDate(
      createDate(world({ rel: { dates: 2, memory: ['We met at the arcade.'] } }), { venueId: 'arcade', maxTurns: 3 }),
      later.llm,
      recorder().hooks,
    )
    expect(later.calls.story[0].system).not.toContain('Use this line:')
    expect(later.calls.story[0].system).toContain('Past dates, in Nova Castellanos\'s words: We met at the arcade.')
  })

  it('writes the heat through the ace cap', async () => {
    const { llm, calls } = fakeLlm()
    await openDate(
      createDate(world({ character: priya, settings: { heat: 4 } }), { venueId: 'arcade', maxTurns: 3 }),
      llm,
      recorder().hooks,
    )
    expect(calls.story[0].system).toContain(`Intensity: ${heatDescription(2)}`)
  })

  it('appends the memory and compresses it past 250 words', async () => {
    const words = (n: number, w: string) => Array.from({ length: n }, () => w).join(' ')
    const old = [words(90, 'first'), words(90, 'second'), words(90, 'third')]
    const { llm, calls, log } = fakeLlm({ summary: 'Newest date.', compressed: 'Everything before, in one paragraph.' })
    const { hooks } = recorder()
    let s = await openDate(createDate(world({ rel: { dates: 3, memory: old } }), { venueId: 'arcade', maxTurns: 2 }), llm, hooks)
    s = await play(s, ['a', 'b'], llm, hooks)
    expect(log.slice(-2)).toEqual(['memory', 'compress'])
    expect(s.rel.memory).toEqual(['Everything before, in one paragraph.', old[2], 'Newest date.'])
    const compression = calls.memory[1].messages[1].content
    expect(compression).toContain('first')
    expect(compression).toContain('second')
    expect(compression).not.toContain('third')
    expect(calls.memory[1].system).toBe(calls.memory[0].system)
  })

  it('keeps short memory as it is', async () => {
    const { llm, log } = fakeLlm({ summary: 'Short.' })
    let s = await openDate(createDate(world({ rel: { memory: ['Earlier.'] } }), { venueId: 'arcade', maxTurns: 1 }), llm, recorder().hooks)
    s = await sendPlayerMessage(s, 'hi', llm, recorder().hooks)
    expect(log).not.toContain('compress')
    expect(s.rel.memory).toEqual(['Earlier.', 'Short.'])
  })
})

describe('model problems', () => {
  it('handles a refused story turn with the beat and a note, and the date goes on', async () => {
    const { llm } = fakeLlm({ stories: ['Hey.', { text: '', refused: true }, { text: 'Nova shrugs it off.', refused: true }] })
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 5 }), llm, hooks)
    s = await sendPlayerMessage(s, 'something spicy', llm, hooks)
    expect(s.record.turns.slice(-2)).toEqual([
      { role: 'character', speaker: 'nova', text: refusalBeat(NAME), at: expect.any(Number) },
      { role: 'system', text: REFUSAL_NOTE, at: expect.any(Number), notice: 'refused' },
    ])
    expect(s.status).toBe('awaiting-player')
    expect(s.streaming).toBe('')
    expect(canSend(s)).toBe(true)
    s = await sendPlayerMessage(s, 'again', llm, hooks)
    expect(s.record.turns.at(-2)?.text).toBe('Nova shrugs it off.')
  })

  it('treats a failed judge as neutral and still replies', async () => {
    const { llm, calls } = fakeLlm({ judges: [new Error('judge down')] })
    const { hooks } = recorder()
    let s = await openDate(createDate(world({ rel: { affection: 30 } }), { venueId: 'arcade', maxTurns: 5 }), llm, hooks)
    s = await sendPlayerMessage(s, 'hello', llm, hooks)
    expect(s.rel.affection).toBe(30)
    expect(s.record.turns.at(-2)?.judge?.nova).toEqual(neutralJudge())
    expect(calls.story[1].system).toContain('Mood: neutral. It hit nothing in particular.')
    expect(s.status).toBe('awaiting-player')
  })

  it('coerces the judge and ignores hit ids the character does not have', async () => {
    const { llm } = fakeLlm({
      judges: [{ delta: 40, trustDelta: -30, hits: [{ type: 'like', id: 'bogus' }, { type: 'like', id: 'rain' }], hint: 'She smiles' }],
    })
    const { hooks } = recorder()
    let s = await openDate(createDate(world({ rel: { affection: 50, trust: 50 } }), { venueId: 'arcade', maxTurns: 5 }), llm, hooks)
    s = await sendPlayerMessage(s, 'I love rainy nights', llm, hooks)
    expect(s.lastJudge).toMatchObject({ delta: 10, trustDelta: -10, hits: [{ type: 'like', id: 'rain' }] })
    expect(s.rel.discovered.map((d) => d.id)).toEqual(['rain'])
    expect(s.rel.affection).toBe(60)
    expect(s.rel.trust).toBe(40)
    expect(s.rel.secretsUnlocked).toEqual([0])
    expect(s.rel.tiersUnlocked).toEqual([1, 2, 3])
  })

  it('turns a failed story call into a system turn, and a retry fixes it', async () => {
    const { llm, calls } = fakeLlm({
      judges: [{ delta: 4, hits: [{ type: 'turnOn', id: 'banter' }], mood: 'amused' }],
      stories: ['Hey.', new Error('socket hang up')],
    })
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 5 }), llm, hooks)
    s = await sendPlayerMessage(s, 'Bet I can out-quip you.', llm, hooks)
    const note = s.record.turns.at(-1)!
    expect(note).toMatchObject({ role: 'system', notice: 'error' })
    expect(note.text).toContain(`${NAME}'s reply didn't come through.`)
    expect(note.text).toContain('socket hang up')
    expect(s.error).toContain('socket hang up')
    expect(s.status).toBe('awaiting-player')
    expect(s.rel.affection).toBe(4) // the judge result stays applied
    expect(canRetry(s)).toBe(true)

    s = await retryLastReply(s, llm, hooks)
    expect(calls.judge).toHaveLength(1) // not judged twice
    expect(calls.story.at(-1)!.system).toContain('Mood: amused. It touched a turn-on: Getting out-bantered.')
    expect(s.record.turns.some((t) => t.notice === 'error')).toBe(false)
    expect(s.record.turns.at(-1)).toMatchObject({ role: 'character', text: 'Reply 3.' })
    expect(s.error).toBeUndefined()
    expect(s.suggestions).not.toBeNull()
    expect(canRetry(s)).toBe(false)
    expect(s.rel.affection).toBe(4)
  })

  it('lets the opening beat be retried', async () => {
    const { llm } = fakeLlm({ stories: [new Error('offline')] })
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'record-store', maxTurns: 5 }), llm, hooks)
    expect(s.record.turns).toHaveLength(1)
    expect(canRetry(s)).toBe(true)
    s = await retryLastReply(s, llm, hooks)
    expect(s.record.turns).toEqual([{ role: 'character', speaker: 'nova', text: 'Reply 2.', at: expect.any(Number) }])
    expect(s.rel.affection).toBe(3) // the venue counted once
  })
})

describe('aborting', () => {
  it('stops mid-reply without an error, keeps the judged turn and can resume', async () => {
    const controller = new AbortController()
    const { llm, calls, log } = fakeLlm({
      judges: [{ delta: 5, mood: 'charmed' }],
      onStory: (a, n) => {
        if (n !== 2) return
        // The player leaves after the first chunk has streamed in.
        const show = a.onDelta
        a.onDelta = (chunk) => {
          show(chunk)
          controller.abort()
        }
      },
      stories: ['Hey.', 'A long reply that gets cut off.'],
    })
    const open = recorder()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 5 }), llm, open.hooks)
    const { hooks, updates, persisted } = recorder(controller.signal)
    s = await sendPlayerMessage(s, 'Hi', llm, hooks)
    expect(s.status).toBe('awaiting-player')
    expect(s.streaming).toBe('')
    expect(s.record.turns.some((t) => t.role === 'system')).toBe(false)
    expect(s.record.turns.at(-1)).toMatchObject({ role: 'player', text: 'Hi' })
    expect(s.rel.affection).toBe(5)
    expect(log.filter((l) => l === 'suggestions')).toHaveLength(1) // only the opening's
    expect(updates.every((u) => u.status !== 'awaiting-player' || u.streaming === '')).toBe(true)
    expect(persisted.at(-1)?.rel.affection).toBe(5)
    expect(canRetry(s)).toBe(true)

    s = await retryLastReply(s, llm, recorder().hooks)
    expect(calls.judge).toHaveLength(1)
    expect(s.record.turns.at(-1)).toMatchObject({ role: 'character', text: 'Reply 3.' })
  })

  it('takes the message back when stopped before the judge answers', async () => {
    const controller = new AbortController()
    const { llm, calls } = fakeLlm({ onJudge: () => controller.abort() })
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 5 }), llm, recorder().hooks)
    const before = s
    const { hooks, persisted, updates } = recorder(controller.signal)
    s = await sendPlayerMessage(s, 'Hi', llm, hooks)
    expect(s).toBe(before)
    expect(calls.story).toHaveLength(1)
    expect(playerTurnCount(persisted.at(-1)!.record)).toBe(0)
    expect(updates.at(-1)?.status).toBe('judging') // nothing after the abort
    expect(canSend(s)).toBe(true)
  })

  it('still finishes the date without model calls when stopped', async () => {
    const controller = new AbortController()
    controller.abort()
    const { llm, log } = fakeLlm()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 5 }), llm, recorder().hooks)
    s = await sendPlayerMessage(s, 'hi', llm, recorder().hooks)
    const before = log.length
    const { hooks, persisted, updates } = recorder(controller.signal)
    const { session, recap } = await finishDate(s, 'ended', llm, hooks)
    expect(log.length).toBe(before)
    expect(session.status).toBe('ended')
    expect(session.rel.dates).toBe(1)
    expect(session.rel.memory).toEqual([])
    expect(recap.perCharacter.nova.left).toBe(false)
    expect(persisted.at(-1)?.record.outcome).toBe('ended')
    expect(updates).toHaveLength(0)
  })
})

describe('finishing early and storage', () => {
  it('ends on request without consistency trust, and only once', async () => {
    const { llm, log } = fakeLlm({ judges: [{ delta: 4, trustDelta: 2 }] })
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 10 }), llm, hooks)
    s = await sendPlayerMessage(s, 'hi', llm, hooks)
    const first = await finishDate(s, 'ended', llm, hooks)
    expect(first.session.record.outcome).toBe('ended')
    expect(first.session.rel.trust).toBe(2)
    expect(first.session.rel.dates).toBe(1)
    expect(log.filter((l) => l === 'memory')).toHaveLength(1)
    const again = await finishDate(first.session, 'ended', llm, hooks)
    expect(again.session).toBe(first.session)
    expect(again.recap).toBe(first.recap)
    expect(log.filter((l) => l === 'memory')).toHaveLength(1)
  })

  it('skips the memory call when nothing was said', async () => {
    const { llm, log } = fakeLlm()
    const s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 10 }), llm, recorder().hooks)
    const { session } = await finishDate(s, 'ended', llm, recorder().hooks)
    expect(log).not.toContain('memory')
    expect(session.rel.dates).toBe(1)
  })

  it('keeps a record id that persist set in place, and survives a failing persist', async () => {
    const { llm } = fakeLlm()
    const ids: (number | undefined)[] = []
    let fail = false
    const hooks: DateHooks = {
      onUpdate: () => {},
      persist: async (_rel, record) => {
        if (fail) throw new Error('QuotaExceededError')
        record.id ??= 7
        ids.push(record.id)
      },
    }
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 3 }), llm, hooks)
    s = await sendPlayerMessage(s, 'hi', llm, hooks)
    expect(new Set(ids)).toEqual(new Set([7]))
    expect(s.record.id).toBe(7)
    fail = true
    s = await sendPlayerMessage(s, 'still here', llm, hooks)
    expect(s.status).toBe('awaiting-player')
    expect(playerTurnCount(s.record)).toBe(2)
  })

  it('ignores an empty message and a message while busy', async () => {
    const { llm, calls } = fakeLlm()
    const { hooks } = recorder()
    const s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 3 }), llm, hooks)
    expect(await sendPlayerMessage(s, '   ', llm, hooks)).toBe(s)
    const busy = { ...s, status: 'replying' as const }
    expect(await sendPlayerMessage(busy, 'hi', llm, hooks)).toBe(busy)
    expect(calls.judge).toHaveLength(0)
  })

  it('reveals attractions, style and the player style as they come up', async () => {
    const { llm } = fakeLlm({ stories: ['Hey.', '"I\'m bi, since you asked."', 'Okay.'] })
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 5 }), llm, hooks)
    s = await sendPlayerMessage(s, 'Can I ask who you are into?', llm, hooks)
    expect(s.rel.revealed).toEqual({ attractions: true, style: false })
    s = await sendPlayerMessage(s, "Full disclosure, I'm poly.", llm, hooks)
    expect(s.rel.revealed).toEqual({ attractions: true, style: true })
    expect(s.rel.knowsPlayerStyle).toBe(true)
  })
})

describe('the gain cap after a loss taken at 0', () => {
  const affectionApplied = (s: DateSession) => s.record.turns.filter((t) => t.role === 'player').map((t) => t.applied?.nova.affection)

  it("keeps the meter's rise at +25 when losses the meter couldn't take widened the ledger", async () => {
    const { llm } = fakeLlm({ judges: [{ delta: -9 }, { delta: -9 }, ...Array.from({ length: 5 }, () => ({ delta: 10 }))] })
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 7 }), llm, hooks)
    s = await play(s, ['a', 'b', 'c'], llm, hooks)
    expect(s.rel.affection).toBe(10)
    expect(s.record.totals.nova.affection).toBe(-8) // the losses count in full toward the exit
    s = await play(s, ['d', 'e', 'f', 'g'], llm, hooks)
    expect(affectionApplied(s)).toEqual([-9, -9, 10, 10, 5, 0, 0])
    expect(s.rel.affection).toBe(25)
    expect(s.record.totals.nova.affection).toBe(7)
    expect(dateGainUsed(s)).toBe(25)
    expect(s.record.recap?.perCharacter.nova).toMatchObject({ affectionBefore: 0, affectionAfter: 25 })
  })

  it('does the same after a hated venue and a hated gift on a first date', async () => {
    const { llm } = fakeLlm({ judges: Array.from({ length: 4 }, () => ({ delta: 10 })) })
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'fancy-restaurant', giftId: 'flowers', maxTurns: 4 }), llm, hooks)
    expect(s.rel.affection).toBe(0)
    expect(s.record.totals.nova.affection).toBe(-10)
    s = await play(s, ['a', 'b', 'c', 'd'], llm, hooks)
    expect(affectionApplied(s)).toEqual([10, 10, 5, 0])
    expect(s.rel.affection).toBe(25)
  })

  it('still lets a date that started higher win back what it lost', async () => {
    const { llm } = fakeLlm({ judges: [{ delta: -10 }, { delta: 10 }, { delta: 10 }, { delta: 10 }, { delta: 10 }] })
    const { hooks } = recorder()
    let s = await openDate(createDate(world({ rel: { affection: 30 } }), { venueId: 'arcade', maxTurns: 5 }), llm, hooks)
    s = await play(s, ['a', 'b', 'c', 'd', 'e'], llm, hooks)
    // -10 lands on the meter, so +35 is room for a net +25.
    expect(affectionApplied(s)).toEqual([-10, 10, 10, 10, 5])
    expect(s.rel.affection).toBe(55)
  })
})

describe('sending while a reply is missing', () => {
  it('waits for a retry after a failed opening, so the character still arrives first', async () => {
    const { llm, calls } = fakeLlm({ stories: [new Error('offline')] })
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 5 }), llm, hooks)
    expect(s.status).toBe('awaiting-player')
    expect(canSend(s)).toBe(false)
    expect(canQueueSend(s)).toBe(false)
    expect(canRetry(s)).toBe(true)
    expect(await sendPlayerMessage(s, 'Hello? Anyone?', llm, hooks)).toBe(s)
    expect(calls.judge).toHaveLength(0)
    s = await retryLastReply(s, llm, hooks)
    expect(calls.story.at(-1)!.system).toContain(`Use this line: ${nova.opener}`)
    expect(canSend(s)).toBe(true)
  })

  it('waits for a retry after a failed reply mid-date, so two player turns never run together', async () => {
    const { llm } = fakeLlm({ stories: ['Hey.', new Error('socket hang up')] })
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 5 }), llm, hooks)
    s = await sendPlayerMessage(s, 'one', llm, hooks)
    expect(canSend(s)).toBe(false)
    expect(await sendPlayerMessage(s, 'two', llm, hooks)).toBe(s)
    expect(playerTurnCount(s.record)).toBe(1)
  })

  it('lets the player queue a message while the chips load', async () => {
    const { llm } = fakeLlm()
    const s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 5 }), llm, recorder().hooks)
    const loading: DateSession = { ...s, status: 'suggesting' }
    expect(canSend(loading)).toBe(false)
    expect(canQueueSend(loading)).toBe(true)
    expect(canQueueSend({ ...loading, status: 'replying' })).toBe(false)
  })
})

describe('an abort while the landed reply saves', () => {
  it("returns the player's turn, not a date stuck on 'suggesting'", async () => {
    const controller = new AbortController()
    const { llm, log } = fakeLlm()
    let s = await openDate(createDate(world(), { venueId: 'arcade', maxTurns: 5 }), llm, recorder().hooks)
    const hooks: DateHooks = {
      onUpdate: () => undefined,
      signal: controller.signal,
      persist: async (_rel, record) => {
        // The player leaves the screen while the reply that just landed is being saved.
        if (playerTurnCount(record) === 1 && record.turns.at(-1)?.role === 'character') controller.abort()
      },
    }
    const chipsBefore = log.filter((l) => l === 'suggestions').length
    s = await sendPlayerMessage(s, 'Hi', llm, hooks)
    expect(s.status).toBe('awaiting-player')
    expect(s.record.turns.at(-1)).toMatchObject({ role: 'character', text: 'Reply 2.' })
    expect(log.filter((l) => l === 'suggestions')).toHaveLength(chipsBefore)
    expect(canSend(s)).toBe(true)
  })
})

describe('what the prompts say about the scene', () => {
  it('writes every gift as a noun phrase in {giftLine}', () => {
    for (const gift of GIFTS) {
      const s = createDate(world(), { venueId: 'arcade', giftId: gift.id, maxTurns: 5 })
      const line = /You brought ([^.]+)\./.exec(storyRequest(s, { turn: 0 }).system)?.[1]
      expect(line, gift.id).toBeDefined()
      expect(line).not.toMatch(/^(video game|poetry book|plushie|sketchbook|silver necklace|houseplant)$/)
    }
    const book = createDate(world(), { venueId: 'arcade', giftId: 'poetry-book', maxTurns: 5 })
    expect(storyRequest(book, { turn: 0 }).system).toContain('You brought a poetry book.')
    const vinyl = createDate(world(), { venueId: 'arcade', giftId: 'rare-vinyl', maxTurns: 5 })
    expect(storyRequest(vinyl, { turn: 0 }).system).toContain('You brought rare vinyl.')
  })

  it("says home is the player's place", () => {
    const s = createDate(world({ rel: { affection: 85 } }), { venueId: 'home', maxTurns: 5 })
    expect(storyRequest(s, { turn: 0 }).system).toContain('Venue: Home (your place).')
  })

  it("doesn't call a later date the first when memory is empty", () => {
    const later = createDate(world({ rel: { dates: 4, memory: [] } }), { venueId: 'arcade', maxTurns: 5 })
    const system = storyRequest(later, { turn: 0 }).system
    expect(system).toContain("Past dates, in Nova Castellanos's words: You've been out before; nothing from those dates stands out.")
    expect(system).not.toContain('This is your first date.')
    const first = createDate(world(), { venueId: 'arcade', maxTurns: 5 })
    expect(storyRequest(first, { turn: 0 }).system).toContain("Past dates, in Nova Castellanos's words: This is your first date.")
  })

  it("names the player and the gift in the memory call's transcript", async () => {
    const { llm, calls } = fakeLlm()
    const { hooks } = recorder()
    let s = await openDate(createDate(world(), { venueId: 'record-store', giftId: 'poetry-book', maxTurns: 1 }), llm, hooks)
    s = await sendPlayerMessage(s, 'That Coltrane pressing is a first run.', llm, hooks)
    const user = calls.memory[0].messages[1].content
    expect(user).toContain('Venue: Record store. Gift: a poetry book.\nThe date:')
    expect(user).toContain('Robin: That Coltrane pressing is a first run.')
    expect(user).not.toContain('Player:')
  })
})
