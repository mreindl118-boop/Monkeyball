import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_CHARACTERS, BUNDLED_SETS } from '../data/bundled'
import { CrushDB } from '../db/db'
import { getDate, kvGet } from '../db/repo'
import type { DateLlm } from '../engine/dateFlow'
import { newRelationship } from '../engine/relationship'
import type { AgreementResult, GameState, JudgeResult, PlayerProfile, Relationship, RosterEntry, Settings } from '../types'
import { activeRelations, createDateStore } from './date'
import { defaultSettings } from './defaults'
import { createGameStore } from './game'

// ---------------------------------------------------------------------------
// Fixtures (Phase 4: Define the relationship, the epilogue, the world after a date)

let counter = 0
const open: CrushDB[] = []
function freshDb(): CrushDB {
  const d = new CrushDB(`date-p4-test-${Date.now()}-${counter++}`)
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
const NOW = 1_700_000_000_000

function settingsStore(patch: Partial<Settings> = {}) {
  const settings: Settings = { ...defaultSettings(), activeSets: ['afterhours'], dateLength: 3, suggestions: false, ...patch }
  return { getState: () => ({ settings, profile: PROFILE }) }
}

const judgeOf = (over: Partial<JudgeResult> = {}): JudgeResult => ({
  delta: 1,
  trustDelta: 0,
  hits: [],
  mood: 'warm',
  hint: 'She smiles',
  jealousy: false,
  breach: false,
  ...over,
})

function fakeLlm(opts: { judge?: () => JudgeResult; agreement?: AgreementResult; agreementGate?: Promise<void> } = {}) {
  const calls = { story: 0, judge: 0, agreement: 0, memory: 0 }
  const stories: string[] = []
  const llm: DateLlm = {
    story: async ({ system, onDelta }) => {
      calls.story++
      stories.push(system)
      const text = `*Nova grins.* "Reply ${calls.story}."`
      onDelta(text)
      return { text, refused: false }
    },
    judge: async () => {
      calls.judge++
      return { value: opts.judge ? opts.judge() : judgeOf(), ok: true }
    },
    suggestions: async () => null,
    memory: async () => {
      calls.memory++
      return 'A good night.'
    },
    agreement: async () => {
      calls.agreement++
      if (opts.agreementGate) await opts.agreementGate
      return { value: opts.agreement ?? { agreement: 'none', accepted: false, terms: '', trustDelta: 0 }, ok: true }
    },
  }
  return { llm, calls, stories }
}

async function setup(
  rels: Partial<Relationship>[],
  opts: Parameters<typeof fakeLlm>[0] = {},
  rng: () => number = () => 0.5,
  settings: Partial<Settings> = {},
) {
  const db = freshDb()
  const game = createGameStore(db)
  await game.getState().load()
  for (const r of rels) await game.getState().saveRel({ ...newRelationship(r.characterId!), ...r } as Relationship)
  const fake = fakeLlm(opts)
  const store = createDateStore({
    llm: () => fake.llm,
    db,
    game,
    settings: settingsStore(settings),
    roster,
    now: () => NOW,
    rng,
    online: () => true,
  })
  return { db, game, fake, store }
}

async function waitFor(check: () => boolean, what: string, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 2))
  }
}

type Store = Awaited<ReturnType<typeof setup>>['store']

async function started(store: Store, venue = 'arcade') {
  const r = await store.getState().start('nova', venue)
  expect(r.ok).toBe(true)
  await waitFor(() => store.getState().running === null, 'the opening')
}

// ---------------------------------------------------------------------------

