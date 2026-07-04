// Custom arcade ball physics — sphere vs oriented boxes / cylinders,
// moving-platform carry, bumpers, launch pads, tilt-flavored acceleration.
// Tuned for Monkey-Ball-ish feel: heavy gravity, grippy floors, bouncy walls.
import * as THREE from 'three';

export const GRAVITY = 24;
export const BALL_RADIUS = 0.55;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Ball {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();      // angular velocity for visual rolling
    this.radius = BALL_RADIUS;
    this.onGround = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.airTime = 0;
    this.slowFall = 0;                    // seconds of slow-fall remaining (glide/puff)
    this.gripBoost = 0;                   // seconds of extra grip (Kong Quake)
    this.shielded = 0;                    // seconds of bump immunity
    this.coyote = 0;                      // recently-grounded grace for jumps
  }

  reset(p) {
    this.pos.set(p[0], p[1], p[2]);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.onGround = false;
    this.airTime = 0;
    this.slowFall = 0;
    this.gripBoost = 0;
    this.shielded = 0;
    this.coyote = 0;
  }
}

// solid: { pos:Vector3, quat:Quaternion, half:Vector3, shape:'box'|'disc', velAt(point,out) }
export function collideSphereSolid(ball, solid, events) {
  const c = ball.pos;
  if (solid.shape === 'disc') {
    // vertical cylinder: radius half.x, halfHeight half.y (axis-aligned Y; spinners are flat)
    const dx = c.x - solid.pos.x;
    const dz = c.z - solid.pos.z;
    const dy = c.y - solid.pos.y;
    const radial = Math.hypot(dx, dz);
    const R = solid.half.x, H = solid.half.y;
    // closest point on cylinder to sphere center
    const cr = Math.min(radial, R);
    const cy = Math.max(-H, Math.min(H, dy));
    let px, pz;
    if (radial > 1e-6) { px = dx / radial * cr; pz = dz / radial * cr; }
    else { px = 0; pz = 0; }
    _v1.set(solid.pos.x + px, solid.pos.y + cy, solid.pos.z + pz);
    return resolveContact(ball, solid, _v1, events);
  }
  // OBB: transform into local space
  _v1.copy(c).sub(solid.pos);
  _q.copy(solid.quat).invert();
  _v1.applyQuaternion(_q);
  const h = solid.half;
  _v2.set(
    Math.max(-h.x, Math.min(h.x, _v1.x)),
    Math.max(-h.y, Math.min(h.y, _v1.y)),
    Math.max(-h.z, Math.min(h.z, _v1.z))
  );
  // sphere center inside the box: push out along the axis of least penetration
  if (_v2.equals(_v1)) {
    const px = h.x - Math.abs(_v1.x), py = h.y - Math.abs(_v1.y), pz = h.z - Math.abs(_v1.z);
    if (px < py && px < pz) _v2.x = _v1.x >= 0 ? h.x : -h.x;
    else if (py < pz) _v2.y = _v1.y >= 0 ? h.y : -h.y;
    else _v2.z = _v1.z >= 0 ? h.z : -h.z;
  }
  _v2.applyQuaternion(solid.quat).add(solid.pos);
  return resolveContact(ball, solid, _v2, events);
}

function resolveContact(ball, solid, closest, events) {
  _v3.copy(ball.pos).sub(closest);
  const dist = _v3.length();
  if (dist >= ball.radius || dist < 1e-9) return false;

  const n = _v3.normalize();
  const pen = ball.radius - dist;
  ball.pos.addScaledVector(n, pen);

  // platform surface velocity at contact
  const platVel = solid.velAt ? solid.velAt(closest, _v1.set(0, 0, 0)) : _v1.set(0, 0, 0);

  // relative velocity
  _v2.copy(ball.vel).sub(platVel);
  const vn = _v2.dot(n);
  if (vn < 0) {
    const restitution = n.y > 0.6 ? 0.12 : 0.42;   // floors damp, walls bounce
    ball.vel.addScaledVector(n, -vn * (1 + restitution));
    if (n.y <= 0.6 && vn < -4 && events) events.push({ type: 'wallhit', speed: -vn });
  }
  if (n.y > 0.55) {
    ball.onGround = true;
    ball.groundNormal.copy(n);
    ball.groundVel = ball.groundVel || new THREE.Vector3();
    ball.groundVel.copy(platVel);
  }
  return true;
}

