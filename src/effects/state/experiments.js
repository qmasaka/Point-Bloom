const range = (key, label, min = 0, max = 1, step = 0.01, unit = '', when) => ({
	key, label, min, max, step, ...(unit && { unit, noNorm: true, int: step === 1, digits: step === 1 ? 0 : step < 0.1 ? 2 : 1 }), ...(when && { when }),
});
const VIEW_FORMS = [
	['none', 'Как есть', 'Без изменений'], ['twist', 'Скрутка', 'Поворот по высоте'], ['wave', 'Волна', 'Складки и изгибы'], ['sphere', 'Шар', 'Форма собирается в шар'],
	['flat', 'Силуэт', 'Плоский срез по взгляду'], ['dust', 'Пыль', 'Точки разлетаются'], ['cubes', 'Кубики', 'Привязка к решётке'], ['vase', 'Ваза', 'Сужения по высоте'], ['photo', 'Фото', 'Своё фото для угла'],
];
const FORM_ACTIVE = VIEW_FORMS.map(([id]) => id).filter((id) => id !== 'none');
const formPick = (key, label) => ({ key, label, type: 'select', options: VIEW_FORMS });
const seg = (key, label, options) => ({ type: 'seg', key, label, options });
const action = (label, act) => ({ type: 'button', label, act, icon: 'arrow-counter-clockwise' });
const experiment = (id, name, icon, hint, def, extras) => ({
	id, name, icon, hint, group: 'Эксперименты', max: 1, def: { on: false, amount: 1, band: 'none', react: 0.65, ...def }, extras,
});

export const EXPERIMENT_LAYERS = [
	experiment('autophagy', 'Поглощение', 'aperture', 'Складки сцепляются и разъедают соседние участки. Поворот камеры меняет ход роста.', {
		style: 'fold', pull: 0.6, erosion: 0.6, speed: 1, memory: 2.5, ink: 0.3, hue: 1,
	}, [
		seg('style', 'Вид', [['fold', 'Складки'], ['vortex', 'Воронка'], ['erode', 'Эрозия']]),
		{ type: 'title', label: 'Движение', open: true },
		range('speed', 'Скорость роста', 0.25, 2.5, 0.05, ' ×'), range('pull', 'Сцепление'), range('erosion', 'Разъедание'), range('memory', 'Память кадра', 0.2, 8, 0.1, ' с'),
		{ type: 'title', label: 'Цвет', open: true },
		range('ink', 'Свечение'), range('hue', 'Цвет свечения'),
		action('Очистить обратную связь', 'resetAutophagy'),
	]),
	experiment('reactionSkin', 'Узор', 'atom', 'Колонии узора растут по поверхности. Щёлкните по модели, чтобы посеять новую.', {
		style: 'spots', growth: 0.6, colony: 1.3, scale: 1, speed: 1, ink: 0.8, trigger: 'manual', cover: 0.5, warp: 1, soft: 0.5, rim: 1, dots: 0.5, hue: 0.55, dye: 'palette',
	}, [
		seg('style', 'Вид', [['spots', 'Пятна'], ['maze', 'Лабиринт'], ['branches', 'Жилки']]),
		{ type: 'title', label: 'Рост', open: true },
		range('speed', 'Скорость роста', 0.25, 2.5, 0.05, ' ×'), range('colony', 'Размер колонии', 0.2, 2.4, 0.05, ' м'),
		seg('trigger', 'Новая колония', [['manual', 'По щелчку'], ['beat', 'По биту']]),
		{ type: 'title', label: 'Рисунок', open: true },
		range('scale', 'Размер узора', 0.5, 2, 0.05, ' ×'), range('cover', 'Покрытие'), range('warp', 'Извилистость', 0.2, 2.5, 0.05, ' ×'), range('soft', 'Мягкость края'),
		{ type: 'title', label: 'Рельеф и свет', open: true },
		range('growth', 'Рельеф'), range('dots', 'Размер точек'), range('rim', 'Свечение кромки', 0, 2, 0.05, ' ×'),
		{ type: 'title', label: 'Цвет', open: true },
		seg('dye', 'Цвет узора', [['palette', 'Палитра'], ['model', 'Как модель']]),
		range('ink', 'Насыщенность'), range('hue', 'Сдвиг цвета'),
		action('Начать заново', 'resetReactionSkin'),
	]),
	experiment('impossible', 'Ракурс', 'cube-focus', 'С каждой стороны форма выглядит по-своему. Крутите сцену или включите вращение формы: виды сменяют друг друга по кругу.', {
		a: 'none', b: 'twist', c: 'dust', powerA: 1, powerB: 1, powerC: 1, offset: 0, blend: 0.7, spread: 0.7, arc: 0.72, shine: 1,
	}, [
		{ type: 'title', label: 'Виды', open: true },
		formPick('a', 'С 0°'), range('powerA', 'Сила 0°', 0, 1.5, 0.05, ' ×', ['a', FORM_ACTIVE]),
		formPick('b', 'С 120°'), range('powerB', 'Сила 120°', 0, 1.5, 0.05, ' ×', ['b', FORM_ACTIVE]),
		formPick('c', 'С 240°'), range('powerC', 'Сила 240°', 0, 1.5, 0.05, ' ×', ['c', FORM_ACTIVE]),
		{ type: 'photos' },
		{ type: 'title', label: 'Переход', open: true },
		range('offset', 'Поворот видов', -180, 180, 1, '°'), range('blend', 'Плавность'), range('spread', 'Разброс точек'), range('arc', 'Дуга перехода', 0, 1.6, 0.01, ' ×'), range('shine', 'Свечение перехода', 0, 2, 0.05, ' ×'),
	]),
	{ ...experiment('causalWounds', 'Шрамы', 'spiral', '', { radius: 0.28, depth: 0.75, healing: 7, memory: 1.8, layers: 4, spacing: 0.15, roughness: 0.55, ink: 0.85, spread: 0.7 }, []), hidden: true },
	{ ...experiment('phaseInterference', 'Фаза', 'waves', '', {}, []), hidden: true },
	{ ...experiment('recursiveAnatomy', 'Фрактал', 'circles-four', '', { layout: 'surface', levels: 3, scale: 0.31, density: 0.82, copies: 10, spread: 1.12, rotation: 28, detail: 0.45, ink: 0.35, revealAt: 4.5 }, []), hidden: true },
];

export const EXPERIMENT_IDS = EXPERIMENT_LAYERS.filter((layer) => !layer.hidden).map((layer) => layer.id);
