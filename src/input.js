// Unified input: keyboard (WASD/arrows), gamepad left stick, touch virtual joystick,
// optional device-tilt on mobile. Produces x/y in [-1,1] plus jump & ability edges.
import { getSave } from './save.js';

const keys = new Set();
let touchVec = { x: 0, y: 0 };
let tiltVec = { x: 0, y: 0 };
let jumpQueued = false, abilityQueued = false;
let jumpHeldNow = false;
let pauseCb = null;

export function onPause(cb) { pauseCb = cb; }

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') { jumpQueued = true; jumpHeldNow = true; }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') abilityQueued = true;
  if (e.code === 'Escape' || e.code === 'KeyP') pauseCb && pauseCb();
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Space') jumpHeldNow = false;
});

// ---------------- touch joystick ----------------
export function initTouch() {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add('touch');

  const zone = document.getElementById('joy-zone');
  const base = document.getElementById('joy-base');
  const stick = document.getElementById('joy-stick');
  let activeId = null, cx = 0, cy = 0;
  const RADIUS = 55;

  function setStick(dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx = dx / len * RADIUS; dy = dy / len * RADIUS; }
    stick.style.left = (cx + dx - 29) + 'px';
    stick.style.top = (cy + dy - 29) + 'px';
    touchVec.x = dx / RADIUS;
    touchVec.y = dy / RADIUS;
  }

  zone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    activeId = t.identifier;
    cx = t.clientX; cy = t.clientY;
    base.style.left = (cx - 65) + 'px';
    base.style.top = (cy - 65) + 'px';
    base.style.display = 'block';
    stick.style.display = 'block';
    setStick(0, 0);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (activeId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier === activeId) setStick(t.clientX - cx, t.clientY - cy);
    }
  }, { passive: false });

  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === activeId) {
        activeId = null;
        base.style.display = 'none';
        stick.style.display = 'none';
        touchVec.x = 0; touchVec.y = 0;
      }
    }
  });

  const bJump = document.getElementById('btn-jump');
  const bAb = document.getElementById('btn-ability');
  const bPause = document.getElementById('btn-pause');
  bJump.addEventListener('touchstart', (e) => { jumpQueued = true; jumpHeldNow = true; e.preventDefault(); }, { passive: false });
  bJump.addEventListener('touchend', () => { jumpHeldNow = false; });
  bAb.addEventListener('touchstart', (e) => { abilityQueued = true; e.preventDefault(); }, { passive: false });
  bPause.addEventListener('click', () => pauseCb && pauseCb());

  // device tilt (opt-in via settings)
  window.addEventListener('deviceorientation', (e) => {
    if (!getSave().settings.tilt) { tiltVec.x = 0; tiltVec.y = 0; return; }
    // gamma: left/right [-90..90], beta: front/back
    tiltVec.x = Math.max(-1, Math.min(1, (e.gamma || 0) / 28));
    tiltVec.y = Math.max(-1, Math.min(1, ((e.beta || 0) - 40) / 28));
  });
}

export async function requestTiltPermission() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      const res = await DeviceOrientationEvent.requestPermission();
      return res === 'granted';
    }
  } catch (e) { /* not supported */ }
  return true;
}

// ---------------- polling ----------------
export function pollInput() {
  let x = 0, y = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) y -= 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;

  // gamepad
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const gx = p.axes[0] || 0, gy = p.axes[1] || 0;
    if (Math.abs(gx) > 0.12) x += gx;
    if (Math.abs(gy) > 0.12) y += gy;
    if (p.buttons[0]?.pressed) { if (!pollInput._gpJump) { jumpQueued = true; } pollInput._gpJump = true; jumpHeldNow = true; }
    else { pollInput._gpJump = false; }
    if (p.buttons[2]?.pressed || p.buttons[1]?.pressed) { if (!pollInput._gpAb) abilityQueued = true; pollInput._gpAb = true; }
    else pollInput._gpAb = false;
    if (p.buttons[9]?.pressed) { if (!pollInput._gpPause) pauseCb && pauseCb(); pollInput._gpPause = true; }
    else pollInput._gpPause = false;
  }

  x += touchVec.x + tiltVec.x;
  y += touchVec.y + tiltVec.y;

  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }

  const jump = jumpQueued; jumpQueued = false;
  const ability = abilityQueued; abilityQueued = false;
  return { x, y, jump, ability, jumpHeld: jumpHeldNow };
}

export function clearInput() {
  jumpQueued = false; abilityQueued = false;
  touchVec.x = 0; touchVec.y = 0;
}
