// The mock model (scripts/mock-llm.mjs) plays a whole group date: its replies carry speaker tags the
// engine parses, "[tank:kai]" makes only Kai walk out, and the exit is written for Kai alone.

import { beforeAll, describe, expect, it } from 'vitest'
import { neutralJudge } from '../llm/coerce'
import type { JudgeResult } from '../types'
import type { DateLlm } from './dateFlow'
import { createGroupDate, openGroupDate, sendGroupMessage } from './groupDate'
import { newGameState } from './relationship'
import { afterhoursWorld, recorder, rel, T0 } from './testKit'

interface Mock {
  storyReply: (system: string) => string
  judgeReply: (system: string) => Partial<JudgeResult>
}
let mock: Mock

beforeAll(async () => {
  const url = new URL('../../scripts/mock-llm.mjs', import.meta.url).href
  mock = (await import(/* @vite-ignore */ url)) as Mock
})

function mockLlm() {
  const stories: string[] = []
  const llm: DateLlm = {
    async story(a) {
      const text = mock.storyReply(a.system)
      stories.push(text)
      a.onDelta(text)
      return { text, refused: false }
    },
    async judge(a) {
      return { value: { ...neutralJudge(), ...mock.judgeReply(a.system) }, ok: true }
    },
    async suggestions() {
      return null
    },
    async memory() {
      return 'A night out.'
    },
  }
  return { llm, stories }
}

describe('the mock model on a group date', () => {
  it('voices both, and writes only the one who walks out leaving', async () => {
    const rels = { nova: rel('nova'), kai: rel('kai') }
    const game = newGameState(T0 - 1_000_000)
    const worlds = ['nova', 'kai'].map((id) => afterhoursWorld({ id, rels, game }))
    const { llm, stories } = mockLlm()
    let s = createGroupDate(worlds, { venueId: 'arcade', maxTurns: 10 })
    s = await openGroupDate(s, llm, recorder().hooks)
    expect(s.record.turns.map((t) => t.speaker)).toEqual(['nova', 'kai'])
    expect(s.record.turns[0].text).toContain('You made it.')

    s = await sendGroupMessage(s, '[tank:kai]', llm, recorder().hooks)
    s = await sendGroupMessage(s, '[tank:kai] again', llm, recorder().hooks)
    expect(stories[stories.length - 1]).toMatch(/^Kai: \*Kai stands/m)
    expect(stories[stories.length - 1]).toMatch(/^Nova: /m)
    expect(s.group!.gone).toEqual(['kai'])
    expect(s.status).toBe('awaiting-player')
    s = await sendGroupMessage(s, 'Just us.', llm, recorder().hooks)
    const last = s.record.turns.filter((t) => t.role === 'character').slice(-1)[0]
    expect(last.speaker).toBe('nova')
    expect(stories[stories.length - 1]).not.toMatch(/^Kai:/m)
  })
})
