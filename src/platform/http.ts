// Native HTTP fallback for the Android app (ARCHITECTURE, Android first). A WebView fetch to a
// model or image server can fail with a TypeError when the server sends no CORS headers (Ollama
// without OLLAMA_ORIGINS, LM Studio with CORS off) or when the WebView won't reach it. In the APK
// such a request is retried once through CapacitorHttp, which runs outside the WebView: no CORS,
// cleartext allowed. It can't stream, so the answer arrives in one piece.
//
// The plugin ships inside @capacitor/core. capacitor.config.ts leaves its fetch patching off, so
// every other request (and every stream) still goes through the WebView's own fetch.

import { CapacitorHttp, type HttpOptions } from '@capacitor/core'
import { isNative } from './platform'

export interface HttpRequestOptions {
  /** Default GET. */
  method?: string
  headers?: Record<string, string>
  /** The request body as sent on the wire (a JSON body as its string). */
  body?: string
  /** Connect and read timeout for the native request, in ms. 0 or unset: the platform default. */
  timeoutMs?: number
  /** Stops waiting for the answer. The native request itself can't be cancelled, only ignored. */
  signal?: AbortSignal
}

export interface HttpResult {
  status: number
  /** The response body as text (a JSON body re-serialized). */
  text: string
  /** Response headers, names lower-cased. */
  headers: Record<string, string>
}

/** A native request that failed before any HTTP answer (DNS, refused, timeout...). */
export class NativeHttpError extends Error {
  /** The native exception name when the platform gives one, e.g. 'SocketTimeoutException'. */
  code?: string

  constructor(message: string, code?: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined)
    this.name = 'NativeHttpError'
    if (code) this.code = code
  }

  /** True when the platform says the connection or read timed out. */
  get timedOut(): boolean {
    return /timeout/i.test(this.code ?? '') || /timed? ?out/i.test(this.message)
  }
}

/** True where request() can go around the WebView (the Android and iOS apps). */
export function canUseNativeHttp(): boolean {
  return isNative()
}

/**
 * True for the error a WebView fetch throws when CORS, mixed content or the network blocked it:
 * a TypeError ("Failed to fetch"), not an abort.
 */
export function isFetchBlocked(err: unknown): boolean {
  return err instanceof TypeError
}

function abortError(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const e = new Error('The request was aborted.')
  e.name = 'AbortError'
  return e
}

function lowerHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h || typeof h !== 'object') return out
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    if (!k || k === 'null' || v === undefined || v === null) continue
    out[k.toLowerCase()] = String(v)
  }
  return out
}

/** The native layer hands back parsed JSON for JSON responses; turn any body back into text. */
function bodyText(data: unknown): string {
  if (data === undefined || data === null) return ''
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

function hasHeader(h: Record<string, string>, name: string): boolean {
  return Object.keys(h).some((k) => k.toLowerCase() === name)
}

/**
 * One HTTP request through the native layer. Resolves with any HTTP status (4xx and 5xx
 * included); rejects with NativeHttpError when no answer came, or an AbortError when `signal`
 * fired first. On the web this falls back to CapacitorHttp's fetch-based implementation, which
 * is only useful in tests: callers check canUseNativeHttp() first.
 */
export async function request(url: string, opts: HttpRequestOptions = {}): Promise<HttpResult> {
  const method = (opts.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  const options: HttpOptions = { url, method, headers, responseType: 'text' }
  if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    // The native layer only writes a body when there is a Content-Type.
    if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'text/plain;charset=UTF-8'
    options.data = opts.body
  }
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    options.connectTimeout = opts.timeoutMs
    options.readTimeout = opts.timeoutMs
  }

  const signal = opts.signal
  if (signal?.aborted) throw abortError(signal)

  const call = CapacitorHttp.request(options).then(
    (res) => ({ status: Number(res.status), text: bodyText(res.data), headers: lowerHeaders(res.headers) }),
    (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      const code = e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string'
        ? (e as { code: string }).code
        : undefined
      throw new NativeHttpError(message || 'The request failed.', code, e)
    },
  )
  if (!signal) return call

  return new Promise<HttpResult>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    call.then(
      (r) => {
        signal.removeEventListener('abort', onAbort)
        resolve(r)
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

/**
 * GET a text resource: the WebView's fetch first, then (in the app, when fetch is blocked) the
 * native layer. Used for small JSON documents such as the update feed.
 */
export async function getText(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<HttpResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const controller = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined
  const onOuter = () => controller.abort()
  opts.signal?.addEventListener('abort', onOuter, { once: true })
  try {
    try {
      const res = await fetch(url, { headers: opts.headers, signal: controller.signal })
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v
      })
      return { status: res.status, text: await res.text(), headers }
    } catch (e) {
      if (!isFetchBlocked(e) || !canUseNativeHttp() || controller.signal.aborted) throw e
      return await request(url, { headers: opts.headers, timeoutMs, signal: controller.signal })
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuter)
  }
}
