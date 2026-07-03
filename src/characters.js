// The Rascal Roster — loving parodies with unique stats & abilities.
// Every character mesh is built procedurally from primitives and is fully animated
// (idle bob, limb swing while rolling, celebrate & dizzy poses).
import * as THREE from 'three';

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08, ...opts });
}

function sphere(r, color, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), mat(color));
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

function box(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.castShadow = true;
  return m;
}

function eyePair(group, r, x, y, z, iris = '#222') {
  for (const s of [-1, 1]) {
    const white = sphere(r, '#ffffff');
    white.position.set(s * x, y, z);
    const pupil = sphere(r * 0.5, iris);
    pupil.position.set(s * x, y, z + r * 0.62);
    group.add(white, pupil);
  }
}

// Each builder returns { group, limbs:{...}, head } so the animator can move parts.
const BUILDERS = {
  // ---- Marco: mustachioed plumber monkey (balanced hero) ----
  marco() {
    const g = new THREE.Group();
    const body = sphere(0.34, '#e23b3b', 1, 1.06, 0.95);
    body.position.y = 0.34;
    const belly = sphere(0.24, '#3b53c9', 1, 0.9, 0.72);
    belly.position.set(0, 0.26, 0.14);
    const head = new THREE.Group();
    head.position.y = 0.78;
    const skull = sphere(0.26, '#f3c089');
    const cap = sphere(0.27, '#e23b3b', 1, 0.62, 1);
    cap.position.y = 0.1;
    const brim = box(0.3, 0.05, 0.22, '#c92f2f');
    brim.position.set(0, 0.06, 0.24);
    const stache = box(0.3, 0.07, 0.08, '#4a2c14');
    stache.position.set(0, -0.06, 0.22);
    const nose = sphere(0.08, '#f0a568');
    nose.position.set(0, 0.0, 0.26);
    head.add(skull, cap, brim, stache, nose);
    eyePair(head, 0.055, 0.1, 0.06, 0.2);
    const limbs = {};
    for (const [name, sx] of [['armL', -1], ['armR', 1]]) {
      const arm = sphere(0.1, '#e23b3b', 1, 1.7, 1);
      arm.position.set(sx * 0.36, 0.42, 0);
      limbs[name] = arm; g.add(arm);
    }
    for (const [name, sx] of [['legL', -1], ['legR', 1]]) {
      const leg = sphere(0.11, '#3b53c9', 1, 1.5, 1);
      leg.position.set(sx * 0.16, 0.05, 0);
      limbs[name] = leg; g.add(leg);
    }
    const tail = sphere(0.07, '#8a5a2b', 1, 1, 2.4);
    tail.position.set(0, 0.3, -0.34);
    limbs.tail = tail;
    g.add(body, belly, head, tail);
    return { group: g, head, limbs };
  },

  // ---- Zippy: blue blur hedgefox (speed demon) ----
  zippy() {
    const g = new THREE.Group();
    const body = sphere(0.32, '#2464e0', 1, 1.05, 1);
    body.position.y = 0.36;
    const belly = sphere(0.2, '#f7d7a8', 1, 0.85, 0.6);
    belly.position.set(0, 0.3, 0.18);
    const head = new THREE.Group();
    head.position.y = 0.8;
    const skull = sphere(0.25, '#2464e0');
    const muzzle = sphere(0.12, '#f7d7a8', 1.15, 0.8, 1);
    muzzle.position.set(0, -0.05, 0.19);
    head.add(skull, muzzle);
    eyePair(head, 0.06, 0.1, 0.07, 0.19, '#0a3f14');
    // spikes
    const limbs = {};
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 10), mat('#1a4db3'));
      sp.position.set(0, 0.82 - i * 0.14, -0.24 - i * 0.05);
      sp.rotation.x = -Math.PI / 2.4 - i * 0.16;
      limbs['spike' + i] = sp;
      g.add(sp);
    }
    for (const [name, sx] of [['armL', -1], ['armR', 1]]) {
      const arm = sphere(0.09, '#f7d7a8', 1, 1.6, 1);
      arm.position.set(sx * 0.33, 0.44, 0.04);
      limbs[name] = arm; g.add(arm);
    }
    for (const [name, sx] of [['legL', -1], ['legR', 1]]) {
      const leg = sphere(0.1, '#e23b3b', 1, 1.5, 1.3);
      leg.position.set(sx * 0.15, 0.06, 0.03);
      limbs[name] = leg; g.add(leg);
    }
    g.add(body, belly, head);
    return { group: g, head, limbs };
  },

  // ---- Puffboy: round pink glutton (floaty) ----
  puffboy() {
    const g = new THREE.Group();
    const body = sphere(0.4, '#ff9ec7');
    body.position.y = 0.42;
    const head = new THREE.Group(); // face is on the body
    head.position.y = 0.42;
    eyePair(head, 0.07, 0.13, 0.12, 0.32, '#12336b');
    const mouth = sphere(0.06, '#8c1d40', 1.4, 1, 0.5);
    mouth.position.set(0, -0.05, 0.39);
    head.add(mouth);
    const blushL = sphere(0.05, '#ff5f9e', 1.4, 0.8, 0.4);
    blushL.position.set(-0.24, 0.0, 0.3);
    const blushR = blushL.clone();
    blushR.position.x = 0.24;
    head.add(blushL, blushR);
    const limbs = {};
    for (const [name, sx] of [['armL', -1], ['armR', 1]]) {
      const arm = sphere(0.12, '#ff9ec7', 1.2, 1, 1);
      arm.position.set(sx * 0.4, 0.46, 0.05);
      limbs[name] = arm; g.add(arm);
    }
    for (const [name, sx] of [['legL', -1], ['legR', 1]]) {
      const leg = sphere(0.13, '#d6336c', 1.1, 0.9, 1.4);
      leg.position.set(sx * 0.17, 0.08, 0.02);
      limbs[name] = leg; g.add(leg);
    }
    g.add(body, head);
    return { group: g, head, limbs };
  },

  // ---- Lonk: the Hero of Thyme (shield specialist) ----
  lonk() {
    const g = new THREE.Group();
    const body = sphere(0.3, '#3f9e4d', 1, 1.15, 0.9);
    body.position.y = 0.36;
    const belt = box(0.4, 0.08, 0.32, '#6b4a2b');
    belt.position.y = 0.28;
    const head = new THREE.Group();
    head.position.y = 0.8;
    const skull = sphere(0.24, '#f3c089');
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 14), mat('#2f8a3d'));
    hat.position.set(0, 0.24, -0.06);
    hat.rotation.x = -0.5;
    const hair = sphere(0.2, '#e8c14d', 1.15, 0.5, 1);
    hair.position.set(0, 0.1, 0);
    // pointy ears
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 8), mat('#f3c089'));
      ear.position.set(s * 0.24, 0.02, -0.02);
      ear.rotation.z = s * -Math.PI / 2.3;
      head.add(ear);
    }
    head.add(skull, hair, hat);
    eyePair(head, 0.05, 0.09, 0.03, 0.19, '#1a4db3');
    const limbs = {};
    const shield = new THREE.Group();
    const shieldBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.05, 12), mat('#3a63c4', { metalness: 0.5, roughness: 0.3 }));
    shieldBase.rotation.x = Math.PI / 2;
    const boss = sphere(0.05, '#e8c14d');
    boss.position.z = 0.04;
    shield.add(shieldBase, boss);
    shield.position.set(-0.36, 0.44, 0.1);
    limbs.armL = shield;
    const sword = new THREE.Group();
    const blade = box(0.05, 0.34, 0.05, '#cfd8e8');
    blade.position.y = 0.2;
    const hilt = box(0.14, 0.04, 0.06, '#e8c14d');
    sword.add(blade, hilt);
    sword.position.set(0.38, 0.46, 0.06);
    sword.rotation.z = -0.4;
    limbs.armR = sword;
    for (const [name, sx] of [['legL', -1], ['legR', 1]]) {
      const leg = sphere(0.1, '#8a5a2b', 1, 1.5, 1.2);
      leg.position.set(sx * 0.14, 0.06, 0);
      limbs[name] = leg; g.add(leg);
    }
    g.add(body, belt, head, shield, sword);
    return { group: g, head, limbs };
  },

  // ---- Sparkle: electric gerbil (banana magnet) ----
  sparkle() {
    const g = new THREE.Group();
    const body = sphere(0.33, '#ffd23d', 1, 1.02, 0.95);
    body.position.y = 0.36;
    const head = new THREE.Group();
    head.position.y = 0.76;
    const skull = sphere(0.24, '#ffd23d');
    head.add(skull);
    eyePair(head, 0.055, 0.1, 0.05, 0.19);
    const cheekL = sphere(0.06, '#e0442a');
    cheekL.position.set(-0.17, -0.04, 0.16);
    const cheekR = cheekL.clone();
    cheekR.position.x = 0.17;
    head.add(cheekL, cheekR);
    // zigzag lightning tail
    const limbs = {};
    const tail = new THREE.Group();
    const seg1 = box(0.08, 0.22, 0.04, '#ffe14d');
    seg1.position.y = 0.1;
    seg1.rotation.z = 0.6;
    const seg2 = box(0.08, 0.22, 0.04, '#ffe14d');
    seg2.position.set(-0.1, 0.27, 0);
    seg2.rotation.z = -0.6;
    const seg3 = box(0.1, 0.24, 0.04, '#ffe14d');
    seg3.position.set(0.0, 0.44, 0);
    seg3.rotation.z = 0.5;
    tail.add(seg1, seg2, seg3);
    tail.position.set(0, 0.3, -0.3);
    limbs.tail = tail;
    // pointy ears with dark tips
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 8), mat('#ffd23d'));
      ear.position.set(s * 0.15, 0.28, -0.02);
      ear.rotation.z = s * -0.35;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 8), mat('#3a2a10'));
      tip.position.set(s * 0.2, 0.4, -0.02);
      tip.rotation.z = s * -0.35;
      head.add(ear, tip);
    }
    for (const [name, sx] of [['armL', -1], ['armR', 1]]) {
      const arm = sphere(0.08, '#ffd23d', 1, 1.5, 1);
      arm.position.set(sx * 0.33, 0.42, 0.04);
      limbs[name] = arm; g.add(arm);
    }
    for (const [name, sx] of [['legL', -1], ['legR', 1]]) {
      const leg = sphere(0.1, '#f0b429', 1, 1.3, 1.3);
      leg.position.set(sx * 0.14, 0.06, 0);
      limbs[name] = leg; g.add(leg);
    }
    g.add(body, head, tail);
    return { group: g, head, limbs };
  },

  // ---- Chonko: barrel-chested ape (heavyweight) ----
  chonko() {
    const g = new THREE.Group();
    const body = sphere(0.4, '#6b4226', 1.05, 1, 0.95);
    body.position.y = 0.4;
    const chest = sphere(0.28, '#c89a6b', 1, 0.85, 0.6);
    chest.position.set(0, 0.36, 0.22);
    const head = new THREE.Group();
    head.position.y = 0.86;
    const skull = sphere(0.24, '#6b4226');
    const face = sphere(0.17, '#c89a6b', 1.1, 0.95, 0.7);
    face.position.set(0, -0.04, 0.14);
    head.add(skull, face);
    eyePair(head, 0.05, 0.08, 0.06, 0.22);
    // red necktie
    const tie = box(0.14, 0.3, 0.05, '#d1342f');
    tie.position.set(0, 0.42, 0.36);
    tie.rotation.x = 0.3;
    const limbs = {};
    for (const [name, sx] of [['armL', -1], ['armR', 1]]) {
      const arm = sphere(0.15, '#6b4226', 1, 1.6, 1);
      arm.position.set(sx * 0.46, 0.42, 0.02);
      limbs[name] = arm; g.add(arm);
    }
    for (const [name, sx] of [['legL', -1], ['legR', 1]]) {
      const leg = sphere(0.14, '#5a3620', 1, 1.2, 1.3);
      leg.position.set(sx * 0.18, 0.07, 0);
      limbs[name] = leg; g.add(leg);
    }
    g.add(body, chest, head, tie);
    return { group: g, head, limbs };
  },

  // ---- Peacho: royal parasol pilot (glider) ----
  peacho() {
    const g = new THREE.Group();
    const gown = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.62, 16), mat('#ff9ec7'));
    gown.position.y = 0.3;
    const bodice = sphere(0.18, '#ff7eb3', 1, 1.1, 0.9);
    bodice.position.y = 0.62;
    const head = new THREE.Group();
    head.position.y = 0.94;
    const skull = sphere(0.2, '#f7d7c0');
    const hair = sphere(0.22, '#f5c542', 1, 0.9, 1);
    hair.position.set(0, 0.08, -0.05);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 8), mat('#ffe14d', { metalness: 0.7, roughness: 0.25 }));
    crown.position.y = 0.22;
    head.add(skull, hair, crown);
    eyePair(head, 0.045, 0.08, 0.03, 0.16, '#1a4db3');
    const limbs = {};
    // parasol!
    const parasol = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.18, 12), mat('#ff5f9e'));
    canopy.position.y = 0.3;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), mat('#8a5a2b'));
    rod.position.y = 0.1;
    parasol.add(canopy, rod);
    parasol.position.set(0.34, 0.6, 0);
    limbs.armR = parasol;
    const armL = sphere(0.07, '#f7d7c0', 1, 1.6, 1);
    armL.position.set(-0.3, 0.6, 0.05);
    limbs.armL = armL;
    g.add(gown, bodice, head, parasol, armL);
    return { group: g, head, limbs };
  },

  // ---- Waka: round yellow chomper (time eater) ----
  waka() {
    const g = new THREE.Group();
    // pac-man style: sphere with wedge mouth (two hemispheres angled)
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat('#ffe14d'));
    top.position.y = 0.42;
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#ffe14d'));
    bottom.position.y = 0.42;
    const mouthIn = new THREE.Mesh(new THREE.CircleGeometry(0.37, 24), mat('#8c5a00'));
    mouthIn.position.set(0, 0.42, 0.001);
    mouthIn.rotation.x = -Math.PI / 2;
    mouthIn.visible = false;
    const head = new THREE.Group();
    head.position.y = 0.42;
    eyePair(head, 0.06, 0.14, 0.2, 0.28, '#222');
    const limbs = { jawTop: top, jawBot: bottom };
    for (const [name, sx] of [['legL', -1], ['legR', 1]]) {
      const leg = sphere(0.11, '#e0442a', 1, 1.2, 1.4);
      leg.position.set(sx * 0.16, 0.05, 0);
      limbs[name] = leg; g.add(leg);
    }
    g.add(top, bottom, mouthIn, head);
    return { group: g, head, limbs };
  }
};

