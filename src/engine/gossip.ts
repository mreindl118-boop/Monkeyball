// Gossip, rumors and what characters hear about each other (docs/SPEC.md, "Agreements":
// characters talk; "Discovery & Secrets": shared secrets and rumors; the friend route's gossip;
// ARCHITECTURE, Engine, gossip.ts). Pure: no React, no Dexie; every roll uses the injected rng.
//
// After a date, "the player went out with X" spreads one hop from X to the people X is connected to,
// with a chance by what they are to X (partner, situationship, housemate, roommate or bandmate
// 0.5; coworker, friend or family 0.35; ex 0.3; rival or neighbor 0.25; anyone else in X's set 0.1).
// Characters in different sets never talk unless a manifest's relationship links them. Only people
// who have met the player care: they add X to what they know. Under exclusive, checkBetrayal
// decides on the spot whether that breaks the agreement. Under poly (or open with telling terms)
// the player still gets to say it first: X goes on heardSecondhand, and settleSecondhand makes it
// a betrayal only if their next date ends without the player bringing X up.
//
// Friend-route characters share gossip on a date: another character's attractions or style, who is
// into the player (60+, one of those per date), who is with whom; what a friend already shared comes
// last next time. The lines ride in the story's {partners} (full names) and the recap shows them
// with first names; the facts they carry reveal on those characters' profiles.
//
// Rumors: when a teller's secret unlocks, each of their unheard rumors is passed on with a 50%
// chance. The judge sees the rumors the player has heard about the character on the date, with the
// truth and how to score relaying one wrong or using it as leverage (the date flow also makes a
// false or exaggerated relay cost trust).

import { noPeriod } from '../prompts/build'
import type {
  AgreementType,
  BetrayalEvent,
  Character,
  GameState,
  HeardRumor,
  NewsItem,
  Relationship,
  Route,
  Rumor,
  SetRelationKind,
  SetRelationship,
  Style,
  WorldBetrayal,
} from '../types'
import {
  applyBetrayal,
  checkBetrayal,
  datedSinceAgreement,
  disclosureRequired,
  firstName,
  isJealous,
  seenIn,
} from './agreements'
import { adjustApproval, GOSSIP_APPROVAL } from './metamour'
import { describeAttractions } from './stages'

// ---------------------------------------------------------------------------
// Who hears what

/** The chance someone hears about the player's date with X, by what they are to X. */
export const GOSSIP_CHANCE: Readonly<Record<SetRelationKind, number>> = {
  partner: 0.5,
  situationship: 0.5,
  housemate: 0.5,
  roommate: 0.5,
  bandmate: 0.5,
  coworker: 0.35,
  friend: 0.35,
  family: 0.35,
  ex: 0.3,
  rival: 0.25,
  neighbor: 0.25,
}

/** The chance for anyone else in X's set. */
export const SAME_SET_CHANCE = 0.1

/** Everyone connected to `id`, with the chance they hear about it: declared relations, then the set. */
export function listeners(
  id: string,
  relations: readonly SetRelationship[],
  setOf?: Readonly<Record<string, string>>,
  known?: Readonly<Record<string, unknown>>,
): { id: string; chance: number }[] {
  const out: { id: string; chance: number }[] = []
  for (const r of relations ?? []) {
    const other = r.a === id ? r.b : r.b === id ? r.a : null
    if (!other || other === id) continue
    const chance = GOSSIP_CHANCE[r.kind] ?? SAME_SET_CHANCE
    const have = out.find((o) => o.id === other)
    if (have) have.chance = Math.max(have.chance, chance)
    else out.push({ id: other, chance })
  }
  const set = setOf?.[id]
  if (set) {
    const ids = Object.keys(setOf ?? {})
      .filter((o) => o !== id && setOf?.[o] === set && !out.some((x) => x.id === o) && (!known || o in known))
      .sort()
    for (const o of ids) out.push({ id: o, chance: SAME_SET_CHANCE })
  }
  return out
}

function nameOf(id: string, names: Readonly<Record<string, string>> | undefined): string {
  return names?.[id]?.trim() || id
}

function short(id: string, names: Readonly<Record<string, string>> | undefined): string {
  return firstName(nameOf(id, names))
}

