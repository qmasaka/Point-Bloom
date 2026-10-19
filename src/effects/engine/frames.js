import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { buildFrameBlock, frameGrid, writeFrameColors } from '../frames/frame-block.js';
import { adjustDepth, depthToGrid, grabFrame, lumaDepth, normalizeDepth } from '../input/depth-ai.js';

/** Раскадровка: кадры видео как пластины в облаке точек. Методы подмешиваются в EffectsEngine (см. engine/index.js). */
export class FramesPart {
	// ------------------------------------------------------------ раскадровка видео
	// Кадры лежат в одной текстуре на видеокарте (слой на кадр). Положения листов, показ, подсветка, шлейф и луч считаются
	// в шейдере по одному числу «текущий кадр», поэтому на каждый кадр процессор почти ничего не делает.
	/** Открыто видео (кадры можно брать, когда оно загружено) */
	get videoLoaded() {
		const pm = this.pm;
		return !!(pm && pm.ready && pm.kind === 'video' && pm.el);
	}

	get videoReady() {
		return this.videoLoaded && this.pm.el.readyState >= 2;
	}

	/** Номера раскладок для шейдера */
	_layoutId(name) {
		return Math.max(0, ['stack', 'wall', 'film', 'tunnel'].indexOf(name));
	}

	/** Снимок кадра видео в RGBA нужного размера: пишет прямо в out (кусок общего массива), лишних копий нет */
	_frameTaker(cols, rows, el) {
		const cv = document.createElement('canvas');
		cv.width = cols;
		cv.height = rows;
		const ctx = cv.getContext('2d', { willReadFrequently: true });
		return (out) => {
			ctx.drawImage(el || this.pm.el, 0, 0, cols, rows);
			out.set(ctx.getImageData(0, 0, cols, rows).data);
			return out;
		};
	}

	/** Второй, скрытый видеоэлемент с тем же файлом: кадры снимаются с него, а то, что вы смотрите и перематываете, не трогается */
	async _capVideo() {
		const src = this.pm.el.currentSrc || this.pm.el.src;
		const v = document.createElement('video');
		v.muted = true;
		v.playsInline = true;
		v.preload = 'auto';
		v.src = src;
		await new Promise((res, rej) => {
			v.onloadeddata = res;
			v.onerror = () => rej(new Error('не удалось открыть видео для съёмки кадров'));
			setTimeout(res, 8000);
		});
		return v;
	}

	_seekTo(el, t) {
		return new Promise((res) => {
			if (Math.abs(el.currentTime - t) < 0.02 && el.readyState >= 2) return res();
			const done = () => {
				el.removeEventListener('seeked', done);
				clearTimeout(to);
				res();
			};
			const to = setTimeout(done, 900);
			el.addEventListener('seeked', done);
			el.currentTime = t;
		});
	}

	/** Снимает n кадров видео в заданном разрешении со скрытой копии (для экспорта): возвращает массив RGBA */
	async captureFramesForExport(n, cols, rows, onProgress) {
		const cap = await this._capVideo();
		try {
			const take = this._frameTaker(cols, rows, cap);
			const dur = cap.duration || this.pm.el.duration || 1;
			const out = [];
			for (let k = 0; k < n; k++) {
				await this._seekTo(cap, Math.min(Math.max(0.05, dur - 0.04), (k / Math.max(1, n - 1)) * dur));
				out.push(take(new Uint8Array(cols * rows * 4)));
				onProgress && onProgress((k + 1) / n);
			}
			return out;
		} finally {
			cap.removeAttribute('src');
			cap.load();
		}
	}

	/** Строка состояния съёмки в углу сцены (пока кадры доснимаются в фоне) */
	_capStatus(text) {
		if (!text) {
			this._capEl?.remove();
			this._capEl = null;
			return;
		}
		if (!this._capEl) {
			this._capEl = document.createElement('div');
			this._capEl.className = 'fx-cap';
			document.getElementById('viewport')?.append(this._capEl);
		}
		this._capEl.textContent = text;
	}

	/** Снимает указанные кадры со скрытого видео и сразу кладёт в слои общего массива */
	async _captureList(fr, list, onEach) {
		const take = (fr.take ||= this._frameTaker(fr.cols, fr.rows, fr.cap));
		for (const k of list) {
			if (fr.dead) return false;
			await this._seekTo(fr.cap, fr.times[k]);
			if (fr.dead) return false;
			take(fr.frames[k]);
			fr.dOk[k] = 0;
			fr.dIdle = false;
			this._frDepthOne(fr, k);
			fr.done[k] = 1;
			onEach && onEach(k);
		}
		return true;
	}

