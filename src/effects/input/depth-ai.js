// Карта глубины по кадру. Нейросеть Depth Anything V2 Small (лицензия Apache 2.0) работает в Web Worker через Transformers.js:
// на видеокарте (WebGPU), а если её нет, то на процессоре (WASM). Библиотека и модель (около 20-50 МБ) скачиваются один раз и остаются в кеше браузера.
// Картинка никуда не отправляется: вычисления идут на вашем компьютере.

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MODEL = 'onnx-community/depth-anything-v2-small';

const WORKER_SRC = `
const LIBURL = '${LIB}';
const libP = import(LIBURL);
let depther = null;
let T = null;
const post = (m, tr) => self.postMessage(m, tr || []);
async function make(dev) {
	if (dev === 'wasm') T.env.backends.onnx.wasm.numThreads = 1;
	return T.pipeline('depth-estimation', '${MODEL}', { device: dev, dtype: dev === 'webgpu' ? 'fp16' : 'q8', progress_callback: (p) => post({ type: 'progress', p }) });
}
async function run(img) {
	const out = await depther(new T.RawImage(img.data, img.w, img.h, 4));
	const t = out.predicted_depth;
	const d = t.dims;
	return { w: d[d.length - 1], h: d[d.length - 2], data: new Float32Array(t.data) };
}
self.onmessage = async (e) => {
	const m = e.data;
	try {
		if (!T) {
			T = await libP;
			T.env.allowLocalModels = false;
		}
		if (m.type === 'init') {
			const order = typeof navigator !== 'undefined' && navigator.gpu && !m.noGpu ? ['webgpu', 'wasm'] : ['wasm'];
			let last = null;
			for (const dev of order) {
				try {
					depther = await make(dev);
					// пробный прогон: на некоторых видеокартах сессия создаётся, но считает мусор
					const probe = new Uint8ClampedArray(56 * 56 * 4);
					for (let i = 0; i < probe.length; i += 4) probe[i] = probe[i + 1] = probe[i + 2] = (i / 4) % 56 * 4, probe[i + 3] = 255;
					const r = await run({ data: probe, w: 56, h: 56 });
					for (let i = 0; i < r.data.length; i++) if (!Number.isFinite(r.data[i])) throw new Error('Нейросеть вернула некорректный результат');
					post({ type: 'ready', device: dev });
					return;
				} catch (err) {
					last = err;
					depther = null;
				}
			}
			throw last || new Error('Не удалось запустить нейросеть');
		} else if (m.type === 'run') {
			const r = await run(m);
			post({ type: 'depth', id: m.id, w: r.w, h: r.h, data: r.data }, [r.data.buffer]);
		}
	} catch (err) {
		post({ type: 'error', id: m.id, message: String((err && err.message) || err) });
	}
};
`;

export class DepthAI {
	constructor() {
		this.worker = null;
		this.phase = 'idle'; // idle | loading | ready | error
		this.prog = 0;
		this.device = '';
		this.error = '';
		this.onChange = null;
		this._files = new Map();
		this._jobs = new Map();
		this._seq = 0;
		this._ready = null;
	}

	get ready() {
		return this.phase === 'ready';
	}

	get busy() {
		return this._jobs.size > 0;
	}

	_emit() {
		if (this.onChange) this.onChange();
	}

	/** Запускает worker и загружает модель; повторные вызовы возвращают тот же промис */
	init() {
		if (this._ready) return this._ready;
		this.phase = 'loading';
		this.prog = 0;
		this.error = '';
		this._files.clear();
		this._emit();
		this._ready = new Promise((resolve, reject) => {
			let url = '';
			try {
				url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
				this.worker = new Worker(url, { type: 'module' });
			} catch (e) {
				this._fail(e, reject);
				return;
			}
			this.worker.onerror = (e) => this._fail(new Error(e.message || 'Не удалось запустить нейросеть. Проверьте интернет'), reject);
			this.worker.onmessage = (e) => {
				const m = e.data;
				if (m.type === 'progress') {
					const p = m.p || {};
					if (p.file && p.total && /\.onnx/.test(p.file)) {
						this._files.set(p.file, { loaded: p.loaded || 0, total: p.total });
						let l = 0, t = 0;
						for (const f of this._files.values()) {
							l += f.loaded;
							t += f.total;
						}
						this.prog = t ? Math.min(0.98, l / t) : 0;
						this._emit();
					}
				} else if (m.type === 'ready') {
					this.phase = 'ready';
					this.prog = 1;
					this.device = m.device;
					this._emit();
					resolve();
				} else if (m.type === 'depth') {
					const job = this._jobs.get(m.id);
					this._jobs.delete(m.id);
					if (job) job.resolve({ w: m.w, h: m.h, data: m.data });
					this._emit();
				} else if (m.type === 'error') {
					const job = this._jobs.get(m.id);
					if (job) {
						this._jobs.delete(m.id);
						job.reject(new Error(m.message));
					} else this._fail(new Error(m.message), reject);
				}
			};
			this.worker.postMessage({ type: 'init' });
		});
		return this._ready;
	}

