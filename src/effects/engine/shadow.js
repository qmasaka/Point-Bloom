import * as THREE from 'three';
import { shadowFrag, surfaceFrag, surfaceVert } from '../shaders/glsl/shadow-frag.js';

const _box = new THREE.Box3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

/**
 * Эффект «Тень на стене»: вторая копия облака с тем же шейдером эффектов (define SHADOW) проецируется по лучу света на пол или стену в мировых координатах.
 * Рядом рисуется поверхность, на которую тень падает: тёмную тень иначе не видно на тёмном фоне. Только WebGL. Методы подмешиваются в EffectsEngine.
 */
export class ShadowPart {
	_shadowTick(dt, C, u) {
		const se = this._eff(C);
		const sh = this._shadow;
		if (se <= 0.001 || !this.points || !this.geometry) {
			if (sh) sh.pts.visible = sh.plane.visible = false;
			return;
		}
		let S = sh;
		if (!S || S.pts.parent !== this.points || S.pts.geometry !== this.geometry) S = this._shadowMake();
		const U = S.pts.material.uniforms;
		// свет: высота над горизонтом и направление по кругу; «Свет ходит» крутит его вокруг формы
		this._shdAz = (this._shdAz || 0) + dt * (C.spin || 0) * 0.6;
		const el = ((C.el ?? 45) * Math.PI) / 180;
		const az = ((C.az ?? 30) * Math.PI) / 180 + this._shdAz;
		const wall = C.plane === 'wall';
		U.uShdL.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az), wall ? 1 : 0);
		if (wall && U.uShdL.value.z < 0.15) U.uShdL.value.z = 0.15;
		// где плоскость: пол под формой, стена за ней (по мировой рамке формы)
		const g = this.geometry;
		if (!g.boundingBox) g.computeBoundingBox();
		_box.copy(g.boundingBox).applyMatrix4(this.points.matrixWorld);
		const cx = (_box.min.x + _box.max.x) / 2, cy = (_box.min.y + _box.max.y) / 2, cz = (_box.min.z + _box.max.z) / 2;
		const planeAt = wall ? _box.min.z - (C.dist ?? 0.6) : _box.min.y - 0.02;
		U.uShdP.value.set(planeAt, (C.fall ?? 0.3) * 1.5, 0, 0);
		U.uShd.value.set(Math.min(1, se), C.soft ?? 0.5, { dark: 0, glow: 1, model: 2 }[C.color] ?? 0, C.flicker || 0);
		U.uTOff.value = C.delay || 0;
		const glow = C.color === 'glow' || C.color === 'model';
		const bl = glow ? THREE.AdditiveBlending : THREE.NormalBlending;
		if (S.pts.material.blending !== bl) {
			S.pts.material.blending = bl;
			S.pts.material.needsUpdate = true;
		}
		S.pts.visible = this._gate('shadow', true);
		// поверхность: стоит в мире, поэтому её матрица считается мимо вращения формы
		const P = S.plane;
		P.visible = C.surface !== 'off';
		const size = Math.max(_box.max.x - _box.min.x, _box.max.y - _box.min.y, _box.max.z - _box.min.z) * 3.2 + 2;
		if (wall) _m.makeTranslation(cx, cy, planeAt).multiply(new THREE.Matrix4().makeScale(size, size, 1));
		else _m.makeTranslation(cx, planeAt, cz).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(size, size, 1));
		this.points.updateMatrixWorld();
		P.matrix.copy(_inv.copy(this.points.matrixWorld).invert()).multiply(_m);
		const light = document.documentElement.dataset.theme === 'light';
		P.material.uniforms.uC.value.set(glow ? '#0d0f13' : light ? '#ffffff' : '#9aa1ad');
		P.material.uniforms.uA.value = (C.wallBright ?? 0.5) * 0.35 * Math.min(1, se);
	}

	_shadowMake() {
		const old = this._shadow;
		if (old) {
			old.pts.removeFromParent();
			old.pts.material.dispose();
			old.plane.removeFromParent();
			old.plane.geometry.dispose();
			old.plane.material.dispose();
		}
		const U = (v) => ({ value: v });
		const m = new THREE.ShaderMaterial({
			vertexShader: this._fxSource('vert', this._fxCur || (this._fxCur = new Set())),
			fragmentShader: shadowFrag,
			defines: { SHADOW: 1 },
			transparent: true,
			depthWrite: false,
			blending: THREE.NormalBlending,
			userData: { fxKind: 'vert' },
			uniforms: { ...this.shared, uTOff: U(0), uGhost: U(1), uHero: U(new THREE.Vector4()), uShd: U(new THREE.Vector4()), uShdL: U(new THREE.Vector4(0, 1, 0, 0)), uShdP: U(new THREE.Vector4()), uShdC: U(new THREE.Color(0.006, 0.007, 0.01)) },
		});
		const pts = new THREE.Points(this.geometry, m);
		pts.frustumCulled = false;
		pts.renderOrder = -1;
		pts.userData.helper = true;
		pts.visible = false;
		const plane = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.ShaderMaterial({ vertexShader: surfaceVert, fragmentShader: surfaceFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uC: U(new THREE.Color()), uA: U(0) } })
		);
		plane.matrixAutoUpdate = false;
		plane.renderOrder = -2;
		plane.frustumCulled = false;
		plane.userData.helper = true;
		plane.visible = false;
		this.points.add(plane, pts);
		this._shadow = { pts, plane };
		return this._shadow;
	}
}
