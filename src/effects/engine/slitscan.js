import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { timeformFrag, timeformVert } from '../shaders/glsl/timeform.js';

/**
 * Кольцевой буфер последних кадров видео на видеокарте (текстура-массив, слой на кадр) и два эффекта на нём.
 * «Слит-скан»: у каждой точки видео своя задержка во времени (по строкам, столбцам, кругам, глубине или пятнам). Шейдер в vert.js (блок VSCREEN, только WebGL).
 * «Время как форма»: прошлые кадры становятся объёмом, время это третья ось; остаются только движущиеся (или светлые, тёмные) места. Отдельный объект со своим шейдером (timeform.js).
 * Методы подмешиваются в EffectsEngine.
 */
export class SlitPart {
	/** Каждый кадр: новый кадр видео ложится в буфер, значения обоих эффектов */
	_slitTick(rgbNew, u) {
		const S = this.state.layers.slitscan;
		const TF = this.state.layers.timeform;
		const pm = this.pm;
		const ok = this.state.source === 'media' && pm.ready && (pm.kind === 'video' || pm.isRec) && this.geometry?.attributes.position.count === pm.count;
		const es = ok && S.on ? clamp(this._eff(S), 0, 1.5) : 0;
		const et = ok && TF.on ? clamp(this._eff(TF), 0, 1.5) : 0;
		// буфер нужен тому эффекту, кто помнит больше кадров
		const need = Math.max(es > 0.001 ? S.frames || 48 : 0, et > 0.001 ? TF.frames || 60 : 0);
		if (!need) {
			u.uSlit.value.x = 0;
			this._timeformTick(null, 0);
			return;
		}
		const H = this._ringTick(rgbNew, need);
		if (es > 0.001) {
			if (u.uSlitTex.value !== H.tex) u.uSlitTex.value = H.tex;
			u.uSlit.value.set(es, S.length ?? 0.8, H.head, { rows: 0, cols: 1, radial: 2, depth: 3, noise: 4 }[S.mode] ?? 0);
			u.uSlitP.value.set(S.dir === 'back' ? -1 : 1, S.sweep || 0, S.push || 0, Math.round(S.bands || 0));
			u.uSlitG.value.set(H.cols, H.rows, H.cols * H.rows, H.M);
		} else u.uSlit.value.x = 0;
		this._timeformTick(H, et);
	}

	/** Буфер не меньше need кадров (и не больше ~64 МБ): новый кадр видео пишется в следующий слой */
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
				// в начале весь буфер заполнен первым кадром: прошлое набирается, пока видео играет
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

	/** «Время как форма»: облако из прошлых кадров, точек в нём столько, сколько задано, поровну на кадр */
	_timeformTick(H, eff) {
		const T = this.state.layers.timeform;
		let O = this._tf;
		if (!H || eff <= 0.001 || !this.points) {
			if (O) O.pts.visible = false;
			return;
		}
		const pm = this.pm;
		const aspect = pm.aspect || H.cols / H.rows;
		const per = Math.max(400, Math.floor((T.pts || 800000) / H.M));
		const gw = Math.max(8, Math.round(Math.sqrt(per * aspect)));
		const gh = Math.max(8, Math.round(gw / aspect));
		const key = gw + 'x' + gh + 'x' + H.M;
		if (!O || O.key !== key || O.pts.parent !== this.points) {
			if (O) {
				O.pts.removeFromParent();
				O.pts.geometry.dispose();
				O.pts.material.dispose();
			}
			// положение точки в буфере: колонка, строка, номер кадра в прошлом (сам шейдер ставит её на место)
			const n = gw * gh * H.M;
			const p = new Float32Array(n * 3);
			let o = 0;
			for (let k = 0; k < H.M; k++) for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
				p[o++] = x;
				p[o++] = y;
				p[o++] = k;
			}
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.BufferAttribute(p, 3));
			const V = (v) => ({ value: v });
			const m = new THREE.ShaderMaterial({ vertexShader: timeformVert, fragmentShader: timeformFrag, transparent: true, depthWrite: false, uniforms: { uRing: V(H.tex), uG: V(new THREE.Vector4()), uP: V(new THREE.Vector4()), uQ: V(new THREE.Vector4()), uT: V(new THREE.Vector4()), uC: V(new THREE.Vector4()), uPR: V(1) } });
			const pts = new THREE.Points(g, m);
			pts.frustumCulled = false;
			pts.userData.helper = true;
			this.points.add(pts);
			O = this._tf = { pts, key };
		}
		const U = O.pts.material.uniforms;
		U.uRing.value = H.tex;
		U.uG.value.set(H.cols, H.rows, H.M, H.head);
		U.uP.value.set(gw, gh, T.length ?? 1, { all: 0, motion: 1, light: 2, dark: 3 }[T.keep] ?? 1);
		const W = aspect >= 1 ? 2.2 : 2.2 * aspect;
		U.uQ.value.set(T.cut ?? 0.3, this.app.settings.point.size * (T.size ?? 1), W, W / aspect);
		U.uT.value.set(T.depth ?? 2, eff, { back: 0, up: 1, side: 2 }[T.dir] ?? 0, T.fade ?? 0.6);
		const c = this.shared.uP2.value;
		U.uC.value.set(c.r, c.g, c.b, T.tint ?? 0.4);
		U.uPR.value = this.shared.uPR.value;
		const add = this.state.look.blend === 'add';
		const bl = add ? THREE.AdditiveBlending : THREE.NormalBlending;
		if (O.pts.material.blending !== bl) {
			O.pts.material.blending = bl;
			O.pts.material.needsUpdate = true;
		}
		O.pts.visible = true;
	}
}
