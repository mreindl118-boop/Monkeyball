import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_CHARACTER_IDS, BUNDLED_SET_IDS, RESERVED_CHARACTER_IDS } from '../data/bundled'
import novaJson from '../data/sets/afterhours/characters/nova.json'
import { CrushDB } from '../db/db'
import { normalizeCharacter } from '../mods/normalize'
import { exportPackZip, importFile } from '../mods/pack'
import type { Character, SetManifest, Settings, ShowMe } from '../types'
import { createRosterStore, CUSTOM_SET_ID, selectActiveEntries, selectRelationsFor, setsLinked, STORAGE_FIELD, type SettingsAccess } from './roster'

let counter = 0
const open: CrushDB[] = []
function freshDb(): CrushDB {
  const d = new CrushDB(`roster-test-${Date.now()}-${counter++}`)
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

function fakeSettings(activeSets: string[] = ['afterhours']): SettingsAccess & { active: () => string[] } {
  let settings: Pick<Settings, 'activeSets'> = { activeSets }
  return {
    getState: () => ({
      settings,
      update: async (patch: Partial<Settings>) => {
        settings = { ...settings, ...patch }
      },
    }),
    active: () => settings.activeSets,
  }
}

async function setup(activeSets?: string[]) {
  const d = freshDb()
  const settings = fakeSettings(activeSets)
  const store = createRosterStore({ db: d, settings })
  await store.getState().load()
  return { d, settings, store }
}

function card(id: string, name: string, extra: Partial<Character> = {}): Character {
  const c = normalizeCharacter(novaJson)
  delete c.partners
  return { ...c, id, name, ...extra }
}

const ids = (list: { character: Character }[]) => list.map((e) => e.character.id)
const view = (showMe: ShowMe, activeSets = ['afterhours']) => ({ activeSets, showMe })

describe('useRoster: bundled sets', () => {
  it('loads Afterhours (and every other bundled set) from the bundle', async () => {
    const { store } = await setup()
    const s = store.getState()
    expect(s.loaded).toBe(true)
    expect(s.sets.map((x) => x.id)).toEqual([...BUNDLED_SET_IDS])
    expect(s.sets[0].id).toBe('afterhours')
    expect(Object.keys(s.entries)).toHaveLength(BUNDLED_CHARACTER_IDS.length)
    expect(Object.values(s.entries).filter((e) => e.setId === 'afterhours')).toHaveLength(12)
    expect(s.entries.nova).toMatchObject({ setId: 'afterhours', source: 'bundled' })
    expect(s.setOf('nova')?.name).toBe('Afterhours')
    expect(s.setOf('nobody')).toBeUndefined()
  })

  it('filters by Show me: nonbinary characters appear under everyone only', async () => {
    const { store } = await setup()
    const s = store.getState()
    expect(ids(s.activeEntries(view('everyone')))).toEqual([
      'nova', 'kai', 'vesper', 'theo', 'dex', 'imani', 'rook', 'sasha', 'jules', 'marlowe', 'priya', 'cass',
    ])
    expect(ids(s.activeEntries(view('women')))).toEqual(['nova', 'vesper', 'imani', 'sasha', 'priya'])
    expect(ids(s.activeEntries(view('men')))).toEqual(['theo', 'dex', 'jules', 'marlowe', 'cass'])
    for (const showMe of ['women', 'men'] as const) {
      const got = ids(s.activeEntries(view(showMe)))
      expect(got).not.toContain('kai')
      expect(got).not.toContain('rook')
    }
  })

  it('shows only active sets', async () => {
    const { store } = await setup()
    expect(store.getState().activeEntries(view('everyone', []))).toEqual([])
    expect(store.getState().activeEntries(view('everyone', ['nowhere']))).toEqual([])
    // Only Afterhours is on by default; another bundled set's characters stay out of it.
    const afterhours = ids(store.getState().activeEntries(view('everyone')))
    expect(afterhours).toHaveLength(12)
    expect(store.getState().activeEntries(view('everyone')).every((e) => e.setId === 'afterhours')).toBe(true)
  })

  it('merges manifest relationships and card partners without duplicates', async () => {
    const { store } = await setup()
    const nova = store.getState().relationsFor('nova')
    const kai = nova.filter((r) => r.id === 'kai')
    expect(kai).toHaveLength(1)
    expect(kai[0]).toMatchObject({ kind: 'ex', from: 'manifest', setId: 'afterhours' })
    expect(kai[0].note).toMatch(/ended loud/)
    expect(nova.map((r) => r.id)).toEqual(expect.arrayContaining(['kai', 'imani', 'rook']))
    const dex = store.getState().relationsFor('dex')
    expect(dex.map((r) => [r.id, r.kind])).toEqual(expect.arrayContaining([['imani', 'partner'], ['kai', 'rival']]))
    expect(store.getState().relationsFor('nobody')).toEqual([])
    expect(store.getState().relationsFor('nova', [])).toEqual([])
  })
})

describe('useRoster: custom characters', () => {
  it('saves a valid character into My characters and switches that set on', async () => {
    const { d, settings, store } = await setup()
    const issues = await store.getState().saveCustomCharacter(card('sam', 'Sam Ortiz'))
    expect(issues).toEqual([])
    const s = store.getState()
    expect(s.entries.sam).toMatchObject({ setId: CUSTOM_SET_ID, source: 'custom' })
    expect(s.sets.map((x) => x.id)).toEqual([...BUNDLED_SET_IDS, 'custom'])
    expect(s.setOf('sam')).toMatchObject({ id: 'custom', name: 'My characters', characters: ['sam'] })
    expect(settings.active()).toEqual(['afterhours', 'custom'])
    expect(await d.customCharacters.get('sam')).toMatchObject({ setId: 'custom', source: 'custom' })

    // A fresh store over the same database sees it.
    const again = createRosterStore({ db: d, settings })
    await again.getState().load()
    expect(again.getState().entries.sam.character.name).toBe('Sam Ortiz')
  })

  it('refuses invalid characters, taken ids and bundled sets, and saves nothing', async () => {
    const { d, store } = await setup()
    const young = await store.getState().saveCustomCharacter(card('sam', 'Sam', { age: 18 }))
    expect(young.map((i) => i.field)).toEqual(['age'])
    const taken = await store.getState().saveCustomCharacter(card('nova', 'Nova'))
    expect(taken.map((i) => i.message)).toEqual(['Another character already uses the id "nova". Pick a different one.'])
    const bundled = await store.getState().saveCustomCharacter(card('sam', 'Sam'), 'afterhours')
    expect(bundled[0].message).toMatch(/read-only/)
    expect(store.getState().entries.sam).toBeUndefined()
    expect(await d.customCharacters.count()).toBe(0)
  })

  it('updates in place, refuses a new character on a used id, and renames with previousId', async () => {
    const { d, store } = await setup()
    await store.getState().saveCustomCharacter(card('sam', 'Sam'))
    expect(await store.getState().saveCustomCharacter(card('sam', 'Sam again'))).toEqual([])
    expect(store.getState().entries.sam.character.name).toBe('Sam again')
    expect((await store.getState().saveCustomCharacter(card('sam', 'Other Sam'), CUSTOM_SET_ID, null)).map((i) => i.field)).toEqual(['id'])

    await store.getState().saveCustomCharacter(card('lee', 'Lee', { partners: [{ characterId: 'sam', relation: 'ex' }] }))
    expect(await store.getState().saveCustomCharacter(card('samuel', 'Samuel'), CUSTOM_SET_ID, 'sam')).toEqual([])
    const s = store.getState()
    expect(s.entries.sam).toBeUndefined()
    expect(s.entries.samuel.character.name).toBe('Samuel')
    expect(s.entries.lee.character.partners).toEqual([{ characterId: 'samuel', relation: 'ex' }])
    expect(await d.customCharacters.get('sam')).toBeUndefined()
  })

  it('duplicates bundled characters into My characters with fresh ids', async () => {
    const { d, store } = await setup()
    const first = await store.getState().duplicateCharacter('nova')
    const second = await store.getState().duplicateCharacter('nova')
    expect([first, second]).toEqual(['nova-copy', 'nova-copy-2'])
    const copy = store.getState().entries['nova-copy']
    expect(copy).toMatchObject({ setId: 'custom', source: 'custom' })
    expect(copy.character.name).toBe('Nova Castellanos (copy)')
    expect(copy.character.partners).toBeUndefined() // Kai stays in Afterhours
    expect(copy.character.likes).toEqual(store.getState().entries.nova.character.likes)
    expect(store.getState().entries.nova.character.partners).toEqual([{ characterId: 'kai', relation: 'ex' }])
    expect(await store.getState().duplicateCharacter('nova-copy')).toBe('nova-copy-3')

    // An id with leftover progress from a deleted character is skipped.
    await d.relationships.put({ characterId: 'kai-copy' } as never)
    expect(await store.getState().duplicateCharacter('kai')).toBe('kai-copy-2')
    expect(await store.getState().duplicateCharacter('nobody')).toBeNull()
  })

  it('deletes custom characters but never bundled ones', async () => {
    const { d, store } = await setup()
    await store.getState().saveCustomCharacter(card('sam', 'Sam'))
    await store.getState().saveCustomCharacter(card('lee', 'Lee', { partners: [{ characterId: 'sam', relation: 'partner' }] }))
    expect(await store.getState().deleteCustomCharacter('nova')).toBe(false)
    expect(await store.getState().deleteCustomCharacter('sam')).toBe(true)
    expect(store.getState().entries.sam).toBeUndefined()
    expect(store.getState().entries.lee.character.partners).toEqual([])
    expect(await d.customCharacters.get('sam')).toBeUndefined()
    expect(store.getState().entries.nova).toBeDefined()
  })

  it('keeps ids of characters from sets that ship later, and never takes a bundled one', async () => {
    const { store } = await setup()
    const later = RESERVED_CHARACTER_IDS.filter((id) => !BUNDLED_CHARACTER_IDS.includes(id))
    for (const id of later.slice(0, 1)) {
      const issues = await store.getState().saveCustomCharacter(card(id, 'Someone'))
      expect(issues.map((i) => i.message)).toEqual([
        `The id "${id}" is kept for a character in a set that ships with crushLAB. Pick a different one.`,
      ])
    }
    const shipped = RESERVED_CHARACTER_IDS.find((id) => BUNDLED_CHARACTER_IDS.includes(id))
    if (shipped) {
      const issues = await store.getState().saveCustomCharacter(card(shipped, 'Someone'))
      expect(issues.map((i) => i.message)).toEqual([`Another character already uses the id "${shipped}". Pick a different one.`])
    }
    const loose = await store.getState().importPack(await importFile(new Blob([JSON.stringify(card('eli', 'Eli'))]), 'eli.json'))
    expect(loose.ok).toBe(false)
    expect(store.getState().entries.eli?.source).not.toBe('imported')
  })

  it('waits for the first load before a save, so the save survives it', async () => {
    const d = freshDb()
    await d.customCharacters.put({ id: 'old', setId: CUSTOM_SET_ID, character: card('old', 'Old'), source: 'custom', updatedAt: 1 })
    const store = createRosterStore({ db: d, settings: fakeSettings() })
    const loading = store.getState().load()
    expect(await store.getState().saveCustomCharacter(card('fresh', 'Fresh'))).toEqual([])
    await loading
    expect(Object.keys(store.getState().entries)).toEqual(expect.arrayContaining(['old', 'fresh']))
    // A reload that overlaps a write reads it too.
    const reload = store.getState().reload()
    const write = store.getState().saveCustomCharacter(card('later', 'Later'))
    await Promise.all([reload, write])
    await store.getState().reload()
    expect(Object.keys(store.getState().entries)).toEqual(expect.arrayContaining(['old', 'fresh', 'later']))
  })

  it('says when storage refused a save, and keeps the character for the session', async () => {
    const { d, store } = await setup()
    d.close()
    const issues = await store.getState().saveCustomCharacter(card('sam', 'Sam'))
    expect(issues.map((i) => i.field)).toEqual([STORAGE_FIELD])
    expect(issues[0].message).toMatch(/only lasts until crushLAB closes/)
    expect(store.getState().error).toBeTruthy()
    expect(store.getState().entries.sam).toBeDefined()
    const outcome = await store.getState().importPack(await importFile(new Blob([JSON.stringify(card('ash-b', 'Ash'))]), 'ash.json'))
    expect(outcome.ok).toBe(false)
    expect(outcome.saved).toEqual(['ash-b'])
    expect(outcome.errors.map((e) => e.message)).toEqual([expect.stringMatching(/storage refused/)])
  })

  it('imports a loose card whose partner stayed behind, without that partner', async () => {
    const { store } = await setup()
    const lee = card('lee-b', 'Lee', { partners: [{ characterId: 'sam-b', relation: 'partner' }] })
    const outcome = await store.getState().importPack({ name: 'lee.json', kind: 'character', characters: [lee], art: [], errors: [] })
    expect(outcome).toMatchObject({ ok: false, setId: CUSTOM_SET_ID, saved: ['lee-b'] })
    expect(outcome.errors.map((e) => e.message)).toEqual([expect.stringMatching(/Left out partner "sam-b"/)])
    expect(store.getState().entries['lee-b'].character.partners).toBeUndefined()
  })

  it('offers the editor a validation context', async () => {
    const { store } = await setup()
    await store.getState().saveCustomCharacter(card('sam', 'Sam'))
    const edit = store.getState().validationContext(CUSTOM_SET_ID, 'sam', 'sam')
    expect(edit.existingIds).not.toContain('sam')
    expect(edit.existingIds).toContain('nova')
    expect(edit.setCharacterIds).toEqual(['sam'])
    const fresh = store.getState().validationContext(CUSTOM_SET_ID, null, 'lee')
    expect(fresh.existingIds).toContain('sam')
    expect(fresh.setCharacterIds).toEqual(['sam', 'lee'])
  })
})

describe('useRoster: packs', () => {
  const manifest = (extra: Partial<SetManifest> = {}): SetManifest => ({
    id: 'harbor-lights',
    name: 'Harbor lights',
    blurb: 'Two exes who run rival bars on the same pier.',
    characters: ['sam', 'lee'],
    relationships: [{ a: 'sam', b: 'lee', kind: 'ex', note: 'They split the pier.' }],
    ...extra,
  })
  const pair = () => [
    card('sam', 'Sam Ortiz', { partners: [{ characterId: 'lee', relation: 'ex' }] }),
    card('lee', 'Lee Park', { gender: 'nonbinary', pronouns: 'they/them', partners: [{ characterId: 'sam', relation: 'ex' }] }),
  ]
  const art = [{ characterId: 'sam', tier: 1 as const, blob: new Blob([new Uint8Array([1, 2])], { type: 'image/png' }) }]

  it('imports a .zip pack: characters, manifest, art, active set', async () => {
    const { d, settings, store } = await setup()
    const result = await importFile(await exportPackZip(manifest(), pair(), art), 'harbor.zip')
    const outcome = await store.getState().importPack(result)
    expect(outcome).toEqual({ ok: true, setId: 'harbor-lights', saved: ['sam', 'lee'], errors: [] })
    const s = store.getState()
    expect(s.sets.map((x) => x.id)).toEqual([...BUNDLED_SET_IDS, 'harbor-lights'])
    expect(s.entries.lee).toMatchObject({ setId: 'harbor-lights', source: 'imported' })
    expect(settings.active()).toContain('harbor-lights')
    expect(ids(s.activeEntries({ activeSets: settings.active(), showMe: 'everyone' })).slice(-2)).toEqual(['sam', 'lee'])
    expect(ids(s.activeEntries({ activeSets: settings.active(), showMe: 'men' }))).not.toContain('lee')
    expect(await d.packs.get('harbor-lights')).toMatchObject({ manifest: { name: 'Harbor lights' } })
    // Pack art has its own row, so it never replaces the player's own image for the slot.
    const img = await d.images.get('sam:tier-1#pack')
    expect(img).toMatchObject({ characterId: 'sam', source: 'imported', pack: 'harbor-lights' })
    expect(await d.images.get('sam:tier-1')).toBeUndefined()
    expect(s.relationsFor('sam')).toEqual([{ id: 'lee', kind: 'ex', note: 'They split the pier.', setId: 'harbor-lights', from: 'manifest' }])
    // Sets don't know each other unless a manifest says so.
    expect(setsLinked(s, 'harbor-lights', 'afterhours')).toBe(false)
  })

  it('replaces a pack on re-import, asking first when characters would leave, and removes it without touching progress', async () => {
    const { d, settings, store } = await setup()
    await store.getState().importPack(await importFile(await exportPackZip(manifest(), pair()), 'a.zip'))
    const [sam] = pair()
    const solo = await importFile(
      await exportPackZip(manifest({ characters: ['sam'], relationships: [] }), [{ ...sam, partners: undefined, name: 'Sam v2' }]),
      'b.zip',
    )
    const ask = await store.getState().importPack(solo)
    expect(ask).toMatchObject({ ok: false, saved: [], confirm: { setId: 'harbor-lights', removes: [{ id: 'lee', name: 'Lee Park' }] } })
    expect(store.getState().entries.lee).toBeDefined()
    expect(store.getState().entries.sam.character.name).toBe('Sam Ortiz')
    const done = await store.getState().importPack(solo, { replace: true })
    expect(done).toMatchObject({ ok: true, saved: ['sam'], removed: ['lee'] })
    expect(store.getState().entries.lee).toBeUndefined()
    expect(store.getState().entries.sam.character.name).toBe('Sam v2')

    await d.relationships.put({ characterId: 'sam', affection: 50 } as never)
    await store.getState().removePack('harbor-lights')
    expect(store.getState().entries.sam).toBeUndefined()
    expect(store.getState().sets.map((x) => x.id)).toEqual([...BUNDLED_SET_IDS])
    expect(settings.active()).not.toContain('harbor-lights')
    expect(await d.packs.count()).toBe(0)
    expect(await d.customCharacters.count()).toBe(0)
    expect(await d.relationships.get('sam')).toBeDefined()
  })

  it('replaces a pack with the same cards, name and author without asking', async () => {
    const { store } = await setup()
    const file = await exportPackZip(manifest(), pair())
    await store.getState().importPack(await importFile(file, 'a.zip'))
    const again = await store.getState().importPack(await importFile(file, 'a.zip'))
    expect(again).toEqual({ ok: true, setId: 'harbor-lights', saved: ['sam', 'lee'], errors: [] })
  })

  it('asks before an unrelated pack with the same id replaces this one', async () => {
    const { store } = await setup()
    await store.getState().importPack(await importFile(await exportPackZip(manifest({ author: 'A' }), pair()), 'a.zip'))
    const other = await importFile(
      await exportPackZip(manifest({ name: 'Someone else', author: 'B', characters: ['mia'], relationships: [] }), [card('mia', 'Mia')]),
      'b.zip',
    )
    const ask = await store.getState().importPack(other)
    expect(ask.confirm).toMatchObject({ oldName: 'Harbor lights', oldAuthor: 'A', newName: 'Someone else', newAuthor: 'B' })
    expect(ask.confirm?.removes.map((r) => r.id)).toEqual(['sam', 'lee'])
    expect(Object.keys(store.getState().entries)).toEqual(expect.arrayContaining(['sam', 'lee']))
    expect(store.getState().entries.mia).toBeUndefined()
  })

  it("keeps a character whose card in the new file failed, instead of deleting them", async () => {
    const { d, store } = await setup()
    await store.getState().importPack(await importFile(await exportPackZip(manifest(), pair()), 'a.zip'))
    const [sam, lee] = pair()
    const result = await importFile(await exportPackZip(manifest(), [sam, { ...lee, age: 19 }]), 'b.zip')
    expect(result.characters.map((c) => c.id)).toEqual([]) // sam's partner failed, so sam went too
    const partial = await importFile(
      await exportPackZip(manifest({ relationships: [] }), [{ ...sam, partners: undefined, name: 'Sam v2' }, { ...lee, partners: undefined, age: 19 }]),
      'c.zip',
    )
    expect(partial.characters.map((c) => c.id)).toEqual(['sam'])
    const outcome = await store.getState().importPack(partial)
    expect(outcome).toMatchObject({ ok: true, saved: ['sam'], kept: ['lee'] })
    expect(outcome.confirm).toBeUndefined()
    expect(store.getState().entries.lee).toMatchObject({ setId: 'harbor-lights' })
    expect(store.getState().entries.lee.character.age).not.toBe(19)
    expect(await d.customCharacters.get('lee')).toBeDefined()
  })

  it("never deletes the player's own characters saved into a pack", async () => {
    const { d, settings, store } = await setup()
    const file = await exportPackZip(manifest(), pair())
    await store.getState().importPack(await importFile(file, 'harbor.zip'))
    const mine = card('mia', 'Mia', { partners: [{ characterId: 'lee', relation: 'situationship' }] })
    expect(await store.getState().saveCustomCharacter(mine, 'harbor-lights', null)).toEqual([])
    expect(store.getState().entries.mia).toMatchObject({ setId: 'harbor-lights', source: 'custom' })

    // Re-importing the same file keeps Mia in the pack.
    expect((await store.getState().importPack(await importFile(file, 'harbor.zip'))).ok).toBe(true)
    expect(store.getState().entries.mia).toMatchObject({ setId: 'harbor-lights', source: 'custom' })
    expect(store.getState().setOf('mia')?.characters).toEqual(['sam', 'lee', 'mia'])

    // A pack file that uses Mia's id can't take her place.
    const clash = await importFile(
      await exportPackZip(manifest({ characters: ['sam', 'lee', 'mia'] }), [...pair(), card('mia', 'Pack Mia')]),
      'clash.zip',
    )
    expect((await store.getState().importPack(clash)).ok).toBe(false)
    expect(store.getState().entries.mia.character.name).toBe('Mia')

    // Removing the pack moves her to My characters, without the partner who left with it.
    expect(await store.getState().removePack('harbor-lights')).toEqual(['mia'])
    expect(store.getState().entries.mia).toMatchObject({ setId: CUSTOM_SET_ID, source: 'custom' })
    expect(store.getState().entries.mia.character.partners).toBeUndefined()
    expect(store.getState().entries.lee).toBeUndefined()
    expect(settings.active()).toContain(CUSTOM_SET_ID)
    expect(await d.customCharacters.get('mia')).toMatchObject({ setId: CUSTOM_SET_ID })
  })

  it('rejects a pack that reuses a bundled id or a bundled set id', async () => {
    const { d, store } = await setup()
    const clash = await importFile(
      await exportPackZip(manifest({ characters: ['nova'], relationships: [] }), [card('nova', 'Other Nova')]),
      'clash.zip',
    )
    const outcome = await store.getState().importPack(clash)
    expect(outcome.ok).toBe(false)
    expect(outcome.errors[0].message).toMatch(/already uses the id "nova"/)
    const setClash = await importFile(
      await exportPackZip(manifest({ id: 'afterhours', characters: ['sam'], relationships: [] }), [card('sam', 'Sam')]),
      'set.zip',
    )
    expect((await store.getState().importPack(setClash)).errors[0].message).toMatch(/ships with crushLAB/)
    const later = await importFile(
      await exportPackZip(manifest({ id: 'slow-burn', characters: ['sam'], relationships: [] }), [card('sam', 'Sam')]),
      'later.zip',
    )
    expect((await store.getState().importPack(later)).ok).toBe(false)
    expect(await d.packs.count()).toBe(0)
    expect(await d.customCharacters.count()).toBe(0)
  })

  it('passes on what importFile already rejected', async () => {
    const { store } = await setup()
    const result = await importFile(new Blob(['nope']), 'x.json')
    const outcome = await store.getState().importPack(result)
    expect(outcome.ok).toBe(false)
    expect(outcome.saved).toEqual([])
    expect(outcome.errors).toEqual(result.errors)
  })

  it('imports loose characters into My characters', async () => {
    const { settings, store } = await setup()
    const result = await importFile(new Blob([JSON.stringify([card('arlo', 'Arlo'), card('bo', 'Bo')])]), 'two.json')
    const outcome = await store.getState().importPack(result)
    expect(outcome).toEqual({ ok: true, setId: 'custom', saved: ['arlo', 'bo'], errors: [] })
    expect(store.getState().entries.arlo).toMatchObject({ setId: 'custom', source: 'imported' })
    expect(settings.active()).toContain('custom')
    // Importing the same file again clashes with what is now saved.
    const again = await store.getState().importPack(result)
    expect(again.ok).toBe(false)
    expect(again.saved).toEqual([])
  })

  it("won't let a pack give a bundled character a partner or an ex through knows", async () => {
    const { store } = await setup(['afterhours', 'harbor-lights'])
    const [sam] = pair()
    const result = await importFile(
      await exportPackZip(
        manifest({ characters: ['sam'], knows: ['afterhours'], relationships: [{ a: 'sam', b: 'nova', kind: 'ex', note: '' }] }),
        [{ ...sam, partners: undefined }],
      ),
      'ex.zip',
    )
    expect(result.characters).toEqual([])
    expect((await store.getState().importPack(result)).ok).toBe(false)
    expect(selectRelationsFor(store.getState(), 'nova').map((r) => r.id)).not.toContain('sam')
  })

  it('leaves out partner kinds that cross sets even when a stored pack has them', async () => {
    const d = freshDb()
    const [sam] = pair()
    await d.packs.put({
      id: 'harbor-lights',
      importedAt: 1,
      manifest: manifest({ characters: ['sam'], knows: ['afterhours'], relationships: [{ a: 'sam', b: 'nova', kind: 'ex', note: '' }, { a: 'sam', b: 'kai', kind: 'friend', note: '' }] }),
    })
    await d.customCharacters.put({ id: 'sam', setId: 'harbor-lights', character: { ...sam, partners: undefined }, source: 'imported', updatedAt: 1 })
    const store = createRosterStore({ db: d, settings: fakeSettings(['afterhours', 'harbor-lights']) })
    await store.getState().load()
    expect(selectRelationsFor(store.getState(), 'nova').map((r) => r.id)).not.toContain('sam')
    expect(selectRelationsFor(store.getState(), 'kai').find((r) => r.id === 'sam')).toMatchObject({ kind: 'friend' })
  })

  it('links sets through knows', async () => {
    const { store } = await setup(['afterhours', 'harbor-lights'])
    const [sam] = pair()
    const result = await importFile(
      await exportPackZip(
        manifest({
          characters: ['sam'],
          knows: ['afterhours'],
          relationships: [{ a: 'sam', b: 'nova', kind: 'friend', note: 'Sam drinks at the Low Tide.' }],
        }),
        [{ ...sam, partners: undefined }],
      ),
      'knows.zip',
    )
    expect(result.errors).toEqual([])
    expect((await store.getState().importPack(result)).ok).toBe(true)
    const s = store.getState()
    expect(setsLinked(s, 'afterhours', 'harbor-lights')).toBe(true)
    expect(selectRelationsFor(s, 'nova').find((r) => r.id === 'sam')).toMatchObject({ kind: 'friend', setId: 'harbor-lights' })
    expect(selectRelationsFor(s, 'sam').map((r) => r.id)).toEqual(['nova'])
    // Hidden when Afterhours is switched off.
    expect(selectRelationsFor(s, 'sam', ['harbor-lights'])).toEqual([])
    expect(ids(selectActiveEntries(s, { activeSets: ['harbor-lights'], showMe: 'everyone' }))).toEqual(['sam'])
  })
})
