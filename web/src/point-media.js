import { zlibSync, unzlibSync, zipSync } from 'three/addons/libs/fflate.module.js';
const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
const c = i / 255;
LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const wait = (el, ev, ms = 2000) =>
new Promise((res) => {
const t = setTimeout(res, ms);
el.addEventListener(
ev,
() => {
clearTimeout(t);
res();
},
{ once: true }
);
});
export class PointMedia {
constructor() {
this.kind = null;
this.view = 'live';
this.el = null;
this.url = null;
this.name = '';
this.aspect = 1;
this.cols = 0;
this.rows = 0;
this.rec = null;
this.playing = true;
this.loop = true;
this.t = 0;
this.canvas = document.createElement('canvas');
this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
this.dirty = true;
this._lastKey = -1;
this._xy = null;
this.recording = false;
this.muted = true;
this.onMute = null;
}
get ready() {
return !!(this.kind && (this.el || this.rec));
}
get isRec() {
return this.view === 'rec' && !!this.rec;
}
get duration() {
if (this.isRec) return this.rec.frames.length / this.rec.fps;
return this.kind === 'video' ? this.el.duration || 0 : 0;
}
get time() {
if (this.isRec) return this.t;
return this.kind === 'video' ? this.el.currentTime : 0;
}
seek(t) {
if (this.isRec) {
this.t = Math.max(0, Math.min(this.duration, t));
this.dirty = true;
} else if (this.kind === 'video') {
const v = this.el;
const target = Math.max(0, Math.min(this.duration, t));
this.dirty = true;
if (v.seeking) {
this._pendingSeek = target;
if (!this._seekHook) {
this._seekHook = true;
v.addEventListener('seeked', () => {
this._seekHook = false;
if (this._pendingSeek != null) {
const p = this._pendingSeek;
this._pendingSeek = null;
this.seek(p);
}
}, { once: true });
}
} else v.currentTime = target;
}
}
_revoke() {
if (this.url) URL.revokeObjectURL(this.url);
this.url = null;
}
async load(file) {
const name = file.name || 'медиа';
if (/\.pcv$/i.test(name)) {
const rec = parsePCV(new Uint8Array(await file.arrayBuffer()));
this.pause();
this._revoke();
this.el = null;
this.kind = 'rec';
this.view = 'rec';
this.rec = rec;
this.cols = rec.cols;
this.rows = rec.rows;
this.aspect = rec.aspect;
this.t = 0;
this.name = name;
this._xy = null;
this.playing = true;
this.dirty = true;
this._lastKey = -1;
return;
}
const url = URL.createObjectURL(file);
const isVideo = (file.type || '').startsWith('video') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(name);
this.muted = true;
this.onMute = null;
let el;
try {
if (isVideo) {
el = document.createElement('video');
el.muted = this.muted;
el.loop = true;
el.playsInline = true;
el.preload = 'auto';
el.src = url;
await new Promise((res, rej) => {
el.onloadeddata = res;
el.onerror = () => rej(new Error('Не удалось прочитать видео'));
});
this.aspect = el.videoWidth / el.videoHeight;
} else {
el = new Image();
el.src = url;
await el.decode();
this.aspect = el.naturalWidth / el.naturalHeight;
}
} catch (e) {
URL.revokeObjectURL(url);
throw e;
}
this.pause();
this._revoke();
this.url = url;
this.el = el;
this.kind = isVideo ? 'video' : 'image';
this.view = 'live';
this.rec = null;
this.name = name;
this.t = 0;
this._xy = null;
this.dirty = true;
if (isVideo) {
el.loop = this.loop;
this.playing = true;
this._tryPlay();
}
}
play() {
this.playing = true;
if (this.kind === 'video' && !this.isRec) this._tryPlay();
}
_tryPlay() {
const el = this.el;
if (!el) return;
el.play().catch(() => {
if (!el._fxNode) el.muted = true;
el.play().catch(() => {});
});
}
setMuted(v) {
this.muted = v;
if (this.onMute) this.onMute(v);
else if (this.el && !this.el._fxNode) this.el.muted = v;
}
pause() {
this.playing = false;
if (this.kind === 'video' && this.el) this.el.pause();
}
setLoop(v) {
this.loop = v;
if (this.kind === 'video' && this.el) this.el.loop = v;
}
setGrid(n) {
if (this.isRec) return;
const cols = Math.max(8, Math.round(Math.sqrt(n * this.aspect)));
const rows = Math.max(8, Math.round(n / cols));
if (cols !== this.cols || rows !== this.rows) {
this.cols = cols;
this.rows = rows;
this._xy = null;
this.dirty = true;
}
}
get count() {
return this.cols * this.rows;
}
_grid() {
if (this._xy) return this._xy;
const { cols, rows, aspect } = this;
const W = aspect >= 1 ? 2.2 : 2.2 * aspect;
const H = W / aspect;
const xy = new Float32Array(cols * rows * 2);
for (let r = 0; r < rows; r++) {
for (let c = 0; c < cols; c++) {
const i = (r * cols + c) * 2;
xy[i] = ((c + 0.5) / cols - 0.5) * W;
xy[i + 1] = (0.5 - (r + 0.5) / rows) * H;
}
}
this._xy = xy;
return xy;
}
sample() {
if (this.isRec) {
const f = this.rec.frames;
return f[Math.min(f.length - 1, Math.floor(this.t * this.rec.fps))];
}
const { cols, rows } = this;
if (this.canvas.width !== cols || this.canvas.height !== rows) {
this.canvas.width = cols;
this.canvas.height = rows;
}
this.ctx.drawImage(this.el, 0, 0, cols, rows);
const d = this.ctx.getImageData(0, 0, cols, rows).data;
const out = new Uint8Array(cols * rows * 3);
for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
out[j] = d[i];
out[j + 1] = d[i + 1];
out[j + 2] = d[i + 2];
}
return out;
}
advance(dt) {
if (!this.ready || this.recording) return null;
if (this.isRec) {
if (this.playing) {
this.t += dt;
const d = this.duration;
if (this.t >= d) {
if (this.loop) this.t %= d || 1;
else {
this.t = d - 1e-3;
this.playing = false;
}
}
}
const key = Math.floor(this.t * this.rec.fps);
if (key === this._lastKey && !this.dirty) return null;
this._lastKey = key;
this.dirty = false;
return this.sample();
}
if (this.kind === 'image') {
if (!this.dirty) return null;
this.dirty = false;
return this.sample();
}
if (this.el.readyState < 2) return null;
const key = Math.round(this.el.currentTime * 60);
if (key === this._lastKey && !this.dirty) return null;
this._lastKey = key;
this.dirty = false;
return this.sample();
}
buildCloud(rgb, relief, depth) {
const n = this.cols * this.rows;
const xy = this._grid();
const positions = new Float32Array(n * 3);
const normals = new Float32Array(n * 3);
const colors = new Float32Array(n * 3);
for (let i = 0; i < n; i++) {
positions[i * 3] = xy[i * 2];
positions[i * 3 + 1] = xy[i * 2 + 1];
normals[i * 3 + 2] = 1;
}
const cloud = { positions, normals, colors, count: n, hide: new Float32Array(n) };
this.applyTo(cloud, rgb, relief, depth);
return cloud;
}
applyTo(cloud, rgb, relief, depth) {
const n = this.cols * this.rows;
const pos = cloud.positions;
const col = cloud.colors;
const k = relief === 'bright' ? 1 : relief === 'dark' ? -1 : 0;
const A = this.adjust;
const hide = cloud.hide;
const act = !!A && (A.cutDark > 0 || A.cutLight < 1 || A.keyTol > 0 || A.edges > 0 || A.contrast !== 1 || A.sat !== 1 || A.post > 0 || A.invert);
if (!act) {
if (hide) hide.fill(0);
for (let i = 0; i < n; i++) {
const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
col[i * 3] = LUT[r];
col[i * 3 + 1] = LUT[g];
col[i * 3 + 2] = LUT[b];
pos[i * 3 + 2] = k ? (((0.299 * r + 0.587 * g + 0.114 * b) / 255 - 0.5) * 2 * depth * k) : 0;
}
return;
}
const kc = A.key && A.keyTol > 0 ? [parseInt(A.key.slice(1, 3), 16), parseInt(A.key.slice(3, 5), 16), parseInt(A.key.slice(5, 7), 16)] : null;
const lum = new Float32Array(n);
const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const lv = A.post >= 2 ? A.post - 1 : 0;
const out = this._adjBuf && this._adjBuf.length === n * 3 ? this._adjBuf : (this._adjBuf = new Uint8Array(n * 3));
for (let i = 0; i < n; i++) {
let r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
if (A.invert) {
r = 255 - r;
g = 255 - g;
b = 255 - b;
}
if (A.contrast !== 1) {
r = cl((r - 128) * A.contrast + 128);
g = cl((g - 128) * A.contrast + 128);
b = cl((b - 128) * A.contrast + 128);
}
if (A.sat !== 1) {
const l = 0.299 * r + 0.587 * g + 0.114 * b;
r = cl(l + (r - l) * A.sat);
g = cl(l + (g - l) * A.sat);
b = cl(l + (b - l) * A.sat);
}
if (lv) {
r = Math.round((r / 255) * lv) * (255 / lv);
g = Math.round((g / 255) * lv) * (255 / lv);
b = Math.round((b / 255) * lv) * (255 / lv);
}
r = Math.round(r);
g = Math.round(g);
b = Math.round(b);
out[i * 3] = r;
out[i * 3 + 1] = g;
out[i * 3 + 2] = b;
lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
const cols = this.cols;
const rows = this.rows;
const dark = A.cutDark;
const light = A.cutLight;
const tol = A.keyTol * 441.67;
const edgeT = A.edges * 0.5;
for (let i = 0; i < n; i++) {
const r = out[i * 3], g = out[i * 3 + 1], b = out[i * 3 + 2];
col[i * 3] = LUT[r];
col[i * 3 + 1] = LUT[g];
col[i * 3 + 2] = LUT[b];
pos[i * 3 + 2] = k ? (lum[i] - 0.5) * 2 * depth * k : 0;
if (!hide) continue;
let h = lum[i] < dark || lum[i] > light;
if (!h && kc) h = Math.hypot(r - kc[0], g - kc[1], b - kc[2]) < tol;
if (!h && edgeT > 0) {
const x = i % cols, y = (i / cols) | 0;
const xl = x > 0 ? i - 1 : i, xr = x < cols - 1 ? i + 1 : i, yu = y > 0 ? i - cols : i, yd = y < rows - 1 ? i + cols : i;
const gx = lum[xr] - lum[xl], gy = lum[yd] - lum[yu];
h = Math.hypot(gx, gy) < edgeT * 0.5;
}
hide[i] = h ? 1 : 0;
}
}
async record({ fps = 15, seconds = 10, onProgress, cancel } = {}) {
if (this.kind !== 'video' || !this.el) throw new Error('Запись доступна для видео');
this.recording = true;
const v = this.el;
const wasPlaying = this.playing;
v.pause();
const total = Math.max(1, Math.floor(Math.min(v.duration, seconds) * fps));
const frames = [];
const prevView = this.view;
this.view = 'live';
try {
for (let i = 0; i < total; i++) {
if (cancel && cancel()) break;
v.currentTime = Math.min(v.duration - 0.001, i / fps);
await wait(v, 'seeked');
frames.push(this.sample());
onProgress && onProgress(i + 1, total);
if (i % 4 === 0) await new Promise((r) => setTimeout(r));
}
} finally {
this.recording = false;
this.view = prevView;
}
if (frames.length < 2) {
if (wasPlaying) this.play();
return null;
}
this.rec = { cols: this.cols, rows: this.rows, aspect: this.aspect, fps, frames };
this.view = 'rec';
this.t = 0;
this.playing = true;
this.dirty = true;
this._lastKey = -1;
return this.rec;
}
setView(v) {
if (v === 'rec' && !this.rec) return;
if (v === this.view) return;
this.view = v;
if (v === 'rec') {
this.cols = this.rec.cols;
this.rows = this.rec.rows;
this.aspect = this.rec.aspect;
this.t = 0;
if (this.el) this.el.pause();
} else if (this.el) this.el.play().catch(() => {});
this._xy = null;
this.dirty = true;
this._lastKey = -1;
}
toPCV() {
const r = this.rec;
const head = new TextEncoder().encode(JSON.stringify({ v: 1, cols: r.cols, rows: r.rows, aspect: r.aspect, fps: r.fps, frames: r.frames.length }));
const frameSize = r.cols * r.rows * 3;
const out = new Uint8Array(8 + head.length + frameSize * r.frames.length);
out.set([0x50, 0x43, 0x56, 0x31], 0);
new DataView(out.buffer).setUint32(4, head.length, true);
out.set(head, 8);
r.frames.forEach((f, i) => out.set(f, 8 + head.length + i * frameSize));
return new Blob([zlibSync(out, { level: 6 })], { type: 'application/octet-stream' });
}
framePLY(rgb, relief, depth) {
const n = this.cols * this.rows;
const xy = this._grid();
const k = relief === 'bright' ? 1 : relief === 'dark' ? -1 : 0;
const head = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`);
const out = new Uint8Array(head.length + n * 15);
out.set(head, 0);
const dv = new DataView(out.buffer);
let o = head.length;
for (let i = 0; i < n; i++, o += 15) {
const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
dv.setFloat32(o, xy[i * 2], true);
dv.setFloat32(o + 4, xy[i * 2 + 1], true);
dv.setFloat32(o + 8, k ? ((0.299 * r + 0.587 * g + 0.114 * b) / 255 - 0.5) * 2 * depth * k : 0, true);
out[o + 12] = r;
out[o + 13] = g;
out[o + 14] = b;
}
return out;
}
toPLYZip(relief, depth, maxFrames = 150) {
const r = this.rec;
const total = r.frames.length;
const step = Math.max(1, Math.ceil(total / maxFrames));
const files = {};
let k = 0;
const saved = [this.cols, this.rows, this.aspect, this._xy];
this.cols = r.cols;
this.rows = r.rows;
this.aspect = r.aspect;
this._xy = null;
for (let i = 0; i < total; i += step, k++) files[`frame_${String(k).padStart(4, '0')}.ply`] = [this.framePLY(r.frames[i], relief, depth), { level: 3 }];
[this.cols, this.rows, this.aspect, this._xy] = saved;
this._xy = null;
return { blob: new Blob([zipSync(files)], { type: 'application/zip' }), frames: k, step };
}
close() {
this.pause();
this._revoke();
this.kind = null;
this.el = null;
this.rec = null;
this.view = 'live';
this.cols = this.rows = 0;
this._xy = null;
this.name = '';
}
dispose() {
this.pause();
this._revoke();
}
}
function parsePCV(bytes) {
let raw;
try {
raw = unzlibSync(bytes);
} catch (e) {
throw new Error('Это не файл точечного видео');
}
if (raw[0] !== 0x50 || raw[1] !== 0x43 || raw[2] !== 0x56) throw new Error('Это не файл точечного видео');
const hl = new DataView(raw.buffer, raw.byteOffset).getUint32(4, true);
const head = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + hl)));
const size = head.cols * head.rows * 3;
const frames = [];
for (let i = 0; i < head.frames; i++) frames.push(raw.slice(8 + hl + i * size, 8 + hl + (i + 1) * size));
return { cols: head.cols, rows: head.rows, aspect: head.aspect, fps: head.fps, frames };
}
