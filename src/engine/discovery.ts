// Discovery (docs/SPEC.md, "Discovery & Secrets"). Pure: no React, no Dexie.
//
// - Judge hits reveal traits on the profile, with the judge's hint as the caption.
// - Venue and gift reactions reveal when tried.
// - A character's attractions and relationship style reveal when they come up in conversation;
//   the character learns how the player dates when the player says so. detectTopics() is the
//   keyword heuristic for both (patterns below).

import type { Character, DiscoveredTrait, JudgeHit, JudgeResult, PlayerStyle, Relationship, Trait, TraitType } from '../types'
import { giftReaction, venueReaction } from './math'

const TRAIT_LISTS: Readonly<Record<TraitType, 'likes' | 'dislikes' | 'turnOns' | 'turnOffs'>> = {
  like: 'likes',
  dislike: 'dislikes',
  turnOn: 'turnOns',
  turnOff: 'turnOffs',
}

/**
 * Traits every character has without their card listing them (docs/SPEC.md: misgendering or
 * deadnaming is a turn-off for every character in the game). The judge sees them with the card's
 * turn-offs, a hit on one is applied like any other, and the story's LANDED line names it. They are
 * not hidden, so they are never added to the profile's discoveries.
 */
export const UNIVERSAL_TRAITS: Readonly<Partial<Record<TraitType, readonly Trait[]>>> = {
  turnOff: [
    {
      id: 'misgendering',
      label: 'Being misgendered or deadnamed, or having their gender or sexuality treated as a kink or a curiosity',
    },
  ],
}

/** True when the hit is one of the traits every character has (and not on this card). */
export function isUniversalHit(character: Character, hit: JudgeHit): boolean {
  const list = TRAIT_LISTS[hit.type]
  if (list && (character[list] ?? []).some((t) => t.id === hit.id)) return false
  return (UNIVERSAL_TRAITS[hit.type] ?? []).some((t) => t.id === hit.id)
}

/** True when the character's card (or the universal traits) has a trait with this type and id. */
export function hasTrait(character: Character, hit: JudgeHit): boolean {
  const list = TRAIT_LISTS[hit.type]
  if (!list) return false
  return (character[list] ?? []).some((t) => t.id === hit.id) || (UNIVERSAL_TRAITS[hit.type] ?? []).some((t) => t.id === hit.id)
}

/** The judge's hits that exist on the card, without duplicates, in the judge's order. */
export function knownHits(character: Character, hits: readonly JudgeHit[] | undefined): JudgeHit[] {
  const out: JudgeHit[] = []
  for (const h of hits ?? []) {
    if (!h || !hasTrait(character, h)) continue
    if (out.some((o) => o.type === h.type && o.id === h.id)) continue
    out.push({ type: h.type, id: h.id })
  }
  return out
}

function isDiscovered(rel: Pick<Relationship, 'discovered'>, hit: JudgeHit): boolean {
  return (rel.discovered ?? []).some((d) => d.type === hit.type && d.id === hit.id)
}

/**
 * Reveal the traits a judge result hit. Ids the character doesn't have are ignored, and a trait
 * already discovered stays as it was (its first caption is kept). The judge's hint is the caption.
 * Returns the updated relationship and the traits discovered by this result.
 */
export function revealHits(
  character: Character,
  rel: Relationship,
  judge: Pick<JudgeResult, 'hits' | 'hint'>,
  at: number,
): { rel: Relationship; found: DiscoveredTrait[] } {
  const found: DiscoveredTrait[] = []
  const hint = typeof judge.hint === 'string' ? judge.hint.trim() : ''
  for (const hit of knownHits(character, judge.hits)) {
    if (isDiscovered(rel, hit) || isUniversalHit(character, hit)) continue
    found.push({ type: hit.type, id: hit.id, hint, at })
  }
  if (found.length === 0) return { rel, found }
  return { rel: { ...rel, discovered: [...(rel.discovered ?? []), ...found] }, found }
}

/** Record how the character felt about the venue (revealed on the profile once tried). */
export function recordVenue(character: Character, rel: Relationship, venueId: string): Relationship {
  if (!venueId) return rel
  return { ...rel, venues: { ...(rel.venues ?? {}), [venueId]: venueReaction(character, venueId) } }
}

/** Record how the character took the gift (revealed on the profile once given). */
export function recordGift(character: Character, rel: Relationship, giftId: string | undefined): Relationship {
  if (!giftId) return rel
  return { ...rel, gifts: { ...(rel.gifts ?? {}), [giftId]: giftReaction(character, giftId) } }
}

// ---------------------------------------------------------------------------
// Topics

export interface Topics {
  /** The character's attractions came up: their type, orientation, who they date. */
  attractions: boolean
  /** Relationship styles came up: monogamy, open, poly, exclusivity, seeing other people. */
  style: boolean
  /** The player said how they date (only for the player's own messages). */
  playerStyle: boolean
  /** Optional: which style the player's own words described, when it was clear. */
  told?: PlayerStyle
}

export const NO_TOPICS: Readonly<Topics> = { attractions: false, style: false, playerStyle: false }

