// Оболочка интерфейса: шапка, панель инструментов, оверлеи вьюпорта, вкладки, подсказки, тосты,
// перетаскивание файлов, горячие клавиши, справка.
import * as THREE from 'three';
import { h, $, $$, extOf, formatInt, downloadBlob } from './util.js';
import { icon, hydrateIcons } from './icons.js';
import { segmented, switchRow, button } from './ui-kit.js';
import { AxisGizmo } from './gizmo.js';
import { createScenePanel } from './panel-scene.js';
import { createMaterialPanel } from './panel-material.js';
import { createViewPanel, DISPLAY_MODES } from './panel-view.js';
import { createExportPanel } from './panel-export.js';
import { createPointsPanel } from './panel-points.js';
import { createMediaPanel } from './panel-media.js';
import { createMediaBar } from './media-bar.js';
import { EffectsEngine } from './effects-engine.js';
import { createEffectsPanel, makeModelProvider } from './panel-effects.js';
import { importFiles, assignTextureFiles, ACCEPT_ALL, MODEL_FORMATS, IMAGE_EXT } from './importers.js';
import { BACKGROUNDS } from './viewport.js';

const TOAST_ICON = { ok: 'check-circle', warn: 'warning', error: 'warning-circle', info: 'info' };

/** Масштаб интерфейса (CSS zoom на html): экранные пиксели делим на него, чтобы получить CSS-пиксели */
const uiZoom = () => parseFloat(document.documentElement.style.zoom) || 1;

export class UI {
	constructor(app) {
		this.app = app;
		this.tabs = {};
		this.busyTimer = null;
		this.dragDepth = 0;
		this.openMode = 'auto';
		this.effectsEngine = new EffectsEngine(app);
		this.workspace = 'edit';
	}

	init() {
		const app = this.app;
		hydrateIcons();
		this.fileInput = $('#fileInput');
		this.textureInput = $('#textureInput');
		this.fileInput.accept = ACCEPT_ALL;
		this.dialog = $('#dialog');
		this.buildChips();
		this.buildHeader();
		this.buildUiScale();
		this.buildToolrail();
		this.buildViewportOverlays();
		this.buildSidebar();
		this.buildTooltips();
		this.buildDragDrop();
		this.buildShortcuts();
		this.buildStatus();
		this.buildPaste();
		this.refreshFps();
		app.bus.on('scene', () => this.refreshScene());
		app.bus.on('selection', () => this.refreshScene());
		app.bus.on('geometry', () => this.updateStatus());
		app.bus.on('history', () => this.refreshHistory());
		app.bus.on('fx', () => this.refreshHistory());
		app.bus.on('tool', () => this.refreshTool());
		app.bus.on('camera', () => this.refreshViewLabel());
		app.bus.on('viewmode', () => this.refreshViewLabel());
		app.bus.on('view', () => this.syncModeBar());
		this.refreshScene();
		this.refreshHistory();
		this.refreshTool();
		this.refreshViewLabel();
	}

	// ---------------------------------------------------------------- шапка
	buildChips() {
		const box = $('#formatChips');
		for (const ext of [...Object.keys(MODEL_FORMATS), 'zip']) box.append(h('span', { class: 'chip' }, ext));
	}

	buildHeader() {
		const app = this.app;
		$('#btnOpen').dataset.tip = 'Открыть модель, текстуры, фото или видео (O)';
		$('#btnOpen').addEventListener('click', () => this.openFiles('auto'));
		$('#btnTexture').addEventListener('click', () => this.openTextures());
		$$('#modeSwitch [data-ws]').forEach((b) => b.addEventListener('click', () => this.setWorkspace(b.dataset.ws)));
		$('#btnEmptyOpen').addEventListener('click', () => this.openFiles('auto'));
		$('#btnEmptyDemo').addEventListener('click', () => app.loadDemo());
		$('#btnEmptyMedia').addEventListener('click', () => {
			const inp = document.createElement('input');
			inp.type = 'file';
			inp.accept = 'video/*,image/*,.pcv';
			inp.addEventListener('change', () => inp.files[0] && this.openMedia(inp.files[0]));
			inp.click();
		});
		$('#btnUrl').addEventListener('click', () => this.openUrl());
		$('#btnUndo').addEventListener('click', () => this.undo());
		$('#btnRedo').addEventListener('click', () => this.redo());
		$('#btnHelp').addEventListener('click', () => this.showHelp());
		$('#btnExport').addEventListener('click', () => this.exportNow());
		const themeBtn = $('#btnTheme');
		const setTheme = (t, persist = true) => {
			document.documentElement.setAttribute('data-theme', t);
			if (persist) {
				try {
					localStorage.setItem('objglb.theme', t);
				} catch (e) {
					/* без сохранения */
				}
			}
			// Светлая тема интерфейса получает светлый фон сцены, и наоборот (если фон не выбран вручную)
			const r = this.app.settings.render;
			if (t === 'light' && r.bg === 'dark') r.bg = 'light';
			else if (t === 'dark' && r.bg === 'light') r.bg = 'dark';
			this.app.viewport.applyRenderSettings();
			this.app.display.apply();
			this.app.bus.emit('view');
			themeBtn.textContent = '';
			themeBtn.insertAdjacentHTML('afterbegin', icon(t === 'dark' ? 'sun' : 'moon', 18));
			themeBtn.dataset.tip = t === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
		};
		themeBtn.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
		setTheme(document.documentElement.getAttribute('data-theme') || 'dark', false);

		this.fileInput.addEventListener('change', async () => {
			const files = [...this.fileInput.files];
			this.fileInput.value = '';
			if (files.length) await this.handleFiles(files, { mode: this.openMode });
		});
		this.textureInput.addEventListener('change', async () => {
			const files = [...this.textureInput.files];
			this.textureInput.value = '';
			if (files.length) {
				const placed = await assignTextureFiles(app, files, null);
				if (placed.length) this.showTab('material');
			}
		});
	}

