import * as THREE from 'three';
import { clamp } from '../../core/util.js';
export class ScreenPart {
_screenSource() {
const L = this.state.layers.vscreen;
if (L.source === 'file') {
const f = this._scrFile;
if (!f || !f.el.videoWidth) return null;
return { tex: f.tex, ar: f.el.videoWidth / f.el.videoHeight };
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
return { tex: this._scrCur.tex, ar: w / h };
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
this._scrFile = { el: { videoWidth: img.naturalWidth, videoHeight: img.naturalHeight }, tex, dispose: () => { tex.dispose(); URL.revokeObjectURL(url); } };
this._scrName = file.name;
this.state.layers.vscreen.source = 'file';
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
this._scrFile = { el: v, tex, dispose: () => { v.pause(); tex.dispose(); URL.revokeObjectURL(url); } };
this._scrName = file.name;
this.state.layers.vscreen.source = 'file';
v.play().catch(() => {});
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
const mode = { wrap: 0, stick: 1, project: 2, relief: 3 }[L.mode] ?? 1;
u.uScr.value.set(Math.min(eff, 1), mode, Math.max(0.1, L.scale), L.bright);
u.uScrP.value.set((L.rotate * Math.PI) / 180, L.depth, L.mix, src.ar);
if (this._scrFile && L.source === 'file' && this._scrFile.el.paused && this._scrFile.el.play) this._scrFile.el.play().catch(() => {});
}
}
