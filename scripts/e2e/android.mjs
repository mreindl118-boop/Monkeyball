#!/usr/bin/env node
// Android smoke test: the first-launch flow in Chrome for Android on an emulated Pixel 7.
//
//   npm run e2e:android       (builds, then serves dist/ with vite preview; E2E_SKIP_BUILD=1 reuses dist/)
//
// Android is the primary target (docs/ARCHITECTURE.md, "Android first"). This walks gate ->
// onboarding -> connection setup (pointed at the mock model server) -> hub -> Settings -> debug
// panel (opened by a real touch long-press) -> the gallery, with touch input at
// 412x915 and a 2.625 device pixel ratio, then revisits every screen at 360x800. On each screen:
//   - nothing scrolls sideways (scrollWidth fits the device width; see checkScreen),
//   - every button, radio, tab, switch, link and field can be hit over at least 48px of height
//     (hit-tested, so a small pill with a 48px ::before hit area passes),
//   - the design checks from lib.mjs (no uppercase, arrows on buttons or middle-dot strings),
//   - a screenshot: scripts/e2e/out/android-<screen>.png (and -full.png for long screens).
// Also checks the Android-facing HTML (viewport meta, theme color) and that every PWA manifest
// icon Chrome needs for "Install app" is served at its declared size.

import {
  check,
  checkTouchScreen,
  hashOf,
  launchBrowser,
  log,
  main,
  newPage,
  PIXEL_7,
  screenshot,
  SMALL_PHONE as SMALL,
  startApp,
  startMock,
  step,
  touchLongPress,
  waitForHash,
} from './lib.mjs'

const PROFILE = {
  name: 'Ana',
  pronouns: 'she/her',
  bodyNotes: 'Tall, dark curls, a tiny tattoo of a moth on one wrist',
}

// ---------------------------------------------------------------------------
// Checks

/** Overflow, touch targets and design rules on the current screen; then android-<name>.png. */
function checkScreen(page, name, { full = false } = {}) {
  return checkTouchScreen(page, name, { full, shot: `android-${name}` })
}

