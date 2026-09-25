// The sets that ship with the app: every src/data/sets/{setId}/manifest.json and its
// characters/*.json, loaded at build time with import.meta.glob (vitest applies the same
// transform). Every card goes through normalizeCharacter, so plural genders in the JSON
// ("women") reach the game as the singular Gender values. Bundled characters are read-only and
// never written to Dexie.

import { normalizeCharacter, normalizeManifest } from '../mods/normalize'
import type { Character, RosterEntry, SetManifest } from '../types'

/** Bundled sets in the order the Character sets screen lists them; others follow by name. */
export const BUNDLED_SET_ORDER: readonly string[] = ['afterhours', 'polycule', 'backstage', 'slow-burn']

/**
 * Ids the Phase 6 sets will use (docs/ROSTER.md). Custom characters and packs can't take them
 * now, so nothing a player makes is shadowed when those sets ship.
 */
export const RESERVED_SET_IDS: readonly string[] = BUNDLED_SET_ORDER
export const RESERVED_CHARACTER_IDS: readonly string[] = [
  // The Polycule
  'wren', 'sol', 'mateo', 'felix', 'juno', 'ash',
  // Backstage
  'rox', 'bash', 'minh', 'tamsin', 'grant', 'eli',
  // Slow Burn
  'maren', 'hollis', 'ines', 'rowan', 'cyrus', 'bea',
]

const manifestFiles = import.meta.glob<unknown>('./sets/*/manifest.json', { eager: true, import: 'default' })
const characterFiles = import.meta.glob<unknown>('./sets/*/characters/*.json', { eager: true, import: 'default' })

/** "./sets/afterhours/characters/nova.json" -> ["afterhours", "nova"] */
function pathParts(path: string): { setDir: string; file: string } {
  const m = /\.\/sets\/([^/]+)\/(?:characters\/)?([^/]+)\.json$/.exec(path)
  return { setDir: m?.[1] ?? '', file: m?.[2] ?? '' }
}

function orderOf(id: string): number {
  const i = BUNDLED_SET_ORDER.indexOf(id)
  return i < 0 ? BUNDLED_SET_ORDER.length : i
}

interface Loaded {
  sets: SetManifest[]
  entries: RosterEntry[]
}

function load(): Loaded {
  const byDir = new Map<string, SetManifest>()
  for (const [path, raw] of Object.entries(manifestFiles)) {
    const manifest = normalizeManifest(raw)
    const { setDir } = pathParts(path)
    byDir.set(setDir, { ...manifest, id: manifest.id || setDir })
  }

  const cardsByDir = new Map<string, Character[]>()
  for (const [path, raw] of Object.entries(characterFiles)) {
    const { setDir, file } = pathParts(path)
    const card = normalizeCharacter(raw)
    if (!card.id) card.id = file
    const list = cardsByDir.get(setDir) ?? []
    list.push(card)
    cardsByDir.set(setDir, list)
  }

  const sets = [...byDir.entries()].sort(
    ([, a], [, b]) => orderOf(a.id) - orderOf(b.id) || a.name.localeCompare(b.name),
  )
  const entries: RosterEntry[] = []
  const seen = new Set<string>()
  const finalSets: SetManifest[] = []
  for (const [dir, set] of sets) {
    const cards = cardsByDir.get(dir) ?? []
    const byId = new Map(cards.map((c) => [c.id, c]))
    // Manifest order first, then any card the manifest forgot to list.
    const ordered = [
      ...set.characters.map((id) => byId.get(id)).filter((c): c is Character => !!c),
      ...cards.filter((c) => !set.characters.includes(c.id)).sort((a, b) => a.id.localeCompare(b.id)),
    ]
    const ids: string[] = []
    for (const character of ordered) {
      if (seen.has(character.id)) continue // an id can only belong to one bundled set
      seen.add(character.id)
      ids.push(character.id)
      entries.push({ character, setId: set.id, source: 'bundled' })
    }
    finalSets.push({ ...set, characters: ids })
  }
  return { sets: finalSets, entries }
}

const LOADED = load()

/** Bundled set manifests (characters lists only ids that have a card). */
export const BUNDLED_SETS: readonly SetManifest[] = LOADED.sets

/** Every bundled character, in set order and manifest order. */
export const BUNDLED_CHARACTERS: readonly RosterEntry[] = LOADED.entries

export const BUNDLED_SET_IDS: readonly string[] = BUNDLED_SETS.map((s) => s.id)
export const BUNDLED_CHARACTER_IDS: readonly string[] = BUNDLED_CHARACTERS.map((e) => e.character.id)

const ENTRY_BY_ID: ReadonlyMap<string, RosterEntry> = new Map(BUNDLED_CHARACTERS.map((e) => [e.character.id, e]))

export function bundledEntry(id: string): RosterEntry | undefined {
  return ENTRY_BY_ID.get(id)
}

export function bundledSet(id: string): SetManifest | undefined {
  return BUNDLED_SETS.find((s) => s.id === id)
}

/**
 * The raw, unnormalized manifests and cards as they sit in src/data/sets, keyed by path. For the
 * content tests only.
 */
export const RAW_BUNDLED_FILES: Readonly<{ manifests: Record<string, unknown>; characters: Record<string, unknown> }> = {
  manifests: manifestFiles,
  characters: characterFiles,
}
