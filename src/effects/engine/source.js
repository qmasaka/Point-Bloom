import * as THREE from 'three';
import { fitCount, normalizeCloud, shuffleCloud } from '../shapes/cloud-utils.js';
import { generateShapePoints } from '../shapes/shapes.js';
import { depthToGrid, grabFrame, lumaDepth, normalizeDepth } from '../input/depth-ai.js';

/** Источник облака точек: модель, фото, видео, формы, морфинг, число частиц. Методы подмешиваются в EffectsEngine (см. engine/index.js). */
export class SourcePart {
	// ------------------------------------------------------------ фото и видео
	/** Загруженное в «Медиа» фото или видео становится источником «Фото» */
	async useMedia() {
		this.state.look.colorBy = 'model';
		// стартовые вихри и пульс портят картинку: выключаем, включить можно слева
		for (const id of ['curl', 'blast']) this.state.layers[id].on = false;
		const mkey = this.app.media.activeKey();
		this.app.media.passSound(null);
		this.curKey = mkey;
		if (this.state.source === 'media') {
			this.cache.clear();
			await this._build();
		} else await this.setSource(mkey);
		// картинка должна смотреть на зрителя, а не крутиться ребром
		this.state.look.autoRotate = false;
		if (this.points) this.points.rotation.set(0, 0, 0);
		this.emit();
	}

	async setMediaPts(n) {
		this.app.settings.media.pts = n;
		this.app.saveSettings();
		if (this.state.source === 'media' && this.active && !this.pm.isRec) {
			this.cache.clear();
			await this._build();
		}
		this.emit();
	}

	// ------------------------------------------------------------ морфинг между формами
	/** Список доступных форм: встроенные фигуры и объекты сцены редактора */
	forms() {
		const out = [];
		for (const o of this.modelProvider?.objects() || []) out.push({ key: 'obj:' + o.id, name: o.name, icon: 'cube' });
		return out;
	}

	/** Все формы, между которыми можно делать морфинг: объекты сцены, открытое видео или фото и готовые фигуры */
	uiForms() {
		const out = this.forms().map((f) => ({ ...f, group: 'scene' }));
		for (const e of this.app.media.lib) {
			if (!e.pm.ready) continue;
			out.push({ key: e.id, name: e.pm.name || (e.pm.kind === 'image' ? 'Фото' : 'Видео'), icon: e.pm.kind === 'image' ? 'image' : 'film-strip', group: 'scene' });
		}
		return out;
	}

	/** Доля видимых точек у формы: у модели с меньшим числом точек видна только их часть */
	_fracFor(key) {
		if (!key.startsWith('obj:') || this.state.morphCfg.weight === 'equal') return 1;
		const mp = this.modelProvider;
		const sizeOf = (k) => {
			const o = mp?.objects().find((x) => 'obj:' + x.id === k);
			return o && mp.sizeOf ? mp.sizeOf(o.obj) : 0;
		};
		const keys = new Set([...(this.playlist || []), key]);
		let mx = 0;
		for (const k of keys) if (k.startsWith('obj:')) mx = Math.max(mx, sizeOf(k));
		const mine = sizeOf(key);
		return mx > 0 && mine > 0 ? Math.max(0.08, Math.min(1, mine / mx)) : 1;
	}

	setPlaylist(keys) {
		this.playlist = keys;
		this._pi = Math.max(-1, keys.indexOf(this.curKey || this.state.source));
		this.emit();
		this._syncMorphCount().then(() => this._prefetch(keys));
	}

	/** Видео вошло в список морфинга или вышло из него: у облака меняется число точек, поэтому один раз собираем его заново */
	async _syncMorphCount() {
		if (!this.active || !this.geometry || this.morphing) return;
		if (this.geometry.attributes.position.count === this._n()) return;
		this.app.ui.busy('Готовлю формы к морфингу', 0.2);
		try {
			await this._build();
		} catch (e) {
			console.error(e);
		} finally {
			this.app.ui.idle();
		}
		this.emit();
	}

