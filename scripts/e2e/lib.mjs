// Shared helpers for the playwright-core smoke scripts in scripts/e2e/.
//
// They start the mock model server and the built app (vite preview) on free ports, launch the
// preinstalled Chromium, and write screenshots to scripts/e2e/out/ (git-ignored).
//
// Env:
//   E2E_SKIP_BUILD=1   reuse dist/ instead of running `npm run build` first
//   E2E_DEV=1          serve with the vite dev server instead of vite preview (implies no build)
//   E2E_HEADED=1       show the browser window
//   CHROMIUM_PATH=...  another Chromium binary (default /opt/pw-browsers/chromium)

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const OUT_DIR = path.join(ROOT, 'scripts', 'e2e', 'out')
export const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

/** The two sizes every screen is checked and photographed at. */
export const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
}

// ---------------------------------------------------------------------------
// Logging and assertions

const started = Date.now()
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s`

export function log(...args) {
  console.log(stamp(), ...args)
}

export class CheckError extends Error {}

/** Throw unless `cond` holds. */
export function check(cond, message) {
  if (!cond) throw new CheckError(message)
}

/** Throw unless `text` contains every one of `needles`. */
export function checkIncludes(text, needles, what = 'text') {
  const missing = needles.filter((n) => !String(text).includes(n))
  check(!missing.length, `${what} is missing ${missing.map((m) => JSON.stringify(m)).join(', ')}`)
}

let stepCount = 0
let passCount = 0

/**
 * Run one named step. On failure it saves a screenshot of `page` (when given) as
 * `fail-<n>-<name>.png` and rethrows.
 */
export async function step(name, fn, page) {
  stepCount += 1
  const n = stepCount
  const t0 = Date.now()
  try {
    const out = await fn()
    passCount += 1
    log(`ok   ${n}. ${name} (${Date.now() - t0} ms)`)
    return out
  } catch (e) {
    log(`FAIL ${n}. ${name}: ${e instanceof Error ? e.message : e}`)
    if (page && !page.isClosed()) {
      await screenshot(page, `fail-${n}-${slug(name)}`, { fullPage: true }).catch(() => {})
    }
    throw e
  }
}

export function stepCounts() {
  return { steps: stepCount, passed: passCount }
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

// ---------------------------------------------------------------------------
// Processes

const cleanups = []

/** Register something to undo when the run ends (last registered runs first). */
export function onCleanup(fn) {
  cleanups.push(fn)
}

export async function cleanup() {
  while (cleanups.length) {
    const fn = cleanups.pop()
    try {
      await fn()
    } catch {
      // Keep tearing down the rest.
    }
  }
}

/** A free TCP port on 127.0.0.1. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

/**
 * Spawn a long-running child process in its own process group, and kill the whole group on
 * cleanup. Output is kept (last 200 lines) for error messages; set `echo` to stream it.
 */
export function startProcess(cmd, args, { env = {}, cwd = ROOT, name = cmd, echo = false } = {}) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const lines = []
  const listeners = new Set()
  const onData = (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (!line) continue
      lines.push(line)
      if (lines.length > 200) lines.shift()
      if (echo) console.log(`[${name}] ${line}`)
      for (const l of listeners) l(line)
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  let exited = false
  const exit = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      exited = true
      resolve({ code, signal })
    })
  })

  const stop = async () => {
    if (exited) return
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }, 3000)
    await exit
    clearTimeout(timer)
  }
  onCleanup(stop)

  /** Resolve when a line matches, reject if the process exits or the timeout passes. */
  const waitForLine = (re, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      const hit = lines.find((l) => re.test(l))
      if (hit) return resolve(hit)
      const timer = setTimeout(() => {
        listeners.delete(onLine)
        reject(new Error(`${name} did not print ${re} within ${timeoutMs} ms.\n${lines.join('\n')}`))
      }, timeoutMs)
      const onLine = (line) => {
        if (re.test(line)) {
          clearTimeout(timer)
          listeners.delete(onLine)
          resolve(line)
        }
      }
      listeners.add(onLine)
      void exit.then(({ code }) => {
        clearTimeout(timer)
        listeners.delete(onLine)
        reject(new Error(`${name} exited (code ${code}) before printing ${re}.\n${lines.join('\n')}`))
      })
    })

  return { child, lines, stop, exit, waitForLine, get exited() { return exited } }
}

/** Run a command to completion; rejects on a non-zero exit. */
export function run(cmd, args, { env = {}, cwd = ROOT, name = cmd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${name} exited with code ${code}`))
    })
  })
}

