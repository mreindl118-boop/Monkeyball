// Rollin' Rascals — main game loop & state machine.
import * as THREE from 'three';
import { Ball, stepBall, BALL_RADIUS } from './physics.js';
import { Stage } from './stage.js';
import { LEVELS, WORLDS, starThresholds } from './levels.js';
import { getCharacter, buildCharacterMesh, animateCharacter } from './characters.js';
import { pollInput, initTouch, clearInput, onPause } from './input.js';
import { UI } from './ui.js';
import { getSave, save, addBananas, recordResult, unlockNextLevel } from './save.js';
import { sfx, playMusic, stopMusic, unlockAudio } from './audio.js';
import { TargetMode } from './flight.js';
import { RUSH_LEVEL, RushDirector, RUSH_TIME } from './rush.js';

// ---------------- renderer & scene ----------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#120b2e');
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);

const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
sun.position.set(18, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.far = 120;
scene.add(sun, sun.target);
scene.add(new THREE.AmbientLight(0x8899cc, 1.1));
const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x3a2a10, 0.8);
scene.add(hemi);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------- game state ----------------
const G = {
  state: 'boot',            // menu | countdown | play | target | paused | goal | fallout | results
  mode: 'adventure',        // adventure | target | rush
  targetGame: null,
  rushDir: null,
  turboTimer: 0,
  pausedFrom: 'play',
  stage: null,
  ball: new Ball(),
  ballGroup: null,          // transparent shell + character
  ballShell: null,
  charBuilt: null,
  char: null,
  levelIndex: 0,
  timeLeft: 0,
  timerFrozen: 0,
  bananasGot: 0,
  score: 0,
  lives: 3,
  runScore: 0,
  camYaw: 0,
  abilityCooldown: 0,
  magnetTimer: 0,
  stompArmed: false,
  countdownT: 0,
  stateT: 0,
  clock: new THREE.Clock(),
  simT: 0,
  menuOrbit: 0
};

// ---------------- ball & character visuals ----------------
function makeBallGroup(char) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 32, 24),
    new THREE.MeshPhysicalMaterial({
      color: char.ballColor, transparent: true, opacity: 0.3,
      roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1,
      side: THREE.DoubleSide
    })
  );
  shell.castShadow = true;
  // seam rings so you can see it roll
  const ringMat = new THREE.MeshBasicMaterial({ color: char.ballColor, transparent: true, opacity: 0.55 });
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS, 0.012, 6, 48), ringMat);
  const ring2 = ring1.clone(); ring2.rotation.y = Math.PI / 2;
  shell.add(ring1, ring2);
  const built = buildCharacterMesh(char.id);
  built.group.scale.setScalar(0.62);
  built.group.position.y = -BALL_RADIUS * 0.82;
  g.add(shell, built.group);
  return { group: g, shell, built };
}

function spawnBallVisual() {
  if (G.ballGroup) scene.remove(G.ballGroup.group);
  G.char = getCharacter(getSave().selectedChar);
  G.ballGroup = makeBallGroup(G.char);
  scene.add(G.ballGroup.group);
}

// ---------------- confetti ----------------
let confetti = null;
function burstConfetti(pos) {
  if (confetti) scene.remove(confetti.points);
  const N = 160;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const vels = [];
  const palette = [[1, .88, .3], [1, .4, .55], [.4, .8, 1], [.5, 1, .6], [1, .6, .2]];
  for (let i = 0; i < N; i++) {
    positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y + 1; positions[i * 3 + 2] = pos.z;
    const c = palette[i % palette.length];
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
    const a = Math.random() * Math.PI * 2;
    vels.push(new THREE.Vector3(Math.cos(a) * (2 + Math.random() * 5), 5 + Math.random() * 7, Math.sin(a) * (2 + Math.random() * 5)));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.22, vertexColors: true }));
  scene.add(points);
  confetti = { points, vels, life: 2.2 };
}

