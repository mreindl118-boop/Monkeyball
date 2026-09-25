// A character's gallery (docs/SPEC.md, "Art and gallery", Screens 7): five tiers and the endings,
// each unlocked or locked with what unlocks it. Pure.
//
// Tiers unlock at their unlockAt (the engine records them once, in rel.tiersUnlocked). On a friend
// route tiers 3 to 5 show as "Friendship-locked" (and so do the endings, which need 100). An ending
// is unlocked once it has played (rel.ending, or GameState.endingsSeen when given). A played
// Polycule ending with a known group is the group's picture.

import { ENDINGS } from '../engine/endings'
import { FRIEND_ROUTE_TIERS } from '../engine/unlocks'
import type { Character, EndingType, Relationship, Route, TierNumber } from '../types'
import { ENDING_TYPES, polyculeSlot, type ArtSlot } from './types'

export const FRIENDSHIP_LOCKED = 'Friendship-locked'

export interface GallerySlot {
  slot: ArtSlot
  unlocked: boolean
  /** Why it's locked: "Unlocks at 60", "Friendship-locked" or "Ending: The good ending". */
  lock?: string
  /** The tier's title from the card, or the ending's title ("The good ending"). */
  title: string
  /** The tier's scene line, or the card's own ending scene when it has one. */
  scene?: string
  /** For tiers: the affection that unlocks it. */
  unlockAt?: number
}

export interface UnlockedSlotsOptions {
  /** Endings already seen with this character (GameState.endingsSeen[id]); rel.ending counts too. */
  endingsSeen?: readonly EndingType[]
  /** Everyone in this character's polycule, when its ending played (the group's picture). */
  polycule?: readonly string[]
  /** Leave the endings out (tiers only). */
  tiersOnly?: boolean
}

const TIERS: readonly TierNumber[] = [1, 2, 3, 4, 5]

/** Every gallery slot of a character: tiers 1 to 5, then the seven endings. */
export function unlockedSlots(
  character: Character,
  rel: Pick<Relationship, 'tiersUnlocked'> & Partial<Pick<Relationship, 'ending'>>,
  route: Route,
  opts: UnlockedSlotsOptions = {},
): GallerySlot[] {
  const have = new Set(rel.tiersUnlocked ?? [])
  const out: GallerySlot[] = []
  for (const tier of TIERS) {
    const entry = (character.gallery ?? []).find((g) => g?.tier === tier)
    const unlockAt = typeof entry?.unlockAt === 'number' ? entry.unlockAt : tier * 20
    const unlocked = have.has(tier)
    const g: GallerySlot = {
      slot: { kind: 'tier', characterId: character.id, tier },
      unlocked,
      title: entry?.title?.trim() || `Tier ${tier}`,
      unlockAt,
    }
    const scene = entry?.scene?.trim()
    if (scene) g.scene = scene
    if (!unlocked) g.lock = route === 'friend' && !FRIEND_ROUTE_TIERS.includes(tier) ? FRIENDSHIP_LOCKED : `Unlocks at ${unlockAt}`
    out.push(g)
  }
  if (opts.tiersOnly) return out
  const seen = new Set<EndingType>(opts.endingsSeen ?? [])
  if (rel.ending?.type) seen.add(rel.ending.type)
  for (const type of ENDING_TYPES) {
    const info = ENDINGS[type]
    const unlocked = seen.has(type)
    const own = character.endings?.[type]
    const group = type === 'polycule' && unlocked && opts.polycule ? polyculeSlot([character.id, ...opts.polycule]) : null
    const g: GallerySlot = {
      slot: group ?? { kind: 'ending', characterId: character.id, ending: type },
      unlocked,
      title: own?.title?.trim() || info.title,
    }
    if (own?.scene?.trim()) g.scene = own.scene.trim()
    if (!unlocked) g.lock = route === 'friend' ? FRIENDSHIP_LOCKED : `Ending: ${sentenceStart(info.title)}`
    out.push(g)
  }
  return out
}

/** "the good ending" -> "The good ending". */
function sentenceStart(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
