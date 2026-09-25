import { create } from 'zustand'

/** Every screen in the app. Params are kept minimal so a hash reload can rebuild them. */
export type Screen =
  | { name: 'gate' }
  | { name: 'onboarding' }
  | { name: 'connection-setup' }
  | { name: 'hub' }
  | { name: 'profile'; id: string }
  | { name: 'date-setup'; id: string; group?: boolean }
  | { name: 'date' }
  | { name: 'recap'; dateId: number }
  | { name: 'gallery'; id?: string }
  | { name: 'map' }
  | { name: 'sets' }
  | { name: 'settings'; section?: string }
  | { name: 'editor'; id?: string }
  | { name: 'ending'; id: string }
  | { name: 'debug' }

export type ScreenName = Screen['name']

/** Serialize a screen to a hash path, e.g. `#/profile/nova`. */
export function screenToHash(s: Screen): string {
  switch (s.name) {
    case 'profile':
    case 'ending':
      return `#/${s.name}/${encodeURIComponent(s.id)}`
    case 'date-setup':
      return `#/date-setup/${encodeURIComponent(s.id)}${s.group ? '/group' : ''}`
    case 'recap':
      return `#/recap/${s.dateId}`
    case 'gallery':
      return s.id ? `#/gallery/${encodeURIComponent(s.id)}` : '#/gallery'
    case 'settings':
      return s.section ? `#/settings/${encodeURIComponent(s.section)}` : '#/settings'
    case 'editor':
      return s.id ? `#/editor/${encodeURIComponent(s.id)}` : '#/editor'
    default:
      return `#/${s.name}`
  }
}

function decodePart(part: string): string | null {
  try {
    return decodeURIComponent(part)
  } catch {
    return null
  }
}

/** Parse a hash path back into a screen. Unknown or malformed paths return null. */
export function hashToScreen(hash: string): Screen | null {
  const raw = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodePart)
  if (raw.some((p) => p === null)) return null
  const [name, a, b] = raw as string[]
  switch (name) {
    case undefined:
      return null
    case 'gate':
    case 'onboarding':
    case 'connection-setup':
    case 'hub':
    case 'date':
    case 'map':
    case 'sets':
    case 'debug':
      return { name }
    case 'profile':
    case 'ending':
      return a ? { name, id: a } : null
    case 'date-setup':
      return a ? { name, id: a, group: b === 'group' } : null
    case 'recap': {
      const n = Number(a)
      return a && Number.isFinite(n) ? { name, dateId: n } : null
    }
    case 'gallery':
      return a ? { name, id: a } : { name }
    case 'settings':
      return a ? { name, section: a } : { name }
    case 'editor':
      return a ? { name, id: a } : { name }
    default:
      return null
  }
}

interface NavState {
  screen: Screen
  stack: Screen[]
  /** Push a screen (and a browser history entry). */
  go: (s: Screen) => void
  /** Replace the current screen without growing the stack. */
  replace: (s: Screen) => void
  /**
   * Pop back. In a browser this walks browser history back one entry and the popstate handler
   * updates the store, so in-app Back and the system back button share one code path. With an
   * empty stack (first screen, or after a reload) it replaces the current screen with the hub.
   */
  back: () => void
  /** Reset the stack to a single screen, unwinding the history entries this stack pushed. */
  reset: (s: Screen) => void
}

/** What every history entry the app writes carries, so popstate can tell back from forward. */
interface HistoryMark {
  crush: true
  idx: number
}

function markOf(state: unknown): HistoryMark | null {
  if (!state || typeof state !== 'object') return null
  const m = state as Partial<HistoryMark>
  return m.crush === true && typeof m.idx === 'number' && Number.isInteger(m.idx) && m.idx >= 0
    ? (m as HistoryMark)
    : null
}

const hasWindow = () => typeof window !== 'undefined' && typeof window.history !== 'undefined'

/** History index of the current entry, counted from the first entry this tab gave the app. */
let historyIdx = hasWindow() ? (markOf(window.history.state)?.idx ?? 0) : 0

/**
 * A reset waiting for its history.go(-n) to land on entry `idx`. The store already shows the
 * result; `entries` is what history should hold from `idx` on once it lands (the reset target,
 * then anything pushed meanwhile).
 */
let pending: { idx: number; entries: Screen[]; timer: ReturnType<typeof setTimeout> } | null = null

function mark(idx: number): HistoryMark {
  return { crush: true, idx }
}

