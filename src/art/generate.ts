// Generated art and the player's own images (docs/SPEC.md, "Art and gallery"; ARCHITECTURE, Art).
//
// - generateArt paints a slot once and caches it (the images table, the slot key plus
//   '#generated'); a second call finds the cached picture and doesn't call the provider. Every
//   painting logs a debug entry of kind 'image' with the assembled prompt and negative prompt.
// - Regenerate is generateCandidate then acceptCandidate: the current picture stays until the new
//   one is accepted (a fresh seed, so a fixed-seed server doesn't paint the same picture again).
// - importImage stores the player's own picture under the slot key: it wins over everything.
// - onUnlock / onEnding: fire-and-forget painting when a tier or an ending unlocks, only with image
//   generation on and set up, and only for slots with no imported or bundled art (or a cached
//   picture). Background jobs run one at a time and never block the date; the same slot is never
//   painted twice at once. Failures are recorded (useArtJob) and logged, never thrown.
// - useArtJob says a slot is on its way from the moment onUnlock or onEnding is called (queued,
//   then painting), so the recap's print waits for it; a group's Polycule picture shows as painting
//   on each member's Polycule ending too.
// - The prompt follows the player's route with each character (the friend route is platonic, at
//   heat 1) and states the player's adult age when the scene shows them (imagePrompt.ts).

import { create } from 'zustand'
import { BUNDLED_CHARACTERS } from '../data/bundled'
import { routeFor } from '../engine/stages'
import { useDebug, type DebugInput } from '../store/debug'
import { useGame } from '../store/game'
import { useRoster } from '../store/roster'
import { useSettings } from '../store/settings'
import type { Character, EndingType, PlayerProfile, Route, Settings, StoredImage, TierNumber } from '../types'
import { compressImage, makeThumbnail } from './compress'
import { buildImagePrompt, friendPicture, imageHeat, randomSeed, sceneFor, type ImagePrompt } from './imagePrompt'
import { apiKeyFor, ArtError, providerFor, sniffImageType, type ArtProvider } from './providers'
import { artResolver, emitArtChange, type ArtResolver } from './resolve'
import { generatedKey, polyculeSlot, slotCharacterIds, slotKey, storedCharacterId, type ArtSlot } from './types'

export { unlockedSlots, FRIENDSHIP_LOCKED, type GallerySlot, type UnlockedSlotsOptions } from './slots'

// ---------------------------------------------------------------------------
// Job status, for spinners and messages

export interface ArtJob {
  /** True from the moment the slot is asked for in the background until its painting ends. */
  generating: boolean
  /** Optional: waiting its turn behind another painting (or still being looked up). */
  queued?: boolean
  /** The last failure's message ("The image service declined this prompt. ..."). */
  error?: string
}

interface ArtJobsState {
  jobs: Record<string, ArtJob>
}

/** Painting in progress and the last failure, per slot key. */
export const useArtJobs = create<ArtJobsState>(() => ({ jobs: {} }))

/**
 * The keys a slot's job shows under: the slot's own, and for a group's Polycule picture each
 * member's Polycule ending (their ending shows the group's picture), like emitArtChange.
 */
export function jobKeysFor(...slots: readonly ArtSlot[]): string[] {
  const keys = new Set<string>()
  for (const slot of slots) {
    keys.add(slotKey(slot))
    if (slot.kind === 'group' && slot.slot === 'polycule') {
      for (const id of slot.characterIds) keys.add(`${id}:ending-polycule`)
    }
  }
  return [...keys]
}

function setJob(keys: readonly string[], job: ArtJob | null): void {
  const jobs = { ...useArtJobs.getState().jobs }
  for (const k of keys) {
    if (job) jobs[k] = job
    else delete jobs[k]
  }
  useArtJobs.setState({ jobs })
}

/** Mark keys queued, unless a painting or a failure already shows there. */
function markQueued(keys: readonly string[]): void {
  const current = useArtJobs.getState().jobs
  const fresh = keys.filter((k) => !current[k]?.generating)
  if (fresh.length) setJob(fresh, { generating: true, queued: true })
}

/** Clear keys still marked queued (a job that turned out not to be needed, or that finished). */
function clearQueued(keys: readonly string[]): void {
  const current = useArtJobs.getState().jobs
  const stale = keys.filter((k) => current[k]?.queued)
  if (stale.length) setJob(stale, null)
}