/** Width and height of a PNG from its header. */
function pngSize(buf) {
  const sig = buf.subarray(0, 8).toString('hex')
  if (sig !== '89504e470d0a1a0a') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

// ---------------------------------------------------------------------------
// Flow

async function androidFlow(browser, app, mock) {
  const { context, page } = await newPage(browser, PIXEL_7.viewport, PIXEL_7)

  await step('Chrome for Android emulation: touch, mobile user agent, Pixel 7 viewport', async () => {
    await page.goto(`${app.origin}/`)
    await page.getByRole('button', { name: "I'm 18 or older" }).waitFor()
    const env = await page.evaluate(() => ({
      ua: navigator.userAgent,
      touch: navigator.maxTouchPoints,
      w: window.innerWidth,
      dpr: window.devicePixelRatio,
      coarse: matchMedia('(pointer: coarse)').matches,
    }))
    check(/Android/.test(env.ua) && /Mobile/.test(env.ua), `user agent is not Chrome for Android: ${env.ua}`)
    check(env.touch > 0, 'no touch points: touch emulation is off')
    check(env.w === 412 && Math.abs(env.dpr - 2.625) < 0.01, `viewport ${env.w}px at ${env.dpr}x, expected 412px at 2.625x`)
    log(`     pointer: ${env.coarse ? 'coarse' : 'fine'}, ${env.touch} touch points`)
  }, page)

  await step('HTML is set up for Android (viewport, keyboard resize, theme color)', async () => {
    const meta = await page.evaluate(() => ({
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
      theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '',
    }))
    for (const part of ['width=device-width', 'viewport-fit=cover', 'interactive-widget=resizes-content']) {
      check(meta.viewport.includes(part), `viewport meta lacks ${part}: "${meta.viewport}"`)
    }
    check(meta.theme.toLowerCase() === '#2a0f1f', `theme-color is "${meta.theme}", expected velvet #2A0F1F`)
  }, page)

  await step('PWA install assets: manifest icons are served at their declared sizes', async () => {
    const links = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel="manifest"]')?.href ?? '',
      icons: [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.href),
    }))
    check(links.manifest, 'no <link rel="manifest"> (Chrome on Android offers Install app only with one)')
    const res = await fetch(links.manifest)
    check(res.ok, `manifest answered HTTP ${res.status}`)
    const manifest = await res.json()
    check(manifest.display === 'standalone', `manifest display is ${manifest.display}`)
    check(String(manifest.background_color).toLowerCase() === '#2a0f1f', `manifest background_color is ${manifest.background_color}`)
    const icons = manifest.icons ?? []
    for (const need of ['192x192', '512x512']) {
      check(icons.some((i) => i.sizes === need && (i.purpose ?? 'any').includes('any')), `manifest has no ${need} "any" icon`)
    }
    check(icons.some((i) => (i.purpose ?? '').includes('maskable')), 'manifest has no maskable icon')
    for (const icon of icons) {
      const url = new URL(icon.src, links.manifest).href
      const r = await fetch(url)
      check(r.ok, `${icon.src} answered HTTP ${r.status}`)
      const size = pngSize(Buffer.from(await r.arrayBuffer()))
      check(size && `${size.width}x${size.height}` === icon.sizes, `${icon.src} is ${size ? `${size.width}x${size.height}` : 'not a PNG'}, manifest says ${icon.sizes}`)
    }
    for (const href of links.icons) {
      const r = await fetch(href)
      check(r.ok, `${href} answered HTTP ${r.status}`)
    }
    log(`     ${icons.length} manifest icons and ${links.icons.length} page icons OK`)
  }, page)

  await step('gate', async () => {
    await waitForHash(page, '#/gate')
    await checkScreen(page, '01-gate')
  }, page)

  await step('tap the gate: onboarding', async () => {
    await page.getByRole('button', { name: "I'm 18 or older" }).tap()
    await waitForHash(page, '#/onboarding')
    await page.getByRole('heading', { name: "Who's walking in tonight?" }).waitFor()
    await checkScreen(page, '02-onboarding', { full: true })
  }, page)

  await step('fill the profile with touch', async () => {
    await page.getByLabel('Name', { exact: true }).tap()
    await page.getByLabel('Name', { exact: true }).fill(PROFILE.name)
    await page.getByRole('radiogroup', { name: 'Gender' }).getByRole('radio', { name: 'Woman' }).tap()
    await page.getByLabel('Pronouns', { exact: true }).fill(PROFILE.pronouns)
    await page.getByLabel(/^Body notes/).fill(PROFILE.bodyNotes)
    const style = page.getByRole('radiogroup', { name: 'How you date' }).getByRole('radio', { name: 'Monogamous' })
    await style.tap()
    check((await style.getAttribute('aria-checked')) === 'true', 'tapping Monogamous did not select it')
    await screenshot(page, 'android-02-onboarding-filled')
  }, page)

  await step('save: connection setup', async () => {
    await page.getByRole('button', { name: 'Save and continue' }).tap()
    await page.waitForFunction(() => ['#/connection-setup', '#/hub'].includes(window.location.hash), null, {
      timeout: 70_000,
    })
    if ((await hashOf(page)) === '#/hub') {
      // Something answers on localhost:11434 here, so the quiet check passed; open setup by hand.
      log('Something answers on localhost:11434; opening connection setup from the hub')
      await page.evaluate(() => {
        window.location.hash = '#/connection-setup'
      })
      await waitForHash(page, '#/connection-setup')
    }
    await page.getByRole('heading', { name: 'Connect a model' }).waitFor()
    await checkScreen(page, '03-connection-setup', { full: true })
  }, page)

  await step('connect to the mock model server', async () => {
    // Claude is the default provider; the mock is an OpenAI-compatible server under Other providers.
    await page.getByRole('button', { name: /^Other providers/ }).tap()
    await page.getByRole('button', { name: /^Custom/ }).tap()
    await page.locator('#setup-custom-baseurl').fill(mock.baseUrl)
    await page.getByRole('button', { name: 'Test connection to Custom' }).tap()
    await page.getByText('The server answered and 2 models are available.').waitFor({ timeout: 20_000 })
    // The onboarding check's problem banner goes once a test here succeeds.
    check(
      (await page.getByRole('status').filter({ hasText: /Set up a provider below/ }).count()) === 0,
      'the "needs an API key" banner is still up after a successful test',
    )
    // Claude has no key, so both roles moved to the tested provider.
    await page.getByRole('group', { name: 'Story model' }).getByLabel('Model').selectOption('mock-story')
    await page.getByRole('group', { name: 'Judge model' }).getByLabel('Model').selectOption('mock-judge')
    await checkScreen(page, '03-connection-tested', { full: true })
  }, page)

  await step('continue: hub', async () => {
    await page.getByRole('button', { name: 'Continue', exact: true }).tap()
    await waitForHash(page, '#/hub')
    await page.getByRole('heading', { name: new RegExp(PROFILE.name) }).waitFor()
    await page.getByText('Story model: mock-story.').waitFor({ timeout: 15_000 })
    await checkScreen(page, '04-hub', { full: true })
  }, page)

  await step('settings', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().tap()
    await waitForHash(page, '#/settings')
    await page.getByRole('button', { name: /crushLAB version/ }).waitFor()
    await checkScreen(page, '05-settings', { full: true })
  }, page)

  await step('touch long-press on the version: debug panel', async () => {
    await touchLongPress(page, page.getByRole('button', { name: /crushLAB version/ }))
    await waitForHash(page, '#/debug')
    await page.getByRole('heading', { name: 'Debug panel' }).waitFor()
    await checkScreen(page, '06-debug', { full: true })
  }, page)

  await step('the gallery (Phase 5)', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/gallery'
    })
    await waitForHash(page, '#/gallery')
    await page.getByRole('heading', { name: 'Gallery', level: 1 }).waitFor()
    await page.getByRole('button', { name: /^Nova Castellanos/ }).waitFor()
    await checkScreen(page, '07-gallery', { full: true })
  }, page)

  await step('360x800: every screen still fits', async () => {
    await page.setViewportSize(SMALL)
    for (const [hash, name, full] of [
      ['#/hub', '360-hub', true],
      ['#/settings', '360-settings', true],
      ['#/connection-setup', '360-connection-setup', true],
      ['#/debug', '360-debug', false],
      ['#/gallery', '360-gallery', true],
      ['#/gallery/nova', '360-gallery-nova', true],
    ]) {
      await page.evaluate((h) => {
        window.location.hash = h
      }, hash)
      await waitForHash(page, hash)
      await checkScreen(page, name, { full })
    }
  }, page)

  await step('no uncaught page errors', async () => {
    const bad = page.errors.filter(
      (e) =>
        e.kind === 'pageerror' ||
        // Failed fetches to servers that are down on purpose (the quiet check) are expected.
        !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED|CORS policy|net::/.test(e.text),
    )
    check(!bad.length, bad.map((e) => `${e.kind}: ${e.text}`).join('\n'))
  }, page)

  await context.close()
}

/** Gate and onboarding at 360x800 need empty storage: a second, fresh context. */
async function smallFirstLaunch(browser, app) {
  const { context, page } = await newPage(browser, SMALL, { ...PIXEL_7, viewport: SMALL })
  await step('360x800: gate and onboarding', async () => {
    await page.goto(`${app.origin}/`)
    await page.getByRole('button', { name: "I'm 18 or older" }).waitFor()
    await checkScreen(page, '360-gate')
    await page.getByRole('button', { name: "I'm 18 or older" }).tap()
    await page.getByRole('heading', { name: "Who's walking in tonight?" }).waitFor()
    await checkScreen(page, '360-onboarding', { full: true })
  }, page)
  await context.close()
}

await main(async () => {
  const mock = await startMock()
  log(`Mock model server on ${mock.baseUrl}`)
  const app = await startApp()
  log(`App on ${app.origin}`)
  const browser = await launchBrowser()

  await androidFlow(browser, app, mock)
  await smallFirstLaunch(browser, app)
})
