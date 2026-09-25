import { describe, expect, it } from 'vitest'
import { extractJson, jsonCandidates, stripThinking } from './json'

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"delta": 3, "hits": []}')).toEqual({ delta: 3, hits: [] })
  })

  it('strips code fences', () => {
    expect(extractJson('```json\n{"delta": -4}\n```')).toEqual({ delta: -4 })
    expect(extractJson('Here you go:\n```\n{"a": 1}\n```\nHope that helps')).toEqual({ a: 1 })
  })

  it('takes the first object out of prose', () => {
    expect(extractJson('Sure! The result is {"delta": 2, "mood": "warm"} and that is all.')).toEqual({
      delta: 2,
      mood: 'warm',
    })
  })

  it('handles nested braces', () => {
    const text = 'x {"delta": 5, "hits": [{"type": "turnOn", "id": "banter"}], "meta": {"a": {"b": 1}}} y'
    expect(extractJson(text)).toEqual({
      delta: 5,
      hits: [{ type: 'turnOn', id: 'banter' }],
      meta: { a: { b: 1 } },
    })
  })

  it('handles strings containing braces and escaped quotes', () => {
    const text = '{"hint": "She draws a } in the air {", "quote": "he said \\"{hi}\\"", "n": 1}'
    expect(extractJson(text)).toEqual({ hint: 'She draws a } in the air {', quote: 'he said "{hi}"', n: 1 })
  })

  it('skips a brace block that is not JSON and finds the real one', () => {
    expect(extractJson('I think {this} is fine. {"delta": 1}')).toEqual({ delta: 1 })
  })

  it('repairs trailing commas', () => {
    expect(extractJson('{"a": 1, "b": [1, 2,],}')).toEqual({ a: 1, b: [1, 2] })
  })

  it('ignores reasoning blocks', () => {
    expect(extractJson('<think>maybe {"delta": 99}?</think>\n{"delta": 1}')).toEqual({ delta: 1 })
    expect(stripThinking('<think>abc</think>Hello')).toBe('Hello')
  })

  it('returns null when there is no object', () => {
    expect(extractJson('no json here')).toBeNull()
    expect(extractJson('')).toBeNull()
    expect(extractJson('{"unterminated": ')).toBeNull()
    expect(extractJson('[1, 2, 3]')).toBeNull()
  })

  it('lists candidates in order of their opening brace', () => {
    expect(jsonCandidates('a {"x": {"y": 1}} b {"z": 2}')).toEqual(['{"x": {"y": 1}}', '{"y": 1}', '{"z": 2}'])
  })
})
