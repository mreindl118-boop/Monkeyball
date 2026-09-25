// Relationship stages, routes and heat caps. Pure: no React, no Dexie.

import type {
  Character,
  Gender,
  HeatLevel,
  OrientationMode,
  PlayerProfile,
  Relationship,
  Route,
  Stage,
} from '../types'

export interface StageInfo {
  id: Stage
  label: string
  /** Minimum affection for this stage (inclusive). */
  min: number
  /** Maximum affection for this stage (inclusive). */
  max: number
}

/** Stages by affection, per SPEC: Stranger 0–19 ... Won 100. Ordered low to high. */
export const STAGES: readonly StageInfo[] = [
  { id: 'stranger', label: 'Stranger', min: 0, max: 19 },
  { id: 'acquaintance', label: 'Acquaintance', min: 20, max: 39 },
  { id: 'friend', label: 'Friend', min: 40, max: 59 },
  { id: 'crush', label: 'Crush', min: 60, max: 79 },
  { id: 'lover', label: 'Lover', min: 80, max: 99 },
  { id: 'won', label: 'Won', min: 100, max: 100 },
]

/** The stage for an affection value. Out-of-range values clamp to Stranger / Won. */
export function stageFor(affection: number): Stage {
  const a = Number.isFinite(affection) ? affection : 0
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (a >= STAGES[i].min) return STAGES[i].id
  }
  return 'stranger'
}

export function stageInfo(stage: Stage): StageInfo {
  return STAGES.find((s) => s.id === stage) ?? STAGES[0]
}

/** Capitalized label, e.g. "Acquaintance". */
export function stageLabel(stage: Stage): string {
  return stageInfo(stage).label
}

/** 0 for Stranger ... 5 for Won. */
export function stageIndex(stage: Stage): number {
  const i = STAGES.findIndex((s) => s.id === stage)
  return i < 0 ? 0 : i
}

/** The next stage above this affection and the affection it needs, or null at Won. */
export function nextStage(affection: number): StageInfo | null {
  const i = stageIndex(stageFor(affection))
  return STAGES[i + 1] ?? null
}

// ---------------------------------------------------------------------------
// Genders and attractions

/**
 * Normalize a gender word to the singular `Gender` value. Accepts plurals and common
 * variants ("women" -> "woman", "men" -> "man", "nonbinary people" / "enby" -> "nonbinary").
 * Returns null for anything it doesn't recognise.
 */
export function normalizeGender(value: string): Gender | null {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/\s+(people|folks?|persons?|folx)$/, '')
  switch (v) {
    case 'woman':
    case 'women':
    case 'female':
    case 'females':
      return 'woman'
    case 'man':
    case 'men':
    case 'male':
    case 'males':
      return 'man'
    case 'nonbinary':
    case 'non-binary':
    case 'non binary':
    case 'nb':
    case 'enby':
    case 'enbies':
    case 'enbys':
      return 'nonbinary'
    default:
      return null
  }
}

/** Normalized, deduplicated attractions in card order. Unknown words are dropped. */
export function attractionsOf(character: Pick<Character, 'attractedTo'>): Gender[] {
  const out: Gender[] = []
  for (const g of character.attractedTo ?? []) {
    const n = normalizeGender(g)
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}

const PLURAL: Record<Gender, string> = {
  woman: 'women',
  man: 'men',
  nonbinary: 'nonbinary people',
}

/** Join words as "a", "a and b", "a, b and c". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** "women, men and nonbinary people". Empty string when nothing is listed. */
export function describeAttractions(attractedTo: readonly string[]): string {
  const genders: Gender[] = []
  for (const g of attractedTo) {
    const n = normalizeGender(g)
    if (n && !genders.includes(n)) genders.push(n)
  }
  return joinAnd(genders.map((g) => PLURAL[g]))
}

/** Which attraction bucket the player counts as. Custom genders use matchAs (default nonbinary). */
export function playerBucket(profile: PlayerProfile | null | undefined): Gender {
  if (!profile) return 'nonbinary'
  if (profile.gender === 'custom') return profile.matchAs ?? 'nonbinary'
  return normalizeGender(profile.gender) ?? 'nonbinary'
}

/**
 * Romantic or friend route. Realistic mode: friend route when the player's bucket is not
 * in the character's attractions. Everyone mode: always romantic.
 */
export function routeFor(
  character: Pick<Character, 'attractedTo'>,
  profile: PlayerProfile | null | undefined,
  orientationMode: OrientationMode,
): Route {
  if (orientationMode === 'everyone') return 'romantic'
  return attractionsOf(character).includes(playerBucket(profile)) ? 'romantic' : 'friend'
}

/** Highest affection a route allows. Friend route caps at the top of Friend (59). */
export function affectionCap(route: Route): number {
  return route === 'friend' ? 59 : 100
}

// ---------------------------------------------------------------------------
// Heat and the ace spectrum

/** Heat that ace/demi characters stay at until their trust threshold is passed. */
export const ACE_GATED_HEAT: HeatLevel = 2

/**
 * The heat actually written for this character: the player's heat, lowered to the card's
 * heatCap, and to 2 while trust is not over heatUnlockTrust.
 * Accepts a trust number or anything with a `trust` field (e.g. a Relationship).
 */
export function effectiveHeat(
  character: Pick<Character, 'aceSpectrum'>,
  trust: number | Pick<Relationship, 'trust'>,
  heat: HeatLevel,
): HeatLevel {
  const t = typeof trust === 'number' ? trust : trust.trust
  let h = heat
  const ace = character.aceSpectrum
  if (ace?.heatCap != null) h = Math.min(h, ace.heatCap) as HeatLevel
  if (ace?.heatUnlockTrust != null && !(t > ace.heatUnlockTrust)) {
    h = Math.min(h, ACE_GATED_HEAT) as HeatLevel
  }
  return Math.max(1, h) as HeatLevel
}

/**
 * One line for the story prompt's {aceNote} (and the judge's {personality}), e.g.
 * "Demisexual: nothing past heat 2 until trust is over 60, and that is who Priya Raman is, not a
 * puzzle." Without a name it says "who they are". Empty when the card has no aceSpectrum.
 */
export function aceNote(character: Pick<Character, 'aceSpectrum'> & { name?: string }): string {
  const ace = character.aceSpectrum
  if (!ace) return ''
  const name = (character.name ?? '').trim()
  const notAPuzzle = name ? `and that is who ${name} is, not a puzzle.` : 'and that is who they are, not a puzzle.'
  const raw = (ace.label ?? '').trim() || 'Ace spectrum'
  const label = raw.charAt(0).toUpperCase() + raw.slice(1)
  const cap = ace.heatCap != null && ace.heatCap < 5 ? ace.heatCap : null
  const gate = ace.heatUnlockTrust
  const gateMatters = gate != null && (cap == null || cap > ACE_GATED_HEAT)
  let rule: string
  if (gateMatters && cap != null) {
    rule = `nothing past heat ${ACE_GATED_HEAT} until trust is over ${gate}, never past heat ${cap}`
  } else if (gateMatters) {
    rule = `nothing past heat ${ACE_GATED_HEAT} until trust is over ${gate}`
  } else if (cap != null) {
    rule = `heat never goes past ${cap}`
  } else {
    rule = name ? `${name} sets the pace` : 'they set their own pace'
  }
  return `${label}: ${rule}, ${notAPuzzle}`
}
