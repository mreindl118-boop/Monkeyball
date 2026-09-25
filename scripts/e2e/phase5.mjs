#!/usr/bin/env node
// Phase 5 (gallery and art): the instant-film unlock reveal, the gallery and its locks, the
// full-screen viewer, image generation with Automatic1111/Forge and Grok Imagine (both answered by
// scripts/mock-llm.mjs), Regenerate, the player's own image, favorites, and the image prompts in
// the debug panel. As Chrome on an Android phone first, then at 360x800 and on a desktop.
//
//   npm run e2e:phase5        (serves the app with the vite dev server; see "Grok Imagine" below)
//
// Seeding. As in phase4.mjs, relationships are seeded through the app's own save import (export a
// save in Settings, rewrite it in node, Import save file). The game's random rolls are pinned to
// "fail" (the debug panel's dev-only "Random rolls" field), so nobody brings up defining the
// relationship and no gossip gets in the way.
//
// Grok Imagine. The app only ever sends the xAI key to https://api.x.ai. Dev builds (and only dev
// builds: `import.meta.env.DEV`, dropped from production) read one override, the localStorage key
// `crushlab.debug.xaiBase` (DEV_XAI_BASE_KEY in src/art/providers.ts); this script sets it to the
// mock's /v1 address before switching the provider. No screen offers it. That is why this script
// runs on the vite dev server, not the production build.
//
// The mock counts requests by route (GET /__mock/requests; DELETE starts over), which is how "painted
// once and cached" is checked.
//
// Pixel 7 profile (touch, 412x915 at 2.625x, motion allowed so the reveal plays), from empty storage:
//   - Nova seeded at 59 (tiers 1 and 2), Jules on the friend route (a woman player, realistic
//     mode), Priya at 36 with trust 40 (her demisexual gate is trust over 60), no image provider.
//   - A date with Nova at the record store with rare vinyl (+8) crosses 60: the recap's "Unlocked"
//     print for tier 3 develops as instant film (screenshots mid-development and developed), with
//     placeholder art. Reloading the recap shows it developed, without playing it again.
//   - The gallery: Nova 3/5; her tiers 1 to 3 unlocked with placeholders, 4 and 5 locked with
//     "Unlocks at 80" and "Unlocks at 100". Jules: tiers 3 to 5 "Friendship-locked".
//   - Settings, Image generation: Generate art on, Automatic1111 at the mock, Test image generation
//     paints a test picture. The safety text is shown read-only and is in no field.
//   - A date with Priya (bookstore cafe, poetry book: +8) crosses 40: tier 2 is painted in the
//     background, once (one txt2img), and the recap's print develops it (reduced motion: a fade).
//     Visiting her gallery again, and reloading, doesn't paint again.
//   - The debug panel logged that painting: "adult woman, 30 years old", the safety clause and the
//     safety negative prompt.
//   - Grok Imagine (the dev-only override points it at the mock; a key on the Grok card): Test image
//     generation works.
//   - The viewer: Regenerate shows the new picture next to the current one; Keep current changes
//     nothing, Keep new replaces it. Use my own image (a 1200x1800 photo) wins over the generated
//     one, and its gallery tile decodes a 640 thumbnail; Remove my image brings the painting back. Favorite two pictures: the Favorites filter shows just those. Swipe between
//     Nova's pictures.
//   - Debug panel, Prompts, Live preview: heat 2 to 4 changes Nova's image and story prompts;
//     Priya at heat 4 is painted and written at 2 until her trust is over 60 (a re-import raises it
//     to 70), then both change.
//   Then the Phase 5 screens at 360x800.
// Desktop 1280x800: Nova crosses 60 with image generation already on: the reveal waits for the
// painting and develops it; the gallery, a character's gallery, the viewer, a Regenerate comparison
// and Settings, Image generation.
// Screens are checked like android.mjs does (no sideways scroll, 48px touch targets, design
// rules). Screenshots: scripts/e2e/out/p5-android-*.png, p5-360-*.png and p5-desktop-*.png.
//
// E2E_ONLY=android|desktop runs one part.

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { heatDescription } from '../../src/data/heat.ts'
import { makePng, MOCK_IMAGE_SIZE } from '../mock-llm.mjs'
import {
  check,
  checkDesign,
  checkIncludes,
  checkTouchScreen,
  connectToMock,
  dismissToasts,
  exportSaveFile,
  goHash,
  importSaveFile,
  launchBrowser,
  log,
  main,
  MIN_TAP,
  newPage,
  OUT_DIR,
  PIXEL_7,
  press,
  quickOnboard,
  screenshot,
  seededSave,
  seedRel,
  sleep,
  SMALL_PHONE,
  startDev,
  startMock,
  step,
  waitForHash,
} from './lib.mjs'

const ONLY = (process.env.E2E_ONLY || '').trim()
const runs = (part) => !ONLY || ONLY.split(',').includes(part)

/** Pieces of the locked safety text (src/art/imagePrompt.ts, IMAGE_SAFETY). */
const SAFETY = {
  positive: 'everyone depicted is a consenting adult aged 21 or older',
  negative: ['childlike', 'underage', 'non-consensual'],
  grok: 'Nothing childlike, underage or young-looking is shown, there is no school setting, and nothing non-consensual is shown',
}
/** The dev-only override (src/art/providers.ts, DEV_XAI_BASE_KEY). */
const XAI_BASE_KEY = 'crushlab.debug.xaiBase'

const DAY = 86_400_000
const weekAgo = () => Date.now() - 7 * DAY