/** Poll a URL until it answers 2xx. */
export async function waitForHttp(url, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < until) {
    try {
      const res = await fetch(url)
      if (res.ok) return
      last = `HTTP ${res.status}`
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    await sleep(200)
  }
  throw new Error(`${url} did not answer within ${timeoutMs} ms (${last})`)
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Start scripts/mock-llm.mjs on a free port (bound to 127.0.0.1).
 * `env` passes mock toggles, e.g. { MOCK_NO_CORS: '1' }.
 */
export async function startMock({ env = {}, name = 'mock-llm', echo = false } = {}) {
  const port = await freePort()
  const proc = startProcess(process.execPath, [path.join(ROOT, 'scripts', 'mock-llm.mjs')], {
    name,
    echo,
    env: { PORT: String(port), HOST: '127.0.0.1', MOCK_DELAY: '1', MOCK_QUIET: '1', ...env },
  })
  await proc.waitForLine(/listening on/)
  const origin = `http://127.0.0.1:${port}`
  return { ...proc, port, origin, baseUrl: `${origin}/v1` }
}

/** `npm run build` (tsc -b && vite build), unless E2E_SKIP_BUILD=1 and dist/ exists. */
export async function buildApp() {
  if (process.env.E2E_SKIP_BUILD === '1' && existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    log('Reusing dist/ (E2E_SKIP_BUILD=1)')
    return
  }
  log('Building the app')
  await run('npm', ['run', 'build', '--silent'], { name: 'npm run build' })
}

/** `vite preview --port <p> --strictPort` on 127.0.0.1. Build first (see buildApp). */
export async function startPreview({ port } = {}) {
  const p = port ?? (await freePort())
  const proc = startProcess(
    process.execPath,
    [VITE_BIN, 'preview', '--port', String(p), '--strictPort', '--host', '127.0.0.1'],
    { name: 'vite preview' },
  )
  const origin = `http://127.0.0.1:${p}`
  await waitForHttp(`${origin}/`)
  return { ...proc, port: p, origin }
}

/** The vite dev server on a free port (no build needed). */
export async function startDev({ port } = {}) {
  const p = port ?? (await freePort())
  const proc = startProcess(
    process.execPath,
    [VITE_BIN, '--port', String(p), '--strictPort', '--host', '127.0.0.1'],
    { name: 'vite dev' },
  )
  const origin = `http://127.0.0.1:${p}`
  await waitForHttp(`${origin}/`, 60_000)
  return { ...proc, port: p, origin }
}

/** Build and preview the app, or run the dev server when E2E_DEV=1. */
export async function startApp() {
  if (process.env.E2E_DEV === '1') {
    log('Starting the vite dev server')
    return startDev()
  }
  await buildApp()
  log('Starting vite preview')
  return startPreview()
}

// ---------------------------------------------------------------------------
// Browser

export async function launchBrowser() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: process.env.E2E_HEADED !== '1',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  onCleanup(() => browser.close())
  return browser
}

/**
 * A fresh browser context (empty storage) at a named viewport. The phone viewport emulates touch.
 * Page errors and console errors are collected on `page.errors`.
 */
export async function newPage(browser, viewport = 'phone', options = {}) {
  const size = typeof viewport === 'string' ? VIEWPORTS[viewport] : viewport
  const phone = size.width < 600
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    hasTouch: phone,
    isMobile: phone,
    reducedMotion: 'reduce',
    ...options,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const errors = []
  page.on('pageerror', (e) => errors.push({ kind: 'pageerror', text: e.message }))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ kind: 'console', text: m.text() })
  })
  page.errors = errors
  return { context, page }
}

/** Wait until location.hash equals `hash` (e.g. '#/hub'). */
export async function waitForHash(page, hash, timeout = 15_000) {
  try {
    await page.waitForFunction((h) => window.location.hash === h, hash, { timeout })
  } catch {
    const now = await page.evaluate(() => window.location.hash).catch(() => '?')
    throw new CheckError(`Expected ${hash}, still on ${now || '(no hash)'} after ${timeout} ms`)
  }
}

