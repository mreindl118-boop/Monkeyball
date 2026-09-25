// Test connection: list models, check the configured models exist, run a tiny completion.
// Failures come back as a problem that names the fix.

import type { ConnectionSettings } from '../types'
import { chat, errorMessageFrom, isLlmError, LlmError, listModels, modelsUrl } from './client'
import { extractJson } from './json'
import {
  hostnameOf,
  isLmStudio,
  isLoopbackHost,
  isOllama,
  isOpenRouter,
  isPrivateNetworkHost,
  normalizeBaseUrl,
} from './presets'

export type ProblemKind = 'cors' | 'unreachable' | 'auth' | 'model' | 'other'

export interface ConnectionProblem {
  kind: ProblemKind
  /** What went wrong, one sentence. */
  message: string
  /** What to do about it. */
  fix: string
}

export interface DiagnoseStep {
  label: string
  ok: boolean
  detail: string
}

export interface ConnectionTestResult {
  ok: boolean
  models: string[]
  steps: DiagnoseStep[]
  problem?: ConnectionProblem
}

export interface TestOptions {
  signal?: AbortSignal
  /** Timeout for listing models. Default 10 s. */
  listTimeoutMs?: number
  /** Timeout for the tiny completion (a local model may need to load). Default 90 s. */
  completionTimeoutMs?: number
}

export const STEP_LABELS = {
  list: 'List models',
  check: 'Check the configured models',
  complete: 'Run a tiny completion',
} as const

function appOrigin(): string {
  return typeof location !== 'undefined' && location.origin && location.origin !== 'null'
    ? location.origin
    : "this app's origin"
}

/** Fix text for a server that is up but blocks cross-origin requests. */
export function corsFix(conn: ConnectionSettings): string {
  if (isOllama(conn)) {
    return `Set OLLAMA_ORIGINS=* (or ${appOrigin()}) and restart Ollama. On macOS: launchctl setenv OLLAMA_ORIGINS "*", then quit and reopen Ollama. On Linux with systemd: add Environment="OLLAMA_ORIGINS=*" to the ollama service and restart it.`
  }
  if (isLmStudio(conn)) {
    return "Enable CORS in LM Studio's server settings (Developer tab), then restart the server."
  }
  return `Allow requests from ${appOrigin()} in the server's CORS settings (the Access-Control-Allow-Origin header), then try again.`
}

/** The https-page-to-http-server case browsers block outright (localhost is exempt). */
function mixedContentNote(conn: ConnectionSettings): string {
  if (typeof location === 'undefined' || location.protocol !== 'https:') return ''
  let u: URL
  try {
    u = new URL(normalizeBaseUrl(conn.baseUrl))
  } catch {
    return ''
  }
  if (u.protocol !== 'http:') return ''
  if (isLoopbackHost(u.hostname)) return ''
  return ' This page is served over https, so the browser blocks plain http servers other than localhost: use an https URL, or open the app over http on your network.'
}

/** Where the base URL points: this device, another machine on the network, or the internet. */
function whereIs(conn: ConnectionSettings): 'device' | 'lan' | 'remote' {
  const host = hostnameOf(conn.baseUrl)
  if (!host || isLoopbackHost(host)) return 'device'
  // A local preset pointed anywhere but this device is the "PC on my Wi-Fi" case.
  if (isPrivateNetworkHost(host) || isOllama(conn) || isLmStudio(conn)) return 'lan'
  return 'remote'
}

function unreachableFix(conn: ConnectionSettings): string {
  const where = whereIs(conn)
  const host = hostnameOf(conn.baseUrl)
  let fix: string
  if (isOpenRouter(conn)) {
    fix = 'Check your internet connection and that the URL is https://openrouter.ai/api/v1.'
  } else if (isOllama(conn)) {
    fix =
      where === 'device'
        ? 'Check that Ollama is running (ollama serve) and the URL is http://localhost:11434/v1.'
        : `Make sure Ollama is running on that PC and listening on your network (set OLLAMA_HOST=0.0.0.0, then restart Ollama), that this device is on the same Wi-Fi, and that the address ${host} is right.`
  } else if (isLmStudio(conn)) {
    fix =
      where === 'device'
        ? "Start the server in LM Studio's Developer tab and check the URL is http://localhost:1234/v1."
        : `Make sure LM Studio's server is running on that PC with "Serve on local network" turned on, that this device is on the same Wi-Fi, and that the address ${host} is right.`
  } else if (where === 'lan') {
    fix = `Make sure the server on ${host} is running and listening on your network (not only on localhost), that this device is on the same Wi-Fi, and that the URL is right, including /v1 at the end.`
  } else {
    fix =
      'Check that the server is running and the URL is right, including /v1 at the end (for example http://localhost:11434/v1).'
  }
  return fix + mixedContentNote(conn)
}

