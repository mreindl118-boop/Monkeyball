// The random source for the game's rolls: whether word of a date gets around (gossip), a rekindle,
// a character asking to define the relationship, a rumor passed on, how hard a betrayal lands.
// Every roll in the engine is `rng() < chance`, drawn from the source the date store hands it.
//
// In the app that is Math.random. Dev builds only (`npm run dev`), the debug panel's State tab can
// pin it so a run repeats (scripts/e2e/phase4.mjs does): the setting lives in localStorage under
// DEBUG_ROLLS_KEY and is one of
//   'succeed'  every roll succeeds (the source returns 0)
//   'fail'     every roll fails (the source returns just under 1)
//   a number   a seeded sequence (mulberry32), the same every time the app starts
// Production builds never read it: `import.meta.env.DEV` is false there and the branch is dropped.

/** localStorage key of the dev-only rolls setting. */
export const DEBUG_ROLLS_KEY = 'crushlab.debug.rolls'

export type DebugRolls = { kind: 'random' } | { kind: 'succeed' } | { kind: 'fail' } | { kind: 'seed'; seed: number }

/** Read the stored text: blank or unknown means random. */
export function parseDebugRolls(raw: string | null | undefined): DebugRolls {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s === 'succeed' || s === 'always') return { kind: 'succeed' }
  if (s === 'fail' || s === 'never') return { kind: 'fail' }
  if (/^-?\d+$/.test(s)) return { kind: 'seed', seed: Number(s) >>> 0 }
  return { kind: 'random' }
}

/** A small seeded generator (mulberry32): the same seed gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The source for a setting. */
export function rollsSource(rolls: DebugRolls, random: () => number = Math.random): () => number {
  switch (rolls.kind) {
    case 'succeed':
      return () => 0
    case 'fail':
      return () => 0.999999
    case 'seed':
      return seededRandom(rolls.seed)
    default:
      return random
  }
}

/** Dev builds: the stored setting (random when storage can't be read). */
export function readDebugRolls(): DebugRolls {
  try {
    return parseDebugRolls(globalThis.localStorage?.getItem(DEBUG_ROLLS_KEY))
  } catch {
    return { kind: 'random' }
  }
}

/** Dev builds: store the setting (blank clears it). Never throws. */
export function writeDebugRolls(raw: string): void {
  try {
    const s = raw.trim()
    if (s) globalThis.localStorage?.setItem(DEBUG_ROLLS_KEY, s)
    else globalThis.localStorage?.removeItem(DEBUG_ROLLS_KEY)
  } catch {
    // Private mode or no storage: the rolls stay random.
  }
}

let current: { raw: string; next: () => number } | null = null

/**
 * The app's random source (the date store's default). Math.random in production; in dev builds it
 * follows the debug setting, picked up again whenever the setting changes (a seed restarts its
 * sequence then).
 */
export function appRandom(): number {
  if (!import.meta.env.DEV) return Math.random()
  let raw = ''
  try {
    raw = globalThis.localStorage?.getItem(DEBUG_ROLLS_KEY) ?? ''
  } catch {
    raw = ''
  }
  if (!current || current.raw !== raw) current = { raw, next: rollsSource(parseDebugRolls(raw)) }
  return current.next()
}
