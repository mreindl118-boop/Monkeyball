#!/usr/bin/env node
// Phase 4 (relationships): Define the relationship, agreements, gossip and betrayal, the friend
// route, misgendering, endings and the epilogue, as Chrome on an Android phone, then on a desktop.
//
//   npm run e2e:phase4        (serves the app with the vite dev server; see "Seeding" below)
//
// Seeding. Relationships are seeded through the app's own save import: the script exports a save
// from Settings, Saves (a real download), rewrites its relationships (and orientation mode) in
// node, and imports it back with Import save file. The game's random rolls (gossip, rekindles, a
// character asking to define the relationship, how hard a betrayal lands) are pinned with the
// debug panel's "Random rolls" field (State tab), which only exists in dev builds
// (src/store/rolls.ts), so this script runs against the vite dev server. Rolls are set to
// "succeed": every roll `rng() < chance` passes, so word of a date always gets around.
//
// Runs against scripts/mock-llm.mjs: the judge answers by keywords in the player's message
// ("misgender" a turn-off with a trust drop, "[lie]" a caught lie, "banter" +6), the story follows
// the turn note (the Define-the-relationship note gets "I think I want that too"), and the Agreement
// prompt accepts whatever was asked for.
//
// Pixel 7 profile (touch, 412x915 at 2.625x), from empty storage:
//   (a) Nova seeded at 34 affection: a date at the record store with rare vinyl takes her to Friend
//       (42) -> Define the relationship -> the sheet, Exclusive -> the brass "Defining the
//       relationship" bar -> a line in the talk -> Close the talk -> "Nova said yes" -> End date:
//       the recap says what you are now; the profile and the map show the agreement.
//   (c) Then a date with Kai: "misgender" drops affection and trust (a turn-off for everyone).
//       Kai's date ends -> word gets around (rolls pinned): Nova hears about Kai, which breaks the
//       exclusive agreement -> Kai's recap has "Word got around"; the hub's news and Nova's jealousy
//       mark; her profile says what she knows; the map shows lipstick tension and her person sheet
//       says it; the next Nova date's story prompt (debug panel) carries the betrayal (who she knows
//       about, marked as breaking the agreement, and her memory line). A "[lie]" on that date is a
//       caught lie: trust drops more than affection; the recap shows the betrayal on the meters.
//   (b) Jules (only into men) seeded at 55 with a woman player, realistic mode: the hub's friend
//       mark, a date with a favorite venue and a loved gift stops at 59 (the friend-route cap) and
//       Jules gossips; Settings, Who's into you, Everyone's into you: the mark goes, the profile says
//       romantic route, and the next date Jules brings up defining it (the brass offer banner).
//   (d) Nova seeded at 92: the record store and rare vinyl take her to 100 on a date, and its recap
//       shows the ending she's on ("See your ending" opens the ending screen); the profile's "Your
//       ending" card, the ending screen, the epilogue (six turns at her first favorite venue, the
//       ending in the header), its recap with the ending; the automatic "Before Nova's epilogue" slot
//       exists and restores the game from before it.
//   Then the new screens at 360x800.
// Desktop 1280x800: Nova brings up defining it herself (offer banner), the sheet opens on what she
// wants, a caught lie and its recap, the map and a person sheet, an ending screen.
// Every screen is checked like android.mjs does (no sideways scroll, 48px touch targets, design
// rules). Screenshots: scripts/e2e/out/p4-android-*.png, p4-360-*.png and p4-desktop-*.png.
//
// E2E_ONLY=a|b|d|desktop runs one part (a includes c).

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
  MIN_TAP,
  newPage,
  onCleanup,
  PIXEL_7,
  press,
  quickOnboard,
  screenshot,
  sleep,
  SMALL_PHONE,
  startDev,
  startMock,
  step,
  waitForHash,
} from './lib.mjs'

const ONLY = (process.env.E2E_ONLY || '').trim()
const runs = (part) => !ONLY || ONLY.split(',').includes(part)

/** What the mock answers (scripts/mock-llm.mjs). */
const MOCK = {
  dtrReply: 'I think I want that too.',
  closing: "It's late. Same time next week?",
  memory: 'We got drinks and talked until the place emptied out',
  misgenderHint: 'A flat, tired look.',
}

const DAY = 86_400_000

// ---------------------------------------------------------------------------
// Seeds (written into an exported save, then imported)

/** A relationship as the game stores it, with `patch` on top. */
function rel(characterId, patch = {}) {
  return {
    characterId,
    affection: 0,
    trust: 0,
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
    ...patch,
  }
}

/** The exported save with these relationships, a fresh game state and settings changes. */
function seeded(base, { rels, settings = {} }) {
  const now = Date.now()
  const kv = base.kv
    .filter((r) => r.key !== 'game' && r.key !== 'activeDate')
    .map((r) => (r.key === 'settings' ? { key: 'settings', value: { ...r.value, ...settings } } : r))
  kv.push({
    key: 'game',
    value: { startedAt: now - 10 * DAY, news: [], rumors: [], metamours: {}, rekindled: [], endingsSeen: {} },
  })
  return { ...base, exportedAt: now, kv, relationships: rels, dates: [], customCharacters: [], packs: [] }
}

const weekAgo = () => Date.now() - 7 * DAY

