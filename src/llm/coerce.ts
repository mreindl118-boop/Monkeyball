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

function normalizeAgreementType(v: unknown): AgreementType | null {
  const t = text(v).toLowerCase()
  if (t === 'exclusive' || t === 'monogamous') return 'exclusive'
  if (t === 'open') return 'open'
  if (t === 'poly' || t === 'polyamorous') return 'poly'
  if (t === 'casual') return 'casual'
  if (t === 'none' || t === '') return 'none'
  return null
}

/** The fallback agreement result: declined, nothing changes. */
export function noAgreementResult(): AgreementResult {
  return { agreement: 'none', accepted: false, terms: '', trustDelta: 0 }
}

/** Agreement JSON -> AgreementResult. trustDelta is clamped to -5..5. */
export function coerceAgreement(raw: unknown): AgreementResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const agreement = normalizeAgreementType(o.agreement)
  if (agreement === null) return null
  return {
    agreement,
    accepted: bool(o.accepted) && agreement !== 'none',
    terms: text(o.terms),
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