export interface AfterDateInput {
  /** The characters on the date that just ended. */
  datedIds: string[]
  /** Active characters by id. */
  characters: Record<string, Character>
  /** Every relationship, the finished date's included. */
  rels: Record<string, Relationship>
  /** Active sets' relationships, card partners included. */
  relations: SetRelationship[]
  routeOf: (id: string) => Route
  game: GameState
  now: number
  rng: () => number
  names: Record<string, string>
  /** Optional: set id per character, for the 0.1 same-set chance (left out: declared relations only). */
  setOf?: Record<string, string>
}

export interface WorldUpdate {
  rels: Record<string, Relationship>
  game: GameState
  /** News this produced (also appended to game.news). */
  news: NewsItem[]
  /** Betrayals other characters took, with their meters just before and after. */
  betrayals: WorldBetrayal[]
}

function newsItem(kind: NewsItem['kind'], id: string, at: number, text: string, characterIds: string[]): NewsItem {
  return { id: `${kind}-${at.toString(36)}-${id}`, at, kind, text, characterIds, read: false }
}

function meters(rel: Relationship): { affection: number; trust: number } {
  return { affection: rel.affection ?? 0, trust: rel.trust ?? 0 }
}

/**
 * After a date: word of it spreads (one hop, seeded), and people who hear it add the person to
 * what they know. Under exclusive a date after the agreement is a betrayal on the spot
 * (applyBetrayal: meters, memory line, jealousy). Under poly or open with telling terms, someone
 * they didn't know about goes on heardSecondhand (settleSecondhand decides after their next date).
 * Only romantic-route dates spread, and only to characters who have been on a date with the player.
 * Returns the whole relationship map, the game state with the news appended, the news and the
 * betrayals (with the meters around them).
 */
export function afterDateWorld(input: AfterDateInput): WorldUpdate {
  const { characters, relations, routeOf, now, rng, names } = input
  const rels: Record<string, Relationship> = { ...input.rels }
  const game = input.game
  const news: NewsItem[] = []
  const betrayals: WorldUpdate['betrayals'] = []
  const dated = [...new Set(input.datedIds)]

  for (const x of dated) {
    const xRel = rels[x]
    if (!characters[x] || !xRel || (xRel.dates ?? 0) < 1 || routeOf(x) !== 'romantic') continue
    for (const { id: o, chance } of listeners(x, relations, input.setOf, characters)) {
      const observer = characters[o]
      const oRel = rels[o]
      if (!observer || !oRel || dated.includes(o) || (oRel.dates ?? 0) < 1) continue
      if (!(rng() < chance)) continue
      const knew = (oRel.knownOthers ?? []).includes(x)
      let next: Relationship = knew ? oRel : { ...oRel, knownOthers: [...(oRel.knownOthers ?? []), x] }
      const type = oRel.agreement?.type ?? 'none'
      let event: BetrayalEvent | null = null
      if (type === 'exclusive') {
        event = checkBetrayal(observer, next, x, 'gossip', xRel, now, rng, { names })
      } else if (!knew && disclosureRequired(oRel.agreement) && datedSinceAgreement(oRel, xRel)) {
        next = { ...next, heardSecondhand: [...(next.heardSecondhand ?? []).filter((id) => id !== x), x] }
      }
      if (event) {
        const before = meters(next)
        next = applyBetrayal(next, event)
        betrayals.push({ characterId: o, event, before, after: meters(next) })
        news.push(
          newsItem(
            'betrayal',
            `${o}-${x}`,
            now,
            `${short(o, names)} heard you went out with ${short(x, names)}, after you and ${short(o, names)} agreed to be exclusive.`,
            [o, x],
          ),
        )
      } else if (!knew) {
        const waits = (next.heardSecondhand ?? []).includes(x)
        const text = waits
          ? `${short(o, names)} heard you've been out with ${short(x, names)}. Your ${type} agreement with ${short(o, names)} expects you to say so first.`
          : `${short(o, names)} heard you've been out with ${short(x, names)}.`
        news.push(newsItem('gossip', `${o}-${x}`, now, text, [o, x]))
      }
      const jealous = event ? true : isJealous(observer, next, { route: routeOf(o), seen: seenIn(rels, routeOf, game.dateCount, next) })
      if (jealous !== !!next.jealous) next = { ...next, jealous }
      if (next !== oRel) rels[o] = next
    }
  }
  return { rels, game: news.length ? { ...game, news: [...(game.news ?? []), ...news] } : game, news, betrayals }
}

