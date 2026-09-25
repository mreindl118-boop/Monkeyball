// End to end against scripts/mock-llm.mjs: real prompt builders -> real client -> mock server.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import novaJson from '../data/sets/afterhours/characters/nova.json'
import {
  buildAgreementPrompt,
  buildJudgePrompt,
  buildMemoryPrompt,
  buildStoryPrompt,
  buildSuggestionsPrompt,
  makeAgreementMessages,
  makeJudgeMessages,
  makeMemoryMessages,
  makeStoryMessages,
  makeSuggestionsMessages,
  suggestionKeys,
  type StoryContext,
} from '../prompts/build'
import { useDebug } from '../store/debug'
import { DEFAULT_CONNECTION } from '../store/defaults'
import type { Character, ConnectionSettings, PlayerProfile, Relationship } from '../types'
import { jsonChat, jsonModeAllowed, judgeJson, resetJsonModeCache, streamChat, type Endpoint } from './client'
import { coerceAgreement, coerceJudge, coerceSuggestions, neutralJudge, noAgreementResult } from './coerce'
import { testEndpoint } from './diagnose'
import * as llm from './index'

interface MockServer {
  listen: (port: number, host: string, cb: () => void) => void
  address: () => { port: number }
  close: (cb?: () => void) => void
}
type CreateMockServer = (options?: Record<string, unknown>) => MockServer

let createMockServer: CreateMockServer
const servers: MockServer[] = []

