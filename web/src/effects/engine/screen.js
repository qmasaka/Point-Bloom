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
this._scrFile?.dispose();
if (file.type.startsWith('image/')) {
const img = new Image();
img.onload = () => {
const tex = this._screenTex(img, false);
this._scrFile = { el: { videoWidth: img.naturalWidth, videoHeight: img.naturalHeight }, media: img, tex, dispose: () => { tex.dispose(); URL.revokeObjectURL(url); } };
this._scrName = file.name;
this.state.layers.vscreen.source = 'file';
this.app.toast('Для «Экрана» выбрано: ' + file.name, 'ok', 2200);
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
}
