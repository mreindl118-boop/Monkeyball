import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bundledEntry } from '../data/bundled'
import { CrushDB } from '../db/db'
import { newRelationship } from '../engine/relationship'
import type { DebugInput } from '../store/debug'
import { defaultSettings } from '../store/defaults'
import type { Character, ImageSettings, Relationship, Settings } from '../types'
import { createArtEngine, unlockedSlots, useArtJobs, type ArtEngineDeps } from './generate'
import { FRIEND_MODIFIER, IMAGE_SAFETY } from './imagePrompt'
import { ArtError, type ArtProvider, type ArtRequest } from './providers'
import { configureArtUrls, createArtResolver, releaseArt, type ArtResolver } from './resolve'
import { generatedKey, slotKey, type ArtSlot } from './types'

let counter = 0
const open: CrushDB[] = []
function freshDb(): CrushDB {
  const d = new CrushDB(`art-generate-${Date.now()}-${counter++}`)
  open.push(d)
  return d
}

beforeEach(() => {
  let n = 0
  configureArtUrls({ graceMs: 0, create: () => `blob:gen/${++n}`, revoke: () => undefined })
  useArtJobs.setState({ jobs: {} })
})

afterEach(async () => {
  while (open.length) {
    const d = open.pop()!
    d.close()
    await d.delete()
  }
})

const character = (id: string): Character | undefined => bundledEntry(id)?.character

const png = (n: number) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, n])], { type: 'image/png' })

interface Gate {
  promise: Promise<void>
  open: () => void
}
function gate(): Gate {
  let open!: () => void
  const promise = new Promise<void>((r) => {
    open = r
  })
  return { promise, open }
}

function fakeProvider(opts: { fail?: () => Error | null; wait?: () => Promise<void> | undefined; id?: ArtProvider['id'] } = {}) {
  const calls: ArtRequest[] = []
  const provider: ArtProvider = {
    id: opts.id ?? 'a1111',
    label: 'Fake',
    available: () => true,
    generate: async (req, signal) => {
      calls.push(req)
      await opts.wait?.()
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      const err = opts.fail?.()
      if (err) throw err
      return { blob: png(calls.length), seed: req.seed }
    },
    test: async () => ({ ok: true, message: 'ok' }),
  }
  return { provider, calls }
}

function setup(p: { image?: Partial<ImageSettings>; provider?: ReturnType<typeof fakeProvider>; bundled?: string[]; trust?: Record<string, number>; heat?: Settings['heat'] } = {}) {
  const db = freshDb()
  const settings = defaultSettings()
  settings.heat = p.heat ?? 2
  settings.image = { ...settings.image, enabled: true, baseUrl: 'http://pc:7860', ...p.image }
  const fake = p.provider ?? fakeProvider()
  const resolver: ArtResolver = createArtResolver({ db, bundled: p.bundled ?? [], setOf: (id) => bundledEntry(id)?.setId, baseUrl: './' })
  const logs: (DebugInput & { id: string; response?: string; error?: string })[] = []
  const deps: ArtEngineDeps = {
    resolver: () => resolver,
    settings: () => settings,
    character,
    trust: (id) => p.trust?.[id] ?? 50,
    provider: (s) => (s.image.enabled ? fake.provider : null),
    log: (e) => {
      const id = `log-${logs.length + 1}`
      logs.push({ ...e, id })
      return id
    },
    patchLog: (id, patch) => {
      const entry = logs.find((l) => l.id === id)
      if (entry) Object.assign(entry, patch)
    },
    now: () => 1_700_000_000_000,
    compress: async (b) => b,
  }
  const engine = createArtEngine(deps)
  return { db, settings, fake, resolver, engine, logs }
}

const tier = (characterId: string, t: 1 | 2 | 3 | 4 | 5): ArtSlot => ({ kind: 'tier', characterId, tier: t })

