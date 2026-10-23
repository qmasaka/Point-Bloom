import { clamp } from '../../core/util.js';

/** Номера видов в шейдере: 0 шипы, 1 бугры, 3 щупальца растут из очагов; остальные это виды отрыва участков */
const MODE = { spikes: 0, bulge: 1, tendril: 3, slab: 2, pillar: 4, terrace: 5, shards: 6, peel: 7, screw: 8, dust: 9 };
const DETACH = new Set(['slab', 'pillar', 'terrace', 'shards', 'peel', 'screw', 'dust']);

/**
 * Эффект «Рост на ритме». На форме расставлены очаги (до 24).
 * Виды отрыва: каждый удар сдвигает растущие участки ещё на шаг наружу. Участок отходит рывком и стоит до следующего удара,
 * а на пределе держится, по ударам возвращается, отламывается и улетает или садится на место, и тогда растёт новый.
 * Шипы, бугры и щупальца: удары и бас выращивают очаги, в тишине они опадают.
 * Шейдерная часть: shaders/glsl/vert.js (блок VSHOOT, только WebGL). Методы подмешиваются в EffectsEngine.
 */
export class ShootsPart {
	_shootTick(dt, L, u) {
		const eff = L.on ? this._eff(L) : 0;
		if (eff <= 0.001 || !this.geometry) {
			u.uShoot.value.x = 0;
			return;
		}
		// прежний вид «Отрыв» стал видом «Плита»
		if (L.mode === 'detach') L.mode = 'slab';
		const S = (this._shS ||= { geo: null, n: 0, pos: null, nrm: null, g: null, th: null, beat: 0, bassUp: false, autoT: 0, lastBeat: -9, R: null, active: [] });
		const N = clamp(Math.round(L.seeds || 14), 4, 24);
		if (S.geo !== this.geometry || S.n !== N) this._shootSeeds(S, N);
		// удар: по музыке (удар или всплеск баса), а без звука сам по таймеру
		let beat = false;
		let bass = 0;
		const trig = L.trigger || 'beat';
		if (this.soundActive) {
			bass = this.levels.bass;
			const bBeat = this.levels.beat > 0.9 && S.beat <= 0.9;
			S.beat = this.levels.beat;
			const up = bass > 0.6;
			const bBass = up && !S.bassUp && this._time - S.lastBeat > 0.18;
			S.bassUp = bass > 0.5 ? up || S.bassUp : false;
			beat = trig === 'beat' ? bBeat : trig === 'bass' ? bBass : bBeat || bBass;
		} else if (L.auto !== 'off') {
			S.autoT += dt;
			if (S.autoT > (L.every ?? 0.7)) {
				S.autoT = 0;
				beat = true;
			}
			bass = 0.36 + 0.34 * Math.sin(this._time * 1.6);
		}
		if (beat) S.lastBeat = this._time;
		S.quiet = this._time - S.lastBeat > 1.8;
		const V = u.uShootS.value;
		const W = u.uShootN.value;
		if (DETACH.has(L.mode)) this._shootDetach(S, L, dt, beat, N, V, W);
		else this._shootGrow(S, L, dt, beat, bass, N, V, W);
		u.uShoot.value.set(Math.min(eff, 1.5), MODE[L.mode] ?? 2, Math.max(0.05, (L.size ?? 0.3) * 0.9), Math.max(0.1, (L.maxLen ?? 1) * 0.7));
		u.uShootP.value.set(L.glow ?? 0.3, L.wobble ?? 0.3, this._time, L.sizeUp ?? 0.15);
		// особая настройка вида: ступеней у «Ступеней», размер осколков, слоёв, закрутка винта, разлёт пыли
		const xtra = { terrace: L.tiers ?? 4, shards: L.shardSize ?? 0.5, peel: L.layers ?? 6, screw: L.twist ?? 1, dust: L.scatter ?? 1.3 }[L.mode] ?? 0;
		u.uShootD.value.set({ normal: 0, radial: 1, up: 2, view: 3 }[L.dir] ?? 0, Math.max(0.005, L.step ?? 0.12), xtra, 0);
		u.uShootE.value.set(L.edge ?? 0.35, L.spread ?? 0, L.taper ?? 0, 0);
	}

