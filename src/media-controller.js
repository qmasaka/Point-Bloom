// Фото и видео в точки как часть редактора: облако точек живёт в сцене, видео обновляет его каждый кадр.
// Тот же PointMedia используют и «Эффекты» (источник «Фото»).
import { PointMedia } from './point-media.js';
import { cloudToPoints } from './pointcloud.js';
import { downloadBlob } from './util.js';

const baseName = (n, d) => (n || '').replace(/\.[^.]+$/, '') || d;

export class MediaController {
	constructor(app) {
		this.app = app;
		this.pm = new PointMedia();
		this.obj = null;
		this.progress = null;
		this._cancel = false;
		this._last = performance.now();
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
		this.app.toast(this.pm.kind === 'image' ? 'Фото превращено в точки' : this.pm.kind === 'video' ? 'Видео превращено в точки. Его можно записать в точечный ролик' : 'Точечный ролик открыт', 'ok');
		this.emit();
	}

	/** Пересобирает облако в сцене под текущие настройки (плотность, рельеф) */
	rebuild({ frame = true } = {}) {
		const { app, pm } = this;
		if (!pm.ready) return;
		const c = this.cfg;
		pm.setGrid(c.pts);
		pm.dirty = true;
		const cloud = pm.buildCloud(pm.sample(), c.relief, c.depth);
		const pts = cloudToPoints(cloud, pm.kind === 'image' ? 'Фото в точках' : pm.kind === 'rec' ? 'Точечный ролик' : 'Видео в точках');
		pts.userData.media = true;
		this._muteFx();
		const old = this.obj;
		if (old && old.parent) app.model.remove(old);
		app.model.add(pts, app.viewport.root);
		this.obj = pts;
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
		this.pm.applyTo({ positions: this._z, colors: g.attributes.color.array }, rgb, c.relief, c.depth);
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