function modelFix(conn: ConnectionSettings, model: string): string {
  if (isOllama(conn)) return `Pick a model from the list, or download it first: ollama pull ${model}`
  if (isLmStudio(conn)) return 'Pick a model from the list, or load it in LM Studio first.'
  if (isOpenRouter(conn)) return 'Pick a model from the list; OpenRouter ids look like vendor/model-name.'
  return 'Pick a model from the list, or check the spelling of the model id.'
}

function authProblem(conn: ConnectionSettings, status?: number): ConnectionProblem {
  const hasKey = !!conn.apiKey?.trim()
  if (isOpenRouter(conn)) {
    return hasKey
      ? {
          kind: 'auth',
          message: 'OpenRouter rejected the API key.',
          fix: 'Check the key in Settings; OpenRouter keys start with sk-or-. Create a new one at openrouter.ai/keys if needed.',
        }
      : {
          kind: 'auth',
          message: 'OpenRouter needs an API key.',
          fix: 'Create a key at openrouter.ai/keys and paste it into the API key field.',
        }
  }
  return hasKey
    ? {
        kind: 'auth',
        message: `The server rejected the API key${status ? ` (HTTP ${status})` : ''}.`,
        fix: 'Check the API key in Settings, or clear it if this server doesn\'t use one.',
      }
    : {
        kind: 'auth',
        message: `The server wants an API key${status ? ` (HTTP ${status})` : ''}.`,
        fix: 'Add the API key in Settings.',
      }
}

/** The error object an OpenAI-style body carries ({"error": {message, code, param}}), if any. */
function errorObject(body: string | undefined): { code?: unknown; param?: unknown } | null {
  if (!body) return null
  const parsed = extractJson(body)
  const e = parsed?.error
  return e && typeof e === 'object' ? (e as { code?: unknown; param?: unknown }) : null
}

/** What the server said, without our "HTTP 400:" style prefixes. */
function serverMessage(e: LlmError): string {
  const fromBody = e.body ? errorMessageFrom(e.body) : ''
  return fromBody || e.message.replace(/^(HTTP \d+: |The model server reported an error: )/, '')
}

const MODEL_MISSING =
  /\bmodel\b[^\n]{0,80}?\b(not found|does not exist|doesn't exist|is not available|not available|isn't available)|\b(unknown|invalid|no such) model\b|\bnot a valid model\b|\bno models? (are |is )?loaded\b|\btry pulling it\b/i

/**
 * A "this model doesn't exist here" error: a 404, an error naming the model parameter or
 * model_not_found, or a message that says so. Other 400s that merely mention "model" (an
 * unsupported parameter, a context that's too small) are not model problems.
 */
export function looksLikeModelError(e: LlmError): boolean {
  if (e.kind !== 'http') return false
  return e.status === 404 || saysModelMissing(e)
}

/** The error itself says the model is missing (not just a bare 404). */
function saysModelMissing(e: LlmError): boolean {
  const obj = errorObject(e.body)
  if (obj && (obj.code === 'model_not_found' || obj.param === 'model')) return true
  return MODEL_MISSING.test(serverMessage(e))
}

/**
 * Map any client error to a problem with a fix, without probing the network.
 * Use it wherever a model call fails mid-game ("what should I do?").
 */
