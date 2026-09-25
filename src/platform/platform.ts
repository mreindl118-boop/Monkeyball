// The only place that asks whether we run inside the Capacitor app (see ARCHITECTURE, Android
// first). Everything else calls these helpers. Safe on the web and in tests: @capacitor/core
// answers 'web' there, and any surprise from it reads as the web.

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

/** True inside the Android app (the APK). */
export function isAndroidApp(): boolean {
  return isNative() && platformName() === 'android'
}

/** True when a native plugin is available in this build (false on the web and in tests). */
export function hasPlugin(name: string): boolean {
  try {
    return isNative() && Capacitor.isPluginAvailable(name)
  } catch {
    return false
  }
}
