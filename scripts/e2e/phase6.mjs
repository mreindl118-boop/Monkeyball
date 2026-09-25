#!/usr/bin/env node
// Phase 6 (sets and group play): the acceptance checks in docs/SPEC.md, as Chrome on an Android
// phone first (Pixel 7, touch, 412x915), then the group screens at 360x800.
//
//   npm run e2e:phase6        (builds the app and serves it with vite preview; E2E_SKIP_BUILD=1
//                              reuses dist/)
//
// Pixel 7, from empty storage:
//   - Quick onboarding (the "Who's in town" step left at its defaults), the mock connected.
//   - Sets: the hub has Afterhours' 12 and the map lists 12. Wren (The Polycule) is given some
//     progress in IndexedDB. Character sets, The Polycule on: the hub gains a "The Polycule" group
//     of 6, the map lists 18 and draws more partner threads (Wren and Sol, Mateo and Felix...).
//     Off again: the hub and the map are back to 12. On again: Wren's progress is still there.
//   - A group date with Dex and Imani (Afterhours' open couple): Dex's profile, Ask for a group
//     date, Imani picked; "Between them" shows their history and how each feels; the hot spring
//     (both love it). On the date both speak (a speaker plate each) and talk to each other; the
//     status strip has a row and meters for each. Three messages, End date: the recap has a tab per
//     character, and affection and trust rose for both (read from IndexedDB).
//   - Mod import from Settings, Character sets and mods, Import mod file: a .zip pack built here;
//     its characters appear in Character sets, the editor and the hub.
//   - 360x800: group setup, the group date's screen and the group recap still fit.
//   - No uncaught page errors.
// Then the offline shell: scripts/e2e/offline.mjs runs against the same build.
//
// Screens are checked like android.mjs does (no sideways scroll, 48px touch targets, design rules).
// Screenshots: scripts/e2e/out/p6-android-*.png and p6-360-*.png.
//
// E2E_ONLY=android|offline runs one part.

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import {
  check,
  checkIncludes,
  checkTouchScreen,
  connectToMock,
  dismissToasts,
  goHash,
  launchBrowser,
  log,
  main,
  newPage,
  PIXEL_7,
  press,
  quickOnboard,
  ROOT,
  run,
  screenshot,
  SMALL_PHONE,
  startApp,
  startMock,
  step,
  waitForHash,
} from './lib.mjs'

const ONLY = (process.env.E2E_ONLY || '').trim()
const runs = (part) => !ONLY || ONLY.split(',').includes(part)

const PACK = { id: 'tidewater', name: 'Tidewater', file: 'tidewater.zip', names: ['Odile Marsh', 'Petra Quill'] }
const DEX_IMANI_NOTE = 'Together six years and open for the last two'

// ---------------------------------------------------------------------------
// Helpers

const coasterSelector = 'button[aria-label*="traits discovered"]'

async function waitForCoasters(page, n) {
  await page.waitForFunction((want) => document.querySelectorAll('button[aria-label*="traits discovered"]').length === want, n, {
    timeout: 10_000,
  })
}

/** The map: how many people it lists, and how many partner threads it draws. */
async function mapCounts(page) {
  await goHash(page, '#/map')
  await page.getByRole('heading', { name: 'Everyone on the map' }).waitFor()
  return page.evaluate(() => ({
    people: document.querySelectorAll('section[aria-labelledby="map-people"] li').length,
    partners: document.querySelectorAll('svg :is(line, path)[class*="_partner_"]').length,
    names: [...document.querySelectorAll('section[aria-labelledby="map-people"] li [class*="personName"]')].map((e) => e.textContent.trim()),
  }))
}

