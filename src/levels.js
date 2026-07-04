// Level data. Everything is data-driven:
//  parts:   oriented boxes {p:[x,y,z] center, s:[w,h,d] full size, rot:[rx,ry,rz], tex, anim}
//  anim:    {type:'slide', axis:[..], amp, speed, phase} | {type:'spin', speed} | {type:'orbit', center:[..], radius, speed, phase}
//  bananas: [x,y,z] singles; bunches: [x,y,z] (worth 10)
//  bumpers: {p, r} cylinders that punt the ball
//  pads:    launch pads {p:[x,y,z], dir:[x,y,z] impulse, s:[w,d]} — flight time!
//  goal:    {p:[x,y,z], ry} goal gate (cross the plane to clear)
//  start:   {p, ry} spawn
// +z is "toward the camera" at spawn; players roll toward -z by default.

function lane(x, y, z, w, l, tex = 'floor', extra = {}) {
  return { p: [x, y, z], s: [w, 0.6, l], tex, ...extra };
}
function wallpair(x, y, z, l, gap, h = 0.9) {
  return [
    { p: [x - gap / 2 - 0.25, y + h / 2 + 0.3, z], s: [0.5, h, l], tex: 'wall' },
    { p: [x + gap / 2 + 0.25, y + h / 2 + 0.3, z], s: [0.5, h, l], tex: 'wall' }
  ];
}
function bananaRow(x, y, z, n, dz = 1.6) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([x, y, z - i * dz]);
  return out;
}

export const WORLDS = [
  { id: 'jungle', name: 'Banana Jungle', music: 'jungle', tod: 'noon', sky: ['#7ec8ff', '#bfe6ff', '#e8ffd8'], fog: '#bfe6ff', floorTex: 'jungle' },
  { id: 'sky', name: 'Sky Kingdom', music: 'sky', tod: 'sunset', sky: ['#2b1d5e', '#7a5fd0', '#ffb6d9'], fog: '#8f7ad6', floorTex: 'dots' },
  { id: 'volcano', name: 'Mt. Kaboom', music: 'volcano', tod: 'night', sky: ['#1a0505', '#5e1414', '#ff7b1c'], fog: '#4a1010', floorTex: 'lava' }
];

