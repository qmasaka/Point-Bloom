import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { mediaBounds, seededRandom } from './material-volume.js';
import { tint } from './material-drawing.js';
const TAU = Math.PI * 2;
const PIXEL = new THREE.Color();
const at = (x, y, z) => [Math.fround(x), Math.fround(y), Math.fround(z)];
function sampleColor(feed, u, v) {
const k = feed.pixel(clamp(u, 0, 1), clamp(v, 0, 1)) * 4;
PIXEL.setRGB(feed.rgba[k] / 255, feed.rgba[k + 1] / 255, feed.rgba[k + 2] / 255, THREE.SRGBColorSpace);
return PIXEL.clone().multiplyScalar(1.25).addScalar(0.04);
}
function smoothGray(source, w, h, passes) {
let a = Float32Array.from(source);
let b = new Float32Array(a.length);
for (let pass = 0; pass < passes; pass++) {
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
let sum = 0, count = 0;
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
const X = x + dx, Y = y + dy;
if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
sum += a[Y * w + X];
count++;
}
b[y * w + x] = sum / count;
}
[a, b] = [b, a];
}
return a;
}
export function drawContours(draw, feed, layer, palette, now) {
if (!feed?.gray) return 0;
const { w, h } = feed;
const { x: halfX, y: halfY } = mediaBounds(feed.aspect);
const gray = smoothGray(feed.gray, w, h, 1 + Math.round(layer.smooth * 3));
const histogram = new Uint32Array(64);
for (const v of gray) histogram[Math.min(63, Math.floor(clamp(v, 0, 1) * 64))]++;
const lowCut = gray.length * 0.02, highCut = gray.length * 0.98;
let running = 0, low = 0, high = 1;
for (let i = 0; i < 64; i++) {
running += histogram[i];
if (running < lowCut) low = (i + 1) / 64;
if (running < highCut) high = (i + 1) / 64;
}
const range = Math.max(0.12, high - low);
for (let i = 0; i < gray.length; i++) gray[i] = clamp((gray[i] - low) / range, 0, 1);
const levels = Math.round(layer.levels);
const depth = layer.depth;
const sweep = layer.sweep ? (now * layer.sweep * 0.12) % 1 : 0;
const dark = layer.order === 'dark';
const gain = layer.glow;
const lines = layer.look !== 'dots';
const dots = layer.look !== 'lines';
const major = Math.round(layer.major);
let drawn = 0;
for (let k = 0; k < levels; k++) {
const level = clamp((((k + 0.5) / levels + sweep) % 1), 0.03, 0.97);
const z = (dark ? 0.5 - level : level - 0.5) * depth * 1.2;
const accent = major > 0 && k % major === 0 ? 1.6 : 1;
const toneColor = tint(palette, level).clone();
const point = (i, j, edge, a, b) => {
const t = (level - a) / (b - a || 1e-6);
if (edge === 0) return [i + t, j];
if (edge === 1) return [i + 1, j + t];
if (edge === 2) return [i + t, j + 1];
return [i, j + t];
};
const emit = (p, q) => {
const mx = (p[0] + q[0]) * 0.5, my = (p[1] + q[1]) * 0.5;
const color = layer.color === 'video' ? sampleColor(feed, mx / (w - 1), my / (h - 1)) : toneColor;
const a = at((p[0] / (w - 1) * 2 - 1) * halfX, (1 - p[1] / (h - 1) * 2) * halfY, z);
const b = at((q[0] / (w - 1) * 2 - 1) * halfX, (1 - q[1] / (h - 1) * 2) * halfY, z);
if (lines) draw.segment(a, b, color, (0.5 + 0.3 * level) * accent * gain);
if (dots) draw.vertex(draw.points, [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, z], color, 0.9 * accent * gain);
drawn++;
};
for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
const a = gray[j * w + i], b = gray[j * w + i + 1], c = gray[(j + 1) * w + i + 1], d = gray[(j + 1) * w + i];
const index = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
if (index === 0 || index === 15) continue;
const top = () => point(i, j, 0, a, b), right = () => point(i, j, 1, b, c), bottom = () => point(i, j, 2, d, c), left = () => point(i, j, 3, a, d);
const centre = (a + b + c + d) * 0.25 > level;
switch (index) {
case 1: case 14: emit(left(), bottom()); break;
case 2: case 13: emit(bottom(), right()); break;
case 3: case 12: emit(left(), right()); break;
case 4: case 11: emit(top(), right()); break;
case 6: case 9: emit(top(), bottom()); break;
case 7: case 8: emit(left(), top()); break;
case 5:
if (centre) {
emit(left(), top());
emit(bottom(), right());
} else {
emit(top(), right());
emit(left(), bottom());
}
break;
default:
if (centre) {
emit(top(), right());
emit(left(), bottom());
} else {
emit(left(), top());
emit(bottom(), right());
}
}
}
}
return drawn;
}
export function drawAffinity(draw, feed, layer, palette) {
if (!feed.patches?.length) return 0;
const { w, h } = feed;
const { x: halfX, y: halfY } = mediaBounds(feed.aspect);
const random = seededRandom(0x4a7f11);
const plane = (px, py, z = 0) => at((px / (w - 1) * 2 - 1) * halfX, (1 - py / (h - 1) * 2) * halfY, z);
const need = 0.14 + (1 - layer.sensitivity) * 0.8;
const threshold = 3.15 - 2.75 * layer.similarity;
const patches = feed.patches.filter((p) => p.life >= 2 && p.energy > need);
const groups = [];
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
chosen = { vx: p.vx, vy: p.vy, ax: p.ax, ay: p.ay, energy: p.energy, members: [], id: groups.length };
groups.push(chosen);
}
chosen.members.push(p);
}
const gain = layer.glow;
const colorOf = (p, group) => {
if (layer.color === 'video') return sampleColor(feed, p.x / (w - 1), p.y / (h - 1));
if (layer.color === 'group') return tint(palette, ((group.id * 0.37) % 1)).clone();
return tint(palette, Math.atan2(-p.vy, p.vx) / TAU + 0.5).clone();
};
const lift = (p) => layer.depth * Math.min(1, p.energy) * 0.45;
let drawn = 0;
if (layer.mode === 'family') {
for (const g of groups) {
if (g.members.length < 3) continue;
const members = g.members.length > 70 ? g.members.filter((_, i) => i % Math.ceil(g.members.length / 70) === 0) : g.members;
const cx = members.reduce((s, p) => s + p.x, 0) / members.length;
const cy = members.reduce((s, p) => s + p.y, 0) / members.length;
const base = colorOf({ x: cx, y: cy, vx: g.vx, vy: g.vy }, g);
const seen = new Set();
members.forEach((p, i) => {
const near = members.map((q, j) => [Math.hypot(q.x - p.x, q.y - p.y), j]).filter(([d, j]) => j !== i && d > 0.1).sort((a, b) => a[0] - b[0]).slice(0, layer.links);
for (const [d, j] of near) {
const key = Math.min(i, j) * 1000 + Math.max(i, j);
if (seen.has(key)) continue;
seen.add(key);
const q = members[j];
const sign = (i + j) % 2 ? 1 : -1;
const nx = -(q.y - p.y) / d, ny = (q.x - p.x) / d;
const bend = d * layer.bow * 0.5 * sign;
const cxm = (p.x + q.x) / 2 + nx * bend, cym = (p.y + q.y) / 2 + ny * bend;
const color = colorOf(p, g);
let last = plane(p.x, p.y, lift(p));
for (let k = 1; k <= 9; k++) {
const s = k / 9;
const x = (1 - s) * (1 - s) * p.x + 2 * (1 - s) * s * cxm + s * s * q.x;
const y = (1 - s) * (1 - s) * p.y + 2 * (1 - s) * s * cym + s * s * q.y;
const next = plane(x, y, lift(p) * (1 - s) + lift(q) * s);
draw.segment(last, next, color, 0.55 * gain);
last = next;
}
drawn++;
}
draw.vertex(draw.points, plane(p.x, p.y, lift(p)), colorOf(p, g), 1.1 * gain);
});
draw.vertex(draw.nodes, plane(cx, cy, layer.depth * 0.45), base, 1.5 * gain);
}
return drawn;
}
for (const g of groups) {
for (const p of g.members) {
if (random() > layer.density) continue;
const speed = Math.hypot(p.vx, p.vy);
if (speed < 1e-3) continue;
const dx = p.vx / speed, dy = -p.vy / speed;
const reach = layer.length * (0.04 + Math.min(1.4, p.energy) * 0.09);
const unit = 2 * halfX / (w - 1);
const color = colorOf(p, g);
if (layer.mode === 'dust') {
const count = 4 + Math.round(Math.min(1.5, p.energy) * 6);
for (let k = 0; k < count; k++) {
const back = random() * reach * 1.6;
const jitter = (random() - 0.5) * unit * 5;
const jx = (random() - 0.5) * unit * 5;
const base = plane(p.x, p.y, 0);
draw.vertex(draw.points, at(base[0] - dx * back + jx, base[1] - dy * back + jitter, lift(p) * (0.4 + random())), color, (0.7 + 1.1 * (1 - back / (reach * 1.6))) * gain);
}
drawn++;
continue;
}
const nx = -dy, ny = dx;
const bend = clamp((p.ax * dy - p.ay * dx) * 0.06, -0.5, 0.5) * reach;
const head = plane(p.x, p.y, lift(p));
let last = null;
const steps = 9;
for (let k = 0; k <= steps; k++) {
const s = k / steps;
const back = (1 - s) * reach;
const arc = Math.sin(Math.PI * s) * bend;
const point = at(head[0] - dx * back + nx * arc, head[1] - dy * back + ny * arc, head[2]);
if (last) {
draw.segment(last, point, color, (0.12 + 0.95 * s ** 1.6) * gain);
if (k % 2 === 0) draw.vertex(draw.points, point, color, (0.2 + 0.8 * s) * gain);
}
last = point;
}
if (p.energy > 0.7 && random() < 0.5) draw.vertex(draw.nodes, last, color, 0.9 * gain);
drawn++;
}
}
return drawn;
}
