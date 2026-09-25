// Turns loosely written character and manifest JSON into the shapes in src/types.ts.
//
// Lenient on form, never on substance: plural or variant gender words ("women", "enby"), missing
// optional arrays, numbers written as strings, a trait written as a plain string, snake_case keys
// and a few aliases are accepted. Values that can't be understood are passed through as they are
// (or left empty) so validateCharacter() can say what's wrong; nothing here invents character
// content. Never throws.

import { normalizeGender } from '../engine/stages'
import type {
  AceSpectrum,
  Character,
  Difficulty,
  EndingType,
  Gender,
  HeatLevel,
  Jealousy,
  PartnerRelation,
  PromptOverrides,
  Rumor,
  Secret,
  SetManifest,
  SetRelationKind,
  SetRelationship,
  Style,
  Tier,
  TierNumber,
  Trait,
} from '../types'

export const GENDERS: readonly Gender[] = ['woman', 'man', 'nonbinary']
export const STYLES: readonly Style[] = ['monogamous', 'open', 'polyamorous', 'flexible']
export const JEALOUSY_LEVELS: readonly Jealousy[] = ['compersion', 'low', 'medium', 'high']
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard']
export const PARTNER_RELATIONS: readonly PartnerRelation[] = ['partner', 'ex', 'situationship']
export const SET_RELATION_KINDS: readonly SetRelationKind[] = [
  'partner',
  'ex',
  'situationship',
  'friend',
  'rival',
  'roommate',
  'housemate',
  'coworker',
  'bandmate',
  'neighbor',
  'family',
]
export const ENDING_TYPES: readonly EndingType[] = [
  'good',
  'open',
  'polycule',
  'bitter',
  'hollow',
  'sacrifice',
  'reconciliation',
]
export const TIER_UNLOCKS: Readonly<Record<TierNumber, Tier['unlockAt']>> = {
  1: 20,
  2: 40,
  3: 60,
  4: 80,
  5: 100,
}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The first of these keys that is present (not undefined or null). */
function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

/** Strings stay as written; numbers and booleans become text; anything else is ''. */
function str(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function optStr(v: unknown): string | undefined {
  const s = str(v)
  return s.trim() ? s : undefined
}

/** Numbers, and numeric strings like "28" or " 28 ". NaN when missing or not a number. */
function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.trim()))) return Number(v.trim())
  return Number.NaN
}

function lower(v: unknown): string {
  return str(v).trim().toLowerCase()
}

/** A list from an array, or from a comma/semicolon separated string. Non-strings are dropped. */
function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x.trim() : str(x).trim())).filter(Boolean)
  if (typeof v === 'string') return v.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
  return []
}

/** "Slow dancing in an empty room" -> "slow-dancing-in-an-empty-room" (at most 40 chars). */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

// ---------------------------------------------------------------------------
// Enums

/** A gender word to `Gender`, or the original (trimmed) text when it isn't one. */
function genderOrRaw(v: unknown): Gender {
  const n = normalizeGender(str(v))
  return (n ?? str(v).trim()) as Gender
}

const EVERYONE = new Set(['everyone', 'all', 'anyone', 'any', 'all genders', 'everybody'])

/** attractedTo from an array or "women, men and nonbinary people"; plurals folded, deduped. */
export function normalizeAttractions(v: unknown): Gender[] {
  const words = Array.isArray(v)
    ? v.map((x) => str(x))
    : str(v)
        .split(/,|;|\/|\band\b|&/i)
        .map((x) => x.trim())
  const out: Gender[] = []
  for (const w of words) {
    if (!w.trim()) continue
    if (EVERYONE.has(w.trim().toLowerCase())) {
      for (const g of GENDERS) if (!out.includes(g)) out.push(g)
      continue
    }
    const g = genderOrRaw(w)
    if (!out.includes(g)) out.push(g)
  }
  return out
}

function styleOf(v: unknown): Style {
  const s = lower(v)
  const alias: Record<string, Style> = {
    mono: 'monogamous',
    monogamy: 'monogamous',
    poly: 'polyamorous',
    polyamory: 'polyamorous',
    'open relationship': 'open',
    flex: 'flexible',
  }
  return (alias[s] ?? s) as Style
}

function jealousyOf(v: unknown): Jealousy {
  return lower(v) as Jealousy
}

function difficultyOf(v: unknown): Difficulty {
  const s = lower(v)
  return (s === '' ? 'normal' : s) as Difficulty
}

function relationOf(v: unknown): PartnerRelation {
  const s = lower(v)
  return (s === 'partners' ? 'partner' : s) as PartnerRelation
}

