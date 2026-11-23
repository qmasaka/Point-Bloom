import { h } from '../core/util.js';
import { iconButton } from './ui-kit.js';
import { icon } from './icons.js';
const fmt = (t) => {
t = Math.max(0, t || 0);
const m = Math.floor(t / 60);
const s = t - m * 60;
return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
export function createMediaBar(app, host) {
const mc = app.media;
const pm = mc.live;
const isOn = () => (pm.kind === 'video' && pm.el ? pm.playing && !pm.el.paused : pm.playing);
const eng = () => app.ui.effectsEngine;
const videoShown = () => (pm.kind === 'video' || pm.kind === 'rec') && mc.present && (eng()?.curKey || eng()?.state.source) === 'media';
const morphOn = () => app.ui.workspace === 'fx' && eng()?.active && (eng().playlist?.length || 0) >= 2 && !(videoShown() && eng().state.morphCfg.mode !== 'timer');
const mcfg = () => eng().state.morphCfg;
const slot = () => Math.max(0.5, mcfg().interval || 4);
const mTotal = () => slot() * eng().playlist.length;
const mTime = () => {
const e = eng();
const i = Math.max(0, e._pi ?? 0);
return Math.min(mTotal(), i * slot() + Math.min(slot(), Math.max(0, e._time - (e._lastMorph || 0))));
};
const mPlaying = () => mcfg().mode === 'timer';
const mSeek = (t) => {
const e = eng();
const list = e.playlist;
const i = Math.max(0, Math.min(list.length - 1, Math.floor(t / slot())));
if (list[i] !== (e.curKey || e.state.source)) e.morphTo(list[i]);
e._pi = i;
e._lastMorph = e._time - (t - i * slot());
};
const toggle = () => {
if (morphOn()) {
const c = mcfg();
c.mode = mPlaying() ? 'manual' : 'timer';
eng()._lastMorph = eng()._time - (mTime() % slot());
eng().touch();
eng().emit();
} else if (isOn()) pm.pause();
else pm.play();
sync();
play.blur();
};
const play = iconButton({ icon: 'pause', title: 'Играть или пауза (Пробел)', onClick: toggle });
const time = h('span', { class: 'mb-time' }, '0:00.0');
const seek = h('input', { type: 'range', class: 'range mb-seek', min: 0, max: 1, step: 0.01, value: 0, 'aria-label': 'Перемотка' });
let scrubbing = false;
let wasPlaying = false;
seek.addEventListener('pointerdown', () => {
scrubbing = true;
if (morphOn()) return;
wasPlaying = pm.playing;
pm.pause();
});
const endScrub = () => {
if (!scrubbing) return;
scrubbing = false;
if (morphOn()) return sync();
if (wasPlaying) pm.play();
sync();
};
seek.addEventListener('pointerup', endScrub);
seek.addEventListener('pointercancel', endScrub);
seek.addEventListener('change', endScrub);
seek.addEventListener('input', () => {
if (morphOn()) {
mSeek(parseFloat(seek.value));
paint();
return;
}
seek.style.setProperty('--p', (parseFloat(seek.value) / Math.max(0.1, pm.duration)) * 100 + '%');
if (!scrubbing) {
wasPlaying = pm.playing;
pm.pause();
pm.seek(parseFloat(seek.value));
if (wasPlaying) pm.play();
} else pm.seek(parseFloat(seek.value));
paint();
});
const total = h('span', { class: 'mb-time mb-total' }, '0:00.0');
const loop = iconButton({ icon: 'repeat', title: 'Повторять', pressed: pm.loop, onClick: () => { pm.setLoop(!pm.loop); sync(); } });
const mode = h('div', { class: 'mb-mode', role: 'radiogroup', 'aria-label': 'Что показывать' });
const bLive = h('button', { type: 'button', class: 'mb-seg', role: 'radio' }, 'Видео');
const bRec = h('button', { type: 'button', class: 'mb-seg', role: 'radio' }, 'Ролик');
bLive.addEventListener('click', () => switchView('live'));
bRec.addEventListener('click', () => switchView('rec'));
mode.append(bLive, bRec);
const mute = iconButton({ icon: 'speaker-high', title: 'Звук видео', onClick: () => { pm.setMuted(!pm.muted); sync(); } });
const rec = iconButton({ icon: 'record', title: 'Записать видео в точки', cls: 'mb-rec', onClick: () => mc.record({ fps: app.settings.media.recFps, seconds: Math.min(app.settings.media.recSec, Math.floor(pm.duration) || 10) }) });
const el = h('div', { class: 'media-bar vp-pill', hidden: true }, play, time, seek, total, mute, loop, mode, rec);
host.append(el);
function switchView(v) {
pm.setView(v);
const eng = app.ui.effectsEngine;
if (app.ui.workspace === 'fx') eng.setSource('media');
else mc.rebuild({ frame: false });
sync();
}
function paint() {
if (morphOn()) {
const T = mTotal();
time.textContent = fmt(mTime());
total.textContent = fmt(T);
seek.max = T;
seek.style.setProperty('--p', Math.min(100, (mTime() / T) * 100) + '%');
const n = eng().playlist.length;
seek.style.setProperty('--ticks', n);
el.classList.add('is-morph');
return;
}
el.classList.remove('is-morph');
time.textContent = fmt(pm.time);
total.textContent = fmt(pm.duration);
seek.max = Math.max(0.1, pm.duration);
seek.style.setProperty('--p', Math.min(100, (pm.time / Math.max(0.1, pm.duration)) * 100) + '%');
}
function sync() {
if (morphOn()) {
el.hidden = false;
const p = mPlaying();
play.innerHTML = '<span class="ic-wrap">' + icon(p ? 'pause' : 'play', 18) + '</span>';
play.dataset.tip = p ? 'Остановить смену форм' : 'Менять формы по времени';
play.classList.toggle('is-paused', !p);
mute.hidden = loop.hidden = mode.hidden = rec.hidden = true;
paint();
return;
}
loop.hidden = false;
const vid = (pm.kind === 'video' || pm.kind === 'rec') && mc.present;
el.hidden = !vid;
if (!vid) return;
play.innerHTML = '<span class="ic-wrap">' + icon(pm.playing ? 'pause' : 'play', 18) + '</span>';
play.dataset.tip = pm.playing ? 'Пауза' : 'Играть';
play.classList.toggle('is-paused', !pm.playing);
loop.setAttribute('aria-pressed', String(pm.loop));
mute.hidden = pm.kind !== 'video';
mute.innerHTML = '<span class="ic-wrap">' + icon(pm.muted ? 'speaker-slash' : 'speaker-high', 18) + '</span>';
mute.dataset.tip = pm.muted ? 'Включить звук видео' : 'Выключить звук видео';
bLive.setAttribute('aria-checked', String(pm.view === 'live'));
bRec.setAttribute('aria-checked', String(pm.view === 'rec'));
mode.hidden = !pm.rec || pm.kind === 'rec';
rec.hidden = pm.kind !== 'video';
rec.classList.toggle('is-rec', pm.recording);
paint();
}
app.bus.on('media', sync);
app.bus.on('fx', () => {
sync();
watch();
});
let timer = 0;
const tick = () => {
if (pm.recording) return;
if (!scrubbing) seek.value = morphOn() ? mTime() : pm.time;
paint();
};
const watch = () => {
if (el.hidden && timer) {
clearInterval(timer);
timer = 0;
} else if (!el.hidden && !timer) timer = setInterval(tick, 150);
};
app.bus.on('media', watch);
watch();
return { sync, el, toggle };
}
