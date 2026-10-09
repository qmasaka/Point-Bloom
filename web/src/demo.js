import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
function objText(parts, mtlName) {
const out = [`# Point Bloom demo\nmtllib ${mtlName}\n`];
let v = 1, t = 1, n = 1;
for (const p of parts) {
const g = p.geo.index ? p.geo : p.geo;
const pos = g.attributes.position, uv = g.attributes.uv, nr = g.attributes.normal;
out.push(`o ${p.name}\n`);
const lines = [];
for (let i = 0; i < pos.count; i++) lines.push(`v ${pos.getX(i).toFixed(5)} ${pos.getY(i).toFixed(5)} ${pos.getZ(i).toFixed(5)}`);
for (let i = 0; i < uv.count; i++) lines.push(`vt ${uv.getX(i).toFixed(5)} ${uv.getY(i).toFixed(5)}`);
for (let i = 0; i < nr.count; i++) lines.push(`vn ${nr.getX(i).toFixed(4)} ${nr.getY(i).toFixed(4)} ${nr.getZ(i).toFixed(4)}`);
lines.push(`usemtl ${p.mtl}`, 's 1');
const idx = g.index;
for (let i = 0; i < idx.count; i += 3) {
const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
lines.push(`f ${a + v}/${a + t}/${a + n} ${b + v}/${b + t}/${b + n} ${c + v}/${c + t}/${c + n}`);
}
out.push(lines.join('\n') + '\n');
v += pos.count;
t += uv.count;
n += nr.count;
}
return out.join('');
}
function texturePNG() {
const N = 1024;
const c = document.createElement('canvas');
c.width = c.height = N;
const g = c.getContext('2d');
const grad = g.createLinearGradient(0, 0, N, 0);
const stops = [18, 346, 275, 212, 168, 18];
stops.forEach((hue, i) => grad.addColorStop(i / (stops.length - 1), `hsl(${hue} 78% 56%)`));
g.fillStyle = grad;
g.fillRect(0, 0, N, N);
const shade = g.createLinearGradient(0, 0, 0, N);
shade.addColorStop(0, 'rgba(255,255,255,0.22)');
shade.addColorStop(0.5, 'rgba(255,255,255,0)');
shade.addColorStop(1, 'rgba(0,0,0,0.28)');
g.fillStyle = shade;
g.fillRect(0, 0, N, N);
const cell = 64;
for (let y = 0; y < N / cell; y++) {
for (let x = 0; x < N / cell; x++) {
if ((x + y) % 2 === 0) {
g.fillStyle = 'rgba(255,255,255,0.10)';
g.fillRect(x * cell, y * cell, cell, cell);
}
}
}
g.strokeStyle = 'rgba(255,255,255,0.35)';
g.lineWidth = 2;
for (let i = 0; i <= N; i += cell * 2) {
g.beginPath();
g.moveTo(i, 0);
g.lineTo(i, N);
g.moveTo(0, i);
g.lineTo(N, i);
g.stroke();
}
g.fillStyle = 'rgba(10,12,16,0.78)';
g.font = '600 26px Geist, system-ui, sans-serif';
g.textAlign = 'left';
g.textBaseline = 'top';
for (let y = 0; y < N / (cell * 2); y++) {
for (let x = 0; x < N / (cell * 2); x++) g.fillText(`${x},${y}`, x * cell * 2 + 10, y * cell * 2 + 8);
}
return new Promise((res) => c.toBlob(res, 'image/png'));
}
export async function makeDemoFiles() {
const knot = new THREE.TorusKnotGeometry(0.9, 0.3, 260, 40, 2, 3);
const base = new THREE.CylinderGeometry(1.7, 1.85, 0.16, 72, 1);
base.translate(0, -1.62, 0);
const obj = objText(
[
{ name: 'Узел', geo: knot, mtl: 'demo_knot' },
{ name: 'Подставка', geo: base, mtl: 'demo_base' },
],
'demo.mtl'
);
const mtl = 'newmtl demo_knot\nKd 1 1 1\nNs 120\nmap_Kd demo_texture.png\n\nnewmtl demo_base\nKd 0.20 0.22 0.26\nNs 30\n';
const png = await texturePNG();
return [new File([obj], 'demo.obj', { type: 'text/plain' }), new File([mtl], 'demo.mtl', { type: 'text/plain' }), new File([png], 'demo_texture.png', { type: 'image/png' })];
}
export async function makeDemoCharacterFile() {
const bones = {};
const mk = (name, parent, x, y, z) => {
const b = new THREE.Bone();
b.name = name;
b.position.set(x, y, z);
if (parent) bones[parent].add(b);
bones[name] = b;
return b;
};
mk('Hips', null, 0, 1.0, 0);
mk('Spine', 'Hips', 0, 0.2, 0);
mk('Chest', 'Spine', 0, 0.25, 0);
mk('Neck', 'Chest', 0, 0.25, 0);
mk('Head', 'Neck', 0, 0.12, 0);
for (const [s, sx] of [['L', 1], ['R', -1]]) {
mk('Shoulder' + s, 'Chest', sx * 0.2, 0.2, 0);
mk('Elbow' + s, 'Shoulder' + s, sx * 0.3, 0, 0);
mk('Wrist' + s, 'Elbow' + s, sx * 0.28, 0, 0);
mk('Hip' + s, 'Hips', sx * 0.1, -0.05, 0);
mk('Knee' + s, 'Hip' + s, 0, -0.45, 0);
mk('Ankle' + s, 'Knee' + s, 0, -0.45, 0);
}
bones.Hips.updateMatrixWorld(true);
const list = Object.values(bones);
const idxOf = (n) => list.indexOf(bones[n]);
const wp = (n) => new THREE.Vector3().setFromMatrixPosition(bones[n].matrixWorld);
const geos = [];
const addPart = (geo, nameA, nameB) => {
const pos = geo.attributes.position;
geo.computeBoundingBox();
const bb = geo.boundingBox;
const n = pos.count;
const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
const a = idxOf(nameA), b = idxOf(nameB || nameA);
const axis = nameB ? (Math.abs(wp(nameB).x - wp(nameA).x) > Math.abs(wp(nameB).y - wp(nameA).y) ? 'x' : 'y') : 'y';
for (let i = 0; i < n; i++) {
let t = 0;
if (nameB) {
const v = axis === 'x' ? pos.getX(i) : pos.getY(i);
const lo = axis === 'x' ? bb.min.x : bb.min.y, hi = axis === 'x' ? bb.max.x : bb.max.y;
const A = axis === 'x' ? wp(nameA).x : wp(nameA).y, Bv = axis === 'x' ? wp(nameB).x : wp(nameB).y;
t = THREE.MathUtils.clamp((v - A) / (Bv - A || 1), 0, 1);
t = t * t * (3 - 2 * t);
}
si[i * 4] = a;
si[i * 4 + 1] = b;
sw[i * 4] = 1 - t;
sw[i * 4 + 1] = t;
}
geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
geos.push(geo);
};
const limb = (from, to, r0, r1, seg = 14) => {
const A = wp(from), B = wp(to);
const len = A.distanceTo(B);
const g = new THREE.CylinderGeometry(r1, r0, len, 14, seg, false);
const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
g.applyQuaternion(q);
const m = A.clone().add(B).multiplyScalar(0.5);
g.translate(m.x, m.y, m.z);
return g;
};
const ball = (name, r, x, y, z) => {
const g = new THREE.SphereGeometry(r, 18, 14);
g.translate(x, y, z);
addPart(g, name);
};
addPart(limb('Hips', 'Chest', 0.17, 0.2, 10), 'Hips', 'Chest');
addPart(limb('Chest', 'Neck', 0.2, 0.09, 6), 'Chest', 'Neck');
{
const h = wp('Head');
ball('Head', 0.14, h.x, h.y + 0.1, h.z);
}
for (const s of ['L', 'R']) {
addPart(limb('Shoulder' + s, 'Elbow' + s, 0.07, 0.06), 'Shoulder' + s, 'Elbow' + s);
addPart(limb('Elbow' + s, 'Wrist' + s, 0.06, 0.045), 'Elbow' + s, 'Wrist' + s);
const w = wp('Wrist' + s);
ball('Wrist' + s, 0.055, w.x, w.y, w.z);
addPart(limb('Hip' + s, 'Knee' + s, 0.09, 0.07), 'Hip' + s, 'Knee' + s);
addPart(limb('Knee' + s, 'Ankle' + s, 0.07, 0.05), 'Knee' + s, 'Ankle' + s);
const a = wp('Ankle' + s);
ball('Ankle' + s, 0.065, a.x, a.y - 0.02, a.z + 0.05);
}
let total = 0;
for (const g of geos) total += g.attributes.position.count;
const P = new Float32Array(total * 3), N = new Float32Array(total * 3), U = new Float32Array(total * 2), SI = new Uint16Array(total * 4), SW = new Float32Array(total * 4);
const IDX = [];
let off = 0;
for (const g of geos) {
const c = g.attributes.position.count;
P.set(g.attributes.position.array, off * 3);
N.set(g.attributes.normal.array, off * 3);
SI.set(g.attributes.skinIndex.array, off * 4);
SW.set(g.attributes.skinWeight.array, off * 4);
for (let i = 0; i < c; i++) {
const x = P[(off + i) * 3], y = P[(off + i) * 3 + 1], z = P[(off + i) * 3 + 2];
U[(off + i) * 2] = 0.5 + Math.atan2(x, z) / (2 * Math.PI) * 1.0;
U[(off + i) * 2 + 1] = THREE.MathUtils.clamp(y / 1.9, 0, 1);
}
const ix = g.index;
for (let i = 0; i < ix.count; i++) IDX.push(ix.getX(i) + off);
off += c;
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
geo.setIndex(IDX);
const cv = document.createElement('canvas');
cv.width = 512;
cv.height = 512;
const g2 = cv.getContext('2d');
const grd = g2.createLinearGradient(0, 512, 0, 0);
grd.addColorStop(0, '#2a6df4');
grd.addColorStop(0.35, '#2fd9a0');
grd.addColorStop(0.65, '#ffb347');
grd.addColorStop(1, '#ff4f8b');
g2.fillStyle = grd;
g2.fillRect(0, 0, 512, 512);
g2.fillStyle = 'rgba(255,255,255,0.35)';
for (let i = 0; i < 16; i++) g2.fillRect(i * 32, 0, 12, 512);
const tex = new THREE.CanvasTexture(cv);
tex.colorSpace = THREE.SRGBColorSpace;
tex.flipY = false;
const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.05 }));
mesh.name = 'Человечек';
const root = new THREE.Group();
root.name = 'Персонаж';
root.add(bones.Hips);
root.add(mesh);
root.updateMatrixWorld(true);
mesh.bind(new THREE.Skeleton(list), mesh.matrixWorld);
const E = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
const rot = (name, times, eulers) => new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, eulers.flatMap((e) => E(...e)));
const T = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2];
const sw8 = (amp, ph = 0) => T.map((t) => Math.sin(((t / 1.2) * 2 + ph) * Math.PI) * amp);
const walk = new THREE.AnimationClip('Ходьба', 1.2, [
new THREE.VectorKeyframeTrack('Hips.position', T, T.flatMap((t) => [0, 1.0 + Math.abs(Math.sin((t / 1.2) * 2 * Math.PI)) * 0.04, 0])),
rot('HipL', T, sw8(0.6).map((a) => [a, 0, 0])),
rot('HipR', T, sw8(0.6, 1).map((a) => [a, 0, 0])),
rot('KneeL', T, sw8(0.5, 0.5).map((a) => [Math.max(0, a) + 0.1, 0, 0])),
rot('KneeR', T, sw8(0.5, 1.5).map((a) => [Math.max(0, a) + 0.1, 0, 0])),
rot('ShoulderL', T, sw8(0.5, 1).map((a) => [0, 0, a * 0.3])),
rot('ShoulderR', T, sw8(0.5).map((a) => [0, 0, a * 0.3])),
rot('ElbowL', T, sw8(0.4).map((a) => [0, a, 0])),
rot('ElbowR', T, sw8(0.4, 1).map((a) => [0, a, 0])),
rot('Spine', T, sw8(0.15).map((a) => [0, a, 0])),
]);
const T2 = [0, 0.4, 0.8, 1.2, 1.6, 2.0];
const wave = new THREE.AnimationClip('Приветствие', 2.0, [
rot('ShoulderR', T2, [[0, 0, 0], [0, 0, 1.9], [0, 0, 1.9], [0, 0, 1.9], [0, 0, 1.9], [0, 0, 0]]),
rot('ElbowR', T2, [[0, 0, 0], [0, 0.2, 0], [0, -0.7, 0], [0, 0.2, 0], [0, -0.7, 0], [0, 0, 0]]),
rot('Head', T2, [[0, 0, 0], [0, 0.2, 0.1], [0, 0.2, 0.1], [0, -0.2, -0.1], [0, 0, 0], [0, 0, 0]]),
rot('Spine', T2, [[0, 0, 0], [0.05, 0, 0.05], [0.05, 0, 0.05], [0.05, 0, -0.05], [0, 0, 0], [0, 0, 0]]),
]);
const scene = new THREE.Scene();
scene.add(root);
const buf = await new GLTFExporter().parseAsync(scene, { binary: true, animations: [walk, wave], trs: true });
return new File([buf], 'demo-character.glb', { type: 'model/gltf-binary' });
}
