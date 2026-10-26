// Выделение человека (или других движущихся объектов) на кадре видео для «Шлейфа движения»: MediaPipe Image Segmenter с моделью DeepLab v3
// (21 класс Pascal VOC). Модель (около 3 МБ) загружается из сети при первом включении; кадр никуда не отправляется, всё считается в браузере.
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite';
// библиотека распознавания лежит на сайте (vendor/mediapipe), как и для рук; если её нет (страница открыта файлом), берётся с CDN
const LOCAL = new URL('vendor/mediapipe/', document.baseURI).href;
const SOURCES = [
	{ name: 'local', lib: LOCAL + 'vision_bundle.mjs', wasm: LOCAL + 'wasm' },
	{ name: 'cdn', lib: VISION + '/vision_bundle.mjs', wasm: VISION + '/wasm' },
];

// классы DeepLab: 15 человек; животные: 3 птица, 8 кошка, 10 корова, 12 собака, 13 лошадь, 17 овца; транспорт: 1 самолёт, 2 велосипед, 4 лодка, 6 автобус, 7 машина, 14 мотоцикл, 19 поезд
export const SEG_CLASSES = {
	person: new Set([15]),
	any: new Set([15, 3, 8, 10, 12, 13, 17, 1, 2, 4, 6, 7, 14, 19]),
};

export class SubjectSegmenter {
	constructor() {
		this.phase = 'idle'; // idle | loading | ready | error
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

	/** Загружает библиотеку и модель; повторные вызовы возвращают тот же промис */
	init() {
		if (this._ready) return this._ready;
		this.phase = 'loading';
		this.error = '';
		this._emit();
		this._ready = (async () => {
			let lastErr;
			for (const s of SOURCES) {
				try {
					const lib = await import(/* @vite-ignore */ s.lib);
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

	/**
	 * Маска объекта на сетке кадра cols x rows (строка 0 сверху): 1 объект, 0 фон. source: видео, картинка или холст.
	 * classes: набор классов DeepLab (SEG_CLASSES). Кадр перед расчётом уменьшается до ~320 px: маска нужна грубая, а чтение большой маски дорого
	 */
	mask(source, cols, rows, classes) {
		if (!this._seg) return null;
		const sw = source.videoWidth || source.naturalWidth || source.width;
		const sh = source.videoHeight || source.naturalHeight || source.height;
		if (!sw || !sh) return null;
		// первый проход по всему кадру находит, где объект
		const full = this._run(source, 0, 0, sw, sh, classes);
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
		const out = new Uint8Array(cols * rows);
		if (x1 < 0) return out;
		// объект небольшой (бегущий человек вдали): второй проход по увеличенному куску вокруг него, так контур точнее
		let src = { m, w, h, x: 0, y: 0, cw: sw, ch: sh };
		const bw = (x1 - x0 + 1) / w;
		const bh = (y1 - y0 + 1) / h;
		if (bw * bh < 0.35) {
			const pad = 0.25;
			const cx0 = Math.max(0, (x0 / w - bw * pad) * sw);
			const cy0 = Math.max(0, (y0 / h - bh * pad) * sh);
			const cx1 = Math.min(sw, ((x1 + 1) / w + bw * pad) * sw);
			const cy1 = Math.min(sh, ((y1 + 1) / h + bh * pad) * sh);
			const crop = this._run(source, cx0, cy0, cx1 - cx0, cy1 - cy0, classes);
			if (crop) src = { ...crop, x: cx0, y: cy0, cw: cx1 - cx0, ch: cy1 - cy0 };
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

	/** Маска нужных классов для куска кадра (sx, sy, sw, sh в пикселях видео), кусок уменьшается до ~320 px: { m, w, h } или null */
	_run(source, sx, sy, sw, sh, classes) {
		const k = Math.min(1, 320 / Math.max(sw, sh));
		const w = Math.max(16, Math.round(sw * k));
		const h = Math.max(16, Math.round(sh * k));
		this._cv ||= document.createElement('canvas');
		if (this._cv.width !== w || this._cv.height !== h) {
			this._cv.width = w;
			this._cv.height = h;
		}
		this._cv.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
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
		const m = new Uint8Array(mw * mh);
		for (let i = 0; i < m.length; i++) m[i] = classes.has(cat[i]) ? 1 : 0;
		res.close?.();
		return { m, w: mw, h: mh };
	}

	dispose() {
		try {
			this._seg?.close();
		} catch (e) {
			/* уже закрыт */
		}
		this._seg = null;
		this._ready = null;
		this.phase = 'idle';
	}
}

/** Сужает маску на одну клетку: одиночные ложные клетки (шум кодека, блики) исчезают, а сам объект после расширения возвращается */
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

/** Убирает связные куски маски меньше min клеток: обрывки рядом с объектом и ложные пятна на фоне */
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

/** Расширяет маску на одну клетку: тонкие края фигуры (руки, ноги) не обрываются на грубой сетке кадра */
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
