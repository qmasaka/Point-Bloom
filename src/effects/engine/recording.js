import * as THREE from 'three';
import { downloadBlob } from '../../core/util.js';
import { encodeGIF } from '../../io/gif-encoder.js';
import { WebCodecsRecorder } from '../../io/video-encode.js';
import { BACKGROUNDS, paintBackground } from '../../scene/viewport.js';

const REC_KEY = 'objglb.fx.rec';
const RES_MAP = {
	'1080p': { w: 1920, h: 1080 },
	'4k': { w: 3840, h: 2160 },
	'720p': { w: 1280, h: 720 },
	square: { w: 1080, h: 1080 },
	reels: { w: 1080, h: 1920 },
};
const QUALITY = {
	light: { qp: 28, bpp: 0.06, ss: [1, 1] },
	good: { qp: 24, bpp: 0.1, ss: [1.5, 1] },
	high: { qp: 20, bpp: 0.18, ss: [2, 1.25] },
	max: { qp: 16, bpp: 0.36, ss: [2, 1.5] },
};

export function recDefaults() {
	const o = { res: 'viewport', fps: '60', format: 'auto', sound: true, dur: '0', quality: 'high', tlMode: 'frames' };
	try {
		const saved = JSON.parse(localStorage.getItem(REC_KEY) || '{}');
		if (saved && typeof saved === 'object' && 'codec' in saved) {
			delete saved.codec;
			delete saved.quality;
		}
		if (saved && typeof saved === 'object') Object.assign(o, saved);
	} catch (e) {
	}
	return o;
}

export function saveRecDefaults(o) {
	try {
		localStorage.setItem(REC_KEY, JSON.stringify(o));
	} catch (e) {
	}
}

const even = (v) => Math.max(2, Math.floor(v / 2) * 2);

export class RecordingPart {

	_recBgSpec() {
		const { bg, vignette } = this.state.look;
		if (this.active && bg) {
			if (!vignette) return { type: 'solid', c: bg };
			const hi = new THREE.Color(bg).lerp(new THREE.Color(1, 1, 1), 0.025);
			return { type: 'radial', at: [0.5, 0.42], stops: [[0, '#' + hi.getHexString(THREE.SRGBColorSpace)], [0.78, bg], [1, bg]] };
		}
		const B = BACKGROUNDS[this.app.settings.render.bg] || BACKGROUNDS.dark;
		return B.paint || { type: 'solid', c: B.solid || '#2a2d33' };
	}

	_recCompose(cv, ctx, bg = this._recBgSpec()) {
		const vp = this.app.viewport;
		const W = cv.width;
		const H = cv.height;
		paintBackground(ctx, W, H, bg);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		const ss = this._recSS || 1;
		const draw = (src) => {
			if (!src || !src.width || !src.height) return;
			const sw = Math.min(src.width, Math.round(W * ss));
			const sh = Math.min(src.height, Math.round(H * ss));
			ctx.drawImage(src, 0, 0, sw, sh, 0, 0, W, H);
		};
		draw(vp.canvas);
		const ov = vp.fxOverlay;
		if (ov && ov.style.visibility !== 'hidden') draw(ov);
	}

	_recSize(target, maxSS = 1) {
		const vp = this.app.viewport;
		this._recSaved = { pr: vp.renderer.getPixelRatio(), shift: vp.viewShift || 0, ref: vp.viewRef || 0 };
		vp.recLock = true;
		const t = target || { w: even(vp.canvas.width), h: even(vp.canvas.height) };
		let ss = Math.min(maxSS, 4096 / Math.max(t.w, t.h));
		if (ss < 1.1) ss = 1;
		this._recSS = ss;
		const k = t.h / Math.max(1, vp.stage.clientHeight);
		vp.viewShift = 0;
		vp.viewRef = 0;
		vp.size = { width: (t.w + 0.01) / k, height: (t.h + 0.01) / k };
		vp.renderer.setPixelRatio(k * ss);
		vp.renderer.setSize(vp.size.width, vp.size.height, false);
		vp.stage.classList.add('is-rec-frame');
		this.app.nav?.applyCamera();
		vp.invalidate();
		return { w: even(t.w), h: even(t.h) };
	}

	_recRestore() {
		const vp = this.app.viewport;
		const s = this._recSaved;
		vp.recLock = false;
		if (!s) return;
		this._recSaved = null;
		vp.viewShift = s.shift;
		vp.viewRef = s.ref;
		vp.renderer.setPixelRatio(s.pr);
		vp.stage.classList.remove('is-rec-frame');
		vp.resize();
	}

