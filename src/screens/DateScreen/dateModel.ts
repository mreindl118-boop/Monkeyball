// Pure helpers for the date screen: story text formatting, the turn counter, status copy,
// suggestion chips and per-turn deltas. No React, no stores.

import type { DateStatus } from '../../engine/dateFlow'
import { stageFor, stageIndex } from '../../engine/stages'
import type { DateRecord, DateTurn, Route, Suggestions } from '../../types'

// ---------------------------------------------------------------------------
// Names

/** "Nova Castellanos" -> "Nova". Falls back to the whole name, then "They". */
export function firstName(name: string | undefined | null): string {
  const t = (name ?? '').trim()
  if (!t) return 'They'
  return t.split(/\s+/)[0]
}

// ---------------------------------------------------------------------------
// Story text: *actions* in italics, "dialogue" and narration as plain text

export interface StorySegment {
  /** action: text between asterisks (drawn in italics). text: dialogue and narration. */
  kind: 'action' | 'text'
  text: string
}

export type StoryParagraph = StorySegment[]

/**
 * Split a reply into paragraphs (blank lines) and each paragraph into action and text runs.
 * `*like this*` (or `**like this**`) is an action; the asterisks are dropped. An asterisk that
 * hasn't closed yet (mid-stream) makes the rest of the paragraph an action. Single newlines are
 * kept inside the text.
 */
export function parseStory(text: string): StoryParagraph[] {
  const paragraphs = (text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  return paragraphs.map(parseParagraph).filter((p) => p.length > 0)
}

function parseParagraph(p: string): StoryParagraph {
  const out: StoryParagraph = []
  const push = (kind: StorySegment['kind'], raw: string) => {
    if (!raw) return
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += raw
    else out.push({ kind, text: raw })
  }
  let action = false
  let buf = ''
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]
    if (ch === '*') {
      // Treat a run of asterisks as one marker.
      while (p[i + 1] === '*') i++
      push(action ? 'action' : 'text', buf)
      buf = ''
      action = !action
      continue
    }
    buf += ch
  }
  push(action ? 'action' : 'text', buf)
  // Trim the paragraph's outer whitespace, keep inner spacing between runs.
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, '')
    const last = out[out.length - 1]
    last.text = last.text.replace(/\s+$/, '')
  }
  return out.filter((s) => s.text.length > 0)
}

// ---------------------------------------------------------------------------
// Turns

/** Player messages sent so far. */
export function playerTurnCount(record: Pick<DateRecord, 'turns'>): number {
  return (record.turns ?? []).filter((t) => t.role === 'player').length
}

/**
 * The turn being played: "Turn 3 of 10". Once the date is over (`over`: closing, ended, or the
 * character is leaving) it stays on the last turn that was played, so a walkout or End date after
 * one message reads "Turn 1 of 10", not a turn that never happened.
 */
export function turnLabel(record: Pick<DateRecord, 'turns' | 'maxTurns'>, over = false): string {
  const max = Math.max(1, Math.round(record.maxTurns || 1))
  const played = playerTurnCount(record)
  const turn = Math.min(max, over ? Math.max(1, played) : played + 1)
  return `Turn ${turn} of ${max}`
}

/** The last player turn's applied deltas for a character, if any. */
export function lastApplied(
  record: Pick<DateRecord, 'turns'>,
  characterId: string,
): { affection: number; trust: number } | undefined {
  const turns = record.turns ?? []
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.role !== 'player') continue
    return t.applied?.[characterId]
  }
  return undefined
}

/** "+4", "-3" (with a real minus sign) or "0". */
export function signed(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0)
  if (v > 0) return `+${v}`
  if (v < 0) return `−${Math.abs(v)}`
  return '0'
}

/**
 * "Affection +4, trust +1" for the hints line; empty when there is nothing to show. `capped` says
 * the date's gain limit held some of it back: "Affection +1 (this date's limit), trust +1".
 * `floored` says a loss counted toward the date but the meter stopped at 0: "Affection −8 (the
 * meter stops at 0), trust 0".
 */
export function deltaText(applied: { affection: number; trust: number } | undefined, capped = false, floored = false): string {
  if (!applied) return ''
  const note = capped ? " (this date's limit)" : floored && applied.affection < 0 ? ' (the meter stops at 0)' : ''
  return `Affection ${signed(applied.affection)}${note}, trust ${signed(applied.trust)}`
}

