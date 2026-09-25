# crushLAB progress

Spec: docs/SPEC.md. Build contract: docs/ARCHITECTURE.md. Casting: docs/ROSTER.md.

## Done

- Foundation: Vite + React + TS scaffold, dependencies, shared types (src/types.ts), Dexie schema
  (src/db/db.ts), hash-synced navigation store (src/store/nav.ts), design tokens (src/ui/tokens.css),
  Nova's reference card.
- Android release pipeline: Capacitor 8 config and CI that builds, signs and publishes the APK.
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

## In progress

- Nothing; Phase 2 (content) is next.

## Next

- Phase 2 (content): venues, gifts, set manifest format, the Afterhours set, Character sets
  screen, roster hub, profile, character editor with validation, mod import/export. Then
  Phases 3 to 7 as listed in docs/SPEC.md.

## Known issues

- Export in the Android app: the WebView can't download blobs, and the Filesystem + Share
  plugins that src/platform/files.ts needs aren't installed yet (new dependencies). Until then the
  APK says "Export isn't available in the Android app yet" instead of exporting. The web and PWA
  export normally.
- src/platform/backButton.ts (close the top sheet with closeTopOverlay(), else useNav.back(),
  minimize at the hub) is not written. Capacitor's default back walks browser history, which is
  now clean, but an open sheet isn't closed first.
- After a reload the in-app stack is empty, so in-app Back goes to the hub; browser back from
  there can still revisit screens from before the reload (they are real history entries).
- A key typed for the Custom preset stays with Custom when its base URL is edited to another
  host; only switching presets isolates keys.
- The Custom preset pointed at api.openai.com sends `max_tokens`, which newer OpenAI models reject;
  the ChatGPT preset (max_completion_tokens) is planned in ARCHITECTURE's Providers section.
- The "Check for updates" setting and on-launch update check (src/platform/updates.ts) are not
  built yet. Haptics are not wired.
- The debug panel's Transcript tab is a placeholder until dates exist (Phase 3).
