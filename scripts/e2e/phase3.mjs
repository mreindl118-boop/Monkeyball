#!/usr/bin/env node
// Phase 3 (dating core): date setup, the story engine, the judge, suggestion chips, affection math,
// discovery, the early exit, the recap and memory, as Chrome on an Android phone, then on a desktop.
//
//   npm run e2e:phase3        (builds, then serves dist/ with vite preview; E2E_SKIP_BUILD=1 reuses dist/)
//
// Runs against scripts/mock-llm.mjs (an OpenAI-compatible server that answers by prompt kind and by
// keywords in the player's message: "vinyl" is a like, "cute" a turn-off, "banter" a +6 turn-on,
// "[tank]" a -20). From empty storage, under the Pixel 7 profile (touch, 412x915 at 2.625x):
//   quick onboarding -> connection setup, Other providers, Custom, pointed at the mock -> Nova's
//   profile -> Ask on a date -> the record store (a favorite, +3) and hot sauce (loved, +5) ->
//   the opening beat streams, using her opener (first date) -> a chip fills the input and sends
//   nothing -> a full 10-turn date: a like ("I love digging through vinyl"; the status panel's heat
//   sheet opens and closes), "what's your type" sent with Enter (the composer keeps focus while she
//   replies, so the soft keyboard would stay up; her attractions come up), a turn-off ("you're so cute": affection drops by 8 and the reply
//   reacts), a chip's line and neutral lines; the soft keyboard (emulated) leaves the composer and
//   the latest line in view -> the last turn gets a closing reply -> Recap: +19 affection, +10
//   trust, both traits with their hints, the venue and gift, her memory line -> reload: the recap,
//   the profile (affection, trust, traits with hints, attractions) and the memory (debug State tab)
//   are still there.
//   Second date: "[tank]" until she leaves: the exit reply, "Nova left." with the turn counter on the
//   turn played, and a recap that says she left early and what it cost (the date's running total).
//   Third date, hints on: "banter" (+6 each) again and again stops at +25 net for the date (the
//   hint line reads +6, +6, +6, +6, then +1, 0 and 0 at this date's limit), End date, and the recap
//   shows +25 and tier 1.
//   Then the date screens again at 360x800, and a restart on the hub mid-date, which opens the date
//   screen with the interrupted date's recap on offer.
// Every screen is checked like android.mjs does (no sideways scroll, 48px touch targets, design
// rules). Screenshots: scripts/e2e/out/p3-android-*.png, p3-360-*.png and p3-desktop-*.png.

import {
  check,
  checkDesign,
  checkIncludes,
  checkTouchScreen,
  dismissToasts,
  goHash,
  launchBrowser,
  log,
  main,
  newPage,
  PIXEL_7,
  press,
  quickOnboard,
  screenshot,
  sleep,
  SMALL_PHONE,
  startApp,
  startMock,
  step,
  waitForHash,
} from './lib.mjs'

/** What the mock answers (scripts/mock-llm.mjs), so the checks can look for it. */
const MOCK = {
  opener: "You're either lost or you have excellent taste. Which is it?",
  exit: "I think I'm going to call it a night.",
  closing: "It's late. Same time next week?",
  soured: 'Right. Sure.',
  memory: 'We got drinks and talked until the place emptied out',
  chip: 'I really like spending time with you.',
  vinylHint: 'Leans in a little.',
  cuteHint: 'An eye roll, barely hidden.',
  banterHint: 'A real laugh, caught off guard.',
}

const VINYL = 'Vinyl records and liner-note trivia'
const CUTE = 'Being called cute'

/** Lines the mock's judge scores as small talk (+2, trust +1): no keywords, no topics. */
const NEUTRAL = [
  'The lighting in here is great.',
  'How long have you worked nights?',
  'I had noodles for dinner, no regrets.',
  'My week was long, but tonight fixes it.',
  'Do you come here often?',
]

// ---------------------------------------------------------------------------
// Helpers

const dateMain = (page) => page.locator('main[aria-label^="Date with"]')
const composer = (page) => page.getByLabel(/^Your message to/)
const chipGroup = (page) => page.getByRole('group', { name: 'Things you could say' })
const seeHowItWent = (page) => page.getByRole('button', { name: 'See how it went' })

