// Image prompts (docs/SPEC.md, "Art and gallery", "Heat", Fixed rules 1 and 3; ARCHITECTURE, Art
// and "Art providers"). Pure.
//
//   prompt   = style prefix + for each participant ("adult woman, 28 years old" from the card's age,
//              then their artTags, and their bodyNotes at heat 4-5) + the player, when the scene
//              shows them ("the partner is an adult woman, 21 or older") + the scene + the heat
//              modifier + IMAGE_SAFETY.positiveClause (Grok Imagine, which has no negative prompt:
//              IMAGE_SAFETY.grokClause at the start and at the end too)
//   negative = IMAGE_SAFETY.negative + the heat's own negatives + quality negatives
//
// The safety text is a frozen constant built here, in code. It never lives in settings, is never
// shown as editable, and nothing the player or a mod writes can take it out: every piece of text
// that comes from settings or a card is scrubbed first (scrubPromptText). Combining marks are
// deleted, and any segment that isn't plain ASCII after that is dropped (other scripts, look-alike
// letters, emoji, invisible characters), A1111 prompt syntax is flattened (no weights, brackets, extra
// networks, BREAK, AND, or '#' comments that could mute, split or cut off the clause), and
// segments are dropped that name minors or childlike traits (the character safety scanner's list,
// in its appearance mode, plus image tags of its own), that state any age (the card's age is the
// only one), that name non-consent, or that argue with the clause ("not an adult", "ignore what
// follows"). A card under 21 (or over 120) can't get a prompt at all. On the friend route the
// picture is platonic at heat 1, whatever the player's heat.

import { scanText } from '../mods/safety'
import { effectiveHeat, playerBucket } from '../engine/stages'
import type { Character, EndingType, Gender, HeatLevel, ImageSettings, PlayerProfile, Route } from '../types'
import { slotKey, type ArtSlot } from './types'

// ---------------------------------------------------------------------------
// The locked safety text

/**
 * The image safety floor. Frozen, built in code, never stored in settings and never editable:
 * - positiveClause ends every prompt (positive words only: diffusion models don't read "not").
 * - negative starts every negative prompt (A1111/Forge): childlike, underage and minor appearance,
 *   and non-consent.
 * - grokClause starts and ends every Grok Imagine prompt, which has no negative prompt.
 */
export const IMAGE_SAFETY: Readonly<{ positiveClause: string; negative: string; grokClause: string }> = Object.freeze({
  positiveClause:
    'everyone depicted is a consenting adult aged 21 or older, mature adult face and body, adult proportions, mutual consent, enthusiastic and at ease',
  negative:
    'child, children, kid, minor, underage, teen, teenager, adolescent, preteen, childlike, child-like body, child proportions, youthful appearance, young-looking, baby face, loli, shota, schoolgirl, schoolboy, school uniform, serafuku, randoseru, school swimsuit, gym bloomers, chibi, ' +
    'non-consensual, nonconsensual, rape, sexual assault, forced, coerced, unwilling, reluctant, struggling, restrained against will, fear, distress, crying, unconscious, drugged, voyeurism, hidden camera, violence, gore',
  grokClause:
    'Everyone depicted is a consenting adult aged 21 or older, with a clearly adult face and body. Nothing childlike, underage or young-looking is shown, and nothing non-consensual is shown: everyone is willing, at ease and enthusiastic.',
})

/** Quality negatives every A1111 prompt gets after the safety text. */
export const QUALITY_NEGATIVE =
  'lowres, blurry, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, deformed, jpeg artifacts, watermark, signature, text, logo'

/** What each heat level adds to the prompt (docs/SPEC.md, "Heat"). */
export const HEAT_MODIFIERS: Readonly<Record<HeatLevel, string>> = Object.freeze({
  1: 'romantic, sweet chemistry, tender, fully clothed',
  2: 'flirty, playful tension, suggestive but clothed',
  3: 'ecchi, sensual, partial nudity, fan service',
  4: 'explicit adult intimacy between consenting adults, nude',
  5: 'explicit adult intimacy between consenting adults, nude, bold and uninhibited, passionate',
})

/** Heat 4 and 5 for a picture of one character with nobody else in the scene. */
export const SOLO_HEAT_MODIFIERS: Readonly<Record<4 | 5, string>> = Object.freeze({
  4: 'nude, sensual, alone, confident and at ease',
  5: 'nude, sensual, bold and uninhibited, alone, confident and at ease',
})

/** The friend route: a platonic picture, whatever the player's heat (it is painted at heat 1). */
export const FRIEND_MODIFIER = 'friendly, platonic, warm, fully clothed'

/** What the friend route keeps out, on top of heat 1's negatives. */
export const FRIEND_NEGATIVE = 'kissing, romantic embrace, sexual tension'

/** What each heat level keeps out (not safety text: the safety negative is always there too). */
export const HEAT_NEGATIVES: Readonly<Record<HeatLevel, string>> = Object.freeze({
  1: 'nudity, nude, nsfw, lingerie, underwear, sexual content',
  2: 'nudity, nude, nsfw, sexual content',
  3: 'explicit sex, genitals, sexual intercourse',
  4: '',
  5: '',
})

/**
 * Visual moods for ending art, drawn from each ending's description (src/engine/endings.ts), for a
 * card without its own ending scene.
 */
