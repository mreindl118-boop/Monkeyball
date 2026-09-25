// System bars in the Android app: light icons on velvet. capacitor.config.ts sets the same at
// startup; this re-applies it once the page runs (after a theme change the native side may have
// reset it) and paints the status bar velvet on Android 14 and older, where that still works.

import { SystemBars, SystemBarsStyle } from '@capacitor/core'
import { hasPlugin, isAndroidApp, isNative } from './platform'

export const VELVET = '#2A0F1F'

/** Light status and navigation bar icons, velvet bar where Android allows a color. Never throws. */
export async function applySystemBars(): Promise<void> {
  if (!isNative()) return
  await SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => undefined)
  if (!hasPlugin('StatusBar')) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined)
    // Android 15+ ignores this (edge to edge): the bar is transparent over the velvet page.
    if (isAndroidApp()) await StatusBar.setBackgroundColor({ color: VELVET }).catch(() => undefined)
  } catch {
    // Plugin missing in this shell; the config's defaults stand.
  }
}
