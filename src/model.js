// Содержимое сцены: объекты, выделение, активный материал, статистика.
import * as THREE from 'three';
import { triangleCount } from './geom.js';
import { uniqueMaterials, materialTextures } from './materials.js';

export class Model {
	constructor(app) {
		this.app = app;
		this.selected = null;
		this.activeMaterial = null;
		this.tool = 'select'; // select | translate | rotate | scale
	}

	get root() {
		return this.app.viewport.root;
	}

	/** Все меши / облака точек (без служебных) */
	renderables() {
		const out = [];
		this.root.traverse((o) => {
			if (o.userData.helper) return;
			if (o.isMesh || o.isPoints) out.push(o);
		});
		return out;
	}
	meshes() {
		return this.renderables().filter((o) => o.isMesh);
	}
	meshesOf(obj) {
		const out = [];
		obj.traverse((o) => {
			if (!o.userData.helper && o.isMesh) out.push(o);
		});
		return out;
	}

	/** Уникальные исходные материалы сцены */
	materials() {
		const d = this.app.display;
		return uniqueMaterials(this.meshes().map((m) => d.getOriginal(m)));
	}
	usersOf(material) {
		const d = this.app.display;
		return this.meshes().filter((m) => {
			const o = d.getOriginal(m);
			return Array.isArray(o) ? o.includes(material) : o === material;
		});
	}

	// ----------------------------------------------------------- изменения
	changed({ display = true } = {}) {
		this.app.viewport.updateSceneBounds();
		if (display) this.app.display.apply();
		this.app.bus.emit('scene');
	}

	add(obj, parent = this.root, { select = false } = {}) {
		parent.add(obj);
		obj.traverse((o) => this.app.display.attach(o));
		this.changed();
		if (select) this.select(obj);
	}

	remove(obj) {
		if (this.selected && (this.selected === obj || this.isDescendant(this.selected, obj))) this.select(null);
		obj.removeFromParent();
		this.changed();
	}

	isDescendant(node, ancestor) {
		for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true;
		return false;
	}

	clear() {
		this.select(null);
		const d = this.app.display;
		const geos = new Set();
		const mats = new Set();
		const texs = new Set();
		this.root.traverse((o) => {
			if (o.geometry) geos.add(o.geometry);
			const orig = d.orig.get(o);
			for (const m of uniqueMaterials([orig, o.material])) {
				mats.add(m);
				for (const { texture } of materialTextures(m)) texs.add(texture);
			}
		});
		for (const o of [...this.root.children]) o.removeFromParent();
		geos.forEach((g) => g.dispose());
		texs.forEach((t) => t.dispose());
		mats.forEach((m) => {
			if (!Object.values(d.mats).includes(m) && m !== d.pointMat) m.dispose();
		});
		this.activeMaterial = null;
		this.app.history.clear();
		this.changed();
		this.app.bus.emit('newdoc');
	}

	// ------------------------------------------------------------ выделение
	select(obj) {
		if (obj === this.root) obj = null;
		this.selected = obj || null;
		if (obj) {
			const meshes = obj.isMesh ? [obj] : this.meshesOf(obj);
			if (meshes.length) {
				const orig = this.app.display.getOriginal(meshes[0]);
				const m = Array.isArray(orig) ? orig[0] : orig;
				if (m) this.activeMaterial = m;
			}
		}
		this.attachGizmo();
		this.app.viewport.updateSelectionBox();
		this.app.bus.emit('selection');
	}

	setActiveMaterial(m) {
		this.activeMaterial = m;
		this.app.bus.emit('material');
	}

	setTool(tool) {
		this.tool = tool;
		this.attachGizmo();
		this.app.bus.emit('tool');
	}

	attachGizmo() {
		const tc = this.app.viewport.tc;
		const sel = this.selected;
		if (sel && this.tool !== 'select') {
			tc.setMode(this.tool);
			tc.attach(sel);
		} else {
			tc.detach();
		}
		this.applySnap();
		this.app.viewport.invalidate();
	}

	applySnap() {
		const tc = this.app.viewport.tc;
		const s = this.app.settings.snap;
		tc.setSpace(this.app.settings.space);
		tc.setTranslationSnap(s.on ? s.move : null);
		tc.setRotationSnap(s.on ? THREE.MathUtils.degToRad(s.rotate) : null);
		tc.setScaleSnap(s.on ? s.scale : null);
	}

	// ------------------------------------------------------------ статистика
	stats(onlyVisible = true) {
		let verts = 0, tris = 0, points = 0, objects = 0;
		for (const o of this.renderables()) {
			if (onlyVisible && !this.app.viewport.isVisibleInTree(o)) continue;
			objects++;
			const g = o.geometry;
			if (!g || !g.attributes.position) continue;
			if (o.isPoints) points += g.attributes.position.count;
			else {
				verts += g.attributes.position.count;
				tris += triangleCount(g);
			}
		}
		const mats = this.materials();
		const texs = new Set();
		for (const m of mats) for (const { texture } of materialTextures(m)) texs.add(texture);
		return { verts, tris, points, objects, materials: mats.length, textures: texs.size };
	}
}
