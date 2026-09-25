// Date memory (docs/SPEC.md, "Date memory"). Pure helpers; the model call itself is made by the
// date flow through its injected llm.
//
// After each date the story model summarizes it in the character's voice and the summary is
// appended to Relationship.memory (oldest first). When the memory passes about 250 words,
// everything older than the last two dates is compressed into one paragraph with the same
// instruction, which becomes entry 0.

import type { ChatMessage } from '../llm/client'
import {
  buildMemoryPrompt,
  makeMemoryCompressionMessages,
  makeMemoryMessages,
  type Overrides,
  type TranscriptLabels,
  type TurnLike,
} from '../prompts/build'
import type { Character } from '../types'

/** Memory longer than this many words gets compressed. */
export const MEMORY_WORD_LIMIT = 250

/** The most recent entries kept word for word when compressing (the last two dates). */
export const MEMORY_KEEP_RECENT = 2

export function wordCount(text: string): number {
  const t = String(text ?? '').trim()
  return t ? t.split(/\s+/).length : 0
}

export function memoryWords(memory: readonly string[]): number {
  return (memory ?? []).reduce((n, m) => n + wordCount(m), 0)
}

/** Tidy a model summary: plain text on one paragraph, no wrapping quotes. Empty stays empty. */
export function cleanSummary(text: string): string {
  return String(text ?? '')
    .replace(/^\s*```\w*\s*|\s*```\s*$/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim()
}

/** Memory with a new summary at the end. An empty summary changes nothing. */
export function appendMemory(memory: readonly string[], summary: string): string[] {
  const s = cleanSummary(summary)
  const list = (memory ?? []).filter((m) => typeof m === 'string' && m.trim())
  return s ? [...list, s] : [...list]
}

/**
 * True when the memory is over the word limit and there is something older than the last two
 * dates to compress.
 */
export function needsCompression(memory: readonly string[], limit: number = MEMORY_WORD_LIMIT): boolean {
  return (memory ?? []).length > MEMORY_KEEP_RECENT && memoryWords(memory) > limit
}

/** The entries to compress (everything older than the last two dates) and the ones to keep. */
export function compressionSplit(memory: readonly string[]): { older: string[]; recent: string[] } {
  const list = [...(memory ?? [])]
  const cut = Math.max(0, list.length - MEMORY_KEEP_RECENT)
  return { older: list.slice(0, cut), recent: list.slice(cut) }
}

/** Replace the older entries with the compressed paragraph. An empty paragraph keeps memory as is. */
export function applyCompression(memory: readonly string[], paragraph: string): string[] {
  const p = cleanSummary(paragraph)
  if (!p) return [...(memory ?? [])]
  const { recent } = compressionSplit(memory)
  return [p, ...recent]
}

/** A memory request: the system prompt (memory template) and the full message list. */
export interface MemoryRequest {
  system: string
  messages: ChatMessage[]
}

/** The summary call for a finished date: the memory prompt, then the transcript. */
export function memoryRequest(
  character: Pick<Character, 'name'>,
  turns: readonly TurnLike[],
  labels: TranscriptLabels & { venue?: string; gift?: string },
  overrides?: Overrides,
): MemoryRequest {
  const system = buildMemoryPrompt({ character }, overrides)
  return { system, messages: makeMemoryMessages(system, turns, labels) }
}

/** The compression call: the same instruction, over every entry older than the last two dates. */
export function compressionRequest(
  character: Pick<Character, 'name'>,
  memory: readonly string[],
  overrides?: Overrides,
): MemoryRequest {
  const system = buildMemoryPrompt({ character }, overrides)
  return { system, messages: makeMemoryCompressionMessages(system, compressionSplit(memory).older) }
}
