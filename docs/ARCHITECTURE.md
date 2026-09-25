# crushLAB architecture

The build contract. docs/SPEC.md is the product spec; this file says where things live, how
modules talk, and how the spec's open questions were settled. Anything here that conflicts with
SPEC.md loses, except where a decision below explicitly resolves an ambiguity.

## Stack and commands

- Vite 8 + React 19 + TypeScript 6, zustand 5, Dexie 4, framer-motion, jszip, vite-plugin-pwa.
- `npm run dev` — dev server. `npm run build` — `tsc -b && vite build`. `npm test` — vitest.
  `npm run lint` — oxlint. `npm run mock-llm` — local OpenAI-compatible mock on :11435 (see Testing).
- Styling: one global token sheet (`src/ui/tokens.css`) plus CSS Modules (`*.module.css`) per
  component or screen. No CSS-in-JS, no Tailwind.
- Fonts: `@fontsource/bodoni-moda` (400, 400-italic, 600, 600-italic) and
  `@fontsource-variable/figtree`, imported once in `src/main.tsx`.

## Directory layout

```
docs/                 SPEC.md (verbatim product spec), ARCHITECTURE.md, ROSTER.md
scripts/mock-llm.mjs  mock OpenAI-compatible server for dev and e2e
scripts/e2e/*.mjs     playwright-core smoke scripts (use /opt/pw-browsers chromium)
public/               icons, manifest assets, public/art/{setId}/{characterId}/tier-{n}.(webp|png|jpg)
server/               Phase 7 LAN server (optional)
src/
  main.tsx            fonts, tokens.css, <App/>
  App.tsx             boot (load stores), first-launch flow, screen switch
  types.ts            ALL shared data contracts (read this first)
  db/db.ts            Dexie schema + typed tables
  db/repo.ts          small typed helpers (kv get/put, relationships, dates, images, saves)
  store/              zustand stores (see Stores)
  llm/                OpenAI-compatible client, SSE, JSON parsing, presets, diagnostics
  prompts/            *.txt templates (verbatim wording) + build.ts (placeholder filling)
  engine/             pure game logic (math, stages, discovery, agreements, betrayal, gossip,
                      endings, date orchestration). No React, no Dexie imports in pure modules.
  data/               venues.ts, gifts.ts, heat.ts, sets/{setId}/manifest.json + characters/*.json,
                      bundled.ts (import.meta.glob loader)
  mods/               normalize.ts, validate.ts, safety.ts, pack.ts (json/zip import+export)
  art/                ArtProvider interface, providers (imported, bundled, a1111, placeholder),
                      imagePrompt.ts (locked safety text), resolve.ts
  ui/                 shared components (Button, Sheet, Coaster, LipstickStamps, Meter, Backdrop,
                      InstantFilm, Field, Toggle, Segmented, Chip, Placeholder art...)
  screens/            one folder per screen: Gate, Onboarding, ConnectionSetup, Hub, Profile,
                      DateSetup, DateScreen, Recap, Gallery, PolyculeMap, CharacterSets, Settings,
                      Editor, Debug, Ending
```

## Navigation

`src/store/nav.ts` — `useNav` holds a `Screen` union and a stack; `go(screen)`, `replace(screen)`,
`back()`. It mirrors the current screen into `location.hash` (`#/profile/nova`) so the browser back
button works and a reload lands on the same screen (screens must tolerate missing state, e.g. a
reload on `#/date` with no active date goes to the hub).

## Persistence (Dexie, `src/db/db.ts`)

Database name `crushlab`. Tables:

| table | key | contents |
|---|---|---|
| kv | `&key` | `settings`, `profile`, `game` (GameState), `ui` misc |
| relationships | `&characterId` | `Relationship` |
| customCharacters | `&id, setId` | `{ id, setId, character, source: 'imported'\|'custom', updatedAt }` |
| packs | `&id` | `{ id, manifest: SetManifest, importedAt }` (imported sets/packs) |
| dates | `++id, startedAt, *characterIds` | `DateRecord` (transcripts, written every turn) |
| images | `&key, characterId` | `StoredImage` (imported + generated art, blobs) |
| saves | `&id, createdAt` | `{ id, label, createdAt, data: SaveBlob }` save slots / autosaves |

