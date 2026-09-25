# crushLAB progress

Spec: docs/SPEC.md. Build contract: docs/ARCHITECTURE.md. Casting: docs/ROSTER.md.

## Done

- Foundation: Vite + React + TS scaffold, dependencies, shared types (src/types.ts), Dexie schema
  (src/db/db.ts), hash-synced navigation store (src/store/nav.ts), design tokens (src/ui/tokens.css),
  Nova's reference card.
- Android release pipeline: Capacitor 8 config and CI that builds, signs and publishes the APK.
- Phase 1 (scaffold), integrated and checked end to end:
  - App shell: 18+ gate, onboarding (player profile, orientation mode, quiet connection check),
    connection setup, Phase 1 hub, Settings (connection, profile, play, images, saves, reset),
    debug panel (long-press the version number), "Not built yet" screen for later phases.
  - UI kit in src/ui (buttons, fields, segmented, heat control, sheets, toasts, long press...).
  - Stores and persistence: settings/profile store over Dexie kv, repo helpers, save
    export/import and save slots.
  - Model platform: presets, SSE parser, defensive JSON, streaming/JSON client with the
    response_format fallback and nudge retry, connection diagnostics (CORS vs unreachable vs
    auth vs model), prompt templates and builders, heat levels, stages and routes, debug log.
  - Mock OpenAI-compatible server (scripts/mock-llm.mjs, `npm run mock-llm`, self-test with
    `npm run mock-llm:selftest`).
  - E2E: `npm run e2e:phase1` builds the app, serves it with vite preview, starts the mock and
    walks the first-launch flow at 390x844 and 1280x800 (acceptance check: the profile and
    heat show up in the assembled story prompt in the debug panel and survive a reload; hash
    navigation can't skip the gate or onboarding; a server without CORS headers is diagnosed as
    CORS). Screenshots land in scripts/e2e/out/ (git-ignored). Helpers in scripts/e2e/lib.mjs.

## In progress

- Nothing; Phase 2 (content) is next.

## Next

- Phases 2–7 as listed in docs/SPEC.md.

## Known issues

- Exports use a web-only download shim (src/screens/Settings/saveFile.ts) until
  src/platform/files.ts lands; the Android back button handler (src/platform/backButton.ts,
  should call closeTopOverlay() first) is not written yet.
- The "Check for updates" setting and on-launch update check (src/platform/updates.ts) are not
  built yet. Haptics are not wired.
- The debug panel's Transcript tab is a placeholder until dates exist (Phase 3).
