import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import styles from './App.module.css'
import { initPlatform } from './platform/init'
import { UpdateNotice } from './platform/UpdateNotice'
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
const Profile = lazy(() => import('./screens/Profile/Profile'))
const CharacterSets = lazy(() => import('./screens/CharacterSets/CharacterSets'))
const Editor = lazy(() => import('./screens/Editor/Editor'))
const Settings = lazy(() => import('./screens/Settings/Settings'))
const Debug = lazy(() => import('./screens/Debug/Debug'))
const DateSetup = lazy(() => import('./screens/DateSetup/DateSetup'))
const DateScreen = lazy(() => import('./screens/DateScreen/DateScreen'))
const Recap = lazy(() => import('./screens/Recap/Recap'))
const PolyculeMap = lazy(() => import('./screens/PolyculeMap/PolyculeMap'))
const Ending = lazy(() => import('./screens/Ending/Ending'))

/** Titles for screens that arrive in later phases. */
const LATER: Partial<Record<ScreenName, string>> = {
  gallery: 'Gallery',
}

let warnedNoStorage = false

/** One toast per session when the browser won't let the app save. */
function warnNoStorage() {
  if (warnedNoStorage) return
  warnedNoStorage = true
  toast("This browser won't let crushLAB save anything, so progress will be lost when you close it.", 'error', 10_000)
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
    case 'profile':
      // Keyed by id so moving between profiles starts each one fresh.
      return <Profile key={view.id} />
    case 'sets':
      return <CharacterSets />
    case 'editor':
      return <Editor />
    case 'settings':
      return <Settings key="settings" />
    case 'debug':
      return <Debug />
    case 'date-setup':
      return <DateSetup key={view.id} />
    case 'date':
      return <DateScreen />
    case 'recap':
      return <Recap key={view.dateId} />
    case 'map':
      return <PolyculeMap />
    case 'ending':
      return <Ending key={view.id} />
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
    // Android app: system bars, back button, keyboard, launch update check. Web: nothing much.
    const stopPlatform = initPlatform()
    let cancelled = false
    let stopWatchingStorage: (() => void) | undefined
    const start = () => {
      if (cancelled) return
      let fromHash: Screen | null = null
      try {
        fromHash = typeof window !== 'undefined' ? hashToScreen(window.location.hash) : null
      } catch {
        fromHash = null
      }
      useNav.getState().reset(fromHash ?? { name: 'hub' })
      setBooted(true)
      consumeFlash()
      if (useSettings.getState().error) warnNoStorage()
      // A date left open when the app closed (the Android app restarts on the hub): open the date
      // screen, which offers its recap. Its own chunk, so the hub doesn't wait for the date engine.
      if (!fromHash || fromHash.name === 'hub') {
        void import('./store/date')
          .then((m) => m.useDate.getState().findInterrupted())
          .then((it) => {
            const { settings, profile } = useSettings.getState()
            const nav = useNav.getState()
            if (!cancelled && it && settings.ageConfirmed && profile && nav.screen.name === 'hub') nav.go({ name: 'date' })
          })
          .catch(() => undefined)
      }
      // Characters (packs and custom cards) and relationship progress load in the background, in
      // their own chunk; screens that show characters wait for them (useRosterAndGame).
      void import('./screens/Hub/useRosterGame')
        .then((m) => {
          if (cancelled) return
          // Their storage failures (a pack too big for the quota) get the same one-time warning.
          stopWatchingStorage = m.watchStorageErrors(warnNoStorage)
          return m.loadRosterAndGame()
        })
        .catch(() => undefined)
    }
    void useSettings
      .getState()
      .load()
      .catch(() => undefined)
      .then(start)
      .catch(() => {
        // Whatever went wrong, never leave the player on the loading screen.
        if (cancelled) return
        if (!useSettings.getState().loaded) useSettings.setState({ loaded: true })
        useNav.getState().reset({ name: 'hub' })
        setBooted(true)
      })
    // Storage that fails later (quota, private mode) gets the same one-time warning.
    const unsub = useSettings.subscribe((s, prev) => {
      if (s.error && !prev.error && s.loaded && prev.loaded) warnNoStorage()
    })
    return () => {
      unsub()
      stopWatchingStorage?.()
      cancelled = true
      unbind()
      stopPlatform()
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
      <UpdateNotice />
      <ToastHost />
    </div>
  )
}
