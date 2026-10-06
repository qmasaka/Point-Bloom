/**
 * Движок эффектов для облака точек. Идея взята из TouchDesigner (POP): цепочка независимых «операторов»
 * (шум, спектр, волны, скручивание, пульс, воксели, дрожь, курсор), каждый из которых можно включить,
 * настроить и привязать к полосе звука (бас, середина, верх, бит). Вся геометрия считается на видеокарте.
 */
import * as THREE from 'three';
import { loadJSON, saveJSON, mergeDeep, downloadBlob, clamp } from './util.js';
import { TrackerHud } from './fx-hud.js';
import { HandTracker } from './hand-tracker.js';

// ───────────────────────────────────────────────────────────── описания

export const FX_SHAPES = [
	{ id: 'model', name: 'Модель', icon: 'cube' },
	{ id: 'media', name: 'Фото', icon: 'image' },
	{ id: 'sphere', name: 'Сфера', icon: 'sphere' },
	{ id: 'torus', name: 'Тор', icon: 'circle-notch' },
	{ id: 'cube', name: 'Куб', icon: 'cube-transparent' },
	{ id: 'helix', name: 'ДНК', icon: 'dna' },
	{ id: 'saturn', name: 'Сатурн', icon: 'planet' },
	{ id: 'galaxy', name: 'Галактика', icon: 'spiral' },
	{ id: 'plane', name: 'Плоскость', icon: 'grid-four' },
];

export const BANDS = [
	{ id: 'none', label: '—', title: 'Без реакции на звук' },
	{ id: 'bass', label: 'Бас', title: 'Низкие частоты: барабан, бас' },
	{ id: 'mid', label: 'Сер.', title: 'Средние частоты: голос, синтезатор' },
	{ id: 'high', label: 'Верх', title: 'Высокие частоты: тарелки, шипение' },
	{ id: 'beat', label: 'Бит', title: 'Удар: вспышка на каждый такт' },
];

/** Действия, которые можно назначить жесту руки */
export const FX_ACTIONS = [['none', 'Ничего'], ['push', 'Отталкивать'], ['pull', 'Притягивать'], ['swirl', 'Вихрь'], ['rotate', 'Крутить форму'], ['sculpt', 'Лепить'], ['gravity', 'Гравитация у руки'], ['wave', 'Ударная волна'], ['break', 'Распад, пока держишь'], ['dissolve', 'Растворение, пока держишь'], ['brush', 'Светящийся след'], ['fx:curl', 'Эффект: Вихри'], ['fx:wave', 'Эффект: Волны'], ['fx:pulse', 'Эффект: Пульс'], ['fx:voxel', 'Эффект: Воксели'], ['fx:glitch', 'Эффект: Глитч'], ['fx:links', 'Эффект: Связи'], ['fx:slice', 'Эффект: Срез'], ['fx:echo', 'Эффект: Шлейф']];

/** Готовые схемы жестов */
export const FX_GESTURE_PRESETS = [
	{ name: 'Игра', tip: 'Ладонь толкает, кулак рассыпает форму, щипок крутит, палец рисует, знак мира пускает волну', v: { g_palm: 'push', g_fist: 'break', g_pinch: 'rotate', g_point: 'brush', g_peace: 'wave', g_rock: 'fx:glitch', g_thumb: 'gravity' } },
	{ name: 'Скульптор', tip: 'Щипок лепит глину, ладонь крутит, кулак притягивает', v: { g_palm: 'rotate', g_fist: 'pull', g_pinch: 'sculpt', g_point: 'push', g_peace: 'swirl', g_rock: 'fx:glitch', g_thumb: 'none' } },
	{ name: 'Космос', tip: 'Ладонь включает гравитацию у руки, кулак притягивает, щипок крутит', v: { g_palm: 'gravity', g_fist: 'pull', g_pinch: 'rotate', g_point: 'brush', g_peace: 'fx:echo', g_rock: 'fx:wave', g_thumb: 'dissolve' } },
	{ name: 'Магия', tip: 'Ладонь вихрем, кулак растворяет форму, щипок пускает волну, рога включают срез', v: { g_palm: 'swirl', g_fist: 'dissolve', g_pinch: 'wave', g_point: 'brush', g_peace: 'fx:links', g_rock: 'fx:slice', g_thumb: 'break' } },
];

/** Слои-операторы. group: раздел в левой панели; extras: дополнительные параметры; relink: пересобрать связи */
export const FX_LAYERS = [
	{ id: 'curl', group: 'Движение', name: 'Вихри', icon: 'tornado', hint: 'Частицы отрываются и плывут по вихрям', max: 2, def: { on: false, amount: 0.8, band: 'bass', react: 0.6, scale: 1.8 }, extras: [{ key: 'scale', label: 'Размер вихрей', min: 0.5, max: 4, step: 0.1 }] },
	{ id: 'physics', group: 'Движение', name: 'Распад', icon: 'atom', hint: 'Форма раскалывается сверху вниз, осколки взлетают, закручиваются и падают на пол с отскоками. При сборке они возвращаются дугами и складываются обратно', max: 2, def: { on: false, amount: 1.0, band: 'bass', react: 0.5, gravity: 1.2, bounce: 0.55, wind: 0, burst: 1, peel: 0.6, swirl: 0.5, asm: 2.2 }, extras: [{ key: 'burst', label: 'Сила взрыва', min: 0.2, max: 2.5, step: 0.05 }, { key: 'peel', label: 'Расслоение (сверху вниз)', min: 0, max: 1, step: 0.05 }, { key: 'swirl', label: 'Закрутка осколков', min: 0, max: 2, step: 0.05 }, { key: 'gravity', label: 'Гравитация', min: 0.2, max: 3.0, step: 0.1 }, { key: 'bounce', label: 'Упругость пола', min: 0.1, max: 0.9, step: 0.05 }, { key: 'wind', label: 'Ветер', min: -1.5, max: 1.5, step: 0.1 }, { key: 'asm', label: 'Время сборки, с', min: 0.6, max: 6, step: 0.1 }] },
	{ id: 'spectrum', group: 'Движение', name: 'Спектр', icon: 'equalizer', hint: 'Форма вытягивается по частотам трека', max: 2, def: { on: false, amount: 0.9, band: 'none', react: 0, axis: 'angle' }, extras: [{ key: 'axis', label: 'Ось', type: 'seg', options: [['angle', 'По кругу'], ['height', 'По высоте']] }] },
	{ id: 'wave', group: 'Движение', name: 'Волны', icon: 'waves', hint: 'Круги расходятся от центра', max: 2, def: { on: false, amount: 0.7, band: 'mid', react: 0.8, freq: 5 }, extras: [{ key: 'freq', label: 'Частота', min: 1, max: 14, step: 0.5 }] },
	{ id: 'twist', hidden: true, group: 'Движение', name: 'Скручивание', icon: 'wind', hint: 'Форма закручивается вокруг вертикали', max: 3, def: { on: false, amount: 1, band: 'none', react: 0 }, extras: [] },
	{ id: 'pulse', group: 'Движение', name: 'Пульс', icon: 'pulse', hint: 'Форма раздувается на каждый удар', max: 2, def: { on: false, amount: 0.8, band: 'beat', react: 1 }, extras: [] },
	{ id: 'alive', group: 'Движение', name: 'Живая форма', icon: 'heartbeat', hint: 'Форма дышит, у неё бьётся сердце, и она с любопытством тянется к курсору', max: 1.5, def: { on: false, amount: 1, band: 'none', react: 0, breath: 0.6, heart: 0.7, bpm: 62, lean: 0.8 }, extras: [{ key: 'breath', label: 'Дыхание', min: 0.2, max: 2, step: 0.05 }, { key: 'heart', label: 'Сердцебиение', min: 0, max: 1.5, step: 0.05 }, { key: 'bpm', label: 'Пульс, уд/мин', min: 40, max: 140, step: 1, int: true }, { key: 'lean', label: 'Тянется к курсору', min: 0, max: 1.5, step: 0.05 }] },
	{ id: 'dissolve', group: 'Движение', name: 'Растворение', icon: 'snowflake', hint: 'Частицы отрываются от формы, уносятся ветром и гаснут, пока модель не исчезнет. Потом она собирается обратно', max: 1, def: { on: false, amount: 1, band: 'none', react: 0, mode: 'loop', order: 'top', speed: 0.8, progress: 0.4, fall: 0.8, wind: 0.5, turb: 0.8 }, extras: [{ key: 'mode', label: 'Запуск', type: 'seg', options: [['loop', 'Цикл'], ['button', 'Кнопкой'], ['slider', 'Ползунок']] }, { key: 'order', label: 'С какой стороны', type: 'seg', options: [['top', 'Сверху'], ['noise', 'Пятнами'], ['bottom', 'Снизу']] }, { key: 'speed', label: 'Скорость', min: 0.1, max: 3, step: 0.1 }, { key: 'progress', label: 'Прогресс (для ползунка)', min: 0, max: 1, step: 0.01 }, { key: 'fall', label: 'Падение вниз', min: 0, max: 2, step: 0.05 }, { key: 'wind', label: 'Ветер в сторону', min: -2, max: 2, step: 0.1 }, { key: 'turb', label: 'Завихрения', min: 0, max: 2, step: 0.05 }] },
	{ id: 'voxel', group: 'Движение', name: 'Воксели', icon: 'squares-four', hint: 'Точки прилипают к кубической сетке', max: 1, def: { on: false, amount: 0.6, band: 'beat', react: 1 }, extras: [] },
	{ id: 'jitter', hidden: true, group: 'Движение', name: 'Дрожь', icon: 'waveform', hint: 'Мелкая вибрация на высоких частотах', max: 2, def: { on: false, amount: 0.7, band: 'high', react: 1 }, extras: [] },
	{ id: 'glitch', group: 'Движение', name: 'Глитч', icon: 'lightning', hint: 'Полосы формы рывками сдвигаются в сторону', max: 2, def: { on: false, amount: 0.8, band: 'beat', react: 1, slices: 16 }, extras: [{ key: 'slices', label: 'Число полос', min: 6, max: 40, step: 1 }] },
	{ id: 'links', group: 'Графика', name: 'Связи', icon: 'share-network', hint: 'Светящиеся нити между соседними точками с бегущими импульсами', max: 2, def: { on: false, amount: 1, band: 'beat', react: 0.5, range: 0.2, width: 1.8, count: 3500, pulses: 'on', pulseSpeed: 1.6 }, extras: [{ key: 'width', label: 'Толщина нитей', min: 0.6, max: 6, step: 0.2, unit: ' px' }, { key: 'range', label: 'Длина связей', min: 0.02, max: 0.5, step: 0.01 }, { key: 'count', label: 'Узлов', min: 500, max: 8000, step: 250, relink: true, int: true }, { key: 'pulses', label: 'Импульсы света', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'pulseSpeed', label: 'Скорость импульсов', min: 0.5, max: 4.0, step: 0.2 }] },
	{ id: 'slice', group: 'Графика', name: 'Срез / Изолинии', icon: 'scan', hint: 'Лазерные линии, рельеф из точек на линиях или развёртка: форма постепенно проявляется за бегущей плоскостью', max: 2, def: { on: false, amount: 1, band: 'none', react: 0, mode: 'relief', speed: 0.5, width: 0.08, count: 4, axis: 'y', lift: 0.25, bounce: 'on', color: 'auto' }, extras: [{ key: 'mode', label: 'Вид', type: 'seg', options: [['laser', 'Лазер'], ['relief', 'Рельеф'], ['cut', 'Развёртка']] }, { key: 'count', label: 'Число линий', min: 1, max: 12, step: 1, int: true }, { key: 'speed', label: 'Скорость', min: 0.05, max: 2, step: 0.05 }, { key: 'width', label: 'Толщина', min: 0.003, max: 0.3, step: 0.002 }, { key: 'lift', label: 'Высота рельефа', min: 0, max: 0.8, step: 0.01 }, { key: 'bounce', label: 'Движение', type: 'seg', options: [['on', 'Туда и обратно'], ['off', 'В одну сторону']] }, { key: 'color', label: 'Цвет линии', type: 'color' }, { key: 'axis', label: 'Ось', type: 'seg', options: [['y', 'Y'], ['x', 'X'], ['z', 'Z'], ['diag', 'Диаг.']] }] },
	{ id: 'feedback', group: 'Графика', name: 'Feedback-след', icon: 'spiral', hint: 'Настоящий видео-след (Feedback TOP) с затуханием, зумом и вращением', max: 1, def: { on: false, amount: 0.92, band: 'none', react: 0, zoom: 1.004, twist: 0.002 }, extras: [{ key: 'zoom', label: 'Зум туннеля', min: 0.98, max: 1.03, step: 0.002 }, { key: 'twist', label: 'Спираль (угол)', min: -0.02, max: 0.02, step: 0.001 }] },
	{ id: 'echo', group: 'Графика', name: 'Шлейф', icon: 'ghost', hint: 'Призрачные копии формы: тянутся следом, закручиваются спиралью или раскладываются зеркальным веером', max: 1.5, def: { on: false, amount: 0.8, band: 'beat', react: 0.5, mode: 'spiral', copies: 4, delay: 0.14, spread: 0.45, fade: 0.7 }, extras: [{ key: 'mode', label: 'Вид', type: 'seg', options: [['spiral', 'Спираль'], ['kaleido', 'Зеркала'], ['time', 'След']] }, { key: 'copies', label: 'Копий', min: 1, max: 5, step: 1, int: true }, { key: 'spread', label: 'Угол между копиями', min: 0.05, max: 1.5, step: 0.05 }, { key: 'delay', label: 'Задержка, с', min: 0.02, max: 0.6, step: 0.01 }, { key: 'fade', label: 'Затухание копий', min: 0.3, max: 0.95, step: 0.05 }] },
	{ id: 'tracking', group: 'Взаимодействие', name: 'Трекинг', icon: 'bounding-box', hint: 'Рамки захватывают подвижные участки формы и по желанию прикасаются к ней: подъём, вихрь или втягивание', max: 1.5, def: { on: false, amount: 1, band: 'bass', react: 0.4, count: 8, size: 70, shape: 'corners', color: 'auto', thick: 1.5, labels: 'on', lines: 'on', fill: 'none', follow: 'wander', mark: 'none', touch: 'bump', force: 1, radius: 0.35, memory: 1.5 }, extras: [{ key: 'count', label: 'Рамок', min: 2, max: 16, step: 1, int: true }, { key: 'size', label: 'Размер рамки', min: 8, max: 160, step: 1, int: true }, { key: 'shape', label: 'Форма', type: 'seg', options: [['corners', 'Углы'], ['box', 'Рамка'], ['circle', 'Круг'], ['cross', 'Прицел']] }, { key: 'color', label: 'Цвет', type: 'color' }, { key: 'thick', label: 'Толщина линий', min: 0.5, max: 4, step: 0.25 }, { key: 'labels', label: 'Подписи', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'lines', label: 'Связи рамок', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'fill', label: 'Заливка рамки', type: 'seg', options: [['none', 'Нет'], ['tint', 'Тон'], ['hatch', 'Штрих']] }, { key: 'follow', label: 'Куда смотрят рамки', type: 'seg', options: [['wander', 'Бродят'], ['pointer', 'Курсор, руки']] }, { type: 'title', label: 'Эффект в области рамок' }, { key: 'mark', label: 'Что происходит', type: 'select', options: [['none', 'Ничего'], ['invert', 'Негатив'], ['rainbow', 'Радуга'], ['hole', 'Дыра с пульсирующим краем'], ['lens', 'Лупа'], ['pixel', 'Пиксели'], ['glow', 'Свет']] }, { type: 'title', label: 'Касание формы' }, { key: 'touch', label: 'Действие', type: 'select', options: [['none', 'Нет'], ['bump', 'Подъём'], ['swirl', 'Вихрь'], ['pull', 'Втягивание'], ['push', 'Отталкивание'], ['ripple', 'Рябь'], ['melt', 'Таяние вниз'], ['scatter', 'Разлёт искрами'], ['vanish', 'Исчезновение']] }, { key: 'force', label: 'Сила касания', min: 0.2, max: 2, step: 0.05 }, { key: 'radius', label: 'Радиус области', min: 0.02, max: 0.9, step: 0.01 }, { key: 'memory', label: 'Память следа, с', min: 0, max: 6, step: 0.1 }] },
	{ id: 'cursor', group: 'Взаимодействие', name: 'Курсор', icon: 'cursor-click', hint: 'Мышь отталкивает или притягивает точки', max: 2, def: { on: true, amount: 1, band: 'none', react: 0, radius: 0.9, mode: 'repel' }, extras: [{ key: 'radius', label: 'Радиус', min: 0.05, max: 2, step: 0.01 }, { key: 'mode', label: 'Действие', type: 'seg', options: [['repel', 'Отталкивать'], ['attract', 'Притягивать']] }] },
	{ id: 'brush', group: 'Взаимодействие', name: 'Кисть', icon: 'paint-brush', hint: 'Рисование курсором по форме: частицы в мазках светятся и оживают, затем след высыхает', max: 2, def: { on: false, amount: 1.0, band: 'none', react: 0, radius: 0.4, dry: 3.5 }, extras: [{ key: 'radius', label: 'Радиус кисти', min: 0.02, max: 0.9, step: 0.01 }, { key: 'dry', label: 'Высыхание, с', min: 1.0, max: 8.0, step: 0.5 }] },
	{ id: 'shock', group: 'Взаимодействие', name: 'Ударная волна', icon: 'aperture', hint: 'Клик по сцене пускает круговую волну по форме', max: 2, def: { on: false, amount: 1, band: 'none', react: 0, speed: 1.2, auto: 'off' }, extras: [{ key: 'speed', label: 'Скорость волны', min: 0.4, max: 3, step: 0.05 }, { key: 'auto', label: 'Запуск', type: 'seg', options: [['off', 'Клик'], ['on', 'Клик и авто']] }] },
	{ id: 'camTrack', group: 'Взаимодействие', name: 'Руки (камера)', icon: 'hand', hint: 'Камера видит руки и пальцы. Каждому жесту назначается своё действие: ладонь, кулак, щипок, указательный палец', max: 1.5, def: { on: false, amount: 1.0, band: 'none', react: 0, g_palm: 'push', g_fist: 'break', g_pinch: 'rotate', g_point: 'brush', g_peace: 'wave', g_rock: 'fx:glitch', g_thumb: 'gravity', power: 0.35, radius: 0.35, depth: 0.85, spin: 5, inertia: 0.6, axis: 'y', clay: 0.5, elastic: 0.6, stretch: 'off', keep: 'on', smooth: 0.5, sens: 0.6, hold: 0.12, skeleton: 'on', preview: 'on' }, extras: [{ type: 'preset' }, { type: 'title', label: 'Что делает жест' }, { key: 'g_palm', label: 'Ладонь (пальцы раскрыты)', type: 'select', options: FX_ACTIONS }, { key: 'g_fist', label: 'Кулак', type: 'select', options: FX_ACTIONS }, { key: 'g_pinch', label: 'Щипок (большой + указательный)', type: 'select', options: FX_ACTIONS }, { key: 'g_point', label: 'Указательный палец', type: 'select', options: FX_ACTIONS }, { key: 'g_peace', label: 'Два пальца (знак мира)', type: 'select', options: FX_ACTIONS }, { key: 'g_rock', label: 'Рога (указательный и мизинец)', type: 'select', options: FX_ACTIONS }, { key: 'g_thumb', label: 'Большой палец вверх', type: 'select', options: FX_ACTIONS }, { type: 'title', label: 'Касание пальцами' }, { key: 'power', label: 'Мощность', min: 0.05, max: 1.5, step: 0.05 }, { key: 'radius', label: 'Радиус', min: 0.02, max: 0.9, step: 0.01 }, { key: 'depth', label: 'Глубина касания', min: 0.1, max: 1.5, step: 0.05 }, { type: 'title', label: 'Вращение' }, { key: 'spin', label: 'Скорость', min: 1, max: 14, step: 0.5 }, { key: 'inertia', label: 'Инерция', min: 0, max: 0.98, step: 0.02 }, { key: 'axis', label: 'Оси', type: 'seg', options: [['y', 'Вокруг'], ['xy', 'Свободно']] }, { type: 'title', label: 'Лепка' }, { key: 'clay', label: 'Размер куска глины', min: 0.05, max: 1.2, step: 0.01 }, { key: 'elastic', label: 'Упругость (возврат формы)', min: 0, max: 3, step: 0.1 }, { type: 'title', label: 'Две руки' }, { key: 'stretch', label: 'Меняют размер формы', type: 'seg', options: [['off', 'Нет'], ['on', 'Да']] }, { key: 'keep', label: 'Запоминать размер', type: 'seg', options: [['on', 'Да'], ['off', 'Нет']] }, { type: 'title', label: 'Распознавание и показ' }, { key: 'smooth', label: 'Плавность', min: 0, max: 0.95, step: 0.05 }, { key: 'sens', label: 'Чувствительность', min: 0.1, max: 1, step: 0.05 }, { key: 'hold', label: 'Задержка жеста, с', min: 0, max: 0.5, step: 0.02 }, { key: 'skeleton', label: 'Руки на сцене', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'preview', label: 'Окно камеры', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }] },
	{ id: 'gravity', group: 'Взаимодействие', name: 'Гравитация', icon: 'planet', hint: 'Поле тяготения вокруг выбранной точки: точки кружат, падают в центр или парят. Центр можно водить курсором или рукой', max: 1.5, def: { on: false, amount: 1, band: 'bass', react: 0.4, mode: 'orbit', target: 'cursor', radius: 1.8, speed: 1, tilt: 0.5, precess: 0.15, flatten: 0.6, jet: 1.4, spread: 0.5 }, extras: [{ key: 'mode', label: 'Вид поля', type: 'select', options: [['orbit', 'Галактика: диск со спиральными рукавами'], ['hole', 'Квазар: падение в центр и джеты'], ['swarm', 'Рой: у каждой точки своя орбита'], ['float', 'Невесомость: медленный дрейф']] }, { type: 'note', when: ['mode', ['orbit']], text: 'Форма раскручивается диском: у центра быстрее, на краю медленнее.' }, { type: 'note', when: ['mode', ['hole']], text: 'Точки по спирали падают в центр, а затем вылетают двумя струями вдоль оси.' }, { type: 'note', when: ['mode', ['swarm']], text: 'Каждая точка летает по своей наклонной орбите, получается шар из орбит, как у атома.' }, { type: 'note', when: ['mode', ['float']], text: 'Точки плавно покачиваются и расходятся, как в невесомости.' }, { type: 'title', label: 'Где центр' }, { key: 'target', label: 'Центр поля', type: 'seg', options: [['cursor', 'Курсор, рука'], ['center', 'Центр формы']] }, { key: 'radius', label: 'Радиус действия', min: 0.1, max: 3.5, step: 0.05 }, { type: 'title', label: 'Движение' }, { key: 'speed', label: 'Скорость', min: 0.2, max: 3, step: 0.1 }, { key: 'spread', label: 'Размах', min: 0, max: 1, step: 0.05, when: ['mode', ['swarm', 'float']] }, { key: 'flatten', label: 'Сплющивание в диск', min: 0, max: 0.95, step: 0.05, when: ['mode', ['orbit', 'hole']] }, { key: 'tilt', label: 'Наклон диска', min: 0, max: 1.5, step: 0.05, when: ['mode', ['orbit', 'hole']] }, { key: 'precess', label: 'Покачивание оси', min: 0, max: 1, step: 0.05, when: ['mode', ['orbit', 'hole']] }, { key: 'jet', label: 'Длина струй', min: 0, max: 3, step: 0.1, when: ['mode', ['hole']] }] },
];

