// Small typed helpers over the Dexie schema. Every helper takes an optional database as its
// last argument so tests can run against an isolated CrushDB instance.

import { migrateConnection, withLocalKeys, withoutApiKeys } from '../store/connection'
import type { DateRecord, Relationship, Settings, StoredImage } from '../types'
import { db, type CrushDB, type KvRow, type SaveBlob, type SaveRow } from './db'

// ---------------------------------------------------------------------------
// kv

export type KvKey = 'settings' | 'profile' | 'game' | 'ui' | (string & {})

export async function kvGet<T>(key: KvKey, d: CrushDB = db): Promise<T | undefined> {
  const row = await d.kv.get(key)
  return row?.value as T | undefined
}

export async function kvSet<T>(key: KvKey, value: T, d: CrushDB = db): Promise<void> {
  await d.kv.put({ key, value })
}

export async function kvDelete(key: KvKey, d: CrushDB = db): Promise<void> {
  await d.kv.delete(key)
}

// ---------------------------------------------------------------------------
// Relationships

export async function getRelationship(
  characterId: string,
  d: CrushDB = db,
): Promise<Relationship | undefined> {
  return d.relationships.get(characterId)
}

export async function getAllRelationships(d: CrushDB = db): Promise<Relationship[]> {
  return d.relationships.toArray()
}

export async function putRelationship(rel: Relationship, d: CrushDB = db): Promise<void> {
  await d.relationships.put(rel)
}

export async function deleteRelationship(characterId: string, d: CrushDB = db): Promise<void> {
  await d.relationships.delete(characterId)
}

// ---------------------------------------------------------------------------
// Dates

/** Insert or update a date record. Returns its id. */
export async function putDate(rec: DateRecord, d: CrushDB = db): Promise<number> {
  const id = await d.dates.put(rec)
  return id as number
}

export async function getDate(id: number, d: CrushDB = db): Promise<DateRecord | undefined> {
  return d.dates.get(id)
}

/** Dates oldest first, optionally only those that include a character. */
export async function listDates(characterId?: string, d: CrushDB = db): Promise<DateRecord[]> {
  if (characterId) return d.dates.where('characterIds').equals(characterId).sortBy('startedAt')
  return d.dates.orderBy('startedAt').toArray()
}

// ---------------------------------------------------------------------------
// Images

export async function getImage(key: string, d: CrushDB = db): Promise<StoredImage | undefined> {
  return d.images.get(key)
}

export async function putImage(img: StoredImage, d: CrushDB = db): Promise<void> {
  await d.images.put(img)
}

export async function deleteImage(key: string, d: CrushDB = db): Promise<void> {
  await d.images.delete(key)
}

// ---------------------------------------------------------------------------
// Wipe

/** Delete everything the app stores on this device. */
export async function wipeAll(d: CrushDB = db): Promise<void> {
  await d.transaction('rw', d.tables, async () => {
    await Promise.all(d.tables.map((t) => t.clear()))
  })
}

// ---------------------------------------------------------------------------
// Save files and slots

/** An image inside an exported save file (blob as base64). */
export interface ExportedImage {
  key: string
  characterId: string
  source: StoredImage['source']
  mime: string
  data: string
  prompt?: string
  seed?: number
  createdAt: number
  favorite?: boolean
}

/** What a save file on disk holds: a SaveBlob plus identification and optional images. */
export interface SaveFile extends SaveBlob {
  app: 'crushLAB'
  exportedAt: number
  images?: ExportedImage[]
}

export interface ExportOptions {
  /** Include imported and generated images (base64). Default false. API keys are never exported. */
  includeImages?: boolean
}

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaveFormatError'
  }
}

/** Settings with every API key blanked (every preset's, in any stored version). */
function withoutKeys(settings: Settings): Settings {
  return { ...settings, connection: withoutApiKeys(settings.connection) }
}

/** Keys stay on this device: exports never carry them. */
function stripApiKeys(rows: KvRow[]): KvRow[] {
  return rows.map((row) => {
    if (row.key !== 'settings' || !isRecord(row.value)) return row
    const settings = row.value as unknown as Settings
    if (!isRecord(settings.connection)) return row
    return { key: row.key, value: withoutKeys(settings) }
  })
}

