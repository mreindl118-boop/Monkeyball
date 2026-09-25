// Phase 5: the date store starts art for tiers the moment they unlock (exactly once each), without
// waiting on it.
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_CHARACTERS, BUNDLED_SETS } from '../data/bundled'
import { CrushDB } from '../db/db'
import type { DateLlm } from '../engine/dateFlow'
import { newRelationship } from '../engine/relationship'
import type { JudgeResult, PlayerProfile, RosterEntry, Settings, TierNumber } from '../types'
import { createDateStore } from './date'
import { defaultSettings } from './defaults'
import { createGameStore } from './game'

const open: CrushDB[] = []
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

const judge = (delta: number): JudgeResult => ({ delta, trustDelta: 0, hits: [], mood: 'warm', hint: '', jealousy: false, breach: false })

const llm = (delta: number): DateLlm => ({
  story: async ({ onDelta }) => {
    onDelta('"Hi."')
    return { text: '"Hi."', refused: false }
  },
  judge: async () => ({ value: judge(delta), ok: true }),
  suggestions: async ({ keys }) => Object.fromEntries(keys.map((k) => [k, 'x'])),
  memory: async () => 'A good night.',
})

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 2))
  }
}

describe('the date store and tier art', () => {
  it('calls onUnlock once per newly unlocked tier, and never again for it', async () => {
    const db = new CrushDB(`date-art-${Date.now()}`)
    open.push(db)
    const game = createGameStore(db)
    await game.getState().load()
    await game.getState().saveRel({ ...newRelationship('nova'), affection: 15, trust: 30 })
    const unlocks: [string, TierNumber[]][] = []
    const settings: Settings = { ...defaultSettings(), activeSets: ['afterhours'], dateLength: 3, gainCap: 25 }
    const store = createDateStore({
      llm: () => llm(6),
      db,
      game,
      settings: { getState: () => ({ settings, profile: PROFILE }) },
      roster,
      now: () => 1_700_000_000_000,
      rng: () => 0.5,
      art: {
        onUnlock: (id, tiers) => {
          unlocks.push([id, tiers])
          // A slow or failing painter can't hold the date up.
          throw new Error('painter exploded')
        },
      },
    })
    // Favorite venue +3 and a loved gift +5: 15 -> 23 crosses 20 at the opening.
    const r = await store.getState().start('nova', 'record-store', 'rare-vinyl')
    expect(r.ok).toBe(true)
    await waitFor(() => store.getState().running === null)
    expect(game.getState().relationships.nova?.tiersUnlocked).toEqual([1])
    expect(unlocks).toEqual([['nova', [1]]])
    // Three turns of +6, held to the date's +25: 40, and tier 2 unlocks once.
    for (const m of ['one', 'two', 'three']) {
      await store.getState().send(m)
      await waitFor(() => store.getState().running === null)
    }
    await waitFor(() => store.getState().session?.status === 'ended' || store.getState().session?.status === 'awaiting-player')
    const rel = game.getState().relationships.nova!
    expect(rel.tiersUnlocked).toEqual([1, 2])
    const all = unlocks.flatMap(([, t]) => t)
    expect(all).toEqual(rel.tiersUnlocked)
    expect(new Set(all).size).toBe(all.length)
    expect(unlocks.every(([id]) => id === 'nova')).toBe(true)
  })
})
