import { downloadBlob } from '../../core/util.js';
import { adjustDepth, depthToGrid, grabFrame, grabRGB as grabRGB4, lumaDepth, normalizeDepth } from '../input/depth-ai.js';
export class DepthPart {
onDepthChange(fn) {
this._dListeners.add(fn);
return () => this._dListeners.delete(fn);
}
_depthEmit() {
for (const f of this._dListeners) f();
}
depthInfo() {
const ai = this.depthAI;
const D = this._D;
const L = this.state.layers.depth;
return { media: !!this.pm.ready, video: this.pm.kind === 'video', src: L.src, phase: ai.phase, prog: ai.prog, device: ai.device, error: ai.error || D.err, hasMap: !!D.map, aiMap: !!D.map && D.mapSrc === 'ai', busy: D.busy };
}
drawDepthMap(cv, plain = false) {
const m = this._D.proc || this._D.map;
if (!m) return;
if (cv.width !== m.w || cv.height !== m.h) {
cv.width = m.w;
cv.height = m.h;
}
const g = cv.getContext('2d');
const id = g.createImageData(m.w, m.h);
for (let i = 0; i < m.data.length; i++) {
const v = Math.round(m.data[i] * 255);
id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
id.data[i * 4 + 3] = 255;
}
const L = this.state.layers.depth;
const fc = L.focus ?? 0.5, zw = L.zone ?? 0.12;
for (let i = 0; i < m.data.length && !plain; i++) {
if (Math.abs(m.data[i] - fc) <= zw) {
id.data[i * 4] = Math.min(255, id.data[i * 4] * 0.5 + 130);
id.data[i * 4 + 1] = id.data[i * 4 + 1] * 0.55 + 55;
id.data[i * 4 + 2] = id.data[i * 4 + 2] * 0.3;
}
}
g.putImageData(id, 0, 0);
}
buildDepth() {
const D = this._D;
D.force = true;
D.err = '';
if (this.depthAI.phase === 'error') this.depthAI.dispose();
this.depthAI.init().catch(() => {});
this._depthEmit();
}
saveDepthMap() {
const m = this._D.map;
if (!m) return;
const cv = document.createElement('canvas');
this.drawDepthMap(cv, true);
cv.toBlob((b) => b && downloadBlob(b, 'depth-map.png'), 'image/png');
}
_depthTick(dt, rgb) {
const L = this.state.layers.depth;
const D = this._D;
const pm = this.pm;
const g = this.geometry;
const n = pm.count;
const key = pm.rec || pm.el;
if (D.key !== key) {
Object.assign(D, { key, map: null, mapSrc: '', aiHas: false, st: {}, tgt: null, busy: false, rgb: null, rgbN: 0, lumaN: -1, reqT: -1e9, err: '' });
this._depthEmit();
}
if (rgb) {
D.rgb = rgb;
D.rgbN++;
}
if (!L.on) return;
const ai = L.src === 'ai';
if (D.rgb && D.lumaN !== D.rgbN && (!ai || !D.aiHas)) {
D.lumaN = D.rgbN;
D.map = lumaDepth(D.rgb, pm.cols, pm.rows);
D.mapSrc = 'luma';
D.dirty = true;
this._depthEmit();
}
if (!ai && D.aiHas) {
D.aiHas = false;
D.lumaN = -1;
}
if (ai && !D.busy && this.depthAI.phase !== 'error') {
const el = pm.isRec ? null : pm.el;
const vt = pm.isRec ? pm.t : el.currentTime || 0;
const ready = pm.isRec ? !!D.rgb : el && (pm.kind === 'image' || el.readyState >= 2);
const need = D.force || !D.aiHas || (pm.kind === 'video' && Math.abs(vt - D.reqT) > 0.03);
if (ready && need) {
D.busy = true;
D.force = false;
D.reqT = vt;
const cpu = this.depthAI.device === 'wasm';
const side = pm.kind === 'video' ? (cpu ? 280 : 448) : cpu ? 420 : 640;
const frame = pm.isRec ? grabRGB4(D.rgb, pm.cols, pm.rows) : grabFrame(el, side);
if (!frame) D.busy = false;
else {
this.depthAI
.estimate(frame)
.then((r) => {
if (D.key !== key) return;
D.map = { w: r.w, h: r.h, data: normalizeDepth(r.data, D.st, pm.kind === 'video' ? 0.35 : 0) };
D.mapSrc = 'ai';
D.aiHas = true;
D.dirty = true;
D.err = '';
})
.catch((e) => {
D.err = e.message || String(e);
})
.finally(() => {
D.busy = false;
this._depthEmit();
});
this._depthEmit();
}
}
}
const P = [L.bright ?? 0, L.contrast ?? 1, L.gamma ?? 1, L.blur ?? 0].join('|');
if (D.map && (D.dirty || D.pSig !== P || !D.proc)) {
D.proc = adjustDepth(D.map, { bright: L.bright, contrast: L.contrast, gamma: L.gamma, blur: L.blur });
D.pSig = P;
D.dirty = true;
this._depthEmit();
}
const TS = (L.focus ?? 0.5) + '|' + (L.zone ?? 0.12);
if (D.tSig !== TS) {
D.tSig = TS;
this._depthEmit();
}
if (D.proc && (D.dirty || !D.tgt || D.tgt.length !== n)) {
if (!D.tgt || D.tgt.length !== n) {
D.tgt = new Float32Array(n);
D.snap = true;
}
depthToGrid(D.proc, pm.cols, pm.rows, D.tgt);
D.dirty = false;
D.moving = true;
}
const attr = g.attributes.aDepth;
if (!D.tgt || !attr || attr.array.length !== n) return;
const arr = attr.array;
if (D.geo !== g) {
D.geo = g;
D.snap = true;
}
let changed = false;
if (D.snap) {
arr.set(D.tgt);
D.snap = false;
D.moving = false;
changed = true;
} else if (D.moving) {
const rate = 1 - Math.exp(-dt * (2.5 + (1 - L.smooth) * 18));
const tg = D.tgt;
let mx = 0;
for (let i = 0; i < n; i++) {
const d = tg[i] - arr[i];
arr[i] += d * rate;
const a = d < 0 ? -d : d;
if (a > mx) mx = a;
}
if (mx < 0.002) D.moving = false;
changed = true;
}
if (changed) {
attr.needsUpdate = true;
if (this.state.layers.links.on && (D._lk = ((D._lk || 0) + 1) % 5) === 0) this._syncLinks();
}
}
}