	/** Номер следующей формы в списке по выбранному порядку: по кругу, туда и обратно или случайно */
	_pickNext() {
		const list = this.playlist || [];
		const order = this.state.morphCfg.order;
		if (order === 'random') {
			let i;
			do i = Math.floor(Math.random() * list.length);
			while (i === this._pi && list.length > 1);
			return i;
		}
		if (order === 'pingpong') {
			// вперёд до конца списка, потом назад до начала
			let d = this._pd || 1;
			let j = (this._pi ?? -1) + d;
			if (j >= list.length || j < 0) {
				d = -d;
				j = (this._pi ?? 0) + d;
			}
			this._pd = d;
			return Math.max(0, Math.min(list.length - 1, j));
		}
		return ((this._pi ?? -1) + 1) % list.length;
	}

	morphNext() {
		const list = this.playlist || [];
		if (this._morphHold) {
			// переход стоит на ползунке: кнопка доводит его до конца
			this._morphHold = false;
			return;
		}
		if (list.length < 2 || !this.active || this.morphing) return;
		const i = this._pickNext();
		this._pi = i;
		this._lastMorph = this._time;
		this.setSource(list[i]).catch(() => {});
	}

	/** Переход к выбранной форме прямо сейчас, в какой бы последовательности она ни стояла */
	morphTo(key) {
		if (this._morphHold) {
			this._morphHold = false;
			return;
		}
		if (!this.active || this.morphing || !key) return;
		if (key === (this.curKey || this.state.source)) return;
		const list = this.playlist || [];
		const i = list.indexOf(key);
		if (i >= 0) this._pi = i;
		this._lastMorph = this._time;
		this.setSource(key).catch(() => {});
	}

	/**
	 * Переход вручную: ползунок ведёт форму от текущей к следующей в списке. Пока ползунок не вернулся на ноль, переход стоит там, где его оставили,
	 * на 100% он завершается. Форма посередине это живое состояние: обе модели вперемешку.
	 */
	async morphScrub(v) {
		v = Math.max(0, Math.min(1, v));
		this._scrubV = v;
		if (!this.active || !this.geometry) return;
		if (!this._morphHold) {
			const list = this.playlist || [];
			if (list.length < 2 || this.morphing || this._scrubBusy || v <= 0) return;
			this._scrubBusy = true;
			const next = list[this._pickNext()];
			this._morphHold = true;
			try {
				await this.setSource(next);
				this._pi = Math.max(0, list.indexOf(next));
			} finally {
				this._scrubBusy = false;
			}
			if (!this.morphing) {
				this._morphHold = false;
				return;
			}
		}
		this.morph = this._scrubV;
		if (this.morph >= 1) this._morphHold = false; // дальше обычный конец перехода
	}

	/** Ползунок перехода отпущен: до конца дотягивается, если ушёл за половину, и стоит на месте, если нет */
	morphScrubEnd() {
		if (this._morphHold && this.morph > 0.5) this._morphHold = false;
	}

	toggleDissolve() {
		this._disTarget = !this._disTarget;
		this.state.layers.dissolve.on = true;
		if (this.state.layers.dissolve.mode !== 'button') this.state.layers.dissolve.mode = 'button';
		this.emit();
	}

	get hasModel() {
		return !!(this.modelProvider && this.modelProvider.available());
	}

	async _cloudFor(key) {
		if (key === 'frames') return this._frameCloud || null;
		if (key === 'media' || key.startsWith('media:')) {
			const pm = this.app.media.entry(key)?.pm;
			if (!pm || !pm.ready) return null;
			this.app.media.applyGrid(pm);
			const m = this.app.settings.media;
			pm.dirty = true;
			return pm.buildCloud(pm.sample(), m.relief, m.depth);
		}
		const n = this._n();
		const ck = key + ':' + n;
		if (this.cache.has(ck)) return this.cache.get(ck);
		// один и тот же расчёт не запускаем дважды (предзагрузка и нажатие кнопки)
		const pend = (this._pend ||= new Map());
		if (pend.has(ck)) return pend.get(ck);
		const job = (async () => {
			let c;
			if (key === 'model') {
				c = this.modelProvider ? await this.modelProvider.get(n) : null;
				if (!c) return null;
				c = shuffleCloud(fitCount(normalizeCloud(c), n));
			} else if (key.startsWith('obj:')) {
				const o = this.modelProvider?.objects().find((x) => x.id === key.slice(4));
				c = o ? await this.modelProvider.getOf(o.obj, n) : null;
				if (!c || !c.count) return null;
				c = shuffleCloud(fitCount(normalizeCloud(c), n));
			} else {
				c = generateShapePoints(key, n);
			}
			this.cache.set(ck, c);
			return c;
		})();
		pend.set(ck, job);
		try {
			return await job;
		} finally {
			pend.delete(ck);
		}
	}

