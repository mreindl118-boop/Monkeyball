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
  art/                types.ts (slots and keys), imagePrompt.ts (locked safety text), providers.ts
                      (a1111, grok), resolve.ts (imported, bundled, generated, placeholder; useArt),
                      generate.ts (painting, caching, import, favorites, unlock hooks), slots.ts,
                      compress.ts (stored size and thumbnails), Portrait.tsx
  ui/                 shared components (Button, Sheet, Coaster, LipstickStamps, Meter, Backdrop,
                      InstantFilm, Field, Toggle, Segmented, Chip, Placeholder art...)
  screens/            one folder per screen: Gate, Onboarding, ConnectionSetup, Hub, Profile,
                      DateSetup, DateScreen, Recap, Gallery, PolyculeMap, CharacterSets, Settings,
                      Editor, Debug, Ending
```

## Navigation

`src/store/nav.ts` — `useNav` holds a `Screen` union and a stack; `go(screen)`, `replace(screen)`,
`back()`, `reset(screen)`. It mirrors the current screen into `location.hash` (`#/profile/nova`) so the
browser back button works and a reload lands on the same screen (screens must tolerate missing state,
e.g. a reload on `#/date` with no active date offers that interrupted date's recap, or goes to the
hub when there is none). Every history entry the app writes
carries `{ crush: true, idx }`: `go()` pushes one entry per stack item, in-app `back()` calls
`history.back()` and the popstate handler (`bindHistory()`) pops or pushes the stack by comparing
`idx`, so in-app Back and the system back button share one path. With an empty stack (first screen,
after a reload) `back()` replaces the current screen with the hub. `reset()` unwinds the entries its
stack pushed (`history.go(-n)`) and rewrites the one it lands on. Malformed hashes parse to `null`.

## Persistence (Dexie, `src/db/db.ts`)

Database name `crushlab`. Tables:

| table | key | contents |
|---|---|---|
| kv | `&key` | `settings`, `profile`, `game` (GameState), `ui` misc |
| relationships | `&characterId` | `Relationship` |
| customCharacters | `&id, setId` | `{ id, setId, character, source: 'imported'\|'custom', updatedAt }` |
| packs | `&id` | `{ id, manifest: SetManifest, importedAt }` (imported sets/packs) |
| dates | `++id, startedAt, *characterIds` | `DateRecord` (transcripts, written every turn) |
| images | `&key, characterId` | `StoredImage` (imported + generated art, blobs; see Art for keys) |
| saves | `&id, createdAt` | `{ id, label, createdAt, data: SaveBlob }` save slots / autosaves |

Bundled characters are never written to Dexie; they come from `src/data/sets`. A custom character
with the same id as a bundled one is not allowed (duplicating gives a new id, e.g. `nova-copy`).

Save export = JSON of kv(profile, settings with every API key blanked, game), relationships,
customCharacters, packs, dates; images optional (base64). API keys are never exported (no opt-in);
on import each preset keeps the key already stored on this device for that preset. Import replaces
everything else after confirm.

## Stores (`src/store/`)

- `settings.ts` — `useSettings`: `{ loaded, settings: Settings, profile: PlayerProfile | null,
  load(), update(patch), updateConnection(patch), updateProvider(preset, patch), updateImage(patch),
  setProfile(p) }`. Every mutation persists to kv. Defaults live in `src/store/defaults.ts`;
  connection migration and key stripping/masking in `src/store/connection.ts` (pure).
