#!/usr/bin/env node
// Phase 2 (content): the hub, profiles, character sets, the editor and mod import/export, as
// Chrome on an Android phone.
//
//   npm run e2e:phase2        (builds, then serves dist/ with vite preview; E2E_SKIP_BUILD=1 reuses dist/)
//
// Runs under the Pixel 7 profile of android.mjs (touch, 412x915 at 2.625x, Android user agent),
// from empty storage:
//   quick onboarding -> the hub lays out the 12 Afterhours coasters -> Show me women / men ->
//   sort by affection, trust and name (two relationships are seeded so the orders differ) ->
//   Nova's profile: hidden traits, 0/5 likes, locked secrets and a locked gallery strip ->
//   Character sets: Afterhours off (hub empty state) and on again -> Editor: duplicate Nova, age
//   18 is refused and Save stays disabled, 25 saves, the copy shows under My characters in the
//   editor and on the hub -> Export JSON downloads the card -> a .zip pack built here with jszip
//   is imported and its characters show in Character sets, the editor and the hub -> a new
//   version that drops a character asks before replacing it -> a lone card whose partner isn't
//   here imports without them -> a pack of long unbroken words fits at 360px, report included.
// Every screen is checked like android.mjs does (no sideways scroll, 48px touch targets, design
// rules), again at 360x800, and photographed at 412x915 and 1280x800:
// scripts/e2e/out/p2-android-*.png and p2-desktop-*.png.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import {
  check,
  checkDesign,
  checkToastTargets,
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
  screenshot,
  sleep,
  SMALL_PHONE,
  startApp,
  step,
  waitForHash,
} from './lib.mjs'

/** The Afterhours cast, by gender (docs/ROSTER.md). */
const WOMEN = ['Imani Clarke', 'Nova Castellanos', 'Priya Raman', 'Sasha Volkova', 'Vesper Laine']
const MEN = ['Cass Duarte', 'Dex Adeyemi', 'Jules Ferreira', 'Marlowe Achebe', 'Theo Marchetti']
const NONBINARY = ['Kai Okoro', 'Rook Halvorsen']
const EVERYONE = [...WOMEN, ...MEN, ...NONBINARY]
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })

const PACK = { id: 'harbor-lights', name: 'Harbor Lights', file: 'harbor-lights.zip' }

// ---------------------------------------------------------------------------
// Helpers

/** Coaster buttons on the hub (their accessible names start with the full name). */
const coasters = (page) => page.getByRole('button', { name: /traits discovered/ })

