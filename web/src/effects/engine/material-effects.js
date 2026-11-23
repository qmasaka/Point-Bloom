import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { FabricHistory, MaterialDrawing, drawAffinity, drawFabric, drawInners, drawShell, drawVoid, makeScreenColor, pulseMaterial, voidField } from './material-drawing.js';
import { MaterialVideo } from './material-video.js';
import { makeVolume, mediaBounds } from './material-volume.js';
function makePart(group, id) {
const common = { vertexColors: true, transparent: true, depthWrite: false };
const bead = id === 'inners' ? 0.024 : id === 'affinity' ? 0.016 : 0.013;
const parts = {
lines: new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ ...common, opacity: 0.84 })),
faces: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ ...common, opacity: 0.28, side: THREE.DoubleSide, forceSinglePass: true })),
points: new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ ...common, size: bead, opacity: 0.9 })),
nodes: new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ ...common, size: 0.052, opacity: 0.8, blending: THREE.AdditiveBlending })),
};
for (const o of Object.values(parts)) {
o.frustumCulled = false;
o.userData.helper = true;
group.add(o);
}
return { parts, key: '', flow: null, base: null };
}
function present(root, id, key, build) {
const part = root.userData[id] ||= makePart(root, id);
if (!build || part.key !== key) {
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
get hasVoidPrint() {
return !!this._voidHistory?.slices.length;
}
clearVoidPrint() {
this._voidHistory = null;
this.app.viewport.invalidate();
this.emit();
}
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
_materialRecordVoid(feed, media) {
const h = this._voidHistory ||= { slices: [], clock: 0, version: 0 };
const first = h.slices.length === 0;
if (h.feed === feed.feedId && feed.version === h.lastVersion) return;
let mask = feed.mask;
const C = this.state.layers.chrono;
if (C.on && C.mask === 'person' && this.segmenter?.ready) {
mask = this.segmenter.mask(feed.el, feed.w, feed.h) || mask;
}
const valid = mask?.some(Boolean);
if (h.feed !== feed.feedId && !valid) return;
if (h.feed !== feed.feedId) {
h.slices.length = 0;
h.mediaVolume = null;
h.feed = feed.feedId;
}
h.lastVersion = feed.version;
h.clock += feed.delta;
if (media) {
const { x, y } = mediaBounds(feed.aspect);
h.mediaVolume ||= {
min: [-x, -y, -0.64], max: [x, y, 0.64],
inside: (px, py, pz) => Math.abs(px) < x && Math.abs(py) < y && Math.abs(pz) < 0.64,
};
}
h.slices.push({ time: h.clock, mask: valid ? mask.slice() : null, w: feed.w, h: feed.h });
while (h.slices.length > 85 || h.slices[0].time < h.clock - 4.2) h.slices.shift();
h.version++;
if (first) this.emit();
}
_materialTick(layers, now) {
const { inners, affinity, temporalFabric, voidPrint, vscreen } = layers;
const points = this.points;
this._materialHideSource = false;
if (!points || !(inners.on || affinity.on || temporalFabric.on || voidPrint.on)) {
if (this._materialRoot) this._disposeMaterialGeometry();
this._materialVideo = this._materialScreen = null;
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
const motion = video && (affinity.on || voidPrint.on) ? (this._materialVideo ||= new MaterialVideo()) : null;
const fresh = motion?.read(video, now);
if (!motion) this._materialVideo = null;
if (voidPrint.on && fresh) this._materialRecordVoid(fresh, media);
const imprint = voidPrint.on && this._voidHistory?.slices.length ? this._voidHistory : null;
const volume = inners.on || imprint ? this._materialVolume(media) : null;
const medium = imprint && (media || !this.videoLoaded) ? imprint.mediaVolume || volume : volume;
const cut = imprint ? voidField(imprint.slices, medium, voidPrint) : null;
const activeScreen = inners.on && this.shared.uScr.value.x > 0.001 ? this._screenSource()?.media : null;
const screen = activeScreen ? (this._materialScreen ||= new MaterialVideo()) : null;
if (!screen) this._materialScreen = null;
screen?.read(activeScreen, now, false);
const projection = screen && vscreen.mode === 'project' ? Math.floor(now * 12) : 0;
const maskVer = cut ? [imprint.version, voidPrint.mode, voidPrint.depth, voidPrint.history].join(':') : '';
const removed = cut && (voidPrint.mode === 'negative' ? (x, y, z) => !cut(x, y, z) : cut);
const ghost = inners.on && inners.shell === 'ghost';
const innerKey = [volume?.version, pal, inners.mode, inners.density, inners.complexity, maskVer, media && Math.floor(now * 8),
screen?.version, screen && vscreen.mode, screen && vscreen.scale, screen && vscreen.rotate, screen && vscreen.bright, screen && vscreen.mix, projection].join(':');
const hasInner = present(root, 'inners', innerKey, inners.on
? (draw) => drawInners(draw, volume, inners, palette, removed, screen && makeScreenColor(screen, vscreen, points, viewport, this.shared))
: null);
const anim = this.app.anim;
if (hasInner) pulseMaterial(root.userData.inners, now, inners.pulse ?? 0.7, inners.flow ?? 1);
const attrs = this.geometry.attributes;
present(root, 'shell', [ghost, pal, volume?.version, this.cloudKey, attrs.aTarget.count, Math.round(this.morph * 50), anim.has ? Math.floor(anim.time * 12) : 0].join(':'), ghost
? (draw) => drawShell(draw, attrs.aTarget.array, attrs.aColor.array, attrs.aHide.array, palette, 16000)
: null);
const hasAffinity = present(root, 'affinity', [motion?.version, pal, affinity.mode, affinity.strength, affinity.similarity].join(':'), affinity.on && motion
? (draw) => drawAffinity(draw, motion, affinity, palette)
: null);
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
const hasPrint = present(root, 'voidPrint', [maskVer, volume?.version, pal, inners.on].join(':'), cut
? (draw) => drawVoid(draw, medium, cut, voidPrint, palette, inners.on)
: null);
this._materialHideSource = !!(hasPrint || (hasInner && inners.shell !== 'show') || (hasAffinity && media && affinity.source === 'hide'));
}
}
