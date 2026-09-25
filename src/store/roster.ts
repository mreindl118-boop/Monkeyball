// useRoster: every character the game knows, by set. Bundled sets come from src/data/sets
// (read-only, never written to Dexie); imported packs from the packs table; custom and imported
// characters from the customCharacters table. Custom characters without a pack live in the
// synthetic "My characters" set (id 'custom'). Which sets are in play is settings.activeSets.
//
// In components, subscribe to `entries` and `sets` and derive with the select* functions (or the
// hooks below) inside useMemo: the bound selectors on the store build new arrays each call, so
// never return them straight from a zustand selector.
//
// Like the settings store, a storage failure is recorded in `error` and the roster keeps working
// in memory for the session; saves and imports also say so in what they return (STORAGE_FIELD,
// STORAGE_MESSAGE), so the player is never told something was saved when it wasn't. Every
// mutation waits for the first load, so nothing written early is lost when the tables are read.

import { useMemo } from 'react'
import { create } from 'zustand'
import { BUNDLED_CHARACTERS, BUNDLED_SET_IDS, BUNDLED_SETS, RESERVED_CHARACTER_IDS, RESERVED_SET_IDS } from '../data/bundled'
import { db, type CrushDB, type CustomCharacterRow, type PackRow } from '../db/db'
import { normalizeCharacter, normalizeManifest } from '../mods/normalize'
import { dropOutsidePartners, droppedPartnerNote, type ImportError, type ImportResult } from '../mods/pack'
import { ID_PATTERN, validateCharacter, validateManifest, type ValidateContext, type ValidationIssue } from '../mods/validate'
import { PARTNER_RELATIONS } from '../mods/normalize'
import type { Character, RosterEntry, SetManifest, SetRelationKind, Settings, ShowMe, StoredImage } from '../types'
import { useSettings } from './settings'

export const CUSTOM_SET_ID = 'custom'
export const CUSTOM_SET_NAME = 'My characters'
const ID_MAX = 40

/** The field of the issue saveCustomCharacter() returns when storage refused the write. */
export const STORAGE_FIELD = 'storage'
/** What to tell the player when storage refused a save or an import. */
export const STORAGE_MESSAGE =
  "This device's storage refused the save, so it only lasts until crushLAB closes. Free up some space, or export what you made."

/** The synthetic set for custom characters that aren't in a pack. */
export function customSetManifest(characters: string[] = []): SetManifest {
  return {
    id: CUSTOM_SET_ID,
    name: CUSTOM_SET_NAME,
    blurb: 'Characters you made in the editor or imported on their own.',
    characters,
    relationships: [],
  }
}

/** Someone a character is connected to. */
export interface RosterRelation {
  /** The other character's id. */
  id: string
  kind: SetRelationKind
  /** The manifest's one-line note; empty for a relation only a card declares. */
  note: string
  /** The set whose manifest or card declares it. */
  setId: string
  from: 'manifest' | 'card'
}

export interface ImportOutcome {
  /** True when everything in the result was saved. */
  ok: boolean
  /** Where the characters went: the pack's id, 'custom', or null when nothing was saved. */
  setId: string | null
  /** Ids of the characters saved. */
  saved: string[]
  /** Problems found at save time (id clashes, an invalid card or manifest, storage). */
  errors: ImportError[]
  /**
   * Set when the file would replace a pack already on this device and that changes more than
   * its cards (characters leave, or the name or author differ). Nothing was saved: ask the
   * player, then call importPack(result, { replace: true }).
   */
  confirm?: PackReplacement
  /** A replaced pack's characters that the new file left out, now gone from the roster. */
  removed?: string[]
  /** A replaced pack's characters whose new card failed its checks: the earlier card stays. */
  kept?: string[]
}

/** What replacing a pack on this device would do. */
export interface PackReplacement {
  setId: string
  oldName: string
  oldAuthor: string
  newName: string
  newAuthor: string
  /** Characters of the pack on this device that the new file leaves out. */
  removes: { id: string; name: string }[]
}

