#!/usr/bin/env node
// Phase 1 acceptance: the player profile persists and shows up in the assembled story prompt.
//
//   npm run e2e:phase1        (builds, then serves dist/ with vite preview)
//
// Flow, at 390x844 and again at 1280x800, each from empty storage:
//   gate (confirm 18+) -> onboarding (Sam, nonbinary, they/them, body notes, polyamorous)
//   -> the quiet check fails (nothing on :11434) -> connection setup pointed at the mock
//   -> Test connection lists the mock's models -> pick the story model -> hub
//   -> Settings: heat 4 -> long-press the version -> Debug shows a story prompt with the profile
//   and the heat 4 (Explicit) description -> reload -> still there.
// Also: hash navigation can't skip the gate or onboarding, and a server without CORS headers is
// diagnosed as CORS (not as unreachable).

import { heatDescription } from '../../src/data/heat.ts'
import {
  check,
  checkDesign,
  checkIncludes,
  hashOf,
  launchBrowser,
  log,
  longPress,
  main,
  newPage,
  screenshot,
  sleep,
  startApp,
  startMock,
  step,
  waitForHash,
} from './lib.mjs'

const PROFILE = {
  name: 'Sam',
  gender: 'nonbinary',
  pronouns: 'they/them',
  bodyNotes: 'Broad shoulders, freckles everywhere, a scar across one knee',
  style: 'Polyamorous',
}
const HEAT = 4
const HEAT_TEXT = heatDescription(HEAT)

/** Text of the story prompt on the debug panel's Prompts tab. */
async function storyPromptText(page) {
  const section = page.getByRole('region', { name: 'Story prompt' })
  await section.waitFor()
  return section.locator('pre').innerText()
}

