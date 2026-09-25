#!/usr/bin/env node
// Self-check for scripts/mock-llm.mjs: starts mock servers on random ports and hits every route
// and toggle. Run: node scripts/mock-llm.selftest.mjs  (exits 1 on any failure)

import assert from 'node:assert/strict'
import { createMockServer, isOpening, optionsFromEnv } from './mock-llm.mjs'

const STORY_SYSTEM = `You are the story engine of crushLAB, an adults-only dating sim. You play Nova Castellanos and narrate the scene. The player is a consenting adult; address them as "you".

CHARACTER
Nova Castellanos, 28, she/her. Late-night DJ.

SCENE
Venue: Record store. Nova Castellanos loves this place.
No gift this time.
Turn 3 of 10.

HOW THE PLAYER'S LAST MESSAGE LANDED (private; never mention it)
Mood: delighted. It touched a turn-on: Getting out-bantered.
React so it's clear how it landed without explaining why.`

const judgeSystem = (message) => `You score one message in a dating sim. Reply with JSON only.

CHARACTER
Nova Castellanos, stage Stranger (0/100, trust 0/100). Woman, she/her. Teasing and quick.
Likes: vinyl: Vinyl records and liner-note trivia; diner: 3am diner food
Dislikes: phones: Phones out on a date
Turn-ons: banter: Getting out-bantered
Turn-offs: pushy: Pushiness; cute: Being called cute

CONVERSATION
Recent turns: none yet
Player's new message: ${message}`

let failures = 0
let passes = 0
async function check(name, fn) {
  try {
    await fn()
    passes++
    console.log(`ok    ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}\n      ${e && e.message}`)
  }
}

async function start(options = {}) {
  const server = createMockServer({ quiet: true, delay: 1, ...options })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return { server, base: `http://127.0.0.1:${port}/v1` }
}

async function post(base, body, headers = {}) {
  return fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function complete(base, messages, extra = {}) {
  const res = await post(base, { model: 'mock-story', messages, ...extra })
  assert.equal(res.status, 200, `status ${res.status}`)
  const json = await res.json()
  return json.choices[0].message.content
}

async function judge(base, message, extra = {}) {
  return JSON.parse(await complete(base, [{ role: 'system', content: judgeSystem(message) }, { role: 'user', content: 'Score the new message.' }], extra))
}

/** Read an SSE response and return { text, chunks, done }. */
async function readStream(res) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let text = ''
  let chunks = 0
  let done = false
  for (;;) {
    const { value, done: end } = await reader.read()
    if (end) break
    buf += decoder.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, i)
      buf = buf.slice(i + 2)
      for (const line of event.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') {
          done = true
          continue
        }
        chunks++
        text += JSON.parse(data).choices[0].delta.content ?? ''
      }
    }
  }
  return { text, chunks, done }
}

const main = await start()
const { base } = main

await check('GET /v1/models lists models with CORS headers', async () => {
  const res = await fetch(`${base}/models`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  const json = await res.json()
  assert.deepEqual(json.data.map((m) => m.id), ['mock-story', 'mock-judge'])
})

await check('GET /models works without the /v1 prefix', async () => {
  const res = await fetch(base.replace(/\/v1$/, '') + '/models')
  assert.equal(res.status, 200)
})

await check('OPTIONS preflight answers 204 with allowed headers', async () => {
  const res = await fetch(`${base}/chat/completions`, { method: 'OPTIONS' })
  assert.equal(res.status, 204)
  assert.match(res.headers.get('access-control-allow-headers'), /Authorization/)
})

await check('story streams SSE chunks, ends with [DONE]', async () => {
  const res = await post(base, { model: 'mock-story', stream: true, messages: [{ role: 'system', content: STORY_SYSTEM }, { role: 'user', content: 'hi' }] })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/event-stream/)
  const { text, chunks, done } = await readStream(res)
  assert.ok(done, 'no [DONE]')
  assert.ok(chunks > 3, `only ${chunks} chunks`)
  assert.match(text, /\*Nova [^*]+\*/)
  assert.match(text, /"[^"]+"/)
})

await check('story non-stream returns a chat.completion', async () => {
  const text = await complete(base, [{ role: 'system', content: STORY_SYSTEM }, { role: 'user', content: 'hi' }])
  assert.match(text, /Nova/)
})

await check('story turn 0 uses the opener line', async () => {
  const sys = STORY_SYSTEM.replace('Turn 3 of 10.', "Turn 0 of 10. Open the date: Nova Castellanos arrives and greets the player. Use this line: You're either lost or you have excellent taste. Which is it?")
  const text = await complete(base, [{ role: 'system', content: sys }, { role: 'user', content: '(The date begins.)' }])
  assert.match(text, /excellent taste/)
})

