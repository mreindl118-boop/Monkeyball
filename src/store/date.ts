// useDate: the date being played. A thin store over the date engine (src/engine/dateFlow.ts):
// it builds the engine's world from the settings, roster and game stores, gives it the app's model
// calls (story role for story and memory, judge role for judge and suggestions), persists every
// applied step (useGame.saveRel and the DateRecord in Dexie), and owns the AbortController of the
// call in flight so End date and leaving the screen can stop it.
//
// The engine never throws for model problems: a failed story call becomes a system turn and the
// date waits for retry(); a failed judge is neutral; failed chips are none. `problem` is only for
// the unexpected (a bug), and retry() runs that action again.
//
// A reload mid-date loses the session but not the date: the record and the relationship are saved
// after every step, and kv 'activeDate' remembers which date was open (with the relationship as it
// was when the date started). findInterrupted() finds it; recoverInterrupted() finishes it into a
// recap (no memory call when offline); dropInterrupted() files it as abandoned.
//
// Phase 4: the world the date sees is everyone in play (characters, relationships, the game state,
// the active sets' relationships and rumors), so the engine can tell who else the player is
// seeing, settle Define the relationship (openDtr, closeDtr, dismissDtrOffer), and, when the date
// ends, spread gossip and roll rekindles; what that changes elsewhere comes back through
// hooks.persistAll and lands in the game store in the same transaction as the date's last save. startEpilogue plays a character's ending at 100
// affection. The first time someone reaches 100 (and before any epilogue, if missing) the store
// writes the save slot "Before {name}'s epilogue" (id auto-epilogue-{id}).
//
// Tests build their own store with createDateStore({ llm, db, game, settings, roster }).

import { create } from 'zustand'
import { onEnding as artOnEnding, onUnlock as artOnUnlock } from '../art/generate'
import { db as appDb, type CrushDB } from '../db/db'
import { getDate, kvDelete, kvGet, kvSet, putDate, snapshot } from '../db/repo'
import {
  canOpenDtr,
  canRetry,
  canSend,
  closeDtr,
  createDate,
  createEpilogue,
  dtrOpen,
  finishDate,
  openDate,
  openDtr,
  playerTurnCount,
  retryLastReply,
  sendPlayerMessage,
  type DateHooks,
  type DateLlm,
  type DateSession,
  type DateWorld,
} from '../engine/dateFlow'
import { selectEnding } from '../engine/endings'
import { leftEarly } from '../engine/math'
import { newGameState, withRelationshipDefaults } from '../engine/relationship'
import { routeFor } from '../engine/stages'
import { coerceAgreement, coerceJudge, coerceSuggestions, neutralJudge, noAgreementResult } from '../llm/coerce'
import { AGREEMENT_SCHEMA, chat, jsonChat, streamChat, suggestionsSchema, type ChatMessage } from '../llm/index'
import type {
  AgreementType,
  Character,
  ConnectionSettings,
  DateRecord,
  EndingType,
  GameState,
  PlayerProfile,
  Relationship,
  SetRelationship,
  Settings,
  Suggestions,
  TierNumber,
} from '../types'
import { useGame, type GameStoreState } from './game'
import { selectActiveEntries, selectRelationsFor, useRoster, type RosterData, type RosterState } from './roster'
import { endingReady, epilogueSlotId, epilogueSlotLabel, reachedWon } from './epilogueSlot'
import { appRandom } from './rolls'
import { useSettings, type SettingsState } from './settings'

/** kv key of the date that is open (cleared when it finishes). */
export const ACTIVE_DATE_KEY = 'activeDate'

/** What kv 'activeDate' holds. */
export interface ActiveDateMark {
  dateId: number
  characterId: string
  /** The relationship when the date started, for the recap of an interrupted date. */
  relBefore?: Relationship
}

/** The engine functions the store calls (tests may swap them). */
export interface DateEngine {
  createDate: typeof createDate
  openDate: typeof openDate
  sendPlayerMessage: typeof sendPlayerMessage
  retryLastReply: typeof retryLastReply
  finishDate: typeof finishDate
  /** Phase 4: Define the relationship and the epilogue (the engine's own when left out). */
  openDtr?: typeof openDtr
  closeDtr?: typeof closeDtr
  createEpilogue?: typeof createEpilogue
}

const ENGINE: DateEngine = {
  createDate,
  openDate,
  sendPlayerMessage,
  retryLastReply,
  finishDate,
  openDtr,
  closeDtr,
  createEpilogue,
}

/** 'dtr': closing a Define-the-relationship talk (the Agreement prompt). */
export type DateAction = 'open' | 'send' | 'retry' | 'finish' | 'dtr'