/** Point the app at the mock: connection setup, Other providers, Custom, test, pick both models. */
async function connectToMock(page, mock) {
  await goHash(page, '#/connection-setup')
  await page.getByRole('heading', { name: 'Connect a model' }).waitFor()
  await press(page.getByRole('button', { name: /^Other providers/ }))
  await press(page.getByRole('button', { name: /^Custom/ }))
  await page.locator('#setup-custom-baseurl').fill(mock.baseUrl)
  await press(page.getByRole('button', { name: 'Test connection to Custom' }))
  await page.getByText('The server answered and 2 models are available.').waitFor({ timeout: 20_000 })
  await page.getByRole('group', { name: 'Story model' }).getByLabel('Model').selectOption('mock-story')
  await page.getByRole('group', { name: 'Judge model' }).getByLabel('Model').selectOption('mock-judge')
  await press(page.getByRole('button', { name: 'Continue', exact: true }))
  await waitForHash(page, '#/hub')
  await page.getByText(/^Connected to Custom at 127\.0\.0\.1/).waitFor({ timeout: 15_000 })
}

/**
 * The date is waiting for the player (composer editable, nothing in the status line), or it is
 * over and "See how it went" is ready. While the character talks the composer is read-only (not
 * disabled, so it keeps focus and the soft keyboard).
 */
async function waitIdle(page, timeout = 30_000) {
  await page.waitForFunction(
    () => {
      const root = document.querySelector('main[aria-label^="Date with"]')
      if (!root) return false
      const see = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'See how it went')
      if (see) return !see.disabled && see.getAttribute('aria-busy') !== 'true'
      const ta = root.querySelector('textarea')
      const status = root.querySelector('[class*="statusLine"]')
      return !!ta && !ta.disabled && !ta.readOnly && !!status && status.textContent.trim() === ''
    },
    null,
    { timeout },
  )
}

/** Player bubbles in the transcript. */
const playerBubbles = (page) => dateMain(page).locator('[class*="_you_"]').count()

/** The last thing the character said (the last finished line in the transcript). */
function lastLine(page) {
  return page.evaluate(() => {
    const lines = document.querySelectorAll('main[aria-label^="Date with"] [class*="_line_"]')
    return lines.length ? lines[lines.length - 1].textContent.trim() : ''
  })
}

/** Affection or trust as the meter shows it (aria-valuenow). */
async function meterValue(scope, name) {
  const v = await scope.getByRole('meter', { name }).first().getAttribute('aria-valuenow')
  return Number(v)
}

/** Open or close the date's status panel. */
async function setStatusOpen(page, open) {
  const toggle = dateMain(page).getByRole('button', { name: /^Mood/ })
  if ((await toggle.getAttribute('aria-expanded')) !== String(open)) await press(toggle)
  if (open) await dateMain(page).getByRole('meter', { name: 'Affection' }).waitFor()
}

/** Type a message and send it; waits for the reply (and chips) or for the end of the date. */
async function sendLine(page, text) {
  const before = await playerBubbles(page)
  await composer(page).fill(text)
  await press(dateMain(page).getByRole('button', { name: 'Send', exact: true }))
  await page.waitForFunction(
    (n) => document.querySelectorAll('main[aria-label^="Date with"] [class*="_you_"]').length > n,
    before,
    { timeout: 10_000 },
  )
  await waitIdle(page)
}

/** From Nova's profile to a date at `venue` with `gift` (or none): waits for the opening beat. */
async function startDate(page, venue, gift) {
  await goHash(page, '#/profile/nova')
  await press(page.getByRole('button', { name: 'Ask on a date' }))
  await waitForHash(page, '#/date-setup/nova')
  await page.getByRole('radio', { name: new RegExp(`^${venue}`) }).check({ force: true })
  if (gift) await page.getByRole('radio', { name: new RegExp(`^${gift}`) }).check({ force: true })
  await press(page.getByRole('button', { name: 'Start the date' }))
  await waitForHash(page, '#/date')
  await dateMain(page).waitFor()
}

