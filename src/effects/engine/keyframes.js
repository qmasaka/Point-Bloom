import { saveJSON } from '../../core/util.js';
import { KEY } from '../state/defaults.js';

/** Анимация по ключам: дорожки, клипы, маркеры, воспроизведение. Методы подмешиваются в EffectsEngine (см. engine/index.js). */
export class KeyframesPart {
	// ------------------------------------------------------------ анимация по ключам и блокам эффектов (секвенсор)
	/** Слои, которыми можно анимировать: эффекты формы, звука и графики */
	_animLayers() {
		return ['curl', 'spectrum', 'wave', 'twist', 'blast', 'flow', 'voxel', 'glitch', 'slice', 'feedback', 'datamosh', 'echo', 'links', 'dissolve', 'gravity', 'scope', 'depth', 'explode', 'vscreen', 'hyper', 'slitscan', 'timeform', 'chladni', 'lens', 'shadow'];
	}

	/** Снимок того, что можно анимировать: камера, размер, яркость, свечение и сила каждого эффекта (выключенный = 0) */
	animCapture() {
		const nav = this.app.nav;
		const L = this.state.layers;
		const layers = {};
		for (const id of this._animLayers()) layers[id] = L[id]?.on ? L[id].amount : 0;
		return { cam: { yaw: nav.yaw, pitch: nav.pitch, dist: nav.distance, tx: nav.target.x, ty: nav.target.y, tz: nav.target.z }, size: this.app.settings.point.size, bright: this.state.look.bright, glow: this.state.look.glow, layers };
	}

	get animKeys() {
		return this.state.anim.keys || (this.state.anim.keys = []);
	}

	get animClips() {
		return this.state.anim.clips || (this.state.anim.clips = []);
	}

	_animSort() {
		this.animKeys.sort((a, b) => a.t - b.t);
	}

	/** Ключ камеры и сцены на текущем времени: если рядом уже есть, обновляем его */
	animAddKey(t = this.animT) {
		this._histFlush();
		const A = this.state.anim;
		if (!A.keys) A.keys = [];
		const snap = { t: Math.round(Math.min(A.dur, Math.max(0, t)) * 100) / 100, ...this.animCapture() };
		const near = A.keys.find((k) => Math.abs(k.t - snap.t) < 0.06);
		if (near) Object.assign(near, snap, { t: near.t });
		else A.keys.push(snap);
		this._animSort();
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
		return near || snap;
	}