describe('thumbnails', () => {
  it('a painted, accepted or imported picture is stored with its thumbnail when one is worth keeping', async () => {
    const small = new Blob([new Uint8Array([7, 7])], { type: 'image/webp' })
    const { engine, db } = setup()
    // An engine with a thumbnailer, over another setup's resolver and provider.
    const s = setup()
    const thumbed = createArtEngine({
      resolver: () => s.resolver,
      settings: () => s.settings,
      character,
      trust: () => 50,
      provider: () => s.fake.provider,
      log: () => 'log',
      patchLog: () => undefined,
      compress: async (b) => b,
      thumbnail: async () => small,
    })
    const slot = tier('nova', 1)
    const painted = await thumbed.generateArt(slot)
    expect(painted?.thumb?.size).toBe(2)
    expect((await s.db.images.get(generatedKey(slot)))?.thumb?.size).toBe(2)
    await thumbed.importImage(tier('nova', 2), png(9))
    expect((await s.db.images.get(slotKey(tier('nova', 2))))?.thumb?.size).toBe(2)
    await thumbed.acceptCandidate(tier('nova', 3), { blob: png(4), prompt: 'p', seed: 1 })
    expect((await s.db.images.get(generatedKey(tier('nova', 3))))?.thumb?.size).toBe(2)
    // Without a thumbnailer that can make one (tests, old WebViews) the row simply has none.
    const row = await engine.generateArt(slot)
    expect(row?.thumb).toBeUndefined()
    expect((await db.images.get(generatedKey(slot)))?.thumb).toBeUndefined()
  })

  it('a failing thumbnailer never stops the picture being stored', async () => {
    const s = setup()
    const e = createArtEngine({
      resolver: () => s.resolver,
      settings: () => s.settings,
      character,
      trust: () => 50,
      provider: () => s.fake.provider,
      log: () => 'log',
      patchLog: () => undefined,
      compress: async (b) => b,
      thumbnail: async () => {
        throw new Error('no canvas')
      },
    })
    const row = await e.generateArt(tier('nova', 1))
    expect(row?.source).toBe('generated')
    expect(row?.thumb).toBeUndefined()
  })
})

describe('generateArt', () => {
  it('paints once and caches: a second call and a resolve never call the provider again', async () => {
    const { engine, fake, resolver, db, logs } = setup()
    const slot = tier('nova', 1)
    const row = await engine.generateArt(slot)
    expect(row).toMatchObject({ key: 'nova:tier-1#generated', characterId: 'nova', source: 'generated', createdAt: 1_700_000_000_000 })
    expect(fake.calls).toHaveLength(1)
    expect(await db.images.get(generatedKey(slot))).toBeTruthy()
    const again = await engine.generateArt(slot)
    expect(again?.key).toBe(row?.key)
    const art = await resolver.resolveArt(slot)
    expect(art).toMatchObject({ source: 'generated', seed: row?.seed })
    releaseArt(art)
    expect(fake.calls).toHaveLength(1)
    // replace paints again.
    await engine.generateArt(slot, { replace: true })
    expect(fake.calls).toHaveLength(2)
    // The debug panel got the assembled prompt, with the safety text.
    expect(logs[0]).toMatchObject({ kind: 'image', characterId: 'nova' })
    expect(logs[0].prompt).toContain(IMAGE_SAFETY.positiveClause)
    expect(logs[0].prompt).toContain(IMAGE_SAFETY.negative)
    expect(logs[0].prompt).toContain('adult woman, 28 years old')
    expect(logs[0].response).toMatch(/^Painted nova:tier-1/)
  })

  it('sends the built prompt, the safety negative and a fixed seed per character', async () => {
    const { engine, fake } = setup({ heat: 3 })
    await engine.generateArt(tier('nova', 1))
    await engine.generateArt(tier('nova', 2))
    const [a, b] = fake.calls
    expect(a.prompt.endsWith(IMAGE_SAFETY.positiveClause)).toBe(true)
    expect(a.negative.startsWith(IMAGE_SAFETY.negative)).toBe(true)
    expect(a.prompt).toContain('ecchi')
    expect(a.seed).toBe(b.seed)
    expect(a.apiKey).toBeUndefined()
  })

  it('paints Grok prompts with the clause and the Grok key', async () => {
    const { engine, fake, settings } = setup({ image: { provider: 'grok' }, provider: fakeProvider({ id: 'grok' }) })
    settings.connection.providers.grok.apiKey = 'xai-key'
    await engine.generateArt(tier('kai', 1))
    expect(fake.calls[0].prompt.endsWith(IMAGE_SAFETY.grokClause)).toBe(true)
    expect(fake.calls[0].apiKey).toBe('xai-key')
  })

  it('shares one painting between callers asking at once', async () => {
    const g = gate()
    const provider = fakeProvider({ wait: () => g.promise })
    const { engine } = setup({ provider })
    const one = engine.generateArt(tier('nova', 1))
    const two = engine.generateArt(tier('nova', 1))
    // Wait for the provider to be reached (not a fixed delay: a loaded CI box can be slow).
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1))
    expect(useArtJobs.getState().jobs['nova:tier-1']).toEqual({ generating: true })
    g.open()
    const [a, b] = await Promise.all([one, two])
    expect(a).toBe(b)
    expect(provider.calls).toHaveLength(1)
    expect(useArtJobs.getState().jobs['nova:tier-1']).toBeUndefined()
  })

  it('does nothing with image generation off, and records a failure without caching it', async () => {
    const off = setup({ image: { enabled: false } })
    expect(await off.engine.generateArt(tier('nova', 1))).toBeNull()
    expect(off.fake.calls).toHaveLength(0)

    const failing = fakeProvider({ fail: () => new ArtError('grok', 'declined', 'The image service declined this prompt.') })
    const { engine, db, resolver } = setup({ provider: failing })
    await expect(engine.generateArt(tier('nova', 1))).rejects.toBeInstanceOf(ArtError)
    expect(useArtJobs.getState().jobs['nova:tier-1']).toEqual({ generating: false, error: 'The image service declined this prompt.' })
    expect(await db.images.count()).toBe(0)
    expect((await resolver.resolveArt(tier('nova', 1))).source).toBe('placeholder')
  })
})

