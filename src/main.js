// Rollin' Rascals — main game loop & state machine.
import * as THREE from 'three';
import { Ball, stepBall, BALL_RADIUS } from './physics.js';
import { Stage } from './stage.js';
import { LEVELS, WORLDS, starThresholds } from './levels.js';
import { getCharacter, buildCharacterMesh, animateCharacter, fitCharacterInBall } from './characters.js';
import { pollInput, pollInputDuel, initTouch, clearInput, onPause, onRestart, requestTiltPermission } from './input.js';
import { collideBalls, Ghost, DuelNet } from './duel.js';
import { UI } from './ui.js';
import { getSave, save, addBananas, recordResult, unlockNextLevel } from './save.js';
import { sfx, playMusic, stopMusic, unlockAudio, suspendAudio, resumeAudio } from './audio.js';
import { TargetMode } from './flight.js';
import { RUSH_LEVEL, RushDirector, RUSH_TIME } from './rush.js';
import { MenuScene } from './menuscene.js';
import { Atmosphere } from './atmosphere.js';
import { checkForUpdate, BUILD } from './updater.js';

// ---------------- renderer & scene ----------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#120b2e');
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1400);

// dynamic time-of-day lighting rig (sun/moon, sky dome, stars, fog, exposure, env reflections)
const atmosphere = new Atmosphere(scene, renderer);

let lastW = 0, lastH = 0;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return;
  lastW = w; lastH = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  window.scrollTo(0, 0);   // shake off residual WebView scroll (keyboard/rotation)
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 60));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

// ---------------- game state ----------------
const G = {
  state: 'boot',            // menu | countdown | play | target | paused | goal | fallout | results
  mode: 'adventure',        // adventure | target | rush | duel (+ netDuel overlay on rush)
  targetGame: null,
  rushDir: null,
  turboTimer: 0,
  pausedFrom: 'play',
  afterCountdown: 'play',
  duel: null,               // local duel: { balls, groups, chars, counts:[a,b] }
  netDuel: null,            // online duel: { dn, ghost, peerChar, peerBananas, myFinal, peerFinal, sendT, waitT }
  duelChars: [null, null],
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
  fitCharacterInBall(built, BALL_RADIUS);
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
  if (G.menuScene) { G.menuScene.dispose(); G.menuScene = null; }
  if (G.targetGame) { G.targetGame.dispose(); G.targetGame = null; }
  if (G.duel) {
    for (const g of G.duel.groups) if (g) scene.remove(g.group);
    G.duel = null;
  }
  if (G.netDuel) {
    if (G.netDuel.ghost) scene.remove(G.netDuel.ghost.group.group);
    if (G.netDuel.dn) G.netDuel.dn.close();
    G.netDuel = null;
  }
  G.rushDir = null;
  G.turboTimer = 0;
  UI.setExtra('');
}

function loadStage(index, { resetLives = false, keepNet = false } = {}) {
  const netKeep = keepNet ? G.netDuel : null;
  if (keepNet) G.netDuel = null;
  disposeModes();
  if (netKeep) G.netDuel = netKeep;
  G.afterCountdown = 'play';
  if (G.stage) G.stage.dispose();
  G.levelIndex = index;
  const level = index === -1 ? RUSH_LEVEL : LEVELS[index];
  const world = WORLDS[level.world];
  G.stage = new Stage(scene, level, world, atmosphere);
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
  UI.setExtra(document.body.classList.contains('touch')
    ? 'JOYSTICK roll · JUMP · SKILL'
    : 'WASD roll · SPACE jump · SHIFT/F skill · Q/E camera · R restart');
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
    scene, camera, atmosphere, char: G.char, ui: UI,
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
    accel: (17 + st.speed * 1.9) * (1 + 0.08 * sv.upgrades.accel),
    traction: (0.9 + st.traction * 0.27) * (1 + 0.08 * sv.upgrades.traction),
    jumpVel: (7.7 + st.jump * 0.66) * (1 + 0.07 * sv.upgrades.jump),
    weightFactor: st.weight / 10
  };
}