/** Tap "See how it went" and wait for the recap. */
async function toRecap(page) {
  await waitIdle(page)
  await press(seeHowItWent(page))
  await page.waitForFunction(() => location.hash.startsWith('#/recap/'), null, { timeout: 20_000 })
  await page.getByRole('heading', { name: 'Where you stand' }).waitFor()
}

/** End date through its confirm dialog, then wait for the recap. */
async function endDate(page) {
  await press(dateMain(page).getByRole('button', { name: 'End date', exact: true }))
  const dialog = page.getByRole('alertdialog', { name: 'End the date?' })
  await dialog.waitFor()
  await press(dialog.getByRole('button', { name: 'End date', exact: true }))
  await page.waitForFunction(() => location.hash.startsWith('#/recap/'), null, { timeout: 20_000 })
  await page.getByRole('heading', { name: 'Where you stand' }).waitFor()
}

/** Text of the whole page's main. */
const mainText = (page) => page.locator('main').first().innerText()

/**
 * The opening beat streams: the caret shows while the text grows. Returns the lengths seen, and
 * saves the screenshot `file` while it is still streaming (the mock streams openings slowly).
 */
async function watchStream(page, file) {
  const caret = dateMain(page).locator('[class*="_caret_"]')
  await caret.first().waitFor({ timeout: 15_000 })
  const sample = () =>
    page.evaluate(() => {
      const c = document.querySelector('main[aria-label^="Date with"] [class*="_caret_"]')
      return c ? (c.closest('[class*="_line_"]')?.textContent ?? '').length : -1
    })
  const lengths = []
  for (let i = 0; i < 60 && lengths.length < 3; i++) {
    const n = await sample()
    if (n < 0) break
    if (lengths[lengths.length - 1] !== n) lengths.push(n)
    await sleep(50)
  }
  if (file) {
    await page.screenshot({ path: file, animations: 'disabled' })
    check((await sample()) >= 0, 'the reply finished before the mid-stream screenshot; raise MOCK_OPENING_DELAY')
  }
  return lengths
}

/** Page errors, leaving out network noise. */
function pageErrors(page) {
  return page.errors.filter(
    (e) => e.kind === 'pageerror' || !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED|CORS policy|net::/.test(e.text),
  )
}

// ---------------------------------------------------------------------------
// Flow, as Chrome on a Pixel 7

