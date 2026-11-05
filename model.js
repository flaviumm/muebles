// Modelo puro: parámetros → piezas, lista de cortes, acomodo en placas, presupuesto.
// Sin DOM ni three.js para poder testearlo con node (ver test.mjs). Todo en mm.

export const BACK_T = 3;
export const SHEET = { w: 2750, h: 1830, kerf: 4 };
export const BAR = { len: 6000, kerf: 3 }; // barras de caño de 6 m, corte con amoladora
export const PRICES = { sheet: 95000, mdf3: 25000, edge: 600, hinge: 2500, slide: 9000, handle: 3000, leg: 2000, bar: 30000, paint: 18000, cap: 400 };

// Catálogo de melaminas Faplac (faplaconline.com.ar, 2026-10), sin diseños discontinuados.
// ponytail: el hex es una aproximación a ojo de la muestra, solo para la vista; confirmar con la placa real.
export const FINISHES = {
  'Línea Lisos': [['Blanco Tundra', '#f4f3ef'], ['Litio', '#d9d9d6'], ['Almendra', '#e6dccb'], ['Ceniza', '#b7b4ae'], ['Aluminio', '#a9aaa8'], ['Gris Humo', '#8f8d89'], ['Grafito', '#4a4a4a'], ['Negro Profundo', '#1e1e1e']],
  'Línea Maderas clásicas': [['Roble Americano Nature', '#c39a6b'], ['Roble Dakar Woodtext', '#b98a5a'], ['Cedro Woodtext', '#9a5f3c'], ['Ebano Negro', '#2a2421']],
  'Línea Nature': [['Blanco Nature', '#f1efe9'], ['Mont Blanc', '#ece8e0'], ['Teka Artico', '#c7ad8c'], ['Cajú', '#c49a6c'], ['Gaudí', '#b08a64'], ['Venezia', '#a58560'], ['Carvalho Mezzo', '#a8835a'], ['Nogal Terracota', '#7a4b30'], ['Nocce Milano', '#6a4a35']],
  'Línea Nórdica': [['Roble Escandinavo', '#d3b78f'], ['Helsinki', '#d9c6a5'], ['Báltico', '#cbbfae'], ['Olmo Finlandés', '#c9a77c']],
  'Línea Mesopotamia': [['Kiri', '#d6b98f'], ['Yute', '#c2a77f'], ['Paraíso', '#a0714a'], ['Petiribí', '#8a6240'], ['Terracota', '#b0603f'], ['Gris Caliza', '#c9c4bb'], ['Gris Tapir', '#8d8780'], ['Gris Basalto', '#5b5a57'], ['Amatista', '#6e5c6e'], ['Jade', '#6f8a7c']],
  'Línea Imperial': [['Beige Imperial', '#d8c7a8'], ['Travertino', '#d9cdb8'], ['Kisa', '#b89a7a'], ['Sándalo', '#b68a5e'], ['Castaño', '#7b5236'], ['Bordeaux', '#5e2a2c']],
  'Línea Blend': [['Camellia', '#e2cfc4'], ['Sauco', '#c8b49a'], ['Pinot Gris', '#a8a29a'], ['Scotch', '#a8743f'], ['Amaranto', '#7a4a3a'], ['Merlot', '#6b3a3a']],
  'Línea Urban Concept': [['Home', '#d8d2c8'], ['Viena', '#cfc6b8'], ['Coliseo', '#b9ab98'], ['Street', '#9a958e'], ['Amberes', '#8c8378'], ['Praga', '#6f6a64']],
  'Línea Étnica': [['Himalaya', '#e6e2da'], ['Everest', '#bfbcb5'], ['Sahara', '#d2b48c'], ['Safari', '#a88b62'], ['Tribal', '#8a6a4c'], ['Tuareg', '#4a5a6a']],
  'Línea Hilados': [['Lino Blanco', '#efece6'], ['Lino Chiaro', '#d8d0c0'], ['Seda Giorno', '#ddd6c8'], ['Seda Notte', '#4c4a48'], ['Lino Negro', '#2e2d2c']],
};
export const FINISH_HEX = Object.fromEntries(Object.values(FINISHES).flat());

