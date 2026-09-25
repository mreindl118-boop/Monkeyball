import { describe, expect, it } from 'vitest'
import spec from '../../docs/SPEC.md?raw'
import { clampHeat, HEAT_LEVELS, heatDescription } from './heat'

describe('heat levels', () => {
  it('match the SPEC Heat section verbatim', () => {
    for (const h of HEAT_LEVELS) {
      expect(spec).toContain(`${h.level}. **${h.name}**: ${h.description}\n`)
    }
    expect(HEAT_LEVELS.map((h) => h.name)).toEqual(['Sweet', 'Flirty', 'Ecchi', 'Explicit', 'Raw'])
  })

  it('formats the description with the level name', () => {
    expect(heatDescription(2)).toBe(
      'Flirty: innuendo, teasing, making out, suggestive situations, building tension; fade to black before sex.',
    )
  })

  it('clamps out-of-range levels', () => {
    expect(clampHeat(0)).toBe(1)
    expect(clampHeat(9)).toBe(5)
    expect(clampHeat(Number.NaN)).toBe(2)
  })
})