export const FX_PALETTES = [
	{ id: 'brand', name: 'Янтарь', c: ['#e58a45', '#f4b27a', '#fff0dc'] },
	{ id: 'cyber', name: 'Неон', c: ['#00f0ff', '#ff1fcb', '#ffd90f'] },
	{ id: 'plasma', name: 'Плазма', c: ['#1a2bff', '#ff4010', '#fff2cc'] },
	{ id: 'aurora', name: 'Аврора', c: ['#00f2a0', '#6d2bff', '#2bb3ff'] },
	{ id: 'ice', name: 'Лёд', c: ['#8fe3ff', '#3f7dff', '#ffffff'] },
	{ id: 'sunset', name: 'Закат', c: ['#ff3d6e', '#ff9a3d', '#ffe29a'] },
	{ id: 'mono', name: 'Моно', c: ['#6b7482', '#c9d0da', '#ffffff'] },
];

export const COLOR_BY = [
	{ id: 'disp', label: 'Смещение', title: 'Чем дальше точка улетела, тем ярче' },
	{ id: 'height', label: 'Высота', title: 'Градиент снизу вверх' },
	{ id: 'index', label: 'Разброс', title: 'Цвета перемешаны по точкам' },
	{ id: 'model', label: 'Текстура', title: 'Цвета из текстуры модели, как на вкладке «Точки»' },
	{ id: 'solid', label: 'Один цвет', title: 'Один цвет для всех точек' },
	{ id: 'normal', label: 'Нормали', title: 'Цвет по направлению поверхности' },
];

export const MASK_MODES = [
	{ id: 'none', label: 'Везде', title: 'Эффекты действуют на всю форму' },
	{ id: 'height', label: 'Высота', title: 'Живёт верхняя часть, нижняя стоит' },
	{ id: 'sphere', label: 'Сфера', title: 'Живёт область внутри шара' },
	{ id: 'noise', label: 'Пятна', title: 'Живут плавающие пятна' },
	{ id: 'scan', label: 'Скан', title: 'Живёт полоса, которая пробегает по форме' },
];

export const SYNTH_STYLES = [
	{ id: 'synthwave', name: 'Синтвейв, 124 BPM' },
	{ id: 'cyberpunk', name: 'Киберпанк, 138 BPM' },
	{ id: 'ambient', name: 'Эмбиент, 95 BPM' },
];

function defaultState() {
	const layers = {};
	for (const l of FX_LAYERS) layers[l.id] = { ...l.def };
	return {
		source: 'sphere',
		count: 150000,
		layers,
		media: { pts: 80000, relief: 'bright', depth: 0.5 },
		morphCfg: { mode: 'beat', interval: 4, time: 1.8, order: 'seq', weight: 'auto' },
		mask: { mode: 'none', size: 0.5, soft: 0.4, speed: 0.5, invert: false, show: false },
		look: {
			bg: '',
			vignette: true,
			palette: 'brand',
			colorBy: 'disp',
			size: 3.5,
			glow: 0.8,
			bright: 1,
			blend: 'normal',
			hud: false,
			hudSpectrum: true,
			autoRotate: true,
			rotSpeed: 0.25,
			sizeNoise: 0.0,
			sizeAudio: 0.0,
			bloom: 0.0,
			aberration: 0.0,
			dofOn: false,
			dofDist: 5.2,
			dofRange: 1.4,
		},
		audio: { style: 'synthwave', gain: 1.3, idle: true, volume: 0.8 },
	};
}

const KEY = 'objglb.fx.v5';

// ───────────────────────────────────────────────────────────── формы

function baseShape(type, count = 100000) {
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3).fill(1);

  if (type === 'sphere') {
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;
      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;
      pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;
      nor[i*3] = x; nor[i*3+1] = y; nor[i*3+2] = z;
    }
  } else if (type === 'torus') {
    const R = 1.0, r = 0.36;
    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * Math.PI * 2;
      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y = r * Math.sin(v);
      const z = (R + r * Math.cos(v)) * Math.sin(u);
      pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;
      const cx = R * Math.cos(u), cz = R * Math.sin(u);
      nor[i*3] = (x - cx) / r; nor[i*3+1] = y / r; nor[i*3+2] = (z - cz) / r;
    }
  } else if (type === 'cube') {
    const h = 0.65;
    for (let i = 0; i < count; i++) {
      const face = Math.floor(Math.random() * 6);
      const u = (Math.random() - 0.5) * h * 2;
      const v = (Math.random() - 0.5) * h * 2;
      switch (face) {
        case 0: pos[i*3]=h;  pos[i*3+1]=u; pos[i*3+2]=v; nor[i*3]=1;  break;
        case 1: pos[i*3]=-h; pos[i*3+1]=u; pos[i*3+2]=v; nor[i*3]=-1; break;
        case 2: pos[i*3]=u;  pos[i*3+1]=h; pos[i*3+2]=v; nor[i*3+1]=1;  break;
        case 3: pos[i*3]=u;  pos[i*3+1]=-h;pos[i*3+2]=v; nor[i*3+1]=-1; break;
        case 4: pos[i*3]=u;  pos[i*3+1]=v; pos[i*3+2]=h; nor[i*3+2]=1;  break;
        case 5: pos[i*3]=u;  pos[i*3+1]=v; pos[i*3+2]=-h;nor[i*3+2]=-1; break;
      }
    }
  } else if (type === 'helix') {
    const turns = 3.5, h = 1.6, r = 0.65;
    for (let i = 0; i < count; i++) {
      const strand = Math.random() < 0.45 ? 0 : Math.random() < 0.85 ? 1 : 2;
      const t = Math.random();
      const angle = t * Math.PI * 2 * turns;
      const y = (t - 0.5) * h;
      if (strand === 0) {
        pos[i*3] = Math.cos(angle) * r; pos[i*3+1] = y; pos[i*3+2] = Math.sin(angle) * r;
        nor[i*3] = Math.cos(angle); nor[i*3+2] = Math.sin(angle);
      } else if (strand === 1) {
        pos[i*3] = Math.cos(angle + Math.PI) * r; pos[i*3+1] = y; pos[i*3+2] = Math.sin(angle + Math.PI) * r;
        nor[i*3] = Math.cos(angle + Math.PI); nor[i*3+2] = Math.sin(angle + Math.PI);
      } else {
        const u = Math.random() * 2 - 1;
        pos[i*3] = Math.cos(angle) * r * u; pos[i*3+1] = y; pos[i*3+2] = Math.sin(angle) * r * u;
        nor[i*3+1] = 1;
      }
    }
  } else if (type === 'saturn') {
    for (let i = 0; i < count; i++) {
      if (Math.random() < 0.3) {
        const u = Math.random(), v = Math.random();
        const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
        const sr = 0.35;
        pos[i*3] = sr * Math.sin(phi) * Math.cos(theta);
        pos[i*3+1] = sr * Math.sin(phi) * Math.sin(theta);
        pos[i*3+2] = sr * Math.cos(phi);
        nor[i*3] = pos[i*3]/sr; nor[i*3+1] = pos[i*3+1]/sr; nor[i*3+2] = pos[i*3+2]/sr;
      } else {
        const rad = Math.sqrt(Math.random() * (1.4*1.4 - 0.5*0.5) + 0.5*0.5);
        const theta = Math.random() * Math.PI * 2;
        pos[i*3] = Math.cos(theta) * rad;
        pos[i*3+1] = (Math.random() - 0.5) * 0.04;
        pos[i*3+2] = Math.sin(theta) * rad;
        nor[i*3+1] = 1;
      }
    }
  }
  return { positions: pos, normals: nor, colors: col, count };
}



function extraShape(type, count) {
	const pos = new Float32Array(count * 3);
	const nor = new Float32Array(count * 3);
	const col = new Float32Array(count * 3).fill(1);
	if (type === 'galaxy') {
		const arms = 3;
		for (let i = 0; i < count; i++) {
			const r = Math.pow(Math.random(), 0.7) * 1.6;
			const arm = (i % arms) / arms;
			const a = arm * Math.PI * 2 + r * 2.6 + (Math.random() - 0.5) * 0.5 / (0.3 + r);
			const spread = (Math.random() - 0.5) * 0.18 * (0.4 + r);
			pos[i * 3] = Math.cos(a) * r + spread;
			pos[i * 3 + 1] = (Math.random() - 0.5) * 0.12 * (1.4 - r * 0.6);
			pos[i * 3 + 2] = Math.sin(a) * r + spread;
			nor[i * 3 + 1] = 1;
		}
	} else {
		for (let i = 0; i < count; i++) {
			pos[i * 3] = (Math.random() - 0.5) * 2.6;
			pos[i * 3 + 1] = 0;
			pos[i * 3 + 2] = (Math.random() - 0.5) * 2.6;
			nor[i * 3 + 1] = 1;
		}
	}
	return { positions: pos, normals: nor, colors: col, count };
}

export function generateShapePoints(type, count = 100000) {
	return type === 'galaxy' || type === 'plane' ? extraShape(type, count) : baseShape(type, count);
}

/** Растягивает или прореживает облако до ровно n точек */
function fitCount(c, n) {
	if (c.count === n) return c;
	const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) {
		const j = Math.min(c.count - 1, Math.floor((i * c.count) / n));
		for (let k = 0; k < 3; k++) {
			pos[i * 3 + k] = c.positions[j * 3 + k];
			nor[i * 3 + k] = c.normals[j * 3 + k];
			col[i * 3 + k] = c.colors[j * 3 + k] ?? 1;
		}
	}
	return { positions: pos, normals: nor, colors: col, count: n };
}

/** Приводит облако к единичному размеру и центру: все формы получаются сопоставимого масштаба */
function normalizeCloud(c) {
	const p = c.positions;
	let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
	for (let i = 0; i < p.length; i += 3) {
		if (p[i] < minx) minx = p[i]; if (p[i] > maxx) maxx = p[i];
		if (p[i + 1] < miny) miny = p[i + 1]; if (p[i + 1] > maxy) maxy = p[i + 1];
		if (p[i + 2] < minz) minz = p[i + 2]; if (p[i + 2] > maxz) maxz = p[i + 2];
	}
	const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
	const k = 2.2 / Math.max(maxx - minx, maxy - miny, maxz - minz, 1e-9);
	const out = new Float32Array(p.length);
	for (let i = 0; i < p.length; i += 3) {
		out[i] = (p[i] - cx) * k;
		out[i + 1] = (p[i + 1] - cy) * k;
		out[i + 2] = (p[i + 2] - cz) * k;
	}
	return { positions: out, normals: c.normals, colors: c.colors, count: c.count };
}

// ───────────────────────────────────────────────────────────── шейдеры

const common = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uTOff;
uniform float uMorph;
uniform float uBeat;
uniform vec2 uYR;
uniform vec3 uMouse;
uniform float uMouseOn;
uniform sampler2D uSpecTex;
uniform vec4 uCurl, uSpec, uWave, uTwist, uPulse, uVoxel, uJitter, uCursor, uMask, uMaskA, uGlitch, uContact, uShockP, uAlive;
uniform vec4 uTrk[16];
uniform vec4 uHand[12];
uniform vec4 uGrav;
uniform vec4 uSlice;
uniform vec4 uSliceM;
uniform vec4 uMark;
uniform vec4 uGravT;
uniform vec4 uPhysP;
uniform float uAsm;
uniform vec4 uDis;
uniform float uDisT;
uniform vec4 uGravP;
uniform vec4 uHandP;
uniform vec4 uImp[32];
uniform vec4 uShock[4];
uniform vec4 uPhysics;
uniform float uCollapseTime;
uniform vec4 uBrushHits[20];
uniform vec4 uBrushParam;
uniform vec4 uLookP2;
uniform vec4 uDof;
#define PI 3.1415926535

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
	const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
	const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
	vec3 i = floor(v + dot(v, C.yyy));
	vec3 x0 = v - i + dot(i, C.xxx);
	vec3 g = step(x0.yzx, x0.xyz);
	vec3 l = 1.0 - g;
	vec3 i1 = min(g.xyz, l.zxy);
	vec3 i2 = max(g.xyz, l.zxy);
	vec3 x1 = x0 - i1 + C.xxx;
	vec3 x2 = x0 - i2 + C.yyy;
	vec3 x3 = x0 - D.yyy;
	i = mod289(i);
	vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
	float n_ = 0.142857142857;
	vec3 ns = n_ * D.wyz - D.xzx;
	vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
	vec4 x_ = floor(j * ns.z);
	vec4 y_ = floor(j - 7.0 * x_);
	vec4 x = x_ * ns.x + ns.yyyy;
	vec4 y = y_ * ns.x + ns.yyyy;
	vec4 h = 1.0 - abs(x) - abs(y);
	vec4 b0 = vec4(x.xy, y.xy);
	vec4 b1 = vec4(x.zw, y.zw);
	vec4 s0 = floor(b0) * 2.0 + 1.0;
	vec4 s1 = floor(b1) * 2.0 + 1.0;
	vec4 sh = -step(h, vec4(0.0));
	vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
	vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
	vec3 p0 = vec3(a0.xy, h.x);
	vec3 p1 = vec3(a0.zw, h.y);
	vec3 p2 = vec3(a1.xy, h.z);
	vec3 p3 = vec3(a1.zw, h.w);
	vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
	p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
	vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
	m = m * m;
	return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// ротор поля шума: течение без сжатия, как дым
vec3 curlNoise(vec3 p) {
	const float e = 0.08;
	float n1 = snoise(p + vec3(e, 0.0, 0.0));
	float n2 = snoise(p - vec3(e, 0.0, 0.0));
	float n3 = snoise(p + vec3(0.0, e, 0.0));
	float n4 = snoise(p - vec3(0.0, e, 0.0));
	float n5 = snoise(p + vec3(0.0, 0.0, e));
	float n6 = snoise(p - vec3(0.0, 0.0, e));
	return normalize(vec3((n4 - n3) - (n6 - n5), (n6 - n5) - (n2 - n1), (n2 - n1) - (n4 - n3)) + 1e-5);
}
float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

