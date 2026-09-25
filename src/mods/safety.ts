// The character safety floor (docs/SPEC.md, "Character safety"; ARCHITECTURE, Mods). Every
// character is an adult aged 21 or older and nothing on a card may portray or imply a minor or
// childlike traits. This scan runs on every card the editor saves, every import and every
// bundled card; it is code, not a setting.
//
// Word-boundary matching keeps ordinary words clear: "kidding", "skid", "minority", "teenth",
// "childhood" (backstory only), "boyfriend", "girlfriend". "Minor" as a noun is blocked; the
// adjective in "minor key", "minor detail" and the like is not.

import type { Character, SetManifest } from '../types'

export interface SafetyIssue {
  /** Path of the field, e.g. "look", "likes[2].label", "gallery[0].scene". */
  field: string
  message: string
  /** The words that matched, as written. */
  term: string
}

interface Rule {
  re: RegExp
  /** Only in appearance fields (look, art tags, body notes, gallery and ending scenes). */
  appearanceOnly?: boolean
  /** Allowed in the backstory ("childhood"). */
  backstoryOk?: boolean
}

/** Adjectival "minor" is fine when it's followed by one of these. */
const MINOR_OK =
  'keys?|chords?|scales?|thirds?|sevenths?|modes?|progressions?|leagues?|details?|things?|issues?|' +
  'problems?|injur(?:y|ies)|cuts?|scrapes?|surgery|repairs?|changes?|roles?|parts?|characters?|' +
  'celebrity|celebrities|hits?|fame|miracles?|annoyances?|setbacks?|offen[cs]es?|infractions?|' +
  'disasters?|crisis|detour|in\\b|arcana|planets?|damage|flaws?|quibbles?'

