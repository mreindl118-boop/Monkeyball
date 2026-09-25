// Claude via the official Anthropic SDK. Story calls stream through client.beta.messages.stream();
// JSON, memory and test calls use client.beta.messages.create(). Every call logs a DebugEntry the
// same way the OpenAI-compatible client does. Errors come back as LlmError, mapped from the SDK's
// typed error classes.

import Anthropic from '@anthropic-ai/sdk'
import { useDebug } from '../store/debug'
import type { Effort } from '../types'
import {
  debugErrorText,
  DEFAULT_TIMEOUT_MS,
  LlmError,
  nudgeMessages,
  parseJsonWith,
  type ChatMessage,
  type DebugInfo,
  type DebugKind,
  type JsonChatResult,
} from './client'
import { claudeAcceptsEffort, claudeAcceptsSampling, claudeSupportsFallbacks } from './models'
import { normalizeBaseUrl } from './presets'
import type { JsonSchema } from './schemas'

/**
 * max_tokens for every Claude call. It caps thinking and text together (thinking is on by default
 * on Claude Opus 5), so it stays generous; reply length is set by the prompt.
 */
export const CLAUDE_MAX_TOKENS = 16000

/** The server-side refusal fallback beta ("default" mode picks the fallback model by category). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Where a Claude call goes. */
export interface ClaudeTarget {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ClaudeRequest {
  target: ClaudeTarget
  /** System messages become the top-level system prompt; the rest alternate user/assistant. */
  messages: ChatMessage[]
  /** Sent only to models that accept sampling parameters. */
  temperature?: number
  /** output_config.effort; left out for models that don't take it. */
  effort: Effort
  /** Structured output schema (JSON calls). */
  schema?: JsonSchema
  signal?: AbortSignal
  timeoutMs?: number
  debug: DebugInfo & { kind: DebugKind }
}

export interface StreamClaudeRequest extends ClaudeRequest {
  onDelta?: (delta: string, full: string) => void
}

export interface ClaudeRefusal {
  category: string | null
  explanation: string | null
}

export interface ClaudeResult {
  /** The reply text. Empty when refused: discard anything streamed before a refusal. */
  text: string
  stopReason: string | null
  refused: boolean
  refusal?: ClaudeRefusal
  /** stop_reason 'max_tokens': the text is kept but may stop mid-sentence. */
  truncated: boolean
  /** The model that answered (a server-side fallback can differ from the requested one). */
  model: string
}

// ---------------------------------------------------------------------------
// Transport (tests swap in a fake fetch through the SDK's own `fetch` option)

export interface ClaudeTransport {
  fetch?: typeof fetch
  /** Caps every retry: the SDK's own and the rate-limit retry of non-streamed calls. */
  maxRetries?: number
  /** Longest wait before the rate-limit retry, in ms. Default 10 s. */
  maxRetryWaitMs?: number
}

let transport: ClaudeTransport = {}

/** Test hook: route SDK requests through a custom fetch (and retry count). */
export function setClaudeTransport(t: ClaudeTransport): void {
  transport = t
}

/**
 * Retries. The SDK retries connection errors, its own timeouts, 408, 409, 429 and 5xx, which
 * re-sends the whole request. That's fine for the story stream (it only retries before the stream
 * starts, when nothing was generated) and for the model list (free), but a non-streamed call
 * (judge, memory, test) only gets headers once the whole generation is done, so a timeout or a
 * dropped connection there can mean a finished, billed generation. Those calls get no SDK retries;
 * run() retries them once itself, only on answers that weren't billed (429, 529 overloaded).
 */
type RetryPolicy = 'sdk' | 'none'

function clientFor(target: ClaudeTarget, timeoutMs?: number, retries: RetryPolicy = 'sdk'): Anthropic {
  const sdkRetries = retries === 'none' ? 0 : 2
  return new Anthropic({
    apiKey: target.apiKey.trim(),
    // Only the player's key: never pick up tokens or profiles from the environment.
    authToken: null,
    baseURL: normalizeBaseUrl(target.baseUrl) || 'https://api.anthropic.com',
    // The key belongs to the player and stays on their device; the SDK then sends the
    // direct-browser-access header Anthropic's CORS policy expects.
    dangerouslyAllowBrowser: true,
    maxRetries: Math.min(sdkRetries, transport.maxRetries ?? sdkRetries),
    timeout: timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    ...(transport.fetch ? { fetch: transport.fetch } : {}),
  })
}

/** An answer that wasn't billed and is worth one more try: rate limited (429) or overloaded (529). */
function unbilledBusy(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true
  if (!(err instanceof Anthropic.APIError)) return false
  return err.status === 529 || err.type === 'overloaded_error'
}

/** How long to wait before the rate-limit retry: the server's retry-after, else 2 s, capped. */
function retryWaitMs(err: unknown): number {
  const cap = transport.maxRetryWaitMs ?? 10_000
  const headers = err instanceof Anthropic.APIError ? err.headers : undefined
  const ms = Number(headers?.get('retry-after-ms') ?? Number.NaN)
  const s = Number(headers?.get('retry-after') ?? Number.NaN)
  const wait = Number.isFinite(ms) ? ms : Number.isFinite(s) ? s * 1000 : 2000
  return Math.max(0, Math.min(wait, cap))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Anthropic.APIUserAbortError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Anthropic.APIUserAbortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------------------------------------------------------------------------
// What each model accepts: rules by model id, plus what this session learned from 400s and
// from the Models API capabilities (in memory, keyed by baseUrl + model).

type Feature = 'sampling' | 'effort' | 'format' | 'fallbacks'

const learned = new Map<string, Set<Feature>>()

function featureKey(target: ClaudeTarget): string {
  return `${normalizeBaseUrl(target.baseUrl)}|${target.model.trim()}`
}

function refuse(target: ClaudeTarget, f: Feature): void {
  const key = featureKey(target)
  const set = learned.get(key) ?? new Set<Feature>()
  set.add(f)
  learned.set(key, set)
}

function known(target: ClaudeTarget, f: Feature): boolean {
  return !learned.get(featureKey(target))?.has(f)
}

export function resetClaudeCache(): void {
  learned.clear()
}

/** Whether a Claude model gets temperature (never on Opus 5, Sonnet 5, Opus 4.7+, Fable). */
export function claudeTakesTemperature(target: ClaudeTarget): boolean {
  return claudeAcceptsSampling(target.model) && known(target, 'sampling')
}

export function claudeTakesEffort(target: ClaudeTarget): boolean {
  return claudeAcceptsEffort(target.model) && known(target, 'effort')
}

function takesFormat(target: ClaudeTarget): boolean {
  return known(target, 'format')
}

function takesFallbacks(target: ClaudeTarget): boolean {
  return claudeSupportsFallbacks(target.model) && known(target, 'fallbacks')
}

/**
 * Which feature a 400 turns down, when it names one we sent. This reads the error message: the
 * one place message text is matched, because the API names the parameter only there.
 */
function rejectedFeature(err: unknown, sent: ReadonlySet<Feature>): Feature | null {
  if (!(err instanceof Anthropic.BadRequestError)) return null
  const text = `${err.message} ${JSON.stringify(err.error ?? '')}`.toLowerCase()
  if (sent.has('sampling') && /\b(temperature|top_p|top_k)\b/.test(text)) return 'sampling'
  if (sent.has('fallbacks') && /fallback|anthropic-beta|\bbetas?\b/.test(text)) return 'fallbacks'
  if (sent.has('effort') && /effort/.test(text)) return 'effort'
  if (sent.has('format') && /format|json_schema|structured|schema/.test(text)) return 'format'
  if (/output_config/.test(text)) {
    if (sent.has('format')) return 'format'
    if (sent.has('effort')) return 'effort'
  }
  return null
}

// ---------------------------------------------------------------------------
// Messages

type ClaudeParams = Anthropic.Beta.MessageCreateParamsNonStreaming

/**
 * System messages join into the top-level system prompt. The rest must start with a user turn and
 * alternate, so consecutive same-role messages merge and empty ones drop. No assistant prefill:
 * a trailing assistant message gets a short user turn after it.
 */
export function toClaudeMessages(messages: readonly ChatMessage[]): {
  system: string
  messages: Anthropic.Beta.BetaMessageParam[]
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join('\n\n')
  const turns: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const text = m.content.trim()
    if (!text) continue
    const last = turns[turns.length - 1]
    if (last && last.role === m.role) last.content = `${last.content}\n\n${text}`
    else turns.push({ role: m.role, content: text })
  }
  if (turns.length === 0 || turns[0].role !== 'user') turns.unshift({ role: 'user', content: '(Continue.)' })
  if (turns[turns.length - 1].role === 'assistant') turns.push({ role: 'user', content: '(Continue.)' })
  return { system, messages: turns }
}

function buildParams(req: ClaudeRequest): { params: ClaudeParams; sent: Set<Feature> } {
  const { target } = req
  const { system, messages } = toClaudeMessages(req.messages)
  const sent = new Set<Feature>()
  const params: ClaudeParams = { model: target.model.trim(), max_tokens: CLAUDE_MAX_TOKENS, messages }
  if (system) params.system = system
  // Thinking: never sent. Claude Opus 5 thinks by default; other models run without it.
  if (typeof req.temperature === 'number' && claudeTakesTemperature(target)) {
    params.temperature = req.temperature
    sent.add('sampling')
  }
  const output: NonNullable<ClaudeParams['output_config']> = {}
  if (claudeTakesEffort(target)) {
    output.effort = req.effort
    sent.add('effort')
  }
  if (req.schema && takesFormat(target)) {
    output.format = { type: 'json_schema', schema: req.schema }
    sent.add('format')
  }
  if (sent.has('effort') || sent.has('format')) params.output_config = output
  if (takesFallbacks(target)) {
    params.betas = [FALLBACK_BETA]
    params.fallbacks = 'default'
    sent.add('fallbacks')
  }
  return { params, sent }
}

// ---------------------------------------------------------------------------
// Errors

/** Map an SDK error to an LlmError, by class (most specific first). */
export function toLlmError(err: unknown, target: ClaudeTarget): LlmError {
  if (err instanceof LlmError) return err
  const host = normalizeBaseUrl(target.baseUrl).replace(/^https?:\/\//, '') || 'api.anthropic.com'
  const body = (e: InstanceType<typeof Anthropic.APIError>) => (e.error ? JSON.stringify(e.error).slice(0, 4000) : undefined)
  const http = (e: InstanceType<typeof Anthropic.APIError>, status: number) => {
    const b = body(e)
    // The API's own words ({"type":"error","error":{"message":...}}), not the SDK's
    // "400 {...json...}" message.
    const apiMessage = (e.error as { error?: { message?: unknown } } | undefined)?.error?.message
    const detail = typeof apiMessage === 'string' && apiMessage.trim() ? apiMessage.trim() : e.message
    return new LlmError('http', `HTTP ${status}: ${detail}`, { status, cause: e, ...(b ? { body: b } : {}) })
  }
  if (err instanceof Anthropic.APIUserAbortError) return new LlmError('aborted', 'The request was cancelled.', { cause: err })
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmError('timeout', `Anthropic (${host}) took too long to answer.`, { cause: err })
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LlmError('network', `Couldn't reach Anthropic at ${host} (${err.message}).`, { cause: err })
  }
  if (err instanceof Anthropic.AuthenticationError) return http(err, 401)
  if (err instanceof Anthropic.PermissionDeniedError) return http(err, 403)
  if (err instanceof Anthropic.NotFoundError) return http(err, 404)
  if (err instanceof Anthropic.RateLimitError) return http(err, 429)
  if (err instanceof Anthropic.BadRequestError) return http(err, 400)
  if (err instanceof Anthropic.APIError) {
    // An error event inside a stream has no HTTP status; overloaded_error is Anthropic's 529.
    const status = err.status ?? (err.type === 'overloaded_error' ? 529 : 500)
    return http(err, status)
  }
  if (err instanceof Anthropic.AnthropicError) return new LlmError('http', err.message, { cause: err })
  if (err instanceof Error && err.name === 'AbortError') return new LlmError('aborted', 'The request was cancelled.', { cause: err })
  return new LlmError('network', err instanceof Error ? err.message : String(err), { cause: err })
}

// ---------------------------------------------------------------------------
// Calls

function startDebug(req: ClaudeRequest): string {
  const system = req.messages.find((m) => m.role === 'system')?.content
  return useDebug.getState().log({
    kind: req.debug.kind,
    characterId: req.debug.characterId,
    prompt: req.debug.prompt ?? system ?? req.messages[req.messages.length - 1]?.content ?? '',
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  })
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  let out = ''
  for (const block of message.content) {
    if (block.type === 'text') out += block.text
  }
  return out.trim()
}

/** Read a finished message: refusal first, then the text. */
function resultOf(message: Anthropic.Beta.BetaMessage): ClaudeResult {
  const stopReason = message.stop_reason ?? null
  if (stopReason === 'refusal') {
    const d = message.stop_details
    return {
      text: '',
      stopReason,
      refused: true,
      refusal: { category: d?.category ?? null, explanation: d?.explanation ?? null },
      truncated: false,
      model: message.model,
    }
  }
  return { text: textOf(message), stopReason, refused: false, truncated: stopReason === 'max_tokens', model: message.model }
}

function debugResult(id: string, r: ClaudeResult): void {
  const patch: { response: string; error?: string } = { response: r.text }
  if (r.refused) {
    const why = [r.refusal?.category && `category ${r.refusal.category}`, r.refusal?.explanation].filter(Boolean).join('. ')
    patch.error = `Refused${why ? ` (${why})` : ''}.`
  } else if (r.truncated) {
    patch.error = 'Stopped at max_tokens; the reply may be cut short.'
  }
  useDebug.getState().patch(id, patch)
}

/** Most parameter-learning retries per call (each drops a different feature). */
const MAX_FEATURE_RETRIES = 4

async function run(
  req: ClaudeRequest,
  retries: RetryPolicy,
  send: (client: Anthropic, params: ClaudeParams) => Promise<Anthropic.Beta.BetaMessage>,
): Promise<ClaudeResult> {
  // Non-streamed calls: one retry of their own, only on unbilled busy answers (see RetryPolicy).
  let busyRetries = retries === 'none' ? Math.min(1, transport.maxRetries ?? 1) : 0
  for (let attempt = 0; ; attempt++) {
    const { params, sent } = buildParams(req)
    const id = startDebug(req)
    try {
      const message = await send(clientFor(req.target, req.timeoutMs, retries), params)
      const r = resultOf(message)
      debugResult(id, r)
      return r
    } catch (e) {
      const feature = attempt < MAX_FEATURE_RETRIES ? rejectedFeature(e, sent) : null
      const err = toLlmError(e, req.target)
      useDebug.getState().patch(id, { error: debugErrorText(err) })
      if (feature) {
        refuse(req.target, feature)
        continue
      }
      if (busyRetries > 0 && unbilledBusy(e)) {
        busyRetries--
        try {
          await sleep(retryWaitMs(e), req.signal)
        } catch (abort) {
          throw toLlmError(abort, req.target)
        }
        continue
      }
      throw err
    }
  }
}

/** Streamed Claude call (story). Text arrives through onDelta; the result says how it ended. */
export function streamClaude(req: StreamClaudeRequest): Promise<ClaudeResult> {
  return run(req, 'sdk', async (client, params) => {
    const stream = client.beta.messages.stream(params, { signal: req.signal })
    let full = ''
    stream.on('text', (delta) => {
      const piece = full ? delta : delta.replace(/^\s+/, '')
      if (!piece) return
      full += piece
      req.onDelta?.(piece, full)
    })
    return stream.finalMessage()
  })
}

/** Non-streamed Claude call (memory, JSON calls, the connection test). */
export function createClaude(req: ClaudeRequest): Promise<ClaudeResult> {
  return run(req, 'none', (client, params) => client.beta.messages.create(params, { signal: req.signal }))
}

/**
 * JSON call: structured output when the model takes it, defensive parse, one nudge retry, then
 * the fallback. A refusal returns the fallback straight away. Network/HTTP errors still throw.
 */
export async function claudeJson<T>(
  req: ClaudeRequest,
  coerce: (raw: unknown) => T | null,
  fallback: T,
): Promise<JsonChatResult<T>> {
  const first = await createClaude(req)
  if (first.refused) return { value: fallback, ok: false, raw: '', refused: true }
  const v1 = parseJsonWith(first.text, coerce)
  if (v1 !== null) return { value: v1, ok: true, raw: first.text }
  const second = await createClaude({ ...req, messages: nudgeMessages(req.messages, first.text) })
  if (second.refused) return { value: fallback, ok: false, raw: '', refused: true }
  const v2 = parseJsonWith(second.text, coerce)
  if (v2 !== null) return { value: v2, ok: true, raw: second.text }
  return { value: fallback, ok: false, raw: second.text }
}

/** Model ids from the Models API (newest first). Also notes which models skip effort or formats. */
export async function listClaudeModels(
  target: Omit<ClaudeTarget, 'model'>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string[]> {
  const client = clientFor({ ...target, model: '' }, opts.timeoutMs ?? 15_000)
  const ids: string[] = []
  try {
    for await (const m of client.models.list({ limit: 100 }, { signal: opts.signal })) {
      if (ids.includes(m.id)) continue
      ids.push(m.id)
      const caps = m.capabilities
      const t = { ...target, model: m.id }
      if (caps?.effort && !caps.effort.supported) refuse(t, 'effort')
      if (caps?.structured_outputs && !caps.structured_outputs.supported) refuse(t, 'format')
    }
  } catch (e) {
    throw toLlmError(e, { ...target, model: '' })
  }
  return ids
}
