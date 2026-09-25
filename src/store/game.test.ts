import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { CrushDB } from '../db/db'
import { kvGet, kvSet } from '../db/repo'
import { newGameState, newRelationship } from '../engine/relationship'
import type { GameState } from '../types'
import { createGameStore, MAX_NEWS, relOf } from './game'

let counter = 0
const open: CrushDB[] = []
function freshDb(): CrushDB {
  const d = new CrushDB(`game-test-${Date.now()}-${counter++}`)
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

describe('useGame', () => {
  it('loads an empty game', async () => {
    const store = createGameStore(freshDb())
    await store.getState().load()
    const s = store.getState()
    expect(s.loaded).toBe(true)
    expect(s.error).toBeNull()
    expect(s.relationships).toEqual({})
    expect({ ...s.game, startedAt: 0 }).toEqual(newGameState(0))
  })

  it('hands out a stable default relationship without storing it', async () => {
    const d = freshDb()
    const store = createGameStore(d)
    await store.getState().load()
    const a = store.getState().rel('nova')
    expect(a).toEqual(newRelationship('nova'))
    expect(store.getState().rel('nova')).toBe(a) // safe inside a zustand selector
    expect(store.getState().relationships).toEqual({})
    expect(await d.relationships.get('nova')).toBeUndefined()
  })

  it('saves relationships and reads them back', async () => {
    const d = freshDb()
    const store = createGameStore(d)
    await store.getState().load()
    const rel = { ...store.getState().rel('nova'), affection: 42, trust: 17 }
    await store.getState().saveRel(rel)
    expect(store.getState().rel('nova')).toMatchObject({ affection: 42, trust: 17 })
    expect(await d.relationships.get('nova')).toMatchObject({ affection: 42 })

    const again = createGameStore(d)
    await again.getState().load()
    expect(again.getState().rel('nova')).toMatchObject({ characterId: 'nova', affection: 42, trust: 17 })
    expect(relOf(again.getState(), 'kai')).toEqual(newRelationship('kai'))
  })

  it('repairs stored relationships and game state from older versions', async () => {
    const d = freshDb()
    await d.relationships.put({ characterId: 'kai', affection: 30 } as never)
    await kvSet('game', { startedAt: 5, news: [] }, d)
    const store = createGameStore(d)
    await store.getState().load()
    expect(store.getState().rel('kai')).toEqual({ ...newRelationship('kai'), affection: 30 })
    expect(store.getState().game).toEqual({ ...newGameState(5) })
  })

  it('patches and persists the game state', async () => {
    const d = freshDb()
    const store = createGameStore(d)
    await store.getState().load()
    await store.getState().patchGame({ metamours: { 'dex|imani': 70 }, rekindled: ['kai|nova'] })
    expect(store.getState().game.metamours).toEqual({ 'dex|imani': 70 })
    const stored = await kvGet<GameState>('game', d)
    expect(stored?.rekindled).toEqual(['kai|nova'])
  })

  it('keeps news written by the date flow under the cap too', async () => {
    const d = freshDb()
    const store = createGameStore(d)
    await store.getState().load()
    const news = Array.from({ length: MAX_NEWS + 30 }, (_, i) => ({ id: `w${i}`, at: i, kind: 'gossip' as const, text: `${i}`, characterIds: [], read: false }))
    await store.getState().patchGame({ news })
    expect(store.getState().game.news).toHaveLength(MAX_NEWS)
    expect(store.getState().game.news.at(-1)!.id).toBe(`w${MAX_NEWS + 29}`)
    expect((await kvGet<GameState>('game', d))?.news).toHaveLength(MAX_NEWS)
  })

  it('adds news, newest last, capped, and marks it read', async () => {
    const d = freshDb()
    const store = createGameStore(d)
    await store.getState().load()
    const item = await store.getState().addNews({ kind: 'gossip', text: 'Kai heard about you and Nova.', characterIds: ['kai', 'nova'] })
    expect(item.id).toMatch(/^news-/)
    expect(item.read).toBe(false)
    expect(item.at).toBeGreaterThan(0)
    expect(store.getState().game.news).toEqual([item])
    expect((await kvGet<GameState>('game', d))?.news).toEqual([item])

    for (let i = 0; i < MAX_NEWS + 5; i++) {
      await store.getState().addNews({ id: `n${i}`, at: i, kind: 'system', text: `${i}`, characterIds: [] })
    }
    const news = store.getState().game.news
    expect(news).toHaveLength(MAX_NEWS)
    expect(news.at(-1)!.id).toBe(`n${MAX_NEWS + 4}`)

    await store.getState().markNewsRead(['n10'])
    expect(store.getState().game.news.find((n) => n.id === 'n10')!.read).toBe(true)
    expect(store.getState().game.news.find((n) => n.id === 'n11')!.read).toBe(false)
    await store.getState().markNewsRead()
    expect(store.getState().game.news.every((n) => n.read)).toBe(true)
  })

  it('waits for a load in progress, so an early save is not wiped', async () => {
    const d = freshDb()
    const store = createGameStore(d)
    const loading = store.getState().load()
    const saving = store.getState().saveRel({ ...newRelationship('theo'), affection: 30 })
    await Promise.all([loading, saving])
    expect(store.getState().relationships.theo?.affection).toBe(30)
    expect((await d.relationships.get('theo'))?.affection).toBe(30)
  })

  it('keeps working in memory when storage fails', async () => {
    const d = freshDb()
    const store = createGameStore(d)
    await store.getState().load()
    d.close()
    await store.getState().saveRel({ ...newRelationship('nova'), affection: 5 })
    expect(store.getState().rel('nova').affection).toBe(5)
    expect(store.getState().error).toBeTruthy()
  })
})
