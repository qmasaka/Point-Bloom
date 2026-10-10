// Анимация персонажей: клипы из файла проигрываются на модели в сцене, скелет можно показать.
// Анимацию сайт не создаёт: она приходит готовой вместе с моделью (GLB, glTF, FBX).
import * as THREE from 'three';

export class AnimController {
	constructor(app) {
		this.app = app;
		this.models = []; // { obj, mixer, clips, helper }
		this.playing = false;
		this.speed = 1;
		this.loop = true;
		this.clipIndex = 0;
		this.time = 0;
		this.skeletonOn = false;
		this.version = 0; // растёт при каждой смене позы: по нему точки понимают, что пора пересчитаться
		this._listeners = new Set();
	}

	onChange(fn) {
		this._listeners.add(fn);
		return () => this._listeners.delete(fn);
	}

	_emit() {
		for (const f of this._listeners) f();
	}

	get has() {
		return this.models.length > 0;
	}

	get clips() {
		return this.models.length ? this.models[0].clips : [];
	}

	get duration() {
		const c = this.clips[this.clipIndex];
		return c ? Math.max(c.duration, 0.01) : 1;
	}

	/** Находит в сцене модели с клипами; новые получают проигрыватель, удалённые отпускаются */
	scan() {
		const root = this.app.viewport.root;
		const found = [];
		for (const o of root.children) {
			if (o.userData.helper) continue;
			if (o.userData.clips && o.userData.clips.length) found.push(o);
		}
		const keep = [];
		for (const m of this.models) {
			if (found.includes(m.obj) && m.obj.parent === root) keep.push(m);
			else this._dispose(m);
		}
		for (const obj of found) {
			if (keep.some((m) => m.obj === obj)) continue;
			// у меша со скелетом ограничивающая сфера считается один раз по позе привязки: когда анимация уносит его далеко (прыжки, бег), его бы отсекло как невидимый
			obj.traverse((o) => {
				if (o.isSkinnedMesh) o.frustumCulled = false;
			});
			const mixer = new THREE.AnimationMixer(obj);
			const m = { obj, mixer, clips: obj.userData.clips, helper: null, action: null };
			keep.push(m);
		}
		const had = this.models.length;
		this.models = keep;
		if (this.clipIndex >= this.clips.length) this.clipIndex = 0;
		if (this.models.length && !had) {
			this.playing = true;
			this.time = 0;
		}
		if (!this.models.length) this.playing = false;
		this._setClip();
		this._helpers();
		this.apply();
		this._emit();
	}

	_dispose(m) {
		try {
			m.mixer.stopAllAction();
			m.mixer.uncacheRoot(m.obj);
		} catch (e) {
			/* уже снято */
		}
		if (m.helper) {
			m.helper.removeFromParent();
			m.helper.dispose();
			m.helper = null;
		}
		if (m.joints) {
			m.joints.removeFromParent();
			m.joints.geometry.dispose();
			m.joints = null;
		}
	}

	_setClip() {
		for (const m of this.models) {
			if (m.action) m.action.stop();
			const clip = m.clips[Math.min(this.clipIndex, m.clips.length - 1)];
			m.action = clip ? m.mixer.clipAction(clip) : null;
			if (m.action) {
				m.action.setLoop(THREE.LoopRepeat, Infinity);
				m.action.play();
			}
		}
	}