/** Read relationships straight from the app's IndexedDB. */
function readRels(page, ids) {
  return page.evaluate(
    (list) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('crushlab')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('relationships', 'readonly')
          const out = {}
          for (const id of list) {
            const g = tx.objectStore('relationships').get(id)
            g.onsuccess = () => {
              out[id] = g.result ? { affection: g.result.affection, trust: g.result.trust, dates: g.result.dates } : null
            }
          }
          tx.oncomplete = () => {
            db.close()
            resolve(out)
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    ids,
  )
}

/** Put relationships straight into IndexedDB, then reload. */
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

async function setSet(page, name, on) {
  await goHash(page, '#/sets')
  const toggle = page.getByRole('switch', { name: new RegExp(`In play.*${name}`) })
  await toggle.waitFor()
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await press(toggle)
  await page.getByRole('switch', { name: new RegExp(`In play.*${name}`), checked: on }).waitFor({ timeout: 5000 })
}

const dateMain = (page) => page.locator('main[aria-label^="Group date with"]')
const composer = (page) => page.getByLabel(/^Your message to/)

/** The group date waits for the player, or it is over and "See how it went" is ready. */
async function waitIdle(page, timeout = 30_000) {
  await page.waitForFunction(
    () => {
      const root = document.querySelector('main[aria-label^="Group date with"]')
      if (!root) return false
      const see = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'See how it went')
      if (see) return !see.disabled && see.getAttribute('aria-busy') !== 'true'
      const ta = root.querySelector('textarea')
      const status = root.querySelector('[class*="statusLine"]')
      return !!ta && !ta.readOnly && !!status && status.textContent.trim() === ''
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
    (n) => document.querySelectorAll('main[aria-label^="Group date with"] [class*="_you_"]').length > n,
    before,
    { timeout: 10_000 },
  )
  await waitIdle(page)
}

/** Speaker plates in the transcript, in order. */
function speakers(page) {
  return dateMain(page)
    .locator('[class*="_speaker_"]')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()))
}

function card(id, name, extra) {
  const first = name.split(' ')[0]
  return {
    id,
    name,
    age: 34,
    gender: 'woman',
    pronouns: 'she/her',
    attractedTo: ['women', 'men', 'nonbinary'],
    relationshipStyle: 'poly',
    jealousy: 'low',
    occupation: 'Oyster farmer who works the tidal flats before dawn',
    difficulty: 'normal',
    accent: '#6FB3A0',
    look: 'Waders, a cable-knit sweater, salt in her hair and a crooked grin',
    artTags: 'adult woman, 34 years old, cable-knit sweater, waders, curly hair',
    personality: 'Patient, dry, generous with her time and stingy with compliments',
    voice: 'Slow, low, fond of tide and weather metaphors',
    backstory: `${first} took over the family oyster beds and turned them into the best on the coast.`,
    opener: 'Mind the mud. Nobody minds the mud the first time.',
    likes: [{ id: 'low-tide', label: 'Low tide at sunrise' }],
    dislikes: [{ id: 'litter', label: 'Litter on the flats' }],
    turnOns: [{ id: 'patience', label: 'Patience' }],
    turnOffs: [{ id: 'rude-to-staff', label: 'Rudeness to staff' }],
    favoriteVenues: ['boardwalk', 'night-market'],
    hatedVenues: ['arcade'],
    lovedGifts: ['houseplant'],
    hatedGifts: ['plushie'],
    secrets: [{ unlockAt: 60, text: `${first} once sold a pearl to pay a friend's rent and never told her.` }],
    gallery: [1, 2, 3, 4, 5].map((tier) => ({
      tier,
      unlockAt: tier * 20,
      title: `Tidewater ${tier}`,
      scene: `${first} on the oyster flats at dawn, scene ${tier}`,
    })),
    ...extra,
  }
}

async function buildPack(dir) {
  const zip = new JSZip()
  const odile = card('odile-marsh', 'Odile Marsh', { partners: [{ characterId: 'petra-quill', relation: 'partner' }] })
  const petra = card('petra-quill', 'Petra Quill', { accent: '#C98B6B', partners: [{ characterId: 'odile-marsh', relation: 'partner' }] })
  zip.file(
    'manifest.json',
    JSON.stringify({
      id: PACK.id,
      name: PACK.name,
      blurb: 'Two oyster farmers, one tidal flat, and a boat they share on alternate Sundays.',
      author: 'e2e',
      heat: 2,
      characters: [odile.id, petra.id],
      relationships: [{ a: odile.id, b: petra.id, kind: 'partner', note: 'They split the beds down the middle and the boat by the week.' }],
    }),
  )
  zip.file(`characters/${odile.id}.json`, JSON.stringify(odile))
  zip.file(`characters/${petra.id}.json`, JSON.stringify(petra))
  const file = path.join(dir, PACK.file)
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
  return file
}

function pageErrors(page) {
  return page.errors.filter(
    (e) => e.kind === 'pageerror' || !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED|CORS policy|net::|Download the React DevTools/.test(e.text),
  )
}

// ---------------------------------------------------------------------------
// Android

