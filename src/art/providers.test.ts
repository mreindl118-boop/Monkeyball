// The art providers against scripts/mock-llm.mjs (its /sdapi and /v1/images routes), plus the
// error mapping and the safety guards with a capturing fetch.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NativeHttpError, type FallbackInit } from '../platform/http'
import { defaultSettings } from '../store/defaults'
import type { ImageSettings, Settings } from '../types'
import { IMAGE_SAFETY } from './imagePrompt'
import {
  a1111HttpError,
  ArtError,
  base64ImageToBlob,
  createA1111Provider,
  createGrokProvider,
  DECLINED_MESSAGE,
  grokHttpError,
  normalizeImageBaseUrl,
  providerFor,
  sniffImageType,
  type ArtRequest,
} from './providers'

interface MockServer {
  listen: (port: number, host: string, cb: () => void) => void
  address: () => { port: number }
  close: (cb?: () => void) => void
}
type CreateMockServer = (options?: Record<string, unknown>) => MockServer

let createMockServer: CreateMockServer
const servers: MockServer[] = []

/** A mock server; returns its origin (http://127.0.0.1:port). */
async function start(options: Record<string, unknown> = {}): Promise<string> {
  const server = createMockServer({ quiet: true, delay: 0, ...options })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}

beforeAll(async () => {
  const url = new URL('../../scripts/mock-llm.mjs', import.meta.url).href
  const mod = (await import(/* @vite-ignore */ url)) as { createMockServer: CreateMockServer }
  createMockServer = mod.createMockServer
})

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))))
})

function settingsWith(image: Partial<ImageSettings> = {}, grokKey = ''): Settings {
  const s = defaultSettings()
  s.image = { ...s.image, enabled: true, ...image }
  s.connection.providers.grok.apiKey = grokKey
  return s
}

const PROMPT = `anime illustration, adult woman, 28 years old, teal undercut, rooftop, flirty, ${IMAGE_SAFETY.positiveClause}`
const NEGATIVE = `${IMAGE_SAFETY.negative}, lowres`

function req(image: Partial<ImageSettings> = {}, patch: Partial<ArtRequest> = {}): ArtRequest {
  return { prompt: PROMPT, negative: NEGATIVE, seed: 42, settings: settingsWith(image).image, ...patch }
}

/** A fetch that records what was sent and answers with `answer`. */
function capture(answer: (url: string, body: Record<string, unknown>) => Response | Promise<Response>) {
  const sent: { url: string; body: Record<string, unknown>; init: FallbackInit }[] = []
  const fetch = async (url: string, init: FallbackInit = {}) => {
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    sent.push({ url, body, init })
    return answer(url, body)
  }
  return { fetch, sent }
}

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC'
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const JPEG_B64 = btoa(String.fromCharCode(...JPEG_BYTES))

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function artError(p: Promise<unknown>): Promise<ArtError> {
  try {
    await p
  } catch (e) {
    if (e instanceof ArtError) return e
    throw e
  }
  throw new Error('expected an ArtError')
}

// ---------------------------------------------------------------------------

