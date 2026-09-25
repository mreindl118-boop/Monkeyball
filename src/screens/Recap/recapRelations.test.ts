import { describe, expect, it } from 'vitest'
import type { BetrayalEvent, NewsItem, Rumor } from '../../types'
import {
  agreementChange,
  agreementWords,
  betrayalHit,
  betrayalLine,
  betrayalVoice,
  dateNews,
  gossipLines,
  hitBadge,
  rumorLines,
} from './recapModel'

const names = { nova: 'Nova Castellanos', kai: 'Kai Okoro', jules: 'Jules Moreau' }

describe('agreement made or changed', () => {
  it('writes before and after as words', () => {
    const made = agreementChange({ type: 'none', terms: '', madeAt: 0 }, { type: 'exclusive', terms: 'Just us.', madeAt: 9 }, 'Nova')
    expect(made).toEqual({ line: 'You went from no agreement to exclusive.', terms: 'Just us.', made: true })
    expect(agreementChange({ type: 'open', terms: '', madeAt: 1 }, { type: 'poly', terms: '', madeAt: 2 }, 'Nova')?.line).toBe(
      'You went from open to poly.',
    )
    expect(agreementChange({ type: 'open', terms: 'a', madeAt: 1 }, { type: 'open', terms: 'b', madeAt: 2 }, 'Nova')?.line).toBe(
      'You and Nova are still open, on new terms.',
    )
    expect(agreementChange({ type: 'exclusive', terms: 'x', madeAt: 1 }, { type: 'none', terms: '', madeAt: 0 }, 'Nova')).toEqual({
      line: 'You went from exclusive to no agreement.',
      terms: '',
      made: false,
    })
    expect(agreementChange(undefined, undefined, 'Nova')).toBeNull()
    expect(agreementWords('casual')).toBe('casual')
  })

  it('never uses arrows', () => {
    const c = agreementChange(undefined, { type: 'casual', terms: '', madeAt: 1 }, 'Nova')
    expect(c?.line).not.toMatch(/[←→]|->/)
  })
})

describe('betrayals on the meters', () => {
  const b = (patch: Partial<BetrayalEvent> = {}): BetrayalEvent => ({
    at: 1,
    kind: 'agreement',
    about: 'kai',
    note: '"You said it was just us."',
    affectionDelta: -12,
    trustDelta: -24,
    ...patch,
  })

  it('adds up the hit and badges it', () => {
    expect(betrayalHit([b(), b({ affectionDelta: -10, trustDelta: -15 })])).toEqual({ affection: -22, trust: -39 })
    expect(betrayalHit(undefined)).toEqual({ affection: 0, trust: 0 })
    expect(hitBadge(-12)).toBe('Betrayal −12')
    expect(hitBadge(0)).toBe('')
  })

  it('says what came out', () => {
    expect(betrayalLine(b(), 'Nova', names)).toBe('Nova found out about Kai, and it broke what you two agreed.')
    expect(betrayalLine(b({ kind: 'lie', about: undefined }), 'Nova', names)).toBe('Nova caught you in a lie.')
    expect(betrayalLine(b({ note: 'Heard about Kai through the grapevine after you agreed to be exclusive.' }), 'Nova', names)).toBe(
      'Nova heard about Kai through the grapevine after you agreed to be exclusive.',
    )
    expect(betrayalVoice(b({ memory: '"We agreed to be exclusive."' }))).toBe('We agreed to be exclusive.')
    expect(betrayalVoice(b())).toBe('')
  })
})

describe('gossip, rumors and rekindles', () => {
  const rumors: Rumor[] = [
    { id: 'breakup-kai-side', teller: 'jules', about: ['kai', 'nova'], text: 'She broke their heart.', truth: 'exaggerated' },
  ]

  it('reads rumor ids as the teller told them, and keeps plain text', () => {
    expect(rumorLines(['breakup-kai-side', 'breakup-kai-side', 'Something odd.'], rumors, names)).toEqual([
      { key: 'breakup-kai-side', teller: 'Jules', text: 'She broke their heart.' },
      { key: 'Something odd.', teller: '', text: 'Something odd.' },
    ])
  })

  it('tidies gossip', () => {
    expect(gossipLines([' Kai is into you. ', 'Kai is into you', ''])).toEqual(['Kai is into you.'])
    expect(gossipLines(['Is Kai into you?'])).toEqual(['Is Kai into you?'])
  })

  it('finds the rekindle news this date produced', () => {
    const news: NewsItem[] = [
      { id: 'a', at: 50, kind: 'rekindle', text: 'Nova and Kai got close again.', characterIds: ['nova', 'kai'], read: false },
      { id: 'b', at: 200_000, kind: 'rekindle', text: 'Later.', characterIds: [], read: false },
      { id: 'c', at: 60, kind: 'gossip', text: 'Word.', characterIds: [], read: false },
    ]
    expect(dateNews({ startedAt: 10, endedAt: 100 }, news).map((n) => n.id)).toEqual(['a'])
  })
})