- `roster.ts` — `useRoster`: `{ loaded, sets: SetManifest[] (bundled + packs), entries:
  Record<string, RosterEntry>, load(), reload() }` plus selectors `activeEntries(settings)`,
  `setOf(id)`, `relationsFor(id)` (manifest relationships + card partners, deduped; partner, ex
  and situationship only within a set). Mutations: `saveCustomCharacter(c, setId?, previousId?)`
  (issues; a `STORAGE_FIELD` issue means saved for the session only), `deleteCustomCharacter`,
  `duplicateCharacter`, `importPack(result, { replace? })` (an outcome with `confirm` when it
  would replace a pack and change more than its cards), `removePack(id)` (returns the ids of the
  player's own characters moved to My characters), `setActive`. Every mutation awaits the first
  load; a read that overlaps a write reads again.
- `game.ts` — `useGame`: `{ loaded, relationships: Record<string, Relationship>, game: GameState,
  load(), rel(id) (creates default lazily), saveRel(rel), patchGame(patch), addNews(...) }`.
- `date.ts` — `useDate`: a thin store over the date engine (see Date flow). It builds the engine's
  `DateWorld` from the settings, roster and game stores, gives it the app's model calls
  (`appDateLlm`: story role for story and memory, judge role for judge and suggestions, each call
  logged to the debug panel), persists every applied step (`useGame.saveRel` + the `DateRecord`),
  and owns the AbortController of the call in flight. State: `session`, `dateId`, `running`,
  `problem` (unexpected throws only; model failures are system turns), `draft`, `paused`,
  `finishedId`, `lastRecord`, `interrupted`, `storageError`. Actions: `start`, `send` (skips chips
  still loading), `retry`, `end`, `cancel` (leaving the screen stops the call; the date stays
  open), `resume`, `findInterrupted`, `recoverInterrupted`, `dropInterrupted`, `setDraft`,
  `clear`. `createDateStore(deps)` builds one with a fake model, db and stores for tests.
  Phase 4 (built): the date's world is everyone in play (`characters`, `rels`, `game`,
  `setRelations` from `activeRelations(data, activeSets)`, `rumors`, `setOf`); the model calls gain
  `agreement` (judge role, agreement schema); `hooks.persistWorld(rels, game)` saves what a finished
  date changed elsewhere in one transaction. Actions `openDtr(requested)` (who opened it: the
  character when their offer is showing and wasn't waved off, else the player), `closeDtr()` (a
  `'dtr'` action; `retry()` covers it), `dismissDtrOffer()` (state `dtrOfferDismissed`),
  `startEpilogue(id)` (`StartResult` gains `{ ok: false, reason: 'not-ready' }`). `start` and
  `startEpilogue` share one internal start routine; an interrupted epilogue keeps its ending when
  recovered. The random source is `appRandom` (`src/store/rolls.ts`: Math.random; dev builds only,
  the debug panel's "Random rolls" field pins it to succeed, fail or a seed).
- `epilogueSlot.ts` — the automatic "Before {name}'s epilogue" slot (id `auto-epilogue-{id}`,
  written after the date where someone first reaches 100, and before an epilogue if missing),
  `endingReady`, `reachedWon`, `possessive`. `src/screens/Ending/endingModel.ts` re-exports them.
- `debug.ts` — `useDebug`: ring buffer (last 200) of `DebugEntry` + the last assembled prompt per
  kind. Every LLM/image call logs here. In-memory only.
- `nav.ts` — `useNav` (above).

## LLM (`src/llm/`)

- `index.ts` — the front door. Every call names a role and passes the connection settings:
  `streamChat` / `chat` / `jsonChat({ conn, role, messages, kind?, onDelta?, coerce?, fallback? })`
  → `{ text, refused, refusal?, truncated, route, model }` (jsonChat → `{ value, ok, raw }`). The
  role resolves (`routes.ts`, `resolveRoute(conn, role)`) to a preset, wire format, base URL, key
  and model, and the call goes to Claude (`anthropic.ts`) or the OpenAI-compatible client
  (`client.ts`). Nothing above `src/llm` branches on the provider. The result's `route` never
  carries the API key (`PublicRoute`), so results can be stored and logged. A route that can't work
  fails before any request: no key (401-style `http` error), no address, no model, or an
  OpenAI-compatible preset pointed at api.anthropic.com (`LlmError` kind `setup` with a `fix`). Also `listModels(conn, preset)`,
  `testConnection(conn, { preset })`, `roleTakesTemperature`, `roleTakesEffort`,
  `refusalBeat(name)` ("{name} changes the subject.") and `REFUSAL_NOTE` for declined story turns.
- `presets.ts` — the seven presets (Claude, ChatGPT, Grok; Ollama, LM Studio, OpenRouter, Custom
  under "Other providers"), each with wire format, default base URL, key link and default models.
- `models.ts` — model-id rules (which Claude models take temperature, effort, server-side
  fallbacks) and the auto-pick after Test connection (`pickModels`). The Models API lists some
  Claude models under a dated id (claude-haiku-4-5-20251001); `isClaudeSnapshotOf` /
  `claudeListed` treat it as the alias, the pickers offer the alias, and settings only ever store
  exact ids without a date.
- `schemas.ts` — JSON schemas for Claude structured outputs (judge, agreement, suggestions).
- `sse.ts` — incremental SSE parser for `data:` lines, handles `[DONE]`, split chunks, CRLF.
- `json.ts` — `extractJson(text)`: strip ``` fences, take the first balanced `{...}` block,
  `JSON.parse`; returns `null` on failure.
- `client.ts` (OpenAI-compatible) —
  - POST `{baseUrl}/chat/completions` with `stream: true`; reads a non-streamed JSON body if the
    server ignores `stream`.
  - JSON calls send `response_format: {type:'json_object'}` unless this baseUrl+model is known to
    reject it; parse with `extractJson` + `coerce`; on failure retry ONCE with
    `Reply with valid JSON only. No prose, no code fences.`; then return `fallback`. Never throws
    for parse problems (network errors still throw so the UI can say what to fix).
  - Any optional parameter a server rejects by name (400/422) is dropped, retried and remembered
    per server and model. Judge calls use temperature 0.2.
  - Auth header `Authorization: Bearer {apiKey}` only when a key is set. OpenRouter also gets
    `X-Title: crushLAB`.
  - Android app: when the WebView's fetch throws a TypeError (CORS, LAN), the request is retried
    once through native HTTP (`src/platform/http.ts`): a GET (the model list) right away, a
    completion POST only after the `/models` probe proves the WebView can't reach the server (see
    Android first, `http.ts`), so a generation is never paid for twice. A stream is resent with
    `stream: false` and the text reaches `onDelta` in one piece. Such errors carry
    `via: 'native'`.
  - A reply with `finish_reason: 'length'` and no text (a reasoning model spent the whole cap
    thinking) is an `LlmError` of kind `empty`, not a reply.
- `diagnose.ts` — `testConnection(conn, { preset })` → `{ ok, models, steps[], problem?: { kind:
  'cors'|'unreachable'|'auth'|'billing'|'model'|'rate_limit'|'setup'|'other', message, fix } }`.
  Hosted providers: "no credit" (Anthropic's 400 credit balance, OpenAI's `insufficient_quota`
  429, OpenRouter's insufficient credits) is `billing` with the billing page; other hosted 4xx show
  what the API said (never "check the server logs"). Distinguish CORS
  from unreachable by retrying with `fetch(url, { mode: 'no-cors' })` (skipped after a native
  retry). Fix text per provider (Ollama → `OLLAMA_ORIGINS`, LM Studio → Enable CORS, LAN addresses
  → `OLLAMA_HOST=0.0.0.0`, the PC's firewall and port; 401/403 → the key; unknown model). The
  https web app pointed at a plain-http server on another machine is reported as mixed content
  (kind 'unreachable') without sending the request, with the APK, OpenRouter or the LAN server
  as the ways out.

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
- `{playerGender}` uses the custom label when set. `{knownStyle}` is what the player actually told
  this character (`rel.toldStyle`): the style their own first-person words described
  (`discovery.toldStyleIn`: poly, open, monogamous or still figuring it out) and what they asked for
  in Define the relationship ("Asked for exclusive (only each other)."), never the profile's style
  unless their words matched it; "They've talked about it, but nothing clear came out of it." when
  a style sentence was unclear; "Nothing yet; they haven't talked about it." before that. An older
  save with only `knowsPlayerStyle` keeps the profile's words.
- `{heatDescription}` = `heat.ts` description for `effectiveHeat(character, rel, settings.heat)`:
  `min(heat, aceSpectrum.heatCap)`; and when `heatUnlockTrust` is set and trust is below it,
  `min(heat, 2)`.
- `{aceNote}` is built from aceSpectrum and names the character (so the line never picks a
  pronoun for them), e.g. "Demisexual: nothing past heat 2 until trust is over 60, and that is who
  Priya Raman is, not a puzzle." / "Asexual: heat never goes past 2, and that is who Minh Tran is,
  not a puzzle." The judge's `{personality}` carries the same line after the personality, so pushing
  past someone's pace can be scored.
- Friend-route gossip and earned rumors ride inside existing placeholders: gossip the character is
  happy to share is appended to `{partners}`; rumors they've passed on are appended to `{secrets}`.
  To have them actually said, `{turnNote}` carries one-shot notes (`StoryContext.notes`): one gossip
  line per reply on turns 1 to 3, a rumor passed on in the next reply ("lets something slip"), the
  character's wish to define the relationship and a rekindle not told yet on the opening beat.
- Other values carry what the verbatim templates have no room for: `{requestedAgreement}` says when
  the character proposed it ("open (free to see other people), which Nova Castellanos proposed");
  `{sharedSecrets}` ends with how to score a wrong relay or leverage (`gossip.SECRETS_SCORING`);
  `{hitsLine}` says a breach "broke something the two of you agreed on" only when there is an
  agreement (else "It was a lie, and {name} caught it."), followed by private sentences from the
  engine (`StoryContext.landed`: what a betrayal broke, a rumor repeated and its truth); `{partners}`
  marks a rekindled partner; the epilogue's last turn closes the story instead of asking about
  another date.
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
  `venueDelta`, `giftDelta`, `venueReaction`, `giftReaction`, and the date ledger
  (`DateRecord.totals`: net affection, trust, gross gained): `applyAffection(totals, delta, gainCap,
  room)` clips positive deltas so the date's net gain never exceeds `gainCap` and never passes what
  the meter can still hold (`affectionRoom(affection, route)`: a gain the meter can't hold doesn't
  use up the date's allowance); losses always count in full, even at 0 affection, so a stranger can
  still walk out; `leftEarly(total)` is `total <= -20`. The date flow also passes
  `dateRiseRoom(startAffection, affection, gainCap)` as room, so the meter's own net rise since the
  date began stays within `gainCap` (a loss the meter couldn't take at 0 would otherwise widen the
  ledger's allowance: 0 affection, -18 at the floor, then +43). `clampAffection(value, route, previous)`:
  0–100 and the friend-route 59, which never pulls down affection already above it (orientation
  mode changed after the fact), only stops further gains.
- `discovery.ts` — `revealHits(character, rel, judge, at)` (ignores unknown ids, no duplicates,
  judge hint is the caption), `recordVenue`, `recordGift`, `detectTopics(text, speaker)` →
  `{ attractions, style, playerStyle }` keyword heuristics (patterns documented in the file) that
  reveal a character's attractions/style when the player asks or the character says it in the
  first person, and mark `knowsPlayerStyle` when the player talks about how they date;
  `applyTopics(rel, topics)`.
- `unlocks.ts` — `newTiers(character, rel, route)` (romantic: affection ≥ unlockAt; friend route:
  tiers 1–2 only), `newSecrets(character, rel, route)` (romantic: affection ≥ unlockAt; friend
  route: trust ≥ unlockAt — friends earn secrets through trust, since affection caps at 59).
  Each tier/secret unlocks exactly once (persisted lists).
- `trust.ts` — the judge's trustDelta runs through a list of `TrustRule`s (`BASE_TRUST_RULES`:
  difficulty; Phase 4's `TRUST_RULES` add misgendering and the grudge) and lands clamped 0–100
  (`applyTrust`); +1 trust for a `'completed'` date only (`consistencyTrust`; not for `'ended'` or
  `'left'`, so ending dates early can't farm trust). Phase 4: after any betrayal, positive trust
  gains are multiplied by a grudge factor (compersion/low 0.75, medium 0.5, high 0.34); compersion
  and low forgive once trust is back to 60 (`forgive` stamps `rel.forgivenAt`; the next betrayal
  brings the grudge back), medium and high hold it for the rest of the game. `misgenderingRule`: a
  misgendering hit costs at least −5 trust whatever the judge picked (and the date flow at least −8
  affection before difficulty). A caught lie always costs more trust than affection (the betrayal's
  own deltas replace the judge's).
- `memory.ts` — `appendMemory`, `needsCompression(memory, 250)`, `compressionSplit` /
  `applyCompression` (everything older than the last two dates becomes one paragraph),
  `memoryRequest`, `compressionRequest`, `cleanSummary`.
- `recap.ts` — `buildRecap(relBefore, relAfter, record, character, route, { memory })` →
  `DateRecap` (meters before and after, stages, traits, venue and gift reactions, tiers, secrets,
  what came up for the first time, the memory line, `left`).
- `agreements.ts` — `seeing(rel, route, dateCount?)` (romantic route, ≥1 date, affection ≥ 20, and
  recent: it lapses once `SEEING_WINDOW` = 6 dates were finished since, `GameState.dateCount`
  against `rel.lastDateIndex`), `othersSeen(rels, routeOf, exceptId, dateCount?)`,
  `recentlyDated`/`seenIn` (what a character "knows you're seeing" lapses on recency, not affection;
  under an exclusive agreement only people dated since it count), `disclosureRequired(agreement)`
  (poly always; open when terms mention telling/knowing/disclosing), `checkBetrayal(observer,
  learnedAbout, how)` → a `BetrayalEvent | null` (exclusive: any other person dated after
  `agreement.madeAt`; poly/open-with-disclosure: only gossip the player never confirmed, never
  someone they heard about from the player), `confessionBetrayal` (owning up under exclusive
  without a name), `readsAsDenial`/`readsAsAdmission`, severity scaled by jealousy within the spec
  ranges (affection −10..−20, trust −15..−30), `isJealous(character, rel, { route, seen })` (never on
  a friend route, never over a lapsed person or the partner they rekindled with),
  `dtrAvailable(rel, route)` (Friend+ on a romantic route only), `opinionText`, `knownOthersText`,
  `standingLine`.
- `gossip.ts` — after each date, propagate "the player is seeing X" to characters connected to X
  (manifest relationships and partners) with a seeded RNG: partner/housemate/roommate/bandmate
  0.5, coworker/friend 0.35, ex 0.3, rival 0.25, same-set otherwise 0.1. Different sets never
  talk unless a manifest `knows` links them. Under exclusive, a date after the agreement is a
  betrayal on the spot; under poly or open with telling terms, someone they didn't know about goes
  on `rel.heardSecondhand` and `settleSecondhand` makes it a betrayal only if their next date ends
  without the player bringing that person up. Betrayals carry the observer's meters before and
  after (`WorldBetrayal`) for the recap. Friend-route gossip facts (another character's
  attractions/style, who's into you = anyone at 60+, at most one of those per date, who's seeing
  whom), with first-name `shown` lines for the recap and what a friend already shared ranked last
  (`rel.gossipShared`). Rumors: when a teller's secret unlocks, 50% chance each of their unheard
  rumors is passed on.
- `metamour.ts` — pair approval baseline by relation (partner 70, friend/housemate 60, situationship
  55, none 50, rival 40, ex 35), moved by disclosure (+5 per metamour the player talks about on a
  date under poly, once per date), gossip the player never confirmed under poly (−10, when that
  betrayal lands), a rekindle invite (at least 60), group dates (Phase 6). Threshold for the
  Polycule ending: 60.
- `rekindle.ts` — exes/partners in one set, both affection ≥ 80 and trust ≥ 60, neither exclusive
  with the player, neither on the date that just ended: 20% roll per date end, once per pair.
  Poly/open pair → invite (`rel.rekindle` with invite true on both, each knows about the other,
  approval at least 60); otherwise a door closing (`rel.rekindle` and `rekindledWith`, which feeds
  the Sacrifice ending). The story marks the partner in `{partners}`, the judge's opinion says it,
  and the next date with either of them brings it up once (`rekindle.told`); the map draws both.
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
  Good and Open also play at trust 40 to 59; their reason then says trust is steady at that number
  instead of calling it high. Directions never pick a pronoun for the character: Sacrifice names
  the rival, or (monogamous, never promised anything) "wanted a promise {player} never asked for",
  or "chooses work, or a life that was already waiting"; Open says open or poly as agreed.
- `dateFlow.ts` — orchestration with injected dependencies (`DateLlm`, `DateWorld.now/rng`,
  `DateHooks.persist/onUpdate/signal`) so tests run a full date against a fake LLM:
  `createDate`, `openDate`, `sendPlayerMessage`, `retryLastReply`, `finishDate`, the helpers
  `canSend`, `canRetry`, `needsReply`, `isEnded`, `playerTurnCount`, `routeOf`, and the request
  builders `storyRequest`, `judgeRequest`, `suggestionsRequest` (the debug panel can use them).
  Sessions are immutable (every step returns a new object). A turn's effects are small pure steps,
  `TURN_STEPS` = trust, affection, reveal, topics, connection, unlock, mood (`runTurnSteps`);
  Phase 4 inserts disclosure, betrayal and grudge steps there. `connectionStep` tracks
  `rel.connection` for the Hollow ending: +1 per like hit, +1 for an honest moment (trustDelta 3+),
  −1 for a turn-on win with neither. See Date flow.

## Date flow (per turn)

1. Player sends message → append player turn (persist).
2. Judge call per character on the date (group dates: one per character, in parallel).
3. Apply: difficulty scale → trust rules → affection with gain cap and friend-route cap →
   `revealHits` → `detectTopics` → name-mention disclosure (talking about going out with someone the
   player is seeing, a dating word in the same sentence as the name or the judge's jealousy flag,
   adds them to `knownOthers`, which may trigger `checkBetrayal` with how='player'; "Kai poured me a
   drink" tells nothing) → the judge's breach read against the engine (`breachStep`) → rumors relayed
   → tiers/secrets/rumors → persist relationship immediately (so a reload keeps affection and
   discoveries).
4. Story call streams the reply with the judge result in the LANDED section. If the date total is
   ≤ −20, the turnNote is the early-exit note and the date ends after this reply. The final turn
   gets the last-turn note.
5. Suggestions call (if enabled) fills three chips; tapping a chip fills the input, never sends.

Date start: venue delta and gift delta applied (count toward the date total and cap; difficulty
doesn't scale them; `DateRecord.opening` keeps what counted), venue/gift reactions recorded, then
turn 0 story call (opening beat; first date, `relBefore.dates === 0`, uses the opener line).
Date end (last turn, early exit, End date, or DTR close): agreement prompt if a DTR is open, memory
call (append, compress past ~250 words), +1 dates (also for a date the character walked out of, so
the opener isn't reused), trust consistency, gossip propagation, rekindle roll, recap assembled and
stored on the DateRecord, navigate to Recap.

Phase 3 decisions:
- Model problems never throw out of the engine: a failed judge is neutral, failed chips are none,
  a failed or empty story call becomes a system turn (`notice: 'error'`, worded by
  `explainRoleError`) and the date waits for `retryLastReply`, which removes the note on success.
  `canSend` is false while a reply is missing (`needsReply`), so the opening beat (and the opener)
  and each LANDED result reach the story model in order; `canQueueSend` also allows a send while
  the chips load (the store skips them first).
  A declined story turn keeps the model layer's in-world text (or `refusalBeat(name)`) and adds
  `REFUSAL_NOTE` (`notice: 'refused'`).
- `sendPlayerMessage` finishes the date itself after the last turn or the exit reply and returns
  an `'ended'` session with the recap on the record; `finishDate` on an ended session returns that
  recap; a session that is leaving always ends as `'left'`.
- Abort (`hooks.signal`): no further model calls or `onUpdate`s, storage still brought in line. An
  abort before the judge answers takes the player's message back (the store puts it back in the
  composer); an abort during `finishDate` still ends the date, without the memory call.
- The date screen: the last reply and the exit reply stay on screen with "See how it went" (End
  date goes straight to the recap). Leaving the screen stops the call in flight and coming back
  resumes it (the stop waits a tick so React's development double mount doesn't cancel it).
- The open date is remembered in kv `activeDate` (`{ dateId, characterId, relBefore }`), so a
  reload or a killed app loses the session but not the date. The date screen and date setup offer
  that interrupted date's recap (`recoverInterrupted`: finished as `'completed'` when every turn was
  played, else `'ended'`; no memory call offline); starting another date files it as
  `'abandoned'`. At boot, an app that opens on the hub with an interrupted date goes to `#/date`
  (App.tsx, lazy import of the store).
- Hints on: the status strip shows the judge's hint and what counted ("Affection +1 (this date's
  limit), trust +1" when the date's gain limit held some back, per `dateGainUsed`; "Affection −8
  (the meter stops at 0)" when a loss counts toward the date but the meter is at 0). Define the
  relationship shows, disabled, in the expanded status panel from Friend stage until Phase 4 wires
  it. The expanded panel also has the heat (the hub's heat sheet, also offered on a declined turn's
  note); the store hands the engine the player's current heat, chips and connection before every
  call (`liveSettings`), while the route, the date's length and its gain cap stay as the date began.
