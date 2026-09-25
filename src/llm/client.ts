// One OpenAI-compatible client: POST {baseUrl}/chat/completions (SSE streaming or plain JSON),
// GET {baseUrl}/models. Every chat call logs a DebugEntry to useDebug.

import { useDebug } from '../store/debug'
import type { ConnectionSettings, DebugEntry } from '../types'
import { extractJson, stripThinking } from './json'
import { isOpenRouter, normalizeBaseUrl } from './presets'
import { createSseParser, parseSse } from './sse'

export type LlmErrorKind = 'network' | 'http' | 'cors' | 'aborted' | 'parse' | 'timeout'

/** Every failure the client surfaces. `kind` says what went wrong; `status`/`body` for HTTP. */
export class LlmError extends Error {
  kind: LlmErrorKind
  status?: number
  body?: string

  constructor(kind: LlmErrorKind, message: string, opts: { status?: number; body?: string; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'LlmError'
    this.kind = kind
    if (opts.status !== undefined) this.status = opts.status
    if (opts.body !== undefined) this.body = opts.body
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
  conn: ConnectionSettings
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
}

/** Judge calls always run at this temperature. */
export const JUDGE_TEMPERATURE = 0.2

/** The extra user message for the one JSON retry. */
export const JSON_NUDGE = 'Reply with valid JSON only. No prose, no code fences.'

export const DEFAULT_TIMEOUT_MS = 180_000

/** The judge model: conn.judgeModel, or the story model when it's empty. */
export function judgeModelOf(conn: ConnectionSettings): string {
  return conn.judgeModel?.trim() || conn.storyModel
}

export function chatUrl(conn: Pick<ConnectionSettings, 'baseUrl'>): string {
  return `${normalizeBaseUrl(conn.baseUrl)}/chat/completions`
}

export function modelsUrl(conn: Pick<ConnectionSettings, 'baseUrl'>): string {
  return `${normalizeBaseUrl(conn.baseUrl)}/models`
}

/** Request headers. Authorization only when a key is set; OpenRouter also gets X-Title. */
export function headersFor(conn: ConnectionSettings, json = true): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  const key = conn.apiKey?.trim()
  if (key) h.Authorization = `Bearer ${key}`
  if (isOpenRouter(conn)) h['X-Title'] = 'crushLAB'
  return h
}

// ---------------------------------------------------------------------------
// JSON-mode capability cache (in memory), keyed by baseUrl + model.

const jsonModeRejected = new Set<string>()

function jsonModeKey(conn: ConnectionSettings, model: string): string {
  return `${normalizeBaseUrl(conn.baseUrl)}|${model}`
}

/** False once this baseUrl+model has rejected response_format; true otherwise. */
export function jsonModeAllowed(conn: ConnectionSettings, model: string): boolean {
  return !jsonModeRejected.has(jsonModeKey(conn, model))
}

export function resetJsonModeCache(): void {
  jsonModeRejected.clear()
}

/**
 * True when an HTTP error is the server turning down response_format: the error names it as
 * its param, or its message talks about response_format / json_object / JSON mode. Other 400s
 * (an unsupported max_tokens, say) are not, even when they mention "parameter" or "json".
 */
export function rejectsJsonMode(err: unknown): boolean {
  if (!(err instanceof LlmError) || err.kind !== 'http') return false
  if (err.status !== 400 && err.status !== 404 && err.status !== 422) return false
  const parsed = err.body ? extractJson(err.body) : null
  const e = parsed?.error
  if (e && typeof e === 'object' && (e as { param?: unknown }).param === 'response_format') return true
  const detail = (err.body ? errorMessageFrom(err.body) : '') || err.message
  return /response_format|json_object|json_schema|json mode/i.test(detail)
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

/** Content from one parsed completion or chunk object: delta.content, message.content or text. */
function contentOf(obj: Record<string, unknown>): string {
  const choices = obj.choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const c = choices[0] as Record<string, unknown> | null
  if (!c || typeof c !== 'object') return ''
  const delta = c.delta as Record<string, unknown> | undefined
  if (delta && typeof delta.content === 'string') return delta.content
  const message = c.message as Record<string, unknown> | undefined
  if (message && typeof message.content === 'string') return message.content
  if (typeof c.text === 'string') return c.text
  return ''
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
): Promise<string> {
  const filter = createThinkFilter()
  let full = ''
  const emit = (piece: string) => {
    let text = filter.push(piece)
    if (!full) text = text.replace(/^\s+/, '')
    if (!text) return
    full += text
    onDelta?.(text, full)
  }
  const finish = () => {
    let text = filter.flush()
    if (!full) text = text.replace(/^\s+/, '')
    if (text) {
      full += text
      onDelta?.(text, full)
    }
    return full.trim()
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
      const piece = contentOf(o as Record<string, unknown>)
      if (piece) emit(piece)
    }
    return done
  }

  const handleJsonBody = (raw: string): string => {
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
    emit(contentOf(obj as Record<string, unknown>))
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
  conn: ConnectionSettings
  body: Record<string, unknown>
  signal?: AbortSignal
  timeoutMs?: number
  onDelta?: (delta: string, full: string) => void
}

async function postCompletion(args: RequestArgs): Promise<string> {
  const url = chatUrl(args.conn)
  const deadline = new Deadline(args.timeoutMs ?? DEFAULT_TIMEOUT_MS, args.signal)
  try {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: headersFor(args.conn),
        body: JSON.stringify(args.body),
        signal: deadline.signal,
      })
    } catch (e) {
      throw deadline.wrap(e, url)
    }
    deadline.bump()
    if (!res.ok) throw await httpError(res)
    return await readCompletion(res, deadline, url, args.onDelta)
  } finally {
    deadline.done()
  }
}