// ---------------- abilities ----------------
// Works on any ball/char pair so duels can have per-player skills.
// ctx: { camYaw, setMagnet(sec), freezeTimer(sec), flash(msg) }
function performAbility(ball, char, ctx) {
  const ab = char.ability;
  const b = ball;
  let used = true;
  switch (ab.id) {
    case 'stomp':
      if (b.onGroundLast) { b.vel.y = 13; }
      else { b.vel.y = -26; b.stompArmed = true; }
      sfx.ability();
      break;
    case 'dash': {
      const hs = Math.hypot(b.vel.x, b.vel.z);
      if (hs > 1) { const k = (hs + 15) / hs; b.vel.x *= k; b.vel.z *= k; }
      else { b.vel.x -= Math.sin(ctx.camYaw) * 15; b.vel.z -= Math.cos(ctx.camYaw) * 15; }
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
      ctx.flash('SHIELD!', 700);
      break;
    case 'magnet':
      ctx.setMagnet(4);
      sfx.ability();
      ctx.flash('BANANA MAGNET!', 900);
      break;
    case 'pound':
      if (!b.onGroundLast) b.vel.y = -26;
      b.gripBoost = 3;
      sfx.dash();
      ctx.flash('KONG QUAKE!', 900);
      break;
    case 'glide':
      b.slowFall = 3.5;
      b.vel.y = Math.max(b.vel.y, 4);
      b.vel.x -= Math.sin(ctx.camYaw) * 5;
      b.vel.z -= Math.cos(ctx.camYaw) * 5;
      sfx.glide();
      ctx.flash('GLIDE!', 700);
      break;
    case 'chomp':
      ctx.freezeTimer(4);
      sfx.ability();
      ctx.flash('TIME FROZEN!', 1000);
      break;
    case 'overshield':   // Jawn-117: spartan energy shield
      b.shielded = 3;
      b.gripBoost = 3;
      sfx.ability();
      ctx.flash('OVERSHIELD!', 900);
      break;
    case 'box':          // Liquid Snack: the box is love, the box is life
      b.vel.multiplyScalar(0.05);
      b.shielded = 2;
      ctx.setMagnet(2.5);
      sfx.ability();
      ctx.flash('! ...just a box.', 1100);
      break;
    default: used = false;
  }
  return used;
}

function useAbility() {
  if (G.abilityCooldown > 0) return;
  const used = performAbility(G.ball, G.char, {
    camYaw: viewYaw(),
    setMagnet: (s) => { G.magnetTimer = s; },
    freezeTimer: (s) => { G.timerFrozen = s; },
    flash: (m, ms) => UI.flashMessage(m, ms)
  });
  if (used) G.abilityCooldown = G.char.ability.cooldown;
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

// ---------------- LOCAL DUEL (two players, one device) ----------------
function startDuelLocal() {
  G.mode = 'duel';
  disposeModes();
  if (G.stage) G.stage.dispose();
  G.stage = new Stage(scene, RUSH_LEVEL, WORLDS[0], atmosphere);
  if (G.ballGroup) { scene.remove(G.ballGroup.group); G.ballGroup = null; }

  const chars = [getCharacter(G.duelChars[0]), getCharacter(G.duelChars[1])];
  const balls = [new Ball(), new Ball()];
  const groups = [makeBallGroup(chars[0]), makeBallGroup(chars[1])];
  balls[0].reset([-2.5, 1, 6]);
  balls[1].reset([2.5, 1, 6]);
  for (const g of groups) scene.add(g.group);
  G.duel = { balls, groups, chars, counts: [0, 0], cds: [0, 0] };

  G.timeLeft = RUSH_TIME;
  G.timerFrozen = 0;
  G.bananasGot = 0;
  G.score = 0;
  G.camYaw = 0;
  G.rushDir = new RushDirector({
    stage: G.stage, ui: UI,
    addTime: (s) => { G.timeLeft += s; },
    setTurbo: (s, i) => { G.duel.balls[i].turboT = s; },
    setMagnet: (s, i) => { G.duel.balls[i].magnetT = s; }
  });
  clearInput();
  playMusic('jungle');
  UI.clear();
  UI.hudVisible(true);
  UI.flashMessage('READY...', 0);
  sfx.ready();
  G.afterCountdown = 'duel';
  setState('countdown');
  G.countdownT = 2.2;
}

function duelPhysFor(char, ball) {
  const st = char.stats;
  const phys = {
    accel: (17 + st.speed * 1.9) * (ball.turboT > 0 ? 1.65 : 1),
    traction: 0.9 + st.traction * 0.27,
    jumpVel: 7.7 + st.jump * 0.66,
    weightFactor: st.weight / 10
  };
  return phys;
}

function duelCameraAndSync(dt, t, inputs) {
  const [b0, b1] = G.duel.balls;
  const mx = (b0.pos.x + b1.pos.x) / 2, mz = (b0.pos.z + b1.pos.z) / 2;
  const sep = b0.pos.distanceTo(b1.pos);
  const dist = Math.max(9.5, sep * 0.72 + 7);
  camera.position.lerp(camTarget.set(mx, dist * 0.72, mz + dist), Math.min(1, dt * 5));
  camera.lookAt(mx, 0.5, mz);
  for (let i = 0; i < 2; i++) {
    const ball = G.duel.balls[i], bg = G.duel.groups[i];
    bg.group.position.copy(ball.pos);
    const spinLen = ball.spin.length();
    if (spinLen > 0.01) {
      spinAxis.copy(ball.spin).normalize();
      spinQ.setFromAxisAngle(spinAxis, spinLen * dt);
      bg.shell.quaternion.premultiply(spinQ);
    }
    const hs = Math.hypot(ball.vel.x, ball.vel.z);
    if (hs > 1.2) {
      const yaw = Math.atan2(ball.vel.x, ball.vel.z);
      let d = yaw - bg.built.group.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      bg.built.group.rotation.y += d * Math.min(1, dt * 8);
    }
    const mode = G.state === 'results' ? 'win' : (!ball.onGroundLast ? 'air' : hs > 1.5 ? 'roll' : 'idle');
    animateCharacter(bg.built, t + i * 1.7, mode, hs);
  }
}

function updateDuel(dt, t) {
  const inputs = pollInputDuel();
  const d = G.duel;
  events.length = 0;

  for (let i = 0; i < 2; i++) {
    const ball = d.balls[i], char = d.chars[i], input = inputs[i];
    ball.turboT = Math.max(0, (ball.turboT || 0) - dt);
    ball.magnetT = Math.max(0, (ball.magnetT || 0) - dt);
    d.cds[i] = Math.max(0, d.cds[i] - dt);
    if (input.ability && d.cds[i] <= 0) {
      const used = performAbility(ball, char, {
        camYaw: 0,
        setMagnet: (s) => { ball.magnetT = s; },
        freezeTimer: (s) => { G.timerFrozen = s; },
        flash: (m, ms) => UI.flashMessage(`P${i + 1} ${m}`, ms)
      });
      if (used) d.cds[i] = char.ability.cooldown;
    }
    stepBall(ball, Math.min(dt, 1 / 30), {
      solids: G.stage.solids, bumpers: G.stage.bumpers,
      input, camYaw: 0, events, ...duelPhysFor(char, ball)
    });
    if (ball.stompArmed && ball.onGround) {
      ball.vel.y = 16;
      ball.stompArmed = false;
      sfx.bounce();
    }
    // magnet pull toward this player
    if (ball.magnetT > 0) {
      for (const bn of G.stage.bananas) {
        if (bn.taken) continue;
        const dist = bn.pos.distanceTo(ball.pos);
        if (dist < 7 && dist > 0.1) { bn.pos.lerp(ball.pos, Math.min(1, dt * 5)); bn.mesh.position.copy(bn.pos); }
      }
    }
    // pickups
    for (const bn of G.stage.bananas) {
      if (bn.taken) continue;
      if (bn.pos.distanceTo(ball.pos) < bn.r) {
        bn.taken = true;
        bn.mesh.visible = false;
        d.counts[i] += bn.value;
        G.rushDir.onBananaCollected(bn, i);
        if (bn.value > 1) { sfx.bunch(); UI.flashMessage(`P${i + 1} BUNCH! +10`, 700); }
        else sfx.banana();
      }
    }
    // fell off: respawn & drop some loot back into the arena
    if (ball.pos.y < G.stage.fallY) {
      const dropped = Math.min(3, d.counts[i]);
      d.counts[i] -= dropped;
      for (let k = 0; k < dropped; k++) G.rushDir.spawnBanana();
      ball.reset([i === 0 ? -2.5 : 2.5, 1, 6]);
      sfx.fall();
      UI.flashMessage(`P${i + 1} FELL! -${dropped} 🍌`, 900);
    }
  }

  // ball-vs-ball bumping
  if (collideBalls(d.balls[0], d.balls[1], d.chars[0].stats.weight / 10, d.chars[1].stats.weight / 10)) {
    sfx.bumper();
  }
  for (const e of events) if (e.type === 'bumper') sfx.bumper();

  G.rushDir.update(dt, [d.balls[0].pos, d.balls[1].pos]);

  // timer
  if (G.timerFrozen > 0) G.timerFrozen -= dt;
  else {
    G.timeLeft -= dt;
    if (G.timeLeft <= 0) { G.timeLeft = 0; endDuelLocal(); return; }
  }

  G.stage.root.rotation.x = 0; G.stage.root.rotation.z = 0;
  duelCameraAndSync(dt, t, inputs);

  UI.updateHUD({
    time: G.timeLeft, bananas: d.counts[0], lives: 2, score: d.counts[1],
    speed: Math.hypot(d.balls[0].vel.x, d.balls[0].vel.z),
    abilityReady: d.cds[0] <= 0 || d.cds[1] <= 0,
    abilityName: `P1 ${d.cds[0] <= 0 ? '✓' : '…'} · P2 ${d.cds[1] <= 0 ? '✓' : '…'}`,
    timerFrozen: G.timerFrozen > 0
  });
  UI.setExtra(`🔴 ${d.chars[0].name} ${d.counts[0]} — ${d.counts[1]} ${d.chars[1].name} 🔵`);
}

function endDuelLocal() {
  const d = G.duel;
  stopMusic();
  sfx.goal();
  addBananas(Math.max(d.counts[0], d.counts[1]));   // winner's haul goes to the shared bank
  const winner = d.counts[0] === d.counts[1] ? null : (d.counts[0] > d.counts[1] ? 0 : 1);
  setState('results');
  UI.hudVisible(false);
  UI.showModeResults({
    title: winner === null ? 'DRAW!' : `P${winner + 1} WINS!`,
    subtitle: winner === null ? 'Perfectly balanced.' : `${d.chars[winner].name} takes the crown 👑`,
    newBest: false,
    lines: [
      [`P1 — ${d.chars[0].name}`, `🍌 ${d.counts[0]}`],
      [`P2 — ${d.chars[1].name}`, `🍌 ${d.counts[1]}`],
      ['Banked to Shop', `🍌 +${Math.max(d.counts[0], d.counts[1])}`]
    ]
  });
}

// ---------------- ONLINE DUEL ----------------
function relayUrl() {
  const custom = (getSave().settings.relayUrl || '').trim();
  return custom || undefined;   // undefined -> same-origin /ws
}

function beginOnlineDuel(asHost, code) {
  G.mode = 'netduel';
  const myCharId = getSave().selectedChar;
  const dn = new DuelNet({
    myCharId,
    onCode: (roomCode) => UI.showHostWait(roomCode),
    onStart: (peerCharId) => startDuelOnlinePlay(peerCharId),
    onState: (m) => {
      if (!G.netDuel) return;
      G.netDuel.ghost && G.netDuel.ghost.push(m.p);
      G.netDuel.peerBananas = m.b;
    },
    onEnd: (m) => {
      if (!G.netDuel) return;
      G.netDuel.peerFinal = m.b;
      if (G.state === 'netwait') showNetDuelResults();
    },
    onPeerLeft: () => {
      if (!G.netDuel) return;
      if (G.state === 'play' || G.state === 'countdown' || G.state === 'netwait') {
        G.netDuel.peerFinal = G.netDuel.peerBananas || 0;
        G.netDuel.forfeit = true;
        UI.flashMessage('RIVAL LEFT!', 1200);
        endRushOnline();
      } else {
        UI.showNetError('Your rival disconnected.');
      }
    },
    onError: (reason) => { disposeModes(); UI.showNetError(reason); }
  });
  G.netDuel = { dn, ghost: null, peerChar: null, peerBananas: 0, peerFinal: null, sendT: 0, waitT: 0, forfeit: false };
  const url = relayUrl();
  const p = asHost ? dn.host(url) : dn.join(url, code);
  p.catch((e) => { disposeModes(); UI.showNetError(e.message || 'Could not connect'); });
  UI.showConnecting(asHost ? 'Creating room…' : `Joining ${code}…`);
}

function startDuelOnlinePlay(peerCharId) {
  const nd = G.netDuel;
  nd.peerChar = getCharacter(peerCharId || 'marco');
  G.mode = 'netduel';
  loadStage(-1, { resetLives: true, keepNet: true });
  // ghost rival (no collision — parallel arenas, same clock)
  nd.ghost = new Ghost(makeBallGroup(nd.peerChar));
  nd.ghost.group.group.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = Math.min(o.material.opacity ?? 1, 0.5); } });
  scene.add(nd.ghost.group.group);
}

