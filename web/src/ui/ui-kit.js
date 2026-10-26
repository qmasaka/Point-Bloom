import { h, clamp, fmt, screenRect } from '../core/util.js';
import { icon } from './icons.js';
const svg = (name, size = 16) => {
const t = document.createElement('span');
t.className = 'ic-wrap';
t.innerHTML = icon(name, size);
return t;
};
export function iconButton({ icon: name, title, onClick, size = 18, cls = '', pressed }) {
const b = h('button', { type: 'button', class: 'btn btn-icon ' + cls, 'aria-label': title, 'data-tip': title, onclick: onClick });
b.append(svg(name, size));
if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed));
return b;
}
export function button({ label, icon: name, variant = 'secondary', onClick, title, cls = '', size = 16 }) {
const b = h('button', { type: 'button', class: `btn btn-${variant} ${cls}`, 'data-tip': title, onclick: onClick });
if (name) b.append(svg(name, size));
if (label) b.append(h('span', { class: 'btn-label' }, label));
return b;
}
export function section(title, { actions = null, open = true, key } = {}, ...children) {
const body = h('div', { class: 'sec-body' }, ...children);
const head = h('button', { type: 'button', class: 'sec-head', 'aria-expanded': String(open) }, svg('caret-down', 14), h('span', { class: 'sec-title' }, title));
const el = h('section', { class: 'sec' + (open ? '' : ' is-closed'), dataset: { key: key || title } }, h('div', { class: 'sec-bar' }, head, actions ? h('div', { class: 'sec-actions' }, actions) : null), body);
head.addEventListener('click', () => {
const closed = el.classList.toggle('is-closed');
head.setAttribute('aria-expanded', String(!closed));
});
return { el, body };
}
export function field(label, control, { hint, wide = false } = {}) {
if (control && control.__capLabel) {
control.__capLabel(label);
return h('div', { class: 'field field-cap' }, h('div', { class: 'field-control' }, control), hint ? h('div', { class: 'field-hint' }, hint) : null);
}
return h('div',{ class: 'field' + (wide ? ' field-wide' : '') }, h('label', { class: 'field-label' }, label), h('div', { class: 'field-control' }, control), hint ? h('div', { class: 'field-hint' }, hint) : null);
}
export function toggle({ value = false, onChange, label }) {
const b = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!value), 'aria-label': label || 'Переключатель' }, h('span', { class: 'switch-knob' }));
let v = !!value;
b.addEventListener('click', () => {
v = !v;
b.setAttribute('aria-checked', String(v));
onChange && onChange(v);
});
return {
el: b,
set(x) {
v = !!x;
b.setAttribute('aria-checked', String(v));
},
};
}
export function switchRow(label, opts, hint) {
const t = toggle({ ...opts, label });
const row = h('div', { class: 'switch-row' }, h('div', { class: 'switch-text' }, h('span', { class: 'switch-label' }, label), hint ? h('span', { class: 'field-hint' }, hint) : null), t.el);
row.addEventListener('click', (e) => {
if (e.target.closest('.switch')) return;
t.el.click();
});
return { el: row, set: t.set };
}
export function segmented({ options, value, onChange, cls = '', label }) {
const el = h('div', { class: 'seg ' + cls, role: 'radiogroup', 'aria-label': label || '' });
const buttons = new Map();
let current = value;
for (const o of options) {
const b = h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': String(o.value === value), 'data-tip': o.title }, o.icon ? svg(o.icon, 16) : null, o.label ? h('span', { class: 'seg-label' }, o.label) : null);
b.addEventListener('click', () => {
if (current === o.value) return;
set(o.value);
onChange && onChange(o.value);
});
buttons.set(o.value, b);
el.append(b);
}
function set(v) {
current = v;
for (const [val, b] of buttons) b.setAttribute('aria-checked', String(val === v));
}
return { el, set };
}
let activeSelectClose = null;
export function select({ options = [], value, onChange, placeholder = 'Выбрать…' }) {
let currentVal = value !== undefined ? String(value) : '';
let currentOpts = [];
let open = false;
let pop = null;
let focusedIndex = -1;
const nativeSel = h('select', { class: 'custom-select-native', tabindex: '-1', 'aria-hidden': 'true' });
const parseOpt = (o) => {
if (typeof o === 'string' || typeof o === 'number') {
let str = String(o);
let val = str;
let lbl = str;
let sub = '';
if (str.includes(': ')) {
const parts = str.split(': ');
val = parts[0].trim();
lbl = parts[0].trim();
sub = parts.slice(1).join(': ').trim();
}
return { value: val, label: lbl, sub };
}
if (Array.isArray(o)) {
let val = String(o[0] ?? '');
let lbl = String(o[1] ?? val);
let sub = (typeof o[2] === 'string' || typeof o[2] === 'number') ? String(o[2]) : '';
if (!sub && lbl.includes(': ')) {
const parts = lbl.split(': ');
lbl = parts[0].trim();
sub = parts.slice(1).join(': ').trim();
}
return { value: val, label: lbl, sub };
}
const val = String(o?.value ?? o?.id ?? '');
let lbl = String(o?.label ?? o?.name ?? val);
let sub = typeof o?.sub === 'string' ? o.sub : typeof o?.desc === 'string' ? o.desc : typeof o?.hint === 'string' ? o.hint : '';
if (!sub && lbl.includes(': ')) {
const parts = lbl.split(': ');
lbl = parts[0].trim();
sub = parts.slice(1).join(': ').trim();
}
return { value: val, label: lbl, sub, icon: typeof o?.icon === 'string' ? o.icon : '' };
};
const fill = (opts) => {
currentOpts = (opts || []).map(parseOpt);
nativeSel.textContent = '';
for (const o of currentOpts) {
nativeSel.append(h('option', { value: o.value }, o.label + (o.sub ? ` (${o.sub})` : '')));
}
updateTrigger();
};
const tr = (k) => (window.__i18n && window.__i18n.tr ? window.__i18n.tr(k) : k);
const curLabel = h('span', { class: 'custom-select-cur-text' });
const curIcon = h('span', { class: 'custom-select-cur-ic', hidden: true });
const caret = svg('caret-down', 14);
caret.classList.add('custom-select-caret');
const trigger = h('button', {
type: 'button',
class: 'select custom-select-btn',
'aria-haspopup': 'listbox',
'aria-expanded': 'false',
}, curIcon, curLabel, caret);
const wrap = h('div', { class: 'select-wrap custom-select-wrap' }, trigger, nativeSel);
function updateTrigger() {
const found = currentOpts.find((o) => o.value === currentVal);
curIcon.textContent = '';
curIcon.hidden = !(found && found.icon);
if (found && found.icon) curIcon.append(svg(found.icon, 15));
if (found) {
curLabel.textContent = tr(found.label);
curLabel.classList.remove('is-empty');
trigger.title = tr(found.label) + (found.sub ? ` (${tr(found.sub)})` : '');
} else {
curLabel.textContent = tr(placeholder);
curLabel.classList.add('is-empty');
trigger.title = '';
}
nativeSel.value = currentVal;
}
function closeMenu() {
if (!open) return;
open = false;
trigger.setAttribute('aria-expanded', 'false');
wrap.classList.remove('is-open');
if (pop) {
pop.remove();
pop = null;
}
focusedIndex = -1;
if (activeSelectClose === closeMenu) activeSelectClose = null;
document.removeEventListener('pointerdown', onPointerDown, true);
window.removeEventListener('scroll', onWindowScroll, true);
window.removeEventListener('resize', closeMenu);
document.removeEventListener('keydown', onKeyDown, true);
}
function placePop() {
if (!pop) return;
const z = parseFloat(document.documentElement.style.zoom) || 1;
const r = screenRect(trigger);
const w = Math.max(r.width / z, 160);
pop.style.width = Math.min(w, (window.innerWidth / z) - 16) + 'px';
let left = r.left / z;
const maxLeft = (window.innerWidth / z) - w - 8;
if (left > maxLeft) left = Math.max(8, maxLeft);
if (left < 8) left = 8;
pop.style.left = left + 'px';
const spaceBelow = window.innerHeight / z - r.bottom / z - 8;
const spaceAbove = r.top / z - 8;
if (spaceBelow < 180 && spaceAbove > spaceBelow) {
pop.style.top = 'auto';
pop.style.bottom = (window.innerHeight / z - r.top / z + 4) + 'px';
pop.style.maxHeight = Math.min(280, Math.max(120, spaceAbove)) + 'px';
} else {
pop.style.bottom = 'auto';
pop.style.top = (r.bottom / z + 4) + 'px';
pop.style.maxHeight = Math.min(280, Math.max(120, spaceBelow)) + 'px';
}
}
function selectValue(v, fireChange = true) {
const changed = currentVal !== String(v);
currentVal = String(v);
updateTrigger();
if (changed && fireChange && onChange) {
onChange(currentVal);
}
}
function renderItems() {
if (!pop) return;
pop.textContent = '';
currentOpts.forEach((o, i) => {
const isSel = o.value === currentVal;
const titleEl = h('div', { class: 'custom-select-item-title' }, tr(o.label));
const contentEl = h('div', { class: 'custom-select-item-content' }, titleEl);
if (o.sub) {
contentEl.append(h('div', { class: 'custom-select-item-desc' }, tr(o.sub)));
}
const checkEl = h('span', { class: 'custom-select-item-check' }, svg('check', 14));
const itemBtn = h('button', {
type: 'button',
class: 'custom-select-item' + (isSel ? ' is-selected' : ''),
role: 'option',
'aria-selected': String(isSel),
dataset: { value: o.value, index: String(i) },
}, o.icon ? h('span', { class: 'custom-select-item-ic' }, svg(o.icon, 16)) : '', contentEl, checkEl);
itemBtn.addEventListener('click', (e) => {
e.stopPropagation();
selectValue(o.value, true);
closeMenu();
});
pop.append(itemBtn);
});
}
function openMenu() {
if (open) return;
if (activeSelectClose) activeSelectClose();
activeSelectClose = closeMenu;
open = true;
trigger.setAttribute('aria-expanded', 'true');
wrap.classList.add('is-open');
pop = h('div', { class: 'custom-select-pop', role: 'listbox' });
renderItems();
document.body.append(pop);
placePop();
const curItem = pop.querySelector('.is-selected');
if (curItem) {
curItem.scrollIntoView({ block: 'nearest' });
focusedIndex = parseInt(curItem.dataset.index, 10);
} else {
focusedIndex = -1;
}
document.addEventListener('pointerdown', onPointerDown, true);
window.addEventListener('scroll', onWindowScroll, true);
window.addEventListener('resize', closeMenu);
document.addEventListener('keydown', onKeyDown, true);
}
function onPointerDown(e) {
if (!open) return;
if (pop && (pop.contains(e.target) || trigger.contains(e.target))) return;
closeMenu();
}
function onWindowScroll(e) {
if (!open) return;
if (pop && pop.contains(e.target)) return;
closeMenu();
}
function onKeyDown(e) {
if (!open) {
if (document.activeElement === trigger && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
e.preventDefault();
openMenu();
}
return;
}
if (e.key === 'Escape') {
e.preventDefault();
e.stopPropagation();
closeMenu();
trigger.focus();
return;
}
if (e.key === 'Tab') {
closeMenu();
return;
}
const items = pop ? Array.from(pop.querySelectorAll('.custom-select-item')) : [];
if (!items.length) return;
if (e.key === 'ArrowDown') {
e.preventDefault();
focusedIndex = (focusedIndex + 1) % items.length;
updateFocus(items);
} else if (e.key === 'ArrowUp') {
e.preventDefault();
focusedIndex = (focusedIndex - 1 + items.length) % items.length;
updateFocus(items);
} else if (e.key === 'Enter' || e.key === ' ') {
e.preventDefault();
if (focusedIndex >= 0 && items[focusedIndex]) {
const val = items[focusedIndex].dataset.value;
selectValue(val, true);
closeMenu();
trigger.focus();
}
}
}
function updateFocus(items) {
items.forEach((it, idx) => {
if (idx === focusedIndex) {
it.classList.add('is-focused');
it.scrollIntoView({ block: 'nearest' });
} else {
it.classList.remove('is-focused');
}
});
}
trigger.addEventListener('click', (e) => {
e.stopPropagation();
if (open) closeMenu();
else openMenu();
});
trigger.addEventListener('keydown', (e) => {
if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
e.preventDefault();
openMenu();
}
});
window.addEventListener('langchange', () => {
updateTrigger();
if (open) renderItems();
});
fill(options);
selectValue(value, false);
return {
el: wrap,
select: nativeSel,
set(v) {
selectValue(v, false);
},
setOptions(opts, v) {
fill(opts);
if (v !== undefined) selectValue(v, false);
else updateTrigger();
},
getValue() {
return currentVal;
},
};
}
export function parseHuman(s) {
const t = String(s).toLowerCase().replace(/\s/g, '').replace(',', '.');
const m = /^(-?[\d.]+)(млн|м|m|тыс\.?|к|k)?/.exec(t);
if (!m) return NaN;
const mult = !m[2] ? 1 : /^(млн|м|m)$/.test(m[2]) ? 1e6 : 1e3;
return parseFloat(m[1]) * mult;
}
export function slider({ min = 0, max = 1, step = 0.01, value = 0, onInput, onChange, digits = 2, unit = '', format, parse, log = false, norm = false }) {
let lo = min;
let hi = max;
const scaled = log || norm;
const toPos = (v) => (log ? (Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo)) * 1000 : norm ? clamp((v - lo) / (hi - lo), 0, 1) * 1000 : v);
const fromPos = (p) => {
if (!scaled) return p;
if (p >= 1000) return hi;
if (p <= 0) return lo;
const v = log ? lo * Math.pow(hi / lo, p / 1000) : lo + (p / 1000) * (hi - lo);
return clamp(Math.round(v / step) * step, lo, hi);
};
const range = h('input', { type: 'range', class: 'range', min: scaled ? 0 : min, max: scaled ? 1000 : max, step: scaled ? 1 : step, value: toPos(value) });
const out = h('input', { type: 'text', class: 'num-out', inputmode: 'decimal', 'aria-label': 'Значение' });
const cur = () => fromPos(parseFloat(range.value));
const frac = (v) => clamp(log ? Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo), 0, 1);
const unfrac = (f) => {
const v = log ? lo * Math.pow(hi / lo, f) : lo + f * (hi - lo);
return clamp(Math.round(v / step) * step, lo, hi);
};
const show = () => (out.value = norm ? fmt(Math.round(parseFloat(range.value) / 10) / 100, 2) : format ? format(cur()) : fmt(cur(), digits) + unit);
const lab = h('span', { class: 'field-label cap-label' });
const ticks = h('span', { class: 'cap-ticks', 'aria-hidden': 'true' });
const wrap = h('div', { class: 'slider cap' }, range, lab, out, ticks);
const stepCount = () => (!scaled && step >= 1 ? Math.round((hi - lo) / step) : 0);
const paintTicks = () => {
const n = stepCount();
const on = n >= 2 && n <= 20;
wrap.classList.toggle('cap-steps', on);
if (!on) return;
if (ticks.childElementCount !== n + 1) {
ticks.textContent = '';
for (let i = 0; i <= n; i++) ticks.append(h('span'));
}
const k = Math.round((cur() - lo) / step);
[...ticks.children].forEach((t, i) => {
t.classList.toggle('on', i <= k);
t.classList.toggle('cur', i === k);
});
};
const paint = () => {
const p = scaled ? parseFloat(range.value) / 10 : ((parseFloat(range.value) - lo) / (hi - lo)) * 100;
range.style.setProperty('--p', clamp(p, 0, 100) + '%');
wrap.style.setProperty('--p', clamp(p, 0, 100) + '%');
show();
paintTicks();
};
wrap.__capLabel = (t) => {
lab.append(t);
lab.title = lab.textContent;
range.setAttribute('aria-label', lab.textContent);
};
range.addEventListener('dblclick', () => {
wrap.classList.add('is-edit');
out.focus();
});
out.addEventListener('blur', () => wrap.classList.remove('is-edit'));
range.addEventListener('input', () => {
paint();
onInput && onInput(cur());
});
range.addEventListener('change', () => onChange && onChange(cur()));
const commitText = () => {
const t = parse ? parse(out.value) : parseHuman(out.value);
const v = norm && isFinite(t) ? unfrac(clamp(t, 0, 1)) : t;
if (isFinite(v)) {
range.value = toPos(clamp(v, lo, hi));
paint();
onInput && onInput(cur());
onChange && onChange(cur());
} else paint();
};
out.addEventListener('change', commitText);
out.addEventListener('keydown', (e) => {
if (e.key === 'Enter') out.blur();
});
out.addEventListener('focus', () => out.select());
paint();
return {
el: wrap,
get: cur,
set(v) {
range.value = toPos(v);
paint();
},
setRange(a, b) {
const v = cur();
lo = a;
hi = b;
if (!scaled) {
range.min = a;
range.max = b;
}
range.value = toPos(clamp(v, lo, hi));
paint();
},
};
}
export function knob({ label, min = 0, max = 1, step = 0.01, value = 0, onInput, onChange, digits = 2, unit = '', format, parse, log = false }) {
let v = clamp(value, min, max);
const frac = (x) => clamp(log ? Math.log(Math.max(x, min) / min) / Math.log(max / min) : (x - min) / (max - min), 0, 1);
const unfrac = (f) => {
const x = log ? min * Math.pow(max / min, clamp(f, 0, 1)) : min + clamp(f, 0, 1) * (max - min);
return clamp(Math.round(x / step) * step, min, max);
};
const text = (x) => (format ? format(x) : fmt(x, digits) + unit);
const NS = 'http://www.w3.org/2000/svg';
const arc = (cls) => {
const c = document.createElementNS(NS, 'circle');
c.setAttribute('cx', '22');
c.setAttribute('cy', '22');
c.setAttribute('r', '17');
c.setAttribute('class', cls);
c.setAttribute('transform', 'rotate(135 22 22)');
return c;
};
const svgEl = document.createElementNS(NS, 'svg');
svgEl.setAttribute('viewBox', '0 0 44 44');
svgEl.setAttribute('class', 'knob-dial');
const fill = arc('knob-fill');
svgEl.append(arc('knob-track'), fill);
const out = h('input', { type: 'text', class: 'knob-val', inputmode: 'decimal', tabindex: '-1', 'aria-hidden': 'true' });
const face = h('div', { class: 'knob-face', role: 'slider', tabindex: '0', 'aria-label': label || 'Значение', 'aria-valuemin': String(min), 'aria-valuemax': String(max) }, svgEl, out);
const el = h('div', { class: 'knob' }, face, label ? h('span', { class: 'knob-label', title: label }, label) : null);
const paint = () => {
fill.setAttribute('stroke-dasharray', (80.1 * frac(v)).toFixed(2) + ' 106.8');
out.value = text(v);
face.setAttribute('aria-valuenow', String(v));
face.setAttribute('aria-valuetext', out.value);
};
const put = (nv, done) => {
nv = clamp(nv, min, max);
const changed = nv !== v;
v = nv;
paint();
if (changed) onInput && onInput(v);
if (done) onChange && onChange(v);
};
face.addEventListener('pointerdown', (e) => {
if (el.classList.contains('is-edit')) return;
e.preventDefault();
face.focus();
face.setPointerCapture(e.pointerId);
const f0 = frac(v);
const x0 = e.clientX;
const y0 = e.clientY;
const move = (ev) => {
const d = (y0 - ev.clientY + (ev.clientX - x0)) / (ev.shiftKey ? 600 : 150);
put(unfrac(f0 + d), false);
};
const up = () => {
face.removeEventListener('pointermove', move);
face.removeEventListener('pointerup', up);
face.removeEventListener('pointercancel', up);
onChange && onChange(v);
};
face.addEventListener('pointermove', move);
face.addEventListener('pointerup', up);
face.addEventListener('pointercancel', up);
});
face.addEventListener('keydown', (e) => {
const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
if (!d) return;
e.preventDefault();
put(unfrac(frac(v) + d * (e.shiftKey ? 0.1 : 0.02)), true);
});
face.addEventListener('dblclick', () => {
el.classList.add('is-edit');
out.tabIndex = 0;
out.focus();
out.select();
});
const commit = () => {
const t = parse ? parse(out.value) : parseHuman(out.value);
el.classList.remove('is-edit');
out.tabIndex = -1;
if (isFinite(t)) put(t, true);
else paint();
};
out.addEventListener('change', commit);
out.addEventListener('blur', () => {
if (el.classList.contains('is-edit')) commit();
});
out.addEventListener('keydown', (e) => {
if (e.key === 'Enter') out.blur();
else if (e.key === 'Escape') {
paint();
el.classList.remove('is-edit');
face.focus();
}
});
paint();
return {
el,
get: () => v,
set(x) {
v = clamp(x, min, max);
paint();
},
};
}
export function parsePct(s) {
const t = parseFloat(String(s).replace(',', '.'));
return !isFinite(t) ? NaN : /%/.test(s) || t > 1 ? t / 100 : t;
}
export function parseSec(s) {
const str = String(s).replace(',', '.');
const t = parseFloat(str);
return !isFinite(t) ? NaN : /мс|ms/i.test(str) ? t / 1000 : t;
}
export function knobRow(...items) {
return h('div', { class: 'knob-row' }, ...items.map((k) => k.el || k));
}
export function fxSlider(o) {
if (o.noNorm) return slider(o);
const lo = o.min ?? 0;
const hi = o.max ?? 1;
if ((lo === 0 || lo === -1) && (hi === 1 || hi === 2)) return slider({ ...o, format: undefined, unit: '', digits: 2 });
return slider({ ...o, norm: true });
}
export function numberField({ value = 0, step = 0.1, onChange, axis, digits = 4, min = -Infinity, max = Infinity, cls = '' }) {
let v = value;
const input = h('input', { type: 'text', class: 'num-in', inputmode: 'decimal', spellcheck: 'false', 'aria-label': axis || 'Значение' });
const label = axis ? h('span', { class: 'num-axis ' + (cls || ''), title: 'Потяните, чтобы менять значение' }, axis) : null;
const show = () => (input.value = fmt(v, digits));
const commit = (nv, fire = true) => {
nv = clamp(nv, min, max);
if (!isFinite(nv)) return show();
const changed = nv !== v;
v = nv;
show();
if (changed && fire) onChange && onChange(v);
};
input.addEventListener('change', () => commit(parseFloat(input.value.replace(',', '.'))));
input.addEventListener('keydown', (e) => {
if (e.key === 'Enter') input.blur();
else if (e.key === 'Escape') {
show();
input.blur();
} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
e.preventDefault();
commit(v + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1));
}
});
input.addEventListener('focus', () => input.select());
if (label) {
label.addEventListener('pointerdown', (e) => {
e.preventDefault();
label.setPointerCapture(e.pointerId);
let acc = 0;
let last = e.clientX;
let base = v;
const move = (ev) => {
acc += ev.clientX - last;
last = ev.clientX;
const k = ev.shiftKey ? 0.1 : ev.ctrlKey || ev.metaKey ? 10 : 1;
commit(base + (acc / 6) * step * k);
};
const up = () => {
label.removeEventListener('pointermove', move);
label.removeEventListener('pointerup', up);
label.removeEventListener('pointercancel', up);
};
label.addEventListener('pointermove', move);
label.addEventListener('pointerup', up);
label.addEventListener('pointercancel', up);
});
}
show();
return {
el: h('label', { class: 'num' }, label, input),
input,
set(x) {
v = x;
if (document.activeElement !== input) show();
},
};
}
const hexToRgb = (hx) => {
const n = parseInt(hx.slice(1), 16);
return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function rgbToHsv(r, g, b) {
r /= 255;
g /= 255;
b /= 255;
const mx = Math.max(r, g, b);
const mn = Math.min(r, g, b);
const d = mx - mn;
let hh = 0;
if (d) {
if (mx === r) hh = ((g - b) / d) % 6;
else if (mx === g) hh = (b - r) / d + 2;
else hh = (r - g) / d + 4;
hh *= 60;
if (hh < 0) hh += 360;
}
return [hh, mx ? d / mx : 0, mx];
}
function hsvToRgb(hh, sat, v) {
const c = v * sat;
const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
const m = v - c;
const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
let openPicker = null;
export function colorField({ value = '#ffffff', onInput, onChange }) {
let hsv = rgbToHsv(...hexToRgb(value));
let cur = value;
const dot = h('button', { type: 'button', class: 'cp-dot', 'aria-label': 'Выбрать цвет' });
const hex = h('input', { type: 'text', class: 'num-in hex-in', value, spellcheck: 'false', maxlength: 7, 'aria-label': 'HEX' });
const paintDot = () => {
dot.style.background = cur;
hex.value = cur;
};
const apply = (fire, final) => {
cur = rgbToHex(...hsvToRgb(hsv[0], hsv[1], hsv[2]));
paintDot();
fire && onInput && onInput(cur);
final && onChange && onChange(cur);
};
const setHex = (v, fire = true) => {
let t = v.trim();
if (!t.startsWith('#')) t = '#' + t;
if (!/^#[0-9a-fA-F]{6}$/.test(t)) return false;
cur = t.toLowerCase();
hsv = rgbToHsv(...hexToRgb(cur));
paintDot();
if (fire) {
onInput && onInput(cur);
onChange && onChange(cur);
}
return true;
};
hex.addEventListener('change', () => {
if (!setHex(hex.value)) hex.value = cur;
});
hex.addEventListener('keydown', (e) => {
if (e.key === 'Enter') hex.blur();
});
let pop = null;
const close = () => {
if (!pop) return;
pop.remove();
pop = null;
dot.setAttribute('aria-expanded', 'false');
document.removeEventListener('pointerdown', outside, true);
document.removeEventListener('keydown', esc, true);
if (openPicker === close) openPicker = null;
};
const outside = (e) => {
if (pop && !pop.contains(e.target) && !dot.contains(e.target)) close();
};
const esc = (e) => {
if (e.key === 'Escape') close();
};
const open = () => {
if (openPicker) openPicker();
const sv = h('canvas', { class: 'cp-sv', width: 220, height: 150 });
const hue = h('canvas', { class: 'cp-hue', width: 220, height: 14 });
const hexIn = h('input', { type: 'text', class: 'num-in hex-in', value: cur, spellcheck: 'false', maxlength: 7, 'aria-label': 'HEX' });
pop = h('div', { class: 'cp-pop', role: 'dialog', 'aria-label': 'Выбор цвета' }, sv, hue, h('div', { class: 'cp-row' }, h('span', { class: 'cp-cur', style: { background: cur } }), hexIn));
const drawSV = () => {
const c = sv.getContext('2d');
const w = sv.width;
const hh = sv.height;
c.fillStyle = `hsl(${hsv[0]}, 100%, 50%)`;
c.fillRect(0, 0, w, hh);
let g = c.createLinearGradient(0, 0, w, 0);
g.addColorStop(0, '#fff');
g.addColorStop(1, 'rgba(255,255,255,0)');
c.fillStyle = g;
c.fillRect(0, 0, w, hh);
g = c.createLinearGradient(0, 0, 0, hh);
g.addColorStop(0, 'rgba(0,0,0,0)');
g.addColorStop(1, '#000');
c.fillStyle = g;
c.fillRect(0, 0, w, hh);
const x = hsv[1] * w;
const y = (1 - hsv[2]) * hh;
c.lineWidth = 2;
c.strokeStyle = '#fff';
c.beginPath();
c.arc(x, y, 6, 0, Math.PI * 2);
c.stroke();
c.strokeStyle = 'rgba(0,0,0,0.5)';
c.lineWidth = 1;
c.beginPath();
c.arc(x, y, 7.5, 0, Math.PI * 2);
c.stroke();
};
const drawHue = () => {
const c = hue.getContext('2d');
const g = c.createLinearGradient(0, 0, hue.width, 0);
for (let k = 0; k <= 6; k++) g.addColorStop(k / 6, `hsl(${k * 60}, 100%, 50%)`);
c.fillStyle = g;
c.fillRect(0, 0, hue.width, hue.height);
const x = (hsv[0] / 360) * hue.width;
c.fillStyle = '#fff';
c.strokeStyle = 'rgba(0,0,0,0.55)';
c.lineWidth = 1.5;
c.beginPath();
c.rect(x - 3, 1, 6, hue.height - 2);
c.fill();
c.stroke();
};
const refresh = () => {
drawSV();
drawHue();
hexIn.value = cur;
pop.querySelector('.cp-cur').style.background = cur;
};
const drag = (el, fn) => {
el.addEventListener('pointerdown', (e) => {
el.setPointerCapture(e.pointerId);
const move = (ev) => {
const r = screenRect(el);
fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
apply(true, false);
refresh();
};
const up = () => {
el.removeEventListener('pointermove', move);
el.removeEventListener('pointerup', up);
onChange && onChange(cur);
};
el.addEventListener('pointermove', move);
el.addEventListener('pointerup', up);
move(e);
});
};
drag(sv, (x, y) => {
hsv[1] = x;
hsv[2] = 1 - y;
});
drag(hue, (x) => {
hsv[0] = x * 359.99;
});
hexIn.addEventListener('change', () => {
if (setHex(hexIn.value)) refresh();
else hexIn.value = cur;
});
hexIn.addEventListener('keydown', (e) => {
if (e.key === 'Enter') hexIn.blur();
});
document.body.append(pop);
const z = parseFloat(document.documentElement.style.zoom) || 1;
const r = screenRect(dot);
const pw = pop.offsetWidth;
const ph = pop.offsetHeight;
let left = r.left / z;
let top = r.bottom / z + 6;
left = Math.max(8, Math.min(window.innerWidth / z - pw - 8, left));
if (top + ph > window.innerHeight / z - 8) top = Math.max(8, r.top / z - ph - 6);
pop.style.left = left + 'px';
pop.style.top = top + 'px';
refresh();
dot.setAttribute('aria-expanded', 'true');
openPicker = close;
document.addEventListener('pointerdown', outside, true);
document.addEventListener('keydown', esc, true);
};
dot.addEventListener('click', () => (pop ? close() : open()));
paintDot();
return {
el: h('div', { class: 'color-field' }, dot, hex),
set(v) {
setHex(v, false);
},
};
}
export function empty(text, sub) {
return h('div', { class: 'empty-note' }, h('strong', {}, text), sub ? h('span', {}, sub) : null);
}
