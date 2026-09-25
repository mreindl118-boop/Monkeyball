// The model layer's front door. Calls name a role ('story' or 'judge') and pass the connection
// settings; the role resolves to a preset, wire format, address, key and model, and the call goes
// to Claude (./anthropic.ts, official SDK) or the OpenAI-compatible client (./client.ts). Nothing
// above src/llm needs to branch on the provider.

import type { ConnectionPreset, ConnectionSettings, ModelRole } from '../types'
import { claudeJson, claudeTakesEffort, claudeTakesTemperature, createClaude, listClaudeModels, streamClaude, type ClaudeResult, type ClaudeTarget } from './anthropic'
import {
  chatCompletion,
  jsonChat as openAiJson,
  JUDGE_TEMPERATURE,
  listModels as listOpenAiModels,
  LlmError,
  paramAllowed,
  streamCompletion,
  type ChatMessage,
  type Completion,
  type DebugInfo,
  type DebugKind,
  type JsonChatResult,
} from './client'
import { presetFor } from './presets'
import { endpointFor, endpointForRoute, resolveRoute, routeGap, slotFor, type Route } from './routes'
import { AGREEMENT_SCHEMA, JUDGE_SCHEMA, type JsonSchema } from './schemas'

export { explainError, explainRoleError, testConnection, testEndpoint } from './diagnose'
export type { ConnectionProblem, ConnectionTestResult, DiagnoseStep, ProblemKind } from './diagnose'
export { isLlmError, JSON_NUDGE, JUDGE_TEMPERATURE, LlmError } from './client'
export type { ChatMessage, DebugInfo, DebugKind, JsonChatResult } from './client'
export { chatModels, pickModels, sameModel } from './models'
export { MAIN_PRESETS, OTHER_PRESETS, PRESETS, PRESET_LIST, presetFor } from './presets'
export { endpointFor, modelsOnPreset, resolveRoute, rolePreset, routeGap, slotFor } from './routes'
export type { Route, RouteGap } from './routes'
export { AGREEMENT_SCHEMA, JUDGE_SCHEMA, suggestionsSchema } from './schemas'

export interface RoleCallOptions {
  conn: ConnectionSettings
  /** story: story and memory calls. judge: judge, agreement and suggestions calls. */
  role: ModelRole
  messages: ChatMessage[]
  /**
   * What the call is, for the debug panel and Claude's effort (story uses the Effort setting,
   * everything else 'low'). Defaults to debug.kind, then 'story' or 'judge' by role.
   */
  kind?: DebugKind
  /** Overrides the role's temperature (story: the setting; judge: 0.2). Dropped where unsupported. */
  temperature?: number
  /** Token cap for OpenAI-compatible servers (default: the Max tokens setting). Claude: always 16000. */
  maxTokens?: number
  signal?: AbortSignal
  /** Time allowed for the response to start (and, on OpenAI-compatible streams, between chunks). */
  timeoutMs?: number
  debug?: Omit<DebugInfo, 'kind'> & { kind?: DebugKind }
}

export interface StreamRoleOptions extends RoleCallOptions {
  /** Each new piece of text and the text so far. Discard what it showed when the result is refused. */
  onDelta?: (delta: string, full: string) => void
}

export interface JsonRoleOptions<T> extends RoleCallOptions {
  coerce: (raw: unknown) => T | null
  /** Returned (ok: false) when the reply isn't usable after one retry, or the model declined. */
  fallback: T
  /** Structured-output schema for Claude. Judge and agreement calls get theirs by default. */
  schema?: JsonSchema
}

export interface ChatResult {
  /** The reply. Empty when refused. */
  text: string
  /**
   * The model declined (Claude stop_reason 'refusal'; OpenAI message.refusal or a content filter).
   * The date shows an in-world beat instead (see refusalBeat) and suggests a lower heat.
   */
  refused: boolean
  refusal?: { category: string | null; explanation: string | null }
  /** Cut off at the token cap; the text is kept. */
  truncated: boolean
  /** Where the call went. */
  route: Route
  /** The model that answered (a Claude server-side fallback can differ from route.model). */
  model: string
}

/** The in-world beat a story turn shows when the model declines. */
export function refusalBeat(name: string): string {
  return `${name} changes the subject.`
}

/** The system note shown in the date after a declined story turn. */
export const REFUSAL_NOTE =
  "The model declined that turn, likely because of its provider's content policy. A lower heat usually helps; local or OpenRouter models are the way to play at heat 4 and 5."

function kindOf(opts: RoleCallOptions): DebugKind {
  return opts.kind ?? opts.debug?.kind ?? (opts.role === 'story' ? 'story' : 'judge')
}

function temperatureOf(opts: RoleCallOptions): number {
  return opts.temperature ?? (opts.role === 'judge' ? JUDGE_TEMPERATURE : opts.conn.storyTemperature)
}