describe('Regenerate', () => {
  it('keeps the current picture until the candidate is accepted', async () => {
    const { engine, resolver, fake } = setup()
    const slot = tier('nova', 3)
    const first = await engine.generateArt(slot)
    const candidate = await engine.generateCandidate(slot)
    expect(fake.calls).toHaveLength(2)
    // A fresh seed, so a fixed-seed server doesn't paint the same picture again.
    expect(candidate.seed).not.toBe(first?.seed)
    const before = await resolver.resolveArt(slot)
    expect(before.seed).toBe(first?.seed)
    releaseArt(before)
    await engine.acceptCandidate(slot, candidate)
    const after = await resolver.resolveArt(slot)
    expect(after.seed).toBe(candidate.seed)
    expect(after.prompt).toBe(candidate.prompt)
    releaseArt(after)
  })

  it('pays once for a double tap', async () => {
    const g = gate()
    const provider = fakeProvider({ wait: () => g.promise })
    const { engine } = setup({ provider })
    const a = engine.generateCandidate(tier('nova', 1))
    const b = engine.generateCandidate(tier('nova', 1))
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1))
    g.open()
    expect(await a).toBe(await b)
    expect(provider.calls).toHaveLength(1)
  })

  it('logs why a card gets no prompt, and paints nothing', async () => {
    const { fake, logs } = setup()
    const young = { ...bundledEntry('nova')!.character, id: 'young-mod', age: 19 }
    const e2 = createArtEngine({
      resolver: () => createArtResolver({ db: freshDb(), bundled: [] }),
      settings: () => ({ ...defaultSettings(), image: { ...defaultSettings().image, enabled: true } }),
      character: (id) => (id === 'young-mod' ? young : undefined),
      provider: () => fake.provider,
      log: (e) => {
        logs.push({ ...e, id: 'x' })
        return 'x'
      },
      patchLog: (_id, patch) => Object.assign(logs[logs.length - 1], patch),
      compress: async (b) => b,
    })
    await expect(e2.generateArt(tier('young-mod', 1))).rejects.toThrow(/no adult age/)
    expect(fake.calls).toHaveLength(0)
    expect(logs.at(-1)).toMatchObject({ kind: 'image', characterId: 'young-mod', error: expect.stringMatching(/21 or older/) })
  })

  it('refuses with a clear message when generation is off', async () => {
    const { engine } = setup({ image: { enabled: false } })
    await expect(engine.generateCandidate(tier('nova', 1))).rejects.toThrow(/Image generation is off/)
  })
})