/** (a) and (c): Nova two dates in and short of Friend; Kai one date in. */
const seedA = () => [
  rel('nova', { affection: 34, trust: 60, dates: 2, lastDateAt: weekAgo(), connection: 4, tiersUnlocked: [1], memory: ['You came back to the booth twice. I noticed.'] }),
  rel('kai', { affection: 15, trust: 25, dates: 1, lastDateAt: weekAgo(), connection: 1 }),
]

/** (b): Jules is only into men; three dates in, trust enough to ask once dateable. */
const seedB = () => [rel('jules', { affection: 55, trust: 55, dates: 3, lastDateAt: weekAgo(), connection: 5, tiersUnlocked: [1, 2] })]

/** (d): Nova at 92, honest the whole way: the record store and rare vinyl take her to 100 (the good ending). */
const seedD = () => [
  rel('nova', {
    affection: 92,
    trust: 78,
    dates: 9,
    lastDateAt: weekAgo(),
    connection: 12,
    tiersUnlocked: [1, 2, 3, 4],
    secretsUnlocked: [0, 1],
    revealed: { attractions: true, style: true },
    memory: ['Nine dates in and you still make me laugh at the worst moments.'],
  }),
]

/** Desktop: Nova at Friend with trust and dates enough to bring it up herself; Marlowe at 100. */
const seedDesktop = () => [
  rel('nova', { affection: 44, trust: 64, dates: 3, lastDateAt: weekAgo(), connection: 6, tiersUnlocked: [1, 2] }),
  rel('kai', { affection: 26, trust: 30, dates: 2, lastDateAt: weekAgo(), connection: 2, tiersUnlocked: [1] }),
  rel('marlowe', { affection: 100, trust: 72, dates: 8, lastDateAt: weekAgo(), connection: 11, tiersUnlocked: [1, 2, 3, 4, 5] }),
]

// ---------------------------------------------------------------------------
// Helpers

const dateMain = (page) => page.locator('main[aria-label^="Date with"]')
const composer = (page) => page.getByLabel(/^Your message to/)
const mainText = (page) => page.locator('main').first().innerText()

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

/** The debug panel's dev-only "Random rolls" field (State tab). */
async function setRolls(page, value) {
  await goHash(page, '#/debug')
  await press(page.getByRole('tab', { name: 'State' }))
  const field = page.getByLabel('Random rolls')
  await field.waitFor()
  await field.fill(value)
  await page.getByText(/Every roll succeeds/).waitFor()
  const stored = await page.evaluate(() => localStorage.getItem('crushlab.debug.rolls'))
  check(stored === value, `the rolls setting reads ${stored}`)
}

/** Settings, Saves, Export save file: the save as JSON. */
async function exportSave(page, dir, name) {
  await goHash(page, '#/settings/saves')
  const button = page.getByRole('button', { name: 'Export save file' })
  await button.waitFor()
  const download = page.waitForEvent('download')
  await press(button)
  const file = await download
  const saved = path.join(dir, name)
  await file.saveAs(saved)
  return JSON.parse(await readFile(saved, 'utf8'))
}

/** Settings, Saves, Import save file, Replace everything: the app reloads on the hub. */
async function importSave(page, dir, name, save) {
  const file = path.join(dir, name)
  await writeFile(file, JSON.stringify(save))
  await goHash(page, '#/settings/saves')
  await page.getByRole('button', { name: 'Import save file' }).waitFor()
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(file)
  const dialog = page.getByRole('alertdialog', { name: 'Replace everything with this save?' })
  await dialog.waitFor()
  await press(dialog.getByRole('button', { name: 'Replace everything' }))
  await page.getByText('Save file loaded.').waitFor({ timeout: 20_000 })
  await waitForHash(page, '#/hub')
  await dismissToasts(page)
}

/** The date waits for the player, or it is over and "See how it went" is ready. */
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

const playerBubbles = (page) => dateMain(page).locator('[class*="_you_"]').count()

function lastLine(page) {
  return page.evaluate(() => {
    const lines = document.querySelectorAll('main[aria-label^="Date with"] [class*="_line_"]')
    return lines.length ? lines[lines.length - 1].textContent.trim() : ''
  })
}

async function meterValue(scope, name) {
  return Number(await scope.getByRole('meter', { name }).first().getAttribute('aria-valuenow'))
}

async function setStatusOpen(page, open) {
  const toggle = dateMain(page).getByRole('button', { name: /^Mood/ })
  if ((await toggle.getAttribute('aria-expanded')) !== String(open)) await press(toggle)
  if (open) await dateMain(page).getByRole('meter', { name: 'Affection' }).waitFor()
}

/** Affection and trust on the date's status panel. */
async function dateMeters(page) {
  await setStatusOpen(page, true)
  const out = { affection: await meterValue(dateMain(page), 'Affection'), trust: await meterValue(dateMain(page), 'Trust') }
  await setStatusOpen(page, false)
  return out
}

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

/** From a profile to a date at `venue` with `gift` (or none): waits for the opening beat. */
async function startDate(page, id, venue, gift) {
  await goHash(page, `#/profile/${id}`)
  await press(page.getByRole('button', { name: 'Ask on a date' }))
  await waitForHash(page, `#/date-setup/${id}`)
  await page.getByRole('radio', { name: new RegExp(`^${venue}`) }).check({ force: true })
  if (gift) await page.getByRole('radio', { name: new RegExp(`^${gift}`) }).check({ force: true })
  await press(page.getByRole('button', { name: 'Start the date' }))
  await waitForHash(page, '#/date')
  await dateMain(page).waitFor()
  await waitIdle(page)
}

