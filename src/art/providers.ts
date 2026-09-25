// Art providers (ARCHITECTURE, Art and "Art providers: Automatic1111/Forge and Grok Imagine").
// Every generator sits behind ArtProvider so a ComfyUI adapter can be added later.
//
// - a1111: POST {baseUrl}/sdapi/v1/txt2img on an Automatic1111 or Forge server launched with --api
//   (and --cors-allow-origins=* for the web app). images[0] is a base64 PNG; info carries the seed.
// - grok: POST https://api.x.ai/v1/images/generations with the Grok connection card's key,
//   { model, prompt, n: 1, response_format: 'b64_json', aspect_ratio }. data[0].b64_json is the
//   image, data[0].revised_prompt the prompt xAI's own model rewrote it into (kept for the debug
//   panel). xAI has no negative prompt, so the prompt starts and ends with IMAGE_SAFETY.grokClause.
//
// Both make sure the locked safety text is in what they send, whoever called them: the A1111
// negative prompt starts with IMAGE_SAFETY.negative and its prompt is one line with no '#' (a
// comment in A1111 1.8+ and Forge) that ends with the positive clause, and its CFG scale is at least
// A1111_MIN_CFG (at CFG 1 the negative prompt does nothing); a Grok prompt starts and ends with the
// Grok clause. In the Android app a request the WebView blocks (CORS, a
// LAN server) goes through native HTTP like the model calls (src/platform/http.ts,
// fetchWithFallback): a POST is only sent again once a probe proves the WebView never reached the
// server, so a paid picture is never asked for twice.

import { blockedAsMixedContent } from '../llm/diagnose'
import { PRESETS } from '../llm/presets'
import { canUseNativeHttp, fetchWithFallback, isFetchBlocked, NativeHttpError, type FallbackInit } from '../platform/http'
import type { ImageProvider, ImageSettings, Settings } from '../types'
import { hasAdultAge, withGrokClause, withPositiveClause, withSafetyNegative } from './imagePrompt'

/** Grok Imagine's default model. */
export const GROK_IMAGE_MODEL = 'grok-imagine-image'
/** Grok Imagine's default aspect ratio (portrait character art). */
export const GROK_ASPECT_RATIO = '2:3'
/**
 * The lowest CFG scale sent to A1111/Forge. Guidance is uncond + cfg * (cond - uncond): at 1 the
 * negative prompt, which carries the safety floor, has no effect at all (Forge skips it), so the
 * settings and the provider both keep CFG at 2 or more.
 */
export const A1111_MIN_CFG = 2
/** What the player sees when the image service turns a prompt down (the gallery keeps the placeholder). */
export const DECLINED_MESSAGE = 'The image service declined this prompt.'

export type ArtErrorKind =
  | 'setup'
  | 'cors'
  | 'unreachable'
  | 'network'
  | 'no-api'
  | 'auth'
  | 'billing'
  | 'rate-limit'
  | 'declined'
  | 'model'
  | 'bad-request'
  | 'server'
  | 'bad-response'

/** A generation or test that failed. `message` is the whole thing to show: what, then what to do. */
export class ArtError extends Error {
  kind: ArtErrorKind
  provider: ImageProvider
  /** What went wrong, one sentence. */
  problem: string
  /** What to do about it, when there's something to do. */
  fix?: string
  status?: number

  constructor(provider: ImageProvider, kind: ArtErrorKind, problem: string, fix?: string, status?: number) {
    super(fix ? `${problem} ${fix}` : problem)
    this.name = 'ArtError'
    this.provider = provider
    this.kind = kind
    this.problem = problem
    if (fix) this.fix = fix
    if (status !== undefined) this.status = status
  }
}

/**
 * A prompt without a participant's adult age ("adult woman, 28 years old"): only prompts built by
 * buildImagePrompt reach a server, so nothing is sent.
 */
function noAge(provider: ImageProvider): ArtError {
  return new ArtError(provider, 'setup', "This picture's prompt doesn't state everyone's adult age, so it wasn't sent.")
}

