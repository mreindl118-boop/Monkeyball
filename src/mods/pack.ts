// Character and pack files (docs/SPEC.md, "Mod system"; ARCHITECTURE, Mods).
//
// Import: a .json file holding one character, an array of characters, { characters: [...] }, or
// { manifest, characters }; or a .zip pack with manifest.json, characters/*.json (or the cards
// next to manifest.json) and optional art/{characterId}/tier-{n}.{webp,png,jpg}, folder names in
// any case. Every card is normalized and validated; anything invalid is reported in `errors` and
// left out of the result, so callers only ever save what passed. A pack whose manifest is
// invalid is rejected whole. Loose cards (no manifest) travel alone: a partner who isn't coming
// along is left off the card with a note, rather than refusing it.
//
// Export: exportCharacterJson() and exportPackZip() build Blobs; hand them to saveFile() in
// src/platform/files.ts (never an <a download> directly: the Android app needs the share sheet).

import JSZip from 'jszip'
import type { Character, SetManifest, TierNumber } from '../types'
import { normalizeCharacter, normalizeManifest, slugify } from './normalize'
import { validateCharacter, validateManifest, type ValidationIssue } from './validate'

export interface PackArt {
  characterId: string
  tier: TierNumber
  blob: Blob
}

export interface ImportError {
  /** The file (or the file inside a .zip) the problem is in. */
  file: string
  /** The character it concerns, when there is one. */
  characterId?: string
  /** Field path, as in ValidationIssue. */
  field?: string
  message: string
}

export interface ImportResult {
  /** The imported file's name. */
  name: string
  /** One character, several loose characters, or a pack with a manifest. */
  kind: 'character' | 'characters' | 'pack'
  /** Characters that passed validation, ready to save. */
  characters: Character[]
  /** The pack's manifest (only when valid), listing exactly the characters above. */
  manifest?: SetManifest
  /** Tier art for the characters above. */
  art: PackArt[]
  /** Everything that was left out, and why. Empty when the whole file imported. */
  errors: ImportError[]
}

export interface ImportOptions {
  /**
   * Loose characters (no manifest) join "My characters": list its ids here so their partners
   * resolve. A loose card's partner who is in neither the file nor this list is left off the card
   * (with a note in `errors`). A pack's partners must always be inside the pack.
   */
  setCharacterIds?: readonly string[]
  /** Character ids already in use elsewhere (bundled, other sets, My characters). */
  existingIds?: readonly string[]
  /**
   * For a pack, the ids in use outside a pack with this id (so re-importing a pack doesn't clash
   * with itself). Defaults to existingIds.
   */
  packExistingIds?: (setId: string) => readonly string[]
  /** Ids kept for characters that ship later (see RESERVED_CHARACTER_IDS). */
  reservedIds?: readonly string[]
  /** Set ids already in use elsewhere (bundled sets). */
  existingSetIds?: readonly string[]
}

/** Largest file the importer opens. */
export const MAX_IMPORT_BYTES = 150 * 1024 * 1024
/** Largest single card or manifest inside a file. */
const MAX_JSON_BYTES = 2 * 1024 * 1024
/** Largest single art image inside a pack. */
const MAX_ART_BYTES = 20 * 1024 * 1024

const ART_TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

class ImportFailure extends Error {}

function parseJson(text: string, file: string): unknown {
  if (text.length > MAX_JSON_BYTES) throw new ImportFailure(`${file} is too large to be a character or manifest.`)
  try {
    return JSON.parse(text)
  } catch {
    throw new ImportFailure(`${file} isn't valid JSON.`)
  }
}

interface Parsed {
  file: string
  character: Character
}

function issuesToErrors(file: string, characterId: string | undefined, issues: readonly ValidationIssue[]): ImportError[] {
  return issues.map((i) => ({ file, characterId: characterId || undefined, field: i.field, message: i.message }))
}

/** The set loose characters join, for notes about partners left behind. */
const LOOSE_SET_NAME = 'My characters'

/**
 * A card without the partners who aren't in `allowed`, and the ids it lost. Loose characters
 * travel alone (a single exported .json keeps its partners), so a partner who isn't coming
 * along is dropped rather than refusing the whole card.
 */
export function dropOutsidePartners(character: Character, allowed: ReadonlySet<string>): { character: Character; dropped: string[] } {
  const partners = character.partners ?? []
  const dropped = partners.map((p) => p?.characterId).filter((id): id is string => typeof id === 'string' && !!id && !allowed.has(id))
  if (!dropped.length) return { character, dropped }
  const kept = partners.filter((p) => !dropped.includes(p?.characterId))
  const copy: Character = { ...character }
  if (kept.length) copy.partners = kept
  else delete copy.partners
  return { character: copy, dropped }
}

