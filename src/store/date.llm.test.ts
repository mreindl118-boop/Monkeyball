// The app's model calls for a date: which role and kind each DateLlm call uses.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionSettings } from '../types'

const calls: { fn: string; opts: Record<string, unknown> }[] = []

vi.mock('../llm/index', async (importOriginal) => {
  const real = await importOriginal<typeof import('../llm/index')>()
  const route = { preset: 'ollama', provider: 'openai', baseUrl: 'http://x', model: 'm' }
  return {
    ...real,
    streamChat: vi.fn(async (opts: Record<string, unknown> & { onDelta?: (d: string, f: string) => void }) => {
      calls.push({ fn: 'streamChat', opts })
      opts.onDelta?.('Hi', 'Hi')
      return { text: 'Hi', refused: false, truncated: false, route, model: 'm' }
    }),
    chat: vi.fn(async (opts: Record<string, unknown>) => {
      calls.push({ fn: 'chat', opts })
      return { text: 'A memory.', refused: false, truncated: false, route, model: 'm' }
    }),
    jsonChat: vi.fn(async (opts: Record<string, unknown> & { coerce: (v: unknown) => unknown; fallback: unknown }) => {
      calls.push({ fn: 'jsonChat', opts })
      if (opts.kind === 'judge') {
        const value = opts.coerce({ delta: 3, trustDelta: 1, hits: [], mood: 'warm', hint: 'She laughs', jealousy: false, breach: false })
        return { value, ok: true, raw: '' }
      }
      if (opts.kind === 'suggestions') return { value: opts.fallback, ok: false, raw: '' }
      return { value: opts.fallback, ok: false, raw: '' }
    }),
  }
})

const { appDateLlm } = await import('./date')

const conn = { storyTemperature: 0.9 } as unknown as ConnectionSettings
const system = 'SYSTEM'
const messages = [
  { role: 'system' as const, content: system },
  { role: 'user' as const, content: '(The date begins.)' },
]

beforeEach(() => {
  calls.length = 0
})

describe('appDateLlm', () => {
  it('streams the story on the story role and passes the pieces on', async () => {
    const llm = appDateLlm('nova', () => conn)
    const pieces: string[] = []
    const r = await llm.story({ system, messages, onDelta: (p) => pieces.push(p) })
    expect(r).toEqual({ text: 'Hi', refused: false })
    expect(pieces).toEqual(['Hi'])
    expect(calls[0].fn).toBe('streamChat')
    expect(calls[0].opts).toMatchObject({ role: 'story', kind: 'story', debug: { characterId: 'nova' } })
    expect(calls[0].opts.messages).toEqual(messages)
  })

  it('judges on the judge role with the coercer', async () => {
    const llm = appDateLlm('nova', () => conn)
    const r = await llm.judge({ system, messages })
    expect(r.ok).toBe(true)
    expect(r.value.mood).toBe('warm')
    expect(calls[0].opts).toMatchObject({ role: 'judge', kind: 'judge' })
  })

  it('asks for chips on the judge role with a schema, and gives null when unusable', async () => {
    const llm = appDateLlm('nova', () => conn)
    expect(await llm.suggestions({ system, messages, keys: ['sweet', 'flirty', 'bold'] })).toBeNull()
    expect(calls[0].opts).toMatchObject({ role: 'judge', kind: 'suggestions' })
    expect(calls[0].opts.schema).toBeTruthy()
  })

  it('writes the memory on the story role, and adds the system message when missing', async () => {
    const llm = appDateLlm('nova', () => conn)
    expect(await llm.memory({ system, messages: [{ role: 'user', content: 'The date' }] })).toBe('A memory.')
    expect(calls[0].opts).toMatchObject({ role: 'story', kind: 'memory' })
    expect((calls[0].opts.messages as { role: string }[]).map((m) => m.role)).toEqual(['system', 'user'])
  })
})
