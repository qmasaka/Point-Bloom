import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { HandTracker } from '../input/hand-tracker.js';
import { MotionCamTracker } from '../input/motion-cam-tracker.js';
import { FX_ACTIONS } from '../state/layers.js';
import { makeCamMovable } from '../ui/fx-cam-float.js';
export class TrackingPart {
async toggleMotionCam() {
if (this.camTracker && this.camTracker.running) {
this._stopCam();
this.app.toast('Камера выключена');
this.emit();
return;
}
this._camBusy = true;
this._mountCam(null, 'Включаю камеру…');
try {
let t = new HandTracker((f) => this._onCamFrame(f), (txt) => this._camStatus(txt));
this.camTracker = t;
t.fpsHint = () => this.app.viewport.fps || 60;
this.state.layers.camTrack.on = true;
this._mountCam(t);
try {
await t.start();
this.app.toast('Камера включена: покажите ладонь', 'ok');
} catch (err) {
if (!err.handsLoadFailed) throw err;
t.stop();
t = new MotionCamTracker((f) => this._onCamFrame(f));
this.camTracker = t;
this._mountCam(t);
await t.start();
this.app.toast('Не удалось загрузить распознавание рук. Работает по движению в кадре', 'warn');
}
this._camPos = null;
} catch (err) {
this._stopCam();
this.app.toast('Нет доступа к веб-камере: разрешите её в браузере', 'error');
}
this._camBusy = false;
this.emit();
}
_stopCam() {
if (this.camTracker) this.camTracker.stop();
this.state.layers.camTrack.on = false;
this.camBox?.remove();
this.camBox = null;
this._camActive = false;
this._handPtrs = [];
this._hands = [];
this._stretchTarget = 1;
this._stretchBase = null;
this._spin = null;
this._handGrav = null;
this._handDis = false;
for (const [id, was] of this._handFx || []) this.state.layers[id].on = was;
this._handFx = null;
if (this._handBreak) {
this._handBreak = false;
this.setCollapse(false);
}
if (this.points) this.points.scale.setScalar(1);
}
_camStatus(txt) {
if (this.camHint && txt) this.camHint.textContent = txt;
}
_mountCam(tracker, status) {
this.camBox?.remove();
this.camHint = document.createElement('div');
this.camHint.className = 'fx-cam-text';
this.camHint.textContent = status || 'Покажите ладонь перед камерой';
this.camBox = document.createElement('div');
this.camBox.className = 'fx-cam';
if (tracker) this.camBox.append(tracker.preview);
this.camBox.append(this.camHint);
this.camBox.hidden = this.state.layers.camTrack.preview !== 'on';
document.getElementById('viewport').append(this.camBox);
makeCamMovable(this.camBox, document.getElementById('app'), document.getElementById('viewport'));
}
_ndcToLocal(x, y, out, depth = 0) {
const vp = this.app.viewport;
this._ray.setFromCamera(new THREE.Vector2(x, y), vp.camera);
const toCam = vp.camera.getWorldDirection(new THREE.Vector3()).negate();
this._plane.setFromNormalAndCoplanarPoint(toCam, toCam.clone().multiplyScalar(depth));
const hit = new THREE.Vector3();
if (!this._ray.ray.intersectPlane(this._plane, hit)) return null;
return out.copy(this.points.worldToLocal(hit));
}
_onCamFrame(f) {
if (!this.active || !this.points) return;
const cfg = this.state.layers.camTrack;
const t = this.camTracker;
t.sens = cfg.sens;
t.smooth = cfg.smooth;
if (this.camBox) this.camBox.hidden = cfg.preview !== 'on';
if (f.kind === 'hands') return this._onHands(f, cfg);
const txt = f.active ? 'Движение найдено' : 'Помашите рукой перед камерой';
if (this.camHint && this.camHint.textContent !== txt) this.camHint.textContent = txt;
this._camActive = f.active;
if (!f.active) return;
const k = 1 - Math.min(0.92, cfg.smooth) * 0.9;
this._camPos = this._camPos ? { x: this._camPos.x + (f.x - this._camPos.x) * k, y: this._camPos.y + (f.y - this._camPos.y) * k } : { x: f.x, y: f.y };
const loc = this._ndcToLocal(this._camPos.x, this._camPos.y, new THREE.Vector3(), 0.85);
if (!loc) return;
this.mouse.copy(loc);
this.mouseOn = true;
this._camT = this._time;
this._handsT = this._time;
this._handPtrs = [{ local: loc.clone(), s: cfg.g_palm === 'pull' ? -1 : cfg.g_palm === 'swirl' ? 3 : 1, ndc: [this._camPos.x, this._camPos.y] }];
if (cfg.g_palm === 'brush' || this.state.layers.brush.on) this.addBrushHit(loc);
if (cfg.g_palm === 'wave' && f.energy > 0.16 && this._time - (this._camShockT || 0) > 0.8) {
this._camShockT = this._time;
this.addShock(loc);
this._waveT = this._time;
}
}
_onHands(f, cfg) {
const bx = (v) => clamp((v - 0.15) / 0.7, 0, 1);
const mapP = (p) => [bx(p[0]), bx(p[1])];
const hands = f.hands.map((h) => ({ ...h, pts: h.pts.map(mapP), tips: h.tips.map(mapP), palm: mapP(h.palm) }));
this._hands = hands;
this._camActive = hands.length > 0;
const actLabel = (a) => (FX_ACTIONS.find((x) => x[0] === a) || [0, ''])[1];
const t = this.camTracker;
t.hold = cfg.hold;
t.names = { palm: actLabel(cfg.g_palm), fist: actLabel(cfg.g_fist), pinch: actLabel(cfg.g_pinch), point: actLabel(cfg.g_point), peace: actLabel(cfg.g_peace), rock: actLabel(cfg.g_rock), thumb: actLabel(cfg.g_thumb) };
const txt = hands.length ? (hands.length > 1 ? 'Вижу две руки' : 'Вижу руку: покажите жест') : 'Покажите руку перед камерой';
if (this.camHint && this.camHint.textContent !== txt) this.camHint.textContent = txt;
const ptrs = [];
const aspect = f.aspect || 4 / 3;
const st = this._handState || (this._handState = new Map());
const grabs = this._grabs || (this._grabs = new Map());
const now = this._time;
const loc2 = (p) => this._ndcToLocal(p[0] * 2 - 1, -(p[1] * 2 - 1), new THREE.Vector3(), cfg.depth);
let wantBreak = false, wantDis = false, grav = null, brushNow = false, sliceHand = null;
const wantFx = new Set();
this.camTracker.setNumHands && this.camTracker.setNumHands(cfg.handsN === '1' ? 1 : 2);
for (const hd of hands) {
let g = hd.gesture;
if (hd.pinch) g = 'pinch';
else if (g === 'pinch') g = hd.rawGesture && hd.rawGesture !== 'pinch' ? hd.rawGesture : 'none';
const a = g === 'none' ? 'none' : cfg['g_' + g];
const prev = st.get(hd.id) || { palmX: hd.palm[0], palmY: hd.palm[1], a: 'none', g: 'none', t: now };
const dtH = Math.max(0.016, Math.min(0.2, now - prev.t));
const entered = prev.a !== a;
const mid = [(hd.tips[0][0] + hd.tips[1][0]) / 2, (hd.tips[0][1] + hd.tips[1][1]) / 2];
const focus = g === 'pinch' ? mid : g === 'point' ? hd.tips[1] : hd.palm;
const fl = loc2(focus);
if (hands[0] === hd && fl) {
this.mouse.copy(fl);
this.mouseOn = true;
this._camT = now;
}
if (a === 'push' || a === 'pull' || a === 'swirl') {
const sv = a === 'push' ? 1 : a === 'pull' ? -1 : 3;
const pts = g === 'palm' ? [...hd.tips, hd.palm] : [focus];
for (const p of pts) {
const l = loc2(p);
if (l) ptrs.push({ local: l, s: sv, ndc: [p[0] * 2 - 1, -(p[1] * 2 - 1)] });
}
} else if (a === 'rotate') {
if (!entered) {
const sp = this._spin || (this._spin = { x: 0, y: 0 });
sp.y += (((hd.palm[0] - prev.palmX) * cfg.spin) / dtH - sp.y) * 0.5;
if (cfg.axis === 'xy') sp.x += (((hd.palm[1] - prev.palmY) * cfg.spin) / dtH - sp.x) * 0.5;
this._grabbing = now;
}
} else if (a === 'sculpt' && this.geometry) {
const gr = grabs.get(hd.id);
if (fl) {
if (!gr || entered) grabs.set(hd.id, this._startGrab(fl, cfg.clay));
else this._sculptMove(gr, fl);
}
} else if (a === 'wave') {
if (entered && fl && now - (this._camShockT || 0) > 0.5) {
this._camShockT = now;
this.addShock(fl);
this._waveT = now;
}
} else if (a === 'slicecut') {
sliceHand = this._ndcToLocal(focus[0] * 2 - 1, -(focus[1] * 2 - 1), new THREE.Vector3(), 0);
} else if (a === 'gravity') {
if (fl) grav = fl;
} else if (a.startsWith('fx:')) wantFx.add(a.slice(3));
else if (a === 'break') wantBreak = true;
else if (a === 'dissolve') wantDis = true;
else if (a === 'brush') {
brushNow = true;
const pts = g === 'palm' ? hd.tips : [focus];
for (const p of pts) {
const q = loc2(p);
if (q) this.addBrushHit(q);
}
}
if (a !== 'sculpt') grabs.delete(hd.id);
st.set(hd.id, { palmX: hd.palm[0], palmY: hd.palm[1], a, g, t: now });
}
for (const key of [...st.keys()]) if (!hands.some((h) => h.id === key)) {
st.delete(key);
grabs.delete(key);
}
if (brushNow) this._brushHand = now;
this._handGrav = grav;
this._handSlice = sliceHand;
this._handDis = wantDis;
const hf = this._handFx || (this._handFx = new Map());
for (const id of wantFx) {
if (!hf.has(id) && this.state.layers[id]) {
hf.set(id, this.state.layers[id].on);
this.state.layers[id].on = true;
this.emit();
}
}
for (const [id, was] of [...hf]) {
if (!wantFx.has(id)) {
this.state.layers[id].on = was;
hf.delete(id);
this.emit();
}
}
if (wantBreak !== !!this._handBreak) {
this._handBreak = wantBreak;
this.setCollapse(wantBreak);
}
if (cfg.stretch === 'on' && hands.length === 2) {
const d = Math.hypot((hands[0].palm[0] - hands[1].palm[0]) * aspect, hands[0].palm[1] - hands[1].palm[1]);
if (!this._stretchBase) this._stretchBase = { d, s: this._stretchTarget || 1 };
this._stretchTarget = clamp(this._stretchBase.s * (d / Math.max(0.05, this._stretchBase.d)), 0.4, 3);
} else {
this._stretchBase = null;
if (cfg.keep === 'off' || cfg.stretch !== 'on') this._stretchTarget = 1;
}
this._handPtrs = ptrs;
if (hands.length) this._handsT = now;
}
}
