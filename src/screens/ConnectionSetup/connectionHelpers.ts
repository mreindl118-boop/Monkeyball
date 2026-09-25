import { pickModels, sameModel } from '../../llm/models'
import { isLoopbackHost, presetFor } from '../../llm/presets'
import { resolveRoute, routeGap, slotFor } from '../../llm/routes'
import type { ConnectionPreset, ConnectionSettings, ProviderSlot } from '../../types'

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

/**
 * Base URL for a local preset on this device (127.0.0.1, which also works for Ollama in Termux on
 * the phone) or on a PC on the Wi-Fi, with the preset's port and /v1.
 */
export function localBaseUrl(preset: ConnectionPreset, mode: HostMode, host: string): string {
  const port = LOCAL_PORTS[preset] ?? 11434
  const h = mode === 'device' ? '127.0.0.1' : host.trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '')
  return `http://${h || '127.0.0.1'}:${port}/v1`
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

/** True when a preset has what it needs to be called: an address, and a key if it requires one. */
export function slotUsable(conn: ConnectionSettings, preset: ConnectionPreset): boolean {
  const slot = slotFor(conn, preset)
  if (!slot.baseUrl.trim()) return false
  return presetFor(preset).key !== 'required' || !!slot.apiKey.trim()
}

/** A fingerprint of a preset's address and key; model lists and ready marks follow it. */
export function slotSignature(slot: ProviderSlot): string {
  return `${slot.baseUrl.trim()}|${slot.apiKey.trim()}`
}

/**
 * The roles patch for "use this preset for both roles": the story on it (listed pick, else the
 * preset's default, else the current model when already there) and the judge on "same", with the
 * listed or default judge model.
 */
export function bothRolesPatch(
  conn: ConnectionSettings,
  preset: ConnectionPreset,
  models: readonly string[] = [],
): Pick<ConnectionSettings, 'story' | 'judge'> {
  const picks = pickModels(preset, models)
  const defaults = presetFor(preset).defaults
  const keepStory = conn.story.preset === preset ? conn.story.model.trim() : ''
  const story = keepStory || picks.story || defaults?.story || ''
  const judge = picks.judge || defaults?.judge || ''
  return {
    story: { preset, model: story },
    judge: { preset: 'same', model: judge && judge !== story ? judge : '' },
  }
}

/** The patch for picking the story role's preset. A "same" judge follows with a fitting model. */
export function storyPresetPatch(
  conn: ConnectionSettings,
  preset: ConnectionPreset,
  models: readonly string[] = [],
): Partial<ConnectionSettings> {
  if (preset === conn.story.preset) return {}
  const picks = pickModels(preset, models)
  const defaults = presetFor(preset).defaults
  const story = { preset, model: picks.story || defaults?.story || '' }
  if (conn.judge.preset !== 'same') return { story }
  const judge = picks.judge || defaults?.judge || ''
  return { story, judge: { preset: 'same', model: judge && judge !== story.model ? judge : '' } }
}

/** The patch for picking the judge role's preset ('same' follows the story). */
export function judgePresetPatch(
  conn: ConnectionSettings,
  preset: ConnectionPreset | 'same',
  models: readonly string[] = [],
): Partial<ConnectionSettings> {
  if (preset === conn.judge.preset) return {}
  const target = preset === 'same' ? conn.story.preset : preset
  const picks = pickModels(target, models)
  const judge = picks.judge || presetFor(target).defaults?.judge || ''
  const storyModel = resolveRoute(conn, 'story').model
  const model = target === conn.story.preset && judge === storyModel ? '' : judge
  return { judge: { preset, model } }
}

/**
 * After a successful Test connection of one preset: when the story role can't run where it is
 * (no key, no address), both roles move to the tested preset ("pick one provider, paste the key,
 * test"). Otherwise empty role models on this preset get filled from the list. Null when nothing
 * changes.
 */
export function afterTestPatch(
  conn: ConnectionSettings,
  preset: ConnectionPreset,
  models: readonly string[],
): Partial<ConnectionSettings> | null {
  const storyRoute = resolveRoute(conn, 'story')
  const gap = routeGap(storyRoute)
  if (storyRoute.preset !== preset && (gap === 'key' || gap === 'url')) return bothRolesPatch(conn, preset, models)

  const picks = pickModels(preset, models)
  const patch: Partial<ConnectionSettings> = {}
  if (conn.story.preset === preset && !conn.story.model.trim() && picks.story) {
    patch.story = { preset, model: picks.story }
  }
  const judgePreset = conn.judge.preset === 'same' ? conn.story.preset : conn.judge.preset
  const storyModel = patch.story?.model ?? storyRoute.model
  if (judgePreset === preset && !conn.judge.model.trim() && picks.judge && picks.judge !== storyModel) {
    patch.judge = { preset: conn.judge.preset, model: picks.judge }
  }
  return patch.story || patch.judge ? patch : null
}