	/** Незаснятые пока слои временно заполняются ближайшим снятым кадром: блок сразу целый, потом кадры уточняются */
	_fillGaps(fr) {
		const have = [];
		for (let k = 0; k < fr.n; k++) if (fr.done[k]) have.push(k);
		if (!have.length) return;
		for (let k = 0; k < fr.n; k++) {
			if (fr.done[k]) continue;
			let best = have[0];
			for (const j of have) if (Math.abs(j - k) < Math.abs(best - k)) best = j;
			fr.frames[k].set(fr.frames[best]);
		}
	}

	/** Дальше кадры снимаются в фоне, от редких к частым; каждый сразу появляется в блоке */
	async _refineFrames(fr, order) {
		const tex = this._frameTex;
		let count = fr.done.reduce((a, b) => a + b, 0);
		let batch = 0;
		const flush = () => {
			if (!batch || fr.dead || this._frameTex !== tex) return;
			tex.needsUpdate = true;
			batch = 0;
		};
		const ok = await this._captureList(fr, order, (k) => {
			count++;
			tex.addLayerUpdate && tex.addLayerUpdate(k);
			if (++batch >= 6) flush();
			if (count % 4 === 0) this._capStatus(`Снимаю кадры: ${Math.round((count / fr.n) * 100)}%`);
		});
		flush();
		if (!fr.dead) this._capStatus('');
		this._closeCap(fr);
		
	}

	_closeCap(fr) {
		if (!fr?.cap) return;
		fr.cap.removeAttribute('src');
		fr.cap.load();
		fr.cap = null;
		fr.take = null;
	}

	/** Общий массив кадров превращается в текстуру-массив: слой на кадр */
	_makeFrameTexture(data, cols, rows, n) {
		const tex = new THREE.DataArrayTexture(data, cols, rows, n);
		tex.format = THREE.RGBAFormat;
		tex.type = THREE.UnsignedByteType;
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.minFilter = tex.magFilter = THREE.NearestFilter;
		tex.generateMipmaps = false;
		tex.unpackAlignment = 1;
		tex.needsUpdate = true;
		return tex;
	}

	/** Выставляет параметры блока в шейдер (размер, раскладка, глубина) */
	_frameUniforms() {
		const fr = this._frames;
		const F = this.state.layers.frames;
		const u = this.shared;
		if (!fr) return;
		// материал точек пересоздаётся при смене источника и приносит заглушку вместо текстуры кадров: возвращаем настоящую
		if (this._frameTex && u.uFrTex.value !== this._frameTex) u.uFrTex.value = this._frameTex;
		const W = fr.aspect >= 1 ? 2.2 : 2.2 * fr.aspect;
		u.uFr.value.set(1, fr.n, fr.cols * fr.rows, fr.cols * fr.rows * fr.n);
		u.uFr2.value.set(fr.cols, fr.rows, W, W / fr.aspect);
		u.uFr3.value.x = F.depth;
		// после пересоздания материала раскладка в шейдере сбрасывается: возвращаем текущую
		if (!this._layoutAnim) u.uFr3.value.set(F.depth, this._layoutCur ?? 0, this._layoutCur ?? 0, 0);
	}