/** Wait until the URL matches a predicate or regex. */
export async function waitForUrl(page, test, timeout = 15_000) {
  await page.waitForURL(test, { timeout })
}

/** Current hash of the page. */
export function hashOf(page) {
  return page.evaluate(() => window.location.hash)
}

/** Save a PNG to scripts/e2e/out/<name>.png and return its path. */
export async function screenshot(page, name, { fullPage = false } = {}) {
  await mkdir(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `${name}.png`)
  // Let fonts and layout settle so the picture matches what a person sees.
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await page.screenshot({ path: file, fullPage, animations: 'disabled' })
  return file
}

/** Hold the pointer on an element for `ms` (a long press). */
export async function longPress(page, locator, ms = 900) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  check(box, 'Long-press target is not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await sleep(ms)
  await page.mouse.up()
}

/**
 * Design checks on the current screen: anything wider than the viewport (sideways scroll),
 * text-transform: uppercase, arrow glyphs on buttons, and middle-dot metadata strings.
 * Returns a list of problems (empty when clean).
 */
export function designProblems(page) {
  return page.evaluate(() => {
    const problems = []
    const vw = document.documentElement.clientWidth
    const describe = (el) => {
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/)[0] : ''
      const text = (el.textContent || '').trim().slice(0, 40)
      return `<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}> "${text}"`
    }
    const hidden = (el) => {
      const s = getComputedStyle(el)
      return s.display === 'none' || s.visibility === 'hidden' || el.closest('.visually-hidden')
    }
    // Inside a horizontal scroller (e.g. a chip strip) that itself fits: that's by design.
    const clipped = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') {
          const ar = a.getBoundingClientRect()
          return ar.right <= vw + 1 && ar.left >= -1
        }
      }
      return false
    }
    for (const el of document.body.querySelectorAll('*')) {
      if (hidden(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) {
        // Report the outermost offender only.
        const parent = el.parentElement
        const pr = parent?.getBoundingClientRect()
        if (!pr || (pr.right <= vw + 1 && pr.left >= -1)) {
          problems.push(`sideways overflow: ${describe(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}px`)
        }
      }
      if (getComputedStyle(el).textTransform === 'uppercase' && (el.textContent || '').trim()) {
        problems.push(`uppercase text: ${describe(el)}`)
      }
    }
    for (const b of document.querySelectorAll('button, [role="button"], a')) {
      if (/[←→↑↓⟵⟶➜➔›‹»«]/.test(b.textContent || '')) problems.push(`arrow on button: ${describe(b)}`)
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/\S\s·\s\S/.test(n.textContent || '')) problems.push(`middle-dot string: "${n.textContent.trim().slice(0, 60)}"`)
    }
    return [...new Set(problems)].slice(0, 20)
  })
}

/** Fail when the current screen breaks a design rule (see designProblems). */
export async function checkDesign(page, where) {
  const problems = await designProblems(page)
  check(!problems.length, `${where}: ${problems.join('; ')}`)
}

// ---------------------------------------------------------------------------
// Android (docs/ARCHITECTURE.md, "Android first")

/** Chrome on a Pixel 7 (reduced user agent, as Chrome sends it). Pass as newPage options. */
export const PIXEL_7 = {
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
}

/** A small Android phone. */
export const SMALL_PHONE = { width: 360, height: 800 }

/**
 * Minimum hit height for anything tappable. The design target is 48px, and that is what the
 * checks use; E2E_MIN_TAP=44 relaxes it to the hard floor.
 */
export const MIN_TAP = Number(process.env.E2E_MIN_TAP) || 48

/**
 * Measures every tappable thing on the screen and lists those whose hit area is under `min` px
 * tall. The hit area is measured with elementFromPoint along a vertical line through the element's
 * center, so a ::before that extends it counts, and so does a <label> wrapping a hidden native
 * input. Returns { checked, problems }.
 */
