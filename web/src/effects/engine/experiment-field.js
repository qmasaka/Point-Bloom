import * as THREE from 'three';
import { clamp } from '../../core/util.js';
const SIDE = 32;
const WIDTH = 256;
const CELLS = SIDE ** 3;
const STEP = 1 / 24;
const HISTORY = 18;
const CHEMISTRY = {
spots: { feed: 0.038, kill: 0.062, diffusion: 0.95, balance: 0.39, seeding: 8, radius: 0.22, seed: 0.78, relief: 0.68 },
maze: { feed: 0.035, kill: 0.056, diffusion: 1.05, balance: 0.51, seeding: 16, radius: 0.16, seed: 0.67, relief: 0.25 },
branches: { feed: 0.025, kill: 0.053, diffusion: 1.07, balance: 0.53, seeding: 2, radius: 0.27, seed: 0.83, relief: 0.92 },
};
function cellOf(x, y, z) {
const axis = (v) => clamp(Math.floor(v * 8 + 16), 0, 31);
return axis(x) + SIDE * (axis(y) + SIDE * axis(z));
}
function packedFieldCoordinate(x, y, z) {
const axis = (v) => clamp(v * 8 + 15.5, 0, SIDE - 1);
const gx = axis(x), gy = axis(y), gz = axis(z);
const ix = Math.min(SIDE - 2, Math.floor(gx)), iy = Math.min(SIDE - 2, Math.floor(gy)), iz = Math.min(SIDE - 2, Math.floor(gz));
const cell = ix + SIDE * (iy + SIDE * iz);
const fraction = Math.round((gx - ix) * 7) + 8 * (Math.round((gy - iy) * 7) + 8 * Math.round((gz - iz) * 7));
return cell * 512 + fraction;
}
function graphOf(cells, occupied) {
return cells.map((id) => {
const x = id % SIDE, y = Math.floor(id / SIDE) % SIDE, z = Math.floor(id / (SIDE * SIDE));
const neighbours = [];
for (let dz = -1; dz <= 1; dz++) {
for (let dy = -1; dy <= 1; dy++) {
for (let dx = -1; dx <= 1; dx++) {
if ((!dx && !dy && !dz) || Math.min(x + dx, y + dy, z + dz) < 0 || Math.max(x + dx, y + dy, z + dz) >= SIDE) continue;
const other = id + dx + SIDE * dy + SIDE * SIDE * dz;
if (occupied[other]) neighbours.push(other);
}
}
}
return neighbours;
});
}
export class ExperimentField {
constructor(geometry, faces) {
this.geometry = geometry;
this.output = new Float32Array(CELLS * 8);
this.texture = new THREE.DataTexture(this.output, WIDTH, CELLS * 2 / WIDTH, THREE.RGBAFormat, THREE.FloatType);
this.texture.needsUpdate = true;
this.centers = new Float32Array(CELLS * 3);
this.indices = new Int32Array(CELLS).fill(-1);
this.cells = [];
this.feedback = new Float32Array(CELLS * 3);
this.current = new Float32Array(CELLS * 3);
this.wounds = new Float32Array(CELLS);
this.cracks = new Float32Array(CELLS);
this.history = [];
this.time = 0;
this.next = 0;
this.projection = new THREE.Matrix4();
this.inverse = new THREE.Matrix4();
this.point = new THREE.Vector3();
this.right = new THREE.Vector3();
this.up = new THREE.Vector3();
this.forward = new THREE.Vector3();
const counts = new Uint32Array(CELLS);
const pos = geometry.attributes.position.array;
const vis = geometry.attributes.aVis;
for (let i = 0; i < pos.length; i += 3) {
const index = i / 3;
const x = pos[i], y = pos[i + 1], z = pos[i + 2];
const cell = cellOf(x, y, z);
vis.array[i + 2] = packedFieldCoordinate(x, y, z);
if (vis.array[i + 1] <= 0.01 || (faces && geometry.attributes.aHide.array[index] > 0.5)) continue;
if (!counts[cell]++) {
this.cells.push(cell);
this.indices[cell] = i;
}
this.centers[cell * 3] += x;
this.centers[cell * 3 + 1] += y;
this.centers[cell * 3 + 2] += z;
}
for (const id of this.cells) {
for (let k = 0; k < 3; k++) this.centers[id * 3 + k] /= counts[id];
}
this.neighbours = graphOf(this.cells, counts);
vis.needsUpdate = true;
}
resetFeedback() {
this.feedback.fill(0);
this.hunger = null;
this.luma = null;
this.captured = null;
}
resetReaction() {
this.chem = null;
this.seedCount = 0;
}
resetWounds() {
this.wounds.fill(0);
this.cracks.fill(0);
this.history.length = 0;
this.historyHead = -1;
this.historyTime = -Infinity;
}
capture(viewport, object, overlay) {
if (this.captured === this.time) return;
this.captured = this.time;
const width = 144, height = Math.max(24, Math.round(width * viewport.canvas.height / Math.max(1, viewport.canvas.width)));
if (!this.surface) {
this.surface = document.createElement('canvas');
this.context = this.surface.getContext('2d', { willReadFrequently: true });
}
if (!this.context || !viewport.canvas.width) return;
if (this.surface.width !== width) this.surface.width = width;
const h = Math.min(192, height);
if (this.surface.height !== h) this.surface.height = h;
const ctx = this.context;
ctx.clearRect(0, 0, width, h);
ctx.drawImage(viewport.canvas, 0, 0, width, h);
if (overlay && overlay.style.visibility !== 'hidden') ctx.drawImage(overlay, 0, 0, width, h);
let bytes;
try {
bytes = ctx.getImageData(0, 0, width, h).data;
} catch {
this.luma = null;
return;
}
if (this.luma?.length !== width * h) this.luma = new Float32Array(width * h);
for (let i = 0; i < this.luma.length; i++) {
const p = i * 4;
const r = bytes[p] / 255, g = bytes[p + 1] / 255, b = bytes[p + 2] / 255;
this.luma[i] = (0.2126 * r * r + 0.7152 * g * g + 0.0722 * b * b) * (bytes[p + 3] / 255);
}
const camera = viewport.camera;
this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(object.matrixWorld);
this.inverse.copy(object.matrixWorld).invert();
this.right.setFromMatrixColumn(camera.matrixWorld, 0).transformDirection(this.inverse);
this.up.setFromMatrixColumn(camera.matrixWorld, 1).transformDirection(this.inverse);
this.forward.setFromMatrixColumn(camera.matrixWorld, 2).transformDirection(this.inverse);
}
_updateFeedback(settings, amount) {
const img = this.luma;
if (!img) return;
const { width, height } = this.surface;
const area = settings.style === 'vortex' ? 6 : 4;
const inner = 2;
const retain = Math.exp(-STEP * settings.speed / settings.memory);
const gain = STEP * settings.speed * 2.4 * (0.35 + 0.65 * Math.min(1, amount));
const limit = 0.95;
const p = this.point;
const h = this.hunger ||= { moved: new Float32Array(CELLS * 3), bins: new Int32Array(CELLS), pressure: new Float32Array(CELLS), bite: new Float32Array(CELLS), nextBite: new Float32Array(CELLS) };
h.bins.fill(-1);
for (const id of this.cells) {
const j = id * 3;
const k = id * 4;
for (let axis = 0; axis < 3; axis++) h.moved[j + axis] = this.current[j + axis] + this.output[k + axis];
const bin = cellOf(h.moved[j], h.moved[j + 1], h.moved[j + 2]);
const owner = h.bins[bin];
if (owner < 0 || h.pressure[owner] < h.pressure[id]) h.bins[bin] = id;
}
const d = this.feedback;
for (let k = 0; k < this.cells.length; k++) {
const id = this.cells[k], j = id * 3;
p.fromArray(h.moved, j).applyMatrix4(this.projection);
const x = Math.floor((p.x * 0.5 + 0.5) * width), y = Math.floor((0.5 - p.y * 0.5) * height);
let sx = 0, sy = 0, sz = 0, lightEdge = 0;
if (p.z >= -1 && p.z <= 1 && x >= area && y >= area && x < width - area && y < height - area) {
const i = x + y * width;
const gx = (img[i + inner] - img[i - inner]) * 0.65 + (img[i + area] - img[i - area]) * 0.35;
const gy = (img[i - inner * width] - img[i + inner * width]) * 0.65 + (img[i - area * width] - img[i + area * width]) * 0.35;
const edge = Math.min(1, Math.hypot(gx, gy) * 3.4);
lightEdge = edge;
const eddy = (0.19 + h.pressure[id] * 0.48) * (0.35 + edge) * Math.sin(this.current[j] * 9 + this.current[j + 1] * 13 + this.time * settings.speed * 1.25);
sx = settings.pull * gx - gy * eddy;
sy = settings.pull * gy + gx * eddy;
const surround = (img[i + area] + img[i - area] + img[i + area * width] + img[i - area * width]) * 0.25;
const fold = clamp((img[i] - surround) * 1.8, -0.38, 0.5);
sz = 0.81 * (edge * 0.52 - fold) + eddy * edge * 0.28;
if (settings.style === 'vortex') {
const spin = 0.58 + eddy * 0.45;
sx = sx * 0.55 - gy * spin;
sy = sy * 0.55 + gx * spin;
sz *= 0.4;
} else if (settings.style === 'erode') {
sx -= gx * 0.86;
sy -= gy * 0.86;
sz = -(edge * 0.55 + Math.max(0, fold));
}
}
let tx = 0, ty = 0, tz = 0, contact = 0, transfer = 0;
for (const neighbor of this.neighbours[k]) {
const q = neighbor * 3;
const ax = h.moved[q] - h.moved[j], ay = h.moved[q + 1] - h.moved[j + 1], az = h.moved[q + 2] - h.moved[j + 2];
const distance = ax * ax + ay * ay + az * az;
const rest = (this.centers[j] - this.centers[q]) ** 2 + (this.centers[j + 1] - this.centers[q + 1]) ** 2 + (this.centers[j + 2] - this.centers[q + 2]) ** 2;
const clutch = clamp(1 - distance / Math.max(0.001, rest * 0.88), 0, 1);
if (!clutch) continue;
const weight = clutch * (0.52 + h.pressure[neighbor] * 1.4);
tx += ax * weight; ty += ay * weight; tz += az * weight;
contact += clutch;
transfer = Math.max(transfer, h.bite[neighbor] * clutch);
}
const folded = h.bins[cellOf(h.moved[j], h.moved[j + 1], h.moved[j + 2])];
if (folded >= 0 && folded !== id && !this.neighbours[k].includes(folded)) {
const q = folded * 3;
const ax = h.moved[q] - h.moved[j], ay = h.moved[q + 1] - h.moved[j + 1], az = h.moved[q + 2] - h.moved[j + 2];
const grip = clamp(1 - (ax * ax + ay * ay + az * az) / 0.013, 0, 1);
tx += ax * grip; ty += ay * grip; tz += az * grip;
contact += grip * 1.65;
transfer = Math.max(transfer, h.bite[folded] * grip);
}
const pressure = h.pressure[id] = clamp(h.pressure[id] * 0.94 + (contact * 0.024 + lightEdge * contact * 0.055), 0, 1);
const attack = Math.max(0, pressure - 0.16) * (settings.style === 'erode' ? 1.7 : 1) + transfer * 0.52;
h.nextBite[id] = clamp(h.bite[id] * 0.991 + attack * STEP * settings.speed * settings.erosion * 1.32, 0, 1);
const glue = settings.pull * (2.8 + pressure * 3.4) / Math.max(1, contact);
const drag = 1 - (1 - retain) * (1 - pressure * 0.65);
d[j] = clamp(d[j] * drag + gain * (sx * this.right.x + sy * this.up.x + sz * this.forward.x + tx * glue), -limit, limit);
d[j + 1] = clamp(d[j + 1] * drag + gain * (sx * this.right.y + sy * this.up.y + sz * this.forward.y + ty * glue), -limit, limit);
d[j + 2] = clamp(d[j + 2] * drag + gain * (sx * this.right.z + sy * this.up.z + sz * this.forward.z + tz * glue), -limit, limit);
}
[h.bite, h.nextBite] = [h.nextBite, h.bite];
}
_seed(center, radius, strength) {
const cs = this.centers;
const { a, b, age } = this.chem;
for (const id of this.cells) {
const j = id * 3;
const d = Math.hypot(cs[j] - center[0], cs[j + 1] - center[1], cs[j + 2] - center[2]);
if (d >= radius) continue;
const weight = 1 - d / radius;
a[id] = Math.min(a[id], 1 - strength * (0.54 + 0.40 * weight));
b[id] = Math.max(b[id], strength * (0.5 + 0.44 * weight));
if (age) age[id] = 0.02 + (1 - weight) * 0.12;
}
}
_react(settings, hit) {
const recipe = CHEMISTRY[settings.style] || CHEMISTRY.spots;
if (!this.chem || this.chem.recipe !== recipe) {
this.chem = { recipe, a: new Float32Array(CELLS).fill(1), b: new Float32Array(CELLS), nextA: new Float32Array(CELLS), nextB: new Float32Array(CELLS), warm: 20, substeps: 0 };
if (recipe === CHEMISTRY.branches) Object.assign(this.chem, { age: new Float32Array(CELLS).fill(-1), nextAge: new Float32Array(CELLS).fill(-1), front: new Float32Array(CELLS), wave: 0 });
for (let i = 0; i < Math.min(recipe.seeding, this.cells.length); i++) {
const index = Math.floor((0.23 + i * 0.61803399) % 1 * this.cells.length);
const j = this.cells[index] * 3;
this._seed(this.centers.subarray(j, j + 3), recipe.radius, recipe.seed);
}
}
if (hit >= 0) this._seed(this.centers.subarray(hit * 3, hit * 3 + 3), settings.radius, recipe.seed);
const c = this.chem;
const { feed, kill } = recipe;
c.substeps += Math.min(18, (c.warm > 0 ? 12 : 5) * settings.speed);
if (c.warm > 0) c.warm--;
const steps = Math.floor(c.substeps);
c.substeps -= steps;
for (let step = 0; step < steps; step++) {
const { a, b, nextA, nextB } = c;
for (let i = 0; i < this.cells.length; i++) {
const id = this.cells[i], neighbours = this.neighbours[i];
const av = a[id], bv = b[id];
let sumA = 0, sumB = 0, near = 0;
for (const n of neighbours) {
sumA += a[n] - av;
sumB += b[n] - bv;
if (recipe === CHEMISTRY.branches) near = Math.max(near, b[n] - bv);
}
const diffusion = recipe.diffusion / Math.max(1, neighbours.length);
const reaction = av * bv * bv;
nextA[id] = clamp(av + 0.8 * (diffusion * 0.95 * sumA - reaction + feed * (1 - av)), 0, 1);
nextB[id] = clamp(bv + 0.8 * (diffusion * recipe.balance * sumB + reaction - (kill + feed) * bv + near * 0.09 * av), 0, 1);
}
[c.a, c.nextA] = [nextA, a];
[c.b, c.nextB] = [nextB, b];
}
if (c.age) this._infectionFront(c, settings.speed);
}
_infectionFront(chem, speed) {
let active = false;
for (let i = 0; i < this.cells.length; i++) {
const id = this.cells[i];
let age = chem.age[id];
if (age < 0) {
const delay = 0.12 + (id % 11) * 0.012;
for (const n of this.neighbours[i]) {
if (chem.age[n] < delay || chem.age[n] > 0.48) continue;
age = 0;
break;
}
} else {
age += STEP * speed;
if (age >= 2.8) age = -1;
}
active ||= age >= 0;
chem.nextAge[id] = age;
chem.front[id] = age < 0 ? 0 : Math.min(1, age * 8) * Math.exp(-age * 2.7);
}
[chem.age, chem.nextAge] = [chem.nextAge, chem.age];
if (!active && this.cells.length) {
const id = this.cells[Math.floor((++chem.wave * 0.61803398875 % 1) * this.cells.length)];
chem.age[id] = 0;
}
}
pick(ndc, viewport, object) {
const camera = viewport.camera;
const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(object.matrixWorld);
let best = -1, score = Infinity;
for (const id of this.cells) {
const j = id * 4;
const p = this.point.fromArray(this.current, id * 3);
p.x += this.output[j]; p.y += this.output[j + 1]; p.z += this.output[j + 2];
p.applyMatrix4(matrix);
if (p.z < -1 || p.z > 1) continue;
const d = Math.hypot((p.x - ndc.x) * viewport.size.width, (p.y - ndc.y) * viewport.size.height);
const cost = d + (p.z + 1) * 55;
if (d < 44 && cost < score) {
best = id;
score = cost;
}
}
return best;
}
_wound(settings, hit) {
if (hit < 0) return;
const c = this.centers, hj = hit * 3;
for (const id of this.cells) {
const j = id * 3;
const dx = c[j] - c[hj], dy = c[j + 1] - c[hj + 1], dz = c[j + 2] - c[hj + 2];
const jagged = 1 - settings.roughness * (0.22 + 0.38 * Math.sin(id * 0.017 + c[j + 1] * 37));
const d = Math.hypot(dx * 0.75, dy, dz * 1.15) / (settings.radius * jagged);
this.wounds[id] = Math.max(this.wounds[id], clamp(1 - d, 0, 1) ** 0.45);
}
}
step(auto, reaction, wounds, mix, viewport, object, picks, gains, beat) {
const a = this.geometry.attributes;
const origin = a.aOrigin.array, target = a.aTarget.array, sculpt = a.aSculpt.array, normals = a.aNormalB.array;
for (const id of this.cells) {
const j = id * 3, i = this.indices[id];
for (let k = 0; k < 3; k++) this.current[j + k] = origin[i + k] + (target[i + k] - origin[i + k]) * mix + sculpt[i + k];
}
const autoGain = gains.autophagy || 0;
const chemGain = gains.reactionSkin || 0, woundGain = gains.causalWounds || 0;
if (auto.on && auto.amount > 0) this._updateFeedback(auto, autoGain);
else if (this.autoOn) this.resetFeedback();
this.autoOn = auto.on && auto.amount > 0;
let seedCell = -1;
if (reaction.on && reaction.trigger === 'beat' && beat && chemGain > 0.001 && this.cells.length) {
this.seedCount = (this.seedCount || 0) + 1;
seedCell = this.cells[Math.floor((this.seedCount * 0.61803398875 % 1) * this.cells.length)];
}
if (reaction.on) this._react(reaction, picks.seed ? this.pick(picks.seed, viewport, object) : seedCell);
else if (this.chem) this.resetReaction();
if (wounds.on && picks.wound) this._wound(wounds, this.pick(picks.wound, viewport, object));
if (!wounds.on && this.woundOn) this.resetWounds();
this.woundOn = wounds.on;
const decay = Math.exp(-3 * STEP / wounds.healing);
const b = this.chem?.b;
const captureHistory = wounds.on && this.time - (this.historyTime ?? -Infinity) + 0.0001 >= Math.max(STEP, wounds.memory / HISTORY);
let snapshot;
if (captureHistory) {
this.historyTime = this.time;
this.historyHead = ((this.historyHead ?? -1) + 1) % HISTORY;
snapshot = this.history[this.historyHead] ||= new Float32Array(CELLS * 3);
}
for (let index = 0; index < this.cells.length; index++) {
const id = this.cells[index], j = id * 3, p = id * 4, i = this.indices[id];
const infection = this.chem?.front?.[id] ?? 0;
const concentration = reaction.on && b ? clamp(Math.max((b[id] - 0.06) * 3.8, infection * 1.4), 0, 1) : 0;
const chem = concentration * concentration * (3 - 2 * concentration) * chemGain;
const mutation = chem * chem * (this.chem?.recipe.relief ?? 0);
const ridge = chem * reaction.growth * (0.12 + mutation * 0.55);
let w = this.wounds[id];
if (wounds.on) {
let nearby = 0;
for (const n of this.neighbours[index]) nearby = Math.max(nearby, this.wounds[n] - w);
const grain = (Math.sin(id * 1.618) * 0.5 + 0.5) ** 3;
this.cracks[id] = Math.max(w * decay, 0) + nearby * grain * wounds.spread * 0.17;
}
w = wounds.on ? Math.min(1.2, w * woundGain) : 0;
const ribbon = Math.sin(this.centers[j] * 4.8 + this.centers[j + 1] * 8 - this.centers[j + 2] * 5.5);
const strand = wounds.style === 'crack' ? Math.abs(ribbon) * 0.8 + 0.2 : wounds.style === 'peel' ? w : ribbon * 0.5 + 0.5;
const layer = Math.floor(clamp(strand, 0, 0.999) * wounds.layers);
const back = Math.min(this.history.length - 1, 2 + Math.round(layer * (HISTORY - 3) / Math.max(1, wounds.layers - 1)));
const past = back >= 0 ? this.history[(this.historyHead - back + HISTORY) % HISTORY] : null;
for (let k = 0; k < 3; k++) {
const noise = Math.sin(this.centers[j + (k + 1) % 3] * 19 + k * 2 + this.time * 0.7);
const local = this.autoOn ? this.feedback[j + k] * autoGain : 0;
const offset = local + ridge * normals[i + k] + noise * mutation * 0.14;
const live = this.current[j + k] + offset;
const lift = wounds.style === 'crack' ? 0.12 - layer * wounds.spacing : 0.19 + layer * wounds.spacing;
const cut = lift * normals[i + k] + noise * (0.04 + wounds.roughness * 0.12);
this.output[p + k] = offset + w * wounds.depth * ((past ? past[j + k] - live : 0) + cut);
if (snapshot) snapshot[j + k] = live;
}
this.output[p + 3] = 2 + Math.min(1, chem) - Math.min(1, w * (0.82 + layer * 0.08));
const detail = CELLS * 4 + p;
this.output[detail] = Math.min(1, (this.hunger?.bite[id] ?? 0) * autoGain);
this.output[detail + 1] = (this.hunger?.pressure[id] ?? 0) * autoGain;
this.output[detail + 3] = 2;
}
if (wounds.on) [this.wounds, this.cracks] = [this.cracks, this.wounds];
this.texture.needsUpdate = true;
}
dispose() {
this.texture.dispose();
}
}
