import * as THREE from 'three';
const N = 34;
export function mediaBounds(aspect) {
const x = 1.1 * Math.min(1, aspect);
return { x, y: x / aspect };
}
export function makeVolume(key, cloud, meshes, media) {
if (media) {
const { x, y } = mediaBounds(media.aspect);
const { cols, rows } = media;
const p = cloud.positions;
const hide = cloud.hide;
return {
min: [-x, -y, -1.6], max: [x, y, 1.6],
inside(px, py, pz) {
const i = Math.floor((px / x * 0.5 + 0.5) * cols);
const j = Math.floor((0.5 - py / y * 0.5) * rows);
if (i < 0 || i >= cols || j < 0 || j >= rows) return false;
const k = j * cols + i;
return (!hide || hide[k] < 0.5) && Math.abs(pz - p[k * 3 + 2] - (cloud.depth?.(k) || 0)) < 0.25;
},
};
}
if (key === 'sphere' || key === 'torus' || key === 'cube') {
const limits = key === 'torus' ? [1.36, 0.36, 1.36] : Array(3).fill(key === 'sphere' ? 1 : 0.65);
return {
min: limits.map((v) => -v), max: limits,
inside(x, y, z) {
if (key === 'sphere') return x * x + y * y + z * z < 1;
if (key === 'torus') return (Math.hypot(x, z) - 1) ** 2 + y * y < 0.36 ** 2;
return Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) < 0.65;
},
};
}
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
const p = cloud.positions;
for (let i = 0; i < p.length; i++) {
const c = i % 3;
min[c] = Math.min(min[c], p[i]);
max[c] = Math.max(max[c], p[i]);
}
for (let c = 0; c < 3; c++) {
const pad = Math.max(0.01, (0.12 - (max[c] - min[c])) / 2);
min[c] -= pad;
max[c] += pad;
}
const d = max.map((v, i) => (v - min[i]) / N);
const cells = new Uint8Array(N ** 3);
if (cloud.norm) for (const mesh of meshes) rasterMesh(mesh, cloud.norm, min, d, cells);
if (!cells.some(Boolean)) {
const front = new Float32Array(N * N).fill(-Infinity);
const back = new Float32Array(N * N).fill(Infinity);
for (let i = 0; i < p.length; i += 3) {
const x = Math.floor((p[i] - min[0]) / d[0]);
const y = Math.floor((p[i + 1] - min[1]) / d[1]);
const j = y * N + x;
back[j] = Math.min(back[j], p[i + 2] - 0.055);
front[j] = Math.max(front[j], p[i + 2] + 0.055);
}
for (let x = 0; x < N * N; x++) fillColumn(cells, x, back[x], front[x], min[2], d[2]);
}
const occupied = [];
for (let i = 0; i < cells.length; i++) if (cells[i]) occupied.push(i);
return {
min, max,
seed(random) {
const i = occupied[Math.floor(random() * occupied.length)];
return [i % N, Math.floor(i / N) % N, Math.floor(i / (N * N))].map((v, k) => min[k] + (v + random()) * d[k]);
},
inside(px, py, pz) {
const x = Math.floor((px - min[0]) / d[0]);
const y = Math.floor((py - min[1]) / d[1]);
const z = Math.floor((pz - min[2]) / d[2]);
return x >= 0 && x < N && y >= 0 && y < N && z >= 0 && z < N && cells[(z * N + y) * N + x] === 1;
},
};
}
function fillColumn(cells, column, low, high, min, step) {
const from = Math.max(0, Math.ceil((low - min) / step - 0.5));
const to = Math.min(N - 1, Math.floor((high - min) / step - 0.5));
for (let z = from; z <= to; z++) cells[z * N * N + column] = 1;
}
function rasterMesh(mesh, norm, min, d, cells) {
mesh.updateWorldMatrix(true, false);
const { position } = mesh.geometry.attributes;
const index = mesh.geometry.index;
const p = new Float32Array(position.count * 3);
const v = new THREE.Vector3();
for (let i = 0; i < position.count; i++) {
mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
p.set([(v.x - norm.cx) * norm.k, (v.y - norm.cy) * norm.k, (v.z - norm.cz) * norm.k], i * 3);
}
const hits = Array.from({ length: N * N }, () => []);
const count = index?.count ?? position.count;
for (let i = 0; i + 2 < count; i += 3) {
const a = (index ? index.getX(i) : i) * 3;
const b = (index ? index.getX(i + 1) : i + 1) * 3;
const c = (index ? index.getX(i + 2) : i + 2) * 3;
const ax = p[a], ay = p[a + 1], az = p[a + 2];
const bx = p[b] - ax, by = p[b + 1] - ay;
const cx = p[c] - ax, cy = p[c + 1] - ay;
const det = bx * cy - by * cx;
if (Math.abs(det) < 1e-10) continue;
const x0 = Math.max(0, Math.ceil((ax + Math.min(0, bx, cx) - min[0]) / d[0] - 0.501));
const x1 = Math.min(N - 1, Math.floor((ax + Math.max(0, bx, cx) - min[0]) / d[0] - 0.501));
const y0 = Math.max(0, Math.ceil((ay + Math.min(0, by, cy) - min[1]) / d[1] - 0.503));
const y1 = Math.min(N - 1, Math.floor((ay + Math.max(0, by, cy) - min[1]) / d[1] - 0.503));
for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
const px = min[0] + (x + 0.501) * d[0] - ax;
const py = min[1] + (y + 0.503) * d[1] - ay;
const s = (px * cy - py * cx) / det;
const t = (bx * py - by * px) / det;
if (s >= 0 && t >= 0 && s + t <= 1) hits[y * N + x].push(az + (p[b + 2] - az) * s + (p[c + 2] - az) * t);
}
}
for (let i = 0; i < hits.length; i++) {
const list = hits[i].sort((a, b) => a - b).filter((z, k, arr) => !k || z - arr[k - 1] > 1e-5);
if (list.length % 2) continue;
for (let j = 0; j < list.length; j += 2) fillColumn(cells, i, list[j], list[j + 1], min[2], d[2]);
}
}
export function insideSegment(inside, a, b) {
return inside(...b) && inside((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
export function seededRandom(seed) {
return () => {
seed ^= seed << 13;
seed ^= seed >>> 17;
seed ^= seed << 5;
return (seed >>> 0) / 4294967296;
};
}