export interface ArtRequest {
  prompt: string
  negative: string
  seed: number
  settings: ImageSettings
  /** Grok Imagine: the xAI key (the Grok connection card's). */
  apiKey?: string
}

export interface ArtResult {
  blob: Blob
  /** The seed the server used (A1111 reports it; Grok echoes the one asked for). */
  seed: number
  /** Optional: Grok Imagine's rewrite of the prompt (data[0].revised_prompt), what it actually painted from. */
  revisedPrompt?: string
}

export interface ArtTestResult {
  ok: boolean
  message: string
  /** A1111: the checkpoints on the server. Grok: the image models the key can use. */
  models?: string[]
  /** A1111 only: the server's sampler names. */
  samplers?: string[]
}

export interface ArtProvider {
  id: ImageProvider
  /** For the settings screen: "Automatic1111 or Forge", "Grok Imagine". */
  label: string
  /** Configured enough to try (an address, or a key). The master switch is settings.image.enabled. */
  available(settings: Settings): boolean
  generate(req: ArtRequest, signal?: AbortSignal): Promise<ArtResult>
  test(settings: Settings, signal?: AbortSignal): Promise<ArtTestResult>
}

/** What the providers need from the outside world; tests pass their own. */
export interface ProviderDeps {
  /** fetch, with the Android app's native fallback (default fetchWithFallback). */
  fetch?: (url: string, init?: FallbackInit) => Promise<Response>
  /** True when a no-cors GET reaches the URL (a CORS block rather than nothing there). */
  reachable?: (url: string, signal?: AbortSignal) => Promise<boolean>
  /** Grok's API address (default https://api.x.ai/v1; the key never goes anywhere else in the app). */
  grokBaseUrl?: string
  /** True in the Android app (a TypeError there already went through native HTTP). */
  native?: () => boolean
}

// ---------------------------------------------------------------------------
// Shared helpers

/** The server's address as typed, without trailing slashes or an /sdapi/v1 or /docs tail. */
export function normalizeImageBaseUrl(url: string): string {
  let u = String(url ?? '').trim()
  if (u && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `http://${u}`
  u = u.replace(/\/+$/, '')
  u = u.replace(/\/(?:sdapi\/v1(?:\/txt2img)?|docs)$/i, '')
  return u.replace(/\/+$/, '')
}

/** 'image/png', 'image/jpeg', 'image/webp' or 'image/gif' from the first bytes; null otherwise. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  return null
}

/** A base64 image (a data: URL prefix allowed) as a Blob of its own type; null when it isn't one. */
export function base64ImageToBlob(data: unknown): Blob | null {
  if (typeof data !== 'string') return null
  const clean = data.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!clean) return null
  let binary: string
  try {
    binary = atob(clean)
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const type = sniffImageType(bytes)
  return type ? new Blob([bytes], { type }) : null
}

function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError'
}

async function readBody(res: Response): Promise<{ json: unknown; text: string }> {
  let text = ''
  try {
    text = await res.text()
  } catch {
    return { json: null, text: '' }
  }
  try {
    return { json: JSON.parse(text), text }
  } catch {
    return { json: null, text }
  }
}

/** The server's own words from an error body: detail, error.message, message, error, errors. */
export function serverMessage(json: unknown, text = ''): string {
  const pick = (v: unknown): string => {
    if (typeof v === 'string') return v.trim()
    if (Array.isArray(v)) return v.map((x) => pick(x)).filter(Boolean).join('; ')
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      return pick(o.message ?? o.msg ?? o.detail ?? o.error ?? '')
    }
    return ''
  }
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>
    const found = pick(o.detail) || pick(o.error) || pick(o.message) || pick(o.errors)
    if (found) return found.slice(0, 300)
  }
  return text.trim().slice(0, 300)
}

async function defaultReachable(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await fetch(url, { mode: 'no-cors', signal })
    return true
  } catch {
    return false
  }
}