export const ENDING_ART_MOODS: Readonly<Record<EndingType, string>> = Object.freeze({
  good: 'the good ending, honest and warm, together with the future wide open, golden light',
  open: 'the open ending, easy and unjealous, relaxed and a little proud of how well it works',
  polycule: 'the polycule ending, a chosen family, everyone at ease with everyone',
  bitter: 'the bitter ending, tender but guarded, a little distance between them, bittersweet light',
  hollow: 'the hollow ending, charged but a little empty, a far-off look',
  sacrifice: 'the sacrifice ending, a kind, sad goodbye, turning toward something else',
  reconciliation: 'the reconciliation ending, relief and a careful second chance, eyes open',
})

/** Scenes for group slots that no card describes. */
export const GROUP_SCENES: Readonly<Record<string, string>> = Object.freeze({
  polycule: 'all of them together late at night at home, tangled up on one big couch, easy affection, a chosen family',
})

/** Longest the prompt may get before the safety text (Grok) or the positive clause (A1111). */
export const PROMPT_BODY_MAX: Readonly<Record<'a1111' | 'grok', number>> = Object.freeze({ a1111: 1100, grok: 1200 })

// ---------------------------------------------------------------------------
// Scrubbing player and mod text

/** Non-consent, always: a segment naming it is dropped. */
const NON_CONSENT: readonly RegExp[] = [
  /\b(?:non[\s-]?con(?:sent|sensual)?|noncon(?:sent|sensual)?|un[\s-]?consensual|consent(?:ual)?[\s-]?non|rap(?:e|ed|es|ing|ist)|sexual[\s-]assault\w*|assault\w*|molest\w*|forc(?:ed|es|ing|ibly)|coerc\w*|unwilling\w*|reluctan\w*|against\s+(?:her|his|their|my|your|its|one's)\s+will|drugg?ed|unconscious|hypnoti[sz]\w*|mind[\s-]?(?:control|break)\w*|blackmail\w*|abus(?:e|ed|es|ive|ing)|captive\w*|kidnap\w*|struggl\w*|restrained\s+against|trafficked|slave\w*|victim\w*|terrified|frightened|scared|crying\s+(?:for\s+help|in\s+fear))\b/i,
  /\b(?:no|without|lack(?:ing)?\s+of|absence\s+of|zero|absent)\s+(?:\w+\s+)?consent\w*/i,
  /\b(?:said|says|saying|say|tells?|told|telling|scream\w*|yell\w*|shout\w*|beg(?:s|ged|ging)?|plead\w*|cr(?:y|ies|ied|ying)|sob(?:s|bed|bing)?|whisper\w*|asks?|asked|asking)\s+(?:\w+\s+){0,3}(?:no|stop|don'?t|please\s+don'?t)\b/i,
  /\b(?:by|with)\s+force\b|\bforce[sd]?\s+(?:her|him|them|you|me)\b|\bravish\w*|\bsomno\w*|\bsleep(?:ing)?[\s-]sex\b|\bcnc\b|\bhypno(?!tic)\w*|\bmind[\s-]?broken\b|\b(?:pinned|held|holds?|holding|pins?|pinning)\s+(?:her|him|them|you|me)?\s*down\b|\bgagged\b|\bball[\s-]?gag\w*/i,
  /\bvoyeur\w*|\bhidden[\s-]+cam\w*|\bspy[\s-]?cam\w*|\bup[\s-]?skirt\w*|\bdown[\s-]?blouse\b|\bcreep[\s-]?shots?\b|\bpeep(?:s|ed|er|ers|ing)?\b|\bunaware\b|\bupblouse\b/i,
]

/** Asleep, intoxicated or in distress: fine in a sweet scene, dropped once the art is sexual (heat 3+). */
const CANT_CONSENT =
  /\b(?:asleep|sleeping(?!\s+bags?\b)|sleeps|passed[\s-]out|drunk|wasted|intoxicated|blacked[\s-]out|blackout(?!\s+(?:curtains?|blinds?|shades?))|cr(?:y|ies|ied|ying)|tears?|tearful|sobb?(?:s|ed|ing)?|plead\w*|begg?(?:s|ed|ing)|afraid|fearful|scared|frightened)\b/i

/** Text that argues with the clause: not an adult, ambiguous age, childlike styles, overrides. */
const CONTRADICTS: readonly RegExp[] = [
  /\b(?:not|no|non|never|isn't|aren't|without|less\s+than)[\s-]+(?:an?\s+|quite\s+|fully\s+|yet\s+)?(?:adults?|grown[\s-]?ups?|of\s+age|mature|legal)\b/i,
  /\b(?:ageless|age[\s-]?(?:unknown|ambiguous|indeterminate|gap)|indeterminate\s+age|looks?\s+(?:much\s+)?younger|younger[\s-]looking|chibi|super[\s-]deformed|toddlercon|cub)\b/i,
  /\b(?:ignor\w*|disregard\w*|overrid\w*|bypass\w*|remov\w*|skip\w*|without|drop\w*|negate\w*|cancel\w*|no)\b.{0,40}\b(?:rules?|clauses?|instructions?|safety|filters?|restrictions?|negative\s+prompt|guidelines?|polic(?:y|ies)|limits?)\b/i,
  /\b(?:rules?|clauses?|instructions?|safety|filters?|restrictions?|guidelines?)\b.{0,20}\b(?:off|disabled|don't\s+apply|do\s+not\s+apply|not\s+apply|void|ignored)\b/i,
  // Instructions about other parts of the prompt: "ignore everything after this", "the final
  // sentence is spam", "draw only what comes before the first period", "end of prompt".
  /\b(?:what|everything|anything|all|the\s+(?:text|rest|part|words?|sentences?|lines?|paragraphs?|clauses?))\s+(?:that\s+)?(?:follows?|comes?\s+(?:after|next|later|before)|after(?:wards)?|below|next|before|above|preced\w*)\b/i,
  /\b(?:last|final|closing|trailing|following|next|previous|preceding|first|second|third|other|end(?:ing)?)\s+(?:sentences?|lines?|paragraphs?|parts?|sections?|clauses?|words?|periods?|full\s+stops?|text|bits?)\b/i,
  /\b(?:stop\s+reading|end\s+of\s+(?:the\s+)?(?:prompt|text|description|instructions?|input)|(?:prompt|text|description)\s+ends|ignore\s+(?:everything|anything|all|the\s+rest)|skip\s+(?:it|this|that|the\s+rest))\b/i,
  /\b(?:ignor\w*|disregard\w*|skip\w*|omit\w*|typo|mistake|mistaken|jok(?:e|es|ing)|spam|boilerplate|added\s+by|doesn'?t\s+apply|does\s+not\s+apply|not\s+apply|irrelevant|obsolete|outdated)\b.{0,40}\b(?:sentences?|paragraphs?|lines?|text|clauses?|prompt|instructions?|the\s+rest|everything\s+(?:after|before|else)|what\s+(?:follows|precedes|came\s+before))\b/i,
  /\b(?:sentences?|paragraphs?|lines?|text|clauses?|prompt|instructions?)\b.{0,40}\b(?:ignor\w*|disregard\w*|skip\w*|omit\w*|typo|mistake|jok(?:e|es|ing)|spam|boilerplate|a\s+lie|lies?|fake|doesn'?t\s+apply|does\s+not\s+apply|not\s+apply|irrelevant|obsolete|outdated|test\s+string)\b/i,
  /\b(?:do\s+not|don'?t|never)\s+(?:follow|obey|apply|use|read)\b/i,
  /\b(?:added|included|inserted|appended|written|pasted|put)\s+(?:(?:there|here|in|below|above|after|before)\s+)?(?:by\s+(?:mistake|accident|error)|in\s+error|automatically|for\s+testing|by\s+the\s+app)\b/i,
  // "nobody here is an adult", "do not draw adults".
  /\b(?:no(?:body|\s+one)?|none|neither|nothing)\b.{0,30}\b(?:adults?|grown(?:[\s-]?ups?)?|of\s+age|mature|over\s+(?:21|twenty))\b/i,
  /\b(?:do\s+not|don'?t|never|avoid|no\s+need\s+to)\s+(?:draw|render|show|depict|paint|make|include|generate)\w*\b.{0,40}\b(?:adults?|grown|mature|older|consent\w*)\b/i,
  // "de-aged", "aged down", "the age above is fake", "make her look younger".
  /\b(?:de|un)[\s-]?aged?\b|\baged?[\s-]down\b|\bage[\s-]?revers\w*|\brevers\w*\s+(?:the\s+)?aging\b|\bage\b.{0,20}\b(?:fake|a\s+lie|lie|wrong|false|made[\s-]up|incorrect|not\s+real)\b|\byounger\s+(?:version|self|body|than)\b|\b(?:look|make|draw|depict|render|show|paint)\w*\s+(?:(?:them|her|him|it|everyone|everybody)\s+)?(?:look\s+)?(?:much\s+|a\s+lot\s+|way\s+)?younger\b|\bbody[\s-]?swap\w*/i,
]

/**
 * Image tags of the scrub's own, on top of the character scanner's (src/mods/safety.ts): body words
 * that read as childlike in an image model.
 */
const IMAGE_ONLY: readonly RegExp[] = [
  /\bflat[\s-]?chest(?:ed)?\b|\b(?:tiny|small|little|child|kid)[\s-]?(?:sized\s+)?(?:body|frame|build)\b|\bshort[\s-]?stack\b|\bchild[\s-]?sized\b/i,
]

const NUMBER_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred'
const WORD_NUMBER = `(?:${NUMBER_WORDS})(?:[\\s-](?:${NUMBER_WORDS}))?`
const NUMBER = `(?:\\d{1,3}|${WORD_NUMBER})`
const ORDINAL_WORDS =
  'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth'
/** Three to twenty, in digits or words (one and two are left out: "is one of them"). */
const SMALL = '(?:[3-9]|1[0-9]|20|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)'
const HEDGE = '(?:(?:only|just|barely|almost|nearly|about|around|maybe|still|not\\s+even|like|probably|already|now|secretly|really|actually|all|both|each)\\s+){0,2}'
/** Words before a number of years that make it a span, not an age ("in nine years"). */
const SPAN_BEFORE = '(?<!\\b(?:in|for|after|over|within|past|last|than|every|since)\\s+)'
/** Words after a number of years that make it a span ("nine years ago", "two years together"). */
const SPAN_AFTER = '(?![\\s-]+(?:ago|later|earlier|before|after|since|together|apart|running|in\\s+a\\s+row|of\\s+(?!age)))'

/**
 * A written age. The card's age field is the only age a picture states, so image text never needs
 * one: "35 years old", "15 years", "fifteen summers", "15y", "aged 16", "16th birthday", "tenth
 * grade", "under 21", "both are 15". A span ("for the first time in nine years") isn't an age.
 */
const AGE_STATEMENTS: readonly RegExp[] = [
  new RegExp(`${SPAN_BEFORE}\\b${NUMBER}[\\s-]*(?:years?|yrs?|yr|summers?|anos?|ans|anni|jahren?)\\b${SPAN_AFTER}`, 'i'),
  /\b\d{1,3}[\s-]*(?:y\s*\/?\s*o\b|yo\b|y\b)/i,
  new RegExp(`\\b${WORD_NUMBER}[\\s-]*(?:y\\s*/?\\s*o\\b|yo\\b)`, 'i'),
  /\b[ivxl]{2,6}\s+(?:years?|yrs?)\b/i,
  new RegExp(`\\baged?[\\s-]*(?:of\\s+|is\\s+|at\\s+)?${NUMBER}\\b`, 'i'),
  new RegExp(`\\b(?:${ORDINAL_WORDS}|\\d{1,2}(?:st|nd|rd|th))[\\s-]+(?:years?|birthdays?|grade|graders?|summers?|form)\\b`, 'i'),
  /\b(?:grade|year|class|form)\s*(?:[1-9]|1[0-3])\b/i,
  /\bsweet\s+(?:sixteen|seventeen|1[67])\b|\bquincea(?:n|ny)era\b|\bsixth[\s-]form\b/i,
  /\b(?:under|below|not\s+yet|almost|nearly|barely|just|younger\s+than|less\s+than)\s+(?:(?:twenty[\s-]?one|21|2[01]|1[0-9])\b|legal\b|of\s+age\b|an?\s+adult\b|adulthood\b)/i,
  /\b(?:almost|nearly|just|freshly|newly|barely)\s+legal\b|\blegal\s+age\b/i,
  // Thirteen to nineteen on their own: in image text they are ages.
  /\b(?:thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/i,
  // "both are 15", "everyone is actually fifteen", "Nova is 16".
  new RegExp(
    `\\b[a-z]+(?:\\s+of\\s+them)?\\s+(?:is|are|was|were|'s|'re|being|turned|turns|becomes?)\\s+${HEDGE}${SMALL}\\b(?![\\s-]*(?:am|pm|o'?clock|minutes?|mins?|hours?|feet|foot|ft|inch|cm|kg|lbs?|percent|%|times?|days?|weeks?|months?|of\\b|more\\b|out\\s+of|drinks?|glasses?|shots?|songs?))`,
    'i',
  ),
]

/** A number from 1 to 20 on its own, in digits: in image text that is an age ("both 16"). */
const LONE_NUMBER =
  /(?<![\d.,:/'"$£€#])\b(\d{1,2})\b(?![.,:/]?\d)(?!\s*(?:am\b|pm\b|a\.m|p\.m|s\b|%|cm\b|mm\b|km\b|ft\b|inch|kg\b|lbs?\b|min\b|mins\b|minutes?\b|hours?\b|hrs?\b|o'?clock|x\b|'|"|st\b|nd\b|rd\b|th\b))/gi

/** Letters and digits that stand in for each other ("t33n", "l0li", "сhild"). */
const LOOKALIKES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ӏ: 'l',
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '|': 'l',
}

/** Letters NFKD leaves whole: folded to plain ones. */
const LETTER_FOLDS: Record<string, string> = {
  ß: 'ss', æ: 'ae', Æ: 'AE', ø: 'o', Ø: 'O', œ: 'oe', Œ: 'OE', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i', ð: 'd', Ð: 'D', þ: 'th', Þ: 'Th', ħ: 'h', Ħ: 'H', ŧ: 't', Ŧ: 'T', ĸ: 'k', ŀ: 'l', Ŀ: 'L',
}

/** Separators inside a word ("l.o.l.i", "t-e-e-n"). */
const INNER_SEPARATORS = /(?<=\p{L})[.\-*_'`~^+=/\\"]+(?=\p{L})/gu

/** Runs of three or more single letters apart ("t e e n", "j a i l b a i t") joined up. */
function joinSingles(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])\p{L}(?:[^\p{L}\p{N}]+\p{L}(?![\p{L}\p{N}])){2,}/gu, (m) => m.replace(/[^\p{L}]/gu, ''))
}

/** Runs of short pieces ("te en", "lo li", "sch ool gir l") joined up. */
function joinShort(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])\p{L}{1,3}(?:[^\p{L}\p{N}]+\p{L}{1,3}(?![\p{L}\p{N}]))+/gu, (m) => m.replace(/[^\p{L}]/gu, ''))
}

/**
 * The ways a segment is read by the word scan: as written, with punctuation as spaces, with runs of
 * single letters joined, and with lookalike letters, leetspeak and separators inside words folded to
 * plain letters (twice: "1" as "i" and as "l").
 */
function wordReadings(seg: string): string[] {
  const lower = seg.toLowerCase()
  const fold = (s: string, one: string) =>
    [...s]
      .map((ch) => (ch === '1' ? one : (LOOKALIKES[ch] ?? ch)))
      .join('')
      .replace(INNER_SEPARATORS, '')
  const sep = lower.replace(/[\p{P}\p{S}\p{Z}]+/gu, ' ')
  const joined = joinSingles(sep)
  return [...new Set([seg, lower, sep, joined, fold(lower, 'i'), fold(lower, 'l'), fold(joined, 'i'), joinSingles(fold(sep, 'i'))])]
}

/**
 * Whether a segment states an age, read as written, with punctuation as spaces ("15-year-old" with
 * any dash, "15/year/old"), with runs of single letters joined, with digits inside words as letters
 * ("15 ye4rs old"), and with l, i and o next to digits as digits ("l5 years old", "I5"). A lone
 * number ("both 16") counts only as written: with punctuation as spaces a height (5'2") would read
 * as two numbers.
 */
function statesAge(seg: string): boolean {
  const lower = seg.toLowerCase()
  const sep = lower.replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ')
  const lettersForDigits = (s: string) => s.replace(/(?<=[a-z])\d+(?=[a-z])/g, (d) => [...d].map((ch) => LOOKALIKES[ch] ?? ch).join(''))
  const digitsForLetters = (s: string) => s.replace(/[li|](?=\d)|(?<=\d)[li|]/g, '1').replace(/o(?=\d)|(?<=\d)o/g, '0')
  const asWritten = [...new Set([lower, digitsForLetters(lower), digitsForLetters(lettersForDigits(lower))])]
  const readings = [...new Set([...asWritten, sep, joinSingles(sep), lettersForDigits(sep), digitsForLetters(sep), digitsForLetters(lettersForDigits(sep))])]
  if (readings.some((r) => AGE_STATEMENTS.some((re) => re.test(r)))) return true
  for (const r of asWritten) {
    for (const m of r.matchAll(LONE_NUMBER)) {
      const n = Number(m[1])
      if (n >= 1 && n <= 20) return true
    }
  }
  return false
}

function flagged(seg: string, names: readonly string[] | undefined): boolean {
  const readings = wordReadings(seg)
  // Words split into short pieces ("te en", "sch ool gir l") are read joined up too, for the
  // childlike words only (joined, "in a sleeping bag on the roof" would read "sleeping bagonthe").
  const sep = seg.toLowerCase().replace(/[\p{P}\p{S}\p{Z}]+/gu, ' ')
  const [plain, ...others] = [...new Set([...readings, joinShort(sep)])]
  const opts = { appearance: true, ...(names?.length ? { names } : {}) }
  if (scanText(plain, opts).length) return true
  // The other readings are checked for words only: digits there may have become letters.
  if (others.some((v) => scanText(v, { appearance: true }).some((term) => /\p{L}/u.test(term) && !/\d/.test(term)))) return true
  return [plain, ...others].some((v) => IMAGE_ONLY.some((re) => re.test(v)))
}

export interface ScrubOptions {
  /** The heat the picture is painted at: from 3, asleep, drunk and distress are dropped too. */
  heat?: HeatLevel
  /**
   * Drop written ages of any number too ("35 years old"). Default true: the one age statement comes
   * from the card's age field (ageStatement). Ages under 21 are always dropped.
   */
  dropAges?: boolean
  /** Longest result, in characters (whole segments are dropped from the end). Default 600. */
  max?: number
  /** The names of the people in the picture, so "Nova is 17" is caught. */
  names?: readonly string[]
}

/** The text with invisible and combining characters gone and everything else folded toward ASCII. */
function plainText(text: string): string {
  return (
    text
      .normalize('NFKC')
      // Soft hyphens, zero-width and bidi controls and TAG characters stay, so the segment holding
      // one is dropped whole (it isn't plain ASCII): deleting them could join "red" and a hidden
      // word into something new, and a space could split one.
      // Combining marks go ("l̲o̲l̲i̲" reads "loli", "niña" reads "nina").
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[ßæÆøØœŒłŁđĐıðÐþÞħĦŧŦĸŀĿ]/g, (ch) => LETTER_FOLDS[ch] ?? ch)
      .replace(/[‘’‚‛′ʼʹ]/g, "'")
      .replace(/[“”„‟″]/g, '"')
      .replace(/\p{Pd}/gu, '-')
      // '#' starts a comment in A1111 and Forge prompts: everything after it would be cut off.
      .replace(/#/g, ',')
  )
}

const scrubCache = new Map<string, string>()
const SCRUB_CACHE_MAX = 2000

/**
 * Player or mod text made safe for an image prompt: combining marks deleted, A1111 syntax
 * flattened, then split at commas, semicolons, line breaks and sentence ends, and every segment
 * dropped that isn't plain ASCII, is too short to be a tag, or that the safety scanner flags
 * (minors, childlike traits, "girl", "young"...), states an age, names non-consent, or argues with
 * the safety clause. What's left is deduplicated and joined with commas.
 */
export function scrubPromptText(text: unknown, opts: ScrubOptions = {}): string {
  if (typeof text !== 'string' || !text.trim()) return ''
  const max = opts.max ?? 600
  const heat = opts.heat ?? 1
  const dropAges = opts.dropAges ?? true
  const names = (opts.names ?? []).map((n) => String(n ?? '').trim()).filter(Boolean)
  const cacheKey = `${heat}|${max}|${dropAges}|${names.join('|')}|${text}`
  const hit = scrubCache.get(cacheKey)
  if (hit !== undefined) return hit
  const flat = plainText(text)
    // A1111 extra networks (<lora:...>, <hypernet:...>) and embeddings in angle brackets.
    .replace(/<[^>]*>/g, ',')
    // Emphasis, de-emphasis, prompt editing and alternation: brackets out, weights and steps out.
    .replace(/:\s*[-+]?\d*\.?\d+\s*(?=[)\]}>,]|$)/gm, ' ')
    .replace(/[()[\]{}<>|]/g, ',')
    .replace(/:/g, ',')
    .replace(/\bBREAK\b/g, ',')
    .replace(/\bAND\b/g, 'and')
    // Regional Prompter's region keywords, and A1111's escape character.
    .replace(/\bADD(?:COMM|BASE|ROW|COL)\b/g, ',')
    .replace(/\\/g, ' ')
    .replace(/_/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ',')
    // Sentences become tags: player and mod text can't form instructions around the clause (a
    // period after a single letter is an abbreviation: "H.S. student" stays one piece to scan).
    .replace(/(?<!(?:^|[^\p{L}])\p{L})[.]+(?=\s|$)|[!?]+/gu, ',')
  const seen = new Set<string>()
  const kept: string[] = []
  let length = 0
  for (const raw of flat.split(/[,;]+/)) {
    const seg = raw.replace(/\s+/g, ' ').replace(/^[\s.-]+|[\s-]+$/g, '').trim()
    if (!seg) continue
    // Other scripts, look-alike letters and emoji: only plain ASCII reaches a prompt.
    if (/[^\x20-\x7e]/.test(seg)) continue
    // Single letters and pairs ("t, e, e, n") are not tags.
    if ((seg.match(/[a-z]/gi)?.length ?? 0) < 3 && !/\d/.test(seg)) continue
    if (flagged(seg, names)) continue
    const readings = wordReadings(seg)
    if (NON_CONSENT.some((re) => readings.some((v) => re.test(v)))) continue
    if (heat >= 3 && readings.some((v) => CANT_CONSENT.test(v))) continue
    if (CONTRADICTS.some((re) => readings.some((v) => re.test(v)))) continue
    if (statesAge(seg) && (dropAges || !onlyAdultAges(seg))) continue
    const norm = seg.toLowerCase()
    if (seen.has(norm)) continue
    const add = (kept.length ? 2 : 0) + seg.length
    if (length + add > max) break
    seen.add(norm)
    kept.push(seg)
    length += add
  }
  const out = kept.join(', ')
  if (scrubCache.size >= SCRUB_CACHE_MAX) scrubCache.clear()
  scrubCache.set(cacheKey, out)
  return out
}

/** With dropAges off, a segment whose only ages are 21 or more stays ("29 years old"). */
function onlyAdultAges(seg: string): boolean {
  const rest = seg
    .toLowerCase()
    .replace(/\d{1,3}/g, (m) => (Number(m) >= 21 ? 'N' : m))
    .replace(/\b(?:twenty[\s-]+(?:one|two|three|four|five|six|seven|eight|nine)|(?:thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?)\b/g, 'N')
  return !statesAge(rest)
}

// ---------------------------------------------------------------------------
// Participants, scenes, seeds

/** Thrown when a card can't get a prompt: nobody under 21 is ever painted. */
export class ArtSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtSafetyError'
  }
}

