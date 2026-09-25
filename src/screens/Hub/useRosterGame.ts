// Screens that show characters load the roster (packs and custom characters from Dexie) and the
// relationship state on first use. Both stores keep working in memory when storage fails, so this
// never blocks for long: after a few seconds the screen renders with whatever is there.

import { useEffect, useState } from 'react'
import { useGame } from '../../store/game'
import { useRoster } from '../../store/roster'

const GIVE_UP_MS = 5000

/** Start loading both stores. Safe to call any number of times. */
export function loadRosterAndGame(): Promise<void> {
  return Promise.all([
    useRoster.getState().load().catch(() => undefined),
    useGame.getState().load().catch(() => undefined),
  ]).then(() => undefined)
}

/**
 * Calls onError when either store records a storage failure (a quota error on a save or an
 * import, no IndexedDB at all), and right away if one already has. Returns an unsubscribe.
 */
export function watchStorageErrors(onError: () => void): () => void {
  const offRoster = useRoster.subscribe((s, prev) => {
    if (s.error && !prev.error) onError()
  })
  const offGame = useGame.subscribe((s, prev) => {
    if (s.error && !prev.error) onError()
  })
  if (useRoster.getState().error || useGame.getState().error) onError()
  return () => {
    offRoster()
    offGame()
  }
}

/** The roster with packs and custom characters loaded (before an import checks ids against it). */
export function ensureRoster(): Promise<void> {
  return useRoster.getState().load().catch(() => undefined)
}

/** Loads the roster and game stores; true once both are ready (or loading gave up). */
export function useRosterAndGame(): boolean {
  const rosterLoaded = useRoster((s) => s.loaded)
  const gameLoaded = useGame((s) => s.loaded)
  const [gaveUp, setGaveUp] = useState(false)
  const ready = rosterLoaded && gameLoaded

  useEffect(() => {
    void loadRosterAndGame()
  }, [])

  useEffect(() => {
    if (ready) return
    const t = setTimeout(() => setGaveUp(true), GIVE_UP_MS)
    return () => clearTimeout(t)
  }, [ready])

  return ready || gaveUp
}
