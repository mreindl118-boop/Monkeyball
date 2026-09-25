// Editor and import validation (docs/SPEC.md, "Editor validation"; ARCHITECTURE, Mods).
// validateCharacter() and validateManifest() return a list of { field, message } problems; an
// empty list means the card or manifest can be saved. Bundled sets must pass too (a unit test
// checks every bundled card). Field paths match src/mods/safety.ts ("look", "likes[2].id",
// "gallery[0].scene", ...), so the editor can show each message next to its field.

import { GIFTS } from '../data/gifts'
import { VENUES } from '../data/venues'
import type { Character, SetManifest, Trait } from '../types'
import {
  DIFFICULTIES,
  ENDING_TYPES,
  GENDERS,
  JEALOUSY_LEVELS,
  PARTNER_RELATIONS,
  SET_RELATION_KINDS,
  STYLES,
  TIER_UNLOCKS,
} from './normalize'
import { scanManifestSafety, scanSafety } from './safety'

export interface ValidationIssue {
  /** Path of the field, e.g. "age", "likes[1].id", "partners[0].characterId", "gallery". */
  field: string
  message: string
}

export interface ValidateContext {
  /** Ids of the characters in the same set (this one may be included). Partners must be here. */
  setCharacterIds: readonly string[]
  /** Venue ids a card may use. Default: the fourteen venues. */
  knownVenueIds?: readonly string[]
  /** Gift ids a card may use. Default: the fourteen gifts. */
  knownGiftIds?: readonly string[]
  /**
   * Ids already taken by other characters (bundled ones and other sets). Leave this character's
   * own id out when editing it.
   */
  existingIds?: readonly string[]
  /** Ids kept for characters that ship with a later version (see RESERVED_CHARACTER_IDS). */
  reservedIds?: readonly string[]
}

/** Lowercase letters and digits in hyphen-separated words: "nova", "slow-dance", "tier-2". */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const MIN_AGE = 21
/**
 * The oldest a card can say. A centuries-old age is the usual cover for a childlike look, and the
 * image prompt states the card's age, so it has to read as an adult human's.
 */
export const MAX_AGE = 120
const ID_MAX = 40

const TRAIT_KEYS = ['likes', 'dislikes', 'turnOns', 'turnOffs'] as const
const TRAIT_NAMES: Record<(typeof TRAIT_KEYS)[number], string> = {
  likes: 'likes',
  dislikes: 'dislikes',
  turnOns: 'turn-ons',
  turnOffs: 'turn-offs',
}

const REQUIRED_TEXT: readonly [keyof Character, string][] = [
  ['name', 'Name'],
  ['pronouns', 'Pronouns'],
  ['occupation', 'Occupation'],
  ['look', 'Look'],
  ['artTags', 'Art tags'],
  ['personality', 'Personality'],
  ['voice', 'Voice'],
  ['backstory', 'Backstory'],
  ['opener', 'Opener'],
]

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

function listOf<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : []
}

/** "record-store" and "rooftop-bar" -> "record-store and rooftop-bar" style joining. */
function quoteList(items: readonly string[]): string {
  const q = items.map((s) => `"${s}"`)
  if (q.length <= 1) return q[0] ?? ''
  return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`
}

function checkAge(age: unknown, issues: ValidationIssue[]) {
  if (typeof age !== 'number' || Number.isNaN(age)) {
    issues.push({ field: 'age', message: `Age is required. Every character is ${MIN_AGE} or older.` })
  } else if (!Number.isFinite(age) || !Number.isInteger(age)) {
    issues.push({ field: 'age', message: 'Age must be a whole number.' })
  } else if (age < MIN_AGE) {
    issues.push({
      field: 'age',
      message: `Age ${age} isn't allowed. Every character in crushLAB is ${MIN_AGE} or older, with an adult life and job.`,
    })
  } else if (age > MAX_AGE) {
    issues.push({
      field: 'age',
      message: `Age ${age} isn't allowed. Give their age as an adult human's, ${MIN_AGE} to ${MAX_AGE}; an ageless being can say so in the backstory.`,
    })
  }
}

