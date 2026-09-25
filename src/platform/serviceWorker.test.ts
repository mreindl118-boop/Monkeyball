// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ native: false }))
vi.mock('./platform', () => ({ isNative: () => env.native }))

import { setupServiceWorker, UPDATE_READY_TEXT, watchForUpdates } from './serviceWorker'
import { useToasts } from '../ui/toastStore'

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

/** A minimal event target standing in for a worker, a registration or the container. */
class Target {
  private handlers = new Map<string, (() => void)[]>()
  addEventListener(type: string, fn: () => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn])
  }
  fire(type: string) {
    for (const fn of this.handlers.get(type) ?? []) fn()
  }
}

class FakeWorker extends Target {
  state = 'installing'
  postMessage = vi.fn()
  become(state: string) {
    this.state = state
    this.fire('statechange')
  }
}

function fakeRegistration(waiting: FakeWorker | null = null) {
  const reg = Object.assign(new Target(), {
    waiting,
    installing: null as FakeWorker | null,
    update: vi.fn(async () => undefined),
  })
  return reg
}

function container(controlled: boolean) {
  return Object.assign(new Target(), { controller: controlled ? {} : null })
}

describe('watchForUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToasts.setState({ toasts: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers a worker that installs while an older one controls the page, once', () => {
    const sw = container(true)
    const reg = fakeRegistration()
    const onUpdate = vi.fn()
    watchForUpdates(sw as never, reg as never, { onUpdate, reload: vi.fn() })
    const next = new FakeWorker()
    reg.installing = next
    reg.fire('updatefound')
    next.become('installed')
    next.become('installed')
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('stays quiet on the first install (nothing controls the page yet)', () => {
    const sw = container(false)
    const reg = fakeRegistration()
    const onUpdate = vi.fn()
    watchForUpdates(sw as never, reg as never, { onUpdate, reload: vi.fn() })
    const first = new FakeWorker()
    reg.installing = first
    reg.fire('updatefound')
    first.become('installed')
    // The first worker claiming the page is not the player's Reload.
    sw.fire('controllerchange')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('Reload tells the waiting worker to take over and reloads when it has', () => {
    const sw = container(true)
    const waiting = new FakeWorker()
    waiting.state = 'installed'
    const reload = vi.fn()
    let apply: (() => void) | null = null
    watchForUpdates(sw as never, fakeRegistration(waiting) as never, { onUpdate: (a) => (apply = a), reload })
    expect(apply).not.toBeNull()
    expect(reload).not.toHaveBeenCalled()
    apply!()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    sw.fire('controllerchange')
    vi.advanceTimersByTime(10_000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads anyway if the takeover is never reported', () => {
    const sw = container(true)
    const waiting = new FakeWorker()
    const reload = vi.fn()
    let apply: (() => void) | null = null
    watchForUpdates(sw as never, fakeRegistration(waiting) as never, { onUpdate: (a) => (apply = a), reload })
    apply!()
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('by default shows "A new version is ready" with a Reload button that stays up', () => {
    const sw = container(true)
    const waiting = new FakeWorker()
    const reload = vi.fn()
    watchForUpdates(sw as never, fakeRegistration(waiting) as never, { reload })
    const [t] = useToasts.getState().toasts
    expect(t.text).toBe(UPDATE_READY_TEXT)
    expect(t.action?.label).toBe('Reload')
    vi.advanceTimersByTime(60_000)
    expect(useToasts.getState().toasts).toHaveLength(1)
    t.action!.run()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('checks for a newer version when the tab comes back', () => {
    const reg = fakeRegistration()
    watchForUpdates(container(true) as never, reg as never, { onUpdate: vi.fn(), reload: vi.fn() })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reg.update).toHaveBeenCalled()
  })
})
