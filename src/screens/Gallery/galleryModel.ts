// Pure helpers for the gallery (#/gallery, #/gallery/:id), its viewer and the recap's unlock
// reveal: what a slot is called, its scene line, counts, group art keys, swipes, file names.
// No React, no stores.

import { ENDINGS } from '../../engine/endings'
import { parseSlotKey, slotKey, type ArtSlot } from '../../art/types'
import type { Character, EndingType, Relationship, Route, TierNumber } from '../../types'

type Card = Pick<Character, 'gallery'> & Partial<Pick<Character, 'endings'>>

/** The tier's title from the card, or "Tier n". */
export function tierTitle(character: Card, tier: TierNumber): string {
  return (character.gallery ?? []).find((t) => t.tier === tier)?.title?.trim() || `Tier ${tier}`
}

/** The tier's scene line from the card ('' when there's none). */
export function tierScene(character: Card, tier: TierNumber): string {
  return (character.gallery ?? []).find((t) => t.tier === tier)?.scene?.trim() ?? ''
}

/** An ending's art title: the card's own for that ending, else the ending's name ("The good ending"). */
export function endingArtTitle(character: Card, ending: EndingType): string {
  return character.endings?.[ending]?.title?.trim() || ENDINGS[ending]?.title || 'Your ending'
}

/** An ending's scene line: the card's own, else the tier 5 scene the default art is built from. */
export function endingArtScene(character: Card, ending: EndingType): string {
  return character.endings?.[ending]?.scene?.trim() || tierScene(character, 5)
}

