// One OpenAI-compatible client: POST {baseUrl}/chat/completions (SSE streaming or plain JSON),
// GET {baseUrl}/models. Used for ChatGPT, Grok, Ollama, LM Studio, OpenRouter and Custom; Claude
// goes through ./anthropic.ts. Every chat call logs a DebugEntry to useDebug. The rest of the app
// calls ./index.ts (role-based), which resolves a route and lands here with an Endpoint.

import {
  canUseNativeHttp,
  isFetchBlocked,
  isIdempotentMethod,
  isWebviewBlocked,
  NativeHttpError,
  probeWebview,
  request as nativeRequest,
  toResponse,
  type HttpResult,
} from '../platform/http'
import { useDebug } from '../store/debug'
import type { ConnectionPreset, DebugEntry } from '../types'
import { extractJson, stripThinking } from './json'
import { isOpenAiApi, isOpenRouter, isXai, normalizeBaseUrl } from './presets'
import { createSseParser, parseSse } from './sse'

/**
 * One OpenAI-compatible server: its address and key, plus the models the two roles use on it
 * and the story settings. Built from ConnectionSettings by `endpointFor()` in ./routes.ts.
 */
export interface Endpoint {
  preset: ConnectionPreset
  baseUrl: string
  apiKey: string
  /** The model calls default to (the story model when the story role runs here). */
  storyModel: string
  /** The judge model on this server; empty means the story model. */
  judgeModel: string
  storyTemperature: number
  maxTokens: number
}

/**
 * - empty: the model spent its whole token cap (on reasoning) and wrote nothing
 *   (finish_reason 'length' with no text). Worth another try, not a reply.
 * - setup: the call can't work with the current settings (no model picked, no address, or a
 *   provider pointed at the wrong API); nothing was sent. `fix` says what to change.
 */
export type LlmErrorKind = 'network' | 'http' | 'cors' | 'aborted' | 'parse' | 'timeout' | 'empty' | 'setup'

/** Every failure the client surfaces. `kind` says what went wrong; `status`/`body` for HTTP. */
export class LlmError extends Error {
  kind: LlmErrorKind
  status?: number
  body?: string
  /**
   * 'native' when the request went through the Android app's native HTTP fallback (so a
   * failure here is not about CORS: the fallback has none).
   */
  via?: 'native'
  /** For kind 'setup': what the player should change. */
  fix?: string

  constructor(
    kind: LlmErrorKind,
    message: string,
    opts: { status?: number; body?: string; cause?: unknown; fix?: string } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'LlmError'
    this.kind = kind
    if (opts.status !== undefined) this.status = opts.status
    if (opts.body !== undefined) this.body = opts.body
    if (opts.fix !== undefined) this.fix = opts.fix
  }
}

export function isLlmError(e: unknown): e is LlmError {
  return e instanceof LlmError
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type DebugKind = DebugEntry['kind']

export interface DebugInfo {
  kind: DebugKind
  characterId?: string
  /** What the debug panel shows as the prompt; defaults to the system message. */
  prompt?: string
}

export interface ChatOptions {
  conn: Endpoint
  /** Defaults to conn.storyModel. */
  model?: string
  messages: ChatMessage[]
  /** Defaults to conn.storyTemperature. */
  temperature?: number
  /** Defaults to conn.maxTokens. */
  maxTokens?: number
  signal?: AbortSignal
  /** Time allowed until response headers, and between streamed chunks. Default 180 s. 0 disables. */
  timeoutMs?: number
  debug?: DebugInfo
}

export interface StreamChatOptions extends ChatOptions {
  /** Called with each new piece of text and the text so far. */
  onDelta?: (delta: string, full: string) => void
}

export interface JsonChatOptions<T> extends ChatOptions {
  /** Turn parsed JSON into T, or null when it doesn't fit. */
  coerce: (raw: unknown) => T | null
  /** Returned (with ok: false) when the reply still isn't usable after one retry. */
  fallback: T
}

export interface JsonChatResult<T> {
  value: T
  /** False when `value` is the fallback. */
  ok: boolean
  /** The last raw reply text. */
  raw: string
  /** True when the model declined, so `value` is the fallback. */
  refused?: boolean
}

/** Judge calls always run at this temperature (where the model accepts one). */
export const JUDGE_TEMPERATURE = 0.2

/**
 * Completion cap for OpenAI's and xAI's APIs. Their reasoning models spend completion tokens on
 * thinking before any text, so a small cap returns nothing; reply length comes from the prompt.
 * Matches Claude's cap (CLAUDE_MAX_TOKENS).
 */
export const HOSTED_MIN_TOKENS = 16_000

/**
 * reasoning_effort for OpenAI's API: chat is latency-sensitive (Claude runs at effort low too),
 * and less reasoning leaves more of the cap for the reply. Models that reject it are learned.
 */
export const OPENAI_REASONING_EFFORT = 'low'

/** The extra user message for the one JSON retry. */
export const JSON_NUDGE = 'Reply with valid JSON only. No prose, no code fences.'

export const DEFAULT_TIMEOUT_MS = 180_000

/** The judge model: conn.judgeModel, or the story model when it's empty. */
export function judgeModelOf(conn: Endpoint): string {
  return conn.judgeModel?.trim() || conn.storyModel
}

export function chatUrl(conn: Pick<Endpoint, 'baseUrl'>): string {
  return `${normalizeBaseUrl(conn.baseUrl)}/chat/completions`
}

export function modelsUrl(conn: Pick<Endpoint, 'baseUrl'>): string {
  return `${normalizeBaseUrl(conn.baseUrl)}/models`
}

/** Request headers. Authorization only when a key is set; OpenRouter also gets X-Title. */
export function headersFor(conn: Endpoint, json = true): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  const key = conn.apiKey?.trim()
  if (key) h.Authorization = `Bearer ${key}`
  if (isOpenRouter(conn)) h['X-Title'] = 'crushLAB'
  return h
}

