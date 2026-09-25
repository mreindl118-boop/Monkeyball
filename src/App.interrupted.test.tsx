// @vitest-environment jsdom
// Boot with a date left open (the Android app restarts on the hub): the app opens the date screen,
// which offers that date's recap.
import 'fake-indexeddb/auto'
import { cleanup, render, screen } from '@testing-library/react'
import { afterAll, describe, expect, it, vi } from 'vitest'
import App from './App'
import { kvSet, putDate } from './db/repo'
import { ACTIVE_DATE_KEY } from './store/date'
import { defaultProfile, defaultSettings } from './store/defaults'
import { useNav } from './store/nav'
import type { DateRecord } from './types'

vi.mock('./llm/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./llm/client')>()),
  listModels: vi.fn(async () => {
    throw new Error('offline')
  }),
}))

afterAll(cleanup)

// jsdom has no scrolling; screens scroll to the top when they open.
window.scrollTo = () => undefined

describe('App boot with an interrupted date', () => {
  it('goes from the hub to the date screen, which offers the recap', async () => {
    await kvSet('settings', { ...defaultSettings(), ageConfirmed: true })
    await kvSet('profile', { ...defaultProfile(), name: 'Robin' })
    const record: DateRecord = {
      kind: 'single',
      characterIds: ['nova'],
      venueId: 'record-store',
      startedAt: 1,
      maxTurns: 10,
      turns: [
        { role: 'character', speaker: 'nova', text: 'Hey.', at: 2 },
        { role: 'player', text: 'Hi.', at: 3 },
        { role: 'character', speaker: 'nova', text: 'So.', at: 4 },
      ],
      totals: { nova: { affection: 5, trust: 1, gained: 5 } },
    }
    const dateId = await putDate(record)
    await kvSet(ACTIVE_DATE_KEY, { dateId, characterId: 'nova' })

    window.history.replaceState({}, '', '#/hub')
    render(<App />)

    await screen.findByText('This date was interrupted', undefined, { timeout: 5000 })
    expect(screen.getByText(/closed partway through your date with Nova, 1 message in/)).toBeTruthy()
    expect(useNav.getState().screen.name).toBe('date')
    expect(window.location.hash).toBe('#/date')
  })
})
