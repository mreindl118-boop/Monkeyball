// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testConnection } from '../../llm/diagnose'
import { DEFAULT_SETTINGS } from '../../store/defaults'
import { useSettings } from '../../store/settings'
import type { ConnectionSettings } from '../../types'
import { ConnectionForm } from './ConnectionForm'
import { useModelLists } from './modelLists'

vi.mock('../../llm/diagnose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../llm/diagnose')>()),
  testConnection: vi.fn(),
}))

vi.mock('../../llm/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../llm/client')>()),
  listModels: vi.fn(async () => {
    throw new Error('offline')
  }),
}))

const OPENAI_MODELS = ['whisper-1', 'gpt-4o', 'gpt-5', 'gpt-5-mini', 'dall-e-3']

beforeEach(() => {
  useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS) })
  useModelLists.setState({ lists: {}, ready: {} })
  vi.mocked(testConnection).mockReset()
})
afterEach(cleanup)

const conn = (): ConnectionSettings => useSettings.getState().settings.connection

describe('ConnectionForm', () => {
  it('shows Claude, ChatGPT and Grok first, then the other providers', () => {
    render(<ConnectionForm idPrefix="t" />)
    const heads = screen.getAllByRole('button', { expanded: false }).map((b) => b.textContent ?? '')
    expect(heads[0]).toMatch(/^ChatGPT/)
    expect(heads[1]).toMatch(/^Grok/)
    expect(heads[2]).toMatch(/^Other providers/)
    // Claude writes the story by default, so its card starts open, asking for a key.
    const claude = screen.getByRole('button', { name: /^Claude/, expanded: true })
    expect(claude.textContent).toMatch(/Needs a key/)
    expect(screen.getByLabelText('Claude API key')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'console.anthropic.com' })).toBeTruthy()
    const key = screen.getByLabelText('Claude API key')
    const hint = document.getElementById(key.getAttribute('aria-describedby')?.split(' ')[0] ?? '')
    expect(hint?.textContent).toMatch(/Stored only on this device/)
    expect(screen.getByRole('radio', { name: 'Low' }).getAttribute('aria-checked')).toBe('true')
    // Opus 5 takes no temperature.
    expect(screen.getByText('Not used by this model')).toBeTruthy()
  })

  it('pick ChatGPT, paste the key, test: both roles move to it', async () => {
    vi.mocked(testConnection).mockResolvedValue({
      ok: true,
      models: OPENAI_MODELS,
      steps: [{ label: 'List models', ok: true, detail: 'Found 5 models.' }],
    })
    render(<ConnectionForm idPrefix="t" />)
    fireEvent.click(screen.getByRole('button', { name: /^ChatGPT/ }))
    fireEvent.change(screen.getByLabelText('ChatGPT API key'), { target: { value: 'sk-test' } })
    expect(conn().providers.chatgpt.apiKey).toBe('sk-test')
    expect(conn().providers.claude.apiKey).toBe('')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test connection to ChatGPT' }))
    })
    expect(vi.mocked(testConnection).mock.calls[0][1]).toMatchObject({ preset: 'chatgpt' })
    expect(conn().story).toEqual({ preset: 'chatgpt', model: 'gpt-5' })
    expect(conn().judge).toEqual({ preset: 'same', model: 'gpt-5-mini' })
    expect(screen.getByRole('button', { name: /^ChatGPT/ }).textContent).toMatch(/Ready/)
    expect(screen.getByText('Connected')).toBeTruthy()

    // The story picker now offers ChatGPT's chat models only.
    const story = screen.getByRole('group', { name: 'Story model' })
    const model = within(story).getByLabelText('Model') as HTMLSelectElement
    expect(model.value).toBe('gpt-5')
    const options = [...model.options].map((o) => o.value)
    expect(options).toEqual(['gpt-4o', 'gpt-5', 'gpt-5-mini'])
  })

  it('shows the test problem with its fix', async () => {
    vi.mocked(testConnection).mockResolvedValue({
      ok: false,
      models: [],
      steps: [{ label: 'List models', ok: false, detail: "Anthropic didn't accept the API key." }],
      problem: { kind: 'auth', message: "Anthropic didn't accept the API key.", fix: 'Check your Anthropic API key at console.anthropic.com.' },
    })
    render(<ConnectionForm idPrefix="t" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test connection to Claude' }))
    })
    expect(screen.getByRole('alert').textContent).toMatch(/console\.anthropic\.com/)
  })

  it('keeps the Wi-Fi choice for local servers and rewrites the address', () => {
    render(<ConnectionForm idPrefix="t" />)
    fireEvent.click(screen.getByRole('button', { name: /^Other providers/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Ollama/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'PC on my Wi-Fi' }))
    fireEvent.change(screen.getByLabelText("Your PC's address"), { target: { value: '192.168.1.20' } })
    expect(conn().providers.ollama.baseUrl).toBe('http://192.168.1.20:11434/v1')
    expect(screen.getByText(/OLLAMA_HOST=0\.0\.0\.0/)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'On this device' }))
    expect(conn().providers.ollama.baseUrl).toBe('http://127.0.0.1:11434/v1')
    expect(screen.getByText(/Termux/)).toBeTruthy()
  })

  it('lets the judge run on another provider', () => {
    render(<ConnectionForm idPrefix="t" />)
    const judge = screen.getByRole('group', { name: 'Judge model' })
    fireEvent.change(within(judge).getByLabelText('Provider'), { target: { value: 'grok' } })
    expect(conn().judge).toEqual({ preset: 'grok', model: '' })
    expect(conn().story.preset).toBe('claude')
    fireEvent.change(within(judge).getByLabelText('Model'), { target: { value: 'grok-4-fast-non-reasoning' } })
    expect(conn().judge).toEqual({ preset: 'grok', model: 'grok-4-fast-non-reasoning' })
  })
})
