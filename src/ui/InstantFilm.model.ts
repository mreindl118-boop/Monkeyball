// Timing and queue helpers for the instant-film unlock reveal (src/ui/InstantFilm.tsx). Pure.

/** How long a print takes to develop (docs/SPEC.md, Design: the one orchestrated motion moment). */
export const DEVELOP_MS = 2500

/** prefers-reduced-motion: the print simply fades in. */
export const FADE_MS = 400

export type FilmState = 'waiting' | 'developing' | 'done'

/** How long the reveal runs for this player. */
export function revealDuration(reducedMotion: boolean): number {
  return reducedMotion ? FADE_MS : DEVELOP_MS
}

/**
 * Where each print in a reveal queue stands. Prints already shown (on an earlier visit) stay
 * developed; the rest develop one after another, in order: those before `current` are done, the
 * one at `current` develops (once it's on screen), the ones after it wait.
 */
export function filmStates(keys: readonly string[], shown: ReadonlySet<string>, current: number): FilmState[] {
  let pending = 0
  return keys.map((key) => {
    if (shown.has(key)) return 'done'
    const i = pending++
    if (i < current) return 'done'
    return i === current ? 'developing' : 'waiting'
  })
}

/** Keys of the prints that haven't been shown yet, in order. */
export function pendingKeys(keys: readonly string[], shown: ReadonlySet<string>): string[] {
  return keys.filter((k) => !shown.has(k))
}
