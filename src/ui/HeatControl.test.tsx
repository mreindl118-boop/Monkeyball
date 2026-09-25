// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../store/defaults'
import { useSettings } from '../store/settings'
import type { ConnectionPreset } from '../types'
import { HeatControl, PROVIDER_POLICY_NOTE } from './HeatControl'

function storyOn(preset: ConnectionPreset) {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.connection.story = { preset, model: '' }
  useSettings.setState({ settings })
}

beforeEach(() => storyOn('claude'))
afterEach(cleanup)

describe('HeatControl provider note', () => {
  it('shows under heat 4 and 5 when Claude or ChatGPT writes the story', () => {
    const { rerender } = render(<HeatControl value={3} onChange={() => undefined} />)
    expect(screen.queryByText(PROVIDER_POLICY_NOTE)).toBeNull()
    rerender(<HeatControl value={4} onChange={() => undefined} />)
    expect(screen.getByText(PROVIDER_POLICY_NOTE)).toBeTruthy()
    storyOn('chatgpt')
    rerender(<HeatControl value={5} onChange={() => undefined} />)
    expect(screen.getByText(PROVIDER_POLICY_NOTE)).toBeTruthy()
  })

  it('stays away for local, OpenRouter and Grok stories', () => {
    for (const preset of ['ollama', 'openrouter', 'grok'] as const) {
      storyOn(preset)
      render(<HeatControl value={5} onChange={() => undefined} />)
      expect(screen.queryByText(PROVIDER_POLICY_NOTE)).toBeNull()
      cleanup()
    }
  })
})
