import * as THREE from 'three';
import { clamp } from '../../core/util.js';

const W = 2048; // ширина текстуры смещений: строки по 2048 точек

/**
 * Эффект «Пиксельная сортировка»: в каждой строке (или столбце) кадра точки внутри полос, где яркость проходит отбор, пересортировываются по яркости,
 * и каждая точка едет на своё новое место вместе со своим цветом. Куда ехать, считает процессор на каждый новый кадр (смещение на точку в текстуре),
 * а как далеко сейчас доехала, решает шейдер (блок VSCREEN в vert.js, в WebGL и WebGPU): держит, бежит волной, дышит или вспыхивает на ударе.
 * Методы подмешиваются в EffectsEngine.
 */
export class PixelSortPart {
	_sortTick(rgbNew, u) {
		const P = this.state.layers.pixelsort;
		const pm = this.pm;
		const ok = this.state.source === 'media' && pm.ready && this.geometry?.attributes.position.count === pm.count;
		const pe = ok && P.on ? clamp(this._eff(P), 0, 1.5) : 0;
		if (pe <= 0.001) {
			u.uSort.value.x = 0;
			return;
		}
		const cols = pm.cols, rows = pm.rows, n = cols * rows;
		let S = this._sort;
		if (!S || S.n !== n) {
			S?.tex.dispose();
			const H = Math.ceil(n / W);
			const tex = new THREE.DataTexture(new Float32Array(W * H * 2), W, H, THREE.RGFormat, THREE.FloatType);
			tex.minFilter = tex.magFilter = THREE.NearestFilter;
			tex.generateMipmaps = false;
			S = this._sort = { n, tex, rgb: null, sig: '', lum: new Float32Array(n), idx: new Int32Array(Math.max(cols, rows)) };
		}
		// у фото кадр один: храним его, чтобы пересортировать при смене настроек
		if (rgbNew) S.rgb = rgbNew.slice ? rgbNew.slice() : rgbNew;
		if (!S.rgb) S.rgb = pm.sample();
		const sig = [P.dir, P.rule, P.cut, P.cut2, P.order, P.minLen].join('|');
		if (rgbNew || sig !== S.sig) {
			S.sig = sig;
			this._sortCompute(S, P, cols, rows);
		}
		if (u.uSortTex.value !== S.tex) u.uSortTex.value = S.tex;
		u.uSort.value.set(pe, { hold: 0, wave: 1, beat: 2, breath: 3 }[P.anim] ?? 0, P.speed ?? 1, P.dir === 'v' ? 1 : 0);
		u.uSortP.value.set(n, cols, P.stretch ?? 1, P.glow ?? 0.3);
	}

	/** Сортировка полос: для каждой точки смещение (по x или y, в единицах сцены) до её места в отсортированной полосе */
	_sortCompute(S, P, cols, rows) {
		const { rgb, lum, idx } = S;
		const n = cols * rows;
		for (let i = 0, k = 0; i < n; i++, k += 3) lum[i] = Math.pow((0.299 * rgb[k] + 0.587 * rgb[k + 1] + 0.114 * rgb[k + 2]) / 255, 1 / 2.2);
		const a = Math.min(P.cut ?? 0.35, P.cut2 ?? 0.85), b = Math.max(P.cut ?? 0.35, P.cut2 ?? 0.85);
		const rule = P.rule || 'bright';
		const pass = (l) => (rule === 'bright' ? l >= a : rule === 'dark' ? l <= a : l >= a && l <= b);
		const vert = P.dir === 'v';
		const lines = vert ? cols : rows;
		const len = vert ? rows : cols;
		const asp = this.pm.aspect || cols / rows;
		const Wd = asp >= 1 ? 2.2 : 2.2 * asp;
		const unit = vert ? -(Wd / asp) / rows : Wd / cols;
		const desc = P.order === 'down';
		const minLen = Math.max(2, Math.round(P.minLen ?? 4));
		const d = S.tex.image.data;
		d.fill(0);
		const at = (line, j) => (vert ? j * cols + line : line * cols + j);
		for (let line = 0; line < lines; line++) {
			let j = 0;
			while (j < len) {
				if (!pass(lum[at(line, j)])) {
					j++;
					continue;
				}
				let e = j;
				while (e < len && pass(lum[at(line, e)])) e++;
				const m = e - j;
				if (m >= minLen) {
					for (let q = 0; q < m; q++) idx[q] = j + q;
					const sub = idx.subarray(0, m);
					sub.sort((x, y) => (desc ? lum[at(line, y)] - lum[at(line, x)] : lum[at(line, x)] - lum[at(line, y)]));
					// точка, стоявшая на sub[q], едет на место j + q
					for (let q = 0; q < m; q++) {
						const from = sub[q];
						const p = at(line, from);
						d[p * 2 + (vert ? 1 : 0)] = (j + q - from) * unit;
					}
				}
				j = e;
			}
		}
		S.tex.needsUpdate = true;
	}
}
