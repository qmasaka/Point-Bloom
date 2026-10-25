import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { grabFrame, loadDepthImage, normalizeDepth, pickImageFile } from '../input/depth-ai.js';
export class ScreenPart {
_screenSource() {
const L = this.state.layers.vscreen;
if (L.source === 'file') {
const f = this._scrFile;
if (!f || !f.el.videoWidth) return null;
return { tex: f.tex, ar: f.el.videoWidth / f.el.videoHeight, media: f.media };
}
const pm = this.pm;
if (!pm || !pm.ready || !pm.el) return null;
const el = pm.el;
const isVideo = el.tagName === 'VIDEO';
const w = isVideo ? el.videoWidth : el.naturalWidth || el.width;
const h = isVideo ? el.videoHeight : el.naturalHeight || el.height;
if (!w || !h) return null;
if (!this._scrCur || this._scrCur.el !== el) {
this._scrCur?.tex.dispose();
this._scrCur = { el, tex: this._screenTex(el, isVideo) };
}
return { tex: this._scrCur.tex, ar: w / h, media: el };
}
_screenTex(el, isVideo) {
const t = isVideo ? new THREE.VideoTexture(el) : new THREE.Texture(el);
t.colorSpace = THREE.SRGBColorSpace;
t.minFilter = t.magFilter = THREE.LinearFilter;
t.generateMipmaps = false;
t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
if (!isVideo) t.needsUpdate = true;
return t;
}
screenPick() {
const inp = document.createElement('input');
inp.type = 'file';
inp.accept = 'video/*,image/*';
inp.addEventListener('change', () => {
const f = inp.files && inp.files[0];
if (f) this.screenLoad(f);
});
inp.click();
}
screenLoad(file) {
const url = URL.createObjectURL(file);
const hadAudio = this.sourceType === 'video' && this._vidEl && this._vidEl === this._scrFile?.media;
if (hadAudio) this._disconnectVideo();
this._scrFile?.dispose();
if (file.type.startsWith('image/')) {
const img = new Image();
img.onload = () => {
const tex = this._screenTex(img, false);
this._scrFile = { el: { videoWidth: img.naturalWidth, videoHeight: img.naturalHeight }, media: img, tex, dispose: () => { tex.dispose(); URL.revokeObjectURL(url); } };
this._scrName = file.name;
this.state.layers.vscreen.source = 'file';
this.app.toast('Для «Экрана» выбрано: ' + file.name, 'ok', 2200);
if (hadAudio) {
this._vidEl = null;
if (this.pm.kind === 'video') this.useVideoAudio().catch(() => {});
}
this.app.viewport.invalidate();
this.emit();
};
img.src = url;
return;
}
const v = document.createElement('video');
v.muted = true;
v.loop = true;
v.playsInline = true;
v.preload = 'auto';
v.src = url;
v.addEventListener('loadeddata', () => {
const tex = this._screenTex(v, true);
this._scrFile = { el: v, media: v, tex, dispose: () => { v.pause(); tex.dispose(); URL.revokeObjectURL(url); } };
this._scrName = file.name;
this.state.layers.vscreen.source = 'file';
v.play().catch(() => {});
if (hadAudio) this.useVideoAudio(v).catch(() => {});
this.app.toast('Для «Экрана» выбрано: ' + file.name, 'ok', 2200);
this.app.viewport.invalidate();
this.emit();
});
}
_screenTick(u) {
const L = this.state.layers.vscreen;
const eff = L.on ? clamp(this._eff(L), 0, 2) : 0;
const src = eff > 0.001 ? this._screenSource() : null;
if (!src) {
u.uScr.value.x = 0;
u.uScrQ.value.y = 0;
return;
}
if (u.uScrTex.value !== src.tex) u.uScrTex.value = src.tex;
if (L.mode === 'relief') {
L.mode = 'stick';
if (!L.dsrc || L.dsrc === 'off') L.dsrc = 'bright';
}
const mode = { wrap: 0, stick: 1, project: 2 }[L.mode] ?? 1;
u.uScr.value.set(Math.min(eff, 1), mode, Math.max(0.1, L.scale), L.bright);
u.uScrP.value.set((L.rotate * Math.PI) / 180, L.depth, L.mix, src.ar);
const ds = L.dsrc || 'off';
const hasMap = ds !== 'off' && ds !== 'bright' && this._screenDepth(ds, src.media);
u.uScrD.value.set(ds === 'off' ? 0 : hasMap ? 2 : 1, L.depth ?? 0.5, L.dinv === 'far' ? -1 : 1, L.dcon ?? 1);
u.uScrQ.value.set(L.dshow === 'map' && ds !== 'off' ? 1 : 0, 0, 0, 0);
if (hasMap && u.uScrDep.value !== this._scrDepTex) u.uScrDep.value = this._scrDepTex;
u.uScrQ.value.y = this._screenMemTick(L, src) ? 1 : 0;
if (this._scrFile && L.source === 'file' && this._scrFile.el.paused && this._scrFile.el.play) this._scrFile.el.play().catch(() => {});
}
_screenDepth(ds, el) {
const S = (this._scrD ||= { busy: false, key: null, t: -1, cur: '', st: {} });
if (ds === 'file') {
const f = this._scrDepFile;
if (!f) return false;
if (S.cur !== 'file' + f.id) {
S.cur = 'file' + f.id;
this._scrDepWrite(f);
}
return true;
}
if (S.cur.startsWith('file')) {
S.cur = '';
S.key = null;
}
if (el && !S.busy && this.depthAI.phase !== 'error') {
const isVid = el.tagName === 'VIDEO';
const t = isVid ? el.currentTime : 0;
if ((S.key !== el || (isVid && Math.abs(t - S.t) > 0.04)) && (!isVid || el.readyState >= 2)) {
const cpu = this.depthAI.device === 'wasm';
const img = grabFrame(el, isVid ? (cpu ? 280 : 448) : cpu ? 420 : 640);
if (img) {
if (S.key !== el) S.st = {};
S.busy = true;
S.key = el;
S.t = t;
if (this.depthAI.phase !== 'ready' && !S.told) {
S.told = true;
this.app.toast('Загружаю нейросеть глубины для «Экрана» (один раз, около 50 МБ)', 'info', 3000);
}
this.depthAI
.estimate(img)
.then((r) => {
if (this.state.layers.vscreen.dsrc !== 'ai') return;
this._scrDepWrite({ w: r.w, h: r.h, data: normalizeDepth(r.data, S.st, isVid ? 0.35 : 0) });
S.cur = 'ai';
})
.catch((e) => {
if (!S.failed) this.app.toast('Нейросеть глубины не запустилась: ' + (e.message || e) + '. Работает объём по яркости', 'warn');
S.failed = true;
})
.finally(() => (S.busy = false));
}
}
}
return S.cur === 'ai' && !!this._scrDepTex;
}
_scrDepWrite(m) {
let t = this._scrDepTex;
if (!t || t.image.width !== m.w || t.image.height !== m.h) {
t?.dispose();
t = this._scrDepTex = new THREE.DataTexture(new Uint8Array(m.w * m.h), m.w, m.h, THREE.RedFormat, THREE.UnsignedByteType);
t.minFilter = t.magFilter = THREE.LinearFilter;
t.generateMipmaps = false;
t.unpackAlignment = 1;
}
const d = t.image.data;
for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) d[(m.h - 1 - y) * m.w + x] = (Math.min(1, Math.max(0, m.data[y * m.w + x])) * 255 + 0.5) | 0;
t.needsUpdate = true;
}
async screenAudio() {
const L = this.state.layers.vscreen;
const el = L.source === 'file' ? this._scrFile?.media : this.pm.ready ? this.pm.el : null;
if (!el || el.tagName !== 'VIDEO') {
this.app.toast(L.source === 'file' ? 'Сначала выберите видео для «Экрана»' : 'Откройте видео в «Медиа» или выберите своё видео для «Экрана»', 'info');
return;
}
try {
await this.useVideoAudio(el);
this.app.toast('Эффекты слушают звук видео «Экрана»', 'ok', 2200);
} catch (e) {
this.app.toast('Не удалось взять звук из видео: ' + (e.message || e), 'error');
}
this.emit();
}
async screenDepthPick() {
const f = await pickImageFile();
if (!f) return;
try {
this._scrDepFile = { ...(await loadDepthImage(f)), id: (this._scrDepFile?.id || 0) + 1 };
this.state.layers.vscreen.dsrc = 'file';
this.app.toast('Карта глубины для «Экрана»: ' + f.name, 'ok', 2200);
} catch (e) {
this.app.toast('Не удалось открыть карту глубины: ' + (e.message || e), 'error');
}
this.emit();
}
_screenMemTick(L, src) {
const T = L.mem || 0;
const g = this.geometry;
if (T <= 0.01 || !g || !src.media || (L.dshow === 'map' && L.dsrc && L.dsrc !== 'off')) return false;
const n = g.attributes.position.count;
let tex = this._scrMTex;
if (!tex || tex.userData.n !== n) {
tex?.dispose();
const W = 2048, H = Math.ceil(n / W);
tex = this._scrMTex = new THREE.DataTexture(new Uint8Array(W * H * 4), W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
tex.minFilter = tex.magFilter = THREE.NearestFilter;
tex.generateMipmaps = false;
tex.userData.n = n;
this._scrMF = new Float32Array(n * 4);
this._scrM = null;
}
if (this.shared.uScrMTex.value !== tex) this.shared.uScrMTex.value = tex;
this.shared.uScrMN.value = n;
const M = (this._scrM ||= { ptr: 0, tGrab: -1, frame: null, chunkT: new Float64Array(Math.ceil(n / 200000)).fill(this._time) });
if (this._time - M.tGrab > 1 / 30) {
M.tGrab = this._time;
M.frame = grabFrame(src.media, 160);
}
const f = M.frame;
if (!f) return true;
const CH = 200000;
const c = Math.floor(M.ptr / CH);
const i0 = c * CH;
const i1 = Math.min(n, i0 + CH);
const dtc = Math.max(0, this._time - M.chunkT[c]);
M.chunkT[c] = this._time;
M.ptr = i1 >= n ? 0 : i1;
const k = Math.exp(-dtc / T);
const P = this.shared;
const cen = P.uCen.value;
const y0 = P.uYR.value.x;
const hy = Math.max(P.uYR.value.y - y0, 1e-4);
const ym = (P.uYR.value.x + P.uYR.value.y) * 0.5;
const ar = Math.max(src.ar, 0.05);
const sc = Math.max(0.1, L.scale);
const rot = (L.rotate * Math.PI) / 180;
const cr = Math.cos(rot), sr = Math.sin(rot);
const mode = L.mode;
const bright = L.bright;
const T3 = g.attributes.aTarget.array;
const N3 = g.attributes.aNormal.array;
const m = this._scrMF;
const out = tex.image.data;
let mvp = null, scrAsp = 1;
if (mode === 'project') {
const cam = this.app.viewport.camera;
mvp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(this.points.matrixWorld).elements;
scrAsp = cam.projectionMatrix.elements[5] / cam.projectionMatrix.elements[0];
}
const LUT = (this._scrLUT ||= Float32Array.from({ length: 256 }, (_, i) => {
const v = i / 255;
return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}));
const fw = f.w, fh = f.h, fd = f.data;
for (let i = i0; i < i1; i++) {
const o = i * 4;
m[o] *= k;
m[o + 1] *= k;
m[o + 2] *= k;
m[o + 3] *= k;
const bx = T3[i * 3] - cen.x, by = T3[i * 3 + 1], bz = T3[i * 3 + 2] - cen.z;
let u, v;
if (mode === 'wrap') {
u = Math.atan2(bz, bx) / (Math.PI * 2) + 0.5;
v = (by - y0) / hy;
u = (u - 0.5) / sc + 0.5;
u -= Math.floor(u);
} else {
let x, y;
if (mode === 'project') {
const px = T3[i * 3], py = T3[i * 3 + 1], pz = T3[i * 3 + 2];
const w = mvp[3] * px + mvp[7] * py + mvp[11] * pz + mvp[15];
if (w <= 1e-4) continue;
x = (((mvp[0] * px + mvp[4] * py + mvp[8] * pz + mvp[12]) / w) * 0.5 * scrAsp) / ar;
y = ((mvp[1] * px + mvp[5] * py + mvp[9] * pz + mvp[13]) / w) * 0.5;
} else {
if (N3[i * 3 + 2] < -0.05) continue;
x = bx / (hy * ar);
y = (by - ym) / hy;
}
x /= sc;
y /= sc;
u = cr * x - sr * y + 0.5;
v = sr * x + cr * y + 0.5;
if (u < 0 || u > 1 || v < 0 || v > 1) continue;
}
const px = Math.min(fw - 1, (u * fw) | 0);
const py = Math.min(fh - 1, ((1 - Math.min(1, Math.max(0, v))) * fh) | 0);
const q = (py * fw + px) * 4;
const r = LUT[fd[q]] * bright, gg = LUT[fd[q + 1]] * bright, b = LUT[fd[q + 2]] * bright;
if (r > m[o]) m[o] = r;
if (gg > m[o + 1]) m[o + 1] = gg;
if (b > m[o + 2]) m[o + 2] = b;
m[o + 3] = 1;
}
for (let o = i0 * 4, e = i1 * 4; o < e; o += 4) {
out[o] = Math.min(255, Math.sqrt(m[o] * 0.25) * 255 + 0.5);
out[o + 1] = Math.min(255, Math.sqrt(m[o + 1] * 0.25) * 255 + 0.5);
out[o + 2] = Math.min(255, Math.sqrt(m[o + 2] * 0.25) * 255 + 0.5);
out[o + 3] = Math.min(255, m[o + 3] * 255 + 0.5);
}
tex.needsUpdate = true;
const dd = tex.userData.dirty;
tex.userData.dirty = dd ? [Math.min(dd[0], i0), Math.max(dd[1], i1)] : [i0, i1];
return true;
}
}
