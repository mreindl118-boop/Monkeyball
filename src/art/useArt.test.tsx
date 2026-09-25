// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CrushDB } from '../db/db'
import type { StoredImage } from '../types'
import { configureArtUrls, createArtResolver, emitArtChange, setArtResolver, useArt } from './resolve'
import { generatedKey, type ArtSlot } from './types'

let db: CrushDB
let made = 0
let revoked: string[] = []

beforeEach(() => {
  made = 0
  revoked = []
  configureArtUrls({ graceMs: 0, create: () => `blob:hook/${++made}`, revoke: (u) => void revoked.push(u) })
  db = new CrushDB(`art-hook-${Date.now()}-${Math.random()}`)
  setArtResolver(createArtResolver({ db, bundled: ['art/afterhours/nova/tier-2.webp'], setOf: () => 'afterhours', baseUrl: './' }))
})

afterEach(async () => {
  cleanup()
  setArtResolver(null)
  db.close()
  await db.delete()
})

const slot: ArtSlot = { kind: 'tier', characterId: 'nova', tier: 1 }

function stored(n: number, source: StoredImage['source'] = 'generated'): StoredImage {
  return {
    key: source === 'generated' ? generatedKey(slot) : 'nova:tier-1',
    characterId: 'nova',
    source,
    blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, n])], { type: 'image/png' }),
    createdAt: n,
  }
}

describe('useArt', () => {
  it('shows the placeholder, then follows a painting landing, and releases the URL on unmount', async () => {
    const { result, unmount } = renderHook(({ s }) => useArt(s), { initialProps: { s: slot as ArtSlot | null } })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.art?.source).toBe('placeholder'))
    expect(result.current.loading).toBe(false)

    await db.images.put(stored(1))
    act(() => emitArtChange([slot]))
    await waitFor(() => expect(result.current.art?.source).toBe('generated'))
    const url = result.current.art?.url
    expect(url).toMatch(/^blob:hook\//)

    // The player's own picture replaces it; the old URL goes.
    await db.images.put(stored(2, 'imported'))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.art?.source).toBe('imported'))
    expect(revoked).toContain(url)

    const last = result.current.art?.url
    unmount()
    expect(revoked).toContain(last)
  })

  it('looks nothing up for null, and switches slots cleanly', async () => {
    const { result, rerender } = renderHook(({ s }) => useArt(s), { initialProps: { s: null as ArtSlot | null } })
    expect(result.current).toMatchObject({ art: null, loading: false })
    rerender({ s: { kind: 'tier', characterId: 'nova', tier: 2 } })
    await waitFor(() => expect(result.current.art).toMatchObject({ source: 'bundled', url: './art/afterhours/nova/tier-2.webp' }))
    rerender({ s: null })
    expect(result.current.art).toBeNull()
  })

  it('does not look again for a new slot object naming the same picture', async () => {
    await db.images.put(stored(3))
    const { result, rerender } = renderHook(({ s }) => useArt(s), { initialProps: { s: { ...slot } as ArtSlot } })
    await waitFor(() => expect(result.current.art?.source).toBe('generated'))
    const before = made
    rerender({ s: { ...slot } })
    await new Promise((r) => setTimeout(r, 10))
    expect(made).toBe(before)
    expect(result.current.art?.source).toBe('generated')
  })
})
