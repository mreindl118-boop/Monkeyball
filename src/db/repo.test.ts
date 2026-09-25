import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultRelationship, defaultSettings } from '../store/defaults'
import type { DateRecord, PlayerProfile, Settings } from '../types'
import { CrushDB } from './db'
import {
  createSlot,
  deleteSlot,
  exportSave,
  getAllRelationships,
  getDate,
  getImage,
  getRelationship,
  importSave,
  kvDelete,
  kvGet,
  kvSet,
  listDates,
  listSlots,
  parseSave,
  putDate,
  putImage,
  putRelationship,
  restoreSlot,
  SaveFormatError,
  snapshot,
  wipeAll,
} from './repo'

let counter = 0
const open: CrushDB[] = []
function freshDb(): CrushDB {
  const d = new CrushDB(`repo-test-${Date.now()}-${counter++}`)
  open.push(d)
  return d
}

afterEach(async () => {
  while (open.length) {
    const d = open.pop()!
    d.close()
    await d.delete()
  }
})

const profile: PlayerProfile = {
  name: 'Robin',
  gender: 'nonbinary',
  pronouns: 'they/them',
  bodyNotes: '',
  relationshipStyle: 'open',
}

function sampleDate(characterId: string, startedAt: number): DateRecord {
  return {
    kind: 'single',
    characterIds: [characterId],
    venueId: 'record-store',
    startedAt,
    maxTurns: 10,
    turns: [{ role: 'player', text: 'Hi', at: startedAt }],
    totals: { [characterId]: { affection: 3, trust: 1, gained: 3 } },
  }
}

async function seed(d: CrushDB) {
  const settings: Settings = defaultSettings()
  settings.ageConfirmed = true
  settings.connection.providers.claude.apiKey = 'sk-secret'
  settings.connection.story = { preset: 'ollama', model: 'llama3.1' }
  await kvSet('settings', settings, d)
  await kvSet('profile', profile, d)
  await putRelationship({ ...defaultRelationship('nova'), affection: 42, trust: 17 }, d)
  await putDate(sampleDate('nova', 1000), d)
}

describe('kv', () => {
  it('round-trips values and deletes', async () => {
    const d = freshDb()
    expect(await kvGet('profile', d)).toBeUndefined()
    await kvSet('profile', profile, d)
    expect(await kvGet<PlayerProfile>('profile', d)).toEqual(profile)
    await kvDelete('profile', d)
    expect(await kvGet('profile', d)).toBeUndefined()
  })
})

describe('relationships and dates', () => {
  it('puts and gets relationships', async () => {
    const d = freshDb()
    expect(await getRelationship('nova', d)).toBeUndefined()
    await putRelationship({ ...defaultRelationship('nova'), affection: 10 }, d)
    await putRelationship(defaultRelationship('kai'), d)
    expect((await getRelationship('nova', d))?.affection).toBe(10)
    expect((await getAllRelationships(d)).map((r) => r.characterId).sort()).toEqual(['kai', 'nova'])
  })

  it('stores dates with generated ids and lists them per character', async () => {
    const d = freshDb()
    const a = await putDate(sampleDate('nova', 2000), d)
    const b = await putDate(sampleDate('kai', 1000), d)
    expect(a).not.toBe(b)
    expect((await getDate(a, d))?.venueId).toBe('record-store')
    expect((await listDates(undefined, d)).map((r) => r.id)).toEqual([b, a])
    expect((await listDates('nova', d)).map((r) => r.id)).toEqual([a])
  })
})

describe('wipeAll', () => {
  it('clears every table', async () => {
    const d = freshDb()
    await seed(d)
    await createSlot('before', d)
    await putImage(
      { key: 'nova:tier-1', characterId: 'nova', source: 'imported', blob: new Blob(['x']), createdAt: 1 },
      d,
    )
    await wipeAll(d)
    for (const t of d.tables) expect(await t.count()).toBe(0)
  })
})

