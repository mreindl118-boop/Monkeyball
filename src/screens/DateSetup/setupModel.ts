// Pure helpers for date setup: which venues and gifts can be picked, what the player already
// knows about each, and the summary line on the start bar. No React, no stores.

import { GIFTS, giftLock, giftNoun } from '../../data/gifts'
import { VENUES, venueLock } from '../../data/venues'
import type { Gift, HeatLevel, Relationship, Route, Venue } from '../../types'

export type VenueReaction = 'favorite' | 'hated' | 'neutral'
export type GiftReaction = 'loved' | 'hated' | 'neutral'

export interface VenueOption {
  venue: Venue
  /** Why it can't be picked ("Needs Lover", "Friendship-locked"), or null. */
  lock: string | null
  /** How they reacted on an earlier date, once tried. */
  known?: VenueReaction
}

export interface GiftOption {
  gift: Gift
  lock: string | null
  known?: GiftReaction
}

/** Every venue in spec order with its lock and any known reaction. */
export function venueOptions(rel: Pick<Relationship, 'affection' | 'venues'>, route: Route): VenueOption[] {
  return VENUES.map((venue) => {
    const known = rel.venues?.[venue.id]
    const opt: VenueOption = { venue, lock: venueLock(venue, rel.affection, route) }
    if (known) opt.known = known
    return opt
  })
}

/** Every gift in spec order with its lock ("Needs Crush and heat 3+") and any known reaction. */
export function giftOptions(rel: Pick<Relationship, 'affection' | 'gifts'>, route: Route, heat: HeatLevel | number): GiftOption[] {
  return GIFTS.map((gift) => {
    const known = rel.gifts?.[gift.id]
    const opt: GiftOption = { gift, lock: giftLock(gift, rel.affection, heat, route) }
    if (known) opt.known = known
    return opt
  })
}

/** "Loves it", "Can't stand it", "Fine with it". */
export function knownVenueText(r: VenueReaction): string {
  return r === 'favorite' ? 'Loves it' : r === 'hated' ? "Can't stand it" : 'Fine with it'
}

/** "Loved it", "Hated it", "It was fine". */
export function knownGiftText(r: GiftReaction): string {
  return r === 'loved' ? 'Loved it' : r === 'hated' ? 'Hated it' : 'It was fine'
}

/** A picked venue that is locked (or unknown) is no pick at all. */
export function validVenue(options: readonly VenueOption[], id: string | null): string | null {
  const o = id ? options.find((x) => x.venue.id === id) : undefined
  return o && !o.lock ? o.venue.id : null
}

/** A locked or unknown gift falls back to no gift. */
export function validGift(options: readonly GiftOption[], id: string | null | undefined): string | null {
  const o = id ? options.find((x) => x.gift.id === id) : undefined
  return o && !o.lock ? o.gift.id : null
}

function lowerFirst(s: string): string {
  const t = s.trim()
  if (t.length > 1 && /[A-Z]/.test(t[0]) && /[a-z\s]/.test(t[1])) return t[0].toLowerCase() + t.slice(1)
  return t
}

/** The start bar's line: "The record store with Nova, bringing rare vinyl." or "..., bringing a plushie." */
export function setupSummary(first: string, venue: Venue | undefined, gift: Gift | undefined): string {
  if (!venue) return 'Pick a venue first.'
  const where = venue.id === 'home' ? 'A night in' : `The ${lowerFirst(venue.name)}`
  return gift ? `${where} with ${first}, bringing ${giftNoun(gift)}.` : `${where} with ${first}, no gift.`
}
