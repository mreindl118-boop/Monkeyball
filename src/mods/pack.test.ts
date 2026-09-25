import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import novaJson from '../data/sets/afterhours/characters/nova.json'
import type { Character, SetManifest } from '../types'
import { normalizeCharacter } from './normalize'
import { characterFileName, exportCharacterJson, exportPackZip, importFile, packFileName, type PackArt } from './pack'

/** Two valid cards built from Nova's, partnered with each other. */
function card(id: string, name: string, partner?: string): Character {
  const c = normalizeCharacter(novaJson)
  c.id = id
  c.name = name
  c.partners = partner ? [{ characterId: partner, relation: 'ex' }] : undefined
  if (!partner) delete c.partners
  // Trait ids only need to be unique per card, so Nova's are fine.
  return c
}
const sam = () => card('sam', 'Sam Ortiz', 'lee')
const lee = () => card('lee', 'Lee Park', 'sam')

const manifest = (): SetManifest => ({
  id: 'harbor-lights',
  name: 'Harbor lights',
  blurb: 'Two exes who run rival bars on the same pier.',
  author: 'Tester',
  heat: 3,
  version: '1.0.0',
  characters: ['sam', 'lee'],
  relationships: [{ a: 'sam', b: 'lee', kind: 'ex', note: 'They split the pier down the middle.' }],
  rumors: [{ id: 'sam-lee', teller: 'sam', about: ['lee'], text: 'Lee waters down the rum.', truth: 'false', actually: 'Lee does not.' }],
})

const png = (n: number) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, n])], { type: 'image/png' })
const webp = (n: number) => new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, n])], { type: 'image/webp' })

async function bytes(b: Blob): Promise<number[]> {
  return [...new Uint8Array(await b.arrayBuffer())]
}

async function zipOf(files: Record<string, string | Uint8Array>): Promise<Blob> {
  const zip = new JSZip()
  for (const [path, data] of Object.entries(files)) zip.file(path, data)
  return new Blob([await zip.generateAsync({ type: 'arraybuffer' })], { type: 'application/zip' })
}

const json = (v: unknown) => new Blob([JSON.stringify(v)], { type: 'application/json' })

describe('pack round trip', () => {
  it('exports a zip and imports it back unchanged, art included', async () => {
    const art: PackArt[] = [
      { characterId: 'sam', tier: 1, blob: png(1) },
      { characterId: 'lee', tier: 5, blob: webp(5) },
      { characterId: 'nobody', tier: 2, blob: png(2) }, // not in the pack: left out
    ]
    const blob = await exportPackZip(manifest(), [sam(), lee()], art)
    expect(blob.type).toBe('application/zip')

    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort()).toEqual([
      'art/lee/tier-5.webp',
      'art/sam/tier-1.png',
      'characters/lee.json',
      'characters/sam.json',
      'manifest.json',
    ])

    const result = await importFile(blob, 'harbor-lights.zip')
    expect(result.errors).toEqual([])
    expect(result.kind).toBe('pack')
    expect(result.manifest).toEqual(manifest())
    expect(result.characters).toEqual([sam(), lee()]) // manifest order
    expect(result.art).toHaveLength(2)
    const samArt = result.art.find((a) => a.characterId === 'sam')!
    expect(samArt.tier).toBe(1)
    expect(samArt.blob.type).toBe('image/png')
    expect(await bytes(samArt.blob)).toEqual(await bytes(png(1)))
    const leeArt = result.art.find((a) => a.characterId === 'lee')!
    expect([leeArt.tier, leeArt.blob.type]).toEqual([5, 'image/webp'])
  })

  it('exports a single character as JSON and reads it back', async () => {
    const c = card('solo', 'Solo Vega')
    const blob = exportCharacterJson(c)
    expect(blob.type).toBe('application/json')
    const text = await blob.text()
    expect(JSON.parse(text)).toEqual(c)
    const result = await importFile(blob, characterFileName(c))
    expect(result).toMatchObject({ kind: 'character', errors: [], art: [] })
    expect(result.characters).toEqual([c])
    expect(result.manifest).toBeUndefined()
  })

  it('names files after ids', () => {
    expect(characterFileName({ id: 'nova' })).toBe('nova.json')
    expect(packFileName({ id: 'afterhours' })).toBe('afterhours.zip')
  })

  it("lists exactly the exported characters in the zip's manifest", async () => {
    const blob = await exportPackZip({ ...manifest(), characters: ['sam', 'ghost'] }, [sam(), lee()])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const m = JSON.parse(await zip.file('manifest.json')!.async('string')) as SetManifest
    expect(m.characters).toEqual(['sam', 'lee'])
  })
})

