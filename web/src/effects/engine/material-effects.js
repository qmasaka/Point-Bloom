import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { FabricHistory, MaterialDrawing, drawFabric, drawInners, drawShell, growthCycle, makeScreenColor, pulseMaterial } from './material-drawing.js';
import { drawAffinity, drawContours } from './material-video-draw.js';
import { MaterialVideo } from './material-video.js';
import { makeVolume, mediaBounds } from './material-volume.js';
let glowSprite = null;
function glowTexture() {
if (glowSprite) return glowSprite;
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 64;
const ctx = canvas.getContext('2d');
const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
gradient.addColorStop(0, 'rgba(255,255,255,1)');
gradient.addColorStop(0.28, 'rgba(255,255,255,0.8)');
gradient.addColorStop(0.62, 'rgba(255,255,255,0.18)');
gradient.addColorStop(1, 'rgba(255,255,255,0)');
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 64, 64);
glowSprite = new THREE.CanvasTexture(canvas);
return glowSprite;
}
function makePart(group, id) {
const common = { vertexColors: true, transparent: true, depthWrite: false };
const bead = id === 'inners' ? 0.03 : id === 'affinity' ? 0.02 : id === 'contours' ? 0.018 : 0.013;
const glowing = id === 'inners' || id === 'affinity' || id === 'contours';
const additive = glowing ? { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } : {};
const sprite = glowing ? { map: glowTexture(), alphaTest: 0.01 } : {};
const parts = {
lines: new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ ...common, ...additive, opacity: 0.84 })),
faces: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ ...common, opacity: 0.28, side: THREE.DoubleSide, forceSinglePass: true })),
points: new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ ...common, ...additive, ...sprite, size: bead, opacity: 0.9 })),
nodes: new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ ...common, ...sprite, ...(glowing ? additive : { blending: THREE.AdditiveBlending }), size: glowing ? 0.075 : 0.052, opacity: 0.8 })),
};
for (const o of Object.values(parts)) {
o.frustumCulled = false;
o.userData.helper = true;
group.add(o);
}
return { parts, key: '', flow: null, base: null };
}
function present(root, id, key, build, now = 0, stamp = '') {
const part = root.userData[id] ||= makePart(root, id);
if (!build || part.key !== key) {
if (build && (part.stamp !== stamp || !part.key)) {
part.stamp = stamp;
part.started = now;
}
const draw = build && new MaterialDrawing();
if (draw) build(draw);
part.flow = {};
part.base = {};
for (const [kind, object] of Object.entries(part.parts)) {
const g = object.geometry;
const data = draw?.[kind];
const n = data ? data[0].length : 0;
if (n) {
if (!g.attributes.position || g.attributes.position.array.length < n) {
const capacity = 3 * 2 ** Math.ceil(Math.log2(n / 3));
g.dispose();
for (const name of ['position', 'color']) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(capacity), 3).setUsage(THREE.DynamicDrawUsage));
}
for (const [i, name] of ['position', 'color'].entries()) {
const a = g.attributes[name];
a.array.set(data[i]);
a.clearUpdateRanges();
a.addUpdateRange(0, n);
a.needsUpdate = true;
}
if (data[2]) {
part.flow[kind] = Float32Array.from(data[2]);
part.base[kind] = Float32Array.from(data[1]);
}
}
g.setDrawRange(0, n / 3);
object.visible = n > 0;
}
part.key = build ? key : '';
}
return Object.values(part.parts).some((x) => x.visible);
}
export class MaterialPart {
_disposeMaterialGeometry() {
const root = this._materialRoot;
if (root) {
root.removeFromParent();
root.traverse((o) => {
o.geometry?.dispose();
o.material?.dispose();
});
}
this._materialRoot = null;
this._materialVolumes = null;
this._materialFabric = null;
this._materialHideSource = false;
}
_materialVolume(media) {
const key = this.cloudKey || 'sphere';
const attrs = this.geometry.attributes;
const D = this.shared.uDepth.value;
const DP = this.shared.uDepthP.value;
const zone = this.shared.uDepthQ.value.x;
const tag = media ? [key, media.cols, media.rows, media.aspect, D.x, D.y, D.w, DP.x, DP.y, zone].join(':') : key;
const cached = this._materialVolumes;
if (cached?.tag === tag && cached.geo === this.geometry) return cached.volume;
const norm = this._materialNorm;
const meshes = norm ? this.modelProvider?.volumeMeshes(key) || [] : [];
const cloud = { positions: attrs.aTarget.array, hide: attrs.aHide.array, norm };
if (media && D.x > 0.001) {
cloud.depth = (i) => {
const dir = Math.sign(DP.y) || 1;
const v = attrs.aDepth.array[i];
const n = dir > 0 ? v : 1 - v;
const f = dir > 0 ? D.w : 1 - D.w;
const levels = Math.max(2, DP.x);
const dn = D.y === 1 ? Math.round(n * levels) / levels : n;
const diff = dn - f;
const spread = clamp((Math.abs(diff) - zone) / Math.max(0.001, 1 - zone), 0, 1);
return Math.sign(diff) * spread * D.x * (D.y === 1 ? 1.5 : 1.2);
};
}
const volume = makeVolume(key, cloud, meshes, media);
volume.version = (this._materialVolumeVer = (this._materialVolumeVer || 0) + 1);
this._materialVolumes = { tag, volume, geo: this.geometry };
return volume;
}
_materialTick(layers, now) {
const { inners, affinity, temporalFabric, contours, vscreen } = layers;
const points = this.points;
this._materialHideSource = false;
if (!points || !(inners.on || affinity.on || temporalFabric.on || contours.on)) {
if (this._materialRoot) this._disposeMaterialGeometry();
this._materialVideo = this._materialScreen = this._materialContours = null;
return;
}
const viewport = this.app.viewport;
const root = this._materialRoot ||= new THREE.Group();
if (!root.parent) {
root.name = '__material-effects';
root.matrixAutoUpdate = false;
root.userData.helper = true;
viewport.scene.add(root);
}
points.updateMatrixWorld(true);
root.matrix.copy(points.matrixWorld);
root.matrixWorldNeedsUpdate = true;
const palette = [this.shared.uP0.value, this.shared.uP1.value, this.shared.uP2.value];
const pal = this.state.look.palette;
const media = this.cloudKey?.startsWith('media') && this.pm?.ready && this.pm.count === this.geometry.attributes.aTarget.count ? this.pm : null;
const video = this.videoReady ? this.pm.el : null;
const motion = video && affinity.on ? (this._materialVideo ||= new MaterialVideo()) : null;
motion?.read(video, now);
if (!motion) this._materialVideo = null;
const still = contours.on && media && this.pm.el ? this.pm.el : null;
const relief = still ? (this._materialContours ||= new MaterialVideo()) : null;
relief?.read(still, now, false);
if (!relief) this._materialContours = null;
const volume = inners.on ? this._materialVolume(media) : null;
const removed = null;
const activeScreen = inners.on && this.shared.uScr.value.x > 0.001 ? this._screenSource()?.media : null;
const screen = activeScreen ? (this._materialScreen ||= new MaterialVideo()) : null;
if (!screen) this._materialScreen = null;
screen?.read(activeScreen, now, false);
const projection = screen && vscreen.mode === 'project' ? Math.floor(now * 12) : 0;
const ghost = inners.on && inners.shell === 'ghost';
const innerShape = [volume?.version, pal, inners.mode, inners.density, inners.complexity, inners.roots, inners.reach, inners.trunk, inners.tips, inners.links, inners.bow, inners.ribs, inners.strands, inners.twist, inners.spread, inners.prune, inners.glow, inners.hue, inners.tone,
screen?.version, screen && vscreen.mode, screen && vscreen.scale, screen && vscreen.rotate, screen && vscreen.bright, screen && vscreen.mix, projection].join(':');
const innerKey = innerShape + ':' + (media ? Math.floor(now * 8) : '');
const hasInner = present(root, 'inners', innerKey, inners.on
? (draw) => drawInners(draw, volume, inners, palette, removed, screen && makeScreenColor(screen, vscreen, points, viewport, this.shared))
: null, now, innerShape);
const anim = this.app.anim;
const cycle = growthCycle(now, root.userData.inners.started, inners.flow ?? 1, inners.repeat ?? 'loop');
if (hasInner) {
const inner = root.userData.inners;
inner.parts.points.material.size = 0.03 * (inners.bead ?? 1);
inner.parts.nodes.material.size = 0.075 * (inners.bead ?? 1);
pulseMaterial(inner, now, inners.pulse ?? 0.7, inners.flow ?? 1, cycle);
}
const attrs = this.geometry.attributes;
present(root, 'shell', [ghost, pal, volume?.version, this.cloudKey, attrs.aTarget.count, Math.round(this.morph * 50), anim.has ? Math.floor(anim.time * 12) : 0].join(':'), ghost
? (draw) => drawShell(draw, attrs.aTarget.array, attrs.aColor.array, attrs.aHide.array, palette, 16000)
: null);
const hasAffinity = present(root, 'affinity', motion?.version + ':' + pal + ':' + JSON.stringify(affinity), affinity.on && motion
? (draw) => drawAffinity(draw, motion, affinity, palette)
: null);
if (hasAffinity) {
const part = root.userData.affinity;
part.parts.points.material.size = (affinity.mode === 'dust' ? 0.032 : 0.02) * (affinity.bead ?? 1);
part.parts.nodes.material.size = 0.06 * (affinity.bead ?? 1);
}
const sweepTick = contours.sweep > 0 ? Math.floor(now * 10) : 0;
const hasContours = present(root, 'contours', relief?.version + ':' + pal + ':' + JSON.stringify(contours) + ':' + sweepTick, contours.on && relief?.gray
? (draw) => drawContours(draw, relief, contours, palette, now)
: null);
if (hasContours) {
const part = root.userData.contours;
part.parts.points.material.size = 0.018 * (contours.bead ?? 1);
}
const cloud = this._animCloud;
let fabric = null;
if (temporalFabric.on && cloud && this._animBuf && anim.has) {
if (this._materialFabric?.cloud !== cloud) this._materialFabric = { cloud, history: new FabricHistory(cloud) };
fabric = this._materialFabric.history;
fabric.sample(this._animBuf, anim);
} else this._materialFabric = null;
present(root, 'temporalFabric', [fabric?.version, pal, temporalFabric.mode, temporalFabric.history, temporalFabric.density].join(':'), fabric
? (draw) => drawFabric(draw, fabric, temporalFabric, palette)
: null);
this._materialHideSource = !!((hasInner && inners.shell !== 'show') || (hasAffinity && media && affinity.source === 'hide') || (hasContours && media && contours.source === 'hide'));
}
}
