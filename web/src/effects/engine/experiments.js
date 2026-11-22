import * as THREE from 'three';
import { screenRect } from '../../core/util.js';
import { ExperimentField } from './experiment-field.js';
const FIELD_STEP = 1 / 24;
const SHAPE_WIDTH = 256;
const SHAPE_LIMIT = 65536;
const ANCHORS = 12;
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
this._experimentField.capture(this.app.viewport, this.points, this.backend?.kind === 'webgpu' ? this.backend.canvas : null);
}
_experimentShapesTick(layers, geometry, key) {
const u = this.shared;
const alternate = layers.impossible.on || layers.phaseInterference.on;
const recursive = layers.recursiveAnatomy.on;
if (!alternate && !recursive) {
this._clearExperimentShapes();
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
const phase = layers.phaseInterference, sculpt = layers.impossible, recursive = layers.recursiveAnatomy;
const cam = this.app.viewport.camera;
if (sculpt.on || phase.on || recursive.on || layers.autophagy.on || layers.causalWounds.on || layers.reactionSkin.on) this.points.updateMatrixWorld(true);
if (sculpt.on || phase.on) {
const view = this.points.worldToLocal((this._experimentView ||= new THREE.Vector3()).copy(cam.position));
const angle = Math.atan2(view.x, view.z);
u.uExperimentView.value.set(angle, this.levels.bass * 0.55 + this.levels.mid * 0.17 + this.levels.beat * 0.28, 0, 0);
}
u.uImpossible.value.set(sculpt.on ? sculpt.amount : 0, sculpt.angle * Math.PI / 180, sculpt.blend, 0);
u.uInterference.value.set(phase.on ? phase.amount : 0, phase.freq, phase.speed, phase.bias);
u.uRecursion.value.set(recursive.on ? recursive.amount : 0, recursive.levels, recursive.scale, recursive.density);
u.uExperimentView.value.z = phase.audio;
u.uExperimentView.value.w = g.attributes.position.count;
const key = this.cloudKey;
this._experimentShapesTick(layers, g, key);
const enabled = [layers.autophagy, layers.reactionSkin, layers.causalWounds].some((l) => l.on && l.amount > 0);
u.uExperimentSim.value.x = enabled ? 1 : 0;
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
if (field.next < FIELD_STEP) return;
field.next %= FIELD_STEP;
field.time += FIELD_STEP;
field.step(layers, this.morph, this.app.viewport, this.points, this._experimentPicks || {});
this._experimentPicks = {};
}
}