	/** Блок кадров: снимаем кадры, кладём в текстуру и показываем (точки перетекают из текущей формы) */
	async enableFrames() {
		if (this._framesBusy || !this.videoReady || !this.active) return;
		this._framesBusy = true;
		const F = this.state.layers.frames;
		try {
			this.app.ui.busy('Раскладываю видео на кадры', 0.05);
			const pm = this.pm;
			const aspect = (pm.el.videoWidth || 16) / (pm.el.videoHeight || 9);
			const dur = pm.el.duration || pm.duration || 1;
			const n = F.source === 'whole' && F.all === 'on' ? Math.max(4, Math.min(240, Math.round(dur * 24))) : Math.round(F.frames);
			const { cols, rows } = frameGrid(Math.max(300, F.budget / n), aspect);
			if (this._frames) {
				this._frames.dead = true;
				this._closeCap(this._frames);
			}
			const per = cols * rows * 4;
			// все кадры лежат в одном массиве (он же уходит в текстуру), у каждого кадра только ссылка на свой кусок
			const data = new Uint8Array(per * n);
			const frames = Array.from({ length: n }, (_, k) => data.subarray(k * per, (k + 1) * per));
			// dAi, dOk: глубина кадров от нейросети и отметки «посчитано» (по слою текстуры); dSig: с какими настройками записан альфа-канал
			const fr = { frames, cols, rows, aspect, last: this._time, n, dur, head: 0, gain: 1, ts: null, done: new Uint8Array(n), times: null, cap: null, take: null, dead: false, dAi: null, dOk: new Uint8Array(n), dSig: this._frDepthSig(), dJob: false };
			let refine = null;
			if (F.source === 'whole') {
				fr.times = Array.from({ length: n }, (_, k) => Math.min(Math.max(0.05, dur - 0.04), (k / Math.max(1, n - 1)) * dur));
				fr.cap = await this._capVideo();
				// сначала редкие кадры (быстро, блок появляется сразу), остальное доснимается в фоне
				let step = 1;
				while (step * 2 <= Math.max(1, n / 12)) step *= 2;
				const first = [];
				const rest = [];
				const seen = new Set();
				const add = (k, arr) => {
					if (!seen.has(k)) {
						seen.add(k);
						arr.push(k);
					}
				};
				for (let k = 0; k < n; k += step) add(k, first);
				add(n - 1, first);
				for (let st = Math.floor(step / 2); st >= 1; st = Math.floor(st / 2)) for (let k = 0; k < n; k += st) add(k, rest);
				let got = 0;
				const ok = await this._captureList(fr, first, () => this.app.ui.busy('Раскладываю видео на кадры', 0.1 + 0.8 * (++got / first.length)));
				if (!ok || !F.on || !this.active) {
					fr.dead = true;
					this._closeCap(fr);
					return;
				}
				this._fillGaps(fr);
				refine = rest;
			} else {
				// бегущая лента начинается пустой и заполняется по ходу видео
				this._frameTaker(cols, rows)(frames[n - 1]);
				this._frDepthOne(fr, n - 1);
				fr.done[n - 1] = 1;
			}
			if (!F.on || !this.active) {
				fr.dead = true;
				this._closeCap(fr);
				return;
			}
			fr.gain = 1;
			this._frameTex?.dispose();
			this._frameTex = this._makeFrameTexture(data, cols, rows, n);
			this.shared.uFrTex.value = this._frameTex;
			this._frames = fr;
			if (F.source === 'live') {
				// время видео, с которого снят каждый слой ленты: по нему перемотка таймлайна двигает видео вдоль ленты
				fr.ts = new Float32Array(n).fill(-1);
				fr.ts[n - 1] = pm.el.currentTime || 0;
				fr.tNew = pm.el.currentTime || 0;
			}
			// положения точек для переходов: считаем один раз, цвета не нужны (они в текстуре)
			this._frameCloud = buildFrameBlock(frames.map(() => this._blankFrame(cols, rows)), cols, rows, aspect, F.layout, F.depth, true);
			this._framesOn = true;
			this._layoutCur = this._layoutId(F.layout);
			this.shared.uFr3.value.set(F.depth, this._layoutCur, this._layoutCur, 0);
			this.cache.clear();
			this.state.look.colorBy = 'model';
			await this.setSource('frames');
			this._frameUniforms();
			this.shared.uFr5.value.x = 0;
			this._framesFit();
			if (refine) this._refineFrames(fr, refine);
		} catch (e) {
			console.error(e);
			this.app.toast('Не удалось разложить видео на кадры: ' + (e.message || e), 'error');
			F.on = false;
			this.shared.uFr.value.x = 0;
		} finally {
			this.app.ui.idle();
			this._framesBusy = false;
			this.emit();
		}
	}

	_blankFrame(cols, rows) {
		return (this._blank ||= new Uint8Array(cols * rows * 4));
	}

	async disableFrames() {
		if (!this._framesOn || this._framesBusy) return;
		const fr = this._frames;
		if (fr) {
			fr.dead = true;
			this._closeCap(fr);
		}
		this._capStatus('');
		// перед уходом переносим видимые цвета в атрибуты точек: дальше переход идёт обычным путём
		const g = this.geometry;
		if (fr && g && g.attributes.aColor && g.attributes.aColor.count === fr.cols * fr.rows * fr.n) {
			writeFrameColors(fr.frames, fr.cols, fr.rows, g.attributes.aColor.array, null, 4);
			g.attributes.aColorB.array.set(g.attributes.aColor.array);
			g.attributes.aColor.needsUpdate = g.attributes.aColorB.needsUpdate = true;
		}
		this._framesOn = false;
		this.shared.uFr.value.x = 0;
		this.shared.uHero.value.w = 0;
		if (this.hero) this.hero.visible = false;
		this._frames = null;
		this._frameCloud = null;
		this._frameTex?.dispose();
		this._frameTex = null;
		await this.setSource(this.pm.ready ? 'media' : this.hasModel ? 'model' : 'sphere');
		this.emit();
	}

