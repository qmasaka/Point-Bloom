import { dilateMask, dropSpecks } from '../input/segmenter.js';
const STEP = 4;
const PERIOD = 0.09;
export class MaterialVideo {
constructor() {
this.canvas = document.createElement('canvas');
this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
this.version = 0;
}
read(el, now, motion = true) {
if (!el || !this.ctx) return null;
const sw = el.videoWidth || el.naturalWidth || el.width;
const sh = el.videoHeight || el.naturalHeight || el.height;
if (!sw || !sh || (el.tagName === 'VIDEO' && el.readyState < 2)) return null;
const time = el.currentTime || 0;
if (this.el === el && (Math.abs(time - this.time) < 1e-4 || now - this.now < PERIOD)) return null;
const reset = this.el !== el || Math.abs(time - this.time) > 0.45 || time < this.time;
if (this.el !== el) {
this.feedId = Symbol();
const scale = 96 / Math.max(sw, sh);
this.w = this.canvas.width = Math.max(8, Math.round(sw * scale));
this.h = this.canvas.height = Math.max(8, Math.round(sh * scale));
this.aspect = sw / sh;
}
const { w, h } = this;
let rgba;
try {
this.ctx.drawImage(el, 0, 0, w, h);
rgba = this.ctx.getImageData(0, 0, w, h).data;
} catch {
return null;
}
const gray = new Float32Array(w * h);
for (let i = 0; i < gray.length; i++) {
const j = i * 4;
gray[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) / 255;
}
this.delta = reset ? PERIOD : Math.max(1 / 120, time - this.time);
this.el = el;
this.time = time;
this.now = now;
this.rgba = rgba;
this.version++;
if (motion) {
if (reset || !this.gray) {
this.background = gray.slice();
this.patches = [];
this.mask = null;
} else {
this.patches = patchMotion(gray, this.gray, w, h, this.patches, PERIOD / this.delta);
this.mask = motionMask(gray, this.gray, this.background, w, h);
}
}
this.gray = gray;
return this;
}
pixel(u, v) {
return Math.min(this.h - 1, Math.max(0, Math.floor(v * this.h))) * this.w
+ Math.min(this.w - 1, Math.max(0, Math.floor(u * this.w)));
}
}
function patchMotion(cur, prev, w, h, old, rate) {
const edge = 8;
const cols = Math.max(0, Math.ceil((w - 2 * edge) / STEP));
const rows = Math.max(0, Math.ceil((h - 2 * edge) / STEP));
const patches = [];
for (let iy = 0; iy < rows; iy++) for (let ix = 0; ix < cols; ix++) {
const x = edge + ix * STEP, y = edge + iy * STEP;
const i = y * w + x;
const patch = { x, y, dx: 0, dy: 0, vx: 0, vy: 0, ax: 0, ay: 0, energy: 0, life: 0 };
patches.push(patch);
let mn = 1, mx = 0, stationary = 0;
for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
const j = i + oy * w + ox;
mn = Math.min(mn, cur[j]);
mx = Math.max(mx, cur[j]);
stationary += Math.abs(cur[j] - prev[j]);
}
if (mx - mn < 0.05 || stationary < 0.095) continue;
let best = stationary, bx = 0, by = 0;
for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
const shift = dy * w + dx;
let err = 0.012 * Math.hypot(dx, dy);
for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
const j = i + oy * w + ox;
err += Math.abs(cur[j] - prev[j + shift]);
}
if (err < best - 0.0001) {
best = err;
bx = dx;
by = dy;
}
}
if ((!bx && !by) || best > 1.8 || (stationary - best) / stationary < 0.18) continue;
const oldX = Math.round(ix + bx / STEP), oldY = Math.round(iy + by / STEP);
const q = oldX >= 0 && oldX < cols && oldY >= 0 && oldY < rows ? old[oldY * cols + oldX] : null;
const dx = -bx * rate, dy = -by * rate;
patch.dx = dx;
patch.dy = dy;
patch.vx = q?.life ? q.vx * 0.58 + dx * 0.42 : dx;
patch.vy = q?.life ? q.vy * 0.58 + dy * 0.42 : dy;
patch.ax = q?.life ? q.ax * 0.55 + (dx - q.vx) * 0.45 : 0;
patch.ay = q?.life ? q.ay * 0.55 + (dy - q.vy) * 0.45 : 0;
patch.energy = q?.life ? q.energy * 0.64 + Math.hypot(dx, dy) * 0.36 : Math.hypot(dx, dy);
patch.life = Math.min(12, (q?.life || 0) + 1);
}
return patches;
}
function motionMask(gray, prev, background, w, h) {
const mask = new Uint8Array(gray.length);
let exposureShift = 0, active = 0, foreground = 0;
for (let i = 0; i < gray.length; i++) exposureShift += gray[i] - prev[i];
exposureShift /= gray.length;
for (let i = 0; i < gray.length; i++) {
const change = gray[i] - background[i];
active += Math.abs(gray[i] - prev[i] - exposureShift) > 0.052 ? 1 : 0;
mask[i] = Math.abs(change) > 0.105 ? 1 : 0;
foreground += mask[i];
background[i] += change * (mask[i] ? 0.045 : 0.24);
}
if (foreground > gray.length * 0.52 || Math.abs(exposureShift) > 0.13) {
background.set(gray);
return null;
}
if (active < 4 || foreground < 9) return null;
return dilateMask(dropSpecks(mask, w, h, Math.max(6, Math.round(gray.length * 0.0016))), w, h);
}
