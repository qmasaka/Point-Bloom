// Правка точек: выделение кистью или рамкой, удаление и перекраска выбранных точек у облака точек.
import * as THREE from 'three';
import { h } from './util.js';

export class PointEditor {
	constructor(app) {
		this.app = app;
		this.active = false;
		this.tool = 'brush'; // brush | rect
		this.mode = 'add'; // add | sub
		this.radius = 36;
		this.through = false; // выделять и точки за поверхностью
		this.obj = null;
		this.sel = null;
		this.count = 0;
		this._proj = null;
		this._drag = null;
		this._raf = 0;
		this._cursor = h('div', { class: 'pe-cursor', hidden: true });
		this._rect = h('div', { class: 'pe-rect', hidden: true });
		this._lasso = h('canvas', { class: 'pe-lasso', hidden: true });
		document.getElementById('viewport').append(this._cursor, this._rect, this._lasso);
		const el = app.viewport.canvas;
		el.addEventListener('pointerdown', (e) => this._down(e));
		el.addEventListener('pointermove', (e) => this._move(e));
		el.addEventListener('pointerup', (e) => this._up(e));
		el.addEventListener('pointercancel', (e) => this._up(e));
		el.addEventListener('pointerleave', () => (this._cursor.hidden = true));
		// клавиши правки перехватываются раньше общих: Delete и X здесь удаляют точки, а не весь объект
		window.addEventListener('keydown', (e) => this._key(e), true);
		app.bus.on('tool', () => this._syncTool());
		app.bus.on('selection', () => this.retarget());
		app.bus.on('scene', () => this.retarget());
	}

	// ---------------------------------------------------------------- цель
	target() {
		const o = this.app.model.selected;
		return o && o.isPoints && !o.userData.helper && o.geometry.attributes.position ? o : null;
	}

	retarget() {
		const t = this.target();
		const n = t ? t.geometry.attributes.position.count : 0;
		if (t === this.obj && this.sel && this.sel.length === n) return;
		this._clearOverlay();
		this.obj = t;
		this.sel = t ? new Uint8Array(n) : null;
		this.count = 0;
		this._proj = null;
		this._emit();
	}

	get isPointTool() {
		return this.app.model.tool === 'psel';
	}

	/** Включить или выключить правку: это инструмент в левой колонке, поэтому всё идёт через model.setTool */
	setActive(on) {
		const model = this.app.model;
		if (on) model.setTool('psel');
		else if (this.isPointTool) model.setTool(this._back || 'select');
	}

	/** Способ выделения: 'brush', 'rect' или 'lasso'. Если правка выключена, она включается */
	setTool(t) {
		this.tool = t;
		if (!this.active) this.setActive(true);
		else this._emit();
	}

	/** Вызывается при каждой смене инструмента слева */
	_syncTool() {
		const model = this.app.model;
		const on = this.isPointTool;
		if (!on) this._back = model.tool;
		if (on === this.active) {
			if (on) this._emit();
			return;
		}
		if (on) {
			// облако ещё не выбрано: берём единственное в сцене, иначе просим выбрать
			if (!this.target()) {
				const cand = this.app.viewport.root.children.filter((c) => c.isPoints && !c.userData.helper && c.visible && c.geometry.attributes.position);
				if (cand.length === 1) model.select(cand[0]);
			}
			if (!this.target()) {
				this.app.toast('Выберите облако точек в сцене, чтобы править его точки', 'info', 2600);
				model.setTool(this._back || 'select');
				return;
			}
			this.active = true;
			this.retarget();
			if (this.app.settings.display !== 'points') this.app.setDisplay('points');
		} else {
			this.active = false;
			this._projPool = null;
			this._cursor.hidden = true;
			this._rect.hidden = true;
			this._lassoOff();
			this._drag = null;
		}
		// пока включена правка, левая кнопка выделяет, а не вращает сцену (Alt вращает)
		this.app.nav.paintLock = this.active;
		this.app.viewport.container.classList.toggle('pe-active', this.active);
		this._emit();
	}