describe('importImage and removeImported', () => {
  it('stores the player\'s picture over everything, and taking it away brings back what was there', async () => {
    const { engine, resolver } = setup({ bundled: ['art/afterhours/nova/tier-2.webp'] })
    const slot = tier('nova', 2)
    await engine.generateArt(slot)
    const bundled = await resolver.resolveArt(slot)
    expect(bundled.source).toBe('bundled')
    await engine.importImage(slot, new Blob([png(1)], { type: '' }))
    const mine = await resolver.resolveArt(slot)
    expect(mine.source).toBe('imported')
    releaseArt(mine)
    expect((await resolver.db.images.get('nova:tier-2'))?.blob.type).toBe('image/png')
    await engine.removeImported(slot)
    expect((await resolver.resolveArt(slot)).source).toBe('bundled')
  })

  it("keeps pack art and the player's own image apart: the player's wins, and removing it brings the pack's back", async () => {
    const { engine, resolver, db } = setup()
    const slot = tier('nova', 1)
    // A pack's art, as src/store/roster.ts importPack writes it.
    await db.images.put({ key: 'nova:tier-1#pack', characterId: 'nova', source: 'imported', pack: 'moonlight', blob: png(3), createdAt: 1 })
    const pack = await resolver.resolveArt(slot)
    expect(pack).toMatchObject({ source: 'imported', pack: 'moonlight' })
    releaseArt(pack)
    await engine.importImage(slot, png(4))
    const mine = await resolver.resolveArt(slot)
    expect(mine.source).toBe('imported')
    expect(mine.pack).toBeUndefined()
    releaseArt(mine)
    // Re-importing the pack writes its '#pack' row again: the player's image still wins.
    await db.images.put({ key: 'nova:tier-1#pack', characterId: 'nova', source: 'imported', pack: 'moonlight', blob: png(5), createdAt: 2 })
    const still = await resolver.resolveArt(slot)
    expect(still.pack).toBeUndefined()
    releaseArt(still)
    await engine.removeImported(slot)
    expect(await db.images.get('nova:tier-1')).toBeUndefined()
    const back = await resolver.resolveArt(slot)
    expect(back).toMatchObject({ source: 'imported', pack: 'moonlight' })
    releaseArt(back)
    // Removing again leaves the pack's picture alone.
    await engine.removeImported(slot)
    expect(await db.images.get('nova:tier-1#pack')).toBeDefined()
  })

  it('refuses files that aren\'t pictures', async () => {
    const { engine } = setup()
    await expect(engine.importImage(tier('nova', 1), new Blob(['hello'], { type: 'image/png' }))).rejects.toThrow(/isn't a picture/)
    await expect(engine.importImage(tier('nova', 1), new Blob([]))).rejects.toThrow(/empty/)
  })

  it('marks favorites', async () => {
    const { engine, resolver } = setup()
    await engine.setFavorite(tier('nova', 1), true)
    expect(await resolver.favorites()).toEqual(['nova:tier-1'])
  })
})

describe('onUnlock', () => {
  it('paints newly unlocked tiers in the background, once each, and returns at once', async () => {
    const g = gate()
    const provider = fakeProvider({ wait: () => g.promise })
    const { engine, resolver } = setup({ provider })
    const t0 = performance.now()
    engine.onUnlock('nova', [1, 2])
    engine.onUnlock('nova', [1])
    expect(performance.now() - t0).toBeLessThan(50)
    await new Promise((r) => setTimeout(r, 20))
    // One at a time: tier 1 is painting, tier 2 waits its turn.
    expect(provider.calls).toHaveLength(1)
    g.open()
    await engine.idle()
    expect(provider.calls).toHaveLength(2)
    expect((await resolver.resolveArt(tier('nova', 2))).source).toBe('generated')
    // Unlocked again (it can't be, but): cached, nothing painted.
    engine.onUnlock('nova', [1, 2])
    await engine.idle()
    expect(provider.calls).toHaveLength(2)
  })

  it('skips slots with imported or bundled art, and does nothing with generation off', async () => {
    const { engine, fake, db } = setup({ bundled: ['art/afterhours/nova/tier-1.webp'] })
    await db.images.put({ key: 'nova:tier-2', characterId: 'nova', source: 'imported', blob: png(7), createdAt: 1 })
    engine.onUnlock('nova', [1, 2, 3])
    await engine.idle()
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].prompt).toContain(bundledEntry('nova')!.character.gallery[2].scene.split(',')[0])

    const off = setup({ image: { enabled: false } })
    off.engine.onUnlock('nova', [1])
    await off.engine.idle()
    expect(off.fake.calls).toHaveLength(0)
  })

  it('never throws: a failure is recorded on the job', async () => {
    const provider = fakeProvider({ fail: () => new ArtError('a1111', 'unreachable', 'Nothing answered at http://pc:7860.') })
    const { engine } = setup({ provider })
    expect(() => engine.onUnlock('nova', [1])).not.toThrow()
    await engine.idle()
    expect(useArtJobs.getState().jobs['nova:tier-1']?.error).toMatch(/Nothing answered/)
    // A character nobody knows is no problem either.
    expect(() => engine.onUnlock('nobody', [1])).not.toThrow()
    await engine.idle()
  })
})

