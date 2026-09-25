// Gallery tiers and secrets (docs/SPEC.md, "Art and gallery", "Affection & Trust"). Pure.
//
// Romantic route: a tier or secret unlocks when affection reaches its unlockAt. Friend route:
// affection stops at 59, so only tiers 1 and 2 can unlock, and secrets unlock on trust instead.
// Each unlocks exactly once: the lists on the relationship are the record, and unlocked things stay
// unlocked when affection or trust later drops.

import type { Character, Relationship, Route, TierNumber } from '../types'

/** Tiers a friend route can reach. */
export const FRIEND_ROUTE_TIERS: readonly TierNumber[] = [1, 2]

const TIERS: readonly TierNumber[] = [1, 2, 3, 4, 5]

function tierThreshold(character: Character, tier: TierNumber): number {
  const t = (character.gallery ?? []).find((g) => g.tier === tier)
  return typeof t?.unlockAt === 'number' ? t.unlockAt : tier * 20
}

/** Tiers newly reached (not already in rel.tiersUnlocked), lowest first. */
export function newTiers(
  character: Character,
  rel: Pick<Relationship, 'affection' | 'tiersUnlocked'>,
  route: Route,
): TierNumber[] {
  const have = new Set(rel.tiersUnlocked ?? [])
  return TIERS.filter(
    (tier) =>
      !have.has(tier) &&
      (route !== 'friend' || FRIEND_ROUTE_TIERS.includes(tier)) &&
      rel.affection >= tierThreshold(character, tier),
  )
}

/**
 * Secret indexes newly earned (not already in rel.secretsUnlocked), in card order. Romantic
 * route: affection >= unlockAt. Friend route: trust >= unlockAt.
 */
export function newSecrets(
  character: Character,
  rel: Pick<Relationship, 'affection' | 'trust' | 'secretsUnlocked'>,
  route: Route,
): number[] {
  const have = new Set(rel.secretsUnlocked ?? [])
  const meter = route === 'friend' ? rel.trust : rel.affection
  const out: number[] = []
  ;(character.secrets ?? []).forEach((secret, i) => {
    if (have.has(i) || typeof secret?.unlockAt !== 'number') return
    if (meter >= secret.unlockAt) out.push(i)
  })
  return out
}

/** Apply both: returns the relationship with the new tiers and secrets added, and what was new. */
export function applyUnlocks(
  character: Character,
  rel: Relationship,
  route: Route,
): { rel: Relationship; tiers: TierNumber[]; secrets: number[] } {
  const tiers = newTiers(character, rel, route)
  const secrets = newSecrets(character, rel, route)
  if (tiers.length === 0 && secrets.length === 0) return { rel, tiers, secrets }
  return {
    rel: {
      ...rel,
      tiersUnlocked: tiers.length ? [...(rel.tiersUnlocked ?? []), ...tiers] : rel.tiersUnlocked,
      secretsUnlocked: secrets.length ? [...(rel.secretsUnlocked ?? []), ...secrets] : rel.secretsUnlocked,
    },
    tiers,
    secrets,
  }
}
