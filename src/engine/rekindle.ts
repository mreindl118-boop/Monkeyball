// Rekindles (docs/SPEC.md, "Endings": characters can end up together if you don't pursue them;
// ARCHITECTURE, Engine, rekindle.ts). Pure: every roll uses the injected rng.
//
// Two characters of one set who are exes, partners or a situationship, both at 80+ affection and
// 60+ trust with the player, and neither exclusive with the player: at the end of every date there
// is a 20% chance the story surfaces that they got close again while the player was busy. Once per
// pair (GameState.rekindled), and never for a pair where one of them was on the date that just
// ended ("while you were busy" wouldn't hold). When both are open to more than one partner (poly or
// open, or flexible with an open or poly agreement with the player) they invite the player in: both
// get `rekindle` with invite true, each learns about the other, and their metamour approval is at
// least the Polycule threshold. Otherwise the door closes: both get `rekindle` and `rekindledWith`,
// which the Sacrifice ending reads. The story brings it up on the next date with either of them
// (build.ts, turnNote and {partners}).

import type { Character, GameState, NewsItem, Relationship, SetRelationKind, SetRelationship } from '../types'
import { firstName } from './agreements'
import { approval, pairKey, POLYCULE_APPROVAL } from './metamour'

export const REKINDLE_CHANCE = 0.2
export const REKINDLE_AFFECTION = 80
export const REKINDLE_TRUST = 60

const REKINDLE_KINDS: readonly SetRelationKind[] = ['ex', 'partner', 'situationship']

export interface RekindleInput {
  /** Active characters by id. */
  characters: Record<string, Character>
  rels: Record<string, Relationship>
  /** Active sets' relationships, card partners included. */
  relations: SetRelationship[]
  game: GameState
  now: number
  rng: () => number
  names: Record<string, string>
  /** Optional: set id per character; a pair must share one. */
  setOf?: Record<string, string>
  /** Optional: characters on the date that just ended (their pairs aren't rolled this time). */
  exclude?: string[]
}

export interface RekindleResult {
  rels: Record<string, Relationship>
  game: GameState
  news: NewsItem[]
}

/** Open to more than one partner: poly or open, or flexible with an open or poly agreement. */
export function openToMore(c: Pick<Character, 'relationshipStyle'>, rel: Relationship | undefined): boolean {
  if (c.relationshipStyle === 'polyamorous' || c.relationshipStyle === 'open') return true
  const type = rel?.agreement?.type
  return c.relationshipStyle === 'flexible' && (type === 'open' || type === 'poly')
}

function qualifies(rel: Relationship | undefined): boolean {
  return (
    !!rel &&
    (rel.affection ?? 0) >= REKINDLE_AFFECTION &&
    (rel.trust ?? 0) >= REKINDLE_TRUST &&
    rel.agreement?.type !== 'exclusive' &&
    !rel.rekindledWith &&
    !rel.rekindle
  )
}

/** Pairs that could rekindle now (before the roll), in relation order. */
export function rekindleCandidates(
  input: Pick<RekindleInput, 'characters' | 'rels' | 'relations' | 'game' | 'setOf' | 'exclude'>,
): { a: string; b: string; kind: SetRelationKind }[] {
  const out: { a: string; b: string; kind: SetRelationKind }[] = []
  const seen = new Set<string>()
  const done = new Set(input.game.rekindled ?? [])
  const away = new Set(input.exclude ?? [])
  for (const r of input.relations ?? []) {
    if (!REKINDLE_KINDS.includes(r.kind) || r.a === r.b) continue
    if (away.has(r.a) || away.has(r.b)) continue
    const key = pairKey(r.a, r.b)
    if (seen.has(key) || done.has(key)) continue
    seen.add(key)
    if (!input.characters[r.a] || !input.characters[r.b]) continue
    if (input.setOf && (input.setOf[r.a] ?? '') !== (input.setOf[r.b] ?? '')) continue
    if (!qualifies(input.rels[r.a]) || !qualifies(input.rels[r.b])) continue
    const [a, b] = r.a <= r.b ? [r.a, r.b] : [r.b, r.a]
    out.push({ a, b, kind: r.kind })
  }
  return out
}

const TOGETHER: Readonly<Record<string, string>> = {
  ex: 'got close again',
  partner: 'have been falling for each other again',
  situationship: 'finally stopped pretending it was nothing',
}

function knowAbout(rel: Relationship, other: string): Relationship {
  return (rel.knownOthers ?? []).includes(other) ? rel : { ...rel, knownOthers: [...(rel.knownOthers ?? []), other] }
}

/**
 * Roll every eligible pair (20% each, once per pair once it fires). Returns the relationships
 * (`rekindle` on both; `rekindledWith` too for a door closing; for an invite, each knows about the
 * other), the game state (the pair recorded in `rekindled`, an invite's approval raised to the
 * Polycule threshold, the news appended) and the news.
 */
export function rollRekindles(input: RekindleInput): RekindleResult {
  let rels = input.rels
  let game = input.game
  const news: NewsItem[] = []
  for (const { a, b, kind } of rekindleCandidates(input)) {
    if (!(input.rng() < REKINDLE_CHANCE)) continue
    const ca = input.characters[a]
    const cb = input.characters[b]
    const na = firstName(input.names[a] ?? a)
    const nb = firstName(input.names[b] ?? b)
    const invite = openToMore(ca, rels[a]) && openToMore(cb, rels[b])
    const what = TOGETHER[kind] ?? TOGETHER.ex
    const text = invite
      ? `${na} and ${nb} ${what} while you were busy, and they'd like you to join them some night.`
      : `${na} and ${nb} ${what} while you were busy. For now, the door is closing.`
    const at = input.now
    if (invite) {
      rels = {
        ...rels,
        [a]: { ...knowAbout(rels[a], b), rekindle: { with: b, invite: true, at } },
        [b]: { ...knowAbout(rels[b], a), rekindle: { with: a, invite: true, at } },
      }
      const now = approval(game, a, b, input.relations)
      if (now < POLYCULE_APPROVAL) {
        game = { ...game, metamours: { ...(game.metamours ?? {}), [pairKey(a, b)]: POLYCULE_APPROVAL } }
      }
    } else {
      rels = {
        ...rels,
        [a]: { ...rels[a], rekindledWith: b, rekindle: { with: b, invite: false, at } },
        [b]: { ...rels[b], rekindledWith: a, rekindle: { with: a, invite: false, at } },
      }
    }
    game = { ...game, rekindled: [...(game.rekindled ?? []), pairKey(a, b)] }
    news.push({ id: `rekindle-${input.now.toString(36)}-${a}-${b}`, at: input.now, kind: 'rekindle', text, characterIds: [a, b], read: false })
  }
  if (news.length) game = { ...game, news: [...(game.news ?? []), ...news] }
  return { rels, game, news }
}
