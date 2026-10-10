import { h } from './util.js';
import { icon } from './icons.js';
import { select, iconButton } from './ui-kit.js';
const fmt = (t) => {
t = Math.max(0, t || 0);
const m = Math.floor(t / 60);
return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
};
export function createAnimSettings(app) {
const A = app.anim;
const clipSel = select({ options: [{ value: '0', label: '-' }], value: '0', onChange: (v) => A.setClip(parseInt(v, 10)) });
const clipWrap = h('div', { class: 'as-clip' }, clipSel.el);
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3];
const speed = h('button', { type: 'button', class: 'as-speed', 'data-tip': 'Скорость анимации: нажмите, чтобы переключить' });
speed.addEventListener('click', () => {
const i = SPEEDS.findIndex((x) => Math.abs(x - A.speed) < 1e-6);
A.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
});
const loop = iconButton({ icon: 'repeat', title: 'Повторять анимацию', onClick: () => A.setLoop(!A.loop) });
const el = h('div', { class: 'anim-settings' }, clipWrap, speed, loop);
let lastKey = '';
function sync() {
if (!A.has) return;
const k = A.clips.map((c) => c.name).join('|');
if (k !== lastKey) {
lastKey = k;
clipSel.setOptions(A.clips.map((c, i) => ({ value: String(i), label: c.name || 'Анимация ' + (i + 1) })));
}
clipWrap.hidden = A.clips.length < 2;
clipSel.set(String(A.clipIndex));
speed.textContent = A.speed + '×';
loop.setAttribute('aria-pressed', String(A.loop));
}
A.onChange(sync);
sync();
return { el, sync };
}
export function createAnimBar(app, host) {
const A = app.anim;
const play = iconButton({ icon: 'pause', title: 'Играть или пауза', onClick: () => A.toggle() });
const time = h('span', { class: 'mb-time' }, '0:00.0');
const total = h('span', { class: 'mb-time mb-total' }, '0:00.0');
const seek = h('input', { type: 'range', class: 'range mb-seek', min: 0, max: 1, step: 0.01, value: 0, 'aria-label': 'Перемотка анимации' });
seek.addEventListener('input', () => {
A.pause();
A.seek(parseFloat(seek.value));
});
const settings = createAnimSettings(app);
const el = h('div', { class: 'media-bar anim-bar vp-pill', hidden: true, role: 'region', 'aria-label': 'Анимация' }, play, time, seek, total, settings.el);
host.append(el);
function paint() {
time.textContent = fmt(A.time);
total.textContent = fmt(A.duration);
seek.max = A.duration;
if (document.activeElement !== seek) seek.value = A.time;
seek.style.setProperty('--p', Math.min(100, (A.time / A.duration) * 100) + '%');
}
function sync() {
const vid = (app.media.pm.kind === 'video' || app.media.pm.kind === 'rec') && app.media.present;
el.hidden = !A.has || vid || document.getElementById('app')?.classList.contains('fx-anim-active');
if (el.hidden) return;
play.innerHTML = '<span class="ic-wrap">' + icon(A.playing ? 'pause' : 'play', 18) + '</span>';
play.dataset.tip = A.playing ? 'Пауза' : 'Играть';
play.classList.toggle('is-paused', !A.playing);
paint();
}
A.onChange(sync);
app.bus.on('animpose', () => {
if (!el.hidden) paint();
});
app.bus.on('media', sync);
app.bus.on('fxanim', sync);
new MutationObserver(sync).observe(document.getElementById('app') || document.body, { attributes: true, attributeFilter: ['class'] });
sync();
return { el, sync };
}
