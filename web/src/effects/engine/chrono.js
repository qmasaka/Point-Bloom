import { lumaDepth } from '../input/depth-ai.js';
import { SEG_CLASSES, SubjectSegmenter, dilateMask, erodeMask } from '../input/segmenter.js';
export class ChronoPart {
_frP() {
const L = this.state.layers;
const C = L.chrono;
if (!C || !C.on) return L.frames;
const F = (this._chronoF ||= {});
Object.assign(F, {
on: true,
chrono: true,
amount: 1,
layout: 'chrono',
all: 'off',
frames: Math.round(C.count),
budget: C.budget,
depth: 1.6,
source: 'live',
step: Math.max(0.02, C.every),
thin: 0,
showMode: 'chrono',
showLen: 0.12,
hero: C.hero,
future: 'hide',
gain: 1,
sat: 0,
bsize: C.size,
track: 'grow',
tone: 'all',
toneCut: 0.5,
tail: 100,
tailSoft: 0.6,
dkeep: C.dkeep,
follow: 'off',
});
return F;
}
_chronoExclusive() {
const L = this.state.layers;
const C = L.chrono;
if (!C) return;
const p = (this._chronoPrev ||= { c: !!C.on, f: !!L.frames.on });
if (C.on && L.frames.on) {
if (!p.f) C.on = false;
else L.frames.on = false;
this.emit();
}
if (C.on && !p.c) {
this.state.look.autoRotate = false;
if (this.points) this.points.rotation.set(0, 0, 0);
const D = L.depth;
if (D && !D.on) {
D.on = true;
D.amount = Math.max(D.amount || 0, 0.6);
}
this._chronoX = 0;
if (C.mask === 'person' || C.mask === 'any') this._segInit();
this.emit();
}
p.c = !!C.on;
p.f = !!L.frames.on;
}
_segInit() {
if (!this.segmenter) {
this.segmenter = new SubjectSegmenter();
this.segmenter.onChange = () => this.emit();
}
if (this.segmenter.phase === 'idle') this.segmenter.init().catch(() => {});
}
chronoInfo() {
const C = this.state.layers.chrono;
const s = this.segmenter;
return { video: this.videoLoaded, mask: C?.mask, phase: s ? s.phase : 'idle', error: s?.error || '' };
}
chronoReset() {
const fr = this._frames;
if (fr && fr.chrono) {
fr.valid = 1;
fr.bgL = null;
}
this._chronoX = 0;
}
_chronoMask(fr, k) {
const C = this.state.layers.chrono;
const per = fr.cols * fr.rows;
fr.mask ||= new Uint8Array(fr.n * per);
const dst = fr.mask.subarray(k * per, (k + 1) * per);
if (C.mask === 'depth') return;
let m = null;
if (C.mask === 'person' || C.mask === 'any') {
this._segInit();
if (this.segmenter.ready) m = this.segmenter.mask(this.pm.el, fr.cols, fr.rows, SEG_CLASSES[C.mask]);
}
if (!m) m = this._chronoMotion(fr, k, C);
dst.set(dilateMask(dilateMask(erodeMask(m, fr.cols, fr.rows), fr.cols, fr.rows), fr.cols, fr.rows));
}
_chronoMotion(fr, k, C) {
const per = fr.cols * fr.rows;
const f = fr.frames[k];
const l = lumaDepth(f, fr.cols, fr.rows, 4).data;
const out = new Uint8Array(per);
if (!fr.bgL || fr.bgL.length !== per) {
fr.bgL = new Float32Array(l);
return out;
}
const thr = 0.025 + (1 - (C.sens ?? 0.5)) * 0.16;
const bg = fr.bgL;
for (let i = 0; i < per; i++) {
const d = Math.abs(l[i] - bg[i]);
out[i] = d > thr ? 1 : 0;
bg[i] += (l[i] - bg[i]) * (out[i] ? 0.01 : 0.08);
}
return out;
}
_chronoAlpha(fr, k, d) {
const C = this.state.layers.chrono;
const per = fr.cols * fr.rows;
const f = fr.frames[k];
const m = fr.mask ? fr.mask.subarray(k * per, (k + 1) * per) : null;
const cut = 0.35 + (1 - (C.sens ?? 0.5)) * 0.45;
for (let i = 0; i < per; i++) {
const subj = C.mask === 'depth' ? d[i] >= cut : m ? m[i] === 1 : true;
f[i * 4 + 3] = (subj ? 128 : 0) + Math.min(127, (d[i] * 127 + 0.5) | 0);
}
}
_chronoUniforms(F, fr) {
const u = this.shared;
const C = this.state.layers.chrono;
if (!F.chrono || !C) {
u.uFr8.value.x = 0;
return;
}
const sp = (C.drift || 0) * F.step;
const dir = C.dir === 'right' ? [-1, 0] : C.dir === 'up' ? [0, -1] : [1, 0];
const live = { full: 1, dim: 2, hide: 3 }[C.live] ?? 1;
u.uFr8.value.set(live, dir[0] * sp, dir[1] * sp, C.bgKeep ?? 0);
u.uFr9.value.set(C.tint ?? 0.15, C.fade ?? 0.5, (C.depthZ ?? 0.03), Math.min(fr.n, fr.valid || 1));
u.uFr5.value.y = C.thin ?? 0.15;
u.uFr7.value.x = 1;
const pts = this.points;
if (!pts) return;
if (C.follow === 'off') {
const span = 3.2;
if (this.pm?.playing) this._chronoX = (this._chronoX || 0) + (C.drift || 0) * (this._lastDt || 0);
if (this._chronoX > span) this._chronoX -= 2 * span;
const x = (this._chronoX || 0) - span * 0.5;
pts.position.set(-dir[0] * x, -dir[1] * x, 0);
pts.updateMatrixWorld();
this._chronoMoved = true;
} else if (this._chronoMoved) {
pts.position.set(0, 0, 0);
pts.updateMatrixWorld();
this._chronoMoved = false;
}
}
}
