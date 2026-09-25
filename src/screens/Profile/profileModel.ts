// Pure helpers behind the profile screen: what's discovered, what's locked and why, and how
// relationship facts read. No React, no stores.

import { TIER_UNLOCKS } from '../../mods/normalize'
import { describeAttractions, nextStage, stageFor, stageLabel } from '../../engine/stages'
import type {
  Agreement,
  AgreementType,
  Character,
  Jealousy,
  PartnerRelation,
  Relationship,
  Route,
  Secret,
  Style,
  TierNumber,
  Trait,
  TraitType,
} from '../../types'

export const HIDDEN = '???'

// ---------------------------------------------------------------------------
// Traits

export interface TraitCategory {
  type: TraitType
  key: 'likes' | 'dislikes' | 'turnOns' | 'turnOffs'
  title: string
}

export const TRAIT_CATEGORIES: readonly TraitCategory[] = [
  { type: 'like', key: 'likes', title: 'Likes' },
  { type: 'dislike', key: 'dislikes', title: 'Dislikes' },
  { type: 'turnOn', key: 'turnOns', title: 'Turn-ons' },
  { type: 'turnOff', key: 'turnOffs', title: 'Turn-offs' },
]

export interface TraitRow {
  /** The card's trait id (kept for keys even when hidden). */
  id: string
  discovered: boolean
  /** The trait's label once discovered, else "???". */
  label: string
  /** The judge's hint from the moment it was discovered. */
  hint: string
}

export interface TraitGroup extends TraitCategory {
  rows: TraitRow[]
  discovered: number
  total: number
}

/** Traits by category in card order; hidden ones read "???". */
export function traitGroups(
  character: Pick<Character, 'likes' | 'dislikes' | 'turnOns' | 'turnOffs'>,
  rel: Pick<Relationship, 'discovered'>,
): TraitGroup[] {
  return TRAIT_CATEGORIES.map((cat) => {
    const list: Trait[] = character[cat.key] ?? []
    const rows = list.map((t) => {
      const found = (rel.discovered ?? []).find((d) => d.type === cat.type && d.id === t.id)
      return found
        ? { id: t.id, discovered: true, label: t.label, hint: found.hint ?? '' }
        : { id: t.id, discovered: false, label: HIDDEN, hint: '' }
    })
    return { ...cat, rows, discovered: rows.filter((r) => r.discovered).length, total: rows.length }
  })
}

/** "2/5" */
export function fraction(found: number, total: number): string {
  return `${found}/${total}`
}

// ---------------------------------------------------------------------------
// Secrets and gallery

/**
 * What unlocks a locked secret. On a romantic route secrets open with affection; on a friend
 * route, where affection stops at 59, they open with trust (docs/ARCHITECTURE.md, unlocks.ts).
 */
export function secretLockText(secret: Pick<Secret, 'unlockAt'>, route: Route): string {
  return route === 'friend' ? `Unlocks at ${secret.unlockAt} trust` : `Unlocks at ${secret.unlockAt} affection`
}

export interface SecretRow {
  index: number
  earned: boolean
  /** The secret once earned; the unlock condition while locked. */
  text: string
}

export function secretRows(
  character: Pick<Character, 'secrets'>,
  rel: Pick<Relationship, 'secretsUnlocked'>,
  route: Route,
): SecretRow[] {
  return (character.secrets ?? []).map((s, index) => {
    const earned = (rel.secretsUnlocked ?? []).includes(index)
    return { index, earned, text: earned ? s.text : secretLockText(s, route) }
  })
}

/** Tiers a friend route can never unlock (only 1 and 2 open as a friend). */
export function friendshipLocked(tier: TierNumber, route: Route): boolean {
  return route === 'friend' && tier > 2
}

/** Why a gallery tier is still locked: "Unlocks at 60", or "Friendship-locked" on a friend route. */
export function tierLockText(tier: TierNumber, route: Route): string {
  return friendshipLocked(tier, route) ? 'Friendship-locked' : `Unlocks at ${TIER_UNLOCKS[tier]}`
}

export interface TierSlot {
  tier: TierNumber
  title: string
  unlocked: boolean
  /** Empty when unlocked. */
  lock: string
}

/** The five gallery slots, 1 to 5, whatever order the card lists them in. */
export function gallerySlots(
  character: Pick<Character, 'gallery'>,
  rel: Pick<Relationship, 'tiersUnlocked'>,
  route: Route,
): TierSlot[] {
  return ([1, 2, 3, 4, 5] as TierNumber[]).map((tier) => {
    const entry = (character.gallery ?? []).find((t) => t.tier === tier)
    const unlocked = (rel.tiersUnlocked ?? []).includes(tier)
    return {
      tier,
      title: entry?.title.trim() || `Tier ${tier}`,
      unlocked,
      lock: unlocked ? '' : tierLockText(tier, route),
    }
  })
}

// ---------------------------------------------------------------------------
// Stage, route, agreement

