// Test helpers for the relationship tests (Phase 4): a seeded random source, a scripted date model
// with the Agreement call, and the Afterhours world as the app's stores would hand it to the date
// flow. Not imported by the app.

import { bundledEntry, bundledSet } from '../data/bundled'
import { neutralJudge, noAgreementResult } from '../llm/coerce'
import { defaultSettings } from '../store/defaults'
import type {
  AgreementResult,
  Character,
  DateRecord,
  GameState,
  JudgeResult,
  PlayerProfile,
  Relationship,
  Rumor,
  SetRelationship,
  Settings,
} from '../types'
import type { DateHooks, DateLlm, DateWorld } from './dateFlow'
import { newGameState, newRelationship } from './relationship'

/** mulberry32: a small seeded random source in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random source that returns these values in order, then `then` forever. */
export function scripted(values: readonly number[], then = 0.5): () => number {
  const list = [...values]
  return () => (list.length ? list.shift()! : then)
}

// ---------------------------------------------------------------------------
// The Afterhours world

export const AFTERHOURS = bundledSet('afterhours')!

export function card(id: string): Character {
  const entry = bundledEntry(id)
  if (!entry) throw new Error(`No bundled character ${id}`)
  return entry.character
}

/** Every Afterhours character by id. */
export function afterhoursCharacters(): Record<string, Character> {
  return Object.fromEntries(AFTERHOURS.characters.map((id) => [id, card(id)]))
}

/** The set's relationships plus card partners, deduplicated (what the roster store hands out). */
export function afterhoursRelations(): SetRelationship[] {
  const out: SetRelationship[] = [...AFTERHOURS.relationships]
  for (const id of AFTERHOURS.characters) {
    for (const p of card(id).partners ?? []) {
      const dupe = out.some(
        (r) => r.kind === p.relation && ((r.a === id && r.b === p.characterId) || (r.a === p.characterId && r.b === id)),
      )
      if (!dupe) out.push({ a: id, b: p.characterId, kind: p.relation, note: '' })
    }
  }
  return out
}

export function afterhoursRumors(): Rumor[] {
  return [...(AFTERHOURS.rumors ?? [])]
}

export function afterhoursNames(): Record<string, string> {
  return Object.fromEntries(AFTERHOURS.characters.map((id) => [id, card(id).name]))
}

export function afterhoursSetOf(): Record<string, string> {
  return Object.fromEntries(AFTERHOURS.characters.map((id) => [id, 'afterhours']))
}

export function rel(id: string, patch: Partial<Relationship> = {}): Relationship {
  return { ...newRelationship(id), ...patch }
}

export const PLAYER: PlayerProfile = {
  name: 'Robin',
  gender: 'nonbinary',
  pronouns: 'they/them',
  bodyNotes: '',
  relationshipStyle: 'figuring',
}

// A Monday evening, so the queer bar's Thursday note never shows up by accident.
export const T0 = new Date(2026, 8, 21, 22, 0, 0).getTime()

export interface WorldOptions {
  /** The character on the date. */
  id: string
  rels?: Record<string, Relationship>
  game?: GameState
  settings?: Partial<Settings>
  profile?: Partial<PlayerProfile>
  rng?: () => number
  /** The clock's start (each read advances it by a second). */
  start?: number
  /** False leaves out the Phase 4 world (characters, relationships, game): a Phase 3 date. */
  full?: boolean
}

/** A DateWorld for an Afterhours character, with the whole set around them. */
export function afterhoursWorld(o: WorldOptions): DateWorld {
  const character = card(o.id)
  let t = o.start ?? T0
  const rels = o.rels ?? {}
  const world: DateWorld = {
    character,
    setId: 'afterhours',
    profile: { ...PLAYER, ...o.profile },
    settings: { ...defaultSettings(), ...o.settings },
    rel: rels[o.id] ?? newRelationship(o.id),
    names: afterhoursNames(),
    now: () => (t += 1000),
    rng: o.rng ?? (() => 0.5),
    relations: afterhoursRelations()
      .filter((r) => r.a === o.id || r.b === o.id)
      .map((r) => ({ characterId: r.a === o.id ? r.b : r.a, kind: r.kind, ...(r.note ? { note: r.note } : {}) })),
  }
  if (o.full === false) return world
  return {
    ...world,
    characters: afterhoursCharacters(),
    rels,
    game: o.game ?? newGameState(T0 - 1_000_000),
    setRelations: afterhoursRelations(),
    rumors: afterhoursRumors(),
    setOf: afterhoursSetOf(),
  }
}

// ---------------------------------------------------------------------------
// A scripted model

export interface Script {
  judges?: Partial<JudgeResult>[]
  stories?: string[]
  agreements?: (Partial<AgreementResult> | Record<string, unknown>)[]
  summary?: string
}

export function fakeLlm(script: Script = {}) {
  const judges = [...(script.judges ?? [])]
  const stories = [...(script.stories ?? [])]
  const agreements = [...(script.agreements ?? [])]
  const calls = {
    story: [] as Parameters<DateLlm['story']>[0][],
    judge: [] as Parameters<DateLlm['judge']>[0][],
    agreement: [] as Parameters<NonNullable<DateLlm['agreement']>>[0][],
    memory: 0,
  }
  const llm: DateLlm = {
    async story(a) {
      calls.story.push(a)
      const text = stories.shift() ?? `Reply ${calls.story.length}.`
      a.onDelta(text)
      return { text, refused: false }
    },
    async judge(a) {
      calls.judge.push(a)
      return { value: { ...neutralJudge(), ...(judges.shift() ?? {}) }, ok: true }
    },
    async suggestions(a) {
      return Object.fromEntries(a.keys.map((k) => [k, `A ${k} line`]))
    },
    async memory() {
      calls.memory++
      return script.summary ?? 'We talked for hours and I liked it more than I expected.'
    },
    async agreement(a) {
      calls.agreement.push(a)
      const next = agreements.shift()
      return { value: (next ?? noAgreementResult()) as AgreementResult, ok: !!next }
    },
  }
  return { llm, calls }
}

export function recorder() {
  const persisted: { rel: Relationship; record: DateRecord }[] = []
  const world: { rels: Relationship[]; game: GameState }[] = []
  const hooks: DateHooks = {
    onUpdate: () => undefined,
    persist: async (r, record) => {
      persisted.push({ rel: structuredClone(r), record: structuredClone(record) })
    },
    persistWorld: async (rels, game) => {
      world.push({ rels: structuredClone(rels), game: structuredClone(game) })
    },
  }
  return { hooks, persisted, world }
}

/** The last story call's system prompt. */
export function lastStory(calls: ReturnType<typeof fakeLlm>['calls']): string {
  return calls.story[calls.story.length - 1]?.system ?? ''
}

/** The last judge call's system prompt. */
export function lastJudge(calls: ReturnType<typeof fakeLlm>['calls']): string {
  return calls.judge[calls.judge.length - 1]?.system ?? ''
}
