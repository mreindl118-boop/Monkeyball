// SKY TARGET — Monkey-Target-style flight mode.
// Launch off a mega ramp, the ball splits open into wings, glide over the sea,
// grab bananas & power-ups mid-air, then land on floating dartboard targets.
// Ball rolls to a stop after touchdown; the ring you rest on is what you score.
import * as THREE from 'three';
import { Ball, stepBall, BALL_RADIUS } from './physics.js';
import { buildCharacterMesh, animateCharacter, fitCharacterInBall } from './characters.js';
import { targetTexture, waterTexture, iconSprite, checkerTexture, gridTexture } from './textures.js';
import { sfx } from './audio.js';
import { getSave, save, addBananas } from './save.js';

const ROUNDS = 3;
const SEA_Y = 0;
const _v = new THREE.Vector3();

// Flight tuning derived from the rascal's ground stats.
// Monkey-Target-style: ball OPEN = kinematic glider (stable, can't stall-spiral),
// ball CLOSED = ballistic dive. JUMP toggles between them any time.
function flightStats(char) {
  const s = char.stats;
  return {
    cruise: 15 + s.speed * 0.55,                      // natural glide airspeed
    sink: Math.max(0.55, 1.9 - s.jump * 0.13 + s.weight * 0.08), // base descent while gliding level
    diveGain: 13 + s.weight * 0.7,                    // nose-down acceleration
    turn: 1.35 + s.traction * 0.09,                   // yaw rate (open)
    launch: 26 + s.speed * 1.1                        // ramp exit speed
  };
}

// Air-adapted signature skills (same identity, flight flavor).
const AIR_SKILLS = {
  stomp: { name: 'Stall Stomp', desc: 'Kill momentum & drop straight down', cooldown: 5 },
  dash: { name: 'Sonic Boost', desc: 'Burst of forward airspeed', cooldown: 5 },
  float: { name: 'Puff Up', desc: 'Balloon upward for extra altitude', cooldown: 6 },
  shield: { name: 'Wind Shield', desc: 'Air brake + immune to wind 4s', cooldown: 6 },
  magnet: { name: 'Zap Magnet', desc: 'Pull in bananas & power-ups 6s', cooldown: 8 },
  pound: { name: 'Dive Bomb', desc: 'Plummet & stick the landing dead', cooldown: 6 },
  glide: { name: 'Parasol Lift', desc: 'Near-zero sink for 4s', cooldown: 7 },
  chomp: { name: 'Chrono Chomp', desc: 'Slow time for 3s of precise aiming', cooldown: 10 },
  overshield: { name: 'Overshield', desc: 'Wind immunity + steadied flight for 4s', cooldown: 7 },
  box: { name: 'Box Glider', desc: 'Deploy the box: slow-fall + wind-proof 3s', cooldown: 7 }
};

const POWERUPS = [
  { id: 'rocket', icon: '🚀', name: 'ROCKET', desc: '+airspeed' },
  { id: 'feather', icon: '🪶', name: 'FEATHER', desc: 'extra lift 4s' },
  { id: 'x2', icon: '✖2', name: 'DOUBLE SCORE', desc: 'next landing ×2' },
  { id: 'sticky', icon: '🍯', name: 'STICKY BALL', desc: 'stop dead on touchdown' }
];

export class TargetMode {
  // ctx: { scene, camera, char, ui, onFinish(total), onQuit }
  constructor(ctx) {
    this.ctx = ctx;
    this.char = ctx.char;
    this.fs = flightStats(this.char);
    this.skill = AIR_SKILLS[this.char.ability.id] || AIR_SKILLS.dash;
    this.root = new THREE.Group();
    ctx.scene.add(this.root);
    this.round = 1;
    this.total = 0;
    this.bananasGot = 0;
    this.ball = new Ball();
    this.time = 0;
    this.buildWorld();
    this.buildFlyer();
    this.startRound();
  }

