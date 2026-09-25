// Art slots (docs/SPEC.md, "Art and gallery"; ARCHITECTURE, Art). A slot names one picture in the
// gallery: a character's tier, a character's ending, or a group picture (the Polycule ending, and
// group dates in Phase 6). Its key is what the images table, the object-URL cache and the change
// events use:
//
//   `${characterId}:tier-${n}`
//   `${characterId}:ending-${type}`
//   `group:${sortedIds.join('+')}:${slot}`
//
// The player's imported image lives under the slot key itself, art that came with an imported
// pack under `${key}#pack`, and a generated image under `${key}#generated`, so each source keeps
// its own row and none replaces another.

import type { EndingType, TierNumber } from '../types'

export type ArtSlot =
  | { kind: 'tier'; characterId: string; tier: TierNumber }
  | { kind: 'ending'; characterId: string; ending: EndingType }
  | { kind: 'group'; characterIds: string[]; slot: string }

/** Where resolved art came from, first match wins (imported, bundled, generated, placeholder). */
export interface ResolvedArt {
  source: 'imported' | 'bundled' | 'generated' | 'placeholder'
  /**
   * The image: a blob: URL for imported and generated art (release it with releaseArt, or let
   * useArt do it), a relative URL under art/ for bundled art. None for the placeholder.
   */
  url?: string
  /** The prompt a generated image was painted from. */
  prompt?: string
  seed?: number
  /** The slot key asked for (see slotKey). */
  key: string
  /** Optional: the player marked this slot a favorite. */
  favorite?: boolean
  /** Optional: when an imported or generated image was stored (epoch ms). */
  createdAt?: number
  /**
   * Optional: the key the art was actually found under, when it differs from `key` (a character's
   * Polycule ending shows the group's picture).
   */
  resolvedKey?: string
  /**
   * Optional: imported art that came with a pack (the pack's set id), not the player's own image.
   * The viewer says so and offers no "Remove my image" for it.
   */
  pack?: string
}

/** Every ending type, in the order the gallery lists them. */
export const ENDING_TYPES: readonly EndingType[] = ['good', 'open', 'polycule', 'bitter', 'hollow', 'sacrifice', 'reconciliation']

const TIER_NUMBERS: readonly TierNumber[] = [1, 2, 3, 4, 5]

/** Suffix of a generated image's row in the images table. */
export const GENERATED_SUFFIX = '#generated'

/** Suffix of the row for art that came with an imported pack. */
export const PACK_SUFFIX = '#pack'

/** A row key without its '#generated' or '#pack' suffix: the slot key. */
export function baseKey(key: string): string {
  return String(key ?? '').replace(/#(?:generated|pack)$/, '')
}

/** Group ids, deduplicated and sorted, so the same people always make the same key. */
export function sortedIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))].sort()
}

/** The slot's key: `nova:tier-1`, `nova:ending-good`, `group:kai+nova:polycule`. */
export function slotKey(s: ArtSlot): string {
  switch (s.kind) {
    case 'tier':
      return `${s.characterId}:tier-${s.tier}`
    case 'ending':
      return `${s.characterId}:ending-${s.ending}`
    case 'group':
      return `group:${sortedIds(s.characterIds).join('+')}:${s.slot}`
  }
}

/** The images-table key of a slot's generated image. */
export function generatedKey(s: ArtSlot): string {
  return `${slotKey(s)}${GENERATED_SUFFIX}`
}

/** The images-table key of a slot's pack art. */
export function packKey(s: ArtSlot): string {
  return `${slotKey(s)}${PACK_SUFFIX}`
}

/** A slot from its key (or a generated or pack row's key); null when the key isn't one. */
export function parseSlotKey(key: string): ArtSlot | null {
  const k = baseKey(key)
  const group = /^group:([^:]+):(.+)$/.exec(k)
  if (group) {
    const ids = group[1].split('+').filter(Boolean)
    return ids.length ? { kind: 'group', characterIds: ids, slot: group[2] } : null
  }
  const tier = /^([^:]+):tier-([1-5])$/.exec(k)
  if (tier) return { kind: 'tier', characterId: tier[1], tier: Number(tier[2]) as TierNumber }
  const ending = /^([^:]+):ending-([a-z]+)$/.exec(k)
  if (ending && (ENDING_TYPES as readonly string[]).includes(ending[2])) {
    return { kind: 'ending', characterId: ending[1], ending: ending[2] as EndingType }
  }
  return null
}

/** Everyone the slot shows, in the slot's own order (a group's ids sorted). */
export function slotCharacterIds(s: ArtSlot): string[] {
  return s.kind === 'group' ? sortedIds(s.characterIds) : [s.characterId]
}

/** The images table's characterId for a slot: the character, or 'group' for group art. */
export function storedCharacterId(s: ArtSlot): string {
  return s.kind === 'group' ? 'group' : s.characterId
}

/** True for a whole-number tier 1 to 5. */
export function isTierNumber(n: unknown): n is TierNumber {
  return (TIER_NUMBERS as readonly unknown[]).includes(n)
}

/** The group slot of a Polycule ending for these members (two or more), else null. */
export function polyculeSlot(members: readonly string[]): ArtSlot | null {
  const ids = sortedIds(members)
  return ids.length >= 2 ? { kind: 'group', characterIds: ids, slot: 'polycule' } : null
}
