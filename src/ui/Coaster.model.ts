import { stageFor, stageLabel } from '../engine/stages'
import type { Character } from '../types'

export interface CoasterFacts {
  character: Pick<Character, 'id' | 'name'>
  affection: number
  discovered: number
  total: number
  friendRoute?: boolean
  jealous?: boolean
}

export const FRIEND_MARK = 'Friends'
export const JEALOUS_MARK = 'Jealous'

/**
 * The name printed on a coaster: a quoted nickname when the card has one (Roxanne "Rox"
 * Delacroix prints as Rox), else the first name. The accessible name keeps the full name.
 */
export function coasterName(name: string, fallback = ''): string {
  const full = name.trim()
  if (!full) return fallback
  const nick = /["\u201c\u201d]([^"\u201c\u201d]{1,24})["\u201c\u201d]/.exec(full)
  if (nick?.[1].trim()) return nick[1].trim()
  return full.split(/\s+/)[0]
}

/** The coaster's accessible name: everything it shows, as one sentence list. */
export function coasterLabel(p: CoasterFacts): string {
  const parts = [
    p.character.name.trim() || p.character.id,
    `stage ${stageLabel(stageFor(p.affection))}`,
    `${p.discovered} of ${p.total} traits discovered`,
  ]
  if (p.friendRoute) parts.push('friend route')
  if (p.jealous) parts.push("jealous: knows you're seeing someone and minds")
  return parts.join(', ')
}
