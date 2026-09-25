import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebug } from '../store/debug'
import {
  chat,
  chatCompletion,
  HOSTED_MIN_TOKENS,
  headersFor,
  JSON_NUDGE,
  jsonChat,
  jsonModeAllowed,
  judgeJson,
  listModels,
  LlmError,
  paramAllowed,
  rejectedParam,
  rejectsJsonMode,
  resetJsonModeCache,
  streamChat,
  streamCompletion,
  type Endpoint,
} from './client'
import { coerceJudge, neutralJudge } from './coerce'

const conn = (patch: Partial<Endpoint> = {}): Endpoint => ({
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
    mockFetch(jsonResponse(unsupported, 400), jsonResponse(completion('{"delta": 1}')))
    const c = conn()
    const r = await jsonChat(judgeOpts(c))
    expect(r.value.delta).toBe(1)
    expect(jsonModeAllowed(c, 'story-m')).toBe(true)
    // The rejected max_tokens is swapped for max_completion_tokens, JSON mode stays on.
    expect(calls[1].body).toMatchObject({ max_completion_tokens: 600, response_format: { type: 'json_object' } })
    expect(calls[1].body.max_tokens).toBeUndefined()
  })

  it('still throws a 400 that names nothing it can drop', async () => {
    mockFetch(jsonResponse({ error: { message: 'messages: too long for the context window', type: 'invalid_request_error' } }, 400))
    await expect(jsonChat(judgeOpts())).rejects.toMatchObject({ kind: 'http', status: 400 })
    expect(calls).toHaveLength(1)
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

describe('parameter learning', () => {
  const openai = (message: string, param: string, code = 'unsupported_parameter') => ({
    error: { message, type: 'invalid_request_error', param, code },
  })

  it('retries without temperature when a model rejects it, and remembers per baseUrl+model', async () => {
    mockFetch(
      jsonResponse(openai("Unsupported value: 'temperature' does not support 0.9 with this model. Only the default (1) value is supported.", 'temperature', 'unsupported_value'), 400),
      jsonResponse(completion('first')),
      jsonResponse(completion('second')),
    )
    const c = conn({ baseUrl: 'https://api.openai.com/v1', preset: 'chatgpt', storyModel: 'gpt-5' })
    expect(await chat({ conn: c, messages })).toBe('first')
    expect(calls[0].body.temperature).toBe(0.9)
    expect(calls[1].body.temperature).toBeUndefined()
    expect(paramAllowed(c, 'gpt-5', 'temperature')).toBe(false)
    expect(paramAllowed(c, 'gpt-5-mini', 'temperature')).toBe(true)
    expect(await chat({ conn: c, messages })).toBe('second')
    expect(calls[2].body.temperature).toBeUndefined()
  })

  it('learns more than one parameter in a single call', async () => {
    mockFetch(
      jsonResponse(openai('temperature is not supported', 'temperature'), 400),
      jsonResponse({ error: "'json_object' is not supported by this model" }, 400),
      jsonResponse(completion('{"delta": 2}')),
    )
    const r = await jsonChat(judgeOpts())
    expect(r.value.delta).toBe(2)
    expect(calls).toHaveLength(3)
    expect(calls[2].body.temperature).toBeUndefined()
    expect(calls[2].body.response_format).toBeUndefined()
  })

  it('names the parameter a 400 turns down', () => {
    const http = (body: unknown, status = 400) => new LlmError('http', 'HTTP 400: x', { status, body: JSON.stringify(body) })
    const sent = ['temperature', 'max_tokens', 'response_format'] as const
    expect(rejectedParam(http(openai('bad', 'temperature')), sent)).toBe('temperature')
    expect(rejectedParam(http({ error: 'Unrecognized request argument supplied: max_tokens' }), sent)).toBe('max_tokens')
    expect(rejectedParam(http({ error: 'temperature is out of range' }), sent)).toBeNull()
    expect(rejectedParam(http(openai('bad', 'temperature'), 500), sent)).toBeNull()
    expect(rejectedParam(http(openai('bad', 'top_p')), sent)).toBeNull()
    expect(rejectedParam(new LlmError('network', 'x'), sent)).toBeNull()
  })
})

describe('hosted OpenAI-compatible APIs', () => {
  it('sends max_completion_tokens with a generous cap to api.openai.com', async () => {
    mockFetch(jsonResponse(completion('ok')))
    await chat({ conn: conn({ preset: 'chatgpt', baseUrl: 'https://api.openai.com/v1' }), messages, maxTokens: 8 })
    expect(calls[0].body).toMatchObject({ max_completion_tokens: HOSTED_MIN_TOKENS })
    expect(calls[0].body.max_tokens).toBeUndefined()
  })

  it('does the same for a Custom preset pointed at api.openai.com', async () => {
    mockFetch(jsonResponse(completion('ok')))
    await chat({ conn: conn({ preset: 'custom', baseUrl: 'https://api.openai.com/v1/' }), messages })
    expect(calls[0].body).toMatchObject({ max_completion_tokens: HOSTED_MIN_TOKENS })
  })

  it('gives xAI max_tokens with the same floor', async () => {
    mockFetch(jsonResponse(completion('ok')))
    await chat({ conn: conn({ preset: 'grok', baseUrl: 'https://api.x.ai/v1' }), messages })
    expect(calls[0].body).toMatchObject({ max_tokens: HOSTED_MIN_TOKENS })
  })

  it('keeps the setting for local servers', async () => {
    mockFetch(jsonResponse(completion('ok')))
    await chat({ conn: conn(), messages })
    expect(calls[0].body).toMatchObject({ max_tokens: 600 })
    expect(calls[0].body.reasoning_effort).toBeUndefined()
  })

  it('asks OpenAI for low reasoning effort, and learns when a model turns it down', async () => {
    const openai = conn({ preset: 'chatgpt', baseUrl: 'https://api.openai.com/v1', storyModel: 'gpt-4.1' })
    mockFetch(
      jsonResponse({ error: { message: 'Unrecognized request argument supplied: reasoning_effort', type: 'invalid_request_error', param: 'reasoning_effort' } }, 400),
      jsonResponse(completion('ok')),
      jsonResponse(completion('ok')),
    )
    expect(await chat({ conn: openai, messages })).toBe('ok')
    expect(calls[0].body.reasoning_effort).toBe('low')
    expect(calls[1].body.reasoning_effort).toBeUndefined()
    await chat({ conn: openai, messages })
    expect(calls[2].body.reasoning_effort).toBeUndefined()
  })
})

describe('refusals', () => {
  it('flags message.refusal', async () => {
    mockFetch(jsonResponse({ choices: [{ message: { role: 'assistant', content: null, refusal: "I can't help with that." }, finish_reason: 'stop' }] }))
    const r = await chatCompletion({ conn: conn(), messages })
    expect(r).toMatchObject({ refused: true, refusal: "I can't help with that.", text: '' })
  })

  it("flags finish_reason 'content_filter' in a stream and keeps the partial text", async () => {
    mockFetch(
      sseResponse([
        chunk('She leans'),
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    const r = await streamCompletion({ conn: conn(), messages })
    expect(r).toMatchObject({ refused: true, finishReason: 'content_filter', text: 'She leans' })
    expect(useDebug.getState().lastByKind.story?.error).toMatch(/Refused/)
  })

  it('returns the fallback for a refused JSON call without the nudge retry', async () => {
    mockFetch(jsonResponse({ choices: [{ message: { role: 'assistant', content: null, refusal: 'No.' } }] }))
    const r = await jsonChat(judgeOpts())
    expect(r).toMatchObject({ ok: false, refused: true, value: neutralJudge() })
    expect(calls).toHaveLength(1)
  })

  it("reports finish_reason 'length'", async () => {
    mockFetch(jsonResponse({ choices: [{ message: { role: 'assistant', content: 'cut sho' }, finish_reason: 'length' }] }))
    expect(await chatCompletion({ conn: conn(), messages })).toMatchObject({ refused: false, finishReason: 'length', text: 'cut sho' })
  })

  it("fails a reply that used the whole cap on reasoning and wrote nothing ('length', no text)", async () => {
    mockFetch(jsonResponse({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }] }))
    const err = await chatCompletion({ conn: conn(), messages }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect((err as LlmError).kind).toBe('empty')
    expect(useDebug.getState().lastByKind.story?.error).toMatch(/empty/)
  })
})
