# crushLAB progress

Spec: docs/SPEC.md. Build contract: docs/ARCHITECTURE.md. Casting: docs/ROSTER.md.

## Done

- Foundation: Vite + React + TS scaffold, dependencies, shared types (src/types.ts), Dexie schema
  (src/db/db.ts), hash-synced navigation store (src/store/nav.ts), design tokens (src/ui/tokens.css),
  Nova's reference card.
- Phase 1 (scaffold), reviewed, fixed and checked end to end:
  - App shell: 18+ gate, onboarding (player profile, orientation mode, quiet connection check),
    connection setup, Phase 1 hub, Settings (connection, profile, play, images, saves, reset),
    debug panel (long-press the version number; the hub shortcut is dev-only), "Not built yet"
    screen for later phases. Boot never hangs: a malformed hash falls back to the hub, and when
    IndexedDB is missing or a write fails the app warns once and keeps working in memory.
  - Navigation: every history entry carries `{ crush, idx }`; in-app Back goes through
    `history.back()` so it and the system back button share one path; `reset()` unwinds what
    its stack pushed. Back, Back from the debug panel lands on the first entry, so the next system
    back leaves the app.
  - UI kit in src/ui (buttons, fields, segmented, heat control, sheets, toasts, long press...).
    Secondary text on panels uses `--smoke-text` (lightened on raised surfaces for 4.5:1), touch
    targets reach 48px, focus rings are visible on the debug tabs and code blocks.
  - Stores and persistence: settings/profile store over Dexie kv (write failures are recorded, not
    thrown), repo helpers, save export/import and save slots. API keys are never exported; on
    import each preset keeps this device's key. Keys are stored per preset
    (`ConnectionSettings.providers`), so switching presets never sends one provider's key to
    another server.
  - Model platform: presets, SSE parser, defensive JSON, streaming/JSON client with the
    response_format fallback (only for errors that name response_format/json_object) and nudge
    retry, connection diagnostics (CORS vs unreachable vs auth vs model; LAN addresses get the
    OLLAMA_HOST=0.0.0.0 / "Serve on local network" advice; unrelated 400s aren't called an unknown
    model), prompt templates and builders, heat levels, stages and routes, debug log.
  - Platform layer started: src/platform/platform.ts (`isNative`, `platformName`) and
    src/platform/files.ts (`saveFile`, `canSaveFiles`).
  - PWA: manifest icons (192, 512, maskable), favicon and apple-touch-icon in public/icons,
    drawn by `node scripts/make-icons.mjs`. The app version comes from a build-time define (the
    bundle no longer ships package.json).
  - Mock OpenAI-compatible server (scripts/mock-llm.mjs, `npm run mock-llm`, self-test with
    `npm run mock-llm:selftest`).
  - E2E: `npm run e2e:phase1` builds the app, serves it with vite preview, starts the mock and
    walks the first-launch flow at 390x844 and 1280x800 (acceptance check: the profile and
    heat show up in the assembled story prompt in the debug panel and survive a reload; hash
    navigation can't skip the gate or onboarding; a malformed hash still boots; in-app Back pops
    history; onboarding finishes with no IndexedDB; a server without CORS headers is diagnosed as
    CORS). Screenshots land in scripts/e2e/out/ (git-ignored). Helpers in scripts/e2e/lib.mjs.
- Claude/ChatGPT providers (ARCHITECTURE, "Providers: Claude and ChatGPT first"):
  - Presets: Claude (official `@anthropic-ai/sdk`), ChatGPT and Grok cards plus Other providers
    (Ollama, LM Studio, OpenRouter, Custom), each with its own address, masked key and Test
    connection. Story and judge roles each pick a provider and model (`src/llm/index.ts` front
    door, `routes.ts`, `models.ts`, `schemas.ts`). New installs default to Claude (Opus 5 writes,
    Haiku 4.5 judges, effort low); Phase 1 settings migrate on load.
  - Claude: no temperature where rejected, no effort on Haiku 4.5, server-side refusal fallbacks
    on Opus 5, Opus 5.5, Fable 5 and Fable 5.1, structured outputs, learn-and-retry on a 400
    naming a parameter. Non-streamed calls (judge, memory, test) never let the SDK re-send (a
    timeout there can follow a billed generation); they retry once on 429/529 only. Errors show
    the API's own message. The Models API's dated Haiku id is read as the alias
    (`claude-haiku-4-5`), which is what settings store and the pickers show.
  - OpenAI-compatible: `max_completion_tokens` and `reasoning_effort: 'low'` for api.openai.com,
    16000-token floor on OpenAI and xAI, parameter learning, refusals, a reasoning-only
    `length` reply is an `empty` error. Deep-research and -pro models aren't offered.
  - Safety of keys: keys stay per preset and are never exported; Claude, ChatGPT and Grok always
    use their own API address; an import keeps this device's address with this device's key;
    results carry the route without the key; a Custom slot pointed at api.anthropic.com moves to
    the Claude card (and calls through such a slot stop with a "use the Claude card" problem).
  - Diagnostics: billing ("out of credit", with the billing page), hosted 4xx show what the API
    said, setup problems (no model, no address) are caught before any request. Heat 4-5 policy
    note when Claude or ChatGPT writes the story.