const TITLES = {
  nova: ['Behind the decks', 'Afterhours', 'Rain check', 'Borrowed shirt', 'Encore'],
  priya: ['Open all night', 'Marginalia', 'Gallery hours', 'Last chapter', 'Dedication'],
  jules: ['Mic check', 'Duet', 'Hands up', 'Lights down', 'The song'],
}

// ---------------------------------------------------------------------------
// Seeds

const seedAndroid = () => [
  seedRel('nova', { affection: 59, trust: 55, dates: 3, lastDateAt: weekAgo(), connection: 5, tiersUnlocked: [1, 2], memory: ['Three dates in and you still pick the best records.'] }),
  seedRel('jules', { affection: 50, trust: 50, dates: 2, lastDateAt: weekAgo(), connection: 3, tiersUnlocked: [1, 2] }),
  seedRel('priya', { affection: 36, trust: 40, dates: 2, lastDateAt: weekAgo(), connection: 2, tiersUnlocked: [1] }),
]

const seedDesktop = () => [seedRel('nova', { affection: 59, trust: 55, dates: 3, lastDateAt: weekAgo(), connection: 5, tiersUnlocked: [1, 2] })]

// ---------------------------------------------------------------------------
// Helpers

const dateMain = (page) => page.locator('main[aria-label^="Date with"]')
const composer = (page) => page.getByLabel(/^Your message to/)

/** The mock's request counts ("POST /sdapi/v1/txt2img": n); `reset` starts over. */
async function mockRequests(mock, { reset = false } = {}) {
  const res = await fetch(`${mock.origin}/__mock/requests`, { method: reset ? 'DELETE' : 'GET' })
  return (await res.json()).requests
}

/** The debug panel's dev-only "Random rolls" field (State tab). */
async function setRolls(page, value) {
  await goHash(page, '#/debug')
  await press(page.getByRole('tab', { name: 'State' }))
  const field = page.getByLabel('Random rolls')
  await field.waitFor()
  await field.fill(value)
  await page.getByText(/Every roll fails/).waitFor()
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

async function sendLine(page, text) {
  const before = await dateMain(page).locator('[class*="_you_"]').count()
  await composer(page).fill(text)
  await press(dateMain(page).getByRole('button', { name: 'Send', exact: true }))
  await page.waitForFunction(
    (n) => document.querySelectorAll('main[aria-label^="Date with"] [class*="_you_"]').length > n,
    before,
    { timeout: 10_000 },
  )
  await waitIdle(page)
}

/** From a profile to a date at `venue` with `gift`: waits for the opening beat. */
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

/** End date, confirm: the recap. Returns its hash. */
async function endDate(page) {
  await press(dateMain(page).getByRole('button', { name: 'End date', exact: true }))
  const dialog = page.getByRole('alertdialog', { name: 'End the date?' })
  await dialog.waitFor()
  await press(dialog.getByRole('button', { name: 'End date', exact: true }))
  await page.waitForFunction(() => location.hash.startsWith('#/recap/'), null, { timeout: 20_000 })
  await page.getByRole('heading', { name: 'Where you stand' }).waitFor()
  return page.evaluate(() => location.hash)
}

/** The recap's "Unlocked" panel and its instant-film prints. */
const unlockedPanel = (page) => page.getByRole('region', { name: 'Unlocked', exact: true })
const films = (page) => unlockedPanel(page).locator('figure[data-state]')

/** Scroll an element to the middle of the screen. */
async function center(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await sleep(120)
}

async function filmState(locator) {
  return locator.getAttribute('data-state')
}

/**
 * The print's development, photographed: waits for it to start, freezes every animation at `atMs`
 * for the mid-development shot, lets it run on and waits for the developed print. Returns how long
 * it took from developing to done (ms).
 */
async function photographReveal(page, film, name, { atMs = 1500 } = {}) {
  // Off screen, the print waits: it develops once it's in view.
  const before = await filmState(film)
  check(before !== 'done', 'the print had already developed before it came on screen')
  await center(film)
  await page.waitForFunction((el) => el.getAttribute('data-state') === 'developing', await film.elementHandle(), { timeout: 95_000 })
  const t0 = Date.now()
  await sleep(Math.max(0, atMs - 150))
  await page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause()
      a.currentTime = t
    }
  }, atMs)
  const midState = await filmState(film)
  // animations: 'allow' keeps the paused frame (the lib's screenshot fast-forwards them).
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-mid.png`) })
  await page.evaluate(() => {
    for (const a of document.getAnimations()) a.play()
  })
  check(midState === 'developing', `the print was ${midState} at ${atMs} ms, not developing`)
  await page.waitForFunction((el) => el.getAttribute('data-state') === 'done', await film.elementHandle(), { timeout: 10_000 })
  const took = Date.now() - t0
  await sleep(200)
  await screenshot(page, `${name}-developed`)
  return took
}

/** The average color of an image element's middle (the mock paints solid colors). */
function imgColor(locator) {
  return locator.evaluate(async (img) => {
    if (!img.complete || !img.naturalWidth) await new Promise((r) => img.addEventListener('load', r, { once: true }))
    const c = document.createElement('canvas')
    c.width = 8
    c.height = 8
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, 8, 8)
    const d = ctx.getImageData(4, 4, 1, 1).data
    return [d[0], d[1], d[2]]
  })
}

const sameColor = (a, b, tol = 10) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
const rgb = (c) => `rgb(${c.join(', ')})`

/**
 * Touch targets inside the viewer or a dialog (what's under its backdrop can't be tapped, so the
 * whole-page check doesn't apply): every button at least MIN_TAP tall, no sideways scroll, and the
 * design rules.
 */
async function checkDialogTargets(page, dialog, where) {
  const heights = await dialog.evaluate((root) =>
    [...root.querySelectorAll('button, [role="radio"], a[href]')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.height > 0 && r.width > 0 && getComputedStyle(el).visibility !== 'hidden'
      })
      .map((el) => ({ name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40), h: Math.round(el.getBoundingClientRect().height) })),
  )
  check(heights.length > 0, `${where}: nothing tappable`)
  const small = heights.filter((x) => x.h < MIN_TAP)
  check(!small.length, `${where}: targets under ${MIN_TAP}px: ${small.map((x) => `"${x.name}" ${x.h}px`).join('; ')}`)
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  check(scrollWidth <= clientWidth, `${where}: the page scrolls sideways`)
  await checkDesign(page, where)
  log(`     ${where}: ${heights.length} targets, all at least ${MIN_TAP}px`)
}

/** A character's gallery: the Tiers panel. */
async function openGallery(page, id) {
  await goHash(page, `#/gallery/${id}`)
  const tiers = page.getByRole('region', { name: 'Tiers', exact: true })
  await tiers.waitFor()
  return tiers
}