async function start(options: Record<string, unknown> = {}): Promise<string> {
  const server = createMockServer({ quiet: true, delay: 0, ...options })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}/v1`
}

const nova = novaJson as unknown as Character

const rel: Relationship = {
  characterId: 'nova',
  affection: 10,
  trust: 5,
  discovered: [],
  venues: {},
  gifts: {},
  revealed: { attractions: false, style: false },
  knowsPlayerStyle: false,
  secretsUnlocked: [],
  agreement: { type: 'none', terms: '', madeAt: 0 },
  knownOthers: [],
  memory: [],
  tiersUnlocked: [],
  betrayals: [],
  dates: 0,
  lastDateAt: 0,
  connection: 0,
  heatPushes: 0,
  jealous: false,
}

const profile: PlayerProfile = {
  name: 'Robin',
  gender: 'nonbinary',
  pronouns: 'they/them',
  bodyNotes: '',
  relationshipStyle: 'open',
}

const conn = (baseUrl: string, patch: Partial<Endpoint> = {}): Endpoint => ({
  preset: 'custom',
  baseUrl,
  apiKey: '',
  storyModel: 'mock-story',
  judgeModel: 'mock-judge',
  storyTemperature: 0.9,
  maxTokens: 600,
  ...patch,
})

const storyCtx = (p: Partial<StoryContext> = {}): StoryContext => ({
  character: nova,
  rel,
  profile,
  heat: 2,
  route: 'romantic',
  venue: { name: 'Record store', feeling: 'loves' },
  turn: 0,
  maxTurns: 10,
  firstDate: true,
  names: { kai: 'Kai Okoro' },
  ...p,
})

const judgeFor = (c: Endpoint, message: string) =>
  judgeJson({
    conn: c,
    messages: makeJudgeMessages(
      buildJudgePrompt({ character: nova, rel, route: 'romantic', names: {}, others: [], recent: [], message }),
    ),
    coerce: coerceJudge,
    fallback: neutralJudge(),
    debug: { kind: 'judge', characterId: 'nova' },
  })

beforeAll(async () => {
  const url = new URL('../../scripts/mock-llm.mjs', import.meta.url).href
  const mod = (await import(/* @vite-ignore */ url)) as { createMockServer: CreateMockServer }
  createMockServer = mod.createMockServer
})

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))))
})

beforeEach(() => {
  resetJsonModeCache()
  useDebug.getState().clear()
})

describe('client + prompts against the mock server', () => {
  it('passes Test connection', async () => {
    const base = await start()
    const r = await testEndpoint(conn(base))
    expect(r.ok).toBe(true)
    expect(r.models).toEqual(['mock-story', 'mock-judge'])
  })

  it('plays an opening, a judged turn, suggestions, an agreement and a memory', async () => {
    const c = conn(await start())

    // Turn 0: opening beat, streamed, with the opener line.
    const opening = await streamChat({
      conn: c,
      messages: makeStoryMessages(buildStoryPrompt(storyCtx()), []),
      debug: { kind: 'story', characterId: 'nova' },
    })
    expect(opening).toContain('excellent taste')
    expect(useDebug.getState().lastByKind.story?.prompt).toContain('Robin, nonbinary, they/them.')

    // Judge a turn-off.
    const j = await judgeFor(c, "You're so cute when you do that")
    expect(j.ok).toBe(true)
    expect(j.value).toMatchObject({ delta: -8, hits: [{ type: 'turnOff', id: 'cute' }] })

    // The story reply reflects the judged mood.
    const turns = [
      { role: 'character' as const, text: opening },
      { role: 'player' as const, text: "You're so cute when you do that" },
    ]
    const reply = await streamChat({
      conn: c,
      messages: makeStoryMessages(buildStoryPrompt(storyCtx({ turn: 1, judge: j.value })), turns),
    })
    expect(reply).toMatch(/smile slips/)

    // Suggestions on both routes.
    for (const route of ['romantic', 'friend'] as const) {
      const keys = suggestionKeys(route)
      const s = await jsonChat({
        conn: c,
        messages: makeSuggestionsMessages(
          buildSuggestionsPrompt({ character: nova, rel, route, heat: 2 }),
          turns,
          { characterName: nova.name },
        ),
        coerce: coerceSuggestions(keys),
        fallback: {},
        debug: { kind: 'suggestions' },
      })
      expect(s.ok).toBe(true)
      expect(Object.keys(s.value)).toEqual(keys)
    }

    // Agreement.
    const a = await judgeJson({
      conn: c,
      messages: makeAgreementMessages(
        buildAgreementPrompt({ character: nova, rel, requested: 'exclusive', names: {}, turns }),
      ),
      coerce: coerceAgreement,
      fallback: noAgreementResult(),
      debug: { kind: 'agreement' },
    })
    expect(a.value).toMatchObject({ agreement: 'exclusive', accepted: true })

    // Memory.
    const memory = await streamChat({
      conn: c,
      messages: makeMemoryMessages(buildMemoryPrompt({ character: nova }), turns, { characterName: nova.name }),
      debug: { kind: 'memory' },
    })
    expect(memory.split(/(?<=\.)\s+/)).toHaveLength(2)

    // Early exit.
    const exit = await streamChat({
      conn: c,
      messages: makeStoryMessages(
        buildStoryPrompt(storyCtx({ turn: 4, judge: j.value, special: { kind: 'exit' } })),
        turns,
      ),
    })
    expect(exit).toMatch(/call it a night/)
  })

  it('scores the forced judge keywords', async () => {
    const c = conn(await start())
    expect((await judgeFor(c, "it's now or never")).value.hits).toEqual([{ type: 'turnOff', id: 'pushy' }])
    expect((await judgeFor(c, 'I found that vinyl')).value.delta).toBe(3)
    expect((await judgeFor(c, 'more banter please')).value.delta).toBe(6)
    expect((await judgeFor(c, '[lie] I was home')).value).toMatchObject({ delta: -15, trustDelta: -9, breach: true })
    expect((await judgeFor(c, '[tank]')).value.delta).toBe(-20)
    expect((await judgeFor(c, 'nice night')).value).toMatchObject({ delta: 2, trustDelta: 1 })
  })

  it('falls back from JSON mode when the server rejects response_format', async () => {
    const c = conn(await start({ rejectJsonMode: true }))
    const j = await judgeFor(c, 'vinyl')
    expect(j).toMatchObject({ ok: true, value: { delta: 3 } })
    expect(jsonModeAllowed(c, 'mock-judge')).toBe(false)
  })

  it('recovers from prose with the nudge retry', async () => {
    const c = conn(await start({ badJson: true }))
    const j = await judgeFor(c, 'banter')
    expect(j).toMatchObject({ ok: true, value: { delta: 6 } })
    expect(useDebug.getState().entries.filter((e) => e.kind === 'judge')).toHaveLength(2)
  })

  it('reports a bad key, and passes with the right one', async () => {
    const base = await start({ requireKey: 'secret' })
    expect((await testEndpoint(conn(base))).problem?.kind).toBe('auth')
    expect((await testEndpoint(conn(base, { apiKey: 'secret' }))).ok).toBe(true)
  })

  it('reports an unknown model', async () => {
    const base = await start()
    const r = await testEndpoint(conn(base, { storyModel: 'gpt-nope' }))
    expect(r.problem?.kind).toBe('model')
  })
})

describe('role routing against the mock server', () => {
  it('runs story, judge and suggestions through the role API', async () => {
    const base = await start()
    const settings: ConnectionSettings = structuredClone(DEFAULT_CONNECTION) as ConnectionSettings
    settings.providers.custom = { baseUrl: base, apiKey: '' }
    settings.story = { preset: 'custom', model: 'mock-story' }
    settings.judge = { preset: 'same', model: 'mock-judge' }

    const t = await llm.testConnection(settings, { preset: 'custom' })
    expect(t.ok).toBe(true)

    const opening = await llm.streamChat({
      conn: settings,
      role: 'story',
      messages: makeStoryMessages(buildStoryPrompt(storyCtx()), []),
      debug: { characterId: 'nova' },
    })
    expect(opening).toMatchObject({ refused: false, route: { preset: 'custom', provider: 'openai', model: 'mock-story' } })
    expect(opening.text).toContain('excellent taste')

    const j = await llm.jsonChat({
      conn: settings,
      role: 'judge',
      kind: 'judge',
      messages: makeJudgeMessages(
        buildJudgePrompt({ character: nova, rel, route: 'romantic', names: {}, others: [], recent: [], message: 'vinyl' }),
      ),
      coerce: coerceJudge,
      fallback: neutralJudge(),
    })
    expect(j).toMatchObject({ ok: true, value: { delta: 3 } })
    expect(useDebug.getState().lastByKind.judge?.messages?.length).toBe(2)
  })
})
