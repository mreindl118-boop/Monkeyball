import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../store/defaults'
import { DEFAULT_SAMPLERS, a1111Host, a1111Url, aspectRatio, grokModel, hasGrokKey, imageProvider, samplerChoices, testImageSettings } from './imageModel'

describe('image settings helpers', () => {
  it('defaults to Automatic1111 for settings saved before Phase 5', () => {
    expect(imageProvider({})).toBe('a1111')
    expect(imageProvider({ provider: 'grok' })).toBe('grok')
    expect(grokModel({ grokModel: '  ' })).toBe('grok-imagine-image')
    expect(aspectRatio({})).toBe('2:3')
  })

  it('builds the A1111 address for this device or a PC on the Wi-Fi', () => {
    expect(a1111Url('device', '')).toBe('http://127.0.0.1:7860')
    expect(a1111Url('lan', '192.168.1.20')).toBe('http://192.168.1.20:7860')
    expect(a1111Url('lan', 'http://192.168.1.20:7861/sdapi')).toBe('http://192.168.1.20:7860')
    expect(a1111Host('http://127.0.0.1:7860')).toEqual({ mode: 'device', host: '' })
    expect(a1111Host('http://192.168.1.20:7860')).toEqual({ mode: 'lan', host: '192.168.1.20' })
  })

  it("offers the server's samplers once known, keeping the saved one", () => {
    expect(samplerChoices('DPM++ 2M', null)).toEqual([...DEFAULT_SAMPLERS])
    expect(samplerChoices('Heun', ['Euler', 'Euler'])).toEqual(['Heun', 'Euler'])
    expect(samplerChoices('Euler', ['Euler', 'DDIM'])).toEqual(['Euler', 'DDIM'])
  })

  it('reuses the Grok key from Connection', () => {
    const s = defaultSettings()
    expect(hasGrokKey(s)).toBe(false)
    s.connection.providers.grok.apiKey = 'xai-123'
    expect(hasGrokKey(s)).toBe(true)
  })

  it('paints the test picture small and quick', () => {
    const img = { ...defaultSettings().image, steps: 40 }
    expect(testImageSettings(img)).toMatchObject({ width: 512, height: 640, steps: 20 })
    expect(testImageSettings({ ...img, steps: 8 }).steps).toBe(8)
  })
})
