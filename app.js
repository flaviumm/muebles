import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { TEMPLATES, PRICES, SHEET, BAR, FINISHES, FINISH_HEX, build, cutList, budget } from './model.js';

const $ = s => document.querySelector(s);
const S = 0.001; // mm → unidades de escena (m)
const money = n => '$ ' + Math.round(n).toLocaleString('es-AR');
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const fromHash = () => {
  if (!location.hash.startsWith('#p=')) return null;
  try { return JSON.parse(decodeURIComponent(location.hash.slice(3))); } catch { return null; }
};

const FIELDS = {
  size: [['W', 'Ancho', 300, 2400, 10, 'mm'], ['H', 'Alto (cuerpo)', 300, 2600, 10, 'mm'], ['D', 'Profundidad', 250, 800, 10, 'mm'], ['t', 'Espesor placa', 12, 25, 1, 'mm']],
  inside: [['columns', 'Columnas', 1, 4, 1, ''], ['shelves', 'Estantes por columna', 0, 10, 1, ''], ['drawers', 'Cajones por columna', 0, 8, 1, ''], ['drawerH', 'Alto de cajón', 100, 400, 10, 'mm'], ['legs', 'Altura de patas', 0, 300, 10, 'mm'], ['tube', 'Caño cuadrado (lado)', 20, 60, 5, 'mm']],
};
const PLAIN_ONLY = ['drawers', 'drawerH'], IRON_ONLY = ['tube'];
const LIMITS = Object.fromEntries(Object.values(FIELDS).flat().map(([k, , min, max]) => [k, [min, max]]));

// body/front = hex para dibujar; bodyName/frontName = melamina Faplac (vacío = color personalizado).
const DEFAULT = { template: 'closet', ...TEMPLATES.closet, bodyName: 'Almendra', body: FINISH_HEX.Almendra, frontName: 'Roble Dakar Woodtext', front: FINISH_HEX['Roble Dakar Woodtext'] };
let state = fromHash() || load('madera:draft', null) || { ...DEFAULT };
let prices = { ...PRICES, ...load('madera:prices', {}) };
let sheet = { ...SHEET, grain: true, ...load('madera:sheet', {}) };
const view = { mode: '3d', exploded: false, hideFronts: false, tab: 'cuts' };
let model, cuts, quote;