export const CHARACTERS = [
  {
    id: 'marco', name: 'Marco', tagline: 'The Mustachioed Marvel',
    bio: 'A plucky plumber-monkey who insists every stage is "just-a one more castle". Perfectly balanced, as all heroes should be.',
    ballColor: 0xff6b6b,
    stats: { speed: 6, traction: 6, weight: 5, jump: 6 },
    ability: { id: 'stomp', name: 'Super Stomp', desc: 'Slam down and mega-bounce off the floor.', cooldown: 4 },
    unlockCost: 0
  },
  {
    id: 'zippy', name: 'Zippy', tagline: 'The Blue Blur-ish',
    bio: 'A caffeinated hedgefox who has never once read a speed limit sign. Gotta roll fast — stopping is someone else\'s problem.',
    ballColor: 0x4d9fff,
    stats: { speed: 10, traction: 3, weight: 4, jump: 6 },
    ability: { id: 'dash', name: 'Sonic Boost', desc: 'Explosive forward dash in your travel direction.', cooldown: 5 },
    unlockCost: 0
  },
  {
    id: 'puffboy', name: 'Puffboy', tagline: 'The Pink Peril',
    bio: 'A marshmallow with dreams. So light he practically floats — hold JUMP to drift gently down like a delicious cloud.',
    ballColor: 0xffa1cc,
    stats: { speed: 4, traction: 5, weight: 1, jump: 8 },
    ability: { id: 'float', name: 'Puff Up', desc: 'Inflate for a big upward puff and slow-fall for 3s.', cooldown: 6 },
    unlockCost: 30
  },
  {
    id: 'lonk', name: 'Lonk', tagline: 'Hero of Thyme',
    bio: 'It\'s dangerous to roll alone, so he brought a shield. Excellent at not sliding off things. HYAAAH!',
    ballColor: 0x63d471,
    stats: { speed: 5, traction: 9, weight: 6, jump: 5 },
    ability: { id: 'shield', name: 'Shield Stop', desc: 'Instantly halt and become bump-proof for 2s.', cooldown: 5 },
    unlockCost: 50
  },
  {
    id: 'sparkle', name: 'Sparkle', tagline: 'The Static Menace',
    bio: 'An electric gerbil with a 50,000-volt personality. Bananas are mysteriously drawn to her. So is lint.',
    ballColor: 0xffe14d,
    stats: { speed: 7, traction: 5, weight: 3, jump: 7 },
    ability: { id: 'magnet', name: 'Zap Magnet', desc: 'Magnetize nearby bananas to you for 4s.', cooldown: 8 },
    unlockCost: 80
  },
  {
    id: 'chonko', name: 'Chonko', tagline: 'The Big Barrel Boss',
    bio: 'A tie-wearing ape of considerable gravitas. Bumpers fear him. Wind ignores him. Diets have failed him.',
    ballColor: 0xb07845,
    stats: { speed: 4, traction: 8, weight: 10, jump: 3 },
    ability: { id: 'pound', name: 'Kong Quake', desc: 'Ground-pound that grants huge grip & momentum for 3s.', cooldown: 6 },
    unlockCost: 120
  },
  {
    id: 'peacho', name: 'Peacho', tagline: 'Her Rolling Highness',
    bio: 'Royalty who refuses to be kidnapped ever again. Her parasol turns any fall into a graceful descent.',
    ballColor: 0xffb3d9,
    stats: { speed: 5, traction: 6, weight: 2, jump: 7 },
    ability: { id: 'glide', name: 'Parasol Glide', desc: 'Deploy the parasol: glide far with barely any falling.', cooldown: 6 },
    unlockCost: 160
  },
  {
    id: 'waka', name: 'Waka', tagline: 'The Time Eater',
    bio: 'A round yellow enigma who eats dots, fruit, and — occasionally — the concept of time itself. Waka waka.',
    ballColor: 0xfff066,
    stats: { speed: 6, traction: 6, weight: 5, jump: 5 },
    ability: { id: 'chomp', name: 'Chrono Chomp', desc: 'Chomp the clock: freeze the timer for 4s.', cooldown: 12 },
    unlockCost: 220
  }
];

