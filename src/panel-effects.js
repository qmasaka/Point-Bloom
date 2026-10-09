// Режим «Эффекты»: боковая панель (источник, эффекты, звук, вид) и нижняя панель управления в сцене.
import { h, formatInt } from './util.js';
import { icon } from './icons.js';
import { section, field, slider, segmented, switchRow, toggle, button, iconButton, select, colorField } from './ui-kit.js';
import * as THREE from 'three';
import { sampleSurface, overrideMats } from './pointcloud.js';
import { getDevice } from './device-card.js';
import { formatCount } from './capabilities.js';
import { createMediaPanel } from './panel-media.js';
import { createAnimPanel } from './panel-anim.js';
import { clipActivity } from './anim-activity.js';
import { attachPreview } from './fx-previews.js';
import { SHAPES as POINT_SHAPE_LIST } from './panel-points.js';
import { FX_GROUP_NAMES, FX_ACTIONS, FX_LAYERS, FX_PALETTES, BANDS, BAND_RANGE, FREQ_QUICK, COLOR_BY_UI, SYNTH_STYLES, MORPH_STYLES, MORPH_SORTS, MORPH_EASES } from './effects-engine.js';

/**
 * Источник «Модель» для эффектов: если в сцене редактора есть облако точек (оно создаётся на вкладке «Точки»),
 * берём его целиком, иначе набираем точки с поверхности видимых мешей.
 */
export function makeModelProvider(app) {
	const root = app.viewport.root;
	const shown = (o) => {
		for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
		return true;
	};
	const clouds = () => {
		const a = [];
		root.traverse((o) => {
			if (o.isPoints && !o.userData.helper && !o.userData.media && o.geometry.attributes.position && shown(o)) a.push(o);
		});
		return a;
	};
	const meshes = () => app.model.meshes().filter(shown);
	const fromClouds = (list, want) => {
		const total = list.reduce((n, o) => n + o.geometry.attributes.position.count, 0);
		const n = Math.min(want, total);
		const step = total / n;
		const positions = new Float32Array(n * 3);
		const normals = new Float32Array(n * 3);
		const colors = new Float32Array(n * 3).fill(1);
		const v = new THREE.Vector3();
		let k = 0;
		let seen = 0;
		let next = 0;
		// облака, посаженные на персонажа, сохраняют связь со скелетом: в эффектах точки продолжат двигаться по анимации
		const animated = list.some((o) => o.userData.animPts);
		const A = animated ? { parts: [], part: new Uint8Array(n), bp: new Float32Array(n * 3), bi: new Uint16Array(n * 4), bw: new Float32Array(n * 4) } : null;
		for (const o of list) {
			o.updateWorldMatrix(true, false);
			const g = o.geometry.attributes;
			let poff = 0;
			const src = o.userData.animPts;
			if (A) {
				poff = A.parts.length;
				if (src) A.parts.push(...src.parts);
				else A.parts.push({ mesh: o, skinned: false });
			}
			const cnt = g.position.count;
			const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
			for (let i = 0; i < cnt && k < n; i++, seen++) {
				if (seen < Math.floor(next)) continue;
				next += step;
				v.fromBufferAttribute(g.position, i).applyMatrix4(o.matrixWorld);
				positions.set([v.x, v.y, v.z], k * 3);
				if (A) {
					if (src && i < src.part.length) {
						A.part[k] = src.part[i] + poff;
						A.bp.set([src.bp[i * 3], src.bp[i * 3 + 1], src.bp[i * 3 + 2]], k * 3);
						for (let q = 0; q < 4; q++) {
							A.bi[k * 4 + q] = src.bi[i * 4 + q];
							A.bw[k * 4 + q] = src.bw[i * 4 + q];
						}
					} else {
						A.part[k] = poff;
						A.bp.set([g.position.getX(i), g.position.getY(i), g.position.getZ(i)], k * 3);
					}
				}
				if (g.normal) {
					v.fromBufferAttribute(g.normal, i).applyMatrix3(nm).normalize();
					normals.set([v.x, v.y, v.z], k * 3);
				} else normals[k * 3 + 1] = 1;
				if (g.color) colors.set([g.color.getX(i), g.color.getY(i), g.color.getZ(i)], k * 3);
				k++;
			}
		}
		const out = { positions: positions.slice(0, k * 3), normals: normals.slice(0, k * 3), colors: colors.slice(0, k * 3), count: k };
		if (A && A.parts.some((q) => q.skinned) && app.anim.has) out.animBox = app.anim.animatedBounds();
		if (A && A.parts.some((q) => q.skinned)) out.anim = { parts: A.parts, part: A.part.slice(0, k), bp: A.bp.slice(0, k * 3), bi: A.bi.slice(0, k * 4), bw: A.bw.slice(0, k * 4) };
		return out;
	};
	const topObjects = () => root.children.filter((o) => !o.userData.helper && !o.userData.media && o.name !== '__fx' && (() => { let ok = false; o.traverse((c) => { if (!c.userData.helper && (c.isMesh || c.isPoints)) ok = true; }); return ok; })());
	return {
		/** Объекты верхнего уровня сцены: каждый можно взять отдельной формой для морфинга */
		sizeOf: (obj) => {
			let n = 0;
			obj.traverse((c) => {
				if (c.userData.helper || !c.geometry) return;
				const g = c.geometry;
				if (c.isPoints) n += g.attributes.position.count;
				else if (c.isMesh) n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
			});
			return n;
		},
		objects: () => topObjects().map((o) => ({ id: o.uuid, name: o.name || 'Объект', obj: o })),
		async getOf(obj, count) {
			const cl = [];
			obj.traverse((o) => {
				if (o.isPoints && !o.userData.helper && o.geometry.attributes.position) cl.push(o);
			});
			if (cl.length) return fromClouds(cl, count);
			const list = app.model.meshesOf(obj);
			if (!list.length) return null;
			const entries = list.map((m) => ({ mesh: m, mats: overrideMats(app.pointTexture, app.display.getOriginal(m)) }));
			return sampleSurface(entries, count, {});
		},
		available: () => clouds().length > 0 || meshes().length > 0,
		kind: () => (clouds().length ? 'cloud' : meshes().length ? 'mesh' : 'none'),
		total: () => clouds().reduce((n, o) => n + o.geometry.attributes.position.count, 0),
		async get(count) {
			const c = clouds();
			if (c.length) return fromClouds(c, count);
			const list = meshes();
			if (!list.length) return null;
			const entries = list.map((m) => ({ mesh: m, mats: overrideMats(app.pointTexture, app.display.getOriginal(m)) }));
			const cl = await sampleSurface(entries, count, { anim: app.anim.has, onProgress: (p) => {
				// фоновая подготовка к морфингу не показывает окно загрузки: иначе оно зависает поверх сцены
				if (!app.ui.effectsEngine?._quiet) app.ui.busy('Беру точки с модели', 0.2 + p * 0.7);
			} });
			// масштаб сцены эффектов берётся по всему движению клипа, иначе прыгающий или бегущий персонаж уходит за кадр
			if (cl.anim && app.anim.has) cl.animBox = app.anim.animatedBounds();
			return cl;
		},
	};
}

const TRACK_COLORS = ['#ffffff', '#00f0ff', '#ff1fcb', '#ffd90f', '#7cff6b', '#ff4d4d'];

/** Выбор цвета: «по палитре» или один из готовых цветов, плюс свой */
function colorChoice(L, key, done, natural = false) {
	const chips = [];
	const wrap = h('div', { class: 'fx-color' });
	const row = h('div', { class: 'fx-bg-sw' });
	const mkChip = (val, name, style) => {
		const b = h('button', { type: 'button', class: 'fx-bg-chip' + (val === 'auto' ? ' is-default' : ''), 'aria-label': name, 'data-tip': name, style: style || {} });
		b.addEventListener('click', () => pick(val));
		chips.push([val, b]);
		row.append(b);
	};
	mkChip('auto', 'Цвета палитры');
	if (natural) mkChip('model', 'Естественные цвета модели', { background: 'conic-gradient(#ff3d6e, #ffd90f, #7cff6b, #00f0ff, #b06bff, #ff3d6e)' });
	for (const c of TRACK_COLORS) mkChip(c, c, { background: c });
	const custom = colorField({ value: L[key] === 'auto' ? '#ffffff' : L[key], onInput: (v) => pick(v, true), onChange: done });
	wrap.append(row, custom.el);
	function mark() {
		for (const [v, b] of chips) b.classList.toggle('is-active', v === L[key]);
	}
	function pick(v, live) {
		L[key] = v;
		if (!live && v !== 'auto' && v !== 'model') custom.set(v);
		mark();
		done();
	}
	mark();
	return {
		el: wrap,
		set(v) {
			if (v !== 'auto' && v !== 'model') custom.set(v);
			mark();
		},
	};
}

