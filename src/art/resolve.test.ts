import 'fake-indexeddb/auto'
import bundledFiles from 'virtual:bundled-art'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CrushDB } from '../db/db'
import { kvGet } from '../db/repo'
import type { StoredImage } from '../types'
import { configureArtUrls, createArtResolver, emitArtChange, indexBundled, liveArtUrls, releaseArt, subscribeArt } from './resolve'
import { generatedKey, parseSlotKey, slotKey, type ArtSlot } from './types'

let counter = 0
const open: CrushDB[] = []
function freshDb(): CrushDB {
  const d = new CrushDB(`art-resolve-${Date.now()}-${counter++}`)
  open.push(d)
  return d
}

let made = 0
let revoked: string[] = []

beforeEach(() => {
  made = 0
  revoked = []
  configureArtUrls({
    graceMs: 0,
    create: () => `blob:test/${++made}`,
    revoke: (url) => {
      revoked.push(url)
    },
  })
})

afterEach(async () => {
  while (open.length) {
    const d = open.pop()!
    d.close()
    await d.delete()
  }
})

const BUNDLED = [
  'art/afterhours/nova/tier-2.png',
  'art/afterhours/nova/tier-2.webp',
  'art/afterhours/nova/tier-3.jpg',
  'art/afterhours/nova/ending-good.jpg',
  'art/afterhours/kai/tier-1.webp',
  'art/afterhours/nova/notes.txt',
  'art/../secret.png',
]

function resolver(d: CrushDB) {
  return createArtResolver({ db: d, bundled: BUNDLED, setOf: (id) => (id === 'nova' || id === 'kai' ? 'afterhours' : undefined), baseUrl: './' })
}

const png = (n: number) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, n])], { type: 'image/png' })

function row(slot: ArtSlot, source: 'imported' | 'generated', n = 1, extra: Partial<StoredImage> = {}): StoredImage {
  return {
    key: source === 'imported' ? slotKey(slot) : generatedKey(slot),
    characterId: slot.kind === 'group' ? 'group' : slot.characterId,
    source,
    blob: png(n),
    createdAt: 1000 + n,
    ...(source === 'generated' ? { prompt: `prompt ${n}`, seed: n } : {}),
    ...extra,
  }
}

const tier = (characterId: string, t: 1 | 2 | 3 | 4 | 5): ArtSlot => ({ kind: 'tier', characterId, tier: t })

describe('slot keys', () => {
  it('match the contract and parse back', () => {
    expect(slotKey(tier('nova', 1))).toBe('nova:tier-1')
    expect(slotKey({ kind: 'ending', characterId: 'nova', ending: 'good' })).toBe('nova:ending-good')
    expect(slotKey({ kind: 'group', characterIds: ['nova', 'kai', 'nova'], slot: 'polycule' })).toBe('group:kai+nova:polycule')
    expect(generatedKey(tier('nova', 1))).toBe('nova:tier-1#generated')
    for (const k of ['nova:tier-3', 'nova:ending-bitter', 'group:kai+nova:polycule', 'group:a+b:date:rooftop-bar']) {
      expect(slotKey(parseSlotKey(k)!)).toBe(k)
    }
    expect(parseSlotKey('nova:tier-3#generated')).toEqual(tier('nova', 3))
    expect(parseSlotKey('nova:tier-9')).toBeNull()
    expect(parseSlotKey('nova:ending-happy')).toBeNull()
  })
})

describe('bundled art index', () => {
  it('comes from the build: a sorted list of tier and ending files under art/', () => {
    expect(Array.isArray(bundledFiles)).toBe(true)
    for (const f of bundledFiles) expect(f).toMatch(/^art\/[a-z0-9-]+\/[a-z0-9-]+\/(?:tier-[1-5]|ending-[a-z]+)\.(?:webp|png|jpe?g)$/)
    expect([...bundledFiles].sort()).toEqual([...bundledFiles])
  })

  it('keeps tier and ending files per character, preferring webp, then png, then jpg', () => {
    const index = indexBundled(BUNDLED)
    expect(index.get('afterhours/nova/tier-2')).toBe('art/afterhours/nova/tier-2.webp')
    expect(index.get('afterhours/nova/tier-3')).toBe('art/afterhours/nova/tier-3.jpg')
    expect(index.get('afterhours/nova/ending-good')).toBe('art/afterhours/nova/ending-good.jpg')
    expect([...index.values()].some((p) => p.includes('..') || p.endsWith('.txt'))).toBe(false)
  })
})

