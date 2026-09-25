import { create } from 'zustand'
import { db, type CrushDB } from '../db/db'
import { kvGet, kvSet } from '../db/repo'
import type { ConnectionSettings, ImageSettings, PlayerProfile, Settings } from '../types'
import { DEFAULT_SETTINGS, defaultSettings } from './defaults'

export interface SettingsState {
  loaded: boolean
  settings: Settings
  profile: PlayerProfile | null
  /** Set when storage couldn't be read (private mode, blocked storage). Defaults are in use. */
  error: string | null
  /** Load settings and profile from Dexie. Safe to call more than once. */
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
  updateConnection: (patch: Partial<ConnectionSettings>) => Promise<void>
  updateImage: (patch: Partial<ImageSettings>) => Promise<void>
  setProfile: (p: PlayerProfile) => Promise<void>
  /** Back to defaults in memory only (use after repo.wipeAll()). */
  resetInMemory: () => void
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Deep-merge stored values over defaults so fields added in later versions get their defaults.
 * Objects merge key by key; arrays and primitives from storage replace the default when their
 * type matches; anything with the wrong shape falls back to the default.
 */
export function mergeDeep<T>(defaults: T, stored: unknown): T {
  if (stored === undefined || stored === null) return structuredClone(defaults)
  if (isPlainObject(defaults)) {
    if (!isPlainObject(stored)) return structuredClone(defaults)
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(defaults)) {
      out[key] = mergeDeep((defaults as Record<string, unknown>)[key], stored[key])
    }
    // Keep stored keys the defaults don't know about (optional fields, future additions).
    for (const key of Object.keys(stored)) {
      if (!(key in out) && stored[key] !== undefined) out[key] = structuredClone(stored[key])
    }
    return out as T
  }
  if (Array.isArray(defaults)) {
    return (Array.isArray(stored) ? structuredClone(stored) : structuredClone(defaults)) as T
  }
  return (typeof stored === typeof defaults ? stored : defaults) as T
}

/** Stored settings (possibly from an older version) merged over the current defaults. */
export function mergeSettings(stored: unknown): Settings {
  return mergeDeep<Settings>(DEFAULT_SETTINGS as Settings, stored)
}

function normalizeProfile(stored: unknown): PlayerProfile | null {
  if (!isPlainObject(stored) || typeof stored.name !== 'string' || !stored.name.trim()) return null
  return {
    name: stored.name,
    gender: (['woman', 'man', 'nonbinary', 'custom'] as const).includes(
      stored.gender as PlayerProfile['gender'],
    )
      ? (stored.gender as PlayerProfile['gender'])
      : 'nonbinary',
    customGender: typeof stored.customGender === 'string' ? stored.customGender : undefined,
    matchAs: (['woman', 'man', 'nonbinary'] as const).includes(
      stored.matchAs as NonNullable<PlayerProfile['matchAs']>,
    )
      ? (stored.matchAs as PlayerProfile['matchAs'])
      : undefined,
    pronouns: typeof stored.pronouns === 'string' ? stored.pronouns : '',
    bodyNotes: typeof stored.bodyNotes === 'string' ? stored.bodyNotes : '',
    relationshipStyle: (['monogamous', 'open', 'polyamorous', 'figuring'] as const).includes(
      stored.relationshipStyle as PlayerProfile['relationshipStyle'],
    )
      ? (stored.relationshipStyle as PlayerProfile['relationshipStyle'])
      : 'figuring',
  }
}

/** Build a settings store bound to a database. The app uses `useSettings`; tests make their own. */
export function createSettingsStore(d: CrushDB = db) {
  let loading: Promise<void> | null = null

  return create<SettingsState>()((set, get) => {
    const persist = (settings: Settings) => kvSet('settings', settings, d)

    return {
      loaded: false,
      settings: defaultSettings(),
      profile: null,
      error: null,

      load: () => {
        loading ??= (async () => {
          try {
            const [stored, profile] = await Promise.all([
              kvGet<unknown>('settings', d),
              kvGet<unknown>('profile', d),
            ])
            set({
              settings: mergeSettings(stored),
              profile: normalizeProfile(profile),
              loaded: true,
              error: null,
            })
          } catch (e) {
            set({ loaded: true, error: e instanceof Error ? e.message : String(e) })
          } finally {
            loading = null
          }
        })()
        return loading
      },

      update: async (patch) => {
        const settings = { ...get().settings, ...patch }
        set({ settings })
        await persist(settings)
      },

      updateConnection: async (patch) => {
        const prev = get().settings
        const settings = { ...prev, connection: { ...prev.connection, ...patch } }
        set({ settings })
        await persist(settings)
      },

      updateImage: async (patch) => {
        const prev = get().settings
        const settings = { ...prev, image: { ...prev.image, ...patch } }
        set({ settings })
        await persist(settings)
      },

      setProfile: async (p) => {
        const profile = { ...p }
        set({ profile })
        await kvSet('profile', profile, d)
      },

      resetInMemory: () => {
        set({ settings: defaultSettings(), profile: null })
      },
    }
  })
}

export const useSettings = createSettingsStore()

/** The judge model actually used: the judge model, or the story model when blank. */
export function effectiveJudgeModel(conn: ConnectionSettings): string {
  return conn.judgeModel.trim() || conn.storyModel
}