	animUpdateKey(key) {
		Object.assign(key, this.animCapture(), { t: key.t });
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	animRemoveKey(key) {
		this._histFlush();
		const A = this.state.anim;
		if (!A.keys) return;
		A.keys = A.keys.filter((k) => k !== key);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	animMoveKey(key, t) {
		key.t = Math.round(Math.min(this.state.anim.dur, Math.max(0, t)) * 100) / 100;
		this._animSort();
		this.touch();
		this.app.bus.emit('fxanim');
	}

	/** Добавить клип эффекта на дорожку времени */
	animAddClip(layerId, opts = {}) {
		if (!this._batch) this._histFlush();
		const A = this.state.anim;
		if (!A.clips) A.clips = [];
		const durTotal = A.dur || 8;
		const dur = Math.max(0.3, Math.min(durTotal, opts.dur ?? 2.5));
		const defaultStart = Math.min(Math.max(0, this.animT), Math.max(0, durTotal - dur));
		const start = Math.max(0, Math.min(durTotal - 0.2, opts.start ?? defaultStart));
		const actualDur = Math.min(dur, Math.max(0.2, durTotal - start));
		const fadeIn = Math.max(0, Math.min(actualDur * 0.45, opts.fadeIn ?? 0.4));
		const fadeOut = Math.max(0, Math.min(actualDur * 0.45, opts.fadeOut ?? 0.5));
		const defAmt = this.state.layers[layerId]?.amount ?? 1.0;
		const amount = Math.max(0.05, Math.min(2.0, opts.amount ?? (defAmt > 0 ? defAmt : 1.0)));

		const clip = {
			id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
			layerId,
			start: Math.round(start * 100) / 100,
			dur: Math.round(actualDur * 100) / 100,
			fadeIn: Math.round(fadeIn * 100) / 100,
			fadeOut: Math.round(fadeOut * 100) / 100,
			amount: Math.round(amount * 100) / 100,
			shape: opts.shape || 'plateau',
			ease: opts.ease || 'smooth',
			off: !!opts.off,
			repeat: Math.max(1, Math.min(12, Math.round(opts.repeat || 1))),
			rev: !!opts.rev,
		};
		A.clips.push(clip);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
		return clip;
	}

	/** Изменить параметры клипа эффекта */
	animUpdateClip(clipId, patch = {}) {
		const A = this.state.anim;
		if (!A.clips) return null;
		const clip = A.clips.find((c) => c.id === clipId);
		if (!clip) return null;
		const durTotal = A.dur || 8;

		if (patch.start !== undefined) {
			clip.start = Math.max(0, Math.min(durTotal - 0.2, patch.start));
			if (clip.start + clip.dur > durTotal) {
				clip.dur = Math.max(0.2, durTotal - clip.start);
			}
		}
		if (patch.dur !== undefined) {
			clip.dur = Math.max(0.2, Math.min(durTotal - clip.start, patch.dur));
		}
		if (patch.fadeIn !== undefined) {
			clip.fadeIn = Math.max(0, Math.min(clip.dur, patch.fadeIn));
		}
		if (patch.fadeOut !== undefined) {
			clip.fadeOut = Math.max(0, Math.min(clip.dur, patch.fadeOut));
		}
		if (clip.fadeIn + clip.fadeOut > clip.dur) {
			const ratio = clip.dur / (clip.fadeIn + clip.fadeOut);
			clip.fadeIn *= ratio;
			clip.fadeOut *= ratio;
		}
		if (patch.amount !== undefined) {
			clip.amount = Math.max(0.05, Math.min(2.0, patch.amount));
		}
		if (patch.shape !== undefined && ['plateau', 'ramp', 'fall', 'peak'].includes(patch.shape)) clip.shape = patch.shape;
		if (patch.ease !== undefined && ['smooth', 'linear', 'sharp'].includes(patch.ease)) clip.ease = patch.ease;
		if (patch.off !== undefined) clip.off = !!patch.off;
		if (patch.repeat !== undefined) clip.repeat = Math.max(1, Math.min(12, Math.round(patch.repeat)));
		if (patch.rev !== undefined) clip.rev = !!patch.rev;
		if (patch.layerId !== undefined && (this.state.layers[patch.layerId] || ['morph', 'rotate', 'bloom'].includes(patch.layerId))) {
			clip.layerId = patch.layerId;
		}

		clip.start = Math.round(clip.start * 100) / 100;
		clip.dur = Math.round(clip.dur * 100) / 100;
		clip.fadeIn = Math.round(clip.fadeIn * 100) / 100;
		clip.fadeOut = Math.round(clip.fadeOut * 100) / 100;
		clip.amount = Math.round(clip.amount * 100) / 100;

		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
		return clip;
	}

	/** Метки на линейке времени: быстрые переходы и прилипание блоков */
	animAddMarker(t, name = '') {
		const A = this.state.anim;
		(A.markers ||= []).push({ t: Math.round(Math.max(0, Math.min(A.dur, t)) * 100) / 100, name });
		A.markers.sort((a, b) => a.t - b.t);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
		return A.markers.find((m) => m.t === Math.round(Math.max(0, Math.min(A.dur, t)) * 100) / 100 && m.name === name);
	}

	animUpdateMarker(m, patch = {}) {
		const A = this.state.anim;
		if (!A.markers || !A.markers.includes(m)) return;
		if (patch.t !== undefined) m.t = Math.round(Math.max(0, Math.min(A.dur, patch.t)) * 100) / 100;
		if (patch.name !== undefined) m.name = String(patch.name).slice(0, 24);
		A.markers.sort((a, b) => a.t - b.t);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	animRemoveMarker(m) {
		const A = this.state.anim;
		A.markers = (A.markers || []).filter((x) => x !== m);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Рабочая область: воспроизведение, повтор и запись идут только внутри неё. null снимает */
	animSetWork(a, b) {
		this._histFlush();
		const A = this.state.anim;
		if (a == null) A.work = null;
		else {
			const lo = Math.max(0, Math.min(a, b));
			const hi = Math.min(A.dur, Math.max(a, b));
			A.work = hi - lo >= 0.2 ? { a: Math.round(lo * 100) / 100, b: Math.round(hi * 100) / 100 } : null;
		}
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Состояние дорожки эффекта: заглушить, соло, закрепить */
	animSetLane(layerId, patch = {}) {
		this._histFlush();
		const A = this.state.anim;
		const l = ((A.lanes ||= {})[layerId] ||= {});
		Object.assign(l, patch);
		if (!l.mute && !l.solo && !l.lock) delete A.lanes[layerId];
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Вставляет копии блоков так, что самый ранний начинается в момент t. Возвращает новые блоки */
	animPasteClips(list, t) {
		if (!list || !list.length) return [];
		this._histFlush();
		this._batch = true;
		try {
			return this._animPasteClips(list, t);
		} finally {
			this._batch = false;
		}
	}

	_animPasteClips(list, t) {
		const t0 = Math.min(...list.map((c) => c.start));
		const out = [];
		for (const c of list) {
			out.push(this.animAddClip(c.layerId, { start: t + (c.start - t0), dur: c.dur, fadeIn: c.fadeIn, fadeOut: c.fadeOut, amount: c.amount, shape: c.shape, ease: c.ease, off: c.off, repeat: c.repeat, rev: c.rev }));
		}
		return out;
	}

	/** Удалить клип эффекта */
	animRemoveClip(clipId) {
		this._histFlush();
		const A = this.state.anim;
		if (!A.clips) return;
		A.clips = A.clips.filter((c) => c.id !== clipId);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Продублировать клип эффекта со сдвигом по времени */
	animDuplicateClip(clipId, batch) {
		if (!batch) this._histFlush();
		this._batch = true;
		try {
			return this._animDuplicateClip(clipId);
		} finally {
			this._batch = false;
		}
	}

	_animDuplicateClip(clipId) {
		const A = this.state.anim;
		if (!A.clips) return null;
		const clip = A.clips.find((c) => c.id === clipId);
		if (!clip) return null;
		const durTotal = A.dur || 8;
		let newStart = clip.start + 0.5;
		if (newStart + clip.dur > durTotal) newStart = Math.max(0, durTotal - clip.dur);
		return this.animAddClip(clip.layerId, {
			start: newStart,
			dur: clip.dur,
			fadeIn: clip.fadeIn,
			fadeOut: clip.fadeOut,
			amount: clip.amount,
			shape: clip.shape,
			ease: clip.ease,
			off: clip.off,
			repeat: clip.repeat,
			rev: clip.rev,
		});
	}

	/** Разрезать клип по времени t на два: у первого остаётся вход, у второго выход. Возвращает правую часть или null */
	animSplitClip(clipId, t) {
		this._histFlush();
		const A = this.state.anim;
		const clip = (A.clips || []).find((c) => c.id === clipId);
		if (!clip || t <= clip.start + 0.3 || t >= clip.start + clip.dur - 0.3) return null;
		const end = clip.start + clip.dur;
		const outFade = clip.fadeOut;
		const left = t - clip.start;
		clip.dur = Math.round(left * 100) / 100;
		clip.fadeIn = Math.min(clip.fadeIn, clip.dur * 0.45);
		clip.fadeOut = Math.min(0.15, clip.dur * 0.3);
		this._batch = true;
		const right = this.animAddClip(clip.layerId, { start: t, dur: end - t, fadeIn: Math.min(0.15, (end - t) * 0.3), fadeOut: Math.min(outFade, (end - t) * 0.45), amount: clip.amount, shape: clip.shape, ease: clip.ease, repeat: clip.repeat, rev: clip.rev });
		this._batch = false;
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
		return right;
	}

	/** Очистить всю дорожку анимации */
	animClear() {
		this._histFlush();
		const A = this.state.anim;
		A.keys = [];
		A.clips = [];
		A.markers = [];
		A.work = null;
		A.lanes = {};
		this.animT = 0;
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Подготавливает целевое облако точек для дорожки морфинга на таймлайне */
	async _prepareMorphTrack() {
		if (!this.geometry || this._morphTrackReady || this._morphTrackLoading) return;
		this._morphTrackLoading = true;
		try {
			const forms = this.forms();
			let targetKey = null;
			if (forms.length >= 2) {
				targetKey = forms.find((f) => f.key !== (this.curKey || this.state.source))?.key || forms[1].key;
			} else {
				targetKey = this.state.source === 'sphere' ? 'torus' : 'sphere';
			}
			const target = await this._cloudFor(targetKey);
			if (target && this.geometry) {
				const g = this.geometry;
				const t = g.attributes.aTarget;
				if (t && target.positions && target.positions.length === t.array.length) {
					t.array.set(target.positions);
					t.needsUpdate = true;
					this._morphTrackReady = true;
				}
			}
		} catch (e) {
			/* не критично */
		} finally {
			this._morphTrackLoading = false;
		}
	}

	/** Загрузить готовый режиссерский сценарий */
	animLoadPreset(id) {
		const nav = this.app?.nav;
		const baseDist = nav?.distance || 5.2;
		const tx = nav?.target?.x || 0;
		const ty = nav?.target?.y || 0;
		const tz = nav?.target?.z || 0;

		if (id === 'dust_rebirth') {
			this.animSetDuration(9);
			const A = this.state.anim;
			A.keys = [
				{ t: 0.0, cam: { yaw: 0.2, pitch: 0.25, dist: baseDist * 0.75, tx, ty, tz }, size: 2.2, bright: 0.9, glow: 0.6, layers: {} },
				{ t: 4.5, cam: { yaw: 2.1, pitch: 0.15, dist: baseDist * 1.15, tx, ty, tz }, size: 3.8, bright: 1.2, glow: 1.0, layers: {} },
				{ t: 9.0, cam: { yaw: 4.0, pitch: 0.28, dist: baseDist * 0.85, tx, ty, tz }, size: 3.0, bright: 1.0, glow: 0.8, layers: {} },
			];
			A.clips = [
				{ id: 'c_pr_1', layerId: 'dissolve', start: 0.0, dur: 3.8, fadeIn: 0.2, fadeOut: 1.0, amount: 1.0 },
				{ id: 'c_pr_2', layerId: 'curl', start: 2.2, dur: 4.5, fadeIn: 0.8, fadeOut: 1.2, amount: 0.9 },
				{ id: 'c_pr_3', layerId: 'blast', start: 5.2, dur: 3.2, fadeIn: 0.6, fadeOut: 0.8, amount: 0.75 },
				{ id: 'c_pr_4', layerId: 'wave', start: 6.2, dur: 2.8, fadeIn: 0.5, fadeOut: 0.8, amount: 0.65 },
			];
		} else if (id === 'scan_collapse') {
			this.animSetDuration(10);
			const A = this.state.anim;
			A.keys = [
				{ t: 0.0, cam: { yaw: -0.6, pitch: 0.45, dist: baseDist * 0.8, tx, ty: ty - 0.2, tz }, size: 2.8, bright: 1.0, glow: 0.7, layers: {} },
				{ t: 5.0, cam: { yaw: 1.2, pitch: 0.1, dist: baseDist * 1.2, tx, ty: ty + 0.1, tz }, size: 3.4, bright: 1.3, glow: 1.1, layers: {} },
				{ t: 10.0, cam: { yaw: 3.2, pitch: 0.35, dist: baseDist * 0.9, tx, ty, tz }, size: 3.0, bright: 1.0, glow: 0.8, layers: {} },
			];
			A.clips = [
				{ id: 'c_pr_5', layerId: 'slice', start: 0.0, dur: 4.0, fadeIn: 0.2, fadeOut: 0.8, amount: 1.0 },
				{ id: 'c_pr_6', layerId: 'links', start: 3.0, dur: 4.5, fadeIn: 0.8, fadeOut: 1.0, amount: 0.95 },
				{ id: 'c_pr_7', layerId: 'glitch', start: 5.5, dur: 3.5, fadeIn: 0.4, fadeOut: 0.8, amount: 0.85 },
				{ id: 'c_pr_8', layerId: 'bloom', start: 6.5, dur: 3.0, fadeIn: 0.5, fadeOut: 0.8, amount: 0.9 },
			];
		} else if (id === 'glitch_morph') {
			this.animSetDuration(8);
			const A = this.state.anim;
			A.keys = [
				{ t: 0.0, cam: { yaw: 0.0, pitch: 0.2, dist: baseDist, tx, ty, tz }, size: 3.2, bright: 1.0, glow: 0.8, layers: {} },
				{ t: 3.5, cam: { yaw: 1.8, pitch: -0.1, dist: baseDist * 0.75, tx, ty, tz }, size: 4.2, bright: 1.4, glow: 1.2, layers: {} },
				{ t: 8.0, cam: { yaw: 3.6, pitch: 0.2, dist: baseDist, tx, ty, tz }, size: 3.2, bright: 1.0, glow: 0.8, layers: {} },
			];
			A.clips = [
				{ id: 'c_pr_9', layerId: 'glitch', start: 0.3, dur: 3.0, fadeIn: 0.2, fadeOut: 0.6, amount: 0.95 },
				{ id: 'c_pr_10', layerId: 'morph', start: 1.5, dur: 4.5, fadeIn: 0.4, fadeOut: 0.6, amount: 1.0 },
				{ id: 'c_pr_11', layerId: 'blast', start: 2.2, dur: 3.8, fadeIn: 0.3, fadeOut: 0.9, amount: 1.0 },
				{ id: 'c_pr_12', layerId: 'bloom', start: 3.5, dur: 3.0, fadeIn: 0.4, fadeOut: 0.8, amount: 0.9 },
				{ id: 'c_pr_13', layerId: 'twist', start: 4.0, dur: 3.5, fadeIn: 0.6, fadeOut: 0.8, amount: 0.85 },
			];
		}
		this.animSeek(0);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	animSetDuration(d) {
		const A = this.state.anim;
		A.dur = Math.max(1, Math.min(120, d));
		if (A.keys) {
			for (const k of A.keys) k.t = Math.min(k.t, A.dur);
		}
		if (A.clips) {
			for (const c of A.clips) {
				c.start = Math.min(c.start, Math.max(0, A.dur - 0.2));
				c.dur = Math.min(c.dur, A.dur - c.start);
				if (c.fadeIn + c.fadeOut > c.dur) {
					c.fadeIn = Math.min(c.fadeIn, c.dur * 0.5);
					c.fadeOut = Math.min(c.fadeOut, c.dur * 0.5);
				}
			}
		}
		this.animT = Math.min(this.animT, A.dur);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Огибающая блока в момент t: вход и выход по выбранной кривой, умноженные на форму (плато, нарастание, спад, пик) */
	_clipEnv(c, t) {
		// пульсация: блок повторяет свою форму несколько раз подряд; реверс читает её с конца
		const n = Math.max(1, c.repeat || 1);
		if (c.rev) t = c.start + c.dur - (t - c.start);
		if (n > 1) {
			const seg = c.dur / n;
			const k = Math.max(0, Math.min(n - 1, Math.floor((t - c.start) / seg)));
			return this._clipEnv1({ ...c, rev: false, repeat: 1, start: c.start + k * seg, dur: seg, fadeIn: Math.min(c.fadeIn, seg * 0.45), fadeOut: Math.min(c.fadeOut, seg * 0.45) }, t);
		}
		return this._clipEnv1(c, t);
	}

	_clipEnv1(c, t) {
		const curve = (f) => {
			f = Math.min(1, Math.max(0, f));
			return c.ease === 'linear' ? f : c.ease === 'sharp' ? Math.pow(f, 0.35) : f * f * (3 - 2 * f);
		};
		const elapsed = t - c.start;
		const remaining = c.start + c.dur - t;
		let env = 1;
		if (c.fadeIn > 0.001 && elapsed < c.fadeIn) env = Math.min(env, curve(elapsed / c.fadeIn));
		if (c.fadeOut > 0.001 && remaining < c.fadeOut) env = Math.min(env, curve(remaining / c.fadeOut));
		const u = c.dur > 0 ? Math.min(1, Math.max(0, elapsed / c.dur)) : 0;
		const shape = c.shape || 'plateau';
		const k = shape === 'ramp' ? curve(u) : shape === 'fall' ? curve(1 - u) : shape === 'peak' ? curve(1 - Math.abs(2 * u - 1)) : 1;
		return env * k;
	}

	/** Выставляет сцену по времени t: интерполяция ключей камеры + огибающие блоков эффектов */
	/** Эффекты, у которых есть блоки на таймлайне, работают только внутри своих блоков (с плавными входом и выходом); где блока нет, эффект выключен */
	_animGate(t) {
		// блоки управляют эффектами, только пока таймлайн открыт; при закрытом таймлайне эффекты работают вручную и не выключаются сами
		const clips = this.timelineOpen ? this.state.anim.clips || [] : [];
		const L = this.state.layers;
		const clipLayerIds = new Set(clips.map((c) => c.layerId));
		// как только у эффекта появляется первый блок, его ручные значения запоминаются, а сила падает до нуля: дальше им управляет только таймлайн.
		// Когда последний блок удалён, прежние значения возвращаются
		const S = (this.state.anim.saved ||= {});
		let changed = false;
		for (const id of clipLayerIds) {
			if (!L[id] || S[id]) continue;
			S[id] = { on: !!L[id].on, amount: L[id].amount };
			L[id].on = false;
			L[id].amount = 0;
			changed = true;
		}
		for (const id of Object.keys(S)) {
			if (clipLayerIds.has(id)) continue;
			if (L[id]) {
				L[id].on = S[id].on;
				L[id].amount = S[id].amount;
			}
			delete S[id];
			changed = true;
		}
		if (changed) {
			this.touch();
			this.emit();
		}
		for (const layerId of clipLayerIds) {
			if (!L[layerId]) continue;
			const maxVal = this._trackVal(clips, layerId, t);
			if (maxVal > 0.003) {
				L[layerId].on = true;
				L[layerId].amount = maxVal;
			} else {
				L[layerId].on = false;
			}
		}
	}

	/** Дорожка заглушена, или включено соло у другой дорожки: её блоки не работают */
	_laneOff(layerId) {
		const lanes = this.state.anim.lanes || {};
		const anySolo = Object.values(lanes).some((x) => x && x.solo);
		return !!(lanes[layerId] && lanes[layerId].mute) || (anySolo && !(lanes[layerId] && lanes[layerId].solo));
	}

	/** Сила дорожки в момент t: самый сильный из блоков под курсором (огибающая, форма, повтор, реверс) */
	_trackVal(clips, layerId, t) {
		if (this._laneOff(layerId)) return 0;
		let v = 0;
		for (const c of clips) {
			if (c.layerId !== layerId || c.off || t < c.start || t > c.start + c.dur) continue;
			v = Math.max(v, (c.amount ?? 1.0) * this._clipEnv(c, t));
		}
		return v;
	}

	/** Накопленная сила дорожки от начала до t (интеграл огибающих): угол вращения растёт плавно и не откатывается назад на затухании */
	_trackArea(clips, layerId, t) {
		if (this._laneOff(layerId)) return 0;
		let s = 0;
		for (const c of clips) {
			if (c.layerId !== layerId || c.off || t <= c.start) continue;
			const b = Math.min(t, c.start + c.dur);
			const n = Math.max(8, Math.ceil((b - c.start) * 30));
			const h = (b - c.start) / n;
			for (let i = 0; i < n; i++) s += (c.amount ?? 1.0) * this._clipEnv(c, c.start + (i + 0.5) * h) * h;
		}
		return s;
	}

	animApply(t) {
		const A = this.state.anim;
		const keys = A.keys || [];
		const clips = A.clips || [];
		if (!keys.length && !clips.length) {
			this._animBloom = 0;
			return;
		}

		// 1. Плавная интерполяция камеры и вида из ключей
		if (keys.length > 0) {
			let a = keys[0];
			let b = keys[keys.length - 1];
			let u = 0;
			if (t <= keys[0].t) b = a;
			else if (t >= b.t) a = b;
			else {
				for (let i = 0; i < keys.length - 1; i++) {
					if (t >= keys[i].t && t <= keys[i + 1].t) {
						a = keys[i];
						b = keys[i + 1];
						break;
					}
				}
				const span = Math.max(1e-6, b.t - a.t);
				u = (t - a.t) / span;
				u = u * u * (3 - 2 * u);
			}
			const mix = (x, y) => x + (y - x) * u;
			const nav = this.app.nav;
			nav.cancelTween?.();
			nav.yaw = mix(a.cam.yaw, b.cam.yaw);
			nav.pitch = mix(a.cam.pitch, b.cam.pitch);
			nav.distance = Math.exp(mix(Math.log(a.cam.dist), Math.log(b.cam.dist)));
			nav.target.set(mix(a.cam.tx, b.cam.tx), mix(a.cam.ty, b.cam.ty), mix(a.cam.tz, b.cam.tz));
			nav.applyCamera();
			if (a.size !== undefined && b.size !== undefined) {
				this.app.settings.point.size = mix(a.size, b.size);
			}
			if (a.bright !== undefined && b.bright !== undefined) {
				this.state.look.bright = mix(a.bright, b.bright);
			}
			if (a.glow !== undefined && b.glow !== undefined) {
				this.state.look.glow = mix(a.glow, b.glow);
			}

			// Если блоков эффектов нет, используем старые снимки слоёв в ключах
			if (clips.length === 0 && a.layers && b.layers) {
				const L = this.state.layers;
				for (const id of this._animLayers()) {
					if (!L[id]) continue;
					const v = mix(a.layers[id] ?? 0, b.layers[id] ?? 0);
					if (v > 0.003) {
						L[id].on = true;
						L[id].amount = v;
					} else {
						L[id].on = false;
					}
				}
			}
		}

		// 2. Расчёт силы эффектов по блокам дорожки (с огибающими fade-in / fade-out)
		if (clips.length > 0) {
			const L = this.state.layers;
			const clipLayerIds = new Set(clips.map((c) => c.layerId));

			this._animGate(t);

			// Дорожка морфинга
			if (clipLayerIds.has('morph')) {
				if (!this._morphTrackReady && !this._morphTrackLoading) {
					this._prepareMorphTrack();
				}
				let mVal = 0;
				const mOff = this._laneOff('morph');
				for (const c of clips) {
					if (c.layerId !== 'morph' || c.off || mOff) continue;
					if (t <= c.start) continue;
					if (t >= c.start + c.dur) {
						mVal = 1.0;
						continue;
					}
					const p = (t - c.start) / Math.max(0.01, c.dur);
					mVal = Math.max(mVal, p * (c.amount ?? 1.0));
				}
				this.morph = Math.max(0, Math.min(1, mVal));
				if (this.shared?.uMorph) this.shared.uMorph.value = this.morph;
			}

			// Дорожка вращения: угол копится по огибающим блоков, поэтому на входе и выходе форма плавно разгоняется и тормозит, а не крутится назад
			// поворот добавляется к текущему (а не ставится заново), поэтому автовращение и вращение руками продолжают работать
			if (clipLayerIds.has('rotate') && this.points) {
				const area = this._trackArea(clips, 'rotate', t);
				const d = area - (this._rotArea ?? area);
				this._rotArea = area;
				if (Math.abs(d) > 1e-6) {
					this.points.rotation.y += 1.6 * d;
					this.points.updateMatrixWorld();
				}
			} else this._rotArea = undefined;

			// Дорожка блума и вспышки: добавка к свечению и яркости поверх ваших настроек (сами настройки не меняются)
			this._animBloom = clipLayerIds.has('bloom') ? this._trackVal(clips, 'bloom', t) : 0;
		} else this._animBloom = 0;

		clearTimeout(this._saveT);
		this._saveT = setTimeout(() => saveJSON(KEY, this.state), 500);
	}

	animSeek(t) {
		this.animT = Math.max(0, Math.min(this.state.anim.dur, t));
		this.animApply(this.animT);
		this.app.bus.emit('fxanim');
	}

	animPlay() {
		const hasKeys = this.state.anim.keys && this.state.anim.keys.length >= 2;
		const hasClips = this.state.anim.clips && this.state.anim.clips.length >= 1;
		if (!hasKeys && !hasClips) return false;
		const [ra, rb] = this._animRange();
		if (this.animT >= rb - 0.01 || this.animT < ra - 0.001) this.animT = ra;
		this.animPlaying = true;
		this.app.bus.emit('fxanim');
		return true;
	}

	animPause() {
		if (!this.animPlaying) return;
		this.animPlaying = false;
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Проигрывает анимацию один раз с начала и записывает видео со звуком */
	animRecord() {
		const hasKeys = this.state.anim.keys && this.state.anim.keys.length >= 2;
		const hasClips = this.state.anim.clips && this.state.anim.clips.length >= 1;
		if ((!hasKeys && !hasClips) || this.recording) return false;
		this.animT = this._animRange()[0];
		this.animApply(this.animT);
		this.animRec = true;
		this.startRecording();
		this.animPlaying = true;
		this.app.bus.emit('fxanim');
		return true;
	}

	/** Диапазон воспроизведения: рабочая область между метками «начало» и «конец», а без неё вся длина */
	_animRange() {
		const A = this.state.anim;
		const w = A.work;
		if (w && w.b - w.a >= 0.2) return [Math.max(0, w.a), Math.min(A.dur, w.b)];
		return [0, A.dur];
	}

	_animStep(dt) {
		const A = this.state.anim;
		const [ra, rb] = this._animRange();
		this.animT += dt * (A.speed || 1);
		if (this.animT >= rb) {
			if (this.animRec) {
				this.animT = rb;
				this.animApply(rb);
				this.animRec = false;
				this.animPlaying = false;
				this.stopRecording();
				this.emit();
			} else if (A.loop) this.animT = ra + ((this.animT - ra) % Math.max(0.05, rb - ra));
			else {
				this.animT = rb;
				this.animPlaying = false;
				this.emit();
			}
		} else if (this.animT < ra && A.work) this.animT = ra;
		this.animApply(this.animT);
		this._animEmitT = (this._animEmitT || 0) + dt;
		if (this._animEmitT > 0.05) {
			this._animEmitT = 0;
			this.app.bus.emit('fxanim');
		}
	}
}
