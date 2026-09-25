// Content checks for the Afterhours set: the ROSTER identity columns, set-wide invariants
// (ids, traits, venues, gifts, partners, manifest relationships and rumors) and that every card
// assembles into clean story and judge prompts. The general editor validator lives in src/mods.

import { describe, expect, it } from 'vitest'
import { buildJudgePrompt, buildStoryPrompt } from '../../../prompts/build'
import type { Character, Gender, HeatLevel, Relationship, SetManifest } from '../../../types'
import manifestJson from './manifest.json'

const manifest = manifestJson as unknown as SetManifest
const files = import.meta.glob<Character>('./characters/*.json', { eager: true, import: 'default' })
const cards: Record<string, Character> = {}
for (const [path, card] of Object.entries(files)) cards[path.replace(/^.*\/(.+)\.json$/, '$1')] = card

const VENUES = [
  'record-store', 'rooftop-bar', 'karaoke-box', 'arcade', 'boardwalk', 'art-museum', 'night-market',
  'climbing-gym', 'fancy-restaurant', 'bookstore-cafe', 'amusement-park', 'hot-spring', 'queer-bar', 'home',
]
const GIFTS = [
  'flowers', 'chocolates', 'rare-vinyl', 'hot-sauce', 'video-game', 'perfume', 'poetry-book', 'plushie',
  'red-wine', 'concert-tickets', 'sketchbook', 'silver-necklace', 'houseplant', 'lingerie',
]

type RosterRow = {
  name: string
  age: number
  gender: Gender
  pronouns: string
  identity?: string
  orientation: string
  attractedTo: Gender[]
  style: Character['relationshipStyle']
  jealousy: Character['jealousy']
}
const ALL: Gender[] = ['woman', 'man', 'nonbinary']
/** docs/ROSTER.md, Afterhours table. Cards must match these columns exactly. */
const ROSTER: Record<string, RosterRow> = {
  nova: { name: 'Nova Castellanos', age: 28, gender: 'woman', pronouns: 'she/her', orientation: 'bi', attractedTo: ALL, style: 'open', jealousy: 'low' },
  kai: { name: 'Kai Okoro', age: 30, gender: 'nonbinary', pronouns: 'they/them', identity: 'Nonbinary', orientation: 'pan', attractedTo: ALL, style: 'monogamous', jealousy: 'medium' },
  vesper: { name: 'Vesper Laine', age: 34, gender: 'woman', pronouns: 'she/her', identity: 'Trans woman', orientation: 'lesbian', attractedTo: ['woman', 'nonbinary'], style: 'flexible', jealousy: 'high' },
  theo: { name: 'Theo Marchetti', age: 29, gender: 'man', pronouns: 'he/him', identity: 'Trans man', orientation: 'gay', attractedTo: ['man', 'nonbinary'], style: 'flexible', jealousy: 'low' },
  dex: { name: 'Dex Adeyemi', age: 35, gender: 'man', pronouns: 'he/him', orientation: 'bi', attractedTo: ['woman', 'man'], style: 'open', jealousy: 'compersion' },
  imani: { name: 'Imani Clarke', age: 33, gender: 'woman', pronouns: 'she/her', orientation: 'pan', attractedTo: ALL, style: 'open', jealousy: 'low' },
  rook: { name: 'Rook Halvorsen', age: 27, gender: 'nonbinary', pronouns: 'they/them', identity: 'Nonbinary', orientation: 'lesbian', attractedTo: ['woman', 'nonbinary'], style: 'polyamorous', jealousy: 'medium' },
  sasha: { name: 'Sasha Volkova', age: 31, gender: 'woman', pronouns: 'she/her', orientation: 'lesbian', attractedTo: ['woman'], style: 'monogamous', jealousy: 'high' },
  jules: { name: 'Jules Ferreira', age: 32, gender: 'man', pronouns: 'he/him', orientation: 'gay', attractedTo: ['man'], style: 'monogamous', jealousy: 'medium' },
  marlowe: { name: 'Marlowe Achebe', age: 38, gender: 'man', pronouns: 'he/him', orientation: 'pan', attractedTo: ALL, style: 'polyamorous', jealousy: 'medium' },
  priya: { name: 'Priya Raman', age: 30, gender: 'woman', pronouns: 'she/her', orientation: 'bi', attractedTo: ['woman', 'man'], style: 'monogamous', jealousy: 'medium' },
  cass: { name: 'Cass Duarte', age: 29, gender: 'man', pronouns: 'he/him', orientation: 'gay', attractedTo: ['man', 'nonbinary'], style: 'flexible', jealousy: 'high' },
}
const PARTNERS: [string, string, 'ex' | 'partner' | 'situationship'][] = [
  ['nova', 'kai', 'ex'],
  ['theo', 'jules', 'ex'],
  ['dex', 'imani', 'partner'],
  ['rook', 'vesper', 'situationship'],
]
const OTHER_RELATIONS: [string, string][] = [
  ['kai', 'jules'], ['nova', 'imani'], ['sasha', 'priya'], ['marlowe', 'vesper'],
  ['cass', 'theo'], ['dex', 'kai'], ['rook', 'nova'],
]

