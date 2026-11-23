import * as THREE from 'three';
import { clamp } from '../../core/util.js';

export class SlitPart {
	_slitTick(rgbNew, u) {
		const { slitscan: S, tsplit: T, mrelief: R } = this.state.layers;
		const pm = this.pm;
		const ok = this.state.source === 'media' && pm.ready && (pm.kind === 'video' || pm.isRec) && this.geometry?.attributes.position.count === pm.count;
		const es = ok && S.on ? clamp(this._eff(S), 0, 1.5) : 0;
		const et = ok && T.on ? clamp(this._eff(T), 0, 1.5) : 0;
		const er = ok && R.on ? clamp(this._eff(R), 0, 1.5) : 0;
		u.uTsplit.value.x = et;
		u.uMrel.value.x = er;
		if (es <= 0.001) u.uSlit.value.x = 0;
		if (es <= 0.001 && et <= 0.001 && er <= 0.001) return;
		const need = Math.max(es > 0.001 ? S.frames || 48 : 0, et > 0.001 ? T.spread * 2 + 4 : 0, er > 0.001 ? Math.ceil(R.memory) + 4 : 0);
		const H = this._ringTick(rgbNew, need);
		if (u.uSlitTex.value !== H.tex) u.uSlitTex.value = H.tex;
		u.uHist.value.set(H.cols, H.rows, H.head, H.M);
		if (es > 0.001) {
			u.uSlit.value.set(es, S.length ?? 0.8, H.head, { rows: 0, cols: 1, radial: 2, depth: 3, noise: 4 }[S.mode] ?? 0);
			u.uSlitP.value.set(S.dir === 'back' ? -1 : 1, S.sweep || 0, S.push || 0, Math.round(S.bands || 0));
			u.uSlitG.value.set(H.cols, H.rows, H.cols * H.rows, H.M);
		}
		if (et > 0.001) {
			const angle = (T.spin || 0) * Math.PI / 180 * this._time;
			u.uTsplit.value.set(et, { time: 0, space: 1, both: 2 }[T.mode] ?? 0, T.spread, 0);
			u.uTsplit2.value.set(T.shift, angle, T.sat, T.gain);
		}
		if (er > 0.001) {
			u.uMrel.value.set(er, { push: 0, scatter: 1, lift: 2 }[R.mode] ?? 0, R.gain, Math.max(3, R.memory));
			u.uMrel2.value.set(R.threshold, R.dim, R.size, R.tint);
			u.uMrel3.value.set(R.height, 0, 0, 0);
		}
	}

	_ringTick(rgbNew, need) {
		const pm = this.pm;
		const cols = pm.cols, rows = pm.rows;
		const per = cols * rows * 4;
		const M = Math.max(4, Math.min(Math.round(need), Math.floor(64e6 / per)));
		let H = this._slit;
		if (!H || H.cols !== cols || H.rows !== rows || H.M !== M) {
			H?.tex.dispose();
			const data = new Uint8Array(per * M);
			const tex = new THREE.DataArrayTexture(data, cols, rows, M);
			tex.format = THREE.RGBAFormat;
			tex.type = THREE.UnsignedByteType;
			tex.colorSpace = THREE.SRGBColorSpace;
			tex.minFilter = tex.magFilter = THREE.NearestFilter;
			tex.generateMipmaps = false;
			tex.unpackAlignment = 1;
			H = this._slit = { cols, rows, M, data, tex, head: 0, filled: false };
		}
		const rgb = rgbNew || (!H.filled ? pm.sample() : null);
		if (rgb) {
			const write = (layer) => {
				const d = H.data;
				let o = layer * per;
				for (let i = 0; i < rgb.length; i += 3) {
					d[o] = rgb[i];
					d[o + 1] = rgb[i + 1];
					d[o + 2] = rgb[i + 2];
					d[o + 3] = 255;
					o += 4;
				}
			};
			if (!H.filled) {
				for (let l = 0; l < M; l++) write(l);
				H.filled = true;
				H.tex.clearLayerUpdates?.();
			} else {
				H.head = (H.head + 1) % M;
				write(H.head);
				H.tex.addLayerUpdate?.(H.head);
			}
			H.tex.needsUpdate = true;
		}
		return H;
	}
}
