import * as THREE from 'three';
import { clamp, screenRect } from '../../core/util.js';
import { ExperimentField } from './experiment-field.js';

const FIELD_STEP = 1 / 24;
const SHAPE_WIDTH = 256;
const SHAPE_LIMIT = 65536;
const ANCHORS = 12;
const TAU = Math.PI * 2;

function visibleIndices(cloud) {
	if (!cloud?.hide) return null;
	const indices = [];
	for (let i = 0; i < cloud.count; i++) if (cloud.hide[i] < 0.5) indices.push(i);
	return indices;
}

function copyAnchors({ aTarget, aVis, aHide }) {
	const candidates = [];
	const count = Math.min(192, aTarget.count);
	const stride = aTarget.count / Math.max(1, count);
	for (let i = 0; i < count; i++) {
		const start = Math.floor((i + 0.5) * stride);
		let point = start;
		for (let j = 0; j < 48 && (aVis.getY(point) < 0.01 || aHide.getX(point) > 0.5); j++) point = (point + 1) % aTarget.count;
		if (aVis.getY(point) >= 0.01 && aHide.getX(point) <= 0.5) candidates.push({ point, distance: Infinity });
	}
	const pos = aTarget.array;
	const result = [];
	let next = candidates[0];
	for (let i = 0; i < ANCHORS; i++) {
		const point = next?.point ?? result[0] ?? 0;
		result.push(point);
		const p = point * 3;
		next = null;
		for (const candidate of candidates) {
			const q = candidate.point * 3;
			const dx = pos[p] - pos[q], dy = pos[p + 1] - pos[q + 1], dz = pos[p + 2] - pos[q + 2];
			candidate.distance = Math.min(candidate.distance, dx * dx + dy * dy + dz * dz);
			if (!next || candidate.distance > next.distance) next = candidate;
		}
	}
	return result;
}

function shapeTexture(clouds, attributes, count) {
	const rows = Math.ceil(count / SHAPE_WIDTH);
	const data = new Float32Array(SHAPE_WIDTH * (rows * 2 + 1) * 4);
	for (let slot = 0; slot < 2; slot++) {
		const cloud = clouds[slot];
		if (!cloud?.count) continue;
		const visible = visibleIndices(cloud);
		const available = visible?.length ?? cloud.count;
		if (!available) continue;
		for (let i = 0; i < count; i++) {
			const index = Math.floor(i * available / count);
			const from = (visible ? visible[index] : index) * 3;
			const to = (slot * rows * SHAPE_WIDTH + i) * 4;
			data.set(cloud.positions.subarray(from, from + 3), to);
			const rgb = cloud.colors;
			const c = (k) => Math.round(Math.max(0, Math.min(1, rgb?.[from + k] ?? 0.6)) * 255);
			data[to + 3] = c(0) + 256 * c(1) + 65536 * c(2);
		}
	}
	const pos = attributes.aTarget.array;
	copyAnchors(attributes).forEach((j, i) => {
		const to = (rows * 2 * SHAPE_WIDTH + i) * 4;
		data.set(pos.subarray(j * 3, j * 3 + 3), to);
		data[to + 3] = j;
	});
	const tex = new THREE.DataTexture(data, SHAPE_WIDTH, rows * 2 + 1, THREE.RGBAFormat, THREE.FloatType);
	tex.needsUpdate = true;
	return tex;
}

export class ExperimentsPart {
	resetAutophagy() { this._experimentField?.resetFeedback(); }
	resetReactionSkin() { this._experimentField?.resetReaction(); }
	resetCausalWounds() { this._experimentField?.resetWounds(); }

	_experimentPointer(event, type) {
		const rect = screenRect(this.app.viewport.canvas);
		if (rect.width <= 0 || rect.height <= 0) return;
		this._experimentPicks ||= {};
		this._experimentPicks[type] = new THREE.Vector2((event.clientX - rect.left) * 2 / rect.width - 1, 1 - (event.clientY - rect.top) * 2 / rect.height);
	}

	_experimentRendered() {
		const cfg = this.state.layers.autophagy;
		if (this.frozen || !this.active || !cfg.on || cfg.amount <= 0 || !this._experimentField || !this.points) return;
		if (!(this._experimentGains?.autophagy > 0.001)) return;
		this._experimentField.capture(this.app.viewport, this.points, this.backend?.kind === 'webgpu' ? this.backend.canvas : null);
	}