export function smallTargets(page, min = MIN_TAP) {
  return page.evaluate((min) => {
    const SELECTOR =
      'button, [role="button"], [role="radio"], [role="tab"], [role="switch"], [role="checkbox"], ' +
      '[role="menuitem"], [role="option"], a[href], select, textarea, summary, input:not([type="hidden"])'
    const describe = (el) => {
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim()
      return `<${el.tagName.toLowerCase()}${el.getAttribute('role') ? ` role=${el.getAttribute('role')}` : ''}> "${name.slice(0, 40)}"`
    }
    const visible = (el) => {
      if (el.closest('[aria-hidden="true"], [inert], .visually-hidden')) return false
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden') return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    const scroller = document.scrollingElement || document.documentElement
    const start = { x: scroller.scrollLeft, y: scroller.scrollTop }
    const problems = []
    let checked = 0
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (!visible(el)) continue
      // Inline links inside running text are exempt (WCAG 2.5.8); none are expected in the app.
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue
      // A native radio or checkbox hidden behind a styled label: the label is the target.
      let target = el
      if (el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type) && el.labels?.length) {
        target = el.labels[0]
      }
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      const r = target.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const labels = el.labels ? [...el.labels] : []
      const owns = (n) => !!n && (target.contains(n) || el.contains(n) || labels.some((l) => l.contains(n)))
      let height = r.height
      if (owns(document.elementFromPoint(x, y))) {
        let top = y
        let bottom = y
        while (top > y - 60 && owns(document.elementFromPoint(x, top - 1))) top -= 1
        while (bottom < y + 60 && owns(document.elementFromPoint(x, bottom + 1))) bottom += 1
        height = bottom - top + 1
      }
      checked += 1
      if (height < min) problems.push(`${describe(el)} is ${Math.round(height)}px tall`)
    }
    scroller.scrollTo(start.x, start.y)
    return { checked, problems }
  }, min)
}

/**
 * The Android screen check: waits for the lazy screen, screenshots it (`shot`, plus `shot`-full
 * when `full`), then fails on sideways scroll, a design-rule break or a touch target under
 * MIN_TAP.
 */
export async function checkTouchScreen(page, name, { full = false, shot = name } = {}) {
  // Screens are lazy-loaded behind a "One moment" placeholder; wait for the real one.
  await page.locator('main').first().waitFor()
  await page.getByText(/^(One moment|Opening the doors)$/).waitFor({ state: 'hidden' })
  // Toasts float over the bottom of the page for a few seconds and would hide what's under them
  // from the hit test; close them first (their own Dismiss button is checked by checkToastTargets).
  await dismissToasts(page)
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await page.evaluate(() => window.scrollTo(0, 0))
  await screenshot(page, shot)
  if (full) await screenshot(page, `${shot}-full`, { fullPage: true })
  // With mobile emulation Chrome does what a phone does with a too-wide page: it zooms out, and
  // innerWidth grows to the content width. So compare with clientWidth (the layout viewport, the
  // device width), and also require that innerWidth didn't grow.
  const { scrollWidth, clientWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }))
  check(
    scrollWidth <= clientWidth && innerWidth <= clientWidth,
    `${name}: the page scrolls sideways (scrollWidth ${scrollWidth}, innerWidth ${innerWidth}, device width ${clientWidth})`,
  )
  await checkDesign(page, name)
  const { checked, problems } = await smallTargets(page)
  check(checked > 0, `${name}: found nothing tappable to measure`)
  check(!problems.length, `${name}: touch targets under ${MIN_TAP}px: ${problems.join('; ')}`)
  log(`     ${name}: ${checked} touch targets, all at least ${MIN_TAP}px; no sideways scroll`)
}

/** Close every toast on screen with its Dismiss button. */
export async function dismissToasts(page) {
  for (let i = 0; i < 10; i++) {
    const button = page.getByRole('button', { name: 'Dismiss', exact: true }).first()
    if (!(await button.count())) return
    // A short timeout: a toast leaving on its own between count() and click() would otherwise
    // hold the click for the page's whole default timeout.
    await button.click({ timeout: 1500 }).catch(() => {})
    await sleep(50)
  }
}

/** Fail when a showing toast's Dismiss button can be hit over less than MIN_TAP px. */
export async function checkToastTargets(page) {
  const n = await page.getByRole('button', { name: 'Dismiss', exact: true }).count()
  check(n > 0, 'no toast is showing')
  const { problems } = await smallTargets(page)
  const bad = problems.filter((p) => p.includes('"Dismiss"'))
  check(!bad.length, `toast Dismiss under ${MIN_TAP}px: ${bad.join('; ')}`)
}

