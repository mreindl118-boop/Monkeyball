import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CrushDB } from '../db/db'
import { kvGet, kvSet } from '../db/repo'
import type { PlayerProfile, Settings } from '../types'
import { DEFAULT_SETTINGS, DEFAULT_STYLE_PREFIXES } from './defaults'
import { createSettingsStore, effectiveJudgeModel, mergeDeep, mergeSettings } from './settings'

let counter = 0
const open: CrushDB[] = []
function freshDb(): CrushDB {
  const d = new CrushDB(`settings-test-${Date.now()}-${counter++}`)
  open.push(d)
  return d
}

afterEach(async () => {
  while (open.length) {
    const d = open.pop()!
    d.close()
    await d.delete()
  }
})

describe('defaults', () => {
  it('match the spec', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      heat: 2,
      orientationMode: 'realistic',
      showMe: 'everyone',
      hints: false,
      suggestions: true,
      dateLength: 10,
      gainCap: 25,
      activeSets: ['afterhours'],
      hubSort: 'affection',
      hubSetFilter: 'all',
    })
    expect(DEFAULT_SETTINGS.connection).toMatchObject({
      preset: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      storyTemperature: 0.9,
      maxTokens: 600,
      judgeModel: '',
    })
  })

  it('keep safety text out of the editable style prefixes', () => {
    for (const prefix of Object.values(DEFAULT_STYLE_PREFIXES)) {
      expect(prefix).not.toMatch(/adult|minor|child|underage|consent|years old/i)
    }
  })
})

describe('mergeDeep', () => {
  it('fills new fields from defaults and keeps stored values', () => {
    const stored = {
      heat: 4,
      connection: { baseUrl: 'http://pc:1234/v1', apiKey: 'k' },
      image: { stylePrefixes: { anime: 'my anime' } },
    }
    const s = mergeSettings(stored)
    expect(s.heat).toBe(4)
    expect(s.connection.baseUrl).toBe('http://pc:1234/v1')
    expect(s.connection.apiKey).toBe('k')
    expect(s.connection.storyTemperature).toBe(0.9)
    expect(s.image.stylePrefixes.anime).toBe('my anime')
    expect(s.image.stylePrefixes.painterly).toBe(DEFAULT_STYLE_PREFIXES.painterly)
    expect(s.gainCap).toBe(25)
  })

  it('falls back to defaults on wrong types and never shares default objects', () => {
    const s = mergeSettings({ heat: 'hot', connection: 'nope', activeSets: 'afterhours' })
    expect(s.heat).toBe(2)
    expect(s.connection).toEqual(DEFAULT_SETTINGS.connection)
    expect(s.activeSets).toEqual(['afterhours'])
    s.activeSets.push('polycule')
    s.image.stylePrefixes.anime = 'changed'
    expect(DEFAULT_SETTINGS.activeSets).toEqual(['afterhours'])
    expect(DEFAULT_SETTINGS.image.stylePrefixes.anime).not.toBe('changed')
  })

  it('replaces arrays rather than merging them and keeps unknown stored keys', () => {
    expect(mergeDeep({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] })
    expect(mergeDeep({ a: 1 }, { a: 2, extra: true })).toEqual({ a: 2, extra: true })
    expect(mergeDeep({ a: 1 }, null)).toEqual({ a: 1 })
  })
})

