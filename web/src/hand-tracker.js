const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const HAND_LINKS = [
[0, 1], [1, 2], [2, 3], [3, 4],
[0, 5], [5, 6], [6, 7], [7, 8],
[5, 9], [9, 10], [10, 11], [11, 12],
[9, 13], [13, 14], [14, 15], [15, 16],
[13, 17], [17, 18], [18, 19], [19, 20],
[0, 17],
];
export const TIPS = [4, 8, 12, 16, 20];
let libPromise = null;
const loadLib = () => (libPromise ||= import( VISION + '/vision_bundle.mjs'));
async function createLandmarker(conf) {
const lib = await loadLib();
const fileset = await lib.FilesetResolver.forVisionTasks(VISION + '/wasm');
const make = (delegate) =>
lib.HandLandmarker.createFromOptions(fileset, {
baseOptions: { modelAssetPath: MODEL, delegate },
runningMode: 'VIDEO',
numHands: 2,
minHandDetectionConfidence: conf,
minHandPresenceConfidence: conf,
minTrackingConfidence: conf,
});
try {
return await make('GPU');
} catch (e) {
return make('CPU');
}
}
export class HandTracker {
constructor(onFrame, onStatus) {
this.onFrame = onFrame;
this.onStatus = onStatus || (() => {});
this.kind = 'hands';
this.video = document.createElement('video');
this.video.autoplay = true;
this.video.playsInline = true;
this.video.muted = true;
this.preview = document.createElement('canvas');
this.preview.width = 240;
this.preview.height = 180;
this.pctx = this.preview.getContext('2d');
this.sens = 0.6;
this.smooth = 0.5;
this.running = false;
this.stream = null;
this.landmarker = null;
this._timer = null;
this._last = -1;
this._conf = 0;
this._state = new Map();
}
_confFor() {
return Math.round((0.75 - this.sens * 0.45) * 100) / 100;
}
async start() {
if (this.running) return;
try {
this.onStatus('Включаю камеру…');
this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });
this.video.srcObject = this.stream;
await this.video.play();
this.running = true;
this._draw([]);
this.onStatus('Загружаю распознавание рук…');
this._conf = this._confFor();
this.landmarker = await createLandmarker(this._conf);
if (!this.running) return;
this.onStatus('');
this._tick();
} catch (err) {
const keepStream = err && err.name !== 'NotAllowedError' && err.name !== 'NotFoundError' && this.stream;
if (!keepStream) this.stop();
err.handsLoadFailed = !!keepStream;
throw err;
}
}
_tick() {
if (!this.running) return;
const v = this.video;
if (v.readyState >= 2 && v.currentTime !== this._last) {
this._last = v.currentTime;
const c = this._confFor();
if (c !== this._conf) {
this._conf = c;
try {
this.landmarker.setOptions({ minHandDetectionConfidence: c, minHandPresenceConfidence: c, minTrackingConfidence: c });
} catch (e) {
}
}
let res = null;
try {
res = this.landmarker.detectForVideo(v, performance.now());
} catch (e) {
res = null;
}
const hands = this._hands(res, (v.videoWidth || 4) / (v.videoHeight || 3));
this._draw(hands);
this.onFrame({ kind: 'hands', hands, aspect: (v.videoWidth || 4) / (v.videoHeight || 3) });
}
this._timer = setTimeout(() => this._tick(), 24);
}
_hands(res, aspect) {
const out = [];
const seen = new Set();
const k = 1 - Math.min(0.95, this.smooth) * 0.88;
if (res && res.landmarks) {
res.landmarks.forEach((lm, i) => {
const label = (res.handedness?.[i]?.[0]?.categoryName || 'H') + i;
seen.add(label);
let prev = this._state.get(label);
const raw = lm.map((p) => [1 - p.x, p.y]);
const pts = prev ? raw.map((p, j) => [prev[j][0] + (p[0] - prev[j][0]) * k, prev[j][1] + (p[1] - prev[j][1]) * k]) : raw;
this._state.set(label, pts);
out.push(measure(pts, aspect, label));
});
}
for (const key of [...this._state.keys()]) if (!seen.has(key)) this._state.delete(key);
return out;
}
_draw(hands) {
const c = this.pctx;
const w = this.preview.width;
const h = this.preview.height;
c.save();
c.scale(-1, 1);
c.drawImage(this.video, -w, 0, w, h);
c.restore();
c.fillStyle = 'rgba(11,13,17,0.18)';
c.fillRect(0, 0, w, h);
c.lineCap = 'round';
for (const hd of hands) {
const P = (i) => [hd.pts[i][0] * w, hd.pts[i][1] * h];
c.strokeStyle = 'rgba(244,178,122,0.95)';
c.lineWidth = 2;
c.beginPath();
for (const [a, b] of HAND_LINKS) {
const A = P(a);
const B = P(b);
c.moveTo(A[0], A[1]);
c.lineTo(B[0], B[1]);
}
c.stroke();
c.fillStyle = '#ffffff';
for (let i = 0; i < 21; i++) {
const p = P(i);
c.beginPath();
c.arc(p[0], p[1], TIPS.includes(i) ? 4 : 2.2, 0, Math.PI * 2);
c.fillStyle = TIPS.includes(i) ? '#e58a45' : '#ffffff';
c.fill();
}
if (hd.pinch > 0.6) {
const a = P(4);
const b = P(8);
c.strokeStyle = '#fff0dc';
c.lineWidth = 2.5;
c.beginPath();
c.arc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 11, 0, Math.PI * 2);
c.stroke();
}
const wr = P(0);
c.font = '600 11px Geist, system-ui, sans-serif';
const text = hd.pinch > 0.6 ? 'Щипок' : hd.open > 0.65 ? 'Ладонь' : hd.open < 0.25 ? 'Кулак' : 'Рука';
const tw = c.measureText(text).width;
c.fillStyle = 'rgba(20,23,27,0.75)';
c.fillRect(wr[0] - tw / 2 - 5, wr[1] + 8, tw + 10, 17);
c.fillStyle = '#fff0dc';
c.fillText(text, wr[0] - tw / 2, wr[1] + 20);
}
}
stop() {
this.running = false;
clearTimeout(this._timer);
if (this.stream) {
this.stream.getTracks().forEach((t) => t.stop());
this.stream = null;
}
this.video.srcObject = null;
try {
this.landmarker?.close();
} catch (e) {
}
this.landmarker = null;
this._state.clear();
}
}
const dist = (a, b, aspect) => Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
function measure(pts, aspect, id) {
const size = Math.max(1e-3, dist(pts[0], pts[9], aspect));
const pinch = 1 - Math.min(1, Math.max(0, (dist(pts[4], pts[8], aspect) / size - 0.18) / 0.55));
let ext = 0;
for (const t of [8, 12, 16, 20]) ext += dist(pts[t], pts[0], aspect) / size;
ext /= 4;
const open = Math.min(1, Math.max(0, (ext - 1.0) / 0.9));
const palm = [0, 5, 9, 13, 17].reduce((s, i) => [s[0] + pts[i][0] / 5, s[1] + pts[i][1] / 5], [0, 0]);
return { id, pts, tips: TIPS.map((i) => pts[i]), palm, size, pinch, open };
}
