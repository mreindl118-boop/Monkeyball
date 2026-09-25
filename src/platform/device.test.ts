// @vitest-environment jsdom
// Haptics, system bars and the keyboard: silent no-ops on the web, wired to the plugins in the app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
  native: false,
  impact: vi.fn(async () => {}),
  notification: vi.fn(async () => {}),
  systemBarsStyle: vi.fn(async () => {}),
  statusBarStyle: vi.fn(async () => {}),
  statusBarColor: vi.fn(async () => {}),
  keyboard: new Map<string, () => void>(),
}))

vi.mock('./platform', () => ({
  isNative: () => env.native,
  platformName: () => (env.native ? 'android' : 'web'),
  isAndroidApp: () => env.native,
  hasPlugin: () => env.native,
}))

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: env.impact, notification: env.notification },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Success: 'SUCCESS' },
}))

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  SystemBars: { setStyle: env.systemBarsStyle },
}))

vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle: env.statusBarStyle, setBackgroundColor: env.statusBarColor },
  Style: { Dark: 'DARK' },
}))

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: vi.fn(async (event: string, fn: () => void) => {
      env.keyboard.set(event, fn)
      return { remove: async () => env.keyboard.delete(event) }
    }),
  },
}))

import { success, tap } from './haptics'
import { bindKeyboard } from './keyboard'
import { applySystemBars, VELVET } from './statusBar'

beforeEach(() => {
  env.native = false
  env.keyboard.clear()
  for (const f of [env.impact, env.notification, env.systemBarsStyle, env.statusBarStyle, env.statusBarColor]) f.mockClear()
})
afterEach(() => {
  delete document.documentElement.dataset.keyboard
})

describe('on the web', () => {
  it('does nothing and never throws', async () => {
    await expect(tap()).resolves.toBeUndefined()
    await expect(success()).resolves.toBeUndefined()
    await expect(applySystemBars()).resolves.toBeUndefined()
    const stop = await bindKeyboard()
    stop()
    expect(env.impact).not.toHaveBeenCalled()
    expect(env.notification).not.toHaveBeenCalled()
    expect(env.systemBarsStyle).not.toHaveBeenCalled()
    expect(env.keyboard.size).toBe(0)
  })
})

describe('in the Android app', () => {
  beforeEach(() => {
    env.native = true
  })

  it('taps lightly and buzzes on success', async () => {
    await tap()
    await success()
    expect(env.impact).toHaveBeenCalledWith({ style: 'LIGHT' })
    expect(env.notification).toHaveBeenCalledWith({ type: 'SUCCESS' })
  })

  it('swallows a phone without a vibrator', async () => {
    env.impact.mockRejectedValueOnce(new Error('no vibrator'))
    await expect(tap()).resolves.toBeUndefined()
  })

  it('sets light icons on velvet bars', async () => {
    await applySystemBars()
    expect(env.systemBarsStyle).toHaveBeenCalledWith({ style: 'DARK' })
    expect(env.statusBarStyle).toHaveBeenCalledWith({ style: 'DARK' })
    expect(env.statusBarColor).toHaveBeenCalledWith({ color: VELVET })
  })

  it('keeps the focused field in view when the keyboard opens', async () => {
    const stop = await bindKeyboard()
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    input.focus()
    const scrolled = vi.fn()
    input.scrollIntoView = scrolled

    env.keyboard.get('keyboardDidShow')?.()
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    expect(document.documentElement.dataset.keyboard).toBe('open')

    env.keyboard.get('keyboardWillHide')?.()
    expect(document.documentElement.dataset.keyboard).toBeUndefined()

    stop()
    await vi.waitFor(() => expect(env.keyboard.size).toBe(0))
    input.remove()
  })
})
