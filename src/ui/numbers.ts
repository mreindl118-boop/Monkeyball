function decimals(step: number): number {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1].length : 0
}

/** Clamp to bounds and snap to the step grid (counted from min). Non-numbers become min. */
export function clampStep(v: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(v)) return min
  const snapped = Math.round((v - min) / step) * step + min
  const fixed = Number(snapped.toFixed(decimals(step)))
  return Math.min(max, Math.max(min, fixed))
}