await check('MOCK_OPENING_DELAY applies to the opening beat only', async () => {
  assert.equal(optionsFromEnv({}).openingDelay, null)
  assert.equal(optionsFromEnv({ MOCK_OPENING_DELAY: '120' }).openingDelay, 120)
  const opening = STORY_SYSTEM.replace('Turn 3 of 10.', 'Turn 0 of 10. Open the date: Nova Castellanos arrives and greets the player.')
  assert.equal(isOpening('story', [{ role: 'system', content: opening }]), true)
  assert.equal(isOpening('story', [{ role: 'system', content: STORY_SYSTEM }]), false)
  assert.equal(isOpening('judge', [{ role: 'system', content: opening }]), false)
})

await check('story exit note writes the character leaving', async () => {
  const sys = STORY_SYSTEM.replace('Turn 3 of 10.', 'Turn 4 of 10. The date has gone badly: write Nova Castellanos leaving.')
  const text = await complete(base, [{ role: 'system', content: sys }, { role: 'user', content: 'whatever' }])
  assert.match(text, /call it a night|door/)
})

await check('story reacts to a bad mood', async () => {
  const sys = STORY_SYSTEM.replace('Mood: delighted.', 'Mood: annoyed.')
  const text = await complete(base, [{ role: 'system', content: sys }, { role: 'user', content: 'x' }])
  assert.match(text, /smile slips/)
})

const judgeCases = [
  ['you are cute', { delta: -8, hit: ['turnOff', 'cute'] }],
  ["it's now or never", { delta: -9, hit: ['turnOff', 'pushy'] }],
  ['I love vinyl', { delta: 3, hit: ['like', 'vinyl'] }],
  ['banter time', { delta: 6, hit: ['turnOn', 'banter'] }],
  ['[lie] I was home all night', { delta: -15, trustDelta: -9, breach: true }],
  ['misgender test', { delta: -10, trustDelta: -6, hit: ['turnOff', 'misgendering'] }],
  ['[tank]', { delta: -20 }],
  ['nice weather tonight', { delta: 2, trustDelta: 1 }],
]
for (const [message, want] of judgeCases) {
  await check(`judge: "${message}"`, async () => {
    const j = await judge(base, message)
    assert.equal(j.delta, want.delta)
    if (want.trustDelta !== undefined) assert.equal(j.trustDelta, want.trustDelta)
    if (want.breach) assert.equal(j.breach, true)
    if (want.hit) assert.deepEqual(j.hits[0], { type: want.hit[0], id: want.hit[1] })
    else if (!want.breach) assert.deepEqual(j.hits, [])
    for (const k of ['delta', 'trustDelta', 'hits', 'mood', 'hint', 'jealousy', 'breach']) assert.ok(k in j, `missing ${k}`)
  })
}

await check('judge streams too when asked', async () => {
  const res = await post(base, { model: 'mock-judge', stream: true, messages: [{ role: 'system', content: judgeSystem('vinyl') }, { role: 'user', content: 'Score the new message.' }] })
  const { text } = await readStream(res)
  assert.equal(JSON.parse(text).delta, 3)
})

const agreementSystem = (asked, talk, style = 'open') =>
  `The player and Nova Castellanos just talked about what they are to each other. The player asked for: ${asked}. Nova Castellanos is ${style} with low jealousy, trusts the player 40/100, and has these partners: none.\n\nConversation:\n${talk}\n\nReply with JSON only:\n{"agreement": "exclusive|open|poly|casual|none", "accepted": true, "terms": "one sentence in Nova Castellanos's words", "trustDelta": 0}`
const settle = async (sys) => JSON.parse(await complete(base, [{ role: 'system', content: sys }, { role: 'user', content: 'Settle the agreement.' }]))

await check('agreement accepts the requested agreement, by type', async () => {
  for (const [asked, type] of [
    ['exclusive (only each other)', 'exclusive'],
    ['an open relationship', 'open'],
    ['poly (partners known to each other)', 'poly'],
    ['keeping it casual', 'casual'],
  ]) {
    const a = await settle(agreementSystem(asked, 'Player: hi'))
    assert.equal(a.agreement, type)
    assert.equal(a.accepted, true)
    assert.match(a.terms, /^Nova says: /)
    assert.equal(a.trustDelta, 2)
  }
})