const PLAIN = { iron: false, tube: 40 };
const IRON = { iron: true, drawers: 0, drawerH: 180, doors: false };
export const TEMPLATES = {
  closet: { name: 'Placard', W: 600, H: 1800, D: 500, t: 18, columns: 1, shelves: 4, drawers: 0, drawerH: 180, doors: true, legs: 0, ...PLAIN },
  doble: { name: 'Placard doble', W: 1200, H: 2000, D: 600, t: 18, columns: 2, shelves: 3, drawers: 2, drawerH: 200, doors: true, legs: 0, ...PLAIN },
  comoda: { name: 'Cómoda', W: 900, H: 800, D: 450, t: 18, columns: 1, shelves: 0, drawers: 4, drawerH: 180, doors: false, legs: 100, ...PLAIN },
  mesaluz: { name: 'Mesa de luz', W: 450, H: 450, D: 400, t: 18, columns: 1, shelves: 1, drawers: 1, drawerH: 150, doors: false, legs: 150, ...PLAIN },
  biblio: { name: 'Biblioteca industrial', W: 900, H: 1700, D: 350, t: 18, columns: 1, shelves: 4, legs: 100, tube: 30, ...IRON },
  mesa: { name: 'Mesa industrial', W: 1400, H: 600, D: 800, t: 18, columns: 1, shelves: 1, legs: 150, tube: 40, ...IRON },
  rack: { name: 'Rack TV industrial', W: 1600, H: 400, D: 400, t: 18, columns: 2, shelves: 1, legs: 150, tube: 30, ...IRON },
};

// Industrial: estructura soldada de caño cuadrado; cada nivel es un MDF apoyado sobre sus travesaños.
// Niveles = shelves + 1 (el último es la tapa); legs = altura del nivel más bajo.
function buildIron(p) {
  const { W, D, t } = p, T = p.tube;
  const Ht = p.H + p.legs, y0 = Math.max(p.legs, T);
  const pieces = [];
  const add = (name, kind, size, pos) => pieces.push({ id: pieces.length, name, kind, size, pos });
  const cols = Math.max(1, Math.min(p.columns, Math.floor((W - T) / (200 + T)))); // vanos de 200mm mínimo
  const n = Math.max(1, p.shelves);
  const px = c => -W / 2 + T / 2 + (c * (W - T)) / cols;
  const zs = [-D / 2 + T / 2, D / 2 - T / 2];

  for (let c = 0; c <= cols; c++) for (const z of zs) add('Parante', 'iron', [T, Ht - t, T], [px(c), (Ht - t) / 2, z]);
  for (let k = 0; k <= n; k++) {
    const y = y0 + (k * (Ht - t - y0)) / n; // cara superior del travesaño
    for (let c = 0; c < cols; c++) for (const z of zs) add('Travesaño', 'iron', [(W - T) / cols - T, T, T], [(px(c) + px(c + 1)) / 2, y - T / 2, z]);
    for (let c = 0; c <= cols; c++) add('Travesaño lateral', 'iron', [T, T, D - 2 * T], [px(c), y - T / 2, 0]);
    // Los estantes intermedios los atraviesan los parantes: van calados en las esquinas.
    add(k === n ? 'Tapa' : 'Estante (calado)', 'board', [W, t, D], [0, y + t / 2, 0]);
  }
  return { pieces, hw: { hinges: 0, slides: 0, handles: 0, legs: 0, caps: 2 * (cols + 1) } };
}

