// Вкладка «Вид»: отображение, свет и фон, камера, управление мышью, привязка, производительность. Те же блоки и подписи в «Виде» режима эффектов.
import { h } from './util.js';
import { section, field, slider, fxSlider, segmented, select, switchRow, numberField } from './ui-kit.js';
import { BACKGROUNDS } from './viewport.js';

export const DISPLAY_MODES = [
	{ value: 'material', label: 'Материал', icon: 'palette', title: 'Текстуры и материалы (1)' },
	{ value: 'solid', label: 'Сплошной', icon: 'sphere', title: 'Серая глина без текстур (2)' },
	{ value: 'wire', label: 'Каркас', icon: 'cube-transparent', title: 'Только рёбра (3)' },
	{ value: 'points', label: 'Точки', icon: 'dots-nine', title: 'Облако точек из вершин (4)' },
	{ value: 'normals', label: 'Нормали', icon: 'compass', title: 'Направление граней цветом (5)' },
	{ value: 'uv', label: 'UV-сетка', icon: 'checkerboard', title: 'Проверочная сетка для UV (6)' },
];

export function createViewPanel(app, root) {
	const s = app.settings;
	const save = () => app.saveSettings();
	const redisplay = () => {
		app.display.apply();
		save();
	};

	// ------------------------------------------------------------ отображение
	const flat = switchRow('Плоское затенение', { value: s.flat, onChange: (v) => { s.flat = v; redisplay(); } });
	const ovRows = {};
	for (const [key, label, hint] of [
		['grid', 'Сетка', 'Плоскость пола и шаг сетки'],
		['axes', 'Оси координат', 'Красная линия X, синяя Z'],
		['bbox', 'Рамка выделения', 'Габаритный бокс выбранного объекта'],
	]) {
		ovRows[key] = switchRow(label, { value: s.overlays[key], onChange: (v) => { s.overlays[key] = v; app.display.apply(); app.viewport.updateSelectionBox(); save(); } }, hint);
	}
	// скелет есть смысл показывать, только когда в сцене модель с анимацией
	const skel = switchRow('Показать скелет', { value: app.anim.skeletonOn, onChange: (v) => app.anim.setSkeleton(v) }, 'Кости видны поверх модели; сайт их не анимирует, а проигрывает готовую анимацию из файла');
	const syncSkel = () => {
		skel.el.hidden = !app.anim.has;
		skel.set(app.anim.skeletonOn);
	};
	app.anim.onChange(syncSkel);
	syncSkel();
	const secDisplay = section('Отображение', { key: 'v-display' }, flat.el, ovRows.grid.el, ovRows.axes.el, ovRows.bbox.el, skel.el);

	// --------------------------------------------------------------- свет и фон
	const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Фон сцены' });
	const swButtons = new Map();
	for (const [id, bg] of Object.entries(BACKGROUNDS)) {
		const b = h('button', { type: 'button', class: 'sw', role: 'radio', 'aria-checked': String(s.render.bg === id), 'aria-label': bg.label, 'data-tip': bg.label, style: { background: bg.css } });
		b.addEventListener('click', () => {
			s.render.bg = id;
			swButtons.forEach((x, k) => x.setAttribute('aria-checked', String(k === id)));
			app.viewport.applyRenderSettings();
			app.display.apply();
			save();
		});
		swButtons.set(id, b);
		swatches.append(b);
	}
	const tone = select({
		options: [
			{ value: 'neutral', label: 'Нейтральная (точные цвета)' },
			{ value: 'aces', label: 'ACES (кинематографичная)' },
			{ value: 'agx', label: 'AgX (мягкая)' },
			{ value: 'none', label: 'Без обработки' },
		],
		value: s.render.tone,
		onChange: (v) => {
			s.render.tone = v;
			app.viewport.applyRenderSettings();
			app.display.apply();
			save();
		},
	});
	const exposure = fxSlider({ min: 0, max: 2, step: 0.05, value: s.render.exposure, onInput: (v) => { s.render.exposure = v; app.viewport.applyRenderSettings(); }, onChange: save });
	const env = fxSlider({ min: 0, max: 2, step: 0.05, value: s.render.env, onInput: (v) => { s.render.env = v; app.viewport.applyRenderSettings(); }, onChange: save });
	const head = switchRow('Свет от камеры', { value: s.render.headlight, onChange: (v) => { s.render.headlight = v; app.viewport.applyRenderSettings(); save(); } });
	const secLight = section('Свет и фон', { key: 'v-light' }, field('Фон', swatches), field('Тон', tone.el), field('Яркость', exposure.el), field('Окружение', env.el), head.el);

	// ------------------------------------------------------------------ камера
	const nav = s.nav;
	const fov = fxSlider({ noNorm: true, min: 10, max: 100, step: 1, value: s.render.fov, digits: 0, unit: '°', onInput: (v) => { s.render.fov = v; app.nav.applyCamera(); }, onChange: save });
	const ortho = switchRow('Ортогональная проекция', { value: s.nav.ortho, onChange: () => { app.nav.toggleOrtho(); save(); } });
	const autoPersp = switchRow('Авто-перспектива', { value: nav.autoPersp, onChange: (v) => { nav.autoPersp = v; save(); } }, 'Виды спереди и сверху включают ортогональную проекцию');
	const secCamera = section('Камера', { key: 'v-camera' }, field('Поле зрения', fov.el), ortho.el, autoPersp.el);

	// --------------------------------------------------------------- управление
	const rows = {
		leftOrbit: switchRow('Левая кнопка вращает', { value: nav.leftOrbit, onChange: (v) => { nav.leftOrbit = v; save(); } }),
		trackpad: switchRow('Режим трекпада', { value: nav.trackpad, onChange: (v) => { nav.trackpad = v; save(); } }, 'Скролл двумя пальцами вращает сцену'),
		zoomToCursor: switchRow('Масштаб к курсору', { value: nav.zoomToCursor, onChange: (v) => { nav.zoomToCursor = v; save(); } }),
		invertZoom: switchRow('Инвертировать колесо', { value: nav.invertZoom, onChange: (v) => { nav.invertZoom = v; save(); } }),
	};
	const legend = h(
		'div',
		{ class: 'legend' },
		...[
			['Вращение', 'СКМ или Alt + ЛКМ'],
			['Сдвиг', 'Shift + СКМ или ПКМ'],
			['Масштаб', 'Колесо или Ctrl + СКМ'],
			['Виды', '1, 3, 7 и Ctrl для обратных'],
			['Центр на точке', 'Двойной клик по модели'],
		].map(([a, b]) => h('div', { class: 'help-row' }, h('span', {}, a), h('span', { class: 'help-keys' }, b)))
	);
	const secNav = section('Управление мышью', { key: 'v-nav', open: false }, ...Object.values(rows).map((r) => r.el), legend);

	// ---------------------------------------------------------------- привязка
	const snapOn = switchRow('Привязка к шагу', { value: s.snap.on, onChange: (v) => { s.snap.on = v; app.model.applySnap(); app.bus.emit('tool'); save(); } });
	const snapMove = numberField({ value: s.snap.move, step: 0.05, digits: 4, min: 0.0001, onChange: (v) => { s.snap.move = v; app.model.applySnap(); save(); } });
	const snapRot = numberField({ value: s.snap.rotate, step: 5, digits: 2, min: 0.1, onChange: (v) => { s.snap.rotate = v; app.model.applySnap(); save(); } });
	const snapScale = numberField({ value: s.snap.scale, step: 0.05, digits: 3, min: 0.001, onChange: (v) => { s.snap.scale = v; app.model.applySnap(); save(); } });
	const secSnap = section('Привязка', { key: 'v-snap', open: false }, snapOn.el, field('Шаг сдвига', snapMove.el), field('Шаг поворота °', snapRot.el), field('Шаг масштаба', snapScale.el));

	// ------------------------------------------------------------ производительность
	const autoQ = switchRow('Авто-качество', { value: s.render.autoQuality, onChange: (v) => { s.render.autoQuality = v; save(); } }, 'Снижает чёткость, только пока компьютеру не хватает кадров, и возвращает её, когда запас появляется');
	const capSeg = segmented({ cls: 'seg-tight', options: [{ value: 0, label: 'Без лимита' }, { value: 30, label: '30 к/с', title: 'Вдвое меньше нагрузка на видеокарту и нагрев' }], value: s.render.fpsCap, onChange: (v) => { s.render.fpsCap = Number(v); save(); } });
	const fps = switchRow('Показывать FPS', { value: s.render.fps, onChange: (v) => { s.render.fps = v; app.ui.refreshFps(); save(); } });
	const secPerf = section('Производительность', { key: 'v-perf', open: false }, autoQ.el, field('Лимит кадров', capSeg.el, { wide: true }), fps.el);

	root.append(secDisplay.el, secLight.el, secCamera.el, secNav.el, secSnap.el, secPerf.el);

	const sync = () => {
		swButtons.forEach((x, k) => x.setAttribute('aria-checked', String(k === s.render.bg)));
		flat.set(s.flat);
		for (const k of Object.keys(ovRows)) ovRows[k].set(s.overlays[k]);
		ortho.set(app.nav.ortho);
		snapOn.set(s.snap.on);
	};
	app.bus.on('view', sync);
	app.bus.on('viewmode', () => ortho.set(app.nav.ortho));
	app.bus.on('tool', () => snapOn.set(s.snap.on));
	return { sync };
}
