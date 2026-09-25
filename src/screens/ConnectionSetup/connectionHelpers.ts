import type { ConnectionPreset } from '../../types'

/** Default ports for the local presets. */
export const LOCAL_PORTS: Partial<Record<ConnectionPreset, number>> = {
  ollama: 11434,
  lmstudio: 1234,
}

export type HostMode = 'device' | 'lan'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'])

/** Where a base URL points: this device, or a PC on the network (with its host). */
export function hostModeOf(baseUrl: string): { mode: HostMode; host: string } {
  try {
    const u = new URL(baseUrl.trim())
    if (LOOPBACK.has(u.hostname)) return { mode: 'device', host: '' }
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
