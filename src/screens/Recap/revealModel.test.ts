import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { bundledEntry } from '../../data/bundled'
import { db } from '../../db/db'
import type { DateRecord } from '../../types'
import { markArtShown, revealItems, sessionKey, sessionShown, shownFor } from './revealModel'

const nova = bundledEntry('nova')!.character

afterEach(async () => {
  sessionShown.clear()
  await db.dates.clear()
})

describe('what develops on a recap', () => {
  it('shows the tiers unlocked on the date, lowest first, each once', () => {
    const items = revealItems(nova, { kind: 'single' }, [3, 1, 3])
    expect(items.map((i) => i.key)).toEqual(['nova:tier-1', 'nova:tier-3'])
    expect(items[1]).toMatchObject({ title: 'Rain check', kicker: 'Tier 3', place: 'tiers' })
    expect(revealItems(nova, { kind: 'single' }, undefined)).toEqual([])
  })

  it("puts an epilogue's ending art first (it sits near the top of the recap)", () => {
    const items = revealItems(nova, { kind: 'epilogue', endingType: 'good' }, [5])
    expect(items.map((i) => i.key)).toEqual(['nova:ending-good', 'nova:tier-5'])
    expect(items[0]).toMatchObject({ title: 'The good ending', kicker: '', place: 'ending' })
    // No ending art on an ordinary date, even one that reaches 100.
    expect(revealItems(nova, { kind: 'single', endingType: 'good' }, [5]).map((i) => i.place)).toEqual(['tiers'])
  })
})

describe('each reveal plays once', () => {
  it("reads what played from the record and from this session's reveals of that date", () => {
    sessionShown.add(sessionKey(7, 'nova:tier-2'))
    sessionShown.add(sessionKey(8, 'nova:tier-3'))
    const shown = shownFor({ id: 7, artShown: ['nova:tier-1'] }, sessionShown)
    expect([...shown].sort()).toEqual(['nova:tier-1', 'nova:tier-2'])
  })

  it('remembers a played reveal on the date record', async () => {
    const rec: DateRecord = {
      kind: 'single',
      characterIds: ['nova'],
      venueId: 'record-store',
      startedAt: 1,
      maxTurns: 10,
      turns: [],
      totals: {},
      artShown: ['nova:tier-1'],
    }
    const id = (await db.dates.add(rec)) as number
    await markArtShown(id, ['nova:tier-2'])
    await markArtShown(id, ['nova:tier-2'])
    expect((await db.dates.get(id))?.artShown).toEqual(['nova:tier-1', 'nova:tier-2'])
    expect(sessionShown.has(sessionKey(id, 'nova:tier-2'))).toBe(true)
    // A date that isn't stored (or no storage at all) still stops replaying for the session.
    await markArtShown(undefined, ['nova:tier-4'])
    expect(shownFor({ artShown: [] }, sessionShown).has('nova:tier-4')).toBe(true)
  })
})
