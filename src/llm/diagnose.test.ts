import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebug } from '../store/debug'
import type { ConnectionSettings } from '../types'
import { LlmError, resetJsonModeCache } from './client'
import { explainError, looksLikeModelError, sameModel, testConnection } from './diagnose'

const conn = (patch: Partial<ConnectionSettings> = {}): ConnectionSettings => ({
  preset: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  storyModel: 'llama3.1',
  judgeModel: '',
  storyTemperature: 0.9,
  maxTokens: 600,
  ...patch,
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const models = (...ids: string[]) => json({ object: 'list', data: ids.map((id) => ({ id })) })
const completion = (content: string) => json({ choices: [{ message: { role: 'assistant', content } }] })
const opaque = () => ({ type: 'opaque', status: 0, ok: false }) as unknown as Response

interface Handlers {
  models?: () => Response | Promise<Response>
  complete?: (body: Record<string, unknown>) => Response | Promise<Response>
  /** What a mode:'no-cors' probe does: resolve (reachable) or reject (unreachable). */
  probe?: 'reachable' | 'unreachable'
}

let seen: { url: string; mode?: string; body?: Record<string, unknown> }[] = []

function route(h: Handlers) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      seen.push({ url, mode: init.mode, body })
      if (init.mode === 'no-cors') {
        if (h.probe === 'reachable') return opaque()
        throw new TypeError('Failed to fetch')
      }
      if (url.endsWith('/models')) {
        if (!h.models) throw new TypeError('Failed to fetch')
        return h.models()
      }
      if (url.endsWith('/chat/completions')) {
        if (!h.complete) throw new TypeError('Failed to fetch')
        return h.complete(body ?? {})
      }
      throw new Error(`unexpected ${url}`)
    }),
  )
}