	_emit() {
		this.app.bus.emit('pointedit');
		this.app.viewport.invalidate();
	}

	// ---------------------------------------------------------------- проекция точек на экран
	_project() {
		const vp = this.app.viewport;
		const o = this.obj;
		const cam = vp.camera;
		cam.updateMatrixWorld();
		o.updateWorldMatrix(true, false);
		const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(o.matrixWorld);
		const e = m.elements;
		const r = vp.canvas.getBoundingClientRect();
		const W = r.width;
		const H = r.height;
		const pos = o.geometry.attributes.position;
		const n = pos.count;
		const a = pos.array;
		// буферы переиспользуются между проекциями: на облаке в миллионы точек каждый клик иначе создавал бы десятки мегабайт мусора
		const pool = this._projPool || (this._projPool = { cap: 0 });
		if (pool.cap < n) {
			pool.cap = n;
			pool.sx = new Float32Array(n);
			pool.sy = new Float32Array(n);
			pool.sd = new Float32Array(n);
			pool.ok = new Uint8Array(n);
			pool.vis = new Uint8Array(n);
		}
		const { sx, sy, sd, ok, vis } = pool;
		ok.fill(0, 0, n);
		vis.fill(0, 0, n);
		const ortho = cam.isOrthographicCamera;
		const cell = 3;
		const gw = Math.ceil(W / cell) + 1;
		const gh = Math.ceil(H / cell) + 1;
		if (!pool.grid || pool.grid.length < gw * gh) pool.grid = new Float32Array(gw * gh);
		const grid = pool.grid;
		grid.fill(Infinity, 0, gw * gh);
		let dmin = Infinity;
		let dmax = -Infinity;
		for (let i = 0; i < n; i++) {
			const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
			const w = e[3] * x + e[7] * y + e[11] * z + e[15];
			if (w <= 1e-6) continue;
			const px = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w * 0.5 + 0.5) * W;
			const py = (1 - ((e[1] * x + e[5] * y + e[9] * z + e[13]) / w * 0.5 + 0.5)) * H;
			const d = ortho ? e[2] * x + e[6] * y + e[10] * z + e[14] : w;
			sx[i] = px;
			sy[i] = py;
			sd[i] = d;
			if (px < -50 || py < -50 || px > W + 50 || py > H + 50) continue;
			ok[i] = 1;
			if (d < dmin) dmin = d;
			if (d > dmax) dmax = d;
			const gi = Math.max(0, Math.min(gh - 1, (py / cell) | 0)) * gw + Math.max(0, Math.min(gw - 1, (px / cell) | 0));
			if (d < grid[gi]) grid[gi] = d;
		}
		// видимые: те, что не глубже самой ближней точки в своей ячейке (с небольшим запасом)
		const tol = (dmax - dmin) * 0.025 + 1e-6;
		for (let i = 0; i < n; i++) {
			if (!ok[i]) continue;
			const gi = Math.max(0, Math.min(gh - 1, (sy[i] / cell) | 0)) * gw + Math.max(0, Math.min(gw - 1, (sx[i] / cell) | 0));
			if (sd[i] <= grid[gi] + tol) vis[i] = 1;
		}
		this._proj = { sx, sy, ok, vis, left: r.left, top: r.top, n };
	}

	// ---------------------------------------------------------------- ввод
	_down(e) {
		if (!this.active || e.button !== 0 || e.altKey || !this.obj || this.app.ui.workspace !== 'edit') return;
		e.preventDefault();
		e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
		this._project();
		const remove = this.mode === 'sub' || e.ctrlKey || e.metaKey;
		this._drag = { x0: e.clientX, y0: e.clientY, remove, id: e.pointerId, path: [[e.clientX, e.clientY]] };
		if (this.tool === 'brush') this._brush(e.clientX, e.clientY, remove);
	}

	_move(e) {
		if (!this.active) return;
		const r = this.app.viewport.canvas.getBoundingClientRect();
		const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
		if (this.tool === 'brush' && this.obj && !e.altKey) {
			const d = this.radius * 2;
			const s = this._cursor.style;
			s.width = s.height = d + 'px';
			s.left = e.clientX - d / 2 - this._vpLeft() + 'px';
			s.top = e.clientY - d / 2 - this._vpTop() + 'px';
			this._cursor.hidden = !inside;
		} else this._cursor.hidden = true;
		const d = this._drag;
		if (!d) return;
		if (this.tool === 'brush') this._brush(e.clientX, e.clientY, d.remove);
		else if (this.tool === 'lasso') {
			const last = d.path[d.path.length - 1];
			if (Math.hypot(e.clientX - last[0], e.clientY - last[1]) >= 3) d.path.push([e.clientX, e.clientY]);
			this._lassoDraw(d.path, d.remove);
		} else {
			const s = this._rect.style;
			const l = Math.min(d.x0, e.clientX), t = Math.min(d.y0, e.clientY);
			s.left = l - this._vpLeft() + 'px';
			s.top = t - this._vpTop() + 'px';
			s.width = Math.abs(e.clientX - d.x0) + 'px';
			s.height = Math.abs(e.clientY - d.y0) + 'px';
			this._rect.hidden = false;
			this._rect.classList.toggle('is-sub', d.remove);
		}
	}

	_up(e) {
		const d = this._drag;
		if (!d) return;
		this._drag = null;
		if (this.tool === 'lasso') {
			this._lassoOff();
			const path = d.path;
			if (path.length >= 3) {
				// многоугольник из линии: проверка «точка внутри» по лучу, сначала быстрый отсев по габаритам
				let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
				for (const [x, y] of path) {
					if (x < x0) x0 = x;
					if (y < y0) y0 = y;
					if (x > x1) x1 = x;
					if (y > y1) y1 = y;
				}
				const m = path.length;
				this._apply((x, y) => {
					if (x < x0 || x > x1 || y < y0 || y > y1) return false;
					let inside = false;
					for (let i = 0, j = m - 1; i < m; j = i++) {
						const xi = path[i][0], yi = path[i][1], xj = path[j][0], yj = path[j][1];
						if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
					}
					return inside;
				}, d.remove);
			}
		} else if (this.tool === 'rect') {
			this._rect.hidden = true;
			this._apply((x, y) => x >= Math.min(d.x0, e.clientX) && x <= Math.max(d.x0, e.clientX) && y >= Math.min(d.y0, e.clientY) && y <= Math.max(d.y0, e.clientY), d.remove);
		}
	}

	_lassoDraw(path, remove) {
		const cv = this._lasso;
		const vp = document.getElementById('viewport').getBoundingClientRect();
		if (cv.width !== Math.round(vp.width) || cv.height !== Math.round(vp.height)) {
			cv.width = Math.round(vp.width);
			cv.height = Math.round(vp.height);
		}
		cv.hidden = false;
		const g = cv.getContext('2d');
		g.clearRect(0, 0, cv.width, cv.height);
		g.beginPath();
		path.forEach(([x, y], i) => (i ? g.lineTo(x - vp.left, y - vp.top) : g.moveTo(x - vp.left, y - vp.top)));
		g.closePath();
		const c = remove ? '255,107,107' : '229,138,69';
		g.fillStyle = `rgba(${c},0.14)`;
		g.fill();
		g.lineWidth = 1.5;
		g.setLineDash([6, 4]);
		g.strokeStyle = `rgb(${c})`;
		g.stroke();
	}
	_lassoOff() {
		this._lasso.hidden = true;
	}

	_vpLeft() {
		return document.getElementById('viewport').getBoundingClientRect().left;
	}
	_vpTop() {
		return document.getElementById('viewport').getBoundingClientRect().top;
	}

	_brush(cx, cy, remove) {
		const r2 = this.radius * this.radius;
		this._apply((x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2, remove);
	}

	/** Меняет выделение у всех точек, попавших в область (в координатах окна браузера) */
	_apply(inside, remove) {
		const P = this._proj;
		if (!P || !this.sel) return;
		const sel = this.sel;
		const flag = this.through ? P.ok : P.vis;
		let c = this.count;
		const v = remove ? 0 : 1;
		for (let i = 0; i < P.n; i++) {
			if (!flag[i] || sel[i] === v) continue;
			if (inside(P.sx[i] + P.left, P.sy[i] + P.top)) {
				sel[i] = v;
				c += remove ? -1 : 1;
			}
		}
		this.count = c;
		this._dirty();
	}

	_key(e) {
		if (!this.active || this.app.ui.workspace !== 'edit') return;
		const t = e.target;
		if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
		const mod = e.ctrlKey || e.metaKey;
		const stop = () => {
			e.preventDefault();
			e.stopImmediatePropagation();
		};
		if (e.code === 'Escape') {
			stop();
			this.setActive(false);
		} else if (e.code === 'Delete' || e.code === 'Backspace' || (e.code === 'KeyX' && !mod)) {
			// пока правка включена, Delete и X работают только с точками: целый объект случайно не удалится
			if (!this.obj) return;
			stop();
			if (this.count) this.deleteSelected();
			else this.app.toast('Сначала выберите точки', 'info', 1600);
		} else if (mod && e.code === 'KeyA') {
			stop();
			this.selectAll();
		} else if (mod && e.code === 'KeyI') {
			stop();
			this.invert();
		} else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
			stop();
			this.radius = Math.max(4, Math.min(200, Math.round(this.radius * (e.code === 'BracketRight' ? 1.15 : 0.87))));
			this._emit();
		}
	}

	// ---------------------------------------------------------------- выделение
	selectAll() {
		if (!this.sel) return;
		this.sel.fill(1);
		this.count = this.sel.length;
		this._dirty();
	}
	clear() {
		if (!this.sel) return;
		this.sel.fill(0);
		this.count = 0;
		this._dirty();
	}
	invert() {
		if (!this.sel) return;
		for (let i = 0; i < this.sel.length; i++) this.sel[i] = this.sel[i] ? 0 : 1;
		this.count = this.sel.length - this.count;
		this._dirty();
	}

	_dirty() {
		if (this._raf) return;
		this._raf = requestAnimationFrame(() => {
			this._raf = 0;
			this._writeOverlay();
			this._emit();
		});
	}

	/** Выбранные точки подсвечиваются шейдером через атрибут aSel */
	_writeOverlay() {
		const o = this.obj;
		if (!o || !this.sel) return;
		const g = o.geometry;
		let a = g.attributes.aSel;
		if (!a || a.count !== this.sel.length) {
			a = new THREE.BufferAttribute(new Float32Array(this.sel.length), 1);
			a.setUsage(THREE.DynamicDrawUsage);
			g.setAttribute('aSel', a);
		}
		const arr = a.array;
		const s = this.sel;
		for (let i = 0; i < s.length; i++) arr[i] = s[i];
		a.needsUpdate = true;
	}

	_clearOverlay() {
		const o = this.obj;
		if (o && o.geometry.attributes.aSel) {
			o.geometry.attributes.aSel.array.fill(0);
			o.geometry.attributes.aSel.needsUpdate = true;
		}
	}

	// ---------------------------------------------------------------- удаление и перекраска
	deleteSelected() {
		const o = this.obj;
		if (!o || !this.count) return;
		const app = this.app;
		const n = this.sel.length;
		const keep = new Uint32Array(n - this.count);
		for (let i = 0, k = 0; i < n; i++) if (!this.sel[i]) keep[k++] = i;
		const oldG = o.geometry;
		const oldAnim = o.userData.animPts || null;
		const newG = new THREE.BufferGeometry();
		for (const [name, a] of Object.entries(oldG.attributes)) {
			if (name === 'aSel') continue;
			const sz = a.itemSize;
			const out = new a.array.constructor(keep.length * sz);
			for (let k = 0; k < keep.length; k++) for (let j = 0; j < sz; j++) out[k * sz + j] = a.array[keep[k] * sz + j];
			newG.setAttribute(name, new THREE.BufferAttribute(out, sz, a.normalized));
		}
		// облако, посаженное на персонажа, хранит данные скиннинга по точкам: они сокращаются так же
		let newAnim = oldAnim;
		if (oldAnim) {
			newAnim = { ...oldAnim };
			for (const [k, v] of Object.entries(oldAnim)) {
				if (k === 'parts' || !ArrayBuffer.isView(v) || v.length % n !== 0) continue;
				const sz = v.length / n;
				const out = new v.constructor(keep.length * sz);
				for (let q = 0; q < keep.length; q++) for (let j = 0; j < sz; j++) out[q * sz + j] = v[keep[q] * sz + j];
				newAnim[k] = out;
			}
		}
		const removed = this.count;
		const apply = (g, anim) => {
			o.geometry = g;
			o.userData.animPts = anim;
			g.computeBoundingSphere();
			if (g.attributes.aSel) {
				g.attributes.aSel.array.fill(0);
				g.attributes.aSel.needsUpdate = true;
			}
			this.sel = new Uint8Array(g.attributes.position.count);
			this.count = 0;
			this._proj = null;
			app.model.changed({ display: false });
			app.bus.emit('geometry');
			this._emit();
		};
		app.history.push(
			{
				label: 'Удаление точек',
				redo: () => apply(newG, newAnim),
				undo: () => apply(oldG, oldAnim),
			},
			true
		);
		app.toast(`Удалено точек: ${removed.toLocaleString('ru')}`, 'ok', 1800);
	}

	paintSelected(hex, strength = 1) {
		const o = this.obj;
		if (!o || !this.count) return;
		const app = this.app;
		const g = o.geometry;
		let col = g.attributes.color;
		const n = this.sel.length;
		if (!col) {
			col = new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3);
			g.setAttribute('color', col);
		}
		const idx = [];
		for (let i = 0; i < n; i++) if (this.sel[i]) idx.push(i);
		const ids = Uint32Array.from(idx);
		const before = new Float32Array(ids.length * 3);
		const after = new Float32Array(ids.length * 3);
		const c = new THREE.Color(hex);
		const s = Math.max(0, Math.min(1, strength));
		const arr = col.array;
		for (let k = 0; k < ids.length; k++) {
			const i = ids[k] * 3;
			for (let j = 0; j < 3; j++) {
				before[k * 3 + j] = arr[i + j];
				const target = j === 0 ? c.r : j === 1 ? c.g : c.b;
				after[k * 3 + j] = arr[i + j] * (1 - s) + target * s;
			}
		}
		const write = (vals) => {
			const a = o.geometry.attributes.color.array;
			for (let k = 0; k < ids.length; k++) for (let j = 0; j < 3; j++) a[ids[k] * 3 + j] = vals[k * 3 + j];
			o.geometry.attributes.color.needsUpdate = true;
			this._emit();
		};
		app.history.push({ label: 'Перекраска точек', redo: () => write(after), undo: () => write(before) }, true);
		// выбранные точки светятся оранжевым и скрыли бы новый цвет, поэтому после перекраски выбор снимается
		this.clear();
		app.toast(`Закрашено точек: ${ids.length.toLocaleString('ru')}`, 'ok', 1800);
		// перекраска видна только в режиме «Текстура»: в других цвет точек задаёт сам режим
		const pt = app.settings.point;
		if (pt.color !== 'texture') {
			pt.color = 'texture';
			app.saveSettings();
			app.bus.emit('pointsettings');
			app.toast('Цвет точек переключён на «Текстура»: иначе перекраска не видна', 'info', 2600);
		}
	}
}
