// Resolving a slot to art (docs/SPEC.md, "Art and gallery"; ARCHITECTURE, Art). First match wins:
//
//   1. imported   the player's own image for the slot (Dexie images table, the slot key; pack art too)
//   2. bundled    public/art/{setId}/{characterId}/tier-{n} or ending-{type} (.webp, .png, .jpg),
//                 listed at build time by vite.config.ts as `virtual:bundled-art`
//   3. generated  painted once and cached (Dexie, the slot key plus '#generated')
//   4. placeholder
//
// A character's Polycule ending shows the group's picture once the polycule is known
// (setPolyculeGroup, kept in kv 'artGroups'); favorites are kv 'artFavorites' (every source can be a
// favorite, bundled art too).
//
// Stored images are handed out as blob: URLs from one shared cache: the same image shares one URL,
// every resolveArt result holds a reference, and releaseArt drops it; the URL is revoked a moment
// after the last reference goes (so a refresh that finds the same image doesn't flash). useArt does
// all of that for components and follows changes (generation finishing, an import, a favorite).

import { useCallback, useEffect, useState } from 'react'
import bundledFiles from 'virtual:bundled-art'
import { BUNDLED_CHARACTERS } from '../data/bundled'
import { db as appDb, type CrushDB } from '../db/db'
import { kvGet, kvSet } from '../db/repo'
import { makeThumbnail } from './compress'
import { useRoster } from '../store/roster'
import type { StoredImage } from '../types'
import { generatedKey, parseSlotKey, polyculeSlot, slotKey, type ArtSlot, type ResolvedArt } from './types'

// ---------------------------------------------------------------------------
// Change events

type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

/** Call `fn` when the art for `key` (a slot key, or '*' for any) may have changed. */
export function subscribeArt(key: string, fn: Listener): () => void {
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(fn)
  return () => {
    set.delete(fn)
    if (!set.size) listeners.delete(key)
  }
}

/**
 * Tell everyone showing these slots (or keys) to look again. A group's Polycule picture also
 * notifies each member's Polycule ending. With no argument, every slot (after a save import).
 */