	/** Поменялось число кадров, точек или источник: кадры снимаем заново (с паузой, пока двигается ползунок) */
	rebuildFramesSoon() {
		clearTimeout(this._framesT);
		this._framesT = setTimeout(async () => {
			if (!this._framesOn || this._framesBusy) return;
			this._framesOn = false;
			this.shared.uFr.value.x = 0;
			await this.enableFrames();
		}, 450);
	}

	/** Подъезжаем камерой так, чтобы весь блок помещался в кадр (для каждой раскладки свой размер) */
	_framesFit() {
		const F = this.state.layers.frames;
		const fr = this._frames;
		const nav = this.app.nav;
		if (!fr || !nav) return;
		const W = fr.aspect >= 1 ? 2.2 : 2.2 * fr.aspect;
		const H = W / fr.aspect;
		const R = { stack: Math.hypot(W / 2, H / 2, F.depth / 2), tunnel: Math.hypot(W / 2, H / 2, F.depth / 2), wall: 1.45, film: W * 1.35 }[F.layout] ?? 2;
		nav.animateTo({ distance: nav.fitDistance(R * 0.85), target: new THREE.Vector3(0, 0, 0) }, 450);
	}

	/** Поменялась раскладка или глубина: шейдер плавно перестраивает листы, а положения для переходов обновляются в фоне */
	relayoutFrames() {
		const F = this.state.layers.frames;
		const fr = this._frames;
		if (!this._framesOn || !fr) return;
		const target = this._layoutId(F.layout);
		this.shared.uFr3.value.x = F.depth;
		if (target !== this._layoutCur && !this._layoutAnim) {
			this._framesFit();
			this.shared.uFr3.value.z = target;
			this._layoutAnim = { t0: this._time, target };
		}
		clearTimeout(this._relayT);
		this._relayT = setTimeout(() => {
			if (!this._framesOn || !this._frames) return;
			this._frameCloud = buildFrameBlock(fr.frames.map(() => this._blankFrame(fr.cols, fr.rows)), fr.cols, fr.rows, fr.aspect, F.layout, F.depth, true);
			const g = this.geometry;
			if (g && g.attributes.aOrigin && g.attributes.aOrigin.count === this._frameCloud.count && !this.morphing) {
				g.attributes.aOrigin.array.set(this._frameCloud.positions);
				g.attributes.aTarget.array.set(this._frameCloud.positions);
				g.attributes.aNormal.array.set(this._frameCloud.normals);
				g.attributes.aNormalB.array.set(this._frameCloud.normals);
				g.attributes.aOrigin.needsUpdate = g.attributes.aTarget.needsUpdate = g.attributes.aNormal.needsUpdate = g.attributes.aNormalB.needsUpdate = true;
			}
		}, 350);
	}

