import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Grid } from './grid.js';
import { perf } from './perf.js';

/** Слои: чем рисуется. 0 — служебное (сетка, гизмо), остальное — содержимое сцены. */
export const LAYER = { MESH: 1, POINTS: 2, WIRE: 3, FACES: 4 };

export const BACKGROUNDS = {
	dark: { label: 'Тёмный градиент', css: 'radial-gradient(ellipse at 50% 25%, #3d4149 0%, #24272d 62%, #1b1d22 100%)', solid: '#2a2d33', light: false },
	blender: { label: 'Серый (Blender)', css: 'linear-gradient(#4d4d4d, #323232)', solid: '#3d3d3d', light: false },
	mid: { label: 'Средне-серый', css: '#6b7079', solid: '#6b7079', light: false },
	light: { label: 'Светлый градиент', css: 'radial-gradient(ellipse at 50% 25%, #eef0f3 0%, #c3c8d0 85%)', solid: '#d6d9df', light: true },
	white: { label: 'Белый', css: '#ffffff', solid: '#ffffff', light: true },
	black: { label: 'Чёрный', css: '#000000', solid: '#000000', light: false },
	checker: {
		label: 'Прозрачный (шахматка)',
		css: 'conic-gradient(#8a8d94 25%, #a9acb3 0 50%, #8a8d94 0 75%, #a9acb3 0) 0 0 / 24px 24px',
		solid: null,
		light: false,
	},
};

const TONE = {
	none: THREE.NoToneMapping,
	neutral: THREE.NeutralToneMapping,
	aces: THREE.ACESFilmicToneMapping,
	agx: THREE.AgXToneMapping,
};

const _box = new THREE.Box3();
const _tmpBox = new THREE.Box3();

