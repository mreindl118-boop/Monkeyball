import { describe, expect, it } from 'vitest'
import { groupEndLine, groupPlaceholder, groupStatusText, namesText } from './dateModel'

describe('group date copy', () => {
  it('names both and agrees the verb', () => {
    expect(namesText(['Nova', 'Kai'])).toBe('Nova and Kai')
    expect(groupStatusText('replying', ['Nova', 'Kai'])).toBe('Nova and Kai are replying')
    expect(groupStatusText('judging', ['Nova'])).toBe('Nova is thinking')
    expect(groupPlaceholder('awaiting-player', ['Nova', 'Kai'])).toBe('Say something to Nova and Kai')
  })
  it('says who left at the end', () => {
    expect(groupEndLine('ended', 'completed', ['Kai'], ['Nova', 'Kai'])).toBe('That was the last turn. Kai left early.')
    expect(groupEndLine('ended', 'left', ['Nova', 'Kai'], ['Nova', 'Kai'])).toBe('Nova and Kai left.')
    expect(groupEndLine('closing', undefined, ['Nova', 'Kai'], ['Nova', 'Kai'])).toBe('Nova and Kai are leaving.')
    expect(groupEndLine('ended', 'ended', [], ['Nova', 'Kai'])).toBe('You ended the date.')
  })
})