describe('onEnding', () => {
  it('paints the Polycule as one group picture with everyone\'s age, shown on each member\'s ending', async () => {
    const { engine, fake, resolver } = setup({ heat: 3, trust: { nova: 80, kai: 80 } })
    engine.onEnding('nova', 'polycule', ['nova', 'kai'])
    await engine.idle()
    expect(fake.calls).toHaveLength(1)
    const kai = bundledEntry('kai')!.character
    expect(fake.calls[0].prompt).toContain('2 adults together')
    expect(fake.calls[0].prompt).toContain('adult woman, 28 years old')
    expect(fake.calls[0].prompt).toContain(`adult ${kai.gender === 'nonbinary' ? 'nonbinary person' : kai.gender}, ${kai.age} years old`)
    for (const id of ['nova', 'kai']) {
      const art = await resolver.resolveArt({ kind: 'ending', characterId: id, ending: 'polycule' })
      expect(art).toMatchObject({ source: 'generated', resolvedKey: 'group:kai+nova:polycule' })
      releaseArt(art)
    }
  })

  it('paints another ending for the character alone', async () => {
    const { engine, fake, resolver } = setup()
    engine.onEnding('nova', 'bitter')
    await engine.idle()
    expect(fake.calls[0].prompt).toContain('the bitter ending')
    expect((await resolver.resolveArt({ kind: 'ending', characterId: 'nova', ending: 'bitter' })).source).toBe('generated')
  })
})

describe('what the recap waits for (useArtJobs)', () => {
  const jobs = () => useArtJobs.getState().jobs

  it('marks every unlocked tier as on its way the moment onUnlock returns, queued ones too', async () => {
    const g = gate()
    const provider = fakeProvider({ wait: () => g.promise })
    const { engine } = setup({ provider })
    engine.onUnlock('nova', [2, 3])
    // Synchronously: the recap can open right now and find both waiting.
    expect(jobs()['nova:tier-2']?.generating).toBe(true)
    expect(jobs()['nova:tier-3']?.generating).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    // Tier 2 paints; tier 3 waits its turn and still shows as on its way.
    expect(provider.calls).toHaveLength(1)
    expect(jobs()['nova:tier-2']).toMatchObject({ generating: true })
    expect(jobs()['nova:tier-2']?.queued).toBeUndefined()
    expect(jobs()['nova:tier-3']).toMatchObject({ generating: true, queued: true })
    g.open()
    await engine.idle()
    expect(provider.calls).toHaveLength(2)
    expect(jobs()).toEqual({})
  })

  it("shows a Polycule group's painting on each member's ending, from the moment onEnding returns", async () => {
    const g = gate()
    const provider = fakeProvider({ wait: () => g.promise })
    const { engine } = setup({ provider, trust: { felix: 80, ash: 80 } })
    engine.onEnding('felix', 'polycule', ['ash'])
    for (const k of ['felix:ending-polycule', 'ash:ending-polycule', 'group:ash+felix:polycule']) expect(jobs()[k]?.generating, k).toBe(true)
    await new Promise((r) => setTimeout(r, 30))
    expect(provider.calls).toHaveLength(1)
    for (const k of ['felix:ending-polycule', 'ash:ending-polycule', 'group:ash+felix:polycule']) expect(jobs()[k]?.generating, k).toBe(true)
    g.open()
    await engine.idle()
    expect(jobs()).toEqual({})
  })

  it('clears the mark when nothing needs painting (imported, bundled or cached art)', async () => {
    const { engine, fake, db } = setup({ bundled: ['art/afterhours/nova/tier-1.webp'] })
    await db.images.put({ key: 'nova:tier-2', characterId: 'nova', source: 'imported', blob: png(7), createdAt: 1 })
    engine.onUnlock('nova', [1, 2])
    expect(jobs()['nova:tier-1']?.generating).toBe(true)
    await engine.idle()
    expect(fake.calls).toHaveLength(0)
    expect(jobs()).toEqual({})
    // With generation off nothing is marked at all.
    const off = setup({ image: { enabled: false } })
    off.engine.onUnlock('nova', [3])
    off.engine.onEnding('nova', 'good')
    expect(jobs()).toEqual({})
  })
})

