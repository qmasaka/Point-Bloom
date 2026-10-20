import * as THREE from 'three';

const SLOTS = 16;
// фрагментный шейдер прохода: пиксель хранит положение точки, a = 1 значит «точка нарисована»
const pickFrag = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
	gl_FragColor = vec4(vColor, 1.0);
}
`;

/**
 * Где на самом деле точки рамок слежения. Эффекты (волны, глубина, вихри и другие) двигают точки на видеокарте, а рамки знают только исходные положения,
 * поэтому на видео и под эффектами рамка висела не там, где точка. Здесь до 16 закреплённых точек рисуются тем же шейдером в полоску 16×1 пикселей,
 * в каждом пикселе остаётся итоговое положение, и оно читается обратно без ожидания (результат приходит на следующем кадре).
 * Только для WebGL; при WebGPU рамки остаются на исходных положениях. Методы подмешиваются в EffectsEngine.
 */
export class TrackPickPart {
	/** Готовит проход и отдаёт последний результат: { idxs, data } или null */
	_trackPick(idxs) {
		const g = this.geometry;
		const r = this.app.viewport.renderer;
		if (!g || !this.points || this._glDormant || this._tpFailed || !r.capabilities?.isWebGL2) return null;
		let P = this._tp;
		if (!P || P.src !== g) {
			P?.pts.geometry.dispose();
			P?.pts.material.dispose();
			const pg = new THREE.BufferGeometry();
			for (const [name, a] of Object.entries(g.attributes)) pg.setAttribute(name, new THREE.BufferAttribute(new a.array.constructor(SLOTS * a.itemSize), a.itemSize));
			const m = new THREE.ShaderMaterial({ vertexShader: this._fxSource('vert', this._fxCur || new Set()), fragmentShader: pickFrag, defines: { TRACKPICK: 1 }, uniforms: { ...this.shared, uTOff: { value: 0 }, uGhost: { value: 1 }, uHero: { value: new THREE.Vector4() } }, depthTest: false, depthWrite: false, transparent: false });
			const pts = new THREE.Points(pg, m);
			pts.frustumCulled = false;
			pts.matrixAutoUpdate = false;
			const scene = new THREE.Scene();
			scene.add(pts);
			const rt = P?.rt || new THREE.WebGLRenderTarget(SLOTS, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
			P = this._tp = { src: g, pts, scene, rt, buf: new Float32Array(SLOTS * 4), res: null, pending: false, sig: this._fxSig() };
		}
		// шейдер следует за набором включённых эффектов, как у самого облака
		const sig = this._fxSig();
		if (P.sig !== sig) {
			P.sig = sig;
			P.pts.material.vertexShader = this._fxSource('vert', this._fxCur);
			P.pts.material.needsUpdate = true;
		}
		// пока программа собирается в фоне, рамки идут по исходным положениям
		if (!this._gate('pick', true)) return P.res;
		const pg = P.pts.geometry;
		const used = idxs.slice(0, SLOTS);
		for (const [name, a] of Object.entries(pg.attributes)) {
			const s = g.attributes[name];
			if (!s) continue;
			const k = a.itemSize;
			for (let i = 0; i < SLOTS; i++) {
				const id = used[i];
				if (id == null || id * k >= s.array.length) {
					if (name === 'aHide') a.array[i] = 1;
					continue;
				}
				for (let c = 0; c < k; c++) a.array[i * k + c] = s.array[id * k + c];
			}
			a.needsUpdate = true;
		}
		P.pts.matrixWorld.copy(this.points.matrixWorld);
		const prev = r.getRenderTarget();
		const cc = r.getClearColor(new THREE.Color());
		const ca = r.getClearAlpha();
		try {
			r.setRenderTarget(P.rt);
			r.setClearColor(0x000000, 0);
			r.clear(true, false, false);
			r.render(P.scene, this.app.viewport.camera);
		} finally {
			r.setRenderTarget(prev);
			r.setClearColor(cc, ca);
		}
		if (!P.pending) {
			P.pending = true;
			const snap = used.slice();
			r.readRenderTargetPixelsAsync(P.rt, 0, 0, SLOTS, 1, P.buf)
				.then(() => {
					P.res = { idxs: snap, data: P.buf.slice() };
				})
				.catch(() => {
					// чтение не поддерживается: рамки остаются на исходных положениях
					this._tpFailed = true;
				})
				.finally(() => (P.pending = false));
		}
		return P.res;
	}
}
