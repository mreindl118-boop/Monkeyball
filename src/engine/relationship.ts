// Fresh relationship and game state, plus repair of stored ones. Pure: no React, no Dexie.

import type { Agreement, GameState, Relationship } from '../types'

/** No agreement yet: until someone asks, anyone dating around is fair game. */
export function noAgreement(): Agreement {
  return { type: 'none', terms: '', madeAt: 0 }
}

/** A brand-new relationship: strangers, nothing discovered, no agreement. */
export function newRelationship(characterId: string): Relationship {
  return {
    characterId,
    affection: 0,
    trust: 0,
    discovered: [],
    venues: {},
    gifts: {},
    revealed: { attractions: false, style: false },
    knowsPlayerStyle: false,
    secretsUnlocked: [],
    agreement: noAgreement(),
    knownOthers: [],
    memory: [],
    tiersUnlocked: [],
    betrayals: [],
    dates: 0,
    lastDateAt: 0,
    connection: 0,
    heatPushes: 0,
    jealous: false,
  }
}

/** A new game: no news, no rumors heard, no metamour history, no endings seen. */
export function newGameState(now: number = Date.now()): GameState {
  return {
    startedAt: now,
    news: [],
    rumors: [],
    metamours: {},
    rekindled: [],
    endingsSeen: {},
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const arr = <T>(v: unknown, d: T[]): T[] => (Array.isArray(v) ? (v as T[]) : d)
const rec = <T>(v: unknown, d: T): T => (isRecord(v) ? (v as T) : d)

/**
 * A stored relationship (possibly from an older version, or damaged) with every missing or
 * mistyped field set to its default. Unknown extra fields are kept.
 */
export function withRelationshipDefaults(stored: unknown, characterId?: string): Relationship {
  const s = isRecord(stored) ? stored : {}
  const id = typeof s.characterId === 'string' && s.characterId ? s.characterId : (characterId ?? '')
  const d = newRelationship(id)
  const revealed = rec<Partial<Relationship['revealed']>>(s.revealed, {})
  const agreement = rec<Partial<Agreement>>(s.agreement, {})
  return {
    ...s,
    ...d,
    characterId: id,
    affection: num(s.affection, 0),
    trust: num(s.trust, 0),
    discovered: arr(s.discovered, d.discovered),
    venues: rec(s.venues, d.venues),
    gifts: rec(s.gifts, d.gifts),
    revealed: {
      attractions: bool(revealed.attractions, false),
      style: bool(revealed.style, false),
    },
    knowsPlayerStyle: bool(s.knowsPlayerStyle, false),
    secretsUnlocked: arr(s.secretsUnlocked, d.secretsUnlocked),
    agreement: {
      type: typeof agreement.type === 'string' ? agreement.type : 'none',
      terms: typeof agreement.terms === 'string' ? agreement.terms : '',
      madeAt: num(agreement.madeAt, 0),
    },
    knownOthers: arr(s.knownOthers, d.knownOthers),
    memory: arr(s.memory, d.memory),
    tiersUnlocked: arr(s.tiersUnlocked, d.tiersUnlocked),
    betrayals: arr(s.betrayals, d.betrayals),
    dates: num(s.dates, 0),
    lastDateAt: num(s.lastDateAt, 0),
    connection: num(s.connection, 0),
    heatPushes: num(s.heatPushes, 0),
    jealous: bool(s.jealous, false),
  } as Relationship
}

/** Stored game state merged over a new game, so fields added later get their defaults. */
export function withGameDefaults(stored: unknown, now: number = Date.now()): GameState {
  const s = isRecord(stored) ? stored : {}
  const d = newGameState(now)
  return {
    ...s,
    startedAt: num(s.startedAt, d.startedAt),
    news: arr(s.news, d.news),
    rumors: arr(s.rumors, d.rumors),
    metamours: rec(s.metamours, d.metamours),
    rekindled: arr(s.rekindled, d.rekindled),
    endingsSeen: rec(s.endingsSeen, d.endingsSeen),
  } as GameState
}
