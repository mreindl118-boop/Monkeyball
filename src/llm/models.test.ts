import { describe, expect, it } from 'vitest'
import {
  chatModels,
  claudeAcceptsEffort,
  claudeAcceptsSampling,
  claudeListed,
  claudeSupportsFallbacks,
  isClaudeSnapshotOf,
  parseClaudeId,
  pickModels,
} from './models'

describe('Claude model rules', () => {
  it('parses current and older ids', () => {
    expect(parseClaudeId('claude-opus-5')).toEqual({ family: 'opus', major: 5, minor: 0 })
    expect(parseClaudeId('claude-haiku-4-5-20251001')).toEqual({ family: 'haiku', major: 4, minor: 5 })
    expect(parseClaudeId('claude-3-7-sonnet-20250219')).toEqual({ family: 'sonnet', major: 3, minor: 7 })
    expect(parseClaudeId('gpt-5')).toBeNull()
  })

  it('knows who takes sampling, effort and fallbacks', () => {
    expect(claudeAcceptsSampling('claude-opus-5')).toBe(false)
    expect(claudeAcceptsSampling('claude-opus-5-5')).toBe(false)
    expect(claudeAcceptsSampling('claude-opus-4-8')).toBe(false)
    expect(claudeAcceptsSampling('claude-opus-4-6')).toBe(true)
    expect(claudeAcceptsSampling('claude-haiku-4-5')).toBe(true)
    expect(claudeAcceptsEffort('claude-haiku-4-5')).toBe(false)
    expect(claudeAcceptsEffort('claude-sonnet-4-5')).toBe(false)
    expect(claudeAcceptsEffort('claude-opus-4-5')).toBe(true)
    expect(claudeAcceptsEffort('claude-opus-5')).toBe(true)
    expect(claudeAcceptsEffort('claude-fable-5-1')).toBe(true)
    expect(claudeSupportsFallbacks('claude-opus-5')).toBe(true)
    expect(claudeSupportsFallbacks('claude-fable-5-1')).toBe(true)
    expect(claudeSupportsFallbacks('claude-fable-5')).toBe(true)
    expect(claudeSupportsFallbacks('claude-opus-5-5')).toBe(true)
    expect(claudeSupportsFallbacks('claude-haiku-4-5')).toBe(false)
  })
})

const OPENAI_LIST = [
  'whisper-1',
  'dall-e-3',
  'tts-1-hd',
  'text-embedding-3-large',
  'omni-moderation-latest',
  'gpt-4o-realtime-preview',
  'gpt-4o-audio-preview',
  'gpt-4o-mini-transcribe',
  'gpt-4o-mini-tts',
  'gpt-image-1',
  'gpt-3.5-turbo',
  'gpt-3.5-turbo-instruct',
  'gpt-4-turbo',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4o-search-preview',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5-2025-08-07',
  'gpt-5',
  'gpt-5-mini-2025-08-07',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5-pro',
  'gpt-5-codex',
  'gpt-5-chat-latest',
  'gpt-5.1',
  'gpt-5.1-chat-latest',
  'gpt-5.1-codex-mini',
  'o3',
  'o4-mini',
  'o3-deep-research',
  'o4-mini-deep-research',
]

const XAI_LIST = [
  'grok-2-image-1212',
  'grok-2-vision-1212',
  'grok-3',
  'grok-3-mini',
  'grok-4-0709',
  'grok-4',
  'grok-4-fast-reasoning',
  'grok-4-fast-non-reasoning',
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-code-fast-1',
  'grok-imagine-image',
  'grok-imagine-video',
]

