import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebug } from '../store/debug'
import {
  claudeJson,
  claudeTakesEffort,
  claudeTakesTemperature,
  createClaude,
  FALLBACK_BETA,
  listClaudeModels,
  resetClaudeCache,
  setClaudeTransport,
  streamClaude,
  toClaudeMessages,
  type ClaudeRequest,
} from './anthropic'
import { LlmError, type ChatMessage } from './client'
import { coerceJudge, neutralJudge } from './coerce'
import { explainError } from './diagnose'
import { JUDGE_SCHEMA } from './schemas'

interface Seen {
  url: string
  method: string
  headers: Headers
  body: Record<string, unknown>
}

type Reply = Response | Error | ((req: Seen) => Response)

let seen: Seen[] = []

function fake(...replies: Reply[]) {
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const req: Seen = {
      url,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    }
    seen.push(req)
    const next = replies.shift()
    if (!next) throw new Error('no more replies')
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next(req) : next
  })
  setClaudeTransport({ fetch: fn as unknown as typeof fetch, maxRetries: 0 })
  return fn
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } })

const apiError = (status: number, type: string, message: string) => json({ type: 'error', error: { type, message } }, status)

const message = (text: string, patch: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-4-5',
  content: text ? [{ type: 'text', text, citations: null }] : [],
  stop_reason: 'end_turn',
  stop_sequence: null,
  stop_details: null,
  usage: { input_tokens: 5, output_tokens: 5 },
  ...patch,
})

function sse(events: Record<string, unknown>[]): Response {
  const enc = new TextEncoder()
  const body = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Uneven chunks, like a real network.
      for (let i = 0; i < body.length; i += 37) controller.enqueue(enc.encode(body.slice(i, i + 37)))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function storyStream(pieces: string[], stop: Record<string, unknown> = { stop_reason: 'end_turn', stop_sequence: null }) {
  return sse([
    {
      type: 'message_start',
      message: { ...message(''), model: 'claude-opus-5', stop_reason: null },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '', citations: null } },
    ...pieces.map((text) => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } })),
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: stop, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ])
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'You are the story engine.' },
  { role: 'user', content: '(The date begins.)' },
]

