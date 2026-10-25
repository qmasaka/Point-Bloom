// Фото и видео в точки как часть редактора: облако точек живёт в сцене, видео обновляет его каждый кадр.
// Тот же PointMedia используют и «Эффекты» (источник «Фото»).
import { PointMedia } from './point-media.js';
import { cloudToPoints } from './pointcloud.js';
import { downloadBlob } from '../core/util.js';

const baseName = (n, d) => (n || '').replace(/\.[^.]+$/, '') || d;

export class MediaController {
	constructor(app) {
		this.app = app;
		this.pm = new PointMedia();
		Object.defineProperty(this.pm, 'adjust', { get: () => app.settings.media });
		// все открытые фото и видео: первое «media», остальные «media:2», «media:3»... Текущее (то, что показано и управляется с таймлайна) лежит в this.pm
		this.lib = [{ id: 'media', pm: this.pm, want: true }];
		this._mid = 1;
		// чей звук слышно, когда открыто несколько видео: 'follow' это показанное сейчас, иначе ключ конкретного видео
		this.soundKey = 'follow';
		// постоянная ссылка на текущее медиа: панели и таймлайн берут её один раз, а она сама следует за переключением
		this.live = new Proxy(
			{},
			{
				get: (_, k) => {
					const t = this.pm;
					const v = t[k];
					return typeof v === 'function' ? v.bind(t) : v;
				},
				set: (_, k, v) => {
					this.pm[k] = v;
					return true;
				},
			}
		);
		this.obj = null;
		this.progress = null;
		this._cancel = false;
		this._last = performance.now();
		app.bus.on('scene', () => this.emit());
		this._tick = (now) => {
			requestAnimationFrame(this._tick);
			const dt = Math.min(0.1, (now - this._last) / 1000);
			this._last = now;
			this.update(dt);
		};
		requestAnimationFrame(this._tick);
	}

	get cfg() {
		return this.app.settings.media;
	}

	get ready() {
		return this.pm.ready;
	}

	/** Медиа открыто и его облако лежит в сцене (если объект удалили, вкладка и таймлайн прячутся) */
	get present() {
		// пока облако пересобирается (старое снято, новое ещё не добавлено), считаем, что медиа на месте: иначе вкладка «Медиа» закрывалась и кидала на «Сцену»
		return this.pm.ready && (this._rebuilding || (!!this.obj && !!this.obj.parent) || this.lib.length > 1);
	}

	/** Запись библиотеки по ключу формы или по самому медиа */
	entry(keyOrPm) {
		return this.lib.find((e) => e.id === keyOrPm || e.pm === keyOrPm) || null;
	}

	/** Видео, чей звук слышно: выбранное или (по умолчанию) показанное сейчас */
	soundEntry() {
		const e = this.soundKey !== 'follow' ? this.entry(this.soundKey) : null;
		return e && e.pm.ready ? e : this.entry(this.pm);
	}

	/** Это видео держит звук: при переходах оно не встаёт на паузу */
	keepsSound(e) {
		return !!e && this.soundKey !== 'follow' && e.id === this.soundKey;
	}

	/** Звук переходит к другому видео: оно получает включён/выключен от прежнего, прежнее замолкает */
	passSound(prevPm) {
		const heard = this.soundEntry()?.pm;
		if (!heard || !prevPm || heard === prevPm) return;
		const on = !prevPm.muted;
		if (heard.muted === on) heard.setMuted(!on);
		if (!prevPm.muted) prevPm.setMuted(true);
	}

	setSoundKey(k) {
		const prev = this.soundEntry()?.pm;
		this.soundKey = k;
		this.passSound(prev);
		const e = this.soundEntry();
		if (e && this.keepsSound(e) && !e.pm.playing) e.pm.play();
		this.app.ui?.effectsEngine?._resyncVideoAudio?.();
		this.emit();
	}

	/** Ключ текущего медиа в библиотеке */
	activeKey() {
		return this.entry(this.pm)?.id || 'media';
	}

	/** Сколько фото и видео открыто */
	count() {
		return this.lib.filter((e) => e.pm.ready).length;
	}

	/** Сетка точек для медиа: у одного своя под пропорции кадра, у нескольких одинаковая квадратная, чтобы число точек совпало */
	applyGrid(pm) {
		if (pm.isRec) return;
		const pts = this.cfg.pts;
		const live = this.lib.filter((e) => e.pm.ready && !e.pm.isRec).length;
		if (live > 1) {
			const s = Math.max(8, Math.round(Math.sqrt(pts)));
			pm.setGridExact(s, s);
		} else pm.setGrid(pts);
	}

	/** Ещё одно фото или видео рядом с открытым (режим эффектов): прежнее остаётся, новое становится формой для морфинга */
	async addExtra(file) {
		const pm = new PointMedia();
		Object.defineProperty(pm, 'adjust', { get: () => this.app.settings.media });
		await pm.load(file);
		pm.pause();
		const id = 'media:' + ++this._mid;
		this.lib.push({ id, pm, want: true });
		this.emit();
		return id;
	}

	emit() {
		this.app.bus.emit('media');
	}

	_muteFx() {
		const eng = this.app.ui?.effectsEngine;
		if (!eng) return;
		eng._muteScene = true;
		setTimeout(() => (eng._muteScene = false), 1500);
	}

	/** Открывает фото, видео или сохранённый ролик .pcv и собирает облако точек в сцене */
	async load(file) {
		await this.pm.load(file);
		this.rebuild();
		// открыли новое фото или видео прямо в режиме эффектов: частицы должны перейти на него, а не остаться от прежнего
		const eng = this.app.ui?.effectsEngine;
		if (eng?.active) await eng.useMedia();
		this.app.toast(this.pm.kind === 'image' ? 'Фото превращено в точки' : this.pm.kind === 'video' ? 'Видео превращено в точки. Его можно записать в точечный ролик' : 'Точечный ролик открыт', 'ok');
		this.emit();
	}