- Android (ARCHITECTURE, "Android first"). Two ways to ship, one web build:
  - APK via CI (`.github/workflows/build.yml`): `cap add android`, icons and velvet theme patched
    in (splash icon also on Android 7 to 11), portrait, `adjustResize`, no Google backup, WebView
    debugging off, cleartext for LAN servers, versionCode = run number, pinned signing key, APK
    signer/package/version/cleartext/backup verification, `crushlab.apk` release asset. Only the
    release branch (`RELEASE_BRANCH`, defaulting to this branch) can become the update offered
    to installed apps; other branches publish prereleases. The token is read-only outside the
    release job.
  - PWA via Pages: built and deployed by the same workflow (offline shell, service worker on the
    web only, woff2-only precache, works under the /Monkeyball/ sub-path). Not live yet: Pages
    only accepts the default branch (see Known issues).
  - Platform layer (src/platform): back button (sheet, then screen, then minimize); `saveFile`
    through the share sheet, written in 1.5 MB pieces; native HTTP fallback for model calls
    blocked by CORS or the LAN, which never re-sends a POST unless a `/models` probe proves the
    WebView can't reach the server; update check against the release feed (Settings, App section,
    optional on-launch check, "Build N is ready" notice); velvet system bars; keyboard handling
    (bottom action bars stop sticking while typing); haptics helpers.
  - Diagnostics: LAN firewall/port advice; the https web app pointed at a plain-http server on
    another machine is explained as mixed content; a native HTTP error with an empty body is an
    answer, not "unreachable".
  - Icons (lipstick kiss in a brass coaster ring) by scripts/make-icons.mjs, including Android
    launcher, monochrome and splash-icon resources in assets/android/res.
  - `npm run e2e:android`: Pixel 7 touch emulation at 412x915 then 360x800, 48px touch targets,
    no sideways scroll, PWA install assets, sub-path service worker scope.
  - Checked only in CI (no Android SDK here; dl.google.com is blocked): the Gradle build, every
    styles.xml and manifest patch (the adjustResize, allowBackup and launch-theme greps), the
    signature, package, version, cleartext and backup checks, the prerelease/latest logic, and the
    Pages deploy. Checked only on a device (not done yet): see Known issues.

