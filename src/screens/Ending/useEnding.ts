// The ending a character is on, from the stores: the engine's selectEnding over everyone in play
// (docs/ARCHITECTURE.md, endings.ts), with its title and description. Shared by the profile's
// "Your ending" card and the ending screen.

import { useEffect, useMemo, useState } from 'react'
import { db } from '../../db/db'
import { firstName } from '../../engine/agreements'
import { endingDescription, ENDINGS, selectEnding } from '../../engine/endings'
import { newRelationship } from '../../engine/relationship'
import { routeFor } from '../../engine/stages'
import { activeRelations } from '../../store/date'
import { useGame } from '../../store/game'
import { selectActiveEntries, useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import type { Character, EndingType, Relationship, Route } from '../../types'
import { endingReady, epilogueSlotId } from './endingModel'

export interface EndingPick {
  type: EndingType
  group?: string[]
  reason: string
  title: string
  description: string
}

export interface EndingState {
  character: Character | undefined
  rel: Relationship
  route: Route
  /** 100 affection on a romantic route. */
  ready: boolean
  /** The ending they're on (only worked out once ready). */
  ending: EndingPick | null
  /** Display names by character id. */
  names: Record<string, string>
}

export function useEnding(id: string): EndingState {
  const sets = useRoster((s) => s.sets)
  const entries = useRoster((s) => s.entries)
  const relationships = useGame((s) => s.relationships)
  const game = useGame((s) => s.game)
  const profile = useSettings((s) => s.profile)
  const activeSets = useSettings((s) => s.settings.activeSets)
  const mode = useSettings((s) => s.settings.orientationMode)

  return useMemo(() => {
    const character = entries[id]?.character
    const rel = relationships[id] ?? newRelationship(id)
    const route: Route = character ? routeFor(character, profile, mode) : 'romantic'
    const names: Record<string, string> = {}
    for (const e of Object.values(entries)) names[e.character.id] = e.character.name.trim() || e.character.id
    const ready = !!character && endingReady(rel, route)
    let ending: EndingPick | null = null
    if (character && ready) {
      const data = { sets, entries }
      const characters: Record<string, Character> = {}
      for (const e of selectActiveEntries(data, { activeSets, showMe: 'everyone' })) characters[e.character.id] = e.character
      characters[id] = character
      try {
        const pick = selectEnding({
          characterId: id,
          characters,
          rels: relationships,
          game,
          relations: activeRelations(data, activeSets),
        })
        const info = ENDINGS[pick.type]
        ending = {
          type: pick.type,
          reason: pick.reason,
          title: info?.title ?? pick.type,
          description: endingDescription(pick.type, firstName(character.name.trim() || id), pick.cause) || info?.description || '',
          ...(pick.group?.length ? { group: pick.group } : {}),
        }
      } catch {
        ending = null
      }
    }
    return { character, rel, route, ready, ending, names }
  }, [id, sets, entries, relationships, game, profile, activeSets, mode])
}

/** Whether the automatic "Before {name}'s epilogue" slot exists (null while checking). */
export function useEpilogueAutosave(id: string): boolean | null {
  const [has, setHas] = useState<{ id: string; has: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    db.saves
      .get(epilogueSlotId(id))
      .then((row) => {
        if (alive) setHas({ id, has: !!row })
      })
      .catch(() => {
        if (alive) setHas({ id, has: false })
      })
    return () => {
      alive = false
    }
  }, [id])
  return has && has.id === id ? has.has : null
}

/** An ending's title, for the recap of an epilogue (the type itself when it isn't known). */
export function endingTitle(type: EndingType | undefined): string {
  if (!type) return ''
  return ENDINGS[type]?.title ?? type
}