function checkStoryPrompt(text, where) {
  checkIncludes(
    text,
    [
      'You are the story engine of crushLAB',
      `${PROFILE.name}, ${PROFILE.gender}, ${PROFILE.pronouns}.`,
      PROFILE.bodyNotes,
      `Intensity: ${HEAT_TEXT}`,
    ],
    `${where} story prompt`,
  )
  check(!/\{[a-zA-Z]+\}/.test(text.replace(/\{"[^}]*\}/g, '')), `${where} story prompt has an unfilled {placeholder}`)
}

/** The full first-launch flow in a fresh context. */
async function firstLaunch(browser, app, mock, viewport, { cors } = {}) {
  const tag = viewport
  const { context, page } = await newPage(browser, viewport)
  const shot = (name, opts) => screenshot(page, `${tag}-${name}`, opts)
  const at = (name) => `${tag} ${name}`

  await step(at('gate shows on first launch'), async () => {
    await page.goto(`${app.origin}/`)
    await page.getByRole('button', { name: "I'm 18 or older" }).waitFor()
    await waitForHash(page, '#/gate')
    await checkDesign(page, at('gate'))
    await shot('01-gate', { fullPage: true })
  }, page)

  await step(at('confirming the gate opens onboarding'), async () => {
    await page.getByRole('button', { name: "I'm 18 or older" }).click()
    await waitForHash(page, '#/onboarding')
    await page.getByRole('heading', { name: "Who's walking in tonight?" }).waitFor()
  }, page)

  await step(at('fill the player profile'), async () => {
    await page.getByLabel('Name', { exact: true }).fill(PROFILE.name)
    await page
      .getByRole('radiogroup', { name: 'Gender' })
      .getByRole('radio', { name: 'Nonbinary' })
      .click()
    await page.getByLabel('Pronouns', { exact: true }).fill(PROFILE.pronouns)
    await page.getByLabel(/^Body notes/).fill(PROFILE.bodyNotes)
    await page
      .getByRole('radiogroup', { name: 'How you date' })
      .getByRole('radio', { name: PROFILE.style })
      .click()
    const checked = await page
      .getByRole('radiogroup', { name: 'How you date' })
      .getByRole('radio', { name: PROFILE.style })
      .getAttribute('aria-checked')
    check(checked === 'true', 'Polyamorous is not selected')
    await checkDesign(page, at('onboarding'))
    await shot('02-onboarding', { fullPage: true })
  }, page)

  await step(at('save: the quiet check fails and connection setup opens'), async () => {
    await page.getByRole('button', { name: 'Save and continue' }).click()
    await waitForHash(page, '#/connection-setup', 45_000)
    await page.getByRole('heading', { name: 'Connect a model' }).waitFor()
    // The failed check says what went wrong.
    await page.getByRole('status').filter({ hasText: /Pick where your model runs/ }).waitFor()
  }, page)

  await step(at('point the connection at the mock and test it'), async () => {
    await page
      .getByRole('radiogroup', { name: 'Where your model runs' })
      .getByRole('radio', { name: /^Custom/ })
      .click()
    await page.getByLabel('Base URL').fill(mock.baseUrl)
    await page.getByRole('button', { name: 'Test connection' }).click()
    await page.getByText('The server answered and 2 models are available.').waitFor({ timeout: 20_000 })
    const story = page.getByLabel('Story model')
    const options = await story.locator('option').allInnerTexts()
    checkIncludes(options.join('\n'), ['mock-story', 'mock-judge'], 'story model list')
    await story.selectOption('mock-story')
    await page.getByLabel('Judge model').selectOption('mock-judge')
    check((await story.inputValue()) === 'mock-story', 'story model not selected')
    await checkDesign(page, at('connection setup'))
    await shot('03-connection-setup', { fullPage: true })
  }, page)

  await step(at('continue to the hub, which sees the mock'), async () => {
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await waitForHash(page, '#/hub')
    await page.getByRole('heading', { name: new RegExp(`${PROFILE.name}`) }).waitFor()
    await page.getByText(`Connected to Custom at 127.0.0.1:${mock.port}`).waitFor({ timeout: 15_000 })
    await page.getByText('Story model: mock-story.').waitFor()
    await checkDesign(page, at('hub'))
    await shot('04-hub', { fullPage: true })
  }, page)

  await step(at('settings: set heat to 4'), async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
    await waitForHash(page, '#/settings')
    const pip = page.getByRole('radio', { name: `${HEAT}, Explicit` })
    await pip.click()
    check((await pip.getAttribute('aria-checked')) === 'true', 'heat 4 is not selected')
    await page.getByText(HEAT_TEXT.replace(/^Explicit: f/, 'F')).first().waitFor()
    // The profile form in Settings shows what onboarding saved.
    check((await page.locator('#settings-profile-name').inputValue()) === PROFILE.name, 'Settings profile name is not Sam')
    await checkDesign(page, at('settings'))
    await shot('05-settings')
    await shot('05-settings-full', { fullPage: true })
  }, page)

  await step(at('a short tap on the version does nothing'), async () => {
    const version = page.getByRole('button', { name: /crushLAB version/ })
    await version.scrollIntoViewIfNeeded()
    await version.click()
    await sleep(800)
    check((await hashOf(page)) === '#/settings', 'a short tap opened something')
  }, page)

  await step(at('long-press the version: debug panel'), async () => {
    await longPress(page, page.getByRole('button', { name: /crushLAB version/ }))
    await waitForHash(page, '#/debug')
    await page.getByRole('heading', { name: 'Debug panel' }).waitFor()
  }, page)

  await step(at('debug story prompt carries the profile and heat 4'), async () => {
    const text = await storyPromptText(page)
    checkStoryPrompt(text, at('debug'))
    await checkDesign(page, at('debug'))
    await shot('06-debug')
    await shot('06-debug-full', { fullPage: true })
  }, page)

  await step(at('reload: profile and heat survive'), async () => {
    await page.reload()
    await waitForHash(page, '#/debug')
    const text = await storyPromptText(page)
    checkStoryPrompt(text, at('reloaded debug'))
    await page.getByRole('tab', { name: 'State' }).click()
    const state = await page.getByText('"name": "Sam"').count()
    check(state > 0, 'State tab does not show the stored profile')
  }, page)

  if (cors) {
    await step(at('a server without CORS headers is diagnosed as CORS'), async () => {
      await page.getByRole('button', { name: 'Back' }).click()
      await waitForHash(page, '#/hub')
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
      await waitForHash(page, '#/settings')
      const url = page.locator('#settings-conn-baseurl')
      await url.fill(cors.baseUrl)
      await page.getByRole('button', { name: 'Test connection' }).click()
      const alert = page.getByRole('alert').filter({ hasText: 'blocks requests from this page (CORS)' })
      await alert.waitFor({ timeout: 20_000 })
      await alert.scrollIntoViewIfNeeded()
      await shot('07-connection-cors')
      // Put the working server back.
      await url.fill(mock.baseUrl)
      await page.getByRole('button', { name: 'Test connection' }).click()
      await page.getByText('The server answered and 2 models are available.').waitFor({ timeout: 20_000 })
    }, page)
  }

  await step(at('no uncaught page errors'), async () => {
    const bad = page.errors.filter(
      (e) =>
        e.kind === 'pageerror' ||
        // Failed fetches to the servers that are down on purpose are expected noise.
        !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED|CORS policy|net::/.test(e.text),
    )
    check(!bad.length, bad.map((e) => `${e.kind}: ${e.text}`).join('\n'))
  }, page)

  await context.close()
}

/** Hash navigation can't skip the gate, and can't skip onboarding either. */
async function hashCannotSkipGate(browser, app) {
  const { context, page } = await newPage(browser, 'phone')

  for (const hash of ['#/hub', '#/debug', '#/settings']) {
    await step(`${hash} before the gate still shows the gate`, async () => {
      await page.goto(`${app.origin}/${hash}`)
      await page.getByRole('button', { name: "I'm 18 or older" }).waitFor()
      await waitForHash(page, '#/gate')
    }, page)
  }

  await step('#/hub before a profile exists shows onboarding', async () => {
    await page.getByRole('button', { name: "I'm 18 or older" }).click()
    await waitForHash(page, '#/onboarding')
    await page.goto(`${app.origin}/#/hub`)
    await page.getByRole('heading', { name: "Who's walking in tonight?" }).waitFor()
    await waitForHash(page, '#/onboarding')
  }, page)

  await step('changing the hash in place to #/hub keeps onboarding', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/hub'
    })
    await sleep(300)
    await page.getByRole('heading', { name: "Who's walking in tonight?" }).waitFor()
    await waitForHash(page, '#/onboarding')
  }, page)

  await context.close()
}

await main(async () => {
  const mock = await startMock()
  log(`Mock model server on ${mock.baseUrl}`)
  const noCors = await startMock({ env: { MOCK_NO_CORS: '1' }, name: 'mock-llm (no CORS)' })
  log(`Mock without CORS on ${noCors.baseUrl}`)
  const app = await startApp()
  log(`App on ${app.origin}`)
  const browser = await launchBrowser()

  await hashCannotSkipGate(browser, app)
  await firstLaunch(browser, app, mock, 'phone')
  await firstLaunch(browser, app, mock, 'desktop', { cors: noCors })
})
