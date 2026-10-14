import { icon } from '../../ui/icons.js';
const KEY = 'objglb.fxfloat.v1';
export function initFloatingPanels() {
let st = {};
try {
st = JSON.parse(localStorage.getItem(KEY)) || {};
} catch {
st = {};
}
const save = () => {
try {
localStorage.setItem(KEY, JSON.stringify(st));
} catch {
}
};
const cards = [
['fxLeft', 'left', 'Эффекты'],
['sidebar', 'right', 'Настройки'],
];
for (const [id, name, title] of cards) {
const el = document.getElementById(id);
if (!el || el.querySelector(':scope > .fxf-bar')) continue;
const bar = document.createElement('div');
bar.className = 'fxf-bar';
const label = document.createElement('span');
label.className = 'fxf-title';
label.textContent = title;
const toggle = document.createElement('button');
toggle.type = 'button';
toggle.className = 'fxf-toggle';
toggle.setAttribute('aria-label', 'Свернуть или развернуть панель');
toggle.innerHTML = icon('caret-down', 14);
bar.append(label, toggle);
el.prepend(bar);
if (id === 'sidebar') {
const wrap = document.createElement('div');
wrap.className = 'fxf-scroll';
const tabs = el.querySelector(':scope > .tabs');
const panels = el.querySelector(':scope > .panels');
if (tabs && panels) {
el.insertBefore(wrap, tabs);
wrap.append(tabs, panels);
}
}
const pos = (st[name] ||= { c: false });
const apply = () => {
el.style.translate = '';
el.classList.toggle('fxf-collapsed', !!pos.c);
toggle.setAttribute('aria-expanded', String(!pos.c));
};
apply();
toggle.addEventListener('click', () => {
pos.c = !pos.c;
apply();
save();
});
}
}
