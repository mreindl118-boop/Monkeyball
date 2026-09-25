import { STAGES, stageIndex } from '../engine/stages'
import type { Stage } from '../types'

/** One stamp per stage, Stranger to Won. */
export const STAMP_COUNT = STAGES.length

/** How many of the six stamps are inked at a stage: Stranger 1 ... Won 6. */
export function stampsFilled(stage: Stage): number {
  return Math.min(STAMP_COUNT, Math.max(1, stageIndex(stage) + 1))
}

/** A hand-stamped look: each print sits at its own small angle (degrees). */
export const STAMP_TILT: readonly number[] = [-8, 5, -3, 7, -6, 4]