describe('helpers', () => {
  it('normalizes the server address', () => {
    expect(normalizeImageBaseUrl(' http://127.0.0.1:7860/ ')).toBe('http://127.0.0.1:7860')
    expect(normalizeImageBaseUrl('http://pc.local:7860/sdapi/v1/')).toBe('http://pc.local:7860')
    expect(normalizeImageBaseUrl('http://pc.local:7860/sdapi/v1/txt2img')).toBe('http://pc.local:7860')
    expect(normalizeImageBaseUrl('192.168.1.20:7860')).toBe('http://192.168.1.20:7860')
    expect(normalizeImageBaseUrl('http://pc:7860/docs')).toBe('http://pc:7860')
    expect(normalizeImageBaseUrl('')).toBe('')
  })

  it('tells PNG, JPEG, WebP and GIF apart from their bytes', async () => {
    expect(base64ImageToBlob(PNG_B64)?.type).toBe('image/png')
    expect(base64ImageToBlob(`data:image/png;base64,${PNG_B64}`)?.type).toBe('image/png')
    expect(base64ImageToBlob(JPEG_B64)?.type).toBe('image/jpeg')
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffImageType(new TextEncoder().encode('GIF89a'))).toBe('image/gif')
    expect(base64ImageToBlob(btoa('<html>not an image</html>'))).toBeNull()
    expect(base64ImageToBlob('%%%')).toBeNull()
    expect(base64ImageToBlob(undefined)).toBeNull()
    const blob = base64ImageToBlob(PNG_B64)!
    expect(new Uint8Array(await blob.arrayBuffer())[1]).toBe(0x50)
  })

  it('picks the provider the settings name, only when on and set up', () => {
    expect(providerFor({ ...settingsWith(), image: { ...settingsWith().image, enabled: false } })).toBeNull()
    expect(providerFor(settingsWith({ provider: 'a1111' }))?.id).toBe('a1111')
    expect(providerFor(settingsWith({ provider: 'a1111', baseUrl: '  ' }))).toBeNull()
    expect(providerFor(settingsWith({ provider: 'grok' }))).toBeNull()
    expect(providerFor(settingsWith({ provider: 'grok' }, 'xai-key'))?.id).toBe('grok')
    // Stored Phase 1 settings have no provider: A1111.
    const old = settingsWith()
    delete old.image.provider
    expect(providerFor(old)?.id).toBe('a1111')
  })
})

