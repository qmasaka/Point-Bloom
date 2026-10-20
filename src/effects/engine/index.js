/**
 * Движок эффектов для облака точек. Идея взята из TouchDesigner (POP): цепочка независимых «операторов»
 * (шум, спектр, волны, скручивание, пульс, воксели, дрожь, курсор), каждый из которых можно включить,
 * настроить и привязать к полосе звука (бас, середина, верх, бит). Вся геометрия считается на видеокарте.
 */
import * as THREE from 'three';
import { perf } from '../../core/perf.js';
import { loadJSON, mergeDeep, saveJSON } from '../../core/util.js';
import { DepthAI } from '../input/depth-ai.js';
import { createBackend, pickBackendKind } from '../render/select.js';
import { defaultState, KEY } from '../state/defaults.js';
import { FX_LAYERS } from '../state/layers.js';
import { AUDIO_DEF } from '../state/options.js';
import { TrackerHud } from '../ui/fx-hud.js';
import { FramesPart } from './frames.js';
import { KeyframesPart } from './keyframes.js';
import { SourcePart } from './source.js';
import { BuildPart } from '../render/webgl/scene-build.js';
import { LinksPart } from './links.js';
import { ToolsPart } from './tools.js';
import { TrackingPart } from './tracking.js';
import { HistoryPart } from './history.js';
import { ScopeTrailPart } from './scope-trail.js';
import { ShaderCachePart } from '../render/webgl/shader-cache.js';
import { DepthPart } from './depth.js';
import { AudioPart } from './audio.js';
import { InteractionPart } from './interaction.js';
import { LoopPart } from './loop.js';
import { RecordingPart } from './recording.js';
import { ScreenPart } from './screen.js';
import { SlitPart } from './slitscan.js';
import { ChladniPart } from './chladni.js';
import { ShadowPart } from './shadow.js';
import { PixelSortPart } from './pixelsort.js';
import { mixin } from './mixin.js';

