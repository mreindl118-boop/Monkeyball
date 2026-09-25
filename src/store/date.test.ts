import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_CHARACTERS, BUNDLED_SETS } from '../data/bundled'
import { CrushDB } from '../db/db'
import { getDate, kvGet } from '../db/repo'
import { createDate, finishDate, openDate, retryLastReply, sendPlayerMessage, type DateLlm, type DateSession } from '../engine/dateFlow'
import type { JudgeResult, PlayerProfile, RosterEntry, Settings } from '../types'
import { heatDescription } from '../data/heat'
import { newRelationship } from '../engine/relationship'
import type { DBCoreMutateRequest } from 'dexie'
import {
  ACTIVE_DATE_KEY,
  completedRecord,
  createDateStore,
  estimateBefore,
  isLive,
  liveCharacterId,
  liveSettings,
  othersSeen,
  type ActiveDateMark,
} from './date'
import { defaultSettings } from './defaults'
import { createGameStore } from './game'

// ---------------------------------------------------------------------------
// Fixtures

let counter = 0
const open: CrushDB[] = []
function freshDb(): CrushDB {
  const d = new CrushDB(`date-test-${Date.now()}-${counter++}`)
  open.push(d)
  return d
}

afterEach(async () => {
  while (open.length) {
    const d = open.pop()!
    d.close()
    await d.delete()
  }
})

const PROFILE: PlayerProfile = { name: 'Ana', gender: 'woman', pronouns: 'she/her', bodyNotes: '', relationshipStyle: 'open' }

const entries: Record<string, RosterEntry> = Object.fromEntries(BUNDLED_CHARACTERS.map((e) => [e.character.id, e]))
const roster = { getState: () => ({ entries, sets: [...BUNDLED_SETS], load: async () => {} }) }

function settingsStore(patch: Partial<Settings> = {}) {
  const settings: Settings = { ...defaultSettings(), activeSets: ['afterhours'], dateLength: 3, ...patch }
  return { getState: () => ({ settings, profile: PROFILE }) }
}

const neutral = (over: Partial<JudgeResult> = {}): JudgeResult => ({
  delta: 1,
  trustDelta: 0,
  hits: [],
  mood: 'curious',
  hint: 'She tilts her head',
  jealousy: false,
  breach: false,
  ...over,
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** A scripted DateLlm. Judge results come from the message; story replies are numbered. */
function fakeLlm(
  opts: {
    judge?: (message: string) => JudgeResult
    /** Story calls that throw before one succeeds. */
    storyFailures?: number
    /** Story calls wait for this before answering (the signal still settles them). */
    storyGate?: () => Promise<void> | undefined
    suggestionsGate?: () => Promise<void> | undefined
    judgeGate?: () => Promise<void> | undefined
  } = {},
) {
  const calls = { story: 0, judge: 0, suggestions: 0, memory: 0 }
  let failures = opts.storyFailures ?? 0
  const llm: DateLlm = {
    story: async ({ onDelta }) => {
      calls.story++
      await opts.storyGate?.()
      if (failures > 0) {
        failures--
        throw new Error('The model server went away.')
      }
      const text = `*Nova grins.* "Reply ${calls.story}."`
      onDelta(text.slice(0, 10))
      onDelta(text.slice(10))
      return { text, refused: false }
    },
    judge: async ({ messages }) => {
      calls.judge++
      await opts.judgeGate?.()
      const system = messages[0]?.content ?? ''
      const message = /Player's new message: (.*)/.exec(system)?.[1] ?? ''
      return { value: opts.judge ? opts.judge(message) : neutral(), ok: true }
    },
    suggestions: async ({ keys }) => {
      calls.suggestions++
      await opts.suggestionsGate?.()
      return Object.fromEntries(keys.map((k) => [k, `A ${k} line.`]))
    },
    memory: async () => {
      calls.memory++
      return 'We argued about B-sides and I liked losing.'
    },
  }
  return { llm, calls }
}

function setup(opts: Parameters<typeof fakeLlm>[0] = {}, settings: Partial<Settings> = {}, online = true) {
  const db = freshDb()
  const game = createGameStore(db)
  const fake = fakeLlm(opts)
  const make = () =>
    createDateStore({
      llm: () => fake.llm,
      db,
      game,
      settings: settingsStore(settings),
      roster,
      now: () => 1_700_000_000_000,
      rng: () => 0.5,
      online: () => online,
    })
  return { db, game, fake, store: make(), make }
}

async function waitFor(check: () => boolean, what: string, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 2))
  }
}

