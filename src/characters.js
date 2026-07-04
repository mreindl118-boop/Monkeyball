// The Rascal Roster — loving parodies with unique stats & abilities.
// Every model is sculpted procedurally from smooth primitives (capsules,
// lathes, high-segment spheres — no boxy limbs) with jointed pivots so the
// animations articulate properly: idle, roll, air, win and dizzy poses.
import * as THREE from 'three';

// ---------------- sculpting toolkit ----------------
function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...o });
}
function metal(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.8, ...o });
}
function glossy(color, o = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.15, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15, ...o });
}

function sphere(r, material, sx = 1, sy = 1, sz = 1, seg = 24) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(12, seg * 0.66 | 0)), matify(material));
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}
function capsule(r, len, material, seg = 16) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, seg), matify(material));
  m.castShadow = true;
  return m;
}
function cone(r, h, material, seg = 20) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), matify(material));
  m.castShadow = true;
  return m;
}
function torus(r, tube, material, arc = Math.PI * 2, seg = 24) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 12, seg, arc), matify(material));
  m.castShadow = true;
  return m;
}
function lathe(points, material, seg = 28) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(points.map(p => new THREE.Vector2(p[0], p[1])), seg), matify(material));
  m.castShadow = true;
  return m;
}
function cyl(rTop, rBot, h, material, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), matify(material));
  m.castShadow = true;
  return m;
}
function matify(m) { return (m && m.isMaterial) ? m : mat(m); }

// jointed limb: pivot Group at the shoulder/hip, capsule hangs below it
function limb(r, len, material, px, py, pz, opts = {}) {
  const g = new THREE.Group();
  g.position.set(px, py, pz);
  const c = capsule(r, len, material);
  c.position.y = -(len / 2 + r * 0.4);
  g.add(c);
  if (opts.tipR) { // paw/boot/glove at the end
    const tip = sphere(opts.tipR, opts.tipColor || material, 1, opts.tipSy || 0.9, opts.tipSz || 1.2);
    tip.position.y = -(len + r);
    g.add(tip);
  }
  if (opts.rotZ) g.rotation.z = opts.rotZ;
  return g;
}

function eyePair(head, r, x, y, z, iris = '#1c1c1c', white = true) {
  for (const s of [-1, 1]) {
    if (white) {
      const w = sphere(r, glossy('#ffffff'), 1, 1.15, 0.75);
      w.position.set(s * x, y, z);
      head.add(w);
    }
    const p = sphere(r * (white ? 0.55 : 1), glossy(iris), 1, 1.15, 0.7);
    p.position.set(s * x, y, z + r * (white ? 0.5 : 0));
    head.add(p);
    const hl = sphere(r * 0.16, mat('#ffffff', { emissive: 0xffffff, emissiveIntensity: 0.6 }));
    hl.position.set(s * x + r * 0.16, y + r * 0.3, z + r * (white ? 0.85 : 0.72));
    head.add(hl);
  }
}