// ---------------------------------------------------------------------------
// Parameter learning (in memory), keyed by baseUrl + model. When a server turns down an optional
// parameter with a 400 that names it, the call is retried without it and the choice is remembered.

/** Optional request parameters a server may reject. */
export type OptionalParam =
  | 'temperature'
  | 'response_format'
  | 'max_tokens'
  | 'max_completion_tokens'
  | 'reasoning_effort'

const rejectedParams = new Map<string, Set<OptionalParam>>()

function paramKey(conn: Pick<Endpoint, 'baseUrl'>, model: string): string {
  return `${normalizeBaseUrl(conn.baseUrl)}|${model}`
}

function rejectedFor(conn: Pick<Endpoint, 'baseUrl'>, model: string): Set<OptionalParam> {
  return rejectedParams.get(paramKey(conn, model)) ?? new Set()
}

function rememberRejected(conn: Pick<Endpoint, 'baseUrl'>, model: string, param: OptionalParam): void {
  const key = paramKey(conn, model)
  const set = rejectedParams.get(key) ?? new Set<OptionalParam>()
  set.add(param)
  rejectedParams.set(key, set)
}

/** False once this baseUrl+model has turned the parameter down; true otherwise. */
export function paramAllowed(conn: Pick<Endpoint, 'baseUrl'>, model: string, param: OptionalParam): boolean {
  return !rejectedFor(conn, model).has(param)
}

/** False once this baseUrl+model has rejected response_format; true otherwise. */
export function jsonModeAllowed(conn: Pick<Endpoint, 'baseUrl'>, model: string): boolean {
  return paramAllowed(conn, model, 'response_format')
}

/** Forget every learned parameter rejection (tests, and after the player changes servers). */
export function resetJsonModeCache(): void {
  rejectedParams.clear()
}

export const resetParamCache = resetJsonModeCache

/** The error object of an OpenAI-style body ({"error": {message, param, code}}), if any. */
function errorObjectOf(body: string | undefined): { param?: unknown; code?: unknown; message?: unknown } | null {
  if (!body) return null
  const parsed = extractJson(body)
  const e = parsed?.error
  return e && typeof e === 'object' ? (e as { param?: unknown; code?: unknown; message?: unknown }) : null
}

/**
 * True when an HTTP error is the server turning down response_format: the error names it as
 * its param, or its message talks about response_format / json_object / JSON mode. Other 400s
 * (an unsupported max_tokens, say) are not, even when they mention "parameter" or "json".
 */
export function rejectsJsonMode(err: unknown): boolean {
  if (!(err instanceof LlmError) || err.kind !== 'http') return false
  if (err.status !== 400 && err.status !== 404 && err.status !== 422) return false
  const e = errorObjectOf(err.body)
  if (e?.param === 'response_format') return true
  const detail = (err.body ? errorMessageFrom(err.body) : '') || err.message
  return /response_format|json_object|json_schema|json mode/i.test(detail)
}

