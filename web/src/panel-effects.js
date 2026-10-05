import { h, formatInt } from './util.js';
import { icon } from './icons.js';
import { section, field, slider, segmented, switchRow, toggle, button, iconButton, select, colorField } from './ui-kit.js';
import * as THREE from 'three';
import { sampleSurface } from './pointcloud.js';
import { getDevice } from './device-card.js';
import { formatCount } from './capabilities.js';
import { FX_SHAPES, FX_LAYERS, FX_PALETTES, MASK_MODES, BANDS, COLOR_BY, SYNTH_STYLES } from './effects-engine.js';
export function makeModelProvider(app) {
const root = app.viewport.root;
const shown = (o) => {
for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
return true;
};
const clouds = () => {
const a = [];
root.traverse((o) => {
if (o.isPoints && !o.userData.helper && o.geometry.attributes.position && shown(o)) a.push(o);
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
return {
available: () => clouds().length > 0 || meshes().length > 0,
kind: () => (clouds().length ? 'cloud' : meshes().length ? 'mesh' : 'none'),
total: () => clouds().reduce((n, o) => n + o.geometry.attributes.position.count, 0),
async get(count) {
const c = clouds();
if (c.length) return fromClouds(c, count);
const list = meshes();
if (!list.length) return null;
const entries = list.map((m) => ({ mesh: m, mats: app.display.getOriginal(m) }));
return sampleSurface(entries, count, { onProgress: (p) => app.ui.busy('Беру точки с модели', 0.2 + p * 0.7) });
},
};
}
const TRACK_COLORS = ['#ffffff', '#00f0ff', '#ff1fcb', '#ffd90f', '#7cff6b', '#ff4d4d'];
function colorChoice(L, key, done) {
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
for (const c of TRACK_COLORS) mkChip(c, c, { background: c });
const custom = colorField({ value: L[key] === 'auto' ? '#ffffff' : L[key], onInput: (v) => pick(v, true), onChange: done });
wrap.append(row, custom.el);
function mark() {
for (const [v, b] of chips) b.classList.toggle('is-active', v === L[key]);
}
function pick(v, live) {
L[key] = v;
if (!live && v !== 'auto') custom.set(v);
mark();
done();
}
mark();
return {
el: wrap,
set(v) {
if (v !== 'auto') custom.set(v);
mark();
},
};
}
export function createEffectsPanel(app, root, engine) {
const st = engine.state;
const save = () => engine.touch();
const tiles = h('div', { class: 'shape-grid fx-shapes', role: 'radiogroup', 'aria-label': 'Форма' });
const tileMap = new Map();
for (const s of FX_SHAPES) {
const b = h('button', { type: 'button', class: 'shape-tile', role: 'radio', 'data-shape': s.id }, h('span', { class: 'fx-ic', html: icon(s.icon, 22) }), h('span', { class: 'shape-name' }, s.name));
b.addEventListener('click', () => engine.setSource(s.id));
tileMap.set(s.id, b);
tiles.append(b);
}
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
const countChips = h('div', { class: 'chip-row' });
for (const n of [100000, 300000, 1000000]) countChips.append(h('button', { type: 'button', class: 'chip-btn', onclick: () => engine.setCount(Math.min(n, cap())) }, formatCount(n)));
countChips.append(h('button', { type: 'button', class: 'chip-btn', 'data-tip': 'Столько частиц комфортно для вашего компьютера', onclick: () => engine.setCount(Math.min(cap(), Math.max(20000, getDevice(app).limits.comfort))) }, 'Комфортно'));
const secSource = section('Форма', { key: 'fx-source' }, addModel, modelNote, tiles, field('Частиц', count.el), countChips, countHint);
const cards = [];
const left = document.getElementById('fxList');
const leftCount = document.getElementById('fxActive');
const inspBox = h('div', { class: 'fx-insp-box' });
let selected = null;
const select_ = (id) => {
selected = id;
for (const c of cards) {
c.card.classList.toggle('is-selected', c.def.id === id);
c.insp.classList.toggle('is-selected', c.def.id === id);
}
};
for (const grp of ['Движение', 'Графика', 'Взаимодействие']) {
const folder = h('div', { class: 'fx-folder' });
const fhead = h('button', { type: 'button', class: 'fx-folder-head', 'aria-expanded': 'true' }, h('span', { class: 'fx-folder-caret', html: icon('caret-down', 13) }), h('span', { class: 'fx-folder-name' }, grp), h('span', { class: 'fx-folder-n' }));
const fbody = h('div', { class: 'fx-folder-body' });
fhead.addEventListener('click', () => {
const closed = folder.classList.toggle('is-closed');
fhead.setAttribute('aria-expanded', String(!closed));
});
folder.append(fhead, fbody);
left.append(folder);
for (const def of FX_LAYERS.filter((d) => d.group === grp)) {
st.layers[def.id] = { ...def.def, ...(st.layers[def.id] || {}) };
const L = st.layers[def.id];
const sw = toggle({
value: L.on,
label: def.name,
onChange: (v) => {
L.on = v;
card.classList.toggle('is-on', v);
if (v) select_(def.id);
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
} else if (def.id === 'brush') {
const clearBtn = button({
label: 'Стереть краску',
icon: 'broom',
variant: 'secondary',
cls: 'btn-block',
onClick: () => engine.clearBrush(),
});
body.append(clearBtn);
} else if (def.id === 'camTrack') {
const camBtn = button({
label: engine.camTracker?.running ? 'Остановить камеру' : 'Включить веб-камеру',
icon: 'video-camera',
variant: 'secondary',
cls: 'btn-block',
onClick: async () => {
await engine.toggleMotionCam();
camBtn.querySelector('.btn-label').textContent = engine.camTracker?.running ? 'Остановить камеру' : 'Включить веб-камеру';
},
});
body.append(camBtn);
}
body.append(field('Сила', amount.el));
const extraCtl = {};
for (const ex of def.extras) {
const after = () => {
save();
if (ex.relink) engine.relink();
};
if (ex.type === 'title') {
body.append(h('div', { class: 'fx-sub' }, ex.label));
} else if (ex.type === 'color') {
const ctl = colorChoice(L, ex.key, after);
extraCtl[ex.key] = ctl;
body.append(field(ex.label, ctl.el, { wide: true }));
} else if (ex.type === 'seg') {
const sg = segmented({ cls: ex.options.length > 3 ? 'seg-tight' : undefined, options: ex.options.map(([value, label]) => ({ value, label })), value: L[ex.key], onChange: (v) => { L[ex.key] = v; after(); } });
extraCtl[ex.key] = sg;
body.append(field(ex.label, sg.el, { wide: true }));
} else {
const sl = slider({ min: ex.min, max: ex.max, step: ex.step, value: L[ex.key], digits: ex.int ? 0 : 2, unit: ex.unit, onInput: (v) => { L[ex.key] = v; }, onChange: after });
extraCtl[ex.key] = sl;
body.append(field(ex.label, sl.el));
}
}
const react = slider({ min: 0, max: 1, step: 0.05, value: L.react, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { L.react = v; }, onChange: save });
const reactRow = field('Сила реакции', react.el);
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
reactRow.hidden = v === 'none';
save();
},
});
reactRow.hidden = L.band === 'none';
body.append(field('Реагирует на звук', band.el, { wide: true }), reactRow);
const row = h('div', { class: 'fx-layer-head', role: 'button', tabindex: '0' }, h('span', { class: 'fx-ic', html: icon(def.icon, 16) }), h('span', { class: 'fx-layer-title' }, def.name), sw.el);
const card = h('div', { class: 'fx-layer' + (L.on ? ' is-on' : ''), 'data-layer': def.id, 'data-tip': def.hint, 'data-tip-pos': 'right' }, row);
const insp = h('div', { class: 'fx-insp', 'data-layer': def.id }, h('div', { class: 'fx-insp-head' }, h('span', { class: 'fx-ic', html: icon(def.icon, 18) }), h('div', {}, h('b', {}, def.name), h('span', {}, def.hint))), body);
row.addEventListener('click', (e) => {
if (!e.target.closest('.switch')) select_(def.id);
});
row.addEventListener('keydown', (e) => {
if (e.key === 'Enter') select_(def.id);
});
fbody.append(card);
inspBox.append(insp);
cards.push({ def, L, sw, amount, react, band, reactRow, extraCtl, card, insp, fhead });
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
select_((cards.find((c) => c.L.on) || cards[0]).def.id);
const mk = st.mask;
const maskHint = h('div', { class: 'field-hint' });
const maskMode = segmented({
cls: 'seg-tight',
options: MASK_MODES.map((m) => ({ value: m.id, label: m.label, title: m.title })),
value: mk.mode,
onChange: (v) => {
mk.mode = v;
syncMask();
save();
},
});
const maskSize = slider({ min: 0.05, max: 1, step: 0.05, value: mk.size, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { mk.size = v; }, onChange: save });
const maskSoft = slider({ min: 0, max: 1, step: 0.05, value: mk.soft, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { mk.soft = v; }, onChange: save });
const maskSpeed = slider({ min: 0, max: 2, step: 0.05, value: mk.speed, format: (v) => (v === 0 ? 'стоит' : v.toFixed(2)), onInput: (v) => { mk.speed = v; }, onChange: save });
const maskInvert = switchRow('Наоборот: живёт всё, кроме зоны', { value: mk.invert, onChange: (v) => { mk.invert = v; save(); } });
const maskShow = switchRow('Подсветить зону', { value: mk.show, onChange: (v) => { mk.show = v; save(); } });
const maskBody = h('div', { class: 'sec-body', style: { padding: 0 } }, field('Охват', maskSize.el), field('Мягкость границы', maskSoft.el), field('Скорость движения', maskSpeed.el), maskInvert.el, maskShow.el);
const HINTS = {
none: 'Эффекты работают на всей форме. Выберите зону, чтобы часть точек оставалась неподвижной.',
height: 'Верхняя часть живёт, нижняя стоит на месте. Скорость качает границу вверх и вниз.',
sphere: 'Шар-зона: внутри него точки двигаются, снаружи стоят. Скорость гоняет шар по форме.',
noise: 'Плавающие пятна: двигаются только они, остальное неподвижно. Охват задаёт долю формы.',
scan: 'Полоса пробегает по форме снизу вверх и оживляет точки на своём пути.',
};
const secMask = section('Зона действия', { key: 'fx-mask' }, maskMode.el, maskHint, maskBody);
function syncMask() {
maskBody.hidden = mk.mode === 'none';
maskHint.textContent = HINTS[mk.mode];
}
const sourceSeg = segmented({
options: [
{ value: 'synth', label: 'Синтезатор', title: 'Встроенная музыка' },
{ value: 'file', label: 'Трек', title: 'Загрузить свой аудиофайл' },
{ value: 'mic', label: 'Микрофон', title: 'Живой звук с микрофона' },
],
value: engine.sourceType,
onChange: async (v) => {
sourceSeg.set(engine.sourceType);
try {
if (v === 'synth') await engine.useSynth();
else if (v === 'file') fileInput.click();
else await engine.useMic();
} catch (e) {
console.error(e);
app.toast(v === 'mic' ? 'Нет доступа к микрофону' : 'Не удалось включить звук: ' + (e.message || e), 'error');
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
const idle = switchRow('Живая сцена без звука', { value: st.audio.idle, onChange: (v) => { st.audio.idle = v; save(); } });
const meters = makeMeters();
const secAudio = section('Звук', { key: 'fx-audio' }, sourceSeg.el, styleRow, meters.el, field('Чувствительность', gain.el), field('Громкость', volume.el), idle.el);
const palettes = h('div', { class: 'fx-palettes', role: 'radiogroup', 'aria-label': 'Палитра' });
const palBtns = new Map();
for (const p of FX_PALETTES) {
const b = h('button', { type: 'button', class: 'fx-pal', role: 'radio', 'aria-label': p.name, 'data-tip': p.name, style: { background: `linear-gradient(90deg, ${p.c[0]}, ${p.c[1]}, ${p.c[2]})` } });
b.addEventListener('click', () => {
st.look.palette = p.id;
if (st.look.colorBy === 'model') st.look.colorBy = 'disp';
sync();
save();
});
palBtns.set(p.id, b);
palettes.append(b);
}
const colorBy = segmented({ options: COLOR_BY.map((c) => ({ value: c.id, label: c.label, title: c.title })), value: st.look.colorBy, onChange: (v) => { st.look.colorBy = v; save(); } });
const size = slider({ min: 1, max: 12, step: 0.25, value: st.look.size, digits: 1, unit: ' px', onInput: (v) => { st.look.size = v; }, onChange: save });
const sizeNoise = slider({ min: 0, max: 2, step: 0.05, value: st.look.sizeNoise || 0, digits: 2, onInput: (v) => { st.look.sizeNoise = v; }, onChange: save });
const sizeAudio = slider({ min: 0, max: 2, step: 0.05, value: st.look.sizeAudio || 0, digits: 2, onInput: (v) => { st.look.sizeAudio = v; }, onChange: save });
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
const blend = segmented({ options: [{ value: 'add', label: 'Свечение', title: 'Точки складывают свет: ярче в плотных местах' }, { value: 'normal', label: 'Плотные', title: 'Непрозрачные точки' }], value: st.look.blend, onChange: (v) => { st.look.blend = v; save(); } });
const rotate = switchRow('Вращать форму', { value: st.look.autoRotate, onChange: (v) => { st.look.autoRotate = v; save(); } });
const rotSpeed = slider({ min: 0.05, max: 1.5, step: 0.05, value: st.look.rotSpeed, digits: 2, onInput: (v) => { st.look.rotSpeed = v; }, onChange: save });
const secLook = section('Вид', { key: 'fx-look' }, palettes, field('Цвет по', colorBy.el, { wide: true }), field('Размер', size.el), field('Размер по шуму', sizeNoise.el), field('Размер по звуку', sizeAudio.el), field('Свечение', glow.el), field('Яркость', bright.el), field('Блум (свечение)', bloom.el), field('Хром. аберрация', aberration.el), dofOn.el, dofBody, field('Точки', blend.el, { wide: true }), rotate.el, field('Скорость', rotSpeed.el));
root.append(secInsp.el, secSource.el, secMask.el, secAudio.el, secLook.el);
const bar = $bar();
const playBtn = iconButton({ icon: 'play', title: 'Играть / пауза (Пробел)', onClick: () => engine.toggle().catch(() => {}) });
const collapseBtn = iconButton({ icon: 'atom', title: 'Разрушить / собрать форму («Распад»)', onClick: () => { engine.toggleCollapse(); sync(); } });
const brushBtn = iconButton({ icon: 'paint-brush', title: 'Кисть: рисовать по форме', onClick: () => { st.layers.brush.on = !st.layers.brush.on; save(); sync(); } });
const orthoBtn = iconButton({ icon: 'perspective', title: 'Проекция: перспектива или ортогональная', onClick: () => { app.nav.toggleOrtho(); sync(); } });
const camBtn = iconButton({ icon: 'video-camera', title: 'Веб-камера: управление жестами', onClick: () => engine.toggleMotionCam().then(sync) });
const trackName = h('div', { class: 'fx-track' });
const barMeters = makeMeters(true);
const recBtn = iconButton({ icon: 'record', title: 'Записать видео со звуком (WebM)', cls: 'fx-rec', onClick: () => (engine.recording ? engine.stopRecording() : engine.startRecording()) });
const recTime = h('span', { class: 'fx-rec-time' });
const exitBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => app.ui.setWorkspace('edit') }, h('span', { class: 'ic-wrap', html: icon('x', 14) }), 'Выйти');
const BGS = [['', 'Как в редакторе'], ['#0b0d11', 'Чёрный'], ['#14161b', 'Графит'], ['#0d1b2a', 'Ночь'], ['#1a0f2e', 'Сумерки'], ['#2a1208', 'Янтарь'], ['#0f2a1f', 'Хвоя'], ['#e8ebef', 'Светлый'], ['#ffffff', 'Белый']];
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
if (!bgPop.hidden && !bgPop.contains(e.target) && !bgBtn.contains(e.target)) {
bgPop.hidden = true;
bgBtn.setAttribute('aria-expanded', 'false');
}
});
syncBg();
const leftBtn = iconButton({ icon: 'stack', title: 'Список эффектов', cls: 'fx-left-btn', onClick: () => document.getElementById('fxLeft').classList.toggle('fx-left-open') });
bar.append(leftBtn, playBtn, collapseBtn, brushBtn, camBtn, trackName, barMeters.el, h('span', { class: 'fx-bar-sep' }), orthoBtn, bgBtn, recBtn, recTime, exitBtn);
function sync() {
tileMap.forEach((b, k) => {
b.setAttribute('aria-checked', String(k === st.source));
if (k === 'model') b.disabled = !engine.hasModel;
});
const n = engine.geometry ? engine.geometry.attributes.position.count : st.count;
countHint.textContent = `Сейчас ${formatInt(n)} частиц, около ${Math.round((n * 128) / 1048576)} МБ памяти. Комфортно до ${formatCount(getDevice(app).limits.comfort)}.`;
const kind = engine.modelProvider ? engine.modelProvider.kind() : 'none';
modelNote.textContent = kind === 'cloud' ? `Берётся облако точек из редактора (${formatInt(engine.modelProvider.total())} точек). Больше этого частиц не будет.` : kind === 'mesh' ? 'Берутся точки с поверхности вашей модели.' : 'Модели в сцене нет: показана готовая форма. Добавьте модель, и она заменит её.';
countActive();
cards.forEach((c) => {
c.card.classList.toggle('is-on', c.L.on);
c.sw.set(c.L.on);
c.amount.set(c.L.amount);
c.react.set(c.L.react);
c.band.set(c.L.band);
c.reactRow.hidden = c.L.band === 'none';
for (const [k, ctl] of Object.entries(c.extraCtl)) ctl.set(c.L[k]);
});
palBtns.forEach((b, k) => b.setAttribute('aria-checked', String(k === st.look.palette)));
colorBy.set(st.look.colorBy);
size.set(st.look.size);
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
rotate.set(st.look.autoRotate);
rotSpeed.set(st.look.rotSpeed);
maskMode.set(mk.mode);
maskSize.set(mk.size);
maskSoft.set(mk.soft);
maskSpeed.set(mk.speed);
maskInvert.set(mk.invert);
maskShow.set(mk.show);
syncMask();
sourceSeg.set(engine.sourceType);
styleRow.hidden = engine.sourceType !== 'synth';
style.set(st.audio.style);
count.set(Math.min(st.count, cap()));
const label = engine.trackLabel;
trackName.innerHTML = '';
trackName.append(h('b', {}, label), h('span', {}, engine.playing ? 'играет' : 'пауза'));
playBtn.textContent = '';
playBtn.append(h('span', { class: 'ic-wrap', html: icon(engine.playing ? 'pause' : 'play', 18) }));
collapseBtn.classList.toggle('is-active', engine.isCollapsed);
brushBtn.classList.toggle('is-active', !!st.layers.brush?.on);
camBtn.classList.toggle('is-active', !!engine.camTracker?.running);
orthoBtn.classList.toggle('is-active', !!app.nav.ortho);
orthoBtn.dataset.tip = app.nav.ortho ? 'Сейчас: ортогональная проекция. Включить перспективу' : 'Сейчас: перспектива. Включить ортогональную проекцию';
recBtn.classList.toggle('is-rec', engine.recording);
recBtn.dataset.tip = engine.recording ? 'Остановить запись и сохранить' : 'Записать видео со звуком (WebM)';
recTime.textContent = '';
}
app.bus.on('fx', sync);
app.bus.on('device', () => {
count.setRange(20000, cap());
sync();
});
app.bus.on('scene', sync);
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
