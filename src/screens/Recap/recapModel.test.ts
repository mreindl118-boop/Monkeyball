import { describe, expect, it } from 'vitest'
import nova from '../../data/sets/afterhours/characters/nova.json'
import type { Character, DateRecord } from '../../types'
import {
  changeBadge,
  changeText,
  direction,
  giftReactionLine,
  leftDamageText,
  memoryQuote,
  meterChange,
  outcomeText,
  recapFor,
  recapSecrets,
  recapTiers,
  recapTraits,
  revealedLines,
  stageChangeText,
  venuePhrase,
  venueReactionLine,
} from './recapModel'

const character = nova as unknown as Character

describe('meter changes in words', () => {
  it('says from and to, never with arrows', () => {
    expect(changeText(34, 41)).toBe('from 34 to 41')
    expect(changeText(34.4, 34.2)).toBe('at 34')
    expect(meterChange('Affection', 34, 41)).toBe('Affection rose from 34 to 41')
    expect(meterChange('Trust', 20, 14)).toBe('Trust fell from 20 to 14')
    expect(meterChange('Trust', 20, 20)).toBe('Trust stayed at 20')
    for (const s of [changeText(1, 9), meterChange('Trust', 9, 1)]) expect(s).not.toMatch(/[←→]|->/)
  })

  it('gives a direction and a badge', () => {
    expect(direction(1, 2)).toBe('up')
    expect(direction(2, 1)).toBe('down')
    expect(direction(2, 2)).toBe('same')
    expect(changeBadge(34, 41)).toBe('+7')
    expect(changeBadge(41, 34)).toBe('−7')
    expect(changeBadge(3, 3)).toBe('No change')
  })

  it('describes the stage change', () => {
    expect(stageChangeText('acquaintance', 'friend')).toBe('Now Friend, up from Acquaintance')
    expect(stageChangeText('acquaintance', 'stranger')).toBe('Down to Stranger from Acquaintance')
    expect(stageChangeText('friend', 'friend')).toBe('Still Friend')
  })

  it('says how the date ended', () => {
    expect(outcomeText('completed', 'Nova')).toBe('You saw the date through.')
    expect(outcomeText('left', 'Nova')).toBe('Nova left early.')
    expect(outcomeText('ended', 'Nova')).toBe('You ended the date early.')
    expect(outcomeText(undefined, 'Nova')).toBe('You saw the date through.')
  })

  it('shows the damage when they walk out', () => {
    expect(leftDamageText('Nova', { affectionBefore: 34, affectionAfter: 12, trustBefore: 20, trustAfter: 14 })).toBe(
      'Nova walked out. Affection fell from 34 to 12, and trust fell from 20 to 14.',
    )
    expect(leftDamageText('Nova', { affectionBefore: 30, affectionAfter: 10, trustBefore: 5, trustAfter: 5 })).toBe(
      'Nova walked out. Affection fell from 30 to 10.',
    )
  })

  it("shows the date's running total, which the meter can't when it stops at 0", () => {
    // A first date at 0: the meter never moves, so only the total shows the damage.
    expect(leftDamageText('Nova', { affectionBefore: 0, affectionAfter: 0, trustBefore: 0, trustAfter: 0 }, -20)).toBe(
      'Nova walked out after the date ran to −20 affection. Affection was already at 0, as low as it goes.',
    )
    expect(leftDamageText('Nova', { affectionBefore: 11, affectionAfter: 0, trustBefore: 20, trustAfter: 14 }, -25)).toBe(
      'Nova walked out after the date ran to −25 affection. Affection fell from 11 to 0, as low as it goes, and trust fell from 20 to 14.',
    )
    expect(leftDamageText('Nova', { affectionBefore: 34, affectionAfter: 12, trustBefore: 20, trustAfter: 20 }, -22)).toBe(
      'Nova walked out after the date ran to −22 affection. Affection fell from 34 to 12.',
    )
  })
})

describe('what the date revealed', () => {
  it('lists traits with their labels and hints, skipping unknown ids and repeats', () => {
    const rows = recapTraits(character, [
      { type: 'turnOff', id: 'cute', hint: 'Her smile goes flat', at: 1 },
      { type: 'like', id: 'vinyl', hint: '', at: 2 },
      { type: 'like', id: 'nope', hint: 'x', at: 3 },
      { type: 'like', id: 'vinyl', hint: 'again', at: 4 },
    ])
    expect(rows.map((r) => [r.kind, r.label, r.hint])).toEqual([
      ['Turn-off', 'Being called cute', 'Her smile goes flat'],
      ['Like', 'Vinyl records and liner-note trivia', ''],
    ])
  })

  it('words venue and gift reactions', () => {
    expect(venuePhrase('record-store', 'Record store')).toBe('the record store')
    expect(venuePhrase('home', 'Home')).toBe('staying in')
    expect(venueReactionLine('Nova', 'record-store', 'Record store', 'favorite')).toBe('Nova loves the record store.')
    expect(venueReactionLine('Nova', 'climbing-gym', 'Climbing gym', 'hated')).toBe("Nova can't stand the climbing gym.")
    expect(venueReactionLine('Nova', 'arcade', 'Arcade', 'neutral')).toBe('Nova is fine with the arcade.')
    expect(giftReactionLine('Nova', 'Rare vinyl', 'loved')).toBe('Nova loved the rare vinyl.')
    expect(giftReactionLine('Nova', 'Flowers', 'hated')).toBe('Nova hated the flowers.')
    expect(giftReactionLine('Nova', 'Chocolates', 'neutral')).toBe('Nova liked the chocolates well enough.')
  })

  it('reads earned secrets and unlocked tiers from the card', () => {
    expect(recapSecrets(character, [0])).toEqual([character.secrets[0].text])
    expect(recapSecrets(character, [7])).toEqual([])
    expect(recapTiers(character, [2, 1, 2])).toEqual([
      { tier: 1, title: 'Behind the decks' },
      { tier: 2, title: 'Afterhours' },
    ])
  })

  it('says what came up for the first time', () => {
    expect(revealedLines('Nova', { attractions: true, style: false, playerStyle: true })).toEqual([
      'You found out who Nova is into.',
      'Nova knows how you date now.',
    ])
    expect(revealedLines('Nova', undefined)).toEqual([])
  })

  it('unwraps the memory line', () => {
    expect(memoryQuote(' "We argued about B-sides." ')).toBe('We argued about B-sides.')
    expect(memoryQuote(undefined)).toBe('')
  })

  it('finds the recap for the date character', () => {
    const record = {
      characterIds: ['nova'],
      recap: { perCharacter: { nova: { affectionBefore: 1 } } },
    } as unknown as DateRecord
    expect(recapFor(record)?.affectionBefore).toBe(1)
    expect(recapFor(record, 'kai')).toBeUndefined()
    expect(recapFor(null)).toBeUndefined()
  })
})