const UNSUPPORTED = /unsupported|not supported|does not support|doesn't support|not allowed|not permitted|unrecognized|unknown (parameter|field|argument)|extra (fields|inputs)|invalid (parameter|argument)|only the default/i

/**
 * Which optional parameter a 400/422 turns down, if it names one we sent: the error's `param`,
 * or a message that names the parameter and says it isn't supported. Null otherwise.
 */
export function rejectedParam(err: unknown, sent: readonly OptionalParam[]): OptionalParam | null {
  if (!(err instanceof LlmError) || err.kind !== 'http') return null
  if (sent.includes('response_format') && rejectsJsonMode(err)) return 'response_format'
  if (err.status !== 400 && err.status !== 422) return null
  const e = errorObjectOf(err.body)
  if (typeof e?.param === 'string' && (sent as readonly string[]).includes(e.param)) return e.param as OptionalParam
  const detail = (err.body ? errorMessageFrom(err.body) : '') || err.message
  const body = err.body ?? ''
  if (!UNSUPPORTED.test(detail) && !UNSUPPORTED.test(body)) return null
  // Name the first parameter the message itself leads with ("'max_tokens' is not supported...").
  const hits = sent
    .map((p) => ({ p, at: detail.search(new RegExp(`\\b${p}\\b`)) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at)
  if (hits.length) return hits[0].p
  const inBody = sent.find((p) => new RegExp(`\\b${p}\\b`).test(body))
  return inBody ?? null
}

// ---------------------------------------------------------------------------
// Transport

/** Links a caller's signal with an internal timeout; knows which one fired. */
class Deadline {
  controller = new AbortController()
  timedOut = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly ms: number
  private readonly outer?: AbortSignal
  private readonly onOuterAbort = () => this.controller.abort()

  /** The time allowed (0 = none). */
  get timeoutMs(): number {
    return this.ms
  }

  constructor(ms: number, outer?: AbortSignal) {
    this.ms = ms
    this.outer = outer
    if (outer) {
      if (outer.aborted) this.controller.abort()
      else outer.addEventListener('abort', this.onOuterAbort, { once: true })
    }
    this.bump()
  }

  /** Restart the timer (called on every received chunk). */
  bump() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.ms > 0) {
      this.timer = setTimeout(() => {
        this.timedOut = true
        this.controller.abort()
      }, this.ms)
    }
  }

  done() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.outer?.removeEventListener('abort', this.onOuterAbort)
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Map an exception thrown by fetch or a stream read into an LlmError. */
  wrap(err: unknown, url: string): LlmError {
    if (err instanceof LlmError) return err
    if (this.timedOut) {
      return new LlmError('timeout', `The model server at ${url} took too long to answer.`, { cause: err })
    }
    if (this.outer?.aborted || isAbortError(err)) {
      return new LlmError('aborted', 'The request was cancelled.', { cause: err })
    }
    const msg = err instanceof Error ? err.message : String(err)
    return new LlmError('network', `Couldn't reach the model server at ${url} (${msg}).`, { cause: err })
  }
}

// The transport seam. Requests go through the WebView's fetch. In the Android app, when fetch
// throws a TypeError (the server sends no CORS headers, or the WebView won't reach a LAN address),
// the request is retried once through native HTTP (src/platform/http.ts). Native HTTP can't
// stream, so a streaming request asks for a plain JSON answer on that retry and the text arrives
// in one piece (readCompletion already handles non-streamed bodies). On the web nothing changes.
//
// A TypeError on a POST doesn't prove the request never reached the server (the connection can
// drop after the body went out, or a gateway can answer without CORS headers after the model ran),
// and a completion costs money. So a POST is only sent again natively once a probe (a GET of the
// server's /models with the same headers) proves the WebView can't reach that origin at all; then
// the POST's preflight failed and nothing ran. Proven origins skip the WebView from then on.

