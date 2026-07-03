// One-command game host: serves the built game (dist/) AND the duel relay on
// the same port, so friends on your network (or the internet, if forwarded)
// can play by opening http://<your-ip>:8080 — online duels work out of the box.
//   npm run host
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { attachRelay } from './relay.js';

const PORT = process.env.PORT || 8080;
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json'
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = join(DIST, p);
  if (f.startsWith(DIST) && existsSync(f)) {
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

attachRelay(server);
server.listen(PORT, () => {
  console.log(`[host] game + relay at http://0.0.0.0:${PORT}  (share your LAN IP with player 2)`);
});
