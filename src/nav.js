// Навигация по сцене в стиле Blender:
//   СКМ — вращение, Shift+СКМ — сдвиг, Ctrl+СКМ — масштаб, колесо — зум (к курсору),
//   Alt+ЛКМ — эмуляция СКМ (для трекпада), ПКМ-перетаскивание — сдвиг,
//   ЛКМ-перетаскивание по пустому месту — вращение (можно отключить).
import * as THREE from 'three';
import { clamp } from './util.js';

const HALF_PI = Math.PI / 2;

export const VIEWS = {
	front: { yaw: 0, pitch: 0, label: 'Спереди' },
	back: { yaw: Math.PI, pitch: 0, label: 'Сзади' },
	right: { yaw: HALF_PI, pitch: 0, label: 'Справа' },
	left: { yaw: -HALF_PI, pitch: 0, label: 'Слева' },
	top: { yaw: 0, pitch: -HALF_PI, label: 'Сверху' },
	bottom: { yaw: 0, pitch: HALF_PI, label: 'Снизу' },
};

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const qYaw = new THREE.Quaternion();
const qPitch = new THREE.Quaternion();
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_X = new THREE.Vector3(1, 0, 0);

export class Nav {
	constructor(app) {
		this.app = app;
		this.vp = app.viewport;
		this.dom = this.vp.canvas;
		this.target = new THREE.Vector3(0, 0, 0);
		this.yaw = 0.7;
		this.pitch = -0.45;
		this.distance = 4;
		this.refDistance = 4;
		this.ortho = !!app.settings.nav.ortho;
		this.autoOrtho = false;
		this.enabled = true;
		this.tween = null;
		this.pointers = new Map();
		this.drag = null;
		this.q = new THREE.Quaternion();
		this._gestureScale = 1;
		this.bind();
	}

	get settings() {
		return this.app.settings.nav;
	}
	get camera() {
		return this.ortho ? this.vp.orthoCam : this.vp.perspCam;
	}

	// ---------------------------------------------------------------- камера
	applyCamera() {
		const cam = this.camera;
		const { width, height } = this.vp.size;
		const aspect = width / Math.max(1, height);
		qYaw.setFromAxisAngle(AX_Y, this.yaw);
		qPitch.setFromAxisAngle(AX_X, this.pitch);
		this.q.copy(qYaw).multiply(qPitch);
		cam.quaternion.copy(this.q);
		cam.position.set(0, 0, this.distance).applyQuaternion(this.q).add(this.target);
		const R = this.vp.sceneRadius;
		const d = this.distance;
		const fov = THREE.MathUtils.degToRad(this.app.settings.render.fov);
		if (this.ortho) {
			const halfH = d * Math.tan(fov / 2);
			cam.left = -halfH * aspect;
			cam.right = halfH * aspect;
			cam.top = halfH;
			cam.bottom = -halfH;
			const S = Math.max(R, d);
			cam.near = -S * 50;
			cam.far = S * 50 + d;
		} else {
			cam.fov = this.app.settings.render.fov;
			cam.aspect = aspect;
			cam.near = Math.max(d * 0.01, 1e-6);
			cam.far = Math.max(d * 100, (d + R) * 20);
		}
		cam.updateProjectionMatrix();
		cam.updateMatrixWorld(true);
		this.vp.invalidate();
		this.app.bus.emit('camera');
	}

	setOrtho(v, auto = false) {
		if (this.ortho === v) {
			this.autoOrtho = v && auto;
			return;
		}
		this.ortho = v;
		this.autoOrtho = v && auto;
		this.vp.setActiveCamera(this.camera);
		this.applyCamera();
		this.app.bus.emit('viewmode');
	}
	toggleOrtho() {
		this.setOrtho(!this.ortho, false);
		this.app.settings.nav.ortho = this.ortho;
	}

	// ------------------------------------------------------- виды и анимация
	cancelTween() {
		this.tween = null;
	}

