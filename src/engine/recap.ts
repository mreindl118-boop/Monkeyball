// The date recap (docs/SPEC.md, Screens, "Recap"). Pure: compares the relationship before and
// after the date and reads the record for the venue, gift and outcome.

import type { Agreement, Character, DateRecap, DateRecord, Relationship, Route } from '../types'
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
  extra: { memory?: string } = {},
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
    rumors: [],
    tiers: (relAfter.tiersUnlocked ?? []).filter((t) => !tiersBefore.has(t)),
    betrayals: (relAfter.betrayals ?? []).slice((relBefore.betrayals ?? []).length),
    gossip: [],
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
  return out
}

/** The recap for a single date, keyed by the character's id. */
export function buildRecap(
  relBefore: Relationship,
  relAfter: Relationship,
  record: DateRecord,
  character: Character,
  route: Route,
  extra: { memory?: string } = {},
): DateRecap {
  return { perCharacter: { [character.id]: characterRecap(relBefore, relAfter, record, character, route, extra) } }
}
