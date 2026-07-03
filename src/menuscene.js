// The living menu diorama: every rascal is on stage doing something —
// rolling laps in their balls, bouncing on a bumper, showing off, getting
// dizzy, chasing a runaway banana. Plays behind all menu screens.
import * as THREE from 'three';
import { CHARACTERS, buildCharacterMesh, animateCharacter } from './characters.js';
import { jungleTexture, checkerTexture, skyTexture, dotTexture } from './textures.js';
import { BALL_RADIUS } from './physics.js';

const _v = new THREE.Vector3();

function makeShell(color) {
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 24, 18),
    new THREE.MeshPhysicalMaterial({
      color, transparent: true, opacity: 0.3, roughness: 0.05,
      clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide
    })
  );
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 });
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS, 0.012, 6, 40), ringMat);
  const r2 = r1.clone();
  r2.rotation.y = Math.PI / 2;
  shell.add(r1, r2);
  return shell;
}

export class MenuScene {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.t0 = 0;
    this.actors = [];
    this.focusId = null;

    // sky & fog
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(260, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTexture('#2b1d5e', '#7a5fd0', '#ffb6d9'), side: THREE.BackSide, fog: false })
    );
    scene.add(this.sky);
    scene.fog = new THREE.Fog(new THREE.Color('#5b48a8'), 55, 190);

    // main island
    const ground = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 18, 2.4, 48),
      new THREE.MeshStandardMaterial({ map: jungleTexture(6), roughness: 0.85 })
    );
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    this.root.add(ground);

    // racing ring track painted on top
    const track = new THREE.Mesh(
      new THREE.RingGeometry(8.6, 11.4, 48),
      new THREE.MeshStandardMaterial({ map: checkerTexture('#c98a2b', '#ffd23d', 12), roughness: 0.7 })
    );
    track.rotation.x = -Math.PI / 2;
    track.position.y = 0.01;
    this.root.add(track);

    // center podium for the character preview
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 3, 0.8, 32),
      new THREE.MeshStandardMaterial({ map: dotTexture('#3a8fd6', '#9fd0ff', 3), roughness: 0.5 })
    );
    podium.position.y = 0.4;
    this.root.add(podium);

    // floating islands with palms
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = 34 + (i % 3) * 12;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = -4 + ((i * 37) % 10);
      const islet = new THREE.Mesh(
        new THREE.SphereGeometry(2.5 + (i % 3), 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x2c8a3e, roughness: 1 })
      );
      islet.position.set(x, y, z);
      islet.scale.y = 0.5;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 4, 8), new THREE.MeshStandardMaterial({ color: 0x8a5a2b }));
      trunk.position.set(x, y + 2.4, z);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x37a44c }));
      crown.position.set(x, y + 5, z);
      this.root.add(islet, trunk, crown);
      islet.userData.floatSeed = i;
      (this.floaters = this.floaters || []).push({ mesh: islet, extra: [trunk, crown], baseY: y, seed: i * 1.7 });
    }

    // spinning bananas scattered on the island
    this.bananas = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.5;
      const r = 4.5 + (i % 4);
      const body = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.11, 8, 16, Math.PI * 1.25),
        new THREE.MeshStandardMaterial({ color: '#ffd23d', roughness: 0.4, emissive: 0x664c00, emissiveIntensity: 0.4 })
      );
      body.rotation.z = Math.PI * 0.9;
      body.position.set(Math.cos(a) * r, 0.8, Math.sin(a) * r);
      this.root.add(body);
      this.bananas.push(body);
    }

    // ---- cast the whole roster ----
    // 4 racers lap the ring in their balls
    const racers = ['marco', 'zippy', 'lonk', 'chonko'];
    racers.forEach((id, i) => {
      const char = CHARACTERS.find(c => c.id === id);
      const built = buildCharacterMesh(id);
      built.group.scale.setScalar(0.62);
      built.group.position.y = -BALL_RADIUS * 0.82;
      const shell = makeShell(char.ballColor);
      const g = new THREE.Group();
      g.add(shell, built.group);
      this.root.add(g);
      this.actors.push({
        kind: 'racer', id, group: g, built, shell,
        phase: (i / racers.length) * Math.PI * 2,
        speed: 0.5 + (char.stats.speed / 10) * 0.35,
        radius: 10
      });
    });
    // Puffboy bounces on a bumper
    {
      const built = buildCharacterMesh('puffboy');
      built.group.scale.setScalar(0.9);
      const bumper = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1.15, 0.8, 20),
        new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.35, emissive: 0x550011, emissiveIntensity: 0.6 })
      );
      bumper.position.set(-5.5, 0.4, 3.5);
      this.root.add(bumper, built.group);
      this.actors.push({ kind: 'bouncer', id: 'puffboy', built, group: built.group, base: new THREE.Vector3(-5.5, 0.9, 3.5) });
    }
    // Peacho twirls with her parasol
    {
      const built = buildCharacterMesh('peacho');
      built.group.scale.setScalar(0.9);
      built.group.position.set(5.5, 0, 4);
      this.root.add(built.group);
      this.actors.push({ kind: 'dancer', id: 'peacho', built, group: built.group });
    }
    // Sparkle is dizzy from too much voltage
    {
      const built = buildCharacterMesh('sparkle');
      built.group.scale.setScalar(0.9);
      built.group.position.set(-6, 0, -3.5);
      this.root.add(built.group);
      this.actors.push({ kind: 'dizzy', id: 'sparkle', built, group: built.group });
    }
    // Waka chases a runaway banana in circles
    {
      const built = buildCharacterMesh('waka');
      built.group.scale.setScalar(0.9);
      const prey = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.13, 8, 16, Math.PI * 1.25),
        new THREE.MeshStandardMaterial({ color: '#ffe14d', roughness: 0.4, emissive: 0x664c00, emissiveIntensity: 0.5 })
      );
      prey.rotation.z = Math.PI * 0.9;
      this.root.add(built.group, prey);
      this.actors.push({ kind: 'chaser', id: 'waka', built, group: built.group, prey, radius: 5.2 });
    }

    // preview slot (filled by focusCharacter)
    this.preview = null;
  }

  focusCharacter(id) {
    if (this.focusId === id) return;
    this.focusId = id;
    if (this.preview) {
      this.root.remove(this.preview.group);
      this.preview = null;
    }
    if (!id) return;
    const char = CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
    const built = buildCharacterMesh(id);
    built.group.scale.setScalar(1.7);
    built.group.position.set(0, 1.3, 0);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 16, 12),
      new THREE.MeshBasicMaterial({ color: char.ballColor, transparent: true, opacity: 0.12 })
    );
    glow.position.y = 2;
    const g = new THREE.Group();
    g.add(built.group, glow);
    this.root.add(g);
    this.preview = { group: g, built, glow };
  }

  update(dt, t, camera, orbit) {
    // actors
    for (const a of this.actors) {
      if (a.kind === 'racer') {
        const ang = t * a.speed + a.phase;
        const x = Math.cos(ang) * a.radius, z = Math.sin(ang) * a.radius;
        a.group.position.set(x, BALL_RADIUS, z);
        // face travel direction (tangent)
        const heading = Math.atan2(-Math.sin(ang), -Math.cos(ang)) + Math.PI / 2;
        a.built.group.rotation.y = Math.atan2(-Math.sin(ang + 0.1) * a.radius - x, -Math.cos(ang + 0.1) * a.radius - z);
        a.shell.rotation.x += a.speed * a.radius * dt / BALL_RADIUS * 0.35;
        animateCharacter(a.built, t, 'roll', a.speed * a.radius);
      } else if (a.kind === 'bouncer') {
        const cycle = (t * 1.4) % 2;
        const h = Math.abs(Math.sin(cycle * Math.PI)) * 2.2;
        a.group.position.set(a.base.x, a.base.y + h, a.base.z);
        animateCharacter(a.built, t, h > 0.4 ? 'air' : 'idle', 0);
      } else if (a.kind === 'dancer') {
        a.group.rotation.y = t * 1.2;
        animateCharacter(a.built, t, 'win', 0);
      } else if (a.kind === 'dizzy') {
        animateCharacter(a.built, t, 'dizzy', 0);
        a.group.rotation.y = Math.sin(t * 2) * 0.8;
      } else if (a.kind === 'chaser') {
        const ang = t * 1.1;
        const x = Math.cos(ang) * a.radius, z = Math.sin(ang) * a.radius - 0.5;
        a.group.position.set(x, 0, z);
        a.group.rotation.y = ang + Math.PI;   // face along the chase
        const pAng = ang + 0.55;
        a.prey.position.set(Math.cos(pAng) * a.radius, 0.5 + Math.abs(Math.sin(t * 6)) * 0.3, Math.sin(pAng) * a.radius - 0.5);
        a.prey.rotation.y = t * 3;
        animateCharacter(a.built, t, 'roll', 8);
      }
    }
    // bananas idle-spin
    for (const b of this.bananas) {
      b.rotation.y = t * 2.2;
      b.position.y = 0.8 + Math.sin(t * 2.5 + b.position.x) * 0.12;
    }
    // floating islands bob
    if (this.floaters) {
      for (const f of this.floaters) {
        const off = Math.sin(t * 0.5 + f.seed) * 0.8;
        f.mesh.position.y = f.baseY + off;
        f.extra[0].position.y = f.baseY + 2.4 + off;
        f.extra[1].position.y = f.baseY + 5 + off;
      }
    }
    // preview pedestal spin & celebrate
    if (this.preview) {
      this.preview.group.rotation.y = t * 0.9;
      this.preview.glow.material.opacity = 0.09 + Math.sin(t * 3) * 0.05;
      animateCharacter(this.preview.built, t, 'win', 0);
    }

    // camera: slow cinematic orbit; pull in tighter when previewing a rascal
    const focus = !!this.preview;
    const r = focus ? 9 : 21;
    const h = focus ? 3.6 : 9;
    const speed = focus ? 0.12 : 0.07;
    const ang = orbit + t * speed;
    camera.position.lerp(_v.set(Math.cos(ang) * r, h + Math.sin(t * 0.4) * 0.6, Math.sin(ang) * r), Math.min(1, dt * 2.2));
    if (focus) {
      // shift the look target sideways so the podium star shows at the screen
      // edge instead of hiding behind the menu cards
      const rx = -Math.sin(ang), rz = Math.cos(ang);   // camera-right on the orbit circle
      camera.lookAt(rx * 4.4, 2.3, rz * 4.4);
    } else {
      camera.lookAt(0, 0.8, 0);
    }
  }

  dispose() {
    this.scene.remove(this.root, this.sky);
    this.scene.fog = null;
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }
}
