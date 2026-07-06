// Procedural texture generation — no external assets, everything drawn on canvases.
import * as THREE from 'three';

const cache = new Map();

// Max anisotropy for tiled ground textures (the camera hugs the floor, so
// grazing-angle sharpness is very visible). Set from the renderer at boot;
// falls back to a safe value until then.
let MAX_ANISO = 8;
export function setMaxAnisotropy(n) {
  MAX_ANISO = Math.max(1, n | 0);
  for (const t of cache.values()) { if (t && t.isTexture) { t.anisotropy = MAX_ANISO; t.needsUpdate = true; } }
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}


// deterministic hash noise (no Math.random -> stable textures)
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// film-grain style speckle overlay for material realism
function grain(ctx, size, amount = 0.06, scale = 2) {
  const cells = size / scale;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const v = hash(x * 391 + y * 23 + 7);
      if (v < 0.5) continue;
      ctx.fillStyle = v > 0.75 ? `rgba(255,255,255,${(v - 0.75) * amount * 4})` : `rgba(0,0,0,${(v - 0.5) * amount * 4})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

// darkened edges = cheap baked ambient occlusion
function edgeAO(ctx, size, strength = 0.28, width = 0.1) {
  const w = size * width;
  const g1 = ctx.createLinearGradient(0, 0, 0, size);
  g1.addColorStop(0, `rgba(0,0,0,${strength})`); g1.addColorStop(width, 'rgba(0,0,0,0)');
  g1.addColorStop(1 - width, 'rgba(0,0,0,0)'); g1.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g1; ctx.fillRect(0, 0, size, size);
  const g2 = ctx.createLinearGradient(0, 0, size, 0);
  g2.addColorStop(0, `rgba(0,0,0,${strength})`); g2.addColorStop(width, 'rgba(0,0,0,0)');
  g2.addColorStop(1 - width, 'rgba(0,0,0,0)'); g2.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g2; ctx.fillRect(0, 0, size, size);
}

// per-tile bevel: light top-left, dark bottom-right
function bevelTile(ctx, x, y, w, h, strength = 0.22) {
  const b = Math.max(2, w * 0.06);
  ctx.fillStyle = `rgba(255,255,255,${strength})`;
  ctx.fillRect(x, y, w, b); ctx.fillRect(x, y, b, h);
  ctx.fillStyle = `rgba(0,0,0,${strength})`;
  ctx.fillRect(x, y + h - b, w, b); ctx.fillRect(x + w - b, y, b, h);
}

function toTexture(canvas, repeat = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = MAX_ANISO;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Cached tangent-space normal map for an existing color texture (matches its
// repeat), so tiled floors/walls/ramps gain real per-pixel relief that reacts
// to the moving sun instead of the flat lighting they had painted in.
const normalCache = new WeakMap();
export function normalMapFor(colorTex, strength = 1.6) {
  if (!colorTex || !colorTex.image) return null;
  if (normalCache.has(colorTex)) return normalCache.get(colorTex);
  const rep = colorTex.repeat ? colorTex.repeat.x : 1;
  const n = heightToNormal(colorTex.image, strength, rep);
  normalCache.set(colorTex, n);
  return n;
}

// Derive a tangent-space normal map from a canvas's luminance (Sobel). The
// relief that used to be painted into the albedo (bevels, leaf clumps, cracks)
// becomes real per-pixel bumps that catch the moving sun. colorSpace = linear.
export function heightToNormal(srcCanvas, strength = 1.6, repeat = 1) {
  const S = srcCanvas.width;
  const sctx = srcCanvas.getContext('2d');
  const src = sctx.getImageData(0, 0, S, S).data;
  const lum = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    lum[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
  }
  const [c, ctx] = makeCanvas(S);
  const out = ctx.createImageData(S, S);
  const at = (x, y) => lum[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const o = (y * S + x) * 4;
      out.data[o] = (nx * 0.5 + 0.5) * 255;
      out.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = MAX_ANISO;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function checkerTexture(colA = '#ff9a3d', colB = '#ffd23d', repeat = 4) {
  const key = `chk${colA}${colB}${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(512);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      const px = x * 256, py = y * 256;
      ctx.fillStyle = (x + y) % 2 ? colA : colB;
      ctx.fillRect(px, py, 256, 256);
      // soft radial sheen per tile
      const sh = ctx.createRadialGradient(px + 88, py + 88, 12, px + 128, py + 128, 240);
      sh.addColorStop(0, 'rgba(255,255,255,0.16)');
      sh.addColorStop(1, 'rgba(0,0,0,0.10)');
      ctx.fillStyle = sh;
      ctx.fillRect(px, py, 256, 256);
      bevelTile(ctx, px, py, 256, 256, 0.14);
    }
  grain(ctx, 512, 0.05, 2);
  const t = toTexture(c, repeat);
  cache.set(key, t);
  return t;
}

