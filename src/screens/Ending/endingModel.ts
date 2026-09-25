// Pure helpers behind the ending screen (#/ending/:id) and the profile's "Your ending" card: when
// the ending is ready, how it reads, and the automatic save slot written the first time a
// character reaches 100. No React, no stores.

import type { EndingType, Relationship, Route } from '../../types'

export {
  AUTOSAVE_PREFIX,
  endingReady,
  epilogueSlotId,
  epilogueSlotLabel,
  isAutosave,
  possessive,
  reachedWon,
  WON_AT,
} from '../../store/epilogueSlot'
import { epilogueSlotLabel, firstWord as first, possessive, WON_AT } from '../../store/epilogueSlot'

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The Polycule ending's people, by first name, with this character first: "Nova, Rook and Dex".
 * Ids without a name show as they are.
 */
export function groupText(characterId: string, group: readonly string[] | undefined, names: Readonly<Record<string, string>>): string {
  const ids = [characterId, ...(group ?? []).filter((id) => id !== characterId)]
  const unique = ids.filter((id, i) => ids.indexOf(id) === i)
  return joinAnd(unique.map((id) => first(names[id] ?? id)))
}

/** The ending already played with this character, if any. */
export function playedEnding(rel: Pick<Relationship, 'ending'>): { type: EndingType; playedAt: number } | null {
  return rel.ending && rel.ending.type ? rel.ending : null
}

/** Endings seen with this character, oldest first and each once. */
export function seenEndings(endingsSeen: Readonly<Record<string, readonly EndingType[]>> | undefined, characterId: string): EndingType[] {
  const list = endingsSeen?.[characterId] ?? []
  return list.filter((t, i) => list.indexOf(t) === i)
}

/** The line under "Your ending" on the profile. */
export function readyLine(name: string, played: boolean): string {
  const f = first(name)
  return played
    ? `You've played ${possessive(f)} epilogue. It can play again, and the ending follows where you stand now.`
    : `You won ${possessive(f)} heart. One last date plays the ending you're on.`
}

/** What to do if it's not the ending the player wanted (under "Not the one you wanted?"). */
export function reloadHint(name: string, autosaved: boolean): string {
  const label = epilogueSlotLabel(name)
  return autosaved
    ? `The ending follows trust, agreements and what happened on the way. "${label}" is in Settings, Saves, if you'd like to go back and try another approach.`
    : 'The ending follows trust, agreements and what happened on the way, and it can still change before you play it.'
}

/** Why the epilogue can't play yet. Empty when it can. */
export function notReadyText(name: string, affection: number, route: Route): string {
  const f = first(name)
  if (route === 'friend') return `${f} is a friend. Epilogues are for the ones you win, and friendship stops at Friend.`
  if (affection < WON_AT) return `${possessive(f)} epilogue unlocks at ${WON_AT} affection. You're at ${Math.round(affection)}.`
  return ''
}

/** A sentence from the engine's reason ("trust broke somewhere") with a capital and a full stop. */
export function reasonSentence(reason: string): string {
  const t = (reason ?? '').trim()
  if (!t) return ''
  const s = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?]$/.test(s) ? s : `${s}.`
}
