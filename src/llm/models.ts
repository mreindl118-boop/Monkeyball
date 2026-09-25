// Model-id knowledge: what each Claude model accepts, which listed ids are chat models, and the
// auto-pick after Test connection. Pure functions, no network.

import type { ConnectionPreset } from '../types'
import { CLAUDE_JUDGE_MODEL, CLAUDE_STORY_MODEL } from './presets'

/** Model ids that name the same model (Ollama lists "llama3.1:latest" for "llama3.1"). */
export function sameModel(a: string, b: string): boolean {
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  return x === y || `${x}:latest` === y || x === `${y}:latest`
}

// ---------------------------------------------------------------------------
// Claude

/**
 * True when `id` is the Claude model `alias` or a dated snapshot of it: the Models API lists
 * Haiku 4.5 as claude-haiku-4-5-20251001, which the alias claude-haiku-4-5 points at.
 */
export function isClaudeSnapshotOf(id: string, alias: string): boolean {
  const x = id.trim().toLowerCase()
  const a = alias.trim().toLowerCase()
  if (!a) return false
  return sameModel(x, a) || (x.startsWith(`${a}-`) && /^-\d{8}$/.test(x.slice(a.length)))
}

/** A Claude id is listed as itself or as a dated snapshot of it. */
export function claudeListed(models: readonly string[], model: string): boolean {
  return models.some((x) => isClaudeSnapshotOf(x, model))
}

/** The same Claude model, whichever of the two is the alias and which the dated snapshot. */
export function sameClaudeModel(a: string, b: string): boolean {
  return isClaudeSnapshotOf(a, b) || isClaudeSnapshotOf(b, a)
}

interface ClaudeId {
  family: string
  major: number
  minor: number
}

/** claude-opus-5, claude-opus-4-6, claude-haiku-4-5-20251001, claude-3-7-sonnet-20250219. */
export function parseClaudeId(model: string): ClaudeId | null {
  const id = model.trim().toLowerCase()
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id)
  if (m) return { family: m[1], major: Number(m[2]), minor: m[3] ? Number(m[3]) : 0 }
  const old = /^claude-(\d)(?:-(\d))?-([a-z]+)/.exec(id)
  if (old) return { family: old[3], major: Number(old[1]), minor: old[2] ? Number(old[2]) : 0 }
  return null
}

/**
 * Whether a Claude model takes temperature. Opus 5, Sonnet 5, Opus 4.7 and later, Fable and
 * Mythos reject sampling parameters with a 400; Haiku 4.5 and the 4.6 generation accept them.
 * Unknown ids get nothing (the adapter learns from a 400 if it ever sends one).
 */
export function claudeAcceptsSampling(model: string): boolean {
  const c = parseClaudeId(model)
  if (!c) return false
  if (c.family === 'fable' || c.family === 'mythos') return false
  if (c.major >= 5) return false
  if (c.major === 4) return c.minor <= 6
  return c.major === 3
}

/** Whether a Claude model takes output_config.effort (Haiku 4.5 and older models error on it). */
export function claudeAcceptsEffort(model: string): boolean {
  const c = parseClaudeId(model)
  if (!c) return true
  if (c.major <= 3) return false
  if (c.major === 4) {
    if (c.family === 'haiku') return false
    if (c.family === 'sonnet') return c.minor >= 6
    if (c.family === 'opus') return c.minor >= 5
  }
  return true
}

/** Models that take the server-side refusal fallback (`fallbacks: 'default'`). */
export const FALLBACK_MODELS: readonly string[] = ['claude-opus-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-opus-5-5']