/**
 * The date's gain limit held a gain back this turn: the judge's delta (after difficulty) was more
 * than what counted, and the date's gain allowance is used up. `used` is dateGainUsed(session):
 * the larger of the date's net total and the meter's net rise since the date began.
 */
export function gainCapped(wanted: number, applied: number | undefined, used: number, gainCap: number): boolean {
  return applied != null && wanted > 0 && applied < wanted && used >= gainCap
}

// ---------------------------------------------------------------------------
// Status copy


/** What the character is doing, in sentence case. Empty while it's the player's turn. */
export function statusText(status: DateStatus, name: string): string {
  const first = firstName(name)
  switch (status) {
    case 'opening':
      return `${first} is on the way`
    case 'judging':
      return `${first} is thinking`
    case 'replying':
      return `${first} is replying`
    case 'suggesting':
      return 'Thinking of things you could say'
    case 'closing':
      return 'The date is winding down'
    case 'ended':
      return 'The date is over'
    default:
      return ''
  }
}

/** True while the player can't type: the character is arriving, thinking or talking. */
export function inputLocked(status: DateStatus): boolean {
  return status === 'opening' || status === 'judging' || status === 'replying' || status === 'closing' || status === 'ended'
}

/** The composer's placeholder: an invitation on the player's turn, else what's happening. */
export function composerPlaceholder(status: DateStatus, name: string): string {
  if (status === 'awaiting-player' || status === 'suggesting') return `Say something to ${firstName(name)}`
  return statusText(status, name)
}

/** The mood word for the status strip. */
export function moodWord(mood: string | undefined | null): string {
  const m = (mood ?? '').trim().replace(/[.!]+$/, '')
  if (!m || m.toLowerCase() === 'neutral') return m ? 'Neutral' : 'Settling in'
  return m.charAt(0).toUpperCase() + m.slice(1)
}

/** Define the relationship shows from Friend stage (affection 40+). */
export function dtrVisible(affection: number): boolean {
  return stageIndex(stageFor(affection)) >= stageIndex('friend')
}

// ---------------------------------------------------------------------------
// Suggestion chips

const CHIP_LABELS: Record<string, string> = {
  sweet: 'Sweet',
  flirty: 'Flirty',
  bold: 'Bold',
  curious: 'Curious',
  honest: 'Honest',
}

const CHIP_ORDER: Record<Route, readonly string[]> = {
  romantic: ['sweet', 'flirty', 'bold'],
  friend: ['sweet', 'curious', 'honest'],
}

export interface SuggestionChip {
  key: string
  label: string
  text: string
}

/** The chips in route order (sweet, flirty, bold or sweet, curious, honest), empty ones dropped. */
export function suggestionChips(s: Suggestions | null | undefined, route: Route = 'romantic'): SuggestionChip[] {
  if (!s) return []
  const order = CHIP_ORDER[route] ?? CHIP_ORDER.romantic
  const keys = [...order.filter((k) => k in s), ...Object.keys(s).filter((k) => !order.includes(k))]
  return keys
    .map((key) => ({
      key,
      label: CHIP_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1),
      text: String(s[key] ?? '').trim(),
    }))
    .filter((c) => c.text)
    .slice(0, 3)
}

/**
 * What the input holds after tapping a chip. Tapping never sends. An empty input, or one that
 * still holds another chip's line, takes the chip's line; anything the player typed stays, with
 * the chip's line added after it.
 */
export function fillFromChip(current: string, chip: string, chips: readonly string[] = []): string {
  const line = chip.trim()
  const now = current.trim()
  if (!line) return current
  if (!now || now === line || chips.some((c) => c.trim() === now)) return line
  return `${current.trimEnd()} ${line}`
}

// ---------------------------------------------------------------------------
// Transcript

/** Turns worth drawing: non-empty text. */
export function visibleTurns(turns: readonly DateTurn[] | undefined): DateTurn[] {
  return (turns ?? []).filter((t) => (t.text ?? '').trim().length > 0)
}

/** The most recent character line, for the screen reader announcement. */
export function lastCharacterLine(turns: readonly DateTurn[] | undefined): string {
  const list = turns ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'character' && list[i].text.trim()) return list[i].text.replace(/\*+/g, '').trim()
  }
  return ''
}
