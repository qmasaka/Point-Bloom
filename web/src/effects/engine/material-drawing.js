import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { insideSegment, mediaBounds, seededRandom } from './material-volume.js';
const TAU = Math.PI * 2;
const MIX = new THREE.Color();
const PIXEL = new THREE.Color();
const PROJECTED = new THREE.Vector3();
const vertex = (x, y, z) => [Math.fround(x), Math.fround(y), Math.fround(z)];
export class MaterialDrawing {
constructor() {
this.lines = [[], []];
this.faces = [[], []];
this.points = [[], []];
}
vertex(kind, p, color, light = 1) {
kind[0].push(...p);
kind[1].push(color.r * light, color.g * light, color.b * light);
}
segment(a, b, color, light = 1) {
this.vertex(this.lines, a, color, light);
this.vertex(this.lines, b, color, light);
}
quad(a, b, c, d, color, light) {
for (const p of [a, b, c, b, d, c]) this.vertex(this.faces, p, color, light);
}
}
function tint(palette, v) {
v = clamp(v, 0, 1) * 2;
return MIX.copy(palette[Math.min(1, Math.floor(v))]).lerp(palette[v < 1 ? 1 : 2], v < 1 ? v : v - 1);
}
export function makeScreenColor(feed, layer, points, viewport, shared) {
if (!feed?.rgba) return null;
const { x: cx, z: cz } = shared.uCen.value;
const { x: low, y: high } = shared.uYR.value;
const height = Math.max(0.01, high - low);
const angle = layer.rotate * Math.PI / 180;
const cr = Math.cos(angle), sr = Math.sin(angle);
const scale = Math.max(0.1, layer.scale);
const camera = viewport.camera;
const cameraAspect = camera.aspect || 1;
return (point, color) => {
let u, v;
if (layer.mode === 'wrap') {
u = (Math.atan2(point[2] - cz, point[0] - cx) / TAU) / scale + 0.5;
u -= Math.floor(u);
v = clamp((point[1] - low) / height, 0, 1);
} else {
let x = (point[0] - cx) / (height * feed.aspect), y = (point[1] - (low + high) / 2) / height;
if (layer.mode === 'project') {
PROJECTED.fromArray(point).applyMatrix4(points.matrixWorld).project(camera);
x = PROJECTED.x * 0.5 * cameraAspect / feed.aspect;
y = PROJECTED.y * 0.5;
}
u = 0.5 + (x * cr - y * sr) / scale;
v = 0.5 + (x * sr + y * cr) / scale;
if (u < 0 || u > 1 || v < 0 || v > 1) return color;
}
const k = feed.pixel(u, 1 - v) * 4;
PIXEL.setRGB(feed.rgba[k] / 255, feed.rgba[k + 1] / 255, feed.rgba[k + 2] / 255, THREE.SRGBColorSpace);
return color.lerp(PIXEL.multiplyScalar(layer.bright).addScalar(0.012), layer.mix * 0.91);
};
}
export function drawInners(draw, volume, layer, palette, removed, screen) {
const random = seededRandom(0x517e51);
const { min, max, inside } = volume;
const span = max.map((v, i) => v - min[i]);
const complexity = layer.complexity;
const count = Math.round(55 + layer.density ** 1.2 * 860);
const steps = Math.round(15 + complexity * 28);
const mode = layer.mode;
const space = Math.max(...span);
const step = space * 0.017;
const open = removed ? (x, y, z) => inside(x, y, z) && !removed(x, y, z) : inside;
const beam = (a, b, tone, light) => {
if (removed && (removed(...a) || !insideSegment(open, a, b))) return;
const color = tint(palette, tone);
draw.segment(a, b, screen ? screen(b, color) : color, light);
};
for (let i = 0; i < count; i++) {
let start;
for (let j = 0; j < 12; j++) {
start = volume.seed ? volume.seed(random) : min.map((v, k) => v + random() * span[k]);
start = vertex(...start);
if (inside(...start)) break;
start = null;
}
if (!start) continue;
const phase = random() * TAU;
const tone = random();
const length = Math.round(steps * (0.55 + 0.6 * random()));
const light = 0.42 + random() ** 1.4 * 0.87;
if (mode === 'orbit' || mode === 'weave') {
const radius = (0.07 + random() ** 1.6 * 0.46) * space;
const band = (i % 13) / 12;
const warp = i % 2 === 0;
const point = (s, offset = 0) => {
if (mode === 'orbit') {
const a = phase + s * TAU * (0.8 + complexity * 1.1);
const r = radius * (0.18 + s * 0.82);
return vertex(
start[0] + Math.cos(a) * r,
start[1] + Math.sin(a) * r * 0.68 * Math.sin(phase) + Math.sin(a * 2) * r * 0.23,
start[2] + Math.sin(a) * r * Math.cos(phase),
);
}
const axis = (i % 44 + 0.5) / 44 + offset;
const u = warp ? s : axis;
const v = warp ? axis : s;
return vertex(
min[0] + u * span[0],
min[1] + v * span[1],
min[2] + span[2] * (0.16 + band * 0.68 + Math.sin((u * 1.2 + v) * TAU * (1 + complexity) + band * 4) * 0.14),
);
};
const ribbonWidth = 0.004 + complexity * 0.013;
const membrane = mode === 'weave' && i % 6 === 0;
let a = point(0);
for (let j = 1; j <= length; j++) {
const b = point(j / length);
if (open(...a) && insideSegment(open, a, b)) {
beam(a, b, mode === 'orbit' ? tone * 0.75 + j / length * 0.25 : band, light);
if (membrane) {
const c = point((j - 1) / length, ribbonWidth);
const d = point(j / length, ribbonWidth);
if (open(...c) && insideSegment(open, c, d) && insideSegment(open, a, c) && insideSegment(open, b, d) && insideSegment(open, b, c)) {
const color = tint(palette, band * 0.85 + 0.15);
draw.quad(a, c, b, d, screen ? screen(b, color) : color, light * 0.63);
}
}
}
a = b;
}
continue;
}
const grow = mode === 'growth';
const frequency = (2.5 + complexity * 4.3) / space;
const paths = [{ p: start, phase, length, branch: 0 }];
for (const path of paths) {
let a = path.p;
for (let k = 0; k < path.length; k++) {
const [x, y, z] = a;
const f = path.phase;
const dx = Math.sin(y * frequency + 0.7) - Math.cos(z * frequency + f * 0.33);
const dy = Math.sin(z * frequency - 0.4) - Math.cos(x * frequency + f * 0.22) + (grow ? 0.8 : 0);
const dz = Math.sin(x * frequency + f * 0.22) - Math.cos(y * frequency - 0.7);
const speed = step / Math.max(0.25, Math.hypot(dx, dy, dz));
const b = vertex(x + dx * speed, y + dy * speed, z + dz * speed);
if (!insideSegment(inside, a, b)) break;
beam(a, b, tone * 0.75 + k / path.length * 0.25, light * (path.branch ? 0.62 : 1));
if (grow && path.branch === 0 && k > 2 && k % 7 === 0 && random() < 0.35 + complexity * 0.56) {
paths.push({ p: b, phase: f + (random() - 0.5) * 16, length: Math.round(5 + complexity * 11), branch: 1 });
}
a = b;
}
}
}
}
function distance(a, b) {
return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
export function drawAffinity(draw, feed, layer, palette) {
if (!feed.patches?.length) return;
const { w, h } = feed;
const { x, y } = mediaBounds(feed.aspect);
const threshold = 3.15 - 2.75 * layer.similarity;
const strength = layer.strength;
const patches = feed.patches.filter((p) => p.life >= 2 && p.energy > 0.42);
const groups = [];
const point = (p, z = 0) => [(p.x / w * 2 - 1) * x, (1 - p.y / h * 2) * y, z];
for (const p of patches) {
let chosen = null, best = threshold;
for (const g of groups) {
const d = Math.hypot(p.vx - g.vx, p.vy - g.vy, (p.ax - g.ax) * 0.45, (p.ay - g.ay) * 0.45, (p.energy - g.energy) * 0.28);
if (d < best) {
best = d;
chosen = g;
}
}
if (!chosen) {
chosen = { vx: p.vx, vy: p.vy, ax: p.ax, ay: p.ay, energy: p.energy, points: [] };
groups.push(chosen);
}
chosen.points.push(p);
}
for (const g of groups) {
if (g.points.length < 2) continue;
const direction = Math.atan2(-g.vy, g.vx) / TAU + 0.5;
const level = strength * Math.min(1, 0.3 + g.energy * 0.23);
const color = tint(palette, direction);
if (layer.mode === 'clusters') {
const center = g.points.reduce(([x, y], p) => [x + p.x / g.points.length, y + p.y / g.points.length], [0, 0]);
for (const p of g.points) {
const base = point(p);
const gather = level * 0.45;
base[0] += ((center[0] - p.x) / w * 2 * x) * gather + (g.vx * 0.08 + p.ax * 0.04) * level;
base[1] -= ((center[1] - p.y) / h * 2 * y) * gather + (g.vy * 0.08 + p.ay * 0.04) * level;
base[2] = level * (0.22 + g.energy * 0.09);
for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
const idx = (p.y + j) * w + p.x + i;
const k = idx * 4;
const lum = feed.gray[idx];
PIXEL.setRGB(feed.rgba[k] / 255, feed.rgba[k + 1] / 255, feed.rgba[k + 2] / 255, THREE.SRGBColorSpace);
PIXEL.lerp(color, 0.48);
draw.vertex(draw.points, [base[0] + i * x * 2 / w, base[1] - j * y * 2 / h, base[2] + (lum - 0.45) * level * 0.22], PIXEL, 0.55 + level);
}
}
continue;
}
for (const p of g.points) {
const a = point(p);
const link = g.points.find((q) => q.y * w + q.x > p.y * w + p.x && Math.hypot(q.x - p.x, q.y - p.y) > 13);
draw.vertex(draw.points, a, color, 1.05);
if (!link) continue;
const b = point(link);
const reach = distance(a, b);
let last = a;
for (let i = 1; i <= 16; i++) {
const s = i / 16;
const bow = Math.sin(Math.PI * s) * reach * level;
const next = [a[0] + (b[0] - a[0]) * s + bow * g.vx * 0.05, a[1] + (b[1] - a[1]) * s - bow * g.vy * 0.05, bow * 0.67];
draw.segment(last, next, color, 0.5 + s * 0.55);
last = next;
}
}
}
}
export class FabricHistory {
constructor(cloud) {
const random = seededRandom(0x37af130);
const count = Math.min(220, cloud.count);
this.ids = Array.from({ length: count }, (_, i) => Math.floor((i + random()) * cloud.count / count));
this.frames = [];
this.clock = 0;
this.version = 0;
}
sample(positions, anim) {
const step = 1 / 19;
const gap = Math.abs(anim.time - this.time);
if (this.clip !== anim.clipIndex || (gap > 0.35 && (!anim.playing || gap < anim.duration - 0.22))) {
this.frames.length = 0;
this.time = undefined;
}
if (this.time !== undefined && gap < step) return;
this.clock += Number.isFinite(gap) && gap < 0.35 ? gap : step;
this.clip = anim.clipIndex;
this.time = anim.time;
const points = this.ids.map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
if (!this.frames.length) this.pairs = points.map((p, i) => {
let next = -1, other = -1, d = 0.24, d2 = 0.28;
for (let j = 0; j < points.length; j++) {
if (i === j) continue;
const delta = distance(p, points[j]);
if (delta > 0.015 && delta < d) {
other = next;
d2 = d;
next = j;
d = delta;
} else if (delta > 0.04 && delta < d2) {
other = j;
d2 = delta;
}
}
return [next, other];
});
this.frames.push({ time: this.clock, points });
while (this.frames.length > 84 || this.frames[0].time < this.clock - 4.1) this.frames.shift();
this.version++;
}
}
export function drawFabric(draw, fabric, layer, palette) {
const frames = fabric.frames.filter((f) => f.time >= fabric.clock - layer.history);
const count = Math.round(fabric.ids.length * (0.08 + layer.density * 0.92));
for (let t = 1; t < frames.length; t++) {
const prev = frames[t - 1].points, cur = frames[t].points;
const age = t / (frames.length - 1);
for (let i = 0; i < count; i++) {
const a = prev[i], c = cur[i];
if (distance(a, c) < 0.0015 || distance(a, c) > 0.42) continue;
const color = tint(palette, (i % 23) / 22 * 0.59 + age * 0.41);
draw.segment(a, c, color, 0.34 + age * 0.65);
if (layer.mode === 'threads') continue;
const [j, k] = fabric.pairs[i];
if (j < 0 || distance(prev[j], cur[j]) > 0.42) continue;
draw.quad(a, prev[j], c, cur[j], color, (layer.mode === 'ribbons' ? 0.55 : 0.9) * age);
if (layer.mode === 'ribbons') {
draw.segment(prev[j], cur[j], color, 0.6);
} else if (k >= 0 && distance(prev[k], cur[k]) < 0.42) {
draw.quad(a, prev[k], c, cur[k], color, 0.44 + age * 0.36);
if (t % 3 === 0) draw.segment(c, cur[j], color, 0.39 + age * 0.46);
}
}
}
}
export function voidField(slices, volume, layer) {
const last = slices.at(-1);
if (!last) return null;
const recent = slices.filter((s) => s.time >= last.time - layer.history);
const [mx, my, mz] = volume.min;
const [rx, ry, rz] = volume.max;
const spanX = rx - mx, spanY = ry - my, spanZ = rz - mz;
const thickness = spanZ * layer.depth;
const center = (mz + rz) * 0.5;
const activeMin = layer.mode === 'cut' ? rz - thickness : center - thickness * 0.5;
const maskAt = (s, u, v) => s.mask && s.mask[Math.floor(v * s.h) * s.w + Math.floor(u * s.w)] > 0;
return (x, y, z) => {
const u = (x - mx) / spanX, v = 1 - (y - my) / spanY, t = (z - activeMin) / thickness;
if (u < 0 || u >= 1 || v < 0 || v >= 1 || t < 0 || t > 1) return false;
if (layer.mode === 'cut') return maskAt(last, u, v);
const idx = Math.min(recent.length - 1, Math.floor(t * recent.length));
return maskAt(recent[idx], u, v);
};
}
export function drawVoid(draw, volume, field, layer, palette, inner) {
const { min, max, inside } = volume;
const n = 38;
const d = max.map((v, i) => (v - min[i]) / n);
const random = seededRandom(0x34e34e);
const negative = layer.mode === 'negative';
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
const x = min[0] + (i + 0.29 + random() * 0.42) * d[0];
const y = min[1] + (j + 0.29 + random() * 0.42) * d[1];
const z = min[2] + (k + 0.29 + random() * 0.42) * d[2];
if (!inside(x, y, z)) continue;
const cut = !!field(x, y, z);
if (cut !== negative) continue;
const edge = !!field(x + d[0], y, z) !== cut || !!field(x - d[0], y, z) !== cut
|| !!field(x, y + d[1], z) !== cut || !!field(x, y - d[1], z) !== cut
|| !!field(x, y, z + d[2]) !== cut || !!field(x, y, z - d[2]) !== cut;
if (inner && !negative && !edge) continue;
const rim = !inside(x, y, z + d[2]) || !inside(x, y, z - d[2]);
if (!edge && !rim && random() > (negative ? 0.46 : 0.18)) continue;
const color = tint(palette, edge || negative ? 0.58 + k / n * 0.41 : k / n * 0.5);
draw.vertex(draw.points, [x, y, z], color, edge ? 1.08 : rim ? 0.54 : 0.3);
}
}
