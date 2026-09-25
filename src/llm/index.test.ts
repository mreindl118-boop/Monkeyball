import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebug } from '../store/debug'
import { DEFAULT_CONNECTION } from '../store/defaults'
import type { ConnectionSettings } from '../types'
import { resetClaudeCache, setClaudeTransport } from './anthropic'
import { resetJsonModeCache } from './client'
import { coerceJudge, neutralJudge } from './coerce'
import { chat, jsonChat, listModels, refusalBeat, roleTakesTemperature, streamChat } from './index'

interface Seen {
  url: string
  body: Record<string, unknown>
  headers: Headers
}

let claudeSeen: Seen[] = []
let openaiSeen: Seen[] = []

const toSeen = (input: string | URL | Request, init: RequestInit = {}): Seen => ({
  url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
  headers: new Headers(init.headers),
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const claudeMessage = (text: string, patch: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5',
  content: text ? [{ type: 'text', text, citations: null }] : [],
  stop_reason: 'end_turn',
  stop_sequence: null,
  stop_details: null,
  usage: { input_tokens: 1, output_tokens: 1 },
  ...patch,
})

function claudeStream(text: string, stop: Record<string, unknown> = { stop_reason: 'end_turn', stop_sequence: null }) {
  const events = [
    { type: 'message_start', message: { ...claudeMessage(''), stop_reason: null } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: stop, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

function fakes(claude: Response[], openai: Response[]) {
  setClaudeTransport({
    maxRetries: 0,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      claudeSeen.push(toSeen(input, init))
      const r = claude.shift()
      if (!r) throw new Error('no claude reply')
      return r
    }) as typeof fetch,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      openaiSeen.push(toSeen(input, init))
      const r = openai.shift()
      if (!r) throw new Error('no openai reply')
      return r
    }),
  )
}

function mixed(): ConnectionSettings {
  const c = structuredClone(DEFAULT_CONNECTION) as ConnectionSettings
  c.providers.claude.apiKey = 'sk-ant-1'
  c.providers.grok.apiKey = 'xai-2'
  c.judge = { preset: 'grok', model: 'grok-4-fast-non-reasoning' }
  return c
}

const story = [
  { role: 'system' as const, content: 'Story prompt.' },
  { role: 'user' as const, content: '(The date begins.)' },
]
const judge = [
  { role: 'system' as const, content: 'You score one message in a dating sim.' },
  { role: 'user' as const, content: 'Score the new message.' },
]

beforeEach(() => {
  claudeSeen = []
  openaiSeen = []
  resetClaudeCache()
  resetJsonModeCache()
  useDebug.getState().clear()
})
afterEach(() => {
  setClaudeTransport({})
  vi.unstubAllGlobals()
})

describe('role routing', () => {
  it('Claude writes the story while Grok judges', async () => {
    fakes([claudeStream('Hello.')], [json({ choices: [{ message: { role: 'assistant', content: '{"delta": 4}' } }] })])
    const c = mixed()

    const s = await streamChat({ conn: c, role: 'story', messages: story })
    expect(s).toMatchObject({ text: 'Hello.', refused: false, route: { preset: 'claude', provider: 'anthropic' }, model: 'claude-opus-5' })
    expect(claudeSeen[0].headers.get('x-api-key')).toBe('sk-ant-1')
    expect(claudeSeen[0].body.output_config).toEqual({ effort: 'low' })

    const j = await jsonChat({ conn: c, role: 'judge', messages: judge, coerce: coerceJudge, fallback: neutralJudge() })
    expect(j).toMatchObject({ ok: true, value: { delta: 4 } })
    expect(openaiSeen[0].url).toBe('https://api.x.ai/v1/chat/completions')
    expect(openaiSeen[0].headers.get('authorization')).toBe('Bearer xai-2')
    expect(openaiSeen[0].body).toMatchObject({ model: 'grok-4-fast-non-reasoning', temperature: 0.2, response_format: { type: 'json_object' } })
    // Keys never cross providers.
    expect(openaiSeen[0].headers.get('x-api-key')).toBeNull()
    expect(claudeSeen[0].headers.get('authorization')).toBeNull()
  })

  it("uses the story's Effort setting for story calls and low for the rest", async () => {
    fakes([claudeStream('Hi.'), json(claudeMessage('A memory.'))], [])
    const c = mixed()
    c.effort = 'high'
    await streamChat({ conn: c, role: 'story', messages: story })
    await chat({ conn: c, role: 'story', kind: 'memory', messages: story })
    expect(claudeSeen[0].body.output_config).toEqual({ effort: 'high' })
    expect(claudeSeen[1].body.output_config).toEqual({ effort: 'low' })
    expect(useDebug.getState().lastByKind.memory?.response).toBe('A memory.')
  })

  it("routes a 'same' judge to the story preset with the judge model and Claude's schema", async () => {
    fakes([json(claudeMessage('{"delta": 1}', { model: 'claude-haiku-4-5' }))], [])
    const c = mixed()
    c.judge = { preset: 'same', model: 'claude-haiku-4-5' }
    const j = await jsonChat({ conn: c, role: 'judge', kind: 'judge', messages: judge, coerce: coerceJudge, fallback: neutralJudge() })
    expect(j.value.delta).toBe(1)
    expect(claudeSeen[0].body).toMatchObject({ model: 'claude-haiku-4-5', temperature: 0.2 })
    expect((claudeSeen[0].body.output_config as { format?: { type: string } }).format?.type).toBe('json_schema')
  })

  it('returns a refused story turn instead of throwing', async () => {
    fakes([claudeStream('', { stop_reason: 'refusal', stop_sequence: null, stop_details: { type: 'refusal', category: null, explanation: null } })], [])
    const r = await streamChat({ conn: mixed(), role: 'story', messages: story })
    expect(r).toMatchObject({ refused: true, text: '' })
    expect(refusalBeat('Nova')).toBe('Nova changes the subject.')
  })

  it('refuses early when the route has no key', async () => {
    fakes([], [])
    const c = structuredClone(DEFAULT_CONNECTION) as ConnectionSettings
    await expect(streamChat({ conn: c, role: 'story', messages: story })).rejects.toMatchObject({ kind: 'http', status: 401 })
    expect(claudeSeen).toHaveLength(0)
  })

  it('lists models per preset', async () => {
    fakes(
      [json({ data: [{ type: 'model', id: 'claude-opus-5', display_name: 'Opus', created_at: '2026-01-01T00:00:00Z', capabilities: null, max_input_tokens: null, max_tokens: null }], has_more: false, first_id: null, last_id: null })],
      [json({ object: 'list', data: [{ id: 'grok-4' }] })],
    )
    const c = mixed()
    expect(await listModels(c, 'claude')).toEqual(['claude-opus-5'])
    expect(await listModels(c, 'grok')).toEqual(['grok-4'])
    expect(openaiSeen[0].url).toBe('https://api.x.ai/v1/models')
  })

  it('knows when the story model takes a temperature', () => {
    const c = mixed()
    expect(roleTakesTemperature(c, 'story')).toBe(false)
    c.story = { preset: 'claude', model: 'claude-haiku-4-5' }
    expect(roleTakesTemperature(c, 'story')).toBe(true)
    c.story = { preset: 'ollama', model: 'llama3.1' }
    expect(roleTakesTemperature(c, 'story')).toBe(true)
  })
})
