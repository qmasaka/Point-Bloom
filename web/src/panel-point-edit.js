import { h, formatInt } from './util.js';
import { icon } from './icons.js';
import { section, field, fxSlider as slider, segmented, switchRow, colorField, button, iconButton } from './ui-kit.js';
export function createPointEditSection(app) {
const pe = app.pointEdit;
let paintHex = '#ff7a2e';
let strength = 1;
const METHODS = [
['brush', 'Кисть', 'paint-brush', 'Закрашивайте точки кистью: всё под кругом выбирается (B)'],
['rect', 'Прямоугольник', 'selection', 'Протяните рамку: выберутся все точки внутри (M)'],
['lasso', 'Лассо', 'polygon', 'Обведите точки от руки: выберутся все внутри контура'],
];
const methodBtns = METHODS.map(([id, label, ic, tip]) => {
const b = h('button', { type: 'button', class: 'pe-method', 'data-method': id, 'data-tip': tip, 'aria-pressed': 'false' }, h('span', { class: 'ic-wrap', html: icon(ic, 18) }), h('span', {}, label));
b.addEventListener('click', () => pe.setTool(id));
return b;
});
const mode = segmented({
options: [
{ value: 'add', label: 'Добавлять', title: 'Выбирать точки' },
{ value: 'sub', label: 'Убирать', title: 'Снимать выбор с точек (то же с зажатым Ctrl)' },
],
value: pe.mode,
onChange: (v) => {
pe.mode = v;
},
});
const radius = slider({ noNorm: true, min: 4, max: 200, step: 1, value: pe.radius, format: (v) => v + ' px', onInput: (v) => (pe.radius = v) });
const rowRadius = field('Размер кисти', radius.el);
const through = switchRow('Сквозь модель', { value: pe.through, onChange: (v) => (pe.through = v) }, 'Выбирать и точки, которые закрыты другими: по умолчанию берутся только видимые');
const bAll = button({ label: 'Все', variant: 'secondary', cls: 'btn-sm', title: 'Выбрать все точки (Ctrl+A)', onClick: () => pe.selectAll() });
const bNone = button({ label: 'Снять', variant: 'secondary', cls: 'btn-sm', title: 'Снять выбор', onClick: () => pe.clear() });
const bInv = button({ label: 'Наоборот', variant: 'secondary', cls: 'btn-sm', title: 'Инвертировать выбор (Ctrl+I)', onClick: () => pe.invert() });
const count = h('div', { class: 'pe-count' });
const bDel = button({ label: 'Удалить выбранные', icon: 'trash', variant: 'secondary', cls: 'btn-block pe-del', title: 'Удалить выбранные точки (Delete или X)', onClick: () => pe.deleteSelected() });
const color = colorField({ value: paintHex, onInput: (v) => (paintHex = v), onChange: (v) => (paintHex = v) });
const str = slider({ noNorm: true, min: 5, max: 100, step: 5, value: 100, format: (v) => v + '%', onInput: (v) => (strength = v / 100) });
const bPaint = button({ label: 'Закрасить выбранные', icon: 'paint-bucket', variant: 'primary', cls: 'btn-block', title: 'Перекрасить выбранные точки в этот цвет', onClick: () => pe.paintSelected(paintHex, strength) });
const keys = h('div', { class: 'field-hint hint pe-keys' }, 'Alt + протяжка: вращать сцену. Колесо: приблизить. [ и ]: размер кисти. Esc: выйти.');
const close = iconButton({ icon: 'x', title: 'Готово (Esc)', cls: 'pe-close', size: 16, onClick: () => pe.setActive(false) });
const head = h('div', { class: 'pe-head' }, h('span', { class: 'pe-title' }, 'Правка точек'), close);
const note = h('div', { class: 'field-hint hint pe-note' });
const panel = h('div', { class: 'pe-panel', hidden: true, role: 'dialog', 'aria-label': 'Правка точек' },
head,
note,
h('div', { class: 'pe-label' }, 'Способ выделения'),
h('div', { class: 'pe-methods' }, ...methodBtns),
mode.el,
rowRadius,
through.el,
h('div', { class: 'pe-label' }, 'Выбранные точки'),
count,
h('div', { class: 'pe-row' }, bAll, bNone, bInv),
bDel,
h('div', { class: 'pe-label' }, 'Перекраска'),
field('Цвет', color.el),
field('Сила', str.el),
bPaint,
keys
);
(document.querySelector('.workspace') || document.body).append(panel);
function place() {
if (panel.hidden) return;
const ws = panel.parentElement.getBoundingClientRect();
const btn = document.querySelector('.btn-tool[data-tool="psel"]');
const side = document.getElementById('sidebar');
const w = side && side.offsetWidth ? side.offsetWidth : 300;
panel.style.width = w + 'px';
const br = btn.getBoundingClientRect();
let top = br.top - ws.top;
const maxH = ws.height - 24;
panel.style.maxHeight = maxH + 'px';
const hgt = Math.min(panel.offsetHeight, maxH);
top = Math.max(12, Math.min(top, ws.height - hgt - 12));
panel.style.left = br.right - ws.left + 12 + 'px';
panel.style.top = top + 'px';
}
window.addEventListener('resize', place);
const toggle = button({ label: 'Выделять точки', icon: 'selection', variant: 'primary', cls: 'btn-block pe-toggle', onClick: () => pe.setActive(!pe.active) });
const sideNote = h('div', { class: 'field-hint hint' });
const sec = section('Правка точек', { key: 'p-edit' }, sideNote, toggle);
function sync() {
const t = pe.target();
const n = t ? t.geometry.attributes.position.count : 0;
const text = !t ? 'Выберите облако точек в сцене. Если у вас сетка, сначала создайте из неё облако точек выше.' : `Облако: ${formatInt(n)} точек. Выделите нужные и удалите или перекрасьте их.`;
note.textContent = text;
sideNote.textContent = text;
toggle.disabled = !t && !pe.active;
toggle.querySelector('.btn-label').textContent = pe.active ? 'Готово' : 'Выделять точки';
toggle.classList.toggle('is-active', pe.active);
panel.hidden = !pe.active;
methodBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.method === pe.tool)));
mode.set(pe.mode);
rowRadius.hidden = pe.tool !== 'brush';
radius.set(pe.radius);
count.textContent = t ? `Выбрано: ${formatInt(pe.count)} из ${formatInt(n)}` : '';
const has = !!t && pe.count > 0;
bDel.disabled = !has;
bPaint.disabled = !has;
keys.hidden = !pe.active;
place();
}
app.bus.on('pointedit', sync);
app.bus.on('selection', sync);
app.bus.on('scene', sync);
app.bus.on('geometry', sync);
app.bus.on('tool', sync);
sync();
return sec;
}