function checkTraits(c: Character, issues: ValidationIssue[]) {
  const seen = new Map<string, string>()
  for (const key of TRAIT_KEYS) {
    const list = listOf<Trait>(c[key])
    if (list.length === 0) {
      issues.push({ field: key, message: `Add at least one of their ${TRAIT_NAMES[key]}.` })
    }
    list.forEach((t, i) => {
      const id = typeof t?.id === 'string' ? t.id : ''
      if (!isText(t?.label)) {
        issues.push({ field: `${key}[${i}].label`, message: `Each of their ${TRAIT_NAMES[key]} needs a description.` })
      }
      if (!id) {
        issues.push({ field: `${key}[${i}].id`, message: `Each of their ${TRAIT_NAMES[key]} needs an id.` })
        return
      }
      if (!ID_PATTERN.test(id) || id.length > ID_MAX) {
        issues.push({
          field: `${key}[${i}].id`,
          message: `Trait id "${id}" should be lowercase words joined by hyphens, like "slow-dance".`,
        })
      }
      const first = seen.get(id)
      if (first) {
        const where = first === key ? `twice in ${TRAIT_NAMES[key]}` : `in both ${TRAIT_NAMES[first as typeof key]} and ${TRAIT_NAMES[key]}`
        issues.push({
          field: `${key}[${i}].id`,
          message: `Trait id "${id}" is used ${where}. Every trait id on a card must be different.`,
        })
      } else {
        seen.set(id, key)
      }
    })
  }
}

function checkIdList(
  c: Character,
  key: 'favoriteVenues' | 'hatedVenues' | 'lovedGifts' | 'hatedGifts',
  known: ReadonlySet<string>,
  what: 'venue' | 'gift',
  issues: ValidationIssue[],
) {
  const list = listOf<string>(c[key])
  const dupes = new Set<string>()
  list.forEach((id, i) => {
    if (!known.has(id)) {
      issues.push({ field: `${key}[${i}]`, message: `"${id}" isn't a known ${what}.` })
    } else if (list.indexOf(id) !== i && !dupes.has(id)) {
      dupes.add(id)
      issues.push({ field: `${key}[${i}]`, message: `"${id}" is listed twice.` })
    }
  })
}

function checkOverlap(
  c: Character,
  a: 'favoriteVenues' | 'lovedGifts',
  b: 'hatedVenues' | 'hatedGifts',
  message: (ids: string) => string,
  issues: ValidationIssue[],
) {
  const both = listOf<string>(c[a]).filter((id) => listOf<string>(c[b]).includes(id))
  if (both.length) issues.push({ field: b, message: message(quoteList([...new Set(both)])) })
}

function checkGallery(c: Character, issues: ValidationIssue[]) {
  const gallery = listOf(c.gallery)
  if (gallery.length !== 5) {
    issues.push({
      field: 'gallery',
      message: `The gallery needs exactly five tiers, 1 to 5 (it has ${gallery.length}).`,
    })
  }
  const seen = new Set<number>()
  gallery.forEach((t, i) => {
    const tier = t?.tier as number
    if (![1, 2, 3, 4, 5].includes(tier)) {
      issues.push({ field: `gallery[${i}].tier`, message: `Gallery tiers are numbered 1 to 5.` })
      return
    }
    if (seen.has(tier)) {
      issues.push({ field: `gallery[${i}].tier`, message: `Tier ${tier} appears twice in the gallery.` })
    }
    seen.add(tier)
    const want = TIER_UNLOCKS[tier as 1 | 2 | 3 | 4 | 5]
    if (t.unlockAt !== want) {
      issues.push({ field: `gallery[${i}].unlockAt`, message: `Tier ${tier} unlocks at ${want} affection.` })
    }
    if (!isText(t.title)) issues.push({ field: `gallery[${i}].title`, message: `Tier ${tier} needs a title.` })
    if (!isText(t.scene)) issues.push({ field: `gallery[${i}].scene`, message: `Tier ${tier} needs a scene.` })
  })
  if (gallery.length === 5 && seen.size < 5) {
    const missing = [1, 2, 3, 4, 5].filter((n) => !seen.has(n))
    if (missing.length) {
      issues.push({ field: 'gallery', message: `The gallery is missing tier ${missing.join(' and ')}.` })
    }
  }
}

/**
 * Everything wrong with a character card, per docs/SPEC.md: required fields, a whole-number
 * age of 21 or more, attractions, unique trait ids across the four lists, known venues and
 * gifts, partners in the same set, a five-tier gallery at 20/40/60/80/100, a hex accent,
 * secrets that unlock between 0 and 100, and the safety scan. Empty when the card is valid.
 */
