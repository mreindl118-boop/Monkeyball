// Pure helpers for the recap screen: meter and stage changes in words (no arrow glyphs), what the
// date revealed, and the outcome line. No React, no stores.

import { stageIndex, stageLabel } from '../../engine/stages'
import type {
  Agreement,
  AgreementType,
  BetrayalEvent,
  Character,
  DateRecap,
  DateRecord,
  DiscoveredTrait,
  NewsItem,
  Rumor,
  Stage,
  TierNumber,
  TraitType,
} from '../../types'

export type CharacterRecap = DateRecap['perCharacter'][string]

const round = (n: number) => Math.round(Number.isFinite(n) ? n : 0)

export type Direction = 'up' | 'down' | 'same'

export function direction(before: number, after: number): Direction {
  const b = round(before)
  const a = round(after)
  return a > b ? 'up' : a < b ? 'down' : 'same'
}

/** "from 34 to 41", or "at 34" when nothing moved. */
export function changeText(before: number, after: number): string {
  const b = round(before)
  const a = round(after)
  return a === b ? `at ${a}` : `from ${b} to ${a}`
}

/** "Affection rose from 34 to 41", "Trust fell from 20 to 14", "Trust stayed at 20". */
export function meterChange(label: string, before: number, after: number): string {
  const d = direction(before, after)
  const verb = d === 'up' ? 'rose' : d === 'down' ? 'fell' : 'stayed'
  return `${label} ${verb} ${changeText(before, after)}`
}

/** "+7", "-5" with a real minus sign, or "No change". */
export function changeBadge(before: number, after: number): string {
  const n = round(after) - round(before)
  if (n > 0) return `+${n}`
  if (n < 0) return `−${Math.abs(n)}`
  return 'No change'
}

/** "Now Friend, up from Acquaintance", "Down to Stranger from Acquaintance" or "Still Friend". */
export function stageChangeText(before: Stage, after: Stage): string {
  const b = stageIndex(before)
  const a = stageIndex(after)
  if (a > b) return `Now ${stageLabel(after)}, up from ${stageLabel(before)}`
  if (a < b) return `Down to ${stageLabel(after)} from ${stageLabel(before)}`
  return `Still ${stageLabel(after)}`
}

/** The line under the character's name. */
export function outcomeText(outcome: DateRecord['outcome'], first: string): string {
  switch (outcome) {
    case 'left':
      return `${first} left early.`
    case 'ended':
      return 'You ended the date early.'
    case 'abandoned':
      return 'The date was cut short.'
    default:
      return 'You saw the date through.'
  }
}

/** "-25" with a real minus sign, "+3", or "0". */
function signedTotal(n: number): string {
  const v = round(n)
  return v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0'
}

/**
 * The damage when the character walked out. The meters stop at 0, so the date's running total
 * (`total`, DateRecord.totals[id].affection, the opening included) says how badly it went:
 * "Nova walked out after the date ran to −25 affection. Affection fell from 11 to 0, and trust
 * fell from 20 to 14." At the floor: "... Affection was already at 0, as low as it goes."
 */
export function leftDamageText(
  first: string,
  r: Pick<CharacterRecap, 'affectionBefore' | 'affectionAfter' | 'trustBefore' | 'trustAfter'>,
  total?: number,
): string {
  const ran = total != null && Number.isFinite(total) && round(total) < 0
  const opening = ran ? `${first} walked out after the date ran to ${signedTotal(total)} affection.` : `${first} walked out.`
  const floor = round(r.affectionBefore) === 0 && round(r.affectionAfter) === 0
  const aff = floor
    ? 'Affection was already at 0, as low as it goes'
    : `${meterChange('Affection', r.affectionBefore, r.affectionAfter)}${round(r.affectionAfter) === 0 ? ', as low as it goes' : ''}`
  const trustMoved = round(r.trustAfter) !== round(r.trustBefore)
  const trust = trustMoved ? `, and trust ${direction(r.trustBefore, r.trustAfter) === 'up' ? 'rose' : 'fell'} ${changeText(r.trustBefore, r.trustAfter)}` : ''
  return `${opening} ${aff}${trust}.`
}

// ---------------------------------------------------------------------------
// Discoveries

const TRAIT_KIND: Record<TraitType, { title: string; list: 'likes' | 'dislikes' | 'turnOns' | 'turnOffs' }> = {
  like: { title: 'Like', list: 'likes' },
  dislike: { title: 'Dislike', list: 'dislikes' },
  turnOn: { title: 'Turn-on', list: 'turnOns' },
  turnOff: { title: 'Turn-off', list: 'turnOffs' },
}