// ---------------- the sculpts ----------------
const BUILDERS = {
  // ---- Marco: the mustachioed plumber (deluxe sculpt) ----
  marco() {
    const g = new THREE.Group();
    const red = mat('#df3a2e'), blue = mat('#2b4bcc'), skin = mat('#f3c089'), brown = mat('#4a2c14');
    // rounded torso with overalls (lathe: hips wide -> chest)
    const body = lathe([[0.001, 0], [0.24, 0.02], [0.30, 0.14], [0.30, 0.30], [0.24, 0.44], [0.13, 0.52], [0.001, 0.53]], blue);
    body.position.y = 0.10;
    // red shirt shoulders
    const chest = sphere(0.235, red, 1.15, 0.62, 0.98);
    chest.position.y = 0.55;
    // overall buttons
    for (const s of [-1, 1]) {
      const b = sphere(0.035, mat('#ffd23d', { metalness: 0.5, roughness: 0.3 }));
      b.position.set(s * 0.12, 0.5, 0.235);
      g.add(b);
    }
    // head
    const head = new THREE.Group();
    head.position.y = 0.74;
    const skull = sphere(0.26, skin, 1, 0.96, 0.96);
    const nose = sphere(0.085, mat('#eda56b'), 1.1, 0.9, 1.15);
    nose.position.set(0, -0.015, 0.245);
    // mustache: two thick torus arcs under the nose
    for (const s of [-1, 1]) {
      const m = torus(0.075, 0.032, brown, Math.PI * 0.9);
      m.position.set(s * 0.075, -0.075, 0.215);
      m.rotation.set(0.25, s * 0.5, s * -1.9);
      head.add(m);
    }
    // cap: dome + curved brim + emblem
    const cap = lathe([[0.001, 0], [0.20, 0.0], [0.265, 0.05], [0.245, 0.16], [0.10, 0.24], [0.001, 0.25]], red);
    cap.position.y = 0.09;
    const brim = sphere(0.16, red, 1.5, 0.22, 1.15);
    brim.position.set(0, 0.11, 0.21);
    const emblem = sphere(0.055, glossy('#ffffff'), 1, 1, 0.35);
    emblem.position.set(0, 0.19, 0.235);
    // ears + sideburns
    for (const s of [-1, 1]) {
      const ear = sphere(0.055, skin, 0.6, 1, 1);
      ear.position.set(s * 0.25, -0.02, 0);
      const burn = sphere(0.05, brown, 0.5, 0.8, 0.9);
      burn.position.set(s * 0.225, -0.03, 0.09);
      head.add(ear, burn);
    }
    head.add(skull, nose, cap, brim, emblem);
    eyePair(head, 0.056, 0.095, 0.05, 0.2, '#2a6fd0');
    // limbs: jointed capsules with white gloves & brown shoes
    const limbs = {
      armL: limb(0.075, 0.16, red, -0.28, 0.55, 0, { tipR: 0.085, tipColor: glossy('#ffffff'), rotZ: 0.35 }),
      armR: limb(0.075, 0.16, red, 0.28, 0.55, 0, { tipR: 0.085, tipColor: glossy('#ffffff'), rotZ: -0.35 }),
      legL: limb(0.08, 0.10, blue, -0.13, 0.14, 0, { tipR: 0.095, tipColor: brown, tipSz: 1.5 }),
      legR: limb(0.08, 0.10, blue, 0.13, 0.14, 0, { tipR: 0.095, tipColor: brown, tipSz: 1.5 })
    };
    g.add(body, chest, head, limbs.armL, limbs.armR, limbs.legL, limbs.legR);
    return { group: g, head, limbs };
  },

  // ---- Zippy: the blue blur hedgefox ----
  zippy() {
    const g = new THREE.Group();
    const blue = mat('#2464e0'), cream = mat('#f7d7a8'), redShoe = glossy('#e23b2e');
    const body = sphere(0.27, blue, 1, 1.15, 0.95);
    body.position.y = 0.38;
    const belly = sphere(0.185, cream, 1, 1.05, 0.62);
    belly.position.set(0, 0.34, 0.13);
    const head = new THREE.Group();
    head.position.y = 0.74;
    const skull = sphere(0.25, blue, 1.05, 0.95, 1);
    const muzzle = sphere(0.115, cream, 1.3, 0.75, 1.05);
    muzzle.position.set(0, -0.07, 0.19);
    const noseTip = sphere(0.035, glossy('#1c1c1c'));
    noseTip.position.set(0, -0.03, 0.315);
    head.add(skull, muzzle, noseTip);
    eyePair(head, 0.06, 0.095, 0.06, 0.185, '#0f5c2e');
    // swept-back quills (smooth cones)
    const limbs = {};
    for (let i = 0; i < 5; i++) {
      const sp = cone(0.075 - i * 0.006, 0.34, blue, 14);
      const a = -0.5 - i * 0.28;
      sp.position.set(0, 0.78 + Math.sin(a) * 0.15 - i * 0.11, -0.20 + Math.cos(a) * -0.12);
      sp.rotation.x = -Math.PI / 2 - i * 0.18;
      limbs['spike' + i] = sp;
      g.add(sp);
    }
    // ears
    for (const s of [-1, 1]) {
      const ear = cone(0.06, 0.16, blue, 12);
      ear.position.set(s * 0.14, 0.24, -0.02);
      ear.rotation.z = s * -0.3;
      head.add(ear);
    }
    const limbsMore = {
      armL: limb(0.06, 0.14, cream, -0.25, 0.52, 0.03, { tipR: 0.075, tipColor: glossy('#ffffff'), rotZ: 0.3 }),
      armR: limb(0.06, 0.14, cream, 0.25, 0.52, 0.03, { tipR: 0.075, tipColor: glossy('#ffffff'), rotZ: -0.3 }),
      legL: limb(0.065, 0.10, blue, -0.12, 0.16, 0.02, { tipR: 0.095, tipColor: redShoe, tipSz: 1.6, tipSy: 0.7 }),
      legR: limb(0.065, 0.10, blue, 0.12, 0.16, 0.02, { tipR: 0.095, tipColor: redShoe, tipSz: 1.6, tipSy: 0.7 })
    };
    Object.assign(limbs, limbsMore);
    g.add(body, belly, head, limbsMore.armL, limbsMore.armR, limbsMore.legL, limbsMore.legR);
    return { group: g, head, limbs };
  },

  // ---- Puffboy: the pink peril (extra round & squishy) ----
  puffboy() {
    const g = new THREE.Group();
    const pink = glossy('#ff9ec7', { roughness: 0.35 });
    const body = sphere(0.42, pink, 1, 0.98, 1, 32);
    body.position.y = 0.42;
    const head = new THREE.Group();
    head.position.y = 0.42;
    // big expressive eyes: tall ovals with blue base
    for (const s of [-1, 1]) {
      const eye = sphere(0.07, glossy('#1a2a4a'), 0.7, 1.7, 0.5);
      eye.position.set(s * 0.13, 0.14, 0.375);
      const shine = sphere(0.035, glossy('#ffffff'), 0.7, 1, 0.5);
      shine.position.set(s * 0.13, 0.20, 0.405);
      const blueBit = sphere(0.032, glossy('#3a7bd5'), 0.7, 0.8, 0.5);
      blueBit.position.set(s * 0.13, 0.075, 0.402);
      head.add(eye, shine, blueBit);
    }
    const mouth = sphere(0.05, mat('#8c1d40'), 1.6, 1, 0.4);
    mouth.position.set(0, -0.04, 0.41);
    for (const s of [-1, 1]) {
      const blush = sphere(0.055, mat('#ff5f9e'), 1.5, 0.75, 0.35);
      blush.position.set(s * 0.26, 0.0, 0.32);
      head.add(blush);
    }
    head.add(mouth);
    const limbs = {
      armL: limb(0.10, 0.05, pink, -0.36, 0.52, 0.05, { rotZ: 0.65 }),
      armR: limb(0.10, 0.05, pink, 0.36, 0.52, 0.05, { rotZ: -0.65 }),
      legL: limb(0.10, 0.06, glossy('#d6336c'), -0.16, 0.10, 0.02, { tipR: 0.11, tipColor: glossy('#d6336c'), tipSz: 1.3, tipSy: 0.7 }),
      legR: limb(0.10, 0.06, glossy('#d6336c'), 0.16, 0.10, 0.02, { tipR: 0.11, tipColor: glossy('#d6336c'), tipSz: 1.3, tipSy: 0.7 })
    };
    g.add(body, head, limbs.armL, limbs.armR, limbs.legL, limbs.legR);
    return { group: g, head, limbs };
  },

  // ---- Lonk: the Hero of Thyme ----
  lonk() {
    const g = new THREE.Group();
    const green = mat('#3f9e4d'), skin = mat('#f3c089'), hairC = mat('#e8c14d'), brown = mat('#6b4a2b');
    const tunic = lathe([[0.001, 0], [0.26, 0.02], [0.29, 0.12], [0.25, 0.34], [0.15, 0.48], [0.001, 0.50]], green);
    tunic.position.y = 0.12;
    const belt = torus(0.255, 0.035, brown);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.34;
    const buckle = sphere(0.05, metal('#e8c14d'), 1, 1, 0.4);
    buckle.position.set(0, 0.34, 0.25);
    const head = new THREE.Group();
    head.position.y = 0.74;
    const skull = sphere(0.24, skin, 1, 0.98, 0.95);
    const hair = sphere(0.245, hairC, 1.05, 0.6, 1.02);
    hair.position.set(0, 0.10, -0.01);
    const fringe = sphere(0.10, hairC, 1.6, 0.5, 0.6);
    fringe.position.set(0, 0.14, 0.19);
    // floppy pointed cap
    const capBase = torus(0.20, 0.06, mat('#2f8a3d'));
    capBase.rotation.x = Math.PI / 2 + 0.12;
    capBase.position.set(0, 0.20, -0.02);
    const capTip = cone(0.13, 0.42, mat('#2f8a3d'), 16);
    capTip.position.set(0, 0.30, -0.16);
    capTip.rotation.x = -0.85;
    // elf ears
    for (const s of [-1, 1]) {
      const ear = cone(0.045, 0.19, skin, 10);
      ear.position.set(s * 0.26, 0.02, -0.02);
      ear.rotation.z = s * -Math.PI / 2.15;
      head.add(ear);
    }
    head.add(skull, hair, fringe, capBase, capTip);
    eyePair(head, 0.05, 0.09, 0.03, 0.19, '#1a4db3');
    // shield arm & sword arm
    const shieldArm = limb(0.06, 0.13, green, -0.27, 0.52, 0.02, { rotZ: 0.4 });
    const shield = new THREE.Group();
    const sBase = lathe([[0.001, 0], [0.13, 0.005], [0.165, 0.03], [0.13, 0.055], [0.001, 0.06]], metal('#3a63c4', { roughness: 0.25 }));
    sBase.rotation.x = Math.PI / 2;
    const sTrim = torus(0.15, 0.018, metal('#cfd8e8'));
    const sBoss = sphere(0.045, metal('#e8c14d'));
    sBoss.position.z = 0.05;
    shield.add(sBase, sTrim, sBoss);
    shield.position.set(0, -0.26, 0.06);
    shieldArm.add(shield);
    const swordArm = limb(0.06, 0.13, green, 0.27, 0.52, 0.02, { rotZ: -0.4 });
    const sword = new THREE.Group();
    const blade = capsule(0.02, 0.3, metal('#dfe8f5', { roughness: 0.15 }));
    blade.position.y = 0.24;
    const guard = capsule(0.025, 0.09, metal('#e8c14d'));
    guard.rotation.z = Math.PI / 2;
    guard.position.y = 0.06;
    const hilt = capsule(0.025, 0.07, brown);
    sword.add(blade, guard, hilt);
    sword.position.set(0, -0.3, 0.05);
    sword.rotation.z = -0.5;
    swordArm.add(sword);
    const limbs = {
      armL: shieldArm, armR: swordArm,
      legL: limb(0.07, 0.10, mat('#e8dcc8'), -0.12, 0.14, 0, { tipR: 0.085, tipColor: brown, tipSz: 1.5 }),
      legR: limb(0.07, 0.10, mat('#e8dcc8'), 0.12, 0.14, 0, { tipR: 0.085, tipColor: brown, tipSz: 1.5 })
    };
    g.add(tunic, belt, buckle, head, limbs.armL, limbs.armR, limbs.legL, limbs.legR);
    return { group: g, head, limbs };
  },

  // ---- Sparkle: the static menace (pear-shaped & properly zappy) ----
  sparkle() {
    const g = new THREE.Group();
    const yellow = mat('#ffd23d'), darkTip = mat('#3a2a10');
    // pear body via lathe
    const body = lathe([[0.001, 0], [0.24, 0.01], [0.295, 0.16], [0.26, 0.38], [0.17, 0.52], [0.001, 0.55]], yellow);
    body.position.y = 0.08;
    // back stripes
    for (let i = 0; i < 2; i++) {
      const stripe = torus(0.235 - i * 0.045, 0.028, mat('#8a5a10'), Math.PI * 0.6);
      stripe.position.set(0, 0.28 + i * 0.12, -0.145 - i * 0.02);
      stripe.rotation.set(Math.PI / 2, 0, Math.PI / 2 + Math.PI * 0.2);
      g.add(stripe);
    }
    const head = new THREE.Group();
    head.position.y = 0.72;
    const skull = sphere(0.235, yellow, 1.08, 0.92, 1);
    head.add(skull);
    eyePair(head, 0.055, 0.10, 0.05, 0.185, '#3a2a10');
    // red cheek pouches
    for (const s of [-1, 1]) {
      const cheek = sphere(0.062, glossy('#e0442a'), 1, 1, 0.5);
      cheek.position.set(s * 0.17, -0.05, 0.16);
      head.add(cheek);
    }
    const mouth = torus(0.035, 0.012, mat('#8a3a1a'), Math.PI);
    mouth.position.set(0, -0.06, 0.225);
    mouth.rotation.x = Math.PI;
    head.add(mouth);
    // long ears with black tips
    for (const s of [-1, 1]) {
      const ear = capsule(0.05, 0.22, yellow);
      ear.position.set(s * 0.15, 0.31, -0.02);
      ear.rotation.z = s * -0.42;
      const tip = capsule(0.05, 0.06, darkTip);
      tip.position.set(s * 0.225, 0.45, -0.02);
      tip.rotation.z = s * -0.42;
      head.add(ear, tip);
    }
    // lightning-bolt tail (flat extruded zigzag)
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0); tailShape.lineTo(0.09, 0.14); tailShape.lineTo(0.02, 0.16);
    tailShape.lineTo(0.13, 0.32); tailShape.lineTo(0.05, 0.34); tailShape.lineTo(0.20, 0.55);
    tailShape.lineTo(0.30, 0.50); tailShape.lineTo(0.16, 0.42); tailShape.lineTo(0.24, 0.38);
    tailShape.lineTo(0.10, 0.22); tailShape.lineTo(0.17, 0.19); tailShape.lineTo(0.06, -0.02);
    tailShape.closePath();
    const tail = new THREE.Mesh(new THREE.ExtrudeGeometry(tailShape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }), matify(yellow));
    tail.castShadow = true;
    const tailG = new THREE.Group();
    tail.position.set(-0.1, 0, 0);
    tailG.add(tail);
    tailG.position.set(0, 0.28, -0.26);
    tailG.rotation.y = Math.PI;
    const limbs = {
      tail: tailG,
      armL: limb(0.055, 0.09, yellow, -0.24, 0.48, 0.05, { rotZ: 0.5 }),
      armR: limb(0.055, 0.09, yellow, 0.24, 0.48, 0.05, { rotZ: -0.5 }),
      legL: limb(0.07, 0.06, yellow, -0.13, 0.11, 0.02, { tipR: 0.08, tipSz: 1.3, tipColor: yellow }),
      legR: limb(0.07, 0.06, yellow, 0.13, 0.11, 0.02, { tipR: 0.08, tipSz: 1.3, tipColor: yellow })
    };
    g.add(body, head, tailG, limbs.armL, limbs.armR, limbs.legL, limbs.legR);
    return { group: g, head, limbs };
  },

  // ---- Chonko: the big barrel boss ----
  chonko() {
    const g = new THREE.Group();
    const fur = mat('#6b4226'), skinC = mat('#c89a6b');
    const body = lathe([[0.001, 0], [0.28, 0.02], [0.36, 0.18], [0.34, 0.36], [0.22, 0.52], [0.001, 0.55]], fur);
    body.position.y = 0.06;
    const chest = sphere(0.26, skinC, 1, 0.9, 0.55);
    chest.position.set(0, 0.36, 0.2);
    // red power tie
    const tieKnot = sphere(0.06, glossy('#d1342f'), 1, 0.7, 0.6);
    tieKnot.position.set(0, 0.56, 0.27);
    const tie = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.34, 4), matify(glossy('#d1342f')));
    tie.rotation.set(Math.PI + 0.28, Math.PI / 4, 0);
    tie.position.set(0, 0.40, 0.30);
    tie.castShadow = true;
    const head = new THREE.Group();
    head.position.y = 0.78;
    const skull = sphere(0.235, fur, 1.05, 0.9, 0.95);
    const face = sphere(0.17, skinC, 1.15, 0.92, 0.72);
    face.position.set(0, -0.045, 0.135);
    const muzzle = sphere(0.11, skinC, 1.25, 0.72, 0.9);
    muzzle.position.set(0, -0.10, 0.20);
    const nostrils = sphere(0.02, mat('#4a2c14'), 2.6, 0.8, 0.8);
    nostrils.position.set(0, -0.085, 0.30);
    const brow = sphere(0.115, fur, 1.7, 0.42, 0.6);
    brow.position.set(0, 0.075, 0.17);
    // tuft
    const tuft = cone(0.05, 0.13, fur, 10);
    tuft.position.set(0, 0.24, 0);
    tuft.rotation.x = -0.3;
    head.add(skull, face, muzzle, nostrils, brow, tuft);
    eyePair(head, 0.045, 0.075, 0.045, 0.21);
    const limbs = {
      armL: limb(0.11, 0.18, fur, -0.38, 0.50, 0.02, { tipR: 0.13, tipColor: skinC, rotZ: 0.35 }),
      armR: limb(0.11, 0.18, fur, 0.38, 0.50, 0.02, { tipR: 0.13, tipColor: skinC, rotZ: -0.35 }),
      legL: limb(0.10, 0.08, fur, -0.16, 0.12, 0, { tipR: 0.12, tipColor: skinC, tipSz: 1.3 }),
      legR: limb(0.10, 0.08, fur, 0.16, 0.12, 0, { tipR: 0.12, tipColor: skinC, tipSz: 1.3 })
    };
    g.add(body, chest, tieKnot, tie, head, limbs.armL, limbs.armR, limbs.legL, limbs.legR);
    return { group: g, head, limbs };
  },

  // ---- Peacho: her rolling highness ----
  peacho() {
    const g = new THREE.Group();
    const gownC = glossy('#ff9ec7', { roughness: 0.4 }), skin = mat('#f7d7c0'), gold = metal('#f5c542', { roughness: 0.3 });
    // flowing gown: lathe with a flared hem
    const gown = lathe([[0.001, 0], [0.34, 0.0], [0.30, 0.10], [0.18, 0.34], [0.13, 0.48], [0.10, 0.58], [0.001, 0.60]], gownC);
    gown.position.y = 0.02;
    const hemTrim = torus(0.325, 0.025, glossy('#ff5f9e'));
    hemTrim.rotation.x = Math.PI / 2;
    hemTrim.position.y = 0.035;
    const bodice = sphere(0.155, glossy('#ff7eb3'), 1, 1.15, 0.9);
    bodice.position.y = 0.60;
    const brooch = sphere(0.045, glossy('#4dc8e8'));
    brooch.position.set(0, 0.63, 0.13);
    // puff sleeves
    const head = new THREE.Group();
    head.position.y = 0.90;
    const skull = sphere(0.20, skin, 1, 1, 0.95);
    const hairBack = sphere(0.215, gold, 1, 1.05, 1);
    hairBack.position.set(0, 0.05, -0.055);
    const hairSide1 = sphere(0.09, gold, 0.8, 1.4, 0.8);
    hairSide1.position.set(-0.17, -0.06, 0.05);
    const hairSide2 = hairSide1.clone();
    hairSide2.position.x = 0.17;
    const fringe = sphere(0.09, gold, 1.8, 0.5, 0.7);
    fringe.position.set(0, 0.155, 0.135);
    // crown
    const crown = new THREE.Group();
    const band = torus(0.095, 0.025, gold);
    band.rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const pt = cone(0.028, 0.075, gold, 8);
      const a = (i / 4) * Math.PI * 2;
      pt.position.set(Math.cos(a) * 0.09, 0.055, Math.sin(a) * 0.09);
      crown.add(pt);
    }
    const jewel = sphere(0.028, glossy('#e0442a'));
    jewel.position.set(0, 0.01, 0.10);
    crown.add(band, jewel);
    crown.position.y = 0.225;
    head.add(skull, hairBack, hairSide1, hairSide2, fringe, crown);
    eyePair(head, 0.045, 0.075, 0.03, 0.165, '#1a4db3');
    // parasol arm
    const armR = limb(0.05, 0.11, gownC, 0.22, 0.62, 0.02, { rotZ: -1.9 });
    const parasol = new THREE.Group();
    const canopy = lathe([[0.001, 0], [0.14, -0.03], [0.24, -0.10], [0.28, -0.16]], glossy('#ff5f9e'));
    canopy.position.y = 0.35;
    const canopyTip = cone(0.02, 0.07, gold, 8);
    canopyTip.position.y = 0.38;
    const rod = cyl(0.012, 0.012, 0.5, mat('#8a5a2b'), 8);
    rod.position.y = 0.12;
    parasol.add(canopy, canopyTip, rod);
    parasol.position.set(0, -0.22, 0);
    armR.add(parasol);
    const limbs = {
      armL: limb(0.05, 0.11, skin, -0.22, 0.62, 0.02, { tipR: 0.055, tipColor: glossy('#ffffff'), rotZ: 0.5 }),
      armR
    };
    g.add(gown, hemTrim, bodice, brooch, head, limbs.armL, armR);
    return { group: g, head, limbs };
  },

  // ---- Waka: the time eater ----
  waka() {
    const g = new THREE.Group();
    const yellow = glossy('#ffe14d', { roughness: 0.3 });
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.38, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), matify(yellow));
    top.position.y = 0.42;
    top.castShadow = true;
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.38, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), matify(yellow));
    bottom.position.y = 0.42;
    bottom.castShadow = true;
    // inner mouth discs so the chomp has a visible maw
    const mawT = new THREE.Mesh(new THREE.CircleGeometry(0.375, 32), mat('#8c5a00'));
    mawT.rotation.x = Math.PI / 2;
    mawT.position.y = -0.002;
    top.add(mawT);
    const mawB = new THREE.Mesh(new THREE.CircleGeometry(0.375, 32), mat('#8c5a00'));
    mawB.rotation.x = -Math.PI / 2;
    mawB.position.y = 0.002;
    bottom.add(mawB);
    const head = new THREE.Group();
    head.position.y = 0.42;
    eyePair(head, 0.055, 0.14, 0.24, 0.26);
    const limbs = {
      jawTop: top, jawBot: bottom,
      legL: limb(0.09, 0.05, glossy('#e0442a'), -0.16, 0.08, 0, { tipR: 0.10, tipColor: glossy('#e0442a'), tipSz: 1.4, tipSy: 0.7 }),
      legR: limb(0.09, 0.05, glossy('#e0442a'), 0.16, 0.08, 0, { tipR: 0.10, tipColor: glossy('#e0442a'), tipSz: 1.4, tipSy: 0.7 })
    };
    g.add(top, bottom, head, limbs.legL, limbs.legR);
    return { group: g, head, limbs };
  },

  // ---- Jawn-117: the Master Chef (fully armored spartan... of the kitchen) ----
  jawn() {
    const g = new THREE.Group();
    const armor = metal('#5e7d4a', { roughness: 0.45 });
    const armorDark = metal('#42593a', { roughness: 0.5 });
    const black = mat('#1e2420', { roughness: 0.7 });
    // armored torso: chest plate over black undersuit
    const under = capsule(0.21, 0.22, black);
    under.position.y = 0.38;
    const chestPlate = sphere(0.25, armor, 1.15, 0.95, 0.8);
    chestPlate.position.y = 0.46;
    const abPlate = sphere(0.19, armorDark, 1.1, 0.6, 0.85);
    abPlate.position.y = 0.22;
    const backpack = sphere(0.14, armorDark, 1.1, 1.3, 0.7);
    backpack.position.set(0, 0.46, -0.20);
    // helmet: iconic dome + gold visor
    const head = new THREE.Group();
    head.position.y = 0.80;
    const dome = lathe([[0.001, -0.10], [0.20, -0.10], [0.235, 0.0], [0.22, 0.10], [0.13, 0.20], [0.001, 0.22]], armor);
    const visor = sphere(0.15, new THREE.MeshPhysicalMaterial({
      color: 0xd9a428, metalness: 0.9, roughness: 0.12, clearcoat: 1,
      emissive: 0x8a5c0a, emissiveIntensity: 0.35
    }), 1.25, 0.62, 0.7);
    visor.position.set(0, 0.015, 0.155);
    const chin = sphere(0.12, armorDark, 1.25, 0.5, 0.8);
    chin.position.set(0, -0.10, 0.10);
    const crest = capsule(0.03, 0.14, armorDark);
    crest.rotation.x = Math.PI / 2;
    crest.position.set(0, 0.19, 0);
    head.add(dome, visor, chin, crest);
    // pauldrons
    for (const s of [-1, 1]) {
      const pauldron = sphere(0.115, armor, 1, 0.8, 1);
      pauldron.position.set(s * 0.28, 0.60, 0);
      g.add(pauldron);
    }
    // the sacred frying pan (Master CHEF)
    const armR = limb(0.07, 0.14, black, 0.27, 0.52, 0.02, { rotZ: -0.5 });
    const pan = new THREE.Group();
    const panHead = cyl(0.11, 0.13, 0.035, metal('#3a3f45', { roughness: 0.3 }), 20);
    const panHandle = capsule(0.02, 0.14, black);
    panHandle.rotation.z = Math.PI / 2;
    panHandle.position.set(0.19, 0, 0);
    pan.add(panHead, panHandle);
    pan.position.set(0.02, -0.30, 0.04);
    pan.rotation.z = 1.3;
    armR.add(pan);
    const limbs = {
      armL: limb(0.07, 0.14, armor, -0.27, 0.52, 0.02, { tipR: 0.08, tipColor: armorDark, rotZ: 0.4 }),
      armR,
      legL: limb(0.085, 0.11, armor, -0.14, 0.15, 0, { tipR: 0.10, tipColor: armorDark, tipSz: 1.5 }),
      legR: limb(0.085, 0.11, armor, 0.14, 0.15, 0, { tipR: 0.10, tipColor: armorDark, tipSz: 1.5 })
    };
    g.add(under, chestPlate, abPlate, backpack, head, limbs.armL, armR, limbs.legL, limbs.legR);
    return { group: g, head, limbs };
  },

  // ---- Liquid Snack: tactical espionage snacktion ----
  snack() {
    const g = new THREE.Group();
    const suit = mat('#3a4450', { roughness: 0.65 });
    const suitDark = mat('#2a323c', { roughness: 0.7 });
    const skin = mat('#e8b88a');
    // sneaking suit torso with harness
    const torso = capsule(0.22, 0.24, suit);
    torso.position.y = 0.38;
    const harness = torus(0.225, 0.03, suitDark);
    harness.rotation.x = Math.PI / 2;
    harness.position.y = 0.47;
    const strap = capsule(0.028, 0.34, suitDark);
    strap.rotation.z = 0.7;
    strap.position.set(0.02, 0.45, 0.19);
    // head: gruff face, stubble, iconic bandana
    const head = new THREE.Group();
    head.position.y = 0.76;
    const skull = sphere(0.23, skin, 1, 1, 0.95);
    const stubble = sphere(0.215, mat('#8a7460'), 1.02, 0.62, 0.95);
    stubble.position.set(0, -0.115, 0.02);
    const hair = sphere(0.235, mat('#6b5a3a'), 1.02, 0.55, 1);
    hair.position.set(0, 0.10, -0.03);
    // bandana band + trailing tails
    const band = torus(0.225, 0.035, glossy('#8a9aa8', { roughness: 0.5 }));
    band.rotation.x = Math.PI / 2 + 0.12;
    band.position.y = 0.075;
    const tail1 = capsule(0.025, 0.20, glossy('#8a9aa8', { roughness: 0.5 }));
    tail1.position.set(-0.06, -0.04, -0.235);
    tail1.rotation.set(0.5, 0, 0.3);
    const tail2 = capsule(0.02, 0.15, glossy('#8a9aa8', { roughness: 0.5 }));
    tail2.position.set(0.05, -0.06, -0.225);
    tail2.rotation.set(0.6, 0, -0.35);
    head.add(skull, stubble, hair, band, tail1, tail2);
    eyePair(head, 0.045, 0.085, 0.02, 0.185, '#3a5a6a');
    // squint brows for maximum gravel
    for (const s of [-1, 1]) {
      const brow = capsule(0.018, 0.07, mat('#4a3a24'));
      brow.rotation.z = Math.PI / 2 + s * 0.28;
      brow.position.set(s * 0.085, 0.085, 0.20);
      head.add(brow);
    }
    // his emergency ration: a tiny cardboard box worn like a backpack
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.12), mat('#b8905c', { roughness: 0.85 }));
    box.position.set(0, 0.44, -0.24);
    box.rotation.y = 0.15;
    box.castShadow = true;
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.035, 0.125), mat('#8a6a3c'));
    tape.position.set(0, 0.47, -0.24);
    tape.rotation.y = 0.15;
    const limbs = {
      armL: limb(0.065, 0.15, suit, -0.26, 0.53, 0.02, { tipR: 0.07, tipColor: suitDark, rotZ: 0.35 }),
      armR: limb(0.065, 0.15, suit, 0.26, 0.53, 0.02, { tipR: 0.07, tipColor: suitDark, rotZ: -0.35 }),
      legL: limb(0.08, 0.11, suit, -0.13, 0.14, 0, { tipR: 0.09, tipColor: suitDark, tipSz: 1.5 }),
      legR: limb(0.08, 0.11, suit, 0.13, 0.14, 0, { tipR: 0.09, tipColor: suitDark, tipSz: 1.5 })
    };
    g.add(torso, harness, strap, head, box, tape, limbs.armL, limbs.armR, limbs.legL, limbs.legR);
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
  },
  {
    id: 'jawn', name: 'Jawn-117', tagline: 'The Master Chef',
    bio: 'A seven-foot super-soldier who finished the fight and then opened a bistro. Wields a tactical frying pan. Never removes the helmet, even to taste the soup.',
    ballColor: 0x7da05e,
    stats: { speed: 5, traction: 7, weight: 9, jump: 4 },
    ability: { id: 'overshield', name: 'Overshield', desc: 'Energy shield: bump-proof + mega grip for 3s.', cooldown: 7 },
    unlockCost: 300
  },
  {
    id: 'snack', name: 'Liquid Snack', tagline: 'Tactical Espionage Snacktion',
    bio: 'A gravel-voiced legend who infiltrated the pantry and never left. Carries an emergency cardboard box at all times. Kept you waiting, huh?',
    ballColor: 0x8a9aa8,
    stats: { speed: 6, traction: 7, weight: 6, jump: 6 },
    ability: { id: 'box', name: 'Cardboard Box', desc: '!— hide in the box: stop dead, bump-proof, and bananas sneak toward you.', cooldown: 7 },
    unlockCost: 400
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
    if (limbs.tail) limbs.tail.rotation.y = Math.PI + Math.sin(t * 4) * 0.4;
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