	/** Убирает фото или видео и облако из сцены */
	close() {
		const eng = this.app.ui?.effectsEngine;
		const cur = this.entry(this.pm);
		const isPrimary = !cur || cur.id === 'media';
		let o = null;
		if (isPrimary) {
			o = this.obj;
			this.obj = null;
		}
		this.pm.close();
		if (!isPrimary) this.lib = this.lib.filter((e) => e !== cur);
		if (o && o.parent) this.app.model.remove(o);
		// остались другие фото и видео: показываем следующее, а не пустую сцену
		const next = this.lib.find((e) => e.pm.ready);
		if (next) this.pm = next.pm;
		else this.pm = this.lib[0].pm;
		if (eng?.state.source === 'media') eng.setSource(next ? next.id : eng.hasModel ? 'model' : 'sphere');
		this.emit();
	}

	/** Пересобирает облако в сцене под текущие настройки (плотность, рельеф) */
	rebuild({ frame = true } = {}) {
		const { app, pm } = this;
		if (!pm.ready) return;
		const c = this.cfg;
		this.applyGrid(pm);
		pm.dirty = true;
		const cloud = pm.buildCloud(pm.sample(), c.relief, c.depth);
		const pts = cloudToPoints(cloud, pm.kind === 'image' ? 'Фото в точках' : pm.kind === 'rec' ? 'Точечный ролик' : 'Видео в точках');
		pts.userData.media = true;
		this._muteFx();
		const old = this.obj;
		this._rebuilding = true;
		try {
			if (old && old.parent) app.model.remove(old);
			app.model.add(pts, app.viewport.root);
			this.obj = pts;
		} finally {
			this._rebuilding = false;
		}
		app.model.select(pts);
		if (frame) app.nav.frameAll(true);
		app.viewport.invalidate();
	}

	/** Цвета и высота точек по новому кадру */
	_apply(rgb) {
		const o = this.obj;
		const g = o.geometry;
		const n = this.pm.count;
		if (g.attributes.position.count !== n) return;
		const c = this.cfg;
		if (!this._z || this._z.length !== n * 3) this._z = new Float32Array(n * 3);
		this.pm.applyTo({ positions: this._z, colors: g.attributes.color.array, hide: g.attributes.aHide?.array }, rgb, c.relief, c.depth);
		if (g.attributes.aHide) g.attributes.aHide.needsUpdate = true;
		const pos = g.attributes.position.array;
		for (let i = 2; i < n * 3; i += 3) pos[i] = this._z[i];
		g.attributes.color.needsUpdate = true;
		g.attributes.position.needsUpdate = true;
	}

	update(dt) {
		const { pm, app } = this;
		if (!pm.ready || !this.obj || !this.obj.parent || app.ui?.workspace !== 'edit' || pm.recording) return;
		const rgb = pm.advance(dt);
		if (rgb) {
			this._apply(rgb);
			app.viewport.invalidate();
		}
	}

	setPts(n) {
		this.cfg.pts = n;
		this.app.saveSettings();
		if (!this.pm.isRec) this.rebuild({ frame: false });
		this.emit();
	}

	styleChanged() {
		this.pm.dirty = true;
		this.app.saveSettings();
		this.emit();
	}

	async record({ fps, seconds }) {
		const pm = this.pm;
		if (pm.recording) {
			this._cancel = true;
			return;
		}
		this._cancel = false;
		this.progress = { i: 0, total: 1 };
		this.emit();
		try {
			const rec = await pm.record({
				fps,
				seconds,
				cancel: () => this._cancel,
				onProgress: (i, total) => {
					this.progress = { i, total };
					if (i % 3 === 0) this.emit();
				},
			});
			if (rec) this.app.toast(`Записано кадров: ${rec.frames.length}. Теперь можно сохранить`, 'ok');
		} catch (e) {
			this.app.toast(e.message || 'Не удалось записать', 'error');
		}
		this.progress = null;
		pm.dirty = true;
		this.emit();
	}

	/** Копия текущего кадра в сцену (для экспорта): облако остаётся живым, а кадр замораживается */
	snapshot() {
		const { pm, app } = this;
		if (!pm.ready) return;
		const c = this.cfg;
		const cloud = pm.buildCloud(pm.sample(), c.relief, c.depth);
		const pts = cloudToPoints(cloud, 'Кадр в точках');
		this._muteFx();
		app.model.add(pts, app.viewport.root);
		app.toast('Кадр добавлен в сцену отдельным облаком точек', 'ok');
	}

	downloadPCV() {
		if (this.pm.rec) downloadBlob(this.pm.toPCV(), baseName(this.pm.name, 'ролик') + '.pcv');
	}

	downloadPLY() {
		const { pm } = this;
		if (!pm.ready) return;
		const c = this.cfg;
		downloadBlob(new Blob([pm.framePLY(pm.sample(), c.relief, c.depth)], { type: 'application/octet-stream' }), baseName(pm.name, 'кадр') + '.ply');
	}

	downloadPLYZip() {
		const { pm } = this;
		if (!pm.rec) return;
		const c = this.cfg;
		const r = pm.toPLYZip(c.relief, c.depth);
		downloadBlob(r.blob, baseName(pm.name, 'ролик') + '_ply.zip');
		this.app.toast(r.step > 1 ? `Сохранено кадров: ${r.frames} (каждый ${r.step}-й)` : `Сохранено кадров: ${r.frames}`, 'ok');
	}
}
