// Prompt assembly. Templates are the verbatim SPEC wording (src/prompts/*.txt); this file only
// fills {placeholders} with data. The base prompts (WORLD RULES, CONTENT) are never edited here:
// Phase 7 mod direction is appended after them under a MOD DIRECTION header.

import { heatDescription } from '../data/heat'
import {
  aceNote,
  describeAttractions,
  effectiveHeat,
  joinAnd,
  stageFor,
  stageLabel,
} from '../engine/stages'
import type { ChatMessage } from '../llm/client'
import type {
  Agreement,
  AgreementType,
  Character,
  HeatLevel,
  JudgeResult,
  PlayerProfile,
  PlayerStyle,
  Relationship,
  Route,
  SetRelationKind,
  Trait,
  TraitType,
  TurnRole,
} from '../types'
import agreementTemplate from './agreement.txt?raw'
import judgeTemplate from './judge.txt?raw'
import memoryTemplate from './memory.txt?raw'
import storyTemplate from './story.txt?raw'
import suggestionsTemplate from './suggestions.txt?raw'

/** Raw templates, exactly as in docs/SPEC.md (judge minus its "(e.g. ...)" guidance). */
export const TEMPLATES = {
  story: storyTemplate,
  judge: judgeTemplate,
  agreement: agreementTemplate,
  suggestions: suggestionsTemplate,
  memory: memoryTemplate,
} as const

export type FillValues = Record<string, string | number>

/**
 * Replace `{key}` with values[key] for keys present in `values`; everything else (JSON braces,
 * unknown keys) is left alone. Single pass, so values containing braces are never re-filled.
 */
