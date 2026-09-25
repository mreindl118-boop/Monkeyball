// Rekindles (docs/SPEC.md, "Endings": characters can end up together if you don't pursue them;
// ARCHITECTURE, Engine, rekindle.ts). Pure: every roll uses the injected rng.
//
// Two characters of one set who are exes, partners or a situationship, both at 80+ affection and
// 60+ trust with the player, and neither exclusive with the player: at the end of every date there
// is a 20% chance the story surfaces that they got close again while the player was busy. Once per
// pair (GameState.rekindled). When both are open to more than one partner (poly or open, or
// flexible with an open or poly agreement with the player) they invite the player in; otherwise the
// door closes: both get `rekindledWith`, which the Sacrifice ending reads.

import type { Character, GameState, NewsItem, Relationship, SetRelationKind, SetRelationship } from '../types'
import { firstName } from './agreements'
import { pairKey } from './metamour'

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
    !rel.rekindledWith
  )
}

/** Pairs that could rekindle now (before the roll), in relation order. */
export function rekindleCandidates(
  input: Pick<RekindleInput, 'characters' | 'rels' | 'relations' | 'game' | 'setOf'>,
): { a: string; b: string; kind: SetRelationKind }[] {
  const out: { a: string; b: string; kind: SetRelationKind }[] = []
  const seen = new Set<string>()
  const done = new Set(input.game.rekindled ?? [])
  for (const r of input.relations ?? []) {
    if (!REKINDLE_KINDS.includes(r.kind) || r.a === r.b) continue
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
  partner: 'fell for each other all over again',
  situationship: 'finally stopped pretending it was nothing',
}

/**
 * Roll every eligible pair (20% each, once per pair once it fires). Returns the relationships
 * (rekindledWith set on both for a door closing), the game state (the pair recorded in
 * `rekindled`, the news appended) and the news.
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
    if (!invite) {
      rels = { ...rels, [a]: { ...rels[a], rekindledWith: b }, [b]: { ...rels[b], rekindledWith: a } }
    }
    game = { ...game, rekindled: [...(game.rekindled ?? []), pairKey(a, b)] }
    news.push({ id: `rekindle-${input.now.toString(36)}-${a}-${b}`, at: input.now, kind: 'rekindle', text, characterIds: [a, b], read: false })
  }
  if (news.length) game = { ...game, news: [...(game.news ?? []), ...news] }
  return { rels, game, news }
}