export class Viewport {
	constructor(app, container, stage) {
		this.app = app;
		this.container = container;
		this.stage = stage;
		this.size = { width: 800, height: 600 };
		this.sceneRadius = 1;
		this.dirty = true;
		this.raycaster = new THREE.Raycaster();
		this.raycaster.layers.set(LAYER.MESH);

		this.canvas = document.createElement('canvas');
		this.canvas.className = 'gl';
		stage.appendChild(this.canvas);
		this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: perf.antialias, alpha: true, powerPreference: 'high-performance' });
		this._basePR = Math.min(window.devicePixelRatio || 1, perf.maxPR);
		this._qs = 1; // текущий масштаб разрешения (авто-качество)
		this.renderer.setPixelRatio(this._basePR);
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
		this.maxTextureSize = this.renderer.capabilities.maxTextureSize;

		this.scene = new THREE.Scene();
		this.perspCam = new THREE.PerspectiveCamera(app.settings.render.fov, 1, 0.01, 1000);
		this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
		this.camera = app.settings.nav.ortho ? this.orthoCam : this.perspCam;
		this.scene.add(this.perspCam, this.orthoCam);

		// Содержимое модели лежит здесь; всё, что вне root, — служебное
		this.root = new THREE.Group();
		this.root.name = 'Model';
		this.scene.add(this.root);

		this.grid = new Grid();
		this.scene.add(this.grid);

		// Освещение: окружение (студия) + «фонарь» от камеры
		const pmrem = new THREE.PMREMGenerator(this.renderer);
		this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
		pmrem.dispose();
		this.scene.environment = this.envTexture;
		this.headlight = new THREE.DirectionalLight(0xffffff, 1.4);
		this.scene.add(this.headlight, this.headlight.target);

		// Рамка выделения
		this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0xf0a060);
		this.selBox.material.toneMapped = false;
		this.selBox.renderOrder = 20;
		this.selBox.visible = false;
		this.selBox.userData.helper = true;
		this.scene.add(this.selBox);

		// Гизмо перемещения/вращения/масштаба (создаём ДО навигации, чтобы он первым ловил события)
		this.tc = new TransformControls(this.camera, this.canvas);
		this.tc.size = 0.85;
		// цвета осей как в маркерах X, Y, Z: ось three.js x показана как Y (зелёная), y как Z (синяя), z как X (красная)
		this.tc.setColors('#86c85a', '#4f8ff0', '#e5565f', '#ffd24a');
		this.scene.add(this.tc.getHelper());
		// Shift при масштабировании: любая ручка тянет форму равномерно по всем осям, как в других 3D-редакторах
		this.canvas.addEventListener(
			'pointerdown',
			(e) => {
				if (e.shiftKey && this.tc.mode === 'scale' && this.tc.axis && this.tc.axis !== 'XYZ') {
					this.tc.axis = 'XYZ';
					this.tc.getHelper().updateMatrixWorld(true); // плоскость перетаскивания пересчитывается под новую ось
				}
			},
			true
		);
		this.tc.addEventListener('change', () => this.invalidate());

		this.ro = new ResizeObserver(() => this.resize());
		this.ro.observe(stage);
		this.resize();
		this.applyRenderSettings();
	}

	// ----------------------------------------------------------- настройки
	applyRenderSettings() {
		const r = this.app.settings.render;
		this.renderer.toneMapping = TONE[r.tone] ?? THREE.NeutralToneMapping;
		this.renderer.toneMappingExposure = r.exposure;
		this.scene.environmentIntensity = r.env;
		this.headlight.visible = !!r.headlight;
		const bg = BACKGROUNDS[r.bg] || BACKGROUNDS.dark;
		this.stage.style.background = bg.css;
		this.grid.setTheme(bg.light);
		this.invalidate();
	}

	setActiveCamera(cam) {
		this.camera = cam;
		this.tc.camera = cam;
		this.app.display?.syncCameraLayers();
		this.invalidate();
	}

	resize() {
		const w = Math.max(1, this.stage.clientWidth);
		const h = Math.max(1, this.stage.clientHeight);
		this.size = { width: w, height: h };
		this.renderer.setSize(w, h, false);
		this.app.nav?.applyCamera();
		this.invalidate();
	}

	invalidate() {
		this.dirty = true;
	}

	// ----------------------------------------------------------- измерения
	getBounds(obj, target = new THREE.Box3()) {
		target.makeEmpty();
		obj.updateWorldMatrix(true, true);
		obj.traverse((o) => {
			if (o.userData.helper || !o.geometry || !(o.isMesh || o.isPoints || o.isLine)) return;
			if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
			const b = o.geometry.boundingBox;
			if (!b || b.isEmpty()) return;
			target.union(_tmpBox.copy(b).applyMatrix4(o.matrixWorld));
		});
		return target;
	}

	updateSceneBounds() {
		this.getBounds(this.root, _box);
		this.sceneBox = _box.clone();
		this.sceneRadius = _box.isEmpty() ? 1 : Math.max(_box.getBoundingSphere(new THREE.Sphere()).radius, 1e-4);
		this.updateSelectionBox();
	}

	updateSelectionBox() {
		const list = this.app.model?.selection || [];
		if (!list.length || !this.app.settings.overlays.bbox || this.fxHide) {
			this.selBox.visible = false;
		} else {
			const box = this.selBox.box;
			box.makeEmpty();
			const tmp = new THREE.Box3();
			for (const o of list) box.union(this.getBounds(o, tmp));
			this.selBox.visible = !box.isEmpty();
		}
		this.invalidate();
	}

	// ------------------------------------------------------------ выбор
	isVisibleInTree(o) {
		for (let p = o; p; p = p.parent) if (!p.visible) return false;
		return true;
	}

	pick(clientX, clientY) {
		const rect = this.canvas.getBoundingClientRect();
		const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
		this.raycaster.setFromCamera(ndc, this.camera);
		const nav = this.app.nav;
		const fov = THREE.MathUtils.degToRad(this.app.settings.render.fov);
		const wpp = (2 * nav.distance * Math.tan(fov / 2)) / this.size.height;
		this.raycaster.params.Points.threshold = wpp * (this.app.settings.point.size * 0.5 + 4);
		this.raycaster.params.Line.threshold = wpp * 3;
		const hits = this.raycaster.intersectObject(this.root, true);
		for (const h of hits) {
			if (h.object.userData.helper) continue;
			if (!this.isVisibleInTree(h.object)) continue;
			return h;
		}
		return null;
	}

	// ----------------------------------------------------------- рендер
	render() {
		const app = this.app;
		const nav = app.nav;
		const o = app.settings.overlays;
		this.grid.visible = o.grid && !this.fxHide;
		this.grid.material.uniforms.uAxes.value = o.axes ? 1 : 0;
		if (o.grid) this.grid.update(nav, this.camera);
		app.display.updateUniforms(this.camera, this.size, nav);

		if (this.headlight.visible) {
			const cam = this.camera;
			const off = new THREE.Vector3(-0.6, 0.9, 0.4).multiplyScalar(nav.distance).applyQuaternion(cam.quaternion);
			this.headlight.position.copy(nav.target).add(off);
			this.headlight.target.position.copy(nav.target);
			this.headlight.target.updateMatrixWorld();
		}
		if (this.renderHook) this.renderHook(this.renderer, this.scene, this.camera);
		else this.renderer.render(this.scene, this.camera);
		const now = performance.now();
		const dt = now - (this._lastT || 0);
		if (dt < 150) this.fps = (this.fps || 60) * 0.85 + (1000 / Math.max(dt, 1)) * 0.15;
		this._lastT = now;
		this._autoQuality(dt, now);
		app.bus.emit('rendered');
	}

	/**
	 * Авто-качество: если кадров не хватает, разрешение отрисовки мягко снижается (до половины), а когда запас есть, возвращается.
	 * Геометрия, эффекты и цвета не меняются: теряется только чёткость краёв, и только пока компьютер не справляется.
	 */
	_autoQuality(dt, now) {
		const s = this.app.settings.render;
		const fx = this.app.ui?.effectsEngine;
		if (!s.autoQuality) {
			if (this._qs !== 1) this.setScale(1);
			return;
		}
		if (dt > 150 || fx?.recording || fx?.animBusy) return; // паузы между редкими кадрами и запись не считаем
		this._qEma = (this._qEma || 16.7) * 0.9 + dt * 0.1;
		if (now - (this._qT || 0) < 1500) return;
		this._qT = now;
		const fps = 1000 / this._qEma;
		// снижаем только если кадров мало несколько проверок подряд: одиночный провал (например, при загрузке) не повод менять разрешение
		this._qLow = fps < 30 ? (this._qLow || 0) + 1 : 0;
		if (this._qLow >= 3 && this._qs > 0.6) {
			this._qLow = 0;
			this._qDown = now;
			this.setScale(Math.max(0.6, this._qs * 0.85));
			// размытие под панелями тоже стоит кадров: при просадке интерфейс переходит на плоское стекло
			document.documentElement.classList.add('perf-flat');
		} else if (fps > 56 && this._qs < 1 && now - (this._qDown || 0) > 20000) this.setScale(Math.min(1, this._qs * 1.15));
	}

	/** Меняет разрешение отрисовки и тут же перерисовывает кадр: иначе после смены размера холст на миг оставался пустым и сцена мигала */
	setScale(v) {
		this._qs = v;
		this.renderer.setPixelRatio(this._basePR * v);
		this.resize();
		if (!this._rescaling) {
			this._rescaling = true;
			try {
				this.render();
			} finally {
				this._rescaling = false;
			}
		}
	}

	frame(now) {
		const animating = this.app.nav.tick(now);
		if (this.dirty || animating) {
			this.dirty = false;
			this.render();
		}
	}

	start() {
		let lastF = 0;
		const loop = (now) => {
			requestAnimationFrame(loop);
			// лимит кадров (например, 30 в секунду) экономит заряд и нагрев
			const cap = this.app.settings.render.fpsCap || perf.maxFps;
			if (cap && now - lastF < 1000 / cap - 3) return;
			lastF = now;
			this.frame(now);
		};
		requestAnimationFrame(loop);
	}

	/** Скриншот окна просмотра (PNG). transparent=true — без фона. */
	async screenshot({ transparent = false } = {}) {
		this.render();
		const src = this.canvas;
		const out = document.createElement('canvas');
		out.width = src.width;
		out.height = src.height;
		const ctx = out.getContext('2d');
		const bg = BACKGROUNDS[this.app.settings.render.bg] || BACKGROUNDS.dark;
		if (!transparent) {
			ctx.fillStyle = bg.solid || '#2a2d33';
			ctx.fillRect(0, 0, out.width, out.height);
		}
		ctx.drawImage(src, 0, 0);
		return new Promise((res) => out.toBlob(res, 'image/png'));
	}
}