export function explainError(err: unknown, conn: ConnectionSettings, model?: string): ConnectionProblem {
  const m = model || conn.storyModel
  if (!isLlmError(err)) {
    return { kind: 'other', message: err instanceof Error ? err.message : String(err), fix: 'Try again.' }
  }
  switch (err.kind) {
    case 'cors':
      return { kind: 'cors', message: 'The server is up but blocks requests from this page (CORS).', fix: corsFix(conn) }
    case 'network':
      return {
        kind: 'unreachable',
        message: `Couldn't reach ${normalizeBaseUrl(conn.baseUrl) || 'the model server'}. It may be down, or blocking this page (CORS).`,
        fix: `${unreachableFix(conn)} If it is running, run Test connection in Settings to check for CORS.`,
      }
    case 'timeout':
      return {
        kind: 'other',
        message: 'The model took too long to answer.',
        fix: 'It may still be loading; try again in a moment, or pick a smaller model.',
      }
    case 'aborted':
      return { kind: 'other', message: 'The request was cancelled.', fix: 'Try again.' }
    case 'parse':
      return {
        kind: 'unreachable',
        message: "The server answered, but not like an OpenAI-compatible API.",
        fix: unreachableFix(conn),
      }
    case 'http':
      if (err.status === 401 || err.status === 403) return authProblem(conn, err.status)
      if (looksLikeModelError(err)) {
        return {
          kind: 'model',
          message: m ? `The server doesn't know the model "${m}".` : 'The server doesn\'t know that model.',
          fix: modelFix(conn, m || 'model-name'),
        }
      }
      return { kind: 'other', message: err.message, fix: 'Check the server logs, then try again.' }
  }
}

/** After a fetch TypeError: an opaque no-cors success means reachable but blocked by CORS. */
async function probeReachable(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await fetch(url, { mode: 'no-cors', signal })
    return true
  } catch {
    return false
  }
}

/** Model ids that name the same model (Ollama lists "llama3.1:latest" for "llama3.1"). */
export function sameModel(a: string, b: string): boolean {
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  return x === y || `${x}:latest` === y || x === `${y}:latest`
}

async function classifyNetwork(
  e: LlmError,
  conn: ConnectionSettings,
  signal?: AbortSignal,
): Promise<ConnectionProblem> {
  if (e.kind !== 'network') return explainError(e, conn)
  const reachable = await probeReachable(modelsUrl(conn), signal)
  if (reachable) {
    return { kind: 'cors', message: 'The server is up but blocks requests from this page (CORS).', fix: corsFix(conn) }
  }
  return {
    kind: 'unreachable',
    message: `Nothing answered at ${normalizeBaseUrl(conn.baseUrl)}.`,
    fix: unreachableFix(conn),
  }
}

/**
 * Test a connection in three steps: GET /models, check the configured story/judge models are
 * listed, then a tiny completion (max_tokens 8) with the story model (or the first listed one).
 */
