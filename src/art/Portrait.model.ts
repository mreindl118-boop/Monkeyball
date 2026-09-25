import type { Character, Relationship, TierNumber } from '../types'

/** A readable accent: the card's hex, or lipstick when it's missing or malformed. */
export function portraitAccent(accent: string | undefined): string {
  return accent && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent.trim()) ? accent.trim() : '#E0245E'
}

/** The gallery entry for a tier, if the card has one. */
export function tierOf(character: Pick<Character, 'gallery'>, tier: TierNumber | undefined) {
  if (tier == null) return undefined
  return (character.gallery ?? []).find((t) => t.tier === tier)
}

/** The highest tier unlocked with a character, or undefined before any (or with no relationship). */
export function highestUnlocked(rel: Pick<Relationship, 'tiersUnlocked'> | undefined): TierNumber | undefined {
  const tiers = (rel?.tiersUnlocked ?? []).filter((t) => t >= 1 && t <= 5)
  return tiers.length ? (Math.max(...tiers) as TierNumber) : undefined
}

/**
 * What a portrait is called: "{name}, {tier title}" for art, with "Placeholder art." after it
 * while the placeholder shows.
 */
export function portraitAlt(name: string, title: string, placeholder: boolean): string {
  const base = title ? `${name}, ${title}` : name
  return placeholder ? `${base}. Placeholder art.` : base
}
