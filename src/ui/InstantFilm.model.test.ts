import { describe, expect, it } from 'vitest'
import { DEVELOP_MS, FADE_MS, filmStates, pendingKeys, revealDuration } from './InstantFilm.model'

describe('instant film timing', () => {
  it('develops over about 2.5 seconds, or fades with reduced motion', () => {
    expect(DEVELOP_MS).toBe(2500)
    expect(revealDuration(false)).toBe(DEVELOP_MS)
    expect(revealDuration(true)).toBe(FADE_MS)
    expect(FADE_MS).toBeLessThan(DEVELOP_MS)
  })
})

describe('the reveal queue', () => {
  const keys = ['nova:tier-1', 'nova:tier-2', 'nova:tier-3']

  it('develops one print at a time, in order', () => {
    const none = new Set<string>()
    expect(filmStates(keys, none, 0)).toEqual(['developing', 'waiting', 'waiting'])
    expect(filmStates(keys, none, 1)).toEqual(['done', 'developing', 'waiting'])
    expect(filmStates(keys, none, 3)).toEqual(['done', 'done', 'done'])
  })

  it('keeps prints shown on an earlier visit developed and skips them in the queue', () => {
    const shown = new Set(['nova:tier-1'])
    expect(filmStates(keys, shown, 0)).toEqual(['done', 'developing', 'waiting'])
    expect(pendingKeys(keys, shown)).toEqual(['nova:tier-2', 'nova:tier-3'])
    expect(filmStates(keys, new Set(keys), 0)).toEqual(['done', 'done', 'done'])
  })
})
