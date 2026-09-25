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
import { mkdir } from 'node:fs/promises'
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
