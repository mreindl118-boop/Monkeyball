// Duel helpers: ball-vs-ball bumping (local duels), the interpolated opponent
// ghost (online duels), and the online handshake/session state machine.
import * as THREE from 'three';
import { NetSession } from './net.js';

const _n = new THREE.Vector3();

// Elastic-ish bump between two player balls (heavier rascal wins the shove).
export function collideBalls(b1, b2, w1, w2) {
  _n.copy(b1.pos).sub(b2.pos);
  const d = _n.length();
  const minD = b1.radius + b2.radius;
  if (d >= minD || d < 1e-6) return false;
  _n.divideScalar(d);
  const m1 = 1 + w1, m2 = 1 + w2;
  // positional separation weighted by mass
  const pen = minD - d;
  b1.pos.addScaledVector(_n, pen * (m2 / (m1 + m2)));
  b2.pos.addScaledVector(_n, -pen * (m1 / (m1 + m2)));
  // impulse along normal
  const rvx = b1.vel.x - b2.vel.x, rvy = b1.vel.y - b2.vel.y, rvz = b1.vel.z - b2.vel.z;
  const vn = rvx * _n.x + rvy * _n.y + rvz * _n.z;
  if (vn < 0) {
    const e = 0.75;
    const j = -(1 + e) * vn / (1 / m1 + 1 / m2);
    b1.vel.x += j * _n.x / m1; b1.vel.y += j * _n.y / m1; b1.vel.z += j * _n.z / m1;
    b2.vel.x -= j * _n.x / m2; b2.vel.y -= j * _n.y / m2; b2.vel.z -= j * _n.z / m2;
    return true;
  }
  return false;
}

// Remote player rendered from ~12Hz snapshots with smoothing.
export class Ghost {
  constructor(group) {
    this.group = group;           // a makeBallGroup(...) result
    this.target = new THREE.Vector3(0, 1, 0);
    this.prev = new THREE.Vector3(0, 1, 0);
    this.vel = new THREE.Vector3();
    this.hasData = false;
  }

  push(p) {
    this.prev.copy(this.group.group.position);
    this.target.set(p[0], p[1], p[2]);
    if (!this.hasData) {
      this.group.group.position.copy(this.target);
      this.hasData = true;
    }
    this.vel.copy(this.target).sub(this.prev).multiplyScalar(8);
  }

  update(dt) {
    if (!this.hasData) return;
    const g = this.group.group;
    g.position.lerp(this.target, Math.min(1, dt * 9));
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 1) {
      const yaw = Math.atan2(this.vel.x, this.vel.z);
      g.rotation.y += ((((yaw - g.rotation.y) + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 6);
    }
  }
}

// Online duel handshake:
//  host: connect -> create -> (peerJoined) -> recv char -> send char+start -> play
//  guest: connect -> join -> send char -> recv char+start -> play
export class DuelNet {
  constructor({ myCharId, onCode, onStart, onState, onEnd, onPeerLeft, onError }) {
    this.session = new NetSession();
    this.myCharId = myCharId;
    this.cb = { onCode, onStart, onState, onEnd, onPeerLeft, onError };
    this.peerChar = null;
    this.started = false;
    this.peerFinal = null;
    this.closed = false;

    this.session
      .on('created', (m) => this.cb.onCode && this.cb.onCode(m.code))
      .on('peerJoined', () => { /* guest will send char first */ })
      .on('joined', () => this.session.send({ t: 'char', id: this.myCharId }))
      .on('char', (m) => {
        this.peerChar = m.id;
        if (this.session.isHost && !this.started) {
          this.session.send({ t: 'char', id: this.myCharId });
          this.session.send({ t: 'start' });
          this.begin();
        } else if (!this.session.isHost && !this.started) {
          this.pendingChar = true;
        }
      })
      .on('start', () => { if (!this.session.isHost) this.begin(); })
      .on('s', (m) => this.cb.onState && this.cb.onState(m))
      .on('end', (m) => { this.peerFinal = m; this.cb.onEnd && this.cb.onEnd(m); })
      .on('peerLeft', () => this.cb.onPeerLeft && this.cb.onPeerLeft())
      .on('error', (m) => this.cb.onError && this.cb.onError(m.reason || 'Network error'))
      .on('closed', () => { if (!this.closed && !this.started) this.cb.onError && this.cb.onError('Connection lost'); });
  }

  begin() {
    if (this.started) return;
    this.started = true;
    this.cb.onStart && this.cb.onStart(this.peerChar);
  }

  async host(url) {
    await this.session.connect(url);
    this.session.createRoom();
  }

  async join(url, code) {
    await this.session.connect(url);
    this.session.joinRoom(code);
  }

  sendState(pos, bananas) {
    this.session.send({ t: 's', p: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)], b: bananas });
  }

  sendEnd(bananas) { this.session.send({ t: 'end', b: bananas }); }

  close() { this.closed = true; this.session.close(); }
}
