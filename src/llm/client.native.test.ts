// The Android app's transport seam: a WebView fetch that throws a TypeError (CORS, a LAN server)
// is retried once through native HTTP (src/platform/http.ts, mocked here). GETs retry on any
// TypeError; a POST (a paid completion) only after a probe of GET /models proves the WebView
// can't reach the server at all. Streaming requests ask for the whole answer on that retry and
// deliver it through onDelta in one piece.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetWebviewBlocked } from '../platform/http'
import { useDebug } from '../store/debug'
import { DEFAULT_CONNECTION } from '../store/defaults'
import type { ConnectionSettings } from '../types'
import { chat, isLlmError, LlmError, listModels, resetJsonModeCache, streamChat, type Endpoint } from './client'
import { explainError, testEndpoint } from './diagnose'
import { streamChat as streamRole } from './index'

const native = vi.hoisted(() => ({
  available: true,
  request: vi.fn(),
}))

vi.mock('../platform/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../platform/http')>()
  return {
    ...real,
    canUseNativeHttp: () => native.available,
    request: native.request,
  }
})

const lan = (patch: Partial<Endpoint> = {}): Endpoint => ({
  preset: 'ollama',
  baseUrl: 'http://192.168.1.20:11434/v1',
  apiKey: '',
  storyModel: 'llama3.1',
  judgeModel: '',
  storyTemperature: 0.9,
  maxTokens: 600,
  ...patch,
})

const ok = (body: unknown, status = 200) => ({
  status,
  text: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
})

const completion = (content: string) => ok({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] })

let fetchCalls: { url: string; init: RequestInit }[] = []

type NativeCall = [string, { method: string; body?: string; headers: Record<string, string>; timeoutMs: number }]

/** The native requests that were POSTs (the probe is a GET of /models). */
const nativePosts = () => (native.request.mock.calls as NativeCall[]).filter(([, o]) => o.method === 'POST')

/** Native answers by path: GET /models (the probe) and POST /chat/completions. */
function nativeServer(complete: () => unknown, models: unknown = ok({ data: [{ id: 'llama3.1' }] })) {
  native.request.mockImplementation(async (url: string) => (url.endsWith('/models') ? models : complete()))
}

/** The WebView's fetch: blocked (TypeError) unless a handler answers. */
function webFetch(handler?: (url: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      fetchCalls.push({ url, init })
      if (handler) return handler(url, init)
      throw new TypeError('Failed to fetch')
    }),
  )
}