/** "Left out partner "lee-park", who isn't in My characters." */
export function droppedPartnerNote(file: string, characterId: string, partnerId: string, where = LOOSE_SET_NAME): ImportError {
  return {
    file,
    characterId,
    field: 'partners',
    message: `Left out partner "${partnerId}", who isn't in ${where}. The rest of the card was imported.`,
  }
}

interface GroupContext {
  extraSetIds?: readonly string[]
  existingIds?: readonly string[]
  reservedIds?: readonly string[]
  /** Loose characters: leave off partners who aren't in the set instead of refusing the card. */
  dropOutsidePartners?: boolean
}

/**
 * Validate cards as one set. A card whose partner fails is checked again without that partner
 * in the set, until what's left is consistent.
 */
function validateGroup(parsed: readonly Parsed[], ctx: GroupContext, errors: ImportError[]): Parsed[] {
  // Duplicate ids inside one file or pack: keep the first.
  const firstById = new Map<string, Parsed>()
  let pool: Parsed[] = []
  for (const p of parsed) {
    const id = p.character.id
    if (id && firstById.has(id)) {
      errors.push({ file: p.file, characterId: id, field: 'id', message: `Two characters use the id "${id}"; only the first was imported.` })
      continue
    }
    if (id) firstById.set(id, p)
    pool.push(p)
  }
  const failed = new Map<Parsed, ValidationIssue[]>()
  const notes = new Map<string, ImportError>()
  for (;;) {
    const ids = [...pool.map((p) => p.character.id), ...(ctx.extraSetIds ?? [])]
    const before = pool.length
    if (ctx.dropOutsidePartners) {
      const allowed = new Set(ids)
      pool = pool.map((p) => {
        const { character, dropped } = dropOutsidePartners(p.character, allowed)
        for (const pid of dropped) notes.set(`${p.character.id}|${pid}`, droppedPartnerNote(p.file, p.character.id, pid))
        return dropped.length ? { ...p, character } : p
      })
    }
    pool = pool.filter((p) => {
      const issues = validateCharacter(p.character, {
        setCharacterIds: ids,
        existingIds: ctx.existingIds,
        reservedIds: ctx.reservedIds,
      })
      if (issues.length) failed.set(p, issues)
      return issues.length === 0
    })
    if (pool.length === before) break
  }
  for (const [p, issues] of failed) errors.push(...issuesToErrors(p.file, p.character.id, issues))
  const kept = new Set(pool.map((p) => p.character.id))
  errors.push(...[...notes.values()].filter((n) => n.characterId && kept.has(n.characterId)))
  return pool
}

function looseResult(name: string, parsed: Parsed[], opts: ImportOptions, errors: ImportError[]): ImportResult {
  const valid = validateGroup(
    parsed,
    { extraSetIds: opts.setCharacterIds, existingIds: opts.existingIds, reservedIds: opts.reservedIds, dropOutsidePartners: true },
    errors,
  )
  return {
    name,
    kind: parsed.length === 1 ? 'character' : 'characters',
    characters: valid.map((p) => p.character),
    art: [],
    errors,
  }
}

