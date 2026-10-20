/** Узоры по высоте тона: от низких (мало линий) к высоким (много). Пары номеров мод стоячей волны (n, m) */
const PATTERNS = [[1, 2], [1, 3], [2, 3], [1, 4], [2, 5], [3, 4], [1, 5], [3, 5], [2, 7], [4, 5], [3, 7], [5, 6], [4, 7], [5, 8]];

/** Эффект «Фигуры Хладни»: точки ложатся на узловые линии стоячей волны, узор меняется от звука, ударов или таймера. Методы подмешиваются в EffectsEngine. */
export class ChladniPart {
	_chladniTick(dt, C, u) {
		const ce = this._eff(C);
		if (ce <= 0.001) {
			u.uCh.value.x = 0;
			return;
		}
		const S = (this._chS ||= { a: 0, b: 0, t: 1, last: -9, cand: -1, candT: 0, beat: 0 });
		const N = PATTERNS.length;
		let want = S.b;
		const mode = C.mode || 'sound';
		if (mode === 'fixed') want = Math.max(0, Math.min(N - 1, Math.round(C.pattern || 1) - 1));
		else if (mode === 'beat' && this.soundActive) {
			const beatNew = this.levels.beat > 0.9 && S.beat <= 0.9;
			if (beatNew && this._time - S.last > 0.35) want = (S.b + 1 + Math.floor(Math.random() * (N - 1))) % N;
		} else if (mode === 'sound' && this.playing && this.analyser) {
			// высота звука: центр тяжести спектра; узор меняется, когда новая высота держится четверть секунды
			let s = 0, w = 0;
			for (let i = 0; i < 64; i++) {
				s += this.spec[i] * i;
				w += this.spec[i];
			}
			if (w > 0.6) {
				const c = Math.max(0, Math.min(1, (s / w - 4) / 30));
				const k = Math.round(c * (N - 1));
				if (k !== S.cand) {
					S.cand = k;
					S.candT = this._time;
				} else if (this._time - S.candT > 0.25) want = k;
			}
		} else if (this._time - S.last > (C.period || 3)) want = (S.b + 1) % N;
		S.beat = this.levels.beat;
		if (want !== S.b && S.t >= 1) {
			S.a = S.b;
			S.b = want;
			S.t = 0;
			S.last = this._time;
		}
		S.t = Math.min(1, S.t + dt / Math.max(0.1, C.morph ?? 0.8));
		const e = S.t * S.t * (3 - 2 * S.t);
		const A = PATTERNS[S.a], B = PATTERNS[S.b];
		u.uChA.value.set(A[0], A[1], B[0], B[1]);
		u.uCh.value.set(ce, e, C.scale ?? 1, C.buzz ?? 0.6);
	}
}