async function androidFlow(browser, app, mock) {
  const { context, page } = await newPage(browser, PIXEL_7.viewport, PIXEL_7)
  const shot = (name) => `p3-android-${name}`
  const out = (name) => `scripts/e2e/out/${shot(name)}.png`

  await step('quick onboarding, then Other providers, Custom, pointed at the mock', async () => {
    await quickOnboard(page, app.origin, { name: 'Ana', gender: 'Woman', pronouns: 'she/her' })
    await connectToMock(page, mock)
  }, page)

  await step("Nova's profile, Ask on a date: the setup screen", async () => {
    await press(page.getByRole('button', { name: /^Nova Castellanos, stage Stranger/ }))
    await waitForHash(page, '#/profile/nova')
    check((await meterValue(page, 'Affection')) === 0, 'Nova should start at 0 affection')
    await press(page.getByRole('button', { name: 'Ask on a date' }))
    await waitForHash(page, '#/date-setup/nova')
    await page.getByRole('heading', { name: 'Where to' }).waitFor()
    check((await page.getByRole('radiogroup', { name: 'Where to' }).getByRole('radio').count()) === 14, 'the setup should offer 14 venues')
    await page.getByText('Needs Lover').first().waitFor()
    check(await page.getByRole('button', { name: 'Start the date' }).isDisabled(), 'Start the date is enabled before a venue is picked')
    await checkTouchScreen(page, 'setup', { full: true, shot: shot('setup') })
  }, page)

  await step('pick the record store (a favorite) and hot sauce (loved)', async () => {
    await page.getByRole('radio', { name: /^Record store/ }).check({ force: true })
    await page.getByRole('radio', { name: /^Hot sauce/ }).check({ force: true })
    await page.getByText('The record store with Nova, bringing hot sauce.').waitFor()
    check(await page.getByRole('button', { name: 'Start the date' }).isEnabled(), 'Start the date should be enabled')
    await screenshot(page, shot('setup-picked'))
  }, page)

  await step('the opening beat streams, with her first-date opener', async () => {
    await press(page.getByRole('button', { name: 'Start the date' }))
    await waitForHash(page, '#/date')
    const lengths = await watchStream(page, out('date-streaming'))
    check(lengths.length >= 2 && lengths[lengths.length - 1] > lengths[0], `the opening didn't stream (lengths seen: ${lengths.join(', ')})`)
    log(`     the opening grew through ${lengths.length} lengths while streaming`)
    await waitIdle(page)
    checkIncludes(await lastLine(page), [MOCK.opener], 'the opening beat')
    await page.getByText('Turn 1 of 10').waitFor()
    // Venue +3 and gift +5 were counted before the first message.
    await setStatusOpen(page, true)
    check((await meterValue(dateMain(page), 'Affection')) === 8, `affection after the opening should be 8, is ${await meterValue(dateMain(page), 'Affection')}`)
    await setStatusOpen(page, false)
  }, page)

  await step('suggestion chips fill the input and never send', async () => {
    const chips = chipGroup(page).getByRole('button')
    await chips.first().waitFor()
    check((await chips.count()) === 3, `expected 3 chips, got ${await chips.count()}`)
    const labels = await chips.evaluateAll((els) => els.map((e) => e.textContent))
    checkIncludes(labels.join('\n'), ['Sweet', 'Flirty', 'Bold'], 'chip labels')
    await checkTouchScreen(page, 'date-chips', { shot: shot('date-chips') })
    const bubbles = await playerBubbles(page)
    await press(chips.first())
    check((await composer(page).inputValue()) === MOCK.chip, `the chip filled "${await composer(page).inputValue()}"`)
    await sleep(300)
    check((await playerBubbles(page)) === bubbles, 'tapping a chip sent a message')
    await page.getByText('Turn 1 of 10').waitFor()
    await screenshot(page, shot('date-chip-filled'))
    await composer(page).fill('')
  }, page)

  let affection = 8
  await step('turn 1, a like: "I love digging through vinyl"', async () => {
    await sendLine(page, 'I love digging through vinyl')
    await page.getByText('Turn 2 of 10').waitFor()
    await setStatusOpen(page, true)
    affection = await meterValue(dateMain(page), 'Affection')
    check(affection === 11, `a like should add 3 (11), affection is ${affection}`)
    await dateMain(page).getByText('Interested', { exact: true }).waitFor()
    // Hints are off: the judge's hint and the deltas stay hidden.
    check((await dateMain(page).getByText(MOCK.vinylHint).count()) === 0, "the judge's hint shows with hints off")
    await checkTouchScreen(page, 'date-status', { shot: shot('date-status') })
    // The heat can change mid-date (a declined turn's note suggests it): the hub's heat sheet.
    await press(dateMain(page).getByRole('button', { name: /Change heat$/ }))
    const sheet = page.getByRole('dialog', { name: "Tonight's heat" })
    await sheet.waitFor()
    check(await sheet.getByRole('radio', { name: '2, Flirty' }).isChecked(), 'the heat sheet should show the current heat')
    // The sheet's own controls are the hub's (checked there); the date under its backdrop isn't
    // tappable, so this is a picture only.
    await screenshot(page, shot('date-heat'))
    await press(sheet.getByRole('button', { name: 'Done' }))
    await sheet.waitFor({ state: 'detached' })
    await setStatusOpen(page, false)
  }, page)

  await step("turn 2, sent with the keyboard's send key: the composer keeps focus (and the soft keyboard)", async () => {
    const before = await playerBubbles(page)
    await composer(page).focus()
    await composer(page).fill("So what's your type, honestly?")
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      (n) => document.querySelectorAll('main[aria-label^="Date with"] [class*="_you_"]').length > n,
      before,
      { timeout: 10_000 },
    )
    const focused = () => page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA')
    check(await focused(), 'the composer lost focus when the message went')
    await waitIdle(page)
    check(await focused(), 'the composer lost focus while Nova replied')
    await page.getByText('Turn 3 of 10').waitFor()
    await composer(page).blur()
  }, page)

  await step('turn 3, a turn-off: "you\'re so cute" drops affection and the reply reacts', async () => {
    await setStatusOpen(page, true)
    const before = await meterValue(dateMain(page), 'Affection')
    await sendLine(page, "you're so cute")
    const after = await meterValue(dateMain(page), 'Affection')
    check(after === before - 8, `a turn-off should take 8 (${before} to ${before - 8}), went to ${after}`)
    checkIncludes(await lastLine(page), [MOCK.soured], 'the reply to a turn-off')
    await dateMain(page).getByText('Unimpressed', { exact: true }).waitFor()
    await screenshot(page, shot('date-turnoff'))
    await setStatusOpen(page, false)
  }, page)

  await step("turn 4: a chip's line, sent", async () => {
    await press(chipGroup(page).getByRole('button').first())
    await sendLine(page, await composer(page).inputValue())
    await page.getByText('Turn 5 of 10').waitFor()
  }, page)

  await step('the soft keyboard (emulated) keeps the composer and the latest line in view', async () => {
    await composer(page).focus()
    await page.evaluate(() => {
      document.documentElement.dataset.keyboard = 'open'
    })
    // A Pixel 7 keyboard takes about 350px; the viewport meta asks for resizes-content.
    await page.setViewportSize({ width: 412, height: 560 })
    const measure = () =>
      page.evaluate(() => {
        const root = document.querySelector('main[aria-label^="Date with"]')
        const rect = (el) => {
          const b = el.getBoundingClientRect()
          return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }
        }
        const lines = root.querySelectorAll('[class*="_line_"]')
        const send = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Send')
        const scroller = root.querySelector('[class*="transcript"]')
        return {
          vh: window.innerHeight,
          input: rect(root.querySelector('textarea')),
          send: rect(send),
          transcript: rect(scroller),
          scroll: { top: Math.round(scroller.scrollTop), height: scroller.scrollHeight, client: scroller.clientHeight },
          last: rect(lines[lines.length - 1]),
          portrait: getComputedStyle(root.querySelector('[class*="stageArea"]')).display,
        }
      })
    // The layout settles over a frame or two (the portrait steps aside, the box grows, the
    // transcript sticks to its end).
    const settled = (m) =>
      m.input.bottom <= m.vh && m.input.top >= 0 && m.last.bottom > m.transcript.top && m.last.top < m.transcript.bottom
    let r = await measure()
    for (let i = 0; i < 20 && !settled(r); i++) {
      await sleep(100)
      r = await measure()
    }
    const where = JSON.stringify(r)
    check(r.input.bottom <= r.vh && r.input.top >= 0, `the composer is off screen with the keyboard up: ${where}`)
    check(r.send.bottom <= r.vh, `Send is under the keyboard: ${where}`)
    check(r.last.bottom > r.transcript.top && r.last.top < r.transcript.bottom, `the latest line is scrolled out of view: ${where}`)
    check(r.portrait === 'none', 'the portrait should step aside while typing')
    check(r.transcript.height >= 120, `the transcript is only ${r.transcript.height}px tall with the keyboard up`)
    await screenshot(page, shot('date-keyboard'))
    await page.evaluate(() => {
      delete document.documentElement.dataset.keyboard
    })
    await page.setViewportSize(PIXEL_7.viewport)
    await composer(page).blur()
  }, page)

  await step('turns 5 to 9: small talk', async () => {
    for (let i = 0; i < NEUTRAL.length; i++) {
      await sendLine(page, NEUTRAL[i])
      await page.getByText(`Turn ${6 + i} of 10`).waitFor()
    }
    await setStatusOpen(page, true)
    affection = await meterValue(dateMain(page), 'Affection')
    // 8 (venue, gift) + 3 (like) + 2 (type) - 8 (cute) + 2 (chip) + 5 x 2 = 17
    check(affection === 17, `affection before the last turn should be 17, is ${affection}`)
    await setStatusOpen(page, false)
  }, page)

  await step('turn 10: the last turn gets a closing reply', async () => {
    await sendLine(page, 'This was a really good night.')
    await page.getByText('That was the last turn.').waitFor()
    checkIncludes(await lastLine(page), [MOCK.closing], 'the closing reply')
    check(!(await composer(page).count()), 'the composer should be gone once the date is over')
    await page.getByText('Turn 10 of 10').waitFor()
    await checkTouchScreen(page, 'date-last', { shot: shot('date-last') })
  }, page)

  await step('Recap: the changes, the traits with their hints, and a memory line', async () => {
    await toRecap(page)
    const text = await mainText(page)
    checkIncludes(
      text,
      [
        'You saw the date through.',
        'Affection rose from 0 to 19',
        '+19',
        'Trust rose from 0 to 10',
        'Discovered',
        VINYL,
        MOCK.vinylHint,
        CUTE,
        MOCK.cuteHint,
        'Nova loves the record store.',
        'Nova loved the hot sauce.',
        'You found out who Nova is into.',
        'Still Stranger',
      ],
      'the recap',
    )
    checkIncludes(text, [MOCK.memory, 'Nova, after the date'], 'the memory line')
    await checkTouchScreen(page, 'recap', { full: true, shot: shot('recap') })
  }, page)

  await step('reload: the recap, the profile and the memory are kept', async () => {
    await page.reload()
    await page.getByRole('heading', { name: 'Where you stand' }).waitFor()
    checkIncludes(await mainText(page), ['Affection rose from 0 to 19', MOCK.memory], 'the recap after a reload')

    await goHash(page, '#/profile/nova')
    await page.getByRole('meter', { name: 'Affection' }).waitFor()
    check((await meterValue(page, 'Affection')) === 19, `the profile shows ${await meterValue(page, 'Affection')} affection after a reload`)
    check((await meterValue(page, 'Trust')) === 10, `the profile shows ${await meterValue(page, 'Trust')} trust after a reload`)
    const main = page.locator('main')
    await main.getByText(VINYL, { exact: true }).waitFor()
    await main.getByText(MOCK.vinylHint, { exact: true }).waitFor()
    await main.getByText(CUTE, { exact: true }).waitFor()
    await main.getByText(MOCK.cuteHint, { exact: true }).waitFor()
    const likes = await main.getByRole('heading', { name: /^Likes/ }).innerText()
    check(likes.includes('1/5'), `Likes should read 1/5, reads "${likes}"`)
    // 17 traits + attractions + style hidden at first; two traits and the attractions are known now.
    const hidden = await main.getByText('???', { exact: true }).count()
    check(hidden === 16, `expected 16 "???" left, got ${hidden}`)
    await checkTouchScreen(page, 'profile-after', { full: true, shot: shot('profile-after') })

    await goHash(page, '#/debug')
    await press(page.getByRole('tab', { name: 'State' }))
    await page.getByText('Relationships (1)').waitFor()
    const state = await mainText(page)
    checkIncludes(state, [MOCK.memory, '"affection": 19', '"dates": 1', '"id": "vinyl"'], 'the debug State tab')
    await screenshot(page, shot('debug-state'))
    await press(page.getByRole('tab', { name: 'Transcript' }))
    await page.getByText(MOCK.closing).first().waitFor()
    await checkTouchScreen(page, 'debug-transcript', { full: true, shot: shot('debug-transcript') })
  }, page)

  await step('second date: "[tank]" until Nova leaves; the exit reply and the damage', async () => {
    await startDate(page, 'Arcade')
    await waitIdle(page)
    let sent = 0
    while (sent < 5 && (await composer(page).count())) {
      await sendLine(page, '[tank] Honestly, this place is boring and so are you.')
      sent += 1
    }
    check(sent >= 1 && !(await composer(page).count()), `Nova never left (${sent} messages)`)
    log(`     she left after ${sent} ${sent === 1 ? 'message' : 'messages'}`)
    await page.getByText('Nova left.').waitFor()
    checkIncludes(await lastLine(page), [MOCK.exit], 'the exit reply')
    // The counter stays on the turn that was played.
    await page.getByText(`Turn ${sent} of 10`).waitFor()
    await screenshot(page, shot('date-left'))
    await toRecap(page)
    const text = await mainText(page)
    checkIncludes(
      text,
      ['Nova left early.', 'What it cost', 'Nova walked out after the date ran to −', 'Affection fell from 19 to 0'],
      'the early-exit recap',
    )
    await checkTouchScreen(page, 'recap-left', { full: true, shot: shot('recap-left') })
  }, page)

  await step('third date, hints on: banter again and again stops at +25 for the date', async () => {
    await goHash(page, '#/settings')
    const hints = page.getByRole('switch', { name: /Show hints/ })
    await hints.waitFor()
    if ((await hints.getAttribute('aria-checked')) !== 'true') await press(hints)
    await page.getByRole('switch', { name: /Show hints/, checked: true }).waitFor()

    await startDate(page, 'Arcade')
    await waitIdle(page)
    const seen = []
    for (let i = 0; i < 7; i++) {
      await sendLine(page, 'Bet you can’t keep up with my banter.')
      await dateMain(page).getByText(MOCK.banterHint).waitFor()
      seen.push(await dateMain(page).locator('[class*="deltas"]').innerText())
    }
    const want = ['+6', '+6', '+6', '+6', "+1 (this date's limit)", "0 (this date's limit)", "0 (this date's limit)"].map(
      (a) => `Affection ${a}, trust +1`,
    )
    check(JSON.stringify(seen) === JSON.stringify(want), `the hint line read ${JSON.stringify(seen)}`)
    await setStatusOpen(page, true)
    check((await meterValue(dateMain(page), 'Affection')) === 25, `affection should stop at 25, is ${await meterValue(dateMain(page), 'Affection')}`)
    await checkTouchScreen(page, 'date-hints', { shot: shot('date-hints') })
    await setStatusOpen(page, false)
    await endDate(page)
    const text = await mainText(page)
    checkIncludes(text, ['You ended the date early.', 'Affection rose from 0 to 25', '+25', 'Now Acquaintance, up from Stranger', 'Unlocked'], 'the capped recap')
    await checkTouchScreen(page, 'recap-capped', { full: true, shot: shot('recap-capped') })
  }, page)

  await step('360x800: setup, the date with chips and status, the recap', async () => {
    await page.setViewportSize(SMALL_PHONE)
    await goHash(page, '#/profile/nova')
    await press(page.getByRole('button', { name: 'Ask on a date' }))
    await waitForHash(page, '#/date-setup/nova')
    await checkTouchScreen(page, '360-setup', { full: true, shot: 'p3-360-setup' })
    await page.getByRole('radio', { name: /^Karaoke box/ }).check({ force: true })
    await page.getByRole('radio', { name: /^Rare vinyl/ }).check({ force: true })
    await press(page.getByRole('button', { name: 'Start the date' }))
    await waitForHash(page, '#/date')
    await waitIdle(page)
    await chipGroup(page).waitFor()
    await checkTouchScreen(page, '360-date', { shot: 'p3-360-date' })
    await sendLine(page, 'I love the vinyl you picked tonight.')
    await setStatusOpen(page, true)
    await checkTouchScreen(page, '360-date-status', { shot: 'p3-360-date-status' })
    await setStatusOpen(page, false)
    await endDate(page)
    await checkTouchScreen(page, '360-recap', { full: true, shot: 'p3-360-recap' })
    await page.setViewportSize(PIXEL_7.viewport)
  }, page)

  await step('restart on the hub mid-date: the date screen offers the recap of the interrupted date', async () => {
    await startDate(page, 'Rooftop bar')
    await waitIdle(page)
    await sendLine(page, 'The view up here is unreal.')
    // The Android app restarts on the hub.
    await goHash(page, '#/hub')
    await page.reload()
    await waitForHash(page, '#/date')
    await page.getByText('This date was interrupted').waitFor()
    await page.getByText('crushLAB closed partway through your date with Nova, 1 message in.', { exact: false }).waitFor()
    await checkTouchScreen(page, 'date-interrupted', { shot: shot('date-interrupted') })
    await press(page.getByRole('button', { name: 'See how it went' }))
    await page.waitForFunction(() => location.hash.startsWith('#/recap/'), null, { timeout: 20_000 })
    await page.getByRole('heading', { name: 'Where you stand' }).waitFor()
    checkIncludes(await mainText(page), ['Nova loves the rooftop bar.', MOCK.memory], 'the interrupted date recap')
  }, page)

  await step('no uncaught page errors (Android)', async () => {
    const bad = pageErrors(page)
    check(!bad.length, bad.map((e) => `${e.kind}: ${e.text}`).join('\n'))
  }, page)

  await context.close()
}