function packResult(
  name: string,
  manifestFile: string,
  rawManifest: SetManifest,
  parsed: Parsed[],
  art: (PackArt & { file: string })[],
  opts: ImportOptions,
  errors: ImportError[],
): ImportResult {
  const existingIds = opts.packExistingIds && rawManifest.id ? opts.packExistingIds(rawManifest.id) : opts.existingIds
  const valid = validateGroup(parsed, { existingIds, reservedIds: opts.reservedIds }, errors)
  const validIds = new Set(valid.map((p) => p.character.id))
  const parsedIds = new Set(parsed.map((p) => p.character.id))

  // The manifest lists what actually imported, in its own order, then any card it forgot.
  for (const id of rawManifest.characters) {
    if (!parsedIds.has(id)) {
      errors.push({ file: manifestFile, message: `The manifest lists "${id}" but the pack has no card for them.` })
    }
  }
  const characters = [
    ...rawManifest.characters.filter((id) => validIds.has(id)),
    ...valid.map((p) => p.character.id).filter((id) => !rawManifest.characters.includes(id)),
  ]
  const keep = new Set(characters)
  // Relationships and rumors that involve a character who was left out go with them. Anything
  // else that points outside the set stays, and validateManifest() rejects it.
  const removed = new Set([...rawManifest.characters, ...parsedIds].filter((id) => !keep.has(id)))
  const relationships = rawManifest.relationships.filter((r) => !removed.has(r.a) && !removed.has(r.b))
  const rumors = rawManifest.rumors?.filter((r) => !removed.has(r.teller) && !r.about.some((a) => removed.has(a)))
  const skippedRelations = rawManifest.relationships.length - relationships.length
  const skippedRumors = (rawManifest.rumors?.length ?? 0) - (rumors?.length ?? 0)
  if (skippedRelations || skippedRumors) {
    const parts = [
      skippedRelations ? `${skippedRelations} relationship${skippedRelations === 1 ? '' : 's'}` : '',
      skippedRumors ? `${skippedRumors} rumor${skippedRumors === 1 ? '' : 's'}` : '',
    ].filter(Boolean)
    errors.push({ file: manifestFile, message: `Skipped ${parts.join(' and ')} involving characters who weren't imported.` })
  }
  const manifest: SetManifest = { ...rawManifest, characters, relationships }
  if (rumors) manifest.rumors = rumors

  const manifestIssues = validateManifest(manifest, {
    characterIds: valid.map((p) => p.character.id),
    existingSetIds: opts.existingSetIds,
  })
  if (manifestIssues.length || valid.length === 0) {
    errors.push(...manifestIssues.map((i) => ({ file: manifestFile, field: i.field, message: i.message })))
    if (valid.length === 0 && !manifestIssues.some((i) => i.field === 'characters')) {
      errors.push({ file: manifestFile, message: 'No character in this pack could be imported.' })
    }
    return { name, kind: 'pack', characters: [], art: [], errors }
  }

  const keptArt: PackArt[] = []
  for (const a of art) {
    if (!keep.has(a.characterId)) {
      if (!parsedIds.has(a.characterId)) {
        errors.push({ file: a.file, message: `Art for "${a.characterId}" was skipped: there's no such character in the pack.` })
      }
      continue
    }
    keptArt.push({ characterId: a.characterId, tier: a.tier, blob: a.blob })
  }

  const byId = new Map(valid.map((p) => [p.character.id, p.character]))
  const ordered = characters.map((id) => byId.get(id)).filter((c): c is Character => !!c)
  return { name, kind: 'pack', characters: ordered, manifest, art: keptArt, errors }
}

// ---------------------------------------------------------------------------
// JSON