function writeHash(s: Screen, mode: 'push' | 'replace') {
  if (!hasWindow()) return
  if (pending) {
    // History is mid-traversal; record the entry and write it once the traversal lands.
    if (mode === 'push') pending.entries.push(s)
    else pending.entries[pending.entries.length - 1] = s
    return
  }
  const hash = screenToHash(s)
  if (mode === 'push') {
    historyIdx += 1
    window.history.pushState(mark(historyIdx), '', hash)
  } else {
    window.history.replaceState(mark(historyIdx), '', hash)
  }
}

/** Write the entries a pending reset collected, starting at the entry it landed on. */
function flushPending() {
  if (!pending) return
  const { idx, entries, timer } = pending
  clearTimeout(timer)
  pending = null
  historyIdx = idx
  entries.forEach((s, i) => writeHash(s, i === 0 ? 'replace' : 'push'))
}

const HUB: Screen = { name: 'hub' }

export const useNav = create<NavState>((set, get) => ({
  screen: HUB,
  stack: [],
  go: (s) => {
    const { screen, stack } = get()
    // Going to the screen we're on is a replace: the stack and history stay one entry per push.
    if (screenToHash(s) === screenToHash(screen)) {
      set({ screen: s })
      writeHash(s, 'replace')
      return
    }
    set({ stack: [...stack, screen], screen: s })
    writeHash(s, 'push')
    if (typeof window !== 'undefined') window.scrollTo?.(0, 0)
  },
  replace: (s) => {
    set({ screen: s })
    writeHash(s, 'replace')
  },
  back: () => {
    const stack = get().stack
    if (stack.length > 0 && hasWindow() && historyIdx > 0 && !pending) {
      // The entry behind this one is the screen on top of the stack; popstate does the rest.
      window.history.back()
      return
    }
    const prev = stack[stack.length - 1] ?? HUB
    set({ stack: stack.slice(0, -1), screen: prev })
    if (pending && pending.entries.length > 1) {
      pending.entries.pop()
      pending.entries[pending.entries.length - 1] = prev
    } else {
      writeHash(prev, 'replace')
    }
  },
  reset: (s) => {
    const n = get().stack.length
    set({ stack: [], screen: s })
    if (!hasWindow()) return
    if (pending) {
      pending.entries = [s]
      return
    }
    if (n > 0 && historyIdx - n >= 0) {
      // Drop the entries this stack pushed, then rewrite the one we land on.
      pending = {
        idx: historyIdx - n,
        entries: [s],
        // If the traversal never reports back, write the entries where we are.
        timer: setTimeout(() => {
          if (pending) pending.idx = historyIdx
          flushPending()
        }, 1500),
      }
      window.history.go(-n)
      return
    }
    writeHash(s, 'replace')
  },
}))

/**
 * Keep the store in sync with browser back/forward (and in-app Back, which goes through
 * history). Call once at boot. Entries carry `{ crush, idx }`: a lower idx is a back move (pop
 * the stack), a higher one is forward (push). An entry without a mark is a hash typed or set by
 * hand: a new forward step, which gets marked.
 */
export function bindHistory(): () => void {
  const onPop = (e: PopStateEvent) => {
    const entry = markOf(e.state)
    const { screen, stack } = useNav.getState()

    if (pending) {
      // The traversal a reset started has landed: the store is already right, fix up history.
      if (entry && entry.idx === pending.idx) {
        flushPending()
        return
      }
      // Something else moved history first; follow it and drop the reset's bookkeeping.
      clearTimeout(pending.timer)
      pending = null
    }

    const parsed = hashToScreen(window.location.hash)
    const next = parsed ?? HUB

    if (!entry) {
      // A new entry we didn't write (hash edited by hand): a forward step.
      historyIdx += 1
      useNav.setState({ screen: next, stack: [...stack, screen] })
      writeHash(next, 'replace')
      return
    }

    const delta = entry.idx - historyIdx
    historyIdx = entry.idx
    if (delta < 0) {
      useNav.setState({ screen: next, stack: stack.slice(0, Math.max(0, stack.length + delta)) })
    } else if (delta > 0) {
      useNav.setState({ screen: next, stack: [...stack, screen] })
    } else {
      useNav.setState({ screen: next })
    }
    if (!parsed) writeHash(next, 'replace')
  }
  window.addEventListener('popstate', onPop)
  return () => window.removeEventListener('popstate', onPop)
}
