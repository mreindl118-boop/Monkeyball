# 🍌 Rollin' Rascals

A **Super Monkey Ball**–inspired 3D roll-em-up, built from scratch with Three.js and a custom
arcade physics engine. Pick a rascal (a loving parody of a famous video-game hero), get sealed
inside a transparent ball, and roll through 15 hand-crafted stages across 3 worlds — grabbing
bananas, dodging bumpers, riding launch pads, and racing the clock to the goal gate.

![worlds](https://img.shields.io/badge/worlds-3-green) ![stages](https://img.shields.io/badge/stages-15-blue) ![characters](https://img.shields.io/badge/rascals-8-yellow) ![modes](https://img.shields.io/badge/modes-4-orange) ![multiplayer](https://img.shields.io/badge/multiplayer-local%20%2B%20online-red)

## 🕹 Game modes

- **🌴 Adventure** — the classic: 15 stages, beat the clock, reach the goal gate.
- **🎯 Sky Target** (Monkey Target Deluxe-style) — tuck down a giant banked half-pipe
  (hold UP for launch speed!), pop your ball open into wings and glide over the ocean
  grabbing air bananas & power-ups, fighting a per-round **wind sock**, then pick your
  landing: stay OPEN and you bounce & roll, or CLOSE the ball to plant like a cannonball
  right where you aimed. Land on dartboards, climb a stepped **pyramid** (tiny apex pays
  420) or ride a **funnel bowl** down to its floor — every target flies its point value,
  and the farther/smaller/trickier it is, the more it pays, out to a 480m jackpot bowl.
  A drifting ×3 bonus board, distance markers — and between balls, a Deluxe-style
  **item shop** where your flight bananas buy Sticky Ball, Double Score, Turbo Launch or
  a Feather. 3 balls per game; every rascal has an air-adapted signature skill.
- **🍌 Banana Rush** — 60-second arena collect-athon: respawning bananas, timed golden
  bunches, combo chains, and 🧲/🚀/⏰ arena power-ups. Best haul is saved, and everything
  you grab banks to the shop.
- **⚔️ Duel (multiplayer!)**
  - **Local** — 2 players, one device, one arena: P1 on WASD (+Space/Shift), P2 on
    Arrows (+Enter/Right-Shift), or two gamepads. Real ball-vs-ball bumping (heavier
    rascals shove harder), falls scatter your bananas back into the arena, most bananas wins.
  - **Online** — host a room, share the 4-letter code, and battle a friend: parallel
    arenas on a shared clock, with your rival rendered live as a translucent ghost and a
    live score race in the HUD. Disconnects count as forfeits.

### Online duel setup

The duel relay is a tiny WebSocket room server (`server/relay.js` — no game logic, ~80 lines).

```bash
npm run host    # builds & serves the game AND the relay on :8080
```

Share `http://<your-ip>:8080` with player 2 — room codes work immediately (LAN, or the
internet if you forward the port / host it anywhere). For development, `npm run relay`
alongside `npm run dev` works too (vite proxies `/ws`). The Windows/Android builds can
join any relay by pasting its `ws://` URL in the Duel menu.

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

| Action | Keyboard | Gamepad | Touch (Android/mobile) |
|---|---|---|---|
| Roll | WASD / Arrows | Left stick | Virtual joystick (left half) or device tilt (enable in Settings) |
| Jump | Space | A | JUMP button |
| Skill | Shift / F | X / B | SKILL button |
| Rotate camera | Q / E | Right stick or LB/RB | camera auto-follows (toggle in Settings) |
| Quick restart | R | — | — |
| Pause | P / Esc | Start | ⏸ button |

Local Duel: P1 = WASD + Space/Left-Shift (or gamepad 1), P2 = Arrows + Enter/Right-Shift
(or gamepad 2).

**Sky Target flight (Monkey Target rules)**: steer your line left/right down the ramp and
**hold UP to tuck** for speed. You launch as a **closed ball** — press **JUMP (Space / A /
JUMP button) to pop the ball open into wings**, and press it again to tuck back in.
Open = stable glide: **stick up climbs, pull back to dive for speed** (arcade default —
flip to flight-sim style with Invert Pitch in Settings), left/right banks the turn, and the
wind drags you around. Closed = fast ballistic dive that mostly ignores wind — close it
over your target to drop in. A shadow marker under your ball shows exactly what you're
flying over, and your skill button fires your character's air ability. Every mode works with keyboard, gamepad and touch; menus are point-and-click/tap.

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

## 🔄 Auto-updates

Every CI build is published as a **GitHub Release** (`build-<N>`) with the APK and Windows
exes attached. On startup, the Android app (and the Windows build) checks the latest release
and shows an **UPDATE** banner when a newer build exists — one tap downloads the new APK and
Android's installer upgrades in place (saves are kept). Sideloaded apps can't install fully
silently — Android always asks for the final confirmation tap.

The APK is signed with a fixed key committed at `signing/debug.keystore` so upgrades install
over the top instead of demanding an uninstall. (That key is for casual sideloading only —
use a private keystore if you ever publish to a store.)

Easiest install for players: grab the `.apk` from the
[latest release](https://github.com/mreindl118-boop/Monkeyball/releases/latest) — no GitHub
login needed, unlike Actions artifacts.

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
src/flight.js         Sky Target mode (flight model, targets, air skills)
src/rush.js           Banana Rush mode (arena, spawner/director)
src/duel.js           duels: ball-vs-ball physics, net ghost, handshake
src/net.js            WebSocket duel client
server/relay.js       room-code relay server (npm run relay)
server/host.js        one-command game+relay host (npm run host)
desktop/              Electron shell (Windows packaging)
capacitor.config.json Android (Capacitor) packaging
```

All art, sound and levels are procedural/original. Character designs are original parodies.