beforeEach(() => {
  native.available = true
  native.request.mockReset()
  fetchCalls = []
  resetJsonModeCache()
  resetWebviewBlocked()
  useDebug.getState().clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('native HTTP fallback (Android app)', () => {
  it('proves the server is blocked, then retries a streaming request natively, without stream, once', async () => {
    webFetch()
    nativeServer(() => completion('Hello there.'))
    const deltas: string[] = []

    const text = await streamChat({
      conn: lan(),
      messages: [{ role: 'user', content: 'Hi' }],
      onDelta: (d) => deltas.push(d),
    })

    expect(text).toBe('Hello there.')
    expect(deltas).toEqual(['Hello there.'])
    // The POST, then the probe: a WebView GET of /models with the same headers (same preflight).
    expect(fetchCalls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', 'http://192.168.1.20:11434/v1/chat/completions'],
      ['GET', 'http://192.168.1.20:11434/v1/models'],
    ])
    expect(JSON.parse(String(fetchCalls[0].init.body)).stream).toBe(true)
    expect(fetchCalls[1].init.headers).toEqual(fetchCalls[0].init.headers)

    // Native: the probe's GET answered, so the POST's preflight had failed; one native POST.
    const calls = native.request.mock.calls as NativeCall[]
    expect(calls.map(([u, o]) => [o.method, u])).toEqual([
      ['GET', 'http://192.168.1.20:11434/v1/models'],
      ['POST', 'http://192.168.1.20:11434/v1/chat/completions'],
    ])
    const [, opts] = nativePosts()[0]
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(opts.timeoutMs).toBeGreaterThan(0)
    const body = JSON.parse(opts.body ?? '') as Record<string, unknown>
    expect(body).toMatchObject({ model: 'llama3.1', stream: false })
    expect(useDebug.getState().lastByKind.story?.response).toBe('Hello there.')
  })

  it('goes straight to native HTTP for a server already proven blocked', async () => {
    webFetch()
    nativeServer(() => completion('ok'))
    await chat({ conn: lan(), messages: [{ role: 'user', content: 'Hi' }] })
    fetchCalls = []
    native.request.mockClear()
    expect(await chat({ conn: lan(), messages: [{ role: 'user', content: 'Again' }] })).toBe('ok')
    expect(fetchCalls).toHaveLength(0)
    expect(native.request).toHaveBeenCalledTimes(1)
    expect(nativePosts()).toHaveLength(1)
  })

  it('never sends a POST twice when the WebView reaches the server (the failure was in transit)', async () => {
    // The completion POST dies after it may have reached the server (a dropped connection, or a
    // gateway error page without CORS headers), but GET /models works through the WebView.
    webFetch((url) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), { headers: { 'content-type': 'application/json' } })
      throw new TypeError('Failed to fetch')
    })
    const conn = lan({ preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-1', storyModel: 'openai/gpt-5' })
    const err = await chat({ conn, messages: [{ role: 'user', content: 'Judge this.' }] }).catch((e: unknown) => e)
    expect(isLlmError(err) && err.kind).toBe('network')
    expect((err as LlmError).via).toBeUndefined()
    expect(native.request).not.toHaveBeenCalled()
    expect(fetchCalls.filter((c) => c.init.method === 'POST')).toHaveLength(1)
    // The probe carried the key, like the POST did.
    expect((fetchCalls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-1')
  })

  it('sends a non-streaming request unchanged', async () => {
    webFetch()
    nativeServer(() => completion('ok'))
    await chat({ conn: lan(), messages: [{ role: 'user', content: 'Hi' }], temperature: 0, maxTokens: 8 })
    const [, opts] = nativePosts()[0]
    expect(opts.body).toBe(fetchCalls[0].init.body)
  })

  it('lists models through the fallback (a GET retries without a probe)', async () => {
    webFetch()
    native.request.mockResolvedValue(ok({ data: [{ id: 'llama3.1' }, { id: 'qwen3' }] }))
    expect(await listModels(lan())).toEqual(['llama3.1', 'qwen3'])
    expect(fetchCalls).toHaveLength(1)
    expect(native.request).toHaveBeenCalledTimes(1)
    expect(native.request.mock.calls[0][0]).toBe('http://192.168.1.20:11434/v1/models')
    expect((native.request.mock.calls[0][1] as { method: string }).method).toBe('GET')
  })

  it('keeps streaming (no native call) when the WebView fetch works', async () => {
    webFetch(
      () =>
        new Response('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{"content":" you"}}]}\n\ndata: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    const deltas: string[] = []
    const text = await streamChat({ conn: lan(), messages: [{ role: 'user', content: 'Hi' }], onDelta: (d) => deltas.push(d) })
    expect(text).toBe('Hi you')
    expect(deltas).toEqual(['Hi', ' you'])
    expect(native.request).not.toHaveBeenCalled()
  })

  it('does nothing extra on the web', async () => {
    native.available = false
    webFetch()
    const err = await chat({ conn: lan(), messages: [{ role: 'user', content: 'Hi' }] }).catch((e: unknown) => e)
    expect(isLlmError(err) && err.kind).toBe('network')
    expect((err as LlmError).via).toBeUndefined()
    expect(native.request).not.toHaveBeenCalled()
  })

  it('does not retry an abort', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort()
        throw new DOMException('The operation was aborted.', 'AbortError')
      }),
    )
    const err = await chat({ conn: lan(), messages: [{ role: 'user', content: 'Hi' }], signal: controller.signal }).catch(
      (e: unknown) => e,
    )
    expect(isLlmError(err) && err.kind).toBe('aborted')
    expect(native.request).not.toHaveBeenCalled()
  })

  it('surfaces HTTP errors from the native answer', async () => {
    webFetch()
    // The probe's 401 still proves the server answers natively.
    native.request.mockResolvedValue(ok({ error: { message: 'Invalid API key' } }, 401))
    const err = await chat({ conn: lan({ apiKey: 'bad' }), messages: [{ role: 'user', content: 'Hi' }] }).catch((e: unknown) => e)
    expect(isLlmError(err) && err.kind).toBe('http')
    expect((err as LlmError).status).toBe(401)
    expect(nativePosts()).toHaveLength(1)
  })

  it('counts an empty HTTP error as an answer, not as unreachable', async () => {
    webFetch()
    const { NativeHttpError } = await import('../platform/http')
    const noBody = () => Promise.reject(new NativeHttpError('http://192.168.1.20:11434/v1/chat/completions', 'FileNotFoundException'))
    // GET /models is a 404 with no body too: still an answer, so the origin is proven blocked.
    native.request.mockImplementation(noBody)
    const err = await chat({ conn: lan(), messages: [{ role: 'user', content: 'Hi' }] }).catch((e: unknown) => e)
    expect(isLlmError(err) && err.kind).toBe('http')
    expect((err as LlmError).via).toBe('native')
    expect((err as LlmError).message).toMatch(/answered with an error and no details/)
    expect(nativePosts()).toHaveLength(1)
    expect(explainError(err, lan()).kind).not.toBe('unreachable')
  })

  it('learns a rejected parameter through the fallback too', async () => {
    webFetch()
    let posts = 0
    nativeServer(() =>
      posts++ === 0 ? ok({ error: { message: "Unsupported parameter: 'temperature'", param: 'temperature' } }, 400) : completion('ok'),
    )
    expect(await chat({ conn: lan(), messages: [{ role: 'user', content: 'Hi' }] })).toBe('ok')
    const second = JSON.parse(nativePosts()[1][1].body ?? '') as Record<string, unknown>
    expect(second.temperature).toBeUndefined()
  })

  it('marks a native network failure, and diagnoses it as unreachable without a CORS probe', async () => {
    webFetch()
    const { NativeHttpError } = await import('../platform/http')
    native.request.mockRejectedValue(new NativeHttpError('failed to connect to /192.168.1.20 (port 11434)', 'ConnectException'))

    const err = await chat({ conn: lan(), messages: [{ role: 'user', content: 'Hi' }] }).catch((e: unknown) => e)
    expect(isLlmError(err) && err.kind).toBe('network')
    expect((err as LlmError).via).toBe('native')
    const problem = explainError(err, lan())
    expect(problem.kind).toBe('unreachable')
    expect(problem.message).not.toMatch(/CORS/)
    expect(problem.fix).toMatch(/OLLAMA_HOST=0\.0\.0\.0/)

    fetchCalls = []
    const r = await testEndpoint(lan())
    expect(r.ok).toBe(false)
    expect(r.problem?.kind).toBe('unreachable')
    expect(r.problem?.fix).toMatch(/firewall/)
    // No mode:'no-cors' probe: the native retry already proved nothing answers.
    expect(fetchCalls.some((c) => c.init.mode === 'no-cors')).toBe(false)
  })

  it('turns a native timeout into a timeout error', async () => {
    webFetch()
    const { NativeHttpError } = await import('../platform/http')
    native.request.mockRejectedValue(new NativeHttpError('timeout', 'SocketTimeoutException'))
    const err = await chat({ conn: lan(), messages: [{ role: 'user', content: 'Hi' }] }).catch((e: unknown) => e)
    expect(isLlmError(err) && err.kind).toBe('timeout')
  })

  it('passes Test connection on a LAN server without CORS headers', async () => {
    webFetch()
    nativeServer(() => completion('ok'))
    const r = await testEndpoint(lan())
    expect(r.ok).toBe(true)
    expect(r.steps.map((s) => s.ok)).toEqual([true, true, true])
  })

  it('re-checks the WebView on Test connection (CORS may have been fixed since)', async () => {
    webFetch()
    nativeServer(() => completion('ok'))
    await chat({ conn: lan(), messages: [{ role: 'user', content: 'Hi' }] })
    // The player sets OLLAMA_ORIGINS: the WebView now streams again after Test connection.
    webFetch((url) =>
      url.endsWith('/models')
        ? new Response(JSON.stringify({ data: [{ id: 'llama3.1' }] }), { headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } }),
    )
    native.request.mockClear()
    expect((await testEndpoint(lan())).ok).toBe(true)
    expect(native.request).not.toHaveBeenCalled()
  })

  it('works through the role-level API (story role on a LAN Ollama)', async () => {
    webFetch()
    nativeServer(() => completion('She smiles.'))
    const conn = structuredClone(DEFAULT_CONNECTION) as ConnectionSettings
    conn.providers.ollama.baseUrl = 'http://192.168.1.20:11434/v1'
    conn.story = { preset: 'ollama', model: 'llama3.1' }
    const deltas: string[] = []
    const r = await streamRole({
      conn,
      role: 'story',
      messages: [{ role: 'user', content: '(The date begins.)' }],
      onDelta: (d) => deltas.push(d),
    })
    expect(r.text).toBe('She smiles.')
    expect(r.refused).toBe(false)
    expect(deltas).toEqual(['She smiles.'])
  })
})
