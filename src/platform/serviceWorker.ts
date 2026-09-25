// The service worker (vite-plugin-pwa's generated sw.js) is for the web app and the installed PWA:
// an offline shell, and new versions downloaded in the background. The Android app doesn't use
// one. The APK already serves every file from its own assets, and a service worker there would
// keep serving the previous build's cached bundle on the first launch after each upgrade (with
// the old build number, so the update check would offer the build that is already installed).
// vite.config.ts turns off the plugin's own registration script so this module decides.

import { isNative } from './platform'

/**
 * Web: register ./sw.js once the page has loaded (production builds only; the dev server has no
 * sw.js). Android app: remove any registration left by an earlier build. Never throws.
 */
export function setupServiceWorker(): void {
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
      sw.register('./sw.js', { scope: './' }).catch(() => undefined)
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  } catch {
    // A browser that refuses service workers (private mode, file://) just runs without one.
  }
}
