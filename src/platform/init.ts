// Platform start-up, called once from App at boot. In the Android app: velvet system bars, the
// back button, the keyboard, and (when the player allows it) a quiet check for a newer APK. On
// the web it marks <html data-platform="web"> and registers the service worker. Safe to call
// twice (React StrictMode): the cleanup undoes the listeners, and the launch update check runs
// once per page load.

import { useSettings } from '../store/settings'
import { bindBackButton } from './backButton'
import { bindKeyboard } from './keyboard'
import { isNative, platformName } from './platform'
import { setupServiceWorker } from './serviceWorker'
import { applySystemBars } from './statusBar'
import { useUpdateOffer } from './updateOffer'
import { checkForUpdate, type UpdateInfo } from './updates'

let launchCheckStarted = false

/** Resolves once the settings store has loaded (right away when it already has). */
function settingsLoaded(): Promise<void> {
  if (useSettings.getState().loaded) return Promise.resolve()
  return new Promise((resolve) => {
    const unsub = useSettings.subscribe((s) => {
      if (!s.loaded) return
      unsub()
      resolve()
    })
  })
}

export interface LaunchCheckOptions {
  /** Wait this long before asking, so the check never competes with start-up. Default 2.5 s. */
  delayMs?: number
  check?: () => Promise<UpdateInfo | null>
}

/**
 * The on-launch update check (APK only, once per page load, only when settings.autoUpdateCheck
 * is on and the player is past the age gate). Raises the update notice when a newer build
 * exists. Never throws.
 */
export async function launchUpdateCheck(opts: LaunchCheckOptions = {}): Promise<UpdateInfo | null> {
  if (launchCheckStarted || !isNative()) return null
  launchCheckStarted = true
  try {
    await settingsLoaded()
    const { settings } = useSettings.getState()
    // A first launch (still at the age gate) is a fresh install: nothing to offer yet.
    if (!settings.autoUpdateCheck || !settings.ageConfirmed) return null
    const delay = opts.delayMs ?? 2500
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    // The player may have switched it off in the meantime.
    if (!useSettings.getState().settings.autoUpdateCheck) return null
    const info = await (opts.check ?? (() => checkForUpdate()))()
    if (info?.available) useUpdateOffer.getState().show(info)
    return info
  } catch {
    return null
  }
}

/** Test hook: allow launchUpdateCheck() to run again. */
export function resetLaunchCheck(): void {
  launchCheckStarted = false
}

/** Wire the app to the platform. Returns a cleanup function. */
export function initPlatform(): () => void {
  if (typeof document !== 'undefined') document.documentElement.dataset.platform = platformName()
  // Web: the offline shell and background updates. App: make sure no service worker runs.
  setupServiceWorker()
  if (!isNative()) return () => {}

  let disposed = false
  const stops: (() => void)[] = []
  const keep = (binding: Promise<() => void>) => {
    binding.then(
      (stop) => {
        if (disposed) stop()
        else stops.push(stop)
      },
      () => undefined,
    )
  }

  void applySystemBars()
  keep(bindBackButton())
  keep(bindKeyboard())
  void launchUpdateCheck()

  return () => {
    disposed = true
    for (const stop of stops.splice(0)) stop()
  }
}
