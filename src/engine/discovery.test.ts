import { describe, expect, it } from 'vitest'
import { bundledEntry } from '../data/bundled'
import { applyTopics, detectTopics, knownHits, recordGift, recordVenue, revealHits, topicsGained } from './discovery'
import { newRelationship } from './relationship'

const nova = bundledEntry('nova')!.character

describe('revealHits', () => {
  it('reveals hit traits with the judge hint as the caption', () => {
    const { rel, found } = revealHits(
      nova,
      newRelationship('nova'),
      { hits: [{ type: 'like', id: 'vinyl' }, { type: 'turnOff', id: 'cute' }], hint: '  Her eyes light up  ' },
      42,
    )
    expect(found).toEqual([
      { type: 'like', id: 'vinyl', hint: 'Her eyes light up', at: 42 },
      { type: 'turnOff', id: 'cute', hint: 'Her eyes light up', at: 42 },
    ])
    expect(rel.discovered).toEqual(found)
  })

  it('ignores unknown ids, wrong types and duplicates', () => {
    const start = revealHits(nova, newRelationship('nova'), { hits: [{ type: 'like', id: 'vinyl' }], hint: 'First' }, 1).rel
    const { rel, found } = revealHits(
      nova,
      start,
      {
        hits: [
          { type: 'like', id: 'vinyl' }, // already discovered
          { type: 'like', id: 'not-a-trait' },
          { type: 'dislike', id: 'vinyl' }, // right id, wrong list
          { type: 'turnOn', id: 'banter' },
          { type: 'turnOn', id: 'banter' },
        ],
        hint: 'Second',
      },
      2,
    )
    expect(found).toEqual([{ type: 'turnOn', id: 'banter', hint: 'Second', at: 2 }])
    expect(rel.discovered.map((d) => [d.id, d.hint])).toEqual([
      ['vinyl', 'First'],
      ['banter', 'Second'],
    ])
  })

  it('returns the same relationship when nothing new was found', () => {
    const rel = newRelationship('nova')
    expect(revealHits(nova, rel, { hits: [], hint: 'x' }, 1).rel).toBe(rel)
  })

  it('knownHits keeps only the card traits', () => {
    expect(
      knownHits(nova, [
        { type: 'like', id: 'rain' },
        { type: 'like', id: 'rain' },
        { type: 'turnOn', id: 'nope' },
      ]),
    ).toEqual([{ type: 'like', id: 'rain' }])
  })
})

describe('recordVenue and recordGift', () => {
  it('records how the character felt', () => {
    let rel = recordVenue(nova, newRelationship('nova'), 'fancy-restaurant')
    rel = recordVenue(nova, rel, 'record-store')
    rel = recordGift(nova, rel, 'flowers')
    rel = recordGift(nova, rel, 'plushie')
    rel = recordGift(nova, rel, undefined)
    expect(rel.venues).toEqual({ 'fancy-restaurant': 'hated', 'record-store': 'favorite' })
    expect(rel.gifts).toEqual({ flowers: 'hated', plushie: 'neutral' })
  })
})

describe('detectTopics', () => {
  const player = (m: string) => detectTopics(m, 'player')

  it.each([
    "So what's your type?",
    'Am I your type, honestly?',
    'Who are you usually into?',
    'What kind of people do you date?',
    'Are you attracted to women?',
    'Can I ask about your sexuality?',
    'Are you bi?',
    "You're queer, right?",
    'Do you date men at all?',
    'Are you into girls or guys?',
  ])('attractions come up: %s', (m) => {
    expect(player(m).attractions).toBe(true)
  })

  it.each([
    'Are you poly?',
    'How do you feel about monogamy?',
    'Is this an open relationship thing for you?',
    'Are you seeing anyone?',
    'Do you date around?',
    'Would you want to be exclusive at some point?',
    'Is it one person at a time for you?',
    'How do you date, really?',
  ])('style comes up: %s', (m) => {
    const t = player(m)
    expect(t.style).toBe(true)
    expect(t.playerStyle).toBe(false)
  })

  it.each([
    "I'm poly, just so you know.",
    'Honestly I am polyamorous.',
    "I don't really do monogamy.",
    "I'm seeing other people right now.",
    'I want something exclusive.',
    "Full disclosure: I'm in an open relationship.",
    'I only date one person at a time.',
    "I’m non-monogamous.", // curly apostrophe
  ])('the player says how they date: %s', (m) => {
    const t = player(m)
    expect(t.playerStyle).toBe(true)
    expect(t.style).toBe(true)
  })

  it.each([
    'This record is an exclusive pressing.',
    'I love this place, the vinyl here is unreal.',
    'Want to grab a drink?',
    'That amusement park was an attraction.',
    'Are you poly, or am I misreading this?',
    '',
  ])('nothing about how the player dates: %s', (m) => {
    expect(player(m).playerStyle).toBe(false)
  })

  it('stays quiet on small talk', () => {
    expect(player('That set last night was amazing. What was the second track?')).toEqual({
      attractions: false,
      style: false,
      playerStyle: false,
    })
    expect(player('This exclusive pressing is wild.').style).toBe(false)
  })

  it('reads character replies for their own attractions and style only', () => {
    expect(detectTopics("*She shrugs.* \"I'm bi, if you're wondering.\"", 'character')).toEqual({
      attractions: true,
      style: false,
      playerStyle: false,
    })
    expect(detectTopics('"I only date women, mostly."', 'character').attractions).toBe(true)
    expect(detectTopics('"I don\'t do monogamy. Never have."', 'character').style).toBe(true)
    expect(detectTopics('"So you\'re poly? Cool."', 'character').style).toBe(false)
    expect(detectTopics('"Your type? Bold question."', 'character').attractions).toBe(false)
  })
})

describe('applyTopics', () => {
  it('turns flags on, never off, and keeps the object when nothing changes', () => {
    const rel = newRelationship('nova')
    expect(applyTopics(rel, { attractions: false, style: false, playerStyle: false })).toBe(rel)
    const a = applyTopics(rel, { attractions: true, style: false, playerStyle: true })
    expect(a.revealed).toEqual({ attractions: true, style: false })
    expect(a.knowsPlayerStyle).toBe(true)
    const b = applyTopics(a, { attractions: false, style: true, playerStyle: false })
    expect(b.revealed).toEqual({ attractions: true, style: true })
    expect(b.knowsPlayerStyle).toBe(true)
    expect(topicsGained(rel, b)).toEqual({ attractions: true, style: true, playerStyle: true })
    expect(topicsGained(a, b)).toEqual({ attractions: false, style: true, playerStyle: false })
  })
})