	_experimentShapesTick(layers, geometry, key) {
		const u = this.shared;
		const alternate = (layers.impossible.on && layers.impossible.source === 'playlist') || (layers.phaseInterference.on && layers.phaseInterference.source === 'playlist');
		const recursive = layers.recursiveAnatomy.on;
		if (!alternate && !recursive) {
			this._clearExperimentShapes();
			u.uExperimentShapeInfo.value.set(1, 1, 0, this.app.nav.distance);
			return;
		}
		const activeKey = this.curKey || this.state.source;
		const ignored = new Set([activeKey, key, this.state.source, 'frames']);
		const keys = alternate ? [...new Set(this.playlist || [])].filter((id) => !ignored.has(id)).slice(0, 2) : [];
		const signature = JSON.stringify([key, activeKey, keys]);
		let shapes = this._experimentShapes;
		if (shapes?.geo !== geometry || shapes.signature !== signature) {
			this._clearExperimentShapes();
			shapes = this._experimentShapes = { geo: geometry, signature, flags: 0, count: 1, tex: shapeTexture([], geometry.attributes, 1), anchorVersion: -1 };
			if (keys.length) {
				Promise.all(keys.map((k) => this._cloudFor(k).catch(() => null))).then((clouds) => {
					if (this._experimentShapes !== shapes) return;
					clouds = clouds.map((c) => c?.hide?.every((v) => v > 0.5) ? null : c);
					const count = Math.min(SHAPE_LIMIT, geometry.attributes.aTarget.count, ...clouds.filter((c) => c?.count).map((c) => c.count));
					const tex = shapeTexture(clouds, geometry.attributes, count);
					shapes.tex.dispose();
					shapes.tex = tex;
					shapes.count = count;
					shapes.flags = (clouds[0]?.count ? 1 : 0) + (clouds[1]?.count ? 2 : 0);
					shapes.anchorVersion = -1;
					this.app.viewport.invalidate();
				});
			}
		}
		const attr = geometry.attributes.aTarget;
		if (recursive && shapes.anchorVersion !== attr.version) {
			shapes.anchorVersion = attr.version;
			const im = shapes.tex.image;
			const row = (im.height - 1) * SHAPE_WIDTH * 4;
			for (let i = 0; i < ANCHORS; i++) {
				const j = Math.round(im.data[row + i * 4 + 3]) * 3;
				im.data.set(attr.array.subarray(j, j + 3), row + i * 4);
			}
			shapes.tex.needsUpdate = true;
			shapes.dirtyRow = row / (SHAPE_WIDTH * 4);
		}
		u.uExperimentShapes.value = shapes.tex;
		u.uExperimentShapeInfo.value.set(shapes.count, Math.ceil(shapes.count / SHAPE_WIDTH), shapes.flags, this.app.nav.distance);
	}

	_clearExperimentShapes() {
		if (!this._experimentShapes) return;
		this._experimentShapes.tex.dispose();
		this._experimentShapes = null;
		if (this.shared) this.shared.uExperimentShapes.value = null;
	}

	_disposeExperiments() {
		this._experimentField?.dispose();
		this._experimentField = null;
		this._experimentPicks = {};
		if (this.shared) this.shared.uExperimentField.value = null;
		this._clearExperimentShapes();
	}