const GENDER_WORDS =
  '(?:women|men|woman|man|girls|guys|boys|ladies|dudes|nonbinary(?: people| folks)?|non-binary(?: people| folks)?|enbies|both|everyone|anyone|all genders|any gender)'
const ORIENTATION_WORDS =
  '(?:gay|lesbian|bi|bisexual|pan|pansexual|queer|straight|ace|asexual|aro|demi|demisexual|demi-sexual)'

/**
 * Attractions, asked about or talked about in the player's message:
 * - "what's your type", "am I your type", "your type"
 * - "who are you into", "what kind of people do you date/like/go for"
 * - "attracted to", "who attracts you", "orientation", "sexuality"
 * - "are you gay/bi/straight/...", "you're queer", "is she ace"
 * - "do you date/like women/men/guys/...", "into women/men/..."
 */
const ATTRACTION_PATTERNS: readonly RegExp[] = [
  /\byour type\b/,
  /\b(?:who|what kind of \w+|what sort of \w+|which \w+)\b[^.?!]{0,24}\b(?:into|attracted to|date|dating|like|go for|fall for)\b/,
  /\battracted to\b/,
  /\bwho attracts you\b/,
  /\b(?:orientation|sexuality)\b/,
  new RegExp(`\\b(?:are you|you're|you are|r u|is she|is he|are they|is it)\\s+(?:\\w+\\s+)?${ORIENTATION_WORDS}\\b`),
  new RegExp(`\\bdo you (?:date|like|go for|fancy|fall for|sleep with)\\s+${GENDER_WORDS}\\b`),
  new RegExp(`\\binto ${GENDER_WORDS}\\b`),
]

/**
 * Attractions stated by the character in their reply: "I'm bi", "I only date women",
 * "I'm into men", "I've always fallen for women".
 */
const CHARACTER_ATTRACTION_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b(?:i'm|i am|im)\\s+(?:\\w+\\s+)?${ORIENTATION_WORDS}\\b`),
  new RegExp(
    `\\bi(?:'m| am|'ve| have)?\\s+(?:only |mostly |always |never |just )?(?:into|date|dated|dating|attracted to|go for|gone for|fall for|fallen for)\\s+${GENDER_WORDS}\\b`,
  ),
]

/**
 * Relationship-style vocabulary. Matches when the topic itself comes up:
 * monogamy/monogamous, non-monogamy, polyamory/polyamorous, "poly", polycule, ENM, metamour,
 * open relationship/marriage/arrangement, relationship style, dating around, seeing (or dating,
 * sleeping with) other people / anyone else / more than one, one person at a time, only one
 * partner, and exclusivity in a relationship sense ("be exclusive", "are we exclusive",
 * "want something exclusive", "exclusive with", "exclusivity"). A record's "exclusive pressing"
 * doesn't count.
 */
const STYLE_WORDS = new RegExp(
  [
    '\\b(?:non-?)?monogam\\w*',
    '\\bpolyamor\\w*',
    '\\bpoly\\b',
    '\\bpolycule\\b',
    '\\benm\\b',
    '\\bmetamours?\\b',
    '\\bopen (?:relationship|marriage|arrangement|thing)s?\\b',
    '\\brelationship style\\b',
    '\\bdat(?:e|ing) around\\b',
    '\\b(?:see|seeing|date|dating|sleep with|sleeping with)\\s+(?:other people|others|anyone else|someone else|more than one|multiple people|a few people|other guys|other girls|other women|other men)\\b',
    '\\bone (?:person|partner) at a time\\b',
    '\\b(?:only|just) one (?:person|partner)\\b',
    '\\bmore than one (?:partner|person)\\b',
    '\\b(?:be|being|go|going|get|getting|are we|we\'re|we are|stay|staying|want|wanted|keep it|keeping it|make it|making it) exclusive\\b',
    '\\b(?:want|wanted|want to keep|looking for|need|prefer|like|keep|keeping)\\s+(?:something|it|things|this|us)\\s+exclusive\\b',
    '\\bexclusive (?:with|relationship|thing)\\b',
    '\\bexclusivity\\b',
  ].join('|'),
)

/**
 * Questions about the character's situation that are about style too: "are you single",
 * "are you seeing anyone", "you're with someone", "how do you date", "how do you do relationships".
 */
const STYLE_QUESTION_PATTERNS: readonly RegExp[] = [
  /\b(?:are you|you're|you are)\s+(?:single|taken|seeing (?:someone|anyone)|with someone|in a relationship|dating (?:someone|anyone))\b/,
  /\bhow do you (?:date|do relationships|do dating)\b/,
]

/** A first-person subject ("I", "I'm", "me", "my"...) before the style words in one sentence. */
const FIRST_PERSON = /\b(?:i|i'm|im|i've|i'd|i'll|i am|me|my|myself)\b/

function normalize(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.?!;])\s+|\n+/).filter(Boolean)
}

/** Style words that come after a first-person subject in the same sentence. */
function firstPersonStyle(sentence: string): boolean {
  const fp = FIRST_PERSON.exec(sentence)
  if (!fp) return false
  return STYLE_WORDS.test(sentence.slice(fp.index))
}

