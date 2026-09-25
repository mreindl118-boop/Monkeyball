// Pure helpers behind the character editor: the draft card, where each validation message goes,
// and the locked world rules. No React, no stores.

import { emptyCharacter, slugify } from '../../mods/normalize'
import { MIN_AGE, type ValidationIssue } from '../../mods/validate'
import type { Character, Trait } from '../../types'

/** The editor route id for a character that doesn't exist yet (never a valid character id). */
export const NEW_CHARACTER_ID = '_new'

export const AGE_MESSAGE = `Characters must be ${MIN_AGE} or older`

export const DEFAULT_ACCENT = '#E0245E'

export type TraitKey = 'likes' | 'dislikes' | 'turnOns' | 'turnOffs'
export type PlaceKey = 'favoriteVenues' | 'hatedVenues' | 'lovedGifts' | 'hatedGifts'

export const TRAIT_SECTIONS: readonly { key: TraitKey; title: string; one: string }[] = [
  { key: 'likes', title: 'Likes', one: 'like' },
  { key: 'dislikes', title: 'Dislikes', one: 'dislike' },
  { key: 'turnOns', title: 'Turn-ons', one: 'turn-on' },
  { key: 'turnOffs', title: 'Turn-offs', one: 'turn-off' },
]

/** The opposite list: a venue can't be both favorite and hated, a gift both loved and hated. */
export const OPPOSITE: Record<PlaceKey, PlaceKey> = {
  favoriteVenues: 'hatedVenues',
  hatedVenues: 'favoriteVenues',
  lovedGifts: 'hatedGifts',
  hatedGifts: 'lovedGifts',
}

// ---------------------------------------------------------------------------
// Drafts

/** A blank card for a new character: one empty row in each trait list, tiers laid out. */
export function newDraft(): Character {
  const c = emptyCharacter('')
  const blank = (): Trait => ({ id: '', label: '' })
  return {
    ...c,
    accent: DEFAULT_ACCENT,
    difficulty: 'normal',
    likes: [blank()],
    dislikes: [blank()],
    turnOns: [blank()],
    turnOffs: [blank()],
  }
}

/** A working copy of a card, with the gallery laid out as tiers 1 to 5 in order. */
export function draftOf(c: Character): Character {
  const copy = structuredClone(c)
  const base = emptyCharacter('').gallery
  copy.gallery = base.map((slot) => {
    const found = (c.gallery ?? []).find((t) => t.tier === slot.tier)
    return found ? { ...found, unlockAt: slot.unlockAt } : slot
  })
  return copy
}

function trimOpt(v: string | undefined): string | undefined {
  const t = v?.trim()
  return t ? t : undefined
}

/**
 * The card as it will be saved: text trimmed, empty optional fields dropped, the ace spectrum
 * only when it has something in it.
 */
export function cleanDraft(d: Character): Character {
  const trait = (t: Trait): Trait => ({ id: t.id.trim(), label: t.label.trim() })
  const out: Character = {
    ...d,
    id: d.id.trim(),
    name: d.name.trim(),
    pronouns: d.pronouns.trim(),
    occupation: d.occupation.trim(),
    accent: d.accent.trim(),
    look: d.look.trim(),
    artTags: d.artTags.trim(),
    personality: d.personality.trim(),
    voice: d.voice.trim(),
    backstory: d.backstory.trim(),
    opener: d.opener.trim(),
    likes: d.likes.map(trait),
    dislikes: d.dislikes.map(trait),
    turnOns: d.turnOns.map(trait),
    turnOffs: d.turnOffs.map(trait),
    secrets: d.secrets.map((s) => ({ unlockAt: s.unlockAt, text: s.text.trim() })),
    gallery: d.gallery.map((t) => ({ ...t, title: t.title.trim(), scene: t.scene.trim() })),
  }
  const optional = ['identity', 'orientation', 'bodyNotes'] as const
  for (const k of optional) {
    const v = trimOpt(d[k])
    if (v) out[k] = v
    else delete out[k]
  }
  if (d.aceSpectrum) {
    const ace = { ...d.aceSpectrum, label: d.aceSpectrum.label.trim() }
    if (ace.heatCap == null) delete ace.heatCap
    if (ace.heatUnlockTrust == null || Number.isNaN(ace.heatUnlockTrust)) delete ace.heatUnlockTrust
    out.aceSpectrum = ace
  } else {
    delete out.aceSpectrum
  }
  if (d.partners?.length) out.partners = d.partners.map((p) => ({ ...p }))
  else delete out.partners
  return out
}

