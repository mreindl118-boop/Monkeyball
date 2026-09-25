#!/usr/bin/env node
// Mock OpenAI-compatible server for dev and e2e. No dependencies.
//
//   node scripts/mock-llm.mjs            (PORT=11435 by default)
//
// Routes (with or without the /v1 prefix): GET /v1/models, POST /v1/chat/completions (SSE when
// stream is true, JSON otherwise), OPTIONS for CORS preflight.
//
// Image routes (Phase 5 art providers):
//   POST /sdapi/v1/txt2img           Automatic1111/Forge: { images: [base64 PNG], parameters, info }
//                                    with info.seed (a random seed for -1); 422 when the request
//                                    lacks crushLAB's safety text (an age in the prompt, the
//                                    underage terms in negative_prompt)
//   GET  /sdapi/v1/samplers          [{ name, aliases, options }]
//   GET  /sdapi/v1/sd-models         [{ title, model_name }]
//   POST /v1/images/generations      Grok Imagine: { data: [{ b64_json }] } (b64_json requested),
//                                    422 without the consenting-adult clause in the prompt
//   GET  /v1/image-generation-models { models: [{ id }] }
// The pictures are 160x240 solid PNGs whose color follows the seed (A1111), or the prompt and a
// running count (Grok: every picture differs, like a real regenerate).
//   GET    /__mock/requests          { requests: { "POST /sdapi/v1/txt2img": 2, ... } } counted by
//                                    method and path (no /v1 prefix, no preflights); DELETE resets
//
// It recognises the prompt kind by the system prompt's first line and answers deterministically:
//   story        "You are the story engine ..."
//   judge        "You score one message ..."      keywords in "Player's new message:" force results
//   agreement    "The player and ..."        accepts the requested type; "[decline]", "[counter]" and
//                                                "[silent]" in the talk decline, counter or leave it open
//   suggestions  "Suggest three things ..."
//   memory       "Summarize this date ..."
//   (no system prompt) a plain reply, "ok"
//
// Env toggles:
//   PORT=11435                 listen port (0 picks a free one)
//   HOST=                      listen host (default: all interfaces)
//   MOCK_DELAY=15              ms between streamed tokens
//   MOCK_OPENING_DELAY=        ms between streamed tokens of an opening beat (a story prompt on
//                              turn 0), so e2e screenshots can catch a reply mid-stream
//   MOCK_REJECT_JSON_MODE=1    400 when response_format is present
//   MOCK_REQUIRE_KEY=secret    401 unless "Authorization: Bearer secret"
//   MOCK_BAD_JSON=1            judge answers with prose first, valid JSON on the nudge retry
//   MOCK_NO_CORS=1             omit CORS headers (to exercise the CORS diagnosis)
//   MOCK_MODELS=a,b            model ids to list (default mock-story,mock-judge)
//   MOCK_STRICT_MODELS=1       404 for models not in the list
//   MOCK_QUIET=1               no request logging
//   MOCK_IMAGE_FAIL=1          image calls fail: txt2img 500 (out of GPU memory), Grok 400
//                              (content moderation); =429 answers 429 on both instead
//   MOCK_IMAGE_DELAY=0         ms before an image answer (to catch the "painting" state)
//   MOCK_NO_SDAPI=1            404 {"detail":"Not Found"} on /sdapi (a server launched without --api)

import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'

const NUDGE_RE = /valid JSON only/i

/** Read options from an env-like object. */
export function optionsFromEnv(env = process.env) {
  return {
    delay: env.MOCK_DELAY !== undefined && env.MOCK_DELAY !== '' ? Number(env.MOCK_DELAY) : 15,
    openingDelay: env.MOCK_OPENING_DELAY !== undefined && env.MOCK_OPENING_DELAY !== '' ? Number(env.MOCK_OPENING_DELAY) : null,
    rejectJsonMode: env.MOCK_REJECT_JSON_MODE === '1',
    requireKey: env.MOCK_REQUIRE_KEY || '',
    badJson: env.MOCK_BAD_JSON === '1',
    noCors: env.MOCK_NO_CORS === '1',
    models: (env.MOCK_MODELS || 'mock-story,mock-judge')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    strictModels: env.MOCK_STRICT_MODELS === '1',
    quiet: env.MOCK_QUIET === '1',
    imageFail: env.MOCK_IMAGE_FAIL === '1' || env.MOCK_IMAGE_FAIL === '429' ? env.MOCK_IMAGE_FAIL : '',
    imageDelay: env.MOCK_IMAGE_DELAY !== undefined && env.MOCK_IMAGE_DELAY !== '' ? Number(env.MOCK_IMAGE_DELAY) : 0,
    noSdapi: env.MOCK_NO_SDAPI === '1',
  }
}

