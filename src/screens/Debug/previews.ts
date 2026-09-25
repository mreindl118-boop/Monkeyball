// Live prompt previews for the debug panel, assembled with the real builders from Nova's bundled
// card, a fresh relationship, the current player profile and the current heat. Nothing is sent.

import novaJson from '../../data/sets/afterhours/characters/nova.json'
import { routeFor, attractionsOf } from '../../engine/stages'
import {
  buildAgreementPrompt,
  buildJudgePrompt,
  buildStoryPrompt,
  buildSuggestionsPrompt,
} from '../../prompts/build'
import { defaultRelationship } from '../../store/defaults'
import type { Character, PlayerProfile, Settings } from '../../types'

export type PromptKind = 'story' | 'judge' | 'agreement' | 'suggestions'

export const PROMPT_KINDS: readonly PromptKind[] = ['story', 'judge', 'agreement', 'suggestions']

/** Nova's card with attractions normalized to the singular Gender values. */
export function previewCharacter(): Character {
  const raw = novaJson as unknown as Character
  return { ...raw, attractedTo: attractionsOf(raw) }
}

/** Display names for ids the preview character mentions (Kai is Nova's ex). */
const NAMES: Record<string, string> = { nova: 'Nova', kai: 'Kai' }

/** A stand-in profile so previews still render before a profile exists. */
const FALLBACK_PROFILE: PlayerProfile = {
  name: 'Player',
  gender: 'nonbinary',
  pronouns: 'they/them',
  bodyNotes: '',
  relationshipStyle: 'figuring',
}

export interface PreviewInput {
  profile: PlayerProfile | null
  settings: Pick<Settings, 'heat' | 'orientationMode' | 'dateLength'>
}

/** Build all four previews. Each is either the prompt text or an error message. */
export function buildPreviews({ profile, settings }: PreviewInput): Record<PromptKind, string> {
  const character = previewCharacter()
  const rel = defaultRelationship(character.id)
  const player = profile ?? FALLBACK_PROFILE
  const route = routeFor(character, player, settings.orientationMode)

  const safe = (fn: () => string): string => {
    try {
      return fn()
    } catch (e) {
      return `Couldn't build this preview: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  return {
    story: safe(() =>
      buildStoryPrompt({
        character,
        rel,
        profile: player,
        heat: settings.heat,
        route,
        venue: { name: 'The record store', feeling: 'loves' },
        turn: 0,
        maxTurns: settings.dateLength,
        firstDate: true,
        names: NAMES,
      }),
    ),
    judge: safe(() =>
      buildJudgePrompt({
        character,
        rel,
        route,
        names: NAMES,
        others: [],
        recent: [
          { role: 'character', speaker: character.id, text: `"${character.opener}"` },
        ],
        message: "Excellent taste, obviously. What's the one record you'd save in a fire?",
      }),
    ),
    agreement: safe(() =>
      buildAgreementPrompt({
        character,
        rel,
        requested: 'exclusive',
        names: NAMES,
        turns: [
          { role: 'player', text: "I like where this is going. Could we make it just us?", dtr: true },
          {
            role: 'character',
            speaker: character.id,
            text: '*She sets the record down.* "Just us. Say more, trouble."',
            dtr: true,
          },
        ],
      }),
    ),
    suggestions: safe(() =>
      buildSuggestionsPrompt({ character, rel, route, heat: settings.heat }),
    ),
  }
}
