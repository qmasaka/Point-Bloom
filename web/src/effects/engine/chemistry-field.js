import { clamp } from '../../core/util.js';
export const CHEMISTRY = {
spots: { shape: 0, seeding: 5, life: 0, lift: 1, freq: 22, glow: 0.45 },
maze: { shape: 1, seeding: 4, life: 0, lift: 0.8, freq: 14, glow: 0.55 },
branches: { shape: 2, seeding: 2, life: 9, lift: 1.2, freq: 14, glow: 1 },
};
const REACH_SPEED = 0.42;
const COLONY_LIMIT = 40;
const GOLDEN = 0.61803398875;
const smooth = (a, b, x) => {
const t = clamp((x - a) / (b - a), 0, 1);
return t * t * (3 - 2 * t);
};
function pairNoise(a, b) {
let h = (Math.min(a, b) * 73856093) ^ (Math.max(a, b) * 19349663);
h = Math.imul(h ^ (h >>> 13), 1274126177);
return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function geodesic(field, source) {
const count = field.cells.length;
const dist = new Float32Array(count).fill(Infinity);
const heapKey = [];
const heapNode = [];
const push = (key, node) => {
let i = heapKey.length;
heapKey.push(key);
heapNode.push(node);
while (i > 0) {
const parent = (i - 1) >> 1;
if (heapKey[parent] <= key) break;
heapKey[i] = heapKey[parent];
heapNode[i] = heapNode[parent];
i = parent;
}
heapKey[i] = key;
heapNode[i] = node;
};
const pop = () => {
const node = heapNode[0];
const key = heapKey.pop();
const last = heapNode.pop();
const size = heapKey.length;
if (size) {
let i = 0;
for (;;) {
let child = i * 2 + 1;
if (child >= size) break;
if (child + 1 < size && heapKey[child + 1] < heapKey[child]) child++;
if (heapKey[child] >= key) break;
heapKey[i] = heapKey[child];
heapNode[i] = heapNode[child];
i = child;
}
heapKey[i] = key;
heapNode[i] = last;
}
return node;
};
dist[source] = 0;
push(0, source);
const centers = field.centers;
while (heapKey.length) {
const key = heapKey[0];
const node = pop();
if (key > dist[node]) continue;
const a = field.cells[node] * 3;
const near = field.neighbours[node];
for (let k = 0; k < near.length; k++) {
const other = field.slot[near[k]];
const b = near[k] * 3;
const step = Math.hypot(centers[a] - centers[b], centers[a + 1] - centers[b + 1], centers[a + 2] - centers[b + 2]) * (0.7 + 0.6 * pairNoise(node, other));
const next = key + step;
if (next < dist[other]) {
dist[other] = next;
push(next, other);
}
}
}
const origin = field.cells[source] * 3;
for (let i = 0; i < count; i++) {
const g = dist[i];
if (!isFinite(g)) continue;
const at = field.cells[i] * 3;
const e = Math.hypot(centers[at] - centers[origin], centers[at + 1] - centers[origin + 1], centers[at + 2] - centers[origin + 2]);
if (g < e * 1.15) dist[i] = e * 0.8 + g * 0.2;
}
return dist;
}
export class ChemistryColonies {
constructor(field, style) {
this.field = field;
this.style = style;
this.look = CHEMISTRY[style] || CHEMISTRY.spots;
const count = field.cells.length;
this.value = new Float32Array(count);
this.front = new Float32Array(count);
this.settled = new Float32Array(count);
this.colonies = [];
this.time = 0;
this.visits = 0;
for (let i = 0; i < Math.min(this.look.seeding, count); i++) {
this.plant(Math.floor(((0.23 + i * GOLDEN) % 1) * count), i * 0.7);
}
}
plant(source, delay = 0) {
if (source < 0 || source >= this.field.cells.length) return;
if (this.colonies.length >= COLONY_LIMIT) this.bake(this.colonies.shift(), this.size || 0.9);
this.colonies.push({ born: this.time + delay, dist: geodesic(this.field, source) });
}
bake(colony, size) {
if (this.look.life) return;
const reach = (this.time - colony.born) * REACH_SPEED;
for (let i = 0; i < this.settled.length; i++) {
const d = colony.dist[i];
const v = smooth(0, 0.3, reach - d) * (1 - smooth(size * 0.72, size, d));
if (v > this.settled[i]) this.settled[i] = v;
}
}
step(settings, hit, dt) {
this.time += dt * settings.speed;
if (hit >= 0) this.plant(hit);
const size = (this.size = settings.colony);
const life = this.look.life;
this.value.set(this.settled);
this.front.fill(0);
let active = false;
for (let c = this.colonies.length - 1; c >= 0; c--) {
const colony = this.colonies[c];
const age = this.time - colony.born;
const reach = age * REACH_SPEED;
if (age < 0) {
active = true;
continue;
}
if (life && age > life + 3) {
this.colonies.splice(c, 1);
continue;
}
const running = 1 - smooth(size, size + 0.35, reach);
if (running > 0.001) active = true;
else if (!life && reach > size + 0.6) {
this.bake(colony, size);
this.colonies.splice(c, 1);
continue;
}
const fade = life ? 1 - smooth(life, life + 3, age) : 1;
for (let i = 0; i < this.value.length; i++) {
const u = reach - colony.dist[i];
if (u <= 0) continue;
const d = colony.dist[i];
const limit = 1 - smooth(size * 0.72, size, d);
if (limit <= 0) continue;
const body = smooth(0, 0.3, u) * limit * fade;
if (body > this.value[i]) this.value[i] = body;
const edge = (u - 0.1) / 0.12;
const glow = Math.exp(-edge * edge) * limit * running * fade;
if (glow > this.front[i]) this.front[i] = glow;
}
}
if (life && !active && this.field.cells.length) {
this.plant(Math.floor((++this.visits * GOLDEN % 1) * this.field.cells.length));
}
}
}
