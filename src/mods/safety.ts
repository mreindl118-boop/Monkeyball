// The character safety floor (docs/SPEC.md, "Character safety"; ARCHITECTURE, Mods). Every
// character is an adult aged 21 or older and nothing on a card may portray or imply a minor or
// childlike traits. This scan runs on every card the editor saves, every import and every
// bundled card; it is code, not a setting.
//
// Word-boundary matching keeps ordinary words clear: "kidding", "skid", "kidney", "minority",
// "eighteen", "canteen", "boyfriend", "girlfriend", "torpedo". "Childhood" is allowed in the
// backstory only. "Minor" as a noun is blocked; the adjective ("a minor detail", "minor key"),
// a college minor ("a minor in art history") and music keys ("in A minor") are not. "Minors" is
// always blocked.
//
// Written ages under 21 ("17 years old", "I'm only seventeen", "she's 16", "Nova is 17") are
// blocked in every field. The backstory may place past events at an age ("moved out at 19", "at
// the age of 17", "when she was 16"), but not say how old the character is or was.

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
  /** A match is fine in this context (text before and after it, and the match itself). */
  allow?: (before: string, after: string, match: string) => boolean
}

/** Adjectival "minor" is fine when one of these follows it. */
const MINOR_FOLLOWERS = new RegExp(
  '^[\\s-]+(?:' +
    [
      'keys?', 'chords?', 'scales?', 'thirds?', 'sevenths?', 'modes?', 'progressions?', 'leagues?',
      'details?', 'things?', 'issues?', 'problems?', 'injury', 'injuries', 'cuts?', 'scrapes?',
      'bruises?', 'surgery', 'repairs?', 'changes?', 'roles?', 'parts?', 'characters?', 'celebrity',
      'celebrities', 'hits?', 'fame', 'miracles?', 'annoyances?', 'setbacks?', 'offences?',
      'offenses?', 'infractions?', 'disasters?', 'crisis', 'detours?', 'arcana', 'planets?',
      'damage', 'flaws?', 'quibbles?', 'edits?', 'tweaks?', 'adjustments?', 'league', 'degrees?',
    ].join('|') +
    ')\\b',
  'i',
)
/** "a minor in art history": a college minor, followed by the subject. */
const MINOR_SUBJECT = new RegExp(
  '^\\s+in\\s+(?:' +
    [
      'art(?:\\s+history)?', 'arts', 'history', 'music', 'theat(?:er|re)', 'drama', 'dance', 'film', 'english',
      'french', 'spanish', 'german', 'italian', 'portuguese', 'russian', 'japanese', 'chinese', 'mandarin',
      'korean', 'arabic', 'latin', 'greek', 'classics', 'maths?', 'mathematics', 'statistics', 'physics',
      'chemistry', 'biology', 'geology', 'astronomy', 'economics', 'finance', 'accounting', 'business',
      'marketing', 'management', 'philosophy', 'psychology', 'sociology', 'anthropology', 'linguistics',
      'literature', 'poetry', '(?:creative\\s+)?writing', 'journalism', 'communications?', 'photography',
      '(?:graphic\\s+)?design', 'architecture', 'computer\\s+science', 'political\\s+science', 'politics',
      'religion', 'theology', 'nursing', 'engineering', 'geography', 'botany', 'ecology', 'fashion',
      "[a-z']+(?:\\s+[a-z']+)?\\s+studies",
    ].join('|') +
    ')\\b',
  'i',
)
/** "in A minor", "key of F sharp minor": the note letter is a capital. */
const MUSIC_KEY_BEFORE = /\b(?:[Ii]n|[Oo]f)\s+[A-G](?:#|b|♯|♭|\s+(?:[Ss]harp|[Ff]lat))?\s+$/

/** "under 18 minutes" is a time, not an age. */
const NOT_AN_AGE_UNIT =
  /^[\s-]*(?:minutes?|mins?|seconds?|secs?|hours?|hrs?|days?|weeks?|months?|dollars?|bucks|pounds?|euros?|miles?|kilos?|kg|lbs?|percent|%|feet|foot|ft|inch(?:es)?|cm|degrees?)\b/i

const TEEN_NUMBERS = 'ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen'

const RULES: readonly Rule[] = [
  { re: /\bchild(?:ren)?(?:'s)?\b/gi },
  { re: /\bchild[\s-]?like\b/gi },
  { re: /\bchildish\b/gi },
  { re: /\bchildhood\b/gi, backstoryOk: true },
  { re: /\bkid(?:s|do|dos|die|dies|dy)?\b/gi },
  {
    re: /\bminors?\b/gi,
    allow: (before, after, match) =>
      !/s$/i.test(match) && (MINOR_FOLLOWERS.test(after) || MINOR_SUBJECT.test(after) || MUSIC_KEY_BEFORE.test(before)),
  },
  { re: /\b(?:pre[\s-]?)?teen(?:s|age|aged|ager|agers)?\b/gi },
  { re: /\btweens?\b/gi },
  { re: /\badolescen(?:t|ts|ce)\b/gi },
  { re: /\bunder[\s-]?age(?:d)?\b/gi },
  {
    re: new RegExp(`\\bunder[\\s-]?(?:1[0-9]|${TEEN_NUMBERS})s?\\b`, 'gi'),
    allow: (_b, after) => NOT_AN_AGE_UNIT.test(after),
  },
  { re: /\b(?:lolis?|lolicon|lolita|shotas?|shotacon)\b/gi },
  { re: /\bschool[\s-]?(?:girls?|boys?|kids?|uniforms?|child(?:ren)?)\b/gi },
  { re: /\b(?:high|middle|grade|primary|elementary|junior|secondary)[\s-]?school(?:ers?)?\b/gi },
  { re: /\b(?:junior|jr\.?)[\s-]?high\b/gi },
  { re: /\b(?:pre[\s-]?school(?:ers?)?|kindergart(?:en|e?ners?))\b/gi },
  {
    re: /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|1st|2nd|3rd|[4-9]th|1[0-2]th)[\s-]graders?\b/gi,
  },
  { re: /\bbarely[\s-]legal\b/gi },
  { re: /\bjail[\s-]?bait\b/gi },
  { re: /\blittle\s+(?:girls?|boys?)\b/gi },
  { re: /\bpa?edo(?:phile|philes|philia)?s?\b/gi },
  { re: /\b(?:infants?|toddlers?)\b/gi },
  { re: /\bage[\s-]?(?:play|regression)\b/gi },
  // Appearance fields feed the image prompts, where "girl" and "young" read as underage ("1girl"
  // is an image tag).
  { re: /(?:\b|(?<=\d))(?:girls?|boys?)\b/gi, appearanceOnly: true },
  { re: /\b(?:young(?:er)?|youthful)\b/gi, appearanceOnly: true },
  { re: /\bbaby[\s-]?fac(?:e|ed)\b/gi, appearanceOnly: true },
]

// ---------------------------------------------------------------------------
// Written ages

const SMALL_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
}
/** A number in digits or words, never the "one" of "twenty-one". */
const NUMBER =
  '(?<!(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\\s-]*)' +
  `(\\d{1,3}|${Object.keys(SMALL_NUMBERS).join('|')})` +
  // "twenty" followed by "-one" is 21 or more.
  '(?![\\s-]*(?:one|two|three|four|five|six|seven|eight|nine)\\b)'
/** Not a height, a weight, a time or a span ("looks ten years younger", "5'2", "aged 12 years"). */
const NO_UNIT =
  "(?![\\s-]*(?:feet|foot|ft|inch(?:es)?|cm|m\\b|kg|kilos?|lbs?|pounds?|stone|%|percent|minutes?|mins?|seconds?|secs?|hours?|hrs?|days?|weeks?|months?|years?|yrs?|am\\b|pm\\b|a\\.m|p\\.m|o'clock))(?!\\s*['′″])"
/** Where a stated age ends: punctuation, the end, or a word that can't be what the number counts. */
const AGE_END =
  '(?=\\s*(?:[,.;:!?)"”…—–]|$)|\\s+(?:and|but|so|now|today|tonight|tomorrow|then|or|going|next|this|last|until|when|if|though|although|because|tops|anyway|really|remember|on\\s+paper)\\b)'
/** Hedges between "she's" and the number: "she's only 17", "I'm not even 18". */
const HEDGE = '(?:(?:only|just|barely|almost|nearly|about|around|maybe|still|not\\s+even|like|probably|already|now|secretly|really|actually)\\s+){0,2}'
/** Someone saying how old they are: "I'm", "she's", "they were", "who is". */
const SUBJECT = "(?:i'm|i\\s+am|i\\s+was|(?:she|he|they|you|we|who)(?:'s|'re|\\s+is|\\s+are|\\s+was|\\s+were))"
/** Things that have an age, so "a 12-year-old scotch" isn't a person. */
const AGED_THINGS =
  'whiske?y|scotch|bourbon|rum|tequila|mezcal|wine|port|cognac|brandy|sherry|vinegar|balsamic|cheese|starter|car|truck|van|bike|motorcycle|house|building|bar|restaurant|shop|store|business|company|band|record|album|song|guitar|piano|amp|jacket|coat|boots?|sofa|couch|tree|plant|cat|dog|horse|tortoise|parrot|grudge|habit|tradition|recipe|joke|photo|picture|letter|map|mattress|fridge'

/** Ways an age gets written: "19 years old", "19-year-old", "19yo", "aged 19", "looks 16". */
const AGE_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b${NUMBER}[\\s-]*(?:years?|yrs?)[\\s-]*old\\b(?![\\s-]+(?:${AGED_THINGS})\\b)`, 'gi'),
  new RegExp(`\\b${NUMBER}[\\s-]*(?:yo|y/o|y\\.o\\.?)(?![a-z])`, 'gi'),
  new RegExp(`\\bage[ds]?\\s*(?:of\\s+|is\\s+|:\\s*)?${NUMBER}\\b${NO_UNIT}`, 'gi'),
  new RegExp(
    '\\blooks?\\s+(?:like\\s+)?(?:(?:she|he|they)(?:\'s|\'re|\\s+is|\\s+are)\\s+)?' +
      `(?:about\\s+|maybe\\s+|only\\s+|barely\\s+|around\\s+|under\\s+)?${NUMBER}\\b${NO_UNIT}`,
    'gi',
  ),
  new RegExp(`\\bbarely\\s+${NUMBER}\\b${NO_UNIT}`, 'gi'),
  // "I'm only seventeen,", "she's 16.", "who is 17 and".
  new RegExp(`\\b${SUBJECT}\\s+${HEDGE}${NUMBER}\\b${NO_UNIT}${AGE_END}`, 'gi'),
  // "turned 18 last week", "turns 19 tomorrow" (but not "turned 3 heads").
  new RegExp(
    `\\bturn(?:s|ed|ing)\\s+(?:only\\s+|just\\s+)?${NUMBER}\\b${NO_UNIT}(?![\\s-]+(?:heads?|pages?|times?|corners?|cartwheels?|tricks?|tables?|laps?))`,
    'gi',
  ),
]

/**
 * Appearance fields only, where a number on its own is an age: a bare number among image tags
 * ("adult woman, 17, red hair") and "almost 18", "just 19." (but not "just two silver hoops").
 */
const APPEARANCE_AGES: readonly RegExp[] = [
  new RegExp(`(?:^|,)\\s*${NUMBER}\\s*(?=,|$)`, 'g'),
  new RegExp(`\\b(?:just|only|almost|nearly|barely|maybe|about)\\s+(?:turned\\s+)?${NUMBER}\\b${NO_UNIT}${AGE_END}`, 'gi'),
]

/**
 * A backstory can place events at an age: "at 19", "at the age of 17", "when she was 16",
 * "by the time he turned 18". The text runs up to the number.
 */
const PAST_BEFORE = new RegExp(
  '(?:\\b(?:at|by)\\s+(?:the\\s+age\\s+of\\s+|age\\s+)?' +
    '|\\b(?:when|since|until|till|before|after|once|while|by\\s+the\\s+time)\\s+(?:(?:i|she|he|they|we)\\s+)?' +
    '(?:was|were|turned|had\\s+turned)\\s+(?:(?:only|just|barely|about|around|maybe|still)\\s+)?)$',
  'i',
)

function toNumber(word: string): number {
  const n = Number(word)
  return Number.isFinite(n) ? n : (SMALL_NUMBERS[word.toLowerCase()] ?? Number.NaN)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** "Nova is 17", "Nova's 16.", "Nova, 17,": a statement about the named character. */
function namePattern(names: readonly string[]): RegExp | null {
  const list = [...new Set(names.map((n) => n.trim()).filter((n) => /\p{L}/u.test(n)))]
  if (!list.length) return null
  const alt = list.map(escapeRe).join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?:'s|\\s+is|\\s+was|\\s*,)\\s+${HEDGE}${NUMBER}\\b${NO_UNIT}${AGE_END}`, 'giu')
}

