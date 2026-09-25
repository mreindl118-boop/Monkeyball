// Date math (docs/SPEC.md, "Affection & Trust", "Date math"). Pure: no React, no Dexie.
//
// A date keeps running totals per character (DateRecord.totals): the net affection counted this
// date, the trust moved, and the gross gains. Positive affection is clipped so the date's net gain
// never passes the gain cap (setting, default +25); losses are never capped, and a running total
// of -20 or worse means the character leaves.

import type { Character, Difficulty, Relationship, Route } from '../types'
import { affectionCap } from './stages'

/** Judge deltas are scaled by the character's difficulty. */
export const DIFFICULTY_SCALE: Readonly<Record<Difficulty, number>> = {
  easy: 1.25,
  normal: 1,
  hard: 0.75,
}

/** Scale a judge delta by difficulty, rounding toward zero (never returns -0). */
export function applyDifficulty(delta: number, difficulty: Difficulty): number {
  if (!Number.isFinite(delta)) return 0
  const scaled = Math.trunc(delta * (DIFFICULTY_SCALE[difficulty] ?? 1))
  return scaled === 0 ? 0 : scaled
}

export const FAVORITE_VENUE_DELTA = 3
export const HATED_VENUE_DELTA = -5
export const LOVED_GIFT_DELTA = 5
export const HATED_GIFT_DELTA = -5
export const OTHER_GIFT_DELTA = 1

/** 'favorite' | 'hated' | 'neutral', as Relationship.venues stores it. */
export type VenueReaction = Relationship['venues'][string]
/** 'loved' | 'hated' | 'neutral', as Relationship.gifts stores it. */
export type GiftReaction = Relationship['gifts'][string]

/** How the character feels about a venue, from their card. */
export function venueReaction(character: Pick<Character, 'favoriteVenues' | 'hatedVenues'>, venueId: string): VenueReaction {
  if ((character.favoriteVenues ?? []).includes(venueId)) return 'favorite'
  if ((character.hatedVenues ?? []).includes(venueId)) return 'hated'
  return 'neutral'
}

/** How the character takes a gift, from their card. */
export function giftReaction(character: Pick<Character, 'lovedGifts' | 'hatedGifts'>, giftId: string): GiftReaction {
  if ((character.lovedGifts ?? []).includes(giftId)) return 'loved'
  if ((character.hatedGifts ?? []).includes(giftId)) return 'hated'
  return 'neutral'
}

/** Favorite venue +3, hated venue -5, any other venue 0. */
export function venueDelta(character: Pick<Character, 'favoriteVenues' | 'hatedVenues'>, venueId: string): number {
  const r = venueReaction(character, venueId)
  return r === 'favorite' ? FAVORITE_VENUE_DELTA : r === 'hated' ? HATED_VENUE_DELTA : 0
}

/** Loved gift +5, hated gift -5, any other gift +1. No gift: 0. */
export function giftDelta(character: Pick<Character, 'lovedGifts' | 'hatedGifts'>, giftId: string | undefined): number {
  if (!giftId) return 0
  const r = giftReaction(character, giftId)
  return r === 'loved' ? LOVED_GIFT_DELTA : r === 'hated' ? HATED_GIFT_DELTA : OTHER_GIFT_DELTA
}

// ---------------------------------------------------------------------------
// The date ledger

/** One character's running totals for a date (the shape of DateRecord.totals[id]). */
export interface DateTotals {
  /** Net affection counted this date: drives the gain cap and the early exit. */
  affection: number
  /** Net trust moved this date. */
  trust: number
  /** Gross affection gained this date (positive changes only). */
  gained: number
}

export function emptyTotals(): DateTotals {
  return { affection: 0, trust: 0, gained: 0 }
}

/** The per-date net gain cap, default 25 (Settings.gainCap). */
export const DEFAULT_GAIN_CAP = 25

/** A running total at or below this means the character leaves. */
export const EARLY_EXIT_AT = -20

/**
 * Count an affection delta toward the date. Positive deltas are clipped so the date's net total
 * never goes past `gainCap`, and to `room` (how far the meter can still rise, so a gain the meter
 * can't hold doesn't use up the date's allowance). Negative deltas always count in full, even when
 * the meter is already at 0, so a stranger can still walk out.
 * Returns the delta that counts and the new totals.
 */
export function applyAffection(
  totals: DateTotals,
  delta: number,
  gainCap: number,
  room: number = Number.POSITIVE_INFINITY,
): { applied: number; totals: DateTotals } {
  const d = Number.isFinite(delta) ? Math.trunc(delta) : 0
  let applied = d
  if (d > 0) {
    const cap = Number.isFinite(gainCap) ? Math.max(0, gainCap) : DEFAULT_GAIN_CAP
    applied = Math.max(0, Math.min(d, cap - totals.affection, Math.max(0, room)))
  }
  if (applied === 0) return { applied: 0, totals: { ...totals } }
  return {
    applied,
    totals: {
      ...totals,
      affection: totals.affection + applied,
      gained: totals.gained + Math.max(0, applied),
    },
  }
}

/** Count a trust change toward the date's totals. */
export function addTrust(totals: DateTotals, applied: number): DateTotals {
  return applied ? { ...totals, trust: totals.trust + applied } : { ...totals }
}

/** True once the date's running total has reached -20: the character leaves. */
export function leftEarly(total: number): boolean {
  return total <= EARLY_EXIT_AT
}

/** Clamp to 0-100 and round. */
export function clamp100(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

/**
 * Affection within 0-100 and the route's cap (friend route: 59). When `previous` is already above
 * the cap (the orientation mode changed after the fact), the cap never pulls it down: it only
 * stops further gains.
 */
export function clampAffection(value: number, route: Route, previous?: number): number {
  const cap = affectionCap(route)
  const ceiling = previous != null && Number.isFinite(previous) && previous > cap ? Math.min(100, previous) : cap
  return Math.min(ceiling, clamp100(value))
}

/** Trust stays within 0-100. */
export function clampTrust(value: number): number {
  return clamp100(value)
}

/** How far affection can still rise on this route (0 when at or over the cap). */
export function affectionRoom(affection: number, route: Route): number {
  return Math.max(0, affectionCap(route) - clamp100(affection))
}
