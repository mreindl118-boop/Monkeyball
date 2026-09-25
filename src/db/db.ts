import Dexie, { type EntityTable } from 'dexie'
import type {
  Character,
  DateRecord,
  Relationship,
  SetManifest,
  StoredImage,
} from '../types'

export interface KvRow {
  key: string
  value: unknown
}

export interface CustomCharacterRow {
  id: string
  setId: string
  character: Character
  source: 'imported' | 'custom'
  updatedAt: number
}

export interface PackRow {
  id: string
  manifest: SetManifest
  importedAt: number
}

/** Everything a save slot or a save export holds. */
export interface SaveBlob {
  version: 1
  kv: KvRow[]
  relationships: Relationship[]
  customCharacters: CustomCharacterRow[]
  packs: PackRow[]
  dates: DateRecord[]
}

export interface SaveRow {
  id: string
  label: string
  createdAt: number
  data: SaveBlob
}

export class CrushDB extends Dexie {
  kv!: EntityTable<KvRow, 'key'>
  relationships!: EntityTable<Relationship, 'characterId'>
  customCharacters!: EntityTable<CustomCharacterRow, 'id'>
  packs!: EntityTable<PackRow, 'id'>
  dates!: EntityTable<DateRecord, 'id'>
  images!: EntityTable<StoredImage, 'key'>
  saves!: EntityTable<SaveRow, 'id'>

  constructor(name = 'crushlab') {
    super(name)
    this.version(1).stores({
      kv: '&key',
      relationships: '&characterId',
      customCharacters: '&id, setId',
      packs: '&id',
      dates: '++id, startedAt, *characterIds',
      images: '&key, characterId',
      saves: '&id, createdAt',
    })
  }
}

export const db = new CrushDB()
