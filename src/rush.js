// BANANA RUSH — 60-second arena collect-athon.
// Bananas respawn as you grab them, golden bunches appear on a timer, and
// arena power-ups (magnet / turbo / +time) keep the scramble spicy.
// Reuses the normal rolling engine: main.js runs its usual play loop with a
// generated arena level while this director handles spawning & scoring rules.
import * as THREE from 'three';
import { iconSprite } from './textures.js';
import { sfx } from './audio.js';

export const RUSH_TIME = 60;

// Arena level in the standard level-data format (world 0 theme = jungle).
export const RUSH_LEVEL = {
  world: 0, name: 'Banana Rush', time: RUSH_TIME, par: 0, isRush: true,
  start: { p: [0, 1, 0], ry: 0 },
  goal: { p: [0, -100, 0], ry: 0 },          // unreachable — rush has no goal gate
  parts: [
    { p: [0, 0, 0], s: [40, 0.6, 40], tex: 'floor', shape: 'disc' },
    // central spinner plate for chaos
    { p: [0, 0.62, 0], s: [9, 0.6, 9], tex: 'dots', anim: { type: 'spin', speed: 1 }, shape: 'disc' },
    // four ramps up to side pads holding golden spawns
    { p: [15, 0.8, 0], s: [6, 0.6, 5], rot: [0, 0, -0.28], tex: 'plank' },
    { p: [-15, 0.8, 0], s: [6, 0.6, 5], rot: [0, 0, 0.28], tex: 'plank' },
    { p: [0, 0.8, 15], s: [5, 0.6, 6], rot: [0.28, 0, 0], tex: 'plank' },
    { p: [0, 0.8, -15], s: [5, 0.6, 6], rot: [-0.28, 0, 0], tex: 'plank' },
    // low rim wall so you don't fly off constantly (gaps at diagonals!)
    { p: [14, 1, 14], s: [12, 1.4, 1], rot: [0, -Math.PI / 4, 0], tex: 'wall' },
    { p: [-14, 1, 14], s: [12, 1.4, 1], rot: [0, Math.PI / 4, 0], tex: 'wall' },
    { p: [14, 1, -14], s: [12, 1.4, 1], rot: [0, Math.PI / 4, 0], tex: 'wall' },
    { p: [-14, 1, -14], s: [12, 1.4, 1], rot: [0, -Math.PI / 4, 0], tex: 'wall' },
  ],
  bumpers: [
    { p: [8, 0.3, 8], r: 1 }, { p: [-8, 0.3, 8], r: 1 },
    { p: [8, 0.3, -8], r: 1 }, { p: [-8, 0.3, -8], r: 1 },
  ],
  bananas: [], bunches: [],
};

const SPOTS = (() => {
  // deterministic candidate spawn spots on the main plate + side pads
  const pts = [];
  for (let ring = 0; ring < 3; ring++) {
    const r = 5 + ring * 5;
    const n = 6 + ring * 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring;
      pts.push([Math.cos(a) * r, 1, Math.sin(a) * r]);
    }
  }
  pts.push([15, 2.6, 0], [-15, 2.6, 0], [0, 2.6, 15], [0, 2.6, -15]);
  return pts;
})();

const POWERS = [
  { id: 'magnet', icon: '🧲', name: 'MAGNET', dur: 5 },
  { id: 'turbo', icon: '🚀', name: 'TURBO', dur: 5 },
  { id: 'clock', icon: '⏰', name: '+5 SECONDS', dur: 0 },
];

export class RushDirector {
  // ctx: { stage, game G-ref accessors via callbacks: addTime(s), setTurbo(s), setMagnet(s), ui }
  constructor(ctx) {
    this.ctx = ctx;
    this.stage = ctx.stage;
    this.t = 0;
    this.nextGold = 8;
    this.nextPower = 5;
    this.powerups = [];
    this.combo = 0;
    this.comboT = 0;
    // seed the arena
    for (let i = 0; i < 14; i++) this.spawnBanana();
  }