function fromJson(name: string, text: string, opts: ImportOptions): ImportResult {
  const errors: ImportError[] = []
  const raw = parseJson(text, name)

  if (Array.isArray(raw)) {
    const parsed = raw.map((c, i) => ({ file: `${name} (character ${i + 1})`, character: normalizeCharacter(c) }))
    if (parsed.length === 0) throw new ImportFailure(`${name} is an empty list.`)
    return looseResult(name, parsed, opts, errors)
  }
  if (!isObj(raw)) throw new ImportFailure(`${name} doesn't hold a character or a pack.`)
  if (raw.app === 'crushLAB' && Array.isArray(raw.kv)) {
    throw new ImportFailure(`${name} is a crushLAB save. Load it from Settings, under saves.`)
  }

  const chars = raw.characters
  const hasCardObjects = Array.isArray(chars) && chars.some(isObj)
  // { "characters": [card, card] } with nothing that makes it a set: loose characters.
  const bareList = hasCardObjects && !isObj(raw.manifest) && !isText(raw.id) && !isText(raw.name) && !isText(raw.blurb)
  if (bareList) {
    const parsed = (chars as unknown[])
      .filter(isObj)
      .map((c, i) => ({ file: `${name} (character ${i + 1})`, character: normalizeCharacter(c) }))
    return looseResult(name, parsed, opts, errors)
  }
  if (isObj(raw.manifest) || hasCardObjects) {
    if (!Array.isArray(chars) || !hasCardObjects) {
      throw new ImportFailure(`${name} has a manifest but no characters. Import the .zip pack instead.`)
    }
    const manifestRaw = isObj(raw.manifest) ? raw.manifest : raw
    const manifest = normalizeManifest(manifestRaw)
    const parsed = chars
      .filter(isObj)
      .map((c, i) => ({ file: `${name} (character ${i + 1})`, character: normalizeCharacter(c) }))
    if (manifest.characters.length === 0 || !isObj(raw.manifest)) {
      // A manifest without its own list (or the pack object itself) lists what it carries.
      manifest.characters = parsed.map((p) => p.character.id).filter(Boolean)
    }
    return packResult(name, name, manifest, parsed, [], opts, errors)
  }
  if (Array.isArray(chars) && typeof raw.blurb === 'string') {
    throw new ImportFailure(`${name} is a set manifest without its characters. Import the .zip pack instead.`)
  }
  const character = normalizeCharacter(raw)
  // A card without an id takes the file's name, as a card inside a .zip does.
  if (!character.id && /\.json$/i.test(name)) character.id = idFromFileName(name)
  return looseResult(name, [{ file: name, character }], opts, errors)
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** "Sam Ortiz.json" -> "sam-ortiz"; "characters/lee.json" -> "lee". */
function idFromFileName(file: string): string {
  const base = /([^/\\]+?)(?:\.json)?$/i.exec(file)?.[1] ?? ''
  return slugify(base)
}

// ---------------------------------------------------------------------------
// Zip

const IGNORED = /(^|\/)(__MACOSX|\.[^/]*)(\/|$)/
/** Everything inside a pack, unpacked. Guards against zip bombs before anything is inflated. */
const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024

/** The size a zip entry claims once inflated (JSZip keeps it from the central directory). */
function unzippedSize(f: JSZip.JSZipObject): number {
  const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
  return typeof size === 'number' ? size : 0
}

async function fromZip(name: string, buffer: ArrayBuffer, opts: ImportOptions): Promise<ImportResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new ImportFailure(`${name} isn't a readable .zip file.`)
  }
  const files = Object.values(zip.files).filter((f) => !f.dir && !IGNORED.test(f.name))
  if (files.reduce((sum, f) => sum + unzippedSize(f), 0) > MAX_UNZIPPED_BYTES) {
    throw new ImportFailure(`${name} is too large once unpacked.`)
  }
  const errors: ImportError[] = []

  // manifest.json at the root, or inside one wrapping folder. Folder names are matched in any
  // case (Characters/, ART/), as zips made on Windows and macOS often have them.
  const manifests = files
    .filter((f) => /(^|\/)manifest\.json$/i.test(f.name))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)
  const manifestEntry = manifests[0]
  const prefix = manifestEntry ? manifestEntry.name.slice(0, manifestEntry.name.length - 'manifest.json'.length) : ''
  /** The path inside the pack, lowercased: "characters/sam.json". */
  const inner = (f: JSZip.JSZipObject) => (f.name.startsWith(prefix) ? f.name.slice(prefix.length).toLowerCase() : null)

  const jsonUnderPrefix = files.filter((f) => f !== manifestEntry && /\.json$/i.test(f.name) && inner(f) !== null)
  const inCharacters = jsonUnderPrefix.filter((f) => inner(f)?.startsWith('characters/'))
  // No characters/ folder: the cards sit next to manifest.json (or anywhere else in the pack).
  const cardEntries = !manifestEntry
    ? files.filter((f) => /\.json$/i.test(f.name))
    : inCharacters.length
      ? inCharacters
      : jsonUnderPrefix.filter((f) => !inner(f)?.startsWith('art/'))
  const parsed: Parsed[] = []
  for (const f of cardEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      if (unzippedSize(f) > MAX_JSON_BYTES) throw new ImportFailure(`${f.name} is too large to be a character.`)
      const raw = parseJson(await f.async('string'), f.name)
      const list = Array.isArray(raw) ? raw : [raw]
      for (const c of list) {
        const character = normalizeCharacter(c)
        if (!character.id) character.id = idFromFileName(f.name)
        parsed.push({ file: f.name, character })
      }
    } catch (e) {
      errors.push({ file: f.name, message: e instanceof Error ? e.message : String(e) })
    }
  }

  if (!manifestEntry) {
    if (parsed.length === 0) {
      throw new ImportFailure(
        errors.length ? `No character in ${name} could be read.` : `${name} has no manifest.json and no character files.`,
      )
    }
    return looseResult(name, parsed, opts, errors)
  }

  let manifest: SetManifest
  try {
    manifest = normalizeManifest(parseJson(await manifestEntry.async('string'), manifestEntry.name))
  } catch (e) {
    errors.push({ file: manifestEntry.name, message: e instanceof Error ? e.message : String(e) })
    return { name, kind: 'pack', characters: [], art: [], errors }
  }

  const art: (PackArt & { file: string })[] = []
  const artRe = /^art\/([^/]+)\/tier-([1-5])\.(webp|png|jpe?g)$/
  for (const f of files) {
    const path = inner(f)
    if (!path?.startsWith('art/')) continue
    const m = artRe.exec(path)
    if (!m) {
      errors.push({ file: f.name, message: 'Art files go in art/{character id}/tier-{1 to 5}.webp, .png or .jpg; this one was skipped.' })
      continue
    }
    if (unzippedSize(f) > MAX_ART_BYTES) {
      errors.push({ file: f.name, message: 'This image is too large; it was skipped.' })
      continue
    }
    const bytes = await f.async('arraybuffer')
    if (bytes.byteLength > MAX_ART_BYTES) {
      errors.push({ file: f.name, message: 'This image is too large; it was skipped.' })
      continue
    }
    art.push({
      file: f.name,
      characterId: m[1],
      tier: Number(m[2]) as TierNumber,
      blob: new Blob([bytes], { type: ART_TYPES[m[3].toLowerCase()] }),
    })
  }

  return packResult(name, manifestEntry.name, manifest, parsed, art, opts, errors)
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Read a character or pack file. Never throws: a file that can't be read at all comes back
 * with no characters and one error saying why.
 */