// одно касание: подъём, вихрь или втягивание вокруг точки c с силой st
void contactAt(vec3 c, float st, vec3 base, vec3 rad, inout vec3 pos) {
	vec3 dd = base - c;
	float r = uContact.y;
	float d2 = dot(dd, dd);
	if (d2 >= r * r || st < 0.001) return;
	float f = 1.0 - sqrt(d2) / r;
	f = f * f * (3.0 - 2.0 * f);
	float k = f * st * uContact.x;
	if (uContact.z < 0.5) {
		pos += rad * k * 0.4;
	} else if (uContact.z < 1.5) {
		vec3 ax = normalize(c + vec3(1e-4));
		float a = k * 2.4;
		vec3 q = pos - c;
		pos = c + q * cos(a) + cross(ax, q) * sin(a) + ax * dot(ax, q) * (1.0 - cos(a));
	} else if (uContact.z < 2.5) {
		pos -= normalize(dd + vec3(1e-4)) * k * 0.3;
	} else if (uContact.z < 3.5) {
		pos += normalize(dd + vec3(1e-4)) * k * 0.3;
	} else if (uContact.z < 4.5) {
		pos += rad * sin(length(dd) * 20.0 - uTime * 6.0) * k * 0.14;
	} else if (uContact.z < 5.5) {
		float hh = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
		pos.y -= k * k * 0.55 * (0.6 + 0.8 * hh);
		pos.xz += (hh - 0.5) * k * 0.06;
	} else if (uContact.z < 6.5) {
		pos += curlNoise(base * 3.0 + uTime * 0.8) * k * 0.45;
	}
}

// сила касания в точке (для режима «Исчезновение»): ближайшие рамки и их следы
float contactK(vec3 b) {
	float m = 0.0;
	float r = uContact.y * (1.0 + 0.12 * sin(uTime * 4.0));
	for (int i = 0; i < 16; i++) {
		if (float(i) >= uContact.w) break;
		float d = distance(b, uTrk[i].xyz);
		if (d < r) m = max(m, (1.0 - d / r) * uTrk[i].w);
	}
	for (int i = 0; i < 32; i++) {
		if (float(i) >= uShockP.z) break;
		float d = distance(b, uImp[i].xyz);
		if (d < r) m = max(m, (1.0 - d / r) * uImp[i].w);
	}
	return clamp(m * uContact.x, 0.0, 1.0);
}

// область рамок трекинга: 0 вне, 1 в центре
float markK(vec3 b) {
	if (uMark.x < 0.5 || uContact.w < 0.5) return 0.0;
	float m = 0.0;
	for (int i = 0; i < 16; i++) {
		if (float(i) >= uContact.w) break;
		float d = distance(b, uTrk[i].xyz);
		if (d < uMark.y) m = max(m, 1.0 - d / uMark.y);
	}
	return m * m * (3.0 - 2.0 * m) * uMark.z;
}