export const LEVELS = [
  // ================= WORLD 1: BANANA JUNGLE =================
  {
    world: 0, name: 'Roll Out!', time: 60, par: 45,
    start: { p: [0, 1, 10], ry: 0 },
    goal: { p: [0, 0.3, -26], ry: 0 },
    parts: [
      lane(0, 0, 4, 8, 16),
      lane(0, 0, -12, 5, 18),
      lane(0, 0, -25, 8, 10),
    ],
    bananas: [...bananaRow(0, 1, 0, 4), [-1.5, 1, -16], [1.5, 1, -16]],
    bunches: [[0, 1, -21]],
  },
  {
    world: 0, name: 'Curve Ball', time: 60, par: 40,
    start: { p: [0, 1, 12], ry: 0 },
    goal: { p: [16, 0.3, -20], ry: Math.PI / 2 },
    parts: [
      lane(0, 0, 4, 6, 20),
      lane(0, 0, -9, 10, 10),                 // corner plaza
      lane(9, 0, -11, 14, 6),                 // east arm
      lane(17, 0, -15.5, 6, 15),
      { p: [-2.8, 0.75, -9], s: [0.6, 0.9, 10], tex: 'wall' },  // corner bank wall
      { p: [0, 0.75, -13.8], s: [10, 0.9, 0.6], tex: 'wall' },
    ],
    bananas: [...bananaRow(0, 1, 6, 5), [6, 1, -11], [9, 1, -11], [12, 1, -11]],
    bunches: [[17, 1, -12]],
  },
  {
    world: 0, name: 'Bridge Over Trouble', time: 75, par: 55,
    start: { p: [0, 1, 12], ry: 0 },
    goal: { p: [0, 0.3, -34], ry: 0 },
    parts: [
      lane(0, 0, 8, 7, 10),
      lane(0, 0, -2, 1.8, 12, 'plank'),      // narrow bridge 1
      lane(0, 0, -13, 7, 8),
      lane(-2, 0, -23, 1.6, 12, 'plank'),    // split narrow bridges
      lane(2, 0, -23, 1.6, 12, 'plank'),
      lane(0, 0, -33, 8, 8),
    ],
    bananas: [...bananaRow(0, 1, 2, 4), ...bananaRow(-2, 1, -18, 4), ...bananaRow(2, 1, -18, 4)],
    bunches: [[0, 1, -13]],
  },
  {
    world: 0, name: 'Bumper Crop', time: 75, par: 50,
    start: { p: [0, 1, 14], ry: 0 },
    goal: { p: [0, 0.3, -22], ry: 0 },
    parts: [
      lane(0, 0, -2, 16, 36),
      { p: [-8.25, 0.9, -2], s: [0.5, 1.2, 36], tex: 'wall' },
      { p: [8.25, 0.9, -2], s: [0.5, 1.2, 36], tex: 'wall' },
    ],
    bumpers: [
      { p: [-4, 0.3, 4], r: 1.1 }, { p: [4, 0.3, 4], r: 1.1 },
      { p: [0, 0.3, -1], r: 1.4 },
      { p: [-5, 0.3, -7], r: 1.1 }, { p: [5, 0.3, -7], r: 1.1 },
      { p: [-2, 0.3, -13], r: 1.1 }, { p: [2, 0.3, -13], r: 1.1 },
    ],
    bananas: [[-6, 1, 1], [6, 1, 1], [0, 1, -5], [-6, 1, -10], [6, 1, -10], ...bananaRow(0, 1, -16, 3)],
    bunches: [[0, 1, 8]],
  },
  {
    world: 0, name: 'Banana Split', time: 80, par: 55,
    start: { p: [0, 1, 14], ry: 0 },
    goal: { p: [0, 0.3, -40], ry: 0 },
    parts: [
      lane(0, 0, 8, 8, 14),
      // safe wide left path
      lane(-5, 0, -8, 5, 20),
      lane(-5, 0, -22, 5, 12),
      // risky thin right path, paved with gold
      lane(5, 0, -8, 1.6, 20, 'plank'),
      lane(5, 0, -22, 1.6, 12, 'plank'),
      // merge
      lane(0, 0, -33, 14, 10),
      lane(0, 0, -40, 6, 6),
    ],
    bananas: [...bananaRow(-5, 1, -2, 6, 2.4)],
    bunches: [[5, 1, -4], [5, 1, -10], [5, 1, -16], [5, 1, -24]],
  },

  // ================= WORLD 2: SKY KINGDOM =================
  {
    world: 1, name: 'Sky High', time: 75, par: 50,
    start: { p: [0, 1, 12], ry: 0 },
    goal: { p: [0, 4.3, -30], ry: 0 },
    parts: [
      lane(0, 0, 8, 7, 10),
      { p: [0, 0.5, -1], s: [5, 1.6, 6], rot: [-0.22, 0, 0], tex: 'floor' },   // ramp up
      lane(0, 1.6, -8, 5, 8),
      { p: [0, 2.1, -14.5], s: [4, 1.6, 6], rot: [-0.22, 0, 0], tex: 'floor' },
      lane(0, 3.2, -21, 4, 7),
      lane(0, 4, -29, 7, 9, 'floor'),
      { p: [0, 3.6, -25.2], s: [4, 0.8, 2], rot: [-0.35, 0, 0], tex: 'floor' },
    ],
    bananas: [...bananaRow(0, 2.6, -6, 3), ...bananaRow(0, 4.2, -19, 3)],
    bunches: [[0, 5, -32]],
  },
  {
    world: 1, name: 'Launch Party', time: 75, par: 50,
    start: { p: [0, 1, 10], ry: 0 },
    goal: { p: [0, 0.3, -46], ry: 0 },
    parts: [
      lane(0, 0, 4, 7, 14),
      lane(0, 0, -32, 12, 16),   // landing island (big gap between!)
      lane(0, 0, -44, 6, 8),
    ],
    pads: [{ p: [0, 0.35, -2], dir: [0, 11, -13], s: [3, 3] }],
    bananas: [[0, 6, -12], [0, 8, -17], [0, 8, -22], [0, 6, -27]],   // banana arc through the air!
    bunches: [[0, 1, -36]],
  },
  {
    world: 1, name: 'The Slalom', time: 70, par: 45,
    start: { p: [0, 12, 16], ry: 0 },
    goal: { p: [0, 0.3, -30], ry: 0 },
    parts: [
      lane(0, 12, 14, 7, 8),
      { p: [0, 10.4, 4.5], s: [7, 0.6, 14], rot: [-0.24, 0, 0], tex: 'floor' },  // long downhill
      { p: [-3, 8.2, -3], s: [1, 1.2, 8], rot: [-0.24, 0, 0.0], tex: 'wall' },   // slalom gates
      { p: [3, 7, -8], s: [1, 1.2, 8], rot: [-0.24, 0, 0], tex: 'wall' },
      { p: [0, 6.2, -13], s: [8, 0.6, 22], rot: [-0.24, 0, 0], tex: 'floor' },
      lane(0, 3.2, -26, 10, 10),
      { p: [0, 1.4, -29], s: [6, 0.6, 8], rot: [-0.35, 0, 0], tex: 'floor' },
      lane(0, 0, -33, 8, 6),
    ],
    bananas: [[2, 13, 6], [-2, 12, 0], [2, 10.6, -6], [-2, 9.4, -12], [0, 8, -18]],
    bunches: [[0, 4.2, -26]],
  },
  {
    world: 1, name: 'Carousel Chaos', time: 80, par: 55,
    start: { p: [0, 1, 14], ry: 0 },
    goal: { p: [0, 0.3, -34], ry: 0 },
    parts: [
      lane(0, 0, 10, 6, 8),
      // spinning disc platform
      { p: [0, 0, 0], s: [10, 0.6, 10], tex: 'dots', anim: { type: 'spin', speed: 0.7 }, shape: 'disc' },
      // sliding bridge
      { p: [0, 0, -12], s: [3, 0.6, 8], tex: 'plank', anim: { type: 'slide', axis: [1, 0, 0], amp: 4, speed: 1.1 } },
      // second spinner, faster & reversed
      { p: [0, 0, -22], s: [8, 0.6, 8], tex: 'dots', anim: { type: 'spin', speed: -1.1 }, shape: 'disc' },
      lane(0, 0, -32, 7, 8),
    ],
    bananas: [[3, 1, 0], [-3, 1, 0], [0, 1, 3], [0, 1, -3], [0, 1, -22], [2.5, 1, -22]],
    bunches: [[0, 1, -12]],
  },
  {
    world: 1, name: 'Leap of Faith', time: 90, par: 60,
    start: { p: [0, 1, 12], ry: 0 },
    goal: { p: [0, 0.3, -58], ry: 0 },
    parts: [
      lane(0, 0, 6, 7, 14),
      // moving stepping stones over the void
      { p: [-3, 0, -6], s: [3, 0.6, 3], tex: 'plank', anim: { type: 'slide', axis: [1, 0, 0], amp: 3.5, speed: 0.9 } },
      { p: [3, 0, -13], s: [3, 0.6, 3], tex: 'plank', anim: { type: 'slide', axis: [1, 0, 0], amp: 3.5, speed: 0.9, phase: Math.PI } },
      { p: [0, 0, -20], s: [4, 0.6, 4], tex: 'plank' },
      lane(0, 0, -30, 8, 10),
      // launch across the mega gap onto a moving island
      lane(0, 0, -56, 10, 10),
    ],
    pads: [{ p: [0, 0.35, -32], dir: [0, 12, -14], s: [3, 3] }],
    bananas: [[0, 1, 0], [-3, 1, -6], [3, 1, -13], [0, 1, -20], [0, 7, -40], [0, 8, -45]],
    bunches: [[0, 1, -30], [0, 1, -52]],
  },

  // ================= WORLD 3: MT. KABOOM =================
  {
    world: 2, name: 'Hot Foot', time: 75, par: 50,
    start: { p: [0, 1, 14], ry: 0 },
    goal: { p: [0, 0.3, -32], ry: 0 },
    parts: [
      lane(0, 0, 10, 6, 8),
      lane(0, 0, -1, 2, 14, 'plank'),
      // moving rescue platforms alongside
      { p: [-4, 0, -4], s: [2.4, 0.6, 2.4], tex: 'floor', anim: { type: 'slide', axis: [0, 0, 1], amp: 4, speed: 0.8 } },
      { p: [4, 0, -8], s: [2.4, 0.6, 2.4], tex: 'floor', anim: { type: 'slide', axis: [0, 0, 1], amp: 4, speed: 0.8, phase: 2 } },
      lane(0, 0, -14, 5, 8),
      lane(0, 0, -25, 1.8, 14, 'plank'),
      lane(0, 0, -32, 7, 6),
    ],
    bananas: [...bananaRow(0, 1, -18, 4), [-4, 1, -4], [4, 1, -8]],
    bunches: [[0, 1, -14]],
  },
  {
    world: 2, name: 'Pinball Purgatory', time: 80, par: 55,
    start: { p: [0, 1, 16], ry: 0 },
    goal: { p: [0, 0.3, -26], ry: 0 },
    parts: [
      { p: [0, 1.6, 0], s: [18, 0.6, 36], rot: [-0.09, 0, 0], tex: 'floor' },  // tilted pinball table
      { p: [-9.25, 2.6, 0], s: [0.5, 1.6, 36], rot: [-0.09, 0, 0], tex: 'wall' },
      { p: [9.25, 2.6, 0], s: [0.5, 1.6, 36], rot: [-0.09, 0, 0], tex: 'wall' },
    ],
    bumpers: [
      { p: [-4.5, 2.4, 6], r: 1.3 }, { p: [4.5, 2.4, 6], r: 1.3 },
      { p: [0, 2, 0], r: 1.6 },
      { p: [-6, 1.7, -6], r: 1.2 }, { p: [6, 1.7, -6], r: 1.2 },
      { p: [-2.5, 1.4, -11], r: 1.2 }, { p: [2.5, 1.4, -11], r: 1.2 },
    ],
    bananas: [[-7, 3.2, 8], [7, 3.2, 8], [0, 2.8, 3], [-4, 2, -3], [4, 2, -3], [0, 1.6, -8], [-7, 1.4, -12], [7, 1.4, -12]],
    bunches: [[0, 1.2, -14]],
  },
  {
    world: 2, name: 'The Gauntlet', time: 90, par: 60,
    start: { p: [0, 1, 16], ry: 0 },
    goal: { p: [0, 0.3, -46], ry: 0 },
    parts: [
      lane(0, 0, 12, 6, 8),
      // sweeping arm you must dodge
      lane(0, 0, 2, 9, 10),
      { p: [0, 1.1, 2], s: [8, 1.2, 1.2], tex: 'wall', anim: { type: 'slide', axis: [1, 0, 0], amp: 3.5, speed: 1.6 } },
      lane(0, 0, -8, 3, 10, 'plank'),
      // narrow ridge with bumpers guarding bananas
      lane(0, 0, -20, 8, 12),
      lane(0, 0, -32, 2, 10, 'plank'),
      lane(0, 0, -44, 8, 10),
    ],
    bumpers: [{ p: [-2.5, 0.3, -20], r: 1 }, { p: [2.5, 0.3, -20], r: 1 }],
    bananas: [...bananaRow(0, 1, -4, 4), [0, 1, -20], ...bananaRow(0, 1, -28, 4)],
    bunches: [[0, 1, -17], [0, 1, -23]],
  },
  {
    world: 2, name: 'Vertigo Spiral', time: 90, par: 60,
    start: { p: [10, 12.5, 0], ry: Math.PI / 2 },
    goal: { p: [0, 0.3, 0], ry: 0 },
    parts: (() => {
      // descending spiral of angled slabs around a lava column
      const parts = [{ p: [10, 11.9, 0], s: [6, 0.6, 6], tex: 'floor' }];
      const N = 10;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        const y = 11 - (i + 0.5) * 1.05;
        const r = 10;
        const x = Math.cos(a0 + Math.PI / N) * r;
        const z = -Math.sin(a0 + Math.PI / N) * r;
        parts.push({
          p: [x, y, z], s: [4.4, 0.6, 7.4],
          rot: [0.16, a0 + Math.PI / N + Math.PI / 2, 0],
          tex: i % 2 ? 'floor' : 'plank'
        });
      }
      parts.push({ p: [0, 0, 0], s: [9, 0.6, 9], tex: 'floor', shape: 'disc' });
      return parts;
    })(),
    bananas: (() => {
      const b = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.4;
        b.push([Math.cos(a) * 10, 11 - i * 1.3, -Math.sin(a) * 10]);
      }
      return b;
    })(),
    bunches: [[0, 1, 0]],
  },
  {
    world: 2, name: 'Final Frenzy', time: 120, par: 80,
    start: { p: [0, 1, 20], ry: 0 },
    goal: { p: [0, 8.3, -74], ry: 0 },
    parts: [
      lane(0, 0, 16, 7, 10),
      // sweeper alley
      lane(0, 0, 5, 8, 12),
      { p: [0, 1.1, 8], s: [7, 1.2, 1], tex: 'wall', anim: { type: 'slide', axis: [1, 0, 0], amp: 3.2, speed: 2 } },
      { p: [0, 1.1, 2], s: [7, 1.2, 1], tex: 'wall', anim: { type: 'slide', axis: [1, 0, 0], amp: 3.2, speed: 2, phase: Math.PI } },
      // narrow S-bend
      lane(-3, 0, -6, 2, 10, 'plank'),
      lane(3, 0, -14, 2, 10, 'plank'),
      { p: [0, 0, -10], s: [8, 0.6, 2], tex: 'plank' },
      // spinner
      { p: [0, 0, -26], s: [9, 0.6, 9], tex: 'dots', anim: { type: 'spin', speed: 1.3 }, shape: 'disc' },
      // launch to high finish
      lane(0, 0, -38, 8, 10),
      lane(0, 4, -56, 5, 8),
      { p: [0, 5.6, -63.5], s: [4, 0.6, 8], rot: [-0.3, 0, 0], tex: 'floor' },
      lane(0, 7.5, -71.5, 6, 10),
    ],
    pads: [{ p: [0, 0.35, -40], dir: [0, 10, -11], s: [3, 3] }],
    bumpers: [{ p: [0, 4.3, -56], r: 1 }],
    bananas: [...bananaRow(0, 1, 12, 3), [-3, 1, -8], [3, 1, -12], [0, 1, -26], [3, 1, -26], [-3, 1, -26], [0, 6, -48], [0, 7, -52]],
    bunches: [[0, 1, -33], [0, 8.5, -74]],
  },
];

