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
		this.lines = [[], [], []];
		this.faces = [[], []];
		this.points = [[], [], []];
		this.nodes = [[], [], []];
	}

	vertex(kind, p, color, light = 1, t = 0, phase = 0, birth = 0) {
		kind[0].push(...p);
		kind[1].push(color.r * light, color.g * light, color.b * light);
		if (kind[2]) kind[2].push(t, phase, birth);
	}

	segment(a, b, color, light = 1, t = 0, tEnd = t, phase = 0, birth = 0, birthEnd = birth) {
		this.vertex(this.lines, a, color, light, t, phase, birth);
		this.vertex(this.lines, b, color, light, tEnd, phase, birthEnd);
	}

	quad(a, b, c, d, color, light) {
		for (const p of [a, b, c, b, d, c]) this.vertex(this.faces, p, color, light);
	}
}

const FLOW_SPEED = 0.17;

export const GROW_TIME = 9;
const HOLD_TIME = 4;
const FADE_TIME = 2.5;

export function growthCycle(now, started, speed, repeat) {
	const elapsed = Math.max(0, now - started) * speed;
	const grow = GROW_TIME;
	if (repeat !== 'loop') return { reveal: Math.min(1.2, elapsed / grow), fade: 1 };
	const u = elapsed % (grow + HOLD_TIME + FADE_TIME);
	const out = (u - grow - HOLD_TIME) / FADE_TIME;
	return { reveal: Math.min(1.2, u / grow), fade: 1 - Math.min(1, Math.max(0, out)) ** 2 };
}

