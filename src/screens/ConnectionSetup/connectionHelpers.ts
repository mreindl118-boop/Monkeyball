import { sameModel } from '../../llm/diagnose'
import { isLoopbackHost, presetFor } from '../../llm/presets'
import type { ConnectionPreset, ConnectionSettings } from '../../types'

/** Default ports for the local presets. */
export const LOCAL_PORTS: Partial<Record<ConnectionPreset, number>> = {
  ollama: 11434,
  lmstudio: 1234,
}

export type HostMode = 'device' | 'lan'

/** Where a base URL points: this device, or a PC on the network (with its host). */
export function hostModeOf(baseUrl: string): { mode: HostMode; host: string } {
  try {
    const u = new URL(baseUrl.trim())
    if (isLoopbackHost(u.hostname)) return { mode: 'device', host: '' }
    return { mode: 'lan', host: u.hostname }
  } catch {
    return { mode: 'device', host: '' }
  }
}

/** Base URL for a local preset on this device or on a LAN host. */
export function localBaseUrl(preset: ConnectionPreset, mode: HostMode, host: string): string {
  const port = LOCAL_PORTS[preset] ?? 11434
  const h = mode === 'device' ? 'localhost' : host.trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '')
  return `http://${h || 'localhost'}:${port}/v1`
}

/**
 * The connection patch for switching to another preset. The current preset's URL and key are
 * remembered in `providers`; the new preset gets back what it had, or its default URL and no
 * key. A key typed for one provider is never sent to another. Custom starts from the current URL
 * (handy when a server runs on a non-standard port), but never inherits the key.
 */
export function switchPreset(conn: ConnectionSettings, id: ConnectionPreset): Partial<ConnectionSettings> {
  if (id === conn.preset) return {}
  const providers = {
    ...conn.providers,
    [conn.preset]: { baseUrl: conn.baseUrl, apiKey: conn.apiKey },
  }
  const saved = providers[id]
  const baseUrl = saved?.baseUrl || presetFor(id).baseUrl || conn.baseUrl
  return { preset: id, baseUrl, apiKey: saved?.apiKey ?? '', providers }
}

/**
 * The id the server lists for a stored model name, or undefined when it isn't listed. Ollama
 * lists "llama3.1:latest" for a model the player typed as "llama3.1".
 */
export function listedModel(models: readonly string[], model: string): string | undefined {
  const m = model.trim()
  if (!m) return undefined
  return models.includes(m) ? m : models.find((x) => sameModel(m, x))
}
