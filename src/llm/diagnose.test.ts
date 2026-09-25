import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebug } from '../store/debug'
import type { ConnectionSettings } from '../types'
import { LlmError, resetJsonModeCache } from './client'
import { explainError, testConnection } from './diagnose'

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