- Phase 2 (content), integrated, reviewed, fixed and checked end to end (not committed yet):
  - Data: 14 venues with CSS backdrops (`src/data/venues.ts`; home needs Lover, Thursday drag
    night note), 14 gifts with lock text (`src/data/gifts.ts`; both say "Friendship-locked" when
    given a friend route that can never reach the requirement), the Afterhours set (12 cards and a
    manifest with relationships and rumors) loaded by `src/data/bundled.ts`. Phase 6 set and
    character ids are reserved so nothing custom is shadowed when those sets ship.
  - Mods (`src/mods`): `normalize` (plural genders, loose JSON), `safety` (minor/childlike terms
    including "high schooler", "schoolchild", "jr high", "minors", "under 16"; ages under 21
    written in any field, such as "I'm only seventeen", "she's 16." or "Nova is 17"; the backstory
    may say "at 19" or "when she was 16" but not state the character's age; "minor key", "a minor
    in art history", "minority" and a backstory "childhood" pass), `validate` (the spec's rules plus
    one trait per list, a favorite venue, no venue or gift both loved and hated, lowercase
    hyphenated ids; cross-set relationships only through `knows` and never as partners or exes),
    `pack` (.json and .zip import that never throws, folder names in any case, cards next to the
    manifest, loose cards keep going without partners who aren't there; character JSON and pack zip
    export). Every bundled card passes the validator (`src/data/bundled.test.ts`).
  - Stores: `useRoster` (bundled sets, imported packs, "My characters" with id `custom`; save,
    duplicate, delete, import, remove pack, set on/off) and `useGame` (relationships, game state,
    news). Both load in the background at boot (App.tsx, own chunk), screens wait for them, and
    every mutation waits for the first load. Storage failures on a save or an import are told to
    the player; the stores' errors get the app's one-time storage warning.
  - Packs: re-importing a pack asks first when characters would leave or the name or author
    changed; a character whose new card fails keeps the earlier one; characters the player made in
    a pack stay in it on a re-import and move to My characters when the pack is removed. Every id on
    the device is checked per card, so one clash leaves out one card.
  - Screens: hub (coasters grouped by set with lipstick-stamp stages, trait counts, friend-route
    and jealousy marks; Show me, sort and set filters saved in settings; heat sheet; empty
    states), profile (stage, meters, route, agreement, "???" attractions/style/traits, venues and
    gifts tried out of 14, secrets with their unlock condition, partners once known with notes once
    the style is known, a gallery strip that visibly scrolls, Ask on a date), Character sets
    (toggle, blurb, who's in it, relationships, export, remove pack, import), editor (list,
    `#/editor/_new`, read-only bundled cards with Duplicate to edit and template export, live
    validation with each message at its field, 21+ enforced, locked world rules quoted, discard
    prompt on Back and the Android back button, JSON and .zip export, saved trait ids that don't
    follow label edits, a warning when an id would inherit a deleted character's progress),
    Settings "Character sets and mods". Every export goes through `saveFile`. Long unbroken words
    from packs wrap at 360px.
  - UI pieces: Coaster, LipstickStamps, Meter, Backdrop (built, used by dates in Phase 3),
    Portrait (placeholder art until Phase 5). Selected toggle chips carry a check; textareas grow
    with their text; the toast's Dismiss has a 48px hit area. Repeated editor controls have their
    row in the accessible name ("Like 2 Id", "Tier 3 Scene").
  - E2E: `npm run e2e:phase2` (Pixel 7 emulation, then 360x800 and 1280x800): 12 coasters, Show me
    and sort, Nova's profile, set off/on, duplicate Nova with the age rule, export JSON, import a
    .zip pack built on the fly, the replace-pack question, a lone card whose partner isn't there,
    a pack of long unbroken words at 360px (report sheet included). Shared Android helpers
    (`PIXEL_7`, `checkTouchScreen`, `quickOnboard`...) live in scripts/e2e/lib.mjs.

- Phase 3 (dating core), integrated, reviewed, fixed and checked end to end (not committed yet):
  - Engine (src/engine, pure, tested): `math.ts` (difficulty, venue and gift deltas, the date
    ledger with the +25 net gain cap, the meter's room and the friend-route cap, the -20 exit),
    `discovery.ts` (trait reveals with the judge's hint, venue and gift reactions, attractions and
    style when they come up, the player's style), `unlocks.ts` (tiers and secrets exactly once),
    `trust.ts` (a list of trust rules Phase 4 extends; +1 for a completed date), `memory.ts`
    (append, compress past ~250 words), `recap.ts`, and `dateFlow.ts`: the date contract
    (`createDate`, `openDate`, `sendPlayerMessage`, `retryLastReply`, `finishDate`) with a turn
    pipeline of small pure steps (`TURN_STEPS`: trust, affection, reveal, topics, connection,
    unlock, mood). Decisions are in ARCHITECTURE, "Date flow", "Phase 3 decisions".
  - Store `useDate` (src/store/date.ts) over the engine: model calls by role, persistence after
    every step, abort and resume, retry, End date, the open date remembered in kv `activeDate` so a
    reload or a killed app can still show that date's recap.
  - Screens: Date setup (venue grid with backdrops and locks, gift shelf, known reactions, the
    summary line; an interrupted date's recap on offer), Date (visual-novel text box over the
    backdrop, streaming with a caret, turn counter, status strip that expands to the meters and
    stamps, hints line with the judge's hint and what counted, suggestion chips that fill the
    input, composer above the soft keyboard, End date with a confirm that the Android back button
    also opens, "See how it went" after the last reply or the exit), Recap (meters before and
    after, stage, memory line in their voice, traits with hints, venue and gift, tiers, secrets,
    what it cost when they walked out), the debug panel's Transcript tab, "Back to the date" on the
    profile while a date is open. App boot opens an interrupted date's screen when the app starts
    on the hub.
  - Integration fixes: chips no longer run off the text box (one per row on a phone, side by side
    on a desktop, a sideways strip only in short windows, with scroll padding so the first chip
    isn't pinned to the edge); the status panel is nearly opaque over busy backdrops; venue cards
    and the recap hero have their own scrim so backdrop details don't cross the text; the
    duplicated "Nova is replying" (status line and placeholder) shows once; the transcript fades
    under the name plate; the portrait steps aside sooner when squeezed; the trust badge on the
    recap is brass; the hints line says when the date's limit held a gain back.
  - Review fixes: the +25 cap also bounds the meter's own rise over the date (a loss taken at 0
    no longer lets the meter climb past +25; `dateRiseRoom`, `dateGainUsed`); no sending while a
    reply is missing (the opening and every LANDED result stay in order), but Send works while the
    chips load; an abort during the reply-landed save no longer leaves the date stuck on
    "suggesting"; heat can change mid-date (status panel, and a declined turn's note) and reaches
    the next call, while the route, length and gain cap stay as the date began; the composer keeps
    focus (and the soft keyboard) between turns; the transcript only lets go of the latest line
    when the player scrolls up (a keyboard resize no longer does); each step saves the relationship
    and the record in one transaction; the walkout recap shows the date's running total; the turn
    counter stays on the turn played after an early exit or End date; what you learned lists only
    new venue and gift reactions; gifts read as noun phrases ("You brought a poetry book.",
    `Gift.phrase`); `{memory}` no longer calls a later date the first; home is "your place"; the
    memory call names the player and the gift; the judge gets `{others}` (characters the player has
    dated) and the ace-spectrum pace; the ace note names the character instead of "they"; the picked
    venue's full description shows under the grid.
  - Mock: `MOCK_OPENING_DELAY` paces opening beats (mid-stream screenshots); self-test covers it.
  - E2E: `npm run e2e:phase3` (Pixel 7 emulation, then 360x800 and 1280x800): connection via Other
    providers, Custom; a full 10-turn date with a like, a turn-off, chips and small talk; the heat
    sheet from the status panel; focus kept in the composer after sending with Enter; the emulated
    soft keyboard; the closing reply; the recap; a reload that keeps affection, traits and memory;
    the early exit (turn counter and the date's running total on the recap); the +25 gain cap
    with hints on; a restart on the hub mid-date.

- Phase 4 (relationships), integrated, reviewed, fixed and checked end to end (not committed yet):
  - Engine (src/engine, pure, tested): `agreements.ts` (seeing, others seen, disclosure terms,
    jealousy, the judge's `{opinion}`, Define-the-relationship availability and the character's
    own wish, the Agreement result, betrayal checks and their memory lines, the story's
    `{knownOthers}`, the map's standing line), `gossip.ts` (word of a date spreading one hop by
    relation, friend-route gossip lines, rumors on secret unlocks, `{sharedSecrets}`),
    `metamour.ts` (approval by relation, stored overrides), `rekindle.ts`, `endings.ts` (all seven
    in the ARCHITECTURE order, titles, descriptions, epilogue directions), `trust.ts` (the
    permanent grudge), and `dateFlow.ts` (turn steps for disclosure, breach, betrayal, heat pushes
    and jealousy; `openDtr`/`closeDtr`; `createEpilogue`; `finishDate` settles the world). Every
    acceptance scenario has a unit test (`src/engine/relationships.test.ts`).
  - Store `useDate`: the world is everyone in play, `openDtr`, `closeDtr`, `dismissDtrOffer`,
    `startEpilogue`, `persistWorld`, the automatic "Before {name}'s epilogue" slot
    (`src/store/epilogueSlot.ts`). Dev builds only: the debug panel's "Random rolls" field
    (`src/store/rolls.ts`) pins the game's rolls to succeed, fail or a seed.
  - Screens: Define the relationship on the date screen (sheet, the character's offer banner, the
    talk bar with Close the talk, the outcome in the transcript), the recap (agreement before and
    after, betrayal hits on the meters, gossip, rumors, "Word got around"), the polycule map
    (`#/map`) with person sheets, the ending screen (`#/ending/:id`), the profile's "Your ending"
    card, "What they know" and rumors, the hub's "Word around town", "Automatic" save slots.
  - Mock: the Agreement prompt accepts the requested type; "[decline]", "[counter]" and "[silent]"
    in the talk decline, counter with their style's agreement, or leave it unresolved.
  - Review fixes (ARCHITECTURE, "Phase 4 review decisions"; tests in
    `src/engine/relationships.fixes.test.ts` and the engine, prompt and store suites):
    - Betrayal: poly and open-with-telling-terms no longer betray the player for gossip about someone
      they told them about, or for gossip that got there first: it waits for the observer's next date
      (`heardSecondhand`) and counts only if that date ends without the player bringing it up (with
      the -10 approval then). A judge breach is read against the engine: once per date, never again
      for a break already counted, never for someone dated before the agreement, a denial is a lie,
      and owning up under exclusive is the softer confession ("Heard it from you"). With no
      agreement, the story hears "It was a lie, and {name} caught it."
    - Disclosure needs a dating context ("I had a drink with Kai last night", not "Kai poured me a
      drink"). "Seeing" lapses after 6 dates with other people (`GameState.dateCount`,
      `rel.lastDateIndex`), and under exclusive only people dated since the agreement count as
      someone they know you're seeing. {knownOthers} marks a break only while it's current (past
      tense once worked through, gone once the agreement changed).
    - Trust: misgendering always costs trust (at least -5) and at least -8 affection; relaying a
      false or exaggerated rumor to its subject costs trust (judge trustDelta capped at -4), and
      {sharedSecrets} tells the judge how to score relays and leverage; compersion and low-jealousy
      characters forgive once trust is back to 60 (`forgivenAt`).
    - The story: a betrayal turn's LANDED section says what broke (and the hints line shows the
      betrayal's note); the character's own Define-the-relationship wish is raised on the opening
      beat, told as theirs in the talk and to the Agreement prompt; {knownStyle} is what the player
      actually said or asked for (`toldStyle`), never the profile's style broadcast; gossip lines are
      voiced one per reply and rumors let slip in the next reply (rumors from a secret reached after
      the last reply wait for the next date's opening); a friend's repeated gossip comes last and
      only one "into you" line per date; the epilogue's last turn closes the story; the Sacrifice
      direction follows why it was chosen without a pronoun; Open says poly when it's poly.
    - Rekindles leave `rel.rekindle` on both (invites too: each knows about the other, approval at
      least 60), reach {partners}, {opinion} and a one-time opening note, skip pairs with someone
      from the date that just ended, and show on the map.
    - Metamour approval: +5 for each metamour the player talks about on a date under poly (once per
      date), so honest poly play can reach the Polycule ending in any order.
    - Screens: the recap shows another character's betrayal as a hit on their meters, "Your ending"
      when a date reaches 100 ("See your ending"), and the agreement that stands after a declined
      talk; the hub's jealousy mark is someone the player still sees and they mind (never a friend
      route; a raw betrayal shows on the profile and map); Define the relationship is offered on a
      romantic route only; the map's person sheet no longer quotes the judge's opinion; the
      profile's line uses first names and "is happy for you" for compersion.
    - Store: the date's last save and the world go in one transaction (`persistAll`); End date while
      the talk is closing waits for the Agreement answer; an unusable Agreement reply keeps the talk
      open; `patchGame` keeps news under `MAX_NEWS`.
  - E2E: `npm run e2e:phase4` (dev server, 32 steps; see ARCHITECTURE, Testing). Integration fixes:
    copy that picked a pronoun for a named character ("They can say yes", "in their words", "at
    their pace", "Their profile keeps it") now uses names; the epilogue recap's ending is lower-case
    mid-sentence; gossip news no longer repeats "Word got around"; gossip lines on the recap end as
    sentences; the DTR sheet's description no longer repeats the name; the map's legend has the
    faint "Seeing, no agreement" thread; the store no longer imports a screen module for the slot
    helpers; the roster tests and the Phase 2 e2e no longer assume Afterhours is the only bundled
    set.

- Phase 5 (gallery and art), integrated, reviewed, fixed and checked end to end (not committed yet;
  ARCHITECTURE, "Art" and "Art providers"):
  - Engine (src/art): slots and keys (`types.ts`), the prompt builder with the frozen
    `IMAGE_SAFETY` text (`imagePrompt.ts`: every participant's adult age from the card, the
    safety clause, the negative prompt, the Grok clause; player and mod text scrubbed; a card under
    21 gets no prompt), Automatic1111/Forge and Grok Imagine providers with diagnosed errors
    (`providers.ts`), the resolver (imported, bundled via `virtual:bundled-art`, generated,
    placeholder) with a shared blob-URL cache and `useArt` (`resolve.ts`), painting, caching,
    Regenerate, the player's own image, favorites, background painting at unlock and at an ending
    (`generate.ts`, called from the date store's saves), the gallery's slots and locks (`slots.ts`),
    and stored-picture sizes with 640px thumbnails for tiles and coasters (`compress.ts`).
  - Screens: the recap's instant-film reveal (`src/ui/InstantFilm.tsx`, once per unlock via
    `DateRecord.artShown`; a 0.4 s fade with reduced motion), the gallery (`#/gallery`,
    `#/gallery/:id`: tiers, reachable endings, group pictures, favorites) and its full-screen viewer
    (swipe, Favorite, Save image, Use my own image, Remove my image, Regenerate with a side-by-side
    compare, Generate art on a placeholder), Portrait on every screen, the profile strip opening the
    viewer, Settings, Image generation (provider, options, read-only safety text, Test image
    generation), the editor's tier images.
  - Integration fixes: the reduced-motion fade survived the app-wide reduced-motion rule (it was cut
    to 0.01 ms); the viewer and the Regenerate compare fit a picture of any shape and size whole
    (small ones were drawn at their natural size, big ones clipped); locked endings say "Unlocks when
    it plays" under their title instead of repeating "Ending"; favorites say whose picture it is;
    the gallery's accent glow no longer shows a seam on wide screens; "New in Nova's gallery"
    instead of "their"; A1111 help says "this device", not "this phone"; thumbnails (the builders
    decoded full pictures for every tile); the debug panel's Prompts tab has the Image prompt, a
    Live preview mode and "Preview with" any character (their real relationship, so heat and ace
    gates show); the dev-only `crushlab.debug.xaiBase` override for e2e; the mock counts requests
    (`GET /__mock/requests`) and paints 160x240 portraits, a new color for each Grok picture.
  - Phase 1 e2e flake (step 25, desktop, "the quiet check fails and connection setup opens"): the
    setup screen took the onboarding check's problem out of its module variable inside a
    `useState` initializer. When React throws that first render away (a render interrupted or
    restarted while the lazy screen is revealed) the second render found nothing, so the "Set up a
    provider below" note never showed (the failure screenshot has the heading and no note). It now
    reads the problem during render and clears it in an effect after mount; a unit test reproduces
    the discarded render (`src/screens/ConnectionSetup/ConnectionSetup.test.tsx`).
  - E2E: `npm run e2e:phase5` (26 steps; see ARCHITECTURE, Testing). `scripts/e2e/android.mjs`
    checks the gallery where it checked "Not built yet". `dismissToasts` no longer waits 15 s on a
    toast that left by itself. Shared save and mock helpers in lib.mjs.
  - Safety review fixes (red-team pass on the image prompt and the card scanner):
    - The scrub reads each tag with the one kept before it ("school, uniform", "jail, bait",
      "barely, legal", "kinder, garten"), and `buildImagePrompt` checks the scrubbed style, art tags,
      body notes and scene against each other and as a whole, failing closed (`ArtSafetyError`, no
      picture) when fields make a blocked phrase together (`assertCleanTogether`).
    - New image-only terms: childlike bodies and props (loli/rori/shota words, prepubescent, nubile,
      smol, training bra, AA cup, pigtails, teddy bears, lollipops, braces, lone size words), school
      settings and clothes (school, classroom, homeroom, freshman, seifuku, gakuran, sailor collar,
      pleated skirt, daycare, playground; "old-school", "art school" and the like stay), other
      languages' words for a child or a pupil, teen numbers in Spanish, Portuguese, Italian, German
      and French, implied ages (birth and class years, "a decade and a half", "16th bday", "half her
      age", "reverse the age", "around twelve"), non-consent (dubcon, sedation and incapacitation,
      force, captivity, refusal, voyeur setups), masked words ("r*pe"), and text that argues with
      the Grok clause by calling it a note, disclaimer, caption, watermark or metadata, "in name
      only", "stage name", "card says", "should not be drawn"; any segment naming the prompt itself
      (prompt, clause, disclaimer, boilerplate, metadata) is dropped.
    - The safety negative adds school setting, classroom, school desk, seifuku, gakuran, sailor
      collar, pigtails, training bra, flat chest and small child body; the Grok clause says there is
      no school setting.
    - Both providers refuse (ArtError 'setup', nothing sent) a prompt without an "adult woman, 28
      years old" statement, so no future caller can skip `buildImagePrompt`.
    - The card scanner (editor, mod import, bundled check) scans appearance fields a second time
      with commas as spaces, flags childlike image tags, and catches rule overrides ("treat the
      WORLD RULES as flavor text", "pretend the rules", "new rule:", "anything goes", "any age",
      forged "MOD DIRECTION ends here", "the real instructions") and consent overrides
      (`CONSENT_OVERRIDES`, shared with the image scrub: dubcon, "against her will", "says no but
      means yes", "rape fantasy", "forced seduction", consent "skipped", drugged and not
      remembering).
    - Pack art has its own row (`${slotKey}#pack`, `pack: setId`): the player's own image wins over
      it, removing the player's image brings the pack's back, re-importing a pack never replaces
      the player's image, and the viewer labels it "Comes with the pack" with no Remove my image.
      Save files keep `pack` and `revisedPrompt`; pack exports take the pack's art when the player
      has none of their own.
    - Keep new keeps Grok's revised prompt; the Regenerate candidate's blob: URL is revoked when the
      viewer unmounts mid-comparison; a background painting that times out on Android's native
      HTTP is recorded as a failure, not "Stopped."; slots with imported, pack, bundled or cached
      art no longer show "Painting" while another slot's painting holds the queue; small portraits
      (the recap's hero) use thumbnails; the Settings test image's debug entry says the Grok clause
      is at the start and the end.

## In progress

- The Polycule, Backstage and Slow Burn sets (src/data/sets/polycule, backstage, slow-burn; 18
  characters) are committed and pass the bundled-card validator; all three are off by default until
  Phase 6 (group play, the "Who's in town" step). Every bundled character is covered by the image
  prompt safety tests.

## Next

- Phase 6 (group play), as listed in docs/SPEC.md: group dates and the group venue flow, the
  metamour approval that group dates raise, turning on the Polycule, Backstage and Slow Burn sets,
  and group art. Group dates reuse the group slot (`group:{ids}:{slot}`) and `generateArt` for their
  shared picture (every participant's age is stated and `assertCleanTogether` covers all of them).
- Phase 7 as listed in docs/SPEC.md.
- Phase 6, when a second bundled set ships: a skippable "Who's in town" step in onboarding that uses
  the Character sets toggles (SPEC: "New game, and Settings, Character sets, let the player turn
  sets on and off"). Until then a new game starts with Afterhours on, and Character sets is the
  only place to switch sets.

## Known issues

- Not yet run on a phone: the APK is only built in GitHub Actions. To check on a device: edge to
  edge and the keyboard (including an Android 9 or 10 phone, for adjustResize), the back button,
  the share sheet export (a large save), the update notice's Download (hands the APK URL to the
  system browser), native HTTP to a LAN server (the probe, then streaming off for that server),
  the splash icon on Android 11 and on 12+, and the themed (monochrome) launcher icon.
- The PWA isn't live: the repository's default branch is still the old game
  (claude/monkey-ball-clone-game-nsuhza), and the github-pages environment only deploys the
  default branch, so the pages job fails softly (continue-on-error) and
  mreindl118-boop.github.io/Monkeyball/ still serves the old game. The repo owner needs to make
  crushLAB's branch the default (then delete .github/workflows/build.yml from the old branch, or
  the branch itself, so it can't redeploy the game over that URL or take the latest release) or
  add this branch under Settings, Environments, github-pages. The README and release notes say so
  until then.
- `RELEASE_BRANCH` falls back to claude/repo-fresh-start-gxm2p6 in the workflow; set the repository
  variable when crushLAB moves to another branch, or its builds will publish as prereleases and
  installed apps won't be offered them.
- No Google backup of app data (keys and history stay on the phone); moving phones means exporting
  a save and importing it.
- Sideloading may need a registered developer from September 2026 (Android developer
  verification, starting in Brazil, Indonesia, Singapore and Thailand; worldwide in 2027): register
  app.crushlab.game with the signing/debug.keystore certificate before it reaches the player.
- A server proven blocked for the WebView stays on native HTTP (no streaming) until Test
  connection runs or the app restarts, even if CORS gets fixed in between.
- After a reload the in-app stack is empty, so in-app Back goes to the hub; browser back from
  there can still revisit screens from before the reload (they are real history entries).
- A key typed for the Custom preset stays with Custom when its base URL is edited to another
  host (each preset keeps one address and one key).
- Claude streams have no idle timeout between chunks; the SDK's timeout covers only the start of
  the response.
- Ready marks and model lists on the provider cards are in memory only; they reset on reload.
- Removing an imported pack keeps any tier art it brought in the images table (progress is kept
  too, so a re-import picks up where it left off).
- Not checked on a device: whether the APK's file picker lets a .json through when the storage
  provider reports it as octet-stream or plain text (the picker's accept list now includes both;
  the importer checks the content either way).
- Show me Women or Men leaves nonbinary characters out (they show under Everyone, and the control
  says so). Revisit if players expect them in both.
- Bundled sets and cards export as templates that can't be imported as they are (every copy of
  crushLAB has those ids); the export says to change the ids first.
- A single exported .json card leaves its partners behind: on import they are left off the card
  with a note. The .zip export takes partners along.
- Written ages in card text are caught by patterns ("17 years old", "I'm only seventeen", "she's
  16.", "Nova is 17", "turned 18"); unusual phrasings can still slip past, and the scan can flag a
  count that reads like an age ("we were two."), which the author has to rephrase.
- When storage refuses a save or an import, the character or pack stays for the session only (the
  player is told); deleting while storage fails comes back after a restart (only the one-time
  storage warning says so).
- `defaultRelationship` (src/store/defaults.ts) duplicates `newRelationship`
  (src/engine/relationship.ts); a test keeps them equal.
- Haptics: a stamp press (LipstickStamps, and the date's mood kiss when affection moves), a saved
  card, an import, a secret unlocked on the recap and each developed instant-film print use them.
- Phase 3, not checked on a device yet: the Android back button on a date (asks before ending it),
  haptics on the date and the recap, the real soft keyboard (only emulated at 412x560 in e2e), and a
  date over native HTTP (no streaming there: the reply arrives whole).
- A date recovered after a restart is recapped as ended early ("You ended the date early.") unless
  every turn was played; there is no separate wording for an interrupted date yet.
- `rel.dates` counts a date the character walked out of (so the first-date opener isn't reused);
  the +1 consistency trust is for completed dates only.
- A gain the meter can't hold (friend-route 59, or 100) doesn't count toward the date's +25, and
  losses always count in full toward the -20 exit, so the date's total can differ from the meter's
  change (ARCHITECTURE, math.ts). The meter's net rise per date is capped at +25 either way; the
  hints line says when a loss counted but the meter was already at 0.
- A date filed as abandoned ("Back to the hub" on the interrupted panel, or starting another date
  while one was left open) keeps what it changed but adds no memory and doesn't count toward
  `rel.dates`, so after an abandoned first date the next one is still a first date (opener
  included). The button doesn't say the date is set aside without a recap.
- The composer's focus is kept in Chromium (e2e); whether the Android WebView keeps the soft
  keyboard up for a read-only field between turns is still to be checked on a device.
- The date's settings refresh before each call except the orientation mode and the profile, which
  stay as the date began (changing either mid-date could switch the route).
- Phase 4: rumors heard and passed on, name-mention disclosures (and who the player talked about,
  which settles gossip a character was waiting to hear), the rumors and gossip lines voiced, and
  friend-route gossip reveals live on the date session until the date finishes; a date recovered
  after a restart loses them (a recovered date can then count unconfirmed gossip as a betrayal).
- Phase 4 reads the player's words with English keyword heuristics: a name in a dating context,
  denials and admissions (how a judge breach is taken), rumor relays, and the style the player
  claims. Unusual phrasings can be missed or misread; the judge's own numbers are the fallback.
  Using a rumor as leverage is scored by the judge only (the engine has no rule for it).
- "Seeing" lapses by count (6 dates with other people since), not by time: a player who dates
  someone once a month and nobody else in between still counts as seeing them.
- Gossip a poly character is waiting to hear from the player only turns into a betrayal at the end
  of their next date; if the player never dates them again, nothing happens.
- Metamour approval rises only through disclosure under poly (+5 per metamour per date) until group
  dates (Phase 6), so pairs that start low (exes 35, rivals 40) take several honest dates to reach
  the Polycule's 60.
- The hub has no "epilogue ready" mark; the recap of the date that reaches 100 and the profile show
  the ending.
- Recaps saved before the review fixes have no meters for other characters' betrayals and show the
  numbers in words.
- Phase 4, not checked on a device: the Android back button closing the DTR sheet and the map's
  person sheet (both are Sheets, so they register as overlays), and the soft keyboard while the talk
  bar is showing.
- The polycule map's circles respond to taps only; keyboard and screen-reader users use the list
  under the map (same person sheets).
- `npm run e2e:phase4` runs on the vite dev server, not the production build, because the pinned
  rolls are dev-only; the production build is covered by the Phase 1 to 3 and Android scripts.
- The ending descriptions keep the spec's generic "them" ("You and them, the future is open.").
- Phase 5, not checked on a device or against the real services: native HTTP to an A1111 server on
  the LAN, xAI's actual image API (its `aspect_ratio` field and moderation answers follow
  ARCHITECTURE; docs.x.ai was unreachable from here), the share-sheet Save image, the file picker
  for Use my own image, haptics on the reveal, memory use with many painted characters.
- Tiers unlocked before Generate art was turned on (or in an imported save) aren't painted by
  themselves; the viewer's Generate art paints one on request.
- Renaming a saved custom character's id leaves their images (and favorites) under the old id.
- A1111 prompt syntax in style prefixes and cards is flattened (weights, LoRAs, BREAK), so a style
  prefix can't use LoRAs; that is what keeps the safety clause from being muted.
- Save files exported with images don't carry thumbnails; each tile makes its own the first time
  it's shown after the import.
- The debug panel's log is in memory: an image prompt logged before a reload is gone after it (the
  Live preview assembles the current one any time).
- Toasts sit over the bottom of the viewer for their few seconds (Use my own image, Keep new).
- The image scrub and the card scanner are pattern lists: they catch the red-team phrasings in
  `src/art/imagePrompt.redteam.test.ts` and many variants, but a determined phrasing can still slip
  past a pattern; the frozen negative prompt, the positive clause and the Grok clause are the floor
  under them. They also drop some harmless tags (a lone "tiny", "pleated skirt", "helpless(ly)"
  in some forms, "captured" before a noun that isn't a camera or a face word, any "school" word
  that isn't "old-school", "art school" and the like), and a card whose fields combine into a
  blocked phrase gets no picture at all (the viewer shows why).
- A1111 and Forge fire a textual-inversion embedding whenever its file name appears as a plain word
  in the prompt. The app can't know what a server's embeddings contain, so a server with a
  harmless-sounding embedding that encodes childlike features could be triggered by an art tag;
  only the negative prompt and the positive clause guard against that (ARCHITECTURE, "Art
  providers"). Self-hosted servers are the player's responsibility.
- Pack art stored before the `#pack` key (earlier Phase 5 builds only) sits under the plain slot
  key, where it counts as the player's own image.
