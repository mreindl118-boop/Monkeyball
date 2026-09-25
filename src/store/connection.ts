// Connection settings across versions: the Phase 1 migration and the API key helpers used by
// save export/import and the debug panel. Pure functions (no store, no database), so both
// src/store/settings.ts and src/db/repo.ts can use them.

import { detectPreset, isPresetId, normalizeBaseUrl, PRESET_IDS, presetFor } from '../llm/presets'
import type { ConnectionPreset, ConnectionSettings, Effort } from '../types'
import { DEFAULT_CONNECTION } from './defaults'

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high']

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Stored connection settings (any version) in the current shape.
 *
 * Phase 1 stored `{ preset, baseUrl, apiKey, providers?, storyModel, judgeModel, ... }`: the active
 * preset's address and key at the top, other presets' in `providers`. That becomes the active
 * preset's slot, both roles on that preset, and the same models, so no key or model is lost. A
 * Phase 1 install that never set anything up (no model, no key, default address) starts on the
 * new defaults instead: Claude for both roles.
 */
export function migrateConnection(stored: unknown): ConnectionSettings {
  return settleProviders(migrateShape(stored))
}

function migrateShape(stored: unknown): ConnectionSettings {
  const d = structuredClone(DEFAULT_CONNECTION) as ConnectionSettings
  if (!isPlainObject(stored)) return d

  const providers = d.providers
  if (isPlainObject(stored.providers)) {
    for (const id of PRESET_IDS) {
      const slot = stored.providers[id]
      if (!isPlainObject(slot)) continue
      providers[id] = {
        baseUrl: str(slot.baseUrl).trim() ? str(slot.baseUrl) : providers[id].baseUrl,
        apiKey: str(slot.apiKey),
      }
    }
  }

  const out: ConnectionSettings = {
    providers,
    story: d.story,
    judge: d.judge,
    storyTemperature: num(stored.storyTemperature, d.storyTemperature),
    maxTokens: num(stored.maxTokens, d.maxTokens),
    effort: EFFORTS.includes(stored.effort as Effort) ? (stored.effort as Effort) : d.effort,
  }

  if (isPlainObject(stored.story)) {
    const story = stored.story
    const judge = isPlainObject(stored.judge) ? stored.judge : {}
    out.story = {
      preset: isPresetId(story.preset) ? story.preset : d.story.preset,
      model: str(story.model),
    }
    out.judge = {
      preset: judge.preset === 'same' || isPresetId(judge.preset) ? judge.preset : 'same',
      model: isPlainObject(stored.judge) ? str(judge.model) : d.judge.model,
    }
    return out
  }

  // Phase 1 shape.
  const legacyUrl = str(stored.baseUrl)
  const legacyKey = str(stored.apiKey)
  const storyModel = str(stored.storyModel).trim()
  const judgeModel = str(stored.judgeModel).trim()
  if (!isPresetId(stored.preset) && !legacyUrl && !legacyKey && !storyModel && !judgeModel) return out
  const preset: ConnectionPreset = isPresetId(stored.preset) ? stored.preset : legacyUrl ? detectPreset(legacyUrl) : 'ollama'
  if (legacyUrl.trim()) providers[preset] = { ...providers[preset], baseUrl: legacyUrl }
  if (legacyKey) providers[preset] = { ...providers[preset], apiKey: legacyKey }

  const anyKey = PRESET_IDS.some((id) => providers[id].apiKey.trim())
  const defaultUrl = normalizeBaseUrl(providers[preset].baseUrl) === normalizeBaseUrl(presetFor(preset).baseUrl)
  if (!storyModel && !judgeModel && !anyKey && defaultUrl) return out

  out.story = { preset, model: storyModel }
  out.judge = { preset: 'same', model: judgeModel }
  return out
}

/** A role on the Custom preset moves to Claude (see settleProviders). */
function customToClaude<T extends string>(preset: T): T | 'claude' {
  return preset === 'custom' ? 'claude' : preset
}

/**
 * Addresses the app itself decides:
 * - Claude, ChatGPT and Grok always talk to their own API. Their cards have no address field, so
 *   a stored address (from an imported file, say) could send a key somewhere the player can't
 *   see; it is reset to the preset's.
 * - A Custom slot pointed at Anthropic's API (a Phase 1 setup) moves to the Claude card, which
 *   uses the official SDK: its key goes to Claude when Claude has none (or the same one), and
 *   roles on Custom move to Claude with their models. With a different Claude key already
 *   stored, nothing moves and calls on Custom stop with a "use the Claude card" problem.
 */
function settleProviders(conn: ConnectionSettings): ConnectionSettings {
  const providers = { ...conn.providers }
  for (const id of PRESET_IDS) {
    if (presetFor(id).group === 'main') providers[id] = { ...providers[id], baseUrl: presetFor(id).baseUrl }
  }
  const custom = providers.custom
  if (detectPreset(custom.baseUrl) !== 'claude') return { ...conn, providers }
  const customKey = custom.apiKey.trim()
  const claudeKey = providers.claude.apiKey.trim()
  if (claudeKey && customKey && claudeKey !== customKey) return { ...conn, providers }
  if (!claudeKey && customKey) providers.claude = { ...providers.claude, apiKey: custom.apiKey }
  providers.custom = { baseUrl: presetFor('custom').baseUrl, apiKey: '' }
  return {
    ...conn,
    providers,
    story: { ...conn.story, preset: customToClaude(conn.story.preset) },
    judge: { ...conn.judge, preset: customToClaude(conn.judge.preset) },
  }
}

/**
 * Connection settings (any stored version) with every API key blanked: save exports never carry
 * keys. Older shapes are migrated first, so a Phase 1 key at the top level can't slip through.
 */
export function withoutApiKeys(stored: unknown): ConnectionSettings {
  const conn = migrateConnection(stored)
  const providers = { ...conn.providers }
  for (const id of PRESET_IDS) {
    if (providers[id]) providers[id] = { ...providers[id], apiKey: '' }
  }
  return { ...conn, providers }
}

/**
 * Imported connection settings (any version) with this device's keys: each preset keeps the key
 * stored here for that preset, so a key never moves to another provider. Wherever a local key is
 * kept, the local address comes with it: a file can't point this device's key at a server of its
 * choosing. A slot whose file carries its own key (older exports) is taken whole from the file.
 */
export function withLocalKeys(imported: unknown, local: ConnectionSettings): ConnectionSettings {
  const conn = migrateConnection(imported)
  const providers = { ...conn.providers }
  for (const id of PRESET_IDS) {
    const localSlot = local.providers?.[id]
    const key = localSlot?.apiKey ?? ''
    if (key && !providers[id].apiKey) providers[id] = { baseUrl: localSlot?.baseUrl ?? providers[id].baseUrl, apiKey: key }
  }
  return { ...conn, providers }
}

/** Connection settings with every key passed through `mask` (for the debug panel). */
export function maskApiKeys(conn: ConnectionSettings, mask: (key: string) => string): ConnectionSettings {
  const providers = { ...conn.providers }
  for (const id of PRESET_IDS) {
    if (providers[id]) providers[id] = { ...providers[id], apiKey: mask(providers[id].apiKey) }
  }
  return { ...conn, providers }
}
