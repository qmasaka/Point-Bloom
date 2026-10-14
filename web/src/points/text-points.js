import { h } from '../core/util.js';
import { section, field, slider, segmented, switchRow, button, colorField } from '../ui/ui-kit.js';
import { cloudToPoints } from './pointcloud.js';
import { icon } from '../ui/icons.js';
const LUT = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hexToLin = (hx) => {
const n = parseInt(hx.slice(1), 16);
return [LUT(((n >> 16) & 255) / 255), LUT(((n >> 8) & 255) / 255), LUT((n & 255) / 255)];
};
function hsl(hh, s, l) {
const a = s * Math.min(l, 1 - l);
const f = (n) => {
const k = (n + hh / 30) % 12;
return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
};
return [LUT(f(0)), LUT(f(8)), LUT(f(4))];
}
const BASE_FONTS = ['Geist', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Impact', 'system-ui', 'serif', 'sans-serif', 'monospace', 'cursive'];
export async function buildTextCloud(opts) {
const { text, family, weight = 700, italic = false, count = 40000, depth = 0.15, fill = 'fill', color = '#ffffff' } = opts;
const lines = (text || ' ').split('\n');
const SIZE = 220;
const font = `${italic ? 'italic ' : ''}${weight} ${SIZE}px "${family}", system-ui, sans-serif`;
try {
await document.fonts.load(font, text);
} catch (e) {
}
const meas = document.createElement('canvas').getContext('2d');
meas.font = font;
const lh = SIZE * 1.15;
const widths = lines.map((l) => meas.measureText(l || ' ').width);
const pad = 16;
const W = Math.min(4096, Math.ceil(Math.max(...widths)) + pad * 2);
const H = Math.min(4096, Math.ceil(lines.length * lh) + pad * 2);
const cv = document.createElement('canvas');
cv.width = W;
cv.height = H;
const c = cv.getContext('2d', { willReadFrequently: true });
c.font = font;
c.textBaseline = 'middle';
c.textAlign = 'center';
c.fillStyle = '#fff';
lines.forEach((l, i) => c.fillText(l, W / 2, pad + lh * (i + 0.5)));
const data = c.getImageData(0, 0, W, H).data;
const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3] > 127;
const cand = [];
for (let y = 0; y < H; y++) {
for (let x = 0; x < W; x++) {
if (!on(x, y)) continue;
if (fill === 'outline' && on(x - 2, y) && on(x + 2, y) && on(x, y - 2) && on(x, y + 2)) continue;
cand.push(y * W + x);
}
}
if (!cand.length) return null;
const scale = 2.2 / Math.max(W, H);
const n = count;
const positions = new Float32Array(n * 3);
const normals = new Float32Array(n * 3);
const colors = new Float32Array(n * 3);
const base = color.startsWith('#') ? hexToLin(color) : null;
for (let i = 0; i < n; i++) {
const p = cand[(Math.random() * cand.length) | 0];
const px = (p % W) + Math.random();
const py = ((p / W) | 0) + Math.random();
const x = (px - W / 2) * scale;
const y = -(py - H / 2) * scale;
positions[i * 3] = x;
positions[i * 3 + 1] = y;
positions[i * 3 + 2] = (Math.random() - 0.5) * depth;
normals[i * 3 + 2] = 1;
let rgb = base;
if (!rgb) rgb = color === 'rainbow' ? hsl(((x / (W * scale)) + 0.5) * 300, 0.85, 0.6) : hsl(30 + (y / (H * scale) + 0.5) * 200, 0.8, 0.62);
colors[i * 3] = rgb[0];
colors[i * 3 + 1] = rgb[1];
colors[i * 3 + 2] = rgb[2];
}
return { positions, normals, colors, count: n };
}
export function createTextSection(app) {
const cfg = (app.settings.text ||= { text: 'Привет', family: 'Geist', weight: 700, italic: false, count: 40000, depth: 0.15, fill: 'fill', color: '#ffffff', colorMode: 'solid' });
const save = () => app.saveSettings();
let current = null;
let timer = null;
const input = h('textarea', { class: 'text-in', rows: 2, spellcheck: 'false', placeholder: 'Введите текст', 'aria-label': 'Текст' });
input.value = cfg.text;
let fontNames = [...BASE_FONTS];
let localTried = false;
const fontHint = h('div', { class: 'field-hint' });
const fontIn = h('input', { type: 'text', class: 'num-in font-in', value: cfg.family, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Шрифт', placeholder: 'Начните вводить название' });
const caret = h('span', { class: 'font-caret', html: icon('caret-down', 14) });
const fontBox = h('div', { class: 'font-pick' }, fontIn, caret);
let menu = null;
const loadLocal = async () => {
if (localTried) return;
localTried = true;
if (!window.queryLocalFonts) {
fontHint.textContent = 'Этот браузер не показывает список шрифтов компьютера (нужен Chrome или Edge). Название шрифта можно вписать вручную.';
return;
}
try {
const fonts = await window.queryLocalFonts();
const names = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
fontNames = [...new Set([...BASE_FONTS, ...names])];
fontHint.textContent = `Шрифтов с компьютера: ${names.length}`;
if (menu) fillMenu();
} catch (e) {
localTried = false;
fontHint.textContent = 'Нет доступа к шрифтам компьютера. Разрешите его в браузере или впишите название вручную.';
}
};
const pick = (name) => {
fontIn.value = name;
cfg.family = name;
closeMenu();
changed();
};
function fillMenu() {
if (!menu) return;
const q = fontIn.dataset.q ? fontIn.value.trim().toLowerCase() : '';
menu.textContent = '';
const list = fontNames.filter((n) => !q || n.toLowerCase().includes(q));
if (!list.length) menu.append(h('div', { class: 'font-empty' }, 'Такого шрифта нет в списке. Enter применит введённое название.'));
for (const n of list) {
const it = h('button', { type: 'button', class: 'font-item', style: { fontFamily: `"${n}", system-ui, sans-serif` } }, n);
if (n === cfg.family) it.classList.add('is-active');
it.addEventListener('mousedown', (e) => e.preventDefault());
it.addEventListener('click', () => pick(n));
menu.append(it);
}
const cur = menu.querySelector('.is-active');
if (cur && !q) cur.scrollIntoView({ block: 'center' });
}
function placeMenu() {
const z = parseFloat(document.documentElement.style.zoom) || 1;
const r = fontBox.getBoundingClientRect();
menu.style.width = r.width / z + 'px';
menu.style.left = r.left / z + 'px';
const below = window.innerHeight / z - r.bottom / z - 12;
const above = r.top / z - 12;
if (below < 180 && above > below) {
menu.style.top = 'auto';
menu.style.bottom = window.innerHeight / z - r.top / z + 4 + 'px';
menu.style.maxHeight = Math.min(320, above) + 'px';
} else {
menu.style.bottom = 'auto';
menu.style.top = r.bottom / z + 4 + 'px';
menu.style.maxHeight = Math.min(320, below) + 'px';
}
}
function openMenu() {
if (menu) return;
menu = h('div', { class: 'font-menu', role: 'listbox', 'aria-label': 'Шрифты' });
document.body.append(menu);
fontIn.dataset.q = '';
fillMenu();
placeMenu();
fontBox.classList.add('is-open');
loadLocal();
document.addEventListener('pointerdown', outside, true);
}
function closeMenu() {
if (!menu) return;
menu.remove();
menu = null;
fontBox.classList.remove('is-open');
fontIn.dataset.q = '';
document.removeEventListener('pointerdown', outside, true);
}
const outside = (e) => {
if (menu && !menu.contains(e.target) && !fontBox.contains(e.target)) closeMenu();
};
fontIn.addEventListener('focus', openMenu);
fontIn.addEventListener('click', openMenu);
caret.addEventListener('click', () => (menu ? closeMenu() : (fontIn.focus(), openMenu())));
fontIn.addEventListener('input', () => {
openMenu();
fontIn.dataset.q = '1';
fillMenu();
});
fontIn.addEventListener('keydown', (e) => {
if (e.key === 'Enter') {
const v = fontIn.value.trim();
const first = menu && fontIn.dataset.q ? menu.querySelector('.font-item') : null;
pick(first && !fontNames.includes(v) ? first.textContent : v || 'Geist');
fontIn.blur();
} else if (e.key === 'Escape') {
fontIn.value = cfg.family;
closeMenu();
fontIn.blur();
}
});
fontIn.addEventListener('blur', () => setTimeout(() => !menu || document.activeElement === fontIn || closeMenu(), 120));
const weight = segmented({ options: [{ value: 400, label: 'Обычный' }, { value: 700, label: 'Жирный' }, { value: 900, label: 'Чёрный' }], value: cfg.weight, onChange: (v) => { cfg.weight = Number(v); changed(); } });
const italic = switchRow('Курсив', { value: cfg.italic, onChange: (v) => { cfg.italic = v; changed(); } });
const fillSeg = segmented({ options: [{ value: 'fill', label: 'Заливка' }, { value: 'outline', label: 'Контур' }], value: cfg.fill, onChange: (v) => { cfg.fill = v; changed(); } });
const count = slider({ log: true, min: 5000, max: 200000, step: 1000, value: cfg.count, format: (v) => v.toLocaleString('ru-RU').replace(/ /g, ' '), onInput: (v) => { cfg.count = v; }, onChange: () => changed() });
const depth = slider({ min: 0, max: 1, step: 0.01, value: cfg.depth, digits: 2, onInput: (v) => { cfg.depth = v; }, onChange: () => changed() });
const colorMode = segmented({ cls: 'seg-tight', options: [{ value: 'solid', label: 'Цвет' }, { value: 'rainbow', label: 'Радуга' }, { value: 'height', label: 'Градиент' }], value: cfg.colorMode, onChange: (v) => { cfg.colorMode = v; colorRow.hidden = v !== 'solid'; changed(); } });
const colorPick = colorField({ value: cfg.color, onInput: (v) => { cfg.color = v; }, onChange: () => changed() });
const colorRow = field('Свой цвет', colorPick.el);
colorRow.hidden = cfg.colorMode !== 'solid';
const status = h('div', { class: 'field-hint' });
async function generate(asNew) {
cfg.text = input.value;
cfg.family = fontIn.value.trim() || 'Geist';
if (!cfg.text.trim()) return;
const cloud = await buildTextCloud({ ...cfg, color: cfg.colorMode === 'solid' ? cfg.color : cfg.colorMode });
if (!cloud) {
status.textContent = 'У этого шрифта нет таких символов.';
return;
}
const name = 'Текст: ' + cfg.text.replace(/\s+/g, ' ').slice(0, 24);
const pts = cloudToPoints(cloud, name);
pts.userData.text = true;
app.media?._muteFx?.();
if (current && current.parent && !asNew) {
const old = current.geometry;
current.geometry = pts.geometry;
old.dispose();
current.name = name;
app.model.changed();
app.bus.emit('selection');
} else {
app.model.add(pts, app.viewport.root);
current = pts;
}
app.model.select(current);
if (app.settings.display !== 'points') app.setDisplay('points');
status.textContent = `Точек: ${cloud.count.toLocaleString('ru-RU')}. Любое изменение настроек обновляет текст.`;
save();
}
function changed() {
save();
if (!current || !current.parent) return;
clearTimeout(timer);
timer = setTimeout(() => generate(false), 250);
}
input.addEventListener('input', () => {
cfg.text = input.value;
changed();
});
const add = button({ label: 'Создать текст из точек', icon: 'text-aa', variant: 'primary', cls: 'btn-block', onClick: () => generate(true) });
app.bus.on('selection', () => {
const s = app.model.selected;
if (s && s.userData.text) current = s;
});
const sec = section('Текст в точки', { key: 'p-text', open: false }, input, field('Шрифт', fontBox, { wide: true }), fontHint, field('Начертание', weight.el, { wide: true }), italic.el, field('Вид', fillSeg.el, { wide: true }), field('Точек', count.el), field('Толщина', depth.el), field('Цвет', colorMode.el, { wide: true }), colorRow, add, status);
return sec;
}
