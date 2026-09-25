// The date recap (docs/SPEC.md, Screens, "Recap"). Pure: compares the relationship before and
// after the date and reads the record for the venue, gift and outcome.

import type { Agreement, Character, DateRecap, DateRecord, Relationship, Route } from '../types'

/** What the date flow adds to a recap beyond the meters (Phase 4 fields are optional). */
export interface RecapExtra {
  /** The memory line this date added. */
  memory?: string
  /** Friend-route gossip the character shared. */
  gossip?: string[]
  /** Ids of the rumors the player heard on this date. */
  rumors?: string[]
  /** What the date set off elsewhere (news, other characters' betrayals). */
  world?: DateRecap['world']
}
import { topicsGained } from './discovery'
import { giftReaction, venueReaction } from './math'
import { stageFor } from './stages'

export type CharacterRecap = DateRecap['perCharacter'][string]

function sameAgreement(a: Agreement | undefined, b: Agreement | undefined): boolean {
  return (a?.type ?? 'none') === (b?.type ?? 'none') && (a?.terms ?? '') === (b?.terms ?? '') && (a?.madeAt ?? 0) === (b?.madeAt ?? 0)
}

/** One character's recap: meters and stages before and after, and what this date earned. */
export function characterRecap(
  relBefore: Relationship,
  relAfter: Relationship,
  record: DateRecord,
  character: Character,
  route: Route,
  extra: RecapExtra = {},
): CharacterRecap {
  const discoveredBefore = new Set((relBefore.discovered ?? []).map((d) => `${d.type}:${d.id}`))
  const secretsBefore = new Set(relBefore.secretsUnlocked ?? [])
  const tiersBefore = new Set(relBefore.tiersUnlocked ?? [])
  const out: CharacterRecap = {
    affectionBefore: relBefore.affection,
    affectionAfter: relAfter.affection,
    trustBefore: relBefore.trust,
    trustAfter: relAfter.trust,
    stageBefore: stageFor(relBefore.affection),
    stageAfter: stageFor(relAfter.affection),
    traits: (relAfter.discovered ?? []).filter((d) => !discoveredBefore.has(`${d.type}:${d.id}`)),
    secrets: (relAfter.secretsUnlocked ?? []).filter((i) => !secretsBefore.has(i)),
    rumors: [...(extra.rumors ?? [])],
    tiers: (relAfter.tiersUnlocked ?? []).filter((t) => !tiersBefore.has(t)),
    betrayals: (relAfter.betrayals ?? []).slice((relBefore.betrayals ?? []).length),
    gossip: [...(extra.gossip ?? [])],
    left: record.outcome === 'left',
    route,
    revealed: topicsGained(relBefore, relAfter),
  }
  if (!sameAgreement(relBefore.agreement, relAfter.agreement)) {
    out.agreementBefore = relBefore.agreement
    out.agreementAfter = relAfter.agreement
  }
  if (record.venueId) {
    out.venueReaction = relAfter.venues?.[record.venueId] ?? venueReaction(character, record.venueId)
    out.venueNew = !relBefore.venues?.[record.venueId]
  }
  if (record.giftId) {
    out.giftReaction = relAfter.gifts?.[record.giftId] ?? giftReaction(character, record.giftId)
    out.giftNew = !relBefore.gifts?.[record.giftId]
  }
  if (extra.memory) out.memory = extra.memory
  if (record.dtr) out.dtr = record.dtr
  return out
}

/** The recap for a single date, keyed by the character's id. */
export function buildRecap(
  relBefore: Relationship,
  relAfter: Relationship,
  record: DateRecord,
  character: Character,
  route: Route,
  extra: RecapExtra = {},
): DateRecap {
  const recap: DateRecap = { perCharacter: { [character.id]: characterRecap(relBefore, relAfter, record, character, route, extra) } }
  if (extra.world && (extra.world.news.length > 0 || extra.world.betrayals.length > 0)) recap.world = extra.world
  return recap
}