interface SendInit {
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

/** How send() may fall back to native HTTP. */
interface SendFallback {
  /** Replaces the body on the native retry (a streaming request asks for one piece). */
  nativeBody?: string
  /** A GET on the same server that proves whether the WebView can reach it (for POSTs). */
  probeUrl?: string
}

/** A native failure as an LlmError (via: native): a timeout, an empty HTTP error, or no answer. */
function nativeFailure(e: unknown, url: string, deadline: Deadline): LlmError {
  let err: LlmError
  if (e instanceof NativeHttpError && e.timedOut) {
    err = new LlmError('timeout', `The model server at ${url} took too long to answer.`, { cause: e })
  } else if (e instanceof NativeHttpError && e.httpErrorNoBody) {
    // It answered (a 4xx or 5xx with an empty body), so this isn't "unreachable".
    err = new LlmError('http', `The model server at ${url} answered with an error and no details.`, { cause: e })
  } else {
    err = deadline.wrap(e, url)
  }
  err.via = 'native'
  return err
}

/** A fetch Response from a native answer; an unusable status becomes a network LlmError. */
function responseFrom(out: HttpResult, url: string): Response {
  try {
    return toResponse(out)
  } catch (e) {
    const err = new LlmError('network', `The model server at ${url} sent an answer the app can't read (status ${out.status}).`, {
      cause: e,
    })
    err.via = 'native'
    throw err
  }
}

/** The native retry: same request, no CORS, one piece. Errors come back as LlmError (via: native). */
async function viaNative(url: string, init: SendInit, deadline: Deadline): Promise<Response> {
  let out: HttpResult
  try {
    out = await nativeRequest(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: deadline.signal,
      timeoutMs: deadline.timeoutMs,
    })
  } catch (e) {
    throw nativeFailure(e, url, deadline)
  }
  deadline.bump()
  return responseFrom(out, url)
}

/** Time allowed for each probe step (the WebView GET, then the native one). */
const PROBE_TIMEOUT_MS = 15_000

/**
 * fetch, then (Android app only) one native retry when the WebView blocked the request: GETs on
 * any TypeError, POSTs only once a probe of `fallback.probeUrl` proves the WebView can't reach
 * the origin (see the note above). Errors come back as LlmError.
 */
async function send(url: string, init: SendInit, deadline: Deadline, fallback: SendFallback = {}): Promise<Response> {
  const nativeInit = fallback.nativeBody === undefined ? init : { ...init, body: fallback.nativeBody }
  if (canUseNativeHttp() && isWebviewBlocked(url)) return viaNative(url, nativeInit, deadline)
  try {
    return await fetch(url, { ...init, signal: deadline.signal })
  } catch (e) {
    if (!isFetchBlocked(e) || deadline.signal.aborted || !canUseNativeHttp()) throw deadline.wrap(e, url)
    if (isIdempotentMethod(init.method)) return viaNative(url, nativeInit, deadline)
    if (!fallback.probeUrl) throw deadline.wrap(e, url)
    let probe: Awaited<ReturnType<typeof probeWebview>>
    try {
      probe = await probeWebview(
        fallback.probeUrl,
        {
          headers: init.headers,
          signal: deadline.signal,
          timeoutMs: deadline.timeoutMs > 0 ? Math.min(deadline.timeoutMs, PROBE_TIMEOUT_MS) : PROBE_TIMEOUT_MS,
        },
        nativeRequest,
      )
    } catch (abort) {
      throw deadline.wrap(abort, url)
    }
    deadline.bump()
    switch (probe.verdict) {
      case 'blocked':
        return viaNative(url, nativeInit, deadline)
      case 'unreachable':
        // Native HTTP got no answer either: the server is down or not listening.
        throw nativeFailure(probe.error, url, deadline)
      default:
        // The WebView reaches the server, so the POST failed in transit and may have run.
        throw deadline.wrap(e, url)
    }
  }
}

function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'name' in err && (err as { name: unknown }).name === 'AbortError'
}

/** Pull a human-readable message out of an error body ({error:{message}}, {error}, {message}, {detail}). */
export function errorMessageFrom(body: string): string {
  const parsed = extractJson(body)
  if (parsed) {
    const e = parsed.error
    if (typeof e === 'string') return e
    if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
      return (e as { message: string }).message
    }
    if (typeof parsed.message === 'string') return parsed.message
    if (typeof parsed.detail === 'string') return parsed.detail
  }
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.slice(0, 300)
}

async function httpError(res: Response): Promise<LlmError> {
  let body = ''
  try {
    body = (await res.text()).slice(0, 4000)
  } catch {
    // ignore
  }
  const detail = errorMessageFrom(body) || res.statusText || 'no details'
  return new LlmError('http', `HTTP ${res.status}: ${detail}`, { status: res.status, body })
}

/** The first choice of a completion or chunk object, if any. */
function firstChoice(obj: Record<string, unknown>): Record<string, unknown> | null {
  const choices = obj.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const c = choices[0] as Record<string, unknown> | null
  return c && typeof c === 'object' ? c : null
}