export interface ImportPackOptions {
  /** The player agreed to replace the pack with the same id (see ImportOutcome.confirm). */
  replace?: boolean
}

export interface RosterData {
  /** Bundled sets, then imported packs, then "My characters" when it has anyone. */
  sets: SetManifest[]
  entries: Record<string, RosterEntry>
}

/** What the roster needs from the settings store (tests pass a stand-in). */
export interface SettingsAccess {
  getState(): { settings: Pick<Settings, 'activeSets'>; update: (patch: Partial<Settings>) => Promise<void> }
}

export interface RosterState extends RosterData {
  loaded: boolean
  error: string | null
  /** Load packs and custom characters from Dexie. Safe to call more than once. */
  load: () => Promise<void>
  /** Read the tables again (after a save import or slot restore). */
  reload: () => Promise<void>
  /**
   * Validate and save a custom character into 'custom' or an imported pack. Returns the problems
   * (and saves nothing) when there are any; an empty list means it was saved.
   * previousId: undefined saves or updates this id; null means a new character (the id must be
   * free); a string is the id being edited (so the id can change).
   */
  saveCustomCharacter: (character: Character, setId?: string, previousId?: string | null) => Promise<ValidationIssue[]>
  /** Delete a custom or imported character. Bundled characters can't be deleted. */
  deleteCustomCharacter: (id: string) => Promise<boolean>
  /** Copy any character into an editable set with a new id (nova-copy, nova-copy-2...). */
  duplicateCharacter: (id: string) => Promise<string | null>
  /**
   * Save what importFile() returned, after checking ids against the whole roster. Loose cards
   * lose partners who aren't in My characters (with a note). Replacing a pack that changes more
   * than its cards comes back with `confirm` until called with { replace: true }; characters
   * the player made in the pack stay in it.
   */
  importPack: (result: ImportResult, opts?: ImportPackOptions) => Promise<ImportOutcome>
  /**
   * Delete an imported pack and its characters. Relationship progress is kept. Characters the
   * player made in the pack move to My characters; their ids come back.
   */
  removePack: (id: string) => Promise<string[]>
  /** Turn a set on or off (settings.activeSets). Progress is never deleted. */
  setActive: (setId: string, on: boolean) => Promise<void>

  activeEntries: (settings: Pick<Settings, 'activeSets' | 'showMe'>) => RosterEntry[]
  relationsFor: (id: string, activeSets?: readonly string[]) => RosterRelation[]
  setOf: (id: string) => SetManifest | undefined
  /** Validation context for the editor, for a character being saved into setId. */
  validationContext: (setId: string, previousId?: string | null, characterId?: string) => ValidateContext
}

// ---------------------------------------------------------------------------
// Pure selectors

export function selectSetOf(data: RosterData, id: string): SetManifest | undefined {
  const setId = data.entries[id]?.setId
  return setId ? data.sets.find((s) => s.id === setId) : undefined
}

/** True when characters of the two sets know each other (same set, or a manifest's knows). */
export function setsLinked(data: Pick<RosterData, 'sets'>, a: string, b: string): boolean {
  if (a === b) return true
  const sa = data.sets.find((s) => s.id === a)
  const sb = data.sets.find((s) => s.id === b)
  return !!(sa?.knows?.includes(b) || sb?.knows?.includes(a))
}

/**
 * Show me is about the character's gender: Women shows women, Men shows men. Nonbinary
 * characters appear under Everyone only (docs/ARCHITECTURE.md, Phase 2 decisions), and the
 * filter says so with this line.
 */
export const SHOW_ME_NONBINARY = 'Nonbinary characters show under Everyone.'

export function matchesShowMe(entry: RosterEntry, showMe: ShowMe): boolean {
  if (showMe === 'women') return entry.character.gender === 'woman'
  if (showMe === 'men') return entry.character.gender === 'man'
  return true
}