- The composer is read-only (not disabled) while the character talks, and Send doesn't take focus,
  so the soft keyboard stays up from one turn to the next.
- Every step saves the relationship and the record in one Dexie transaction, so the last save (the
  outcome and recap with +1 date, the memory and the consistency trust) can't half land and be
  finished twice by a recovery.
- The judge's `{others}` is the other characters the player has been on a date with (`othersSeen`);
  Phase 4 refines it. The memory call labels the player's lines with their name and names the gift.
  `{venue}` says home is "your place"; `{giftLine}` uses `Gift.phrase` ("a poetry book"); `{memory}`
  reads "You've been out before; nothing from those dates stands out." on a later date with none.
- Recap: a walkout shows the date's running total ("Nova walked out after the date ran to −20
  affection. Affection was already at 0, as low as it goes."), and what you learned lists only
  venue and gift reactions that were new this date (`venueNew`, `giftNew`).

Phase 4 decisions (built; the engine is src/engine/agreements.ts, gossip.ts, metamour.ts,
rekindle.ts, endings.ts and the extended dateFlow.ts, trust.ts, discovery.ts, recap.ts):
- A betrayal turn replaces the judge's numbers: the betrayal's affection (−10 to −20) and trust
  (−15 to −30) count instead of the judge's delta, which guarantees a caught lie costs more trust
  than affection. It counts toward the date's −20 walk-out like any loss.
