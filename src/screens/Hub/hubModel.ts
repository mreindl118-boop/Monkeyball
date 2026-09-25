// Pure helpers behind the hub: which characters show, in which groups, in which order, and what
// each coaster says. No React, no stores.

import { routeFor } from '../../engine/stages'
import { newRelationship } from '../../engine/relationship'
import { selectActiveEntries, type RosterData } from '../../store/roster'
import type {
  Character,
  OrientationMode,
  PlayerProfile,
  Relationship,
  RosterEntry,
  Route,
  SetManifest,
  Settings,
  TierNumber,
  TraitType,
} from '../../types'

export type HubSort = Settings['hubSort']

export const TRAIT_LISTS: readonly { type: TraitType; key: 'likes' | 'dislikes' | 'turnOns' | 'turnOffs' }[] = [
  { type: 'like', key: 'likes' },
  { type: 'dislike', key: 'dislikes' },
  { type: 'turnOn', key: 'turnOns' },
  { type: 'turnOff', key: 'turnOffs' },
]

/** Every trait on the card, across the four lists. */
export function totalTraits(c: Pick<Character, 'likes' | 'dislikes' | 'turnOns' | 'turnOffs'>): number {
  return TRAIT_LISTS.reduce((n, l) => n + (c[l.key]?.length ?? 0), 0)
}

/**
 * Traits the player has discovered that still exist on the card (an edited card may have lost
 * some), each counted once.
 */
export function discoveredCount(
  c: Pick<Character, 'likes' | 'dislikes' | 'turnOns' | 'turnOffs'>,
  rel: Pick<Relationship, 'discovered'>,
): number {
  const seen = new Set<string>()
  for (const d of rel.discovered ?? []) {
    const list = TRAIT_LISTS.find((l) => l.type === d.type)
    if (list && (c[list.key] ?? []).some((t) => t.id === d.id)) seen.add(`${d.type}:${d.id}`)
  }
  return seen.size
}

/** The highest gallery tier unlocked, or undefined when none is. */
export function highestTier(rel: Pick<Relationship, 'tiersUnlocked'>): TierNumber | undefined {
  const tiers = (rel.tiersUnlocked ?? []).filter((t) => t >= 1 && t <= 5)
  return tiers.length ? (Math.max(...tiers) as TierNumber) : undefined
}

export interface HubCard {
  entry: RosterEntry
  rel: Relationship
  route: Route
  discovered: number
  total: number
  tier?: TierNumber
}

export interface HubGroup {
  set: SetManifest
  cards: HubCard[]
}

function byName(a: HubCard, b: HubCard): number {
  return a.entry.character.name.localeCompare(b.entry.character.name, undefined, { sensitivity: 'base' }) ||
    a.entry.character.id.localeCompare(b.entry.character.id)
}

/** Affection or trust high to low (ties by name), or name A to Z. Returns a new array. */
export function sortCards(cards: readonly HubCard[], sort: HubSort): HubCard[] {
  const out = [...cards]
  if (sort === 'name') return out.sort(byName)
  const key = sort === 'trust' ? 'trust' : 'affection'
  return out.sort((a, b) => (b.rel[key] ?? 0) - (a.rel[key] ?? 0) || byName(a, b))
}

/**
 * The set filter that applies: the saved one while that set is still active and has
 * characters, otherwise 'all'.
 */
export function effectiveSetFilter(filter: string, available: readonly string[]): string {
  return filter !== 'all' && available.includes(filter) ? filter : 'all'
}

export interface HubInput {
  settings: Pick<Settings, 'activeSets' | 'showMe' | 'hubSetFilter' | 'hubSort' | 'orientationMode'>
  relationships: Readonly<Record<string, Relationship>>
  profile: PlayerProfile | null
}

export interface HubView {
  /** Active sets with anyone in them, before the Show me and set filters. */
  activeSets: SetManifest[]
  /** Active characters before the Show me filter. */
  activeCount: number
  /** The set filter in effect ('all' or an active set id). */
  setFilter: string
  groups: HubGroup[]
  /** Characters shown across all groups. */
  shown: number
}

export function hubCard(entry: RosterEntry, rel: Relationship | undefined, profile: PlayerProfile | null, mode: OrientationMode): HubCard {
  const r = rel ?? newRelationship(entry.character.id)
  return {
    entry,
    rel: r,
    route: routeFor(entry.character, profile, mode),
    discovered: discoveredCount(entry.character, r),
    total: totalTraits(entry.character),
    tier: highestTier(r),
  }
}

/** Everything the hub shows: coasters grouped by active set, filtered and sorted. */
export function hubView(data: RosterData, input: HubInput): HubView {
  const { settings, relationships, profile } = input
  const everyone = selectActiveEntries(data, { activeSets: settings.activeSets, showMe: 'everyone' })
  const shownEntries = settings.showMe === 'everyone' ? everyone : selectActiveEntries(data, settings)
  const activeSets = data.sets.filter((s) => everyone.some((e) => e.setId === s.id))
  const setFilter = effectiveSetFilter(settings.hubSetFilter, activeSets.map((s) => s.id))
  const groups: HubGroup[] = []
  for (const set of activeSets) {
    if (setFilter !== 'all' && set.id !== setFilter) continue
    const cards = shownEntries
      .filter((e) => e.setId === set.id)
      .map((e) => hubCard(e, relationships[e.character.id], profile, settings.orientationMode))
    if (cards.length) groups.push({ set, cards: sortCards(cards, settings.hubSort) })
  }
  return {
    activeSets,
    activeCount: everyone.length,
    setFilter,
    groups,
    shown: groups.reduce((n, g) => n + g.cards.length, 0),
  }
}

/** "12 regulars", "1 regular". */
export function regularsText(n: number): string {
  return `${n} ${n === 1 ? 'regular' : 'regulars'}`
}

/** Morning, afternoon or evening by the local hour; "Still up" after midnight. */
export function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Morning'
  if (hour < 18) return 'Afternoon'
  return 'Evening'
}