/** Open a tier in the viewer from a character's gallery. */
async function openTier(page, id, tier) {
  const tiers = await openGallery(page, id)
  const tile = tiers.getByRole('button', { name: new RegExp(`^Tier ${tier}: `) })
  await press(tile)
  const viewer = page.getByRole('dialog', { name: new RegExp(`, ${TITLES[id][tier - 1]}$`) })
  await viewer.waitFor()
  return viewer
}

/** The viewer's picture (the image, not the placeholder). */
const viewerImg = (viewer) => viewer.locator('img').first()

async function closeViewer(page, viewer) {
  await press(viewer.getByRole('button', { name: 'Close', exact: true }))
  await viewer.waitFor({ state: 'detached' })
}

/** Swipe the viewer's picture sideways with one finger (CDP touch events, as on a phone). */
async function swipe(page, locator, dx) {
  const box = await locator.boundingBox()
  check(box, 'nothing to swipe')
  const y = box.y + box.height / 2
  const x0 = box.x + box.width / 2 - dx / 2
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] })
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 8, y }] })
    await sleep(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

/** The debug panel's Prompts tab in Live preview, with `name` picked (by label). */
async function livePreview(page, name) {
  await goHash(page, '#/debug')
  await press(page.getByRole('tab', { name: 'Prompts' }))
  await press(page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Live preview' }))
  if (name) await page.getByLabel('Preview with').selectOption({ label: name })
  const image = page.getByRole('region', { name: 'Image prompt', exact: true })
  const story = page.getByRole('region', { name: 'Story prompt', exact: true })
  await image.getByText(/prompt preview with/).waitFor()
  return { image: await image.locator('pre').innerText(), story: await story.locator('pre').innerText() }
}

/** Settings, Play: the heat pip. */
async function setHeat(page, level, label) {
  await goHash(page, '#/settings')
  const pip = page.getByRole('radio', { name: `${level}, ${label}` })
  await press(pip)
  check((await pip.getAttribute('aria-checked')) === 'true', `heat ${level} is not selected`)
}

/** Settings, Image generation. */
async function openImageSettings(page) {
  await goHash(page, '#/settings/images')
  const section = page.locator('#settings-images')
  await section.getByRole('switch', { name: /Generate art/ }).waitFor()
  return section
}

/** Test image generation, and wait for its picture. */
async function testImages(page, section) {
  await press(section.getByRole('button', { name: 'Test image generation' }))
  await section.getByText('It works: here is a small test picture.').waitFor({ timeout: 30_000 })
  const img = section.getByRole('img', { name: 'The test picture' })
  await img.waitFor()
  check(await img.evaluate((el) => el.complete && el.naturalWidth > 0), 'the test picture did not load')
}

function pageErrors(page) {
  return page.errors.filter(
    (e) => e.kind === 'pageerror' || !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED|CORS policy|net::|Download the React DevTools/.test(e.text),
  )
}

/** Onboard, connect to the mock, pin the rolls, export the base save. */
async function prepare(page, app, mock, dir) {
  await quickOnboard(page, app.origin, { name: 'Ana', gender: 'Woman', pronouns: 'she/her' })
  await connectToMock(page, mock)
  await setRolls(page, 'fail')
  return exportSaveFile(page, dir, 'base.json')
}

// ---------------------------------------------------------------------------
// Android

async function androidFlow(browser, app, mock, dir) {
  const { context, page } = await newPage(browser, PIXEL_7.viewport, { ...PIXEL_7, reducedMotion: 'no-preference' })
  const shot = (name) => `p5-android-${name}`
  let base
  let novaRecap

  await step('quick onboarding (a woman), the mock, rolls pinned to fail, a save exported', async () => {
    base = await prepare(page, app, mock, dir)
    check(base.app === 'crushLAB', 'the exported save is not a crushLAB save')
  }, page)

  await step('seed: Nova at 59 (tiers 1 and 2), Jules on the friend route, Priya at 36; no image provider', async () => {
    await importSaveFile(page, dir, 'seed-android.json', seededSave(base, { rels: seedAndroid(), settings: { orientationMode: 'realistic', heat: 2 } }))
    const section = await openImageSettings(page)
    check((await section.getByRole('switch', { name: /Generate art/ }).getAttribute('aria-checked')) === 'false', 'Generate art is on')
  }, page)

  await step('a date with Nova crosses 60: the record store and rare vinyl (+8)', async () => {
    await startDate(page, 'nova', 'Record store', 'Rare vinyl')
    await sendLine(page, 'This place is perfect. Show me your favorite crate.')
    novaRecap = await endDate(page)
  }, page)

  await step('the recap develops tier 3 as instant film, once, with placeholder art', async () => {
    const panel = unlockedPanel(page)
    await panel.waitFor()
    check((await films(page).count()) === 1, `${await films(page).count()} prints on the recap`)
    const film = films(page).first()
    checkIncludes(await film.innerText(), ['Tier 3', TITLES.nova[2]], 'the print')
    check((await film.locator('figure[data-source="placeholder"]').count()) === 1, 'the print has no placeholder art')
    const took = await photographReveal(page, film, shot('recap-reveal'))
    check(took >= 1800 && took < 6000, `the print developed in ${took} ms (2.5 s expected)`)
    log(`     tier 3 developed in ${took} ms`)
    await checkTouchScreen(page, 'recap-reveal', { full: true, shot: shot('recap') })
  }, page)

  await step('reload the recap: the print is developed and does not play again', async () => {
    await page.reload()
    await unlockedPanel(page).waitFor()
    const film = films(page).first()
    await film.waitFor()
    await center(film)
    const seen = new Set()
    for (let i = 0; i < 25; i++) {
      seen.add(await filmState(film))
      await sleep(120)
    }
    check(seen.size === 1 && seen.has('done'), `after a reload the print went through ${[...seen].join(', ')}`)
  }, page)

  await step('the gallery: Nova has 3 of 5', async () => {
    await goHash(page, '#/gallery')
    const nova = page.getByRole('button', { name: /^Nova Castellanos/ })
    await nova.waitFor()
    checkIncludes(await nova.innerText(), ['3/5'], "Nova's row")
    check(/3 of 5 unlocked/.test(await nova.innerHTML()), "Nova's row doesn't say 3 of 5 unlocked")
    await checkTouchScreen(page, 'gallery', { full: true, shot: shot('gallery') })
  }, page)

  await step("Nova's gallery: tiers 1 to 3 unlocked with placeholders, 4 and 5 locked at 80 and 100", async () => {
    const tiers = await openGallery(page, 'nova')
    for (const t of [1, 2, 3]) {
      const tile = tiers.getByRole('button', { name: `Tier ${t}: ${TITLES.nova[t - 1]}` })
      await tile.waitFor()
      check((await tile.locator('figure[data-source="placeholder"]').count()) === 1, `tier ${t} isn't a placeholder`)
    }
    check((await tiers.getByRole('button').count()) === 3, 'more than three tiers can be opened')
    const text = await tiers.innerText()
    checkIncludes(text, ['Unlocks at 80', 'Unlocks at 100', TITLES.nova[3], TITLES.nova[4]], 'the locked tiers')
    await checkTouchScreen(page, 'gallery-nova', { full: true, shot: shot('gallery-nova') })
  }, page)

  await step('Jules (friend route): tiers 1 and 2 unlocked, 3 to 5 friendship-locked', async () => {
    const tiers = await openGallery(page, 'jules')
    check((await tiers.getByRole('button').count()) === 2, 'Jules should have two tiers to open')
    const text = await tiers.innerText()
    check((text.match(/Friendship-locked/g) ?? []).length === 3, `Jules's tiers: ${text}`)
    checkIncludes(await page.locator('main').first().innerText(), ['On a friend route tiers 1 and 2 unlock'], "Jules's gallery")
    await checkTouchScreen(page, 'gallery-jules', { full: true, shot: shot('gallery-jules') })
  }, page)

  await step('Settings, Image generation: Automatic1111 at the mock, Test image generation paints', async () => {
    const section = await openImageSettings(page)
    await press(section.getByRole('switch', { name: /Generate art/ }))
    check((await section.getByRole('switch', { name: /Generate art/ }).getAttribute('aria-checked')) === 'true', 'Generate art is still off')
    const a1111 = section.getByRole('radio', { name: /^Automatic1111 or Forge/ })
    check((await a1111.getAttribute('aria-checked')) === 'true', 'Automatic1111 is not the provider')
    await press(section.getByRole('radio', { name: 'On this device' }))
    await section.locator('#img-url').fill(mock.origin)
    await testImages(page, section)
    const samplers = await section.getByLabel('Sampler').locator('option').allInnerTexts()
    checkIncludes(samplers.join('\n'), ['Euler a', 'DPM++ 2M', 'LCM'], "the server's samplers")
    // The safety text is shown, read-only, and is in no field.
    const locked = section.getByRole('region', { name: 'Safety text', exact: true })
    checkIncludes(await locked.innerText(), [SAFETY.positive, ...SAFETY.negative], 'the safety text')
    const inFields = await page.evaluate((clause) => [...document.querySelectorAll('input, textarea')].some((f) => f.value.includes(clause)), SAFETY.positive)
    check(!inFields, 'the safety text is in an editable field')
    await center(locked)
    await screenshot(page, shot('settings-images-safety'))
    await section.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await sleep(150)
    await screenshot(page, shot('settings-images'))
    await checkTouchScreen(page, 'settings-images', { shot: shot('settings-top') })
  }, page)

  let generatedColor
  await step('Priya crosses 40: tier 2 is painted in the background, once, and develops on the recap (a fade with reduced motion)', async () => {
    await mockRequests(mock, { reset: true })
    await startDate(page, 'priya', 'Bookstore cafe', 'Poetry book')
    await sendLine(page, 'I could stay here all night.')
    await endDate(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const film = films(page).first()
    await film.waitFor()
    checkIncludes(await film.innerText(), ['Tier 2', TITLES.priya[1]], "Priya's print")
    await center(film)
    await page.waitForFunction((el) => el.getAttribute('data-state') === 'developing', await film.elementHandle(), { timeout: 95_000 })
    const t0 = Date.now()
    const anim = await film.evaluate((el) => {
      const pic = el.querySelector('[class*="picture"]')
      const s = pic ? getComputedStyle(pic) : null
      return s ? `${s.animationName} ${s.animationDuration}` : ''
    })
    await page.waitForFunction((el) => el.getAttribute('data-state') === 'done', await film.elementHandle(), { timeout: 5000 })
    const took = Date.now() - t0
    check(/fade/i.test(anim) && /0\.4s/.test(anim), `with reduced motion the print animates "${anim}"`)
    check(took < 1500, `the fade took ${took} ms`)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const img = film.locator('img')
    await img.waitFor()
    generatedColor = await imgColor(img)
    const counts = await mockRequests(mock)
    check(counts['POST /sdapi/v1/txt2img'] === 1, `txt2img was called ${counts['POST /sdapi/v1/txt2img'] ?? 0} times`)
    log(`     painted once (${rgb(generatedColor)}); faded in over ${took} ms`)
    await screenshot(page, shot('recap-generated'))
  }, page)

  await step('the debug panel logged the painting (in memory, so before any reload): her adult age, the safety clause and the negative prompt', async () => {
    await goHash(page, '#/debug')
    await press(page.getByRole('tab', { name: 'Responses' }))
    const entry = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Image/ }) }).filter({ hasText: 'priya' }).first()
    await entry.waitFor()
    await press(entry.locator('summary'))
    const text = await entry.innerText()
    checkIncludes(text, ['Automatic1111/Forge', 'adult woman, 30 years old', SAFETY.positive, 'Negative prompt:', ...SAFETY.negative, 'Painted priya:tier-2'], 'the image entry')
    await press(page.getByRole('tab', { name: 'Prompts' }))
    const image = page.getByRole('region', { name: 'Image prompt', exact: true })
    await image.getByText(/^Last sent at/).waitFor()
    checkIncludes(await image.innerText(), ['years old', SAFETY.positive], 'the image prompt as sent')
  }, page)

  await step("a second visit to Priya's gallery, and a reload, don't paint again", async () => {
    for (let visit = 0; visit < 2; visit++) {
      const tiers = await openGallery(page, 'priya')
      const tile = tiers.getByRole('button', { name: `Tier 2: ${TITLES.priya[1]}` })
      await tile.locator('figure[data-source="generated"] img').waitFor()
      const viewer = await openTier(page, 'priya', 2)
      await viewer.getByText('Generated', { exact: true }).waitFor()
      check(sameColor(await imgColor(viewerImg(viewer)), generatedColor), 'the viewer shows another picture')
      await closeViewer(page, viewer)
      if (visit === 0) await page.reload()
    }
    const counts = await mockRequests(mock)
    check(counts['POST /sdapi/v1/txt2img'] === 1, `txt2img was called ${counts['POST /sdapi/v1/txt2img']} times`)
  }, page)

  await step('Grok Imagine (the dev-only address override points it at the mock): Test image generation works', async () => {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [XAI_BASE_KEY, mock.baseUrl])
    await goHash(page, '#/settings/connection')
    await press(page.getByRole('button', { name: /^Grok/ }).first())
    await page.getByLabel('Grok API key', { exact: true }).fill('xai-mock-key')
    const section = await openImageSettings(page)
    await press(section.getByRole('radio', { name: /^Grok Imagine/ }))
    await section.getByText('Uses the key saved on the Grok card in Connection.').waitFor()
    await mockRequests(mock, { reset: true })
    await testImages(page, section)
    const counts = await mockRequests(mock)
    check(counts['POST /images/generations'] === 1 && counts['GET /image-generation-models'] >= 1, `Grok routes: ${JSON.stringify(counts)}`)
    checkIncludes(await section.getByRole('region', { name: 'Safety text', exact: true }).innerText(), [SAFETY.grok], 'the Grok clause')
    await section.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await sleep(150)
    await screenshot(page, shot('settings-images-grok'))
    await checkTouchScreen(page, 'settings-images-grok', { shot: shot('settings-grok-top') })
  }, page)

  let keptColor
  await step('Regenerate: the new picture shows next to the current one; Keep current changes nothing, Keep new replaces it', async () => {
    const viewer = await openTier(page, 'priya', 2)
    await viewer.getByText('Generated', { exact: true }).waitFor()
    check(sameColor(await imgColor(viewerImg(viewer)), generatedColor), 'the viewer shows another picture before Regenerate')
    // Keep current.
    await press(viewer.getByRole('button', { name: 'Regenerate' }))
    const compare = viewer.getByRole('region', { name: 'Compare the new picture with the current one' })
    await compare.waitFor({ timeout: 30_000 })
    const [current, fresh] = [compare.locator('figure').nth(0).locator('img'), compare.locator('figure').nth(1).locator('img')]
    check(sameColor(await imgColor(current), generatedColor), 'the current picture changed before Keep new')
    const firstNew = await imgColor(fresh)
    check(!sameColor(firstNew, generatedColor), 'the new picture looks like the current one')
    await sleep(200)
    await screenshot(page, shot('regenerate-compare'))
    await checkDialogTargets(page, viewer, 'regenerate-compare')
    await press(viewer.getByRole('button', { name: 'Keep current' }))
    await compare.waitFor({ state: 'detached' })
    check(sameColor(await imgColor(viewerImg(viewer)), generatedColor), 'Keep current changed the picture')
    // Keep new.
    await press(viewer.getByRole('button', { name: 'Regenerate' }))
    await compare.waitFor({ timeout: 30_000 })
    keptColor = await imgColor(compare.locator('figure').nth(1).locator('img'))
    check(sameColor(await imgColor(compare.locator('figure').nth(0).locator('img')), generatedColor), 'the current picture changed before Keep new')
    await press(viewer.getByRole('button', { name: 'Keep new' }))
    await compare.waitFor({ state: 'detached' })
    await page.waitForFunction(
      ([el, want]) => {
        const img = el.querySelector('img')
        if (!img || !img.complete || !img.naturalWidth) return false
        const c = document.createElement('canvas')
        c.width = 8
        c.height = 8
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0, 8, 8)
        const d = ctx.getImageData(4, 4, 1, 1).data
        return [0, 1, 2].every((i) => Math.abs(d[i] - want[i]) <= 10)
      },
      [await viewer.elementHandle(), keptColor],
      { timeout: 10_000 },
    )
    log(`     current ${rgb(generatedColor)}, kept new ${rgb(keptColor)}`)
    await closeViewer(page, viewer)
  }, page)

  await step("Use my own image wins over the generated one; tiles show its thumbnail; Remove my image brings the painting back", async () => {
    // A big photo: stored whole for the viewer (at most 2048 on its longest side) and as a
    // 640 thumbnail for tiles and coasters.
    const own = path.join(dir, 'my-picture.png')
    await writeFile(own, makePng(1200, 1800, [20, 190, 60]))
    let viewer = await openTier(page, 'priya', 2)
    await viewer.getByRole('button', { name: 'Use my own image' }).waitFor()
    await viewer.locator('input[type="file"]').setInputFiles(own)
    await page.getByText("Your image is in Priya's gallery now.").waitFor({ timeout: 15_000 })
    await viewer.getByText('Your image', { exact: true }).waitFor()
    await page.waitForFunction((el) => (el.querySelector('img')?.naturalWidth ?? 0) === 1200, await viewer.elementHandle())
    check(sameColor(await imgColor(viewerImg(viewer)), [20, 190, 60], 16), 'the viewer does not show my image')
    check((await viewer.getByRole('button', { name: 'Regenerate' }).count()) === 0, 'Regenerate is offered over my own image')
    await sleep(200)
    await screenshot(page, shot('viewer-own'))
    await dismissToasts(page)
    await closeViewer(page, viewer)
    const tile = page.getByRole('region', { name: 'Tiers', exact: true }).getByRole('button', { name: `Tier 2: ${TITLES.priya[1]}` })
    const tileImg = tile.locator('figure[data-source="imported"] img')
    await tileImg.waitFor()
    const tileSize = await tileImg.evaluate(async (img) => {
      if (!img.complete || !img.naturalWidth) await new Promise((r) => img.addEventListener('load', r, { once: true }))
      return [img.naturalWidth, img.naturalHeight]
    })
    check(Math.max(...tileSize) === 640, `the tile decodes a ${tileSize.join('x')} picture, not the 640 thumbnail`)
    log(`     the tile shows a ${tileSize.join('x')} thumbnail of the 1200x1800 picture`)
    viewer = await openTier(page, 'priya', 2)
    await viewer.getByText('Your image', { exact: true }).waitFor()
    await press(viewer.getByRole('button', { name: 'Remove my image' }))
    const confirm = page.getByRole('alertdialog', { name: 'Remove your image?' })
    await confirm.waitFor()
    await press(confirm.getByRole('button', { name: 'Remove', exact: true }))
    await viewer.getByText('Generated', { exact: true }).waitFor()
    await page.waitForFunction(([el, w]) => (el.querySelector('img')?.naturalWidth ?? 0) === w, [await viewer.elementHandle(), MOCK_IMAGE_SIZE[0]])
    check(sameColor(await imgColor(viewerImg(viewer)), keptColor), 'the generated picture did not come back')
    await dismissToasts(page)
    await closeViewer(page, viewer)
  }, page)

  await step('favorites: Priya tier 2 and Nova tier 1; the Favorites filter shows just those', async () => {
    let viewer = await openTier(page, 'priya', 2)
    const fav = () => viewer.getByRole('button', { name: 'Favorite', exact: true })
    await press(fav())
    await page.waitForFunction((el) => el.getAttribute('aria-pressed') === 'true', await fav().elementHandle())
    await closeViewer(page, viewer)
    viewer = await openTier(page, 'nova', 1)
    await press(fav())
    await page.waitForFunction((el) => el.getAttribute('aria-pressed') === 'true', await fav().elementHandle())
    await closeViewer(page, viewer)
    await goHash(page, '#/gallery')
    await press(page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Favorites' }))
    const panel = page.getByRole('region', { name: 'Favorites', exact: true })
    await panel.waitFor()
    const tiles = panel.getByRole('button')
    check((await tiles.count()) === 2, `${await tiles.count()} favorites`)
    const labels = (await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).join(' | ')
    checkIncludes(labels, [`Nova, tier 1: ${TITLES.nova[0]}`, `Priya, tier 2: ${TITLES.priya[1]}`], 'the favorites')
    const rows = await page.locator('main').first().getByRole('button', { name: /^(Nova Castellanos|Priya Raman|Jules Ferreira)/ }).allInnerTexts()
    check(rows.length === 2 && !rows.some((r) => r.includes('Jules')), `rows under Favorites: ${rows.join(' / ')}`)
    await checkTouchScreen(page, 'gallery-favorites', { full: true, shot: shot('gallery-favorites') })
    // From the favorites, the viewer steps through just those two.
    await press(tiles.first())
    const favViewer = page.getByRole('dialog').first()
    await favViewer.getByText('1 of 2').waitFor()
    await closeViewer(page, favViewer)
    await press(page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Everyone' }))
  }, page)

  await step("the viewer: swipe between Nova's pictures", async () => {
    const viewer = await openTier(page, 'nova', 1)
    await viewer.getByText('1 of 3').waitFor()
    check((await viewer.getByRole('button', { name: 'Favorite', exact: true }).getAttribute('aria-pressed')) === 'true', 'tier 1 is not a favorite')
    await sleep(200)
    await screenshot(page, shot('viewer'))
    await checkDialogTargets(page, viewer, 'viewer')
    // The dialog's name follows the picture, so find the stage by role alone.
    const stage = page.getByRole('dialog').locator('[class*="stage"]').first()
    await swipe(page, stage, -240)
    const second = page.getByRole('dialog', { name: `Nova Castellanos, ${TITLES.nova[1]}` })
    await second.getByText('2 of 3').waitFor()
    await swipe(page, stage, -240)
    await page.getByRole('dialog', { name: `Nova Castellanos, ${TITLES.nova[2]}` }).getByText('3 of 3').waitFor()
    await swipe(page, stage, 240)
    await second.getByText('2 of 3').waitFor()
    // A short or mostly vertical drag doesn't move.
    await swipe(page, stage, -30)
    await sleep(200)
    await second.getByText('2 of 3').waitFor()
    await closeViewer(page, second)
  }, page)

  let novaAt2
  await step("debug panel, Live preview: heat 2 to 4 changes Nova's image and story prompts", async () => {
    novaAt2 = await livePreview(page, 'Nova Castellanos')
    checkIncludes(novaAt2.image, ['adult woman, 28 years old', SAFETY.positive, SAFETY.grok, 'Heat 2\n', 'Grok Imagine'], "Nova's image prompt at heat 2")
    checkIncludes(novaAt2.story, [`Intensity: ${heatDescription(2)}`], "Nova's story prompt at heat 2")
    await center(page.getByRole('region', { name: 'Image prompt', exact: true }))
    await screenshot(page, shot('debug-image-preview'))
    await setHeat(page, 4, 'Explicit')
    const at4 = await livePreview(page, 'Nova Castellanos')
    check(at4.image !== novaAt2.image && at4.story !== novaAt2.story, 'heat 4 changed nothing')
    checkIncludes(at4.image, ['adult woman, 28 years old', SAFETY.positive, 'Heat 4\n', 'explicit adult intimacy between consenting adults'], "Nova's image prompt at heat 4")
    checkIncludes(at4.story, [`Intensity: ${heatDescription(4)}`], "Nova's story prompt at heat 4")
  }, page)

  await step("Priya's ace gate: at heat 4 her prompts stay at 2 until her trust is over 60, then both change", async () => {
    const gated = await livePreview(page, 'Priya Raman')
    checkIncludes(gated.image, ['adult woman, 30 years old', 'Heat 4, painted at 2 (their pace)', SAFETY.positive], "Priya's gated image prompt")
    check(!gated.image.includes('birthmark'), 'her body notes are in the gated image prompt')
    checkIncludes(gated.story, [`Intensity: ${heatDescription(2)}`, 'Demisexual'], "Priya's gated story prompt")
    // Raise her trust to 70 through a save import (the painted art stays: the export has no images).
    const save = await exportSaveFile(page, dir, 'before-trust.json')
    save.relationships = save.relationships.map((r) => (r.characterId === 'priya' ? { ...r, trust: 70 } : r))
    await importSaveFile(page, dir, 'priya-trust.json', save)
    const open = await livePreview(page, 'Priya Raman')
    checkIncludes(open.image, ['adult woman, 30 years old', 'Heat 4\n', 'birthmark on her collarbone', SAFETY.positive], "Priya's image prompt past her gate")
    checkIncludes(open.story, [`Intensity: ${heatDescription(4)}`], "Priya's story prompt past her gate")
    check(open.image !== gated.image && open.story !== gated.story, "her gate didn't change the prompts")
    await center(page.getByRole('region', { name: 'Image prompt', exact: true }))
    await screenshot(page, shot('debug-image-preview-priya'))
    // Her painted tier 2 survived the import.
    const tiers = await openGallery(page, 'priya')
    await tiers.getByRole('button', { name: `Tier 2: ${TITLES.priya[1]}` }).locator('figure[data-source="generated"] img').waitFor()
  }, page)

  await step('360x800: the Phase 5 screens still fit', async () => {
    await page.setViewportSize(SMALL_PHONE)
    const s = (name) => `p5-360-${name}`
    await goHash(page, novaRecap)
    await unlockedPanel(page).waitFor()
    await center(films(page).first())
    await screenshot(page, s('recap-print'))
    await checkTouchScreen(page, '360 recap', { full: true, shot: s('recap') })
    await goHash(page, '#/gallery')
    await page.getByRole('button', { name: /^Nova Castellanos/ }).waitFor()
    await checkTouchScreen(page, '360 gallery', { full: true, shot: s('gallery') })
    await openGallery(page, 'priya')
    await checkTouchScreen(page, '360 gallery priya', { full: true, shot: s('gallery-priya') })
    const viewer = await openTier(page, 'priya', 2)
    await viewer.getByText('Generated', { exact: true }).waitFor()
    await sleep(200)
    await screenshot(page, s('viewer'))
    await checkDialogTargets(page, viewer, '360 viewer')
    await press(viewer.getByRole('button', { name: 'Regenerate' }))
    await viewer.getByRole('region', { name: 'Compare the new picture with the current one' }).waitFor({ timeout: 30_000 })
    await sleep(200)
    await screenshot(page, s('regenerate-compare'))
    await checkDialogTargets(page, viewer, '360 regenerate compare')
    await press(viewer.getByRole('button', { name: 'Keep current' }))
    await closeViewer(page, viewer)
    const section = await openImageSettings(page)
    await section.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await sleep(150)
    await screenshot(page, s('settings-images'))
    await checkTouchScreen(page, '360 settings', { shot: s('settings-top') })
  }, page)

  await step('android: no uncaught page errors', async () => {
    const bad = pageErrors(page)
    check(!bad.length, bad.map((e) => `${e.kind}: ${e.text}`).join('\n'))
  }, page)

  await context.close()
}

// ---------------------------------------------------------------------------
// Desktop

async function desktopFlow(browser, app, mock, dir) {
  const { context, page } = await newPage(browser, 'desktop', { reducedMotion: 'no-preference' })
  const shot = (name) => `p5-desktop-${name}`
  let base

  await step('desktop: onboarding, the mock, a seed with image generation on (Automatic1111 at the mock)', async () => {
    base = await prepare(page, app, mock, dir)
    await importSaveFile(
      page,
      dir,
      'seed-desktop.json',
      seededSave(base, { rels: seedDesktop(), settings: { orientationMode: 'realistic', heat: 2, image: { enabled: true, provider: 'a1111', baseUrl: mock.origin } } }),
    )
  }, page)

  await step('desktop: Nova crosses 60, and the recap waits for the painting, then develops it', async () => {
    await mockRequests(mock, { reset: true })
    await startDate(page, 'nova', 'Record store', 'Rare vinyl')
    await sendLine(page, 'Put on something you love.')
    await endDate(page)
    const film = films(page).first()
    await film.waitFor()
    await film.locator('img').waitFor({ timeout: 30_000 })
    await photographReveal(page, film, shot('recap-reveal'))
    await checkDesign(page, 'desktop recap')
    const counts = await mockRequests(mock)
    check(counts['POST /sdapi/v1/txt2img'] === 1, `txt2img was called ${counts['POST /sdapi/v1/txt2img'] ?? 0} times`)
  }, page)

  await step('desktop: the gallery, Nova, the viewer and a Regenerate comparison', async () => {
    await goHash(page, '#/gallery')
    await page.getByRole('button', { name: /^Nova Castellanos/ }).waitFor()
    await sleep(200)
    await screenshot(page, shot('gallery'))
    await checkDesign(page, 'desktop gallery')
    const tiers = await openGallery(page, 'nova')
    await tiers.getByRole('button', { name: `Tier 3: ${TITLES.nova[2]}` }).locator('figure[data-source="generated"] img').waitFor()
    await sleep(200)
    await screenshot(page, shot('gallery-nova'))
    await checkDesign(page, 'desktop gallery nova')
    const viewer = await openTier(page, 'nova', 3)
    await viewer.getByText('Generated', { exact: true }).waitFor()
    await viewer.getByText('3 of 3').waitFor()
    // Arrow keys step through the pictures on a desktop.
    await page.keyboard.press('ArrowLeft')
    await page.getByRole('dialog', { name: `Nova Castellanos, ${TITLES.nova[1]}` }).getByText('2 of 3').waitFor()
    await page.keyboard.press('ArrowRight')
    const back = page.getByRole('dialog', { name: `Nova Castellanos, ${TITLES.nova[2]}` })
    await back.getByText('3 of 3').waitFor()
    await sleep(200)
    await screenshot(page, shot('viewer'))
    await checkDesign(page, 'desktop viewer')
    await press(back.getByRole('button', { name: 'Regenerate' }))
    await back.getByRole('region', { name: 'Compare the new picture with the current one' }).waitFor({ timeout: 30_000 })
    await sleep(200)
    await screenshot(page, shot('regenerate-compare'))
    await checkDesign(page, 'desktop regenerate compare')
    // Escape steps out of the comparison first, then closes the viewer.
    await page.keyboard.press('Escape')
    await back.getByRole('region', { name: 'Compare the new picture with the current one' }).waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    await back.waitFor({ state: 'detached' })
  }, page)

  await step('desktop: Settings, Image generation', async () => {
    const section = await openImageSettings(page)
    await testImages(page, section)
    await section.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await sleep(150)
    await screenshot(page, shot('settings-images'))
    await screenshot(page, shot('settings-full'), { fullPage: true })
    await checkDesign(page, 'desktop settings')
  }, page)

  await step('desktop: no uncaught page errors', async () => {
    const bad = pageErrors(page)
    check(!bad.length, bad.map((e) => `${e.kind}: ${e.text}`).join('\n'))
  }, page)

  await context.close()
}

await main(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crushlab-p5-'))
  const mock = await startMock({ env: { MOCK_IMAGE_DELAY: '600' } })
  log(`Mock model and image server on ${mock.origin}`)
  log('Starting the vite dev server (the xAI override and pinned rolls are dev-only)')
  const app = await startDev()
  log(`App on ${app.origin}`)
  const browser = await launchBrowser()
  if (runs('android')) await androidFlow(browser, app, mock, dir)
  if (runs('desktop')) await desktopFlow(browser, app, mock, dir)
})
