// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNav } from '../store/nav'
import { Sheet } from '../ui/Sheet'

const env = vi.hoisted(() => ({
  native: false,
  listeners: new Map<string, () => void>(),
  minimizeApp: vi.fn(async () => {}),
  exitApp: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}))

vi.mock('./platform', () => ({
  isNative: () => env.native,
  platformName: () => (env.native ? 'android' : 'web'),
  isAndroidApp: () => env.native,
  hasPlugin: () => env.native,
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (event: string, fn: () => void) => {
      env.listeners.set(event, fn)
      return { remove: env.remove }
    }),
    minimizeApp: env.minimizeApp,
    exitApp: env.exitApp,
  },
}))

import { bindBackButton, handleBack } from './backButton'
import { closeTopOverlay, hasOpenOverlay, pushOverlay } from './overlays'

const realBack = useNav.getState().back

function at(screen: Partial<ReturnType<typeof useNav.getState>>) {
  act(() => useNav.setState(screen))
}

beforeEach(() => {
  env.native = false
  env.listeners.clear()
  env.minimizeApp.mockClear()
  env.exitApp.mockClear()
  env.remove.mockClear()
  while (closeTopOverlay()) {
    // drain
  }
  at({ screen: { name: 'hub' }, stack: [], back: realBack })
})
afterEach(cleanup)

describe('handleBack', () => {
  it('closes the top overlay first, and only that one', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = pushOverlay(first)
    const offSecond = pushOverlay(second)
    at({ screen: { name: 'settings' }, stack: [{ name: 'hub' }] })

    expect(handleBack(vi.fn())).toBe('overlay')
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(useNav.getState().screen.name).toBe('settings')
    offSecond()
    offFirst()
  })

  it('closes an open Sheet (ConfirmDialog is a Sheet too)', () => {
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="Delete this save?">
        <p>Gone for good.</p>
      </Sheet>,
    )
    expect(hasOpenOverlay()).toBe(true)
    const minimize = vi.fn()
    expect(handleBack(minimize)).toBe('overlay')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(minimize).not.toHaveBeenCalled()
  })

  it('goes back a screen when there is one', () => {
    const back = vi.fn()
    at({ screen: { name: 'settings' }, stack: [{ name: 'hub' }], back })
    expect(handleBack(vi.fn())).toBe('nav')
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('goes to the hub from a screen restored after a reload (empty stack)', () => {
    at({ screen: { name: 'settings' }, stack: [] })
    const minimize = vi.fn()
    expect(handleBack(minimize)).toBe('nav')
    expect(useNav.getState().screen.name).toBe('hub')
    expect(minimize).not.toHaveBeenCalled()
  })

  it.each(['hub', 'gate', 'onboarding'] as const)('minimizes at the %s with nothing behind it', (name) => {
    at({ screen: { name }, stack: [] })
    const minimize = vi.fn()
    expect(handleBack(minimize)).toBe('minimize')
    expect(minimize).toHaveBeenCalledTimes(1)
  })
})

describe('bindBackButton', () => {
  it('does nothing on the web', async () => {
    const stop = await bindBackButton()
    expect(env.listeners.size).toBe(0)
    stop()
  })

  it('takes over the Android back button and gives it back', async () => {
    env.native = true
    const stop = await bindBackButton()
    const onBack = env.listeners.get('backButton')
    expect(onBack).toBeTypeOf('function')

    at({ screen: { name: 'hub' }, stack: [] })
    onBack?.()
    expect(env.minimizeApp).toHaveBeenCalledTimes(1)

    const onClose = vi.fn()
    const off = pushOverlay(onClose)
    onBack?.()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(env.minimizeApp).toHaveBeenCalledTimes(1)
    off()

    stop()
    expect(env.remove).toHaveBeenCalledTimes(1)
  })

  it('leaves the app when minimizing is not supported', async () => {
    env.native = true
    env.minimizeApp.mockRejectedValueOnce(new Error('not implemented'))
    await bindBackButton()
    env.listeners.get('backButton')?.()
    await vi.waitFor(() => expect(env.exitApp).toHaveBeenCalledTimes(1))
  })
})