await check('agreement: [decline], [counter] and [silent] in the talk', async () => {
  const no = await settle(agreementSystem('exclusive (only each other)', 'Player: [decline] be mine'))
  assert.equal(no.accepted, false)
  assert.equal(no.trustDelta, -2)
  const counter = await settle(agreementSystem('exclusive (only each other)', 'Player: [counter] be mine', 'open'))
  assert.deepEqual([counter.agreement, counter.accepted], ['open', true])
  const mono = await settle(agreementSystem('keeping it casual', 'Player: [counter] whatever', 'monogamous'))
  assert.equal(mono.agreement, 'exclusive')
  const silent = await settle(agreementSystem('poly (partners known)', 'Player: [silent] ...'))
  assert.deepEqual([silent.agreement, silent.accepted, silent.terms], ['none', false, ''])
})

await check('suggestions use romantic keys', async () => {
  const sys = 'Suggest three things the player could say next to Nova: one sweet, one flirty, one bold. Reply with JSON only: {"sweet": "...", "flirty": "...", "bold": "..."}'
  const s = JSON.parse(await complete(base, [{ role: 'system', content: sys }, { role: 'user', content: 'Suggest the three lines.' }]))
  assert.deepEqual(Object.keys(s), ['sweet', 'flirty', 'bold'])
})

await check('suggestions use friend-route keys', async () => {
  const sys = 'Suggest three things the player could say next to Nova: one sweet, one curious, one honest. Reply with JSON only: {"sweet": "...", "curious": "...", "honest": "..."}'
  const s = JSON.parse(await complete(base, [{ role: 'system', content: sys }, { role: 'user', content: 'Suggest the three lines.' }]))
  assert.deepEqual(Object.keys(s), ['sweet', 'curious', 'honest'])
})

await check('memory is two plain sentences', async () => {
  const text = await complete(base, [{ role: 'system', content: "Summarize this date in 2–3 sentences in Nova's voice." }, { role: 'user', content: 'The date: ...' }])
  assert.equal(text.split(/(?<=\.)\s+/).length, 2)
  assert.doesNotMatch(text, /[{}]/)
})

await check('tiny completion honours max_tokens', async () => {
  const text = await complete(base, [{ role: 'user', content: 'Reply with the word ok.' }], { max_tokens: 8 })
  assert.equal(text, 'ok')
})

await check('unknown route is a 404 JSON error', async () => {
  const res = await fetch(`${base}/nope`)
  assert.equal(res.status, 404)
  assert.ok((await res.json()).error.message)
})

main.server.close()

