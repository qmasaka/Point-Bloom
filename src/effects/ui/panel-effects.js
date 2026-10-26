// Режим «Эффекты»: боковая панель (источник, эффекты, звук, вид) и нижняя панель управления в сцене.
import { h, formatInt, placeAbove, uiZoom, screenRect, toCss } from '../../core/util.js';
import { icon } from '../../ui/icons.js';
import { section, field, fxSlider as slider, segmented, switchRow, toggle, button, iconButton, select, colorField } from '../../ui/ui-kit.js';
import * as THREE from 'three';
import { sampleSurface, overrideMats } from '../../points/pointcloud.js';
import { getDevice } from '../../ui/device-card.js';
import { formatCount } from '../../core/capabilities.js';
import { createMediaPanel } from '../../ui/panels/media.js';
import { createAnimSettings } from '../../ui/panels/anim.js';
import { clipActivity } from '../../animation/anim-activity.js';
import { attachPreview } from './fx-previews.js';
import { SHAPES as POINT_SHAPE_LIST } from '../../ui/panels/points.js';
import { FX_GROUP_NAMES, FX_ACTIONS, FX_LAYERS } from '../state/layers.js';
import { FX_PALETTES, BANDS, COLOR_BY_UI, SYNTH_STYLES, MORPH_STYLES, MORPH_SORTS, MORPH_EASES } from '../state/options.js';
import { recDefaults, saveRecDefaults } from '../engine/recording.js';

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
		const A = animated ? { parts: [], part: new Uint8Array(n), bp: new Float32Array(n * 3), bi: new Uint16Array(n * 4), bw: new Float32Array(n * 4), bn: new Float32Array(n * 3) } : null;
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
						if (src.bn) A.bn.set([src.bn[i * 3], src.bn[i * 3 + 1], src.bn[i * 3 + 2]], k * 3);
						for (let q = 0; q < 4; q++) {
							A.bi[k * 4 + q] = src.bi[i * 4 + q];
							A.bw[k * 4 + q] = src.bw[i * 4 + q];
						}
					} else {
						A.part[k] = poff;
						A.bp.set([g.position.getX(i), g.position.getY(i), g.position.getZ(i)], k * 3);
						if (g.normal) A.bn.set([g.normal.getX(i), g.normal.getY(i), g.normal.getZ(i)], k * 3);
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
		if (A && A.parts.some((q) => q.skinned)) out.anim = { parts: A.parts, part: A.part.slice(0, k), bp: A.bp.slice(0, k * 3), bi: A.bi.slice(0, k * 4), bw: A.bw.slice(0, k * 4), bn: A.bn.slice(0, k * 3) };
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
			// персонаж с анимацией и как отдельная форма морфинга остаётся живым: точки помнят кости и масштаб берётся по всему движению
			const sc = await sampleSurface(entries, count, { anim: app.anim.has });
			if (sc && sc.anim && app.anim.has) sc.animBox = app.anim.animatedBounds();
			return sc;
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
	// сначала естественные цвета модели, они выбраны по умолчанию; как только меняется палитра, цвет переходит на цвета палитры
	if (natural) mkChip('model', 'Естественные цвета модели', { background: 'conic-gradient(#ff3d6e, #ffd90f, #7cff6b, #00f0ff, #b06bff, #ff3d6e)' });
	mkChip('auto', 'Цвета палитры');
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
	const count = slider({ noNorm: true,
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
	// одна кнопка: «Открыть» в эффектах сам спрашивает, что добавить (модель, видео или фото)
	const addModel = button({ label: 'Добавить…', icon: 'plus', variant: 'secondary', cls: 'btn-block', title: 'Добавить модель, облако точек, видео или фото: всё это сразу встаёт в морфинг', onClick: () => app.ui.openFiles('fxadd') });
	const modelNote = h('div', { class: 'field-hint' });
	// ------------------------------------------------------------ морфинг между моделями
	const mc = st.morphCfg;
	// список форм: строки в том же виде, что эффекты слева (значок в плитке, имя, переключатель)
	const formsList = h('div', { class: 'mf-list', role: 'list' });
	const formsBox = h('div', { class: 'mf-forms' }, formsList);
	const picked = [];
	const seenForms = new Set();
	let formsSig = '';
	const isMediaKey = (k) => k === 'media' || k.startsWith('media:');
	const formsSigNow = () => JSON.stringify([engine.uiForms().map((f) => f.key + f.name), picked, engine.curKey || engine.state.source, app.media.soundKey, app.media.soundEntry?.()?.id]);
	const renderForms = () => {
		const list = engine.uiForms();
		let changed = false;
		for (let i = picked.length - 1; i >= 0; i--) {
			if (!list.some((f) => f.key === picked[i])) {
				picked.splice(i, 1);
				changed = true;
			}
		}
		// новая модель или видео сразу встаёт в список морфинга; убранную вручную обратно не возвращаем
		for (const f of list) {
			if (!seenForms.has(f.key)) {
				seenForms.add(f.key);
				if (!picked.includes(f.key)) {
					picked.push(f.key);
					changed = true;
				}
			}
		}
		if (changed) engine.setPlaylist([...picked]);
		const cur = engine.curKey || (engine.state.source === 'model' ? picked[0] : engine.state.source);
		formsList.textContent = '';
		for (const f of list) {
			const k = picked.indexOf(f.key);
			const on = k >= 0;
			const isCur = f.key === cur;
			const sw = toggle({
				value: on,
				label: 'Участвует в морфинге',
				onChange: (v) => {
					const at = picked.indexOf(f.key);
					if (!v && at >= 0) picked.splice(at, 1);
					if (v && at < 0) picked.push(f.key);
					engine.setPlaylist([...picked]);
					renderForms();
					syncMorph();
				},
			});
			const go = iconButton({ icon: 'play', title: isCur ? 'Эта форма сейчас на экране' : 'Перейти к этой форме сейчас', onClick: () => engine.morphTo(f.key) });
			go.classList.add('mf-go');
			go.disabled = !on || isCur || picked.length < 2;
			// у видео кнопка звука: нажатая значит «звук всегда из этого видео», отжатая значит звук от показанного сейчас
			const me = isMediaKey(f.key) ? app.media.entry(f.key) : null;
			let snd = '';
			if (me && me.pm.kind === 'video') {
				const fixed = app.media.soundKey === f.key;
				const heard = app.media.soundEntry?.() === me;
				snd = iconButton({ icon: heard ? 'speaker-high' : 'speaker-slash', title: fixed ? 'Звук всегда из этого видео. Нажмите, чтобы звук шёл от показанного' : 'Брать звук всегда из этого видео', onClick: () => { app.media.setSoundKey(fixed ? 'follow' : f.key); renderForms(); } });
				snd.classList.add('mf-snd');
				snd.classList.toggle('is-active', fixed);
			}
			const row = h('div', { class: 'mf-row' + (on ? ' is-on' : '') + (isCur ? ' is-cur' : ''), role: 'listitem' },
				h('span', { class: 'mf-ic', html: icon(f.icon, 16) }),
				h('span', { class: 'mf-name', title: f.name }, f.name),
				h('span', { class: 'mf-n' }, on ? String(k + 1) : ''),
				snd || h('span'),
				go,
				sw.el
			);
			formsList.append(row);
		}
		const has = picked.length >= 2;
		morphHint.textContent = has ? '' : 'Отметьте минимум две формы: модели, видео или фото. Добавить их можно выше, в разделе «Форма».';
		morphSettings.hidden = !has;
		formsSig = formsSigNow();
	};
	const morphHint = h('div', { class: 'field-hint' });
	// вид перехода: выпадающий список со значками, у каждого вида свои настройки по умолчанию
	const styleSel = select({
		options: MORPH_STYLES.filter((ms) => !ms.hidden).map((ms) => ({ value: ms.id, label: ms.name, icon: ms.icon })),
		value: mc.style,
		onChange: (v) => {
			const ms = MORPH_STYLES.find((x) => x.id === v);
			if (!ms) return;
			mc.style = v;
			Object.assign(mc, ms.v);
			save();
			syncMorph();
			// «Рельеф» сразу готовит карты глубины нейросетью
			if (v === 'relief' && picked.some(isMediaKey)) engine.morphAIDepth();
		},
	});
	const styleHint = h('div', { class: 'field-hint mf-style-hint' });
	// глубина нейросетью: кнопка и состояние, видны у «Рельефа» и при порядке по глубине
	const aiState = h('div', { class: 'field-hint' });
	const aiBtn = button({ label: 'Построить глубину нейросетью', icon: 'mountains', variant: 'secondary', cls: 'btn-block', title: 'Нейросеть строит карту глубины для каждого видео и фото из списка. Первый раз загружается модель', onClick: () => engine.morphAIDepth() });
	const aiBox = h('div', { class: 'sec-body', style: { padding: 0 } }, aiBtn, aiState);
	const syncAI = () => {
		const show = (mc.style === 'relief' || mc.sort === 'depthnear' || mc.sort === 'depthfar') && picked.some(isMediaKey);
		aiBox.hidden = !show;
		if (!show) return;
		const ai = engine.depthAI;
		const ready = picked.filter(isMediaKey).every((k) => app.media.entry(k)?.ai);
		aiBtn.disabled = !!engine._aiBusy;
		aiState.textContent = engine._aiBusy
			? ai.phase === 'loading'
				? `Загружается нейросеть: ${Math.round((ai.prog || 0) * 100)}%`
				: `Считаю глубину: ${engine._aiDone || 0} из ${engine._aiTotal || 0}`
			: ready
				? 'Глубина от нейросети готова для всех видео и фото.'
				: 'Пока карты нет, глубина берётся по яркости кадра.';
	};
	engine.onDepthChange(syncAI);
	const morphMode = segmented({ cls: 'seg-tight', options: [{ value: 'manual', label: 'Кнопкой' }, { value: 'timer', label: 'По таймеру' }, { value: 'music', label: 'По музыке' }], value: mc.mode === 'beat' ? 'music' : mc.mode, onChange: (v) => { mc.mode = v; save(); syncMorph(); } });
	const morphOrder = segmented({ cls: 'seg-tight', options: [{ value: 'seq', label: 'По кругу' }, { value: 'pingpong', label: 'Туда и обратно' }, { value: 'random', label: 'Случайно' }], value: mc.order, onChange: (v) => { mc.order = v; save(); } });
	// переход вручную: ползунок ведёт форму к следующей в списке, на половине можно остановиться и получить обе формы вперемешку
	const morphScrub = slider({ noNorm: true, min: 0, max: 100, step: 1, value: 0, digits: 0, unit: '%', onInput: (v) => engine.morphScrub(v / 100), onChange: (v) => { engine.morphScrubEnd(); if (v >= 100) setTimeout(() => morphScrub.set(0), 250); } });
	const morphInt = slider({ noNorm: true, min: 1, max: 20, step: 0.5, value: mc.interval, digits: 1, unit: ' с', onInput: (v) => { mc.interval = v; }, onChange: save });
	morphScrub.el.addEventListener('pointerdown', () => {
		engine._scrubUser = true;
		const up = () => {
			engine._scrubUser = false;
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
		};
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', up);
	});
	const morphLift = slider({ min: 0, max: 1.5, step: 0.05, value: mc.lift || 0, digits: 2, onInput: (v) => { mc.lift = v; }, onChange: save });
	const morphSpin = slider({ noNorm: true, min: -3, max: 3, step: 1, value: mc.spin || 0, digits: 0, format: (v) => (v ? (v > 0 ? '+' : '') + v + ' об.' : 'нет'), onInput: (v) => { mc.spin = v; }, onChange: save });
	const morphFsize = slider({ noNorm: true, min: 0.2, max: 3, step: 0.05, value: mc.fsize ?? 1, digits: 2, format: (v) => '×' + v.toFixed(2), onInput: (v) => { mc.fsize = v; }, onChange: save });
	// всё, что настраивает морфинг под музыку, собирается ниже, когда готов живой индикатор уровня
	const morphMusic = h('div', { class: 'sec-body morph-music', style: { padding: 0 } });
	const morphTime = slider({ noNorm: true, min: 0.4, max: 8, step: 0.1, value: mc.time, digits: 1, unit: ' с', onInput: (v) => { mc.time = v; }, onChange: save });
	const morphScatter = slider({ min: 0, max: 2, step: 0.05, value: mc.scatter, digits: 2, onInput: (v) => { mc.scatter = v; }, onChange: save });
	const morphStagger = slider({ min: 0, max: 3, step: 0.05, value: mc.stagger, digits: 2, onInput: (v) => { mc.stagger = v; }, onChange: save });
	const morphTurns = slider({ min: 0, max: 3, step: 0.1, value: mc.turns, digits: 1, onInput: (v) => { mc.turns = v; }, onChange: save });
	const morphGlow = slider({ min: 0, max: 1.5, step: 0.05, value: mc.glow, digits: 2, onInput: (v) => { mc.glow = v; }, onChange: save });
	const morphSort = select({ options: MORPH_SORTS.map(([value, label, sub]) => ({ value, label, sub })), value: mc.sort, onChange: (v) => { mc.sort = v; save(); syncAI(); } });
	const morphEase = segmented({ cls: 'seg-tight', options: MORPH_EASES.map(([value, label]) => ({ value, label })), value: mc.ease, onChange: (v) => { mc.ease = v; save(); } });
	const morphWeight = segmented({ options: [{ value: 'auto', label: 'Как в модели', title: 'У модели с меньшим числом точек лишние гаснут, при переходе к большей недостающие проявляются' }, { value: 'equal', label: 'Поровну', title: 'У всех моделей одинаковое число точек' }], value: mc.weight, onChange: (v) => { mc.weight = v; save(); } });
	const morphGo = button({ label: 'Следующая форма', icon: 'arrow-right', variant: 'primary', cls: 'btn-block', title: 'Запустить переход к следующей форме из списка', onClick: () => engine.morphNext() });
	const turnsRow = field('Закрутка', morphTurns.el);
	const timeRow = field('Длительность', morphTime.el);
	const intRow = field('Секунд на форму', morphInt.el);
	const liftRow = field('Объём по глубине в пути', morphLift.el);
	const scrubRow = field('Вручную', morphScrub.el);
	const morphSettings = h('div', { class: 'sec-body', style: { padding: 0 } },
		h('div', { class: 'fx-sub' }, 'Запуск'),
		field('Переход', morphMode.el, { wide: true }),
		intRow,
		morphMusic,
		scrubRow,
		field('Порядок форм', morphOrder.el, { wide: true }),
		field('Число точек у моделей', morphWeight.el, { wide: true }),
		h('div', { class: 'fx-sub' }, 'Переход'),
		field('Вид перехода', styleSel.el, { wide: true }),
		styleHint,
		aiBox,
		timeRow,
		field('Характер движения', morphEase.el, { wide: true }),
		h('div', { class: 'fx-sub' }, 'Движение точек'),
		field('Какие точки первыми', morphSort.el, { wide: true }),
		field('Разнобой по времени', morphStagger.el),
		field('Разлёт', morphScatter.el),
		turnsRow,
		h('div', { class: 'fx-sub' }, 'Вид в пути'),
		field('Вспышка в пути', morphGlow.el),
		field('Размер точек в пути', morphFsize.el),
		field('Обороты всей формы', morphSpin.el),
		morphGo
	);
	const morphBox = h('div', { class: 'sec-body', style: { padding: 0 } }, formsBox, morphHint, morphSettings);
	function syncMorph() {
		if (MORPH_STYLES.find((x) => x.id === mc.style)?.hidden) Object.assign(mc, MORPH_STYLES[0].v, { style: MORPH_STYLES[0].id });
		const cur = MORPH_STYLES.find((x) => x.id === mc.style) || MORPH_STYLES[0];
		styleSel.set(cur.id);
		styleHint.textContent = cur.hint;
		// у «Через 4D» больше одного оборота включает путь по расслоению Хопфа
		turnsRow.hidden = cur.id !== 'swirl' && cur.id !== 'hyper';
		if (mc.mode === 'beat') Object.assign(mc, { mode: 'music', band: 'beat', amode: 'gate' });
		intRow.hidden = mc.mode === 'music';
		morphMusic.hidden = mc.mode !== 'music';
		// под музыкой «Плавно» ползунок двигает сама музыка, но его можно перехватить рукой
		scrubRow.hidden = false;
		// под музыкой «Плавно» ходом правит громкость, длительность ничего не значит
		const follow = mc.mode === 'music' && mc.amode === 'amp';
		timeRow.hidden = follow;
		scrubRow.querySelector('.field-label') && (scrubRow.querySelector('.field-label').textContent = follow ? 'Ход перехода (ведёт музыка)' : 'Вручную');
		morphLift.set(mc.lift || 0);
		morphSpin.set(mc.spin || 0);
		morphFsize.set(mc.fsize ?? 1);
		morphMusic.sync?.();
		morphMode.set(mc.mode);
		morphTime.set(mc.time);
		morphScatter.set(mc.scatter);
		morphStagger.set(mc.stagger);
		morphTurns.set(mc.turns);
		morphGlow.set(mc.glow);
		morphSort.set(mc.sort);
		morphEase.set(mc.ease);
		syncAI();
	}
	renderForms();
	syncMorph();
	// список форм перерисовывается, только если что-то в нём поменялось (видео, модель, выбор, текущая форма): так подсказки и нажатия не сбиваются
	const refreshForms = () => {
		if (formsSigNow() !== formsSig) {
			renderForms();
			syncAI();
		}
	};
	const secSource = section('Форма', { key: 'fx-source' }, addModel, modelNote, field('Частиц', count.el), field('Размер точек', size.el), countHint);
	const secMorph = section('Морфинг', { key: 'fx-morph' }, morphBox);

	// ------------------------------------------------------------ живое число звука: полоска уровня и порог
	/**
	 * Полоска с текущим уровнем звука эффекта (число 0-100) и порогом срабатывания. Порог ставится кликом или протяжкой по полоске.
	 * @param {object} L слой эффекта @param {(v: number) => void} onThr порог изменён @param {() => void} onSave
	 */
	const pickers = new Set();
	function levelMeter(L, onThr, onSave) {
		const fill = h('div', { class: 'fx-lvl-fill' });
		const mark = h('div', { class: 'fx-lvl-mark' });
		const bar = h('div', { class: 'fx-lvl-bar' }, fill, mark);
		const num = h('div', { class: 'fx-lvl-num' });
		const lab = h('div', { class: 'fx-lvl-lab' });
		const el = h('div', { class: 'fx-lvl' }, bar, h('div', { class: 'fx-lvl-row' }, lab, num));
		let vis = false;
		new IntersectionObserver((es) => { vis = es[es.length - 1].isIntersecting; }).observe(el);
		function draw() {
			if (!vis || el.hidden) return;
			const v = engine._bandLevel(L);
			const gate = L.amode === 'gate';
			const hot = gate && v > L.thr;
			fill.style.transform = `scaleX(${Math.max(0, Math.min(1, v))})`;
			fill.classList.toggle('is-hot', hot);
			mark.hidden = !gate;
			if (gate) mark.style.left = L.thr * 100 + '%';
			num.textContent = String(Math.round(v * 100));
			lab.textContent = !engine.soundActive ? 'Нет звука: включите музыку или микрофон' : gate ? (hot ? 'Сработало' : 'Ждёт') : 'Уровень звука';
		}
		bar.addEventListener('pointerdown', (e) => {
			if (L.amode !== 'gate') return;
			const r = screenRect(bar);
			const set = (ev) => {
				L.thr = Math.max(0.05, Math.min(0.95, (ev.clientX - r.left) / r.width));
				onThr(L.thr);
				draw();
			};
			const up = () => {
				bar.removeEventListener('pointermove', set);
				bar.removeEventListener('pointerup', up);
				onSave();
			};
			bar.setPointerCapture(e.pointerId);
			bar.addEventListener('pointermove', set);
			bar.addEventListener('pointerup', up);
			set(e);
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
			// ползунок «Вручную» показывает ход перехода: его двигает музыка, кнопка или таймер; пока его тянут рукой, он не трогается
			if (!engine._scrubUser) morphScrub.set(engine.morphing ? Math.round(engine.morph * 100) : 0);
		};
		requestAnimationFrame(tick);
	})();

	// ------------------------------------------------------------ морфинг под музыку: те же настройки звука, что у эффектов
	{
		const pct = (v) => Math.round(v * 100);
		const tm = (v) => (v < 0.1 ? Math.round(v * 1000) + ' мс' : v.toFixed(2) + ' с');
		const thr = slider({ noNorm: true, min: 0.05, max: 0.95, step: 0.01, value: mc.thr, format: (v) => String(pct(v)), onInput: (v) => { mc.thr = v; }, onChange: save });
		const gap = slider({ noNorm: true, min: 0.2, max: 12, step: 0.1, value: mc.gap ?? 1, digits: 1, unit: ' с', onInput: (v) => { mc.gap = v; }, onChange: save });
		const react = slider({ min: 0, max: 1, step: 0.05, value: mc.react ?? 0.6, format: (v) => pct(v) + '%', onInput: (v) => { mc.react = v; }, onChange: save });
		const atk = slider({ log: true, min: 0.01, max: 2, step: 0.005, value: mc.atk, format: tm, onInput: (v) => { mc.atk = v; }, onChange: save });
		const rel = slider({ log: true, min: 0.03, max: 4, step: 0.01, value: mc.rel, format: tm, onInput: (v) => { mc.rel = v; }, onChange: save });
		const autoThr = button({
			label: 'Подобрать порог по музыке',
			icon: 'lightning',
			variant: 'secondary',
			cls: 'btn-block',
			title: 'Порог ставится между фоновым уровнем и пиками за последние секунды',
			onClick: () => {
				const t = engine.autoThreshold(mc);
				if (t === null) {
					app.toast('Включите музыку или микрофон и подождите пару секунд: порог подбирается по тому, что слышит морфинг', 'info');
					return;
				}
				mc.thr = t;
				thr.set(t);
				save();
			},
		});
		const meter = levelMeter(mc, (v) => thr.set(v), save);
		const band = segmented({
			cls: 'seg-tight',
			options: BANDS.filter((b) => ['bass', 'mid', 'high', 'beat'].includes(b.id)).map((b) => ({ value: b.id, label: b.label, title: b.title })),
			value: mc.band === 'none' ? 'bass' : mc.band,
			onChange: (v) => {
				mc.band = v;
				save();
				meter.draw();
			},
		});
		const mode = segmented({
			cls: 'seg-tight',
			options: [
				{ value: 'gate', label: 'Скачок', title: 'Когда выбранные частоты громче порога, форма переходит к следующей' },
				{ value: 'amp', label: 'Плавно', title: 'Форма идёт за громкостью: тихо это прежняя форма, громко это следующая' },
			],
			value: mc.amode === 'amp' ? 'amp' : 'gate',
			onChange: (v) => {
				mc.amode = v;
				save();
				morphMusic.sync();
				syncMorph();
			},
		});
		const note = h('div', { class: 'field-hint' });
		const gateBox = h('div', { class: 'sec-body', style: { padding: 0 } }, field('Порог срабатывания', thr.el), autoThr, field('Не чаще, чем раз в', gap.el));
		const ampBox = h('div', { class: 'sec-body', style: { padding: 0 } }, field('Чувствительность', react.el), field('Отклик вверх', atk.el), field('Отклик вниз', rel.el));
		morphMusic.append(field('Слушает', band.el, { wide: true }), meter.el, field('Как реагирует', mode.el, { wide: true }), gateBox, ampBox, note);
		morphMusic.sync = () => {
			if (mc.band === 'none' || mc.band === 'custom') mc.band = 'bass';
			band.set(mc.band);
			mode.set(mc.amode === 'amp' ? 'amp' : 'gate');
			const amp = mc.amode === 'amp';
			gateBox.hidden = amp;
			ampBox.hidden = !amp;
			thr.set(mc.thr);
			gap.set(mc.gap ?? 1);
			react.set(mc.react ?? 0.6);
			atk.set(mc.atk);
			rel.set(mc.rel);
			note.textContent = amp
				? 'Форма идёт за громкостью: тихо это прежняя форма, громко это следующая. Дошла до конца, закрепилась, и после затишья начинается путь к следующей.'
				: 'Всплеск выбранных частот переключает форму на следующую.';
			meter.draw();
		};
		morphMusic.sync();
		syncMorph();
	}

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
	const ANIM_LAYERS = ['morph', 'curl', 'wave', 'twist', 'pulse', 'blast', 'voxel', 'glitch', 'slice', 'links', 'feedback', 'datamosh', 'echo', 'dissolve', 'spectrum', 'physics', 'rotate', 'bloom', 'gravity', 'scope', 'depth', 'trail', 'vscreen', 'shoots', 'hyper', 'slitscan', 'chladni', 'shadow', 'pixelsort'];
	let toggleAnim = () => {};
	let animAddFromInspector = () => {};
	// строка состояния выделения у «Шлейфа движения» (обновляется в sync)
	let chronoStat = null;
	const animQuickBtn = button({
		label: 'Секвенсор анимации',
		icon: 'film-strip',
		variant: 'secondary',
		cls: 'btn-block fx-anim-quick-btn',
		title: 'Открыть таймлайн для анимации эффектов и камеры',
		onClick: () => toggleAnim()
	});
	// эффекты только для открытого видео, фото или персонажа с анимацией стоят вверху списка и отделены линией; без такого материала их нет
	const SPECIAL = { 'Видео': 1, 'Анимация': 1 };
	const special = h('div', { class: 'fx-special', hidden: true });
	left.append(special);
	for (const grp of FX_GROUP_NAMES) {
		const folder = h('div', { class: 'fx-folder' });
		const fhead = h('button', { type: 'button', class: 'fx-folder-head', 'aria-expanded': 'true' }, h('span', { class: 'fx-folder-caret', html: icon('caret-down', 13) }), h('span', { class: 'fx-folder-name' }, grp), h('span', { class: 'fx-folder-n' }));
		const fbody = h('div', { class: 'fx-folder-body' });
		fhead.addEventListener('click', () => {
			const closed = folder.classList.toggle('is-closed');
			fhead.setAttribute('aria-expanded', String(!closed));
		});
		folder.append(fhead, fbody);
		(SPECIAL[grp] ? special : left).append(folder);
		for (const def of FX_LAYERS.filter((d) => d.group === grp && !d.hidden)) {
			st.layers[def.id] = { ...def.def, ...(st.layers[def.id] || {}) };
			const L = st.layers[def.id];
			const sw = toggle({
				value: L.on,
				label: def.name,
				onChange: (v) => {
					L.on = v;
					card.classList.toggle('is-on', v);
					insp.classList.toggle('is-off', !v);
					if (v) {
						select_(def.id);
						fxTabHook();
					}
					countActive();
					save();
				},
			});
			const amount = slider({ noNorm: true, min: 0, max: def.max, step: 0.05, value: L.amount, digits: 2, onInput: (v) => { L.amount = v; }, onChange: save });
			const body = h('div', { class: 'fx-layer-body' });
			// направление сноса датамоша теперь стрелками по 45°: старые значения прилипают к ближайшей стрелке
			if (def.id === 'datamosh' && typeof L.angle === 'number') L.angle = (((Math.round(L.angle / 45) * 45) % 360) + 360) % 360;
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
				body.append(h('div', { class: 'field-hint' }, 'Видео раскладывается на кадры, кадры собираются в блок из точек. Текущий кадр рисуется густо, остальные реже. Что сейчас показано, задаёт таймлайн внизу: играйте и перематывайте видео, блок следует за ним. Остальные эффекты работают поверх блока, «Объём по глубине» выдавливает каждый кадр по его карте глубины.'), button({ label: 'Снять кадры заново', icon: 'film-strip', variant: 'secondary', cls: 'btn-block', title: 'Снять кадры с видео заново с текущими настройками', onClick: () => engine.rebuildFramesSoon() }));
			} else if (def.id === 'chrono') {
				// как сейчас выделяется объект: нейросеть загружается при первом включении, пока она грузится, выделяется движение
				chronoStat = h('div', { class: 'field-hint fx-chrono-stat' });
				body.append(chronoStat);
			} else if (def.id === 'brush') {
				const clearBtn = button({
					label: 'Смыть всю краску',
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
					else if (I.src === 'file') t = I.file ? 'Своя карта глубины: ' + I.file + '. Светлое ближе, тёмное дальше' + (I.frames ? ', одна карта на все кадры.' : '.') : 'Загрузите картинку с картой глубины: светлое ближе, тёмное дальше. Пока видна карта по яркости.';
					else if (I.frames && I.src === 'luma') t = 'Раскадровка: у каждого кадра своя карта по яркости, светлое ближе. Для настоящей глубины выберите «Нейросеть».';
					else if (I.frames && I.phase === 'ready') t = I.fOk >= I.fAll ? 'Раскадровка: нейросеть посчитала глубину всех кадров (' + I.fAll + ').' : 'Раскадровка: нейросеть считает глубину кадров, ' + I.fOk + ' из ' + I.fAll + '. Остальные пока по яркости.';
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
			// у раскадровки и шлейфа «Силы» нет: кольцо кадров либо собрано, либо нет, а степень задают число кадров, точки и глубина
			if (def.id !== 'frames' && def.id !== 'chrono') body.append(field('Сила', amount.el));
			const extraCtl = {};
			const whenList = [];
			// разделы с заголовками сворачиваются: открыт первый, остальные закрыты, чтобы настройки не занимали полэкрана
			let cur = body;
			const groups = [];
			const put = (el, ex) => {
				cur.append(el);
				if (ex.when) whenList.push([el, ex.when]);
			};
			const startGroup = (label, open) => {
				const g = { open, box: h('div', { class: 'fx-grp-body' }) };
				g.head = h('button', { type: 'button', class: 'fx-sub fx-sub-toggle', 'aria-expanded': String(g.open) }, h('span', { class: 'ic-wrap', html: icon('caret-down', 12) }), label);
				g.head.addEventListener('click', () => {
					g.open = !g.open;
					g.head.setAttribute('aria-expanded', String(g.open));
					applyWhen();
				});
				groups.push(g);
				body.append(g.head, g.box);
				cur = g.box;
			};
			// у эффекта много настроек и нет своих разделов: первые пять на виду, остальные сворачиваются в «Ещё настройки»
			const autoSplit = !def.extras.some((x) => x.type === 'title') && def.extras.filter((x) => x.key).length > 7;
			let ctlN = 0;
			const applyWhen = () => {
				whenList.forEach(([el, w]) => (el.hidden = !w[1].includes(L[w[0]])));
				groups.forEach((g) => {
					const any = [...g.box.children].some((c) => !c.hidden);
					g.head.hidden = !any;
					g.box.hidden = !any || !g.open;
				});
			};
			if (def.extras.some((x) => x.key) && def.extras[0].type !== 'title' && def.extras[0].type !== 'row') body.append(h('div', { class: 'fx-sub' }, 'Параметры'));
			for (const ex of def.extras) {
				if (autoSplit && ex.key && ++ctlN === 6) startGroup('Ещё настройки', false);
				const after = () => {
					applyWhen();
					save();
					if (ex.relink) engine.relink();
					if (ex.reframe) engine.rebuildFramesSoon();
					if (ex.relayout) engine.relayoutFrames();
				};
				if (ex.type === 'select') {
					const sl = select({ options: ex.options.map(([value, label, sub]) => ({ value, label, sub })), value: L[ex.key], onChange: (v) => { L[ex.key] = v; after(); } });
					extraCtl[ex.key] = sl;
					put(field(ex.label, sl.el, { wide: true }), ex);
				} else if (ex.type === 'button') {
					const bt = button({
						label: ex.label,
						icon: ex.icon,
						variant: 'secondary',
						cls: ex.preset ? 'btn-sm' : 'btn-block',
						onClick: () => {
							if (ex.preset) {
								engine[ex.fn || 'moshPreset'](L, ex.preset);
								for (const [k, ctl] of Object.entries(extraCtl)) ctl.set(L[k]);
								amount.set(L.amount);
								applyWhen();
								save();
								engine.emit();
							} else engine[ex.act]();
						},
					});
					put(bt, ex);
				} else if (ex.type === 'row') {
					// несколько кнопок в один ряд: действия или готовые настройки (чипы)
					const row = h('div', { class: 'fx-btn-row' + (ex.chips ? ' is-chips' : '') });
					for (const it of ex.items) {
						const bt = button({
							label: it.label,
							icon: it.icon,
							variant: it.primary ? 'primary' : 'secondary',
							cls: 'btn-sm',
							onClick: () => {
								if (it.preset) {
									engine[it.fn || ex.fn || 'moshPreset'](L, it.preset);
									for (const [k, ctl] of Object.entries(extraCtl)) ctl.set(L[k]);
									amount.set(L.amount);
									row.querySelectorAll('.btn').forEach((b) => b.classList.toggle('is-picked', b === bt));
									applyWhen();
									save();
									engine.emit();
								} else engine[it.act]();
							},
						});
						row.append(bt);
					}
					put(row, ex);
				} else if (ex.type === 'note') {
					put(h('div', { class: 'field-hint' }, ex.text), ex);
				} else if (ex.type === 'title') {
					startGroup(ex.label, ex.open ?? groups.length === 0);
				} else if (ex.type === 'color') {
					const ctl = colorChoice(L, ex.key, after, !!ex.natural);
					extraCtl[ex.key] = ctl;
					put(field(ex.label, ctl.el, { wide: true }), ex);
				} else if (ex.type === 'seg') {
					const sg = segmented({ cls: ex.options.length > 3 ? 'seg-tight' : undefined, options: ex.options.map(([value, label]) => ({ value, label })), value: L[ex.key], onChange: (v) => { L[ex.key] = v; after(); } });
					extraCtl[ex.key] = sg;
					put(field(ex.label, sg.el, { wide: true }), ex);
				} else {
					const sl = slider({ noNorm: !!ex.noNorm || !!(ex.int && /сколько|число|копий|кадров|точек|узлов|слоёв|перьев|колонок|линий|рамок/i.test(ex.label)), min: ex.min, max: ex.max, step: ex.step, value: L[ex.key], digits: ex.int ? 0 : ex.noNorm ? 1 : 2, unit: ex.unit, log: ex.log, format: ex.log ? (v) => formatInt(v) : undefined, onInput: (v) => { L[ex.key] = v; if (ex.relayout) engine.relayoutFrames(); }, onChange: after });
					extraCtl[ex.key] = sl;
					put(field(ex.label, sl.el), ex);
				}
			}
			applyWhen();
			const react = slider({ min: 0, max: 1, step: 0.05, value: L.react, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { L.react = v; }, onChange: save });
			const reactRow = field('Сила реакции', react.el);
			const modeSeg = segmented({
				cls: 'seg-tight',
				options: [{ value: 'gate', label: 'Резко', title: 'Эффект включается, когда число звука выше порога, и гаснет после' }, { value: 'amp', label: 'Плавно', title: 'Сила эффекта плавно следует за числом звука' }],
				value: L.amode,
				onChange: (v) => {
					L.amode = v;
					audioUiFull();
					save();
				},
			});
			const pct = (v) => Math.round(v * 100);
			const thr = slider({ noNorm: true, min: 0.05, max: 0.95, step: 0.01, value: L.thr, format: (v) => String(pct(v)), onInput: (v) => { L.thr = v; }, onChange: save });
			const atk = slider({ log: true, min: 0.005, max: 1, step: 0.005, value: L.atk, format: (v) => (v < 0.1 ? Math.round(v * 1000) + ' мс' : v.toFixed(2) + ' с'), onInput: (v) => { L.atk = v; }, onChange: save });
			const rel = slider({ log: true, min: 0.03, max: 4, step: 0.01, value: L.rel, format: (v) => (v < 0.1 ? Math.round(v * 1000) + ' мс' : v.toFixed(2) + ' с'), onInput: (v) => { L.rel = v; }, onChange: save });
			const autoThr = button({
				label: 'Подобрать порог по музыке',
				icon: 'lightning',
				variant: 'secondary',
				cls: 'btn-block',
				title: 'Порог ставится между фоновым уровнем и пиками за последние секунды',
				onClick: () => {
					const t = engine.autoThreshold(L);
					if (t === null) {
						app.toast('Включите музыку или микрофон и подождите пару секунд: порог подбирается по тому, что слышит эффект', 'info');
						return;
					}
					L.thr = t;
					thr.set(t);
					save();
				},
			});
			const gateBox = h('div', { class: 'sec-body', style: { padding: 0 } }, field('Порог срабатывания', thr.el), autoThr, field('Гаснет за', rel.el));
			const picker = levelMeter(L, (v) => thr.set(v), save);
			// частоты: четыре понятные полосы; «Своя» остаётся только у старых проектов, где она уже выбрана
			const band = segmented({
				cls: 'seg-tight',
				options: BANDS.filter((b) => b.id !== 'custom' || L.band === 'custom').map((b) => ({ value: b.id, label: b.label, title: b.title })),
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
			const audioWrap = h('div', { class: 'fx-grp-body' }, field('Слушает', band.el, { wide: true }), picker.el, modeRow, reactRow, gateBox);
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
			// у эффектов, которые звук не слушают (распад, раскадровка, руки, следы времени), блока нет: раньше он был, но ничего не делал
			if (def.sound !== false) body.append(audioHead, audioWrap);
			syncAudioHead();
			audioUiFull();
			const prevCanvas = h('canvas', { class: 'fx-prev', 'aria-hidden': 'true' });
			const row = h('div', { class: 'fx-layer-head', role: 'button', tabindex: '0' }, prevCanvas, h('span', { class: 'fx-layer-title' }, def.name), sw.el);
			const card = h('div', { class: 'fx-layer' + (L.on ? ' is-on' : ''), 'data-layer': def.id, 'data-tip': def.hint, 'data-tip-pos': 'right', 'data-tip-delay': '1300' }, row);
			const insp = h('div', { class: 'fx-insp', 'data-layer': def.id }, body);
			// у выключенного эффекта настройки приглушены: их можно менять, но видно, что эффект сейчас не работает
			insp.classList.toggle('is-off', !L.on);
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
	const hiddenGrp = (c) => c.def.group === 'Видео' || c.def.group === 'Анимация';
	select_((cards.find((c) => c.L.on && !hiddenGrp(c)) || cards.find((c) => !hiddenGrp(c)) || cards[0]).def.id);
	// ------------------------------------------------------------ звук
	const sourceSeg = segmented({
		options: [
			{ value: 'synth', label: 'Музыка', title: 'Встроенная музыка: эмбиент, джангл, брейккор' },
			{ value: 'file', label: 'Файл', title: 'Загрузить свой аудиофайл' },
			{ value: 'video', label: 'Видео', title: 'Звук из открытого видео или из видео «Экрана»' },
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
	const style = select({ options: SYNTH_STYLES.map((s) => ({ value: s.id, label: s.name, sub: s.sub || s.desc })), value: st.audio.style, onChange: (v) => engine.useSynth(v).then(sync) });
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
		const idle_ = cards.filter((c) => !(c.L.on && c.L.band !== 'none') && c.L.band !== undefined && c.def.sound !== false);
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
				options: [{ value: '', label: 'Добавить эффект…' }, ...idle_.map((c) => ({ value: c.def.id, label: c.def.name, sub: c.L.on ? 'Слушать аудио' : 'Включить и связать' }))],
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
			// линии и срезы, окрашенные естественным цветом модели, берут цвет новой палитры
			for (const c of cards) {
				if (c.def.extras.some((x) => x.type === 'color' && x.natural) && c.L.color === 'model') {
					c.L.color = 'auto';
					c.extraCtl.color?.set('auto');
				}
			}
			sync();
			save();
		});
		palBtns.set(p.id, b);
		palettes.append(b);
	}
	// вид точек общий с вкладкой «Точки»: одни и те же настройки, без дублей
	const colorBy = select({ options: COLOR_BY_UI.map((c) => ({ value: c.id, label: c.label, sub: c.title })), value: st.look.colorBy, onChange: (v) => { engine.setColorBy(v); } });
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
	const animSec = slider({ noNorm: true, min: 1, max: 15, step: 1, value: anim.seconds, digits: 0, unit: ' с', onInput: (v) => { anim.seconds = v; } });
	const animBtn = button({ label: 'Записать и сохранить', icon: 'record', variant: 'primary', cls: 'btn-block', onClick: () => engine.saveAnimation({ format: anim.format, seconds: anim.seconds }) });
	const animInfo = h('div', { class: 'field-hint' }, 'Запишется то, что сейчас видно на сцене, вместе со всеми эффектами.');
	const rset = app.settings.render;
	const autoQ = switchRow('Авто-качество', { value: rset.autoQuality, onChange: (v) => { rset.autoQuality = v; app.saveSettings(); } });
	const capSeg = segmented({ cls: 'seg-tight', options: [{ value: 0, label: 'Без лимита' }, { value: 30, label: '30 к/с', title: 'Вдвое меньше нагрузка на видеокарту и нагрев' }], value: rset.fpsCap, onChange: (v) => { rset.fpsCap = Number(v); app.saveSettings(); } });
	const backendSeg = segmented({ cls: 'seg-tight', options: [{ value: 'auto', label: 'Авто' }, { value: 'webgpu', label: 'WebGPU', title: 'Современный движок: быстрее на Windows и без подвисаний при включении эффектов' }, { value: 'webgl', label: 'WebGL', title: 'Проверенный движок: работает везде' }], value: rset.backend || 'auto', onChange: (v) => { rset.backend = v; app.saveSettings(); app.toast('Движок сменится при следующем входе в «Эффекты»', 'info'); } });
	const backendHint = h('div', { class: 'field-hint' }, 'Применится при следующем входе в «Эффекты». «Авто» выбирает WebGPU там, где он быстрее (Windows), и сам возвращается на WebGL, если WebGPU не заработал.');
	const perfHint = h('div', { class: 'field-hint' }, 'Авто-качество снижает чёткость, только пока компьютеру не хватает кадров, и возвращает её, когда запас появляется. Эффекты и цвета не меняются.');
	const hudSw = switchRow('Индикаторы уровней звука', { value: st.look.hud, onChange: (v) => { st.look.hud = v; save(); } });
	const hudSpec = switchRow('Спектр внизу', { value: st.look.hudSpectrum, onChange: (v) => { st.look.hudSpectrum = v; save(); } });
	const attSw = switchRow('Мельче вдали', { value: pset.attenuate, onChange: (v) => { pset.attenuate = v; app.saveSettings(); } });
	const sizeNoise = slider({ min: 0, max: 2, step: 0.05, value: st.look.sizeNoise || 0, digits: 2, onInput: (v) => { st.look.sizeNoise = v; }, onChange: save });
	const sizeAudio = slider({ min: 0, max: 2, step: 0.05, value: st.look.sizeAudio || 0, digits: 2, onInput: (v) => { st.look.sizeAudio = v; }, onChange: save });
	const shade = slider({ min: 0, max: 1, step: 0.05, value: st.look.shade || 0, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.shade = v; }, onChange: save });
	const glow = slider({ min: 0, max: 1, step: 0.05, value: st.look.glow, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { st.look.glow = v; }, onChange: save });
	const bright = slider({ min: 0, max: 2, step: 0.05, value: st.look.bright, digits: 2, onInput: (v) => { st.look.bright = v; }, onChange: save });
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
	// общие с редактором настройки: поле зрения и показ FPS читаются и работают там же одинаково
	const fovFx = slider({ noNorm: true, min: 10, max: 100, step: 1, value: rset.fov, digits: 0, unit: '°', onInput: (v) => { rset.fov = v; app.nav.applyCamera(); }, onChange: () => app.saveSettings() });
	const fpsFx = switchRow('Показывать FPS', { value: rset.fps, onChange: (v) => { rset.fps = v; app.ui.refreshFps(); app.saveSettings(); } });
	// те же блоки и названия, что во вкладке «Вид» редактора
	const secLookPts = section('Цвет и форма точек', { key: 'fx-look-pts' }, palettes, origBtn, field('Форма точек и символы', shapeTiles, { wide: true }), attSw.el, field('Цвет точек', colorBy.el), solidRow, field('Размер по шуму', sizeNoise.el), field('Размер по звуку', sizeAudio.el), field('Точки', blend.el, { wide: true }));
	const secLookLight = section('Свет и фон', { key: 'fx-look-light' }, field('Яркость', bright.el), field('Объём (тень)', shade.el), field('Свечение', glow.el), field('Блум (свечение)', bloom.el), field('Хром. аберрация', aberration.el));
	const secLookCam = section('Камера', { key: 'fx-look-cam' }, field('Поле зрения', fovFx.el), dofOn.el, dofBody, rotate.el, rotSpeedRow);
	const secLookShow = section('Отображение', { key: 'fx-look-show' }, hudSw.el, hudSpec.el);
	const secLookPerf = section('Производительность', { key: 'fx-look-perf', open: false }, autoQ.el, field('Лимит кадров', capSeg.el, { wide: true }), field('Движок отрисовки', backendSeg.el, { wide: true }), backendHint, fpsFx.el, perfHint);
	const secLookRec = section('Запись анимации', { key: 'fx-look-rec', open: false }, animTimelineOpenBtn, field('Формат', animFmt.el, { wide: true }), field('Длина', animSec.el), animBtn, animInfo);

	const secMedia = createMediaPanel(app, null, { fx: true }).section;
	// вкладки-плашки вместо длинного списка: Эффект, Форма, Медиа, Зона, Звук, Вид
	const FX_TABS = [['insp', 'Эффект', 'sparkle', [secInsp]], ['source', 'Форма', 'cube', [secSource, secMorph, secMedia]], ['zone', 'Звук', 'equalizer', [secAudio]], ['look', 'Вид', 'sliders-horizontal', [secLookPts, secLookLight, secLookCam, secLookShow, secLookPerf, secLookRec]]];
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
	// кисть: кнопка фиксирует камеру, чтобы протяжка рисовала, а не вращала сцену
	const paintBtn = iconButton({ icon: 'paint-brush', title: '', cls: 'fx-paint-lock-btn', onClick: () => { const B = st.layers.brush; B.lock = B.lock === 'off' ? 'on' : 'off'; engine.touch(); engine.emit(); sync(); app.toast(B.lock === 'off' ? 'Камера снова крутится протяжкой' : 'Камера зафиксирована: протяжка рисует. Alt + протяжка вращает сцену', 'info', 2400); } });
	paintBtn.hidden = true;
	const camBtn = iconButton({ icon: 'video-camera', title: 'Камера: управление руками и пальцами', onClick: () => engine.toggleMotionCam().then(sync) });
	const barMeters = makeMeters(true);
	const recBtn = iconButton({ icon: 'record', title: 'Параметры записи видео', cls: 'fx-rec' });
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
	/** Естественная высота: дорожки или колонка свойств (что выше), но не больше 480 */
	function maxAnimH() {
		const body = animPanel.querySelector('.fx-anim-body');
		if (!body || animPanel.hidden) return 480;
		const kids = [...body.children].filter((el) => !el.hidden && el.offsetHeight > 0);
		const gap = parseFloat(getComputedStyle(body).rowGap) || 0;
		const natural = kids.reduce((a, el) => a + el.offsetHeight, 0) + gap * Math.max(0, kids.length - 1);
		const chrome = animPanel.offsetHeight - body.clientHeight;
		return Math.max(150, Math.min(480, Math.ceil(chrome + Math.max(natural, inspNatural()))));
	}
	/** Сколько нужно колонке свойств, чтобы поместиться без прокрутки (0, если она закрыта) */
	function inspNatural() {
		const insp = animPanel.querySelector('.fx-clip-panel');
		if (!insp || insp.classList.contains('is-shut')) return 0;
		const bar = insp.querySelector('.fxf-bar');
		const bd = insp.querySelector('.fx-clip-body');
		return (bar ? bar.offsetHeight : 0) + (bd ? bd.scrollHeight : 0) + 2;
	}
	// высота на экране: выбранная пользователем (curH), но когда открывается колонка свойств, таймлайн подрастает под неё (не выше 360 px и 45% окна)
	let shownH = curH;
	const setShownH = (v) => {
		shownH = v;
		document.documentElement.style.setProperty('--fx-anim-h', v + 'px');
	};
	function clampAnimH() {
		const m = maxAnimH();
		if (curH > m) curH = m;
		if (shownH > m) setShownH(m);
	}
	function growForInspector(open) {
		if (!open) {
			if (shownH !== curH) setShownH(curH);
			return;
		}
		const main = animPanel.querySelector('.fx-anim-main');
		const chrome = animPanel.offsetHeight - (main ? main.clientHeight : 0);
		const want = Math.min(360, Math.round((window.innerHeight / uiZoom()) * 0.45), inspNatural() + chrome);
		if (want > shownH) setShownH(want);
	}
	let isResizingH = false;
	let resizeStartY = 0;
	let resizeStartH = 245;
	resizeHandle.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		isResizingH = true;
		resizeStartY = e.clientY;
		resizeStartH = shownH;
		resizeHandle.setPointerCapture(e.pointerId);
		document.body.classList.add('is-resizing-h');
		const onMove = (ev) => {
			if (!isResizingH) return;
			const dy = (resizeStartY - ev.clientY) / uiZoom();
			curH = Math.max(150, Math.min(480, Math.round(resizeStartH + dy)));
			curH = Math.min(curH, maxAnimH());
			setShownH(curH);
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
		setShownH(245);
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
	// выбор нескольких блоков: selClip это главный (последний) блок, selSet хранит все выбранные
	const selSet = new Set();
	const selList = () => (st.anim.clips || []).filter((c) => selSet.has(c.id));
	const selectOnly = (c) => {
		selSet.clear();
		if (c) selSet.add(c.id);
		selClip = c || null;
		if (c) selKey = null;
	};
	const toggleSel = (c) => {
		if (selSet.has(c.id)) {
			selSet.delete(c.id);
			if (selClip === c) selClip = selList()[0] || null;
		} else {
			selSet.add(c.id);
			selClip = c;
		}
		selKey = null;
	};
	let clipboard = [];
	const laneSt = (id) => (st.anim.lanes && st.anim.lanes[id]) || {};
	const blockEls = new Map();
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

	/** Масштаб шкалы. anchor: { t, x } время и положение курсора мыши в окне шкалы, которые должны остаться на месте (по умолчанию курсор времени) */
	function setZoom(z, anchor) {
		z = Math.max(ZMIN, Math.min(ZMAX, z));
		const dur = st.anim.dur || 8;
		const viewW = scroller.clientWidth;
		const t = anchor ? anchor.t : engine.animT;
		const xInView = anchor ? anchor.x : Math.max(0, Math.min(viewW, (t / dur) * viewW * animZoom - scroller.scrollLeft));
		animZoom = z;
		zoomVal.textContent = (Math.round(z * 10) / 10) + 'x';
		scroller.style.setProperty('--fx-anim-zoom', z);
		stage.classList.toggle('is-zoomed', z > 1);
		// время под курсором остаётся под курсором
		scroller.scrollLeft = Math.max(0, (t / dur) * viewW * z - xInView);
		renderRuler();
		animSync();
	}

	// скорость воспроизведения таймлайна: каждый клик берёт следующее значение по кругу
	const SPEEDS_A = [0.5, 1, 1.5, 2];
	const aSpeed = h('button', { type: 'button', class: 'fx-anim-speed', 'data-tip': 'Скорость воспроизведения: нажмите, чтобы переключить' }, '1×');
	aSpeed.addEventListener('click', () => {
		const i = SPEEDS_A.indexOf(st.anim.speed || 1);
		st.anim.speed = SPEEDS_A[(i + 1) % SPEEDS_A.length];
		engine.touch();
		animSync();
	});
	const aTransport = h('div', { class: 'fx-anim-transport' }, aPlay, aTimecode, aSpeed, zoomBox);

	// Встроенная интерактивная полка сценариев и добавления эффектов
	const shelf = h('div', { class: 'fx-anim-shelf', hidden: true });
	let currentShelf = null;

	const closeShelf = () => {
		shelf.hidden = true;
		currentShelf = null;
		addClipBtn.classList.remove('is-active');
	};

	function openEffectsShelf() {
		if (currentShelf === 'effects' && !shelf.hidden) {
			closeShelf();
			return;
		}
		currentShelf = 'effects';
		addClipBtn.classList.add('is-active');

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
		title: 'Запомнить текущий ракурс камеры в момент времени, где стоит курсор (C). Повернули сцену, нажали, и камера будет возвращаться сюда',
		onClick: (e) => {
			e.stopPropagation();
			addCamKey();
		}
	});
	const quickWrap = h('div', { class: 'fx-anim-quick' }, addClipBtn, camKeyBtn);

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
		title: 'Проиграет анимацию один раз и запишет MP4. Разрешение, качество и покадровая запись берутся из параметров записи (кнопка записи внизу)',
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
		title: 'Магнит: блоки прилипают к курсору, краям других блоков и целым секундам (Alt при перетаскивании отключает)',
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
		if (st.anim.work) pts.push(st.anim.work.a, st.anim.work.b);
		for (const k of st.anim.keys || []) pts.push(k.t);
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
	const aClear = iconButton({
		icon: 'trash',
		title: 'Очистить таймлайн: блоки и ключи камеры',
		cls: 'fx-anim-clear',
		onClick: async () => {
			const A = st.anim;
			if (!(A.clips || []).length && !(A.keys || []).length) return;
			const ok = await app.ui.choose({ title: 'Очистить таймлайн?', text: 'Удалятся все блоки эффектов, ключи камеры и рабочая область. Отменить можно через Ctrl+Z.', buttons: [{ label: 'Не очищать', value: false }, { label: 'Очистить', variant: 'primary', value: true }] });
			if (!ok) return;
			engine.animClear();
			selectOnly(null);
			animSync();
		}
	});
	const aSettings = h('div', { class: 'fx-anim-settings' }, aSnap, aLoop, aDurBox, aClear, aRec);

	const topBar = h('div', { class: 'fx-anim-topbar' }, aTransport, quickWrap, aSettings);

	// 2. Область дорожек (Stage)
	const stage = h('div', { class: 'fx-anim-stage' });

	// Линейка времени
	const rulerTitle = h('div', { class: 'fx-anim-track-label fx-anim-ruler-title' }, 'Время');
	const rulerTicks = h('div', { class: 'fx-anim-ruler-ticks' });
	const rulerNeedle = h('div', { class: 'fx-anim-playhead-needle' });
	const rulerWork = h('div', { class: 'fx-anim-work', hidden: true });
	const rulerBody = h('div', { class: 'fx-anim-ruler-body' }, rulerWork, rulerTicks, rulerNeedle);
	const rulerRow = h('div', { class: 'fx-anim-ruler-row' }, rulerBody);

	// Дорожка камеры
	// готовые движения камеры: меню у подписи дорожки (и по правой кнопке на ней)
	const camMenu = (x, y) =>
		openCtx(x, y, [
			{ label: 'Облёт вокруг', icon: 'arrows-clockwise', onClick: () => camPreset('orbit') },
			{ label: 'Наезд', icon: 'arrows-in', onClick: () => camPreset('push') },
			{ label: 'Отъезд', icon: 'arrows-out-simple', onClick: () => camPreset('pull') },
			{ label: 'Подъём над сценой', icon: 'arrows-vertical', onClick: () => camPreset('rise') },
			{ label: 'Дуга', icon: 'path', onClick: () => camPreset('arc') },
			'-',
			{ label: 'Удалить ключи камеры', icon: 'trash', danger: true, disabled: !(st.anim.keys || []).length, onClick: () => { st.anim.keys = []; selKey = null; engine.touch(); animSync(); } },
		]);
	const camPreset = (id) => {
		engine.animCamPreset(id);
		selKey = null;
		app.toast({ orbit: 'Облёт вокруг сцены расставлен от текущего ракурса', push: 'Наезд расставлен от текущего ракурса', pull: 'Отъезд расставлен от текущего ракурса', rise: 'Подъём над сценой расставлен от текущего ракурса', arc: 'Дуга расставлена от текущего ракурса' }[id], 'info', 1800);
		animSync();
	};
	const camPresetBtn = iconButton({ icon: 'magic-wand', title: 'Готовые движения камеры', size: 13, cls: 'fx-anim-cam-preset', onClick: (e) => { e.stopPropagation(); const r = screenRect(e.currentTarget); camMenu(r.left, r.bottom + 4); } });
	const camTitle = h('div', { class: 'fx-anim-track-label fx-anim-cam-label' },
		h('span', { class: 'ic-wrap', html: icon('video-camera', 14) }),
		h('span', { class: 'fx-anim-lane-name' }, 'Камера'),
		camPresetBtn
	);
	camTitle.addEventListener('contextmenu', (e) => {
		e.preventDefault();
		camMenu(e.clientX, e.clientY);
	});
	const camKeysWrap = h('div', { class: 'fx-anim-keys' });
	const camLine = h('div', { class: 'fx-anim-cam-line' });
	const camTrackBody = h('div', { class: 'fx-anim-lane-body fx-anim-cam-body' }, camLine, camKeysWrap);
	const camLane = h('div', { class: 'fx-anim-lane fx-anim-cam-lane' }, camTrackBody);

	// Дорожка персонажа: когда в клипе какие кости двигаются. Клип повторяется по кругу на всю длину таймлайна, поэтому полоса стоит под общей линейкой времени
	const charArrow = h('span', { class: 'ic-wrap fx-anim-char-arrow', html: icon('caret-right', 12) });
	const charSub = h('span', { class: 'fx-anim-char-sub' });
	const charTitle = h('div', { class: 'fx-anim-track-label fx-anim-char-label', role: 'button', tabindex: '0', 'data-tip': 'Яркость показывает, как сильно движется модель. Нажмите, чтобы увидеть отдельные кости и настройки анимации', 'data-tip-pos': 'right' }, charArrow, h('span', { class: 'fx-anim-char-names' }, h('span', { class: 'fx-anim-lane-name' }, 'Анимация'), charSub));
	const charCanvas = h('canvas', { class: 'fx-anim-char-canvas' });
	const charBody = h('div', { class: 'fx-anim-lane-body fx-anim-char-body', 'data-tip': 'Яркая полоса: кости движутся. Тёмная: модель почти стоит. Тонкие линии: начало нового повтора клипа', 'data-tip-pos': 'top' }, charCanvas);
	const charSet = createAnimSettings(app);
	const charSetRow = h('div', { class: 'fx-anim-char-set' }, charSet.el);
	charSetRow.hidden = true;
	const charLane = h('div', { class: 'fx-anim-lane fx-anim-char-lane' }, charBody);
	charLane.hidden = true;
	charTitle.hidden = true;
	// подпись слева стоит в своей колонке и должна быть той же высоты, что и полоса справа
	const charSetSpacer = h('div', { class: 'fx-anim-char-spacer' });
	charSetSpacer.hidden = true;
	const syncCharHeads = () => {
		charTitle.style.height = charLane.offsetHeight ? charLane.offsetHeight + 'px' : '';
		charSetSpacer.hidden = charSetRow.hidden;
		charSetSpacer.style.height = charSetRow.offsetHeight + 'px';
	};
	let charOpen = false;
	function drawChar() {
		const A = app.anim;
		charLane.hidden = !A.has;
		charTitle.hidden = !A.has;
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
		charSetRow.hidden = !charOpen;
		drawChar();
		syncCharHeads();
		clampAnimH();
	});
	// клик и протяжка по полосе двигают общий курсор таймлайна
	let charDrag = false;
	const charSeek = (e) => {
		const r = screenRect(charBody);
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
		h('span', { class: 'fx-anim-empty-text' }, 'На таймлайне пока нет блоков. Перетащите эффект из списка слева сюда или нажмите «Эффект».'),
		h('div', { class: 'fx-anim-empty-actions' },
			button({ label: 'Добавить эффект', icon: 'plus', variant: 'primary', cls: 'btn-sm', onClick: (e) => { e.stopPropagation(); openEffectsShelf(); } })
		)
	);

	const lanesScroll = h('div', { class: 'fx-anim-lanes-scroll' }, camLane, charLane, charSetRow, fxLanesWrap, emptyHint);
	const playheadLine = h('div', { class: 'fx-anim-playhead-line' });
	// колонка подписей без фона стоит на месте, зумится и прокручивается только шкала справа
	const headsFx = h('div', { class: 'fx-anim-fx-heads' });
	const headsCol = h('div', { class: 'fx-anim-heads' }, rulerTitle, camTitle, charTitle, charSetSpacer, headsFx);
	const inner = h('div', { class: 'fx-anim-inner' }, rulerRow, lanesScroll, playheadLine);
	const scroller = h('div', { class: 'fx-anim-scroller' }, inner);
	stage.append(headsCol, scroller);
	scroller.addEventListener('scroll', () => scroller.classList.toggle('is-scrolled', scroller.scrollLeft > 2), { passive: true });
	new ResizeObserver(() => syncCharHeads()).observe(charLane);
	new ResizeObserver(() => syncCharHeads()).observe(charSetRow);
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
			const r = screenRect(scroller);
			const viewW = scroller.clientWidth;
			const x = Math.max(0, Math.min(viewW, e.clientX - r.left));
			const t = Math.max(0, Math.min(dur, ((scroller.scrollLeft + x) / (viewW * animZoom)) * dur));
			setZoom(animZoom * Math.exp(-e.deltaY * 0.0022), { t, x });
		},
		{ passive: false }
	);

	// 3. Инспектор выбранного элемента (Inspector): колонка внутри таймлайна сбоку от дорожек. Пока ничего не выбрано, её нет и дорожки во всю ширину
	const inspector = h('div', { class: 'fx-clip-panel is-shut', inert: true });
	// колонка не исчезает из раскладки, а сжимается до нуля (атрибут hidden убрал бы её сразу, без выезда): inspector.hidden управляет классом
	Object.defineProperty(inspector, 'hidden', {
		get() {
			return this.classList.contains('is-shut');
		},
		set(v) {
			this.classList.toggle('is-shut', !!v);
			this.inert = !!v;
		},
	});

	const body = h('div', { class: 'fx-anim-body' }, shelf, stage);
	const animMain = h('div', { class: 'fx-anim-main' }, inspector, body);
	animPanel.append(resizeHandle, topBar, animMain);
	document.getElementById('viewport').append(animPanel);

	function timeFromPointer(e, targetEl, cachedRect) {
		const r = cachedRect || screenRect(targetEl);
		const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
		return frac * (st.anim.dur || 8);
	}

	function startMarquee(e) {
		e.preventDefault();
		engine.animPause();
		const x0 = e.clientX, y0 = e.clientY;
		const base = new Set(selSet);
		const q = h('div', { class: 'fx-marquee' });
		document.body.append(q);
		const hit = (ev) => {
			const l = Math.min(x0, ev.clientX), t = Math.min(y0, ev.clientY), r = Math.max(x0, ev.clientX), b = Math.max(y0, ev.clientY);
			q.style.cssText = `left:${toCss(l)}px;top:${toCss(t)}px;width:${toCss(r - l)}px;height:${toCss(b - t)}px`;
			selSet.clear();
			base.forEach((id) => selSet.add(id));
			for (const [id, el2] of blockEls) {
				const br = screenRect(el2);
				if (br.right >= l && br.left <= r && br.bottom >= t && br.top <= b) selSet.add(id);
				el2.classList.toggle('is-sel', selSet.has(id));
			}
		};
		const mv = (ev) => hit(ev);
		const up = () => {
			window.removeEventListener('pointermove', mv);
			window.removeEventListener('pointerup', up);
			q.remove();
			selClip = selList().slice(-1)[0] || null;
			selKey = null;
			animSync();
		};
		window.addEventListener('pointermove', mv);
		window.addEventListener('pointerup', up);
	}

	function bindScrubbing(el) {
		el.addEventListener('contextmenu', (e) => {
			if (e.target.closest('.fx-anim-block, .fx-anim-key')) return;
			e.preventDefault();
			const t = timeFromPointer(e, el);
			if (el === rulerBody) rulerMenu(t, e.clientX, e.clientY);
			else if (el.classList.contains('fx-anim-fx-body')) laneMenu(t, e.clientX, e.clientY);
		});
		el.addEventListener('pointerdown', (e) => {
			if (e.target.closest('.fx-anim-key, .fx-anim-block, .fx-anim-work-h, button, input')) return;
			if (e.button === 2) return;
			// Shift и протяжка по пустому месту дорожки выбирают блоки рамкой
			if (e.shiftKey && el.classList.contains('fx-anim-fx-body')) {
				startMarquee(e);
				return;
			}
			e.preventDefault();
			engine.animPause();
			isScrubbing = true;
			el.setPointerCapture(e.pointerId);
			const rect = screenRect(el);
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

	let animCloseT = 0;
	toggleAnim = function (on = animPanel.hidden || animPanel.classList.contains('is-out')) {
		on = !!on;
		// закрывается не мгновенно: панель уходит вниз и гаснет, а потом прячется; новое открытие во время ухода отменяет его
		clearTimeout(animCloseT);
		if (on) {
			animPanel.classList.remove('is-out');
			animPanel.hidden = false;
		} else if (!animPanel.hidden && !animPanel.classList.contains('is-out')) {
			if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) animPanel.hidden = true;
			else {
				animPanel.classList.add('is-out');
				animCloseT = setTimeout(() => {
					animPanel.hidden = true;
					animPanel.classList.remove('is-out');
				}, 540);
			}
		}
		engine.timelineOpen = !!on;
		if (!on) {
			inspector.hidden = true;
			placeInspector();
			// угол обзора и крен из ключей камеры работают только на таймлайне
			engine.animCamRelease();
		}
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

	// Перетаскивание эффекта из списка на таймлайн: блок встаёт туда, куда отпустили. Если таймлайн закрыт, он открывается, а блок встаёт на текущий момент
	{
		const MIME = 'application/x-fx-layer';
		for (const c of cards) {
			if (!ANIM_LAYERS.includes(c.def.id)) continue;
			c.card.draggable = true;
			c.card.addEventListener('dragstart', (e) => {
				e.dataTransfer.setData(MIME, c.def.id);
				e.dataTransfer.setData('text/plain', c.def.name);
				e.dataTransfer.effectAllowed = 'copy';
				appEl.classList.add('is-fx-dragging');
			});
			c.card.addEventListener('dragend', () => appEl.classList.remove('is-fx-dragging'));
		}
		const vp = document.getElementById('viewport');
		const has = (e) => Array.from(e.dataTransfer?.types || []).includes(MIME);
		vp.addEventListener('dragover', (e) => {
			if (!has(e)) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = 'copy';
			animPanel.classList.toggle('is-drop', !animPanel.hidden && !!e.target.closest('.fx-anim'));
		});
		vp.addEventListener('dragleave', (e) => {
			if (!e.relatedTarget || !vp.contains(e.relatedTarget)) animPanel.classList.remove('is-drop');
		});
		vp.addEventListener('drop', (e) => {
			if (!has(e)) return;
			e.preventDefault();
			animPanel.classList.remove('is-drop');
			appEl.classList.remove('is-fx-dragging');
			const id = e.dataTransfer.getData(MIME);
			if (!ANIM_LAYERS.includes(id)) return;
			const wasHidden = animPanel.hidden;
			let start;
			if (!wasHidden && e.target.closest('.fx-anim')) {
				const r = screenRect(rulerBody);
				if (r.width > 0) start = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (st.anim.dur || 8) - 0.5;
			}
			if (wasHidden) toggleAnim(true);
			const c = engine.animAddClip(id, start == null ? {} : { start: Math.max(0, start) });
			selClip = c;
			selKey = null;
			animSync();
			app.toast(`Блок «${getLayerDef(id).name}» добавлен на таймлайн`, 'info');
		});
	}

	// Пауза анимации при вращении камеры в 3D
	document.getElementById('viewport').addEventListener('pointerdown', (e) => {
		if (engine.animPlaying && !engine.animRec && !e.target.closest('.fx-anim, .fx-bar, .popover')) {
			engine.animPause();
		}
	}, true);

	// Горячие клавиши (Space, Delete, Backspace, Escape)
	const jumpTo = (dir) => {
		const A = st.anim;
		const pts = [0, A.dur];
		for (const c of A.clips || []) pts.push(c.start, c.start + c.dur);
		const cur = engine.animT;
		const cand = pts.filter((t) => (dir > 0 ? t > cur + 0.02 : t < cur - 0.02)).sort((a, b) => (dir > 0 ? a - b : b - a));
		if (cand.length) {
			engine.animPause();
			engine.animSeek(cand[0]);
			animSync();
		}
	};
	// расширенные клавиши секвенсора; true, если нажатие обработано
	function extraKeys(e) {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.code === 'KeyA') {
			e.preventDefault();
			const all = st.anim.clips || [];
			selSet.clear();
			all.forEach((c) => selSet.add(c.id));
			selClip = all[all.length - 1] || null;
			animSync();
			return true;
		}
		if (mod && e.code === 'KeyC' && selSet.size) {
			e.preventDefault();
			copyClips();
			return true;
		}
		if (mod && e.code === 'KeyV' && clipboard.length) {
			e.preventDefault();
			pasteClips(engine.animT);
			return true;
		}
		if (mod && e.code === 'KeyD' && selSet.size) {
			e.preventDefault();
			dupClips();
			return true;
		}
		if ((e.code === 'Delete' || e.code === 'Backspace') && selSet.size) {
			e.preventDefault();
			delClips();
			return true;
		}
		if (e.altKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && selSet.size) {
			e.preventDefault();
			const d = e.code === 'ArrowLeft' ? -0.1 : 0.1;
			for (const c of selList()) if (!laneSt(c.layerId).lock) engine.animUpdateClip(c.id, { start: c.start + d });
			animSync();
			return true;
		}
		if (mod || e.altKey) return false;
		if (e.code === 'KeyI' || e.code === 'KeyO') {
			e.preventDefault();
			const A = st.anim;
			const t = engine.animT;
			const w = A.work;
			if (e.code === 'KeyI') engine.animSetWork(t, w && w.b > t + 0.2 ? w.b : A.dur);
			else engine.animSetWork(w && w.a < t - 0.2 ? w.a : 0, t);
			animSync();
			return true;
		}
		if (e.code === 'KeyX' && st.anim.work) {
			e.preventDefault();
			engine.animSetWork(null);
			animSync();
			return true;
		}
		if (e.code === 'Comma' || e.code === 'Period') {
			e.preventDefault();
			jumpTo(e.code === 'Period' ? 1 : -1);
			return true;
		}
		return false;
	}

	// клавиши секвенсора перехватываются раньше общих (O, X, S и другие значат в редакторе своё)
	const isInputTarget = (t) => t && (t.closest ? !!t.closest('input, textarea, select, .custom-select-wrap, .custom-select-pop, .select') : false);
	window.addEventListener(
		'keydown',
		(e) => {
			if (animPanel.hidden || isInputTarget(e.target)) return;
			if (extraKeys(e)) e.stopImmediatePropagation();
		},
		true
	);
	window.addEventListener('keydown', (e) => {
		if (animPanel.hidden) return;
		if (isInputTarget(e.target)) return;
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
			} else if (selClip || selKey || selSet.size) {
				selectOnly(null);
				selKey = null;
				animSync();
			}
		}
	});

	/** Разрезает выбранный блок по маркеру времени на два: у первого остаётся вход, у второго выход */
	function splitSelected() {
		if (!selClip) {
			app.toast('Выберите блок на дорожке, потом поставьте курсор времени там, где резать', 'info');
			return;
		}
		const part = engine.animSplitClip(selClip.id, engine.animT);
		if (!part) {
			app.toast('Курсор времени должен стоять внутри выбранного блока', 'info');
			return;
		}
		selClip = part;
		animSync();
	}

	// маленькое контекстное меню в стиле остальных панелей
	function openCtx(x, y, items) {
		document.querySelectorAll('.fx-ctx').forEach((n) => n.remove());
		const m = h('div', { class: 'fx-ctx popover' });
		for (const it of items) {
			if (it === '-') {
				m.append(h('div', { class: 'fx-ctx-sep' }));
				continue;
			}
			const b = h('button', { type: 'button', class: 'fx-ctx-item' + (it.danger ? ' is-danger' : ''), disabled: it.disabled ? true : undefined }, h('span', { class: 'ic-wrap', html: it.icon ? icon(it.icon, 14) : '' }), h('span', {}, it.label), it.key ? h('kbd', { class: 'tip-key' }, it.key) : null);
			b.addEventListener('click', () => {
				m.remove();
				it.onClick && it.onClick();
			});
			m.append(b);
		}
		document.body.append(m);
		// x, y в экранных пикселях (мышь), меню ставится в пикселях вёрстки: при масштабе интерфейса они различаются
		const z = uiZoom();
		const w = m.offsetWidth, hh = m.offsetHeight;
		m.style.left = Math.max(8, Math.min(window.innerWidth / z - w - 8, x / z)) + 'px';
		m.style.top = Math.max(8, Math.min(window.innerHeight / z - hh - 8, y / z)) + 'px';
		const close = (e) => {
			if (e && m.contains(e.target)) return;
			m.remove();
			document.removeEventListener('pointerdown', close, true);
			window.removeEventListener('keydown', esc, true);
		};
		const esc = (e) => e.code === 'Escape' && close();
		setTimeout(() => {
			document.addEventListener('pointerdown', close, true);
			window.addEventListener('keydown', esc, true);
		}, 0);
	}
	const clipMenu = (clip, x, y) => {
		if (!selSet.has(clip.id)) selectOnly(clip);
		const many = selList().length > 1;
		const lst = selList();
		animSync();
		openCtx(x, y, [
			{ label: many ? 'Копировать выбранные' : 'Копировать', icon: 'copy', key: 'Ctrl+C', onClick: () => copyClips() },
			{ label: many ? 'Дублировать выбранные' : 'Дублировать', icon: 'copy', key: 'Ctrl+D', onClick: () => dupClips() },
			{ label: 'Разрезать по курсору', icon: 'scissors', key: 'S', disabled: many, onClick: () => splitSelected() },
			'-',
			{ label: lst.every((c) => c.off) ? 'Включить блок' : 'Выключить блок', icon: lst.every((c) => c.off) ? 'eye' : 'eye-slash', onClick: () => lst.forEach((c) => engine.animUpdateClip(c.id, { off: !lst.every((q) => q.off) })) },
			'-',
			{ label: many ? 'Удалить выбранные' : 'Удалить', icon: 'trash', danger: true, key: 'Del', onClick: () => delClips() },
		]);
	};
	const rulerMenu = (t, x, y) =>
		openCtx(x, y, [
			{ label: 'Начало области здесь', icon: 'selection', key: 'I', onClick: () => { const w = st.anim.work; engine.animSetWork(t, w && w.b > t + 0.2 ? w.b : st.anim.dur); animSync(); } },
			{ label: 'Конец области здесь', icon: 'selection', key: 'O', onClick: () => { const w = st.anim.work; engine.animSetWork(w && w.a < t - 0.2 ? w.a : 0, t); animSync(); } },
			{ label: 'Снять рабочую область', icon: 'x', key: 'X', disabled: !st.anim.work, onClick: () => { engine.animSetWork(null); animSync(); } },
		]);
	const laneMenu = (t, x, y) =>
		openCtx(x, y, [
			{ label: 'Вставить сюда', icon: 'copy', key: 'Ctrl+V', disabled: !clipboard.length, onClick: () => { pasteClips(t); } },
			{ label: 'Курсор сюда', icon: 'cursor', onClick: () => { engine.animPause(); engine.animSeek(t); animSync(); } },
		]);

	function copyClips() {
		clipboard = selList().map((c) => ({ ...c }));
		if (clipboard.length) app.toast(clipboard.length > 1 ? `Скопировано блоков: ${clipboard.length}` : 'Блок скопирован', 'info', 1400);
	}
	function pasteClips(t) {
		if (!clipboard.length) return;
		const made = engine.animPasteClips(clipboard, t ?? engine.animT);
		selSet.clear();
		made.forEach((c) => selSet.add(c.id));
		selClip = made[made.length - 1] || null;
		animSync();
	}
	function dupClips() {
		const made = selList().map((c, i) => engine.animDuplicateClip(c.id, i > 0)).filter(Boolean);
		if (!made.length) return;
		selSet.clear();
		made.forEach((c) => selSet.add(c.id));
		selClip = made[made.length - 1];
		animSync();
	}
	function delClips() {
		const lst = selList().filter((c) => !laneSt(c.layerId).lock);
		if (!lst.length) return;
		lst.forEach((c) => engine.animRemoveClip(c.id));
		selectOnly(null);
		animSync();
	}

	let inspSig = '';
	let inspRefs = null;
	const clipTitle = h('span', { class: 'fxf-title' }, 'Блок эффекта');
	const clipIcon = h('span', { class: 'fx-clip-ic' });
	// сторона колонки: кнопкой или перетаскиванием за заголовок на другую половину таймлайна
	const clipSideBtn = iconButton({ icon: 'arrows-left-right', title: 'Перенести панель на другую сторону таймлайна', cls: 'fx-clip-side', onClick: () => setClipSide(clipSide === 'left' ? 'right' : 'left') });
	const clipBody = h('div', { class: 'fx-clip-body' });
	const clipActs = h('div', { class: 'fx-clip-acts' });
	const clipBar = h('div', { class: 'fxf-bar', 'data-tip': 'Потяните влево или вправо, чтобы перенести панель', 'data-tip-pos': 'top' }, clipIcon, clipTitle, clipActs, clipSideBtn);
	inspector.append(clipBar, clipBody);
	function renderInspector() {
		const sig = selSet.size > 1 ? 'm:' + [...selSet].join(',') : selClip ? 'c:' + selClip.id : selKey ? 'k:' + selKey.t : '';
		// панель свойств пересобирается только при смене выбора: при каждом кадре воспроизведения и при перетаскивании ползунка трогаем лишь значения
		if (sig === inspSig && inspRefs) {
			inspRefs.update && inspRefs.update();
			placeInspector();
			return;
		}
		inspSig = sig;
		inspRefs = null;
		buildInspector();
		placeInspector();
	}
	// колонка свойств: слева или справа от дорожек (запоминается), ширину можно тянуть за кромку со стороны дорожек
	const CLIP_SIDE_KEY = 'objglb.fx.clip.side';
	const CLIP_W_KEY = 'objglb.fx.clip.w';
	let clipSide = 'left';
	let clipW = 300;
	try {
		clipSide = localStorage.getItem(CLIP_SIDE_KEY) === 'right' ? 'right' : 'left';
		const w = Number(localStorage.getItem(CLIP_W_KEY));
		if (w >= 240 && w <= 440) clipW = w;
	} catch (_) {}
	let growRaf = 0;
	function placeInspector() {
		animPanel.classList.toggle('insp-right', clipSide === 'right');
		animPanel.style.setProperty('--fx-clip-w', clipW + 'px');
		const open = !inspector.hidden;
		appEl.classList.toggle('fx-clip-open', open);
		// таймлайн подрастает под содержимое колонки после раскладки (закрылась: возвращается к своей высоте)
		cancelAnimationFrame(growRaf);
		growRaf = requestAnimationFrame(() => growForInspector(open && !animPanel.hidden));
	}
	function setClipSide(side) {
		if (side === clipSide) return;
		clipSide = side;
		try {
			localStorage.setItem(CLIP_SIDE_KEY, side);
		} catch (_) {}
		// колонка переезжает: на миг гаснет и проявляется уже на другой стороне, дорожки сдвигаются следом
		inspector.classList.add('is-moving');
		placeInspector();
		requestAnimationFrame(() => requestAnimationFrame(() => inspector.classList.remove('is-moving')));
	}
	// перетаскивание за заголовок: отпустили на другой половине таймлайна, и колонка переехала туда
	clipBar.addEventListener('pointerdown', (e) => {
		if (e.button !== 0 || e.target.closest('button, input')) return;
		e.preventDefault();
		clipBar.setPointerCapture(e.pointerId);
		const x0 = e.clientX;
		let moved = false;
		const target = (ev) => {
			const r = screenRect(animMain);
			return ev.clientX < r.left + r.width / 2 ? 'left' : 'right';
		};
		const mv = (ev) => {
			if (!moved && Math.abs(ev.clientX - x0) < 6) return;
			moved = true;
			animPanel.classList.add('is-insp-drag');
			const t = target(ev);
			animPanel.classList.toggle('drop-left', t === 'left' && t !== clipSide);
			animPanel.classList.toggle('drop-right', t === 'right' && t !== clipSide);
		};
		const up = (ev) => {
			clipBar.removeEventListener('pointermove', mv);
			clipBar.removeEventListener('pointerup', up);
			clipBar.removeEventListener('pointercancel', up);
			animPanel.classList.remove('is-insp-drag', 'drop-left', 'drop-right');
			if (moved && ev.type === 'pointerup') setClipSide(target(ev));
		};
		clipBar.addEventListener('pointermove', mv);
		clipBar.addEventListener('pointerup', up);
		clipBar.addEventListener('pointercancel', up);
	});
	const clipWRes = h('div', { class: 'fx-clip-wres', title: 'Потяните, чтобы изменить ширину (двойной клик вернёт обычную)' });
	inspector.append(clipWRes);
	clipWRes.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		clipWRes.setPointerCapture(e.pointerId);
		const x0 = e.clientX;
		const w0 = clipW;
		const z = uiZoom();
		inspector.classList.add('is-resizing');
		const mv = (ev) => {
			const dx = (ev.clientX - x0) / z;
			clipW = Math.round(Math.max(240, Math.min(440, w0 + (clipSide === 'left' ? dx : -dx))));
			placeInspector();
		};
		const up = () => {
			clipWRes.removeEventListener('pointermove', mv);
			clipWRes.removeEventListener('pointerup', up);
			clipWRes.removeEventListener('pointercancel', up);
			inspector.classList.remove('is-resizing');
			try {
				localStorage.setItem(CLIP_W_KEY, String(clipW));
			} catch (_) {}
		};
		clipWRes.addEventListener('pointermove', mv);
		clipWRes.addEventListener('pointerup', up);
		clipWRes.addEventListener('pointercancel', up);
	});
	clipWRes.addEventListener('dblclick', () => {
		clipW = 300;
		try {
			localStorage.removeItem(CLIP_W_KEY);
		} catch (_) {}
		placeInspector();
	});
	placeInspector();
	function buildInspector() {
		clipBody.textContent = '';
		clipActs.textContent = '';
		// таймлайн закрыт или закрывается: плашка выбранного блока или ракурса не должна оставаться на экране
		if (animPanel.hidden || animPanel.classList.contains('is-out')) {
			inspector.hidden = true;
			return;
		}
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
		if (selSet.size > 1) {
			// несколько блоков: общие действия
			const lst = selList();
			const allOff = lst.every((c) => c.off);
			inspector.hidden = false;
			clipTitle.textContent = `Выбрано блоков: ${lst.length}`;
			clipIcon.innerHTML = icon('stack', 14);
			inspRefs = {};
			clipBody.append(h('p', { class: 'fx-clip-note' }, 'Тяните любой из них, и сдвинется весь выбор.'));
			clipActs.append(
				iconButton({ icon: 'copy', title: 'Дублировать выбранные (Ctrl+D)', onClick: () => dupClips() }),
				iconButton({ icon: allOff ? 'eye' : 'eye-slash', title: allOff ? 'Включить выбранные блоки' : 'Выключить выбранные блоки', onClick: () => lst.forEach((c) => engine.animUpdateClip(c.id, { off: !allOff })) }),
				iconButton({ icon: 'trash', title: 'Удалить выбранные (Delete)', cls: 'is-danger', onClick: () => delClips() }),
				iconButton({ icon: 'x', title: 'Снять выбор', onClick: () => { selectOnly(null); animSync(); } })
			);
			return;
		}
		clipIcon.innerHTML = '';
		if (selClip && selClip.layerId === 'morph') {
			buildMorphInspector(selClip, mkSlider);
			return;
		}
		if (selClip) {
			const c = selClip;
			const layerDef = getLayerDef(c.layerId);
			inspector.hidden = false;
			clipTitle.textContent = layerDef.name;
			clipIcon.innerHTML = icon(layerDef.icon || 'sparkle', 14);

			const secFmt = (v) => v.toFixed(2) + ' с';
			const sFadeIn = mkSlider('Нарастание', 0, c.dur, 0.05, c.fadeIn, secFmt, (v) => engine.animUpdateClip(c.id, { fadeIn: v }));
			const sFadeOut = mkSlider('Затухание', 0, c.dur, 0.05, c.fadeOut, secFmt, (v) => engine.animUpdateClip(c.id, { fadeOut: v }));
			const sAmt = mkSlider('Сила', 0.05, 2, 0.05, c.amount, (v) => v.toFixed(2), (v) => engine.animUpdateClip(c.id, { amount: v }));
			const sRep = mkSlider('Пульсации', 1, 12, 1, c.repeat || 1, (v) => '×' + v, (v) => engine.animUpdateClip(c.id, { repeat: v }));
			sRep.row.dataset.tip = 'Сколько раз блок повторяет свою форму подряд: пульсация вместо одного плавного хода';
			sFadeIn.row.dataset.tip = 'Сколько секунд сила эффекта растёт от нуля до полной';
			sFadeOut.row.dataset.tip = 'Сколько секунд сила эффекта спадает до нуля в конце блока';
			sAmt.row.dataset.tip = '1.00: как в настройках эффекта. Больше: сильнее, меньше: слабее';
			// график силы эффекта по времени внутри блока: сразу видно, как он нарастает и затихает
			const graphSvg = () => {
				let d = '';
				for (let i = 0; i <= 40; i++) {
					const tt = c.start + (c.dur * Math.min(0.9999, i / 40));
					const v = engine._clipEnv(c, tt);
					d += (i ? 'L' : 'M') + ((i / 40) * 100).toFixed(1) + ' ' + (46 - Math.min(1, v) * 40).toFixed(1) + ' ';
				}
				return `<svg viewBox="0 0 100 50" preserveAspectRatio="none"><path class="fill" d="${d}L100 46 L0 46 Z" /><path class="line" d="${d}" /></svg>`;
			};
			const graph = h('div', { class: 'fx-clip-graph', html: graphSvg(), 'data-tip': 'Как сила эффекта меняется по ходу блока' });
			let graphSig = '';
			inspRefs = {
				update: () => {
					sFadeIn.set(c.fadeIn, c.dur);
					sFadeOut.set(c.fadeOut, c.dur);
					sAmt.set(c.amount);
					sRep.set(c.repeat || 1);
					const sg = `${c.dur}|${c.fadeIn}|${c.fadeOut}|${c.shape}|${c.ease}|${c.repeat}|${c.rev}`;
					if (sg !== graphSig) {
						graphSig = sg;
						graph.innerHTML = graphSvg();
					}
				},
			};

			// профиль и кривая: мини-графики силы со своей подписью. Рисуются той же функцией, что и сама анимация
			const miniPath = (spec) => {
				const clipM = { start: 0, dur: 1, fadeIn: 0, fadeOut: 0, shape: 'plateau', ease: 'smooth', ...spec };
				let d = '';
				for (let i = 0; i <= 36; i++) {
					const v = engine._clipEnv(clipM, Math.min(0.9999, i / 36));
					d += (i ? 'L' : 'M') + (2 + (i / 36) * 36).toFixed(1) + ' ' + (19 - Math.min(1, v) * 15).toFixed(1) + ' ';
				}
				return `<svg viewBox="0 0 40 22" width="40" height="22"><path class="mf" d="${d}L38 19 L2 19 Z"/><path class="ml" d="${d}"/></svg>`;
			};
			const SPEC = {
				plateau: { shape: 'plateau' },
				ramp: { shape: 'ramp' },
				fall: { shape: 'fall' },
				peak: { shape: 'peak' },
				smooth: { fadeIn: 0.5, fadeOut: 0.5, ease: 'smooth' },
				linear: { fadeIn: 0.5, fadeOut: 0.5, ease: 'linear' },
				sharp: { fadeIn: 0.5, fadeOut: 0.5, ease: 'sharp' },
			};
			const mkSeg = (label, opts, cur, onPick) => {
				const wrap = h('div', { class: 'fx-anim-insp-seg is-icons' });
				const btns = opts.map(([v, name, tip]) => {
					const b = h('button', { type: 'button', class: 'fx-anim-insp-segbtn' + (cur === v ? ' is-on' : ''), 'data-tip': tip, 'aria-label': tip, html: miniPath(SPEC[v]) + `<span>${name}</span>` });
					b.addEventListener('click', () => {
						onPick(v);
						btns.forEach(([vv, bb]) => bb.classList.toggle('is-on', vv === v));
					});
					wrap.append(b);
					return [v, b];
				});
				return h('div', { class: 'fx-clip-group' }, h('span', { class: 'fx-anim-insp-lab' }, label), wrap);
			};
			const shapeRow = mkSeg('Профиль', [['plateau', 'Ровная', 'Сила держится на одном уровне весь блок'], ['ramp', 'Растёт', 'Сила растёт от нуля к концу блока'], ['fall', 'Спадает', 'Сила падает от максимума к концу блока'], ['peak', 'Пик', 'Сила растёт к середине блока и падает']], c.shape || 'plateau', (v) => engine.animUpdateClip(c.id, { shape: v }));
			const easeRow = mkSeg('Кривая', [['smooth', 'Плавно', 'Мягкий вход и выход'], ['linear', 'Ровно', 'Линейное нарастание и спад'], ['sharp', 'Резко', 'Быстрый вход, резкий спад']], c.ease || 'smooth', (v) => engine.animUpdateClip(c.id, { ease: v }));
			const revSw = switchRow('Задом наперёд', { value: !!c.rev, onChange: (v) => { engine.animUpdateClip(c.id, { rev: v }); } });
			const openFx = button({ label: 'Настройки эффекта', icon: 'gear-six', variant: 'secondary', cls: 'btn-sm fx-clip-open-fx', title: 'Открыть параметры этого эффекта в правой панели', onClick: () => { select_(c.layerId); sync(); } });
			clipActs.append(
				iconButton({ icon: 'scissors', title: 'Разрезать блок по курсору времени (S)', onClick: () => splitSelected() }),
				iconButton({ icon: 'copy', title: 'Дублировать блок (Ctrl+D)', onClick: () => { const cloned = engine.animDuplicateClip(c.id); if (cloned) selectOnly(cloned); animSync(); } }),
				iconButton({ icon: c.off ? 'eye' : 'eye-slash', title: c.off ? 'Включить блок' : 'Выключить блок: он останется на дорожке, но не работает', onClick: () => { engine.animUpdateClip(c.id, { off: !c.off }); animSync(); } }),
				iconButton({ icon: 'trash', title: 'Удалить блок (Delete)', cls: 'is-danger', onClick: () => { engine.animRemoveClip(c.id); selectOnly(null); animSync(); } }),
				iconButton({ icon: 'x', title: 'Снять выбор (Esc)', onClick: () => { selectOnly(null); animSync(); } })
			);
			clipBody.append(graph, sAmt.row, sFadeIn.row, sFadeOut.row, sRep.row, shapeRow, easeRow, revSw.el, openFx);
		} else if (selKey) {
			buildKeyInspector(selKey, mkSlider);
		} else {
			inspector.hidden = true;
		}
	}

	/** Строка «Время» блока или ключа: число с единицей */
	function timeField(value, max, onSet) {
		const inp = h('input', { type: 'number', class: 'num-in', min: 0, max, step: 0.1, value: Math.round(value * 100) / 100 });
		inp.addEventListener('change', () => onSet(Math.max(0, Math.min(max, Number(inp.value) || 0))));
		return { el: h('label', { class: 'fx-anim-insp-field' }, h('span', { class: 'fx-anim-insp-lab' }, 'Время'), inp, h('span', { class: 'fx-anim-insp-unit' }, 'с')), set: (v) => document.activeElement !== inp && (inp.value = Math.round(v * 100) / 100) };
	}

	/** Мини-графики проходов: как меняется значение до ключа и после него */
	const PASS_ICONS = {
		smooth: 'M2 18 C 12 18, 14 4, 20 4 S 30 4, 38 2',
		stop: 'M2 18 C 12 18, 14 6, 20 6 C 26 6, 28 6, 38 2',
		linear: 'M2 18 L20 6 L38 2',
		hold: 'M2 18 L20 18 L20 4 L38 4',
	};
	const passIcon = (k) => `<svg viewBox="0 0 40 22" width="40" height="22"><path class="ml" d="${PASS_ICONS[k]}"/><circle cx="20" cy="${k === 'hold' ? 4 : k === 'linear' ? 6 : k === 'stop' ? 6 : 4}" r="2.2" class="mk"/></svg>`;
	const rampIcon = (ease) => {
		let d = '';
		for (let i = 0; i <= 30; i++) {
			const u = i / 30;
			const v = ease === 'linear' ? u : ease === 'sharp' ? Math.pow(u, 0.35) : u * u * (3 - 2 * u);
			d += (i ? 'L' : 'M') + (2 + u * 36).toFixed(1) + ' ' + (19 - v * 15).toFixed(1) + ' ';
		}
		return `<svg viewBox="0 0 40 22" width="40" height="22"><path class="mf" d="${d}L38 19 L2 19 Z"/><path class="ml" d="${d}"/></svg>`;
	};
	/** Ряд кнопок с картинками (как «Профиль» и «Кривая» у блока эффекта) */
	function iconSeg(label, opts, cur, onPick) {
		const wrap = h('div', { class: 'fx-anim-insp-seg is-icons' });
		const btns = opts.map(([v, name, tip, art]) => {
			const b = h('button', { type: 'button', class: 'fx-anim-insp-segbtn' + (cur === v ? ' is-on' : ''), 'data-tip': tip, 'aria-label': tip, html: art + `<span>${name}</span>` });
			b.addEventListener('click', () => {
				onPick(v);
				btns.forEach(([vv, bb]) => bb.classList.toggle('is-on', vv === v));
			});
			wrap.append(b);
			return [v, b];
		});
		return h('div', { class: 'fx-clip-group' }, h('span', { class: 'fx-anim-insp-lab' }, label), wrap);
	}

	/** Блок морфинга: откуда и куда идёт форма, каким видом перехода и с каким ходом */
	function buildMorphInspector(c, mkSlider) {
		inspector.hidden = false;
		clipTitle.textContent = 'Морфинг';
		clipIcon.innerHTML = icon('shapes', 14);
		const forms = engine.animMorphForms();
		const chain = engine._morphChain(st.anim.clips || []);
		const idx = chain.indexOf(c);
		const prev = idx > 0 ? chain[idx - 1] : null;
		const nameOf = (key) => forms.find((f) => f.key === key)?.name || (key ? key : 'Исходная форма');
		// откуда: форма прошлого блока или исходная форма сцены (её выбрать нельзя, она задаётся предыдущим блоком)
		const fromEl = h('span', { class: 'fx-morph-from' }, prev ? nameOf(prev.form) : 'Исходная форма');
		const toSel = select({ options: forms.map((f) => ({ value: f.key, label: f.name, icon: f.icon })), value: c.form, onChange: (v) => { engine.animUpdateClip(c.id, { form: v }); engine.animSeek(engine.animT); animSync(); } });
		const route = h('div', { class: 'fx-morph-route' },
			h('div', { class: 'fx-anim-insp-row' }, h('span', { class: 'fx-anim-insp-lab' }, 'Откуда'), fromEl),
			h('div', { class: 'fx-anim-insp-row' }, h('span', { class: 'fx-anim-insp-lab' }, 'Куда'), toSel.el)
		);
		const styles = [{ value: '', label: 'Как в «Морфинге»', sub: 'Вид и настройки из раздела «Морфинг» на вкладке «Форма»', icon: 'sliders-horizontal' }, ...MORPH_STYLES.filter((s) => !s.hidden).map((s) => ({ value: s.id, label: s.name, sub: s.hint, icon: s.icon }))];
		const stySel = select({ options: styles, value: c.style || '', onChange: (v) => { engine.animUpdateClip(c.id, { style: v }); animSync(); } });
		const secFmt = (v) => v.toFixed(1) + ' с';
		const sDur = mkSlider('Длина', 0.3, Math.max(0.5, (st.anim.dur || 8) - c.start), 0.1, c.dur, secFmt, (v) => engine.animUpdateClip(c.id, { dur: v }));
		sDur.row.dataset.tip = 'Сколько секунд идёт переход: блок на дорожке растягивается вместе с ней';
		const tf = timeField(c.start, st.anim.dur || 8, (v) => { engine.animUpdateClip(c.id, { start: v }); animSync(); });
		const easeRow = iconSeg('Ход', [['smooth', 'Плавно', 'Мягко трогается и мягко собирается', rampIcon('smooth')], ['linear', 'Ровно', 'С одной скоростью от начала до конца', rampIcon('linear')], ['sharp', 'Рывком', 'Резко срывается и долго собирается', rampIcon('sharp')]], c.ease || 'smooth', (v) => { engine.animUpdateClip(c.id, { ease: v }); engine.animSeek(engine.animT); });
		const revSw = switchRow('Задом наперёд', { value: !!c.rev, onChange: (v) => { engine.animUpdateClip(c.id, { rev: v }); engine.animSeek(engine.animT); } });
		const quick = h('div', { class: 'fx-clip-quick is-one' },
			button({ label: 'Следующий', icon: 'plus', variant: 'secondary', cls: 'btn-sm', title: 'Добавить следующий переход сразу после этого: форма пойдёт дальше по цепочке', onClick: () => { const n = engine.animAddClip('morph', { start: Math.min((st.anim.dur || 8) - 0.3, c.start + c.dur + 0.5), dur: c.dur, ease: c.ease, style: c.style }); selectOnly(n); animSync(); } })
		);
		inspRefs = { update: () => { sDur.set(c.dur, Math.max(0.5, (st.anim.dur || 8) - c.start)); tf.set(c.start); } };
		clipActs.append(
			iconButton({ icon: 'copy', title: 'Дублировать блок (Ctrl+D)', onClick: () => { const cloned = engine.animDuplicateClip(c.id); if (cloned) selectOnly(cloned); animSync(); } }),
			iconButton({ icon: c.off ? 'eye' : 'eye-slash', title: c.off ? 'Включить блок' : 'Выключить блок: он останется на дорожке, но не работает', onClick: () => { engine.animUpdateClip(c.id, { off: !c.off }); animSync(); } }),
			iconButton({ icon: 'trash', title: 'Удалить блок (Delete)', cls: 'is-danger', onClick: () => { engine.animRemoveClip(c.id); selectOnly(null); animSync(); } }),
			iconButton({ icon: 'x', title: 'Снять выбор (Esc)', onClick: () => { selectOnly(null); animSync(); } })
		);
		clipBody.append(route, field('Вид перехода', stySel.el), tf.el, sDur.row, easeRow, revSw.el, quick);
	}

	/** Ключ камеры: время, как камера проходит ключ, точные значения ракурса и общее покачивание */
	function buildKeyInspector(k, mkSlider) {
		inspector.hidden = false;
		clipTitle.textContent = 'Ракурс камеры';
		clipIcon.innerHTML = icon('video-camera', 14);
		const D2R = Math.PI / 180;
		const fov0 = app.settings.render.fov;
		const tf = timeField(k.t, st.anim.dur || 8, (v) => { engine.animMoveKey(k, v); engine.animSeek(k.t); animSync(); });
		const pass = iconSeg('Как проходит ключ', [['smooth', 'Плавно', 'Камера проходит ключ без остановки, путь гладкий', passIcon('smooth')], ['stop', 'Стоп', 'Камера мягко замирает в этом ракурсе и трогается дальше', passIcon('stop')], ['linear', 'Ровно', 'К ключу по прямой с постоянной скоростью', passIcon('linear')], ['hold', 'Скачок', 'Резкая смена ракурса в момент ключа, как монтажная склейка', passIcon('hold')]], k.ease || 'smooth', (v) => engine.animSetKey(k, { ease: v }));
		const deg = (v) => Math.round(v) + '°';
		const sYaw = mkSlider('Поворот', -360, 360, 1, k.cam.yaw / D2R, deg, (v) => engine.animSetKey(k, { yaw: v * D2R }));
		const sPitch = mkSlider('Наклон', -85, 85, 1, -k.cam.pitch / D2R, deg, (v) => engine.animSetKey(k, { pitch: -v * D2R }));
		// расстояние ползунком в логарифме: ближе и дальше двигаются одинаково удобно
		const sDist = mkSlider('Дальность', -2, 2.5, 0.01, Math.log(k.cam.dist), (v) => Math.exp(v).toFixed(2), (v) => engine.animSetKey(k, { dist: Math.exp(v) }));
		const sFov = mkSlider('Обзор', 10, 120, 1, k.fov ?? fov0, deg, (v) => engine.animSetKey(k, { fov: v }));
		const sRoll = mkSlider('Крен', -45, 45, 1, (k.roll || 0) / D2R, deg, (v) => engine.animSetKey(k, { roll: v * D2R }));
		sYaw.row.dataset.tip = 'Поворот камеры вокруг сцены';
		sPitch.row.dataset.tip = 'Камера выше или ниже: плюс смотрит сверху';
		sDist.row.dataset.tip = 'Расстояние до центра сцены';
		sFov.row.dataset.tip = 'Угол обзора: меньше это телеобъектив (сжатая перспектива), больше это широкий угол';
		sRoll.row.dataset.tip = 'Наклон горизонта';
		const shake = mkSlider('Покачивание', 0, 1, 0.01, st.anim.camShake || 0, (v) => Math.round(v * 100) + '%', (v) => { st.anim.camShake = v; engine.touch(); engine.animSeek(engine.animT); });
		shake.row.dataset.tip = 'Живая камера для всей анимации: лёгкое покачивание, как при съёмке с рук';
		const acts = h('div', { class: 'fx-clip-quick is-two' },
			button({ label: 'С камеры', icon: 'arrow-clockwise', variant: 'secondary', cls: 'btn-sm', title: 'Записать в ключ ракурс, который сейчас в сцене', onClick: () => { engine.animUpdateKey(k); app.toast('Ракурс записан в ключ', 'info', 1400); animSync(); } }),
			button({ label: 'Показать', icon: 'eye', variant: 'secondary', cls: 'btn-sm', title: 'Поставить курсор времени на ключ и показать его ракурс', onClick: () => { engine.animPause(); engine.animSeek(k.t); animSync(); } })
		);
		inspRefs = { update: () => { tf.set(k.t); sYaw.set(k.cam.yaw / D2R); sPitch.set(-k.cam.pitch / D2R); sDist.set(Math.log(k.cam.dist)); sFov.set(k.fov ?? fov0); sRoll.set((k.roll || 0) / D2R); } };
		clipActs.append(
			iconButton({ icon: 'trash', title: 'Удалить ключ (Delete)', cls: 'is-danger', onClick: () => { engine.animRemoveKey(k); selKey = null; animSync(); } }),
			iconButton({ icon: 'x', title: 'Снять выбор (Esc)', onClick: () => { selKey = null; animSync(); } })
		);
		clipBody.append(tf.el, pass, h('div', { class: 'fx-sub' }, 'Ракурс'), sYaw.row, sPitch.row, sDist.row, sFov.row, sRoll.row, acts, h('div', { class: 'fx-sub' }, 'Вся камера'), shake.row);
	}

	function renderKeys() {
		const A = st.anim;
		const durTotal = A.dur || 8;
		camKeysWrap.textContent = '';
		if (!A.keys) A.keys = [];

		for (const k of A.keys) {
			// форма ключа говорит, как камера его проходит: ромб плавно, круг с остановкой, квадрат скачком
			const pass = k.ease || 'smooth';
			const b = h('button', {
				type: 'button',
				class: 'fx-anim-key is-' + pass + (k === selKey ? ' is-sel' : ''),
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
		headsFx.textContent = '';
		blockEls.clear();

		if (!clips.length) {
			emptyHint.hidden = false;
			return;
		}
		emptyHint.hidden = true;

		const uniqueLayers = [...new Set(clips.map((c) => c.layerId))];

		for (const layerId of uniqueLayers) {
			const layerDef = getLayerDef(layerId);
			const layerClips = clips.filter((c) => c.layerId === layerId);

			const ls = laneSt(layerId);
			const toggleLane = (patch) => {
				engine.animSetLane(layerId, patch);
				animSync();
			};
			const addToLane = () => {
				selectOnly(engine.animAddClip(layerId));
				animSync();
			};
			const delLane = () => {
				A.clips = A.clips.filter((c) => c.layerId !== layerId);
				for (const id of [...selSet]) if (!A.clips.some((c) => c.id === id)) selSet.delete(id);
				if (selClip && selClip.layerId === layerId) selClip = null;
				engine.touch();
				engine.emit();
				animSync();
			};
			const laneTitle = h('div', { class: 'fx-anim-track-label fx-anim-fx-label' },
				h('span', { class: 'ic-wrap', html: icon(layerDef.icon || 'sparkle', 14) }),
				h('span', { class: 'fx-anim-lane-name' }, layerDef.name),
				// состояние дорожки показано значками; переключается через меню по правой кнопке
				h('div', { class: 'fx-anim-lane-tools' },
					ls.mute ? h('span', { class: 'fx-lane-flag', html: icon('eye-slash', 12), 'data-tip': 'Дорожка заглушена' }) : null,
					ls.solo ? h('span', { class: 'fx-lane-flag', html: icon('target', 12), 'data-tip': 'Соло' }) : null,
					ls.lock ? h('span', { class: 'fx-lane-flag', html: icon('lock-simple', 12), 'data-tip': 'Дорожка закреплена' }) : null
				)
			);
			laneTitle.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				openCtx(e.clientX, e.clientY, [
					{ label: 'Добавить блок', icon: 'plus', onClick: addToLane },
					'-',
					{ label: ls.mute ? 'Включить дорожку' : 'Заглушить дорожку', icon: ls.mute ? 'eye' : 'eye-slash', onClick: () => toggleLane({ mute: !ls.mute }) },
					{ label: ls.solo ? 'Выключить соло' : 'Соло', icon: 'target', onClick: () => toggleLane({ solo: !ls.solo }) },
					{ label: ls.lock ? 'Открепить дорожку' : 'Закрепить дорожку', icon: ls.lock ? 'lock-simple-open' : 'lock-simple', onClick: () => toggleLane({ lock: !ls.lock }) },
					'-',
					{ label: 'Удалить дорожку', icon: 'trash', danger: true, onClick: delLane },
				]);
			});

			const laneBody = h('div', { class: 'fx-anim-lane-body fx-anim-fx-body' });
			bindScrubbing(laneBody);

			for (const clip of layerClips) {
				const isSel = selSet.has(clip.id);
				const block = h('div', {
					class: 'fx-anim-block' + (isSel ? ' is-sel' : '') + (clip.off ? ' is-off' : ''),
					style: {
						left: (clip.start / durTotal) * 100 + '%',
						width: Math.max(2, (clip.dur / durTotal) * 100) + '%'
					},
					'data-tip': `${layerDef.name}: ${clip.start.toFixed(1)}с – ${(clip.start + clip.dur).toFixed(1)}с. Тяните для сдвига`,
					'aria-label': `${layerDef.name} блок`
				});

				const fades = clip.layerId !== 'morph' && clip.dur > 0;
				const fadeInPct = fades ? Math.min(50, (clip.fadeIn / clip.dur) * 100) : 0;
				const fadeOutPct = fades ? Math.min(50, (clip.fadeOut / clip.dur) * 100) : 0;
				const fadeInEl = h('div', { class: 'fx-anim-fade-in', style: { width: fadeInPct + '%' } });
				const fadeOutEl = h('div', { class: 'fx-anim-fade-out', style: { width: fadeOutPct + '%' } });

				// у блока морфинга видно, в какую форму он ведёт
				const morphTo = clip.layerId === 'morph' ? engine.animMorphForms().find((f) => f.key === clip.form) : null;
				const blockContent = h('div', { class: 'fx-anim-block-content' },
					morphTo ? h('span', { class: 'fx-anim-block-title' }, h('span', { class: 'fx-anim-block-ic', html: icon(morphTo.icon || 'shapes', 12) }), morphTo.name) : h('span', { class: 'fx-anim-block-title' }, layerDef.name),
					h('span', { class: 'fx-anim-block-time' }, `${clip.dur.toFixed(1)}с`)
				);

				const handleL = h('div', { class: 'fx-anim-handle is-left', title: 'Тяните, чтобы изменить начало блока' });
				const handleR = h('div', { class: 'fx-anim-handle is-right', title: 'Тяните, чтобы изменить длину блока' });

				// контур огибающей: видно, как блок нарастает и затихает (форма и кривая блока)
				// у морфинга вместо силы показан ход перехода: от прежней формы к новой
				const morphV = (u) => {
					if (clip.rev) u = 1 - u;
					return clip.ease === 'linear' ? u : clip.ease === 'sharp' ? Math.pow(u, 0.35) : u * u * (3 - 2 * u);
				};
				let envPath = '';
				for (let i = 0; i <= 28; i++) {
					const tt = clip.start + (clip.dur * i) / 28;
					const v = clip.layerId === 'morph' ? morphV(i / 28) : engine._clipEnv(clip, Math.min(clip.start + clip.dur - 1e-4, tt));
					envPath += (i ? 'L' : 'M') + ((i / 28) * 100).toFixed(1) + ' ' + (92 - v * 80).toFixed(1) + ' ';
				}
				const envEl = h('div', { class: 'fx-anim-env', html: `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${envPath}" /></svg>` });
				block.append(envEl, fadeInEl, fadeOutEl, blockContent, handleL, handleR);
				blockEls.set(clip.id, block);
				block.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					e.stopPropagation();
					clipMenu(clip, e.clientX, e.clientY);
				});

				// Перетаскивание блока: тянется весь выбор целиком, закреплённые дорожки стоят на месте
				block.addEventListener('pointerdown', (e) => {
					if (e.target.closest('.fx-anim-handle') || e.button === 2) return;
					e.stopPropagation();
					e.preventDefault();
					engine.animPause();
					if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSel(clip);
					else if (!selSet.has(clip.id)) selectOnly(clip);
					else {
						selClip = clip;
						selKey = null;
					}
					isDraggingItem = true;
					block.setPointerCapture(e.pointerId);
					animSync();
					isDraggingItem = true;
					const moving = selList().filter((c) => !laneSt(c.layerId).lock);
					if (!moving.includes(clip)) {
						isDraggingItem = false;
						return;
					}
					const startX = e.clientX;
					const orig = new Map(moving.map((c) => [c.id, c.start]));
					const minS = Math.min(...moving.map((c) => c.start));
					const maxE = Math.max(...moving.map((c) => c.start + c.dur));
					const r = screenRect(laneBody);
					let moved = false;

					const mv = (ev) => {
						const dx = ev.clientX - startX;
						if (!moved && Math.abs(dx) < 3) return;
						moved = true;
						const dt = (dx / Math.max(1, r.width)) * durTotal;
						const base = orig.get(clip.id);
						let newStart = base + dt;
						// к чему ближе прилипнуть: к началу или к концу главного блока
						const sS = snapTime(newStart, r.width, clip.id, ev);
						const sE = snapTime(newStart + clip.dur, r.width, clip.id, ev) - clip.dur;
						if (Math.abs(sS - newStart) <= Math.abs(sE - newStart) && sS !== newStart) newStart = sS;
						else if (sE !== newStart) newStart = sE;
						const d = Math.max(-minS, Math.min(durTotal - maxE, newStart - base));
						for (const c of moving) {
							c.start = orig.get(c.id) + d;
							const el2 = blockEls.get(c.id);
							if (el2) el2.style.left = (c.start / durTotal) * 100 + '%';
						}
					};

					const up = () => {
						block.removeEventListener('pointermove', mv);
						block.removeEventListener('pointerup', up);
						block.removeEventListener('pointercancel', up);
						if (moved) for (const c of moving) engine.animUpdateClip(c.id, { start: Math.round(c.start * 10) / 10 });
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
					if (laneSt(layerId).lock) return;
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
					const r = screenRect(laneBody);

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
					if (laneSt(layerId).lock) return;
					engine.animPause();
					selClip = clip;
					selKey = null;
					isDraggingItem = true;
					handleR.setPointerCapture(e.pointerId);
					animSync();

					const startX = e.clientX;
					const origDur = clip.dur;
					const r = screenRect(laneBody);

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

			const lane = h('div', { class: 'fx-anim-lane fx-anim-fx-lane' + (laneSt(layerId).mute ? ' is-muted' : '') + (laneSt(layerId).solo ? ' is-solo' : '') + (laneSt(layerId).lock ? ' is-locked' : '') }, laneBody);
			laneTitle.classList.toggle('is-muted', !!laneSt(layerId).mute);
			laneTitle.classList.toggle('is-solo', !!laneSt(layerId).solo);
			laneTitle.classList.toggle('is-locked', !!laneSt(layerId).lock);
			headsFx.append(laneTitle);
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
		const w = screenRect(rulerBody).width || 600;
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

	function renderWork() {
		const A = st.anim;
		const durTotal = A.dur || 8;
		// рабочая область: полоса на линейке с двумя ручками, воспроизведение и запись идут только внутри
		const w = A.work;
		rulerWork.hidden = !w;
		rulerWork.textContent = '';
		if (w) {
			rulerWork.style.left = (w.a / durTotal) * 100 + '%';
			rulerWork.style.width = ((w.b - w.a) / durTotal) * 100 + '%';
			for (const side of ['a', 'b']) {
				const hd = h('div', { class: 'fx-anim-work-h is-' + side, 'data-tip': side === 'a' ? 'Начало рабочей области' : 'Конец рабочей области' });
				hd.addEventListener('pointerdown', (e) => {
					e.stopPropagation();
					e.preventDefault();
					isDraggingItem = true;
					hd.setPointerCapture(e.pointerId);
					const rect = screenRect(rulerBody);
					const cur = { a: w.a, b: w.b };
					const mv = (ev) => {
						const t = Math.max(0, Math.min(durTotal, snapTime(timeFromPointer(ev, rulerBody, rect), rect.width, null, ev)));
						if (side === 'a') cur.a = Math.min(t, cur.b - 0.2);
						else cur.b = Math.max(t, cur.a + 0.2);
						rulerWork.style.left = (cur.a / durTotal) * 100 + '%';
						rulerWork.style.width = ((cur.b - cur.a) / durTotal) * 100 + '%';
					};
					const up = () => {
						hd.removeEventListener('pointermove', mv);
						hd.removeEventListener('pointerup', up);
						hd.removeEventListener('pointercancel', up);
						isDraggingItem = false;
						engine.animSetWork(cur.a, cur.b);
						animSync();
					};
					hd.addEventListener('pointermove', mv);
					hd.addEventListener('pointerup', up);
					hd.addEventListener('pointercancel', up);
				});
				rulerWork.append(hd);
			}
		}
	}

	function animSync() {
		const A = st.anim;
		const durTotal = A.dur || 8;
		const frac = durTotal ? Math.min(1, Math.max(0, engine.animT / durTotal)) : 0;
		const pct = (frac * 100).toFixed(2) + '%';

		// Положение иглы на линейке и вертикальной линии плейхеда
		rulerNeedle.style.left = pct;
		// при зуме во время воспроизведения шкала едет вслед за курсором, чтобы он не уходил за край
		if (animZoom > 1 && !isScrubbing && !isDraggingItem && engine.animPlaying) {
			const viewW = scroller.clientWidth;
			const x = frac * viewW * animZoom;
			if (x < scroller.scrollLeft + viewW * 0.04 || x > scroller.scrollLeft + viewW * 0.92) scroller.scrollLeft = Math.max(0, x - viewW * 0.12);
		}
		playheadLine.style.left = pct;

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
		{
			const ids = new Set((A.clips || []).map((c) => c.id));
			for (const id of [...selSet]) if (!ids.has(id)) selSet.delete(id);
			if (selClip && !selSet.has(selClip.id)) {
				selSet.clear();
				selSet.add(selClip.id);
			}
			if (!selClip && selSet.size === 1) selSet.clear();
			if (!selClip && selSet.size > 1) selClip = selList()[0];
		}
		aSpeed.textContent = (A.speed || 1) + '×';

		renderInspector();

		if (lastCharDur !== durTotal) {
			lastCharDur = durTotal;
			drawChar();
		}

		if (isDraggingItem) return;

		const keysStr = (A.keys || []).map((k) => `${k.t}:${k.ease || ''}`).join(',');
		const clipsStr = (A.clips || []).map((c) => `${c.id}:${c.layerId}:${c.start}:${c.dur}:${c.fadeIn}:${c.fadeOut}:${c.amount}:${c.shape}:${c.ease}:${c.off ? 1 : 0}:${c.repeat || 1}:${c.rev ? 1 : 0}:${c.form || ''}:${c.style || ''}`).join(',');
		const marksStr = (A.work ? `${A.work.a}-${A.work.b}` : '') + '|' + JSON.stringify(A.lanes || {});
		const sig = `${durTotal}|${keysStr}|${clipsStr}|${marksStr}|${selKey ? A.keys.indexOf(selKey) : -1}|${[...selSet].join(',')}`;

		if (sig !== lastRenderSig) {
			lastRenderSig = sig;
			renderRuler();
			renderWork();
			renderKeys();
			renderFxLanes();
			placeInspector();
		}
		clampAnimH();
	}
	app.bus.on('fxanim', animSync);
	app.bus.on('fx', animSync);
	// фон сцены: кнопка в нижней панели открывает палитру
	const BGS = [['', 'Как в редакторе'], ['#0b0d11', 'Чёрный'], ['#14161b', 'Графит'], ['#0d1b2a', 'Ночь'], ['#1a0f2e', 'Сумерки'], ['#2a1208', 'Янтарь'], ['#0f2a1f', 'Хвоя'], ['#ffffff', 'Белый']];
	const bgBtn = h('button', { type: 'button', class: 'btn btn-icon fx-bg-btn', 'aria-label': 'Цвет фона', 'data-tip': 'Цвет фона сцены', 'aria-expanded': 'false' }, h('span', { class: 'fx-bg-dot' }));
	const bgPop = h('div', { class: 'fx-bg-pop popover', hidden: true });
	const bgWrap = bgBtn;
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
	document.getElementById('viewport').append(bgPop);
	const bgGrid = switchRow('Сетка на полу', { value: !!st.look.grid, onChange: (v) => { st.look.grid = v; app.viewport.fxGrid = v; app.viewport.invalidate(); save(); } }, 'Плоскость из квадратов, как в редакторе');
	bgPop.append(h('div', { class: 'fx-bg-title' }, 'Фон и сцена'), bgSw, field('Свой цвет', bgColor.el), bgVig.el, bgGrid.el);
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
		bgGrid.set(!!st.look.grid);
		app.viewport.fxGrid = !!st.look.grid;
	}
	bgBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		recPop.hidden = true;
		recBtn.setAttribute('aria-expanded', 'false');
		bgPop.hidden = !bgPop.hidden;
		if (!bgPop.hidden) placeAbove(bgPop, bgBtn, document.getElementById('viewport'), 'center');
		bgBtn.setAttribute('aria-expanded', String(!bgPop.hidden));
	});
	document.addEventListener('pointerdown', (e) => {
		if (!bgPop.hidden && !bgPop.contains(e.target) && !bgBtn.contains(e.target) && !e.target.closest('.cp-pop')) {
			bgPop.hidden = true;
			bgBtn.setAttribute('aria-expanded', 'false');
		}
	});
	syncBg();

	// ------------------------------------------------------------ запись видео
	const REC_RES = [
		{ value: 'viewport', label: 'Как на экране', sub: 'Текущий размер сцены' },
		{ value: '1080p', label: '1080p Full HD', sub: '1920 × 1080 (16:9)' },
		{ value: '4k', label: '4K Ultra HD', sub: '3840 × 2160 (16:9)' },
		{ value: '720p', label: '720p HD', sub: '1280 × 720 (16:9)' },
		{ value: 'square', label: '1:1 Квадрат', sub: '1080 × 1080 (посты)' },
		{ value: 'reels', label: '9:16 Вертикальное', sub: '1080 × 1920 (Reels / Shorts)' }
	];

	const recOpts = recDefaults();
	const saveRecOpts = () => saveRecDefaults(recOpts);

	const recPop = h('div', { class: 'fx-rec-pop popover', hidden: true });
	document.getElementById('viewport').append(recPop);

	const recResSel = select({
		options: REC_RES,
		value: recOpts.res,
		onChange: (v) => { recOpts.res = v; saveRecOpts(); }
	});

	// частота и длительность: короткие варианты в ряд; формат (MP4, где браузер умеет), качество (высокое) и покадровая запись таймлайна выбираются сами
	const recFpsSeg = segmented({
		options: [
			{ value: '60', label: '60' },
			{ value: '30', label: '30' },
			{ value: '24', label: '24' }
		],
		value: String(recOpts.fps),
		onChange: (v) => { recOpts.fps = v; saveRecOpts(); }
	});

	const recDurSeg = segmented({
		options: [
			{ value: '0', label: 'Вручную' },
			{ value: '5', label: '5 с' },
			{ value: '10', label: '10 с' },
			{ value: '30', label: '30 с' }
		],
		value: ['0', '5', '10', '30'].includes(String(recOpts.dur)) ? String(recOpts.dur) : '0',
		onChange: (v) => { recOpts.dur = v; saveRecOpts(); }
	});

	// качество: чем выше, тем чище мелкие точки и тяжелее файл
	const recQualSeg = segmented({
		options: [
			{ value: 'light', label: 'Лёгкое', title: 'Самый маленький файл, мелкие точки чуть мягче' },
			{ value: 'good', label: 'Среднее', title: 'Небольшой файл, хорошо для соцсетей' },
			{ value: 'high', label: 'Высокое', title: 'Чисто и без ряби, файл средний' },
			{ value: 'max', label: 'Макс.', title: 'Почти без потерь, файл очень большой' }
		],
		value: ['light', 'good', 'high', 'max'].includes(recOpts.quality) ? recOpts.quality : 'high',
		onChange: (v) => { recOpts.quality = v; saveRecOpts(); }
	});

	const recSoundSw = switchRow('Звук', {
		value: recOpts.sound,
		onChange: (v) => { recOpts.sound = v; saveRecOpts(); }
	});

	const startRecBtn = button({
		label: 'Начать запись',
		icon: 'record',
		variant: 'primary',
		cls: 'btn-block fx-start-rec-btn',
		onClick: () => {
			recPop.hidden = true;
			recBtn.setAttribute('aria-expanded', 'false');
			engine.startRecording({
				resolution: recOpts.res,
				fps: parseInt(recOpts.fps, 10) || 60,
				format: 'auto',
				sound: !!recOpts.sound,
				duration: parseInt(recOpts.dur, 10) || 0,
				quality: recOpts.quality
			});
		}
	});

	const recRow = (label, el) => h('div', { class: 'fx-rec-row' }, h('span', { class: 'fx-rec-lab' }, label), el);
	recPop.append(
		h('div', { class: 'fx-rec-title' }, 'Запись видео'),
		recRow('Размер', recResSel.el),
		recRow('Кадров в секунду', recFpsSeg.el),
		recRow('Длительность', recDurSeg.el),
		recRow('Качество', recQualSeg.el),
		recSoundSw.el,
		startRecBtn
	);
	recBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (engine.recording) {
			engine.stopRecording();
			return;
		}
		bgPop.hidden = true;
		bgBtn.setAttribute('aria-expanded', 'false');
		recPop.hidden = !recPop.hidden;
		if (!recPop.hidden) {
			placeAbove(recPop, recBtn, document.getElementById('viewport'), 'center');
		}
		recBtn.setAttribute('aria-expanded', String(!recPop.hidden));
	});

	document.addEventListener('pointerdown', (e) => {
		if (!recPop.hidden && !recPop.contains(e.target) && !recBtn.contains(e.target) && !e.target.closest('.custom-select-pop')) {
			recPop.hidden = true;
			recBtn.setAttribute('aria-expanded', 'false');
		}
	});

	const leftBtn = iconButton({ icon: 'stack', title: 'Список эффектов', cls: 'fx-left-btn', onClick: () => document.getElementById('fxLeft').classList.toggle('fx-left-open') });
	bar.append(leftBtn, playBtn, camBtn, paintBtn, barMeters.el, h('span', { class: 'fx-bar-sep' }), bgWrap, orthoBtn, focusBtn, h('span', { class: 'fx-bar-sep' }), recBtn, keyAnimBtn, recTime);

	// ------------------------------------------------------------ синхронизация
	function sync() {
		if (chronoStat) {
			const I = engine.chronoInfo();
			const ai = I.mask === 'person' || I.mask === 'any';
			chronoStat.textContent = !I.video
				? 'Откройте видео: шлейф строится по его кадрам.'
				: !ai
					? I.mask === 'motion'
						? 'Выделяется то, что движется в кадре. Подходит, когда камера в ролике стоит на месте.'
						: 'Выделяется ближнее по карте глубины: чем выше чувствительность, тем дальше граница.'
					: I.phase === 'ready'
						? 'Нейросеть выделения работает: объект ищется на каждом кадре шлейфа.'
						: I.phase === 'error'
							? `Нейросеть выделения не загрузилась (${I.error}). Пока выделяется то, что движется.`
							: I.phase === 'loading'
								? 'Загружаю нейросеть выделения (около 3 МБ, один раз). Пока выделяется то, что движется.'
								: 'Нейросеть выделения загрузится при включении (около 3 МБ, нужен интернет). Кадры никуда не отправляются.';
		}
		const n = engine.geometry ? engine.geometry.attributes.position.count : st.count;
		countHint.textContent = `Сейчас ${formatInt(n)} частиц, около ${Math.round((n * 128) / 1048576)} МБ памяти. Комфортно до ${formatCount(getDevice(app).limits.comfort)}.`;
		const kind = engine.modelProvider ? engine.modelProvider.kind() : 'none';
		modelNote.textContent = kind === 'cloud' ? `Берётся облако точек из редактора (${formatInt(engine.modelProvider.total())} точек). Больше этого частиц не будет.` : kind === 'mesh' ? 'Берутся точки с поверхности вашей модели.' : 'Модели в сцене нет: показана готовая форма. Добавьте модель, и она заменит её.';
		countActive();
		// раздел «Видео» есть, пока открыто фото или видео; раскадровка и слит-скан только у видео, у фото раздел называется «Фото»
		for (const c of cards) {
			if (c.def.group !== 'Видео') continue;
			c.folder.hidden = !engine.pm.ready;
			if (c.def.id === 'frames' || c.def.id === 'slitscan' || c.def.id === 'chrono') c.card.hidden = !engine.videoLoaded;
		}
		{
			const vc = cards.find((c) => c.def.group === 'Видео');
			const nm = vc?.fhead.querySelector('.fx-folder-name');
			if (nm) nm.textContent = engine.pm.ready && !engine.videoLoaded ? 'Фото' : 'Видео';
		}
		// шлейф персонажа есть только у персонажа с анимацией
		for (const c of cards) if (c.def.group === 'Анимация') c.folder.hidden = !engine.animReady;
		special.hidden = !cards.some((c) => SPECIAL[c.def.group] && !c.folder.hidden);
		// настройки скрытого эффекта (глубина без фото, раскадровка без видео) не показываем: выбираем первый видимый
		const cur = cards.find((c) => c.def.id === selected);
		if (cur && (cur.folder.hidden || cur.card.hidden)) select_((cards.find((c) => !c.folder.hidden && c.L.on) || cards.find((c) => !c.folder.hidden) || cards[0]).def.id);
		renderReactList();
		cards.forEach((c) => {
			c.card.classList.toggle('is-on', c.L.on);
			c.insp.classList.toggle('is-off', !c.L.on);
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
		{
			const B = st.layers.brush;
			paintBtn.hidden = !B.on;
			const locked = B.lock !== 'off';
			paintBtn.classList.toggle('is-active', locked);
			paintBtn.dataset.tip = locked ? 'Камера зафиксирована: протяжка рисует, Alt + протяжка вращает сцену. Нажмите, чтобы разрешить вращение протяжкой' : 'Камера крутится протяжкой, рисовать неудобно. Нажмите, чтобы зафиксировать камеру и рисовать';
			const hint = document.getElementById('fxHint');
			if (hint) hint.textContent = B.on && locked ? 'Протяжка: рисовать · Alt + протяжка: вращать · Правая кнопка: сдвинуть · Колесо: приблизить' : 'Колесо мыши: приблизить · Правая кнопка: сдвинуть · Пробел: звук';
		}
		orthoBtn.classList.toggle('is-active', !!app.nav.ortho);
		orthoBtn.dataset.tip = app.nav.ortho ? 'Сейчас: ортогональная проекция. Включить перспективу' : 'Сейчас: перспектива. Включить ортогональную проекцию';
		recBtn.classList.toggle('is-rec', engine.recording);
		recBtn.dataset.tip = engine.recording ? 'Остановить запись и сохранить' : 'Параметры записи видео';
		if (!engine.recording) recTime.textContent = '';
	}
	app.bus.on('fx', () => {
		sync();
		refreshForms();
	});
	app.bus.on('media', () => {
		sync();
		refreshForms();
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
			const dur = engine.recOpts?.duration || 0;
			if (dur > 0) {
				recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} / ${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
			} else {
				recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
			}
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
