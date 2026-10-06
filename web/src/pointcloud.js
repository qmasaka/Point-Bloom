import * as THREE from 'three';
import { yieldUI } from './util.js';
import { weldExact } from './geom.js';
const SRGB_LUT = (() => {
const a = new Float32Array(256);
for (let i = 0; i < 256; i++) {
const c = i / 255;
a[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
return a;
})();
const pixelCache = new WeakMap();
function pixelData(tex) {
const img = tex && tex.image;
if (!img) return null;
const cached = pixelCache.get(img);
if (cached) return cached;
const w0 = img.width || img.naturalWidth;
const h0 = img.height || img.naturalHeight;
if (!w0 || !h0) return null;
const k = Math.min(1, 4096 / Math.max(w0, h0));
const w = Math.max(1, Math.round(w0 * k));
const h = Math.max(1, Math.round(h0 * k));
const c = document.createElement('canvas');
c.width = w;
c.height = h;
const ctx = c.getContext('2d', { willReadFrequently: true });
ctx.drawImage(img, 0, 0, w, h);
const rec = { data: ctx.getImageData(0, 0, w, h).data, w, h };
pixelCache.set(img, rec);
return rec;
}
export function makeTextureSampler(tex) {
const rec = pixelData(tex);
if (!rec) return null;
tex.updateMatrix();
const e = tex.matrix.elements;
const { data, w, h } = rec;
const srgb = tex.colorSpace === THREE.SRGBColorSpace;
const flipY = tex.flipY;
const conv = (b) => (srgb ? SRGB_LUT[b] : b / 255);
return (u, v, out, o) => {
let uu = e[0] * u + e[3] * v + e[6];
let vv = e[1] * u + e[4] * v + e[7];
uu -= Math.floor(uu);
vv -= Math.floor(vv);
const row = flipY ? 1 - vv : vv;
const x = uu * w - 0.5;
const y = row * h - 0.5;
const x0 = Math.floor(x);
const y0 = Math.floor(y);
const fx = x - x0;
const fy = y - y0;
const xa = ((x0 % w) + w) % w;
const xb = (xa + 1) % w;
const ya = ((y0 % h) + h) % h;
const yb = (ya + 1) % h;
const i00 = (ya * w + xa) * 4;
const i10 = (ya * w + xb) * 4;
const i01 = (yb * w + xa) * 4;
const i11 = (yb * w + xb) * 4;
for (let c = 0; c < 3; c++) {
const a = conv(data[i00 + c]) * (1 - fx) + conv(data[i10 + c]) * fx;
const b = conv(data[i01 + c]) * (1 - fx) + conv(data[i11 + c]) * fx;
out[o + c] = a * (1 - fy) + b * fy;
}
};
}
function makeColorFn(material) {
const tex = material && material.map ? makeTextureSampler(material.map) : null;
const base = material && material.color ? material.color : new THREE.Color(1, 1, 1);
const useVC = !!(material && material.vertexColors);
const tmp = [0, 0, 0];
return (u, v, vc, out, o) => {
let r = base.r, g = base.g, b = base.b;
if (tex) {
tex(u, v, tmp, 0);
r *= tmp[0]; g *= tmp[1]; b *= tmp[2];
}
if (useVC && vc) {
r *= vc[0]; g *= vc[1]; b *= vc[2];
}
out[o] = r; out[o + 1] = g; out[o + 2] = b;
};
}
export function bakeVertexColors(geometry, mats) {
const g = geometry;
const pos = g.attributes.position;
const n = pos.count;
const out = new Float32Array(n * 3);
const list = Array.isArray(mats) ? mats : [mats];
const fns = list.map(makeColorFn);
const uv = g.attributes.uv;
const vcAttr = g.attributes.color;
const vc = [1, 1, 1];
const fill = (v, fn) => {
if (vcAttr) {
vc[0] = vcAttr.getX(v); vc[1] = vcAttr.getY(v); vc[2] = vcAttr.getZ(v);
}
fn(uv ? uv.getX(v) : 0, uv ? uv.getY(v) : 0, vcAttr ? vc : null, out, v * 3);
};
const first = fns[0] || makeColorFn(null);
for (let v = 0; v < n; v++) fill(v, first);
if (g.groups.length && fns.length > 1) {
const idx = g.index;
for (const grp of g.groups) {
const fn = fns[grp.materialIndex] || first;
const end = Math.min(grp.start + grp.count, idx ? idx.count : n);
for (let i = grp.start; i < end; i++) fill(idx ? idx.getX(i) : i, fn);
}
}
return out;
}
export function colorSignature(mesh, mats) {
const list = Array.isArray(mats) ? mats : [mats];
return list
.map((m) => {
if (!m) return '-';
const t = m.map;
return [m.uuid, m.color ? m.color.getHexString() : '', t ? t.uuid + ':' + t.version + ':' + t.flipY + ':' + t.repeat.x + ',' + t.repeat.y + ',' + t.offset.x + ',' + t.offset.y : '', m.vertexColors ? 'vc' : ''].join('|');
})
.join('#') + '@' + mesh.geometry.uuid;
}
function mulberry32(a) {
return function () {
a |= 0;
a = (a + 0x6d2b79f5) | 0;
let t = Math.imul(a ^ (a >>> 15), 1 | a);
t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}
export async function sampleSurface(entries, count, { seed = 1337, onProgress } = {}) {
const rng = mulberry32(seed);
const parts = [];
let totalArea = 0;
for (const { mesh, mats } of entries) {
const g = mesh.geometry;
const pos = g.attributes.position;
if (!pos) continue;
mesh.updateWorldMatrix(true, false);
const idx = g.index;
const T = Math.floor((idx ? idx.count : pos.count) / 3);
if (T === 0) continue;
const e = mesh.matrixWorld.elements;
const wp = new Float32Array(pos.count * 3);
for (let i = 0; i < pos.count; i++) {
const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
wp[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
wp[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
wp[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
}
const tri = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
const cum = new Float64Array(T);
let acc = 0;
for (let t = 0; t < T; t++) {
const a = tri(t, 0) * 3, b = tri(t, 1) * 3, c = tri(t, 2) * 3;
const ux = wp[b] - wp[a], uy = wp[b + 1] - wp[a + 1], uz = wp[b + 2] - wp[a + 2];
const vx = wp[c] - wp[a], vy = wp[c + 1] - wp[a + 1], vz = wp[c + 2] - wp[a + 2];
acc += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
cum[t] = acc;
}
if (acc <= 0) continue;
let triMat = null;
if (g.groups.length) {
triMat = new Uint8Array(T);
for (const grp of g.groups) {
const t0 = Math.floor(grp.start / 3);
const t1 = Math.min(T, Math.floor((grp.start + grp.count) / 3));
for (let t = t0; t < t1; t++) triMat[t] = grp.materialIndex;
}
}
const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld).elements;
const list = Array.isArray(mats) ? mats : [mats];
parts.push({ mesh, g, wp, tri, T, cum, area: acc, triMat, nm, fns: list.map(makeColorFn), uv: g.attributes.uv, nrm: g.attributes.normal, vcol: g.attributes.color });
totalArea += acc;
}
if (!parts.length) return { positions: new Float32Array(0), colors: new Float32Array(0), normals: new Float32Array(0), count: 0 };
let remaining = count;
parts.forEach((p, i) => {
p.n = i === parts.length - 1 ? remaining : Math.min(remaining, Math.round((count * p.area) / totalArea));
remaining -= p.n;
});
const positions = new Float32Array(count * 3);
const colors = new Float32Array(count * 3);
const normals = new Float32Array(count * 3);
let w = 0;
const vc = [1, 1, 1];
const tmpC = [0, 0, 0];
for (const p of parts) {
const { wp, tri, cum, T, uv, nrm, vcol, nm } = p;
for (let s = 0; s < p.n; s++, w++) {
const r = rng() * p.area;
let lo = 0, hi = T - 1;
while (lo < hi) {
const mid = (lo + hi) >> 1;
if (cum[mid] < r) lo = mid + 1;
else hi = mid;
}
const t = lo;
const i0 = tri(t, 0), i1 = tri(t, 1), i2 = tri(t, 2);
const r1 = Math.sqrt(rng());
const r2 = rng();
const A = 1 - r1, B = r1 * (1 - r2), C = r1 * r2;
const o = w * 3;
const a = i0 * 3, b = i1 * 3, c = i2 * 3;
positions[o] = A * wp[a] + B * wp[b] + C * wp[c];
positions[o + 1] = A * wp[a + 1] + B * wp[b + 1] + C * wp[c + 1];
positions[o + 2] = A * wp[a + 2] + B * wp[b + 2] + C * wp[c + 2];
let nx, ny, nz;
if (nrm) {
const lx = A * nrm.getX(i0) + B * nrm.getX(i1) + C * nrm.getX(i2);
const ly = A * nrm.getY(i0) + B * nrm.getY(i1) + C * nrm.getY(i2);
const lz = A * nrm.getZ(i0) + B * nrm.getZ(i1) + C * nrm.getZ(i2);
nx = nm[0] * lx + nm[3] * ly + nm[6] * lz;
ny = nm[1] * lx + nm[4] * ly + nm[7] * lz;
nz = nm[2] * lx + nm[5] * ly + nm[8] * lz;
} else {
const ux = wp[b] - wp[a], uy = wp[b + 1] - wp[a + 1], uz = wp[b + 2] - wp[a + 2];
const vx = wp[c] - wp[a], vy = wp[c + 1] - wp[a + 1], vz = wp[c + 2] - wp[a + 2];
nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
}
const nl = Math.hypot(nx, ny, nz) || 1;
normals[o] = nx / nl; normals[o + 1] = ny / nl; normals[o + 2] = nz / nl;
const u = uv ? A * uv.getX(i0) + B * uv.getX(i1) + C * uv.getX(i2) : 0;
const v = uv ? A * uv.getY(i0) + B * uv.getY(i1) + C * uv.getY(i2) : 0;
if (vcol) {
vc[0] = A * vcol.getX(i0) + B * vcol.getX(i1) + C * vcol.getX(i2);
vc[1] = A * vcol.getY(i0) + B * vcol.getY(i1) + C * vcol.getY(i2);
vc[2] = A * vcol.getZ(i0) + B * vcol.getZ(i1) + C * vcol.getZ(i2);
}
const fn = p.fns[p.triMat ? p.triMat[t] : 0] || p.fns[0];
fn(u, v, vcol ? vc : null, tmpC, 0);
colors[o] = tmpC[0]; colors[o + 1] = tmpC[1]; colors[o + 2] = tmpC[2];
if ((w & 0x3ffff) === 0x3ffff) {
if (onProgress) onProgress(w / count);
await yieldUI();
}
}
}
return { positions, colors, normals, count: w };
}
export function verticesToCloud(entries) {
const P = [], C = [], N = [];
let total = 0;
for (const { mesh, mats } of entries) {
let g = mesh.geometry;
if (!g.attributes.position) continue;
if (!g.index) g = weldExact(g);
mesh.updateWorldMatrix(true, false);
const colors = bakeVertexColors(g, mats);
const pos = g.attributes.position;
const nrm = g.attributes.normal;
const e = mesh.matrixWorld.elements;
const nmx = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld).elements;
const n = pos.count;
const p = new Float32Array(n * 3);
const nn = new Float32Array(n * 3);
for (let i = 0; i < n; i++) {
const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
p[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
p[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
p[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
if (nrm) {
const lx = nrm.getX(i), ly = nrm.getY(i), lz = nrm.getZ(i);
const gx = nmx[0] * lx + nmx[3] * ly + nmx[6] * lz;
const gy = nmx[1] * lx + nmx[4] * ly + nmx[7] * lz;
const gz = nmx[2] * lx + nmx[5] * ly + nmx[8] * lz;
const l = Math.hypot(gx, gy, gz) || 1;
nn[i * 3] = gx / l; nn[i * 3 + 1] = gy / l; nn[i * 3 + 2] = gz / l;
}
}
P.push(p); C.push(colors); N.push(nn);
total += n;
}
const cat = (arrs) => {
const out = new Float32Array(total * 3);
let o = 0;
for (const a of arrs) {
out.set(a, o);
o += a.length;
}
return out;
};
return { positions: cat(P), colors: cat(C), normals: cat(N), count: total };
}
export function cloudToPoints(cloud, name = 'Облако точек') {
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
g.setAttribute('color', new THREE.BufferAttribute(cloud.colors, 3));
g.setAttribute('normal', new THREE.BufferAttribute(cloud.normals, 3));
const m = new THREE.PointsMaterial({ size: 0.01, vertexColors: true, sizeAttenuation: true });
m.name = 'PointCloud';
const pts = new THREE.Points(g, m);
pts.name = name;
return pts;
}
export function overrideMats(tex, mats) {
if (!tex) return mats;
const m = new THREE.MeshBasicMaterial({ map: tex });
return m;
}