	/** Заранее готовит облака точек выбранных моделей, чтобы переход стартовал сразу, а не после паузы на расчёт */
	async _prefetch(keys) {
		const token = (this._pfT = (this._pfT || 0) + 1);
		for (const k of keys || []) {
			if (token !== this._pfT || !this.active) return;
			this._quiet = true;
			try {
				await this._cloudFor(k);
			} catch (e) {
				/* не критично: посчитаем при запуске */
			} finally {
				this._quiet = false;
			}
			await new Promise((r) => setTimeout(r, 30));
		}
	}

	/**
	 * Морфинг под музыку. «Скачок»: когда выбранная полоса частот выше порога, форма переходит к следующей (не чаще, чем раз в «паузу»).
	 * «Плавно»: форма идёт за громкостью, как ползунок: тихо это прежняя форма, громко это следующая. Дошла до конца: форма закрепляется,
	 * и после тишины (громкость упала) начинается путь к следующей.
	 */
	_morphMusicTick(dt) {
		const mc = this.state.morphCfg;
		// старое значение «По биту» теперь это «По музыке» с полосой «Удар»
		if (mc.mode === 'beat') Object.assign(mc, { mode: 'music', band: 'beat', amode: 'gate' });
		const S = (this._mf ||= { open: false, p: 0, holding: false, busy: false, cool: false });
		const on = mc.mode === 'music' && mc.band !== 'none' && this.active && (this.playlist?.length || 0) >= 2;
		if (!on || mc.amode !== 'amp') {
			// плавное следование выключили: начатый переход доезжает до конца сам
			if (S.holding) {
				S.holding = false;
				if (this._morphHold) this._morphHold = false;
			}
			S.p = 0;
		}
		if (!on) return;
		const v = this.soundActive ? this._bandLevel(mc) : 0;
		if (mc.amode !== 'amp') {
			const hot = v > mc.thr;
			const rise = hot && !S.open;
			S.open = S.open ? v > mc.thr * 0.8 : hot;
			if (rise && !this.morphing && this._time - (this._lastMorph || 0) >= (mc.gap ?? 1)) this.morphNext();
			return;
		}
		// плавно: громкость, сглаженная по скорости отклика, становится ходом перехода
		const gain = 1 / Math.max(0.2, 1 - (mc.react ?? 0.6) * 0.8);
		const target = Math.max(0, Math.min(1, v * gain));
		const tc = Math.max(0.01, target > S.p ? mc.atk : mc.rel);
		S.p += (target - S.p) * (1 - Math.exp(-Math.min(dt, 0.1) / tc));
		if (!S.holding) {
			if (this.morphing) return;
			if (S.cool) {
				if (S.p < 0.15) S.cool = false;
				else return;
			}
			if (S.p > 0.06 && !S.busy) {
				S.busy = true;
				this.morphScrub(S.p)
					.then(() => {
						S.holding = !!(this._morphHold && this.morphing);
					})
					.catch(() => {})
					.finally(() => {
						S.busy = false;
					});
			}
			return;
		}
		if (!(this._morphHold && this.morphing)) {
			S.holding = false;
			return;
		}
		// ползунок «Вручную» тянут рукой: музыка ждёт, пока его отпустят
		if (this._scrubUser) return;
		this.morph = Math.min(1, S.p);
		if (S.p >= 0.985) {
			this._morphHold = false;
			this.morph = 1;
			S.holding = false;
			S.cool = true;
		}
	}

	/** Карта глубины для точек этого видео или фото (1 ближе всего): нейросетевая, если она уже построена для него, иначе быстрая по яркости */
	_mediaDepth(pm) {
		const D = this._D;
		const key = pm.rec || pm.el;
		let map = this.app.media.entry(pm)?.ai || null;
		if (!map && D && D.key === key && D.proc && D.mapSrc === 'ai') map = D.proc;
		if (!map) map = lumaDepth(pm.sample(), pm.cols, pm.rows);
		const out = new Float32Array(pm.count);
		depthToGrid(map, pm.cols, pm.rows, out);
		return out;
	}