describe('export and import', () => {
  it('never exports API keys, including the ones kept per preset', async () => {
    const d = freshDb()
    await seed(d)
    const stored = (await kvGet<Settings>('settings', d))!
    stored.connection.providers.openrouter = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-kept' }
    await kvSet('settings', stored, d)
    const text = await (await exportSave({}, d)).text()
    expect(text).not.toContain('sk-secret')
    expect(text).not.toContain('sk-or-kept')
    const plain = parseSave(text)
    const s = plain.kv.find((r) => r.key === 'settings')!.value as Settings
    expect(Object.values(s.connection.providers).every((p) => p.apiKey === '')).toBe(true)
    expect(s.connection.providers.openrouter).toEqual({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: '' })
    expect(s.connection.story).toEqual({ preset: 'ollama', model: 'llama3.1' })
    expect(plain.relationships).toHaveLength(1)
    expect(plain.dates).toHaveLength(1)
  })

  it('import replaces everything and keeps the local key when the file has none', async () => {
    const source = freshDb()
    await seed(source)
    const file = await exportSave({}, source)

    const target = freshDb()
    const local = defaultSettings()
    local.connection.providers.claude.apiKey = 'sk-local'
    await kvSet('settings', local, target)
    await putRelationship(defaultRelationship('kai'), target)
    await putDate(sampleDate('kai', 5), target)

    await importSave(file, target)
    expect((await getAllRelationships(target)).map((r) => r.characterId)).toEqual(['nova'])
    expect((await getRelationship('nova', target))?.affection).toBe(42)
    expect(await kvGet('profile', target)).toEqual(profile)
    const s = (await kvGet<Settings>('settings', target))!
    expect(s.ageConfirmed).toBe(true)
    expect(s.connection.providers.claude.apiKey).toBe('sk-local')
    const dates = await listDates(undefined, target)
    expect(dates).toHaveLength(1)
    expect(dates[0].characterIds).toEqual(['nova'])
  })

  it("import never moves this device's key onto a different preset", async () => {
    const source = freshDb()
    await seed(source)
    const srcSettings = (await kvGet<Settings>('settings', source))!
    srcSettings.connection.providers.custom = { baseUrl: 'http://192.168.1.9:8080/v1', apiKey: '' }
    srcSettings.connection.story = { preset: 'custom', model: 'm' }
    await kvSet('settings', srcSettings, source)
    const file = await exportSave({}, source)

    const target = freshDb()
    const local = defaultSettings()
    local.connection.providers.openrouter = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-local' }
    local.connection.story = { preset: 'openrouter', model: 'x' }
    await kvSet('settings', local, target)

    await importSave(file, target)
    const s = (await kvGet<Settings>('settings', target))!
    expect(s.connection.story.preset).toBe('custom')
    expect(s.connection.providers.custom).toEqual({ baseUrl: 'http://192.168.1.9:8080/v1', apiKey: '' })
    expect(s.connection.providers.openrouter).toEqual({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-local' })
  })

  it('round-trips images as base64 when asked', async () => {
    const source = freshDb()
    await seed(source)
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    await putImage(
      {
        key: 'nova:tier-1',
        characterId: 'nova',
        source: 'generated',
        blob: new Blob([bytes], { type: 'image/png' }),
        seed: 7,
        createdAt: 3,
      },
      source,
    )
    const file = await exportSave({ includeImages: true }, source)
    const target = freshDb()
    await importSave(file, target)
    const img = await getImage('nova:tier-1', target)
    expect(img?.seed).toBe(7)
    expect(img?.blob.type).toBe('image/png')
    expect(new Uint8Array(await img!.blob.arrayBuffer())).toEqual(bytes)
  })

  it('rejects files that are not saves, with readable errors', async () => {
    const d = freshDb()
    await seed(d)
    await expect(importSave('not json', d)).rejects.toBeInstanceOf(SaveFormatError)
    await expect(importSave('{"hello":1}', d)).rejects.toThrow(/crushLAB save/)
    await expect(importSave('{"version":2}', d)).rejects.toThrow(/newer version/)
    await expect(importSave('{"version":1,"kv":[]}', d)).rejects.toThrow(/missing/)
    // Nothing was replaced.
    expect((await getRelationship('nova', d))?.affection).toBe(42)
  })
})

describe('save slots', () => {
  it('creates, lists, restores and deletes slots without touching settings', async () => {
    const d = freshDb()
    await seed(d)
    const slot = await createSlot('  Before the rooftop  ', d)
    expect(slot.label).toBe('Before the rooftop')
    expect(slot.data.kv.some((r) => r.key === 'settings')).toBe(false)

    // Play on: progress changes and settings change.
    await putRelationship({ ...defaultRelationship('nova'), affection: 90 }, d)
    await putRelationship(defaultRelationship('kai'), d)
    const changed = (await kvGet<Settings>('settings', d))!
    changed.heat = 4
    await kvSet('settings', changed, d)

    await new Promise((r) => setTimeout(r, 2))
    await createSlot('', d)
    const slots = await listSlots(d)
    expect(slots.map((s) => s.label)).toEqual(['Untitled save', 'Before the rooftop'])
    expect(slots[1]).toMatchObject({ characters: 1, dates: 1 })

    await restoreSlot(slot.id, d)
    expect((await getRelationship('nova', d))?.affection).toBe(42)
    expect(await getRelationship('kai', d)).toBeUndefined()
    expect((await kvGet<Settings>('settings', d))?.heat).toBe(4)
    expect(await kvGet('profile', d)).toEqual(profile)

    await deleteSlot(slot.id, d)
    expect((await listSlots(d)).map((s) => s.id)).not.toContain(slot.id)
    await expect(restoreSlot(slot.id, d)).rejects.toThrow()
  })

  it('snapshot without settings leaves settings out', async () => {
    const d = freshDb()
    await seed(d)
    const snap = await snapshot({ withSettings: false }, d)
    expect(snap.kv.map((r) => r.key)).toEqual(['profile'])
  })
})