export function validateCharacter(c: Character, ctx: ValidateContext): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const knownVenues = new Set(ctx.knownVenueIds ?? VENUES.map((v) => v.id))
  const knownGifts = new Set(ctx.knownGiftIds ?? GIFTS.map((g) => g.id))

  // Id
  const id = typeof c.id === 'string' ? c.id : ''
  if (!id) {
    issues.push({ field: 'id', message: 'Id is required, like "nova" or "sam-ortiz".' })
  } else if (!ID_PATTERN.test(id) || id.length > ID_MAX) {
    issues.push({
      field: 'id',
      message: `Id "${id}" should be lowercase letters and numbers joined by hyphens, like "sam-ortiz" (at most ${ID_MAX} characters).`,
    })
  } else if (ctx.existingIds?.includes(id)) {
    issues.push({ field: 'id', message: `Another character already uses the id "${id}". Pick a different one.` })
  } else if (ctx.reservedIds?.includes(id)) {
    issues.push({
      field: 'id',
      message: `The id "${id}" is kept for a character in a set that ships with crushLAB. Pick a different one.`,
    })
  }

  // Required text
  for (const [key, label] of REQUIRED_TEXT) {
    if (!isText(c[key])) issues.push({ field: key, message: `${label} is required.` })
  }

  checkAge(c.age, issues)

  // Identity and attractions
  if (!GENDERS.includes(c.gender)) {
    issues.push({
      field: 'gender',
      message: c.gender ? `Gender "${String(c.gender)}" isn't one of woman, man or nonbinary.` : 'Gender is required: woman, man or nonbinary.',
    })
  }
  const attractedTo = listOf(c.attractedTo)
  if (attractedTo.length === 0) {
    issues.push({ field: 'attractedTo', message: 'Pick at least one gender they are attracted to.' })
  }
  attractedTo.forEach((g, i) => {
    if (!GENDERS.includes(g)) {
      issues.push({ field: `attractedTo[${i}]`, message: `"${String(g)}" isn't one of woman, man or nonbinary.` })
    }
  })
  if (!STYLES.includes(c.relationshipStyle)) {
    issues.push({
      field: 'relationshipStyle',
      message: 'Relationship style must be monogamous, open, polyamorous or flexible.',
    })
  }
  if (!JEALOUSY_LEVELS.includes(c.jealousy)) {
    issues.push({ field: 'jealousy', message: 'Jealousy must be compersion, low, medium or high.' })
  }
  if (!DIFFICULTIES.includes(c.difficulty)) {
    issues.push({ field: 'difficulty', message: 'Difficulty must be easy, normal or hard.' })
  }
  if (c.aceSpectrum) {
    const ace = c.aceSpectrum
    if (!isText(ace.label)) {
      issues.push({ field: 'aceSpectrum.label', message: 'The ace spectrum needs a label, like "Demisexual".' })
    }
    if (ace.heatCap != null && !(Number.isInteger(ace.heatCap) && ace.heatCap >= 1 && ace.heatCap <= 5)) {
      issues.push({ field: 'aceSpectrum.heatCap', message: 'The heat cap must be a whole number from 1 to 5.' })
    }
    if (
      ace.heatUnlockTrust != null &&
      !(Number.isFinite(ace.heatUnlockTrust) && ace.heatUnlockTrust >= 0 && ace.heatUnlockTrust <= 100)
    ) {
      issues.push({ field: 'aceSpectrum.heatUnlockTrust', message: 'The trust threshold must be between 0 and 100.' })
    }
  }

  // Accent
  if (!isText(c.accent)) {
    issues.push({ field: 'accent', message: 'Accent color is required, as a hex code like #3FB8AF.' })
  } else if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.accent)) {
    issues.push({ field: 'accent', message: `Accent "${c.accent}" should be a hex color like #3FB8AF.` })
  }

  // Partners: same set only
  const setIds = new Set(ctx.setCharacterIds)
  const partnerIds = new Set<string>()
  listOf(c.partners).forEach((p, i) => {
    const pid = typeof p?.characterId === 'string' ? p.characterId : ''
    if (!pid) {
      issues.push({ field: `partners[${i}].characterId`, message: 'Each partner needs a character id.' })
    } else if (pid === id) {
      issues.push({ field: `partners[${i}].characterId`, message: "A character can't be their own partner." })
    } else if (!setIds.has(pid)) {
      issues.push({
        field: `partners[${i}].characterId`,
        message: `Partner "${pid}" isn't in this set. Partners and exes must be characters in the same set.`,
      })
    } else if (partnerIds.has(pid)) {
      issues.push({ field: `partners[${i}].characterId`, message: `"${pid}" is listed as a partner twice.` })
    }
    if (pid) partnerIds.add(pid)
    if (!PARTNER_RELATIONS.includes(p?.relation)) {
      issues.push({ field: `partners[${i}].relation`, message: 'A partner is a partner, an ex or a situationship.' })
    }
  })

  checkTraits(c, issues)

  // Venues and gifts
  checkIdList(c, 'favoriteVenues', knownVenues, 'venue', issues)
  checkIdList(c, 'hatedVenues', knownVenues, 'venue', issues)
  checkIdList(c, 'lovedGifts', knownGifts, 'gift', issues)
  checkIdList(c, 'hatedGifts', knownGifts, 'gift', issues)
  if (listOf(c.favoriteVenues).length === 0) {
    issues.push({ field: 'favoriteVenues', message: 'Pick at least one favorite venue (the epilogue plays at the first one).' })
  }
  checkOverlap(c, 'favoriteVenues', 'hatedVenues', (ids) => `${ids} can't be both a favorite and a hated venue.`, issues)
  checkOverlap(c, 'lovedGifts', 'hatedGifts', (ids) => `${ids} can't be both a loved and a hated gift.`, issues)

  // Secrets
  listOf(c.secrets).forEach((s, i) => {
    const at = s?.unlockAt
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > 100) {
      issues.push({ field: `secrets[${i}].unlockAt`, message: 'A secret unlocks at an affection between 0 and 100.' })
    }
    if (!isText(s?.text)) issues.push({ field: `secrets[${i}].text`, message: 'A secret needs its text.' })
  })

  checkGallery(c, issues)

  // Optional extras
  for (const [type, e] of Object.entries(c.endings ?? {})) {
    if (!ENDING_TYPES.includes(type as (typeof ENDING_TYPES)[number])) {
      issues.push({ field: `endings.${type}`, message: `"${type}" isn't an ending.` })
    } else if (!isText(e?.title) || !isText(e?.scene)) {
      issues.push({ field: `endings.${type}`, message: `The ${type} ending needs a title and a scene.` })
    }
  }

  for (const s of scanSafety(c)) issues.push({ field: s.field, message: s.message })
  return issues
}

