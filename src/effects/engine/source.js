import * as THREE from 'three';
import { fitCount, mortonSort, normalizeCloud } from '../shapes/cloud-utils.js';
import { generateShapePoints } from '../shapes/shapes.js';

/** Источник облака точек: модель, фото, видео, формы, морфинг, число частиц. Методы подмешиваются в EffectsEngine (см. engine/index.js). */
export class SourcePart {
	// ------------------------------------------------------------ фото и видео
	/** Загруженное в «Медиа» фото или видео становится источником «Фото» */
	async useMedia() {
		this.state.look.colorBy = 'model';
		// стартовые вихри и пульс портят картинку: выключаем, включить можно слева
		for (const id of ['curl', 'blast']) this.state.layers[id].on = false;
		if (this.state.source === 'media') {
			this.cache.clear();
			await this._build();
		} else await this.setSource('media');
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
		this._prefetch(keys);
	}

	morphNext() {
		const list = this.playlist || [];
		if (list.length < 2 || !this.active || this.morphing) return;
		let i;
		if (this.state.morphCfg.order === 'random') {
			do i = Math.floor(Math.random() * list.length);
			while (i === this._pi && list.length > 1);
		} else i = ((this._pi ?? -1) + 1) % list.length;
		this._pi = i;
		this._lastMorph = this._time;
		this.setSource(list[i]).catch(() => {});
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
		if (key === 'media') {
			const pm = this.pm;
			if (!pm.ready) return null;
			pm.setGrid(this.app.settings.media.pts);
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
				c = mortonSort(fitCount(normalizeCloud(c), n));
			} else if (key.startsWith('obj:')) {
				const o = this.modelProvider?.objects().find((x) => x.id === key.slice(4));
				c = o ? await this.modelProvider.getOf(o.obj, n) : null;
				if (!c || !c.count) return null;
				c = mortonSort(fitCount(normalizeCloud(c), n));
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

	/** Меняет облако без разрыва: старая форма плавно перетекает в новую */
	async setSource(key) {
		const st = this.state;
		if (key === 'media' && !this.pm.ready) {
			this.app.toast('Сначала загрузите фото или видео в разделе «Фото и видео»', 'info');
			return;
		}
		if (key === 'model' && !this.hasModel) {
			this.app.toast('Нет модели: добавьте её кнопкой «Добавить модель» или откройте в редакторе', 'info');
			return;
		}
		const real = !key.startsWith('obj:');
		if (real) st.source = key;
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
		if (!target || target.count !== this.geometry.attributes.position.count) {
			await this._build();
			return this.emit();
		}
		const g = this.geometry;
		const o = g.attributes.aOrigin;
		const t = g.attributes.aTarget;
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
