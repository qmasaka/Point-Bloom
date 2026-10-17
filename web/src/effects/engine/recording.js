import { downloadBlob } from '../../core/util.js';
import { encodeGIF } from '../../io/gif-encoder.js';
export class RecordingPart {
async saveAnimation({ format = 'gif', seconds = 4, fps = 15, maxW = 480 }) {
if (this.animBusy) return;
this.animBusy = true;
this.animProgress = { stage: 'Запись', v: 0 };
this.emit();
try {
if (format === 'mp4' || format === 'webm') {
this.startRecording();
const t0 = performance.now();
while (performance.now() - t0 < seconds * 1000) {
this.animProgress = { stage: 'Запись', v: (performance.now() - t0) / (seconds * 1000) };
this.emit();
await new Promise((r) => setTimeout(r, 200));
}
this.stopRecording();
return;
}
const cv = this.app.viewport.captureCanvas();
const W = Math.min(maxW, cv.width);
const H = Math.round((W / cv.width) * cv.height);
const tmp = document.createElement('canvas');
tmp.width = W;
tmp.height = H;
const ctx = tmp.getContext('2d', { willReadFrequently: true });
const bg = this.state.look.bg || '#14161b';
const frames = [];
const total = Math.max(2, Math.round(seconds * fps));
let last = -1e9;
await new Promise((resolve) => {
const guard = setTimeout(() => {
off && off();
resolve();
}, (seconds * 3 + 6) * 1000);
const off = this.app.bus.on('rendered', () => {
const now = performance.now();
if (now - last < 1000 / fps - 4) return;
last = now;
ctx.fillStyle = bg;
ctx.fillRect(0, 0, W, H);
ctx.drawImage(cv, 0, 0, W, H);
frames.push(ctx.getImageData(0, 0, W, H));
this.animProgress = { stage: 'Запись', v: frames.length / total };
if (frames.length >= total) {
clearTimeout(guard);
off && off();
resolve();
}
});
});
if (frames.length < 2) throw new Error('кадры не рисовались (вкладка была скрыта)');
this.animProgress = { stage: 'Кодирую GIF', v: 0 };
this.emit();
const blob = await encodeGIF(frames, W, H, Math.round(100 / fps), (v) => {
this.animProgress = { stage: 'Кодирую GIF', v };
this.emit();
});
downloadBlob(blob, 'effects.gif');
this.app.toast(`GIF сохранён: effects.gif (${(blob.size / 1048576).toFixed(1)} МБ)`, 'ok');
} catch (e) {
this.app.toast('Не удалось сохранить анимацию: ' + (e.message || e), 'error');
} finally {
this.animBusy = false;
this.animProgress = null;
this.emit();
}
}
startRecording(opts = {}) {
if (this.recording || !window.MediaRecorder) {
if (!window.MediaRecorder) this.app.toast('Этот браузер не умеет записывать видео', 'warn');
return;
}
const fps = typeof opts.fps === 'number' && opts.fps > 0 ? opts.fps : 60;
const sound = opts.sound !== false;
const format = opts.format || 'auto';
const duration = typeof opts.duration === 'number' && opts.duration > 0 ? opts.duration : 0;
const resolution = opts.resolution || 'viewport';
this._ensureCtx();
const RES_MAP = {
'1080p': { w: 1920, h: 1080 },
'4k': { w: 3840, h: 2160 },
'720p': { w: 1280, h: 720 },
'square': { w: 1080, h: 1080 },
'reels': { w: 1080, h: 1920 }
};
const target = RES_MAP[resolution];
if (target) {
this._recOriginalSize = { ...this.app.viewport.size };
this.app.viewport.size = { width: target.w, height: target.h };
this.app.viewport.renderer.setSize(target.w, target.h, false);
this.app.nav?.applyCamera();
this.app.viewport.invalidate();
} else {
this._recOriginalSize = null;
}
const stream = this.app.viewport.captureCanvas().captureStream(fps);
if (sound && this.recDest?.stream) {
this.recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
}
let mime = '';
if (format === 'mp4') {
mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
} else if (format === 'webm') {
mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
}
if (!mime) {
mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
}
const ext = mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
const w = target ? target.w : (this.app.viewport.canvas.width || 1920);
const h = target ? target.h : (this.app.viewport.canvas.height || 1080);
const bitrate = Math.min(50e6, Math.max(8e6, Math.round(w * h * fps * 0.14)));
let rec = null;
try {
rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
} catch (err) {
try {
rec = new MediaRecorder(stream);
} catch (e2) {
this.app.toast('Не удалось начать запись видео: ' + (e2.message || err.message), 'error');
if (this._recOriginalSize) {
this.app.viewport.resize();
this._recOriginalSize = null;
}
return;
}
}
const chunks = [];
rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
rec.onstop = () => {
if (this._recOriginalSize) {
this.app.viewport.resize();
this._recOriginalSize = null;
}
const d = new Date();
const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
const filename = `pointbloom-${stamp}.${ext}`;
downloadBlob(new Blob(chunks, { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' }), filename);
this.app.toast(ext === 'mp4' ? `Видео сохранено: ${filename}` : `Браузер сохранил видео как ${filename}`, ext === 'mp4' ? 'ok' : 'info');
};
rec.start(250);
this._rec = rec;
this.recording = true;
this.recOpts = { ...opts, fps, duration, format, sound, resolution };
this._recT0 = performance.now();
if (duration > 0) {
this._recTimer = setTimeout(() => {
if (this.recording) this.stopRecording();
}, duration * 1000);
}
this.emit();
this.app.toast(duration > 0 ? `Запись началась (${duration} с, ${fps} к/с)` : `Запись началась (${fps} к/с). Нажмите стоп для сохранения`, 'info', 2200);
}
stopRecording() {
if (!this.recording) return;
this.recording = false;
if (this._recTimer) {
clearTimeout(this._recTimer);
this._recTimer = null;
}
try {
if (this._rec && this._rec.state !== 'inactive') this._rec.stop();
} catch (e) {
}
if (this._recOriginalSize) {
this.app.viewport.resize();
this._recOriginalSize = null;
}
this._rec = null;
this.recOpts = null;
this.emit();
}
}