export function stripeTexture(colA = '#e34242', colB = '#ffffff', repeat = 6) {
  const key = `str${colA}${colB}${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = colA;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = colB;
  for (let i = -256; i < 256; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 256); ctx.lineTo(i + 256, 0);
    ctx.lineTo(i + 288, 0); ctx.lineTo(i + 32, 256);
    ctx.closePath(); ctx.fill();
  }
  edgeAO(ctx, 256, 0.3, 0.09);
  grain(ctx, 256, 0.06, 2);
  const t = toTexture(c, repeat);
  cache.set(key, t);
  return t;
}

export function dotTexture(base = '#3a8fd6', dot = '#9fd0ff', repeat = 4) {
  const key = `dot${base}${dot}${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const cx = x * 64 + (y % 2 ? 32 : 0) + 16, cy = y * 64 + 16;
      const g = ctx.createRadialGradient(cx - 4, cy - 5, 2, cx, cy, 15);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, dot);
      g.addColorStop(1, dot);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.arc(cx + 2, cy + 3, 14, Math.PI * 0.15, Math.PI * 0.85);
      ctx.fill();
    }
  grain(ctx, 256, 0.05, 2);
  const t = toTexture(c, repeat);
  cache.set(key, t);
  return t;
}

export function gridTexture(base = '#1c2f52', line = '#4de1ff', repeat = 8) {
  const key = `grd${base}${line}${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = line;
  ctx.lineWidth = 6;
  ctx.shadowColor = line;
  ctx.shadowBlur = 14;
  ctx.strokeRect(3, 3, 250, 250);
  const t = toTexture(c, repeat);
  cache.set(key, t);
  return t;
}

export function lavaTexture(repeat = 3) {
  if (cache.has('lava')) return cache.get('lava');
  const [c, ctx] = makeCanvas(256);
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 180);
  g.addColorStop(0, '#ffe14d');
  g.addColorStop(0.4, '#ff7b1c');
  g.addColorStop(1, '#a31700');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  // dark crust plates with glowing cracks between them
  for (let i = 0; i < 34; i++) {
    const x = (i * 97) % 256, y = (i * 61 + 40) % 256, r = 10 + (i * 13) % 28;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, 'rgba(40,6,2,0.9)');
    g.addColorStop(0.75, 'rgba(60,8,2,0.75)');
    g.addColorStop(1, 'rgba(255,140,30,0.0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // white-hot pinpoints
  for (let i = 0; i < 14; i++) {
    const x = hash(i * 5 + 3) * 256, y = hash(i * 9 + 4) * 256;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
    g.addColorStop(0, 'rgba(255,250,210,0.95)');
    g.addColorStop(1, 'rgba(255,150,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 8, y - 8, 16, 16);
  }
  grain(ctx, 256, 0.08, 2);
  const t = toTexture(c, repeat);
  cache.set('lava', t);
  return t;
}

export function jungleTexture(repeat = 4) {
  if (cache.has('jungle')) return cache.get('jungle');
  const [c, ctx] = makeCanvas(512);
  const base = ctx.createLinearGradient(0, 0, 512, 512);
  base.addColorStop(0, '#2f9143');
  base.addColorStop(0.5, '#2c8a3e');
  base.addColorStop(1, '#268038');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  // layered leaf clumps with lit tops and shadowed bases
  for (let i = 0; i < 220; i++) {
    const x = hash(i * 3 + 1) * 512, y = hash(i * 7 + 2) * 512;
    const rx = 18 + hash(i * 11) * 26, ry = 7 + hash(i * 13) * 10;
    const rot = hash(i * 17) * Math.PI;
    const shade = hash(i * 19);
    ctx.fillStyle = shade > 0.66 ? '#3cb254' : shade > 0.33 ? '#2f9a45' : '#1f6b30';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,240,0.10)';
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.2, y - ry * 0.45, rx * 0.7, ry * 0.45, rot, 0, Math.PI * 2);
    ctx.fill();
  }
  grain(ctx, 512, 0.07, 2);
  const t = toTexture(c, repeat);
  cache.set('jungle', t);
  return t;
}

export function goalTexture() {
  if (cache.has('goal')) return cache.get('goal');
  const [c, ctx] = makeCanvas(256);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * 64, y * 64, 64, 64);
    }
  const t = toTexture(c, 1);
  cache.set('goal', t);
  return t;
}

// Concentric dartboard rings for Sky Target mode
export function targetTexture() {
  if (cache.has('target')) return cache.get('target');
  const [c, ctx] = makeCanvas(512);
  const rings = [
    [1.0, '#1c2f52'], [0.66, '#e8f0ff'], [0.44, '#e34242'], [0.22, '#ffd23d'], [0.09, '#e34242']
  ];
  for (const [r, col] of rings) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(256, 256, 254 * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 4;
  for (const [r] of rings) {
    ctx.beginPath();
    ctx.arc(256, 256, 254 * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const t = toTexture(c, 1);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set('target', t);
  return t;
}

export function waterTexture(repeat = 20) {
  if (cache.has('water')) return cache.get('water');
  const [c, ctx] = makeCanvas(512);
  const deep = ctx.createLinearGradient(0, 0, 512, 512);
  deep.addColorStop(0, '#1a5fae');
  deep.addColorStop(0.45, '#14549b');
  deep.addColorStop(1, '#0e4383');
  ctx.fillStyle = deep;
  ctx.fillRect(0, 0, 512, 512);
  // broad swell shadows, layered two ways for a cross-chop look
  ctx.strokeStyle = 'rgba(6,28,62,0.30)';
  ctx.lineWidth = 22;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    const y = (i * 79 + 30) % 512;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(150, y + 34, 360, y - 34, 512, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(10,36,74,0.22)';
  ctx.lineWidth = 30;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    const x = (i * 113 + 60) % 512;
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x - 40, 170, x + 40, 340, x, 512);
    ctx.stroke();
  }
  // caustic crest web
  ctx.strokeStyle = 'rgba(190,230,255,0.35)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 16; i++) {
    ctx.beginPath();
    const y = (i * 67 + 13) % 512;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(128, y - 26, 300, y + 26, 512, y);
    ctx.stroke();
  }
  // sun glints & foam flecks
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const w = 3 + Math.random() * 14;
    ctx.fillStyle = Math.random() < 0.7 ? 'rgba(210,240,255,0.28)' : 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(x, y, w, 1.2 + Math.random() * 1.6, Math.random() * 0.6 - 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  grain(ctx, 512, 0.05, 2);
  const t = toTexture(c, repeat);
  cache.set('water', t);
  return t;
}

// Emoji/text sprite for power-up icons
export function iconSprite(text, bg = 'rgba(10,10,30,0.85)') {
  const key = `icon${text}${bg}`;
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(128);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.font = '64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

// Sky: big gradient dome texture per world theme
export function skyTexture(topCol, midCol, botCol) {
  const key = `sky${topCol}${midCol}${botCol}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = 32; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, topCol);
  g.addColorStop(0.55, midCol);
  g.addColorStop(1, botCol);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}
