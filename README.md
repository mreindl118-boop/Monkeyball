# crushLAB

**Adults only (18+).** crushLAB is a dating sim where every character is played by a language
model. You date a roster of original characters, all fictional adults aged 21 or older, and what
you say moves affection and trust, unlocks their stories and galleries, and decides how things end.
Relationships, agreements (exclusive, open, poly), gossip, jealousy and seven endings play out
across four character sets, and you can write and share your own characters. Intimacy in the story
is always consensual.

Your profile, saves and settings stay on your device. The only thing sent anywhere is the story
itself, to the model provider you pick (and, if you turn on image generation, picture prompts to
the image server you pick). The Android app also asks GitHub whether a newer build exists; you can
switch that off in Settings.

Android is the main platform. The same app also runs in any modern browser, and installs from there
as a web app.

## Install on Android

Download the newest APK:
https://github.com/mreindl118-boop/Monkeyball/releases/latest/download/crushlab.apk

Open the downloaded file to install it. Android asks once to allow installs from your browser or
file manager. Every build is on the
[releases page](https://github.com/mreindl118-boop/Monkeyball/releases), also under its build
number (`crushlab-<n>.apk`).

**Updating.** The app checks for a newer build when it starts (Settings, App, also has Check for
updates) and shows "A new crushLAB is ready" with Download. Or download the link above again. A new
build installs over the old one and keeps your saves, because every build is signed with the same
key. Don't uninstall first: that deletes your progress (export a save in Settings if you want a
copy).

**Still seeing the old version after an update?** Builds 24 and 25 ran a web-style offline cache
inside the app, which could keep serving the old version after an upgrade. Later builds ship a kill
switch that clears that cache and reloads once. If the old version still shows, close the app from
the recent apps screen and open it again; it switches over on that start. If it still doesn't,
Android Settings, Apps, crushLAB, Storage, Clear cache (not Clear data) fixes it without touching
your saves.

## The web app (PWA)

CI also builds an installable web app. Open it in Chrome (on Android: menu, Install app; on a
desktop: the install icon in the address bar). Installed, it opens full screen like an app.

- **Offline:** after one visit, the app itself loads with no connection: screens, fonts and icons
  are cached. Only model calls (and image generation) need the network; a call made offline fails
  with a message that says why, and the date waits for you to retry.
- **Updates:** a new version downloads in the background, then "A new version is ready." appears
  with Reload. Nothing changes under you mid-date.
- **Limits:** the web app is served over https, so the browser won't let it reach plain-http
  servers on your Wi-Fi (a PC running Ollama or LM Studio). Hosted providers and a model on the
  device itself work.
- **Where:** https://mreindl118-boop.github.io/Monkeyball/ once GitHub Pages serves this branch.
  Pages only deploys from the repository's default branch, which isn't crushLAB's yet; until the
  owner makes it the default (or allows it under Settings, Environments, github-pages), that URL
  shows an older project. Use the APK until then.

## Connect a model

Open the provider you want on the connection screen (or in Settings, Connection), paste its key and
tap Test connection. Keys are stored only on your device, never go into save files, and each one is
only ever sent to its own provider. Under Roles you can mix providers: one writes the story while
another, cheaper model judges.

**Claude, ChatGPT or Grok (your own API key).** Claude is the default. Get a key at
https://console.anthropic.com/settings/keys, https://platform.openai.com/api-keys or
https://console.x.ai. Works in the app and the web app.

**OpenRouter.** Under Other providers, choose OpenRouter and paste a key from
https://openrouter.ai/keys. Works in the app and the web app, and gives you many open models.