/** Characters of the active sets that the Show me filter lets through, in set and manifest order. */
export function selectActiveEntries(
  data: RosterData,
  settings: Pick<Settings, 'activeSets' | 'showMe'>,
): RosterEntry[] {
  const out: RosterEntry[] = []
  for (const set of data.sets) {
    if (!settings.activeSets.includes(set.id)) continue
    for (const id of set.characters) {
      const entry = data.entries[id]
      if (entry && entry.setId === set.id && matchesShowMe(entry, settings.showMe)) out.push(entry)
    }
  }
  return out
}

/** Characters of one set, in manifest order. */
export function selectSetEntries(data: RosterData, setId: string): RosterEntry[] {
  const set = data.sets.find((s) => s.id === setId)
  if (!set) return []
  return set.characters.map((id) => data.entries[id]).filter((e): e is RosterEntry => !!e && e.setId === setId)
}

/**
 * Everyone a character is connected to: manifest relationships plus card partners (either
 * card), deduplicated by person and kind. Only characters in the same set, or in a set a
 * manifest's knows links; with activeSets, only characters in active sets.
 */
export function selectRelationsFor(data: RosterData, id: string, activeSets?: readonly string[]): RosterRelation[] {
  const me = data.entries[id]
  if (!me) return []
  const out: RosterRelation[] = []
  const reachable = (other: string) => {
    const e = data.entries[other]
    if (!e || other === id) return false
    if (activeSets && !activeSets.includes(e.setId)) return false
    return setsLinked(data, me.setId, e.setId)
  }
  const add = (r: RosterRelation) => {
    const dupe = out.find((x) => x.id === r.id && x.kind === r.kind)
    if (!dupe) out.push(r)
    else if (!dupe.note && r.note) dupe.note = r.note
  }
  // Partners, exes and situationships only ever come from the same set, whatever a manifest says.
  const sameSet = (other: string) => data.entries[other]?.setId === me.setId
  const isPartnerKind = (kind: string) => PARTNER_RELATIONS.includes(kind as (typeof PARTNER_RELATIONS)[number])
  for (const set of data.sets) {
    for (const r of set.relationships ?? []) {
      const other = r.a === id ? r.b : r.b === id ? r.a : null
      if (!other || !reachable(other)) continue
      if (isPartnerKind(r.kind) && !sameSet(other)) continue
      add({ id: other, kind: r.kind, note: r.note ?? '', setId: set.id, from: 'manifest' })
    }
  }
  for (const p of me.character.partners ?? []) {
    if (reachable(p.characterId) && sameSet(p.characterId)) {
      add({ id: p.characterId, kind: p.relation, note: '', setId: me.setId, from: 'card' })
    }
  }
  for (const e of Object.values(data.entries)) {
    if (e.setId !== me.setId) continue
    for (const p of e.character.partners ?? []) {
      if (p.characterId === id && reachable(e.character.id)) {
        add({ id: e.character.id, kind: p.relation, note: '', setId: e.setId, from: 'card' })
      }
    }
  }
  return out
}

/** Ids for a validation run: everyone in the set, and everyone else as taken. */
export function selectValidationContext(
  data: RosterData,
  setId: string,
  previousId?: string | null,
  characterId?: string,
): ValidateContext {
  // Which existing entry is "this character": the one being edited, or (upsert) the same id
  // already saved in this editable set.
  const selfId = previousId === null ? null : (previousId ?? characterId ?? null)
  const selfEntry = selfId ? data.entries[selfId] : undefined
  const self = selfEntry && selfEntry.source !== 'bundled' && selfEntry.setId === setId ? selfId : null
  const members = Object.values(data.entries)
    .filter((e) => e.setId === setId && e.character.id !== self)
    .map((e) => e.character.id)
  return {
    setCharacterIds: characterId ? [...members, characterId] : members,
    existingIds: Object.keys(data.entries).filter((id) => id !== self),
    reservedIds: RESERVED_CHARACTER_IDS.filter((id) => id !== self),
  }
}

// ---------------------------------------------------------------------------
// Store