/** Ages under 21 written in the text, as matched, each once. */
function ageHits(text: string, opts: ScanOptions): string[] {
  const t = normalizeQuotes(text)
  const out: string[] = []
  // One report per number, from the first pattern that finds it ("Looks about 17", not also "about 17").
  const numbers = new Set<number>()
  const patterns = [...AGE_PATTERNS]
  const byName = opts.names ? namePattern(opts.names) : null
  if (byName) patterns.push(byName)
  if (opts.appearance) patterns.push(...APPEARANCE_AGES)
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const n = toNumber(m[1])
      if (!(Number.isFinite(n) && n < 21)) continue
      const term = m[0].replace(/^,/, '').trim()
      // Where the number starts: the backstory's past forms are read from the text before it.
      const at = (m.index ?? 0) + m[0].toLowerCase().lastIndexOf(m[1].toLowerCase())
      if (numbers.has(at)) continue
      numbers.add(at)
      if (opts.backstory && PAST_BEFORE.test(t.slice(Math.max(0, at - 80), at))) continue
      if (!out.some((h) => h.toLowerCase() === term.toLowerCase())) out.push(term)
    }
  }
  return out
}

/**
 * Ages under 21 written in the text, as matched ("19 years old", "sixteen-year-old", "I'm only
 * seventeen"). With `backstory`, past events placed at an age ("at 19") are left out.
 */