// ---------------------------------------------------------------------------
// The same screens on a desktop browser

async function desktopFlow(browser, app, mock) {
  const { context, page } = await newPage(browser, 'desktop')
  const shot = (name) => `p3-desktop-${name}`
  const settle = async () => {
    await dismissToasts(page)
    await page.evaluate(() => document.fonts?.ready).catch(() => {})
  }

  await step('1280x800: onboard and connect to the mock', async () => {
    await quickOnboard(page, app.origin, { name: 'Sam', gender: 'Nonbinary', pronouns: 'they/them' })
    await connectToMock(page, mock)
  }, page)

  await step('1280x800: setup, the opening mid-stream, chips, status', async () => {
    await goHash(page, '#/date-setup/nova')
    await page.getByRole('heading', { name: 'Where to' }).waitFor()
    await page.getByRole('radio', { name: /^Record store/ }).check({ force: true })
    await page.getByRole('radio', { name: /^Hot sauce/ }).check({ force: true })
    await settle()
    await screenshot(page, shot('setup'))
    await screenshot(page, shot('setup-full'), { fullPage: true })
    await checkDesign(page, 'desktop setup')
    await page.getByRole('button', { name: 'Start the date' }).click()
    await waitForHash(page, '#/date')
    const lengths = await watchStream(page, `scripts/e2e/out/${shot('date-streaming')}.png`)
    check(lengths.length >= 2, `the opening didn't stream on desktop (${lengths.join(', ')})`)
    await waitIdle(page)
    await chipGroup(page).waitFor()
    await settle()
    await screenshot(page, shot('date-chips'))
    await checkDesign(page, 'desktop date')
    await sendLine(page, 'I love digging through vinyl')
    await setStatusOpen(page, true)
    await settle()
    await screenshot(page, shot('date-status'))
    await checkDesign(page, 'desktop date status')
  }, page)

  await step('1280x800: End date, the recap', async () => {
    await endDate(page)
    await settle()
    checkIncludes(await mainText(page), ['You ended the date early.', VINYL, MOCK.memory], 'the desktop recap')
    await screenshot(page, shot('recap'))
    await screenshot(page, shot('recap-full'), { fullPage: true })
    await checkDesign(page, 'desktop recap')
  }, page)

  await step('1280x800: the early exit and its recap', async () => {
    await startDate(page, 'Climbing gym', 'Flowers')
    await waitIdle(page)
    await sendLine(page, '[tank] I only came for the free chalk.')
    await page.getByText('Nova left.').waitFor()
    await page.getByText('Turn 1 of 10').waitFor()
    await settle()
    await screenshot(page, shot('date-left'))
    await toRecap(page)
    await settle()
    checkIncludes(
      await mainText(page),
      ['Nova left early.', 'What it cost', 'Nova walked out after the date ran to −', 'as low as it goes'],
      'the desktop early-exit recap',
    )
    await screenshot(page, shot('recap-left'))
    await screenshot(page, shot('recap-left-full'), { fullPage: true })
    await checkDesign(page, 'desktop early-exit recap')
  }, page)

  await step('no uncaught page errors (desktop)', async () => {
    const bad = pageErrors(page)
    check(!bad.length, bad.map((e) => `${e.kind}: ${e.text}`).join('\n'))
  }, page)

  await context.close()
}

await main(async () => {
  // Replies stream token by token; opening beats slowly enough to be photographed mid-stream.
  const mock = await startMock({ env: { MOCK_DELAY: '20', MOCK_OPENING_DELAY: '160' } })
  log(`Mock model server on ${mock.baseUrl}`)
  const app = await startApp()
  log(`App on ${app.origin}`)
  const browser = await launchBrowser()

  await androidFlow(browser, app, mock)
  await desktopFlow(browser, app, mock)
})