	/**
	 * Карты глубины нейросетью для всех видео и фото из списка морфинга (для вида «Рельеф (нейросеть)» и порядка по глубине).
	 * Модель загружается один раз; у видео карта считается по текущему кадру. Пока нейросеть не готова, переход берёт глубину по яркости.
	 */
	async morphAIDepth({ quiet = false } = {}) {
		if (this._aiBusy) return;
		const mc = this.app.media;
		const list = (this.playlist || []).map((k) => mc.entry(k)).filter((e) => e && e.pm.ready && !e.pm.isRec && e.pm.el);
		if (!list.length) {
			if (!quiet) this.app.toast('Добавьте в морфинг видео или фото: глубина строится для них', 'info');
			return;
		}
		this._aiBusy = true;
		this._aiDone = 0;
		this._aiTotal = list.length;
		this._depthEmit();
		try {
			for (const e of list) {
				const frame = grabFrame(e.pm.el, e.pm.kind === 'video' ? 448 : 640);
				if (!frame) continue;
				const r = await this.depthAI.estimate(frame);
				e.ai = { w: r.w, h: r.h, data: normalizeDepth(r.data, {}, 0) };
				this._aiDone++;
				this._depthEmit();
			}
			if (!quiet) this.app.toast('Карта глубины готова: переход пойдёт по ней', 'ok');
		} catch (err) {
			this.app.toast('Нейросеть глубины не запустилась: ' + (err.message || err) + '. Переход возьмёт глубину по яркости', 'warn');
		} finally {
			this._aiBusy = false;
			this._depthEmit();
		}
	}

	/** Перед переходом, где есть видео или фото: порядок и выдавливание по глубине берут её из aDepth */
	_morphDepthSetup(outE, inE) {
		const mc = this.state.morphCfg;
		if (!outE && !inE) return;
		if (!(mc.sort === 'depthnear' || mc.sort === 'depthfar' || mc.style === 'relief' || (mc.lift || 0) > 0.001)) return;
		// «Рельеф» без готовой карты: в этот раз глубина по яркости, а нейросеть тем временем считает карту на следующие переходы
		if (mc.style === 'relief' && [outE, inE].some((e) => e && !e.ai)) this.morphAIDepth({ quiet: true });
		const a = this.geometry?.attributes.aDepth;
		if (!a) return;
		const parts = [outE, inE].filter((e) => e && e.pm.ready && e.pm.count === a.array.length).map((e) => this._mediaDepth(e.pm));
		if (!parts.length) return;
		for (let i = 0; i < a.array.length; i++) {
			let sum = 0;
			for (const p of parts) sum += p[i];
			a.array[i] = sum / parts.length;
		}
		a.needsUpdate = true;
	}

	/** Переход к другому видео или фото закончился или был прерван новым: у уходящего ставим паузу, у пришедшего запускаем, если оно играло */
	_endMediaMorph() {
		const mm = this._mm;
		if (!mm) return;
		this._mm = null;
		if (mm.out && mm.out.pm.playing && !this.app.media.keepsSound(mm.out)) mm.out.pm.pause();
		if (mm.in && mm.in.want !== false && !mm.in.pm.playing) mm.in.pm.play();
	}

	/**
	 * Видео во время перехода: пока точки уходят (первая часть пути), оно играет и кадры идут на уходящую форму. Когда точки разлетелись, видео встаёт.
	 * Когда они начинают собираться в видео, оно запускается снова, и кадры идут на новую форму.
	 */
	_mediaMorphTick(dt) {
		const mm = this._mm;
		const g = this.geometry;
		if (!mm || !g) return;
		if (!this.morphing) return this._endMediaMorph();
		const m = this.morph;
		const set = this.app.settings.media;
		const side = (e, outSide) => {
			const pm = e.pm;
			const active = outSide ? m < 0.45 : m >= 0.4;
			// видео, выбранное источником звука, играет всегда: звук не обрывается на переходе
			const play = (active && e.want !== false) || this.app.media.keepsSound(e);
			if (play && !pm.playing) pm.play();
			else if (!play && pm.playing) pm.pause();
			if (!active || g.attributes.position.count !== pm.count) return;
			const rgb = pm.advance(dt);
			if (!rgb) return;
			const n = pm.count;
			if (!this._zbuf || this._zbuf.length !== n * 3) this._zbuf = new Float32Array(n * 3);
			const z = this._zbuf;
			const colA = outSide ? g.attributes.aColor : g.attributes.aColorB;
			const zA = outSide ? g.attributes.aOrigin : g.attributes.aTarget;
			pm.applyTo({ positions: z, colors: colA.array, hide: outSide ? g.attributes.aHide.array : undefined }, rgb, set.relief, set.depth);
			const za = zA.array;
			for (let i = 2; i < n * 3; i += 3) za[i] = z[i];
			colA.needsUpdate = zA.needsUpdate = true;
			if (outSide) g.attributes.aHide.needsUpdate = true;
		};
		if (mm.out) side(mm.out, true);
		if (mm.in) side(mm.in, false);
	}

