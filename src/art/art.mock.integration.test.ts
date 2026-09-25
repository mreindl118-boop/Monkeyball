// End to end against scripts/mock-llm.mjs: real prompt builder -> real provider -> mock server ->
// the images table -> resolveArt. The mock answers 422 when the safety text is missing, so these
// also prove what goes over the wire carries it.
import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bundledEntry } from '../data/bundled'
import { CrushDB } from '../db/db'
import { defaultSettings } from '../store/defaults'
import type { Settings } from '../types'
import { createArtEngine, useArtJobs } from './generate'
import { createA1111Provider, createGrokProvider, DECLINED_MESSAGE, type ArtProvider } from './providers'
import { configureArtUrls, createArtResolver, releaseArt } from './resolve'
import type { ArtSlot } from './types'

interface MockServer {
  listen: (port: number, host: string, cb: () => void) => void
  address: () => { port: number }
  close: (cb?: () => void) => void
}
let createMockServer: (options?: Record<string, unknown>) => MockServer
const servers: MockServer[] = []
const dbs: CrushDB[] = []

async function start(options: Record<string, unknown> = {}): Promise<string> {
  const server = createMockServer({ quiet: true, delay: 0, ...options })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}

beforeAll(async () => {
  const url = new URL('../../scripts/mock-llm.mjs', import.meta.url).href
  createMockServer = ((await import(/* @vite-ignore */ url)) as { createMockServer: typeof createMockServer }).createMockServer
  configureArtUrls({ graceMs: 0 })
})

afterEach(async () => {
  while (dbs.length) {
    const d = dbs.pop()!
    d.close()
    await d.delete()
  }
})

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))))
})

function engineFor(settings: Settings, provider: ArtProvider) {
  const db = new CrushDB(`art-mock-${Date.now()}-${dbs.length}`)
  dbs.push(db)
  const resolver = createArtResolver({ db, bundled: [], setOf: (id) => bundledEntry(id)?.setId })
  const calls: string[] = []
  const counted: ArtProvider = {
    ...provider,
    generate: (req, signal) => {
      calls.push(req.prompt)
      return provider.generate(req, signal)
    },
  }
  const engine = createArtEngine({
    resolver: () => resolver,
    settings: () => settings,
    character: (id) => bundledEntry(id)?.character,
    trust: () => 70,
    provider: (s) => (s.image.enabled ? counted : null),
    log: () => 'log',
    patchLog: () => undefined,
    compress: async (b) => b,
  })
  return { engine, resolver, calls }
}

const slot: ArtSlot = { kind: 'tier', characterId: 'nova', tier: 1 }

describe('art against the mock', () => {
  it('Automatic1111: paints, caches and resolves', async () => {
    const base = await start()
    const settings = defaultSettings()
    settings.image = { ...settings.image, enabled: true, baseUrl: base, provider: 'a1111' }
    const { engine, resolver, calls } = engineFor(settings, createA1111Provider({ native: () => false }))
    const row = await engine.generateArt(slot)
    expect(row?.blob.type).toBe('image/png')
    expect(Number.isInteger(row?.seed)).toBe(true)
    await engine.generateArt(slot)
    expect(calls).toHaveLength(1)
    const art = await resolver.resolveArt(slot)
    expect(art.source).toBe('generated')
    releaseArt(art)
  })

  it('Grok Imagine: paints the Polycule as one picture', async () => {
    const base = await start({ requireKey: 'xai-secret' })
    const settings = defaultSettings()
    settings.image = { ...settings.image, enabled: true, provider: 'grok' }
    settings.connection.providers.grok.apiKey = 'xai-secret'
    const { engine, resolver } = engineFor(settings, createGrokProvider({ grokBaseUrl: `${base}/v1` }))
    engine.onEnding('nova', 'polycule', ['kai'])
    await engine.idle()
    const art = await resolver.resolveArt({ kind: 'ending', characterId: 'kai', ending: 'polycule' })
    expect(art).toMatchObject({ source: 'generated', resolvedKey: 'group:kai+nova:polycule' })
    releaseArt(art)
  })

  it('Grok Imagine: a declined prompt leaves the placeholder and says so', async () => {
    const base = await start({ imageFail: '1' })
    const settings = defaultSettings()
    settings.image = { ...settings.image, enabled: true, provider: 'grok' }
    settings.connection.providers.grok.apiKey = 'k'
    const { engine, resolver } = engineFor(settings, createGrokProvider({ grokBaseUrl: `${base}/v1` }))
    engine.onUnlock('nova', [1])
    await engine.idle()
    expect((await resolver.resolveArt(slot)).source).toBe('placeholder')
    expect(useArtJobs.getState().jobs['nova:tier-1']?.error?.startsWith(DECLINED_MESSAGE)).toBe(true)
  })
})