- Misgendering is a turn-off every character has (`UNIVERSAL_TRAITS`): the judge's turn-off list
  carries it for everyone and the LANDED line names it. It is never added to the profile's
  discovered traits, so discovered/total counts stay right.
- Who counts as "seeing": with `world.rels`, the judge's `{others}` follows `seeing` (romantic
  route, a date, affection 20+, not lapsed) plus anyone the character still knows about that way
  (under exclusive, only people dated since the agreement); characters of sets switched off are
  left out. The old store helper `othersSeen` only feeds `world.others`, which the
  engine ignores once `world.rels` is given.
- Gossip after a date reaches only characters who have been on a date with the player, and only
  romantic-route dates spread. Friend-route gossip starts at affection 20, at most 3 lines per date.
  Gossip news reads "{Kai} heard you've been out with {Nova}." (the hub strip is "Word around town");
  under poly or telling terms it adds "Your poly agreement with {Kai} expects you to say so first.";
  an exclusive betrayal reads "{Nova} heard you went out with {Kai}, after you and {Nova} agreed to
  be exclusive."
- Rekindles: every eligible pair is rolled at every date end; a pair is recorded in
  `game.rekindled` only once it fires.
- Define the relationship opens once per date; its note rides on every story reply while the talk
  is open. The Agreement call is skipped if the player said nothing in the talk. Re-agreeing the
  same type keeps the original `madeAt`. If `closeDtr` fails or is stopped the talk stays open;
  ending the date always settles it. No new date status: closing uses `'judging'`.
- The grudge after a betrayal scales positive trust gains (compersion/low 0.75, medium 0.5, high
  0.34), and the +1 trust for a completed date lands on only that share of dates. Compersion and
  low forgive once trust is back to 60 (`rel.forgivenAt`, until the next betrayal); medium and high
  keep the grudge for the rest of the game.

Phase 4 review decisions:
- A judge breach is read against what the engine knows (`breachStep`), at most one breach
  betrayal per date and none on a turn that already set one off. With nothing that could break
  (no agreement, casual, open without telling terms) it's a caught lie unless the message reads as
  honest. Naming only people whose break is already counted, or who were dated before the
  agreement, adds nothing unless it's a denial (then a lie). Naming someone dated since and not yet
  counted: a denial is a lie, owning up is the player's disclosure. Naming nobody under exclusive:
  an honest confession (judge trustDelta above 0, or it reads as owning up) is
  `confessionBetrayal` (the softer "heard it from you"), anything else a lie; under poly, owning up
  is what the agreement asks for.
- The turn keeps its betrayal and the rumors it relayed (`DateTurn.betrayal`, `.relayed`), so the
  story's LANDED section says what broke (mood "hurt", or "betrayed" for a lie) and the hints line
  shows the betrayal's note instead of the judge's hint. A breach the engine didn't count isn't
  told to the story as one.
- Poly (and open with telling terms): gossip that gets there first isn't a betrayal; it waits for
  the observer's next date (`heardSecondhand`, which the story and the judge see), and only a date
  that ends without the player bringing that person up counts, with the −10 approval. Someone the
  player already told them about is never a gossip betrayal again.
- Relaying a false or exaggerated rumor to its subject caps the judge's trustDelta at −4 before the
  trust rules (`relayStep`, `WRONG_RELAY_TRUST`); leverage is left to the judge, whose
  `{sharedSecrets}` value says how to score both.
- Rumors from a secret reached after the date's last reply are rolled at the next date's start
  (`rel.rumorRollsOwed`), so the opening beat can let them slip; the recap lists only rumors from
  this date's replies. Gossip lines the story didn't get to voice aren't on the recap and reveal
  nothing.
- The hub's jealousy mark is `isJealous` worked out when the hub renders (someone the player still
  sees, and minds); a raw betrayal shows on the profile and the map ("hasn't let it go") instead.
  The map's person sheet no longer quotes the judge's `{opinion}`.
- A character who opened the talk is told to the story as theirs, the opening beat raises their
  wish, and the Agreement prompt says they proposed it. An Agreement reply that comes back unusable
  (ok false) keeps the talk open like a failed call; the end of the date closes it without a result.
  End date while the talk is closing waits for that answer.
- The date's last save and the world it settled go in one Dexie transaction (`hooks.persistAll`),
  so a crash can't store other characters' betrayals without the date's outcome. `patchGame` keeps
  news under `MAX_NEWS` like `addNews`.
- The recap shows someone else's betrayal from this date as a hit on their meters (before and
  after from `WorldBetrayal`), shows the ending when the date reached 100 (with "See your ending"),
  and after a declined talk keeps the agreement that stands.
- Copy never picks a pronoun for a named character ("In Nova's words", "at Nova's pace").
- Screens: the polycule map (`#/map`: SVG constellation, tap a circle or the list under it for the
  person sheet; the legend covers agreement, seeing with no agreement, tension, partners, exes,
  situationships), the ending screen (`#/ending/:id`), the profile's "Your ending" card, "What they
  know" and "Rumors you've heard", the hub's "Word around town" strip, the recap's agreement, betrayal
  hits on the meters, gossip, rumors and "Word got around", the DTR sheet, offer banner and talk bar
  on the date screen. Automatic save slots carry a brass "Automatic" tag.

Define the relationship: from Friend stage (affection ≥ 40) on a romantic route the date screen offers it. The player
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

Phase 5. The contract both halves were built against, and what each module does.

