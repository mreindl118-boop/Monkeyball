import { describe, expect, it } from 'vitest'
import { hashToScreen, screenToHash, useNav, type Screen } from './nav'

const screens: Screen[] = [
  { name: 'gate' },
  { name: 'onboarding' },
  { name: 'connection-setup' },
  { name: 'hub' },
  { name: 'profile', id: 'nova' },
  { name: 'profile', id: 'name with spaces/and slash' },
  { name: 'date-setup', id: 'kai', group: false },
  { name: 'date-setup', id: 'kai', group: true },
  { name: 'date' },
  { name: 'recap', dateId: 12 },
  { name: 'gallery' },
  { name: 'gallery', id: 'nova' },
  { name: 'map' },
  { name: 'sets' },
  { name: 'settings' },
  { name: 'settings', section: 'connection' },
  { name: 'editor' },
  { name: 'editor', id: 'nova-copy' },
  { name: 'ending', id: 'nova' },
  { name: 'debug' },
]

describe('nav hash round trip', () => {
  it.each(screens.map((s) => [screenToHash(s), s] as const))('%s', (hash, screen) => {
    expect(hash.startsWith('#/')).toBe(true)
    expect(hashToScreen(hash)).toEqual(screen)
  })

  it('returns null for unknown or incomplete paths', () => {
    expect(hashToScreen('')).toBeNull()
    expect(hashToScreen('#/')).toBeNull()
    expect(hashToScreen('#/nowhere')).toBeNull()
    expect(hashToScreen('#/profile')).toBeNull()
    expect(hashToScreen('#/recap/abc')).toBeNull()
  })

  it('tolerates a missing leading slash', () => {
    expect(hashToScreen('#hub')).toEqual({ name: 'hub' })
  })
})

describe('useNav stack', () => {
  it('pushes, replaces, goes back and resets (outside a browser)', () => {
    useNav.getState().reset({ name: 'hub' })
    useNav.getState().go({ name: 'settings' })
    useNav.getState().go({ name: 'debug' })
    expect(useNav.getState().stack.map((s) => s.name)).toEqual(['hub', 'settings'])
    useNav.getState().replace({ name: 'connection-setup' })
    expect(useNav.getState().screen).toEqual({ name: 'connection-setup' })
    useNav.getState().back()
    expect(useNav.getState().screen).toEqual({ name: 'settings' })
    useNav.getState().back()
    useNav.getState().back()
    expect(useNav.getState().screen).toEqual({ name: 'hub' })
    useNav.getState().go({ name: 'profile', id: 'nova' })
    useNav.getState().reset({ name: 'gate' })
    expect(useNav.getState().stack).toEqual([])
    expect(useNav.getState().screen).toEqual({ name: 'gate' })
  })
})