export interface ManifestContext {
  /**
   * Ids of the characters that actually came with the set (a pack's character files). When
   * given, every listed character must be among them.
   */
  characterIds?: readonly string[]
  /** Set ids already in use elsewhere (bundled sets, other packs, sets that will ship later). */
  existingSetIds?: readonly string[]
  /**
   * The set a character outside this one belongs to (from the roster). When given, a
   * relationship with someone outside the set needs that set in `knows`.
   */
  setOfCharacter?: (characterId: string) => string | undefined
}

/**
 * Everything wrong with a set manifest: id, name and blurb, a heat of 1 to 5, a non-empty and
 * duplicate-free character list, relationships and rumors between its own characters, and the
 * safety scan. Empty when it's valid.
 */
export function validateManifest(m: SetManifest, ctx: ManifestContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const id = typeof m.id === 'string' ? m.id : ''
  if (!id) issues.push({ field: 'id', message: 'The set needs an id, like "afterhours".' })
  else if (!ID_PATTERN.test(id) || id.length > ID_MAX) {
    issues.push({ field: 'id', message: `Set id "${id}" should be lowercase words joined by hyphens, like "slow-burn".` })
  } else if (ctx.existingSetIds?.includes(id)) {
    issues.push({ field: 'id', message: `There's already a set with the id "${id}".` })
  }
  if (!isText(m.name)) issues.push({ field: 'name', message: 'The set needs a name.' })
  if (!isText(m.blurb)) issues.push({ field: 'blurb', message: 'The set needs a blurb.' })
  if (m.heat != null && !(Number.isInteger(m.heat) && m.heat >= 1 && m.heat <= 5)) {
    issues.push({ field: 'heat', message: 'The recommended heat is a whole number from 1 to 5.' })
  }

  const chars = listOf(m.characters)
  if (chars.length === 0) issues.push({ field: 'characters', message: 'The set lists no characters.' })
  const members = new Set<string>()
  chars.forEach((cid, i) => {
    if (members.has(cid)) issues.push({ field: `characters[${i}]`, message: `"${cid}" is listed twice.` })
    members.add(cid)
    if (ctx.characterIds && !ctx.characterIds.includes(cid)) {
      issues.push({ field: `characters[${i}]`, message: `The set lists "${cid}" but has no card for them.` })
    }
  })

  // A set that knows other sets may give one of its characters a friend, rival, coworker (and
  // so on) in theirs. Partners, exes and situationships stay inside the set, as on the cards.
  const knows = listOf(m.knows)
  listOf(m.relationships).forEach((r, i) => {
    const f = `relationships[${i}]`
    const inSet = [r?.a, r?.b].filter((cid) => members.has(cid)).length
    const partnerKind = PARTNER_RELATIONS.includes(r?.kind as (typeof PARTNER_RELATIONS)[number])
    for (const side of ['a', 'b'] as const) {
      const cid = r?.[side]
      if (!isText(cid)) {
        issues.push({ field: `${f}.${side}`, message: `Relationship ${i + 1} is missing a character id.` })
        continue
      }
      if (members.has(cid)) continue
      if (knows.length === 0 || inSet !== 1) {
        issues.push({ field: `${f}.${side}`, message: `Relationship ${i + 1} names "${cid}", who isn't in this set.` })
      } else if (partnerKind) {
        issues.push({
          field: `${f}.kind`,
          message: `Relationship ${i + 1} makes "${cid}" a partner or ex from another set. Partners and exes must be in the same set; another set's characters can be friends, rivals, coworkers and so on.`,
        })
      } else if (ctx.setOfCharacter) {
        const other = ctx.setOfCharacter(cid)
        if (!other || !knows.includes(other)) {
          issues.push({
            field: `${f}.${side}`,
            message: other
              ? `Relationship ${i + 1} names "${cid}", who is in "${other}", a set this one doesn't list under knows.`
              : `Relationship ${i + 1} names "${cid}", who isn't in this set or any set it knows.`,
          })
        }
      }
    }
    if (r?.a && r.a === r.b) issues.push({ field: f, message: `Relationship ${i + 1} pairs "${r.a}" with themselves.` })
    if (!SET_RELATION_KINDS.includes(r?.kind)) {
      issues.push({ field: `${f}.kind`, message: `Relationship ${i + 1} has an unknown kind "${String(r?.kind ?? '')}".` })
    }
  })

  const rumorIds = new Set<string>()
  listOf(m.rumors).forEach((r, i) => {
    const f = `rumors[${i}]`
    if (!isText(r?.id)) issues.push({ field: `${f}.id`, message: `Rumor ${i + 1} needs an id.` })
    else if (rumorIds.has(r.id)) issues.push({ field: `${f}.id`, message: `Rumor id "${r.id}" is used twice.` })
    else rumorIds.add(r.id)
    if (!members.has(r?.teller)) {
      issues.push({ field: `${f}.teller`, message: `Rumor ${i + 1} is told by "${String(r?.teller ?? '')}", who isn't in this set.` })
    }
    const about = listOf(r?.about)
    if (about.length === 0) issues.push({ field: `${f}.about`, message: `Rumor ${i + 1} isn't about anyone.` })
    about.forEach((a) => {
      if (!members.has(a)) issues.push({ field: `${f}.about`, message: `Rumor ${i + 1} is about "${a}", who isn't in this set.` })
    })
    if (!isText(r?.text)) issues.push({ field: `${f}.text`, message: `Rumor ${i + 1} needs its text.` })
    if (!['true', 'exaggerated', 'false'].includes(r?.truth)) {
      issues.push({ field: `${f}.truth`, message: `Rumor ${i + 1} is true, exaggerated or false.` })
    }
  })

  listOf(m.knows).forEach((k, i) => {
    if (typeof k !== 'string' || !ID_PATTERN.test(k)) {
      issues.push({ field: `knows[${i}]`, message: `"${String(k)}" isn't a set id.` })
    } else if (k === id) {
      issues.push({ field: `knows[${i}]`, message: "A set doesn't need to list itself under knows." })
    }
  })

  for (const s of scanManifestSafety(m)) issues.push({ field: s.field, message: s.message })
  return issues
}

/** Messages only, e.g. for a toast or an import report. */
export function issueMessages(issues: readonly ValidationIssue[]): string[] {
  return issues.map((i) => i.message)
}