/** Something went wrong outside the engine's own handling (a bug, not a model problem). */
export interface DateProblem {
  action: DateAction
  message: string
  /** The player's message, when a send failed. */
  text?: string
}

/** A date that was open when the app closed. */
export interface InterruptedDate {
  record: DateRecord
  characterId: string
  /** The character's name (their id when they are no longer on this device). */
  name: string
  /** Player messages that made it in. */
  turns: number
}

export type StartResult =
  | { ok: true; dateId: number }
  /** Another date is still open (finish or end it first). */
  | { ok: false; reason: 'busy'; characterId: string }
  /** The character isn't on this device. */
  | { ok: false; reason: 'missing' }
  /** An epilogue asked for before 100 affection (or on a friend route). */
  | { ok: false; reason: 'not-ready' }

export interface DateStoreState {
  /** The date on screen (kept after it ends, until another starts or clear()). */
  session: DateSession | null
  /** The DateRecord's id in Dexie (negative: kept in memory only, storage refused it). */
  dateId: number | null
  /** The action running, if any. */
  running: DateAction | null
  problem: DateProblem | null
  /** The composer's text (kept while the player steps away, restored when a send is taken back). */
  draft: string
  /** A call was stopped because the player left the date screen; resume() picks it up. */
  paused: boolean
  /** Set once the date has ended and its recap is on the record. */
  finishedId: number | null
  /** The last finished record, so the recap shows even when storage refused it. */
  lastRecord: DateRecord | null
  /** Filled by findInterrupted(). */
  interrupted: InterruptedDate | null
  /** The last storage failure while saving the date. */
  storageError: string | null
  /** The player said "Not now" to the character's offer to define the relationship on this date. */
  dtrOfferDismissed: boolean

  setDraft: (text: string) => void
  /** Start a date and its opening in the background. Resolves once the session exists. */
  start: (characterId: string, venueId: string, giftId?: string) => Promise<StartResult>
  /** Send the player's message (skips chips still loading). False when it couldn't be sent. */
  send: (text: string) => Promise<boolean>
  /** Ask for a missing reply again, or rerun an action that failed unexpectedly. */
  retry: () => Promise<void>
  /** End date: stop what's running, then finish (memory, recap). Resolves to the date id. */
  end: () => Promise<number | null>
  /** Stop the call in flight (leaving the date screen). The date stays open. */
  cancel: () => void
  /** Back on the date screen after cancel(): ask again for a reply that was stopped. */
  resume: () => Promise<void>
  findInterrupted: () => Promise<InterruptedDate | null>
  /** Finish an interrupted date into a recap. Resolves to its id. */
  recoverInterrupted: () => Promise<number | null>
  /** File an interrupted date away without a recap. */
  dropInterrupted: () => Promise<void>
  /** Forget the session (stops anything running). */
  clear: () => void

  // Phase 4
  /**
   * Open Define the relationship, asking for `requested` (the story's next reply answers it; turns
   * are flagged until the talk closes). False when it can't open now.
   */
  openDtr: (requested: AgreementType) => Promise<boolean>
  /** Close the talk: the Agreement prompt runs once and its answer applies. */
  closeDtr: () => Promise<void>
  /** "Not now" to the character's own offer to define it. */
  dismissDtrOffer: () => void
  /**
   * Start a character's epilogue (100 affection): the ending they're on, as a six-turn date at their
   * first favorite venue. Writes the "Before {name}'s epilogue" slot first if there isn't one.
   */
  startEpilogue: (characterId: string) => Promise<StartResult>
}

type Pickable<T> = { getState(): T }

export interface DateStoreDeps {
  engine?: DateEngine
  /** The model calls for a date with this character (tests inject a fake). */
  llm?: (characterId: string) => DateLlm
  db?: CrushDB
  game?: Pickable<Pick<GameStoreState, 'load' | 'rel' | 'saveRel' | 'relationships'> & Partial<Pick<GameStoreState, 'game' | 'patchGame'>>>
  settings?: Pickable<Pick<SettingsState, 'settings' | 'profile'>>
  roster?: Pickable<Pick<RosterState, 'load' | 'entries' | 'sets'>>
  now?: () => number
  rng?: () => number
  /** False skips the memory call when finishing an interrupted date or ending one. */
  online?: () => boolean
  /**
   * Phase 5: art for tiers and endings a save unlocks (default src/art/generate.ts: painted in the
   * background when image generation is on). Fire-and-forget; never in the date's way.
   */
  art?: {
    onUnlock: (characterId: string, tiers: TierNumber[]) => void
    onEnding?: (characterId: string, ending: EndingType, group?: readonly string[]) => void
  }
}

// ---------------------------------------------------------------------------
// Model calls

