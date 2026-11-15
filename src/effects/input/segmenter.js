const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const DEEPLAB = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite';
const POSE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
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
		this.onChange = null;
		this.kind = 'pose';
		this._st = { pose: { phase: 'idle', error: '', model: null, job: null }, deeplab: { phase: 'idle', error: '', model: null, job: null } };
		this._cv = null;
	}

	setMode(mask) {
		this.kind = mask === 'person' && this._st.pose.phase !== 'error' ? 'pose' : 'deeplab';
	}

	get phase() {
		return this._st[this.kind].phase;
	}

	get error() {
		return this._st[this.kind].error;
	}

	get ready() {
		return this.phase === 'ready';
	}

	_emit() {
		if (this.onChange) this.onChange();
	}

	init() {
		const kind = this.kind;
		const st = this._st[kind];
		if (st.job) return st.job;
		st.phase = 'loading';
		st.error = '';
		this._emit();
		st.job = (async () => {
			let lastErr;
			for (const s of SOURCES) {
				try {
					const lib = await import( s.lib);
					const fileset = await lib.FilesetResolver.forVisionTasks(s.wasm);
					const make = (delegate) =>
						kind === 'pose'
							? lib.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: POSE, delegate }, runningMode: 'IMAGE', numPoses: 4, outputSegmentationMasks: true, minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4 })
							: lib.ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: DEEPLAB, delegate }, runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false });
					try {
						st.model = await make('GPU');
					} catch (e) {
						st.model = await make('CPU');
					}
					await new Promise((r) => setTimeout(r, 30));
					try {
						const cv = document.createElement('canvas');
						cv.width = cv.height = 64;
						const res = kind === 'pose' ? st.model.detect(cv) : st.model.segment(cv);
						res?.close?.();
					} catch (e) {
					}
					st.phase = 'ready';
					this._emit();
					return;
				} catch (e) {
					lastErr = e;
				}
			}
			st.phase = 'error';
			st.error = (lastErr && lastErr.message) || 'нет связи';
			st.job = null;
			if (kind === 'pose' && this.kind === 'pose') {
				this.kind = 'deeplab';
				this._emit();
				return this.init();
			}
			this._emit();
			throw lastErr || new Error('не удалось загрузить нейросеть выделения');
		})();
		return st.job;
	}

	mask(source, cols, rows, classes) {
		const model = this._st[this.kind].model;
		if (!model) return null;
		const sw = source.videoWidth || source.naturalWidth || source.width;
		const sh = source.videoHeight || source.naturalHeight || source.height;
		if (!sw || !sh) return null;
		const out = new Uint8Array(cols * rows);
		let src;
		if (this.kind === 'pose') {
			const r = this._runPose(model, source, sw, sh);
			if (!r) return null;
			src = { ...r, x: 0, y: 0, cw: sw, ch: sh };
		} else {
			const full = this._run(model, source, 0, 0, sw, sh, classes);
			if (!full) return null;
			const { m, w, h } = full;
			let x0 = w, y0 = h, x1 = -1, y1 = -1;
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					if (!m[y * w + x]) continue;
					if (x < x0) x0 = x;
					if (x > x1) x1 = x;
					if (y < y0) y0 = y;
					if (y > y1) y1 = y;
				}
			}
			if (x1 < 0) return out;
			src = { m, w, h, x: 0, y: 0, cw: sw, ch: sh };
			const bw = (x1 - x0 + 1) / w;
			const bh = (y1 - y0 + 1) / h;
			if (bw * bh < 0.35) {
				const pad = 0.25;
				const cx0 = Math.max(0, (x0 / w - bw * pad) * sw);
				const cy0 = Math.max(0, (y0 / h - bh * pad) * sh);
				const cx1 = Math.min(sw, ((x1 + 1) / w + bw * pad) * sw);
				const cy1 = Math.min(sh, ((y1 + 1) / h + bh * pad) * sh);
				const crop = this._run(model, source, cx0, cy0, cx1 - cx0, cy1 - cy0, classes);
				if (crop) src = { ...crop, x: cx0, y: cy0, cw: cx1 - cx0, ch: cy1 - cy0 };
			}
		}
		for (let r = 0; r < rows; r++) {
			const py = ((r + 0.5) / rows) * sh;
			const y = Math.floor(((py - src.y) / src.ch) * src.h);
			if (y < 0 || y >= src.h) continue;
			for (let c = 0; c < cols; c++) {
				const px = ((c + 0.5) / cols) * sw;
				const x = Math.floor(((px - src.x) / src.cw) * src.w);
				if (x >= 0 && x < src.w) out[r * cols + c] = src.m[y * src.w + x];
			}
		}
		return out;
	}

	_draw(source, sx, sy, sw, sh, px) {
		const k = Math.min(1, px / Math.max(sw, sh));
		const w = Math.max(16, Math.round(sw * k));
		const h = Math.max(16, Math.round(sh * k));
		this._cv ||= document.createElement('canvas');
		if (this._cv.width !== w || this._cv.height !== h) {
			this._cv.width = w;
			this._cv.height = h;
		}
		this._cv.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
		return this._cv;
	}

	_runPose(model, source, sw, sh) {
		const cv = this._draw(source, 0, 0, sw, sh, 512);
		let res;
		try {
			res = model.detect(cv);
		} catch (e) {
			return null;
		}
		const masks = (res && res.segmentationMasks) || [];
		const w = cv.width;
		const h = cv.height;
		const m = new Uint8Array(w * h);
		for (const mk of masks) {
			const a = mk.getAsFloat32Array();
			const mw = mk.width;
			const mh = mk.height;
			for (let y = 0; y < h; y++) {
				const row = Math.min(mh - 1, Math.floor((y / h) * mh)) * mw;
				for (let x = 0; x < w; x++) if (a[row + Math.min(mw - 1, Math.floor((x / w) * mw))] > 0.5) m[y * w + x] = 1;
			}
		}
		res?.close?.();
		return { m, w, h };
	}

	_run(model, source, sx, sy, sw, sh, classes) {
		const cv = this._draw(source, sx, sy, sw, sh, 320);
		let res;
		try {
			res = model.segment(cv);
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
		const m = new Uint8Array(mw * mh);
		for (let i = 0; i < m.length; i++) m[i] = classes.has(cat[i]) ? 1 : 0;
		res.close?.();
		return { m, w: mw, h: mh };
	}

	dispose() {
		for (const st of Object.values(this._st)) {
			try {
				st.model?.close();
			} catch (e) {
			}
			st.model = null;
			st.job = null;
			st.phase = 'idle';
		}
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

export function dropSpecks(m, cols, rows, min) {
	const seen = new Uint8Array(m.length);
	const stack = new Int32Array(m.length);
	const comp = [];
	for (let s = 0; s < m.length; s++) {
		if (!m[s] || seen[s]) continue;
		let top = 0;
		stack[top++] = s;
		seen[s] = 1;
		comp.length = 0;
		while (top) {
			const i = stack[--top];
			comp.push(i);
			const c = i % cols;
			const nb = [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, i >= cols ? i - cols : -1, i + cols < m.length ? i + cols : -1];
			for (const j of nb) {
				if (j >= 0 && m[j] && !seen[j]) {
					seen[j] = 1;
					stack[top++] = j;
				}
			}
		}
		if (comp.length < min) for (const i of comp) m[i] = 0;
	}
	return m;
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
