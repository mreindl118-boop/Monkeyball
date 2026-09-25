// Pure helpers for the debug panel's Transcript tab.

import type { DateRecord, DateTurn, DebugEntry, JudgeResult } from '../../types'

/** Calls logged after this long past a date's end still count as that date's (the memory call). */
export const AFTER_END_MS = 5 * 60_000

const DATE_KINDS: ReadonlySet<DebugEntry['kind']> = new Set(['story', 'judge', 'suggestions', 'memory', 'agreement'])

/** The debug log entries a date made: its characters, from its start to shortly after its end. Oldest first. */
export function dateEntries(entries: readonly DebugEntry[], record: Pick<DateRecord, 'characterIds' | 'startedAt' | 'endedAt'>): DebugEntry[] {
  const ids = new Set(record.characterIds)
  const from = record.startedAt - 1000
  const to = record.endedAt != null ? record.endedAt + AFTER_END_MS : Infinity
  return entries.filter((e) => DATE_KINDS.has(e.kind) && !!e.characterId && ids.has(e.characterId) && e.at >= from && e.at <= to)
}

/** "delta 4, trust 1, mood curious, hits like:vinyl, hint: She grins" (plus jealousy and breach flags). */
export function judgeSummary(j: JudgeResult): string {
  const parts = [`delta ${j.delta}`, `trust ${j.trustDelta}`, `mood ${j.mood || 'none'}`]
  parts.push(j.hits.length ? `hits ${j.hits.map((h) => `${h.type}:${h.id}`).join(', ')}` : 'no hits')
  if (j.jealousy) parts.push('jealousy')
  if (j.breach) parts.push('breach')
  const head = `Judge: ${parts.join('; ')}.`
  return j.hint ? `${head} Hint: ${j.hint}` : head
}

/** Who said it. */
export function turnLabel(turn: Pick<DateTurn, 'role'>, name: string): string {
  return turn.role === 'player' ? 'Player' : turn.role === 'system' ? 'System note' : name
}

/** "Turn 3 of 10, replying" or "Completed after 10 turns". */
export function recordSummary(record: Pick<DateRecord, 'turns' | 'maxTurns' | 'outcome'>, status?: string): string {
  const sent = record.turns.filter((t) => t.role === 'player').length
  if (record.outcome) {
    const how = record.outcome === 'completed' ? 'Completed' : record.outcome === 'left' ? 'They left' : record.outcome === 'ended' ? 'Ended early' : 'Abandoned'
    return `${how} after ${sent} ${sent === 1 ? 'turn' : 'turns'}`
  }
  const turn = Math.min(record.maxTurns, sent + 1)
  return status ? `Turn ${turn} of ${record.maxTurns}, ${status.replace(/-/g, ' ')}` : `Turn ${turn} of ${record.maxTurns}, open`
}
