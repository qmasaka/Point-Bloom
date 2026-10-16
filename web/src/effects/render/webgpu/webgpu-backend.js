import * as THREE from 'three';
import { RenderBackend } from '../backend.js';
import { WebGLBackend } from '../webgl/webgl-backend.js';
import { WebGPUPoints } from './webgpu-points.js';
import { WebGPUPost } from './webgpu-post.js';
import { WebGPUMesh } from './webgpu-mesh.js';
import { WebGPUTrail } from './webgpu-trail.js';
import { markGpuBad } from './device.js';
const ATTRS = ['aOrigin', 'aTarget', 'aNormal', 'aNormalB', 'aPaint', 'aColor', 'aColorB', 'aHide', 'aDepth', 'aPath', 'aSculpt', 'aVis', 'aIdx'];
const _mv = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
export class WebGPUBackend extends RenderBackend {
constructor(engine, gpu) {
super(engine);
this.gpu = gpu;
this.gl = new WebGLBackend(engine);
this.sync = {};
this.glWarm = false;
this.glWaking = false;
this.useGl = false;
this.tint = null;
this.stats = { gpu: 0, gl: 0 };
}
get kind() {
return 'webgpu';
}
create() {
const e = this.engine;
const vp = e.app.viewport;
this.gl.create();
const cv = document.createElement('canvas');
cv.className = 'gl fx-gpu';
cv.style.cssText = 'position:absolute;inset:0;pointer-events:none';
vp.canvas.after(cv);
this.canvas = cv;
vp.fxOverlay = cv;
vp.fxCompose = () => this.captureCanvas();
this.pts = new WebGPUPoints(this.gpu, cv);
this.post = new WebGPUPost(this.gpu.device, this.gpu.format);
this.trail = new WebGPUTrail(this.gpu.device, this.gpu.format);
this.meshes = { links: new WebGPUMesh(this.pts, 'links'), scope: new WebGPUMesh(this.pts, 'scope') };
this.hasHistory = false;
this.gpu.device.lost.then((info) => {
this.lost = true;
if (info && info.reason !== 'destroyed') markGpuBad('устройство потеряно: ' + (info.message || info.reason));
});
e._glDormant = true;
}
async prepare() {
try {
await Promise.all([this.pts.prepare(), this.post.prepare()]);
} catch (e) {
this.lost = true;
markGpuBad('не собрались шейдеры: ' + (e && e.message ? e.message : e));
return;
}
this._syncCloud();
}
install() {
const e = this.engine;
e.app.viewport.renderHook = (renderer, scene, camera) => this._frame(renderer, scene, camera);
}
setTint(color) {
this.tint = color;
this.gl.setTint(color);
}
wakeGl() {
if (this.glWaking || this.glWarm) return;
const e = this.engine;
this.glWaking = true;
e._glDormant = false;
e._tgtRT = e._postOn();
e._tgtWarm = {};
this.gl.prepare([e._vertKind()])
.catch(() => {})
.then(() => {
this.glWarm = true;
});
}
gpuMesh(kind) {
const m = this.meshes?.[{ line: 'links', scope: 'scope' }[kind]];
if (!m || this.lost || m.failed) return undefined;
m.prepare();
return m.ready(false) && m.ready(true);
}
_gpuDraws(obj) {
const e = this.engine;
if (this.lost) return false;
if (obj === e.linkObj) return !this.meshes.links.failed;
if (obj === e._scopeLine) return !this.meshes.scope.failed;
if (obj === e.hero) return !this.pts.heroFailed;
return !!e._trail && obj === e._trail.group && !this.trail.failed;
}
_glOnly() {
const e = this.engine;
const pts = e.points;
if (!pts) return false;
for (const c of pts.children) if (c.visible && !e.ghosts.includes(c) && !this._gpuDraws(c)) return true;
if (e.app.viewport.renderer.toneMapping !== THREE.NeutralToneMapping) return true;
if (e.shared && e.shared.uScr && e.shared.uScr.value.x > 0.001) return true;
return false;
}
_syncCloud(g = this.engine.geometry, layer = 'main') {
if (!g) return false;
const S = this.sync[layer] || (this.sync[layer] = { geo: null, versions: {} });
if (g !== S.geo) {
const attrs = {};
for (const k of ATTRS) attrs[k] = g.attributes[k].array;
this.pts.setCloud(attrs, g.attributes.aOrigin.count, layer);
S.geo = g;
S.versions = {};
for (const k of ATTRS) S.versions[k] = g.attributes[k].version;
return true;
}
const changed = [];
for (const k of ATTRS) {
const v = g.attributes[k].version;
if (v !== S.versions[k]) {
S.versions[k] = v;
changed.push(k);
}
}
if (changed.length) this.pts.updateAttributes(changed, layer);
return true;
}
_syncTextures() {
const e = this.engine;
const pts = this.pts;
const sh = e.shared;
const S = this.sync;
const spec = e.specTex;
if (spec && S.spec !== spec.version) {
S.spec = spec.version;
pts.setSpectrum(spec.image.data);
}
const piece = e.pieceTex;
if (piece && S.piece !== piece.version) {
S.piece = piece.version;
pts.setPieces(piece.image.data);
}
const atlas = sh.uAtlas.value;
if (atlas && (S.atlas !== atlas || S.atlasVer !== atlas.version)) {
S.atlas = atlas;
S.atlasVer = atlas.version;
pts.setAtlas(atlas.image);
}
const fr = sh.uFrTex.value;
if (fr && fr.isDataArrayTexture && fr.image.data && (S.fr !== fr || S.frVer !== fr.version)) {
S.fr = fr;
S.frVer = fr.version;
pts.setFrames(fr.image.data, fr.image.width, fr.image.height, fr.image.depth);
}
const hero = e.hero;
if (hero && hero.visible) {
const ht = sh.uHeroTex.value;
const v = ht && ht.image;
if (v && v.videoWidth && v.readyState >= 2) pts.setHeroSource(v, v.videoWidth, v.videoHeight);
}
}
_inst(obj, camera, extra) {
_mv.multiplyMatrices(camera.matrixWorldInverse, obj.matrixWorld);
_nm.getNormalMatrix(_mv);
return { modelMatrix: obj.matrixWorld.clone(), modelViewMatrix: _mv.clone(), normalMatrix: _nm.clone(), ...extra };
}
captureCanvas() {
if (!this.cap) {
this.cap = document.createElement('canvas');
this.capCtx = this.cap.getContext('2d');
this._compose();
}
return this.cap;
}
_compose() {
const vp = this.engine.app.viewport;
const cap = this.cap;
if (cap.width !== vp.canvas.width) cap.width = vp.canvas.width;
if (cap.height !== vp.canvas.height) cap.height = vp.canvas.height;
this.capCtx.clearRect(0, 0, cap.width, cap.height);
this.capCtx.drawImage(vp.canvas, 0, 0);
if (this.canvas.style.visibility !== 'hidden') this.capCtx.drawImage(this.canvas, 0, 0, cap.width, cap.height);
}
_frame(renderer, scene, camera) {
this._draw(renderer, scene, camera);
if (this.cap) this._compose();
}
_draw(renderer, scene, camera) {
const e = this.engine;
if (!e.active || !e.points) {
renderer.render(scene, camera);
return;
}
const gpuReady = !this.lost && this.pts.ready(true) && this.post.ready('out');
const wantGl = !gpuReady || this._glOnly();
if (wantGl) this.wakeGl();
this.useGl = wantGl && this.glWarm && e._fxCovered();
if (this.useGl) {
this.stats.gl++;
this.canvas.style.visibility = 'hidden';
e.points.visible = true;
this.gl.hook(renderer, scene, camera);
return;
}
if (!gpuReady) {
e.points.visible = false;
renderer.setRenderTarget(null);
renderer.render(scene, camera);
return;
}
e.points.visible = false;
renderer.setRenderTarget(null);
renderer.render(scene, camera);
this.canvas.style.visibility = '';
this.stats.gpu++;
if (!this._syncCloud()) return;
this._syncTextures();
this._drawCloud(renderer, camera);
}
_drawCloud(renderer, camera) {
const e = this.engine;
const pts = this.pts;
const vp = e.app.viewport;
const w = Math.max(1, vp.canvas.width);
const h = Math.max(1, vp.canvas.height);
const shared = e.shared;
const add = shared.uAdd.value > 0.5;
const list = [this._inst(e.points, camera, { uTOff: e.material.uniforms.uTOff.value, uGhost: e.material.uniforms.uGhost.value })];
for (const g of e.ghosts) {
if (!g.visible) continue;
list.push(this._inst(g, camera, { uTOff: g.material.uniforms.uTOff.value, uGhost: g.material.uniforms.uGhost.value, uHero: g.material.uniforms.uHero.value }));
}
const hero = e.hero;
if (hero && hero.visible) {
pts.prepareHero();
if (pts.heroReady() && this._syncCloud(hero.geometry, 'hero')) list.push(this._inst(hero, camera, { uTOff: hero.material.uniforms.uTOff.value, uGhost: hero.material.uniforms.uGhost.value, layer: 'hero' }));
}
const common = { projectionMatrix: camera.projectionMatrix, uExposure: renderer.toneMappingExposure };
const L = e.state.layers;
const fb = L.feedback;
const bloom = e.state.look.bloom || 0;
const ab = e.state.look.aberration || 0;
const useFb = !!(fb && fb.on && fb.amount > 0.01);
const useBloom = bloom > 0.01;
const useAb = ab > 0.01;
const dm = L.datamosh;
const mosh = dm && dm.on ? e._moshParams(dm) : null;
const useMosh = !!(mosh && mosh.on);
if (this.canvas.width !== w) this.canvas.width = w;
if (this.canvas.height !== h) this.canvas.height = h;
const D = this.gpu.device;
const post = this.post;
const enc = D.createCommandEncoder();
const size = [w, h];
if (!useFb && !useBloom && !useAb && !useMosh) {
this.hasHistory = false;
post.moshOff();
this._scene(enc, pts.ctx.getCurrentTexture().createView(), size, false, list, common, camera);
D.queue.submit([enc.finish()]);
return;
}
if (!pts.ready(add, true) || (useFb && !post.ready('fb')) || (useMosh && !(post.ready('mv') && post.ready('mosh') && post.mipPipeline))) {
this._scene(enc, pts.ctx.getCurrentTexture().createView(), size, false, list, common, camera);
D.queue.submit([enc.finish()]);
return;
}
const scene = post.rt('scene', w, h, { mips: useMosh });
if (this._size !== w + 'x' + h) {
this._size = w + 'x' + h;
this.hasHistory = false;
}
this._scene(enc, scene.createView({ baseMipLevel: 0, mipLevelCount: 1 }), size, true, list, common, camera);
let src = scene.createView();
if (useMosh) src = post.moshStep(enc, mosh, size);
else post.moshOff();
if (useFb) {
const tun = fb.mode === 'tunnel';
const ping = post.rt('ping', w, h);
const pong = post.rt('pong', w, h);
post.run(
enc,
'fb',
pong.createView(),
size,
{
uDecay: Math.min(0.99, fb.amount || 0.92),
uZoom: tun ? fb.zoom || 1 : 1,
uTwist: tun ? fb.twist || 0 : 0,
uHasPrev: this.hasHistory ? 1 : 0,
uTint: this.tint || [1, 1, 1],
uTintK: fb.tint ?? 0.5,
},
{ uScene: src, uPrev: ping.createView() }
);
post.rts.ping = pong;
post.rts.pong = ping;
this.hasHistory = true;
src = pong.createView();
} else {
this.hasHistory = false;
}
post.run(enc, 'out', pts.ctx.getCurrentTexture().createView(), size, { uBloom: bloom, uAberration: ab, uRes: size }, { uTex: src });
D.queue.submit([enc.finish()]);
}
_scene(enc, view, size, rt, list, common, camera) {
const e = this.engine;
const tr = e._trail;
let noClear = false;
if (tr && tr.group.visible && tr.group.parent === e.points) {
this.trail.prepare();
if (this.trail.ready(rt) && this.trail.sync(tr)) {
this._mv ||= new THREE.Matrix4();
this.trail.draw(enc, view, this.pts._depthFor(size[0], size[1]).createView(), rt, tr, { mv: this._mv, proj: camera.projectionMatrix, camera, size, exposure: common.uExposure });
noClear = true;
}
}
this.pts.frame(e.shared, common, list, { view, size, rt, noClear, encoder: enc });
for (const [obj, m] of [[e.linkObj, this.meshes.links], [e._scopeLine, this.meshes.scope]]) {
if (!obj || !obj.visible || !m.ready(rt)) continue;
if (m.sync(obj.geometry)) m.draw(enc, view, rt);
}
}
dispose() {
const e = this.engine;
const vp = e.app.viewport;
vp.renderHook = null;
vp.fxOverlay = vp.fxCompose = null;
e._glDormant = false;
if (e.points) e.points.visible = true;
for (const m of Object.values(this.meshes || {})) m.dispose();
this.trail?.dispose();
this.pts?.dispose();
this.post?.dispose();
this.canvas?.remove();
this.gl.dispose();
this.pts = this.post = this.canvas = this.cap = this.capCtx = null;
}
}
