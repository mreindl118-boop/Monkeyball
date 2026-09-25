// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ native: false }))
vi.mock('./platform', () => ({ isNative: () => env.native }))

import { setupServiceWorker } from './serviceWorker'

function fakeServiceWorker() {
  const unregister = vi.fn(async () => true)
  const sw = {
    register: vi.fn(async () => ({})),
    getRegistrations: vi.fn(async () => [{ unregister }, { unregister }]),
  }
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true })
  return { sw, unregister }
}

beforeEach(() => {
  env.native = false
  // Pretend to be a production build: the dev server has no sw.js.
  vi.stubEnv('DEV', false)
})

afterEach(() => {
  vi.unstubAllEnvs()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('setupServiceWorker', () => {
  it('registers ./sw.js on the web', () => {
    const { sw } = fakeServiceWorker()
    setupServiceWorker()
    expect(sw.register).toHaveBeenCalledWith('./sw.js', { scope: './' })
    expect(sw.getRegistrations).not.toHaveBeenCalled()
  })

  it('never registers in the Android app, and removes an old registration', async () => {
    env.native = true
    const { sw, unregister } = fakeServiceWorker()
    setupServiceWorker()
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledTimes(2))
    expect(sw.register).not.toHaveBeenCalled()
  })

  it('does nothing in the dev server', () => {
    vi.stubEnv('DEV', true)
    const { sw } = fakeServiceWorker()
    setupServiceWorker()
    expect(sw.register).not.toHaveBeenCalled()
  })

  it('does nothing without service worker support', () => {
    expect(() => setupServiceWorker()).not.toThrow()
  })
})
