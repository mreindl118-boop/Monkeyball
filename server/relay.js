// Tiny WebSocket room relay for online duels.
// Rooms hold exactly 2 players; everything a client sends is forwarded to the
// other player in the room. No game logic lives here.
//   npm run relay          -> ws://localhost:8765/ws
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8765;

export function attachRelay(server) {
  const wss = server
    ? new WebSocketServer({ server, path: '/ws' })
    : new WebSocketServer({ port: PORT, path: '/ws' });

  const rooms = new Map(); // code -> [ws, ws]

  const code4 = () => {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0];
    return rooms.has(c) ? code4() : c;
  };

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.t === 'create') {
        const code = code4();
        rooms.set(code, [ws]);
        ws._room = code;
        ws.send(JSON.stringify({ t: 'created', code }));
      } else if (msg.t === 'join') {
        const code = String(msg.code || '').toUpperCase();
        const room = rooms.get(code);
        if (!room || room.length >= 2) {
          ws.send(JSON.stringify({ t: 'error', reason: room ? 'Room is full' : 'Room not found' }));
          return;
        }
        room.push(ws);
        ws._room = code;
        ws.send(JSON.stringify({ t: 'joined', code }));
        room[0].send(JSON.stringify({ t: 'peerJoined' }));
      } else if (ws._room) {
        // forward everything else to the other player
        const room = rooms.get(ws._room);
        if (!room) return;
        for (const peer of room) {
          if (peer !== ws && peer.readyState === 1) peer.send(raw.toString());
        }
      }
    });

    ws.on('close', () => {
      const code = ws._room;
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const rest = room.filter(p => p !== ws);
      if (rest.length === 0) rooms.delete(code);
      else {
        rooms.set(code, rest);
        for (const peer of rest) {
          if (peer.readyState === 1) peer.send(JSON.stringify({ t: 'peerLeft' }));
        }
      }
    });
  });

  console.log(`[relay] rooms ready ${server ? '(attached to host server)' : `on ws://0.0.0.0:${PORT}/ws`}`);
  return wss;
}

// standalone mode
if (import.meta.url === `file://${process.argv[1]}`) {
  attachRelay(null);
}
