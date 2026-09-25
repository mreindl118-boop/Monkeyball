import { describe, expect, it } from 'vitest'
import { MEMORY_INSTRUCTION, TEMPLATES } from '../prompts/build'
import {
  appendMemory,
  applyCompression,
  cleanSummary,
  compressionRequest,
  compressionSplit,
  memoryRequest,
  memoryWords,
  needsCompression,
  wordCount,
} from './memory'

const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ')

describe('memory', () => {
  it('counts words', () => {
    expect(wordCount('  one two\nthree  ')).toBe(3)
    expect(wordCount('')).toBe(0)
    expect(memoryWords(['a b', 'c'])).toBe(3)
  })

  it('appends a cleaned summary and skips empty ones', () => {
    expect(appendMemory([], '"We went to the record store.\nShe liked it."')).toEqual([
      'We went to the record store. She liked it.',
    ])
    expect(appendMemory(['one'], '   ')).toEqual(['one'])
    expect(cleanSummary('```\nplain text\n```')).toBe('plain text')
  })

  it('needs compression past 250 words when something is older than the last two dates', () => {
    expect(needsCompression([words(100), words(100), words(40)])).toBe(false) // 240
    expect(needsCompression([words(100), words(100), words(60)])).toBe(true) // 260
    expect(needsCompression([words(200), words(200)])).toBe(false) // nothing older than the last two
  })

  it('compresses everything older than the last two dates into entry 0', () => {
    const memory = ['first', 'second', 'third', 'fourth']
    expect(compressionSplit(memory)).toEqual({ older: ['first', 'second'], recent: ['third', 'fourth'] })
    expect(applyCompression(memory, ' One paragraph. ')).toEqual(['One paragraph.', 'third', 'fourth'])
    expect(applyCompression(memory, '')).toEqual(memory)
  })

  it('builds the summary and compression calls with the memory prompt', () => {
    const req = memoryRequest(
      { name: 'Nova Castellanos' },
      [
        { role: 'character', text: 'Hey, trouble.' },
        { role: 'player', text: 'Hi.' },
      ],
      { characterName: 'Nova Castellanos', venue: 'Record store' },
    )
    expect(req.system).toBe(TEMPLATES.memory.trim().replace('{name}', 'Nova Castellanos'))
    expect(req.messages[0]).toEqual({ role: 'system', content: req.system })
    expect(req.messages[1].content).toContain('Venue: Record store.')
    expect(req.messages[1].content).toContain('Nova Castellanos: Hey, trouble.\nPlayer: Hi.')
    expect(req.messages[1].content).toContain(MEMORY_INSTRUCTION)

    const c = compressionRequest({ name: 'Nova Castellanos' }, ['one', 'two', 'three', 'four'])
    expect(c.system).toBe(req.system)
    expect(c.messages[1].content).toContain('one\n\ntwo')
    expect(c.messages[1].content).not.toContain('three')
  })
})
