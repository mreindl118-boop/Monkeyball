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

/** Parse a hash path back into a screen. Unknown paths return null. */
export function hashToScreen(hash: string): Screen | null {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [name, a, b] = parts
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
      return Number.isFinite(n) ? { name, dateId: n } : null
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
  /** Push a screen. */
  go: (s: Screen) => void
  /** Replace the current screen without growing the stack. */
  replace: (s: Screen) => void
  /** Pop back; falls back to the hub. */
  back: () => void
  /** Reset the stack to a single screen. */
  reset: (s: Screen) => void
}

function writeHash(s: Screen, mode: 'push' | 'replace') {
  if (typeof window === 'undefined') return
  const hash = screenToHash(s)
  if (window.location.hash === hash) return
  if (mode === 'push') window.history.pushState({ crush: true }, '', hash)
  else window.history.replaceState({ crush: true }, '', hash)
}

export const useNav = create<NavState>((set, get) => ({
  screen: { name: 'hub' },
  stack: [],
  go: (s) => {
    set({ stack: [...get().stack, get().screen], screen: s })
    writeHash(s, 'push')
    if (typeof window !== 'undefined') window.scrollTo(0, 0)
  },
  replace: (s) => {
    set({ screen: s })
    writeHash(s, 'replace')
  },
  back: () => {
    const stack = get().stack
    const prev = stack[stack.length - 1] ?? { name: 'hub' as const }
    set({ stack: stack.slice(0, -1), screen: prev })
    writeHash(prev, 'replace')
  },
  reset: (s) => {
    set({ stack: [], screen: s })
    writeHash(s, 'replace')
  },
}))

/** Keep the store in sync with browser back/forward. Call once at boot. */
export function bindHistory(): () => void {
  const onPop = () => {
    const s = hashToScreen(window.location.hash)
    if (!s) return
    const { stack } = useNav.getState()
    useNav.setState({ screen: s, stack: stack.slice(0, -1) })
  }
  window.addEventListener('popstate', onPop)
  return () => window.removeEventListener('popstate', onPop)
}