/**
 * A trait row after its label changes: while the id is empty or still the slug of the old label,
 * it follows the new label. Ids in `locked` (the ones a saved card already had) never move:
 * discovered traits are stored by id, so changing one would lose the player's progress.
 */
export function withLabel(t: Trait, label: string, locked?: ReadonlySet<string>): Trait {
  const auto = !t.id || (t.id === slugify(t.label) && !locked?.has(t.id))
  return { id: auto ? slugify(label) : t.id, label }
}

/** Trait ids a saved card already has (empty for a new character). */
export function savedTraitIds(c: Pick<Character, TraitKey> | null): ReadonlySet<string> {
  if (!c) return new Set()
  return new Set(TRAIT_SECTIONS.flatMap((s) => (c[s.key] ?? []).map((t) => t.id)).filter(Boolean))
}

/** Add or remove an id, keeping the order things were picked in (the first favorite matters). */
export function toggleIn(list: readonly string[], id: string, on: boolean): string[] {
  if (on) return list.includes(id) ? [...list] : [...list, id]
  return list.filter((x) => x !== id)
}

/** Age text from the number input: a whole number, or NaN when blank or not a number. */
export function parseAge(text: string): number {
  const t = text.trim()
  if (!t) return Number.NaN
  const n = Number(t)
  return Number.isFinite(n) ? n : Number.NaN
}

/** An optional number field: undefined when blank. */
export function parseOptionalNumber(text: string): number | undefined {
  const t = text.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : Number.NaN
}

// ---------------------------------------------------------------------------
// Validation messages

/** The validator's issues, with the age rule in the editor's own words. */
export function editorIssues(issues: readonly ValidationIssue[], age: number): ValidationIssue[] {
  return issues.map((i) =>
    i.field === 'age' && Number.isFinite(age) && age < MIN_AGE ? { field: 'age', message: `${AGE_MESSAGE}.` } : i,
  )
}

/** Top-level fields in the order the form shows them. */
const FORM_ORDER = [
  'setId',
  'name',
  'id',
  'age',
  'pronouns',
  'gender',
  'identity',
  'occupation',
  'attractedTo',
  'orientation',
  'relationshipStyle',
  'jealousy',
  'aceSpectrum',
  'difficulty',
  'accent',
  'look',
  'artTags',
  'bodyNotes',
  'personality',
  'voice',
  'backstory',
  'opener',
  'likes',
  'dislikes',
  'turnOns',
  'turnOffs',
  'favoriteVenues',
  'hatedVenues',
  'lovedGifts',
  'hatedGifts',
  'secrets',
  'gallery',
  'partners',
  'endings',
  'prompts',
]

function orderOf(field: string): [number, number] {
  const root = /^[A-Za-z]+/.exec(field)?.[0] ?? field
  const i = FORM_ORDER.indexOf(root)
  const row = Number(/\[(\d+)\]/.exec(field)?.[1] ?? -1)
  return [i < 0 ? FORM_ORDER.length : i, row]
}

