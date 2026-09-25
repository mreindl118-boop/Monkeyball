import { describe, expect, it } from 'vitest'
import type { DateTurn } from '../../types'
import {
  composerPlaceholder,
  deltaText,
  dtrVisible,
  fillFromChip,
  firstName,
  gainCapped,
  inputLocked,
  lastApplied,
  lastCharacterLine,
  moodWord,
  parseStory,
  playerTurnCount,
  signed,
  statusText,
  suggestionChips,
  turnLabel,
  visibleTurns,
} from './dateModel'

const t = (role: DateTurn['role'], text: string, extra: Partial<DateTurn> = {}): DateTurn => ({ role, text, at: 0, ...extra })

describe('parseStory', () => {
  it('splits actions from dialogue and drops the asterisks', () => {
    expect(parseStory('*She grins.* "You came."')).toEqual([
      [
        { kind: 'action', text: 'She grins.' },
        { kind: 'text', text: ' "You came."' },
      ],
    ])
  })

  it('makes paragraphs from blank lines and keeps single newlines', () => {
    const out = parseStory('"Hi."\n\n*Leans in*\nclose.\n\n\n"Bye."')
    expect(out).toHaveLength(3)
    expect(out[1]).toEqual([
      { kind: 'action', text: 'Leans in' },
      { kind: 'text', text: '\nclose.' },
    ])
  })

  it('treats an unclosed asterisk (mid-stream) as an action to the end', () => {
    expect(parseStory('"Well," *she says, tilting her')).toEqual([
      [
        { kind: 'text', text: '"Well," ' },
        { kind: 'action', text: 'she says, tilting her' },
      ],
    ])
  })

  it('treats double asterisks as one marker and ignores empty input', () => {
    expect(parseStory('**Laughs**')).toEqual([[{ kind: 'action', text: 'Laughs' }]])
    expect(parseStory('')).toEqual([])
    expect(parseStory('  \n\n ')).toEqual([])
  })
})

describe('turns and deltas', () => {
  const record = {
    maxTurns: 10,
    turns: [
      t('character', 'Hello'),
      t('player', 'Hi', { applied: { nova: { affection: 3, trust: 1 } } }),
      t('character', 'Nice'),
      t('player', 'Cute', { applied: { nova: { affection: -6, trust: -2 } } }),
      t('system', 'Note'),
    ],
  }

  it('counts player turns and labels the turn being played', () => {
    expect(playerTurnCount(record)).toBe(2)
    expect(turnLabel(record)).toBe('Turn 3 of 10')
    expect(turnLabel({ maxTurns: 10, turns: [] })).toBe('Turn 1 of 10')
    const done = { maxTurns: 2, turns: [t('player', 'a'), t('player', 'b')] }
    expect(turnLabel(done)).toBe('Turn 2 of 2')
    expect(turnLabel(done, true)).toBe('Turn 2 of 2')
  })

  it('stays on the turn that was played once the date is over early', () => {
    // A walkout (or End date) after the first message: turn 1, not a turn 2 that never happened.
    const left = { maxTurns: 10, turns: [t('character', 'Hello'), t('player', 'Rude'), t('character', 'Bye')] }
    expect(turnLabel(left)).toBe('Turn 2 of 10')
    expect(turnLabel(left, true)).toBe('Turn 1 of 10')
    // End date before any message.
    expect(turnLabel({ maxTurns: 10, turns: [t('character', 'Hello')] }, true)).toBe('Turn 1 of 10')
  })

  it('reads the last applied deltas', () => {
    expect(lastApplied(record, 'nova')).toEqual({ affection: -6, trust: -2 })
    expect(lastApplied(record, 'kai')).toBeUndefined()
    expect(lastApplied({ turns: [] }, 'nova')).toBeUndefined()
  })

  it('formats signed numbers and the hints line', () => {
    expect(signed(4)).toBe('+4')
    expect(signed(-3)).toBe('−3')
    expect(signed(0)).toBe('0')
    expect(signed(Number.NaN)).toBe('0')
    expect(deltaText({ affection: 4, trust: -1 })).toBe('Affection +4, trust −1')
    expect(deltaText(undefined)).toBe('')
    expect(deltaText({ affection: 1, trust: 1 }, true)).toBe("Affection +1 (this date's limit), trust +1")
    // A loss that counts toward the date while the meter sits at 0.
    expect(deltaText({ affection: -8, trust: 0 }, false, true)).toBe('Affection −8 (the meter stops at 0), trust 0')
    expect(deltaText({ affection: 2, trust: 0 }, false, true)).toBe('Affection +2, trust 0')
  })

  it("notes when the date's gain limit held a gain back", () => {
    expect(gainCapped(6, 1, 25, 25)).toBe(true)
    expect(gainCapped(6, 0, 25, 25)).toBe(true)
    expect(gainCapped(6, 6, 24, 25)).toBe(false)
    // Held back by the meter (the friend-route cap), not by the date's limit.
    expect(gainCapped(6, 2, 12, 25)).toBe(false)
    expect(gainCapped(-8, -8, 25, 25)).toBe(false)
    expect(gainCapped(6, undefined, 25, 25)).toBe(false)
    // The meter's own rise used the allowance (a loss taken at 0 left the date's total lower).
    expect(gainCapped(10, 5, Math.max(7, 25), 25)).toBe(true)
  })

  it('keeps only turns with text and finds the last character line', () => {
    expect(visibleTurns([t('player', ' '), t('character', '*waves*')])).toHaveLength(1)
    expect(lastCharacterLine(record.turns)).toBe('Nice')
    expect(lastCharacterLine([t('character', '*She laughs*')])).toBe('She laughs')
    expect(lastCharacterLine([])).toBe('')
  })
})

