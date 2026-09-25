// Pure helpers for the Character sets screen, mod import reports and pack export. No React.

import { BUNDLED_SET_IDS, RESERVED_SET_IDS } from '../../data/bundled'
import { HEAT_LEVELS } from '../../data/heat'
import type { ImportError, ImportResult } from '../../mods/pack'
import { firstName } from '../../engine/agreements'
import { joinAnd } from '../../engine/stages'
import { CUSTOM_SET_ID, type ImportOutcome, type PackReplacement } from '../../store/roster'
import type { Character, HeatLevel, RosterEntry, SetManifest, SetRelationKind } from '../../types'

export type SetSource = 'bundled' | 'imported' | 'custom'

export function setSource(setId: string, bundledIds: readonly string[]): SetSource {
  if (setId === CUSTOM_SET_ID) return 'custom'
  return bundledIds.includes(setId) ? 'bundled' : 'imported'
}

export function sourceLabel(source: SetSource): string {
  return source === 'bundled' ? 'Comes with crushLAB' : source === 'custom' ? 'Made or imported by you' : 'Imported pack'
}

/** "12 characters", "1 character". */
export function characterCount(n: number): string {
  return `${n} ${n === 1 ? 'character' : 'characters'}`
}

/** "2, Flirty", or "" when the set has no recommendation. */
export function heatText(heat: HeatLevel | undefined): string {
  if (heat == null) return ''
  const info = HEAT_LEVELS.find((h) => h.level === heat)
  return info ? `${heat}, ${info.name}` : String(heat)
}

const KIND_TEXT: Record<SetRelationKind, string> = {
  partner: 'partners',
  ex: 'exes',
  situationship: 'a situationship',
  friend: 'friends',
  rival: 'rivals',
  roommate: 'roommates',
  housemate: 'housemates',
  coworker: 'coworkers',
  bandmate: 'bandmates',
  neighbor: 'neighbors',
  family: 'family',
}

/** How a pair relates, as a plural phrase: "exes", "roommates", "a situationship". */
export function relationKindText(kind: SetRelationKind | string): string {
  return KIND_TEXT[kind as SetRelationKind] ?? String(kind)
}

export interface RelationLine {
  a: string
  b: string
  aName: string
  bName: string
  kind: SetRelationKind
  note: string
}

function nameOf(entries: Readonly<Record<string, RosterEntry>>, id: string): string {
  return entries[id]?.character.name.trim() || id
}

/**
 * The relationships a set adds: its manifest's, then partners declared only on its cards (custom
 * sets have no manifest notes). Each pair and kind once.
 */
export function setRelationLines(set: SetManifest, entries: Readonly<Record<string, RosterEntry>>): RelationLine[] {
  const out: RelationLine[] = []
  const has = (a: string, b: string, kind: string) =>
    out.some((r) => r.kind === kind && ((r.a === a && r.b === b) || (r.a === b && r.b === a)))
  for (const r of set.relationships ?? []) {
    if (!r.a || !r.b || has(r.a, r.b, r.kind)) continue
    out.push({ a: r.a, b: r.b, aName: nameOf(entries, r.a), bName: nameOf(entries, r.b), kind: r.kind, note: r.note ?? '' })
  }
  for (const id of set.characters) {
    const c = entries[id]?.character
    for (const p of c?.partners ?? []) {
      if (!set.characters.includes(p.characterId) || has(id, p.characterId, p.relation)) continue
      out.push({ a: id, b: p.characterId, aName: nameOf(entries, id), bName: nameOf(entries, p.characterId), kind: p.relation, note: '' })
    }
  }
  return out
}

/**
 * A character plus everyone they're partnered with in the same set, and theirs in turn, so an
 * exported pack passes validation (partners must be inside the pack). The character comes first.
 */
