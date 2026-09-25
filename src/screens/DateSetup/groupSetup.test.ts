import { describe, expect, it } from 'vitest'
import { giftById } from '../../data/gifts'
import { venueById } from '../../data/venues'
import { groupFeeling, pairHistory } from '../../engine/groupDate'
import { newRelationship } from '../../engine/relationship'
import { afterhoursRelations, card, rel, T0 } from '../../engine/testKit'
import { feelingLine, groupSummary, groupVenueOptions, historyLines, relationTo } from './setupModel'

const firsts = { nova: 'Nova', kai: 'Kai' }

describe('group date setup', () => {
  it('locks a venue locked for either, and lists what each thought of it', () => {
    const opts = groupVenueOptions([
      { first: 'Nova', rel: { ...newRelationship('nova'), affection: 90, venues: { arcade: 'hated' } }, route: 'romantic' },
      { first: 'Kai', rel: { ...newRelationship('kai'), venues: { arcade: 'favorite' } }, route: 'romantic' },
    ])
    expect(opts.find((o) => o.venue.id === 'home')?.lock).toBe('Needs Lover')
    expect(opts.find((o) => o.venue.id === 'arcade')?.known).toEqual([
      { first: 'Nova', reaction: 'hated' },
      { first: 'Kai', reaction: 'favorite' },
    ])
  })

  it('sums up who, where and the gift for whom', () => {
    expect(groupSummary(['Nova'], undefined, undefined)).toBe('Pick who comes along.')
    expect(groupSummary(['Nova', 'Kai'], undefined, undefined)).toBe('Pick a venue next.')
    expect(groupSummary(['Nova', 'Kai'], venueById('karaoke-box'), giftById('hot-sauce'), 'Nova')).toBe(
      'The karaoke box with Nova and Kai, bringing hot sauce for Nova.',
    )
    expect(groupSummary(['Nova', 'Kai'], venueById('home'), undefined)).toBe('A night in with Nova and Kai, no gift.')
  })

  it('shows their history with the set note', () => {
    expect(relationTo('Nova', 'ex')).toBe("Nova's ex")
    const lines = historyLines('Nova', 'Kai', pairHistory('nova', 'kai', afterhoursRelations()))
    expect(lines[0].line).toBe('Nova and Kai are exes.')
    expect(lines[0].note).toContain('Dated for a year')
    expect(historyLines('Kai', 'Sol', { relations: [], known: false })).toEqual([{ line: "Kai and Sol haven't met." }])
  })

  it('says how each feels, and when meeting the other breaks an agreement', () => {
    const nova = rel('nova', { dates: 3, affection: 50, agreement: { type: 'exclusive', terms: '', madeAt: T0 - 100 } })
    const kai = rel('kai', { dates: 1, affection: 30, lastDateAt: T0 })
    const f = groupFeeling({ observer: card('nova'), rel: nova, otherId: 'kai', otherRel: kai, route: 'romantic', otherRoute: 'romantic', approval: 35 })
    expect(f.breaks).toBe(true)
    const line = feelingLine(f, firsts)
    expect(line.tone).toBe('breaks')
    expect(line.text).toBe(
      "Nova doesn't know you've been seeing Kai. Tonight Nova finds out. You and Nova agreed to be exclusive, and you've been out with Kai since. This breaks it. Nova will have an opinion about it. Nova doesn't much like Kai.",
    )
    const kaiDated = rel('kai', { dates: 1, affection: 10, lastDateAt: T0 })
    const easy = feelingLine(
      groupFeeling({
        observer: card('dex'),
        rel: rel('dex', { knownOthers: ['kai'], revealed: { attractions: false, style: true } }),
        otherId: 'kai',
        otherRel: kaiDated,
        route: 'romantic',
        otherRoute: 'romantic',
        approval: 60,
      }),
      { dex: 'Dex', kai: 'Kai' },
    )
    expect(easy).toEqual({ text: "Dex knows you've been out with Kai. Dex is happy for you. Dex likes Kai.", tone: 'easy' })
    const friend = feelingLine(
      groupFeeling({ observer: card('kai'), rel: rel('kai'), otherId: 'nova', route: 'friend', otherRoute: 'romantic', approval: 50 }),
      firsts,
    )
    expect(friend.text).toBe("Kai is your friend and doesn't mind who else you see. Kai is undecided about Nova.")
  })

  it("doesn't call two strangers people you're seeing, or show jealousy before the style is known", () => {
    const strangers = [
      groupFeeling({ observer: card('dex'), rel: rel('dex'), otherId: 'imani', otherRel: rel('imani'), route: 'romantic', otherRoute: 'romantic', approval: 50 }),
      groupFeeling({ observer: card('imani'), rel: rel('imani'), otherId: 'dex', otherRel: rel('dex'), route: 'romantic', otherRoute: 'romantic', approval: 50 }),
    ]
    const names = { dex: 'Dex', imani: 'Imani' }
    expect(strangers.map((f) => f.standing)).toEqual(['new', 'new'])
    expect(feelingLine(strangers[0], names).text).toBe("You haven't been out with Imani yet, so there's nothing for Dex to find out. Dex is undecided about Imani.")
    for (const f of strangers) expect(feelingLine(f, names).text).not.toMatch(/seeing|finds out|happy for you|mind/)
    // Out with Kai once at 9 affection: "been out with", not "seeing".
    const dated = groupFeeling({
      observer: card('nova'),
      rel: rel('nova', { dates: 2 }),
      otherId: 'kai',
      otherRel: rel('kai', { dates: 1, affection: 9, lastDateAt: T0 }),
      route: 'romantic',
      otherRoute: 'romantic',
      approval: 35,
    })
    expect(dated.standing).toBe('dated')
    expect(feelingLine(dated, firsts).text).toBe("Nova doesn't know you've been out with Kai. Tonight Nova finds out. Nova will have an opinion about it. Nova doesn't much like Kai.")
  })
})