	_fail(err, reject) {
		this.phase = 'error';
		this.error = err.message || String(err);
		for (const j of this._jobs.values()) j.reject(err);
		this._jobs.clear();
		try {
			this.worker?.terminate();
		} catch (e) {
			/* worker уже закрыт */
		}
		this.worker = null;
		this._ready = null;
		this._emit();
		if (reject) reject(err);
	}

	/** Строит карту глубины для кадра {data: Uint8ClampedArray RGBA, w, h}; результат {w, h, data: Float32Array}, больше значит ближе (обратная глубина, масштаб произвольный) */
	async estimate(img) {
		await this.init();
		const id = ++this._seq;
		const p = new Promise((resolve, reject) => this._jobs.set(id, { resolve, reject }));
		this.worker.postMessage({ type: 'run', id, data: img.data, w: img.w, h: img.h }, [img.data.buffer]);
		this._emit();
		return p;
	}

	dispose() {
		try {
			this.worker?.terminate();
		} catch (e) {
			/* worker уже закрыт */
		}
		this.worker = null;
		this._ready = null;
		this.phase = 'idle';
	}
}

let grabCanvas = null;
/** Снимает кадр с картинки, видео или холста в ограничении по длинной стороне; возвращает {data (RGBA), w, h} */
export function grabFrame(el, maxSide = 518) {
	const sw = el.videoWidth || el.naturalWidth || el.width;
	const sh = el.videoHeight || el.naturalHeight || el.height;
	if (!sw || !sh) return null;
	const k = Math.min(1, maxSide / Math.max(sw, sh));
	const w = Math.max(14, Math.round(sw * k));
	const h = Math.max(14, Math.round(sh * k));
	grabCanvas ||= document.createElement('canvas');
	grabCanvas.width = w;
	grabCanvas.height = h;
	const g = grabCanvas.getContext('2d', { willReadFrequently: true });
	g.drawImage(el, 0, 0, w, h);
	return { data: g.getImageData(0, 0, w, h).data, w, h };
}

