// Pure helpers for date setup: which venues and gifts can be picked, what the player already
// knows about each, and the summary line on the start bar. No React, no stores.

import { GIFTS, giftLock, giftNoun } from '../../data/gifts'
import { VENUES, venueLock } from '../../data/venues'
import type { GroupFeeling, PairHistory } from '../../engine/groupDate'
import type { Gift, HeatLevel, Relationship, Route, SetRelationKind, Venue } from '../../types'

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

// ---------------------------------------------------------------------------
// Group dates (Phase 6)

export interface GroupMemberInfo {
  /** First name, for copy. */
  first: string
  rel: Pick<Relationship, 'affection' | 'venues' | 'gifts'>
  route: Route
}

export interface GroupVenueOption {
  venue: Venue
  /** Locked for either of them ("Needs Lover", "Friendship-locked"), or null. */
  lock: string | null
  /** Reactions from earlier dates, per person who has tried it. */
  known: { first: string; reaction: VenueReaction }[]
}

/** Every venue with the lock that holds for either of them and what each thought of it before. */
export function groupVenueOptions(members: readonly GroupMemberInfo[]): GroupVenueOption[] {
  return VENUES.map((venue) => {
    let lock: string | null = null
    const known: GroupVenueOption['known'] = []
    for (const m of members) {
      lock ??= venueLock(venue, m.rel.affection, m.route)
      const r = m.rel.venues?.[venue.id]
      if (r) known.push({ first: m.first, reaction: r })
    }
    return { venue, lock, known }
  })
}

/** "Nova: loves it" for a group venue card. */
export function knownVenueFor(first: string, r: VenueReaction): string {
  return `${first}: ${knownVenueText(r).toLowerCase()}`
}

/** "Nova and Kai" (or "Nova, Kai and Sol"). */
export function namesText(firsts: readonly string[]): string {
  const list = firsts.filter(Boolean)
  if (list.length <= 1) return list[0] ?? ''
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** The group start bar's line: "The karaoke box with Nova and Kai, bringing hot sauce for Nova." */
export function groupSummary(firsts: readonly string[], venue: Venue | undefined, gift: Gift | undefined, giftFor?: string): string {
  if (firsts.length < 2) return 'Pick who comes along.'
  if (!venue) return 'Pick a venue next.'
  const where = venue.id === 'home' ? 'A night in' : `The ${lowerFirst(venue.name)}`
  const who = namesText(firsts)
  return gift ? `${where} with ${who}, bringing ${giftNoun(gift)}${giftFor ? ` for ${giftFor}` : ''}.` : `${where} with ${who}, no gift.`
}

const RELATION_NOUN: Record<SetRelationKind, string> = {
  partner: 'partner',
  ex: 'ex',
  situationship: 'situationship',
  friend: 'friend',
  rival: 'rival',
  roommate: 'roommate',
  housemate: 'housemate',
  coworker: 'coworker',
  bandmate: 'bandmate',
  neighbor: 'neighbor',
  family: 'family',
}

/** "Nova's ex" for the list of who could come along. */
export function relationTo(first: string, kind: SetRelationKind): string {
  return `${first}'s ${RELATION_NOUN[kind] ?? kind}`
}

const PAIR_WORDS: Record<SetRelationKind, string> = {
  partner: 'are together',
  ex: 'are exes',
  situationship: 'have a situationship going',
  friend: 'are friends',
  rival: 'are rivals',
  roommate: 'are roommates',
  housemate: 'share a house',
  coworker: 'work together',
  bandmate: 'play in a band together',
  neighbor: 'are neighbors',
  family: 'are family',
}

/** What the two are to each other, a line per relationship with the set's note under it. */
export function historyLines(a: string, b: string, history: PairHistory): { line: string; note?: string }[] {
  if (history.relations.length === 0) {
    return [{ line: history.known ? `${a} and ${b} know each other, nothing more.` : `${a} and ${b} haven't met.` }]
  }
  return history.relations.map((r) => ({
    line: `${a} and ${b} ${PAIR_WORDS[r.kind] ?? `are ${r.kind}s`}.`,
    ...(r.note ? { note: r.note } : {}),
  }))
}

/** How it reads on the setup screen: a lipstick line when it breaks something, brass when it's fine. */
export type FeelingTone = 'breaks' | 'tense' | 'easy'

/**
 * How one of them feels about you dating the other, in the setup's words: what they know, what
 * you agreed, how they take it, and what they think of the other. Names only, never a pronoun.
 * "Seeing" only once the engine counts it (seeing()); a date or two is "been out with"; nobody is
 * said to find anything out about someone you haven't been out with. How they take it (their
 * jealousy) shows only once you've learned their relationship style.
 */
export function feelingLine(f: GroupFeeling, firsts: Readonly<Record<string, string>>): { text: string; tone: FeelingTone } {
  const a = firsts[f.id] ?? f.id
  const b = firsts[f.other] ?? f.other
  const likes = f.approval >= 60 ? `${a} likes ${b}.` : f.approval >= 40 ? `${a} is undecided about ${b}.` : `${a} doesn't much like ${b}.`
  const plainTone: FeelingTone = f.approval < 40 ? 'tense' : 'easy'
  if (f.route === 'friend') return { text: `${a} is your friend and doesn't mind who else you see. ${likes}`, tone: plainTone }
  if (f.standing === 'friend') return { text: `${a} knows you and ${b} are friends. ${likes}`, tone: plainTone }
  if (f.standing === 'new') return { text: `You haven't been out with ${b} yet, so there's nothing for ${a} to find out. ${likes}`, tone: plainTone }
  const been = f.standing === 'seeing' ? 'seeing' : 'out with'
  const parts: string[] = [
    f.knew ? `${a} knows you've been ${been} ${b}.` : `${a} doesn't know you've been ${been} ${b}. Tonight ${a} finds out.`,
  ]
  if (f.agreement === 'exclusive') {
    parts.push(
      f.breaks
        ? `You and ${a} agreed to be exclusive, and you've been out with ${b} since. This breaks it.`
        : `You and ${a} agreed to be exclusive.`,
    )
  } else if (f.agreement === 'poly') parts.push('Your poly agreement expects this.')
  else if (f.agreement === 'open') parts.push(`You and ${a} keep it open.`)
  if (f.styleKnown) {
    parts.push(
      f.jealousy === 'compersion'
        ? `${a} is happy for you.`
        : f.jealousy === 'low'
          ? `${a} doesn't mind much.`
          : f.jealousy === 'medium'
            ? `${a} isn't sure how to feel about it.`
            : `${a} minds, more than it shows.`,
    )
  } else {
    parts.push(`${a} will have an opinion about it.`)
  }
  parts.push(likes)
  const jealous = f.styleKnown && (f.jealousy === 'high' || f.jealousy === 'medium')
  const tone: FeelingTone = f.breaks ? 'breaks' : jealous || f.approval < 40 || f.agreement === 'exclusive' ? 'tense' : 'easy'
  return { text: parts.join(' '), tone }
}
