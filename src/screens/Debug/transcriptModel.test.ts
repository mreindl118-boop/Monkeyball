import { describe, expect, it } from 'vitest'
import type { DebugEntry } from '../../types'
import { AFTER_END_MS, dateEntries, judgeSummary, recordSummary, turnLabel } from './transcriptModel'

const entry = (over: Partial<DebugEntry>): DebugEntry => ({ id: String(Math.random()), at: 0, kind: 'story', prompt: '', ...over })

describe('transcript helpers', () => {
  it('picks the calls a date made, by character and time', () => {
    const record = { characterIds: ['nova'], startedAt: 10_000, endedAt: 20_000 }
    const list = [
      entry({ id: 'a', at: 12_000, characterId: 'nova', kind: 'judge' }),
      entry({ id: 'b', at: 12_000, characterId: 'kai' }),
      entry({ id: 'c', at: 2_000, characterId: 'nova' }),
      entry({ id: 'd', at: 20_000 + AFTER_END_MS + 1, characterId: 'nova' }),
      entry({ id: 'e', at: 13_000, kind: 'test' }),
      entry({ id: 'f', at: 21_000, characterId: 'nova', kind: 'memory' }),
    ]
    expect(dateEntries(list, record).map((e) => e.id)).toEqual(['a', 'f'])
    expect(dateEntries(list, { characterIds: ['nova'], startedAt: 10_000 }).map((e) => e.id)).toEqual(['a', 'd', 'f'])
  })

  it('summarizes a judge result', () => {
    expect(
      judgeSummary({ delta: 4, trustDelta: 1, hits: [{ type: 'like', id: 'vinyl' }], mood: 'curious', hint: 'She grins', jealousy: false, breach: true }),
    ).toBe('Judge: delta 4; trust 1; mood curious; hits like:vinyl; breach. Hint: She grins')
    expect(judgeSummary({ delta: 0, trustDelta: 0, hits: [], mood: '', hint: '', jealousy: false, breach: false })).toBe(
      'Judge: delta 0; trust 0; mood none; no hits.',
    )
  })

  it('labels turns and the date state', () => {
    expect(turnLabel({ role: 'player' }, 'Nova')).toBe('Player')
    expect(turnLabel({ role: 'character' }, 'Nova')).toBe('Nova')
    expect(turnLabel({ role: 'system' }, 'Nova')).toBe('System note')
    const turns = [{ role: 'player' as const, text: 'x', at: 0 }]
    expect(recordSummary({ turns, maxTurns: 10 }, 'awaiting-player')).toBe('Turn 2 of 10, awaiting player')
    expect(recordSummary({ turns, maxTurns: 10, outcome: 'left' })).toBe('They left after 1 turn')
    expect(recordSummary({ turns: [], maxTurns: 10 })).toBe('Turn 1 of 10, open')
  })
})