**Ollama on a PC on your Wi-Fi.** Needs the Android app (see the web app's limits above).

- Find the PC's address on your network, for example `192.168.1.20`.
- Start Ollama so it listens on the network and accepts the app: set `OLLAMA_HOST=0.0.0.0` and
  `OLLAMA_ORIGINS=*`, then restart it. On Windows, set both as user environment variables and quit
  and reopen Ollama from the tray. On macOS or Linux:

  ```sh
  OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS='*' ollama serve
  ```

- In crushLAB, Other providers, Ollama, "PC on my Wi-Fi": `http://192.168.1.20:11434/v1`.
- Allow port 11434 through the PC's firewall if the test says nothing answered.

**LM Studio on a PC on your Wi-Fi.** In the Developer tab, turn on "Enable CORS" and "Serve on
local network", then start the server. Base URL: `http://192.168.1.20:1234/v1` (your PC's address).
Allow port 1234 through the firewall.

**On the phone itself (Termux).** Install Termux from F-Droid, then:

```sh
pkg install ollama
OLLAMA_ORIGINS='*' ollama serve &
ollama pull llama3.2:3b
```

Base URL: `http://127.0.0.1:11434/v1`. Works in the app and the web app. Small models (1B to 4B)
are the realistic choice on a phone.

On a desktop browser, the same Ollama and LM Studio settings work with `http://127.0.0.1` addresses.

## Heat and provider policies

Heat (1 Sweet to 5 Raw) sets the story's tone, not a filter; change it any time from the hub. Claude
and ChatGPT follow their providers' content policies, so heat 4 and 5 are often declined or toned
down (the app tells you when that happens). Local models and OpenRouter models are the choice for
those levels. Whatever the model, the world rules are fixed: every character is an adult of 21 or
older, and intimacy is consensual or it doesn't happen.

## Image generation (optional)

Every character has five tiers of pictures that unlock as they get closer to you, plus a picture
for each ending. Without an image server you see placeholders (or art that comes with a pack), and
you can always use your own image for any tier. To paint them, open Settings, Images:

- **Automatic1111 or Forge** on a PC: launch it with `--api --cors-allow-origins=*` (and `--listen`
  to reach it from the phone), then enter its address, for example `http://192.168.1.20:7860`, and
  tap Test image generation. Needs the Android app from a phone (the web app can only reach it at
  `http://127.0.0.1:7860` on the same PC).
- **Grok Imagine** uses the key on the Grok connection card.

Picture prompts always carry a fixed safety text (adults only, no minors, no non-consent) that
can't be edited from the app, and a card that fails the safety check gets no picture at all.

## Mods: your own characters and packs

- **Character sets**, from the hub: turn sets on and off (a new game also asks who's in town).
  Turning a set off hides its characters; their progress is kept.
- **Import** a character (`.json`) or a pack (`.zip` with a `manifest.json` and character files) in
  Character sets or Settings, Character sets and mods. The pack's characters appear on the hub, in
  Character sets and in the editor.
- **The character editor** makes characters from scratch or from a duplicate of a bundled one, and
  exports them as `.json` or a `.zip` pack to share.
- **The safety floor** can't be modded away: ages must be 21 or older (a typed 18 is rejected),
  references to minors or childlike traits are blocked, and the world rules and image safety text
  are baked in and can't be edited.

The file format is in `docs/SPEC.md` (Characters and modding); the bundled sets in
`src/data/sets/` are working examples.

## Saves

Settings, Saves exports everything to one `.json` file: your profile, settings (without API keys),
every relationship, the game's state, your characters and packs, and your dates, plus pictures if
you tick Include images. Import it on another device to carry on there. The app keeps no Android
backup of its own, so this is how you move to a new phone. Save slots on the same screen are quick
snapshots on the device.

## Development

Node 22. Everything runs from the repo root:

```sh
npm ci                 # install
npm run dev            # dev server
npm run build          # type-check and build to dist/ (with the service worker)
npm run preview        # serve dist/ (the PWA, offline shell included)
npm test               # unit tests (vitest)
npm run lint           # oxlint
npx tsc -b             # type-check only
npm run mock-llm       # a fake OpenAI-compatible model server on :11435
npm run e2e:phase1     # the first-launch flow in a browser
npm run e2e:phase2     # hub, profiles, character sets, the editor and mods, on an Android phone
npm run e2e:phase3     # full dates against the mock model: judge, chips, recap, early exit, gain cap
npm run e2e:phase4     # relationships: define the relationship, gossip, betrayal, friend route, endings
npm run e2e:phase5     # the gallery, the instant-film reveal and image providers
npm run e2e:android    # the first-launch flow as Chrome on an Android phone (412x915 and 360x800)
node scripts/e2e/offline.mjs  # the PWA: install assets, offline reload, offline model call, update prompt
node scripts/make-icons.mjs   # redraw every icon from assets/icon.svg and assets/icon-foreground.svg
```

The e2e scripts use the Chromium at `/opt/pw-browsers/chromium` (set `CHROMIUM_PATH` to use
another; `E2E_SKIP_BUILD=1` reuses `dist/`); screenshots land in `scripts/e2e/out/`.

The Android app is built by GitHub Actions (`.github/workflows/build.yml`) on every push: it builds
and tests the web app, deploys it to GitHub Pages (once Pages accepts this branch), wraps it with
Capacitor 8, swaps the web app's `sw.js` for the kill switch (`scripts/android/sw.js`), signs the
APK with `signing/debug.keystore` and publishes it as release `build-<n>`. Only builds from the
release branch (the `RELEASE_BRANCH` repository variable, or the branch named in the workflow) are
offered to installed apps as updates; other branches publish prereleases. The `android/` folder is
generated there and never committed. To build locally you need JDK 21 and the Android SDK; follow
the Android job's steps in that workflow.

More: `docs/SPEC.md` (the product), `docs/ARCHITECTURE.md` (how it's built), `PROGRESS.md` (where
it stands).
