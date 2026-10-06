// Вкладка «Точки»: создание облака точек, выбор количества и внешний вид точек.
import { h, formatInt } from './util.js';
import { section, field, slider, segmented, switchRow, colorField, button } from './ui-kit.js';
import * as THREE from 'three';
import { sampleSurface, verticesToCloud, cloudToPoints, overrideMats } from './pointcloud.js';
import { getDevice, hintForCount } from './device-card.js';
import { createTextSection } from './text-points.js';

const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));

export const SHAPES = [
	{ value: 'circle', label: 'Круг' },
	{ value: 'square', label: 'Квадрат' },
	{ value: 'sphere', label: 'Шар' },
	{ value: 'ring', label: 'Кольцо' },
	{ value: 'diamond', label: 'Ромб' },
	{ value: 'plus', label: 'Плюс' },
];

export function createPointsPanel(app, root) {
	const model = app.model;
	const pt = app.settings.point;
	const save = () => app.saveSettings();
	const dev = getDevice(app);
	const cap = () => Math.max(100000, getDevice(app).limits.cap);
	pt.surfaceCount = Math.min(pt.surfaceCount, cap());
	let current = null; // { obj, meshes, kind } последнее созданное облако
	let busy = false;

	// ---------------------------------------------------------------- создание
	const hint = h('div', { class: 'field-hint hint' });
	const showHint = () => {
		if (pt.source === 'vertices') {
			hint.className = 'field-hint hint';
			hint.textContent = 'Одна точка на каждую вершину модели. Количество задаётся самой моделью.';
			return;
		}
		const hh = hintForCount(app, pt.surfaceCount);
		hint.className = 'field-hint hint hint-' + hh.level;
		hint.textContent = hh.text;
	};
	const source = segmented({
		options: [
			{ value: 'surface', label: 'По поверхности', title: 'Равномерно рассыпать точки по всей поверхности' },
			{ value: 'vertices', label: 'По вершинам', title: 'Каждая вершина модели становится точкой' },
		],
		value: pt.source,
		onChange: (v) => {
			pt.source = v;
			save();
			sync();
		},
	});
	const count = slider({
		log: true,
		min: 10000,
		max: cap(),
		step: 10000,
		value: pt.surfaceCount,
		format: (v) => formatInt(v),
		onInput: (v) => {
			pt.surfaceCount = v;
			showHint();
		},
		onChange: () => {
			save();
			// ползунок сразу показывает результат: пересобираем облако (или создаём первое)
			build({ auto: true });
		},
	});
	const rowCount = field('Точек', count.el);
	const hideSource = switchRow('Скрыть исходную модель', { value: true, onChange: () => {} });
	const goBtn = button({ label: 'Создать облако точек', icon: 'dots-nine', variant: 'primary', cls: 'btn-block', onClick: () => build({}) });
	const status = h('div', { class: 'field-hint' });

	function liveCurrent() {
		if (current && !current.obj.parent) current = null;
		return current;
	}

	function sources() {
		const sel = model.selected;
		const base = sel && !sel.isPoints ? model.meshesOf(sel) : model.meshes();
		return base.filter((m) => app.viewport.isVisibleInTree(m));
	}

	async function build({ auto = false } = {}) {
		if (busy) return;
		const cur = liveCurrent();
		const meshes = cur ? cur.meshes : sources();
		if (!meshes.length) {
			if (!auto) app.toast('Сначала откройте модель: из чего строить облако?', 'warn');
			return;
		}
		busy = true;
		try {
			app.ui.busy('Строю облако точек', 0.1);
			await new Promise((r) => setTimeout(r, 30));
			const entries = meshes.map((m) => ({ mesh: m, mats: overrideMats(app.pointTexture, app.display.getOriginal(m)) }));
			const kind = pt.source;
			const cloud = kind === 'vertices' ? verticesToCloud(entries) : await sampleSurface(entries, pt.surfaceCount, { onProgress: (p) => app.ui.busy('Строю облако точек', 0.1 + p * 0.85) });
			if (!cloud.count) throw new Error('получилось 0 точек');
			const pts = cloudToPoints(cloud, `Облако точек (${compact(cloud.count)})`);
			if (cur) {
				// заменяем геометрию в уже созданном облаке, история не засоряется
				const old = cur.obj.geometry;
				cur.obj.geometry = pts.geometry;
				cur.obj.name = pts.name;
				cur.kind = kind;
				old.dispose();
				model.changed();
				app.bus.emit('geometry');
			} else {
				const hide = hideSource.el.querySelector('.switch').getAttribute('aria-checked') === 'true';
				const was = meshes.map((m) => [m, m.visible]);
				app.history.push(
					{
						label: 'Облако точек',
						redo: () => {
							model.add(pts, model.root);
							if (hide) was.forEach(([m]) => (m.visible = false));
							model.changed({ display: false });
							model.select(pts);
						},
						undo: () => {
							model.remove(pts);
							was.forEach(([m, v]) => (m.visible = v));
							model.changed({ display: false });
						},
					},
					true
				);
				current = { obj: pts, meshes, kind };
			}
			if (app.settings.display !== 'points') app.setDisplay('points');
			else app.display.apply();
			app.toast(`Облако точек: ${formatInt(cloud.count)}`, 'ok', 2200);
		} catch (e) {
			console.error(e);
			app.toast('Не удалось построить облако точек: ' + (e.message || e), 'error');
		} finally {
			busy = false;
			app.ui.idle();
			sync();
		}
	}

	const secCreate = section('Облако точек', { key: 'p-create' }, source.el, rowCount, hint, hideSource.el, goBtn, status);

	// ---------------------------------------------------------------- внешний вид
	const showPoints = () => {
		if (app.settings.display !== 'points') app.setDisplay('points');
	};
	const inv = () => {
		app.viewport.invalidate();
	};
	const tiles = h('div', { class: 'shape-grid', role: 'radiogroup', 'aria-label': 'Форма точек' });
	const tileBtns = new Map();
	for (const s of SHAPES) {
		const b = h('button', { type: 'button', class: 'shape-tile', role: 'radio', 'aria-checked': String(pt.shape === s.value), 'data-shape': s.value }, h('span', { class: 'shape-glyph' }), h('span', { class: 'shape-name' }, s.label));
		b.addEventListener('click', () => {
			pt.shape = s.value;
			tileBtns.forEach((x, k) => x.setAttribute('aria-checked', String(k === s.value)));
			showPoints();
			inv();
			save();
		});
		tileBtns.set(s.value, b);
		tiles.append(b);
	}
	const size = slider({ min: 1, max: 24, step: 0.5, value: pt.size, digits: 1, unit: ' px', onInput: (v) => { pt.size = v; showPoints(); inv(); }, onChange: save });
	const att = switchRow('Мельче вдали', { value: pt.attenuate, onChange: (v) => { pt.attenuate = v; showPoints(); inv(); save(); } });
	const colorPick = colorField({ value: pt.solidColor, onInput: (v) => { pt.solidColor = v; inv(); }, onChange: save });
	const colorRow = field('Свой цвет', colorPick.el);
	const colorMode = segmented({
		options: [
			{ value: 'texture', label: 'Текстура', title: 'Цвета из текстуры модели' },
			{ value: 'solid', label: 'Цвет', title: 'Один цвет для всех точек' },
			{ value: 'normal', label: 'Нормали', title: 'Цвет по направлению поверхности' },
			{ value: 'height', label: 'Высота', title: 'Цвет по высоте, от синего к красному' },
		],
		value: pt.color,
		onChange: (v) => {
			pt.color = v;
			colorRow.hidden = v !== 'solid';
			showPoints();
			inv();
			save();
		},
	});
	colorRow.hidden = pt.color !== 'solid';
	const secLook = section('Вид точек', { key: 'p-look' }, tiles, field('Размер', size.el), field('Цвет', colorMode.el, { wide: true }), colorRow, att.el);

	// своя текстура для цвета точек (по UV модели); без неё берётся текстура самой модели
	const texIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
	const texName = h('div', { class: 'field-hint' });
	const showTex = () => {
		texName.textContent = app.pointTexture ? `Своя текстура: ${app.pointTexture.name || 'картинка'}` : 'Цвет берётся из текстуры самой модели.';
	};
	const applyTex = async (tex) => {
		app.pointTexture = tex;
		showTex();
		app.bus.emit('pointtex');
		if (liveCurrent()) await build({ auto: true });
	};
	texIn.addEventListener('change', async () => {
		const f = texIn.files[0];
		texIn.value = '';
		if (!f) return;
		const url = URL.createObjectURL(f);
		try {
			const tex = await new THREE.TextureLoader().loadAsync(url);
			tex.colorSpace = THREE.SRGBColorSpace;
			tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
			tex.name = f.name;
			await applyTex(tex);
		} catch (e) {
			app.toast('Не удалось открыть картинку', 'error');
		} finally {
			URL.revokeObjectURL(url);
		}
	});
	const texPick = button({ label: 'Указать текстуру…', icon: 'image', variant: 'secondary', title: 'Картинка ляжет на модель по её UV, и точки возьмут цвета из неё', onClick: () => texIn.click() });
	const texReset = button({ label: 'Из модели', icon: 'arrow-counter-clockwise', variant: 'ghost', title: 'Вернуть текстуру самой модели', onClick: () => applyTex(null) });
	const texRow = h('div', { class: 'fx-tex-row' }, texIn, texPick, texReset);
	showTex();
	secLook.body ? secLook.body.append(texRow, texName) : secLook.el.append(texRow, texName);
	root.append(createTextSection(app).el, secCreate.el, secLook.el);

	// ---------------------------------------------------------------- синхронизация
	function sync() {
		const vertices = pt.source === 'vertices';
		source.set(pt.source);
		rowCount.hidden = vertices;
		showHint();
		const cur = liveCurrent();
		goBtn.querySelector('.btn-label').textContent = cur ? 'Пересоздать облако' : 'Создать облако точек';
		hideSource.el.hidden = !!cur;
		status.textContent = cur ? `Сейчас в сцене: ${formatInt(cur.obj.geometry.attributes.position.count)} точек. Ползунок обновляет облако сразу.` : '';
		tileBtns.forEach((x, k) => x.setAttribute('aria-checked', String(k === pt.shape)));
		size.set(pt.size);
		att.set(pt.attenuate);
		colorMode.set(pt.color);
		colorRow.hidden = pt.color !== 'solid';
	}
	app.bus.on('device', () => {
		const c = cap();
		count.setRange(10000, c);
		pt.surfaceCount = Math.min(pt.surfaceCount, c);
		count.set(pt.surfaceCount);
		showHint();
	});
	app.bus.on('scene', sync);
	app.bus.on('pointsettings', () => {
		count.set(pt.surfaceCount);
		showHint();
	});
	app.bus.on('newdoc', () => {
		current = null;
		sync();
	});
	sync();
	return { refresh: sync };
}
