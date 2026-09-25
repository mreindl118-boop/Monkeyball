import { describe, expect, it } from 'vitest'
import {
  epilogueSlotId,
  epilogueSlotLabel,
  endingReady,
  groupText,
  isAutosave,
  notReadyText,
  playedEnding,
  reachedWon,
  readyLine,
  reasonSentence,
  reloadHint,
  seenEndings,
} from './endingModel'

describe('the epilogue autosave', () => {
  it('has one id per character, marked as automatic', () => {
    expect(epilogueSlotId('nova')).toBe('auto-epilogue-nova')
    expect(isAutosave(epilogueSlotId('nova'))).toBe(true)
    expect(isAutosave('slot-abc')).toBe(false)
  })

  it('is labelled with their first name', () => {
    expect(epilogueSlotLabel('Nova Castellanos')).toBe("Before Nova's epilogue")
    expect(epilogueSlotLabel('Jules Moreau')).toBe("Before Jules' epilogue")
  })

  it('is written the first time they reach 100', () => {
    expect(reachedWon({ affection: 92 }, { affection: 100 })).toBe(true)
    expect(reachedWon({ affection: 100 }, { affection: 100 })).toBe(false)
    expect(reachedWon({ affection: 60 }, { affection: 80 })).toBe(false)
  })
})

describe('when the ending is ready', () => {
  it('needs 100 affection on a romantic route', () => {
    expect(endingReady({ affection: 100 }, 'romantic')).toBe(true)
    expect(endingReady({ affection: 99 }, 'romantic')).toBe(false)
    expect(endingReady({ affection: 100 }, 'friend')).toBe(false)
  })

  it('says why not yet', () => {
    expect(notReadyText('Nova Castellanos', 72, 'romantic')).toBe("Nova's epilogue unlocks at 100 affection. You're at 72.")
    expect(notReadyText('Priya Raman', 59, 'friend')).toMatch(/^Priya is a friend\./)
    expect(notReadyText('Nova', 100, 'romantic')).toBe('')
  })
})

describe('reading the ending', () => {
  it('names every member of a polycule, this character first', () => {
    const names = { nova: 'Nova Castellanos', rook: 'Rook Adeyemi', dex: 'Dex Park' }
    expect(groupText('rook', ['nova', 'rook', 'dex'], names)).toBe('Rook, Nova and Dex')
    expect(groupText('nova', ['kai'], names)).toBe('Nova and kai')
    expect(groupText('nova', undefined, names)).toBe('Nova')
  })

  it('turns the reason into a sentence', () => {
    expect(reasonSentence('trust broke somewhere')).toBe('Trust broke somewhere.')
    expect(reasonSentence('Already one.')).toBe('Already one.')
    expect(reasonSentence('  ')).toBe('')
  })

  it('knows what was played and seen', () => {
    expect(playedEnding({})).toBeNull()
    expect(playedEnding({ ending: { type: 'good', playedAt: 5 } })).toEqual({ type: 'good', playedAt: 5 })
    expect(seenEndings({ nova: ['good', 'bitter', 'good'] }, 'nova')).toEqual(['good', 'bitter'])
    expect(seenEndings(undefined, 'nova')).toEqual([])
  })

  it('points at the autosave when there is one', () => {
    expect(reloadHint('Nova Castellanos', true)).toContain('"Before Nova\'s epilogue" is in Settings, Saves')
    expect(reloadHint('Nova Castellanos', false)).not.toContain('Settings')
    expect(readyLine('Nova Castellanos', false)).toBe("You won Nova's heart. One last date plays the ending you're on.")
  })
})