function updateConfetti(dt) {
  if (!confetti) return;
  confetti.life -= dt;
  if (confetti.life <= 0) { scene.remove(confetti.points); confetti = null; return; }
  const pos = confetti.points.geometry.attributes.position;
  for (let i = 0; i < confetti.vels.length; i++) {
    const v = confetti.vels[i];
    v.y -= 12 * dt;
    pos.array[i * 3] += v.x * dt;
    pos.array[i * 3 + 1] += v.y * dt;
    pos.array[i * 3 + 2] += v.z * dt;
  }
  pos.needsUpdate = true;
}

// ---------------- stage loading ----------------
function disposeModes() {
  if (G.targetGame) { G.targetGame.dispose(); G.targetGame = null; }
  G.rushDir = null;
  G.turboTimer = 0;
  UI.setExtra('');
}

function loadStage(index, { resetLives = false } = {}) {
  disposeModes();
  if (G.stage) G.stage.dispose();
  G.levelIndex = index;
  const level = index === -1 ? RUSH_LEVEL : LEVELS[index];
  const world = WORLDS[level.world];
  G.stage = new Stage(scene, level, world);
  const sv = getSave();
  G.timeLeft = level.time + sv.upgrades.time * 3;
  G.timerFrozen = 0;
  G.bananasGot = 0;
  G.score = 0;
  G.abilityCooldown = 0;
  G.magnetTimer = 0;
  G.stompArmed = false;
  if (resetLives) { G.lives = 3; G.runScore = 0; }
  spawnBallVisual();
  G.ball.reset(level.start.p);
  G.camYaw = level.start.ry || 0;
  clearInput();
  playMusic(world.music);
  setState('countdown');
  G.countdownT = 2.2;
  UI.clear();
  UI.hudVisible(true);
  UI.flashMessage('READY...', 0);
  sfx.ready();
  if (level.isRush) {
    G.rushDir = new RushDirector({
      stage: G.stage, ui: UI,
      addTime: (s) => { G.timeLeft += s; },
      setTurbo: (s) => { G.turboTimer = s; },
      setMagnet: (s) => { G.magnetTimer = Math.max(G.magnetTimer, s); }
    });
  }
}

function startRushMode() {
  G.mode = 'rush';
  loadStage(-1, { resetLives: true });
}

function startTargetMode() {
  G.mode = 'target';
  disposeModes();
  if (G.stage) { G.stage.dispose(); G.stage = null; }
  if (G.ballGroup) { scene.remove(G.ballGroup.group); G.ballGroup = null; }
  G.char = getCharacter(getSave().selectedChar);
  clearInput();
  playMusic('sky');
  UI.clear();
  UI.hudVisible(true);
  G.targetGame = new TargetMode({
    scene, camera, char: G.char, ui: UI,
    onFinish: (res) => {
      setState('results');
      UI.hudVisible(false);
      stopMusic();
      const sv = getSave();
      UI.showModeResults({
        title: 'FLIGHT OVER!',
        subtitle: `${G.char.name} — Sky Target`,
        newBest: res.total > 0 && res.total >= (sv.targetBest || 0),
        lines: [
          ['Total Score', `⭐ ${res.total}`],
          ['Air Bananas', `🍌 ${res.bananas}`],
          ['Banana Reward', `🍌 +${res.bananas + Math.floor(res.total / 25)}`],
          ['Best Ever', `⭐ ${sv.targetBest || 0}`]
        ]
      });
    }
  });
  setState('target');
}

function endRush() {
  const sv = getSave();
  addBananas(G.bananasGot);
  const newBest = G.bananasGot > 0 && G.bananasGot >= (sv.rushBest || 0);
  if (G.bananasGot > (sv.rushBest || 0)) { sv.rushBest = G.bananasGot; save(); }
  setState('results');
  UI.hudVisible(false);
  stopMusic();
  sfx.goal();
  UI.showModeResults({
    title: "TIME'S UP!",
    subtitle: `${G.char.name} — Banana Rush`,
    newBest,
    lines: [
      ['Bananas Hoarded', `🍌 ${G.bananasGot}`],
      ['Score', `⭐ ${G.score}`],
      ['Banked to Shop', `🍌 +${G.bananasGot}`],
      ['Best Haul', `🍌 ${sv.rushBest || 0}`]
    ]
  });
}