// Cada pieza: size = [x, y, z] del bloque, pos = centro. Origen en el piso, centro del mueble; +z hacia el frente.
export function build(p) {
  if (p.iron) return buildIron(p);
  const { W, H, D, t, legs } = p;
  const pieces = [];
  const add = (name, kind, size, pos) => pieces.push({ id: pieces.length, name, kind, size, pos });
  const hw = { hinges: 0, slides: 0, handles: 0, legs: legs ? 4 : 0, caps: 0 };

  const y0 = legs;
  const inW = W - 2 * t;
  const inBot = y0 + t, inTop = y0 + H - t, inH = inTop - inBot;
  const Dc = D - BACK_T, zc = BACK_T / 2;
  const cols = Math.max(1, Math.min(p.columns, Math.floor((inW + t) / (100 + t)))); // columnas de 100mm mínimo
  const colW = (inW - (cols - 1) * t) / cols;
  const colX = c => -inW / 2 + c * (colW + t) + colW / 2;
  const slotW = W / cols, slotX = c => -W / 2 + (c + 0.5) * slotW;
  const GAP = 3, fz = D / 2 + t / 2;

  add('Lateral', 'board', [t, H, Dc], [-W / 2 + t / 2, y0 + H / 2, zc]);
  add('Lateral', 'board', [t, H, Dc], [W / 2 - t / 2, y0 + H / 2, zc]);
  add('Base', 'board', [inW, t, Dc], [0, y0 + t / 2, zc]);
  add('Techo', 'board', [inW, t, Dc], [0, y0 + H - t / 2, zc]);
  add('Fondo', 'back', [W, H, BACK_T], [0, y0 + H / 2, -D / 2 + BACK_T / 2]);
  for (let c = 1; c < cols; c++) add('Divisor', 'board', [t, inH, Dc], [colX(c) - colW / 2 - t / 2, inBot + inH / 2, zc]);

  // Cajones abajo; si lo que sobra arriba no da para un hueco útil, los cajones lo absorben.
  const n = p.drawers;
  let zone = 0;
  if (n) {
    zone = Math.min(n * p.drawerH, inH);
    if (inH - zone < 100) zone = inH;
  }
  const dh = n ? zone / n : 0;
  const sep = n > 0 && zone < inH;

  for (let c = 0; c < cols; c++) {
    for (let k = 0; k < n; k++) {
      const yb = inBot + k * dh;
      const lo = k === 0 ? y0 : yb;
      const hi = k === n - 1 ? (sep ? inBot + zone + t / 2 : y0 + H) : yb + dh;
      add('Frente cajón', 'front', [slotW - GAP, hi - lo - GAP, t], [slotX(c), (lo + hi) / 2, fz]);
      // Caja con correderas laterales de 13mm por lado.
      const bw = colW - 26, bd = Math.max(Dc - 20, 100), bh = Math.max(dh - 50, 60);
      const by = yb + 20 + bh / 2, bz = D / 2 - bd / 2;
      add('Lateral cajón', 'board', [t, bh, bd], [colX(c) - bw / 2 + t / 2, by, bz]);
      add('Lateral cajón', 'board', [t, bh, bd], [colX(c) + bw / 2 - t / 2, by, bz]);
      add('Contrafrente cajón', 'board', [bw - 2 * t, bh, t], [colX(c), by, D / 2 - t / 2]);
      add('Trasera cajón', 'board', [bw - 2 * t, bh, t], [colX(c), by, D / 2 - bd + t / 2]);
      add('Piso cajón', 'back', [bw, BACK_T, bd], [colX(c), yb + 20 - BACK_T / 2, bz]);
      hw.slides++;
      hw.handles++;
    }
  }

  const ub = sep ? inBot + zone + t : n ? inTop : inBot;
  const uh = inTop - ub;
  for (let c = 0; c < cols; c++) {
    if (sep) add('Estante fijo', 'board', [colW, t, Dc], [colX(c), inBot + zone + t / 2, zc]);
    for (let s = 1; s <= p.shelves && uh > 0; s++)
      add('Estante', 'board', [colW, t, Dc - 20], [colX(c), ub + (s * uh) / (p.shelves + 1), zc - 10]);
  }

  if (p.doors && uh > 0) {
    const lo = sep ? inBot + zone + t / 2 : y0, hi = y0 + H, h = hi - lo - GAP;
    const per = cols === 1 && W >= 900 ? 2 : 1;
    const dw = slotW / per;
    for (let c = 0; c < cols; c++)
      for (let d = 0; d < per; d++) {
        add('Puerta', 'front', [dw - GAP, h, t], [-W / 2 + c * slotW + (d + 0.5) * dw, (lo + hi) / 2, fz]);
        hw.hinges += h > 1600 ? 4 : h > 900 ? 3 : 2;
        hw.handles++;
      }
  }

  if (legs) for (const sx of [-1, 1]) for (const sz of [-1, 1]) add('Pata', 'leg', [40, legs, 40], [sx * (W / 2 - 40), legs / 2, sz * (D / 2 - 40)]);

  return { pieces, hw };
}