const request = (model: string, patch: Partial<ClaudeRequest> = {}): ClaudeRequest => ({
  target: { baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test', model },
  messages,
  temperature: 0.9,
  effort: 'low',
  debug: { kind: 'story' },
  ...patch,
})

beforeEach(() => {
  seen = []
  resetClaudeCache()
  useDebug.getState().clear()
})
afterEach(() => setClaudeTransport({}))

describe('streamClaude', () => {
  it('streams text deltas and sends the Opus 5 request shape', async () => {
    fake(storyStream(['Hello', ' there', ', you.']))
    const deltas: string[] = []
    const r = await streamClaude({ ...request('claude-opus-5'), onDelta: (d) => deltas.push(d) })
    expect(r).toMatchObject({ text: 'Hello there, you.', refused: false, truncated: false, stopReason: 'end_turn', model: 'claude-opus-5' })
    expect(deltas.join('')).toBe('Hello there, you.')

    const req = seen[0]
    expect(req.url).toBe('https://api.anthropic.com/v1/messages?beta=true')
    expect(req.method).toBe('POST')
    expect(req.headers.get('x-api-key')).toBe('sk-ant-test')
    expect(req.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
    expect(req.headers.get('anthropic-beta')).toBe(FALLBACK_BETA)
    expect(req.body).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 16000,
      stream: true,
      system: 'You are the story engine.',
      messages: [{ role: 'user', content: '(The date begins.)' }],
      output_config: { effort: 'low' },
      fallbacks: 'default',
    })
    // Opus 5 rejects sampling parameters; thinking is left to its default.
    expect(req.body.temperature).toBeUndefined()
    expect(req.body.thinking).toBeUndefined()
  })

  it('logs the system prompt, messages and reply to the debug panel', async () => {
    fake(storyStream(['Hi.']))
    await streamClaude(request('claude-opus-5', { debug: { kind: 'story', characterId: 'nova' } }))
    const entry = useDebug.getState().lastByKind.story
    expect(entry).toMatchObject({ kind: 'story', characterId: 'nova', prompt: 'You are the story engine.', response: 'Hi.' })
    expect(entry?.messages).toEqual(messages)
  })

  it('turns a refusal into a refused result and drops the partial text', async () => {
    fake(
      storyStream(['She leans in'], {
        stop_reason: 'refusal',
        stop_sequence: null,
        stop_details: { type: 'refusal', category: null, explanation: 'Declined by policy.' },
      }),
    )
    const r = await streamClaude(request('claude-opus-5'))
    expect(r).toMatchObject({ refused: true, text: '', refusal: { category: null, explanation: 'Declined by policy.' } })
    expect(useDebug.getState().lastByKind.story?.error).toMatch(/Refused/)
  })

  it('keeps the partial text when it stops at max_tokens', async () => {
    fake(storyStream(['A long', ' reply'], { stop_reason: 'max_tokens', stop_sequence: null }))
    expect(await streamClaude(request('claude-opus-5'))).toMatchObject({ truncated: true, refused: false, text: 'A long reply' })
  })

  it('retries without the fallback beta when a 400 names it, and remembers', async () => {
    fake(
      apiError(400, 'invalid_request_error', 'fallbacks: Extra inputs are not permitted'),
      storyStream(['ok']),
      storyStream(['again']),
    )
    expect((await streamClaude(request('claude-opus-5'))).text).toBe('ok')
    expect(seen[0].body.fallbacks).toBe('default')
    expect(seen[1].body.fallbacks).toBeUndefined()
    expect(seen[1].headers.get('anthropic-beta')).toBeNull()
    await streamClaude(request('claude-opus-5'))
    expect(seen[2].body.fallbacks).toBeUndefined()
  })
})

