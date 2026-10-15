import * as THREE from 'three';
import { RenderBackend } from '../backend.js';
import { WebGLBackend } from '../webgl/webgl-backend.js';
import { WebGPUPoints } from './webgpu-points.js';
import { WebGPUPost } from './webgpu-post.js';
const ATTRS = ['aOrigin', 'aTarget', 'aNormal', 'aNormalB', 'aPaint', 'aColor', 'aColorB', 'aHide', 'aDepth', 'aPath', 'aSculpt', 'aVis', 'aIdx'];
const _mv = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
export class WebGPUBackend extends RenderBackend {
constructor(engine, gpu) {
super(engine);
this.gpu = gpu;
this.gl = new WebGLBackend(engine);
this.cloudGeo = null;
this.versions = {};
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
this.pts = new WebGPUPoints(this.gpu, cv);
this.post = new WebGPUPost(this.gpu.device, this.gpu.format);
this.hasHistory = false;
this.gpu.device.lost.then(() => {
this.lost = true;
});
e._glDormant = true;
}
async prepare() {
await Promise.all([this.pts.prepare(), this.post.prepare()]);
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
_glOnly() {
const e = this.engine;
const pts = e.points;
if (!pts) return false;
for (const c of pts.children) if (c.visible && !e.ghosts.includes(c)) return true;
if (e.shared.uFr.value.x > 0.5) return true;
if (e.recording) return true;
if (e.app.viewport.renderer.toneMapping !== THREE.NeutralToneMapping) return true;
return false;
}
_syncCloud() {
const e = this.engine;
const g = e.geometry;
if (!g) return false;
if (g !== this.cloudGeo) {
const attrs = {};
for (const k of ATTRS) attrs[k] = g.attributes[k].array;
this.pts.setCloud(attrs, g.attributes.aOrigin.count);
this.cloudGeo = g;
this.versions = {};
for (const k of ATTRS) this.versions[k] = g.attributes[k].version;
return true;
}
const changed = [];
for (const k of ATTRS) {
const v = g.attributes[k].version;
if (v !== this.versions[k]) {
this.versions[k] = v;
changed.push(k);
}
}
if (changed.length) this.pts.updateAttributes(changed);
return true;
}
_inst(obj, camera, extra) {
_mv.multiplyMatrices(camera.matrixWorldInverse, obj.matrixWorld);
_nm.getNormalMatrix(_mv);
return { modelMatrix: obj.matrixWorld.clone(), modelViewMatrix: _mv.clone(), normalMatrix: _nm.clone(), ...extra };
}
_frame(renderer, scene, camera) {
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
if (!useFb && !useBloom && !useAb && !useMosh) {
this.hasHistory = false;
this.post.moshOff();
pts.frame(shared, common, list, { size: [w, h] });
return;
}
if (!pts.ready(add, true) || (useFb && !this.post.ready('fb')) || (useMosh && !(this.post.ready('mv') && this.post.ready('mosh') && this.post.mipPipeline))) {
pts.frame(shared, common, list, { size: [w, h] });
return;
}
const D = this.gpu.device;
const post = this.post;
const enc = D.createCommandEncoder();
const size = [w, h];
const scene = post.rt('scene', w, h, { mips: useMosh });
if (this._size !== w + 'x' + h) {
this._size = w + 'x' + h;
this.hasHistory = false;
}
pts.frame(shared, common, list, { view: scene.createView({ baseMipLevel: 0, mipLevelCount: 1 }), size, rt: true, encoder: enc });
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
dispose() {
const e = this.engine;
e.app.viewport.renderHook = null;
e._glDormant = false;
if (e.points) e.points.visible = true;
this.pts?.dispose();
this.post?.dispose();
this.canvas?.remove();
this.gl.dispose();
this.pts = this.post = this.canvas = null;
}
}
