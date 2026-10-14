import * as THREE from 'three';
import { perf } from '../../core/perf.js';
export class LinksPart {
_computeLinks() {
if (!this.geometry || !this.linkObj) return;
if (!this.state.layers.links.on) {
this._linksStale = true;
return;
}
this._linksStale = false;
const g = this.geometry;
const N = g.attributes.position.count;
const maxNodes = perf.isApple ? 8000 : perf.windows ? (perf.tier === 'high' ? 4500 : 2500) : 5000;
const S = Math.min(N, Math.min(maxNodes, Math.round(this.state.layers.links.count)));
if (S <= 1) return;
const step = N / S;
const O = g.attributes.aOrigin.array;
const T = g.attributes.aTarget.array;
const ids = new Int32Array(S);
for (let i = 0; i < S; i++) ids[i] = Math.floor(i * step);
const R = 0.35;
const R2 = R * R;
const cell = R;
const key = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
const grid = new Map();
for (let i = 0; i < S; i++) {
const p = ids[i] * 3;
const k = key(Math.floor(T[p] / cell), Math.floor(T[p + 1] / cell), Math.floor(T[p + 2] / cell));
let a = grid.get(k);
if (!a) grid.set(k, (a = []));
a.push(i);
}
const pairs = [];
const seen = new Set();
for (let i = 0; i < S; i++) {
const p = ids[i] * 3;
const px = T[p], py = T[p + 1], pz = T[p + 2];
const cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
let b0_d = R2, b0_j = -1;
let b1_d = R2, b1_j = -1;
let b2_d = R2, b2_j = -1;
for (let dx = -1; dx <= 1; dx++) {
for (let dy = -1; dy <= 1; dy++) {
for (let dz = -1; dz <= 1; dz++) {
const a = grid.get(key(cx + dx, cy + dy, cz + dz));
if (!a) continue;
for (let ai = 0; ai < a.length; ai++) {
const j = a[ai];
if (j === i) continue;
const q = ids[j] * 3;
const ddx = px - T[q], ddy = py - T[q + 1], ddz = pz - T[q + 2];
const d = ddx * ddx + ddy * ddy + ddz * ddz;
if (d < b2_d) {
if (d < b0_d) {
b2_d = b1_d; b2_j = b1_j;
b1_d = b0_d; b1_j = b0_j;
b0_d = d; b0_j = j;
} else if (d < b1_d) {
b2_d = b1_d; b2_j = b1_j;
b1_d = d; b1_j = j;
} else {
b2_d = d; b2_j = j;
}
}
}
}
}
}
if (b0_j >= 0) {
const id = i < b0_j ? i * S + b0_j : b0_j * S + i;
if (!seen.has(id)) { seen.add(id); pairs.push(i, b0_j); }
}
if (b1_j >= 0) {
const id = i < b1_j ? i * S + b1_j : b1_j * S + i;
if (!seen.has(id)) { seen.add(id); pairs.push(i, b1_j); }
}
if (b2_j >= 0) {
const id = i < b2_j ? i * S + b2_j : b2_j * S + i;
if (!seen.has(id)) { seen.add(id); pairs.push(i, b2_j); }
}
}
const L = pairs.length / 2;
const V = L * 4;
const DP = g.attributes.aDepth ? g.attributes.aDepth.array : null;
const lg = this.linkObj.geometry;
const currV = lg.attributes.position ? lg.attributes.position.count : 0;
let A, TA, B, TB, ia, ib, end, side, da, db, index;
if (currV >= V && V > 0 && lg.attributes.aOrigin) {
A = lg.attributes.aOrigin.array;
TA = lg.attributes.aTarget.array;
B = lg.attributes.aOriginB.array;
TB = lg.attributes.aTargetB.array;
ia = lg.attributes.aIdx.array;
ib = lg.attributes.aIdxB.array;
da = lg.attributes.aDepth.array;
db = lg.attributes.aDepthB.array;
end = lg.attributes.aEnd.array;
side = lg.attributes.aSide.array;
index = lg.index ? lg.index.array : null;
}
if (!A || !index || index.length < L * 6) {
const capV = Math.max(V, Math.round(V * 1.25));
const capL = Math.floor(capV / 4);
A = new Float32Array(capV * 3);
TA = new Float32Array(capV * 3);
B = new Float32Array(capV * 3);
TB = new Float32Array(capV * 3);
ia = new Float32Array(capV);
ib = new Float32Array(capV);
da = new Float32Array(capV);
db = new Float32Array(capV);
end = new Float32Array(capV);
side = new Float32Array(capV);
index = new Uint32Array(capL * 6);
lg.setAttribute('position', new THREE.BufferAttribute(A, 3));
lg.setAttribute('aOrigin', new THREE.BufferAttribute(A, 3));
lg.setAttribute('aTarget', new THREE.BufferAttribute(TA, 3));
lg.setAttribute('aOriginB', new THREE.BufferAttribute(B, 3));
lg.setAttribute('aTargetB', new THREE.BufferAttribute(TB, 3));
lg.setAttribute('aIdx', new THREE.BufferAttribute(ia, 1));
lg.setAttribute('aIdxB', new THREE.BufferAttribute(ib, 1));
lg.setAttribute('aDepth', new THREE.BufferAttribute(da, 1));
lg.setAttribute('aDepthB', new THREE.BufferAttribute(db, 1));
lg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
lg.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
lg.setIndex(new THREE.BufferAttribute(index, 1));
}
for (let l = 0; l < L; l++) {
const a = ids[pairs[l * 2]], b = ids[pairs[l * 2 + 1]];
const q = l * 4;
const idx6 = l * 6;
index[idx6] = q;
index[idx6 + 1] = q + 1;
index[idx6 + 2] = q + 2;
index[idx6 + 3] = q + 2;
index[idx6 + 4] = q + 1;
index[idx6 + 5] = q + 3;
const a3 = a * 3, b3 = b * 3;
const oa0 = O[a3], oa1 = O[a3 + 1], oa2 = O[a3 + 2];
const ta0 = T[a3], ta1 = T[a3 + 1], ta2 = T[a3 + 2];
const ob0 = O[b3], ob1 = O[b3 + 1], ob2 = O[b3 + 2];
const tb0 = T[b3], tb1 = T[b3 + 1], tb2 = T[b3 + 2];
const dpA = DP ? DP[a] : 0.5;
const dpB = DP ? DP[b] : 0.5;
const iaVal = a / N;
const ibVal = b / N;
for (let v = 0; v < 4; v++) {
const o = (q + v) * 3;
A[o] = oa0; A[o + 1] = oa1; A[o + 2] = oa2;
TA[o] = ta0; TA[o + 1] = ta1; TA[o + 2] = ta2;
B[o] = ob0; B[o + 1] = ob1; B[o + 2] = ob2;
TB[o] = tb0; TB[o + 1] = tb1; TB[o + 2] = tb2;
const qv = q + v;
ia[qv] = iaVal;
ib[qv] = ibVal;
da[qv] = dpA;
db[qv] = dpB;
end[qv] = v >> 1;
side[qv] = v & 1 ? 1 : -1;
}
}
lg.setDrawRange(0, L * 6);
lg.attributes.position.needsUpdate = true;
lg.attributes.aOrigin.needsUpdate = true;
lg.attributes.aTarget.needsUpdate = true;
lg.attributes.aOriginB.needsUpdate = true;
lg.attributes.aTargetB.needsUpdate = true;
lg.attributes.aIdx.needsUpdate = true;
lg.attributes.aIdxB.needsUpdate = true;
lg.attributes.aDepth.needsUpdate = true;
lg.attributes.aDepthB.needsUpdate = true;
lg.attributes.aEnd.needsUpdate = true;
lg.attributes.aSide.needsUpdate = true;
if (lg.index) lg.index.needsUpdate = true;
lg.computeBoundingSphere();
this._pairs = { ids, list: pairs, N, L };
}
_syncLinks() {
if (!this._pairs || !this.linkObj) return;
const { ids, list, L } = this._pairs;
if (!L) return;
const O = this.geometry.attributes.aOrigin.array;
const T = this.geometry.attributes.aTarget.array;
const lg = this.linkObj.geometry;
if (!lg.attributes.aOrigin) return;
const arrA = lg.attributes.aOrigin.array;
const arrTA = lg.attributes.aTarget.array;
const arrB = lg.attributes.aOriginB.array;
const arrTB = lg.attributes.aTargetB.array;
for (let l = 0; l < L; l++) {
const a = ids[list[l * 2]], b = ids[list[l * 2 + 1]];
const a3 = a * 3, b3 = b * 3;
const oa0 = O[a3], oa1 = O[a3 + 1], oa2 = O[a3 + 2];
const ta0 = T[a3], ta1 = T[a3 + 1], ta2 = T[a3 + 2];
const ob0 = O[b3], ob1 = O[b3 + 1], ob2 = O[b3 + 2];
const tb0 = T[b3], tb1 = T[b3 + 1], tb2 = T[b3 + 2];
for (let v = 0; v < 4; v++) {
const o = (l * 4 + v) * 3;
arrA[o] = oa0; arrA[o + 1] = oa1; arrA[o + 2] = oa2;
arrTA[o] = ta0; arrTA[o + 1] = ta1; arrTA[o + 2] = ta2;
arrB[o] = ob0; arrB[o + 1] = ob1; arrB[o + 2] = ob2;
arrTB[o] = tb0; arrTB[o + 1] = tb1; arrTB[o + 2] = tb2;
}
}
lg.attributes.aOrigin.needsUpdate = true;
lg.attributes.aTarget.needsUpdate = true;
lg.attributes.aOriginB.needsUpdate = true;
lg.attributes.aTargetB.needsUpdate = true;
const DP = this.geometry.attributes.aDepth?.array;
if (DP && lg.attributes.aDepth) {
const da = lg.attributes.aDepth.array, db = lg.attributes.aDepthB.array;
for (let l = 0; l < L; l++) {
const a = DP[ids[list[l * 2]]], b = DP[ids[list[l * 2 + 1]]];
const q = l * 4;
for (let v = 0; v < 4; v++) {
da[q + v] = a;
db[q + v] = b;
}
}
lg.attributes.aDepth.needsUpdate = lg.attributes.aDepthB.needsUpdate = true;
}
}
relink() {
clearTimeout(this._relT);
this._relT = setTimeout(() => this._computeLinks(), 180);
}
}
