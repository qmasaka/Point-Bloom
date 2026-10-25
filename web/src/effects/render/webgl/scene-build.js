import * as THREE from 'three';
import { createFrameUniforms } from '../shared/frame-uniforms.js';
import { frag } from '../../shaders/glsl/frag.js';
import { lineFrag } from '../../shaders/glsl/line-frag.js';
export class BuildPart {
async _build() {
const st = this.state;
if (st.source === 'model' && !this.hasModel) st.source = 'sphere';
let c = await this._cloudFor(st.source);
if (!c) {
st.source = 'sphere';
c = await this._cloudFor('sphere');
}
const count = c.count;
const g = new THREE.BufferGeometry();
const idx = new Float32Array(count);
for (let i = 0; i < count; i++) idx[i] = i / count;
const model = st.source === 'model' || st.source === 'media' || st.source === 'frames' ? c : this.hasModel ? (await this._cloudFor('model').catch(() => null)) || c : c;
g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
g.setAttribute('aOrigin', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
g.setAttribute('aTarget', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
g.setAttribute('aNormal', new THREE.BufferAttribute(new Float32Array(c.normals), 3));
g.setAttribute('aNormalB', new THREE.BufferAttribute(new Float32Array(c.normals), 3));
g.setAttribute('aPaint', new THREE.BufferAttribute(new Float32Array(count * 4), 4));
this._dabs = [];
this._painted = false;
g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(model.colors.length === c.colors.length ? model.colors : c.colors), 3));
g.setAttribute('aColorB', new THREE.BufferAttribute(new Float32Array(g.attributes.aColor.array), 3));
g.setAttribute('aHide', new THREE.BufferAttribute(c.hide && c.hide.length === count ? new Float32Array(c.hide) : new Float32Array(count), 1));
g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(count).fill(0.5), 1));
g.setAttribute('aPath', new THREE.BufferAttribute(new Float32Array(count), 1));
g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
g.setAttribute('aSculpt', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
g.setAttribute('aVis', new THREE.BufferAttribute(new Float32Array(count * 2).fill(1), 2));
this._grabs = new Map();
this._animCloud = st.source === 'model' && c.anim && c.norm ? c : null;
this._animVer = -1;
if (!this.specTex) {
this.specTex = new THREE.DataTexture(new Uint8Array(64), 64, 1, THREE.RedFormat, THREE.UnsignedByteType);
this.specTex.minFilter = this.specTex.magFilter = THREE.LinearFilter;
this.specTex.needsUpdate = true;
}
if (!this.pieceTex) {
this.pieceTex = new THREE.DataTexture(new Float32Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.FloatType);
this.pieceTex.minFilter = this.pieceTex.magFilter = THREE.NearestFilter;
this.pieceTex.needsUpdate = true;
this._pieceKey = '';
}
const U = (v) => ({ value: v });
const shared = createFrameUniforms({ count, specTex: this.specTex, pieceTex: this.pieceTex });
const addBlend = this.state.look.blend === 'add';
const mk = (extra) =>
new THREE.ShaderMaterial({
vertexShader: this._fxSource('vert', this._fxCur || (this._fxCur = new Set())),
fragmentShader: frag,
transparent: addBlend,
depthWrite: !addBlend,
blending: addBlend ? THREE.AdditiveBlending : THREE.NormalBlending,
uniforms: { ...shared, uTOff: U(0), uGhost: U(1), ...extra },
userData: { fxKind: 'vert' },
});
const mat = mk();
const pts = new THREE.Points(g, mat);
pts.frustumCulled = false;
pts.name = '__fx';
pts.userData.helper = true;
g.computeBoundingBox();
const bb = g.boundingBox;
shared.uYR.value.set(bb.min.y, bb.max.y);
shared.uCen.value.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2);
this._yrBase = [bb.min.y, bb.max.y];
this.app.viewport.fxFloorY = c.norm && c.norm.floorY !== undefined ? c.norm.floorY : bb.min.y;
const old = this.points;
const rot = old ? old.rotation.clone() : null;
if (old) this._disposePoints();
this.ghosts = [1, 2, 3, 4, 5].map((k) => {
const gm = mk({ uTOff: U(0), uGhost: U(0), uHero: U(new THREE.Vector4()) });
const gp = new THREE.Points(g, gm);
gp.frustumCulled = false;
gp.userData.helper = true;
gp.visible = false;
pts.add(gp);
return gp;
});
const lg = new THREE.BufferGeometry();
const lm = new THREE.ShaderMaterial({ vertexShader: this._fxSource('line', this._fxCur || (this._fxCur = new Set())), userData: { fxKind: 'line' }, fragmentShader: lineFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { ...shared, uTOff: U(0) } });
this.linkObj = new THREE.Mesh(lg, lm);
this.linkObj.frustumCulled = false;
this.linkObj.userData.helper = true;
this.linkObj.visible = false;
pts.add(this.linkObj);
this.geometry = g;
this._morphTrackReady = false;
this._morphTrackBackup = null;
this.material = mat;
this.shared = shared;
this.points = pts;
if (rot) pts.rotation.copy(rot);
this.cloudKey = st.source;
this.morph = 1;
this.morphing = false;
this.app.viewport.scene.add(pts);
this._computeLinks();
}
_disposePoints() {
if (!this.points) return;
this.app.viewport.scene.remove(this.points);
this.points.traverse((o) => {
if (o.geometry && o !== this.points) o.geometry.dispose();
if (o.material) o.material.dispose();
});
this.geometry?.dispose();
this.points = this.geometry = this.material = this.linkObj = null;
this.ghosts = [];
}
applyBg() {
const stage = document.querySelector('.stage');
const { bg, vignette } = this.state.look;
if (!this.active || !bg) {
this.app.viewport.applyRenderSettings();
return;
}
const c = new THREE.Color(bg);
const hi = c.clone().lerp(new THREE.Color(1, 1, 1), 0.025);
stage.style.background = vignette ? `radial-gradient(ellipse at 50% 42%, #${hi.getHexString(THREE.SRGBColorSpace)} 0%, ${bg} 78%)` : bg;
}
}