export interface SecondhandInput {
  character: Character
  /** Their relationship at the end of their date. */
  rel: Relationship
  /** People the player talked about going out with on this date (dating context). */
  mentioned: readonly string[]
  rels: Readonly<Record<string, Relationship>>
  relations: SetRelationship[]
  game: GameState
  now: number
  rng: () => number
  names: Record<string, string>
}

/**
 * The end of a date with someone who heard about others through gossip under an agreement that
 * expects disclosure (heardSecondhand): each person the player brought up on the date is simply
 * known now; each one the player didn't is a betrayal (checkBetrayal, 'gossip': the note, the memory
 * line, the meters) and costs metamour approval under poly. heardSecondhand is cleared either way.
 */
export function settleSecondhand(input: SecondhandInput): { rel: Relationship; game: GameState; betrayals: BetrayalEvent[] } {
  const { character, now, rng, names } = input
  const pending = input.rel.heardSecondhand ?? []
  if (pending.length === 0) return { rel: input.rel, game: input.game, betrayals: [] }
  const { heardSecondhand: _pending, ...rest } = input.rel
  let rel: Relationship = rest
  let game = input.game
  const betrayals: BetrayalEvent[] = []
  const agreement: AgreementType = rel.agreement?.type ?? 'none'
  for (const x of pending) {
    if (input.mentioned.includes(x) || !disclosureRequired(rel.agreement)) continue
    const event = checkBetrayal(character, { ...rel, heardSecondhand: [x] }, x, 'gossip', input.rels[x], now, rng, { names })
    if (!event) continue
    rel = applyBetrayal(rel, event)
    betrayals.push(event)
    if (agreement === 'poly') game = adjustApproval(game, character.id, x, GOSSIP_APPROVAL, input.relations)
  }
  return { rel, game, betrayals }
}

// ---------------------------------------------------------------------------
// Friend-route gossip

/** Most gossip lines a friend shares on one date. */
export const MAX_GOSSIP_LINES = 3

/** Affection a friend-route character needs before they gossip (Acquaintance). */
export const GOSSIP_AFFECTION = 20

/** Who's into the player, for gossip. */
export const INTO_YOU_AFFECTION = 60

const STYLE_GOSSIP: Readonly<Record<Style, string>> = {
  monogamous: 'only does one person at a time, all in',
  open: 'keeps things open and likes it that way',
  polyamorous: 'is polyamorous and has room for more than one partner',
  flexible: 'is flexible about how relationships work; it depends on the person',
}

const PAIR_GOSSIP: Partial<Record<SetRelationKind, string>> = {
  partner: 'are together',
  situationship: 'have a situationship going',
  ex: 'used to date',
}

export interface GossipContext {
  characters: Record<string, Character>
  rels: Record<string, Relationship>
  relations: SetRelationship[]
  routeOf: (id: string) => Route
  names: Record<string, string>
  rng: () => number
  /** Optional: set id per character (same-set characters count as people they know). */
  setOf?: Record<string, string>
  /** Optional: lines this friend already shared on earlier dates (they come last). */
  shared?: readonly string[]
}

export interface GossipReveal {
  characterId: string
  attractions?: boolean
  style?: boolean
}

export interface GossipLines {
  /** The lines as the story prompt carries them (full names). */
  lines: string[]
  reveals: GossipReveal[]
  /** Optional: the same lines for the player (first names), in the same order. */
  shown?: string[]
  /** Optional: what each line gives away, in the same order (null for a line that reveals nothing). */
  revealOf?: (GossipReveal | null)[]
}

