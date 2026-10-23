import { clamp } from '../../core/util.js';

const MODE = { spikes: 0, bulge: 1, detach: 2, tendril: 3 };

/** Эффект «Рост на ритме»: на форме выбираются очаги (до 24), музыка их выращивает. Удар отращивает несколько очагов на шаг, бас поднимает те, чей порог ниже громкости, в тишине всё медленно втягивается. Шейдерная часть: shaders/glsl/vert.js (блок VSHOOT). Методы подмешиваются в EffectsEngine. */
export class ShootsPart {
	_shootTick(dt, L, u) {
		const eff = L.on ? this._eff(L) : 0;
		if (eff <= 0.001 || !this.geometry) {
			u.uShoot.value.x = 0;
			return;
		}
		const S = (this._shS ||= { geo: null, n: 0, pos: null, g: null, th: null, beat: 0, autoT: 0 });
		const N = clamp(Math.round(L.seeds || 14), 4, 24);
		if (S.geo !== this.geometry || S.n !== N) this._shootSeeds(S, N);
		let beat = false;
		let bass = 0;
		if (this.soundActive) {
			bass = this.levels.bass;
			beat = this.levels.beat > 0.9 && S.beat <= 0.9;
			S.beat = this.levels.beat;
		} else if (L.auto === 'on') {
			// без музыки эффект живёт сам: удар раз в полсекунды и плавающий бас
			S.autoT += dt;
			if (S.autoT > 0.7) {
				S.autoT = 0;
				beat = true;
			}
			bass = 0.36 + 0.34 * Math.sin(this._time * 1.6);
		}
		const trig = L.trigger || 'both';
		if (beat && trig !== 'bass') {
			const k = clamp(Math.round(L.perBeat || 3), 1, 12);
			for (let j = 0; j < k; j++) {
				const i = Math.floor(Math.random() * N);
				S.g[i] = Math.min(1, S.g[i] + (L.step ?? 0.35) * (0.7 + 0.6 * Math.random()));
			}
		}
		const dec = L.decay ?? 0.12;
		const push = (L.bassPush ?? 0.8) * 0.9;
		const V = u.uShootS.value;
		for (let i = 0; i < 24; i++) {
			if (i >= N) {
				V[i].w = 0;
				continue;
			}
			if (trig !== 'beat') {
				const over = bass - S.th[i];
				if (over > 0) S.g[i] = Math.min(1, S.g[i] + over * dt * push);
			}
			// чем больше выросло, тем быстрее втягивается: рост не залипает на пределе
			S.g[i] = Math.max(0, S.g[i] - dt * dec * (0.4 + S.g[i]));
			V[i].set(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2], S.g[i]);
		}
		u.uShoot.value.set(Math.min(eff, 1.5), MODE[L.mode] ?? 0, Math.max(0.1, (L.size ?? 0.5) * 0.9), Math.max(0.1, (L.maxLen ?? 1) * 0.7));
		u.uShootP.value.set(L.glow ?? 0.6, L.wobble ?? 0.5, this._time, 0);
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