/** Stand-in when no profile exists (the first-launch flow makes one before any date). */
const FALLBACK_PROFILE: PlayerProfile = {
  name: 'Player',
  gender: 'nonbinary',
  pronouns: 'they/them',
  bodyNotes: '',
  relationshipStyle: 'figuring',
}

function withSystem(system: string, messages: ChatMessage[]): ChatMessage[] {
  return messages[0]?.role === 'system' ? messages : [{ role: 'system', content: system }, ...messages]
}

/**
 * The app's model calls for a date, through src/llm/index.ts: story and memory on the story role,
 * judge and suggestions on the judge role. Every call is logged to the debug panel with the
 * character's id.
 */
export function appDateLlm(characterId: string, conn: () => ConnectionSettings): DateLlm {
  const debug = { characterId }
  return {
    story: async (a) => {
      const r = await streamChat({
        conn: conn(),
        role: 'story',
        kind: 'story',
        messages: withSystem(a.system, a.messages),
        signal: a.signal,
        onDelta: (piece) => a.onDelta(piece),
        debug,
      })
      return { text: r.text, refused: r.refused }
    },
    judge: async (a) => {
      const r = await jsonChat({
        conn: conn(),
        role: 'judge',
        kind: 'judge',
        messages: withSystem(a.system, a.messages),
        coerce: coerceJudge,
        fallback: neutralJudge(),
        signal: a.signal,
        debug,
      })
      return { value: r.value, ok: r.ok }
    },
    suggestions: async (a) => {
      const r = await jsonChat<Suggestions>({
        conn: conn(),
        role: 'judge',
        kind: 'suggestions',
        messages: withSystem(a.system, a.messages),
        coerce: coerceSuggestions(a.keys),
        fallback: {},
        schema: suggestionsSchema(a.keys),
        signal: a.signal,
        debug,
      })
      return r.ok ? r.value : null
    },
    memory: async (a) => {
      const r = await chat({ conn: conn(), role: 'story', kind: 'memory', messages: withSystem(a.system, a.messages), signal: a.signal, debug })
      return r.refused ? '' : r.text
    },
    agreement: async (a) => {
      const r = await jsonChat({
        conn: conn(),
        role: 'judge',
        kind: 'agreement',
        messages: withSystem(a.system, a.messages),
        coerce: coerceAgreement,
        fallback: noAgreementResult(),
        schema: AGREEMENT_SCHEMA,
        signal: a.signal,
        debug,
      })
      return { value: r.value, ok: r.ok }
    },
  }
}

function abortError(): Error {
  const e = new Error('Stopped.')
  e.name = 'AbortError'
  return e
}

/** Settle as soon as the signal aborts, even if the call underneath ignores it. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p
  if (signal.aborted) {
    p.catch(() => undefined)
    return Promise.reject(abortError())
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.trim() || 'Something went wrong.'
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for screens and tests)

/** The date is still being played (not ended). */
export function isLive(s: Pick<DateStoreState, 'session'>): boolean {
  return !!s.session && s.session.status !== 'ended'
}

/** The character on the open date, or null. */
export function liveCharacterId(s: Pick<DateStoreState, 'session'>): string | null {
  return isLive(s) ? (s.session!.record.characterIds[0] ?? null) : null
}

/** Every turn was played and the last word was the character's. */
export function completedRecord(record: Pick<DateRecord, 'turns' | 'maxTurns'>): boolean {
  const said = record.turns.filter((t) => t.role !== 'system')
  return playerTurnCount(record) >= record.maxTurns && said.length > 0 && said[said.length - 1].role === 'character'
}

/**
 * The judge's {others}: the other characters on this device the player has been on a date with.
 * Phase 4 refines what counts as seeing someone (endings, rekindles).
 */
export function othersSeen(
  relationships: Readonly<Record<string, Relationship>>,
  characterId: string,
  known: Readonly<Record<string, unknown>>,
): string[] {
  return Object.values(relationships)
    .filter((r) => r.characterId !== characterId && (r.dates ?? 0) > 0 && r.characterId in known)
    .map((r) => r.characterId)
    .sort()
}

/**
 * Every relationship between characters in play, as the world engine reads them (gossip, metamour
 * approval, rekindles, endings, the polycule map): each active character's manifest relationships
 * and card partners (roster `selectRelationsFor`), each pair and kind once.
 */