const RULES: readonly Rule[] = [
  { re: /\bchild(?:ren)?(?:'s)?\b/i },
  { re: /\bchild[\s-]?like\b/i },
  { re: /\bchildish\b/i },
  { re: /\bchildhood\b/i, backstoryOk: true },
  { re: /\bkid(?:s|do|dos|die|dies|dy)?\b/i },
  // "in A minor" / "key of F sharp minor" is music; "minor key", "a minor in art history" too.
  {
    re: new RegExp(
      `(?<!\\b(?:in|of)\\s+[A-G](?:#|b|♯|♭|\\s+sharp|\\s+flat)?\\s+)\\bminors?\\b(?![\\s-]+(?:${MINOR_OK})\\b)`,
      'i',
    ),
  },
  { re: /\b(?:pre[\s-]?)?teen(?:s|age|aged|ager|agers)?\b/i },
  { re: /\btweens?\b/i },
  { re: /\badolescen(?:t|ts|ce)\b/i },
  { re: /\bunder[\s-]?age(?:d)?\b/i },
  {
    re: /\bunder[\s-]?(?:18|eighteen)s?\b(?![\s-]*(?:minutes?|mins?|seconds?|secs?|hours?|hrs?|days?|dollars?|bucks|pounds?|euros?|miles?|kilos?|kg|lbs?|percent|%))/i,
  },
  { re: /\b(?:lolis?|lolicon|lolita|shotas?|shotacon)\b/i },
  { re: /\bschool[\s-]?(?:girls?|boys?|kids?|uniforms?)\b/i },
  { re: /\b(?:high|middle|grade|primary|elementary|junior)[\s-]?school\b/i },
  { re: /\bjunior[\s-]high\b/i },
  { re: /\b(?:pre[\s-]?school|kindergarten)\b/i },
  { re: /\bbarely[\s-]legal\b/i },
  { re: /\bjail[\s-]?bait\b/i },
  { re: /\blittle\s+(?:girls?|boys?)\b/i },
  { re: /\b(?:pa?edo(?:phile|philes|philia)?s?)\b/i },
  { re: /\b(?:infants?|toddlers?)\b/i },
  { re: /\bage[\s-]?(?:play|regression)\b/i },
  // Appearance fields feed the image prompts: "girl" and "young" read as underage there.
  { re: /\b(?:girls?|boys?)\b/i, appearanceOnly: true },
  { re: /\b(?:young(?:er)?|youthful|young[\s-]looking)\b/i, appearanceOnly: true },
  { re: /\bbaby[\s-]?fac(?:e|ed)\b/i, appearanceOnly: true },
]

const SMALL_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
}
const NUMBER_WORD = `(\\d{1,3}|${Object.keys(SMALL_NUMBERS).join('|')})`
/** "twenty" followed by "-one" etc. is 21 or more. */
const NOT_COMPOUND = '(?![\\s-]+(?:one|two|three|four|five|six|seven|eight|nine)\\b)'

/** Ways an age gets written: "19 years old", "19-year-old", "19yo", "aged 19", "looks 16". */
const AGE_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b${NUMBER_WORD}${NOT_COMPOUND}[\\s-]*(?:years?|yrs?)[\\s-]*old\\b`, 'gi'),
  new RegExp(`\\b${NUMBER_WORD}${NOT_COMPOUND}[\\s-]*(?:yo|y/o|y\\.o\\.?)(?![a-z])`, 'gi'),
  new RegExp(`\\bage[ds]?\\s*(?:of\\s+|is\\s+|:\\s*)?${NUMBER_WORD}${NOT_COMPOUND}\\b`, 'gi'),
  new RegExp(
    `\\blooks?\\s+(?:like\\s+)?(?:(?:she|he|they)(?:'s|'re|\\s+is|\\s+are)\\s+)?(?:about\\s+|maybe\\s+|only\\s+|barely\\s+|around\\s+)?${NUMBER_WORD}${NOT_COMPOUND}\\b`,
    'gi',
  ),
  new RegExp(`\\bbarely\\s+${NUMBER_WORD}${NOT_COMPOUND}\\b`, 'gi'),
]

function toNumber(word: string): number {
  const n = Number(word)
  return Number.isFinite(n) ? n : (SMALL_NUMBERS[word.toLowerCase()] ?? Number.NaN)
}

/** Ages under 21 written in the text, as matched ("19 years old", "sixteen-year-old"). */
export function underageMentions(text: string): string[] {
  const out: string[] = []
  for (const re of AGE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const n = toNumber(m[1])
      if (Number.isFinite(n) && n < 21) out.push(m[0].trim())
    }
  }
  return out
}

export interface ScanOptions {
  /** Appearance fields also block "girl", "boy", "young" and written ages under 21. */
  appearance?: boolean
  /** The backstory may mention a childhood. */
  backstory?: boolean
}

/** Every blocked term in the text, as written (deduplicated, in order). */
export function scanText(text: string, opts: ScanOptions = {}): string[] {
  if (!text) return []
  const found: string[] = []
  const add = (t: string) => {
    if (!found.some((f) => f.toLowerCase() === t.toLowerCase())) found.push(t)
  }
  for (const rule of RULES) {
    if (rule.appearanceOnly && !opts.appearance) continue
    if (rule.backstoryOk && opts.backstory) continue
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`)
    for (const m of text.matchAll(re)) add(m[0])
  }
  if (opts.appearance) for (const t of underageMentions(text)) add(t)
  return found
}

/** True when the text passes the scan. */
export function isTextSafe(text: string, opts: ScanOptions = {}): boolean {
  return scanText(text, opts).length === 0
}

interface TextField {
  field: string
  label: string
  text: string
  appearance?: boolean
  backstory?: boolean
}

const TRAIT_LISTS = [
  ['likes', 'Like'],
  ['dislikes', 'Dislike'],
  ['turnOns', 'Turn-on'],
  ['turnOffs', 'Turn-off'],
] as const