/** The reveals of the first `count` lines (the ones the story actually voiced), merged per person. */
export function revealsOfFirst(g: GossipLines, count: number): GossipReveal[] {
  if (!g.revealOf) return count >= g.lines.length ? g.reveals : []
  const out: GossipReveal[] = []
  for (const r of g.revealOf.slice(0, Math.max(0, count))) {
    if (!r) continue
    const have = out.find((x) => x.characterId === r.characterId)
    if (have) Object.assign(have, r.attractions ? { attractions: true } : {}, r.style ? { style: true } : {})
    else out.push({ ...r })
  }
  return out
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

/** Rank added to a line the friend already shared on an earlier date. */
const SHARED_RANK = 10

/**
 * What a friend shares on a date: up to three lines about people they know (declared relations,
 * and their set when `setOf` is given): who's into the player (one of those at most), someone's
 * attractions or style (facts the player hasn't found yet come first), and who is with whom. Lines
 * they shared before (`ctx.shared`) come last. The lines are appended to the story's {partners};
 * `shown` is the same lines with first names for the recap; `reveals` are the attractions and styles
 * they give away.
 */
export function friendGossipLines(c: Character, ctx: GossipContext): GossipLines {
  const { characters, rels, relations, routeOf, names, rng } = ctx
  const shared = new Set(ctx.shared ?? [])
  const known = listeners(c.id, relations, ctx.setOf, characters)
    .map((l) => l.id)
    .filter((id) => !!characters[id] && id !== c.id)
  type Fact = { line: string; shown: string; rank: number; into?: boolean; reveal?: GossipReveal }
  const pool: Fact[] = []
  for (const id of known) {
    const o = characters[id]
    const rel = rels[id]
    const name = nameOf(id, names)
    const first = short(id, names)
    if (rel && routeOf(id) === 'romantic' && (rel.affection ?? 0) >= INTO_YOU_AFFECTION) {
      pool.push({ line: `${name} is into you, properly`, shown: `${first} is into you, properly`, rank: 0, into: true })
    }
    const attractions = describeAttractions(o.attractedTo ?? [])
    if (attractions) {
      const label = String(o.orientation ?? '').trim()
      const what = `${label ? `${label}: ` : ''}into ${attractions}`
      pool.push({
        line: `${name} is ${what}`,
        shown: `${first} is ${what}`,
        rank: rel?.revealed?.attractions ? 3 : 1,
        reveal: { characterId: id, attractions: true },
      })
    }
    const style = STYLE_GOSSIP[o.relationshipStyle] ?? STYLE_GOSSIP.flexible
    pool.push({
      line: `${name} ${style}`,
      shown: `${first} ${style}`,
      rank: rel?.revealed?.style ? 3 : 1,
      reveal: { characterId: id, style: true },
    })
  }
  const seen = new Set<string>()
  for (const r of relations ?? []) {
    const phrase = PAIR_GOSSIP[r.kind]
    if (!phrase || r.a === c.id || r.b === c.id) continue
    if (!known.includes(r.a) && !known.includes(r.b)) continue
    if (!characters[r.a] || !characters[r.b]) continue
    const key = [r.a, r.b].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const note = noPeriod(String(r.note ?? ''))
    const tail = `${phrase}${note ? `: ${lowerFirst(note)}` : ''}`
    pool.push({
      line: `${nameOf(r.a, names)} and ${nameOf(r.b, names)} ${tail}`,
      shown: `${short(r.a, names)} and ${short(r.b, names)} ${tail}`,
      rank: 2,
    })
  }
  for (const f of pool) if (shared.has(f.line)) f.rank += SHARED_RANK
  // Shuffle with the seeded rng, then keep the most interesting kinds first.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const ordered = pool
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.rank - b.f.rank || a.i - b.i)
    .map((x) => x.f)
  const picked: Fact[] = []
  let into = false
  for (const f of ordered) {
    if (picked.length >= MAX_GOSSIP_LINES) break
    if (f.into && into) continue
    if (f.into) into = true
    picked.push(f)
  }
  const reveals: GossipReveal[] = []
  for (const f of picked) {
    if (!f.reveal) continue
    const have = reveals.find((r) => r.characterId === f.reveal!.characterId)
    if (have) Object.assign(have, f.reveal.attractions ? { attractions: true } : {}, f.reveal.style ? { style: true } : {})
    else reveals.push({ ...f.reveal })
  }
  return {
    lines: picked.map((f) => f.line),
    reveals,
    shown: picked.map((f) => f.shown),
    revealOf: picked.map((f) => (f.reveal ? { ...f.reveal } : null)),
  }
}

/** Apply gossip reveals to the relationships they concern (flags only turn on). */
export function applyGossipReveals(rels: Record<string, Relationship>, reveals: readonly GossipReveal[]): Record<string, Relationship> {
  let out = rels
  for (const r of reveals) {
    const rel = out[r.characterId]
    if (!rel) continue
    const revealed = rel.revealed ?? { attractions: false, style: false }
    const next = { attractions: revealed.attractions || !!r.attractions, style: revealed.style || !!r.style }
    if (next.attractions === revealed.attractions && next.style === revealed.style) continue
    out = { ...out, [r.characterId]: { ...rel, revealed: next } }
  }
  return out
}

// ---------------------------------------------------------------------------
// Rumors

/** The chance each unheard rumor is passed on when its teller's secret unlocks. */
export const RUMOR_CHANCE = 0.5