Bundled characters are never written to Dexie; they come from `src/data/sets`. A custom character
with the same id as a bundled one is not allowed (duplicating gives a new id, e.g. `nova-copy`).

Save export = JSON of kv(profile, settings minus apiKey unless opted in, game), relationships,
customCharacters, packs, dates; images optional (base64). Import replaces everything after confirm.

## Stores (`src/store/`)

- `settings.ts` — `useSettings`: `{ loaded, settings: Settings, profile: PlayerProfile | null,
  load(), update(patch), updateConnection(patch), updateImage(patch), setProfile(p) }`. Every
  mutation persists to kv. Defaults live in `src/store/defaults.ts`.
- `roster.ts` — `useRoster`: `{ loaded, sets: SetManifest[] (bundled + packs), entries:
  Record<string, RosterEntry>, load(), reload() }` plus selectors `activeEntries(settings)`,
  `setOf(id)`, `relationsFor(id)` (manifest relationships + card partners, deduped).
- `game.ts` — `useGame`: `{ loaded, relationships: Record<string, Relationship>, game: GameState,
  load(), rel(id) (creates default lazily), saveRel(rel), patchGame(patch), addNews(...) }`.
- `date.ts` — `useDate`: the active date session (see Date flow) and its actions.
- `debug.ts` — `useDebug`: ring buffer (last 200) of `DebugEntry` + the last assembled prompt per
  kind. Every LLM/image call logs here. In-memory only.
- `nav.ts` — `useNav` (above).

## LLM (`src/llm/`)

- `presets.ts` — the four presets from the spec table.
- `sse.ts` — incremental SSE parser for `data:` lines, handles `[DONE]`, split chunks, CRLF.
- `json.ts` — `extractJson(text)`: strip ``` fences, take the first balanced `{...}` block,
  `JSON.parse`; returns `null` on failure.
- `client.ts` —
  - `streamChat({ conn, model, messages, temperature, maxTokens, signal, onDelta, debug })` →
    full text. POST `{baseUrl}/chat/completions` with `stream: true`; falls back to reading a
    non-streamed JSON body if the server ignores `stream`.
  - `chat(...)` non-streaming → text.
  - `jsonChat<T>({ ..., coerce: (raw: unknown) => T | null, fallback: T })` → `{ value, ok, raw }`:
    sends `response_format: {type:'json_object'}` unless this baseUrl+model is known to reject it
    (a 400/422 whose body mentions response_format/json → remember and retry without); parse with
    `extractJson` + `coerce`; on failure retry ONCE with an extra user message
    `Reply with valid JSON only. No prose, no code fences.`; then return `fallback`. Never throws
    for parse problems (network errors still throw so the UI can say what to fix).
  - Judge calls always use temperature 0.2 and `conn.judgeModel || conn.storyModel`.
  - `listModels(conn)` → `string[]` from GET `{baseUrl}/models` (`data[].id`).
  - Auth header `Authorization: Bearer {apiKey}` only when a key is set. OpenRouter also gets
    `X-Title: crushLAB`.
- `diagnose.ts` — `testConnection(conn)` → `{ ok, models, steps[], problem?: { kind:
  'cors'|'unreachable'|'auth'|'model'|'other', message, fix } }`. Distinguish CORS from
  unreachable by retrying with `fetch(url, { mode: 'no-cors' })`: an opaque success means the
  server is up but blocks CORS. Fix text: Ollama → "Set OLLAMA_ORIGINS=* (or this app's origin)
  and restart Ollama"; LM Studio → "Enable CORS in LM Studio's server settings"; 401/403 → bad
  key; model not in list or 404 on completion → unknown model.

## Prompts (`src/prompts/`)

Templates are `.txt` files imported with `?raw`, wording exactly as in SPEC.md:
`story.txt`, `judge.txt`, `agreement.txt`, `suggestions.txt`, `memory.txt` (+ `groupStory.txt`,
`groupJudge` reuses judge.txt per character, Phase 6). `build.ts` exposes
`fill(template, values)` (replaces only `{key}` for keys present in `values`; JSON braces in the
templates are left alone) and builders:

- `buildStoryPrompt(ctx: StoryContext): string`
- `buildJudgePrompt(ctx: JudgeContext): string`
- `buildAgreementPrompt(ctx): string`
- `buildSuggestionsPrompt(ctx): string`
- `buildMemoryPrompt(ctx): string`

Decisions:
- The judge template's `{opinion} (e.g. "…" or "…")` parenthetical is implementer guidance; the
  runtime prompt keeps `{name}'s current opinion: {opinion}` and drops the "(e.g. …)" text.
