// The fourteen gifts (docs/SPEC.md, "Gifts (14)"). Ids are fixed: character cards and saves refer
// to them. Lingerie needs Crush (60 affection) and heat 3 or more; locked gifts show why.

import { stageFor, stageLabel } from '../engine/stages'
import type { Gift, HeatLevel } from '../types'

/** Gift ids in SPEC order. */
export const GIFT_IDS = [
  'flowers',
  'chocolates',
  'rare-vinyl',
  'hot-sauce',
  'video-game',
  'perfume',
  'poetry-book',
  'plushie',
  'red-wine',
  'concert-tickets',
  'sketchbook',
  'silver-necklace',
  'houseplant',
  'lingerie',
] as const

export type GiftId = (typeof GIFT_IDS)[number]

export const GIFTS: readonly Gift[] = [
  { id: 'flowers', name: 'Flowers', description: 'A hand-tied bunch from the corner stall, still wet from the bucket.' },
  { id: 'chocolates', name: 'Chocolates', description: 'A box of dark truffles, the kind with a map inside the lid.' },
  { id: 'rare-vinyl', name: 'Rare vinyl', description: 'A first pressing dug out of the back of a crate, sleeve barely scuffed.' },
  { id: 'hot-sauce', name: 'Hot sauce', description: 'A small-batch bottle with a skull on the label and a warning on the back.' },
  { id: 'video-game', name: 'Video game', description: 'A co-op game for two, with a second controller in the bag.' },
  { id: 'perfume', name: 'Perfume', description: 'A small bottle of something smoky and warm.' },
  { id: 'poetry-book', name: 'Poetry book', description: 'A slim collection with the good pages already marked.' },
  { id: 'plushie', name: 'Plushie', description: 'A soft, faintly smug stuffed animal won at the claw machine.' },
  { id: 'red-wine', name: 'Red wine', description: 'A bottle of red the person at the shop swore by.' },
  { id: 'concert-tickets', name: 'Concert tickets', description: 'Two tickets to a show next month, one for each of you.' },
  { id: 'sketchbook', name: 'Sketchbook', description: 'Heavy paper, a linen cover and a pencil tucked into the spine.' },
  { id: 'silver-necklace', name: 'Silver necklace', description: 'A fine silver chain with a small pendant that catches the light.' },
  { id: 'houseplant', name: 'Houseplant', description: 'A trailing pothos in a hand-thrown pot, very hard to kill.' },
  {
    id: 'lingerie',
    name: 'Lingerie',
    description: 'Something lacy, for when you both know where the night is going.',
    requiresAffection: 60,
    requiresHeat: 3,
  },
]

const BY_ID: ReadonlyMap<string, Gift> = new Map(GIFTS.map((g) => [g.id, g]))

export function giftById(id: string): Gift | undefined {
  return BY_ID.get(id)
}

/**
 * Why a gift can't be given yet, or null when it can: "Needs Crush and heat 3+", "Needs Crush"
 * or "Needs heat 3+". Affection is the relationship's; heat is the player's heat setting.
 */
export function giftLock(gift: Gift, affection: number, heat: HeatLevel | number): string | null {
  const needs: string[] = []
  if (gift.requiresAffection != null && !(affection >= gift.requiresAffection)) {
    needs.push(stageLabel(stageFor(gift.requiresAffection)))
  }
  if (gift.requiresHeat != null && !(heat >= gift.requiresHeat)) {
    needs.push(gift.requiresHeat >= 5 ? 'heat 5' : `heat ${gift.requiresHeat}+`)
  }
  return needs.length ? `Needs ${needs.join(' and ')}` : null
}

/** True when giftLock() would return null. */
export function isGiftUnlocked(gift: Gift, affection: number, heat: HeatLevel | number): boolean {
  return giftLock(gift, affection, heat) === null
}