	_helpers() {
		for (const m of this.models) {
			let hasBones = false;
			m.obj.traverse((o) => {
				if (o.isBone || o.isSkinnedMesh) hasBones = true;
			});
			if (this.skeletonOn && hasBones && !m.helper) {
				m.helper = new THREE.SkeletonHelper(m.obj);
				m.helper.userData.helper = true;
				m.helper.material.depthTest = false;
				m.helper.material.transparent = true;
				m.helper.renderOrder = 999;
				m.helper.frustumCulled = false;
				m.helper.material.toneMapped = false;
				m.helper.material.vertexColors = false;
				m.helper.material.color.set('#ffd27a');
				// суставы крупными точками: одиночные линии в один пиксель на экране почти не видны
				m.bones = [];
				m.obj.traverse((o) => o.isBone && m.bones.push(o));
				const jg = new THREE.BufferGeometry();
				jg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.bones.length * 3), 3));
				m.joints = new THREE.Points(jg, new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, color: '#ff9a3c', depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
				m.joints.userData.helper = true;
				m.joints.frustumCulled = false;
				m.joints.renderOrder = 1000;
				m.joints.matrixAutoUpdate = false;
				this.app.viewport.root.add(m.joints);
				this.app.viewport.root.add(m.helper);
			}
			if (m.helper) m.helper.visible = this.skeletonOn;
			if (m.joints) m.joints.visible = this.skeletonOn;
		}
	}

	setClip(i) {
		this.clipIndex = Math.max(0, Math.min(this.clips.length - 1, i | 0));
		this.time = 0;
		this._setClip();
		this.apply();
		this._emit();
	}

	play() {
		if (!this.has) return;
		this.playing = true;
		this.app.viewport.invalidate();
		this._emit();
	}

	pause() {
		this.playing = false;
		this._emit();
	}

	toggle() {
		if (this.playing) this.pause();
		else this.play();
	}

	seek(t) {
		this.time = Math.max(0, Math.min(this.duration, t));
		this.apply();
		this._emit();
	}

	setSpeed(v) {
		this.speed = v;
		this._emit();
	}

	setLoop(v) {
		this.loop = v;
		this._emit();
	}

	setSkeleton(v) {
		this.skeletonOn = v;
		this._helpers();
		this.app.viewport.invalidate();
		this._emit();
	}

	/** Время клипа берётся со стороны (таймлайн эффектов): клип повторяется по кругу */
	syncTime(t) {
		if (!this.has) return;
		const d = this.duration;
		this.time = this.loop ? (t * this.speed) % d : Math.min(d, t * this.speed);
		this.apply();
	}

	/** Охват всего движения клипа: камера ставится так, чтобы персонаж не уезжал за кадр (прыжки, бег) */
	animatedBounds(samples = 14) {
		const box = new THREE.Box3();
		const saved = this.time;
		for (let i = 0; i <= samples; i++) {
			this.time = (i / samples) * this.duration;
			this.apply();
			for (const m of this.models) {
				m.obj.updateWorldMatrix(true, true);
				// у меша со скелетом габариты кешируются: пересчитываем по текущей позе
				m.obj.traverse((o) => o.isSkinnedMesh && o.computeBoundingBox());
				box.union(new THREE.Box3().setFromObject(m.obj));
			}
		}
		this.time = saved;
		this.apply();
		return box;
	}

	/** Каждый кадр: время идёт, поза обновляется */
	tick(dt) {
		if (!this.has || !this.playing) return false;
		this.time += dt * this.speed;
		const d = this.duration;
		if (this.time >= d) {
			if (this.loop) this.time %= d;
			else {
				this.time = d;
				this.playing = false;
				this._emit();
			}
		} else if (this.time < 0) this.time = this.loop ? d + (this.time % d) : 0;
		this.apply();
		this.app.viewport.invalidate();
		return true;
	}

	/** Облака точек, посаженные на персонажа в редакторе, идут за его позой */
	_movePoints() {
		for (const o of this.app.viewport.root.children) {
			const a = o.userData.animPts;
			if (!a || !o.isPoints) continue;
			const pos = o.geometry.attributes.position;
			if (pos.count !== a.part.length) continue;
			evalAnimPoints(a, null, pos.array);
			pos.needsUpdate = true;
			o.geometry.boundingSphere = null;
			o.geometry.boundingBox = null;
		}
	}

	/** Ставит позу на текущее время; кости и матрицы обновляются, даже если сцена скрыта (режим эффектов) */
	apply() {
		for (const m of this.models) {
			if (!m.action) continue;
			const clip = m.action.getClip();
			m.mixer.setTime(clip.duration > 0 ? Math.min(this.time, clip.duration - 1e-4) : 0);
			m.obj.updateMatrixWorld(true);
			m.obj.traverse((o) => {
				if (o.isSkinnedMesh && o.skeleton) o.skeleton.update();
			});
			if (m.joints && m.bones) {
				const a = m.joints.geometry.attributes.position.array;
				const v = new THREE.Vector3();
				m.bones.forEach((b, i) => {
					b.getWorldPosition(v);
					a[i * 3] = v.x;
					a[i * 3 + 1] = v.y;
					a[i * 3 + 2] = v.z;
				});
				m.joints.geometry.attributes.position.needsUpdate = true;
			}
		}
		this._movePoints();
		// рамка выделения идёт за движущейся моделью
		if (this.app.model?.selection?.length) this.app.viewport.updateSelectionBox();
		else this.app.viewport.invalidate();
		this.version++;
		this.app.bus.emit('animpose');
	}
}

