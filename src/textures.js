// Procedural texture generation — no external assets, everything drawn on canvases.
import * as THREE from 'three';

const cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, repeat = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function checkerTexture(colA = '#ff9a3d', colB = '#ffd23d', repeat = 4) {
  const key = `chk${colA}${colB}${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(256);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      ctx.fillStyle = (x + y) % 2 ? colA : colB;
      ctx.fillRect(x * 128, y * 128, 128, 128);
    }
  // subtle inner glow lines for arcade feel
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 252);
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
  ctx.fillStyle = dot;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      ctx.beginPath();
      ctx.arc(x * 64 + (y % 2 ? 32 : 0) + 16, y * 64 + 16, 14, 0, Math.PI * 2);
      ctx.fill();
    }
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
  ctx.fillStyle = 'rgba(60,5,0,0.55)';
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    const x = (i * 97) % 256, y = (i * 61 + 40) % 256, r = 8 + (i * 13) % 26;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = toTexture(c, repeat);
  cache.set('lava', t);
  return t;
}

export function jungleTexture(repeat = 4) {
  if (cache.has('jungle')) return cache.get('jungle');
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = '#2c8a3e';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    const x = (i * 83) % 256, y = (i * 47) % 256;
    ctx.fillStyle = i % 2 ? '#37a44c' : '#237334';
    ctx.beginPath();
    ctx.ellipse(x, y, 20, 9, (i * 0.7) % Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
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