// ---------- Escena ----------
const wrap = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.append(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.className = 'labels';
wrap.append(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e6e6e6');
scene.add(new THREE.HemisphereLight('#ffffff', '#b4b6b9', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 2.2);
sun.position.set(2, 4, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.18 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(10, 100, '#c4c6c9', '#d8d9db');
grid.position.y = 0.0005;
scene.add(grid);

const persp = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
const orbitP = new OrbitControls(persp, renderer.domElement);
const orbitO = new OrbitControls(ortho, renderer.domElement);
orbitP.enableDamping = true;
orbitO.enableRotate = false;
orbitO.enabled = false;
let orthoHalf = 1;
const cam = () => (view.mode === '3d' ? persp : ortho);

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(60,40,20,${Math.random() * 0.09})`;
    g.lineWidth = Math.random() * 3 + 0.5;
    const y = Math.random() * 256;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x / 40 + i) * 4);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const grain = woodTexture();
const mats = {
  board: new THREE.MeshStandardMaterial({ map: grain, roughness: 0.7 }),
  front: new THREE.MeshStandardMaterial({ map: grain, roughness: 0.55 }),
  back: new THREE.MeshStandardMaterial({ color: '#d6cec2', roughness: 0.9 }),
  leg: new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.4, metalness: 0.3 }),
  iron: new THREE.MeshStandardMaterial({ color: '#2f2d2b', roughness: 0.45, metalness: 0.6 }),
};
const edgeMat = new THREE.LineBasicMaterial({ color: '#000', transparent: true, opacity: 0.22 });

const furniture = new THREE.Group();
scene.add(furniture);
const mkLabel = () => { const d = document.createElement('div'); d.className = 'dim'; const o = new CSS2DObject(d); scene.add(o); return o; };
const dims = { W: mkLabel(), H: mkLabel(), D: mkLabel() };
let selected = null;

function frame() {
  const tH = state.H + state.legs;
  const size = Math.max(state.W, tH, state.D) * S;
  const target = new THREE.Vector3(0, (tH / 2) * S, 0);
  persp.position.set(size * 1.3, tH * S * 0.75 + size * 0.4, size * 2.4);
  orbitP.target.copy(target);
  ortho.position.set(0, target.y, 5);
  orbitO.target.copy(target);
  ortho.zoom = 1;
  orthoHalf = Math.max(state.W, tH) * S * 0.7;
  resize();
}

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  persp.aspect = w / h;
  persp.updateProjectionMatrix();
  const a = w / h;
  Object.assign(ortho, { left: -orthoHalf * a, right: orthoHalf * a, top: orthoHalf, bottom: -orthoHalf });
  ortho.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);

function rebuild() {
  select(null);
  for (const m of furniture.children) { m.geometry.dispose(); m.children[0].geometry.dispose(); }
  furniture.clear();
  mats.board.color.set(state.body);
  mats.front.color.set(state.front);

  model = build(state);
  const cy = (state.H + state.legs) / 2;
  for (const pc of model.pieces) {
    const g = new THREE.BoxGeometry(...pc.size.map(v => v * S));
    const m = new THREE.Mesh(g, mats[pc.kind]);
    m.castShadow = m.receiveShadow = true;
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat));
    const [x, y, z] = pc.pos;
    m.userData = {
      pc,
      base: new THREE.Vector3(x, y, z).multiplyScalar(S),
      dir: new THREE.Vector3(x * 0.6, (y - cy) * 0.6, z * 1.2 + (pc.kind === 'front' ? 250 : 0)).multiplyScalar(S),
    };
    furniture.add(m);
  }

  const { W, H, D, legs } = state;
  dims.W.position.set(0, (H + legs) * S + 0.05, (D / 2) * S);
  dims.W.element.textContent = `${W} mm`;
  dims.H.position.set((-W / 2) * S - 0.08, ((H + legs) / 2) * S, (D / 2) * S);
  dims.H.element.textContent = `${H + legs} mm`;
  dims.D.position.set((W / 2) * S + 0.08, (H + legs) * S, 0);
  dims.D.element.textContent = `${D} mm`;

  placeRef();
  applyVisibility();
  renderReports();
  save('madera:draft', state);
  push();
}

function applyVisibility() {
  for (const m of furniture.children) m.visible = !(view.hideFronts && m.userData.pc.kind === 'front');
  for (const l of Object.values(dims)) l.visible = !view.exploded;
  refPlane.visible = view.mode === 'front' && !!refMat.map;
}

// ---------- Imagen de referencia ----------
// En vista Frente la foto se dibuja encima del mueble, escalada al alto total, para calcarla.
const refMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthTest: false });
const refPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), refMat);
refPlane.renderOrder = 1;
scene.add(refPlane);

function placeRef() {
  const img = refMat.map?.image;
  if (!img) return;
  const h = (state.H + state.legs) * S;
  refPlane.scale.set((h * img.width) / img.height, h, 1);
  refPlane.position.set(0, h / 2, state.D * S);
}

function loadRef() {
  refMat.map?.dispose();
  refMat.map = null;
  $('#refTools').hidden = !state.ref;
  applyVisibility();
  if (state.ref) new THREE.TextureLoader().load(state.ref, tx => {
    tx.colorSpace = THREE.SRGBColorSpace;
    refMat.map = tx;
    refMat.needsUpdate = true;
    placeRef();
    applyVisibility();
  });
}

$('#refFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    // Achicada a 1000px en JPEG para que entre en localStorage con el proyecto.
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    state.ref = c.toDataURL('image/jpeg', 0.8);
  } catch {
    return toast('No se pudo leer la imagen');
  }
  save('madera:draft', state);
  loadRef();
  setView('front');
});
// Claude mira la foto (vía server.js) y propone los parámetros; se recortan a los rangos de la UI.
$('#refAI').addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Analizando foto…';
  try {
    const r = await fetch('/api/analizar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: state.ref }) });
    const p = await r.json();
    if (!r.ok) throw new Error(p.error);
    for (const [k, [min, max]] of Object.entries(LIMITS)) if (Number.isFinite(p[k])) state[k] = Math.min(max, Math.max(min, Math.round(p[k])));
    for (const k of ['iron', 'doors']) if (typeof p[k] === 'boolean') state[k] = p[k];
    for (const k of ['body', 'front']) if (FINISH_HEX[p[k]]) { state[k + 'Name'] = p[k]; state[k] = FINISH_HEX[p[k]]; }
    if (p.name) state.name = p.name;
    state.template = undefined;
    $('#refNotes').hidden = !p.notes;
    $('#refNotes').textContent = p.notes || '';
    syncUI();
    rebuild();
    frame();
    toast('Diseño generado desde la foto');
  } catch (err) {
    toast(err.message || 'No se pudo analizar la foto');
  }
  btn.disabled = false;
  btn.textContent = 'Diseñar desde la foto (IA)';
});
$('#refOpacity').addEventListener('input', e => (refMat.opacity = Number(e.target.value)));
$('#refDel').addEventListener('click', () => { delete state.ref; save('madera:draft', state); loadRef(); });
$('#refFit').addEventListener('click', () => {
  const img = refMat.map?.image;
  if (!img) return;
  const [min, max] = LIMITS.W;
  state.W = Math.min(max, Math.max(min, Math.round(((state.H + state.legs) * img.width) / img.height / 10) * 10));
  syncUI();
  rebuild();
  frame();
});

let ex = 0;
renderer.setAnimationLoop(() => {
  ex += ((view.exploded ? 1 : 0) - ex) * 0.12;
  for (const m of furniture.children) m.position.copy(m.userData.base).addScaledVector(m.userData.dir, ex);
  (view.mode === '3d' ? orbitP : orbitO).update();
  renderer.render(scene, cam());
  labels.render(scene, cam());
});

// Click (sin arrastre) selecciona pieza.
const ray = new THREE.Raycaster();
let down = null;
renderer.domElement.addEventListener('pointerdown', e => (down = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam());
  const hit = ray.intersectObjects(furniture.children.filter(m => m.visible), false)[0];
  select(hit?.object ?? null);
});

function select(m) {
  if (selected) { selected.material.dispose(); selected.material = mats[selected.userData.pc.kind]; }
  selected = m;
  const info = $('#info');
  info.hidden = !m;
  if (!m) return;
  m.material = m.material.clone();
  m.material.emissive = new THREE.Color('#ff7a1a');
  m.material.emissiveIntensity = 0.35;
  const [e, a, l] = [...m.userData.pc.size].sort((x, y) => x - y).map(Math.round);
  info.textContent = `${m.userData.pc.name} · ${l} × ${a} × ${e} mm`;
}

// ---------- Panel ----------
function elevationSVG(p, fronts = true) {
  const { pieces } = build(p);
  const tH = p.H + p.legs, pad = 20;
  const order = { back: 0, board: 1, leg: 1, iron: 2, front: 2 };
  const rects = [...pieces].sort((a, b) => order[a.kind] - order[b.kind]).filter(pc => pc.kind !== 'back' && (fronts || pc.kind !== 'front')).map(pc => {
    const [sx, sy] = pc.size, [x, y] = pc.pos;
    const fill = pc.kind === 'front' ? p.front : pc.kind === 'leg' || pc.kind === 'iron' ? '#2b2622' : p.body;
    return `<rect x="${x - sx / 2 + p.W / 2}" y="${tH - y - sy / 2}" width="${sx}" height="${sy}" fill="${fill}" stroke="#5c4a3a" stroke-width="${Math.max(p.W, tH) / 120}"/>`;
  });
  return `<svg viewBox="${-pad} ${-pad} ${p.W + 2 * pad} ${tH + 2 * pad}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${rects.join('')}</svg>`;
}

$('#templates').innerHTML = Object.entries(TEMPLATES).map(([k, t]) =>
  `<button data-tpl="${k}">${elevationSVG({ ...t, body: DEFAULT.body, front: DEFAULT.front })}${t.name}</button>`).join('');

for (const [group, list] of Object.entries(FIELDS))
  $(`#f-${group}`).innerHTML = list.map(([k, label, min, max, step, unit]) =>
    `<label class="field"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"><input type="number" data-k="${k}" min="${min}" max="${max}" step="${step}"><em>${unit}</em></label>`).join('');

for (const part of ['body', 'front'])
  $(`#sw-${part}`).innerHTML = `<i class="chip" data-chip="${part}"></i><select data-part="${part}" aria-label="Melamina Faplac">`
    + Object.entries(FINISHES).map(([line, list]) => `<optgroup label="${line}">${list.map(([n]) => `<option>${n}</option>`).join('')}</optgroup>`).join('')
    + `<option value="">Color personalizado</option></select><input type="color" data-part="${part}" aria-label="Color personalizado">`;

function syncUI() {
  $('#name').value = state.name;
  document.querySelectorAll('[data-k]').forEach(i => (i.value = state[i.dataset.k]));
  $('#doors').checked = state.doors;
  $('#iron').checked = state.iron;
  $('#doors').closest('label').hidden = state.iron;
  document.querySelectorAll('label.field input[type=range][data-k]').forEach(i =>
    (i.closest('label').hidden = (state.iron ? PLAIN_ONLY : IRON_ONLY).includes(i.dataset.k)));
  document.querySelectorAll('[data-tpl]').forEach(b => b.classList.toggle('on', b.dataset.tpl === state.template));
  document.querySelectorAll('select[data-part]').forEach(s => (s.value = state[s.dataset.part + 'Name'] || ''));
  document.querySelectorAll('[data-chip]').forEach(c => (c.style.background = state[c.dataset.chip]));
  document.querySelectorAll('input[type=color]').forEach(i => (i.value = state[i.dataset.part]));
}

let pending = 0;
const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(rebuild); };

$('#panel').addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.k) {
    const v = Number(el.value), [min, max] = LIMITS[el.dataset.k];
    if (el.value === '' || !Number.isFinite(v) || v < min || v > max) return; // tipeo a medias
    state[el.dataset.k] = v;
    document.querySelectorAll(`[data-k="${el.dataset.k}"]`).forEach(i => i !== el && (i.value = v));
    schedule();
  } else if (el.type === 'color') {
    state[el.dataset.part] = el.value;
    state[el.dataset.part + 'Name'] = '';
    syncUI();
    schedule();
  } else if (el.tagName === 'SELECT' && el.dataset.part) {
    state[el.dataset.part + 'Name'] = el.value;
    if (el.value) state[el.dataset.part] = FINISH_HEX[el.value];
    syncUI();
    schedule();
  } else if (el.id === 'doors' || el.id === 'iron') {
    state[el.id] = el.checked;
    syncUI();
    schedule();
  } else if (el.id === 'name') {
    state.name = el.value;
    save('madera:draft', state);
    push();
  }
});
$('#panel').addEventListener('change', e => e.target.type === 'number' && syncUI()); // revierte valores inválidos
$('#panel').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tpl) {
    state = { ...state, ...TEMPLATES[b.dataset.tpl], template: b.dataset.tpl, id: undefined };
    syncUI();
    rebuild();
    frame();
  }
});

