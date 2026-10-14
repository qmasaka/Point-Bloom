// Центральный объект приложения: связывает вьюпорт, модель, навигацию, историю и интерфейс.
import { PointEditor } from '../points/point-edit.js';
import { $, createEmitter } from '../core/util.js';
import { loadSettings, saveSettings } from '../core/settings.js';
import { Viewport } from '../scene/viewport.js';
import { Model } from '../scene/model.js';
import { Display } from '../scene/display.js';
import { History } from '../core/history.js';
import { Nav } from '../scene/nav.js';
import { Ops, snapOf } from '../scene/ops.js';
import { UI } from '../ui/ui.js';
import { MediaController } from '../points/media-controller.js';
import { AnimController } from '../animation/anim-controller.js';
import { setTextureLimits } from '../scene/materials.js';
import { makeDemoFiles, makeDemoCharacterFile } from './demo.js';
import * as THREE from 'three';

export class App {
	constructor() {
		this.settings = loadSettings();
		this.bus = createEmitter();
		const el = $('#viewport');
		this.viewport = new Viewport(this, el, $('.stage', el));
		setTextureLimits(this.viewport.maxAnisotropy, this.viewport.maxTextureSize);
		this.model = new Model(this);
		this.display = new Display(this);
		this.history = new History(this);
		this.nav = new Nav(this);
		this.ops = new Ops(this);
		this.media = new MediaController(this);
		this.anim = new AnimController(this);
		this.bus.on('scene', () => this.anim.scan());
		this._matSnaps = new WeakMap();
		this.bus.on('material', () => this._recordMaterials());
		this.bus.on('scene', () => this._recordMaterials(true));
		this.ui = new UI(this);
		this.pointEdit = new PointEditor(this);
		this._setLast = this._settingsSnap();
	}

	start() {
		this.ui.init();
		this.wireGizmo();
		this.wirePointer();
		this.viewport.setActiveCamera(this.nav.camera);
		this.display.apply();
		this.viewport.updateSceneBounds();
		this.nav.frameAll(false);
		this.nav.applyCamera();
		this.model.applySnap();
		this.viewport.start();
		// Ссылка вида ?model=https://…/model.glb&texture=https://…/tex.png открывает модель сразу
		const q = new URLSearchParams(location.search);
		const model = q.get('model');
		if (model) {
			// чужая ссылка не должна молча подгружать файлы: только http(s) и только с подтверждением
			const ok = /^https?:\/\//i.test(model) && q.getAll('texture').every((t) => /^https?:\/\//i.test(t));
			if (ok) {
				const host = (() => {
					try {
						return new URL(model).host;
					} catch (e) {
						return model;
					}
				})();
				this.ui.choose({ title: 'Открыть модель по ссылке?', text: `Страница просит загрузить файл с сайта ${host}. Открывайте только то, чему доверяете.`, buttons: [{ label: 'Не открывать', value: false }, { label: 'Открыть', variant: 'primary', value: true }] }).then((yes) => {
					if (yes) this.ui.loadFromUrl(model, { textures: q.getAll('texture') });
				});
			}
		}
	}

