// Gossip, rumors and what characters hear about each other (docs/SPEC.md, "Agreements":
// characters talk; "Discovery & Secrets": shared secrets and rumors; the friend route's gossip;
// ARCHITECTURE, Engine, gossip.ts). Pure: no React, no Dexie; every roll uses the injected rng.
//
// After a date, "the player went out with X" spreads one hop from X to the people X is connected to,
// with a chance by what they are to X (partner, situationship, housemate, roommate or bandmate
// 0.5; coworker, friend or family 0.35; ex 0.3; rival or neighbor 0.25; anyone else in X's set 0.1).
// Characters in different sets never talk unless a manifest's relationship links them. Only people
// who have met the player care: they add X to what they know, and checkBetrayal decides whether
// that breaks an agreement.
//
// Friend-route characters share gossip on a date: another character's attractions or style, who is
// into the player (60+), who is with whom. The lines ride in the story's {partners}; the facts they
// carry reveal on those characters' profiles.
//
// Rumors: when a teller's secret unlocks, each of their unheard rumors is passed on with a 50%
// chance. The judge sees the rumors the player has heard about the character on the date, with the
// truth, so relaying one wrong (or using it as leverage) can be scored.

import { noPeriod } from '../prompts/build'
import type {
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
} from '../types'
import { applyBetrayal, checkBetrayal, disclosureRequired, firstName, jealousNow } from './agreements'
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
  betrayals: { characterId: string; event: BetrayalEvent }[]
}

function newsItem(kind: NewsItem['kind'], id: string, at: number, text: string, characterIds: string[]): NewsItem {
  return { id: `${kind}-${at.toString(36)}-${id}`, at, kind, text, characterIds, read: false }
}

/**
 * After a date: word of it spreads (one hop, seeded), people who hear it add the person to what
 * they know, and a broken agreement becomes a betrayal (applyBetrayal: meters, memory line,
 * jealousy). Under a poly agreement, hearing it through gossip also costs metamour approval. Only
 * romantic-route dates spread, and only to characters who have been on a date with the player.
 * Returns the whole relationship map, the game state with the news appended, the news and the
 * betrayals.
 */
export function afterDateWorld(input: AfterDateInput): WorldUpdate {
  const { characters, relations, routeOf, now, rng, names } = input
  const rels: Record<string, Relationship> = { ...input.rels }
  let game = input.game
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
      const event = checkBetrayal(observer, next, x, 'gossip', xRel, now, rng, { names })
      if (event) {
        next = applyBetrayal(next, event)
        betrayals.push({ characterId: o, event })
        const why =
          event.agreement === 'exclusive'
            ? 'and you two had agreed to be exclusive'
            : `and your ${event.agreement ?? 'poly'} agreement expects you to say so`
        news.push(newsItem('betrayal', `${o}-${x}`, now, `${short(o, names)} heard about ${short(x, names)} through the grapevine, ${why}.`, [o, x]))
      } else if (!knew) {
        news.push(newsItem('gossip', `${o}-${x}`, now, `${short(o, names)} heard you've been out with ${short(x, names)}.`, [o, x]))
      }
      if ((!knew || event) && (next.agreement?.type === 'poly' || (event && disclosureRequired(next.agreement)))) {
        game = adjustApproval(game, o, x, GOSSIP_APPROVAL, relations)
      }
      const jealous = event ? true : jealousNow(observer, next)
      if (jealous !== next.jealous) next = { ...next, jealous }
      if (next !== oRel) rels[o] = next
    }
  }
  if (news.length) game = { ...game, news: [...(game.news ?? []), ...news] }
  return { rels, game, news, betrayals }
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
}

export interface GossipReveal {
  characterId: string
  attractions?: boolean
  style?: boolean
}

export interface GossipLines {
  lines: string[]
  reveals: GossipReveal[]
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

/**
 * What a friend shares on a date: up to three lines about people they know (declared relations,
 * and their set when `setOf` is given): who's into the player, someone's attractions or style
 * (facts the player hasn't found yet come first), and who is with whom. The lines are appended to
 * the story's {partners}; `reveals` are the attractions and styles they give away.
 */
export function friendGossipLines(c: Character, ctx: GossipContext): GossipLines {
  const { characters, rels, relations, routeOf, names, rng } = ctx
  const known = listeners(c.id, relations, ctx.setOf, characters)
    .map((l) => l.id)
    .filter((id) => !!characters[id] && id !== c.id)
  type Fact = { line: string; rank: number; reveal?: GossipReveal }
  const pool: Fact[] = []
  for (const id of known) {
    const o = characters[id]
    const rel = rels[id]
    const name = nameOf(id, names)
    if (rel && routeOf(id) === 'romantic' && (rel.affection ?? 0) >= INTO_YOU_AFFECTION) {
      pool.push({ line: `${name} is into you, properly`, rank: 0 })
    }
    const attractions = describeAttractions(o.attractedTo ?? [])
    if (attractions) {
      const label = String(o.orientation ?? '').trim()
      pool.push({
        line: `${name} is ${label ? `${label}: ` : ''}into ${attractions}`,
        rank: rel?.revealed?.attractions ? 3 : 1,
        reveal: { characterId: id, attractions: true },
      })
    }
    pool.push({
      line: `${name} ${STYLE_GOSSIP[o.relationshipStyle] ?? STYLE_GOSSIP.flexible}`,
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
    pool.push({ line: `${nameOf(r.a, names)} and ${nameOf(r.b, names)} ${phrase}${note ? `: ${lowerFirst(note)}` : ''}`, rank: 2 })
  }
  // Shuffle with the seeded rng, then keep the most interesting kinds first.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const picked = pool
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.rank - b.f.rank || a.i - b.i)
    .slice(0, MAX_GOSSIP_LINES)
    .map((x) => x.f)
  const reveals: GossipReveal[] = []
  for (const f of picked) {
    if (!f.reveal) continue
    const have = reveals.find((r) => r.characterId === f.reveal!.characterId)
    if (have) Object.assign(have, f.reveal.attractions ? { attractions: true } : {}, f.reveal.style ? { style: true } : {})
    else reveals.push({ ...f.reveal })
  }
  return { lines: picked.map((f) => f.line), reveals }
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
  return items.length ? items.join('; ') : 'none'
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
