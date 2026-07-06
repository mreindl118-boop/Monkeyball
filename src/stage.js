// Builds a playable stage from level data: meshes, physics solids, bananas,
// bumpers, launch pads, goal gate, sky dome and themed decorations.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { checkerTexture, stripeTexture, dotTexture, gridTexture, lavaTexture, jungleTexture, goalTexture, skyTexture, normalMapFor } from './textures.js';

const _v = new THREE.Vector3();

// molded-plastic edges: rounded box cached per unique size so we don't
// rebuild identical geometry (chamfered corners catch a specular highlight
// and kill the razor-sharp "stacked cardboard" silhouette)
const _roundedCache = new Map();
function roundedBox(w, h, d) {
  const key = `${w.toFixed(2)}_${h.toFixed(2)}_${d.toFixed(2)}`;
  let g = _roundedCache.get(key);
  if (!g) {
    const r = Math.min(0.35, Math.min(w, h, d) * 0.18);
    g = new RoundedBoxGeometry(w, h, d, 2, r);
    _roundedCache.set(key, g);
  }
  return g;
}

function texFor(kind, world) {
  switch (kind) {
    case 'floor':
      if (world.id === 'jungle') return jungleTexture(3);
      if (world.id === 'sky') return dotTexture('#5a4bb8', '#8f7ad6', 3);
      return gridTexture('#3a1010', '#ff7b1c', 4);
    case 'wall': return stripeTexture('#e34242', '#ffffff', 3);
    case 'plank': return checkerTexture('#c98a2b', '#ffd23d', 3);
    case 'dots': return dotTexture('#3a8fd6', '#9fd0ff', 4);
    case 'lava': return lavaTexture(3);
    case 'jungle': return jungleTexture(3);
    default: return checkerTexture();
  }
}

export class Stage {
  constructor(scene, level, world, atmosphere) {
    this.scene = scene;
    this.level = level;
    this.world = world;
    this.atmosphere = atmosphere;
    this.root = new THREE.Group();       // tilts visually with input
    scene.add(this.root);
    this.solids = [];
    this.bananas = [];
    this.pads = [];
    this.bumpers = [];
    this.fallY = -17;
    this.time = 0;

    this.buildParts();
    this.buildBananas();
    this.buildBumpers();
    this.buildPads();
    this.buildGoal();
    this.applyAtmosphere();
    this.buildDecor();
  }