	_experimentTick(dt, layers) {
		const g = this.geometry, u = this.shared;
		const { autophagy: auto, reactionSkin: skin, causalWounds: scar, phaseInterference: phase, impossible: sculpt, recursiveAnatomy: recursive } = layers;
		const cam = this.app.viewport.camera;
		const motion = this._experimentMotion ||= { sculpt: 0, phase: 0, copies: 0, beat: this._tb };
		const beat = !!(this.soundActive && this._tb !== motion.beat);
		motion.beat = this._tb;
		const gain = (layer) => clamp(this._eff(layer), 0, 2);
		const gains = this._experimentGains ||= {};
		gains.autophagy = gain(auto);
		gains.reactionSkin = gain(skin);
		gains.causalWounds = gain(scar);
		if (sculpt.on || phase.on || recursive.on || auto.on || scar.on || skin.on) this.points.updateMatrixWorld(true);
		let yaw = 0, pitch = 0;
		if (sculpt.on || phase.on) {
			const view = this.points.worldToLocal((this._experimentView ||= new THREE.Vector3()).copy(cam.position));
			yaw = Math.atan2(view.x, view.z);
			pitch = Math.atan2(view.y, view.z);
		}
		let sculptAngle = sculpt.axis === 'pitch' ? pitch : yaw;
		if (!sculpt.on || sculpt.motion === 'camera') motion.sculpt = 0;
		else {
			motion.sculpt = (motion.sculpt + dt * sculpt.speed * TAU) % TAU;
			sculptAngle = sculpt.angle * TAU / 360 + (sculpt.motion === 'swing' ? Math.sin(motion.sculpt) * TAU / 3 : motion.sculpt);
		}
		if (!phase.on) motion.phase = 0;
		else {
			const move = phase.motion === 'beat' ? (beat ? phase.jump * TAU / 360 : 0) : dt * phase.speed;
			motion.phase = (motion.phase + move) % (TAU * 100);
		}
		const phaseAngle = phase.angle * TAU / 360 + yaw * phase.camera;
		const phaseTime = phase.motion === 'swing' ? Math.sin(motion.phase) * Math.PI : motion.phase;
		if (!recursive.on || recursive.motion !== 'breathe') motion.copies = 0;
		else motion.copies = (motion.copies + dt * recursive.speed * TAU) % TAU;
		const zoom = clamp((recursive.revealAt + 2.5 - this.app.nav.distance) / 5, 0, 1);
		const reveal = recursive.motion === 'breathe' ? 0.5 - Math.cos(motion.copies) * 0.5 : recursive.motion === 'fixed' ? 1 : zoom * zoom * (3 - 2 * zoom);
		u.uExperimentView.value.set(sculptAngle, phaseTime, reveal, g.attributes.position.count);
		u.uImpossible.value.set(Math.min(1, gain(sculpt)), sculpt.angle * TAU / 360, sculpt.blend, sculpt.source === 'playlist' ? sculpt.tint : -1);
		u.uImpossibleStyle.value.set(sculpt.views, { twist: 0, pleats: 1, prism: 2 }[sculpt.style] ?? 0, sculpt.arc, sculpt.separation);
		u.uInterference.value.set(gain(phase), phase.freq, phaseAngle, phase.bias);
		u.uPhaseStyle.value.set({ bands: 0, rings: 1, spots: 2 }[phase.style] ?? 0, phase.spacing, phase.rim, phase.width);
		u.uPhaseLook.value.set(phase.tint, phase.source === 'playlist' ? 1 : 0, 0, 0);
		u.uRecursion.value.set(gain(recursive), recursive.levels, recursive.scale, recursive.density);
		u.uRecursionStyle.value.set(recursive.copies, recursive.spread, recursive.rotation * TAU / 360, { surface: 0, ring: 1, spiral: 2 }[recursive.layout] ?? 0);
		u.uRecursionLook.value.set(recursive.detail, recursive.ink, 0, 0);
		const key = this.cloudKey;
		this._experimentShapesTick(layers, g, key);
		const enabled = [auto, skin, scar].some((l) => l.on && l.amount > 0);
		u.uExperimentSim.value.set(enabled ? 1 : 0, skin.ink, scar.ink, auto.ink * Math.min(1, gains.autophagy));
		if (!enabled) {
			if (this._experimentField) {
				this._experimentField.dispose();
				this._experimentField = null;
				u.uExperimentField.value = null;
			}
			this._experimentPicks = {};
			return;
		}
		let field = this._experimentField;
		if (field?.geometry !== g) {
			field?.dispose();
			this._experimentField = field = new ExperimentField(g, this.state.source === 'media' && !this.morphing);
			u.uExperimentField.value = field.texture;
		}
		field.next += dt;
		field.beat ||= beat;
		if (field.next < FIELD_STEP) return;
		field.next %= FIELD_STEP;
		field.time += FIELD_STEP;
		field.step(layers, this.morph, this.app.viewport, this.points, this._experimentPicks || {}, gains, field.beat);
		field.beat = false;
		this._experimentPicks = {};
	}
}
