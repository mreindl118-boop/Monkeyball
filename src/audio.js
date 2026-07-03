// Procedural WebAudio: SFX + a looping chiptune-ish soundtrack. No audio files needed.
import { getSave } from './save.js';

let ctx = null;
let musicGain = null, sfxGain = null;
let musicTimer = null;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain.gain.value = 0.16;
    sfxGain.gain.value = 0.5;
    musicGain.connect(ctx.destination);
    sfxGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// call on first user gesture
export function unlockAudio() { ensureCtx(); }

function env(node, t0, a = 0.005, d = 0.15, peak = 1) {
  node.gain.setValueAtTime(0, t0);
  node.gain.linearRampToValueAtTime(peak, t0 + a);
  node.gain.exponentialRampToValueAtTime(0.001, t0 + a + d);
}

function blip(freq, dur = 0.12, type = 'square', peak = 0.4, dest = null) {
  if (!getSave().settings.sfx) return;
  const ac = ensureCtx();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  env(g, ac.currentTime, 0.004, dur, peak);
  o.connect(g).connect(dest || sfxGain);
  o.start();
  o.stop(ac.currentTime + dur + 0.05);
}

export const sfx = {
  menu() { blip(660, 0.08, 'square', 0.3); },
  select() { blip(520, 0.06); setTimeout(() => blip(780, 0.1), 60); },
  banana() {
    blip(880, 0.07, 'square', 0.35);
    setTimeout(() => blip(1320, 0.12, 'square', 0.3), 55);
  },
  bunch() {
    [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => blip(f, 0.1, 'square', 0.32), i * 55));
  },
  jump() { sweep(300, 700, 0.18, 'sine', 0.35); },
  bounce() { sweep(200, 90, 0.14, 'triangle', 0.4); },
  dash() { sweep(200, 900, 0.25, 'sawtooth', 0.3); noise(0.18, 0.15); },
  goal() {
    [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.4), i * 90));
  },
  fall() { sweep(700, 60, 0.9, 'sawtooth', 0.35); },
  tick() { blip(1200, 0.04, 'square', 0.22); },
  buy() { [784, 988, 1175].forEach((f, i) => setTimeout(() => blip(f, 0.12, 'triangle', 0.35), i * 70)); },
  denied() { blip(180, 0.2, 'sawtooth', 0.3); },
  bumper() { sweep(120, 400, 0.1, 'square', 0.45); },
  launch() { sweep(150, 1200, 0.5, 'sawtooth', 0.35); noise(0.3, 0.2); },
  glide() { noise(0.25, 0.08); },
  ready() { blip(988, 0.15, 'triangle', 0.35); },
  go() { blip(1318, 0.3, 'triangle', 0.45); },
  ability() { sweep(400, 1600, 0.3, 'square', 0.3); }
};

function sweep(f0, f1, dur, type = 'sine', peak = 0.4) {
  if (!getSave().settings.sfx) return;
  const ac = ensureCtx();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), ac.currentTime + dur);
  env(g, ac.currentTime, 0.01, dur, peak);
  o.connect(g).connect(sfxGain);
  o.start();
  o.stop(ac.currentTime + dur + 0.05);
}

function noise(dur = 0.2, peak = 0.2) {
  if (!getSave().settings.sfx) return;
  const ac = ensureCtx();
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = peak;
  src.connect(g).connect(sfxGain);
  src.start();
}

// ---------------- music ----------------
// Simple pattern sequencer. Each theme: bass line + lead + hat.
const THEMES = {
  menu: {
    bpm: 112,
    bass: [130.8, 0, 130.8, 0, 98, 0, 110, 0, 130.8, 0, 130.8, 0, 146.8, 0, 110, 0],
    lead: [523, 0, 659, 784, 0, 659, 0, 523, 587, 0, 698, 880, 0, 698, 0, 587],
  },
  jungle: {
    bpm: 128,
    bass: [98, 98, 0, 98, 123, 0, 98, 0, 87, 87, 0, 87, 110, 0, 123, 0],
    lead: [392, 0, 494, 0, 587, 494, 0, 392, 349, 0, 440, 0, 523, 440, 0, 349],
  },
  sky: {
    bpm: 120,
    bass: [110, 0, 0, 110, 0, 110, 0, 0, 130.8, 0, 0, 130.8, 0, 123, 0, 0],
    lead: [659, 587, 0, 523, 0, 659, 784, 0, 880, 784, 0, 659, 0, 587, 523, 0],
  },
  volcano: {
    bpm: 140,
    bass: [82, 82, 82, 0, 82, 0, 98, 98, 73, 73, 73, 0, 73, 0, 87, 98],
    lead: [330, 0, 392, 330, 0, 494, 440, 0, 294, 0, 349, 294, 0, 440, 392, 0],
  }
};

let curTheme = null;

export function playMusic(themeName) {
  if (curTheme === themeName && musicTimer) return;
  stopMusic();
  curTheme = themeName;
  if (!getSave().settings.music) return;
  const theme = THEMES[themeName] || THEMES.menu;
  const ac = ensureCtx();
  let step = 0;
  const stepDur = 60 / theme.bpm / 2; // 8th notes
  musicTimer = setInterval(() => {
    if (!getSave().settings.music) return;
    const t0 = ac.currentTime;
    const i = step % 16;
    const b = theme.bass[i];
    if (b) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.value = b;
      env(g, t0, 0.01, stepDur * 0.9, 0.8);
      o.connect(g).connect(musicGain); o.start(t0); o.stop(t0 + stepDur);
    }
    const l = theme.lead[i];
    if (l) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = l;
      env(g, t0, 0.01, stepDur * 0.7, 0.28);
      o.connect(g).connect(musicGain); o.start(t0); o.stop(t0 + stepDur);
    }
    if (i % 2 === 0) { // hat
      const len = Math.floor(ac.sampleRate * 0.03);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < len; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / len);
      const src = ac.createBufferSource(); src.buffer = buf;
      const g = ac.createGain(); g.gain.value = i % 4 === 0 ? 0.35 : 0.18;
      src.connect(g).connect(musicGain); src.start(t0);
    }
    step++;
  }, stepDur * 1000);
}

export function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  curTheme = null;
}

// backgrounding: silence everything when the app is minimized
let pausedTheme = null;
export function suspendAudio() {
  pausedTheme = curTheme;
  stopMusic();
  if (ctx && ctx.state === 'running') ctx.suspend();
}
export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
  if (pausedTheme) { playMusic(pausedTheme); pausedTheme = null; }
}

export function refreshMusic() {
  // toggle handling: restart or stop based on settings
  const t = curTheme;
  stopMusic();
  if (t && getSave().settings.music) playMusic(t);
}
