// Native HTTP fallback for the Android app (ARCHITECTURE, Android first). A WebView fetch to a
// model or image server can fail with a TypeError when the server sends no CORS headers (Ollama
// without OLLAMA_ORIGINS, LM Studio with CORS off) or when the WebView won't reach it. In the APK
// such a request is retried once through CapacitorHttp, which runs outside the WebView: no CORS,
// cleartext allowed. It can't stream, so the answer arrives in one piece.
//
// A TypeError doesn't prove the request never left the phone: the connection can drop after the
// body went out, or a gateway can answer without CORS headers after the server did the work. So
// GET and HEAD are retried freely, but any other method (a paid generation) only once a probe
// proves the WebView can't reach that origin at all (probeWebview): then the preflight failed and
// the original request never reached the server. Proven origins go straight to native HTTP for
// the rest of the session.
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

  /**
   * True when the server did answer, with an HTTP error and an empty body: Android's
   * HttpURLConnection then has no error stream, and reading the response throws
   * FileNotFoundException. The status itself is lost.
   */
  get httpErrorNoBody(): boolean {
    return this.code === 'FileNotFoundException'
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

/** Methods that are safe to send twice (a retry can't run a paid job again). */
export function isIdempotentMethod(method?: string): boolean {
  const m = (method ?? 'GET').toUpperCase()
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS'
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** Origins a probe proved the WebView can't reach this session (see probeWebview). */
const blockedOrigins = new Set<string>()

/** True once a probe proved the WebView can't reach this URL's origin: use native HTTP directly. */
export function isWebviewBlocked(url: string): boolean {
  const origin = originOf(url)
  return !!origin && blockedOrigins.has(origin)
}

/** Forget what the probes learned: every origin (no argument) or one URL's origin. */
export function resetWebviewBlocked(url?: string): void {
  if (url === undefined) blockedOrigins.clear()
  else blockedOrigins.delete(originOf(url))
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

/** Status codes whose Response must not carry a body. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304])

/**
 * A fetch Response built from a native answer, carrying its status and content type. Throws a
 * RangeError for a status fetch can't represent (outside 200 to 599).
 */
export function toResponse(out: HttpResult): Response {
  const headers = new Headers()
  for (const [k, v] of Object.entries(out.headers)) {
    try {
      headers.set(k, v)
    } catch {
      // A header fetch won't accept (odd characters): not needed downstream.
    }
  }
  return new Response(NULL_BODY_STATUS.has(out.status) ? null : out.text, { status: out.status, headers })
}

/**
 * What a probe found out about an origin after a non-idempotent request failed with a TypeError:
 * - 'blocked': the WebView can't reach the origin but native HTTP can, so the failed request's
 *   preflight failed and it never reached the server. Safe to send it again natively. The origin
 *   is remembered (isWebviewBlocked).
 * - 'reachable': the WebView reaches the origin, so the request failed in transit, possibly after
 *   the server got it. Don't send it again.
 * - 'unreachable': native HTTP gets no answer either (`error` says why). Nothing to retry.
 * - 'unproven': the probe itself timed out or failed in some other way. Don't send it again.
 */
export type ProbeVerdict =
  | { verdict: 'blocked' }
  | { verdict: 'reachable' }
  | { verdict: 'unreachable'; error: unknown }
  | { verdict: 'unproven' }

export interface ProbeOptions {
  /**
   * Headers for the probe GET. Pass the failed request's own (its Content-Type and Authorization)
   * so the probe gets the same kind of CORS preflight.
   */
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Per probe step. Default 15 s. */
  timeoutMs?: number
}

/**
 * Probe an origin with a GET of `probeUrl` (a cheap, idempotent URL on the same server, such as
 * its model list): first through the WebView, then, when that throws a TypeError, through native
 * HTTP. Rejects only with an abort from `signal`. `native` is the native requester (tests and the
 * model client pass their own).
 */
export async function probeWebview(
  probeUrl: string,
  opts: ProbeOptions = {},
  native: (url: string, opts: HttpRequestOptions) => Promise<HttpResult> = request,
): Promise<ProbeVerdict> {
  const outer = opts.signal
  if (outer?.aborted) throw abortError(outer)
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 15_000
  const controller = new AbortController()
  const onOuter = () => controller.abort()
  outer?.addEventListener('abort', onOuter, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let webError: unknown
  try {
    const res = await fetch(probeUrl, { method: 'GET', headers: opts.headers, signal: controller.signal })
    res.body?.cancel().catch(() => undefined)
    return { verdict: 'reachable' }
  } catch (e) {
    webError = e
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  }
  if (outer?.aborted) throw abortError(outer)
  if (!isFetchBlocked(webError)) return { verdict: 'unproven' }
  try {
    await native(probeUrl, { method: 'GET', headers: opts.headers, signal: outer, timeoutMs })
  } catch (e) {
    if (outer?.aborted) throw abortError(outer)
    // An HTTP error with an empty body is still an answer.
    if (!(e instanceof NativeHttpError && e.httpErrorNoBody)) return { verdict: 'unreachable', error: e }
  }
  blockedOrigins.add(originOf(probeUrl))
  return { verdict: 'blocked' }
}

function headerRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  new Headers(h).forEach((v, k) => {
    out[k] = v
  })
  return out
}

export interface FallbackInit extends RequestInit {
  /** Native timeout (connect and read), in ms. */
  timeoutMs?: number
  /**
   * For methods other than GET and HEAD: a GET URL on the same server (its model list, say) that
   * proves whether the WebView can reach it at all. Without one, such a request is only retried
   * natively when an earlier probe already proved the origin blocked.
   */
  probeUrl?: string
}

/**
 * fetch, and in the app one retry through native HTTP when the WebView blocked the request
 * (CORS, a LAN server). GET and HEAD retry on any TypeError; other methods only when the origin
 * is proven blocked (see probeWebview), so a paid request is never sent twice. Only string bodies
 * can take the native path; the native answer arrives whole (no streaming). For small documents
 * and image servers; the model client has its own version with timeouts and streaming
 * (src/llm/client.ts).
 */
export async function fetchWithFallback(url: string, init: FallbackInit = {}): Promise<Response> {
  const { timeoutMs, probeUrl, ...rest } = init
  const body = rest.body
  const nativeOk = canUseNativeHttp() && (body === undefined || body === null || typeof body === 'string')
  const headers = headerRecord(rest.headers)
  const viaNative = async () =>
    toResponse(
      await request(url, {
        method: rest.method,
        headers,
        body: typeof body === 'string' ? body : undefined,
        signal: rest.signal ?? undefined,
        timeoutMs,
      }),
    )
  if (nativeOk && isWebviewBlocked(url)) return viaNative()
  try {
    return await fetch(url, rest)
  } catch (e) {
    if (!isFetchBlocked(e) || !nativeOk || rest.signal?.aborted) throw e
    if (isIdempotentMethod(rest.method)) return viaNative()
    if (!probeUrl) throw e
    const probe = await probeWebview(probeUrl, { headers, signal: rest.signal ?? undefined, timeoutMs })
    if (probe.verdict !== 'blocked') throw e
    return viaNative()
  }
}
