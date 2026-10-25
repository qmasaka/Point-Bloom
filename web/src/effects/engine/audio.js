import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { TouchSynth } from '../audio/touch-synth.js';
import { SYNTH_STYLES } from '../state/options.js';
export class AudioPart {
_markBeat() {
this._tb = this._time;
const g = this.geometry;
if (g) {
const t = g.attributes.aTarget.array;
const i = Math.floor(Math.random() * (t.length / 3)) * 3;
(this._waveSrc ||= new THREE.Vector3()).set(t[i], t[i + 1], t[i + 2]);
}
}
_ensureCtx() {
if (this.ctx) return;
const A = window.AudioContext || window.webkitAudioContext;
this.ctx = new A();
this.bus = this.ctx.createGain();
this.analyser = this.ctx.createAnalyser();
this.analyser.fftSize = 2048;
this.analyser.smoothingTimeConstant = 0.6;
this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
this.out = this.ctx.createGain();
this.out.gain.value = this.state.audio.volume;
this.recDest = this.ctx.createMediaStreamDestination();
this.bus.connect(this.analyser);
this.bus.connect(this.out);
this.out.connect(this.ctx.destination);
this.bus.connect(this.recDest);
this.synth = new TouchSynth(this.ctx, this.bus);
}
setVolume(v) {
this.state.audio.volume = v;
if (this.out && this.sourceType !== 'mic') this.out.gain.value = v;
this.touch();
}
get trackLabel() {
if (this.sourceType === 'mic') return 'Микрофон';
if (this.sourceType === 'file') return this.audioName || 'Трек';
if (this.sourceType === 'video') return this._vidEl && this._vidEl !== this.pm.el ? 'Звук видео «Экрана»' : 'Звук видео';
return (SYNTH_STYLES.find((s) => s.id === this.state.audio.style) || SYNTH_STYLES[0]).name;
}
async play() {
this._ensureCtx();
if (this.ctx.state === 'suspended') {
try {
await this.ctx.resume();
} catch (e) {
}
}
if (this.sourceType === 'synth') {
this.synth.start(this.state.audio.style);
this.playing = true;
} else if (this.sourceType === 'video') {
this._connectVideo();
this.playing = true;
} else if (this.sourceType === 'file' && this.audioBuffer) {
this._stopFile();
this.source = this.ctx.createBufferSource();
this.source.buffer = this.audioBuffer;
this.source.loop = true;
this.source.connect(this.bus);
this.source.start(0);
this.playing = true;
}
this.emit();
}
pause() {
this.synth?.stop();
this._stopFile();
if (this.sourceType === 'mic') this._stopMic();
this._disconnectVideo();
this.playing = false;
this.emit();
}
_audioVideo() {
const own = this._vidEl;
if (own && own !== this.pm.el && own === this._scrFile?.media) return own;
const sp = this._soundPm();
return sp.ready && sp.kind === 'video' ? sp.el : null;
}
_soundPm() {
return this.app.media.soundEntry?.()?.pm || this.pm;
}
_resyncVideoAudio() {
if (this.sourceType !== 'video' || !this.playing || !this.ctx) return;
const el = this._audioVideo();
if (el && el !== this._vidEl) {
const old = this._vidPm;
if (old && old.onMute) old.onMute = null;
this._connectVideo();
}
}
_videoGate(el = this.pm.kind === 'video' ? this.pm.el : null) {
if (!el || el.tagName !== 'VIDEO') return null;
this._ensureCtx();
if (!el._fxNode) {
el._fxNode = this.ctx.createMediaElementSource(el);
el._fxGate = this.ctx.createGain();
el._fxNode.connect(el._fxGate);
el.muted = false;
}
return el._fxGate;
}
_connectVideo() {
const el = this._audioVideo();
const gate = this._videoGate(el);
if (!gate) return false;
if (this._vidGate && this._vidGate !== gate) this._disconnectVideo();
gate.disconnect();
gate.gain.value = 1;
gate.connect(this.bus);
this._vidGate = gate;
this._vidEl = el;
const sp = this._soundPm();
if (el === sp.el) {
this._vidPm = sp;
sp.onMute = (m) => {
if (this.out) this.out.gain.value = m ? 0 : this.state.audio.volume;
};
sp.onMute(sp.muted);
sp.play();
} else {
if (this.out) this.out.gain.value = this.state.audio.volume;
el.play().catch(() => {});
}
return true;
}
_vidSink() {
if (!this._sink) {
this._sink = this.ctx.createGain();
this._sink.gain.value = 0;
this._sink.connect(this.ctx.destination);
}
return this._sink;
}
_disconnectVideo() {
if (this._vidGate) {
const gate = this._vidGate;
try {
gate.disconnect();
gate.connect(this._vidSink());
} catch (e) {
}
this._vidGate = null;
if (this._vidPm && this._vidEl === this._vidPm.el) this._vidPm.onMute = null;
if (this.out) this.out.gain.value = this.state.audio.volume;
}
}
_videoToEditor() {
this._disconnectVideo();
const gate = this.pm.el?._fxGate;
if (!gate || !this.ctx) return;
gate.disconnect();
gate.gain.value = this.pm.muted ? 0 : 1;
gate.connect(this.ctx.destination);
this.pm.onMute = (m) => {
gate.gain.value = m ? 0 : 1;
};
}
async useVideoAudio(el) {
const scr = this._scrFile?.media?.tagName === 'VIDEO' ? this._scrFile.media : null;
el = el || (this.pm.ready && this.pm.kind === 'video' ? this.pm.el : scr);
if (!el) throw new Error('Откройте видео на вкладке «Медиа» или выберите видео для «Экрана»');
this._vidEl = el;
this._ensureCtx();
this.synth.stop();
this._stopFile();
this._stopMic();
this.sourceType = 'video';
this.touch();
await this.play();
}
toggle() {
return this.playing ? this.pause() : this.play();
}
_stopFile() {
if (this.source) {
try {
this.source.stop();
} catch (e) {
}
this.source.disconnect();
this.source = null;
}
}
_stopMic() {
if (this.micStream) {
this.micStream.getTracks().forEach((t) => t.stop());
this.micStream = null;
this.micNode?.disconnect();
if (this.out) this.out.gain.value = this.state.audio.volume;
}
}
async useSynth(style) {
if (style) this.state.audio.style = style;
if (!SYNTH_STYLES.some((x) => x.id === this.state.audio.style)) this.state.audio.style = 'deep';
this._disconnectVideo();
this._stopMic();
this._stopFile();
this.sourceType = 'synth';
this.touch();
await this.play();
}
async loadFile(file) {
this._ensureCtx();
this._disconnectVideo();
this.synth.stop();
this._stopFile();
this._stopMic();
try {
this.audioBuffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
} catch (e) {
this.playing = false;
this.emit();
throw e;
}
this.sourceType = 'file';
this.audioName = file.name.replace(/\.[^.]+$/, '');
await this.play();
}
async useMic() {
this._ensureCtx();
this._disconnectVideo();
this.synth.stop();
this._stopFile();
this._stopMic();
try {
this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
} catch (e) {
this.playing = false;
this.emit();
throw e;
}
this.micNode = this.ctx.createMediaStreamSource(this.micStream);
this.micNode.connect(this.bus);
this.out.gain.value = 0;
this.sourceType = 'mic';
this.playing = true;
if (this.ctx.state === 'suspended') await this.ctx.resume();
this.emit();
}
_analyse(dt) {
const a = this.state.audio;
let bass = 0, mid = 0, high = 0;
if (this.analyser && this.playing) {
this.analyser.getByteFrequencyData(this.freqData);
const n = this.freqData.length;
const sr = this.ctx.sampleRate;
const binHz = sr / this.analyser.fftSize;
const bin = (hz) => Math.min(n, Math.max(0, Math.round(hz / binHz)));
const mean = (i0, i1) => {
let s = 0;
for (let i = i0; i < i1; i++) s += this.freqData[i];
return s / (Math.max(1, i1 - i0) * 255);
};
const bRaw = mean(bin(30), Math.max(bin(30) + 1, bin(250)));
const mRaw = mean(bin(250), bin(4000));
const hRaw = mean(bin(4000), bin(12000));
const auto = a.auto !== false;
const g = a.gain;
const AG = (this._agc ||= {});
const norm = (key, raw) => (auto ? clamp(this._follow(AG, key, raw, dt, 0.1) * (g / 1.3), 0, 1) : clamp(raw * g * 1.15 * (key === 'mid' ? 1.2 : key === 'high' ? 1.8 : 1), 0, 1));
const bN = norm('bass', bRaw);
const mN = norm('mid', mRaw);
const hN = norm('high', hRaw);
const b0 = bin(30), b1 = Math.max(b0 + 2, bin(220));
const prev = (this._prevBass ||= new Float32Array(n));
let flux = 0;
for (let i = b0; i < b1; i++) {
const d = this.freqData[i] - prev[i];
if (d > 0) flux += d;
prev[i] = this.freqData[i];
}
flux /= (b1 - b0) * 255;
const H = this._beatHist;
H[this._beatIdx++ % H.length] = flux;
let avg = 0;
for (let i = 0; i < H.length; i++) avg += H[i];
avg /= H.length;
let varr = 0;
for (let i = 0; i < H.length; i++) varr += (H[i] - avg) * (H[i] - avg);
const sd = Math.sqrt(varr / H.length);
const thr = avg + Math.max(0.012, sd * 1.35);
const now = performance.now();
if (flux > thr && bN > 0.12 && now - this._lastBeat > 160) {
this._lastBeat = now;
this.levels.beat = clamp(0.65 + (flux - thr) / Math.max(thr, 0.02), 0.65, 1);
this._markBeat();
}
const kA = 1 - Math.pow(0.001, dt * 9);
const kR = 1 - Math.pow(0.001, dt * 2.6);
const lag = (cur, raw) => cur + (raw - cur) * (raw > cur ? kA : kR);
bass = lag(this.levels.bass, bN);
mid = lag(this.levels.mid, mN);
high = lag(this.levels.high, hN);
const gs = a.gain * 1.15;
for (let i = 0; i < 64; i++) {
const f0 = Math.floor(Math.pow(i / 64, 2) * n * 0.55);
const f1 = Math.max(f0 + 1, Math.floor(Math.pow((i + 1) / 64, 2) * n * 0.55));
let s = 0;
for (let j = f0; j < f1; j++) s += this.freqData[j];
const v = Math.min(1, (s / ((f1 - f0) * 255)) * gs * (1 + i / 40));
this.spec[i] += (v - this.spec[i]) * (v > this.spec[i] ? 0.6 : 0.15);
}
} else if (a.idle) {
const t = this._time;
bass = 0.3 + 0.22 * Math.sin(t * 1.3);
mid = 0.28 + 0.2 * Math.sin(t * 1.9 + 1);
high = 0.22 + 0.15 * Math.sin(t * 2.7 + 2);
if (Math.sin(t * 2.2) > 0.96) this.levels.beat = Math.max(this.levels.beat, 0.8);
for (let i = 0; i < 64; i++) this.spec[i] = 0.2 + 0.15 * Math.sin(t * 2 + i * 0.4) * Math.sin(t * 0.7 + i * 0.1);
} else {
const k = 1 - Math.pow(0.001, dt * 3);
bass = this.levels.bass * (1 - k);
mid = this.levels.mid * (1 - k);
high = this.levels.high * (1 - k);
for (let i = 0; i < 64; i++) this.spec[i] *= 1 - k;
}
const beat = this.levels.beat * Math.pow(0.0008, dt);
this.levels = { bass, mid, high, beat };
const d = this.specTex.image.data;
for (let i = 0; i < 64; i++) d[i] = Math.round(clamp(this.spec[i], 0, 1) * 255);
this.specTex.needsUpdate = true;
}
_follow(store, key, raw, dt, floor) {
let m = store[key];
if (m === undefined || m === null) m = raw;
const age = (store[key + '#'] = (store[key + '#'] || 0) + dt);
m += (raw - m) * Math.min(1, dt / (age < 4 ? 0.7 : 5));
store[key] = m;
return raw / Math.max(floor, m * 1.8);
}
_bandLevel(l) {
const envs = (this._bandEnvs ||= new WeakMap());
let e = envs.get(l);
if (!e) {
e = { t: -1, v: 0, pk: {}, hist: new Float32Array(180), hi: 0, n: 0 };
envs.set(l, e);
}
if (e.t === this._time && e.band === l.band && e.lo === l.lo && e.hi2 === l.hi) return e.v;
const dt = e.t < 0 ? 0.016 : Math.min(0.1, Math.max(0, this._time - e.t));
let v;
if (l.band === 'custom') {
const i0 = Math.max(0, Math.floor(l.lo * 64));
const i1 = Math.min(64, Math.max(i0 + 1, Math.ceil(l.hi * 64)));
let s = 0;
for (let i = i0; i < i1; i++) s += this.spec[i];
const raw = s / (i1 - i0);
v = this.state.audio.auto !== false ? Math.min(1, this._follow(e.pk, 'c', raw, dt, 0.08)) : Math.min(1, raw * 1.5);
} else {
v = this.levels[l.band] || 0;
}
e.t = this._time;
e.band = l.band;
e.lo = l.lo;
e.hi2 = l.hi;
e.v = v;
if (dt > 0) {
e.hist[e.hi++ % e.hist.length] = v;
e.n = Math.min(e.hist.length, e.n + 1);
}
return v;
}
autoThreshold(l) {
const e = this._bandEnvs?.get(l);
if (!e || e.n < 60) return null;
const arr = Array.from(e.hist.subarray(0, e.n)).sort((x, y) => x - y);
const q = (p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const lo = q(0.5);
const hi = q(0.95);
if (hi < 0.12) return null;
return clamp(lo + (hi - lo) * 0.6, 0.12, 0.9);
}
get soundActive() {
return !!(this.playing && this.analyser) || !!this.state.audio.idle;
}
hzAt(x) {
const sr = this.ctx?.sampleRate || 44100;
return Math.round(x * x * 0.275 * sr);
}
}
