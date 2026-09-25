// The automatic "Before {name}'s epilogue" save slot and when an epilogue is ready (docs/
// ARCHITECTURE.md, Date flow, Epilogue). Pure; shared by the date store, which writes the slot the
// first time a character reaches 100, and the ending screen, the profile and the saves list
// (src/screens/Ending/endingModel.ts re-exports these).

import type { Relationship, Route } from '../types'

/** Affection that wins a character and unlocks their epilogue. */
export const WON_AT = 100

/** Every automatic epilogue slot's id starts with this, so the saves list can mark it. */
export const AUTOSAVE_PREFIX = 'auto-'

/** The id of a character's "Before {name}'s epilogue" slot: one per character. */
export function epilogueSlotId(characterId: string): string {
  return `${AUTOSAVE_PREFIX}epilogue-${characterId}`
}

/** True for a slot the game wrote on its own. */
export function isAutosave(slotId: string): boolean {
  return slotId.startsWith(AUTOSAVE_PREFIX)
}

/** The first word of a name ('Their' when there is none). */
export function firstWord(name: string): string {
  const t = (name ?? '').trim()
  return t ? t.split(/\s+/)[0] : 'Their'
}

/** "Before Nova's epilogue" (a name ending in s takes a bare apostrophe: "Before Jules' epilogue"). */
export function epilogueSlotLabel(name: string): string {
  return `Before ${possessive(firstWord(name))} epilogue`
}

export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

/** The epilogue is there to play: 100 affection on a romantic route. */
export function endingReady(rel: Pick<Relationship, 'affection'>, route: Route): boolean {
  return route === 'romantic' && (rel.affection ?? 0) >= WON_AT
}

/**
 * The first time a character reaches 100 on a date: they were below it when the date began and at
 * it now. The store writes the automatic slot then (only if the slot doesn't exist yet).
 */
export function reachedWon(before: Pick<Relationship, 'affection'>, after: Pick<Relationship, 'affection'>): boolean {
  return (before.affection ?? 0) < WON_AT && (after.affection ?? 0) >= WON_AT
}
