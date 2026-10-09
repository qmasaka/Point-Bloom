const MIN = 84;
export function initMobile(app) {
const root = document.getElementById('app');
const ws = document.querySelector('.workspace');
const sidebar = document.getElementById('sidebar');
const fxLeft = document.getElementById('fxLeft');
const mq = window.matchMedia('(max-width: 900px)');
let state = 'min';
const vh = () => (window.visualViewport ? window.visualViewport.height : window.innerHeight);
const heights = () => (vh() < 520 ? { min: MIN, mid: Math.round(vh() * 0.58), full: Math.round(vh() - 56) } : { min: MIN, mid: Math.round(vh() * 0.46), full: Math.round(vh() - 110) });
const setH = (px) => root.style.setProperty('--sheet-h', Math.round(px) + 'px');
function setState(s) {
state = s;
root.dataset.sheet = s;
setH(heights()[s]);
setTimeout(() => app.viewport.resize(), 320);
}
function makeHandle() {
const hd = document.createElement('div');
hd.className = 'sheet-handle';
hd.innerHTML = '<span class="sheet-grab"></span><div class="sheet-switch"><button type="button" data-ms="list">Эффекты</button><button type="button" data-ms="settings">Настройки</button></div>';
let sy = 0, sh = 0, moved = false, drag = false;
hd.addEventListener('pointerdown', (e) => {
if (e.target.closest('.sheet-switch')) return;
drag = true;
moved = false;
sy = e.clientY;
sh = parseFloat(getComputedStyle(root).getPropertyValue('--sheet-h')) || heights()[state];
hd.setPointerCapture(e.pointerId);
ws.classList.add('dragging');
});
hd.addEventListener('pointermove', (e) => {
if (!drag) return;
const dy = sy - e.clientY;
if (Math.abs(dy) > 5) moved = true;
const H = heights();
setH(Math.max(H.min, Math.min(H.full, sh + dy)));
});
const end = (e) => {
if (!drag) return;
drag = false;
ws.classList.remove('dragging');
const H = heights();
if (!moved) return setState(state === 'min' ? 'mid' : state === 'mid' ? 'full' : 'min');
const cur = parseFloat(getComputedStyle(root).getPropertyValue('--sheet-h'));
setState(Object.entries(H).sort((a, b) => Math.abs(a[1] - cur) - Math.abs(b[1] - cur))[0][0]);
};
hd.addEventListener('pointerup', end);
hd.addEventListener('pointercancel', end);
hd.querySelectorAll('[data-ms]').forEach((b) =>
b.addEventListener('click', () => {
setMsheet(b.dataset.ms);
if (state === 'min') setState('mid');
})
);
return hd;
}
const hS = makeHandle();
const hF = makeHandle();
sidebar.insertBefore(hS, sidebar.querySelector('.tabs'));
fxLeft.insertBefore(hF, fxLeft.firstChild);
function setMsheet(v) {
root.dataset.msheet = v;
document.querySelectorAll('.sheet-switch button').forEach((b) => b.classList.toggle('is-on', b.dataset.ms === v));
}
setMsheet('list');
sidebar.addEventListener('click', (e) => {
if (!mq.matches) return;
if (e.target.closest('.tab, .fx-tab') && state === 'min') setState('mid');
});
fxLeft.addEventListener('click', (e) => {
if (!mq.matches || e.target.closest('.sheet-handle')) return;
if (e.target.closest('.fx-layer-head') && !e.target.closest('.switch')) setMsheet('settings');
});
let wasFx = root.classList.contains('fx-mode');
new MutationObserver(() => {
const fx = root.classList.contains('fx-mode');
if (fx === wasFx) return;
wasFx = fx;
if (!mq.matches) return;
if (fx) {
setMsheet('list');
setState('mid');
} else setState('min');
}).observe(root, { attributes: true, attributeFilter: ['class'] });
function apply() {
root.classList.toggle('is-mobile', mq.matches);
if (mq.matches) setState(state);
else {
root.style.removeProperty('--sheet-h');
delete root.dataset.sheet;
setTimeout(() => app.viewport.resize(), 50);
}
}
mq.addEventListener('change', apply);
window.visualViewport?.addEventListener('resize', () => mq.matches && !ws.classList.contains('dragging') && setH(heights()[state]));
apply();
}
