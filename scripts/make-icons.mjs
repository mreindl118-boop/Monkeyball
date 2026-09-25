#!/usr/bin/env node
// Draws the app icons (a lipstick kiss on velvet) into public/icons/. Run after changing the
// artwork:  node scripts/make-icons.mjs
// Writes icon.svg (favicon), icon-192.png, icon-512.png, icon-maskable-512.png and
// apple-touch-icon.png (180px). PNGs are rendered with the e2e Chromium (playwright-core).

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public', 'icons')
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'

const VELVET = '#2A0F1F'
const OXBLOOD = '#4A1530'
const LIPSTICK = '#E0245E'

// The Kiss print from src/ui/Kiss.tsx (viewBox 32x22).
const KISS = `
  <g fill="${LIPSTICK}" stroke="${LIPSTICK}" stroke-width="0.6" stroke-linejoin="round">
    <path d="M2.2 11.2C5 6.6 8.6 3.4 12 3.6c1.7.1 2.9 1.2 4 2.4 1.1-1.2 2.3-2.3 4-2.4 3.4-.2 7 3 9.8 7.6-3.6.2-6.8.2-9.8 0-1.4-.1-2.6-.1-4 .3-1.4-.4-2.6-.4-4-.3-3 .2-6.2.2-9.8 0Z"/>
    <path d="M2.6 12.2c3.4.9 6.6 1.1 9.4 1 1.5-.1 2.7-.3 4-.1 1.3-.2 2.5 0 4 .1 2.8.1 6-.1 9.4-1-2.6 4.4-7.4 7.2-13.4 7.2S5.2 16.6 2.6 12.2Z"/>
  </g>
  <g stroke="rgb(0 0 0 / 0.28)" stroke-width="0.7" stroke-linecap="round" fill="none">
    <path d="M9 14.8c.3 1.4.4 2.4.3 3.2M13 15.2c.1 1.4.1 2.6 0 3.6M19 15.2c-.1 1.4-.1 2.6 0 3.6M23 14.8c-.3 1.4-.4 2.4-.3 3.2"/>
    <path d="M9.5 9.6c.2-1.2.6-2.4 1.2-3.4M22.5 9.6c-.2-1.2-.6-2.4-1.2-3.4"/>
  </g>`

/** A 512px icon. `maskable` fills the square and keeps the kiss inside the 80% safe circle. */
function iconSvg({ maskable = false } = {}) {
  const scale = maskable ? 7.5 : 10
  const w = 32 * scale
  const h = 22 * scale
  const x = (512 - w) / 2
  const y = (512 - h) / 2 + (maskable ? 4 : 6)
  const radius = maskable ? 0 : 112
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="glow" cx="50%" cy="28%" r="80%">
      <stop offset="0" stop-color="${OXBLOOD}"/>
      <stop offset="1" stop-color="${VELVET}"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#glow)"/>
  <g transform="translate(${x} ${y}) scale(${scale})">${KISS}
  </g>
</svg>
`
}

async function render(page, svg, size, file) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`,
  )
  await page.locator('img').evaluate((img) => img.decode())
  await page.screenshot({ path: path.join(OUT, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  console.log(`wrote public/icons/${file}`)
}

await mkdir(OUT, { recursive: true })
const any = iconSvg()
const maskable = iconSvg({ maskable: true })
await writeFile(path.join(OUT, 'icon.svg'), any)
console.log('wrote public/icons/icon.svg')

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  await render(page, any, 192, 'icon-192.png')
  await render(page, any, 512, 'icon-512.png')
  await render(page, maskable, 512, 'icon-maskable-512.png')
  // iOS draws its own rounded mask and shows transparency as black: use the full-bleed art.
  await render(page, maskable, 180, 'apple-touch-icon.png')
} finally {
  await browser.close()
}
