// Раздел «Правка точек» во вкладке «Точки»: выделение, удаление и перекраска точек облака.
import { h, formatInt } from './util.js';
import { section, field, fxSlider as slider, segmented, switchRow, colorField, button } from './ui-kit.js';

export function createPointEditSection(app) {
	const pe = app.pointEdit;
	let paintHex = '#ff7a2e';
	let strength = 1;

	const note = h('div', { class: 'field-hint hint pe-note' });
	const toggle = button({ label: 'Выделять точки', icon: 'selection', variant: 'primary', cls: 'btn-block pe-toggle', onClick: () => pe.setActive(!pe.active) });
	const tool = segmented({
		options: [
			{ value: 'brush', label: 'Кисть', title: 'Закрашивайте точки кистью: всё под кругом выбирается' },
			{ value: 'rect', label: 'Прямоугольник', title: 'Протяните рамку: выберутся все точки внутри' },
		],
		value: pe.tool,
		onChange: (v) => {
			pe.tool = v;
			sync();
		},
	});
	const mode = segmented({
		options: [
			{ value: 'add', label: 'Добавлять', title: 'Выбирать точки' },
			{ value: 'sub', label: 'Убирать', title: 'Снимать выбор с точек (то же с зажатым Ctrl)' },
		],
		value: pe.mode,
		onChange: (v) => {
			pe.mode = v;
		},
	});
	const radius = slider({ noNorm: true, min: 4, max: 200, step: 1, value: pe.radius, format: (v) => v + ' px', onInput: (v) => (pe.radius = v) });
	const rowRadius = field('Размер кисти', radius.el);
	const through = switchRow('Сквозь модель', { value: pe.through, onChange: (v) => (pe.through = v) }, 'Выбирать и точки, которые закрыты другими: по умолчанию берутся только видимые');
	const bAll = button({ label: 'Все', variant: 'secondary', cls: 'btn-sm', title: 'Выбрать все точки (Ctrl+A)', onClick: () => pe.selectAll() });
	const bNone = button({ label: 'Снять', variant: 'secondary', cls: 'btn-sm', title: 'Снять выбор', onClick: () => pe.clear() });
	const bInv = button({ label: 'Наоборот', variant: 'secondary', cls: 'btn-sm', title: 'Инвертировать выбор (Ctrl+I)', onClick: () => pe.invert() });
	const rowSel = h('div', { class: 'pe-row' }, bAll, bNone, bInv);
	const count = h('div', { class: 'pe-count' });
	const bDel = button({ label: 'Удалить выбранные', icon: 'trash', variant: 'secondary', cls: 'btn-block pe-del', title: 'Удалить выбранные точки (Delete или X)', onClick: () => pe.deleteSelected() });
	const color = colorField({ value: paintHex, onInput: (v) => (paintHex = v), onChange: (v) => (paintHex = v) });
	const str = slider({ noNorm: true, min: 5, max: 100, step: 5, value: 100, format: (v) => v + '%', onInput: (v) => (strength = v / 100) });
	const bPaint = button({ label: 'Закрасить выбранные', icon: 'paint-brush', variant: 'primary', cls: 'btn-block', title: 'Перекрасить выбранные точки в этот цвет', onClick: () => pe.paintSelected(paintHex, strength) });
	const keys = h('div', { class: 'field-hint hint pe-keys' }, 'Alt + протяжка: вращать сцену. Колесо: приблизить. [ и ]: размер кисти. Esc: выйти.');

	const sec = section('Правка точек', { key: 'p-edit' }, note, toggle, tool.el, mode.el, rowRadius, through.el, rowSel, count, bDel, field('Цвет', color.el), field('Сила', str.el), bPaint, keys);

	function sync() {
		const t = pe.target();
		const n = t ? t.geometry.attributes.position.count : 0;
		note.textContent = !t ? 'Выберите облако точек в сцене. Если у вас сетка, сначала создайте из неё облако точек выше.' : `Облако: ${formatInt(n)} точек. Выделите нужные и удалите или перекрасьте их.`;
		toggle.disabled = !t;
		toggle.querySelector('.btn-label').textContent = pe.active ? 'Готово' : 'Выделять точки';
		toggle.classList.toggle('is-active', pe.active);
		rowRadius.hidden = pe.tool !== 'brush';
		tool.set(pe.tool);
		mode.set(pe.mode);
		radius.set(pe.radius);
		count.textContent = t ? `Выбрано: ${formatInt(pe.count)} из ${formatInt(n)}` : '';
		const has = !!t && pe.count > 0;
		bDel.disabled = !has;
		bPaint.disabled = !has;
		keys.hidden = !pe.active;
	}
	app.bus.on('pointedit', sync);
	app.bus.on('selection', sync);
	app.bus.on('scene', sync);
	app.bus.on('geometry', sync);
	sync();
	return sec;
}
