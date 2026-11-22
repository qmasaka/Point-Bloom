import * as THREE from 'three';
import { clamp } from '../../core/util.js';

const SIDE = 32;
const WIDTH = 256;
const CELLS = SIDE ** 3;
const STEP = 1 / 24;
const HISTORY = 18;

function cellOf(x, y, z) {
	const axis = (v) => clamp(Math.floor(v * 8 + 16), 0, 31);
	return axis(x) + SIDE * (axis(y) + SIDE * axis(z));
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
		this.output = new Float32Array(CELLS * 4);
		this.texture = new THREE.DataTexture(this.output, WIDTH, CELLS / WIDTH, THREE.RGBAFormat, THREE.FloatType);
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
			vis.array[i + 2] = cell;
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
		this.luma = null;
		this.captured = null;
	}

	resetReaction() {
		this.chem = null;
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

	_updateFeedback(settings) {
		const img = this.luma;
		if (!img) return;
		const { width, height } = this.surface;
		const retain = Math.exp(-STEP / settings.memory);
		const p = this.point;
		for (const id of this.cells) {
			const j = id * 3;
			const d = this.feedback;
			p.fromArray(this.current, j).add(this._offset.fromArray(d, j)).applyMatrix4(this.projection);
			const x = Math.floor((p.x * 0.5 + 0.5) * width), y = Math.floor((0.5 - p.y * 0.5) * height);
			let sx = 0, sy = 0, sz = 0;
			if (p.z >= -1 && p.z <= 1 && x >= 2 && y >= 2 && x < width - 2 && y < height - 2) {
				const i = x + y * width;
				const gx = img[i + 2] - img[i - 2], gy = img[i - 2 * width] - img[i + 2 * width];
				const edge = Math.min(1, Math.hypot(gx, gy) * 3);
				const eddy = settings.chaos * (0.3 + edge) * Math.sin(this.current[j] * 18 + this.current[j + 1] * 24 + this.time * 1.6);
				sx = settings.pull * gx - gy * eddy;
				sy = settings.pull * gy + gx * eddy;
				sz = settings.edge * (edge * 0.7 - img[i] * 0.3) + eddy * img[i] * 0.3;
			}
			const gain = STEP * settings.feedback * 2.8;
			d[j] = clamp(d[j] * retain + gain * (sx * this.right.x + sy * this.up.x + sz * this.forward.x), -0.8, 0.8);
			d[j + 1] = clamp(d[j + 1] * retain + gain * (sx * this.right.y + sy * this.up.y + sz * this.forward.y), -0.8, 0.8);
			d[j + 2] = clamp(d[j + 2] * retain + gain * (sx * this.right.z + sy * this.up.z + sz * this.forward.z), -0.8, 0.8);
		}
	}

	_seed(center, radius) {
		const cs = this.centers;
		const { a, b } = this.chem;
		for (const id of this.cells) {
			const j = id * 3;
			const d = Math.hypot(cs[j] - center[0], cs[j + 1] - center[1], cs[j + 2] - center[2]);
			if (d >= radius) continue;
			const weight = 1 - d / radius;
			a[id] = Math.min(a[id], 0.28 + 0.35 * (1 - weight));
			b[id] = Math.max(b[id], 0.34 + 0.3 * weight);
		}
	}

	_react(settings, hit) {
		if (!this.chem) {
			this.chem = { a: new Float32Array(CELLS).fill(1), b: new Float32Array(CELLS), nextA: new Float32Array(CELLS), nextB: new Float32Array(CELLS), warm: 20 };
			for (let i = 0; i < Math.min(12, this.cells.length); i++) {
				const index = Math.floor((0.23 + i * 0.61803399) % 1 * this.cells.length);
				const j = this.cells[index] * 3;
				this._seed(this.centers.subarray(j, j + 3), 0.23);
			}
		}
		if (hit >= 0) this._seed(this.centers.subarray(hit * 3, hit * 3 + 3), settings.radius);
		const c = this.chem;
		const feed = settings.feed / 1000, kill = settings.kill / 1000;
		const steps = c.warm-- > 0 ? 12 : 5;
		for (let step = 0; step < steps; step++) {
			const { a, b, nextA, nextB } = c;
			for (let i = 0; i < this.cells.length; i++) {
				const id = this.cells[i], neighbours = this.neighbours[i];
				const av = a[id], bv = b[id];
				let sumA = 0, sumB = 0;
				for (const n of neighbours) {
					sumA += a[n] - av;
					sumB += b[n] - bv;
				}
				const diffusion = settings.diffusion / Math.max(1, neighbours.length);
				const reaction = av * bv * bv;
				nextA[id] = clamp(av + 0.8 * (diffusion * 0.95 * sumA - reaction + feed * (1 - av)), 0, 1);
				nextB[id] = clamp(bv + 0.8 * (diffusion * 0.46 * sumB + reaction - (kill + feed) * bv), 0, 1);
			}
			[c.a, c.nextA] = [nextA, a];
			[c.b, c.nextB] = [nextB, b];
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
			const jagged = 0.7 + 0.3 * Math.sin(id * 0.017 + c[j + 1] * 37);
			const d = Math.hypot(dx * 0.75, dy, dz * 1.15) / (settings.radius * jagged);
			this.wounds[id] = Math.max(this.wounds[id], clamp(1 - d, 0, 1) ** 0.45);
		}
	}

	step(layers, mix, viewport, object, picks) {
		const a = this.geometry.attributes;
		const origin = a.aOrigin.array, target = a.aTarget.array, sculpt = a.aSculpt.array, normals = a.aNormalB.array;
		for (const id of this.cells) {
			const j = id * 3, i = this.indices[id];
			for (let k = 0; k < 3; k++) this.current[j + k] = origin[i + k] + (target[i + k] - origin[i + k]) * mix + sculpt[i + k];
		}
		const auto = layers.autophagy, reaction = layers.reactionSkin, wounds = layers.causalWounds;
		this._offset ||= new THREE.Vector3();
		if (auto.on && auto.amount > 0) this._updateFeedback(auto);
		else if (this.autoOn) this.resetFeedback();
		this.autoOn = auto.on && auto.amount > 0;
		if (reaction.on) this._react(reaction, picks.seed ? this.pick(picks.seed, viewport, object) : -1);
		else if (this.chem) this.resetReaction();
		if (wounds.on && picks.wound) this._wound(wounds, this.pick(picks.wound, viewport, object));
		if (!wounds.on && this.woundOn) this.resetWounds();
		this.woundOn = wounds.on;
		const decay = Math.exp(-3 * STEP / wounds.healing);
		const b = this.chem?.b;
		const captureHistory = wounds.on && this.time - (this.historyTime ?? -Infinity) >= 0.10;
		let snapshot;
		if (captureHistory) {
			this.historyTime = this.time;
			this.historyHead = ((this.historyHead ?? -1) + 1) % HISTORY;
			snapshot = this.history[this.historyHead] ||= new Float32Array(CELLS * 3);
		}
		for (let index = 0; index < this.cells.length; index++) {
			const id = this.cells[index], j = id * 3, p = id * 4, i = this.indices[id];
			const chem = reaction.on && b ? clamp((b[id] - 0.08) * 3.4, 0, 1) * reaction.amount : 0;
			const mutation = chem * chem * reaction.mutation;
			const ridge = chem * reaction.growth * (0.16 + mutation * 0.6);
			let w = this.wounds[id];
			if (wounds.on) {
				let nearby = 0;
				for (const n of this.neighbours[index]) nearby = Math.max(nearby, this.wounds[n] - w);
				const grain = (Math.sin(id * 1.618) * 0.5 + 0.5) ** 3;
				this.cracks[id] = Math.max(w * decay, 0) + nearby * grain * wounds.spread * 0.17;
			}
			w = wounds.on ? w * wounds.amount : 0;
			const layer = id % 4;
			const back = Math.min(this.history.length - 1, 2 + layer * 4);
			const past = back >= 0 ? this.history[(this.historyHead - back + HISTORY) % HISTORY] : null;
			for (let k = 0; k < 3; k++) {
				const noise = Math.sin(this.centers[j + (k + 1) % 3] * 19 + k * 2 + this.time * 0.7);
				const local = this.autoOn ? this.feedback[j + k] * auto.amount : 0;
				const offset = local + ridge * normals[i + k] + noise * mutation * 0.14;
				const live = this.current[j + k] + offset;
				const cut = (layer + 1) * 0.12 * normals[i + k] + noise * 0.12;
				this.output[p + k] = offset + w * wounds.depth * ((past ? past[j + k] - live : 0) + cut);
				if (snapshot) snapshot[j + k] = live;
			}
			this.output[p + 3] = Math.min(1, chem * 0.9 + w * 0.75);
		}
		if (wounds.on) [this.wounds, this.cracks] = [this.cracks, this.wounds];
		this.texture.needsUpdate = true;
	}

	dispose() {
		this.texture.dispose();
	}
}
