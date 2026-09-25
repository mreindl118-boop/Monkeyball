// Incremental Server-Sent Events parser. Feed it decoded text chunks as they arrive; it returns
// complete events. Handles lines split across chunks, CRLF / CR / LF line endings, comment lines
// (": keep-alive"), multi-line data fields, and a final event with no trailing blank line.

export interface SseEvent {
  /** The `event:` field, when present. */
  event?: string
  /** The `id:` field, when present. */
  id?: string
  /** All `data:` lines of the event joined with "\n". */
  data: string
}

export interface SseParser {
  /** Feed a decoded chunk; returns the events it completed. */
  feed: (chunk: string) => SseEvent[]
  /** Call once the stream ends; returns any event still pending. */
  end: () => SseEvent[]
}

export function createSseParser(): SseParser {
  let buffer = ''
  let data: string[] = []
  let event: string | undefined
  let id: string | undefined
  // A chunk that ended in "\r" might be the first half of "\r\n".
  let pendingCr = false

  function dispatch(out: SseEvent[]) {
    if (data.length > 0) {
      const e: SseEvent = { data: data.join('\n') }
      if (event !== undefined) e.event = event
      if (id !== undefined) e.id = id
      out.push(e)
    }
    data = []
    event = undefined
    id = undefined
  }

  function line(text: string, out: SseEvent[]) {
    if (text === '') {
      dispatch(out)
      return
    }
    if (text.startsWith(':')) return // comment / keep-alive
    const colon = text.indexOf(':')
    const field = colon < 0 ? text : text.slice(0, colon)
    let value = colon < 0 ? '' : text.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'data':
        data.push(value)
        break
      case 'event':
        event = value
        break
      case 'id':
        id = value
        break
      default:
        break // retry and unknown fields are ignored
    }
  }

  function feed(chunk: string): SseEvent[] {
    const out: SseEvent[] = []
    let text = chunk
    if (pendingCr) {
      pendingCr = false
      if (text.startsWith('\n')) text = text.slice(1)
    }
    buffer += text
    let start = 0
    for (let i = 0; i < buffer.length; i++) {
      const c = buffer[i]
      if (c !== '\n' && c !== '\r') continue
      line(buffer.slice(start, i), out)
      if (c === '\r') {
        if (i + 1 < buffer.length) {
          if (buffer[i + 1] === '\n') i++
        } else {
          pendingCr = true
        }
      }
      start = i + 1
    }
    buffer = buffer.slice(start)
    return out
  }

  function end(): SseEvent[] {
    const out: SseEvent[] = []
    if (buffer !== '') {
      line(buffer, out)
      buffer = ''
    }
    dispatch(out)
    return out
  }

  return { feed, end }
}

/** Parse a whole SSE body at once (tests, or a server that buffered the stream). */
export function parseSse(text: string): SseEvent[] {
  const p = createSseParser()
  return [...p.feed(text), ...p.end()]
}