/** Minor/childlike terms, as in docs/ARCHITECTURE.md (mods/safety.ts), plus a few extra guards. */
const UNSAFE =
  /\b(child|children|childlike|kids?|minors?|teen|teens|teenage|teenager|preteen|underage|loli|shota|school ?(girl|boy)|high school|middle school|junior high|elementary school|barely legal|jailbait|little (girl|boy)|petite|young|youthful|girls?|boys?)\b/i
/** Identity is on the card from the start: never a secret, a rumor or a twist. */
const IDENTITY_WORDS = /\b(trans|transition\w*|nonbinary|non-binary|deadnam\w*|pronouns?)\b/i

const norm = (g: string) => (g === 'women' ? 'woman' : g === 'men' ? 'man' : g)
const pair = (a: string, b: string) => [a, b].sort().join('|')

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) strings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out)
  return out
}

const rel = (characterId: string, p: Partial<Relationship> = {}): Relationship => ({
  characterId,
  affection: 0,
  trust: 0,
  discovered: [],
  venues: {},
  gifts: {},
  revealed: { attractions: false, style: false },
  knowsPlayerStyle: false,
  secretsUnlocked: [],
  agreement: { type: 'none', terms: '', madeAt: 0 },
  knownOthers: [],
  memory: [],
  tiersUnlocked: [],
  betrayals: [],
  dates: 0,
  lastDateAt: 0,
  connection: 0,
  heatPushes: 0,
  jealous: false,
  ...p,
})

const ids = Object.keys(ROSTER)