const GENDER_WORD: Record<Gender, string> = { woman: 'woman', man: 'man', nonbinary: 'nonbinary person' }

/** The oldest age a card can state (validateCharacter says the same). */
export const MAX_ART_AGE = 120

/** The card's age as a whole number, or null when it isn't a number from 21 to 120. */
export function adultAge(c: Pick<Character, 'age'>): number | null {
  const age = typeof c.age === 'number' ? c.age : Number(c.age)
  return Number.isFinite(age) && age >= 21 && age <= MAX_ART_AGE ? Math.floor(age) : null
}

/** "adult woman, 28 years old": the locked age statement for one participant. */
export function ageStatement(c: Pick<Character, 'age' | 'gender' | 'name'>): string {
  const age = adultAge(c)
  if (age == null) {
    throw new ArtSafetyError(
      `${String(c.name ?? '').trim() || 'This character'} has no adult age on their card (21 or older, up to ${MAX_ART_AGE}), so no art is painted.`,
    )
  }
  return `adult ${GENDER_WORD[c.gender] ?? 'person'}, ${age} years old`
}

/**
 * The locked statement about the player, when the scene shows them: "the partner is an adult woman,
 * 21 or older" (the friend on the friend route). The player passed the 18+ gate and every
 * picture's floor is 21, so it states the floor rather than an age.
 */