const IDLE: ArtJob = { generating: false }

/** Whether a slot is being painted right now, and the last failure for it. */
export function useArtJob(slot: ArtSlot | null): ArtJob {
  const key = slot ? slotKey(slot) : ''
  return useArtJobs((s) => (key ? s.jobs[key] : undefined) ?? IDLE)
}

// ---------------------------------------------------------------------------
// Image handling

/** How long a background painting may take before it's given up (a hung server can't block the queue). */
export const BACKGROUND_TIMEOUT_MS = 6 * 60_000

/** Largest image the player can import. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024

export { compressImage, MAX_SIDE, THUMB_SIDE } from './compress'

// ---------------------------------------------------------------------------
// The engine

export interface ArtEngineDeps {
  resolver?: () => ArtResolver
  settings?: () => Settings
  /** A character by id (default: the roster, then the bundled sets). */
  character?: (id: string) => Character | undefined
  /** Trust with a character (default: the game store). */
  trust?: (id: string) => number
  /** The player's route with a character (default: routeFor with the profile and the orientation mode). */
  route?: (character: Character, settings: Settings) => Route
  /** The player's profile, for the locked statement about them (default: the settings store's). */
  player?: () => PlayerProfile | null
  provider?: (settings: Settings) => ArtProvider | null
  log?: (entry: DebugInput) => string
  patchLog?: (id: string, patch: { response?: string; error?: string }) => void
  now?: () => number
  /** How a painted or imported picture is stored (default compressImage). */
  compress?: (blob: Blob) => Promise<Blob>
  /** Its thumbnail for tiles and coasters (default makeThumbnail); undefined when none is needed. */
  thumbnail?: (blob: Blob) => Promise<Blob | undefined>
}

export interface Candidate {
  blob: Blob
  prompt: string
  seed: number
  /** Optional: Grok Imagine's rewrite of the prompt. */
  revisedPrompt?: string
}

export interface AssembledPrompt extends ImagePrompt {
  provider: ArtProvider['id']
  /** The heat the picture is painted at (after ace caps, trust gates and the friend route). */
  heat: number
  /** Optional: true when the friend route made the picture platonic. */
  friend?: boolean
}

export interface ArtEngine {
  generateArt: (slot: ArtSlot, opts?: { replace?: boolean; signal?: AbortSignal }) => Promise<StoredImage | null>
  generateCandidate: (slot: ArtSlot, signal?: AbortSignal) => Promise<Candidate>
  acceptCandidate: (slot: ArtSlot, c: Candidate) => Promise<void>
  importImage: (slot: ArtSlot, file: Blob) => Promise<void>
  removeImported: (slot: ArtSlot) => Promise<void>
  setFavorite: (slot: ArtSlot, on: boolean) => Promise<void>
  onUnlock: (characterId: string, tiers: TierNumber[]) => void
  onEnding: (characterId: string, ending: EndingType, group?: readonly string[]) => void
  assembleArtPrompt: (slot: ArtSlot, opts?: { log?: boolean }) => Promise<AssembledPrompt>
  /** Resolves when every background job queued so far has finished (tests). */
  idle: () => Promise<void>
}

const bundledById = new Map(BUNDLED_CHARACTERS.map((e) => [e.character.id, e.character]))

function defaultCharacter(id: string): Character | undefined {
  return useRoster.getState().entries[id]?.character ?? bundledById.get(id)
}

function defaultPlayer(): PlayerProfile | null {
  return useSettings.getState().profile ?? null
}

function defaultTrust(id: string): number {
  const t = useGame.getState().relationships[id]?.trust
  return typeof t === 'number' ? t : 0
}

function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError'
}

function messageOf(e: unknown): string {
  if (e && typeof e === 'object' && (e as { name?: unknown }).name === 'TimeoutError') {
    return 'The image server took too long, so the painting was given up. Try again from the gallery.'
  }
  return e instanceof Error ? e.message : String(e)
}

/** A signal that fires after `ms` with a TimeoutError. */
function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('The painting timed out.', 'TimeoutError')), ms)
  return { signal: ctrl.signal, done: () => clearTimeout(timer) }
}