/**
 * A teller's secret just unlocked: each of their rumors the player hasn't heard is passed on with a
 * 50% chance (one roll each, in manifest order). Returns only the newly heard ones.
 */
export function rumorsOnSecretUnlock(
  tellerId: string,
  rumors: readonly Rumor[],
  heard: readonly HeardRumor[],
  rng: () => number,
  now: number,
): HeardRumor[] {
  const have = new Set((heard ?? []).map((h) => h.rumorId))
  const out: HeardRumor[] = []
  for (const r of rumors ?? []) {
    if (r.teller !== tellerId || have.has(r.id)) continue
    if (rng() < RUMOR_CHANCE) {
      out.push({ rumorId: r.id, heardFrom: tellerId, at: now, relayedTo: [] })
      have.add(r.id)
    }
  }
  return out
}

const TRUTH_WORDS: Readonly<Record<Rumor['truth'], string>> = {
  true: 'true',
  exaggerated: 'exaggerated',
  false: 'false',
}

/**
 * The judge's {sharedSecrets} for a character: the rumors the player has heard about them (who
 * told it, how true it is, what's actually true, and whether the player already told them), then
 * any secrets the player has earned that concern them. "none" when there's nothing.
 */
export function sharedSecretsText(
  subjectId: string,
  heard: readonly HeardRumor[],
  rumors: readonly Rumor[],
  earnedSecrets: readonly string[],
  names?: Readonly<Record<string, string>>,
): string {
  const byId = new Map((rumors ?? []).map((r) => [r.id, r]))
  const items: string[] = []
  for (const h of heard ?? []) {
    const r = byId.get(h.rumorId)
    if (!r || !r.about.includes(subjectId) || r.teller === subjectId) continue
    const truth = TRUTH_WORDS[r.truth] ?? r.truth
    const actually = r.actually ? `; what's actually true: ${noPeriod(r.actually)}` : ''
    const told = (h.relayedTo ?? []).includes(subjectId) ? '; the player has already brought it up with them' : ''
    items.push(`the player heard from ${nameOf(h.heardFrom || r.teller, names)} that "${noPeriod(r.text)}" (${truth}${actually}${told})`)
  }
  for (const s of earnedSecrets ?? []) {
    const t = noPeriod(String(s ?? ''))
    if (t) items.push(`the player knows this secret: ${t}`)
  }
  if (items.length === 0) return 'none'
  return `${items.join('; ')}. ${SECRETS_SCORING}`
}

/**
 * How the judge scores a relayed rumor or leverage, carried inside the {sharedSecrets} value (the
 * judge template stays verbatim).
 */
export const SECRETS_SCORING =
  'Scoring: repeating the false or exaggerated part of a rumor as fact costs trust (trustDelta -3 to -6); using any rumor or secret as leverage costs more (delta -8 to -12, trustDelta -8 to -10)'

/** Rumor ids by truth: the ones the player can relay wrong (false or exaggerated). */
export function misleading(rumor: Pick<Rumor, 'truth'> | undefined): boolean {
  return rumor?.truth === 'false' || rumor?.truth === 'exaggerated'
}

const STOPWORDS = new Set(
  'about after again also been before being both could didn\'t does doesn\'t even every from have having into just know like made make more most much never only other over really said same should since some still such than that their them then there these they this those through very want were what when where which while will with would your you\'re yours'.split(
    ' ',
  ),
)

function contentWords(text: string): Set<string> {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .match(/[a-z][a-z']+/g)
  const out = new Set<string>()
  for (const w of words ?? []) {
    if (w.length < 4 || STOPWORDS.has(w)) continue
    out.add(w.replace(/'s$/, '').replace(/s$/, ''))
  }
  return out
}

/**
 * Heuristic: the player's message passes the rumor on. Three content words in common with the
 * rumor, or two and the name of someone else it's about.
 */
export function relaysRumor(message: string, rumor: Rumor, subjectId: string, names?: Readonly<Record<string, string>>): boolean {
  const said = contentWords(message)
  if (said.size === 0) return false
  const told = contentWords(rumor.text)
  let common = 0
  for (const w of said) if (told.has(w)) common++
  if (common >= 3) return true
  if (common < 2) return false
  const text = ` ${String(message ?? '').toLowerCase()} `
  return rumor.about.some((id) => {
    if (id === subjectId) return false
    const first = firstName(nameOf(id, names)).toLowerCase()
    return !!first && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)
  })
}