describe('useSettings store', () => {
  it('loads defaults on an empty database', async () => {
    const store = createSettingsStore(freshDb())
    expect(store.getState().loaded).toBe(false)
    await store.getState().load()
    const st = store.getState()
    expect(st.loaded).toBe(true)
    expect(st.profile).toBeNull()
    expect(st.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('merges stored settings over defaults on load', async () => {
    const d = freshDb()
    await kvSet('settings', { ageConfirmed: true, heat: 3, connection: { storyModel: 'qwen' } }, d)
    const store = createSettingsStore(d)
    await store.getState().load()
    const { settings } = store.getState()
    expect(settings.ageConfirmed).toBe(true)
    expect(settings.heat).toBe(3)
    expect(settings.connection.storyModel).toBe('qwen')
    expect(settings.connection.baseUrl).toBe('http://localhost:11434/v1')
    expect(settings.image.width).toBe(DEFAULT_SETTINGS.image.width)
  })

  it('persists every mutation to kv', async () => {
    const d = freshDb()
    const store = createSettingsStore(d)
    await store.getState().load()
    await store.getState().update({ heat: 5, ageConfirmed: true })
    await store.getState().updateConnection({ apiKey: 'sk-1', storyModel: 'm' })
    await store.getState().updateImage({ enabled: true, steps: 40 })
    const p: PlayerProfile = {
      name: 'Ari',
      gender: 'custom',
      customGender: 'genderfluid',
      matchAs: 'woman',
      pronouns: 'she/they',
      bodyNotes: 'tall',
      relationshipStyle: 'polyamorous',
    }
    await store.getState().setProfile(p)

    const saved = (await kvGet<Settings>('settings', d))!
    expect(saved.heat).toBe(5)
    expect(saved.ageConfirmed).toBe(true)
    expect(saved.connection.apiKey).toBe('sk-1')
    expect(saved.connection.baseUrl).toBe('http://localhost:11434/v1')
    expect(saved.image.enabled).toBe(true)
    expect(saved.image.steps).toBe(40)
    expect(await kvGet('profile', d)).toEqual(p)

    // A second store on the same database sees it all.
    const again = createSettingsStore(d)
    await again.getState().load()
    expect(again.getState().settings.heat).toBe(5)
    expect(again.getState().profile).toEqual(p)
  })

  it('treats a nameless stored profile as no profile', async () => {
    const d = freshDb()
    await kvSet('profile', { name: '  ', pronouns: 'she/her' }, d)
    const store = createSettingsStore(d)
    await store.getState().load()
    expect(store.getState().profile).toBeNull()
  })

  it('keeps working in memory when storage writes fail', async () => {
    const d = freshDb()
    const store = createSettingsStore(d)
    await store.getState().load()
    vi.spyOn(d.kv, 'put').mockRejectedValue(new Error('QuotaExceededError'))
    await expect(store.getState().update({ ageConfirmed: true })).resolves.toBeUndefined()
    await expect(store.getState().updateConnection({ storyModel: 'm' })).resolves.toBeUndefined()
    const p: PlayerProfile = {
      name: 'Ari',
      gender: 'woman',
      pronouns: 'she/her',
      bodyNotes: '',
      relationshipStyle: 'figuring',
    }
    await expect(store.getState().setProfile(p)).resolves.toBeUndefined()
    const st = store.getState()
    expect(st.settings.ageConfirmed).toBe(true)
    expect(st.settings.connection.storyModel).toBe('m')
    expect(st.profile).toEqual(p)
    expect(st.error).toMatch(/Quota/)
  })

  it('loads defaults and records the error when storage is unavailable', async () => {
    const d = freshDb()
    vi.spyOn(d.kv, 'get').mockRejectedValue(new Error('MissingAPIError'))
    const store = createSettingsStore(d)
    await store.getState().load()
    expect(store.getState().loaded).toBe(true)
    expect(store.getState().error).toMatch(/MissingAPI/)
    expect(store.getState().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('resets in memory', async () => {
    const store = createSettingsStore(freshDb())
    await store.getState().load()
    await store.getState().update({ ageConfirmed: true })
    store.getState().resetInMemory()
    expect(store.getState().settings.ageConfirmed).toBe(false)
  })
})

describe('effectiveJudgeModel', () => {
  it('falls back to the story model', () => {
    const conn = { ...DEFAULT_SETTINGS.connection, storyModel: 'big' }
    expect(effectiveJudgeModel(conn)).toBe('big')
    expect(effectiveJudgeModel({ ...conn, judgeModel: 'small' })).toBe('small')
  })
})