export function claudeSupportsFallbacks(model: string): boolean {
  return FALLBACK_MODELS.includes(model.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// Chat-model lists and auto-pick

// deep-research models (o3-deep-research...) only work on the Responses API, like -pro ones.
const NOT_CHAT =
  /(embed|audio|image|imagine|dall-e|tts|whisper|moderation|realtime|transcribe|search|instruct|codex|computer-use|video|vision|sora|babbage|davinci|deep-research)/i

/**
 * The ids worth offering in a model picker for this preset (drops image, audio, embedding...).
 * Claude: a dated snapshot of a default model (claude-haiku-4-5-20251001) is offered as the
 * default's alias, so the picker and the settings use the exact id without a date.
 */
export function chatModels(preset: ConnectionPreset, ids: readonly string[]): string[] {
  switch (preset) {
    case 'claude': {
      const out: string[] = []
      for (const id of ids) {
        const alias = [CLAUDE_STORY_MODEL, CLAUDE_JUDGE_MODEL].find((a) => isClaudeSnapshotOf(id, a)) ?? id
        if (!out.includes(alias)) out.push(alias)
      }
      return out
    }
    case 'chatgpt':
      return ids.filter((id) => /^(gpt-|o\d|chatgpt-)/i.test(id) && !NOT_CHAT.test(id) && !/-pro\b/i.test(id))
    case 'grok':
      return ids.filter((id) => /^grok-/i.test(id) && !/(image|imagine|video|vision)/i.test(id))
    default:
      return [...ids]
  }
}

interface Ranked {
  id: string
  version: number
  /** 0 for the plain alias, higher for dated snapshots, previews and other suffixes. */
  suffix: number
  rest: string
}

function suffixScore(rest: string): number {
  if (!rest) return 0
  if (/^-(\d{4}-\d{2}-\d{2}|\d{4}|latest)$/.test(rest)) return 1
  if (/^-chat-latest$/.test(rest)) return 2
  return 3
}

function best(list: Ranked[]): string | undefined {
  return [...list].sort((a, b) => b.version - a.version || a.suffix - b.suffix || a.id.length - b.id.length)[0]?.id
}

function rankGpt(ids: readonly string[]): Ranked[] {
  const out: Ranked[] = []
  for (const id of chatModels('chatgpt', ids)) {
    const m = /^gpt-(\d+(?:\.\d+)?)(o?)(.*)$/i.exec(id)
    if (!m) continue
    // gpt-4o came out between gpt-4 and gpt-4.1.
    const version = Number(m[1]) + (m[2] ? 0.05 : 0)
    out.push({ id, version, rest: m[3].toLowerCase(), suffix: 0 })
  }
  return out
}

function rankGrok(ids: readonly string[]): Ranked[] {
  const out: Ranked[] = []
  for (const id of chatModels('grok', ids)) {
    const m = /^grok-(\d+)(?:[-.](\d)(?!\d))?(.*)$/i.exec(id)
    if (!m) continue
    const version = Number(m[1]) + (m[2] ? Number(m[2]) / 10 : 0)
    out.push({ id, version, rest: m[3].toLowerCase(), suffix: 0 })
  }
  return out
}

function scored(list: Ranked[], strip: RegExp = /^$/): Ranked[] {
  return list.map((r) => ({ ...r, suffix: suffixScore(r.rest.replace(strip, '')) }))
}

export interface ModelPicks {
  story?: string
  judge?: string
}

/**
 * Sensible story and judge models from a preset's model list, used after Test connection when a
 * role has no model yet. ChatGPT: the newest full gpt-* chat model and the newest *-mini. Grok:
 * the newest full grok-* model and a fast (preferably non-reasoning) or mini variant. Claude: the
 * defaults when listed. Others: the first listed model for the story, and the same for the judge.
 */
export function pickModels(preset: ConnectionPreset, ids: readonly string[]): ModelPicks {
  if (preset === 'claude') {
    // The alias counts as listed when the API lists a dated snapshot of it; the alias is stored.
    const has = (m: string) => ids.length === 0 || claudeListed(ids, m)
    const story = has(CLAUDE_STORY_MODEL) ? CLAUDE_STORY_MODEL : ids.find((x) => /opus/.test(x)) ?? ids[0]
    const judge = has(CLAUDE_JUDGE_MODEL) ? CLAUDE_JUDGE_MODEL : ids.find((x) => /haiku/.test(x)) ?? story
    return { story, judge }
  }
  if (preset === 'chatgpt') {
    const gpt = rankGpt(ids)
    const story = best(scored(gpt.filter((r) => !/(mini|nano)/.test(r.rest))))
    const judge =
      best(scored(gpt.filter((r) => /-mini(\b|$)/.test(r.rest)), /^-mini/)) ??
      chatModels('chatgpt', ids).find((id) => /-mini$/.test(id))
    return { story: story ?? judge, judge: judge ?? story }
  }
  if (preset === 'grok') {
    const grok = rankGrok(ids).filter((r) => !/code/.test(r.rest))
    const story =
      best(scored(grok.filter((r) => !/(fast|mini)/.test(r.rest)))) ?? best(scored(grok, /^-fast(-reasoning)?/))
    const judge =
      best(scored(grok.filter((r) => /fast-non-reasoning/.test(r.rest)), /^-fast-non-reasoning/)) ??
      best(scored(grok.filter((r) => /fast/.test(r.rest)), /^-fast(-reasoning)?/)) ??
      best(scored(grok.filter((r) => /mini/.test(r.rest)), /^-mini(-fast)?/))
    return { story: story ?? judge, judge: judge ?? story }
  }
  return ids.length ? { story: ids[0] } : {}
}