type Store = ReturnType<typeof setup>['store']

async function started(store: Store, venue = 'record-store', gift?: string) {
  const r = await store.getState().start('nova', venue, gift)
  expect(r.ok).toBe(true)
  await waitFor(() => store.getState().running === null, 'the opening')
  return r.ok ? r.dateId : -1
}

// ---------------------------------------------------------------------------

describe('useDate: a full date against a fake model', () => {
  it('opens with the venue and gift, streams the opening and fills the chips', async () => {
    const { store, db, game, fake } = setup()
    const id = await started(store, 'record-store', 'rare-vinyl')
    const s = store.getState().session!
    expect(id).toBeGreaterThan(0)
    expect(s.record.id).toBe(id)
    expect(s.status).toBe('awaiting-player')
    expect(s.record.turns.map((t) => t.role)).toEqual(['character'])
    expect(s.suggestions).toEqual({ sweet: 'A sweet line.', flirty: 'A flirty line.', bold: 'A bold line.' })
    // Favorite venue +3 and a loved gift +5.
    expect(s.rel.affection).toBe(8)
    expect(game.getState().relationships.nova?.affection).toBe(8)
    expect((await getDate(id, db))?.turns).toHaveLength(1)
    expect(await kvGet<ActiveDateMark>(ACTIVE_DATE_KEY, db)).toMatchObject({ dateId: id, characterId: 'nova' })
    expect(fake.calls).toMatchObject({ story: 1, judge: 0, suggestions: 1 })
    expect(isLive(store.getState())).toBe(true)
    expect(liveCharacterId(store.getState())).toBe('nova')
  })

  it('judges before every reply, applies it and persists every turn', async () => {
    const { store, db, game, fake } = setup({
      judge: (m) => (m.includes('cute') ? neutral({ delta: -8, trustDelta: -2, hits: [{ type: 'turnOff', id: 'cute' }], mood: 'annoyed', hint: 'Her smile goes flat' }) : neutral()),
    })
    const id = await started(store, 'arcade')
    expect(await store.getState().send("You're cute when you do that")).toBe(true)
    const s = store.getState().session!
    expect(fake.calls.judge).toBe(1)
    expect(s.lastJudge?.mood).toBe('annoyed')
    expect(s.rel.affection).toBe(0)
    expect(s.rel.discovered.map((d) => d.id)).toEqual(['cute'])
    const player = s.record.turns.find((t) => t.role === 'player')!
    // Trust lands on the meter: it can't go below 0.
    expect(player.applied?.nova).toEqual({ affection: -8, trust: 0 })
    const stored = await getDate(id, db)
    expect(stored?.turns.map((t) => t.role)).toEqual(['character', 'player', 'character'])
    expect(game.getState().relationships.nova?.discovered).toHaveLength(1)
    expect(store.getState().draft).toBe('')
  })

  it('ends after the last turn with a recap, a memory line and the open-date mark cleared', async () => {
    const { store, db, game, fake } = setup({ judge: () => neutral({ delta: 4 }) })
    const id = await started(store)
    for (const line of ['One', 'Two', 'Three']) await store.getState().send(line)
    const st = store.getState()
    expect(st.session?.status).toBe('ended')
    expect(st.finishedId).toBe(id)
    expect(isLive(st)).toBe(false)
    expect(fake.calls.memory).toBe(1)
    const rec = await getDate(id, db)
    expect(rec?.outcome).toBe('completed')
    expect(rec?.recap?.perCharacter.nova.affectionBefore).toBe(0)
    expect(rec?.recap?.perCharacter.nova.affectionAfter).toBe(15)
    expect(rec?.recap?.perCharacter.nova.memory).toBe('We argued about B-sides and I liked losing.')
    expect(st.lastRecord?.recap).toBeTruthy()
    expect(game.getState().relationships.nova?.dates).toBe(1)
    expect(game.getState().relationships.nova?.memory).toEqual(['We argued about B-sides and I liked losing.'])
    expect(await kvGet(ACTIVE_DATE_KEY, db)).toBeUndefined()
    // Nothing more to send.
    expect(await store.getState().send('Four')).toBe(false)
  })

  it('lets the character leave once the date reaches -20', async () => {
    const { store, db } = setup({ judge: () => neutral({ delta: -20, trustDelta: -5 }) }, { dateLength: 10 })
    const id = await started(store, 'climbing-gym')
    await store.getState().send('Something awful')
    const rec = await getDate(id, db)
    expect(store.getState().session?.status).toBe('ended')
    expect(rec?.outcome).toBe('left')
    expect(rec?.recap?.perCharacter.nova.left).toBe(true)
  })

  it('shows a failed reply as a system note and retries it', async () => {
    const { store, fake } = setup({ storyFailures: 1 })
    await started(store)
    let s = store.getState().session!
    expect(s.record.turns.map((t) => t.notice)).toEqual(['error'])
    expect(s.status).toBe('awaiting-player')
    await store.getState().retry()
    s = store.getState().session!
    expect(s.record.turns.map((t) => t.role)).toEqual(['character'])
    expect(fake.calls.story).toBe(2)
  })

  it('skips chips that are still loading when the player sends', async () => {
    const gate = deferred<void>()
    let hold = true
    const { store, fake } = setup({ suggestionsGate: () => (hold ? gate.promise : undefined) })
    const r = await store.getState().start('nova', 'record-store')
    expect(r.ok).toBe(true)
    await waitFor(() => store.getState().session?.status === 'suggesting', 'the chips')
    hold = false
    expect(await store.getState().send('Hi there')).toBe(true)
    expect(fake.calls.judge).toBe(1)
    expect(store.getState().session?.record.turns.filter((t) => t.role === 'player')).toHaveLength(1)
    gate.resolve()
  })

  it('stops the reply when the player leaves and picks it up again on return', async () => {
    const gate = deferred<void>()
    let hold = false
    const { store, fake } = setup({ storyGate: () => (hold ? gate.promise : undefined) })
    await started(store)
    hold = true
    const sending = store.getState().send('Tell me about the booth')
    await waitFor(() => store.getState().session?.status === 'replying', 'the reply')
    store.getState().cancel()
    await sending
    expect(store.getState().paused).toBe(true)
    expect(store.getState().session?.status).toBe('awaiting-player')
    hold = false
    await store.getState().resume()
    const s = store.getState().session!
    expect(s.record.turns.map((t) => t.role)).toEqual(['character', 'player', 'character'])
    expect(fake.calls.judge).toBe(1)
    expect(store.getState().paused).toBe(false)
  })

  it('gives the message back when the player leaves before the judge answers', async () => {
    const gate = deferred<void>()
    const { store, fake } = setup({ judgeGate: () => gate.promise })
    await started(store)
    const sending = store.getState().send('Keep this')
    await waitFor(() => store.getState().session?.status === 'judging', 'the judge')
    store.getState().cancel()
    expect(await sending).toBe(false)
    expect(store.getState().draft).toBe('Keep this')
    expect(store.getState().session?.record.turns.filter((t) => t.role === 'player')).toHaveLength(0)
    // Nothing to ask for again: the reply wasn't missing, the message was.
    await store.getState().resume()
    expect(fake.calls.story).toBe(1)
    gate.resolve()
  })

  it('ends the date mid-reply: stops the call, then memory and recap', async () => {
    const gate = deferred<void>()
    let hold = false
    const { store, db, fake } = setup({ storyGate: () => (hold ? gate.promise : undefined) })
    const id = await started(store)
    hold = true
    void store.getState().send('Long story')
    await waitFor(() => store.getState().session?.status === 'replying', 'the reply')
    expect(await store.getState().end()).toBe(id)
    const rec = await getDate(id, db)
    expect(rec?.outcome).toBe('ended')
    expect(rec?.recap).toBeTruthy()
    expect(fake.calls.memory).toBe(1)
    expect(store.getState().finishedId).toBe(id)
  })

  it('refuses a second date while one is open, and unknown characters', async () => {
    const { store } = setup()
    await started(store)
    expect(await store.getState().start('kai', 'arcade')).toEqual({ ok: false, reason: 'busy', characterId: 'nova' })
    store.getState().clear()
    expect(store.getState().session).toBeNull()
    expect(await store.getState().start('nobody', 'arcade')).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('useDate: a date interrupted by a reload', () => {
  it('finds the open date and finishes it into a recap without a memory call when offline', async () => {
    const first = setup({ judge: () => neutral({ delta: 5 }) }, {}, false)
    const id = await started(first.store, 'record-store')
    await first.store.getState().send('Hello')
    // A reload: a new store on the same storage, no session.
    const store = first.make()
    const it1 = await store.getState().findInterrupted()
    expect(it1).toMatchObject({ characterId: 'nova', name: 'Nova Castellanos', turns: 1 })
    expect(await store.getState().recoverInterrupted()).toBe(id)
    const rec = await getDate(id, first.db)
    expect(rec?.outcome).toBe('ended')
    expect(rec?.recap?.perCharacter.nova.affectionBefore).toBe(0)
    expect(rec?.recap?.perCharacter.nova.affectionAfter).toBe(8)
    expect(first.fake.calls.memory).toBe(0)
    expect(await store.getState().findInterrupted()).toBeNull()
  })

  it('files an interrupted date away without a recap', async () => {
    const first = setup()
    const id = await started(first.store)
    const store = first.make()
    await store.getState().findInterrupted()
    await store.getState().dropInterrupted()
    expect((await getDate(id, first.db))?.outcome).toBe('abandoned')
    expect(await store.getState().findInterrupted()).toBeNull()
  })

  it('a new date files the old open one away', async () => {
    const first = setup()
    const id = await started(first.store)
    const store = first.make()
    await started(store, 'arcade')
    expect((await getDate(id, first.db))?.outcome).toBe('abandoned')
  })
})

describe('date store helpers', () => {
  it('knows a completed record', () => {
    const t = (role: 'player' | 'character') => ({ role, text: 'x', at: 0 })
    expect(completedRecord({ maxTurns: 1, turns: [t('character'), t('player'), t('character')] })).toBe(true)
    expect(completedRecord({ maxTurns: 1, turns: [t('character'), t('player')] })).toBe(false)
    expect(completedRecord({ maxTurns: 2, turns: [t('player'), t('character')] })).toBe(false)
  })

  it('estimates the relationship before a date from its totals', () => {
    const rel = { ...createGameStore(freshDb()).getState().rel('nova'), affection: 30, trust: 4 }
    const before = estimateBefore(rel, { characterIds: ['nova'], totals: { nova: { affection: 12, trust: 6, gained: 12 } } })
    expect(before.affection).toBe(18)
    expect(before.trust).toBe(0)
  })
})

describe('useDate: settings that change mid-date', () => {
  it("sends the next story and chips calls at the heat the player picks mid-date, keeping the date's own limits", async () => {
    const db = freshDb()
    const game = createGameStore(db)
    let settings: Settings = { ...defaultSettings(), activeSets: ['afterhours'], dateLength: 5, heat: 2 }
    const fake = fakeLlm()
    const stories: string[] = []
    const chips: string[] = []
    const llm: DateLlm = {
      ...fake.llm,
      story: (a) => {
        stories.push(a.system)
        return fake.llm.story(a)
      },
      suggestions: (a) => {
        chips.push(a.system)
        return fake.llm.suggestions(a)
      },
    }
    const store = createDateStore({
      llm: () => llm,
      db,
      game,
      settings: { getState: () => ({ settings, profile: PROFILE }) },
      roster,
      now: () => 1_700_000_000_000,
      rng: () => 0.5,
    })
    await started(store, 'arcade')
    expect(await store.getState().send('Hi')).toBe(true)
    expect(stories.at(-1)).toContain(`Intensity: ${heatDescription(2)}`)

    // The player opens the heat sheet mid-date (and fiddles with the date settings too).
    settings = { ...settings, heat: 3, gainCap: 5, dateLength: 2 }
    expect(await store.getState().send('Again')).toBe(true)
    expect(stories.at(-1)).toContain(`Intensity: ${heatDescription(3)}`)
    expect(chips.at(-1)).toContain(heatDescription(3).replace(/\.$/, ''))
    const s = store.getState().session!
    expect(s.world.settings.heat).toBe(3)
    expect(s.world.settings.gainCap).toBe(25)
    expect(s.record.maxTurns).toBe(5)
  })

  it('keeps the route, the length and the gain cap the date began with', () => {
    const began = { ...defaultSettings(), orientationMode: 'everyone' as const, dateLength: 10, gainCap: 25, heat: 2 as const }
    const now = { ...began, orientationMode: 'realistic' as const, dateLength: 4, gainCap: 10, heat: 4 as const, suggestions: false }
    expect(liveSettings(began, now)).toMatchObject({ orientationMode: 'everyone', dateLength: 10, gainCap: 25, heat: 4, suggestions: false })
  })
})

describe('useDate: the judge knows who else the player dates', () => {
  it('fills {others} with the people the player is seeing (a date, 20 affection, a romantic route)', async () => {
    const { store, game, fake } = setup()
    await game.getState().load()
    await game.getState().saveRel({ ...newRelationship('kai'), dates: 2, affection: 30 })
    await game.getState().saveRel({ ...newRelationship('imani'), dates: 0 })
    // Out once and it went nowhere: not someone the player is seeing (Phase 4).
    await game.getState().saveRel({ ...newRelationship('jules'), dates: 1, affection: 5 })
    const judges: string[] = []
    const judge = fake.llm.judge
    fake.llm.judge = (a) => {
      judges.push(a.system)
      return judge(a)
    }
    await started(store, 'arcade')
    expect(store.getState().session?.world.others).toEqual(['jules', 'kai'])
    await store.getState().send('Hi')
    expect(judges.at(-1)).toContain('People the player is seeing: Kai Okoro.')
  })

  it('leaves out the character on the date, characters not on this device and people never dated', () => {
    const rels = {
      nova: { ...newRelationship('nova'), dates: 3 },
      kai: { ...newRelationship('kai'), dates: 1 },
      imani: { ...newRelationship('imani'), dates: 0 },
      gone: { ...newRelationship('gone'), dates: 4 },
    }
    expect(othersSeen(rels, 'nova', entries)).toEqual(['kai'])
  })
})

describe('useDate: a date left on suggesting with nothing running', () => {
  it("takes the player's next message anyway", async () => {
    const db = freshDb()
    const fake = fakeLlm()
    // An engine that lands a reply but, like the old abort race, leaves the status on 'suggesting'.
    let stuck = true
    const store = createDateStore({
      llm: () => fake.llm,
      db,
      game: createGameStore(db),
      settings: settingsStore({ dateLength: 5 }),
      roster,
      engine: {
        createDate,
        openDate,
        retryLastReply,
        finishDate,
        sendPlayerMessage: async (s0, text, llm, hooks) => {
          const s: DateSession = await sendPlayerMessage(s0, text, llm, hooks)
          if (!stuck) return s
          stuck = false
          return { ...s, status: 'suggesting', suggestions: null }
        },
      },
    })
    await started(store, 'arcade')
    expect(await store.getState().send('One')).toBe(true)
    expect(store.getState().session?.status).toBe('suggesting')
    expect(store.getState().running).toBeNull()
    expect(await store.getState().send('Two')).toBe(true)
    expect(store.getState().session?.record.turns.filter((t) => t.role === 'player')).toHaveLength(2)
  })
})

describe('useDate: saving a step', () => {
  it('writes the relationship and the record in one transaction', async () => {
    const { store, db } = setup({ judge: () => neutral({ delta: 4 }) })
    const writes: { table: string; trans: unknown }[] = []
    db.use({
      stack: 'dbcore',
      name: 'write-spy',
      create: (down) => ({
        ...down,
        table: (name) => {
          const table = down.table(name)
          return {
            ...table,
            mutate: (req: DBCoreMutateRequest) => {
              writes.push({ table: name, trans: req.trans })
              return table.mutate(req)
            },
          }
        },
      }),
    })
    await started(store)
    for (const line of ['One', 'Two', 'Three']) await store.getState().send(line)
    expect(store.getState().session?.status).toBe('ended')
    const lastRel = writes.filter((w) => w.table === 'relationships').at(-1)
    const lastDate = writes.filter((w) => w.table === 'dates').at(-1)
    expect(lastRel).toBeDefined()
    expect(lastDate).toBeDefined()
    // The finish (outcome and recap with +1 date and the memory) lands together or not at all.
    expect(lastRel!.trans).toBe(lastDate!.trans)
  })
})
