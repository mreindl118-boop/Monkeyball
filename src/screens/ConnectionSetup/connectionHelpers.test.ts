import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../store/defaults'
import type { ConnectionSettings } from '../../types'
import { hostModeOf, listedModel, localBaseUrl, switchPreset } from './connectionHelpers'

describe('connection host helpers', () => {
  it('detects this device vs a LAN host', () => {
    expect(hostModeOf('http://localhost:11434/v1')).toEqual({ mode: 'device', host: '' })
    expect(hostModeOf('http://127.0.0.1:1234/v1')).toEqual({ mode: 'device', host: '' })
    expect(hostModeOf('http://192.168.1.20:11434/v1')).toEqual({ mode: 'lan', host: '192.168.1.20' })
    expect(hostModeOf('not a url')).toEqual({ mode: 'device', host: '' })
  })

  it('builds base URLs with the preset port', () => {
    expect(localBaseUrl('ollama', 'lan', '192.168.1.20')).toBe('http://192.168.1.20:11434/v1')
    expect(localBaseUrl('lmstudio', 'lan', 'http://10.0.0.5:9999/')).toBe('http://10.0.0.5:1234/v1')
    expect(localBaseUrl('lmstudio', 'device', 'ignored')).toBe('http://localhost:1234/v1')
    expect(localBaseUrl('ollama', 'lan', '')).toBe('http://localhost:11434/v1')
  })
})

describe('switchPreset', () => {
  const base: ConnectionSettings = {
    ...DEFAULT_SETTINGS.connection,
    preset: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-or-secret',
  }
  const apply = (c: ConnectionSettings, id: ConnectionSettings['preset']) => ({ ...c, ...switchPreset(c, id) })

  it("never carries a key to another preset's server", () => {
    const custom = apply(base, 'custom')
    expect(custom.apiKey).toBe('')
    expect(custom.baseUrl).toBe('https://openrouter.ai/api/v1')
    const ollama = apply(base, 'ollama')
    expect(ollama).toMatchObject({ preset: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '' })
  })

  it('restores each preset\'s own URL and key when switching back', () => {
    const lan = { ...apply(base, 'ollama'), baseUrl: 'http://192.168.1.20:11434/v1' }
    const back = apply(lan, 'openrouter')
    expect(back).toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-secret' })
    expect(apply(back, 'ollama')).toMatchObject({ baseUrl: 'http://192.168.1.20:11434/v1', apiKey: '' })
  })

  it('is a no-op for the current preset', () => {
    expect(switchPreset(base, 'openrouter')).toEqual({})
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
