// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSettingsStore } from '../store/settings'

const env = vi.hoisted(() => ({
  native: false,
  bound: [] as string[],
  stopped: [] as string[],
}))

vi.mock('./platform', () => ({
  isNative: () => env.native,
  platformName: () => (env.native ? 'android' : 'web'),
  isAndroidApp: () => env.native,
  hasPlugin: () => env.native,
}))

vi.mock('./backButton', () => ({
  bindBackButton: async () => {
    env.bound.push('back')
    return () => env.stopped.push('back')
  },
}))

vi.mock('./keyboard', () => ({
  bindKeyboard: async () => {
    env.bound.push('keyboard')
    return () => env.stopped.push('keyboard')
  },
}))

vi.mock('./statusBar', () => ({
  applySystemBars: async () => {
    env.bound.push('bars')
  },
}))

vi.mock('./updates', () => ({
  checkForUpdate: vi.fn(async () => null),
}))

// A store over no database: loaded by hand, never persisted.
const settings = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createSettingsStore> }))
vi.mock('../store/settings', async (importOriginal) => {
  const real = await importOriginal<typeof import('../store/settings')>()
  return {
    ...real,
    get useSettings() {
      return settings.store
    },
  }
})

import { initPlatform, launchUpdateCheck, resetLaunchCheck } from './init'
import { useUpdateOffer } from './updateOffer'
import type { UpdateInfo } from './updates'

const newer: UpdateInfo = { current: 10, latest: 12, available: true, apkUrl: 'https://example.com/crushlab.apk' }

beforeEach(() => {
  env.native = false
  env.bound = []
  env.stopped = []
  settings.store = createSettingsStore()
  settings.store.setState({ loaded: true, settings: { ...settings.store.getState().settings, ageConfirmed: true } })
  useUpdateOffer.getState().dismiss()
  resetLaunchCheck()
})
afterEach(() => vi.useRealTimers())

describe('initPlatform', () => {
  it('only marks the platform on the web', () => {
    const stop = initPlatform()
    expect(document.documentElement.dataset.platform).toBe('web')
    expect(env.bound).toEqual([])
    stop()
  })

  it('binds the system bars, back button and keyboard in the app, and unbinds them', async () => {
    env.native = true
    settings.store.setState({ settings: { ...settings.store.getState().settings, autoUpdateCheck: false } })
    const stop = initPlatform()
    expect(document.documentElement.dataset.platform).toBe('android')
    await vi.waitFor(() => expect(env.bound).toEqual(expect.arrayContaining(['bars', 'back', 'keyboard'])))
    stop()
    expect(env.stopped.sort()).toEqual(['back', 'keyboard'])
  })

  it('unbinds listeners that arrive after an early cleanup (StrictMode)', async () => {
    env.native = true
    settings.store.setState({ settings: { ...settings.store.getState().settings, autoUpdateCheck: false } })
    const stop = initPlatform()
    stop()
    await vi.waitFor(() => expect(env.stopped.sort()).toEqual(['back', 'keyboard']))
  })
})

describe('launchUpdateCheck', () => {
  it('offers a newer build in the app when the setting is on', async () => {
    env.native = true
    const check = vi.fn(async () => newer)
    expect(await launchUpdateCheck({ delayMs: 0, check })).toEqual(newer)
    expect(check).toHaveBeenCalledTimes(1)
    expect(useUpdateOffer.getState().offer).toEqual(newer)
  })

  it('runs once per launch', async () => {
    env.native = true
    const check = vi.fn(async () => newer)
    await launchUpdateCheck({ delayMs: 0, check })
    await launchUpdateCheck({ delayMs: 0, check })
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the player turned it off', async () => {
    env.native = true
    settings.store.setState({ settings: { ...settings.store.getState().settings, autoUpdateCheck: false } })
    const check = vi.fn(async () => newer)
    expect(await launchUpdateCheck({ delayMs: 0, check })).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('waits until the player is past the age gate (a fresh install is up to date)', async () => {
    env.native = true
    settings.store.setState({ settings: { ...settings.store.getState().settings, ageConfirmed: false } })
    const check = vi.fn(async () => newer)
    expect(await launchUpdateCheck({ delayMs: 0, check })).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('never runs on the web', async () => {
    const check = vi.fn(async () => newer)
    expect(await launchUpdateCheck({ delayMs: 0, check })).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('shows nothing when the app is up to date or the feed is unreachable', async () => {
    env.native = true
    await launchUpdateCheck({ delayMs: 0, check: async () => ({ current: 12, latest: 12, available: false }) })
    expect(useUpdateOffer.getState().offer).toBeNull()
    resetLaunchCheck()
    await launchUpdateCheck({ delayMs: 0, check: async () => null })
    expect(useUpdateOffer.getState().offer).toBeNull()
  })

  it('waits for the settings to load before deciding', async () => {
    env.native = true
    settings.store.setState({ loaded: false })
    const check = vi.fn(async () => newer)
    const pending = launchUpdateCheck({ delayMs: 0, check })
    await Promise.resolve()
    expect(check).not.toHaveBeenCalled()
    settings.store.setState({ loaded: true })
    await pending
    expect(check).toHaveBeenCalledTimes(1)
  })
})