	/** Ещё одно фото или видео добавлено рядом с открытым: встаёт в список морфинга, и форма плавно переходит на него */
	async addMediaForm(id) {
		if (!this.active) return;
		this.app.media.passSound(null);
		const list = [...(this.playlist || [])];
		if (!list.includes(id)) list.push(id);
		this.playlist = list;
		this._pi = Math.max(-1, list.indexOf(this.curKey || this.state.source));
		await this._syncMorphCount();
		await this.setSource(id);
		this.emit();
	}

	/** Меняет облако без разрыва: старая форма плавно перетекает в новую */
	async setSource(key) {
		const st = this.state;
		const isMedia = key === 'media' || key.startsWith('media:');
		const mEntry = isMedia ? this.app.media.entry(key) : null;
		if (isMedia && !(mEntry && mEntry.pm.ready)) {
			this.app.toast('Сначала загрузите фото или видео в разделе «Фото и видео»', 'info');
			return;
		}
		if (key === 'model' && !this.hasModel) {
			this.app.toast('Нет модели: добавьте её кнопкой «Добавить модель» или откройте в редакторе', 'info');
			return;
		}
		// объект сцены и вся сцена это источник «модель»; все фото и видео это источник «media», какое именно говорит ключ формы
		const prevKey = this.cloudKey;
		st.source = key.startsWith('obj:') ? 'model' : isMedia ? 'media' : key;
		this.touch();
		if (!this.active || !this.geometry) return this.emit();
		let target;
		try {
			target = await this._cloudFor(key);
		} finally {
			this.app.ui.idle(); // выбор формы мог показать окно загрузки: закрываем его в любом случае
		}
		if (!target) return this.emit();
		this.curKey = key;
		// это фото или видео теперь текущее: на него переходят таймлайн и панель
		if (isMedia && this.app.media.pm !== mEntry.pm) {
			const prevHeard = this.app.media.soundEntry()?.pm;
			this.app.media.pm = mEntry.pm;
			this.app.media.passSound(prevHeard);
			this.app.media.emit();
			// звук «показанного видео» переходит на новое
			this._resyncVideoAudio?.();
		}
		this._endMediaMorph();
		if (!target || target.count !== this.geometry.attributes.position.count) {
			// число точек другое: переход невозможен, форма собирается заново. Прежнее видео встаёт, новое играет
			const was = prevKey && prevKey !== key && prevKey.startsWith('media') ? this.app.media.entry(prevKey) : null;
			if (was && was.pm.playing && !this.app.media.keepsSound(was)) was.pm.pause();
			await this._build();
			if (mEntry && mEntry.want !== false && !mEntry.pm.playing) mEntry.pm.play();
			return this.emit();
		}
		const g = this.geometry;
		const o = g.attributes.aOrigin;
		const t = g.attributes.aTarget;
		// видео убрало с точек часть (фильтры): при уходе с видео все точки снова видны
		if (!isMedia && prevKey && prevKey.startsWith('media') && g.attributes.aHide) {
			g.attributes.aHide.array.fill(0);
			g.attributes.aHide.needsUpdate = true;
		}
		// если новый переход начался до конца прежнего, считаем прежний завершённым: пути у видов сложные, середину по прямой не посчитать
		const k = this.morphing ? 1 : this.morph * this.morph * (3 - 2 * this.morph);
		for (let i = 0; i < o.array.length; i++) {
			o.array[i] = o.array[i] * (1 - k) + t.array[i] * k;
			t.array[i] = target.positions[i];
		}
		// цвета и нормали тоже перетекают: прежние берём из «второго набора», новые кладём в него, а шейдер смешивает их по ходу перехода
		g.attributes.aNormal.array.set(g.attributes.aNormalB.array);
		g.attributes.aNormalB.array.set(target.normals);
		{
			// пол сетки переезжает под новую форму
			let my = Infinity;
			const tp = target.positions;
			for (let i = 1; i < tp.length; i += 3) if (tp[i] < my) my = tp[i];
			this.app.viewport.fxFloorY = target.norm && target.norm.floorY !== undefined ? target.norm.floorY : my;
		}
		g.attributes.aNormal.needsUpdate = g.attributes.aNormalB.needsUpdate = true;
		if (target.colors && target.colors.length === g.attributes.aColor.array.length) {
			g.attributes.aColor.array.set(g.attributes.aColorB.array);
			g.attributes.aColorB.array.set(target.colors);
			g.attributes.aColor.needsUpdate = g.attributes.aColorB.needsUpdate = true;
		}
		// число точек у моделей разное: лишние точки гаснут, а при переходе к большей модели недостающие проявляются
		const vis = g.attributes.aVis;
		if (vis) {
			const frac = this._fracFor(key);
			const n = vis.count;
			for (let i = 0; i < n; i++) {
				const cur = vis.array[i * 2] * (1 - k) + vis.array[i * 2 + 1] * k;
				const rnd = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
				vis.array[i * 2] = cur;
				vis.array[i * 2 + 1] = rnd < frac ? 1 : 0;
			}
			vis.needsUpdate = true;
		}
		o.needsUpdate = t.needsUpdate = true;
		this.cloudKey = key;
		// анимированные модели живут и во время перехода: уходящая двигается, пока улетает, приходящая уже двигается, пока собирается, поэтому в конце нет скачка позы
		this._animOut = this._animIn || this._animCloud || null;
		this._animIn = (key === 'model' || key.startsWith('obj:')) && target.anim && target.norm ? target : null;
		this._animCloud = null;
		// видео играет, пока точки разлетаются, и снова запускается, когда собираются в видео: что именно, считает _mediaMorphTick
		const outE = prevKey && prevKey.startsWith('media') && prevKey !== key ? this.app.media.entry(prevKey) : null;
		if (outE) outE.want = outE.pm.playing;
		this._mm = outE || isMedia ? { out: outE, in: isMedia && prevKey !== key ? mEntry : null } : null;
		this._morphDepthSetup(outE, isMedia && prevKey !== key ? mEntry : null);
		this.morph = 0;
		this.morphing = true;
		this._settleOn = false;
		this.shared.uSettle.value = -1;
		this.shared.uMorph.value = 0; // сразу, не дожидаясь кадра: иначе на один кадр мелькает новая модель
		this._computeLinks();
		this.emit();
	}

