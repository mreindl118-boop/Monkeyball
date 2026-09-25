import { describe, expect, it } from 'vitest'
import type { BetrayalEvent } from '../../types'
import {
  HIT_R,
  NODE_R,
  YOU,
  betrayalTension,
  buildThreads,
  initials,
  labelLayout,
  layoutMap,
  MAX_MAP_W,
  threadPath,
  TAG_H,
  listLine,
  listOrder,
  mapOrder,
  mapSummary,
  pairKey,
  personSentences,
  rings,
  shortName,
  tensionPath,
  threadLine,
  type MapRelation,
  type PersonFacts,
} from './mapModel'

function person(id: string, patch: Partial<PersonFacts> = {}): PersonFacts {
  return {
    id,
    name: `${id.charAt(0).toUpperCase()}${id.slice(1)} Surname`,
    accent: '#3FB8AF',
    setId: 'afterhours',
    jealousy: 'low',
    agreement: { type: 'none', terms: '' },
    seeing: false,
    jealous: false,
    knownOthers: [],
    betrayals: [],
    trust: 30,
    dates: 0,
    ...patch,
  }
}

const betrayal = (patch: Partial<BetrayalEvent> = {}): BetrayalEvent => ({
  at: 1,
  kind: 'agreement',
  about: 'kai',
  note: 'I trusted you.',
  affectionDelta: -15,
  trustDelta: -25,
  ...patch,
})

const names = { nova: 'Nova Castellanos', kai: 'Kai Okoro', sol: 'Sol Reyes', imani: 'Imani Brooks', dex: 'Dex Park' }

const relations: MapRelation[] = [
  { a: 'nova', b: 'kai', kind: 'ex' },
  { a: 'dex', b: 'imani', kind: 'partner' },
  { a: 'nova', b: 'imani', kind: 'friend' },
]

describe('names', () => {
  it('shortens to a first name or a quoted nickname, and makes initials', () => {
    expect(shortName('Nova Castellanos')).toBe('Nova')
    expect(shortName('Roxanne "Rox" Delacroix')).toBe('Rox')
    expect(shortName('  ', 'kai')).toBe('kai')
    expect(initials('Nova Castellanos')).toBe('NC')
    expect(initials('Kai')).toBe('K')
    expect(initials('')).toBe('?')
  })

  it('keys pairs the same way round', () => {
    expect(pairKey('nova', 'kai')).toBe(pairKey('kai', 'nova'))
  })
})

describe('threads', () => {
  it('draws partner and ex threads between characters, and friends not at all', () => {
    const people = ['nova', 'kai', 'dex', 'imani'].map((id) => person(id))
    const threads = buildThreads(people, relations)
    expect(threads.map((t) => t.kind).sort()).toEqual(['ex', 'partner'])
  })

  it('leaves out threads to people who are not on the map (a set switched off)', () => {
    const threads = buildThreads([person('nova')], relations)
    expect(threads).toEqual([])
  })

  it('labels agreement threads from the player, and draws a faint one while seeing without one', () => {
    const people = [
      person('nova', { agreement: { type: 'exclusive', terms: 'Just us.' }, seeing: true, dates: 3 }),
      person('kai', { seeing: true, dates: 1 }),
    ]
    const threads = buildThreads(people, [])
    expect(threads).toContainEqual({ key: 'a:nova', kind: 'agreement', from: YOU, to: 'nova', label: 'exclusive' })
    expect(threads).toContainEqual({ key: 's:kai', kind: 'seeing', from: YOU, to: 'kai' })
  })

  it('draws one lipstick thread per tense pair', () => {
    const people = [
      person('nova', { jealous: true, knownOthers: ['kai'], betrayals: [betrayal()] }),
      person('kai'),
    ]
    const tension = buildThreads(people, relations).filter((t) => t.kind === 'tension')
    expect(tension).toHaveLength(1)
    expect([tension[0].from, tension[0].to].sort()).toEqual(['kai', 'nova'])
  })

  it('sends a lie, or jealousy about nobody on the map, to the player', () => {
    const people = [
      person('nova', { betrayals: [betrayal({ kind: 'lie', about: undefined })] }),
      person('sol', { jealous: true, knownOthers: ['someone-off-map'] }),
    ]
    const tension = buildThreads(people, []).filter((t) => t.kind === 'tension')
    expect(tension.map((t) => pairKey(t.from, t.to)).sort()).toEqual([pairKey('nova', YOU), pairKey('sol', YOU)])
  })

  it('stops showing a betrayal as tension once trust is back', () => {
    const over = person('nova', { betrayals: [betrayal()], trust: 70 })
    expect(betrayalTension(over)).toBe(false)
    expect(buildThreads([over, person('kai')], []).some((t) => t.kind === 'tension')).toBe(false)
    expect(betrayalTension({ ...over, trust: 40 })).toBe(true)
  })

  it('lets a rekindle replace the pair’s ex thread', () => {
    const people = [person('nova', { rekindledWith: 'kai' }), person('kai', { rekindledWith: 'nova' })]
    const threads = buildThreads(people, relations)
    expect(threads.filter((t) => t.from !== YOU && t.kind !== 'tension').map((t) => t.kind)).toEqual(['rekindled'])
  })
})

