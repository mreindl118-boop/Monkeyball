import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE, DEFAULT_STYLE_PREFIXES, defaultSettings, IMAGE_ASPECT_RATIOS } from './defaults'
import { mergeSettings, migrateImage } from './settings'

/** Image settings as Phase 1 stored them (before providers). */
const PHASE_1 = {
  enabled: true,
  baseUrl: 'http://192.168.1.20:7860',
  stylePreset: 'painterly',
  stylePrefixes: { anime: 'my anime', semiReal: 'my semi', painterly: 'my paint' },
  width: 768,
  height: 1152,
  steps: 30,
  cfg: 7,
  sampler: 'Euler a',
  seedMode: 'random',
}

describe('image settings', () => {
  it('new installs: A1111, Grok Imagine ready with its default model and a portrait ratio', () => {
    expect(defaultSettings().image).toMatchObject({ enabled: false, provider: 'a1111', grokModel: 'grok-imagine-image', aspectRatio: '2:3' })
    expect(IMAGE_ASPECT_RATIOS[0]).toBe('2:3')
  })

  it('migrates stored Phase 1 settings: everything kept, A1111 as the provider, the new fields filled in', () => {
    const out = mergeSettings({ image: PHASE_1, heat: 3 })
    expect(out.image).toEqual({ ...PHASE_1, provider: 'a1111', grokModel: 'grok-imagine-image', aspectRatio: '2:3' })
    expect(out.heat).toBe(3)
  })

  it('keeps a valid choice and drops a broken one', () => {
    expect(migrateImage({ provider: 'grok', grokModel: ' grok-imagine-image-pro ', aspectRatio: '9:16' })).toMatchObject({
      provider: 'grok',
      grokModel: 'grok-imagine-image-pro',
      aspectRatio: '9:16',
    })
    const broken = migrateImage({
      provider: 'dalle',
      aspectRatio: '5:7',
      stylePreset: 'cubist',
      seedMode: 'sometimes',
      width: 100_000,
      height: 'tall',
      steps: -3,
      cfg: Number.NaN,
      sampler: '',
      grokModel: 42,
      stylePrefixes: { anime: 7 },
      enabled: 'yes',
    })
    expect(broken).toEqual({
      ...DEFAULT_IMAGE,
      width: 2048,
      steps: 1,
      stylePrefixes: { ...DEFAULT_STYLE_PREFIXES },
    })
  })

  it('keeps sizes on multiples of 8 and a cleared server address empty', () => {
    expect(migrateImage({ width: 833, height: 1219 })).toMatchObject({ width: 832, height: 1216 })
    expect(migrateImage({ baseUrl: '' }).baseUrl).toBe('')
    expect(migrateImage(undefined)).toEqual(DEFAULT_IMAGE)
    expect(migrateImage('junk')).toEqual(DEFAULT_IMAGE)
  })
})
