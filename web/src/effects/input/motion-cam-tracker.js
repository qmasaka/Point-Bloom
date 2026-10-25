export class MotionCamTracker {
constructor(onFrame) {
this.onFrame = onFrame;
this.video = document.createElement('video');
this.video.autoplay = true;
this.video.playsInline = true;
this.video.muted = true;
this.W = 64;
this.H = 48;
this.canvas = document.createElement('canvas');
this.canvas.width = this.W;
this.canvas.height = this.H;
this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
this.preview = document.createElement('canvas');
this.preview.width = 176;
this.preview.height = 132;
this.pctx = this.preview.getContext('2d');
this.bg = null;
this.sens = 0.6;
this.running = false;
this.stream = null;
this._timer = null;
}
async start() {
if (this.running) return;
try {
this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' } });
this.video.srcObject = this.stream;
await this.video.play();
this.running = true;
this.bg = null;
this._tick();
} catch (err) {
this.stop();
throw err;
}
}
_tick() {
if (!this.running) return;
if (this.video.readyState >= 2) {
const { W, H } = this;
const ctx = this.ctx;
ctx.save();
ctx.scale(-1, 1);
ctx.drawImage(this.video, -W, 0, W, H);
ctx.restore();
const frame = ctx.getImageData(0, 0, W, H).data;
const n = W * H;
if (!this.bg) {
this.bg = new Float32Array(n);
for (let i = 0; i < n; i++) this.bg[i] = frame[i * 4] * 0.3 + frame[i * 4 + 1] * 0.59 + frame[i * 4 + 2] * 0.11;
}
const thr = 46 - this.sens * 36;
const hits = new Uint8Array(n);
let sx = 0, sy = 0, sw = 0, cnt = 0;
for (let i = 0; i < n; i++) {
const l = frame[i * 4] * 0.3 + frame[i * 4 + 1] * 0.59 + frame[i * 4 + 2] * 0.11;
const d = Math.abs(l - this.bg[i]);
this.bg[i] += (l - this.bg[i]) * 0.2;
if (d > thr) {
hits[i] = 1;
const x = i % W;
const y = (i / W) | 0;
sx += x * d;
sy += y * d;
sw += d;
cnt++;
}
}
const energy = cnt / n;
const active = cnt >= Math.max(8, n * 0.004);
const cx = active ? (sx / sw / W) * 2 - 1 : 0;
const cy = active ? -((sy / sw / H) * 2 - 1) : 0;
this._draw(frame, hits, active, active ? sx / sw : 0, active ? sy / sw : 0);
this.onFrame({ x: cx, y: cy, energy, active });
}
this._timer = setTimeout(() => this._tick(), 40);
}
_draw(frame, hits, active, px, py) {
const { W, H } = this;
const c = this.pctx;
const vw = this.video.videoWidth, vh = this.video.videoHeight;
if (vw && vh && Math.abs(this.preview.height - Math.round((this.preview.width * vh) / vw)) > 1) this.preview.height = Math.round((this.preview.width * vh) / vw);
const pw = this.preview.width;
const ph = this.preview.height;
c.save();
c.scale(-1, 1);
c.drawImage(this.video, -pw, 0, pw, ph);
c.restore();
c.fillStyle = 'rgba(11,13,17,0.45)';
c.fillRect(0, 0, pw, ph);
const cw = pw / W;
const ch = ph / H;
c.fillStyle = 'rgba(229,138,69,0.78)';
for (let i = 0; i < hits.length; i++) if (hits[i]) c.fillRect((i % W) * cw, ((i / W) | 0) * ch, cw + 0.5, ch + 0.5);
if (active) {
const x = (px + 0.5) * cw;
const y = (py + 0.5) * ch;
c.strokeStyle = '#fff0dc';
c.lineWidth = 1.5;
c.beginPath();
c.arc(x, y, 9, 0, Math.PI * 2);
c.moveTo(x - 14, y);
c.lineTo(x + 14, y);
c.moveTo(x, y - 14);
c.lineTo(x, y + 14);
c.stroke();
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
this.bg = null;
}
}