/** The debug panel's text for a painting: provider, heat, prompt and negative prompt. */
export function artPromptText(p: AssembledPrompt, settings: Pick<Settings, 'heat' | 'image'>): string {
  const who = p.provider === 'grok' ? `Grok Imagine (${settings.image.grokModel || 'grok-imagine-image'}, ${settings.image.aspectRatio || '2:3'})` : `Automatic1111/Forge (${settings.image.baseUrl})`
  const heat = p.friend
    ? `Heat ${settings.heat}, painted at 1 (friend route, platonic)`
    : p.heat === settings.heat
      ? `Heat ${settings.heat}`
      : `Heat ${settings.heat}, painted at ${p.heat} (their pace)`
  const negative =
    p.provider === 'grok'
      ? 'Grok Imagine has no negative prompt: the safety clause is at the start and the end of the prompt.'
      : p.negative
  return `Provider: ${who}\n${heat}\nSeed: ${p.seed}\n\nPrompt:\n${p.prompt}\n\nNegative prompt:\n${negative}`
}

export function createArtEngine(deps: ArtEngineDeps = {}): ArtEngine {
  const resolver = deps.resolver ?? artResolver
  const settingsOf = deps.settings ?? (() => useSettings.getState().settings)
  const characterOf = deps.character ?? defaultCharacter
  const trustOf = deps.trust ?? defaultTrust
  const playerOf = deps.player ?? defaultPlayer
  const routeOf = deps.route ?? ((c: Character, settings: Settings) => routeFor(c, playerOf(), settings.orientationMode))
  const providerOf = deps.provider ?? providerFor
  const log = deps.log ?? ((e: DebugInput) => useDebug.getState().log(e))
  const patchLog = deps.patchLog ?? ((id: string, patch: { response?: string; error?: string }) => useDebug.getState().patch(id, patch))
  const now = deps.now ?? Date.now
  const compress = deps.compress ?? compressImage
  const thumbnail = deps.thumbnail ?? makeThumbnail
  /** The picture's thumbnail, when one is worth keeping (never in the way of storing it). */
  const thumbOf = async (blob: Blob): Promise<{ thumb?: Blob }> => {
    try {
      const thumb = await thumbnail(blob)
      return thumb ? { thumb } : {}
    } catch {
      return {}
    }
  }

  /** Paintings in flight, by canonical slot key. */
  const inflight = new Map<string, Promise<StoredImage | null>>()
  /** Background jobs queued and not started, by canonical slot key. */
  const queued = new Set<string>()
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = (fn: () => Promise<unknown>): Promise<unknown> => {
    const run = tail.then(fn, fn)
    tail = run.catch(() => undefined)
    return tail
  }

  const participants = (slot: ArtSlot): Character[] => {
    const ids = slotCharacterIds(slot)
    const characters = ids.map((id) => characterOf(id))
    const missing = ids.filter((_, i) => !characters[i])
    if (missing.length) {
      throw new Error(`${missing.join(', ')} isn't in the roster, so there's nobody to paint.`)
    }
    return characters as Character[]
  }

  const assemble = (slot: ArtSlot, settings: Settings, provider: ArtProvider['id'], seed?: number): AssembledPrompt => {
    const characters = participants(slot)
    const trust: Record<string, number> = {}
    const route: Record<string, Route> = {}
    for (const c of characters) {
      trust[c.id] = trustOf(c.id)
      route[c.id] = routeOf(c, settings)
    }
    const input = {
      slot,
      characters,
      heat: settings.heat,
      settings: { ...settings.image, provider },
      scene: sceneFor(slot, characters),
      trust,
      route,
      player: playerOf(),
      ...(seed !== undefined ? { seed } : {}),
    }
    return { ...buildImagePrompt(input), provider, heat: imageHeat(input), ...(friendPicture(input) ? { friend: true } : {}) }
  }

  /** Build, log and paint. Returns the stored-to-be picture. */
  const paint = async (slot: ArtSlot, settings: Settings, provider: ArtProvider, signal?: AbortSignal, seed?: number): Promise<Candidate> => {
    const ids = slotCharacterIds(slot)
    let built: AssembledPrompt
    try {
      built = assemble(slot, settings, provider.id, seed)
    } catch (e) {
      // Nobody without an adult age is painted, and nobody missing from the roster: say so in the panel.
      const id = log({ kind: 'image', ...(ids.length === 1 ? { characterId: ids[0] } : {}), prompt: `No prompt for ${slotKey(slot)}.` })
      patchLog(id, { error: messageOf(e) })
      throw e
    }
    const logId = log({
      kind: 'image',
      ...(ids.length === 1 ? { characterId: ids[0] } : {}),
      prompt: artPromptText(built, settings),
    })
    try {
      const apiKey = apiKeyFor(settings)
      const res = await provider.generate(
        { prompt: built.prompt, negative: built.negative, seed: built.seed, settings: settings.image, ...(apiKey ? { apiKey } : {}) },
        signal,
      )
      const blob = await compress(res.blob)
      const revised = res.revisedPrompt?.trim()
      patchLog(logId, {
        response:
          `Painted ${slotKey(slot)}: ${blob.type || 'image'}, ${Math.round(blob.size / 1024)} KB, seed ${res.seed}.` +
          (revised ? `\n\nxAI rewrote the prompt and painted from:\n${revised}` : ''),
      })
      return { blob, prompt: built.prompt, seed: res.seed, ...(revised ? { revisedPrompt: revised } : {}) }
    } catch (e) {
      patchLog(logId, { error: isAbort(e) ? 'Stopped.' : messageOf(e) })
      throw e
    }
  }

  const store = async (slot: ArtSlot, c: Candidate): Promise<StoredImage> => {
    const row: StoredImage = {
      key: generatedKey(slot),
      characterId: storedCharacterId(slot),
      source: 'generated',
      blob: c.blob,
      ...(await thumbOf(c.blob)),
      prompt: c.prompt,
      ...(c.revisedPrompt ? { revisedPrompt: c.revisedPrompt } : {}),
      seed: c.seed,
      createdAt: now(),
    }
    await resolver().db.images.put(row)
    return row
  }

  const needsProvider = (settings: Settings): ArtProvider => {
    const p = providerOf(settings)
    if (p) return p
    throw new ArtError(
      settings.image?.provider === 'grok' ? 'grok' : 'a1111',
      'setup',
      settings.image?.enabled ? 'Image generation isn\'t set up yet.' : 'Image generation is off.',
      settings.image?.provider === 'grok'
        ? 'Turn on Generate art in Settings, Images, and add your xAI key on the Grok card.'
        : 'Turn on Generate art in Settings, Images, and add your image server\'s address.',
    )
  }

  const generateArt: ArtEngine['generateArt'] = async (slot, opts = {}) => {
    const settings = settingsOf()
    const provider = providerOf(settings)
    if (!provider) return null
    const canonical = await resolver().canonicalSlot(slot)
    const key = slotKey(canonical)
    // No await between this check and inflight.set: callers asking at once share one painting.
    const running = inflight.get(key)
    if (running) return running
    const jobKeys = jobKeysFor(canonical, slot)
    const job = (async (): Promise<StoredImage | null> => {
      if (!opts.replace) {
        const cached = await resolver().generatedImage(canonical)
        if (cached) return cached
      }
      setJob(jobKeys, { generating: true })
      try {
        const c = await paint(canonical, settings, provider, opts.signal)
        const row = await store(canonical, c)
        setJob(jobKeys, null)
        emitArtChange([canonical, slot])
        return row
      } catch (e) {
        setJob(jobKeys, isAbort(e) ? null : { generating: false, error: messageOf(e) })
        throw e
      }
    })()
    inflight.set(key, job)
    const clear = () => {
      if (inflight.get(key) === job) inflight.delete(key)
    }
    job.then(clear, clear)
    return job
  }

  /** Candidates in flight, by canonical slot key: a double tap on Regenerate pays once. */
  const candidates = new Map<string, Promise<Candidate>>()

  const generateCandidate: ArtEngine['generateCandidate'] = async (slot, signal) => {
    const settings = settingsOf()
    const provider = needsProvider(settings)
    const canonical = await resolver().canonicalSlot(slot)
    const key = slotKey(canonical)
    const running = candidates.get(key)
    if (running) return running
    const jobKeys = jobKeysFor(canonical, slot)
    const job = (async () => {
      setJob(jobKeys, { generating: true })
      try {
        const c = await paint(canonical, settings, provider, signal, randomSeed())
        setJob(jobKeys, null)
        return c
      } catch (e) {
        setJob(jobKeys, isAbort(e) ? null : { generating: false, error: messageOf(e) })
        throw e
      }
    })()
    candidates.set(key, job)
    const clear = () => {
      if (candidates.get(key) === job) candidates.delete(key)
    }
    job.then(clear, clear)
    return job
  }

  const acceptCandidate: ArtEngine['acceptCandidate'] = async (slot, c) => {
    const canonical = await resolver().canonicalSlot(slot)
    await store(canonical, c)
    emitArtChange([canonical, slot])
  }

  const importImage: ArtEngine['importImage'] = async (slot, file) => {
    if (!(file instanceof Blob) || file.size === 0) throw new Error('That file is empty.')
    if (file.size > MAX_IMPORT_BYTES) throw new Error('That picture is over 20 MB. Pick a smaller one.')
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    const type = sniffImageType(head)
    if (!type) throw new Error("That file isn't a picture crushLAB can show. Use a PNG, JPEG, WebP or GIF.")
    const typed = file.type === type ? file : new Blob([file], { type })
    const blob = await compress(typed)
    const canonical = await resolver().canonicalSlot(slot)
    const row: StoredImage = {
      key: slotKey(canonical),
      characterId: storedCharacterId(canonical),
      source: 'imported',
      blob,
      ...(await thumbOf(blob)),
      createdAt: now(),
    }
    await resolver().db.images.put(row)
    emitArtChange([canonical, slot])
  }

  const removeImported: ArtEngine['removeImported'] = async (slot) => {
    const canonical = await resolver().canonicalSlot(slot)
    const d = resolver().db
    for (const s of [canonical, slot]) {
      const row = await d.images.get(slotKey(s))
      if (row?.source === 'imported') await d.images.delete(slotKey(s))
    }
    emitArtChange([canonical, slot])
  }

  const setFavorite: ArtEngine['setFavorite'] = async (slot, on) => {
    await resolver().setFavorite(slot, on)
    emitArtChange([slot])
  }

  /** Paint in the background when nothing else shows for the slot. Never throws. */
  /** Background work not yet queued or finished (idle() waits for it). */
  let busy = 0
  const background = (fn: () => Promise<void>): void => {
    busy++
    void fn()
      .catch(() => undefined)
      .finally(() => {
        busy--
      })
  }

  /**
   * Paint a slot in the background when nothing else shows for it. Its keys show as queued at once
   * (the recap's print waits), until the job paints it or finds it doesn't need to.
   */
  const ensure = (slot: ArtSlot): void => {
    const marked = jobKeysFor(slot)
    markQueued(marked)
    background(async () => {
      const r = resolver()
      let keys = marked
      try {
        const canonical = await r.canonicalSlot(slot)
        const key = slotKey(canonical)
        keys = jobKeysFor(canonical, slot)
        markQueued(keys)
        const running = inflight.get(key)
        if (running) {
          // Painting already: its keys cover these; clear what's left marked when it ends.
          await running.catch(() => undefined)
          clearQueued(keys)
          return
        }
        // Queued already: that job clears these keys too (the same canonical slot).
        if (queued.has(key)) return
        queued.add(key)
        await enqueue(async () => {
          queued.delete(key)
          try {
            const settings = settingsOf()
            if (!providerOf(settings)) return
            if (await r.importedImage(slot)) return
            if (r.bundledPath(slot) || r.bundledPath(canonical)) return
            if (await r.generatedImage(canonical)) return
            const t = timeoutSignal(BACKGROUND_TIMEOUT_MS)
            try {
              await generateArt(canonical, { signal: t.signal })
            } finally {
              t.done()
            }
          } catch {
            // Recorded on the job and in the debug log.
          } finally {
            clearQueued(keys)
          }
        })
      } catch {
        clearQueued(keys)
      }
    })
  }

  const onUnlock: ArtEngine['onUnlock'] = (characterId, tiers) => {
    try {
      if (!providerOf(settingsOf())) return
      for (const tier of [...new Set(tiers)].sort()) ensure({ kind: 'tier', characterId, tier })
    } catch {
      // Never in the date's way.
    }
  }

  const onEnding: ArtEngine['onEnding'] = (characterId, ending, group) => {
    const members = ending === 'polycule' && group ? [characterId, ...group] : []
    const shared = polyculeSlot(members)
    const own: ArtSlot = { kind: 'ending', characterId, ending }
    let painting = false
    try {
      painting = !!providerOf(settingsOf())
      // The recap opens right after this: its print waits for the picture from now on.
      if (painting) markQueued(jobKeysFor(shared ?? own, own))
    } catch {
      painting = false
    }
    background(async () => {
      try {
        if (shared) {
          await resolver().setPolyculeGroup(members)
          emitArtChange([shared])
        }
        if (painting && providerOf(settingsOf())) ensure(shared ?? own)
        else clearQueued(jobKeysFor(shared ?? own, own))
      } catch {
        clearQueued(jobKeysFor(shared ?? own, own))
      }
    })
  }

  const assembleArtPrompt: ArtEngine['assembleArtPrompt'] = async (slot, opts = {}) => {
    const settings = settingsOf()
    const canonical = await resolver().canonicalSlot(slot)
    const provider = settings.image?.provider === 'grok' ? 'grok' : 'a1111'
    const built = assemble(canonical, settings, provider)
    if (opts.log) {
      const ids = slotCharacterIds(canonical)
      const id = log({ kind: 'image', ...(ids.length === 1 ? { characterId: ids[0] } : {}), prompt: artPromptText(built, settings) })
      patchLog(id, { response: 'Assembled only; nothing was sent.' })
    }
    return built
  }

  return {
    generateArt,
    generateCandidate,
    acceptCandidate,
    importImage,
    removeImported,
    setFavorite,
    onUnlock,
    onEnding,
    assembleArtPrompt,
    idle: async () => {
      // Jobs can start more jobs (an ending's group, then its painting): wait until none are left.
      do {
        await tail
        await new Promise((r) => setTimeout(r, 1))
      } while (busy > 0)
      await tail
    },
  }
}

