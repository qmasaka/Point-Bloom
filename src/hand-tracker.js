// Распознавание рук и пальцев по веб-камере (MediaPipe Hand Landmarker). Модель загружается из сети при первом включении.
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
const loadLib = () => (libPromise ||= import(/* @vite-ignore */ VISION + '/vision_bundle.mjs'));

async function createLandmarker(conf) {
	const lib = await loadLib();
	const fileset = await lib.FilesetResolver.forVisionTasks(VISION + '/wasm');
	const make = (delegate) =>
		lib.HandLandmarker.createFromOptions(fileset, {
			baseOptions: { modelAssetPath: MODEL, delegate },
			runningMode: 'VIDEO',
			numHands: 2,
			minHandDetectionConfidence: conf,
			minHandPresenceConfidence: Math.max(0.3, conf - 0.12),
			minTrackingConfidence: Math.max(0.3, conf - 0.12),
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
		this._tracks = [];
		this._nextId = 1;
		this.hold = 0.12;
		this.names = {};
	}

	_confFor() {
		return Math.round((0.75 - this.sens * 0.45) * 100) / 100;
	}

	async start() {
		if (this.running) return;
		try {
			this.onStatus('Включаю камеру…');
			this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' } });
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
		const tNow = performance.now();
		// распознавание идёт в основном потоке и конкурирует с отрисовкой, поэтому не чаще, чем позволяет бюджет:
		// не больше 30 раз в секунду, реже при медленной отрисовке и не больше 40% времени на само распознавание
		const slow = (this.fpsHint ? this.fpsHint() : 60) < 38;
		const minGap = Math.max(slow ? 50 : 33, (this._detMs || 0) * 1.6);
		if (v.readyState >= 2 && v.currentTime !== this._last && tNow - (this._detT || 0) >= minGap) {
			this._last = v.currentTime;
			this._detT = tNow;
			const c = this._confFor();
			if (c !== this._conf) {
				this._conf = c;
				try {
					this.landmarker.setOptions({ minHandDetectionConfidence: c, minHandPresenceConfidence: Math.max(0.3, c - 0.12), minTrackingConfidence: Math.max(0.3, c - 0.12) });
				} catch (e) {
					/* не критично */
				}
			}
			let res = null;
			try {
				res = this.landmarker.detectForVideo(v, performance.now());
			} catch (e) {
				res = null;
			}
			this._detMs = (this._detMs || 0) * 0.8 + (performance.now() - tNow) * 0.2;
			const hands = this._hands(res, (v.videoWidth || 4) / (v.videoHeight || 3));
			// окошко камеры обновляем не чаще 15 раз в секунду: оно только для глаз
			if (tNow - (this._pvT || 0) > 66) {
				this._pvT = tNow;
				this._draw(hands);
			}
			this.onFrame({ kind: 'hands', hands, aspect: (v.videoWidth || 4) / (v.videoHeight || 3) });
		}
		// следующий кадр сразу по готовности камеры: без пропусков и повторов кадров
		if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => this._tick());
		else this._timer = setTimeout(() => this._tick(), 16);
	}

	/** Руки сопоставляются с прошлым кадром по близости запястья (а не по порядку и подписи «левая/правая», которые у модели прыгают) */
	_hands(res, aspect) {
		const now = performance.now();
		const dets = [];
		if (res && res.landmarks) {
			res.landmarks.forEach((lm, i) => {
				const raw = lm.map((p) => [1 - p.x, p.y]);
				const wl = res.worldLandmarks?.[i];
				dets.push({ raw, world: wl ? wl.map((p) => [p.x, p.y, p.z]) : raw.map((p) => [p[0] * aspect, p[1], 0]) });
			});
		}
		const free = this._tracks.slice();
		const matched = [];
		for (const d of dets) {
			let best = null;
			let bd = 0.3;
			for (const t of free) {
				const dd = Math.hypot(t.wrist[0] - d.raw[0][0], t.wrist[1] - d.raw[0][1]);
				if (dd < bd) {
					bd = dd;
					best = t;
				}
			}
			if (best) free.splice(free.indexOf(best), 1);
			else best = this._newTrack();
			matched.push([best, d]);
		}
		const minCut = 5.5 - Math.min(1, this.smooth) * 4.5;
		for (const [t, d] of matched) {
			const dt = Math.min(0.2, Math.max(0.008, (now - (t.t || now - 33)) / 1000));
			t.t = now;
			const pts = d.raw.map((p, j) => [t.f[j * 2].filter(p[0], dt, minCut, 14), t.f[j * 2 + 1].filter(p[1], dt, minCut, 14)]);
			// мировые координаты (в метрах, не зависят от разворота руки к камере) слегка сглаживаем только для распознавания
			t.world = t.world ? d.world.map((p, j) => p.map((v, k) => t.world[j][k] + (v - t.world[j][k]) * 0.55)) : d.world;
			t.wrist = pts[0];
			t.lastSeen = now;
			const hd = measure(t, pts, aspect);
			hd.gesture = this._stable(t, hd.rawGesture, now);
			t.hd = hd;
		}
		// потеряли руку на несколько кадров: держим её ещё чуть-чуть, чтобы жест не обрывался
		this._tracks = this._tracks.filter((t) => matched.some(([m]) => m === t) || now - t.lastSeen < 380).concat(matched.map(([t]) => t).filter((t) => !this._tracks.includes(t)));
		return this._tracks.filter((t) => t.hd).map((t) => t.hd);
	}

	_newTrack() {
		return { id: 'H' + this._nextId++, f: Array.from({ length: 42 }, () => new OneEuro()), world: null, wrist: [0, 0], lastSeen: 0, t: 0, fing: [false, false, false, false], thumb: false, pinch: false, hist: [], cur: 'none', hd: null };
	}

	/** Жест меняется, только если за последние ~0,25 с он стал явным большинством и продержался дольше «задержки» */
	_stable(t, raw, now) {
		const win = Math.max(220, this.hold * 1000 * 2);
		t.hist.push([now, raw]);
		while (t.hist.length && now - t.hist[0][0] > win) t.hist.shift();
		const counts = {};
		for (const [, g] of t.hist) counts[g] = (counts[g] || 0) + 1;
		let cand = t.cur;
		let top = 0;
		for (const g in counts) if (counts[g] > top) {
			top = counts[g];
			cand = g;
		}
		const share = top / t.hist.length;
		if (cand !== t.cur && share >= 0.6 && now - (t.since || 0) >= this.hold * 1000) {
			t.cur = cand;
			t.since = now;
		}
		return t.cur;
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
			if (hd.gesture === 'pinch') {
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
			const GN = { palm: 'Ладонь', fist: 'Кулак', pinch: 'Щипок', point: 'Палец', peace: 'Два пальца', rock: 'Рога', thumb: 'Класс', none: 'Рука' };
			const act = this.names[hd.gesture];
			const text = GN[hd.gesture] + (act ? ' \u2192 ' + act : '');
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
			/* уже закрыт */
		}
		this.landmarker = null;
		this._tracks = [];
	}
}

const dist = (a, b, aspect) => Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Фильтр «One Euro»: когда рука почти стоит, сглаживает сильно (нет дрожи), когда движется быстро, почти не запаздывает */
class OneEuro {
	constructor() {
		this.x = null;
		this.dx = 0;
	}
	static alpha(cut, dt) {
		const tau = 1 / (2 * Math.PI * cut);
		return 1 / (1 + tau / dt);
	}
	filter(v, dt, minCut, beta) {
		if (this.x === null) {
			this.x = v;
			return v;
		}
		this.dx += OneEuro.alpha(1, dt) * ((v - this.x) / dt - this.dx);
		this.x += OneEuro.alpha(minCut + beta * Math.abs(this.dx), dt) * (v - this.x);
		return this.x;
	}
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
/** Угол в точке b между отрезками b-a и b-c, градусы (180 = палец прямой) */
function angleAt(a, b, c) {
	const u = sub3(a, b);
	const v = sub3(c, b);
	const d = len3(u) * len3(v);
	if (d < 1e-12) return 180;
	return (Math.acos(clamp((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / d, -1, 1)) * 180) / Math.PI;
}

const FINGERS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

/**
 * Жест определяется простыми правилами по геометрии пальцев (в метрических 3D-координатах, поэтому не зависит от поворота руки):
 *  1. Щипок: кончики большого и указательного пальцев рядом друг с другом. Это решает всё остальное: если они соединены, это щипок.
 *  2. Палец «разогнут», если он прямой в суставах и кончик далеко от запястья. «Согнут», если сложен и кончик прижат к ладони.
 *  3. Один указательный разогнут, остальные согнуты: «палец». Указательный и средний: «мир». Указательный и мизинец: «рога».
 *  4. Все четыре согнуты: «кулак» (большой палец вверх: «класс»). Три и больше разогнуты: «ладонь».
 * У каждого признака два порога (включение и выключение), поэтому жест не дрожит на границе.
 */
function measure(t, pts, aspect) {
	const W = t.world;
	const size3 = Math.max(1e-5, len3(sub3(W[9], W[0])));
	const palmC = [0, 5, 9, 13, 17].reduce((s, i) => [s[0] + W[i][0] / 5, s[1] + W[i][1] / 5, s[2] + W[i][2] / 5], [0, 0, 0]);
	const wr = W[0];
	// разгиб пальца: прямые суставы и кончик далеко от запястья (по сравнению с серединой пальца)
	const curl = FINGERS.map(([m, p, d, tip], i) => {
		const aP = angleAt(W[m], W[p], W[d]);
		const aD = angleAt(W[p], W[d], W[tip]);
		const reach = len3(sub3(W[tip], wr)) / Math.max(1e-5, len3(sub3(W[p], wr)));
		const tipPalm = len3(sub3(W[tip], palmC)) / size3;
		let straight = (aP - 100) / 70 * 0.5 + (aD - 100) / 70 * 0.2 + (reach - 0.9) / 0.5 * 0.3;
		if (tipPalm < 0.75) straight -= 0.35;
		const c = clamp(1 - straight, 0, 1);
		if (c < 0.36) t.fing[i] = true;
		else if (c > 0.58) t.fing[i] = false;
		return c;
	});
	const ex = t.fing.slice();
	const count = ex.filter(Boolean).length;
	// большой палец: прямой и отведён от основания указательного
	const thOut = len3(sub3(W[4], W[5])) / size3;
	t.thumb = angleAt(W[2], W[3], W[4]) > 140 && thOut > (t.thumb ? 0.45 : 0.6);
	// щипок: расстояние между кончиками большого и указательного относительно размера кисти
	const pd = len3(sub3(W[4], W[8])) / size3;
	const idxPalm = len3(sub3(W[8], palmC)) / size3;
	// указательный не должен быть сжат в кулак: в настоящем щипке он согнут не до конца и образует кольцо с большим
	t.pinch = pd < (t.pinch ? 0.5 : 0.34) && idxPalm > 0.4 && curl[0] < (t.pinch ? 0.9 : 0.78);
	let rawGesture = 'none';
	if (t.pinch) rawGesture = 'pinch';
	else if (ex[0] && !ex[1] && !ex[2] && !ex[3]) rawGesture = 'point';
	else if (ex[0] && ex[1] && !ex[2] && !ex[3]) rawGesture = 'peace';
	else if (ex[0] && !ex[1] && !ex[2] && ex[3]) rawGesture = 'rock';
	else if (count === 0) {
		const dx = (pts[4][0] - pts[2][0]) * aspect;
		const dy = pts[4][1] - pts[2][1];
		const up = -dy / Math.max(1e-6, Math.hypot(dx, dy));
		rawGesture = t.thumb && up > 0.6 ? 'thumb' : 'fist';
	} else if (count >= 3) rawGesture = 'palm';
	const size = Math.max(1e-3, dist(pts[0], pts[9], aspect));
	const palm = [0, 5, 9, 13, 17].reduce((s, i) => [s[0] + pts[i][0] / 5, s[1] + pts[i][1] / 5], [0, 0]);
	const open = 1 - curl.reduce((a, b) => a + b, 0) / 4;
	return { id: t.id, pts, tips: TIPS.map((i) => pts[i]), palm, size, pinch: rawGesture === 'pinch' ? 1 : 0, open, ext: ex, rawGesture, curl };
}
