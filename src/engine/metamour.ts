// Metamour approval (docs/SPEC.md, "Agreements": poly means partners are known to each other and
// metamour approval moves trust; "Endings": the Polycule ending needs everyone to approve of each
// other). Pure: no React, no Dexie.
//
// How two characters feel about sharing the player, 0-100. It starts from what they already are to
// each other (partner 70, friend or housemate 60, situationship 55, strangers 50, rivals 40, exes
// 35) and moves with play: +5 when the player tells one about the other under a poly agreement, -10
// when one hears about the other through gossip instead, and group dates (Phase 6). Moved values
// are stored in GameState.metamours under "a|b" (ids sorted).

import type { GameState, Relationship, SetRelationKind, SetRelationship } from '../types'
import { clamp100 } from './math'

/** Approval both need for the Polycule ending. */
export const POLYCULE_APPROVAL = 60

/** Approval moves. */
export const DISCLOSURE_APPROVAL = 5
export const GOSSIP_APPROVAL = -10

/** Where approval starts, by what two characters already are to each other. */
export const APPROVAL_BASELINE: Readonly<Record<SetRelationKind, number>> & { none: number } = {
  partner: 70,
  friend: 60,
  housemate: 60,
  roommate: 60,
  bandmate: 60,
  family: 60,
  situationship: 55,
  coworker: 55,
  neighbor: 50,
  none: 50,
  rival: 40,
  ex: 35,
}

/** The GameState.metamours key for a pair: ids sorted, joined with "|". */
export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}

/** What the two are to each other, per the set relationships (the lowest baseline when several). */
export function relationBetween(a: string, b: string, relations: readonly SetRelationship[]): SetRelationKind | null {
  let found: SetRelationKind | null = null
  for (const r of relations ?? []) {
    if (!((r.a === a && r.b === b) || (r.a === b && r.b === a))) continue
    if (found === null || APPROVAL_BASELINE[r.kind] < APPROVAL_BASELINE[found]) found = r.kind
  }
  return found
}

/** The starting approval for a pair. */
export function baselineApproval(a: string, b: string, relations: readonly SetRelationship[]): number {
  const kind = relationBetween(a, b, relations)
  return kind ? APPROVAL_BASELINE[kind] : APPROVAL_BASELINE.none
}

/** Current approval between two characters: the stored value, else the baseline. */
export function approval(game: Pick<GameState, 'metamours'>, a: string, b: string, relations: readonly SetRelationship[]): number {
  const stored = game.metamours?.[pairKey(a, b)]
  return typeof stored === 'number' && Number.isFinite(stored) ? clamp100(stored) : baselineApproval(a, b, relations)
}

/** Move a pair's approval (clamped 0-100) and store it. */
export function adjustApproval(
  game: GameState,
  a: string,
  b: string,
  delta: number,
  relations: readonly SetRelationship[],
): GameState {
  if (!a || !b || a === b || !Number.isFinite(delta) || delta === 0) return game
  const value = clamp100(approval(game, a, b, relations) + delta)
  return { ...game, metamours: { ...(game.metamours ?? {}), [pairKey(a, b)]: value } }
}

/** Every pair in the group approves of each other (POLYCULE_APPROVAL or more). */
export function allApprove(game: Pick<GameState, 'metamours'>, ids: readonly string[], relations: readonly SetRelationship[]): boolean {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (approval(game, ids[i], ids[j], relations) < POLYCULE_APPROVAL) return false
    }
  }
  return true
}

/**
 * How metamour approval moves this character's trust at the end of a date, under a poly agreement
 * with people they know about: +1 when they approve of them on average (60+), -1 below 40, else 0.
 */
export function metamourTrust(
  game: Pick<GameState, 'metamours'>,
  id: string,
  rel: Pick<Relationship, 'agreement' | 'knownOthers'>,
  relations: readonly SetRelationship[],
): number {
  if (rel.agreement?.type !== 'poly') return 0
  const known = (rel.knownOthers ?? []).filter((o) => o && o !== id)
  if (known.length === 0) return 0
  const avg = known.reduce((n, o) => n + approval(game, id, o, relations), 0) / known.length
  return avg >= POLYCULE_APPROVAL ? 1 : avg < 40 ? -1 : 0
}

/** Approval moves from a group date (Phase 6), by how it went for the two of them. */
export const GROUP_APPROVAL = Object.freeze({
  /** Both warmed up to the player (each date total +5 or more) and nobody walked out. */
  good: 10,
  /** Nobody lost ground (both totals 0 or more). */
  fine: 5,
  /** Someone lost ground. */
  tense: -5,
  /** Someone walked out. */
  walkout: -10,
})

/**
 * How a group date moves the pair's approval of each other: +10 when it went well for both, +5 when
 * nobody lost ground, -5 when someone did, -10 when someone walked out.
 */
export function groupApprovalDelta(results: readonly { affection: number; left: boolean }[]): number {
  if (results.length < 2) return 0
  if (results.some((r) => r.left)) return GROUP_APPROVAL.walkout
  if (results.every((r) => r.affection >= 5)) return GROUP_APPROVAL.good
  if (results.every((r) => r.affection >= 0)) return GROUP_APPROVAL.fine
  return GROUP_APPROVAL.tense
}