/**
 * Snapshot the current state. `withSettings: false` (save slots) leaves settings out so restoring
 * a slot never rolls back the connection or preferences.
 */
export async function snapshot(opts: { withSettings?: boolean } = {}, d: CrushDB = db): Promise<SaveBlob> {
  const { withSettings = true } = opts
  return d.transaction(
    'r',
    [d.kv, d.relationships, d.customCharacters, d.packs, d.dates],
    async () => {
      let kv = await d.kv.toArray()
      kv = withSettings ? stripApiKeys(kv) : kv.filter((r) => r.key !== 'settings')
      return {
        version: 1 as const,
        kv,
        relationships: await d.relationships.toArray(),
        customCharacters: await d.customCharacters.toArray(),
        packs: await d.packs.toArray(),
        dates: await d.dates.toArray(),
      }
    },
  )
}

/** Build a downloadable save file (JSON). */
export async function exportSave(opts: ExportOptions = {}, d: CrushDB = db): Promise<Blob> {
  const blob = await snapshot({ withSettings: true }, d)
  const file: SaveFile = { app: 'crushLAB', exportedAt: Date.now(), ...blob }
  if (opts.includeImages) {
    const images = await d.images.toArray()
    file.images = await Promise.all(
      images.map(async (img) => ({
        key: img.key,
        characterId: img.characterId,
        source: img.source,
        mime: img.blob.type || 'application/octet-stream',
        data: await blobToBase64(img.blob),
        prompt: img.prompt,
        seed: img.seed,
        createdAt: img.createdAt,
        favorite: img.favorite,
      })),
    )
  }
  return new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' })
}

