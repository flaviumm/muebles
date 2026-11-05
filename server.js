// Sirve la app y hace de señalización para y-webrtc (los datos del mueble viajan directo entre navegadores).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import Anthropic from '@anthropic-ai/sdk';
import { FINISH_HEX } from './model.js';

const PORT = process.env.PORT || 5180;
const ROOT = import.meta.dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

// ---------- Visión: foto → parámetros del mueble ----------
// La clave queda en el servidor (ANTHROPIC_API_KEY). Los rangos se recortan en el navegador con los mismos LIMITS de la UI.
const num = { type: 'integer' }, bool = { type: 'boolean' }, str = { type: 'string' };
const finish = { type: 'string', enum: Object.keys(FINISH_HEX) };
const FIELDS = { name: str, iron: bool, W: num, H: num, D: num, t: num, columns: num, shelves: num, drawers: num, drawerH: num, doors: bool, legs: num, tube: num, body: finish, front: finish, notes: str };
const SCHEMA = { type: 'object', properties: FIELDS, required: Object.keys(FIELDS), additionalProperties: false };
const PROMPT = `Sos un diseñador de muebles. Mirá la foto y devolvé los parámetros para reproducir el mueble en un configurador paramétrico. Todas las medidas en mm; estimá con medidas estándar (altura de mesada ~900, mesa ~750, profundidad de placard ~600) cuando no haya referencia de escala.
Reglas del configurador:
- La madera es siempre MDF; t = espesor de placa (normalmente 18).
- iron = true si el mueble tiene estructura de hierro / caño (estilo industrial). En ese caso: tube = lado del caño cuadrado (20 a 60), shelves = cantidad de niveles de MDF sin contar la tapa (mínimo 1), legs = altura del nivel más bajo sobre el piso, drawers = 0, doors = false.
- Si no es de hierro: es un cuerpo de placas con columnas verticales iguales; shelves = estantes por columna, drawers = cajones por columna (abajo), drawerH = alto de cada cajón, doors = si la zona sobre los cajones tiene puertas, legs = altura de patas (0 si apoya en zócalo o piso). tube = 40.
- H = alto total menos legs. W 300–2400, H 300–2600, D 250–800, columns 1–4, shelves 0–10, drawers 0–8, legs 0–300.
- body y front: la melamina Faplac del catálogo que más se parezca al cuerpo y a los frentes de la foto.
- name: nombre corto del mueble. notes: en una o dos frases, qué simplificaste o no se puede representar.`;

let claude;
async function analyze(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw Object.assign(new Error('Imagen inválida'), { status: 400 });
  claude ||= new Anthropic();
  const r = await claude.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
      { type: 'text', text: PROMPT },
    ] }],
  });
  if (r.stop_reason === 'refusal') throw Object.assign(new Error('El modelo no pudo analizar esta imagen'), { status: 422 });
  if (r.stop_reason === 'max_tokens') throw new Error('Respuesta incompleta del modelo');
  return JSON.parse(r.content.find(b => b.type === 'text').text);
}

async function readJSON(req, max = 10e6) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    if ((size += c.length) > max) throw Object.assign(new Error('Imagen demasiado grande'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks));
}

async function api(req, res) {
  const send = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  try {
    send(200, await analyze((await readJSON(req)).image));
  } catch (err) {
    console.error(err);
    // Sin credenciales el SDK tira un Error común, no un APIError.
    if (err instanceof Anthropic.AuthenticationError || err.message.startsWith('Could not resolve authentication'))
      return send(500, { error: 'Falta configurar ANTHROPIC_API_KEY en el servidor' });
    if (err instanceof Anthropic.RateLimitError) return send(429, { error: 'Demasiados pedidos, probá en un minuto' });
    if (err instanceof Anthropic.APIError) return send(502, { error: `Error de la API (${err.status})` });
    send(err.status || 500, { error: err.message });
  }
}

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