	/** Каждый кадр: следим за видео, ведём показ, двигаем бегущую ленту. Данные точек не трогаем, только числа для шейдера */
	_framesTick() {
		const F = this.state.layers.frames;
		// настройки из прошлых версий: исчезнувшие раскладки и режимы заменяем на ближайшие
		if (!['stack', 'wall', 'film', 'tunnel'].includes(F.layout)) F.layout = 'stack';
		if (!['off', 'peel', 'projector', 'trail'].includes(F.showMode)) F.showMode = 'off';
		F.follow = 'off';
		const wantOn = F.on && this.videoReady && this.state.source !== 'sphere';
		if (wantOn && !this._framesOn && !this._framesBusy) {
			this.enableFrames();
			return;
		}
		// выключаем только когда режим отключён или видео закрыли: во время перемотки видео ненадолго «не готово», и это не повод всё сбрасывать
		if (this._framesOn && !this._framesBusy && (!F.on || !this.videoLoaded)) {
			F.on = false;
			this.disableFrames();
			return;
		}
		const fr = this._frames;
		const u = this.shared;
		if (!this._framesOn || !fr) {
			u.uFr.value.x = 0;
			return;
		}
		// шейдер берёт положения и цвета из блока, когда источник это блок (во время перехода туда он тоже включён: цвета уже из текстуры)
		u.uFr.value.x = this.state.source === 'frames' ? 1 : 0;
		this._frameUniforms();
		// плавная смена раскладки
		const an = this._layoutAnim;
		if (an) {
			const k = Math.min(1, (this._time - an.t0) / 0.7);
			u.uFr3.value.w = k;
			if (k >= 1) {
				this._layoutCur = an.target;
				u.uFr3.value.set(F.depth, an.target, an.target, 0);
				this._layoutAnim = null;
			}
		}
		// текущий кадр (дробный, поэтому показ идёт плавно, а не шагами). Его задаёт видео: крутите таймлайн, и блок следует за ним
		const idx = F.source === 'live' ? this._liveIdx(fr) : Math.max(0, Math.min(1, (this.pm.el.currentTime || 0) / Math.max(0.1, fr.dur))) * (fr.n - 1);
		fr.cur = Math.round(idx);
		const modeId = { off: 0, peel: 1, projector: 4, trail: 5 }[F.showMode] ?? 0;
		u.uFr4.value.set(idx, modeId, F.showLen, F.thin ?? 0);
		// листы рядом друг с другом не перекрываются, их разреживать незачем
		u.uFr6.value.set(F.bsize ?? 1.5, F.track === 'full' && F.source === 'whole' ? 1 : 0, { all: 0, light: 1, dark: 2 }[F.tone] ?? 0, F.toneCut ?? 0.5);
		u.uFr7.value.set(Math.max(0.05, (F.tail ?? 100) / 100), F.sat ?? 0, F.tailSoft ?? 0.6, 0);
		u.uFr5.value.y = 0;
		u.uFr5.value.z = { show: 0, dim: 1, hide: 2 }[F.future] ?? 1;
		u.uFr5.value.w = (fr.gain || 1) * (F.gain ?? 1);
		u.uFr7.value.w = F.dkeep ?? 0.5;
		this._ensureHero(F, fr);
		this._framesFollow(F, fr);
		if (F.source === 'live') this._framesLive(F, fr);
		this._framesDepthTick(fr);
	}

	// ------------------------------------------------------------ глубина кадров («Объём по глубине» поверх раскадровки)
	// Карта глубины каждого кадра лежит в альфа-канале его слоя текстуры (0 далеко, 255 близко): шейдер берёт её вместе с цветом.
	// По яркости она пишется сразу при съёмке кадра, нейросеть уточняет кадры в фоне, начиная с ближайших к текущему.

	/** С какими настройками записан альфа-канал: при их смене кадры переписываются */
	_frDepthSig() {
		const Dp = this.state.layers.depth;
		return Dp.src + '|' + Math.round(Dp.blur || 0) + '|' + (Dp.src === 'file' ? this._depthFile?.id || 0 : 0);
	}

	/** Записывает глубину одного кадра (слоя) в альфа-канал: от нейросети, если она уже посчитала этот кадр, иначе по яркости */
	_frDepthOne(fr, k) {
		const Dp = this.state.layers.depth;
		const { cols, rows } = fr;
		const per = cols * rows;
		const f = fr.frames[k];
		let map;
		const file = Dp.src === 'file' ? this._depthFile : null;
		if (file) {
			// своя карта одна на все кадры: переносим её на сетку кадра один раз
			if (fr.dFileId !== file.id) {
				fr.dFile = new Float32Array(per);
				depthToGrid(file, cols, rows, fr.dFile);
				fr.dFileId = file.id;
			}
			map = { w: cols, h: rows, data: fr.dFile };
		} else map = Dp.src === 'ai' && fr.dOk[k] && fr.dAi ? { w: cols, h: rows, data: fr.dAi.subarray(k * per, (k + 1) * per) } : lumaDepth(f, cols, rows, 4);
		// размытие задано в пикселях большой карты, сетка кадра в несколько раз мельче
		const r = Math.round((Dp.blur || 0) * 0.4);
		if (r > 0) map = adjustDepth(map, { blur: r });
		const d = map.data;
		for (let i = 0; i < per; i++) f[i * 4 + 3] = (d[i] * 255 + 0.5) | 0;
	}

	/** Переписывает глубину всех кадров и отправляет текстуру целиком */
	_frDepthAll(fr) {
		const tex = this._frameTex;
		for (let k = 0; k < fr.n; k++) {
			this._frDepthOne(fr, k);
			tex?.addLayerUpdate?.(k);
		}
		if (tex) tex.needsUpdate = true;
	}

