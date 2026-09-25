import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
  native: true,
  request: vi.fn(),
}))

vi.mock('./platform', () => ({
  isNative: () => env.native,
  platformName: () => (env.native ? 'android' : 'web'),
  isAndroidApp: () => env.native,
  hasPlugin: () => env.native,
}))

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  CapacitorHttp: { request: env.request },
}))

import {
  canUseNativeHttp,
  fetchWithFallback,
  isFetchBlocked,
  isWebviewBlocked,
  NativeHttpError,
  probeWebview,
  request,
  resetWebviewBlocked,
  toResponse,
} from './http'

beforeEach(() => {
  env.native = true
  env.request.mockReset()
  resetWebviewBlocked()
})
afterEach(() => vi.unstubAllGlobals())

describe('request (native HTTP)', () => {
  it('sends a POST body with its content type and timeouts, and returns text', async () => {
    env.request.mockResolvedValue({
      status: 200,
      data: { choices: [{ message: { content: 'ok' } }] },
      headers: { 'Content-Type': 'application/json' },
      url: 'http://192.168.1.20:11434/v1/chat/completions',
    })
    const out = await request('http://192.168.1.20:11434/v1/chat/completions', {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: '{"model":"llama3.1"}',
      timeoutMs: 5000,
    })
    expect(env.request).toHaveBeenCalledWith({
      url: 'http://192.168.1.20:11434/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: '{"model":"llama3.1"}',
      responseType: 'text',
      connectTimeout: 5000,
      readTimeout: 5000,
    })
    expect(out.status).toBe(200)
    // The native layer parses JSON; the client wants the text back.
    expect(JSON.parse(out.text)).toEqual({ choices: [{ message: { content: 'ok' } }] })
    expect(out.headers['content-type']).toBe('application/json')
  })

  it('gives a body without a content type one, so the native layer sends it', async () => {
    env.request.mockResolvedValue({ status: 204, data: '', headers: {}, url: '' })
    await request('http://10.0.0.2/x', { method: 'POST', body: 'hi' })
    const opts = env.request.mock.calls[0][0] as { headers: Record<string, string>; data: string }
    expect(opts.headers['Content-Type']).toMatch(/^text\/plain/)
    expect(opts.data).toBe('hi')
  })

  it('never sends a body with GET', async () => {
    env.request.mockResolvedValue({ status: 200, data: 'x', headers: {}, url: '' })
    await request('http://10.0.0.2/models', { body: 'ignored' })
    expect((env.request.mock.calls[0][0] as { data?: unknown }).data).toBeUndefined()
  })

  it('resolves HTTP errors as answers', async () => {
    env.request.mockResolvedValue({ status: 401, data: { error: { message: 'bad key' } }, headers: {}, url: '' })
    const out = await request('https://api.openai.com/v1/models')
    expect(out.status).toBe(401)
    expect(out.text).toContain('bad key')
  })

  it('rejects with NativeHttpError when nothing answered', async () => {
    env.request.mockRejectedValue(Object.assign(new Error('Read timed out'), { code: 'SocketTimeoutException' }))
    const err = await request('http://10.0.0.2/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NativeHttpError)
    expect((err as NativeHttpError).code).toBe('SocketTimeoutException')
    expect((err as NativeHttpError).timedOut).toBe(true)
    expect(new NativeHttpError('Connection refused', 'ConnectException').timedOut).toBe(false)
  })

  it('knows an HTTP error with an empty body (the server did answer)', async () => {
    env.request.mockRejectedValue(Object.assign(new Error('http://10.0.0.2/x'), { code: 'FileNotFoundException' }))
    const err = (await request('http://10.0.0.2/x').catch((e: unknown) => e)) as NativeHttpError
    expect(err.httpErrorNoBody).toBe(true)
    expect(err.timedOut).toBe(false)
    expect(new NativeHttpError('Connection refused', 'ConnectException').httpErrorNoBody).toBe(false)
  })

  it('stops waiting when the signal fires', async () => {
    env.request.mockReturnValue(new Promise(() => {}))
    const controller = new AbortController()
    const pending = request('http://10.0.0.2/x', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('fetchWithFallback', () => {
  it('uses the WebView fetch when it works', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('fine')))
    const res = await fetchWithFallback('https://api.github.com/x')
    expect(await res.text()).toBe('fine')
    expect(env.request).not.toHaveBeenCalled()
  })

  it('retries a GET natively when the WebView blocks it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    env.request.mockResolvedValue({ status: 200, data: { ok: true }, headers: { 'content-type': 'application/json' }, url: '' })
    const res = await fetchWithFallback('http://192.168.1.20:7860/sdapi/v1/sd-models')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(env.request).toHaveBeenCalledTimes(1)
  })

  it('retries a POST natively once a probe proves the WebView is blocked', async () => {
    const fetchFn = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fetchFn)
    env.request.mockResolvedValue({ status: 200, data: { ok: true }, headers: { 'content-type': 'application/json' }, url: '' })
    const post = () =>
      fetchWithFallback('http://192.168.1.20:7860/sdapi/v1/txt2img', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        probeUrl: 'http://192.168.1.20:7860/sdapi/v1/sd-models',
      })
    const res = await post()
    expect(res.status).toBe(200)
    const calls = env.request.mock.calls.map((c) => c[0] as { url: string; method: string })
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', 'http://192.168.1.20:7860/sdapi/v1/sd-models'],
      ['POST', 'http://192.168.1.20:7860/sdapi/v1/txt2img'],
    ])
    expect(isWebviewBlocked('http://192.168.1.20:7860/anything')).toBe(true)
    // Proven: the next POST skips the WebView.
    fetchFn.mockClear()
    env.request.mockClear()
    await post()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(env.request).toHaveBeenCalledTimes(1)
  })

  it('never re-sends a POST when the probe reaches the server through the WebView', async () => {
    // A billed image generation: the POST failed after it may have run (a gateway error page
    // without CORS headers), while GET requests work.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit = {}) =>
        init.method === 'POST' ? Promise.reject(new TypeError('Failed to fetch')) : new Response('{"data":[]}'),
      ),
    )
    await expect(
      fetchWithFallback('https://api.x.ai/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: 'Bearer xai-1', 'Content-Type': 'application/json' },
        body: '{}',
        probeUrl: 'https://api.x.ai/v1/models',
      }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(env.request).not.toHaveBeenCalled()
  })

  it('never re-sends a POST without a probe URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchWithFallback('http://192.168.1.20:7860/x', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(TypeError)
    expect(env.request).not.toHaveBeenCalled()
  })

  it('rethrows on the web', async () => {
    env.native = false
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchWithFallback('http://192.168.1.20:7860/x')).rejects.toBeInstanceOf(TypeError)
    expect(env.request).not.toHaveBeenCalled()
    expect(canUseNativeHttp()).toBe(false)
  })
})