// ---------- Toolbar ----------
function setView(mode) {
  view.mode = mode;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x.dataset.view === mode));
  orbitP.enabled = mode === '3d';
  orbitO.enabled = !orbitP.enabled;
  applyVisibility();
  frame();
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('#explode').addEventListener('click', e => { view.exploded = !view.exploded; e.target.classList.toggle('on', view.exploded); applyVisibility(); });
$('#hideFronts').addEventListener('click', e => { view.hideFronts = !view.hideFronts; e.target.classList.toggle('on', view.hideFronts); select(null); applyVisibility(); });

const slug = () => (state.name || 'mueble').toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-');
function download(name, href) {
  const a = Object.assign(document.createElement('a'), { href, download: name });
  a.click();
  if (href.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(href), 1000);
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

$('#png').addEventListener('click', () => download(`${slug()}.png`, renderer.domElement.toDataURL('image/png')));
$('#share').addEventListener('click', () => {
  const { id, ref, ...rest } = state; // la foto no entra en un link
  history.replaceState(null, '', '#p=' + encodeURIComponent(JSON.stringify(rest)));
  navigator.clipboard?.writeText(location.href).then(() => toast('Link copiado'), () => toast('Link en la barra de direcciones'));
});
$('#save').addEventListener('click', () => {
  state.id ||= Date.now().toString(36);
  const all = load('madera:projects', {});
  all[state.id] = { ...state, updated: Date.now() };
  save('madera:projects', all);
  save('madera:draft', state);
  toast('Proyecto guardado');
});
$('#open').addEventListener('click', () => { renderProjects(); $('#projects').showModal(); });

function renderProjects() {
  const all = Object.values(load('madera:projects', {})).sort((a, b) => b.updated - a.updated);
  $('#project-list').innerHTML = all.length
    ? all.map(p => `<li>${elevationSVG(p)}<div><strong></strong><br><small class="muted">${TEMPLATES[p.template]?.name ?? ''} · ${p.W}×${p.H + p.legs}×${p.D} mm · ${new Date(p.updated).toLocaleDateString('es-AR')}</small></div><button data-open="${p.id}">Abrir</button><button data-del="${p.id}">Borrar</button></li>`).join('')
    : '<li class="muted">Todavía no guardaste proyectos.</li>';
  // Nombre por textContent: es texto del usuario.
  $('#project-list').querySelectorAll('li strong').forEach((s, i) => (s.textContent = all[i].name));
}
$('#project-list').addEventListener('click', e => {
  const all = load('madera:projects', {});
  const { open, del } = e.target.dataset;
  if (open) { state = upgrade(all[open]); syncUI(); rebuild(); frame(); loadRef(); $('#projects').close(); }
  if (del && confirm('¿Borrar este proyecto?')) { delete all[del]; save('madera:projects', all); renderProjects(); }
});

// ---------- Reportes ----------
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
  view.tab = b.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => (t.hidden = t.id !== `tab-${view.tab}`));
}));

