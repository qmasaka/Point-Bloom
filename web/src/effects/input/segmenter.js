const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite';
const LOCAL = new URL('vendor/mediapipe/', document.baseURI).href;
const SOURCES = [
{ name: 'local', lib: LOCAL + 'vision_bundle.mjs', wasm: LOCAL + 'wasm' },
{ name: 'cdn', lib: VISION + '/vision_bundle.mjs', wasm: VISION + '/wasm' },
];
export const SEG_CLASSES = {
person: new Set([15]),
any: new Set([15, 3, 8, 10, 12, 13, 17, 1, 2, 4, 6, 7, 14, 19]),
};
export class SubjectSegmenter {
constructor() {
this.phase = 'idle';
this.error = '';
this.onChange = null;
this._seg = null;
this._ready = null;
this._cv = null;
}
get ready() {
return this.phase === 'ready';
}
_emit() {
if (this.onChange) this.onChange();
}
init() {
if (this._ready) return this._ready;
this.phase = 'loading';
this.error = '';
this._emit();
this._ready = (async () => {
let lastErr;
for (const s of SOURCES) {
try {
const lib = await import( s.lib);
const fileset = await lib.FilesetResolver.forVisionTasks(s.wasm);
const make = (delegate) => lib.ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false });
try {
this._seg = await make('GPU');
} catch (e) {
this._seg = await make('CPU');
}
this.phase = 'ready';
this._emit();
return;
} catch (e) {
lastErr = e;
}
}
this.phase = 'error';
this.error = (lastErr && lastErr.message) || 'нет связи';
this._ready = null;
this._emit();
throw lastErr || new Error('не удалось загрузить нейросеть выделения');
})();
return this._ready;
}
mask(source, cols, rows, classes) {
if (!this._seg) return null;
const sw = source.videoWidth || source.naturalWidth || source.width;
const sh = source.videoHeight || source.naturalHeight || source.height;
if (!sw || !sh) return null;
const k = Math.min(1, 320 / Math.max(sw, sh));
const w = Math.max(16, Math.round(sw * k));
const h = Math.max(16, Math.round(sh * k));
this._cv ||= document.createElement('canvas');
if (this._cv.width !== w || this._cv.height !== h) {
this._cv.width = w;
this._cv.height = h;
}
this._cv.getContext('2d').drawImage(source, 0, 0, w, h);
let res;
try {
res = this._seg.segment(this._cv);
} catch (e) {
return null;
}
const cm = res && res.categoryMask;
if (!cm) {
res?.close?.();
return null;
}
const cat = cm.getAsUint8Array();
const mw = cm.width;
const mh = cm.height;
const out = new Uint8Array(cols * rows);
for (let r = 0; r < rows; r++) {
const y = Math.min(mh - 1, Math.floor(((r + 0.5) / rows) * mh));
for (let c = 0; c < cols; c++) {
const x = Math.min(mw - 1, Math.floor(((c + 0.5) / cols) * mw));
out[r * cols + c] = classes.has(cat[y * mw + x]) ? 1 : 0;
}
}
res.close?.();
return out;
}
dispose() {
try {
this._seg?.close();
} catch (e) {
}
this._seg = null;
this._ready = null;
this.phase = 'idle';
}
}
export function erodeMask(m, cols, rows) {
const out = new Uint8Array(m.length);
for (let r = 1; r < rows - 1; r++) {
for (let c = 1; c < cols - 1; c++) {
const i = r * cols + c;
if (m[i] && m[i - 1] && m[i + 1] && m[i - cols] && m[i + cols]) out[i] = 1;
}
}
return out;
}
export function dilateMask(m, cols, rows) {
const out = new Uint8Array(m.length);
for (let r = 0; r < rows; r++) {
for (let c = 0; c < cols; c++) {
const i = r * cols + c;
if (m[i] || (c > 0 && m[i - 1]) || (c < cols - 1 && m[i + 1]) || (r > 0 && m[i - cols]) || (r < rows - 1 && m[i + cols])) out[i] = 1;
}
}
return out;
}