	// ------------------------------------------------- загрузка по ссылке и из буфера
	async openUrl() {
		const dlg = this.dialog;
		dlg.textContent = '';
		const input = h('input', { type: 'url', class: 'num-in', style: { textAlign: 'left', fontFamily: 'var(--font)', fontSize: '13px', height: '38px' }, placeholder: 'https://example.com/model.glb', spellcheck: 'false', 'aria-label': 'Ссылка на файл' });
		const err = h('div', { class: 'dlg-error', hidden: true });
		const go = async () => {
			const url = input.value.trim();
			if (!/^https?:\/\//i.test(url)) {
				err.hidden = false;
				err.textContent = 'Нужна ссылка, которая начинается с http:// или https://';
				return;
			}
			dlg.close();
			await this.loadFromUrl(url);
		};
		input.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter') go();
		});
		dlg.append(
			h(
				'div',
				{ class: 'dlg-inner' },
				h('h2', {}, 'Открыть по ссылке'),
				h('p', {}, 'Вставьте прямую ссылку на файл: модель (GLB, OBJ, STL, ZIP…) или картинку-текстуру. Сайт с файлом должен разрешать загрузку из браузера (CORS), иначе скачайте файл и перетащите его сюда.'),
				input,
				err,
				h('p', { class: 'dlg-hint' }, 'Подсказка: ссылку можно просто вставить на странице клавишами Ctrl+V, а адрес вида ?model=ссылка откроет модель сразу.'),
				h('div', { class: 'dlg-actions' }, button({ label: 'Отмена', variant: 'secondary', onClick: () => dlg.close() }), button({ label: 'Открыть', variant: 'primary', icon: 'download-simple', onClick: go }))
			)
		);
		dlg.onclose = null;
		dlg.showModal();
		input.focus();
	}

	/** Скачивает файл по ссылке и отдаёт его обычному импорту */
	async loadFromUrl(url, { textures = [] } = {}) {
		const fetchFile = async (u) => {
			const res = await fetch(u, { mode: 'cors' });
			if (!res.ok) throw new Error('сервер ответил кодом ' + res.status);
			const blob = await res.blob();
			let name = '';
			try {
				name = decodeURIComponent(new URL(u, location.href).pathname.split('/').pop() || '');
			} catch (e) {
				name = '';
			}
			if (!/\.\w{2,5}$/.test(name)) {
				const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
				const magic = String.fromCharCode(...head);
				const byType = { 'model/gltf-binary': 'glb', 'model/gltf+json': 'gltf', 'application/zip': 'zip', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type];
				const ext = magic === 'glTF' ? 'glb' : magic.startsWith('PK') ? 'zip' : byType || 'obj';
				name = (name || 'model') + '.' + ext;
			}
			return new File([blob], name, { type: blob.type });
		};
		try {
			this.busy('Скачиваю файл по ссылке');
			const files = [await fetchFile(url)];
			for (const t of textures) files.push(await fetchFile(t));
			this.idle();
			await this.handleFiles(files, {});
		} catch (e) {
			this.idle();
			console.error(e);
			const cors = e instanceof TypeError;
			this.toast(cors ? 'Не удалось скачать файл. Скорее всего, сайт не разрешает загрузку из браузера (CORS) или ссылка недоступна. Скачайте файл и перетащите его в окно.' : 'Не удалось скачать файл: ' + (e.message || e), 'error', 9000);
		}
	}

	buildPaste() {
		const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
		window.addEventListener('paste', async (e) => {
			if (isTyping(e.target) || this.dialog.open) return;
			const dt = e.clipboardData;
			if (!dt) return;
			const files = [...(dt.files || [])];
			if (files.length) {
				e.preventDefault();
				await this.handleFiles(files, {});
				return;
			}
			const text = (dt.getData('text') || '').trim();
			if (/^https?:\/\/\S+$/i.test(text)) {
				e.preventDefault();
				this.loadFromUrl(text);
			}
		});
	}

	// ---------------------------------------------------------------- FPS
	refreshFps() {
		const el = $('#statusFps');
		const on = this.app.settings.render.fps;
		el.hidden = !on;
		if (on && !this.fpsTimer) {
			this.fpsTimer = setInterval(() => {
				const vp = this.app.viewport;
				const live = performance.now() - (vp._lastT || 0) < 700;
				el.innerHTML = live ? `FPS <b>${Math.round(vp.fps || 0)}</b>` : 'FPS <b>0</b> (сцена не меняется)';
			}, 400);
		} else if (!on && this.fpsTimer) {
			clearInterval(this.fpsTimer);
			this.fpsTimer = null;
		}
	}

	setExportLabel(text) {
		const el = $('#btnExportLabel');
		if (el) el.textContent = text;
	}

	openFiles(mode = 'auto') {
		this.openMode = mode;
		this.fileInput.click();
	}
	openTextures() {
		if (!this.app.model.materials().length) {
			this.toast('Сначала откройте модель, потом добавьте к ней текстуру', 'info');
			return;
		}
		this.textureInput.click();
	}

	undo() {
		// в режиме эффектов отменяются именно правки эффектов
		if (this.workspace === 'fx') {
			this.effectsEngine.undo().then((l) => l && this.toast('Отменено: ' + l, 'info', 1800));
			return;
		}
		const c = this.app.history.undo();
		if (c) this.toast('Отменено: ' + c.label, 'info', 1800);
	}
	redo() {
		if (this.workspace === 'fx') {
			this.effectsEngine.redo().then((l) => l && this.toast('Повторено: ' + l, 'info', 1800));
			return;
		}
		const c = this.app.history.redo();
		if (c) this.toast('Повторено: ' + c.label, 'info', 1800);
	}

	buildExportPop() {
		const pop = $('#exportPop');
		const btn = $('#btnExportOpts');
		this.exportPop = pop;
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggleExportPop();
		});
		$('#btnExportClose').addEventListener('click', () => this.toggleExportPop(false));
		document.addEventListener('pointerdown', (e) => {
			if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.split-btn') && !e.target.closest('.dlg')) this.toggleExportPop(false);
		});
	}

	toggleExportPop(force) {
		const pop = this.exportPop;
		const open = force !== undefined ? force : pop.hidden;
		pop.hidden = !open;
		$('#btnExportOpts').setAttribute('aria-expanded', String(open));
	}

	exportNow() {
		if (!this.app.viewport.root.children.some((c) => !c.userData.helper)) {
			this.toast('Сцена пуста: сначала откройте модель', 'warn');
			return;
		}
		this.exportPanel.run();
	}

	refreshHistory() {
		const hst = this.workspace === 'fx' ? this.effectsEngine : this.app.history;
		const u = $('#btnUndo');
		const r = $('#btnRedo');
		u.disabled = !hst.canUndo;
		r.disabled = !hst.canRedo;
		u.dataset.tip = hst.canUndo ? `Отменить: ${hst.undoLabel} (Ctrl+Z)` : 'Отменить (Ctrl+Z)';
		r.dataset.tip = hst.canRedo ? `Повторить: ${hst.redoLabel} (Ctrl+Shift+Z)` : 'Повторить (Ctrl+Shift+Z)';
	}

	// ------------------------------------------------------- панель инструментов
	buildToolrail() {
		const app = this.app;
		const model = app.model;
		$$('.btn-tool[data-tool]').forEach((b) => b.addEventListener('click', () => model.setTool(b.dataset.tool)));
		$('#btnSnap').addEventListener('click', () => this.toggleSnap());
		$('#btnSpace').addEventListener('click', () => this.toggleSpace());
		$('#btnFrameAll').addEventListener('click', () => app.nav.frameAll());
		$('#btnFrameSel').addEventListener('click', () => app.nav.frameSelected());
	}
	toggleSnap() {
		const s = this.app.settings.snap;
		s.on = !s.on;
		this.app.model.applySnap();
		this.app.saveSettings();
		this.app.bus.emit('tool');
		this.toast(s.on ? 'Привязка к шагу включена' : 'Привязка выключена', 'info', 1500);
	}
	toggleSpace() {
		const s = this.app.settings;
		s.space = s.space === 'world' ? 'local' : 'world';
		this.app.model.applySnap();
		this.app.saveSettings();
		this.app.bus.emit('tool');
	}
	refreshTool() {
		const tool = this.app.model.tool;
		$$('.btn-tool[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
		const s = this.app.settings;
		const snap = $('#btnSnap');
		snap.setAttribute('aria-pressed', String(s.snap.on));
		const sp = $('#btnSpace');
		sp.setAttribute('aria-pressed', String(s.space === 'local'));
		sp.dataset.tip = s.space === 'local' ? 'Оси гизмо: локальные (L)' : 'Оси гизмо: глобальные (L)';
		this.updateHint();
	}

	// ---------------------------------------------------- оверлеи вьюпорта
	buildViewportOverlays() {
		const app = this.app;
		const s = app.settings;
		// режимы отображения
		this.modeBar = segmented({ options: DISPLAY_MODES, value: s.display, label: 'Режим отображения', onChange: (v) => app.setDisplay(v) });
		$('#modeBar').append(this.modeBar.el);
		this.modeBar.el.style.cssText = 'background:transparent;border:0;padding:0';

		// выпадающее меню оверлеев
		const btn = $('#btnOverlays');
		const pop = $('#overlayPop');
		const rows = [
			['grid', 'Сетка', 'Плоскость пола и шаг сетки'],
			['axes', 'Оси координат', 'Красная линия X, синяя Z'],
			['wire', 'Каркас поверх', 'Рёбра поверх любого режима'],
			['faces', 'Ориентация граней', 'Синий: лицо, красный: изнанка'],
			['bbox', 'Рамка выделения', 'Габаритный бокс выбранного объекта'],
		];
		for (const [key, label, hint] of rows) {
			const r = switchRow(label, { value: s.overlays[key], onChange: (v) => {
				s.overlays[key] = v;
				app.display.apply();
				app.viewport.updateSelectionBox();
				app.saveSettings();
			} }, hint);
			pop.append(r.el);
		}
		const close = () => {
			pop.hidden = true;
			btn.setAttribute('aria-expanded', 'false');
		};
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			pop.hidden = !pop.hidden;
			btn.setAttribute('aria-expanded', String(!pop.hidden));
		});
		document.addEventListener('pointerdown', (e) => {
			if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close();
		});
		this.closeOverlayPop = close;

		// гизмо осей и кнопки справа
		this.gizmo = new AxisGizmo(app, $('#axisCanvas'));
		$('#btnOrtho').addEventListener('click', () => {
			app.nav.toggleOrtho();
			app.saveSettings();
		});
		$('#btnShot').addEventListener('click', async () => {
			const blob = await app.viewport.screenshot({ transparent: app.settings.render.bg === 'checker' });
			downloadBlob(blob, 'screenshot.png');
			this.toast('Скриншот сохранён', 'ok', 1800);
		});
		const sidebarBtn = $('#btnSidebar');
		sidebarBtn.addEventListener('click', () => this.toggleSidebar());
		if (window.matchMedia('(max-width: 900px)').matches) this.toggleSidebar(true);
	}

	toggleSidebar(force) {
		const ws = $('.workspace');
		const hidden = force !== undefined ? force : !ws.classList.contains('sidebar-hidden');
		ws.classList.toggle('sidebar-hidden', hidden);
		setTimeout(() => this.app.viewport.resize(), 320);
	}

	syncModeBar() {
		this.modeBar.set(this.app.settings.display);
	}

	refreshViewLabel() {
		const app = this.app;
		const el = $('#viewLabel');
		const grid = app.viewport.grid;
		const step = grid.spacing;
		const stepTxt = step >= 1000 ? step / 1000 + 'k' : step >= 0.01 ? parseFloat(step.toPrecision(3)) : step.toExponential(0);
		el.innerHTML = `<b>${app.nav.viewLabel()}</b><span>Сетка ${stepTxt}</span>`;
		$('#btnOrtho').setAttribute('aria-pressed', String(app.nav.ortho));
		$('#btnOrtho').dataset.tip = app.nav.ortho ? 'Сейчас: ортогональная. Включить перспективу (5)' : 'Сейчас: перспектива. Включить ортогональную (5)';
	}

	// --------------------------------------------------------- боковая панель
	buildSidebar() {
		const app = this.app;
		for (const name of ['scene', 'material', 'points', 'media', 'view']) this.tabs[name] = $(`#panel-${name}`);
		$$('.tab').forEach((t) => t.addEventListener('click', () => this.showTab(t.dataset.tab)));
		this.scenePanel = createScenePanel(app, this.tabs.scene);
		this.materialPanel = createMaterialPanel(app, this.tabs.material);
		this.viewPanel = createViewPanel(app, this.tabs.view);
		this.pointsPanel = createPointsPanel(app, this.tabs.points);
		this.mediaPanel = createMediaPanel(app, this.tabs.media);
		this.mediaBar = createMediaBar(app, $('#viewport'));
		// вкладка «Медиа» появляется только когда открыто фото или видео
		const mediaTab = $('.tab[data-tab="media"]');
		app.bus.on('media', () => {
			const has = app.media.ready;
			mediaTab.hidden = !has;
			if (!has && !this.tabs.media.hidden) this.showTab('scene');
		});
		this.exportPanel = createExportPanel(app, $('#panel-export'));
		this.effectsEngine.modelProvider = makeModelProvider(app);
		this.effectsPanel = createEffectsPanel(app, $('#panel-effects'), this.effectsEngine);
		this.buildExportPop();
		this.makeSidebarResizable();
	}

	buildUiScale() {
		const SCALES = [0.75, 0.85, 0.92, 1.0, 1.1, 1.2, 1.35];
		let currentScale = 1.0;

		// без сохранённого выбора: на обычных экранах 100%, на больших интерфейс сам увеличивается
		const autoScale = () => Math.round(Math.min(1.5, Math.max(1, window.innerWidth / 1600)) * 20) / 20;
		currentScale = autoScale();
		try {
			const saved = localStorage.getItem('objglb.ui-scale');
			if (saved) {
				const val = parseFloat(saved);
				if (!isNaN(val) && val >= 0.6 && val <= 2.0) {
					currentScale = val;
				}
			}
		} catch (_) {}

		const applyScale = (s, persist = true) => {
			currentScale = Math.round(s * 100) / 100;
			document.documentElement.style.zoom = String(currentScale);
			document.documentElement.style.setProperty('--ui-scale', String(currentScale));
			const label = $('#scaleValue');
			if (label) label.textContent = `${Math.round(currentScale * 100)}%`;
			if (persist) {
				try {
					localStorage.setItem('objglb.ui-scale', currentScale);
				} catch (_) {}
			}
			setTimeout(() => {
				if (this.app?.viewport) this.app.viewport.resize();
			}, 50);
		};

		applyScale(currentScale, false);

		this.changeUiScale = (dir) => {
			let idx = SCALES.findIndex((v) => Math.abs(v - currentScale) < 0.04);
			if (idx === -1) {
				idx = SCALES.reduce((closest, v, i) => Math.abs(v - currentScale) < Math.abs(SCALES[closest] - currentScale) ? i : closest, 0);
			}
			const nextIdx = Math.max(0, Math.min(SCALES.length - 1, idx + dir));
			applyScale(SCALES[nextIdx], true);
		};

		this.resetUiScale = () => {
			applyScale(1.0, true);
		};

		$('#btnScaleDown')?.addEventListener('click', () => this.changeUiScale(-1));
		$('#btnScaleUp')?.addEventListener('click', () => this.changeUiScale(1));
		$('#btnScaleReset')?.addEventListener('click', () => this.resetUiScale());
	}

	showTab(name) {
		if (this.workspace === 'fx') return;
		$$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
		for (const [k, el] of Object.entries(this.tabs)) el.hidden = k !== name;
		if (name === 'material') this.materialPanel.refresh();
		const ws = $('.workspace');
		if (ws.classList.contains('sidebar-hidden')) this.toggleSidebar(false);
	}

	/** Рабочее пространство: «edit» (редактор) или «fx» (эффекты для облака точек) */
	async setWorkspace(ws) {
		if (ws === this.workspace) return;
		const fxPanel = $('#panel-effects');
		if (ws === 'fx') {
			this.prevTab = $$('.tab').find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.tab || 'scene';
			this.closeOverlayPop && this.closeOverlayPop();
			this.toggleExportPop(false);
			try {
				await this.effectsEngine.enter();
			} catch (e) {
				this.toast('Не удалось запустить эффекты: ' + (e.message || e), 'error');
				return;
			}
			this.workspace = 'fx';
			setTimeout(() => this.refreshHistory(), 700);
			for (const el of Object.values(this.tabs)) el.hidden = true;
			fxPanel.hidden = false;
			if ($('.workspace').classList.contains('sidebar-hidden') && !window.matchMedia('(max-width: 900px)').matches) this.toggleSidebar(false);
		} else {
			this.workspace = 'edit';
			this.refreshHistory();
			this.effectsEngine.exit();
			fxPanel.hidden = true;
			this.showTab(this.prevTab || 'scene');
		}
		$$('#modeSwitch [data-ws]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ws === this.workspace)));
		setTimeout(() => this.app.viewport.resize(), 60);
	}

	makeSidebarResizable() {
		const resizer = $('#sidebarResizer');
		const sidebar = $('#sidebar');
		const ws = $('.workspace');
		if (!resizer || !sidebar || !ws) return;

		try {
			const saved = localStorage.getItem('objglb.sidebar-w');
			if (saved) {
				const w = parseInt(saved, 10);
				if (w >= 200 && w <= 700) {
					document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
				}
			}
		} catch (_) {}

		let isResizing = false;
		let startX = 0;
		let startW = 0;

		const onPointerDown = (e) => {
			if (e.button !== 0) return;
			isResizing = true;
			startX = e.clientX;
			startW = sidebar.getBoundingClientRect().width;
			ws.classList.add('is-resizing');
			document.body.style.cursor = 'col-resize';
			try {
				resizer.setPointerCapture(e.pointerId);
			} catch (_) {}
			e.preventDefault();
		};

		const onPointerMove = (e) => {
			if (!isResizing) return;
			const z = uiZoom();
			const delta = (startX - e.clientX) / z;
			let newW = Math.round(startW / z + delta);
			const minW = 200;
			const maxW = Math.max(minW, Math.min(650, window.innerWidth / z - 200));
			newW = Math.max(minW, Math.min(maxW, newW));
			document.documentElement.style.setProperty('--sidebar-w', `${newW}px`);
			this.app.viewport.resize();
		};

		const onPointerUp = (e) => {
			if (!isResizing) return;
			isResizing = false;
			ws.classList.remove('is-resizing');
			document.body.style.cursor = '';
			try {
				resizer.releasePointerCapture(e.pointerId);
			} catch (_) {}
			const currentW = Math.round(sidebar.getBoundingClientRect().width);
			try {
				localStorage.setItem('objglb.sidebar-w', currentW);
			} catch (_) {}
			this.app.viewport.resize();
		};

		resizer.addEventListener('pointerdown', onPointerDown);
		resizer.addEventListener('pointermove', onPointerMove);
		resizer.addEventListener('pointerup', onPointerUp);
		resizer.addEventListener('pointercancel', onPointerUp);

		resizer.addEventListener('dblclick', () => {
			document.documentElement.style.setProperty('--sidebar-w', '280px');
			try {
				localStorage.removeItem('objglb.sidebar-w');
			} catch (_) {}
			this.app.viewport.resize();
		});
	}

	// --------------------------------------------------------------- статус
	buildStatus() {
		this.updateHint();
		this.updateStatus();
	}

	updateHint() {
		const app = this.app;
		const tool = app.model.tool;
		const k = (t) => `<kbd>${t}</kbd>`;
		let html;
		if (tool === 'select') {
			const left = app.settings.nav.leftOrbit ? `${k('ЛКМ')} вращать` : `${k('СКМ')} вращать`;
			html = `${left} &nbsp; ${k('Shift')}+${k('СКМ')} сдвиг &nbsp; ${k('Колесо')} масштаб &nbsp; ${k('Клик')} выбрать &nbsp; ${k('?')} все клавиши`;
		} else {
			const names = { translate: 'перемещение', rotate: 'вращение', scale: 'масштаб' };
			html = `Режим: ${names[tool]}. Тяните стрелки на модели. ${k('Q')} выбор &nbsp; ${k('G')} ${k('R')} ${k('S')} инструменты &nbsp; ${k('N')} привязка`;
		}
		$('#statusHint').innerHTML = html;
	}

	updateStatus() {
		const st = this.app.model.stats();
		const el = $('#statusStats');
		const parts = [];
		if (st.verts) parts.push(`Вершин <b>${formatInt(st.verts)}</b>`, `Треугольников <b>${formatInt(st.tris)}</b>`);
		if (st.points) parts.push(`Точек <b>${formatInt(st.points)}</b>`);
		parts.push(`Материалов <b>${st.materials}</b>`, `Текстур <b>${st.textures}</b>`);
		el.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
	}

	refreshScene() {
		const app = this.app;
		const top = app.viewport.root.children.filter((c) => !c.userData.helper);
		$('#emptyState').hidden = top.length > 0;
		const title = $('#docTitle');
		if (!top.length) title.textContent = 'Нет модели';
		else if (top.length === 1) title.innerHTML = `<b>${escapeHtml(top[0].name || 'Модель')}</b>`;
		else title.innerHTML = `<b>${top.length}</b> объектов в сцене`;
		this.updateStatus();
	}

	// ---------------------------------------------------------- подсказки
	buildTooltips() {
		const tip = $('#tooltip');
		let timer = null;
		let current = null;
		const hide = () => {
			clearTimeout(timer);
			timer = null;
			current = null;
			tip.classList.remove('is-on');
			tip.hidden = true;
		};
		const show = (el) => {
			const text = el.dataset.tip;
			if (!text) return;
			tip.textContent = text;
			tip.hidden = false;
			const z = uiZoom();
			const br = el.getBoundingClientRect();
			const r = { left: br.left / z, right: br.right / z, top: br.top / z, bottom: br.bottom / z, width: br.width / z, height: br.height / z };
			const pos = el.dataset.tipPos || 'bottom';
			const tw = tip.offsetWidth;
			const th = tip.offsetHeight;
			let x, y;
			if (pos === 'right') {
				x = r.right + 10;
				y = r.top + (r.height - th) / 2;
			} else if (pos === 'left') {
				x = r.left - tw - 10;
				y = r.top + (r.height - th) / 2;
			} else {
				x = r.left + (r.width - tw) / 2;
				y = r.bottom + 8;
				if (y + th > window.innerHeight / z - 8) y = r.top - th - 8;
			}
			x = Math.max(8, Math.min(window.innerWidth / z - tw - 8, x));
			tip.style.left = x + 'px';
			tip.style.top = y + 'px';
			requestAnimationFrame(() => tip.classList.add('is-on'));
		};
		document.addEventListener('pointerover', (e) => {
			const el = e.target.closest && e.target.closest('[data-tip]');
			if (!el || el === current) return;
			hide();
			current = el;
			timer = setTimeout(() => show(el), 380);
		});
		document.addEventListener('pointerout', (e) => {
			if (current && !current.contains(e.relatedTarget)) hide();
		});
		document.addEventListener('pointerdown', hide, true);
		document.addEventListener('scroll', hide, true);
	}

	// --------------------------------------------------- тосты и «занято»
	toast(msg, type = 'info', ms) {
		const box = $('#toasts');
		const life = ms || (type === 'error' ? 8000 : type === 'warn' ? 6500 : 4200);
		const el = h('div', { class: 'toast ' + type, role: type === 'error' ? 'alert' : 'status', html: icon(TOAST_ICON[type] || 'info', 18) }, h('span', {}, msg));
		box.append(el);
		while (box.children.length > 4) box.firstElementChild.remove();
		const kill = () => {
			el.classList.add('is-leaving');
			setTimeout(() => el.remove(), 260);
		};
		const t = setTimeout(kill, life);
		el.addEventListener('click', () => {
			clearTimeout(t);
			kill();
		});
	}

	busy(text, progress) {
		const box = $('#busy');
		$('#busyText').textContent = text;
		const bar = $('#busyBar');
		if (progress === undefined) {
			bar.classList.add('is-indeterminate');
			bar.style.width = '';
		} else {
			bar.classList.remove('is-indeterminate');
			bar.style.width = Math.max(4, Math.min(100, progress * 100)) + '%';
		}
		if (!box.hidden) return;
		if (this.busyTimer) return;
		this.busyTimer = setTimeout(() => {
			this.busyTimer = null;
			box.hidden = false;
		}, 140);
	}
	idle() {
		clearTimeout(this.busyTimer);
		this.busyTimer = null;
		$('#busy').hidden = true;
	}

	// ------------------------------------------------------------- диалоги
	choose({ title, text, buttons }) {
		return new Promise((resolve) => {
			const dlg = this.dialog;
			dlg.textContent = '';
			const done = (v) => {
				dlg.close();
				resolve(v);
			};
			const actions = h('div', { class: 'dlg-actions' }, ...buttons.map((b) => button({ label: b.label, variant: b.variant || 'secondary', icon: b.icon, onClick: () => done(b.value) })));
			dlg.append(h('div', { class: 'dlg-inner' }, h('h2', {}, title), h('p', {}, text), actions));
			dlg.onclose = () => resolve(null);
			dlg.showModal();
		});
	}

	showHelp() {
		const k = (...keys) => h('span', { class: 'help-keys' }, ...keys.map((x) => h('kbd', {}, x)));
		const row = (label, ...keys) => h('div', { class: 'help-row' }, h('span', {}, label), k(...keys));
		const group = (title, ...rows) => h('div', { class: 'help-group' }, h('h3', {}, title), ...rows);
		const dlg = this.dialog;
		dlg.textContent = '';
		const close = button({ label: 'Закрыть', variant: 'secondary', onClick: () => dlg.close() });
		dlg.append(
			h(
				'div',
				{ class: 'dlg-inner' },
				h('h2', {}, 'Как пользоваться'),
				h('p', {}, 'Перетащите модель в окно (вместе с .mtl и текстурами или всей папкой), при необходимости добавьте текстуру, затем нажмите «Скачать GLB».'),
				h(
					'div',
					{ class: 'help-grid' },
					group('Навигация', row('Вращение', 'СКМ'), row('Вращение (трекпад)', 'Alt', 'ЛКМ'), row('Сдвиг', 'Shift', 'СКМ'), row('Масштаб', 'Колесо'), row('Центр на точке', 'Двойной клик'), row('Показать всё', 'Home'), row('Показать выбранное', 'F')),
					group('Виды', row('Спереди / сзади', 'Num 1'), row('Справа / слева', 'Num 3'), row('Сверху / снизу', 'Num 7'), row('Без Numpad', 'Alt', '1 3 7'), row('Ортогональная', 'Num 5', 'P'), row('Шаг вращения', 'Num 4 6 8 2')),
					group('Правка', row('Выбор', 'Q'), row('Переместить', 'G'), row('Вращать', 'R'), row('Масштаб', 'S'), row('Привязка к шагу', 'N'), row('Оси: мир / локальные', 'L'), row('Дублировать', 'Shift', 'D'), row('Удалить', 'X'), row('Скрыть / показать', 'H', 'Alt+H')),
					group('Общее', row('Режимы отображения', '1', '…', '6'), row('Следующий режим', 'Z'), row('Каркас поверх', 'Shift', 'Z'), row('Отменить / повторить', 'Ctrl+Z', 'Ctrl+Shift+Z'), row('Открыть / текстура', 'O', 'T'), row('Открыть по ссылке', 'U'), row('Вставить файл или ссылку', 'Ctrl+V'), row('Экспорт', 'Ctrl+E'), row('Режим эффектов', 'E'), row('Музыка: пуск / пауза', 'Пробел'), row('Панель справа', 'Tab'), row('Эффекты частиц', 'E'), row('Масштаб интерфейса', 'Ctrl + / -', 'Ctrl 0'))
				),
				h('div', { class: 'dlg-actions' }, close)
			)
		);
		dlg.onclose = null;
		dlg.showModal();
	}

	// ------------------------------------------------------- файлы: drag & drop
	buildDragDrop() {
		const overlay = $('#dropOverlay');
		const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
		window.addEventListener('dragenter', (e) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			this.dragDepth++;
			overlay.hidden = false;
		});
		window.addEventListener('dragover', (e) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = 'copy';
		});
		window.addEventListener('dragleave', (e) => {
			if (!hasFiles(e)) return;
			this.dragDepth = Math.max(0, this.dragDepth - 1);
			if (!this.dragDepth) overlay.hidden = true;
		});
		window.addEventListener('drop', async (e) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			this.hideDrop();
			const files = await collectDropped(e.dataTransfer);
			if (files.length) await this.handleFiles(files, { point: { x: e.clientX, y: e.clientY } });
		});
	}
	hideDrop() {
		this.dragDepth = 0;
		$('#dropOverlay').hidden = true;
	}

	/** Единая точка входа для файлов: модели, текстуры, архивы */
	/** Фото, видео или точечный ролик: открываем во вкладке «Медиа» и превращаем в облако точек */
	async openMedia(file) {
		this.busy('Читаю файл', 0.3);
		try {
			await this.app.media.load(file);
			this.showTab('media');
		} catch (e) {
			this.toast(e.message || 'Не удалось открыть файл', 'error');
		} finally {
			this.idle();
		}
	}

	async handleFiles(files, { mode = 'auto', point = null } = {}) {
		const app = this.app;
		const isMedia = (f) => (f.type || '').startsWith('video') || ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'pcv'].includes(extOf(f.name));
		const vid = files.find(isMedia);
		if (vid && !files.some((f) => extOf(f.name) in MODEL_FORMATS || extOf(f.name) === 'zip')) return this.openMedia(vid);
		// одиночная картинка без модели в сцене: текстуре некуда ложиться, поэтому делаем из неё точки
		if (files.length === 1 && IMAGE_EXT.includes(extOf(files[0].name)) && !app.model.meshes().length) return this.openMedia(files[0]);
		const hasModel = files.some((f) => extOf(f.name) in MODEL_FORMATS || extOf(f.name) === 'zip');
		try {
			if (!hasModel) {
				const images = files.filter((f) => IMAGE_EXT.includes(extOf(f.name)));
				if (!images.length) {
					this.toast('Эти файлы не похожи на 3D-модель или текстуру', 'warn');
					return;
				}
				let material = null;
				if (point) {
					const rect = app.viewport.canvas.getBoundingClientRect();
					if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) {
						const hit = app.viewport.pick(point.x, point.y);
						if (hit && hit.object.isMesh) {
							const orig = app.display.getOriginal(hit.object);
							material = Array.isArray(orig) ? orig[hit.face ? hit.face.materialIndex : 0] || orig[0] : orig;
							app.model.select(hit.object);
						}
					}
				}
				await assignTextureFiles(app, images, material);
				return;
			}
			let useMode = mode;
			if (mode === 'auto' && app.model.renderables().length) {
				const choice = await this.choose({
					title: 'В сцене уже есть модель',
					text: 'Заменить текущую сцену новой моделью или добавить новую рядом?',
					buttons: [
						{ label: 'Отмена', value: null },
						{ label: 'Добавить в сцену', value: 'add', icon: 'plus' },
						{ label: 'Заменить сцену', value: 'replace', variant: 'primary', icon: 'arrows-clockwise' },
					],
				});
				if (!choice) return;
				useMode = choice;
			}
			this.busy('Читаю файлы', 0.02);
			const r = await importFiles(app, files, { mode: useMode });
			this.idle();
			this.reportImport(r);
		} catch (e) {
			this.idle();
			console.error(e);
			this.toast('Не удалось загрузить: ' + (e.message || e), 'error');
		}
	}

	reportImport(r) {
		const app = this.app;
		if (r.models.length) {
			app.nav.frameAll(true);
			const st = app.model.stats();
			this.toast(`Загружено: ${r.models.join(', ')}. Треугольников: ${formatInt(st.tris || st.points)}`, 'ok');
			const hasTex = app.model.materials().some((m) => m.map);
			if (!hasTex && st.tris) {
				setTimeout(() => this.toast('Текстур нет. Перетащите картинку на модель или нажмите «Текстура» вверху', 'info', 6500), 1200);
			}
			if (r.assigned && r.assigned.length) this.toast(`Текстуры назначены: ${r.assigned.length}`, 'ok');
			// Подсказка про единицы измерения: CAD и FBX часто в мм и см, а glTF ожидает метры
			const sz = app.viewport.getBounds(app.viewport.root).getSize(new THREE.Vector3());
			const big = Math.max(sz.x, sz.y, sz.z);
			if (big > 400 || (big > 0 && big < 0.02)) {
				setTimeout(() => {
					this.toast(big > 400 ? `Модель очень большая (${Math.round(big)} ед.). Если это миллиметры или сантиметры, выберите масштаб в настройках экспорта` : 'Модель очень маленькая. Проверьте масштаб в настройках экспорта', 'info', 8000);
				}, 2000);
			}
		}
		const uniq = [...new Set(r.warnings)];
		uniq.slice(0, 3).forEach((w, i) => setTimeout(() => this.toast(w, 'warn'), 400 + i * 250));
	}

	// ------------------------------------------------------- горячие клавиши
	buildShortcuts() {
		const app = this.app;
		const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
		const modeKeys = DISPLAY_MODES.map((m) => m.value);
		window.addEventListener('keydown', (e) => {
			if (this.dialog.open) {
				return;
			}
			const typing = isTyping(e.target);
			const mod = e.ctrlKey || e.metaKey;
			const code = e.code;
			const nav = app.nav;
			if (typing) {
				if (e.key === 'Escape') e.target.blur();
				return;
			}
			// отмена / повтор / экспорт
			if (mod && code === 'KeyZ') {
				e.preventDefault();
				e.shiftKey ? this.redo() : this.undo();
				return;
			}
			if (mod && code === 'KeyY') {
				e.preventDefault();
				this.redo();
				return;
			}
			if (mod && code === 'KeyE') {
				e.preventDefault();
				this.exportNow();
				return;
			}
			if (mod && code === 'KeyD') {
				e.preventDefault();
				app.ops.duplicateSelected();
				return;
			}
			if (mod && (code === 'Equal' || code === 'NumpadAdd' || e.key === '+' || e.key === '=')) {
				e.preventDefault();
				this.changeUiScale?.(1);
				return;
			}
			if (mod && (code === 'Minus' || code === 'NumpadSubtract' || e.key === '-')) {
				e.preventDefault();
				this.changeUiScale?.(-1);
				return;
			}
			if (mod && (code === 'Digit0' || code === 'Numpad0')) {
				e.preventDefault();
				this.resetUiScale?.();
				return;
			}
			if (mod) return;

			// виды (Numpad и Alt+цифры для клавиатур без Numpad)
			const numView = { Numpad1: 'front', Numpad3: 'right', Numpad7: 'top' };
			const altView = { Digit1: 'front', Digit3: 'right', Digit7: 'top' };
			const view = numView[code] || (e.altKey && altView[code]);
			if (view) {
				e.preventDefault();
				nav.setView(view, e.ctrlKey || e.shiftKey && code.startsWith('Numpad'));
				return;
			}
			if (e.altKey && code === 'KeyH') {
				e.preventDefault();
				app.model.root.traverse((o) => {
					if (!o.userData.helper && !o.visible && o !== app.model.root) o.visible = true;
				});
				app.model.changed({ display: false });
				return;
			}
			if (e.altKey) return;
			switch (code) {
				case 'Numpad5':
				case 'KeyP':
					nav.toggleOrtho();
					app.saveSettings();
					return;
				case 'Numpad0':
					nav.resetView();
					return;
				case 'Numpad4':
					return nav.orbitStep(-Math.PI / 12, 0);
				case 'Numpad6':
					return nav.orbitStep(Math.PI / 12, 0);
				case 'Numpad8':
					return nav.orbitStep(0, -Math.PI / 12);
				case 'Numpad2':
					return nav.orbitStep(0, Math.PI / 12);
				case 'NumpadDecimal':
				case 'KeyF':
					return nav.frameSelected();
				case 'Home':
					return nav.frameAll();
				case 'KeyQ':
					return app.model.setTool('select');
				case 'KeyG':
					return app.model.setTool('translate');
				case 'KeyR':
					return app.model.setTool('rotate');
				case 'KeyS':
					return app.model.setTool('scale');
				case 'KeyN':
					return this.toggleSnap();
				case 'KeyL':
					return this.toggleSpace();
				case 'KeyO':
					return this.openFiles('auto');
				case 'KeyT':
					return this.openTextures();
				case 'KeyE':
					if (!mod) {
						this.setWorkspace(this.workspace === 'fx' ? 'edit' : 'fx');
						return;
					}
					break;
				case 'Space':
					if (this.workspace === 'fx') {
						e.preventDefault();
						this.effectsEngine.toggle().catch(() => {});
						return;
					}
					break;
				case 'KeyU':
					return this.openUrl();
				case 'KeyH':
					if (app.model.selected) app.ops.setVisible(app.model.selected, !app.model.selected.visible);
					return;
				case 'KeyX':
				case 'Delete':
				case 'Backspace':
					e.preventDefault();
					return app.ops.deleteSelected();
				case 'KeyD':
					if (e.shiftKey) {
						e.preventDefault();
						app.ops.duplicateSelected();
					}
					return;
				case 'KeyZ': {
					if (e.shiftKey) {
						app.settings.overlays.wire = !app.settings.overlays.wire;
						app.display.apply();
						app.saveSettings();
						return;
					}
					const i = modeKeys.indexOf(app.settings.display);
					app.setDisplay(modeKeys[(i + 1) % modeKeys.length]);
					return;
				}
				case 'Tab':
					// Tab сворачивает панель только когда фокус не на элементе управления (иначе ломаем навигацию с клавиатуры)
					if (document.activeElement && document.activeElement !== document.body) return;
					e.preventDefault();
					return this.toggleSidebar();
				case 'Escape':
					if (this.workspace === 'fx') {
						this.setWorkspace('edit');
						return;
					}
					if (this.exportPop && !this.exportPop.hidden) {
						this.toggleExportPop(false);
						return;
					}
					this.closeOverlayPop && this.closeOverlayPop();
					if (app.model.selected) app.model.select(null);
					return;
				case 'F1':
					e.preventDefault();
					return this.showHelp();
				default:
			}
			if (e.key === '?' || (e.shiftKey && code === 'Slash')) {
				e.preventDefault();
				return this.showHelp();
			}
			const dm = /^Digit([1-6])$/.exec(code);
			if (dm) app.setDisplay(modeKeys[parseInt(dm[1], 10) - 1]);
		});
	}
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Собирает файлы из drop, включая содержимое папок */
async function collectDropped(dt) {
	const out = [];
	const items = dt.items ? [...dt.items] : [];
	const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
	if (entries.length && entries.every(Boolean)) {
		const readEntry = (entry) =>
			new Promise((resolve) => {
				if (entry.isFile) entry.file((f) => resolve([f]), () => resolve([]));
				else if (entry.isDirectory) {
					const reader = entry.createReader();
					const all = [];
					const readBatch = () =>
						reader.readEntries(async (batch) => {
							if (!batch.length) {
								const nested = await Promise.all(all.map(readEntry));
								resolve(nested.flat());
							} else {
								all.push(...batch);
								readBatch();
							}
						}, () => resolve([]));
					readBatch();
				} else resolve([]);
			});
		for (const e of entries) out.push(...(await readEntry(e)));
		return out.filter((f) => !f.name.startsWith('.'));
	}
	return [...dt.files];
}
