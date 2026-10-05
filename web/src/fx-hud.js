import * as THREE from 'three';
const rnd = (a, b) => a + Math.random() * (b - a);
export class TrackerHud {
constructor(host) {
this.canvas = document.createElement('canvas');
this.canvas.className = 'fx-hud';
host.append(this.canvas);
this.ctx = this.canvas.getContext('2d');
this.items = [];
this.imprints = [];
this.time = 0;
this.t = 0;
this.beatSeen = 0;
this._v = new THREE.Vector3();
}
_fit() {
const c = this.canvas;
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const w = c.clientWidth;
const h = c.clientHeight;
if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
c.width = Math.round(w * dpr);
c.height = Math.round(h * dpr);
}
this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
return { w, h };
}
clear() {
const c = this.canvas;
this.ctx.setTransform(1, 0, 0, 1, 0, 0);
this.ctx.clearRect(0, 0, c.width, c.height);
}
dispose() {
this.canvas.remove();
}
_pick(geometry, morph) {
const o = geometry.attributes.aOrigin.array;
const t = geometry.attributes.aTarget.array;
const n = geometry.attributes.position.count;
const i = Math.floor(Math.random() * n) * 3;
const m = morph * morph * (3 - 2 * morph);
return new THREE.Vector3(o[i] + (t[i] - o[i]) * m, o[i + 1] + (t[i + 1] - o[i + 1]) * m, o[i + 2] + (t[i + 2] - o[i + 2]) * m);
}
_pickHotspot(geometry, morph, levels) {
const o = geometry.attributes.aOrigin.array;
const t = geometry.attributes.aTarget.array;
const n = geometry.attributes.position.count;
const m = morph * morph * (3 - 2 * morph);
let bestIdx = Math.floor(Math.random() * n);
let maxScore = -1;
const candidates = Math.min(12, n);
for (let s = 0; s < candidates; s++) {
const idx = Math.floor(Math.random() * n);
const i = idx * 3;
const pX = o[i] + (t[i] - o[i]) * m;
const pY = o[i + 1] + (t[i + 1] - o[i + 1]) * m;
const pZ = o[i + 2] + (t[i + 2] - o[i + 2]) * m;
const dist = Math.hypot(pX, pY, pZ);
const score = dist + (levels?.bass || 0) * Math.sin(pY * 4) + Math.random() * 0.4;
if (score > maxScore) {
maxScore = score;
bestIdx = idx;
}
}
const i = bestIdx * 3;
return new THREE.Vector3(o[i] + (t[i] - o[i]) * m, o[i + 1] + (t[i + 1] - o[i + 1]) * m, o[i + 2] + (t[i + 2] - o[i + 2]) * m);
}
update(want, geometry, morph, levels, dt) {
this.t += dt;
while (this.items.length < want) {
const p = this._pickHotspot(geometry, morph, levels);
this.items.push({ id: Math.floor(rnd(1, 99)), pos: p.clone(), target: p, next: this.t + rnd(0.8, 2.8), speed: 0, conf: rnd(0.85, 0.99), touch: 0 });
}
this.items.length = want;
while (this.imprints.length > 32 || (this.imprints[0] && this.time - this.imprints[0].t0 > 8)) this.imprints.shift();
const beatNew = levels.beat > 0.9 && this.beatSeen <= 0.9;
this.beatSeen = levels.beat;
for (const it of this.items) {
if (this.t > it.next || (beatNew && Math.random() < 0.35)) {
if (it.touch > 0.3) this.imprints.push({ pos: it.target.clone(), t0: this.time, s: it.touch });
it.target = this._pickHotspot(geometry, morph, levels);
it.next = this.t + rnd(1.0, 3.2);
it.id = Math.floor(rnd(1, 99));
it.conf = rnd(0.82, 0.99);
}
const before = it.pos.clone();
it.pos.lerp(it.target, 1 - Math.exp(-dt * 6.5));
it.speed += (it.pos.distanceTo(before) / Math.max(dt, 1e-3) - it.speed) * 0.2;
it.touch += (1 - Math.min(1, it.pos.distanceTo(it.target) * 2.5) - it.touch) * 0.15;
}
}
draw(cfg, alpha, info) {
this.drawTracking(cfg, alpha, info);
}
drawTracking(cfg, alpha, info) {
const { points, camera, levels, colors } = info;
const { w, h } = this._fit();
const ctx = this.ctx;
if (!points || alpha < 0.02) return;
const dpx = [];
for (const it of this.items.slice(0, Math.round(cfg.count))) {
const v = this._v.copy(it.pos);
points.localToWorld(v);
v.project(camera);
if (v.z > 1 || v.z < -1) continue;
dpx.push({ it, x: (v.x * 0.5 + 0.5) * w, y: (1 - (v.y * 0.5 + 0.5)) * h });
}
const [c0, c2] = colors;
const size = cfg.size * (1 + levels.bass * 0.25);
ctx.lineWidth = 1.25;
ctx.font = '11px Geist, "Geist Variable", system-ui, sans-serif';
ctx.textBaseline = 'top';
if (cfg.lines === 'on') {
ctx.setLineDash([3, 4]);
ctx.strokeStyle = rgba(c0, 0.45 * alpha);
for (let i = 0; i < dpx.length; i++) {
let best = -1;
let bd = 1e9;
for (let j = 0; j < dpx.length; j++) {
if (i === j) continue;
const d = (dpx[i].x - dpx[j].x) ** 2 + (dpx[i].y - dpx[j].y) ** 2;
if (d < bd) {
bd = d;
best = j;
}
}
if (best < 0) continue;
ctx.beginPath();
ctx.moveTo(dpx[i].x, dpx[i].y);
ctx.lineTo(dpx[best].x, dpx[best].y);
ctx.stroke();
}
ctx.setLineDash([]);
}
for (const { it, x, y } of dpx) {
const s = size * (0.8 + it.conf * 0.25);
const k = s * 0.28;
const x0 = x - s / 2;
const y0 = y - s / 2;
const x1 = x + s / 2;
const y1 = y + s / 2;
ctx.strokeStyle = rgba(c0, 0.95 * Math.min(1, alpha));
ctx.beginPath();
ctx.moveTo(x0, y0 + k); ctx.lineTo(x0, y0); ctx.lineTo(x0 + k, y0);
ctx.moveTo(x1 - k, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + k);
ctx.moveTo(x1, y1 - k); ctx.lineTo(x1, y1); ctx.lineTo(x1 - k, y1);
ctx.moveTo(x0 + k, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - k);
ctx.stroke();
ctx.fillStyle = rgba(c2, 0.9 * Math.min(1, alpha));
ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
if (cfg.labels === 'on') {
const tx = x1 + 8;
ctx.strokeStyle = rgba(c0, 0.5 * alpha);
ctx.beginPath();
ctx.moveTo(x1, y0);
ctx.lineTo(tx - 3, y0);
ctx.stroke();
ctx.fillStyle = rgba(c2, Math.min(1, alpha));
ctx.fillText(`HOTSPOT ${String(it.id).padStart(2, '0')}  ${Math.round(it.conf * 100)}%`, tx, y0 - 5);
ctx.fillStyle = rgba(c2, 0.75 * Math.min(1, alpha));
ctx.fillText(`X ${it.pos.x.toFixed(2)}  Y ${it.pos.y.toFixed(2)}`, tx, y0 + 8);
ctx.fillText(`V ${it.speed.toFixed(2)}  Z ${it.pos.z.toFixed(2)}`, tx, y0 + 21);
}
}
}
drawTelemetry(cfg, alpha, info) {
const { w, h } = this._fit();
const ctx = this.ctx;
if (alpha < 0.05) return;
const [c0, c2] = info.colors;
const timeSec = this.time || 0;
const min = Math.floor(timeSec / 60);
const sec = Math.floor(timeSec % 60);
const frame = Math.floor((timeSec % 1) * 30);
const tc = `TC ${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frame).padStart(2, '0')}`;
ctx.save();
ctx.font = '10px Geist, "Geist Variable", ui-monospace, monospace';
ctx.textBaseline = 'top';
const pad = 18;
const bSize = 14;
ctx.strokeStyle = rgba(c0, 0.45 * alpha);
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(pad, pad + bSize); ctx.lineTo(pad, pad); ctx.lineTo(pad + bSize, pad);
ctx.moveTo(w - pad - bSize, pad); ctx.lineTo(w - pad, pad); ctx.lineTo(w - pad, pad + bSize);
ctx.moveTo(pad, h - pad - bSize); ctx.lineTo(pad, h - pad); ctx.lineTo(pad + bSize, h - pad);
ctx.moveTo(w - pad - bSize, h - pad); ctx.lineTo(w - pad, h - pad); ctx.lineTo(w - pad, h - pad - bSize);
ctx.stroke();
ctx.fillStyle = rgba(c2, 0.85 * alpha);
const blink = Math.sin(timeSec * 4) > 0;
ctx.fillText(`${blink ? '●' : '○'} LIVE HUD   ${tc}`, pad + 6, pad + 6);
ctx.fillStyle = rgba(c0, 0.7 * alpha);
ctx.fillText(`SYS: TOUCH-POP  FREQ: 60Hz`, pad + 6, pad + 20);
const rw = 90;
const rx = w - pad - rw - 6;
const ry = pad + 6;
const lvls = [
{ name: 'BASS', val: info.levels?.bass || 0 },
{ name: 'MID ', val: info.levels?.mid || 0 },
{ name: 'HIGH', val: info.levels?.high || 0 },
];
lvls.forEach((l, i) => {
const y = ry + i * 12;
ctx.fillStyle = rgba(c2, 0.7 * alpha);
ctx.fillText(l.name, rx, y);
ctx.strokeStyle = rgba(c0, 0.3 * alpha);
ctx.strokeRect(rx + 32, y + 2, 54, 7);
ctx.fillStyle = rgba(c0, 0.85 * alpha);
ctx.fillRect(rx + 33, y + 3, Math.max(0, Math.min(52, l.val * 52)), 5);
});
if (cfg.audioWave !== 'off' && info.spec && info.spec.length) {
const ow = Math.min(360, w - pad * 4);
const ox = (w - ow) / 2;
const oy = h - pad - 12;
ctx.strokeStyle = rgba(c0, 0.6 * alpha);
ctx.lineWidth = 1.2;
ctx.beginPath();
for (let i = 0; i < info.spec.length; i++) {
const sx = ox + (i / (info.spec.length - 1)) * ow;
const sy = oy - (info.spec[i] || 0) * 28;
if (i === 0) ctx.moveTo(sx, sy);
else ctx.lineTo(sx, sy);
}
ctx.stroke();
ctx.fillStyle = rgba(c2, 0.5 * alpha);
ctx.fillText('SPECTRUM ANALYSIS // 64 BANDS', ox, oy + 4);
}
ctx.restore();
}
}
function rgba(hex, a) {
const n = parseInt(hex.slice(1), 16);
return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}
