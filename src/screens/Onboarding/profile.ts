import type { Gender, OrientationMode, PlayerGender, PlayerProfile, PlayerStyle } from '../../types'
import type { SegmentedOption } from '../../ui/Segmented'

export const GENDER_OPTIONS: SegmentedOption<PlayerGender>[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Nonbinary' },
  { value: 'custom', label: 'Custom' },
]

export const MATCH_OPTIONS: SegmentedOption<Gender>[] = [
  { value: 'woman', label: 'A woman' },
  { value: 'man', label: 'A man' },
  { value: 'nonbinary', label: 'Nonbinary' },
]

export const STYLE_OPTIONS: SegmentedOption<PlayerStyle>[] = [
  { value: 'monogamous', label: 'Monogamous' },
  { value: 'open', label: 'Open' },
  { value: 'polyamorous', label: 'Polyamorous' },
  { value: 'figuring', label: 'Figuring it out' },
]

export const PRONOUN_SUGGESTIONS = ['she/her', 'he/him', 'they/them']

export const PRONOUNS_FOR: Partial<Record<PlayerGender, string>> = {
  woman: 'she/her',
  man: 'he/him',
  nonbinary: 'they/them',
}

export interface ProfileErrors {
  name?: string
  pronouns?: string
  customGender?: string
}

/** Validate a profile draft. Empty object means valid. */
export function validateProfile(p: PlayerProfile): ProfileErrors {
  const errors: ProfileErrors = {}
  if (!p.name.trim()) errors.name = 'Add a name so people know what to call you.'
  else if (p.name.trim().length > 40) errors.name = 'Keep it under 40 characters.'
  if (!p.pronouns.trim()) errors.pronouns = 'Add your pronouns so characters get them right.'
  if (p.gender === 'custom' && !p.customGender?.trim()) {
    errors.customGender = 'Add the word you use, or pick one of the options above.'
  }
  return errors
}

/** Trim fields and drop custom-only fields when they don't apply. */
export function cleanProfile(p: PlayerProfile): PlayerProfile {
  const out: PlayerProfile = {
    name: p.name.trim(),
    gender: p.gender,
    pronouns: p.pronouns.trim(),
    bodyNotes: p.bodyNotes.trim(),
    relationshipStyle: p.relationshipStyle,
  }
  if (p.gender === 'custom') {
    out.customGender = p.customGender?.trim() ?? ''
    out.matchAs = p.matchAs ?? 'nonbinary'
  }
  return out
}

export const ORIENTATION_OPTIONS: SegmentedOption<OrientationMode>[] = [
  {
    value: 'realistic',
    label: 'Realistic',
    description:
      "Each character's attractions apply. Anyone who isn't into your gender becomes a friend instead.",
  },
  {
    value: 'everyone',
    label: "Everyone's into you",
    description: 'Attractions are ignored, so everyone is dateable.',
  },
]