describe('what each model gets', () => {
  it('sends temperature but no effort or fallbacks to Haiku 4.5', async () => {
    fake(json(message('{"delta": 2, "hits": []}')))
    await createClaude(request('claude-haiku-4-5', { temperature: 0.2, debug: { kind: 'judge' } }))
    const body = seen[0].body
    expect(body.temperature).toBe(0.2)
    expect(body.output_config).toBeUndefined()
    expect(body.fallbacks).toBeUndefined()
    expect(body.stream).toBeUndefined()
    expect(body.max_tokens).toBe(16000)
    expect(seen[0].headers.get('anthropic-beta')).toBeNull()
  })

  it('sends no temperature to models that reject sampling', () => {
    const t = (model: string) => claudeTakesTemperature({ baseUrl: 'https://api.anthropic.com', apiKey: 'k', model })
    expect(t('claude-opus-5')).toBe(false)
    expect(t('claude-sonnet-5')).toBe(false)
    expect(t('claude-opus-4-7')).toBe(false)
    expect(t('claude-fable-5-1')).toBe(false)
    expect(t('claude-haiku-4-5')).toBe(true)
    expect(t('claude-sonnet-4-6')).toBe(true)
    expect(t('claude-something-new')).toBe(false)
  })

  it('learns that a model rejects effort from a 400 and stops sending it', async () => {
    fake(
      apiError(400, 'invalid_request_error', 'output_config.effort: this model does not support effort'),
      json(message('ok', { model: 'claude-future-9' })),
      json(message('ok', { model: 'claude-future-9' })),
    )
    const target = { baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test', model: 'claude-future-9' }
    expect(claudeTakesEffort(target)).toBe(true)
    await createClaude(request('claude-future-9'))
    expect(seen[0].body.output_config).toEqual({ effort: 'low' })
    expect(seen[0].body.temperature).toBeUndefined()
    expect(seen[1].body.output_config).toBeUndefined()
    expect(claudeTakesEffort(target)).toBe(false)
    await createClaude(request('claude-future-9'))
    expect(seen[2].body.output_config).toBeUndefined()
  })
})

describe('claudeJson', () => {
  const judge = (model: string) =>
    claudeJson(request(model, { temperature: 0.2, schema: JUDGE_SCHEMA, debug: { kind: 'judge' } }), coerceJudge, neutralJudge())

  it('asks for structured output and parses it', async () => {
    fake(json(message('{"delta": 3, "trustDelta": 1, "hits": [{"type": "like", "id": "vinyl"}], "mood": "warm", "hint": "", "jealousy": false, "breach": false}')))
    const r = await judge('claude-haiku-4-5')
    expect(r).toMatchObject({ ok: true, value: { delta: 3, hits: [{ type: 'like', id: 'vinyl' }] } })
    expect(seen[0].body.output_config).toEqual({ format: { type: 'json_schema', schema: JUDGE_SCHEMA } })
  })

  it('falls back to the plain JSON path when the model rejects the format', async () => {
    fake(
      apiError(400, 'invalid_request_error', 'output_config.format: structured outputs are not supported for this model'),
      json(message('Sure! ```json\n{"delta": 1}\n```')),
      json(message('{"delta": 2}')),
    )
    expect((await judge('claude-haiku-4-5')).value.delta).toBe(1)
    expect(seen[1].body.output_config).toBeUndefined()
    expect((await judge('claude-haiku-4-5')).value.delta).toBe(2)
    expect(seen[2].body.output_config).toBeUndefined()
  })

  it('nudges once, then returns the neutral fallback', async () => {
    fake(json(message('She smiles.')), json(message('Still prose.')))
    const r = await judge('claude-haiku-4-5')
    expect(r).toMatchObject({ ok: false, value: neutralJudge() })
    const retry = seen[1].body.messages as { role: string; content: string }[]
    expect(retry.at(-2)).toEqual({ role: 'assistant', content: 'She smiles.' })
    expect(retry.at(-1)?.content).toMatch(/valid JSON only/)
  })

  it('returns the fallback straight away on a refusal', async () => {
    fake(json(message('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } })))
    const r = await judge('claude-opus-5')
    expect(r).toMatchObject({ ok: false, refused: true, value: neutralJudge() })
    expect(seen).toHaveLength(1)
  })
})

describe('errors', () => {
  const target = { preset: 'claude' as const, baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' }
  const fail = async (reply: Reply) => {
    fake(reply)
    const err = await createClaude(request('claude-opus-5')).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    return err as LlmError
  }

  it('maps a bad key to an auth problem that says where to check it', async () => {
    const err = await fail(apiError(401, 'authentication_error', 'invalid x-api-key'))
    expect(err).toMatchObject({ kind: 'http', status: 401 })
    expect(explainError(err, target)).toMatchObject({ kind: 'auth', fix: 'Check your Anthropic API key at console.anthropic.com.' })
    expect(useDebug.getState().lastByKind.story?.error).toMatch(/401/)
  })

  it('maps permission, rate limit and unknown model', async () => {
    expect(explainError(await fail(apiError(403, 'permission_error', 'nope')), target).kind).toBe('auth')
    expect(explainError(await fail(apiError(429, 'rate_limit_error', 'slow down')), target).kind).toBe('rate_limit')
    const missing = await fail(apiError(404, 'not_found_error', 'model: claude-opus-5'))
    expect(explainError(missing, target, 'claude-opus-5')).toMatchObject({ kind: 'model' })
  })

  it("reports the API's own message, not the SDK's JSON dump", async () => {
    const text = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
    const err = await fail(apiError(400, 'invalid_request_error', text))
    expect(err.message).toBe(`HTTP 400: ${text}`)
    const p = explainError(err, target)
    expect(p.kind).toBe('billing')
    expect(p.fix).toMatch(/console\.anthropic\.com\/settings\/billing/)
  })

  it('maps an overloaded API to a busy message', async () => {
    const err = await fail(apiError(529, 'overloaded_error', 'Overloaded'))
    expect(explainError(err, target).message).toMatch(/busy/)
  })

  it('maps a failed fetch to unreachable (offline)', async () => {
    const err = await fail(new TypeError('Failed to fetch'))
    expect(err.kind).toBe('network')
    expect(explainError(err, target)).toMatchObject({ kind: 'unreachable' })
  })

  it('maps a cancelled request to aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    fake(json(message('late')))
    const err = await createClaude(request('claude-opus-5', { signal: ctrl.signal })).catch((e: unknown) => e)
    expect(err).toMatchObject({ kind: 'aborted' })
  })
})

describe('retries', () => {
  /** A busy answer that says to retry right away. */
  const busy = (status: number, type: string) =>
    new Response(JSON.stringify({ type: 'error', error: { type, message: type } }), {
      status,
      headers: { 'content-type': 'application/json', 'retry-after': '0', 'x-should-retry': 'true' },
    })

  /** The real retry policy (no test cap), through a fake fetch. */
  function realRetries(...replies: Reply[]) {
    const fn = fake(...replies)
    setClaudeTransport({ fetch: fn as unknown as typeof fetch, maxRetryWaitMs: 0 })
    return fn
  }

  it('never re-sends a non-streamed call after a dropped connection (it may have been billed)', async () => {
    realRetries(new TypeError('Failed to fetch'), json(message('{"delta":1}')))
    const err = await createClaude(request('claude-haiku-4-5', { debug: { kind: 'judge' } })).catch((e: unknown) => e)
    expect(err).toMatchObject({ kind: 'network' })
    expect(seen).toHaveLength(1)
  })

  it('retries a non-streamed call once on 429 or 529 (not billed)', async () => {
    realRetries(busy(429, 'rate_limit_error'), json(message('ok')))
    expect((await createClaude(request('claude-haiku-4-5'))).text).toBe('ok')
    expect(seen).toHaveLength(2)

    seen = []
    realRetries(busy(529, 'overloaded_error'), json(message('ok')))
    expect((await createClaude(request('claude-haiku-4-5'))).text).toBe('ok')
    expect(seen).toHaveLength(2)
  })

  it('gives up after the one retry', async () => {
    realRetries(busy(429, 'rate_limit_error'), busy(429, 'rate_limit_error'), json(message('ok')))
    const err = await createClaude(request('claude-haiku-4-5')).catch((e: unknown) => e)
    expect(err).toMatchObject({ kind: 'http', status: 429 })
    expect(seen).toHaveLength(2)
  })
})

describe('listClaudeModels', () => {
  it('lists ids and notes models that skip effort', async () => {
    fake(
      json({
        data: [
          { type: 'model', id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-05-01T00:00:00Z', capabilities: null, max_input_tokens: null, max_tokens: null },
          {
            type: 'model',
            id: 'claude-mystery-1',
            display_name: 'Mystery',
            created_at: '2026-01-01T00:00:00Z',
            capabilities: { effort: { supported: false }, structured_outputs: { supported: true } },
            max_input_tokens: null,
            max_tokens: null,
          },
        ],
        has_more: false,
        first_id: 'claude-opus-5',
        last_id: 'claude-mystery-1',
      }),
    )
    const ids = await listClaudeModels({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' })
    expect(ids).toEqual(['claude-opus-5', 'claude-mystery-1'])
    expect(seen[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/)
    expect(claudeTakesEffort({ baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-mystery-1' })).toBe(false)
  })
})

describe('toClaudeMessages', () => {
  it('lifts system prompts, merges same-role turns and never ends on the assistant', () => {
    const out = toClaudeMessages([
      { role: 'system', content: 'Rules.' },
      { role: 'assistant', content: 'Opening line.' },
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: '  ' },
      { role: 'assistant', content: 'Reply.' },
    ])
    expect(out.system).toBe('Rules.')
    expect(out.messages).toEqual([
      { role: 'user', content: '(Continue.)' },
      { role: 'assistant', content: 'Opening line.' },
      { role: 'user', content: 'hi\n\nagain' },
      { role: 'assistant', content: 'Reply.' },
      { role: 'user', content: '(Continue.)' },
    ])
  })
})