	/** Каждый кадр: смена источника глубины или размытия переписывает кадры, нейросеть доснимает глубину в фоне */
	_framesDepthTick(fr) {
		const Dp = this.state.layers.depth;
		if (!Dp.on) return;
		const sig = this._frDepthSig();
		if (fr.dSig !== sig) {
			fr.dSig = sig;
			this._frDepthAll(fr);
			this._depthEmit();
		}
		// превью карты в панели идёт за текущим кадром
		if (fr.dShown !== fr.cur) {
			fr.dShown = fr.cur;
			this._depthEmit();
		}
		// dIdle: все кадры уже посчитаны (новые сбросят отметку), dRetry: после сбоя пауза, а не новая попытка на каждом кадре
		if (Dp.src === 'ai' && !fr.dJob && !fr.dIdle && this.depthAI.phase !== 'error' && this._time > (fr.dRetry || 0)) this._frDepthAI(fr);
	}

	/** Время видео, с которого снят слой (у бегущей ленты слой может быть ещё пустым: тогда -1) */
	_frLayerTime(fr, k) {
		return fr.ts ? fr.ts[k] : fr.times ? fr.times[k] : -1;
	}

	/** Фоновый расчёт глубины кадров нейросетью: кадр снимается со скрытой копии видео в хорошем разрешении, ближайшие к текущему первыми */
	async _frDepthAI(fr) {
		fr.dJob = true;
		const per = fr.cols * fr.rows;
		const st = {};
		let cap = null;
		try {
			await this.depthAI.init();
			cap = await this._capVideo();
			fr.dAi ||= new Float32Array(fr.n * per);
			const alive = () => !fr.dead && this._frames === fr && this.active && this.state.layers.depth.on && this.state.layers.depth.src === 'ai';
			while (alive()) {
				const now = this.pm.el?.currentTime || 0;
				let best = -1;
				let bd = Infinity;
				for (let k = 0; k < fr.n; k++) {
					const t = this._frLayerTime(fr, k);
					if (fr.dOk[k] || t < 0 || (fr.done && !fr.done[k] && !fr.ts)) continue;
					const d = Math.abs(t - now);
					if (d < bd) {
						bd = d;
						best = k;
					}
				}
				if (best < 0) {
					// всё видео посчитано (пока кадры доснимаются, ждём их); бегущая лента ждёт новых кадров
					if (!fr.ts && fr.done.every((x) => x)) {
						fr.dIdle = true;
						break;
					}
					await new Promise((r) => setTimeout(r, 300));
					continue;
				}
				const t = this._frLayerTime(fr, best);
				await this._seekTo(cap, t);
				if (!alive()) break;
				const side = this.depthAI.device === 'wasm' ? 280 : 448;
				const img = grabFrame(cap, side);
				if (!img) break;
				const r = await this.depthAI.estimate(img);
				// у бегущей ленты слой мог за это время перезаписаться новым кадром: тогда результат уже не про него
				if (!alive() || this._frLayerTime(fr, best) !== t) continue;
				const map = { w: r.w, h: r.h, data: normalizeDepth(r.data, st, st.init ? 0.35 : 0) };
				depthToGrid(map, fr.cols, fr.rows, fr.dAi.subarray(best * per, (best + 1) * per));
				fr.dOk[best] = 1;
				this._frDepthOne(fr, best);
				const tex = this._frameTex;
				if (tex) {
					tex.addLayerUpdate?.(best);
					tex.needsUpdate = true;
				}
				this._depthEmit();
			}
		} catch (e) {
			this._D.err = e.message || String(e);
			fr.dRetry = this._time + 5;
			this._depthEmit();
		} finally {
			if (cap) {
				cap.removeAttribute('src');
				cap.load();
			}
			fr.dJob = false;
		}
	}

	/** Сколько кадров раскадровки уже с глубиной от нейросети */
	_frDepthCount() {
		const fr = this._frames;
		if (!fr) return [0, 0];
		let ok = 0;
		let all = 0;
		for (let k = 0; k < fr.n; k++) {
			if (this._frLayerTime(fr, k) < 0) continue;
			all++;
			if (fr.dOk[k]) ok++;
		}
		return [ok, all];
	}

	/** Карта глубины текущего кадра раскадровки (для превью в панели) */
	_frDepthMap() {
		const fr = this._frames;
		if (!fr || !this._framesOn) return null;
		const k = clamp(fr.cur ?? 0, 0, fr.n - 1);
		const layer = (k + (fr.ts ? fr.head : 0)) % fr.n;
		const f = fr.frames[layer];
		const per = fr.cols * fr.rows;
		const data = new Float32Array(per);
		for (let i = 0; i < per; i++) data[i] = f[i * 4 + 3] / 255;
		// яркость, контраст и тени шейдер применяет сам: на превью то же, что на точках
		const Dp = this.state.layers.depth;
		return adjustDepth({ w: fr.cols, h: fr.rows, data }, { bright: Dp.bright, contrast: Dp.contrast, gamma: Dp.gamma });
	}

