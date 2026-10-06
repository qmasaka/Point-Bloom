import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { weldExact, triangleCount } from './geom.js';
import { materialTextures, hasAlphaChannel } from './materials.js';
import { bakeVertexColors, sampleSurface, verticesToCloud, cloudToPoints } from './pointcloud.js';
import { safeName, yieldUI, stripExt } from './util.js';
import { Display } from './display.js';
export const EXPORT_FORMATS = [
{ id: 'glb', label: 'GLB', ext: 'glb', title: 'glTF Binary', hint: 'Один файл с геометрией и текстурами. Лучший выбор для веба, AR и игровых движков.' },
{ id: 'gltf', label: 'glTF', ext: 'gltf', title: 'glTF (JSON)', hint: 'Текстовый glTF, ресурсы встроены внутрь. Удобно читать и править.' },
{ id: 'usdz', label: 'USDZ', ext: 'usdz', title: 'USDZ (Apple AR)', hint: 'Для дополненной реальности на iPhone и iPad (Quick Look) и приложений Apple. Нужны только меши с материалами.' },
{ id: 'web', label: 'Сайт', ext: 'zip', title: 'Для сайта', hint: 'Готовая веб-страница с интерактивной 3D-моделью и код, который можно вставить на любой сайт.' },
{ id: 'obj', label: 'OBJ', ext: 'zip', title: 'OBJ + MTL', hint: 'ZIP с .obj, .mtl и текстурами. Если текстур нет, скачается один .obj.' },
{ id: 'ply', label: 'PLY', ext: 'ply', title: 'PLY', hint: 'Сетка или облако точек с цветами вершин (цвет запекается из текстуры).' },
{ id: 'stl', label: 'STL', ext: 'stl', title: 'STL', hint: 'Только геометрия, без цвета. Для 3D-печати.' },
];
function pairUp(a, b, out) {
out.push([a, b]);
for (let i = 0; i < a.children.length; i++) pairUp(a.children[i], b.children[i], out);
}
export async function buildExportScene(app, o, progress) {
const vp = app.viewport;
const model = app.model;
let roots = o.only === 'selected' && model.selected ? [model.selected] : vp.root.children.filter((c) => !c.userData.helper);
roots = roots.filter((r) => r.visible);
if (!roots.length) throw new Error('В сцене нет видимых объектов для экспорта');
vp.root.updateMatrixWorld(true);
let group = new THREE.Group();
const pairs = [];
for (const r of roots) {
const c = r.clone(true);
pairUp(r, c, pairs);
r.updateWorldMatrix(true, false);
const parentWorld = r.parent ? r.parent.matrixWorld : new THREE.Matrix4();
c.applyMatrix4(parentWorld);
group.add(c);
}
for (const [src, dst] of pairs) {
if (src.isMesh || src.isPoints) dst.material = app.display.getOriginal(src);
}
Display.stripHelpers(group);
group.updateMatrixWorld(true);
if (o.cloud && o.cloud !== 'mesh') {
const entries = [];
const keep = [];
group.traverse((n) => {
if (n.isMesh) entries.push({ mesh: n, mats: n.material });
else if (n.isPoints) keep.push(n);
});
if (!entries.length && !keep.length) throw new Error('Нет мешей, из которых можно сделать облако точек');
let cloud;
if (entries.length) {
progress && progress('Строю облако точек', 0.15);
await yieldUI();
cloud =
o.cloud === 'vertices'
? verticesToCloud(entries)
: await sampleSurface(entries, o.cloudCount, { onProgress: (p) => progress && progress('Строю облако точек', 0.15 + p * 0.4) });
}
const g2 = new THREE.Group();
if (cloud && cloud.count) {
const pts = cloudToPoints(cloud, o.name || 'Облако точек');
if (o.format === 'glb' || o.format === 'gltf') pts.geometry.deleteAttribute('normal');
g2.add(pts);
}
for (const p of keep) {
p.updateWorldMatrix(true, false);
const c = p.clone();
c.matrix.copy(p.matrixWorld);
c.matrix.decompose(c.position, c.quaternion, c.scale);
g2.add(c);
}
group = g2;
group.updateMatrixWorld(true);
}
group.scale.setScalar(o.scale || 1);
if (o.up === 'z') group.rotation.x = -Math.PI / 2;
group.updateMatrixWorld(true);
if (o.place && o.place !== 'keep') {
const box = new THREE.Box3().setFromObject(group);
if (!box.isEmpty()) {
const c = box.getCenter(new THREE.Vector3());
if (o.place === 'center') group.position.sub(c);
else if (o.place === 'floor') group.position.set(group.position.x - c.x, group.position.y - box.min.y, group.position.z - c.z);
}
}
group.updateMatrix();
for (const child of [...group.children]) child.applyMatrix4(group.matrix);
group.position.set(0, 0, 0);
group.rotation.set(0, 0, 0);
group.scale.set(1, 1, 1);
const scene = new THREE.Scene();
scene.name = o.name || 'Scene';
for (const child of [...group.children]) scene.add(child);
scene.updateMatrixWorld(true);
if (o.dropUnusedUV !== false) {
const cache = new Map();
scene.traverse((n) => {
if (!n.isMesh || !n.geometry.attributes.uv || n.isSkinnedMesh) return;
const mats = Array.isArray(n.material) ? n.material : [n.material];
const textured = mats.some((m) => m && materialTextures(m).length);
if (textured) return;
if (!cache.has(n.geometry)) {
const g = new THREE.BufferGeometry();
for (const [k, a] of Object.entries(n.geometry.attributes)) if (k !== 'uv' && k !== 'uv1') g.setAttribute(k, a);
if (n.geometry.index) g.setIndex(n.geometry.index);
for (const grp of n.geometry.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
cache.set(n.geometry, g);
}
n.geometry = cache.get(n.geometry);
});
}
if (o.weld) {
const cache = new Map();
scene.traverse((n) => {
if (n.isMesh && !n.geometry.index && !n.isSkinnedMesh) {
if (!cache.has(n.geometry)) cache.set(n.geometry, weldExact(n.geometry));
n.geometry = cache.get(n.geometry);
}
});
}
return scene;
}
function collectMaterials(scene) {
const set = new Set();
scene.traverse((n) => {
if (!(n.isMesh || n.isPoints)) return;
(Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m && set.add(m));
});
return [...set];
}
function collectTextures(scene) {
const set = new Set();
for (const m of collectMaterials(scene)) for (const { texture } of materialTextures(m)) set.add(texture);
return [...set];
}
function sceneStats(scene) {
let verts = 0, tris = 0, points = 0, meshes = 0;
scene.traverse((n) => {
if (n.isMesh) {
meshes++;
verts += n.geometry.attributes.position.count;
tris += triangleCount(n.geometry);
} else if (n.isPoints) {
meshes++;
points += n.geometry.attributes.position.count;
}
});
return { verts, tris, points, meshes };
}
async function exportGLTF(scene, o, binary) {
const textures = collectTextures(scene);
for (const t of textures) {
let mime = 'image/png';
if (o.texFormat === 'jpeg') {
const a = hasAlphaChannel(t);
mime = a && a.any ? 'image/png' : 'image/jpeg';
} else if (o.texFormat === 'auto') mime = (t.userData && t.userData.mime) || 'image/png';
if (!t.userData) t.userData = {};
t.userData.mimeType = mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
}
const exporter = new GLTFExporter();
const result = await exporter.parseAsync(scene, { binary, trs: true, onlyVisible: true, maxTextureSize: o.maxTex > 0 ? o.maxTex : Infinity });
if (binary) return { blob: new Blob([result], { type: 'model/gltf-binary' }), buffer: result };
const json = JSON.stringify(result);
return { blob: new Blob([json], { type: 'model/gltf+json' }), buffer: null };
}
export async function verifyGLB(buffer) {
const problems = [];
const dv = new DataView(buffer);
if (dv.getUint32(0, true) !== 0x46546c67) problems.push('Нет сигнатуры glTF');
if (dv.getUint32(4, true) !== 2) problems.push('Версия не 2');
if (dv.getUint32(8, true) !== buffer.byteLength) problems.push('Длина в заголовке не совпадает с размером файла');
const jsonLen = dv.getUint32(12, true);
let json = null;
try {
json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
} catch (e) {
problems.push('JSON-блок повреждён');
}
let binLen = 0;
const binStart = 20 + jsonLen;
if (binStart + 8 <= buffer.byteLength) binLen = dv.getUint32(binStart, true);
const counts = {};
if (json) {
for (const k of ['scenes', 'nodes', 'meshes', 'materials', 'textures', 'images', 'accessors', 'bufferViews']) counts[k] = (json[k] || []).length;
for (const bv of json.bufferViews || []) if ((bv.byteOffset || 0) + bv.byteLength > binLen) problems.push('bufferView выходит за границы BIN-блока');
for (const a of json.accessors || []) if (a.bufferView !== undefined && !(json.bufferViews || [])[a.bufferView]) problems.push('Accessor ссылается на отсутствующий bufferView');
for (const im of json.images || []) if (im.bufferView === undefined && !im.uri) problems.push('У изображения нет данных');
let tris = 0, verts = 0;
for (const m of json.meshes || []) {
for (const p of m.primitives || []) {
const pos = json.accessors[p.attributes.POSITION];
if (pos) verts += pos.count;
const mode = p.mode === undefined ? 4 : p.mode;
if (mode === 4) tris += p.indices !== undefined ? json.accessors[p.indices].count / 3 : pos ? pos.count / 3 : 0;
}
}
counts.tris = Math.round(tris);
counts.verts = verts;
}
let loadOk = false;
if (!problems.length) {
try {
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(buffer, '');
loadOk = !!gltf.scene;
gltf.scene.traverse((n) => {
if (n.geometry) n.geometry.dispose();
if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => {
for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose();
m.dispose();
});
});
} catch (e) {
problems.push('Загрузчик не смог открыть файл: ' + (e.message || e));
}
}
return { ok: problems.length === 0 && loadOk, problems, counts };
}
function srgbByte(v) {
const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
return Math.max(0, Math.min(255, Math.round(c * 255)));
}
function exportPLY(scene, o) {
const parts = [];
scene.updateMatrixWorld(true);
scene.traverse((n) => {
if (!(n.isMesh || n.isPoints)) return;
const g = n.geometry;
const pos = g.attributes.position;
const cnt = pos.count;
const e = n.matrixWorld.elements;
const nm = new THREE.Matrix3().getNormalMatrix(n.matrixWorld).elements;
const p = new Float32Array(cnt * 3);
const nn = new Float32Array(cnt * 3);
for (let i = 0; i < cnt; i++) {
const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
p[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
p[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
p[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
const nr = g.attributes.normal;
if (nr) {
const lx = nr.getX(i), ly = nr.getY(i), lz = nr.getZ(i);
const gx = nm[0] * lx + nm[3] * ly + nm[6] * lz;
const gy = nm[1] * lx + nm[4] * ly + nm[7] * lz;
const gz = nm[2] * lx + nm[5] * ly + nm[8] * lz;
const l = Math.hypot(gx, gy, gz) || 1;
nn[i * 3] = gx / l; nn[i * 3 + 1] = gy / l; nn[i * 3 + 2] = gz / l;
}
}
let colors;
if (n.isMesh) colors = bakeVertexColors(g, n.material);
else if (g.attributes.color) {
colors = new Float32Array(cnt * 3);
for (let i = 0; i < cnt; i++) {
colors[i * 3] = g.attributes.color.getX(i);
colors[i * 3 + 1] = g.attributes.color.getY(i);
colors[i * 3 + 2] = g.attributes.color.getZ(i);
}
} else colors = new Float32Array(cnt * 3).fill(1);
let indices = null;
if (n.isMesh) {
const idx = g.index;
const T = Math.floor((idx ? idx.count : cnt) / 3);
indices = new Uint32Array(T * 3);
const flip = n.matrixWorld.determinant() < 0;
for (let t = 0; t < T; t++) {
const a = idx ? idx.getX(t * 3) : t * 3;
const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
indices[t * 3] = a;
indices[t * 3 + 1] = flip ? c : b;
indices[t * 3 + 2] = flip ? b : c;
}
}
parts.push({ p, nn, colors, indices, count: cnt, hasNormals: !!g.attributes.normal });
});
const totalV = parts.reduce((s, x) => s + x.count, 0);
const totalF = parts.reduce((s, x) => s + (x.indices ? x.indices.length / 3 : 0), 0);
const withNormals = parts.every((x) => x.hasNormals);
const header =
'ply\nformat binary_little_endian 1.0\ncomment Point Bloom\n' +
`element vertex ${totalV}\nproperty float x\nproperty float y\nproperty float z\n` +
(withNormals ? 'property float nx\nproperty float ny\nproperty float nz\n' : '') +
'property uchar red\nproperty uchar green\nproperty uchar blue\n' +
(totalF ? `element face ${totalF}\nproperty list uchar int vertex_indices\n` : '') +
'end_header\n';
const head = new TextEncoder().encode(header);
const stride = 12 + (withNormals ? 12 : 0) + 3;
const body = new ArrayBuffer(totalV * stride + totalF * 13);
const dv = new DataView(body);
let off = 0;
for (const part of parts) {
for (let i = 0; i < part.count; i++) {
dv.setFloat32(off, part.p[i * 3], true);
dv.setFloat32(off + 4, part.p[i * 3 + 1], true);
dv.setFloat32(off + 8, part.p[i * 3 + 2], true);
off += 12;
if (withNormals) {
dv.setFloat32(off, part.nn[i * 3], true);
dv.setFloat32(off + 4, part.nn[i * 3 + 1], true);
dv.setFloat32(off + 8, part.nn[i * 3 + 2], true);
off += 12;
}
dv.setUint8(off, srgbByte(part.colors[i * 3]));
dv.setUint8(off + 1, srgbByte(part.colors[i * 3 + 1]));
dv.setUint8(off + 2, srgbByte(part.colors[i * 3 + 2]));
off += 3;
}
}
let base = 0;
for (const part of parts) {
if (part.indices) {
for (let t = 0; t < part.indices.length; t += 3) {
dv.setUint8(off, 3);
dv.setInt32(off + 1, base + part.indices[t], true);
dv.setInt32(off + 5, base + part.indices[t + 1], true);
dv.setInt32(off + 9, base + part.indices[t + 2], true);
off += 13;
}
}
base += part.count;
}
return new Blob([head, body.slice(0, off)], { type: 'application/octet-stream' });
}
function exportSTL(scene) {
const meshes = new THREE.Scene();
scene.updateMatrixWorld(true);
scene.traverse((n) => {
if (!n.isMesh) return;
const m = new THREE.Mesh(n.geometry, new THREE.MeshBasicMaterial());
m.matrix.copy(n.matrixWorld);
m.matrix.decompose(m.position, m.quaternion, m.scale);
meshes.add(m);
});
if (!meshes.children.length) throw new Error('STL хранит только сетки: в сцене нет мешей');
const data = new STLExporter().parse(meshes, { binary: true });
return new Blob([data], { type: 'model/stl' });
}
async function exportUSDZ(scene, o) {
let meshes = 0;
scene.traverse((n) => {
if (n.isMesh) meshes++;
});
if (!meshes) throw new Error('USDZ хранит только меши: в сцене нет мешей (облака точек не подходят)');
const data = await new USDZExporter().parseAsync(scene, { quickLookCompatible: true, maxTextureSize: o.maxTex > 0 ? o.maxTex : 2048, onlyVisible: true });
return new Blob([data], { type: 'model/vnd.usdz+zip' });
}
const CRC_TABLE = (() => {
const t = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
let c = n;
for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
t[n] = c >>> 0;
}
return t;
})();
function crc32(bytes) {
let c = 0xffffffff;
for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
return (c ^ 0xffffffff) >>> 0;
}
export function makeZip(files) {
const enc = new TextEncoder();
const chunks = [];
const central = [];
let offset = 0;
for (const f of files) {
const nameBytes = enc.encode(f.name);
const crc = crc32(f.bytes);
const local = new DataView(new ArrayBuffer(30));
local.setUint32(0, 0x04034b50, true);
local.setUint16(4, 20, true);
local.setUint16(6, 0x0800, true);
local.setUint16(8, 0, true);
local.setUint16(10, 0, true);
local.setUint16(12, 0x21, true);
local.setUint32(14, crc, true);
local.setUint32(18, f.bytes.length, true);
local.setUint32(22, f.bytes.length, true);
local.setUint16(26, nameBytes.length, true);
local.setUint16(28, 0, true);
chunks.push(local.buffer, nameBytes, f.bytes);
const cd = new DataView(new ArrayBuffer(46));
cd.setUint32(0, 0x02014b50, true);
cd.setUint16(4, 20, true);
cd.setUint16(6, 20, true);
cd.setUint16(8, 0x0800, true);
cd.setUint16(12, 0, true);
cd.setUint16(14, 0x21, true);
cd.setUint32(16, crc, true);
cd.setUint32(20, f.bytes.length, true);
cd.setUint32(24, f.bytes.length, true);
cd.setUint16(28, nameBytes.length, true);
cd.setUint32(42, offset, true);
central.push(cd.buffer, nameBytes);
offset += 30 + nameBytes.length + f.bytes.length;
}
let cdSize = 0;
for (const c of central) cdSize += c.byteLength;
const end = new DataView(new ArrayBuffer(22));
end.setUint32(0, 0x06054b50, true);
end.setUint16(8, files.length, true);
end.setUint16(10, files.length, true);
end.setUint32(12, cdSize, true);
end.setUint32(16, offset, true);
return new Blob([...chunks, ...central, end.buffer], { type: 'application/zip' });
}
async function textureBytes(tex, usedNames) {
let name = (tex.userData && tex.userData.fileName) || (tex.name || 'texture') + '.png';
name = safeName(name);
let base = stripExt(name), ext = name.slice(base.length) || '.png';
let n = 1;
while (usedNames.has(name.toLowerCase())) name = `${base}_${n++}${ext}`;
usedNames.add(name.toLowerCase());
const file = tex.userData && tex.userData.file;
if (file instanceof Blob && file.size) return { name, bytes: new Uint8Array(await file.arrayBuffer()) };
const img = tex.image;
const c = document.createElement('canvas');
c.width = img.width || img.naturalWidth;
c.height = img.height || img.naturalHeight;
c.getContext('2d').drawImage(img, 0, 0);
const wantJpeg = /\.jpe?g$/i.test(name);
const blob = await new Promise((r) => c.toBlob(r, wantJpeg ? 'image/jpeg' : 'image/png', 0.95));
return { name, bytes: new Uint8Array(await blob.arrayBuffer()) };
}
async function exportOBJ(scene, o, baseName) {
scene.updateMatrixWorld(true);
const out = [`# Point Bloom\nmtllib ${baseName}.mtl\n`];
const mats = new Map();
const usedMtlNames = new Set();
const matName = (m) => {
if (!mats.has(m)) {
let n = safeName(m.name || 'material').replace(/\s+/g, '_');
const b = n;
let i = 1;
while (usedMtlNames.has(n)) n = `${b}_${i++}`;
usedMtlNames.add(n);
mats.set(m, n);
}
return mats.get(m);
};
let vOff = 1, tOff = 1, nOff = 1;
scene.traverse((n) => {
if (!n.isMesh) return;
const g = n.geometry;
const pos = g.attributes.position;
const uv = g.attributes.uv;
const nr = g.attributes.normal;
const mlist = Array.isArray(n.material) ? n.material : [n.material];
const gltfUV = mlist[0] && mlist[0].map && mlist[0].map.flipY === false;
const e = n.matrixWorld.elements;
const nm = new THREE.Matrix3().getNormalMatrix(n.matrixWorld).elements;
const flip = n.matrixWorld.determinant() < 0;
out.push(`o ${(n.name || 'mesh').replace(/\s+/g, '_')}\n`);
let buf = [];
const flush = () => {
out.push(buf.join(''));
buf = [];
};
for (let i = 0; i < pos.count; i++) {
const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
buf.push(`v ${e[0] * x + e[4] * y + e[8] * z + e[12]} ${e[1] * x + e[5] * y + e[9] * z + e[13]} ${e[2] * x + e[6] * y + e[10] * z + e[14]}\n`);
if (buf.length > 8000) flush();
}
if (uv) for (let i = 0; i < uv.count; i++) {
buf.push(`vt ${uv.getX(i)} ${gltfUV ? 1 - uv.getY(i) : uv.getY(i)}\n`);
if (buf.length > 8000) flush();
}
if (nr) for (let i = 0; i < nr.count; i++) {
const lx = nr.getX(i), ly = nr.getY(i), lz = nr.getZ(i);
const gx = nm[0] * lx + nm[3] * ly + nm[6] * lz;
const gy = nm[1] * lx + nm[4] * ly + nm[7] * lz;
const gz = nm[2] * lx + nm[5] * ly + nm[8] * lz;
const l = Math.hypot(gx, gy, gz) || 1;
buf.push(`vn ${gx / l} ${gy / l} ${gz / l}\n`);
if (buf.length > 8000) flush();
}
const idx = g.index;
const T = Math.floor((idx ? idx.count : pos.count) / 3);
const groups = g.groups.length ? g.groups : [{ start: 0, count: T * 3, materialIndex: 0 }];
const fv = (v) => {
const a = v + vOff;
if (uv && nr) return `${a}/${v + tOff}/${v + nOff}`;
if (uv) return `${a}/${v + tOff}`;
if (nr) return `${a}//${v + nOff}`;
return `${a}`;
};
for (const grp of groups) {
const m = mlist[grp.materialIndex] || mlist[0];
buf.push(`usemtl ${matName(m)}\n`);
const t0 = Math.floor(grp.start / 3);
const t1 = Math.min(T, Math.floor((grp.start + grp.count) / 3));
for (let t = t0; t < t1; t++) {
const a = idx ? idx.getX(t * 3) : t * 3;
const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
buf.push(flip ? `f ${fv(a)} ${fv(c)} ${fv(b)}\n` : `f ${fv(a)} ${fv(b)} ${fv(c)}\n`);
if (buf.length > 8000) flush();
}
}
flush();
vOff += pos.count;
if (uv) tOff += uv.count;
if (nr) nOff += nr.count;
});
const files = [];
const usedNames = new Set();
const texNames = new Map();
const tex = async (t) => {
if (!t || !t.image) return null;
if (!texNames.has(t)) {
const f = await textureBytes(t, usedNames);
texNames.set(t, f.name);
files.push({ name: f.name, bytes: f.bytes });
}
return texNames.get(t);
};
const mtl = ['# Point Bloom\n'];
for (const [m, name] of mats) {
const c = m.color || new THREE.Color(1, 1, 1);
const s = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
mtl.push(`\nnewmtl ${name}\nKa 1 1 1\nKd ${s.r.toFixed(4)} ${s.g.toFixed(4)} ${s.b.toFixed(4)}\nKs 0.3 0.3 0.3\n`);
if (m.emissive) {
const em = m.emissive.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
mtl.push(`Ke ${em.r.toFixed(4)} ${em.g.toFixed(4)} ${em.b.toFixed(4)}\n`);
}
const rough = m.roughness === undefined ? 0.8 : m.roughness;
mtl.push(`Ns ${Math.round(Math.pow(1 - rough, 2) * 1000)}\nd ${(m.opacity ?? 1).toFixed(3)}\nillum 2\n`);
let n;
if ((n = await tex(m.map))) mtl.push(`map_Kd ${n}\n`);
if ((n = await tex(m.normalMap))) mtl.push(`map_Bump -bm 1 ${n}\nnorm ${n}\n`);
if ((n = await tex(m.roughnessMap))) mtl.push(`map_Pr ${n}\n`);
if ((n = await tex(m.metalnessMap))) mtl.push(`map_Pm ${n}\n`);
if ((n = await tex(m.emissiveMap))) mtl.push(`map_Ke ${n}\n`);
if ((n = await tex(m.aoMap))) mtl.push(`map_Ka ${n}\n`);
}
const objBlob = new Blob(out, { type: 'text/plain' });
if (!files.length) {
const enc = new TextEncoder();
const objBytes = new Uint8Array(await objBlob.arrayBuffer());
return { blob: makeZip([{ name: baseName + '.obj', bytes: objBytes }, { name: baseName + '.mtl', bytes: enc.encode(mtl.join('')) }]), ext: 'zip' };
}
const enc = new TextEncoder();
const objBytes = new Uint8Array(await objBlob.arrayBuffer());
files.unshift({ name: baseName + '.obj', bytes: objBytes }, { name: baseName + '.mtl', bytes: enc.encode(mtl.join('')) });
return { blob: makeZip(files), ext: 'zip' };
}
export function defaultExportName(app) {
const sel = app.model.selected;
if (sel && sel.name) return safeName(sel.name);
const top = app.viewport.root.children.filter((c) => !c.userData.helper);
if (top.length === 1 && top[0].name) return safeName(top[0].name);
return 'model';
}
export async function exportModel(app, o, progress) {
const t0 = performance.now();
const name = safeName(o.name || defaultExportName(app));
const opts = { ...o, name };
progress && progress('Готовлю сцену', 0.05);
await yieldUI();
const scene = await buildExportScene(app, opts, progress);
const stats = sceneStats(scene);
const textures = collectTextures(scene);
progress && progress('Записываю файл', 0.6);
await yieldUI();
let blob, ext, buffer = null;
switch (o.format) {
case 'glb': {
const r = await exportGLTF(scene, opts, true);
blob = r.blob; buffer = r.buffer; ext = 'glb';
break;
}
case 'gltf': {
const r = await exportGLTF(scene, opts, false);
blob = r.blob; ext = 'gltf';
break;
}
case 'obj': {
const r = await exportOBJ(scene, opts, name);
blob = r.blob; ext = r.ext;
break;
}
case 'ply':
blob = exportPLY(scene, opts);
ext = 'ply';
break;
case 'stl':
blob = exportSTL(scene);
ext = 'stl';
break;
case 'usdz':
blob = await exportUSDZ(scene, opts);
ext = 'usdz';
break;
default:
throw new Error('Неизвестный формат ' + o.format);
}
let verify = null;
if (buffer) {
progress && progress('Проверяю результат', 0.85);
await yieldUI();
verify = await verifyGLB(buffer);
}
scene.traverse((n) => {
if (n.geometry && !app.model.meshes().some((m) => m.geometry === n.geometry) && n.isMesh) n.geometry.dispose();
});
return {
blob,
filename: `${name}.${ext}`,
info: { bytes: blob.size, ...stats, textures: textures.length, ms: Math.round(performance.now() - t0), verify, format: o.format },
};
}
export function estimateExportSize(app, o) {
const st = app.model.stats();
let bytes = 0;
if (o.cloud === 'surface') bytes += o.cloudCount * 24;
else if (o.cloud === 'vertices') bytes += st.verts * 24;
else {
const verts = st.verts;
bytes += verts * 32 + st.tris * 12 + st.points * 24;
}
if (o.cloud === 'mesh' || !o.cloud) {
const seen = new Set();
for (const m of app.model.materials()) {
for (const { texture: t } of materialTextures(m)) {
if (seen.has(t.image)) continue;
seen.add(t.image);
const ud = t.userData || {};
const w = ud.width || (t.image && (t.image.width || t.image.naturalWidth)) || 1024;
const hgt = ud.height || (t.image && (t.image.height || t.image.naturalHeight)) || 1024;
let k = 1;
if (o.maxTex > 0) k = Math.min(1, o.maxTex / Math.max(w, hgt)) ** 2;
const asJpeg = o.texFormat === 'jpeg' || (o.texFormat === 'auto' && ud.mime === 'image/jpeg');
const src = ud.file && ud.file.size && o.texFormat === 'auto' ? ud.file.size : w * hgt * (asJpeg ? 0.35 : 1.3);
bytes += src * k;
}
}
}
return Math.round(bytes);
}