function setState(s) { G.state = s; G.stateT = 0; }

// ---------------- character-derived physics numbers ----------------
function charPhysics() {
  const sv = getSave();
  const st = G.char.stats;
  return {
    accel: (15 + st.speed * 1.7) * (1 + 0.08 * sv.upgrades.accel),
    traction: (0.9 + st.traction * 0.27) * (1 + 0.08 * sv.upgrades.traction),
    jumpVel: (6.4 + st.jump * 0.55) * (1 + 0.07 * sv.upgrades.jump),
    weightFactor: st.weight / 10
  };
}

// ---------------- abilities ----------------
function useAbility() {
  if (G.abilityCooldown > 0) return;
  const ab = G.char.ability;
  const b = G.ball;
  let used = true;
  switch (ab.id) {
    case 'stomp':
      if (b.onGroundLast) { b.vel.y = 13; }
      else { b.vel.y = -26; G.stompArmed = true; }
      sfx.ability();
      break;
    case 'dash': {
      const hs = Math.hypot(b.vel.x, b.vel.z);
      if (hs > 1) { const k = (hs + 15) / hs; b.vel.x *= k; b.vel.z *= k; }
      else { b.vel.x -= Math.sin(G.camYaw) * 15; b.vel.z -= Math.cos(G.camYaw) * 15; }
      sfx.dash();
      break;
    }
    case 'float':
      b.vel.y = Math.max(b.vel.y, 10);
      b.slowFall = 3;
      sfx.jump();
      break;
    case 'shield':
      b.vel.multiplyScalar(0.05);
      b.shielded = 2;
      sfx.ability();
      UI.flashMessage('SHIELD!', 700);
      break;
    case 'magnet':
      G.magnetTimer = 4;
      sfx.ability();
      UI.flashMessage('BANANA MAGNET!', 900);
      break;
    case 'pound':
      if (!b.onGroundLast) b.vel.y = -26;
      b.gripBoost = 3;
      sfx.dash();
      UI.flashMessage('KONG QUAKE!', 900);
      break;
    case 'glide':
      b.slowFall = 3.5;
      b.vel.y = Math.max(b.vel.y, 4);
      b.vel.x -= Math.sin(G.camYaw) * 5;
      b.vel.z -= Math.cos(G.camYaw) * 5;
      sfx.glide();
      UI.flashMessage('GLIDE!', 700);
      break;
    case 'chomp':
      G.timerFrozen = 4;
      sfx.ability();
      UI.flashMessage('TIME FROZEN!', 1000);
      break;
    default: used = false;
  }
  if (used) G.abilityCooldown = ab.cooldown;
}

// ---------------- level end ----------------
function onGoal() {
  setState('goal');
  sfx.goal();
  stopMusic();
  burstConfetti(G.ball.pos);
  UI.flashMessage('GOAL!!', 1800);
}

function finishGoal() {
  const level = LEVELS[G.levelIndex];
  const th = starThresholds(level);
  const bonus = Math.round(G.timeLeft * 10);
  const stageScore = G.score + 100 + bonus;
  let stars = 1;
  if (G.timeLeft >= th.two) stars = 2;
  if (G.timeLeft >= th.three) stars = 3;
  addBananas(G.bananasGot);
  recordResult(G.levelIndex, { score: stageScore, timeLeft: G.timeLeft, stars });
  unlockNextLevel(G.levelIndex, LEVELS.length);
  G.runScore += stageScore;
  setState('results');
  UI.hudVisible(false);
  UI.showResults({
    cleared: true, levelName: `${WORLDS[level.world].name} — ${level.name}`,
    score: stageScore, bananas: G.bananasGot, timeLeft: G.timeLeft, stars, bonus,
    isLastLevel: G.levelIndex === LEVELS.length - 1
  });
}

function onFallOut(reason) {
  setState('fallout');
  sfx.fall();
  UI.flashMessage(reason === 'time' ? 'TIME OVER!' : 'FALL OUT!', 1500);
}