// Toggles
{
  const { server, base: b } = await start({ rejectJsonMode: true })
  await check('MOCK_REJECT_JSON_MODE: 400 with response_format, 200 without', async () => {
    const msgs = [{ role: 'system', content: judgeSystem('hi') }, { role: 'user', content: 'Score the new message.' }]
    const bad = await post(b, { model: 'mock-judge', messages: msgs, response_format: { type: 'json_object' } })
    assert.equal(bad.status, 400)
    assert.match((await bad.json()).error.message, /response_format is not supported/)
    const good = await post(b, { model: 'mock-judge', messages: msgs })
    assert.equal(good.status, 200)
  })
  server.close()
}
{
  const { server, base: b } = await start({ requireKey: 'secret' })
  await check('MOCK_REQUIRE_KEY: 401 without the key, 200 with it', async () => {
    assert.equal((await fetch(`${b}/models`)).status, 401)
    assert.equal((await fetch(`${b}/models`, { headers: { Authorization: 'Bearer wrong' } })).status, 401)
    assert.equal((await fetch(`${b}/models`, { headers: { Authorization: 'Bearer secret' } })).status, 200)
    const res = await post(b, { model: 'mock-story', messages: [{ role: 'user', content: 'x' }] }, { Authorization: 'Bearer secret' })
    assert.equal(res.status, 200)
  })
  server.close()
}
{
  const { server, base: b } = await start({ badJson: true })
  await check('MOCK_BAD_JSON: prose first, valid JSON after the nudge', async () => {
    const msgs = [{ role: 'system', content: judgeSystem('vinyl') }, { role: 'user', content: 'Score the new message.' }]
    const first = await complete(b, msgs)
    assert.doesNotMatch(first, /\{/)
    const second = await complete(b, [...msgs, { role: 'assistant', content: first }, { role: 'user', content: 'Reply with valid JSON only. No prose, no code fences.' }])
    assert.equal(JSON.parse(second).delta, 3)
  })
  server.close()
}
{
  const { server, base: b } = await start({ noCors: true, strictModels: true })
  await check('MOCK_NO_CORS omits CORS headers; MOCK_STRICT_MODELS 404s unknown models', async () => {
    const res = await fetch(`${b}/models`)
    assert.equal(res.headers.get('access-control-allow-origin'), null)
    const r = await post(b, { model: 'nope', messages: [{ role: 'user', content: 'x' }] })
    assert.equal(r.status, 404)
  })
  server.close()
}

{
  const { server, base: b } = await start()
  const origin = b.replace(/\/v1$/, '')
  const SAFE_NEG = 'child, underage, minor, childlike, non-consensual, forced'
  const txt2img = (body) =>
    fetch(`${origin}/sdapi/v1/txt2img`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const grok = (prompt) =>
    fetch(`${b}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' },
      body: JSON.stringify({ model: 'grok-imagine-image', prompt, n: 1, response_format: 'b64_json', aspect_ratio: '2:3' }),
    })
  await check('images: A1111 paints with the safety text (the seed picks the color), 422 without it', async () => {
    const ok = await txt2img({ prompt: 'adult woman, 28 years old, record store', negative_prompt: SAFE_NEG, seed: 7, sampler_name: 'Euler a' })
    assert.equal(ok.status, 200)
    const json = await ok.json()
    assert.equal(Buffer.from(json.images[0], 'base64').subarray(1, 4).toString('ascii'), 'PNG')
    assert.equal(JSON.parse(json.info).seed, 7)
    const again = await (await txt2img({ prompt: 'adult woman, 28 years old, record store', negative_prompt: SAFE_NEG, seed: 7 })).json()
    assert.equal(again.images[0], json.images[0])
    assert.equal((await txt2img({ prompt: 'a woman', negative_prompt: SAFE_NEG, seed: 7 })).status, 422)
    assert.equal((await txt2img({ prompt: 'adult woman, 28 years old', negative_prompt: 'blurry', seed: 7 })).status, 422)
    const samplers = await (await fetch(`${origin}/sdapi/v1/samplers`)).json()
    assert.ok(samplers.some((x) => x.name === 'Euler a'))
  })
  await check('images: Grok Imagine needs the consenting-adult clause; every picture differs', async () => {
    const prompt = 'adult woman, 28 years old, record store. Everyone depicted is a consenting adult; nothing non-consensual is shown.'
    const first = await grok(prompt)
    assert.equal(first.status, 200)
    const a = (await first.json()).data[0].b64_json
    const b2 = (await (await grok(prompt)).json()).data[0].b64_json
    assert.notEqual(a, b2)
    assert.equal((await grok('adult woman, 28 years old, record store')).status, 422)
    const models = await (await fetch(`${b}/image-generation-models`)).json()
    assert.deepEqual(models.models.map((m) => m.id), ['grok-imagine-image'])
  })
  await check('/__mock/requests counts requests by method and path; DELETE starts over', async () => {
    const counted = (await (await fetch(`${origin}/__mock/requests`)).json()).requests
    assert.equal(counted['POST /sdapi/v1/txt2img'], 4)
    assert.equal(counted['POST /images/generations'], 3)
    assert.equal(counted['GET /image-generation-models'], 1)
    assert.equal(counted['GET /__mock/requests'], undefined)
    const cleared = (await (await fetch(`${origin}/__mock/requests`, { method: 'DELETE' })).json()).requests
    assert.deepEqual(cleared, {})
    await fetch(`${b}/models`)
    assert.deepEqual((await (await fetch(`${origin}/__mock/requests`)).json()).requests, { 'GET /models': 1 })
  })
  server.close()
}
{
  const { server, base: b } = await start({ imageFail: '1', noSdapi: false })
  const origin = b.replace(/\/v1$/, '')
  await check('MOCK_IMAGE_FAIL: A1111 out of GPU memory (500), Grok declined by moderation (400)', async () => {
    const r = await fetch(`${origin}/sdapi/v1/txt2img`, { method: 'POST', body: JSON.stringify({ prompt: 'x' }) })
    assert.equal(r.status, 500)
    assert.match(JSON.stringify(await r.json()), /out of memory/)
    const g = await fetch(`${b}/images/generations`, { method: 'POST', body: JSON.stringify({ prompt: 'x', response_format: 'b64_json' }) })
    assert.equal(g.status, 400)
    assert.match(JSON.stringify(await g.json()), /moderation/)
  })
  server.close()
}
{
  const { server, base: b } = await start({ noSdapi: true })
  await check('MOCK_NO_SDAPI: every /sdapi route is a plain 404', async () => {
    const r = await fetch(`${b.replace(/\/v1$/, '')}/sdapi/v1/samplers`)
    assert.equal(r.status, 404)
    assert.deepEqual(await r.json(), { detail: 'Not Found' })
  })
  server.close()
}

console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
