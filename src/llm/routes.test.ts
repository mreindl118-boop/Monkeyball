import { describe, expect, it } from 'vitest'
import { DEFAULT_CONNECTION } from '../store/defaults'
import type { ConnectionSettings } from '../types'
import { endpointFor, modelsOnPreset, resolveRoute, rolePreset, routeGap } from './routes'

const settings = (patch: Partial<ConnectionSettings> = {}): ConnectionSettings => ({
  ...(structuredClone(DEFAULT_CONNECTION) as ConnectionSettings),
  ...patch,
})

describe('resolveRoute', () => {
  it('defaults to Claude for both roles: Opus 5 writes, Haiku 4.5 judges', () => {
    const c = settings()
    expect(resolveRoute(c, 'story')).toEqual({
      role: 'story',
      preset: 'claude',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
      model: 'claude-opus-5',
    })
    expect(resolveRoute(c, 'judge')).toMatchObject({ preset: 'claude', provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(routeGap(resolveRoute(c, 'story'))).toBe('key')
  })

  it('routes the story to Claude and the judge to Grok, each with its own key', () => {
    const c = settings()
    c.providers.claude.apiKey = 'sk-ant-1'
    c.providers.grok.apiKey = 'xai-2'
    c.judge = { preset: 'grok', model: 'grok-4-fast-non-reasoning' }
    expect(resolveRoute(c, 'story')).toMatchObject({ preset: 'claude', provider: 'anthropic', apiKey: 'sk-ant-1', model: 'claude-opus-5' })
    expect(resolveRoute(c, 'judge')).toEqual({
      role: 'judge',
      preset: 'grok',
      provider: 'openai',
      baseUrl: 'https://api.x.ai/v1',
      apiKey: 'xai-2',
      model: 'grok-4-fast-non-reasoning',
    })
    expect(routeGap(resolveRoute(c, 'judge'))).toBeNull()
  })

  it("'same' follows the story preset; an empty judge model means the story model", () => {
    const c = settings({ story: { preset: 'chatgpt', model: 'gpt-5.1' }, judge: { preset: 'same', model: '' } })
    c.providers.chatgpt.apiKey = 'sk-1'
    expect(rolePreset(c, 'judge')).toBe('chatgpt')
    expect(resolveRoute(c, 'judge')).toMatchObject({ preset: 'chatgpt', apiKey: 'sk-1', model: 'gpt-5.1' })
    c.judge = { preset: 'same', model: 'gpt-5-mini' }
    expect(resolveRoute(c, 'judge').model).toBe('gpt-5-mini')
  })

  it("an empty judge model on another preset uses that preset's default judge", () => {
    const c = settings({ story: { preset: 'ollama', model: 'llama3.1' }, judge: { preset: 'claude', model: '' } })
    expect(resolveRoute(c, 'judge').model).toBe('claude-haiku-4-5')
    expect(routeGap(resolveRoute(c, 'story'))).toBeNull()
  })

  it('reports a missing address or model', () => {
    const c = settings({ story: { preset: 'custom', model: '' } })
    expect(routeGap(resolveRoute(c, 'story'))).toBe('url')
    c.providers.custom.baseUrl = 'http://10.0.0.5:8080/v1'
    expect(routeGap(resolveRoute(c, 'story'))).toBe('model')
  })
})

describe('endpointFor', () => {
  it('gives the OpenAI-compatible client the models the roles use on that preset', () => {
    const c = settings({ story: { preset: 'chatgpt', model: 'gpt-5.1' }, judge: { preset: 'same', model: 'gpt-5-mini' } })
    expect(modelsOnPreset(c, 'chatgpt')).toEqual({ story: 'gpt-5.1', judge: 'gpt-5-mini' })
    expect(endpointFor(c, 'chatgpt')).toMatchObject({
      preset: 'chatgpt',
      baseUrl: 'https://api.openai.com/v1',
      storyModel: 'gpt-5.1',
      judgeModel: 'gpt-5-mini',
    })
    expect(endpointFor(c, 'grok')).toMatchObject({ baseUrl: 'https://api.x.ai/v1', storyModel: '', judgeModel: '' })
  })
})
