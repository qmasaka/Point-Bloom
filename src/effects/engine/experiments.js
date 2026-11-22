import * as THREE from 'three';
import { clamp, screenRect } from '../../core/util.js';
import { ExperimentField } from './experiment-field.js';
import { packParallaxSlot, readParallaxPhoto } from './parallax-photos.js';

const FIELD_STEP = 1 / 24;
const SHAPE_WIDTH = 256;
const SHAPE_LIMIT = 65536;
const ANCHORS = 12;
const TAU = Math.PI * 2;

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

function shapeTexture(photos, attributes, count) {
	const rows = Math.ceil(count / SHAPE_WIDTH);
	const stride = rows * SHAPE_WIDTH * 4;
	const data = new Float32Array(stride * 3 + SHAPE_WIDTH * 4);
	let flags = 0;
	for (let slot = 0; slot < 3; slot++) {
		if (!photos[slot]) continue;
		packParallaxSlot(photos[slot], attributes.aTarget, count, slot, data, slot * stride);
		flags += 2 ** slot;
	}
	const pos = attributes.aTarget.array;
	copyAnchors(attributes).forEach((j, i) => {
		const at = stride * 3 + i * 4;
		data.set(pos.subarray(j * 3, j * 3 + 3), at);
		data[at + 3] = j;
	});
	const tex = new THREE.DataTexture(data, SHAPE_WIDTH, rows * 3 + 1, THREE.RGBAFormat, THREE.FloatType);
	tex.needsUpdate = true;
	return { tex, flags };
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

	async setParallaxPhoto(slot, file) {
		if (!Number.isInteger(slot) || slot < 0 || slot > 2) return;
		const requests = this._parallaxRequests ||= [];
		const request = {};
		requests[slot] = request;
		try {
			const photo = await readParallaxPhoto(file);
			if (requests[slot] !== request) return;
			(this._parallaxPhotos ||= [null, null, null])[slot] = photo;
			this._parallaxRevision = (this._parallaxRevision || 0) + 1;
			this.emit();
		} catch {
			if (requests[slot] === request) this.app.toast('Не удалось открыть фото для ракурса', 'error');
		}
	}

	clearParallaxPhotos() {
		if (this._parallaxRequests) this._parallaxRequests.length = 0;
		this._parallaxPhotos = null;
		this._parallaxRevision = (this._parallaxRevision || 0) + 1;
		this.emit();
	}

	parallaxPhotoNames() {
		return this._parallaxPhotos?.map((photo) => photo?.name || '') || ['', '', ''];
	}

	_experimentShapesTick(layers, geometry, key) {
		const u = this.shared;
		const photos = layers.impossible.on ? this._parallaxPhotos || [] : [];
		const alternate = photos.some(Boolean);
		const recursive = layers.recursiveAnatomy.on;
		if (!alternate && !recursive) {
			this._clearExperimentShapes();
			u.uExperimentShapeInfo.value.set(1, 1, 0, this.app.nav.distance);
			return;
		}
		const signature = JSON.stringify([key, alternate ? this._parallaxRevision : 0]);
		let shapes = this._experimentShapes;
		if (shapes?.geo !== geometry || shapes.signature !== signature) {
			this._clearExperimentShapes();
			const count = alternate ? Math.min(SHAPE_LIMIT, geometry.attributes.aTarget.count) : 1;
			shapes = this._experimentShapes = { geo: geometry, signature, count, ...shapeTexture(photos, geometry.attributes, count), anchorVersion: -1 };
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
		const { autophagy: auto, reactionSkin: skin, causalWounds: scar, impossible: sculpt, recursiveAnatomy: recursive, brush } = layers;
		const cam = this.app.viewport.camera;
		const motion = this._experimentMotion ||= { beat: this._tb };
		const beat = !!(this.soundActive && this._tb !== motion.beat);
		motion.beat = this._tb;
		const gain = (layer) => clamp(this._eff(layer), 0, 2);
		const gains = this._experimentGains ||= {};
		const scars = brush.on && brush.tool === 'scars';
		gains.autophagy = gain(auto);
		gains.reactionSkin = gain(skin);
		gains.causalWounds = scars ? gain(brush) : 0;
		if (sculpt.on || recursive.on || auto.on || scars || skin.on) this.points.updateMatrixWorld(true);
		let yaw = 0;
		if (sculpt.on) {
			const view = this.points.worldToLocal((this._experimentView ||= new THREE.Vector3()).copy(cam.position));
			yaw = Math.atan2(view.x, view.z);
		}
		const zoom = clamp((recursive.revealAt + 2.5 - this.app.nav.distance) / 5, 0, 1);
		const reveal = zoom * zoom * (3 - 2 * zoom);
		u.uExperimentView.value.set(yaw, 0, reveal, g.attributes.position.count);
		u.uImpossible.value.set(Math.min(1, gain(sculpt)), 0, sculpt.blend, sculpt.arc);
		u.uRecursion.value.set(gain(recursive), recursive.levels, recursive.scale, recursive.density);
		u.uRecursionStyle.value.set(recursive.copies, recursive.spread, recursive.rotation * TAU / 360, { surface: 0, ring: 1, spiral: 2 }[recursive.layout] ?? 0);
		u.uRecursionLook.value.set(recursive.detail, recursive.ink, 0, 0);
		const key = this.cloudKey;
		this._experimentShapesTick(layers, g, key);
		const enabled = scars || [auto, skin].some((l) => l.on && l.amount > 0);
		u.uExperimentSim.value.set(enabled ? 1 : 0, skin.ink, scar.ink, 0.30 * Math.min(1, gains.autophagy));
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
		const wounds = Object.assign(this._scarSettings ||= {}, scar, { on: scars, radius: brush.radius, depth: brush.scarDepth, memory: brush.scarMemory });
		field.step(auto, skin, wounds, this.morph, this.app.viewport, this.points, this._experimentPicks || {}, gains, field.beat);
		field.beat = false;
		this._experimentPicks = {};
	}
}
