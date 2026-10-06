// Операции редактирования с отменой: геометрия, трансформации, удаление, дублирование.
import * as THREE from 'three';
import * as G from './geom.js';
import { triangleCount } from './geom.js';
import { Display } from './display.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';

const snapOf = (o) => ({ p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
const restoreSnap = (o, s) => {
	o.position.copy(s.p);
	o.quaternion.copy(s.q);
	o.scale.copy(s.s);
	o.updateMatrix();
	o.updateMatrixWorld(true);
};
const sameSnap = (a, b) => a.p.equals(b.p) && a.q.equals(b.q) && a.s.equals(b.s);

export class Ops {
	constructor(app) {
		this.app = app;
	}

	get sel() {
		return this.app.model.selected;
	}
	get model() {
		return this.app.model;
	}

	targets() {
		const s = this.sel;
		if (!s) return [];
		return s.isMesh ? [s] : this.model.meshesOf(s);
	}

	afterChange({ display = true } = {}) {
		this.model.changed({ display });
		this.app.bus.emit('geometry');
	}

	// -------------------------------------------------------- геометрия
	geometryOp(label, fn) {
		const meshes = this.targets();
		if (!meshes.length) {
			this.app.toast('Сначала выберите объект с мешем', 'warn');
			return false;
		}
		const before = new Map();
		const after = new Map();
		for (const m of meshes) {
			before.set(m, m.geometry);
			after.set(m, fn(m.geometry, m));
		}
		const apply = (map) => {
			for (const [m, g] of map) m.geometry = g;
			this.afterChange();
		};
		this.app.history.push({ label, undo: () => apply(before), redo: () => apply(after) }, true);
		this.app.toast(label + ': готово', 'ok');
		return true;
	}

	flipNormals() {
		return this.geometryOp('Нормали развёрнуты', (g) => G.flipNormals(g));
	}
	smooth(angle = 60) {
		return this.geometryOp('Сглаживание по углу ' + angle + '°', (g) => G.smoothNormals(g, angle));
	}
	flat() {
		return this.geometryOp('Плоское затенение', (g) => G.flatNormals(g));
	}
	weld() {
		const meshes = this.targets();
		const before = meshes.reduce((n, m) => n + (m.geometry.attributes.position?.count || 0), 0);
		const ok = this.geometryOp('Вершины объединены', (g) => G.weldExact(g));
		if (ok) {
			const after = meshes.reduce((n, m) => n + (m.geometry.attributes.position?.count || 0), 0);
			this.app.toast(`Вершин было ${before}, стало ${after}`, 'ok');
		}
		return ok;
	}
	mirror(axis) {
		return this.geometryOp('Отражение по ' + axis.toUpperCase(), (g) => G.mirrorGeometry(g, axis));
	}
	flipUV() {
		return this.geometryOp('UV перевёрнуты по V', (g) => G.flipUVV(g));
	}

	/** Упрощение сетки: оставляет примерно keepPercent % граней, сохраняя UV и нормали */
	async simplify(keepPercent) {
		const all = this.targets();
		if (!all.length) {
			this.app.toast('Сначала выберите объект с мешем', 'warn');
			return false;
		}
		const meshes = all.filter((m) => !Array.isArray(this.app.display.getOriginal(m)) && m.geometry.groups.length <= 1 && triangleCount(m.geometry) > 24);
		const skipped = all.length - meshes.length;
		if (!meshes.length) {
			this.app.toast('Эти меши нельзя упростить: слишком простые или с несколькими материалами в одном меше', 'warn');
			return false;
		}
		const ui = this.app.ui;
		const before = new Map();
		const after = new Map();
		const mod = new SimplifyModifier();
		let trisBefore = 0;
		let trisAfter = 0;
		try {
			for (let i = 0; i < meshes.length; i++) {
				const m = meshes[i];
				ui.busy(`Упрощаю сетку (${i + 1} из ${meshes.length})`, i / meshes.length);
				await new Promise((r) => setTimeout(r, 20));
				const src = m.geometry.index ? m.geometry : G.weldExact(m.geometry);
				const remove = Math.round(src.attributes.position.count * (1 - keepPercent / 100));
				const out = await mod.modify(src, remove);
				before.set(m, m.geometry);
				after.set(m, out);
				trisBefore += triangleCount(m.geometry);
				trisAfter += triangleCount(out);
			}
		} catch (e) {
			console.error(e);
			ui.idle();
			this.app.toast('Не удалось упростить сетку: ' + (e.message || e), 'error');
			return false;
		}
		ui.idle();
		const apply = (map) => {
			for (const [m, g] of map) m.geometry = g;
			this.afterChange();
		};
		this.app.history.push({ label: 'Упрощение сетки', undo: () => apply(before), redo: () => apply(after) }, true);
		const f = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u{202f}');
		this.app.toast(`Граней было ${f(trisBefore)}, стало ${f(trisAfter)}` + (skipped ? `. Пропущено мешей: ${skipped}` : ''), 'ok', 5000);
		return true;
	}

	// ------------------------------------------------------ трансформации
	/** Одна запись отмены на всю группу объектов: list = [{ obj, before, after }] */
	commitMulti(list, label = 'Трансформация группы') {
		const changed = list.filter((i) => !sameSnap(i.before, i.after));
		if (!changed.length) return;
		this.app.history.push(
			{
				label,
				undo: () => {
					changed.forEach((i) => restoreSnap(i.obj, i.before));
					this.afterChange({ display: false });
				},
				redo: () => {
					changed.forEach((i) => restoreSnap(i.obj, i.after));
					this.afterChange({ display: false });
				},
			},
			false
		);
		this.afterChange({ display: false });
	}

	commitTransform(obj, before, after, label = 'Трансформация', key = null) {
		if (sameSnap(before, after)) return;
		const h = this.app.history;
		const last = h.undoStack[h.undoStack.length - 1];
		const now = performance.now();
		// подряд идущие правки одного поля объединяем в один шаг отмены
		if (key && last && last.key === key && now - last.t < 900) {
			last.state.after = after;
			last.t = now;
			this.afterChange({ display: false });
			h.emit();
			return;
		}
		const state = { before, after };
		h.push(
			{
				label,
				key,
				t: now,
				state,
				undo: () => {
					restoreSnap(obj, state.before);
					this.afterChange({ display: false });
				},
				redo: () => {
					restoreSnap(obj, state.after);
					this.afterChange({ display: false });
				},
			},
			false
		);
		this.afterChange({ display: false });
	}

	/** Задаёт положение / поворот (в градусах) / масштаб из полей ввода */
	setTransform(obj, { position, rotation, scale }, label = 'Трансформация') {
		const before = snapOf(obj);
		if (position) obj.position.set(...position);
		if (rotation) obj.rotation.set(...rotation.map((d) => THREE.MathUtils.degToRad(d)));
		if (scale) obj.scale.set(...scale);
		obj.updateMatrix();
		obj.updateMatrixWorld(true);
		this.commitTransform(obj, before, snapOf(obj), label, 'xf:' + obj.uuid);
	}

	/** Ось (origin) объекта → центр его геометрии */
	centerOrigin() {
		const s = this.sel;
		if (!s) return this.app.toast('Выберите объект', 'warn');
		const box = this.app.viewport.getBounds(s);
		if (box.isEmpty()) return;
		const centerWorld = box.getCenter(new THREE.Vector3());
		const nodes = s.isMesh ? [s] : [s, ...s.children.filter((k) => !k.userData.helper)];
		const capture = () => ({ geo: s.isMesh ? s.geometry : null, snaps: nodes.map((n) => [n, snapOf(n)]) });
		const restore = (st) => {
			if (st.geo) s.geometry = st.geo;
			st.snaps.forEach(([n, sn]) => restoreSnap(n, sn));
			this.afterChange();
		};
		const before = capture();
		if (s.isMesh) {
			s.geometry.computeBoundingBox();
			const c = s.geometry.boundingBox.getCenter(new THREE.Vector3());
			const g = s.geometry.clone();
			g.translate(-c.x, -c.y, -c.z);
			s.geometry = g;
			s.updateMatrix();
			s.position.copy(c.applyMatrix4(s.matrix));
		} else {
			const c = s.worldToLocal(centerWorld.clone());
			for (const k of s.children) if (!k.userData.helper) k.position.sub(c);
			s.updateMatrix();
			s.position.copy(c.applyMatrix4(s.matrix));
		}
		s.updateMatrix();
		s.updateMatrixWorld(true);
		const after = capture();
		this.app.history.push({ label: 'Ось в центр', undo: () => restore(before), redo: () => restore(after) }, false);
		this.afterChange();
		this.app.toast('Ось перенесена в центр объекта', 'ok');
	}

	/** Поставить выбранное (или всю модель) на пол: минимум по Y = 0 */
	toGround() {
		const target = this.sel || null;
		const vp = this.app.viewport;
		const objs = target ? [target] : this.model.root.children.filter((c) => !c.userData.helper);
		if (!objs.length) return;
		const box = target ? vp.getBounds(target) : vp.getBounds(vp.root);
		if (box.isEmpty()) return;
		const dy = -box.min.y;
		if (Math.abs(dy) < 1e-12) return;
		const before = objs.map((o) => [o, snapOf(o)]);
		for (const o of objs) {
			const w = o.getWorldPosition(new THREE.Vector3());
			w.y += dy;
			o.position.copy(o.parent ? o.parent.worldToLocal(w) : w);
			o.updateMatrix();
			o.updateMatrixWorld(true);
		}
		const after = objs.map((o) => [o, snapOf(o)]);
		const apply = (list) => {
			list.forEach(([o, s]) => restoreSnap(o, s));
			this.afterChange({ display: false });
		};
		this.app.history.push({ label: 'На пол', undo: () => apply(before), redo: () => apply(after) }, false);
		this.afterChange({ display: false });
		this.app.toast('Объект поставлен на пол', 'ok');
	}

	/** Запекает трансформацию объекта в вершины (масштаб/поворот становятся «чистыми») */
	applyTransform() {
		const s = this.sel;
		if (!s) return this.app.toast('Выберите объект', 'warn');
		const meshes = this.targets();
		const nodes = [];
		s.traverse((o) => {
			if (!o.userData.helper) nodes.push(o);
		});
		const parentInv = new THREE.Matrix4();
		s.parent.updateWorldMatrix(true, false);
		parentInv.copy(s.parent.matrixWorld).invert();
		s.updateWorldMatrix(true, true);
		const before = { geo: new Map(), snaps: nodes.map((n) => [n, snapOf(n)]) };
		const after = { geo: new Map() };
		for (const m of meshes) {
			before.geo.set(m, m.geometry);
			const rel = new THREE.Matrix4().multiplyMatrices(parentInv, m.matrixWorld);
			let g = m.geometry.clone().applyMatrix4(rel);
			if (rel.determinant() < 0) g = G.flipWinding(g);
			after.geo.set(m, g);
		}
		const identity = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) };
		const run = (geoMap, snaps) => {
			for (const [m, g] of geoMap) m.geometry = g;
			snaps.forEach(([n, sn]) => restoreSnap(n, sn));
			this.afterChange();
		};
		const afterSnaps = nodes.map((n) => [n, identity]);
		this.app.history.push({ label: 'Трансформация применена', undo: () => run(before.geo, before.snaps), redo: () => run(after.geo, afterSnaps) }, true);
		this.app.toast('Трансформация применена к вершинам', 'ok');
	}

	// ----------------------------------------------- объекты: удалить и др.
	addObject(obj, label = 'Добавить объект', { select = true } = {}) {
		const parent = this.model.root;
		const cmd = {
			label,
			redo: () => {
				this.model.add(obj, parent);
				if (select) this.model.select(obj);
			},
			undo: () => this.model.remove(obj),
		};
		this.app.history.push(cmd, true);
	}

	deleteSelected() {
		const list = this.model.selection.length ? [...this.model.selection] : this.sel ? [this.sel] : [];
		if (!list.length) return;
		const infos = list.map((o) => ({ o, parent: o.parent, index: o.parent.children.indexOf(o) }));
		const cmd = {
			label: list.length > 1 ? `Удалить объекты (${list.length})` : 'Удалить «' + (list[0].name || 'объект') + '»',
			redo: () => infos.forEach((i) => this.model.remove(i.o)),
			undo: () => {
				[...infos].reverse().forEach((i) => {
					i.parent.children.splice(i.index, 0, i.o);
					i.o.parent = i.parent;
					i.o.dispatchEvent({ type: 'added' });
				});
				this.model.changed();
				this.model.select(infos[0].o);
				infos.slice(1).forEach((i) => this.model.select(i.o, { add: true }));
			},
		};
		this.app.history.push(cmd, true);
	}

	duplicateSelected() {
		const src = this.sel;
		if (!src) return;
		const display = this.app.display;
		const pairs = [];
		const pair = (a, b) => {
			pairs.push([a, b]);
			for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i]);
		};
		const clone = src.clone(true);
		pair(src, clone);
		for (const [a, b] of pairs) {
			if (a.isMesh || a.isPoints) {
				const orig = display.getOriginal(a);
				b.material = orig;
				display.setOriginal(b, orig);
			}
		}
		Display.stripHelpers(clone);
		clone.name = (src.name || 'Объект') + ' копия';
		const size = this.app.viewport.getBounds(src).getSize(new THREE.Vector3());
		clone.position.x += (size.x || 1) * 0.12;
		clone.position.z += (size.z || 1) * 0.12;
		const parent = src.parent;
		this.app.history.push(
			{
				label: 'Дублировать',
				redo: () => {
					parent.add(clone);
					clone.traverse((o) => display.attach(o));
					this.model.changed();
					this.model.select(clone);
				},
				undo: () => this.model.remove(clone),
			},
			true
		);
	}

	rename(obj, name) {
		const old = obj.name;
		if (old === name) return;
		this.app.history.push(
			{
				label: 'Переименовать',
				redo: () => {
					obj.name = name;
					this.app.bus.emit('scene');
				},
				undo: () => {
					obj.name = old;
					this.app.bus.emit('scene');
				},
			},
			true
		);
	}

	setVisible(obj, visible) {
		const old = obj.visible;
		if (old === visible) return;
		this.app.history.push(
			{
				label: visible ? 'Показать' : 'Скрыть',
				redo: () => {
					obj.visible = visible;
					this.afterChange({ display: false });
				},
				undo: () => {
					obj.visible = old;
					this.afterChange({ display: false });
				},
			},
			true
		);
	}
}

export { snapOf, restoreSnap };
