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

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'])

/** True for this device's own addresses (localhost, 127.x, ::1). */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return LOOPBACK_HOSTS.has(h) || /^127\.\d+\.\d+\.\d+$/.test(h) || h.endsWith('.localhost')
}

/** True for addresses on a home or office network: private IPv4 ranges and .local names. */
export function isPrivateNetworkHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  return /^\[?(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(h)
}

/** The hostname of a base URL, or '' when it isn't a URL. */
export function hostnameOf(baseUrl: string): string {
  try {
    return new URL(normalizeBaseUrl(baseUrl)).hostname
  } catch {
    return ''
  }
}