function endRushOnline() {
  const nd = G.netDuel;
  addBananas(G.bananasGot);
  nd.dn.sendEnd(G.bananasGot);
  nd.myFinal = G.bananasGot;
  if (nd.peerFinal !== null || nd.forfeit) showNetDuelResults();
  else {
    setState('netwait');
    nd.waitT = 6;
    UI.flashMessage('WAITING FOR RIVAL…', 0);
  }
}

function showNetDuelResults() {
  const nd = G.netDuel;
  if (!nd) return;
  stopMusic();
  sfx.goal();
  const mine = nd.myFinal ?? G.bananasGot;
  const theirs = nd.peerFinal ?? nd.peerBananas ?? 0;
  const win = nd.forfeit || mine > theirs;
  const draw = !nd.forfeit && mine === theirs;
  setState('results');
  UI.hudVisible(false);
  UI.showModeResults({
    title: draw ? 'DRAW!' : win ? 'YOU WIN! 🏆' : 'YOU LOSE…',
    subtitle: nd.forfeit ? 'Rival fled the arena!' : `${G.char.name} vs ${nd.peerChar ? nd.peerChar.name : '???'}`,
    newBest: false,
    lines: [
      ['You', `🍌 ${mine}`],
      ['Rival', `🍌 ${theirs}`],
      ['Banked to Shop', `🍌 +${mine}`]
    ]
  });
  nd.dn.close();
}

