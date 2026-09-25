import type { ConnectionPreset, ModelProvider } from '../types'

export type KeyPolicy = 'none' | 'required' | 'optional'

export interface Preset {
  id: ConnectionPreset
  label: string
  /** Wire format: Anthropic's Messages API (official SDK) or OpenAI-compatible chat completions. */
  provider: ModelProvider
  /** 'main' presets get their own card; 'other' ones sit under "Other providers". */
  group: 'main' | 'other'
  /** Default base URL; empty for Custom. */
  baseUrl: string
  key: KeyPolicy
  /** Short help line for the settings screen. */
  help: string
  /** Where to get a key, shown as a link ("console.anthropic.com"). */
  keySite?: string
  keyUrl?: string
  /** Placeholder for the key field. */
  keyPlaceholder?: string
  /** Default models, for presets that have well-known ones. */
  defaults?: { story: string; judge: string }
}

/** Claude's default models (exact ids, no date suffixes). */
export const CLAUDE_STORY_MODEL = 'claude-opus-5'
export const CLAUDE_JUDGE_MODEL = 'claude-haiku-4-5'

/** Every connection preset. Order is the order the settings screen shows them in. */
export const PRESETS: Record<ConnectionPreset, Preset> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    provider: 'anthropic',
    group: 'main',
    baseUrl: 'https://api.anthropic.com',
    key: 'required',
    help: "Anthropic's models, with your own API key.",
    keySite: 'console.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
    defaults: { story: CLAUDE_STORY_MODEL, judge: CLAUDE_JUDGE_MODEL },
  },
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    provider: 'openai',
    group: 'main',
    baseUrl: 'https://api.openai.com/v1',
    key: 'required',
    help: "OpenAI's models, with your own API key.",
    keySite: 'platform.openai.com',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
  },
  grok: {
    id: 'grok',
    label: 'Grok',
    provider: 'openai',
    group: 'main',
    baseUrl: 'https://api.x.ai/v1',
    key: 'required',
    help: "xAI's models, with your own API key.",
    keySite: 'console.x.ai',
    keyUrl: 'https://console.x.ai',
    keyPlaceholder: 'xai-...',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    provider: 'openai',
    group: 'other',
    baseUrl: 'http://localhost:11434/v1',
    key: 'none',
    help: 'Free models on your own computer, on your Wi-Fi, or on this phone.',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio',
    provider: 'openai',
    group: 'other',
    baseUrl: 'http://localhost:1234/v1',
    key: 'none',
    help: 'Models loaded in LM Studio on your computer.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai',
    group: 'other',
    baseUrl: 'https://openrouter.ai/api/v1',
    key: 'required',
    help: 'Hundreds of hosted models behind one key.',
    keySite: 'openrouter.ai/keys',
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-...',
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    provider: 'openai',
    group: 'other',
    baseUrl: '',
    key: 'optional',
    help: 'Any OpenAI-compatible server. Usually ends in /v1.',
  },
}

export const PRESET_IDS: readonly ConnectionPreset[] = [
  'claude',
  'chatgpt',
  'grok',
  'ollama',
  'lmstudio',
  'openrouter',
  'custom',
]

export const PRESET_LIST: readonly Preset[] = PRESET_IDS.map((id) => PRESETS[id])
export const MAIN_PRESETS: readonly Preset[] = PRESET_LIST.filter((p) => p.group === 'main')
export const OTHER_PRESETS: readonly Preset[] = PRESET_LIST.filter((p) => p.group === 'other')

export function isPresetId(v: unknown): v is ConnectionPreset {
  return typeof v === 'string' && (PRESET_IDS as readonly string[]).includes(v)
}

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
  if (u.includes('api.anthropic.com')) return 'claude'
  if (u.includes('api.openai.com')) return 'chatgpt'
  if (u.includes('api.x.ai')) return 'grok'
  if (u.includes('openrouter.ai')) return 'openrouter'
  if (/:11434(\/|$)/.test(u)) return 'ollama'
  if (/:1234(\/|$)/.test(u)) return 'lmstudio'
  return 'custom'
}

type ConnLike = { preset: ConnectionPreset; baseUrl: string }

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

/** True when the server is OpenAI's own API (it wants max_completion_tokens, not max_tokens). */
export function isOpenAiApi(conn: ConnLike): boolean {
  return detectPreset(conn.baseUrl) === 'chatgpt'
}

/** True when the server is xAI's API. */
export function isXai(conn: ConnLike): boolean {
  return detectPreset(conn.baseUrl) === 'grok'
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