async function androidFlow(browser, app, mock, dir) {
  const { context, page } = await newPage(browser, PIXEL_7.viewport, PIXEL_7)
  const shot = (name) => `p6-android-${name}`
  let recapHash = ''

  await step('quick onboarding, the mock connected', async () => {
    await quickOnboard(page, app.origin, { name: 'Ana', gender: 'Woman', pronouns: 'she/her' })
    await connectToMock(page, mock)
    await dismissToasts(page)
  }, page)

  let before
  await step('sets: Afterhours alone, 12 on the hub and the map', async () => {
    await goHash(page, '#/hub')
    await waitForCoasters(page, 12)
    check((await page.getByRole('heading', { name: 'The Polycule', exact: true }).count()) === 0, 'The Polycule is on the hub before it was turned on')
    before = await mapCounts(page)
    check(before.people === 12, `the map lists ${before.people} people, expected 12`)
    check(!before.names.includes('Wren Halloway') && !before.names.some((n) => n.startsWith('Wren')), 'Wren is on the map before The Polycule is on')
    log(`     map: ${before.people} people, ${before.partners} partner threads`)
    // Progress for someone in a set that's off: it must survive the set going on and off.
    await seedRelationships(page, [relationship('wren', 30, 20)])
  }, page)

  await step('The Polycule on: its 6 and their relationships join the hub and the map', async () => {
    await setSet(page, 'The Polycule', true)
    await checkTouchScreen(page, 'sets-polycule-on', { full: true, shot: shot('sets') })
    await goHash(page, '#/hub')
    await waitForCoasters(page, 18)
    const group = page.getByRole('region', { name: 'The Polycule' })
    check((await group.locator(coasterSelector).count()) === 6, 'the hub should show The Polycule\'s 6')
    await group.getByRole('button', { name: /^Wren [^,]*, stage Acquaintance/ }).waitFor()
    const on = await mapCounts(page)
    check(on.people === 18, `the map lists ${on.people} people, expected 18`)
    check(on.names.some((n) => n.startsWith('Wren')) && on.names.some((n) => n.startsWith('Sol')), `the map is missing Polycule people: ${on.names.join(', ')}`)
    // Wren and Sol, Mateo and Felix, Wren and Juno, Mateo and Ash.
    check(on.partners >= before.partners + 4, `the map drew ${on.partners} partner threads, expected at least ${before.partners + 4}`)
    await checkTouchScreen(page, 'map-polycule', { full: true, shot: shot('map') })
    log(`     map: ${on.people} people, ${on.partners} partner threads`)
  }, page)

  await step('The Polycule off hides them; on again, Wren\'s progress is still there', async () => {
    await setSet(page, 'The Polycule', false)
    await goHash(page, '#/hub')
    await waitForCoasters(page, 12)
    const off = await mapCounts(page)
    check(off.people === 12 && off.partners === before.partners, `with The Polycule off the map has ${off.people} people and ${off.partners} partner threads`)
    const rels = await readRels(page, ['wren'])
    check(rels.wren?.affection === 30 && rels.wren?.trust === 20, `Wren's progress changed while hidden: ${JSON.stringify(rels.wren)}`)
    await setSet(page, 'The Polycule', true)
    await goHash(page, '#/hub')
    await waitForCoasters(page, 18)
    await page.getByRole('region', { name: 'The Polycule' }).getByRole('button', { name: /^Wren [^,]*, stage Acquaintance/ }).waitFor()
  }, page)

  let relsBefore
  await step('group setup: Dex and Imani, their history and how each feels', async () => {
    relsBefore = await readRels(page, ['dex', 'imani'])
    await goHash(page, '#/profile/dex')
    await page.getByRole('meter', { name: 'Affection' }).waitFor()
    await press(page.getByRole('button', { name: 'Ask for a group date' }))
    await waitForHash(page, '#/date-setup/dex/group')
    await page.getByRole('heading', { name: 'Who comes along' }).waitFor()
    await page.getByRole('radio', { name: /^Imani Clarke/ }).check({ force: true })
    await page.getByText('Between them', { exact: true }).waitFor()
    await page.getByText(DEX_IMANI_NOTE).waitFor()
    const text = await page.locator('main').innerText()
    checkIncludes(
      text,
      ['Dex and Imani are together.', "You haven't been out with Imani yet, so there's nothing for Dex to find out.", "You haven't been out with Dex yet, so there's nothing for Imani to find out."],
      'Between them',
    )
    check(!/you're seeing/.test(text), 'group setup should not say the player is seeing someone they never dated')
    // The list folds to the pick, so Between them is right under it.
    await page.getByRole('button', { name: 'Change who comes along' }).waitFor()
    await page.getByRole('radio', { name: /^Hot spring/ }).check({ force: true })
    await page.getByText(/Dex and Imani/).first().waitFor()
    await checkTouchScreen(page, 'group-setup', { full: true, shot: shot('group-setup') })
  }, page)

  await step('group date: both speak, to you and to each other', async () => {
    await press(page.getByRole('button', { name: 'Start the group date' }))
    await waitForHash(page, '#/date')
    await dateMain(page).waitFor()
    check(/Dex Adeyemi/.test((await dateMain(page).getAttribute('aria-label')) ?? '') && /Imani Clarke/.test((await dateMain(page).getAttribute('aria-label')) ?? ''), 'the date screen should name both')
    await waitIdle(page)
    let who = await speakers(page)
    check(who.includes('Dex') && who.includes('Imani'), `the opening should have both speaking, got: ${who.join(', ')}`)
    await sendLine(page, 'So how did you two meet, anyway?')
    await sendLine(page, 'I love that you still finish each other\'s sentences.')
    who = await speakers(page)
    check(who.filter((w) => w === 'Dex').length >= 3 && who.filter((w) => w === 'Imani').length >= 3, `both should speak every turn, got: ${who.join(', ')}`)
    // They talk to each other: someone's line names the other.
    const lines = await dateMain(page)
      .locator('[class*="groupLine"]')
      .evaluateAll((els) => els.map((e) => e.textContent.trim()))
    check(lines.some((l) => l.startsWith('Dex') && /Imani/.test(l.slice(3))) && lines.some((l) => l.startsWith('Imani') && /Dex/.test(l.slice(5))), 'Dex and Imani should address each other')
    // The status strip has a row for each; expanded, a pair of meters each.
    const toggle = dateMain(page).getByRole('region', { name: "How it's going" }).getByRole('button', { expanded: false }).first()
    await press(toggle)
    for (const n of ['Dex', 'Imani']) {
      await dateMain(page).getByRole('meter', { name: `${n}'s affection` }).waitFor()
      await dateMain(page).getByRole('meter', { name: `${n}'s trust` }).waitFor()
    }
    await screenshot(page, shot('group-date-status'))
    await press(dateMain(page).getByRole('region', { name: "How it's going" }).getByRole('button', { expanded: true }).first())
    await checkTouchScreen(page, 'group-date', { shot: shot('group-date') })
    // Play it out: the date's last turn closes the story and "See how it went" takes over.
    const lines2 = ['Some banter: who takes longer to get ready?', 'Tell me about the restaurant.', 'What was your worst date ever?', 'Okay, one more round of banter.', 'Do you two ever argue?', 'What are you doing next weekend?', 'Same time next week? My treat.', 'This was lovely.']
    for (const line of lines2) {
      if (await dateMain(page).getByRole('button', { name: 'See how it went' }).count()) break
      await sendLine(page, line)
    }
    await dateMain(page).getByRole('button', { name: 'See how it went' }).waitFor()
    await screenshot(page, shot('group-date-end'))
  }, page)

  await step('group recap: a side for each, and affection and trust rose for both', async () => {
    await press(dateMain(page).getByRole('button', { name: 'See how it went' }))
    await page.waitForFunction(() => location.hash.startsWith('#/recap/'), null, { timeout: 20_000 })
    recapHash = await page.evaluate(() => location.hash)
    await page.getByRole('heading', { name: 'Where you stand' }).waitFor()
    const tabs = page.getByRole('radiogroup', { name: 'Whose side of the date' })
    await tabs.getByRole('radio', { name: 'Dex' }).waitFor()
    await tabs.getByRole('radio', { name: 'Imani' }).waitFor()
    await page.getByText(/with Imani/).first().waitFor()
    await checkTouchScreen(page, 'group-recap', { full: true, shot: shot('group-recap') })
    await press(tabs.getByRole('radio', { name: 'Imani' }))
    await page.getByText(/with Dex/).first().waitFor()
    await screenshot(page, shot('group-recap-imani'), { fullPage: true })
    const after = await readRels(page, ['dex', 'imani'])
    for (const id of ['dex', 'imani']) {
      const b = relsBefore[id] ?? { affection: 0, trust: 0, dates: 0 }
      const a = after[id]
      check(!!a, `${id} has no relationship after the group date`)
      check(a.affection > b.affection, `${id}'s affection did not rise: ${b.affection} to ${a.affection}`)
      check(a.trust > b.trust, `${id}'s trust did not rise: ${b.trust} to ${a.trust}`)
      check(a.dates === (b.dates ?? 0) + 1, `${id}'s date count: ${b.dates} to ${a.dates}`)
      log(`     ${id}: affection ${b.affection} to ${a.affection}, trust ${b.trust} to ${a.trust}`)
    }
  }, page)

  await step('mod import from Settings: a .zip pack shows in Character sets, the editor and the hub', async () => {
    const file = await buildPack(dir)
    await goHash(page, '#/settings/mods')
    const panel = page.locator('#settings-mods')
    await panel.getByRole('button', { name: 'Import mod file' }).waitFor()
    await panel.locator('input[type="file"]').setInputFiles(file)
    await page.getByText(`Imported 2 characters. They're in ${PACK.name}, which is now in play.`).waitFor({ timeout: 15_000 })
    await dismissToasts(page)

    await goHash(page, '#/sets')
    const setCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: PACK.name }) })
    await setCard.getByText('Imported pack').waitFor()
    check((await setCard.getByRole('switch').getAttribute('aria-checked')) === 'true', 'the imported set should be in play')
    await press(setCard.getByRole('button', { name: /^Who is in it/ }))
    for (const name of PACK.names) await setCard.getByRole('button', { name: new RegExp(`^${name}`) }).waitFor()

    await goHash(page, '#/editor')
    const inEditor = page.getByRole('region', { name: PACK.name })
    for (const name of PACK.names) await inEditor.getByRole('button', { name: new RegExp(`^${name}`) }).waitFor()

    await goHash(page, '#/hub')
    await waitForCoasters(page, 20)
    const names = await page
      .getByRole('region', { name: PACK.name })
      .locator(coasterSelector)
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').split(',')[0]))
    check(JSON.stringify(names.sort()) === JSON.stringify(PACK.names), `${PACK.name} on the hub: ${names.join(', ')}`)
  }, page)

  await step('360x800: group setup, the group date and the group recap fit', async () => {
    await page.setViewportSize(SMALL_PHONE)
    await goHash(page, '#/date-setup/imani/group')
    await page.getByRole('radio', { name: /^Dex Adeyemi/ }).check({ force: true })
    await page.getByText('Between them', { exact: true }).waitFor()
    // After the pick, Between them is on screen without scrolling past the roster.
    await page.waitForFunction(
      () => {
        const el = [...document.querySelectorAll('h2, h3')].find((h) => h.textContent.trim() === 'Between them')
        if (!el) return false
        const r = el.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= window.innerHeight
      },
      null,
      { timeout: 5_000 },
    ).catch(() => {
      throw new Error('Between them should be in the viewport after picking at 360x800')
    })
    await checkTouchScreen(page, '360-group-setup', { full: true, shot: 'p6-360-group-setup' })
    await page.getByRole('radio', { name: /^Night market/ }).check({ force: true })
    await press(page.getByRole('button', { name: 'Start the group date' }))
    await waitForHash(page, '#/date')
    await dateMain(page).waitFor()
    await waitIdle(page)
    await sendLine(page, 'Dumplings first, then the lantern stall?')
    await checkTouchScreen(page, '360-group-date', { shot: 'p6-360-group-date' })
    await press(dateMain(page).getByRole('button', { name: 'End date', exact: true }))
    const dialog = page.getByRole('alertdialog', { name: 'End the date?' })
    await dialog.waitFor()
    await press(dialog.getByRole('button', { name: 'End date', exact: true }))
    await page.waitForFunction(() => location.hash.startsWith('#/recap/'), null, { timeout: 20_000 })
    await page.getByRole('heading', { name: 'Where you stand' }).waitFor()
    await checkTouchScreen(page, '360-group-recap', { full: true, shot: 'p6-360-group-recap' })
    // The first group date's recap still opens.
    await goHash(page, recapHash)
    await page.getByRole('radiogroup', { name: 'Whose side of the date' }).waitFor()
  }, page)

  await step('no uncaught page errors (Android)', async () => {
    const errors = pageErrors(page)
    check(errors.length === 0, `page errors:\n${errors.map((e) => `${e.kind}: ${e.text}`).join('\n')}`)
  }, page)

  await context.close()
}

// ---------------------------------------------------------------------------

await main(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crushlab-p6-'))
  if (runs('android')) {
    const mock = await startMock()
    const app = await startApp()
    const browser = await launchBrowser()
    await androidFlow(browser, app, mock, dir)
    await browser.close()
    app.stop?.()
    mock.stop?.()
  }
  if (runs('offline')) {
    await step('the offline shell (scripts/e2e/offline.mjs)', async () => {
      await run(process.execPath, [path.join(ROOT, 'scripts', 'e2e', 'offline.mjs')], {
        name: 'offline.mjs',
        env: runs('android') ? { E2E_SKIP_BUILD: '1' } : {},
      })
    })
  }
})