// Agrupa piezas iguales. Tapacanto: frentes los 4 cantos, placas solo el canto largo visible (aprox).
// La madera es siempre MDF; los caños salen como filas `iron` (L = largo de corte, A = lado del caño).
// finish = { board, front }: nombre de melamina de cuerpo y frentes; cada color es una placa distinta.
export const THIN = `MDF ${BACK_T}mm`;
export function cutList(pieces, finish = {}) {
  const rows = new Map();
  for (const pc of pieces) {
    if (pc.kind === 'leg') continue;
    const [e, a, l] = [...pc.size].sort((x, y) => x - y);
    const L = Math.round(l), A = Math.round(a);
    const iron = pc.kind === 'iron';
    const color = finish[pc.kind];
    const mat = iron ? `Caño ${A}×${A}` : pc.kind === 'back' ? THIN : `MDF ${Math.round(e)}mm` + (color ? ` ${color}` : '');
    const key = [pc.name, mat, L, A].join('|');
    const r = rows.get(key) || { name: pc.name, mat, L, A, qty: 0, edge: 0, iron, color };
    r.qty++;
    r.edge += pc.kind === 'front' ? 2 * (L + A) : pc.kind === 'board' ? L : 0;
    rows.set(key, r);
  }
  // Ordenadas por placa (MDF de cuerpo/frentes, fondo, caños) y de mayor a menor, así el # queda seguido por material.
  const rank = r => (r.iron ? 2 : r.mat === THIN ? 1 : 0);
  return [...rows.values()]
    .sort((a, b) => rank(a) - rank(b) || a.mat.localeCompare(b.mat) || b.L * b.A - a.L * a.A || b.L - a.L)
    .map((r, i) => ({ ...r, ref: i + 1 }));
}

// Guillotina con "mejor ajuste por área": cada pieza va al hueco libre que menos sobra deja, y el hueco
// se parte por el eje del sobrante más corto. Con veta, el largo de la pieza va siempre a lo largo de la placa.
// ponytail: heurística greedy, no óptima; para nesting de producción usar un optimizador dedicado.
export function pack(rows, SW, SH, kerf = 4, grain = false) {
  const items = [], oversize = [];
  for (const r of rows)
    for (let i = 0; i < r.qty; i++) {
      const fits = (w, h) => w <= SW && h <= SH;
      if (fits(r.L, r.A) || (!grain && fits(r.A, r.L))) items.push({ name: r.name, ref: r.ref, L: r.L, A: r.A });
      else oversize.push(r.name);
    }
  items.sort((a, b) => b.L * b.A - a.L * a.A || b.L - a.L);

  const sheets = [];
  const newSheet = () => { const s = { free: [{ x: 0, y: 0, w: SW, h: SH }], parts: [] }; sheets.push(s); return s; };
  const best = (s, it) => {
    let pick = null;
    for (const f of s.free)
      for (const [w, h] of grain ? [[it.L, it.A]] : [[it.L, it.A], [it.A, it.L]])
        if (w <= f.w && h <= f.h) {
          const score = f.w * f.h - w * h;
          if (!pick || score < pick.score) pick = { f, w, h, score };
        }
    return pick;
  };
  for (const it of items) {
    let s = null, pick = null;
    for (const sh of sheets) { const p = best(sh, it); if (p && (!pick || p.score < pick.score)) { pick = p; s = sh; } }
    if (!pick) { s = newSheet(); pick = best(s, it); }
    const { f, w, h } = pick;
    s.parts.push({ name: it.name, ref: it.ref, x: f.x, y: f.y, w, h });
    s.free.splice(s.free.indexOf(f), 1);
    const rw = f.w - w - kerf, rh = f.h - h - kerf;
    const split = rw < rh
      ? [{ x: f.x + w + kerf, y: f.y, w: rw, h }, { x: f.x, y: f.y + h + kerf, w: f.w, h: rh }]
      : [{ x: f.x + w + kerf, y: f.y, w: rw, h: f.h }, { x: f.x, y: f.y + h + kerf, w, h: rh }];
    s.free.push(...split.filter(r => r.w > 0 && r.h > 0));
  }
  for (const s of sheets) Object.assign(s, { w: SW, h: SH, frac: 1, usage: s.parts.reduce((a, p) => a + p.w * p.h, 0) / (SW * SH) });
  return { sheets, oversize };
}