async function endDate(page) {
  await press(dateMain(page).getByRole('button', { name: 'End date', exact: true }))
  const dialog = page.getByRole('alertdialog', { name: 'End the date?' })
  await dialog.waitFor()
  await press(dialog.getByRole('button', { name: 'End date', exact: true }))
  await page.waitForFunction(() => location.hash.startsWith('#/recap/'), null, { timeout: 20_000 })
  await page.getByRole('heading', { name: 'Where you stand' }).waitFor()
}

async function toRecap(page) {
  await waitIdle(page)
  await press(dateMain(page).getByRole('button', { name: 'See how it went' }))
  await page.waitForFunction(() => location.hash.startsWith('#/recap/'), null, { timeout: 20_000 })
  await page.getByRole('heading', { name: 'Where you stand' }).waitFor()
}

/** A fact on the profile ("Agreement", "Route", "What they know"): its value and caption. */
function fact(page, label) {
  return page.locator('main dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd').innerText()
}

/** A hub coaster's accessible label. */
async function coasterLabel(page, name) {
  await goHash(page, '#/hub')
  const coaster = page.getByRole('button', { name: new RegExp(`^${name},`) })
  await coaster.waitFor()
  return coaster.getAttribute('aria-label')
}

/**
 * Touch targets inside an open sheet or dialog (the screen under its backdrop can't be tapped, so
 * the whole-page check doesn't apply): every button and radio at least MIN_TAP tall.
 */
async function checkSheetTargets(page, dialog, where) {
  const heights = await dialog.evaluate((root) =>
    [...root.querySelectorAll('button, [role="radio"], a[href]')]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => ({ name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40), h: Math.round(el.getBoundingClientRect().height) })),
  )
  check(heights.length > 0, `${where}: nothing tappable in the sheet`)
  const small = heights.filter((x) => x.h < MIN_TAP)
  check(!small.length, `${where}: sheet targets under ${MIN_TAP}px: ${small.map((x) => `"${x.name}" ${x.h}px`).join('; ')}`)
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  check(scrollWidth <= clientWidth, `${where}: the page scrolls sideways under the sheet`)
  await checkDesign(page, where)
  log(`     ${where}: ${heights.length} sheet targets, all at least ${MIN_TAP}px`)
}

/** The story prompt last sent (debug panel, Prompts). */
async function lastStoryPrompt(page) {
  await goHash(page, '#/debug')
  await press(page.getByRole('tab', { name: 'Prompts' }))
  const section = page.getByRole('region', { name: 'Story prompt' })
  await section.getByText(/^Last sent at/).waitFor()
  return section.innerText()
}

function pageErrors(page) {
  return page.errors.filter(
    (e) => e.kind === 'pageerror' || !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED|CORS policy|net::|Download the React DevTools/.test(e.text),
  )
}

/** Set up a phone or desktop page: onboard, connect to the mock, pin the rolls, export the base save. */
async function prepare(page, app, mock, dir, who) {
  await quickOnboard(page, app.origin, who)
  await connectToMock(page, mock)
  await setRolls(page, 'succeed')
  return exportSave(page, dir, 'base.json')
}

// ---------------------------------------------------------------------------
// Android: (a) + (c), (b), (d), then 360x800