/** Full names on the hub's coasters, in screen order. */
async function coasterNames(page) {
  const labels = await coasters(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  return labels.map((l) => l.split(',')[0])
}

/** Wait until the hub shows exactly `n` coasters. */
async function waitForCoasters(page, n) {
  await page.waitForFunction(
    (want) => document.querySelectorAll('button[aria-label*="traits discovered"]').length === want,
    n,
    { timeout: 10_000 },
  )
}

function sameList(got, want, what) {
  check(JSON.stringify(got) === JSON.stringify(want), `${what}: expected ${want.join(', ')}; got ${got.join(', ')}`)
}

/** Put relationships straight into IndexedDB (the app's Dexie database), then reload. */
async function seedRelationships(page, rels) {
  await page.evaluate(
    (list) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('crushlab')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('relationships', 'readwrite')
          for (const r of list) tx.objectStore('relationships').put(r)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    rels,
  )
  await page.reload()
}

function relationship(characterId, affection, trust) {
  return {
    characterId,
    affection,
    trust,
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
    dates: 1,
    lastDateAt: Date.now(),
    connection: 0,
    heatPushes: 0,
    jealous: false,
  }
}

function card(id, name, extra) {
  const first = name.split(' ')[0]
  return {
    id,
    name,
    age: 33,
    gender: 'woman',
    pronouns: 'she/her',
    attractedTo: ['women', 'men', 'nonbinary'],
    relationshipStyle: 'open',
    jealousy: 'low',
    occupation: 'Harbor pilot who brings the container ships in at night',
    difficulty: 'normal',
    accent: '#5FA8D3',
    look: 'Salt-stiff peacoat, silver rings, wind-burned cheeks and a steady grin',
    artTags: 'adult woman, 33 years old, peacoat, silver rings, short dark hair',
    personality: 'Calm under pressure, quietly funny, a romantic who hides it well',
    voice: 'Short sentences, sea slang, a laugh that arrives late',
    backstory: `${first} has worked the harbor for ten years and knows every light on the breakwater.`,
    opener: 'You look like someone who has never seen the harbor at 3am. Sit down.',
    likes: [{ id: 'tide-tables', label: 'Knowing the tides by heart' }],
    dislikes: [{ id: 'rushing', label: 'Being rushed' }],
    turnOns: [{ id: 'steady-hands', label: 'Steady hands' }],
    turnOffs: [{ id: 'rude-to-staff', label: 'Rudeness to staff' }],
    favoriteVenues: ['boardwalk', 'night-market'],
    hatedVenues: ['arcade'],
    lovedGifts: ['houseplant'],
    hatedGifts: ['plushie'],
    secrets: [{ unlockAt: 60, text: `${first} almost took a job on a ship that never came back to port.` }],
    gallery: [1, 2, 3, 4, 5].map((tier) => ({
      tier,
      unlockAt: tier * 20,
      title: `Harbor light ${tier}`,
      scene: `${first} on the pilot boat at night, harbor lights behind her, scene ${tier}`,
    })),
    ...extra,
  }
}

/**
 * A small, valid .zip pack: manifest.json plus two cards who are exes. `lenaOnly` builds a new
 * version of it that leaves Maren out.
 */
async function buildPack(dir, { lenaOnly = false, file: fileName = PACK.file } = {}) {
  const zip = new JSZip()
  const lena = card('lena-voss', 'Lena Voss', lenaOnly ? {} : { partners: [{ characterId: 'maren-holt', relation: 'ex' }] })
  const maren = card('maren-holt', 'Maren Holt', {
    accent: '#D38B5F',
    partners: [{ characterId: 'lena-voss', relation: 'ex' }],
  })
  const cards = lenaOnly ? [lena] : [lena, maren]
  zip.file(
    'manifest.json',
    JSON.stringify({
      id: PACK.id,
      name: PACK.name,
      blurb: 'Two harbor pilots, one breakwater, and a breakup the whole dock heard about.',
      author: 'e2e',
      heat: 2,
      characters: cards.map((c) => c.id),
      relationships: lenaOnly ? [] : [{ a: lena.id, b: maren.id, kind: 'ex', note: 'They split the night shift after it ended.' }],
    }),
  )
  for (const c of cards) zip.file(`characters/${c.id}.json`, JSON.stringify(c))
  const file = path.join(dir, fileName)
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
  return { file, names: cards.map((c) => c.name) }
}

/** Words with no break in them, as a careless or mischievous pack might have. */
const LONG = {
  set: 'Thepackwithanamesolongitneverstopstobreatheatall',
  author: 'Anauthorwhoseusernamehasnospacesanywhereatall2026',
  name: 'Hubertblainewolfeschlegelsteinhausenbergerdorffsenior',
  identity: 'Genderfluidandfabulousandproudofiteverysingleday',
  occupation: 'Professionalpretzelbakerandparttimelighthousekeeperwithopinions',
  badId: 'averyveryverylongcharacteridthatgoesonandonandonforeverandeverxyz',
}

/** A pack whose name, author and character are long unbroken words, plus a card that fails. */
async function buildLongPack(dir) {
  const zip = new JSZip()
  const good = card('wolfe', LONG.name, {
    identity: LONG.identity,
    occupation: LONG.occupation,
    look: `Wearsacoatsolongitsweepsthefloorbehindthemlikeatrainforeverandever and silver rings`,
  })
  const bad = card(LONG.badId, 'Too Long', { age: 19 })
  zip.file(
    'manifest.json',
    JSON.stringify({
      id: 'long-words',
      name: LONG.set,
      author: LONG.author,
      blurb: `A blurb with ${LONG.occupation} in it.`,
      characters: [good.id, bad.id],
      relationships: [],
    }),
  )
  zip.file(`characters/${good.id}.json`, JSON.stringify(good))
  zip.file(`characters/${bad.id}.json`, JSON.stringify(bad))
  const file = path.join(dir, 'long-words.zip')
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
  return { file, id: good.id }
}

// ---------------------------------------------------------------------------
// Flow, as Chrome on a Pixel 7

async function androidFlow(browser, app, tmp) {
  const { context, page } = await newPage(browser, PIXEL_7.viewport, PIXEL_7)
  const shot = (name) => `p2-android-${name}`

  await step('quick onboarding reaches the hub', async () => {
    await quickOnboard(page, app.origin, { name: 'Ana', gender: 'Woman', pronouns: 'she/her' })
  }, page)

  await step('hub: the 12 Afterhours coasters', async () => {
    await page.getByRole('heading', { name: 'Afterhours', exact: true }).waitFor()
    await waitForCoasters(page, 12)
    sameList((await coasterNames(page)).sort(byName), [...EVERYONE].sort(byName), 'hub coasters')
    await page.getByText('12 regulars').waitFor()
    await checkTouchScreen(page, 'hub', { full: true, shot: shot('hub') })
  }, page)

  await step('hub: Show me women, then men, then everyone', async () => {
    const showMe = page.getByLabel('Show me', { exact: true })
    await showMe.selectOption('women')
    await waitForCoasters(page, WOMEN.length)
    sameList((await coasterNames(page)).sort(byName), WOMEN, 'Show me women')
    await showMe.selectOption('men')
    await waitForCoasters(page, MEN.length)
    sameList((await coasterNames(page)).sort(byName), MEN, 'Show me men')
    await screenshot(page, shot('hub-men'))
    await showMe.selectOption('everyone')
    await waitForCoasters(page, 12)
  }, page)

  await step('hub: sort by affection, trust and name', async () => {
    // Some progress, so the three orders differ: Vesper leads on affection, Priya on trust.
    await seedRelationships(page, [relationship('vesper', 30, 5), relationship('priya', 10, 50)])
    await waitForCoasters(page, 12)
    const sort = page.getByLabel('Sort by', { exact: true })
    const rest = (lead) => EVERYONE.filter((n) => !lead.includes(n)).sort(byName)
    check((await sort.inputValue()) === 'affection', 'the hub should sort by affection by default')
    sameList(await coasterNames(page), ['Vesper Laine', 'Priya Raman', ...rest(['Vesper Laine', 'Priya Raman'])], 'affection sort')
    await sort.selectOption('trust')
    await page.waitForFunction(() => document.querySelector('button[aria-label*="traits discovered"]')?.getAttribute('aria-label')?.startsWith('Priya'))
    sameList(await coasterNames(page), ['Priya Raman', 'Vesper Laine', ...rest(['Vesper Laine', 'Priya Raman'])], 'trust sort')
    await sort.selectOption('name')
    await page.waitForFunction(() => document.querySelector('button[aria-label*="traits discovered"]')?.getAttribute('aria-label')?.startsWith('Cass'))
    sameList(await coasterNames(page), [...EVERYONE].sort(byName), 'name sort')
    // The choice is a setting: it survives a reload.
    await page.reload()
    await waitForCoasters(page, 12)
    check((await page.getByLabel('Sort by', { exact: true }).inputValue()) === 'name', 'the name sort did not survive a reload')
    sameList(await coasterNames(page), [...EVERYONE].sort(byName), 'name sort after reload')
  }, page)

  await step("Nova's profile: hidden traits, 0/5 likes, locked gallery", async () => {
    await press(page.getByRole('button', { name: /^Nova Castellanos, stage Stranger, 0 of 17 traits discovered/ }))
    await waitForHash(page, '#/profile/nova')
    await page.getByRole('meter', { name: 'Affection' }).waitFor()
    const main = page.locator('main')
    // 17 traits, plus attractions and relationship style.
    const hidden = await main.getByText('???', { exact: true }).count()
    check(hidden === 19, `expected 19 "???" (17 traits, attractions, style), got ${hidden}`)
    for (const [title, n] of [['Likes', 5], ['Dislikes', 4], ['Turn-ons', 4], ['Turn-offs', 4]]) {
      const text = await main.getByRole('heading', { name: new RegExp(`^${title}`) }).innerText()
      check(text.includes(`0/${n}`), `${title} should read 0/${n}, reads "${text}"`)
    }
    check((await main.getByText('Vinyl records and liner-note trivia').count()) === 0, 'a hidden like is on show')
    await main.getByText('Unlocks at 60 affection').waitFor()
    await main.getByText('Unlocks at 80 affection').waitFor()
    const strip = main.getByRole('list', { name: "Nova Castellanos's gallery" })
    const slots = strip.getByRole('listitem')
    check((await slots.count()) === 5, `the gallery strip should have 5 slots, has ${await slots.count()}`)
    for (let i = 0; i < 5; i++) {
      const text = await slots.nth(i).innerText()
      check(text.includes(`Tier ${i + 1}`) && text.includes(`Unlocks at ${(i + 1) * 20}`), `slot ${i + 1} is not locked: "${text}"`)
    }
    check((await strip.locator('img').count()) === 0, 'a locked gallery slot shows art')
    check(await page.getByRole('button', { name: 'Ask for a group date' }).isDisabled(), 'group dates arrive in Phase 6')
    check(await page.getByRole('button', { name: 'Ask on a date' }).isEnabled(), 'Ask on a date should be enabled')
    await checkTouchScreen(page, 'profile-nova', { full: true, shot: shot('profile-nova') })
  }, page)

  await step('Character sets: Afterhours off empties the hub, on brings everyone back', async () => {
    await press(page.getByRole('button', { name: 'Back' }).first())
    await waitForHash(page, '#/hub')
    await press(page.getByRole('button', { name: 'Character sets', exact: true }))
    await waitForHash(page, '#/sets')
    await page.getByRole('heading', { name: 'Afterhours', exact: true }).waitFor()
    // Other bundled sets are listed too (off by default); open Afterhours' own list.
    const afterhours = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Afterhours', exact: true }) })
    await press(afterhours.getByRole('button', { name: /^Who is in it/ }))
    await page.getByRole('button', { name: /^Kai Okoro/ }).waitFor()
    await page.getByText('Nova Castellanos and Kai Okoro', { exact: false }).first().waitFor()
    await checkTouchScreen(page, 'sets', { full: true, shot: shot('sets') })

    const toggle = page.getByRole('switch', { name: /In play.*Afterhours/ })
    check((await toggle.getAttribute('aria-checked')) === 'true', 'Afterhours should start in play')
    await press(toggle)
    await page.getByRole('switch', { name: /In play.*Afterhours/, checked: false }).waitFor({ timeout: 5000 })
    await press(page.getByRole('button', { name: 'Back' }).first())
    await waitForHash(page, '#/hub')
    await page.getByRole('heading', { name: 'No sets in play' }).waitFor()
    check((await coasters(page).count()) === 0, 'coasters are still on the hub with every set off')
    await checkTouchScreen(page, 'hub-empty', { shot: shot('hub-empty') })

    await press(page.getByRole('button', { name: 'Choose character sets' }))
    await waitForHash(page, '#/sets')
    await press(page.getByRole('switch', { name: /In play.*Afterhours/ }))
    await page.getByRole('switch', { name: /In play.*Afterhours/, checked: true }).waitFor({ timeout: 5000 })
    await press(page.getByRole('button', { name: 'Back' }).first())
    await waitForHash(page, '#/hub')
    await waitForCoasters(page, 12)
    // Progress survived the round trip.
    await page.getByRole('button', { name: /^Vesper Laine, stage Acquaintance/ }).waitFor()
  }, page)

  await step('Editor: duplicate Nova, age 18 is refused, 25 saves', async () => {
    await press(page.getByRole('button', { name: 'Character sets', exact: true }))
    await waitForHash(page, '#/sets')
    await press(page.getByRole('button', { name: 'Character editor', exact: true }))
    await waitForHash(page, '#/editor')
    await page.getByRole('heading', { name: 'Afterhours', exact: true }).waitFor()
    await checkTouchScreen(page, 'editor-list', { full: true, shot: shot('editor-list') })

    await press(page.getByRole('button', { name: 'More for Nova Castellanos' }))
    await press(page.getByRole('dialog').getByRole('button', { name: 'Duplicate to edit' }))
    await waitForHash(page, '#/editor/nova-copy')
    const age = page.getByLabel('Age', { exact: true })
    await age.waitFor()
    check(!(await age.isDisabled()), 'the copy should be editable')
    check((await page.getByLabel('Name', { exact: true }).inputValue()) === 'Nova Castellanos (copy)', 'the copy is not named "(copy)"')
    await page.getByText('Ready to save').waitFor()
    const save = page.getByRole('button', { name: 'Save', exact: true })

    await age.fill('18')
    await page.getByRole('alert').filter({ hasText: 'Characters must be 21 or older' }).waitFor()
    await page.getByText(/things? to fix before saving/).waitFor()
    check(await save.isDisabled(), 'Save should be disabled for an 18-year-old')
    await checkTouchScreen(page, 'editor-form-age', { shot: shot('editor-form-age') })

    await age.fill('25')
    await page.getByText('Ready to save').waitFor()
    check((await page.getByRole('alert').filter({ hasText: 'Characters must be 21 or older' }).count()) === 0, 'the age error is still showing')
    check(await save.isEnabled(), 'Save should be enabled once the card is valid and changed')
    await checkTouchScreen(page, 'editor-form', { full: true, shot: shot('editor-form') })
    await press(save)
    await page.getByText('Saved Nova Castellanos (copy).').waitFor()
    await page.getByText('All saved').waitFor()
    await checkToastTargets(page)
  }, page)

  await step('the copy is under My characters in the editor and on the hub', async () => {
    await press(page.getByRole('button', { name: 'Back' }).first())
    await waitForHash(page, '#/editor')
    const mine = page.getByRole('region', { name: 'My characters' })
    await mine.getByRole('button', { name: /^Nova Castellanos \(copy\)/ }).waitFor()
    await goHash(page, '#/hub')
    await page.getByRole('heading', { name: 'My characters', exact: true }).waitFor()
    await waitForCoasters(page, 13)
    const copy = page.getByRole('region', { name: 'My characters' }).getByRole('button', { name: /traits discovered/ })
    sameList(await copy.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').split(',')[0])), ['Nova Castellanos (copy)'], 'My characters on the hub')
  }, page)

  await step('Export JSON downloads the card', async () => {
    await goHash(page, '#/editor')
    await press(page.getByRole('button', { name: 'More for Nova Castellanos (copy)' }))
    const download = page.waitForEvent('download')
    await press(page.getByRole('dialog').getByRole('button', { name: 'Export JSON' }))
    const file = await download
    check(/\.json$/.test(file.suggestedFilename()), `the export is named ${file.suggestedFilename()}`)
    const saved = path.join(tmp, file.suggestedFilename())
    await file.saveAs(saved)
    const json = JSON.parse(await readFile(saved, 'utf8'))
    check(json.id === 'nova-copy' && json.age === 25 && json.name === 'Nova Castellanos (copy)', `unexpected export: ${JSON.stringify(json).slice(0, 120)}`)
    check(Array.isArray(json.gallery) && json.gallery.length === 5, 'the exported card lost its gallery')
    await page.getByText('Nova Castellanos (copy) is ready to share.').waitFor()
    log(`     ${file.suggestedFilename()}: ${(await readFile(saved)).length} bytes`)
  }, page)

  await step('import a .zip pack: it shows in Character sets, the editor and the hub', async () => {
    const pack = await buildPack(tmp)
    await goHash(page, '#/sets')
    await page.locator('input[type="file"]').setInputFiles(pack.file)
    await page.getByText(`Imported 2 characters. They're in ${PACK.name}, which is now in play.`).waitFor()

    const setCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: PACK.name }) })
    await setCard.getByText('Imported pack').waitFor()
    check((await setCard.getByRole('switch').getAttribute('aria-checked')) === 'true', 'the imported set should be in play')
    await press(setCard.getByRole('button', { name: /^Who is in it/ }))
    for (const name of pack.names) await setCard.getByRole('button', { name: new RegExp(`^${name}`) }).waitFor()
    await setCard.getByText('They split the night shift after it ended.').waitFor()

    await goHash(page, '#/editor')
    const inEditor = page.getByRole('region', { name: PACK.name })
    for (const name of pack.names) await inEditor.getByRole('button', { name: new RegExp(`^${name}`) }).waitFor()

    await goHash(page, '#/hub')
    await waitForCoasters(page, 15)
    const group = page.getByRole('region', { name: PACK.name })
    const names = await group.getByRole('button', { name: /traits discovered/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').split(',')[0]))
    sameList(names, pack.names, `${PACK.name} on the hub`)
    // With several sets in play the hub offers a set filter.
    await page.getByLabel('Set', { exact: true }).selectOption(PACK.id)
    await waitForCoasters(page, 2)
    await page.getByLabel('Set', { exact: true }).selectOption('all')
    await waitForCoasters(page, 15)
  }, page)

  await step('re-importing a pack asks before anyone leaves; a card exported alone imports without its partner', async () => {
    const v2 = await buildPack(tmp, { lenaOnly: true, file: 'harbor-lights-v2.zip' })
    await goHash(page, '#/sets')
    await page.locator('input[type="file"]').setInputFiles(v2.file)
    const ask = page.getByRole('alertdialog', { name: `Replace ${PACK.name}?` })
    await ask.waitFor()
    await ask.getByText("Maren Holt isn't in the new file and will leave the roster.", { exact: false }).waitFor()
    await screenshot(page, shot('replace-pack'))
    for (const name of ['Keep the one I have', 'Replace pack']) {
      const box = await ask.getByRole('button', { name }).boundingBox()
      check(box && box.height >= 48, `"${name}" is ${box?.height}px tall`)
    }
    await press(ask.getByRole('button', { name: 'Keep the one I have' }))
    await ask.waitFor({ state: 'hidden' })
    const setCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: PACK.name }) })
    await setCard.getByText('2', { exact: true }).first().waitFor()

    // Export JSON keeps partners; on a device without them the card still imports.
    const lone = path.join(tmp, 'sam-ortiz.json')
    await writeFile(lone, JSON.stringify(card('sam-ortiz', 'Sam Ortiz', { partners: [{ characterId: 'lee-park', relation: 'ex' }] })))
    await page.locator('input[type="file"]').setInputFiles(lone)
    const report = page.getByRole('dialog', { name: 'Imported 1 character' })
    await report.waitFor()
    await report.getByText('Left out partner "lee-park"', { exact: false }).waitFor()
    await press(report.getByRole('button', { name: 'Done' }))
    await report.waitFor({ state: 'hidden' })
  }, page)

  await step('360x800: long unbroken words from a pack wrap instead of pushing the page sideways', async () => {
    await page.setViewportSize(SMALL_PHONE)
    const long = await buildLongPack(tmp)
    await goHash(page, '#/sets')
    await page.locator('input[type="file"]').setInputFiles(long.file)
    const report = page.getByRole('dialog', { name: 'Imported 1 of 2 characters' })
    await report.waitFor()
    await report.getByText('Every character in crushLAB is 21 or older', { exact: false }).first().waitFor()
    const clipped = await report.locator('ul[aria-label="Problems found"] > li').evaluateAll((els) =>
      els
        .map((e) => ({ right: e.getBoundingClientRect().right, over: e.scrollWidth - e.clientWidth, text: e.textContent.slice(0, 40) }))
        .filter((r) => r.right > document.documentElement.clientWidth + 0.5 || r.over > 0.5),
    )
    check(!clipped.length, `import problems are cut off at 360px: ${JSON.stringify(clipped)}`)
    await screenshot(page, 'p2-360-import-report-long')
    await press(report.getByRole('button', { name: 'Done' }))
    await report.waitFor({ state: 'hidden' })

    const longCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: LONG.set }) })
    await press(longCard.getByRole('button', { name: /^Who is in it/ }))
    await checkTouchScreen(page, '360-sets-long', { full: true, shot: 'p2-360-sets-long' })
    for (const [hash, name] of [
      ['#/hub', '360-hub-long'],
      [`#/profile/${long.id}`, '360-profile-long'],
      ['#/editor', '360-editor-list-long'],
      [`#/editor/${long.id}`, '360-editor-form-long'],
    ]) {
      await goHash(page, hash)
      await checkTouchScreen(page, name, { full: true, shot: `p2-${name}` })
    }
    await page.setViewportSize(PIXEL_7.viewport)
  }, page)

  await step('360x800: the Phase 2 screens still fit', async () => {
    await page.setViewportSize(SMALL_PHONE)
    for (const [hash, name] of [
      ['#/hub', '360-hub'],
      ['#/profile/nova', '360-profile'],
      ['#/sets', '360-sets'],
      ['#/editor', '360-editor-list'],
      ['#/editor/nova-copy', '360-editor-form'],
      ['#/settings', '360-settings'],
    ]) {
      await goHash(page, hash)
      await checkTouchScreen(page, name, { full: true, shot: `p2-${name}` })
    }
    await page.setViewportSize(PIXEL_7.viewport)
  }, page)

  await step('no uncaught page errors (Android)', async () => {
    const bad = page.errors.filter(
      (e) => e.kind === 'pageerror' || !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED|CORS policy|net::/.test(e.text),
    )
    check(!bad.length, bad.map((e) => `${e.kind}: ${e.text}`).join('\n'))
  }, page)

  await context.close()
}