function bodyFor(opts: ChatOptions, stream: boolean, jsonMode: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model ?? opts.conn.storyModel,
    messages: opts.messages,
    temperature: opts.temperature ?? opts.conn.storyTemperature,
    stream,
  }
  const maxTokens = opts.maxTokens ?? opts.conn.maxTokens
  if (maxTokens && maxTokens > 0) body.max_tokens = maxTokens
  if (jsonMode) body.response_format = { type: 'json_object' }
  return body
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

function finishDebug(id: string, result: { response?: string; error?: unknown }) {
  const patch: { response?: string; error?: string } = {}
  if (result.response !== undefined) patch.response = result.response
  if (result.error !== undefined) {
    const e = result.error
    patch.error =
      e instanceof LlmError
        ? `${e.kind}${e.status ? ` ${e.status}` : ''}: ${e.message}${e.body ? `\n\n${e.body}` : ''}`
        : e instanceof Error
          ? e.message
          : String(e)
  }
  useDebug.getState().patch(id, patch)
}

async function loggedCompletion(
  opts: ChatOptions,
  defaultKind: DebugKind,
  stream: boolean,
  jsonMode: boolean,
  onDelta?: (delta: string, full: string) => void,
): Promise<string> {
  const id = startDebug(opts, defaultKind)
  try {
    const text = await postCompletion({
      conn: opts.conn,
      body: bodyFor(opts, stream, jsonMode),
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      onDelta,
    })
    finishDebug(id, { response: text })
    return text
  } catch (e) {
    finishDebug(id, { error: e })
    throw e
  }
}

// ---------------------------------------------------------------------------
// Public API

/** Streamed chat completion. Resolves with the full reply text (reasoning blocks removed). */
export function streamChat(opts: StreamChatOptions): Promise<string> {
  return loggedCompletion(opts, 'story', true, false, opts.onDelta)
}

/** Non-streamed chat completion. Resolves with the reply text. */
export function chat(opts: ChatOptions): Promise<string> {
  return loggedCompletion(opts, 'story', false, false)
}

/** A completion that asks for JSON mode when allowed, falling back (and remembering) on rejection. */
async function jsonCompletion(opts: ChatOptions): Promise<string> {
  const model = opts.model ?? opts.conn.storyModel
  if (!jsonModeAllowed(opts.conn, model)) return loggedCompletion(opts, 'judge', false, false)
  try {
    return await loggedCompletion(opts, 'judge', false, true)
  } catch (e) {
    if (!rejectsJsonMode(e)) throw e
    jsonModeRejected.add(jsonModeKey(opts.conn, model))
    return loggedCompletion(opts, 'judge', false, false)
  }
}

/**
 * JSON call: parse defensively, retry once with a "valid JSON only" nudge, then return the
 * fallback with ok:false. Never throws for parse problems; network/HTTP errors still throw.
 */
export async function jsonChat<T>(opts: JsonChatOptions<T>): Promise<JsonChatResult<T>> {
  const attempt = (raw: string): T | null => {
    const parsed = extractJson(raw)
    if (!parsed) return null
    try {
      return opts.coerce(parsed)
    } catch {
      return null
    }
  }

  const first = await jsonCompletion(opts)
  const v1 = attempt(first)
  if (v1 !== null) return { value: v1, ok: true, raw: first }

  const retryMessages: ChatMessage[] = [...opts.messages]
  const previous = stripThinking(first).trim()
  if (previous) retryMessages.push({ role: 'assistant', content: previous.slice(0, 2000) })
  retryMessages.push({ role: 'user', content: JSON_NUDGE })
  const second = await jsonCompletion({ ...opts, messages: retryMessages })
  const v2 = attempt(second)
  if (v2 !== null) return { value: v2, ok: true, raw: second }
  return { value: opts.fallback, ok: false, raw: second }
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
  conn: ConnectionSettings,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string[]> {
  const url = modelsUrl(conn)
  const deadline = new Deadline(opts.timeoutMs ?? 15_000, opts.signal)
  try {
    let res: Response
    try {
      res = await fetch(url, { method: 'GET', headers: headersFor(conn, false), signal: deadline.signal })
    } catch (e) {
      throw deadline.wrap(e, url)
    }
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
