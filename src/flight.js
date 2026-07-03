// SKY TARGET — Monkey-Target-style flight mode.
// Launch off a mega ramp, the ball splits open into wings, glide over the sea,
// grab bananas & power-ups mid-air, then land on floating dartboard targets.
// Ball rolls to a stop after touchdown; the ring you rest on is what you score.
import * as THREE from 'three';
import { Ball, stepBall, BALL_RADIUS } from './physics.js';
import { buildCharacterMesh, animateCharacter } from './characters.js';
import { targetTexture, waterTexture, iconSprite, checkerTexture, gridTexture, skyTexture } from './textures.js';
import { sfx } from './audio.js';
import { getSave, save, addBananas } from './save.js';

const ROUNDS = 3;
const SEA_Y = 0;
const _v = new THREE.Vector3();

// Flight tuning derived from the rascal's ground stats.
function flightStats(char) {
  const s = char.stats;
  return {
    lift: 0.62 + s.jump * 0.022 - s.weight * 0.018,   // fraction of gravity cancelled at speed
    turn: 1.25 + s.traction * 0.09,                    // yaw rate
    diveGain: 10 + s.weight * 0.9 + s.speed * 0.35,    // how hard diving accelerates you
    drag: 0.10 + s.weight * 0.004,
    launch: 26 + s.speed * 1.1                         // ramp exit speed
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
  chomp: { name: 'Chrono Chomp', desc: 'Slow time for 3s of precise aiming', cooldown: 10 }
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
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTexture('#2a7fd4', '#8fd0ff', '#ffedbd'), side: THREE.BackSide, fog: false })
    );
    scene.add(this.sky);
    scene.fog = new THREE.Fog(new THREE.Color('#9fd4ff'), 150, 550);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshStandardMaterial({ map: waterTexture(40), roughness: 0.35, metalness: 0.1 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = SEA_Y;
    this.water = water;
    this.root.add(water);

    // launch tower + ramp (a chain of angled slabs ending in an up-kick)
    const rampMat = new THREE.MeshStandardMaterial({ map: checkerTexture('#3a8fd6', '#9fd0ff', 6), roughness: 0.6 });
    this.rampSolids = [];
    const slab = (p, s, rx) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), rampMat);
      m.position.set(...p);
      m.rotation.x = rx;
      this.root.add(m);
      const solid = {
        pos: new THREE.Vector3(...p),
        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)),
        half: new THREE.Vector3(s[0] / 2, s[1] / 2, s[2] / 2),
        shape: 'box', linVel: new THREE.Vector3(), angVelY: 0,
        velAt: (pt, out) => out.set(0, 0, 0)
      };
      this.rampSolids.push(solid);
    };
    // tower top platform (start) then a long steep drop and an up-curl lip
    slab([0, 74, 40], [8, 1, 14], 0);
    slab([0, 66, 22], [8, 1, 26], -0.62);
    slab([0, 51, 2], [8, 1, 26], -0.62);
    slab([0, 40, -14], [8, 1, 16], -0.30);
    slab([0, 37.2, -26], [8, 1, 10], 0.22);   // the kicker lip
    // tower pillar (decor)
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 4.5, 74, 12),
      new THREE.MeshStandardMaterial({ map: gridTexture('#1c2f52', '#4de1ff', 10), roughness: 0.7 })
    );
    pillar.position.set(0, 37, 40);
    this.root.add(pillar);

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
    mkTarget(0, -120, 11, [100, 60, 30, 15, 10], false);
    mkTarget(-34, -95, 6, [150, 80, 40, 20, 15], false);
    mkTarget(38, -150, 6, [150, 80, 40, 20, 15], false);
    mkTarget(0, -195, 4.5, [300, 200, 120, 60, 40], false);   // the long-shot jackpot
    mkTarget(20, -70, 3.2, [200, 120, 80, 40, 25], true);     // moving bonus board
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
    // arcs of bananas along the natural glide path
    for (let i = 0; i < 7; i++) addBananaAt(Math.sin(i * 0.6) * 4, 30 - i * 2.2, -45 - i * 8);
    for (let i = 0; i < 5; i++) addBananaAt(-20 + i * 2, 22 - i * 1.5, -70 - i * 6);
    for (let i = 0; i < 5; i++) addBananaAt(24, 20 - i * 1.5, -85 - i * 7);
    // high line rewarding a climb
    for (let i = 0; i < 4; i++) addBananaAt(0, 38, -60 - i * 10);
    addPowerup(POWERUPS[0], 10, 26, -60);     // rocket
    addPowerup(POWERUPS[1], -12, 30, -55);    // feather
    addPowerup(POWERUPS[2], 0, 34, -95);      // x2 (worth the climb)
    addPowerup(POWERUPS[3], -30, 18, -80);    // sticky
    addPowerup(POWERUPS[0], 30, 16, -110);
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
    this.built.group.scale.setScalar(0.62);
    this.built.group.position.y = -BALL_RADIUS * 0.82;
    g.add(this.built.group);
    this.flyer = g;
    this.ctx.scene.add(g);
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
    this.ball.reset([0, 76, 42]);
    this.yaw = 0;               // yaw convention: forward = (-sin(yaw), 0, -cos(yaw)); 0 faces -z
    this.airVel = new THREE.Vector3(0, 0, 0);
    this.setWings(0);
    // per-round wind
    const wa = Math.random() * Math.PI * 2;
    const ws = 1.5 + Math.random() * 4.5;
    this.wind = new THREE.Vector3(Math.cos(wa) * ws, 0, Math.sin(wa) * ws * 0.4);
    const dirTxt = Math.abs(this.wind.x) > Math.abs(this.wind.z)
      ? (this.wind.x > 0 ? '→' : '←') : (this.wind.z > 0 ? '↓' : '↑');
    this.windText = `WIND ${dirTxt} ${ws.toFixed(1)}`;
    this.ctx.ui.flashMessage(`ROUND ${this.round} / ${ROUNDS}`, 1400);
    sfx.ready();
  }

  useSkill() {
    if (this.cooldown > 0 || this.phase !== 'fly') return;
    const id = this.char.ability.id;
    this.cooldown = this.skill.cooldown;
    sfx.ability();
    switch (id) {
      case 'stomp': this.airVel.x *= 0.25; this.airVel.z *= 0.25; this.airVel.y = Math.min(this.airVel.y, -6); break;
      case 'dash': {
        const f = this.forward(); this.airVel.addScaledVector(f, 14); sfx.dash(); break;
      }
      case 'float': this.airVel.y = Math.max(this.airVel.y + 9, 7); break;
      case 'shield': this.windShield = 4; this.airVel.multiplyScalar(0.55); break;
      case 'magnet': this.magnet = 6; break;
      case 'pound': this.airVel.y = -26; this.sticky = true; this.ctx.ui.flashMessage('DIVE BOMB!', 800); break;
      case 'glide': this.superLift = 4; break;
      case 'chomp': this.slowmo = 3; this.ctx.ui.flashMessage('SLOW-MO!', 800); break;
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
    }

    this.syncVisual(t, realDt);
    this.updateCamera(realDt);
    this.updateHUD();
  }

  updateRamp(dt, input) {
    // roll down the ramp with real physics; player steers a little
    const events = [];
    stepBall(this.ball, Math.min(dt, 1 / 30), {
      solids: this.rampSolids, bumpers: [],
      input: { x: input.x * 0.5, y: -1, jump: false, ability: false }, camYaw: this.yaw,
      events, accel: this.fs.launch, traction: 0.35, jumpVel: 0, weightFactor: this.char.stats.weight / 10
    });
    // left the lip?
    if (this.ball.pos.z < -30 && !this.ball.onGround) {
      this.phase = 'fly';
      this.phaseT = 0;
      this.airVel.copy(this.ball.vel);
      const hs = Math.hypot(this.airVel.x, this.airVel.z);
      if (hs < this.fs.launch * 0.8) { // guarantee a decent launch
        const k = (this.fs.launch * 0.8) / Math.max(hs, 0.1);
        this.airVel.x *= k; this.airVel.z *= k;
      }
      this.yaw = Math.atan2(-this.airVel.x, -this.airVel.z);
      sfx.launch();
      this.ctx.ui.flashMessage('WINGS OUT!', 900);
    }
    if (this.ball.pos.y < 30) { // fell off the ramp somehow
      this.phase = 'fly'; this.airVel.copy(this.ball.vel);
    }
  }

  updateFly(dt, input) {
    // open wings over ~0.4s
    this.setWings(Math.min(1, (this.wingOpen || 0) + dt * 3));

    // steering
    this.yaw -= input.x * this.fs.turn * dt;
    this.lastTurn = input.x;
    const f = this.forward();
    const hs = Math.hypot(this.airVel.x, this.airVel.z);

    // pitch input: dive (y>0 = stick down? our input y: up=-1) — up-stick dives like Monkey Target
    const dive = -input.y;   // push up on stick = nose down = speed
    if (dive > 0.05) {
      this.airVel.addScaledVector(f, dive * this.fs.diveGain * dt);
      this.airVel.y -= dive * this.fs.diveGain * 0.8 * dt;
    } else if (dive < -0.05) {
      // flare: trade speed for lift
      const brake = Math.min(hs * 0.5, -dive * 9) * dt;
      this.airVel.x -= f.x * brake * 4; this.airVel.z -= f.z * brake * 4;
      this.airVel.y += -dive * Math.min(hs * 0.35, 7.5) * dt;
    }

    // steer velocity toward heading (banking)
    const targetVx = f.x * hs, targetVz = f.z * hs;
    this.airVel.x += (targetVx - this.airVel.x) * Math.min(1, dt * 3.2);
    this.airVel.z += (targetVz - this.airVel.z) * Math.min(1, dt * 3.2);

    // gravity vs lift
    let lift = this.fs.lift + (this.feather > 0 ? 0.25 : 0);
    if (this.superLift > 0) lift = 1.02;
    const liftFrac = Math.min(1.05, lift * (hs / 18));
    this.airVel.y -= 20 * (1 - liftFrac) * dt;
    // drag
    const drag = Math.exp(-this.fs.drag * dt);
    this.airVel.x *= drag; this.airVel.z *= drag;
    // wind
    if (this.windShield <= 0) this.airVel.addScaledVector(this.wind, dt * 0.55);

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
            case 'rocket': { const fw = this.forward(); this.airVel.addScaledVector(fw, 13); break; }
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
        if (this.sticky) { this.ball.vel.multiplyScalar(0.06); this.ctx.ui.flashMessage('STUCK IT!', 900); }
        else this.ball.vel.y = Math.max(this.ball.vel.y * -0.2, -2);
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
      events, accel: 0, traction: this.sticky ? 8 : 1.6, jumpVel: 0,
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
    let best = null;
    for (const tg of this.targets) {
      const d = Math.hypot(this.ball.pos.x - tg.pos.x, this.ball.pos.z - tg.pos.z);
      if (d <= tg.R + 0.2 && Math.abs(this.ball.pos.y - (tg.pos.y + 0.6 + BALL_RADIUS)) < 1.2) {
        for (const ring of tg.rings) {
          if (d <= ring.r) { best = ring.v; break; }
        }
        if (best === null) best = tg.rings[tg.rings.length - 1].v;
        break;
      }
    }
    const pts = (best || 0) * this.multiplier;
    this.roundScore += pts;
    this.total += this.roundScore;
    this.phase = 'scored';
    this.phaseT = 0;
    sfx.goal();
    this.ctx.ui.flashMessage(
      best ? `${best}${this.multiplier > 1 ? ' ×2' : ''} POINTS!` : 'ON THE BOARD!',
      1800
    );
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
    this.startRound();
  }

  // ---------------- visuals ----------------
  syncVisual(t, dt) {
    this.flyer.position.copy(this.ball.pos);
    if (this.phase === 'fly') {
      // bank & pitch the flyer with motion
      const hs = Math.hypot(this.airVel.x, this.airVel.z);
      this.flyer.rotation.y = this.yaw + Math.PI;   // model faces +z at identity
      this.flyer.rotation.z += ((-this.lastTurn || 0) * 0.7 - this.flyer.rotation.z) * Math.min(1, dt * 5);
      this.flyer.rotation.x = Math.atan2(-this.airVel.y, Math.max(hs, 4)) * 0.55;
      animateCharacter(this.built, t, 'air', hs);
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
      px = b.x - f.x * 10; py = b.y + 3.2; pz = b.z - f.z * 10;
      lx = b.x + f.x * 8; ly = b.y - 1; lz = b.z + f.z * 8;
    } else if (this.phase === 'ramp') {
      // offset to the side so we never clip through the launch tower
      px = b.x + 7; py = b.y + 4.5; pz = b.z + 9;
      lx = b.x; ly = b.y; lz = b.z - 6;
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
    this.ctx.ui.setExtra(`${this.windText}${this.multiplier > 1 ? ' · ×2 ARMED' : ''}${this.sticky ? ' · 🍯' : ''}`);
  }

  storeTurn(x) { this.lastTurn = x; }

  dispose() {
    this.ctx.scene.remove(this.root, this.sky, this.flyer);
    this.ctx.scene.fog = null;
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }
}

export { AIR_SKILLS, POWERUPS, ROUNDS };