// ---------------- camera ----------------
const camTarget = new THREE.Vector3();
function updateCamera(dt, input) {
  const b = G.ball;
  // manual camera rotate (Q/E, right stick, shoulder buttons) overrides assist
  const camX = (input && input.camX) || 0;
  if (Math.abs(camX) > 0.04) G.camYaw -= camX * dt * 2.6;
  // steer camera yaw toward travel direction when moving
  const hs = Math.hypot(b.vel.x, b.vel.z);
  if (Math.abs(camX) <= 0.04 && getSave().settings.camAssist && hs > 2.5 && G.state === 'play') {
    const travelYaw = Math.atan2(-b.vel.x, -b.vel.z);
    let d = travelYaw - G.camYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    G.camYaw += d * Math.min(1, dt * 1.8);
  }
  // camera pulls back with speed so big stages read at pace — but sits close
  // by default so the rascal in the ball actually fills some screen
  const hs2 = Math.hypot(b.vel.x, b.vel.z);
  const dist = 6.1 + Math.min(hs2 * 0.09, 2.1), height = 3.2 + Math.min(hs2 * 0.045, 1.1);
  const cx = b.pos.x + Math.sin(G.camYaw) * dist;
  const cz = b.pos.z + Math.cos(G.camYaw) * dist;
  const cy = b.pos.y + height;
  camera.position.lerp(camTarget.set(cx, cy, cz), Math.min(1, dt * 7));
  camera.lookAt(b.pos.x, b.pos.y + 0.8, b.pos.z);
}

