import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebug } from '../store/debug'
import type { ConnectionSettings } from '../types'
import {
  chat,
  headersFor,
  JSON_NUDGE,
  jsonChat,
  jsonModeAllowed,
  judgeJson,
  listModels,
  LlmError,
  rejectsJsonMode,
  resetJsonModeCache,
  streamChat,
} from './client'
import { coerceJudge, neutralJudge } from './coerce'

const conn = (patch: Partial<ConnectionSettings> = {}): ConnectionSettings => ({
  preset: 'custom',
  baseUrl: 'http://llm.test/v1/',
  apiKey: '',
  storyModel: 'story-m',
  judgeModel: '',
  storyTemperature: 0.9,
  maxTokens: 600,
  ...patch,
})

const enc = new TextEncoder()

function sseResponse(chunks: string[], contentType = 'text/event-stream'): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': contentType } })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const completion = (content: string) => ({
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
})

const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`

interface Call {
  url: string
  init: RequestInit
  body: Record<string, unknown>
}

let calls: Call[] = []
function mockFetch(...responses: (Response | Error | ((init: RequestInit) => Promise<Response>))[]) {
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : {} })
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next(init)
    return next
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  calls = []
  resetJsonModeCache()
  useDebug.getState().clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const messages = [
  { role: 'system' as const, content: 'You are the story engine.' },
  { role: 'user' as const, content: 'hi' },
]

describe('streamChat', () => {
  it('streams deltas split across chunks and returns the full text', async () => {
    const body = `: keep-alive\n\ndata: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n${chunk('Hello')}${chunk(' there')}${chunk(', you.')}data: [DONE]\n\n`
    // Split into awkward pieces, including a CRLF-free cut mid-JSON.
    const pieces = [body.slice(0, 7), body.slice(7, 60), body.slice(60, 61), body.slice(61)]
    mockFetch(sseResponse(pieces))
    const deltas: string[] = []
    const text = await streamChat({ conn: conn(), messages, onDelta: (d) => deltas.push(d) })
    expect(text).toBe('Hello there, you.')
    expect(deltas.join('')).toBe('Hello there, you.')
    expect(calls[0].url).toBe('http://llm.test/v1/chat/completions')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].body).toMatchObject({ model: 'story-m', stream: true, temperature: 0.9, max_tokens: 600 })
    expect(calls[0].body.response_format).toBeUndefined()
  })

  it('handles CRLF streams', async () => {
    mockFetch(sseResponse([chunk('a').replace(/\n/g, '\r\n'), chunk('b').replace(/\n/g, '\r\n'), 'data: [DONE]\r\n\r\n']))
    expect(await streamChat({ conn: conn(), messages })).toBe('ab')
  })

  it('stops at [DONE] even if the server keeps the connection open', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(`${chunk('done')}data: [DONE]\n\n`))
        // never closes
      },
      cancel() {
        cancelled = true
      },
    })
    mockFetch(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    expect(await streamChat({ conn: conn(), messages })).toBe('done')
    expect(cancelled).toBe(true)
  })

  it('falls back to a JSON body when the server ignores stream:true', async () => {
    mockFetch(jsonResponse(completion('Not streamed.')))
    const deltas: string[] = []
    expect(await streamChat({ conn: conn(), messages, onDelta: (d) => deltas.push(d) })).toBe('Not streamed.')
    expect(deltas).toEqual(['Not streamed.'])
  })

  it('reads a JSON body even when it is labelled as an event stream', async () => {
    mockFetch(sseResponse([JSON.stringify(completion('Mislabelled.'))]))
    expect(await streamChat({ conn: conn(), messages })).toBe('Mislabelled.')
  })

  it('parses an event stream labelled as application/json', async () => {
    mockFetch(sseResponse([`${chunk('mis')}${chunk('labelled')}data: [DONE]\n\n`], 'application/json'))
    expect(await streamChat({ conn: conn(), messages })).toBe('mislabelled')
  })

  it('throws an http LlmError for an error payload inside the stream', async () => {
    mockFetch(sseResponse([chunk('partial'), 'data: {"error":{"message":"Provider overloaded","code":502}}\n\n']))
    const err = await streamChat({ conn: conn(), messages }).catch((e) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect(err.kind).toBe('http')
    expect(err.status).toBe(502)
    expect(err.message).toMatch(/Provider overloaded/)
  })

  it('filters <think> reasoning, even when the tags are split across chunks', async () => {
    mockFetch(sseResponse([chunk('<thi'), chunk('nk>plotting {"x"}</th'), chunk('ink>\n\n*She smiles.*')]))
    const deltas: string[] = []
    expect(await streamChat({ conn: conn(), messages, onDelta: (d) => deltas.push(d) })).toBe('*She smiles.*')
    expect(deltas.join('')).toBe('*She smiles.*')
  })

  it('throws an http LlmError with status and server message for non-2xx', async () => {
    mockFetch(jsonResponse({ error: { message: 'model "nope" not found' } }, 404))
    const err = await streamChat({ conn: conn(), messages }).catch((e) => e)
    expect(err).toMatchObject({ kind: 'http', status: 404 })
    expect(err.message).toMatch(/model "nope" not found/)
    expect(err.body).toMatch(/not found/)
  })

  it('maps a fetch TypeError to a network LlmError', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    const err = await streamChat({ conn: conn(), messages }).catch((e) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect(err.kind).toBe('network')
  })

  it('maps a caller abort to an aborted LlmError', async () => {
    const controller = new AbortController()
    mockFetch(
      (init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const p = streamChat({ conn: conn(), messages, signal: controller.signal })
    controller.abort()
    await expect(p).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('times out with a timeout LlmError', async () => {
    mockFetch(
      (init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    await expect(streamChat({ conn: conn(), messages, timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('logs a debug entry with the system prompt, messages and response', async () => {
    mockFetch(sseResponse([chunk('Hi.'), 'data: [DONE]\n\n']))
    await streamChat({ conn: conn(), messages, debug: { kind: 'story', characterId: 'nova' } })
    const entry = useDebug.getState().lastByKind.story
    expect(entry).toMatchObject({ kind: 'story', characterId: 'nova', prompt: 'You are the story engine.', response: 'Hi.' })
    expect(entry?.messages).toEqual(messages)
  })

  it('logs errors to the debug entry', async () => {
    mockFetch(jsonResponse({ error: 'boom' }, 500))
    await expect(chat({ conn: conn(), messages, debug: { kind: 'memory' } })).rejects.toBeInstanceOf(LlmError)
    expect(useDebug.getState().lastByKind.memory?.error).toMatch(/http 500.*boom/)
  })
})

describe('headers', () => {
  it('sends Authorization only when a key is set', async () => {
    mockFetch(jsonResponse(completion('x')), jsonResponse(completion('y')))
    await chat({ conn: conn(), messages })
    await chat({ conn: conn({ apiKey: '  sk-test  ' }), messages })
    const h0 = calls[0].init.headers as Record<string, string>
    const h1 = calls[1].init.headers as Record<string, string>
    expect(h0.Authorization).toBeUndefined()
    expect(h1.Authorization).toBe('Bearer sk-test')
    expect(h0['Content-Type']).toBe('application/json')
  })

  it('adds X-Title for OpenRouter', () => {
    expect(headersFor(conn({ preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }))).toMatchObject({
      'X-Title': 'crushLAB',
      Authorization: 'Bearer k',
    })
    expect(headersFor(conn())['X-Title']).toBeUndefined()
  })
})

describe('chat', () => {
  it('sends stream:false and returns the message content', async () => {
    mockFetch(jsonResponse(completion('  plain reply  ')))
    expect(await chat({ conn: conn(), messages, temperature: 0.1, maxTokens: 8 })).toBe('plain reply')
    expect(calls[0].body).toMatchObject({ stream: false, temperature: 0.1, max_tokens: 8 })
  })

  it('also reads an SSE reply', async () => {
    mockFetch(sseResponse([chunk('sse '), chunk('anyway'), 'data: [DONE]\n\n']))
    expect(await chat({ conn: conn(), messages })).toBe('sse anyway')
  })
})

const judgeOpts = (c = conn()) => ({
  conn: c,
  messages: [
    { role: 'system' as const, content: 'You score one message in a dating sim.' },
    { role: 'user' as const, content: 'Score the new message.' },
  ],
  coerce: coerceJudge,
  fallback: neutralJudge(),
})

describe('jsonChat', () => {
  it('sends response_format and parses the reply', async () => {
    mockFetch(jsonResponse(completion('```json\n{"delta": 3, "hits": [{"type": "like", "id": "vinyl"}]}\n```')))
    const r = await jsonChat(judgeOpts())
    expect(r.ok).toBe(true)
    expect(r.value.delta).toBe(3)
    expect(r.value.hits).toEqual([{ type: 'like', id: 'vinyl' }])
    expect(calls[0].body.response_format).toEqual({ type: 'json_object' })
    expect(calls[0].body.stream).toBe(false)
  })

  it('retries without response_format when it is rejected, and remembers per baseUrl+model', async () => {
    mockFetch(
      jsonResponse({ error: { message: 'response_format is not supported' } }, 400),
      jsonResponse(completion('{"delta": 1}')),
      jsonResponse(completion('{"delta": 2}')),
    )
    const c = conn()
    const r1 = await jsonChat(judgeOpts(c))
    expect(r1).toMatchObject({ ok: true, value: { delta: 1 } })
    expect(calls[0].body.response_format).toBeDefined()
    expect(calls[1].body.response_format).toBeUndefined()
    expect(jsonModeAllowed(c, 'story-m')).toBe(false)
    expect(jsonModeAllowed(c, 'other-model')).toBe(true)
    const r2 = await jsonChat(judgeOpts(c))
    expect(r2.value.delta).toBe(2)
    expect(calls).toHaveLength(3)
    expect(calls[2].body.response_format).toBeUndefined()
  })

  it("doesn't turn JSON mode off for an unrelated 400", async () => {
    const unsupported = {
      error: {
        message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        type: 'invalid_request_error',
        param: 'max_tokens',
        code: 'unsupported_parameter',
      },
    }
    mockFetch(jsonResponse(unsupported, 400))
    const c = conn()
    await expect(jsonChat(judgeOpts(c))).rejects.toMatchObject({ kind: 'http', status: 400 })
    expect(calls).toHaveLength(1)
    expect(jsonModeAllowed(c, 'story-m')).toBe(true)
  })

  it('recognises response_format rejections by param or wording only', () => {
    const http = (body: unknown) => new LlmError('http', 'HTTP 400: x', { status: 400, body: JSON.stringify(body) })
    expect(rejectsJsonMode(http({ error: { message: 'Invalid value', param: 'response_format' } }))).toBe(true)
    expect(rejectsJsonMode(http({ error: "'json_object' is not supported by this model" }))).toBe(true)
    expect(rejectsJsonMode(http({ detail: [{ loc: ['body', 'response_format'], msg: 'extra fields not permitted' }] }))).toBe(true)
    expect(rejectsJsonMode(http({ error: { message: 'Invalid parameter: temperature', param: 'temperature' } }))).toBe(false)
    expect(rejectsJsonMode(http({ error: 'Could not parse the JSON body of your request' }))).toBe(false)
  })

  it('retries once with the nudge when the reply is not JSON', async () => {
    mockFetch(jsonResponse(completion('That was charming!')), jsonResponse(completion('{"delta": 4, "mood": "warm"}')))
    const r = await jsonChat(judgeOpts())
    expect(r).toMatchObject({ ok: true, value: { delta: 4, mood: 'warm' } })
    expect(calls).toHaveLength(2)
    const retry = calls[1].body.messages as { role: string; content: string }[]
    expect(retry[retry.length - 1]).toEqual({ role: 'user', content: JSON_NUDGE })
    expect(retry[retry.length - 2]).toEqual({ role: 'assistant', content: 'That was charming!' })
  })

  it('returns the fallback with ok:false after the retry also fails', async () => {
    mockFetch(jsonResponse(completion('prose')), jsonResponse(completion('{"mood": "no delta here"}')))
    const r = await jsonChat(judgeOpts())
    expect(r.ok).toBe(false)
    expect(r.value).toEqual(neutralJudge())
    expect(r.raw).toBe('{"mood": "no delta here"}')
    expect(calls).toHaveLength(2)
  })

  it('still throws network errors', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    await expect(jsonChat(judgeOpts())).rejects.toMatchObject({ kind: 'network' })
  })

  it('judgeJson uses the judge model (or the story model) at temperature 0.2', async () => {
    mockFetch(jsonResponse(completion('{"delta": 0}')), jsonResponse(completion('{"delta": 0}')))
    await judgeJson(judgeOpts(conn({ judgeModel: 'small-judge' })))
    await judgeJson(judgeOpts(conn({ judgeModel: '' })))
    expect(calls[0].body).toMatchObject({ model: 'small-judge', temperature: 0.2 })
    expect(calls[1].body).toMatchObject({ model: 'story-m', temperature: 0.2 })
    expect(useDebug.getState().lastByKind.judge).toBeDefined()
  })
})

describe('listModels', () => {
  it('reads data[].id with a GET and no JSON content-type', async () => {
    mockFetch(jsonResponse({ object: 'list', data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }))
    expect(await listModels(conn())).toEqual(['a', 'b'])
    expect(calls[0].url).toBe('http://llm.test/v1/models')
    expect(calls[0].init.method).toBe('GET')
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('tolerates models[].name', async () => {
    mockFetch(jsonResponse({ models: [{ name: 'llama3:latest' }] }))
    expect(await listModels(conn())).toEqual(['llama3:latest'])
  })

  it('throws a parse error for non-API pages', async () => {
    mockFetch(new Response('<html>hi</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await expect(listModels(conn())).rejects.toMatchObject({ kind: 'parse' })
  })
})