export class EffectsEngine {
	constructor(app) {
		this.app = app;
		this.active = false;
		this.state = mergeDeep(defaultState(), loadJSON(KEY, {}));
		// «Живая сцена без звука» по умолчанию выключена; у тех, кто её не трогал сам, прежнее сохранённое «включено» сбрасываем
		if (!this.state.audio.idleSet) this.state.audio.idle = false;
		this.state.mask = { ...defaultState().mask }; // зона действия убрана из интерфейса: эффекты всегда работают на всей форме
		for (const l of FX_LAYERS) this.state.layers[l.id] = { ...AUDIO_DEF, ...l.def, ...this.state.layers[l.id] };
		// старое «Течение» стало видом эффекта «Вихри и течение»: включённый слой переезжает
		{
			const fl = this.state.layers.flow;
			const cl = this.state.layers.curl;
			if (fl && cl && fl.on && !cl.on && !this.state._m6) {
				Object.assign(cl, { on: true, mode: 'surface', amount: fl.amount, fscale: fl.scale, fdir: fl.dir, speed: fl.speed, band: fl.band, react: fl.react });
				fl.on = false;
			}
			this.state._m6 = true;
		}
		this.state.look = { ...defaultState().look, ...this.state.look };
		// у срезов, сохранённых раньше, линии теперь по умолчанию естественного цвета модели
		if (this.state.layers.brush && this.state.layers.brush.radius > 0.3 && !this.state._m5) {
			this.state.layers.brush.radius = 0.14;
			this.state.layers.brush.dry = 3;
		}
		this.state._m5 = 1;
		if (!this.state._m4) {
			if (this.state.layers.slice) this.state.layers.slice.color = 'model';
			this.state._m4 = 1;
		}
		if (this.state.look.colorBy === 'height' || this.state.look.colorBy === 'index') this.state.look.colorBy = 'disp';

		// звук
		this.ctx = null;
		this.analyser = null;
		this.bus = null;
		this.out = null;
		this.recDest = null;
		this.freqData = null;
		this.synth = null;
		this.source = null;
		this.micStream = null;
		this.audioBuffer = null;
		this.playing = false;
		this.sourceType = 'synth';
		this.audioName = '';
		this.levels = { bass: 0, mid: 0, high: 0, beat: 0 };
		this.spec = new Float32Array(64);
		this._beatHist = new Float32Array(48);
		this._beatIdx = 0;
		this._lastBeat = 0;

		// сцена
		this.points = null;
		this.geometry = null;
		this.material = null;
		this.specTex = null;
		this.cache = new Map();
		this.cloudKey = null;
		this.morph = 1;
		this.morphing = false;
		this.mouse = new THREE.Vector3();
		this.mouseOn = false;
		this._time = 0;
		this._raf = null;
		this._lastT = 0;
		this.recording = false;
		this.modelProvider = null; // { available(), kind(), total(), get(n) }
		this.pm = app.media.pm;
		// карта глубины для фото и видео: нейросеть работает в отдельном потоке, результат переносится на сетку точек
		this.depthAI = new DepthAI();
		this._dListeners = new Set();
		this.depthAI.onChange = () => this._depthEmit();
		this._D = { key: null, map: null, mapSrc: '', aiHas: false, st: {}, tgt: null, geo: null, dirty: false, snap: false, moving: false, busy: false, rgb: null, rgbN: 0, lumaN: -1, reqT: -1e9, force: false, err: '', n: 0 };
		app.bus.on('settings', () => this._histSoon());
		// как только в сцене что-то появилось, в паузу готовим шейдеры эффектов
		app.bus.on('scene', () => {
			clearTimeout(this._warmT);
			if (!this.active) this.cache.clear();
			this._warmT = setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(f, 60)))(() => this.prewarm()), 1200);
		});
		// новая текстура, цвет материала или правка сетки в редакторе: готовое облако устарело, при входе в «Эффекты» оно соберётся заново с новыми цветами
		const stale = () => {
			if (this.active) return;
			this.cache.clear();
			clearTimeout(this._warmT);
			this._warmT = setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(f, 60)))(() => this.prewarm()), 900);
		};
		app.bus.on('material', stale);
		app.bus.on('geometry', stale);
		app.bus.on('pointtex', stale);
		app.bus.on('pointtex', () => {
			if (this.active) {
				this.cache.clear();
				this._onScene();
			}
		});
		this.mediaProgress = null;
		this.ghosts = [];
		this.linkObj = null;
		this.shocks = [];
		this.onFrame = null;
		this._ray = new THREE.Raycaster();
		this._plane = new THREE.Plane();
		this._move = (e) => this._onMove(e);
		this._leave = () => (this.mouseOn = false);
		this._dn = (e) => this._onDown(e);
		this._up = (e) => this._onUp(e);
		this.isCollapsed = false;
		this.collapseProgress = 0;
		this.asm = 0;
		this.collapseTime = 0;
		this.animT = 0;
		this.animPlaying = false;
		this.animRec = false;
		this.brushHits = [];
		this.backend = null; // рендер-движок (WebGL сейчас): создаётся при входе в режим
		this.camTracker = null;
		this._pointerDown = false;
	}

	toggleCollapse() {
		this.setCollapse(!this.isCollapsed);
	}

	setCollapse(v) {
		if (this.isCollapsed === v) return;
		this.isCollapsed = v;
		if (v) this.state.layers.physics.on = true;
		this.emit();
	}

	// ------------------------------------------------------------ вид точек, общий с редактором
	/** Режим цвета «Модель, Один цвет, Нормали, Высота» хранится в настройках вкладки «Точки»: один источник правды */
	setColorBy(v) {
		const pt = this.app.settings.point;
		this._userColor = true;
		this.state.look.colorBy = v;
		const m = { model: 'texture', solid: 'solid', normal: 'normal' }[v];
		if (m) pt.color = m;
		this.app.saveSettings();
		this.touch();
		this.emit();
	}

	/** Подтягивает режим цвета из вкладки «Точки»: для модели по умолчанию видна её текстура */
	syncLookFromPoints() {
		const m = { texture: 'model', solid: 'solid', normal: 'normal' }[this.app.settings.point.color];
		const cur = this.state.look.colorBy;
		if (m && ((this.state.source === 'model' && !this._userColor) || (cur !== 'disp' && cur !== 'index'))) this.state.look.colorBy = m;
	}

	touch() {
		this._histSoon();
		clearTimeout(this._saveT);
		this._saveT = setTimeout(() => saveJSON(KEY, this.state), 250);
	}

	emit() {
		this.app.bus.emit('fx');
	}

	// ------------------------------------------------------------ геометрия
	/** Сколько частиц реально используем: если в сцене есть готовое облако точек, не больше, чем в нём */
	_n() {
		const mp = this.modelProvider;
		if (mp && mp.kind() === 'cloud') return Math.max(1000, Math.min(this.state.count, mp.total()));
		return this.state.count;
	}

	// ------------------------------------------------------------ вход и выход
	async enter() {
		if (this.active) return;
		const app = this.app;
		this.active = true;
		this.state.look.autoRotate = false; // при входе форма не крутится сама, включается в «Вид»
		this.state.layers.frames.on = false; // раскадровка включается вручную и только пока открыто видео
		this._fxCur = new Set(); // начинаем с самого лёгкого шейдера: код эффектов добавляется, когда эффект включается
		this._fxSeen = new Map();
		this._fxBusy = false;
		this._warm = new Map(); // какие шейдеры уже собраны: у новой сцены новые материалы, готовность проверяется заново
		this._tgtWarm = {}; // готовность прочих объектов сцены под каждый вариант вывода
		this._tgtRT = this._postOn(); // сначала собирается тот вариант вывода (в экран или в буфер), который нужен сейчас
		this._framesOn = false;
		// число частиц: на Mac с единой памятью тянет до 2 млн; на Windows для защиты от перегрева и зависания драйвера ставим комфортный потолок (до 450 тыс. на мощных GPU, до 250 тыс. на встроенных)
		const maxFxCount = perf.isApple ? 2000000 : perf.windows ? (perf.tier === 'high' ? 450000 : perf.tier === 'mid' ? 160000 : 100000) : perf.tier === 'high' ? 1000000 : 250000;
		this.state.count = Math.max(20000, Math.min(maxFxCount, app.settings.point.surfaceCount));
		const vp = app.viewport;
		this._saved = { rootVisible: vp.root.visible, ortho: app.nav.ortho };
		app.model.select(null);
		vp.root.visible = false;
		vp.fxHide = true;
		if (app.nav.ortho) app.nav.setOrtho(false);
		document.getElementById('app').classList.add('fx-mode');
		// модель из редактора (меш или облако точек) важнее любого примитива
		this.state.source = this.pm.ready ? 'media' : this.hasModel ? 'model' : this.state.source === 'model' ? 'sphere' : this.state.source;
		// окна загрузки при переключении режимов нет: сцена на это время плавно гаснет, а облако уже готово заранее
		try {
			await this._build();
		} catch (e) {
			console.error(e);
			app.ui.idle();
			this.active = false;
			vp.root.visible = this._saved.rootVisible;
			vp.fxHide = false;
			document.getElementById('app').classList.remove('fx-mode', 'fx-focus');
			throw e;
		}
		// шейдеры эффектов большие: на Windows (ANGLE и D3D11) их компиляция идёт секунды, поэтому готовим их заранее, пока виден экран загрузки, а не на первом кадре
		this.backend = await createBackend(pickBackendKind(app.settings.render.backend), this);
		this.backend.create();
		// пока шейдеры собираются, облако скрыто: редактор продолжает рисовать сцену, и первый же кадр с облаком упёрся бы в ещё не собранную программу
		const buildPts = this.points;
		if (buildPts) buildPts.visible = false;
		try {
			const kinds = [this._vertKind()];
			// шейдер связей собирается только если эффект «Связи» включён: это вторая большая программа, и без неё вход быстрее
			if (this.linkObj && this.state.layers.links.on) kinds.push('line');
			await this.backend.prepare(kinds);
		} catch (e) {
			/* подготовка не обязательна */
		}
		if (buildPts && this.points === buildPts) buildPts.visible = true;
		app.ui.idle();
		// облака выбранных для морфинга моделей считаем заранее, пока вы смотрите на сцену
		setTimeout(() => this._prefetch(this.playlist), 400);
		const stage = document.querySelector('.stage');
		stage.addEventListener('pointermove', this._move);
		stage.addEventListener('pointerleave', this._leave);
		stage.addEventListener('pointerdown', this._dn);
		stage.addEventListener('pointerup', this._up);
		this._offScene = app.bus.on('scene', () => this._onScene());
		this.hud = new TrackerHud(document.getElementById('viewport'));
		this.app.viewport.fxGrid = !!this.state.look.grid;
		this.applyBg();
		this.backend.install();
		// камера встаёт на место мгновенно, пока сцена скрыта переходом: плавный подъезд был виден как «разбухание» модели
		app.nav.animateTo({ target: new THREE.Vector3(0, 0, 0), distance: 5.2 }, 0);
		this.syncLookFromPoints();
		// открытое видео сразу становится источником и продолжает играть
		if (this.pm.ready) {
			this.state.look.colorBy = 'model';
			this.pm.play();
			// звук видео сразу идёт в анализатор, и эффекты реагируют на него
			if (this.pm.kind === 'video') this.useVideoAudio().catch(() => {});
		}
		this._hist = { undo: [], redo: [], last: null };
		this._histT = setTimeout(() => this._histCommit(), 600);
		if (this.pm.playing && this.state.source === 'media') this.pm.play();
		this._lastT = performance.now();
		this._loop();
		this.emit();
	}

	exit() {
		if (!this.active) return;
		this.active = false;
		this.animPlaying = false;
		this.animRec = false;
		this.stopRecording();
		this.pause();
		this._videoToEditor();
		cancelAnimationFrame(this._raf);
		this._syncPaintLock(true);
		clearTimeout(this._sceneT);
		this._offScene && this._offScene();
		this.hud?.dispose();
		this.hud = null;
		this.backend?.dispose();
		this.backend = null;
		if (this.camTracker) {
			this._stopCam();
			this.camTracker = null;
		}
		this.app.viewport.applyRenderSettings();
		const vp = this.app.viewport;
		this._disposePoints();
		vp.root.visible = this._saved?.rootVisible !== false;
		vp.fxHide = false;
		const stage = document.querySelector('.stage');
		stage.removeEventListener('pointermove', this._move);
		stage.removeEventListener('pointerleave', this._leave);
		stage.removeEventListener('pointerdown', this._dn);
		stage.removeEventListener('pointerup', this._up);
		document.getElementById('app').classList.remove('fx-mode', 'fx-focus');
		this.app.display.apply();
		this.app.nav.frameAll(false);
		vp.invalidate();
		this.emit();
	}

	_eff(l) {
		if (!l.on) return 0;
		const g = this._fxGate ?? 1;
		if (l.band === 'none') return l.amount * g;
		const b = this._bandLevel(l);
		if (l.amode === 'gate') {
			// включение по порогу: эффект появляется, когда в выбранных частотах громче порога, и плавно гаснет после
			const envs = (this._envs ||= new WeakMap());
			let e = envs.get(l);
			if (!e) {
				e = { v: 0, t: this._time, open: false };
				envs.set(l, e);
			}
			if (e.t !== this._time) {
				const dt = Math.min(0.1, Math.max(0, this._time - e.t));
				e.t = this._time;
				e.open = b > l.thr ? true : b < l.thr * 0.8 ? false : e.open;
				const tc = Math.max(0.005, e.open ? l.atk : l.rel);
				e.v += ((e.open ? 1 : 0) - e.v) * (1 - Math.exp(-dt / tc));
			}
			return l.amount * e.v * g;
		}
		if (!l.react) return l.amount * g;
		// пока звука нет, эффект держится на своей обычной силе (середина шкалы), а не затихает: иначе без музыки кажется, что он сломан
		const lvl = this.soundActive ? b : 0.5;
		return l.amount * (1 - l.react + l.react * lvl * 2) * g;
	}

	/** Заморозка: время эффектов и звук стоят, пока открыто окно экспорта или справка; после них всё продолжается с того же места */
	setFrozen(v) {
		v = !!v;
		if (v === !!this.frozen) return;
		this.frozen = v;
		const ctx = this.ctx;
		if (v) {
			this._ctxWasRunning = !!ctx && ctx.state === 'running';
			if (this._ctxWasRunning) ctx.suspend().catch(() => {});
		} else if (this._ctxWasRunning && ctx) {
			ctx.resume().catch(() => {});
			this._ctxWasRunning = false;
		}
		this.app.viewport.invalidate();
	}

	/** Пока кисть включена, протяжка левой кнопкой рисует и не вращает сцену (вращение по Alt, сдвиг правой кнопкой) */
	_syncPaintLock(off) {
		const B = this.state.layers.brush;
		const want = !off && this.active && !!B && B.on && B.lock !== 'off';
		const nav = this.app.nav;
		if (nav.paintLock === want) return;
		nav.paintLock = want;
		this.app.viewport.container.classList.toggle('paint-lock', want);
	}
}

// Остальные методы лежат в отдельных файлах рядом и подмешиваются в класс.
mixin(EffectsEngine, FramesPart, KeyframesPart, SourcePart, BuildPart, LinksPart, ToolsPart, TrackingPart, HistoryPart, ScopeTrailPart, ShaderCachePart, DepthPart, AudioPart, InteractionPart, LoopPart, RecordingPart, ScreenPart, SlitPart, ChladniPart, ShadowPart, PixelSortPart);