// ---------------- per-frame gameplay ----------------
// The control frame is the RENDERED camera, not the orbit target it lerps
// toward — stick-up always pushes away from the actual point of view, so
// steering stays screen-relative even mid camera swing.
function viewYaw() {
  const b = G.ball.pos;
  return Math.atan2(camera.position.x - b.x, camera.position.z - b.z);
}
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
    input, camYaw: viewYaw(),
    events, ...phys
  });

  // stomp landing mega-bounce
  if (G.ball.stompArmed && G.ball.onGround) {
    G.ball.vel.y = 16;
    G.ball.stompArmed = false;
    sfx.bounce();
    UI.flashMessage('BOING!', 600);
  }

  // events -> sfx + impact squash
  for (const e of events) {
    if (e.type === 'bumper') { sfx.bumper(); for (const bm of G.stage.bumpers) bm.flash = 1; G.squash = 0.3; }
    if (e.type === 'jump') sfx.jump();
    if (e.type === 'wallhit') { sfx.bounce(); G.squash = Math.min(0.34, 0.1 + e.speed * 0.018); }
    if (e.type === 'land') { if (e.speed > 9) sfx.bounce(); G.squash = Math.min(0.3, 0.06 + e.speed * 0.014); }
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
    G.rushDir.update(dt, [G.ball.pos]);
    if (G.netDuel) {
      const nd = G.netDuel;
      nd.sendT -= dt;
      if (nd.sendT <= 0) { nd.sendT = 1 / 12; nd.dn.sendState(G.ball.pos, G.bananasGot); }
      if (nd.ghost) nd.ghost.update(dt);
      UI.setExtra(`YOU 🍌${G.bananasGot} — 🍌${nd.peerBananas} ${nd.peerChar ? nd.peerChar.name.toUpperCase() : 'RIVAL'}`);
    } else {
      UI.setExtra(G.rushDir.combo >= 2 ? `🔥 COMBO ×${G.rushDir.combo}` : (G.turboTimer > 0 ? '🚀 TURBO' : ''));
    }
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
      if (G.netDuel) { endRushOnline(); } else if (G.rushDir) { endRush(); } else { onFallOut('time'); }
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
  // squash & stretch: impacts compress the ball, then it springs back
  G.squash = (G.squash || 0) * Math.exp(-9 * dt);
  bg.group.scale.set(1 + G.squash * 0.55, 1 - G.squash, 1 + G.squash * 0.55);
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
  if (window.innerWidth !== lastW || window.innerHeight !== lastH) resize();
  const dt = Math.min(G.clock.getDelta(), 0.05);
  G.simT += dt;
  const t = G.simT;
  G.stateT += dt;

  if (G.stage) G.stage.update(t, dt);
  updateConfetti(dt);

  // atmosphere follows the action (shadows, sky dome, celestial bodies)
  let focus = null;
  if (G.duel) {
    const [b0, b1] = G.duel.balls;
    focus = camTarget.set((b0.pos.x + b1.pos.x) / 2, 0, (b0.pos.z + b1.pos.z) / 2);
  } else if (G.targetGame) focus = G.targetGame.ball.pos;
  else if (G.state !== 'menu') focus = G.ball.pos;
  else focus = camTarget.set(0, 0, 0);
  atmosphere.update(dt, focus);

  switch (G.state) {
    case 'menu':
      if (G.menuScene) G.menuScene.update(dt, t, camera, G.menuOrbit);
      break;
    case 'countdown': {
      G.countdownT -= dt;
      if (G.duel) {
        duelCameraAndSync(dt, t, null);
      } else {
        updateCamera(dt, { x: 0, y: 0 });
        syncBallVisual(t, dt, null);
        UI.updateHUD({
          time: G.timeLeft, bananas: G.bananasGot, lives: G.lives, score: G.score, speed: 0,
          abilityReady: true, abilityName: G.char.ability.name, timerFrozen: false
        });
      }
      if (G.countdownT <= 0.7 && G.countdownT + dt > 0.7) { UI.flashMessage('GO!!', 700); sfx.go(); }
      if (G.countdownT <= 0) { setState(G.afterCountdown); clearInput(); }
      break;
    }
    case 'play':
      updatePlay(dt, t);
      break;
    case 'target':
      if (G.targetGame) G.targetGame.update(dt, t, pollInput());
      break;
    case 'duel':
      if (G.duel) updateDuel(dt, t);
      break;
    case 'netwait':
      if (G.netDuel) {
        if (G.netDuel.ghost) G.netDuel.ghost.update(dt);
        G.netDuel.waitT -= dt;
        if (G.netDuel.waitT <= 0) showNetDuelResults();   // rival timed out — score as last known
      }
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
  disposeModes();
  if (G.stage) { G.stage.dispose(); G.stage = null; }
  if (G.ballGroup) { scene.remove(G.ballGroup.group); G.ballGroup = null; }
  G.menuScene = new MenuScene(scene);
  atmosphere.enableCycle(90, 0.36);   // menus showcase a full day/night cycle
  atmosphere.setFogRange(55, 190);
  setState('menu');
}

UI.on('start', () => { playMusic('menu'); UI.showModeSelect(); });
UI.on('modeChosen', (mode) => {
  G.mode = mode;
  UI.showPlayers(mode);
});
UI.on('players1', (mode) => UI.showCharSelect(mode));
UI.on('previewChar', (id) => { if (G.menuScene) G.menuScene.focusCharacter(id); });
UI.on('duelLocal', () => UI.showCharSelect('duel-p1'));
UI.on('duelHost', () => UI.showCharSelect('duel-host'));
UI.on('duelJoin', (code) => { G.pendingJoinCode = code; UI.showCharSelect('duel-join'); });
UI.on('charChosen', (mode) => {
  const sv = getSave();
  if (mode === 'adventure') UI.showLevelSelect();
  else if (mode === 'target') startTargetMode();
  else if (mode === 'rush') startRushMode();
  else if (mode === 'duel-p1') { G.duelChars[0] = sv.selectedChar; UI.showCharSelect('duel-p2'); }
  else if (mode === 'duel-p2') {
    G.duelChars[1] = sv.selectedChar;
    sv.selectedChar = G.duelChars[0];   // P2's pick shouldn't hijack P1's saved rascal
    startDuelLocal();
  }
  else if (mode === 'duel-host') beginOnlineDuel(true);
  else if (mode === 'duel-join') beginOnlineDuel(false, G.pendingJoinCode);
});
UI.on('shop', () => UI.showShop());
UI.on('startLevel', (i) => { G.mode = 'adventure'; loadStage(i, { resetLives: true }); });
UI.on('resume', () => { setState(G.pausedFrom); G.clock.getDelta(); });
UI.on('retry', () => {
  if (G.mode === 'target') startTargetMode();
  else if (G.mode === 'rush') startRushMode();
  else if (G.mode === 'duel') startDuelLocal();
  else if (G.mode === 'netduel') { disposeModes(); UI.hudVisible(false); UI.showDuelMenu(); }
  else loadStage(G.levelIndex, { resetLives: G.state === 'results' && G.lives === 3 });
});
UI.on('quit', () => {
  disposeModes();
  G.mode = 'adventure';
  UI.hudVisible(false);
  stopMusic();
  playMusic('menu');
  showMenuBackdrop();
  UI.showModeSelect();   // back to the hub, not all the way out to the intro
});
UI.on('next', () => {
  const next = Math.min(G.levelIndex + 1, LEVELS.length - 1);
  loadStage(next);
});

onRestart(() => {
  if (G.netDuel) return;   // never abandon a live online duel by accident
  if (G.state === 'play' || G.state === 'countdown') {
    if (G.mode === 'rush') startRushMode();
    else loadStage(G.levelIndex);
  } else if (G.state === 'duel') {
    startDuelLocal();
  } else if (G.state === 'target' && G.targetGame) {
    startTargetMode();
  }
});

UI.on('tiltToggled', async () => {
  const ok = await requestTiltPermission();   // iOS needs an explicit grant
  if (!ok) UI.flashMessage('TILT PERMISSION DENIED', 1500);
});

function togglePause(forcePause = false) {
  if (G.netDuel) return;   // no pausing an online duel — the rival's clock keeps running
  if (G.state === 'play' || G.state === 'target' || G.state === 'duel') {
    G.pausedFrom = G.state;
    setState('paused');
    UI.showPause();
  } else if (G.state === 'paused' && !forcePause) {
    UI.clear();
    setState(G.pausedFrom);
    G.clock.getDelta();
  }
}
onPause(() => togglePause());

// minimize / switch-app: pause gameplay and silence audio; resume audio on return
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    togglePause(true);       // no-op in menus; pauses any live game
    suspendAudio();
  } else {
    resumeAudio();
    G.clock.getDelta();      // don't integrate the time we were away
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
checkForUpdate((info) => UI.showUpdatePrompt(info));
initTouch();
showMenuBackdrop();
UI.showTitle();
playMusic('menu');
tick();