function finishFallOut() {
  G.lives--;
  addBananas(Math.floor(G.bananasGot / 2));   // consolation: bank half
  const level = LEVELS[G.levelIndex];
  if (G.lives <= 0) {
    setState('results');
    UI.hudVisible(false);
    stopMusic();
    UI.showResults({
      cleared: false, gameOver: true,
      levelName: `${WORLDS[level.world].name} — ${level.name}`,
      score: G.score, bananas: G.bananasGot, timeLeft: 0, stars: 0, bonus: 0, isLastLevel: false
    });
    G.lives = 3;
  } else {
    loadStage(G.levelIndex);
  }
}

// ---------------- camera ----------------
const camTarget = new THREE.Vector3();
function updateCamera(dt, input) {
  const b = G.ball;
  // steer camera yaw toward travel direction when moving
  const hs = Math.hypot(b.vel.x, b.vel.z);
  if (getSave().settings.camAssist && hs > 2.5 && G.state === 'play') {
    const travelYaw = Math.atan2(-b.vel.x, -b.vel.z);
    let d = travelYaw - G.camYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    G.camYaw += d * Math.min(1, dt * 1.8);
  }
  const dist = 7.2, height = 3.6;
  const cx = b.pos.x + Math.sin(G.camYaw) * dist;
  const cz = b.pos.z + Math.cos(G.camYaw) * dist;
  const cy = b.pos.y + height;
  camera.position.lerp(camTarget.set(cx, cy, cz), Math.min(1, dt * 7));
  camera.lookAt(b.pos.x, b.pos.y + 0.8, b.pos.z);
  // keep sun & shadows near the action
  sun.position.set(b.pos.x + 18, b.pos.y + 30, b.pos.z + 14);
  sun.target.position.copy(b.pos);
}

