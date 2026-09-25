// What the gallery needs to know without resolving every slot: which slots are favorites (kv
// 'artFavorites', src/art/resolve.ts) and which group pictures exist (images-table rows with
// characterId 'group', keys only). Follows every art change (a favorite, an import, a painting).

import { useEffect, useState } from 'react'
import { getFavorites, subscribeArt } from '../../art/resolve'
import { parseSlotKey, slotKey } from '../../art/types'
import { db } from '../../db/db'

export interface ArtIndex {
  loaded: boolean
  /** Slot keys marked favorite. */
  favorites: ReadonlySet<string>
  /** Slot keys of group pictures in the images table (generated rows folded in). */
  groups: readonly string[]
}

const EMPTY: ArtIndex = { loaded: false, favorites: new Set(), groups: [] }

async function groupKeys(): Promise<string[]> {
  try {
    const keys = await db.images.where('characterId').equals('group').primaryKeys()
    const out = new Set<string>()
    for (const k of keys) {
      const slot = parseSlotKey(String(k))
      if (slot?.kind === 'group') out.add(slotKey(slot))
    }
    return [...out]
  } catch {
    return []
  }
}

/** Favorites and group keys, read once. */
export async function readArtIndex(): Promise<Omit<ArtIndex, 'loaded'>> {
  const [favorites, groups] = await Promise.all([getFavorites().catch(() => [] as string[]), groupKeys()])
  return { favorites: new Set(favorites), groups }
}

export function useArtIndex(): ArtIndex {
  const [index, setIndex] = useState<ArtIndex>(EMPTY)
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeArt('*', () => setTick((t) => t + 1)), [])
  useEffect(() => {
    let alive = true
    readArtIndex()
      .then((i) => {
        if (alive) setIndex({ ...i, loaded: true })
      })
      .catch(() => {
        if (alive) setIndex((prev) => ({ ...prev, loaded: true }))
      })
    return () => {
      alive = false
    }
  }, [tick])
  return index
}
