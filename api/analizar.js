// Visión: foto → parámetros del mueble. En Vercel es una función; en local la usa server.js.
// La clave queda en el servidor (ANTHROPIC_API_KEY). Los rangos se recortan en el navegador con los mismos LIMITS de la UI.
import Anthropic from '@anthropic-ai/sdk';
import { FINISH_HEX } from '../model.js';

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

export default async function api(req, res) {
  const send = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (req.method !== 'POST') return send(405, { error: 'Usá POST' });
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
