import * as THREE from 'three';
import { h, fmt, formatInt, deg } from '../../core/util.js';
import { icon } from '../icons.js';
import { section, field, numberField, fxSlider as slider, button, iconButton, empty, switchRow } from '../ui-kit.js';
import { triangleCount } from '../../core/geom.js';
import { applySplat } from '../../points/splat-tools.js';
const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));
export function createScenePanel(app, root) {
const model = app.model;
const ops = app.ops;
const expanded = new WeakMap();
const tree = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Объекты сцены' });
const treeCount = h('div', { class: 'field-hint' });
const addBtn = iconButton({ icon: 'plus', title: 'Добавить модель в сцену', onClick: () => app.ui.openFiles('add') });
const showAll = iconButton({
icon: 'eye',
title: 'Показать все скрытые объекты',
onClick: () => {
let n = 0;
model.root.traverse((o) => {
if (!o.userData.helper && o !== model.root && !o.visible) {
o.visible = true;
n++;
}
});
if (n) model.changed({ display: false });
app.toast(n ? `Показано объектов: ${n}` : 'Скрытых объектов нет', 'info');
},
});
const clearBtn = iconButton({
icon: 'broom',
title: 'Очистить сцену',
onClick: async () => {
if (!model.renderables().length) return;
const ok = await app.ui.choose({
title: 'Очистить сцену?',
text: 'Все объекты и история изменений будут удалены. Отменить это действие нельзя.',
buttons: [
{ label: 'Отмена', value: null },
{ label: 'Очистить', value: true, variant: 'primary', icon: 'broom' },
],
});
if (ok) {
model.clear();
app.toast('Сцена очищена', 'info', 1800);
}
},
});
const secObjects = section('Объекты', { actions: [clearBtn, showAll, addBtn], key: 'objects' }, tree, treeCount);
function renderTree() {
tree.textContent = '';
const top = model.root.children.filter((c) => !c.userData.helper);
if (!top.length) {
tree.append(empty('Сцена пуста', 'Откройте модель, чтобы увидеть её части'));
treeCount.textContent = '';
return;
}
const walk = (obj, depth) => {
const kids = obj.children.filter((c) => !c.userData.helper && (c.isMesh || c.isPoints || c.isGroup || c.type === 'Object3D' || c.children.length));
const isMesh = obj.isMesh || obj.isPoints;
const hasKids = kids.length > 0 && !(isMesh && !kids.some((k) => k.isMesh || k.isPoints));
let open = expanded.get(obj);
if (open === undefined) open = depth < 1 && kids.length <= 40;
const selected = model.selection.includes(obj);
const toggle = h('button', { type: 'button', class: 'tree-toggle', 'aria-expanded': String(open), tabindex: '-1', 'aria-label': open ? 'Свернуть' : 'Развернуть', style: { visibility: hasKids ? 'visible' : 'hidden', marginLeft: depth * 14 + 'px' }, html: icon('caret-right', 13) });
toggle.addEventListener('click', (e) => {
e.stopPropagation();
expanded.set(obj, !open);
renderTree();
});
const iconName = obj.isPoints ? 'dots-nine' : obj.isMesh ? 'cube' : 'stack';
const nameEl = h('span', { class: 'tree-name' }, obj.name || (obj.isMesh ? 'Меш' : obj.isPoints ? 'Точки' : 'Группа'));
const meta = obj.isMesh ? h('span', { class: 'tree-meta' }, compact(triangleCount(obj.geometry))) : obj.isPoints ? h('span', { class: 'tree-meta' }, compact(obj.geometry.attributes.position.count)) : null;
const eye = iconButton({
icon: obj.visible ? 'eye' : 'eye-slash',
title: obj.visible ? 'Скрыть' : 'Показать',
size: 16,
onClick: (e) => {
e.stopPropagation();
ops.setVisible(obj, !obj.visible);
},
});
const del = iconButton({
icon: 'trash',
title: 'Удалить из сцены',
size: 15,
cls: 'tree-del',
onClick: (e) => {
e.stopPropagation();
model.select(obj);
ops.deleteSelected();
},
});
const row = h(
'div',
{ class: 'tree-row' + (selected ? ' is-selected' : '') + (!obj.visible ? ' is-hidden' : ''), role: 'treeitem', 'aria-selected': String(selected), 'aria-expanded': hasKids ? String(open) : undefined },
toggle,
h('span', { class: 'tree-icon', html: icon(iconName, 16) }),
h('span', { style: { display: 'flex', alignItems: 'baseline', minWidth: 0 } }, nameEl, meta),
h('div', { class: 'tree-actions' }, del, eye)
);
row.addEventListener('click', (e) => model.select(obj, { add: e.shiftKey }));
row.addEventListener('dblclick', (e) => {
e.preventDefault();
const input = h('input', { class: 'tree-name-input', value: obj.name || '', 'aria-label': 'Имя объекта' });
nameEl.replaceWith(input);
input.focus();
input.select();
let done = false;
const finish = (ok) => {
if (done) return;
done = true;
if (ok && input.value.trim()) ops.rename(obj, input.value.trim());
else renderTree();
};
input.addEventListener('keydown', (ev) => {
ev.stopPropagation();
if (ev.key === 'Enter') finish(true);
if (ev.key === 'Escape') finish(false);
});
input.addEventListener('blur', () => finish(true));
input.addEventListener('click', (ev) => ev.stopPropagation());
});
tree.append(row);
if (hasKids && open) for (const k of kids) walk(k, depth + 1);
};
for (const o of top) walk(o, 0);
const st = model.stats(false);
treeCount.textContent = `Объектов: ${formatInt(st.objects)}`;
const sel = tree.querySelector('.is-selected');
if (sel) sel.scrollIntoView({ block: 'nearest' });
}
const nameInput = h('input', { type: 'text', class: 'num-in', style: { textAlign: 'left', fontFamily: 'var(--font)', fontSize: '13px', height: '32px' }, 'aria-label': 'Имя объекта', spellcheck: 'false' });
nameInput.addEventListener('change', () => {
const o = model.selected;
if (o && nameInput.value.trim()) ops.rename(o, nameInput.value.trim());
});
nameInput.addEventListener('keydown', (e) => {
e.stopPropagation();
if (e.key === 'Enter') nameInput.blur();
});
const PERM = [2, 0, 1];
const tf = { p: [], r: [], s: [] };
const fromFields = (arr) => {
const out = [0, 0, 0];
arr.forEach((f, i) => (out[PERM[i]] = parseFloat(f.input.value) || 0));
return out;
};
const apply = () => {
const o = model.selected;
if (!o) return;
ops.setTransform(o, { position: fromFields(tf.p), rotation: fromFields(tf.r), scale: fromFields(tf.s) });
};
const mk = (arr, axis, step, cls, digits, min) => {
const f = numberField({ value: 0, step, axis, digits, cls, min, onChange: () => apply() });
arr.push(f);
return f.el;
};
const xform = h(
'div',
{ class: 'xform' },
h('div', { class: 'xform-row' }, h('span', {}, 'Положение'), mk(tf.p, 'X', 0.1, 'ax-x', 5), mk(tf.p, 'Y', 0.1, 'ax-y', 5), mk(tf.p, 'Z', 0.1, 'ax-z', 5)),
h('div', { class: 'xform-row' }, h('span', {}, 'Поворот °'), mk(tf.r, 'X', 1, 'ax-x', 3), mk(tf.r, 'Y', 1, 'ax-y', 3), mk(tf.r, 'Z', 1, 'ax-z', 3)),
h('div', { class: 'xform-row' }, h('span', {}, 'Масштаб'), mk(tf.s, 'X', 0.05, 'ax-x', 4, 1e-6), mk(tf.s, 'Y', 0.05, 'ax-y', 4, 1e-6), mk(tf.s, 'Z', 0.05, 'ax-z', 4, 1e-6))
);
const dims = h('div', { class: 'dims' }, h('span', {}, 'Размер'), h('b', { id: 'dimsVal' }, ''));
const noSel = empty('Ничего не выбрано', 'Кликните по модели в сцене или выберите её в списке');
const objBody = h('div', { class: 'sec-body', style: { padding: 0 } }, field('Имя', nameInput), xform, dims);
const secObject = section('Выбранный объект', { key: 'object' }, noSel, objBody);
function refreshObject() {
const o = model.selected;
noSel.hidden = !!o;
objBody.hidden = !o;
if (!o) return;
nameInput.value = o.name || '';
const pos = o.position.toArray();
const e = o.rotation;
const rot = [e.x, e.y, e.z];
const sc = o.scale.toArray();
for (let i = 0; i < 3; i++) {
tf.p[i].set(pos[PERM[i]]);
tf.r[i].set(deg(rot[PERM[i]]));
tf.s[i].set(sc[PERM[i]]);
}
const b = app.viewport.getBounds(o);
const s = b.getSize(new THREE.Vector3());
root.querySelector('#dimsVal').textContent = b.isEmpty() ? 'нет геометрии' : `${fmt(s.z, 3)} × ${fmt(s.x, 3)} × ${fmt(s.y, 3)}`;
}
const need = [];
const tbtn = (label, iconName, fn, title, variant = 'secondary') => {
const b = button({ label, icon: iconName, variant, onClick: fn, title, size: 16 });
need.push(b);
return b;
};
const smooth = { angle: 60 };
const angleSlider = slider({ noNorm: true, min: 5, max: 180, step: 1, value: 60, digits: 0, unit: '°', onInput: (v) => (smooth.angle = v) });
const simplify = { keep: 50 };
const simplifyHint = h('div', { class: 'field-hint' });
const updateSimplifyHint = () => {
const sel = model.selected;
const meshes = sel ? (sel.isMesh ? [sel] : model.meshesOf(sel)) : [];
const tris = meshes.reduce((n, m) => n + triangleCount(m.geometry), 0);
simplifyHint.textContent = tris ? `Граней: ${formatInt(tris)}, останется около ${formatInt(Math.round((tris * simplify.keep) / 100))}` : 'Выберите объект';
};
const simplifySlider = slider({ noNorm: true, min: 5, max: 95, step: 5, value: 50, digits: 0, unit: '%', onInput: (v) => { simplify.keep = v; updateSimplifyHint(); } });
const mirrorRow = h(
'div',
{ class: 'tool-grid', style: { gridTemplateColumns: 'repeat(3, minmax(0,1fr))' } },
tbtn('X', 'flip-horizontal', () => ops.mirror('x'), 'Отразить по оси X'),
tbtn('Y', 'flip-vertical', () => ops.mirror('y'), 'Отразить по оси Y'),
tbtn('Z', 'arrows-left-right', () => ops.mirror('z'), 'Отразить по оси Z')
);
const toolsBody = h(
'div',
{ class: 'sec-body', style: { padding: 0 } },
h(
'div',
{ class: 'tool-grid' },
tbtn('Ось в центр', 'crosshair-simple', () => ops.centerOrigin(), 'Перенести ось объекта в центр его геометрии'),
tbtn('На пол', 'align-bottom-simple', () => ops.toGround(), 'Опустить объект так, чтобы он стоял на плоскости Y = 0'),
tbtn('Применить масштаб', 'check', () => ops.applyTransform(), 'Запечь трансформацию в вершины, масштаб станет 1'),
tbtn('Склеить вершины', 'arrows-merge', () => ops.weld(), 'Объединить одинаковые вершины: меньше размер файла'),
tbtn('Вывернуть нормали', 'arrows-vertical', () => ops.flipNormals(), 'Вывернуть грани и нормали наизнанку'),
tbtn('Плоское затенение', 'square-half', () => ops.flat(), 'Пересчитать нормали по граням'),
tbtn('Перевернуть UV', 'repeat', () => ops.flipUV(), 'Отразить UV по вертикали (V → 1 − V)'),
tbtn('Дублировать', 'copy', () => ops.duplicateSelected(), 'Создать копию (Shift+D)')
)
);
const meshBody = h('div', { class: 'sec-body', style: { padding: 0 } },
field('Сглаживание', angleSlider.el, {}),
tbtn('Сгладить нормали', 'circle-half', () => ops.smooth(smooth.angle), 'Авто-сглаживание нормалей по углу', 'secondary'),
field('Оставить граней', simplifySlider.el),
simplifyHint,
tbtn('Упростить сетку', 'arrows-in-simple', () => ops.simplify(simplify.keep), 'Уменьшить число граней (децимация) с сохранением формы и UV', 'secondary'),
field('Отразить', mirrorRow)
);
for (const b of need.slice(-3)) b.classList.add('btn-block');
const splatInfo = h('div', { class: 'field-hint' });
const splatCount = slider({ noNorm: true, log: true, min: 2000, max: 1500000, step: 1000, value: 200000, format: (v) => formatInt(v), onInput: (v) => splatApply({ count: v }), onChange: () => {} });
const splatOp = slider({ min: 0, max: 0.9, step: 0.01, value: 0.05, onInput: (v) => splatApply({ minOp: v }) });
const splatDepth = slider({ min: 0.1, max: 4, step: 0.05, value: 1, onInput: (v) => splatApply({ depth: v }) });
const splatBody = h('div', { class: 'sec-body', style: { padding: 0 } }, splatInfo, field('Сколько точек оставить', splatCount.el), field('Отсечь прозрачные', splatOp.el, { hint: 'Убирает почти невидимые сплаты и «пыль» вокруг объекта' }), field('Глубина', splatDepth.el, { hint: '1 это как посчитала нейросеть, больше растягивает сцену вглубь' }));
const secSplat = section('Сплаты', { key: 'splat' }, splatBody);
let splatTimer = 0;
function splatObj() {
const o = model.selected;
return o && o.isPoints && o.userData.splat ? o : null;
}
function splatApply(patch) {
const o = splatObj();
if (!o) return;
Object.assign(o.userData.splat.cfg, patch);
clearTimeout(splatTimer);
splatTimer = setTimeout(() => {
applySplat(o);
app.viewport.updateSceneBounds();
app.viewport.invalidate();
app.bus.emit('scene');
const S = o.userData.splat;
splatInfo.textContent = `В файле ${formatInt(S.total)} сплатов, сейчас точек: ${formatInt(S.shown || 0)}`;
}, 60);
}
function refreshSplat() {
const o = splatObj();
secSplat.el.hidden = !o;
if (!o) return;
const S = o.userData.splat;
const total = S.src.pos.length / 3;
splatCount.setRange && splatCount.setRange(2000, total);
splatCount.set(S.cfg.count);
splatOp.set(S.cfg.minOp);
splatDepth.set(S.cfg.depth);
splatInfo.textContent = `В файле ${formatInt(S.total)} сплатов, сейчас точек: ${formatInt(S.shown || 0)}`;
}
const secTools = section('Правка', { key: 'tools' }, toolsBody);
const secMesh = section('Сетка и нормали', { key: 'mesh', open: false }, meshBody);
root.append(secObjects.el, secObject.el, secSplat.el, secTools.el, secMesh.el);
const MESH_ONLY = ['Склеить вершины', 'Вывернуть нормали', 'Плоское затенение', 'Перевернуть UV'];
const syncEnabled = () => {
const sel = model.selected;
const has = !!sel;
for (const b of need) b.disabled = !has;
const hasMesh = !!sel && (sel.isMesh || model.meshesOf(sel).length > 0);
for (const b of need) {
const label = b.querySelector('.btn-label')?.textContent;
if (MESH_ONLY.includes(label)) b.hidden = has && !hasMesh;
}
secMesh.el.hidden = has && !hasMesh;
};
const refreshAll = () => {
renderTree();
refreshObject();
syncEnabled();
refreshSplat();
updateSimplifyHint();
};
app.bus.on('scene', () => {
renderTree();
refreshObject();
updateSimplifyHint();
});
app.bus.on('selection', refreshAll);
app.bus.on('transform', refreshObject);
app.bus.on('history', refreshObject);
refreshAll();
return { refresh: refreshAll };
}
