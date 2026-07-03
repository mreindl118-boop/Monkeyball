// WebSocket duel client. Talks to server/relay.js (room-code relay).
// Default server = same origin (/ws) which "just works" with `npm run host`
// and the vite dev proxy; a custom relay URL can be passed for hosted relays.

export class NetSession {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.connected = false;
    this.room = null;
    this.isHost = false;
  }

  on(t, cb) { this.handlers[t] = cb; return this; }
  emit(t, msg) { this.handlers[t] && this.handlers[t](msg); }

  defaultUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      const target = url || this.defaultUrl();
      let settled = false;
      try {
        this.ws = new WebSocket(target);
      } catch (e) { reject(e); return; }
      const timer = setTimeout(() => {
        if (!settled) { settled = true; this.ws.close(); reject(new Error('Connection timed out')); }
      }, 6000);
      this.ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connected = true;
        resolve();
      };
      this.ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Could not reach relay server')); }
      };
      this.ws.onclose = () => {
        this.connected = false;
        this.emit('closed', {});
      };
      this.ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'created') { this.room = msg.code; this.isHost = true; }
        if (msg.t === 'joined') { this.room = msg.code; this.isHost = false; }
        this.emit(msg.t, msg);
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  createRoom() { this.send({ t: 'create' }); }
  joinRoom(code) { this.send({ t: 'join', code }); }

  close() {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this.connected = false;
    this.ws = null;
  }
}