// ---------------------------------------------------------------------------
// The same screens on a desktop browser

async function desktopShots(browser, app) {
  const { context, page } = await newPage(browser, 'desktop')
  const shots = [
    ['#/hub', 'hub'],
    ['#/profile/nova', 'profile-nova'],
    ['#/sets', 'sets'],
    ['#/editor', 'editor-list'],
    ['#/editor/nova-copy', 'editor-form'],
  ]

  await step('1280x800: onboard and duplicate Nova', async () => {
    await quickOnboard(page, app.origin, { name: 'Sam', gender: 'Nonbinary', pronouns: 'they/them' })
    await waitForCoasters(page, 12)
    await goHash(page, '#/editor')
    await page.getByRole('button', { name: 'More for Nova Castellanos' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate to edit' }).click()
    await waitForHash(page, '#/editor/nova-copy')
    await page.getByLabel('Age', { exact: true }).waitFor()
  }, page)

  await step('1280x800: hub, profile, character sets, editor list and form', async () => {
    for (const [hash, name] of shots) {
      await goHash(page, hash)
      await page.locator('main').first().waitFor()
      await page.getByText(/^(One moment|Opening the doors)$/).waitFor({ state: 'hidden' })
      await dismissToasts(page)
      if (name === 'sets') await page.getByRole('button', { name: /^Who is in it/ }).first().click()
      await sleep(100)
      await page.evaluate(() => window.scrollTo(0, 0))
      await screenshot(page, `p2-desktop-${name}`)
      await screenshot(page, `p2-desktop-${name}-full`, { fullPage: true })
      await checkDesign(page, `desktop ${name}`)
    }
  }, page)

  await step('no uncaught page errors (desktop)', async () => {
    const bad = page.errors.filter(
      (e) => e.kind === 'pageerror' || !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED|CORS policy|net::/.test(e.text),
    )
    check(!bad.length, bad.map((e) => `${e.kind}: ${e.text}`).join('\n'))
  }, page)

  await context.close()
}

await main(async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'crushlab-e2e-'))
  onCleanup(() => rm(tmp, { recursive: true, force: true }))
  const app = await startApp()
  log(`App on ${app.origin}`)
  const browser = await launchBrowser()

  await androidFlow(browser, app, tmp)
  await desktopShots(browser, app)
})
