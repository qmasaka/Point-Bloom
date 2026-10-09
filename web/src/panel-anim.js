import { h } from './util.js';
import { icon } from './icons.js';
import { section, field, slider, segmented, switchRow, select, iconButton } from './ui-kit.js';
export function createAnimPanel(app, key = 'anim') {
const A = app.anim;
const clipSel = select({ options: [{ value: '0', label: '-' }], value: '0', onChange: (v) => A.setClip(parseInt(v, 10)) });
const playBtn = iconButton({ icon: 'pause', title: 'Играть или остановить', cls: 'anim-play', onClick: () => A.toggle() });
const time = slider({ min: 0, max: 1, step: 0.01, value: 0, digits: 2, unit: ' с', onInput: (v) => A.seek(v), onChange: () => {} });
const speed = segmented({ cls: 'seg-tight', options: [{ value: '0.5', label: '0.5×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }], value: '1', onChange: (v) => A.setSpeed(parseFloat(v)) });
const loop = switchRow('Зациклить', { value: true, onChange: (v) => A.setLoop(v) });
const skel = switchRow('Показать скелет', { value: false, onChange: (v) => A.setSkeleton(v) }, 'Кости видны поверх модели; сайт их не анимирует, а проигрывает готовую анимацию из файла');
const info = h('div', { class: 'field-hint' });
const body = h('div', { class: 'anim-row' }, playBtn, h('div', { class: 'anim-time' }, time.el));
const sec = section('Анимация персонажа', { key: 'anim-' + key }, field('Клип', clipSel.el, { wide: true }), body, field('Скорость', speed.el, { wide: true }), loop.el, skel.el, info);
let lastKey = '';
function sync() {
sec.el.hidden = !A.has;
if (!A.has) return;
const k = A.clips.map((c) => c.name).join('|');
if (k !== lastKey) {
lastKey = k;
clipSel.setOptions(A.clips.map((c, i) => ({ value: String(i), label: c.name || 'Клип ' + (i + 1) })));
}
clipSel.set(String(A.clipIndex));
playBtn.textContent = '';
playBtn.innerHTML = icon(A.playing ? 'pause' : 'play', 17);
time.setRange(0, A.duration);
time.set(A.time);
speed.set(String(A.speed));
loop.set(A.loop);
skel.set(A.skeletonOn);
info.textContent = `Клипов в файле: ${A.clips.length}. В режиме «Эффекты» точки двигаются вместе с персонажем.`;
}
A.onChange(sync);
app.bus.on('animpose', () => {
if (A.has && A.playing) time.set(A.time);
});
sync();
return { el: sec.el, sync };
}