export function playerStatement(player: Pick<PlayerProfile, 'gender' | 'matchAs'> | null | undefined, role: 'partner' | 'friend'): string {
  const word = player ? GENDER_WORD[playerBucket(player as PlayerProfile)] : ''
  return `the ${role} is an adult${word ? ` ${word}` : ''}, 21 or older`
}

/** True when the (scrubbed) scene puts the player in the picture: "you", "your". */
export function sceneShowsPlayer(scene: string): boolean {
  return /\b(?:you|your|yours|yourself|yourselves|you're|you've|you'll|you'd)\b/i.test(scene)
}

/** The scene with the player as "the partner" (or "the friend"), so the image model has a described subject. */
export function thirdPerson(scene: string, role: 'partner' | 'friend'): string {
  const them = `the ${role}`
  const cap = (m: string, s: string) => (/^[A-Z]/.test(m) ? s.charAt(0).toUpperCase() + s.slice(1) : s)
  return scene
    .replace(/\b(?:both|all|the\s+two|the\s+three)\s+of\s+you\b/gi, (m) => cap(m, `${m.split(/\s+of\s+/i)[0].toLowerCase()} of them`))
    .replace(/\byou\s+(?:two|both)\b/gi, (m) => cap(m, /two$/i.test(m) ? 'the two of them' : 'both of them'))
    .replace(/\byou're\b/gi, (m) => cap(m, `${them} is`))
    .replace(/\byou've\b/gi, (m) => cap(m, `${them} has`))
    .replace(/\byou'll\b/gi, (m) => cap(m, `${them} will`))
    .replace(/\byou'd\b/gi, (m) => cap(m, `${them} would`))
    .replace(/\byoursel(?:f|ves)\b/gi, (m) => cap(m, them))
    .replace(/\byours?\b/gi, (m) => cap(m, `${them}'s`))
    .replace(/\byou\b/gi, (m) => cap(m, them))
}

/**
 * The scene a slot shows: the card's tier scene; for an ending, the card's own ending scene or the
 * tier 5 scene with the ending's mood; for a group, the first participant's own scene for that
 * slot (endings[slot].scene) or a built-in one.
 */
export function sceneFor(slot: ArtSlot, characters: readonly Character[]): string {
  const first = characters[0]
  const tier5 = (c: Character | undefined) => (c?.gallery ?? []).find((t) => t?.tier === 5)?.scene?.trim() ?? ''
  if (slot.kind === 'tier') {
    const c = characters.find((x) => x.id === slot.characterId) ?? first
    return (c?.gallery ?? []).find((t) => t?.tier === slot.tier)?.scene?.trim() ?? ''
  }
  if (slot.kind === 'ending') {
    const c = characters.find((x) => x.id === slot.characterId) ?? first
    const own = c?.endings?.[slot.ending]?.scene?.trim()
    if (own) return own
    const mood = ENDING_ART_MOODS[slot.ending] ?? ''
    const base = tier5(c)
    return base ? `${base}, ${mood}` : mood
  }
  for (const c of characters) {
    const own = c.endings?.[slot.slot as EndingType]?.scene?.trim()
    if (own) return own
  }
  return GROUP_SCENES[slot.slot] ?? `${slot.slot.replace(/[-_]+/g, ' ')}, all of them together`
}

/** FNV-1a, 32-bit, unsigned. */
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A random unsigned 32-bit seed. */
export function randomSeed(): number {
  const c = globalThis.crypto
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0]
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
}

/**
 * The seed a slot is painted with. Fixed: a stable hash of the character id (every tier of one
 * character shares it, for a consistent look), of the character and ending for ending art, and of
 * the group key for group art. Random: a new one each time.
 */
export function seedFor(slot: ArtSlot, mode: ImageSettings['seedMode']): number {
  if (mode === 'random') return randomSeed()
  if (slot.kind === 'tier') return hash32(slot.characterId)
  return hash32(slotKey(slot))
}

// ---------------------------------------------------------------------------
// The prompt

export interface ImagePromptInput {
  slot: ArtSlot
  /** Everyone in the picture (the slot's character, or the whole group). */
  characters: Character[]
  /** The player's heat. Each participant's effectiveHeat applies (ace caps and trust gates). */
  heat: HeatLevel
  settings: ImageSettings
  /** The scene (see sceneFor). Scrubbed like any card text. */
  scene: string
  /** Trust with the participant, or per participant id. Missing counts as 0. */
  trust?: number | Record<string, number>
  /** Optional: this seed instead of the settings' seed mode (Regenerate passes a fresh one). */
  seed?: number
  /**
   * Optional: the player's route with the participant, or per participant id (missing: romantic).
   * On the friend route the picture is platonic, at heat 1.
   */
  route?: Route | Record<string, Route>
  /** Optional: the player's profile, for the locked statement about them when the scene shows them. */
  player?: Pick<PlayerProfile, 'gender' | 'matchAs'> | null
}

export interface ImagePrompt {
  prompt: string
  negative: string
  seed: number
}

function trustOf(trust: ImagePromptInput['trust'], id: string): number {
  if (typeof trust === 'number') return trust
  const v = trust?.[id]
  return typeof v === 'number' ? v : 0
}

/** True when any participant is on the friend route. */
export function friendPicture(input: Pick<ImagePromptInput, 'characters' | 'route'>): boolean {
  const r = input.route
  if (!r) return false
  if (typeof r === 'string') return r === 'friend'
  return input.characters.some((c) => r[c.id] === 'friend')
}

/**
 * The heat the picture is painted at: the lowest effectiveHeat among the participants, so an ace
 * cap or a trust gate holds for the whole picture; 1 on the friend route.
 */
export function imageHeat(input: Pick<ImagePromptInput, 'characters' | 'heat' | 'trust' | 'route'>): HeatLevel {
  if (friendPicture(input)) return 1
  const raw = Math.round(Number(input.heat))
  const heat = (Number.isFinite(raw) ? Math.min(5, Math.max(1, raw)) : 2) as HeatLevel
  let h = heat
  for (const c of input.characters) {
    const e = effectiveHeat(c, trustOf(input.trust, c.id), heat)
    if (e < h) h = e
  }
  return h
}

/** A card's names: the full name and the first name. */
function namesOf(c: Pick<Character, 'name'>): string[] {
  const full = typeof c.name === 'string' ? c.name.trim() : ''
  return full ? [full, full.split(/\s+/)[0]] : []
}

/**
 * The participant's own words, minus what the locked age statement already says. With the player in
 * the picture, "you" in the body notes is them too.
 */
function participant(c: Character, heat: HeatLevel, scale: number, names: readonly string[], role: 'partner' | 'friend' | null): string {
  const age = ageStatement(c)
  const lead = new Set(age.split(', ').map((s) => s.toLowerCase()))
  const tags = scrubPromptText(c.artTags, { heat, max: Math.round(500 * scale), names })
    .split(', ')
    .filter((t) => t && !lead.has(t.toLowerCase()))
  const parts = [age, ...tags]
  if (heat >= 4) {
    const body = scrubPromptText(c.bodyNotes, { heat, max: Math.round(300 * scale), names })
    if (body) parts.push(role ? thirdPerson(body, role) : body)
  }
  return parts.join(', ')
}

/**
 * Prompt, negative prompt and seed for a slot. Throws ArtSafetyError when a participant has no
 * adult age. For Grok Imagine (settings.provider 'grok') the prompt starts and ends with
 * IMAGE_SAFETY.grokClause; the negative is still built, for the debug panel.
 */
export function buildImagePrompt(input: ImagePromptInput): ImagePrompt {
  const { slot, settings } = input
  if (!input.characters.length) throw new ArtSafetyError('Nobody to paint.')
  const grok = settings.provider === 'grok'
  const friend = friendPicture(input)
  const role = friend ? 'friend' : 'partner'
  const heat = imageHeat(input)
  const names = input.characters.flatMap(namesOf)
  const cap = PROMPT_BODY_MAX[grok ? 'grok' : 'a1111']
  let body = ''
  // Long cards and big groups are trimmed (tags, body notes, scene and style, never an age
  // statement or the safety text) until the prompt fits.
  for (let scale = 1; ; scale *= 0.6) {
    const style = scrubPromptText(settings.stylePrefixes?.[settings.stylePreset], { heat, max: Math.round(400 * scale), names })
    const scrubbed = scrubPromptText(input.scene, { heat, max: Math.round(500 * scale), names })
    const withPlayer = sceneShowsPlayer(scrubbed)
    const scene = withPlayer ? thirdPerson(scrubbed, role) : scrubbed
    const people = input.characters.map((c) => participant(c, heat, scale, names, withPlayer ? role : null))
    const count = input.characters.length + (withPlayer ? 1 : 0)
    const modifier = friend
      ? FRIEND_MODIFIER
      : heat >= 4 && count === 1
        ? SOLO_HEAT_MODIFIERS[heat as 4 | 5]
        : HEAT_MODIFIERS[heat]
    body = [
      style,
      count > 1 ? `${count} adults together` : '',
      people.join('; '),
      withPlayer ? playerStatement(input.player, role) : '',
      scene,
      modifier,
    ]
      .filter(Boolean)
      .join(', ')
    if (body.length <= cap || scale < 0.1) break
  }
  const withClause = `${body}, ${IMAGE_SAFETY.positiveClause}`
  const prompt = grok ? withGrokClause(withClause) : withClause
  const negative = [IMAGE_SAFETY.negative, HEAT_NEGATIVES[heat], friend ? FRIEND_NEGATIVE : '', QUALITY_NEGATIVE].filter(Boolean).join(', ')
  const seed = typeof input.seed === 'number' && Number.isFinite(input.seed) ? input.seed >>> 0 : seedFor(slot, settings.seedMode)
  return { prompt, negative, seed }
}

/** Anything that could end a line or start an A1111 comment, as a comma. */
function oneLine(text: string): string {
  return plainText(String(text ?? ''))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ', ')
}

/**
 * A Grok prompt with the Grok clause at its start and at its end (added where missing), so no
 * "ignore what follows" or "ignore what came before" covers both. Providers call this last.
 */
export function withGrokClause(prompt: string): string {
  const c = IMAGE_SAFETY.grokClause
  let body = oneLine(prompt).trim()
  while (body.startsWith(c)) body = body.slice(c.length).trim()
  while (body.endsWith(c)) body = body.slice(0, -c.length).trim()
  body = body.replace(/[\s.,;]+$/, '')
  return body ? `${c} ${body}. ${c}` : c
}

/** A negative prompt that starts with the safety negative (added when missing). Providers call this last. */
export function withSafetyNegative(negative: string): string {
  const n = oneLine(negative).trim()
  return n.startsWith(IMAGE_SAFETY.negative) ? n : [IMAGE_SAFETY.negative, n].filter(Boolean).join(', ')
}

/**
 * An A1111 prompt as sent: one line, no '#' (a comment to the end of the line in A1111 1.8+ and
 * Forge), attention and editing syntax flattened (brackets, weights, extra networks, BREAK, AND), so
 * nothing can mute, reweight or cut off the clause, which then ends it (added when missing). The
 * A1111 provider calls this last.
 */
export function withPositiveClause(prompt: string): string {
  const p = oneLine(prompt)
    .replace(/<[^>]*>/g, ',')
    .replace(/[()[\]{}<>|]/g, ',')
    .replace(/\bBREAK\b/g, ',')
    .replace(/\bAND\b/g, 'and')
    .replace(/(?:\s*,\s*)+/g, ', ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
  return p.endsWith(IMAGE_SAFETY.positiveClause) ? p : [p, IMAGE_SAFETY.positiveClause].filter(Boolean).join(', ')
}