describe('resolveArt: imported, then bundled, then generated, then the placeholder', () => {
  it('walks the order as sources come and go', async () => {
    const d = freshDb()
    const r = resolver(d)
    const slot = tier('nova', 2)
    // Nothing stored, but a bundled file: bundled (webp preferred).
    expect(await r.resolveArt(slot)).toEqual({ source: 'bundled', key: 'nova:tier-2', url: './art/afterhours/nova/tier-2.webp' })
    // A generated picture doesn't beat bundled art.
    await d.images.put(row(slot, 'generated', 2))
    expect((await r.resolveArt(slot)).source).toBe('bundled')
    // The player's own picture beats everything.
    await d.images.put(row(slot, 'imported', 3))
    const imported = await r.resolveArt(slot)
    expect(imported).toMatchObject({ source: 'imported', key: 'nova:tier-2', createdAt: 1003 })
    expect(imported.url).toMatch(/^blob:/)
    releaseArt(imported)

    // Without bundled art: generated, then placeholder.
    const t1 = tier('nova', 1)
    expect(await r.resolveArt(t1)).toEqual({ source: 'placeholder', key: 'nova:tier-1' })
    await d.images.put(row(t1, 'generated', 4))
    const gen = await r.resolveArt(t1)
    expect(gen).toMatchObject({ source: 'generated', prompt: 'prompt 4', seed: 4 })
    releaseArt(gen)
    await d.images.put(row(t1, 'imported', 5))
    const imp = await r.resolveArt(t1)
    expect(imp.source).toBe('imported')
    releaseArt(imp)
    // Removing the import brings the generated picture back (they're separate rows).
    await d.images.delete(slotKey(t1))
    const back = await r.resolveArt(t1)
    expect(back).toMatchObject({ source: 'generated', seed: 4 })
    releaseArt(back)
  })

  it('finds ending art, pack art stored under the slot key, and nothing for strangers', async () => {
    const d = freshDb()
    const r = resolver(d)
    expect((await r.resolveArt({ kind: 'ending', characterId: 'nova', ending: 'good' })).url).toBe('./art/afterhours/nova/ending-good.jpg')
    expect((await r.resolveArt({ kind: 'ending', characterId: 'nova', ending: 'open' })).source).toBe('placeholder')
    // Pack import stores tier art as imported under the slot key (src/store/roster.ts).
    await d.images.put({ key: 'lark:tier-1', characterId: 'lark', source: 'imported', blob: png(9), createdAt: 1 })
    const pack = await r.resolveArt(tier('lark', 1))
    expect(pack.source).toBe('imported')
    releaseArt(pack)
    // An older generated row under the plain key still counts as generated.
    await d.images.put({ key: 'lark:tier-2', characterId: 'lark', source: 'generated', blob: png(8), createdAt: 1 })
    const old = await r.resolveArt(tier('lark', 2))
    expect(old.source).toBe('generated')
    releaseArt(old)
  })

  it('shows the group picture for a character\'s Polycule ending once the group is known', async () => {
    const d = freshDb()
    const r = resolver(d)
    const nova = { kind: 'ending', characterId: 'nova', ending: 'polycule' } as const
    expect((await r.resolveArt(nova)).source).toBe('placeholder')
    await r.setPolyculeGroup(['nova', 'kai'])
    const group: ArtSlot = { kind: 'group', characterIds: ['kai', 'nova'], slot: 'polycule' }
    expect(await r.canonicalSlot(nova)).toEqual(group)
    expect(await r.canonicalSlot({ kind: 'ending', characterId: 'kai', ending: 'polycule' })).toEqual(group)
    await d.images.put(row(group, 'generated', 6))
    const art = await r.resolveArt(nova)
    expect(art).toMatchObject({ source: 'generated', key: 'nova:ending-polycule', resolvedKey: 'group:kai+nova:polycule' })
    releaseArt(art)
    // Remembered on this device.
    expect(await kvGet('artGroups', d)).toEqual({ kai: ['kai', 'nova'], nova: ['kai', 'nova'] })
    expect(await resolver(d).polyculeGroupOf('kai')).toEqual(['kai', 'nova'])
  })

  it('keeps favorites for every source, across restarts', async () => {
    const d = freshDb()
    const r = resolver(d)
    await r.setFavorite(tier('nova', 2), true)
    await r.setFavorite(tier('nova', 1), true)
    await r.setFavorite(tier('nova', 1), false)
    expect(await r.resolveArt(tier('nova', 2))).toMatchObject({ source: 'bundled', favorite: true })
    expect((await r.resolveArt(tier('nova', 1))).favorite).toBeUndefined()
    expect(await resolver(d).favorites()).toEqual(['nova:tier-2'])
  })

  it('falls back quietly when storage is gone', async () => {
    const d = freshDb()
    const r = resolver(d)
    d.close()
    expect((await r.resolveArt(tier('nova', 2))).source).toBe('bundled')
    expect((await r.resolveArt(tier('nova', 1))).source).toBe('placeholder')
  })
})