	async setCount(n) {
		this.state.count = n;
		this.app.settings.point.surfaceCount = n;
		this.app.saveSettings();
		this.app.bus.emit('pointsettings');
		this.cache.clear();
		this.touch();
		if (this.active) {
			this.app.ui.busy('Пересобираю частицы', 0.3);
			try {
				await this._build();
			} finally {
				this.app.ui.idle();
			}
		}
		this._prefetch(this.playlist);
		this.emit();
	}

	/** В сцене редактора что-то изменилось (например, добавили модель): пересобираем облако */
	_onScene() {
		if (!this.active || this._muteScene) return;
		clearTimeout(this._sceneT);
		this._sceneT = setTimeout(async () => {
			if (!this.active) return;
			this.cache.clear();
			if (this.hasModel && !(this.pm.ready && this.state.source === 'media')) {
				this.state.source = 'model';
				this.syncLookFromPoints();
			}
			this.app.ui.busy('Готовлю частицы', 0.2);
			try {
				// новая модель плавно перетекает из прежней формы: полная пересборка точек гасила сцену на кадр, и экран мигал
				if (this.geometry && this.hasModel && this.state.source === 'model') await this.setSource('model');
				else await this._build();
			} catch (e) {
				console.error(e);
			} finally {
				// окно загрузки всегда закрываем: раньше оно оставалось поверх сцены после добавления модели
				this.app.ui.idle();
			}
			this.app.nav.animateTo({ target: new THREE.Vector3(0, 0, 0), distance: 5.2 }, 300);
			this.emit();
		}, 700);
	}
}