- `{likes as "id: label"}` renders as `vinyl: Vinyl records and liner-note trivia; diner: …`.
  In the story prompt, traits render as labels only, separated by "; ".
- `{last 4 turns}` renders as lines `Player: …` / `{Name}: …`. `{dtr turns}` likewise.
- On turn 0 the whole "HOW THE PLAYER'S LAST MESSAGE LANDED" section (header + 3 lines) is removed.
- `{playerBodyNotes}` is only included at heat 4–5 and only when set; otherwise empty. `{bodyNotes}`
  (character) is included at heat 4–5; below that it renders as "Not relevant at this heat."
- `{playerGender}` uses the custom label when set. `{knownStyle}` is the player's style in plain
  words when `rel.knowsPlayerStyle`, else "Nothing yet; they haven't talked about it."
- `{heatDescription}` = `heat.ts` description for `effectiveHeat(character, rel, settings.heat)`:
  `min(heat, aceSpectrum.heatCap)`; and when `heatUnlockTrust` is set and trust is below it,
  `min(heat, 2)`.
- `{aceNote}` is built from aceSpectrum, e.g. "Demisexual: nothing past heat 2 until trust is over
  60, and that is who they are, not a puzzle." / "Asexual: heat never goes past 2, and that is who
  they are, not a puzzle."
- Friend-route gossip and earned rumors ride inside existing placeholders: gossip the character is
  happy to share is appended to `{partners}`; rumors they've passed on are appended to `{secrets}`.
- Phase 7 overrides are appended after the full base prompt under a `MOD DIRECTION` header; the
  base prompt (WORLD RULES and CONTENT) is never replaced or edited.
- Messages sent for the story call: `system` = story prompt, then the date so far as alternating
  `user` (player) / `assistant` (character) messages; on turn 0 a single user message
  `(The date begins.)`. Judge/agreement/suggestions/memory are one `system` prompt + one short
  `user` instruction ("Score the new message." etc.).

## Engine (`src/engine/`, pure, unit-tested)

- `stages.ts` — `stageFor(affection)`, `STAGES` (label, min), `stageIndex`, `routeFor(character,
  profile, orientationMode)`, `affectionCap(route)` (friend route: 59), `playerBucket(profile)`
  (custom gender uses `matchAs`, default nonbinary).
- `math.ts` — `applyDifficulty(delta, difficulty)` (×1.25/×1/×0.75, `Math.trunc`),
  `venueDelta`, `giftDelta`, `DateLedger` helpers: `applyAffection(total, delta, cap)` clips
  positive deltas so the date's net gain never exceeds `gainCap`; losses are uncapped;
  `leftEarly(total)` is `total <= -20`. Clamp 0–100 and the friend-route cap.
- `discovery.ts` — `revealHits(character, rel, judge)` (ignores unknown ids, no duplicates,
  judge hint is the caption), `recordVenue`, `recordGift`, `detectTopics(message)` →
  `{ attractions, style, playerStyle }` keyword heuristics that reveal a character's
  attractions/style when they come up, and mark `knowsPlayerStyle` when the player talks about
  how they date.
- `unlocks.ts` — `newTiers(character, rel, route)` (romantic: affection ≥ unlockAt; friend route:
  tiers 1–2 only), `newSecrets(character, rel, route)` (romantic: affection ≥ unlockAt; friend
  route: trust ≥ unlockAt — friends earn secrets through trust, since affection caps at 59).
  Each tier/secret unlocks exactly once (persisted lists).
- `trust.ts` — trust application: difficulty-scaled judge trustDelta; after any betrayal, positive
  trust gains are multiplied by a grudge factor (compersion/low 0.75, medium 0.5, high 0.34);
  +1 trust per completed date (consistency); `breach` → extra trust penalty so a caught lie always
  costs more trust than affection.