	async saveAnimation({ format = 'gif', seconds = 4, fps = 15, maxW = 480 }) {
		if (this.animBusy) return;
		this.animBusy = true;
		this.animProgress = { stage: 'Запись', v: 0 };
		this.emit();
		try {
			if (format === 'mp4' || format === 'webm') {
				this.startRecording({ duration: seconds, format });
				const t0 = performance.now();
				while (this.recording && performance.now() - t0 < seconds * 1000 + 15000) {
					const f = this._recFirst;
					this.animProgress = { stage: 'Запись', v: f ? Math.min(1, (performance.now() - f) / (seconds * 1000)) : 0 };
					this.emit();
					await new Promise((r) => setTimeout(r, 200));
				}
				if (this.recording) this.stopRecording();
				return;
			}
			const vp = this.app.viewport;
			const full = document.createElement('canvas');
			const fctx = full.getContext('2d', { alpha: false });
			const tmp = document.createElement('canvas');
			const ctx = tmp.getContext('2d', { willReadFrequently: true, alpha: false });
			const bg = this._recBgSpec();
			const frames = [];
			const total = Math.max(2, Math.round(seconds * fps));
			let last = -1e9;
			let W = 0;
			let H = 0;
			await new Promise((resolve) => {
				const guard = setTimeout(() => {
					off && off();
					resolve();
				}, (seconds * 3 + 6) * 1000);
				const off = this.app.bus.on('rendered', () => {
					const now = performance.now();
					if (now - last < 1000 / fps - 4) return;
					last = now;
					if (!W) {
						W = Math.min(maxW, vp.canvas.width);
						H = Math.round((W / vp.canvas.width) * vp.canvas.height);
						tmp.width = W;
						tmp.height = H;
					}
					full.width = even(vp.canvas.width);
					full.height = even(vp.canvas.height);
					this._recCompose(full, fctx, bg);
					ctx.drawImage(full, 0, 0, W, H);
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
		if (this.recording) return;
		const d = recDefaults();
		const o = {
			resolution: opts.resolution ?? d.res,
			fps: opts.fps > 0 ? opts.fps : parseInt(d.fps, 10) || 60,
			format: opts.format ?? d.format,
			sound: opts.sound ?? d.sound !== false,
			duration: opts.duration ?? (parseInt(d.dur, 10) || 0),
			quality: QUALITY[opts.quality] ? opts.quality : QUALITY[d.quality] ? d.quality : 'high',
			offline: !!opts.offline,
			onStart: opts.onStart || null,
		};
		if (!window.MediaRecorder && typeof VideoEncoder === 'undefined') {
			this.app.toast('Этот браузер не умеет записывать видео', 'warn');
			return;
		}
		this.recording = true;
		this._recStarting = true;
		this.recOpts = o;
		this._recT0 = performance.now();
		this.emit();
		this._recStart(o).catch((e) => {
			this._recAbort('Не удалось начать запись видео: ' + (e.message || e));
		});
	}

	async _recStart(o) {
		this._ensureCtx();
		const fps = o.fps;
		const q = QUALITY[o.quality];
		const { w, h } = this._recSize(RES_MAP[o.resolution] || null, q.ss[o.offline ? 0 : 1]);
		const cv = document.createElement('canvas');
		cv.width = w;
		cv.height = h;
		const ctx = cv.getContext('2d', { alpha: false });
		this._recCv = cv;
		this._recCtx = ctx;
		this._recBg = this._recBgSpec();
		const bitrate = Math.round(Math.min(250e6, Math.max(4e6, w * h * fps * q.bpp)));
		const wantSound = o.sound && !o.offline && !!this.bus;
		let rec = null;
		if (o.format !== 'webm') {
			try {
				rec = await WebCodecsRecorder.create({ width: w, height: h, fps, bitrate, qp: q.qp, audio: wantSound ? { ctx: this.ctx, node: this.bus, required: true } : null, perf0: this._recT0 });
			} catch (e) {
				rec = null;
			}
		}
		if (!this.recording) {
			rec?.cancel();
			return;
		}
		if (rec) {
			this._recEnc = rec;
			this._recKind = 'mp4';
		} else {
			this._recMediaRecorder(o, cv, bitrate, wantSound);
			if (!this._rec) return;
		}
		if (o.offline) this._recOffStart(fps);
		this._recSlot = -1;
		this._recFirst = 0;
		this._recStarting = false;
		this._recOff = this._recOffPending || null;
		this._recOffPending = null;
		this._recUnsub = this.app.bus.on('rendered', () => this._recFrame());
		if (this._recOff) this._recOff.fresh = true;
		this.app.viewport.invalidate();
		o.onStart?.();
		this.emit();
		const msg = o.offline ? `Покадровая запись началась: ${w}×${h}, без звука` : o.duration > 0 ? `Запись началась: ${o.duration} с, ${fps} к/с, ${w}×${h}` : `Запись началась: ${fps} к/с, ${w}×${h}. Нажмите стоп, чтобы сохранить`;
		this.app.toast(msg, 'info', 2200);
	}

	_recMediaRecorder(o, cv, bitrate, wantSound) {
		if (!window.MediaRecorder) {
			this._recAbort('Этот браузер не умеет записывать видео');
			return;
		}
		let stream = cv.captureStream(0);
		this._recTrack = stream.getVideoTracks()[0];
		if (!this._recTrack || typeof this._recTrack.requestFrame !== 'function') {
			stream = cv.captureStream(o.fps);
			this._recTrack = null;
		}
		if (wantSound && this.recDest?.stream) this.recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
		const mp4 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
		const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
		const list = o.format === 'webm' ? [...webm, ...mp4] : [...mp4, ...webm];
		const mime = list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
		let rec = null;
		try {
			rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
		} catch (err) {
			try {
				rec = new MediaRecorder(stream);
			} catch (e2) {
				this._recAbort('Не удалось начать запись видео: ' + (e2.message || err.message));
				return;
			}
		}
		const ext = (rec.mimeType || mime).startsWith('video/mp4') ? 'mp4' : 'webm';
		const chunks = [];
		rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		rec.onstop = () => this._recSave(new Blob(chunks, { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' }), ext);
		rec.start(250);
		this._rec = rec;
		this._recKind = ext;
	}

	_recFrame() {
		if (!this.recording || this._recStarting || !this._recCv) return;
		const off = this._recOff;
		let ts;
		if (off) {
			if (!off.fresh || off.busy) return;
			off.fresh = false;
			ts = Math.round((off.frame * 1e6) / off.fps);
			off.frame++;
		} else {
			const now = performance.now();
			const iv = 1000 / this.recOpts.fps;
			const slot = Math.round((now - this._recT0) / iv);
			if (slot <= this._recSlot) return;
			this._recSlot = slot;
			ts = Math.round(slot * iv * 1000);
			if (!this._recFirst) {
				this._recFirst = now;
				const dur = this.recOpts.duration;
				if (dur > 0) {
					this._recTimer = setTimeout(() => {
						if (this.recording) this.stopRecording();
					}, dur * 1000);
				}
			}
		}
		this._recCompose(this._recCv, this._recCtx, this._recBg);
		if (this._recEnc) {
			this._recEnc.addFrame(this._recCv, ts);
			if (this._recEnc.error) {
				this._recAbort('Кодер видео остановился: ' + (this._recEnc.error.message || this._recEnc.error));
				return;
			}
		} else if (this._recTrack) this._recTrack.requestFrame();
		if (off) {
			off.busy = true;
			this._recOffNext(off);
		}
	}

	_recOffStart(fps) {
		const pm = this.pm;
		const vid = pm && pm.kind === 'video' && pm.el ? pm.el : null;
		if (vid) vid.pause();
		this._recOffPending = { fps, frame: 0, fresh: false, busy: false, vid };
	}

	async _recOffNext(off) {
		try {
			await this._recEnc?.drain(2);
			const v = off.vid;
			if (v && v.duration) {
				let t = v.currentTime + 1 / off.fps;
				if (t >= v.duration - 0.01) t = v.loop ? 0 : v.duration - 0.01;
				await this._seekTo(v, t);
			}
		} catch (e) {
		}
		off.busy = false;
	}

	_recOffEnd() {
		const off = this._recOff;
		this._recOff = null;
		if (off?.vid && this.pm?.playing) this.pm.play();
	}

	stopRecording() {
		if (!this.recording) return;
		this.recording = false;
		this.animRec = false;
		clearTimeout(this._recTimer);
		this._recTimer = null;
		this._recUnsub?.();
		this._recUnsub = null;
		this._recOffEnd();
		const enc = this._recEnc;
		this._recEnc = null;
		const mr = this._rec;
		this._rec = null;
		this._recTrack = null;
		this._recCv = this._recCtx = null;
		this._recRestore();
		this.recOpts = null;
		this.emit();
		if (enc) {
			this.app.toast('Сохраняю видео…', 'info', 1600);
			enc
				.finish()
				.then((blob) => this._recSave(blob, 'mp4', enc))
				.catch((e) => this.app.toast('Не удалось сохранить видео: ' + (e.message || e), 'error'));
		} else if (mr && mr.state !== 'inactive') {
			try {
				mr.stop();
			} catch (e) {
			}
		}
	}

	_recSave(blob, ext, enc) {
		const d = new Date();
		const p2 = (v) => String(v).padStart(2, '0');
		const filename = `pointbloom-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${ext}`;
		downloadBlob(blob, filename);
		const mb = (blob.size / 1048576).toFixed(1);
		if (enc && enc.dropped > enc.frames * 0.1) this.app.toast(`Видео сохранено: ${filename} (${mb} МБ). Компьютер не успевал, часть кадров пропущена: для таймлайна включите покадровую запись`, 'warn', 5000);
		else this.app.toast(`Видео сохранено: ${filename} (${mb} МБ)`, 'ok', 3000);
	}

	_recAbort(msg) {
		this.recording = false;
		this._recStarting = false;
		if (this.animRec) {
			this.animRec = false;
			this.animPlaying = false;
		}
		clearTimeout(this._recTimer);
		this._recUnsub?.();
		this._recUnsub = null;
		this._recOffEnd();
		this._recEnc?.cancel();
		this._recEnc = null;
		try {
			if (this._rec && this._rec.state !== 'inactive') {
				this._rec.onstop = null;
				this._rec.stop();
			}
		} catch (e) {
		}
		this._rec = null;
		this._recCv = this._recCtx = null;
		this._recRestore();
		this.recOpts = null;
		this.emit();
		if (msg) this.app.toast(msg, 'error');
	}
}