export function pulseMaterial(part, now, strength, speed, cycle) {
	if (!part?.flow) return;
	const reach = 1.6 * strength;
	const floor = 1 - strength * 0.55;
	for (const [kind, flow] of Object.entries(part.flow)) {
		const base = part.base[kind];
		const attribute = part.parts[kind].geometry.attributes.color;
		if (!attribute || !flow.length) continue;
		const out = attribute.array;
		const count = flow.length / 3;
		const travel = now * speed * FLOW_SPEED;
		for (let i = 0; i < count; i++) {
			let d = flow[i * 3 + 1] + travel - flow[i * 3];
			d -= Math.floor(d);
			let k = floor + reach * Math.exp(-d * 7);
			if (cycle) {
				const age = cycle.reveal - flow[i * 3 + 2];
				k = age <= 0 ? 0 : (k + 2.2 * Math.exp(-age * 26)) * Math.min(1, age * 14) * cycle.fade;
			}
			out[i * 3] = base[i * 3] * k;
			out[i * 3 + 1] = base[i * 3 + 1] * k;
			out[i * 3 + 2] = base[i * 3 + 2] * k;
		}
		attribute.clearUpdateRanges();
		attribute.addUpdateRange(0, count * 3);
		attribute.needsUpdate = true;
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
	const mode = layer.mode;
	const space = Math.max(...span);
	const open = removed ? (x, y, z) => inside(x, y, z) && !removed(x, y, z) : inside;
	const bundles = Math.round(30 + layer.density ** 1.1 * 190);
	const steps = Math.round(26 + complexity * 56);
	const step = space * 0.0125;
	const wave = (1.3 + complexity * 3.1) * 2 / space;

	const place = () => {
		for (let j = 0; j < 14; j++) {
			const p = vertex(...(volume.seed ? volume.seed(random) : min.map((v, k) => v + random() * span[k])));
			if (inside(...p)) return p;
		}
		return null;
	};

	const link = (a, b, tone, light, t, tEnd, phase, birth = 0, birthEnd = birth) => {
		if (!insideSegment(open, a, b) || (removed && removed(...a))) return false;
		const color = tint(palette, tone);
		const shade = screen ? screen(b, color) : color;
		draw.segment(a, b, shade, light, t, tEnd, phase, birth, birthEnd);
		for (let k = 1; k <= 2; k++) {
			const f = k / 3;
			draw.vertex(draw.points, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], shade, light * 1.15, t + (tEnd - t) * f, phase, birth + (birthEnd - birth) * f);
		}
		return true;
	};

	const glow = (p, tone, light, phase, birth = 0) => {
		const color = tint(palette, Math.min(1, tone + 0.25));
		draw.vertex(draw.nodes, p, screen ? screen(p, color) : color, light * 1.2, 0, phase, birth);
	};

	const field = (p, shift, lift) => {
		const [x, y, z] = p;
		const dx = Math.sin(y * wave + 0.7 + shift) - Math.cos(z * wave + 0.9);
		const dy = Math.sin(z * wave - 0.4) - Math.cos(x * wave + 0.5 + shift) + lift;
		const dz = Math.sin(x * wave + 0.6) - Math.cos(y * wave - 0.7 - shift);
		const m = Math.max(0.25, Math.hypot(dx, dy, dz));
		return [dx / m, dy / m, dz / m];
	};

	const steer = (a, dir) => {
		const reach = (d) => {
			const b = vertex(a[0] + d[0] * step, a[1] + d[1] * step, a[2] + d[2] * step);
			return insideSegment(open, a, b) ? b : null;
		};
		const straight = reach(dir);
		if (straight) return straight;
		let ux = dir[1] * 0.46 - dir[2] * 0.83, uy = dir[2] * 0.31 - dir[0] * 0.46, uz = dir[0] * 0.83 - dir[1] * 0.31;
		const un = Math.hypot(ux, uy, uz) || 1;
		ux /= un; uy /= un; uz /= un;
		const wx = dir[1] * uz - dir[2] * uy, wy = dir[2] * ux - dir[0] * uz, wz = dir[0] * uy - dir[1] * ux;
		for (const bend of [0.5, 1, 1.7, 3]) {
			for (const [cu, cw] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]]) {
				const d = [dir[0] + (ux * cu + wx * cw) * bend, dir[1] + (uy * cu + wy * cw) * bend, dir[2] + (uz * cu + wz * cw) * bend];
				const m = Math.hypot(...d) || 1;
				const b = reach([d[0] / m, d[1] / m, d[2] / m]);
				if (b) return b;
			}
		}
		return null;
	};

	const follow = (from, length, shift, lift, tone, light, phase, spread) => {
		let a = from;
		let last = null;
		for (let k = 0; k < length; k++) {
			const dir = field(a, shift, lift);
			const b = steer(a, dir);
			if (!b) break;
			if (!link(a, b, tone + k / length * spread, light * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, (k + 1) / length * 1.15))), k / length, (k + 1) / length, phase)) break;
			last = b;
			a = b;
		}
		return last;
	};

	const growTree = () => {
		const count = Math.round(500 + layer.density * 2800);
		const attractors = [];
		for (let i = 0; i < count; i++) {
			const p = place();
			if (p) attractors.push({ p, alive: true });
		}
		if (!attractors.length) return;
		const reach = space * (0.16 + (1 - complexity) * 0.08);
		const kill = space * 0.03;
		const bite = space * 0.017;
		const cell = reach;
		const key = (x, y, z) => x + ',' + y + ',' + z;
		const grid = new Map();
		const nodes = [];
		const addNode = (p, parent, iteration) => {
			const index = nodes.length;
			nodes.push({ p, parent, iteration, weight: 1, leaf: true });
			if (parent >= 0) nodes[parent].leaf = false;
			const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
			if (!grid.has(k)) grid.set(k, []);
			grid.get(k).push(index);
			return index;
		};
		const roots = 2 + Math.round(complexity * 3);
		for (let r = 0; r < roots; r++) {
			let best = null;
			for (let j = 0; j < 12; j++) {
				const p = place();
				if (p && (!best || p[1] < best[1])) best = p;
			}
			if (best) addNode(best, -1, 0);
		}
		const limit = 14000;
		const rounds = 260;
		let used = 0;
		for (let round = 1; round <= rounds && nodes.length < limit; round++) {
			const pulls = new Map();
			let any = false;
			for (const attractor of attractors) {
				if (!attractor.alive) continue;
				const [x, y, z] = attractor.p;
				const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
				let nearest = -1, best = reach;
				for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
					const list = grid.get(key(cx + dx, cy + dy, cz + dz));
					if (!list) continue;
					for (const n of list) {
						const q = nodes[n].p;
						const d = Math.hypot(q[0] - x, q[1] - y, q[2] - z);
						if (d < best) {
							best = d;
							nearest = n;
						}
					}
				}
				if (nearest < 0) continue;
				if (best < kill) {
					attractor.alive = false;
					continue;
				}
				any = true;
				const q = nodes[nearest].p;
				const pull = pulls.get(nearest) || [0, 0, 0];
				pull[0] += (x - q[0]) / best;
				pull[1] += (y - q[1]) / best;
				pull[2] += (z - q[2]) / best;
				pulls.set(nearest, pull);
			}
			if (!any) break;
			used = round;
			for (const [n, pull] of pulls) {
				const m = Math.hypot(...pull);
				if (m < 1e-6) continue;
				const q = nodes[n].p;
				const jitter = (random() - 0.5) * 0.35;
				const b = vertex(q[0] + (pull[0] / m + jitter) * bite, q[1] + (pull[1] / m + jitter) * bite, q[2] + (pull[2] / m - jitter) * bite);
				if (!insideSegment(open, q, b)) continue;
				const bx = Math.floor(b[0] / cell), by = Math.floor(b[1] / cell), bz = Math.floor(b[2] / cell);
				let crowded = false;
				for (let dx = -1; dx <= 1 && !crowded; dx++) for (let dy = -1; dy <= 1 && !crowded; dy++) for (let dz = -1; dz <= 1 && !crowded; dz++) {
					const list = grid.get(key(bx + dx, by + dy, bz + dz));
					if (!list) continue;
					for (const o of list) {
						if (o === n) continue;
						const w = nodes[o].p;
						if (Math.hypot(w[0] - b[0], w[1] - b[1], w[2] - b[2]) < bite * 0.6) {
							crowded = true;
							break;
						}
					}
				}
				if (crowded) continue;
				addNode(b, n, round);
			}
		}
		for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].parent >= 0) nodes[nodes[i].parent].weight += nodes[i].weight;
		const heaviest = Math.max(...nodes.map((n) => n.weight));
		const total = Math.max(1, used);
		let tips = 0;
		for (const node of nodes) {
			if (node.parent < 0) continue;
			const parent = nodes[node.parent];
			const birth = node.iteration / total * 0.92;
			const birthStart = parent.iteration / total * 0.92;
			const thick = (node.weight / heaviest) ** 0.45;
			const light = 0.45 + thick * 0.55;
			const tone = 0.1 + 0.9 * birth;
			link(parent.p, node.p, tone, light, birthStart * 2.4, birth * 2.4, 0, birthStart, birth);
			if (thick > 0.5 && random() < 0.35) {
				const wobble = space * 0.004;
				draw.vertex(draw.points, [node.p[0] + (random() - 0.5) * wobble, node.p[1] + (random() - 0.5) * wobble, node.p[2] + (random() - 0.5) * wobble], tint(palette, tone), light * 0.9, birth * 2.4, 0, birth);
			}
			if (node.leaf && tips < 700 && random() < 0.8) {
				tips++;
				glow(node.p, tone, 0.8 + random() * 0.6, 0, birth);
			}
		}
	};

	const growNetwork = () => {
		const count = Math.round(90 + layer.density * 520);
		const separation = space * 0.62 / Math.cbrt(count);
		const points = [];
		for (let attempt = 0; attempt < count * 14 && points.length < count; attempt++) {
			const p = place();
			if (!p) continue;
			if (points.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > separation)) points.push(p);
		}
		if (points.length < 2) return;
		const neighbours = 2 + Math.round(complexity * 2.4);
		const reachMax = separation * 3.6;
		const edges = new Map();
		const adjacent = points.map(() => []);
		points.forEach((p, i) => {
			const order = points.map((q, j) => [Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), j]).filter(([d, j]) => j !== i && d < reachMax).sort((a, b) => a[0] - b[0]).slice(0, neighbours);
			for (const [, j] of order) {
				const a = Math.min(i, j), b = Math.max(i, j);
				const id = a * 100000 + b;
				if (edges.has(id)) continue;
				let clear = true;
				for (let k = 1; k < 6 && clear; k++) {
					const f = k / 6;
					clear = open(points[a][0] + (points[b][0] - points[a][0]) * f, points[a][1] + (points[b][1] - points[a][1]) * f, points[a][2] + (points[b][2] - points[a][2]) * f);
				}
				if (!clear) continue;
				edges.set(id, [a, b]);
				adjacent[a].push(b);
				adjacent[b].push(a);
			}
		});
		const depth = new Array(points.length).fill(-1);
		let farthest = 1;
		const queue = [];
		const visit = (start, offset) => {
			depth[start] = offset;
			queue.push(start);
			while (queue.length) {
				const n = queue.shift();
				for (const m of adjacent[n]) {
					if (depth[m] >= 0) continue;
					depth[m] = depth[n] + 1;
					farthest = Math.max(farthest, depth[m]);
					queue.push(m);
				}
			}
		};
		visit(Math.floor(random() * points.length), 0);
		for (let i = 0; i < points.length; i++) if (depth[i] < 0) visit(i, Math.floor(random() * farthest * 0.7));
		const birthOf = (i) => Math.min(0.9, depth[i] / (farthest + 1) * 0.9);
		const tones = points.map(() => random());
		const bow = 0.12 + complexity * 0.22;
		for (const [a, b] of edges.values()) {
			const p = points[a], q = points[b];
			const [first, second] = depth[a] <= depth[b] ? [a, b] : [b, a];
			const from = points[first], to = points[second];
			const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
			const nx = random() - 0.5, ny = random() - 0.5, nz = random() - 0.5;
			const norm = Math.hypot(nx, ny, nz) || 1;
			const side = [nx / norm * length * bow, ny / norm * length * bow, nz / norm * length * bow];
			const curve = (s) => {
				const lift = Math.sin(Math.PI * s);
				return vertex(from[0] + (to[0] - from[0]) * s + side[0] * lift, from[1] + (to[1] - from[1]) * s + side[1] * lift, from[2] + (to[2] - from[2]) * s + side[2] * lift);
			};
			const pieces = 9;
			const b0 = birthOf(first), b1 = Math.max(b0 + 0.02, birthOf(second));
			let last = from;
			for (let k = 1; k <= pieces; k++) {
				const s = k / pieces;
				const next = curve(s);
				const tone = tones[first] + (tones[second] - tones[first]) * s;
				link(last, next, tone, 0.75, (b0 + (b1 - b0) * (s - 1 / pieces)) * 2.4, (b0 + (b1 - b0) * s) * 2.4, 0, b0 + (b1 - b0) * (s - 1 / pieces), b0 + (b1 - b0) * s);
				last = next;
			}
		}
		points.forEach((p, i) => {
			const hub = Math.min(1, adjacent[i].length / 5);
			const birth = birthOf(i);
			glow(p, tones[i], 0.7 + hub * 1.1, 0, birth);
			if (hub > 0.5) glow([p[0] + (random() - 0.5) * space * 0.006, p[1] + (random() - 0.5) * space * 0.006, p[2]], tones[i], 0.9, 0, birth);
		});
	};

	if (mode === 'growth') return growTree();
	if (mode === 'network') return growNetwork();

	for (let i = 0; i < bundles; i++) {
		const start = place();
		if (!start) continue;
		const phase = random();
		const tone = random();
		const light = 0.5 + random() ** 1.3 * 0.8;
		const length = Math.round(steps * (0.6 + 0.55 * random()));

		if (mode === 'orbit') {
			const radius = (0.08 + random() ** 1.3 * 0.42) * space;
			const tilt = random() * TAU;
			const spin = (0.45 + complexity * 0.85) * (random() < 0.5 ? -1 : 1);
			const rings = 1 + Math.floor(random() * 2);
			for (let ring = 0; ring < rings; ring++) {
				const r0 = radius * (0.55 + ring * 0.38);
				const lean = tilt + ring * 0.7;
				const point = (s) => {
					const angle = phase * TAU + s * TAU * spin;
					const r = r0 * (0.5 + s * 0.5);
					return vertex(
						start[0] + Math.cos(angle) * r,
						start[1] + Math.sin(angle) * r * Math.sin(lean) + Math.sin(angle * 2) * r * 0.16,
						start[2] + Math.sin(angle) * r * Math.cos(lean),
					);
				};
				const turns = Math.round(length * 1.3);
				let a = point(0);
				for (let j = 1; j <= turns; j++) {
					const b = point(j / turns);
					if (open(...a)) link(a, b, tone * 0.7 + j / turns * 0.3, light, (j - 1) / turns, j / turns, phase + ring * 0.21);
					a = b;
				}
				if (open(...a)) glow(a, tone, light, phase);
			}
			continue;
		}

		if (mode === 'weave') {
			const axisCount = 46;
			const band = (i % 13) / 12;
			const warp = i % 2 === 0;
			const lane = (i % axisCount + 0.5) / axisCount;
			const point = (s) => {
				const u = warp ? s : lane;
				const v = warp ? lane : s;
				return vertex(
					min[0] + u * span[0],
					min[1] + v * span[1],
					min[2] + span[2] * (0.16 + band * 0.68 + Math.sin((u * 1.2 + v) * TAU * (1 + complexity) + band * 4) * 0.14),
				);
			};
			const cuts = Math.round(steps * 1.4);
			let a = point(0);
			for (let j = 1; j <= cuts; j++) {
				const b = point(j / cuts);
				if (open(...a)) link(a, b, band, light, (j - 1) / cuts, j / cuts, phase);
				if (open(...a) && i % 6 === 0 && j % 5 === 0) glow(a, band, light * 0.8, phase);
				a = b;
			}
			continue;
		}

		const fibres = 4 + Math.floor(random() * 5);
		for (let f = 0; f < fibres; f++) {
			const from = f === 0 ? start : vertex(start[0] + (random() - 0.5) * space * 0.03, start[1] + (random() - 0.5) * space * 0.03, start[2] + (random() - 0.5) * space * 0.03);
			if (!inside(...from)) continue;
			const end = follow(from, length, (i % 7) * 0.05, 0, tone, light * (0.75 + 0.25 * random()), phase + f * 0.03, 0.25);
			if (end && f === 0) glow(end, tone, light, phase);
		}
	}
}

export function drawShell(draw, positions, colors, hide, palette, limit) {
	const count = positions.length / 3;
	const stride = Math.max(1, Math.floor(count / limit));
	const color = new THREE.Color();
	for (let i = 0; i < count; i += stride) {
		if (hide && hide[i] > 0.5) continue;
		color.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]).lerp(palette[0], 0.45);
		draw.vertex(draw.points, [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]], color, 0.3);
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
