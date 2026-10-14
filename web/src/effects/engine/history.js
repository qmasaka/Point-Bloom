import { FX_LAYERS } from '../state/layers.js';
export class HistoryPart {
_snap() {
const st = this.state;
const layers = {};
for (const id of Object.keys(st.layers)) {
const l = { ...st.layers[id] };
if (this._handFx?.has(id)) l.on = this._handFx.get(id);
layers[id] = l;
}
const p = this.app.settings.point;
return JSON.stringify({ anim: st.anim, source: st.source, count: st.count, layers, look: st.look, mask: st.mask, morphCfg: st.morphCfg, pt: { shape: p.shape, size: p.size, color: p.color, solidColor: p.solidColor, attenuate: p.attenuate } });
}
_histFlush() {
if (!this.active || this._histBusy) return;
clearTimeout(this._histT);
this._histCommit();
}
_histSoon() {
if (!this.active || this._histBusy) return;
clearTimeout(this._histT);
this._histT = setTimeout(() => this._histCommit(), 350);
}
_histCommit() {
const h = this._hist || (this._hist = { undo: [], redo: [], last: null });
const snap = this._snap();
if (h.last === null) h.last = snap;
else if (snap !== h.last) {
h.undo.push({ snap: h.last, label: this._diffLabel(h.last, snap) });
if (h.undo.length > 100) h.undo.shift();
h.redo.length = 0;
h.last = snap;
}
this.emit();
}
_diffLabel(a, b) {
try {
const A = JSON.parse(a), B = JSON.parse(b);
if (JSON.stringify(A.anim) !== JSON.stringify(B.anim)) return 'таймлайн';
for (const id of Object.keys(B.layers)) {
if (JSON.stringify(A.layers[id]) !== JSON.stringify(B.layers[id])) return 'эффект «' + (FX_LAYERS.find((l) => l.id === id)?.name || id) + '»';
}
if (A.source !== B.source) return 'форма';
if (A.count !== B.count) return 'число частиц';
if (JSON.stringify(A.mask) !== JSON.stringify(B.mask)) return 'зона действия';
if (JSON.stringify(A.morphCfg) !== JSON.stringify(B.morphCfg)) return 'морфинг';
if (JSON.stringify(A.look) !== JSON.stringify(B.look) || JSON.stringify(A.pt) !== JSON.stringify(B.pt)) return 'вид';
} catch (e) {
}
return 'настройки';
}
get canUndo() {
return !!this._hist?.undo.length;
}
get canRedo() {
return !!this._hist?.redo.length;
}
get undoLabel() {
return this._hist?.undo.at(-1)?.label || '';
}
get redoLabel() {
return this._hist?.redo.at(-1)?.label || '';
}
async _histApply(snap) {
const d = JSON.parse(snap);
const st = this.state;
this._histBusy = true;
try {
if (d.anim) {
for (const k of Object.keys(st.anim)) delete st.anim[k];
Object.assign(st.anim, d.anim);
this._animVer = (this._animVer || 0) + 1;
this.app.bus.emit('fxanim');
}
for (const id of Object.keys(d.layers)) if (st.layers[id]) Object.assign(st.layers[id], d.layers[id]);
Object.assign(st.look, d.look);
Object.assign(st.mask, d.mask);
Object.assign(st.morphCfg, d.morphCfg);
Object.assign(this.app.settings.point, d.pt);
this.app.saveSettings();
this.touch();
if (d.count !== st.count) await this.setCount(d.count);
if (d.source !== st.source) await this.setSource(d.source);
} finally {
this._hist.last = snap;
this._histBusy = false;
}
this.emit();
}
async undo() {
const h = this._hist;
if (!h || !h.undo.length) return null;
const e = h.undo.pop();
h.redo.push({ snap: h.last, label: e.label });
await this._histApply(e.snap);
return e.label;
}
async redo() {
const h = this._hist;
if (!h || !h.redo.length) return null;
const e = h.redo.pop();
h.undo.push({ snap: h.last, label: e.label });
await this._histApply(e.snap);
return e.label;
}
}