**Slots and keys** (`types.ts`). `ArtSlot` is a tier (`nova:tier-3`), an ending (`nova:ending-good`)
or a group picture (`group:kai+nova:polycule`, ids sorted); `slotKey`, `parseSlotKey`,
`generatedKey`, `packKey`, `baseKey`. In the images table the player's own picture is stored under
the slot key itself, art that came with an imported pack under `key#pack` (with `pack: setId`), a
generated one under `key#generated`, so no source replaces another and removing the player's
import brings back the pack's picture or the painting. Group rows use characterId `group`. Favorites are kv `artFavorites` (bundled art can be a
favorite too; save slots carry them), polycule groups kv `artGroups` (a member's Polycule ending
shows the group's picture).

**Resolving** (`resolve.ts`). `resolveArt(slot, { thumb? })`: imported (Dexie: the player's own
image, then pack art, which comes back with `ResolvedArt.pack` set so the viewer says "Comes with
the pack" and offers no Remove my image) → bundled (the
`virtual:bundled-art` list of files under `public/art/{setId}/{characterId}/tier-{n}|ending-{type}`
.webp/.png/.jpg, written by the Vite plugin in vite.config.ts; not precached, cached on first view)
→ generated (Dexie) → placeholder. Stored pictures are handed out as blob: URLs from one
reference-counted cache (revoked 1.5 s after the last `releaseArt`). `useArt(slot, { thumb? })` does
that for components and follows `subscribeArt`/`emitArtChange` (painting done, import, favorite).
A save import, slot restore or reset reloads the app, which clears the cache.

**Thumbnails** (`compress.ts`). Stored pictures are re-encoded as WebP, longest side 2048
(`compressImage`), and get a thumbnail, longest side 640 (`makeThumbnail`, `StoredImage.thumb`),
when they're bigger than that. Coasters, round avatars, gallery tiles and the profile strip ask for
`thumb`; the viewer, the recap's print, the date screen and the editor decode the full picture. A
row without a thumbnail (pack art, older saves, save files with images) gets one the first time a
tile asks. Without OffscreenCanvas nothing is re-encoded.

**Prompts** (`imagePrompt.ts`, pure). `buildImagePrompt({ slot, characters, heat, settings, scene,
trust, seed? })` → `{ prompt, negative, seed }`:
- prompt = style prefix (editable) + for each participant `adult woman, 28 years old` (from the
  card's age; a card under 21 throws `ArtSafetyError`, logged, nothing painted) + their artTags (+
  bodyNotes at heat 4-5) + the scene + the heat's modifier + `IMAGE_SAFETY.positiveClause`; Grok
  prompts also end with `IMAGE_SAFETY.grokClause` (xAI has no negative prompt).
- negative = `IMAGE_SAFETY.negative` (childlike, underage and minor appearance; non-consent) + the
  heat's own negatives + quality terms.
- `IMAGE_SAFETY` is a frozen constant. It is never stored in settings and never editable; Settings
  shows it read-only. Every piece of player or mod text (style prefix, artTags, bodyNotes, scene) is
  scrubbed first (`scrubPromptText`): A1111 syntax is flattened (weights, brackets, `<lora:…>`,
  BREAK, AND, colons), and segments are dropped when they name minors or childlike traits (the mods
  safety scanner, with lookalike letters and leetspeak folded), non-consent, "not an adult", or
  instructions to ignore the rules; written ages are dropped (the one age comes from the card).
  Asleep and drunk are dropped from heat 3. Image text has its own lists on top of the card
  scanner's: childlike bodies and props, school settings and clothes, other languages' words for a
  child, teen numbers in five languages, implied ages (birth years, "half her age"), dubious consent
  and incapacitation, masked words, and any talk about the prompt itself (so nothing can call the
  Grok clause a "note", "disclaimer" or "watermark"). Each segment is also read with the one kept
  before it ("school, uniform", "jail, bait"), and after the body is built `assertCleanTogether`
  reads the scrubbed style, art tags, body notes and scene next to each other and as a whole: a
  blocked phrase made across fields throws `ArtSafetyError` (fail closed, no picture).
  Non-consent patterns shared with the card scanner live in `src/mods/safety.ts`
  (`CONSENT_OVERRIDES`). Red-team cases: `imagePrompt.redteam.test.ts`.
- Heat is the lowest `effectiveHeat` of the participants (an ace cap or trust gate holds for the
  picture). Seeds: fixed per character (a hash of the id) or random; Regenerate always uses a fresh
  one.
- Each provider re-adds the safety text before sending (`withPositiveClause`,
  `withSafetyNegative`, `withGrokClause`), whoever called it, and refuses (ArtError `setup`, nothing
  sent) a prompt without an adult age statement (`hasAdultAge`), so a caller that skips
  `buildImagePrompt` can't paint. Tests cover every bundled character ×
  heat 1-5 × every slot × both providers, hostile prefixes and mod cards; the mock server rejects any
  image request without it.

**Providers** (`providers.ts`). `ArtProvider { id: 'a1111' | 'grok'; label; available(settings);
generate(req, signal) → { blob, seed }; test(settings, signal) → { ok, message, models?, samplers? } }`,
`providerFor(settings)` (null when Generate art is off or the picked provider isn't set up),
`providerById`, `ART_PROVIDERS`. Errors are `ArtError { kind, problem, fix, status }`: CORS vs
unreachable vs no --api (a plain 404 on /sdapi), GPU memory, unknown sampler, --api-auth, mixed
content (the https web app and a plain-http LAN server); for xAI 401 key, 402/403 credit or policy,
404 model, 429, 400/422 split into a parameter problem or "The image service declined this
prompt." (the gallery keeps the placeholder). A 400 naming `aspect_ratio` is retried once without
it. Both go through `fetchWithFallback` (native HTTP in the APK; a POST is never sent twice).

**Painting** (`generate.ts`). `generateArt(slot, { replace?, signal? })` paints once and caches;
concurrent calls share one painting; each painting logs a debug entry of kind `image` (provider,
heat and "painted at" when an ace gate lowered it, seed, prompt, negative prompt). Regenerate is
`generateCandidate` (not saved) then `acceptCandidate`. `importImage` (PNG, JPEG, WebP or GIF by
their bytes, up to 20 MB), `removeImported`, `setFavorite`. `onUnlock(characterId, tiers)` and
`onEnding(characterId, ending, group?)` are called by the date store's saves (`startArt` in
src/store/date.ts, for tiers the save adds over the stored relationship): with Generate art on and
no imported, bundled or cached picture, the slot is painted in the background, one job at a time,
given up after 6 minutes; failures are kept for the slot (`useArtJob`) and logged, never thrown.
`unlockedSlots(character, rel, route, { endingsSeen?, polycule?, tiersOnly? })` lists tiers (lock
"Unlocks at 60", or "Friendship-locked" for 3-5 on a friend route) and endings ("Ending: The good
ending" until it has played). `assembleArtPrompt(slot)` builds without painting.

**Screens.** `Portrait` resolves a slot near the screen (lazy image, alt "{name}, {title}", the
placeholder card otherwise; no `tier` shows the highest unlocked). The recap develops each tier
unlocked on the date (and an epilogue's ending art) as an `InstantFilm` print, one after another
as they come on screen, once each (`DateRecord.artShown`, plus a session set); a print whose art is
being painted waits up to 90 s. Reduced motion makes it a 0.4 s fade. The gallery (`#/gallery`,
`#/gallery/:id`) lists characters with tiers unlocked and a favorites filter; a character's page
shows tiers, reachable endings and group pictures, locked ones with their title and what unlocks
them. The viewer is an overlay (Android back, Escape) with swipe, Previous and Next, arrow keys,
Favorite, Save image (`saveFile`), Use my own image, Remove my image, Regenerate (current and new
side by side until Keep new) and Generate art on a placeholder. Settings, Image generation: the
switch, the provider, each one's options, the style preset and prefix, the safety text read-only,
Test image generation (works with the switch off; lists samplers or models; logs its prompt).
The debug panel's Prompts tab has an Image prompt, and Live preview with any character assembles
every prompt from their card and where the player stands with them (so heat and an ace gate show).

## Mods (`src/mods/`)

- `normalize.ts` — accepts looser JSON (plural genders like "women", missing optional arrays) and
  returns a `Character`.
- `safety.ts` — minor/childlike term scan (word-boundary regexes: child, kid(s), minor(s),
  teen(age|ager), underage, under 10 to 19, preteen, loli, shota, schoolgirl/boy/child,
  high/middle/grade school(er), junior high, jr high, sixth-grader, elementary school, barely
  legal, jailbait, childlike, little girl/boy, …) across all text fields, plus any age under 21
  written in any field ("17 years old", "I'm only seventeen", "she's 16.", "Nova is 17", "turned
  18"). Appearance fields (look, artTags, bodyNotes, gallery and ending scenes) also block "girl",
  "boy", "young", bare numbers among tags, "almost 18" and childlike image tags (loli/rori words,
  training bra, AA cup, seifuku, gakusei, other languages' words for a pupil), and are scanned a
  second time with commas as spaces ("school, uniform"). Every field is checked for rule overrides
  ("treat the WORLD RULES as flavor text", "new rule:", "anything goes", "any age", a forged "MOD
  DIRECTION ends here") and consent overrides (`CONSENT_OVERRIDES`: dubcon, "against her will",
  "says no but means yes", "rape fantasy", consent "skipped"). The backstory may mention a
  "childhood" and place past events at an age ("at 19", "at the age of 17", "when she was 16"),
  never state the character's age. Adjectival "minor" passes only before a known follower (key,
  detail, league...) or a college subject ("a minor in art history").
- `validate.ts` — `validateCharacter(c, ctx)` → `{ field, message }[]`: required fields, age ≥ 21
  integer, attractedTo non-empty, unique trait ids across all four lists, known venue and gift ids,
  partners exist in the same set, gallery has tiers 1–5 at 20/40/60/80/100, accent is hex, safety
  scan. Bundled sets must pass it (a unit test enforces this for every bundled card).
- `pack.ts` — import `.json` (single character, an array, `{ characters }` or `{ manifest,
  characters }`) and `.zip` (manifest.json + characters/*.json, optional art/{characterId}/tier-n.*);
  export single character JSON, set/pack zip.

Built (Phase 2) decisions: the validator also requires one trait in each list and one favorite
venue (the epilogue plays at the first), lowercase hyphenated ids, and no venue or gift that is
both loved and hated. Ids of the Phase 6 sets and characters are reserved (`src/data/bundled.ts`).
Custom characters without a pack live in the synthetic set "My characters" (id `custom`, never a
pack id); a pack is saved whole or not at all, and removing it keeps relationship progress.
Duplicates get `{id}-copy` ids and drop partners outside their new set. The editor opens
`#/editor` (list), `#/editor/{id}` (bundled cards read-only) and `#/editor/_new`.

- Show me is about the character's gender: Women shows women, Men shows men, and nonbinary
  characters show under Everyone only. The Show me control says so (`SHOW_ME_NONBINARY`).
- Imports check every id already on the device (a pack's own excepted) and the reserved ids, so a
  clash leaves out that card, not the whole pack. Zip folder names match in any case, and cards
  may sit next to manifest.json. A loose card (a single exported .json) travels alone: partners
  who aren't in My characters or the same file are left off it, with a note in the report.
- Re-importing a pack with the same id replaces it. When that would remove characters, or the name
  or author differ, the importer asks first ("Replace pack"). A character whose new card fails its
  checks keeps the earlier card. Characters the player made inside a pack are never deleted: they
  stay in it on a re-import, and move to My characters (without partners from the pack) when the
  pack is removed. A single character's .zip export is named after the character, never the pack.
- A manifest's `knows` allows cross-set friends, rivals, coworkers and so on, only with sets it
  lists; partners, exes and situationships stay inside a set (validator and `relationsFor`).
- Bundled sets and cards export as templates (every copy of crushLAB has their ids); the export
  says to change the ids before importing.
- The profile shows a partner's manifest note only once the relationship style is discovered, and
  venues and gifts tried as counts out of 14. A saved card's trait ids never follow label edits
  (discoveries are stored by id); a new or renamed id that a deleted character used warns that it
  picks up their progress.
- `giftLock(gift, affection, heat, route?)` and `venueLock(venue, affection, route?)` return
  "Friendship-locked" when the requirement is above the route's affection cap.
- Storage failures on a save or an import are reported to the player (kept for the session), and
  the roster and game stores' errors get the app's one-time storage warning.

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
  memory / story) and answers deterministically; keywords in the player's message force judge
  results for e2e checks ("vinyl" a like +3, "banter" a turn-on +6, "cute" and "pushy" turn-offs,
  "misgender", "[lie]" a breach, "[tank]" −20; the Agreement prompt accepts the requested type, and
  "[decline]", "[counter]" (their style's agreement) or "[silent]" in the talk change that), and the
  story reply follows the prompt (opener, the Define-the-relationship note,
  last turn, exit, a soured or delighted mood). `MOCK_DELAY` paces streamed tokens,
  `MOCK_OPENING_DELAY` paces opening beats only (so e2e can photograph a reply mid-stream). Sends
  CORS headers. `npm run mock-llm:selftest` checks every route and toggle.
- `scripts/e2e/*.mjs` — playwright-core scripts launching `/opt/pw-browsers/chromium` against
  `vite preview` + the mock, covering onboarding, a full 10-turn date, reload persistence, etc.
- `scripts/e2e/phase5.mjs` (`npm run e2e:phase5`) — gallery and art, on the vite dev server (the
  dev-only xAI address override and pinned rolls). Pixel 7 with motion allowed: Nova seeded at 59
  crosses 60 on a date, the recap develops tier 3 as instant film (screenshots mid-development and
  developed) and a reload doesn't replay it; the gallery (3/5), her tiers 4 and 5 "Unlocks at 80/100",
  Jules's tiers 3-5 "Friendship-locked"; Settings, Image generation with the mock's A1111 (Test image
  generation); Priya crosses 40 and tier 2 is painted once in the background (the mock's request
  counter, `GET /__mock/requests`), develops as a fade under reduced motion, and isn't painted again
  on later visits or a reload; the debug log's image prompt ("years old", the safety clause and
  negative); Grok Imagine against the mock; Regenerate (Keep current, Keep new); a 1200x1800 own
  image wins and its tile decodes the 640 thumbnail; Remove my image; favorites and the Favorites
  filter; swiping in the viewer; Live preview: heat 2 to 4 and Priya's ace gate (trust 40, then 70
  through a re-import) change the image and story prompts. Then 360x800 and a desktop pass (the
  reveal waits for the painting). Screenshots `p5-android-*`, `p5-360-*`, `p5-desktop-*`.
  `E2E_ONLY=android|desktop`. The mock's image routes: `POST /sdapi/v1/txt2img`, `GET
  /sdapi/v1/samplers` and `/sd-models`, `POST /v1/images/generations`, `GET
  /v1/image-generation-models` (each rejects a request without the safety text), with
  `MOCK_IMAGE_FAIL`, `MOCK_IMAGE_DELAY` and `MOCK_NO_SDAPI`.
- `scripts/e2e/phase4.mjs` (`npm run e2e:phase4`) — relationships, on the vite dev server (the
  "Random rolls" field is dev-only). Seeds relationships by exporting a save in Settings, rewriting
  it in node and importing it back; pins the rolls to "succeed" so gossip always spreads. Pixel 7:
  Nova to Friend, Define the relationship (sheet, talk bar, "Nova said yes"), the agreement on the
  profile and map; Kai's date with a misgendering line (affection and trust drop); gossip tells Nova
  (the hit on her meters on Kai's recap, hub news, jealousy mark, "What they know", map tension and
  person sheet, her next story prompt in the debug panel); a caught lie (trust drops more than
  affection; betrayal recap); Jules on the friend route (mark, 59 cap, gossip) and dateable in
  everyone mode (the offer banner); Nova from 92 to 100 on a date (the recap's "Your ending" and "See
  your ending"), then the ending card, ending screen, six-turn epilogue, recap, and the automatic
  slot restores. Then 360x800
  and a desktop pass. Screenshots `p4-android-*`, `p4-360-*`, `p4-desktop-*`. `E2E_ONLY=a|b|d|desktop`.
- `scripts/e2e/phase3.mjs` (`npm run e2e:phase3`) — the dating core against the mock, Pixel 7
  profile first: connection through Other providers, Custom; Nova at the record store with hot
  sauce (+8 before a word); the opening streams with her opener; chips fill the input and never
  send; a full 10-turn date with a like, "what's your type" (attractions revealed), a turn-off
  (−8 and a soured reply), a chip's line and small talk; the soft keyboard emulated at 412x560
  (composer, Send and the latest line in view); the closing reply; the recap (+19, +10, traits with
  hints, venue, gift, memory line); a reload keeps the recap, the profile and the memory (debug
  State tab); a second date where "[tank]" makes her leave (exit reply, left-early recap); a third
  with hints on where "banter" +6s stop at +25 net; the date screens at 360x800; a restart on the
  hub mid-date. Then desktop 1280x800. Screenshots `p3-android-*`, `p3-360-*`, `p3-desktop-*`.
- `scripts/e2e/phase2.mjs` (`npm run e2e:phase2`) — the Phase 2 screens under the same Pixel 7
  profile: hub coasters, filters and sorts, a profile, set on/off, the editor's age rule, JSON
  export (a real download), a .zip pack import, the replace-pack question, a lone card whose
  partner isn't there, a pack of long unbroken words at 360px, then 360x800 and 1280x800 screenshots
  (`p2-*.png`). The Android helpers (`PIXEL_7`, `checkTouchScreen`, `quickOnboard`) are in lib.mjs.
- `scripts/e2e/offline.mjs` (`node scripts/e2e/offline.mjs`, Phase 6) — the production build
  under vite preview as Chrome on a Pixel 7: manifest (standalone, velvet theme, 192/512/maskable
  icons that exist), the first visit's precache (index.html, JS, CSS, Figtree and Bodoni italic
  woff2, icons; no tier art), `context.setOffline(true)` then reload: the gate renders with both
  fonts under the worker, onboarding, the hub, Settings and Character sets survive offline reloads
  with no failed same-origin request, Test connection to Claude fails with "This device may be
  offline.", then online again a changed `sw.js` raises "A new version is ready." and Reload hands
  over to the new worker. Screenshots `offline-*.png`.
- `scripts/e2e/android.mjs` (`npm run e2e:android`) — the first-launch flow as Chrome on a Pixel 7
  (touch, 412x915 at 2.625x, Android user agent), then every screen again at 360x800: no sideways
  scroll, every tappable thing hit-tested at 48px or more (`E2E_MIN_TAP=44` relaxes it), the design
  rules, the viewport meta and the PWA manifest icons. Screenshots `scripts/e2e/out/android-*.png`.

## Android first

Android is the primary target. The app ships two ways, from the same web build:

1. **APK (primary)**: Capacitor 8 Android wrapper (`capacitor.config.ts`, appId `app.crushlab.game`,
   appName `crushLAB`, `webDir: dist`, portrait). GitHub Actions (`.github/workflows/build.yml`)
   builds a debug APK on every push, signs it with the pinned `signing/debug.keystore` (so installs
   upgrade in place), uploads it as an artifact and publishes a GitHub release `build-<run>`
   (the in-app update check reads the latest release). The `android/` folder is generated in CI
   (`npx cap add android`) and patched there; it is not committed.
2. **PWA**: the same build deployed to GitHub Pages and installable from Chrome on Android
   (and any other browser). Offline shell via vite-plugin-pwa. Pages only deploys from the
   repository's default branch unless the github-pages environment allows another, so until the
   owner makes crushLAB's branch the default (or adds it under Settings, Environments,
   github-pages, Deployment branches) the Pages URL keeps serving the older project and the
   README and release notes don't advertise it.

Platform layer (`src/platform/`): the only place that knows whether we're native.

- `platform.ts` — `isNative()`, `platformName()`, `isAndroidApp()`, `hasPlugin(name)` via
  `@capacitor/core`'s `Capacitor`.
- `init.ts` — `initPlatform()`, called once from `App.tsx` (safe to call twice): sets
  `<html data-platform>`, the service worker (below), and in the APK the system bars, back button,
  keyboard and the launch update check.
- `files.ts` — `saveFile(blob, filename, mime)` → `'downloaded' | 'shared' | 'cancelled'`: web →
  anchor download; APK → write to the cache dir with `@capacitor/filesystem` and open the Android
  share sheet with `@capacitor/share` (WebView blob downloads don't work). The file crosses the
  bridge in pieces of 1.5 MB (`writeFile`, then `appendFile`; UTF-8 text slices or base64 of whole
  3-byte groups) so a save with images can't exhaust the WebView's memory, and earlier exports are
  cleared first. Every export in the app goes through this; closing the share sheet is not an
  error.
- `backButton.ts` — `@capacitor/app` `backButton` listener: close the top sheet/dialog if one is
  open (the overlay registry lives in `src/ui/overlays.ts`, re-exported by `platform/overlays.ts`;
  Sheet and ConfirmDialog register themselves), else `useNav.back()`, and at a root (hub, gate,
  onboarding with nothing behind it) minimize the app instead of exiting abruptly. A screen that
  wants a "leave?" confirm on back registers one with `pushOverlay`.
- `http.ts` — native HTTP: `request(url, { method, headers, body, timeoutMs, signal })` →
  `{ status, text, headers }` through `CapacitorHttp` (no CORS, cleartext allowed), and
  `fetchWithFallback(url, { ..., probeUrl })` for other callers such as the Phase 5 image server.
  `CapacitorHttp` does not patch `window.fetch` (`enabled: false`), so streaming keeps working; the
  model client has its own fallback with the same rule. Claude calls don't need it: Anthropic
  sends CORS headers.
  **Never send a paid request twice.** A fetch TypeError doesn't prove the request never left the
  phone (the connection can drop after the body went out; a gateway can answer without CORS
  headers after the server did the work). GET and HEAD retry natively on any TypeError. Any other
  method retries natively only when `probeWebview(probeUrl)` proves the WebView can't reach the
  origin at all: a WebView GET of a cheap URL on the same server (the model client uses
  `{baseUrl}/models`) with the same headers, so it gets the same preflight, fails, and a native GET
  answers (any status, an empty 4xx included). Then the POST's preflight failed and nothing ran;
  the origin is remembered and later calls go straight to native HTTP (Test connection forgets it
  and checks again). If the probe reaches the server, the error stays a network error and nothing
  is re-sent. A native 4xx/5xx with an empty body (Android reports FileNotFoundException) is an
  answer, not "unreachable".
- `updates.ts` — APK only: compare the build number baked in at build time
  (`import.meta.env.VITE_BUILD_NUMBER` from `BUILD_NUMBER`, 0 in dev) with the latest GitHub
  release tag (`build-<n>`) of `UPDATE_REPO`; prefer its `crushlab.apk` asset. `checkForUpdate()`
  never throws. Manual "Check for updates" in Settings (App section), plus an on-launch check
  2.5 s after start that the player can switch off (`Settings.autoUpdateCheck`; it sends nothing
  about the player and stays quiet until the age gate is passed). A newer build raises
  `UpdateNotice` ("Build N is ready", Download / Not now); Download opens the APK URL, which
  Capacitor hands to the system browser.
- `serviceWorker.ts` — the web app and PWA register `sw.js` (offline shell, background updates;
  vite-plugin-pwa's own registration script is off). The APK never does and removes any old
  registration: it serves its files from the APK, and a service worker would serve the previous
  build's bundle on the first launch after an upgrade (CI also swaps the APK's `sw.js` for the
  kill switch in `scripts/android/sw.js`, for installs that still carry builds 24-25's worker).
  Phase 6: `registerType: 'prompt'`. `watchForUpdates(container, registration, { onUpdate, reload })`
  offers a worker that finishes installing while an older one controls the page (never the first
  install), once per page load, as a toast "A new version is ready." with Reload (toasts take an
  optional `{ label, run }` action and `ms` 0 keeps them up). Reload posts `SKIP_WAITING` to the
  waiting worker and reloads on `controllerchange` (only after the player's Reload; a 4 s fallback
  reloads anyway). An open tab asks for a newer `sw.js` when it becomes visible and hourly. The
  precache holds index.html, JS, CSS, woff2 fonts, icons and the manifest (not bundled tier art,
  which is cached the first time it's shown); `navigateFallback` is index.html; model and image
  calls are never cached.
- `statusBar.ts`, `keyboard.ts`, `haptics.ts` — velvet bars with light icons; while the keyboard
  is up the focused field is scrolled into view and `<html data-keyboard="open">` is set;
  `tap()` / `success()` haptics (no-op on the web). A bottom-pinned action bar (sticky, bottom 0)
  gets `data-keyboard-static`, which `tokens.css` turns static while the keyboard is up, and
  `html { scroll-padding-bottom }` keeps a field clear of such a bar when it is scrolled into view.
  The date composer must do the same.
- System UI: status bar and navigation bar tinted velvet; content respects safe-area insets.

Capacitor config (`capacitor.config.ts`): `server.androidScheme: 'http'` (http://localhost is still
a secure context, and it lets the WebView reach `http://192.168.x.x` model servers on the LAN
without mixed-content blocking), `server.cleartext: true`, `android.allowMixedContent: true`,
velvet `backgroundColor`, `SystemBars.insetsHandling: 'css'` (edge to edge; on WebView 140+
`env(safe-area-inset-*)` holds the real bar sizes, on older WebViews Capacitor pads the view),
`CapacitorHttp.enabled: false`, `android.webContentsDebuggingEnabled: false` (CI ships a debug
build; without this anyone with the unlocked phone and a USB cable could read the stored keys and
history through chrome://inspect).

Icons: `scripts/make-icons.mjs` draws every icon from `assets/icon.svg` (full bleed) and
`assets/icon-foreground.svg` (adaptive-icon safe zone): the PWA icons and favicons in `public/`,
and the Android resources in `assets/android/res/` (adaptive + monochrome launcher icons, legacy
icons, the Android 12+ splash icon), which CI copies over the generated project's `res/`.

CI (`.github/workflows/build.yml`), Android job: `npx cap add android`, copy the icon resources,
patch `styles.xml` (velvet window and bars; the launch theme's `android:background` is replaced by
`windowSplashScreenBackground` + `windowSplashScreenAnimatedIcon`, because a theme-level
background would paint over core-splashscreen's icon on Android 7 to 11), the manifest (portrait,
`windowSoftInputMode="adjustResize"` so Android 10 and older report keyboard insets,
`allowBackup="false"` so keys and history stay out of Google backups, cleartext), `cap sync`, stamp
`versionCode` = run number and `versionName` "0.1.0 (build N)" and pin the signing key in an
appended Gradle block, build, then verify the APK's signer against `signing/debug.keystore`
(apksigner) and its package, versionCode, cleartext and backup flags (aapt2). Every patch fails
the job if it doesn't apply. The release job publishes `crushlab.apk` and `crushlab-<n>.apk` under
`build-<n>`. Only builds of the release branch (repository variable `RELEASE_BRANCH`, falling back
to the branch named in the workflow) can become latest, and only when no newer build is out;
every other branch publishes a prerelease, which the update check and the
`releases/latest/download/crushlab.apk` link ignore. The workflow token is read-only except in the
release job, and checkouts don't keep it. Pages deploy is `continue-on-error` until Pages is
switched on and accepts the branch (above).

Sideloading and Android developer verification: the APK is installed from GitHub, outside any
store. Google's developer verification for apps installed on certified devices (announced for
Brazil, Indonesia, Singapore and Thailand from September 2026 and worldwide in 2027; dates not
re-checked here) blocks installing apps whose package isn't registered to a verified developer.
Before it reaches the player's country, register a developer account (the hobbyist tier is
enough) and register `app.crushlab.game` with the certificate in `signing/debug.keystore`. That's
why the key stays pinned: a new key would need a new registration and would break upgrades.

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

## Providers: Claude and ChatGPT first

The player brings their own Claude (Anthropic) or ChatGPT (OpenAI) API key; these are the two
headline presets and Claude is the default. Ollama, LM Studio, OpenRouter and Custom stay available
under "Other providers". Each preset has a wire format (`provider`):

| preset | provider | base URL | models (defaults, editable) |
|---|---|---|---|
| claude | `anthropic` | https://api.anthropic.com | story `claude-opus-5`, judge `claude-haiku-4-5` |
| chatgpt | `openai` | https://api.openai.com/v1 | picked from the key's `/models` list after Test connection (story: newest full `gpt-*` chat model; judge: newest `*-mini`) |
| grok | `openai` (xAI's API is OpenAI-compatible) | https://api.x.ai/v1 | picked from the key's `/models` list (story: newest full `grok-*` chat model; judge: a fast/mini variant) |
| ollama / lmstudio / openrouter / custom | `openai` | as before | as before |

**Mix and match per role.** Keys and base URLs are stored per preset (`ConnectionSettings.providers:
Record<ConnectionPreset, { baseUrl, apiKey }>`), and each role picks a preset + model:
`story: { preset, model }` and `judge: { preset, model }` (judge defaults to "same as story").
The story route serves story and memory calls; the judge route serves judge, agreement and
suggestions calls. So Claude can write the story while Grok or a ChatGPT mini model judges, etc.
Test connection runs per configured preset.

Built: `ConnectionSettings` is `{ providers: Record<ConnectionPreset, { baseUrl, apiKey }>, story,
judge, storyTemperature, maxTokens, effort }`. Every preset keeps its own address and key, so a key
is never sent to another provider's server. Stored Phase 1 settings migrate on load
(`src/store/connection.ts`, `migrateConnection`); new installs start on Claude for both roles
(`claude-opus-5` writes, `claude-haiku-4-5` judges, effort low, no key). After the first
successful Test connection, if the story provider has no key, both roles move to the tested
provider. Store action: `updateProvider(preset, patch)`.

- `src/llm/anthropic.ts` — Claude via the official `@anthropic-ai/sdk` (`new Anthropic({ apiKey,
  dangerouslyAllowBrowser: true })`; the SDK sends the direct-browser-access CORS header). No raw
  fetch and no OpenAI-compatibility shim for Claude. Story: `client.beta.messages.stream(...)`,
  deltas from `text_delta` events, `finalMessage()` for `stop_reason`. `system` is the top-level
  system prompt; messages must start with `user` (turn 0 sends `(The date begins.)`).
  - Thinking is on by default on Claude Opus 5; `max_tokens` caps thinking + text, so Claude calls
    use generous caps (story 16000 streamed, JSON calls 16000) and length is controlled by the
    prompt. Latency/cost lever: `output_config: { effort }` — story defaults to `low` (chat is
    latency-sensitive), judge/suggestions/memory `low`. Exposed in settings as "Effort" for Claude.
  - Sampling params are rejected (400) on Opus 5 / Sonnet 5 / Opus 4.7+ — never send `temperature`
    to those; Haiku 4.5 and 4.6-generation models accept it (judge temperature 0.2 applies there).
    Unknown models: send nothing, and learn from a 400 that names the parameter.
  - JSON calls use structured outputs (`output_config.format` with a JSON schema for the judge,
    agreement and suggestions shapes); if a model rejects it (400 naming output_config/format),
    retry without and fall back to the defensive parse + nudge path.
  - Refusals: always check `stop_reason === 'refusal'` before reading content. Opus 5 requests
    opt into server-side fallbacks (`betas: ['server-side-fallback-2026-07-01']`,
    `fallbacks: 'default'`). If the final response is still a refusal, the story turn becomes an
    in-world beat ("{name} changes the subject.") plus a system note in the date suggesting a lower
    heat; judge/JSON calls fall back to the neutral result. Never crash or stall the date.
  - Models list: `client.models.list()`; Test connection lists them and runs a tiny completion.
  - Retries: the story stream and the model list keep the SDK's retries (they only re-send before
    anything was generated). Non-streamed calls (judge, memory, test) get `maxRetries: 0`, since a
    timeout or a dropped connection there can follow a finished, billed generation; they retry
    once themselves, only on 429 or 529 (not billed), after the server's retry-after (at most
    10 s).
  - Errors read the API's own message (`error.error.message`), not the SDK's JSON dump.
- `src/llm/client.ts` (OpenAI-compatible, used for ChatGPT and the others): for api.openai.com send
  `max_completion_tokens` instead of `max_tokens` and `reasoning_effort: 'low'`; OpenAI's and
  xAI's APIs get a cap of at least 16000 (`HOSTED_MIN_TOKENS`, like Claude's) because reasoning
  spends it before any text; if a model rejects `temperature`, `reasoning_effort` or another
  parameter (400 naming it), retry once without it and remember per model; `response_format`
  json_object as before. Refusals (`message.refusal`, `finish_reason: 'content_filter'`) are handled
  like Claude's.
- Keys are stored only on the device (Dexie), masked in the UI, never included in save exports.
  Claude, ChatGPT and Grok always use their own API address (their cards have no address field;
  `migrateConnection` resets any other), and a save import keeps this device's address wherever it
  keeps this device's key, so a file can't send a key to a server of its choosing. A Phase 1
  Custom slot aimed at api.anthropic.com moves to the Claude card on load (Claude only goes through
  the official SDK).
- Heat and provider policies: Claude and ChatGPT follow their providers' usage policies and generally
  won't write explicit sexual content; heat 4–5 will often be declined or toned down. The heat
  control shows that note when a Claude or ChatGPT preset is active; local/OpenRouter models are the
  route for heat 4–5.

## Art providers: Automatic1111/Forge and Grok Imagine (Phase 5)

`ImageSettings.provider: 'a1111' | 'grok'`. Grok Imagine (xAI) generates tier art without a local GPU,
which suits Android:
- POST `https://api.x.ai/v1/images/generations` with `Authorization: Bearer <xAI key>` (the same key
  as the Grok chat preset), body `{ model, prompt, n: 1, response_format: 'b64_json', aspect_ratio }`.
  Model default `grok-imagine-image`, editable, listed from the API when possible; portrait
  aspect ratio (`2:3`) for character art. Response `data[0].b64_json` -> Blob cached in Dexie.
- xAI has no negative prompt, so the locked safety text goes into the prompt itself: every
  participant is stated as an adult with their age ("adult woman, 28 years old"), plus a fixed
  clause that everyone depicted is a consenting adult and nothing childlike or non-consensual is
  shown. Built in code, never editable. A1111 keeps the negative prompt as before.
- In the APK, a CORS failure falls back to native HTTP like the model calls. A background painting
  that times out is recorded as a failure even though native HTTP reports every abort as an
  AbortError (`paint` reads the signal's reason).
- A limit of self-hosted A1111/Forge: a textual-inversion embedding fires whenever its file name
  appears as a plain word in the prompt, and the app can't see what a server's embeddings encode.
  The scrub can't tell a harmless tag from an embedding's trigger word; the frozen negative prompt
  and the positive clause are the defense there, and the server's contents are the player's
  responsibility.
- Grok Imagine video (animating a won character's final art) is a possible later addition.
- Dev builds only: the localStorage key `crushlab.debug.xaiBase` (`DEV_XAI_BASE_KEY`) points Grok
  Imagine at another address, so `npm run e2e:phase5` can use the mock. Production builds drop the
  branch (`import.meta.env.DEV`) and no screen offers it.

## Phase 6: saves, new game sets and the design pass

- Save files (`src/db/repo.ts`, `exportSave`/`importSave`) carry every kv row (settings with every
  API key blanked, profile, game, the open date's `activeDate` mark, `artFavorites`, `artGroups`,
  ui), relationships, custom and pack characters, packs and dates (with their ids, so the open
  date's mark still resolves), and images only with Include images (generated, imported and pack
  art, favorites, revised prompts). Import replaces the device's game; keys stay per preset; images
  are replaced only when the file carries them. Save slots stay on the device. Round trip:
  `src/db/saveRoundTrip.test.ts`.
- New game, "Who's in town" (`src/screens/CharacterSets/NewGameSets.tsx`, mounted in onboarding):
  one switch per set with characters (`newGameSetRows` in `setsModel.ts`), each saving
  `settings.activeSets` at once through `useRoster.setActive`; the last set in play can't be
  switched off there. Skipping it keeps the defaults.
- Design pass (every screen at 412x915 touch and 1280x800, with the lib.mjs design, sideways-scroll
  and 48px checks): the polycule map's canvas snaps to its centre (You) when a big roster is wider
  than the phone, instead of opening cut off on the right; gallery tiles sit five to a row on wide
  screens (five tiers, no orphan).