/** Своя карта глубины из картинки (светлое ближе): {w, h, data} со значениями 0..1, длинная сторона не больше maxSide */
export async function loadDepthImage(file, maxSide = 640) {
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const f = grabFrame(img, maxSide);
		if (!f) throw new Error('не удалось прочитать картинку');
		const data = new Float32Array(f.w * f.h);
		for (let i = 0, k = 0; i < data.length; i++, k += 4) data[i] = (0.299 * f.data[k] + 0.587 * f.data[k + 1] + 0.114 * f.data[k + 2]) / 255;
		return { w: f.w, h: f.h, data };
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Выбор файла картинки; возвращает File или null */
export function pickImageFile() {
	return new Promise((resolve) => {
		const inp = document.createElement('input');
		inp.type = 'file';
		inp.accept = 'image/*';
		inp.addEventListener('change', () => resolve((inp.files && inp.files[0]) || null));
		inp.click();
	});
}

/** Кадр из массива RGB (запись видео) в RGBA нужного размера */
export function grabRGB(rgb, cols, rows) {
	const data = new Uint8ClampedArray(cols * rows * 4);
	for (let i = 0, j = 0, k = 0; i < cols * rows; i++, j += 3, k += 4) {
		data[k] = rgb[j];
		data[k + 1] = rgb[j + 1];
		data[k + 2] = rgb[j + 2];
		data[k + 3] = 255;
	}
	return { data, w: cols, h: rows };
}

/**
 * Приводит сырую глубину к 0..1 (1 = ближе всего). Границы берутся по 1% и 99% гистограммы и сглаживаются между кадрами видео, чтобы глубина не мерцала.
 * st: {lo, hi, init}, хранит прошлые границы; smooth: 0 для первой картинки.
 */
export function normalizeDepth(raw, st, smooth = 0) {
	const n = raw.length;
	let mn = Infinity, mx = -Infinity;
	for (let i = 0; i < n; i++) {
		const v = raw[i];
		if (v < mn) mn = v;
		if (v > mx) mx = v;
	}
	const span = Math.max(mx - mn, 1e-6);
	const hist = new Uint32Array(256);
	for (let i = 0; i < n; i++) hist[Math.min(255, ((raw[i] - mn) / span) * 255.999 | 0)]++;
	let acc = 0, lo = mn, hi = mx;
	for (let b = 0; b < 256; b++) {
		acc += hist[b];
		if (acc >= n * 0.01) {
			lo = mn + (b / 255) * span;
			break;
		}
	}
	acc = 0;
	for (let b = 255; b >= 0; b--) {
		acc += hist[b];
		if (acc >= n * 0.01) {
			hi = mn + ((b + 1) / 255) * span;
			break;
		}
	}
	if (hi - lo < 1e-6) hi = lo + 1e-6;
	if (st.init && smooth > 0) {
		lo = st.lo + (lo - st.lo) * smooth;
		hi = st.hi + (hi - st.hi) * smooth;
	}
	st.lo = lo;
	st.hi = hi;
	st.init = true;
	const out = new Float32Array(n);
	const inv = 1 / (hi - lo);
	for (let i = 0; i < n; i++) {
		const v = (raw[i] - lo) * inv;
		out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
	}
	return out;
}

/** Быстрая запасная карта без нейросети: светлое ближе, с лёгким размытием, чтобы не было зерна. rgb: Uint8Array из троек RGB размера w x h (stride 4 для RGBA) */
export function lumaDepth(rgb, w, h, stride = 3) {
	const l = new Float32Array(w * h);
	for (let i = 0, k = 0; i < l.length; i++, k += stride) l[i] = (0.299 * rgb[k] + 0.587 * rgb[k + 1] + 0.114 * rgb[k + 2]) / 255;
	const t = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			t[i] = (l[x > 0 ? i - 1 : i] + l[i] * 2 + l[x < w - 1 ? i + 1 : i]) * 0.25;
		}
	}
	const o = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			o[i] = (t[y > 0 ? i - w : i] + t[i] * 2 + t[y < h - 1 ? i + w : i]) * 0.25;
		}
	}
	return { w, h, data: o };
}

/** Правка готовой карты: размытие (радиус в пикселях карты), яркость, контраст и тени (гамма). Возвращает новую карту, исходная не меняется */
export function adjustDepth(map, o) {
	const { w, h } = map;
	const n = w * h;
	let d = map.data;
	const r = Math.round(o.blur || 0);
	if (r > 0) {
		const box = (src, horiz) => {
			const out = new Float32Array(n);
			const len = horiz ? w : h;
			const lines = horiz ? h : w;
			const step = horiz ? 1 : w;
			for (let l = 0; l < lines; l++) {
				const base = horiz ? l * w : l;
				let acc = 0;
				// бегущая сумма по окну 2r+1, края повторяются
				for (let k = -r; k <= r; k++) acc += src[base + Math.min(len - 1, Math.max(0, k)) * step];
				for (let k = 0; k < len; k++) {
					out[base + k * step] = acc / (2 * r + 1);
					acc += src[base + Math.min(len - 1, k + r + 1) * step] - src[base + Math.max(0, k - r) * step];
				}
			}
			return out;
		};
		// два прохода по каждой оси дают мягкое, почти гауссово размытие
		d = box(box(box(box(d, true), false), true), false);
	}
	const c = o.contrast ?? 1, b = o.bright || 0, g = o.gamma ?? 1;
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		let v = (d[i] - 0.5) * c + 0.5 + b;
		v = v < 0 ? 0 : v > 1 ? 1 : v;
		out[i] = g === 1 ? v : Math.pow(v, g);
	}
	return { w, h, data: out };
}

/** Переносит карту глубины на сетку точек cols x rows (билинейно); out получает по числу на точку */
export function depthToGrid(map, cols, rows, out) {
	const { w, h, data } = map;
	for (let r = 0; r < rows; r++) {
		const fy = Math.min(h - 1, Math.max(0, ((r + 0.5) / rows) * h - 0.5));
		const y0 = fy | 0, y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
		for (let c = 0; c < cols; c++) {
			const fx = Math.min(w - 1, Math.max(0, ((c + 0.5) / cols) * w - 0.5));
			const x0 = fx | 0, x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
			const a = data[y0 * w + x0] * (1 - tx) + data[y0 * w + x1] * tx;
			const b = data[y1 * w + x0] * (1 - tx) + data[y1 * w + x1] * tx;
			out[r * cols + c] = a * (1 - ty) + b * ty;
		}
	}
}