const SAID_POLY = /\b(?:polyamor\w*|poly|polycule|metamours?|more than one (?:partner|person))\b/
const SAID_OPEN =
  /\b(?:non-?monogam\w*|enm|open (?:relationship|marriage|arrangement|thing)s?|(?:see|seeing|date|dating|sleep with|sleeping with)\s+(?:other people|others|anyone else|someone else|multiple people|a few people)|dat(?:e|ing) around)\b/
const SAID_NOT_MONO = /\b(?:don'?t|do not|doesn'?t|not|never|no|isn'?t|not really)\b(?:\s+\w+){0,3}?\s+(?:monogam\w*|exclusive|exclusivity|one person at a time)\b/
const SAID_MONO =
  /\b(?:monogam\w*|one (?:person|partner) at a time|(?:only|just) one (?:person|partner)|exclusive|exclusivity)\b/
const SAID_FIGURING =
  /\b(?:still figuring (?:it|that|this|things) out|figuring out (?:what|how) i|not sure (?:what|how) i (?:want|date)|don'?t know what i want|haven'?t (?:decided|figured it out))\b/

/**
 * Which style the player's own words describe, reading their first-person sentences: poly, open
 * (including "non-monogamous" and "I see other people"), monogamous (unless negated: "I don't do
 * monogamy" reads as open), or still figuring it out. Null when nothing clear was said.
 */
export function toldStyleIn(message: string): PlayerStyle | null {
  const text = normalize(message)
  if (!text.trim()) return null
  for (const part of sentences(text)) {
    const fp = FIRST_PERSON.exec(part)
    if (!fp) continue
    const said = part.slice(fp.index)
    if (SAID_FIGURING.test(said)) return 'figuring'
    if (SAID_POLY.test(said)) return 'polyamorous'
    if (SAID_OPEN.test(said) || SAID_NOT_MONO.test(said)) return 'open'
    if (SAID_MONO.test(said)) return 'monogamous'
  }
  return null
}

/**
 * Which topics a message touches. Keyword heuristics, deliberately narrow (a missed reveal can
 * come up again; a wrong one can't be taken back):
 * - player messages: `attractions` when the player asks or talks about who the character is into
 *   (ATTRACTION_PATTERNS); `style` when relationship styles come up at all (STYLE_WORDS, or a
 *   question like "are you seeing anyone"); `playerStyle` when a sentence has the player speaking
 *   in the first person before style words ("I'm poly", "I don't do monogamy", "I'm seeing other
 *   people", "I want something exclusive").
 * - character replies (speaker 'character'): `attractions` when they state their orientation or
 *   who they date ("I'm bi", "I only date women"); `style` when they speak about their own style in
 *   the first person ("I'm poly", "I don't do exclusive"). Never `playerStyle`.
 */
export function detectTopics(message: string, speaker: 'player' | 'character' = 'player'): Topics {
  const text = normalize(message)
  if (!text.trim()) return { ...NO_TOPICS }
  const parts = sentences(text)
  if (speaker === 'character') {
    return {
      attractions: CHARACTER_ATTRACTION_PATTERNS.some((re) => re.test(text)),
      style: parts.some(firstPersonStyle),
      playerStyle: false,
    }
  }
  const told = toldStyleIn(message)
  const playerStyle = parts.some(firstPersonStyle) || !!told
  const out: Topics = {
    attractions: ATTRACTION_PATTERNS.some((re) => re.test(text)),
    style: playerStyle || STYLE_WORDS.test(text) || STYLE_QUESTION_PATTERNS.some((re) => re.test(text)),
    playerStyle,
  }
  if (told) out.told = told
  return out
}

/**
 * Apply detected topics: reveal the character's attractions and style, and mark that the character
 * knows how the player dates. Flags only ever turn on. Returns the same object when nothing changes.
 */
export function applyTopics(rel: Relationship, topics: Topics): Relationship {
  const revealed = rel.revealed ?? { attractions: false, style: false }
  const attractions = revealed.attractions || topics.attractions
  const style = revealed.style || topics.style
  const knowsPlayerStyle = rel.knowsPlayerStyle || topics.playerStyle
  // What the player actually said about how they date (the story's {knownStyle}); an unclear
  // style sentence still starts the record, so the profile's style is never assumed.
  const told = topics.told && rel.toldStyle?.style !== topics.told
  const startTold = topics.playerStyle && !rel.toldStyle
  if (attractions === revealed.attractions && style === revealed.style && knowsPlayerStyle === rel.knowsPlayerStyle && !told && !startTold) {
    return rel
  }
  const out: Relationship = { ...rel, revealed: { attractions, style }, knowsPlayerStyle }
  if (told) out.toldStyle = { ...rel.toldStyle, style: topics.told }
  else if (startTold) out.toldStyle = {}
  return out
}

/** What a topic step newly revealed (for the recap). */
export function topicsGained(before: Relationship, after: Relationship): Topics {
  return {
    attractions: !before.revealed?.attractions && !!after.revealed?.attractions,
    style: !before.revealed?.style && !!after.revealed?.style,
    playerStyle: !before.knowsPlayerStyle && !!after.knowsPlayerStyle,
  }
}
