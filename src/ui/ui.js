// Оболочка интерфейса: шапка, панель инструментов, оверлеи вьюпорта, вкладки, подсказки, тосты,
// перетаскивание файлов, горячие клавиши, справка.
import * as THREE from 'three';
import { h, $, $$, extOf, formatInt, downloadBlob, placeAbove } from '../core/util.js';
import { icon, hydrateIcons, iconsReady } from './icons.js';
import { initFloatingPanels } from '../effects/ui/fx-float.js';
import { segmented, switchRow, button } from './ui-kit.js';
import { AxisGizmo } from '../scene/gizmo.js';
import { createScenePanel } from './panels/scene.js';
import { createAnimBar } from './panels/anim.js';
import { initMobile } from './mobile.js';
import { createMaterialPanel } from './panels/material.js';
import { createViewPanel, DISPLAY_MODES } from './panels/view.js';
import { createExportPanel } from './panels/export.js';
import { createPointsPanel } from './panels/points.js';
import { createMediaPanel } from './panels/media.js';
import { createMediaBar } from './media-bar.js';
import { EffectsEngine } from '../effects/engine.js';
import { createEffectsPanel, makeModelProvider } from '../effects/ui/panel-effects.js';
import { importFiles, assignTextureFiles, ACCEPT_ALL, MODEL_FORMATS, IMAGE_EXT } from '../io/importers.js';
import { BACKGROUNDS } from '../scene/viewport.js';

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
		iconsReady.then(() => initFloatingPanels());
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
		app.bus.on('fx', () => {
			this.refreshHistory();
			if (this.workspace === 'fx') this.updateStatus();
		});
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
		$$('#modeSwitch [data-ws]').forEach((b) => b.addEventListener('click', () => this.setWorkspace(b.dataset.ws)));
		// подсветка выбранного режима переезжает от одной кнопки к другой, а не включается на месте
		this.moveModeIndicator = () => {
			const sw = $('#modeSwitch');
			const sel = sw.querySelector('[aria-selected="true"]');
			if (!sel) return;
			sw.style.setProperty('--ix', sel.offsetLeft + 'px');
			sw.style.setProperty('--iw', sel.offsetWidth + 'px');
		};
		this.moveModeIndicator();
		window.addEventListener('resize', () => this.moveModeIndicator());
		document.fonts && document.fonts.ready.then(() => this.moveModeIndicator());
		// подпись кнопки меняет ширину при переводе страницы: подсветка режима пересчитывается по размеру самих кнопок
		if (window.ResizeObserver) {
			const ro = new ResizeObserver(() => this.moveModeIndicator());
			ro.observe($('#modeSwitch'));
			$('#modeSwitch').querySelectorAll('button').forEach((b) => ro.observe(b));
		}
		window.addEventListener('langchange', () => requestAnimationFrame(() => this.moveModeIndicator()));
		$('#btnEmptyOpen').addEventListener('click', () => this.openFiles('auto'));
		$('#btnEmptyDemo').addEventListener('click', () => app.loadDemo());
		$('#btnEmptyChar').addEventListener('click', () => app.loadDemoCharacter());
		$('#btnUndo').addEventListener('click', () => this.undo());
		$('#btnRedo').addEventListener('click', () => this.redo());
		$('#btnHelp').addEventListener('click', () => this.showHelp());
		// «Поддержать автора»: плашка под кнопкой в шапке, закрывается кликом снаружи и Esc
		{
			const btn = $('#btnSupport');
			const pop = $('#supportPop');
			const close = () => {
				pop.hidden = true;
				btn.setAttribute('aria-expanded', 'false');
			};
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				pop.hidden = !pop.hidden;
				btn.setAttribute('aria-expanded', String(!pop.hidden));
				if (!pop.hidden) {
					// отступ от шапки такой же, как у боковых панелей, и тот же правый край
					const hb = document.querySelector('header.topbar, .topbar');
					const bottom = hb ? hb.getBoundingClientRect().bottom : btn.getBoundingClientRect().bottom;
					pop.style.top = Math.round(bottom + 12) + 'px';
					pop.style.right = '12px';
				}
			});
			document.addEventListener('pointerdown', (e) => {
				if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close();
			});
			window.addEventListener('keydown', (e) => e.key === 'Escape' && !pop.hidden && close());
		}
		$('#btnExport').addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggleExportPop();
		});
		document.documentElement.setAttribute('data-theme', 'dark');

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

	/** Подпись кнопки в шапке теперь всегда «Экспорт»: что именно скачивать, выбирается в окне настроек */
	setExportLabel() {}

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
		this.exportPop = pop;
		$('#btnExportClose').addEventListener('click', () => this.toggleExportPop(false));
		document.addEventListener('pointerdown', (e) => {
			if (!pop.hidden && e.target === pop) this.toggleExportPop(false);
		});
	}

	toggleExportPop(force) {
		const pop = this.exportPop;
		const open = force !== undefined ? force : pop.hidden;
		const wasOpen = !pop.hidden;
		pop.hidden = !open;
		// пока открыт экспорт, всё, что играло на фоне (анимация модели, таймлайн эффектов, видео), стоит на паузе; при выходе продолжает с того же места
		if (open && !wasOpen) this.holdPlayback('export');
		else if (!open && wasOpen) this.releasePlayback('export');
		$('#btnExport').setAttribute('aria-expanded', String(open));
	}

	/** Пауза фона: анимация модели, таймлайн и видео стоят, эффекты и звук заморожены, пока есть хоть одна причина (экспорт, справка) */
	holdPlayback(reason) {
		const holds = this._holds || (this._holds = new Set());
		if (holds.has(reason)) return;
		const first = holds.size === 0;
		holds.add(reason);
		if (!first) return;
		const app = this.app;
		const eng = this.effectsEngine;
		const pm = app.media.pm;
		this._expPaused = { anim: app.anim.playing, fx: !!eng.animPlaying && !eng.animRec, media: !!pm.playing && !pm.recording };
		if (this._expPaused.anim) app.anim.pause();
		if (this._expPaused.fx) eng.animPause();
		if (this._expPaused.media) pm.pause();
		eng.setFrozen(true);
	}

	releasePlayback(reason) {
		const holds = this._holds;
		if (!holds || !holds.delete(reason) || holds.size > 0 || !this._expPaused) return;
		const was = this._expPaused;
		this._expPaused = null;
		this.effectsEngine.setFrozen(false);
		if (was.anim) this.app.anim.play();
		if (was.fx) this.effectsEngine.animPlay();
		if (was.media) this.app.media.pm.play();
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
		// режим «Облако точек из вершин» из панели убран: для точек есть вкладка «Точки» и режим «Эффекты»
		this.modeBar = segmented({ options: DISPLAY_MODES.filter((m) => m.value !== 'points'), value: s.display, label: 'Режим отображения', onChange: (v) => app.setDisplay(v) });
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
		pop.append(h('div', { class: 'fx-bg-title' }, 'Подсказки на сцене'));
		for (const [key, label, hint] of rows) {
			const r = switchRow(label, { value: s.overlays[key], onChange: (v) => {
				s.overlays[key] = v;
				app.display.apply();
				app.viewport.updateSelectionBox();
				app.saveSettings();
			} }, hint);
			(this._ovRows ||= {})[key] = r;
			pop.append(r.el);
		}
		app.bus.on('view', () => {
			for (const k of Object.keys(this._ovRows)) this._ovRows[k].set(s.overlays[k]);
		});
		const close = () => {
			pop.hidden = true;
			btn.setAttribute('aria-expanded', 'false');
		};
		// меню живёт в самой сцене, а не в нижней панели: у панели своё размытие, и вложенное не видит сцену
		$('#viewport').append(pop);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			pop.hidden = !pop.hidden;
			if (!pop.hidden) placeAbove(pop, btn, $('#viewport'), 'right');
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
		$('#btnOrtho').setAttribute('aria-pressed', String(app.nav.ortho));
		$('#btnOrtho').dataset.tip = app.nav.ortho ? 'Сейчас: ортогональная. Включить перспективу (5)' : 'Сейчас: перспектива. Включить ортогональную (5)';
	}

	// --------------------------------------------------------- боковая панель
	/** После отмены настроек панели собираются заново и показывают восстановленные значения */
	rebuildSettingsPanels() {
		const app = this.app;
		for (const [name, make, prop] of [['view', createViewPanel, 'viewPanel'], ['points', createPointsPanel, 'pointsPanel'], ['media', createMediaPanel, 'mediaPanel']]) {
			this.tabs[name].replaceChildren();
			this[prop] = make(app, this.tabs[name]);
		}
	}

	buildSidebar() {
		const app = this.app;
		for (const name of ['scene', 'material', 'points', 'media', 'view']) this.tabs[name] = $(`#panel-${name}`);
		$$('.tab').forEach((t) => t.addEventListener('click', () => this.showTab(t.dataset.tab)));
		this.scenePanel = createScenePanel(app, this.tabs.scene);
		// полоса анимации над сценой: видна, только если в файле есть клипы
		this.animBar = createAnimBar(app, $('#viewport'));
		this.materialPanel = createMaterialPanel(app, this.tabs.material);
		this.viewPanel = createViewPanel(app, this.tabs.view);
		this.pointsPanel = createPointsPanel(app, this.tabs.points);
		this.mediaPanel = createMediaPanel(app, this.tabs.media);
		this.mediaBar = createMediaBar(app, $('#viewport'));
		// вкладка «Медиа» появляется только когда открыто фото или видео
		const mediaTab = $('.tab[data-tab="media"]');
		app.bus.on('media', () => {
			const has = app.media.present;
			mediaTab.hidden = !has;
			if (has && mediaTab.parentElement.firstElementChild !== mediaTab) mediaTab.parentElement.prepend(mediaTab);
			if (!has && !this.tabs.media.hidden) this.showTab('scene');
		});
		this.exportPanel = createExportPanel(app, $('#panel-export'));
		this.effectsEngine.modelProvider = makeModelProvider(app);
		this.effectsPanel = createEffectsPanel(app, $('#panel-effects'), this.effectsEngine);
		this.buildExportPop();
		this.makeSidebarResizable();
		initMobile(app);
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
				window.dispatchEvent(new Event('resize'));
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
		if (ws !== 'edit') this.app.pointEdit && this.app.pointEdit.setActive(false);
		const fxPanel = $('#panel-effects');
		const vpEl = $('#viewport');
		vpEl.classList.add('ws-out'); // сцена плавно гаснет на время переключения
		// даём гашению начаться: тяжёлая работа ниже блокирует страницу, а затухание идёт на видеокарте и дойдёт до конца, не выглядя подвисанием
		await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 130)));
		if (ws === 'fx') {
			this.prevTab = $$('.tab').find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.tab || 'scene';
			this.closeOverlayPop && this.closeOverlayPop();
			this.toggleExportPop(false);
			try {
				await this.effectsEngine.enter();
			} catch (e) {
				this.toast('Не удалось запустить эффекты: ' + (e.message || e), 'error');
				vpEl.classList.remove('ws-out');
				return;
			}
			this.workspace = 'fx';
			setTimeout(() => {
				this.refreshHistory();
				this.updateStatus();
			}, 700);
			for (const el of Object.values(this.tabs)) el.hidden = true;
			fxPanel.hidden = false;
			if ($('.workspace').classList.contains('sidebar-hidden') && !window.matchMedia('(max-width: 900px)').matches) this.toggleSidebar(false);
		} else {
			this.workspace = 'edit';
			this.refreshHistory();
			this.updateStatus();
			this.effectsEngine.exit();
			fxPanel.hidden = true;
			this.showTab(this.prevTab || 'scene');
		}
		$$('#modeSwitch [data-ws]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ws === this.workspace)));
		this.moveModeIndicator && this.moveModeIndicator();
		setTimeout(() => this.app.viewport.resize(), 60);
		setTimeout(() => vpEl.classList.remove('ws-out'), 160);
	}

	makeSidebarResizable() {
		// настройки не уже 280 px: это шире левой панели эффектов (252 px), чтобы поля и подписи не сжимались
		const SIDEBAR_MIN = 280;
		const resizer = $('#sidebarResizer');
		const sidebar = $('#sidebar');
		const ws = $('.workspace');
		if (!resizer || !sidebar || !ws) return;

		try {
			const saved = localStorage.getItem('objglb.sidebar-w');
			if (saved) {
				const w = parseInt(saved, 10);
				if (w >= SIDEBAR_MIN && w <= 420) {
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
			const minW = SIDEBAR_MIN;
			// не шире 420 px и не больше 38% окна: панель не должна занимать пол-экрана
			const maxW = Math.max(minW, Math.min(420, Math.floor((window.innerWidth / z) * 0.38)));
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
		} else if (tool === 'psel') {
			html = `${k('ЛКМ')} выделять &nbsp; ${k('Ctrl')}+${k('ЛКМ')} снимать &nbsp; ${k('Alt')}+${k('ЛКМ')} вращать &nbsp; ${k('Delete')} удалить &nbsp; ${k('Esc')} выход`;
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
		if (this.workspace === 'fx') {
			// в эффектах важно другое: сколько точек рисуется и сколько эффектов включено (список слева это уже не повторяет)
			const eng = this.effectsEngine;
			const pts = eng.geometry?.attributes?.aIdx?.count || 0;
			const on = Object.values(eng.state.layers).filter((l) => l && l.on).length;
			if (pts) parts.push(`Точек <b>${formatInt(pts)}</b>`);
			parts.push(`Эффектов включено <b>${on}</b>`);
			el.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
			return;
		}
		if (st.verts) parts.push(`Вершин <b>${formatInt(st.verts)}</b>`, `Треугольников <b>${formatInt(st.tris)}</b>`);
		if (st.points) parts.push(`Точек <b>${formatInt(st.points)}</b>`);
		parts.push(`Материалов <b>${st.materials}</b>`, `Текстур <b>${st.textures}</b>`);
		el.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
	}

	refreshScene() {
		const app = this.app;
		const top = app.viewport.root.children.filter((c) => !c.userData.helper);
		const es = $('#emptyState');
		// стартовая карточка уходит плавно и только когда модель начала проявляться: раньше она пропадала сразу, а модель ещё готовилась, и экран на миг оставался пустым
		const gone = top.length > 0 && !this._importing;
		if (!gone) {
			clearTimeout(this._esT);
			es.hidden = false;
			es.classList.remove('is-leaving');
		} else if (!es.hidden && !es.classList.contains('is-leaving')) {
			es.classList.add('is-leaving');
			this._esT = setTimeout(() => {
				if (this.app.viewport.root.children.some((c) => !c.userData.helper) && !this._importing) es.hidden = true;
				es.classList.remove('is-leaving');
			}, 360);
		}
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
			// горячая клавиша в скобках в конце подсказки показывается отдельной плашкой
			tip.textContent = '';
			const m = text.match(/^(.*?)\s*\(([^()]{1,18})\)\s*$/);
			const looksKey = m && /^(Ctrl|Cmd|Shift|Alt|Esc|Home|Пробел|Space|Enter|Tab|[A-Za-zА-Яа-я0-9?]\b)/.test(m[2]);
			if (looksKey) {
				tip.append(h('span', { class: 'tip-text' }, m[1]), ...m[2].split('+').map((k) => h('kbd', { class: 'tip-key' }, k.trim())));
			} else tip.append(h('span', { class: 'tip-text' }, text));
			tip.hidden = false;
			const z = uiZoom();
			const br = el.getBoundingClientRect();
			const r = { left: br.left / z, right: br.right / z, top: br.top / z, bottom: br.bottom / z, width: br.width / z, height: br.height / z };
			const pos = el.dataset.tipPos || 'bottom';
			const tw = tip.offsetWidth;
			const th = tip.offsetHeight;
			// везде один и тот же зазор от элемента до подсказки, положение по целым пикселям
			const GAP = 10;
			const EDGE = 12;
			// отступ считается от края панели, в которой лежит элемент (а не от самого элемента), поэтому подсказка никогда не налезает на рамку панели и зазор везде один
			const sr = (sel) => {
				const sf = el.closest(sel);
				if (!sf) return r;
				const b2 = sf.getBoundingClientRect();
				return { left: b2.left / z, right: b2.right / z, top: b2.top / z, bottom: b2.bottom / z };
			};
			let x, y;
			if (pos === 'right') {
				x = sr('.fx-left, .sidebar, .toolrail').right + GAP;
				y = r.top + (r.height - th) / 2;
			} else if (pos === 'left') {
				x = sr('.fx-left, .sidebar, .toolrail').left - tw - GAP;
				y = r.top + (r.height - th) / 2;
			} else {
				const bar = sr('.topbar, .fx-bar, .vp-dock, .media-bar, .statusbar, .fx-anim');
				x = r.left + (r.width - tw) / 2;
				y = bar.bottom + GAP;
				if (y + th > window.innerHeight / z - EDGE) y = bar.top - th - GAP;
			}
			x = Math.round(Math.max(EDGE, Math.min(window.innerWidth / z - tw - EDGE, x)));
			y = Math.round(Math.max(EDGE, y));
			tip.style.left = x + 'px';
			tip.style.top = y + 'px';
			requestAnimationFrame(() => tip.classList.add('is-on'));
		};
		document.addEventListener('pointerover', (e) => {
			const el = e.target.closest && e.target.closest('[data-tip]');
			if (!el || el === current) return;
			// в редакторе подсказки только у кнопок без текста: там, где подпись видна, подсказка лишняя
			const iconOnly = el.matches('.btn-tool, .dock-btn, .btn-icon, .sw, .shape-tile');
			if (this.workspace !== 'fx' && !iconOnly && (el.textContent || '').trim().length > 0) return;
			hide();
			current = el;
			timer = setTimeout(() => show(el), Number(el.dataset.tipDelay) || (this.workspace === 'fx' ? 450 : 750));
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
		clearTimeout(this.busyHide);
		if (!box.hidden) {
			box.classList.add('is-on');
			return;
		}
		if (this.busyTimer) return;
		// окно загрузки показывается, только если работа идёт заметно долго, и появляется плавно: короткая загрузка не мигает экраном
		this.busyTimer = setTimeout(() => {
			this.busyTimer = null;
			box.hidden = false;
			requestAnimationFrame(() => box.classList.add('is-on'));
		}, 420);
	}
	idle() {
		clearTimeout(this.busyTimer);
		this.busyTimer = null;
		const box = $('#busy');
		if (box.hidden) return;
		box.classList.remove('is-on');
		clearTimeout(this.busyHide);
		this.busyHide = setTimeout(() => {
			if (!box.classList.contains('is-on')) box.hidden = true;
		}, 260);
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
			this.releasePlayback('help');
			dlg.onclose = () => resolve(null);
			dlg.showModal();
		});
	}

	showHelp() {
		// клавиши рисуются отдельными «кнопками»: «Ctrl+Shift+Z» это три клавиши; несколько вариантов через «/»
		const combo = (s) => h('span', { class: 'kd-combo' }, ...s.split(/\+(?=.)/).flatMap((k, i) => (i ? [h('i', {}, '+'), h('kbd', {}, k)] : [h('kbd', {}, k)])));
		const row = (label, ...variants) => h('div', { class: 'kd-row' }, h('span', { class: 'kd-label' }, label), h('span', { class: 'kd-keys' }, ...variants.flatMap((v, i) => (i ? [h('em', {}, 'или'), combo(v)] : [combo(v)]))));
		const group = (title, icn, ...rows) => h('section', { class: 'kd-group' + (title === 'Таймлайн анимации' ? ' kd-wide' : '') }, h('h3', {}, h('span', { class: 'kd-ic', html: icon(icn, 15) }), title), ...rows);
		const dlg = this.dialog;
		dlg.textContent = '';
		const xBtn = h('button', { type: 'button', class: 'kd-x btn btn-icon', 'aria-label': 'Закрыть', 'data-tip': 'Закрыть (Esc)', onclick: () => dlg.close(), html: icon('x', 18) });
		dlg.onclick = (e) => {
			if (e.target === dlg) dlg.close();
		};
		dlg.append(
			h('div', { class: 'dlg-inner kd-inner' },
				h('header', { class: 'kd-head' }, h('h2', {}, 'Горячие клавиши'), xBtn),
				h('div', { class: 'kd-grid' },
					group('Просмотр', 'cube',
						row('Вращать', 'ЛКМ', 'СКМ'),
						row('Сдвинуть', 'ПКМ'),
						row('Приблизить', 'Колесо'),
						row('Центр на точке', 'Двойной клик'),
						row('Показать всё', 'Home'),
						row('Показать выбранное', 'F'),
						row('Проекция', 'P', 'Num 5'),
						row('Спереди, сзади', 'Num 1'),
						row('Справа, слева', 'Num 3'),
						row('Сверху, снизу', 'Num 7'),
						row('Виды без Numpad', 'Alt+1 3 7')
					),
					group('Правка', 'arrows-out-cardinal',
						row('Выбор', 'Q'),
						row('Переместить', 'G'),
						row('Вращение', 'R'),
						row('Масштаб', 'S'),
						row('Привязка к шагу', 'N'),
						row('Оси: мир / локальные', 'L'),
						row('Дублировать', 'Shift+D'),
						row('Удалить', 'X', 'Delete'),
						row('Скрыть / показать', 'H'),
						row('Отменить', 'Ctrl+Z'),
						row('Повторить', 'Ctrl+Shift+Z')
					),
					group('Общее', 'sliders-horizontal',
						row('Открыть файл', 'O'),
						row('Экспорт', 'Ctrl+E / Ctrl+S'),
						row('Вставить файл', 'Ctrl+V'),
						row('Режим «Эффекты»', 'E'),
						row('Режимы отображения', '1 … 6'),
						row('Следующий режим', 'Z'),
						row('Каркас поверх', 'Shift+Z'),
						row('Масштаб интерфейса', 'Ctrl++', 'Ctrl+−'),
						row('Сбросить масштаб', 'Ctrl+0'),
						row('Пуск / пауза', 'Пробел')
					),
					group('Таймлайн анимации', 'film-strip',
						row('Играть, пауза', 'Пробел'),
						row('Сдвинуть курсор', '←', '→'),
						row('Курсор на секунду', 'Shift+← →'),
						row('К краю соседнего блока', ',', '.'),
						row('В начало, в конец', 'Home', 'End'),
						row('Записать ракурс камеры', 'C'),
						row('Разрезать блок', 'S'),
						row('Дублировать блок', 'Ctrl+D'),
						row('Копировать, вставить', 'Ctrl+C', 'Ctrl+V'),
						row('Выбрать все блоки', 'Ctrl+A'),
						row('Добавить к выбору', 'Shift+клик'),
						row('Выбрать рамкой', 'Shift+протяжка'),
						row('Сдвинуть блок на 0,1 с', 'Alt+← →'),
						row('Рабочая область', 'I', 'O', 'X'),
						row('Удалить блок', 'Delete'),
						row('Без прилипания', 'Alt+протяжка'),
						row('Масштаб шкалы', 'Ctrl+колесо'),
						row('Меню блока и дорожки', 'ПКМ')
					)
				)
			)
		);
		this.holdPlayback('help');
		dlg.onclose = () => {
			dlg.onclick = null;
			this.releasePlayback('help');
		};
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
			this._importing = true;
			const before = new Set(app.viewport.root.children);
			// новые объекты сразу прячем: иначе модель мелькает целиком, исчезает и только потом плавно появляется (выглядит как двойной запуск)
			app.model.holdNew = [];
			let r;
			try {
				r = await importFiles(app, files, { mode: useMode });
			} catch (e) {
				for (const o of app.model.holdNew || []) o.visible = true;
				app.model.holdNew = null;
				throw e;
			}
			// шейдеры и текстуры готовим заранее, пока окно загрузки ещё закрывает сцену: иначе первый кадр с моделью подвисает
			const held = app.model.holdNew || [];
			app.model.holdNew = null;
			const fresh = app.viewport.root.children.filter((c) => !before.has(c) && !c.userData.helper);
			// объекты возвращаются в сцену полностью прозрачными, прогреваются шейдеры, и только потом идёт проявление
			this.fadePrepare(fresh);
			for (const o of held) o.visible = true;
			await this.warmUp();
			this.idle();
			this._importing = false;
			this.refreshScene();
			this.reportImport(r);
			this.revealObjects(fresh);
		} catch (e) {
			this._importing = false;
			this.refreshScene();
			this.idle();
			console.error(e);
			this.toast('Не удалось загрузить: ' + (e.message || e), 'error');
		}
	}

	/** Заранее компилирует шейдеры и загружает текстуры на видеокарту */
	async warmUp() {
		const vp = this.app.viewport;
		try {
			if (vp.renderer.compileAsync) await vp.renderer.compileAsync(vp.scene, vp.camera);
			else vp.renderer.compile(vp.scene, vp.camera);
		} catch (e) {
			/* предварительная подготовка не обязательна */
		}
	}

	/** Новые объекты плавно проявляются: прозрачность от нуля и лёгкий рост, вместо резкого появления */
	fadePrepare(objs) {
		if (!objs.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		for (const o of objs) {
			o.traverse((n) => {
				if (!(n.isMesh || n.isPoints || n.isLine) || n.userData.helper) return;
				for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
					if (!m) continue;
					if (!m.userData._fade) m.userData._fade = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
					m.transparent = true;
					m.depthWrite = false;
					m.opacity = 0;
					m.needsUpdate = true;
				}
			});
		}
	}

	revealObjects(objs) {
		if (!objs.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const vp = this.app.viewport;
		const saved = new Map();
		const mats = () => {
			const list = [];
			for (const o of objs) {
				o.traverse((n) => {
					if (!(n.isMesh || n.isPoints || n.isLine) || n.userData.helper) return;
					for (const m of Array.isArray(n.material) ? n.material : [n.material]) if (m) list.push(m);
				});
			}
			return list;
		};
		const startScale = new Map(objs.map((o) => [o, o.scale.clone()]));
		const t0 = performance.now();
		const dur = 620;
		const ease = (t) => 1 - Math.pow(1 - t, 3);
		const step = (now) => {
			const t = Math.min(1, (now - t0) / dur);
			const e = ease(t);
			for (const m of mats()) {
				if (!saved.has(m)) saved.set(m, m.userData._fade || { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });
				const o = saved.get(m);
				m.transparent = true;
				m.depthWrite = t >= 1 ? o.depthWrite : false;
				m.opacity = o.opacity * e;
				m.needsUpdate = t === 0 || t >= 1;
			}
			for (const [o, s0] of startScale) o.scale.copy(s0).multiplyScalar(0.94 + 0.06 * e);
			if (t >= 1) {
				for (const [m, o] of saved) {
					m.opacity = o.opacity;
					m.transparent = o.transparent;
					m.depthWrite = o.depthWrite;
					m.needsUpdate = true;
					delete m.userData._fade;
				}
			}
			vp.invalidate();
			if (t < 1) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	}

	reportImport(r) {
		const app = this.app;
		if (r.models.length) {
			app.nav.frameAll(true);
			// персонаж с анимацией: камера охватывает всё его движение, а не позу привязки
			if (app.anim.has) {
				const ab = app.anim.animatedBounds();
				if (!ab.isEmpty()) app.nav.frameBox(ab, true, true);
			}
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
		const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || !!t.closest?.('.custom-select-wrap, .custom-select-pop, .select'));
		const modeKeys = DISPLAY_MODES.map((m) => m.value);
		// Пробел всегда запускает и останавливает воспроизведение: кнопка или ползунок, на которых остался фокус, его не перехватывают
		window.addEventListener(
			'keydown',
			(e) => {
				if (e.code !== 'Space' || this.dialog.open || e.ctrlKey || e.metaKey || e.altKey) return;
				const t = e.target;
				const textual = t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type)) || !!t.closest?.('.custom-select-wrap, .custom-select-pop, .select'));
				if (textual) return;
				const fx = this.workspace === 'fx';
				const animOn = $('#app').classList.contains('fx-anim-active');
				const bar = this.mediaBar;
				const videoOn = bar && !bar.el.hidden;
				if (!(videoOn || fx)) return;
				if (t && t !== document.body && t.blur) t.blur();
				e.preventDefault();
				e.stopImmediatePropagation();
				const eng = this.effectsEngine;
				if (fx && animOn) {
					if (eng.animPlaying) eng.animPause();
					else if (!eng.animPlay()) this.toast('Добавьте минимум один блок эффекта или два ключа камеры', 'info');
				} else if (videoOn) bar.toggle();
				else eng.toggle().catch(() => {});
			},
			true
		);
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
			// Ctrl+S: вместо «Сохранить страницу» браузера открывается экспорт
			if (mod && (code === 'KeyE' || code === 'KeyS')) {
				e.preventDefault();
				this.toggleExportPop();
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
				case 'KeyB':
					return app.pointEdit.setTool('brush');
				case 'KeyM':
					return app.pointEdit.setTool('rect');
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
				case 'KeyE':
					if (!mod) {
						this.setWorkspace(this.workspace === 'fx' ? 'edit' : 'fx');
						return;
					}
					break;
				case 'Space':
					// при открытом секвенсоре пробел запускает таймлайн, звук отдельно не переключаем
					if (this.workspace === 'fx' && !$('#app').classList.contains('fx-anim-active')) {
						e.preventDefault();
						this.effectsEngine.toggle().catch(() => {});
						return;
					}
					break;
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
				case 'Escape':
					if (this.workspace === 'fx' && this.exitFxFocus && document.getElementById('app').classList.contains('fx-focus')) {
						// режим «только сцена»: Esc возвращает интерфейс, а не выходит из эффектов
						this.exitFxFocus();
						return;
					}
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