// ---------------------------------------------------------------------------
// The app's engine

let appEngine: ArtEngine | null = null

function engine(): ArtEngine {
  appEngine ??= createArtEngine()
  return appEngine
}

/** Tests: use this engine for the module functions below (null goes back to the app's). */
export function setArtEngine(e: ArtEngine | null): void {
  appEngine = e
}

/**
 * Paint a slot and cache it; a cached picture comes back without calling the provider unless
 * `replace`. Null when image generation is off or not set up. Throws the provider's ArtError.
 */
export function generateArt(slot: ArtSlot, opts?: { replace?: boolean; signal?: AbortSignal }): Promise<StoredImage | null> {
  return engine().generateArt(slot, opts)
}

/** Regenerate, first half: a new picture (fresh seed) that isn't saved until acceptCandidate. */
export function generateCandidate(slot: ArtSlot, signal?: AbortSignal): Promise<Candidate> {
  return engine().generateCandidate(slot, signal)
}

/** Regenerate, second half: the candidate replaces the slot's generated picture. */
export function acceptCandidate(slot: ArtSlot, c: Candidate): Promise<void> {
  return engine().acceptCandidate(slot, c)
}

/** The player's own picture for a slot (PNG, JPEG, WebP or GIF, up to 20 MB): wins over everything. */
export function importImage(slot: ArtSlot, file: Blob): Promise<void> {
  return engine().importImage(slot, file)
}

/** Remove the player's picture: the slot falls back to bundled, generated or the placeholder. */
export function removeImported(slot: ArtSlot): Promise<void> {
  return engine().removeImported(slot)
}

export function setFavorite(slot: ArtSlot, on: boolean): Promise<void> {
  return engine().setFavorite(slot, on)
}

/**
 * Tiers just unlocked (each exactly once, by the engine): paint them in the background when image
 * generation is on and they have no imported or bundled art. Returns at once; never throws.
 */
export function onUnlock(characterId: string, tiers: TierNumber[]): void {
  engine().onUnlock(characterId, tiers)
}

/**
 * An ending just played: remember a Polycule's members (their endings show the group's picture)
 * and paint the ending in the background like onUnlock. Returns at once; never throws.
 */
export function onEnding(characterId: string, ending: EndingType, group?: readonly string[]): void {
  engine().onEnding(characterId, ending, group)
}

/**
 * The prompt a slot would be painted with right now (heat, ace caps, style, provider), without
 * painting. `log` also puts it in the debug panel.
 */
export function assembleArtPrompt(slot: ArtSlot, opts?: { log?: boolean }): Promise<AssembledPrompt> {
  return engine().assembleArtPrompt(slot, opts)
}
