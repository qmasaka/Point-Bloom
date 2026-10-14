import * as THREE from 'three';
import { h, formatBytes } from './util.js';
import { icon } from './icons.js';
import { section, field, select, fxSlider as slider, segmented, colorField, numberField, switchRow, iconButton, empty } from './ui-kit.js';
import { SLOTS, thumbnail, drawUVLayout, getAlphaMode, setAlphaMode, slotByKey } from './materials.js';
import { assignTextureFiles, IMAGE_EXT } from './importers.js';
import { extOf } from './util.js';
export function createMaterialPanel(app, root) {
const model = app.model;
const st = { slot: 'map' };
const mat = () => model.activeMaterial;
const touch = () => {
const m = mat();
if (m) m.needsUpdate = true;
app.viewport.invalidate();
};
const commit = () => {
touch();
app.display.apply();
app.bus.emit('geometry');
};
const matSelect = select({ options: [{ value: '', label: '' }], value: '', onChange: (v) => model.setActiveMaterial(model.materials()[parseInt(v, 10)]) });
const usage = h('div', { class: 'field-hint' });
const secPick = section('Материал', { key: 'mat-pick' }, matSelect.el, usage);
const slotsBox = h('div', { class: 'sec-body', style: { padding: 0 } });
const slotRefs = new Map();
const pickFor = (slotKey) => {
const input = h('input', { type: 'file', accept: 'image/*,.tga', hidden: true });
input.addEventListener('change', async () => {
const f = input.files && input.files[0];
input.remove();
if (f) await assignTextureFiles(app, [f], mat(), { forceSlot: slotKey });
});
document.body.append(input);
input.click();
};
for (const s of SLOTS) {
const thumb = h('button', { type: 'button', class: 'slot-thumb', 'aria-label': 'Загрузить текстуру: ' + s.short, onclick: (e) => {
e.stopPropagation();
pickFor(s.key);
} });
const mainLabel = s.label.replace(/\s*\(.*\)$/, '');
const techLabel = (s.label.match(/\((.*)\)/) || [])[1] || '';
const nameEl = h('div', { class: 'slot-name' }, mainLabel);
const fileEl = h('div', { class: 'slot-file' });
const clear = iconButton({
icon: 'x',
title: 'Убрать текстуру',
size: 15,
onClick: (e) => {
e.stopPropagation();
const m = mat();
if (!m || !m[s.key]) return;
const old = m[s.key];
m[s.key] = null;
m.needsUpdate = true;
app.history.push(
{
label: 'Убрать текстуру',
redo: () => {
m[s.key] = null;
m.needsUpdate = true;
app.afterMaterialChange();
},
undo: () => {
m[s.key] = old;
m.needsUpdate = true;
app.afterMaterialChange();
},
},
false
);
app.afterMaterialChange();
},
});
const el = h('div', { class: 'slot', dataset: { slot: s.key } }, thumb, h('div', { class: 'slot-info' }, nameEl, fileEl), h('div', { class: 'slot-actions' }, clear));
el.addEventListener('click', () => {
st.slot = s.key;
refresh();
});
el.addEventListener('dragover', (e) => {
if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
e.preventDefault();
e.stopPropagation();
el.classList.add('is-over');
});
el.addEventListener('dragleave', () => el.classList.remove('is-over'));
el.addEventListener('drop', async (e) => {
e.preventDefault();
e.stopPropagation();
el.classList.remove('is-over');
const files = [...e.dataTransfer.files].filter((f) => IMAGE_EXT.includes(extOf(f.name)));
if (files[0]) await assignTextureFiles(app, [files[0]], mat(), { forceSlot: s.key });
app.ui.hideDrop();
});
slotRefs.set(s.key, { el, thumb, fileEl, clear });
slotsBox.append(el);
}
const slotsHint = h('div', { class: 'field-hint' }, 'Перетащите картинку на нужную карту. Файлы с именами вроде wood_normal.png и wood_roughness.png распознаются автоматически.');
const secSlots = section('Текстуры', { key: 'mat-slots' }, slotsBox, slotsHint);
const repU = numberField({ value: 1, step: 0.1, axis: 'U', min: 0.0001, digits: 4, onChange: () => applyTexParams() });
const repV = numberField({ value: 1, step: 0.1, axis: 'V', min: 0.0001, digits: 4, onChange: () => applyTexParams() });
const offU = numberField({ value: 0, step: 0.01, axis: 'U', digits: 4, onChange: () => applyTexParams() });
const offV = numberField({ value: 0, step: 0.01, axis: 'V', digits: 4, onChange: () => applyTexParams() });
const flipV = switchRow('Перевернуть по вертикали', { onChange: (v) => {
const t = slotTex();
if (!t) return;
t.flipY = !t.flipY;
t.userData.vFlipped = v;
t.needsUpdate = true;
commit();
} }, 'Включите, если рисунок лёг вверх ногами');
const dxNormal = switchRow('Нормали в стиле DirectX', { onChange: (v) => {
const m = mat();
if (!m) return;
m.normalScale.y = Math.abs(m.normalScale.y) * (v ? -1 : 1);
commit();
} }, 'Инвертирует зелёный канал при экспорте');
const texTitle = h('div', { class: 'field-hint', style: { fontWeight: 600, color: 'var(--text)' } });
const texInfo = h('div', { class: 'field-hint' });
const texSettings = h('div', { class: 'sec-body', style: { padding: 0 } }, texTitle, field('Повтор', h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } }, repU.el, repV.el)), field('Смещение', h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } }, offU.el, offV.el)), flipV.el, dxNormal.el, texInfo);
const secTex = section('Параметры текстуры', { key: 'mat-tex' }, texSettings);
const slotTex = () => (mat() ? mat()[st.slot] : null);
function applyTexParams() {
const t = slotTex();
if (!t) return;
t.repeat.set(parseFloat(repU.input.value) || 1, parseFloat(repV.input.value) || 1);
t.offset.set(parseFloat(offU.input.value) || 0, parseFloat(offV.input.value) || 0);
t.matrixAutoUpdate = true;
commit();
}
const color = colorField({ value: '#ffffff', onInput: (v) => { const m = mat(); if (m) { m.color.set(v); touch(); } }, onChange: commit });
const rough = slider({ value: 0.8, onInput: (v) => { const m = mat(); if (m) { m.roughness = v; touch(); } } });
const metal = slider({ value: 0, onInput: (v) => { const m = mat(); if (m) { m.metalness = v; touch(); } } });
const emissive = colorField({ value: '#000000', onInput: (v) => { const m = mat(); if (m) { m.emissive.set(v); touch(); } }, onChange: commit });
const emissiveI = slider({ min: 0, max: 5, step: 0.05, value: 1, onInput: (v) => { const m = mat(); if (m) { m.emissiveIntensity = v; touch(); } } });
const alphaMode = segmented({ options: [{ value: 'opaque', label: 'Нет' }, { value: 'mask', label: 'Вырез' }, { value: 'blend', label: 'Плавная' }], value: 'opaque', onChange: (v) => {
const m = mat();
if (!m) return;
const op = m.opacity;
setAlphaMode(m, v, 0.5);
if (v === 'blend' && op >= 1) m.opacity = 0.7;
commit();
refresh();
} });
const opacity = slider({ value: 1, onInput: (v) => { const m = mat(); if (m) { m.opacity = v; touch(); } }, onChange: refreshSoft });
const cutoff = slider({ value: 0.5, onInput: (v) => { const m = mat(); if (m) { m.alphaTest = Math.max(v, 0.001); touch(); } } });
const normalStr = slider({ min: 0, max: 3, step: 0.05, value: 1, onInput: (v) => { const m = mat(); if (m) { const s = m.normalScale.y < 0 ? -1 : 1; m.normalScale.set(v, v * s); touch(); } } });
const aoStr = slider({ min: 0, max: 2, step: 0.05, value: 1, onInput: (v) => { const m = mat(); if (m) { m.aoMapIntensity = v; touch(); } } });
const doubleSide = switchRow('Двусторонний', { onChange: (v) => { const m = mat(); if (m) { m.side = v ? THREE.DoubleSide : THREE.FrontSide; commit(); } } }, 'Рисовать и обратную сторону граней');
const rowOpacity = field('Непрозрачность', opacity.el);
const rowCutoff = field('Порог выреза', cutoff.el);
const rowNormal = field('Сила нормалей', normalStr.el);
const rowAO = field('Сила AO', aoStr.el);
const rowRough = field('Шероховатость', rough.el);
const rowMetal = field('Металличность', metal.el);
const secParams = section('Параметры', { key: 'mat-params' }, field('Базовый цвет', color.el), rowRough, rowMetal, field('Свечение', emissive.el), field('Сила свечения', emissiveI.el), field('Прозрачность', alphaMode.el), rowOpacity, rowCutoff, rowNormal, rowAO, doubleSide.el);
const uvCanvas = h('canvas', { class: 'uv-canvas', width: 560, height: 560, 'aria-label': 'Развёртка UV' });
const secUV = section('Развёртка UV', { key: 'mat-uv', open: false }, h('div', { class: 'uv-box' }, uvCanvas, h('div', { class: 'field-hint' }, 'Оранжевые линии показывают, как грани меша лежат на текстуре. Если развёртка выходит за рамку, текстура будет повторяться.')));
let uvTimer = null;
let uvDirty = true;
function scheduleUV() {
uvDirty = true;
if (root.hidden || secUV.el.classList.contains('is-closed')) return;
clearTimeout(uvTimer);
uvTimer = setTimeout(() => {
if (!uvDirty) return;
uvDirty = false;
drawUV();
}, 80);
}
secUV.el.querySelector('.sec-head').addEventListener('click', () => setTimeout(scheduleUV, 0));
function drawUV() {
const m = mat();
let mesh = null;
const sel = model.selected;
const cands = sel ? (sel.isMesh ? [sel] : model.meshesOf(sel)) : [];
mesh = cands.find((c) => [].concat(app.display.getOriginal(c)).includes(m)) || (m ? model.usersOf(m)[0] : null);
drawUVLayout(uvCanvas, mesh ? mesh.geometry : null, m);
}
const noMat = empty('Нет материалов', 'Откройте модель или перетащите её сюда');
const wrap = h('div', {}, secPick.el, secSlots.el, secTex.el, secParams.el, secUV.el);
root.append(noMat, wrap);
function refreshSoft() {
}
function refresh() {
const mats = model.materials();
noMat.hidden = mats.length > 0;
wrap.hidden = mats.length === 0;
if (!mats.length) return;
let m = mat();
if (!m || !mats.includes(m)) {
m = mats[0];
model.activeMaterial = m;
}
const idx = mats.indexOf(m);
matSelect.setOptions(
mats.map((x, i) => ({ value: i, label: x.name || 'Материал ' + (i + 1), sub: `Объектов: ${model.usersOf(x).length}` })),
idx
);
usage.textContent = `Используется у объектов: ${model.usersOf(m).length}. Изменения затронут все они.`;
for (const s of SLOTS) {
const r = slotRefs.get(s.key);
const t = m[s.key];
r.el.classList.toggle('is-selected', st.slot === s.key);
r.el.classList.toggle('is-empty', !t);
r.thumb.textContent = '';
if (t) {
const src = thumbnail(t, 96);
if (src) r.thumb.append(h('img', { src, alt: '' }));
r.fileEl.textContent = `${(t.userData && t.userData.fileName) || t.name || 'текстура'}${t.userData && t.userData.width ? '  ' + t.userData.width + '×' + t.userData.height : ''}`;
r.fileEl.classList.add('is-set');
} else {
r.thumb.innerHTML = icon('plus', 18);
r.fileEl.textContent = ((s.label.match(/\((.*)\)/) || [])[1] || '');
r.fileEl.classList.remove('is-set');
}
r.clear.style.visibility = t ? 'visible' : 'hidden';
}
const tex = m[st.slot];
secTex.el.hidden = !tex;
if (tex) {
const slot = slotByKey(st.slot);
texTitle.textContent = slot.label;
repU.set(tex.repeat.x);
repV.set(tex.repeat.y);
offU.set(tex.offset.x);
offV.set(tex.offset.y);
flipV.set(!!(tex.userData && tex.userData.vFlipped));
dxNormal.el.hidden = st.slot !== 'normalMap';
dxNormal.set(m.normalScale.y < 0);
const ud = tex.userData || {};
texInfo.textContent = ud.file && ud.file.size ? `Файл ${formatBytes(ud.file.size)}, ${ud.mime || ''}` : '';
}
color.set('#' + m.color.getHexString());
rough.set(m.roughness);
metal.set(m.metalness);
emissive.set('#' + m.emissive.getHexString());
emissiveI.set(m.emissiveIntensity);
const am = getAlphaMode(m);
alphaMode.set(am);
opacity.set(m.opacity);
cutoff.set(m.alphaTest || 0.5);
rowOpacity.hidden = am !== 'blend';
rowCutoff.hidden = am !== 'mask';
normalStr.set(Math.abs(m.normalScale.x));
aoStr.set(m.aoMapIntensity ?? 1);
rowNormal.hidden = !m.normalMap;
rowAO.hidden = !m.aoMap;
rowRough.querySelector('.field-label').textContent = m.roughnessMap ? 'Множитель шероховатости' : 'Шероховатость';
rowMetal.querySelector('.field-label').textContent = m.metalnessMap ? 'Множитель металла' : 'Металличность';
doubleSide.set(m.side === THREE.DoubleSide);
scheduleUV();
}
app.bus.on('scene', refresh);
app.bus.on('selection', refresh);
app.bus.on('material', refresh);
app.bus.on('history', refresh);
app.bus.on('geometry', scheduleUV);
refresh();
return { refresh };
}
