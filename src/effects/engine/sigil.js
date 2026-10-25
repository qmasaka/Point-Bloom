import { clamp } from '../../core/util.js';

/**
 * Экспериментальный эффект «Сигилы»: генеративный орнамент в духе готических трайблов и киберсигилизма.
 * Часть точек формы собирается в симметричный узор из завитков (готика) или ломаных шипов (кибер), остальные можно приглушить.
 * Узор прорисовывается штрихами от корня к остриям, держится, гаснет и сменяется новым (или по удару музыки).
 * Шейдерная часть: shaders/glsl/vert.js (блок uSig, рядом с «Ростом на ритме»). Методы подмешиваются в EffectsEngine.
 */
export class SigilPart {
	_sigilTick(dt, L, u) {
		const eff = L.on ? this._eff(L) : 0;
		if (eff <= 0.001) {
			u.uSig.value.x = 0;
			return;
		}
		const S = (this._sg ||= { t: 0, seed: Math.random() * 97, beat: 0 });
		const draw = Math.max(0.3, L.draw ?? 2.5);
		const hold = Math.max(0, L.hold ?? 3);
		// по удару музыки рисуется новый узор
		if (L.beat === 'on' && this.soundActive) {
			const b = this.levels.beat > 0.9 && S.beat <= 0.9;
			S.beat = this.levels.beat;
			if (b && S.t > draw * 0.5) this.sigilNew();
		}
		S.t += Math.min(dt, 0.1);
		let prog = 1;
		let vis = 1;
		if (S.t < draw) {
			const k = S.t / draw;
			prog = 1 - Math.pow(1 - k, 2.2);
		} else if (L.loop !== 'off') {
			const f = S.t - draw - hold;
			if (f > 0) vis = clamp(1 - f / 0.8, 0, 1);
			if (f > 0.8) this.sigilNew();
		}
		const mode = L.mode === 'around' ? 1 : L.mode === 'on' ? 0 : 2;
		const style = L.style === 'cyber' ? 1 : 0;
		// у завитков из формы у каждого свой цикл в шейдере: сюда идёт длина жизни одного завитка
		if (mode === 2) {
			prog = Math.max(0.5, L.life ?? 4);
			vis = 1;
		}
		u.uSig.value.set(Math.min(eff, 1.5), mode + style * 3, L.scale ?? 1, mode === 2 ? L.density ?? 0.3 : L.frac ?? 0.5);
		u.uSigP.value.set(prog, S.seed, L.width ?? 0.035, L.glow ?? 0.6);
		u.uSigQ.value.set(L.dim ?? 0.6, L.wobble ?? 0.3, this._time, vis);
	}

	/** Новый узор: прежний сразу сменяется, новый прорисовывается заново */
	sigilNew() {
		const S = (this._sg ||= { t: 0, seed: 0, beat: 0 });
		S.t = 0;
		S.seed = Math.random() * 97;
	}
}
