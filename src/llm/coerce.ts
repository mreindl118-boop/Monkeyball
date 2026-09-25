// Coercers for jsonChat: turn loosely-shaped model JSON into the typed results, or null.

import type { AgreementResult, AgreementType, JudgeHit, JudgeResult, Suggestions, TraitType } from '../types'

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^\s*[+-]?\d+(\.\d+)?\s*$/.test(v)) return Number(v)
  return null
}

function bool(v: unknown): boolean {
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true')
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The neutral judge result used when the judge can't be parsed: delta 0, no hits. */
export function neutralJudge(): JudgeResult {
  return { delta: 0, trustDelta: 0, hits: [], mood: 'neutral', hint: '', jealousy: false, breach: false }
}

export function normalizeTraitType(v: unknown): TraitType | null {
  const t = text(v).toLowerCase().replace(/[\s_-]+/g, '')
  switch (t) {
    case 'like':
    case 'likes':
      return 'like'
    case 'dislike':
    case 'dislikes':
      return 'dislike'
    case 'turnon':
    case 'turnons':
      return 'turnOn'
    case 'turnoff':
    case 'turnoffs':
      return 'turnOff'
    default:
      return null
  }
}

/**
 * Judge JSON -> JudgeResult. Needs a numeric delta; everything else defaults. Deltas are
 * clamped to the prompt's ranges (delta -20..10, trustDelta -10..10) and rounded.
 * Unknown trait ids are kept here; discovery ignores ids the character doesn't have.
 */
export function coerceJudge(raw: unknown): JudgeResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const delta = num(o.delta)
  if (delta === null) return null
  const trustDelta = num(o.trustDelta ?? o.trust_delta) ?? 0
  const hits: JudgeHit[] = []
  if (Array.isArray(o.hits)) {
    for (const h of o.hits) {
      if (!h || typeof h !== 'object') continue
      const type = normalizeTraitType((h as Record<string, unknown>).type)
      const id = text((h as Record<string, unknown>).id)
      if (type && id && !hits.some((x) => x.type === type && x.id === id)) hits.push({ type, id })
    }
  }
  return {
    delta: Math.round(clamp(delta, -20, 10)),
    trustDelta: Math.round(clamp(trustDelta, -10, 10)),
    hits,
    mood: text(o.mood) || 'neutral',
    hint: text(o.hint),
    jealousy: bool(o.jealousy),
    breach: bool(o.breach),
  }
}

const AGREEMENT_WORDS: Readonly<Record<string, AgreementType>> = {
  exclusive: 'exclusive',
  monogamous: 'exclusive',
  monogamy: 'exclusive',
  mono: 'exclusive',
  exclusivity: 'exclusive',
  'exclusive relationship': 'exclusive',
  'just us': 'exclusive',
  'only us': 'exclusive',
  open: 'open',
  'open relationship': 'open',
  'non-monogamous': 'open',
  'non monogamous': 'open',
  enm: 'open',
  poly: 'poly',
  polyamorous: 'poly',
  polyamory: 'poly',
  polycule: 'poly',
  casual: 'casual',
  'keep it casual': 'casual',
  'casual dating': 'casual',
  'no labels': 'casual',
  'friends with benefits': 'casual',
  none: 'none',
  'no agreement': 'none',
  nothing: 'none',
  declined: 'none',
  undecided: 'none',
  '': 'none',
}

/**
 * The agreement word, tolerant of synonyms ("monogamous", "polyamory", "open relationship", "keep
 * it casual"), case, quotes and trailing punctuation. The template's own "exclusive|open|..." echoed
 * back, or an unknown word, is null.
 */
export function normalizeAgreementType(v: unknown): AgreementType | null {
  const t = text(v)
    .toLowerCase()
    .replace(/^["'“]+|["'”.!]+$/g, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
  if (t.includes('|')) return null
  return Object.hasOwn(AGREEMENT_WORDS, t) ? AGREEMENT_WORDS[t] : null
}

/** accepted: true/"true"/"yes"/"accepted"/"agreed", or a status of accepted or countered. */
function acceptedFlag(o: Record<string, unknown>): boolean {
  const a = o.accepted
  if (typeof a === 'boolean') return a
  const word = text(a ?? o.status ?? o.outcome).toLowerCase()
  return ['true', 'yes', 'accepted', 'accept', 'agreed', 'agree', 'countered', 'counter'].includes(word)
}

/** The fallback agreement result: declined, nothing changes. */
export function noAgreementResult(): AgreementResult {
  return { agreement: 'none', accepted: false, terms: '', trustDelta: 0 }
}

/**
 * Agreement JSON -> AgreementResult. The agreement word is read tolerantly (normalizeAgreementType;
 * `type` is accepted for `agreement`); accepted also reads "yes" and a status of accepted or
 * countered, and is never true for 'none'. Terms are one line, at most 300 characters. trustDelta
 * is clamped to -5..5.
 */
export function coerceAgreement(raw: unknown): AgreementResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const agreement = normalizeAgreementType(o.agreement ?? o.type)
  if (agreement === null) return null
  const terms = text(o.terms).replace(/\s+/g, ' ')
  return {
    agreement,
    accepted: acceptedFlag(o) && agreement !== 'none',
    terms: terms.length > 300 ? `${terms.slice(0, 299).trimEnd()}…` : terms,
    trustDelta: Math.round(clamp(num(o.trustDelta ?? o.trust_delta) ?? 0, -5, 5)),
  }
}

/** Suggestions JSON -> the three chips for these keys, or null when any is missing. */
export function coerceSuggestions(keys: readonly string[]): (raw: unknown) => Suggestions | null {
  return (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const o = raw as Record<string, unknown>
    const out: Suggestions = {}
    for (const k of keys) {
      const v = text(o[k]).replace(/^["'“]+|["'”]+$/g, '').trim()
      if (!v) return null
      out[k] = v
    }
    return out
  }
}