export function getCharacter(id) {
  return CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
}

export function buildCharacterMesh(id) {
  const builder = BUILDERS[id] || BUILDERS.marco;
  const built = builder();
  built.group.traverse(o => { o.castShadow = true; });
  return built;
}

// Animate a built character. mode: 'idle' | 'roll' | 'air' | 'win' | 'dizzy'
export function animateCharacter(built, t, mode = 'idle', speed = 0) {
  const { group, head, limbs } = built;
  const s = Math.min(speed / 14, 1);
  if (mode === 'roll' || mode === 'idle') {
    const rate = mode === 'roll' ? 10 + s * 14 : 3;
    const amp = mode === 'roll' ? 0.5 + s * 0.6 : 0.12;
    const w = Math.sin(t * rate);
    if (limbs.armL) limbs.armL.rotation.x = w * amp;
    if (limbs.armR) limbs.armR.rotation.x = -w * amp;
    if (limbs.legL) limbs.legL.rotation.x = -w * amp;
    if (limbs.legR) limbs.legR.rotation.x = w * amp;
    if (limbs.tail) limbs.tail.rotation.y = Math.sin(t * 4) * 0.4;
    if (head) head.rotation.y = Math.sin(t * 1.6) * 0.12;
    group.position.y = Math.abs(Math.sin(t * (mode === 'roll' ? rate / 2 : 2))) * 0.03;
    // Waka chomps as he moves
    if (limbs.jawTop && limbs.jawBot) {
      const chomp = (Math.sin(t * (4 + s * 12)) * 0.5 + 0.5) * (0.2 + s * 0.4);
      limbs.jawTop.rotation.x = -chomp;
      limbs.jawBot.rotation.x = chomp;
    }
  } else if (mode === 'air') {
    if (limbs.armL) limbs.armL.rotation.x = -2.4;
    if (limbs.armR) limbs.armR.rotation.x = -2.4;
    if (limbs.legL) limbs.legL.rotation.x = 0.5;
    if (limbs.legR) limbs.legR.rotation.x = -0.5;
    group.position.y = 0.05;
  } else if (mode === 'win') {
    const hop = Math.abs(Math.sin(t * 6));
    group.position.y = hop * 0.25;
    if (limbs.armL) limbs.armL.rotation.x = -2.6 + Math.sin(t * 12) * 0.3;
    if (limbs.armR) limbs.armR.rotation.x = -2.6 - Math.sin(t * 12) * 0.3;
    if (head) head.rotation.z = Math.sin(t * 6) * 0.15;
    if (limbs.jawTop) { limbs.jawTop.rotation.x = -0.5; limbs.jawBot.rotation.x = 0.5; }
  } else if (mode === 'dizzy') {
    if (head) { head.rotation.z = Math.sin(t * 10) * 0.35; head.rotation.y = Math.cos(t * 8) * 0.3; }
    if (limbs.armL) limbs.armL.rotation.x = 0.8;
    if (limbs.armR) limbs.armR.rotation.x = 0.8;
    group.position.y = 0;
  }
}
