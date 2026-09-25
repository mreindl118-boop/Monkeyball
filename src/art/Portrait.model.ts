import type { Character, TierNumber } from '../types'

/** A readable accent: the card's hex, or lipstick when it's missing or malformed. */
export function portraitAccent(accent: string | undefined): string {
  return accent && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent.trim()) ? accent.trim() : '#E0245E'
}

/** The gallery entry for a tier, if the card has one. */
export function tierOf(character: Pick<Character, 'gallery'>, tier: TierNumber | undefined) {
  if (tier == null) return undefined
  return (character.gallery ?? []).find((t) => t.tier === tier)
}
