import { describe, expect, it } from 'vitest'
import type { Agreement, BetrayalEvent, Character } from '../types'
import {
  applyAgreementResult,
  applyBetrayal,
  betrayalDeltas,
  characterDtrWish,
  checkBetrayal,
  disclosureRequired,
  dtrAvailable,
  firstName,
  isJealous,
  jealousNow,
  knownOthersText,
  opinionText,
  othersSeen,
  recordBetrayal,
  seeing,
  standingLine,
  wantedAgreement,
} from './agreements'
import { afterhoursNames, card, rel, scripted } from './testKit'

const nova = card('nova')
const kai = card('kai')
const names = afterhoursNames()
const as = (c: Character, p: Partial<Character>): Character => ({ ...c, ...p })
const agreement = (type: Agreement['type'], terms = '', madeAt = 1000): Agreement => ({ type, terms, madeAt })

describe('seeing and othersSeen', () => {
  it('counts a romantic route with a date and affection 20+', () => {
    expect(seeing(rel('kai', { dates: 1, affection: 20 }), 'romantic')).toBe(true)
    expect(seeing(rel('kai', { dates: 1, affection: 19 }), 'romantic')).toBe(false)
    expect(seeing(rel('kai', { dates: 0, affection: 50 }), 'romantic')).toBe(false)
    expect(seeing(rel('kai', { dates: 3, affection: 50 }), 'friend')).toBe(false)
    expect(seeing(undefined, 'romantic')).toBe(false)
  })

  it('lists everyone else the player is seeing, sorted', () => {
    const rels = {
      nova: rel('nova', { dates: 2, affection: 40 }),
      kai: rel('kai', { dates: 1, affection: 25 }),
      sasha: rel('sasha', { dates: 4, affection: 50 }),
      dex: rel('dex', { dates: 1, affection: 5 }),
      imani: rel('imani', { dates: 2, affection: 30 }),
    }
    const routeOf = (id: string) => (id === 'sasha' ? 'friend' : 'romantic')
    expect(othersSeen(rels, routeOf, 'nova')).toEqual(['imani', 'kai'])
    expect(othersSeen(rels, routeOf, 'kai')).toEqual(['imani', 'nova'])
  })
})

describe('disclosureRequired', () => {
  it('is always on for poly and never for exclusive, casual or none', () => {
    expect(disclosureRequired(agreement('poly'))).toBe(true)
    expect(disclosureRequired(agreement('exclusive', 'Tell me everything.'))).toBe(false)
    expect(disclosureRequired(agreement('casual', 'Tell me if you want.'))).toBe(false)
    expect(disclosureRequired(agreement('none'))).toBe(false)
    expect(disclosureRequired(undefined)).toBe(false)
  })

  it('reads open terms for telling, knowing and disclosing, and their negations', () => {
    expect(disclosureRequired(agreement('open', 'Open, but tell me before anything happens.'))).toBe(true)
    expect(disclosureRequired(agreement('open', 'We keep it open and I want to know who.'))).toBe(true)
    expect(disclosureRequired(agreement('open', 'Open, full disclosure.'))).toBe(true)
    expect(disclosureRequired(agreement('open', 'Open with a heads-up first.'))).toBe(true)
    expect(disclosureRequired(agreement('open', 'Open. What you do elsewhere is your business.'))).toBe(false)
    expect(disclosureRequired(agreement('open', "Open. I don't need to know.")) ).toBe(false)
    expect(disclosureRequired(agreement('open', "Don't ask, don't tell."))).toBe(false)
    expect(disclosureRequired(agreement('open', "I don't need to know details, but tell me if it gets serious."))).toBe(true)
  })
})

describe('jealousy', () => {
  const knows = rel('nova', { knownOthers: ['kai'] })
  it('minds at medium and high, at low only with exclusive, never with compersion', () => {
    expect(isJealous(as(nova, { jealousy: 'medium' }), knows)).toBe(true)
    expect(isJealous(as(nova, { jealousy: 'high' }), knows)).toBe(true)
    expect(isJealous(nova, knows)).toBe(false)
    expect(isJealous(nova, { ...knows, agreement: agreement('exclusive') })).toBe(true)
    expect(isJealous(as(nova, { jealousy: 'compersion' }), { ...knows, agreement: agreement('exclusive') })).toBe(false)
    expect(isJealous(as(nova, { jealousy: 'high' }), rel('nova'))).toBe(false)
  })

  it('keeps the mark while a betrayal is raw (trust under 60)', () => {
    const e: BetrayalEvent = { at: 1, kind: 'lie', note: '', affectionDelta: -10, trustDelta: -15 }
    expect(jealousNow(nova, rel('nova', { betrayals: [e], trust: 59 }))).toBe(true)
    expect(jealousNow(nova, rel('nova', { betrayals: [e], trust: 60 }))).toBe(false)
  })
})