	animateTo(to, ms = 320) {
		const from = { target: this.target.clone(), yaw: this.yaw, pitch: this.pitch, distance: this.distance };
		// если анимация уже идёт, недостающие параметры берём из её конечной точки (быстрые подряд команды не теряют кадрирование)
		const base = this.tween ? this.tween.to : from;
		const dest = {
			target: to.target ? to.target.clone() : base.target.clone(),
			yaw: to.yaw ?? base.yaw,
			pitch: to.pitch ?? base.pitch,
			distance: to.distance ?? base.distance,
		};
		const TAU = Math.PI * 2;
		const dyaw = ((((dest.yaw - from.yaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
		dest.yaw = from.yaw + dyaw;
		if (ms <= 0) {
			this.target.copy(dest.target);
			this.yaw = dest.yaw;
			this.pitch = dest.pitch;
			this.distance = dest.distance;
			this.applyCamera();
			return;
		}
		this.tween = { from, to: dest, t0: performance.now(), ms };
		this.vp.invalidate();
	}

	/** Вызывается каждый кадр. Возвращает true, пока идёт анимация. */
	tick(now) {
		const tw = this.tween;
		if (!tw) return false;
		const t = clamp((now - tw.t0) / tw.ms, 0, 1);
		const e = easeOut(t);
		this.target.lerpVectors(tw.from.target, tw.to.target, e);
		this.yaw = tw.from.yaw + (tw.to.yaw - tw.from.yaw) * e;
		this.pitch = tw.from.pitch + (tw.to.pitch - tw.from.pitch) * e;
		this.distance = Math.exp(Math.log(tw.from.distance) + (Math.log(tw.to.distance) - Math.log(tw.from.distance)) * e);
		this.applyCamera();
		if (t >= 1) this.tween = null;
		return true;
	}

	setView(name, opposite = false) {
		let key = name;
		if (opposite) key = { front: 'back', back: 'front', left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[name];
		const v = VIEWS[key];
		if (!v) return;
		this.animateTo({ yaw: v.yaw, pitch: v.pitch });
		if (this.settings.autoPersp) this.setOrtho(true, true);
		this.app.bus.emit('viewmode');
	}

	resetView() {
		this.setOrtho(false);
		this.animateTo({ yaw: 0.7, pitch: -0.45 });
		this.frameAll(false);
	}

	fitDistance(radius) {
		const half = THREE.MathUtils.degToRad(this.app.settings.render.fov) / 2;
		const { width, height } = this.vp.size;
		const asp = Math.min(1, width / Math.max(1, height));
		const k = this.ortho ? Math.tan(half) : Math.sin(half);
		return (radius * 1.15) / (k * asp);
	}

	frameBox(box, animate = true, setRef = false) {
		if (!box || box.isEmpty()) return;
		const sphere = box.getBoundingSphere(new THREE.Sphere());
		const dist = this.fitDistance(Math.max(sphere.radius, 1e-5));
		if (setRef) this.refDistance = dist;
		this.animateTo({ target: sphere.center, distance: dist }, animate ? 320 : 0);
	}

	frameAll(animate = true) {
		const box = this.vp.getBounds(this.vp.root);
		if (box.isEmpty()) {
			this.refDistance = 4;
			this.animateTo({ target: new THREE.Vector3(0, 0, 0), distance: 4 }, animate ? 320 : 0);
			return;
		}
		this.frameBox(box, animate, true);
	}

	frameSelected(animate = true) {
		const sel = this.app.model.selected;
		if (!sel) return this.frameAll(animate);
		this.frameBox(this.vp.getBounds(sel), animate, false);
	}

	focusPoint(point) {
		this.animateTo({ target: point });
	}

	// ----------------------------------------------------------- манипуляции
	get limits() {
		const R = Math.max(this.vp.sceneRadius, 1e-3);
		return { min: Math.max(R * 1e-4, 1e-7), max: Math.max(R * 400, 1) };
	}

	orbit(dx, dy) {
		this.cancelTween();
		if (this.ortho && this.autoOrtho && this.settings.autoPersp) this.setOrtho(false);
		const s = 0.0055;
		this.yaw -= dx * s;
		this.pitch = clamp(this.pitch - dy * s, -HALF_PI, HALF_PI);
		this.applyCamera();
		this.app.bus.emit('viewmode');
	}

	pan(dx, dy) {
		this.cancelTween();
		const { height } = this.vp.size;
		const fov = THREE.MathUtils.degToRad(this.app.settings.render.fov);
		const k = (2 * this.distance * Math.tan(fov / 2)) / Math.max(1, height);
		const right = tmpV.set(1, 0, 0).applyQuaternion(this.q);
		this.target.addScaledVector(right, -dx * k);
		const up = tmpV.set(0, 1, 0).applyQuaternion(this.q);
		this.target.addScaledVector(up, dy * k);
		this.applyCamera();
	}

	/** factor < 1 — приблизить, > 1 — отдалить. cx/cy — позиция курсора (zoom to cursor) */
	zoom(factor, cx, cy) {
		this.cancelTween();
		const { min, max } = this.limits;
		const d0 = this.distance;
		const d1 = clamp(d0 * factor, min, max);
		const k = d1 / d0;
		if (this.settings.zoomToCursor && cx !== undefined) {
			const rect = this.dom.getBoundingClientRect();
			const nx = ((cx - rect.left) / rect.width) * 2 - 1;
			const ny = -(((cy - rect.top) / rect.height) * 2 - 1);
			const fov = THREE.MathUtils.degToRad(this.app.settings.render.fov);
			const halfH = d0 * Math.tan(fov / 2);
			const halfW = halfH * (rect.width / rect.height);
			const right = tmpV.set(1, 0, 0).applyQuaternion(this.q).multiplyScalar(nx * halfW);
			const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q).multiplyScalar(ny * halfH);
			this.target.addScaledVector(right.add(up), 1 - k);
		}
		this.distance = d1;
		this.applyCamera();
	}

	orbitStep(dYaw, dPitch) {
		this.animateTo({ yaw: this.yaw + dYaw, pitch: clamp(this.pitch + dPitch, -HALF_PI, HALF_PI) }, 160);
		if (this.ortho && this.autoOrtho && this.settings.autoPersp) this.setOrtho(false);
	}

	/** Имя оси-вида ('front', 'top'…), если камера смотрит строго вдоль оси, иначе null */
	axisView() {
		const TAU = Math.PI * 2;
		const near = (a, b) => Math.abs((((a - b + Math.PI) % TAU) + TAU) % TAU - Math.PI) < 1e-3;
		for (const [name, v] of Object.entries(VIEWS)) {
			if (Math.abs(this.pitch - v.pitch) < 1e-3 && (Math.abs(Math.abs(v.pitch) - HALF_PI) < 1e-3 || near(this.yaw, v.yaw))) return name;
		}
		return null;
	}

	/** Название текущего вида («Сверху», «Перспектива»…) */
	viewLabel() {
		const TAU = Math.PI * 2;
		const near = (a, b) => Math.abs((((a - b + Math.PI) % TAU) + TAU) % TAU - Math.PI) < 1e-3;
		for (const v of Object.values(VIEWS)) {
			if (Math.abs(this.pitch - v.pitch) < 1e-3 && (Math.abs(Math.abs(v.pitch) - HALF_PI) < 1e-3 || near(this.yaw, v.yaw))) {
				return (this.ortho ? 'Ортогонально · ' : 'Перспектива · ') + v.label;
			}
		}
		return this.ortho ? 'Ортогональная проекция' : 'Перспектива';
	}

	// ----------------------------------------------------------------- события
	bind() {
		const el = this.dom;
		el.addEventListener('pointerdown', (e) => this.onDown(e));
		el.addEventListener('pointermove', (e) => this.onMove(e));
		el.addEventListener('pointerup', (e) => this.onUp(e));
		el.addEventListener('pointercancel', (e) => this.onUp(e));
		el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
		el.addEventListener('contextmenu', (e) => e.preventDefault());
		el.addEventListener('dblclick', (e) => this.app.bus.emit('dblclick', e));
		// Safari: жест щипка приходит как gesture*-события
		el.addEventListener('gesturestart', (e) => {
			e.preventDefault();
			this._gestureScale = 1;
		});
		el.addEventListener('gesturechange', (e) => {
			e.preventDefault();
			const f = this._gestureScale / (e.scale || 1);
			this._gestureScale = e.scale || 1;
			this.zoom(f);
		});
	}

	modeFor(e) {
		const shift = e.shiftKey;
		const ctrl = e.ctrlKey || e.metaKey;
		const mod = shift ? 'pan' : ctrl ? 'zoom' : 'orbit';
		if (e.button === 1 || (e.button === 0 && e.altKey)) return mod;
		if (e.button === 2) return ctrl ? 'zoom' : shift ? 'orbit' : 'pan';
		// режим рисования: левая кнопка не вращает сцену (рисует кисть), вращение по Alt; два пальца на тачскрине по-прежнему двигают вид
		if (e.button === 0 && this.paintLock) return null;
		if (e.button === 0) return this.settings.leftOrbit || e.pointerType === 'touch' ? 'pending' : 'click';
		return null;
	}

	onDown(e) {
		if (!this.enabled) return;
		const tc = this.vp.tc;
		if (tc && (tc.dragging || tc.axis !== null)) return; // перехватил гизмо трансформации
		if (e.button === 1) e.preventDefault();
		this.dom.setPointerCapture(e.pointerId);
		this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (this.pointers.size === 2) {
			const [a, b] = [...this.pointers.values()];
			this.drag = { mode: 'touch2', dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, moved: true };
			return;
		}
		const mode = this.modeFor(e);
		if (!mode) return;
		this.drag = { mode, button: e.button, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: mode !== 'pending' && mode !== 'click' };
		this.vp.container.classList.add(mode === 'orbit' || mode === 'pending' ? 'nav-orbit' : mode === 'pan' ? 'nav-pan' : 'nav-zoom');
	}

	onMove(e) {
		if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		const d = this.drag;
		if (!d) return;
		if (d.mode === 'touch2') {
			if (this.pointers.size < 2) return;
			const [a, b] = [...this.pointers.values()];
			const dist = Math.hypot(a.x - b.x, a.y - b.y);
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			this.pan(mx - d.mx, my - d.my);
			if (dist > 1 && d.dist > 1) this.zoom(d.dist / dist, mx, my);
			d.dist = dist;
			d.mx = mx;
			d.my = my;
			return;
		}
		if (d.mode === 'pending' || d.mode === 'click') {
			if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
			d.moved = true;
			if (d.mode === 'click') return;
			d.mode = e.shiftKey ? 'pan' : e.ctrlKey || e.metaKey ? 'zoom' : 'orbit';
			d.lx = d.sx;
			d.ly = d.sy;
		}
		const dx = e.clientX - d.lx;
		const dy = e.clientY - d.ly;
		d.lx = e.clientX;
		d.ly = e.clientY;
		if (d.mode === 'orbit') this.orbit(dx, dy);
		else if (d.mode === 'pan') this.pan(dx, dy);
		else if (d.mode === 'zoom') this.zoom(Math.exp(dy * 0.01), d.sx, d.sy);
	}

	onUp(e) {
		const d = this.drag;
		this.pointers.delete(e.pointerId);
		try {
			this.dom.releasePointerCapture(e.pointerId);
		} catch (err) {
			/* уже отпущен */
		}
		if (!d) return;
		if (this.pointers.size === 0) {
			this.vp.container.classList.remove('nav-orbit', 'nav-pan', 'nav-zoom');
			if ((d.mode === 'pending' || d.mode === 'click') && !d.moved && d.button === 0 && e.type === 'pointerup') {
				this.app.bus.emit('click', e);
			}
			this.drag = null;
		} else if (d.mode === 'touch2') {
			this.drag = null;
		}
	}

	onWheel(e) {
		if (!this.enabled) return;
		e.preventDefault();
		const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
		const dx = e.deltaX * unit;
		const dy = e.deltaY * unit;
		const inv = this.settings.invertZoom ? -1 : 1;
		if (e.ctrlKey) {
			// щипок на трекпаде (или Ctrl+колесо)
			this.zoom(Math.exp(dy * 0.01 * inv), e.clientX, e.clientY);
		} else if (this.settings.trackpad) {
			if (e.shiftKey) this.pan(-dx, -dy);
			else this.orbit(dx * 0.6, dy * 0.6);
		} else if (e.shiftKey) {
			this.pan(-(dx || dy), 0);
		} else if (e.altKey) {
			this.pan(0, -dy);
		} else {
			this.zoom(Math.exp(dy * 0.0013 * inv), e.clientX, e.clientY);
		}
	}
}