/** A file name for an export, e.g. `crushlab-save-2026-09-25.json`. */
export function saveFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `crushlab-save-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

/** Parse and sanity-check a save file's text. Throws SaveFormatError with a readable message. */
export function parseSave(text: string): SaveFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SaveFormatError("This file isn't valid JSON, so it can't be a crushLAB save.")
  }
  if (!isRecord(raw)) throw new SaveFormatError("This file doesn't look like a crushLAB save.")
  if (raw.version !== 1) {
    throw new SaveFormatError(
      raw.version === undefined
        ? "This file doesn't look like a crushLAB save."
        : `This save is from a newer version (format ${String(raw.version)}).`,
    )
  }
  for (const key of ['kv', 'relationships', 'customCharacters', 'packs', 'dates'] as const) {
    if (!Array.isArray(raw[key])) {
      throw new SaveFormatError(`This save is missing its ${key} section.`)
    }
  }
  const kv = raw.kv as unknown[]
  if (!kv.every((r) => isRecord(r) && typeof r.key === 'string')) {
    throw new SaveFormatError('This save has a damaged settings section.')
  }
  const rels = raw.relationships as unknown[]
  if (!rels.every((r) => isRecord(r) && typeof r.characterId === 'string')) {
    throw new SaveFormatError('This save has a damaged relationships section.')
  }
  if (raw.images !== undefined && !Array.isArray(raw.images)) {
    throw new SaveFormatError('This save has a damaged images section.')
  }
  return {
    app: 'crushLAB',
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    version: 1,
    kv: raw.kv as SaveBlob['kv'],
    relationships: raw.relationships as SaveBlob['relationships'],
    customCharacters: raw.customCharacters as SaveBlob['customCharacters'],
    packs: raw.packs as SaveBlob['packs'],
    dates: raw.dates as SaveBlob['dates'],
    images: raw.images as ExportedImage[] | undefined,
  }
}

/**
 * Replace everything with a save file (Blob, File or JSON text). Settings in the file replace the
 * current ones, except that a blank API key in the file keeps this device's key. Images are only
 * replaced when the file carries them. Returns the parsed file.
 */
export async function importSave(input: Blob | string, d: CrushDB = db): Promise<SaveFile> {
  const text = typeof input === 'string' ? input : await input.text()
  const file = parseSave(text)
  const images = file.images ? await Promise.all(file.images.map(decodeImage)) : null
  await d.transaction('rw', d.tables, async () => {
    const current = await d.kv.get('settings')
    const kv = keepLocalApiKey(file.kv, current)
    await replaceState(d, { ...file, kv }, { keepSettings: false })
    if (images) {
      await d.images.clear()
      await d.images.bulkPut(images)
    }
  })
  return file
}

/**
 * Imported settings get this device's keys back: each preset keeps the key stored here for that
 * preset, so a key is never moved onto a different provider. (Older files that carried a key
 * keep it.)
 */
function keepLocalApiKey(rows: KvRow[], current: KvRow | undefined): KvRow[] {
  const stored = (current?.value as Settings | undefined)?.connection
  if (!isRecord(stored)) return rows
  const local = migrateConnection(stored)
  return rows.map((row) => {
    if (row.key !== 'settings' || !isRecord(row.value)) return row
    const s = row.value as unknown as Settings
    if (!isRecord(s.connection)) return row
    return { key: row.key, value: { ...s, connection: withLocalKeys(s.connection, local) } }
  })
}

async function replaceState(
  d: CrushDB,
  blob: SaveBlob,
  opts: { keepSettings: boolean },
): Promise<void> {
  const settings = opts.keepSettings ? await d.kv.get('settings') : undefined
  await Promise.all([
    d.kv.clear(),
    d.relationships.clear(),
    d.customCharacters.clear(),
    d.packs.clear(),
    d.dates.clear(),
  ])
  const kv = opts.keepSettings ? blob.kv.filter((r) => r.key !== 'settings') : blob.kv
  if (settings) kv.push(settings)
  await d.kv.bulkPut(kv)
  await d.relationships.bulkPut(blob.relationships)
  await d.customCharacters.bulkPut(blob.customCharacters)
  await d.packs.bulkPut(blob.packs)
  await d.dates.bulkPut(blob.dates)
}

export interface SlotInfo {
  id: string
  label: string
  createdAt: number
  /** Characters with a relationship in this slot. */
  characters: number
  dates: number
}

/** Save slots, newest first, without their payloads. */
export async function listSlots(d: CrushDB = db): Promise<SlotInfo[]> {
  const rows = await d.saves.orderBy('createdAt').reverse().toArray()
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt,
    characters: r.data.relationships.length,
    dates: r.data.dates.length,
  }))
}

/** Snapshot the current game (everything but settings) into a new slot. */
export async function createSlot(label: string, d: CrushDB = db): Promise<SaveRow> {
  const data = await snapshot({ withSettings: false }, d)
  const createdAt = Date.now()
  const row: SaveRow = {
    id: `slot-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: label.trim() || 'Untitled save',
    createdAt,
    data,
  }
  await d.saves.put(row)
  return row
}

/** Replace the current game with a slot. Settings (connection, preferences) are kept. */
export async function restoreSlot(id: string, d: CrushDB = db): Promise<void> {
  const row = await d.saves.get(id)
  if (!row) throw new Error('That save slot no longer exists.')
  await d.transaction(
    'rw',
    [d.kv, d.relationships, d.customCharacters, d.packs, d.dates],
    async () => {
      await replaceState(d, row.data, { keepSettings: true })
    },
  )
}

export async function deleteSlot(id: string, d: CrushDB = db): Promise<void> {
  await d.saves.delete(id)
}

// ---------------------------------------------------------------------------
// Utilities

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBlob(data: string, mime: string): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function decodeImage(img: ExportedImage): Promise<StoredImage> {
  if (!isRecord(img) || typeof img.key !== 'string' || typeof img.data !== 'string') {
    throw new SaveFormatError('This save has a damaged image.')
  }
  return {
    key: img.key,
    characterId: img.characterId,
    source: img.source === 'generated' ? 'generated' : 'imported',
    blob: base64ToBlob(img.data, img.mime || 'application/octet-stream'),
    prompt: img.prompt,
    seed: img.seed,
    createdAt: img.createdAt || Date.now(),
    favorite: img.favorite,
  }
}