describe('chatModels', () => {
  it('drops image, audio, embedding, moderation, realtime and other non-chat models', () => {
    const chat = chatModels('chatgpt', OPENAI_LIST)
    for (const id of ['whisper-1', 'dall-e-3', 'tts-1-hd', 'text-embedding-3-large', 'omni-moderation-latest', 'gpt-4o-realtime-preview', 'gpt-4o-audio-preview', 'gpt-4o-mini-transcribe', 'gpt-4o-mini-tts', 'gpt-image-1', 'gpt-4o-search-preview', 'gpt-5-pro', 'gpt-5-codex', 'gpt-3.5-turbo-instruct', 'o3-deep-research', 'o4-mini-deep-research']) {
      expect(chat).not.toContain(id)
    }
    expect(chat).toEqual(expect.arrayContaining(['gpt-5.1', 'gpt-5-mini', 'gpt-4o', 'o3', 'o4-mini']))
    expect(chatModels('grok', XAI_LIST)).not.toEqual(expect.arrayContaining(['grok-imagine-image']))
    expect(chatModels('grok', XAI_LIST)).not.toContain('grok-2-image-1212')
    expect(chatModels('ollama', ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('offers a dated snapshot of a Claude default as its alias', () => {
    expect(chatModels('claude', ['claude-opus-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929'])).toEqual([
      'claude-opus-5',
      'claude-haiku-4-5',
      'claude-sonnet-4-5-20250929',
    ])
    expect(chatModels('claude', ['claude-haiku-4-5', 'claude-haiku-4-5-20251001'])).toEqual(['claude-haiku-4-5'])
  })
})

describe('Claude snapshots', () => {
  it('knows a dated snapshot of an alias', () => {
    expect(isClaudeSnapshotOf('claude-haiku-4-5-20251001', 'claude-haiku-4-5')).toBe(true)
    expect(isClaudeSnapshotOf('claude-haiku-4-5', 'claude-haiku-4-5')).toBe(true)
    expect(isClaudeSnapshotOf('claude-haiku-4-5-20251001', 'claude-haiku-4')).toBe(false)
    expect(isClaudeSnapshotOf('claude-opus-5-5', 'claude-opus-5')).toBe(false)
    expect(claudeListed(['claude-haiku-4-5-20251001'], 'claude-haiku-4-5')).toBe(true)
  })
})

describe('pickModels', () => {
  it('ChatGPT: newest full gpt model for the story, newest mini for the judge', () => {
    expect(pickModels('chatgpt', OPENAI_LIST)).toEqual({ story: 'gpt-5.1', judge: 'gpt-5-mini' })
    expect(pickModels('chatgpt', ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'])).toEqual({ story: 'gpt-4.1', judge: 'gpt-4.1-mini' })
    expect(pickModels('chatgpt', ['gpt-5-2025-08-07', 'gpt-5-mini-2025-08-07'])).toEqual({
      story: 'gpt-5-2025-08-07',
      judge: 'gpt-5-mini-2025-08-07',
    })
    expect(pickModels('chatgpt', ['whisper-1'])).toEqual({ story: undefined, judge: undefined })
  })

  it('Grok: newest full grok model for the story, a fast non-reasoning one for the judge', () => {
    expect(pickModels('grok', XAI_LIST)).toEqual({ story: 'grok-4', judge: 'grok-4-1-fast-non-reasoning' })
    expect(pickModels('grok', ['grok-3', 'grok-3-mini'])).toEqual({ story: 'grok-3', judge: 'grok-3-mini' })
    expect(pickModels('grok', ['grok-4-fast-reasoning'])).toEqual({ story: 'grok-4-fast-reasoning', judge: 'grok-4-fast-reasoning' })
  })

  it('Claude: the defaults when listed', () => {
    expect(pickModels('claude', ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'])).toEqual({
      story: 'claude-opus-5',
      judge: 'claude-haiku-4-5',
    })
    expect(pickModels('claude', [])).toEqual({ story: 'claude-opus-5', judge: 'claude-haiku-4-5' })
  })

  it('Claude: the alias, never the dated id the Models API lists', () => {
    expect(pickModels('claude', ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'])).toEqual({
      story: 'claude-opus-5',
      judge: 'claude-haiku-4-5',
    })
  })

  it('others: the first listed model for the story', () => {
    expect(pickModels('ollama', ['llama3.1:latest', 'qwen3'])).toEqual({ story: 'llama3.1:latest' })
    expect(pickModels('custom', [])).toEqual({})
  })
})
