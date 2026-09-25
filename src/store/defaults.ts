import { CLAUDE_JUDGE_MODEL, CLAUDE_STORY_MODEL, PRESETS, PRESET_IDS } from '../llm/presets'
import type {
  ConnectionPreset,
  ConnectionSettings,
  ImageSettings,
  PlayerProfile,
  ProviderSlot,
  Relationship,
  Settings,
  StylePreset,
} from '../types'

/**
 * Editable style prefixes for image generation. These describe look and mood only. The locked
 * safety text (adult ages, no childlike appearance, no non-consent) is added in code by
 * src/art/imagePrompt.ts and never lives here.
 */
export const DEFAULT_STYLE_PREFIXES: Readonly<Record<StylePreset, string>> = {
  anime:
    'anime illustration, clean confident line art, cel shading, expressive eyes, neon night palette, glossy highlights, detailed background',
  semiReal:
    'semi-realistic digital painting, soft cinematic lighting, natural skin texture, shallow depth of field, moody night colors, film grain',
  painterly:
    'painterly illustration, visible brush strokes, rich oil colors, warm lamplight against deep shadows, romantic late-night mood',
}

/** Every preset's default address, with no key. */
export const DEFAULT_PROVIDERS: Readonly<Record<ConnectionPreset, ProviderSlot>> = Object.fromEntries(
  PRESET_IDS.map((id) => [id, { baseUrl: PRESETS[id].baseUrl, apiKey: '' }]),
) as Record<ConnectionPreset, ProviderSlot>

/** New installs: Claude for both roles (Opus 5 writes, Haiku 4.5 judges), no key yet. */
export const DEFAULT_CONNECTION: Readonly<ConnectionSettings> = {
  providers: DEFAULT_PROVIDERS,
  story: { preset: 'claude', model: CLAUDE_STORY_MODEL },
  judge: { preset: 'same', model: CLAUDE_JUDGE_MODEL },
  storyTemperature: 0.9,
  maxTokens: 600,
  effort: 'low',
}

export const DEFAULT_IMAGE: Readonly<ImageSettings> = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:7860',
  stylePreset: 'anime',
  stylePrefixes: { ...DEFAULT_STYLE_PREFIXES },
  width: 832,
  height: 1216,
  steps: 28,
  cfg: 6,
  sampler: 'DPM++ 2M',
  seedMode: 'fixed',
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  ageConfirmed: false,
  onboarded: false,
  connection: DEFAULT_CONNECTION,
  heat: 2,
  orientationMode: 'realistic',
  showMe: 'everyone',
  hints: false,
  suggestions: true,
  dateLength: 10,
  gainCap: 25,
  image: DEFAULT_IMAGE,
  activeSets: ['afterhours'],
  hubSort: 'affection',
  hubSetFilter: 'all',
  autoUpdateCheck: true,
}

/** A fresh, deep copy of the default settings (safe to mutate). */
export function defaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS) as Settings
}

/** Starting values for the profile form. Name is blank and must be filled in. */
export const DEFAULT_PROFILE: Readonly<PlayerProfile> = {
  name: '',
  gender: 'nonbinary',
  pronouns: 'they/them',
  bodyNotes: '',
  relationshipStyle: 'figuring',
}

/** A fresh copy of the default profile (safe to mutate). */
export function defaultProfile(): PlayerProfile {
  return { ...DEFAULT_PROFILE }
}

/** A brand-new relationship: strangers, nothing discovered, no agreement. */
export function defaultRelationship(characterId: string): Relationship {
  return {
    characterId,
    affection: 0,
    trust: 0,
    discovered: [],
    venues: {},
    gifts: {},
    revealed: { attractions: false, style: false },
    knowsPlayerStyle: false,
    secretsUnlocked: [],
    agreement: { type: 'none', terms: '', madeAt: 0 },
    knownOthers: [],
    memory: [],
    tiersUnlocked: [],
    betrayals: [],
    dates: 0,
    lastDateAt: 0,
    connection: 0,
    heatPushes: 0,
    jealous: false,
  }
}