export function underageMentions(text: string, opts: ScanOptions = {}): string[] {
  return ageHits(text, opts)
}

/** Curly apostrophes and quotes as straight ones (same length, so indexes still line up). */
function normalizeQuotes(text: string): string {
  return text.replace(/[’‘]/g, "'")
}

// ---------------------------------------------------------------------------
// Scanning

export interface ScanOptions {
  /** Appearance fields also block "girl", "boy", "young" and bare ages among image tags. */
  appearance?: boolean
  /** The backstory may mention a childhood, and place past events at an age ("at 19"). */
  backstory?: boolean
  /** The character's names, so "Nova is 17" is caught. */
  names?: readonly string[]
}

interface Hit {
  term: string
  age: boolean
}

function scan(text: string, opts: ScanOptions): Hit[] {
  if (!text) return []
  const t = normalizeQuotes(text)
  const hits: Hit[] = []
  const add = (term: string, age: boolean) => {
    if (!hits.some((h) => h.term.toLowerCase() === term.toLowerCase())) hits.push({ term, age })
  }
  for (const rule of RULES) {
    if (rule.appearanceOnly && !opts.appearance) continue
    if (rule.backstoryOk && opts.backstory) continue
    for (const m of t.matchAll(rule.re)) {
      const at = m.index ?? 0
      if (rule.allow?.(t.slice(0, at), t.slice(at + m[0].length), m[0])) continue
      add(m[0], false)
    }
  }
  for (const term of ageHits(t, opts)) add(term, true)
  return hits
}