// ---------------- per-frame gameplay ----------------
const events = [];
function updatePlay(dt, t) {
  const input = pollInput();
  const phys = charPhysics();
  if (G.turboTimer > 0) { G.turboTimer -= dt; phys.accel *= 1.65; }
  events.length = 0;

  // passive glide for the floaty rascals
  if ((G.char.id === 'puffboy' || G.char.id === 'peacho') && input.jumpHeld && G.ball.vel.y < 0) {
    G.ball.slowFall = Math.max(G.ball.slowFall, 0.05);
  }
  if (input.ability) useAbility();

  stepBall(G.ball, Math.min(dt, 1 / 30), {
    solids: G.stage.solids,
    bumpers: G.stage.bumpers,
    input, camYaw: G.camYaw,
    events, ...phys
  });

  // stomp landing mega-bounce
  if (G.stompArmed && G.ball.onGround) {
    G.ball.vel.y = 16;
    G.stompArmed = false;
    sfx.bounce();
    UI.flashMessage('BOING!', 600);
  }

  // events -> sfx
  for (const e of events) {
    if (e.type === 'bumper') { sfx.bumper(); for (const bm of G.stage.bumpers) bm.flash = 1; }
    if (e.type === 'jump') sfx.jump();
    if (e.type === 'wallhit') sfx.bounce();
  }

  // launch pads
  for (const p of G.stage.pads) {
    if (p.cooldown > 0) continue;
    const dx = G.ball.pos.x - p.pos.x, dz = G.ball.pos.z - p.pos.z;
    if (Math.abs(dx) < p.half.x && Math.abs(dz) < p.half.y && Math.abs(G.ball.pos.y - p.pos.y) < 1.4) {
      G.ball.vel.set(p.dir.x, p.dir.y, p.dir.z);
      p.cooldown = 1.2;
      sfx.launch();
      UI.flashMessage('LAUNCH!', 800);
    }
  }

  // banana magnet pull
  if (G.magnetTimer > 0) {
    G.magnetTimer -= dt;
    for (const bn of G.stage.bananas) {
      if (bn.taken) continue;
      const d = bn.pos.distanceTo(G.ball.pos);
      if (d < 7 && d > 0.1) {
        bn.pos.lerp(G.ball.pos, Math.min(1, dt * 5));
        bn.mesh.position.copy(bn.pos);
      }
    }
  }

  // banana pickups
  for (const bn of G.stage.bananas) {
    if (bn.taken) continue;
    if (bn.pos.distanceTo(G.ball.pos) < bn.r) {
      bn.taken = true;
      bn.mesh.visible = false;
      G.bananasGot += bn.value;
      G.score += bn.value * 10;
      if (G.rushDir) G.score += G.rushDir.onBananaCollected(bn);
      if (bn.value > 1) { sfx.bunch(); UI.flashMessage('BUNCH! +10 🍌', 700); }
      else sfx.banana();
    }
  }

  // rush director: spawns, power-ups, combo decay
  if (G.rushDir) {
    G.rushDir.update(dt, G.ball.pos);
    UI.setExtra(G.rushDir.combo >= 2 ? `🔥 COMBO ×${G.rushDir.combo}` : (G.turboTimer > 0 ? '🚀 TURBO' : ''));
  }

  // goal / fall / timer
  if (!G.rushDir && G.stage.checkGoal(G.ball.pos)) { onGoal(); return; }
  if (G.ball.pos.y < G.stage.fallY) {
    if (G.rushDir) {
      // rush: no lives — respawn at center with a time penalty
      G.ball.reset(RUSH_LEVEL.start.p);
      G.timeLeft = Math.max(0, G.timeLeft - 3);
      sfx.fall();
      UI.flashMessage('OOPS! -3s', 900);
    } else { onFallOut('fall'); return; }
  }
  if (G.timerFrozen > 0) G.timerFrozen -= dt;
  else {
    const before = G.timeLeft;
    G.timeLeft -= dt;
    if (G.timeLeft <= 10 && Math.ceil(before) !== Math.ceil(G.timeLeft)) sfx.tick();
    if (G.timeLeft <= 0) {
      G.timeLeft = 0;
      if (G.rushDir) { endRush(); } else { onFallOut('time'); }
      return;
    }
  }

  // visual stage tilt (cosmetic, monkey-ball flavor)
  const targetRx = -input.y * 0.045;
  const targetRz = input.x * 0.045;
  G.stage.root.rotation.x += (targetRx - G.stage.root.rotation.x) * Math.min(1, dt * 6);
  G.stage.root.rotation.z += (targetRz - G.stage.root.rotation.z) * Math.min(1, dt * 6);

  updateCamera(dt, input);
  syncBallVisual(t, dt, input);

  G.abilityCooldown = Math.max(0, G.abilityCooldown - dt);
  UI.updateHUD({
    time: G.timeLeft, bananas: G.bananasGot, lives: G.lives, score: G.score,
    speed: Math.hypot(G.ball.vel.x, G.ball.vel.z),
    abilityReady: G.abilityCooldown <= 0, abilityName: G.char.ability.name,
    timerFrozen: G.timerFrozen > 0
  });
}

const spinQ = new THREE.Quaternion();
const spinAxis = new THREE.Vector3();
function syncBallVisual(t, dt, input) {
  const bg = G.ballGroup;
  if (!bg) return;
  bg.group.position.copy(G.ball.pos);
  // roll the shell
  const spinLen = G.ball.spin.length();
  if (spinLen > 0.01) {
    spinAxis.copy(G.ball.spin).normalize();
    spinQ.setFromAxisAngle(spinAxis, spinLen * dt);
    bg.shell.quaternion.premultiply(spinQ);
  }
  // character faces travel direction & animates
  const hs = Math.hypot(G.ball.vel.x, G.ball.vel.z);
  if (hs > 1.2) {
    const yaw = Math.atan2(G.ball.vel.x, G.ball.vel.z);
    let d = yaw - bg.built.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    bg.built.group.rotation.y += d * Math.min(1, dt * 8);
  }
  let mode = 'idle';
  if (G.state === 'goal') mode = 'win';
  else if (G.state === 'fallout') mode = 'dizzy';
  else if (!G.ball.onGroundLast) mode = 'air';
  else if (hs > 1.5) mode = 'roll';
  animateCharacter(bg.built, t, mode, hs);
}

