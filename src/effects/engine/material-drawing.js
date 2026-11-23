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
		if (kind[2]) kind[2].push(t, phase, birth, light);
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

const PULSE_PERIOD = 1 / 30;
const PULSE_TABLE = Float32Array.from({ length: 256 }, (_, i) => Math.exp(-(i / 255) * 7));

export function pulseMaterial(part, now, strength, speed, cycle, video) {
	if (!part?.flow) return;
	const refresh = !!video && part.videoVersion !== video.version;
	if (!refresh && part.lastPulse !== undefined && now - part.lastPulse < PULSE_PERIOD) return;
	part.lastPulse = now;
	if (refresh) part.videoVersion = video.version;
	const reach = 1.6 * strength;
	const floor = 1 - strength * 0.55;
	const travel = now * speed * FLOW_SPEED;
	for (const [kind, flow] of Object.entries(part.flow)) {
		const base = part.base[kind];
		const object = part.parts[kind];
		const attribute = object.geometry.attributes.color;
		if (!attribute || !flow.length) continue;
		const out = attribute.array;
		const wide = attribute.itemSize === 4;
		const count = flow.length / 4;
		if (refresh) {
			const position = object.geometry.attributes.position.array;
			const { rgba, w, h, halfX, halfY } = video;
			for (let i = 0; i < count; i++) {
				const u = Math.min(0.999, Math.max(0, position[i * 3] / (2 * halfX) + 0.5));
				const v = Math.min(0.999, Math.max(0, 0.5 - position[i * 3 + 1] / (2 * halfY)));
				const k = (Math.floor(v * h) * w + Math.floor(u * w)) * 4;
				const r = rgba[k] / 255, g = rgba[k + 1] / 255, b = rgba[k + 2] / 255;
				const peak = Math.max(r, g, b, 0.04);
				const light = flow[i * 4 + 3] * (0.5 + 0.9 * Math.sqrt(peak)) / peak;
				base[i * 3] = r * light;
				base[i * 3 + 1] = g * light;
				base[i * 3 + 2] = b * light;
			}
		}
		for (let i = 0; i < count; i++) {
			const j = i * 4;
			let d = flow[j + 1] + travel - flow[j];
			d -= Math.floor(d);
			let k = floor + reach * PULSE_TABLE[(d * 255) | 0];
			if (cycle) {
				const age = cycle.reveal - flow[j + 2];
				k = age <= 0 ? 0 : (k + 2.2 * (age < 0.3 ? Math.exp(-age * 26) : 0)) * Math.min(1, age * 14) * cycle.fade;
			}
			const o = i * 3;
			const r = base[o] * k, g = base[o + 1] * k, b = base[o + 2] * k;
			if (wide) {
				const m = Math.max(r, g, b);
				const q = i * 4;
				const keep = m > 1 ? 1 : m > 0.0001 ? 1 / m : 0;
				out[q] = r * keep;
				out[q + 1] = g * keep;
				out[q + 2] = b * keep;
				out[q + 3] = m > 1 ? 1 : m;
			} else {
				out[o] = r;
				out[o + 1] = g;
				out[o + 2] = b;
			}
		}
		attribute.clearUpdateRanges();
		attribute.addUpdateRange(0, count * attribute.itemSize);
		attribute.needsUpdate = true;
	}
}

