import { describe, expect, it } from 'vitest'
import { createSseParser, parseSse } from './sse'

const datas = (events: { data: string }[]) => events.map((e) => e.data)

describe('SSE parser', () => {
  it('parses complete events', () => {
    expect(datas(parseSse('data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n'))).toEqual([
      '{"a":1}',
      '{"a":2}',
      '[DONE]',
    ])
  })

  it('handles events split across chunks at every position', () => {
    const text = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"x":"y"}\n\ndata: [DONE]\n\n'
    for (let cut = 1; cut < text.length; cut++) {
      const p = createSseParser()
      const out = [...p.feed(text.slice(0, cut)), ...p.feed(text.slice(cut)), ...p.end()]
      expect(datas(out), `cut at ${cut}`).toEqual(['{"choices":[{"delta":{"content":"Hi"}}]}', '{"x":"y"}', '[DONE]'])
    }
  })

  it('handles one character at a time', () => {
    const text = 'data: one\r\n\r\ndata: two\n\n'
    const p = createSseParser()
    const out = []
    for (const ch of text) out.push(...p.feed(ch))
    out.push(...p.end())
    expect(datas(out)).toEqual(['one', 'two'])
  })

  it('handles CRLF and lone CR line endings, including CRLF split between chunks', () => {
    expect(datas(parseSse('data: a\r\n\r\ndata: b\r\rdata: c\n\n'))).toEqual(['a', 'b', 'c'])
    const p = createSseParser()
    const out = [...p.feed('data: a\r'), ...p.feed('\n\r'), ...p.feed('\ndata: b\r\n\r\n')]
    expect(datas(out)).toEqual(['a', 'b'])
  })

  it('ignores comments and unknown fields, keeps event and id', () => {
    const out = parseSse(': OPENROUTER PROCESSING\n\nretry: 100\nevent: message\nid: 7\ndata: x\n\n')
    expect(out).toEqual([{ event: 'message', id: '7', data: 'x' }])
  })

  it('joins multi-line data with newlines', () => {
    expect(datas(parseSse('data: line one\ndata: line two\n\n'))).toEqual(['line one\nline two'])
  })

  it('accepts data without a space after the colon', () => {
    expect(datas(parseSse('data:{"a":1}\n\n'))).toEqual(['{"a":1}'])
  })

  it('flushes a final event with no trailing blank line', () => {
    const p = createSseParser()
    expect(p.feed('data: [DONE]')).toEqual([])
    expect(datas(p.end())).toEqual(['[DONE]'])
  })
})