export async function testConnection(
  conn: ConnectionSettings,
  opts: TestOptions = {},
): Promise<ConnectionTestResult> {
  const steps: DiagnoseStep[] = []
  let models: string[] = []
  const fail = (problem: ConnectionProblem): ConnectionTestResult => ({ ok: false, models, steps, problem })

  const base = normalizeBaseUrl(conn.baseUrl)
  if (!base) {
    steps.push({ label: STEP_LABELS.list, ok: false, detail: 'No base URL set.' })
    return fail({
      kind: 'unreachable',
      message: 'There is no base URL yet.',
      fix: 'Pick a preset or enter your server URL, for example http://localhost:11434/v1.',
    })
  }
  try {
    const u = new URL(base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol')
  } catch {
    steps.push({ label: STEP_LABELS.list, ok: false, detail: `"${base}" isn't a valid URL.` })
    return fail({
      kind: 'unreachable',
      message: `"${base}" isn't a valid URL.`,
      fix: 'Use a full URL starting with http:// or https://, for example http://localhost:11434/v1.',
    })
  }

  // Step 1: list models.
  let listed = true
  try {
    models = await listModels(conn, { signal: opts.signal, timeoutMs: opts.listTimeoutMs ?? 10_000 })
    steps.push({
      label: STEP_LABELS.list,
      ok: true,
      detail: models.length === 1 ? 'Found 1 model.' : `Found ${models.length} models.`,
    })
  } catch (e) {
    const err = e instanceof LlmError ? e : new LlmError('network', String(e))
    if (err.kind === 'http' && err.status === 404 && conn.storyModel.trim()) {
      // Some servers don't list models; the completion step can still prove the connection.
      listed = false
      steps.push({
        label: STEP_LABELS.list,
        ok: false,
        detail: "This server doesn't list models (404). Trying the completion anyway.",
      })
    } else {
      const problem =
        err.kind === 'http' && err.status === 404
          ? {
              kind: 'unreachable' as const,
              message: `The server answered, but not at ${modelsUrl(conn)} (404).`,
              fix: unreachableFix(conn),
            }
          : await classifyNetwork(err, conn, opts.signal)
      steps.push({ label: STEP_LABELS.list, ok: false, detail: problem.message })
      return fail(problem)
    }
  }

  // OpenRouter lists models without a key but won't complete without one.
  if (isOpenRouter(conn) && !conn.apiKey?.trim()) {
    const problem = authProblem(conn)
    steps.push({ label: STEP_LABELS.check, ok: false, detail: problem.message })
    return fail(problem)
  }

  // Step 2: the configured models exist.
  const story = conn.storyModel.trim()
  const judge = conn.judgeModel.trim()
  let testModel = story
  if (listed) {
    if (models.length === 0) {
      const problem: ConnectionProblem = {
        kind: 'model',
        message: 'The server is up but has no models.',
        fix: isOllama(conn)
          ? 'Download one first, for example: ollama pull llama3.1'
          : isLmStudio(conn)
            ? 'Load a model in LM Studio first.'
            : 'Add or load a model on the server first.',
      }
      steps.push({ label: STEP_LABELS.check, ok: false, detail: problem.message })
      return fail(problem)
    }
    const missing = [story, judge && judge !== story ? judge : '']
      .filter(Boolean)
      .filter((m) => !models.some((x) => sameModel(m, x)))
    if (missing.length > 0) {
      const which = missing[0] === story ? 'story' : 'judge'
      const problem: ConnectionProblem = {
        kind: 'model',
        message: `The ${which} model "${missing[0]}" isn't on this server.`,
        fix: modelFix(conn, missing[0]),
      }
      steps.push({ label: STEP_LABELS.check, ok: false, detail: problem.message })
      return fail(problem)
    }
    if (!story) {
      testModel = models[0]
      steps.push({
        label: STEP_LABELS.check,
        ok: true,
        detail: `No story model picked yet; testing with ${testModel}.`,
      })
    } else {
      steps.push({
        label: STEP_LABELS.check,
        ok: true,
        detail: judge && judge !== story ? `Found ${story} and ${judge}.` : `Found ${story}.`,
      })
    }
  }

  // Step 3: a tiny completion.
  try {
    const reply = await chat({
      conn,
      model: testModel,
      messages: [{ role: 'user', content: 'Reply with the word ok.' }],
      temperature: 0,
      maxTokens: 8,
      signal: opts.signal,
      timeoutMs: opts.completionTimeoutMs ?? 90_000,
      debug: { kind: 'test' },
    })
    const shown = reply.trim().slice(0, 40)
    steps.push({
      label: STEP_LABELS.complete,
      ok: true,
      detail: shown ? `${testModel} replied "${shown}".` : `${testModel} answered (empty reply).`,
    })
  } catch (e) {
    const err = e instanceof LlmError ? e : new LlmError('network', String(e))
    let problem: ConnectionProblem
    if (err.kind === 'network') {
      // When /models worked, a network failure here is usually the CORS preflight on POST.
      problem = await classifyNetwork(err, conn, opts.signal)
    } else if (!listed && err.kind === 'http' && err.status === 404) {
      problem = {
        kind: 'unreachable',
        message: `Nothing OpenAI-compatible answered at ${base}.`,
        fix: unreachableFix(conn),
      }
    } else {
      problem = explainError(err, conn, testModel)
      if (
        problem.kind === 'model' &&
        listed &&
        models.some((m) => sameModel(testModel, m)) &&
        !saysModelMissing(err)
      ) {
        // Step 2 already found the model, so the server objected to something else.
        problem = {
          kind: 'other',
          message: `The server turned down the test request: ${serverMessage(err)}`,
          fix: 'The model is on the server, so this is about the request itself. Check the server logs, then try again.',
        }
      }
    }
    steps.push({ label: STEP_LABELS.complete, ok: false, detail: problem.message })
    return fail(problem)
  }

  return { ok: true, models, steps }
}
