// useGame: relationship state per character and the game-wide state (news, rumors heard,
// metamour approval, rekindles, endings seen). Relationships live in Dexie's relationships
// table, the game state in kv 'game'. Like the settings store, a storage failure is recorded
// in `error` and the game keeps working in memory. Phase 3 and 4 add the date actions. Every
// mutation waits for a load in progress, so a write made early isn't wiped when the tables are read.

import { create } from 'zustand'
import { db, type CrushDB } from '../db/db'
import { getAllRelationships, kvGet, kvSet, putRelationship } from '../db/repo'
import { newGameState, newRelationship, withGameDefaults, withRelationshipDefaults } from '../engine/relationship'
import type { GameState, NewsItem, Relationship } from '../types'

/** News kept in the game state; older items drop off. */
export const MAX_NEWS = 200

export type NewNewsItem = Omit<NewsItem, 'id' | 'at' | 'read'> & Partial<Pick<NewsItem, 'id' | 'at' | 'read'>>

export interface GameStoreState {
  loaded: boolean
  /** Set when storage couldn't be read or written; the store keeps working in memory. */
  error: string | null
  relationships: Record<string, Relationship>
  game: GameState
  /** Load relationships and game state from Dexie. Safe to call more than once. */
  load: () => Promise<void>
  /** Read everything again (after a save import or a slot restore). */
  reload: () => Promise<void>
  /**
   * The relationship with a character. One that doesn't exist yet comes back as a fresh default
   * (the same object on every call until it's saved), so it's safe inside a store selector.
   */
  rel: (characterId: string) => Relationship
  /** Store and persist a relationship (replaces the one with the same characterId). */
  saveRel: (rel: Relationship) => Promise<void>
  patchGame: (patch: Partial<GameState>) => Promise<void>
  /** Add a news item (newest last) and return it. */
  addNews: (item: NewNewsItem) => Promise<NewsItem>
  /** Mark news read: the given ids, or all of it. */
  markNewsRead: (ids?: readonly string[]) => Promise<void>
}

function newsId(now: number): string {
  return `news-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Build a game store bound to a database. The app uses `useGame`; tests make their own. */
export function createGameStore(d: CrushDB = db) {
  let loading: Promise<void> | null = null
  /** Defaults handed out by rel() for characters with no stored relationship yet. */
  const fresh = new Map<string, Relationship>()

  return create<GameStoreState>()((set, get) => {
    const guard = async (write: () => Promise<unknown>) => {
      try {
        await write()
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) })
      }
    }
    const persistGame = (game: GameState) => guard(() => kvSet('game', game, d))

    const read = async () => {
      try {
        const [rows, stored] = await Promise.all([getAllRelationships(d), kvGet<unknown>('game', d)])
        const relationships: Record<string, Relationship> = {}
        for (const row of rows) {
          const rel = withRelationshipDefaults(row)
          if (rel.characterId) relationships[rel.characterId] = rel
        }
        fresh.clear()
        set({ relationships, game: withGameDefaults(stored), loaded: true, error: null })
      } catch (e) {
        set({ loaded: true, error: e instanceof Error ? e.message : String(e) })
      }
    }

    const load = () => {
      if (loading) return loading
      if (get().loaded) return Promise.resolve()
      loading = read().finally(() => {
        loading = null
      })
      return loading
    }

    return {
      loaded: false,
      error: null,
      relationships: {},
      game: newGameState(),

      load,

      reload: () => {
        loading = read().finally(() => {
          loading = null
        })
        return loading
      },

      rel: (characterId) => {
        const stored = get().relationships[characterId]
        if (stored) return stored
        let rel = fresh.get(characterId)
        if (!rel) {
          rel = newRelationship(characterId)
          fresh.set(characterId, rel)
        }
        return rel
      },

      saveRel: async (rel) => {
        await load()
        const copy: Relationship = { ...rel }
        fresh.delete(copy.characterId)
        set({ relationships: { ...get().relationships, [copy.characterId]: copy } })
        await guard(() => putRelationship(copy, d))
      },

      patchGame: async (patch) => {
        await load()
        const game = { ...get().game, ...patch }
        // News written by the date flow comes in whole; keep only the newest, like addNews does.
        if (patch.news && game.news.length > MAX_NEWS) game.news = game.news.slice(-MAX_NEWS)
        set({ game })
        await persistGame(game)
      },

      addNews: async (item) => {
        await load()
        const now = Date.now()
        const news: NewsItem = {
          ...item,
          id: item.id ?? newsId(now),
          at: item.at ?? now,
          read: item.read ?? false,
          characterIds: [...(item.characterIds ?? [])],
        }
        const prev = get().game
        const game = { ...prev, news: [...prev.news, news].slice(-MAX_NEWS) }
        set({ game })
        await persistGame(game)
        return news
      },

      markNewsRead: async (ids) => {
        await load()
        const prev = get().game
        const which = ids ? new Set(ids) : null
        const game = {
          ...prev,
          news: prev.news.map((n) => (!n.read && (!which || which.has(n.id)) ? { ...n, read: true } : n)),
        }
        set({ game })
        await persistGame(game)
      },
    }
  })
}

export const useGame = createGameStore()

/** A relationship from a state snapshot, without touching the store (fresh default if none). */
export function relOf(state: Pick<GameStoreState, 'relationships'>, characterId: string): Relationship {
  return state.relationships[characterId] ?? newRelationship(characterId)
}
