// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../store/defaults'
import { useSettings } from '../../store/settings'
import ConnectionSetup from './ConnectionSetup'
import { peekOnboardingProblem, setOnboardingProblem } from './lastCheck'

const PROBLEM = { kind: 'other' as const, message: 'No key for Claude yet.', fix: 'Add your Claude key.' }

beforeEach(() => {
  useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS) })
  setOnboardingProblem(null)
})
afterEach(cleanup)

/** Suspends the first time it renders, so React throws that whole render away and tries again. */
function makeSuspendOnce() {
  let resolve!: () => void
  const gate = new Promise<void>((r) => {
    resolve = r
  })
  let ready = false
  void gate.then(() => {
    ready = true
  })
  function SuspendOnce() {
    if (!ready) throw gate
    return null
  }
  return { SuspendOnce, release: () => resolve() }
}

describe('ConnectionSetup and the onboarding check', () => {
  it("shows the quiet check's problem", async () => {
    setOnboardingProblem(PROBLEM)
    render(<ConnectionSetup />)
    const note = await screen.findByRole('status')
    expect(note.textContent).toContain('No key for Claude yet.')
    expect(note.textContent).toContain('Set up a provider below')
    // Shown once: a later visit starts without it.
    expect(peekOnboardingProblem()).toBeNull()
  })

  it('keeps the problem when React throws the first render away (the phase 1 e2e flake)', async () => {
    setOnboardingProblem(PROBLEM)
    const { SuspendOnce, release } = makeSuspendOnce()
    render(
      <Suspense fallback={<p>One moment</p>}>
        <ConnectionSetup />
        <SuspendOnce />
      </Suspense>,
    )
    // The first render of the screen was discarded with the suspended boundary.
    expect(screen.getByText('One moment')).toBeTruthy()
    await act(async () => {
      release()
      await Promise.resolve()
    })
    await screen.findByRole('heading', { name: 'Connect a model' })
    const note = await screen.findByRole('status')
    expect(note.textContent).toContain('Set up a provider below')
    expect(peekOnboardingProblem()).toBeNull()
  })
})