/** Issues in the order their fields appear on the form (stable within a field). */
export function inFormOrder(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues
    .map((issue, n) => ({ issue, n, key: orderOf(issue.field) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.n - b.n)
    .map((x) => x.issue)
}

const SCALAR_LISTS = /^(favoriteVenues|hatedVenues|lovedGifts|hatedGifts|attractedTo)\[\d+\]$/

/**
 * The form control a validation message belongs to, as an element id: "likes[2].id" is the id
 * box of the third like; a venue list's entries all point at the list. Empty for fields the
 * editor doesn't show (endings, prompt overrides); those appear in the summary only.
 */
export function anchorFor(field: string): string {
  let f = field
  if (SCALAR_LISTS.test(f)) f = f.replace(/\[\d+\]$/, '')
  const tierMeta = /^gallery\[(\d+)\]\.(tier|unlockAt)$/.exec(f)
  if (tierMeta) f = `gallery[${tierMeta[1]}].title`
  if (/^(endings|prompts)(\.|$)/.test(f)) return ''
  return `ed-${f.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '')}`
}

/** Messages grouped by the control they belong to. */
export function issuesByAnchor(issues: readonly ValidationIssue[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const i of issues) {
    const a = anchorFor(i.field)
    if (!a) continue
    const list = map.get(a) ?? []
    if (!list.includes(i.message)) list.push(i.message)
    map.set(a, list)
  }
  return map
}

const LABELS: Record<string, string> = {
  id: 'Id',
  name: 'Name',
  age: 'Age',
  gender: 'Gender',
  pronouns: 'Pronouns',
  identity: 'Identity',
  orientation: 'Orientation',
  attractedTo: 'Attracted to',
  relationshipStyle: 'Relationship style',
  jealousy: 'Jealousy',
  'aceSpectrum.label': 'Ace spectrum',
  'aceSpectrum.heatCap': 'Heat cap',
  'aceSpectrum.heatUnlockTrust': 'Trust before heat 3',
  difficulty: 'Difficulty',
  accent: 'Accent color',
  occupation: 'Occupation',
  look: 'Look',
  artTags: 'Art tags',
  bodyNotes: 'Body notes',
  personality: 'Personality',
  voice: 'Voice',
  backstory: 'Backstory',
  opener: 'Opener',
  likes: 'Likes',
  dislikes: 'Dislikes',
  turnOns: 'Turn-ons',
  turnOffs: 'Turn-offs',
  favoriteVenues: 'Favorite venues',
  hatedVenues: 'Hated venues',
  lovedGifts: 'Loved gifts',
  hatedGifts: 'Hated gifts',
  secrets: 'Secrets',
  gallery: 'Gallery',
  partners: 'Partners',
  setId: 'Set',
}

const ROW_LABELS: Record<string, string> = {
  likes: 'Like',
  dislikes: 'Dislike',
  turnOns: 'Turn-on',
  turnOffs: 'Turn-off',
  secrets: 'Secret',
  partners: 'Partner',
}

/** A short name for a field path, for the summary: "Like 3 id", "Tier 2 scene", "Partner 1". */
export function fieldLabel(field: string): string {
  if (LABELS[field]) return LABELS[field]
  const m = /^(\w+)\[(\d+)\](?:\.(\w+))?$/.exec(field)
  if (m) {
    const [, key, index, sub] = m
    const n = Number(index) + 1
    if (key === 'gallery') {
      return sub === 'scene' ? `Tier ${n} scene` : `Tier ${n} title`
    }
    if (ROW_LABELS[key]) {
      const row = `${ROW_LABELS[key]} ${n}`
      if (!sub || sub === 'label' || sub === 'text' || sub === 'characterId') return row
      if (sub === 'id') return `${row} id`
      if (sub === 'unlockAt') return `${row} unlock`
      if (sub === 'relation') return `${row} relation`
      return row
    }
    if (LABELS[key]) return LABELS[key]
  }
  if (field.startsWith('endings')) return 'Endings'
  if (field.startsWith('prompts')) return 'Prompt overrides'
  return field
}

// ---------------------------------------------------------------------------
// World rules

/**
 * The WORLD RULES block of the story engine prompt, one rule per line, with {name} filled in.
 * Read from the template itself, so what the editor shows is exactly what every prompt carries.
 */
export function worldRules(template: string, name: string): string[] {
  const lines = template.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === 'WORLD RULES')
  if (start < 0) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) break
    out.push(line.replace(/^-\s*/, '').replaceAll('{name}', name))
  }
  return out
}