	/** Отрыв участков: шаг за удар, упругий рывок, поведение на пределе */
	_shootDetach(S, L, dt, beat, N, V, W) {
		if (!S.R || S.R.length !== N) S.R = Array.from({ length: N }, () => ({ steps: 0, d: 0, v: 0, fade: 1, phase: 'idle' }));
		const R = S.R;
		const want = clamp(Math.round(L.active ?? 2), 1, Math.min(8, N));
		// сколько участков растёт: недостающие начинают расти на свободных местах
		S.active = S.active.filter((i) => R[i].phase !== 'idle' && R[i].phase !== 'frozen');
		while (S.active.length < want) {
			const free = [];
			for (let i = 0; i < N; i++) if (R[i].phase === 'idle' && !S.active.includes(i)) free.push(i);
			if (!free.length) break;
			const i = free[Math.floor(Math.random() * free.length)];
			Object.assign(R[i], { steps: 0, d: 0, v: 0, fade: 1, phase: 'grow' });
			S.active.push(i);
		}
		while (S.active.length > want) {
			const i = S.active.pop();
			R[i].phase = 'settle';
		}
		const step = Math.max(0.005, L.step ?? 0.12);
		const maxSteps = clamp(Math.round(L.maxSteps ?? 6), 1, 24);
		const peak = L.peak || 'hold';
		// только если выбрано «Возвращается»: когда удары пропали, участки сами идут обратно по шагу раз в полсекунды
		if (L.quiet === 'back' && S.quiet && !beat) {
			S.qT = (S.qT || 0) + dt;
			if (S.qT > 0.5) {
				S.qT = 0;
				for (const i of S.active) {
					const r = R[i];
					if (r.phase === 'grow' || r.phase === 'held') {
						r.phase = 'back';
					}
					if (r.phase === 'back') {
						r.steps--;
						if (r.steps <= 0) {
							r.steps = 0;
							r.phase = 'settle';
						}
					}
				}
			}
		} else S.qT = 0;
		if (beat) {
			for (const i of S.active) {
				const r = R[i];
				if (r.phase === 'grow') {
					r.steps++;
					if (r.steps >= maxSteps) {
						r.steps = maxSteps;
						if (peak === 'back') r.phase = 'back';
						else if (peak === 'next') r.phase = 'frozen';
						else if (peak === 'drop') r.phase = 'drop';
						else if (peak === 'reset') r.phase = 'settle';
						else r.phase = 'held';
					}
				} else if (r.phase === 'back') {
					r.steps--;
					if (r.steps <= 0) {
						r.steps = 0;
						r.phase = 'settle';
					}
				}
			}
		}
		// участок едет к своей ступени на пружине: «Длительность рывка» это время шага, перелёт за ступень небольшой и всегда один
		const T = Math.max(0.03, L.stepTime ?? 0.25);
		const w = 4.6 / T;
		const z = 0.8;
		for (let i = 0; i < N; i++) {
			const r = R[i];
			let target = r.steps * step;
			if (r.phase === 'drop') {
				// отломился: летит дальше и гаснет, потом место свободно для нового участка
				r.dropV = (r.dropV || step * 3) + dt * step * 10;
				r.d += r.dropV * dt;
				r.fade -= dt * 1.1;
				if (r.fade <= 0) Object.assign(r, { steps: 0, d: 0, v: 0, fade: 1, phase: 'idle', dropV: 0 });
			} else {
				if (r.phase === 'settle') target = 0;
				const a = w * w * (target - r.d) - 2 * z * w * r.v;
				r.v += a * Math.min(dt, 0.05);
				r.d += r.v * Math.min(dt, 0.05);
				if (r.phase === 'settle' && Math.abs(r.d) < 0.004 && Math.abs(r.v) < 0.05) Object.assign(r, { d: 0, v: 0, phase: 'idle' });
			}
			V[i].set(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2], r.phase === 'idle' ? 0 : Math.max(0, r.d));
			W[i].set(S.nrm[i * 3], S.nrm[i * 3 + 1], S.nrm[i * 3 + 2], Math.max(0, r.fade));
		}
		for (let i = N; i < 24; i++) V[i].w = 0;
	}

	/** Шипы, бугры, щупальца: очаги растут от ударов и баса и опадают в тишине */
	_shootGrow(S, L, dt, beat, bass, N, V, W) {
		const trig = L.trigger || 'beat';
		const step = L.step ?? 0.12;
		if (beat) {
			const k = clamp(Math.round(L.perBeat || 2), 1, 12);
			for (let j = 0; j < k; j++) {
				const i = Math.floor(Math.random() * N);
				S.g[i] = Math.min(1, S.g[i] + step * 2.2 * (0.7 + 0.6 * Math.random()));
			}
		}
		const push = (L.bassPush ?? 0.5) * 0.9;
		for (let i = 0; i < 24; i++) {
			if (i >= N) {
				V[i].w = 0;
				continue;
			}
			if (trig !== 'beat') {
				const over = bass - S.th[i];
				if (over > 0) S.g[i] = Math.min(1, S.g[i] + over * dt * push * 2.4);
			}
			S.g[i] = Math.max(0, S.g[i] - dt * (0.18 + (L.decay ?? 0.08)) * (0.4 + S.g[i]));
			V[i].set(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2], S.g[i]);
			W[i].set(S.nrm[i * 3], S.nrm[i * 3 + 1], S.nrm[i * 3 + 2], 1);
		}
	}

	/** Очаги расставляются по форме врассыпную: из случайных точек берутся самые далёкие друг от друга */
	_shootSeeds(S, N) {
		const T = this.geometry.attributes.aTarget.array;
		const Nr = this.geometry.attributes.aNormal?.array;
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
		S.nrm = new Float32Array(N * 3);
		S.g = new Float32Array(N);
		S.th = new Float32Array(N);
		S.R = null;
		S.active = [];
		for (let i = 0; i < N; i++) {
			for (let c = 0; c < 3; c++) {
				S.pos[i * 3 + c] = T[pick[i] * 3 + c];
				S.nrm[i * 3 + c] = Nr ? Nr[pick[i] * 3 + c] : c === 2 ? 1 : 0;
			}
			S.th[i] = 0.18 + 0.62 * Math.random();
		}
	}
}