export function createEffectsPanel(app, root, engine) {
	const st = engine.state;
	const save = () => engine.touch();

	// ------------------------------------------------------------ пресеты
	const pset = app.settings.point;
	const size = slider({ min: 1, max: 24, step: 0.5, value: pset.size, digits: 1, unit: ' px', onInput: (v) => { pset.size = v; }, onChange: () => app.saveSettings() });
	const dev = getDevice(app);
	const cap = () => Math.max(100000, Math.min(2000000, getDevice(app).limits.cap));
	const count = slider({
		log: true,
		min: 20000,
		max: cap(),
		step: 10000,
		value: Math.min(st.count, cap()),
		format: (v) => formatInt(v),
		onInput: () => {},
		onChange: (v) => engine.setCount(v),
	});
	const countHint = h('div', { class: 'field-hint' });
	const addModel = button({ label: 'Добавить модель…', icon: 'folder-open', variant: 'secondary', cls: 'btn-block', title: 'Открыть модель, облако точек (PLY, PCD, XYZ) или архив и сразу использовать их здесь', onClick: () => app.ui.openFiles('add') });
	const modelNote = h('div', { class: 'field-hint' });
	// ------------------------------------------------------------ морфинг между моделями
	const mc = st.morphCfg;
	const formsBox = h('div', { class: 'chip-row fx-forms' });
	const picked = [];
	let autoPicked = false;
	const renderForms = () => {
		const list = engine.forms();
		for (let i = picked.length - 1; i >= 0; i--) if (!list.some((f) => f.key === picked[i])) picked.splice(i, 1);
		// две модели и больше: сразу готовы к морфингу между ними
		if (list.length >= 2 && !autoPicked && !picked.length) {
			autoPicked = true;
			list.forEach((o) => picked.push(o.key));
			engine.setPlaylist([...picked]);
		}
		if (list.length < 2) autoPicked = false;
		formsBox.textContent = '';
		for (const f of list) {
			const b = h('button', { type: 'button', class: 'chip-btn' + (picked.includes(f.key) ? ' is-active' : ''), 'data-tip': 'Участвует в морфинге. Порядок: как нажимали' }, f.name);
			b.addEventListener('click', () => {
				const k = picked.indexOf(f.key);
				if (k >= 0) picked.splice(k, 1);
				else picked.push(f.key);
				engine.setPlaylist([...picked]);
				renderForms();
			});
			formsBox.append(b);
		}
		const has = list.length >= 2;
		morphBox.hidden = !has;
		morphNote.hidden = has;
		morphHint.textContent = picked.length < 2 ? 'Отметьте минимум две модели, между которыми должен идти морфинг.' : '';
	};
	const morphHint = h('div', { class: 'field-hint' });
	// вид перехода: плитки с иконкой, у каждого свои настройки по умолчанию
	const styleTiles = h('div', { class: 'shape-grid fx-shapes morph-styles', role: 'radiogroup', 'aria-label': 'Вид перехода' });
	const styleBtns = new Map();
	const styleHint = h('div', { class: 'field-hint' });
	for (const ms of MORPH_STYLES) {
		const b = h('button', { type: 'button', class: 'shape-tile', role: 'radio', 'data-tip': ms.hint }, h('span', { class: 'fx-ic', html: icon(ms.icon, 22) }), h('span', { class: 'shape-name' }, ms.name));
		b.addEventListener('click', () => {
			mc.style = ms.id;
			Object.assign(mc, ms.v);
			save();
			syncMorph();
		});
		styleBtns.set(ms.id, b);
		styleTiles.append(b);
	}
	const morphMode = segmented({ cls: 'seg-tight', options: [{ value: 'manual', label: 'Кнопкой' }, { value: 'beat', label: 'По биту' }, { value: 'timer', label: 'По таймеру' }], value: mc.mode, onChange: (v) => { mc.mode = v; save(); syncMorph(); } });
	const morphOrder = segmented({ options: [{ value: 'seq', label: 'По кругу' }, { value: 'random', label: 'Случайно' }], value: mc.order, onChange: (v) => { mc.order = v; save(); } });
	const morphInt = slider({ min: 1, max: 20, step: 0.5, value: mc.interval, digits: 1, unit: ' с', onInput: (v) => { mc.interval = v; }, onChange: save });
	const morphTime = slider({ min: 0.4, max: 8, step: 0.1, value: mc.time, digits: 1, unit: ' с', onInput: (v) => { mc.time = v; }, onChange: save });
	const morphScatter = slider({ min: 0, max: 2, step: 0.05, value: mc.scatter, digits: 2, onInput: (v) => { mc.scatter = v; }, onChange: save });
	const morphStagger = slider({ min: 0, max: 3, step: 0.05, value: mc.stagger, digits: 2, onInput: (v) => { mc.stagger = v; }, onChange: save });
	const morphTurns = slider({ min: 0, max: 3, step: 0.1, value: mc.turns, digits: 1, onInput: (v) => { mc.turns = v; }, onChange: save });
	const morphGlow = slider({ min: 0, max: 1.5, step: 0.05, value: mc.glow, digits: 2, onInput: (v) => { mc.glow = v; }, onChange: save });
	const morphSort = select({ options: MORPH_SORTS.map(([value, label]) => ({ value, label })), value: mc.sort, onChange: (v) => { mc.sort = v; save(); } });
	const morphEase = segmented({ cls: 'seg-tight', options: MORPH_EASES.map(([value, label]) => ({ value, label })), value: mc.ease, onChange: (v) => { mc.ease = v; save(); } });
	const morphWeight = segmented({ options: [{ value: 'auto', label: 'Как в модели', title: 'У модели с меньшим числом точек лишние гаснут, при переходе к большей недостающие проявляются' }, { value: 'equal', label: 'Поровну', title: 'У всех моделей одинаковое число точек' }], value: mc.weight, onChange: (v) => { mc.weight = v; save(); } });
	const morphGo = button({ label: 'Следующая модель', icon: 'arrow-right', variant: 'primary', cls: 'btn-block', title: 'Запустить переход к следующей модели из списка', onClick: () => engine.morphNext() });
	const turnsRow = field('Закрутка', morphTurns.el);
	const intRow = field('Не чаще, чем раз в', morphInt.el);
	const morphBox = h('div', { class: 'sec-body', style: { padding: 0 } },
		formsBox,
		morphHint,
		h('div', { class: 'fx-sub' }, 'Вид перехода'),
		styleTiles,
		styleHint,
		field('Длительность', morphTime.el),
		field('Разлёт', morphScatter.el),
		field('Разнобой по времени', morphStagger.el),
		turnsRow,
		field('Какие точки первыми', morphSort.el, { wide: true }),
		field('Характер движения', morphEase.el, { wide: true }),
		field('Вспышка в пути', morphGlow.el),
		h('div', { class: 'fx-sub' }, 'Запуск'),
		field('Переход', morphMode.el, { wide: true }),
		field('Порядок моделей', morphOrder.el, { wide: true }),
		intRow,
		field('Число точек у моделей', morphWeight.el, { wide: true }),
		morphGo
	);
	const morphNote = h('div', { class: 'fx-morph-note' }, h('b', {}, 'Морфинг между моделями'), h('span', {}, 'Если хотите, можно сделать плавный переход между двумя объектами: добавьте в сцену вторую модель, и здесь появятся виды перехода и их настройки.'));
	function syncMorph() {
		const cur = MORPH_STYLES.find((x) => x.id === mc.style) || MORPH_STYLES[0];
		styleBtns.forEach((b, k) => b.setAttribute('aria-checked', String(k === cur.id)));
		styleHint.textContent = cur.hint;
		turnsRow.hidden = cur.id !== 'swirl';
		intRow.hidden = mc.mode === 'manual';
		morphMode.set(mc.mode);
		morphTime.set(mc.time);
		morphScatter.set(mc.scatter);
		morphStagger.set(mc.stagger);
		morphTurns.set(mc.turns);
		morphGlow.set(mc.glow);
		morphSort.set(mc.sort);
		morphEase.set(mc.ease);
	}
	renderForms();
	syncMorph();
	const secSource = section('Форма', { key: 'fx-source' }, addModel, modelNote, field('Частиц', count.el), field('Размер точек', size.el), countHint);
	const secMorph = section('Морфинг', { key: 'fx-morph' }, morphNote, morphBox);

	// ------------------------------------------------------------ полоска спектра: живой звук и выбор частот
	/** Холст со спектром. Показывает диапазон эффекта и текущую громкость в нём; диапазон можно тянуть мышью. */
	const pickers = new Set();
	function freqPicker(L, onSave) {
		const cv = h('canvas', { class: 'fx-freq-cv' });
		const lab = h('div', { class: 'fx-freq-lab' });
		const chips = h('div', { class: 'chip-row fx-freq-chips' });
		const el = h('div', { class: 'fx-freq' }, cv, lab, chips);
		const ctx = cv.getContext('2d');
		const range = () => (L.band === 'custom' ? [L.lo, L.hi] : BAND_RANGE[L.band] || (L.band === 'beat' ? [0, 0.3] : [0, 0]));
		for (const [name, f0, f1] of FREQ_QUICK) {
			const b = h('button', { type: 'button', class: 'chip-btn', 'data-tip': `${f0}–${f1} Гц` }, name);
			b.addEventListener('click', () => {
				const sr = engine.ctx?.sampleRate || 44100;
				const toX = (hz) => Math.sqrt(hz / (0.275 * sr));
				L.band = 'custom';
				L.lo = toX(f0);
				L.hi = toX(f1);
				if (!L.react) L.react = 0.7;
				onSave();
				engine.emit();
			});
			chips.append(b);
		}
		// рисуем только то, что реально видно на экране: без IntersectionObserver все 20 полосок читали бы размеры каждый кадр
		let vis = false;
		new IntersectionObserver((es) => { vis = es[es.length - 1].isIntersecting; }).observe(cv);
		function draw() {
			if (!vis || el.hidden) return;
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			const W = cv.clientWidth;
			const H = 56;
			if (cv.width !== Math.round(W * dpr) || cv.height !== H * dpr) {
				cv.width = Math.round(W * dpr);
				cv.height = H * dpr;
			}
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, W, H);
			const [r0, r1] = range();
			const bw = W / 64;
			const sp = engine.spec;
			const cs = getComputedStyle(cv);
			const acc = cs.getPropertyValue('--accent').trim() || '#e58a45';
			const dim = cs.getPropertyValue('--text-faint').trim() || '#747c89';
			// выбранный диапазон подсвечен подложкой
			ctx.globalAlpha = 0.16;
			ctx.fillStyle = acc;
			ctx.fillRect(r0 * W, 0, Math.max(2, (r1 - r0) * W), H);
			ctx.globalAlpha = 1;
			for (let i = 0; i < 64; i++) {
				const v = Math.min(1, sp[i] || 0);
				const inR = (i + 0.5) / 64 >= r0 && (i + 0.5) / 64 <= r1;
				ctx.fillStyle = inR ? acc : dim;
				ctx.globalAlpha = inR ? 0.95 : 0.45;
				const h2 = Math.max(1.5, v * (H - 8));
				ctx.fillRect(i * bw + 0.5, H - h2, Math.max(1, bw - 1.5), h2);
			}
			ctx.globalAlpha = 1;
			// порог: горизонтальная линия над выбранным диапазоном
			if (L.amode === 'gate') {
				const y = H - L.thr * (H - 8);
				ctx.strokeStyle = '#fff';
				ctx.globalAlpha = 0.8;
				ctx.setLineDash([4, 3]);
				ctx.beginPath();
				ctx.moveTo(r0 * W, y);
				ctx.lineTo(Math.max(r0 * W + 2, r1 * W), y);
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.globalAlpha = 1;
			}
			// края диапазона
			if (L.band === 'custom') {
				ctx.fillStyle = acc;
				ctx.fillRect(r0 * W - 1.5, 0, 3, H);
				ctx.fillRect(r1 * W - 1.5, 0, 3, H);
			}
			const lvl = engine._bandLevel(L);
			const open = L.amode === 'gate' && lvl > L.thr;
			lab.textContent = (L.band === 'custom' || BAND_RANGE[L.band] ? `${engine.hzAt(r0)}–${engine.hzAt(r1)} Гц` : 'Удары в басах') + `  ·  сейчас ${Math.round(lvl * 100)}%` + (L.amode === 'gate' ? (open ? '  ·  включён' : '  ·  ждёт') : '');
		}
		// мышь: потянуть край, подвинуть диапазон или нарисовать новый
		cv.addEventListener('pointerdown', (e) => {
			if (L.band === 'none') return;
			const r = cv.getBoundingClientRect();
			const xAt = (ev) => Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
			const x = xAt(e);
			const [a, b] = range();
			const near = 9 / r.width;
			let mode = 'new';
			if (L.band === 'custom') {
				if (Math.abs(x - a) < near) mode = 'lo';
				else if (Math.abs(x - b) < near) mode = 'hi';
				else if (x > a && x < b) mode = 'move';
			}
			L.band = 'custom';
			if (!L.react) L.react = 0.7;
			if (mode === 'new') {
				L.lo = x;
				L.hi = Math.min(1, x + 0.03);
				mode = 'hi';
			}
			const off = x - L.lo;
			const wd = L.hi - L.lo;
			cv.setPointerCapture(e.pointerId);
			const mv = (ev) => {
				const xx = xAt(ev);
				if (mode === 'lo') L.lo = Math.min(xx, L.hi - 0.02);
				else if (mode === 'hi') L.hi = Math.max(xx, L.lo + 0.02);
				else {
					L.lo = Math.max(0, Math.min(1 - wd, xx - off));
					L.hi = L.lo + wd;
				}
				draw();
			};
			const up = () => {
				cv.removeEventListener('pointermove', mv);
				cv.removeEventListener('pointerup', up);
				onSave();
				engine.emit();
			};
			cv.addEventListener('pointermove', mv);
			cv.addEventListener('pointerup', up);
			mv(e);
		});
		const api = { el, draw };
		pickers.add(api);
		return api;
	}
	// живое обновление всех видимых полосок один раз за кадр, пока открыты эффекты
	(function pickerLoop() {
		let last = 0;
		const tick = (now) => {
			requestAnimationFrame(tick);
			if (!engine.active || now - last < 40) return; // около 25 кадров в секунду достаточно для полоски спектра
			last = now;
			for (const p of pickers) p.draw();
		};
		requestAnimationFrame(tick);
	})();

	// ------------------------------------------------------------ слои
	const cards = [];
	const left = document.getElementById('fxList');
	const leftCount = document.getElementById('fxActive');
	const inspBox = h('div', { class: 'fx-insp-box' });
	let selected = null;
	let fxTabHook = () => {};
	const select_ = (id) => {
		selected = id;
		for (const c of cards) {
			c.card.classList.toggle('is-selected', c.def.id === id);
			c.insp.classList.toggle('is-selected', c.def.id === id);
		}
	};
	const EXTRA_ANIM_LAYERS = {
		morph: { id: 'morph', name: 'Морфинг', icon: 'cube', hint: 'Плавный морфинг между формами и моделями' },
		rotate: { id: 'rotate', name: 'Вращение', icon: 'arrows-clockwise', hint: 'Плавное вращение формы вокруг оси' },
		bloom: { id: 'bloom', name: 'Блум', icon: 'sparkle', hint: 'Вспышка и усиление свечения точек' },
	};
	const getLayerDef = (id) => EXTRA_ANIM_LAYERS[id] || FX_LAYERS.find((x) => x.id === id) || { id, name: id, icon: 'sparkle', hint: '' };
	const ANIM_LAYERS = ['morph', 'curl', 'flow', 'wave', 'twist', 'pulse', 'blast', 'voxel', 'glitch', 'slice', 'links', 'feedback', 'echo', 'dissolve', 'spectrum', 'physics', 'rotate', 'bloom', 'gravity', 'scope', 'depth'];
	let toggleAnim = () => {};
	let animAddFromInspector = () => {};
	const animQuickBtn = button({
		label: 'Секвенсор анимации',
		icon: 'film-strip',
		variant: 'secondary',
		cls: 'btn-block fx-anim-quick-btn',
		title: 'Открыть таймлайн для анимации эффектов и камеры',
		onClick: () => toggleAnim()
	});
	for (const grp of FX_GROUP_NAMES) {
		const folder = h('div', { class: 'fx-folder' });
		const fhead = h('button', { type: 'button', class: 'fx-folder-head', 'aria-expanded': 'true' }, h('span', { class: 'fx-folder-caret', html: icon('caret-down', 13) }), h('span', { class: 'fx-folder-name' }, grp), h('span', { class: 'fx-folder-n' }));
		const fbody = h('div', { class: 'fx-folder-body' });
		fhead.addEventListener('click', () => {
			const closed = folder.classList.toggle('is-closed');
			fhead.setAttribute('aria-expanded', String(!closed));
		});
		folder.append(fhead, fbody);
		left.append(folder);
		for (const def of FX_LAYERS.filter((d) => d.group === grp && !d.hidden)) {
			st.layers[def.id] = { ...def.def, ...(st.layers[def.id] || {}) };
			const L = st.layers[def.id];
			const sw = toggle({
				value: L.on,
				label: def.name,
				onChange: (v) => {
					L.on = v;
					card.classList.toggle('is-on', v);
					if (v) {
						select_(def.id);
						fxTabHook();
					}
					countActive();
					save();
				},
			});
			const amount = slider({ min: 0, max: def.max, step: 0.05, value: L.amount, digits: 2, onInput: (v) => { L.amount = v; }, onChange: save });
			const body = h('div', { class: 'fx-layer-body' });
			if (def.id === 'physics') {
				const collapseBtn = button({
					label: engine.isCollapsed ? 'Собрать форму' : 'Разрушить форму',
					icon: 'atom',
					variant: 'primary',
					cls: 'btn-block',
					onClick: () => {
						engine.toggleCollapse();
						collapseBtn.querySelector('.btn-label').textContent = engine.isCollapsed ? 'Собрать форму' : 'Разрушить форму';
					},
				});
				body.append(collapseBtn);
			} else if (def.id === 'frames') {
				body.append(h('div', { class: 'field-hint' }, 'Видео раскладывается на кадры, кадры собираются в блок из точек. Текущий кадр рисуется густо, остальные реже. Что сейчас показано, задаёт таймлайн внизу: играйте и перематывайте видео, блок следует за ним. Остальные эффекты работают поверх блока.'), button({ label: 'Снять кадры заново', icon: 'film-strip', variant: 'secondary', cls: 'btn-block', title: 'Снять кадры с видео заново с текущими настройками', onClick: () => engine.rebuildFramesSoon() }));
			} else if (def.id === 'brush') {
				const clearBtn = button({
					label: 'Стереть краску',
					icon: 'broom',
					variant: 'secondary',
					cls: 'btn-block',
					onClick: () => engine.clearBrush(),
				});
				body.append(clearBtn);
			} else if (def.id === 'dissolve') {
				const disBtn = button({ label: 'Растворить / собрать', icon: 'snowflake', variant: 'primary', cls: 'btn-block', onClick: () => engine.toggleDissolve() });
				body.append(disBtn);
			} else if (def.id === 'depth') {
				const map = h('canvas', { class: 'fx-depth-map', width: 160, height: 100, 'aria-hidden': 'true' });
				const stat = h('div', { class: 'fx-depth-stat' });
				const goBtn = button({ label: 'Построить карту глубины', icon: 'mountains', variant: 'primary', cls: 'btn-block', title: 'Загрузить нейросеть (один раз) и посчитать карту глубины текущего кадра', onClick: () => engine.buildDepth() });
				const saveMap = button({ label: 'Сохранить карту (PNG)', icon: 'download-simple', variant: 'secondary', cls: 'btn-block', onClick: () => engine.saveDepthMap() });
				const depthUpd = () => {
					const I = engine.depthInfo();
					let t;
					if (!I.media) t = 'Откройте фото или видео: эффект работает с ними.';
					else if (I.src === 'luma') t = 'Быстрая карта по яркости: светлое считается ближе. Для настоящей глубины выберите «Нейросеть».';
					else if (I.phase === 'error') t = 'Нейросеть не запустилась: ' + (I.error || 'нет связи') + '. Пока работает быстрая карта по яркости. Нажмите кнопку, чтобы повторить.';
					else if (I.phase === 'loading') t = 'Загрузка нейросети: ' + Math.round(I.prog * 100) + '%. Это один раз, потом модель берётся из кеша браузера. Пока видна быстрая карта по яркости.';
					else if (I.phase === 'ready') t = (I.device === 'webgpu' ? 'Нейросеть работает на видеокарте.' : 'Нейросеть работает на процессоре, на видео это медленнее.') + (I.video ? ' Карта обновляется по ходу видео.' : '') + (I.error ? ' Ошибка: ' + I.error : '');
					else t = I.hasMap ? 'Пока видна быстрая карта по яркости. Нажмите кнопку или включите эффект, чтобы загрузить нейросеть.' : 'Нейросеть загрузится при включении эффекта (около 50 МБ один раз, нужен интернет).';
					stat.textContent = t;
					map.hidden = !I.hasMap;
					// превью карты перерисовываем не чаще нескольких раз в секунду: у видео карта приходит десятки раз в секунду
					const now = performance.now();
					if (I.hasMap && now - (depthUpd.t || 0) > 160) {
						depthUpd.t = now;
						engine.drawDepthMap(map);
					} else if (I.hasMap && !depthUpd.pend) {
						depthUpd.pend = setTimeout(() => {
							depthUpd.pend = 0;
							depthUpd();
						}, 200);
					}
					goBtn.hidden = I.src !== 'ai';
					goBtn.disabled = !I.media || I.phase === 'loading';
					saveMap.hidden = !I.hasMap;
				};
				engine.onDepthChange(depthUpd);
				depthUpd();
				body.append(h('div', { class: 'fx-depth-box' }, map, stat), goBtn, saveMap);
			} else if (def.id === 'camTrack') {
				const camBtn = button({
					label: engine.camTracker?.running ? 'Выключить камеру' : 'Включить камеру',
					icon: 'video-camera',
					variant: 'secondary',
					cls: 'btn-block',
					onClick: async () => {
						await engine.toggleMotionCam();
						camBtn.querySelector('.btn-label').textContent = engine.camTracker?.running ? 'Выключить камеру' : 'Включить камеру';
					},
				});
				body.append(camBtn);
				body.append(button({ label: 'Вернуть форму после лепки', icon: 'broom', variant: 'secondary', cls: 'btn-block', onClick: () => engine.clearSculpt() }));
				body.append(h('div', { class: 'field-hint' }, 'При первом включении загружается модель распознавания рук (около 10 МБ), нужен интернет. Видео с камеры никуда не отправляется.'));
			}
			// у раскадровки «Силы» нет: блок либо собран, либо нет, а степень задают число кадров, точки и глубина
			if (def.id !== 'frames') body.append(field('Сила', amount.el));
			const extraCtl = {};
			const whenList = [];
			const put = (el, ex) => {
				body.append(el);
				if (ex.when) whenList.push([el, ex.when]);
			};
			const applyWhen = () => whenList.forEach(([el, w]) => (el.hidden = !w[1].includes(L[w[0]])));
			if (def.extras.some((x) => x.key) && def.extras[0].type !== 'title') body.append(h('div', { class: 'fx-sub' }, 'Параметры'));
			for (const ex of def.extras) {
				const after = () => {
					applyWhen();
					save();
					if (ex.relink) engine.relink();
					if (ex.reframe) engine.rebuildFramesSoon();
					if (ex.relayout) engine.relayoutFrames();
				};
				if (ex.type === 'select') {
					const sl = select({ options: ex.options.map(([value, label]) => ({ value, label })), value: L[ex.key], onChange: (v) => { L[ex.key] = v; after(); } });
					extraCtl[ex.key] = sl;
					put(field(ex.label, sl.el, { wide: true }), ex);
				} else if (ex.type === 'note') {
					put(h('div', { class: 'field-hint' }, ex.text), ex);
				} else if (ex.type === 'title') {
					put(h('div', { class: 'fx-sub' }, ex.label), ex);
				} else if (ex.type === 'color') {
					const ctl = colorChoice(L, ex.key, after, !!ex.natural);
					extraCtl[ex.key] = ctl;
					put(field(ex.label, ctl.el, { wide: true }), ex);
				} else if (ex.type === 'seg') {
					const sg = segmented({ cls: ex.options.length > 3 ? 'seg-tight' : undefined, options: ex.options.map(([value, label]) => ({ value, label })), value: L[ex.key], onChange: (v) => { L[ex.key] = v; after(); } });
					extraCtl[ex.key] = sg;
					put(field(ex.label, sg.el, { wide: true }), ex);
				} else {
					const sl = slider({ min: ex.min, max: ex.max, step: ex.step, value: L[ex.key], digits: ex.int ? 0 : 2, unit: ex.unit, log: ex.log, format: ex.log ? (v) => formatInt(v) : undefined, onInput: (v) => { L[ex.key] = v; if (ex.relayout) engine.relayoutFrames(); }, onChange: after });
					extraCtl[ex.key] = sl;
					put(field(ex.label, sl.el), ex);
				}
			}
			applyWhen();
			const react = slider({ min: 0, max: 1, step: 0.05, value: L.react, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { L.react = v; }, onChange: save });
			const reactRow = field('Сила реакции', react.el);
			const modeSeg = segmented({
				cls: 'seg-tight',
				options: [{ value: 'amp', label: 'Усиливать', title: 'Сила эффекта растёт и падает вместе с громкостью выбранных частот' }, { value: 'gate', label: 'По порогу', title: 'Эффект включается, когда выбранные частоты громче порога, и плавно гаснет' }],
				value: L.amode,
				onChange: (v) => {
					L.amode = v;
					audioUiFull();
					save();
				},
			});
			const thr = slider({ min: 0.05, max: 0.95, step: 0.01, value: L.thr, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { L.thr = v; }, onChange: save });
			const atk = slider({ log: true, min: 0.005, max: 1, step: 0.005, value: L.atk, format: (v) => (v < 0.1 ? Math.round(v * 1000) + ' мс' : v.toFixed(2) + ' с'), onInput: (v) => { L.atk = v; }, onChange: save });
			const rel = slider({ log: true, min: 0.03, max: 4, step: 0.01, value: L.rel, format: (v) => (v < 0.1 ? Math.round(v * 1000) + ' мс' : v.toFixed(2) + ' с'), onInput: (v) => { L.rel = v; }, onChange: save });
			const gateBox = h('div', { class: 'sec-body', style: { padding: 0 } }, field('Порог', thr.el), field('Включается за', atk.el), field('Гаснет за', rel.el));
			const picker = freqPicker(L, save);
			const band = segmented({
				cls: 'seg-tight',
				options: BANDS.map((b) => ({ value: b.id, label: b.label, title: b.title })),
				value: L.band,
				onChange: (v) => {
					L.band = v;
					if (v !== 'none' && !L.react) {
						L.react = 0.7;
						react.set(0.7);
					}
					audioUiFull();
					save();
				},
			});
			const modeRow = field('Как реагирует', modeSeg.el, { wide: true });
			const audioUiFull = () => {
				const on = L.band !== 'none';
				modeRow.hidden = !on;
				picker.el.hidden = !on;
				reactRow.hidden = !on || L.amode === 'gate';
				gateBox.hidden = !on || L.amode !== 'gate';
				picker.draw();
			};
			// блок звука сворачивается: если эффект не слушает звук, он по умолчанию закрыт и не загромождает панель
			const audioWrap = h('div', { class: 'fx-grp-body' }, field('Слушает частоты', band.el, { wide: true }), picker.el, modeRow, reactRow, gateBox);
			let audioOpen = L.band !== 'none';
			const audioHead = h('button', { type: 'button', class: 'fx-sub fx-sub-toggle', 'aria-expanded': String(audioOpen) }, h('span', { class: 'ic-wrap', html: icon('caret-down', 12) }), 'Реакция на звук');
			const audioState = h('span', { class: 'fx-sub-state' });
			audioHead.append(audioState);
			const syncAudioHead = () => {
				audioWrap.hidden = !audioOpen;
				audioHead.setAttribute('aria-expanded', String(audioOpen));
				audioState.textContent = L.band === 'none' ? 'выкл.' : L.band === 'custom' ? 'свои частоты' : (BANDS.find((x) => x.id === L.band) || { label: '' }).label;
			};
			audioHead.addEventListener('click', () => {
				audioOpen = !audioOpen;
				syncAudioHead();
				picker.draw();
			});
			band.el.addEventListener('click', () => requestAnimationFrame(syncAudioHead));
			body.append(audioHead, audioWrap);
			syncAudioHead();
			audioUiFull();
			const prevCanvas = h('canvas', { class: 'fx-prev', 'aria-hidden': 'true' });
			const row = h('div', { class: 'fx-layer-head', role: 'button', tabindex: '0' }, prevCanvas, h('span', { class: 'fx-layer-title' }, def.name), sw.el);
			const card = h('div', { class: 'fx-layer' + (L.on ? ' is-on' : ''), 'data-layer': def.id, 'data-tip': def.hint, 'data-tip-pos': 'right', 'data-tip-delay': '1300' }, row);
			const insp = h('div', { class: 'fx-insp', 'data-layer': def.id }, body);
			row.addEventListener('click', (e) => {
				if (!e.target.closest('.switch')) {
					select_(def.id);
					fxTabHook();
				}
			});
			row.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					select_(def.id);
					fxTabHook();
				}
			});
			fbody.append(card);
			attachPreview(prevCanvas, def.id, card, () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e58a45');
			inspBox.append(insp);
			cards.push({ folder, def, L, sw, amount, react, band, reactRow, modeSeg, thr, atk, rel, audioUi: audioUiFull, syncHead: syncAudioHead, picker, extraCtl, applyWhen, card, insp, fhead });
		}
	}
	const inspEmpty = h('div', { class: 'empty-note' }, h('strong', {}, 'Выберите эффект'), h('span', {}, 'Нажмите на строку в списке слева, чтобы настроить его здесь'));
	const secInsp = section('Настройки эффекта', { key: 'fx-insp' }, inspBox);
	function countActive() {
		const n = cards.filter((c) => c.L.on).length;
		if (leftCount) leftCount.textContent = n ? `включено: ${n}` : 'ничего не включено';
		for (const grp of new Set(cards.map((c) => c.def.group))) {
			const cs = cards.filter((c) => c.def.group === grp);
			const k = cs.filter((c) => c.L.on).length;
			const el = cs[0].fhead.querySelector('.fx-folder-n');
			el.textContent = k ? String(k) : '';
		}
	}
	const hiddenGrp = (c) => c.def.group === 'Видео' || c.def.group === 'Фото и видео' || c.def.group === 'Персонаж';
	select_((cards.find((c) => c.L.on && !hiddenGrp(c)) || cards.find((c) => !hiddenGrp(c)) || cards[0]).def.id);
	// ------------------------------------------------------------ звук
	const sourceSeg = segmented({
		options: [
			{ value: 'synth', label: 'Музыка', title: 'Встроенная музыка: эмбиент, джангл, брейккор' },
			{ value: 'file', label: 'Файл', title: 'Загрузить свой аудиофайл' },
			{ value: 'video', label: 'Видео', title: 'Звук из открытого видео' },
			{ value: 'mic', label: 'Микроф.', title: 'Живой звук с микрофона' },
		],
		value: engine.sourceType,
		onChange: async (v) => {
			sourceSeg.set(engine.sourceType);
			try {
				if (v === 'synth') await engine.useSynth();
				else if (v === 'file') fileInput.click();
				else if (v === 'video') await engine.useVideoAudio();
				else await engine.useMic();
			} catch (e) {
				console.error(e);
				app.toast(v === 'mic' ? 'Нет доступа к микрофону' : v === 'video' ? e.message : 'Не удалось включить звук: ' + (e.message || e), v === 'video' ? 'warn' : 'error');
			}
			sync();
		},
	});
	const fileInput = h('input', { type: 'file', accept: 'audio/*', hidden: true });
	fileInput.addEventListener('change', async () => {
		const f = fileInput.files && fileInput.files[0];
		fileInput.value = '';
		if (!f) return;
		try {
			await engine.loadFile(f);
		} catch (e) {
			app.toast('Не удалось прочитать аудиофайл', 'error');
		}
		sync();
	});
	document.body.append(fileInput);
	const style = select({ options: SYNTH_STYLES.map((s) => ({ value: s.id, label: s.name })), value: st.audio.style, onChange: (v) => engine.useSynth(v).then(sync) });
	const styleRow = field('Стиль', style.el);
	const gain = slider({ min: 0.3, max: 3, step: 0.05, value: st.audio.gain, digits: 2, onInput: (v) => { st.audio.gain = v; }, onChange: save });
	const volume = slider({ min: 0, max: 1, step: 0.05, value: st.audio.volume, format: (v) => Math.round(v * 100) + '%', onInput: (v) => engine.setVolume(v) });
	const idle = switchRow('Живая сцена без звука', { value: st.audio.idle, onChange: (v) => { st.audio.idle = v; st.audio.idleSet = true; save(); } });
	const meters = makeMeters();
	// какие эффекты сейчас слушают звук: клик по строке открывает настройки эффекта
	const reactList = h('div', { class: 'fx-react-list' });
	const reactTitle = h('div', { class: 'fx-sub' }, 'Что реагирует на звук');
	// реакция всей сцены: яркость пульсирует в такт выбранным частотам
	const sceneBand = segmented({ cls: 'seg-tight', options: BANDS.filter((x) => ['bass', 'mid', 'high', 'beat'].includes(x.id)).map((x) => ({ value: x.id, label: x.label, title: x.title })), value: st.look.audioBand || 'bass', onChange: (v) => { st.look.audioBand = v; save(); } });
	const sceneBright = slider({ min: 0, max: 1, step: 0.05, value: st.look.brightAudio || 0, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.brightAudio = v; }, onChange: save });
	const sceneTitle = h('div', { class: 'fx-sub' }, 'Вся сцена');
	const secAudio = section('Звук', { key: 'fx-audio' }, idle.el, sourceSeg.el, styleRow, meters.el, field('Чувствительность', gain.el), field('Громкость', volume.el), reactTitle, reactList, sceneTitle, field('Слушает', sceneBand.el, { wide: true }), field('Яркость в такт', sceneBright.el));
	/** Список эффектов, которые слушают звук: у каждого свои частоты и сила реакции, эффекты можно добавлять и убирать прямо здесь */
	function renderReactList() {
		sceneBand.set(st.look.audioBand || 'bass');
		sceneBright.set(st.look.brightAudio || 0);
		const act = cards.filter((c) => c.L.on && c.L.band !== 'none');
		const idle_ = cards.filter((c) => !(c.L.on && c.L.band !== 'none') && c.L.band !== undefined);
		reactList.textContent = '';
		reactTitle.hidden = false;
		for (const c of act) {
			const L = c.L;
			const bandSeg = segmented({
				cls: 'seg-tight',
				options: BANDS.filter((x) => x.id !== 'none' && (x.id !== 'custom' || L.band === 'custom')).map((x) => ({ value: x.id, label: x.id === 'custom' ? `${engine.hzAt(L.lo)}–${engine.hzAt(L.hi)} Гц` : x.label, title: x.title })),
				value: L.band,
				onChange: (v) => {
					L.band = v;
					save();
					engine.emit();
				},
			});
			const power = slider({
				min: 0,
				max: 1,
				step: 0.05,
				value: L.react || 0,
				format: (v) => Math.round(v * 100) + '%',
				onInput: (v) => {
					L.react = v;
					if (L.amode === 'gate') return;
				},
				onChange: () => {
					save();
					engine.emit();
				},
			});
			const off = iconButton({
				icon: 'x',
				title: 'Больше не слушать звук',
				cls: 'fx-react-off',
				onClick: () => {
					L.band = 'none';
					save();
					engine.emit();
				},
			});
			const name = h('button', { type: 'button', class: 'fx-react-name' }, c.def.name);
			name.addEventListener('click', () => {
				select_(c.def.id);
				showFxTab('insp');
			});
			reactList.append(h('div', { class: 'fx-react-card' }, h('div', { class: 'fx-react-head' }, name, off), bandSeg.el, field('Сила реакции', power.el)));
		}
		if (!act.length) reactList.append(h('div', { class: 'field-hint' }, 'Пока ни один эффект не слушает звук. Добавьте эффект ниже и выберите частоты: бас, середину, верх или удар.'));
		if (idle_.length) {
			const pick = select({
				options: [{ value: '', label: 'Добавить эффект…' }, ...idle_.map((c) => ({ value: c.def.id, label: c.def.name + (c.L.on ? '' : ' (выключен)') }))],
				value: '',
				onChange: (v) => {
					const c = cards.find((x) => x.def.id === v);
					if (!c) return;
					c.L.on = true;
					c.L.band = 'bass';
					if (!c.L.react) c.L.react = 0.7;
					save();
					engine.emit();
				},
			});
			reactList.append(pick.el);
		}
	}

	// ------------------------------------------------------------ вид
	const palettes = h('div', { class: 'fx-palettes', role: 'radiogroup', 'aria-label': 'Палитра' });
	const palBtns = new Map();
	for (const p of FX_PALETTES) {
		const b = h('button', { type: 'button', class: 'fx-pal', role: 'radio', 'aria-label': p.name, 'data-tip': p.name, style: { background: `linear-gradient(90deg, ${p.c[0]}, ${p.c[1]}, ${p.c[2]})` } });
		b.addEventListener('click', () => {
			st.look.palette = p.id;
			if (st.look.colorBy === 'model') st.look.colorBy = 'disp';
			engine._userColor = true;
			sync();
			save();
		});
		palBtns.set(p.id, b);
		palettes.append(b);
	}
	// вид точек общий с вкладкой «Точки»: одни и те же настройки, без дублей
	const colorBy = select({ options: COLOR_BY_UI.map((c) => ({ value: c.id, label: c.label })), value: st.look.colorBy, onChange: (v) => { engine.setColorBy(v); } });
	const shapeTiles = h('div', { class: 'shape-grid shape-row', role: 'radiogroup', 'aria-label': 'Форма точек' });
	const shapeBtns = new Map();
	for (const sh of POINT_SHAPE_LIST) {
		const b = h('button', { type: 'button', class: 'shape-tile', role: 'radio', 'data-shape': sh.value }, h('span', { class: 'shape-glyph' }), h('span', { class: 'shape-name' }, sh.label));
		b.dataset.tip = sh.label;
		b.addEventListener('click', () => {
			pset.shape = sh.value;
			st.look.glyph = 'off';
			app.saveSettings();
			save();
			sync();
		});
		shapeBtns.set(sh.value, b);
		shapeTiles.append(b);
	}
	// символы вместо точек: те же плитки, что и формы
	for (const g of [{ id: 'ascii', label: 'Символы ASCII: знаки и буквы', ch: '#@' }, { id: 'letters', label: 'Латинские буквы', ch: 'Aa' }, { id: 'digits', label: 'Цифры', ch: '01' }, { id: 'blocks', label: 'Блоки', ch: '▒█' }]) {
		const b = h('button', { type: 'button', class: 'shape-tile', role: 'radio', 'data-shape': g.id, 'data-tip': g.label }, h('span', { class: 'shape-glyph shape-char' }, g.ch), h('span', { class: 'shape-name' }, g.label));
		b.addEventListener('click', () => {
			st.look.glyph = g.id;
			save();
			sync();
		});
		shapeBtns.set(g.id, b);
		shapeTiles.append(b);
	}
	const solidPick = colorField({ value: pset.solidColor, onInput: (v) => { pset.solidColor = v; }, onChange: () => app.saveSettings() });
	const solidRow = field('Свой цвет', solidPick.el);
	const origBtn = button({ label: 'Исходный цвет модели', icon: 'arrow-counter-clockwise', variant: 'secondary', cls: 'btn-block', title: 'Вернуть настоящие цвета и текстуру модели вместо палитры', onClick: () => engine.setColorBy('model') });
	// сохранение зацикленной анимации
	const anim = { format: 'gif', seconds: 4 };
	const animFmt = segmented({ options: [{ value: 'gif', label: 'GIF', title: 'Зацикленная анимация, открывается везде' }, { value: 'mp4', label: 'MP4 со звуком', title: 'Видео в хорошем качестве, открывается везде' }], value: anim.format, onChange: (v) => { anim.format = v; } });
	const animSec = slider({ min: 1, max: 15, step: 1, value: anim.seconds, digits: 0, unit: ' с', onInput: (v) => { anim.seconds = v; } });
	const animBtn = button({ label: 'Записать и сохранить', icon: 'record', variant: 'primary', cls: 'btn-block', onClick: () => engine.saveAnimation({ format: anim.format, seconds: anim.seconds }) });
	const animInfo = h('div', { class: 'field-hint' }, 'Запишется то, что сейчас видно на сцене, вместе со всеми эффектами.');
	const rset = app.settings.render;
	const autoQ = switchRow('Авто-качество', { value: rset.autoQuality, onChange: (v) => { rset.autoQuality = v; app.saveSettings(); } });
	const capSeg = segmented({ cls: 'seg-tight', options: [{ value: 0, label: 'Без лимита' }, { value: 30, label: '30 к/с', title: 'Вдвое меньше нагрузка на видеокарту и нагрев' }], value: rset.fpsCap, onChange: (v) => { rset.fpsCap = Number(v); app.saveSettings(); } });
	const perfHint = h('div', { class: 'field-hint' }, 'Авто-качество снижает чёткость, только пока компьютеру не хватает кадров, и возвращает её, когда запас появляется. Эффекты и цвета не меняются.');
	const hudSw = switchRow('Индикаторы уровней звука', { value: st.look.hud, onChange: (v) => { st.look.hud = v; save(); } });
	const hudSpec = switchRow('Спектр внизу', { value: st.look.hudSpectrum, onChange: (v) => { st.look.hudSpectrum = v; save(); } });
	const attSw = switchRow('Мельче вдали', { value: pset.attenuate, onChange: (v) => { pset.attenuate = v; app.saveSettings(); } });
	const sizeNoise = slider({ min: 0, max: 2, step: 0.05, value: st.look.sizeNoise || 0, digits: 2, onInput: (v) => { st.look.sizeNoise = v; }, onChange: save });
	const sizeAudio = slider({ min: 0, max: 2, step: 0.05, value: st.look.sizeAudio || 0, digits: 2, onInput: (v) => { st.look.sizeAudio = v; }, onChange: save });
	const shade = slider({ min: 0, max: 1, step: 0.05, value: st.look.shade || 0, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.shade = v; }, onChange: save });
	const glow = slider({ min: 0, max: 1, step: 0.05, value: st.look.glow, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.glow = v; }, onChange: save });
	const bright = slider({ min: 0.3, max: 2, step: 0.05, value: st.look.bright, digits: 2, onInput: (v) => { st.look.bright = v; }, onChange: save });
	const bloom = slider({ min: 0, max: 1, step: 0.05, value: st.look.bloom || 0, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.bloom = v; }, onChange: save });
	const aberration = slider({ min: 0, max: 1, step: 0.05, value: st.look.aberration || 0, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.aberration = v; }, onChange: save });
	const dofOn = switchRow('Глубина резкости (DoF)', { value: st.look.dofOn || false, onChange: (v) => { st.look.dofOn = v; syncDof(); save(); } });
	const dofDist = slider({ min: 1.5, max: 10, step: 0.1, value: st.look.dofDist || 5.2, digits: 1, unit: ' м', onInput: (v) => { st.look.dofDist = v; }, onChange: save });
	const dofRange = slider({ min: 0.2, max: 3, step: 0.1, value: st.look.dofRange || 1.4, digits: 1, unit: ' м', onInput: (v) => { st.look.dofRange = v; }, onChange: save });
	const dofBody = h('div', { class: 'sec-body', style: { padding: 0 } }, field('Дистанция фокуса', dofDist.el), field('Глубина фокуса', dofRange.el));
	const syncDof = () => { dofBody.hidden = !st.look.dofOn; };
	syncDof();
	const blend = segmented({ options: [{ value: 'normal', label: 'Плотные', title: 'Непрозрачные точки' }, { value: 'add', label: 'Свечение', title: 'Точки складывают свет: ярче в плотных местах' }], value: st.look.blend, onChange: (v) => { st.look.blend = v; save(); } });
	const rotate = switchRow('Вращать форму', { value: st.look.autoRotate, onChange: (v) => { st.look.autoRotate = v; save(); syncRotate(); } });
	const rotSpeed = slider({ min: 0.05, max: 1.5, step: 0.05, value: st.look.rotSpeed, digits: 2, onInput: (v) => { st.look.rotSpeed = v; }, onChange: save });
	const rotSpeedRow = field('Скорость вращения', rotSpeed.el);
	const syncRotate = () => { rotSpeedRow.hidden = !st.look.autoRotate; };
	const animTimelineOpenBtn = button({
		label: 'Открыть секвенсор анимации',
		icon: 'film-strip',
		variant: 'primary',
		cls: 'btn-block',
		title: 'Открыть мультитрековый таймлайн анимации',
		onClick: () => toggleAnim(true)
	});
	const secLook = section('Вид', { key: 'fx-look' }, palettes, origBtn, field('Форма точек и символы', shapeTiles, { wide: true }), attSw.el, field('Цвет точек', colorBy.el), solidRow, field('Объём (тень)', shade.el), field('Размер по шуму', sizeNoise.el), field('Размер по звуку', sizeAudio.el), field('Свечение', glow.el), field('Яркость', bright.el), field('Блум (свечение)', bloom.el), field('Хром. аберрация', aberration.el), dofOn.el, dofBody, field('Точки', blend.el, { wide: true }), rotate.el, rotSpeedRow, hudSw.el, hudSpec.el, h('div', { class: 'fx-sub' }, 'Производительность'), autoQ.el, field('Лимит кадров', capSeg.el, { wide: true }), perfHint, h('div', { class: 'fx-sub' }, 'Секвенсор и запись анимации'), animTimelineOpenBtn, field('Формат', animFmt.el, { wide: true }), field('Длина', animSec.el), animBtn, animInfo);

	const secMedia = createMediaPanel(app, null, { fx: true }).section;
	// вкладки-плашки вместо длинного списка: Эффект, Форма, Медиа, Зона, Звук, Вид
	const FX_TABS = [['insp', 'Эффект', 'sparkle', [secInsp]], ['source', 'Форма', 'cube', [secSource, createAnimPanel(app, 'fx'), secMorph, secMedia]], ['zone', 'Звук', 'equalizer', [secAudio]], ['look', 'Вид', 'sliders-horizontal', [secLook]]];
	const tabBar = h('div', { class: 'fx-tabs', role: 'tablist', 'aria-label': 'Разделы настроек' });
	let curTab = 'insp';
	try {
		curTab = localStorage.getItem('objglb.fx.tab') || 'insp';
	} catch (_) {}
	const tabBtns = new Map();
	const showFxTab = (id) => {
		curTab = FX_TABS.some((t) => t[0] === id) ? id : 'insp';
		for (const [k, , , secs] of FX_TABS) {
			secs.forEach((sec) => (sec.el.hidden = k !== curTab));
			tabBtns.get(k).setAttribute('aria-selected', String(k === curTab));
		}
		try {
			localStorage.setItem('objglb.fx.tab', curTab);
		} catch (_) {}
	};
	for (const [k, label, ic] of FX_TABS) {
		const b = h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'false' }, h('span', { class: 'ic', html: icon(ic, 15) }), h('span', { class: 'tab-label' }, label));
		b.addEventListener('click', () => showFxTab(k));
		tabBtns.set(k, b);
		tabBar.append(b);
	}
	root.append(tabBar, ...FX_TABS.flatMap((t) => t[3].map((x) => x.el)));
	showFxTab(curTab);
	// при выборе эффекта слева сразу показываем его настройки
	fxTabHook = () => showFxTab('insp');

	// ------------------------------------------------------------ нижняя панель в сцене
	const bar = $bar();
	const playBtn = iconButton({ icon: 'speaker-high', title: 'Звук: включить или выключить (Пробел)', onClick: () => engine.toggle().catch(() => {}) });
	const collapseBtn = iconButton({ icon: 'atom', title: 'Разрушить / собрать форму («Распад»)', onClick: () => { engine.toggleCollapse(); sync(); } });
	// режим «только сцена»: прячет всё, кроме самой анимации и этой панели; Esc возвращает интерфейс
	const appEl = document.getElementById('app');
	const focusBtn = iconButton({ icon: 'corners-out', title: 'Только сцена: скрыть интерфейс (Esc вернёт)', onClick: () => setFocus(!appEl.classList.contains('fx-focus')) });
	function setFocus(on) {
		appEl.classList.toggle('fx-focus', on);
		focusBtn.classList.toggle('is-active', on);
		if (on) app.toast('Интерфейс скрыт. Esc или эта же кнопка вернут его', 'info');
	}
	app.ui.exitFxFocus = () => setFocus(false);
	const orthoBtn = iconButton({ icon: 'perspective', title: 'Проекция: перспектива или ортогональная', onClick: () => { app.nav.toggleOrtho(); sync(); } });
	const camBtn = iconButton({ icon: 'video-camera', title: 'Камера: управление руками и пальцами', onClick: () => engine.toggleMotionCam().then(sync) });
	const barMeters = makeMeters(true);
	const recBtn = iconButton({ icon: 'record', title: 'Записать видео со звуком (MP4)', cls: 'fx-rec', onClick: () => (engine.recording ? engine.stopRecording() : engine.startRecording()) });
	const recTime = h('span', { class: 'fx-rec-time' });
	// ------------------------------------------------------------ анимация по ключам и блокам эффектов (секвенсор)
	const animPanel = h('div', { class: 'fx-anim vp-pill', hidden: true, role: 'region', 'aria-label': 'Секвенсор анимации' });
	const resizeHandle = h('div', { class: 'fx-anim-resize-handle', title: 'Потяните для изменения высоты таймлайна (двойной клик сбросит)' });
	let curH = 245;
	try {
		const savedH = Number(localStorage.getItem('objglb.fx.anim.h'));
		if (savedH >= 170 && savedH <= 480) curH = savedH;
	} catch (_) {}
	document.documentElement.style.setProperty('--fx-anim-h', curH + 'px');

	/** Выше естественной высоты содержимого таймлайн тянуть нельзя: иначе внизу остаётся пустая серая зона */
	function maxAnimH() {
		const body = animPanel.querySelector('.fx-anim-body');
		if (!body || animPanel.hidden) return 480;
		const kids = [...body.children].filter((el) => !el.hidden && el.offsetHeight > 0);
		const gap = parseFloat(getComputedStyle(body).rowGap) || 0;
		const natural = kids.reduce((a, el) => a + el.offsetHeight, 0) + gap * Math.max(0, kids.length - 1);
		const chrome = animPanel.offsetHeight - body.clientHeight;
		return Math.max(150, Math.min(480, Math.ceil(chrome + natural)));
	}
	function clampAnimH() {
		const m = maxAnimH();
		if (curH > m) {
			curH = m;
			document.documentElement.style.setProperty('--fx-anim-h', curH + 'px');
		}
	}
	let isResizingH = false;
	let resizeStartY = 0;
	let resizeStartH = 245;
	resizeHandle.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		isResizingH = true;
		resizeStartY = e.clientY;
		resizeStartH = curH;
		resizeHandle.setPointerCapture(e.pointerId);
		document.body.classList.add('is-resizing-h');
		const onMove = (ev) => {
			if (!isResizingH) return;
			const dy = resizeStartY - ev.clientY;
			curH = Math.max(150, Math.min(480, Math.round(resizeStartH + dy)));
			curH = Math.min(curH, maxAnimH());
			document.documentElement.style.setProperty('--fx-anim-h', curH + 'px');
		};
		const onUp = () => {
			isResizingH = false;
			document.body.classList.remove('is-resizing-h');
			resizeHandle.removeEventListener('pointermove', onMove);
			resizeHandle.removeEventListener('pointerup', onUp);
			resizeHandle.removeEventListener('pointercancel', onUp);
			try { localStorage.setItem('objglb.fx.anim.h', curH); } catch (_) {}
		};
		resizeHandle.addEventListener('pointermove', onMove);
		resizeHandle.addEventListener('pointerup', onUp);
		resizeHandle.addEventListener('pointercancel', onUp);
	});
	resizeHandle.addEventListener('dblclick', () => {
		curH = 245;
		document.documentElement.style.setProperty('--fx-anim-h', '245px');
		try { localStorage.setItem('objglb.fx.anim.h', 245); } catch (_) {}
	});

	const keyAnimBtn = button({
		label: 'Анимация',
		icon: 'film-strip',
		variant: 'secondary',
		cls: 'fx-bar-anim-btn',
		title: 'Секвенсор анимации: таймлайн эффектов и ключи камеры',
		onClick: () => toggleAnim()
	});

	let selKey = null;
	let selClip = null;
	let isScrubbing = false;
	let isDraggingItem = false;
	let lastRenderSig = '';

	const formatTimecode = (sec) => {
		const s = Math.max(0, sec || 0);
		const m = Math.floor(s / 60);
		const rem = (s % 60).toFixed(1);
		const mm = String(m).padStart(2, '0');
		const ss = rem < 10 ? '0' + rem : rem;
		return `${mm}:${ss}`;
	};

	// 1. Верхняя панель управления (Header Toolbar)
	const aPlay = iconButton({
		icon: 'play',
		title: 'Воспроизведение / Пауза (Пробел)',
		cls: 'fx-anim-play',
		onClick: () => {
			if (engine.animPlaying) engine.animPause();
			else if (!engine.animPlay()) app.toast('Добавьте минимум один блок эффекта или два ключа камеры', 'info');
		}
	});
	const aRew = iconButton({
		icon: 'arrow-counter-clockwise',
		title: 'В начало (0.0 с)',
		cls: 'fx-anim-rew',
		onClick: () => {
			engine.animSeek(0);
			animSync();
		}
	});
	const aTimeCur = h('span', { class: 'fx-anim-t-cur' }, '00:00.0');
	const aTimeSep = h('span', { class: 'fx-anim-t-sep' }, '/');
	const aTimeTotal = h('span', { class: 'fx-anim-t-total' }, '00:08.0');
	const aTimecode = h('div', { class: 'fx-anim-timecode' }, aTimeCur, aTimeSep, aTimeTotal);

	// Зум времени: шкала растягивается шире окна и прокручивается по горизонтали; Ctrl или Cmd + колесо (и щипок на тачпаде) тоже зумят
	let animZoom = 1;
	const ZMIN = 1;
	const ZMAX = 24;
	const zoomBtnOut = iconButton({
		icon: 'minus',
		title: 'Уменьшить масштаб шкалы времени (Ctrl + колесо)',
		size: 11,
		cls: 'fx-anim-zoom-btn',
		onClick: () => setZoom(animZoom / 1.6)
	});
	const zoomVal = h('span', { class: 'fx-anim-zoom-val' }, '1x');
	const zoomBtnIn = iconButton({
		icon: 'plus',
		title: 'Увеличить масштаб шкалы времени (Ctrl + колесо)',
		size: 11,
		cls: 'fx-anim-zoom-btn',
		onClick: () => setZoom(animZoom * 1.6)
	});
	const zoomBox = h('div', { class: 'fx-anim-zoom-box', title: 'Масштаб шкалы времени. Двойной клик возвращает 1x' }, zoomBtnOut, zoomVal, zoomBtnIn);
	zoomVal.addEventListener('dblclick', () => setZoom(1));

	/** Масштаб шкалы. anchor: { t, x } время и положение курсора, которые должны остаться на месте (по умолчанию маркер) */
	function setZoom(z, anchor) {
		z = Math.max(ZMIN, Math.min(ZMAX, z));
		const dur = st.anim.dur || 8;
		const headW = parseFloat(getComputedStyle(stage).getPropertyValue('--fx-head-w')) || 130;
		const viewW = stage.clientWidth - headW;
		const t = anchor ? anchor.t : engine.animT;
		const xInView = anchor ? anchor.x : Math.max(0, Math.min(viewW, (t / dur) * viewW * animZoom - stage.scrollLeft));
		animZoom = z;
		zoomVal.textContent = (Math.round(z * 10) / 10) + 'x';
		stage.style.setProperty('--fx-anim-zoom', z);
		stage.classList.toggle('is-zoomed', z > 1);
		// время под курсором остаётся под курсором
		stage.scrollLeft = Math.max(0, (t / dur) * viewW * z - xInView);
		renderRuler();
		animSync();
	}

	const aTransport = h('div', { class: 'fx-anim-transport' }, aPlay, aTimecode, zoomBox);

	// Встроенная интерактивная полка сценариев и добавления эффектов
	const shelf = h('div', { class: 'fx-anim-shelf', hidden: true });
	let currentShelf = null;

	const closeShelf = () => {
		shelf.hidden = true;
		currentShelf = null;
		presetsBtn.classList.remove('is-active');
		addClipBtn.classList.remove('is-active');
	};

	const presetItems = [
		{ id: 'dust_rebirth', icon: 'sparkle', label: 'Рождение из пыли', hint: 'Растворение → Вихри → Пульс' },
		{ id: 'scan_collapse', icon: 'scan', label: 'Лазерный скан и распад', hint: 'Срез → Связи → Глитч → Блум' },
		{ id: 'glitch_morph', icon: 'lightning', label: 'Кибер-глитч и морфинг', hint: 'Глитч → Морфинг → Взрыв → Блум' },
	];

	function openPresetsShelf() {
		if (currentShelf === 'presets' && !shelf.hidden) {
			closeShelf();
			return;
		}
		currentShelf = 'presets';
		presetsBtn.classList.add('is-active');
		addClipBtn.classList.remove('is-active');

		const head = h('div', { class: 'fx-anim-shelf-head' },
			h('span', { class: 'fx-anim-shelf-title' }, 'Готовые сценарии анимации'),
			h('span', { class: 'fx-anim-shelf-hint' }, 'Режиссерская последовательность эффектов и ракурсов'),
			iconButton({ icon: 'x', title: 'Закрыть панель (Esc)', size: 12, cls: 'fx-anim-shelf-close', onClick: closeShelf })
		);

		const grid = h('div', { class: 'fx-anim-shelf-presets' });
		for (const p of presetItems) {
			const b = h('button', { type: 'button', class: 'fx-anim-shelf-card' },
				h('span', { class: 'fx-anim-shelf-card-icon', html: icon(p.icon, 18) }),
				h('div', { class: 'fx-anim-shelf-card-text' },
					h('span', { class: 'fx-anim-shelf-card-title' }, p.label),
					h('span', { class: 'fx-anim-shelf-card-hint' }, p.hint)
				)
			);
			b.addEventListener('click', () => {
				engine.animLoadPreset(p.id);
				selKey = null;
				selClip = null;
				closeShelf();
				app.toast(`Загружен сценарий «${p.label}»`, 'success');
				animSync();
			});
			grid.append(b);
		}

		const clearBtn = h('button', { type: 'button', class: 'fx-anim-shelf-card is-danger' },
			h('span', { class: 'fx-anim-shelf-card-icon', html: icon('trash', 18) }),
			h('div', { class: 'fx-anim-shelf-card-text' },
				h('span', { class: 'fx-anim-shelf-card-title' }, 'Очистить таймлайн'),
				h('span', { class: 'fx-anim-shelf-card-hint' }, 'Удалить все блоки эффектов и ключи')
			)
		);
		clearBtn.addEventListener('click', () => {
			engine.animClear();
			selKey = null;
			selClip = null;
			closeShelf();
			app.toast('Таймлайн очищен', 'info');
			animSync();
		});
		grid.append(clearBtn);

		shelf.replaceChildren(head, grid);
		shelf.hidden = false;
	}

	function openEffectsShelf() {
		if (currentShelf === 'effects' && !shelf.hidden) {
			closeShelf();
			return;
		}
		currentShelf = 'effects';
		addClipBtn.classList.add('is-active');
		presetsBtn.classList.remove('is-active');

		const head = h('div', { class: 'fx-anim-shelf-head' },
			h('span', { class: 'fx-anim-shelf-title' }, 'Добавить слой на таймлайн'),
			h('span', { class: 'fx-anim-shelf-hint' }, 'Выберите эффект для добавления блока на шкалу времени:'),
			iconButton({ icon: 'x', title: 'Закрыть панель (Esc)', size: 12, cls: 'fx-anim-shelf-close', onClick: closeShelf })
		);

		const chips = h('div', { class: 'fx-anim-shelf-chips' });
		for (const id of ANIM_LAYERS) {
			const l = getLayerDef(id);
			const b = h('button', { type: 'button', class: 'fx-anim-shelf-chip', 'data-tip': l.hint },
				h('span', { class: 'ic-wrap', html: icon(l.icon || 'sparkle', 14) }),
				h('span', {}, l.name)
			);
			b.addEventListener('click', () => {
				const clip = engine.animAddClip(l.id);
				selClip = clip;
				selKey = null;
				closeShelf();
				app.toast(`Добавлен блок: ${l.name}`, 'info');
				animSync();
			});
			chips.append(b);
		}

		shelf.replaceChildren(head, chips);
		shelf.hidden = false;
	}

	const presetsBtn = button({
		label: 'Сценарии',
		icon: 'sparkle',
		variant: 'secondary',
		cls: 'btn-sm fx-anim-presets-btn',
		title: 'Готовые режиссерские сценарии',
		onClick: (e) => {
			e.stopPropagation();
			openPresetsShelf();
		}
	});

	const addClipBtn = button({
		label: 'Эффект',
		icon: 'plus',
		variant: 'primary',
		cls: 'btn-sm fx-anim-add-btn',
		title: 'Добавить блок эффекта на дорожку',
		onClick: (e) => {
			e.stopPropagation();
			openEffectsShelf();
		}
	});

	// понятная кнопка камеры: повернули сцену как нужно, нажали, и ракурс записан в текущий момент времени
	const addCamKey = () => {
		selKey = engine.animAddKey();
		selClip = null;
		animSync();
		app.toast('Ракурс камеры записан на ' + engine.animT.toFixed(1) + ' с', 'info', 1600);
	};
	const camKeyBtn = button({
		label: 'Ракурс',
		icon: 'video-camera',
		variant: 'secondary',
		cls: 'btn-sm fx-anim-cam-btn',
		title: 'Запомнить текущий ракурс камеры в момент времени, где стоит маркер (C). Повернули сцену, нажали, и камера будет возвращаться сюда',
		onClick: (e) => {
			e.stopPropagation();
			addCamKey();
		}
	});
	const quickWrap = h('div', { class: 'fx-anim-quick' }, presetsBtn, addClipBtn, camKeyBtn);

	// Настройки справа: loop, dur, record, close
	const aLoop = iconButton({
		icon: 'repeat',
		title: 'Повторять по кругу',
		cls: 'fx-anim-loop' + (st.anim.loop ? ' is-active' : ''),
		onClick: () => {
			st.anim.loop = !st.anim.loop;
			save();
			animSync();
		}
	});
	const aDur = h('input', {
		type: 'number',
		class: 'num-in fx-anim-dur',
		min: 1,
		max: 120,
		step: 1,
		value: st.anim.dur || 8,
		'aria-label': 'Длина анимации, секунд',
		'data-tip': 'Длина анимации, секунд'
	});
	aDur.addEventListener('change', () => {
		engine.animSetDuration(Number(aDur.value) || 8);
		animSync();
	});
	const aDurBox = h('div', { class: 'fx-anim-dur-box' }, aDur, h('span', { class: 'fx-anim-dur-unit' }, 'с'));
	// свои кнопки «больше / меньше» справа от секунд: клик меняет на 1, Shift на 5, удержание повторяет
	const stepDur = (dir, big) => {
		const v = Math.max(1, Math.min(120, Math.round((Number(aDur.value) || 8) + dir * (big ? 5 : 1))));
		aDur.value = v;
		fitDur();
		engine.animSetDuration(v);
		animSync();
	};
	const mkStep = (dir, name) => {
		const b = h('button', { type: 'button', class: 'fx-anim-step', 'aria-label': dir > 0 ? 'Длиннее на секунду' : 'Короче на секунду', 'data-tip': (dir > 0 ? 'Длиннее' : 'Короче') + ' на 1 с (Shift: на 5 с, удержание повторяет)', html: icon(name, 11) });
		let t1 = 0;
		let t2 = 0;
		const stop = () => {
			clearTimeout(t1);
			clearInterval(t2);
		};
		b.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			stepDur(dir, e.shiftKey);
			t1 = setTimeout(() => {
				t2 = setInterval(() => stepDur(dir, e.shiftKey), 70);
			}, 380);
		});
		for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
		return b;
	};
	aDurBox.append(h('span', { class: 'fx-anim-stepper' }, mkStep(1, 'caret-up'), mkStep(-1, 'caret-down')));
	// ширина поля по числу цифр: «с» всегда стоит сразу после числа
	const fitDur = () => aDurBox.style.setProperty('--dur-w', Math.max(1, String(aDur.value || '').length) + 'ch');
	aDur.addEventListener('input', fitDur);
	fitDur();
	const aRec = button({
		label: 'Записать',
		icon: 'record',
		variant: 'secondary',
		cls: 'btn-sm fx-anim-rec-btn',
		title: 'Проиграет анимацию один раз и запишет чистое MP4-видео со звуком',
		size: 14,
		onClick: () => {
			if (!engine.animRecord()) app.toast('Добавьте минимум один блок эффекта или два ключа камеры', 'info');
		}
	});
	const aClose = iconButton({
		icon: 'x',
		title: 'Закрыть анимацию',
		cls: 'fx-anim-close',
		onClick: () => toggleAnim(false)
	});
	// магнит: блоки прилипают к маркеру, краям соседних блоков и целым секундам; Alt при перетаскивании отключает на время
	const aSnap = iconButton({
		icon: 'magnet',
		title: 'Магнит: блоки прилипают к маркеру, краям других блоков и целым секундам (Alt при перетаскивании отключает)',
		cls: 'fx-anim-snap' + (st.anim.snap !== false ? ' is-active' : ''),
		onClick: () => {
			st.anim.snap = st.anim.snap === false;
			aSnap.classList.toggle('is-active', st.anim.snap !== false);
			save();
		}
	});
	/** Ближайшая «точка притяжения» к времени t; ignoreId исключает свой блок. Возвращает t без изменений, если рядом ничего нет */
	function snapTime(t, widthPx, ignoreId, ev) {
		if (st.anim.snap === false || (ev && ev.altKey)) return t;
		const dur = st.anim.dur || 8;
		const thr = (9 / Math.max(1, widthPx)) * dur;
		const pts = [0, dur, engine.animT];
		for (let i = 1; i < dur; i++) pts.push(i);
		for (const c of st.anim.clips || []) if (c.id !== ignoreId) pts.push(c.start, c.start + c.dur);
		let best = t;
		let bd = thr;
		for (const q of pts) {
			const d = Math.abs(q - t);
			if (d < bd) {
				bd = d;
				best = q;
			}
		}
		return best;
	}
	const aSettings = h('div', { class: 'fx-anim-settings' }, aSnap, aLoop, aDurBox, aRec);

	const topBar = h('div', { class: 'fx-anim-topbar' }, aTransport, quickWrap, aSettings);

	// 2. Область дорожек (Stage)
	const stage = h('div', { class: 'fx-anim-stage' });

	// Линейка времени
	const rulerTitle = h('div', { class: 'fx-anim-track-label fx-anim-ruler-title' }, 'Время');
	const rulerTicks = h('div', { class: 'fx-anim-ruler-ticks' });
	const rulerNeedle = h('div', { class: 'fx-anim-playhead-needle' });
	const rulerBody = h('div', { class: 'fx-anim-ruler-body' }, rulerTicks, rulerNeedle);
	const rulerRow = h('div', { class: 'fx-anim-ruler-row' }, rulerTitle, rulerBody);

	// Дорожка камеры
	const camTitle = h('div', { class: 'fx-anim-track-label fx-anim-cam-label' },
		h('span', { class: 'ic-wrap', html: icon('video-camera', 14) }),
		h('span', { class: 'fx-anim-lane-name' }, 'Камера')
	);
	const camKeysWrap = h('div', { class: 'fx-anim-keys' });
	const camLine = h('div', { class: 'fx-anim-cam-line' });
	const camTrackBody = h('div', { class: 'fx-anim-lane-body fx-anim-cam-body' }, camLine, camKeysWrap);
	const camLane = h('div', { class: 'fx-anim-lane fx-anim-cam-lane' }, camTitle, camTrackBody);

	// Дорожка персонажа: когда в клипе какие кости двигаются. Клип повторяется по кругу на всю длину таймлайна, поэтому полоса стоит под общей линейкой времени
	const charArrow = h('span', { class: 'ic-wrap fx-anim-char-arrow', html: icon('caret-right', 12) });
	const charSub = h('span', { class: 'fx-anim-char-sub' });
	const charTitle = h('div', { class: 'fx-anim-track-label fx-anim-char-label', role: 'button', tabindex: '0', 'data-tip': 'Яркость показывает, как сильно движется персонаж. Нажмите, чтобы увидеть отдельные кости', 'data-tip-pos': 'right' }, charArrow, h('span', { class: 'fx-anim-char-names' }, h('span', { class: 'fx-anim-lane-name' }, 'Персонаж'), charSub));
	const charCanvas = h('canvas', { class: 'fx-anim-char-canvas' });
	const charBody = h('div', { class: 'fx-anim-lane-body fx-anim-char-body', 'data-tip': 'Яркая полоса: кости движутся. Тёмная: персонаж почти стоит. Тонкие линии: начало нового повтора клипа', 'data-tip-pos': 'top' }, charCanvas);
	const charLane = h('div', { class: 'fx-anim-lane fx-anim-char-lane' }, charTitle, charBody);
	charLane.hidden = true;
	let charOpen = false;
	function drawChar() {
		const A = app.anim;
		charLane.hidden = !A.has;
		if (!A.has) return;
		const clip = A.clips[A.clipIndex];
		if (!clip) return;
		charSub.textContent = (clip.name || 'Клип') + ' · ' + clip.duration.toFixed(1) + ' с';
		let act;
		try {
			act = clipActivity(clip);
		} catch (e) {
			act = null;
		}
		// если по клипу нечего показать (нет дорожек костей), рисуем ровную полосу
		if (!act || !act.bones.length) act = { n: 2, total: new Float32Array([0.35, 0.35]), bones: [] };
		const rows = charOpen ? act.bones.slice(0, 12).map((b) => [b.name, b.vals]) : [['', act.total]];
		const rh = charOpen ? 15 : 22;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		const W = Math.max(200, Math.round((charBody.clientWidth || 600) * dpr));
		charCanvas.width = W;
		charCanvas.height = Math.round(rows.length * rh * dpr);
		charCanvas.style.height = rows.length * rh + 'px';
		const g = charCanvas.getContext('2d');
		const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e58a45';
		const durTotal = st.anim.dur || 8;
		const period = Math.max(0.05, clip.duration / Math.max(0.1, A.speed || 1));
		g.clearRect(0, 0, charCanvas.width, charCanvas.height);
		rows.forEach(([name, vals], r) => {
			const y0 = Math.round(r * rh * dpr), hh = Math.round((rh - 3) * dpr);
			// фон строки со скруглением и лёгким свечением активных мест
			g.save();
			g.beginPath();
			g.roundRect(0, y0, W, hh, Math.min(6 * dpr, hh / 2));
			g.clip();
			g.globalAlpha = 0.07;
			g.fillStyle = '#fff';
			g.fillRect(0, y0, W, hh);
			g.fillStyle = acc;
			for (let x = 0; x < W; x += 2) {
				const t = (x / W) * durTotal;
				const ph = (t % period) / period;
				const v = Math.pow(vals[Math.min(act.n - 1, Math.floor(ph * (act.n - 1)))], 0.75);
				if (v < 0.04) continue;
				g.globalAlpha = 0.18 + 0.82 * v;
				// выше активность, выше столбик: полоса читается и без цвета
				const bh = hh * (0.35 + 0.65 * v);
				g.fillRect(x, y0 + (hh - bh) / 2, 2.2, bh);
			}
			// начало каждого повтора клипа
			g.globalAlpha = 0.28;
			g.fillStyle = '#fff';
			for (let k = 1; k * period < durTotal; k++) g.fillRect(Math.round((k * period / durTotal) * W), y0, Math.max(1, dpr * 0.8), hh);
			g.restore();
			if (name) {
				g.globalAlpha = 0.95;
				g.fillStyle = '#fff';
				g.font = `${Math.round(9.5 * dpr)}px sans-serif`;
				g.textBaseline = 'middle';
				g.shadowColor = 'rgba(0,0,0,0.85)';
				g.shadowBlur = 3;
				g.fillText(name, 7 * dpr, y0 + hh / 2);
				g.shadowBlur = 0;
			}
		});
		g.globalAlpha = 1;
	}
	charTitle.addEventListener('click', () => {
		charOpen = !charOpen;
		charArrow.innerHTML = icon(charOpen ? 'caret-down' : 'caret-right', 12);
		charLane.classList.toggle('is-open', charOpen);
		drawChar();
		clampAnimH();
	});
	// клик и протяжка по полосе двигают общий курсор таймлайна
	let charDrag = false;
	const charSeek = (e) => {
		const r = charBody.getBoundingClientRect();
		const dur = st.anim.dur || 8;
		engine.animT = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
		engine.animApply(engine.animT);
		app.bus.emit('fxanim');
	};
	charBody.addEventListener('pointerdown', (e) => {
		charDrag = true;
		charBody.setPointerCapture(e.pointerId);
		engine.animPause();
		charSeek(e);
	});
	charBody.addEventListener('pointermove', (e) => charDrag && charSeek(e));
	charBody.addEventListener('pointerup', () => (charDrag = false));
	app.anim.onChange(drawChar);
	new ResizeObserver(() => drawChar()).observe(charBody);
	let lastCharDur = 0;

	// Дорожки эффектов
	const fxLanesWrap = h('div', { class: 'fx-anim-fx-lanes' });

	// Пустой баннер
	const emptyHint = h('div', { class: 'fx-anim-empty-hint' },
		h('span', { class: 'fx-anim-empty-text' }, 'На таймлайне пока нет эффектов. Выберите сценарий или добавьте эффект:'),
		h('div', { class: 'fx-anim-empty-actions' },
			button({ label: 'Рождение из пыли', icon: 'sparkle', variant: 'secondary', cls: 'btn-sm', onClick: () => { engine.animLoadPreset('dust_rebirth'); animSync(); } }),
			button({ label: 'Лазерный скан', icon: 'scan', variant: 'secondary', cls: 'btn-sm', onClick: () => { engine.animLoadPreset('scan_collapse'); animSync(); } }),
			button({ label: 'Кибер-глитч', icon: 'lightning', variant: 'secondary', cls: 'btn-sm', onClick: () => { engine.animLoadPreset('glitch_morph'); animSync(); } }),
			button({ label: '+ Морфинг', icon: 'cube', variant: 'primary', cls: 'btn-sm', onClick: () => { selClip = engine.animAddClip('morph'); animSync(); } }),
			button({ label: '+ Вихри', variant: 'primary', cls: 'btn-sm', onClick: () => { selClip = engine.animAddClip('curl'); animSync(); } }),
			button({ label: '+ Волны', variant: 'primary', cls: 'btn-sm', onClick: () => { selClip = engine.animAddClip('wave'); animSync(); } })
		)
	);

	const lanesScroll = h('div', { class: 'fx-anim-lanes-scroll' }, camLane, charLane, fxLanesWrap, emptyHint);
	const playheadLine = h('div', { class: 'fx-anim-playhead-line' });

	stage.append(rulerRow, lanesScroll, playheadLine);
	stage.addEventListener('scroll', () => stage.classList.toggle('is-scrolled', stage.scrollLeft > 2), { passive: true });
	// шаг и подписи линейки подбираются по реальной ширине: пересчёт при зуме, смене размера окна и открытии панели
	let rulerRaf = 0;
	new ResizeObserver(() => {
		cancelAnimationFrame(rulerRaf);
		rulerRaf = requestAnimationFrame(() => renderRuler());
	}).observe(rulerBody);
	// Ctrl или Cmd + колесо (на тачпаде это щипок) зумит шкалу вокруг курсора; без Ctrl колесо листает как обычно
	stage.addEventListener(
		'wheel',
		(e) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			const dur = st.anim.dur || 8;
			const headW = parseFloat(getComputedStyle(stage).getPropertyValue('--fx-head-w')) || 130;
			const r = stage.getBoundingClientRect();
			const x = Math.max(0, Math.min(stage.clientWidth - headW, e.clientX - r.left - headW));
			const viewW = stage.clientWidth - headW;
			const t = Math.max(0, Math.min(dur, ((stage.scrollLeft + x) / (viewW * animZoom)) * dur));
			setZoom(animZoom * Math.exp(-e.deltaY * 0.0022), { t, x });
		},
		{ passive: false }
	);

	// 3. Инспектор выбранного элемента (Inspector)
	const inspector = h('div', { class: 'fx-anim-inspector', hidden: true });

	const body = h('div', { class: 'fx-anim-body' }, shelf, stage, inspector);
	animPanel.append(resizeHandle, topBar, body);
	document.getElementById('viewport').append(animPanel);

	function timeFromPointer(e, targetEl, cachedRect) {
		const r = cachedRect || targetEl.getBoundingClientRect();
		const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
		return frac * (st.anim.dur || 8);
	}

	function bindScrubbing(el) {
		el.addEventListener('pointerdown', (e) => {
			if (e.target.closest('.fx-anim-key, .fx-anim-block, button, input')) return;
			e.preventDefault();
			engine.animPause();
			isScrubbing = true;
			el.setPointerCapture(e.pointerId);
			const rect = el.getBoundingClientRect();
			const t = timeFromPointer(e, el, rect);
			engine.animSeek(t);
			animSync();
			const onMove = (ev) => {
				if (!isScrubbing) return;
				engine.animSeek(timeFromPointer(ev, el, rect));
				animSync();
			};
			const onUp = () => {
				isScrubbing = false;
				el.removeEventListener('pointermove', onMove);
				el.removeEventListener('pointerup', onUp);
				el.removeEventListener('pointercancel', onUp);
				animSync();
			};
			el.addEventListener('pointermove', onMove);
			el.addEventListener('pointerup', onUp);
			el.addEventListener('pointercancel', onUp);
		});
	}

	bindScrubbing(rulerBody);
	bindScrubbing(camTrackBody);

	toggleAnim = function (on = animPanel.hidden) {
		animPanel.hidden = !on;
		keyAnimBtn.classList.toggle('is-active', on);
		animQuickBtn.classList.toggle('is-active', on);
		appEl.classList.toggle('fx-anim-active', on);
		if (!on) {
			engine.animPause();
			closeShelf();
		} else {
			if (!st.anim.keys?.length && !st.anim.clips?.length) {
				selKey = engine.animAddKey(0);
			}
			animSync();
		}
	};

	animAddFromInspector = function (layerId) {
		toggleAnim(true);
		const c = engine.animAddClip(layerId);
		selClip = c;
		selKey = null;
		animSync();
	};

	// Пауза анимации при вращении камеры в 3D
	document.getElementById('viewport').addEventListener('pointerdown', (e) => {
		if (engine.animPlaying && !engine.animRec && !e.target.closest('.fx-anim, .fx-bar, .popover')) {
			engine.animPause();
		}
	}, true);

	// Горячие клавиши (Space, Delete, Backspace, Escape)
	window.addEventListener('keydown', (e) => {
		if (animPanel.hidden) return;
		if (e.target.matches('input, textarea, select')) return;
		if (e.code === 'Space') {
			e.preventDefault();
			if (engine.animPlaying) engine.animPause();
			else if (!engine.animPlay()) app.toast('Добавьте минимум один блок эффекта или два ключа камеры', 'info');
		} else if (e.code === 'Delete' || e.code === 'Backspace') {
			if (selClip) {
				e.preventDefault();
				engine.animRemoveClip(selClip.id);
				selClip = null;
				animSync();
			} else if (selKey) {
				e.preventDefault();
				engine.animRemoveKey(selKey);
				selKey = null;
				animSync();
			}
		} else if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			addCamKey();
		} else if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			splitSelected();
		} else if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey) && selClip) {
			e.preventDefault();
			const cloned = engine.animDuplicateClip(selClip.id);
			if (cloned) selClip = cloned;
			animSync();
		} else if (e.code === 'Home' || e.code === 'End') {
			e.preventDefault();
			engine.animPause();
			engine.animSeek(e.code === 'Home' ? 0 : st.anim.dur || 8);
			animSync();
		} else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
			e.preventDefault();
			engine.animPause();
			const step = e.shiftKey ? 1 : 0.1;
			engine.animSeek(Math.max(0, Math.min(st.anim.dur || 8, engine.animT + (e.code === 'ArrowLeft' ? -step : step))));
			animSync();
		} else if (e.code === 'Escape') {
			if (!shelf.hidden) {
				closeShelf();
			} else if (selClip || selKey) {
				selClip = null;
				selKey = null;
				animSync();
			}
		}
	});

	/** Разрезает выбранный блок по маркеру времени на два: у первого остаётся вход, у второго выход */
	function splitSelected() {
		if (!selClip) {
			app.toast('Выберите блок на дорожке, потом поставьте маркер времени там, где резать', 'info');
			return;
		}
		const part = engine.animSplitClip(selClip.id, engine.animT);
		if (!part) {
			app.toast('Маркер времени должен стоять внутри выбранного блока', 'info');
			return;
		}
		selClip = part;
		animSync();
	}

	let inspSig = '';
	let inspRefs = null;
	function renderInspector() {
		const sig = selClip ? 'c:' + selClip.id : selKey ? 'k:' + selKey.t : '';
		// панель свойств пересобирается только при смене выбора: при каждом кадре воспроизведения и при перетаскивании ползунка трогаем лишь значения
		if (sig === inspSig && inspRefs) {
			inspRefs.update && inspRefs.update();
			return;
		}
		inspSig = sig;
		inspRefs = null;
		buildInspector();
	}
	function buildInspector() {
		inspector.textContent = '';
		if (selClip) {
			const c = selClip;
			const layerDef = getLayerDef(c.layerId);
			inspector.hidden = false;

			const mkSlider = (label, min, max, step, value, fmt, onInput) => {
				const inp = h('input', { type: 'range', class: 'range fx-anim-insp-range', min, max, step, value });
				const val = h('span', { class: 'fx-anim-insp-val' }, fmt(value));
				const fill = () => inp.style.setProperty('--p', (((Number(inp.value) - Number(inp.min)) / Math.max(1e-6, Number(inp.max) - Number(inp.min))) * 100).toFixed(1) + '%');
				fill();
				inp.addEventListener('input', () => {
					val.textContent = fmt(Number(inp.value));
					fill();
					onInput(Number(inp.value));
				});
				return {
					row: h('label', { class: 'fx-anim-insp-slider' }, h('span', { class: 'fx-anim-insp-lab' }, label), inp, val),
					set: (v, mx) => {
						if (mx !== undefined) inp.max = mx;
						if (document.activeElement !== inp) inp.value = v;
						val.textContent = fmt(Number(inp.value));
						fill();
					},
				};
			};
			const secFmt = (v) => v.toFixed(2) + ' с';
			const sFadeIn = mkSlider('Вход', 0, c.dur, 0.05, c.fadeIn, secFmt, (v) => engine.animUpdateClip(c.id, { fadeIn: v }));
			const sFadeOut = mkSlider('Выход', 0, c.dur, 0.05, c.fadeOut, secFmt, (v) => engine.animUpdateClip(c.id, { fadeOut: v }));
			const sAmt = mkSlider('Сила', 0.05, 2, 0.05, c.amount, (v) => v.toFixed(2), (v) => engine.animUpdateClip(c.id, { amount: v }));
			inspRefs = {
				update: () => {
					sFadeIn.set(c.fadeIn, c.dur);
					sFadeOut.set(c.fadeOut, c.dur);
					sAmt.set(c.amount);
				},
			};

			const dupBtn = iconButton({
				icon: 'copy',
				title: 'Дублировать блок',
				cls: 'btn-sm',
				onClick: () => {
					const cloned = engine.animDuplicateClip(c.id);
					if (cloned) selClip = cloned;
					animSync();
				}
			});

			const splitBtn = iconButton({
				icon: 'scissors',
				title: 'Разрезать блок по маркеру времени (S)',
				cls: 'btn-sm',
				onClick: () => splitSelected()
			});

			const delBtn = iconButton({
				icon: 'trash',
				title: 'Удалить блок',
				cls: 'btn-sm is-danger',
				onClick: () => {
					engine.animRemoveClip(c.id);
					selClip = null;
					animSync();
				}
			});

			const closeBtn = iconButton({
				icon: 'x',
				title: 'Снять выбор',
				cls: 'btn-sm',
				onClick: () => {
					selClip = null;
					animSync();
				}
			});

			inspector.append(sFadeIn.row, sFadeOut.row, sAmt.row, h('div', { class: 'fx-anim-insp-actions' }, splitBtn, dupBtn, delBtn, closeBtn));
		} else if (selKey) {
			const k = selKey;
			inspector.hidden = false;

			const inT = h('input', { type: 'number', class: 'num-in', min: 0, max: st.anim.dur || 8, step: 0.1, value: k.t });
			inT.addEventListener('change', () => {
				engine.animMoveKey(k, Number(inT.value) || 0);
				animSync();
			});

			const updBtn = button({
				label: 'Обновить ракурс',
				icon: 'arrow-clockwise',
				variant: 'secondary',
				cls: 'btn-sm',
				title: 'Перезаписать ключ текущим положением камеры',
				onClick: () => {
					engine.animUpdateKey(k);
					app.toast('Ключ обновлен', 'info');
					animSync();
				}
			});

			const delBtn = iconButton({
				icon: 'trash',
				title: 'Удалить ключ',
				cls: 'btn-sm is-danger',
				onClick: () => {
					engine.animRemoveKey(k);
					selKey = null;
					animSync();
				}
			});

			const closeBtn = iconButton({
				icon: 'x',
				title: 'Снять выбор',
				cls: 'btn-sm',
				onClick: () => {
					selKey = null;
					animSync();
				}
			});

			inspector.append(
				h('label', { class: 'fx-anim-insp-field' }, h('span', {}, 'Время ключа:'), inT, h('span', { class: 'fx-anim-insp-unit' }, 'с')),
				updBtn,
				h('div', { class: 'fx-anim-insp-actions' }, delBtn, closeBtn)
			);
		} else {
			inspector.hidden = true;
		}
	}

	function renderKeys() {
		const A = st.anim;
		const durTotal = A.dur || 8;
		camKeysWrap.textContent = '';
		if (!A.keys) A.keys = [];

		for (const k of A.keys) {
			const b = h('button', {
				type: 'button',
				class: 'fx-anim-key' + (k === selKey ? ' is-sel' : ''),
				style: { left: (k.t / durTotal) * 100 + '%' },
				'data-tip': `Ключ камеры, ${k.t.toFixed(1)} с. Тяните для сдвига`,
				'aria-label': 'Ключ камеры'
			});

			b.addEventListener('pointerdown', (e) => {
				e.stopPropagation();
				e.preventDefault();
				engine.animPause();
				selKey = k;
				selClip = null;
				isDraggingItem = true;
				engine.animT = k.t;
				b.setPointerCapture(e.pointerId);
				animSync();

				const mv = (ev) => {
					const t = timeFromPointer(ev, camTrackBody);
					engine.animMoveKey(k, t);
					engine.animT = k.t;
					b.style.left = (k.t / durTotal) * 100 + '%';
					animSync();
				};

				const up = () => {
					b.removeEventListener('pointermove', mv);
					b.removeEventListener('pointerup', up);
					b.removeEventListener('pointercancel', up);
					isDraggingItem = false;
					animSync();
				};

				b.addEventListener('pointermove', mv);
				b.addEventListener('pointerup', up);
				b.addEventListener('pointercancel', up);
			});

			camKeysWrap.append(b);
		}
	}

	function renderFxLanes() {
		const A = st.anim;
		const durTotal = A.dur || 8;
		const clips = A.clips || [];
		fxLanesWrap.textContent = '';

		if (!clips.length) {
			emptyHint.hidden = false;
			return;
		}
		emptyHint.hidden = true;

		const uniqueLayers = [...new Set(clips.map((c) => c.layerId))];

		for (const layerId of uniqueLayers) {
			const layerDef = getLayerDef(layerId);
			const layerClips = clips.filter((c) => c.layerId === layerId);

			const laneTitle = h('div', { class: 'fx-anim-track-label fx-anim-fx-label' },
				h('span', { class: 'ic-wrap', html: icon(layerDef.icon || 'sparkle', 14) }),
				h('span', { class: 'fx-anim-lane-name' }, layerDef.name),
				h('div', { class: 'fx-anim-lane-tools' },
					iconButton({
						icon: 'plus',
						title: `Добавить ещё блок «${layerDef.name}»`,
						size: 12,
						cls: 'fx-anim-lane-add',
						onClick: () => {
							selClip = engine.animAddClip(layerId);
							selKey = null;
							animSync();
						}
					}),
					iconButton({
						icon: 'trash',
						title: `Удалить все блоки «${layerDef.name}»`,
						size: 12,
						cls: 'fx-anim-lane-del',
						onClick: () => {
							A.clips = A.clips.filter((c) => c.layerId !== layerId);
							if (selClip && selClip.layerId === layerId) selClip = null;
							engine.touch();
							engine.emit();
							animSync();
						}
					})
				)
			);

			const laneBody = h('div', { class: 'fx-anim-lane-body fx-anim-fx-body' });
			bindScrubbing(laneBody);

			for (const clip of layerClips) {
				const isSel = clip === selClip;
				const block = h('div', {
					class: 'fx-anim-block' + (isSel ? ' is-sel' : ''),
					style: {
						left: (clip.start / durTotal) * 100 + '%',
						width: Math.max(2, (clip.dur / durTotal) * 100) + '%'
					},
					'data-tip': `${layerDef.name}: ${clip.start.toFixed(1)}с – ${(clip.start + clip.dur).toFixed(1)}с. Тяните для сдвига`,
					'aria-label': `${layerDef.name} блок`
				});

				const fadeInPct = clip.dur > 0 ? Math.min(50, (clip.fadeIn / clip.dur) * 100) : 0;
				const fadeOutPct = clip.dur > 0 ? Math.min(50, (clip.fadeOut / clip.dur) * 100) : 0;
				const fadeInEl = h('div', { class: 'fx-anim-fade-in', style: { width: fadeInPct + '%' } });
				const fadeOutEl = h('div', { class: 'fx-anim-fade-out', style: { width: fadeOutPct + '%' } });

				const blockContent = h('div', { class: 'fx-anim-block-content' },
					h('span', { class: 'fx-anim-block-title' }, layerDef.name),
					h('span', { class: 'fx-anim-block-time' }, `${clip.dur.toFixed(1)}с`)
				);

				const handleL = h('div', { class: 'fx-anim-handle is-left', title: 'Тяните, чтобы изменить начало блока' });
				const handleR = h('div', { class: 'fx-anim-handle is-right', title: 'Тяните, чтобы изменить длину блока' });

				block.append(fadeInEl, fadeOutEl, blockContent, handleL, handleR);

				// Перетаскивание блока
				block.addEventListener('pointerdown', (e) => {
					if (e.target.closest('.fx-anim-handle')) return;
					e.stopPropagation();
					e.preventDefault();
					engine.animPause();
					selClip = clip;
					selKey = null;
					isDraggingItem = true;
					block.setPointerCapture(e.pointerId);
					animSync();

					const startX = e.clientX;
					const origStart = clip.start;
					const r = laneBody.getBoundingClientRect();

					const mv = (ev) => {
						const dx = ev.clientX - startX;
						const dt = (dx / Math.max(1, r.width)) * durTotal;
						let newStart = Math.max(0, Math.min(durTotal - clip.dur, origStart + dt));
						// к чему ближе прилипнуть: к началу или к концу блока
						const sS = snapTime(newStart, r.width, clip.id, ev);
						const sE = snapTime(newStart + clip.dur, r.width, clip.id, ev) - clip.dur;
						if (Math.abs(sS - newStart) <= Math.abs(sE - newStart) && sS !== newStart) newStart = sS;
						else if (sE !== newStart) newStart = sE;
						newStart = Math.max(0, Math.min(durTotal - clip.dur, newStart));
						clip.start = newStart;
						block.style.left = (newStart / durTotal) * 100 + '%';
						blockContent.querySelector('.fx-anim-block-time').textContent = `${clip.dur.toFixed(1)}с`;
					};

					const up = () => {
						block.removeEventListener('pointermove', mv);
						block.removeEventListener('pointerup', up);
						block.removeEventListener('pointercancel', up);
						engine.animUpdateClip(clip.id, { start: Math.round(clip.start * 10) / 10 });
						isDraggingItem = false;
						animSync();
					};

					block.addEventListener('pointermove', mv);
					block.addEventListener('pointerup', up);
					block.addEventListener('pointercancel', up);
				});

				// Ручка слева (trim start)
				handleL.addEventListener('pointerdown', (e) => {
					e.stopPropagation();
					e.preventDefault();
					engine.animPause();
					selClip = clip;
					selKey = null;
					isDraggingItem = true;
					handleL.setPointerCapture(e.pointerId);
					animSync();

					const startX = e.clientX;
					const origStart = clip.start;
					const origDur = clip.dur;
					const origEnd = origStart + origDur;
					const r = laneBody.getBoundingClientRect();

					const mv = (ev) => {
						const dx = ev.clientX - startX;
						const dt = (dx / Math.max(1, r.width)) * durTotal;
						const newStart = Math.max(0, Math.min(origEnd - 0.1, snapTime(origStart + dt, r.width, clip.id, ev)));
						const newDur = origEnd - newStart;
						clip.start = newStart;
						clip.dur = newDur;
						block.style.left = (newStart / durTotal) * 100 + '%';
						block.style.width = Math.max(1, (newDur / durTotal) * 100) + '%';
						blockContent.querySelector('.fx-anim-block-time').textContent = `${newDur.toFixed(1)}с`;
					};

					const up = () => {
						handleL.removeEventListener('pointermove', mv);
						handleL.removeEventListener('pointerup', up);
						handleL.removeEventListener('pointercancel', up);
						engine.animUpdateClip(clip.id, {
							start: Math.round(clip.start * 10) / 10,
							dur: Math.round(clip.dur * 10) / 10
						});
						isDraggingItem = false;
						animSync();
					};

					handleL.addEventListener('pointermove', mv);
					handleL.addEventListener('pointerup', up);
					handleL.addEventListener('pointercancel', up);
				});

				// Ручка справа (trim end)
				handleR.addEventListener('pointerdown', (e) => {
					e.stopPropagation();
					e.preventDefault();
					engine.animPause();
					selClip = clip;
					selKey = null;
					isDraggingItem = true;
					handleR.setPointerCapture(e.pointerId);
					animSync();

					const startX = e.clientX;
					const origDur = clip.dur;
					const r = laneBody.getBoundingClientRect();

					const mv = (ev) => {
						const dx = ev.clientX - startX;
						const dt = (dx / Math.max(1, r.width)) * durTotal;
						const newEnd = Math.min(durTotal, snapTime(clip.start + origDur + dt, r.width, clip.id, ev));
						const newDur = Math.max(0.1, Math.min(durTotal - clip.start, newEnd - clip.start));
						clip.dur = newDur;
						block.style.width = Math.max(1, (newDur / durTotal) * 100) + '%';
						blockContent.querySelector('.fx-anim-block-time').textContent = `${newDur.toFixed(1)}с`;
					};

					const up = () => {
						handleR.removeEventListener('pointermove', mv);
						handleR.removeEventListener('pointerup', up);
						handleR.removeEventListener('pointercancel', up);
						engine.animUpdateClip(clip.id, {
							dur: Math.round(clip.dur * 10) / 10
						});
						isDraggingItem = false;
						animSync();
					};

					handleR.addEventListener('pointermove', mv);
					handleR.addEventListener('pointerup', up);
					handleR.addEventListener('pointercancel', up);
				});

				laneBody.append(block);
			}

			const lane = h('div', { class: 'fx-anim-lane fx-anim-fx-lane' }, laneTitle, laneBody);
			fxLanesWrap.append(lane);
		}
	}

	/** Подпись времени: минуты:секунды, при мелком шаге ещё доли секунды */
	function fmtRuler(t, step) {
		const m = Math.floor(t / 60);
		const sec = t - m * 60;
		if (step >= 1) return m + ':' + String(Math.round(sec)).padStart(2, '0');
		const d = step >= 0.1 ? 1 : 2;
		return m + ':' + sec.toFixed(d).padStart(d + 3, '0');
	}
	const RULER_STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
	const RULER_MINOR = { 0.05: 5, 0.1: 5, 0.2: 4, 0.5: 5, 1: 5, 2: 4, 5: 5, 10: 5, 15: 3, 30: 6, 60: 6, 120: 4 };
	function renderRuler() {
		const durTotal = st.anim.dur || 8;
		rulerTicks.textContent = '';
		const w = rulerBody.getBoundingClientRect().width || 600;
		const pxPerSec = w / durTotal;
		// главный шаг подбирается по ширине: подписи не слипаются при любом зуме
		const major = RULER_STEPS.find((x) => x * pxPerSec >= 84) || 120;
		const div = RULER_MINOR[major];
		const minor = major / div;
		const frag = document.createDocumentFragment();
		const eps = 1e-6;
		const total = Math.floor(durTotal / minor + eps);
		for (let i = 0; i <= total; i++) {
			const t = Math.round(i * minor * 1000) / 1000;
			const isMajor = i % div === 0;
			if (!isMajor && minor * pxPerSec < 7) continue;
			const mid = !isMajor && div % 2 === 0 && i % (div / 2) === 0;
			const tick = h('div', { class: 'fx-anim-tick' + (isMajor ? ' is-major' : mid ? ' is-mid' : ''), style: { left: (t / durTotal) * 100 + '%' } });
			if (isMajor) tick.append(h('span', { class: 'fx-anim-tick-label' }, fmtRuler(t, major)));
			frag.append(tick);
		}
		// конец анимации отмечен отдельной чертой и подписью
		const end = h('div', { class: 'fx-anim-tick is-end-mark', style: { left: '100%' } }, h('span', { class: 'fx-anim-tick-label is-end' }, fmtRuler(durTotal, Math.min(major, 1))));
		frag.append(end);
		rulerTicks.append(frag);
	}

	function animSync() {
		const A = st.anim;
		const durTotal = A.dur || 8;
		const frac = durTotal ? Math.min(1, Math.max(0, engine.animT / durTotal)) : 0;
		const pct = (frac * 100).toFixed(2) + '%';

		// Положение иглы на линейке и вертикальной линии плейхеда
		rulerNeedle.style.left = pct;
		playheadLine.style.left = `calc(var(--fx-head-w, 130px) + (100% - var(--fx-head-w, 130px)) * ${(frac * animZoom).toFixed(5)})`;

		// Таймкод
		aTimeCur.textContent = formatTimecode(engine.animT);
		aTimeTotal.textContent = formatTimecode(durTotal);

		// Кнопки
		aPlay.textContent = '';
		aPlay.append(h('span', { class: 'ic-wrap', html: icon(engine.animPlaying ? 'pause' : 'play', 18) }));
		aPlay.classList.toggle('is-active', engine.animPlaying);
		aLoop.classList.toggle('is-active', !!A.loop);
		aRec.disabled = engine.animRec;
		if (document.activeElement !== aDur) aDur.value = durTotal;
		fitDur();

		if (selKey && (!A.keys || !A.keys.includes(selKey))) selKey = null;
		if (selClip && (!A.clips || !A.clips.includes(selClip))) selClip = null;

		renderInspector();

		if (lastCharDur !== durTotal) {
			lastCharDur = durTotal;
			drawChar();
		}

		if (isDraggingItem) return;

		const keysStr = (A.keys || []).map((k) => `${k.t}`).join(',');
		const clipsStr = (A.clips || []).map((c) => `${c.id}:${c.layerId}:${c.start}:${c.dur}:${c.fadeIn}:${c.fadeOut}:${c.amount}`).join(',');
		const sig = `${durTotal}|${keysStr}|${clipsStr}|${selKey ? A.keys.indexOf(selKey) : -1}|${selClip ? selClip.id : ''}`;

		if (sig !== lastRenderSig) {
			lastRenderSig = sig;
			renderRuler();
			renderKeys();
			renderFxLanes();
		}
		clampAnimH();
	}
	app.bus.on('fxanim', animSync);
	app.bus.on('fx', animSync);
	// фон сцены: кнопка в нижней панели открывает палитру
	const BGS = [['', 'Как в редакторе'], ['#0b0d11', 'Чёрный'], ['#14161b', 'Графит'], ['#0d1b2a', 'Ночь'], ['#1a0f2e', 'Сумерки'], ['#2a1208', 'Янтарь'], ['#0f2a1f', 'Хвоя'], ['#ffffff', 'Белый']];
	const bgBtn = h('button', { type: 'button', class: 'btn btn-icon fx-bg-btn', 'aria-label': 'Цвет фона', 'data-tip': 'Цвет фона сцены', 'aria-expanded': 'false' }, h('span', { class: 'fx-bg-dot' }));
	const bgPop = h('div', { class: 'fx-bg-pop popover', hidden: true });
	const bgSw = h('div', { class: 'fx-bg-sw' });
	const bgSwBtns = BGS.map(([c, name]) => {
		const b = h('button', { type: 'button', class: 'fx-bg-chip', 'aria-label': name, 'data-tip': name, style: c ? { background: c } : {} });
		if (!c) b.classList.add('is-default');
		b.addEventListener('click', () => setBg(c));
		bgSw.append(b);
		return [c, b];
	});
	const bgColor = colorField({ value: st.look.bg || '#14161b', onInput: (v) => setBg(v, true), onChange: save });
	const bgVig = switchRow('Затемнение к краям', { value: st.look.vignette, onChange: (v) => { st.look.vignette = v; engine.applyBg(); save(); } });
	bgPop.append(h('div', { class: 'fx-bg-title' }, 'Цвет фона'), bgSw, field('Свой цвет', bgColor.el), bgVig.el);
	document.getElementById('viewport').append(bgPop);
	function setBg(c, live) {
		st.look.bg = c;
		engine.applyBg();
		if (!live) bgColor.set(c || '#14161b');
		syncBg();
		save();
	}
	function syncBg() {
		bgBtn.querySelector('.fx-bg-dot').style.background = st.look.bg || 'var(--bg-sunken)';
		bgSwBtns.forEach(([c, b]) => b.classList.toggle('is-active', c === st.look.bg));
		bgVig.set(st.look.vignette);
	}
	bgBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		bgPop.hidden = !bgPop.hidden;
		bgBtn.setAttribute('aria-expanded', String(!bgPop.hidden));
	});
	document.addEventListener('pointerdown', (e) => {
		if (!bgPop.hidden && !bgPop.contains(e.target) && !bgBtn.contains(e.target) && !e.target.closest('.cp-pop')) {
			bgPop.hidden = true;
			bgBtn.setAttribute('aria-expanded', 'false');
		}
	});
	syncBg();
	const leftBtn = iconButton({ icon: 'stack', title: 'Список эффектов', cls: 'fx-left-btn', onClick: () => document.getElementById('fxLeft').classList.toggle('fx-left-open') });
	bar.append(leftBtn, playBtn, collapseBtn, camBtn, barMeters.el, h('span', { class: 'fx-bar-sep' }), bgBtn, orthoBtn, focusBtn, h('span', { class: 'fx-bar-sep' }), recBtn, keyAnimBtn, recTime);

	// ------------------------------------------------------------ синхронизация
	function sync() {
		const n = engine.geometry ? engine.geometry.attributes.position.count : st.count;
		countHint.textContent = `Сейчас ${formatInt(n)} частиц, около ${Math.round((n * 128) / 1048576)} МБ памяти. Комфортно до ${formatCount(getDevice(app).limits.comfort)}.`;
		const kind = engine.modelProvider ? engine.modelProvider.kind() : 'none';
		modelNote.textContent = kind === 'cloud' ? `Берётся облако точек из редактора (${formatInt(engine.modelProvider.total())} точек). Больше этого частиц не будет.` : kind === 'mesh' ? 'Берутся точки с поверхности вашей модели.' : 'Модели в сцене нет: показана готовая форма. Добавьте модель, и она заменит её.';
		countActive();
		// режим раскадровки существует только для видео: без видео его папка в списке скрыта
		for (const c of cards) if (c.def.group === 'Видео') c.folder.hidden = !engine.videoLoaded;
		for (const c of cards) if (c.def.group === 'Фото и видео') c.folder.hidden = !engine.pm.ready;
		// шлейф персонажа есть только у персонажа с анимацией
		for (const c of cards) if (c.def.group === 'Персонаж') c.folder.hidden = !engine.animReady;
		// настройки скрытого эффекта (глубина без фото, раскадровка без видео) не показываем: выбираем первый видимый
		const cur = cards.find((c) => c.def.id === selected);
		if (cur && cur.folder.hidden) select_((cards.find((c) => !c.folder.hidden && c.L.on) || cards.find((c) => !c.folder.hidden) || cards[0]).def.id);
		renderReactList();
		cards.forEach((c) => {
			c.card.classList.toggle('is-on', c.L.on);
			c.sw.set(c.L.on);
			c.amount.set(c.L.amount);
			c.react.set(c.L.react);
			c.band.set(c.L.band);
			c.modeSeg.set(c.L.amode);
			c.thr.set(c.L.thr);
			c.atk.set(c.L.atk);
			c.rel.set(c.L.rel);
			c.audioUi();
			c.syncHead();
			for (const [k, ctl] of Object.entries(c.extraCtl)) ctl.set(c.L[k]);
			c.applyWhen();
		});
		palBtns.forEach((b, k) => b.setAttribute('aria-checked', String(k === st.look.palette)));
		colorBy.set(st.look.colorBy);
		size.set(pset.size);
		attSw.set(pset.attenuate);
		solidPick.set(pset.solidColor);
		solidRow.hidden = st.look.colorBy !== 'solid';
		shapeBtns.forEach((b, k) => b.setAttribute('aria-checked', String((st.look.glyph && st.look.glyph !== 'off') ? k === st.look.glyph : k === pset.shape)));
		shade.set(st.look.shade || 0);
		sizeNoise.set(st.look.sizeNoise || 0);
		sizeAudio.set(st.look.sizeAudio || 0);
		glow.set(st.look.glow);
		bright.set(st.look.bright);
		bloom.set(st.look.bloom || 0);
		aberration.set(st.look.aberration || 0);
		dofOn.set(st.look.dofOn || false);
		dofDist.set(st.look.dofDist || 5.2);
		dofRange.set(st.look.dofRange || 1.4);
		syncDof();
		blend.set(st.look.blend);
		const ap = engine.animProgress;
		animBtn.disabled = !!engine.animBusy;
		animBtn.querySelector('.btn-label').textContent = ap ? `${ap.stage}: ${Math.round(ap.v * 100)}%` : 'Записать и сохранить';
		hudSw.set(!!st.look.hud);
		hudSpec.set(st.look.hudSpectrum !== false);
		rotate.set(st.look.autoRotate);
		syncRotate();
		rotSpeed.set(st.look.rotSpeed);
		sourceSeg.set(engine.sourceType);
		styleRow.hidden = engine.sourceType !== 'synth';
		style.set(st.audio.style);
		count.set(Math.min(st.count, cap()));
		// у открытого видео своя кнопка звука на таймлайне: вторую здесь не показываем
		playBtn.hidden = !!engine.videoLoaded;
		playBtn.textContent = '';
		playBtn.append(h('span', { class: 'ic-wrap', html: icon(engine.playing ? 'speaker-high' : 'speaker-slash', 18) }));
		collapseBtn.classList.toggle('is-active', engine.isCollapsed);
		const pl = document.querySelector('.fx-insp[data-layer="physics"] .btn-label');
		if (pl) pl.textContent = engine.isCollapsed ? 'Собрать форму' : 'Разрушить форму';
		camBtn.classList.toggle('is-active', !!engine.camTracker?.running);
		orthoBtn.classList.toggle('is-active', !!app.nav.ortho);
		orthoBtn.dataset.tip = app.nav.ortho ? 'Сейчас: ортогональная проекция. Включить перспективу' : 'Сейчас: перспектива. Включить ортогональную проекцию';
		recBtn.classList.toggle('is-rec', engine.recording);
		recBtn.dataset.tip = engine.recording ? 'Остановить запись и сохранить' : 'Записать видео со звуком (MP4)';
		recTime.textContent = '';
	}
	app.bus.on('fx', sync);
	app.bus.on('media', () => {
		sync();
		setTimeout(sync, 700);
	});
	app.bus.on('device', () => {
		count.setRange(20000, cap());
		sync();
	});
	app.bus.on('scene', () => {
		renderForms();
		syncMorph();
		sync();
	});

	let recTick = 0;
	engine.onFrame = (lv) => {
		meters.set(lv);
		barMeters.set(lv);
		if (engine.recording && ++recTick % 15 === 0) {
			const s = Math.floor((performance.now() - engine._recT0) / 1000);
			recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
		}
	};
	sync();
	return { sync };
}

function $bar() {
	return document.getElementById('fxBar');
}

/** Индикатор уровней: бас, середина, верх, бит */
function makeMeters(small = false) {
	const items = [['bass', 'Бас'], ['mid', 'Сер.'], ['high', 'Верх'], ['beat', 'Бит']];
	const bars = {};
	const el = h('div', { class: 'fx-meters' + (small ? ' is-small' : '') });
	for (const [k, label] of items) {
		const i = h('i');
		bars[k] = i;
		el.append(h('div', { class: 'fx-meter', 'data-tip': label }, h('div', { class: 'fx-meter-track' }, i), small ? null : h('span', {}, label)));
	}
	return {
		el,
		set(lv) {
			for (const k in bars) bars[k].style.transform = `scaleY(${Math.max(0.03, Math.min(1, lv[k] || 0))})`;
		},
	};
}
