// The Android back button (and back gesture). Order: close the top sheet or dialog if one is
// open; else go back one screen through useNav (the same path as in-app Back); at a root screen
// with nothing to go back to, minimize the app instead of closing it (ARCHITECTURE, Android first).

import { useNav, type ScreenName } from '../store/nav'
import { closeTopOverlay } from './overlays'
import { isNative } from './platform'

export type BackAction = 'overlay' | 'nav' | 'minimize'

/** Screens that are the bottom of the app: back from here leaves the app. */
const ROOTS: ReadonlySet<ScreenName> = new Set<ScreenName>(['hub', 'gate', 'onboarding'])

/**
 * Handle one back press. `minimize` sends the app to the background (App.minimizeApp in the
 * APK). Returns what happened, for tests and callers that care.
 */
export function handleBack(minimize: () => void): BackAction {
  if (closeTopOverlay()) return 'overlay'
  const { screen, stack, back } = useNav.getState()
  if (stack.length === 0 && ROOTS.has(screen.name)) {
    minimize()
    return 'minimize'
  }
  back()
  return 'nav'
}

/**
 * Take over the hardware back button in the app. Returns a function that gives it back.
 * A no-op on the web, where the browser's back button drives history (and useNav follows it).
 */
export async function bindBackButton(): Promise<() => void> {
  if (!isNative()) return () => {}
  const { App } = await import('@capacitor/app')
  const minimize = () => {
    App.minimizeApp().catch(() => {
      // Older shells without minimizeApp: leave the app instead of doing nothing.
      void App.exitApp().catch(() => undefined)
    })
  }
  const handle = await App.addListener('backButton', () => {
    handleBack(minimize)
  })
  return () => {
    void handle.remove()
  }
}
