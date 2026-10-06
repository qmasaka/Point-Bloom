// Режим «Эффекты»: боковая панель (источник, эффекты, звук, вид) и нижняя панель управления в сцене.
import { h, formatInt } from './util.js';
import { icon } from './icons.js';
import { section, field, slider, segmented, switchRow, toggle, button, iconButton, select, colorField } from './ui-kit.js';
import * as THREE from 'three';
import { sampleSurface, overrideMats } from './pointcloud.js';
import { getDevice } from './device-card.js';
import { formatCount } from './capabilities.js';
import { createMediaPanel } from './panel-media.js';
import { attachPreview } from './fx-previews.js';
import { SHAPES as POINT_SHAPE_LIST } from './panel-points.js';
import { FX_GROUP_NAMES, FX_SHAPES, FX_ACTIONS, FX_LAYERS, FX_PALETTES, MASK_MODES, BANDS, COLOR_BY_UI, SYNTH_STYLES } from './effects-engine.js';

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
		for (const o of list) {
			o.updateWorldMatrix(true, false);
			const g = o.geometry.attributes;
			const cnt = g.position.count;
			const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
			for (let i = 0; i < cnt && k < n; i++, seen++) {
				if (seen < Math.floor(next)) continue;
				next += step;
				v.fromBufferAttribute(g.position, i).applyMatrix4(o.matrixWorld);
				positions.set([v.x, v.y, v.z], k * 3);
				if (g.normal) {
					v.fromBufferAttribute(g.normal, i).applyMatrix3(nm).normalize();
					normals.set([v.x, v.y, v.z], k * 3);
				} else normals[k * 3 + 1] = 1;
				if (g.color) colors.set([g.color.getX(i), g.color.getY(i), g.color.getZ(i)], k * 3);
				k++;
			}
		}
		return { positions: positions.slice(0, k * 3), normals: normals.slice(0, k * 3), colors: colors.slice(0, k * 3), count: k };
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
			return sampleSurface(entries, count, { onProgress: (p) => app.ui.busy('Беру точки с модели', 0.2 + p * 0.7) });
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
	const tiles = h('div', { class: 'shape-grid fx-shapes', role: 'radiogroup', 'aria-label': 'Форма' });
	const tileMap = new Map();
	for (const s of FX_SHAPES) {
		const b = h('button', { type: 'button', class: 'shape-tile', role: 'radio', 'data-shape': s.id }, h('span', { class: 'fx-ic', html: icon(s.icon, 22) }), h('span', { class: 'shape-name' }, s.name));
		b.addEventListener('click', () => engine.setSource(s.id));
		tileMap.set(s.id, b);
		tiles.append(b);
	}
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
	const countChips = h('div', { class: 'chip-row' });
	for (const n of [100000, 300000, 1000000]) countChips.append(h('button', { type: 'button', class: 'chip-btn', onclick: () => engine.setCount(Math.min(n, cap())) }, formatCount(n)));
	countChips.append(h('button', { type: 'button', class: 'chip-btn', 'data-tip': 'Столько частиц комфортно для вашего компьютера', onclick: () => engine.setCount(Math.min(cap(), Math.max(20000, getDevice(app).limits.comfort))) }, 'Комфортно'));
	// морфинг: выбираем несколько форм, и частицы перетекают из одной в другую
	const mc = st.morphCfg;
	const formsBox = h('div', { class: 'chip-row fx-forms' });
	const picked = [];
	const shapesBox = h('div', { class: 'chip-row fx-forms' });
	shapesBox.hidden = true;
	const shapesToggle = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Встроенные фигуры');
	shapesToggle.addEventListener('click', () => {
		shapesBox.hidden = !shapesBox.hidden;
	});
	let autoPicked = false;
	const renderForms = () => {
		const list = engine.forms();
		for (let i = picked.length - 1; i >= 0; i--) if (!list.some((f) => f.key === picked[i])) picked.splice(i, 1);
		const objs = list.filter((f) => f.key.startsWith('obj:'));
		// две модели и больше: сразу готовы к морфингу между ними
		if (objs.length >= 2 && !autoPicked && !picked.length) {
			autoPicked = true;
			objs.forEach((o) => picked.push(o.key));
			engine.setPlaylist([...picked]);
		}
		if (objs.length < 2) autoPicked = false;
		formsBox.textContent = '';
		shapesBox.textContent = '';
		const chip = (f, box) => {
			const b = h('button', { type: 'button', class: 'chip-btn' + (picked.includes(f.key) ? ' is-active' : ''), 'data-tip': 'Добавить в морфинг. Порядок: как нажимали' }, f.name);
			b.addEventListener('click', () => {
				const k = picked.indexOf(f.key);
				if (k >= 0) picked.splice(k, 1);
				else picked.push(f.key);
				engine.setPlaylist([...picked]);
				renderForms();
			});
			box.append(b);
		};
		objs.forEach((f) => chip(f, formsBox));
		list.filter((f) => !f.key.startsWith('obj:')).forEach((f) => chip(f, shapesBox));
		morphHint.textContent = objs.length < 2 ? 'Добавьте в сцену вторую модель кнопкой «Добавить модель…»: между вашими моделями можно будет делать морфинг. Встроенные фигуры ниже.' : picked.length < 2 ? 'Отметьте минимум две формы.' : `В морфинге форм: ${picked.length}`;
	};
	const morphHint = h('div', { class: 'field-hint' }, 'Отметьте минимум две формы. Объекты сцены редактора появятся здесь как отдельные формы.');
	const morphMode = segmented({ cls: 'seg-tight', options: [{ value: 'manual', label: 'Кнопкой' }, { value: 'beat', label: 'По биту' }, { value: 'timer', label: 'По таймеру' }], value: mc.mode, onChange: (v) => { mc.mode = v; save(); } });
	const morphOrder = segmented({ options: [{ value: 'seq', label: 'По кругу' }, { value: 'random', label: 'Случайно' }], value: mc.order, onChange: (v) => { mc.order = v; save(); } });
	const morphInt = slider({ min: 1, max: 20, step: 0.5, value: mc.interval, digits: 1, unit: ' с', onInput: (v) => { mc.interval = v; }, onChange: save });
	const morphTime = slider({ min: 0.4, max: 6, step: 0.1, value: mc.time, digits: 1, unit: ' с', onInput: (v) => { mc.time = v; }, onChange: save });
	const morphWeight = segmented({ options: [{ value: 'auto', label: 'Как в модели', title: 'У модели с меньшим числом точек лишние гаснут, при переходе к большей недостающие проявляются' }, { value: 'equal', label: 'Поровну' }], value: mc.weight, onChange: (v) => { mc.weight = v; save(); } });
	const morphGo = button({ label: 'Следующая форма', icon: 'arrow-right', variant: 'secondary', cls: 'btn-block', onClick: () => engine.morphNext() });
	const morphBody = h('div', { class: 'sec-body', style: { padding: 0 } }, formsBox, morphHint, shapesToggle, shapesBox, field('Переход', morphMode.el, { wide: true }), field('Порядок', morphOrder.el, { wide: true }), field('Число точек у моделей', morphWeight.el, { wide: true }), field('Не чаще, чем раз в', morphInt.el), field('Длительность', morphTime.el), morphGo);
	renderForms();
	const secSource = section('Форма', { key: 'fx-source' }, addModel, modelNote, tiles, field('Частиц', count.el), countChips, countHint, h('div', { class: 'fx-sub' }, 'Морфинг между формами'), morphBody);

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
			body.append(field('Сила', amount.el));
			const extraCtl = {};
			const whenList = [];
			const put = (el, ex) => {
				body.append(el);
				if (ex.when) whenList.push([el, ex.when]);
			};
			const applyWhen = () => whenList.forEach(([el, w]) => (el.hidden = !w[1].includes(L[w[0]])));
			for (const ex of def.extras) {
				const after = () => {
					applyWhen();
					save();
					if (ex.relink) engine.relink();
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
					const sl = slider({ min: ex.min, max: ex.max, step: ex.step, value: L[ex.key], digits: ex.int ? 0 : 2, unit: ex.unit, onInput: (v) => { L[ex.key] = v; }, onChange: after });
					extraCtl[ex.key] = sl;
					put(field(ex.label, sl.el), ex);
				}
			}
			applyWhen();
			const react = slider({ min: 0, max: 1, step: 0.05, value: L.react, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { L.react = v; }, onChange: save });
			const reactRow = field('Сила реакции', react.el);
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
					reactRow.hidden = v === 'none';
					save();
				},
			});
			reactRow.hidden = L.band === 'none';
			body.append(field('Реагирует на звук', band.el, { wide: true }), reactRow);
			const prevCanvas = h('canvas', { class: 'fx-prev', 'aria-hidden': 'true' });
			const row = h('div', { class: 'fx-layer-head', role: 'button', tabindex: '0' }, prevCanvas, h('span', { class: 'fx-layer-title' }, def.name), sw.el);
			const card = h('div', { class: 'fx-layer' + (L.on ? ' is-on' : ''), 'data-layer': def.id, 'data-tip': def.hint, 'data-tip-pos': 'right', 'data-tip-delay': '1300' }, row);
			const insp = h('div', { class: 'fx-insp', 'data-layer': def.id }, h('div', { class: 'fx-insp-head' }, h('span', { class: 'fx-ic', html: icon(def.icon, 18) }), h('div', {}, h('b', {}, def.name), h('span', {}, def.hint))), body);
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
			cards.push({ def, L, sw, amount, react, band, reactRow, extraCtl, applyWhen, card, insp, fhead });
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
	select_((cards.find((c) => c.L.on) || cards[0]).def.id);
	const mk = st.mask;
	const maskHint = h('div', { class: 'field-hint' });
	const maskMode = segmented({
		cls: 'seg-tight',
		options: MASK_MODES.map((m) => ({ value: m.id, label: m.label, title: m.title })),
		value: mk.mode,
		onChange: (v) => {
			mk.mode = v;
			syncMask();
			save();
		},
	});
	const maskSize = slider({ log: true, min: 0.005, max: 1, step: 0.005, value: mk.size, format: (v) => (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%', onInput: (v) => { mk.size = v; }, onChange: save });
	const maskSoft = slider({ min: 0, max: 1, step: 0.05, value: mk.soft, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { mk.soft = v; }, onChange: save });
	const maskSpeed = slider({ min: 0, max: 2, step: 0.05, value: mk.speed, format: (v) => (v === 0 ? 'стоит' : v.toFixed(2)), onInput: (v) => { mk.speed = v; }, onChange: save });
	const maskInvert = switchRow('Наоборот: живёт всё, кроме зоны', { value: mk.invert, onChange: (v) => { mk.invert = v; save(); } });
	const maskShow = switchRow('Подсветить зону', { value: mk.show, onChange: (v) => { mk.show = v; save(); } });
	const maskBody = h('div', { class: 'sec-body', style: { padding: 0 } }, field('Охват', maskSize.el), field('Мягкость границы', maskSoft.el), field('Скорость движения', maskSpeed.el), maskInvert.el, maskShow.el);
	const HINTS = {
		none: 'Эффекты работают на всей форме. Выберите зону, чтобы часть точек оставалась неподвижной.',
		height: 'Верхняя часть живёт, нижняя стоит на месте. Скорость качает границу вверх и вниз.',
		sphere: 'Шар-зона: внутри него точки двигаются, снаружи стоят. Скорость гоняет шар по форме.',
		noise: 'Плавающие пятна: двигаются только они, остальное неподвижно. Охват задаёт долю формы.',
		scan: 'Полоса пробегает по форме снизу вверх и оживляет точки на своём пути.',
	};
	const secMask = section('Зона действия', { key: 'fx-mask' }, maskMode.el, maskHint, maskBody);
	function syncMask() {
		maskBody.hidden = mk.mode === 'none';
		maskHint.textContent = HINTS[mk.mode];
	}

	// ------------------------------------------------------------ звук
	const sourceSeg = segmented({
		options: [
			{ value: 'synth', label: 'Музыка', title: 'Встроенная музыка: эмбиент, джангл, брейккор' },
			{ value: 'file', label: 'Файл', title: 'Загрузить свой аудиофайл' },
			{ value: 'video', label: 'Видео', title: 'Звук из открытого видео' },
			{ value: 'mic', label: 'Микрофон', title: 'Живой звук с микрофона' },
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
	const idle = switchRow('Живая сцена без звука', { value: st.audio.idle, onChange: (v) => { st.audio.idle = v; save(); } });
	const meters = makeMeters();
	const secAudio = section('Звук', { key: 'fx-audio' }, sourceSeg.el, styleRow, meters.el, field('Чувствительность', gain.el), field('Громкость', volume.el), idle.el);

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
	const pset = app.settings.point;
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
	const hudSw = switchRow('Индикаторы уровней звука', { value: st.look.hud, onChange: (v) => { st.look.hud = v; save(); } });
	const hudSpec = switchRow('Спектр внизу', { value: st.look.hudSpectrum, onChange: (v) => { st.look.hudSpectrum = v; save(); } });
	const attSw = switchRow('Мельче вдали', { value: pset.attenuate, onChange: (v) => { pset.attenuate = v; app.saveSettings(); } });
	const size = slider({ min: 1, max: 24, step: 0.5, value: pset.size, digits: 1, unit: ' px', onInput: (v) => { pset.size = v; }, onChange: () => app.saveSettings() });
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
	const rotate = switchRow('Вращать форму', { value: st.look.autoRotate, onChange: (v) => { st.look.autoRotate = v; save(); } });
	const rotSpeed = slider({ min: 0.05, max: 1.5, step: 0.05, value: st.look.rotSpeed, digits: 2, onInput: (v) => { st.look.rotSpeed = v; }, onChange: save });
	const secLook = section('Вид', { key: 'fx-look' }, palettes, origBtn, field('Форма точек и символы', shapeTiles, { wide: true }), field('Размер', size.el), attSw.el, field('Цвет точек', colorBy.el), solidRow, field('Объём (тень)', shade.el), field('Размер по шуму', sizeNoise.el), field('Размер по звуку', sizeAudio.el), field('Свечение', glow.el), field('Яркость', bright.el), field('Блум (свечение)', bloom.el), field('Хром. аберрация', aberration.el), dofOn.el, dofBody, field('Точки', blend.el, { wide: true }), rotate.el, field('Скорость', rotSpeed.el), hudSw.el, hudSpec.el, h('div', { class: 'fx-sub' }, 'Сохранить анимацию'), field('Формат', animFmt.el, { wide: true }), field('Длина', animSec.el), animBtn, animInfo);

	const secMedia = createMediaPanel(app, null, { fx: true }).section;
	// вкладки-плашки вместо длинного списка: Эффект, Форма, Медиа, Зона, Звук, Вид
	const FX_TABS = [['insp', 'Эффект', 'sparkle', [secInsp]], ['source', 'Форма', 'cube', [secSource, secMedia]], ['zone', 'Зона и звук', 'target', [secMask, secAudio]], ['look', 'Вид', 'sliders-horizontal', [secLook]]];
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
	// ------------------------------------------------------------ анимация по ключам (дорожка времени)
	const animPanel = h('div', { class: 'fx-anim vp-pill', hidden: true, role: 'group', 'aria-label': 'Анимация по ключам' });
	const keyAnimBtn = iconButton({ icon: 'film-strip', title: 'Анимация: ключи камеры и эффектов на дорожке времени', onClick: () => toggleAnim() });
	const aPlay = iconButton({ icon: 'play', title: 'Играть и остановить', cls: 'fx-anim-play', onClick: () => { if (engine.animPlaying) engine.animPause(); else if (!engine.animPlay()) app.toast('Поставьте минимум два ключа в разное время', 'info'); } });
	const aTime = h('span', { class: 'fx-anim-time' });
	const aKeys = h('div', { class: 'fx-anim-keys' });
	const aHead = h('div', { class: 'fx-anim-head' });
	const aTrack = h('div', { class: 'fx-anim-track' }, aKeys, aHead);
	const aLoop = iconButton({ icon: 'repeat', title: 'Повторять по кругу', onClick: () => { st.anim.loop = !st.anim.loop; save(); animSync(); } });
	const aDur = h('input', { type: 'number', class: 'num-in fx-anim-dur', min: 1, max: 120, step: 1, value: 8, 'aria-label': 'Длина анимации, секунд', 'data-tip': 'Длина анимации, секунд' });
	aDur.addEventListener('change', () => { engine.animSetDuration(Number(aDur.value) || 8); animSync(); });
	const aClose = iconButton({ icon: 'x', title: 'Закрыть анимацию', onClick: () => toggleAnim(false) });
	let selKey = null;
	const aAdd = button({ label: 'Ключ', icon: 'plus', variant: 'primary', cls: 'btn-sm', title: 'Запомнить камеру и эффекты в этот момент времени', size: 14, onClick: () => { selKey = engine.animAddKey(); animSync(); } });
	const aUpd = iconButton({ icon: 'arrow-clockwise', title: 'Обновить выбранный ключ тем, что сейчас на сцене', onClick: () => { if (selKey) engine.animUpdateKey(selKey); } });
	const aDel = iconButton({ icon: 'trash', title: 'Удалить выбранный ключ', onClick: () => { if (selKey) { engine.animRemoveKey(selKey); selKey = null; animSync(); } } });
	const aRec = button({ label: 'Записать', icon: 'record', variant: 'secondary', cls: 'btn-sm', title: 'Проиграет анимацию один раз и сохранит видео со звуком', size: 14, onClick: () => { if (!engine.animRecord()) app.toast('Поставьте минимум два ключа в разное время', 'info'); } });
	const aHint = h('div', { class: 'fx-anim-hint' });
	animPanel.append(
		h('div', { class: 'fx-anim-row' }, aPlay, aTime, aTrack, aLoop, h('span', { class: 'fx-anim-dur-wrap' }, aDur, h('span', {}, 'с')), aClose),
		h('div', { class: 'fx-anim-row fx-anim-actions' }, aAdd, aUpd, aDel, aHint, aRec)
	);
	document.getElementById('viewport').append(animPanel);
	function toggleAnim(on = animPanel.hidden) {
		animPanel.hidden = !on;
		keyAnimBtn.classList.toggle('is-active', on);
		if (!on) engine.animPause();
		// первый ключ ставим сразу: он запоминает то, что вы видите сейчас
		else if (!st.anim.keys.length) selKey = engine.animAddKey(0);
		animSync();
	}
	// зажали камеру мышью: анимация встаёт на паузу, чтобы не отнимать управление
	document.getElementById('viewport').addEventListener('pointerdown', (e) => {
		if (engine.animPlaying && !engine.animRec && !e.target.closest('.fx-anim, .fx-bar')) engine.animPause();
	}, true);
	const timeAt = (e) => {
		const r = aTrack.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * st.anim.dur;
	};
	aTrack.addEventListener('pointerdown', (e) => {
		if (e.target.closest('.fx-anim-key')) return;
		engine.animPause();
		aTrack.setPointerCapture(e.pointerId);
		engine.animSeek(timeAt(e));
		const mv = (ev) => engine.animSeek(timeAt(ev));
		const up = () => {
			aTrack.removeEventListener('pointermove', mv);
			aTrack.removeEventListener('pointerup', up);
		};
		aTrack.addEventListener('pointermove', mv);
		aTrack.addEventListener('pointerup', up);
	});
	function renderKeys() {
		const A = st.anim;
		aKeys.textContent = '';
		for (const k of A.keys) {
			const b = h('button', { type: 'button', class: 'fx-anim-key' + (k === selKey ? ' is-sel' : ''), style: { left: (k.t / A.dur) * 100 + '%' }, 'data-tip': `Ключ, ${k.t.toFixed(1)} с. Клик выбирает, перетаскивание двигает`, 'aria-label': 'Ключ' });
			b.addEventListener('pointerdown', (e) => {
				e.stopPropagation();
				engine.animPause();
				selKey = k;
				engine.animSeek(k.t);
				b.setPointerCapture(e.pointerId);
				const mv = (ev) => {
					engine.animMoveKey(k, timeAt(ev));
					b.style.left = (k.t / A.dur) * 100 + '%';
					aTime.textContent = `${k.t.toFixed(1)} с`;
				};
				const up = () => {
					b.removeEventListener('pointermove', mv);
					b.removeEventListener('pointerup', up);
					renderKeys();
					animSync();
				};
				b.addEventListener('pointermove', mv);
				b.addEventListener('pointerup', up);
				renderKeys();
				animSync();
			});
			aKeys.append(b);
		}
	}
	let keysSig = '';
	function animSync() {
		const A = st.anim;
		aTime.textContent = `${engine.animT.toFixed(1)} с`;
		aHead.style.left = (A.dur ? Math.min(1, engine.animT / A.dur) : 0) * 100 + '%';
		aTrack.style.setProperty('--ticks', Math.max(1, Math.round(A.dur)));
		aPlay.textContent = '';
		aPlay.append(h('span', { class: 'ic-wrap', html: icon(engine.animPlaying ? 'pause' : 'play', 18) }));
		aPlay.classList.toggle('is-active', engine.animPlaying);
		aLoop.classList.toggle('is-active', !!A.loop);
		aRec.disabled = engine.animRec;
		if (document.activeElement !== aDur) aDur.value = A.dur;
		if (selKey && !A.keys.includes(selKey)) selKey = null;
		aUpd.disabled = aDel.disabled = !selKey;
		const distinct = new Set(A.keys.map((k) => k.t)).size;
		aHint.textContent = distinct < 2 ? (A.keys.length ? 'Передвиньте время, измените сцену и добавьте ещё ключ' : 'Нажмите «Ключ», чтобы запомнить сцену') : '';
		const sig = A.dur + '|' + A.keys.map((k) => k.t).join(',') + '|' + A.keys.indexOf(selKey);
		if (sig !== keysSig) {
			keysSig = sig;
			renderKeys();
		}
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
		tileMap.forEach((b, k) => {
			b.setAttribute('aria-checked', String(k === st.source));
			if (k === 'model') b.disabled = !engine.hasModel;
			if (k === 'media') {
				b.disabled = !engine.pm.ready;
				b.dataset.tip = engine.pm.ready ? 'Фото или видео из вкладки «Медиа» редактора' : 'Откройте фото или видео на вкладке «Медиа» в редакторе';
			}
		});
		const n = engine.geometry ? engine.geometry.attributes.position.count : st.count;
		countHint.textContent = `Сейчас ${formatInt(n)} частиц, около ${Math.round((n * 128) / 1048576)} МБ памяти. Комфортно до ${formatCount(getDevice(app).limits.comfort)}.`;
		const kind = engine.modelProvider ? engine.modelProvider.kind() : 'none';
		modelNote.textContent = kind === 'cloud' ? `Берётся облако точек из редактора (${formatInt(engine.modelProvider.total())} точек). Больше этого частиц не будет.` : kind === 'mesh' ? 'Берутся точки с поверхности вашей модели.' : 'Модели в сцене нет: показана готовая форма. Добавьте модель, и она заменит её.';
		countActive();
		cards.forEach((c) => {
			c.card.classList.toggle('is-on', c.L.on);
			c.sw.set(c.L.on);
			c.amount.set(c.L.amount);
			c.react.set(c.L.react);
			c.band.set(c.L.band);
			c.reactRow.hidden = c.L.band === 'none';
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
		rotSpeed.set(st.look.rotSpeed);
		maskMode.set(mk.mode);
		maskSize.set(mk.size);
		maskSoft.set(mk.soft);
		maskSpeed.set(mk.speed);
		maskInvert.set(mk.invert);
		maskShow.set(mk.show);
		syncMask();
		sourceSeg.set(engine.sourceType);
		styleRow.hidden = engine.sourceType !== 'synth';
		style.set(st.audio.style);
		count.set(Math.min(st.count, cap()));
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
	app.bus.on('device', () => {
		count.setRange(20000, cap());
		sync();
	});
	app.bus.on('scene', () => {
		renderForms();
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