function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) controller.abort(signal.reason)
  else signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('The request timed out.', 'TimeoutError')), ms)
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

// ---------------------------------------------------------------------------
// Automatic1111 / Forge

const A1111_LAUNCH = 'Launch Automatic1111 or Forge with --api --cors-allow-origins=* and check the address.'

function a1111Unreachable(base: string): ArtError {
  return new ArtError(
    'a1111',
    'unreachable',
    `Nothing answered at ${base || 'the image server address'}.`,
    'Check that Automatic1111 or Forge is running with --api and that the address is right. For a PC on your Wi-Fi, launch it with --listen too, use the PC\'s address (for example http://192.168.1.20:7860) and let port 7860 through its firewall.',
  )
}

function a1111Cors(): ArtError {
  return new ArtError(
    'a1111',
    'cors',
    'The image server is up but blocks requests from this page (CORS).',
    'Launch Automatic1111 or Forge with --api --cors-allow-origins=* (or name this page\'s address instead of *), then try again.',
  )
}

function a1111MixedContent(base: string): ArtError {
  return new ArtError(
    'a1111',
    'unreachable',
    `This page is served over https, so the browser won't let it talk to ${base} over plain http (mixed content).`,
    'Use the crushLAB Android app, which can reach servers on your Wi-Fi, or switch to Grok Imagine.',
  )
}

function a1111NoApi(): ArtError {
  return new ArtError(
    'a1111',
    'no-api',
    'The image server answered, but its API is off.',
    'Launch Automatic1111 or Forge with --api (and --cors-allow-origins=* for the web app), then try again.',
    404,
  )
}

/** An A1111 HTTP error as an ArtError. */
export function a1111HttpError(status: number, json: unknown, text: string): ArtError {
  const said = serverMessage(json, text)
  // Without --api, the server's web UI answers every /sdapi path with a plain 404.
  if (status === 404 && (!said || /^not found$/i.test(said))) return a1111NoApi()
  if (/out of memory|OutOfMemory/i.test(said)) {
    return new ArtError('a1111', 'server', 'The image server ran out of GPU memory.', 'Try a smaller size or fewer steps.', status)
  }
  if (/sampler/i.test(said) && status < 500) {
    return new ArtError('a1111', 'bad-request', `The image server doesn't know that sampler: ${said}`, 'Pick another sampler in Settings, Images, or run Test to list the server\'s own.', status)
  }
  if (status === 429) {
    return new ArtError('a1111', 'rate-limit', 'The image server is busy.', 'Wait a moment, then try again.', status)
  }
  if (status === 401 || status === 403) {
    return new ArtError('a1111', 'auth', 'The image server wants a login (--api-auth), and crushLAB can\'t send one.', 'Launch it without --api-auth, then try again.', status)
  }
  if (status >= 500) {
    return new ArtError('a1111', 'server', `The image server failed${said ? `: ${said}` : ` (${status}).`}`, 'Check the server\'s console, then try again.', status)
  }
  return new ArtError('a1111', 'bad-request', `The image server turned the request down (${status})${said ? `: ${said}` : '.'}`, A1111_LAUNCH, status)
}

