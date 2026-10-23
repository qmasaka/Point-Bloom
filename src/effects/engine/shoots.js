import { clamp } from '../../core/util.js';

const MODE = { spikes: 0, bulge: 1, detach: 2, tendril: 3 };

/**
 * Эффект «Рост на ритме». На форме выбираются очаги (до 24), музыка их выращивает.
 * Кроме очагов у эффекта есть общий уровень «нарастания»: каждый удар поднимает его на шаг, бас подпитывает, в тишине он спадает.
 * В виде «Отрыв» от этого уровня зависит, сколько точек отделилось и как далеко улетело, так что с каждым ударом облако разлетается дальше.
 * Последние удары ещё запускают от центра волны (оболочки), которые на мгновение подхватывают точки сильнее.
 * Шейдерная часть: shaders/glsl/vert.js (блок VSHOOT). Методы подмешиваются в EffectsEngine.
 */
export class ShootsPart {
	_shootTick(dt, L, u) {
		const eff = L.on ? this._eff(L) : 0;
		if (eff <= 0.001 || !this.geometry) {
			u.uShoot.value.x = 0;
			return;
		}
		const S = (this._shS ||= { geo: null, n: 0, pos: null, g: null, th: null, beat: 0, autoT: 0, C: 0, pulses: [], pi: 0, strong: 0 });
		const N = clamp(Math.round(L.seeds || 14), 4, 24);
		if (S.geo !== this.geometry || S.n !== N) this._shootSeeds(S, N);
		let beat = false;
		let bass = 0;
		if (this.soundActive) {
			bass = this.levels.bass;
			beat = this.levels.beat > 0.9 && S.beat <= 0.9;
			S.beat = this.levels.beat;
		} else if (L.auto === 'on') {
			// без музыки эффект живёт сам: удар раз в 0.7 с и плавающий бас
			S.autoT += dt;
			if (S.autoT > 0.7) {
				S.autoT = 0;
				beat = true;
			}
			bass = 0.36 + 0.34 * Math.sin(this._time * 1.6);
		}
		const trig = L.trigger || 'both';
		const cap = L.limit ?? 1.2;
		if (beat) {
			// волна удара: до шести волн живут одновременно
			S.pulses[S.pi % 6] = { t0: this._time, s: 0.7 + 0.3 * Math.random() };
			S.pi++;
			if (trig !== 'bass') {
				S.C = Math.min(cap, S.C + (L.step ?? 0.3) * 0.55);
				const k = clamp(Math.round(L.perBeat || 2), 1, 12);
				for (let j = 0; j < k; j++) {
					const i = Math.floor(Math.random() * N);
					S.g[i] = Math.min(1, S.g[i] + (L.step ?? 0.3) * (0.7 + 0.6 * Math.random()));
				}
			}
		}
		const dec = L.decay ?? 0.28;
		const push = (L.bassPush ?? 0.8) * 0.9;
		// общий уровень: бас подпитывает его, пока громче порога, в тишине он спадает (быстрее, когда высок)
		if (trig !== 'beat') {
			const over = bass - 0.3;
			if (over > 0) S.C = Math.min(cap, S.C + over * dt * push * 0.8);
		}
		S.C = Math.max(0, S.C - dt * dec * (0.25 + 0.75 * S.C));
		const V = u.uShootS.value;
		for (let i = 0; i < 24; i++) {
			if (i >= N) {
				V[i].w = 0;
				continue;
			}
			if (trig !== 'beat') {
				const over = bass - S.th[i];
				if (over > 0) S.g[i] = Math.min(1, S.g[i] + over * dt * push * 2.4);
			}
			S.g[i] = Math.max(0, S.g[i] - dt * dec * (0.4 + S.g[i]));
			V[i].set(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2], S.g[i]);
		}
		const B = u.uShootB.value;
		const shells = L.shells ?? 0.7;
		for (let b = 0; b < 6; b++) {
			const p = S.pulses[b];
			const age = p ? this._time - p.t0 : 99;
			if (!p || age > 3 || shells < 0.01) B[b].set(0, 0, 0, 0);
			else B[b].set(age, p.s * shells, 0, 0);
		}
		u.uShoot.value.set(Math.min(eff, 1.5), MODE[L.mode] ?? 2, Math.max(0.1, (L.size ?? 0.3) * 0.9), Math.max(0.1, (L.maxLen ?? 0.7) * 0.7));
		u.uShootP.value.set(L.glow ?? 0.6, L.wobble ?? 0.5, this._time, L.sizeUp ?? 0.5);
		u.uShootD.value.set(L.reach ?? 1, L.twist ?? 0.4, L.radial ?? 0.4, L.fountain ?? 0);
		u.uShootC.value.set(S.C, 1.1 + (L.shellSpeed ?? 1) * 1.6, 0.28, L.fade ?? 0.3);
	}

	/** Очаги расставляются по форме врассыпную: из случайных точек берутся самые далёкие друг от друга */
	_shootSeeds(S, N) {
		const T = this.geometry.attributes.aTarget.array;
		const cnt = this.geometry.attributes.aTarget.count;
		const cand = [];
		for (let i = 0; i < 700; i++) cand.push(Math.floor(Math.random() * cnt));
		const pick = [cand[0]];
		const d2 = (a, b) => (T[a * 3] - T[b * 3]) ** 2 + (T[a * 3 + 1] - T[b * 3 + 1]) ** 2 + (T[a * 3 + 2] - T[b * 3 + 2]) ** 2;
		while (pick.length < N) {
			let best = -1;
			let bd = -1;
			for (const c of cand) {
				let m = Infinity;
				for (const p of pick) m = Math.min(m, d2(c, p));
				if (m > bd) {
					bd = m;
					best = c;
				}
			}
			pick.push(best);
		}
		S.geo = this.geometry;
		S.n = N;
		S.pos = new Float32Array(N * 3);
		S.g = new Float32Array(N);
		S.th = new Float32Array(N);
		for (let i = 0; i < N; i++) {
			S.pos[i * 3] = T[pick[i] * 3];
			S.pos[i * 3 + 1] = T[pick[i] * 3 + 1];
			S.pos[i * 3 + 2] = T[pick[i] * 3 + 2];
			S.th[i] = 0.18 + 0.62 * Math.random();
		}
	}
}