const qtyFmt = n => n.toLocaleString('es-AR');
const FRAC_LABEL = { 1: '', 0.5: ' (media placa)', 0.25: ' (cuarto de placa)' };
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

let where = {}; // ref → números de placa/barra donde cae la pieza
const placeOf = r => [...(where[r.ref] ?? [])].join(', ');

function renderReports() {
  cuts = cutList(model.pieces, { board: state.bodyName, front: state.frontName });
  quote = budget(cuts, model.hw, prices, sheet, sheet.grain);
  const area = cuts.reduce((a, r) => a + (r.iron ? 0 : r.L * r.A * r.qty), 0) / 1e6;
  const n = cuts.reduce((a, r) => a + r.qty, 0);
  const edge = cuts.reduce((a, r) => a + r.edge, 0) / 1000;

  // En qué placa (o barra) cae cada pieza, para cortar placa por placa.
  where = {};
  const at = (ref, label) => (where[ref] ||= new Set()).add(label);
  for (const m of quote.mats) m.sheets.forEach((s, i) => s.parts.forEach(p => at(p.ref, i + 1)));
  quote.bars.forEach((b, i) => b.parts.forEach(p => at(p.ref, i + 1)));
  const groups = Map.groupBy(cuts, r => r.mat);
  const head = mat => {
    if (groups.get(mat)[0].iron) return `${mat} — ${quote.bars.length} barra${quote.bars.length === 1 ? '' : 's'} de ${BAR.len / 1000} m`;
    const q = quote.mats.find(m => m.mat === mat).qty;
    return `${mat} — ${qtyFmt(q)} placa${q === 1 ? '' : 's'}`;
  };

  $('#tab-cuts').innerHTML = `<table>
    <thead><tr><th>#</th><th>Pieza</th><th>Placa</th><th class="n">Largo</th><th class="n">Ancho</th><th class="n">Cant.</th><th class="n">Tapacanto</th></tr></thead>
    ${[...groups].map(([mat, rows]) => `<tbody><tr class="group"><th colspan="7">${head(mat)}</th></tr>${rows.map(r =>
      `<tr><td class="muted">${r.ref}</td><td>${r.name}</td><td>${placeOf(r)}</td><td class="n">${r.L}</td><td class="n">${r.A}</td><td class="n">${r.qty}</td><td class="n">${(r.edge / 1000).toFixed(2)} m</td></tr>`).join('')}</tbody>`).join('')}
    <tfoot><tr><td colspan="5">${area.toFixed(2)} m² de placa</td><td class="n">${n}</td><td class="n">${edge.toFixed(2)} m</td></tr></tfoot>
  </table>`;

  $('#tab-sheets').innerHTML = `<div class="inline">
      <label>Placa <input type="number" data-sheet="w" value="${sheet.w}"> × <input type="number" data-sheet="h" value="${sheet.h}"> mm</label>
      <label>Corte (sierra) <input type="number" data-sheet="kerf" value="${sheet.kerf}"> mm</label>
      <label class="check"><input type="checkbox" data-grain ${sheet.grain ? 'checked' : ''}> Respetar veta (largo de pieza a lo largo de la placa)</label>
    </div>` + quote.mats.map(m => `<h2>${m.mat} — ${qtyFmt(m.qty)} placa${m.qty === 1 ? '' : 's'}</h2>
    ${m.oversize.length ? `<p class="warn">No entran en la placa: ${[...new Set(m.oversize)].join(', ')}</p>` : ''}
    <div class="sheets">${m.sheets.map((s, i) => `<figure style="margin:0">${sheetSVG(s)}<figcaption class="muted">Placa ${i + 1}${FRAC_LABEL[s.frac]} · ${(s.usage * 100).toFixed(0)}% aprovechada</figcaption></figure>`).join('')}</div>`).join('')
    + (quote.bars.length ? `<h2>${cuts.find(r => r.iron).mat} — ${quote.bars.length} barra${quote.bars.length === 1 ? '' : 's'} de ${BAR.len / 1000} m</h2>
    <div class="bars">${quote.bars.map(barSVG).join('')}</div>` : '');

  $('#tab-budget').innerHTML = `<table>
    <thead><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Precio unit.</th><th class="n">Subtotal</th></tr></thead>
    <tbody>${quote.lines.map(l => `<tr><td>${l.label}</td><td class="n">${qtyFmt(l.qty)}</td><td class="n"><input type="number" min="0" data-price="${l.key}" value="${prices[l.key]}"></td><td class="n">${money(l.qty * prices[l.key])}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3">Total materiales</td><td class="n">${money(quote.total)}</td></tr></tfoot>
  </table><p class="muted">Precios editables, se guardan en este navegador. No incluye mano de obra ni corte.</p>`;
}

function sheetSVG(s) {
  // --k escala el dibujo: media placa se ve la mitad de ancha que una entera.
  return `<svg class="sheet" style="--k:${s.w / sheet.w}" viewBox="0 0 ${s.w} ${s.h}"><rect class="bg" width="${s.w}" height="${s.h}"/>${s.parts.map(p => {
    // Rótulo completo si entra; si no, solo el número de pieza (está en la lista de cortes).
    let label = `#${p.ref} ${p.name} ${p.w}×${p.h}`;
    let fs = Math.min(70, p.h * 0.4, p.w / (label.length * 0.6));
    if (fs < 24) { label = `#${p.ref}`; fs = Math.min(70, p.h * 0.6, p.w / 2); }
    return `<rect class="part" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"/><text x="${p.x + p.w / 2}" y="${p.y + p.h / 2}" font-size="${fs}">${esc(label)}</text>`;
  }).join('')}</svg>`;
}

function barSVG(b) {
  return `<svg class="bar" viewBox="0 0 ${BAR.len} 120"><rect class="bg" width="${BAR.len}" height="120"/>${b.parts.map(p =>
    `<rect class="part" x="${p.x}" y="10" width="${p.L}" height="100"/><text x="${p.x + p.L / 2}" y="62">${p.L > 500 ? `#${p.ref} ${p.L}` : `#${p.ref}`}</text>`).join('')}</svg>`;
}

$('#reports').addEventListener('change', e => {
  if ('grain' in e.target.dataset) { sheet.grain = e.target.checked; save('madera:sheet', sheet); return renderReports(); }
  const { price, sheet: sk } = e.target.dataset;
  const v = Number(e.target.value);
  if (!(v >= 0)) return renderReports();
  if (price) { prices[price] = v; save('madera:prices', prices); }
  if (sk) { if (sk !== 'kerf' && v < 300) return renderReports(); sheet[sk] = v; save('madera:sheet', sheet); }
  renderReports();
});

$('#csv').addEventListener('click', () => {
  const rows = [['#', 'Pieza', 'Material', 'Placa / barra', 'Largo mm', 'Ancho mm', 'Cantidad', 'Tapacanto mm'], ...cuts.map(r => [r.ref, r.name, r.mat, placeOf(r), r.L, r.A, r.qty, r.edge])];
  const blob = new Blob(['﻿' + rows.map(r => r.join(';')).join('\n')], { type: 'text/csv' });
  download(`${slug()}-cortes.csv`, URL.createObjectURL(blob));
});

// ---------- Hoja de taller ----------
$('#print').addEventListener('click', () => {
  const { W, H, D, t, legs } = state;
  const out = $('#printout');
  out.innerHTML = `<header><h1></h1><p>${TEMPLATES[state.template]?.name ?? ''} · ${W} × ${H + legs} × ${D} mm · placa ${t} mm · ${new Date().toLocaleDateString('es-AR')}</p></header>
    <div class="elev"><figure>${elevationSVG(state)}<figcaption>Frente</figcaption></figure><figure>${elevationSVG(state, false)}<figcaption>Interior</figcaption></figure></div>
    <h2>Lista de cortes</h2>${$('#tab-cuts').innerHTML}
    <h2>Herrajes y presupuesto</h2>${$('#tab-budget').innerHTML}
    <h2>Despiece en placas</h2>${$('#tab-sheets').innerHTML}`;
  out.querySelector('h1').textContent = state.name;
  out.querySelectorAll('.inline').forEach(el => el.remove());
  out.querySelectorAll('input[data-price]').forEach(i => i.replaceWith(money(i.value)));
  print();
});

// ---------- Colaboración en vivo ----------
// Yjs sincroniza los parámetros del mueble entre navegadores por WebRTC; server.js hace la señalización.
const SHARED = ['template', 'name', 'W', 'H', 'D', 't', 'columns', 'shelves', 'drawers', 'drawerH', 'doors', 'legs', 'iron', 'tube', 'body', 'front', 'bodyName', 'frontName'];
const COLORS = ['#b5652b', '#2b7a78', '#7a3b8f', '#3b5ba5', '#a33b3b', '#5a7d2b'];
let ydoc = null, ymap = null;
const roomFromHash = () => location.hash.match(/room=([\w-]+)/)?.[1];

function push() {
  if (!ymap) return;
  ydoc.transact(() => { for (const k of SHARED) if (ymap.get(k) !== state[k]) ymap.set(k, state[k]); });
}
function pull() {
  for (const k of SHARED) if (ymap.has(k)) state[k] = ymap.get(k);
  syncUI();
  schedule();
}

async function joinRoom(room, creator) {
  $('#collab').disabled = true;
  try {
    const Y = await import('yjs');
    const { WebrtcProvider } = await import('y-webrtc');
    const doc = new Y.Doc();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const provider = new WebrtcProvider('madera-' + room, doc, { signaling: [`${proto}://${location.host}/signal`] });
    const map = doc.getMap('mueble');
    map.observe(e => !e.transaction.local && pull());

    const me = { name: load('madera:user', null) || `Invitado ${Math.floor(Math.random() * 90 + 10)}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    provider.awareness.setLocalStateField('user', me);
    provider.awareness.on('change', () => {
      const users = [...provider.awareness.getStates().values()].map(s => s.user).filter(Boolean);
      const peers = $('#peers');
      peers.hidden = false;
      peers.replaceChildren(...users.map(u => Object.assign(document.createElement('i'), { title: u.name, style: `background:${u.color}` })));
      peers.title = users.map(u => u.name).join(', ');
    });

    // El que crea la sala siembra su diseño; el que entra por link espera a recibir el de la sala.
    const seed = () => { if (!ydoc) { ydoc = doc; ymap = map; map.size ? pull() : push(); } };
    if (creator) seed();
    else { provider.on('synced', ({ synced }) => synced && seed()); setTimeout(seed, 2500); }

    $('#collab').textContent = 'Copiar link de sala';
    $('#collab').classList.add('on');
  } catch (err) {
    console.error(err);
    toast('No se pudo iniciar la colaboración');
  }
  $('#collab').disabled = false;
}

$('#collab').addEventListener('click', () => {
  let room = roomFromHash();
  if (!room) {
    room = Math.random().toString(36).slice(2, 10);
    history.replaceState(null, '', '#room=' + room);
    joinRoom(room, true);
  }
  navigator.clipboard?.writeText(location.href).then(() => toast('Link de sala copiado: compartilo para editar juntos'), () => toast('Link en la barra de direcciones'));
});

// Borradores viejos pueden no tener campos nuevos; los que tienen hex sin nombre quedan como color personalizado.
const upgrade = s => ({ ...DEFAULT, bodyName: '', frontName: '', ...s });
state = upgrade(state);
syncUI();
rebuild();
frame();
loadRef();
if (roomFromHash()) joinRoom(roomFromHash(), false);
