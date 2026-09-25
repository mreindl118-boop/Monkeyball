import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import styles from './App.module.css'
import { bindHistory, hashToScreen, screenToHash, useNav, type Screen, type ScreenName } from './store/nav'
import { useSettings } from './store/settings'
import { NotBuilt } from './ui/NotBuilt'
import { ToastHost } from './ui/Toast'
import { consumeFlash, toast } from './ui/toastStore'
import { Wordmark } from './ui/Wordmark'
import Gate from './screens/Gate/Gate'

const Onboarding = lazy(() => import('./screens/Onboarding/Onboarding'))
const ConnectionSetup = lazy(() => import('./screens/ConnectionSetup/ConnectionSetup'))
const Hub = lazy(() => import('./screens/Hub/Hub'))
const Settings = lazy(() => import('./screens/Settings/Settings'))
const Debug = lazy(() => import('./screens/Debug/Debug'))

/** Titles for screens that arrive in later phases. */
const LATER: Partial<Record<ScreenName, string>> = {
  profile: 'Profile',
  'date-setup': 'Date setup',
  date: 'Date',
  recap: 'Recap',
  gallery: 'Gallery',
  map: 'Polycule map',
  sets: 'Character sets',
  editor: 'Character editor',
  ending: 'Ending',
}

/** Screen-level accent (character screens set their own accent inline). */
const ACCENTS: Partial<Record<ScreenName, string>> = {
  debug: 'var(--brass)',
}

/**
 * The first-launch flow wins over whatever the hash asks for: no age confirmation shows only the
 * gate, no profile shows only onboarding. Once both exist, gate and onboarding go to the hub.
 */
function resolveScreen(
  requested: Screen,
  ageConfirmed: boolean,
  hasProfile: boolean,
): Screen {
  if (!ageConfirmed) return { name: 'gate' }
  if (!hasProfile) return { name: 'onboarding' }
  if (requested.name === 'gate' || requested.name === 'onboarding') return { name: 'hub' }
  return requested
}

function Loading({ text = 'Opening the doors' }: { text?: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <Wordmark size={44} />
      <p className={styles.loadingText}>{text}</p>
    </div>
  )
}

function renderScreen(view: Screen, back: () => void, toHub: () => void): ReactNode {
  switch (view.name) {
    case 'gate':
      return <Gate />
    case 'onboarding':
      return <Onboarding />
    case 'connection-setup':
      return <ConnectionSetup />
    case 'hub':
      return <Hub />
    case 'settings':
      return <Settings key="settings" />
    case 'debug':
      return <Debug />
    default:
      return <NotBuilt what={LATER[view.name]} onBack={back} onHub={toHub} />
  }
}

export default function App() {
  const loaded = useSettings((s) => s.loaded)
  const ageConfirmed = useSettings((s) => s.settings.ageConfirmed)
  const hasProfile = useSettings((s) => s.profile !== null)
  const screen = useNav((s) => s.screen)
  const back = useNav((s) => s.back)
  const reset = useNav((s) => s.reset)
  const [booted, setBooted] = useState(false)

  // Boot: load settings and profile, follow browser history, restore the screen from the hash.
  useEffect(() => {
    const unbind = bindHistory()
    let cancelled = false
    void useSettings
      .getState()
      .load()
      .then(() => {
        if (cancelled) return
        const fromHash = typeof window !== 'undefined' ? hashToScreen(window.location.hash) : null
        useNav.getState().reset(fromHash ?? { name: 'hub' })
        setBooted(true)
        consumeFlash()
        const error = useSettings.getState().error
        if (error) {
          toast("This browser won't let crushLAB save anything, so progress will be lost when you close it.", 'error', 10_000)
        }
      })
    return () => {
      cancelled = true
      unbind()
    }
  }, [])

  const view = resolveScreen(screen, ageConfirmed, hasProfile)
  const forced = screenToHash(view) !== screenToHash(screen)

  // Keep the URL honest when the flow overrides the requested screen (hash navigation can't skip it).
  useEffect(() => {
    if (booted && forced) useNav.getState().replace(view)
  }, [booted, forced, view])

  if (!loaded || !booted) {
    return (
      <>
        <Loading />
        <ToastHost />
      </>
    )
  }

  const accent = ACCENTS[view.name]
  return (
    <div
      className={styles.stage}
      data-screen={view.name}
      style={accent ? ({ '--accent': accent } as CSSProperties) : undefined}
    >
      <Suspense fallback={<Loading text="One moment" />}>
        {renderScreen(view, back, () => reset({ name: 'hub' }))}
      </Suspense>
      <ToastHost />
    </div>
  )
}