  freeSpot() {
    for (let tries = 0; tries < 12; tries++) {
      const p = SPOTS[(Math.random() * SPOTS.length) | 0];
      const clash = this.stage.bananas.some(b => !b.taken && b.pos.distanceToSquared(new THREE.Vector3(...p)) < 4)
        || this.powerups.some(u => !u.taken && u.pos.distanceToSquared(new THREE.Vector3(...p)) < 4);
      if (!clash) return p;
    }
    return SPOTS[(Math.random() * SPOTS.length) | 0];
  }

  spawnBanana(big = false) {
    const p = this.freeSpot();
    // reuse a taken banana slot if possible (keeps arrays small)
    const dead = this.stage.bananas.find(b => b.taken && (b.value > 1) === big);
    if (dead) {
      dead.pos.set(p[0], p[1], p[2]);
      dead.mesh.position.copy(dead.pos);
      dead.mesh.visible = true;
      dead.taken = false;
      return dead;
    }
    // build via the stage's own banana factory path: clone an existing mesh style
    const proto = { pos: new THREE.Vector3(...p), taken: false, value: big ? 10 : 1, r: big ? 1.2 : 0.95 };
    const body = new THREE.Mesh(
      new THREE.TorusGeometry(big ? 0.42 : 0.3, big ? 0.16 : 0.11, 10, 18, Math.PI * 1.25),
      new THREE.MeshStandardMaterial({ color: big ? '#ffe14d' : '#ffd23d', roughness: 0.4, emissive: 0x664c00, emissiveIntensity: big ? 0.7 : 0.35 })
    );
    body.rotation.z = Math.PI * 0.9;
    const g = new THREE.Group();
    g.add(body);
    if (big) {
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.16 }));
      g.add(glow);
    }
    g.position.copy(proto.pos);
    this.stage.root.add(g);
    proto.mesh = g;
    this.stage.bananas.push(proto);
    return proto;
  }

  spawnPower() {
    const def = POWERS[(Math.random() * POWERS.length) | 0];
    const p = this.freeSpot();
    const g = new THREE.Group();
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.35, roughness: 0.1 })
    );
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconSprite(def.icon), transparent: true }));
    spr.scale.setScalar(1.3);
    spr.position.y = 0.2;
    g.add(orb, spr);
    g.position.set(p[0], p[1], p[2]);
    this.stage.root.add(g);
    this.powerups.push({ def, pos: new THREE.Vector3(...p), mesh: g, taken: false, life: 10 });
  }

  // called by main every play frame during rush
  update(dt, ballPos) {
    this.t += dt;
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;

    if (this.t >= this.nextGold) {
      this.nextGold += 9;
      const b = this.spawnBanana(true);
      b.expires = this.t + 6;
      this.ctx.ui.flashMessage('GOLDEN BUNCH!', 900);
      sfx.ready();
    }
    if (this.t >= this.nextPower) {
      this.nextPower += 7;
      this.spawnPower();
    }
    // expire golden bunches
    for (const b of this.stage.bananas) {
      if (!b.taken && b.expires && this.t > b.expires) { b.taken = true; b.mesh.visible = false; b.expires = 0; }
    }
    // powerup pickup & expiry
    for (const u of this.powerups) {
      if (u.taken) continue;
      u.life -= dt;
      u.mesh.rotation.y += dt * 2;
      if (u.life <= 0) { u.taken = true; u.mesh.visible = false; continue; }
      if (u.pos.distanceTo(ballPos) < 1.4) {
        u.taken = true; u.mesh.visible = false;
        sfx.bunch();
        this.ctx.ui.flashMessage(u.def.name + '!', 900);
        if (u.def.id === 'magnet') this.ctx.setMagnet(u.def.dur);
        if (u.def.id === 'turbo') this.ctx.setTurbo(u.def.dur);
        if (u.def.id === 'clock') this.ctx.addTime(5);
      }
    }
  }

  // called by main when a banana is collected during rush -> returns bonus points
  onBananaCollected(banana) {
    this.combo++;
    this.comboT = 2.5;
    // respawn a regular banana shortly after (keep the floor stocked)
    if (banana.value === 1) this.spawnBanana();
    const comboBonus = this.combo >= 4 ? this.combo : 0;
    if (comboBonus) this.ctx.ui.flashMessage(`COMBO ×${this.combo}!`, 500);
    return comboBonus;
  }
}
