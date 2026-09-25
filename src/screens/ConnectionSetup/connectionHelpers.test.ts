import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../store/defaults'
import type { ConnectionSettings } from '../../types'
import {
  afterTestPatch,
  bothRolesPatch,
  hostModeOf,
  judgePresetPatch,
  listedModel,
  localBaseUrl,
  slotUsable,
  storyPresetPatch,
} from './connectionHelpers'

const fresh = (): ConnectionSettings => structuredClone(DEFAULT_SETTINGS.connection) as ConnectionSettings

describe('connection host helpers', () => {
  it('detects this device vs a LAN host', () => {
    expect(hostModeOf('http://localhost:11434/v1')).toEqual({ mode: 'device', host: '' })
    expect(hostModeOf('http://127.0.0.1:1234/v1')).toEqual({ mode: 'device', host: '' })
    expect(hostModeOf('http://192.168.1.20:11434/v1')).toEqual({ mode: 'lan', host: '192.168.1.20' })
    expect(hostModeOf('not a url')).toEqual({ mode: 'device', host: '' })
  })

  it('builds base URLs with the preset port and /v1', () => {
    expect(localBaseUrl('ollama', 'lan', '192.168.1.20')).toBe('http://192.168.1.20:11434/v1')
    expect(localBaseUrl('lmstudio', 'lan', 'http://10.0.0.5:9999/')).toBe('http://10.0.0.5:1234/v1')
    expect(localBaseUrl('lmstudio', 'device', 'ignored')).toBe('http://127.0.0.1:1234/v1')
    expect(localBaseUrl('ollama', 'lan', '')).toBe('http://127.0.0.1:11434/v1')
  })
})

describe('listedModel', () => {
  it('finds the listed id for a model typed without its tag', () => {
    expect(listedModel(['llama3.1:latest', 'qwen3'], 'llama3.1')).toBe('llama3.1:latest')
    expect(listedModel(['llama3.1:latest'], 'llama3.1:latest')).toBe('llama3.1:latest')
    expect(listedModel(['qwen3'], 'llama3.1')).toBeUndefined()
    expect(listedModel(['qwen3'], '')).toBeUndefined()
  })
})

describe('slotUsable', () => {
  it('needs a key for keyed presets and an address for Custom', () => {
    const c = fresh()
    expect(slotUsable(c, 'claude')).toBe(false)
    expect(slotUsable(c, 'ollama')).toBe(true)
    expect(slotUsable(c, 'custom')).toBe(false)
    c.providers.claude.apiKey = 'sk-ant-1'
    expect(slotUsable(c, 'claude')).toBe(true)
  })
})

describe('afterTestPatch', () => {
  it('moves both roles to a freshly tested provider while the story one has no key', () => {
    const c = fresh()
    c.providers.chatgpt.apiKey = 'sk-1'
    const patch = afterTestPatch(c, 'chatgpt', ['gpt-4o', 'gpt-5', 'gpt-5-mini', 'whisper-1'])
    expect(patch).toEqual({ story: { preset: 'chatgpt', model: 'gpt-5' }, judge: { preset: 'same', model: 'gpt-5-mini' } })
  })

  it('does the same for Grok', () => {
    const c = fresh()
    c.providers.grok.apiKey = 'xai-1'
    expect(afterTestPatch(c, 'grok', ['grok-4', 'grok-4-fast-non-reasoning', 'grok-imagine-image'])).toEqual({
      story: { preset: 'grok', model: 'grok-4' },
      judge: { preset: 'same', model: 'grok-4-fast-non-reasoning' },
    })
  })

  it('leaves working roles alone and only fills empty models', () => {
    const c = fresh()
    c.providers.claude.apiKey = 'sk-ant-1'
    c.providers.chatgpt.apiKey = 'sk-1'
    expect(afterTestPatch(c, 'chatgpt', ['gpt-5', 'gpt-5-mini'])).toBeNull()
    c.judge = { preset: 'chatgpt', model: '' }
    expect(afterTestPatch(c, 'chatgpt', ['gpt-5', 'gpt-5-mini'])).toEqual({ judge: { preset: 'chatgpt', model: 'gpt-5-mini' } })
    c.story = { preset: 'chatgpt', model: '' }
    c.judge = { preset: 'same', model: '' }
    expect(afterTestPatch(c, 'chatgpt', ['gpt-5', 'gpt-5-mini'])).toEqual({
      story: { preset: 'chatgpt', model: 'gpt-5' },
      judge: { preset: 'same', model: 'gpt-5-mini' },
    })
  })

  it('picks the first listed model for a local server', () => {
    const c = fresh()
    c.story = { preset: 'ollama', model: '' }
    c.judge = { preset: 'same', model: '' }
    expect(afterTestPatch(c, 'ollama', ['llama3.1:latest', 'qwen3'])).toEqual({ story: { preset: 'ollama', model: 'llama3.1:latest' } })
  })
})

describe('role patches', () => {
  it('uses one provider for both roles', () => {
    const c = fresh()
    expect(bothRolesPatch(c, 'claude')).toEqual({
      story: { preset: 'claude', model: 'claude-opus-5' },
      judge: { preset: 'same', model: 'claude-haiku-4-5' },
    })
    expect(bothRolesPatch(c, 'ollama', ['qwen3'])).toEqual({ story: { preset: 'ollama', model: 'qwen3' }, judge: { preset: 'same', model: '' } })
  })

  it("a 'same' judge follows the story to its new provider", () => {
    const c = fresh()
    expect(storyPresetPatch(c, 'chatgpt', ['gpt-5', 'gpt-5-mini'])).toEqual({
      story: { preset: 'chatgpt', model: 'gpt-5' },
      judge: { preset: 'same', model: 'gpt-5-mini' },
    })
    c.judge = { preset: 'grok', model: 'grok-4-fast' }
    expect(storyPresetPatch(c, 'ollama')).toEqual({ story: { preset: 'ollama', model: '' } })
    expect(storyPresetPatch(c, 'claude')).toEqual({})
  })

  it('picks a judge model for the judge provider', () => {
    const c = fresh()
    expect(judgePresetPatch(c, 'grok', ['grok-4', 'grok-4-fast-non-reasoning'])).toEqual({
      judge: { preset: 'grok', model: 'grok-4-fast-non-reasoning' },
    })
    expect(judgePresetPatch(c, 'same')).toEqual({})
    c.judge = { preset: 'grok', model: 'grok-4' }
    expect(judgePresetPatch(c, 'same')).toEqual({ judge: { preset: 'same', model: 'claude-haiku-4-5' } })
  })
})