describe('define the relationship', () => {
  it('is available from Friend on either route', () => {
    expect(dtrAvailable(rel('nova', { affection: 40 }), 'romantic')).toBe(true)
    expect(dtrAvailable(rel('nova', { affection: 40 }), 'friend')).toBe(true)
    expect(dtrAvailable(rel('nova', { affection: 39 }), 'romantic')).toBe(false)
  })

  it('wants what their style wants', () => {
    expect(wantedAgreement(nova)).toBe('open')
    expect(wantedAgreement(kai)).toBe('exclusive')
    expect(wantedAgreement(card('rook'))).toBe('poly')
    expect(wantedAgreement(card('vesper'))).toBe('exclusive')
    expect(wantedAgreement(card('theo'))).toBe('casual')
  })

  it('asks at Friend+, trust 50+, 3+ dates and no agreement, on a 25% roll', () => {
    const ready = rel('kai', { affection: 40, trust: 50, dates: 3 })
    expect(characterDtrWish(kai, ready, () => 0.24)).toBe('exclusive')
    expect(characterDtrWish(kai, ready, () => 0.25)).toBeNull()
    let rolled = 0
    const spy = () => {
      rolled++
      return 0
    }
    for (const p of [{ affection: 39 }, { trust: 49 }, { dates: 2 }, { agreement: agreement('casual') }]) {
      expect(characterDtrWish(kai, { ...ready, ...p }, spy)).toBeNull()
    }
    expect(characterDtrWish(kai, ready, spy, 'friend')).toBeNull()
    expect(rolled).toBe(0)
  })

  it('applies an accepted result, keeps madeAt on the same type, and always the trust', () => {
    const r0 = rel('nova', { trust: 40 })
    const made = applyAgreementResult(r0, { agreement: 'exclusive', accepted: true, terms: ' Just us. ', trustDelta: 3 }, 5000)
    expect(made.agreement).toEqual({ type: 'exclusive', terms: 'Just us.', madeAt: 5000 })
    expect(made.trust).toBe(43)
    const again = applyAgreementResult(made, { agreement: 'exclusive', accepted: true, terms: 'Only us.', trustDelta: 0 }, 9000)
    expect(again.agreement).toEqual({ type: 'exclusive', terms: 'Only us.', madeAt: 5000 })
    const changed = applyAgreementResult(made, { agreement: 'open', accepted: true, terms: 'Open.', trustDelta: 0 }, 9000)
    expect(changed.agreement.madeAt).toBe(9000)
    const declined = applyAgreementResult(made, { agreement: 'poly', accepted: false, terms: '', trustDelta: -4 }, 9000)
    expect(declined.agreement).toEqual(made.agreement)
    expect(declined.trust).toBe(39)
  })

  it('slows the talk\'s trust gain with a grudge when given the character', () => {
    const e: BetrayalEvent = { at: 1, kind: 'lie', note: '', affectionDelta: -10, trustDelta: -15 }
    const r = applyAgreementResult(rel('kai', { trust: 30, betrayals: [e] }), { agreement: 'exclusive', accepted: true, terms: '', trustDelta: 4 }, 1, kai)
    expect(r.trust).toBe(32)
  })
})