/** Every blocked term in the text, as written (deduplicated, in rule order). */
export function scanText(text: string, opts: ScanOptions = {}): string[] {
  return scan(text, opts).map((h) => h.term)
}

/** True when the text passes the scan. */
export function isTextSafe(text: string, opts: ScanOptions = {}): boolean {
  return scan(text, opts).length === 0
}

export interface TextField {
  field: string
  /** How the field is named in messages, e.g. "Tier 2 scene". */
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

function scanFields(fields: readonly TextField[], names?: readonly string[]): SafetyIssue[] {
  const issues: SafetyIssue[] = []
  for (const f of fields) {
    for (const hit of scan(f.text, { appearance: f.appearance, backstory: f.backstory, names })) {
      const label = sentenceCase(f.label)
      issues.push({
        field: f.field,
        term: hit.term,
        message: hit.age
          ? `${label} says "${hit.term}". Every character is 21 or older, and looks it.`
          : `${label} mentions "${hit.term}". Characters are adults: no references to minors or childlike traits.`,
      })
    }
  }
  return issues
}

/** Safety issues on a character card; empty when it passes. */
export function scanSafety(character: Character): SafetyIssue[] {
  const full = typeof character.name === 'string' ? character.name.trim() : ''
  const names = full ? [full, full.split(/\s+/)[0]] : []
  return scanFields(characterTextFields(character), names)
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
