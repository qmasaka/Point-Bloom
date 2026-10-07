import { h, formatInt } from './util.js';
import { icon } from './icons.js';
import { section, field, slider, segmented, switchRow, toggle, button, iconButton, select, colorField } from './ui-kit.js';
import * as THREE from 'three';
import { sampleSurface, overrideMats } from './pointcloud.js';
import { getDevice } from './device-card.js';
import { formatCount } from './capabilities.js';
import { createMediaPanel } from './panel-media.js';
import { attachPreview } from './fx-previews.js';
import { SHAPES as POINT_SHAPE_LIST } from './panel-points.js';
import { FX_GROUP_NAMES, FX_ACTIONS, FX_LAYERS, FX_PALETTES, BANDS, BAND_RANGE, FREQ_QUICK, COLOR_BY_UI, SYNTH_STYLES, MORPH_STYLES, MORPH_SORTS, MORPH_EASES } from './effects-engine.js';
export function makeModelProvider(app) {
const root = app.viewport.root;
const shown = (o) => {
for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
return true;
};
const clouds = () => {
const a = [];
root.traverse((o) => {
if (o.isPoints && !o.userData.helper && !o.userData.media && o.geometry.attributes.position && shown(o)) a.push(o);
});
return a;
};
const meshes = () => app.model.meshes().filter(shown);
const fromClouds = (list, want) => {
const total = list.reduce((n, o) => n + o.geometry.attributes.position.count, 0);
const n = Math.min(want, total);
const step = total / n;
const positions = new Float32Array(n * 3);
const normals = new Float32Array(n * 3);
const colors = new Float32Array(n * 3).fill(1);
const v = new THREE.Vector3();
let k = 0;
let seen = 0;
let next = 0;
for (const o of list) {
o.updateWorldMatrix(true, false);
const g = o.geometry.attributes;
const cnt = g.position.count;
const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
for (let i = 0; i < cnt && k < n; i++, seen++) {
if (seen < Math.floor(next)) continue;
next += step;
v.fromBufferAttribute(g.position, i).applyMatrix4(o.matrixWorld);
positions.set([v.x, v.y, v.z], k * 3);
if (g.normal) {
v.fromBufferAttribute(g.normal, i).applyMatrix3(nm).normalize();
normals.set([v.x, v.y, v.z], k * 3);
} else normals[k * 3 + 1] = 1;
if (g.color) colors.set([g.color.getX(i), g.color.getY(i), g.color.getZ(i)], k * 3);
k++;
}
}
return { positions: positions.slice(0, k * 3), normals: normals.slice(0, k * 3), colors: colors.slice(0, k * 3), count: k };
};
const topObjects = () => root.children.filter((o) => !o.userData.helper && !o.userData.media && o.name !== '__fx' && (() => { let ok = false; o.traverse((c) => { if (!c.userData.helper && (c.isMesh || c.isPoints)) ok = true; }); return ok; })());
return {
sizeOf: (obj) => {
let n = 0;
obj.traverse((c) => {
if (c.userData.helper || !c.geometry) return;
const g = c.geometry;
if (c.isPoints) n += g.attributes.position.count;
else if (c.isMesh) n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
});
return n;
},
objects: () => topObjects().map((o) => ({ id: o.uuid, name: o.name || 'Объект', obj: o })),
async getOf(obj, count) {
const cl = [];
obj.traverse((o) => {
if (o.isPoints && !o.userData.helper && o.geometry.attributes.position) cl.push(o);
});
if (cl.length) return fromClouds(cl, count);
const list = app.model.meshesOf(obj);
if (!list.length) return null;
const entries = list.map((m) => ({ mesh: m, mats: overrideMats(app.pointTexture, app.display.getOriginal(m)) }));
return sampleSurface(entries, count, {});
},
available: () => clouds().length > 0 || meshes().length > 0,
kind: () => (clouds().length ? 'cloud' : meshes().length ? 'mesh' : 'none'),
total: () => clouds().reduce((n, o) => n + o.geometry.attributes.position.count, 0),
async get(count) {
const c = clouds();
if (c.length) return fromClouds(c, count);
const list = meshes();
if (!list.length) return null;
const entries = list.map((m) => ({ mesh: m, mats: overrideMats(app.pointTexture, app.display.getOriginal(m)) }));
return sampleSurface(entries, count, { onProgress: (p) => {
if (!app.ui.effectsEngine?._quiet) app.ui.busy('Беру точки с модели', 0.2 + p * 0.7);
} });
},
};
}
const TRACK_COLORS = ['#ffffff', '#00f0ff', '#ff1fcb', '#ffd90f', '#7cff6b', '#ff4d4d'];
function colorChoice(L, key, done, natural = false) {
const chips = [];
const wrap = h('div', { class: 'fx-color' });
const row = h('div', { class: 'fx-bg-sw' });
const mkChip = (val, name, style) => {
const b = h('button', { type: 'button', class: 'fx-bg-chip' + (val === 'auto' ? ' is-default' : ''), 'aria-label': name, 'data-tip': name, style: style || {} });
b.addEventListener('click', () => pick(val));
chips.push([val, b]);
row.append(b);
};
mkChip('auto', 'Цвета палитры');
if (natural) mkChip('model', 'Естественные цвета модели', { background: 'conic-gradient(#ff3d6e, #ffd90f, #7cff6b, #00f0ff, #b06bff, #ff3d6e)' });
for (const c of TRACK_COLORS) mkChip(c, c, { background: c });
const custom = colorField({ value: L[key] === 'auto' ? '#ffffff' : L[key], onInput: (v) => pick(v, true), onChange: done });
wrap.append(row, custom.el);
function mark() {
for (const [v, b] of chips) b.classList.toggle('is-active', v === L[key]);
}
function pick(v, live) {
L[key] = v;
if (!live && v !== 'auto' && v !== 'model') custom.set(v);
mark();
done();
}
mark();
return {
el: wrap,
set(v) {
if (v !== 'auto' && v !== 'model') custom.set(v);
mark();
},
};
}
export function createEffectsPanel(app, root, engine) {
const st = engine.state;
const save = () => engine.touch();
const pset = app.settings.point;
const size = slider({ min: 1, max: 24, step: 0.5, value: pset.size, digits: 1, unit: ' px', onInput: (v) => { pset.size = v; }, onChange: () => app.saveSettings() });
const dev = getDevice(app);
const cap = () => Math.max(100000, Math.min(2000000, getDevice(app).limits.cap));
const count = slider({
log: true,
min: 20000,
max: cap(),
step: 10000,
value: Math.min(st.count, cap()),
format: (v) => formatInt(v),
onInput: () => {},
onChange: (v) => engine.setCount(v),
});
const countHint = h('div', { class: 'field-hint' });
const addModel = button({ label: 'Добавить модель…', icon: 'folder-open', variant: 'secondary', cls: 'btn-block', title: 'Открыть модель, облако точек (PLY, PCD, XYZ) или архив и сразу использовать их здесь', onClick: () => app.ui.openFiles('add') });
const modelNote = h('div', { class: 'field-hint' });
const mc = st.morphCfg;
const formsBox = h('div', { class: 'chip-row fx-forms' });
const picked = [];
let autoPicked = false;
const renderForms = () => {
const list = engine.forms();
for (let i = picked.length - 1; i >= 0; i--) if (!list.some((f) => f.key === picked[i])) picked.splice(i, 1);
if (list.length >= 2 && !autoPicked && !picked.length) {
autoPicked = true;
list.forEach((o) => picked.push(o.key));
engine.setPlaylist([...picked]);
}
if (list.length < 2) autoPicked = false;
formsBox.textContent = '';
for (const f of list) {
const b = h('button', { type: 'button', class: 'chip-btn' + (picked.includes(f.key) ? ' is-active' : ''), 'data-tip': 'Участвует в морфинге. Порядок: как нажимали' }, f.name);
b.addEventListener('click', () => {
const k = picked.indexOf(f.key);
if (k >= 0) picked.splice(k, 1);
else picked.push(f.key);
engine.setPlaylist([...picked]);
renderForms();
});
formsBox.append(b);
}
const has = list.length >= 2;
morphBox.hidden = !has;
morphNote.hidden = has;
morphHint.textContent = picked.length < 2 ? 'Отметьте минимум две модели, между которыми должен идти морфинг.' : '';
};
const morphHint = h('div', { class: 'field-hint' });
const styleTiles = h('div', { class: 'shape-grid fx-shapes morph-styles', role: 'radiogroup', 'aria-label': 'Вид перехода' });
const styleBtns = new Map();
const styleHint = h('div', { class: 'field-hint' });
for (const ms of MORPH_STYLES) {
const b = h('button', { type: 'button', class: 'shape-tile', role: 'radio', 'data-tip': ms.hint }, h('span', { class: 'fx-ic', html: icon(ms.icon, 22) }), h('span', { class: 'shape-name' }, ms.name));
b.addEventListener('click', () => {
mc.style = ms.id;
Object.assign(mc, ms.v);
save();
syncMorph();
});
styleBtns.set(ms.id, b);
styleTiles.append(b);
}
const morphMode = segmented({ cls: 'seg-tight', options: [{ value: 'manual', label: 'Кнопкой' }, { value: 'beat', label: 'По биту' }, { value: 'timer', label: 'По таймеру' }], value: mc.mode, onChange: (v) => { mc.mode = v; save(); syncMorph(); } });
const morphOrder = segmented({ options: [{ value: 'seq', label: 'По кругу' }, { value: 'random', label: 'Случайно' }], value: mc.order, onChange: (v) => { mc.order = v; save(); } });
const morphInt = slider({ min: 1, max: 20, step: 0.5, value: mc.interval, digits: 1, unit: ' с', onInput: (v) => { mc.interval = v; }, onChange: save });
const morphTime = slider({ min: 0.4, max: 8, step: 0.1, value: mc.time, digits: 1, unit: ' с', onInput: (v) => { mc.time = v; }, onChange: save });
const morphScatter = slider({ min: 0, max: 2, step: 0.05, value: mc.scatter, digits: 2, onInput: (v) => { mc.scatter = v; }, onChange: save });
const morphStagger = slider({ min: 0, max: 3, step: 0.05, value: mc.stagger, digits: 2, onInput: (v) => { mc.stagger = v; }, onChange: save });
const morphTurns = slider({ min: 0, max: 3, step: 0.1, value: mc.turns, digits: 1, onInput: (v) => { mc.turns = v; }, onChange: save });
const morphGlow = slider({ min: 0, max: 1.5, step: 0.05, value: mc.glow, digits: 2, onInput: (v) => { mc.glow = v; }, onChange: save });
const morphSort = select({ options: MORPH_SORTS.map(([value, label]) => ({ value, label })), value: mc.sort, onChange: (v) => { mc.sort = v; save(); } });
const morphEase = segmented({ cls: 'seg-tight', options: MORPH_EASES.map(([value, label]) => ({ value, label })), value: mc.ease, onChange: (v) => { mc.ease = v; save(); } });
const morphWeight = segmented({ options: [{ value: 'auto', label: 'Как в модели', title: 'У модели с меньшим числом точек лишние гаснут, при переходе к большей недостающие проявляются' }, { value: 'equal', label: 'Поровну', title: 'У всех моделей одинаковое число точек' }], value: mc.weight, onChange: (v) => { mc.weight = v; save(); } });
const morphGo = button({ label: 'Следующая модель', icon: 'arrow-right', variant: 'primary', cls: 'btn-block', title: 'Запустить переход к следующей модели из списка', onClick: () => engine.morphNext() });
const turnsRow = field('Закрутка', morphTurns.el);
const intRow = field('Не чаще, чем раз в', morphInt.el);
const morphBox = h('div', { class: 'sec-body', style: { padding: 0 } },
formsBox,
morphHint,
h('div', { class: 'fx-sub' }, 'Вид перехода'),
styleTiles,
styleHint,
field('Длительность', morphTime.el),
field('Разлёт', morphScatter.el),
field('Разнобой по времени', morphStagger.el),
turnsRow,
field('Какие точки первыми', morphSort.el, { wide: true }),
field('Характер движения', morphEase.el, { wide: true }),
field('Вспышка в пути', morphGlow.el),
h('div', { class: 'fx-sub' }, 'Запуск'),
field('Переход', morphMode.el, { wide: true }),
field('Порядок моделей', morphOrder.el, { wide: true }),
intRow,
field('Число точек у моделей', morphWeight.el, { wide: true }),
morphGo
);
const morphNote = h('div', { class: 'fx-morph-note' }, h('b', {}, 'Морфинг между моделями'), h('span', {}, 'Если хотите, можно сделать плавный переход между двумя объектами: добавьте в сцену вторую модель, и здесь появятся виды перехода и их настройки.'));
function syncMorph() {
const cur = MORPH_STYLES.find((x) => x.id === mc.style) || MORPH_STYLES[0];
styleBtns.forEach((b, k) => b.setAttribute('aria-checked', String(k === cur.id)));
styleHint.textContent = cur.hint;
turnsRow.hidden = cur.id !== 'swirl';
intRow.hidden = mc.mode === 'manual';
morphMode.set(mc.mode);
morphTime.set(mc.time);
morphScatter.set(mc.scatter);
morphStagger.set(mc.stagger);
morphTurns.set(mc.turns);
morphGlow.set(mc.glow);
morphSort.set(mc.sort);
morphEase.set(mc.ease);
}
renderForms();
syncMorph();
const secSource = section('Форма', { key: 'fx-source' }, addModel, modelNote, field('Частиц', count.el), field('Размер точек', size.el), countHint);
const secMorph = section('Морфинг', { key: 'fx-morph' }, morphNote, morphBox);
const pickers = new Set();
function freqPicker(L, onSave) {
const cv = h('canvas', { class: 'fx-freq-cv' });
const lab = h('div', { class: 'fx-freq-lab' });
const chips = h('div', { class: 'chip-row fx-freq-chips' });
const el = h('div', { class: 'fx-freq' }, cv, lab, chips);
const ctx = cv.getContext('2d');
const range = () => (L.band === 'custom' ? [L.lo, L.hi] : BAND_RANGE[L.band] || (L.band === 'beat' ? [0, 0.3] : [0, 0]));
for (const [name, f0, f1] of FREQ_QUICK) {
const b = h('button', { type: 'button', class: 'chip-btn', 'data-tip': `${f0}–${f1} Гц` }, name);
b.addEventListener('click', () => {
const sr = engine.ctx?.sampleRate || 44100;
const toX = (hz) => Math.sqrt(hz / (0.275 * sr));
L.band = 'custom';
L.lo = toX(f0);
L.hi = toX(f1);
if (!L.react) L.react = 0.7;
onSave();
engine.emit();
});
chips.append(b);
}
let vis = false;
new IntersectionObserver((es) => { vis = es[es.length - 1].isIntersecting; }).observe(cv);
function draw() {
if (!vis || el.hidden) return;
const dpr = Math.min(2, window.devicePixelRatio || 1);
const W = cv.clientWidth;
const H = 56;
if (cv.width !== Math.round(W * dpr) || cv.height !== H * dpr) {
cv.width = Math.round(W * dpr);
cv.height = H * dpr;
}
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
ctx.clearRect(0, 0, W, H);
const [r0, r1] = range();
const bw = W / 64;
const sp = engine.spec;
const cs = getComputedStyle(cv);
const acc = cs.getPropertyValue('--accent').trim() || '#e58a45';
const dim = cs.getPropertyValue('--text-faint').trim() || '#747c89';
ctx.globalAlpha = 0.16;
ctx.fillStyle = acc;
ctx.fillRect(r0 * W, 0, Math.max(2, (r1 - r0) * W), H);
ctx.globalAlpha = 1;
for (let i = 0; i < 64; i++) {
const v = Math.min(1, sp[i] || 0);
const inR = (i + 0.5) / 64 >= r0 && (i + 0.5) / 64 <= r1;
ctx.fillStyle = inR ? acc : dim;
ctx.globalAlpha = inR ? 0.95 : 0.45;
const h2 = Math.max(1.5, v * (H - 8));
ctx.fillRect(i * bw + 0.5, H - h2, Math.max(1, bw - 1.5), h2);
}
ctx.globalAlpha = 1;
if (L.amode === 'gate') {
const y = H - L.thr * (H - 8);
ctx.strokeStyle = '#fff';
ctx.globalAlpha = 0.8;
ctx.setLineDash([4, 3]);
ctx.beginPath();
ctx.moveTo(r0 * W, y);
ctx.lineTo(Math.max(r0 * W + 2, r1 * W), y);
ctx.stroke();
ctx.setLineDash([]);
ctx.globalAlpha = 1;
}
if (L.band === 'custom') {
ctx.fillStyle = acc;
ctx.fillRect(r0 * W - 1.5, 0, 3, H);
ctx.fillRect(r1 * W - 1.5, 0, 3, H);
}
const lvl = engine._bandLevel(L);
const open = L.amode === 'gate' && lvl > L.thr;
lab.textContent = (L.band === 'custom' || BAND_RANGE[L.band] ? `${engine.hzAt(r0)}–${engine.hzAt(r1)} Гц` : 'Удары в басах') + `  ·  сейчас ${Math.round(lvl * 100)}%` + (L.amode === 'gate' ? (open ? '  ·  включён' : '  ·  ждёт') : '');
}
cv.addEventListener('pointerdown', (e) => {
if (L.band === 'none') return;
const r = cv.getBoundingClientRect();
const xAt = (ev) => Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
const x = xAt(e);
const [a, b] = range();
const near = 9 / r.width;
let mode = 'new';
if (L.band === 'custom') {
if (Math.abs(x - a) < near) mode = 'lo';
else if (Math.abs(x - b) < near) mode = 'hi';
else if (x > a && x < b) mode = 'move';
}
L.band = 'custom';
if (!L.react) L.react = 0.7;
if (mode === 'new') {
L.lo = x;
L.hi = Math.min(1, x + 0.03);
mode = 'hi';
}
const off = x - L.lo;
const wd = L.hi - L.lo;
cv.setPointerCapture(e.pointerId);
const mv = (ev) => {
const xx = xAt(ev);
if (mode === 'lo') L.lo = Math.min(xx, L.hi - 0.02);
else if (mode === 'hi') L.hi = Math.max(xx, L.lo + 0.02);
else {
L.lo = Math.max(0, Math.min(1 - wd, xx - off));
L.hi = L.lo + wd;
}
draw();
};
const up = () => {
cv.removeEventListener('pointermove', mv);
cv.removeEventListener('pointerup', up);
onSave();
engine.emit();
};
cv.addEventListener('pointermove', mv);
cv.addEventListener('pointerup', up);
mv(e);
});
const api = { el, draw };
pickers.add(api);
return api;
}
(function pickerLoop() {
let last = 0;
const tick = (now) => {
requestAnimationFrame(tick);
if (!engine.active || now - last < 40) return;
last = now;
for (const p of pickers) p.draw();
};
requestAnimationFrame(tick);
})();
const cards = [];
const left = document.getElementById('fxList');
const leftCount = document.getElementById('fxActive');
const inspBox = h('div', { class: 'fx-insp-box' });
let selected = null;
let fxTabHook = () => {};
const select_ = (id) => {
selected = id;
for (const c of cards) {
c.card.classList.toggle('is-selected', c.def.id === id);
c.insp.classList.toggle('is-selected', c.def.id === id);
}
};
for (const grp of FX_GROUP_NAMES) {
const folder = h('div', { class: 'fx-folder' });
const fhead = h('button', { type: 'button', class: 'fx-folder-head', 'aria-expanded': 'true' }, h('span', { class: 'fx-folder-caret', html: icon('caret-down', 13) }), h('span', { class: 'fx-folder-name' }, grp), h('span', { class: 'fx-folder-n' }));
const fbody = h('div', { class: 'fx-folder-body' });
fhead.addEventListener('click', () => {
const closed = folder.classList.toggle('is-closed');
fhead.setAttribute('aria-expanded', String(!closed));
});
folder.append(fhead, fbody);
left.append(folder);
for (const def of FX_LAYERS.filter((d) => d.group === grp && !d.hidden)) {
st.layers[def.id] = { ...def.def, ...(st.layers[def.id] || {}) };
const L = st.layers[def.id];
const sw = toggle({
value: L.on,
label: def.name,
onChange: (v) => {
L.on = v;
card.classList.toggle('is-on', v);
if (v) {
select_(def.id);
fxTabHook();
}
countActive();
save();
},
});
const amount = slider({ min: 0, max: def.max, step: 0.05, value: L.amount, digits: 2, onInput: (v) => { L.amount = v; }, onChange: save });
const body = h('div', { class: 'fx-layer-body' });
if (def.id === 'physics') {
const collapseBtn = button({
label: engine.isCollapsed ? 'Собрать форму' : 'Разрушить форму',
icon: 'atom',
variant: 'primary',
cls: 'btn-block',
onClick: () => {
engine.toggleCollapse();
collapseBtn.querySelector('.btn-label').textContent = engine.isCollapsed ? 'Собрать форму' : 'Разрушить форму';
},
});
body.append(collapseBtn);
} else if (def.id === 'frames') {
body.append(h('div', { class: 'field-hint' }, 'Включите режим, когда открыто видео: оно разложится на кадры, и кадры соберутся в блок. К блоку применимы остальные эффекты.'), button({ label: 'Разложить заново', icon: 'film-strip', variant: 'secondary', cls: 'btn-block', title: 'Снять кадры с текущего места видео заново', onClick: () => engine.rebuildFramesSoon() }));
} else if (def.id === 'brush') {
const clearBtn = button({
label: 'Стереть краску',
icon: 'broom',
variant: 'secondary',
cls: 'btn-block',
onClick: () => engine.clearBrush(),
});
body.append(clearBtn);
} else if (def.id === 'dissolve') {
const disBtn = button({ label: 'Растворить / собрать', icon: 'snowflake', variant: 'primary', cls: 'btn-block', onClick: () => engine.toggleDissolve() });
body.append(disBtn);
} else if (def.id === 'camTrack') {
const camBtn = button({
label: engine.camTracker?.running ? 'Выключить камеру' : 'Включить камеру',
icon: 'video-camera',
variant: 'secondary',
cls: 'btn-block',
onClick: async () => {
await engine.toggleMotionCam();
camBtn.querySelector('.btn-label').textContent = engine.camTracker?.running ? 'Выключить камеру' : 'Включить камеру';
},
});
body.append(camBtn);
body.append(button({ label: 'Вернуть форму после лепки', icon: 'broom', variant: 'secondary', cls: 'btn-block', onClick: () => engine.clearSculpt() }));
body.append(h('div', { class: 'field-hint' }, 'При первом включении загружается модель распознавания рук (около 10 МБ), нужен интернет. Видео с камеры никуда не отправляется.'));
}
body.append(field('Сила', amount.el));
const extraCtl = {};
const whenList = [];
const put = (el, ex) => {
body.append(el);
if (ex.when) whenList.push([el, ex.when]);
};
const applyWhen = () => whenList.forEach(([el, w]) => (el.hidden = !w[1].includes(L[w[0]])));
if (def.extras.some((x) => x.key)) body.append(h('div', { class: 'fx-sub' }, 'Параметры'));
for (const ex of def.extras) {
const after = () => {
applyWhen();
save();
if (ex.relink) engine.relink();
if (ex.reframe) engine.rebuildFramesSoon();
};
if (ex.type === 'select') {
const sl = select({ options: ex.options.map(([value, label]) => ({ value, label })), value: L[ex.key], onChange: (v) => { L[ex.key] = v; after(); } });
extraCtl[ex.key] = sl;
put(field(ex.label, sl.el, { wide: true }), ex);
} else if (ex.type === 'note') {
put(h('div', { class: 'field-hint' }, ex.text), ex);
} else if (ex.type === 'title') {
put(h('div', { class: 'fx-sub' }, ex.label), ex);
} else if (ex.type === 'color') {
const ctl = colorChoice(L, ex.key, after, !!ex.natural);
extraCtl[ex.key] = ctl;
put(field(ex.label, ctl.el, { wide: true }), ex);
} else if (ex.type === 'seg') {
const sg = segmented({ cls: ex.options.length > 3 ? 'seg-tight' : undefined, options: ex.options.map(([value, label]) => ({ value, label })), value: L[ex.key], onChange: (v) => { L[ex.key] = v; after(); } });
extraCtl[ex.key] = sg;
put(field(ex.label, sg.el, { wide: true }), ex);
} else {
const sl = slider({ min: ex.min, max: ex.max, step: ex.step, value: L[ex.key], digits: ex.int ? 0 : 2, unit: ex.unit, onInput: (v) => { L[ex.key] = v; }, onChange: after });
extraCtl[ex.key] = sl;
put(field(ex.label, sl.el), ex);
}
}
applyWhen();
const react = slider({ min: 0, max: 1, step: 0.05, value: L.react, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { L.react = v; }, onChange: save });
const reactRow = field('Сила реакции', react.el);
const modeSeg = segmented({
cls: 'seg-tight',
options: [{ value: 'amp', label: 'Усиливать', title: 'Сила эффекта растёт и падает вместе с громкостью выбранных частот' }, { value: 'gate', label: 'По порогу', title: 'Эффект включается, когда выбранные частоты громче порога, и плавно гаснет' }],
value: L.amode,
onChange: (v) => {
L.amode = v;
audioUiFull();
save();
},
});
const thr = slider({ min: 0.05, max: 0.95, step: 0.01, value: L.thr, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { L.thr = v; }, onChange: save });
const atk = slider({ log: true, min: 0.005, max: 1, step: 0.005, value: L.atk, format: (v) => (v < 0.1 ? Math.round(v * 1000) + ' мс' : v.toFixed(2) + ' с'), onInput: (v) => { L.atk = v; }, onChange: save });
const rel = slider({ log: true, min: 0.03, max: 4, step: 0.01, value: L.rel, format: (v) => (v < 0.1 ? Math.round(v * 1000) + ' мс' : v.toFixed(2) + ' с'), onInput: (v) => { L.rel = v; }, onChange: save });
const gateBox = h('div', { class: 'sec-body', style: { padding: 0 } }, field('Порог', thr.el), field('Включается за', atk.el), field('Гаснет за', rel.el));
const picker = freqPicker(L, save);
const band = segmented({
cls: 'seg-tight',
options: BANDS.map((b) => ({ value: b.id, label: b.label, title: b.title })),
value: L.band,
onChange: (v) => {
L.band = v;
if (v !== 'none' && !L.react) {
L.react = 0.7;
react.set(0.7);
}
audioUiFull();
save();
},
});
const modeRow = field('Как реагирует', modeSeg.el, { wide: true });
const audioUiFull = () => {
const on = L.band !== 'none';
modeRow.hidden = !on;
picker.el.hidden = !on;
reactRow.hidden = !on || L.amode === 'gate';
gateBox.hidden = !on || L.amode !== 'gate';
picker.draw();
};
const audioWrap = h('div', { class: 'fx-grp-body' }, field('Слушает частоты', band.el, { wide: true }), picker.el, modeRow, reactRow, gateBox);
let audioOpen = L.band !== 'none';
const audioHead = h('button', { type: 'button', class: 'fx-sub fx-sub-toggle', 'aria-expanded': String(audioOpen) }, h('span', { class: 'ic-wrap', html: icon('caret-down', 12) }), 'Реакция на звук');
const audioState = h('span', { class: 'fx-sub-state' });
audioHead.append(audioState);
const syncAudioHead = () => {
audioWrap.hidden = !audioOpen;
audioHead.setAttribute('aria-expanded', String(audioOpen));
audioState.textContent = L.band === 'none' ? 'выкл.' : L.band === 'custom' ? 'свои частоты' : (BANDS.find((x) => x.id === L.band) || { label: '' }).label;
};
audioHead.addEventListener('click', () => {
audioOpen = !audioOpen;
syncAudioHead();
picker.draw();
});
band.el.addEventListener('click', () => requestAnimationFrame(syncAudioHead));
body.append(audioHead, audioWrap);
syncAudioHead();
audioUiFull();
const prevCanvas = h('canvas', { class: 'fx-prev', 'aria-hidden': 'true' });
const row = h('div', { class: 'fx-layer-head', role: 'button', tabindex: '0' }, prevCanvas, h('span', { class: 'fx-layer-title' }, def.name), sw.el);
const card = h('div', { class: 'fx-layer' + (L.on ? ' is-on' : ''), 'data-layer': def.id, 'data-tip': def.hint, 'data-tip-pos': 'right', 'data-tip-delay': '1300' }, row);
const insp = h('div', { class: 'fx-insp', 'data-layer': def.id }, body);
row.addEventListener('click', (e) => {
if (!e.target.closest('.switch')) {
select_(def.id);
fxTabHook();
}
});
row.addEventListener('keydown', (e) => {
if (e.key === 'Enter') {
select_(def.id);
fxTabHook();
}
});
fbody.append(card);
attachPreview(prevCanvas, def.id, card, () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e58a45');
inspBox.append(insp);
cards.push({ folder, def, L, sw, amount, react, band, reactRow, modeSeg, thr, atk, rel, audioUi: audioUiFull, syncHead: syncAudioHead, picker, extraCtl, applyWhen, card, insp, fhead });
}
}
const inspEmpty = h('div', { class: 'empty-note' }, h('strong', {}, 'Выберите эффект'), h('span', {}, 'Нажмите на строку в списке слева, чтобы настроить его здесь'));
const secInsp = section('Настройки эффекта', { key: 'fx-insp' }, inspBox);
function countActive() {
const n = cards.filter((c) => c.L.on).length;
if (leftCount) leftCount.textContent = n ? `включено: ${n}` : 'ничего не включено';
for (const grp of new Set(cards.map((c) => c.def.group))) {
const cs = cards.filter((c) => c.def.group === grp);
const k = cs.filter((c) => c.L.on).length;
const el = cs[0].fhead.querySelector('.fx-folder-n');
el.textContent = k ? String(k) : '';
}
}
select_((cards.find((c) => c.L.on) || cards.find((c) => c.def.group !== 'Видео') || cards[0]).def.id);
const sourceSeg = segmented({
options: [
{ value: 'synth', label: 'Музыка', title: 'Встроенная музыка: эмбиент, джангл, брейккор' },
{ value: 'file', label: 'Файл', title: 'Загрузить свой аудиофайл' },
{ value: 'video', label: 'Видео', title: 'Звук из открытого видео' },
{ value: 'mic', label: 'Микроф.', title: 'Живой звук с микрофона' },
],
value: engine.sourceType,
onChange: async (v) => {
sourceSeg.set(engine.sourceType);
try {
if (v === 'synth') await engine.useSynth();
else if (v === 'file') fileInput.click();
else if (v === 'video') await engine.useVideoAudio();
else await engine.useMic();
} catch (e) {
console.error(e);
app.toast(v === 'mic' ? 'Нет доступа к микрофону' : v === 'video' ? e.message : 'Не удалось включить звук: ' + (e.message || e), v === 'video' ? 'warn' : 'error');
}
sync();
},
});
const fileInput = h('input', { type: 'file', accept: 'audio/*', hidden: true });
fileInput.addEventListener('change', async () => {
const f = fileInput.files && fileInput.files[0];
fileInput.value = '';
if (!f) return;
try {
await engine.loadFile(f);
} catch (e) {
app.toast('Не удалось прочитать аудиофайл', 'error');
}
sync();
});
document.body.append(fileInput);
const style = select({ options: SYNTH_STYLES.map((s) => ({ value: s.id, label: s.name })), value: st.audio.style, onChange: (v) => engine.useSynth(v).then(sync) });
const styleRow = field('Стиль', style.el);
const gain = slider({ min: 0.3, max: 3, step: 0.05, value: st.audio.gain, digits: 2, onInput: (v) => { st.audio.gain = v; }, onChange: save });
const volume = slider({ min: 0, max: 1, step: 0.05, value: st.audio.volume, format: (v) => Math.round(v * 100) + '%', onInput: (v) => engine.setVolume(v) });
const idle = switchRow('Живая сцена без звука', { value: st.audio.idle, onChange: (v) => { st.audio.idle = v; st.audio.idleSet = true; save(); } });
const meters = makeMeters();
const reactList = h('div', { class: 'fx-react-list' });
const reactTitle = h('div', { class: 'fx-sub' }, 'Что реагирует на звук');
const secAudio = section('Звук', { key: 'fx-audio' }, idle.el, sourceSeg.el, styleRow, meters.el, field('Чувствительность', gain.el), field('Громкость', volume.el), reactTitle, reactList);
function renderReactList() {
const BL = Object.fromEntries(BANDS.map((b) => [b.id, b.title.split(':')[0]]));
const act = cards.filter((c) => c.L.on && c.L.band !== 'none');
reactList.textContent = '';
reactTitle.hidden = false;
if (!act.length) {
reactList.append(h('div', { class: 'field-hint' }, 'Пока ни один эффект не слушает звук. Откройте эффект слева и выберите «Реагирует на звук»: бас, свой диапазон частот или удар.'));
return;
}
for (const c of act) {
const how = c.L.amode === 'gate' ? 'по порогу' : 'усиливается';
const where = c.L.band === 'custom' ? `${engine.hzAt(c.L.lo)}–${engine.hzAt(c.L.hi)} Гц` : BL[c.L.band];
const b = h('button', { type: 'button', class: 'fx-react-row' }, h('b', {}, c.def.name), h('span', {}, `${where}, ${how}`));
b.addEventListener('click', () => {
select_(c.def.id);
showFxTab('insp');
});
reactList.append(b);
}
}
const palettes = h('div', { class: 'fx-palettes', role: 'radiogroup', 'aria-label': 'Палитра' });
const palBtns = new Map();
for (const p of FX_PALETTES) {
const b = h('button', { type: 'button', class: 'fx-pal', role: 'radio', 'aria-label': p.name, 'data-tip': p.name, style: { background: `linear-gradient(90deg, ${p.c[0]}, ${p.c[1]}, ${p.c[2]})` } });
b.addEventListener('click', () => {
st.look.palette = p.id;
if (st.look.colorBy === 'model') st.look.colorBy = 'disp';
engine._userColor = true;
sync();
save();
});
palBtns.set(p.id, b);
palettes.append(b);
}
const colorBy = select({ options: COLOR_BY_UI.map((c) => ({ value: c.id, label: c.label })), value: st.look.colorBy, onChange: (v) => { engine.setColorBy(v); } });
const shapeTiles = h('div', { class: 'shape-grid shape-row', role: 'radiogroup', 'aria-label': 'Форма точек' });
const shapeBtns = new Map();
for (const sh of POINT_SHAPE_LIST) {
const b = h('button', { type: 'button', class: 'shape-tile', role: 'radio', 'data-shape': sh.value }, h('span', { class: 'shape-glyph' }), h('span', { class: 'shape-name' }, sh.label));
b.dataset.tip = sh.label;
b.addEventListener('click', () => {
pset.shape = sh.value;
st.look.glyph = 'off';
app.saveSettings();
save();
sync();
});
shapeBtns.set(sh.value, b);
shapeTiles.append(b);
}
for (const g of [{ id: 'ascii', label: 'Символы ASCII: знаки и буквы', ch: '#@' }, { id: 'letters', label: 'Латинские буквы', ch: 'Aa' }, { id: 'digits', label: 'Цифры', ch: '01' }, { id: 'blocks', label: 'Блоки', ch: '▒█' }]) {
const b = h('button', { type: 'button', class: 'shape-tile', role: 'radio', 'data-shape': g.id, 'data-tip': g.label }, h('span', { class: 'shape-glyph shape-char' }, g.ch), h('span', { class: 'shape-name' }, g.label));
b.addEventListener('click', () => {
st.look.glyph = g.id;
save();
sync();
});
shapeBtns.set(g.id, b);
shapeTiles.append(b);
}
const solidPick = colorField({ value: pset.solidColor, onInput: (v) => { pset.solidColor = v; }, onChange: () => app.saveSettings() });
const solidRow = field('Свой цвет', solidPick.el);
const origBtn = button({ label: 'Исходный цвет модели', icon: 'arrow-counter-clockwise', variant: 'secondary', cls: 'btn-block', title: 'Вернуть настоящие цвета и текстуру модели вместо палитры', onClick: () => engine.setColorBy('model') });
const anim = { format: 'gif', seconds: 4 };
const animFmt = segmented({ options: [{ value: 'gif', label: 'GIF', title: 'Зацикленная анимация, открывается везде' }, { value: 'mp4', label: 'MP4 со звуком', title: 'Видео в хорошем качестве, открывается везде' }], value: anim.format, onChange: (v) => { anim.format = v; } });
const animSec = slider({ min: 1, max: 15, step: 1, value: anim.seconds, digits: 0, unit: ' с', onInput: (v) => { anim.seconds = v; } });
const animBtn = button({ label: 'Записать и сохранить', icon: 'record', variant: 'primary', cls: 'btn-block', onClick: () => engine.saveAnimation({ format: anim.format, seconds: anim.seconds }) });
const animInfo = h('div', { class: 'field-hint' }, 'Запишется то, что сейчас видно на сцене, вместе со всеми эффектами.');
const rset = app.settings.render;
const autoQ = switchRow('Авто-качество', { value: rset.autoQuality, onChange: (v) => { rset.autoQuality = v; app.saveSettings(); } });
const capSeg = segmented({ cls: 'seg-tight', options: [{ value: 0, label: 'Без лимита' }, { value: 30, label: '30 к/с', title: 'Вдвое меньше нагрузка на видеокарту и нагрев' }], value: rset.fpsCap, onChange: (v) => { rset.fpsCap = Number(v); app.saveSettings(); } });
const perfHint = h('div', { class: 'field-hint' }, 'Авто-качество снижает чёткость, только пока компьютеру не хватает кадров, и возвращает её, когда запас появляется. Эффекты и цвета не меняются.');
const hudSw = switchRow('Индикаторы уровней звука', { value: st.look.hud, onChange: (v) => { st.look.hud = v; save(); } });
const hudSpec = switchRow('Спектр внизу', { value: st.look.hudSpectrum, onChange: (v) => { st.look.hudSpectrum = v; save(); } });
const attSw = switchRow('Мельче вдали', { value: pset.attenuate, onChange: (v) => { pset.attenuate = v; app.saveSettings(); } });
const sizeNoise = slider({ min: 0, max: 2, step: 0.05, value: st.look.sizeNoise || 0, digits: 2, onInput: (v) => { st.look.sizeNoise = v; }, onChange: save });
const sizeAudio = slider({ min: 0, max: 2, step: 0.05, value: st.look.sizeAudio || 0, digits: 2, onInput: (v) => { st.look.sizeAudio = v; }, onChange: save });
const shade = slider({ min: 0, max: 1, step: 0.05, value: st.look.shade || 0, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.shade = v; }, onChange: save });
const glow = slider({ min: 0, max: 1, step: 0.05, value: st.look.glow, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.glow = v; }, onChange: save });
const bright = slider({ min: 0.3, max: 2, step: 0.05, value: st.look.bright, digits: 2, onInput: (v) => { st.look.bright = v; }, onChange: save });
const bloom = slider({ min: 0, max: 1, step: 0.05, value: st.look.bloom || 0, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.bloom = v; }, onChange: save });
const aberration = slider({ min: 0, max: 1, step: 0.05, value: st.look.aberration || 0, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.aberration = v; }, onChange: save });
const dofOn = switchRow('Глубина резкости (DoF)', { value: st.look.dofOn || false, onChange: (v) => { st.look.dofOn = v; syncDof(); save(); } });
const dofDist = slider({ min: 1.5, max: 10, step: 0.1, value: st.look.dofDist || 5.2, digits: 1, unit: ' м', onInput: (v) => { st.look.dofDist = v; }, onChange: save });
const dofRange = slider({ min: 0.2, max: 3, step: 0.1, value: st.look.dofRange || 1.4, digits: 1, unit: ' м', onInput: (v) => { st.look.dofRange = v; }, onChange: save });
const dofBody = h('div', { class: 'sec-body', style: { padding: 0 } }, field('Дистанция фокуса', dofDist.el), field('Глубина фокуса', dofRange.el));
const syncDof = () => { dofBody.hidden = !st.look.dofOn; };
syncDof();
const blend = segmented({ options: [{ value: 'normal', label: 'Плотные', title: 'Непрозрачные точки' }, { value: 'add', label: 'Свечение', title: 'Точки складывают свет: ярче в плотных местах' }], value: st.look.blend, onChange: (v) => { st.look.blend = v; save(); } });
const rotate = switchRow('Вращать форму', { value: st.look.autoRotate, onChange: (v) => { st.look.autoRotate = v; save(); syncRotate(); } });
const rotSpeed = slider({ min: 0.05, max: 1.5, step: 0.05, value: st.look.rotSpeed, digits: 2, onInput: (v) => { st.look.rotSpeed = v; }, onChange: save });
const rotSpeedRow = field('Скорость вращения', rotSpeed.el);
const syncRotate = () => { rotSpeedRow.hidden = !st.look.autoRotate; };
syncRotate();
const secLook = section('Вид', { key: 'fx-look' }, palettes, origBtn, field('Форма точек и символы', shapeTiles, { wide: true }), attSw.el, field('Цвет точек', colorBy.el), solidRow, field('Объём (тень)', shade.el), field('Размер по шуму', sizeNoise.el), field('Размер по звуку', sizeAudio.el), field('Свечение', glow.el), field('Яркость', bright.el), field('Блум (свечение)', bloom.el), field('Хром. аберрация', aberration.el), dofOn.el, dofBody, field('Точки', blend.el, { wide: true }), rotate.el, rotSpeedRow, hudSw.el, hudSpec.el, h('div', { class: 'fx-sub' }, 'Производительность'), autoQ.el, field('Лимит кадров', capSeg.el, { wide: true }), perfHint, h('div', { class: 'fx-sub' }, 'Сохранить анимацию'), field('Формат', animFmt.el, { wide: true }), field('Длина', animSec.el), animBtn, animInfo);
const secMedia = createMediaPanel(app, null, { fx: true }).section;
const FX_TABS = [['insp', 'Эффект', 'sparkle', [secInsp]], ['source', 'Форма', 'cube', [secSource, secMorph, secMedia]], ['zone', 'Звук', 'equalizer', [secAudio]], ['look', 'Вид', 'sliders-horizontal', [secLook]]];
const tabBar = h('div', { class: 'fx-tabs', role: 'tablist', 'aria-label': 'Разделы настроек' });
let curTab = 'insp';
try {
curTab = localStorage.getItem('objglb.fx.tab') || 'insp';
} catch (_) {}
const tabBtns = new Map();
const showFxTab = (id) => {
curTab = FX_TABS.some((t) => t[0] === id) ? id : 'insp';
for (const [k, , , secs] of FX_TABS) {
secs.forEach((sec) => (sec.el.hidden = k !== curTab));
tabBtns.get(k).setAttribute('aria-selected', String(k === curTab));
}
try {
localStorage.setItem('objglb.fx.tab', curTab);
} catch (_) {}
};
for (const [k, label, ic] of FX_TABS) {
const b = h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'false' }, h('span', { class: 'ic', html: icon(ic, 15) }), h('span', { class: 'tab-label' }, label));
b.addEventListener('click', () => showFxTab(k));
tabBtns.set(k, b);
tabBar.append(b);
}
root.append(tabBar, ...FX_TABS.flatMap((t) => t[3].map((x) => x.el)));
showFxTab(curTab);
fxTabHook = () => showFxTab('insp');
const bar = $bar();
const playBtn = iconButton({ icon: 'speaker-high', title: 'Звук: включить или выключить (Пробел)', onClick: () => engine.toggle().catch(() => {}) });
const collapseBtn = iconButton({ icon: 'atom', title: 'Разрушить / собрать форму («Распад»)', onClick: () => { engine.toggleCollapse(); sync(); } });
const appEl = document.getElementById('app');
const focusBtn = iconButton({ icon: 'corners-out', title: 'Только сцена: скрыть интерфейс (Esc вернёт)', onClick: () => setFocus(!appEl.classList.contains('fx-focus')) });
function setFocus(on) {
appEl.classList.toggle('fx-focus', on);
focusBtn.classList.toggle('is-active', on);
if (on) app.toast('Интерфейс скрыт. Esc или эта же кнопка вернут его', 'info');
}
app.ui.exitFxFocus = () => setFocus(false);
const orthoBtn = iconButton({ icon: 'perspective', title: 'Проекция: перспектива или ортогональная', onClick: () => { app.nav.toggleOrtho(); sync(); } });
const camBtn = iconButton({ icon: 'video-camera', title: 'Камера: управление руками и пальцами', onClick: () => engine.toggleMotionCam().then(sync) });
const barMeters = makeMeters(true);
const recBtn = iconButton({ icon: 'record', title: 'Записать видео со звуком (MP4)', cls: 'fx-rec', onClick: () => (engine.recording ? engine.stopRecording() : engine.startRecording()) });
const recTime = h('span', { class: 'fx-rec-time' });
const animPanel = h('div', { class: 'fx-anim vp-pill', hidden: true, role: 'group', 'aria-label': 'Анимация по ключам' });
const keyAnimBtn = iconButton({ icon: 'film-strip', title: 'Анимация: ключи камеры и эффектов на дорожке времени', onClick: () => toggleAnim() });
const aPlay = iconButton({ icon: 'play', title: 'Играть и остановить', cls: 'fx-anim-play', onClick: () => { if (engine.animPlaying) engine.animPause(); else if (!engine.animPlay()) app.toast('Поставьте минимум два ключа в разное время', 'info'); } });
const aTime = h('span', { class: 'fx-anim-time' });
const aKeys = h('div', { class: 'fx-anim-keys' });
const aHead = h('div', { class: 'fx-anim-head' });
const aFill = h('div', { class: 'fx-anim-fill' });
const aTrack = h('div', { class: 'fx-anim-track' }, aFill, aKeys, aHead);
const aLoop = iconButton({ icon: 'repeat', title: 'Повторять по кругу', onClick: () => { st.anim.loop = !st.anim.loop; save(); animSync(); } });
const aDur = h('input', { type: 'number', class: 'num-in fx-anim-dur', min: 1, max: 120, step: 1, value: 8, 'aria-label': 'Длина анимации, секунд', 'data-tip': 'Длина анимации, секунд' });
aDur.addEventListener('change', () => { engine.animSetDuration(Number(aDur.value) || 8); animSync(); });
const aClose = iconButton({ icon: 'x', title: 'Закрыть анимацию', onClick: () => toggleAnim(false) });
let selKey = null;
const aAdd = button({ label: 'Ключ', icon: 'plus', variant: 'primary', cls: 'btn-sm', title: 'Запомнить камеру и эффекты в этот момент времени', size: 14, onClick: () => { selKey = engine.animAddKey(); animSync(); } });
const aUpd = iconButton({ icon: 'arrow-clockwise', title: 'Обновить выбранный ключ тем, что сейчас на сцене', onClick: () => { if (selKey) engine.animUpdateKey(selKey); } });
const aDel = iconButton({ icon: 'trash', title: 'Удалить выбранный ключ', onClick: () => { if (selKey) { engine.animRemoveKey(selKey); selKey = null; animSync(); } } });
const aRec = button({ label: 'Записать', icon: 'record', variant: 'secondary', cls: 'btn-sm', title: 'Проиграет анимацию один раз и сохранит видео со звуком', size: 14, onClick: () => { if (!engine.animRecord()) app.toast('Поставьте минимум два ключа в разное время', 'info'); } });
const aHint = h('div', { class: 'fx-anim-hint' });
animPanel.append(
h('div', { class: 'fx-anim-row' }, aPlay, aTime, aTrack, aLoop, h('span', { class: 'fx-anim-dur-wrap' }, aDur, h('span', {}, 'с')), aClose),
h('div', { class: 'fx-anim-row fx-anim-actions' }, aAdd, aUpd, aDel, aHint, aRec)
);
document.getElementById('viewport').append(animPanel);
function toggleAnim(on = animPanel.hidden) {
animPanel.hidden = !on;
keyAnimBtn.classList.toggle('is-active', on);
if (!on) engine.animPause();
else if (!st.anim.keys.length) selKey = engine.animAddKey(0);
animSync();
}
document.getElementById('viewport').addEventListener('pointerdown', (e) => {
if (engine.animPlaying && !engine.animRec && !e.target.closest('.fx-anim, .fx-bar')) engine.animPause();
}, true);
const timeAt = (e) => {
const r = aTrack.getBoundingClientRect();
return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * st.anim.dur;
};
aTrack.addEventListener('pointerdown', (e) => {
if (e.target.closest('.fx-anim-key')) return;
engine.animPause();
aTrack.setPointerCapture(e.pointerId);
engine.animSeek(timeAt(e));
const mv = (ev) => engine.animSeek(timeAt(ev));
const up = () => {
aTrack.removeEventListener('pointermove', mv);
aTrack.removeEventListener('pointerup', up);
};
aTrack.addEventListener('pointermove', mv);
aTrack.addEventListener('pointerup', up);
});
let dragging = false;
const markSel = () => [...aKeys.children].forEach((el, i) => el.classList.toggle('is-sel', st.anim.keys[i] === selKey));
function renderKeys() {
const A = st.anim;
aKeys.textContent = '';
for (const k of A.keys) {
const b = h('button', { type: 'button', class: 'fx-anim-key' + (k === selKey ? ' is-sel' : ''), style: { left: (k.t / A.dur) * 100 + '%' }, 'data-tip': `Ключ, ${k.t.toFixed(1)} с. Тяните, чтобы сдвинуть по времени`, 'aria-label': 'Ключ' });
b.addEventListener('pointerdown', (e) => {
e.stopPropagation();
e.preventDefault();
engine.animPause();
selKey = k;
dragging = true;
engine.animT = k.t;
markSel();
aUpd.disabled = aDel.disabled = false;
aTime.textContent = `${k.t.toFixed(1)} с`;
aHead.style.left = (k.t / A.dur) * 100 + '%';
b.setPointerCapture(e.pointerId);
const mv = (ev) => {
engine.animMoveKey(k, timeAt(ev));
engine.animT = k.t;
b.style.left = (k.t / A.dur) * 100 + '%';
aHead.style.left = (k.t / A.dur) * 100 + '%';
aTime.textContent = `${k.t.toFixed(1)} с`;
};
const up = () => {
b.removeEventListener('pointermove', mv);
b.removeEventListener('pointerup', up);
b.removeEventListener('pointercancel', up);
dragging = false;
keysSig = '';
animSync();
};
b.addEventListener('pointermove', mv);
b.addEventListener('pointerup', up);
b.addEventListener('pointercancel', up);
});
aKeys.append(b);
}
}
let keysSig = '';
function animSync() {
const A = st.anim;
const frac = A.dur ? Math.min(1, engine.animT / A.dur) : 0;
aTime.textContent = `${engine.animT.toFixed(1)} с`;
aHead.style.left = frac * 100 + '%';
aFill.style.width = frac * 100 + '%';
aTrack.style.setProperty('--ticks', Math.max(1, Math.round(A.dur)));
aTrack.style.setProperty('--majors', Math.max(1, Math.round(A.dur)) / 5);
aPlay.textContent = '';
aPlay.append(h('span', { class: 'ic-wrap', html: icon(engine.animPlaying ? 'pause' : 'play', 18) }));
aPlay.classList.toggle('is-active', engine.animPlaying);
aLoop.classList.toggle('is-active', !!A.loop);
aRec.disabled = engine.animRec;
if (document.activeElement !== aDur) aDur.value = A.dur;
if (selKey && !A.keys.includes(selKey)) selKey = null;
aUpd.disabled = aDel.disabled = !selKey;
const distinct = new Set(A.keys.map((k) => k.t)).size;
aHint.textContent = distinct < 2 ? (A.keys.length ? 'Передвиньте время, измените сцену и добавьте ещё ключ' : 'Нажмите «Ключ», чтобы запомнить сцену') : '';
if (dragging) return;
const sig = A.dur + '|' + A.keys.map((k) => k.t).join(',');
if (sig !== keysSig) {
keysSig = sig;
renderKeys();
}
markSel();
}
app.bus.on('fxanim', animSync);
app.bus.on('fx', animSync);
const BGS = [['', 'Как в редакторе'], ['#0b0d11', 'Чёрный'], ['#14161b', 'Графит'], ['#0d1b2a', 'Ночь'], ['#1a0f2e', 'Сумерки'], ['#2a1208', 'Янтарь'], ['#0f2a1f', 'Хвоя'], ['#ffffff', 'Белый']];
const bgBtn = h('button', { type: 'button', class: 'btn btn-icon fx-bg-btn', 'aria-label': 'Цвет фона', 'data-tip': 'Цвет фона сцены', 'aria-expanded': 'false' }, h('span', { class: 'fx-bg-dot' }));
const bgPop = h('div', { class: 'fx-bg-pop popover', hidden: true });
const bgSw = h('div', { class: 'fx-bg-sw' });
const bgSwBtns = BGS.map(([c, name]) => {
const b = h('button', { type: 'button', class: 'fx-bg-chip', 'aria-label': name, 'data-tip': name, style: c ? { background: c } : {} });
if (!c) b.classList.add('is-default');
b.addEventListener('click', () => setBg(c));
bgSw.append(b);
return [c, b];
});
const bgColor = colorField({ value: st.look.bg || '#14161b', onInput: (v) => setBg(v, true), onChange: save });
const bgVig = switchRow('Затемнение к краям', { value: st.look.vignette, onChange: (v) => { st.look.vignette = v; engine.applyBg(); save(); } });
bgPop.append(h('div', { class: 'fx-bg-title' }, 'Цвет фона'), bgSw, field('Свой цвет', bgColor.el), bgVig.el);
document.getElementById('viewport').append(bgPop);
function setBg(c, live) {
st.look.bg = c;
engine.applyBg();
if (!live) bgColor.set(c || '#14161b');
syncBg();
save();
}
function syncBg() {
bgBtn.querySelector('.fx-bg-dot').style.background = st.look.bg || 'var(--bg-sunken)';
bgSwBtns.forEach(([c, b]) => b.classList.toggle('is-active', c === st.look.bg));
bgVig.set(st.look.vignette);
}
bgBtn.addEventListener('click', (e) => {
e.stopPropagation();
bgPop.hidden = !bgPop.hidden;
bgBtn.setAttribute('aria-expanded', String(!bgPop.hidden));
});
document.addEventListener('pointerdown', (e) => {
if (!bgPop.hidden && !bgPop.contains(e.target) && !bgBtn.contains(e.target) && !e.target.closest('.cp-pop')) {
bgPop.hidden = true;
bgBtn.setAttribute('aria-expanded', 'false');
}
});
syncBg();
const leftBtn = iconButton({ icon: 'stack', title: 'Список эффектов', cls: 'fx-left-btn', onClick: () => document.getElementById('fxLeft').classList.toggle('fx-left-open') });
bar.append(leftBtn, playBtn, collapseBtn, camBtn, barMeters.el, h('span', { class: 'fx-bar-sep' }), bgBtn, orthoBtn, focusBtn, h('span', { class: 'fx-bar-sep' }), recBtn, keyAnimBtn, recTime);
function sync() {
const n = engine.geometry ? engine.geometry.attributes.position.count : st.count;
countHint.textContent = `Сейчас ${formatInt(n)} частиц, около ${Math.round((n * 128) / 1048576)} МБ памяти. Комфортно до ${formatCount(getDevice(app).limits.comfort)}.`;
const kind = engine.modelProvider ? engine.modelProvider.kind() : 'none';
modelNote.textContent = kind === 'cloud' ? `Берётся облако точек из редактора (${formatInt(engine.modelProvider.total())} точек). Больше этого частиц не будет.` : kind === 'mesh' ? 'Берутся точки с поверхности вашей модели.' : 'Модели в сцене нет: показана готовая форма. Добавьте модель, и она заменит её.';
countActive();
for (const c of cards) if (c.def.group === 'Видео') c.folder.hidden = !engine.videoLoaded;
renderReactList();
cards.forEach((c) => {
c.card.classList.toggle('is-on', c.L.on);
c.sw.set(c.L.on);
c.amount.set(c.L.amount);
c.react.set(c.L.react);
c.band.set(c.L.band);
c.modeSeg.set(c.L.amode);
c.thr.set(c.L.thr);
c.atk.set(c.L.atk);
c.rel.set(c.L.rel);
c.audioUi();
c.syncHead();
for (const [k, ctl] of Object.entries(c.extraCtl)) ctl.set(c.L[k]);
c.applyWhen();
});
palBtns.forEach((b, k) => b.setAttribute('aria-checked', String(k === st.look.palette)));
colorBy.set(st.look.colorBy);
size.set(pset.size);
attSw.set(pset.attenuate);
solidPick.set(pset.solidColor);
solidRow.hidden = st.look.colorBy !== 'solid';
shapeBtns.forEach((b, k) => b.setAttribute('aria-checked', String((st.look.glyph && st.look.glyph !== 'off') ? k === st.look.glyph : k === pset.shape)));
shade.set(st.look.shade || 0);
sizeNoise.set(st.look.sizeNoise || 0);
sizeAudio.set(st.look.sizeAudio || 0);
glow.set(st.look.glow);
bright.set(st.look.bright);
bloom.set(st.look.bloom || 0);
aberration.set(st.look.aberration || 0);
dofOn.set(st.look.dofOn || false);
dofDist.set(st.look.dofDist || 5.2);
dofRange.set(st.look.dofRange || 1.4);
syncDof();
blend.set(st.look.blend);
const ap = engine.animProgress;
animBtn.disabled = !!engine.animBusy;
animBtn.querySelector('.btn-label').textContent = ap ? `${ap.stage}: ${Math.round(ap.v * 100)}%` : 'Записать и сохранить';
hudSw.set(!!st.look.hud);
hudSpec.set(st.look.hudSpectrum !== false);
rotate.set(st.look.autoRotate);
syncRotate();
rotSpeed.set(st.look.rotSpeed);
sourceSeg.set(engine.sourceType);
styleRow.hidden = engine.sourceType !== 'synth';
style.set(st.audio.style);
count.set(Math.min(st.count, cap()));
playBtn.textContent = '';
playBtn.append(h('span', { class: 'ic-wrap', html: icon(engine.playing ? 'speaker-high' : 'speaker-slash', 18) }));
collapseBtn.classList.toggle('is-active', engine.isCollapsed);
const pl = document.querySelector('.fx-insp[data-layer="physics"] .btn-label');
if (pl) pl.textContent = engine.isCollapsed ? 'Собрать форму' : 'Разрушить форму';
camBtn.classList.toggle('is-active', !!engine.camTracker?.running);
orthoBtn.classList.toggle('is-active', !!app.nav.ortho);
orthoBtn.dataset.tip = app.nav.ortho ? 'Сейчас: ортогональная проекция. Включить перспективу' : 'Сейчас: перспектива. Включить ортогональную проекцию';
recBtn.classList.toggle('is-rec', engine.recording);
recBtn.dataset.tip = engine.recording ? 'Остановить запись и сохранить' : 'Записать видео со звуком (MP4)';
recTime.textContent = '';
}
app.bus.on('fx', sync);
app.bus.on('media', () => {
sync();
setTimeout(sync, 700);
});
app.bus.on('device', () => {
count.setRange(20000, cap());
sync();
});
app.bus.on('scene', () => {
renderForms();
syncMorph();
sync();
});
let recTick = 0;
engine.onFrame = (lv) => {
meters.set(lv);
barMeters.set(lv);
if (engine.recording && ++recTick % 15 === 0) {
const s = Math.floor((performance.now() - engine._recT0) / 1000);
recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
};
sync();
return { sync };
}
function $bar() {
return document.getElementById('fxBar');
}
function makeMeters(small = false) {
const items = [['bass', 'Бас'], ['mid', 'Сер.'], ['high', 'Верх'], ['beat', 'Бит']];
const bars = {};
const el = h('div', { class: 'fx-meters' + (small ? ' is-small' : '') });
for (const [k, label] of items) {
const i = h('i');
bars[k] = i;
el.append(h('div', { class: 'fx-meter', 'data-tip': label }, h('div', { class: 'fx-meter-track' }, i), small ? null : h('span', {}, label)));
}
return {
el,
set(lv) {
for (const k in bars) bars[k].style.transform = `scaleY(${Math.max(0.03, Math.min(1, lv[k] || 0))})`;
},
};
}
