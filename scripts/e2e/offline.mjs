// PWA and offline shell (docs/SPEC.md, Phase 6: "The PWA installs and the shell works offline;
// only model calls need a connection").
//
// Builds the app, serves it with vite preview, and as Chrome on a Pixel 7:
//   1. checks the install assets (manifest: standalone, theme, 192/512/maskable icons),
//   2. visits once and waits for the service worker to finish precaching,
//   3. goes offline (context.setOffline) and reloads: the 18+ gate renders with its fonts,
//   4. onboards offline and reloads on the hub, Settings and the character sets,
//   5. tests a model connection offline: it fails with a message that says the device is offline,
//   6. back online, a new sw.js raises "A new version is ready." and Reload switches to it.
//
// Run: node scripts/e2e/offline.mjs (E2E_SKIP_BUILD=1 reuses dist/). Screenshots offline-*.png.

import { copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  check,
  checkTouchScreen,
  dismissToasts,
  goHash,
  launchBrowser,
  log,
  main,
  newPage,
  onCleanup,
  PIXEL_7,
  press,
  quickOnboard,
  ROOT,
  screenshot,
  startApp,
  step,
  waitForHash,
} from './lib.mjs'

/** Same-origin requests that failed (the offline shell must not need any). */
function watchFailures(page, origin) {
  const failed = []
  page.on('requestfailed', (req) => {
    if (req.url().startsWith(origin)) failed.push(`${req.method()} ${req.url().slice(origin.length)}`)
  })
  return failed
}