  buildParts() {
    for (const part of this.level.parts) {
      const tex = texFor(part.tex || 'floor', this.world);
      const mat = new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.72, metalness: 0.04,
        normalMap: normalMapFor(tex), envMapIntensity: 1.15
      });
      if (mat.normalMap) mat.normalScale.set(0.7, 0.7);
      if (this.world.id === 'volcano') {
        // the course glows in the volcanic night so it stays readable
        mat.emissive = new THREE.Color(0xffffff);
        mat.emissiveMap = tex;
        mat.emissiveIntensity = (part.tex || 'floor') === 'floor' ? 0.85 : 0.45;
      }
      let mesh, half;
      const s = part.s;
      if (part.shape === 'disc') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(s[0] / 2, s[0] / 2, s[1], 48), mat);
        half = new THREE.Vector3(s[0] / 2, s[1] / 2, s[0] / 2);
      } else {
        mesh = new THREE.Mesh(roundedBox(s[0], s[1], s[2]), mat);
        half = new THREE.Vector3(s[0] / 2, s[1] / 2, s[2] / 2);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const basePos = new THREE.Vector3(...part.p);
      const baseQuat = new THREE.Quaternion();
      if (part.rot) baseQuat.setFromEuler(new THREE.Euler(part.rot[0] || 0, part.rot[1] || 0, part.rot[2] || 0));
      mesh.position.copy(basePos);
      mesh.quaternion.copy(baseQuat);
      this.root.add(mesh);

      const solid = {
        mesh, half, basePos, baseQuat,
        pos: basePos.clone(),
        quat: baseQuat.clone(),
        shape: part.shape === 'disc' ? 'disc' : 'box',
        anim: part.anim || null,
        angVelY: 0,
        linVel: new THREE.Vector3(),
        velAt: (point, out) => {
          out.copy(solid.linVel);
          if (solid.angVelY) {
            // v = ω × r, ω = (0, angVelY, 0)
            const rx = point.x - solid.pos.x;
            const rz = point.z - solid.pos.z;
            out.x += -solid.angVelY * rz;
            out.z += solid.angVelY * rx;
          }
          return out;
        }
      };
      this.solids.push(solid);
    }
  }

  buildBananas() {
    const singles = this.level.bananas || [];
    const bunches = this.level.bunches || [];
    const mkBanana = (big) => {
      const g = new THREE.Group();
      const col = big ? '#ffe14d' : '#ffd23d';
      const body = new THREE.Mesh(
        new THREE.TorusGeometry(big ? 0.42 : 0.3, big ? 0.16 : 0.11, 10, 18, Math.PI * 1.25),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, emissive: 0x664c00, emissiveIntensity: 0.35 })
      );
      body.rotation.z = Math.PI * 0.9;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.1 : 0.07, 8, 8), new THREE.MeshStandardMaterial({ color: '#6b4a2b' }));
      tip.position.set(big ? 0.34 : 0.24, big ? 0.32 : 0.23, 0);
      g.add(body, tip);
      if (big) {
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.12 }));
        g.add(glow);
      }
      return g;
    };
    for (const p of singles) {
      const mesh = mkBanana(false);
      mesh.position.set(p[0], p[1], p[2]);
      this.root.add(mesh);
      this.bananas.push({ pos: new THREE.Vector3(...p), mesh, taken: false, value: 1, r: 0.9 });
    }
    for (const p of bunches) {
      const mesh = mkBanana(true);
      mesh.position.set(p[0], p[1], p[2]);
      this.root.add(mesh);
      this.bananas.push({ pos: new THREE.Vector3(...p), mesh, taken: false, value: 10, r: 1.1 });
    }
  }

  buildBumpers() {
    for (const b of (this.level.bumpers || [])) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(b.r, b.r * 1.15, 0.9, 24),
        new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.35, emissive: 0x550011, emissiveIntensity: 0.6 })
      );
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(b.r, 0.09, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.28;
      g.add(body, ring);
      g.position.set(b.p[0], b.p[1] + 0.45, b.p[2]);
      this.root.add(g);
      this.bumpers.push({ pos: new THREE.Vector3(b.p[0], b.p[1] + 0.45, b.p[2]), r: b.r, mesh: g, flash: 0 });
    }
  }

  buildPads() {
    for (const pd of (this.level.pads || [])) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(pd.s[0] / 2, pd.s[0] / 2 + 0.2, 0.25, 24),
        new THREE.MeshStandardMaterial({ color: 0x36d97a, roughness: 0.4, emissive: 0x0a5527, emissiveIntensity: 0.8 })
      );
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 1.1, 12),
        new THREE.MeshStandardMaterial({ color: 0xb9ffdb, emissive: 0x36d97a, emissiveIntensity: 0.7 })
      );
      arrow.position.y = 0.9;
      g.add(base, arrow);
      g.position.set(pd.p[0], pd.p[1], pd.p[2]);
      this.root.add(g);
      this.pads.push({
        pos: new THREE.Vector3(...pd.p),
        dir: new THREE.Vector3(...pd.dir),
        half: new THREE.Vector2(pd.s[0] / 2, pd.s[1] / 2),
        mesh: g, arrow, cooldown: 0
      });
    }
  }

  buildGoal() {
    const gl = this.level.goal;
    const g = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a63c4, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 12), postMat);
      post.position.set(s * 1.9, 1.6, 0);
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.34, 0.34), postMat);
    bar.position.y = 3.2;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 0.8),
      new THREE.MeshBasicMaterial({ map: goalTexture(), side: THREE.DoubleSide })
    );
    banner.position.y = 2.6;
    const shimmer = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 2.1),
      new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    shimmer.position.y = 1.1;
    g.add(bar, banner, shimmer);
    g.position.set(gl.p[0], gl.p[1], gl.p[2]);
    g.rotation.y = gl.ry || 0;
    this.root.add(g);
    this.goalMesh = g;
    this.goalShimmer = shimmer;
    this.goalPos = new THREE.Vector3(...gl.p);
    this.goalRy = gl.ry || 0;
  }

  // ball crosses the gate plane inside the posts
  checkGoal(ballPos) {
    _v.copy(ballPos).sub(this.goalPos);
    const cos = Math.cos(-this.goalRy), sin = Math.sin(-this.goalRy);
    const lx = _v.x * cos - _v.z * sin;
    const lz = _v.x * sin + _v.z * cos;
    return Math.abs(lx) < 1.9 && Math.abs(lz) < 0.75 && _v.y > -0.5 && _v.y < 3.2;
  }

  applyAtmosphere() {
    if (!this.atmosphere) return;
    this.atmosphere.setPreset(this.world.tod || 'noon');
    this.atmosphere.setFogRange(60, 210);
  }

  buildDecor() {
    const rng = (i, m) => ((i * 2654435761) % m) / m; // deterministic pseudo-random
    this.decor = new THREE.Group();
    if (this.world.id === 'jungle') {
      // palm-ish trees on floating islets
      for (let i = 0; i < 14; i++) {
        const a = rng(i + 3, 100) * Math.PI * 2;
        const r = 40 + rng(i + 7, 100) * 60;
        const x = Math.cos(a) * r, z = Math.sin(a) * r - 20;
        const y = -6 + rng(i + 11, 100) * 10;
        const islet = new THREE.Mesh(new THREE.SphereGeometry(3 + rng(i, 100) * 3, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2c8a3e, roughness: 1 }));
        islet.position.set(x, y, z);
        islet.scale.y = 0.5;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 5, 8), new THREE.MeshStandardMaterial({ color: 0x8a5a2b }));
        trunk.position.set(x, y + 3, z);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0x37a44c }));
        crown.position.set(x, y + 6.2, z);
        this.decor.add(islet, trunk, crown);
      }
    } else if (this.world.id === 'sky') {
      this.clouds = [];
      for (let i = 0; i < 18; i++) {
        const cl = new THREE.Group();
        for (let j = 0; j < 4; j++) {
          const puff = new THREE.Mesh(new THREE.SphereGeometry(2 + rng(i * 5 + j, 100) * 2, 8, 6),
            new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 }));
          puff.position.set(j * 2.4 - 3.6, rng(i + j, 100), rng(i * 3 + j, 100) * 2);
          cl.add(puff);
        }
        const a = rng(i + 1, 100) * Math.PI * 2;
        const r = 45 + rng(i + 9, 100) * 70;
        cl.position.set(Math.cos(a) * r, -10 + rng(i + 4, 100) * 30, Math.sin(a) * r - 25);
        this.decor.add(cl);
        this.clouds.push({ mesh: cl, speed: 0.4 + rng(i, 100) * 0.8 });
      }
    } else {
      // volcano: lava sea below + dark crags
      const lava = new THREE.Mesh(
        new THREE.PlaneGeometry(500, 500),
        new THREE.MeshBasicMaterial({ map: lavaTexture(24) })
      );
      lava.rotation.x = -Math.PI / 2;
      lava.position.y = -16;
      this.decor.add(lava);
      this.lavaMat = lava.material;
      // flickering lava uplights along the course
      this.flickers = [];
      const span = this.level.goal.p[2];
      for (let i = 0; i < 3; i++) {
        const pl = new THREE.PointLight(0xff6a1c, 2.2, 55, 1.6);
        pl.position.set(0, 2.5, (span / 3) * i - 4);
        this.decor.add(pl);
        this.flickers.push({ light: pl, seed: i * 2.7 });
      }
      for (let i = 0; i < 12; i++) {
        const a = rng(i + 2, 100) * Math.PI * 2;
        const r = 50 + rng(i + 6, 100) * 70;
        const crag = new THREE.Mesh(
          new THREE.ConeGeometry(4 + rng(i, 100) * 6, 18 + rng(i + 8, 100) * 18, 7),
          new THREE.MeshStandardMaterial({ color: 0x2a1616, roughness: 1 })
        );
        crag.position.set(Math.cos(a) * r, -14, Math.sin(a) * r - 25);
        this.decor.add(crag);
      }
    }
    this.scene.add(this.decor);
  }

  update(t, dt) {
    this.time = t;
    // animated solids
    for (const s of this.solids) {
      if (!s.anim) continue;
      const a = s.anim;
      if (a.type === 'slide') {
        const ph = (a.phase || 0);
        const off = Math.sin(t * a.speed + ph) * a.amp;
        const dOff = Math.cos(t * a.speed + ph) * a.amp * a.speed;
        s.pos.copy(s.basePos).addScaledVector(_v.set(a.axis[0], a.axis[1], a.axis[2]), off);
        s.linVel.set(a.axis[0] * dOff, a.axis[1] * dOff, a.axis[2] * dOff);
        s.mesh.position.copy(s.pos);
      } else if (a.type === 'spin') {
        s.angVelY = a.speed;
        s.mesh.rotation.y = t * a.speed;
        // physics shape is rotationally symmetric (disc), so quat stays identity
      } else if (a.type === 'orbit') {
        const ang = t * a.speed + (a.phase || 0);
        s.pos.set(a.center[0] + Math.cos(ang) * a.radius, a.center[1], a.center[2] + Math.sin(ang) * a.radius);
        s.linVel.set(-Math.sin(ang) * a.radius * a.speed, 0, Math.cos(ang) * a.radius * a.speed);
        s.mesh.position.copy(s.pos);
      }
    }
    // bananas idle spin & bob
    for (const b of this.bananas) {
      if (b.taken) continue;
      b.mesh.rotation.y = t * 2.4;
      b.mesh.position.y = b.pos.y + Math.sin(t * 3 + b.pos.x) * 0.12;
    }
    // pads pulse
    for (const p of this.pads) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.arrow.position.y = 0.9 + Math.sin(t * 5) * 0.15;
      p.mesh.rotation.y = t * 1.2;
    }
    // bumper flash decay
    for (const b of this.bumpers) {
      if (b.flash > 0) {
        b.flash -= dt * 3;
        b.mesh.scale.setScalar(1 + Math.max(0, b.flash) * 0.25);
      }
    }
    // goal shimmer
    if (this.goalShimmer) this.goalShimmer.material.opacity = 0.16 + Math.sin(t * 4) * 0.08;
    // clouds drift
    if (this.clouds) for (const c of this.clouds) c.mesh.position.x += Math.sin(t * 0.1) * c.speed * dt;
    if (this.lavaMat) this.lavaMat.map.offset.set(Math.sin(t * 0.08) * 0.3, t * 0.006);
    if (this.flickers) {
      for (const f of this.flickers) {
        f.light.intensity = 2.0 + Math.sin(t * 9 + f.seed) * 0.5 + Math.sin(t * 23 + f.seed * 3) * 0.3;
      }
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this.decor);
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }
}