function build(packs: ReadonlyMap<string, PackRow>, rows: ReadonlyMap<string, CustomCharacterRow>): RosterData & { skipped: string[] } {
  const entries: Record<string, RosterEntry> = {}
  const skipped: string[] = []
  for (const e of BUNDLED_CHARACTERS) entries[e.character.id] = e

  const packList = [...packs.values()].sort((a, b) => a.importedAt - b.importedAt || a.id.localeCompare(b.id))
  const packIds = new Set(packList.map((p) => p.id))
  const members = new Map<string, CustomCharacterRow[]>()
  for (const row of rows.values()) {
    if (entries[row.id]) {
      skipped.push(row.id) // a bundled character already has this id
      continue
    }
    const setId = packIds.has(row.setId) ? row.setId : CUSTOM_SET_ID
    entries[row.id] = { character: row.character, setId, source: row.source }
    const list = members.get(setId) ?? []
    list.push(row)
    members.set(setId, list)
  }

  const sets: SetManifest[] = [...BUNDLED_SETS]
  for (const pack of packList) {
    const ids = (members.get(pack.id) ?? []).map((r) => r.id)
    const listed = pack.manifest.characters.filter((id) => ids.includes(id))
    sets.push({ ...pack.manifest, id: pack.id, characters: [...listed, ...ids.filter((id) => !listed.includes(id)).sort()] })
  }
  const custom = (members.get(CUSTOM_SET_ID) ?? [])
    .slice()
    .sort((a, b) => a.character.name.localeCompare(b.character.name) || a.id.localeCompare(b.id))
    .map((r) => r.id)
  if (custom.length) sets.push(customSetManifest(custom))
  return { sets, entries, skipped }
}

function renameIn(m: SetManifest, from: string, to: string | null): SetManifest {
  const swap = (id: string) => (id === from ? to : id)
  const keep = (id: string | null): id is string => id !== null
  return {
    ...m,
    characters: m.characters.map(swap).filter(keep),
    relationships: m.relationships
      .filter((r) => to !== null || (r.a !== from && r.b !== from))
      .map((r) => ({ ...r, a: swap(r.a) ?? r.a, b: swap(r.b) ?? r.b })),
    ...(m.rumors
      ? {
          rumors: m.rumors
            .filter((r) => to !== null || (r.teller !== from && !r.about.includes(from)))
            .map((r) => ({ ...r, teller: swap(r.teller) ?? r.teller, about: r.about.map(swap).filter(keep) })),
        }
      : {}),
  }
}

export interface RosterDeps {
  db?: CrushDB
  settings?: SettingsAccess
  now?: () => number
}