describe('importFile: JSON', () => {
  it('reads an array of characters', async () => {
    const result = await importFile(json([card('a', 'A'), card('b', 'B')]), 'two.json')
    expect(result.kind).toBe('characters')
    expect(result.characters.map((c) => c.id)).toEqual(['a', 'b'])
    expect(result.errors).toEqual([])
  })

  it('reads { manifest, characters }', async () => {
    const result = await importFile(json({ manifest: manifest(), characters: [sam(), lee()] }), 'pack.json')
    expect(result.kind).toBe('pack')
    expect(result.errors).toEqual([])
    expect(result.manifest?.id).toBe('harbor-lights')
    expect(result.characters.map((c) => c.id)).toEqual(['sam', 'lee'])
  })

  it('normalizes plural genders on the way in', async () => {
    const result = await importFile(json({ ...novaJson, id: 'nova-2', partners: [] }), 'nova-2.json')
    expect(result.errors).toEqual([])
    expect(result.characters[0].attractedTo).toEqual(['woman', 'man', 'nonbinary'])
  })

  it('rejects a typed 18 and saves nothing', async () => {
    const result = await importFile(json({ ...card('robin', 'Robin Hale'), age: 18 }), 'x.json')
    expect(result.characters).toEqual([])
    expect(result.errors).toEqual([
      {
        file: 'x.json',
        characterId: 'robin',
        field: 'age',
        message: "Age 18 isn't allowed. Every character in crushLAB is 21 or older, with an adult life and job.",
      },
    ])
  })

  it('leaves out partners who are not coming along, with a note, unless the caller names the set', async () => {
    // An exported card keeps its partners; on another device they aren't in My characters.
    const alone = await importFile(json(sam()), 'sam.json')
    expect(alone.characters.map((c) => [c.id, c.partners])).toEqual([['sam', undefined]])
    expect(alone.errors).toEqual([
      {
        file: 'sam.json',
        characterId: 'sam',
        field: 'partners',
        message: 'Left out partner "lee", who isn\'t in My characters. The rest of the card was imported.',
      },
    ])
    const ok = await importFile(json(sam()), 'sam.json', { setCharacterIds: ['lee'] })
    expect(ok.errors).toEqual([])
    expect(ok.characters[0].partners).toEqual([{ characterId: 'lee', relation: 'ex' }])
    // Both in one file: nothing is left out.
    const both = await importFile(json([sam(), lee()]), 'both.json')
    expect(both.errors).toEqual([])
    expect(both.characters.map((c) => c.partners?.length)).toEqual([1, 1])
  })

  it('keeps a card whose partner in the same file failed, without that partner', async () => {
    const result = await importFile(json([sam(), { ...lee(), age: 19 }]), 'pair.json')
    expect(result.characters.map((c) => c.id)).toEqual(['sam'])
    expect(result.characters[0].partners).toBeUndefined()
    expect(result.errors.map((e) => [e.characterId, e.field])).toEqual([
      ['lee', 'age'],
      ['sam', 'partners'],
    ])
  })

  it('reads { characters: [...] } without a manifest as loose characters', async () => {
    const result = await importFile(json({ characters: [card('a', 'A'), card('b', 'B')] }), 'list.json')
    expect(result.kind).toBe('characters')
    expect(result.manifest).toBeUndefined()
    expect(result.errors).toEqual([])
    expect(result.characters.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('names a card without an id after its file', async () => {
    const { id: _id, ...noId } = card('x', 'Sam')
    const result = await importFile(json(noId), 'Sam Ortiz.json')
    expect(result.errors).toEqual([])
    expect(result.characters.map((c) => c.id)).toEqual(['sam-ortiz'])
  })

  it('refuses reserved ids when told them', async () => {
    const result = await importFile(json(card('wren', 'Wren')), 'wren.json', { reservedIds: ['wren'] })
    expect(result.characters).toEqual([])
    expect(result.errors[0].message).toMatch(/kept for a character in a set that ships with crushLAB/)
  })

  it('rejects ids that are taken', async () => {
    const result = await importFile(json(card('nova', 'Nova')), 'nova.json', { existingIds: ['nova'] })
    expect(result.characters).toEqual([])
    expect(result.errors[0].message).toContain('already uses the id "nova"')
  })

  it('explains files that are not characters', async () => {
    const cases: [Blob, string, RegExp][] = [
      [new Blob(['not json {']), 'broken.json', /isn't valid JSON/],
      [json({ app: 'crushLAB', version: 1, kv: [] }), 'save.json', /is a crushLAB save/],
      [json({ id: 'x', name: 'X', blurb: 'b', characters: ['a'] }), 'manifest.json', /manifest without its characters/],
      [new Blob(['hello']), 'notes.txt', /isn't a \.json character or a \.zip pack/],
      [json([]), 'empty.json', /empty list/],
    ]
    for (const [blob, name, re] of cases) {
      const result = await importFile(blob, name)
      expect(result.characters).toEqual([])
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(re)
    }
  })
})

describe('importFile: zip', () => {
  it('reports an invalid card, keeps the rest and drops what involved it', async () => {
    const third = { ...card('max', 'Max Rowe'), look: 'A schoolgirl look' }
    const blob = await zipOf({
      'manifest.json': JSON.stringify({ ...manifest(), characters: ['sam', 'lee', 'max'], relationships: [...manifest().relationships, { a: 'sam', b: 'max', kind: 'friend', note: 'Pals.' }] }),
      'characters/sam.json': JSON.stringify(sam()),
      'characters/lee.json': JSON.stringify(lee()),
      'characters/max.json': JSON.stringify(third),
    })
    const result = await importFile(blob, 'p.zip')
    expect(result.characters.map((c) => c.id).sort()).toEqual(['lee', 'sam'])
    expect(result.manifest?.characters).toEqual(['sam', 'lee'])
    expect(result.manifest?.relationships).toEqual(manifest().relationships)
    expect(result.errors.map((e) => [e.file, e.field])).toEqual([
      ['characters/max.json', 'look'],
      ['manifest.json', undefined],
    ])
    expect(result.errors[1].message).toBe("Skipped 1 relationship involving characters who weren't imported.")
  })

  it('drops a card whose partner failed, too', async () => {
    const blob = await zipOf({
      'manifest.json': JSON.stringify({ ...manifest(), relationships: [], rumors: [], characters: ['sam', 'lee', 'solo'] }),
      'characters/sam.json': JSON.stringify({ ...sam(), age: 19 }),
      'characters/lee.json': JSON.stringify(lee()),
      'characters/solo.json': JSON.stringify(card('solo', 'Solo')),
    })
    const result = await importFile(blob, 'p.zip')
    expect(result.characters.map((c) => c.id)).toEqual(['solo'])
    expect(result.errors.map((e) => `${e.characterId}:${e.field}`)).toEqual(['sam:age', 'lee:partners[0].characterId'])
  })

  it('rejects the whole pack when the manifest is invalid', async () => {
    const blob = await zipOf({
      'manifest.json': JSON.stringify({ ...manifest(), name: '', heat: 12 }),
      'characters/sam.json': JSON.stringify(sam()),
      'characters/lee.json': JSON.stringify(lee()),
      'art/sam/tier-1.png': new Uint8Array([1, 2, 3]),
    })
    const result = await importFile(blob, 'p.zip')
    expect(result.characters).toEqual([])
    expect(result.art).toEqual([])
    expect(result.manifest).toBeUndefined()
    expect(result.errors.map((e) => e.field)).toEqual(['name', 'heat'])
  })

  it('finds a pack inside one wrapping folder and skips macOS litter', async () => {
    const blob = await zipOf({
      'harbor/manifest.json': JSON.stringify(manifest()),
      'harbor/characters/sam.json': JSON.stringify(sam()),
      'harbor/characters/lee.json': JSON.stringify(lee()),
      'harbor/art/sam/tier-2.jpg': new Uint8Array([0xff, 0xd8]),
      '__MACOSX/harbor/._manifest.json': 'junk',
    })
    const result = await importFile(blob, 'harbor.zip')
    expect(result.errors).toEqual([])
    expect(result.characters).toHaveLength(2)
    expect(result.art.map((a) => [a.characterId, a.tier, a.blob.type])).toEqual([['sam', 2, 'image/jpeg']])
  })

  it('matches folder names in any case', async () => {
    const blob = await zipOf({
      'Manifest.json': JSON.stringify(manifest()),
      'Characters/sam.json': JSON.stringify(sam()),
      'Characters/lee.json': JSON.stringify(lee()),
      'Art/Sam/Tier-1.PNG': new Uint8Array([1]),
    })
    const result = await importFile(blob, 'windows.zip')
    expect(result.errors).toEqual([])
    expect(result.characters.map((c) => c.id)).toEqual(['sam', 'lee'])
    expect(result.art.map((a) => [a.characterId, a.tier, a.blob.type])).toEqual([['sam', 1, 'image/png']])
  })

  it('finds cards next to manifest.json when there is no characters folder', async () => {
    const blob = await zipOf({
      'pack/manifest.json': JSON.stringify(manifest()),
      'pack/sam.json': JSON.stringify(sam()),
      'pack/lee.json': JSON.stringify(lee()),
    })
    const result = await importFile(blob, 'flat.zip')
    expect(result.errors).toEqual([])
    expect(result.characters.map((c) => c.id)).toEqual(['sam', 'lee'])
  })

  it('checks a pack against the ids taken outside it, card by card', async () => {
    const blob = await exportPackZip({ ...manifest(), relationships: [], rumors: [] }, [card('sam', 'Sam'), card('eli', 'Eli')])
    const result = await importFile(blob, 'p.zip', {
      existingIds: ['sam', 'nova'],
      packExistingIds: (setId) => (setId === 'harbor-lights' ? ['nova'] : ['sam', 'nova']),
      reservedIds: ['eli'],
    })
    // sam belongs to this pack already (a re-import); eli is reserved and left out.
    expect(result.characters.map((c) => c.id)).toEqual(['sam'])
    expect(result.errors.map((e) => [e.characterId, e.field])).toEqual([['eli', 'id']])
  })

  it('reports art that is misnamed or for someone else', async () => {
    const blob = await zipOf({
      'manifest.json': JSON.stringify(manifest()),
      'characters/sam.json': JSON.stringify(sam()),
      'characters/lee.json': JSON.stringify(lee()),
      'art/sam/tier-9.png': new Uint8Array([1]),
      'art/zed/tier-1.png': new Uint8Array([1]),
    })
    const result = await importFile(blob, 'p.zip')
    expect(result.characters).toHaveLength(2)
    expect(result.art).toEqual([])
    expect(result.errors.map((e) => e.file)).toEqual(['art/sam/tier-9.png', 'art/zed/tier-1.png'])
  })

  it('reads a zip without a manifest as loose characters', async () => {
    const blob = await zipOf({ 'a.json': JSON.stringify(card('a', 'A')), 'b.json': JSON.stringify(card('b', 'B')) })
    const result = await importFile(blob, 'loose.zip')
    expect(result.kind).toBe('characters')
    expect(result.manifest).toBeUndefined()
    expect(result.characters.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('refuses oversized cards before unpacking them', async () => {
    const blob = await zipOf({
      'manifest.json': JSON.stringify({ ...manifest(), characters: ['sam', 'lee'] }),
      'characters/sam.json': JSON.stringify(sam()),
      'characters/lee.json': JSON.stringify({ ...lee(), backstory: 'x'.repeat(3 * 1024 * 1024) }),
    })
    const result = await importFile(blob, 'big.zip')
    expect(result.characters).toEqual([])
    expect(result.errors[0]).toEqual({ file: 'characters/lee.json', message: 'characters/lee.json is too large to be a character.' })
  })

  it('says so when a zip is damaged', async () => {
    const result = await importFile(new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9])]), 'bad.zip')
    expect(result.characters).toEqual([])
    expect(result.errors[0].message).toMatch(/isn't a readable \.zip/)
  })
})