/** Content from one parsed completion or chunk object: delta.content, message.content or text. */
function contentOf(obj: Record<string, unknown>): string {
  const c = firstChoice(obj)
  if (!c) return ''
  const delta = c.delta as Record<string, unknown> | undefined
  if (delta && typeof delta.content === 'string') return delta.content
  const message = c.message as Record<string, unknown> | undefined
  if (message && typeof message.content === 'string') return message.content
  if (typeof c.text === 'string') return c.text
  return ''
}

/** A refusal message (OpenAI's `message.refusal` / `delta.refusal`), if any. */
function refusalOf(obj: Record<string, unknown>): string {
  const c = firstChoice(obj)
  if (!c) return ''
  for (const key of ['delta', 'message'] as const) {
    const part = c[key] as Record<string, unknown> | undefined
    if (part && typeof part.refusal === 'string') return part.refusal
  }
  return ''
}

function finishReasonOf(obj: Record<string, unknown>): string | null {
  const c = firstChoice(obj)
  return c && typeof c.finish_reason === 'string' ? c.finish_reason : null
}

/** A finished completion: the visible text and how it ended. */
export interface Completion {
  text: string
  /** The model declined (OpenAI `message.refusal`, or finish_reason 'content_filter'). */
  refused: boolean
  /** The provider's refusal wording, when it sent one. */
  refusal?: string
  /** finish_reason from the server ('stop', 'length', 'content_filter'...), when it sent one. */
  finishReason: string | null
}

/** An in-body error payload ({"error": ...}) as an LlmError, or null. */
function payloadError(obj: Record<string, unknown>, status: number): LlmError | null {
  if (obj.error === undefined || obj.error === null) return null
  const e = obj.error
  const message =
    typeof e === 'string'
      ? e
      : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
        ? (e as { message: string }).message
        : JSON.stringify(e)
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined
  const st = typeof code === 'number' && code >= 400 ? code : status
  return new LlmError('http', `The model server reported an error: ${message}`, {
    status: st,
    body: JSON.stringify(obj).slice(0, 4000),
  })
}

/** Filters <think>...</think> reasoning out of streamed text, even when tags split across chunks. */
function createThinkFilter() {
  let inThink = false
  let pending = ''
  const OPEN = '<think>'
  const CLOSE = '</think>'

  function partialTail(s: string, tag: string): number {
    for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) {
      if (tag.startsWith(s.slice(s.length - n).toLowerCase())) return n
    }
    return 0
  }

  return {
    push(chunk: string): string {
      let s = pending + chunk
      pending = ''
      let out = ''
      while (s) {
        const lower = s.toLowerCase()
        if (inThink) {
          const end = lower.indexOf(CLOSE)
          if (end < 0) {
            const keep = partialTail(s, CLOSE)
            pending = keep ? s.slice(s.length - keep) : ''
            return out
          }
          s = s.slice(end + CLOSE.length)
          inThink = false
        } else {
          const start = lower.indexOf(OPEN)
          if (start < 0) {
            const keep = partialTail(s, OPEN)
            out += s.slice(0, s.length - keep)
            pending = s.slice(s.length - keep)
            return out
          }
          out += s.slice(0, start)
          s = s.slice(start + OPEN.length)
          inThink = true
        }
      }
      return out
    },
    flush(): string {
      const rest = inThink ? '' : pending
      pending = ''
      return rest
    },
  }
}

/**
 * Read a completion response whatever its shape: SSE (event-stream) or a plain JSON body
 * (servers that ignore stream:true). Calls onDelta for each piece of visible text.
 */
