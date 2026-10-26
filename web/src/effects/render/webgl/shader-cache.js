import * as THREE from 'three';
import { waitPrograms } from './programs.js';
import { FX_GUARDS, specializeFx } from './specialize.js';
import { frag } from '../../shaders/glsl/frag.js';
import { shadowFrag } from '../../shaders/glsl/shadow-frag.js';
import { lineFrag } from '../../shaders/glsl/line-frag.js';
import { lineVert } from '../../shaders/glsl/line-vert.js';
import { scopeFrag } from '../../shaders/glsl/scope-frag.js';
import { scopeVert } from '../../shaders/glsl/scope-vert.js';
import { vert } from '../../shaders/glsl/vert.js';
export class ShaderCachePart {
_fxSource(kind, on) {
const cache = this._fxCache || (this._fxCache = new Map());
const sig = [...on].sort().join(',');
const ck = kind + '|' + sig;
let v = cache.get(ck);
if (!v) {
const base = kind === 'line' ? lineVert : kind === 'scope' ? scopeVert : vert;
v = specializeFx(base, (name, comp, thr) => (FX_GUARDS.has(name + '.' + comp + '>' + thr) ? on.has(name + '.' + comp + '>' + thr) : undefined));
if (kind === 'vert') v = '#define VSCREEN 1\n#define VSHOOT 1\n' + v;
cache.set(ck, v);
}
return v;
}
_fxCheck() {
if (!this.shared || !this.points || this._glDormant) return;
if (this._fxBusy && !(this._fxBusy === 'drop' && !this._fxCovered(true))) return;
const cur = this._fxCur || (this._fxCur = new Set());
const now = performance.now();
const seen = this._fxSeen || (this._fxSeen = new Map());
let add = null;
for (const [key, [name, comp, thr]] of FX_GUARDS) {
const v = this.shared[name]?.value?.[comp];
const on = v > thr * 0.5;
if (on) seen.set(key, now);
if (on && !cur.has(key)) (add || (add = new Set())).add(key);
}
let stale = null;
for (const key of cur) if (now - (seen.get(key) || 0) > 20000) (stale || (stale = new Set())).add(key);
if (!add && !(stale && stale.size >= 2)) {
this._fxDeb = 0;
return;
}
if (!this._fxDeb) this._fxDeb = now;
if (now - this._fxDeb < 250) return;
this._fxDeb = 0;
this._fxApply(add || new Set(), add ? null : stale);
}
_fxCovered(evenBusy = false) {
if (!this.shared || (this._fxBusy && !evenBusy)) return false;
const cur = this._fxCur;
if (!cur) return false;
for (const [key, [name, comp, thr]] of FX_GUARDS) {
if (this.shared[name]?.value?.[comp] > thr * 0.5 && !cur.has(key)) return false;
}
return true;
}
async _fxApply(add, drop) {
this._fxBusy = add.size ? 'add' : 'drop';
const gen = (this._fxGen = (this._fxGen || 0) + 1);
const next = new Set([...(this._fxCur || [])].filter((k) => !(drop && drop.has(k))));
for (const k of add) next.add(k);
try {
await Promise.all(this._warmKinds().map((k) => this._warmKind(k, next)));
} catch (e) {
}
if (gen !== this._fxGen) return;
this._fxCur = next;
this._fxSwap();
this._fxBusy = false;
}
fxPreparing() {
return !this._glDormant && !!this.shared && !!this._fxCur && !this._fxCovered(true);
}
_postOn() {
const L = this.state.layers;
const fb = L.feedback;
const dm = L.datamosh;
return (this.state.look.bloom || 0) > 0.01 || (this.state.look.aberration || 0) > 0.01 || !!(fb && fb.on && fb.amount > 0.01) || !!(dm && dm.on);
}
_fxSig(set) {
return [...(set || this._fxCur || [])].sort().join(',');
}
_vertKind() {
const add = this.material ? this.material.blending === THREE.AdditiveBlending : this.state.look.blend === 'add';
return add ? 'vert|add' : 'vert|norm';
}
_warmKinds() {
const kinds = [this._vertKind()];
const now = performance.now();
const wanted = (k) => now - ((this._wantT && this._wantT[k]) || -1e9) < 800;
if (this.hero) kinds.push('hero');
if (this._tp && wanted('pick')) kinds.push('pick');
if (this._shadow?.pts.parent === this.points && (this._shadow.pts.visible || wanted('shadow'))) kinds.push('shadow');
if (this.linkObj && (this.linkObj.visible || wanted('line'))) kinds.push('line');
if (this._scopeLine && (this._scopeLine.visible || wanted('scope'))) kinds.push('scope');
return kinds;
}
_curTgt() {
return this.active ? !!this._tgtRT : this._postOn();
}
async _warmScene(scene, camera, rt = this._curTgt()) {
const r = this.app.viewport.renderer;
const prev = r.getRenderTarget();
const mats = new Set();
try {
const target = rt ? this._warmRT || (this._warmRT = new THREE.WebGLRenderTarget(4, 4)) : null;
r.setRenderTarget(target);
r.compile(scene, camera, this.app.viewport.scene).forEach((m) => mats.add(m));
} catch (e) {
return;
} finally {
r.setRenderTarget(prev);
}
await waitPrograms(r, mats);
}
_warmObj(kind, set) {
const g = this._warmGeo || (this._warmGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)));
const base = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: {} };
if (kind === 'line') return new THREE.Mesh(g, new THREE.ShaderMaterial({ ...base, side: THREE.DoubleSide, vertexShader: this._fxSource('line', set), fragmentShader: lineFrag }));
if (kind === 'scope') return new THREE.Mesh(g, new THREE.ShaderMaterial({ ...base, side: THREE.DoubleSide, vertexShader: this._fxSource('scope', set), fragmentShader: scopeFrag }));
if (kind === 'pick') return new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: {}, defines: { TRACKPICK: 1 }, depthTest: false, depthWrite: false, vertexShader: this._fxSource('vert', set), fragmentShader: 'precision highp float; varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 1.0); }' }));
if (kind === 'shadow') {
const bl = this._shadow?.pts.material.blending ?? THREE.NormalBlending;
return new THREE.Points(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: bl, uniforms: {}, defines: { SHADOW: 1 }, vertexShader: this._fxSource('vert', set), fragmentShader: shadowFrag }));
}
const hero = kind === 'hero';
const add = hero ? !this.hero || this.hero.material.blending === THREE.AdditiveBlending : kind !== 'vert|norm';
const par = { transparent: add, depthWrite: !add, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: {}, vertexShader: this._fxSource('vert', set), fragmentShader: frag };
if (hero) par.defines = { HERO: 1 };
return new THREE.Points(g, new THREE.ShaderMaterial(par));
}
async _warmKind(kind, set, rt = this._curTgt()) {
set = set || this._fxCur || new Set();
const sig = this._fxSig(set);
const keep = this._keep || (this._keep = new Map());
const warm = this._warm || (this._warm = new Map());
const id = kind + (rt ? '@r' : '@s');
const kid = id + '#' + sig;
const want = this._warmWant || (this._warmWant = {});
want[id] = sig;
const prev = keep.get(kid);
if (prev) {
keep.delete(kid);
keep.set(kid, prev);
if (prev.job) await prev.job;
if (want[id] === sig) warm.set(id, sig);
return;
}
const obj = this._warmObj(kind, set);
const sc = new THREE.Scene();
sc.add(obj);
const rec = { sig, mat: obj.material, job: null };
keep.set(kid, rec);
for (const [k, r] of keep) {
if (keep.size <= 10) break;
if (r.job || k === kid) continue;
keep.delete(k);
setTimeout(() => r.mat.dispose(), 1500);
}
rec.job = (async () => {
await null;
try {
await this._warmScene(sc, this.app.viewport.camera, rt);
} catch (e) {
}
if (want[id] === sig) warm.set(id, sig);
rec.job = null;
this.app.viewport.invalidate();
})();
await rec.job;
}
_gate(kind, want) {
if (!want) return false;
if (this._glDormant) {
if (kind.startsWith('vert')) return true;
const g = this.backend?.gpuMesh?.(kind);
if (g !== undefined) return g;
this.backend?.wakeGl?.();
}
(this._wantT || (this._wantT = {}))[kind] = performance.now();
const sig = this._fxSig();
const id = kind + (this._curTgt() ? '@r' : '@s');
if (!this._warm || this._warm.get(id) !== sig) {
const k = this._keep && this._keep.get(id + '#' + sig);
if (!(k && k.job)) this._warmKind(kind, this._fxCur);
return false;
}
return true;
}
_tgtSync() {
const want = this._postOn();
if (want === !!this._tgtRT) return;
const sig = this._fxSig();
let ready = true;
const tw = this._tgtWarm || (this._tgtWarm = {});
const sk = want ? 'r' : 's';
if (tw[sk] !== 2) {
ready = false;
if (!tw[sk]) {
tw[sk] = 1;
this._warmScene(this.app.viewport.scene, this.app.viewport.camera, want).then(() => (tw[sk] = 2));
}
}
for (const k of this._warmKinds()) {
if (!this._warm || this._warm.get(k + (want ? '@r' : '@s')) !== sig) {
ready = false;
this._warmKind(k, this._fxCur, want);
}
}
if (ready) this._tgtRT = want;
}
_fxSwap() {
if (!this.points) return;
this.points.traverse((o) => {
const m = o.material;
const k = m && m.userData && m.userData.fxKind;
if (k) {
m.vertexShader = this._fxSource(k, this._fxCur);
m.needsUpdate = true;
}
});
this.app.viewport.invalidate();
}
async prewarm() {
if (this.active) return;
try {
if (this.hasModel && !this.pm.ready) {
const saved = this.state.count;
this.state.count = Math.max(20000, Math.min(2000000, this.app.settings.point.surfaceCount));
this._quiet = true;
try {
await this._cloudFor('model');
} finally {
this.state.count = saved;
this._quiet = false;
}
}
} catch (e) {
}
try {
await this._warmKind(this._vertKind(), this._fxCur || new Set(), this._postOn());
} catch (e) {
}
}
}
