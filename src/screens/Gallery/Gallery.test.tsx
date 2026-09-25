// @vitest-environment jsdom
// The gallery screens against the real art modules (fake IndexedDB, no bundled art files): the
// character list, a character's tiers with their locks, which endings show, and the viewer.
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { newRelationship } from '../../engine/relationship'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { useRoster } from '../../store/roster'
import { defaultSettings } from '../../store/defaults'
import { useSettings } from '../../store/settings'
import type { PlayerProfile, Relationship } from '../../types'
import Gallery from './Gallery'

const man: PlayerProfile = { name: 'Robin', gender: 'man', pronouns: 'he/him', bodyNotes: '', relationshipStyle: 'figuring' }

beforeAll(async () => {
  await useRoster.getState().load()
})

beforeEach(() => {
  useSettings.setState({ settings: { ...defaultSettings(), activeSets: ['afterhours'] }, profile: man, loaded: true })
})

afterEach(() => {
  cleanup()
  useGame.setState({ relationships: {} })
})

function rel(id: string, patch: Partial<Relationship>): Relationship {
  return { ...newRelationship(id), ...patch }
}

function show(id?: string) {
  act(() => {
    useNav.setState({ screen: id ? { name: 'gallery', id } : { name: 'gallery' }, stack: [] })
  })
  return render(<Gallery />)
}

describe('#/gallery', () => {
  it("lists the active sets' characters with tiers unlocked out of five", async () => {
    useGame.setState({ loaded: true, relationships: { nova: rel('nova', { affection: 45, tiersUnlocked: [1, 2] }) } })
    show()
    const row = await screen.findByRole('button', { name: /Nova Castellanos/ })
    expect(within(row).getByLabelText('2 of 5 unlocked').textContent).toBe('2/5')
    expect(screen.getByRole('heading', { name: 'Afterhours' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Favorites' }))
    expect(screen.getByText('No favorites yet')).toBeTruthy()
  })
})

describe('#/gallery/:id', () => {
  it('shows unlocked tiers, what unlocks the rest, and the endings that can still happen', async () => {
    useGame.setState({ loaded: true, relationships: { nova: rel('nova', { affection: 45, tiersUnlocked: [1, 2] }) } })
    show('nova')
    const tiers = await screen.findByRole('region', { name: 'Tiers' })
    expect(within(tiers).getByRole('button', { name: /Tier 1: Behind the decks/ })).toBeTruthy()
    expect(within(tiers).getByRole('button', { name: /Tier 2: Afterhours/ })).toBeTruthy()
    expect(within(tiers).getByText('Rain check')).toBeTruthy()
    expect(within(tiers).getByText('Unlocks at 60')).toBeTruthy()
    expect(within(tiers).getByText('Unlocks at 100')).toBeTruthy()

    const endings = screen.getByRole('region', { name: 'Endings' })
    expect(within(endings).getByText('The good ending')).toBeTruthy()
    expect(within(endings).getByText('The open ending')).toBeTruthy()
    // A locked ending says when it unlocks, without repeating "Ending".
    expect(within(endings).getAllByText('Unlocks when it plays').length).toBeGreaterThanOrEqual(2)
    expect(within(endings).queryByText(/^Ending: /)).toBeNull()
    // Nova dates openly, not as a polycule; nothing broke, so no reconciliation.
    expect(within(endings).queryByText('The polycule ending')).toBeNull()
    expect(within(endings).queryByText('The reconciliation ending')).toBeNull()

    fireEvent.click(within(tiers).getByRole('button', { name: /Tier 2: Afterhours/ }))
    const viewer = await screen.findByRole('dialog', { name: 'Nova Castellanos, Afterhours' })
    expect(within(viewer).getByText('2 of 2')).toBeTruthy()
    fireEvent.click(within(viewer).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('marks tiers 3 to 5 friendship-locked on a friend route, with no endings', async () => {
    // Sasha is into women; the player is a man, in realistic mode.
    useGame.setState({ loaded: true, relationships: { sasha: rel('sasha', { affection: 45, tiersUnlocked: [1, 2] }) } })
    show('sasha')
    const tiers = await screen.findByRole('region', { name: 'Tiers' })
    expect(within(tiers).getAllByText('Friendship-locked')).toHaveLength(3)
    expect(screen.queryByRole('region', { name: 'Endings' })).toBeNull()
  })

  it('shows an ending once it has played', async () => {
    useGame.setState({
      loaded: true,
      relationships: { kai: rel('kai', { affection: 100, tiersUnlocked: [1, 2, 3, 4, 5], ending: { type: 'bitter', playedAt: 1 } }) },
    })
    show('kai')
    const endings = await screen.findByRole('region', { name: 'Endings' })
    expect(within(endings).getByRole('button', { name: /Ending: The bitter ending/ })).toBeTruthy()
    expect(within(endings).getByText('The good ending')).toBeTruthy()
  })
})