export function createA1111Provider(deps: ProviderDeps = {}): ArtProvider {
  const send = deps.fetch ?? fetchWithFallback
  const reachable = deps.reachable ?? defaultReachable
  const native = deps.native ?? canUseNativeHttp

  /** A failed fetch (no HTTP answer) as an ArtError. */
  const networkError = async (e: unknown, base: string, signal?: AbortSignal): Promise<ArtError> => {
    if (e instanceof NativeHttpError) return a1111Unreachable(base)
    if (!isFetchBlocked(e)) return new ArtError('a1111', 'network', `The request to the image server failed: ${e instanceof Error ? e.message : String(e)}`)
    if (native()) {
      // The app already tried native HTTP where it was safe: the WebView reached the server and
      // the request dropped on the way (not sent again), or nothing answered at all.
      return (await reachable(`${base}/sdapi/v1/samplers`, signal))
        ? new ArtError('a1111', 'network', 'The connection to the image server dropped.', 'Nothing was sent twice. Try again.')
        : a1111Unreachable(base)
    }
    return (await reachable(`${base}/sdapi/v1/samplers`, signal)) ? a1111Cors() : a1111Unreachable(base)
  }

  const call = async (url: string, base: string, init: FallbackInit, signal?: AbortSignal): Promise<Response> => {
    try {
      return await send(url, { ...init, signal })
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw e
      throw await networkError(e, base, signal)
    }
  }

  const baseOf = (image: ImageSettings): string => {
    const base = normalizeImageBaseUrl(image.baseUrl)
    if (!base) throw new ArtError('a1111', 'setup', 'There is no image server address yet.', 'Add it in Settings, Images (for example http://127.0.0.1:7860).')
    if (blockedAsMixedContent({ baseUrl: base })) throw a1111MixedContent(base)
    return base
  }

  return {
    id: 'a1111',
    label: 'Automatic1111 or Forge',

    available: (settings) => !!normalizeImageBaseUrl(settings.image?.baseUrl ?? ''),

    generate: async (req, signal) => {
      if (!hasAdultAge(req.prompt)) throw noAge('a1111')
      const image = req.settings
      const base = baseOf(image)
      const seed = Number.isFinite(req.seed) ? req.seed >>> 0 : -1
      const body = {
        prompt: withPositiveClause(req.prompt),
        negative_prompt: withSafetyNegative(req.negative),
        width: Math.round(image.width),
        height: Math.round(image.height),
        steps: Math.round(image.steps),
        cfg_scale: Math.max(A1111_MIN_CFG, Number.isFinite(image.cfg) ? image.cfg : A1111_MIN_CFG),
        sampler_name: image.sampler,
        seed,
        batch_size: 1,
        n_iter: 1,
        send_images: true,
        save_images: false,
      }
      const res = await call(
        `${base}/sdapi/v1/txt2img`,
        base,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          timeoutMs: 300_000,
          probeUrl: `${base}/sdapi/v1/samplers`,
        },
        signal,
      )
      const { json, text } = await readBody(res)
      if (!res.ok) throw a1111HttpError(res.status, json, text)
      const images = (json as { images?: unknown } | null)?.images
      const blob = Array.isArray(images) ? base64ImageToBlob(images[0]) : null
      if (!blob) throw new ArtError('a1111', 'bad-response', 'The image server answered without a picture.', 'Check the server\'s console, then try again.')
      return { blob, seed: a1111Seed((json as { info?: unknown }).info, seed) }
    },

    test: async (settings, signal) => {
      try {
        const base = baseOf(settings.image)
        const t = withTimeout(signal, 20_000)
        try {
          const res = await call(`${base}/sdapi/v1/samplers`, base, { method: 'GET', timeoutMs: 20_000 }, t.signal)
          const { json, text } = await readBody(res)
          if (!res.ok) throw a1111HttpError(res.status, json, text)
          const list = Array.isArray(json) ? (json as { name?: unknown; aliases?: unknown }[]) : []
          const samplers = list.map((s) => (typeof s?.name === 'string' ? s.name : '')).filter(Boolean)
          let models: string[] | undefined
          try {
            const m = await call(`${base}/sdapi/v1/sd-models`, base, { method: 'GET', timeoutMs: 20_000 }, t.signal)
            const mj = m.ok ? (await readBody(m)).json : null
            if (Array.isArray(mj)) {
              models = (mj as { title?: unknown; model_name?: unknown }[])
                .map((x) => (typeof x?.title === 'string' ? x.title : typeof x?.model_name === 'string' ? x.model_name : ''))
                .filter(Boolean)
            }
          } catch (e) {
            if (isAbort(e)) throw e
          }
          const wanted = settings.image.sampler.trim().toLowerCase()
          const known = list.some(
            (s) =>
              (typeof s?.name === 'string' && s.name.toLowerCase() === wanted) ||
              (Array.isArray(s?.aliases) && s.aliases.some((a) => typeof a === 'string' && a.toLowerCase() === wanted)),
          )
          const where = `Connected to ${base}.`
          if (samplers.length && wanted && !known) {
            return {
              ok: false,
              message: `${where} It has no sampler called ${settings.image.sampler}: pick one of its own.`,
              samplers,
              ...(models ? { models } : {}),
            }
          }
          const count = models?.length ? ` ${models.length} ${models.length === 1 ? 'model' : 'models'} and ${samplers.length} samplers.` : ''
          return { ok: true, message: `${where}${count}`, samplers, ...(models ? { models } : {}) }
        } finally {
          t.done()
        }
      } catch (e) {
        if (isAbort(e) && signal?.aborted) throw e
        if (e instanceof ArtError) return { ok: false, message: e.message }
        if (isAbort(e)) return { ok: false, message: 'The image server took too long to answer. Check that it is running, then try again.' }
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}

/** The seed A1111 reports in `info` (a JSON string), else the one asked for (0 for a random -1). */
export function a1111Seed(info: unknown, asked: number): number {
  let parsed: unknown = info
  if (typeof info === 'string') {
    try {
      parsed = JSON.parse(info)
    } catch {
      parsed = null
    }
  }
  const o = parsed && typeof parsed === 'object' ? (parsed as { seed?: unknown; all_seeds?: unknown }) : {}
  const seed = typeof o.seed === 'number' ? o.seed : Array.isArray(o.all_seeds) && typeof o.all_seeds[0] === 'number' ? o.all_seeds[0] : asked
  return Number.isFinite(seed) && seed >= 0 ? seed >>> 0 : 0
}

// ---------------------------------------------------------------------------
// Grok Imagine (xAI)

/** A 400 about a parameter rather than the prompt. */
const PARAMETER_PROBLEM = /\b(?:unknown|unrecognized|unsupported|invalid|unexpected|missing)\b.{0,40}\b(?:field|parameter|argument|value|param|property|key)\b|\bfield\b.{0,20}\b(?:required|not permitted|not allowed)\b|\bdeserializ|\bjson\b/i
/** A refusal of the prompt itself. */
const POLICY_PROBLEM =
  /moderat|content[\s_-]?polic|usage[\s_-]?polic|safety|not\s+allowed|disallowed|violat|inappropriate|prohibited|declin|refus|flagged|blocked|reject|nsfw|explicit|sexual/i

/** A Grok Imagine HTTP error as an ArtError. */
export function grokHttpError(status: number, json: unknown, text: string, model: string): ArtError {
  const said = serverMessage(json, text)
  if (status === 401) {
    return new ArtError('grok', 'auth', "xAI didn't accept the key.", 'Check the key on the Grok card in Settings, Connection.', status)
  }
  if (status === 403 || status === 402) {
    if (/credit|billing|spend|balance|payment|quota/i.test(said)) {
      return new ArtError('grok', 'billing', 'Your xAI account is out of credit.', 'Add credit at console.x.ai, then try again.', status)
    }
    if (POLICY_PROBLEM.test(said)) return new ArtError('grok', 'declined', DECLINED_MESSAGE, 'Try a lower heat or another scene. The gallery keeps the placeholder.', status)
    return new ArtError('grok', 'auth', `xAI refused the request${said ? `: ${said}` : '.'}`, 'Check the key on the Grok card in Settings, Connection.', status)
  }
  if (status === 404) {
    return new ArtError('grok', 'model', `xAI doesn't know the image model "${model}".`, `Try ${GROK_IMAGE_MODEL} in Settings, Images.`, status)
  }
  if (status === 429) {
    return new ArtError('grok', 'rate-limit', 'xAI is limiting how fast images can be made.', 'Wait a minute, then try again.', status)
  }
  if (status === 400 || status === 422) {
    if (!POLICY_PROBLEM.test(said) && PARAMETER_PROBLEM.test(said)) {
      return new ArtError('grok', 'bad-request', `xAI turned the request down: ${said}`, `Check the model (${model}) and aspect ratio in Settings, Images.`, status)
    }
    if (POLICY_PROBLEM.test(said) || !said) {
      return new ArtError('grok', 'declined', DECLINED_MESSAGE, 'Try a lower heat or another scene. The gallery keeps the placeholder.', status)
    }
    return new ArtError('grok', 'bad-request', `xAI turned the request down: ${said}`, undefined, status)
  }
  if (status >= 500) {
    return new ArtError('grok', 'server', `xAI's image service had a problem (${status}).`, 'Try again in a moment.', status)
  }
  return new ArtError('grok', 'bad-request', `xAI answered ${status}${said ? `: ${said}` : '.'}`, undefined, status)
}

/** The image model ids in an xAI listing (`models` or `data`). */
function modelIds(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const o = json as { models?: unknown; data?: unknown }
  const list = Array.isArray(o.models) ? o.models : Array.isArray(o.data) ? o.data : []
  return list.map((m) => (m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string' ? (m as { id: string }).id : '')).filter(Boolean)
}

/**
 * Dev builds only (`npm run dev`): localStorage key of another address for Grok Imagine, so an
 * end-to-end run can point it at the mock server (scripts/e2e/phase5.mjs). Production builds never
 * read it (`import.meta.env.DEV` is false there and the branch is dropped), and no screen offers it:
 * in the app the xAI key only ever goes to api.x.ai.
 */
export const DEV_XAI_BASE_KEY = 'crushlab.debug.xaiBase'

function devXaiBase(): string | undefined {
  if (!import.meta.env.DEV) return undefined
  try {
    const v = globalThis.localStorage?.getItem(DEV_XAI_BASE_KEY)?.trim()
    return v && /^https?:\/\//i.test(v) ? v : undefined
  } catch {
    return undefined
  }
}

export function createGrokProvider(deps: ProviderDeps = {}): ArtProvider {
  const send = deps.fetch ?? fetchWithFallback
  const baseOf = () => (deps.grokBaseUrl ?? devXaiBase() ?? PRESETS.grok.baseUrl).replace(/\/+$/, '')
  /** Models that turned down aspect_ratio (400 naming it): sent without it from then on. */
  const noAspect = new Set<string>()

  const call = async (url: string, init: FallbackInit, signal?: AbortSignal): Promise<Response> => {
    try {
      return await send(url, { ...init, signal })
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw e
      if (e instanceof NativeHttpError || isFetchBlocked(e)) {
        throw new ArtError('grok', 'unreachable', "Couldn't reach xAI.", 'Check your internet connection, then try again.')
      }
      throw new ArtError('grok', 'network', `The request to xAI failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const keyOf = (settings: Settings) => settings.connection?.providers?.grok?.apiKey?.trim() ?? ''
  const missingKey = () =>
    new ArtError('grok', 'setup', 'Grok Imagine needs your xAI key.', 'Add it on the Grok card in Settings, Connection. The same key paints the art.')

  return {
    id: 'grok',
    label: 'Grok Imagine',

    available: (settings) => !!keyOf(settings),

    generate: async (req, signal) => {
      if (!hasAdultAge(req.prompt)) throw noAge('grok')
      const key = req.apiKey?.trim()
      if (!key) throw missingKey()
      const model = req.settings.grokModel?.trim() || GROK_IMAGE_MODEL
      const aspect = req.settings.aspectRatio || GROK_ASPECT_RATIO
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
      const base = baseOf()
      const prompt = withGrokClause(req.prompt)
      const post = (withAspect: boolean) =>
        call(
          `${base}/images/generations`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ model, prompt, n: 1, response_format: 'b64_json', ...(withAspect ? { aspect_ratio: aspect } : {}) }),
            timeoutMs: 180_000,
            probeUrl: `${base}/image-generation-models`,
          },
          signal,
        )
      let withAspect = !noAspect.has(model)
      let res = await post(withAspect)
      let body = await readBody(res)
      // A 400 naming aspect_ratio made no picture (nothing billed): once more without it.
      if (withAspect && res.status === 400 && /aspect[\s_-]?ratio/i.test(serverMessage(body.json, body.text))) {
        noAspect.add(model)
        withAspect = false
        res = await post(false)
        body = await readBody(res)
      }
      if (!res.ok) throw grokHttpError(res.status, body.json, body.text, model)
      const data = (body.json as { data?: unknown } | null)?.data
      const first = Array.isArray(data) ? (data[0] as { b64_json?: unknown; revised_prompt?: unknown } | undefined) : undefined
      const blob = base64ImageToBlob(first?.b64_json)
      if (!blob) throw new ArtError('grok', 'bad-response', 'xAI answered without a picture.', 'Try again in a moment.')
      const revised = typeof first?.revised_prompt === 'string' ? first.revised_prompt.trim() : ''
      return { blob, seed: Number.isFinite(req.seed) ? req.seed >>> 0 : 0, ...(revised ? { revisedPrompt: revised.slice(0, 8000) } : {}) }
    },

    test: async (settings, signal) => {
      const key = keyOf(settings)
      if (!key) return { ok: false, message: missingKey().message }
      const model = settings.image.grokModel?.trim() || GROK_IMAGE_MODEL
      const headers = { Authorization: `Bearer ${key}` }
      const base = baseOf()
      const t = withTimeout(signal, 20_000)
      try {
        let res = await call(`${base}/image-generation-models`, { method: 'GET', headers, timeoutMs: 20_000 }, t.signal)
        let body = await readBody(res)
        let models = res.ok ? modelIds(body.json) : []
        if (res.status === 404) {
          res = await call(`${base}/models`, { method: 'GET', headers, timeoutMs: 20_000 }, t.signal)
          body = await readBody(res)
          models = res.ok ? modelIds(body.json).filter((id) => /imag/i.test(id)) : []
        }
        if (!res.ok) return { ok: false, message: grokHttpError(res.status, body.json, body.text, model).message }
        if (models.length && !models.includes(model)) {
          return { ok: false, message: `Connected to xAI, but the key has no image model called ${model}. Pick one of its own.`, models }
        }
        return { ok: true, message: `Connected to xAI. ${model} is ready.`, ...(models.length ? { models } : {}) }
      } catch (e) {
        if (isAbort(e) && signal?.aborted) throw e
        if (e instanceof ArtError) return { ok: false, message: e.message }
        if (isAbort(e)) return { ok: false, message: 'xAI took too long to answer. Try again in a moment.' }
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      } finally {
        t.done()
      }
    },
  }
}

// ---------------------------------------------------------------------------
// The app's providers

export const a1111Provider: ArtProvider = createA1111Provider()
export const grokProvider: ArtProvider = createGrokProvider()

/** Every provider by id (the settings screen tests whichever is picked, on or off). */
export const ART_PROVIDERS: Readonly<Record<ImageProvider, ArtProvider>> = Object.freeze({
  a1111: a1111Provider,
  grok: grokProvider,
})

/** The provider settings pick ('a1111' when unset). */
export function providerById(id: ImageProvider | undefined): ArtProvider {
  return id === 'grok' ? ART_PROVIDERS.grok : ART_PROVIDERS.a1111
}

/**
 * The provider that paints art with these settings: null when image generation is off or the
 * picked provider isn't set up (no server address, no xAI key).
 */
export function providerFor(settings: Settings): ArtProvider | null {
  if (!settings.image?.enabled) return null
  const p = providerById(settings.image.provider)
  return p.available(settings) ? p : null
}

/** The key a provider sends: the Grok card's for Grok Imagine, none for A1111. */
export function apiKeyFor(settings: Settings): string | undefined {
  return settings.image?.provider === 'grok' ? settings.connection?.providers?.grok?.apiKey?.trim() || undefined : undefined
}