describe('failures', () => {
  it('records a timed-out painting as a failure, even when the transport reports a plain abort', async () => {
    const g = gate()
    // Android's native HTTP: every abort reason comes back as an AbortError.
    const provider = fakeProvider({ wait: () => g.promise })
    const { engine, logs } = setup({ provider })
    const ctrl = new AbortController()
    const slot = tier('nova', 1)
    const run = engine.generateArt(slot, { signal: ctrl.signal })
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1))
    ctrl.abort(new DOMException('The painting timed out.', 'TimeoutError'))
    g.open()
    await expect(run).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(useArtJobs.getState().jobs['nova:tier-1']).toMatchObject({ generating: false })
    expect(useArtJobs.getState().jobs['nova:tier-1']?.error).toMatch(/took too long/)
    expect(logs.at(-1)?.error).toMatch(/took too long/)
  })

  it('a stop by the player is still just stopped', async () => {
    const g = gate()
    const provider = fakeProvider({ wait: () => g.promise })
    const { engine, logs } = setup({ provider })
    const ctrl = new AbortController()
    const run = engine.generateArt(tier('nova', 1), { signal: ctrl.signal })
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1))
    ctrl.abort()
    g.open()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(useArtJobs.getState().jobs['nova:tier-1']).toBeUndefined()
    expect(logs.at(-1)?.error).toBe('Stopped.')
  })
})

describe('the queue and slots that need no painting', () => {
  it("doesn't show a slot with art as painting while another slot paints", async () => {
    const g = gate()
    const provider = fakeProvider({ wait: () => g.promise })
    const { engine, db } = setup({ provider, bundled: ['art/afterhours/kai/tier-1.webp'] })
    await db.images.put({ key: 'nova:tier-2', characterId: 'nova', source: 'imported', blob: png(7), createdAt: 1 })
    engine.onUnlock('theo', [3])
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1))
    engine.onUnlock('kai', [1])
    engine.onUnlock('nova', [2])
    await vi.waitFor(() => {
      expect(useArtJobs.getState().jobs['kai:tier-1']).toBeUndefined()
      expect(useArtJobs.getState().jobs['nova:tier-2']).toBeUndefined()
    })
    expect(useArtJobs.getState().jobs['theo:tier-3']?.generating).toBe(true)
    g.open()
    await engine.idle()
    expect(provider.calls).toHaveLength(1)
  })
})

describe('the route and the player', () => {
  it('paints a friend-route character platonically and states the player as an adult', async () => {
    const s = setup({ heat: 5, trust: { jules: 100 } })
    const engine = createArtEngine({
      resolver: () => s.resolver,
      settings: () => s.settings,
      character,
      trust: () => 100,
      provider: () => s.fake.provider,
      log: () => 'l',
      patchLog: () => undefined,
      compress: async (b) => b,
      route: () => 'friend',
      player: () => ({ name: 'Ana', gender: 'woman', pronouns: 'she/her', bodyNotes: '', relationshipStyle: 'figuring' }),
    })
    await engine.generateArt(tier('jules', 2))
    const prompt = s.fake.calls[0].prompt
    expect(prompt).toContain(FRIEND_MODIFIER)
    expect(prompt).not.toMatch(/\bnude\b|explicit/)
    expect(prompt).toContain('the friend is an adult woman, 21 or older')
    expect(s.fake.calls[0].negative).toContain('nudity')
    const built = await engine.assembleArtPrompt(tier('jules', 2))
    expect(built).toMatchObject({ heat: 1, friend: true })
  })
})