- `agreements.ts` — `seeing(rel, route)` (romantic route, ≥1 date, affection ≥ 20),
  `othersSeen(playerRels, exceptId)`, `disclosureRequired(agreement)` (poly always; open when terms
  mention telling/knowing/disclosing), `checkBetrayal(observer, learnedAbout, how)` → a
  `BetrayalEvent | null` (exclusive: any other person dated after `agreement.madeAt`; poly/open-with-
  disclosure: only when learned through gossip rather than from the player), severity scaled by
  jealousy within the spec ranges (affection −10..−20, trust −15..−30), `isJealous(character, rel)`.
- `gossip.ts` — after each date, propagate "the player is seeing X" to characters connected to X
  (manifest relationships and partners) with a seeded RNG: partner/housemate/roommate/bandmate
  0.5, coworker/friend 0.35, ex 0.3, rival 0.25, same-set otherwise 0.1. Different sets never
  talk unless a manifest `knows` links them. Friend-route gossip facts (another character's
  attractions/style, who's into you = anyone at 60+, who's seeing whom). Rumors: when a teller's
  secret unlocks, 50% chance each of their unheard rumors is passed on.
- `metamour.ts` — pair approval baseline by relation (partner 70, friend/housemate 60, situationship
  55, none 50, rival 40, ex 35), moved by disclosure (+5), learning through gossip under poly (−10),
  group dates (±judge-driven). Threshold for the Polycule ending: 60.
- `rekindle.ts` — exes/partners in one set, both affection ≥ 80 and trust ≥ 60, neither exclusive
  with the player: 20% roll per date end, once per pair. Poly/open pair → invite; otherwise a door
  closing (sets `rekindledWith`, which feeds the Sacrifice ending).
- `endings.ts` — `selectEnding(ctx)` in this priority order:
  1. polycule — this character and ≥1 other at ≥80 with `poly` agreements, all pairwise metamour
     approval ≥ 60 (returns the group ids).
  2. reconciliation — a betrayal happened and trust has recovered to ≥ 60.
  3. bitter — a betrayal happened and trust < 60.
  4. sacrifice — `rekindledWith` is set, or the character is monogamous and the player never made
     an agreement (none/casual) with them.
  5. hollow — trust < 40, or connection < 8.
  6. open — agreement is open or poly.
  7. good — otherwise.
  Each ending has a title, a one-line description and a story direction for the epilogue turnNote.
- `dateFlow.ts` — orchestration with injected dependencies (`llm`, `now`, `rng`) so tests can run a
  full date against a fake LLM. See Date flow.

## Date flow (per turn)

1. Player sends message → append player turn (persist).
2. Judge call per character on the date (group dates: one per character, in parallel).
3. Apply: difficulty scale → trust rules → affection with gain cap and friend-route cap →
   `revealHits` → `detectTopics` → name-mention disclosure (mentioning someone the player is seeing
   adds them to `knownOthers`, which may trigger `checkBetrayal` with how='player') → tiers/secrets/
   rumors → persist relationship immediately (so a reload keeps affection and discoveries).
4. Story call streams the reply with the judge result in the LANDED section. If the date total is
   ≤ −20, the turnNote is the early-exit note and the date ends after this reply. The final turn
   gets the last-turn note.
5. Suggestions call (if enabled) fills three chips; tapping a chip fills the input, never sends.

Date start: venue delta and gift delta applied (count toward the date total and cap), venue/gift
reactions recorded, then turn 0 story call (opening beat; first date uses the opener line).
Date end (last turn, early exit, End date, or DTR close): agreement prompt if a DTR is open, memory
call (append, compress past ~250 words), +1 dates, trust consistency, gossip propagation, rekindle
roll, recap assembled and stored on the DateRecord, navigate to Recap.

Define the relationship: from Friend stage (affection ≥ 40) the date screen offers it. The player
picks exclusive/open/poly/casual; the next story call carries the DTR turnNote; turns are flagged
`dtr` until the player closes the talk or the date ends, then the agreement prompt runs once and its
result (if accepted) replaces `rel.agreement` with `madeAt = now`. Characters can open it too: at
date start, a Friend+ character with trust ≥ 50, ≥ 3 dates and no agreement has a 25% chance to
ask; the sheet opens pre-filled with what they'd want.