/** Build a roster store bound to a database. The app uses `useRoster`; tests make their own. */
export function createRosterStore(deps: RosterDeps = {}) {
  const d = deps.db ?? db
  const settingsStore: SettingsAccess = deps.settings ?? useSettings
  const now = deps.now ?? Date.now
  const packs = new Map<string, PackRow>()
  const rows = new Map<string, CustomCharacterRow>()
  let loading: Promise<void> | null = null
  /** Bumped by every write, so a read that overlapped one reads again. */
  let writeSeq = 0
  const pending = new Set<Promise<unknown>>()

  return create<RosterState>()((set, get) => {
    const rebuild = () => {
      const { sets, entries } = build(packs, rows)
      set({ sets, entries })
    }
    const read = async () => {
      try {
        let packRows: PackRow[] = []
        let customRows: CustomCharacterRow[] = []
        for (let attempt = 0; attempt < 5; attempt++) {
          while (pending.size) await Promise.allSettled([...pending])
          const seq = writeSeq
          ;[packRows, customRows] = await Promise.all([d.packs.toArray(), d.customCharacters.toArray()])
          if (seq === writeSeq && pending.size === 0) break
        }
        packs.clear()
        rows.clear()
        for (const p of packRows) packs.set(p.id, { ...p, manifest: { ...normalizeManifest(p.manifest), id: p.id } })
        for (const r of customRows) {
          const character = normalizeCharacter(r.character)
          if (!character.id) continue
          rows.set(character.id, { ...r, id: character.id, character })
        }
        rebuild()
        set({ loaded: true, error: null })
      } catch (e) {
        rebuild()
        set({ loaded: true, error: e instanceof Error ? e.message : String(e) })
      }
    }
    const setActive = async (setId: string, on: boolean) => {
      const s = settingsStore.getState()
      const active = s.settings.activeSets
      if (on === active.includes(setId)) return
      await s.update({ activeSets: on ? [...active, setId] : active.filter((id) => id !== setId) })
    }
    const isEditableSet = (setId: string) => setId === CUSTOM_SET_ID || packs.has(setId)

    /**
     * Save rows (and a pack, its art, or a pack's removal) in memory and in Dexie, in one
     * transaction. Resolves false when storage refused it: the change stays in memory for the
     * session and `error` says why.
     */
    const commit = async (
      put: CustomCharacterRow[],
      remove: string[] = [],
      extra: { pack?: PackRow; dropPack?: string; images?: StoredImage[] } = {},
    ): Promise<boolean> => {
      const { pack, dropPack, images = [] } = extra
      for (const id of remove) rows.delete(id)
      for (const r of put) rows.set(r.id, r)
      if (pack) packs.set(pack.id, pack)
      if (dropPack) packs.delete(dropPack)
      rebuild()
      writeSeq++
      const tables = images.length ? [d.customCharacters, d.packs, d.images] : [d.customCharacters, d.packs]
      const write = (async () =>
        d.transaction('rw', tables, async () => {
          if (remove.length) await d.customCharacters.bulkDelete(remove)
          if (put.length) await d.customCharacters.bulkPut(put)
          if (pack) await d.packs.put(pack)
          if (dropPack) await d.packs.delete(dropPack)
          if (images.length) await d.images.bulkPut(images)
        }))()
      pending.add(write)
      try {
        await write
        return true
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) })
        return false
      } finally {
        pending.delete(write)
      }
    }

    const load = () => {
      if (loading) return loading
      if (get().loaded) return Promise.resolve()
      loading = read().finally(() => {
        loading = null
      })
      return loading
    }

    const initial = build(packs, rows)
    return {
      loaded: false,
      error: null,
      sets: initial.sets,
      entries: initial.entries,

      load,

      reload: () => {
        loading = read().finally(() => {
          loading = null
        })
        return loading
      },

      saveCustomCharacter: async (input, setId = CUSTOM_SET_ID, previousId) => {
        await load()
        if (BUNDLED_SET_IDS.includes(setId)) {
          return [{ field: 'setId', message: 'Bundled sets are read-only. Duplicate the character to edit a copy.' }]
        }
        if (!isEditableSet(setId)) {
          return [{ field: 'setId', message: "That set isn't on this device anymore." }]
        }
        const character = normalizeCharacter(input)
        const data = get()
        const ctx = selectValidationContext(data, setId, previousId, character.id)
        const issues = validateCharacter(character, ctx)
        if (issues.length) return issues

        const oldId = previousId && previousId !== character.id && rows.has(previousId) ? previousId : null
        const prev = rows.get(oldId ?? character.id)
        const setWasEmpty = !Object.values(data.entries).some((e) => e.setId === setId)
        const put: CustomCharacterRow[] = [
          { id: character.id, setId, character, source: prev?.source ?? 'custom', updatedAt: now() },
        ]
        let pack = packs.get(setId)
        if (oldId) {
          // Keep partners in the same set pointing at the new id.
          for (const r of rows.values()) {
            if (r.setId !== setId || r.id === oldId || !r.character.partners?.some((p) => p.characterId === oldId)) continue
            const partners = r.character.partners.map((p) => (p.characterId === oldId ? { ...p, characterId: character.id } : p))
            put.push({ ...r, character: { ...r.character, partners }, updatedAt: now() })
          }
          if (pack) pack = { ...pack, manifest: renameIn(pack.manifest, oldId, character.id) }
        }
        if (pack && !pack.manifest.characters.includes(character.id)) {
          pack = { ...pack, manifest: { ...pack.manifest, characters: [...pack.manifest.characters, character.id] } }
        }
        const persisted = await commit(put, oldId ? [oldId] : [], { pack })
        if (setWasEmpty) await setActive(setId, true)
        return persisted ? [] : [{ field: STORAGE_FIELD, message: STORAGE_MESSAGE }]
      },

      deleteCustomCharacter: async (id) => {
        await load()
        const row = rows.get(id)
        if (!row || get().entries[id]?.source === 'bundled') return false
        const put: CustomCharacterRow[] = []
        for (const r of rows.values()) {
          if (r.id === id || r.setId !== row.setId || !r.character.partners?.some((p) => p.characterId === id)) continue
          const partners = r.character.partners.filter((p) => p.characterId !== id)
          put.push({ ...r, character: { ...r.character, partners }, updatedAt: now() })
        }
        const pack = packs.get(row.setId)
        // A storage failure is reported through `error` (the app warns once); the character is
        // gone for this session either way.
        await commit(put, [id], { pack: pack ? { ...pack, manifest: renameIn(pack.manifest, id, null) } : undefined })
        return true
      },

      duplicateCharacter: async (id) => {
        await load()
        const entry = get().entries[id]
        if (!entry) return null
        const setId = entry.source !== 'bundled' && isEditableSet(entry.setId) ? entry.setId : CUSTOM_SET_ID
        const base = id.replace(/-copy(?:-\d+)?$/, '').slice(0, ID_MAX - '-copy-99'.length).replace(/-+$/, '') || 'character'
        let newId = ''
        for (let n = 1; n < 1000; n++) {
          const candidate = n === 1 ? `${base}-copy` : `${base}-copy-${n}`
          if (get().entries[candidate]) continue
          // Don't hand a new character the progress of a deleted one that had this id.
          const stale = await d.relationships.get(candidate).catch(() => undefined)
          if (stale) continue
          newId = candidate
          break
        }
        if (!newId) return null
        const members = new Set(
          Object.values(get().entries)
            .filter((e) => e.setId === setId)
            .map((e) => e.character.id),
        )
        const source = entry.character
        const copy: Character = structuredClone(source)
        copy.id = newId
        copy.name = `${source.name} (copy)`
        const partners = (source.partners ?? []).filter((p) => members.has(p.characterId))
        if (partners.length) copy.partners = partners
        else delete copy.partners
        const issues = await get().saveCustomCharacter(copy, setId, null)
        // Saved in memory even when storage refused it (the app warns about storage).
        return issues.every((i) => i.field === STORAGE_FIELD) ? newId : null
      },

      importPack: async (result, opts = {}) => {
        await load()
        const errors: ImportError[] = []
        const data = get()
        const at = now()
        if (result.characters.length === 0) {
          return { ok: false, setId: null, saved: [], errors: [...result.errors] }
        }
        const storageError = (): ImportError => ({ file: result.name, message: STORAGE_MESSAGE })

        // Loose characters join "My characters", one by one.
        if (!result.manifest) {
          const customIds = Object.values(data.entries)
            .filter((e) => e.setId === CUSTOM_SET_ID)
            .map((e) => e.character.id)
          // Check again until stable. A partner who isn't coming along (not in My characters, or
          // a card that failed) is left off the card, with a note.
          let pool = result.characters.map((c) => normalizeCharacter(c))
          const failed = new Map<Character, ValidationIssue[]>()
          const notes = new Map<string, ImportError>()
          for (;;) {
            const incoming = pool.map((c) => c.id)
            const allowed = new Set([...customIds, ...incoming])
            const before = pool.length
            pool = pool.map((c) => {
              const { character, dropped } = dropOutsidePartners(c, allowed)
              for (const pid of dropped) notes.set(`${c.id}|${pid}`, droppedPartnerNote(result.name, c.id, pid))
              return character
            })
            pool = pool.filter((character) => {
              const issues = validateCharacter(character, {
                setCharacterIds: [...allowed],
                existingIds: Object.keys(data.entries),
                reservedIds: RESERVED_CHARACTER_IDS,
              })
              if (issues.length) failed.set(character, issues)
              return issues.length === 0
            })
            if (pool.length === before) break
          }
          for (const [character, issues] of failed) {
            errors.push(...issues.map((i) => ({ file: result.name, characterId: character.id, field: i.field, message: i.message })))
          }
          const savedIds = new Set(pool.map((c) => c.id))
          errors.push(...[...notes.values()].filter((n) => n.characterId && savedIds.has(n.characterId)))
          const put: CustomCharacterRow[] = pool.map((character) => ({
            id: character.id,
            setId: CUSTOM_SET_ID,
            character,
            source: 'imported' as const,
            updatedAt: at,
          }))
          let persisted = true
          if (put.length) {
            persisted = await commit(put)
            await setActive(CUSTOM_SET_ID, true)
          }
          if (!persisted) errors.push(storageError())
          return {
            ok: errors.length === 0,
            setId: put.length ? CUSTOM_SET_ID : null,
            saved: put.map((r) => r.id),
            errors,
          }
        }

        // A pack is saved whole or not at all. Re-importing a pack replaces it.
        const manifest = normalizeManifest(result.manifest)
        const setId = manifest.id
        const fail = (message: string, field?: string): ImportOutcome => ({
          ok: false,
          setId: null,
          saved: [],
          errors: [...errors, { file: result.name, field, message }],
        })
        if (setId === CUSTOM_SET_ID || BUNDLED_SET_IDS.includes(setId) || RESERVED_SET_IDS.includes(setId)) {
          return fail(`The set id "${setId}" belongs to ${setId === CUSTOM_SET_ID ? 'My characters' : 'a set that ships with crushLAB'}. Change the id in manifest.json.`, 'id')
        }
        if (!ID_PATTERN.test(setId)) return fail(`"${setId}" isn't a valid set id.`, 'id')
        // Taken: everyone outside the pack, and characters the player made inside it.
        const outside = Object.values(data.entries)
          .filter((e) => e.setId !== setId || e.source === 'custom')
          .map((e) => e.character.id)
        const ids = result.characters.map((c) => c.id)
        const characters = result.characters.map((c) => normalizeCharacter(c))
        for (const c of characters) {
          const issues = validateCharacter(c, { setCharacterIds: ids, existingIds: outside, reservedIds: RESERVED_CHARACTER_IDS })
          errors.push(...issues.map((i) => ({ file: result.name, characterId: c.id, field: i.field, message: i.message })))
        }
        const manifestIssues = validateManifest(
          { ...manifest, characters: manifest.characters.filter((id) => ids.includes(id)) },
          {
            characterIds: ids,
            existingSetIds: [...BUNDLED_SET_IDS, ...RESERVED_SET_IDS, CUSTOM_SET_ID],
            setOfCharacter: (cid) => {
              const e = data.entries[cid]
              return e && e.setId !== setId ? e.setId : undefined
            },
          },
        )
        errors.push(...manifestIssues.map((i) => ({ file: result.name, field: i.field, message: i.message })))
        if (errors.length) return { ok: false, setId: null, saved: [], errors }

        // Replacing a pack already here: its characters the file leaves out go, unless their card
        // in the file failed its checks (the earlier card stays). The player's own stay put.
        const old = packs.get(setId)
        const failedIds = new Set(result.errors.map((e) => e.characterId).filter((id): id is string => !!id))
        const inSet = [...rows.values()].filter((r) => r.setId === setId)
        const own = inSet.filter((r) => r.source === 'custom')
        const leftOut = inSet.filter((r) => r.source !== 'custom' && !ids.includes(r.id))
        const removes = leftOut.filter((r) => !failedIds.has(r.id))
        const kept = leftOut.filter((r) => failedIds.has(r.id))
        if (old && !opts.replace) {
          const oldName = old.manifest.name ?? ''
          const oldAuthor = old.manifest.author ?? ''
          if (removes.length || oldName !== (manifest.name ?? '') || oldAuthor !== (manifest.author ?? '')) {
            return {
              ok: false,
              setId: null,
              saved: [],
              errors: [],
              confirm: {
                setId,
                oldName,
                oldAuthor,
                newName: manifest.name ?? '',
                newAuthor: manifest.author ?? '',
                removes: removes.map((r) => ({ id: r.id, name: r.character.name.trim() || r.id })),
              },
            }
          }
        }

        const stay = [...kept, ...own]
        const members = new Set([...ids, ...stay.map((r) => r.id)])
        // Characters who stay lose partners who left with the old version.
        const stayPut = stay.flatMap((r) => {
          const { character, dropped } = dropOutsidePartners(r.character, members)
          return dropped.length ? [{ ...r, character, updatedAt: at }] : []
        })
        const listed = [
          ...manifest.characters.filter((id) => ids.includes(id)),
          ...ids.filter((id) => !manifest.characters.includes(id)),
          ...stay.map((r) => r.id),
        ]
        const images: StoredImage[] = result.art
          .filter((a) => ids.includes(a.characterId))
          .map((a) => ({
            key: `${a.characterId}:tier-${a.tier}`,
            characterId: a.characterId,
            source: 'imported' as const,
            blob: a.blob,
            createdAt: at,
          }))
        const persisted = await commit(
          [
            ...characters.map((character) => ({ id: character.id, setId, character, source: 'imported' as const, updatedAt: at })),
            ...stayPut,
          ],
          removes.map((r) => r.id),
          { pack: { id: setId, manifest: { ...manifest, characters: listed }, importedAt: old?.importedAt ?? at }, images },
        )
        await setActive(setId, true)
        const outcome: ImportOutcome = { ok: persisted, setId, saved: ids, errors: persisted ? [] : [storageError()] }
        if (removes.length) outcome.removed = removes.map((r) => r.id)
        if (kept.length) outcome.kept = kept.map((r) => r.id)
        return outcome
      },

      removePack: async (id) => {
        await load()
        if (!packs.has(id)) return []
        const inSet = [...rows.values()].filter((r) => r.setId === id)
        // Characters the player made in the pack move to My characters, without partners who
        // leave with the pack.
        const own = inSet.filter((r) => r.source === 'custom')
        const customMembers = new Set([
          ...[...rows.values()].filter((r) => r.setId === CUSTOM_SET_ID).map((r) => r.id),
          ...own.map((r) => r.id),
        ])
        const moved = own.map((r) => ({
          ...r,
          setId: CUSTOM_SET_ID,
          character: dropOutsidePartners(r.character, customMembers).character,
          updatedAt: now(),
        }))
        const remove = inSet.filter((r) => r.source !== 'custom').map((r) => r.id)
        await commit(moved, remove, { dropPack: id })
        await setActive(id, false)
        if (moved.length) await setActive(CUSTOM_SET_ID, true)
        return moved.map((r) => r.id)
      },

      setActive,

      activeEntries: (settings) => selectActiveEntries(get(), settings),
      relationsFor: (id, activeSets) => selectRelationsFor(get(), id, activeSets),
      setOf: (id) => selectSetOf(get(), id),
      validationContext: (setId, previousId, characterId) =>
        selectValidationContext(get(), setId, previousId, characterId),
    }
  })
}

export const useRoster = createRosterStore()

// ---------------------------------------------------------------------------
// Hooks

/** Active characters for the hub, memoized on the roster and the two settings it reads. */
export function useActiveEntries(settings: Pick<Settings, 'activeSets' | 'showMe'>): RosterEntry[] {
  const sets = useRoster((s) => s.sets)
  const entries = useRoster((s) => s.entries)
  const { activeSets, showMe } = settings
  return useMemo(() => selectActiveEntries({ sets, entries }, { activeSets, showMe }), [sets, entries, activeSets, showMe])
}

/** A character's relations, memoized. */
export function useRelationsFor(id: string, activeSets?: readonly string[]): RosterRelation[] {
  const sets = useRoster((s) => s.sets)
  const entries = useRoster((s) => s.entries)
  return useMemo(() => selectRelationsFor({ sets, entries }, id, activeSets), [sets, entries, id, activeSets])
}
