// Live prompt previews for the debug panel, assembled with the real builders from a character's
// card (Nova's bundled card unless another is picked), their relationship (a fresh one unless the
// game has one), the current player profile, heat and image settings. Nothing is sent.

import { artPromptText } from '../../art/generate'
import { buildImagePrompt, friendPicture, imageHeat, sceneFor, type ImagePromptInput } from '../../art/imagePrompt'
import type { ArtSlot } from '../../art/types'
import novaJson from '../../data/sets/afterhours/characters/nova.json'
import { routeFor, attractionsOf } from '../../engine/stages'
import { venueById } from '../../data/venues'
import {
  buildAgreementPrompt,
  buildJudgePrompt,
  buildStoryPrompt,
  buildSuggestionsPrompt,
  type VenueFeeling,
} from '../../prompts/build'
import { defaultRelationship } from '../../store/defaults'
import type { Character, ImageProvider, PlayerProfile, Relationship, Settings, TierNumber } from '../../types'

export type PromptKind = 'story' | 'judge' | 'agreement' | 'suggestions' | 'image'

export const PROMPT_KINDS: readonly PromptKind[] = ['story', 'judge', 'agreement', 'suggestions', 'image']

/** Nova's card with attractions normalized to the singular Gender values. */
export function previewCharacter(): Character {
  const raw = novaJson as unknown as Character
  return { ...raw, attractedTo: attractionsOf(raw) }
}

function firstName(c: Character): string {
  return (c.name ?? '').trim().split(/\s+/)[0] || c.id
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
  settings: Pick<Settings, 'heat' | 'orientationMode' | 'dateLength'> & Partial<Pick<Settings, 'image'>>
  /** Who the previews are with (default Nova's bundled card). */
  character?: Character
  /** Their relationship as the game has it (default a fresh one): trust opens an ace gate. */
  rel?: Relationship
  /** Display names by id (default Nova and Kai). */
  names?: Record<string, string>
}

/** The tier the image preview paints: the highest unlocked, or tier 1. */
export function previewTier(rel: Pick<Relationship, 'tiersUnlocked'>): TierNumber {
  const tiers = (rel.tiersUnlocked ?? []).filter((t) => t >= 1 && t <= 5)
  return (tiers.length ? Math.max(...tiers) : 1) as TierNumber
}

/**
 * The image prompt for the character's tier (see previewTier) as the app would paint it now: the
 * provider picked in Settings, the heat after their ace cap or trust gate, and the locked safety
 * text. The same text the debug panel logs for a painting.
 */
export function buildImagePreview(
  character: Character,
  rel: Relationship,
  settings: Pick<Settings, 'heat' | 'image'> & Partial<Pick<Settings, 'orientationMode'>>,
  player?: PlayerProfile | null,
): string {
  const slot: ArtSlot = { kind: 'tier', characterId: character.id, tier: previewTier(rel) }
  const provider: ImageProvider = settings.image.provider === 'grok' ? 'grok' : 'a1111'
  const input: ImagePromptInput = {
    slot,
    characters: [character],
    heat: settings.heat,
    settings: { ...settings.image, provider },
    scene: sceneFor(slot, [character]),
    trust: rel.trust,
    // The friend route paints platonic art, like the app does (generate.ts).
    route: routeFor(character, player ?? null, settings.orientationMode ?? 'realistic'),
    player: player ?? null,
  }
  return artPromptText({ ...buildImagePrompt(input), provider, heat: imageHeat(input), ...(friendPicture(input) ? { friend: true } : {}) }, settings)
}

/** The venue the story preview is set at: the character's first favorite (Nova: the record store). */
function previewVenue(character: Character): { name: string; feeling: VenueFeeling } {
  const fav = (character.favoriteVenues ?? []).map((id) => venueById(id)).find(Boolean)
  return fav ? { name: `The ${fav.name.charAt(0).toLowerCase()}${fav.name.slice(1)}`, feeling: 'loves' } : { name: 'The record store', feeling: 'fine' }
}

/** Build every preview. Each is either the prompt text or an error message. */
export function buildPreviews({ profile, settings, ...who }: PreviewInput): Record<PromptKind, string> {
  const character = who.character ?? previewCharacter()
  const rel = who.rel ?? defaultRelationship(character.id)
  const names = who.names ?? NAMES
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
        venue: previewVenue(character),
        turn: 0,
        maxTurns: settings.dateLength,
        firstDate: !rel.dates,
        names,
      }),
    ),
    judge: safe(() =>
      buildJudgePrompt({
        character,
        rel,
        route,
        names,
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
        names,
        turns: [
          { role: 'player', text: "I like where this is going. Could we make it just us?", dtr: true },
          {
            role: 'character',
            speaker: character.id,
            text: `*${firstName(character)} leans in.* "Just us. Say more."`,
            dtr: true,
          },
        ],
      }),
    ),
    suggestions: safe(() =>
      buildSuggestionsPrompt({ character, rel, route, heat: settings.heat }),
    ),
    image: settings.image
      ? safe(() => buildImagePreview(character, rel, { heat: settings.heat, image: settings.image!, orientationMode: settings.orientationMode }, player))
      : 'Image settings are missing.',
  }
}
