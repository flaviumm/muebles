// Sirve la app y hace de señalización para y-webrtc (los datos del mueble viajan directo entre navegadores).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import api from './api/analizar.js';

const PORT = process.env.PORT || 5180;
const ROOT = import.meta.dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/analizar') return api(req, res);
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
    const file = join(ROOT, path || 'index.html');
    if (!file.startsWith(ROOT) || path.includes('node_modules')) return res.writeHead(403).end();
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('No encontrado');
  }
});

// Protocolo de y-webrtc: subscribe / unsubscribe / publish / ping.
const topics = new Map();
const wss = new WebSocketServer({ server, path: '/signal' });
wss.on('connection', ws => {
  const mine = new Set();
  const send = m => ws.readyState === 1 && ws.send(JSON.stringify(m));
  let alive = true;
  ws.on('pong', () => (alive = true));
  const beat = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 30000);
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'subscribe') for (const t of m.topics || []) { if (!topics.has(t)) topics.set(t, new Set()); topics.get(t).add(ws); mine.add(t); }
    else if (m.type === 'unsubscribe') for (const t of m.topics || []) { topics.get(t)?.delete(ws); mine.delete(t); }
    else if (m.type === 'publish') { const subs = topics.get(m.topic); if (subs) { m.clients = subs.size; const out = JSON.stringify(m); for (const c of subs) c.readyState === 1 && c.send(out); } }
    else if (m.type === 'ping') send({ type: 'pong' });
  });
  ws.on('close', () => {
    clearInterval(beat);
    for (const t of mine) { const s = topics.get(t); s?.delete(ws); if (s?.size === 0) topics.delete(t); }
  });
});

server.listen(PORT, () => console.log(`Madera en http://localhost:${PORT}`));