	// --- гизмо перемещения / вращения / масштаба
	wireGizmo() {
		const tc = this.viewport.tc;
		let before = null;
		let multi = null;
		tc.addEventListener('dragging-changed', (e) => {
			this.nav.enabled = !e.value;
			const pivot = this.model.pivot;
			if (pivot && tc.object === pivot) {
				if (e.value) {
					pivot.updateMatrixWorld(true);
					const inv = pivot.matrixWorld.clone().invert();
					multi = this.model.selection.map((o) => ({ obj: o, rel: inv.clone().multiply(o.matrixWorld), before: snapOf(o) }));
				} else if (multi) {
					this.ops.commitMulti(multi.map((m) => ({ obj: m.obj, before: m.before, after: snapOf(m.obj) })), 'Трансформация группы');
					multi = null;
					this.model.attachGizmo();
				}
				return;
			}
			if (e.value && tc.object) before = snapOf(tc.object);
			else if (!e.value && before && tc.object) {
				const names = { translate: 'Перемещение', rotate: 'Вращение', scale: 'Масштаб' };
				this.ops.commitTransform(tc.object, before, snapOf(tc.object), names[tc.mode] || 'Трансформация');
				before = null;
			}
		});
		// событие приходит на каждый pointermove: обновляем рамку и поля не чаще кадра, чтобы перетаскивание не тормозило
		let pending = false;
		tc.addEventListener('objectChange', () => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => {
				pending = false;
				if (multi && this.model.pivot) {
					// опора двигается, остальные объекты следуют за ней с сохранением взаимного положения
					const pv = this.model.pivot;
					pv.updateMatrixWorld(true);
					const m4 = new THREE.Matrix4();
					const par = new THREE.Matrix4();
					for (const it of multi) {
						m4.copy(pv.matrixWorld).multiply(it.rel);
						it.obj.parent.updateWorldMatrix(true, false);
						par.copy(it.obj.parent.matrixWorld).invert();
						m4.premultiply(par).decompose(it.obj.position, it.obj.quaternion, it.obj.scale);
						it.obj.updateMatrix();
						it.obj.updateMatrixWorld(true);
					}
				}
				this.viewport.updateSelectionBox();
				this.bus.emit('transform');
			});
		});
	}

	// --- выбор кликом и фокус двойным кликом
	wirePointer() {
		this.bus.on('click', (e) => {
			const hit = this.viewport.pick(e.clientX, e.clientY);
			let obj = hit ? hit.object : null;
			// как в 3D-редакторе: клик выбирает весь объект целиком, чтобы поля X, Y, Z и гизмо работали в мировых осях; Alt выбирает конкретную часть
			if (obj && !e.altKey) while (obj.parent && obj.parent !== this.viewport.root) obj = obj.parent;
			this.model.select(obj, { add: e.shiftKey });
		});
		this.bus.on('dblclick', (e) => {
			const hit = this.viewport.pick(e.clientX, e.clientY);
			if (hit) this.nav.focusPoint(hit.point);
		});
	}

	setDisplay(mode) {
		this.settings.display = mode;
		this.display.apply();
		this.saveSettings();
		this.bus.emit('view');
	}

	toast(msg, type, ms) {
		this.ui.toast(msg, type, ms);
	}

	saveSettings() {
		saveSettings(this.settings);
		this._recordSettings();
		this.bus.emit('settings');
	}

	/** Настройки вида, точек и медиа отменяются Ctrl+Z, как и правки модели. Частые изменения подряд (тяга ползунка) склеиваются в одну отмену */
	_settingsSnap() {
		const { exportOpts, importOpts, ...rest } = this.settings;
		return JSON.stringify(rest);
	}

	_recordSettings() {
		const snap = this._settingsSnap();
		if (this._setLast === undefined) {
			this._setLast = snap;
			return;
		}
		if (snap === this._setLast) return;
		const prev = this._setLast;
		this._setLast = snap;
		const st = this.history.undoStack;
		const top = st[st.length - 1];
		const now = performance.now();
		if (top && top.kind === 'settings' && now - top.t < 900) {
			top.after = snap;
			top.t = now;
			return;
		}
		const app = this;
		this.history.push({
			kind: 'settings',
			label: 'Настройки',
			before: prev,
			after: snap,
			t: now,
			undo() {
				app._restoreSettings(this.before);
			},
			redo() {
				app._restoreSettings(this.after);
			},
		});
	}

	/** Параметры материалов и назначенные текстуры тоже отменяются: снимок состояния до и после, частые изменения склеиваются */
	_materialList() {
		const out = new Set();
		for (const m of this.model.meshes()) {
			const o = this.display.getOriginal(m);
			for (const x of Array.isArray(o) ? o : [o]) if (x && x.isMaterial) out.add(x);
		}
		return [...out];
	}

	_matState(m) {
		const st = { n: {}, c: {}, t: {}, v: {} };
		for (const k of ['roughness', 'metalness', 'opacity', 'envMapIntensity', 'emissiveIntensity', 'bumpScale', 'aoMapIntensity', 'displacementScale', 'displacementBias', 'alphaTest', 'side']) if (typeof m[k] === 'number') st.n[k] = m[k];
		for (const k of ['color', 'emissive']) if (m[k] && m[k].isColor) st.c[k] = m[k].getHex();
		for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap']) if (k in m) st.t[k] = m[k] || null;
		for (const k of ['transparent', 'wireframe', 'flatShading', 'vertexColors']) if (k in m) st.v[k] = m[k];
		if (m.normalScale) st.ns = [m.normalScale.x, m.normalScale.y];
		return st;
	}

	_sameMat(a, b) {
		const eq = (x, y) => Object.keys(x).every((k) => x[k] === y[k]);
		return eq(a.n, b.n) && eq(a.c, b.c) && eq(a.t, b.t) && eq(a.v, b.v) && (!a.ns || (a.ns[0] === b.ns[0] && a.ns[1] === b.ns[1]));
	}

	_applyMat(m, st) {
		Object.assign(m, st.n, st.v, st.t);
		for (const k of Object.keys(st.c)) m[k].setHex(st.c[k]);
		if (st.ns && m.normalScale) m.normalScale.set(st.ns[0], st.ns[1]);
		m.needsUpdate = true;
	}

	_recordMaterials(baselineOnly = false) {
		const changes = [];
		for (const m of this._materialList()) {
			const now = this._matState(m);
			const prev = this._matSnaps.get(m);
			this._matSnaps.set(m, now);
			if (baselineOnly || !prev || this._sameMat(prev, now)) continue;
			changes.push({ m, before: prev, after: now });
		}
		if (!changes.length) return;
		const st = this.history.undoStack;
		const top = st[st.length - 1];
		const t = performance.now();
		const key = changes.map((c) => c.m.uuid).join();
		if (top && top.kind === 'material' && top.key === key && t - top.t < 900) {
			top.t = t;
			for (const c of top.changes) c.after = changes.find((x) => x.m === c.m)?.after || c.after;
			return;
		}
		const app = this;
		const cmd = {
			kind: 'material',
			label: 'Материал',
			key,
			t,
			changes,
			undo() {
				for (const c of this.changes) {
					app._matSnaps.set(c.m, c.before);
					app._applyMat(c.m, c.before);
				}
				app.afterMaterialChange();
			},
			redo() {
				for (const c of this.changes) {
					app._matSnaps.set(c.m, c.after);
					app._applyMat(c.m, c.after);
				}
				app.afterMaterialChange();
			},
		};
		this.history.push(cmd);
	}

	_restoreSettings(snap) {
		const data = JSON.parse(snap);
		const put = (dst, src) => {
			for (const k of Object.keys(src)) {
				if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && dst[k] && typeof dst[k] === 'object') put(dst[k], src[k]);
				else dst[k] = src[k];
			}
		};
		put(this.settings, data);
		this._setLast = snap;
		saveSettings(this.settings);
		if (this.nav.ortho !== this.settings.nav.ortho) this.nav.setOrtho(this.settings.nav.ortho);
		this.viewport.applyRenderSettings();
		this.display.apply();
		this.model.applySnap();
		this.ui.rebuildSettingsPanels();
		this.bus.emit('view');
		this.bus.emit('settings');
		this.viewport.invalidate();
	}

	/** После любых изменений материалов и текстур */
	afterMaterialChange() {
		const mode = this.settings.display;
		if (mode !== 'material' && mode !== 'points') this.setDisplay('material');
		else this.display.apply();
		this.bus.emit('material');
		this.bus.emit('geometry');
		this.viewport.invalidate();
	}

	async loadDemoCharacter() {
		await this.ui.handleFiles([await makeDemoCharacterFile()], { mode: 'replace' });
	}

	async loadDemo() {
		const files = await makeDemoFiles();
		await this.ui.handleFiles(files, { mode: 'replace' });
	}
}