/** Resolve the role and refuse early when the route can't work (no key for a keyed provider). */
function routeFor(opts: RoleCallOptions): Route {
  const route = resolveRoute(opts.conn, opts.role)
  if (routeGap(route) === 'key') {
    throw new LlmError('http', `${presetFor(route.preset).label} needs an API key.`, { status: 401 })
  }
  return route
}

function claudeTarget(route: Route): ClaudeTarget {
  return { baseUrl: route.baseUrl, apiKey: route.apiKey, model: route.model }
}

function claudeRequest(opts: RoleCallOptions, route: Route) {
  const kind = kindOf(opts)
  return {
    target: claudeTarget(route),
    messages: opts.messages,
    temperature: temperatureOf(opts),
    effort: kind === 'story' ? opts.conn.effort ?? 'low' : 'low',
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
    debug: { ...opts.debug, kind },
  } as const
}

function openAiOptions(opts: RoleCallOptions, route: Route) {
  return {
    conn: endpointForRoute(opts.conn, route),
    model: route.model,
    messages: opts.messages,
    temperature: temperatureOf(opts),
    maxTokens: opts.maxTokens,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
    debug: { ...opts.debug, kind: kindOf(opts) },
  }
}

function fromClaude(r: ClaudeResult, route: Route): ChatResult {
  const out: ChatResult = { text: r.text, refused: r.refused, truncated: r.truncated, route, model: r.model || route.model }
  if (r.refusal) out.refusal = r.refusal
  return out
}

function fromOpenAi(c: Completion, route: Route): ChatResult {
  const out: ChatResult = {
    text: c.refused ? '' : c.text,
    refused: c.refused,
    truncated: c.finishReason === 'length',
    route,
    model: route.model,
  }
  if (c.refused) out.refusal = { category: c.finishReason === 'content_filter' ? 'content_filter' : null, explanation: c.refusal ?? null }
  return out
}

/** Streamed call on a role (the story turn). Throws LlmError for network, HTTP and key problems. */
export async function streamChat(opts: StreamRoleOptions): Promise<ChatResult> {
  const route = routeFor(opts)
  if (route.provider === 'anthropic') {
    return fromClaude(await streamClaude({ ...claudeRequest(opts, route), onDelta: opts.onDelta }), route)
  }
  return fromOpenAi(await streamCompletion({ ...openAiOptions(opts, route), onDelta: opts.onDelta }), route)
}

/** Non-streamed call on a role (the memory call). */
export async function chat(opts: RoleCallOptions): Promise<ChatResult> {
  const route = routeFor(opts)
  if (route.provider === 'anthropic') return fromClaude(await createClaude(claudeRequest(opts, route)), route)
  return fromOpenAi(await chatCompletion(openAiOptions(opts, route)), route)
}

/**
 * JSON call on a role (judge, agreement, suggestions). Claude gets a structured-output schema where
 * the model takes one; OpenAI-compatible servers get JSON mode where allowed. Both parse
 * defensively, retry once with a nudge, then return the fallback. A refusal returns the fallback.
 */
export async function jsonChat<T>(opts: JsonRoleOptions<T>): Promise<JsonChatResult<T>> {
  const route = routeFor(opts)
  const kind = kindOf(opts)
  if (route.provider === 'anthropic') {
    const schema = opts.schema ?? (kind === 'judge' ? JUDGE_SCHEMA : kind === 'agreement' ? AGREEMENT_SCHEMA : undefined)
    return claudeJson({ ...claudeRequest(opts, route), ...(schema ? { schema } : {}) }, opts.coerce, opts.fallback)
  }
  return openAiJson({ ...openAiOptions(opts, route), coerce: opts.coerce, fallback: opts.fallback })
}

/** Model ids a preset offers (Claude: the Models API; others: GET /models). */
export function listModels(
  conn: ConnectionSettings,
  preset: ConnectionPreset,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string[]> {
  if (presetFor(preset).provider === 'anthropic') {
    const slot = slotFor(conn, preset)
    if (!slot.apiKey.trim()) return Promise.reject(new LlmError('http', 'Claude needs an API key.', { status: 401 }))
    return listClaudeModels({ baseUrl: slot.baseUrl, apiKey: slot.apiKey }, opts)
  }
  return listOpenAiModels(endpointFor(conn, preset), opts)
}

/**
 * Whether the role's current model takes a temperature. False for Claude models that reject
 * sampling (Opus 5 and friends) and for any model that has turned it down this session.
 */
export function roleTakesTemperature(conn: ConnectionSettings, role: ModelRole): boolean {
  const route = resolveRoute(conn, role)
  if (route.provider === 'anthropic') return claudeTakesTemperature(claudeTarget(route))
  return paramAllowed(route, route.model, 'temperature')
}

/** Whether the role's current model takes Claude's Effort setting. */
export function roleTakesEffort(conn: ConnectionSettings, role: ModelRole): boolean {
  const route = resolveRoute(conn, role)
  return route.provider === 'anthropic' && claudeTakesEffort(claudeTarget(route))
}