export function tint(palette, v) {
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
	const o = {
		roots: Math.round(layer.roots ?? 3),
		reach: layer.reach ?? 0.5,
		trunk: layer.trunk ?? 0.55,
		tips: layer.tips ?? 0.8,
		links: Math.round(layer.links ?? 3),
		bow: layer.bow ?? 0.4,
		ribs: layer.ribs ?? 0.5,
		strands: Math.round(layer.strands ?? 3),
		twist: layer.twist ?? 2,
		spread: layer.spread ?? 0.85,
		prune: layer.prune ?? 0.5,
		glow: (layer.glow ?? 1) * (layer.tone === 'video' ? 1.8 : 1),
		hue: layer.hue ?? 0,
		tone: layer.tone ?? 'grow',
	};

	const toneOf = (birth, p) => {
		let t = birth;
		if (o.tone === 'height') t = clamp((p[1] - min[1]) / Math.max(1e-6, span[1]), 0, 1);
		else if (o.tone === 'solid') t = 0.5;
		const w = (t + o.hue) % 2;
		return w > 1 ? 2 - w : w;
	};

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
		const gain = light * o.glow;
		draw.segment(a, b, shade, gain, t, tEnd, phase, birth, birthEnd);
		for (let k = 1; k <= 2; k++) {
			const f = k / 3;
			draw.vertex(draw.points, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], shade, gain * 1.15, t + (tEnd - t) * f, phase, birth + (birthEnd - birth) * f);
		}
		return true;
	};

	const glow = (p, tone, light, phase, birth = 0) => {
		const color = tint(palette, Math.min(1, tone + 0.25));
		draw.vertex(draw.nodes, p, screen ? screen(p, color) : color, light * 1.2 * o.glow, 0, phase, birth);
	};

	const growTree = () => {
		const count = Math.round(500 + layer.density * 2800);
		const attractors = [];
		for (let i = 0; i < count; i++) {
			const p = place();
			if (p) attractors.push({ p, alive: true });
		}
		if (!attractors.length) return;
		const reach = space * (0.09 + o.reach * 0.2 + (1 - complexity) * 0.04);
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
		const roots = o.roots;
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
			const light = 0.35 + thick * (0.25 + o.trunk * 0.9);
			const tone = toneOf(birth, node.p);
			link(parent.p, node.p, tone, light, birthStart * 2.4, birth * 2.4, 0, birthStart, birth);
			if (thick > 0.5 && random() < 0.35) {
				const wobble = space * 0.004;
				draw.vertex(draw.points, [node.p[0] + (random() - 0.5) * wobble, node.p[1] + (random() - 0.5) * wobble, node.p[2] + (random() - 0.5) * wobble], tint(palette, tone), light * 0.9, birth * 2.4, 0, birth);
			}
			if (node.leaf && tips < 900 && random() < o.tips) {
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
		const neighbours = o.links;
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
		const nodeLight = 0.35 + o.tips * 1.1;
		const bow = 0.04 + o.bow * 0.5;
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
				const tone = toneOf(b0 + (b1 - b0) * s, [from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s, 0]) * 0.55 + (tones[first] + (tones[second] - tones[first]) * s) * 0.45;
				link(last, next, tone, 0.75, (b0 + (b1 - b0) * (s - 1 / pieces)) * 2.4, (b0 + (b1 - b0) * s) * 2.4, 0, b0 + (b1 - b0) * (s - 1 / pieces), b0 + (b1 - b0) * s);
				last = next;
			}
		}
		points.forEach((p, i) => {
			const hub = Math.min(1, adjacent[i].length / 5);
			const birth = birthOf(i);
			glow(p, toneOf(birth, p), (0.5 + hub * 0.9) * nodeLight, 0, birth);
			if (hub > 0.5) glow([p[0] + (random() - 0.5) * space * 0.006, p[1] + (random() - 0.5) * space * 0.006, p[2]], tones[i], 0.9, 0, birth);
		});
	};

	const growSkeleton = () => {
		const resolution = 34 + Math.round(layer.density * 22);
		const cell = space / resolution;
		const nx = Math.ceil(span[0] / cell) + 2, ny = Math.ceil(span[1] / cell) + 2, nz = Math.ceil(span[2] / cell) + 2;
		const total = nx * ny * nz;
		const at = (x, y, z) => x + nx * (y + ny * z);
		const solid = new Uint8Array(total);
		const dist = new Float32Array(total);
		for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
			const on = open(min[0] + (x - 0.5) * cell, min[1] + (y - 0.5) * cell, min[2] + (z - 0.5) * cell);
			solid[at(x, y, z)] = on ? 1 : 0;
			dist[at(x, y, z)] = on ? 1e9 : 0;
		}
		const ox = [], oy = [], oz = [], ow = [], ob = [];
		for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			if (!dx && !dy && !dz) continue;
			ox.push(dx);
			oy.push(dy);
			oz.push(dz);
			ow.push(Math.hypot(dx, dy, dz));
			ob.push(dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0))));
		}
		const neighbourCount = ox.length;
		const planeStep = nx * ny;
		for (const forward of [true, false]) {
			for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
				const x = forward ? i : nx - 1 - i, y = forward ? j : ny - 1 - j, z = forward ? k : nz - 1 - k;
				const here = x + nx * y + planeStep * z;
				if (!solid[here]) continue;
				let best = dist[here];
				for (let n = 0; n < neighbourCount; n++) {
					if (ob[n] !== forward) continue;
					const X = x + ox[n], Y = y + oy[n], Z = z + oz[n];
					if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
					const value = dist[X + nx * Y + planeStep * Z] + ow[n];
					if (value < best) best = value;
				}
				dist[here] = best;
			}
		}
		let thickest = 0;
		for (let i = 0; i < total; i++) if (solid[i]) thickest = Math.max(thickest, dist[i]);
		if (thickest < 2) return false;
		const cost = new Float32Array(total).fill(Infinity);
		const along = new Float32Array(total);
		const from = new Int32Array(total).fill(-1);
		const covered = new Uint8Array(total);
		const onSkeleton = new Uint8Array(total);
		const keys = [], nodesQueue = [];
		const push = (key, node) => {
			let i = keys.length;
			keys.push(key);
			nodesQueue.push(node);
			while (i > 0) {
				const up = (i - 1) >> 1;
				if (keys[up] <= key) break;
				keys[i] = keys[up];
				nodesQueue[i] = nodesQueue[up];
				i = up;
			}
			keys[i] = key;
			nodesQueue[i] = node;
		};
		const pop = () => {
			const node = nodesQueue[0];
			const key = keys.pop();
			const last = nodesQueue.pop();
			const size = keys.length;
			if (size) {
				let i = 0;
				for (;;) {
					let child = i * 2 + 1;
					if (child >= size) break;
					if (child + 1 < size && keys[child + 1] < keys[child]) child++;
					if (keys[child] >= key) break;
					keys[i] = keys[child];
					nodesQueue[i] = nodesQueue[child];
					i = child;
				}
				keys[i] = key;
				nodesQueue[i] = last;
			}
			return node;
		};
		const chains = [];
		const minVoxels = (space * (0.012 + (1 - o.prune) * 0.2)) / cell;
		let longest = 1e-6;
		for (let component = 0; component < 4 && chains.length < 140; component++) {
			let root = -1;
			for (let i = 0; i < total; i++) if (solid[i] && cost[i] === Infinity && (root < 0 || dist[i] > dist[root])) root = i;
			if (root < 0 || dist[root] < 2) break;
			const members = [root];
			cost[root] = 0;
			along[root] = 0;
			push(0, root);
			while (keys.length) {
				const key = keys[0];
				const v = pop();
				if (key > cost[v]) continue;
				const x = v % nx, y = Math.floor(v / nx) % ny, z = Math.floor(v / (nx * ny));
				for (let q = 0; q < neighbourCount; q++) {
					const X = x + ox[q], Y = y + oy[q], Z = z + oz[q];
					if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
					const n = X + nx * Y + planeStep * Z;
					if (!solid[n]) continue;
					const w = ow[q];
					const middle = (dist[v] + dist[n]) * 0.5;
					const next = key + w * (1 + 30 * Math.max(0, 1 - middle / thickest) ** 6);
					if (next < cost[n]) {
						if (cost[n] === Infinity) members.push(n);
						cost[n] = next;
						from[n] = v;
						along[n] = along[v] + w;
						push(next, n);
					}
				}
			}
			members.sort((a, b) => along[b] - along[a]);
			longest = Math.max(longest, along[members[0]]);
			onSkeleton[root] = 1;
			for (const tip of members) {
				if (covered[tip] || chains.length >= 140) continue;
				const path = [];
				let u = tip;
				while (u >= 0 && !onSkeleton[u]) {
					path.push(u);
					u = from[u];
				}
				if (u < 0) continue;
				if (along[tip] - along[u] < minVoxels) {
					covered[tip] = 1;
					continue;
				}
				path.push(u);
				path.reverse();
				for (const v of path) onSkeleton[v] = 1;
				chains.push(path);
				for (let i = 0; i < path.length; i += 2) {
					const v = path[i];
					const x = v % nx, y = Math.floor(v / nx) % ny, z = Math.floor(v / (nx * ny));
					const radius = Math.ceil(dist[v] * 1.05 + 2);
					for (let dz = -radius; dz <= radius; dz++) for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
						if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
						const X = x + dx, Y = y + dy, Z = z + dz;
						if (X >= 0 && Y >= 0 && Z >= 0 && X < nx && Y < ny && Z < nz) covered[at(X, Y, Z)] = 1;
					}
				}
			}
		}
		if (!chains.length) return false;
		const ribGap = space * (0.11 - 0.095 * o.ribs);
		const turns = o.twist * Math.PI * 2.2 / space;
		const roundSteps = 18;
		const centre = (v) => [min[0] + ((v % nx) - 0.5) * cell, min[1] + ((Math.floor(v / nx) % ny) - 0.5) * cell, min[2] + (Math.floor(v / (nx * ny)) - 0.5) * cell];
		let drawn = 0;
		for (const path of chains) {
			let pts = path.map(centre);
			const radii = path.map((v) => dist[v] * cell);
			const births = path.map((v) => Math.min(0.9, along[v] / longest * 0.9));
			for (let pass = 0; pass < 4; pass++) {
				pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : [0, 1, 2].map((k) => p[k] * 0.5 + (pts[i - 1][k] + pts[i + 1][k]) * 0.25)));
			}
			const keep = pts.map((p, i) => i).filter((i) => i % 2 === 0 || i === pts.length - 1);
			pts = keep.map((i) => pts[i]);
			const rad = keep.map((i) => radii[i]);
			const birth = keep.map((i) => births[i]);
			let u = null, arc = 0, nextRib = ribGap * random();
			const previous = [];
			for (let i = 0; i < pts.length; i++) {
				const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
				let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
				const tl = Math.hypot(tx, ty, tz) || 1;
				tx /= tl; ty /= tl; tz /= tl;
				if (!u) {
					const ref = Math.abs(ty) < 0.9 ? [0, 1, 0] : [1, 0, 0];
					u = [ty * ref[2] - tz * ref[1], tz * ref[0] - tx * ref[2], tx * ref[1] - ty * ref[0]];
				}
				const dot = u[0] * tx + u[1] * ty + u[2] * tz;
				u = [u[0] - tx * dot, u[1] - ty * dot, u[2] - tz * dot];
				const ul = Math.hypot(...u) || 1;
				u = [u[0] / ul, u[1] / ul, u[2] / ul];
				const v = [ty * u[2] - tz * u[1], tz * u[0] - tx * u[2], tx * u[1] - ty * u[0]];
				const now = birth[i], before = birth[Math.max(0, i - 1)];
				const tone = toneOf(now, pts[i]);
				if (i > 0) {
					arc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
					if (link(pts[i - 1], pts[i], tone, 1.35, before * 2.4, now * 2.4, 0, before, now)) drawn++;
				}
				const radius = Math.max(cell, rad[i] * o.spread);
				for (let k = 0; k < o.strands; k++) {
					const angle = k / o.strands * 2 * Math.PI + arc * turns;
					const c = Math.cos(angle) * radius * 0.7, s2 = Math.sin(angle) * radius * 0.7;
					const q = [pts[i][0] + u[0] * c + v[0] * s2, pts[i][1] + u[1] * c + v[1] * s2, pts[i][2] + u[2] * c + v[2] * s2];
					if (previous[k]) link(previous[k], q, tone, 0.5, before * 2.4, now * 2.4, 0.07 * k, before, now);
					previous[k] = q;
				}
				if (o.ribs > 0.02 && arc >= nextRib) {
					nextRib = arc + ribGap;
					let last = null;
					for (let k = 0; k <= roundSteps; k++) {
						const angle = k / roundSteps * 2 * Math.PI;
						const q = [pts[i][0] + (u[0] * Math.cos(angle) + v[0] * Math.sin(angle)) * radius, pts[i][1] + (u[1] * Math.cos(angle) + v[1] * Math.sin(angle)) * radius, pts[i][2] + (u[2] * Math.cos(angle) + v[2] * Math.sin(angle)) * radius];
						if (last) link(last, q, tone, 0.5, now * 2.4, now * 2.4, 0.5, now, Math.min(1, now + 0.012));
						last = q;
					}
				}
			}
			glow(pts[pts.length - 1], toneOf(birth[birth.length - 1], pts[pts.length - 1]), 0.3 + o.tips, 0, birth[birth.length - 1]);
			glow(pts[0], toneOf(birth[0], pts[0]), 0.2 + o.tips * 0.8, 0, birth[0]);
		}
		return drawn > 0;
	};

	if (mode === 'network') return growNetwork();
	if (mode === 'skeleton' && growSkeleton()) return;
	growTree();
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