describe('useDate: Define the relationship', () => {
  it('opens the talk, flags its turns, closes it with the Agreement prompt and keeps the result', async () => {
    const { store, db, game, fake } = await setup(
      [{ characterId: 'nova', affection: 45, trust: 30, dates: 1, lastDateAt: 1 }],
      { agreement: { agreement: 'exclusive', accepted: true, terms: 'Just us, trouble.', trustDelta: 3 } },
      () => 0.5,
      { dateLength: 5 },
    )
    await started(store)
    expect(await store.getState().openDtr('exclusive')).toBe(true)
    let s = store.getState().session!
    expect(s.record.dtr).toMatchObject({ requested: 'exclusive', by: 'player' })
    expect((await getDate(s.record.id!, db))?.dtr?.requested).toBe('exclusive')

    expect(await store.getState().send('I only want to see you.')).toBe(true)
    s = store.getState().session!
    expect(s.record.turns.find((t) => t.role === 'player')?.dtr).toBe(true)
    // The story answered the request.
    expect(fake.stories.at(-1)).toContain('asking for exclusive')

    await store.getState().closeDtr()
    s = store.getState().session!
    expect(fake.calls.agreement).toBe(1)
    expect(s.record.dtr?.closedAt).toBe(NOW)
    expect(s.record.dtr?.result).toMatchObject({ agreement: 'exclusive', accepted: true })
    expect(s.rel.agreement).toMatchObject({ type: 'exclusive', terms: 'Just us, trouble.' })
    expect(game.getState().relationships.nova?.agreement.type).toBe('exclusive')
    expect((await getDate(s.record.id!, db))?.dtr?.result?.terms).toBe('Just us, trouble.')
    // The talk can't open twice on one date, and the date goes on.
    expect(await store.getState().openDtr('poly')).toBe(false)
    expect(s.status).toBe('awaiting-player')
  })

  it('refuses before Friend stage', async () => {
    const { store } = await setup([{ characterId: 'nova', affection: 20, dates: 1 }])
    await started(store)
    expect(await store.getState().openDtr('exclusive')).toBe(false)
    expect(store.getState().session?.record.dtr).toBeUndefined()
  })

  it('lets the character bring it up, and Not now puts it away', async () => {
    // Friend, trust 50+, three dates, no agreement, and a roll under 25%.
    const { store } = await setup([{ characterId: 'nova', affection: 50, trust: 60, dates: 3, lastDateAt: 1 }], {}, () => 0.1)
    await started(store)
    expect(store.getState().session?.dtrOffer).toBe('open')
    store.getState().dismissDtrOffer()
    expect(store.getState().dtrOfferDismissed).toBe(true)
    // Asked for later from the button, it's the player's talk.
    expect(await store.getState().openDtr('exclusive')).toBe(true)
    expect(store.getState().session?.record.dtr?.by).toBe('player')
  })

  it("takes the character's offer as theirs", async () => {
    const { store } = await setup([{ characterId: 'nova', affection: 50, trust: 60, dates: 3, lastDateAt: 1 }], {}, () => 0.1)
    await started(store)
    expect(await store.getState().openDtr('open')).toBe(true)
    expect(store.getState().session?.record.dtr).toMatchObject({ requested: 'open', by: 'character' })
    expect(store.getState().session?.dtrOffer).toBeUndefined()
  })

  it('makes it the player\'s ask when they pick something other than what the character wanted', async () => {
    const { store } = await setup([{ characterId: 'nova', affection: 50, trust: 60, dates: 3, lastDateAt: 1 }], {}, () => 0.1)
    await started(store)
    expect(store.getState().session?.dtrOffer).toBe('open')
    expect(await store.getState().openDtr('exclusive')).toBe(true)
    expect(store.getState().session?.record.dtr).toMatchObject({ requested: 'exclusive', by: 'player' })
  })

  it('End date while the talk is closing waits for the Agreement answer instead of asking twice', async () => {
    let release: () => void = () => undefined
    const agreementGate = new Promise<void>((r) => {
      release = r
    })
    const { store, game, fake } = await setup(
      [{ characterId: 'nova', affection: 45, trust: 30, dates: 1, lastDateAt: 1 }],
      { agreement: { agreement: 'casual', accepted: true, terms: 'No labels.', trustDelta: 1 }, agreementGate },
      () => 0.5,
      { dateLength: 5 },
    )
    await started(store)
    await store.getState().openDtr('casual')
    await store.getState().send('Can we keep it easy?')
    const closing = store.getState().closeDtr()
    await waitFor(() => fake.calls.agreement === 1, 'the Agreement call')
    const ending = store.getState().end()
    release()
    await closing
    expect(await ending).not.toBeNull()
    expect(fake.calls.agreement).toBe(1)
    expect(game.getState().relationships.nova?.agreement.type).toBe('casual')
    expect(store.getState().lastRecord?.dtr?.result?.agreement).toBe('casual')
  })

  it('settles an open talk when the date is ended', async () => {
    const { store, game, fake } = await setup(
      [{ characterId: 'nova', affection: 45, trust: 30, dates: 1, lastDateAt: 1 }],
      { agreement: { agreement: 'casual', accepted: true, terms: 'No labels.', trustDelta: 1 } },
      () => 0.5,
      { dateLength: 5 },
    )
    await started(store)
    await store.getState().openDtr('casual')
    await store.getState().send('Can we keep it easy?')
    const id = await store.getState().end()
    expect(id).not.toBeNull()
    expect(fake.calls.agreement).toBe(1)
    const record = store.getState().lastRecord!
    expect(record.recap?.perCharacter.nova?.agreementAfter?.type).toBe('casual')
    expect(game.getState().relationships.nova?.agreement.type).toBe('casual')
  })
})