// ---------------- main loop ----------------
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(G.clock.getDelta(), 0.05);
  G.simT += dt;
  const t = G.simT;
  G.stateT += dt;

  if (G.stage) G.stage.update(t, dt);
  updateConfetti(dt);

  switch (G.state) {
    case 'menu':
      // slow orbiting menu backdrop
      G.menuOrbit += dt * 0.15;
      if (G.stage) {
        const c = G.stage.goalPos;
        camera.position.set(c.x + Math.cos(G.menuOrbit) * 26, 14, c.z + Math.sin(G.menuOrbit) * 26);
        camera.lookAt(c.x, 0, c.z + 10);
      }
      break;
    case 'countdown': {
      G.countdownT -= dt;
      updateCamera(dt, { x: 0, y: 0 });
      syncBallVisual(t, dt, null);
      UI.updateHUD({
        time: G.timeLeft, bananas: G.bananasGot, lives: G.lives, score: G.score, speed: 0,
        abilityReady: true, abilityName: G.char.ability.name, timerFrozen: false
      });
      if (G.countdownT <= 0.7 && G.countdownT + dt > 0.7) { UI.flashMessage('GO!!', 700); sfx.go(); }
      if (G.countdownT <= 0) { setState('play'); clearInput(); }
      break;
    }
    case 'play':
      updatePlay(dt, t);
      break;
    case 'target':
      if (G.targetGame) G.targetGame.update(dt, t, pollInput());
      break;
    case 'goal':
      syncBallVisual(t, dt, null);
      updateCamera(dt, { x: 0, y: 0 });
      G.ball.vel.multiplyScalar(Math.exp(-3 * dt));
      G.ball.pos.addScaledVector(G.ball.vel, dt);
      if (G.stateT > 2.1) finishGoal();
      break;
    case 'fallout':
      G.ball.vel.y -= 24 * dt;
      G.ball.pos.addScaledVector(G.ball.vel, dt);
      syncBallVisual(t, dt, null);
      camera.lookAt(G.ball.pos.x, G.ball.pos.y, G.ball.pos.z);
      if (G.stateT > 1.3) finishFallOut();
      break;
  }

  renderer.render(scene, camera);
}

// ---------------- menu wiring ----------------
function showMenuBackdrop() {
  if (G.stage) G.stage.dispose();
  G.stage = new Stage(scene, LEVELS[0], WORLDS[0]);
  if (G.ballGroup) { scene.remove(G.ballGroup.group); G.ballGroup = null; }
  setState('menu');
}

UI.on('modeChosen', (mode) => { G.mode = mode; UI.showCharSelect(mode); });
UI.on('charChosen', (mode) => {
  if (mode === 'adventure') UI.showLevelSelect();
  else if (mode === 'target') startTargetMode();
  else if (mode === 'rush') startRushMode();
});
UI.on('shop', () => UI.showShop());
UI.on('startLevel', (i) => { G.mode = 'adventure'; loadStage(i, { resetLives: true }); });
UI.on('resume', () => { setState(G.pausedFrom); G.clock.getDelta(); });
UI.on('retry', () => {
  if (G.mode === 'target') startTargetMode();
  else if (G.mode === 'rush') startRushMode();
  else loadStage(G.levelIndex, { resetLives: G.state === 'results' && G.lives === 3 });
});
UI.on('quit', () => {
  disposeModes();
  G.mode = 'adventure';
  UI.hudVisible(false);
  stopMusic();
  playMusic('menu');
  showMenuBackdrop();
  UI.showTitle();
});
UI.on('next', () => {
  const next = Math.min(G.levelIndex + 1, LEVELS.length - 1);
  loadStage(next);
});

onPause(() => {
  if (G.state === 'play' || G.state === 'target') {
    G.pausedFrom = G.state;
    setState('paused');
    UI.showPause();
  } else if (G.state === 'paused') {
    UI.clear();
    setState(G.pausedFrom);
    G.clock.getDelta();
  }
});

window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
window.addEventListener('touchstart', unlockAudio, { once: true });

// debug/testing handle (harmless in production)
window.__G = G;
window.__CAM = camera;
window.__SCENE = scene;

// boot
initTouch();
showMenuBackdrop();
UI.showTitle();
playMusic('menu');
tick();