/** "Nova", or the first word of a longer name. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/** "Nova and Kai", "Nova, Kai and Sol". */
export function joinNames(names: readonly string[]): string {
  const list = names.filter(Boolean)
  if (list.length <= 1) return list[0] ?? ''
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** A group slot's words ("polycule", "group-date") as a title: "The polycule", "Group date". */
export function groupSlotTitle(slot: string): string {
  const s = slot.trim().toLowerCase()
  if (s === 'polycule' || s === 'ending-polycule') return 'The polycule'
  const words = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!words) return 'Together'
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** What a slot is called in the gallery, the viewer and the reveal. */
export function slotTitle(character: Card, slot: ArtSlot): string {
  if (slot.kind === 'tier') return tierTitle(character, slot.tier)
  if (slot.kind === 'ending') return endingArtTitle(character, slot.ending)
  return groupSlotTitle(slot.slot)
}

/** The scene line under a slot's art ('' for group art, which has no card scene). */
export function slotScene(character: Card, slot: ArtSlot): string {
  if (slot.kind === 'tier') return tierScene(character, slot.tier)
  if (slot.kind === 'ending') return endingArtScene(character, slot.ending)
  return ''
}

/**
 * The small line over a slot's title: "Tier 3", "Ending", or who's in a group picture ("With Kai
 * and Sol", named from the character whose gallery it's in).
 */
export function slotKicker(slot: ArtSlot, names: Record<string, string> = {}, viewer?: string): string {
  if (slot.kind === 'tier') return `Tier ${slot.tier}`
  if (slot.kind === 'ending') return 'Ending'
  const others = slot.characterIds.filter((id) => id !== viewer).map((id) => firstName(names[id] ?? id))
  return others.length ? `With ${joinNames(others)}` : 'Group art'
}

/** Tiers unlocked with a character (1 to 5, each once). */
export function unlockedTierCount(rel: Pick<Relationship, 'tiersUnlocked'> | undefined): number {
  return new Set((rel?.tiersUnlocked ?? []).filter((t) => t >= 1 && t <= 5)).size
}

/** "3/5" and its spoken form, "3 of 5 unlocked". */
export function unlockedLabel(count: number): { short: string; spoken: string } {
  const n = Math.max(0, Math.min(5, Math.round(count)))
  return { short: `${n}/5`, spoken: `${n} of 5 unlocked` }
}

/**
 * Group art slots a character is in, from image keys (a generated row's `#generated` key counts
 * as its slot), each slot once, in key order.
 */
export function groupSlotsFor(characterId: string, keys: readonly string[]): ArtSlot[] {
  const seen = new Set<string>()
  const out: ArtSlot[] = []
  for (const key of [...keys].sort()) {
    const slot = parseSlotKey(key)
    if (!slot || slot.kind !== 'group' || !slot.characterIds.includes(characterId)) continue
    const k = slotKey(slot)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(slot)
  }
  return out
}

/** The next index in the viewer: no wrapping at either end. */
export function stepIndex(index: number, count: number, dir: -1 | 1): number {
  if (count <= 0) return 0
  return Math.max(0, Math.min(count - 1, index + dir))
}

/**
 * Whether a finished drag is a swipe: -1 (towards the previous picture, finger moved right), 1
 * (the next, finger moved left) or 0. A swipe travels at least 56px or 18% of the width, and
 * more sideways than up or down.
 */
export function swipeDirection(dx: number, dy: number, width: number): -1 | 0 | 1 {
  const need = Math.max(56, width * 0.18)
  if (Math.abs(dx) < need || Math.abs(dx) < Math.abs(dy) * 1.2) return 0
  return dx < 0 ? 1 : -1
}

/**
 * How far the picture follows the finger: all the way in the middle of the list, a third of the
 * way past either end (so the edge is felt).
 */
export function dragOffset(dx: number, index: number, count: number): number {
  const atStart = index <= 0 && dx > 0
  const atEnd = index >= count - 1 && dx < 0
  return atStart || atEnd ? dx / 3 : dx
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/** A file extension for an image type (png when unknown). */
export function imageExtension(mime: string): string {
  return EXT[mime.trim().toLowerCase()] ?? 'png'
}

/** "nova-castellanos-behind-the-decks.webp": lowercase words joined by hyphens, and the type's extension. */
export function imageFileName(name: string, title: string, mime: string): string {
  const slug = `${name} ${title}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
  return `${slug || 'crushlab-art'}.${imageExtension(mime)}`
}

/**
 * What to tell the player when their image couldn't be added: the engine's own message (it's
 * written for them: too big, not a picture), or a storage failure in plain words.
 */
export function importErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message.trim() : ''
  if (msg && !/quota|indexeddb|database|transaction|dexie/i.test(msg)) return msg
  return "Couldn't add that image. This device's storage may be full."
}

// ---------------------------------------------------------------------------
// The character list and favorites

/** True when a slot shows this character (their own tier or ending, or a group they're in). */
export function slotShows(slot: ArtSlot, characterId: string): boolean {
  return slot.kind === 'group' ? slot.characterIds.includes(characterId) : slot.characterId === characterId
}

/**
 * The character whose gallery a slot belongs to: the character, or the group member who comes
 * first in the list (`rank`); null when none of them is listed.
 */
export function slotOwner(slot: ArtSlot, rank: (id: string) => number | undefined): string | null {
  if (slot.kind !== 'group') return rank(slot.characterId) === undefined ? null : slot.characterId
  let best: string | null = null
  let bestRank = Infinity
  for (const id of slot.characterIds) {
    const r = rank(id)
    if (r !== undefined && r < bestRank) {
      best = id
      bestRank = r
    }
  }
  return best
}

export interface GalleryRow {
  id: string
  name: string
  /** Tiers unlocked, 0 to 5. */
  unlocked: number
  /** Favorite pictures that show them. */
  favorites: number
}

export interface GalleryGroup {
  setId: string
  name: string
  rows: GalleryRow[]
}

export interface GallerySet {
  id: string
  name: string
  characters: readonly string[]
}

export interface GalleryEntry {
  setId: string
  character: Pick<Character, 'id' | 'name'>
}

/**
 * The gallery's character list: the active sets in their order, each with its characters in
 * manifest order, how many tiers are unlocked and how many favorites show them.
 */
export function galleryGroups(
  sets: readonly GallerySet[],
  entries: Readonly<Record<string, GalleryEntry>>,
  activeSets: readonly string[],
  relationships: Readonly<Record<string, Pick<Relationship, 'tiersUnlocked'> | undefined>>,
  favorites: ReadonlySet<string>,
): GalleryGroup[] {
  const favSlots = [...favorites].map((k) => parseSlotKey(k)).filter((s): s is ArtSlot => !!s)
  const out: GalleryGroup[] = []
  for (const set of sets) {
    if (!activeSets.includes(set.id)) continue
    const rows: GalleryRow[] = []
    for (const id of set.characters) {
      const entry = entries[id]
      if (!entry || entry.setId !== set.id) continue
      rows.push({
        id,
        name: entry.character.name.trim() || id,
        unlocked: unlockedTierCount(relationships[id]),
        favorites: favSlots.filter((s) => slotShows(s, id)).length,
      })
    }
    if (rows.length) out.push({ setId: set.id, name: set.name.trim() || set.id, rows })
  }
  return out
}

/** Only the characters with at least one favorite. */
export function withFavorites(groups: readonly GalleryGroup[]): GalleryGroup[] {
  return groups.map((g) => ({ ...g, rows: g.rows.filter((r) => r.favorites > 0) })).filter((g) => g.rows.length > 0)
}

/**
 * Favorite pictures as viewer entries, grouped by whose gallery they're in (in the order given)
 * and in tier, ending, group order within each. Favorites of characters not in `order` are left out.
 */
export function favoriteSlots(favorites: ReadonlySet<string>, order: readonly string[]): { slot: ArtSlot; key: string; owner: string }[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  const kindRank = { tier: 0, ending: 1, group: 2 } as const
  const out: { slot: ArtSlot; key: string; owner: string; sort: string }[] = []
  for (const key of favorites) {
    const slot = parseSlotKey(key)
    if (!slot) continue
    const owner = slotOwner(slot, (id) => rank.get(id))
    if (owner == null) continue
    const k = slotKey(slot)
    out.push({ slot, key: k, owner, sort: `${String(rank.get(owner)).padStart(5, '0')}|${kindRank[slot.kind]}|${k}` })
  }
  const seen = new Set<string>()
  return out
    .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
    .filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)))
    .map(({ slot, key, owner }) => ({ slot, key, owner }))
}

// ---------------------------------------------------------------------------
// Endings in a character's gallery

/**
 * Endings that can still happen with a character, shown locked in their gallery ("Ending: The
 * good ending") until they play. None on a friend route (it never reaches 100). The Open ending
 * needs a character who dates openly (or an open or poly agreement already), the Polycule ending a
 * polyamorous or flexible one (or a poly agreement), and Reconciliation a betrayal first.
 */
export function reachableEndings(
  character: Pick<Character, 'relationshipStyle'>,
  rel: Pick<Relationship, 'agreement' | 'betrayals'> | undefined,
  route: Route,
): EndingType[] {
  if (route === 'friend') return []
  const style = character.relationshipStyle
  const agreement = rel?.agreement?.type ?? 'none'
  const out: EndingType[] = ['good']
  if (style !== 'monogamous' || agreement === 'open' || agreement === 'poly') out.push('open')
  if (style === 'polyamorous' || style === 'flexible' || agreement === 'poly') out.push('polycule')
  out.push('bitter', 'hollow', 'sacrifice')
  if ((rel?.betrayals ?? []).length > 0) out.push('reconciliation')
  return out
}

/** Which of a gallery's slots to show: every tier, endings seen or reachable, every group picture. */
export function visibleSlot(
  s: { slot: ArtSlot; unlocked: boolean },
  reachable: readonly EndingType[],
): boolean {
  if (s.slot.kind !== 'ending') return true
  return s.unlocked || reachable.includes(s.slot.ending)
}
