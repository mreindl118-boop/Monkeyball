// The only place that asks whether we run inside the Capacitor app (see ARCHITECTURE, Android
// first). Everything else calls these helpers.

import { Capacitor } from '@capacitor/core'

/** True inside the Android (or iOS) app, false in a browser or the installed PWA. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** 'android', 'ios' or 'web'. */
export function platformName(): string {
  try {
    return Capacitor.getPlatform()
  } catch {
    return 'web'
  }
}
