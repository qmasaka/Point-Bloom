import * as THREE from 'three';
import { clamp } from '../../core/util.js';

/** Взаимодействие: курсор, ударные волны, параметры и управление датамошем. Методы подмешиваются в EffectsEngine (см. engine/index.js). */
export class InteractionPart {
	/** Запускает волну из точки pos (в локальных координатах облака) */
	addShock(pos) {
		if (!pos) return;
		this.shocks.unshift({ pos: pos.clone(), t0: this._time });
		this.shocks.length = Math.min(this.shocks.length, 4);
	}

	_onDown(e) {
		this._pointerDown = true;
		this._down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button };
		if (this.mouseOn && this.state.layers.brush.on) {
			this.addBrushHit(this.mouse);
		}
	}

	_onUp(e) {
		this._pointerDown = false;
		const d = this._down;
		this._down = null;
		if (!d || d.b !== 0) return;
		return;
		if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 450) return;
		this._onMove(e);
		if (this.mouseOn) this.addShock(this.mouse);
	}

	_onMove(e) {
		if (!this.points) return;
		const vp = this.app.viewport;
		const r = vp.canvas.getBoundingClientRect();
		const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
		this._ray.setFromCamera(ndc, vp.camera);
		this._plane.setFromNormalAndCoplanarPoint(vp.camera.getWorldDirection(new THREE.Vector3()).negate(), new THREE.Vector3());
		const hit = new THREE.Vector3();
		if (this._ray.ray.intersectPlane(this._plane, hit)) {
			this.mouse.copy(this.points.worldToLocal(hit));
			this.mouseOn = true;
			this._moveT = this._time;
			if (this.state.layers.brush.on && (e.buttons === 1 || this._pointerDown)) {
				this.addBrushHit(this.mouse);
			}
		}
	}

	/** Параметры датамоша на этот кадр: когда случился сбой, насколько кадр ещё «держится» и все числа для шейдеров */
	_moshParams(L) {
		const S = this._mosh || (this._mosh = { kickAt: -1e9, nextKick: 0, lastT: 0, lastBeat: -9, above: false, cleanUntil: -1, wasOn: false });
		const t = this._time;
		const eff = this._eff(L);
		if (eff <= 0.001) {
			S.wasOn = false;
			return null;
		}
		const period = Math.max(0.3, +L.period || 4);
		if (!S.wasOn || t < S.lastT - 0.4) {
			// включили или таймлайн перемотали: первый сбой сразу, чтобы эффект был виден
			S.wasOn = true;
			S.kickAt = t;
			S.nextKick = t + period;
			S.cleanUntil = -1;
		}
		S.lastT = t;
		const trig = L.trigger || 'timer';
		if (trig === 'timer' && t >= S.nextKick) {
			S.kickAt = t;
			S.nextKick = t + period;
		} else if (trig === 'beat') {
			const lvl = L.band !== 'none' ? this._bandLevel(L) : this.levels?.beat || 0;
			if (lvl > 0.55 && !S.above && t - S.lastBeat > 0.25) {
				S.kickAt = t;
				S.lastBeat = t;
			}
			S.above = lvl > 0.55;
		}
		let hold;
		if (t < S.cleanUntil) hold = 0;
		else if (trig === 'always') hold = 1;
		else {
			const x = (t - S.kickAt) / Math.max(0.1, +L.recover || 2.5);
			hold = x >= 1 ? 0 : Math.pow(1 - Math.max(0, x), 0.7);
		}
		const style = { bleed: 0, blocks: 1, melt: 2 }[L.style] ?? 0;
		return {
			on: true,
			hold,
			gain: clamp(eff, 0, 2),
			block: +L.block || 16,
			style,
			smooth: L.smooth,
			detail: L.detail,
			chroma: L.chroma,
			quant: L.quant,
			stale: L.stale,
			jit: L.jit,
			drift: L.drift,
			angle: ((L.angle || 0) * Math.PI) / 180,
			flow: style === 2 ? Math.max(L.flow, 0.4) : L.flow,
			inertia: L.inertia,
			leak: 0.003 + (L.leak ?? 0.3) * 0.09,
			sceneMix: style === 2 ? 0.35 : 1,
			time: t,
		};
	}

	moshKick() {
		const S = this._mosh || (this._mosh = { kickAt: -1e9, nextKick: 0, lastT: 0, lastBeat: -9, above: false, cleanUntil: -1, wasOn: false });
		S.kickAt = this._time;
		S.cleanUntil = -1;
		this.app.viewport.invalidate();
	}

	moshClear() {
		const S = this._mosh || (this._mosh = { kickAt: -1e9, nextKick: 0, lastT: 0, lastBeat: -9, above: false, cleanUntil: -1, wasOn: false });
		S.kickAt = -1e9;
		S.cleanUntil = this._time + 0.25;
		this.app.viewport.invalidate();
	}

	/** Готовые наборы настроек датамоша */
	moshPreset(L, name) {
		const P = {
			classic: { style: 'bleed', trigger: 'timer', period: 4, recover: 2.5, block: '16', detail: 0.2, inertia: 0.5, leak: 0.3, smooth: 0.6, drift: 0.3, angle: 270, flow: 0, chroma: 0.25, quant: 0 },
			melt: { style: 'melt', trigger: 'always', block: '16', detail: 0.05, inertia: 0.8, leak: 0.12, smooth: 1, drift: 0.3, angle: 270, flow: 0.7, chroma: 0.35, quant: 0 },
			blocks: { style: 'blocks', trigger: 'timer', period: 2.5, recover: 1.5, block: '32', detail: 0.35, inertia: 0.3, leak: 0.4, smooth: 0, drift: 0.2, angle: 0, flow: 0, chroma: 0.15, quant: 0.6, stale: 0.25, jit: 0.5 },
			beat: { style: 'bleed', trigger: 'beat', recover: 0.9, block: '16', detail: 0.1, inertia: 0.4, leak: 0.3, smooth: 0.5, drift: 0.4, angle: 270, flow: 0, chroma: 0.3, quant: 0.1 },
		}[name];
		if (!P) return;
		Object.assign(L, P, { on: true });
		this.moshKick();
	}
}