export interface RecapTrait {
  key: string
  type: TraitType
  kind: string
  label: string
  hint: string
}

/** Traits discovered this date, with the card's label and the judge's hint. Unknown ids are skipped. */
export function recapTraits(character: Character, traits: readonly DiscoveredTrait[] | undefined): RecapTrait[] {
  const out: RecapTrait[] = []
  for (const d of traits ?? []) {
    const kind = TRAIT_KIND[d.type]
    if (!kind) continue
    const trait = (character[kind.list] ?? []).find((t) => t.id === d.id)
    if (!trait) continue
    const key = `${d.type}:${d.id}`
    if (out.some((o) => o.key === key)) continue
    out.push({ key, type: d.type, kind: kind.title, label: trait.label, hint: (d.hint ?? '').trim() })
  }
  return out
}

function lowerFirst(s: string): string {
  const t = s.trim()
  if (t.length > 1 && /[A-Z]/.test(t[0]) && /[a-z\s]/.test(t[1])) return t[0].toLowerCase() + t.slice(1)
  return t
}

/** "the record store"; home reads as "staying in". */
export function venuePhrase(venueId: string, name: string): string {
  if (venueId === 'home') return 'staying in'
  return `the ${lowerFirst(name)}`
}

/** "Nova loves the record store." */
export function venueReactionLine(first: string, venueId: string, name: string, reaction: 'favorite' | 'hated' | 'neutral'): string {
  const where = venuePhrase(venueId, name)
  if (reaction === 'favorite') return `${first} loves ${where}.`
  if (reaction === 'hated') return `${first} can't stand ${where}.`
  return `${first} is fine with ${where}.`
}

/** "Nova loved the rare vinyl." */
export function giftReactionLine(first: string, name: string, reaction: 'loved' | 'hated' | 'neutral'): string {
  const gift = `the ${lowerFirst(name)}`
  if (reaction === 'loved') return `${first} loved ${gift}.`
  if (reaction === 'hated') return `${first} hated ${gift}.`
  return `${first} liked ${gift} well enough.`
}

/** Earned secrets' text, in the order they were earned. */
export function recapSecrets(character: Pick<Character, 'secrets'>, indexes: readonly number[] | undefined): string[] {
  return (indexes ?? []).map((i) => character.secrets?.[i]?.text?.trim() ?? '').filter(Boolean)
}

/** Tiers unlocked this date with their titles, lowest first. */
export function recapTiers(character: Pick<Character, 'gallery'>, tiers: readonly TierNumber[] | undefined): { tier: TierNumber; title: string }[] {
  return [...new Set(tiers ?? [])]
    .filter((t) => t >= 1 && t <= 5)
    .sort((a, b) => a - b)
    .map((tier) => ({ tier, title: character.gallery?.find((g) => g.tier === tier)?.title?.trim() || `Tier ${tier}` }))
}

/** What came up for the first time, as sentences. */
export function revealedLines(first: string, revealed: CharacterRecap['revealed']): string[] {
  if (!revealed) return []
  const out: string[] = []
  if (revealed.attractions) out.push(`You found out who ${first} is into.`)
  if (revealed.style) out.push(`You found out how ${first} does relationships.`)
  if (revealed.playerStyle) out.push(`${first} knows how you date now.`)
  return out
}