describe('object URLs', () => {
  it('shares one URL per stored image and revokes it when the last holder lets go', async () => {
    const d = freshDb()
    const r = resolver(d)
    const slot = tier('nova', 1)
    await d.images.put(row(slot, 'generated', 1))
    const a = await r.resolveArt(slot)
    const b = await r.resolveArt(slot)
    expect(a.url).toBe(b.url)
    expect(made).toBe(1)
    const live = liveArtUrls()
    releaseArt(a)
    expect(revoked).toEqual([])
    releaseArt(b)
    expect(revoked).toEqual([a.url])
    expect(liveArtUrls()).toBe(live - 1)
    // Releasing again, or bundled and placeholder art, does nothing.
    releaseArt(b)
    releaseArt({ source: 'bundled', key: 'x', url: './art/x.webp' })
    releaseArt(null)
    expect(revoked).toHaveLength(1)
    // A replaced picture gets a new URL.
    await d.images.put(row(slot, 'generated', 2))
    const c = await r.resolveArt(slot)
    expect(c.url).not.toBe(a.url)
    releaseArt(c)
  })

  it('waits out a grace period before revoking, so a refresh of the same picture keeps its URL', async () => {
    configureArtUrls({ graceMs: 20 })
    const d = freshDb()
    const r = resolver(d)
    const slot = tier('nova', 1)
    await d.images.put(row(slot, 'imported', 1))
    const a = await r.resolveArt(slot)
    releaseArt(a)
    const b = await r.resolveArt(slot)
    expect(b.url).toBe(a.url)
    releaseArt(b)
    await new Promise((res) => setTimeout(res, 40))
    expect(revoked).toEqual([a.url])
  })
})

describe('change events', () => {
  it('tell a slot, its polycule aliases and the catch-all', () => {
    const seen: string[] = []
    const offs = [
      subscribeArt('nova:tier-1', () => seen.push('tier')),
      subscribeArt('kai:ending-polycule', () => seen.push('kai polycule')),
      subscribeArt('*', () => seen.push('any')),
    ]
    emitArtChange([tier('nova', 1)])
    emitArtChange(['group:kai+nova:polycule#generated'])
    offs.forEach((off) => off())
    emitArtChange([tier('nova', 1)])
    expect(seen).toEqual(['tier', 'any', 'kai polycule', 'any'])
  })
})

describe('thumbnails', () => {
  const thumbBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })

  it('tiles get the thumbnail, the viewer the full picture, each with its own URL', async () => {
    const d = freshDb()
    const r = resolver(d)
    const slot = tier('nova', 4)
    await d.images.put(row(slot, 'generated', 1, { thumb: thumbBlob }))
    const full = await r.resolveArt(slot)
    const small = await r.resolveArt(slot, { thumb: true })
    expect(full.source).toBe('generated')
    expect(small.source).toBe('generated')
    expect(small.url).not.toBe(full.url)
    releaseArt(full)
    releaseArt(small)
    expect(liveArtUrls()).toBe(0)
  })

  it('a stored picture without one (a pack, an older save) gets one the first time a tile asks', async () => {
    const d = freshDb()
    const made: Blob[] = []
    const r = createArtResolver({
      db: d,
      bundled: [],
      setOf: () => 'afterhours',
      baseUrl: './',
      thumbnail: async (b) => {
        made.push(b)
        return thumbBlob
      },
    })
    const slot = tier('nova', 4)
    await d.images.put(row(slot, 'imported', 1))
    // The viewer never makes one.
    releaseArt(await r.resolveArt(slot))
    expect(made).toHaveLength(0)
    // A tile shows the full picture this time and starts one, once.
    const first = await r.resolveArt(slot, { thumb: true })
    releaseArt(await r.resolveArt(slot, { thumb: true }))
    await new Promise((res) => setTimeout(res, 20))
    expect(made).toHaveLength(1)
    const stored = await d.images.get(slotKey(slot))
    expect(stored?.thumb?.size).toBe(3)
    const next = await r.resolveArt(slot, { thumb: true })
    expect(next.url).not.toBe(first.url)
    releaseArt(first)
    releaseArt(next)
  })

  it('no thumbnail is kept for a picture replaced meanwhile', async () => {
    const d = freshDb()
    let release!: () => void
    const wait = new Promise<void>((res) => {
      release = res
    })
    const r = createArtResolver({ db: d, bundled: [], setOf: () => 'afterhours', baseUrl: './', thumbnail: async () => (await wait, thumbBlob) })
    const slot = tier('nova', 4)
    await d.images.put(row(slot, 'imported', 1))
    releaseArt(await r.resolveArt(slot, { thumb: true }))
    await d.images.put(row(slot, 'imported', 2))
    release()
    await new Promise((res) => setTimeout(res, 20))
    expect((await d.images.get(slotKey(slot)))?.thumb).toBeUndefined()
  })
})
