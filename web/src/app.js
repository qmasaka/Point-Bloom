import { $, createEmitter } from './util.js';
import { loadSettings, saveSettings } from './settings.js';
import { Viewport } from './viewport.js';
import { Model } from './model.js';
import { Display } from './display.js';
import { History } from './history.js';
import { Nav } from './nav.js';
import { Ops, snapOf } from './ops.js';
import { UI } from './ui.js';
import { MediaController } from './media-controller.js';
import { setTextureLimits } from './materials.js';
import { makeDemoFiles } from './demo.js';
import * as THREE from 'three';
export class App {
constructor() {
this.settings = loadSettings();
this.bus = createEmitter();
const el = $('#viewport');
this.viewport = new Viewport(this, el, $('.stage', el));
setTextureLimits(this.viewport.maxAnisotropy, this.viewport.maxTextureSize);
this.model = new Model(this);
this.display = new Display(this);
this.history = new History(this);
this.nav = new Nav(this);
this.ops = new Ops(this);
this.media = new MediaController(this);
this.ui = new UI(this);
}
start() {
this.ui.init();
this.wireGizmo();
this.wirePointer();
this.viewport.setActiveCamera(this.nav.camera);
this.display.apply();
this.viewport.updateSceneBounds();
this.nav.frameAll(false);
this.nav.applyCamera();
this.model.applySnap();
this.viewport.start();
const q = new URLSearchParams(location.search);
const model = q.get('model');
if (model) this.ui.loadFromUrl(model, { textures: q.getAll('texture') });
}
wireGizmo() {
const tc = this.viewport.tc;
let before = null;
let multi = null;
tc.addEventListener('dragging-changed', (e) => {
this.nav.enabled = !e.value;
const pivot = this.model.pivot;
if (pivot && tc.object === pivot) {
if (e.value) {
pivot.updateMatrixWorld(true);
const inv = pivot.matrixWorld.clone().invert();
multi = this.model.selection.map((o) => ({ obj: o, rel: inv.clone().multiply(o.matrixWorld), before: snapOf(o) }));
} else if (multi) {
this.ops.commitMulti(multi.map((m) => ({ obj: m.obj, before: m.before, after: snapOf(m.obj) })), 'Трансформация группы');
multi = null;
this.model.attachGizmo();
}
return;
}
if (e.value && tc.object) before = snapOf(tc.object);
else if (!e.value && before && tc.object) {
const names = { translate: 'Перемещение', rotate: 'Вращение', scale: 'Масштаб' };
this.ops.commitTransform(tc.object, before, snapOf(tc.object), names[tc.mode] || 'Трансформация');
before = null;
}
});
let pending = false;
tc.addEventListener('objectChange', () => {
if (pending) return;
pending = true;
requestAnimationFrame(() => {
pending = false;
if (multi && this.model.pivot) {
const pv = this.model.pivot;
pv.updateMatrixWorld(true);
const m4 = new THREE.Matrix4();
const par = new THREE.Matrix4();
for (const it of multi) {
m4.copy(pv.matrixWorld).multiply(it.rel);
it.obj.parent.updateWorldMatrix(true, false);
par.copy(it.obj.parent.matrixWorld).invert();
m4.premultiply(par).decompose(it.obj.position, it.obj.quaternion, it.obj.scale);
it.obj.updateMatrix();
it.obj.updateMatrixWorld(true);
}
}
this.viewport.updateSelectionBox();
this.bus.emit('transform');
});
});
}
wirePointer() {
this.bus.on('click', (e) => {
const hit = this.viewport.pick(e.clientX, e.clientY);
let obj = hit ? hit.object : null;
if (obj && !e.altKey) while (obj.parent && obj.parent !== this.viewport.root) obj = obj.parent;
this.model.select(obj, { add: e.shiftKey });
});
this.bus.on('dblclick', (e) => {
const hit = this.viewport.pick(e.clientX, e.clientY);
if (hit) this.nav.focusPoint(hit.point);
});
}
setDisplay(mode) {
this.settings.display = mode;
this.display.apply();
this.saveSettings();
this.bus.emit('view');
}
toast(msg, type, ms) {
this.ui.toast(msg, type, ms);
}
saveSettings() {
saveSettings(this.settings);
this.bus.emit('settings');
}
afterMaterialChange() {
const mode = this.settings.display;
if (mode !== 'material' && mode !== 'points') this.setDisplay('material');
else this.display.apply();
this.bus.emit('material');
this.bus.emit('geometry');
this.viewport.invalidate();
}
async loadDemo() {
const files = await makeDemoFiles();
await this.ui.handleFiles(files, { mode: 'replace' });
}
}