describe('Afterhours cards', () => {
  it('ships exactly the twelve roster characters, one file each', () => {
    expect(Object.keys(cards).sort()).toEqual([...ids].sort())
    for (const [file, c] of Object.entries(cards)) expect(c.id).toBe(file)
  })

  it.each(ids)('%s keeps the ROSTER identity columns', (id) => {
    const c = cards[id]
    const r = ROSTER[id]
    expect(c.name).toBe(r.name)
    expect(c.age).toBe(r.age)
    expect(c.gender).toBe(r.gender)
    expect(c.pronouns).toBe(r.pronouns)
    expect(c.identity).toBe(r.identity)
    expect(c.orientation).toBe(r.orientation)
    expect(c.attractedTo.map(norm)).toEqual(r.attractedTo)
    expect(c.relationshipStyle).toBe(r.style)
    expect(c.jealousy).toBe(r.jealousy)
    if (id === 'priya') expect(c.aceSpectrum).toEqual({ label: 'Demisexual', heatUnlockTrust: 60 })
    else expect(c.aceSpectrum).toBeUndefined()
  })

  it.each(ids)('%s is a complete card to the Nova standard', (id) => {
    const c = cards[id]
    expect(Number.isInteger(c.age) && c.age >= 21).toBe(true)
    for (const k of ['occupation', 'look', 'artTags', 'personality', 'voice', 'backstory', 'opener', 'bodyNotes'] as const) {
      expect(c[k], k).toBeTruthy()
    }
    const lead = { woman: 'adult woman', man: 'adult man', nonbinary: 'adult nonbinary person' }[c.gender]
    expect(c.artTags.startsWith(`${lead}, ${c.age} years old, `)).toBe(true)
    expect(c.accent).toMatch(/^#[0-9A-F]{6}$/i)
    expect(['easy', 'normal', 'hard']).toContain(c.difficulty)

    expect([c.likes.length, c.dislikes.length, c.turnOns.length, c.turnOffs.length]).toEqual([5, 4, 4, 4])
    const traitIds = [...c.likes, ...c.dislikes, ...c.turnOns, ...c.turnOffs].map((t) => t.id)
    expect(new Set(traitIds).size).toBe(traitIds.length)
    for (const t of traitIds) expect(t).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)

    for (const v of [...c.favoriteVenues, ...c.hatedVenues]) expect(VENUES).toContain(v)
    for (const g of [...c.lovedGifts, ...c.hatedGifts]) expect(GIFTS).toContain(g)
    expect(c.favoriteVenues.length).toBeGreaterThanOrEqual(2)
    expect(c.favoriteVenues.length).toBeLessThanOrEqual(3)
    expect(c.hatedVenues.length).toBeGreaterThanOrEqual(1)
    expect(c.hatedVenues.length).toBeLessThanOrEqual(2)
    expect(c.lovedGifts.length).toBeGreaterThanOrEqual(1)
    expect(c.lovedGifts.length).toBeLessThanOrEqual(2)
    expect(c.hatedGifts).toHaveLength(1)
    expect(c.favoriteVenues.filter((v) => c.hatedVenues.includes(v))).toEqual([])

    expect(c.secrets.map((s) => s.unlockAt)).toEqual([60, 80])
    expect(c.gallery.map((g) => [g.tier, g.unlockAt])).toEqual([[1, 20], [2, 40], [3, 60], [4, 80], [5, 100]])
    for (const g of c.gallery) {
      expect(g.title.charAt(0)).toBe(g.title.charAt(0).toUpperCase())
      expect(g.scene.length).toBeGreaterThan(20)
    }
  })

  it.each(ids)('%s passes the safety floor', (id) => {
    const c = cards[id]
    for (const s of strings(c)) expect(s).not.toMatch(UNSAFE)
    for (const s of [c.look, c.artTags, c.bodyNotes ?? '', ...c.gallery.map((g) => g.scene)]) {
      for (const m of s.matchAll(/\b(\d+)\b/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(21)
    }
    for (const s of c.secrets) expect(s.text).not.toMatch(IDENTITY_WORDS)
  })

  it('partners are reciprocal, in the set and exactly the ROSTER pairs', () => {
    const found: string[] = []
    for (const c of Object.values(cards)) {
      for (const p of c.partners ?? []) {
        const other = cards[p.characterId]
        expect(other, `${c.id} -> ${p.characterId}`).toBeDefined()
        expect(other.partners?.some((q) => q.characterId === c.id && q.relation === p.relation)).toBe(true)
        found.push(`${pair(c.id, p.characterId)}:${p.relation}`)
      }
    }
    const expected = PARTNERS.flatMap(([a, b, r]) => [`${pair(a, b)}:${r}`, `${pair(a, b)}:${r}`])
    expect(found.sort()).toEqual(expected.sort())
  })

  it('every venue but home is somebody\'s favorite, and venues and gifts are spread', () => {
    const all = Object.values(cards)
    for (const v of VENUES.filter((x) => x !== 'home')) {
      expect(all.some((c) => c.favoriteVenues.includes(v)), v).toBe(true)
    }
    const hatedVenues = new Set(all.flatMap((c) => c.hatedVenues))
    expect(hatedVenues.size).toBeGreaterThanOrEqual(9)
    for (const g of GIFTS) expect(all.some((c) => c.lovedGifts.includes(g)), g).toBe(true)
    expect(new Set(all.flatMap((c) => c.hatedGifts)).size).toBeGreaterThanOrEqual(10)
  })

  it('mixes difficulties and gives everyone a distinct accent', () => {
    const all = Object.values(cards)
    const count = (d: string) => all.filter((c) => c.difficulty === d).length
    expect([count('easy'), count('normal'), count('hard')]).toEqual([3, 6, 3])
    const accents = all.map((c) => c.accent.toUpperCase())
    expect(new Set(accents).size).toBe(accents.length)
  })

  it('keeps the cards distinct: no shared trait ids, gallery titles or openers', () => {
    const all = Object.values(cards)
    const traitIds = all.flatMap((c) => [...c.likes, ...c.dislikes, ...c.turnOns, ...c.turnOffs].map((t) => t.id))
    expect(traitIds.filter((t, i) => traitIds.indexOf(t) !== i)).toEqual([])
    const titles = all.flatMap((c) => c.gallery.map((g) => g.title.toLowerCase()))
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([])
    const openers = all.map((c) => c.opener)
    expect(new Set(openers).size).toBe(openers.length)
  })
})

describe('Afterhours manifest', () => {
  it('describes the set', () => {
    expect(manifest).toMatchObject({ id: 'afterhours', name: 'Afterhours', author: 'crushLAB', heat: 2, version: '1.0.0' })
    expect(manifest.blurb).toBeTruthy()
    for (const place of ['The Low Tide', 'The Velvet Hour', 'Halcyon', 'Echo Box', 'Pixel Palace', 'Ink & Anchor', 'night market', 'Dog-Ear']) {
      expect(manifest.setting).toContain(place)
    }
    expect([...manifest.characters].sort()).toEqual([...ids].sort())
  })

  it('declares every partner pair and the ROSTER friendships and rivalries', () => {
    const byPair = new Map(manifest.relationships.map((r) => [pair(r.a, r.b), r]))
    expect(byPair.size).toBe(manifest.relationships.length)
    for (const r of manifest.relationships) {
      expect(cards[r.a] && cards[r.b] && r.a !== r.b).toBeTruthy()
      expect(r.note).toBeTruthy()
    }
    for (const [a, b, kind] of PARTNERS) expect(byPair.get(pair(a, b))?.kind).toBe(kind)
    for (const [a, b] of OTHER_RELATIONS) expect(byPair.has(pair(a, b)), `${a}-${b}`).toBe(true)
    expect(byPair.get(pair('dex', 'kai'))?.kind).toBe('rival')
    expect(byPair.get(pair('sasha', 'priya'))?.kind).toBe('roommate')
  })

  it('has 10 to 14 well-formed rumors, including false ones and the Kai and Nova breakup', () => {
    const rumors = manifest.rumors ?? []
    expect(rumors.length).toBeGreaterThanOrEqual(10)
    expect(rumors.length).toBeLessThanOrEqual(14)
    expect(new Set(rumors.map((r) => r.id)).size).toBe(rumors.length)
    for (const r of rumors) {
      expect(cards[r.teller], r.id).toBeDefined()
      expect(r.about.length).toBeGreaterThanOrEqual(1)
      expect(r.about.length).toBeLessThanOrEqual(2)
      for (const a of r.about) expect(cards[a] && a !== r.teller, `${r.id} about ${a}`).toBeTruthy()
      expect(['true', 'exaggerated', 'false']).toContain(r.truth)
      expect(r.text && r.actually).toBeTruthy()
      expect(`${r.text} ${r.actually}`).not.toMatch(IDENTITY_WORDS)
    }
    expect(rumors.some((r) => r.truth === 'false')).toBe(true)
    expect(rumors.some((r) => r.about.includes('kai') && r.about.includes('nova'))).toBe(true)
    expect(rumors.some((r) => r.about.includes('dex') && r.about.includes('imani'))).toBe(true)
    for (const s of strings(manifest)) expect(s).not.toMatch(UNSAFE)
  })
})

describe('Afterhours cards in the prompts', () => {
  const names = Object.fromEntries(Object.values(cards).map((c) => [c.id, c.name]))
  const LEFTOVER = /\{[A-Za-z][^{}\n]*\}/
  const profile = { name: 'Robin Vale', gender: 'nonbinary', pronouns: 'they/them', bodyNotes: '', relationshipStyle: 'open' } as const

  it.each(ids)('%s assembles clean story and judge prompts', (id) => {
    const c = cards[id]
    for (const [heat, turn] of [[2, 0], [5, 3]] as [HeatLevel, number][]) {
      const p = buildStoryPrompt({
        character: c,
        rel: rel(id, { affection: 65, trust: 40, secretsUnlocked: [0] }),
        profile: { ...profile },
        heat,
        route: 'romantic',
        venue: { name: 'Rooftop bar', feeling: 'fine' },
        turn,
        maxTurns: 10,
        firstDate: turn === 0,
        judge: turn === 0 ? undefined : { delta: 3, trustDelta: 1, hits: [{ type: 'like', id: c.likes[0].id }], mood: 'warm', hint: 'A smile.', jealousy: false, breach: false },
        names,
      })
      expect(p).not.toMatch(LEFTOVER)
      expect(p).toContain(c.name)
      expect(p).toContain(c.pronouns)
      if (turn === 0) expect(p).toContain(c.opener)
    }
    const j = buildJudgePrompt({ character: c, rel: rel(id), route: 'romantic', names, others: [], recent: [], message: 'Hi.' })
    expect(j).not.toMatch(LEFTOVER)
    for (const t of [...c.likes, ...c.dislikes, ...c.turnOns, ...c.turnOffs]) expect(j).toContain(`${t.id}: `)
  })

  it("keeps Priya's demisexual pace in the prompt until trust passes 60", () => {
    const priya = cards.priya
    const base = {
      character: priya,
      profile: { ...profile },
      heat: 4 as HeatLevel,
      route: 'romantic' as const,
      venue: { name: 'Bookstore cafe', feeling: 'loves' as const },
      turn: 0,
      maxTurns: 10,
      firstDate: false,
      names,
    }
    const low = buildStoryPrompt({ ...base, rel: rel('priya', { trust: 40 }) })
    const high = buildStoryPrompt({ ...base, rel: rel('priya', { trust: 75 }) })
    expect(low).toContain('Demisexual')
    expect(low).not.toBe(high)
  })
})
