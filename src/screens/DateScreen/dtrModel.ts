// Pure helpers for Define the relationship on the date screen: the four choices with their
// one-line explanations (docs/SPEC.md, "Affection & Trust", Agreements), the brass state while the
// talk is open, the character's own offer, and the outcome in words. No React, no stores.

import type { Agreement, AgreementResult, AgreementType } from '../../types'
import { firstName } from './dateModel'

export type DtrChoiceType = Exclude<AgreementType, 'none'>

export interface DtrChoice {
  type: DtrChoiceType
  title: string
  /** One line from the spec's rules for that agreement. */
  line: string
}

export const DTR_CHOICES: readonly DtrChoice[] = [
  { type: 'exclusive', title: 'Exclusive', line: 'Just the two of you. Exclusive means exclusive.' },
  {
    type: 'open',
    title: 'Open',
    line: "You can both see other people and don't have to report back, unless the terms say otherwise.",
  },
  {
    type: 'poly',
    title: 'Poly',
    line: 'Partners are known to each other and disclosure is expected. How metamours get on moves trust.',
  },
  { type: 'casual', title: 'Keep it casual', line: 'No labels, no promises.' },
]

/** "exclusive", "open", "poly", "casual" (and "keep it casual" as a request). */
export function dtrWord(type: AgreementType, asRequest = false): string {
  if (type === 'casual') return asRequest ? 'keeping it casual' : 'casual'
  if (type === 'none') return 'no agreement'
  return type
}

/** The choice a sheet opens on: what the character asked for, else the agreement you already have. */
export function initialChoice(offer: AgreementType | null | undefined, current: AgreementType | undefined): DtrChoiceType {
  if (offer && offer !== 'none') return offer
  if (current && current !== 'none') return current
  return 'exclusive'
}

/** The brass banner when the character opens the talk. */
export function offerText(name: string): string {
  return `${firstName(name)} wants to talk about what you are`
}

/** The offer's second line: what they have in mind. */
export function offerDetail(name: string, offer: AgreementType | null | undefined): string {
  const f = firstName(name)
  if (!offer || offer === 'none') return `${f} would like to know where this is going.`
  return `${f} has ${dtrWord(offer, true)} in mind.`
}

/** The line under "Defining the relationship" while the talk is open. */
export function dtrOpenLine(name: string, requested: AgreementType, by: 'player' | 'character'): string {
  const f = firstName(name)
  return by === 'character'
    ? `${f} brought it up and has ${dtrWord(requested, true)} in mind. Say what you want, then close the talk.`
    : `You asked for ${dtrWord(requested, true)}. Say what you want, then close the talk.`
}

export type DtrOutcomeKind = 'accepted' | 'countered' | 'declined'

export interface DtrOutcome {
  kind: DtrOutcomeKind
  title: string
  line: string
  /** Their terms, in their words ('' when none). */
  terms: string
}

/**
 * How the talk ended: accepted (what you asked for), countered (they said yes to something else,
 * which is what you are now) or declined (nothing changes).
 */
export function dtrOutcome(
  name: string,
  requested: AgreementType,
  result: AgreementResult,
  before?: Pick<Agreement, 'type'>,
  by: 'player' | 'character' = 'player',
): DtrOutcome {
  const f = firstName(name)
  const terms = (result.terms ?? '').trim()
  if (result.accepted && result.agreement !== 'none') {
    if (result.agreement === requested) {
      return { kind: 'accepted', title: by === 'character' ? `You said yes to ${f}` : `${f} said yes`, line: `You're ${dtrWord(result.agreement)} now.`, terms }
    }
    const asked = by === 'character' ? `${f} had ${dtrWord(requested, true)} in mind.` : `You asked for ${dtrWord(requested, true)}.`
    return {
      kind: 'countered',
      title: `${f} countered`,
      line: `${asked} You settled on ${dtrWord(result.agreement)}.`,
      terms,
    }
  }
  const still = before?.type && before.type !== 'none' ? `You're still ${dtrWord(before.type)}.` : 'Nothing is agreed yet.'
  return { kind: 'declined', title: terms ? `${f} said no` : "The talk didn't settle anything", line: still, terms }
}
