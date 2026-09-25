// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bindHistory, hashToScreen, useNav, type Screen } from './nav'

let unbind: () => void

beforeAll(() => {
  window.scrollTo = () => undefined
  unbind = bindHistory()
})

afterAll(() => unbind())

/** Resolve after the next popstate has been handled. */
function nextPop(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true })
  })
}

/** Start a test on the hub without unwinding what the previous test left behind. */
function startOn(screen: Screen = { name: 'hub' }) {
  useNav.setState({ stack: [] })
  useNav.getState().reset(screen)
}

const idx = () => (window.history.state as { idx?: number } | null)?.idx
const names = () => useNav.getState().stack.map((s) => s.name)

describe('useNav and browser history', () => {
  it('in-app Back pops the entry go() pushed, so system back leaves the app from the hub', async () => {
    startOn()
    const start = window.history.length
    expect(window.location.hash).toBe('#/hub')
    expect(idx()).toBe(0)

    useNav.getState().go({ name: 'settings' })
    useNav.getState().go({ name: 'debug' })
    expect(window.location.hash).toBe('#/debug')
    expect(idx()).toBe(2)
    expect(names()).toEqual(['hub', 'settings'])

    let pop = nextPop()
    useNav.getState().back()
    await pop
    expect(useNav.getState().screen).toEqual({ name: 'settings' })
    expect(window.location.hash).toBe('#/settings')
    expect(names()).toEqual(['hub'])

    pop = nextPop()
    useNav.getState().back()
    await pop
    expect(useNav.getState().screen).toEqual({ name: 'hub' })
    expect(window.location.hash).toBe('#/hub')
    expect(names()).toEqual([])
    // Back on the first entry the app wrote: the next system back leaves the app.
    expect(idx()).toBe(0)
    expect(window.history.length).toBe(start + 2)

    // Browser forward re-opens Settings and grows the stack again.
    pop = nextPop()
    window.history.forward()
    await pop
    expect(useNav.getState().screen).toEqual({ name: 'settings' })
    expect(names()).toEqual(['hub'])
    expect(idx()).toBe(1)
  })

  it('reset unwinds the entries its stack pushed', async () => {
    startOn()
    const base = idx()!
    useNav.getState().go({ name: 'settings' })
    useNav.getState().go({ name: 'connection-setup' })
    const pop = nextPop()
    useNav.getState().reset({ name: 'hub' })
    expect(useNav.getState().screen).toEqual({ name: 'hub' })
    await pop
    expect(window.location.hash).toBe('#/hub')
    expect(idx()).toBe(base)
    expect(names()).toEqual([])
  })

  it('a go() right after a reset lands on top of the unwound history', async () => {
    startOn()
    const base = idx()!
    useNav.getState().go({ name: 'settings' })
    useNav.getState().go({ name: 'debug' })
    const pop = nextPop()
    useNav.getState().reset({ name: 'hub' })
    useNav.getState().go({ name: 'profile', id: 'nova' })
    expect(useNav.getState().screen).toEqual({ name: 'profile', id: 'nova' })
    expect(names()).toEqual(['hub'])
    await pop
    expect(window.location.hash).toBe('#/profile/nova')
    expect(idx()).toBe(base + 1)

    const back = nextPop()
    useNav.getState().back()
    await back
    expect(window.location.hash).toBe('#/hub')
    expect(idx()).toBe(base)
    expect(names()).toEqual([])
  })

  it('treats a hash set by hand as a forward step', async () => {
    startOn()
    const base = idx()!
    const pop = nextPop()
    window.location.hash = '#/profile/nova'
    await pop
    expect(useNav.getState().screen).toEqual({ name: 'profile', id: 'nova' })
    expect(names()).toEqual(['hub'])
    expect(idx()).toBe(base + 1)
  })

  it('going to the current screen does not add an entry', () => {
    startOn()
    const before = idx()
    useNav.getState().go({ name: 'hub' })
    expect(idx()).toBe(before)
    expect(names()).toEqual([])
  })

  it('in-app Back with an empty stack (after a reload) replaces with the hub', () => {
    startOn({ name: 'debug' })
    const before = idx()
    useNav.getState().back()
    expect(useNav.getState().screen).toEqual({ name: 'hub' })
    expect(window.location.hash).toBe('#/hub')
    expect(idx()).toBe(before)
  })
})

describe('malformed hashes', () => {
  it('parse to null instead of throwing', () => {
    expect(hashToScreen('#/profile/100%')).toBeNull()
    expect(hashToScreen('#/%E0%A4%A')).toBeNull()
  })
})
