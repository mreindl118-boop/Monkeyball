import type { ConnectionPreset, ConnectionSettings } from '../types'

export type KeyPolicy = 'none' | 'required' | 'optional'

export interface Preset {
  id: ConnectionPreset
  label: string
  /** Default base URL; empty for Custom. */
  baseUrl: string
  key: KeyPolicy
  /** Short help line for the settings screen. */
  help: string
}

/** The four connection presets from docs/SPEC.md, "Model connection". */
export const PRESETS: Record<ConnectionPreset, Preset> = {
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    key: 'none',
    help: 'Runs models on this computer. Set OLLAMA_ORIGINS so the browser can reach it.',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    key: 'none',
    help: "Start the server in LM Studio and enable CORS in its server settings.",
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    key: 'required',
    help: 'Hosted models. Needs an API key from openrouter.ai.',
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    baseUrl: '',
    key: 'optional',
    help: 'Any OpenAI-compatible server. Usually ends in /v1.',
  },
}

export const PRESET_LIST: readonly Preset[] = [
  PRESETS.ollama,
  PRESETS.lmstudio,
  PRESETS.openrouter,
  PRESETS.custom,
]

export function presetFor(id: ConnectionPreset): Preset {
  return PRESETS[id] ?? PRESETS.custom
}

/** Base URL without trailing slashes or surrounding whitespace. */
export function normalizeBaseUrl(url: string): string {
  return (url ?? '').trim().replace(/\/+$/, '')
}

/** Guess the preset from a base URL (used when the user pastes a URL into Custom). */
export function detectPreset(baseUrl: string): ConnectionPreset {
  const u = normalizeBaseUrl(baseUrl).toLowerCase()
  if (u.includes('openrouter.ai')) return 'openrouter'
  if (/:11434(\/|$)/.test(u)) return 'ollama'
  if (/:1234(\/|$)/.test(u)) return 'lmstudio'
  return 'custom'
}

type ConnLike = Pick<ConnectionSettings, 'preset' | 'baseUrl'>

/** True when the connection talks to Ollama (by preset or by its default port). */
export function isOllama(conn: ConnLike): boolean {
  return conn.preset === 'ollama' || detectPreset(conn.baseUrl) === 'ollama'
}

export function isLmStudio(conn: ConnLike): boolean {
  return conn.preset === 'lmstudio' || detectPreset(conn.baseUrl) === 'lmstudio'
}

export function isOpenRouter(conn: ConnLike): boolean {
  return conn.preset === 'openrouter' || detectPreset(conn.baseUrl) === 'openrouter'
}
