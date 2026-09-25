// Role routing: which preset, wire format, address, key and model serve the story and judge
// roles. Everything above src/llm uses these instead of branching on providers.

import type { ConnectionPreset, ConnectionSettings, ModelProvider, ModelRole, ProviderSlot } from '../types'
import type { Endpoint } from './client'
import { isPresetId, normalizeBaseUrl, presetFor } from './presets'

/** Everything one call needs to reach its model. */
export interface Route {
  role: ModelRole
  preset: ConnectionPreset
  provider: ModelProvider
  baseUrl: string
  apiKey: string
  /** The model id; empty when nothing is picked yet and the preset has no default. */
  model: string
}

/** A preset's stored address and key; the preset's default URL when none is stored. */
export function slotFor(conn: ConnectionSettings, preset: ConnectionPreset): ProviderSlot {
  const slot = conn.providers?.[preset]
  return {
    baseUrl: slot?.baseUrl?.trim() ? slot.baseUrl : presetFor(preset).baseUrl,
    apiKey: slot?.apiKey ?? '',
  }
}

/** The preset a role runs on ('same' judge resolves to the story preset). */
export function rolePreset(conn: ConnectionSettings, role: ModelRole): ConnectionPreset {
  const story = isPresetId(conn.story?.preset) ? conn.story.preset : 'claude'
  if (role === 'story') return story
  const judge = conn.judge?.preset
  return judge && judge !== 'same' && isPresetId(judge) ? judge : story
}

/**
 * Resolve a role to its route. Story: story.model, or the preset's default story model. Judge:
 * judge.model, else the story model when both roles share a preset, else the preset's default
 * judge model.
 */
export function resolveRoute(conn: ConnectionSettings, role: ModelRole): Route {
  const storyPreset = rolePreset(conn, 'story')
  const storyModel = conn.story?.model?.trim() || presetFor(storyPreset).defaults?.story || ''
  const preset = rolePreset(conn, role)
  const slot = slotFor(conn, preset)
  const model =
    role === 'story'
      ? storyModel
      : conn.judge?.model?.trim() || (preset === storyPreset ? storyModel : presetFor(preset).defaults?.judge || '')
  return {
    role,
    preset,
    provider: presetFor(preset).provider,
    baseUrl: normalizeBaseUrl(slot.baseUrl),
    apiKey: slot.apiKey.trim(),
    model,
  }
}

/** What stops a route from working before any request is made, or null when nothing does. */
export type RouteGap = 'key' | 'url' | 'model'

export function routeGap(route: Pick<Route, 'preset' | 'baseUrl' | 'apiKey' | 'model'>): RouteGap | null {
  if (presetFor(route.preset).key === 'required' && !route.apiKey.trim()) return 'key'
  if (!normalizeBaseUrl(route.baseUrl)) return 'url'
  if (!route.model.trim()) return 'model'
  return null
}

/** The models the two roles use on a preset (only the roles that run there). */
export function modelsOnPreset(conn: ConnectionSettings, preset: ConnectionPreset): { story?: string; judge?: string } {
  const out: { story?: string; judge?: string } = {}
  const story = resolveRoute(conn, 'story')
  const judge = resolveRoute(conn, 'judge')
  if (story.preset === preset && story.model) out.story = story.model
  if (judge.preset === preset && judge.model) out.judge = judge.model
  return out
}

/**
 * The OpenAI-compatible client's view of one preset: its address and key, the models the roles
 * use there, and the story settings.
 */
export function endpointFor(conn: ConnectionSettings, preset: ConnectionPreset): Endpoint {
  const slot = slotFor(conn, preset)
  const models = modelsOnPreset(conn, preset)
  const storyModel = models.story ?? models.judge ?? ''
  return {
    preset,
    baseUrl: normalizeBaseUrl(slot.baseUrl),
    apiKey: slot.apiKey.trim(),
    storyModel,
    judgeModel: models.judge && models.judge !== storyModel ? models.judge : '',
    storyTemperature: conn.storyTemperature,
    maxTokens: conn.maxTokens,
  }
}

/** An endpoint aimed at one route (its model becomes the endpoint's default). */
export function endpointForRoute(conn: ConnectionSettings, route: Route): Endpoint {
  return { ...endpointFor(conn, route.preset), storyModel: route.model, judgeModel: '' }
}
