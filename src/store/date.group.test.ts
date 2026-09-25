// useDate with a group date (Phase 6): starting one, playing it to the end with both saved after
// every step, the shared picture asked for, and an interrupted group date finished into a recap.

import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_CHARACTERS, BUNDLED_SETS } from '../data/bundled'
import { CrushDB } from '../db/db'
import { getDate, kvGet } from '../db/repo'
import type { DateLlm } from '../engine/dateFlow'
import type { JudgeResult, PlayerProfile, RosterEntry, Settings } from '../types'
import { ACTIVE_DATE_KEY, createDateStore, liveCharacterIds, type ActiveDateMark } from './date'
import { defaultSettings } from './defaults'
import { createGameStore } from './game'

let counter = 0
const open: CrushDB[] = []
function freshDb(): CrushDB {
  const d = new CrushDB(`date-group-test-${Date.now()}-${counter++}`)
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

function fakeLlm() {
  const calls = { story: 0, judge: [] as string[], memory: [] as string[] }
  const llm: DateLlm = {
    story: async ({ onDelta }) => {
      calls.story++
      const text = `Nova: "Reply ${calls.story}."\n\nKai: *nods*`
      onDelta(text)
      return { text, refused: false }
    },
    judge: async ({ characterId }) => {
      calls.judge.push(characterId ?? '')
      const value: JudgeResult = { delta: 2, trustDelta: 1, hits: [], mood: 'easy', hint: 'A smile', jealousy: false, breach: false }
      return { value, ok: true }
    },
    suggestions: async ({ keys }) => Object.fromEntries(keys.map((k) => [k, `A ${k} line.`])),
    memory: async ({ characterId }) => {
      calls.memory.push(characterId ?? '')
      return `A memory for ${characterId}.`
    },
  }
  return { llm, calls }
}

function setup(settings: Partial<Settings> = {}) {
  const db = freshDb()
  const game = createGameStore(db)
  const fake = fakeLlm()
  const painted: string[][] = []
  const make = () =>
    createDateStore({
      llm: () => fake.llm,
      db,
      game,
      settings: { getState: () => ({ settings: { ...defaultSettings(), activeSets: ['afterhours'], dateLength: 2, ...settings }, profile: PROFILE }) },
      roster,
      now: () => 1_700_000_000_000,
      rng: () => 0.5,
      art: { onUnlock: () => undefined, onGroupDate: (ids) => painted.push([...ids]) },
    })
  return { db, game, fake, painted, store: make(), make }
}

async function waitFor(check: () => boolean, what: string, ms = 3000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 2))
  }
}

describe('useDate: a group date', () => {
  it('starts with two characters, plays to the end and saves both', async () => {
    const { store, db, game, fake, painted } = setup()
    const r = await store.getState().startGroup(['nova', 'kai'], 'karaoke-box', 'hot-sauce', 'nova')
    expect(r.ok).toBe(true)
    const id = r.ok ? r.dateId : -1
    await waitFor(() => store.getState().running === null, 'the opening')
    expect(liveCharacterIds(store.getState())).toEqual(['nova', 'kai'])
    const mark = await kvGet<ActiveDateMark>(ACTIVE_DATE_KEY, db)
    expect(mark?.characterIds).toEqual(['nova', 'kai'])
    expect(mark?.giftTo).toBe('nova')
    let s = store.getState().session!
    expect(s.record.kind).toBe('group')
    expect(s.record.turns.map((t) => t.speaker)).toEqual(['nova', 'kai'])
    // Karaoke is a favorite of both (+3 each); the hot sauce is Nova's (+5).
    expect(game.getState().relationships.nova?.affection).toBe(8)
    expect(game.getState().relationships.kai?.affection).toBe(3)

    expect(await store.getState().send('Hi, both of you.')).toBe(true)
    expect(fake.calls.judge.sort()).toEqual(['kai', 'nova'])
    await store.getState().send('Another round?')
    await waitFor(() => store.getState().finishedId != null, 'the end of the date')
    s = store.getState().session!
    expect(s.status).toBe('ended')
    const record = await getDate(id, db)
    expect(record?.outcome).toBe('completed')
    expect(Object.keys(record?.recap?.perCharacter ?? {}).sort()).toEqual(['kai', 'nova'])
    expect(fake.calls.memory.sort()).toEqual(['kai', 'nova'])
    expect(game.getState().relationships.nova?.dates).toBe(1)
    expect(game.getState().relationships.kai?.dates).toBe(1)
    expect(game.getState().relationships.kai?.knownOthers).toContain('nova')
    expect(game.getState().game.dateCount).toBe(1)
    expect(painted).toEqual([['nova', 'kai']])
    expect(await kvGet(ACTIVE_DATE_KEY, db)).toBeUndefined()
  })

  it('finishes an interrupted group date into a recap for both', async () => {
    const { store, db, make } = setup()
    const r = await store.getState().startGroup(['nova', 'kai'], 'arcade')
    await waitFor(() => store.getState().running === null, 'the opening')
    await store.getState().send('Hello.')
    // The app closes: a new store over the same storage.
    const again = make()
    const it = await again.getState().findInterrupted()
    expect(it?.names).toEqual(['Nova Castellanos', 'Kai Okoro'])
    const id = await again.getState().recoverInterrupted()
    expect(id).toBe(r.ok ? r.dateId : -1)
    const record = await getDate(id!, db)
    expect(record?.outcome).toBe('ended')
    expect(Object.keys(record?.recap?.perCharacter ?? {}).sort()).toEqual(['kai', 'nova'])
  })

  it('refuses one character', async () => {
    const { store } = setup()
    expect(await store.getState().startGroup(['nova'], 'arcade')).toEqual({ ok: false, reason: 'missing' })
    expect(await store.getState().startGroup(['nova', 'nobody'], 'arcade')).toEqual({ ok: false, reason: 'missing' })
  })
})
