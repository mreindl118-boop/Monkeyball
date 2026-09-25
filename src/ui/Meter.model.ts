export const METER_MAX = 100

/** A value clamped to 0-100 and rounded, for display. */
export function meterValue(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(METER_MAX, Math.max(0, value)))
}