export function fill(template: string, values: FillValues): string {
  return template.replace(/\{([^{}\n]+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  )
}

/** Mod direction header used by Phase 7 overrides. */
export const MOD_DIRECTION_HEADER = 'MOD DIRECTION'

export type Overrides = string | readonly (string | undefined | null)[] | undefined | null

/** Append override text after the full base prompt, under MOD DIRECTION. Base text is untouched. */
export function withOverrides(prompt: string, overrides?: Overrides): string {
  const list = (Array.isArray(overrides) ? overrides : [overrides])
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
  if (list.length === 0) return prompt
  return `${prompt}\n\n${MOD_DIRECTION_HEADER}\n${list.join('\n\n')}`
}

// ---------------------------------------------------------------------------
// Small text helpers

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

/** Drop trailing periods/whitespace so the template's own "." doesn't double up. */
export function noPeriod(s: string): string {
  return str(s).replace(/[.\s]+$/, '')
}

/** Ensure a sentence ends with punctuation. Empty stays empty. */
export function sentence(s: string): string {
  const t = str(s)
  if (!t) return ''
  return /[.!?…]["'”’)\]]*$/.test(t) ? t : `${t}.`
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** "Rare vinyl" -> "rare vinyl", but leaves "LP" or "Polaroid" style words alone when unsure. */
function lowerFirst(s: string): string {
  const t = str(s)
  if (t.length > 1 && /[a-z\s]/.test(t[1]) && /[A-Z]/.test(t[0])) return t[0].toLowerCase() + t.slice(1)
  return t
}

function oneLine(s: string): string {
  return str(s).replace(/\s*\n+\s*/g, ' ')
}

function trimLineEnds(s: string): string {
  return s.replace(/[ \t]+$/gm, '')
}

/** Remove the blank-line-separated section that starts with `header`. */
function removeSection(template: string, header: string): string {
  return template
    .split('\n\n')
    .filter((block) => !block.startsWith(header))
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// Value renderers (exported for the debug panel, the profile screen and tests)

/** Story prompt traits: labels only, separated by "; ". */
export function traitLabels(traits: readonly Trait[] | undefined): string {
  const list = (traits ?? []).map((t) => noPeriod(t.label)).filter(Boolean)
  return list.length ? list.join('; ') : 'none'
}

/** Judge prompt traits: "id: label; id: label". */
export function traitPairs(traits: readonly Trait[] | undefined): string {
  const list = (traits ?? []).filter((t) => t.id).map((t) => `${t.id}: ${noPeriod(t.label)}`)
  return list.length ? list.join('; ') : 'none'
}

/** {playerGender}: the custom label when set. */
export function playerGenderLabel(profile: PlayerProfile): string {
  if (profile.gender === 'custom') return str(profile.customGender) || profile.matchAs || 'nonbinary'
  return profile.gender
}

const PLAYER_STYLE_WORDS: Record<PlayerStyle, string> = {
  monogamous: 'Monogamous: one partner at a time.',
  open: 'Open: sees other people and is fine with partners who do too.',
  polyamorous: 'Polyamorous: has or wants more than one relationship, openly.',
  figuring: "Still figuring it out: hasn't settled on monogamous, open or poly.",
}

/** {knownStyle}: the player's style in plain words, once the character knows it. */
export function knownStyleText(profile: PlayerProfile, rel: Pick<Relationship, 'knowsPlayerStyle'>): string {
  if (!rel.knowsPlayerStyle) return "Nothing yet; they haven't talked about it."
  return PLAYER_STYLE_WORDS[profile.relationshipStyle] ?? PLAYER_STYLE_WORDS.figuring
}

const REQUESTED_WORDS: Record<AgreementType, string> = {
  exclusive: 'exclusive (only each other)',
  open: 'open (free to see other people)',
  poly: 'poly (other partners known to everyone, disclosure expected)',
  casual: 'casual (no labels, no promises)',
  none: 'no agreement',
}

/** {requestedAgreement}, e.g. "exclusive (only each other)". Always contains the type word. */
export function requestedAgreementText(type: AgreementType): string {
  return REQUESTED_WORDS[type] ?? type
}

/** {agreement}: "none yet", or "exclusive: <terms>". */
export function agreementText(agreement: Agreement | undefined): string {
  if (!agreement || agreement.type === 'none') return 'none yet'
  const terms = noPeriod(agreement.terms ?? '')
  return terms ? `${agreement.type}: ${terms}` : agreement.type
}

export type VenueFeeling = 'loves' | 'fine' | 'hates'
export type GiftReaction = 'loved' | 'hated' | 'neutral'

const VENUE_FEELING: Record<VenueFeeling, string> = {
  loves: 'loves this place',
  fine: 'is fine with this place',
  hates: "can't stand this place",
}

const GIFT_REACTION: Record<GiftReaction, string> = {
  loved: "lights up; it's exactly right",
  hated: 'tries to hide a wince',
  neutral: 'says thanks and means it',
}

const HIT_PHRASE: Record<TraitType, string> = {
  like: 'It touched a like',
  dislike: 'It hit a dislike',
  turnOn: 'It touched a turn-on',
  turnOff: 'It hit a turn-off',
}

const TRAIT_LIST: Record<TraitType, 'likes' | 'dislikes' | 'turnOns' | 'turnOffs'> = {
  like: 'likes',
  dislike: 'dislikes',
  turnOn: 'turnOns',
  turnOff: 'turnOffs',
}

/**
 * {hitsLine}: "It touched a turn-on: Slow dancing in an empty room." per known hit, or
 * "It hit nothing in particular." Unknown ids are ignored. Jealousy and breach add a sentence.
 */
export function hitsLine(character: Character, judge: JudgeResult): string {
  const parts: string[] = []
  const seen = new Set<string>()
  for (const hit of judge.hits ?? []) {
    const listName = TRAIT_LIST[hit.type]
    if (!listName) continue
    const trait = character[listName]?.find((t) => t.id === hit.id)
    const key = `${hit.type}:${hit.id}`
    if (!trait || seen.has(key)) continue
    seen.add(key)
    parts.push(`${HIT_PHRASE[hit.type]}: ${sentence(trait.label)}`)
  }
  if (parts.length === 0) parts.push('It hit nothing in particular.')
  if (judge.jealousy) parts.push('It stirred up some jealousy.')
  if (judge.breach) parts.push('It broke something the two of you agreed on.')
  return parts.join(' ')
}

export interface RelationLine {
  characterId: string
  kind: SetRelationKind
  note?: string
}

const ROMANTIC_KINDS: readonly SetRelationKind[] = ['partner', 'ex', 'situationship']

function nameOf(id: string, names: Record<string, string> | undefined): string {
  return names?.[id] ?? id
}

/** Partners, exes and situationships from the card, merged with manifest lines (which carry notes). */
function romanticLines(
  character: Character,
  relations: readonly RelationLine[] | undefined,
  kinds: readonly SetRelationKind[] = ROMANTIC_KINDS,
): RelationLine[] {
  const out: RelationLine[] = []
  for (const r of relations ?? []) {
    if (!kinds.includes(r.kind) || out.some((o) => o.characterId === r.characterId)) continue
    out.push(r)
  }
  for (const p of character.partners ?? []) {
    if (!kinds.includes(p.relation) || out.some((o) => o.characterId === p.characterId)) continue
    out.push({ characterId: p.characterId, kind: p.relation })
  }
  return out
}

/** Story {partners}: "Kai Okoro (ex): Dated for a year; it ended loud." with gossip appended. */
export function partnersText(
  character: Character,
  names: Record<string, string> | undefined,
  relations?: readonly RelationLine[],
  gossip?: readonly string[],
): string {
  const lines = romanticLines(character, relations).map((r) =>
    sentence(`${nameOf(r.characterId, names)} (${r.kind})${r.note ? `: ${noPeriod(r.note)}` : ''}`),
  )
  const base = lines.length ? lines.join(' ') : 'none'
  const g = (gossip ?? []).map(noPeriod).filter(Boolean)
  if (g.length === 0) return base
  return `${sentence(capitalize(base))} Gossip ${character.name} is happy to share: ${g.join('; ')}.`
}

/** Story {secrets}: earned secrets, then rumors this character has passed on. */
export function secretsText(
  character: Character,
  rel: Pick<Relationship, 'secretsUnlocked'>,
  rumors?: readonly string[],
): string {
  const earned = (rel.secretsUnlocked ?? [])
    .map((i) => character.secrets?.[i]?.text)
    .filter((t): t is string => !!t && !!t.trim())
    .map(sentence)
  const base = earned.length ? earned.join(' ') : 'none yet'
  const r = (rumors ?? []).map(noPeriod).filter(Boolean)
  if (r.length === 0) return base
  return `${sentence(capitalize(base))} Rumors ${character.name} has passed on: ${r.join('; ')}.`
}

/** "{a}, {b} and {c}", or `empty` when there are none. */
function namesList(ids: readonly string[], names: Record<string, string> | undefined, empty: string): string {
  const list = ids.map((id) => nameOf(id, names)).filter(Boolean)
  return list.length ? joinAnd(list) : empty
}

export interface TurnLike {
  role: TurnRole
  text: string
  /** Speaker character id for character turns. */
  speaker?: string
  dtr?: boolean
}

export interface TranscriptLabels {
  /** Label for this character's lines. */
  characterName: string
  /** Display names for other speakers (group dates). */
  names?: Record<string, string>
  /** Label for the player's lines. Default "Player". */
  playerLabel?: string
}

/** Lines "Player: …" / "{Name}: …". System turns are skipped. */
export function renderTranscript(turns: readonly TurnLike[], labels: TranscriptLabels): string {
  return turns
    .filter((t) => t.role !== 'system' && str(t.text))
    .map((t) => {
      const who =
        t.role === 'player'
          ? (labels.playerLabel ?? 'Player')
          : t.speaker && labels.names?.[t.speaker]
            ? labels.names[t.speaker]
            : labels.characterName
      return `${who}: ${oneLine(t.text)}`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// Story

export type StorySpecial =
  | { kind: 'final' }
  | { kind: 'exit' }
  | { kind: 'dtr'; requested: AgreementType }
  | { kind: 'epilogue'; direction: string }

export interface StoryContext {
  character: Character
  rel: Relationship
  profile: PlayerProfile
  /** The player's chosen heat; the ace cap is applied here. */
  heat: HeatLevel
  route: Route
  venue: { name: string; feeling: VenueFeeling; note?: string }
  /** `name` as it reads mid-sentence, e.g. "rare vinyl". */
  gift?: { name: string; reaction: GiftReaction }
  /** 0 is the opening beat. */
  turn: number
  maxTurns: number
  firstDate: boolean
  special?: StorySpecial
  /** The judge result for the player's last message. Absent on turn 0 (LANDED section removed). */
  judge?: JudgeResult
  /** Display names by character id (partners, others the player is seeing). */
  names: Record<string, string>
  /** Friend-route gossip the character is happy to share; appended to {partners}. */
  gossip?: string[]
  /** Rumors this character has passed on; appended to {secrets}. */
  rumors?: string[]
  /** Overrides rel.knownOthers when given. */
  knownOthersIds?: string[]
  /** Manifest relationships for this character (partners/exes with notes). */
  relations?: RelationLine[]
}

const LANDED_HEADER = "HOW THE PLAYER'S LAST MESSAGE LANDED"

/** {turnNote} per SPEC: opening, final turn, early exit, define-the-relationship, epilogue. */
export function turnNote(ctx: Pick<StoryContext, 'character' | 'turn' | 'maxTurns' | 'firstDate' | 'special'>): string {
  const name = ctx.character.name
  const special = ctx.special
  if (special?.kind === 'exit') return `The date has gone badly: write ${name} leaving.`
  const parts: string[] = []
  if (ctx.turn === 0) {
    parts.push(`Open the date: ${name} arrives and greets the player.`)
    const opener = str(ctx.character.opener)
    if (ctx.firstDate && opener) parts.push(`Use this line: ${opener}`)
  } else if (special?.kind === 'final' || ctx.turn >= ctx.maxTurns) {
    parts.push(`Last turn: bring the date to a natural close and hint at whether ${name} wants another.`)
  }
  if (special?.kind === 'dtr') {
    parts.push(
      `The player wants to define what you two are and is asking for ${requestedAgreementText(special.requested)}. Answer as ${name} would, given their style, their partners and how much they trust the player: accept, counter with different terms, or decline, all in character.`,
    )
  }
  if (special?.kind === 'epilogue') {
    const d = str(special.direction)
    if (d) parts.push(`Epilogue: ${sentence(d)}`)
  }
  return parts.join(' ')
}

/** Every placeholder value for the story template. Exported for the debug panel and tests. */
export function storyValues(ctx: StoryContext): FillValues {
  const { character: c, rel, profile } = ctx
  const heat = effectiveHeat(c, rel.trust, ctx.heat)
  const bodyHeat = heat >= 4
  const playerBody = str(profile.bodyNotes)
  const venueNote = ctx.venue.note ? noPeriod(ctx.venue.note) : ''
  const memory = (rel.memory ?? []).map(str).filter(Boolean)
  const knownOthers = ctx.knownOthersIds ?? rel.knownOthers ?? []
  const values: FillValues = {
    name: c.name,
    playerName: str(profile.name) || 'the player',
    playerGender: playerGenderLabel(profile),
    playerPronouns: noPeriod(profile.pronouns) || 'they/them',
    playerBodyNotes: bodyHeat && playerBody ? `Body: ${sentence(playerBody)}` : '',
    knownStyle: knownStyleText(profile, rel),
    age: c.age,
    pronouns: noPeriod(c.pronouns),
    occupation: noPeriod(c.occupation),
    look: sentence(c.look),
    bodyNotes: bodyHeat
      ? sentence(str(c.bodyNotes)) || "None given; don't invent specifics."
      : 'Not relevant at this heat.',
    attractedTo: describeAttractions(c.attractedTo) || 'nobody listed',
    relationshipStyle: c.relationshipStyle,
    jealousy: c.jealousy,
    aceNote: aceNote(c),
    partners: partnersText(c, ctx.names, ctx.relations, ctx.gossip),
    personality: sentence(c.personality),
    voice: sentence(c.voice),
    backstory: sentence(c.backstory),
    secrets: secretsText(c, rel, ctx.rumors),
    likes: traitLabels(c.likes),
    dislikes: traitLabels(c.dislikes),
    turnOns: traitLabels(c.turnOns),
    turnOffs: traitLabels(c.turnOffs),
    stage: stageLabel(stageFor(rel.affection)),
    affection: Math.round(rel.affection),
    trust: Math.round(rel.trust),
    route: ctx.route,
    agreement: agreementText(rel.agreement),
    knownOthers: namesList(knownOthers, ctx.names, `nobody, as far as ${c.name} knows`),
    memory: memory.length ? memory.join(' ') : 'This is your first date.',
    venue: venueNote ? `${noPeriod(ctx.venue.name)} (${venueNote})` : noPeriod(ctx.venue.name),
    venueFeeling: VENUE_FEELING[ctx.venue.feeling] ?? VENUE_FEELING.fine,
    giftLine: ctx.gift
      ? `You brought ${noPeriod(lowerFirst(ctx.gift.name))}. ${c.name} ${GIFT_REACTION[ctx.gift.reaction] ?? GIFT_REACTION.neutral}.`
      : 'No gift this time.',
    turn: ctx.turn,
    maxTurns: ctx.maxTurns,
    turnNote: turnNote(ctx),
    heatDescription: heatDescription(heat),
  }
  if (ctx.judge) {
    values.mood = noPeriod(ctx.judge.mood) || 'neutral'
    values.hitsLine = hitsLine(c, ctx.judge)
  }
  return values
}

/** The story engine system prompt. Without a judge result (turn 0) the LANDED section is removed. */
export function buildStoryPrompt(ctx: StoryContext, overrides?: Overrides): string {
  const template = ctx.judge ? TEMPLATES.story : removeSection(TEMPLATES.story, LANDED_HEADER)
  return withOverrides(trimLineEnds(fill(template, storyValues(ctx))).trimEnd(), overrides)
}

// ---------------------------------------------------------------------------
// Judge

export interface JudgeContext {
  character: Character
  rel: Relationship
  route: Route
  names: Record<string, string>
  /** Character ids the player is seeing (other than this character). */
  others: string[]
  /** Overrides rel.knownOthers when given. */
  knownOthersIds?: string[]
  /** {name}'s current opinion; derived from the agreement and what they know when omitted. */
  opinion?: string
  /** Secrets the player has shared with this character. */
  sharedSecrets?: string[]
  /** Turns before the new message; the last 4 are used. */
  recent: TurnLike[]
  /** The player's new message. */
  message: string
}

/** A default {opinion} in the character's own terms, from the agreement and what they know. */
export function defaultOpinion(
  character: Character,
  rel: Pick<Relationship, 'agreement' | 'knownOthers'>,
  names: Record<string, string> | undefined,
  knownOthersIds?: readonly string[],
): string {
  const known = knownOthersIds ?? rel.knownOthers ?? []
  const who = namesList(known, names, '')
  const type = rel.agreement?.type ?? 'none'
  const minds =
    character.jealousy === 'compersion'
      ? 'is happy for them'
      : character.jealousy === 'low'
        ? "doesn't mind"
        : character.jealousy === 'medium'
          ? "isn't sure how to feel about it"
          : 'minds more than they let on'
  switch (type) {
    case 'exclusive':
      return who
        ? `thinks we agreed to be exclusive, and knows about ${who}`
        : 'thinks we agreed to be exclusive'
    case 'open':
      return who ? `we agreed to keep it open; knows about ${who} and that's inside the deal` : 'we agreed to keep it open'
    case 'poly':
      return who
        ? `we agreed on poly; knows about ${who}, as the agreement expects`
        : 'we agreed on poly and expects to hear about other partners'
    case 'casual':
      return who ? `we agreed to keep it casual; knows about ${who} and ${minds}` : 'we agreed to keep it casual'
    default:
      return who
        ? `we never agreed to anything; knows about ${who} and ${minds}`
        : "we never agreed to anything, and hasn't heard about anyone else"
  }
}

/** Judge {personality}: identity and pronouns first (so misgendering is scoreable), then personality. */
function judgePersonality(c: Character): string {
  const identity = capitalize(str(c.identity) || c.gender)
  return `${identity}, ${noPeriod(c.pronouns)}. ${sentence(c.personality)}`
}

export function judgeValues(ctx: JudgeContext): FillValues {
  const { character: c, rel } = ctx
  const knownOthers = ctx.knownOthersIds ?? rel.knownOthers ?? []
  const shared = (ctx.sharedSecrets ?? []).map(noPeriod).filter(Boolean)
  const recent = renderTranscript(ctx.recent.slice(-4), { characterName: c.name, names: ctx.names })
  return {
    name: c.name,
    stage: stageLabel(stageFor(rel.affection)),
    affection: Math.round(rel.affection),
    trust: Math.round(rel.trust),
    personality: judgePersonality(c),
    attractedTo: describeAttractions(c.attractedTo) || 'nobody listed',
    relationshipStyle: c.relationshipStyle,
    jealousy: c.jealousy,
    'likes as "id: label"': traitPairs(c.likes),
    dislikes: traitPairs(c.dislikes),
    turnOns: traitPairs(c.turnOns),
    turnOffs: traitPairs(c.turnOffs),
    route: ctx.route,
    agreement: noPeriod(agreementText(rel.agreement)),
    others: namesList(ctx.others, ctx.names, 'nobody'),
    knownOthers: namesList(knownOthers, ctx.names, 'nobody'),
    opinion: oneLine(ctx.opinion ?? defaultOpinion(c, rel, ctx.names, ctx.knownOthersIds)),
    sharedSecrets: shared.length ? shared.join('; ') : 'none',
    'last 4 turns': recent ? `\n${recent}` : 'none yet',
    message: oneLine(ctx.message),
  }
}

export function buildJudgePrompt(ctx: JudgeContext, overrides?: Overrides): string {
  return withOverrides(trimLineEnds(fill(TEMPLATES.judge, judgeValues(ctx))).trimEnd(), overrides)
}

// ---------------------------------------------------------------------------
// Agreement

export interface AgreementContext {
  character: Character
  rel: Relationship
  requested: AgreementType
  names: Record<string, string>
  /** The define-the-relationship conversation. If any turn is flagged `dtr`, only those are used. */
  turns: TurnLike[]
  relations?: RelationLine[]
}

export function agreementValues(ctx: AgreementContext): FillValues {
  const { character: c, rel } = ctx
  const partners = romanticLines(c, ctx.relations, ['partner', 'situationship']).map(
    (r) => `${nameOf(r.characterId, ctx.names)} (${r.kind})`,
  )
  const dtr = ctx.turns.some((t) => t.dtr) ? ctx.turns.filter((t) => t.dtr) : ctx.turns
  return {
    name: c.name,
    requestedAgreement: requestedAgreementText(ctx.requested),
    relationshipStyle: c.relationshipStyle,
    jealousy: c.jealousy,
    trust: Math.round(rel.trust),
    partners: partners.length ? joinAnd(partners) : 'none',
    'dtr turns': renderTranscript(dtr, { characterName: c.name, names: ctx.names }) || '(nothing said yet)',
  }
}

export function buildAgreementPrompt(ctx: AgreementContext, overrides?: Overrides): string {
  return withOverrides(trimLineEnds(fill(TEMPLATES.agreement, agreementValues(ctx))).trimEnd(), overrides)
}

// ---------------------------------------------------------------------------
// Suggestions

/** Chip keys: sweet/flirty/bold on a romantic route, sweet/curious/honest on a friend route. */
export function suggestionKeys(route: Route): [string, string, string] {
  return route === 'friend' ? ['sweet', 'curious', 'honest'] : ['sweet', 'flirty', 'bold']
}

export interface SuggestionsContext {
  character: Character
  rel: Pick<Relationship, 'trust'>
  route: Route
  heat: HeatLevel
}

/** The suggestions template, with flirty/bold swapped for curious/honest on a friend route. */
export function suggestionsTemplateFor(route: Route): string {
  if (route !== 'friend') return TEMPLATES.suggestions
  return TEMPLATES.suggestions
    .replace('one flirty, one bold', 'one curious, one honest')
    .replace('"flirty": "...", "bold": "..."', '"curious": "...", "honest": "..."')
}

export function buildSuggestionsPrompt(ctx: SuggestionsContext, overrides?: Overrides): string {
  const heat = effectiveHeat(ctx.character, ctx.rel.trust, ctx.heat)
  const values: FillValues = {
    name: ctx.character.name,
    heatDescription: noPeriod(heatDescription(heat)),
  }
  return withOverrides(trimLineEnds(fill(suggestionsTemplateFor(ctx.route), values)).trimEnd(), overrides)
}

// ---------------------------------------------------------------------------
// Memory

export interface MemoryContext {
  character: Pick<Character, 'name'>
}

export function buildMemoryPrompt(ctx: MemoryContext, overrides?: Overrides): string {
  return withOverrides(trimLineEnds(fill(TEMPLATES.memory, { name: ctx.character.name })).trimEnd(), overrides)
}

// ---------------------------------------------------------------------------
// Chat message arrays

/** The user message that starts every story call, and the whole turn-0 request. */
export const DATE_BEGINS = '(The date begins.)'

export const JUDGE_INSTRUCTION = 'Score the new message.'
export const AGREEMENT_INSTRUCTION = 'Settle the agreement.'
export const SUGGESTIONS_INSTRUCTION = 'Suggest the three lines.'
export const MEMORY_INSTRUCTION = 'Write the summary.'

/**
 * Story call messages: the system prompt, "(The date begins.)", then the date so far as
 * alternating assistant (character) / user (player) messages. Consecutive same-role turns are
 * merged so strict chat templates always see alternation. On turn 0 only the opening user
 * message is sent.
 */
export function makeStoryMessages(
  systemPrompt: string,
  turns: readonly TurnLike[],
  turn0: boolean = turns.length === 0,
): ChatMessage[] {
  const msgs: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: DATE_BEGINS },
  ]
  if (turn0) return msgs
  for (const t of turns) {
    if (t.role === 'system') continue
    const text = str(t.text)
    if (!text) continue
    const role = t.role === 'player' ? 'user' : 'assistant'
    const last = msgs[msgs.length - 1]
    if (last.role === role && last !== msgs[0]) last.content = `${last.content}\n\n${text}`
    else msgs.push({ role, content: text })
  }
  return msgs
}

export function makeJudgeMessages(systemPrompt: string): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JUDGE_INSTRUCTION },
  ]
}

export function makeAgreementMessages(systemPrompt: string): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: AGREEMENT_INSTRUCTION },
  ]
}