/**
 * Положение точек, посаженных на персонажа, в текущей позе. anim: { parts, part, bp, bi, bw } (см. sampleSurface),
 * norm: приведение к размеру сцены эффектов. Записывает по три числа на точку в out.
 */
export function evalAnimPoints(anim, norm, out, outN = null) {
	const { parts, part, bp, bi, bw, bn } = anim;
	const n = part.length;
	const post = parts.map((p) => {
		const mw = p.mesh.matrixWorld;
		if (p.skinned) {
			const inv = p.mesh.bindMatrixInverse;
			p.mesh.updateWorldMatrix(true, false);
			return { m: new THREE.Matrix4().multiplyMatrices(p.mesh.matrixWorld, inv).elements, bones: p.mesh.skeleton.boneMatrices };
		}
		return { m: mw.elements, bones: null };
	});
	const cx = norm ? norm.cx : 0, cy = norm ? norm.cy : 0, cz = norm ? norm.cz : 0, k = norm ? norm.k : 1;
	for (let i = 0; i < n; i++) {
		const P = post[part[i]];
		const x = bp[i * 3], y = bp[i * 3 + 1], z = bp[i * 3 + 2];
		let sx = x, sy = y, sz = z;
		if (P.bones) {
			sx = sy = sz = 0;
			let wsum = 0;
			const B = P.bones;
			for (let j = 0; j < 4; j++) {
				const w = bw[i * 4 + j];
				if (w <= 0) continue;
				const o = bi[i * 4 + j] * 16;
				sx += w * (B[o] * x + B[o + 4] * y + B[o + 8] * z + B[o + 12]);
				sy += w * (B[o + 1] * x + B[o + 5] * y + B[o + 9] * z + B[o + 13]);
				sz += w * (B[o + 2] * x + B[o + 6] * y + B[o + 10] * z + B[o + 14]);
				wsum += w;
			}
			if (wsum < 1e-6) {
				sx = x;
				sy = y;
				sz = z;
			}
		}
		const e = P.m;
		const wx = e[0] * sx + e[4] * sy + e[8] * sz + e[12];
		const wy = e[1] * sx + e[5] * sy + e[9] * sz + e[13];
		const wz = e[2] * sx + e[6] * sy + e[10] * sz + e[14];
		out[i * 3] = (wx - cx) * k;
		out[i * 3 + 1] = (wy - cy) * k;
		out[i * 3 + 2] = (wz - cz) * k;
		if (outN && bn) {
			// нормаль: та же кость и тот же поворот, без сдвига
			const nx = bn[i * 3], ny = bn[i * 3 + 1], nz = bn[i * 3 + 2];
			let tx = nx, ty = ny, tz = nz;
			if (P.bones && (nx || ny || nz)) {
				tx = ty = tz = 0;
				const B = P.bones;
				let ws = 0;
				for (let j = 0; j < 4; j++) {
					const w = bw[i * 4 + j];
					if (w <= 0) continue;
					const o = bi[i * 4 + j] * 16;
					tx += w * (B[o] * nx + B[o + 4] * ny + B[o + 8] * nz);
					ty += w * (B[o + 1] * nx + B[o + 5] * ny + B[o + 9] * nz);
					tz += w * (B[o + 2] * nx + B[o + 6] * ny + B[o + 10] * nz);
					ws += w;
				}
				if (ws < 1e-6) {
					tx = nx;
					ty = ny;
					tz = nz;
				}
			}
			const gx = e[0] * tx + e[4] * ty + e[8] * tz;
			const gy = e[1] * tx + e[5] * ty + e[9] * tz;
			const gz = e[2] * tx + e[6] * ty + e[10] * tz;
			const gl = Math.hypot(gx, gy, gz) || 1;
			outN[i * 3] = gx / gl;
			outN[i * 3 + 1] = gy / gl;
			outN[i * 3 + 2] = gz / gl;
		}
	}
}