export async function importFile(file: File | Blob, name?: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const fileName = name ?? (typeof (file as File).name === 'string' ? (file as File).name : '')
  const label = fileName || 'This file'
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new ImportFailure(`${label} is too large to import.`)
    const buffer = await file.arrayBuffer()
    const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))
    const isZip = /\.zip$/i.test(fileName) || (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4)
    if (isZip) return await fromZip(label, buffer, opts)
    const text = new TextDecoder('utf-8').decode(buffer)
    if (!/\.json$/i.test(fileName) && !/^\s*[[{]/.test(text)) {
      throw new ImportFailure(`${label} isn't a .json character or a .zip pack.`)
    }
    return fromJson(label, text, opts)
  } catch (e) {
    const message = e instanceof ImportFailure ? e.message : `${label} couldn't be read${e instanceof Error && e.message ? `: ${e.message}` : '.'}`
    return { name: label, kind: 'character', characters: [], art: [], errors: [{ file: label, message }] }
  }
}

/** A card as it sits in a .json file: drops fields that are empty or unset. */
function cleanCharacter(c: Character): Character {
  return JSON.parse(JSON.stringify(c)) as Character
}

/** One character as a .json file. */
export function exportCharacterJson(character: Character): Blob {
  return new Blob([`${JSON.stringify(cleanCharacter(character), null, 2)}\n`], { type: 'application/json' })
}

function extensionFor(blob: Blob): string {
  switch (blob.type) {
    case 'image/webp':
      return 'webp'
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    default:
      return 'png'
  }
}

/**
 * A .zip pack: manifest.json (listing exactly these characters), characters/{id}.json and
 * art/{id}/tier-{n}.{webp,png,jpg}. Art for characters that aren't in the pack is left out.
 */
export async function exportPackZip(
  manifest: SetManifest,
  characters: readonly Character[],
  art: readonly PackArt[] = [],
): Promise<Blob> {
  const ids = characters.map((c) => c.id)
  const listed = [...manifest.characters.filter((id) => ids.includes(id)), ...ids.filter((id) => !manifest.characters.includes(id))]
  const zip = new JSZip()
  zip.file('manifest.json', `${JSON.stringify({ ...manifest, characters: listed }, null, 2)}\n`)
  for (const c of characters) {
    zip.file(`characters/${c.id}.json`, `${JSON.stringify(cleanCharacter(c), null, 2)}\n`)
  }
  for (const a of art) {
    if (!ids.includes(a.characterId)) continue
    zip.file(`art/${a.characterId}/tier-${a.tier}.${extensionFor(a.blob)}`, await a.blob.arrayBuffer())
  }
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return new Blob([bytes], { type: 'application/zip' })
}

/** "nova.json" */
export function characterFileName(c: Pick<Character, 'id'>): string {
  return `${c.id || 'character'}.json`
}

/** "afterhours.zip" */
export function packFileName(m: Pick<SetManifest, 'id'>): string {
  return `${m.id || 'pack'}.zip`
}

/** One line per problem, e.g. "characters/sam.json: Age 18 isn't allowed. ..." */
export function describeImportErrors(errors: readonly ImportError[]): string[] {
  return errors.map((e) => `${e.file}: ${e.message}`)
}