/** "Next: Crush at 60." or "" at Won; on a friend route, where Friend is the top, the cap. */
export function nextStageText(affection: number, route: Route): string {
  if (route === 'friend' && affection >= 40) return 'Friend is as far as this goes.'
  const next = nextStage(affection)
  return next ? `Next: ${next.label} at ${next.min}.` : ''
}

export function routeTitle(route: Route): string {
  return route === 'friend' ? 'Friend route' : 'Romantic route'
}

/** One line explaining the route. `mode` is the orientation mode in effect. */
export function routeExplanation(name: string, route: Route, mode: 'realistic' | 'everyone'): string {
  if (route === 'friend') {
    return `${name} isn't into your gender, so this stays a friendship: affection stops at Friend, tiers 1 and 2 and their secrets can still unlock, and friends share gossip.`
  }
  return mode === 'everyone'
    ? `Everyone's into you is on, so ${name} is dateable. Everything is possible, at their pace.`
    : `${name} could fall for you. Everything is possible, at their pace.`
}

const AGREEMENT_TITLES: Record<AgreementType, string> = {
  none: 'None yet',
  exclusive: 'Exclusive',
  open: 'Open',
  poly: 'Poly',
  casual: 'Casual',
}

export interface AgreementView {
  title: string
  /** Their terms, or the explanation when there's no agreement. */
  detail: string
  made: boolean
}

export function agreementView(agreement: Agreement | undefined): AgreementView {
  const type = agreement?.type ?? 'none'
  if (type === 'none') {
    return {
      title: AGREEMENT_TITLES.none,
      detail: 'Nobody has asked yet, so dating around breaks no promises. From Friend either of you can define it.',
      made: false,
    }
  }
  const terms = agreement?.terms.trim() ?? ''
  return { title: AGREEMENT_TITLES[type] ?? type, detail: terms, made: true }
}

// ---------------------------------------------------------------------------
// Attractions and style

const STYLE_TEXT: Record<Style, string> = {
  monogamous: 'Monogamous',
  open: 'Open',
  polyamorous: 'Polyamorous',
  flexible: 'Flexible',
}

const JEALOUSY_TEXT: Record<Jealousy, string> = {
  compersion: 'happy when you are happy with others',
  low: 'low jealousy',
  medium: 'medium jealousy',
  high: 'high jealousy',
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** "Bi. Into women, men and nonbinary people." plus the ace spectrum label when the card has one. */
export function attractionsText(c: Pick<Character, 'orientation' | 'attractedTo' | 'aceSpectrum'>): string {
  const parts: string[] = []
  const orientation = c.orientation?.trim()
  if (orientation) parts.push(`${capitalize(orientation)}.`)
  const into = describeAttractions(c.attractedTo ?? [])
  if (into) parts.push(`Into ${into}.`)
  const ace = c.aceSpectrum?.label.trim()
  if (ace) parts.push(`${capitalize(ace)}.`)
  return parts.join(' ')
}

/** "Open, low jealousy." */
export function styleText(c: Pick<Character, 'relationshipStyle' | 'jealousy'>): string {
  const style = STYLE_TEXT[c.relationshipStyle] ?? capitalize(String(c.relationshipStyle ?? ''))
  const jealousy = JEALOUSY_TEXT[c.jealousy]
  return jealousy ? `${style}, ${jealousy}.` : `${style}.`
}

// ---------------------------------------------------------------------------
// Venues, gifts, partners

export function venueReactionText(r: 'favorite' | 'hated' | 'neutral'): string {
  return r === 'favorite' ? 'Loves it' : r === 'hated' ? "Can't stand it" : 'Fine with it'
}

export function giftReactionText(r: 'loved' | 'hated' | 'neutral'): string {
  return r === 'loved' ? 'Loved it' : r === 'hated' ? 'Hated it' : 'It was fine'
}

/** Partners and exes come up once there's some closeness: 20 affection or 20 trust. */
export const PARTNERS_AT = 20

export function partnersKnown(rel: Pick<Relationship, 'affection' | 'trust'>): boolean {
  return rel.affection >= PARTNERS_AT || rel.trust >= PARTNERS_AT
}

const RELATION_TEXT: Record<PartnerRelation, string> = {
  partner: 'Partner',
  ex: 'Ex',
  situationship: 'Situationship',
}

export function relationText(kind: PartnerRelation): string {
  return RELATION_TEXT[kind] ?? capitalize(kind)
}

export function isPartnerRelation(kind: string): kind is PartnerRelation {
  return kind === 'partner' || kind === 'ex' || kind === 'situationship'
}

/** "28, she/her" (age and pronouns, whichever are set). */
export function ageLine(c: Pick<Character, 'age' | 'pronouns'>): string {
  return [Number.isFinite(c.age) ? String(c.age) : '', c.pronouns?.trim() ?? ''].filter(Boolean).join(', ')
}

/** Stage label for an affection value, e.g. "Friend". */
export function stageName(affection: number): string {
  return stageLabel(stageFor(affection))
}
