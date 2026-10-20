import * as THREE from 'three';

const _v = new THREE.Vector3();

/** Эффект «Гравитационная линза»: где масса на экране и какого размера кольцо Эйнштейна. Методы подмешиваются в EffectsEngine. */
export class LensPart {
	_lensTick(dt, C, u) {
		const le = this._eff(C);
		if (le <= 0.001 || !this.points) {
			u.uLens.value.x = 0;
			return;
		}
		const cam = this.app.viewport.camera;
		const vs = this.app.viewport.size;
		const asp = Math.max(0.1, vs.width / Math.max(1, vs.height));
		// центр формы на экране; курсор или орбита вокруг него
		_v.copy(u.uCen.value);
		this.points.localToWorld(_v);
		_v.project(cam);
		let tx = _v.x, ty = _v.y;
		if (C.target === 'cursor' && this.mouseOn) {
			_v.copy(this.mouse);
			this.points.localToWorld(_v);
			_v.project(cam);
			tx = _v.x;
			ty = _v.y;
		} else if (C.target === 'orbit') {
			this._lensA = (this._lensA || 0) + dt * (C.speed ?? 0.4) * 1.6;
			const r = (C.orbit ?? 0.5) * 0.7;
			tx += (Math.cos(this._lensA) * r) / asp;
			ty += Math.sin(this._lensA) * r * 0.6;
		}
		const S = (this._lensC ||= { x: tx, y: ty });
		const k = 1 - Math.exp(-dt * 10);
		S.x += (tx - S.x) * k;
		S.y += (ty - S.y) * k;
		u.uLensC.value.set(S.x, S.y, 0, 0);
		// сила: плавное включение; масса пульсирует вместе со звуком (через силу эффекта)
		u.uLens.value.set(Math.min(1, le), (C.mass ?? 0.5) * 0.32 * Math.min(1.5, le), C.glow ?? 0.6, asp);
	}
}