async function androidFlow(browser, app, mock, dir) {
  const { context, page } = await newPage(browser, PIXEL_7.viewport, PIXEL_7)
  const shot = (name) => `p4-android-${name}`
  let base

  await step('quick onboarding (a woman), the mock, rolls pinned to succeed, a save exported', async () => {
    base = await prepare(page, app, mock, dir, { name: 'Ana', gender: 'Woman', pronouns: 'she/her' })
    check(base.app === 'crushLAB' && Array.isArray(base.kv), 'the exported save is not a crushLAB save')
  }, page)

  if (runs('a')) {
    await step('(a) seed: Nova at 34 (two dates), Kai at 15, through Import save file', async () => {
      await importSave(page, dir, 'seed-a.json', seeded(base, { rels: seedA() }))
      const nova = await coasterLabel(page, 'Nova Castellanos')
      check(/stage Acquaintance/.test(nova) && !/jealous/.test(nova), `Nova's coaster reads "${nova}"`)
    }, page)

    await step('(a) a date with Nova: the record store and rare vinyl take her to Friend; Define the relationship is on offer', async () => {
      await startDate(page, 'nova', 'Record store', 'Rare vinyl')
      const m = await dateMeters(page)
      check(m.affection === 42, `Nova should be at 42 after the venue and gift, is ${m.affection}`)
      check(!(await page.getByText('wants to talk about what you are').count()), 'Nova brought it up herself (her trust or dates should keep her from it)')
      const entry = dateMain(page).getByRole('button', { name: 'Define the relationship', exact: true })
      await entry.waitFor()
      await checkTouchScreen(page, 'date-dtr-entry', { shot: shot('date-dtr-entry') })
    }, page)

    await step('(a) the Define-the-relationship sheet: four choices, Exclusive, Ask Nova', async () => {
      await press(dateMain(page).getByRole('button', { name: 'Define the relationship', exact: true }))
      const sheet = page.getByRole('dialog', { name: 'Define the relationship' })
      await sheet.waitFor()
      const radios = sheet.getByRole('radio')
      check((await radios.count()) === 4, `the sheet offers ${await radios.count()} choices`)
      checkIncludes(await sheet.innerText(), ['Exclusive', 'Open', 'Poly', 'Keep it casual', 'Ask Nova'], 'the sheet')
      await press(sheet.getByRole('radio', { name: /^Exclusive/ }))
      check((await sheet.getByRole('radio', { name: /^Exclusive/ }).getAttribute('aria-checked')) === 'true', 'Exclusive is not picked')
      await sleep(250)
      await screenshot(page, shot('dtr-sheet'))
      await checkSheetTargets(page, sheet, 'dtr-sheet')
      await press(sheet.getByRole('button', { name: 'Ask Nova' }))
      await sheet.waitFor({ state: 'detached' })
      await dateMain(page).getByText('Defining the relationship', { exact: true }).waitFor()
      await dateMain(page).getByText('You asked for exclusive.', { exact: false }).waitFor()
      await checkTouchScreen(page, 'dtr-banner', { shot: shot('dtr-banner') })
    }, page)

    await step('(a) the talk: her reply answers it; Close the talk runs the Agreement prompt: "Nova said yes"', async () => {
      await sendLine(page, "I want it to be just us. No one else, if you're in.")
      checkIncludes(await lastLine(page), [MOCK.dtrReply], "Nova's answer in the talk")
      await press(dateMain(page).getByRole('button', { name: 'Close the talk' }))
      const result = dateMain(page).getByRole('note').filter({ hasText: 'Nova said yes' })
      await result.waitFor({ timeout: 20_000 })
      checkIncludes(await result.innerText(), ["You're exclusive now.", 'Nova says: exclusive, and we tell each other the truth.'], 'the outcome')
      await waitIdle(page)
      check(!(await dateMain(page).getByText('Defining the relationship', { exact: true }).count()), 'the talk is still open')
      await checkTouchScreen(page, 'dtr-result', { shot: shot('dtr-result') })
    }, page)

    await step('(a) End date: the recap says what you are now', async () => {
      await endDate(page)
      checkIncludes(await mainText(page), ['What you are now', 'You went from no agreement to exclusive.', 'Now Friend, up from Acquaintance'], 'the recap')
      await checkTouchScreen(page, 'recap-dtr', { full: true, shot: shot('recap-dtr') })
    }, page)

    await step("(a) the agreement on Nova's profile and on the map", async () => {
      await goHash(page, '#/profile/nova')
      await page.getByRole('meter', { name: 'Affection' }).waitFor()
      checkIncludes(await fact(page, 'Agreement'), ['Exclusive', 'Nova says: exclusive, and we tell each other the truth.'], 'the profile agreement')
      await goHash(page, '#/map')
      const novaRow = page.getByRole('button', { name: /^Nova Castellanos/ })
      await novaRow.waitFor()
      checkIncludes(await novaRow.innerText(), ['Agreed on exclusive'], "Nova's line under the map")
      check((await page.locator('svg text', { hasText: 'exclusive' }).count()) >= 1, 'no "exclusive" thread label on the map')
      await checkTouchScreen(page, 'map-agreement', { full: true, shot: shot('map-agreement') })
    }, page)

    let kaiBefore
    await step('(c) a date with Kai: a misgendering line drops affection and trust', async () => {
      await startDate(page, 'kai', 'Boardwalk')
      kaiBefore = await dateMeters(page)
      await sendLine(page, "Sorry, I misgendered you just now. They, I know. That's on me.")
      const after = await dateMeters(page)
      check(after.affection < kaiBefore.affection, `affection didn't drop (${kaiBefore.affection} to ${after.affection})`)
      check(after.trust < kaiBefore.trust, `trust didn't drop (${kaiBefore.trust} to ${after.trust})`)
      log(`     misgendering: affection ${kaiBefore.affection} to ${after.affection}, trust ${kaiBefore.trust} to ${after.trust}`)
      await setStatusOpen(page, true)
      await dateMain(page).getByText('Hurt', { exact: true }).waitFor()
      await screenshot(page, shot('date-misgender'))
      await setStatusOpen(page, false)
    }, page)

    await step("(a) Kai's date ends; word gets around: Nova heard, and it breaks the exclusive agreement", async () => {
      await sendLine(page, 'The boardwalk at night is something else.')
      await endDate(page)
      const text = await mainText(page)
      checkIncludes(text, ['Word got around', 'Nova heard you went out with Kai, after you and Nova agreed to be exclusive.'], "Kai's recap")
      // The breach shows as a hit on Nova's meters, right on Kai's recap.
      const hit = page.getByRole('region', { name: 'What it did to Nova Castellanos' })
      await hit.waitFor()
      checkIncludes(await hit.innerText(), ['Affection fell from', 'Trust fell from', 'Betrayal −'], "the hit on Nova's meters")
      check((await hit.getByRole('meter').count()) === 2, "Nova's meters on Kai's recap")
      await checkTouchScreen(page, 'recap-word', { full: true, shot: shot('recap-word') })
      await hit.scrollIntoViewIfNeeded()
      await sleep(200)
      await screenshot(page, shot('recap-word-hit'))
    }, page)

    await step('(a) the hub: the news, and Nova is marked jealous', async () => {
      await goHash(page, '#/hub')
      const news = page.getByRole('region', { name: 'Word around town' })
      await news.waitFor()
      checkIncludes(await news.innerText(), ['Nova heard you went out with Kai'], 'the news strip')
      const nova = await coasterLabel(page, 'Nova Castellanos')
      check(/jealous/.test(nova), `Nova's coaster isn't marked jealous: "${nova}"`)
      await checkTouchScreen(page, 'hub-news', { shot: shot('hub-news') })
    }, page)

    await step("(a) Nova's profile says what she knows", async () => {
      await goHash(page, '#/profile/nova')
      await page.getByRole('meter', { name: 'Affection' }).waitFor()
      checkIncludes(await fact(page, 'What they know'), ['Nova heard about Kai through the grapevine after you agreed to be exclusive.'], 'What they know')
      checkIncludes(await fact(page, 'Agreement'), ['Exclusive'], 'the agreement after the betrayal')
      await checkTouchScreen(page, 'profile-betrayal', { full: true, shot: shot('profile-betrayal') })
    }, page)

    await step('(a) the map: lipstick tension with Nova, and her person sheet says why', async () => {
      await goHash(page, '#/map')
      const novaRow = page.getByRole('button', { name: /^Nova Castellanos/ })
      await novaRow.waitFor()
      checkIncludes(await novaRow.innerText(), ['Agreed on exclusive, minds who else you see.'], "Nova's line under the map")
      check((await page.locator('svg path[class*="tension"]').count()) >= 1, 'no tension thread on the map')
      const summary = await page.getByRole('img', { name: /^Polycule map/ }).getAttribute('aria-label')
      check(/tension with one person|tension with \d+ people/.test(summary), `the map's summary: ${summary}`)
      await checkTouchScreen(page, 'map', { full: true, shot: shot('map') })
      await press(novaRow)
      const sheet = page.getByRole('dialog', { name: 'Nova Castellanos' })
      await sheet.waitFor()
      checkIncludes(
        await sheet.innerText(),
         ['Nova thinks you two agreed to exclusive.', "Nova knows you're seeing Kai and minds.", 'Nova heard about Kai through the grapevine after you agreed to be exclusive.', "Nova hasn't let it go."],
        'the person sheet',
      )
      await sleep(250)
      await screenshot(page, shot('map-person'))
      await checkSheetTargets(page, sheet, 'map-person')
      await press(sheet.getByRole('button', { name: 'Close' }))
      await sheet.waitFor({ state: 'detached' })
    }, page)

    await step("(a) the next Nova date: her story prompt carries the betrayal (debug panel)", async () => {
      await startDate(page, 'nova', 'Karaoke box')
      const prompt = await lastStoryPrompt(page)
      checkIncludes(
        prompt,
        [
          'Agreement: exclusive: Nova says: exclusive, and we tell each other the truth',
          'Kai Okoro, which breaks the exclusive agreement Nova Castellanos made with the player',
          'We agreed to be exclusive, and I had to hear about Kai from someone else.',
        ],
        "Nova's story prompt",
      )
      await screenshot(page, shot('debug-story-prompt'))
      await page.goBack()
      await waitForHash(page, '#/date')
      await dateMain(page).waitFor()
      await waitIdle(page)
    }, page)

    await step('(a) a caught lie: trust drops more than affection; the recap shows the betrayal on the meters', async () => {
      const before = await dateMeters(page)
      await sendLine(page, "[lie] Kai? I haven't seen Kai in months, I swear.")
      const after = await dateMeters(page)
      const lostAffection = before.affection - after.affection
      const lostTrust = before.trust - after.trust
      log(`     the lie: affection -${lostAffection}, trust -${lostTrust}`)
      check(lostAffection >= 10 && lostTrust > lostAffection, `a caught lie should cost more trust than affection (affection -${lostAffection}, trust -${lostTrust})`)
      await endDate(page)
      const text = await mainText(page)
      checkIncludes(text, ['Betrayal −', 'Nova caught you in a lie.'], 'the betrayal recap')
      await checkTouchScreen(page, 'recap-betrayal', { full: true, shot: shot('recap-betrayal') })
    }, page)
  }

  if (runs('b')) {
    await step('(b) seed: Jules (only into men) at 55; realistic mode: the friend mark on the hub', async () => {
      await importSave(page, dir, 'seed-b.json', seeded(base, { rels: seedB(), settings: { orientationMode: 'realistic' } }))
      const jules = await coasterLabel(page, 'Jules Ferreira')
      check(/friend route/.test(jules), `Jules's coaster has no friend mark: "${jules}"`)
      await goHash(page, '#/profile/jules')
      await page.getByRole('meter', { name: 'Affection' }).waitFor()
      checkIncludes(await fact(page, 'Route'), ['Friend route'], "Jules's route")
      await checkTouchScreen(page, 'profile-friend', { full: true, shot: shot('profile-friend') })
    }, page)

    await step('(b) a friend date: a favorite venue and a loved gift stop at 59; Jules gossips', async () => {
      await startDate(page, 'jules', 'Karaoke box', 'Concert tickets')
      const m = await dateMeters(page)
      check(m.affection === 59, `a friend route should stop at 59, affection is ${m.affection}`)
      check(!(await page.getByText('wants to talk about what you are').count()), 'a friend-route character brought up defining it')
      await sendLine(page, 'Bet you can’t keep up with my banter.')
      check((await dateMeters(page)).affection === 59, 'affection went past 59 on a friend route')
      await endDate(page)
      const text = await mainText(page)
      checkIncludes(text, ['Affection rose from 55 to 59', 'What Jules told you'], "Jules's recap")
      await checkTouchScreen(page, 'recap-friend', { full: true, shot: shot('recap-friend') })
    }, page)

    await step("(b) Everyone's into you: the friend mark goes and Jules is on a romantic route", async () => {
      await goHash(page, '#/settings/play')
      await press(page.getByRole('radio', { name: /^Everyone's into you/ }))
      await page.getByRole('radio', { name: /^Everyone's into you/, checked: true }).waitFor()
      const jules = await coasterLabel(page, 'Jules Ferreira')
      check(!/friend route/.test(jules), `Jules still has the friend mark: "${jules}"`)
      await goHash(page, '#/profile/jules')
      await page.getByRole('meter', { name: 'Affection' }).waitFor()
      checkIncludes(await fact(page, 'Route'), ['Romantic route'], "Jules's route in everyone mode")
    }, page)

    await step('(b) dateable now: past 59, and Jules brings up defining it (the offer banner)', async () => {
      await startDate(page, 'jules', 'Karaoke box')
      const m = await dateMeters(page)
      check(m.affection === 62, `Jules should rise past 59 on a romantic route (62), is ${m.affection}`)
      const banner = dateMain(page).getByRole('status').filter({ hasText: 'Jules wants to talk about what you are' })
      await banner.waitFor()
      checkIncludes(await banner.innerText(), ['Jules has exclusive in mind.', 'Talk', 'Not now'], 'the offer banner')
      await checkTouchScreen(page, 'dtr-offer', { shot: shot('dtr-offer') })
      await press(banner.getByRole('button', { name: 'Talk' }))
      const sheet = page.getByRole('dialog', { name: 'Define the relationship' })
      await sheet.waitFor()
      check((await sheet.getByRole('radio', { name: /^Exclusive/ }).getAttribute('aria-checked')) === 'true', 'the sheet should open on what Jules wants')
      checkIncludes(await sheet.innerText(), ['What Jules wants'], 'the sheet opened from the offer')
      await sleep(250)
      await screenshot(page, shot('dtr-sheet-offer'))
      await press(sheet.getByRole('button', { name: 'Not now' }))
      await sheet.waitFor({ state: 'detached' })
      await endDate(page)
    }, page)
  }

  if (runs('d')) {
    await step("(d) seed: Nova at 92; a date takes her to 100 and its recap shows the ending you're on", async () => {
      await importSave(page, dir, 'seed-d.json', seeded(base, { rels: seedD(), settings: { orientationMode: 'realistic' } }))
      await startDate(page, 'nova', 'Record store', 'Rare vinyl')
      const m = await dateMeters(page)
      check(m.affection === 100, `the record store and rare vinyl should take Nova to 100, she is at ${m.affection}`)
      await sendLine(page, 'Your banter is ruining me for everyone else.')
      await endDate(page)
      checkIncludes(await mainText(page), ['Now Won, up from Lover'], 'the recap at 100')
      const card = page.getByRole('region', { name: 'Your ending' })
      await card.waitFor()
      checkIncludes(
        await card.innerText(),
        ['The good ending', 'High trust and affection with Nova, and honest the whole way.', "Before Nova's epilogue", 'See your ending'],
        "the recap's ending",
      )
      await checkTouchScreen(page, 'recap-won', { full: true })
      await card.scrollIntoViewIfNeeded()
      await sleep(200)
      await screenshot(page, shot('recap-won'))
      await press(card.getByRole('button', { name: 'See your ending' }))
      await waitForHash(page, '#/ending/nova')
      await page.getByRole('heading', { name: 'The good ending' }).waitFor()
    }, page)

    await step("(d) her profile shows the ending you're on", async () => {
      await goHash(page, '#/profile/nova')
      const card = page.getByRole('region', { name: 'Your ending' })
      await card.waitFor()
      checkIncludes(await card.innerText(), ['The good ending', 'Play the epilogue', 'Not yet'], 'the ending card')
      await card.scrollIntoViewIfNeeded()
      await checkTouchScreen(page, 'profile-ending', { full: true, shot: shot('profile-ending') })
    }, page)

    await step('(d) the ending screen: which ending, why, and where', async () => {
      await press(page.getByRole('region', { name: 'Your ending' }).getByRole('button', { name: 'Play the epilogue' }))
      await waitForHash(page, '#/ending/nova')
      await page.getByRole('heading', { name: 'The good ending' }).waitFor()
      checkIncludes(await mainText(page), ["The ending you're on", 'Why this one', 'One last date, six turns, at the record store.', 'Not the one you wanted?'], 'the ending screen')
      await checkTouchScreen(page, 'ending', { full: true, shot: shot('ending') })
    }, page)

    await step('(d) the epilogue plays six turns at her first favorite venue', async () => {
      await press(page.getByRole('button', { name: 'Play the epilogue' }).last())
      await waitForHash(page, '#/date')
      await dateMain(page).waitFor()
      await waitIdle(page)
      await page.getByText('Turn 1 of 6').waitFor()
      await dateMain(page).getByText('Epilogue, the good ending').waitFor()
      checkIncludes(await dateMain(page).innerText(), ['Record store'], 'the epilogue venue')
      await checkTouchScreen(page, 'epilogue', { shot: shot('epilogue') })
      for (let i = 1; i <= 6; i++) await sendLine(page, i === 6 ? 'Stay. Play me one more.' : `Tell me about the ${['first', 'second', 'third', 'fourth', 'fifth'][i - 1]} record you ever bought.`)
      await page.getByText('That was the last turn.').waitFor()
      await page.getByText('Turn 6 of 6').waitFor()
      checkIncludes(await lastLine(page), [MOCK.closing], 'the closing reply')
    }, page)

    await step('(d) the recap shows the ending', async () => {
      await toRecap(page)
      checkIncludes(await mainText(page), ['The epilogue: the good ending.', 'Your ending', "It's kept on Nova's profile and in the gallery, and it can play again."], 'the epilogue recap')
      // Phase 5: the ending's art develops as an instant-film print in the "Your ending" panel.
      const print = page.getByRole('region', { name: 'Your ending', exact: true }).locator('figure[data-state]')
      check((await print.count()) === 1, `${await print.count()} ending prints on the epilogue recap`)
      check(/good ending/i.test(await print.innerText()), `the ending print reads "${await print.innerText()}"`)
      await checkTouchScreen(page, 'recap-epilogue', { full: true, shot: shot('recap-epilogue') })
    }, page)

    await step("(d) the automatic slot \"Before Nova's epilogue\" exists and restores the game from before it", async () => {
      await goHash(page, '#/profile/nova')
      await page.getByRole('region', { name: 'Your ending' }).getByRole('button', { name: 'Play the epilogue again' }).waitFor()
      await goHash(page, '#/settings/saves')
      const slots = page.getByRole('list', { name: 'Save slots' })
      await slots.waitFor()
      const slot = slots.getByRole('listitem').filter({ hasText: "Before Nova's epilogue" })
      await slot.waitFor()
      checkIncludes(await slot.innerText(), ['Automatic', 'Saved automatically'], 'the automatic slot')
      await slot.scrollIntoViewIfNeeded()
      await sleep(300)
      await screenshot(page, shot('saves-auto'))
      await press(slot.getByRole('button', { name: 'Restore' }))
      const dialog = page.getByRole('alertdialog', { name: /^Restore "Before Nova/ })
      await dialog.waitFor()
      await press(dialog.getByRole('button', { name: 'Restore' }))
      await page.getByText(/^Restored "Before Nova/).waitFor({ timeout: 20_000 })
      await waitForHash(page, '#/hub')
      await goHash(page, '#/profile/nova')
      const card = page.getByRole('region', { name: 'Your ending' })
      await card.waitFor()
      check(!(await card.getByRole('button', { name: 'Play the epilogue again' }).count()), 'the restored game still has the epilogue played')
      await card.getByRole('button', { name: 'Play the epilogue' }).waitFor()
    }, page)
  }

  await step('360x800: the ending screen, the map, the DTR sheet and bar', async () => {
    await page.setViewportSize(SMALL_PHONE)
    if (runs('d')) {
      await goHash(page, '#/ending/nova')
      await page.getByRole('heading', { name: 'The good ending' }).waitFor()
      await checkTouchScreen(page, '360-ending', { full: true, shot: 'p4-360-ending' })
    }
    await goHash(page, '#/map')
    await page.getByRole('heading', { name: 'Everyone on the map' }).waitFor()
    await checkTouchScreen(page, '360-map', { full: true, shot: 'p4-360-map' })
    await importSave(page, dir, 'seed-360.json', seeded(base, { rels: seedDesktop() }))
    await startDate(page, 'nova', 'Rooftop bar')
    const banner = dateMain(page).getByRole('status').filter({ hasText: 'Nova wants to talk about what you are' })
    await banner.waitFor()
    await checkTouchScreen(page, '360-dtr-offer', { shot: 'p4-360-dtr-offer' })
    await press(banner.getByRole('button', { name: 'Talk' }))
    const sheet = page.getByRole('dialog', { name: 'Define the relationship' })
    await sheet.waitFor()
    await sleep(250)
    await screenshot(page, 'p4-360-dtr-sheet')
    await checkSheetTargets(page, sheet, '360-dtr-sheet')
    await press(sheet.getByRole('button', { name: 'Ask Nova' }))
    await sheet.waitFor({ state: 'detached' })
    await dateMain(page).getByText('Defining the relationship', { exact: true }).waitFor()
    await checkTouchScreen(page, '360-dtr-banner', { shot: 'p4-360-dtr-banner' })
    await endDate(page)
    await checkTouchScreen(page, '360-recap', { full: true, shot: 'p4-360-recap' })
    await page.setViewportSize(PIXEL_7.viewport)
  }, page)

  await step('no uncaught page errors (Android)', async () => {
    const bad = pageErrors(page)
    check(!bad.length, bad.map((e) => `${e.kind}: ${e.text}`).join('\n'))
  }, page)

  await context.close()
}

// ---------------------------------------------------------------------------
// Desktop

async function desktopFlow(browser, app, mock, dir) {
  const { context, page } = await newPage(browser, 'desktop')
  const shot = (name) => `p4-desktop-${name}`
  const settle = async () => {
    await dismissToasts(page)
    await page.evaluate(() => document.fonts?.ready).catch(() => {})
  }
  let base

  await step('1280x800: onboard, the mock, rolls pinned; seed Nova at Friend (three dates, trust 64) and Marlowe at 100', async () => {
    base = await prepare(page, app, mock, dir, { name: 'Sam', gender: 'Nonbinary', pronouns: 'they/them' })
    await importSave(page, dir, 'seed-desktop.json', seeded(base, { rels: seedDesktop() }))
  }, page)

  await step('1280x800: Nova brings it up herself; the sheet opens on what she wants; the talk bar', async () => {
    await startDate(page, 'nova', 'Rooftop bar')
    const banner = dateMain(page).getByRole('status').filter({ hasText: 'Nova wants to talk about what you are' })
    await banner.waitFor()
    checkIncludes(await banner.innerText(), ['Nova has open in mind.'], 'the offer')
    await settle()
    await screenshot(page, shot('dtr-offer'))
    await checkDesign(page, 'desktop offer')
    await press(banner.getByRole('button', { name: 'Talk' }))
    const sheet = page.getByRole('dialog', { name: 'Define the relationship' })
    await sheet.waitFor()
    check((await sheet.getByRole('radio', { name: /^Open/ }).getAttribute('aria-checked')) === 'true', 'the sheet should open on Open')
    await sleep(250)
    await screenshot(page, shot('dtr-sheet'))
    await checkDesign(page, 'desktop sheet')
    await press(sheet.getByRole('button', { name: 'Ask Nova' }))
    await sheet.waitFor({ state: 'detached' })
    await dateMain(page).getByText('Nova brought it up and has open in mind.', { exact: false }).waitFor()
    await settle()
    await screenshot(page, shot('dtr-banner'))
    await checkDesign(page, 'desktop talk bar')
    await sendLine(page, 'Open works for me, as long as we keep each other posted.')
    await press(dateMain(page).getByRole('button', { name: 'Close the talk' }))
    await dateMain(page).getByRole('note').filter({ hasText: 'You said yes to Nova' }).waitFor({ timeout: 20_000 })
    await waitIdle(page)
    await settle()
    await screenshot(page, shot('dtr-result'))
  }, page)

  await step('1280x800: a caught lie and the betrayal recap', async () => {
    const before = await dateMeters(page)
    await sendLine(page, '[lie] I never even looked at anyone else this month.')
    const after = await dateMeters(page)
    check(before.trust - after.trust > before.affection - after.affection, 'a caught lie should cost more trust than affection')
    await endDate(page)
    await settle()
    checkIncludes(await mainText(page), ['Betrayal −', 'Nova caught you in a lie.', 'You went from no agreement to open.'], 'the desktop recap')
    await screenshot(page, shot('recap-betrayal'))
    await screenshot(page, shot('recap-betrayal-full'), { fullPage: true })
    await checkDesign(page, 'desktop recap')
  }, page)

  await step('1280x800: the map and a person sheet', async () => {
    await goHash(page, '#/map')
    const novaRow = page.getByRole('button', { name: /^Nova Castellanos/ })
    await novaRow.waitFor()
    checkIncludes(await novaRow.innerText(), ['Agreed on open'], "Nova's line")
    await settle()
    await screenshot(page, shot('map'))
    await screenshot(page, shot('map-full'), { fullPage: true })
    await checkDesign(page, 'desktop map')
    await press(novaRow)
    const sheet = page.getByRole('dialog', { name: 'Nova Castellanos' })
    await sheet.waitFor()
    checkIncludes(await sheet.innerText(), ['Nova thinks you two agreed to keep it open.', 'Nova caught you in a lie.'], 'the desktop person sheet')
    await sleep(250)
    await screenshot(page, shot('map-person'))
    await checkDesign(page, 'desktop person sheet')
    await press(sheet.getByRole('button', { name: 'Close' }))
  }, page)

  await step("1280x800: Marlowe's ending screen", async () => {
    await goHash(page, '#/profile/marlowe')
    await page.getByRole('region', { name: 'Your ending' }).waitFor()
    await goHash(page, '#/ending/marlowe')
    await page.getByText("The ending you're on").waitFor()
    await settle()
    await screenshot(page, shot('ending'))
    await screenshot(page, shot('ending-full'), { fullPage: true })
    await checkDesign(page, 'desktop ending')
  }, page)

  await step('no uncaught page errors (desktop)', async () => {
    const bad = pageErrors(page)
    check(!bad.length, bad.map((e) => `${e.kind}: ${e.text}`).join('\n'))
  }, page)

  await context.close()
}

await main(async () => {
  const mock = await startMock()
  log(`Mock model server on ${mock.baseUrl}`)
  // The debug panel's Random rolls field only exists in dev builds, so this runs on the dev server.
  log('Starting the vite dev server')
  const app = await startDev()
  log(`App on ${app.origin}`)
  const dir = await mkdtemp(path.join(tmpdir(), 'crushlab-p4-'))
  onCleanup(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(dir, { recursive: true, force: true })
  })
  const browser = await launchBrowser()

  if (runs('a') || runs('b') || runs('d')) await androidFlow(browser, app, mock, dir)
  if (runs('desktop')) await desktopFlow(browser, app, mock, dir)
})
