import { create } from 'zustand'
import type { DebugEntry } from '../types'

export type DebugKind = DebugEntry['kind']

/** What callers pass to `log`: id and timestamp are filled in when missing. */
export type DebugInput = Omit<DebugEntry, 'id' | 'at'> & { id?: string; at?: number }

/** Ring buffer size. */
export const DEBUG_LIMIT = 200

interface DebugState {
  /** Oldest first, at most DEBUG_LIMIT entries. */
  entries: DebugEntry[]
  /** The most recent entry per kind (the last assembled prompt for story, judge, ...). */
  lastByKind: Partial<Record<DebugKind, DebugEntry>>
  /** Add an entry; returns its id. */
  log: (entry: DebugInput) => string
  /** Update an entry in place (e.g. add the response once a streamed call finishes). */
  patch: (id: string, patch: Partial<Omit<DebugEntry, 'id' | 'kind'>>) => void
  clear: () => void
}

let seq = 0
function newId(): string {
  seq += 1
  return `${Date.now().toString(36)}-${seq.toString(36)}`
}

/** In-memory debug log for every LLM and image call. Never persisted. */
export const useDebug = create<DebugState>((set, get) => ({
  entries: [],
  lastByKind: {},
  log: (input) => {
    const entry: DebugEntry = { ...input, id: input.id ?? newId(), at: input.at ?? Date.now() }
    const entries = [...get().entries, entry]
    if (entries.length > DEBUG_LIMIT) entries.splice(0, entries.length - DEBUG_LIMIT)
    set({ entries, lastByKind: { ...get().lastByKind, [entry.kind]: entry } })
    return entry.id
  },
  patch: (id, patch) => {
    const { entries, lastByKind } = get()
    const i = entries.findIndex((e) => e.id === id)
    if (i < 0) return
    const next: DebugEntry = { ...entries[i], ...patch, id, kind: entries[i].kind }
    const copy = entries.slice()
    copy[i] = next
    const isLast = lastByKind[next.kind]?.id === id
    set({ entries: copy, lastByKind: isLast ? { ...lastByKind, [next.kind]: next } : lastByKind })
  },
  clear: () => set({ entries: [], lastByKind: {} }),
}))