/** Suggestions go out with the last 4 turns in the user message. */
export function makeSuggestionsMessages(
  systemPrompt: string,
  recent: readonly TurnLike[],
  labels: TranscriptLabels,
): ChatMessage[] {
  const transcript = renderTranscript(recent.slice(-4), labels)
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: transcript ? `Last turns:\n${transcript}\n\n${SUGGESTIONS_INSTRUCTION}` : SUGGESTIONS_INSTRUCTION,
    },
  ]
}

/** Memory call: the whole date transcript in the user message. */
export function makeMemoryMessages(
  systemPrompt: string,
  turns: readonly TurnLike[],
  labels: TranscriptLabels & { venue?: string },
): ChatMessage[] {
  const transcript = renderTranscript(turns, labels)
  const where = labels.venue ? `Venue: ${noPeriod(labels.venue)}.\n` : ''
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${where}The date:\n${transcript || '(nothing was said)'}\n\n${MEMORY_INSTRUCTION}` },
  ]
}

/** Memory compression: older entries are summarized into one paragraph with the same instruction. */
export function makeMemoryCompressionMessages(systemPrompt: string, entries: readonly string[]): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Earlier dates, oldest first:\n${entries.map(str).filter(Boolean).join('\n\n')}\n\nCompress all of these into one paragraph.`,
    },
  ]
}