describe("Grok's rewrite of the prompt", () => {
  it('is logged and kept on the stored picture', async () => {
    const calls: ArtRequest[] = []
    const provider: ArtProvider = {
      id: 'grok',
      label: 'Fake Grok',
      available: () => true,
      generate: async (req) => {
        calls.push(req)
        return { blob: png(1), seed: req.seed, revisedPrompt: 'A woman DJ on a rooftop, an adult in her late twenties.' }
      },
      test: async () => ({ ok: true, message: 'ok' }),
    }
    const s = setup({ image: { provider: 'grok' }, provider: { provider, calls } })
    const row = await s.engine.generateArt(tier('nova', 1))
    expect(row?.revisedPrompt).toBe('A woman DJ on a rooftop, an adult in her late twenties.')
    expect((await s.db.images.get(generatedKey(tier('nova', 1))))?.revisedPrompt).toMatch(/late twenties/)
    expect(s.logs.at(-1)?.response).toMatch(/xAI rewrote the prompt and painted from:\nA woman DJ on a rooftop/)
  })
})

describe('assembleArtPrompt', () => {
  it('shows what heat and an ace cap do, without painting', async () => {
    const { engine, settings, fake, logs } = setup({ trust: { minh: 100, nova: 100 } })
    const prompts: string[] = []
    const minhPrompts: string[] = []
    for (const heat of [1, 2, 3, 4, 5] as const) {
      settings.heat = heat
      prompts.push((await engine.assembleArtPrompt(tier('nova', 4))).prompt)
      minhPrompts.push((await engine.assembleArtPrompt(tier('minh', 4), { log: heat === 5 })).prompt)
    }
    expect(new Set(prompts).size).toBe(5)
    expect(new Set(minhPrompts.slice(1)).size).toBe(1)
    expect(fake.calls).toHaveLength(0)
    expect(logs).toHaveLength(1)
    expect(logs[0].prompt).toMatch(/Heat 5, painted at 2/)
    expect(logs[0].response).toMatch(/nothing was sent/)
  })
})

describe('unlockedSlots', () => {
  const nova = bundledEntry('nova')!.character
  const rel = (patch: Partial<Relationship> = {}): Relationship => ({ ...newRelationship('nova'), ...patch })

  it('lists five tiers and seven endings with what unlocks each', () => {
    const slots = unlockedSlots(nova, rel({ tiersUnlocked: [1, 2] }), 'romantic')
    expect(slots).toHaveLength(12)
    expect(slots.slice(0, 5).map((s) => [s.unlocked, s.lock ?? null])).toEqual([
      [true, null],
      [true, null],
      [false, 'Unlocks at 60'],
      [false, 'Unlocks at 80'],
      [false, 'Unlocks at 100'],
    ])
    expect(slots[0]).toMatchObject({ slot: { kind: 'tier', characterId: 'nova', tier: 1 }, title: 'Behind the decks', unlockAt: 20 })
    expect(slots[5]).toMatchObject({ slot: { kind: 'ending', characterId: 'nova', ending: 'good' }, unlocked: false, lock: 'Ending: The good ending', title: 'The good ending' })
    expect(slots.map((s) => slotKey(s.slot))).toContain('nova:ending-reconciliation')
  })

  it('friendship-locks tiers 3 to 5 and the endings on a friend route', () => {
    const slots = unlockedSlots(nova, rel({ tiersUnlocked: [1] }), 'friend')
    expect(slots.map((s) => s.lock ?? null)).toEqual([
      null,
      'Unlocks at 40',
      'Friendship-locked',
      'Friendship-locked',
      'Friendship-locked',
      ...Array(7).fill('Friendship-locked'),
    ])
  })

  it('unlocks played endings, and the Polycule as the group\'s picture', () => {
    const slots = unlockedSlots(nova, rel({ tiersUnlocked: [1, 2, 3, 4, 5], ending: { type: 'polycule', playedAt: 1 } }), 'romantic', {
      endingsSeen: ['good'],
      polycule: ['kai'],
    })
    const byTitle = Object.fromEntries(slots.map((s) => [s.title, s]))
    expect(byTitle['The good ending'].unlocked).toBe(true)
    expect(byTitle['The polycule ending']).toMatchObject({ unlocked: true, slot: { kind: 'group', characterIds: ['kai', 'nova'], slot: 'polycule' } })
    expect(byTitle['The bitter ending'].unlocked).toBe(false)
    expect(slots.every((s, i) => i >= 5 || s.unlocked)).toBe(true)
    expect(unlockedSlots(nova, rel(), 'romantic', { tiersOnly: true })).toHaveLength(5)
  })
})
