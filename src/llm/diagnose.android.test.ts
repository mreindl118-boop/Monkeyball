// Diagnostics for phones: a PC on the Wi-Fi that doesn't answer, and the https PWA pointed at a
// plain-http LAN server (mixed content).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebug } from '../store/debug'
import { LlmError, resetJsonModeCache, type Endpoint } from './client'
import { blockedAsMixedContent, explainError, testEndpoint } from './diagnose'

const conn = (patch: Partial<Endpoint> = {}): Endpoint => ({
  preset: 'ollama',
  baseUrl: 'http://192.168.1.20:11434/v1',
  apiKey: '',
  storyModel: 'llama3.1',
  judgeModel: '',
  storyTemperature: 0.9,
  maxTokens: 600,
  ...patch,
})

let requests: string[] = []

beforeEach(() => {
  requests = []
  resetJsonModeCache()
  useDebug.getState().clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)
      throw new TypeError('Failed to fetch')
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('a PC on the Wi-Fi that does not answer', () => {
  it('Ollama: OLLAMA_HOST, same Wi-Fi, the firewall and its port', async () => {
    const r = await testEndpoint(conn())
    expect(r.problem?.kind).toBe('unreachable')
    expect(r.problem?.fix).toMatch(/OLLAMA_HOST=0\.0\.0\.0/)
    expect(r.problem?.fix).toMatch(/same Wi-Fi/)
    expect(r.problem?.fix).toMatch(/firewall allows port 11434/)
  })

  it('LM Studio: Serve on local network, same Wi-Fi, the firewall', async () => {
    const r = await testEndpoint(conn({ preset: 'lmstudio', baseUrl: 'http://10.0.0.8:1234/v1' }))
    expect(r.problem?.fix).toMatch(/Serve on local network/)
    expect(r.problem?.fix).toMatch(/same Wi-Fi/)
    expect(r.problem?.fix).toMatch(/firewall allows port 1234/)
  })

  it('any other server on 172.16-31.x: same Wi-Fi and the firewall', async () => {
    const r = await testEndpoint(conn({ preset: 'custom', baseUrl: 'http://172.20.1.4:8080/v1' }))
    expect(r.problem?.fix).toMatch(/same Wi-Fi/)
    expect(r.problem?.fix).toMatch(/firewall/)
    expect(r.problem?.fix).not.toMatch(/localhost/)
  })
})

describe('the https PWA and a plain-http server (mixed content)', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { protocol: 'https:', origin: 'https://mreindl118-boop.github.io' })
  })

  it('knows which addresses the browser blocks', () => {
    expect(blockedAsMixedContent(conn())).toBe(true)
    expect(blockedAsMixedContent(conn({ baseUrl: 'http://localhost:11434/v1' }))).toBe(false)
    expect(blockedAsMixedContent(conn({ baseUrl: 'http://127.0.0.1:11434/v1' }))).toBe(false)
    expect(blockedAsMixedContent(conn({ baseUrl: 'https://openrouter.ai/api/v1' }))).toBe(false)
    vi.stubGlobal('location', { protocol: 'http:', origin: 'http://localhost' })
    expect(blockedAsMixedContent(conn())).toBe(false)
  })

  it('explains mixed content and points to the APK, OpenRouter and the LAN server, without a request', async () => {
    const r = await testEndpoint(conn())
    expect(r.ok).toBe(false)
    expect(r.problem?.kind).toBe('unreachable')
    expect(r.problem?.message).toMatch(/mixed content/)
    expect(r.problem?.message).toMatch(/https/)
    expect(r.problem?.fix).toMatch(/Android app/)
    expect(r.problem?.fix).toMatch(/APK/)
    expect(r.problem?.fix).toMatch(/OpenRouter/)
    expect(r.problem?.fix).toMatch(/LAN server/)
    expect(requests).toEqual([])
  })

  it('says the same when a call fails mid-game', () => {
    const p = explainError(new LlmError('network', 'Failed to fetch'), conn())
    expect(p.message).toMatch(/mixed content/)
    expect(p.fix).toMatch(/OpenRouter/)
  })

  it('leaves localhost alone (a model running on the phone itself)', async () => {
    const r = await testEndpoint(conn({ baseUrl: 'http://127.0.0.1:11434/v1' }))
    expect(r.problem?.message).not.toMatch(/mixed content/)
    expect(requests.length).toBeGreaterThan(0)
  })
})