export function emitArtChange(slots?: readonly (ArtSlot | string)[]): void {
  const keys = new Set<string>()
  if (!slots) {
    for (const k of listeners.keys()) keys.add(k)
  } else {
    for (const s of slots) {
      const slot = typeof s === 'string' ? parseSlotKey(s) : s
      const key = typeof s === 'string' ? s.replace(/#generated$/, '') : slotKey(s)
      keys.add(key)
      if (slot?.kind === 'group' && slot.slot === 'polycule') {
        for (const id of slot.characterIds) keys.add(`${id}:ending-polycule`)
      }
    }
    keys.add('*')
  }
  for (const k of keys) {
    for (const fn of [...(listeners.get(k) ?? [])]) {
      try {
        fn()
      } catch {
        // A listener's problem is its own.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Object URLs

interface UrlEntry {
  url: string
  refs: number
  timer?: ReturnType<typeof setTimeout>
}

const urlConfig = {
  graceMs: 1500,
  create: (blob: Blob): string => URL.createObjectURL(blob),
  revoke: (url: string): void => URL.revokeObjectURL(url),
}
const byVersion = new Map<string, UrlEntry>()
const versionOfUrl = new Map<string, string>()

/** Tests: swap how URLs are made and revoked, and the grace before revoking. */
export function configureArtUrls(patch: Partial<typeof urlConfig>): void {
  Object.assign(urlConfig, patch)
}

/** How many blob: URLs the cache holds right now (tests, the debug panel). */
export function liveArtUrls(): number {
  return byVersion.size
}

function acquireUrl(version: string, blob: Blob): string | undefined {
  const hit = byVersion.get(version)
  if (hit) {
    if (hit.timer) clearTimeout(hit.timer)
    hit.timer = undefined
    hit.refs += 1
    return hit.url
  }
  let url: string
  try {
    url = urlConfig.create(blob)
  } catch {
    return undefined
  }
  byVersion.set(version, { url, refs: 1 })
  versionOfUrl.set(url, version)
  return url
}

function dropUrl(version: string): void {
  const e = byVersion.get(version)
  if (!e || e.refs > 0) return
  byVersion.delete(version)
  versionOfUrl.delete(e.url)
  try {
    urlConfig.revoke(e.url)
  } catch {
    // Already gone.
  }
}

/**
 * Let go of art from resolveArt: its blob: URL is revoked once nothing else holds it (after a
 * short grace). Bundled and placeholder art need nothing; releasing twice is harmless.
 */
export function releaseArt(art: ResolvedArt | null | undefined): void {
  const url = art?.url
  if (!url) return
  const version = versionOfUrl.get(url)
  const e = version ? byVersion.get(version) : undefined
  if (!version || !e || e.refs <= 0) return
  e.refs -= 1
  if (e.refs > 0) return
  if (urlConfig.graceMs <= 0) dropUrl(version)
  else e.timer = setTimeout(() => dropUrl(version), urlConfig.graceMs)
}

// ---------------------------------------------------------------------------
// Bundled art

const EXT_ORDER = ['webp', 'png', 'jpg', 'jpeg']

/** `${setId}/${characterId}/${stem}` -> the preferred file (webp, then png, then jpg). */
export function indexBundled(files: readonly string[]): Map<string, string> {
  const index = new Map<string, string>()
  const rank = (p: string) => EXT_ORDER.indexOf(p.slice(p.lastIndexOf('.') + 1).toLowerCase())
  for (const path of files) {
    const m = /^art\/([^/]+)\/([^/]+)\/([^/.]+)\.([a-z]+)$/.exec(path)
    if (!m || rank(path) < 0) continue
    const k = `${m[1]}/${m[2]}/${m[3]}`
    const prev = index.get(k)
    if (!prev || rank(path) < rank(prev)) index.set(k, path)
  }
  return index
}

// ---------------------------------------------------------------------------
// kv: favorites and polycule groups

const FAVORITES_KEY = 'artFavorites'
const GROUPS_KEY = 'artGroups'

export interface ArtResolverDeps {
  db?: CrushDB
  /** Bundled art paths (default: the virtual:bundled-art list). */
  bundled?: readonly string[]
  /** The set a character belongs to (default: the roster, then the bundled sets). */
  setOf?: (characterId: string) => string | undefined
  /** Prefix for bundled URLs (default import.meta.env.BASE_URL, './' in builds). */
  baseUrl?: string
  /**
   * A thumbnail for a stored picture that has none yet (rows from pack imports and older saves),
   * made the first time a tile asks and kept on the row. Default makeThumbnail.
   */
  thumbnail?: (blob: Blob) => Promise<Blob | undefined>
}

/** What resolveArt is asked for. */
export interface ResolveOptions {
  /**
   * A tile, a coaster or the profile strip: the stored picture's thumbnail when it has one (the
   * full picture otherwise). Bundled art has no thumbnails; the browser caches it as a file.
   */
  thumb?: boolean
}

const bundledSetOf = new Map(BUNDLED_CHARACTERS.map((e) => [e.character.id, e.setId]))

function defaultSetOf(id: string): string | undefined {
  return useRoster.getState().entries[id]?.setId ?? bundledSetOf.get(id)
}

export interface ArtResolver {
  resolveArt: (slot: ArtSlot, opts?: ResolveOptions) => Promise<ResolvedArt>
  /** The slot the art lives under: a character's Polycule ending becomes the group's picture. */
  canonicalSlot: (slot: ArtSlot) => Promise<ArtSlot>
  /** The bundled file for a slot (a path under public/), or null. */
  bundledPath: (slot: ArtSlot) => string | null
  /** The imported row for a slot (canonical first), or undefined. */
  importedImage: (slot: ArtSlot) => Promise<StoredImage | undefined>
  /** The generated row for a slot (canonical first), or undefined. */
  generatedImage: (slot: ArtSlot) => Promise<StoredImage | undefined>
  favorites: () => Promise<string[]>
  setFavorite: (slot: ArtSlot, on: boolean) => Promise<void>
  /** Remember who is in a character's Polycule (each member's ending shows the group picture). */
  setPolyculeGroup: (members: readonly string[]) => Promise<void>
  polyculeGroupOf: (characterId: string) => Promise<string[] | null>
  db: CrushDB
}

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

export function createArtResolver(deps: ArtResolverDeps = {}): ArtResolver {
  const d = deps.db ?? appDb
  const index = indexBundled(deps.bundled ?? bundledFiles)
  const setOf = deps.setOf ?? defaultSetOf
  const base = deps.baseUrl ?? import.meta.env.BASE_URL ?? './'
  const thumbnail = deps.thumbnail ?? makeThumbnail
  /** Rows a thumbnail was started for this session (each is tried once). */
  const thumbing = new Set<string>()
  /** Give a stored row a thumbnail in the background, for its next showing. Never throws. */
  const backfillThumb = (row: StoredImage): void => {
    const id = `${row.key}@${row.createdAt}`
    if (thumbing.has(id)) return
    thumbing.add(id)
    void (async () => {
      const thumb = await thumbnail(row.blob)
      if (!thumb) return
      await d.transaction('rw', d.images, async () => {
        const current = await d.images.get(row.key)
        // Only the same picture: a new painting or import meanwhile makes its own.
        if (current && current.createdAt === row.createdAt && !current.thumb) await d.images.update(row.key, { thumb })
      })
    })().catch(() => undefined)
  }
  // Favorites and groups are read from kv every time (a few bytes), so a save import, a slot
  // restore or a reset is followed without anyone telling the resolver. Writes queue behind each
  // other so two quick taps can't lose one.
  let writes: Promise<unknown> = Promise.resolve()
  const queueWrite = (fn: () => Promise<void>): Promise<void> => {
    const run = writes.then(fn, fn)
    writes = run.catch(() => undefined)
    return run
  }

  const readFavorites = async (): Promise<Set<string>> => {
    const stored = await safely(() => kvGet<unknown>(FAVORITES_KEY, d), undefined)
    return new Set(Array.isArray(stored) ? stored.filter((k): k is string => typeof k === 'string') : [])
  }

  const readGroups = async (): Promise<Record<string, string[]>> => {
    const stored = await safely(() => kvGet<unknown>(GROUPS_KEY, d), undefined)
    const out: Record<string, string[]> = {}
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      for (const [id, ids] of Object.entries(stored as Record<string, unknown>)) {
        if (Array.isArray(ids)) out[id] = ids.filter((x): x is string => typeof x === 'string')
      }
    }
    return out
  }

  const polyculeGroupOf = async (characterId: string): Promise<string[] | null> => {
    const g = (await readGroups())[characterId]
    return g && g.length >= 2 ? [...g] : null
  }

  const canonicalSlot = async (slot: ArtSlot): Promise<ArtSlot> => {
    if (slot.kind !== 'ending' || slot.ending !== 'polycule') return slot
    const members = await polyculeGroupOf(slot.characterId)
    return (members && polyculeSlot(members)) ?? slot
  }

  /** The keys to look under, canonical first. */
  const keysOf = async (slot: ArtSlot): Promise<ArtSlot[]> => {
    const c = await canonicalSlot(slot)
    return slotKey(c) === slotKey(slot) ? [slot] : [c, slot]
  }

  const bundledPath = (slot: ArtSlot): string | null => {
    if (slot.kind === 'group') return null
    const setId = setOf(slot.characterId)
    if (!setId) return null
    const stem = slot.kind === 'tier' ? `tier-${slot.tier}` : `ending-${slot.ending}`
    return index.get(`${setId}/${slot.characterId}/${stem}`) ?? null
  }

  const importedImage = async (slot: ArtSlot): Promise<StoredImage | undefined> => {
    for (const s of await keysOf(slot)) {
      const row = await safely(() => d.images.get(slotKey(s)), undefined)
      if (row && row.source === 'imported' && row.blob) return row
    }
    return undefined
  }

  const generatedImage = async (slot: ArtSlot): Promise<StoredImage | undefined> => {
    for (const s of await keysOf(slot)) {
      const row = await safely(() => d.images.get(generatedKey(s)), undefined)
      if (row?.blob) return row
      // A generated picture stored under the slot key itself (older saves) counts too.
      const plain = await safely(() => d.images.get(slotKey(s)), undefined)
      if (plain && plain.source === 'generated' && plain.blob) return plain
    }
    return undefined
  }

  const fromStored = (key: string, row: StoredImage, favorite: boolean, thumb: boolean): ResolvedArt => {
    const small = thumb && row.thumb instanceof Blob ? row.thumb : null
    if (thumb && !small) backfillThumb(row)
    const blob = small ?? row.blob
    const version = `${row.key}@${row.createdAt}@${blob.size}${small ? '@thumb' : ''}`
    const url = acquireUrl(version, blob)
    const art: ResolvedArt = { source: row.source, key, createdAt: row.createdAt }
    if (url) art.url = url
    if (row.prompt) art.prompt = row.prompt
    if (typeof row.seed === 'number') art.seed = row.seed
    if (favorite) art.favorite = true
    if (row.key.replace(/#generated$/, '') !== key) art.resolvedKey = row.key.replace(/#generated$/, '')
    return art
  }

  const resolveArt = async (slot: ArtSlot, opts: ResolveOptions = {}): Promise<ResolvedArt> => {
    const key = slotKey(slot)
    const thumb = !!opts.thumb
    const favorite = (await readFavorites()).has(key)
    const imported = await importedImage(slot)
    if (imported) return fromStored(key, imported, favorite, thumb)
    const path = bundledPath(slot)
    if (path) return { source: 'bundled', key, url: `${base}${path}`, ...(favorite ? { favorite: true } : {}) }
    const generated = await generatedImage(slot)
    if (generated) return fromStored(key, generated, favorite, thumb)
    return { source: 'placeholder', key, ...(favorite ? { favorite: true } : {}) }
  }

  return {
    db: d,
    resolveArt,
    canonicalSlot,
    bundledPath,
    importedImage,
    generatedImage,
    polyculeGroupOf,
    favorites: async () => [...(await readFavorites())],
    setFavorite: (slot, on) =>
      queueWrite(async () => {
        const favs = await readFavorites()
        const key = slotKey(slot)
        if (on === favs.has(key)) return
        if (on) favs.add(key)
        else favs.delete(key)
        await kvSet(FAVORITES_KEY, [...favs], d)
      }),
    setPolyculeGroup: (members) =>
      queueWrite(async () => {
        const slot = polyculeSlot(members)
        if (slot?.kind !== 'group') return
        const groups = { ...(await readGroups()) }
        for (const id of slot.characterIds) groups[id] = [...slot.characterIds]
        await kvSet(GROUPS_KEY, groups, d)
      }),
  }
}

// ---------------------------------------------------------------------------
// The app's resolver

let appResolver: ArtResolver | null = null

/** The resolver the app uses (tests swap it with setArtResolver). */
export function artResolver(): ArtResolver {
  appResolver ??= createArtResolver()
  return appResolver
}

/** Tests: use this resolver everywhere (null goes back to the app's). */
export function setArtResolver(r: ArtResolver | null): void {
  appResolver = r
}

/**
 * The art for a slot: imported, bundled, generated or the placeholder. A stored image comes with a
 * blob: URL: call releaseArt when done with it (useArt does).
 */
export function resolveArt(slot: ArtSlot, opts?: ResolveOptions): Promise<ResolvedArt> {
  return artResolver().resolveArt(slot, opts)
}

/** Slot keys the player marked as favorites. */
export function getFavorites(): Promise<string[]> {
  return artResolver().favorites()
}

/** Everyone in a character's Polycule once its ending played (for unlockedSlots), else null. */
export function getPolyculeGroup(characterId: string): Promise<string[] | null> {
  return artResolver().polyculeGroupOf(characterId)
}

// ---------------------------------------------------------------------------
// The hook

interface ArtState {
  key: string | null
  art: ResolvedArt | null
  loading: boolean
}

/**
 * The art for a slot, kept current: it looks again when the slot's art changes (generation
 * finished, an import, a favorite) or on refresh(). The blob: URL it hands out is released when
 * the component goes or the art changes. null: nothing to look up (art stays null).
 */
export function useArt(slot: ArtSlot | null, opts: ResolveOptions = {}): { art: ResolvedArt | null; loading: boolean; refresh(): void } {
  const key = slot ? slotKey(slot) : null
  const thumb = !!opts.thumb
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<ArtState>({ key, art: null, loading: !!key })

  useEffect(() => {
    // The key names the slot completely (parseSlotKey), so a new slot object for the same picture
    // doesn't look it up again.
    // Nothing is set synchronously here: a new key reads as loading until its art lands (see the
    // return below), and a refresh keeps showing the current art meanwhile.
    const current = key ? parseSlotKey(key) : null
    if (!key || !current) return
    let alive = true
    let held: ResolvedArt | null = null
    resolveArt(current, { thumb }).then(
      (art) => {
        if (!alive) {
          releaseArt(art)
          return
        }
        held = art
        setState({ key, art, loading: false })
      },
      () => {
        if (alive) setState({ key, art: { source: 'placeholder', key }, loading: false })
      },
    )
    const off = subscribeArt(key, () => setTick((t) => t + 1))
    return () => {
      alive = false
      off()
      if (held) releaseArt(held)
    }
  }, [key, tick, thumb])

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  const mine = !!key && state.key === key
  return { art: mine ? state.art : null, loading: key ? !mine || state.loading : false, refresh }
}