describe('layout', () => {
  it('puts twelve people on one ring that fits a phone', () => {
    const plan = rings(12)
    expect(plan).toHaveLength(1)
    expect(plan[0].count).toBe(12)
    const layout = layoutMap(Array.from({ length: 12 }, (_, i) => `p${i}`))
    expect(layout.width).toBeLessThanOrEqual(412 - 16)
    expect(layout.people).toHaveLength(12)
    // Neighbours never overlap, hit areas included.
    const [a, b] = layout.people
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * NODE_R + 12)
    expect(HIT_R).toBeGreaterThan(NODE_R)
    // The first person sits at the top, straight above the player.
    expect(layout.people[0].x).toBeCloseTo(layout.you.x)
    expect(layout.people[0].y).toBeLessThan(layout.you.y)
  })

  it('spills a big roster onto more rings and keeps everyone inside the canvas', () => {
    const plan = rings(40)
    expect(plan.length).toBeGreaterThan(1)
    expect(plan.reduce((n, r) => n + r.count, 0)).toBe(40)
    const layout = layoutMap(Array.from({ length: 40 }, (_, i) => `p${i}`))
    for (const p of layout.people) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(0)
      expect(p.x + p.r).toBeLessThanOrEqual(layout.width)
      expect(p.y + p.r).toBeLessThanOrEqual(layout.height)
    }
    expect(new Set(layout.people.map((p) => p.id)).size).toBe(40)
  })

  it('keeps a big roster within a phone width, growing taller instead, with no circles on top of each other', () => {
    for (let n = 10; n <= 60; n++) {
      const layout = layoutMap(Array.from({ length: n }, (_, i) => `p${i}`))
      expect(layout.width).toBeLessThanOrEqual(MAX_MAP_W)
      // Drawn at 0.8 (48px targets) it fits a 360px phone with 16px gutters.
      expect(layout.width * 0.8).toBeLessThanOrEqual(360 - 32)
      const all = [layout.you, ...layout.people]
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y), `${n}: ${all[i].id} and ${all[j].id}`).toBeGreaterThanOrEqual(all[i].r + all[j].r + 4)
        }
      }
      for (const p of layout.people) {
        expect(p.x - p.r).toBeGreaterThanOrEqual(0)
        expect(p.x + p.r).toBeLessThanOrEqual(layout.width)
      }
    }
  })

  it('bends a thread between two others round the player', () => {
    const you = { id: YOU, x: 100, y: 100, r: 34 }
    const a = { id: 'a', x: 100, y: 0, r: 22 }
    const b = { id: 'b', x: 100, y: 200, r: 22 }
    const d = threadPath(a, b, [you, a, b])
    expect(d).toMatch(/ Q /)
    const [, qx] = /Q (-?[\d.]+) (-?[\d.]+)/.exec(d)!.map(Number)
    // The curve's middle is (chord middle + control) / 2: clear of the player's circle.
    expect(Math.abs((100 + qx) / 2 - 100)).toBeGreaterThanOrEqual(34)
    expect(threadPath(a, { id: 'c', x: 150, y: 0, r: 22 }, [you])).toMatch(/ L /)
  })

  it('handles nobody at all', () => {
    const layout = layoutMap([])
    expect(layout.people).toEqual([])
    expect(layout.width).toBeGreaterThan(0)
  })

  it('seats partners and exes next to each other, people you are involved with first', () => {
    const people = ['nova', 'dex', 'sol', 'kai', 'imani'].map((id) => person(id, id === 'sol' ? { seeing: true, dates: 2 } : {}))
    const order = mapOrder(people, relations)
    expect(order[0]).toBe('sol')
    expect(Math.abs(order.indexOf('nova') - order.indexOf('kai'))).toBe(1)
    expect(Math.abs(order.indexOf('dex') - order.indexOf('imani'))).toBe(1)
  })

  it('spreads the people you are involved with round the ring', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`)
    const involved = new Set(['p0', 'p1', 'p2'])
    const order = mapOrder(ids.map((id) => person(id, involved.has(id) ? { seeing: true, dates: 1 } : {})), [])
    const at = [...involved].map((id) => order.indexOf(id)).sort((a, b) => a - b)
    expect(at).toEqual([0, 4, 8])
  })

  it('trims threads to the circles and bends tension', () => {
    const a = { id: 'a', x: 0, y: 0, r: 10 }
    const b = { id: 'b', x: 100, y: 0, r: 20 }
    expect(threadLine(a, b)).toEqual({ x1: 10, y1: 0, x2: 80, y2: 0 })
    expect(tensionPath(a, b)).toMatch(/^M 10 0 Q 45 \d+(\.\d)? 80 0$/)
  })
})

describe('labels', () => {
  it('puts names above circles in the top half and below the rest', () => {
    const layout = layoutMap(Array.from({ length: 12 }, (_, i) => `p${i}`))
    const { names } = labelLayout(layout, [], (id) => id)
    const top = layout.people[0]
    const bottom = layout.people[6]
    expect(names.find((n) => n.id === top.id)!.y).toBeLessThan(top.y)
    expect(names.find((n) => n.id === bottom.id)!.y).toBeGreaterThan(bottom.y)
  })

  it('slides agreement tags on neighbouring threads apart', () => {
    const order = Array.from({ length: 12 }, (_, i) => `p${i}`)
    const layout = layoutMap(order)
    const threads = buildThreads(
      order.map((id, i) => person(id, i < 3 ? { agreement: { type: i === 1 ? 'exclusive' : 'open', terms: '' } } : {})),
      [],
    )
    const { tags } = labelLayout(layout, threads, (id) => id)
    expect(tags).toHaveLength(3)
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const a = tags[i]
        const b = tags[j]
        const apart = Math.abs(a.x - b.x) * 2 >= a.w + b.w || Math.abs(a.y - b.y) >= TAG_H
        expect(apart).toBe(true)
      }
    }
  })
})

describe('sentences', () => {
  const ctx = (people: PersonFacts[], extra: Partial<Parameters<typeof personSentences>[1]> = {}) => ({
    names,
    relations,
    othersYouSee: people.filter((p) => p.seeing).map((p) => p.id),
    people,
    ...extra,
  })

  it('reads like the spec: knows and doesn’t care, thinks you agreed to exclusive', () => {
    const nova = person('nova', { name: names.nova, knownOthers: ['kai'], seeing: true, dates: 2 })
    const sol = person('sol', { name: names.sol, agreement: { type: 'exclusive', terms: 'Only us.' }, seeing: true, dates: 4 })
    const kai = person('kai', { name: names.kai, seeing: true, dates: 1 })
    const people = [nova, sol, kai]
    expect(personSentences(nova, ctx(people))).toContain("Nova knows you're seeing Kai and doesn't care.")
    expect(personSentences(sol, ctx(people))).toContain('Sol thinks you two agreed to exclusive.')
    expect(personSentences(sol, ctx(people))).toContain("Sol doesn't know about anyone else you're seeing.")
  })

  it('says when they mind, or are happy for you', () => {
    const kai = person('kai', { name: names.kai })
    const nova = person('nova', { name: names.nova, knownOthers: ['kai'], jealous: true })
    const imani = person('imani', { name: names.imani, knownOthers: ['kai'], jealousy: 'compersion' })
    expect(personSentences(nova, ctx([nova, kai, imani]))).toContain("Nova knows you're seeing Kai and minds.")
    expect(personSentences(imani, ctx([nova, kai, imani]))).toContain("Imani knows you're seeing Kai and is happy for you.")
  })

  it('tells a betrayal, and whether they have let it go', () => {
    const kai = person('kai', { name: names.kai })
    const sol = person('sol', { name: names.sol, betrayals: [betrayal()], trust: 20 })
    const lines = personSentences(sol, ctx([sol, kai]))
    expect(lines).toContain('Sol found out about Kai, and it broke what you two agreed.')
    expect(lines).toContain("Sol hasn't let it go.")
    const lied = personSentences({ ...sol, betrayals: [betrayal({ kind: 'lie', about: undefined })], trust: 80 }, ctx([sol, kai]))
    expect(lied).toContain('Sol caught you in a lie.')
    expect(lied).toContain('Sol trusts you again, mostly.')
  })

  it('reads the engine’s note with their name in front', () => {
    const kai = person('kai', { name: names.kai })
    const note = 'Heard about Kai from you after you agreed to be exclusive.'
    const sol = person('sol', { name: names.sol, betrayals: [betrayal({ note })], trust: 20 })
    expect(personSentences(sol, ctx([sol, kai]))).toContain('Sol heard about Kai from you after you agreed to be exclusive.')
  })

  it('names their own partners and exes on the map', () => {
    const nova = person('nova', { name: names.nova })
    const kai = person('kai', { name: names.kai })
    expect(personSentences(nova, ctx([nova, kai]))).toContain('Nova and Kai used to date.')
  })

  it('says how metamours get on under poly', () => {
    const dex = person('dex', { name: names.dex, agreement: { type: 'poly', terms: '' }, seeing: true, dates: 5 })
    const imani = person('imani', { name: names.imani, agreement: { type: 'poly', terms: '' }, seeing: true, dates: 5 })
    const lines = personSentences(dex, ctx([dex, imani], { approval: () => 70 }))
    expect(lines).toContain('Dex gets along with Imani.')
    expect(personSentences(dex, ctx([dex, imani], { approval: () => 40 }))).toContain("Dex isn't sold on Imani yet.")
  })

  it('has a line for the list and a summary for screen readers', () => {
    expect(listLine(person('nova', { agreement: { type: 'open', terms: '' } }))).toBe('Agreed on open.')
    expect(listLine(person('nova', { seeing: true, dates: 2, jealous: true }))).toBe('Seeing each other, no agreement, minds who else you see.')
    expect(listLine(person('nova'))).toBe('Not met yet.')
    expect(mapSummary([person('a', { agreement: { type: 'poly', terms: '' } }), person('b', { jealous: true })])).toBe(
      '2 people around you, one agreement, tension with one person.',
    )
  })

  it('follows the copy rules: no arrows, no middle dots, no all caps', () => {
    const sol = person('sol', {
      name: names.sol,
      agreement: { type: 'exclusive', terms: '' },
      seeing: true,
      jealous: true,
      knownOthers: ['kai'],
      betrayals: [betrayal()],
    })
    const kai = person('kai', { name: names.kai, seeing: true })
    const all = [...personSentences(sol, ctx([sol, kai])), listLine(sol), mapSummary([sol, kai])]
    for (const s of all) {
      expect(s).not.toMatch(/[←→·]|->/)
      expect(s).not.toMatch(/\b[A-Z]{3,}\b/)
    }
  })
})

describe('map review fixes', () => {
  it('lists people you have been out with first', () => {
    const people = [person('nova', { dates: 3 }), person('dex'), person('cass', { dates: 1 }), person('kai', { dates: 2 })]
    expect(listOrder(people).map((p) => p.id)).toEqual(['nova', 'kai', 'cass', 'dex'])
  })
  it('keeps how they take it unsaid until their style is known, and says why a date has no thread', () => {
    const ctx = { names: { kai: 'Kai Okoro' }, relations: [], othersYouSee: ['kai'], people: [person('kai')], approval: () => 50 }
    const hidden = person('nova', { dates: 2, jealous: true, knownOthers: ['kai'], styleHidden: true })
    const s = personSentences(hidden, ctx)
    expect(s).toContain("Nova knows you're seeing Kai.")
    expect(s.join(' ')).not.toMatch(/minds|doesn't care|happy for you/)
    expect(listLine(hidden)).toBe('2 dates.')
    expect(s[0]).toMatch(/not enough yet to count as seeing each other/)
  })
})