/** The memory line as a quote: trimmed, without wrapping quote marks. */
export function memoryQuote(text: string | undefined): string {
  return (text ?? '')
    .trim()
    .replace(/^["“'](.*)["”']$/s, '$1')
    .trim()
}

/** The recap for one character on a record, if the date has one. */
export function recapFor(record: Pick<DateRecord, 'recap' | 'characterIds'> | null | undefined, characterId?: string): CharacterRecap | undefined {
  if (!record?.recap) return undefined
  const id = characterId ?? record.characterIds?.[0]
  return id ? record.recap.perCharacter?.[id] : undefined
}

// ---------------------------------------------------------------------------
// Relationships (Phase 4): the agreement made or changed, betrayals, gossip, rumors, rekindles

const AGREEMENT_WORDS: Record<AgreementType, string> = {
  none: 'no agreement',
  exclusive: 'exclusive',
  open: 'open',
  poly: 'poly',
  casual: 'casual',
}

/** "exclusive", "open", "poly", "casual" or "no agreement". */
export function agreementWords(type: AgreementType | undefined): string {
  return AGREEMENT_WORDS[type ?? 'none'] ?? String(type)
}

export interface AgreementChange {
  /** "You went from no agreement to exclusive." */
  line: string
  /** Their terms, in their words ('' when none). */
  terms: string
  /** True when the date left them with an agreement. */
  made: boolean
}

/** The agreement made or changed on this date, before and after in words (no arrows). */
export function agreementChange(before: Agreement | undefined, after: Agreement | undefined, first: string): AgreementChange | null {
  if (!after) return null
  const b = before?.type ?? 'none'
  const a = after.type ?? 'none'
  const terms = a === 'none' ? '' : (after.terms ?? '').trim()
  if (b === a) {
    if (a === 'none') return null
    return { line: `You and ${first} are still ${agreementWords(a)}, on new terms.`, terms, made: true }
  }
  if (a === 'none') return { line: `You went from ${agreementWords(b)} to no agreement.`, terms: '', made: false }
  return { line: `You went from ${agreementWords(b)} to ${agreementWords(a)}.`, terms, made: true }
}

/** The betrayals' total hit on the meters (both negative, or 0). */
export function betrayalHit(betrayals: readonly BetrayalEvent[] | undefined): { affection: number; trust: number } {
  let affection = 0
  let trust = 0
  for (const b of betrayals ?? []) {
    affection += Number.isFinite(b.affectionDelta) ? b.affectionDelta : 0
    trust += Number.isFinite(b.trustDelta) ? b.trustDelta : 0
  }
  return { affection: Math.round(affection), trust: Math.round(trust) }
}

/** "Betrayal −12" for a meter's hit badge ('' when there's no hit). */
export function hitBadge(delta: number): string {
  const v = Math.round(delta)
  return v < 0 ? `Betrayal −${Math.abs(v)}` : ''
}

/**
 * What came out, as a sentence about them: the event's note with their name in front ("Nova heard
 * about Kai from you after you agreed to be exclusive."), or a plain line when it has none.
 */
export function betrayalLine(b: BetrayalEvent, first: string, names: Readonly<Record<string, string>>): string {
  const note = memoryQuote(b.note).replace(/[.!]+$/, '').trim()
  if (note && !/^(i|we|you)\b/i.test(note)) {
    const lead = /^[A-Z][a-z]/.test(note) ? note.charAt(0).toLowerCase() + note.slice(1) : note
    return `${first} ${lead}.`
  }
  const about = b.about ? (names[b.about] ?? b.about).trim().split(/\s+/)[0] : ''
  if (b.kind === 'lie' || !about) return `${first} caught you in a lie.`
  return `${first} found out about ${about}, and it broke what you two agreed.`
}

/** The betrayal in their own voice (the memory line it left), without wrapping quote marks. */
export function betrayalVoice(b: BetrayalEvent): string {
  return memoryQuote(b.memory ?? '')
}

export interface HeardLine {
  key: string
  /** The teller's first name ('' when unknown). */
  teller: string
  text: string
}

/**
 * Rumors this date passed on. The recap stores rumor ids (or, from older engines, the text): ids
 * found in the manifests' rumors read as the teller tells them.
 */
export function rumorLines(
  heard: readonly string[] | undefined,
  rumors: readonly Rumor[],
  names: Readonly<Record<string, string>>,
): HeardLine[] {
  const out: HeardLine[] = []
  for (const h of heard ?? []) {
    const r = rumors.find((x) => x.id === h)
    const key = r ? r.id : h
    if (!key || out.some((o) => o.key === key)) continue
    if (r) out.push({ key, teller: (names[r.teller] ?? r.teller).trim().split(/\s+/)[0], text: r.text.trim() })
    else if (h.trim()) out.push({ key, teller: '', text: h.trim() })
  }
  return out
}

/** Gossip lines, trimmed and each once. */
export function gossipLines(gossip: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const g of gossip ?? []) {
    const t = (g ?? '').trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** News a date produced (rekindles, word getting round): items dated from its start to its end. */
export function dateNews(
  record: Pick<DateRecord, 'startedAt' | 'endedAt'>,
  news: readonly NewsItem[] | undefined,
  kinds: readonly NewsItem['kind'][] = ['rekindle'],
): NewsItem[] {
  const from = record.startedAt ?? 0
  const to = (record.endedAt ?? from) + 60_000
  return (news ?? []).filter((n) => kinds.includes(n.kind) && n.at >= from && n.at <= to)
}
