import { describe, expect, it } from 'vitest'
import { hostModeOf, localBaseUrl } from './connectionHelpers'

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