export function activeRelations(data: RosterData, activeSets: readonly string[]): SetRelationship[] {
  const out: SetRelationship[] = []
  const seen = new Set<string>()
  for (const entry of selectActiveEntries(data, { activeSets: [...activeSets], showMe: 'everyone' })) {
    const id = entry.character.id
    for (const r of selectRelationsFor(data, id, activeSets)) {
      const [a, b] = id < r.id ? [id, r.id] : [r.id, id]
      const key = `${a}|${b}|${r.kind}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ a, b, kind: r.kind, note: r.note ?? '' })
    }
  }
  return out
}

/**
 * The date's settings with the player's current ones (heat, chips, connection), so a heat changed
 * mid-date reaches the next story and chips call. The route (orientation mode), the date's length
 * and its gain cap stay as they were when the date began.
 */
export function liveSettings(dateSettings: Settings, current: Settings): Settings {
  return {
    ...current,
    orientationMode: dateSettings.orientationMode,
    dateLength: dateSettings.dateLength,
    gainCap: dateSettings.gainCap,
  }
}

/**
 * The relationship before a date, estimated from the record when it wasn't saved: the date's
 * running totals taken back off the meters.
 */
export function estimateBefore(rel: Relationship, record: Pick<DateRecord, 'totals' | 'characterIds'>): Relationship {
  const t = record.totals?.[record.characterIds[0] ?? rel.characterId]
  if (!t) return rel
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
  return { ...rel, affection: clamp(rel.affection - (t.affection ?? 0)), trust: clamp(rel.trust - (t.trust ?? 0)) }
}

// ---------------------------------------------------------------------------
// The store

export function createDateStore(deps: DateStoreDeps = {}) {
  const engine = deps.engine ?? ENGINE
  const d = deps.db ?? appDb
  const game = () => (deps.game ?? useGame).getState()
  const settingsOf = () => (deps.settings ?? useSettings).getState()
  const roster = () => (deps.roster ?? useRoster).getState()
  const now = deps.now ?? (() => Date.now())
  // Math.random, or in dev builds the debug panel's pinned rolls (src/store/rolls.ts).
  const rng = deps.rng ?? appRandom
  const online = deps.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const makeLlm = deps.llm ?? ((id: string) => appDateLlm(id, () => settingsOf().settings.connection))
  const art = deps.art ?? { onUnlock: artOnUnlock, onEnding: artOnEnding }

  /** Bumped by every run and by clear(); a run that isn't the latest stops touching state. */
  let token = 0
  /** The run in flight: its controller and the promise of the session it returns. */
  let ctrl: AbortController | null = null
  let inflight: Promise<DateSession | null> | null = null
  /** The suggestions call in flight: aborting it skips the chips without stopping anything else. */
  let chips: AbortController | null = null
  let finishing: Promise<number | null> | null = null
  let memoryIds = 0

  return create<DateStoreState>()((set, get) => {
    const storageFailed = (e: unknown) => set({ storageError: errorText(e) })

    const saveRecord = async (record: DateRecord) => {
      try {
        await putDate(record, d)
      } catch (e) {
        storageFailed(e)
      }
    }

    /**
     * Relationship and record, after every applied step, in one transaction: a crash can't land
     * one without the other (the last save of a date carries its outcome together with the +1
     * date, the memory and the consistency trust, so a recovery never finishes it twice). When a
     * transaction can't open (no IndexedDB), the writes go on their own and fail as they would.
     */
    /**
     * Phase 5: the tiers (each unlocks exactly once, in rel.tiersUnlocked) and the ending this save
     * adds over the stored relationship start their art in the background.
     */
    const startArt = (rel: Relationship, before: Relationship | undefined) => {
      try {
        const had = new Set(before?.tiersUnlocked ?? [])
        const tiers = (rel.tiersUnlocked ?? []).filter((t) => !had.has(t))
        if (tiers.length) art.onUnlock(rel.characterId, tiers)
        if (rel.ending && rel.ending.playedAt !== before?.ending?.playedAt) {
          art.onEnding?.(rel.characterId, rel.ending.type, get().session?.ending?.group)
        }
      } catch {
        // Art never gets in the date's way.
      }
    }

    const persist = async (rel: Relationship, record: DateRecord) => {
      const id = get().dateId
      const withId = record.id == null && id != null ? { ...record, id } : record
      // Loaded outside the transaction: a first load reads tables the transaction doesn't hold.
      await game()
        .load()
        .catch(() => undefined)
      const before = game().relationships?.[rel.characterId]
      const both = () => Promise.all([game().saveRel(rel), saveRecord(withId)])
      try {
        await d.transaction('rw', d.relationships, d.dates, both)
      } catch {
        await both()
      }
      startArt(rel, before)
    }

    const readMark = async (): Promise<ActiveDateMark | null> => {
      try {
        const m = await kvGet<ActiveDateMark>(ACTIVE_DATE_KEY, d)
        return m && typeof m.dateId === 'number' && typeof m.characterId === 'string' ? m : null
      } catch {
        return null
      }
    }

    const clearMark = async () => {
      try {
        await kvDelete(ACTIVE_DATE_KEY, d)
      } catch {
        // Nothing to clear when storage is gone.
      }
    }

    const buildWorld = (characterId: string, rel?: Relationship): DateWorld | null => {
      const r = roster()
      const entry = r.entries[characterId]
      if (!entry) return null
      const { settings, profile } = settingsOf()
      const names: Record<string, string> = {}
      for (const e of Object.values(r.entries)) names[e.character.id] = e.character.name.trim() || e.character.id
      const others = othersSeen(game().relationships ?? {}, characterId, r.entries)
      const relations = selectRelationsFor({ sets: r.sets, entries: r.entries }, characterId, settings.activeSets).map((x) => ({
        characterId: x.id,
        kind: x.kind,
        ...(x.note ? { note: x.note } : {}),
      }))
      // Phase 4: everyone in play, so the date can tell who else the player is seeing, spread
      // gossip, roll rekindles and settle endings when it finishes.
      const data = { sets: r.sets, entries: r.entries }
      const characters: Record<string, Character> = {}
      const setOf: Record<string, string> = {}
      for (const e of selectActiveEntries(data, { activeSets: settings.activeSets, showMe: 'everyone' })) {
        characters[e.character.id] = e.character
        setOf[e.character.id] = e.setId
      }
      characters[characterId] = entry.character
      setOf[characterId] = entry.setId
      const activeSetIds = new Set(settings.activeSets)
      const world: DateWorld = {
        character: entry.character,
        setId: entry.setId,
        profile: profile ?? FALLBACK_PROFILE,
        settings,
        rel: rel ?? game().rel(characterId),
        names,
        now,
        rng,
        relations,
        others,
        characters,
        rels: { ...(game().relationships ?? {}) },
        setRelations: activeRelations(data, settings.activeSets),
        rumors: r.sets.filter((x) => activeSetIds.has(x.id)).flatMap((x) => x.rumors ?? []),
        setOf,
      }
      const g = game().game
      if (g) world.game = g
      return world
    }

    /**
     * What finishDate settled elsewhere (other relationships, the game state with news, rumors,
     * metamours, rekindles and endings seen), in one transaction where storage allows.
     */
    const persistWorld = async (rels: Relationship[], next: GameState) => {
      await game()
        .load()
        .catch(() => undefined)
      const write = async () => {
        for (const r of rels) await game().saveRel(r)
        await game().patchGame?.(next)
      }
      try {
        await d.transaction('rw', d.relationships, d.kv, write)
      } catch {
        await write().catch(() => undefined)
      }
    }

    /**
     * The date's last save and the world it settled, in one transaction where storage allows: a
     * crash can't store the other characters' betrayals and the news without the date's outcome,
     * so a recovery never settles the same date's world twice.
     */
    const persistAll = async (rel: Relationship, record: DateRecord, rels: Relationship[], next: GameState) => {
      const id = get().dateId
      const withId = record.id == null && id != null ? { ...record, id } : record
      await game()
        .load()
        .catch(() => undefined)
      const before = game().relationships?.[rel.characterId]
      const write = async () => {
        for (const r of rels) await game().saveRel(r)
        await game().patchGame?.(next)
        await Promise.all([game().saveRel(rel), saveRecord(withId)])
      }
      try {
        await d.transaction('rw', d.relationships, d.dates, d.kv, write)
      } catch {
        await write().catch(() => undefined)
      }
      startArt(rel, before)
    }

    /**
     * The first time a character reaches 100: a save slot from just before their epilogue, so the
     * player can come back and try for another ending. One per character; never throws.
     */
    const autosaveBeforeEpilogue = async (characterId: string) => {
      const id = epilogueSlotId(characterId)
      try {
        if (await d.saves.get(id)) return
        const name = roster().entries[characterId]?.character.name ?? characterId
        const data = await snapshot({ withSettings: false }, d)
        await d.saves.put({ id, label: epilogueSlotLabel(name), createdAt: now(), data })
      } catch (e) {
        storageFailed(e)
      }
    }

    /**
     * The session as the next engine call should see it: the player's current heat, chips and
     * connection (liveSettings), and a date stuck on 'suggesting' with nothing running (its chips
     * were stopped) back on the player's turn.
     */
    const live = (s: DateSession): DateSession => {
      const settings = liveSettings(s.world.settings, settingsOf().settings)
      const status = s.status === 'suggesting' && !get().running ? 'awaiting-player' : s.status
      return { ...s, status, world: { ...s.world, settings } }
    }

    /** The model calls for one run: the run's signal as a default, chips that can be skipped. */
    const llmFor = (characterId: string, signal: AbortSignal, noMemory: boolean): DateLlm => {
      const inner = makeLlm(characterId)
      return {
        story: (a) => raceAbort(inner.story({ ...a, signal: a.signal ?? signal }), a.signal ?? signal),
        judge: (a) => raceAbort(inner.judge({ ...a, signal: a.signal ?? signal }), a.signal ?? signal),
        memory: (a) => (noMemory ? Promise.resolve('') : raceAbort(inner.memory({ ...a, signal: a.signal ?? signal }), a.signal ?? signal)),
        agreement: (a) =>
          inner.agreement
            ? raceAbort(inner.agreement({ ...a, signal: a.signal ?? signal }), a.signal ?? signal)
            : Promise.resolve({ value: noAgreementResult(), ok: false }),
        suggestions: async (a) => {
          const parent = a.signal ?? signal
          const own = new AbortController()
          const stop = () => own.abort()
          if (parent.aborted) own.abort()
          else parent.addEventListener('abort', stop, { once: true })
          chips = own
          try {
            return await raceAbort(inner.suggestions({ ...a, signal: own.signal }), own.signal)
          } catch {
            return null
          } finally {
            if (chips === own) chips = null
            parent.removeEventListener('abort', stop)
          }
        },
      }
    }

    /**
     * A finished date: the open-date mark goes, the screen moves on to the recap. The first time a
     * character reaches 100 the epilogue autosave is written, after everything else has landed.
     */
    const landed = async (s: DateSession) => {
      await clearMark()
      set({ finishedId: s.record.id ?? get().dateId, lastRecord: s.record, draft: '' })
      if (s.record.kind !== 'epilogue' && reachedWon(s.relBefore, s.rel)) {
        await autosaveBeforeEpilogue(s.world.character.id)
      }
    }

    type Exec = (s: DateSession, llm: DateLlm, hooks: DateHooks) => Promise<DateSession>

    const run = (action: DateAction, base: DateSession, exec: Exec, opts: { text?: string; noMemory?: boolean } = {}) => {
      const my = ++token
      const controller = new AbortController()
      ctrl = controller
      set({ running: action, problem: null, paused: false })
      const hooks: DateHooks = {
        signal: controller.signal,
        onUpdate: (s) => {
          if (my === token) set({ session: s })
        },
        persist,
        persistWorld,
        persistAll,
      }
      const p = (async (): Promise<DateSession | null> => {
        try {
          const llm = llmFor(base.world.character.id, controller.signal, !!opts.noMemory)
          const next = await exec(base, llm, hooks)
          if (my !== token) return null
          set({ session: next, running: null })
          if (next.status === 'ended') await landed(next)
          return next
        } catch (e) {
          if (my !== token) return null
          const problem: DateProblem = { action, message: errorText(e) }
          if (opts.text) problem.text = opts.text
          set({ session: base, running: null, problem })
          return null
        } finally {
          if (ctrl === controller) ctrl = null
        }
      })()
      inflight = p
      void p.finally(() => {
        if (inflight === p) inflight = null
      })
      return p
    }

    /** Skip chips that are still loading and wait for the run to land. */
    const settle = async () => {
      if (!inflight) return
      if (get().session?.status !== 'suggesting') return
      chips?.abort()
      await inflight
    }

    const finishRun = (base: DateSession, reason: 'completed' | 'left' | 'ended') =>
      run('finish', base, (s, llm, hooks) => engine.finishDate(s, reason, llm, hooks).then((r) => r.session), {
        noMemory: !online(),
      })

    /** A date left open by a reload or a crash is filed as abandoned (no recap). */
    const abandonOpenDate = async () => {
      const mark = await readMark()
      if (!mark) return
      try {
        const record = await getDate(mark.dateId, d)
        if (record && !record.outcome) await saveRecord({ ...record, outcome: 'abandoned', endedAt: now() })
      } catch (e) {
        storageFailed(e)
      }
      await clearMark()
    }

    /**
     * Start a date made by `make` from the world: another open date is refused, one left open by a
     * reload is filed away, the record is stored and marked as the open date, and the opening runs
     * in the background. Resolves once the session exists.
     */
    const begin = async (
      characterId: string,
      make: (world: DateWorld) => DateSession | null,
    ): Promise<StartResult> => {
      await Promise.all([roster().load(), game().load()]).catch(() => undefined)
      const open = get().session
      if (open && open.status !== 'ended') {
        return { ok: false, reason: 'busy', characterId: open.record.characterIds[0] ?? '' }
      }
      const world = buildWorld(characterId)
      if (!world) return { ok: false, reason: 'missing' }
      let session = make(world)
      if (!session) return { ok: false, reason: 'not-ready' }
      await abandonOpenDate()

      token++
      let id: number
      try {
        id = await putDate(session.record, d)
      } catch (e) {
        storageFailed(e)
        id = -++memoryIds
      }
      session = { ...session, record: { ...session.record, id } }
      const mark: ActiveDateMark = { dateId: id, characterId, relBefore: session.relBefore }
      try {
        await kvSet(ACTIVE_DATE_KEY, mark, d)
      } catch (e) {
        storageFailed(e)
      }
      set({
        session,
        dateId: id,
        running: null,
        problem: null,
        draft: '',
        paused: false,
        finishedId: null,
        lastRecord: null,
        interrupted: null,
        dtrOfferDismissed: false,
      })
      void run('open', session, engine.openDate)
      return { ok: true, dateId: id }
    }

    return {
      session: null,
      dateId: null,
      running: null,
      problem: null,
      draft: '',
      paused: false,
      finishedId: null,
      lastRecord: null,
      interrupted: null,
      storageError: null,
      dtrOfferDismissed: false,

      setDraft: (text) => set({ draft: text }),

      start: (characterId, venueId, giftId) =>
        begin(characterId, (world) =>
          engine.createDate(world, {
            venueId,
            ...(giftId ? { giftId } : {}),
            maxTurns: world.settings.dateLength,
            kind: 'single',
          }),
        ),

      send: async (raw) => {
        const text = raw.trim()
        if (!text) return false
        await settle()
        const current = get().session
        if (!current || get().running) return false
        const s = live(current)
        if (!canSend(s)) return false
        set({ draft: '' })
        const next = await run('send', s, (b, llm, hooks) => engine.sendPlayerMessage(b, text, llm, hooks), { text })
        // Stopped before the judge answered: the engine took the message back, so the draft gets it.
        if (next && playerTurnCount(next.record) === playerTurnCount(s.record) && !get().draft) set({ draft: text })
        return !!next && playerTurnCount(next.record) > playerTurnCount(s.record)
      },

      retry: async () => {
        const st = get()
        if (st.running || !st.session) return
        const p = st.problem
        if (p?.action === 'send' && p.text) {
          await get().send(p.text)
          return
        }
        if (p?.action === 'finish') {
          await get().end()
          return
        }
        if (p?.action === 'dtr') {
          await get().closeDtr()
          return
        }
        const session = live(st.session)
        if (p?.action === 'open' || session.status === 'opening') {
          await run('open', session, engine.openDate)
          return
        }
        if (canRetry(session)) await run('retry', session, engine.retryLastReply)
      },

      end: () => {
        if (finishing) return finishing
        const first = get().session
        if (!first) return Promise.resolve(null)
        if (first.status === 'ended') return Promise.resolve(get().finishedId)
        finishing = (async () => {
          if (inflight) {
            // A date already closing (its last reply landed) finishes on its own, and a talk being
            // closed gets its Agreement answer (stopping it would only send the prompt again when
            // the date settles the talk).
            if (get().session?.status !== 'closing' && get().running !== 'dtr') {
              chips?.abort()
              ctrl?.abort()
            }
            await inflight
          }
          const s = get().session
          if (!s) return null
          if (s.status !== 'ended') {
            const next = await finishRun(s, 'ended')
            if (!next) return null
          }
          return get().finishedId
        })()
        const p = finishing
        void p.finally(() => {
          if (finishing === p) finishing = null
        })
        return p
      },

      cancel: () => {
        const st = get()
        if (!st.running || st.running === 'finish') return
        const status = st.session?.status
        // Chips are skipped; a date that is closing finishes in the background.
        chips?.abort()
        if (status === 'suggesting' || status === 'closing') return
        ctrl?.abort()
        set({ paused: true })
      },

      resume: async () => {
        if (!get().paused) return
        if (inflight) await inflight
        set({ paused: false })
        const s = get().session
        if (!s || get().running || s.status === 'ended') return
        // Chips that were stopped leave nothing to wait for: back to the player's turn.
        if (s.status === 'suggesting') set({ session: live(s) })
        if (canRetry(live(s))) await get().retry()
      },

      findInterrupted: async () => {
        if (isLive(get())) {
          set({ interrupted: null })
          return null
        }
        const mark = await readMark()
        if (!mark) {
          set({ interrupted: null })
          return null
        }
        let record: DateRecord | undefined
        try {
          record = await getDate(mark.dateId, d)
        } catch {
          record = undefined
        }
        if (!record || record.outcome) {
          await clearMark()
          set({ interrupted: null })
          return null
        }
        await roster().load().catch(() => undefined)
        const characterId = record.characterIds[0] ?? mark.characterId
        const entry = roster().entries[characterId]
        const interrupted: InterruptedDate = {
          record: { ...record, id: record.id ?? mark.dateId },
          characterId,
          name: entry?.character.name.trim() || characterId,
          turns: playerTurnCount(record),
        }
        set({ interrupted })
        return interrupted
      },

      recoverInterrupted: async () => {
        const it = get().interrupted ?? (await get().findInterrupted())
        if (!it) return null
        await Promise.all([roster().load(), game().load()]).catch(() => undefined)
        const mark = await readMark()
        const relNow = game().rel(it.characterId)
        const relBefore =
          mark?.relBefore && mark.dateId === it.record.id
            ? withRelationshipDefaults(mark.relBefore, it.characterId)
            : estimateBefore(relNow, it.record)
        const world = buildWorld(it.characterId, relBefore)
        if (!world) {
          await get().dropInterrupted()
          return null
        }
        const { record } = it
        // An epilogue keeps its ending, so finishing it still records the ending.
        const created =
          record.kind === 'epilogue' && record.endingType
            ? (engine.createEpilogue ?? createEpilogue)(world, { type: record.endingType })
            : engine.createDate(world, {
                venueId: record.venueId,
                ...(record.giftId ? { giftId: record.giftId } : {}),
                maxTurns: record.maxTurns,
                kind: record.kind,
              })
        const total = record.totals?.[it.characterId]?.affection ?? 0
        token++
        const base: DateSession = {
          ...created,
          record,
          rel: relNow,
          relBefore,
          status: 'awaiting-player',
          streaming: '',
          suggestions: null,
          leaving: leftEarly(total),
        }
        set({
          session: base,
          dateId: record.id ?? null,
          running: null,
          problem: null,
          draft: '',
          paused: false,
          finishedId: null,
          lastRecord: null,
          interrupted: null,
          dtrOfferDismissed: false,
        })
        const next = await finishRun(base, completedRecord(record) ? 'completed' : 'ended')
        return next ? get().finishedId : null
      },

      dropInterrupted: async () => {
        const it = get().interrupted
        if (it) await saveRecord({ ...it.record, outcome: 'abandoned', endedAt: now() })
        await clearMark()
        set({ interrupted: null })
      },

      clear: () => {
        token++
        chips?.abort()
        ctrl?.abort()
        ctrl = null
        chips = null
        inflight = null
        finishing = null
        set({
          session: null,
          dateId: null,
          running: null,
          problem: null,
          draft: '',
          paused: false,
          finishedId: null,
          lastRecord: null,
          interrupted: null,
          dtrOfferDismissed: false,
        })
      },

      openDtr: async (requested) => {
        if (requested === 'none') return false
        // Chips still loading are skipped first, so their late answer can't overwrite the talk.
        await settle()
        const st = get()
        if (!st.session || st.running) return false
        const s = live(st.session)
        if (!canOpenDtr(s)) return false
        // Theirs only when the player takes up what the character asked for; picking something else
        // in the sheet makes it the player's ask.
        const by = s.dtrOffer && !st.dtrOfferDismissed && requested === s.dtrOffer ? 'character' : 'player'
        const next = (engine.openDtr ?? openDtr)(s, requested, by)
        if (next === s) return false
        set({ session: next })
        await persist(next.rel, next.record)
        return true
      },

      closeDtr: async () => {
        await settle()
        const st = get()
        if (!st.session || st.running) return
        const s = live(st.session)
        if (!dtrOpen(s) || s.status === 'ended') return
        await run('dtr', s, (b, llm, hooks) => (engine.closeDtr ?? closeDtr)(b, llm, hooks))
      },

      dismissDtrOffer: () => set({ dtrOfferDismissed: true }),

      startEpilogue: async (characterId) => {
        await Promise.all([roster().load(), game().load()]).catch(() => undefined)
        const entry = roster().entries[characterId]
        if (!entry) return { ok: false, reason: 'missing' }
        const { settings, profile } = settingsOf()
        const rel = game().rel(characterId)
        if (!endingReady(rel, routeFor(entry.character, profile, settings.orientationMode))) return { ok: false, reason: 'not-ready' }
        const open = get().session
        if (open && open.status !== 'ended') {
          return { ok: false, reason: 'busy', characterId: open.record.characterIds[0] ?? '' }
        }
        // The slot is normally written when they first reach 100; a game from before it existed,
        // or a slot the player deleted, gets one now.
        await autosaveBeforeEpilogue(characterId)
        return begin(characterId, (world) => {
          const pick = selectEnding({
            characterId,
            characters: world.characters ?? { [characterId]: world.character },
            rels: { ...(world.rels ?? {}), [characterId]: world.rel },
            game: world.game ?? game().game ?? newGameState(now()),
            relations: world.setRelations ?? [],
            names: world.names,
          })
          return (engine.createEpilogue ?? createEpilogue)(world, { type: pick.type, ...(pick.group?.length ? { group: pick.group } : {}) })
        })
      },
    }
  })
}

export const useDate = createDateStore()