/** Accent as "#RRGGBB": adds a missing "#"; anything else is kept for the validator. */
function accentOf(v: unknown): string {
  const s = str(v).trim()
  if (/^[0-9a-f]{6}$/i.test(s) || /^[0-9a-f]{3}$/i.test(s)) return `#${s}`
  return s
}

// ---------------------------------------------------------------------------
// Parts

function traitList(v: unknown): Trait[] {
  if (!Array.isArray(v)) return []
  const out: Trait[] = []
  for (const t of v) {
    if (typeof t === 'string') {
      if (t.trim()) out.push({ id: slugify(t), label: t.trim() })
    } else if (isObj(t)) {
      const label = str(pick(t, 'label', 'text', 'name'))
      const id = str(pick(t, 'id')).trim() || slugify(label)
      out.push({ id, label })
    }
  }
  return out
}

function aceOf(v: unknown): AceSpectrum | undefined {
  if (typeof v === 'string') return v.trim() ? { label: v.trim() } : undefined
  if (!isObj(v)) return undefined
  const ace: AceSpectrum = { label: str(pick(v, 'label', 'name')) }
  const cap = num(pick(v, 'heatCap', 'heat_cap'))
  if (!Number.isNaN(cap)) ace.heatCap = cap as HeatLevel
  const gate = num(pick(v, 'heatUnlockTrust', 'heat_unlock_trust'))
  if (!Number.isNaN(gate)) ace.heatUnlockTrust = gate
  return ace
}

function partnersOf(v: unknown): Character['partners'] {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) return []
  const out: NonNullable<Character['partners']> = []
  for (const p of v) {
    if (typeof p === 'string') out.push({ characterId: p.trim(), relation: 'partner' })
    else if (isObj(p)) {
      out.push({
        characterId: str(pick(p, 'characterId', 'character_id', 'id')).trim(),
        relation: relationOf(pick(p, 'relation', 'kind', 'type')),
      })
    }
  }
  return out
}

function secretsOf(v: unknown): Secret[] {
  if (!Array.isArray(v)) return []
  const out: Secret[] = []
  for (const s of v) {
    if (isObj(s)) out.push({ unlockAt: num(pick(s, 'unlockAt', 'unlock_at')), text: str(pick(s, 'text')) })
  }
  return out
}

function galleryOf(v: unknown): Tier[] {
  if (!Array.isArray(v)) return []
  const out: Tier[] = []
  for (const t of v) {
    if (!isObj(t)) continue
    const tier = num(t.tier) as TierNumber
    const given = num(pick(t, 'unlockAt', 'unlock_at'))
    const unlockAt = (Number.isNaN(given) ? (TIER_UNLOCKS[tier] ?? Number.NaN) : given) as Tier['unlockAt']
    out.push({ tier, unlockAt, title: str(t.title), scene: str(t.scene) })
  }
  return out
}

function endingsOf(v: unknown): Character['endings'] {
  if (!isObj(v)) return undefined
  const out: NonNullable<Character['endings']> = {}
  for (const [k, e] of Object.entries(v)) {
    if (isObj(e)) out[k as EndingType] = { title: str(e.title), scene: str(e.scene) }
  }
  return Object.keys(out).length ? out : undefined
}

function promptsOf(v: unknown): PromptOverrides | undefined {
  if (!isObj(v)) return undefined
  const out: PromptOverrides = {}
  for (const k of ['story', 'judge', 'suggestions'] as const) {
    const s = optStr(v[k])
    if (s) out[k] = s
  }
  return Object.keys(out).length ? out : undefined
}

// ---------------------------------------------------------------------------
// Character

/**
 * A `Character` from loosely written JSON. Optional fields are only set when present; the four
 * trait lists, venue and gift lists, secrets and gallery default to empty arrays.
 */