describe('probeWebview', () => {
  it('blocked: the WebView fails, native HTTP answers (an empty 404 counts)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const native = vi.fn(async () => Promise.reject(new NativeHttpError('x', 'FileNotFoundException')))
    expect(await probeWebview('http://10.0.0.2:8080/v1/models', {}, native)).toEqual({ verdict: 'blocked' })
    expect(isWebviewBlocked('http://10.0.0.2:8080/v1/chat/completions')).toBe(true)
    resetWebviewBlocked('http://10.0.0.2:8080/')
    expect(isWebviewBlocked('http://10.0.0.2:8080/v1/chat/completions')).toBe(false)
  })

  it('unreachable: nothing answers natively either', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const refused = new NativeHttpError('Connection refused', 'ConnectException')
    const r = await probeWebview('http://10.0.0.2:8080/v1/models', {}, vi.fn(async () => Promise.reject(refused)))
    expect(r).toEqual({ verdict: 'unreachable', error: refused })
    expect(isWebviewBlocked('http://10.0.0.2:8080/')).toBe(false)
  })

  it('unproven: the WebView probe timed out', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init: RequestInit = {}) =>
            new Promise((_resolve, reject) =>
              init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
            ),
        ),
      )
      const native = vi.fn()
      const pending = probeWebview('http://10.0.0.2:8080/v1/models', { timeoutMs: 1000 }, native)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await pending).toEqual({ verdict: 'unproven' })
      expect(native).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('helpers', () => {
  it('knows a blocked fetch from an abort', () => {
    expect(isFetchBlocked(new TypeError('Failed to fetch'))).toBe(true)
    expect(isFetchBlocked(new DOMException('aborted', 'AbortError'))).toBe(false)
  })

  it('builds Responses from native answers, bodiless statuses included', async () => {
    expect(await toResponse({ status: 200, text: 'x', headers: { 'content-type': 'text/plain' } }).text()).toBe('x')
    expect(toResponse({ status: 204, text: '', headers: {} }).status).toBe(204)
    expect(() => toResponse({ status: 0, text: '', headers: {} })).toThrow(RangeError)
  })
})
