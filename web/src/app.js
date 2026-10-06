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
tc.addEventListener('dragging-changed', (e) => {
this.nav.enabled = !e.value;
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
this.viewport.updateSelectionBox();
this.bus.emit('transform');
});
});
}
wirePointer() {
this.bus.on('click', (e) => {
const hit = this.viewport.pick(e.clientX, e.clientY);
this.model.select(hit ? hit.object : null);
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
