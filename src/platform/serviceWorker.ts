// The service worker (vite-plugin-pwa's generated sw.js) is for the web app and the installed PWA:
// an offline shell (the app's HTML, JS, CSS, fonts and icons are precached on the first visit),
// and new versions downloaded in the background. Model and image calls always go to the network.
// A new version waits until the player says so: "A new version is ready" with Reload, which tells
// the waiting worker to take over and reloads once it has.
//
// The Android app doesn't use one. The APK already serves every file from its own assets, and a
// service worker there would keep serving the previous build's cached bundle on the first launch
// after each upgrade (with the old build number, so the update check would offer the build that is
// already installed). CI replaces the APK's sw.js with a kill switch (scripts/android/sw.js) for
// installs that still have a worker from builds 24 and 25. vite.config.ts turns off the plugin's
// own registration script so this module decides.

import { toast } from '../ui/toastStore'
import { isNative } from './platform'

/** What the player is told when a new version has downloaded. */
export const UPDATE_READY_TEXT = 'A new version is ready.'

/** How often an open tab asks for a newer sw.js (also on every return to the tab). */
const UPDATE_CHECK_MS = 60 * 60 * 1000

/** Reload even if the new worker never reports taking over (a browser quirk shouldn't strand the player). */
const RELOAD_FALLBACK_MS = 4000

export interface ServiceWorkerOptions {
  /**
   * Called once per page load when a new version is waiting. `apply` activates it and reloads the
   * page. Default: a toast with a Reload button that stays until dismissed.
   */
  onUpdate?: (apply: () => void) => void
  /** Test hook: how to reload the page. */
  reload?: () => void
}

function defaultOnUpdate(apply: () => void): void {
  toast(UPDATE_READY_TEXT, 'info', 0, { label: 'Reload', run: apply })
}

/**
 * Web: register ./sw.js once the page has loaded (production builds only; the dev server has no
 * sw.js) and offer new versions. Android app: remove any registration left by an earlier build.
 * Never throws.
 */
export function setupServiceWorker(opts: ServiceWorkerOptions = {}): void {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const sw = navigator.serviceWorker
    if (isNative()) {
      void sw
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => undefined)
      return
    }
    if (import.meta.env.DEV || typeof window === 'undefined') return
    const register = () => {
      sw.register('./sw.js', { scope: './' })
        .then((reg) => watchForUpdates(sw, reg, opts))
        .catch(() => undefined)
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  } catch {
    // A browser that refuses service workers (private mode, file://) just runs without one.
  }
}

/**
 * Offer a waiting worker (there already, or installed later) once. A worker that finishes
 * installing while no worker controls the page is the first install, not an update: nothing to
 * offer, the page already runs the newest files.
 */
export function watchForUpdates(
  sw: ServiceWorkerContainer,
  reg: ServiceWorkerRegistration,
  opts: ServiceWorkerOptions = {},
): void {
  const onUpdate = opts.onUpdate ?? defaultOnUpdate
  const reload = opts.reload ?? (() => window.location.reload())
  let offered = false
  let accepted = false
  let reloaded = false

  const reloadOnce = () => {
    if (reloaded) return
    reloaded = true
    reload()
  }

  // Only a takeover the player asked for reloads the page (the first install claiming the page
  // must not).
  sw.addEventListener('controllerchange', () => {
    if (accepted) reloadOnce()
  })

  const offer = (worker: ServiceWorker) => {
    if (offered) return
    offered = true
    onUpdate(() => {
      accepted = true
      try {
        worker.postMessage({ type: 'SKIP_WAITING' })
      } catch {
        // The worker went away: a plain reload still picks up whatever is current.
      }
      setTimeout(reloadOnce, RELOAD_FALLBACK_MS)
    })
  }

  if (reg.waiting && sw.controller) offer(reg.waiting)

  reg.addEventListener('updatefound', () => {
    const worker = reg.installing
    if (!worker) return
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && sw.controller) offer(worker)
    })
  })

  // Tabs and installed PWAs can stay open for days: look for a new version now and then.
  const check = () => {
    reg.update().catch(() => undefined)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  }
  setInterval(check, UPDATE_CHECK_MS)
}
