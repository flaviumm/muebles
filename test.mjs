import assert from 'node:assert/strict';
import { TEMPLATES, build, cutList, pack, shrinkLast, budget, PRICES, FINISHES, FINISH_HEX } from './model.js';

const count = (pieces, name) => pieces.filter(p => p.name === name).length;

for (const [k, tpl] of Object.entries(TEMPLATES)) {
  const { pieces } = build(tpl);
  for (const p of pieces) assert.ok(p.size.every(v => v > 0), `${k}: ${p.name} con medida <= 0`);
}

let m = build(TEMPLATES.closet);
assert.equal(count(m.pieces, 'Lateral'), 2);
assert.equal(count(m.pieces, 'Estante'), 4);
assert.equal(count(m.pieces, 'Puerta'), 1);
assert.equal(m.hw.hinges, 4); // puerta > 1600mm

m = build(TEMPLATES.doble);
assert.equal(count(m.pieces, 'Divisor'), 1);
assert.equal(count(m.pieces, 'Frente cajón'), 4);
assert.equal(count(m.pieces, 'Estante fijo'), 2);
assert.equal(m.hw.slides, 4);

m = build(TEMPLATES.comoda); // cajones absorben el sobrante: sin estante fijo ni puertas
assert.equal(count(m.pieces, 'Estante fijo'), 0);
assert.equal(count(m.pieces, 'Frente cajón'), 4);

// columnas imposibles se recortan
m = build({ ...TEMPLATES.closet, W: 300, columns: 4 });
assert.ok(count(m.pieces, 'Divisor') <= 1);

// packing
let r = pack([{ name: 'a', L: 1000, A: 500, qty: 3 }], 2750, 1830);
assert.equal(r.sheets.length, 1);
r = pack([{ name: 'a', L: 1800, A: 1800, qty: 2 }], 2750, 1830);
assert.equal(r.sheets.length, 2);
r = pack([{ name: 'big', L: 3000, A: 100, qty: 1 }], 2750, 1830);
assert.deepEqual(r.oversize, ['big']);
for (const s of pack(cutList(build(TEMPLATES.doble).pieces), 2750, 1830).sheets)
  for (const p of s.parts) assert.ok(p.x + p.w <= 2750 && p.y + p.h <= 1830, 'pieza fuera de placa');

const b = budget(cutList(build(TEMPLATES.doble).pieces), build(TEMPLATES.doble).hw, PRICES);
assert.ok(b.total > 0);
console.log('ok', b.lines.map(l => `${l.label}:${l.qty}`).join(', '));

// veta: sin rotar, el largo queda a lo largo de la placa
for (const s of pack(cutList(build(TEMPLATES.doble).pieces), 2750, 1830, 4, true).sheets)
  for (const p of s.parts) assert.ok(p.w >= p.h || p.w === p.h, 'pieza rotada con veta');
// se respetan límites y no se pisan
const solap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
for (const grain of [false, true])
  for (const s of pack(cutList(build({ ...TEMPLATES.doble, W: 2000 }).pieces), 2750, 1830, 4, grain).sheets)
    s.parts.forEach((a, i) => s.parts.slice(i + 1).forEach(b => assert.ok(!solap(a, b), 'piezas superpuestas')));
assert.equal(pack([{ name: 'x', L: 1900, A: 100, qty: 1 }], 1830, 2750, 4, true).oversize.length, 1);
console.log('ok veta');

// industrial: 4 parantes por columna+1, niveles = estantes + 1, todo MDF, caño en barras
m = build(TEMPLATES.biblio);
assert.equal(count(m.pieces, 'Parante'), 4);
assert.equal(count(m.pieces, 'Estante (calado)') + count(m.pieces, 'Tapa'), 5);
const top = m.pieces.find(p => p.name === 'Tapa');
assert.equal(top.pos[1] + top.size[1] / 2, TEMPLATES.biblio.H + TEMPLATES.biblio.legs); // alto total exacto
assert.ok(m.pieces.every(p => p.pos[1] - p.size[1] / 2 >= 0), 'pieza bajo el piso');
assert.equal(count(build(TEMPLATES.rack).pieces, 'Parante'), 6);
const rows = cutList(m.pieces);
assert.ok(rows.every(r => r.iron || r.mat.startsWith('MDF')), 'madera que no es MDF');
const q = budget(rows, m.hw, PRICES);
const tubeLen = rows.filter(r => r.iron).reduce((a, r) => a + r.L * r.qty, 0);
assert.ok(q.bars.length >= Math.ceil(tubeLen / 6000));
for (const b of q.bars) assert.ok(b.used - 3 <= 6000, 'barra excedida');
assert.equal(q.bars.flatMap(b => b.parts).length, rows.filter(r => r.iron).reduce((a, r) => a + r.qty, 0));
assert.ok(['bar', 'paint', 'cap'].every(k => q.lines.some(l => l.key === k)));
// colores: cuerpo y frentes de distinto diseño van en placas y tapacantos separados
const colored = cutList(build(TEMPLATES.doble).pieces, { board: 'Almendra', front: 'Kiri' });
const cq = budget(colored, build(TEMPLATES.doble).hw, PRICES);
assert.deepEqual(cq.mats.map(x => x.mat).sort(), ['MDF 18mm Almendra', 'MDF 18mm Kiri', 'MDF 3mm']);
assert.equal(cq.lines.filter(l => l.key === 'edge').length, 2);
assert.equal(new Set(Object.keys(FINISH_HEX)).size, Object.values(FINISHES).flat().length, 'nombres repetidos');
// medias y cuartos: piezas chicas usan un cuarto; con veta, media placa partida a lo ancho mantiene el largo
const SW = 2750, SH = 1830;
let sr = shrinkLast(pack([{ name: 'a', L: 600, A: 400, qty: 2 }], SW, SH), SW, SH);
assert.equal(sr.sheets[0].frac, 0.25);
sr = shrinkLast(pack([{ name: 'a', L: 2000, A: 400, qty: 2 }], SW, SH, 4, true), SW, SH, 4, true);
assert.deepEqual([sr.sheets[0].frac, sr.sheets[0].w], [0.5, SW]);
sr = shrinkLast(pack([{ name: 'a', L: 1800, A: 1800, qty: 2 }], SW, SH), SW, SH);
assert.deepEqual(sr.sheets.map(s => s.frac), [1, 1]); // no entra en media: sigue entera
for (const s of sr.sheets) for (const p of s.parts) assert.ok(p.x + p.w <= s.w && p.y + p.h <= s.h);
const mq = budget(cutList(build(TEMPLATES.mesaluz).pieces), build(TEMPLATES.mesaluz).hw, PRICES);
assert.ok(mq.mats.every(m => m.qty < 1), 'mesa de luz debería usar fracciones');
console.log('ok fracciones', mq.lines.filter(l => /placas/.test(l.label)).map(l => `${l.label}:${l.qty}`).join(', '));
console.log('ok industrial', q.lines.map(l => `${l.label}:${l.qty}`).join(', '));
