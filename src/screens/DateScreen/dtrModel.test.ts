import { describe, expect, it } from 'vitest'
import { DTR_CHOICES, dtrOpenLine, dtrOutcome, dtrWord, initialChoice, offerDetail, offerText } from './dtrModel'

describe('define the relationship', () => {
  it('offers the four choices with a line each', () => {
    expect(DTR_CHOICES.map((c) => c.type)).toEqual(['exclusive', 'open', 'poly', 'casual'])
    expect(DTR_CHOICES.map((c) => c.title)).toEqual(['Exclusive', 'Open', 'Poly', 'Keep it casual'])
    for (const c of DTR_CHOICES) {
      expect(c.line.length).toBeGreaterThan(10)
      expect(c.line).not.toMatch(/[←→·]|->|\b[A-Z]{3,}\b/)
    }
  })

  it('opens the sheet on what they asked for, else on the current agreement', () => {
    expect(initialChoice('poly', 'open')).toBe('poly')
    expect(initialChoice(null, 'open')).toBe('open')
    expect(initialChoice(undefined, 'none')).toBe('exclusive')
  })

  it('words the offer and the open talk', () => {
    expect(offerText('Nova Castellanos')).toBe('Nova wants to talk about what you are')
    expect(offerDetail('Nova Castellanos', 'casual')).toBe('Nova has keeping it casual in mind.')
    expect(dtrOpenLine('Nova', 'exclusive', 'player')).toBe('You asked for exclusive. Say what you want, then close the talk.')
    expect(dtrOpenLine('Nova', 'open', 'character')).toMatch(/^Nova brought it up\. You asked for open\./)
    expect(dtrWord('none')).toBe('no agreement')
  })

  it('tells accepted, countered and declined apart', () => {
    const yes = dtrOutcome('Nova', 'exclusive', { agreement: 'exclusive', accepted: true, terms: 'Just us, trouble.', trustDelta: 3 })
    expect(yes).toEqual({ kind: 'accepted', title: 'Nova said yes', line: "You're exclusive now.", terms: 'Just us, trouble.' })
    const counter = dtrOutcome('Nova', 'exclusive', { agreement: 'open', accepted: true, terms: 'Open, but tell me.', trustDelta: 1 })
    expect(counter.kind).toBe('countered')
    expect(counter.line).toBe('You asked for exclusive. You settled on open.')
    const no = dtrOutcome('Nova', 'exclusive', { agreement: 'none', accepted: false, terms: 'Not yet.', trustDelta: -1 }, { type: 'casual' })
    expect(no).toMatchObject({ kind: 'declined', title: 'Nova said no', line: "You're still casual." })
    const nothing = dtrOutcome('Nova', 'poly', { agreement: 'none', accepted: false, terms: '', trustDelta: 0 })
    expect(nothing).toMatchObject({ title: "The talk didn't settle anything", line: 'Nothing is agreed yet.' })
  })
})