Epilogue: at 100 affection the profile shows the ending you're on (title + description) with
"Play the epilogue" and "Not yet". An autosave slot is written the first time a character reaches
100 so the player can reload and try a different approach. The epilogue is a 6-turn date at their
first favorite venue with the ending direction in the turnNote; after it, the ending is recorded
and its art slot unlocks.

## Art (`src/art/`)

`ArtProvider { id: string; available(settings): boolean; generate(req: ArtRequest, signal):
Promise<{ blob: Blob; seed: number; prompt: string }> }`. `a1111.ts` implements POST
`{baseUrl}/sdapi/v1/txt2img`. `imagePrompt.ts` builds prompt + negative prompt:
style prefix (editable) + artTags (+ bodyNotes at heat 4–5) + scene + heat modifier, and ALWAYS
appends the locked safety text (in code, not settings): positive states "adult, {age} years old"
for every participant; negative always includes childlike/underage/minor appearance and
non-consent terms. `resolve.ts` resolves a slot key to a URL: imported (Dexie) → bundled (virtual
module `virtual:bundled-art` listing files under public/art, generated by a small Vite plugin) →
generated (Dexie cache) → placeholder component.

## Mods (`src/mods/`)

- `normalize.ts` — accepts looser JSON (plural genders like "women", missing optional arrays) and
  returns a `Character`.
- `safety.ts` — minor/childlike term scan (word-boundary regexes: child, kid(s), minor, teen(age|ager),
  underage, preteen, loli, shota, schoolgirl/boy, high school, middle school, junior high,
  elementary school, barely legal, jailbait, childlike, little girl/boy, …) across all text fields,
  plus any age under 21 written in appearance fields (look, artTags, bodyNotes, gallery and ending
  scenes). "childhood" is allowed in backstory only.
- `validate.ts` — `validateCharacter(c, ctx)` → `{ field, message }[]`: required fields, age ≥ 21
  integer, attractedTo non-empty, unique trait ids across all four lists, known venue and gift ids,
  partners exist in the same set, gallery has tiers 1–5 at 20/40/60/80/100, accent is hex, safety
  scan. Bundled sets must pass it (a unit test enforces this for every bundled card).
