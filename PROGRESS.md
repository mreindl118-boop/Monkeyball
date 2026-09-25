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

## In progress

- Nothing; Phase 2 (content) is next. The Afterhours set files have landed ahead of it.

## Next

- Phase 2 (content): venues, gifts, set manifest format, the Afterhours set, Character sets
  screen, roster hub, profile, character editor with validation, mod import/export. Then
  Phases 3 to 7 as listed in docs/SPEC.md.

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
- Haptics exist (src/platform/haptics.ts) but no control uses them yet (stamp press and unlocks
  arrive in later phases). The date engine should use `refusalBeat` and `REFUSAL_NOTE`, show a
  `setup` or `empty` LlmError through `explainRoleError`, and mark its bottom composer
  `data-keyboard-static` (Phase 3).
- The debug panel's Transcript tab is a placeholder until dates exist (Phase 3).