describe('status copy', () => {
  it('says what the character is doing in sentence case', () => {
    expect(statusText('judging', 'Nova Castellanos')).toBe('Nova is thinking')
    expect(statusText('replying', 'Nova Castellanos')).toBe('Nova is replying')
    expect(statusText('opening', 'Kai')).toBe('Kai is on the way')
    expect(statusText('suggesting', 'Kai')).toBe('Thinking of things you could say')
    expect(statusText('awaiting-player', 'Kai')).toBe('')
    expect(statusText('ended', 'Kai')).toBe('The date is over')
  })

  it('locks the input only while the character has the floor', () => {
    expect(inputLocked('judging')).toBe(true)
    expect(inputLocked('replying')).toBe(true)
    expect(inputLocked('opening')).toBe(true)
    expect(inputLocked('awaiting-player')).toBe(false)
    expect(inputLocked('suggesting')).toBe(false)
  })

  it('invites the player on their turn', () => {
    expect(composerPlaceholder('awaiting-player', 'Nova Castellanos')).toBe('Say something to Nova')
    expect(composerPlaceholder('judging', 'Nova Castellanos')).toBe('Nova is thinking')
  })

  it('capitalizes the mood and has a word before the first judge', () => {
    expect(moodWord('amused.')).toBe('Amused')
    expect(moodWord('')).toBe('Settling in')
    expect(moodWord(undefined)).toBe('Settling in')
    expect(moodWord('neutral')).toBe('Neutral')
  })

  it('uses a first name, with a fallback', () => {
    expect(firstName('  Nova  Castellanos ')).toBe('Nova')
    expect(firstName('')).toBe('They')
  })

  it('shows Define the relationship from Friend stage', () => {
    expect(dtrVisible(39)).toBe(false)
    expect(dtrVisible(40)).toBe(true)
    expect(dtrVisible(100)).toBe(true)
  })
})

describe('suggestion chips', () => {
  it('orders the chips by route and labels them', () => {
    expect(suggestionChips({ bold: 'B', sweet: 'S', flirty: 'F' }).map((c) => c.label)).toEqual(['Sweet', 'Flirty', 'Bold'])
    expect(suggestionChips({ honest: 'H', curious: 'C', sweet: 'S' }, 'friend').map((c) => c.key)).toEqual([
      'sweet',
      'curious',
      'honest',
    ])
  })

  it('drops empty chips and handles no suggestions', () => {
    expect(suggestionChips({ sweet: ' ', flirty: 'F', bold: 'B' })).toHaveLength(2)
    expect(suggestionChips(null)).toEqual([])
  })

  it('fills an empty input and never sends', () => {
    expect(fillFromChip('', 'Tell me about the record.')).toBe('Tell me about the record.')
    expect(fillFromChip('   ', ' Hi ')).toBe('Hi')
  })

  it('swaps one chip for another', () => {
    const chips = ['One line.', 'Other line.']
    expect(fillFromChip('One line.', 'Other line.', chips)).toBe('Other line.')
  })

  it('keeps what the player typed and adds the chip after it', () => {
    expect(fillFromChip('So,  ', 'what are you listening to?')).toBe('So, what are you listening to?')
  })

  it('ignores an empty chip', () => {
    expect(fillFromChip('typed', '  ')).toBe('typed')
  })
})