describe('checkBetrayal', () => {
  const kaiDated = (lastDateAt: number) => rel('kai', { dates: 2, affection: 30, lastDateAt })
  const withAgreement = (type: Agreement['type'], terms = '') => rel('nova', { agreement: agreement(type, terms, 1000), affection: 60, trust: 50 })

  it('never with no agreement, casual, or open without disclosure terms', () => {
    for (const how of ['player', 'gossip', 'group'] as const) {
      expect(checkBetrayal(nova, withAgreement('none'), 'kai', how, kaiDated(5000), 6000, () => 0.5)).toBeNull()
      expect(checkBetrayal(nova, withAgreement('casual'), 'kai', how, kaiDated(5000), 6000, () => 0.5)).toBeNull()
      expect(checkBetrayal(nova, withAgreement('open', 'Your business.'), 'kai', how, kaiDated(5000), 6000, () => 0.5)).toBeNull()
    }
  })

  it('exclusive: any way they find out, for a date after the agreement', () => {
    const r = withAgreement('exclusive')
    for (const how of ['player', 'gossip', 'group'] as const) {
      const e = checkBetrayal(nova, r, 'kai', how, kaiDated(5000), 6000, () => 0.5, { names })
      expect(e).toMatchObject({ kind: 'agreement', about: 'kai', how, agreement: 'exclusive', at: 6000 })
    }
    // A date before the agreement isn't a breach.
    expect(checkBetrayal(nova, r, 'kai', 'gossip', kaiDated(900), 6000, () => 0.5)).toBeNull()
    // Never about themselves or someone the player never went out with.
    expect(checkBetrayal(nova, r, 'nova', 'gossip', kaiDated(5000), 6000, () => 0.5)).toBeNull()
    expect(checkBetrayal(nova, r, 'kai', 'gossip', undefined, 6000, () => 0.5)).toBeNull()
  })

  it('counts one date once: learning it again is not a second betrayal, a later date is', () => {
    const first = checkBetrayal(nova, withAgreement('exclusive'), 'kai', 'gossip', kaiDated(5000), 6000, () => 0.5)!
    const after = recordBetrayal(withAgreement('exclusive'), first)
    expect(checkBetrayal(nova, after, 'kai', 'player', kaiDated(5000), 7000, () => 0.5)).toBeNull()
    expect(checkBetrayal(nova, after, 'kai', 'player', kaiDated(8000), 9000, () => 0.5)).not.toBeNull()
  })

  it('poly and open with disclosure: only through gossip, and smaller', () => {
    for (const r of [withAgreement('poly'), withAgreement('open', 'Tell me first.')]) {
      expect(checkBetrayal(nova, r, 'kai', 'player', kaiDated(5000), 6000, () => 0.5)).toBeNull()
      expect(checkBetrayal(nova, r, 'kai', 'group', kaiDated(5000), 6000, () => 0.5)).toBeNull()
      const e = checkBetrayal(nova, r, 'kai', 'gossip', kaiDated(5000), 6000, () => 0.5)!
      const x = checkBetrayal(nova, withAgreement('exclusive'), 'kai', 'gossip', kaiDated(5000), 6000, () => 0.5)!
      expect(e.affectionDelta).toBeGreaterThan(x.affectionDelta)
      expect(e.trustDelta).toBeGreaterThan(x.trustDelta)
    }
  })

  it('a caught lie is a betrayal of its own, with or without an agreement', () => {
    const e = checkBetrayal(nova, rel('nova'), '', 'lie', undefined, 6000, () => 0.5)!
    expect(e).toMatchObject({ kind: 'lie', how: 'lie', note: 'Caught you in a lie.' })
    expect(e.about).toBeUndefined()
    expect(e.agreement).toBeUndefined()
  })

  it('stays in the spec ranges and scales with jealousy, trust always dropping more', () => {
    const r = withAgreement('exclusive')
    const at = (j: Character['jealousy'], rng: () => number) =>
      checkBetrayal(as(nova, { jealousy: j }), r, 'kai', 'gossip', kaiDated(5000), 6000, rng)!
    const order = (['compersion', 'low', 'medium', 'high'] as const).map((j) => at(j, () => 0.5))
    for (let i = 1; i < order.length; i++) expect(order[i].trustDelta).toBeLessThan(order[i - 1].trustDelta)
    for (const j of ['compersion', 'low', 'medium', 'high'] as const) {
      for (const v of [0, 0.5, 0.999]) {
        const e = at(j, () => v)
        expect(e.affectionDelta).toBeGreaterThanOrEqual(-20)
        expect(e.affectionDelta).toBeLessThanOrEqual(-10)
        expect(e.trustDelta).toBeGreaterThanOrEqual(-30)
        expect(e.trustDelta).toBeLessThanOrEqual(-15)
        expect(-e.trustDelta).toBeGreaterThan(-e.affectionDelta)
      }
    }
    expect(betrayalDeltas(0)).toEqual({ affectionDelta: -10, trustDelta: -15 })
    expect(betrayalDeltas(1)).toEqual({ affectionDelta: -20, trustDelta: -30 })
    expect(betrayalDeltas(7)).toEqual({ affectionDelta: -20, trustDelta: -30 })
  })

  it('writes the note and a memory line in their voice, by first name', () => {
    const e = checkBetrayal(card('sasha'), withAgreement('exclusive'), 'kai', 'gossip', kaiDated(5000), 6000, () => 0.5, { names })!
    expect(e.note).toBe('Heard about Kai through the grapevine after you agreed to be exclusive.')
    expect(e.memory).toBe('We agreed to be exclusive, and I had to hear about Kai from someone else. I keep replaying it, and it gets worse every time.')
    expect(firstName('Roxanne "Rox" Delacroix')).toBe('Rox')
  })
})