/** Every piece of text on a card, with where it lives and whether it describes appearance. */
export function characterTextFields(c: Character): TextField[] {
  const out: TextField[] = []
  const add = (field: string, label: string, text: unknown, extra: Partial<TextField> = {}) => {
    if (typeof text === 'string' && text) out.push({ field, label, text, ...extra })
  }
  add('id', 'Id', c.id)
  add('name', 'Name', c.name)
  add('pronouns', 'Pronouns', c.pronouns)
  add('identity', 'Identity', c.identity)
  add('orientation', 'Orientation', c.orientation)
  add('occupation', 'Occupation', c.occupation)
  add('look', 'Look', c.look, { appearance: true })
  add('artTags', 'Art tags', c.artTags, { appearance: true })
  add('bodyNotes', 'Body notes', c.bodyNotes, { appearance: true })
  add('personality', 'Personality', c.personality)
  add('voice', 'Voice', c.voice)
  add('backstory', 'Backstory', c.backstory, { backstory: true })
  add('opener', 'Opener', c.opener)
  add('aceSpectrum.label', 'Ace spectrum label', c.aceSpectrum?.label)
  for (const [key, label] of TRAIT_LISTS) {
    ;(c[key] ?? []).forEach((t, i) => {
      add(`${key}[${i}].id`, `${label} ${i + 1} id`, t?.id)
      add(`${key}[${i}].label`, `${label} ${i + 1}`, t?.label)
    })
  }
  ;(c.secrets ?? []).forEach((s, i) => add(`secrets[${i}].text`, `Secret ${i + 1}`, s?.text))
  ;(c.gallery ?? []).forEach((t, i) => {
    const n = t?.tier ?? i + 1
    add(`gallery[${i}].title`, `Tier ${n} title`, t?.title, { appearance: true })
    add(`gallery[${i}].scene`, `Tier ${n} scene`, t?.scene, { appearance: true })
  })
  for (const [type, e] of Object.entries(c.endings ?? {})) {
    add(`endings.${type}.title`, `${type} ending title`, e?.title, { appearance: true })
    add(`endings.${type}.scene`, `${type} ending scene`, e?.scene, { appearance: true })
  }
  for (const k of ['story', 'judge', 'suggestions'] as const) {
    add(`prompts.${k}`, `${k} prompt`, c.prompts?.[k])
  }
  return out
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function issueFor(f: TextField, term: string): SafetyIssue {
  const isAge = /\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|teen|twenty/i.test(term) &&
    underageMentions(term).length > 0
  const message = isAge
    ? `${sentenceCase(f.label)} says "${term}". Every character is 21 or older, and so is how they look.`
    : `${sentenceCase(f.label)} mentions "${term}". Characters are adults: no references to minors or childlike traits.`
  return { field: f.field, message, term }
}

function scanFields(fields: TextField[]): SafetyIssue[] {
  const issues: SafetyIssue[] = []
  for (const f of fields) {
    for (const term of scanText(f.text, { appearance: f.appearance, backstory: f.backstory })) {
      issues.push(issueFor(f, term))
    }
  }
  return issues
}

/** Safety issues on a character card; empty when it passes. */
export function scanSafety(character: Character): SafetyIssue[] {
  return scanFields(characterTextFields(character))
}

/** Safety issues in a set manifest's own text (name, blurb, setting, notes, rumors, prompts). */
export function scanManifestSafety(m: SetManifest): SafetyIssue[] {
  const fields: TextField[] = []
  const add = (field: string, label: string, text: unknown) => {
    if (typeof text === 'string' && text) fields.push({ field, label, text })
  }
  add('id', 'Set id', m.id)
  add('name', 'Set name', m.name)
  add('blurb', 'Blurb', m.blurb)
  add('author', 'Author', m.author)
  add('setting', 'Setting', m.setting)
  ;(m.relationships ?? []).forEach((r, i) => add(`relationships[${i}].note`, `Relationship ${i + 1} note`, r?.note))
  ;(m.rumors ?? []).forEach((r, i) => {
    add(`rumors[${i}].text`, `Rumor ${i + 1}`, r?.text)
    add(`rumors[${i}].actually`, `Rumor ${i + 1} truth`, r?.actually)
  })
  for (const k of ['story', 'judge', 'suggestions'] as const) add(`prompts.${k}`, `${k} prompt`, m.prompts?.[k])
  return scanFields(fields)
}