  // ---------------- world ----------------
  buildWorld() {
    const scene = this.ctx.scene;
    if (this.ctx.atmosphere) this.ctx.atmosphere.setFogRange(150, 560);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshStandardMaterial({ map: waterTexture(40), roughness: 0.35, metalness: 0.1 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = SEA_Y;
    this.water = water;
    this.root.add(water);

    // THE MEGA RAMP — a wide half-pipe run with banked rails and a kicker lip,
    // Monkey-Target style: long enough to build serious speed (tuck to go faster!)
    const rampMat = new THREE.MeshStandardMaterial({ map: checkerTexture('#3a8fd6', '#9fd0ff', 10), roughness: 0.55 });
    const railMat = new THREE.MeshStandardMaterial({ map: checkerTexture('#2a5da8', '#7ec8ff', 6), roughness: 0.6 });
    this.rampSolids = [];
    const slab = (p, s, rx, rz = 0, material = rampMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), material);
      m.position.set(...p);
      m.rotation.order = 'ZYX';
      m.rotation.x = rx;
      m.rotation.z = rz;
      m.castShadow = m.receiveShadow = true;
      this.root.add(m);
      const solid = {
        pos: new THREE.Vector3(...p),
        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz, 'ZYX')),
        half: new THREE.Vector3(s[0] / 2, s[1] / 2, s[2] / 2),
        shape: 'box', linVel: new THREE.Vector3(), angVelY: 0,
        velAt: (pt, out) => out.set(0, 0, 0)
      };
      this.rampSolids.push(solid);
    };
    const W = 16;                       // twice as wide as the old ramp
    const pipe = (y, z, rx, len) => {
      slab([0, y, z], [W, 1.2, len], rx);
      // banked side rails keep the run honest without walls
      slab([-(W / 2 + 1.6), y + 1.4, z], [4.5, 1, len], rx, -0.55, railMat);
      slab([W / 2 + 1.6, y + 1.4, z], [4.5, 1, len], rx, 0.55, railMat);
    };
    // start deck high above the sea, then a LONG drop
    pipe(110, 64, 0, 18);
    pipe(101.5, 45, -0.60, 26);
    pipe(87, 24, -0.60, 26);
    pipe(72.5, 3, -0.60, 26);
    pipe(60, -17, -0.45, 24);
    pipe(51.5, -36, -0.26, 20);
    slab([0, 49.4, -52], [W, 1.2, 14], 0.24);   // the kicker lip
    // support pylons plunging into the sea
    for (const [ph, pz] of [[104, 60], [80, 20], [56, -20], [48, -48]]) {
      const pylon = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 2.2, ph, 10),
        new THREE.MeshStandardMaterial({ map: gridTexture('#1c2f52', '#4de1ff', 10), roughness: 0.7 })
      );
      pylon.position.set(0, ph / 2 - 4, pz);
      this.root.add(pylon);
    }
    // distance markers on the sea: rings + floating range signs every 60m
    for (let i = 1; i <= 4; i++) {
      const d = i * 60;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.2, 3.1, 32),
        new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(-26, SEA_Y + 0.05, -d);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconSprite(`${d}m`, 'rgba(20,40,80,0.85)'), transparent: true }));
      spr.scale.setScalar(5);
      spr.position.set(-26, 4, -d);
      this.root.add(ring, spr);
    }

    this.buildTargets();
    this.buildAirGoodies();
  }

  buildTargets() {
    this.targets = [];
    const mkTarget = (x, z, R, values, moving) => {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R * 1.06, 1.2, 48),
        [new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 }),
         new THREE.MeshStandardMaterial({ map: targetTexture(), roughness: 0.5 }),
         new THREE.MeshStandardMaterial({ color: 0x8a5a2b })]
      );
      // cylinder material order: side, top, bottom
      g.add(disc);
      g.position.set(x, SEA_Y + 0.6, z);
      this.root.add(g);
      const t = {
        mesh: g, pos: g.position, R,
        rings: [
          { r: R * 0.09, v: values[0] },
          { r: R * 0.22, v: values[1] },
          { r: R * 0.44, v: values[2] },
          { r: R * 0.66, v: values[3] },
          { r: R * 1.0, v: values[4] }
        ],
        moving,
        mult: 1,
        solid: {
          pos: g.position, quat: new THREE.Quaternion(),
          half: new THREE.Vector3(R, 0.6, R), shape: 'disc',
          linVel: new THREE.Vector3(), angVelY: 0,
          velAt: (pt, out) => out.copy(t.solid.linVel)
        }
      };
      this.targets.push(t);
    };
    // main boards at staggered distances; values center-out
    mkTarget(0, -150, 12, [100, 60, 30, 15, 10], false);       // the big board
    mkTarget(-38, -115, 6.5, [150, 80, 40, 20, 15], false);
    mkTarget(42, -185, 6.5, [150, 80, 40, 20, 15], false);
    mkTarget(0, -250, 4.5, [300, 200, 120, 60, 40], false);    // the long-shot jackpot
    mkTarget(24, -90, 3.4, [200, 120, 80, 40, 25], true);      // moving bonus board
    // x3 multiplier board — tiny, far, and drifting. The dream landing.
    mkTarget(-20, -215, 2.8, [100, 70, 45, 25, 15], true);
    this.targets[this.targets.length - 1].mult = 3;
    // banner so you know it's special
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconSprite('×3', 'rgba(180,40,120,0.9)'), transparent: true }));
    tag.scale.setScalar(4);
    tag.position.set(0, 5, 0);
    this.targets[this.targets.length - 1].mesh.add(tag);
  }

  buildAirGoodies() {
    // banana arcs + power-up orbs floating along flight paths
    this.goodies = [];
    const addBananaAt = (x, y, z) => {
      const body = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.2, 8, 16, Math.PI * 1.25),
        new THREE.MeshStandardMaterial({ color: '#ffd23d', roughness: 0.4, emissive: 0x664c00, emissiveIntensity: 0.4 })
      );
      body.rotation.z = Math.PI * 0.9;
      body.position.set(x, y, z);
      this.root.add(body);
      this.goodies.push({ kind: 'banana', pos: body.position, mesh: body, taken: false, r: 2.2 });
    };
    const addPowerup = (def, x, y, z) => {
      const g = new THREE.Group();
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.35, roughness: 0.1 })
      );
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconSprite(def.icon), transparent: true }));
      spr.scale.setScalar(1.6);
      g.add(orb, spr);
      g.position.set(x, y, z);
      this.root.add(g);
      this.goodies.push({ kind: 'power', def, pos: g.position, mesh: g, taken: false, r: 2.6 });
    };
    // arcs of bananas along the natural glide paths from the big launch
    for (let i = 0; i < 9; i++) addBananaAt(Math.sin(i * 0.55) * 5, 44 - i * 2.4, -70 - i * 11);
    for (let i = 0; i < 6; i++) addBananaAt(-26 + i * 2.5, 34 - i * 1.8, -95 - i * 8);
    for (let i = 0; i < 6; i++) addBananaAt(30, 32 - i * 1.8, -120 - i * 9);
    // high line rewarding a climb
    for (let i = 0; i < 5; i++) addBananaAt(0, 52, -85 - i * 12);
    // low skim line over the water for daredevils
    for (let i = 0; i < 5; i++) addBananaAt(-12, 8, -110 - i * 10);
    addPowerup(POWERUPS[0], 12, 38, -85);      // rocket
    addPowerup(POWERUPS[1], -14, 42, -80);     // feather
    addPowerup(POWERUPS[2], 0, 50, -130);      // x2 (worth the climb)
    addPowerup(POWERUPS[3], -32, 26, -110);    // sticky
    addPowerup(POWERUPS[0], 34, 22, -150);
  }

  // ---------------- flyer visuals: ball splits into wings ----------------
  buildFlyer() {
    const g = new THREE.Group();
    const half = (rotZ) => {
      const geo = new THREE.SphereGeometry(BALL_RADIUS, 24, 16, 0, Math.PI);
      const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        color: this.char.ballColor, transparent: true, opacity: 0.42,
        roughness: 0.05, clearcoat: 1, side: THREE.DoubleSide
      }));
      m.rotation.z = rotZ;
      return m;
    };
    // two hemispheres hinged at the top — open like wings in flight
    this.wingL = new THREE.Group(); this.wingR = new THREE.Group();
    const hl = half(0), hr = half(Math.PI);
    hl.rotation.y = -Math.PI / 2; hr.rotation.y = Math.PI / 2;
    this.wingL.add(hl); this.wingR.add(hr);
    g.add(this.wingL, this.wingR);
    this.built = buildCharacterMesh(this.char.id);
    fitCharacterInBall(this.built, BALL_RADIUS);
    g.add(this.built.group);
    this.flyer = g;
    this.ctx.scene.add(g);

    // landing shadow marker — shows where you are over the sea/boards
    const mk = new THREE.Group();
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })
    );
    dot.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.05, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    mk.add(dot, ring);
    mk.renderOrder = 5;
    this.root.add(mk);
    this.marker = mk;
  }

  updateMarker() {
    if (this.phase !== 'fly') { this.marker.visible = false; return; }
    this.marker.visible = true;
    const b = this.ball.pos;
    let y = SEA_Y + 0.06;
    for (const tg of this.targets) {
      if (Math.hypot(b.x - tg.pos.x, b.z - tg.pos.z) <= tg.R) { y = tg.pos.y + 0.62; break; }
    }
    this.marker.position.set(b.x, y, b.z);
    const alt = Math.max(1, b.y - y);
    this.marker.scale.setScalar(THREE.MathUtils.clamp(1 + alt * 0.02, 1, 2.2));
  }

  setWings(open) { // 0 = closed ball, 1 = spread wings
    this.wingOpen = open;
    const a = open * 1.25;
    this.wingL.rotation.z = a;
    this.wingR.rotation.z = -a;
    this.wingL.position.x = -open * 0.1;
    this.wingR.position.x = open * 0.1;
  }

  // ---------------- round flow ----------------
  startRound() {
    this.phase = 'ramp';        // ramp -> fly -> landed -> scored
    this.phaseT = 0;
    this.roundScore = 0;
    this.multiplier = 1;
    this.sticky = false;
    this.stuckTimer = 0;
    this.cooldown = 0;
    this.magnet = 0; this.feather = 0; this.superLift = 0; this.windShield = 0; this.slowmo = 0;
    this.ball.reset([0, 112, 68]);
    this.launchBonus = 0;         // Turbo Launch item
    this.roundFeather = false;    // Feather item (whole-round lift)
    this.tuck = 0;
    this.tuckHintShown = false;
    // each flight happens later in the day: dawn -> sunset -> night
    if (this.ctx.atmosphere) {
      this.ctx.atmosphere.setPreset(['morning', 'sunset', 'night'][this.round - 1] || 'night');
      this.ctx.atmosphere.setFogRange(150, 560);
    }
    this.yaw = 0;               // yaw convention: forward = (-sin(yaw), 0, -cos(yaw)); 0 faces -z
    this.airVel = new THREE.Vector3(0, 0, 0);
    this.open = false;          // launch closed, like Monkey Target — JUMP pops the wings
    this.pitch = 0;             // radians; negative = nose down
    this.speed = 0;             // airspeed while gliding
    this.hintShown = false;
    this.setWings(0);
    // per-round wind
    const wa = Math.random() * Math.PI * 2;
    const ws = 1.5 + Math.random() * 4.5;
    this.wind = new THREE.Vector3(Math.cos(wa) * ws, 0, Math.sin(wa) * ws * 0.4);
    // wind sock: 8-way arrow relative to your flight direction (-z = ahead = ↑)
    const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
    const ang = Math.atan2(this.wind.x, -this.wind.z);            // 0 = tailwind ahead
    const idx = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
    this.windText = `🧦 WIND ${arrows[idx]} ${ws.toFixed(1)}`;
    this.ctx.ui.flashMessage(`ROUND ${this.round} / ${ROUNDS}`, 1400);
    // snap the chase cam straight to the deck (no cross-map lerp)
    this.ctx.camera.position.set(0, 118.5, 81);
    this.ctx.camera.lookAt(0, 108, 50);
    sfx.ready();
  }

  useSkill() {
    if (this.cooldown > 0 || this.phase !== 'fly') return;
    const id = this.char.ability.id;
    this.cooldown = this.skill.cooldown;
    sfx.ability();
    switch (id) {
      case 'stomp':   // brake hard & drop straight — bullseye sniping
        this.open = false;
        this.airVel.x *= 0.15; this.airVel.z *= 0.15;
        this.airVel.y = Math.min(this.airVel.y, -6);
        break;
      case 'dash':
        if (this.open) this.speed = Math.min(this.speed + 13, 38);
        else this.airVel.addScaledVector(this.forward(), 13);
        sfx.dash();
        break;
      case 'float':   // balloon up and hang there
        this.open = true;
        this.pitch = 0.3;
        this.speed = Math.max(this.speed, this.fs.cruise);
        this.superLift = Math.max(this.superLift, 2);
        this.airVel.y = Math.max(this.airVel.y, 6);
        this.ball.pos.y += 2.5;
        break;
      case 'shield':
        this.windShield = 4;
        if (this.open) this.speed = Math.max(9, this.speed * 0.6);
        break;
      case 'magnet': this.magnet = 6; break;
      case 'pound':   // tuck & plummet, stick the landing
        this.open = false;
        this.airVel.y = -28;
        this.sticky = true;
        this.ctx.ui.flashMessage('DIVE BOMB!', 800);
        break;
      case 'glide': this.open = true; this.superLift = 4; break;
      case 'chomp': this.slowmo = 3; this.ctx.ui.flashMessage('SLOW-MO!', 800); break;
      case 'overshield':
        this.windShield = 4;
        if (this.open) this.speed = Math.max(this.speed, this.fs.cruise);
        this.ctx.ui.flashMessage('OVERSHIELD!', 800);
        break;
      case 'box':
        this.open = true;
        this.superLift = 3;
        this.windShield = 3;
        this.ctx.ui.flashMessage('BOX DEPLOYED!', 800);
        break;
    }
  }

  forward() { return _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).clone(); }

  // ---------------- update ----------------
  update(realDt, t, input) {
    this.time = t;
    const dt = this.slowmo > 0 ? realDt * 0.4 : realDt;
    this.slowmo = Math.max(0, this.slowmo - realDt);
    this.cooldown = Math.max(0, this.cooldown - realDt);
    this.phaseT += dt;

    // animated world bits
    this.water.material.map.offset.set(Math.sin(t * 0.15) * 0.15, t * 0.01);
    for (const tg of this.targets) {
      if (tg.moving) {
        const off = Math.sin(t * 0.55) * 16;
        tg.pos.x = 20 + off;
        tg.solid.linVel.set(Math.cos(t * 0.55) * 0.55 * 16, 0, 0);
      }
    }
    for (const gd of this.goodies) {
      if (gd.taken) continue;
      gd.mesh.rotation.y = t * 2.5;
      if (gd.kind === 'power') gd.mesh.position.y = gd.pos.y + Math.sin(t * 2 + gd.pos.x) * 0.3;
    }

    if (input.ability) this.useSkill();

    switch (this.phase) {
      case 'ramp': this.updateRamp(dt, input); break;
      case 'fly': this.updateFly(dt, input); break;
      case 'landed': this.updateLanded(dt, t); break;
      case 'scored': if (this.phaseT > 2.2) this.nextRound(); break;
      case 'splash': if (this.phaseT > 1.6) this.nextRound(); break;
      case 'shop': break;   // waiting on the item shop UI
    }

    this.syncVisual(t, realDt);
    this.updateMarker();
    this.updateCamera(realDt);
    this.updateHUD();
  }

  updateRamp(dt, input) {
    // roll the half-pipe: steer freely, HOLD UP to tuck for extra launch speed
    let tuckIn = -input.y;
    if (getSave().settings.invertPitch) tuckIn = -tuckIn;
    this.tuck += ((tuckIn > 0.2 ? 1 : 0) - this.tuck) * Math.min(1, dt * 4);
    if (!this.tuckHintShown && this.phaseT > 0.8) {
      this.tuckHintShown = true;
      this.ctx.ui.flashMessage(document.body.classList.contains('touch') ? 'HOLD ▲ TO TUCK!' : 'HOLD UP TO TUCK!', 1400);
    }
    const events = [];
    stepBall(this.ball, Math.min(dt, 1 / 30), {
      solids: this.rampSolids, bumpers: [],
      input: { x: input.x * 0.6, y: -1, jump: false, ability: false }, camYaw: this.yaw,
      events,
      accel: (this.fs.launch + this.launchBonus) * (0.85 + this.tuck * 0.55),
      traction: this.tuck > 0.5 ? 0.15 : 0.4,
      jumpVel: 0, weightFactor: this.char.stats.weight / 10
    });
    // off the kicker?
    if (this.ball.pos.z < -56 && !this.ball.onGround) {
      this.phase = 'fly';
      this.phaseT = 0;
      this.airVel.copy(this.ball.vel);
      const hs = Math.hypot(this.airVel.x, this.airVel.z);
      const floor = (this.fs.launch + this.launchBonus) * 0.85;
      if (hs < floor) { // guarantee a respectable launch even after a wobbly run
        const k = floor / Math.max(hs, 0.1);
        this.airVel.x *= k; this.airVel.z *= k;
      }
      // the kicker pops you into a proper arc
      this.airVel.y = Math.max(this.airVel.y, 7 + Math.hypot(this.airVel.x, this.airVel.z) * 0.14);
      this.yaw = Math.atan2(-this.airVel.x, -this.airVel.z);
      sfx.launch();
      this.ctx.ui.flashMessage(document.body.classList.contains('touch') ? 'TAP JUMP = WINGS!' : 'SPACE = WINGS!', 1600);
    }
    if (this.ball.pos.y < 42 && this.phase === 'ramp') { // slipped off the pipe
      this.phase = 'fly'; this.airVel.copy(this.ball.vel);
    }
  }

  toggleWings() {
    this.open = !this.open;
    if (this.open) {
      // ball pops open: convert motion into stable airspeed & pitch
      const hs = Math.hypot(this.airVel.x, this.airVel.z);
      this.speed = THREE.MathUtils.clamp(Math.hypot(hs, Math.max(-this.airVel.y * 0.45, 0)), 12, 32);
      this.pitch = THREE.MathUtils.clamp(Math.atan2(this.airVel.y, Math.max(hs, 2)), -0.55, 0.12);
      sfx.glide();
    } else {
      // tuck back into the ball: keep current velocity, gravity takes over
      sfx.bounce();
    }
  }

  updateFly(dt, input) {
    if (input.jump) this.toggleWings();
    // wings animate toward state
    const target = this.open ? 1 : 0;
    this.setWings(this.wingOpen + (target - this.wingOpen) * Math.min(1, dt * 8));

    // remind stragglers about the wings (once)
    if (!this.open && !this.hintShown && this.phaseT > 1.6) {
      this.hintShown = true;
      this.ctx.ui.flashMessage(document.body.classList.contains('touch') ? 'JUMP = WINGS!' : 'SPACE = WINGS!', 1200);
    }

    // steering — banking turns; the closed ball barely steers
    this.yaw -= input.x * this.fs.turn * (this.open ? 1 : 0.4) * dt;
    this.lastTurn = input.x;
    const f = this.forward();

    if (this.open) {
      // ---- kinematic glider: stable & readable, no stall spirals ----
      let dive = -input.y;                    // stick up = nose down, like Monkey Target
      if (getSave().settings.invertPitch) dive = -dive;
      // nose down up to ~35°, nose up to ~20°
      let pitchTarget = dive > 0 ? -dive * 0.62 : -dive * 0.34;
      // low airspeed gently forces the nose down instead of stalling out
      if (this.speed < 13) pitchTarget = Math.min(pitchTarget, (this.speed - 13) * 0.1);
      this.pitch += (pitchTarget - this.pitch) * Math.min(1, dt * 3.2);

      // airspeed: diving accelerates, climbing bleeds, level relaxes to cruise
      const accel = -Math.sin(this.pitch) * this.fs.diveGain - (this.speed - this.fs.cruise) * 0.45;
      this.speed = THREE.MathUtils.clamp(this.speed + accel * dt, 9, 38);

      // sink: gliding always descends a little (abilities can cancel it);
      // hard banking bleeds extra lift — pick your turns
      let sink = this.fs.sink + Math.abs(input.x) * 0.7;
      if (this.superLift > 0) sink = 0;
      else if (this.feather > 0 || this.roundFeather) sink *= 0.35;

      const horiz = this.speed * Math.cos(this.pitch);
      this.airVel.set(f.x * horiz, this.speed * Math.sin(this.pitch) - sink, f.z * horiz);
    } else {
      // ---- closed ball: ballistic dive, fast & heavy ----
      this.airVel.y -= 24 * dt;
      const hs = Math.hypot(this.airVel.x, this.airVel.z) * Math.exp(-0.03 * dt);
      this.airVel.x = f.x * hs;
      this.airVel.z = f.z * hs;
    }

    // wind drifts you (open wings catch much more of it)
    if (this.windShield <= 0) this.ball.pos.addScaledVector(this.wind, dt * (this.open ? 0.55 : 0.18));

    this.feather = Math.max(0, this.feather - dt);
    this.superLift = Math.max(0, this.superLift - dt);
    this.windShield = Math.max(0, this.windShield - dt);

    this.ball.pos.addScaledVector(this.airVel, dt);

    // magnet pull
    if (this.magnet > 0) {
      this.magnet -= dt;
      for (const gd of this.goodies) {
        if (gd.taken) continue;
        const d = gd.pos.distanceTo(this.ball.pos);
        if (d < 16) { gd.pos.lerp(this.ball.pos, Math.min(1, dt * 4)); gd.mesh.position.copy(gd.pos); }
      }
    }
    // collect goodies
    for (const gd of this.goodies) {
      if (gd.taken) continue;
      if (gd.pos.distanceTo(this.ball.pos) < gd.r) {
        gd.taken = true; gd.mesh.visible = false;
        if (gd.kind === 'banana') {
          this.bananasGot++; this.roundScore += 5; sfx.banana();
        } else {
          sfx.bunch();
          this.ctx.ui.flashMessage(gd.def.name + '!', 900);
          switch (gd.def.id) {
            case 'rocket': this.open ? this.speed = Math.min(this.speed + 12, 38) : this.airVel.addScaledVector(this.forward(), 12); break;
            case 'feather': this.feather = 4; break;
            case 'x2': this.multiplier = 2; break;
            case 'sticky': this.sticky = true; break;
          }
        }
      }
    }

    // touchdown checks
    if (this.ball.pos.y <= SEA_Y + 0.4) { // splash
      this.phase = 'splash'; this.phaseT = 0;
      sfx.fall();
      this.ctx.ui.flashMessage('SPLASH! +0', 1300);
      return;
    }
    for (const tg of this.targets) {
      const dx = this.ball.pos.x - tg.pos.x, dz = this.ball.pos.z - tg.pos.z;
      if (this.ball.pos.y <= tg.pos.y + 0.6 + BALL_RADIUS && this.ball.pos.y > tg.pos.y - 1 &&
          Math.hypot(dx, dz) < tg.R + 0.5 && this.airVel.y < 0) {
        this.phase = 'landed'; this.phaseT = 0;
        this.ball.vel.copy(this.airVel);
        if (this.sticky) {
          // Sticky Ball item: dead stop where you hit
          this.ball.vel.multiplyScalar(0.06);
          this.landTraction = 8;
          this.ctx.ui.flashMessage('STUCK IT!', 900);
        } else if (!this.open) {
          // CLOSED ball plants like a cannonball — the precision landing
          this.ball.vel.x *= 0.35; this.ball.vel.z *= 0.35;
          this.ball.vel.y = -1;
          this.landTraction = 4.5;
          this.ctx.ui.flashMessage('PLANTED!', 700);
        } else {
          // OPEN wings bounce & roll — pray you stop on a good ring
          this.ball.vel.x *= 0.85; this.ball.vel.z *= 0.85;
          this.ball.vel.y = Math.min(Math.abs(this.airVel.y) * 0.35, 5);
          this.landTraction = 1.2;
        }
        this.open = false;
        sfx.bounce();
        return;
      }
    }
  }

  updateLanded(dt, t) {
    // close wings, roll out on the boards with real physics
    this.setWings(Math.max(0, this.wingOpen - dt * 4));
    const events = [];
    const solids = this.targets.map(tg => tg.solid);
    stepBall(this.ball, Math.min(dt, 1 / 30), {
      solids, bumpers: [],
      input: { x: 0, y: 0, jump: false, ability: false }, camYaw: this.yaw,
      events, accel: 0, traction: this.landTraction || 1.6, jumpVel: 0,
      weightFactor: this.char.stats.weight / 10
    });
    // rolled off into the sea?
    if (this.ball.pos.y <= SEA_Y + 0.4) {
      this.phase = 'splash'; this.phaseT = 0;
      sfx.fall();
      this.ctx.ui.flashMessage('ROLLED OFF! SPLASH!', 1300);
      return;
    }
    const sp = this.ball.vel.length();
    if (sp < 0.9) this.stuckTimer += dt; else this.stuckTimer = 0;
    if (this.stuckTimer > 0.6) this.scoreLanding();
  }

  scoreLanding() {
    // find which board & ring we rest on
    let best = null, boardMult = 1;
    for (const tg of this.targets) {
      const d = Math.hypot(this.ball.pos.x - tg.pos.x, this.ball.pos.z - tg.pos.z);
      if (d <= tg.R + 0.2 && Math.abs(this.ball.pos.y - (tg.pos.y + 0.6 + BALL_RADIUS)) < 1.2) {
        for (const ring of tg.rings) {
          if (d <= ring.r) { best = ring.v; break; }
        }
        if (best === null) best = tg.rings[tg.rings.length - 1].v;
        boardMult = tg.mult || 1;
        break;
      }
    }
    const pts = (best || 0) * boardMult * this.multiplier;
    this.roundScore += pts;
    this.total += this.roundScore;
    this.phase = 'scored';
    this.phaseT = 0;
    sfx.goal();
    let msg = best ? `${best}` : 'ON THE BOARD!';
    if (best && boardMult > 1) msg += ` ×${boardMult}`;
    if (best && this.multiplier > 1) msg += ` ×${this.multiplier}`;
    if (best && (boardMult > 1 || this.multiplier > 1)) msg += ` = ${pts}`;
    if (best) msg += ' POINTS!';
    this.ctx.ui.flashMessage(msg, 2000);
  }

  nextRound() {
    if (this.phase === 'splash') this.total += this.roundScore; // keep air pickups even on splash
    if (this.round >= ROUNDS) {
      // bank rewards & record
      addBananas(this.bananasGot + Math.floor(this.total / 25));
      const sv = getSave();
      if (this.total > (sv.targetBest || 0)) { sv.targetBest = this.total; save(); }
      this.ctx.onFinish({ total: this.total, bananas: this.bananasGot, best: sv.targetBest });
      return;
    }
    this.round++;
    // Deluxe-style item shop: spend flight bananas on gear for the next ball
    this.phase = 'shop';
    this.ctx.ui.showItemShop({
      bananas: this.bananasGot,
      round: this.round,
      rounds: ROUNDS,
      items: [
        { id: 'sticky', icon: '🍯', name: 'Sticky Ball', cost: 8, desc: 'Stop dead where you land — no bounce, no roll.' },
        { id: 'x2', icon: '✖️2', name: 'Double Score', cost: 12, desc: 'Next landing scores double.' },
        { id: 'turbo', icon: '🚀', name: 'Turbo Launch', cost: 8, desc: 'Extra ramp speed for a longer flight.' },
        { id: 'feather', icon: '🪶', name: 'Feather', cost: 6, desc: 'Featherlight glide for the whole flight.' }
      ],
      onPick: (id) => {
        this.startRound();
        if (!id) return;
        this.bananasGot -= { sticky: 8, x2: 12, turbo: 8, feather: 6 }[id] || 0;
        if (id === 'sticky') this.sticky = true;
        if (id === 'x2') this.multiplier = 2;
        if (id === 'turbo') this.launchBonus = 9;
        if (id === 'feather') this.roundFeather = true;
        sfx.buy();
      }
    });
  }

  // ---------------- visuals ----------------
  syncVisual(t, dt) {
    this.flyer.position.copy(this.ball.pos);
    if (this.phase === 'fly') {
      const hs = Math.hypot(this.airVel.x, this.airVel.z);
      this.flyer.rotation.y = this.yaw + Math.PI;   // model faces +z at identity
      if (this.open) {
        // glider: bank into turns, nose follows pitch
        this.flyer.rotation.z += ((-this.lastTurn || 0) * 0.7 - this.flyer.rotation.z) * Math.min(1, dt * 5);
        this.flyer.rotation.x += ((-this.pitch * 0.9) - this.flyer.rotation.x) * Math.min(1, dt * 6);
        animateCharacter(this.built, t, 'air', hs);
      } else {
        // closed ball: tumbles forward as it dives
        this.flyer.rotation.z *= 0.9;
        this.flyer.rotation.x += dt * (4 + hs * 0.15);
        animateCharacter(this.built, t, 'roll', hs);
      }
    } else if (this.phase === 'ramp' || this.phase === 'landed') {
      this.flyer.rotation.x *= 0.9; this.flyer.rotation.z *= 0.9;
      animateCharacter(this.built, t, 'roll', this.ball.vel.length());
    } else if (this.phase === 'scored') {
      animateCharacter(this.built, t, 'win');
    } else if (this.phase === 'splash') {
      this.flyer.position.y = Math.max(this.flyer.position.y, SEA_Y - 0.4);
      animateCharacter(this.built, t, 'dizzy');
    }
  }

  updateCamera(dt) {
    const cam = this.ctx.camera;
    const b = this.ball.pos;
    let px, py, pz, lx, ly, lz;
    if (this.phase === 'fly') {
      const f = this.forward();
      // when diving (nose down / closed ball), camera rises for a better view of the boards
      const divey = this.open ? THREE.MathUtils.clamp(-this.pitch, 0, 0.7) : 0.55;
      px = b.x - f.x * (10 - divey * 2.5); py = b.y + 3.2 + divey * 5; pz = b.z - f.z * (10 - divey * 2.5);
      lx = b.x + f.x * 9; ly = b.y - 1.5 - divey * 7; lz = b.z + f.z * 9;
    } else if (this.phase === 'ramp') {
      // high chase cam straight down the pipe — watch your line & speed
      px = b.x * 0.5; py = b.y + 6.5; pz = b.z + 13;
      lx = b.x * 0.5; ly = b.y - 2; lz = b.z - 10;
    } else {
      px = b.x + 8; py = b.y + 7; pz = b.z + 8;
      lx = b.x; ly = b.y; lz = b.z;
    }
    cam.position.lerp(_v.set(px, py, pz), Math.min(1, dt * (this.phase === 'fly' ? 6 : 4)));
    cam.lookAt(lx, ly, lz);
  }

  updateHUD() {
    const hs = this.phase === 'fly' ? Math.hypot(this.airVel.x, this.airVel.z) : this.ball.vel.length();
    this.ctx.ui.updateHUD({
      time: Math.max(0, this.ball.pos.y - SEA_Y),   // altitude in the timer slot
      bananas: this.bananasGot,
      lives: ROUNDS - this.round + 1,
      score: this.total + this.roundScore,
      speed: hs,
      abilityReady: this.cooldown <= 0,
      abilityName: this.skill.name,
      timerFrozen: this.slowmo > 0
    });
    let wings = '';
    if (this.phase === 'fly') wings = this.open ? ' · 🪽 OPEN' : ' · ⚫ CLOSED (JUMP)';
    else if (this.phase === 'ramp') wings = this.tuck > 0.5 ? ' · 💨 TUCKED!' : ' · HOLD UP = TUCK';
    this.ctx.ui.setExtra(`${this.windText}${wings}${this.multiplier > 1 ? ' · ×2 ARMED' : ''}${this.sticky ? ' · 🍯' : ''}`);
  }

  storeTurn(x) { this.lastTurn = x; }

  dispose() {
    this.ctx.scene.remove(this.root, this.flyer);
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }
}

export { AIR_SKILLS, POWERUPS, ROUNDS };