export function stepBall(ball, dt, opts) {
  const {
    solids, bumpers, input, camYaw, stats, upgrades, events,
    jumpVel, accel, traction, weightFactor
  } = opts;

  ball.onGround = false;
  if (ball.groundVel) ball.groundVel.set(0, 0, 0);

  // gravity (slow-fall reduces it while descending)
  let g = GRAVITY * (0.9 + weightFactor * 0.2);
  if (ball.slowFall > 0 && ball.vel.y < 0) g *= 0.16;
  ball.vel.y -= g * dt;

  // input acceleration in camera space
  const ix = input.x, iy = input.y;
  if (ix !== 0 || iy !== 0) {
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    // forward = -z rotated by camYaw
    const ax = (ix * cos - iy * sin);
    const az = (ix * sin + iy * cos);
    const control = ball.onGroundLast ? 1 : 0.36;   // decent air control, stronger on ground
    ball.vel.x += ax * accel * control * dt;
    ball.vel.z += az * accel * control * dt;
  }

  // integrate
  ball.pos.addScaledVector(ball.vel, dt);

  // collide (a few iterations for stability on seams)
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    for (const s of solids) {
      if (collideSphereSolid(ball, s, iter === 0 ? events : null)) any = true;
    }
    if (!any) break;
  }

  // bumpers
  for (const b of bumpers) {
    const dx = ball.pos.x - b.pos.x, dz = ball.pos.z - b.pos.z;
    const dy = ball.pos.y - b.pos.y;
    if (Math.abs(dy) > 1.6) continue;
    const d = Math.hypot(dx, dz);
    const minD = b.r + ball.radius;
    if (d < minD && d > 1e-6) {
      const nx = dx / d, nz = dz / d;
      ball.pos.x = b.pos.x + nx * minD;
      ball.pos.z = b.pos.z + nz * minD;
      if (ball.shielded <= 0) {
        const punch = 14 / (0.7 + weightFactor);   // heavies shrug bumpers off
        const vdotn = ball.vel.x * nx + ball.vel.z * nz;
        if (vdotn < 0) { ball.vel.x -= vdotn * nx * 2; ball.vel.z -= vdotn * nz * 2; }
        ball.vel.x += nx * punch;
        ball.vel.z += nz * punch;
        ball.vel.y += 3.5 / (0.7 + weightFactor);
        events.push({ type: 'bumper' });
      }
    }
  }

  // ground friction & platform carry
  if (ball.onGround) {
    ball.airTime = 0;
    ball.coyote = 0.12;
    const pv = ball.groundVel || _v1.set(0, 0, 0);
    // damp velocity relative to the platform (rolling resistance).
    // slopes get slick (grip falls off fast as the surface tilts), so ramps
    // actually accelerate you downhill instead of friction eating the run —
    // the heart of the Monkey Ball feel.
    const slope = Math.pow(Math.max(ball.groundNormal.y, 0), 6);
    const grip = traction * slope * (ball.gripBoost > 0 ? 2.2 : 1);
    const f = Math.exp(-grip * dt);
    ball.vel.x = pv.x + (ball.vel.x - pv.x) * f;
    ball.vel.z = pv.z + (ball.vel.z - pv.z) * f;
  } else {
    ball.airTime += dt;
    ball.coyote = Math.max(0, ball.coyote - dt);
    // light air drag
    const f = Math.exp(-0.08 * dt);
    ball.vel.x *= f; ball.vel.z *= f;
  }
  ball.onGroundLast = ball.onGround || ball.coyote > 0;

  // jump
  if (input.jump && (ball.onGround || ball.coyote > 0)) {
    ball.vel.y = Math.max(ball.vel.y, jumpVel);
    ball.coyote = 0;
    events.push({ type: 'jump' });
  }

  // soft speed cap (raised for the bigger stages)
  const hs = Math.hypot(ball.vel.x, ball.vel.z);
  const cap = 31;
  if (hs > cap) {
    const k = cap / hs;
    ball.vel.x *= k; ball.vel.z *= k;
  }

  // timers
  ball.slowFall = Math.max(0, ball.slowFall - dt);
  ball.gripBoost = Math.max(0, ball.gripBoost - dt);
  ball.shielded = Math.max(0, ball.shielded - dt);

  // visual spin from horizontal motion (roll axis = up × vel)
  ball.spin.set(ball.vel.z / ball.radius, 0, -ball.vel.x / ball.radius);
}