beforeEach(() => {
  seen = []
  resetJsonModeCache()
  useDebug.getState().clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('testConnection', () => {
  it('passes all three steps on a healthy server', async () => {
    route({ models: () => models('llama3.1', 'qwen3'), complete: () => completion('ok') })
    const r = await testConnection(conn())
    expect(r.ok).toBe(true)
    expect(r.problem).toBeUndefined()
    expect(r.models).toEqual(['llama3.1', 'qwen3'])
    expect(r.steps.map((s) => s.ok)).toEqual([true, true, true])
    const post = seen.find((s) => s.url.endsWith('/chat/completions'))
    expect(post?.body).toMatchObject({ model: 'llama3.1', max_tokens: 8 })
    expect(useDebug.getState().lastByKind.test?.response).toBe('ok')
  })

  it('classifies a blocked fetch with an opaque no-cors success as CORS (Ollama fix)', async () => {
    route({ probe: 'reachable' })
    const r = await testConnection(conn())
    expect(r.ok).toBe(false)
    expect(r.problem?.kind).toBe('cors')
    expect(r.problem?.fix).toMatch(/OLLAMA_ORIGINS/)
    expect(r.problem?.fix).toMatch(/restart Ollama/)
    expect(seen.some((s) => s.mode === 'no-cors')).toBe(true)
  })

  it('gives the LM Studio CORS fix for LM Studio', async () => {
    route({ probe: 'reachable' })
    const r = await testConnection(conn({ preset: 'lmstudio', baseUrl: 'http://localhost:1234/v1' }))
    expect(r.problem?.kind).toBe('cors')
    expect(r.problem?.fix).toMatch(/Enable CORS in LM Studio's server settings/)
  })

  it('gives a generic CORS fix for custom servers', async () => {
    route({ probe: 'reachable' })
    const r = await testConnection(conn({ preset: 'custom', baseUrl: 'http://10.0.0.5:8080/v1' }))
    expect(r.problem?.kind).toBe('cors')
    expect(r.problem?.fix).toMatch(/CORS settings/)
  })

  it('classifies a failed no-cors probe as unreachable', async () => {
    route({ probe: 'unreachable' })
    const r = await testConnection(conn({ preset: 'custom', baseUrl: 'http://localhost:9999/v1' }))
    expect(r.problem?.kind).toBe('unreachable')
    expect(r.problem?.fix).toMatch(/running/)
    expect(r.problem?.fix).toMatch(/\/v1/)
    expect(r.steps[0]).toMatchObject({ ok: false })
  })

  it('treats a /models 404 without a model set as a wrong URL', async () => {
    route({ models: () => json({ error: 'not found' }, 404) })
    const r = await testConnection(conn({ preset: 'custom', baseUrl: 'http://localhost:11434', storyModel: '' }))
    expect(r.problem?.kind).toBe('unreachable')
    expect(r.problem?.fix).toMatch(/\/v1/)
  })

  it('reports a bad key on 401/403', async () => {
    route({ models: () => json({ error: { message: 'Invalid API key' } }, 401) })
    const r = await testConnection(conn({ preset: 'custom', baseUrl: 'http://x.test/v1', apiKey: 'wrong' }))
    expect(r.problem?.kind).toBe('auth')
    expect(r.problem?.message).toMatch(/rejected the API key/)
  })

  it('flags OpenRouter without a key before the completion', async () => {
    route({ models: () => models('openai/gpt-4o-mini'), complete: () => completion('ok') })
    const r = await testConnection(
      conn({ preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', storyModel: 'openai/gpt-4o-mini' }),
    )
    expect(r.problem?.kind).toBe('auth')
    expect(r.problem?.message).toMatch(/OpenRouter needs an API key/)
    expect(seen.some((s) => s.url.endsWith('/chat/completions'))).toBe(false)
  })

  it('reports an unknown story or judge model from the list', async () => {
    route({ models: () => models('qwen3'), complete: () => completion('ok') })
    const r = await testConnection(conn())
    expect(r.problem?.kind).toBe('model')
    expect(r.problem?.message).toMatch(/story model "llama3.1"/)
    expect(r.problem?.fix).toMatch(/ollama pull llama3.1/)
    expect(r.steps[1].ok).toBe(false)
    expect(seen.some((s) => s.url.endsWith('/chat/completions'))).toBe(false)

    route({ models: () => models('llama3.1'), complete: () => completion('ok') })
    const r2 = await testConnection(conn({ judgeModel: 'tiny' }))
    expect(r2.problem?.message).toMatch(/judge model "tiny"/)
  })

  it('matches Ollama :latest tags', async () => {
    route({ models: () => models('llama3.1:latest'), complete: () => completion('ok') })
    expect((await testConnection(conn())).ok).toBe(true)
  })

  it('reports a 404 on the completion as an unknown model', async () => {
    route({ models: () => models('llama3.1'), complete: () => json({ error: { message: 'model not found' } }, 404) })
    const r = await testConnection(conn())
    expect(r.problem?.kind).toBe('model')
    expect(r.steps[2].ok).toBe(false)
  })

  it("doesn't call an unrelated 400 an unknown model when the model is listed", async () => {
    const unsupported = {
      error: {
        message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        type: 'invalid_request_error',
        param: 'max_tokens',
        code: 'unsupported_parameter',
      },
    }
    route({ models: () => models('gpt-5-mini'), complete: () => json(unsupported, 400) })
    const r = await testConnection(
      conn({ preset: 'custom', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', storyModel: 'gpt-5-mini' }),
    )
    expect(r.steps[1]).toMatchObject({ ok: true, detail: 'Found gpt-5-mini.' })
    expect(r.problem?.kind).toBe('other')
    expect(r.problem?.message).toMatch(/max_completion_tokens/)
    expect(r.problem?.fix).not.toMatch(/Pick a model/)
  })

  it('names OLLAMA_HOST when an Ollama PC on the network is unreachable', async () => {
    route({ probe: 'unreachable' })
    const r = await testConnection(conn({ baseUrl: 'http://192.168.1.20:11434/v1' }))
    expect(r.problem?.kind).toBe('unreachable')
    expect(r.problem?.fix).toMatch(/OLLAMA_HOST=0\.0\.0\.0/)
    expect(r.problem?.fix).toMatch(/192\.168\.1\.20/)
    expect(r.problem?.fix).toMatch(/same Wi-Fi/)
    expect(r.problem?.fix).not.toMatch(/localhost/)
  })

  it('names "Serve on local network" when an LM Studio PC is unreachable', async () => {
    route({ probe: 'unreachable' })
    const r = await testConnection(conn({ preset: 'lmstudio', baseUrl: 'http://192.168.1.20:1234/v1' }))
    expect(r.problem?.fix).toMatch(/Serve on local network/)
    expect(r.problem?.fix).not.toMatch(/localhost/)
  })

  it('keeps the localhost advice for loopback URLs', async () => {
    route({ probe: 'unreachable' })
    const r = await testConnection(conn({ baseUrl: 'http://127.0.0.1:11434/v1' }))
    expect(r.problem?.fix).toMatch(/ollama serve/)
    expect(r.problem?.fix).not.toMatch(/OLLAMA_HOST/)
    const lan = await testConnection(conn({ preset: 'custom', baseUrl: 'http://10.0.0.5:8080/v1' }))
    expect(lan.problem?.fix).toMatch(/same Wi-Fi/)
  })

  it('reports CORS when GET works but the POST preflight is blocked', async () => {
    route({ models: () => models('llama3.1'), probe: 'reachable' })
    const r = await testConnection(conn())
    expect(r.steps.slice(0, 2).map((s) => s.ok)).toEqual([true, true])
    expect(r.problem?.kind).toBe('cors')
  })

  it('tests with the first listed model when no story model is set', async () => {
    route({ models: () => models('m1', 'm2'), complete: () => completion('ok') })
    const r = await testConnection(conn({ storyModel: '' }))
    expect(r.ok).toBe(true)
    expect(seen.find((s) => s.url.endsWith('/chat/completions'))?.body?.model).toBe('m1')
    expect(r.steps[1].detail).toMatch(/testing with m1/)
  })

  it('reports an empty model list', async () => {
    route({ models: () => models() })
    const r = await testConnection(conn())
    expect(r.problem?.kind).toBe('model')
    expect(r.problem?.fix).toMatch(/ollama pull/)
  })

  it('continues to the completion when /models is missing but a model is set', async () => {
    route({ models: () => json({ error: 'no' }, 404), complete: () => completion('ok') })
    const r = await testConnection(conn({ preset: 'custom', baseUrl: 'http://x.test/v1', storyModel: 'm' }))
    expect(r.ok).toBe(true)
    expect(r.steps[0].ok).toBe(false)
  })

  it('rejects a missing or invalid URL without fetching', async () => {
    route({})
    expect((await testConnection(conn({ baseUrl: '' }))).problem?.kind).toBe('unreachable')
    expect((await testConnection(conn({ baseUrl: 'localhost 11434' }))).problem?.kind).toBe('unreachable')
    expect(seen).toHaveLength(0)
  })
})

describe('looksLikeModelError', () => {
  const http = (status: number, body: unknown) =>
    new LlmError('http', `HTTP ${status}: x`, { status, body: typeof body === 'string' ? body : JSON.stringify(body) })

  it('accepts real unknown-model errors', () => {
    expect(looksLikeModelError(http(404, { error: 'model "llama3.1" not found, try pulling it first' }))).toBe(true)
    expect(looksLikeModelError(http(400, { error: { message: 'foo/bar is not a valid model ID', code: 400 } }))).toBe(true)
    expect(looksLikeModelError(http(400, { error: { message: 'nope', code: 'model_not_found' } }))).toBe(true)
    expect(looksLikeModelError(http(400, { error: { message: 'bad value', param: 'model' } }))).toBe(true)
    expect(looksLikeModelError(http(400, { error: 'Invalid model identifier "x".' }))).toBe(true)
    expect(looksLikeModelError(http(400, { error: 'The model `qwen2.5-7b` does not exist.' }))).toBe(true)
  })

  it('ignores other 400s that mention the model', () => {
    const openai = (message: string, param: string) => ({ error: { message, type: 'invalid_request_error', param, code: null } })
    expect(
      looksLikeModelError(
        http(400, openai("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", 'max_tokens')),
      ),
    ).toBe(false)
    expect(
      looksLikeModelError(
        http(400, openai('max_tokens is too large: 100000. This model supports at most 16384 completion tokens, whereas you provided 100000.', 'max_tokens')),
      ),
    ).toBe(false)
    expect(
      looksLikeModelError(
        http(400, { error: 'Trying to keep the first 5000 tokens when context overflows. However, the model is loaded with context length of only 4096 tokens, which is not enough.' }),
      ),
    ).toBe(false)
  })
})

describe('sameModel', () => {
  it('treats an Ollama :latest tag as the same model', () => {
    expect(sameModel('llama3.1', 'llama3.1:latest')).toBe(true)
    expect(sameModel('LLAMA3.1:latest', 'llama3.1')).toBe(true)
    expect(sameModel('llama3.1', 'llama3.1:8b')).toBe(false)
  })
})

describe('explainError', () => {
  it('maps client errors to problems with fixes', () => {
    const c = conn()
    expect(explainError(new LlmError('http', 'HTTP 401', { status: 401 }), c).kind).toBe('auth')
    expect(explainError(new LlmError('http', 'HTTP 404', { status: 404 }), c).kind).toBe('model')
    expect(explainError(new LlmError('network', 'x'), c).kind).toBe('unreachable')
    expect(explainError(new LlmError('cors', 'x'), c).fix).toMatch(/OLLAMA_ORIGINS/)
    expect(explainError(new LlmError('timeout', 'x'), c).message).toMatch(/too long/)
    expect(explainError(new LlmError('http', 'HTTP 500: boom', { status: 500 }), c).kind).toBe('other')
  })
})
