# crushLAB

An adults-only (18+) dating sim where every character is played by a language model. You date a
roster of original characters, all fictional adults, and what you say moves affection and trust,
unlocks their stories and galleries, and decides how things end. Intimacy in the story is always
consensual. Your profile, saves and settings stay on your device; the only thing sent anywhere is
the story itself, to the model you connect.

Android is the main platform. The same app also runs in any modern browser.

## Install on Android

**The app (recommended).** Download the newest APK:
https://github.com/mreindl118-boop/Monkeyball/releases/latest/download/crushlab.apk

Open the downloaded file to install it. Android asks once to allow installs from your browser or
file manager. Later builds install over the old one and keep your saves, because every build is
signed with the same key. Every build is on the
[releases page](https://github.com/mreindl118-boop/Monkeyball/releases), also under its build
number (`crushlab-<n>.apk`).

**The web app.** Open https://mreindl118-boop.github.io/Monkeyball/ in Chrome, then use the menu and
pick Install app. It works offline once installed. It can use a hosted model or one running on the
phone itself, but not a PC on your Wi-Fi (see below).

## Connect a model on Android

crushLAB talks to any OpenAI-compatible server. Pick where your model runs on the connection
screen, then Test connection.

**A hosted model (OpenRouter).** Choose OpenRouter and paste an API key from
https://openrouter.ai/keys. Works in the app and the web app.

**A PC on your Wi-Fi (Ollama or LM Studio).** Needs the Android app: the web app is served over
https and browsers block it from reaching plain http servers on your network.

- Find the PC's address on your network, for example `192.168.1.20`.
- Ollama: start it so it listens on the network and accepts the app,
  with `OLLAMA_HOST=0.0.0.0` and `OLLAMA_ORIGINS=*` set (on Windows, set both as user environment
  variables and restart Ollama). Base URL: `http://192.168.1.20:11434/v1`.
- LM Studio: in the Developer tab, start the server with "Serve on local network" and "Enable
  CORS" turned on. Base URL: `http://192.168.1.20:1234/v1`.
- Allow the port through the PC's firewall if the test says nothing answered.

**On the phone itself (Termux).** Install Termux from F-Droid, then:

```sh
pkg install ollama
OLLAMA_ORIGINS='*' ollama serve &
ollama pull llama3.2:3b
```

Base URL: `http://127.0.0.1:11434/v1`. Works in the app and the web app. Small models (1B to 4B)
are the realistic choice on a phone.

## Development

Node 22. Everything runs from the repo root:

```sh
npm ci                 # install
npm run dev            # dev server
npm run build          # type-check and build to dist/
npm test               # unit tests (vitest)
npm run lint           # oxlint
npm run mock-llm       # a fake OpenAI-compatible model server on :11435
npm run e2e:phase1     # browser end-to-end check of the first-launch flow
npm run e2e:android    # the same flow as Chrome on an Android phone (touch, 412x915 and 360x800)
node scripts/make-icons.mjs   # redraw every icon from assets/icon.svg and assets/icon-foreground.svg
```

The e2e scripts use the Chromium at `/opt/pw-browsers/chromium` (set `CHROMIUM_PATH` to use
another); screenshots land in `scripts/e2e/out/`.

The Android app is built by GitHub Actions (`.github/workflows/build.yml`) on every push: it builds
and tests the web app, deploys it to GitHub Pages, wraps it with Capacitor 8, signs the APK with
`signing/debug.keystore` and publishes it as release `build-<n>`. The `android/` folder is
generated there and never committed. To build locally you need JDK 21 and the Android SDK; follow
the Android job's steps in that workflow.

More: `docs/SPEC.md` (the product), `docs/ARCHITECTURE.md` (how it's built), `PROGRESS.md` (where
it stands).