- `pack.ts` — import `.json` (single character or `{ manifest, characters }`) and `.zip`
  (manifest.json + characters/*.json, optional art/{characterId}/tier-n.*); export single character
  JSON, set/pack zip.

## Design system (`src/ui/tokens.css`)

Tokens: `--velvet #2A0F1F` (bg), `--oxblood #4A1530` (panels), `--blush #F2C6CF` (text),
`--lipstick #E0245E` (affection, primary), `--brass #C9A45C` (unlocks, secrets, agreements),
`--smoke #9C7F8A` (secondary text), `--accent` (per character, set inline on screen roots).
Fonts: `--font-display: 'Bodoni Moda'`, `--font-ui: 'Figtree Variable'`. Sentence case copy, no
all-caps labels, no middle-dot metadata strings, no arrows on buttons. Visible focus rings
(`:focus-visible` 2px brass). Safe-area insets on screen roots. `prefers-reduced-motion`: instant
film becomes a fade; stamp press and sheet slides become instant.

## Testing

- Unit tests (vitest, `*.test.ts` next to the module): engine math, stages, discovery, agreements,
  endings, gossip (seeded RNG), prompt builders (no unfilled placeholders, wording verbatim, heat and
  ace cap change the prompt), JSON extraction, SSE parsing, validation + safety, bundled content
  validity, Dexie repo (fake-indexeddb).
- `scripts/mock-llm.mjs` — OpenAI-compatible mock on port 11435 (`/v1/models`, `/v1/chat/completions`
  with SSE). It recognises the prompt kind by its first line (judge / suggestions / agreement /
  memory / story) and answers deterministically; `MOCK_JUDGE=turnoff` style keywords in the player's
  message ("cute", "pushy", "[lie]") force specific judge results for e2e checks. Sends CORS headers.
- `scripts/e2e/*.mjs` — playwright-core scripts launching `/opt/pw-browsers/chromium` against
  `vite preview` + the mock, covering onboarding, a full 10-turn date, reload persistence, etc.

## Android first

Android is the primary target. The app ships two ways, from the same web build:

1. **APK (primary)**: Capacitor 8 Android wrapper (`capacitor.config.ts`, appId `app.crushlab.game`,
   appName `crushLAB`, `webDir: dist`, portrait). GitHub Actions (`.github/workflows/build.yml`)
   builds a debug APK on every push, signs it with the pinned `signing/debug.keystore` (so installs
   upgrade in place), uploads it as an artifact and publishes a GitHub release `build-<run>`
   (the in-app update check reads the latest release). The `android/` folder is generated in CI
   (`npx cap add android`) and patched there; it is not committed.
2. **PWA**: the same build deployed to GitHub Pages and installable from Chrome on Android
   (and any other browser). Offline shell via vite-plugin-pwa.

Platform layer (`src/platform/`): the only place that knows whether we're native.

- `platform.ts` — `isNative()`, `platformName()` via `@capacitor/core`'s `Capacitor`.
- `files.ts` — `saveFile(blob, filename, mime)`: web → anchor download; native → write to the
  cache dir with `@capacitor/filesystem` and open the Android share sheet with `@capacitor/share`
  (WebView blob downloads don't work). Every export in the app goes through this.
- `backButton.ts` — `@capacitor/app` `backButton` listener: close the top sheet/dialog if one is
  open, else `useNav.back()`, and at the hub root minimize the app instead of exiting abruptly.
- `http.ts` — native HTTP fallback: in the APK, if a WebView `fetch` to the model or image server
  fails with a CORS/network TypeError, retry through `CapacitorHttp` (no CORS, cleartext allowed).
  CapacitorHttp does not stream, so the story text then arrives in one piece; the client already
  handles non-streamed bodies. Streaming is used whenever the server sends CORS headers.
- `updates.ts` — APK only: compare the build number baked in at build time
  (`import.meta.env.VITE_BUILD_NUMBER`, 0 in dev) with the latest GitHub release tag
  (`build-<n>`) of the repo; offer to download the new APK. Manual "Check for updates" in Settings,
  plus an on-launch check that the player can switch off (it sends nothing about the player).
- System UI: status bar and navigation bar tinted velvet; content respects safe-area insets.

Capacitor config: `server.androidScheme: 'http'` (http://localhost is still a secure context, and
it lets the WebView reach `http://192.168.x.x` model servers on the LAN without mixed-content
blocking), `server.cleartext: true`, `android.allowMixedContent: true`.

Model servers from an Android phone:
- OpenRouter (HTTPS) works from both the APK and the PWA.
- A PC on the same Wi-Fi running Ollama or LM Studio: use the PC's LAN address
  (e.g. `http://192.168.1.20:11434/v1`). Ollama must listen on the LAN (`OLLAMA_HOST=0.0.0.0`) and,
  for streaming, allow the origin (`OLLAMA_ORIGINS=*`); LM Studio: "Serve on local network" + CORS.
  Works in the APK. The HTTPS PWA can't reach plain-http LAN servers (mixed content); the Phase 7
  LAN server covers that case.
- On-device (e.g. Ollama in Termux): `http://127.0.0.1:11434/v1` works from both.
The connection screen explains this and the Ollama/LM Studio presets have a "PC on my Wi-Fi" host
field that rewrites the base URL. Diagnostics mention `OLLAMA_HOST=0.0.0.0` when a LAN address is
unreachable.

Android UX rules for every screen:
- Design and test at 412x915 (Pixel-class) with touch emulation first, then 360x800, tablet and
  desktop. Thumb-reachable primary actions near the bottom; 48px touch targets.
- `<meta name="viewport" ... interactive-widget=resizes-content>` so the soft keyboard resizes the
  layout; the date screen's input stays visible above the keyboard (use `100dvh`, no fixed heights).
- Long-press targets set `user-select: none` and `-webkit-touch-callout: none`.
- Keep GPU cost modest for mid-range phones: avoid large `backdrop-filter` blurs and animating
  box-shadows; prefer transforms/opacity.
- Light haptics (`@capacitor/haptics`, no-op on web) on stamp press and unlocks.
