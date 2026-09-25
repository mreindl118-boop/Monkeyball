// The order the recap's prints develop in (see RevealFilm.tsx), and remembering which have played.

import { useMemo, useState } from 'react'
import type { DateRecord } from '../../types'
import { filmStates, pendingKeys, type FilmState } from '../../ui/InstantFilm.model'
import { markArtShown, sessionShown, shownFor, type RevealItem } from './revealModel'

export interface RevealQueue {
  stateOf: (key: string) => FilmState
  done: (key: string) => void
  /** True while a print is still to develop. */
  pending: boolean
}

/** Where each print of this recap stands, and a way to mark one developed. */
export function useRevealQueue(record: Pick<DateRecord, 'id' | 'artShown'>, items: readonly RevealItem[]): RevealQueue {
  const keys = useMemo(() => items.map((i) => i.key), [items])
  // What had played before this visit: those stay developed, the rest develop now.
  const [shown] = useState(() => shownFor(record, sessionShown))
  const [current, setCurrent] = useState(0)
  const states = filmStates(keys, shown, current)
  const waiting = pendingKeys(keys, shown)
  return {
    stateOf: (key) => states[keys.indexOf(key)] ?? 'done',
    done: (key) => {
      const i = waiting.indexOf(key)
      if (i < 0) return
      setCurrent((c) => Math.max(c, i + 1))
      void markArtShown(record.id, [key])
    },
    pending: current < waiting.length,
  }
}