// ---------------------------------------------------------------------------
// Images

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** A small solid-color RGB PNG (a real, decodable file). */
export function makePng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** A color from a number: the same seed always paints the same picture. */
function colorFor(n) {
  const x = (Number(n) >>> 0) || 1
  return [60 + (x % 160), 40 + ((x >>> 8) % 140), 80 + ((x >>> 16) % 150)]
}

function hashText(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Painted pictures are portrait, 2:3, like character art (solid color, so still a few hundred bytes). */
export const MOCK_IMAGE_SIZE = [160, 240]

const SAMPLERS = ['DPM++ 2M', 'DPM++ 2M SDE', 'DPM++ SDE', 'Euler a', 'Euler', 'DDIM', 'UniPC', 'LCM']
const IMAGE_MODELS = ['grok-imagine-image']

// ---------------------------------------------------------------------------
// Prompt kind and parsing helpers

export function detectKind(messages) {
  const system = messages.find((m) => m.role === 'system')
  if (!system) return 'plain'
  const first = String(system.content).split('\n')[0].trim()
  if (first.startsWith('You score one message')) return 'judge'
  if (first.startsWith('The player and')) return 'agreement'
  if (first.startsWith('Suggest three things')) return 'suggestions'
  if (first.startsWith('Summarize this date')) return 'memory'
  if (first.startsWith('You are the story engine') || /You play .+? and narrate/.test(first)) return 'story'
  return 'plain'
}

function lineAfter(text, label) {
  const i = text.indexOf(label)
  if (i < 0) return ''
  return text.slice(i + label.length).split('\n')[0].trim()
}

function firstName(full) {
  return String(full || 'They').trim().split(/\s+/)[0]
}

function isRetry(messages) {
  const last = messages[messages.length - 1]
  return !!last && last.role === 'user' && NUDGE_RE.test(String(last.content))
}

function traitIds(system, label) {
  // "Turn-offs: pushy: Pushiness; negging: Backhanded compliments"
  const line = lineAfter(system, `\n${label}: `)
  return line
    .split(';')
    .map((s) => s.trim().split(':')[0].trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Replies

export function judgeReply(system) {
  const message = lineAfter(system, "Player's new message:")
  const m = message.toLowerCase()
  const nameLine = lineAfter(system, 'CHARACTER\n')
  const name = firstName(nameLine.split(',')[0])
  const base = { delta: 2, trustDelta: 1, hits: [], mood: 'relaxed', hint: 'An easy smile.', jealousy: false, breach: false }
  if (m.includes('[lie]')) {
    return { ...base, delta: -15, trustDelta: -9, mood: 'betrayed', hint: `${name} goes very still.`, breach: true }
  }
  if (m.includes('[tank]')) {
    return { ...base, delta: -20, trustDelta: -5, mood: 'done', hint: 'The temperature drops ten degrees.' }
  }
  if (m.includes('misgender')) {
    const offs = traitIds(system, 'Turn-offs')
    const id = offs.find((x) => /misgender|deadnam/.test(x)) || 'misgendering'
    return { ...base, delta: -10, trustDelta: -6, hits: [{ type: 'turnOff', id }], mood: 'hurt', hint: 'A flat, tired look.' }
  }
  if (m.includes('pushy') || m.includes('now or never')) {
    return { ...base, delta: -9, trustDelta: -2, hits: [{ type: 'turnOff', id: 'pushy' }], mood: 'annoyed', hint: 'Arms fold. A step back.' }
  }
  if (m.includes('cute')) {
    return { ...base, delta: -8, trustDelta: 0, hits: [{ type: 'turnOff', id: 'cute' }], mood: 'unimpressed', hint: 'An eye roll, barely hidden.' }
  }
  if (m.includes('banter')) {
    return { ...base, delta: 6, trustDelta: 1, hits: [{ type: 'turnOn', id: 'banter' }], mood: 'delighted', hint: 'A real laugh, caught off guard.' }
  }
  if (m.includes('vinyl')) {
    return { ...base, delta: 3, trustDelta: 1, hits: [{ type: 'like', id: 'vinyl' }], mood: 'interested', hint: 'Leans in a little.' }
  }
  return base
}

/** What someone of this style settles on when they counter: monogamous -> exclusive, and so on. */
const STYLE_AGREEMENT = { monogamous: 'exclusive', open: 'open', polyamorous: 'poly', flexible: 'casual' }

/**
 * The Agreement prompt: accepts the requested type ("The player asked for: exclusive (...)"), with
 * the character's name in the terms. Keywords in the player's lines of the talk (the Conversation
 * section) steer it for e2e checks: "[decline]" says no (accepted false, trust -2), "[counter]"
 * counters with what their style wants (their relationshipStyle line), "[silent]" leaves the talk
 * unresolved (agreement none, no terms).
 */
export function agreementReply(system) {
  const name = firstName((system.match(/^The player and (.+?) just talked/) || [])[1])
  const asked = lineAfter(system, 'The player asked for:').toLowerCase()
  const requested = (asked.match(/\b(exclusive|open|poly|casual|none)\b/) || [])[1] || 'none'
  const talk = system.includes('Conversation:') ? system.slice(system.indexOf('Conversation:')).split('\nReply with JSON')[0].toLowerCase() : ''
  const style = ((system.match(/ is (monogamous|open|polyamorous|flexible) with /) || [])[1] || '').toLowerCase()
  if (talk.includes('[decline]')) {
    return { agreement: requested, accepted: false, terms: `${name} says: not like this, not yet.`, trustDelta: -2 }
  }
  if (talk.includes('[silent]')) {
    return { agreement: 'none', accepted: false, terms: '', trustDelta: 0 }
  }
  if (talk.includes('[counter]')) {
    const counter = STYLE_AGREEMENT[style] && STYLE_AGREEMENT[style] !== requested ? STYLE_AGREEMENT[style] : requested === 'casual' ? 'open' : 'casual'
    return { agreement: counter, accepted: true, terms: `${name} says: ${counter}, that's what I can do.`, trustDelta: 1 }
  }
  return {
    agreement: requested,
    accepted: requested !== 'none',
    terms: requested === 'none' ? '' : `${name} says: ${requested}, and we tell each other the truth.`,
    trustDelta: 2,
  }
}

const SUGGESTION_LINES = {
  sweet: 'I really like spending time with you.',
  flirty: 'You make it hard to concentrate, you know that?',
  bold: 'Dance with me. Right here, right now.',
  curious: "What's the best night you've ever had in this city?",
  honest: "I'm having a better time than I expected, honestly.",
}

export function suggestionsReply(system) {
  const keys = [...system.matchAll(/"(\w+)": "\.\.\."/g)].map((m) => m[1])
  const use = keys.length ? keys : ['sweet', 'flirty', 'bold']
  const out = {}
  for (const k of use) out[k] = SUGGESTION_LINES[k] || `Something ${k} to say.`
  return out
}

export function memoryReply() {
  return 'We got drinks and talked until the place emptied out, and you remembered the name of the record I mentioned. I liked that, and I think I want to see you again.'
}

export function storyReply(system) {
  const fullName = (system.match(/You play (.+?) and narrate/) || [])[1] || 'Someone'
  const name = firstName(fullName)
  if (/\bwrite\b[^\n]*\bleaving\b/i.test(system)) {
    return `*${name} sets the glass down and stands.* "I think I'm going to call it a night."\n\n*${name} picks up their jacket and heads for the door without looking back.*`
  }
  const turnNote = lineAfter(system, '\nTurn ')
  if (/Open the date/.test(turnNote)) {
    const opener = lineAfter(system, 'Use this line:')
    const line = opener || 'Hey. You made it.'
    return `*${name} spots you across the room and grins.*\n\n"${line.replace(/"/g, "'")}"`
  }
  if (/defin(e|ing) what you two are/.test(turnNote)) {
    return `*${name} goes quiet for a second, then nods.* "Okay. Yeah. I think I want that too."`
  }
  if (/Last turn/.test(turnNote)) {
    return `*${name} checks the time and laughs.* "It's late. Same time next week?"\n\n*${name} doesn't wait for an answer, just smiles.*`
  }
  const mood = lineAfter(system, '\nMood: ').replace(/\..*$/, '').toLowerCase()
  if (/annoyed|unimpressed|hurt|betrayed|done|cold|angry/.test(mood)) {
    return `*${name}'s smile slips.* "Right. Sure."\n\n*${name} looks toward the door for a second too long.*`
  }
  if (/delighted|interested|flirty|warm/.test(mood)) {
    return `*${name} laughs and leans in.* "Okay, that one landed. Keep going."`
  }
  const turn = Number((turnNote.match(/^(\d+)/) || [])[1] || 0)
  const lines = [
    `*${name} leans back against the bar.* "So what's your story, then?"`,
    `*${name} taps a rhythm on the table.* "Not bad. Not bad at all."`,
    `*${name} raises an eyebrow.* "Go on, I'm listening."`,
  ]
  return lines[turn % lines.length]
}

export function replyFor(kind, messages, opts) {
  const system = String(messages.find((m) => m.role === 'system')?.content ?? '')
  switch (kind) {
    case 'judge':
      if (opts.badJson && !isRetry(messages)) {
        return 'Honestly, that message was pretty charming. I would score it as mildly positive overall.'
      }
      return JSON.stringify(judgeReply(system))
    case 'agreement':
      return JSON.stringify(agreementReply(system))
    case 'suggestions':
      return JSON.stringify(suggestionsReply(system))
    case 'memory':
      return memoryReply()
    case 'story':
      return storyReply(system)
    default:
      return 'ok'
  }
}

/** True for the story call that opens a date (turn 0). */
export function isOpening(kind, messages) {
  if (kind !== 'story') return false
  const system = String(messages.find((m) => m.role === 'system')?.content ?? '')
  return /Open the date/.test(lineAfter(system, '\nTurn '))
}

// ---------------------------------------------------------------------------
// HTTP

function corsHeaders(opts) {
  if (opts.noCors) return {}
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Title, HTTP-Referer',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
  }
}

function sendJson(res, status, body, opts) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(opts) })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Split into streamable tokens that keep their whitespace ("Hello", " world"). */
function tokens(text) {
  return text.match(/\s*\S+|\s+$/g) || []
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The Automatic1111/Forge API (no key; MOCK_REQUIRE_KEY doesn't apply). */
async function sdapi(req, res, path, url, opts, log) {
  if (opts.noSdapi) {
    log(`${req.method} ${url.pathname} 404 (no --api)`)
    sendJson(res, 404, { detail: 'Not Found' }, opts)
    return
  }
  if (req.method === 'GET' && path === '/sdapi/v1/samplers') {
    log(`GET ${url.pathname} 200`)
    sendJson(res, 200, SAMPLERS.map((name) => ({ name, aliases: [name.toLowerCase().replace(/\W+/g, '_')], options: {} })), opts)
    return
  }
  if (req.method === 'GET' && path === '/sdapi/v1/sd-models') {
    log(`GET ${url.pathname} 200`)
    sendJson(res, 200, [{ title: 'mock-anime.safetensors [0123abcd]', model_name: 'mock-anime', hash: '0123abcd' }], opts)
    return
  }
  if (req.method === 'POST' && path === '/sdapi/v1/txt2img') {
    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      sendJson(res, 422, { detail: 'Request body is not valid JSON' }, opts)
      return
    }
    if (opts.imageDelay > 0) await sleep(opts.imageDelay)
    if (opts.imageFail === '429') {
      log(`POST ${url.pathname} 429`)
      sendJson(res, 429, { detail: 'Too many requests (mock)' }, opts)
      return
    }
    if (opts.imageFail) {
      log(`POST ${url.pathname} 500 (out of memory)`)
      sendJson(res, 500, { error: 'OutOfMemoryError', detail: '', body: '', errors: 'CUDA out of memory. Tried to allocate 2.00 GiB (mock)' }, opts)
      return
    }
    const prompt = String(body.prompt ?? '')
    const negative = String(body.negative_prompt ?? '')
    if (!/\b\d{2,3} years old\b/.test(prompt) || !/underage/i.test(negative) || !/non-consensual/i.test(negative)) {
      log(`POST ${url.pathname} 422 (no safety text)`)
      sendJson(res, 422, { detail: "mock: the request is missing crushLAB's safety text" }, opts)
      return
    }
    if (body.sampler_name && !SAMPLERS.includes(String(body.sampler_name))) {
      sendJson(res, 404, { detail: `Sampler not found: ${body.sampler_name}` }, opts)
      return
    }
    const asked = Number(body.seed)
    const seed = Number.isFinite(asked) && asked >= 0 ? asked >>> 0 : Math.floor(Math.random() * 0xffffffff)
    const png = makePng(MOCK_IMAGE_SIZE[0], MOCK_IMAGE_SIZE[1], colorFor(seed))
    log(`POST ${url.pathname} seed ${seed} 200`)
    sendJson(
      res,
      200,
      {
        images: [png.toString('base64')],
        parameters: body,
        info: JSON.stringify({ prompt, negative_prompt: negative, seed, all_seeds: [seed], width: body.width, height: body.height }),
      },
      opts,
    )
    return
  }
  log(`${req.method} ${url.pathname} 404`)
  sendJson(res, 404, { detail: 'Not Found' }, opts)
}

export function createMockServer(options = {}) {
  const opts = { ...optionsFromEnv({}), ...options }
  let counter = 0
  /** Grok Imagine pictures painted so far: each one gets its own color, like a new picture would. */
  let grokImages = 0
  /** Requests by "METHOD /path" (the /v1 prefix dropped; preflights and /__mock left out). */
  const counts = new Map()
  const log = (...args) => {
    if (!opts.quiet) console.log(...args)
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://mock')
    const path = url.pathname.replace(/^\/v1(?=\/)/, '')
    try {
      // For e2e scripts: how many requests each route got (GET), or start counting again (DELETE).
      if (path === '/__mock/requests') {
        if (req.method === 'DELETE') counts.clear()
        sendJson(res, 200, { requests: Object.fromEntries(counts) }, opts)
        return
      }
      if (req.method !== 'OPTIONS') {
        const k = `${req.method} ${path}`
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(opts))
        res.end()
        return
      }
      if (path.startsWith('/sdapi/')) {
        await sdapi(req, res, path, url, opts, log)
        return
      }
      if (opts.requireKey && req.headers.authorization !== `Bearer ${opts.requireKey}`) {
        log(`${req.method} ${url.pathname} 401`)
        sendJson(res, 401, { error: { message: 'Invalid API key', type: 'invalid_request_error', code: 401 } }, opts)
        return
      }
      if (req.method === 'GET' && path === '/image-generation-models') {
        log(`GET ${url.pathname} 200`)
        sendJson(res, 200, { models: IMAGE_MODELS.map((id) => ({ id, object: 'image_generation_model', owned_by: 'mock' })) }, opts)
        return
      }
      if (req.method === 'POST' && path === '/images/generations') {
        let body
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { error: { message: 'Request body is not valid JSON' } }, opts)
          return
        }
        if (opts.imageDelay > 0) await sleep(opts.imageDelay)
        const prompt = String(body.prompt ?? '')
        if (opts.imageFail === '429') {
          log(`POST ${url.pathname} 429`)
          sendJson(res, 429, { error: { message: 'Too many requests (mock)' } }, opts)
          return
        }
        if (opts.imageFail) {
          log(`POST ${url.pathname} 400 (moderation)`)
          sendJson(res, 400, { code: 'invalid_request', error: 'Generated image rejected by content moderation. (mock)' }, opts)
          return
        }
        if (!/nothing non-consensual is shown/i.test(prompt) || !/\b\d{2,3} years old\b/.test(prompt)) {
          log(`POST ${url.pathname} 422 (no safety text)`)
          sendJson(res, 422, { error: { message: "mock: the prompt is missing crushLAB's safety text" } }, opts)
          return
        }
        if (body.response_format !== 'b64_json') {
          sendJson(res, 400, { error: { message: 'mock: ask for response_format b64_json' } }, opts)
          return
        }
        const png = makePng(MOCK_IMAGE_SIZE[0], MOCK_IMAGE_SIZE[1], colorFor(hashText(prompt) + ++grokImages * 0x9e3779b1))
        log(`POST ${url.pathname} ${body.model} ${body.aspect_ratio ?? ''} 200`)
        sendJson(res, 200, { data: [{ b64_json: png.toString('base64'), revised_prompt: prompt }] }, opts)
        return
      }
      if (req.method === 'GET' && path === '/models') {
        log(`GET ${url.pathname} 200`)
        sendJson(res, 200, { object: 'list', data: opts.models.map((id) => ({ id, object: 'model', owned_by: 'mock' })) }, opts)
        return
      }
      if (req.method === 'POST' && path === '/chat/completions') {
        const raw = await readBody(req)
        let body
        try {
          body = JSON.parse(raw)
        } catch {
          sendJson(res, 400, { error: { message: 'Request body is not valid JSON' } }, opts)
          return
        }
        const messages = Array.isArray(body.messages) ? body.messages : []
        const kind = detectKind(messages)
        const model = String(body.model || opts.models[0] || 'mock')
        if (opts.rejectJsonMode && body.response_format) {
          log(`POST ${url.pathname} ${kind} 400 (response_format)`)
          sendJson(res, 400, { error: { message: 'response_format is not supported' } }, opts)
          return
        }
        if (opts.strictModels && !opts.models.includes(model)) {
          log(`POST ${url.pathname} ${kind} 404 (model ${model})`)
          sendJson(res, 404, { error: { message: `model "${model}" not found` } }, opts)
          return
        }
        let text = replyFor(kind, messages, opts)
        const maxTokens = Number(body.max_tokens) || 0
        let finish = 'stop'
        const toks = tokens(text)
        if (maxTokens > 0 && toks.length > maxTokens) {
          text = toks.slice(0, maxTokens).join('')
          finish = 'length'
        }
        const id = `chatcmpl-mock-${++counter}`
        const created = Math.floor(Date.now() / 1000)
        log(`POST ${url.pathname} ${kind}${body.stream ? ' stream' : ''}${body.response_format ? ' json' : ''} 200`)
        if (!body.stream) {
          sendJson(
            res,
            200,
            {
              id,
              object: 'chat.completion',
              created,
              model,
              choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: finish }],
              usage: { prompt_tokens: 0, completion_tokens: tokens(text).length, total_tokens: tokens(text).length },
            },
            opts,
          )
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...corsHeaders(opts),
        })
        const chunk = (delta, finishReason = null) =>
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
        res.write(': mock stream\n\n')
        res.write(chunk({ role: 'assistant', content: '' }))
        const delay = opts.openingDelay != null && isOpening(kind, messages) ? opts.openingDelay : opts.delay
        for (const t of tokens(text)) {
          if (res.destroyed) return
          res.write(chunk({ content: t }))
          if (delay > 0) await sleep(delay)
        }
        res.write(chunk({}, finish))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      log(`${req.method} ${url.pathname} 404`)
      sendJson(res, 404, { error: { message: `No route for ${req.method} ${url.pathname}` } }, opts)
    } catch (e) {
      log(`${req.method} ${url.pathname} 500 ${e && e.message}`)
      if (!res.headersSent) sendJson(res, 500, { error: { message: String((e && e.message) || e) } }, opts)
      else res.end()
    }
  })
}

// Run directly: start on PORT.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const opts = optionsFromEnv()
  const port = process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 11435
  const server = createMockServer(opts)
  const onListen = () => {
    const addr = server.address()
    const p = typeof addr === 'object' && addr ? addr.port : port
    console.log(`mock-llm listening on http://localhost:${p}/v1`)
    const flags = Object.entries({
      rejectJsonMode: opts.rejectJsonMode,
      requireKey: !!opts.requireKey,
      badJson: opts.badJson,
      noCors: opts.noCors,
      strictModels: opts.strictModels,
      imageFail: !!opts.imageFail,
      noSdapi: opts.noSdapi,
    })
      .filter(([, v]) => v)
      .map(([k]) => k)
    if (flags.length) console.log(`toggles: ${flags.join(', ')}`)
  }
  if (process.env.HOST) server.listen(port, process.env.HOST, onListen)
  else server.listen(port, onListen)
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