export function normalizeCharacter(raw: unknown): Character {
  const o: Obj = isObj(raw) ? raw : {}
  const artTags = pick(o, 'artTags', 'art_tags')
  const c: Character = {
    id: str(o.id).trim(),
    name: str(o.name),
    age: num(o.age),
    gender: genderOrRaw(o.gender),
    pronouns: str(o.pronouns),
    attractedTo: normalizeAttractions(pick(o, 'attractedTo', 'attracted_to')),
    relationshipStyle: styleOf(pick(o, 'relationshipStyle', 'relationship_style', 'style')),
    jealousy: jealousyOf(o.jealousy),
    occupation: str(o.occupation),
    difficulty: difficultyOf(o.difficulty),
    accent: accentOf(o.accent),
    look: str(o.look),
    artTags: Array.isArray(artTags) ? strList(artTags).join(', ') : str(artTags),
    personality: str(o.personality),
    voice: str(o.voice),
    backstory: str(o.backstory),
    opener: str(o.opener),
    likes: traitList(o.likes),
    dislikes: traitList(o.dislikes),
    turnOns: traitList(pick(o, 'turnOns', 'turn_ons', 'turnons')),
    turnOffs: traitList(pick(o, 'turnOffs', 'turn_offs', 'turnoffs')),
    favoriteVenues: strList(pick(o, 'favoriteVenues', 'favorite_venues')),
    hatedVenues: strList(pick(o, 'hatedVenues', 'hated_venues')),
    lovedGifts: strList(pick(o, 'lovedGifts', 'loved_gifts')),
    hatedGifts: strList(pick(o, 'hatedGifts', 'hated_gifts')),
    secrets: secretsOf(o.secrets),
    gallery: galleryOf(o.gallery),
  }
  const ace = aceOf(pick(o, 'aceSpectrum', 'ace_spectrum'))
  if (ace) c.aceSpectrum = ace
  const bodyNotes = optStr(pick(o, 'bodyNotes', 'body_notes'))
  if (bodyNotes) c.bodyNotes = bodyNotes
  const partners = partnersOf(o.partners)
  if (partners) c.partners = partners
  const identity = optStr(o.identity)
  if (identity) c.identity = identity
  const orientation = optStr(o.orientation)
  if (orientation) c.orientation = orientation
  const endings = endingsOf(o.endings)
  if (endings) c.endings = endings
  const prompts = promptsOf(o.prompts)
  if (prompts) c.prompts = prompts
  return c
}

/** A blank card for the editor: every required field empty, gallery tiers laid out. */
export function emptyCharacter(id = ''): Character {
  return {
    ...normalizeCharacter({ id }),
    difficulty: 'normal',
    gallery: ([1, 2, 3, 4, 5] as TierNumber[]).map((tier) => ({
      tier,
      unlockAt: TIER_UNLOCKS[tier],
      title: '',
      scene: '',
    })),
  }
}

// ---------------------------------------------------------------------------
// Manifest

function relationshipsOf(v: unknown): SetRelationship[] {
  if (!Array.isArray(v)) return []
  const out: SetRelationship[] = []
  for (const r of v) {
    if (!isObj(r)) continue
    const kind = lower(pick(r, 'kind', 'type', 'relation'))
    out.push({
      a: str(r.a).trim(),
      b: str(r.b).trim(),
      kind: (kind === 'partners' ? 'partner' : kind) as SetRelationKind,
      note: str(r.note),
    })
  }
  return out
}

function rumorsOf(v: unknown): Rumor[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Rumor[] = []
  for (const r of v) {
    if (!isObj(r)) continue
    const rumor: Rumor = {
      id: str(r.id).trim(),
      teller: str(r.teller).trim(),
      about: strList(r.about),
      text: str(r.text),
      truth: lower(r.truth) as Rumor['truth'],
    }
    const actually = optStr(r.actually)
    if (actually) rumor.actually = actually
    out.push(rumor)
  }
  return out
}

/**
 * A `SetManifest` from loosely written JSON. `characters` may list ids or whole character
 * objects (their ids are taken). Accepts `title` for name, `description` for blurb and
 * `heatRecommendation` / `recommendedHeat` for heat.
 */
export function normalizeManifest(raw: unknown): SetManifest {
  const o: Obj = isObj(raw) ? raw : {}
  const chars = Array.isArray(o.characters) ? o.characters : []
  const m: SetManifest = {
    id: str(o.id).trim(),
    name: str(pick(o, 'name', 'title')),
    blurb: str(pick(o, 'blurb', 'description')),
    characters: chars
      .map((c) => (isObj(c) ? str(c.id) : str(c)).trim())
      .filter(Boolean),
    relationships: relationshipsOf(o.relationships),
  }
  const author = optStr(o.author)
  if (author) m.author = author
  const heat = num(pick(o, 'heat', 'heatRecommendation', 'recommendedHeat', 'heat_recommendation'))
  if (!Number.isNaN(heat)) m.heat = heat as HeatLevel
  const version = optStr(o.version)
  if (version) m.version = version
  const setting = optStr(o.setting)
  if (setting) m.setting = setting
  const rumors = rumorsOf(o.rumors)
  if (rumors) m.rumors = rumors
  if (o.knows !== undefined) m.knows = strList(o.knows)
  const prompts = promptsOf(o.prompts)
  if (prompts) m.prompts = prompts
  return m
}