/** Press and hold with a finger (CDP touch events, so pointerType is 'touch' as on a phone). */
export async function touchLongPress(page, locator, ms = 900) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  check(box, 'Long-press target is not visible')
  const cdp = await page.context().newCDPSession(page)
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await sleep(ms)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

/** Tap on a touch page, click otherwise. */
export async function press(locator) {
  const touch = await locator.page().evaluate(() => navigator.maxTouchPoints > 0)
  if (touch) await locator.tap()
  else await locator.click()
}

/**
 * The shortest way from empty storage to the hub: confirm 18+, fill the profile (name, gender,
 * pronouns), save, and skip connection setup (the default Claude preset has no key, so the quiet
 * check fails at once). Leaves the page on #/hub.
 */
export async function quickOnboard(page, origin, { name = 'Ana', gender = 'Woman', pronouns = 'she/her' } = {}) {
  await page.goto(`${origin}/`)
  await press(page.getByRole('button', { name: "I'm 18 or older" }))
  await page.getByRole('heading', { name: "Who's walking in tonight?" }).waitFor()
  await page.getByLabel('Name', { exact: true }).fill(name)
  await press(page.getByRole('radiogroup', { name: 'Gender' }).getByRole('radio', { name: gender }))
  await page.getByLabel('Pronouns', { exact: true }).fill(pronouns)
  await press(page.getByRole('button', { name: 'Save and continue' }))
  await page.waitForFunction(() => ['#/connection-setup', '#/hub'].includes(window.location.hash), null, {
    timeout: 70_000,
  })
  if ((await hashOf(page)) === '#/connection-setup') {
    await press(page.getByRole('button', { name: 'Skip for now' }))
  }
  await waitForHash(page, '#/hub')
  await page.getByRole('heading', { name: new RegExp(name) }).waitFor()
}

/** Go to a screen by changing the hash in place (as a link would), and wait for it. */
export async function goHash(page, hash) {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
  await waitForHash(page, hash)
}

// ---------------------------------------------------------------------------
// The mock and seeded saves (scripts/e2e/phase5.mjs; phase4.mjs keeps its own copies)

/** Point the app at the mock: connection setup, Other providers, Custom, test, pick both models. */
export async function connectToMock(page, mock) {
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

/** Settings, Saves, Export save file: the save as JSON (saved as `dir/name`). */
export async function exportSaveFile(page, dir, name) {
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
export async function importSaveFile(page, dir, name, save) {
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

/** A relationship as the game stores it, with `patch` on top. */
export function seedRel(characterId, patch = {}) {
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

/**
 * An exported save with these relationships, a fresh game state (no dates on record) and
 * `settings` merged over its settings (one level deep for `image`).
 */
export function seededSave(base, { rels, settings = {} }) {
  const now = Date.now()
  const kv = base.kv
    .filter((r) => r.key !== 'game' && r.key !== 'activeDate')
    .map((r) =>
      r.key === 'settings'
        ? { key: 'settings', value: { ...r.value, ...settings, image: { ...r.value.image, ...(settings.image ?? {}) } } }
        : r,
    )
  kv.push({
    key: 'game',
    value: { startedAt: now - 10 * 86_400_000, news: [], rumors: [], metamours: {}, rekindled: [], endingsSeen: {} },
  })
  return { ...base, exportedAt: now, kv, relationships: rels, dates: [], customCharacters: [], packs: [] }
}

/**
 * Wrap a script's main function: runs it, tears everything down, prints a summary and sets the
 * exit code.
 */
export async function main(fn) {
  const stop = async (signal) => {
    log(`Received ${signal}, cleaning up`)
    await cleanup()
    process.exit(130)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  let code = 0
  try {
    await fn()
  } catch (e) {
    code = 1
    console.error(e instanceof CheckError ? `\nCheck failed: ${e.message}` : e)
  } finally {
    await cleanup()
  }
  const { steps, passed } = stepCounts()
  log(code === 0 ? `PASS: ${passed}/${steps} steps` : `FAILED: ${passed}/${steps} steps passed`)
  log(`Screenshots in ${path.relative(ROOT, OUT_DIR)}/`)
  process.exit(code)
}