describe('Automatic1111 / Forge against the mock', () => {
  it('paints: txt2img with the settings, images[0] as a PNG blob, the seed from info', async () => {
    const base = await start()
    const p = createA1111Provider({ native: () => false })
    const out = await p.generate(req({ baseUrl: `${base}/` }))
    expect(out.blob.type).toBe('image/png')
    expect(out.blob.size).toBeGreaterThan(50)
    expect(out.seed).toBe(42)
  })

  it('sends width, height, steps, CFG, sampler and seed, with the safety text even when the caller left it out', async () => {
    const { fetch, sent } = capture(() => json(200, { images: [PNG_B64], info: JSON.stringify({ seed: 7 }) }))
    const p = createA1111Provider({ fetch, native: () => false })
    const out = await p.generate(req({ baseUrl: 'http://pc:7860', width: 768, height: 1152, steps: 20, cfg: 5.5, sampler: 'Euler a' }, { prompt: '(child:1.4) adult woman, 28 years old, a cat', negative: '' }))
    expect(out.seed).toBe(7)
    expect(sent[0].url).toBe('http://pc:7860/sdapi/v1/txt2img')
    expect(sent[0].init.method).toBe('POST')
    // Native fallback only after a probe proves the WebView can't reach the server.
    expect(sent[0].init.probeUrl).toBe('http://pc:7860/sdapi/v1/samplers')
    const b = sent[0].body
    expect(b).toMatchObject({ width: 768, height: 1152, steps: 20, cfg_scale: 5.5, sampler_name: 'Euler a', seed: 42, batch_size: 1, n_iter: 1 })
    expect(String(b.negative_prompt).startsWith(IMAGE_SAFETY.negative)).toBe(true)
    expect(String(b.prompt).endsWith(IMAGE_SAFETY.positiveClause)).toBe(true)
    expect(String(b.prompt)).not.toMatch(/[()]/)
  })

  it('tests the server: samplers and checkpoints, and a sampler it lacks', async () => {
    const base = await start()
    const p = createA1111Provider({ native: () => false })
    const ok = await p.test(settingsWith({ baseUrl: base, sampler: 'Euler a' }))
    expect(ok.ok).toBe(true)
    expect(ok.samplers).toContain('DPM++ 2M')
    expect(ok.models?.[0]).toMatch(/mock-anime/)
    expect(ok.message).toMatch(/^Connected to http:\/\/127\.0\.0\.1:\d+\. 1 model and 8 samplers\.$/)
    const bad = await p.test(settingsWith({ baseUrl: base, sampler: 'Heun Deluxe' }))
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain('no sampler called Heun Deluxe')
    expect(bad.samplers?.length).toBe(8)
  })

  it('maps failures: out of GPU memory, no --api, rate limits, an unknown sampler', async () => {
    const p = createA1111Provider({ native: () => false })
    const oom = await artError(p.generate(req({ baseUrl: await start({ imageFail: '1' }) })))
    expect(oom.kind).toBe('server')
    expect(oom.message).toMatch(/ran out of GPU memory/)
    const noApi = await artError(p.generate(req({ baseUrl: await start({ noSdapi: true }) })))
    expect(noApi.kind).toBe('no-api')
    expect(noApi.message).toMatch(/--api/)
    const t = await p.test(settingsWith({ baseUrl: await start({ noSdapi: true }) }))
    expect(t).toMatchObject({ ok: false })
    expect(t.message).toMatch(/API is off.*--api/)
    const busy = await artError(p.generate(req({ baseUrl: await start({ imageFail: '429' }) })))
    expect(busy.kind).toBe('rate-limit')
    const sampler = await artError(p.generate(req({ baseUrl: await start(), sampler: 'Heun Deluxe' })))
    expect(sampler.kind).toBe('bad-request')
    expect(sampler.message).toMatch(/sampler/)
  })

  it('refuses the mock without the safety text (what reaches a server always has it)', async () => {
    // A raw fetch with no safety text: the mock says so.
    const base = await start()
    const res = await fetch(`${base}/sdapi/v1/txt2img`, { method: 'POST', body: JSON.stringify({ prompt: 'a cat', negative_prompt: '' }) })
    expect(res.status).toBe(422)
    // Through the provider, the negative is always there.
    const p = createA1111Provider({ native: () => false })
    const out = await p.generate(req({ baseUrl: base }, { negative: '' }))
    expect(out.blob.type).toBe('image/png')
  })

  it('tells CORS from nothing there, and never calls a dropped request in the app a CORS problem', async () => {
    const blocked = () => Promise.reject(new TypeError('Failed to fetch'))
    const cors = await artError(createA1111Provider({ fetch: blocked, reachable: async () => true, native: () => false }).generate(req()))
    expect(cors.kind).toBe('cors')
    expect(cors.message).toContain('--cors-allow-origins=*')
    const gone = await artError(createA1111Provider({ fetch: blocked, reachable: async () => false, native: () => false }).generate(req()))
    expect(gone.kind).toBe('unreachable')
    expect(gone.message).toMatch(/Nothing answered at http:\/\/127\.0\.0\.1:7860\./)
    expect(gone.message).toMatch(/--listen/)
    const dropped = await artError(createA1111Provider({ fetch: blocked, reachable: async () => true, native: () => true }).generate(req()))
    expect(dropped.kind).toBe('network')
    expect(dropped.message).toMatch(/Nothing was sent twice/)
    const native = await artError(
      createA1111Provider({ fetch: () => Promise.reject(new NativeHttpError('Connection refused')), native: () => true }).generate(req()),
    )
    expect(native.kind).toBe('unreachable')
    // A real closed port.
    const closed = await artError(createA1111Provider({ reachable: async () => false, native: () => false }).generate(req({ baseUrl: 'http://127.0.0.1:9' })))
    expect(closed.kind).toBe('unreachable')
    const setup = await artError(createA1111Provider().generate(req({ baseUrl: '' })))
    expect(setup.kind).toBe('setup')
  })

  it('passes an abort through untouched', async () => {
    const base = await start({ imageDelay: 500 })
    const ctrl = new AbortController()
    const p = createA1111Provider({ native: () => false }).generate(req({ baseUrl: base }), ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('Grok Imagine against the mock', () => {
  const grokSettings = (image: Partial<ImageSettings> = {}) => settingsWith({ provider: 'grok', ...image }, 'secret')

  it('paints: images/generations with the key, model and aspect ratio, data[0].b64_json as a blob', async () => {
    const base = await start({ requireKey: 'secret' })
    const p = createGrokProvider({ grokBaseUrl: `${base}/v1` })
    const out = await p.generate({ ...req({ provider: 'grok' }), prompt: `${PROMPT}. ${IMAGE_SAFETY.grokClause}`, apiKey: 'secret' })
    expect(out.blob.type).toBe('image/png')
    expect(out.seed).toBe(42)
  })

  it('sends the clause, the default model and 2:3, and asks for b64_json', async () => {
    const { fetch, sent } = capture(() => json(200, { data: [{ b64_json: JPEG_B64 }] }))
    const p = createGrokProvider({ fetch, grokBaseUrl: 'https://xai.test/v1' })
    const s = grokSettings()
    delete s.image.grokModel
    delete s.image.aspectRatio
    const out = await p.generate({ prompt: 'adult woman, 28 years old, a rooftop at dawn', negative: '', seed: 1, settings: s.image, apiKey: 'secret' })
    expect(out.blob.type).toBe('image/jpeg')
    expect(sent[0].url).toBe('https://xai.test/v1/images/generations')
    expect(sent[0].init.headers).toMatchObject({ Authorization: 'Bearer secret' })
    expect(sent[0].body).toMatchObject({ model: 'grok-imagine-image', n: 1, response_format: 'b64_json', aspect_ratio: '2:3' })
    expect(String(sent[0].body.prompt).endsWith(IMAGE_SAFETY.grokClause)).toBe(true)
    expect(sent[0].body).not.toHaveProperty('negative_prompt')
  })

  it('uses the model and aspect ratio from settings, and drops aspect_ratio once when xAI names it', async () => {
    let first = true
    const { fetch, sent } = capture(() => {
      if (first) {
        first = false
        return json(400, { error: 'Argument not supported: aspect_ratio' })
      }
      return json(200, { data: [{ b64_json: PNG_B64 }] })
    })
    const p = createGrokProvider({ fetch, grokBaseUrl: 'https://xai.test/v1' })
    const image = grokSettings({ grokModel: 'grok-imagine-image-pro', aspectRatio: '3:4' }).image
    await p.generate({ prompt: 'adult man, 40 years old', negative: '', seed: 1, settings: image, apiKey: 'k' })
    expect(sent.map((s) => s.body.aspect_ratio)).toEqual(['3:4', undefined])
    expect(sent[0].body.model).toBe('grok-imagine-image-pro')
    // Remembered for that model.
    await p.generate({ prompt: 'adult man, 40 years old', negative: '', seed: 1, settings: image, apiKey: 'k' })
    expect(sent).toHaveLength(3)
    expect(sent[2].body).not.toHaveProperty('aspect_ratio')
  })

  it('maps failures: a declined prompt, a bad key, rate limits, no key', async () => {
    const declinedBase = await start({ imageFail: '1' })
    const declined = await artError(createGrokProvider({ grokBaseUrl: `${declinedBase}/v1` }).generate({ ...req({ provider: 'grok' }), apiKey: 'k' }))
    expect(declined.kind).toBe('declined')
    expect(declined.message.startsWith(DECLINED_MESSAGE)).toBe(true)
    expect(declined.message).toMatch(/keeps the placeholder/)
    const keyBase = await start({ requireKey: 'secret' })
    const auth = await artError(createGrokProvider({ grokBaseUrl: `${keyBase}/v1` }).generate({ ...req({ provider: 'grok' }), apiKey: 'wrong' }))
    expect(auth.kind).toBe('auth')
    expect(auth.message).toMatch(/Grok card/)
    const busyBase = await start({ imageFail: '429' })
    const busy = await artError(createGrokProvider({ grokBaseUrl: `${busyBase}/v1` }).generate({ ...req({ provider: 'grok' }), apiKey: 'k' }))
    expect(busy.kind).toBe('rate-limit')
    const none = await artError(createGrokProvider({ grokBaseUrl: `${busyBase}/v1` }).generate(req({ provider: 'grok' })))
    expect(none.kind).toBe('setup')
    const offline = await artError(createGrokProvider({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) }).generate({ ...req(), apiKey: 'k' }))
    expect(offline.kind).toBe('unreachable')
  })

  it('reads xAI errors', () => {
    expect(grokHttpError(400, { error: 'Generated image rejected by content moderation.' }, '', 'm').kind).toBe('declined')
    expect(grokHttpError(400, { error: { message: 'Your request violates our usage policy' } }, '', 'm').kind).toBe('declined')
    expect(grokHttpError(400, null, '', 'm').kind).toBe('declined')
    expect(grokHttpError(400, { error: 'unknown field `foo`, expected one of model, prompt' }, '', 'm').kind).toBe('bad-request')
    expect(grokHttpError(403, { error: 'Your team has no credits left' }, '', 'm').kind).toBe('billing')
    expect(grokHttpError(404, {}, '', 'grok-x').message).toMatch(/doesn't know the image model "grok-x"/)
    expect(grokHttpError(503, {}, '', 'm').kind).toBe('server')
    expect(a1111HttpError(404, { detail: 'Not Found' }, '').kind).toBe('no-api')
    expect(a1111HttpError(500, { error: 'OutOfMemoryError', errors: 'CUDA out of memory' }, '').message).toMatch(/GPU memory/)
    expect(a1111HttpError(500, { error: 'RuntimeError', errors: 'boom' }, '').message).toMatch(/failed: RuntimeError/)
  })

  it('tests the key: lists image models, and says when the chosen one is missing', async () => {
    const base = await start({ requireKey: 'secret' })
    const p = createGrokProvider({ grokBaseUrl: `${base}/v1` })
    const ok = await p.test(grokSettings())
    expect(ok).toMatchObject({ ok: true, models: ['grok-imagine-image'] })
    const missing = await p.test(grokSettings({ grokModel: 'grok-9' }))
    expect(missing.ok).toBe(false)
    expect(missing.message).toMatch(/no image model called grok-9/)
    const noKey = await p.test(settingsWith({ provider: 'grok' }))
    expect(noKey.ok).toBe(false)
    expect(noKey.message).toMatch(/xAI key/)
    const wrong = await p.test(settingsWith({ provider: 'grok' }, 'nope'))
    expect(wrong.ok).toBe(false)
    expect(wrong.message).toMatch(/didn't accept the key/)
  })

  it('only sends the key to xAI: the default address is api.x.ai', async () => {
    const { fetch, sent } = capture(() => json(200, { data: [{ b64_json: PNG_B64 }] }))
    await createGrokProvider({ fetch }).generate({ ...req({ provider: 'grok' }), apiKey: 'k' })
    expect(sent[0].url).toBe('https://api.x.ai/v1/images/generations')
  })
})

describe('providers refuse a prompt without an adult age', () => {
  it('sends nothing when the prompt has no "adult woman, 28 years old" statement', async () => {
    for (const make of [
      (f: ReturnType<typeof capture>['fetch']) => createA1111Provider({ fetch: f, native: () => false }),
      (f: ReturnType<typeof capture>['fetch']) => createGrokProvider({ fetch: f, grokBaseUrl: 'https://xai.test/v1' }),
    ]) {
      const { fetch, sent } = capture(() => json(200, { images: [PNG_B64], data: [{ b64_json: PNG_B64 }] }))
      const p = make(fetch)
      for (const prompt of ['a rooftop at dawn', 'adult woman, 17 years old, a rooftop', 'adult woman, twenty years old', `woman, 28 years old, ${IMAGE_SAFETY.positiveClause}`]) {
        const e = await artError(p.generate({ ...req({ provider: p.id }), prompt, apiKey: 'k' }))
        expect(e.kind).toBe('setup')
        expect(e.message).toMatch(/adult age/)
      }
      expect(sent).toHaveLength(0)
    }
  })
})