vec3 hueRot(vec3 c, float a) {
	vec3 k = vec3(0.57735);
	return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

// Срез: интенсивность линии в точке (для рельефа)
float sliceK(vec3 b) {
	if (uSlice.x < 0.001) return 0.0;
	float axCode = mod(uSlice.w, 10.0);
	float nLines = max(1.0, floor(uSlice.w / 10.0));
	float c = axCode < 0.5 ? b.y : (axCode < 1.5 ? b.x : (axCode < 2.5 ? b.z : (b.x + b.y) * 0.707));
	float v = clamp((c + 1.2) / 2.4, 0.0, 1.0);
	float coord = mod(v * nLines - uSlice.y * nLines, 1.0);
	return (1.0 - smoothstep(uSlice.z * 0.4, uSlice.z, abs(coord - 0.5))) * uSlice.x;
}

// Растворение: 0 цела, 1 унесена. Порядок отрыва зависит от режима
float disK(vec3 b, float idx) {
	if (uDis.x < 0.001) return 0.0;
	float y01 = clamp((b.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	float h = hash11(idx * 37.3);
	float ord;
	if (uDis.y < 0.5) ord = (1.0 - y01) * 0.72 + h * 0.28;
	else if (uDis.y < 1.5) ord = (snoise(b * 1.7) * 0.5 + 0.5) * 0.75 + h * 0.25;
	else ord = y01 * 0.72 + h * 0.28;
	return clamp((uDis.x * 1.4 - ord) / 0.32, 0.0, 1.0);
}

// Положение одной точки после всех эффектов. base: форма без эффектов, maskV: доля эффектов в этой точке (зона)
vec3 fxDisplace(vec3 aOrigin, vec3 aTarget, float aIdx, out vec3 base, out float maskV) {
	float t = uTime - uTOff;
	float m = uMorph * uMorph * (3.0 - 2.0 * uMorph);
	base = mix(aOrigin, aTarget, m);
	float turb = sin(m * PI) * 0.5;
	if (turb > 0.001) base += curlNoise(base * 2.5 + t * 0.8) * turb;
	vec3 rad = normalize(base + vec3(1e-4));
	vec3 pos = base;

	if (uTwist.x > 0.001) {
		float a = pos.y * uTwist.x * 1.6;
		float c = cos(a);
		float s = sin(a);
		pos.xz = mat2(c, -s, s, c) * pos.xz;
	}
	if (uWave.x > 0.001) pos += rad * sin(length(base) * uWave.y * 2.0 - t * 3.0) * uWave.x * 0.14;
	if (uSpec.x > 0.001) {
		float u = uSpec.y < 0.5 ? abs(atan(base.z, base.x)) / PI : clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		pos += rad * texture2D(uSpecTex, vec2(u, 0.5)).r * uSpec.x * 0.7;
	}
	pos += rad * uPulse.x * 0.28;
	pos *= 1.0 + uPulse.x * 0.1;
	if (uAlive.x > 0.001) {
		float y01a = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float br = sin(t * uAlive.y * 1.6);
		pos *= 1.0 + br * 0.03 * uAlive.x;
		pos.y += br * 0.05 * uAlive.x * (y01a - 0.5);
		pos *= 1.0 + uAlive.w * 0.07;
		if (uMouseOn > 0.5 && uAlive.z > 0.001) {
			vec3 dm = uMouse - pos;
			float fm = exp(-dot(dm, dm) * 0.7);
			pos += dm * fm * 0.28 * uAlive.z * uAlive.x;
		}
	}
	if (uMark.x > 3.5 && uMark.x < 5.5) {
		float mkd = markK(base);
		if (uMark.x < 4.5) pos += rad * mkd * 0.22;
		else pos = mix(pos, (floor(pos / 0.06) + 0.5) * 0.06, smoothstep(0.0, 0.4, mkd));
	}
	if (uSliceM.x > 0.5 && uSliceM.x < 1.5) pos += rad * sliceK(base) * uSliceM.y;
	float dk = disK(base, aIdx);
	if (dk > 0.0) {
		pos += curlNoise(base * 1.8 + vec3(0.0, -t * 0.6, t * 0.3)) * dk * uDisT * 0.9;
		pos.y -= dk * dk * uDis.z * 1.5;
		pos.x += dk * uDis.w * 1.1;
	}
	if (uGrav.x > 0.001) {
		vec3 gq = pos - uGravP.xyz;
		float gr = length(gq) + 1e-3;
		float gin = 1.0 - smoothstep(uGravP.w * 0.7, uGravP.w * 1.7, gr);
		float ga = min(uGrav.x * gin, 1.0);
		// ось диска: наклонена и медленно покачивается
		vec3 up = normalize(vec3(sin(uGravT.x) * cos(uGravT.y), cos(uGravT.x), sin(uGravT.x) * sin(uGravT.y)));
		vec3 ref = abs(up.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
		vec3 e1 = normalize(cross(ref, up));
		vec3 e2 = cross(up, e1);
		float lx = dot(gq, e1);
		float lh = dot(gq, up);
		float lz = dot(gq, e2);
		if (uGrav.y < 0.5) {
			// галактика: у центра крутится быстрее, закручиваясь в рукава; диск слегка коробится
			float om = uGrav.z * 1.15 / (0.45 + gr * 0.9);
			float ang = om * t * ga;
			float ca = cos(ang);
			float sa = sin(ang);
			float nx = lx * ca - lz * sa;
			float nz = lx * sa + lz * ca;
			float az = atan(nz, nx);
			lh = lh * (1.0 - uGrav.w * ga) + 0.07 * gr * sin(az * 2.0 + t * 0.4) * ga;
			// спиральные рукава: плотность волной уходит от центра к краю
			float arm = sin(2.0 * az - 3.4 * log(gr + 0.15) + t * 0.25);
			float ar = 1.0 + 0.3 * arm * ga * uGrav.w;
			lx = nx * ar;
			lz = nz * ar;
		} else if (uGrav.y < 1.5) {
			// квазар: падение по спирали, сплющивание в диск, затем выброс вдоль оси двумя джетами
			float h1 = hash11(aIdx * 91.7);
			float ph = fract(t * 0.16 * uGrav.z + h1);
			float sg = h1 > 0.5 ? 1.0 : -1.0;
			float r0 = max(gr, 0.08);
			if (ph < 0.8 || uGravT.w < 0.01) {
				float s = clamp(ph / 0.8, 0.0, 1.0);
				float rr = r0 * pow(1.0 - s, 1.6) + 0.03;
				float ang = s * s * 11.0 * ga;
				float az0 = atan(lz, lx);
				float flt = 1.0 - uGrav.w * s * ga;
				float ha = lh * flt;
				float k = mix(1.0, rr / r0, ga);
				float rl = length(vec2(lx, lz)) * k;
				lx = cos(az0 + ang) * rl;
				lz = sin(az0 + ang) * rl;
				lh = ha * mix(1.0, rr / r0, ga);
			} else {
				float u = (ph - 0.8) / 0.2;
				float len = uGravT.w * (0.4 + h1 * 0.9) * u * u * ga;
				float az0 = atan(lz, lx) + t * 2.0;
				lx = cos(az0) * 0.05 * (1.0 - u * 0.5);
				lz = sin(az0) * 0.05 * (1.0 - u * 0.5);
				lh = sg * (0.08 + len);
			}
		} else if (uGrav.y > 2.5) {
			// рой: каждая точка вращается вокруг центра по своей наклонной орбите
			vec3 q = e1 * lx + up * lh + e2 * lz;
			vec3 ax = normalize(vec3(hash11(aIdx * 13.1) - 0.5, hash11(aIdx * 7.7) - 0.5, hash11(aIdx * 3.3) - 0.5) + vec3(1e-3));
			float ang = t * uGrav.z * (0.7 + 1.6 / (gr + 0.3)) * ga * (0.6 + 0.8 * hash11(aIdx * 5.9));
			q = q * cos(ang) + cross(ax, q) * sin(ang) + ax * dot(ax, q) * (1.0 - cos(ang));
			q *= 1.0 + uGravT.z * 0.3 * ga * sin(t * 0.8 + aIdx * 40.0);
			lx = dot(q, e1);
			lh = dot(q, up);
			lz = dot(q, e2);
		} else {
			// невесомость: медленное вращение, покачивание в трёх осях и мягкое «дыхание» облака
			float sd = aIdx * 61.0;
			float ang = 0.14 * uGrav.z * t * ga;
			float ca = cos(ang);
			float sa = sin(ang);
			float nx = lx * ca - lz * sa;
			float nz = lx * sa + lz * ca;
			float amp = 0.4 + uGravT.z * 1.2;
			lx = nx + ga * 0.12 * amp * sin(t * 0.55 * uGrav.z + sd * 1.3);
			lz = nz + ga * 0.12 * amp * cos(t * 0.5 * uGrav.z + sd * 0.8);
			lh += ga * 0.2 * amp * sin(t * 0.7 * uGrav.z + sd);
			float br = 1.0 + 0.2 * amp * ga * (0.5 + 0.5 * sin(t * 0.35 * uGrav.z + sd * 0.4));
			lx *= br;
			lz *= br;
			lh *= br;
		}
		pos = uGravP.xyz + e1 * lx + up * lh + e2 * lz;
	}
	if (uCurl.x > 0.001) {
		float thr = snoise(base * 1.8 + t * 0.3) * 0.5 + 0.5;
		float det = smoothstep(0.35, 0.85, thr + uCurl.x * 0.12);
		pos += curlNoise(base * uCurl.y + vec3(t * 0.4, t * 0.3, t * 0.5)) * det * uCurl.x * 0.8;
	}
	if (uGlitch.x > 0.001) {
		float yg = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float band = floor(yg * uGlitch.y);
		float r = hash11(band * 13.7 + floor(t * 10.0));
		if (r > 0.7) pos.x += (r - 0.7) * 3.3 * (hash11(band + 7.0) - 0.5) * uGlitch.x * 0.9;
	}
	if (uVoxel.x > 0.01) {
		float g = mix(0.3, 0.035, clamp(uVoxel.x, 0.0, 1.0));
		pos = mix(pos, (floor(pos / g) + 0.5) * g, smoothstep(0.0, 0.25, uVoxel.x));
	}
	if (uJitter.x > 0.001) {
		pos += vec3(sin(t * 17.0 + aIdx * 91.0), sin(t * 13.0 + aIdx * 57.0), sin(t * 11.0 + aIdx * 33.0)) * uJitter.x * 0.03;
	}
	maskV = 1.0;
	if (uMask.x > 0.5) {
		float y01 = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float soft = max(uMask.z, 0.02);
		if (uMask.x < 1.5) {
			maskV = smoothstep(uMaskA.x - soft * 0.5, uMaskA.x + soft * 0.5, y01);
		} else if (uMask.x < 2.5) {
			float r = uMask.y * 1.6 + 0.01;
			maskV = 1.0 - smoothstep(r * (1.0 - soft), r, distance(base, uMaskA.xyz));
		} else if (uMask.x < 3.5) {
			float n = snoise(base * 1.6 + vec3(0.0, uMaskA.w, uMaskA.w * 0.6)) * 0.5 + 0.5;
			maskV = smoothstep(1.0 - uMask.y - soft * 0.3, 1.0 - uMask.y + soft * 0.3, n);
		} else {
			float w = uMask.y * 0.35 + 0.004;
			maskV = 1.0 - smoothstep(w, w + soft * 0.3 + 0.02, abs(y01 - uMaskA.x));
		}
		if (uMask.w > 0.5) maskV = 1.0 - maskV;
	}
	pos = mix(base, pos, maskV);
	if (uContact.x > 0.001) {
		for (int i = 0; i < 16; i++) {
			if (float(i) >= uContact.w) break;
			contactAt(uTrk[i].xyz, uTrk[i].w, base, rad, pos);
		}
		for (int i = 0; i < 32; i++) {
			if (float(i) >= uShockP.z) break;
			contactAt(uImp[i].xyz, uImp[i].w, base, rad, pos);
		}
	}
	if (uShockP.x > 0.001) {
		for (int i = 0; i < 4; i++) {
			float age = uShock[i].w;
			if (age < 0.0) continue;
			float dist = distance(base, uShock[i].xyz);
			float x = (dist - age * uShockP.y) / 0.22;
			pos += rad * exp(-x * x) * exp(-age * 0.9) * uShockP.x * 0.45;
		}
	}
	// Кисть: рисование курсором
	if (uBrushParam.x > 0.001) {
		for (int i = 0; i < 20; i++) {
			float age = uBrushHits[i].w;
			if (age < 0.0) continue;
			float dist = distance(base, uBrushHits[i].xyz);
			float r = uBrushParam.y;
			if (dist < r) {
				float life = 1.0 - age / uBrushParam.z;
				float infl = (1.0 - dist / r) * life * uBrushParam.x;
				pos += rad * infl * 0.35;
			}
		}
	}
	// Распад: раскол сверху вниз, взрыв с закруткой, отскоки от пола; сборка дугами снизу вверх
	if (uPhysics.x > 0.001) {
		float seed = hash11(aIdx * 1234.56 + 17.1);
		float seed2 = hash11(aIdx * 2345.67 + 39.3);
		float seed3 = hash11(aIdx * 3456.78 + 81.7);
		float yP = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float onset = (1.0 - yP) * uPhysP.y * 1.3 + seed * 0.3;
		float pt = max(0.0, uCollapseTime - onset);
		vec3 radd = normalize(base + vec3(1e-3));
		vec3 tang = normalize(vec3(-base.z, 0.0, base.x) + vec3(1e-3, 0.0, 0.0));
		vec3 v0 = (radd * (0.5 + seed * 1.1) + tang * uPhysP.z * (0.3 + seed3 * 0.9)) * uPhysP.x;
		float vy0 = (0.5 + seed2 * 1.0) * uPhysP.x;
		float g = uPhysics.y * 3.8;
		float floorY = uYR.x - 0.04;
		float drag = 1.0 - exp(-pt * 1.5);
		vec3 pPhys = base;
		pPhys.x += v0.x * drag / 1.5 + uPhysics.w * 0.5 * drag;
		pPhys.z += v0.z * drag / 1.5;
		float h0 = max(base.y - floorY, 0.0);
		float vimp = sqrt(vy0 * vy0 + 2.0 * g * h0);
		float t1 = (vy0 + vimp) / g;
		float yy;
		if (pt < t1) {
			yy = base.y + vy0 * pt - 0.5 * g * pt * pt;
		} else {
			float tt = pt - t1;
			float vy = vimp * uPhysics.z;
			float hh = 0.0;
			for (int b = 0; b < 4; b++) {
				float T = 2.0 * vy / g;
				if (tt < T) {
					hh = vy * tt - 0.5 * g * tt * tt;
					break;
				}
				tt -= T;
				vy *= uPhysics.z;
			}
			yy = floorY + max(hh, 0.0);
		}
		pPhys.y = max(yy, floorY);
		// вращение осколков вокруг вертикали, пока летят
		float spinA = (1.0 - exp(-pt * 1.2)) * uPhysP.z * (seed2 - 0.5) * 2.0;
		vec2 sq = pPhys.xz;
		float cs = cos(spinA);
		float sn = sin(spinA);
		pPhys.xz = vec2(sq.x * cs - sq.y * sn, sq.x * sn + sq.y * cs);
		float strength = min(1.0, uPhysics.x);
		vec3 target = mix(pos, pPhys, strength);
		if (uAsm > 0.0) {
			float s0 = yP * 0.42 + seed * 0.2;
			float sA = clamp((uAsm * 1.4 - s0) / 0.55, 0.0, 1.0);
			float eA = sA * sA * (3.0 - 2.0 * sA);
			vec3 side = normalize(cross(pPhys - pos, vec3(0.0, 1.0, 0.0)) + vec3(1e-3));
			target = mix(target, pos, eA);
			target += side * sin(eA * 3.14159) * 0.45 * (seed3 - 0.3);
			target.y += sin(eA * 3.14159) * 0.5 * (0.4 + seed);
		}
		pos = target;
	}
	if (uHandP.x > 0.001) {
		for (int i = 0; i < 12; i++) {
			if (float(i) >= uHandP.w) break;
			vec3 hd = pos - uHand[i].xyz;
			float r = uHandP.y;
			float d2 = dot(hd, hd);
			if (d2 < r * r) {
				float f = 1.0 - sqrt(d2) / r;
				f = f * f * (3.0 - 2.0 * f);
				float hs = uHand[i].w;
				if (hs > 1.5) {
					hs -= 2.0;
					float a = f * hs * uHandP.x * 2.6;
					float ca = cos(a);
					float sa = sin(a);
					vec2 q = pos.xz - uHand[i].xz;
					pos.xz = uHand[i].xz + vec2(q.x * ca - q.y * sa, q.x * sa + q.y * ca);
					pos.y += f * hs * uHandP.x * 0.12;
				} else {
					pos += normalize(hd + vec3(1e-3)) * f * hs * uHandP.x * 0.75;
				}
			}
		}
	}
	if (uMouseOn > 0.5 && uCursor.x > 0.001) {
		vec3 tm = pos - uMouse;
		float r2 = uCursor.y * uCursor.y;
		float d2 = dot(tm, tm);
		if (d2 < r2) {
			float f = 1.0 - d2 / r2;
			pos += normalize(tm + vec3(1e-3)) * f * f * uCursor.x * 0.6 * uCursor.z;
		}
	}
	return pos;
}
`;

const vert = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aTarget;
attribute vec3 aColor;
attribute float aIdx;
attribute vec3 aSculpt;
attribute vec3 aNormal;
attribute vec2 aVis;
uniform vec3 uSolid;
uniform float uAtt;
uniform float uSize;
uniform float uPR;
uniform float uColorBy;
uniform float uBright;
uniform float uMaskShow;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform vec3 uSliceC;
uniform vec3 uMarkC;
varying vec3 vColor;
varying float vD;
varying float vCoc;
` + common + `
void main() {
	vec3 base;
	float maskV;
	vec3 pos = fxDisplace(aOrigin, aTarget, aIdx, base, maskV);
	pos += aSculpt;
	float dkv = disK(base, aIdx);
	float t = uTime - uTOff;
	float disp = clamp(length(pos - base) * 1.5, 0.0, 1.0);
	float k;
	if (uColorBy < 0.5) k = clamp(disp + uBeat * 0.12, 0.0, 1.0);
	else if (uColorBy < 1.5) k = clamp((pos.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	else k = fract(aIdx * 3.0 + t * 0.03);
	vec3 col = k < 0.5 ? mix(uP0, uP1, k * 2.0) : mix(uP1, uP2, (k - 0.5) * 2.0);
	if (uColorBy > 2.5 && uColorBy < 3.5) col = aColor;
	else if (uColorBy > 3.5 && uColorBy < 4.5) col = uSolid;
	else if (uColorBy > 4.5) {
		vec3 wn = mat3(modelMatrix) * aNormal;
		wn = length(wn) > 0.0 ? normalize(wn) : vec3(0.0, 1.0, 0.0);
		col = pow(wn * 0.5 + 0.5, vec3(2.2));
	}
	// видимость точки при морфинге между моделями с разным числом точек: лишние плавно гаснут, недостающие проявляются
	float vm = uMorph * uMorph * (3.0 - 2.0 * uMorph);
	float vis = mix(aVis.x, aVis.y, vm);
	vColor = col * uBright * (1.0 + uBeat * 0.3) * (1.0 - dkv) * vis;
	if (uMask.x > 0.5 && uMaskShow > 0.5) vColor = mix(vColor, uP2 * 1.4, maskV * 0.55);

	// Кисть: свечение в следе мазка
	if (uBrushParam.x > 0.001) {
		float bGlow = 0.0;
		for (int i = 0; i < 20; i++) {
			float age = uBrushHits[i].w;
			if (age < 0.0) continue;
			float dist = distance(base, uBrushHits[i].xyz);
			if (dist < uBrushParam.y) {
				float life = 1.0 - age / uBrushParam.z;
				bGlow = max(bGlow, (1.0 - dist / uBrushParam.y) * life);
			}
		}
		if (bGlow > 0.001) vColor += uP2 * bGlow * 2.2 * uBrushParam.x;
	}

	// Руки: подсветка точек возле кончиков пальцев
	if (uHandP.x > 0.001) {
		float hg = 0.0;
		for (int i = 0; i < 12; i++) {
			if (float(i) >= uHandP.w) break;
			float hdst = distance(pos, uHand[i].xyz);
			if (hdst < uHandP.y) hg = max(hg, (1.0 - hdst / uHandP.y) * (uHand[i].w > 1.5 ? uHand[i].w - 2.0 : abs(uHand[i].w)));
		}
		vColor += uP2 * hg * hg * 1.6 * uHandP.x;
	}

	// Область трекинга: негатив, радуга, дыра, лупа, пиксели или свет вокруг рамок
	float mkv = markK(base);
	if (mkv > 0.0) {
		if (uMark.x < 1.5) vColor = mix(vColor, (vec3(1.0) - min(vColor, vec3(1.0))) * 1.3, mkv);
		else if (uMark.x < 2.5) vColor = mix(vColor, hueRot(vColor, uTime * 2.0 + length(base) * 6.0) * 1.15, mkv);
		else if (uMark.x < 3.5) {
			float edge = smoothstep(0.0, 0.35, mkv) * (1.0 - smoothstep(0.35, 0.9, mkv));
			vColor = vColor * (1.0 - smoothstep(0.35, 0.9, mkv)) + uMarkC * edge * 2.0;
		} else if (uMark.x < 4.5) vColor *= 1.0 + mkv * 0.8;
		else if (uMark.x > 5.5) vColor += uMarkC * mkv * 1.8;
	}
	// Исчезновение точек в местах касания, с пульсирующим краем
	float cvan = 0.0;
	if (uContact.z > 6.5 && uContact.x > 0.001) {
		cvan = contactK(base);
		float rim = smoothstep(0.05, 0.35, cvan) * (1.0 - smoothstep(0.35, 0.8, cvan));
		vColor = vColor * (1.0 - smoothstep(0.3, 0.8, cvan)) + uP2 * rim * 1.6;
	}

	// Срез / Изолинии: лазеры, рельеф на линиях или развёртка за бегущей плоскостью
	float sl = 0.0;
	if (uSlice.x > 0.001) {
		float axCode = mod(uSlice.w, 10.0);
		float nLines = max(1.0, floor(uSlice.w / 10.0));
		float c = axCode < 0.5 ? base.y : (axCode < 1.5 ? base.x : (axCode < 2.5 ? base.z : (base.x + base.y) * 0.707));
		float v = clamp((c + 1.2) / 2.4, 0.0, 1.0);
		if (uSliceM.x > 1.5) {
			float d = uSlice.y - v;
			sl = (1.0 - smoothstep(0.0, uSlice.z * 0.3 + 0.012, abs(d))) * uSlice.x;
			vColor *= mix(1.0, smoothstep(-0.012, 0.012, d), min(uSlice.x, 1.0));
			vColor += uSliceC * sl * 2.4;
		} else {
			float coord = mod(v * nLines - uSlice.y * nLines, 1.0);
			sl = (1.0 - smoothstep(uSlice.z * 0.4, uSlice.z, abs(coord - 0.5))) * uSlice.x;
			vColor += uSliceC * sl * 2.2;
		}
	}
	vD = disp;
	vec4 mv = modelViewMatrix * vec4(pos, 1.0);
	gl_Position = projectionMatrix * mv;

	// Масштаб по шуму и спектру (Scale POP)
	float szNoise = 1.0;
	if (uLookP2.x > 0.001) {
		szNoise = 1.0 + uLookP2.x * (snoise(base * 2.2 + uTime * 0.4) * 0.75);
	}
	float szAudio = 1.0;
	if (uLookP2.y > 0.001) {
		float bandAudio = mix(uBeat, uSpec.x, step(0.0, base.y));
		szAudio = 1.0 + uLookP2.y * (bandAudio * 1.2 * (0.6 + 0.4 * sin(aIdx * 62.8)));
	}

	// Глубина резкости (Depth of Field: CoC)
	float coc = 0.0;
	if (uDof.x > 0.5) {
		float viewDist = -mv.z;
		coc = clamp(abs(viewDist - uDof.y) / max(0.05, uDof.z), 0.0, 1.0);
	}
	vCoc = coc;

	float s = uSize * uPR * (1.0 + disp * 0.5 + uBeat * 0.2 + sl * 1.2);
	s *= max(0.15, szNoise * szAudio) * (1.0 - 0.7 * dkv) * (1.0 + (uMark.x > 3.5 && uMark.x < 4.5 ? mkv * 0.9 : 0.0)) * (1.0 - 0.6 * (uMark.x > 2.5 && uMark.x < 3.5 ? smoothstep(0.35, 0.9, mkv) : 0.0)) * (1.0 - 0.7 * smoothstep(0.3, 0.8, cvan)) * (0.25 + 0.75 * vis);
	s *= (1.0 + coc * 2.4);
	s *= uAtt > 0.5 ? 3.8 / max(-mv.z, 0.4) : 0.73;
	gl_PointSize = clamp(s, 1.0, 95.0);
}
`;

const frag = /* glsl */ `
precision highp float;
uniform float uGlow;
uniform float uAdd;
uniform float uDens;
uniform float uGhost;
uniform float uShape;
varying vec3 vColor;
varying float vD;
varying float vCoc;
void main() {
	vec2 c = gl_PointCoord - 0.5;
	// форма точки как на вкладке «Точки»: 0 квадрат, 1 круг, 2 шар, 3 кольцо, 4 ромб, 5 плюс
	float dm = length(c);
	if (uShape < 0.5) dm = max(abs(c.x), abs(c.y));
	else if (uShape > 3.5 && uShape < 4.5) dm = abs(c.x) + abs(c.y);
	if (dm > 0.5) discard;
	if (uShape > 2.5 && uShape < 3.5 && dm < 0.29) discard;
	if (uShape > 4.5 && min(abs(c.x), abs(c.y)) > 0.16) discard;
	float r2 = dm * dm;
	float core = 1.0 - smoothstep(0.0, 0.25, r2);
	if (uShape > 2.5 && uShape < 3.5) core = 1.0 - smoothstep(0.0, 0.1, abs(dm - 0.4));
	float sph = 1.0;
	if (uShape > 1.5 && uShape < 2.5) {
		vec3 n = vec3(c.x * 2.0, -c.y * 2.0, sqrt(max(0.0, 1.0 - 4.0 * r2)));
		sph = 0.4 + 0.75 * max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
	}
	if (vCoc > 0.01) {
		float bokeh = 1.0 - smoothstep(0.16, 0.25, r2);
		core = mix(core, bokeh, vCoc * 0.8);
	}
	float dofAlpha = 1.0 / (1.0 + vCoc * 1.8);
	if (uAdd > 0.5) {
		float aura = pow(core, mix(1.8, 0.7, uGlow));
		vec3 col = (vColor * (0.08 + aura * (0.2 + uGlow * 0.28)) + vColor * vD * 0.08) * uDens * uGhost * dofAlpha * sph;
		gl_FragColor = vec4(col, core * uGhost * dofAlpha);
	} else {
		gl_FragColor = vec4(vColor * (0.55 + 0.45 * core) * sph, dofAlpha);
	}
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

// Связи: каждая линия соединяет две точки облака, обе двигаются теми же эффектами, плюс импульсы
const lineVert = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aTarget;
attribute float aIdx;
attribute vec3 aOriginB;
attribute vec3 aTargetB;
attribute float aIdxB;
attribute float aEnd;
attribute float aSide;
uniform vec3 uP0;
uniform vec3 uP2;
uniform float uBright;
uniform vec4 uLink;
uniform vec2 uRes;
uniform float uLinkW;
varying vec3 vC;
varying float vA;
varying float vEnd;
varying float vIdx;
varying float vSide;
` + common + `
void main() {
	vec3 bA, bB;
	float mA, mB;
	vec3 pA = fxDisplace(aOrigin, aTarget, aIdx, bA, mA);
	vec3 pB = fxDisplace(aOriginB, aTargetB, aIdxB, bB, mB);
	float len = distance(pA, pB);
	vA = uLink.x * (1.0 - smoothstep(uLink.y * 0.8, uLink.y * 1.9, len));
	vC = mix(uP0, uP2, 0.35 + uBeat * 0.4) * uBright;
	vEnd = aEnd;
	vIdx = aIdx;
	vSide = aSide;
	mat4 mvp = projectionMatrix * modelViewMatrix;
	vec4 cA = mvp * vec4(pA, 1.0);
	vec4 cB = mvp * vec4(pB, 1.0);
	vec2 sA = cA.xy / cA.w;
	vec2 sB = cB.xy / cB.w;
	vec2 dir = (sB - sA) * vec2(uRes.x / uRes.y, 1.0);
	float dl = length(dir);
	dir = dl > 1e-5 ? dir / dl : vec2(1.0, 0.0);
	vec2 nrm = vec2(-dir.y, dir.x) * vec2(uRes.y / uRes.x, 1.0);
	vec4 c = mix(cA, cB, aEnd);
	c.xy += nrm * aSide * (uLinkW + 1.0) / uRes.y * c.w;
	gl_Position = c;
}
`;

const lineFrag = /* glsl */ `
precision highp float;
uniform vec4 uLink;
uniform float uTime;
varying vec3 vC;
varying float vA;
varying float vEnd;
varying float vIdx;
varying float vSide;
void main() {
	float pulseA = 1.0;
	float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
	vec3 col = vC;
	if (uLink.w > 0.5) {
		float p = sin(vEnd * 16.0 - uTime * uLink.z * 3.5 + vIdx * 24.0);
		float spark = smoothstep(0.45, 0.98, p) * 2.8;
		pulseA = 0.5 + spark;
		col += col * spark * 1.5;
	}
	gl_FragColor = vec4(col * (vA * pulseA * edge), vA * pulseA * edge);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

// ───────────────────────────────────────────────────────────── звуковой синтезатор

// ── Встроенный синтезатор музыки ─────────────────────────────────────────────

class TouchSynth {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.dest = dest;
    this.timer = null;
    this.step = 0;
    this.playing = false;
    this.bpm = 124;
    this.mode = 'synthwave';
    this.gain = null;
  }

  start(mode = 'synthwave') {
    this.stop();
    this.mode = mode;
    this.bpm = mode === 'cyberpunk' ? 138 : mode === 'ambient' ? 95 : 124;
    this.playing = true;
    this.step = 0;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.55;
    this.gain.connect(this.dest);

    const interval = (60 / (this.bpm * 4)) * 1000;
    this.timer = setInterval(() => this._tick(), interval);
    this._tick();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.gain) { try { this.gain.disconnect(); } catch (_) {} this.gain = null; }
    this.playing = false;
  }

  _tick() {
    if (!this.playing || !this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    const s = this.step % 32;

    // Kick
    if (s % 4 === 0 && this.mode !== 'ambient') {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(this.mode === 'cyberpunk' ? 160 : 130, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.09);
      g.gain.setValueAtTime(1.0, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(g); g.connect(this.gain);
      osc.start(now); osc.stop(now + 0.17);
    } else if (this.mode === 'ambient' && s % 8 === 0) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.22);
      g.gain.setValueAtTime(0.6, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(g); g.connect(this.gain);
      osc.start(now); osc.stop(now + 0.32);
    }

    // Snare / Noise
    if ((s === 4 || s === 12 || s === 20 || s === 28) && this.mode !== 'ambient') {
      const bSize = this.ctx.sampleRate * 0.12;
      const buf = this.ctx.createBuffer(1, bSize, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bSize; i++) d[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource(); noise.buffer = buf;
      const filt = this.ctx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.setValueAtTime(900, now);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.7, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      noise.connect(filt); filt.connect(g); g.connect(this.gain);
      noise.start(now); noise.stop(now + 0.14);
    }

    // Hi-hat
    if (s % 2 === 0 && this.mode !== 'ambient') {
      const bSize = this.ctx.sampleRate * 0.04;
      const buf = this.ctx.createBuffer(1, bSize, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bSize; i++) d[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource(); noise.buffer = buf;
      const filt = this.ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.setValueAtTime(7500, now);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(s % 4 === 2 ? 0.35 : 0.18, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      noise.connect(filt); filt.connect(g); g.connect(this.gain);
      noise.start(now); noise.stop(now + 0.05);
    }

    // Bass
    const chords = [55, 55, 43.65, 43.65, 65.4, 65.4, 49, 49];
    const freq = chords[Math.floor(s / 4) % chords.length];
    const bOsc = this.ctx.createOscillator();
    const bFilt = this.ctx.createBiquadFilter();
    const bGain = this.ctx.createGain();
    bOsc.type = this.mode === 'cyberpunk' ? 'sawtooth' : 'triangle';
    bOsc.frequency.setValueAtTime(freq, now);
    bFilt.type = 'lowpass'; bFilt.frequency.setValueAtTime(320, now);
    bFilt.frequency.exponentialRampToValueAtTime(1200, now + 0.04);
    bFilt.frequency.exponentialRampToValueAtTime(200, now + 0.14);
    bGain.gain.setValueAtTime(0.55, now); bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    bOsc.connect(bFilt); bFilt.connect(bGain); bGain.connect(this.gain);
    bOsc.start(now); bOsc.stop(now + 0.16);

    // Arp
    const scale = [220, 261.63, 329.63, 392.0, 440, 523.25, 659.25];
    const aNote = scale[(s * 3) % scale.length];
    const aOsc = this.ctx.createOscillator();
    const aGain = this.ctx.createGain();
    aOsc.type = this.mode === 'ambient' ? 'sine' : 'sawtooth';
    aOsc.frequency.setValueAtTime(aNote, now);
    const dur = this.mode === 'ambient' ? 0.45 : 0.11;
    aGain.gain.setValueAtTime(this.mode === 'ambient' ? 0.2 : 0.15, now);
    aGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    aOsc.connect(aGain); aGain.connect(this.gain);
    aOsc.start(now); aOsc.stop(now + dur + 0.02);

    this.step++;
  }
}



// ───────────────────────────────────────────────────────────── пост-обработка (Feedback TOP, Bloom, Chromatic Aberration)

class PostPipeline {
	constructor(renderer) {
		this.renderer = renderer;
		this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.quadGeo = new THREE.PlaneGeometry(2, 2);
		this.width = 0;
		this.height = 0;

		const opt = {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
			type: THREE.HalfFloatType,
		};
		this.rtScene = new THREE.WebGLRenderTarget(1, 1, opt);
		this.rtPing = new THREE.WebGLRenderTarget(1, 1, opt);
		this.rtPong = new THREE.WebGLRenderTarget(1, 1, opt);

		this.fbMat = new THREE.ShaderMaterial({
			uniforms: {
				uScene: { value: null },
				uPrev: { value: null },
				uDecay: { value: 0.92 },
				uZoom: { value: 1.0 },
				uTwist: { value: 0.0 },
				uHasPrev: { value: 0.0 },
			},
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				precision highp float;
				uniform sampler2D uScene;
				uniform sampler2D uPrev;
				uniform float uDecay;
				uniform float uZoom;
				uniform float uTwist;
				uniform float uHasPrev;
				varying vec2 vUv;
				void main() {
					vec4 curr = texture2D(uScene, vUv);
					vec4 prev = vec4(0.0);
					if (uHasPrev > 0.5) {
						vec2 c = vec2(0.5);
						vec2 p = vUv - c;
						float a = uTwist;
						mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
						vec2 pUv = (rot * p) / max(0.001, uZoom) + c;
						if (pUv.x >= 0.0 && pUv.x <= 1.0 && pUv.y >= 0.0 && pUv.y <= 1.0) {
							prev = texture2D(uPrev, pUv) * uDecay;
						}
					}
					vec3 col = max(curr.rgb, prev.rgb);
					float a = max(curr.a, prev.a * uDecay);
					gl_FragColor = vec4(col, a);
				}
			`,
			depthTest: false,
			depthWrite: false,
		});
		this.fbMesh = new THREE.Mesh(this.quadGeo, this.fbMat);

		this.outMat = new THREE.ShaderMaterial({
			uniforms: {
				uTex: { value: null },
				uBloom: { value: 0.0 },
				uAberration: { value: 0.0 },
				uRes: { value: new THREE.Vector2(1, 1) },
			},
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				precision highp float;
				uniform sampler2D uTex;
				uniform float uBloom;
				uniform float uAberration;
				uniform vec2 uRes;
				varying vec2 vUv;
				void main() {
					vec2 dir = vUv - vec2(0.5);
					float distSq = dot(dir, dir);
					vec2 shift = dir * distSq * uAberration * 0.04;

					vec4 baseCol;
					if (uAberration > 0.001) {
						float r = texture2D(uTex, vUv + shift).r;
						float g = texture2D(uTex, vUv).g;
						float b = texture2D(uTex, vUv - shift).b;
						float a = texture2D(uTex, vUv).a;
						baseCol = vec4(r, g, b, a);
					} else {
						baseCol = texture2D(uTex, vUv);
					}

					if (uBloom > 0.01) {
						vec2 texel = 1.0 / uRes;
						vec4 bloom = vec4(0.0);
						float rad = 3.2;
						bloom += texture2D(uTex, vUv + vec2(-rad, -rad) * texel);
						bloom += texture2D(uTex, vUv + vec2( rad, -rad) * texel);
						bloom += texture2D(uTex, vUv + vec2(-rad,  rad) * texel);
						bloom += texture2D(uTex, vUv + vec2( rad,  rad) * texel);
						bloom += texture2D(uTex, vUv + vec2( 0.0, -rad * 1.4) * texel);
						bloom += texture2D(uTex, vUv + vec2( 0.0,  rad * 1.4) * texel);
						bloom += texture2D(uTex, vUv + vec2(-rad * 1.4, 0.0) * texel);
						bloom += texture2D(uTex, vUv + vec2( rad * 1.4, 0.0) * texel);
						bloom *= 0.125;
						baseCol.rgb += bloom.rgb * uBloom * 0.85;
					}

					gl_FragColor = baseCol;
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
				}
			`,
			depthTest: false,
			depthWrite: false,
			transparent: true,
		});
		this.outMesh = new THREE.Mesh(this.quadGeo, this.outMat);

		this.quadScene = new THREE.Scene();
		this.hasHistory = false;
	}

	setSize(w, h, dpr = 1) {
		const rw = Math.max(1, Math.round(w * dpr));
		const rh = Math.max(1, Math.round(h * dpr));
		if (rw === this.width && rh === this.height) return;
		this.width = rw;
		this.height = rh;
		this.rtScene.setSize(rw, rh);
		this.rtPing.setSize(rw, rh);
		this.rtPong.setSize(rw, rh);
		this.outMat.uniforms.uRes.value.set(rw, rh);
		this.hasHistory = false;
	}

	render(scene, camera, feedbackCfg, bloomVal, abVal) {
		const r = this.renderer;
		const dom = r.domElement;
		const dpr = r.getPixelRatio();
		this.setSize(dom.clientWidth, dom.clientHeight, dpr);

		const useFb = feedbackCfg && feedbackCfg.on && feedbackCfg.amount > 0.01;
		const useBloom = bloomVal > 0.01;
		const useAb = abVal > 0.01;

		if (!useFb && !useBloom && !useAb) {
			r.setRenderTarget(null);
			r.render(scene, camera);
			this.hasHistory = false;
			return;
		}

		r.setRenderTarget(this.rtScene);
		r.clear();
		r.render(scene, camera);

		let sourceTex = this.rtScene.texture;

		if (useFb) {
			const zoom = feedbackCfg.zoom || 1.0;
			const twist = feedbackCfg.twist || 0.0;
			const decay = Math.min(0.97, feedbackCfg.amount || 0.92);

			this.fbMat.uniforms.uScene.value = this.rtScene.texture;
			this.fbMat.uniforms.uPrev.value = this.rtPing.texture;
			this.fbMat.uniforms.uDecay.value = decay;
			this.fbMat.uniforms.uZoom.value = zoom;
			this.fbMat.uniforms.uTwist.value = twist;
			this.fbMat.uniforms.uHasPrev.value = this.hasHistory ? 1.0 : 0.0;

			this.quadScene.clear();
			this.quadScene.add(this.fbMesh);
			r.setRenderTarget(this.rtPong);
			r.clear();
			r.render(this.quadScene, this.quadCam);

			const tmp = this.rtPing;
			this.rtPing = this.rtPong;
			this.rtPong = tmp;
			this.hasHistory = true;

			sourceTex = this.rtPing.texture;
		} else {
			this.hasHistory = false;
		}

		this.outMat.uniforms.uTex.value = sourceTex;
		this.outMat.uniforms.uBloom.value = bloomVal;
		this.outMat.uniforms.uAberration.value = abVal;

		this.quadScene.clear();
		this.quadScene.add(this.outMesh);
		r.setRenderTarget(null);
		r.render(this.quadScene, this.quadCam);
	}

	dispose() {
		this.rtScene.dispose();
		this.rtPing.dispose();
		this.rtPong.dispose();
		this.fbMat.dispose();
		this.outMat.dispose();
		this.quadGeo.dispose();
	}
}

// ── Трекинг оптического движения с веб-камеры ──────────────────────────────────

class MotionCamTracker {
	constructor(onFrame) {
		this.onFrame = onFrame;
		this.video = document.createElement('video');
		this.video.autoplay = true;
		this.video.playsInline = true;
		this.video.muted = true;
		this.W = 64;
		this.H = 48;
		this.canvas = document.createElement('canvas');
		this.canvas.width = this.W;
		this.canvas.height = this.H;
		this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
		this.preview = document.createElement('canvas');
		this.preview.width = 176;
		this.preview.height = 132;
		this.pctx = this.preview.getContext('2d');
		this.bg = null;
		this.sens = 0.6;
		this.running = false;
		this.stream = null;
		this._timer = null;
	}

	async start() {
		if (this.running) return;
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' } });
			this.video.srcObject = this.stream;
			await this.video.play();
			this.running = true;
			this.bg = null;
			this._tick();
		} catch (err) {
			this.stop();
			throw err;
		}
	}

	_tick() {
		if (!this.running) return;
		if (this.video.readyState >= 2) {
			const { W, H } = this;
			const ctx = this.ctx;
			// зеркало: движение вправо у зрителя остаётся движением вправо на экране
			ctx.save();
			ctx.scale(-1, 1);
			ctx.drawImage(this.video, -W, 0, W, H);
			ctx.restore();
			const frame = ctx.getImageData(0, 0, W, H).data;
			const n = W * H;
			if (!this.bg) {
				this.bg = new Float32Array(n);
				for (let i = 0; i < n; i++) this.bg[i] = frame[i * 4] * 0.3 + frame[i * 4 + 1] * 0.59 + frame[i * 4 + 2] * 0.11;
			}
			const thr = 46 - this.sens * 36;
			const hits = new Uint8Array(n);
			let sx = 0, sy = 0, sw = 0, cnt = 0;
			for (let i = 0; i < n; i++) {
				const l = frame[i * 4] * 0.3 + frame[i * 4 + 1] * 0.59 + frame[i * 4 + 2] * 0.11;
				const d = Math.abs(l - this.bg[i]);
				this.bg[i] += (l - this.bg[i]) * 0.2;
				if (d > thr) {
					hits[i] = 1;
					const x = i % W;
					const y = (i / W) | 0;
					sx += x * d;
					sy += y * d;
					sw += d;
					cnt++;
				}
			}
			const energy = cnt / n;
			const active = cnt >= Math.max(8, n * 0.004);
			const cx = active ? (sx / sw / W) * 2 - 1 : 0;
			const cy = active ? -((sy / sw / H) * 2 - 1) : 0;
			this._draw(frame, hits, active, active ? sx / sw : 0, active ? sy / sw : 0);
			this.onFrame({ x: cx, y: cy, energy, active });
		}
		this._timer = setTimeout(() => this._tick(), 40);
	}

	_draw(frame, hits, active, px, py) {
		const { W, H } = this;
		const c = this.pctx;
		const pw = this.preview.width;
		const ph = this.preview.height;
		c.save();
		c.scale(-1, 1);
		c.drawImage(this.video, -pw, 0, pw, ph);
		c.restore();
		c.fillStyle = 'rgba(11,13,17,0.45)';
		c.fillRect(0, 0, pw, ph);
		const cw = pw / W;
		const ch = ph / H;
		c.fillStyle = 'rgba(229,138,69,0.78)';
		for (let i = 0; i < hits.length; i++) if (hits[i]) c.fillRect((i % W) * cw, ((i / W) | 0) * ch, cw + 0.5, ch + 0.5);
		if (active) {
			const x = (px + 0.5) * cw;
			const y = (py + 0.5) * ch;
			c.strokeStyle = '#fff0dc';
			c.lineWidth = 1.5;
			c.beginPath();
			c.arc(x, y, 9, 0, Math.PI * 2);
			c.moveTo(x - 14, y);
			c.lineTo(x + 14, y);
			c.moveTo(x, y - 14);
			c.lineTo(x, y + 14);
			c.stroke();
		}
	}

	stop() {
		this.running = false;
		clearTimeout(this._timer);
		if (this.stream) {
			this.stream.getTracks().forEach((t) => t.stop());
			this.stream = null;
		}
		this.video.srcObject = null;
		this.bg = null;
	}
}

// ───────────────────────────────────────────────────────────── движок

export class EffectsEngine {
	constructor(app) {
		this.app = app;
		this.active = false;
		this.state = mergeDeep(defaultState(), loadJSON(KEY, {}));
		for (const l of FX_LAYERS) this.state.layers[l.id] = { ...l.def, ...this.state.layers[l.id] };
		this.state.look = { ...defaultState().look, ...this.state.look };

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
		this._beatHist = new Float32Array(24);
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
		this.brushHits = [];
		this.post = null;
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
		const m = { model: 'texture', solid: 'solid', normal: 'normal', height: 'height' }[v];
		if (m) pt.color = m;
		this.app.saveSettings();
		this.touch();
		this.emit();
	}

	/** Подтягивает режим цвета из вкладки «Точки»: для модели по умолчанию видна её текстура */
	syncLookFromPoints() {
		const m = { texture: 'model', solid: 'solid', normal: 'normal', height: 'height' }[this.app.settings.point.color];
		const cur = this.state.look.colorBy;
		if (m && ((this.state.source === 'model' && !this._userColor) || (cur !== 'disp' && cur !== 'index'))) this.state.look.colorBy = m;
	}

	// ------------------------------------------------------------ фото и видео
	/** Загруженное в «Медиа» фото или видео становится источником «Фото» */
	async useMedia() {
		this.state.look.colorBy = 'model';
		// стартовые вихри и пульс портят картинку: выключаем, включить можно слева
		for (const id of ['curl', 'pulse']) this.state.layers[id].on = false;
		if (this.state.source === 'media') {
			this.cache.clear();
			await this._build();
		} else await this.setSource('media');
		// картинка должна смотреть на зрителя, а не крутиться ребром
		this.state.look.autoRotate = false;
		if (this.points) this.points.rotation.set(0, 0, 0);
		this.emit();
	}

	async setMediaPts(n) {
		this.app.settings.media.pts = n;
		this.app.saveSettings();
		if (this.state.source === 'media' && this.active && !this.pm.isRec) {
			this.cache.clear();
			await this._build();
		}
		this.emit();
	}

	// ------------------------------------------------------------ морфинг между формами
	/** Список доступных форм: встроенные фигуры и объекты сцены редактора */
	forms() {
		const out = FX_SHAPES.filter((x) => x.id !== 'model' && x.id !== 'media').map((x) => ({ key: x.id, name: x.name, icon: x.icon }));
		for (const o of this.modelProvider?.objects() || []) out.push({ key: 'obj:' + o.id, name: o.name, icon: 'cube' });
		return out;
	}

	/** Доля видимых точек у формы: у модели с меньшим числом точек видна только их часть */
	_fracFor(key) {
		if (!key.startsWith('obj:') || this.state.morphCfg.weight === 'equal') return 1;
		const mp = this.modelProvider;
		const sizeOf = (k) => {
			const o = mp?.objects().find((x) => 'obj:' + x.id === k);
			return o && mp.sizeOf ? mp.sizeOf(o.obj) : 0;
		};
		const keys = new Set([...(this.playlist || []), key]);
		let mx = 0;
		for (const k of keys) if (k.startsWith('obj:')) mx = Math.max(mx, sizeOf(k));
		const mine = sizeOf(key);
		return mx > 0 && mine > 0 ? Math.max(0.08, Math.min(1, mine / mx)) : 1;
	}

	setPlaylist(keys) {
		this.playlist = keys;
		this._pi = Math.max(-1, keys.indexOf(this.curKey || this.state.source));
		this.emit();
	}

	morphNext() {
		const list = this.playlist || [];
		if (list.length < 2 || !this.active) return;
		let i;
		if (this.state.morphCfg.order === 'random') {
			do i = Math.floor(Math.random() * list.length);
			while (i === this._pi && list.length > 1);
		} else i = ((this._pi ?? -1) + 1) % list.length;
		this._pi = i;
		this._lastMorph = this._time;
		this.setSource(list[i]).catch(() => {});
	}

	toggleDissolve() {
		this._disTarget = !this._disTarget;
		this.state.layers.dissolve.on = true;
		if (this.state.layers.dissolve.mode !== 'button') this.state.layers.dissolve.mode = 'button';
		this.emit();
	}

	// ------------------------------------------------------------ лепка пальцами
	_startGrab(loc, R) {
		const T = this.geometry.attributes.aTarget.array;
		const n = T.length / 3;
		const idx = [];
		const w = [];
		const r2 = R * R;
		for (let i = 0; i < n; i++) {
			const dx = T[i * 3] - loc.x, dy = T[i * 3 + 1] - loc.y, dz = T[i * 3 + 2] - loc.z;
			const d2 = dx * dx + dy * dy + dz * dz;
			if (d2 < r2) {
				const f = 1 - Math.sqrt(d2) / R;
				idx.push(i);
				w.push(f * f * (3 - 2 * f));
			}
		}
		return { idx: Int32Array.from(idx), w: Float32Array.from(w), last: loc.clone() };
	}

	_sculptMove(gr, loc) {
		const a = this.geometry.attributes.aSculpt;
		const arr = a.array;
		const dx = loc.x - gr.last.x, dy = loc.y - gr.last.y, dz = loc.z - gr.last.z;
		for (let k = 0; k < gr.idx.length; k++) {
			const i = gr.idx[k] * 3;
			const w = gr.w[k];
			arr[i] += dx * w;
			arr[i + 1] += dy * w;
			arr[i + 2] += dz * w;
		}
		gr.last.copy(loc);
		a.needsUpdate = true;
		this._sculptLive = true;
	}

	clearSculpt() {
		const a = this.geometry?.attributes.aSculpt;
		if (!a) return;
		a.array.fill(0);
		a.needsUpdate = true;
		this._sculptLive = false;
	}

	clearBrush() {
		this.brushHits = [];
		this.emit();
	}

	addBrushHit(pos) {
		if (!pos) return;
		if (this.brushHits.length > 0 && this.brushHits[0].pos.distanceTo(pos) < 0.05) return;
		this.brushHits.unshift({ pos: pos.clone(), t0: this._time });
		this.brushHits.length = Math.min(this.brushHits.length, 20);
	}

	async toggleMotionCam() {
		if (this.camTracker && this.camTracker.running) {
			this._stopCam();
			this.app.toast('Камера выключена');
			this.emit();
			return;
		}
		this._camBusy = true;
		this._mountCam(null, 'Включаю камеру…');
		try {
			let t = new HandTracker((f) => this._onCamFrame(f), (txt) => this._camStatus(txt));
			this.camTracker = t;
			this.state.layers.camTrack.on = true;
			this._mountCam(t);
			try {
				await t.start();
				this.app.toast('Камера включена: покажите ладонь', 'ok');
			} catch (err) {
				if (!err.handsLoadFailed) throw err;
				// без сети распознать руки нельзя: переходим на упрощённый режим по движению
				t.stop();
				t = new MotionCamTracker((f) => this._onCamFrame(f));
				this.camTracker = t;
				this._mountCam(t);
				await t.start();
				this.app.toast('Не удалось загрузить распознавание рук. Работает по движению в кадре', 'warn');
			}
			this._camPos = null;
		} catch (err) {
			this._stopCam();
			this.app.toast('Нет доступа к веб-камере: разрешите её в браузере', 'error');
		}
		this._camBusy = false;
		this.emit();
	}

	_stopCam() {
		if (this.camTracker) this.camTracker.stop();
		this.state.layers.camTrack.on = false;
		this.camBox?.remove();
		this.camBox = null;
		this._camActive = false;
		this._handPtrs = [];
		this._hands = [];
		this._stretchTarget = 1;
		this._stretchBase = null;
		this._spin = null;
		this._handGrav = null;
		this._handDis = false;
		for (const [id, was] of this._handFx || []) this.state.layers[id].on = was;
		this._handFx = null;
		if (this._handBreak) {
			this._handBreak = false;
			this.setCollapse(false);
		}
		if (this.points) this.points.scale.setScalar(1);
	}

	_camStatus(txt) {
		if (this.camHint && txt) this.camHint.textContent = txt;
	}

	/** Окно с картинкой камеры: здесь видно себя и то, что распознал трекер */
	_mountCam(tracker, status) {
		this.camBox?.remove();
		this.camHint = document.createElement('div');
		this.camHint.className = 'fx-cam-text';
		this.camHint.textContent = status || 'Покажите ладонь перед камерой';
		this.camBox = document.createElement('div');
		this.camBox.className = 'fx-cam';
		if (tracker) this.camBox.append(tracker.preview);
		this.camBox.append(this.camHint);
		this.camBox.hidden = this.state.layers.camTrack.preview !== 'on';
		document.getElementById('viewport').append(this.camBox);
	}

	/** Точка на плоскости перед камерой в локальных координатах облака */
	_ndcToLocal(x, y, out, depth = 0) {
		const vp = this.app.viewport;
		this._ray.setFromCamera(new THREE.Vector2(x, y), vp.camera);
		const toCam = vp.camera.getWorldDirection(new THREE.Vector3()).negate();
		// depth > 0: плоскость пальцев сдвинута к зрителю, к передней поверхности формы
		this._plane.setFromNormalAndCoplanarPoint(toCam, toCam.clone().multiplyScalar(depth));
		const hit = new THREE.Vector3();
		if (!this._ray.ray.intersectPlane(this._plane, hit)) return null;
		return out.copy(this.points.worldToLocal(hit));
	}

	_onCamFrame(f) {
		if (!this.active || !this.points) return;
		const cfg = this.state.layers.camTrack;
		const t = this.camTracker;
		t.sens = cfg.sens;
		t.smooth = cfg.smooth;
		if (this.camBox) this.camBox.hidden = cfg.preview !== 'on';
		if (f.kind === 'hands') return this._onHands(f, cfg);
		// запасной режим: центр движения в кадре
		const txt = f.active ? 'Движение найдено' : 'Помашите рукой перед камерой';
		if (this.camHint && this.camHint.textContent !== txt) this.camHint.textContent = txt;
		this._camActive = f.active;
		if (!f.active) return;
		const k = 1 - Math.min(0.92, cfg.smooth) * 0.9;
		this._camPos = this._camPos ? { x: this._camPos.x + (f.x - this._camPos.x) * k, y: this._camPos.y + (f.y - this._camPos.y) * k } : { x: f.x, y: f.y };
		const loc = this._ndcToLocal(this._camPos.x, this._camPos.y, new THREE.Vector3(), 0.85);
		if (!loc) return;
		this.mouse.copy(loc);
		this.mouseOn = true;
		this._camT = this._time;
		this._handsT = this._time;
		this._handPtrs = [{ local: loc.clone(), s: cfg.g_palm === 'pull' ? -1 : cfg.g_palm === 'swirl' ? 3 : 1, ndc: [this._camPos.x, this._camPos.y] }];
		if (cfg.g_palm === 'brush' || this.state.layers.brush.on) this.addBrushHit(loc);
		if (cfg.g_palm === 'wave' && f.energy > 0.16 && this._time - (this._camShockT || 0) > 0.8) {
			this._camShockT = this._time;
			this.addShock(loc);
			this._waveT = this._time;
		}
	}

	_onHands(f, cfg) {
		const hands = f.hands;
		this._hands = hands;
		this._camActive = hands.length > 0;
		const actLabel = (a) => (FX_ACTIONS.find((x) => x[0] === a) || [0, ''])[1];
		const t = this.camTracker;
		t.hold = cfg.hold;
		t.names = { palm: actLabel(cfg.g_palm), fist: actLabel(cfg.g_fist), pinch: actLabel(cfg.g_pinch), point: actLabel(cfg.g_point), peace: actLabel(cfg.g_peace), rock: actLabel(cfg.g_rock), thumb: actLabel(cfg.g_thumb) };
		const txt = hands.length ? (hands.length > 1 ? 'Вижу две руки' : 'Вижу руку: покажите жест') : 'Покажите руку перед камерой';
		if (this.camHint && this.camHint.textContent !== txt) this.camHint.textContent = txt;
		const ptrs = [];
		const aspect = f.aspect || 4 / 3;
		const st = this._handState || (this._handState = new Map());
		const grabs = this._grabs || (this._grabs = new Map());
		const now = this._time;
		const loc2 = (p) => this._ndcToLocal(p[0] * 2 - 1, -(p[1] * 2 - 1), new THREE.Vector3(), cfg.depth);
		let wantBreak = false, wantDis = false, grav = null, brushNow = false;
		const wantFx = new Set();
		for (const hd of hands) {
			const g = hd.gesture;
			const a = g === 'none' ? 'none' : cfg['g_' + g];
			const prev = st.get(hd.id) || { palmX: hd.palm[0], palmY: hd.palm[1], a: 'none', g: 'none', t: now };
			const dtH = Math.max(0.016, Math.min(0.2, now - prev.t));
			const entered = prev.a !== a;
			const mid = [(hd.tips[0][0] + hd.tips[1][0]) / 2, (hd.tips[0][1] + hd.tips[1][1]) / 2];
			const focus = g === 'pinch' ? mid : g === 'point' ? hd.tips[1] : hd.palm;
			const fl = loc2(focus);
			if (hands[0] === hd && fl) {
				this.mouse.copy(fl);
				this.mouseOn = true;
				this._camT = now;
			}
			if (a === 'push' || a === 'pull' || a === 'swirl') {
				const sv = a === 'push' ? 1 : a === 'pull' ? -1 : 3;
				const pts = g === 'palm' ? [...hd.tips, hd.palm] : [focus];
				for (const p of pts) {
					const l = loc2(p);
					if (l) ptrs.push({ local: l, s: sv, ndc: [p[0] * 2 - 1, -(p[1] * 2 - 1)] });
				}
			} else if (a === 'rotate') {
				if (!entered) {
					const sp = this._spin || (this._spin = { x: 0, y: 0 });
					sp.y += (((hd.palm[0] - prev.palmX) * cfg.spin) / dtH - sp.y) * 0.5;
					if (cfg.axis === 'xy') sp.x += (((hd.palm[1] - prev.palmY) * cfg.spin) / dtH - sp.x) * 0.5;
					this._grabbing = now;
				}
			} else if (a === 'sculpt' && this.geometry) {
				const gr = grabs.get(hd.id);
				if (fl) {
					if (!gr || entered) grabs.set(hd.id, this._startGrab(fl, cfg.clay));
					else this._sculptMove(gr, fl);
				}
			} else if (a === 'wave') {
				if (entered && fl && now - (this._camShockT || 0) > 0.5) {
					this._camShockT = now;
					this.addShock(fl);
					this._waveT = now;
				}
			} else if (a === 'gravity') {
				if (fl) grav = fl;
			} else if (a.startsWith('fx:')) wantFx.add(a.slice(3));
			else if (a === 'break') wantBreak = true;
			else if (a === 'dissolve') wantDis = true;
			else if (a === 'brush') {
				brushNow = true;
				const pts = g === 'palm' ? hd.tips : [focus];
				for (const p of pts) {
					const q = loc2(p);
					if (q) this.addBrushHit(q);
				}
			}
			if (a !== 'sculpt') grabs.delete(hd.id);
			st.set(hd.id, { palmX: hd.palm[0], palmY: hd.palm[1], a, g, t: now });
		}
		for (const key of [...st.keys()]) if (!hands.some((h) => h.id === key)) {
			st.delete(key);
			grabs.delete(key);
		}
		if (brushNow) this._brushHand = now;
		this._handGrav = grav;
		this._handDis = wantDis;
		// знак руки включает эффект, пока его держат; отпустил, и слой возвращается как был
		const hf = this._handFx || (this._handFx = new Map());
		for (const id of wantFx) {
			if (!hf.has(id) && this.state.layers[id]) {
				hf.set(id, this.state.layers[id].on);
				this.state.layers[id].on = true;
				this.emit();
			}
		}
		for (const [id, was] of [...hf]) {
			if (!wantFx.has(id)) {
				this.state.layers[id].on = was;
				hf.delete(id);
				this.emit();
			}
		}
		if (wantBreak !== !!this._handBreak) {
			this._handBreak = wantBreak;
			this.setCollapse(wantBreak);
		}
		if (cfg.stretch === 'on' && hands.length === 2) {
			const d = Math.hypot((hands[0].palm[0] - hands[1].palm[0]) * aspect, hands[0].palm[1] - hands[1].palm[1]);
			if (!this._stretchBase) this._stretchBase = { d, s: this._stretchTarget || 1 };
			this._stretchTarget = clamp(this._stretchBase.s * (d / Math.max(0.05, this._stretchBase.d)), 0.4, 3);
		} else {
			this._stretchBase = null;
			if (cfg.keep === 'off' || cfg.stretch !== 'on') this._stretchTarget = 1;
		}
		this._handPtrs = ptrs;
		if (hands.length) this._handsT = now;
	}

	// ------------------------------------------------------------ состояние
	touch() {
		clearTimeout(this._saveT);
		this._saveT = setTimeout(() => saveJSON(KEY, this.state), 250);
	}
	emit() {
		this.app.bus.emit('fx');
	}
	get hasModel() {
		return !!(this.modelProvider && this.modelProvider.available());
	}

	_ensureCtx() {
		if (this.ctx) return;
		const A = window.AudioContext || window.webkitAudioContext;
		this.ctx = new A();
		this.bus = this.ctx.createGain();
		this.analyser = this.ctx.createAnalyser();
		this.analyser.fftSize = 2048;
		this.analyser.smoothingTimeConstant = 0.82;
		this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
		this.out = this.ctx.createGain();
		this.out.gain.value = this.state.audio.volume;
		this.recDest = this.ctx.createMediaStreamDestination();
		this.bus.connect(this.analyser);
		this.bus.connect(this.out);
		this.out.connect(this.ctx.destination);
		this.bus.connect(this.recDest);
		this.synth = new TouchSynth(this.ctx, this.bus);
	}

	setVolume(v) {
		this.state.audio.volume = v;
		if (this.out && this.sourceType !== 'mic') this.out.gain.value = v;
		this.touch();
	}

	get trackLabel() {
		if (this.sourceType === 'mic') return 'Микрофон';
		if (this.sourceType === 'file') return this.audioName || 'Трек';
		return (SYNTH_STYLES.find((s) => s.id === this.state.audio.style) || SYNTH_STYLES[0]).name;
	}

	async play() {
		this._ensureCtx();
		if (this.ctx.state === 'suspended') await this.ctx.resume();
		if (this.sourceType === 'synth') {
			this.synth.start(this.state.audio.style);
			this.playing = true;
		} else if (this.sourceType === 'file' && this.audioBuffer) {
			this._stopFile();
			this.source = this.ctx.createBufferSource();
			this.source.buffer = this.audioBuffer;
			this.source.loop = true;
			this.source.connect(this.bus);
			this.source.start(0);
			this.playing = true;
		}
		this.emit();
	}

	pause() {
		this.synth?.stop();
		this._stopFile();
		if (this.sourceType === 'mic') this._stopMic();
		this.playing = false;
		this.emit();
	}

	toggle() {
		return this.playing ? this.pause() : this.play();
	}

	_stopFile() {
		if (this.source) {
			try {
				this.source.stop();
			} catch (e) {
				/* уже остановлен */
			}
			this.source.disconnect();
			this.source = null;
		}
	}

	_stopMic() {
		if (this.micStream) {
			this.micStream.getTracks().forEach((t) => t.stop());
			this.micStream = null;
			this.micNode?.disconnect();
			if (this.out) this.out.gain.value = this.state.audio.volume;
		}
	}

	async useSynth(style) {
		if (style) this.state.audio.style = style;
		this._stopMic();
		this._stopFile();
		this.sourceType = 'synth';
		this.touch();
		await this.play();
	}

	async loadFile(file) {
		this._ensureCtx();
		this.synth.stop();
		this._stopFile();
		this._stopMic();
		this.audioBuffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
		this.sourceType = 'file';
		this.audioName = file.name.replace(/\.[^.]+$/, '');
		await this.play();
	}

	async useMic() {
		this._ensureCtx();
		this.synth.stop();
		this._stopFile();
		this._stopMic();
		this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
		this.micNode = this.ctx.createMediaStreamSource(this.micStream);
		this.micNode.connect(this.bus);
		this.out.gain.value = 0; // не выводим микрофон в колонки: будет свист
		this.sourceType = 'mic';
		this.playing = true;
		if (this.ctx.state === 'suspended') await this.ctx.resume();
		this.emit();
	}

	_analyse(dt) {
		const a = this.state.audio;
		let bass = 0, mid = 0, high = 0, beat = 0;
		if (this.analyser && this.playing) {
			this.analyser.getByteFrequencyData(this.freqData);
			const n = this.freqData.length;
			const e1 = Math.floor(n * 0.05), e2 = Math.floor(n * 0.25), e3 = Math.floor(n * 0.7);
			let b = 0, m = 0, h = 0;
			for (let i = 0; i < e1; i++) b += this.freqData[i];
			for (let i = e1; i < e2; i++) m += this.freqData[i];
			for (let i = e2; i < e3; i++) h += this.freqData[i];
			const g = a.gain * 1.15;
			const bRaw = Math.min(1, (b / (e1 * 255)) * g);
			const mRaw = Math.min(1, (m / ((e2 - e1) * 255)) * g * 1.2);
			const hRaw = Math.min(1, (h / ((e3 - e2) * 255)) * g * 1.8);
			this._beatHist[this._beatIdx++ % this._beatHist.length] = bRaw;
			let avg = 0;
			for (const v of this._beatHist) avg += v;
			avg /= this._beatHist.length;
			const now = performance.now();
			if (bRaw > avg * 1.3 && bRaw > 0.3 && now - this._lastBeat > 190) {
				this._lastBeat = now;
				this.levels.beat = 1;
			}
			const kA = 1 - Math.pow(0.001, dt * 6); // быстрая атака
			const kR = 1 - Math.pow(0.001, dt * 2.2); // плавный спад
			const lag = (cur, raw) => cur + (raw - cur) * (raw > cur ? kA : kR);
			bass = lag(this.levels.bass, bRaw);
			mid = lag(this.levels.mid, mRaw);
			high = lag(this.levels.high, hRaw);
			// спектр: 64 полосы по логарифмической шкале
			for (let i = 0; i < 64; i++) {
				const f0 = Math.floor(Math.pow(i / 64, 2) * n * 0.55);
				const f1 = Math.max(f0 + 1, Math.floor(Math.pow((i + 1) / 64, 2) * n * 0.55));
				let s = 0;
				for (let j = f0; j < f1; j++) s += this.freqData[j];
				const v = Math.min(1, (s / ((f1 - f0) * 255)) * g * (1 + i / 40));
				this.spec[i] += (v - this.spec[i]) * (v > this.spec[i] ? 0.6 : 0.15);
			}
		} else if (a.idle) {
			const t = this._time;
			bass = 0.3 + 0.22 * Math.sin(t * 1.3);
			mid = 0.28 + 0.2 * Math.sin(t * 1.9 + 1);
			high = 0.22 + 0.15 * Math.sin(t * 2.7 + 2);
			if (Math.sin(t * 2.2) > 0.96) this.levels.beat = Math.max(this.levels.beat, 0.8);
			for (let i = 0; i < 64; i++) this.spec[i] = 0.2 + 0.15 * Math.sin(t * 2 + i * 0.4) * Math.sin(t * 0.7 + i * 0.1);
		} else {
			const k = 1 - Math.pow(0.001, dt * 3);
			bass = this.levels.bass * (1 - k);
			mid = this.levels.mid * (1 - k);
			high = this.levels.high * (1 - k);
			for (let i = 0; i < 64; i++) this.spec[i] *= 1 - k;
		}
		beat = this.levels.beat * Math.pow(0.0008, dt);
		this.levels = { bass, mid, high, beat };
		const d = this.specTex.image.data;
		for (let i = 0; i < 64; i++) d[i] = Math.round(clamp(this.spec[i], 0, 1) * 255);
		this.specTex.needsUpdate = true;
	}

	// ------------------------------------------------------------ геометрия
	/** Сколько частиц реально используем: если в сцене есть готовое облако точек, не больше, чем в нём */
	_n() {
		const mp = this.modelProvider;
		if (mp && mp.kind() === 'cloud') return Math.max(1000, Math.min(this.state.count, mp.total()));
		return this.state.count;
	}

	async _cloudFor(key) {
		if (key === 'media') {
			const pm = this.pm;
			if (!pm.ready) return null;
			pm.setGrid(this.app.settings.media.pts);
			const m = this.app.settings.media;
			pm.dirty = true;
			return pm.buildCloud(pm.sample(), m.relief, m.depth);
		}
		const n = this._n();
		const ck = key + ':' + n;
		if (this.cache.has(ck)) return this.cache.get(ck);
		let c;
		if (key === 'model') {
			c = this.modelProvider ? await this.modelProvider.get(n) : null;
			if (!c) return null;
			c = normalizeCloud(c);
		} else if (key.startsWith('obj:')) {
			const o = this.modelProvider?.objects().find((x) => x.id === key.slice(4));
			c = o ? await this.modelProvider.getOf(o.obj, n) : null;
			if (!c || !c.count) return null;
			c = fitCount(normalizeCloud(c), n);
		} else {
			c = generateShapePoints(key, n);
		}
		this.cache.set(ck, c);
		return c;
	}

	async _build() {
		const st = this.state;
		if (st.source === 'model' && !this.hasModel) st.source = 'sphere';
		let c = await this._cloudFor(st.source);
		if (!c) {
			st.source = 'sphere';
			c = await this._cloudFor('sphere');
		}
		const count = c.count;
		const g = new THREE.BufferGeometry();
		const idx = new Float32Array(count);
		for (let i = 0; i < count; i++) idx[i] = i / count;
		const model = st.source === 'model' || st.source === 'media' ? c : this.hasModel ? (await this._cloudFor('model').catch(() => null)) || c : c;
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
		g.setAttribute('aOrigin', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
		g.setAttribute('aTarget', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
		g.setAttribute('aNormal', new THREE.BufferAttribute(new Float32Array(c.normals), 3));
		g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(model.colors.length === c.colors.length ? model.colors : c.colors), 3));
		g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
		g.setAttribute('aSculpt', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
		g.setAttribute('aVis', new THREE.BufferAttribute(new Float32Array(count * 2).fill(1), 2));
		this._grabs = new Map();
		if (!this.specTex) {
			this.specTex = new THREE.DataTexture(new Uint8Array(64), 64, 1, THREE.RedFormat, THREE.UnsignedByteType);
			this.specTex.minFilter = this.specTex.magFilter = THREE.LinearFilter;
			this.specTex.needsUpdate = true;
		}
		const U = (v) => ({ value: v });
		// общие униформы: точки, призраки и линии читают одни и те же значения
		const shared = {
			uTime: U(0), uMorph: U(1), uSize: U(3), uPR: U(1), uBeat: U(0), uColorBy: U(0), uBright: U(1), uGlow: U(0.8), uAdd: U(1), uDens: U(Math.min(1.6, Math.sqrt(150000 / count))),
			uP0: U(new THREE.Color()), uP1: U(new THREE.Color()), uP2: U(new THREE.Color()), uYR: U(new THREE.Vector2(-1, 1)),
			uMouse: U(new THREE.Vector3()), uMouseOn: U(0), uSpecTex: U(this.specTex),
			uCurl: U(new THREE.Vector4()), uSpec: U(new THREE.Vector4()), uWave: U(new THREE.Vector4()), uTwist: U(new THREE.Vector4()),
			uPulse: U(new THREE.Vector4()), uVoxel: U(new THREE.Vector4()), uJitter: U(new THREE.Vector4()), uCursor: U(new THREE.Vector4()),
			uGlitch: U(new THREE.Vector4()), uSlice: U(new THREE.Vector4()), uSliceM: U(new THREE.Vector4()), uSliceC: U(new THREE.Color()), uMark: U(new THREE.Vector4()), uMarkC: U(new THREE.Color()), uLink: U(new THREE.Vector4()), uContact: U(new THREE.Vector4()), uShockP: U(new THREE.Vector4()),
			uTrk: U(Array.from({ length: 16 }, () => new THREE.Vector4())), uImp: U(Array.from({ length: 32 }, () => new THREE.Vector4())), uShock: U(Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, -1))),
			uMask: U(new THREE.Vector4()), uMaskA: U(new THREE.Vector4()), uMaskShow: U(0),
			uPhysics: U(new THREE.Vector4()), uCollapseTime: U(0),
			uBrushHits: U(Array.from({ length: 20 }, () => new THREE.Vector4(0, 0, 0, -1))), uBrushParam: U(new THREE.Vector4()),
			uLookP2: U(new THREE.Vector4()), uDof: U(new THREE.Vector4()),
			uAlive: U(new THREE.Vector4()), uShape: U(1), uSolid: U(new THREE.Color()), uAtt: U(1), uHand: U(Array.from({ length: 12 }, () => new THREE.Vector4())), uHandP: U(new THREE.Vector4()), uGrav: U(new THREE.Vector4()), uGravT: U(new THREE.Vector4()), uPhysP: U(new THREE.Vector4()), uAsm: U(0), uDis: U(new THREE.Vector4()), uDisT: U(0.8), uGravP: U(new THREE.Vector4()), uRes: U(new THREE.Vector2(1, 1)), uLinkW: U(1.8),
		};
		const mk = (extra) =>
			new THREE.ShaderMaterial({
				vertexShader: vert,
				fragmentShader: frag,
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				uniforms: { ...shared, uTOff: U(0), uGhost: U(1), ...extra },
			});
		const mat = mk();
		const pts = new THREE.Points(g, mat);
		pts.frustumCulled = false;
		pts.name = '__fx';
		pts.userData.helper = true;
		g.computeBoundingBox();
		const bb = g.boundingBox;
		shared.uYR.value.set(bb.min.y, bb.max.y);
		const old = this.points;
		const rot = old ? old.rotation.clone() : null;
		if (old) this._disposePoints();
		// шлейф: до пяти призрачных копий (след, спираль, калейдоскоп), делят геометрию с основной
		this.ghosts = [1, 2, 3, 4, 5].map((k) => {
			const gm = mk({ uTOff: U(0), uGhost: U(0) });
			const gp = new THREE.Points(g, gm);
			gp.frustumCulled = false;
			gp.userData.helper = true;
			gp.visible = false;
			pts.add(gp);
			return gp;
		});
		// связи: линии между узлами
		const lg = new THREE.BufferGeometry();
		const lm = new THREE.ShaderMaterial({ vertexShader: lineVert, fragmentShader: lineFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { ...shared, uTOff: U(0) } });
		this.linkObj = new THREE.Mesh(lg, lm);
		this.linkObj.frustumCulled = false;
		this.linkObj.userData.helper = true;
		this.linkObj.visible = false;
		pts.add(this.linkObj);
		this.geometry = g;
		this.material = mat;
		this.shared = shared;
		this.points = pts;
		if (rot) pts.rotation.copy(rot);
		this.cloudKey = st.source;
		this.morph = 1;
		this.morphing = false;
		this.app.viewport.scene.add(pts);
		this._computeLinks();
	}

	_disposePoints() {
		if (!this.points) return;
		this.app.viewport.scene.remove(this.points);
		this.points.traverse((o) => {
			if (o.geometry && o !== this.points) o.geometry.dispose();
			if (o.material) o.material.dispose();
		});
		this.geometry?.dispose();
		this.points = this.geometry = this.material = this.linkObj = null;
		this.ghosts = [];
	}

	/** Подбирает пары соседних узлов (по итоговой форме) и записывает атрибуты линий */
	_computeLinks() {
		if (!this.geometry || !this.linkObj) return;
		const g = this.geometry;
		const N = g.attributes.position.count;
		const S = Math.min(N, Math.round(this.state.layers.links.count));
		const step = N / S;
		const O = g.attributes.aOrigin.array;
		const T = g.attributes.aTarget.array;
		const ids = new Int32Array(S);
		for (let i = 0; i < S; i++) ids[i] = Math.floor(i * step);
		const R = 0.35;
		const cell = R;
		const key = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
		const grid = new Map();
		for (let i = 0; i < S; i++) {
			const p = ids[i] * 3;
			const k = key(Math.floor(T[p] / cell), Math.floor(T[p + 1] / cell), Math.floor(T[p + 2] / cell));
			let a = grid.get(k);
			if (!a) grid.set(k, (a = []));
			a.push(i);
		}
		const pairs = [];
		const seen = new Set();
		for (let i = 0; i < S; i++) {
			const p = ids[i] * 3;
			const cx = Math.floor(T[p] / cell), cy = Math.floor(T[p + 1] / cell), cz = Math.floor(T[p + 2] / cell);
			const cand = [];
			for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
				const a = grid.get(key(cx + dx, cy + dy, cz + dz));
				if (!a) continue;
				for (const j of a) {
					if (j === i) continue;
					const q = ids[j] * 3;
					const d = (T[p] - T[q]) ** 2 + (T[p + 1] - T[q + 1]) ** 2 + (T[p + 2] - T[q + 2]) ** 2;
					if (d < R * R) cand.push([d, j]);
				}
			}
			cand.sort((a, b) => a[0] - b[0]);
			for (let k = 0; k < Math.min(3, cand.length); k++) {
				const j = cand[k][1];
				const id = i < j ? i * S + j : j * S + i;
				if (seen.has(id)) continue;
				seen.add(id);
				pairs.push(i, j);
			}
		}
		const L = pairs.length / 2;
		const V = L * 4;
		const A = new Float32Array(V * 3), TA = new Float32Array(V * 3), B = new Float32Array(V * 3), TB = new Float32Array(V * 3);
		const ia = new Float32Array(V), ib = new Float32Array(V), end = new Float32Array(V), side = new Float32Array(V);
		const index = new Uint32Array(L * 6);
		for (let l = 0; l < L; l++) {
			const a = ids[pairs[l * 2]], b = ids[pairs[l * 2 + 1]];
			const q = l * 4;
			index.set([q, q + 1, q + 2, q + 2, q + 1, q + 3], l * 6);
			for (let v = 0; v < 4; v++) {
				const o = (l * 4 + v) * 3;
				for (let c = 0; c < 3; c++) {
					A[o + c] = O[a * 3 + c];
					TA[o + c] = T[a * 3 + c];
					B[o + c] = O[b * 3 + c];
					TB[o + c] = T[b * 3 + c];
				}
				ia[l * 4 + v] = a / N;
				ib[l * 4 + v] = b / N;
				end[l * 4 + v] = v >> 1;
				side[l * 4 + v] = v & 1 ? 1 : -1;
			}
		}
		const lg = this.linkObj.geometry;
		lg.setAttribute('position', new THREE.BufferAttribute(A.slice(), 3));
		lg.setAttribute('aOrigin', new THREE.BufferAttribute(A, 3));
		lg.setAttribute('aTarget', new THREE.BufferAttribute(TA, 3));
		lg.setAttribute('aOriginB', new THREE.BufferAttribute(B, 3));
		lg.setAttribute('aTargetB', new THREE.BufferAttribute(TB, 3));
		lg.setAttribute('aIdx', new THREE.BufferAttribute(ia, 1));
		lg.setAttribute('aIdxB', new THREE.BufferAttribute(ib, 1));
		lg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
		lg.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
		lg.setIndex(new THREE.BufferAttribute(index, 1));
		lg.computeBoundingSphere();
		this._pairs = { ids, list: pairs, N };
	}

	/** Обновляет концы линий после смены формы (морфинг): берём актуальные origin/target выбранных точек */
	_syncLinks() {
		if (!this._pairs || !this.linkObj) return;
		const { ids, list, N } = this._pairs;
		const O = this.geometry.attributes.aOrigin.array;
		const T = this.geometry.attributes.aTarget.array;
		const lg = this.linkObj.geometry;
		const set = (name, src, which) => {
			const arr = lg.attributes[name].array;
			for (let l = 0; l < list.length / 2; l++) {
				const p = ids[list[l * 2 + which]] * 3;
				for (let v = 0; v < 4; v++) {
					const o = (l * 4 + v) * 3;
					arr[o] = src[p];
					arr[o + 1] = src[p + 1];
					arr[o + 2] = src[p + 2];
				}
			}
			lg.attributes[name].needsUpdate = true;
		};
		set('aOrigin', O, 0);
		set('aTarget', T, 0);
		set('aOriginB', O, 1);
		set('aTargetB', T, 1);
	}

	relink() {
		clearTimeout(this._relT);
		this._relT = setTimeout(() => this._computeLinks(), 180);
	}

	/** Цвет фона сцены в режиме эффектов (пусто: как в редакторе) */
	applyBg() {
		const stage = document.querySelector('.stage');
		const { bg, vignette } = this.state.look;
		if (!this.active || !bg) {
			this.app.viewport.applyRenderSettings();
			return;
		}
		const c = new THREE.Color(bg);
		const hi = c.clone().lerp(new THREE.Color(1, 1, 1), 0.025);
		stage.style.background = vignette ? `radial-gradient(ellipse at 50% 42%, #${hi.getHexString(THREE.SRGBColorSpace)} 0%, ${bg} 78%)` : bg;
	}

	/** Меняет облако без разрыва: старая форма плавно перетекает в новую */
	async setSource(key) {
		const st = this.state;
		if (key === 'media' && !this.pm.ready) {
			this.app.toast('Сначала загрузите фото или видео в разделе «Фото и видео»', 'info');
			return;
		}
		if (key === 'model' && !this.hasModel) {
			this.app.toast('Нет модели: добавьте её кнопкой «Добавить модель» или откройте в редакторе', 'info');
			return;
		}
		const real = !key.startsWith('obj:');
		if (real) st.source = key;
		this.touch();
		if (!this.active || !this.geometry) return this.emit();
		const target = await this._cloudFor(key);
		if (!target) return this.emit();
		this.curKey = key;
		if (!target || target.count !== this.geometry.attributes.position.count) {
			await this._build();
			return this.emit();
		}
		const g = this.geometry;
		const o = g.attributes.aOrigin;
		const t = g.attributes.aTarget;
		const k = this.morph * this.morph * (3 - 2 * this.morph);
		for (let i = 0; i < o.array.length; i++) {
			o.array[i] = o.array[i] * (1 - k) + t.array[i] * k;
			t.array[i] = target.positions[i];
		}
		g.attributes.aNormal.array.set(target.normals);
		g.attributes.aNormal.needsUpdate = true;
		if (target.colors && target.colors.length === g.attributes.aColor.array.length) {
			g.attributes.aColor.array.set(target.colors);
			g.attributes.aColor.needsUpdate = true;
		}
		// число точек у моделей разное: лишние точки гаснут, а при переходе к большей модели недостающие проявляются
		const vis = g.attributes.aVis;
		if (vis) {
			const frac = this._fracFor(key);
			const n = vis.count;
			for (let i = 0; i < n; i++) {
				const cur = vis.array[i * 2] * (1 - k) + vis.array[i * 2 + 1] * k;
				const rnd = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
				vis.array[i * 2] = cur;
				vis.array[i * 2 + 1] = rnd < frac ? 1 : 0;
			}
			vis.needsUpdate = true;
		}
		o.needsUpdate = t.needsUpdate = true;
		this.cloudKey = key;
		this.morph = 0;
		this.morphing = true;
		this._computeLinks();
		this.emit();
	}

	async setCount(n) {
		this.state.count = n;
		this.app.settings.point.surfaceCount = n;
		this.app.saveSettings();
		this.app.bus.emit('pointsettings');
		this.cache.clear();
		this.touch();
		if (this.active) {
			this.app.ui.busy('Пересобираю частицы', 0.3);
			try {
				await this._build();
			} finally {
				this.app.ui.idle();
			}
		}
		this.emit();
	}

	/** В сцене редактора что-то изменилось (например, добавили модель): пересобираем облако */
	_onScene() {
		if (!this.active || this._muteScene) return;
		clearTimeout(this._sceneT);
		this._sceneT = setTimeout(async () => {
			if (!this.active) return;
			this.cache.clear();
			if (this.hasModel) {
				this.state.source = 'model';
				this.syncLookFromPoints();
			}
			try {
				await this._build();
			} catch (e) {
				console.error(e);
			}
			this.app.nav.animateTo({ target: new THREE.Vector3(0, 0, 0), distance: 5.2 }, 300);
			this.emit();
		}, 700);
	}

	// ------------------------------------------------------------ вход и выход
	async enter() {
		if (this.active) return;
		const app = this.app;
		this.active = true;
		// число частиц общее с вкладкой «Точки»: что задали в редакторе, то и здесь
		this.state.count = Math.max(20000, Math.min(2000000, app.settings.point.surfaceCount));
		const vp = app.viewport;
		this._saved = { rootVisible: vp.root.visible, ortho: app.nav.ortho };
		app.model.select(null);
		vp.root.visible = false;
		vp.fxHide = true;
		if (app.nav.ortho) app.nav.setOrtho(false);
		document.getElementById('app').classList.add('fx-mode');
		// модель из редактора (меш или облако точек) важнее любого примитива
		this.state.source = this.hasModel ? 'model' : this.state.source === 'model' ? 'sphere' : this.state.source;
		app.ui.busy('Готовлю частицы', 0.3);
		try {
			await this._build();
		} catch (e) {
			console.error(e);
			app.ui.idle();
			this.active = false;
			vp.root.visible = this._saved.rootVisible;
			vp.fxHide = false;
			document.getElementById('app').classList.remove('fx-mode');
			throw e;
		}
		app.ui.idle();
		const stage = document.querySelector('.stage');
		stage.addEventListener('pointermove', this._move);
		stage.addEventListener('pointerleave', this._leave);
		stage.addEventListener('pointerdown', this._dn);
		stage.addEventListener('pointerup', this._up);
		this._offScene = app.bus.on('scene', () => this._onScene());
		this.hud = new TrackerHud(document.getElementById('viewport'));
		this.applyBg();
		this.post = new PostPipeline(vp.renderer);
		vp.renderHook = (renderer, scene, camera) => {
			if (!this.active) {
				renderer.render(scene, camera);
				return;
			}
			const fb = this.state.layers.feedback;
			const bloom = this.state.look.bloom || 0;
			const ab = this.state.look.aberration || 0;
			this.post.render(scene, camera, fb, bloom, ab);
		};
		app.nav.animateTo({ target: new THREE.Vector3(0, 0, 0), distance: 5.2 }, 400);
		this.syncLookFromPoints();
		if (this.pm.playing && this.state.source === 'media') this.pm.play();
		this._lastT = performance.now();
		this._loop();
		this.emit();
	}

	exit() {
		if (!this.active) return;
		this.active = false;
		this.stopRecording();
		this.pm.pause();
		this.pause();
		cancelAnimationFrame(this._raf);
		clearTimeout(this._sceneT);
		this._offScene && this._offScene();
		this.hud?.dispose();
		this.hud = null;
		this.app.viewport.renderHook = null;
		this.post?.dispose();
		this.post = null;
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
		document.getElementById('app').classList.remove('fx-mode');
		this.app.display.apply();
		this.app.nav.frameAll(true);
		vp.invalidate();
		this.emit();
	}

	/** Запускает волну из точки pos (в локальных координатах облака) */
	addShock(pos) {
		if (!pos) return;
		this.shocks.unshift({ pos: pos.clone(), t0: this._time });
		this.shocks.length = Math.min(this.shocks.length, 4);
	}

	_onDown(e) {
		this._pointerDown = true;
		this._down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button };
		if (this.mouseOn && this.state.layers.brush.on) {
			this.addBrushHit(this.mouse);
		}
	}

	_onUp(e) {
		this._pointerDown = false;
		const d = this._down;
		this._down = null;
		if (!d || d.b !== 0 || !this.state.layers.shock.on) return;
		if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 450) return;
		this._onMove(e);
		if (this.mouseOn) this.addShock(this.mouse);
	}

	_onMove(e) {
		if (!this.points) return;
		const vp = this.app.viewport;
		const r = vp.canvas.getBoundingClientRect();
		const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
		this._ray.setFromCamera(ndc, vp.camera);
		this._plane.setFromNormalAndCoplanarPoint(vp.camera.getWorldDirection(new THREE.Vector3()).negate(), new THREE.Vector3());
		const hit = new THREE.Vector3();
		if (this._ray.ray.intersectPlane(this._plane, hit)) {
			this.mouse.copy(this.points.worldToLocal(hit));
			this.mouseOn = true;
			this._moveT = this._time;
			if (this.state.layers.brush.on && (e.buttons === 1 || this._pointerDown)) {
				this.addBrushHit(this.mouse);
			}
		}
	}

	/** Сила слоя с учётом реакции на звук: depth=0 даёт постоянное значение, depth=1 следует за полосой */
	_eff(l) {
		if (!l.on) return 0;
		if (l.band === 'none' || !l.react) return l.amount;
		const b = this.levels[l.band] || 0;
		return l.amount * (1 - l.react + l.react * b * 2);
	}

	_loop() {
		const tick = (now) => {
			if (!this.active) return;
			this._raf = requestAnimationFrame(tick);
			const dt = Math.min(0.1, (now - this._lastT) / 1000);
			this._lastT = now;
			const st0 = this.state;
			this._time += dt;
			this._analyse(dt);
			if (!this.material) return;
			if (this.morphing) {
				this.morph = Math.min(1, this.morph + dt / Math.max(0.3, st0.morphCfg.time));
				this._syncLinks();
				if (this.morph >= 1) this.morphing = false;
			}
			const st = this.state;
			if (this.points && st.look.autoRotate) {
				this.points.rotation.y += dt * st.look.rotSpeed;
				this.points.updateMatrixWorld();
			}
			const u = this.shared;
			const L = st.layers;
			const look = st.look;
			const pal = FX_PALETTES.find((p) => p.id === look.palette) || FX_PALETTES[0];
			u.uTime.value = this._time;
			u.uMorph.value = this.morph;
			// вид точек общий с вкладкой «Точки» редактора: форма, размер, цвет, затухание вдали
			const pset = this.app.settings.point;
			u.uSize.value = pset.size;
			u.uShape.value = Math.max(0, ['square', 'circle', 'sphere', 'ring', 'diamond', 'plus'].indexOf(pset.shape));
			u.uSolid.value.set(pset.solidColor);
			u.uAtt.value = pset.attenuate ? 1 : 0;
			u.uPR.value = this.app.viewport.renderer.getPixelRatio();
			u.uBeat.value = this.levels.beat;
			// чем плотнее точки ложатся на пиксели (мелкий экран, близкая камера), тем больше они выгорают: приглушаем
			{
				const cam = this.app.viewport.camera;
				const n = this.geometry.attributes.position.count;
				let fit = 1;
				if (cam.isPerspectiveCamera) {
					const pr = u.uPR.value;
					const d = Math.max(0.5, cam.position.length());
					const ppu = (this.app.viewport.canvas.clientHeight * pr) / (2 * d * Math.tan((cam.fov * Math.PI) / 360));
					const sPx = Math.min(95, (this.app.settings.point.size * pr * 3.8) / d);
					const overlap = (n * sPx * sPx) / (Math.PI * (1.1 * ppu) ** 2);
					fit = clamp(Math.sqrt(3.5 / Math.max(overlap, 1e-3)), 0.25, 1);
				}
				u.uDens.value = Math.min(1.6, Math.sqrt(150000 / Math.max(1, n))) * fit;
			}
			u.uBright.value = look.bright;
			u.uGlow.value = look.glow;
			u.uColorBy.value = Math.max(0, COLOR_BY.findIndex((c) => c.id === look.colorBy));
			u.uP0.value.set(pal.c[0]);
			u.uP1.value.set(pal.c[1]);
			u.uP2.value.set(pal.c[2]);
			const add = look.blend === 'add';
			u.uAdd.value = add ? 1 : 0;
			const bl = add ? THREE.AdditiveBlending : THREE.NormalBlending;
			if (this.material.blending !== bl) {
				for (const m of [this.material, ...this.ghosts.map((g) => g.material)]) {
					m.blending = bl;
					m.transparent = add;
					m.depthWrite = !add;
					m.needsUpdate = true;
				}
			}
			u.uCurl.value.set(this._eff(L.curl), L.curl.scale, 0, 0);
			u.uSpec.value.set(this._eff(L.spectrum), L.spectrum.axis === 'height' ? 1 : 0, 0, 0);
			u.uWave.value.set(this._eff(L.wave), L.wave.freq, 0, 0);
			u.uTwist.value.set(this._eff(L.twist), 0, 0, 0);
			u.uPulse.value.set(this._eff(L.pulse), 0, 0, 0);
			u.uVoxel.value.set(clamp(this._eff(L.voxel), 0, 1), 0, 0, 0);
			u.uJitter.value.set(this._eff(L.jitter), 0, 0, 0);
			u.uGlitch.value.set(this._eff(L.glitch), L.glitch.slices, 0, 0);
			u.uCursor.value.set(this._eff(L.cursor), L.cursor.radius, L.cursor.mode === 'attract' ? -1 : 1, 0);

			// Распад: взрыв, пока форма разрушена, и сборка дугами после
			{
				const P = L.physics;
				if (this.isCollapsed && P.on) {
					this.asm = 0;
					this.collapseTime += dt;
				} else if (this.collapseTime > 0) {
					this.asm = Math.min(1, this.asm + dt / Math.max(0.5, P.asm));
					if (this.asm >= 1) {
						this.asm = 0;
						this.collapseTime = 0;
					}
				}
				u.uPhysics.value.set(this.collapseTime > 0 ? Math.max(0.01, this._eff(P)) : 0, P.gravity, P.bounce, P.wind);
				u.uPhysP.value.set(P.burst, P.peel, P.swirl, 0);
				u.uAsm.value = this.asm;
				u.uCollapseTime.value = this.collapseTime;
			}

			// Кисть
			const brE = Math.max(L.brush ? this._eff(L.brush) : 0, this.camTracker?.running && this._time - (this._brushHand ?? -9) < 0.4 ? 1 : 0);
			const brArr = u.uBrushHits.value;
			for (let i = 0; i < 20; i++) {
				const hit = this.brushHits[i];
				const age = hit ? this._time - hit.t0 : -1;
				if (hit && age < (L.brush ? L.brush.dry : 3.5)) {
					brArr[i].set(hit.pos.x, hit.pos.y, hit.pos.z, age);
				} else {
					brArr[i].set(0, 0, 0, -1);
				}
			}
			u.uBrushParam.value.set(brE, L.brush ? L.brush.radius : 0.4, L.brush ? L.brush.dry : 3.5, 1);

			// Срез / Изолинии
			const sl = L.slice;
			const nLines = Math.max(1, Math.round(sl.count || 1));
			const axVal = { y: 0, x: 1, z: 2, diag: 3 }[sl.axis] ?? 0;
			const smode = { laser: 0, relief: 1, cut: 2 }[sl.mode] ?? 0;
			let sph = (this._time * sl.speed * 0.25) % 1;
			if (sl.bounce === 'on') {
				const x = (this._time * sl.speed * 0.2) % 2;
				sph = x < 1 ? x : 2 - x;
			}
			if (smode === 2) sph = sph * 1.1 - 0.05;
			u.uSlice.value.set(this._eff(sl), sph, sl.width, axVal + nLines * 10);
			u.uSliceM.value.set(smode, sl.lift, 0, 0);
			u.uSliceC.value.set(sl.color && sl.color !== 'auto' ? sl.color : pal.c[2]);

			// Look P2 & DoF
			u.uLookP2.value.set(look.sizeNoise || 0, look.sizeAudio || 0, 0, 0);
			u.uDof.value.set(look.dofOn ? 1 : 0, look.dofDist || 5.2, look.dofRange || 1.4, 0);

			// фото и видео: обновляем цвета и высоту точек по текущему кадру
			if (st.source === 'media' && this.pm.ready && this.geometry && !this.morphing && this.geometry.attributes.position.count === this.pm.count) {
				const rgb = this.pm.advance(dt);
				if (rgb) {
					const g = this.geometry;
					const n = this.pm.count;
					if (!this._zbuf || this._zbuf.length !== n * 3) this._zbuf = new Float32Array(n * 3);
					const m = this.app.settings.media;
					this.pm.applyTo({ positions: this._zbuf, colors: g.attributes.aColor.array }, rgb, m.relief, m.depth);
					const a = g.attributes.position.array, o = g.attributes.aOrigin.array, t = g.attributes.aTarget.array, z = this._zbuf;
					for (let i = 2; i < n * 3; i += 3) a[i] = o[i] = t[i] = z[i];
					g.attributes.aColor.needsUpdate = true;
					g.attributes.position.needsUpdate = g.attributes.aOrigin.needsUpdate = g.attributes.aTarget.needsUpdate = true;
				}
			}
			// морфинг по списку форм
			{
				const mc = st.morphCfg;
				const beatNew = this.levels.beat > 0.9 && (this._bPrev || 0) <= 0.9;
				this._bPrev = this.levels.beat;
				if ((this.playlist?.length || 0) > 1 && mc.mode !== 'manual' && !this.morphing) {
					const since = this._time - (this._lastMorph || 0);
					if ((mc.mode === 'timer' && since > mc.interval) || (mc.mode === 'beat' && beatNew && since > Math.min(mc.interval, 3))) this.morphNext();
				}
			}
			// растворение
			{
				const D = L.dissolve;
				let p = 0;
				if (D.on) {
					if (D.mode === 'loop') {
						this._disT = (this._disT || 0) + dt * D.speed * 0.25;
						const ph = this._disT % 2;
						const x = ph < 1 ? ph : 2 - ph;
						p = clamp((x - 0.12) / 0.76, 0, 1);
					} else if (D.mode === 'button') {
						const tg = this._disTarget ? 1 : 0;
						const v = this._disV || 0;
						this._disV = v + Math.sign(tg - v) * Math.min(Math.abs(tg - v), dt * D.speed * 0.3);
						p = this._disV;
					} else p = D.progress;
					p = p * p * (3 - 2 * p) * Math.min(1, D.amount);
				}
				const hand = this.camTracker?.running && this._handDis && this._time - (this._handsT ?? -9) < 0.4;
				this._disH = (this._disH || 0) + ((hand ? 1 : 0) - (this._disH || 0)) * (1 - Math.exp(-dt * Math.max(0.5, D.speed) * 1.2));
				if (this._disH > 0.002) p = Math.max(p, this._disH * this._disH * (3 - 2 * this._disH));
				u.uDis.value.set(p, { top: 0, noise: 1, bottom: 2 }[D.order] ?? 0, D.fall, D.wind);
				u.uDisT.value = D.turb;
			}
			// лепка: глина медленно возвращает форму
			if (this._sculptLive && this.geometry && !(this._grabs && this._grabs.size)) {
				const el = L.camTrack.elastic;
				if (el > 0) {
					const arr = this.geometry.attributes.aSculpt.array;
					const k = Math.exp(-dt * el * 0.8);
					let mx = 0;
					for (let i = 0; i < arr.length; i++) {
						arr[i] *= k;
						const a = arr[i] < 0 ? -arr[i] : arr[i];
						if (a > mx) mx = a;
					}
					this.geometry.attributes.aSculpt.needsUpdate = true;
					if (mx < 5e-4) this.clearSculpt();
				}
			}
			// гравитация: центр поля (курсор, рука или центр формы)
			{
				const g = L.gravity;
				const handG = this.camTracker?.running && this._handGrav && this._time - (this._handsT ?? -9) < 0.4;
				this._gravF = (this._gravF || 0) + ((handG ? 1 : 0) - (this._gravF || 0)) * (1 - Math.exp(-dt * 5));
				const ge = Math.max(this._eff(g), this._gravF * L.camTrack.amount);
				if (!this._gc) this._gc = new THREE.Vector3();
				const tgt = handG ? this._handGrav : g.target === 'cursor' && this.mouseOn ? this.mouse : new THREE.Vector3();
				this._gc.lerp(tgt, 1 - Math.exp(-dt * 8));
				this._gPrec = (this._gPrec || 0) + dt * g.precess * 1.2;
				const mode = { orbit: 0, hole: 1, float: 2, swarm: 3 }[g.mode] ?? 0;
				// диск и воронка сжимают точки в тесную область: приглушаем, чтобы не выгорало
				u.uDens.value /= 1 + Math.min(1, ge) * (mode === 0 ? g.flatten * 5 : mode === 1 ? 2 : mode === 3 ? 0.8 : 0);
				u.uGrav.value.set(ge, mode, g.speed, g.flatten);
				u.uGravT.value.set(g.tilt + Math.sin(this._gPrec) * 0.18 * g.precess, this._gPrec * 0.6, g.spread, g.jet);
				u.uGravP.value.set(this._gc.x, this._gc.y, this._gc.z, g.target === 'center' && !handG ? 4 : g.radius);
			}
			// живая форма
			const al = this._eff(L.alive);
			const hp = ((this._time * L.alive.bpm) / 60) % 1;
			const hEnv = Math.exp(-(((hp - 0.04) / 0.06) ** 2)) + 0.65 * Math.exp(-(((hp - 0.26) / 0.07) ** 2));
			u.uAlive.value.set(al, L.alive.breath, L.alive.lean, hEnv * L.alive.heart * 0.5);
			const cvs = this.app.viewport.canvas;
			u.uRes.value.set(Math.max(1, cvs.clientWidth), Math.max(1, cvs.clientHeight));
			u.uLinkW.value = L.links.width;
			// связи
			const lk = this._eff(L.links);
			if (this.linkObj) {
				this.linkObj.visible = lk > 0.01;
				const pulseOn = L.links.pulses === 'on' ? 1 : 0;
				const pSpeed = L.links.pulseSpeed || 1.6;
				u.uLink.value.set(lk * 1.1, L.links.range * (1 + this.levels.beat * 0.4), pSpeed, pulseOn);
			}
			// шлейф
			const ec = this._eff(L.echo);
			const eo = L.echo;
			const nG = Math.round(eo.copies);
			const beatK = this.levels.beat;
			this.ghosts.forEach((g, i) => {
				const k = i + 1;
				g.visible = ec > 0.01 && k <= nG;
				if (!g.visible) return;
				g.material.uniforms.uTOff.value = eo.delay * k;
				g.material.uniforms.uGhost.value = ec * 0.55 * Math.pow(eo.fade, k);
				if (eo.mode === 'kaleido') {
					g.rotation.set(0, (Math.PI * 2 * k) / (nG + 1) + this._time * 0.15, 0);
					g.scale.set(k % 2 ? -1 : 1, 1, 1);
					g.position.set(0, 0, 0);
				} else if (eo.mode === 'spiral') {
					g.rotation.set(0, k * eo.spread * (1 + beatK * 0.25), 0);
					g.scale.setScalar(1 - 0.05 * k);
					g.position.set(0, k * 0.04 * Math.sin(this._time * 0.8), 0);
				} else {
					g.rotation.set(0, 0, 0);
					g.scale.setScalar(1);
					g.position.set(0, 0, 0);
				}
			});
			// зона действия
			const mk = st.mask;
			const mi = Math.max(0, MASK_MODES.findIndex((m) => m.id === mk.mode));
			const T = this._time * mk.speed;
			let a0 = 0, a1 = 0, a2 = 0;
			if (mi === 1) a0 = mk.speed > 0 ? clamp(1 - mk.size + 0.35 * Math.sin(T * 1.2), 0, 1) : 1 - mk.size;
			else if (mi === 4) a0 = mk.speed > 0 ? (T * 0.3) % 1 : 0.5;
			else if (mi === 2) {
				if (mk.speed > 0) {
					a0 = Math.cos(T) * 0.9;
					a1 = Math.sin(T * 0.7) * 0.6;
					a2 = Math.sin(T) * 0.9;
				} else {
					a0 = 0.55;
					a1 = 0.25;
					a2 = 0.4;
				}
			}
			u.uMask.value.set(mi, mk.size, mk.soft, mk.invert ? 1 : 0);
			u.uMaskA.value.set(a0, a1, a2, T * 0.5);
			u.uMaskShow.value = mk.show ? 1 : 0;
			u.uMouse.value.copy(this.mouse);
			u.uMouseOn.value = this.mouseOn ? 1 : 0;
			// руки: кончики пальцев как точки воздействия на форму
			{
				const cfg = L.camTrack;
				const running = !!this.camTracker?.running;
				const fade = clamp(1 - (this._time - (this._handsT ?? -9)) / 0.35, 0, 1);
				const ptrs = running ? this._handPtrs || [] : [];
				const n = Math.min(12, ptrs.length);
				const arr = u.uHand.value;
				for (let i = 0; i < 12; i++) {
					if (i < n) arr[i].set(ptrs[i].local.x, ptrs[i].local.y, ptrs[i].local.z, ptrs[i].s * fade);
					else arr[i].set(0, 0, 0, 0);
				}
				const he = running && cfg.on ? cfg.amount * cfg.power : 0;
				u.uHandP.value.set(fade > 0 ? he : 0, cfg.radius, 0, n);
				// вращение руками: скорость затухает с инерцией, когда щипок отпущен
				const sp = this._spin;
				if (sp && running) {
					if (this._time - (this._grabbing ?? -9) > 0.15) {
						const k = Math.exp(-dt * (1 - cfg.inertia) * 8);
						sp.x *= k;
						sp.y *= k;
					}
					this.points.rotation.y += sp.y * dt;
					this.points.rotation.x += sp.x * dt;
				}
				const target = running ? this._stretchTarget || 1 : 1;
				const sc = this.points.scale.x;
				if (Math.abs(sc - target) > 0.002) this.points.scale.setScalar(sc + (target - sc) * (1 - Math.exp(-dt * 6)));
			}
			// камера: если рука пропала, курсор отпускает форму
			if (this.camTracker?.running && this.mouseOn && this._time - (this._moveT ?? -9) > 1 && this._time - (this._camT ?? -9) > 0.7) this.mouseOn = false;
			// трекер-точки: рамки и касание формы работают от одних и тех же узлов
			if (this.hud) {
				this.hud.clear();
				const T = L.tracking;
				const tr = this._eff(T);
				const touchMode = { bump: 0, swirl: 1, pull: 2, push: 3, ripple: 4, melt: 5, scatter: 6, vanish: 7 }[T.touch];
				const ct = touchMode === undefined ? 0 : tr * T.force;
				const n = tr > 0.001 ? Math.min(16, Math.round(T.count)) : 0;
				let tgs = null;
				if (T.follow === 'pointer') {
					if (this.camTracker?.running && this._handPtrs?.length && this._time - (this._handsT ?? -9) < 0.4) tgs = this._handPtrs.map((q) => q.local);
					else if (this.mouseOn) tgs = [this.mouse];
				}
				this.hud.update(n, this.geometry, this.morph, this.levels, dt, tgs);
				const hex = (c) => '#' + new THREE.Color(c).getHexString(THREE.SRGBColorSpace);
				const cols = [hex(pal.c[0]), hex(pal.c[2])];
				if (T.on) this.hud.drawTracking(T, tr, { points: this.points, camera: this.app.viewport.camera, levels: this.levels, colors: T.color && T.color !== 'auto' ? [T.color, T.color] : cols });
				if (look.hud) this.hud.drawTelemetry({ audioWave: look.hudSpectrum ? 'on' : 'off' }, 1, { levels: this.levels, spec: this.spec, colors: cols });
				if (this.camTracker?.running) {
					const cv = this.app.viewport.canvas;
					if (this._hands?.length && this._time - (this._handsT ?? -9) < 0.35) {
						this.hud.drawHands(this._hands, cv.clientWidth, cv.clientHeight, cols[1], L.camTrack.skeleton === 'on');
					} else if (this.mouseOn && this._time - (this._camT ?? -9) < 0.7 && !(this.camTracker instanceof HandTracker)) {
						const v = this.mouse.clone();
						this.points.localToWorld(v);
						v.project(this.app.viewport.camera);
						this.hud.drawCursor((v.x * 0.5 + 0.5) * cv.clientWidth, (1 - (v.y * 0.5 + 0.5)) * cv.clientHeight, this._camActive ? 1 : 0.4, cols[1]);
					}
				}
				const arr = u.uTrk.value;
				for (let i = 0; i < 16; i++) {
					const it = this.hud.items[i];
					if (it && i < n) arr[i].set(it.pos.x, it.pos.y, it.pos.z, ct > 0 ? it.touch : 0);
					else arr[i].set(0, 0, 0, 0);
				}
				const imp = u.uImp.value;
				let ni = 0;
				if (T.memory > 0.05 && ct > 0.001) {
					for (const m of this.hud.imprints) {
						const s0 = Math.exp(-(this._time - m.t0) / T.memory) * m.s;
						if (s0 > 0.02 && ni < 32) imp[ni++].set(m.pos.x, m.pos.y, m.pos.z, s0);
					}
				}
				for (let i = ni; i < 32; i++) imp[i].set(0, 0, 0, 0);
				this.hud.time = this._time;
				u.uContact.value.set(ct, T.radius, touchMode ?? 0, n);
				const mkMode = { none: 0, invert: 1, rainbow: 2, hole: 3, lens: 4, pixel: 5, glow: 6 }[T.mark] ?? 0;
				u.uMark.value.set(n > 0 ? mkMode : 0, T.radius, Math.min(1, tr), 0);
				u.uMarkC.value.set(T.color && T.color !== 'auto' ? T.color : pal.c[2]);
				u.uShockP.value.z = ni;
			}
			// ударные волны
			const shE = Math.max(this._eff(L.shock), this._time - (this._waveT ?? -9) < 5 ? 0.9 : 0);
			if (L.shock.on && L.shock.auto === 'on' && this._time > (this._nextShock || 0) && this.geometry) {
				this._nextShock = this._time + 2.2 + Math.random() * 1.6;
				this.addShock(this.hud ? this.hud._pick(this.geometry, this.morph) : null);
			}
			const sh = u.uShock.value;
			for (let i = 0; i < 4; i++) {
				const s0 = this.shocks[i];
				const age = s0 ? this._time - s0.t0 : -1;
				if (s0 && age < 5) sh[i].set(s0.pos.x, s0.pos.y, s0.pos.z, age);
				else sh[i].set(0, 0, 0, -1);
			}
			u.uShockP.value.set(shE, L.shock.speed, u.uShockP.value.z, 0);
			this.onFrame && this.onFrame(this.levels);
			this.app.viewport.invalidate();
		};
		this._raf = requestAnimationFrame(tick);
	}

	// ------------------------------------------------------------ запись видео
	startRecording() {
		if (this.recording || !window.MediaRecorder) {
			if (!window.MediaRecorder) this.app.toast('Этот браузер не умеет записывать видео', 'warn');
			return;
		}
		this._ensureCtx();
		const stream = this.app.viewport.canvas.captureStream(60);
		this.recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
		const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
		const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 });
		const chunks = [];
		rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		rec.onstop = () => {
			downloadBlob(new Blob(chunks, { type: 'video/webm' }), 'effects.webm');
			this.app.toast('Видео сохранено: effects.webm', 'ok');
		};
		rec.start(250);
		this._rec = rec;
		this.recording = true;
		this._recT0 = performance.now();
		this.emit();
	}

	stopRecording() {
		if (!this.recording) return;
		this.recording = false;
		try {
			this._rec.stop();
		} catch (e) {
			/* уже остановлена */
		}
		this._rec = null;
		this.emit();
	}
}