async function readCompletion(
  res: Response,
  deadline: Deadline,
  url: string,
  onDelta?: (delta: string, full: string) => void,
): Promise<Completion> {
  const filter = createThinkFilter()
  let full = ''
  let refusal = ''
  let finishReason: string | null = null
  const emit = (piece: string) => {
    let text = filter.push(piece)
    if (!full) text = text.replace(/^\s+/, '')
    if (!text) return
    full += text
    onDelta?.(text, full)
  }
  const finish = (): Completion => {
    let text = filter.flush()
    if (!full) text = text.replace(/^\s+/, '')
    if (text) {
      full += text
      onDelta?.(text, full)
    }
    const refused = !!refusal.trim() || finishReason === 'content_filter'
    const out: Completion = { text: full.trim(), refused, finishReason }
    if (refusal.trim()) out.refusal = refusal.trim()
    return out
  }
  const take = (o: Record<string, unknown>) => {
    const piece = contentOf(o)
    if (piece) emit(piece)
    refusal += refusalOf(o)
    finishReason = finishReasonOf(o) ?? finishReason
  }

  let sawEvent = false
  let done = false
  let ended = false

  const handleData = (data: string): boolean => {
    sawEvent = true
    const d = data.trim()
    if (d === '[DONE]') {
      done = true
      return done
    }
    if (!d) return done
    let objs: unknown[]
    try {
      objs = [JSON.parse(d)]
    } catch {
      // Multi-line data joined with "\n" from a server that skipped the blank lines.
      objs = []
      for (const line of d.split('\n')) {
        const l = line.trim()
        if (!l || l === '[DONE]') {
          if (l === '[DONE]') done = true
          continue
        }
        try {
          objs.push(JSON.parse(l))
        } catch {
          // skip garbage lines
        }
      }
    }
    for (const o of objs) {
      if (!o || typeof o !== 'object') continue
      const err = payloadError(o as Record<string, unknown>, res.status)
      if (err) throw err
      take(o as Record<string, unknown>)
    }
    return done
  }

  const handleJsonBody = (raw: string): Completion => {
    const trimmed = raw.trim()
    if (/^(data:|event:|:)/.test(trimmed)) {
      // An event stream labelled as JSON (or buffered by a proxy): parse it as SSE.
      for (const ev of parseSse(trimmed)) {
        if (handleData(ev.data)) break
      }
      return finish()
    }
    let obj: unknown
    try {
      obj = JSON.parse(trimmed)
    } catch {
      obj = extractJson(trimmed)
    }
    if (!obj || typeof obj !== 'object') {
      throw new LlmError('parse', "The model server's reply wasn't a chat completion.", {
        status: res.status,
        body: raw.slice(0, 4000),
      })
    }
    const err = payloadError(obj as Record<string, unknown>, res.status)
    if (err) throw err
    take(obj as Record<string, unknown>)
    return finish()
  }

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
  if (!res.body || contentType.includes('application/json')) {
    let raw: string
    try {
      raw = await res.text()
    } catch (e) {
      throw deadline.wrap(e, url)
    }
    return handleJsonBody(raw)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  let raw = ''
  try {
    while (!done) {
      const { value, done: streamDone } = await reader.read()
      deadline.bump()
      if (streamDone) {
        ended = true
        break
      }
      const text = decoder.decode(value, { stream: true })
      if (!sawEvent && raw.length < 65536) raw += text
      for (const ev of parser.feed(text)) {
        handleData(ev.data)
        if (done) break
      }
    }
    if (!done) {
      const tail = decoder.decode()
      if (!sawEvent && tail) raw += tail
      for (const ev of [...parser.feed(tail), ...parser.end()]) {
        handleData(ev.data)
        if (done) break
      }
    }
  } catch (e) {
    throw deadline.wrap(e, url)
  } finally {
    // Stop the body when we're done early ([DONE], an error payload, a timeout).
    if (!ended) reader.cancel().catch(() => undefined)
  }

  if (!sawEvent) {
    // A server that ignored stream:true without saying application/json.
    if (raw.trim()) return handleJsonBody(raw)
    return finish()
  }
  return finish()
}

interface RequestArgs {
  conn: Endpoint
  body: Record<string, unknown>
  signal?: AbortSignal
  timeoutMs?: number
  onDelta?: (delta: string, full: string) => void
}

async function postCompletion(args: RequestArgs): Promise<Completion> {
  const url = chatUrl(args.conn)
  const deadline = new Deadline(args.timeoutMs ?? DEFAULT_TIMEOUT_MS, args.signal)
  try {
    // Native HTTP can't stream: its retry asks for the whole answer at once.
    const nativeBody = args.body.stream === true ? JSON.stringify({ ...args.body, stream: false }) : undefined
    const res = await send(
      url,
      { method: 'POST', headers: headersFor(args.conn), body: JSON.stringify(args.body) },
      deadline,
      { nativeBody, probeUrl: modelsUrl(args.conn) },
    )
    deadline.bump()
    if (!res.ok) throw await httpError(res)
    return await readCompletion(res, deadline, url, args.onDelta)
  } finally {
    deadline.done()
  }
}

function modelOf(opts: ChatOptions): string {
  return opts.model ?? opts.conn.storyModel
}

/** The completion cap: the caller's, raised to HOSTED_MIN_TOKENS on OpenAI's and xAI's APIs. */
export function tokenCap(conn: Endpoint, requested?: number): number {
  const n = requested ?? conn.maxTokens
  if (!n || n <= 0) return 0
  return isOpenAiApi(conn) || isXai(conn) ? Math.max(n, HOSTED_MIN_TOKENS) : n
}

/** The request body, leaving out parameters this server+model has turned down before. */
function bodyFor(
  opts: ChatOptions,
  stream: boolean,
  jsonMode: boolean,
): { body: Record<string, unknown>; sent: OptionalParam[] } {
  const model = modelOf(opts)
  const rejected = rejectedFor(opts.conn, model)
  const sent: OptionalParam[] = []
  const body: Record<string, unknown> = { model, messages: opts.messages, stream }
  const temperature = opts.temperature ?? opts.conn.storyTemperature
  if (typeof temperature === 'number' && !rejected.has('temperature')) {
    body.temperature = temperature
    sent.push('temperature')
  }
  const cap = tokenCap(opts.conn, opts.maxTokens)
  if (cap > 0) {
    // OpenAI's API wants max_completion_tokens; everyone else knows max_tokens. Either one a
    // server turned down is swapped for the other.
    const order: OptionalParam[] = isOpenAiApi(opts.conn)
      ? ['max_completion_tokens', 'max_tokens']
      : ['max_tokens', 'max_completion_tokens']
    const field = order.find((p) => !rejected.has(p))
    if (field) {
      body[field] = cap
      sent.push(field)
    }
  }
  if (isOpenAiApi(opts.conn) && !rejected.has('reasoning_effort')) {
    body.reasoning_effort = OPENAI_REASONING_EFFORT
    sent.push('reasoning_effort')
  }
  if (jsonMode && !rejected.has('response_format')) {
    body.response_format = { type: 'json_object' }
    sent.push('response_format')
  }
  return { body, sent }
}

function startDebug(opts: ChatOptions, defaultKind: DebugKind): string {
  const system = opts.messages.find((m) => m.role === 'system')?.content
  return useDebug.getState().log({
    kind: opts.debug?.kind ?? defaultKind,
    characterId: opts.debug?.characterId,
    prompt: opts.debug?.prompt ?? system ?? opts.messages[opts.messages.length - 1]?.content ?? '',
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
  })
}

/** How an error reads in the debug panel. */
export function debugErrorText(e: unknown): string {
  return e instanceof LlmError
    ? `${e.kind}${e.status ? ` ${e.status}` : ''}: ${e.message}${e.body ? `\n\n${e.body}` : ''}`
    : e instanceof Error
      ? e.message
      : String(e)
}

function finishDebug(id: string, result: { response?: string; error?: unknown }) {
  const patch: { response?: string; error?: string } = {}
  if (result.response !== undefined) patch.response = result.response
  if (result.error !== undefined) patch.error = debugErrorText(result.error)
  useDebug.getState().patch(id, patch)
}

/** Most parameter-learning retries per call (each drops a different parameter). */
const MAX_PARAM_RETRIES = 3

async function loggedCompletion(
  opts: ChatOptions,
  defaultKind: DebugKind,
  stream: boolean,
  jsonMode: boolean,
  onDelta?: (delta: string, full: string) => void,
): Promise<Completion> {
  const model = modelOf(opts)
  for (let attempt = 0; ; attempt++) {
    const { body, sent } = bodyFor(opts, stream, jsonMode)
    const id = startDebug(opts, defaultKind)
    try {
      const out = await postCompletion({
        conn: opts.conn,
        body,
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
        onDelta,
      })
      if (!out.refused && !out.text && out.finishReason === 'length') {
        throw new LlmError(
          'empty',
          'The model used its whole token cap before it wrote anything (finish_reason length).',
        )
      }
      finishDebug(id, {
        response: out.text,
        ...(out.refused ? { error: `Refused: ${out.refusal || `finish_reason ${out.finishReason}`}` } : {}),
      })
      return out
    } catch (e) {
      finishDebug(id, { error: e })
      // A 400 that names an optional parameter we sent: remember, and try again without it.
      const param = attempt < MAX_PARAM_RETRIES ? rejectedParam(e, sent) : null
      if (!param) throw e
      rememberRejected(opts.conn, model, param)
    }
  }
}

// ---------------------------------------------------------------------------
// Public API

/** Streamed chat completion with its finish reason and refusal flag. */
export function streamCompletion(opts: StreamChatOptions): Promise<Completion> {
  return loggedCompletion(opts, 'story', true, false, opts.onDelta)
}

/** Non-streamed chat completion with its finish reason and refusal flag. */
export function chatCompletion(opts: ChatOptions): Promise<Completion> {
  return loggedCompletion(opts, 'story', false, false)
}

/** Streamed chat completion. Resolves with the full reply text (reasoning blocks removed). */
export async function streamChat(opts: StreamChatOptions): Promise<string> {
  return (await streamCompletion(opts)).text
}

/** Non-streamed chat completion. Resolves with the reply text. */
export async function chat(opts: ChatOptions): Promise<string> {
  return (await chatCompletion(opts)).text
}

/** Parse a JSON reply defensively with a caller's coercer; null when it doesn't fit. */
export function parseJsonWith<T>(raw: string, coerce: (raw: unknown) => T | null): T | null {
  const parsed = extractJson(raw)
  if (!parsed) return null
  try {
    return coerce(parsed)
  } catch {
    return null
  }
}

/** The messages for the one JSON retry: the reply so far as the assistant, then the nudge. */
export function nudgeMessages(messages: readonly ChatMessage[], previousReply: string): ChatMessage[] {
  const retry: ChatMessage[] = [...messages]
  const previous = stripThinking(previousReply).trim()
  if (previous) retry.push({ role: 'assistant', content: previous.slice(0, 2000) })
  retry.push({ role: 'user', content: JSON_NUDGE })
  return retry
}

/**
 * JSON call: asks for JSON mode where the server allows it, parses defensively, retries once
 * with a "valid JSON only" nudge, then returns the fallback with ok:false. A refusal returns the
 * fallback straight away. Never throws for parse problems; network/HTTP errors still throw.
 */
export async function jsonChat<T>(opts: JsonChatOptions<T>): Promise<JsonChatResult<T>> {
  const first = await loggedCompletion(opts, 'judge', false, true)
  if (first.refused) return { value: opts.fallback, ok: false, raw: first.text, refused: true }
  const v1 = parseJsonWith(first.text, opts.coerce)
  if (v1 !== null) return { value: v1, ok: true, raw: first.text }

  const second = await loggedCompletion({ ...opts, messages: nudgeMessages(opts.messages, first.text) }, 'judge', false, true)
  if (second.refused) return { value: opts.fallback, ok: false, raw: second.text, refused: true }
  const v2 = parseJsonWith(second.text, opts.coerce)
  if (v2 !== null) return { value: v2, ok: true, raw: second.text }
  return { value: opts.fallback, ok: false, raw: second.text }
}

/** jsonChat with the judge model and the fixed judge temperature (0.2). */
export function judgeJson<T>(opts: JsonChatOptions<T>): Promise<JsonChatResult<T>> {
  return jsonChat({
    ...opts,
    model: judgeModelOf(opts.conn),
    temperature: JUDGE_TEMPERATURE,
    debug: opts.debug ?? { kind: 'judge' },
  })
}

/** Model ids from GET {baseUrl}/models (data[].id; also tolerates models[].name). */
export async function listModels(
  conn: Endpoint,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string[]> {
  const url = modelsUrl(conn)
  const deadline = new Deadline(opts.timeoutMs ?? 15_000, opts.signal)
  try {
    const res = await send(url, { method: 'GET', headers: headersFor(conn, false) }, deadline)
    if (!res.ok) throw await httpError(res)
    let text: string
    try {
      text = await res.text()
    } catch (e) {
      throw deadline.wrap(e, url)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new LlmError('parse', `The server at ${url} didn't answer like an OpenAI-compatible API.`, {
        status: res.status,
        body: text.slice(0, 4000),
      })
    }
    return modelIdsFrom(parsed)
  } finally {
    deadline.done()
  }
}

/** Extract model ids from a /models body. Throws a parse LlmError when the shape is unknown. */
export function modelIdsFrom(parsed: unknown): string[] {
  const obj = parsed as { data?: unknown; models?: unknown } | null
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(obj?.data)
      ? obj.data
      : Array.isArray(obj?.models)
        ? obj.models
        : null
  if (!list) {
    throw new LlmError('parse', "The server's model list isn't in the OpenAI format.", {
      body: JSON.stringify(parsed)?.slice(0, 4000),
    })
  }
  const ids: string[] = []
  for (const m of list) {
    const id =
      typeof m === 'string'
        ? m
        : m && typeof m === 'object'
          ? ((m as { id?: unknown }).id ?? (m as { name?: unknown }).name ?? (m as { model?: unknown }).model)
          : undefined
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
  }
  return ids
}
