// Save export/import coverage (docs/SPEC.md, Phase 6 "save export/import"): a save file carries
// everything that makes up a game on this device (profile, settings without keys, relationships,
// game state, custom and imported characters, packs, dates, the open date's mark, art favorites
// and group art, images when asked) and a round trip into an empty device restores all of it.
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { newGameState } from '../engine/relationship'
import { defaultRelationship, defaultSettings } from '../store/defaults'
import type { Character, DateRecord, PlayerProfile, Settings } from '../types'
import { CrushDB } from './db'
import { exportSave, getImage, importSave, kvGet, kvSet, putDate, putImage, putRelationship } from './repo'

let counter = 0
const open: CrushDB[] = []
function freshDb(): CrushDB {
  const d = new CrushDB(`save-roundtrip-${Date.now()}-${counter++}`)
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

const nova = JSON.parse(
  readFileSync(new URL('../data/sets/afterhours/characters/nova.json', import.meta.url), 'utf8'),
) as Character

const profile: PlayerProfile = {
  name: 'Robin',
  gender: 'nonbinary',
  pronouns: 'they/them',
  bodyNotes: 'Tall, freckles',
  relationshipStyle: 'polyamorous',
}

function date(characterIds: string[], startedAt: number): DateRecord {
  return {
    kind: characterIds.length > 1 ? 'group' : 'single',
    characterIds,
    venueId: 'rooftop-bar',
    startedAt,
    maxTurns: 10,
    turns: [{ role: 'player', text: 'Hey', at: startedAt }],
    totals: Object.fromEntries(characterIds.map((id) => [id, { affection: 4, trust: 2, gained: 4 }])),
  } as DateRecord
}

async function seedEverything(d: CrushDB) {
  const settings: Settings = defaultSettings()
  settings.ageConfirmed = true
  settings.onboarded = true
  settings.heat = 4
  settings.activeSets = ['afterhours', 'polycule', 'my-pack']
  settings.connection.providers.claude.apiKey = 'sk-ant-SECRET'
  settings.connection.providers.grok = { ...settings.connection.providers.grok, apiKey: 'xai-SECRET' }
  await kvSet('settings', settings, d)
  await kvSet('profile', profile, d)
  const game = { ...newGameState(5), dateCount: 3 }
  await kvSet('game', game, d)
  await kvSet('activeDate', { dateId: 2 }, d)
  await kvSet('artFavorites', ['nova:tier-1'], d)
  await kvSet('artGroups', ['group:kai+nova:tier-1'], d)
  await kvSet('ui', { lastTab: 'saves' }, d)

  await putRelationship({ ...defaultRelationship('nova'), affection: 61, trust: 40, memory: ['Rooftop, first kiss'] }, d)
  await putRelationship({ ...defaultRelationship('mine-1'), affection: 12 }, d)
  await putDate(date(['nova'], 100), d)
  await putDate(date(['nova', 'kai'], 200), d)

  await d.customCharacters.put({
    id: 'mine-1',
    setId: 'custom',
    source: 'custom',
    updatedAt: 7,
    character: { ...nova, id: 'mine-1', name: 'Mina Vale', partners: [] },
  })
  await d.customCharacters.put({
    id: 'packed-1',
    setId: 'my-pack',
    source: 'imported',
    updatedAt: 8,
    character: { ...nova, id: 'packed-1', name: 'Pax Rook', partners: [] },
  })
  await d.packs.put({
    id: 'my-pack',
    importedAt: 9,
    manifest: { id: 'my-pack', name: 'My pack', blurb: 'A pack.', author: 'Robin', characters: ['packed-1'], relationships: [] },
  })

  await putImage(
    {
      key: 'nova:tier-1',
      characterId: 'nova',
      source: 'generated',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
      prompt: 'adult woman, 28 years old',
      seed: 11,
      createdAt: 12,
      favorite: true,
      revisedPrompt: 'what was painted',
    },
    d,
  )
  await putImage(
    {
      key: 'packed-1:tier-1#pack',
      characterId: 'packed-1',
      source: 'imported',
      blob: new Blob([new Uint8Array([9])], { type: 'image/png' }),
      createdAt: 13,
      pack: 'my-pack',
    },
    d,
  )
}

async function tables(d: CrushDB) {
  const kv = await d.kv.toArray()
  return {
    kv: Object.fromEntries(kv.map((r) => [r.key, r.value])),
    relationships: await d.relationships.orderBy('characterId').toArray(),
    customCharacters: await d.customCharacters.orderBy('id').toArray(),
    packs: await d.packs.toArray(),
    dates: await d.dates.orderBy('startedAt').toArray(),
  }
}

describe('save file round trip', () => {
  it('carries everything but API keys, and restores it on an empty device', async () => {
    const source = freshDb()
    await seedEverything(source)
    const blob = await exportSave({ includeImages: true }, source)
    const text = await blob.text()
    expect(text).not.toMatch(/SECRET/)

    const target = freshDb()
    await importSave(text, target)

    const before = await tables(source)
    const after = await tables(target)
    // Everything but the keys is identical: profile, game, open date mark, favorites, groups, ui.
    for (const key of ['profile', 'game', 'activeDate', 'artFavorites', 'artGroups', 'ui']) {
      expect(after.kv[key], key).toEqual(before.kv[key])
    }
    const s = after.kv.settings as Settings
    const orig = before.kv.settings as Settings
    expect(s.heat).toBe(4)
    expect(s.activeSets).toEqual(orig.activeSets)
    expect(s.connection.providers.claude.apiKey).toBe('')
    expect(s.connection.providers.grok.apiKey).toBe('')
    expect(after.relationships).toEqual(before.relationships)
    expect(after.customCharacters).toEqual(before.customCharacters)
    expect(after.packs).toEqual(before.packs)
    // Date ids survive, so the open date's mark still points at its record.
    expect(after.dates).toEqual(before.dates)

    const art = await getImage('nova:tier-1', target)
    expect(art).toMatchObject({ favorite: true, seed: 11, revisedPrompt: 'what was painted', source: 'generated' })
    expect(new Uint8Array(await art!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(await getImage('packed-1:tier-1#pack', target)).toMatchObject({ pack: 'my-pack', source: 'imported' })
  })

  it('leaves images out unless asked, and a second export of the import matches the first', async () => {
    const source = freshDb()
    await seedEverything(source)
    const first = JSON.parse(await (await exportSave({}, source)).text())
    expect(first.images).toBeUndefined()

    const target = freshDb()
    await importSave(JSON.stringify(first), target)
    const second = JSON.parse(await (await exportSave({}, target)).text())
    expect({ ...second, exportedAt: 0 }).toEqual({ ...first, exportedAt: 0 })
  })

  it('replaces the game already on the device instead of merging into it', async () => {
    const source = freshDb()
    await seedEverything(source)
    const file = await exportSave({}, source)

    const target = freshDb()
    await putRelationship({ ...defaultRelationship('kai'), affection: 90 }, target)
    await putDate(date(['kai'], 50), target)
    await kvSet('profile', { ...profile, name: 'Someone else' }, target)
    await importSave(file, target)

    expect(await target.relationships.get('kai')).toBeUndefined()
    expect((await target.dates.toArray()).every((r) => r.characterIds.includes('nova'))).toBe(true)
    expect((await kvGet<PlayerProfile>('profile', target))?.name).toBe('Robin')
  })
})
