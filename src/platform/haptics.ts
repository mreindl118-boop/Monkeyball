// Light haptics in the Android app (stamp presses, unlocks). No-ops on the web and in tests, and
// never throw: a phone without a vibrator, or an older shell without the plugin, just stays still.

import { hasPlugin, isNative } from './platform'

type HapticsModule = typeof import('@capacitor/haptics')

let loading: Promise<HapticsModule | null> | null = null

function haptics(): Promise<HapticsModule | null> {
  if (!isNative() || !hasPlugin('Haptics')) return Promise.resolve(null)
  loading ??= import('@capacitor/haptics').catch(() => null)
  return loading
}

/** A light tap: buttons that stamp, toggles, long-press confirmations. */
export async function tap(): Promise<void> {
  try {
    const m = await haptics()
    await m?.Haptics.impact({ style: m.ImpactStyle.Light })
  } catch {
    // No haptics here.
  }
}

/** A short success pattern: an unlock, a tier reached. */
export async function success(): Promise<void> {
  try {
    const m = await haptics()
    await m?.Haptics.notification({ type: m.NotificationType.Success })
  } catch {
    // No haptics here.
  }
}
