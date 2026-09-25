// Defensive JSON extraction for model replies: strips reasoning blocks and code fences, then
// takes the first balanced {...} block that parses.

/** Remove <think>...</think> reasoning blocks (and an unterminated one at the end). */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const open = out.search(/<think>/i)
  if (open >= 0) out = out.slice(0, open)
  return out
}

/** Contents of ``` fenced blocks, in order. */
function fencedBlocks(text: string): string[] {
  const out: string[] = []
  const re = /```[^\n`]*\n?([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[1])
  return out
}

/**
 * Starting at `start` (which must be "{"), return the index just past the matching "}",
 * honouring JSON strings and escapes. -1 when unbalanced.
 */
function balancedEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** Every balanced {...} candidate in order of its opening brace (at most `limit`). */
export function jsonCandidates(text: string, limit = 20): string[] {
  const out: string[] = []
  for (let i = text.indexOf('{'); i >= 0 && out.length < limit; i = text.indexOf('{', i + 1)) {
    const end = balancedEnd(text, i)
    if (end > 0) out.push(text.slice(i, end))
  }
  return out
}

function tryParse(candidate: string): Record<string, unknown> | null {
  const attempts = [
    candidate,
    // Common model slips: trailing commas, smart quotes.
    candidate.replace(/,\s*([}\]])/g, '$1'),
    candidate.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1'),
  ]
  for (const a of attempts) {
    try {
      const v: unknown = JSON.parse(a)
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {
      // try the next repair
    }
  }
  return null
}

/**
 * Pull the first JSON object out of a model reply: strips reasoning and ``` fences, takes the
 * first balanced {...} block that parses. Returns null when there is none.
 */
export function extractJson(text: string): Record<string, unknown> | null {
  if (typeof text !== 'string' || text === '') return null
  const clean = stripThinking(text)
  const sources = [...fencedBlocks(clean), clean]
  for (const src of sources) {
    for (const c of jsonCandidates(src)) {
      const v = tryParse(c)
      if (v) return v
    }
  }
  return null
}