// ---------------- BIG MODE ----------------
// Uniformly scale every stage up: wider lanes, longer runs, taller drops.
// A pure similarity transform preserves slopes and geometry exactly; only
// jump/launch reach doesn't scale, so pads get a boost and clocks get longer.
const SCALE = 1.35;
function scaleLevel(lv) {
  const sp = (p) => p.map(v => v * SCALE);
  const out = { ...lv, time: Math.round(lv.time * 1.25), par: Math.round(lv.par * 1.25) };
  out.start = { ...lv.start, p: sp(lv.start.p) };
  out.goal = { ...lv.goal, p: sp(lv.goal.p) };
  out.parts = lv.parts.map(part => {
    const np = { ...part, p: sp(part.p), s: sp(part.s) };
    if (part.anim) {
      np.anim = { ...part.anim };
      if (np.anim.amp) np.anim.amp *= SCALE;
      if (np.anim.radius) np.anim.radius *= SCALE;
      if (np.anim.center) np.anim.center = sp(np.anim.center);
    }
    return np;
  });
  if (lv.bananas) out.bananas = lv.bananas.map(sp);
  if (lv.bunches) out.bunches = lv.bunches.map(sp);
  if (lv.bumpers) out.bumpers = lv.bumpers.map(b => ({ ...b, p: sp(b.p), r: b.r * 1.2 }));
  if (lv.pads) out.pads = lv.pads.map(pd => ({
    ...pd,
    p: sp(pd.p),
    // projectile range scales with v^2 — boost impulse to clear the scaled gaps
    dir: [pd.dir[0] * Math.sqrt(SCALE), pd.dir[1] * Math.sqrt(SCALE), pd.dir[2] * Math.sqrt(SCALE)],
    s: [pd.s[0] * SCALE, pd.s[1] * SCALE]
  }));
  return out;
}
for (let i = 0; i < LEVELS.length; i++) LEVELS[i] = scaleLevel(LEVELS[i]);

export function starThresholds(level) {
  // stars: 1 = clear, 2 = clear with time >= par-ish, 3 = fast + rich
  return { two: level.time - level.par, three: (level.time - level.par) + 8 };
}