describe('useDate: the epilogue', () => {
  const won: Partial<Relationship> = {
    characterId: 'nova',
    affection: 100,
    trust: 70,
    dates: 6,
    lastDateAt: 1,
    connection: 12,
  }

  it('only starts at 100 affection', async () => {
    const { store } = await setup([{ ...won, affection: 90 }])
    expect(await store.getState().startEpilogue('nova')).toEqual({ ok: false, reason: 'not-ready' })
    expect(await store.getState().startEpilogue('nobody')).toEqual({ ok: false, reason: 'missing' })
  })

  it('writes the autosave, plays six turns at their favorite venue and records the ending', async () => {
    const { store, db, game } = await setup([won])
    const r = await store.getState().startEpilogue('nova')
    expect(r.ok).toBe(true)
    await waitFor(() => store.getState().running === null, 'the opening')
    const slot = await db.saves.get('auto-epilogue-nova')
    expect(slot?.label).toBe("Before Nova's epilogue")
    // The slot is from before the epilogue: Nova hasn't had an ending in it.
    expect(slot?.data.relationships.find((x) => x.characterId === 'nova')?.ending).toBeUndefined()

    let s = store.getState().session!
    expect(s.record).toMatchObject({ kind: 'epilogue', maxTurns: 6, venueId: 'record-store', endingType: 'good' })
    for (let i = 0; i < 6; i++) expect(await store.getState().send(`Line ${i}`)).toBe(true)
    await waitFor(() => store.getState().finishedId != null, 'the end')
    s = store.getState().session!
    expect(s.status).toBe('ended')
    expect(game.getState().relationships.nova?.ending?.type).toBe('good')
    expect(game.getState().game.endingsSeen.nova).toEqual(['good'])
    expect((await kvGet<GameState>('game', db))?.endingsSeen.nova).toEqual(['good'])
  })

  it('refuses while another date is open', async () => {
    const { store } = await setup([won])
    await started(store)
    expect(await store.getState().startEpilogue('nova')).toMatchObject({ ok: false, reason: 'busy' })
  })
})

describe('useDate: reaching 100 and the world after a date', () => {
  it('writes "Before Nova\'s epilogue" the first time she reaches 100', async () => {
    const { store, db } = await setup([{ characterId: 'nova', affection: 88, trust: 60, dates: 4, lastDateAt: 1 }], {
      judge: () => judgeOf({ delta: 10 }),
    })
    await started(store, 'record-store')
    for (let i = 0; i < 3; i++) await store.getState().send(`Line ${i}`)
    await waitFor(() => store.getState().finishedId != null, 'the end')
    expect(store.getState().session?.rel.affection).toBe(100)
    // Written after the date has landed.
    let slot = await db.saves.get('auto-epilogue-nova')
    for (let i = 0; !slot && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 5))
      slot = await db.saves.get('auto-epilogue-nova')
    }
    expect(slot?.label).toBe("Before Nova's epilogue")
    expect(slot?.data.relationships.find((x) => x.characterId === 'nova')?.affection).toBe(100)
  })

  it('does not write it for a date that stays under 100', async () => {
    const { store, db } = await setup([{ characterId: 'nova', affection: 40, dates: 1, lastDateAt: 1 }])
    await started(store)
    await store.getState().end()
    expect(await db.saves.get('auto-epilogue-nova')).toBeUndefined()
  })

  it('hands what the date set off to the game store: betrayals elsewhere and the news', async () => {
    // Imani (Nova's friend) is exclusive with the player and hears about the date.
    const { store, db, game } = await setup(
      [
        { characterId: 'nova', affection: 30, dates: 1, lastDateAt: 1 },
        { characterId: 'imani', affection: 50, trust: 50, dates: 2, lastDateAt: 5, agreement: { type: 'exclusive', terms: 'Only us.', madeAt: 10 } },
      ],
      {},
      () => 0.1,
    )
    await started(store)
    await store.getState().end()
    const imani = game.getState().relationships.imani!
    expect(imani.knownOthers).toContain('nova')
    expect(imani.betrayals).toHaveLength(1)
    expect(imani.trust).toBeLessThan(50)
    const news = game.getState().game.news
    expect(news.some((n) => n.kind === 'betrayal' && n.characterIds.includes('imani'))).toBe(true)
    expect((await kvGet<GameState>('game', db))?.news.length).toBe(news.length)
    expect(store.getState().lastRecord?.recap?.world?.betrayals[0]?.characterId).toBe('imani')
  })
})

describe('activeRelations', () => {
  it('lists each pair once, only between characters in play', () => {
    const data = { sets: [...BUNDLED_SETS], entries }
    const rels = activeRelations(data, ['afterhours'])
    const keys = rels.map((r) => `${r.a}|${r.b}|${r.kind}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(rels).toContainEqual(expect.objectContaining({ a: 'kai', b: 'nova', kind: 'ex' }))
    const afterhours = new Set(BUNDLED_SETS.find((s) => s.id === 'afterhours')!.characters)
    for (const r of rels) {
      expect(afterhours.has(r.a) && afterhours.has(r.b)).toBe(true)
      expect(r.a < r.b).toBe(true)
    }
    expect(activeRelations(data, [])).toEqual([])
  })
})
