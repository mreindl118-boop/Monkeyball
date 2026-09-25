import { beforeEach, describe, expect, it } from 'vitest'
import { DEBUG_LIMIT, useDebug } from './debug'

describe('useDebug', () => {
  beforeEach(() => useDebug.getState().clear())

  it('logs entries with ids and timestamps and tracks the last one per kind', () => {
    const id = useDebug.getState().log({ kind: 'story', prompt: 'p1' })
    useDebug.getState().log({ kind: 'judge', prompt: 'j1' })
    const s = useDebug.getState()
    expect(s.entries).toHaveLength(2)
    expect(s.entries[0]).toMatchObject({ id, kind: 'story', prompt: 'p1' })
    expect(typeof s.entries[0].at).toBe('number')
    expect(s.lastByKind.story?.prompt).toBe('p1')
    expect(s.lastByKind.judge?.prompt).toBe('j1')
  })

  it('patches an entry and its lastByKind copy', () => {
    const id = useDebug.getState().log({ kind: 'story', prompt: 'p' })
    useDebug.getState().patch(id, { response: 'hello' })
    expect(useDebug.getState().entries[0].response).toBe('hello')
    expect(useDebug.getState().lastByKind.story?.response).toBe('hello')
  })

  it('keeps only the last 200 entries', () => {
    for (let i = 0; i < DEBUG_LIMIT + 25; i++) useDebug.getState().log({ kind: 'test', prompt: String(i) })
    const { entries } = useDebug.getState()
    expect(entries).toHaveLength(DEBUG_LIMIT)
    expect(entries[0].prompt).toBe('25')
    expect(entries[entries.length - 1].prompt).toBe(String(DEBUG_LIMIT + 24))
  })

  it('clears', () => {
    useDebug.getState().log({ kind: 'memory', prompt: 'm' })
    useDebug.getState().clear()
    expect(useDebug.getState().entries).toEqual([])
    expect(useDebug.getState().lastByKind).toEqual({})
  })
})