	/** Где на ленте текущее время видео: от начала ленты до её конца, дробное число между соседними кадрами */
	_liveIdx(fr) {
		const t = this.pm.el.currentTime || 0;
		if (!fr.ts || t >= fr.tNew) return fr.n - 1;
		let first = -1;
		let prev = -1;
		let tp = 0;
		for (let k = 0; k < fr.n; k++) {
			const tk = fr.ts[(k + fr.head) % fr.n];
			if (tk < 0) continue;
			if (first < 0) {
				first = k;
				if (t <= tk) return k;
			} else if (t <= tk) {
				return prev + (tk > tp ? (t - tp) / (tk - tp) : 0);
			}
			prev = k;
			tp = tk;
		}
		return fr.n - 1;
	}

	/** Густой текущий кадр: отдельный набор точек с тем же шейдером, цвет берётся прямо из видео */
	_ensureHero(F, fr) {
		const u = this.shared;
		const want = this.state.source === 'frames' && F.hero >= 5000 && this.points && !this.morphing;
		const has = this.hero && this.hero.parent === this.points;
		if (!want) {
			if (this.hero) this.hero.visible = false;
			u.uHero.value.w = 0;
			return;
		}
		const cols = Math.max(8, Math.round(Math.sqrt(F.hero * fr.aspect)));
		const rows = Math.max(8, Math.round(cols / fr.aspect));
		const count = cols * rows;
		if (!has || this._heroCount !== count) {
			if (this.hero) {
				this.hero.parent?.remove(this.hero);
				this.hero.geometry.dispose();
				this.hero.material.dispose();
				this.hero = null;
			}
			const g = new THREE.BufferGeometry();
			const z3 = () => new THREE.BufferAttribute(new Float32Array(count * 3), 3);
			const idxA = new Float32Array(count);
			for (let i = 0; i < count; i++) idxA[i] = i / count;
			g.setAttribute('position', z3());
			g.setAttribute('aOrigin', z3());
			g.setAttribute('aTarget', z3());
			g.setAttribute('aColor', z3());
			g.setAttribute('aColorB', z3());
			g.setAttribute('aSculpt', z3());
			const nrm = new Float32Array(count * 3);
			for (let i = 2; i < nrm.length; i += 3) nrm[i] = 1;
			g.setAttribute('aNormal', new THREE.BufferAttribute(nrm, 3));
			g.setAttribute('aNormalB', new THREE.BufferAttribute(nrm.slice(), 3));
			g.setAttribute('aPaint', new THREE.BufferAttribute(new Float32Array(count * 4), 4));
			g.setAttribute('aIdx', new THREE.BufferAttribute(idxA, 1));
			g.setAttribute('aHide', new THREE.BufferAttribute(new Float32Array(count), 1));
			g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(count).fill(0.5), 1));
			g.setAttribute('aPath', new THREE.BufferAttribute(new Float32Array(count), 1));
			g.setAttribute('aVis', new THREE.BufferAttribute(new Float32Array(count * 2).fill(1), 2));
			const m = new THREE.ShaderMaterial({
				vertexShader: this.material.vertexShader,
				fragmentShader: this.material.fragmentShader,
				transparent: this.material.transparent,
				depthWrite: this.material.depthWrite,
				blending: this.material.blending,
				defines: { HERO: 1 },
				userData: { fxKind: 'vert' },
				uniforms: { ...this.shared, uTOff: { value: 0 }, uGhost: { value: 1 } },
			});
			const h = new THREE.Points(g, m);
			h.frustumCulled = false;
			h.userData.helper = true;
			this.points.add(h);
			this.hero = h;
			this._heroCount = count;
		}
		if (!this._heroTex || this._heroTex.image !== this.pm.el) {
			this._heroTex?.dispose();
			this._heroTex = new THREE.VideoTexture(this.pm.el);
			this._heroTex.colorSpace = THREE.SRGBColorSpace;
			this._heroTex.minFilter = this._heroTex.magFilter = THREE.LinearFilter;
			this._heroTex.generateMipmaps = false;
		}
		u.uHeroTex.value = this._heroTex;
		u.uHero.value.set(cols, rows, count, 1);
		this.hero.visible = true;
		// материал главного кадра следует за основным (режим смешивания, размер, плотность)
		this.hero.material.blending = this.material.blending;
	}

	/** Следить за кадром: блок едет или поворачивается так, чтобы текущий кадр оказывался перед зрителем */
	_framesFollow(F, fr) {
		const pts = this.points;
		if (!pts || this.morphing || this.state.source !== 'frames') return;
		if (F.follow === 'on' && F.source === 'whole') {
			const idx = fr.cur;
			const t = fr.n > 1 ? idx / (fr.n - 1) : 0.5;
			const ease = 0.16;
			if (F.layout === 'stack') pts.position.z += ((0.5 - t) * F.depth - pts.position.z) * ease;
			else if (F.layout === 'spiral') pts.position.y += ((0.5 - t) * F.depth * 1.4 - pts.position.y) * ease;
			if ((F.layout === 'carousel' || F.layout === 'spiral') && !this.state.look.autoRotate) {
				let d = -((idx / fr.n) * Math.PI * 2) - pts.rotation.y;
				d = Math.atan2(Math.sin(d), Math.cos(d));
				pts.rotation.y += d * ease;
			}
			this._followed = true;
			pts.updateMatrixWorld();
		} else if (this._followed) {
			pts.position.set(0, 0, 0);
			this._followed = false;
			pts.updateMatrixWorld();
		}
	}

	/** Бегущая лента: новый кадр пишется в один слой текстуры, старые не трогаются; голова буфера сдвигается */
	_framesLive(F, fr) {
		const tv = this.pm.el.currentTime || 0;
		const lastTv = this._liveTv ?? tv;
		this._liveTv = tv;
		if (fr.ts && this.pm.playing) {
			let oldest = Infinity;
			for (const t of fr.ts) if (t >= 0 && t < oldest) oldest = t;
			// видео зациклилось или его перемотали за начало ленты: это новый проход, прежние кадры остаются как прошлое, но запись продолжается
			if (tv < lastTv - 1 && tv < 1.5 || tv < oldest - 0.3) {
				fr.ts.fill(-1);
				fr.tNew = tv - 0.05;
			}
		}
		// пока видео перемотано назад, в прошлые кадры ленты ничего не пишем: лента пополняется только когда видео идёт дальше её конца
		if (this._time - fr.last < F.step || !this.pm.playing || this.morphing || tv <= fr.tNew + 0.02 || !fr.ts) return;
		fr.last = this._time;
		const take = (fr.take ||= this._frameTaker(fr.cols, fr.rows));
		const layer = fr.head % fr.n;
		const tex = this._frameTex;
		take(fr.frames[layer]);
		fr.dOk[layer] = 0;
		this._frDepthOne(fr, layer);
		tex.addLayerUpdate && tex.addLayerUpdate(layer);
		tex.needsUpdate = true;
		fr.ts[layer] = tv;
		fr.tNew = tv;
		fr.head++;
		this.shared.uFr5.value.x = fr.head % fr.n;
	}

	/** Случайное место на текущем кадре блока раскадровки (в координатах облака): для рамок трекинга. Повторяет расстановку кадров из шейдера */
	_frameSample() {
		const u = this.shared;
		const n = u.uFr.value.y;
		const W = u.uFr2.value.z, H = u.uFr2.value.w;
		const idx = u.uFr4.value.x;
		const k = clamp(Math.round(idx), 0, Math.max(0, n - 1));
		const depth = u.uFr3.value.x;
		const uu = (Math.random() - 0.5) * 0.9, vv = (Math.random() - 0.5) * 0.9;
		const dz = u.uFr4.value.y > 0.5 && u.uFr4.value.y < 1.5 ? -1 : 1;
		const cen = u.uFr6.value.y > 0.5 ? (n - 1) * 0.5 : idx;
		const place = (lay) => {
			if (lay > 0.5 && lay < 1.5) {
				const gx = Math.ceil(Math.sqrt(n * (W / H)));
				const gy = Math.ceil(n / gx);
				const s = Math.min(2.4 / (gx * W), 2.4 / (gy * H));
				return new THREE.Vector3((k % gx - (gx - 1) * 0.5) * W * s * 1.04 + uu * W * s, ((gy - 1) * 0.5 - Math.floor(k / gx)) * H * s * 1.04 + vv * H * s, 0);
			}
			if (lay > 1.5 && lay < 2.5) return new THREE.Vector3(uu * W, vv * H, 0);
			return new THREE.Vector3(uu * W, vv * H, ((idx - cen) * depth) / Math.max(n - 1, 1) * dz);
		};
		const a = place(u.uFr3.value.y);
		const w = u.uFr3.value.w;
		if (w > 0.0001) {
			const m = w * w * (3 - 2 * w);
			a.lerp(place(u.uFr3.value.z), m);
		}
		return a;
	}
}