await main(async () => {
  if (process.env.E2E_DEV === '1') throw new Error('offline.mjs needs the production build (no E2E_DEV)')
  const app = await startApp()
  const origin = app.origin
  const browser = await launchBrowser()
  const { context, page } = await newPage(browser, PIXEL_7.viewport, PIXEL_7)
  const failed = watchFailures(page, origin)

  await step('install assets: manifest and icons', async () => {
    const res = await page.request.get(`${origin}/manifest.webmanifest`)
    check(res.ok(), `manifest.webmanifest: HTTP ${res.status()}`)
    const m = await res.json()
    check(m.display === 'standalone', `manifest display is ${m.display}`)
    check(m.name === 'crushLAB' && m.short_name === 'crushLAB', 'manifest name')
    check(/^#2a0f1f$/i.test(m.theme_color) && /^#2a0f1f$/i.test(m.background_color), 'manifest colors are not velvet')
    const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`)
    for (const want of ['192x192:any', '512x512:any', '512x512:maskable']) {
      check(sizes.includes(want), `manifest has no ${want} icon (${sizes.join(', ')})`)
    }
    for (const icon of m.icons) {
      const r = await page.request.get(`${origin}/${icon.src}`)
      check(r.ok() && (r.headers()['content-type'] ?? '').startsWith('image/png'), `${icon.src} is not a PNG`)
    }
  })

  await step('first visit: the service worker precaches the shell', async () => {
    await page.goto(`${origin}/`)
    await waitForHash(page, '#/gate')
    const html = await page.content()
    check(html.includes('rel="manifest"'), 'index.html does not link the manifest')
    const entries = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      // Wait for the worker to be active (install = precache done).
      if (reg.active?.state !== 'activated') {
        await new Promise((resolve) => {
          const w = reg.active ?? reg.waiting ?? reg.installing
          w?.addEventListener('statechange', () => w.state === 'activated' && resolve())
          setTimeout(resolve, 20_000)
        })
      }
      const names = await caches.keys()
      let n = 0
      for (const name of names) n += (await (await caches.open(name)).keys()).length
      return { names, n, scope: reg.scope }
    })
    log(`     service worker scope ${entries.scope}, ${entries.n} cached files in ${entries.names.join(', ')}`)
    check(entries.n > 20, `only ${entries.n} files were precached`)
    const cached = await page.evaluate(async () => {
      const urls = []
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname)
      }
      return urls
    })
    for (const want of [/index\.html/, /\.js$/, /\.css$/, /figtree.*\.woff2$/, /bodoni-moda-latin-600-italic.*\.woff2$/, /icon-192\.png/]) {
      check(cached.some((u) => want.test(u)), `nothing precached matches ${want}`)
    }
    check(!cached.some((u) => /\/art\//.test(u)), 'bundled tier art was precached')
  }, page)

  await step('offline reload: the gate renders with its fonts', async () => {
    await context.setOffline(true)
    await page.reload()
    await waitForHash(page, '#/gate')
    await page.getByRole('button', { name: "I'm 18 or older" }).waitFor()
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([
        document.fonts.load('italic 600 24px "Bodoni Moda"'),
        document.fonts.load('500 16px "Figtree Variable"'),
      ])
      return {
        bodoni: document.fonts.check('italic 600 24px "Bodoni Moda"'),
        figtree: document.fonts.check('500 16px "Figtree Variable"'),
        online: navigator.onLine,
        controlled: !!navigator.serviceWorker.controller,
      }
    })
    check(!fonts.online, 'navigator.onLine is still true')
    check(fonts.controlled, 'the service worker does not control the page')
    check(fonts.bodoni && fonts.figtree, `fonts missing offline: ${JSON.stringify(fonts)}`)
    await checkTouchScreen(page, 'offline-gate')
  }, page)

  await step('offline: onboarding, then the hub survives a reload', async () => {
    await quickOnboard(page, origin, { name: 'Remy' })
    await page.reload()
    await waitForHash(page, '#/hub')
    await page.getByRole('heading', { name: /Remy/ }).waitFor()
    await checkTouchScreen(page, 'offline-hub', { full: true })
  }, page)

  await step('offline: Settings and Character sets open from the cache', async () => {
    await goHash(page, '#/settings')
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
    await page.reload()
    await waitForHash(page, '#/hub')
    await goHash(page, '#/sets')
    await page.getByRole('heading', { name: 'Character sets' }).waitFor()
    await page.getByRole('heading', { name: 'Afterhours' }).waitFor()
    await checkTouchScreen(page, 'offline-sets')
  }, page)

  await step('offline: a model call fails with an offline message', async () => {
    await goHash(page, '#/connection-setup')
    await page.getByRole('heading', { name: 'Connect a model' }).waitFor()
    const key = page.getByLabel('Claude API key')
    if (!(await key.isVisible())) await press(page.getByRole('button', { name: /^Claude/ }).first())
    await key.fill('sk-ant-offline-test')
    await press(page.getByRole('button', { name: 'Test connection to Claude' }))
    const note = page.getByText(/offline/i).first()
    await note.waitFor({ timeout: 30_000 })
    log(`     "${(await note.innerText()).trim()}"`)
    await screenshot(page, 'offline-model-call')
  }, page)

  const shellFailures = failed.filter((f) => !/\/(llm|img)\//.test(f))
  check(!shellFailures.length, `same-origin requests failed offline: ${shellFailures.join(', ')}`)

  await step('online again: a new version raises "A new version is ready." and Reload switches', async () => {
    await context.setOffline(false)
    await goHash(page, '#/hub')
    await dismissToasts(page)
    // A changed sw.js is a new version for the browser. Restore the original afterwards.
    const swPath = path.join(ROOT, 'dist', 'sw.js')
    const backup = `${swPath}.e2e-backup`
    await copyFile(swPath, backup)
    onCleanup(() => copyFile(backup, swPath))
    await writeFile(swPath, `${await readFile(swPath, 'utf8')}\n// e2e ${Date.now()}\n`)
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update())
    await page.getByText('A new version is ready.').waitFor({ timeout: 30_000 })
    await screenshot(page, 'offline-update-toast')
    const before = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)
    await Promise.all([
      page.waitForEvent('load', { timeout: 20_000 }),
      press(page.getByRole('button', { name: 'Reload', exact: true })),
    ])
    await waitForHash(page, '#/hub')
    const after = await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      const reg = await navigator.serviceWorker.getRegistration()
      return { waiting: !!reg?.waiting, controller: navigator.serviceWorker.controller?.scriptURL }
    })
    check(!after.waiting, 'the new worker is still waiting after Reload')
    check(!!after.controller && !!before, 'no worker controls the page after Reload')
    await copyFile(backup, swPath)
  }, page)
})
