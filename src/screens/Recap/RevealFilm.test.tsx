// @vitest-environment jsdom
// The recap's reveal: new tiers develop one after another, a tap shows one at once, and a reveal
// that has played stays developed on the next visit.
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtSlot } from '../../art/types'
import { bundledEntry } from '../../data/bundled'
import { db } from '../../db/db'
import type { DateRecord } from '../../types'
import { RevealFilm } from './RevealFilm'
import { revealItems, sessionShown } from './revealModel'
import { useRevealQueue } from './useRevealQueue'

vi.mock('../../art/resolve', () => ({
  useArt: (slot: ArtSlot | null) => ({ art: slot ? { source: 'placeholder', key: 'x' } : null, loading: false, refresh: () => {} }),
}))

vi.mock('../../art/generate', () => ({
  useArtJob: () => ({ generating: false }),
}))

const nova = bundledEntry('nova')!.character

afterEach(async () => {
  cleanup()
  sessionShown.clear()
  await db.dates.clear()
})

function Recap({ record }: { record: DateRecord }) {
  const items = revealItems(nova, record, record.recap?.perCharacter.nova?.tiers)
  const queue = useRevealQueue(record, items)
  return (
    <ul>
      {items.map((item) => (
        <li key={item.key} data-key={item.key}>
          <RevealFilm character={nova} item={item} state={queue.stateOf(item.key)} onDone={queue.done} />
        </li>
      ))}
    </ul>
  )
}

function states(): string[] {
  return Array.from(document.querySelectorAll('figure[data-state]')).map((f) => (f as HTMLElement).dataset.state ?? '')
}

async function storedRecord(): Promise<DateRecord> {
  const rec: DateRecord = {
    kind: 'single',
    characterIds: ['nova'],
    venueId: 'record-store',
    startedAt: 1,
    maxTurns: 10,
    turns: [],
    totals: {},
    recap: {
      perCharacter: {
        nova: {
          affectionBefore: 15,
          affectionAfter: 41,
          trustBefore: 0,
          trustAfter: 5,
          stageBefore: 'stranger',
          stageAfter: 'friend',
          traits: [],
          secrets: [],
          rumors: [],
          tiers: [1, 2],
          betrayals: [],
          gossip: [],
          left: false,
        },
      },
    },
  }
  rec.id = (await db.dates.add(rec)) as number
  return rec
}

describe('the recap reveal', () => {
  it('develops the new tiers one after another; a tap shows one at once', async () => {
    const record = await storedRecord()
    render(<Recap record={record} />)
    // Placeholder art develops too: the print shows the silhouette card.
    expect(screen.getAllByRole('img', { name: /Placeholder art/ })).toHaveLength(2)
    expect(states()).toEqual(['developing', 'waiting'])
    fireEvent.click(screen.getByRole('button', { name: /Developing Behind the decks/ }))
    expect(states()).toEqual(['done', 'developing'])
    fireEvent.click(screen.getByRole('button', { name: /Developing Afterhours/ }))
    expect(states()).toEqual(['done', 'done'])
    await waitFor(async () => expect((await db.dates.get(record.id!))?.artShown).toEqual(['nova:tier-1', 'nova:tier-2']))
  })

  it('plays each unlock once: a later visit shows the prints developed', async () => {
    const record = await storedRecord()
    const first = render(<Recap record={record} />)
    fireEvent.click(screen.getByRole('button', { name: /Developing Behind the decks/ }))
    first.unmount()
    // Coming back (the record in memory is the same, older object): the first print stays developed.
    render(<Recap record={record} />)
    expect(states()).toEqual(['done', 'developing'])
    cleanup()
    // After a restart the record read back from storage says so too.
    sessionShown.clear()
    await waitFor(async () => expect((await db.dates.get(record.id!))?.artShown).toEqual(['nova:tier-1']))
    render(<Recap record={(await db.dates.get(record.id!))!} />)
    expect(states()).toEqual(['done', 'developing'])
  })
})