describe('applying a betrayal', () => {
  const e: BetrayalEvent = { at: 1, kind: 'agreement', about: 'kai', note: 'n', affectionDelta: -15, trustDelta: -22, memory: 'I heard.' }

  it('drops affection without resetting it, drops trust, records it in her voice and marks jealousy', () => {
    const r = applyBetrayal(rel('nova', { affection: 70, trust: 50, memory: ['A good night.'] }), e)
    expect(r).toMatchObject({ affection: 55, trust: 28, jealous: true, knownOthers: ['kai'], memory: ['A good night.', 'I heard.'] })
    expect(r.betrayals).toEqual([e])
    expect(applyBetrayal(rel('nova', { affection: 5, trust: 5 }), e)).toMatchObject({ affection: 0, trust: 0 })
  })

  it('records without moving the meters', () => {
    expect(recordBetrayal(rel('nova', { affection: 70, trust: 50 }), e)).toMatchObject({ affection: 70, trust: 50, jealous: true })
  })
})

describe('what the prompts and the map say', () => {
  const e: BetrayalEvent = {
    at: 5,
    kind: 'agreement',
    about: 'kai',
    how: 'gossip',
    agreement: 'exclusive',
    note: 'Heard about Kai through the grapevine after you agreed to be exclusive.',
    affectionDelta: -15,
    trustDelta: -22,
  }

  it('opinion: the default words, sharpened by a raw betrayal, softened once trust is back', () => {
    expect(opinionText(nova, rel('nova'), names)).toBe("we never agreed to anything, and hasn't heard about anyone else")
    expect(opinionText(nova, rel('nova', { knownOthers: ['kai'] }), names)).toBe("we never agreed to anything; knows about Kai Okoro and doesn't mind")
    const betrayed = rel('nova', { agreement: agreement('exclusive'), knownOthers: ['kai'], betrayals: [e], trust: 30 })
    expect(opinionText(nova, betrayed, names)).toBe('thinks we agreed to be exclusive and just heard about Kai Okoro; it breaks that agreement; still hurts')
    expect(opinionText(nova, { ...betrayed, trust: 70 }, names)).toBe(
      'thinks we agreed to be exclusive, and knows about Kai Okoro; there was a betrayal once, and trust has been rebuilt since',
    )
  })

  it('knownOthers marks who breaks the agreement', () => {
    expect(knownOthersText(nova, rel('nova'), names)).toBe('nobody, as far as Nova Castellanos knows')
    expect(knownOthersText(nova, rel('nova', { knownOthers: ['kai', 'imani'] }), names)).toBe('Kai Okoro and Imani Clarke')
    expect(knownOthersText(nova, rel('nova', { knownOthers: ['kai', 'imani'], betrayals: [e] }), names)).toBe(
      'Kai Okoro, which breaks the exclusive agreement Nova Castellanos made with the player; Imani Clarke',
    )
  })

  it('standing lines for the polycule map', () => {
    expect(standingLine(nova, rel('nova', { knownOthers: ['kai'] }), names)).toBe("Nova knows you're seeing Kai Okoro and doesn't mind.")
    expect(standingLine(kai, rel('kai', { knownOthers: ['nova'] }), names)).toBe("Kai knows you're seeing Nova Castellanos and minds.")
    expect(standingLine(nova, rel('nova', { agreement: agreement('exclusive') }), names)).toBe('Nova thinks you two agreed to be exclusive.')
    expect(standingLine(nova, rel('nova', { betrayals: [e], trust: 20 }), names)).toBe(
      'Nova heard about Kai through the grapevine after you agreed to be exclusive.',
    )
    expect(standingLine(nova, rel('nova'), names)).toBe("Nova doesn't know about anyone else.")
  })

  it('uses the seeded rng for variation only', () => {
    const r = rel('nova', { agreement: agreement('exclusive') })
    const k = rel('kai', { dates: 1, lastDateAt: 5000 })
    const a = checkBetrayal(nova, r, 'kai', 'gossip', k, 6000, scripted([0.1]))!
    const b = checkBetrayal(nova, r, 'kai', 'gossip', k, 6000, scripted([0.1]))!
    expect(a).toEqual(b)
  })
})
