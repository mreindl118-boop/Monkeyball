// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, describe, expect, it, vi } from 'vitest'
import App from './App'
import { kvGet } from './db/repo'
import { useNav } from './store/nav'
import type { PlayerProfile, Settings } from './types'

vi.mock('./llm/diagnose', () => ({
  testConnection: vi.fn(async () => ({
    ok: false,
    models: [],
    steps: [{ label: 'List models', ok: false, detail: 'Nothing answered.' }],
    problem: { kind: 'unreachable', message: 'Nothing answered.', fix: 'Start Ollama.' },
  })),
}))

vi.mock('./llm/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./llm/client')>()),
  listModels: vi.fn(async () => {
    throw new Error('offline')
  }),
}))

afterAll(cleanup)

function navigateByHash(hash: string) {
  act(() => {
    window.history.pushState({}, '', hash)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

describe('App first-launch flow', () => {
  it('gates, onboards, falls back to connection setup, then reaches the hub', async () => {
    window.history.replaceState({}, '', '#/settings')
    render(<App />)

    await screen.findByText('Before you come in')
    expect(window.location.hash).toBe('#/gate')

    // Hash navigation can't skip the gate.
    navigateByHash('#/hub')
    expect(screen.getByText('Before you come in')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: "I'm 18 or older" }))
    await screen.findByText("Who's walking in tonight?", undefined, { timeout: 3000 })
    expect((await kvGet<Settings>('settings'))?.ageConfirmed).toBe(true)

    // Onboarding can't be skipped either.
    navigateByHash('#/debug')
    expect(screen.getByText("Who's walking in tonight?")).toBeTruthy()

    // Name is required.
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    await screen.findByText('Add a name so people know what to call you.')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Robin' } })
    fireEvent.click(screen.getByRole('radio', { name: /Everyone's into you/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))

    // The quiet connection test fails, so connection setup is next.
    await screen.findByText('Connect a model', undefined, { timeout: 3000 })
    expect(screen.getByText('Nothing answered.')).toBeTruthy()
    const profile = await kvGet<PlayerProfile>('profile')
    expect(profile?.name).toBe('Robin')
    expect(profile?.pronouns).toBe('they/them')
    expect((await kvGet<Settings>('settings'))?.orientationMode).toBe('everyone')

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    await screen.findByText('Robin', undefined, { timeout: 3000 })
    expect(useNav.getState().screen.name).toBe('hub')

    // The gallery (Phase 5) opens from its hash, and Back returns to the hub.
    navigateByHash('#/gallery')
    await screen.findByRole('heading', { name: 'Gallery' }, { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText('Robin')
    // A whole first launch plus two lazy screens: allow for a busy machine running every file at once.
  }, 20_000)
})
