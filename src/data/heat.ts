import type { HeatLevel } from '../types'

export interface HeatInfo {
  level: HeatLevel
  name: string
  /** The spec's description for this level, verbatim. */
  description: string
}

/** The five heat levels from docs/SPEC.md, "Heat". Descriptions are verbatim. */
export const HEAT_LEVELS: readonly HeatInfo[] = [
  {
    level: 1,
    name: 'Sweet',
    description: 'romance and chemistry, kissing, fade to black before anything intimate.',
  },
  {
    level: 2,
    name: 'Flirty',
    description:
      'innuendo, teasing, making out, suggestive situations, building tension; fade to black before sex.',
  },
  {
    level: 3,
    name: 'Ecchi',
    description:
      'partial nudity, lingering descriptions, fan service, sexual situations described but not graphically; sex off-screen or heavily faded.',
  },
  {
    level: 4,
    name: 'Explicit',
    description:
      'full sexual content between consenting adults. Acts, pleasure, bodies, positions. Nothing is off-screen.',
  },
  {
    level: 5,
    name: 'Raw',
    description:
      'explicit plus rough kink, power dynamics, dirty talk, degradation (when they consent in-story), jealousy plays, infidelity confrontations. Full narrative freedom.',
  },
]

export const DEFAULT_HEAT: HeatLevel = 2

/** Clamp any number into a valid heat level (rounds, then clamps to 1-5). */
export function clampHeat(level: number): HeatLevel {
  if (!Number.isFinite(level)) return DEFAULT_HEAT
  return Math.min(5, Math.max(1, Math.round(level))) as HeatLevel
}

export function heatInfo(level: number): HeatInfo {
  return HEAT_LEVELS[clampHeat(level) - 1]
}

export function heatName(level: number): string {
  return heatInfo(level).name
}

/** "Flirty: innuendo, teasing, making out, ..." — the text used for {heatDescription}. */
export function heatDescription(level: number): string {
  const h = heatInfo(level)
  return `${h.name}: ${h.description}`
}