// Los distribuidores venden media placa y cuarto: la última placa se achica a la fracción más chica donde entra.
// Los ejes se mantienen (x = largo de la placa), así la veta sigue en la misma dirección.
// ponytail: solo se achica la última; si una del medio quedó medio vacía, el greedy no la reacomoda.
const FRACTIONS = [[0.25, true, true], [0.5, false, true], [0.5, true, false]]; // [fracción, partir largo, partir ancho]
export function shrinkLast(res, SW, SH, kerf = 4, grain = false) {
  const i = res.sheets.length - 1;
  if (i < 0) return res;
  const rows = res.sheets[i].parts.map(p => ({ name: p.name, ref: p.ref, L: p.w, A: p.h, qty: 1 }));
  const half = n => Math.floor((n - kerf) / 2);
  for (const [frac, cutW, cutH] of FRACTIONS) {
    const r = pack(rows, cutW ? half(SW) : SW, cutH ? half(SH) : SH, kerf, grain);
    if (r.sheets.length === 1 && !r.oversize.length) { res.sheets[i] = { ...r.sheets[0], frac }; break; }
  }
  return res;
}

// Primer ajuste decreciente sobre barras de largo fijo. Ninguna pieza supera 6 m con los límites de la UI.
export function cutBars(rows, len = BAR.len, kerf = BAR.kerf) {
  const items = rows.flatMap(r => Array(r.qty).fill(r)).sort((a, b) => b.L - a.L);
  const bars = [];
  for (const it of items) {
    let b = bars.find(b => b.used + it.L <= len);
    if (!b) bars.push((b = { used: 0, parts: [] }));
    b.parts.push({ name: it.name, ref: it.ref, x: b.used, L: it.L });
    b.used += it.L + kerf;
  }
  return bars;
}

export function budget(rows, hw, prices, sheet = SHEET, grain = false) {
  const byMat = {};
  for (const r of rows) if (!r.iron) (byMat[r.mat] ||= []).push(r);
  const mats = Object.entries(byMat).map(([mat, rs]) => {
    const g = grain && mat !== THIN;
    const r = shrinkLast(pack(rs, sheet.w, sheet.h, sheet.kerf, g), sheet.w, sheet.h, sheet.kerf, g);
    return { mat, ...r, qty: r.sheets.reduce((a, s) => a + s.frac, 0) };
  });
  const iron = rows.filter(r => r.iron);
  const bars = cutBars(iron);
  const ironM2 = iron.reduce((a, r) => a + 4 * r.A * r.L * r.qty, 0) / 1e6;
  const edges = {}; // tapacanto por color
  for (const r of rows) if (r.edge) edges[r.color ?? ''] = (edges[r.color ?? ''] || 0) + r.edge;
  const lines = [
    ...mats.map(m => ({ label: `${m.mat} (placas)`, qty: m.qty, key: m.mat === THIN ? 'mdf3' : 'sheet' })),
    ...Object.entries(edges).map(([c, mm]) => ({ label: `Tapacanto${c && ' ' + c} (m)`, qty: Math.ceil((mm / 1000) * 1.1), key: 'edge' })), // +10% desperdicio
    { label: `${iron[0]?.mat} (barras de ${BAR.len / 1000} m)`, qty: bars.length, key: 'bar' },
    // 1 mano de antióxido + 2 de esmalte a ~12 m²/l cada una.
    { label: 'Antióxido + esmalte (l)', qty: Math.ceil(ironM2 / 4), key: 'paint' },
    { label: 'Regatones', qty: hw.caps, key: 'cap' },
    { label: 'Bisagras', qty: hw.hinges, key: 'hinge' },
    { label: 'Correderas (par)', qty: hw.slides, key: 'slide' },
    { label: 'Manijas', qty: hw.handles, key: 'handle' },
    { label: 'Patas', qty: hw.legs, key: 'leg' },
  ].filter(l => l.qty > 0);
  const total = lines.reduce((a, l) => a + l.qty * prices[l.key], 0);
  return { mats, bars, lines, total };
}
