import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import { XYZLoader } from 'three/addons/loaders/XYZLoader.js';
import { AMFLoader } from 'three/addons/loaders/AMFLoader.js';
import { USDZLoader } from 'three/addons/loaders/USDZLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { extOf, baseName, stripExt, yieldUI } from './util.js';
import { weldExact } from './geom.js';
import { toStandard, finalizeMaterial, fillTextureFromFile, loadTextureFile, detectSlot, assignTexture, slotByKey, SLOTS } from './materials.js';
export const MODEL_FORMATS = {
obj: 'Wavefront OBJ',
glb: 'glTF Binary',
gltf: 'glTF',
fbx: 'Autodesk FBX',
dae: 'Collada',
stl: 'STL',
ply: 'PLY',
'3ds': '3D Studio',
'3mf': '3MF',
pcd: 'PCD (облако точек)',
xyz: 'XYZ (облако точек)',
amf: 'AMF',
usdz: 'USDZ',
off: 'OFF',
};
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tga', 'avif'];
const isModelFile = (f) => extOf(f.name) in MODEL_FORMATS;
const isImageFile = (f) => IMAGE_EXT.includes(extOf(f.name));
export const ACCEPT_ALL = ['.zip', '.mtl', '.bin', ...Object.keys(MODEL_FORMATS).map((e) => '.' + e), ...IMAGE_EXT.map((e) => '.' + e), '.mp4', '.webm', '.mov', '.pcv'].join(',');
class ResourceMap {
constructor(files) {
this.files = files;
this.byName = new Map();
this.byStem = new Map();
this.urls = new Map();
for (const f of files) {
const n = baseName(f.name).toLowerCase();
this.byName.set(n, f);
this.byStem.set(stripExt(n), f);
}
}
clean(p) {
let s = String(p || '');
try {
s = decodeURIComponent(s);
} catch (e) {
}
return baseName(s.replace(/^\.\//, '')).toLowerCase();
}
find(path) {
const n = this.clean(path);
if (!n) return null;
return this.byName.get(n) || this.byStem.get(stripExt(n)) || null;
}
urlFor(path) {
if (/^(data|blob|https?):/i.test(path)) return path;
const f = this.find(path);
if (!f) return null;
if (!this.urls.has(f)) this.urls.set(f, URL.createObjectURL(f));
return this.urls.get(f);
}
dispose() {
for (const u of this.urls.values()) URL.revokeObjectURL(u);
}
}
function makeManager(res, ctx) {
const m = new THREE.LoadingManager();
m.setURLModifier((url) => {
const u = res.urlFor(url);
if (u) return u;
if (!/^(data|blob|https?):/i.test(url)) {
ctx.missing.add(baseName(url));
return 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
}
return url;
});
m.addHandler(/\.tga$/i, new TGALoader(m));
return m;
}
function waitManager(manager, ms = 20000) {
return new Promise((resolve) => {
let started = false;
let done = false;
const finish = () => {
if (!done) {
done = true;
resolve();
}
};
manager.onStart = () => {
started = true;
};
manager.onLoad = finish;
manager.onError = () => {};
setTimeout(() => {
if (!started) finish();
}, 60);
setTimeout(finish, ms);
});
}
async function loadOBJ(file, res, ctx) {
const text = await file.text();
let materials = null;
const wanted = [...text.matchAll(/^mtllib\s+(.+)$/gm)].map((m) => m[1].trim());
let mtlFile = null;
for (const w of wanted) {
mtlFile = res.find(w);
if (mtlFile && extOf(mtlFile.name) === 'mtl') break;
mtlFile = null;
}
if (!mtlFile) {
const mtls = res.files.filter((f) => extOf(f.name) === 'mtl');
if (mtls.length === 1) mtlFile = mtls[0];
}
if (mtlFile) {
const creator = new MTLLoader().parse(await mtlFile.text(), '');
creator.loadTexture = (url) => {
const tex = new THREE.Texture();
const f = res.find(url);
if (f && IMAGE_EXT.includes(extOf(f.name))) {
ctx.pending.push(
fillTextureFromFile(tex, f).catch((e) => ctx.warnings.push(`Текстура «${baseName(url)}»: ${e.message}`))
);
} else {
ctx.missing.add(baseName(url));
}
return tex;
};
creator.preload();
materials = creator;
} else if (wanted.length) {
ctx.warnings.push(`Файл материалов «${wanted[0]}» не найден. Перетащите .mtl и текстуры вместе с моделью.`);
}
const loader = new OBJLoader();
if (materials) loader.setMaterials(materials);
return loader.parse(text);
}
async function loadGLTF(file, res, ctx) {
const manager = makeManager(res, ctx);
const loader = new GLTFLoader(manager);
loader.setMeshoptDecoder(MeshoptDecoder);
const ext = extOf(file.name);
const data = ext === 'glb' ? await file.arrayBuffer() : await file.text();
const wait = waitManager(manager);
const gltf = await new Promise((resolve, reject) => loader.parse(data, '', resolve, (e) => reject(e && e.message ? e : new Error(String(e)))));
await wait;
return gltf.scene;
}
async function loadFBX(file, res, ctx) {
const manager = makeManager(res, ctx);
const wait = waitManager(manager);
const obj = new FBXLoader(manager).parse(await file.arrayBuffer(), '');
await wait;
return obj;
}
async function loadDAE(file, res, ctx) {
const manager = makeManager(res, ctx);
const wait = waitManager(manager);
const dae = new ColladaLoader(manager).parse(await file.text(), '');
await wait;
return dae.scene;
}
async function load3DS(file, res, ctx) {
const manager = makeManager(res, ctx);
const wait = waitManager(manager);
const obj = new TDSLoader(manager).parse(await file.arrayBuffer(), '');
await wait;
return obj;
}
async function load3MF(file, res, ctx) {
const manager = makeManager(res, ctx);
const wait = waitManager(manager);
const obj = new ThreeMFLoader(manager).parse(await file.arrayBuffer());
await wait;
return obj;
}
async function loadAMF(file, res, ctx) {
const manager = makeManager(res, ctx);
return new AMFLoader(manager).parse(await file.arrayBuffer());
}
async function loadUSDZ(file, res, ctx) {
const manager = makeManager(res, ctx);
const wait = waitManager(manager, 8000);
const obj = new USDZLoader(manager).parse(await file.arrayBuffer());
await wait;
return obj;
}
function geometryToObject(geometry, name) {
if (geometry.index || (geometry.attributes.position && geometry.attributes.normal && !geometry.userData.pointsOnly)) {
const hasColor = !!geometry.attributes.color;
const mat = new THREE.MeshStandardMaterial({ name: name || 'Material', color: hasColor ? 0xffffff : 0xb9bec7, roughness: 0.65, metalness: 0.05, vertexColors: hasColor });
return new THREE.Mesh(geometry, mat);
}
const hasColor = !!geometry.attributes.color;
return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.01, vertexColors: hasColor, color: hasColor ? 0xffffff : 0xdddddd, sizeAttenuation: true }));
}
async function loadSTL(file) {
const g = new STLLoader().parse(await file.arrayBuffer());
const hasColor = !!g.attributes.color;
const mat = new THREE.MeshStandardMaterial({ name: 'STL', color: hasColor ? 0xffffff : 0xb9bec7, roughness: 0.6, metalness: 0.1, vertexColors: hasColor });
return new THREE.Mesh(g, mat);
}
async function loadPLY(file) {
const g = new PLYLoader().parse(await file.arrayBuffer());
const hasFaces = !!g.index || (g.attributes.position && g.userData && g.userData.faces);
const hasColor = !!g.attributes.color;
if (g.index) {
if (!g.attributes.normal) g.computeVertexNormals();
return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: 'PLY', color: hasColor ? 0xffffff : 0xb9bec7, roughness: 0.65, metalness: 0.05, vertexColors: hasColor }));
}
void hasFaces;
return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.01, vertexColors: hasColor, color: hasColor ? 0xffffff : 0xdddddd }));
}
async function loadPCD(file) {
return new PCDLoader().parse(await file.arrayBuffer());
}
async function loadXYZ(file) {
const g = new XYZLoader().parse(await file.text());
const hasColor = !!g.attributes.color;
return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.01, vertexColors: hasColor, color: hasColor ? 0xffffff : 0xdddddd }));
}
async function loadOFF(file) {
const lines = (await file.text()).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
let i = 0;
let head = lines[i++] || '';
const colored = /^C?OFF/.test(head) && head.startsWith('COFF');
let counts;
if (/^C?OFF\s+\d/.test(head)) counts = head.replace(/^C?OFF\s+/, '');
else counts = lines[i++];
const [nv, nf] = counts.split(/\s+/).map(Number);
const pos = new Float32Array(nv * 3);
const col = colored ? new Float32Array(nv * 3) : null;
for (let v = 0; v < nv; v++) {
const p = lines[i++].split(/\s+/).map(Number);
pos.set(p.slice(0, 3), v * 3);
if (col) for (let k = 0; k < 3; k++) col[v * 3 + k] = (p[3 + k] ?? 255) / 255;
}
const idx = [];
for (let f = 0; f < nf; f++) {
const p = lines[i++].split(/\s+/).map(Number);
const n = p[0];
for (let k = 1; k < n - 1; k++) idx.push(p[1], p[1 + k], p[2 + k]);
}
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
if (idx.length) {
g.setIndex(idx);
g.computeVertexNormals();
return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: 'OFF', color: col ? 0xffffff : 0xb9bec7, vertexColors: !!col, roughness: 0.65 }));
}
return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.01, vertexColors: !!col }));
}
const LOADERS = {
obj: loadOBJ,
glb: loadGLTF,
gltf: loadGLTF,
fbx: loadFBX,
dae: loadDAE,
'3ds': load3DS,
'3mf': load3MF,
amf: loadAMF,
usdz: loadUSDZ,
stl: loadSTL,
ply: loadPLY,
pcd: loadPCD,
xyz: loadXYZ,
off: loadOFF,
};
function centerObject(obj) {
const box = new THREE.Box3().setFromObject(obj);
if (box.isEmpty()) return;
const c = box.getCenter(new THREE.Vector3());
if (c.lengthSq() < 1e-18) return;
if (obj.isMesh || obj.isPoints) {
obj.geometry.translate(-c.x, -c.y, -c.z);
obj.position.add(c);
} else {
for (const k of obj.children) k.position.sub(c);
obj.position.add(c);
}
obj.updateMatrixWorld(true);
}
function processImported(root, fileName, ctx, opts) {
const name = stripExt(fileName);
const junk = [];
root.traverse((o) => {
if (o.isLight || o.isCamera) junk.push(o);
});
junk.forEach((o) => o.removeFromParent());
const matCache = new Map();
const norm = (m) => {
if (!matCache.has(m)) matCache.set(m, toStandard(m, ctx.report));
return matCache.get(m);
};
let counter = 0;
root.traverse((o) => {
if (o.isMesh) {
o.material = Array.isArray(o.material) ? o.material.map(norm) : norm(o.material);
if (!o.name) o.name = 'Mesh ' + ++counter;
const g = o.geometry;
if (g && !g.attributes.normal && g.attributes.position) g.computeVertexNormals();
if (opts.weld && g && !g.index && !o.isSkinnedMesh && g.attributes.position && g.attributes.position.count < 30_000_000) {
o.geometry = weldExact(g);
if (o.geometry !== g) g.dispose();
}
} else if (o.isPoints && !o.name) o.name = 'Точки ' + ++counter;
});
for (const m of matCache.values()) finalizeMaterial(m);
let top = root;
if (!(root.isMesh || root.isPoints)) {
const kids = root.children.filter((c) => !c.userData.helper);
if (kids.length === 1 && (root.type === 'Group' || root.type === 'Scene') && root.position.lengthSq() === 0 && root.scale.x === 1 && root.rotation.x === 0 && root.rotation.y === 0 && root.rotation.z === 0) {
top = kids[0];
top.removeFromParent();
} else if (root.isScene) {
const grp = new THREE.Group();
for (const k of [...root.children]) grp.add(k);
top = grp;
}
}
top.name = name || top.name || 'Модель';
if (opts.centerOrigin) {
top.updateMatrixWorld(true);
centerObject(top);
}
return top;
}
async function expandZips(files, ctx) {
const out = [];
for (const f of files) {
if (extOf(f.name) !== 'zip') {
out.push(f);
continue;
}
try {
const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
let n = 0;
for (const [path, bytes] of Object.entries(entries)) {
if (path.endsWith('/') || path.includes('__MACOSX') || baseName(path).startsWith('.')) continue;
out.push(new File([bytes], baseName(path), { type: '' }));
n++;
}
ctx.notes.push(`Архив «${f.name}»: ${n} файл(ов)`);
} catch (e) {
ctx.warnings.push(`Не удалось распаковать «${f.name}»: ${e.message}`);
}
}
return out;
}
export async function importFiles(app, fileList, { mode = 'auto', opts } = {}) {
const ctx = { pending: [], warnings: [], missing: new Set(), notes: [], report: {} };
const options = opts || app.settings.importOpts;
let files = await expandZips(Array.from(fileList), ctx);
const models = files.filter(isModelFile);
const images = files.filter(isImageFile);
const result = { models: [], warnings: ctx.warnings, assigned: [] };
if (!models.length) {
if (images.length) {
result.assigned = await assignTextureFiles(app, images, null);
} else if (files.length) {
ctx.warnings.push('Не нашёл поддерживаемых файлов. Нужна модель (OBJ, GLB, FBX, STL, PLY…) или изображение-текстура.');
}
return result;
}
const res = new ResourceMap(files);
const loaded = [];
for (let i = 0; i < models.length; i++) {
const f = models[i];
const ext = extOf(f.name);
app.ui.busy(`Читаю ${f.name}${models.length > 1 ? ` (${i + 1} из ${models.length})` : ''}`, i / models.length);
await yieldUI();
try {
const raw = await LOADERS[ext](f, res, ctx);
app.ui.busy(`Обрабатываю ${f.name}`, (i + 0.6) / models.length);
await yieldUI();
await Promise.all(ctx.pending);
ctx.pending.length = 0;
loaded.push({ file: f, object: processImported(raw, f.name, ctx, options) });
} catch (e) {
console.error(e);
let msg = e && e.message ? e.message : String(e);
if (/draco/i.test(msg)) msg = 'модель сжата Draco (пока не поддерживается)';
ctx.warnings.push(`Не удалось открыть «${f.name}»: ${msg}`);
}
}
res.dispose();
if (!loaded.length) return result;
let replace = mode === 'replace';
if (mode === 'auto') replace = app.model.renderables().length === 0;
if (replace) app.model.clear();
app.display.apply();
const placed = replace ? new THREE.Box3() : app.viewport.getBounds(app.viewport.root);
for (const { object } of loaded) {
app.model.add(object, app.viewport.root);
if (!placed.isEmpty()) {
const b = app.viewport.getBounds(object);
if (!b.isEmpty()) {
const gap = Math.max(placed.max.x - placed.min.x, b.max.x - b.min.x, 1e-6) * 0.15;
object.position.x += placed.max.x + gap - b.min.x;
object.updateMatrixWorld(true);
}
}
placed.union(app.viewport.getBounds(object));
}
app.model.changed();
result.models = loaded.map((l) => l.file.name);
app.model.select(loaded.length === 1 ? loaded[0].object : null);
if (images.length) {
const hasTextures = app.model.materials().some((m) => SLOTS.some((s) => m[s.key]));
if (!hasTextures || !models.some((f) => extOf(f.name) === 'obj')) {
result.assigned = await assignTextureFiles(app, images, null, { quiet: true });
}
}
if (ctx.missing.size) ctx.warnings.push('Не найдены текстуры: ' + [...ctx.missing].slice(0, 6).join(', ') + (ctx.missing.size > 6 ? '…' : '') + '. Перетащите их вместе с моделью или добавьте на вкладке «Материал».');
if (ctx.report.bump) ctx.warnings.push('Bump-карты преобразованы в карты нормалей.');
return result;
}
export async function assignTextureFiles(app, imageFiles, material, { forceSlot = null, quiet = false } = {}) {
const mats = app.model.materials();
if (!mats.length) {
app.toast('Сначала загрузите модель, затем добавляйте текстуры', 'warn');
return [];
}
let target = material || app.model.activeMaterial;
if (!target || !mats.includes(target)) target = mats[0];
const assigned = [];
const multi = imageFiles.length > 1;
for (const f of imageFiles) {
let slotKey = forceSlot || detectSlot(f.name);
if (slotKey === 'unsupported') {
if (multi) {
app.toast(`Пропущено «${f.name}»: такой тип карты не поддерживается в glTF`, 'warn');
continue;
}
slotKey = 'map';
}
try {
app.ui.busy('Загружаю текстуру ' + f.name);
const tex = await loadTextureFile(f);
const old = target[slotKey];
const placed = assignTexture(target, slotKey, tex);
const m = target;
app.history.push(
{
label: 'Текстура: ' + f.name,
redo: () => {
m[slotKey] = placed;
m.needsUpdate = true;
app.afterMaterialChange();
},
undo: () => {
m[slotKey] = old || null;
m.needsUpdate = true;
app.afterMaterialChange();
},
},
false
);
assigned.push({ file: f.name, slot: slotKey, material: m.name || 'Материал' });
} catch (e) {
console.error(e);
app.toast(`Не удалось загрузить «${f.name}»: ${e.message}`, 'error');
}
}
app.afterMaterialChange();
if (assigned.length && !quiet) {
const label = assigned.map((a) => `${slotByKey(a.slot).short}`).join(', ');
app.toast(`Текстура применена (${label}) к «${assigned[0].material}»`, 'ok');
}
app.ui.idle();
return assigned;
}