export function withPartners(id: string, entries: Readonly<Record<string, RosterEntry>>): Character[] {
  const start = entries[id]
  if (!start) return []
  const setId = start.setId
  const seen = new Set<string>([id])
  const queue = [id]
  const out: Character[] = []
  while (queue.length) {
    const cur = entries[queue.shift() as string]
    if (!cur) continue
    out.push(cur.character)
    for (const p of cur.character.partners ?? []) {
      const other = entries[p.characterId]
      if (other && other.setId === setId && !seen.has(p.characterId)) {
        seen.add(p.characterId)
        queue.push(p.characterId)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Import reports

export interface ImportReport {
  /** Everything imported cleanly. */
  ok: boolean
  title: string
  /** Where the characters went and what else happened. */
  summary: string
  saved: string[]
  errors: ImportError[]
}

function dedupeErrors(errors: readonly ImportError[]): ImportError[] {
  const seen = new Set<string>()
  return errors.filter((e) => {
    const key = `${e.file}|${e.characterId ?? ''}|${e.field ?? ''}|${e.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The age rule first: when a card is refused for it, that is the reason worth reading. */
function ageFirst(errors: ImportError[]): ImportError[] {
  const rank = (e: ImportError) => (e.field === 'age' ? 0 : 1)
  return errors.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e)
}

/** What to tell the player after importFile() and importPack(). nameOf turns an id into a name. */
export function importReport(
  result: ImportResult,
  outcome: ImportOutcome,
  setName: string | undefined,
  nameOf: (id: string) => string = (id) => id,
): ImportReport {
  const errors = ageFirst(dedupeErrors([...result.errors, ...outcome.errors]))
  const saved = outcome.saved
  // Characters offered: those saved plus those refused (a note about a saved card isn't a refusal).
  const refused = new Set(errors.map((e) => e.characterId).filter((id): id is string => !!id && !saved.includes(id)))
  const offered = saved.length + refused.size
  const where = setName ?? (outcome.setId === CUSTOM_SET_ID ? 'My characters' : outcome.setId ?? '')
  if (saved.length === 0) {
    return {
      ok: false,
      title: 'Nothing was imported',
      summary: errors.length ? 'The file was checked and these problems kept it out.' : "The file didn't hold any characters.",
      saved,
      errors,
    }
  }
  const count = characterCount(saved.length)
  const parts = [where ? `They're in ${where}, which is now in play.` : '']
  const removed = outcome.removed?.length ?? 0
  if (removed) parts.push(`${characterCount(removed)} from the earlier version of the pack left the roster.`)
  if (outcome.kept?.length) {
    parts.push(`Kept the earlier card for ${joinAnd(outcome.kept.map(nameOf))}, since the new one has problems.`)
  }
  const summary = parts.filter(Boolean).join(' ')
  if (errors.length === 0) {
    return { ok: true, title: `Imported ${count}`, summary, saved, errors }
  }
  const partial = offered > saved.length ? `Imported ${saved.length} of ${offered} characters` : `Imported ${count}`
  return {
    ok: false,
    title: partial,
    summary: `${summary} Some things were left out:`.trim(),
    saved,
    errors,
  }
}

/** What replacing the pack on this device does, in a sentence or three. */
export function replaceMessage(r: PackReplacement): string {
  const oldBy = r.oldAuthor ? ` by ${r.oldAuthor}` : ''
  const newBy = r.newAuthor ? ` by ${r.newAuthor}` : ''
  const same = r.oldName === r.newName && r.oldAuthor === r.newAuthor
  const parts = [
    same
      ? `This file is a new version of ${r.oldName || r.setId}${oldBy}, which is already on this device.`
      : `This file is ${r.newName || r.setId}${newBy}. It uses the same pack id as ${r.oldName || r.setId}${oldBy}, which is already on this device, so importing it replaces that pack.`,
  ]
  if (r.removes.length) {
    const names = joinAnd(r.removes.map((x) => x.name))
    parts.push(`${names} ${r.removes.length === 1 ? "isn't" : "aren't"} in the new file and will leave the roster.`)
  }
  parts.push("Progress with everyone is kept, and characters you made in the pack stay in it.")
  return parts.join(' ')
}

/** The remove-pack confirmation: who leaves, and which of the player's own characters move. */
export function removeMessage(packCharacters: number, own: readonly string[]): string {
  const parts = [
    `Its ${characterCount(packCharacters)} ${packCharacters === 1 ? 'leaves' : 'leave'} the roster and the editor. Your progress with them is kept, so importing the pack again picks up where you left off.`,
  ]
  if (own.length) {
    parts.push(
      `${joinAnd(own)}, who you made in this pack, ${own.length === 1 ? 'moves' : 'move'} to My characters, without partners from the pack.`,
    )
  }
  return parts.join(' ')
}

/** Where an import problem is: the character's id, or the file. */
export function errorWhere(e: ImportError): string {
  return e.characterId ? `${e.characterId} (${e.file})` : e.file
}

// ---------------------------------------------------------------------------
// Pack export

/** Set ids a pack can't use: they belong to crushLAB's own sets or to My characters. */
export const TAKEN_SET_IDS: readonly string[] = [...BUNDLED_SET_IDS, ...RESERVED_SET_IDS, CUSTOM_SET_ID]

export interface PackDraft {
  name: string
  id: string
  author: string
  blurb: string
  heat: HeatLevel | null
}

/** The manifest an export writes: the draft plus the characters and their relationships. */
export function packManifest(draft: PackDraft, characters: readonly Character[], relationships: SetManifest['relationships'] = []): SetManifest {
  const ids = characters.map((c) => c.id)
  const m: SetManifest = {
    id: draft.id.trim(),
    name: draft.name.trim(),
    blurb: draft.blurb.trim(),
    characters: ids,
    relationships: relationships.filter((r) => ids.includes(r.a) && ids.includes(r.b)),
  }
  if (draft.author.trim()) m.author = draft.author.trim()
  if (draft.heat != null) m.heat = draft.heat
  return m
}

// ---------------------------------------------------------------------------
// New game: "Who's in town" (docs/SPEC.md, Character sets: "New game, and Settings, Character
// sets, let the player turn sets on and off")

export interface NewGameSetRow {
  id: string
  name: string
  blurb: string
  /** "12 characters". */
  count: string
  on: boolean
  /** The last set in play can't be turned off here (the city would be empty). */
  locked: boolean
}

/** One row per set with characters in it, in the roster's order. */
export function newGameSetRows(
  sets: readonly SetManifest[],
  activeSets: readonly string[],
  memberCount: (setId: string) => number,
): NewGameSetRow[] {
  const rows = sets
    .map((s) => ({ set: s, n: memberCount(s.id) }))
    .filter(({ n }) => n > 0)
    .map(({ set, n }) => ({
      id: set.id,
      name: set.name,
      blurb: set.blurb,
      count: characterCount(n),
      on: activeSets.includes(set.id),
      locked: false,
    }))
  const onCount = rows.filter((r) => r.on).length
  return rows.map((r) => ({ ...r, locked: r.on && onCount === 1 }))
}

/**
 * The sets this one knows (its manifest's `knows`, and sets whose `knows` names it): "Knows the
 * people of Afterhours." Empty when it knows nobody outside itself.
 */
export function knowsLine(set: Pick<SetManifest, 'id' | 'knows'>, sets: readonly Pick<SetManifest, 'id' | 'name' | 'knows'>[]): string {
  const ids = new Set<string>(set.knows ?? [])
  for (const o of sets) if (o.id !== set.id && o.knows?.includes(set.id)) ids.add(o.id)
  ids.delete(set.id)
  const names = [...ids].map((id) => sets.find((s) => s.id === id)?.name ?? '').filter(Boolean)
  return names.length ? `Knows the people of ${joinAnd(names)}.` : ''
}

/**
 * A relationship that reaches a character in another set that is off: "Nova is in Afterhours,
 * which is off." Empty otherwise.
 */
export function offSetNote(
  r: Pick<RelationLine, 'a' | 'b' | 'aName' | 'bName'>,
  setId: string,
  entries: Readonly<Record<string, RosterEntry>>,
  sets: readonly Pick<SetManifest, 'id' | 'name'>[],
  activeSets: readonly string[],
): string {
  const notes: string[] = []
  for (const [id, name] of [
    [r.a, r.aName],
    [r.b, r.bName],
  ] as const) {
    const other = entries[id]?.setId
    if (!other || other === setId || activeSets.includes(other)) continue
    const setName = sets.find((s) => s.id === other)?.name ?? other
    notes.push(`${firstName(name)} is in ${setName}, which is off.`)
  }
  return notes.join(' ')
}
