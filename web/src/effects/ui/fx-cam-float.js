import { screenRect, toCss } from '../../core/util.js';
const KEY = 'objglb.fxcam.v1';
export function makeCamMovable(box, appEl, viewport) {
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
const mode = () => (appEl.classList.contains('fx-focus') ? 'focus' : 'normal');
const grip = document.createElement('div');
grip.className = 'fx-cam-grip';
grip.title = 'Потяните, чтобы изменить размер';
box.append(grip);
const clamp = () => {
if (box.style.left === '') return;
const v = screenRect(viewport);
const r = screenRect(box);
let x = toCss(r.left - v.left);
let y = toCss(r.top - v.top);
x = Math.max(8, Math.min(toCss(v.width - r.width) - 8, x));
y = Math.max(8, Math.min(toCss(v.height - r.height) - 8, y));
box.style.left = x + 'px';
box.style.top = y + 'px';
};
const apply = () => {
const p = st[mode()];
if (p && p.x != null) {
box.style.left = p.x + 'px';
box.style.top = p.y + 'px';
box.style.bottom = 'auto';
} else {
box.style.left = box.style.top = box.style.bottom = '';
}
box.style.width = mode() === 'focus' && st.focusW ? st.focusW + 'px' : '';
clamp();
};
apply();
box.addEventListener('pointerdown', (e) => {
if (e.button !== 0 || e.target === grip) return;
e.preventDefault();
const v = screenRect(viewport);
const r = screenRect(box);
const dx = e.clientX - r.left;
const dy = e.clientY - r.top;
box.setPointerCapture(e.pointerId);
box.classList.add('is-dragging');
const move = (ev) => {
box.style.left = toCss(ev.clientX - dx - v.left) + 'px';
box.style.top = toCss(ev.clientY - dy - v.top) + 'px';
box.style.bottom = 'auto';
clamp();
};
const up = () => {
box.removeEventListener('pointermove', move);
box.removeEventListener('pointerup', up);
box.removeEventListener('pointercancel', up);
box.classList.remove('is-dragging');
st[mode()] = { x: parseFloat(box.style.left), y: parseFloat(box.style.top) };
save();
};
box.addEventListener('pointermove', move);
box.addEventListener('pointerup', up);
box.addEventListener('pointercancel', up);
});
grip.addEventListener('pointerdown', (e) => {
if (e.button !== 0) return;
e.preventDefault();
e.stopPropagation();
const v = screenRect(viewport);
const startW = toCss(screenRect(box).width);
const sx = e.clientX;
grip.setPointerCapture(e.pointerId);
const move = (ev) => {
const w = Math.max(160, Math.min(720, toCss(v.width) - 40, startW + toCss(ev.clientX - sx)));
box.style.width = w + 'px';
clamp();
};
const up = () => {
grip.removeEventListener('pointermove', move);
grip.removeEventListener('pointerup', up);
grip.removeEventListener('pointercancel', up);
st.focusW = toCss(screenRect(box).width);
const p = st[mode()];
if (p) {
p.x = parseFloat(box.style.left);
p.y = parseFloat(box.style.top);
}
save();
};
grip.addEventListener('pointermove', move);
grip.addEventListener('pointerup', up);
grip.addEventListener('pointercancel', up);
});
const mo = new MutationObserver(apply);
mo.observe(appEl, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize', clamp);
box._camCleanup = () => mo.disconnect();
}
