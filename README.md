# 🍌 Rollin' Rascals

A **Super Monkey Ball**–inspired 3D roll-em-up, built from scratch with Three.js and a custom
arcade physics engine. Pick a rascal (a loving parody of a famous video-game hero), get sealed
inside a transparent ball, and roll through 15 hand-crafted stages across 3 worlds — grabbing
bananas, dodging bumpers, riding launch pads, and racing the clock to the goal gate.

![worlds](https://img.shields.io/badge/worlds-3-green) ![stages](https://img.shields.io/badge/stages-15-blue) ![characters](https://img.shields.io/badge/rascals-8-yellow)

## ✨ Features

- **Custom arcade physics** — rolling momentum, grippy floors, bouncy walls, moving/spinning
  platforms that carry the ball, bumpers, launch pads (flight!), coyote-time jumps.
- **8 parody characters**, each fully animated (procedural bodies — idle, roll, air, win and
  dizzy poses) with unique stats (Speed / Grip / Weight / Jump) and a signature skill:

  | Rascal | Parody of… | Skill |
  |---|---|---|
  | Marco | a certain plumber | **Super Stomp** — slam & mega-bounce |
  | Zippy | a blue hedgehog | **Sonic Boost** — explosive dash |
  | Puffboy | a pink puffball | **Puff Up** — big hop + slow-fall (hold JUMP to glide) |
  | Lonk | the Hero of Time | **Shield Stop** — instant halt + bump immunity |
  | Sparkle | an electric mouse | **Zap Magnet** — pulls bananas to you |
  | Chonko | a big ape | **Kong Quake** — ground-pound + mega grip |
  | Peacho | royalty with a parasol | **Parasol Glide** — long floaty glides |
  | Waka | a hungry yellow circle | **Chrono Chomp** — freezes the timer |

- **3 themed worlds** with unique procedural textures, skies, music and decor: Banana Jungle,
  Sky Kingdom, and Mt. Kaboom (lava!).
- **Scoring & progression** — bananas (singles & bunches), time bonuses, 1–3 star ratings,
  best-score/best-time records, sequential level unlocks, lives & game-over.
- **Banana Shop upgrades** — spend banked bananas on acceleration, grip, jump and bonus-clock
  upgrades, and recruit locked characters.
- **Procedural chiptune soundtrack & SFX** — zero audio assets, all WebAudio.
- **Full input support** — keyboard (WASD/arrows + Space + Shift), gamepad, touch virtual
  joystick, and optional device-tilt on mobile.
- **Local save** — progress, unlocks, upgrades and records persist via localStorage.

## 🎮 Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Roll | WASD / Arrows | Left stick | Virtual joystick (left half) |
| Jump | Space | A | JUMP button |
| Skill | Shift / E | X / B | SKILL button |
| Pause | P / Esc | Start | ⏸ button |

## 🚀 Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build (fully static, works from any web server or file host):

```bash
npm run build      # outputs to dist/
```

## 🪟 Windows build

Built automatically by GitHub Actions (`.github/workflows/build.yml`, **windows** job) —
download the `rollin-rascals-windows` artifact for an NSIS installer **and** a portable
single-file exe. To build manually on a Windows machine:

```bash
npm install && npm run build
cp -r dist desktop/dist
cd desktop && npm install && npx electron-builder --win
```

## 🤖 Android APK

Built automatically by GitHub Actions (**android** job) — download the
`rollin-rascals-android` artifact (`app-debug.apk`) and sideload it. To build manually
(requires Android SDK + Java 17):

```bash
npm install && npm run build
npx cap add android && npx cap sync android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## 🧱 Project layout

```
index.html            HTML shell, HUD & menu styling, touch controls
src/main.js           game loop, state machine, camera, abilities, scoring
src/physics.js        custom sphere-vs-OBB arcade physics
src/stage.js          level → meshes/solids, goal gate, decor, sky
src/levels.js         15 data-driven stage definitions
src/characters.js     8 procedural animated parody characters + stats
src/textures.js       procedural canvas textures (no image assets)
src/audio.js          procedural WebAudio SFX + chiptune sequencer
src/input.js          keyboard / gamepad / touch / tilt input
src/ui.js             DOM menus (title, select, shop, results…)
src/save.js           localStorage persistence
desktop/              Electron shell (Windows packaging)
capacitor.config.json Android (Capacitor) packaging
```

All art, sound and levels are procedural/original. Character designs are original parodies.
