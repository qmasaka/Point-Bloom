/**
 * Движок эффектов для облака точек. Идея взята из TouchDesigner (POP): цепочка независимых «операторов»
 * (шум, спектр, волны, скручивание, пульс, воксели, дрожь, курсор), каждый из которых можно включить,
 * настроить и привязать к полосе звука (бас, середина, верх, бит). Вся геометрия считается на видеокарте.
 */
import * as THREE from 'three';
import { makeCamMovable } from './fx-cam-float.js';
import { loadJSON, saveJSON, mergeDeep, downloadBlob, clamp } from './util.js';
import { buildFrameBlock, writeFrameColors, writeOneFrame, frameGrid } from './frame-block.js';
import { TrackerHud } from './fx-hud.js';
import { HandTracker } from './hand-tracker.js';
import { evalAnimPoints } from './anim-controller.js';
import { perf } from './perf.js';
import { DepthAI, grabFrame, grabRGB as grabRGB4, normalizeDepth, lumaDepth, depthToGrid, adjustDepth } from './depth-ai.js';
import { encodeGIF } from './gif-encoder.js';

// ───────────────────────────────────────────────────────────── описания

export const FX_SHAPES = [
	{ id: 'model', name: 'Модель', icon: 'cube' },
	{ id: 'media', name: 'Фото', icon: 'image' },
	{ id: 'sphere', name: 'Сфера', icon: 'sphere' },
	{ id: 'torus', name: 'Тор', icon: 'target' },
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
	{ id: 'custom', label: 'Своя', title: 'Свой диапазон частот: выберите его на полоске спектра' },
];

/** Настройки реакции на звук, общие для всех эффектов: усиление или включение по порогу, диапазон частот, скорость нарастания и спада */
export const AUDIO_DEF = { amode: 'amp', lo: 0.05, hi: 0.3, thr: 0.5, atk: 0.03, rel: 0.35 };
/** Диапазоны готовых полос на оси спектра (0..1), как их считает движок */
export const BAND_RANGE = { bass: [0, 0.3], mid: [0.3, 0.67], high: [0.67, 1] };
/** Быстрые диапазоны для выбора на полоске спектра */
export const FREQ_QUICK = [['Бочка', 40, 130], ['Бас', 60, 300], ['Голос', 300, 3400], ['Тарелки', 5000, 14000]];

/** Действия, которые можно назначить жесту руки */
export const FX_ACTIONS = [['none', 'Ничего'], ['push', 'Отталкивать'], ['pull', 'Притягивать'], ['swirl', 'Вихрь'], ['rotate', 'Крутить форму'], ['sculpt', 'Лепить'], ['gravity', 'Гравитация у руки'], ['wave', 'Ударная волна'], ['break', 'Распад, пока держишь'], ['dissolve', 'Растворение, пока держишь'], ['brush', 'Светящийся след'], ['slicecut', 'Срез рукой: плоскость за ладонью'], ['fx:curl', 'Эффект: Вихри'], ['fx:wave', 'Эффект: Волны'], ['fx:pulse', 'Эффект: Пульс'], ['fx:twist', 'Эффект: Деформация'], ['fx:blast', 'Эффект: Взрыв по биту'], ['fx:flow', 'Эффект: Течение'], ['fx:voxel', 'Эффект: Воксели'], ['fx:glitch', 'Эффект: Глитч'], ['fx:links', 'Эффект: Связи'], ['fx:slice', 'Эффект: Срез'], ['fx:echo', 'Эффект: Шлейф']];

/** Слои-операторы. group: раздел в левой панели; extras: дополнительные параметры; relink: пересобрать связи */
export const FX_LAYERS = [
	{ id: 'frames', group: 'Видео', name: 'Раскадровка', icon: 'film-strip', hint: 'Видео раскладывается на кадры из точек, кадры собираются в блок. Показ идёт за таймлайном', max: 1, def: { on: false, amount: 1, band: 'none', react: 0, layout: 'stack', all: 'off', frames: 24, budget: 300000, depth: 1.6, source: 'whole', step: 0.3, thin: 0, showMode: 'off', showLen: 0.12, hero: 150000, future: 'hide', gain: 1, sat: 0, bsize: 1.5, track: 'grow', tone: 'all', toneCut: 0.5, tail: 100, tailSoft: 0.6 }, extras: [{ type: 'title', label: 'Раскладка' }, { key: 'layout', label: 'Как расставить кадры', type: 'select', options: [['stack', 'Стопка вглубь'], ['wall', 'Стена кадров'], ['film', 'Плёнка: кадры в ряд, текущий в центре'], ['tunnel', 'Туннель: прошлые кадры уменьшаются вглубь']], relayout: true }, { key: 'track', label: 'Что в стопке', type: 'seg', options: [['grow', 'Пройденное'], ['full', 'Весь ряд']], when: ['layout', ['stack', 'tunnel']] }, { key: 'depth', label: 'Глубина', min: 0.2, max: 4, step: 0.1, relayout: true, when: ['layout', ['stack', 'tunnel']] }, { type: 'title', label: 'Показ' }, { key: 'showMode', label: 'Как показывать', type: 'select', options: [['off', 'Обычно: все кадры как есть'], ['peel', 'Листание: пройденные улетают к зрителю'], ['projector', 'Луч: светлый участок идёт по ряду'], ['trail', 'Шлейф: за кадром тянется цветной след']] }, { key: 'showLen', label: 'Ширина луча и длина шлейфа', min: 0.02, max: 0.5, step: 0.01, when: ['showMode', ['projector', 'trail']] }, { key: 'future', label: 'Кадры впереди текущего', type: 'seg', options: [['show', 'Видны'], ['dim', 'Редкие'], ['hide', 'Скрыты']], when: ['showMode', ['off']] }, { key: 'thin', label: 'Прореживать остальные кадры', min: 0, max: 1, step: 0.05, when: ['showMode', ['off']] }, { type: 'title', label: 'Хвост' }, { key: 'tail', label: 'Длина хвоста, доля видео', min: 5, max: 100, step: 1, int: true, unit: '%' }, { key: 'tailSoft', label: 'Как гаснет хвост: резко ... плавно', min: 0, max: 1, step: 0.05 }, { type: 'title', label: 'Цвет остальных кадров' }, { key: 'sat', label: 'Насыщенность (0 это цвета видео)', min: -1, max: 1, step: 0.05 }, { key: 'gain', label: 'Яркость', min: 0.4, max: 3, step: 0.05 }, { key: 'tone', label: 'Какие тона оставить', type: 'seg', options: [['all', 'Все'], ['light', 'Светлые'], ['dark', 'Тёмные']] }, { key: 'toneCut', label: 'Граница светлого и тёмного', min: 0.05, max: 0.95, step: 0.01, when: ['tone', ['light', 'dark']] }, { key: 'bsize', label: 'Размер точек', min: 0.5, max: 4, step: 0.1 }, { type: 'title', label: 'Детализация' }, { key: 'hero', label: 'Точек в текущем кадре', min: 0, max: 300000, step: 10000, int: true, log: false, hero: true }, { key: 'budget', label: 'Точек в остальных кадрах', min: 60000, max: 1500000, step: 10000, int: true, log: true, reframe: true }, { type: 'title', label: 'Кадры' }, { key: 'source', label: 'Откуда кадры', type: 'seg', options: [['whole', 'Всё видео'], ['live', 'Бегущая лента']], reframe: true }, { key: 'all', label: 'Сколько кадров', type: 'seg', options: [['off', 'Выбрать'], ['on', 'Все кадры']], reframe: true, when: ['source', ['whole']] }, { key: 'frames', label: 'Кадров в блоке', min: 4, max: 120, step: 1, int: true, reframe: true, when: ['all', ['off']] }, { key: 'step', label: 'Скорость ленты, с на кадр', min: 0.1, max: 2, step: 0.05, when: ['source', ['live']] }] },
	{ id: 'curl', group: 'Движение', name: 'Вихри', icon: 'tornado', hint: 'Точки отрываются от формы и плывут. Виды: вихри, поток с возвратом, кольца (слои вращаются в разные стороны)', max: 2, def: { on: false, amount: 1, band: 'bass', react: 0.6, scale: 1.8, speed: 1, mode: 'noise', flow: 0.8 }, extras: [{ key: 'mode', label: 'Вид', type: 'seg', options: [['noise', 'Вихри'], ['stream', 'Поток и возврат'], ['orbit', 'Кольца: слои вращаются']] }, { key: 'scale', label: 'Масштаб вихрей', min: 0.5, max: 4, step: 0.1 }, { key: 'speed', label: 'Скорость', min: 0.1, max: 3, step: 0.05 }, { key: 'flow', label: 'Направление потока', min: 0, max: 6.28, step: 0.1, when: ['mode', ['stream']] }] },
	{ id: 'physics', group: 'Движение', name: 'Распад', icon: 'atom', hint: 'Форма раскалывается, осколки падают на пол с отскоками и собираются обратно', max: 2, def: { on: false, amount: 1.0, band: 'none', react: 0, gravity: 1.2, bounce: 0.3, wind: 0, burst: 1, peel: 0.6, swirl: 0.5, asm: 2.2 }, extras: [{ key: 'burst', label: 'Сила взрыва', min: 0.2, max: 2.5, step: 0.05 }, { key: 'peel', label: 'Расслоение (сверху вниз)', min: 0, max: 1, step: 0.05 }, { key: 'swirl', label: 'Закрутка осколков', min: 0, max: 2, step: 0.05 }, { key: 'gravity', label: 'Гравитация', min: 0.2, max: 3.0, step: 0.1 }, { key: 'bounce', label: 'Упругость пола', min: 0.1, max: 0.9, step: 0.05 }, { key: 'wind', label: 'Ветер', min: -1.5, max: 1.5, step: 0.1 }, { key: 'asm', label: 'Время сборки, с', min: 0.6, max: 6, step: 0.1 }] },
	{ id: 'spectrum', group: 'Движение', name: 'Спектр', icon: 'equalizer', hint: 'Форма отзывается на звук. Виды: колонки эквалайзера, горный рельеф, шерсть по кругу, шерсть по высоте', max: 2, def: { on: false, amount: 0.9, band: 'none', react: 0, mode: 'bars', bars: 24 }, extras: [{ key: 'mode', label: 'Вид', type: 'select', options: [['bars', 'Колонки эквалайзера'], ['terrain', 'Горный рельеф'], ['wool', 'Шерсть по кругу'], ['height', 'Шерсть по высоте']] }, { key: 'bars', label: 'Число колонок', min: 8, max: 64, step: 1, int: true, when: ['mode', ['bars']] }] },
	{ id: 'wave', group: 'Движение', name: 'Волны', icon: 'waves', hint: 'Волны бегут по форме. Виды: капли, кольца, плоская волна, спираль вокруг формы, гребни вверх', max: 2, def: { on: false, amount: 0.7, band: 'none', react: 0.8, freq: 5, speed: 1, period: 1.4, mode: 'rings', origin: 'center', decay: 1.2, dir: 0 }, extras: [{ key: 'mode', label: 'Вид', type: 'select', options: [['drops', 'Капли по биту'], ['rings', 'Кольца непрерывно'], ['plane', 'Плоская волна'], ['spiral', 'Спираль вокруг формы'], ['rise', 'Гребни поднимаются вверх']] }, { key: 'freq', label: 'Масштаб (частота)', min: 1, max: 14, step: 0.5 }, { key: 'speed', label: 'Скорость', min: 0.2, max: 3, step: 0.05 }, { key: 'origin', label: 'Откуда', type: 'seg', options: [['center', 'Центр'], ['cursor', 'Курсор, рука']], when: ['mode', ['rings']] }, { key: 'period', label: 'Капля раз в, с', min: 0.3, max: 4, step: 0.1, when: ['mode', ['drops']] }, { key: 'decay', label: 'Затухание', min: 0.2, max: 4, step: 0.1, when: ['mode', ['drops']] }, { key: 'dir', label: 'Направление', min: 0, max: 6.28, step: 0.1, when: ['mode', ['plane']] }] },
	{ id: 'twist', group: 'Движение', name: 'Деформация', icon: 'wind', hint: 'Форма меняет очертания. Виды: скрутка, изгиб, конус, змейка, дыхание, желе', max: 2, def: { on: false, amount: 1, band: 'none', react: 0, mode: 'twist', speed: 0, jmode: 'auto', jperiod: 1.8, jfreq: 8, jdamp: 1.6, jsquash: 0.5 }, extras: [{ key: 'mode', label: 'Вид', type: 'select', options: [['twist', 'Скрутка'], ['bend', 'Изгиб'], ['taper', 'Конус'], ['snake', 'Змейка'], ['breathe', 'Дыхание'], ['jelly', 'Желе: упругая дрожь']] }, { key: 'speed', label: 'Покачивание', min: 0, max: 3, step: 0.05, when: ['mode', ['twist', 'bend', 'taper', 'snake', 'breathe']] }, { key: 'jmode', label: 'Что вызывает дрожь', type: 'seg', options: [['auto', 'Сама по таймеру'], ['motion', 'Движение модели']], when: ['mode', ['jelly']] }, { key: 'jperiod', label: 'Толчок раз в, с', min: 0.4, max: 5, step: 0.1, when: ['mode', ['jelly']] }, { key: 'jfreq', label: 'Частота дрожи', min: 3, max: 16, step: 0.5, when: ['mode', ['jelly']] }, { key: 'jdamp', label: 'Затухание', min: 0.5, max: 5, step: 0.1, when: ['mode', ['jelly']] }, { key: 'jsquash', label: 'Сплющивание', min: 0, max: 1, step: 0.05, when: ['mode', ['jelly']] }] },
	{ id: 'blast', group: 'Движение', name: 'Взрыв', icon: 'asterisk', hint: 'Точки отлетают и пружинят обратно, или форма бьётся, как сердце. Виды: взрыв, пульс оболочкой, сжатием, всей формой сразу', max: 2, def: { on: false, amount: 1, band: 'none', react: 0, style: 'burst', decay: 2.2, random: 0.6, period: 1.6, delay: 0.35, pspeed: 1 }, extras: [{ key: 'style', label: 'Вид', type: 'select', options: [['burst', 'Взрыв: точки отлетают и пружинят'], ['shell', 'Пульс: бегущая оболочка'], ['squash', 'Пульс: сжатие и растяжение'], ['flat', 'Пульс: вся форма сразу']] }, { key: 'period', label: 'Бьёт сам раз в, с', min: 0.4, max: 5, step: 0.1 }, { key: 'decay', label: 'Возврат (пружина)', min: 0.8, max: 6, step: 0.1, when: ['style', ['burst']] }, { key: 'random', label: 'Разброс направлений', min: 0, max: 1, step: 0.05, when: ['style', ['burst']] }, { key: 'delay', label: 'Задержка к краю', min: 0, max: 1, step: 0.02, when: ['style', ['shell', 'squash']] }, { key: 'pspeed', label: 'Скорость затухания', min: 0.3, max: 3, step: 0.05, when: ['style', ['shell', 'squash', 'flat']] }] },
	{ id: 'flow', group: 'Движение', name: 'Течение', icon: 'path', hint: 'Точки скользят вдоль формы по линиям потока, а силуэт не меняется. Настраиваются масштаб, скорость и поворот потока', max: 2, def: { on: false, amount: 1, band: 'none', react: 0, scale: 1.6, speed: 1, dir: 0 }, extras: [{ key: 'scale', label: 'Масштаб течений', min: 0.4, max: 4, step: 0.1 }, { key: 'speed', label: 'Скорость', min: 0.1, max: 3, step: 0.05 }, { key: 'dir', label: 'Поворот потока', min: 0, max: 6.28, step: 0.1 }] },
	{ id: 'explode', group: 'Превращения', name: 'Разбор на части', icon: 'cube', hint: 'Форма разъезжается на жёсткие куски, они поворачиваются и возвращаются на место. Настраиваются число кусков, дальность и вращение', max: 1.5, def: { on: false, amount: 1, band: 'none', react: 0, mode: 'loop', speed: 0.8, pieces: 40, dist: 1, spin: 0.5, stagger: 0.5 }, extras: [{ key: 'mode', label: 'Запуск', type: 'seg', options: [['loop', 'Цикл'], ['hold', 'Всегда разобрана']] }, { key: 'pieces', label: 'Число кусков', min: 6, max: 256, step: 1, int: true }, { key: 'dist', label: 'Как далеко расходятся', min: 0.2, max: 3, step: 0.05 }, { key: 'spin', label: 'Вращение кусков', min: 0, max: 1, step: 0.05 }, { key: 'stagger', label: 'Разброс по времени', min: 0, max: 0.9, step: 0.05 }, { key: 'speed', label: 'Скорость', min: 0.1, max: 3, step: 0.1, when: ['mode', ['loop']] }] },
	{ id: 'dissolve', group: 'Движение', name: 'Растворение', icon: 'snowflake', hint: 'Форма исчезает и собирается обратно. Виды: лазерный срез, слои, блоки, песок, воронка, взрыв, горение, ветер, росток', max: 1, def: { on: false, amount: 1, band: 'none', react: 0, mode: 'loop', dir: 'both', order: 'top', style: 'laser', speed: 0.8, progress: 0.4, fall: 0.8, wind: 0.5, turb: 0.35, scatter: 1, edge: 0.32, glow: 0.35, shrink: 0.85, seed: 'bottom', tendril: 0.6, bud: 0.7 }, extras: [{ type: 'title', label: 'Как растворяется' }, { key: 'style', label: 'Вид', type: 'select', options: [['laser', 'Лазерный срез: линия проходит сквозь форму'], ['layers', 'Слои: полосы съезжают в стороны'], ['chunks', 'Блоки: рассыпается кусками'], ['sand', 'Песок: осыпается на пол'], ['vortex', 'Воронка: закручивает в центр'], ['shock', 'Взрыв: волна от центра'], ['burn', 'Горение: пепел поднимается'], ['wind', 'Ветер: уносит потоком'], ['sprout', 'Росток: прорастает и увядает']] }, { key: 'seed', label: 'Откуда растёт', type: 'select', options: [['bottom', 'Снизу вверх, как стебель'], ['point', 'Из случайной точки'], ['center', 'Из центра наружу']], when: ['style', ['sprout']] }, { key: 'order', label: 'Откуда начинается', type: 'select', when: ['style', ['laser', 'layers', 'chunks', 'sand', 'vortex', 'shock', 'burn', 'wind']], options: [['top', 'Сверху вниз'], ['bottom', 'Снизу вверх'], ['side', 'Слева направо'], ['center', 'Из центра наружу'], ['edges', 'С краёв к центру'], ['noise', 'Пятнами']] }, { type: 'title', label: 'Запуск' }, { key: 'mode', label: 'Запуск', type: 'seg', options: [['loop', 'Цикл'], ['button', 'Кнопкой'], ['slider', 'Ползунок']] }, { key: 'dir', label: 'Что дольше', type: 'seg', options: [['both', 'Поровну'], ['out', 'Распад'], ['in', 'Сборка']], when: ['mode', ['loop']] }, { key: 'speed', label: 'Скорость', min: 0.1, max: 3, step: 0.1 }, { key: 'progress', label: 'Прогресс (для ползунка)', min: 0, max: 1, step: 0.01, when: ['mode', ['slider']] }, { type: 'title', label: 'Движение частиц' }, { key: 'scatter', label: 'Размах движения', min: 0.2, max: 2.5, step: 0.05 }, { key: 'fall', label: 'Падение вниз', min: 0, max: 2, step: 0.05 }, { key: 'wind', label: 'Ветер и закрутка', min: -2, max: 2, step: 0.1 }, { key: 'turb', label: 'Лёгкая турбулентность', min: 0, max: 2, step: 0.05 }, { type: 'title', label: 'Кромка и частицы' }, { key: 'edge', label: 'Ширина кромки распада', min: 0.1, max: 0.7, step: 0.02 }, { key: 'glow', label: 'Свечение кромки', min: 0, max: 1.5, step: 0.05 }, { key: 'shrink', label: 'Мельчание частиц', min: 0, max: 1, step: 0.05 }, { key: 'tendril', label: 'Усики (неровный фронт)', min: 0, max: 1, step: 0.05, when: ['style', ['sprout']] }, { key: 'bud', label: 'Почки на кромке', min: 0, max: 1.5, step: 0.05, when: ['style', ['sprout']] }] },
	{ id: 'voxel', group: 'Движение', name: 'Воксели', icon: 'squares-four', hint: 'Точки превращаются в кубики. Виды: сетка, лего, дыхание, волна, ступени, разлёт. Настраиваются размер и высота', max: 1, def: { on: false, amount: 0.6, band: 'none', react: 1, mode: 'grid', speed: 1, size: 1, height: 1 }, extras: [{ key: 'mode', label: 'Вид', type: 'select', options: [['grid', 'Сетка'], ['lego', 'Лего: столбики разной высоты'], ['breathe', 'Дыхание: сетка пульсирует'], ['wave', 'Волна: кубы поднимаются волной'], ['stairs', 'Ступени: террасы по высоте'], ['scatter', 'Разлёт: кубы дрожат на месте']] }, { key: 'size', label: 'Размер кубиков', min: 0.4, max: 2.5, step: 0.05 }, { key: 'height', label: 'Высота и размах', min: 0, max: 2, step: 0.05, when: ['mode', ['lego', 'wave', 'stairs', 'scatter']] }, { key: 'speed', label: 'Скорость', min: 0.2, max: 3, step: 0.05, when: ['mode', ['lego', 'breathe', 'wave', 'scatter']] }] },
	{ id: 'scope', group: 'Звук и ритм', name: 'Акселерограф', icon: 'heartbeat', hint: 'Перо самописца бежит от точки к точке по координатам модели и вычерчивает форму линией. Ещё не пройденные точки скрыты', max: 1, def: { on: false, amount: 0.7, band: 'none', react: 0.6, mode: 'draw', order: 'walk', dir: 'fwd', loop: 'loop', speed: 1, pens: 2, chaos: 0.6, trail: 0.5, detail: 6000, dim: 1, line: 1, width: 2.4, color: '#3dff7a', tint: 0.35, thick: 0.6, glow: 1, spark: 0 }, extras: [{ key: 'mode', label: 'Как рисует', type: 'select', options: [['draw', 'Вычерчивает: нарисованное остаётся'], ['comet', 'Комета: за пером тянется гаснущий след']] }, { key: 'order', label: 'Порядок обхода', type: 'select', options: [['walk', 'От точки к точке (ближайшая)'], ['up', 'Развёртка снизу вверх'], ['spin', 'Развёртка по кругу']] }, { key: 'dir', label: 'Направление', type: 'seg', options: [['fwd', 'Вперёд'], ['back', 'Назад']] }, { key: 'loop', label: 'В конце круга', type: 'seg', options: [['loop', 'Стирает и заново'], ['once', 'Остаётся']] }, { key: 'speed', label: 'Скорость пера', min: 0.1, max: 6, step: 0.05 }, { key: 'pens', label: 'Число перьев', min: 1, max: 8, step: 1, int: true }, { key: 'trail', label: 'Длина следа', min: 0.05, max: 1, step: 0.01, when: ['mode', ['comet']] }, { key: 'detail', label: 'Точек на пути', min: 300, max: 12000, step: 100, int: true, when: ['order', ['walk']] }, { key: 'chaos', label: 'Хаотичность пути', min: 0, max: 1, step: 0.02, when: ['order', ['walk']] }, { key: 'dim', label: 'Прятать ненарисованное', min: 0, max: 1, step: 0.02 }, { key: 'color', label: 'Цвет акселерографа', type: 'color' }, { key: 'line', label: 'Яркость линии', min: 0, max: 1, step: 0.02, when: ['order', ['walk']] }, { key: 'width', label: 'Толщина линии', min: 0.5, max: 8, step: 0.1, when: ['order', ['walk']] }, { key: 'tint', label: 'Окраска нарисованного', min: 0, max: 1, step: 0.02 }, { key: 'thick', label: 'Крупнее нарисованные точки', min: 0, max: 2, step: 0.05 }, { key: 'glow', label: 'Свечение пера', min: 0, max: 2, step: 0.05 }, { key: 'spark', label: 'Искры у пера', min: 0, max: 2, step: 0.05 }] },
	{ id: 'depth', group: 'Фото и видео', name: 'Объём по глубине', icon: 'mountains', hint: 'Фото или видео выдавливается объёмом по карте глубины. Виды: рельеф, ступени, дыхание, волна, рябь, карусель, разлёт слоёв', max: 1.5, def: { on: false, amount: 0.8, band: 'none', react: 0.6, mode: 'relief', src: 'ai', dir: 'near', focus: 0.5, zone: 0.12, bright: 0, contrast: 1, gamma: 1, blur: 0, speed: 1, layers: 6, sway: 0.35, view: 'photo', smooth: 0.5 }, extras: [{ key: 'mode', label: 'Как выдавливать', type: 'select', options: [['relief', 'Рельеф: ближнее выступает вперёд'], ['layers', 'Ступени: ровные плоскости по глубине'], ['breath', 'Дыхание: рельеф выдавливается и втягивается'], ['wave', 'Волна: рельеф вспухает бегущей волной'], ['ripple', 'Рябь: по рельефу расходятся круги'], ['twist', 'Карусель: слои поворачиваются по-разному'], ['burst', 'Разлёт: слои вылетают к зрителю и возвращаются']] }, { key: 'src', label: 'Откуда глубина', type: 'seg', options: [['ai', 'Нейросеть'], ['luma', 'По яркости']] }, { key: 'dir', label: 'Что выступает', type: 'seg', options: [['near', 'Ближнее'], ['far', 'Дальнее']] }, { key: 'focus', label: 'Глубина, что остаётся на месте', min: 0, max: 1, step: 0.01 }, { key: 'zone', label: 'Ширина зоны на месте', min: 0, max: 0.6, step: 0.01 }, { type: 'title', label: 'Правка карты глубины' }, { key: 'bright', label: 'Яркость карты', min: -0.5, max: 0.5, step: 0.01 }, { key: 'contrast', label: 'Контраст карты', min: 0.2, max: 3, step: 0.02 }, { key: 'gamma', label: 'Тени (гамма)', min: 0.3, max: 3, step: 0.02 }, { key: 'blur', label: 'Размытие карты', min: 0, max: 12, step: 1, int: true }, { type: 'title', label: 'Движение' }, { key: 'speed', label: 'Скорость', min: 0.1, max: 4, step: 0.05 }, { key: 'layers', label: 'Число слоёв', min: 2, max: 16, step: 1, int: true, when: ['mode', ['layers']] }, { key: 'sway', label: 'Покачивание', min: 0, max: 1, step: 0.02 }, { key: 'smooth', label: 'Плавность глубины', min: 0, max: 1, step: 0.02 }, { key: 'view', label: 'Что показывать', type: 'seg', options: [['photo', 'Кадр'], ['map', 'Карта'], ['heat', 'Цвет глубины']] }] },
	{ id: 'trail', group: 'Анимация', name: 'Шлейф', icon: 'stack', hint: 'За движущейся анимированной моделью остаются полупрозрачные копии прошлых поз. Настраиваются число копий и шаг между ними', max: 1, def: { on: false, amount: 0.6, band: 'none', react: 0.5, count: 8, step: 0.1, fade: 0.8, pts: 25000, size: 0.6, tint: 0, shrink: 0.35 }, extras: [{ key: 'count', label: 'Сколько копий в шлейфе', min: 2, max: 24, step: 1, int: true }, { key: 'step', label: 'Время между копиями, с', min: 0.03, max: 0.6, step: 0.01 }, { key: 'fade', label: 'Как быстро гаснут копии', min: 0.4, max: 0.97, step: 0.01 }, { key: 'shrink', label: 'Как мельчают копии', min: 0, max: 0.9, step: 0.02 }, { key: 'pts', label: 'Точек в копии', min: 5000, max: 80000, step: 1000, int: true }, { key: 'size', label: 'Размер точек', min: 0.3, max: 2.5, step: 0.05 }, { key: 'tint', label: 'Окраска цветом палитры', min: 0, max: 1, step: 0.02 }] },
	{ id: 'jitter', hidden: true, group: 'Движение', name: 'Дрожь', icon: 'waveform', hint: 'Мелкая вибрация на высоких частотах', max: 2, def: { on: false, amount: 0.7, band: 'high', react: 1 }, extras: [] },
	{ id: 'glitch', group: 'Движение', name: 'Глитч', icon: 'lightning', hint: 'Цифровой сбой. Виды: полосы, блоки, развёртка. Цвета расходятся, на всплесках часть точек выпадает', max: 2, def: { on: false, amount: 0.8, band: 'none', react: 1, mode: 'bands', slices: 16, rgb: 'on', speed: 1, burst: 0.7, drop: 0.5 }, extras: [{ key: 'mode', label: 'Вид сбоя', type: 'select', options: [['bands', 'Полосы: строки съезжают в стороны'], ['blocks', 'Блоки: куски сдвигаются в объёме'], ['scan', 'Развёртка: тонкие строки рвутся']] }, { key: 'slices', label: 'Число полос', min: 6, max: 40, step: 1, int: true }, { key: 'burst', label: 'Резкость всплесков', min: 0, max: 1, step: 0.05 }, { key: 'drop', label: 'Выпадение точек', min: 0, max: 1, step: 0.05 }, { key: 'rgb', label: 'Расхождение цветов', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'speed', label: 'Скорость', min: 0.2, max: 3, step: 0.05 }] },
	{ id: 'links', group: 'Графика', name: 'Связи', icon: 'share-network', hint: 'Светящиеся нити между соседними точками с бегущими огоньками. Настраиваются число узлов и дальность связи', max: 2, def: { on: false, amount: 1, band: 'beat', react: 0.5, range: 0.2, width: 1.8, count: 3500, pulses: 'on', pulseSpeed: 1.6 }, extras: [{ key: 'width', label: 'Толщина нитей', min: 0.6, max: 6, step: 0.2, unit: ' px' }, { key: 'range', label: 'Длина связей', min: 0.02, max: 0.5, step: 0.01 }, { key: 'count', label: 'Узлов', min: 500, max: 8000, step: 250, relink: true, int: true }, { key: 'pulses', label: 'Импульсы света', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'pulseSpeed', label: 'Скорость импульсов', min: 0.5, max: 4.0, step: 0.2 }] },
	{ id: 'slice', group: 'Графика', name: 'Срез', icon: 'scan', hint: 'По форме идёт срез. Виды: лазер (линии), рельеф (точки на линиях), развёртка (форма проявляется за плоскостью)', max: 2, def: { on: false, amount: 1, band: 'none', react: 0, mode: 'relief', speed: 0.5, width: 0.08, count: 4, axis: 'y', lift: 0.25, bounce: 'on', color: 'model' }, extras: [{ key: 'mode', label: 'Вид', type: 'seg', options: [['laser', 'Лазер'], ['relief', 'Рельеф'], ['cut', 'Развёртка']] }, { key: 'count', label: 'Число линий', min: 1, max: 12, step: 1, int: true }, { key: 'speed', label: 'Скорость', min: 0.05, max: 2, step: 0.05 }, { key: 'width', label: 'Толщина', min: 0.003, max: 0.3, step: 0.002 }, { key: 'lift', label: 'Высота рельефа', min: 0, max: 0.8, step: 0.01 }, { key: 'bounce', label: 'Движение', type: 'seg', options: [['on', 'Туда и обратно'], ['off', 'В одну сторону']] }, { key: 'color', label: 'Цвет линии', type: 'color', natural: true }, { key: 'axis', label: 'Ось', type: 'seg', options: [['y', 'Y'], ['x', 'X'], ['z', 'Z'], ['diag', 'Диаг.']] }] },
	{ id: 'feedback', group: 'Графика', name: 'Следы времени', icon: 'spiral', hint: 'Форма оставляет за собой световой хвост из прошлых кадров. Виды: выдержка, туннель', max: 1, def: { on: false, amount: 0.95, band: 'none', react: 0, mode: 'exposure', tint: 0.5, zoom: 1.004, twist: 0.002 }, extras: [{ key: 'mode', label: 'Вид следа', type: 'seg', options: [['exposure', 'Выдержка'], ['tunnel', 'Туннель']] }, { key: 'tint', label: 'Окрашивание хвоста', min: 0, max: 1, step: 0.05 }, { key: 'zoom', label: 'Зум туннеля', min: 0.98, max: 1.03, step: 0.002, when: ['mode', ['tunnel']] }, { key: 'twist', label: 'Спираль (угол)', min: -0.02, max: 0.02, step: 0.001, when: ['mode', ['tunnel']] }] },
	{ id: 'echo', group: 'Графика', name: 'Эхо', icon: 'ghost', hint: 'Призрачные копии формы. Виды: спираль, зеркала, ореол', max: 1.5, def: { on: false, amount: 0.8, band: 'beat', react: 0.5, mode: 'spiral', copies: 4, delay: 0.14, spread: 0.45, fade: 0.7 }, extras: [{ key: 'mode', label: 'Вид', type: 'seg', options: [['spiral', 'Спираль'], ['kaleido', 'Зеркала'], ['time', 'Ореол']] }, { key: 'copies', label: 'Копий', min: 1, max: 5, step: 1, int: true }, { key: 'spread', label: 'Угол между копиями', min: 0.05, max: 1.5, step: 0.05 }, { key: 'delay', label: 'Задержка, с', min: 0.02, max: 0.6, step: 0.01 }, { key: 'fade', label: 'Затухание копий', min: 0.3, max: 0.95, step: 0.05 }] },
	{ id: 'tracking', group: 'Взаимодействие', name: 'Трекинг', icon: 'bounding-box', hint: 'Рамки следят за точками формы и могут её касаться: подъём, вихрь, втягивание и другое', max: 1.5, def: { on: false, amount: 1, band: 'bass', react: 0.4, count: 8, size: 70, opacity: 1, speed: 1, shape: 'corners', fill: 'none', color: 'auto', thick: 1.5, labels: 'on', labelSize: 1, labelInfo: 'full', labelBg: 'off', lines: 'on', lineStyle: 'dashed', lineMode: 'nearest', lineWidth: 1, lineAlpha: 0.5, follow: 'wander', mark: 'none', touch: 'bump', force: 1, radius: 0.35, memory: 1.5 }, extras: [{ type: 'title', label: 'Рамки' }, { key: 'count', label: 'Сколько рамок', min: 2, max: 16, step: 1, int: true }, { key: 'size', label: 'Размер рамки', min: 8, max: 160, step: 1, int: true }, { key: 'opacity', label: 'Прозрачность рамок', min: 0.05, max: 1, step: 0.05 }, { key: 'speed', label: 'Скорость перемещения рамок', min: 0.1, max: 3, step: 0.05 }, { key: 'shape', label: 'Вид рамки', type: 'seg', options: [['corners', 'Углы'], ['box', 'Рамка'], ['circle', 'Круг'], ['cross', 'Прицел']] }, { key: 'fill', label: 'Заливка', type: 'seg', options: [['none', 'Нет'], ['tint', 'Тон'], ['hatch', 'Штрих']] }, { key: 'color', label: 'Цвет', type: 'color' }, { key: 'thick', label: 'Толщина линий', min: 0.5, max: 4, step: 0.25 }, { key: 'follow', label: 'Куда смотрят рамки', type: 'seg', options: [['wander', 'Бродят'], ['pointer', 'За руками']] }, { type: 'title', label: 'Подписи' }, { key: 'labels', label: 'Подписи', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'labelInfo', label: 'Что написано', type: 'select', options: [['full', 'Всё: номер, координаты, скорость'], ['id', 'Только номер'], ['conf', 'Номер и уверенность'], ['coords', 'Координаты X Y Z'], ['speed', 'Номер и скорость'], ['bars', 'Номер и шкалы'], ['dist', 'Расстояние до центра']], when: ['labels', ['on']] }, { key: 'labelSize', label: 'Масштаб текста', min: 0.5, max: 3, step: 0.1, when: ['labels', ['on']] }, { key: 'labelBg', label: 'Подложка под текст', type: 'seg', options: [['off', 'Нет'], ['on', 'Есть']], when: ['labels', ['on']] }, { type: 'title', label: 'Связи между рамками' }, { key: 'lines', label: 'Линии связи', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'lineMode', label: 'Кто с кем связан', type: 'select', options: [['nearest', 'Каждая с ближайшей'], ['chain', 'Цепочкой по порядку'], ['all', 'Все близкие друг с другом'], ['hub', 'Все к центру']], when: ['lines', ['on']] }, { key: 'lineStyle', label: 'Вид линии', type: 'select', options: [['dashed', 'Пунктир'], ['solid', 'Сплошная'], ['curve', 'Дуга'], ['elbow', 'Ломаная под прямым углом'], ['dots', 'Точки'], ['pulse', 'С бегущим огоньком']], when: ['lines', ['on']] }, { key: 'lineWidth', label: 'Толщина связей', min: 0.5, max: 4, step: 0.25, when: ['lines', ['on']] }, { key: 'lineAlpha', label: 'Яркость связей', min: 0.1, max: 1, step: 0.05, when: ['lines', ['on']] }, { type: 'title', label: 'Эффект в области рамок' }, { key: 'mark', label: 'Что происходит', type: 'select', options: [['none', 'Ничего'], ['invert', 'Негатив'], ['rainbow', 'Радуга'], ['hole', 'Дыра с пульсирующим краем'], ['lens', 'Лупа'], ['pixel', 'Пиксели'], ['glow', 'Свет']] }, { type: 'title', label: 'Касание формы' }, { key: 'touch', label: 'Действие', type: 'select', options: [['none', 'Нет'], ['bump', 'Подъём'], ['swirl', 'Вихрь'], ['pull', 'Втягивание'], ['push', 'Отталкивание'], ['ripple', 'Рябь'], ['melt', 'Таяние вниз'], ['scatter', 'Разлёт искрами'], ['vanish', 'Исчезновение']] }, { key: 'force', label: 'Сила касания', min: 0.2, max: 2, step: 0.05 }, { key: 'radius', label: 'Радиус области', min: 0.02, max: 0.9, step: 0.01 }, { key: 'memory', label: 'Память следа, с', min: 0, max: 6, step: 0.1 }] },
	{ id: 'cursor', group: 'Взаимодействие', name: 'Курсор', icon: 'cursor-click', hint: 'Мышь отталкивает или притягивает точки. Настраиваются радиус и действие', max: 2, def: { on: true, amount: 1, band: 'none', react: 0, radius: 0.9, mode: 'repel' }, extras: [{ key: 'radius', label: 'Радиус', min: 0.05, max: 2, step: 0.01 }, { key: 'mode', label: 'Действие', type: 'seg', options: [['repel', 'Отталкивать'], ['attract', 'Притягивать']] }] },
	{ id: 'brush', group: 'Взаимодействие', name: 'Кисть', icon: 'paint-brush', hint: 'Рисуйте по форме курсором: мазки светятся и со временем гаснут', max: 2, def: { on: false, amount: 1.0, band: 'none', react: 0, radius: 0.4, dry: 3.5 }, extras: [{ key: 'radius', label: 'Радиус кисти', min: 0.02, max: 0.9, step: 0.01 }, { key: 'dry', label: 'Высыхание, с', min: 1.0, max: 8.0, step: 0.5 }] },
	{ id: 'camTrack', group: 'Взаимодействие', name: 'Руки (камера)', icon: 'hand', hint: 'Камера видит руки, у каждого жеста своё действие: ладонь, кулак, щипок, указательный палец', max: 1.5, def: { on: false, amount: 1.0, band: 'none', react: 0, g_palm: 'push', g_fist: 'break', g_pinch: 'rotate', g_point: 'brush', g_peace: 'wave', g_rock: 'fx:glitch', g_thumb: 'gravity', power: 0.35, radius: 0.35, depth: 0.85, spin: 5, inertia: 0.6, axis: 'y', clay: 0.5, elastic: 0.6, stretch: 'off', keep: 'on', smooth: 0.5, sens: 0.6, hold: 0.12, skeleton: 'on', preview: 'on' }, extras: [{ type: 'title', label: 'Что делает жест' }, { key: 'g_palm', label: 'Ладонь (пальцы раскрыты)', type: 'select', options: FX_ACTIONS }, { key: 'g_fist', label: 'Кулак', type: 'select', options: FX_ACTIONS }, { key: 'g_pinch', label: 'Щипок (большой + указательный)', type: 'select', options: FX_ACTIONS }, { key: 'g_point', label: 'Указательный палец', type: 'select', options: FX_ACTIONS }, { key: 'g_peace', label: 'Два пальца (знак мира)', type: 'select', options: FX_ACTIONS }, { key: 'g_rock', label: 'Рога (указательный и мизинец)', type: 'select', options: FX_ACTIONS }, { key: 'g_thumb', label: 'Большой палец вверх', type: 'select', options: FX_ACTIONS }, { type: 'title', label: 'Касание пальцами' }, { key: 'power', label: 'Мощность', min: 0.05, max: 1.5, step: 0.05 }, { key: 'radius', label: 'Радиус', min: 0.02, max: 0.9, step: 0.01 }, { key: 'depth', label: 'Глубина касания', min: 0.1, max: 1.5, step: 0.05 }, { type: 'title', label: 'Вращение' }, { key: 'spin', label: 'Скорость', min: 1, max: 14, step: 0.5 }, { key: 'inertia', label: 'Инерция', min: 0, max: 0.98, step: 0.02 }, { key: 'axis', label: 'Оси', type: 'seg', options: [['y', 'Вокруг'], ['xy', 'Свободно']] }, { type: 'title', label: 'Лепка' }, { key: 'clay', label: 'Размер куска глины', min: 0.05, max: 1.2, step: 0.01 }, { key: 'elastic', label: 'Упругость (возврат формы)', min: 0, max: 3, step: 0.1 }, { type: 'title', label: 'Две руки' }, { key: 'stretch', label: 'Меняют размер формы', type: 'seg', options: [['off', 'Нет'], ['on', 'Да']] }, { key: 'keep', label: 'Запоминать размер', type: 'seg', options: [['on', 'Да'], ['off', 'Нет']] }, { type: 'title', label: 'Распознавание и показ' }, { key: 'smooth', label: 'Плавность', min: 0, max: 0.95, step: 0.05 }, { key: 'sens', label: 'Чувствительность', min: 0.1, max: 1, step: 0.05 }, { key: 'hold', label: 'Задержка жеста, с', min: 0, max: 0.5, step: 0.02 }, { key: 'skeleton', label: 'Руки на сцене', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'preview', label: 'Окно камеры', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }] },
	{ id: 'gravity', group: 'Взаимодействие', name: 'Гравитация', icon: 'planet', hint: 'Точки кружат вокруг центра. Виды: галактика, кольца, квазар (падение в центр и струи), рой, невесомость', max: 1, def: { on: false, amount: 0.8, band: 'none', react: 0.4, mode: 'orbit', target: 'center', radius: 2.4, speed: 1, tilt: 0.5, precess: 0.15, flatten: 0.6, jet: 1.4, spread: 0.5 }, extras: [{ key: 'mode', label: 'Вид поля', type: 'select', options: [['orbit', 'Галактика: диск со спиральными рукавами'], ['rings', 'Кольца: диск из вращающихся колец'], ['hole', 'Квазар: падение в центр и джеты'], ['swarm', 'Рой: у каждой точки своя орбита'], ['float', 'Невесомость: медленный дрейф']] }, { type: 'note', when: ['mode', ['orbit']], text: 'Форма раскручивается диском: у центра быстрее, на краю медленнее.' }, { type: 'note', when: ['mode', ['rings']], text: 'Форма раскладывается на круглые кольца, соседние вращаются в разные стороны, как у планеты с кольцами.' }, { type: 'note', when: ['mode', ['hole']], text: 'Точки по спирали падают в центр, а затем вылетают двумя струями вдоль оси.' }, { type: 'note', when: ['mode', ['swarm']], text: 'Каждая точка летает по своей наклонной орбите, получается шар из орбит, как у атома.' }, { type: 'note', when: ['mode', ['float']], text: 'Точки плавно покачиваются и расходятся, как в невесомости.' }, { type: 'title', label: 'Где центр' }, { key: 'target', label: 'Центр поля', type: 'seg', options: [['cursor', 'Курсор, рука'], ['center', 'Центр формы']] }, { key: 'radius', label: 'Радиус действия', min: 0.1, max: 3.5, step: 0.05 }, { type: 'title', label: 'Движение' }, { key: 'speed', label: 'Скорость', min: 0.2, max: 3, step: 0.1 }, { key: 'spread', label: 'Размах', min: 0, max: 1, step: 0.05, when: ['mode', ['swarm', 'float']] }, { key: 'flatten', label: 'Сплющивание в диск', min: 0, max: 0.95, step: 0.05, when: ['mode', ['orbit', 'hole', 'rings']] }, { key: 'tilt', label: 'Наклон диска', min: 0, max: 1.5, step: 0.05, when: ['mode', ['orbit', 'hole', 'rings']] }, { key: 'precess', label: 'Покачивание оси', min: 0, max: 1, step: 0.05, when: ['mode', ['orbit', 'hole', 'rings']] }, { key: 'jet', label: 'Длина струй', min: 0, max: 3, step: 0.1, when: ['mode', ['hole']] }] },
];

// разделы списка эффектов: логика по тому, что эффект делает
const FX_GROUPS = {
	'Видео': ['frames'],
	'Фото и видео': ['depth'],
	'Анимация': ['trail'],
	'Движение': ['curl', 'flow', 'gravity'],
	'Звук и ритм': ['spectrum', 'wave', 'blast', 'scope'],
	'Превращения': ['twist', 'voxel', 'glitch', 'physics', 'dissolve', 'explode'],
	'Графика': ['links', 'slice', 'feedback', 'echo'],
	'Управление': ['cursor', 'brush', 'tracking', 'camTrack'],
};
export const FX_GROUP_NAMES = Object.keys(FX_GROUPS);
{
	const rank = (l) => {
		for (const [gi, g] of FX_GROUP_NAMES.entries()) {
			const k = FX_GROUPS[g].indexOf(l.id);
			if (k >= 0) {
				l.group = g;
				return gi * 100 + k;
			}
		}
		return 999;
	};
	FX_LAYERS.sort((a, b) => rank(a) - rank(b));
}

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
	{ id: 'disp', label: 'Палитра', title: 'Цвета выбранной палитры: чем дальше точка улетела, тем ярче' },
	{ id: 'height', label: 'Высота', title: 'Градиент снизу вверх' },
	{ id: 'index', label: 'Разброс', title: 'Цвета перемешаны по точкам' },
	{ id: 'model', label: 'Текстура', title: 'Цвета из текстуры модели, как на вкладке «Точки»' },
	{ id: 'solid', label: 'Один цвет', title: 'Один цвет для всех точек' },
	{ id: 'normal', label: 'Нормали', title: 'Цвет по направлению поверхности' },
];

/** Что показываем в списке: «Высота» и «Разброс» дублировали палитры, поэтому убраны из интерфейса */
export const COLOR_BY_UI = COLOR_BY.filter((c) => ['disp', 'model', 'solid', 'normal'].includes(c.id));

export const MASK_MODES = [
	{ id: 'none', label: 'Везде', title: 'Эффекты действуют на всю форму' },
	{ id: 'height', label: 'Высота', title: 'Живёт верхняя часть, нижняя стоит' },
	{ id: 'sphere', label: 'Сфера', title: 'Живёт область внутри шара' },
	{ id: 'noise', label: 'Пятна', title: 'Живут плавающие пятна' },
	{ id: 'scan', label: 'Скан', title: 'Живёт полоса, которая пробегает по форме' },
];

/** Виды перехода между моделями: у каждого свои разумные настройки, их можно менять вручную */
export const MORPH_STYLES = [
	{ id: 'flow', name: 'Течение', icon: 'waves', hint: 'Точки перетекают из одной модели в другую плавными дугами', v: { scatter: 0.8, stagger: 0.35, turns: 1, sort: 'random', ease: 'smooth', glow: 0.4 } },
	{ id: 'swirl', name: 'Вихрь', icon: 'tornado', hint: 'Модель закручивается вихрем и раскручивается уже в новую форму', v: { scatter: 0.7, stagger: 0.3, turns: 1.2, sort: 'out', ease: 'soft', glow: 0.5 } },
	{ id: 'burst', name: 'Взрыв', icon: 'asterisk', hint: 'Модель взрывается на частицы, они падают на пол и лежат, потом собираются в новую модель', v: { scatter: 1.2, stagger: 0.25, turns: 1, sort: 'out', ease: 'smooth', glow: 0.7 } },
	{ id: 'scan', name: 'Сканер', icon: 'scan', hint: 'Линия сканера идёт по модели сверху вниз и на ходу собирает за собой новую форму', v: { scatter: 0.12, stagger: 2.2, turns: 1, sort: 'down', ease: 'smooth', glow: 1.0 } },
	{ id: 'dust', name: 'Пыль', icon: 'wind', hint: 'Старая форма поднимается облаком пыли, новая оседает из него', v: { scatter: 0.9, stagger: 0.55, turns: 1, sort: 'random', ease: 'soft', glow: 0.3 } },
	{ id: 'sand', name: 'Осыпание', icon: 'drop', hint: 'Точки осыпаются вниз, как песок, и снизу вырастает новая форма', v: { scatter: 0.9, stagger: 0.5, turns: 1, sort: 'down', ease: 'smooth', glow: 0.2 } },
];
export const MORPH_SORTS = [['random', 'Вразнобой'], ['up', 'Снизу вверх'], ['down', 'Сверху вниз'], ['out', 'От центра'], ['side', 'Слева направо']];
export const MORPH_EASES = [['smooth', 'Плавно'], ['soft', 'Очень мягко'], ['spring', 'С перелётом']];

export const SYNTH_STYLES = [
	{ id: 'deep', name: 'Спокойный: пады и арпеджио' },
	{ id: 'ambient', name: 'Эмбиент: дрейф' },
	{ id: 'jungle', name: 'Мягкий джангл, 150 BPM' },
];

function defaultState() {
	const layers = {};
	for (const l of FX_LAYERS) layers[l.id] = { ...AUDIO_DEF, ...l.def };
	return {
		source: 'sphere',
		count: 150000,
		layers,
		media: { pts: 80000, relief: 'bright', depth: 0.5 },
		morphCfg: { mode: 'manual', interval: 4, time: 2.6, order: 'seq', weight: 'auto', style: 'flow', scatter: 0.8, stagger: 0.35, turns: 1, sort: 'random', ease: 'smooth', glow: 0.4 },
		mask: { mode: 'none', size: 0.5, soft: 0.4, speed: 0.5, invert: false, show: false },
		look: {
			bg: '',
			grid: false,
			vignette: true,
			palette: 'brand',
			colorBy: 'disp',
			size: 3.5,
			glow: 0.8,
			bright: 1,
			blend: 'normal',
			hud: false,
			hudSpectrum: true,
			autoRotate: false,
			rotSpeed: 0.25,
			sizeNoise: 0.0,
			sizeAudio: 0.0,
			brightAudio: 0.0,
			audioBand: 'bass',
			glyph: 'off',
			shade: 0,
			bloom: 0.0,
			aberration: 0.0,
			dofOn: false,
			dofDist: 5.2,
			dofRange: 1.4,
		},
		audio: { style: 'deep', gain: 1.3, idle: false, idleSet: false, volume: 0.8 },
		anim: { dur: 8, loop: true, keys: [], clips: [] },
	};
}

const KEY = 'objglb.fx.v9';

/** Пустая 2D-текстура-заглушка для густого текущего кадра */
function frDummy2D() {
	const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
	t.needsUpdate = true;
	return t;
}

/** Пустая текстура-заглушка для массива кадров, пока раскадровка не включена */
function frDummyTex() {
	const t = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
	t.format = THREE.RGBAFormat;
	t.type = THREE.UnsignedByteType;
	t.needsUpdate = true;
	return t;
}

// атлас символов для режима «Символы вместо точек»: 8 ячеек от разреженного знака к плотному
const GLYPH_SETS = {
	// от самого лёгкого знака к самому плотному: по яркости точки выбирается знак
	ascii: ['.', '`', "'", ',', ':', ';', '-', '~', '"', '^', '_', '+', '=', '<', '>', 'i', '!', 'l', 'I', '?', '/', '\\', '|', '(', ')', '{', '}', '[', ']', '1', 't', 'f', 'j', 'r', 'x', 'n', 'u', 'v', 'c', 'z', 'X', 'Y', 'U', 'J', 'C', 'L', 'Q', '0', 'O', 'Z', 'm', 'w', 'q', 'p', 'd', 'b', 'k', 'h', 'a', 'o', '*', '#', 'M', 'W', '&', '8', '%', 'B', '@', '$'],
	digits: ['1', '7', '4', '2', '5', '3', '6', '9', '8', '0'],
	letters: ['i', 'l', 'j', 't', 'f', 'r', 'c', 's', 'v', 'x', 'z', 'n', 'u', 'e', 'a', 'o', 'y', 'k', 'h', 'd', 'b', 'p', 'q', 'g', 'm', 'w', 'I', 'L', 'T', 'J', 'V', 'A', 'X', 'Y', 'K', 'H', 'N', 'R', 'E', 'F', 'P', 'S', 'U', 'Z', 'B', 'D', 'G', 'O', 'Q', 'C', 'M', 'W'],
	blocks: ['·', '▫', '▪', '▘', '▝', '▖', '▗', '▁', '░', '▏', '▎', '▂', '▍', '▀', '▄', '▌', '▐', '▃', '▞', '▚', '▒', '▅', '▋', '▆', '▓', '▊', '▇', '▉', '■', '█'],
};
function glyphAtlas(mode) {
	const set = GLYPH_SETS[mode] || GLYPH_SETS.ascii;
	const n = set.length;
	const cv = document.createElement('canvas');
	cv.width = n * 64;
	cv.height = 64;
	const c = cv.getContext('2d');
	c.fillStyle = '#fff';
	c.textAlign = 'center';
	c.textBaseline = 'middle';
	// у цифр обычный Geist: в Geist Mono нуль перечёркнут
	c.font = mode === 'digits' ? '700 54px Geist, system-ui, sans-serif' : '700 54px "Geist Mono", ui-monospace, Menlo, "Apple Symbols", monospace';
	set.forEach((g, i) => c.fillText(g, i * 64 + 32, 34));
	const tex = new THREE.CanvasTexture(cv);
	tex.minFilter = tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	tex.userData = { n };
	return tex;
}

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
/** Переставляет данные анимации точек (кость, вес, положение в позе привязки) вслед за перестановкой самих точек: src[i] это номер исходной точки */
function reorderAnim(a, src) {
	if (!a) return null;
	const n = src.length;
	const out = { parts: a.parts, part: new Uint8Array(n), bp: new Float32Array(n * 3), bi: new Uint16Array(n * 4), bw: new Float32Array(n * 4), bn: a.bn ? new Float32Array(n * 3) : null };
	for (let i = 0; i < n; i++) {
		const j = src[i];
		out.part[i] = a.part[j];
		for (let k = 0; k < 3; k++) {
			out.bp[i * 3 + k] = a.bp[j * 3 + k];
			if (out.bn) out.bn[i * 3 + k] = a.bn[j * 3 + k];
		}
		for (let k = 0; k < 4; k++) {
			out.bi[i * 4 + k] = a.bi[j * 4 + k];
			out.bw[i * 4 + k] = a.bw[j * 4 + k];
		}
	}
	return out;
}

function fitCount(c, n) {
	if (c.count === n) return c;
	const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
	const src = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		const j = Math.min(c.count - 1, Math.floor((i * c.count) / n));
		src[i] = j;
		for (let k = 0; k < 3; k++) {
			pos[i * 3 + k] = c.positions[j * 3 + k];
			nor[i * 3 + k] = c.normals[j * 3 + k];
			col[i * 3 + k] = c.colors[j * 3 + k] ?? 1;
		}
	}
	return { positions: pos, normals: nor, colors: col, count: n, anim: reorderAnim(c.anim, src), norm: c.norm };
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
	// у анимированного персонажа размер берётся по всему движению клипа
	if (c.animBox && !c.animBox.isEmpty()) {
		const B = c.animBox;
		minx = B.min.x; miny = B.min.y; minz = B.min.z; maxx = B.max.x; maxy = B.max.y; maxz = B.max.z;
	}
	const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
	const k = 2.2 / Math.max(maxx - minx, maxy - miny, maxz - minz, 1e-9);
	const out = new Float32Array(p.length);
	for (let i = 0; i < p.length; i += 3) {
		out[i] = (p[i] - cx) * k;
		out[i + 1] = (p[i + 1] - cy) * k;
		out[i + 2] = (p[i + 2] - cz) * k;
	}
	return { positions: out, normals: c.normals, colors: c.colors, count: c.count, anim: c.anim, norm: { cx, cy, cz, k, floorY: (miny - cy) * k } };
}

/**
 * Упорядочивает точки облака вдоль кривой Мортона по его собственным габаритам. У двух моделей i-я точка оказывается
 * примерно в «том же месте» формы, поэтому при морфинге точки идут к ближайшим родственным местам, а не разлетаются
 * через всю сцену, и переход выглядит как перетекание, а не как перемешивание.
 */
function mortonSort(c) {
	const n = c.count;
	const P = c.positions;
	let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
	for (let i = 0; i < n; i++) {
		const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
		if (x < mnx) mnx = x; if (x > mxx) mxx = x;
		if (y < mny) mny = y; if (y > mxy) mxy = y;
		if (z < mnz) mnz = z; if (z > mxz) mxz = z;
	}
	const sx = 1023 / Math.max(1e-9, mxx - mnx), sy = 1023 / Math.max(1e-9, mxy - mny), sz = 1023 / Math.max(1e-9, mxz - mnz);
	const spread = (v) => {
		v &= 0x3ff;
		v = (v | (v << 16)) & 0x030000ff;
		v = (v | (v << 8)) & 0x0300f00f;
		v = (v | (v << 4)) & 0x030c30c3;
		v = (v | (v << 2)) & 0x09249249;
		return v;
	};
	const M = 4194304; // 2^22: хватает на 4 млн точек
	const keys = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const code = ((spread(((P[i * 3] - mnx) * sx) | 0) << 2) | (spread(((P[i * 3 + 1] - mny) * sy) | 0) << 1) | spread(((P[i * 3 + 2] - mnz) * sz) | 0)) >>> 0;
		keys[i] = code * M + i;
	}
	keys.sort();
	const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
	const src = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		const j = keys[i] % M;
		src[i] = j;
		for (let k = 0; k < 3; k++) {
			pos[i * 3 + k] = P[j * 3 + k];
			nor[i * 3 + k] = c.normals[j * 3 + k];
			col[i * 3 + k] = c.colors[j * 3 + k] ?? 1;
		}
	}
	return { positions: pos, normals: nor, colors: col, count: n, anim: reorderAnim(c.anim, src), norm: c.norm };
}

// ───────────────────────────────────────────────────────────── шейдеры

const common = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uTOff;
uniform float uMorph;
uniform vec4 uMorphS;
uniform vec4 uMorphO;
uniform float uSettle;
uniform float uBeat;
uniform vec2 uYR;
uniform vec3 uMouse;
uniform float uMouseOn;
uniform sampler2D uSpecTex;
uniform float uShade;
uniform vec4 uCurlP, uSpecP, uWaveP, uWaveSrc, uPulseP, uVoxelP, uGlitchP, uBlast, uFlow, uDisP;
float gGl = 0.0;
float gCh = -1.0;
float gDrop = 0.0;
float gGrow = 1.0;
float gGrowE = 0.0;
float gBurst = 0.0;
float gScopeG = 0.0;
float gScopeT = 0.0;
float gScopeD = 0.0;
uniform vec4 uScope, uScopeP, uScopeQ;
uniform vec3 uScopeC;
float gDepth = 0.5;
float gDepthG = 0.0;
uniform vec4 uDepth, uDepthP, uDepthQ;
uniform float uFlat;
float gLum = 0.5;
uniform vec4 uCurl, uSpec, uWave, uTwist, uPulse, uVoxel, uJitter, uCursor, uMask, uMaskA, uGlitch, uContact, uShockP;
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
uniform float uAnimN;
uniform vec3 uCen; // центр облака (для распада, воронки и взрыва)
uniform vec4 uDisQ; // x: ширина кромки, y: сила разлёта, z: свечение кромки, w: мельчание точек
uniform vec4 uGravP;
uniform vec4 uHandP;
uniform vec4 uImp[32];
uniform vec4 uShock[4];
uniform vec4 uExp, uExpP; // разбор: x ход 0..1, y число кусков, z разброс по времени, w вращение; uExpP.x расстояние
uniform sampler2D uPieceTex; // центры кусков
uniform vec4 uGrow, uGrowP; // росток: x ход, y откуда, z усики, w ширина фронта; uGrowP: x почки, y покачивание, z включён
uniform vec3 uGrowSeed;
uniform vec4 uJel[3]; // желе: удар (направление и сила xyz, время начала w)
uniform vec4 uJelO[3]; // откуда пошла волна
uniform vec4 uJelP; // частота, затухание, сила, сплющивание
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
float hit2(bool b) { return b ? 1.0 : 0.0; }

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
	float st = uDisP.x;
	float y01 = clamp((b.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	// слои: вся полоса по высоте уходит разом, поэтому высота квантуется
	if (st > 2.5 && st < 3.5) y01 = floor(y01 * 12.0 + 0.001) / 12.0;
	// блоки: соседние точки (индекс идёт по порядку обхода пространства) держатся вместе и уходят одним куском
	float h = (st > 3.5 && st < 4.5) ? hash11(floor(idx * 1800.0) * 0.731) : hash11(idx * 37.3);
	// чем слаженнее вид, тем меньше случайности в порядке отрыва
	float jit = st < 0.5 ? 0.16 : st < 1.5 ? 0.28 : st < 2.5 ? 0.03 : st < 3.5 ? 0.0 : st < 4.5 ? 0.3 : st < 5.5 ? 0.18 : st < 6.5 ? 0.12 : 0.1;
	float m = uDis.y;
	// у анимированной модели положение в кадре меняется, поэтому порядки по оси X и пятнами берут устойчивый шум по номеру точки: иначе точки мерцали бы, пока модель движется
	bool still = uAnimN < 0.5;
	float ord;
	if (m < 0.5) ord = 1.0 - y01;
	else if (m < 1.5) ord = still ? snoise(b * 1.7) * 0.5 + 0.5 : hash11(idx * 13.7);
	else if (m < 2.5) ord = y01;
	else if (m < 3.5) ord = still ? clamp((b.x - uCen.x) * 0.3 + 0.5, 0.0, 1.0) : y01;
	else {
		float r01 = clamp(length(b - uCen) / max((uYR.y - uYR.x) * 0.6, 0.3), 0.0, 1.0);
		ord = m < 4.5 ? r01 : 1.0 - r01;
	}
	ord = ord * (1.0 - jit) + h * jit;
	float w = max(uDisQ.x, 0.06);
	if (st > 1.5 && st < 2.5) w *= 0.45;
	return clamp((uDis.x * (1.0 + w) - ord) / w, 0.0, 1.0);
}

// Росток: 0 ещё не выросла, 1 выросла. Фронт идёт от «семени»: снизу вверх, от точки или от центра, с неровностью от шума
float growK(vec3 b, float idx) {
	float S = max(uYR.y - uYR.x, 0.5);
	float y01 = clamp((b.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	float d;
	if (uGrow.y < 0.5) d = y01 * 0.8 + clamp(length(b.xz - uCen.xz) / S, 0.0, 1.0) * 0.2;
	else if (uGrow.y < 1.5) d = clamp(distance(b, uGrowSeed) / (S * 1.5), 0.0, 1.0);
	else d = clamp(length(b - uCen) / (S * 0.7), 0.0, 1.0);
	float nz = uAnimN < 0.5 ? snoise(b * 3.0 + 7.0) * 0.5 + 0.5 : hash11(floor(idx * 700.0) * 0.37);
	d = clamp(d + (nz - 0.5) * 0.45 * uGrow.z + (hash11(idx * 9.1) - 0.5) * 0.03, 0.0, 1.0);
	float w = max(uGrow.w, 0.04);
	return clamp((uGrow.x * (1.0 + w) - d) / w, 0.0, 1.0);
}

// Местное время морфинга точки 0..1: расслоение задаёт, насколько позже стартуют точки, порядок задаёт, какие первыми
float morphLocal(vec3 A, vec3 B, float idx) {
	float h = hash11(idx * 3.17);
	float ord = h;
	int so = int(uMorphO.x + 0.5);
	float yN = clamp((A.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	if (so == 1) ord = yN * 0.85 + h * 0.15;
	else if (so == 2) ord = (1.0 - yN) * 0.85 + h * 0.15;
	else if (so == 3) ord = clamp(length(A) / 1.4, 0.0, 1.0) * 0.85 + h * 0.15;
	else if (so == 4) ord = clamp((A.x + 1.2) / 2.4, 0.0, 1.0) * 0.85 + h * 0.15;
	float sg = uMorphS.z;
	return clamp(uMorph * (1.0 + sg) - ord * sg, 0.0, 1.0);
}
float morphEase(float x) {
	int e = int(uMorphO.y + 0.5);
	if (e == 1) return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
	if (e == 2) {
		float c1 = 1.70158;
		float y = x - 1.0;
		return 1.0 + (c1 + 1.0) * y * y * y + c1 * y * y;
	}
	return x * x * (3.0 - 2.0 * x);
}


// ───── раскадровка видео: положения листов и показ считаются здесь, без перезаписи данных на каждом кадре
uniform vec4 uFr;   // x: включено, y: кадров, z: точек в кадре, w: всего точек
uniform vec4 uFr2;  // колонки, строки, ширина листа, высота листа
uniform vec4 uFr3;  // глубина, раскладка A, раскладка B, переход A к B
uniform vec4 uFr4;  // текущий кадр (дробный), режим показа, длина луча/шлейфа, подсветка
uniform vec4 uFr5;  // x: голова кольцевого буфера (бегущая лента), y: сила редения прошлых кадров, z: будущие кадры (0 видны, 1 приглушены, 2 скрыты), w: усиление яркости
uniform vec4 uHero; // колонки, строки, точек, включено
uniform vec4 uFr6;  // x: размер точек остальных кадров, y: весь ряд кадров (1) или только пройденное (0), z: тона (0 все, 1 светлые, 2 тёмные), w: порог тонов
uniform vec4 uFr7;  // x: длина хвоста (доля всех кадров), y: насыщенность, z: плавность гашения хвоста
vec3 frPlace(float lay, float k, float n, float u, float v, out vec3 nrm) {
	float t = n > 1.0 ? k / (n - 1.0) : 0.5;
	float W = uFr2.z;
	float H = uFr2.w;
	float depth = uFr3.x;
	nrm = vec3(0.0, 0.0, 1.0);
	if (lay > 0.5 && lay < 1.5) {
		float gx = ceil(sqrt(n * (W / H)));
		float gy = ceil(n / gx);
		float s = min(2.4 / (gx * W), 2.4 / (gy * H));
		float cx = mod(k, gx);
		float cy = floor(k / gx);
		return vec3((cx - (gx - 1.0) * 0.5) * W * s * 1.04 + u * W * s, ((gy - 1.0) * 0.5 - cy) * H * s * 1.04 + v * H * s, 0.0);
	}
	// расстояние от текущего кадра в кадрах (у главного кадра ноль)
	float ad = k - uFr4.x;
#ifdef HERO
	ad = 0.0;
#endif
	if (lay > 1.5 && lay < 2.5) {
		// плёнка: кадры в ряд, текущий в центре и крупнее, соседи мельче; при перемотке лента едет
		float sc = 0.5;
		float aa = abs(ad);
		float c1 = W * 0.54 + W * sc * 0.53;
		float c = aa < 1.0 ? aa * c1 : c1 + (aa - 1.0) * W * sc * 1.06;
		float s = mix(1.0, sc, min(aa, 1.0));
		return vec3(sign(ad) * c + u * W * s, v * H * s, 0.0);
	}
	// текущий кадр стоит на месте (z = 0), прошлые уходят от него вглубь: чем дальше видео, тем длиннее стопка, при перемотке назад она укорачивается.
	// при листании пройденные кадры лежат ближе к зрителю и улетают к нему, открывая текущий
	float dz = (uFr4.y > 0.5 && uFr4.y < 1.5) ? -1.0 : 1.0;
	float kz = k;
#ifdef HERO
	kz = uFr4.x;
#endif
	// весь ряд: кадры стоят на своих местах по времени, а текущий кадр идёт сквозь них; иначе стопка отсчитывается от текущего
	float cen = uFr6.y > 0.5 ? (n - 1.0) * 0.5 : uFr4.x;
	// туннель: то же, но прошлые кадры уменьшаются с глубиной
	float ts = lay > 2.5 ? 1.0 - 0.72 * clamp(max(-ad, 0.0) / max(n - 1.0, 1.0), 0.0, 1.0) : 1.0;
	return vec3(u * W * ts, v * H * ts, (kz - cen) * depth / max(n - 1.0, 1.0) * dz);
}
// Положение точки блока по её номеру; раскладки A и B плавно перетекают друг в друга
vec3 frMix(float k, float u, float v, out vec3 nrm) {
	vec3 nA;
	vec3 nB;
	vec3 pA = frPlace(uFr3.y, k, uFr.y, u, v, nA);
	if (uFr3.w > 0.0001) {
		vec3 pB = frPlace(uFr3.z, k, uFr.y, u, v, nB);
		float m = uFr3.w * uFr3.w * (3.0 - 2.0 * uFr3.w);
		nrm = normalize(mix(nA, nB, m));
		return mix(pA, pB, m);
	}
	nrm = nA;
	return pA;
}
vec3 frBlockPos(float aIdx, out vec3 nrm, out float kk, out vec2 cell) {
#ifdef HERO
	// «главный» кадр: свой густой набор точек на месте текущего кадра
	float ip = floor(aIdx * uHero.z + 0.5);
	float ci = mod(ip, uHero.x);
	float cj = floor(ip / uHero.x);
	kk = clamp(floor(uFr4.x + 0.5), 0.0, uFr.y - 1.0);
	cell = vec2(ci, cj);
	return frMix(kk, (ci + 0.5) / uHero.x - 0.5, 0.5 - (cj + 0.5) / uHero.y, nrm);
#else
	float ip = floor(aIdx * uFr.w + 0.5);
	float k = floor(ip / uFr.z);
	float loc = ip - k * uFr.z;
	float ci = mod(loc, uFr2.x);
	float cj = floor(loc / uFr2.x);
	kk = k;
	cell = vec2(ci, cj);
	// у каждого листа сетка чуть сдвинута: точки разных кадров не выстраиваются в столбики, объём выглядит как облако
	vec2 jt = vec2(fract(sin(k * 12.9898) * 43758.5453), fract(sin(k * 78.233 + 1.7) * 24634.6345)) - 0.5;
	return frMix(k, (ci + 0.5 + jt.x * 0.9) / uFr2.x - 0.5, 0.5 - (cj + 0.5 + jt.y * 0.9) / uFr2.y, nrm);
#endif
}
// Показ кадров: x яркость, y смещение вдоль нормали, z доля подкраски; tcol цвет подкраски
vec4 frShow(float k, out vec3 tcol) {
	float n = uFr.y;
	float idx = uFr4.x;
	int mode = int(uFr4.y + 0.5);
	float d = k - idx;
	float fw = max(2.0, n * 0.04);
	float w = 1.0;
	float lift = 0.0;
	float tint = 0.0;
	tcol = uP2;
	if (mode == 0) {
		float hl = uFr4.w;
		if (hl > 0.001) w = 1.0 - 0.5 * hl + (0.5 + 1.4 * hl) * max(0.0, 1.0 - abs(d) / 2.5) * hl;
			// кадры впереди текущего (из «будущего») закрывали бы его спереди: по умолчанию приглушаем
			// прошлые кадры тускнеют с глубиной, чтобы стопка не сливалась в серую кашу
			if (d < -0.5) w *= 0.45 + 0.55 / (1.0 + 0.2 * (-d));
			if (d > 0.5 && uFr6.y < 0.5 && abs(uFr3.y - 2.0) > 0.5) w *= uFr5.z > 1.5 ? 0.0 : uFr5.z > 0.5 ? 0.4 : 1.0;
	} else if (mode == 1) {
		if (d < 0.0) w = max(0.0, 1.0 + d / fw);
		lift = 1.0 - w;
		w *= 1.0 + 0.25 * max(0.0, 1.0 - abs(d));
	} else if (mode == 2) {
		if (d > 0.0) {
			w = max(0.0, 1.0 - d / fw) * (d <= fw ? 0.5 : 0.0);
			lift = -(1.0 - w) * 0.6;
		}
		w *= 1.0 + 0.25 * max(0.0, 1.0 - abs(d));
	} else if (mode == 3) {
		float half_ = max(3.0, n * 0.08);
		float ad = abs(d);
		w = ad <= half_ ? 1.0 : max(0.0, 1.0 - (ad - half_) / fw);
		lift = (1.0 - w) * sign(d + 0.0001) * 0.8;
		w *= 1.0 + 0.25 * max(0.0, 1.0 - ad);
	} else {
		float span = max(1.5, n * max(0.02, uFr4.z));
		if (mode == 4) {
			float beam = exp(-(d / span) * (d / span) * 2.0);
			float after = d < 0.0 ? exp(d / (span * 2.4)) * 0.4 : 0.0;
			w = 0.18 + beam * 1.5 + after;
			tint = min(0.85, beam * 0.8);
			lift = d < 0.0 ? -min(0.35, -d / n * 1.2) : 0.0;
		} else {
			float age = -d / span;
			if (d > 0.0) w = 0.0;
			else {
				w = max(0.0, exp(-age * 1.1) * 0.9) + 1.35 * max(0.0, 1.0 - abs(d));
				float t = min(1.0, age);
				tcol = t < 0.5 ? mix(uP0, uP1, t * 2.0) : mix(uP1, uP2, (t - 0.5) * 2.0);
				tint = min(0.9, 0.3 + age * 0.7) * (1.0 - max(0.0, 1.0 - abs(d)));
				lift = -min(0.6, age * 0.25);
			}
		}
	}
	return vec4(w, lift, tint, 0.0);
}


// Выдавливание по карте глубины: gDepth 0..1 (1 ближе всего). uDepth: сила, режим, скорость, фокус; uDepthP: слоёв, знак, покачивание, вид
// Зона на месте: точки вокруг выбранной глубины остаются плоскими, за её краями рельеф плавно нарастает
float dzone(float x) {
	float a = abs(x);
	return sign(x) * max(a - uDepthQ.x, 0.0) / max(1.0 - uDepthQ.x, 0.25);
}

vec3 depthShape(vec3 b) {
	float t = uTime - uTOff;
	float A = uDepth.x;
	float sp = uDepth.z;
	float dn = uDepthP.y > 0.0 ? gDepth : 1.0 - gDepth;
	float fo = uDepthP.y > 0.0 ? uDepth.w : 1.0 - uDepth.w;
	float dd = dzone(dn - fo);
	int md = int(uDepth.y + 0.5);
	if (md == 0) {
		// рельеф: ближнее выступает вперёд
		b.z += dd * A * 1.2;
	} else if (md == 1) {
		// ступени: глубина режется на ровные плоскости
		float N = max(2.0, floor(uDepthP.x + 0.5));
		float x = dn * N;
		float dq = (floor(x) + smoothstep(0.38, 0.62, fract(x))) / N;
		b.z += dzone(dq - fo) * A * 1.5;
	} else if (md == 2) {
		// дыхание: рельеф выдавливается и втягивается обратно
		b.z += dd * A * 1.3 * (0.5 + 0.5 * sin(t * sp * 0.9));
	} else if (md == 3) {
		// волна: глубина вспухает бегущей волной слева направо
		b.z += dd * A * 1.4 * (0.55 + 0.45 * sin(b.x * 3.2 - t * sp * 1.6));
	} else if (md == 4) {
		// рябь: по рельефу расходятся круги, у ближнего они выше
		b.z += (dd * 0.6 + sin(length(b.xy) * 9.0 - t * sp * 2.2) * 0.25 * (0.35 + dn)) * A;
	} else if (md == 5) {
		// карусель: слои разной глубины поворачиваются на разный угол вокруг вертикали
		float a = dd * A * 1.6 * sin(t * sp * 0.7);
		float cs = cos(a);
		float sn = sin(a);
		b.xz = mat2(cs, -sn, sn, cs) * b.xz;
		b.z += dd * A * 0.5;
	} else {
		// разлёт: слои по очереди вылетают к зрителю и возвращаются
		float p = 0.5 + 0.5 * sin(t * sp * 0.8 - 1.5708);
		b.z += dd * A * (0.4 + 1.8 * p * p);
		b.xy *= 1.0 + dd * A * 0.5 * p * p;
	}
	// лёгкое покачивание: сдвиг по глубине даёт параллакс, плоский кадр оживает даже без вращения камеры
	float a = t * sp * 0.8;
	b.xy += vec2(cos(a), sin(a) * 0.55) * dd * uDepthP.z * A * 0.4;
	return b;
}

// Положение одной точки после всех эффектов. base: форма без эффектов, maskV: доля эффектов в этой точке (зона)
vec3 fxDisplace(vec3 aOrigin, vec3 aTarget, float aIdx, out vec3 base, out float maskV) {
	float t = uTime - uTOff;
	float m = uMorph * uMorph * (3.0 - 2.0 * uMorph);
	base = aTarget;
	if (uFr.x > 0.5 && uMorph > 0.9999) {
		vec3 fnrm;
		float fk;
		vec2 fcell;
		base = frBlockPos(aIdx, fnrm, fk, fcell);
	}
	if (uMorph < 0.9999) {
		// морфинг: у каждой точки своё время старта (порядок и расслоение), а путь идёт по дуге через опорную точку, форма которой зависит от вида перехода
		float lt = morphLocal(aOrigin, aTarget, aIdx);
		float e = morphEase(lt);
		float sc = uMorphS.y;
		int sty = int(uMorphS.x + 0.5);
		vec3 mid = (aOrigin + aTarget) * 0.5;
		vec3 cn = curlNoise(mid * 1.8 + vec3(0.0, t * 0.3, 0.0));
		vec3 ctrl = mid + cn * sc * 0.9;
		vec3 rdir = normalize(mid + vec3(1e-3));
		if (sty == 1) ctrl = mid + normalize(vec3(-mid.z, 0.0, mid.x) + vec3(1e-3)) * sc * 0.9;
		else if (sty == 2) ctrl = mid + rdir * sc * 1.6 + cn * sc * 0.4;
		else if (sty == 3) ctrl = mid + cn * sc * 0.3;
		else if (sty == 4) ctrl = aOrigin + vec3(0.0, 0.9 * sc, 0.0) + cn * sc * 0.8;
		else if (sty == 5) ctrl = vec3(mid.x, min(aOrigin.y, aTarget.y) - 1.1 * sc, mid.z) + cn * sc * 0.25;
		float om = 1.0 - e;
		base = om * om * aOrigin + 2.0 * om * e * ctrl + e * e * aTarget;
		if (sty == 2) {
			// взрыв: частицы разлетаются, падают на пол и лежат без отскока, затем поднимаются дугой в новую форму
			float fl = uYR.x - 0.04;
			float h1 = hash11(aIdx * 5.31);
			float h2 = hash11(aIdx * 7.77);
			float h3 = hash11(aIdx * 2.13);
			vec3 dx = normalize(vec3(aOrigin.x, 0.0, aOrigin.z) + vec3(h1 - 0.5, 0.0, h2 - 0.5) * 0.9 + vec3(1e-3, 0.0, 0.0));
			float spd = (0.35 + h3 * 1.1) * sc;
			float vy0 = (0.5 + h2 * 1.3) * sc;
			float te = clamp(lt / 0.45, 0.0, 1.0);
			float tau = te * 1.6;
			vec3 pl = aOrigin;
			pl.xz += dx.xz * spd * (1.0 - exp(-3.52)) * 1.4;
			pl.y = fl + h1 * 0.03;
			vec3 pf = aOrigin;
			pf.xz += dx.xz * spd * (1.0 - exp(-2.2 * tau)) * 1.4;
			float yf = max(fl + h1 * 0.03, aOrigin.y + vy0 * tau - 2.1 * tau * tau);
			pf.y = mix(yf, pl.y, smoothstep(0.85, 1.0, te));
			float tg = clamp((lt - 0.58) / 0.42, 0.0, 1.0);
			float eg = tg * tg * (3.0 - 2.0 * tg);
			vec3 c2 = (pl + aTarget) * 0.5 + vec3(0.0, 0.5 + 0.6 * h2, 0.0) + cn * 0.2 * sc;
			float og = 1.0 - eg;
			vec3 pg = og * og * pl + 2.0 * og * eg * c2 + eg * eg * aTarget;
			base = lt < 0.45 ? pf : (lt < 0.58 ? pl : pg);
		}
		if (sty == 1) {
			float ang = sin(e * PI) * uMorphS.w * 6.2831853 * (0.6 + 0.4 * hash11(aIdx * 1.3));
			float cs = cos(ang);
			float sn = sin(ang);
			base.xz = vec2(base.x * cs - base.z * sn, base.x * sn + base.z * cs);
		}
	}
	if (uDepth.x > 0.001) base = depthShape(base);
	vec3 rad = normalize(base + vec3(1e-4));
	// у плоских источников (фото, видео, блок кадров) направление «наружу» это взгляд на кадр, иначе волны и импульсы лишь двигают картинку в её плоскости и почти не видны
	rad = normalize(mix(rad, vec3(0.0, 0.0, 1.0), 0.8 * uFlat));
	// движущаяся анимированная модель: «наружу» это нормаль её поверхности, а не направление от центра сцены (оно смотрит не туда, когда модель далеко от центра)
	if (uAnimN > 0.5 && dot(aNormal, aNormal) > 0.01) rad = normalize(aNormal);
	vec3 pos = base;

	if (uTwist.x > 0.001) {
		float y01t = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float tw = uTwist.x * (1.0 + (uTwist.z > 0.01 ? 0.35 * sin(t * uTwist.z * 2.0) : 0.0));
		if (uTwist.y < 0.5) {
			float a = pos.y * tw * 1.6;
			float c = cos(a);
			float s = sin(a);
			pos.xz = mat2(c, -s, s, c) * pos.xz;
		} else if (uTwist.y < 1.5) {
			pos.x += y01t * y01t * tw * 0.9;
			pos.y -= y01t * y01t * y01t * tw * 0.16;
		} else if (uTwist.y < 2.5) {
			pos.xz *= 1.0 + tw * 0.6 * (0.5 - y01t) * 2.0;
		} else if (uTwist.y < 3.5) {
			// змейка: форма извивается по высоте, как лента
			float sw = sin(pos.y * 3.2 - t * (0.9 + uTwist.z));
			pos.x += sw * tw * 0.2;
			pos.z += cos(pos.y * 3.2 - t * (0.9 + uTwist.z)) * tw * 0.12;
		} else {
			// дыхание: по высоте бегут расширения и сужения
			pos.xz *= 1.0 + tw * 0.3 * sin(y01t * 6.2831 - t * (1.2 + uTwist.z));
		}
	}
	if (uWave.x > 0.001) {
		float wv = 0.0;
		if (uWaveP.y < 0.5) {
			wv = sin(distance(base, uWaveSrc.xyz) * uWave.y * 2.0 - t * 3.0 * uWaveP.x);
		} else if (uWaveP.y < 1.5) {
			float age = uTime - uWaveP.w;
			if (age > 0.0) {
				float d = distance(base, uWaveSrc.xyz);
				float ring = age * uWaveP.x * 1.3;
				wv = sin((d - ring) * uWave.y * 2.6) * exp(-abs(d - ring) * 2.5) * exp(-age * uWaveP.z);
			}
		} else if (uWaveP.y < 2.5) {
			vec3 wd = vec3(cos(uWaveSrc.w), 0.0, sin(uWaveSrc.w));
			wv = sin(dot(base, wd) * uWave.y * 2.0 - t * 3.0 * uWaveP.x);
		} else if (uWaveP.y < 3.5) {
			// спираль: гребень закручен вокруг формы и бежит вверх
			float yw = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
			wv = sin(atan(base.z - uCen.z, base.x - uCen.x) * 3.0 + yw * uWave.y * 1.3 - t * 3.0 * uWaveP.x);
		} else {
			// подъём: ровные горизонтальные гребни поднимаются снизу вверх
			wv = sin(base.y * uWave.y * 2.0 - t * 3.0 * uWaveP.x);
		}
		pos += rad * wv * uWave.x * 0.14 * (1.0 + 1.5 * uFlat);
	}
	if (uSpec.x > 0.001) {
		float y01s = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		if (uSpec.y < 0.5) {
			pos += rad * texture2D(uSpecTex, vec2(abs(atan(base.z, base.x)) / PI, 0.5)).r * uSpec.x * 0.7;
		} else if (uSpec.y < 1.5) {
			pos += rad * texture2D(uSpecTex, vec2(y01s, 0.5)).r * uSpec.x * 0.7;
		} else if (uSpec.y < 2.5) {
			float ub = floor(abs(atan(base.z, base.x)) / PI * uSpecP.y) / uSpecP.y;
			pos += rad * texture2D(uSpecTex, vec2(ub, 0.5)).r * uSpec.x * 0.8;
		} else {
			float xs = clamp(abs(base.x) / 1.2, 0.0, 1.0);
			pos.y += texture2D(uSpecTex, vec2(xs, 0.5)).r * uSpec.x * 0.8 * (0.35 + 0.65 * y01s);
		}
	}
	float pe = uPulse.x;
	if (uPulseP.x > 0.5) {
		float age = uTime - uPulseP.z - length(base) * uPulseP.y;
		float env = age > 0.0 ? exp(-age * 3.2 * uPulseP.w) * smoothstep(0.0, 0.04, age) : 0.0;
		float age2 = age - 0.2;
		env += age2 > 0.0 ? 0.55 * exp(-age2 * 3.2 * uPulseP.w) * smoothstep(0.0, 0.04, age2) : 0.0;
		pe = uPulse.x * env * 1.6;
		if (uPulseP.x > 1.5) {
			pos.y *= 1.0 + pe * 0.2;
			pos.xz *= 1.0 - pe * 0.11;
			pe = 0.0;
		}
	}
	pos += rad * pe * 0.28 * (1.0 + 1.5 * uFlat);
	pos *= 1.0 + pe * 0.1;
	if (uBlast.x > 0.001) {
		float age = uTime - uBlast.w;
		if (age > 0.0) {
			float env = exp(-age * uBlast.y) * cos(age * uBlast.y * 3.0);
			float rnd = 0.45 + 0.55 * mix(1.0, hash11(aIdx * 7.1), uBlast.z);
			vec3 dir = normalize(rad + (vec3(hash11(aIdx), hash11(aIdx + 1.0), hash11(aIdx + 2.0)) - 0.5) * 0.7 * uBlast.z);
			pos += dir * env * rnd * uBlast.x * 0.75;
		}
	}
	if (uFlow.x > 0.001) {
		vec3 fc = curlNoise(base * uFlow.y + vec3(0.0, t * uFlow.z * 0.1, 0.0));
		vec3 tg = normalize(fc - rad * dot(fc, rad) + vec3(1e-4));
		tg = tg * cos(uFlow.w) + cross(rad, tg) * sin(uFlow.w);
		float ph = t * uFlow.z + hash11(aIdx * 5.3) * 6.2831;
		pos += tg * sin(ph) * uFlow.x * 0.24;
	}
	if (uMark.x > 3.5 && uMark.x < 5.5) {
		float mkd = markK(base);
		if (uMark.x < 4.5) pos += rad * mkd * 0.22;
		else pos = mix(pos, (floor(pos / 0.06) + 0.5) * 0.06, smoothstep(0.0, 0.4, mkd));
	}
	if (uSliceM.x > 0.5 && uSliceM.x < 1.5) pos += rad * sliceK(base) * uSliceM.y;
	float dk = disK(base, aIdx);
	if (dk > 0.0) {
		float sc = uDisQ.y;
		float ds = uDisP.x;
		float y01d = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		// кусок: соседние точки делят номер и движутся вместе
		float cl = floor(aIdx * 1800.0);
		float ch = hash11(cl * 0.731);
		float ch2 = hash11(cl * 1.913 + 3.1);
		vec3 cd = base - uCen;
		vec3 outd = cd / (length(cd) + 1e-3);
		// лёгкая турбулентность одинакова у всех видов и по умолчанию едва заметна: форма уходит слаженно, а не шумом
		vec3 dsp = uAnimN > 0.5 ? vec3(hash11(aIdx * 1.7), hash11(aIdx * 2.3), hash11(aIdx * 3.1)) * 8.0 : base * 1.8;
		pos += curlNoise(dsp + vec3(0.0, -t * 0.6, t * 0.3)) * dk * uDisT * 0.22 * sc;
		if (ds < 0.5) {
			// ветер: вся масса тянется одним потоком в сторону, быстрее и медленнее по высоте, как полотно на ветру
			vec3 wv = vec3(uDis.w * 1.4 + 0.2, -uDis.z * 0.5, 0.3);
			float sp = 0.65 + 0.35 * sin(y01d * 7.0 + t * 0.8);
			pos += wv * dk * dk * 1.5 * sp * sc;
		} else if (ds < 1.5) {
			// горение: пепел поднимается вверх, покачиваясь пачками, а не по одной точке
			pos.y += dk * dk * (0.7 + 0.5 * ch) * sc;
			pos.xz += vec2(sin(t * 1.5 + ch * 6.0), cos(t * 1.3 + ch * 5.0)) * dk * 0.1 * sc + vec2(uDis.w * 0.5, 0.0) * dk * sc;
		} else if (ds < 2.5) {
			// лазерный срез: пока фронт проходит, точки чуть приподнимаются над поверхностью и гаснут
			pos += outd * dk * 0.12 * sc + vec3(0.0, dk * 0.05 * sc, 0.0);
		} else if (ds < 3.5) {
			// слои: полосы по высоте по очереди съезжают в стороны, чётные вправо, нечётные влево
			float band = floor(y01d * 12.0 + 0.001);
			float sg = mod(band, 2.0) < 0.5 ? 1.0 : -1.0;
			pos.x += sg * dk * dk * 1.7 * sc + uDis.w * dk * 0.3;
			pos.y -= dk * dk * uDis.z * 0.25 * sc;
		} else if (ds < 4.5) {
			// блоки: куски падают целиком, разваливаются в стороны и ложатся кучкой на пол
			vec3 mv = vec3((ch - 0.5) * 0.9 + uDis.w * 0.3, 0.0, (ch2 - 0.5) * 0.9);
			pos += mv * dk * sc;
			pos.y = max(pos.y - dk * dk * (0.5 + uDis.z) * 1.8 * sc, uYR.x + ch * 0.05);
		} else if (ds < 5.5) {
			// песок: колонны точек осыпаются прямо вниз и ложатся на пол ровной кучей
			pos.y = max(pos.y - dk * dk * (0.5 + uDis.z) * 2.2 * sc, uYR.x + hash11(aIdx * 5.1) * 0.05);
			pos.x += uDis.w * dk * 0.25 * sc;
		} else if (ds < 6.5) {
			// воронка: форма закручивается и втягивается к центру, уходя вверх
			vec3 q = base - uCen;
			float ang = dk * dk * (3.2 + uDis.w * 1.2) * sc;
			float cs = cos(ang);
			float sn = sin(ang);
			q.xz = vec2(q.x * cs - q.z * sn, q.x * sn + q.z * cs);
			q *= 1.0 - 0.9 * dk * dk;
			pos = uCen + q + vec3(0.0, dk * dk * 0.45 * sc, 0.0);
		} else {
			// взрыв: от центра идёт волна, всё за ней отлетает наружу и падает
			pos += outd * pow(dk, 0.7) * (1.1 + 0.3 * ch) * sc;
			pos.y -= dk * dk * uDis.z * 0.8 * sc;
		}
	}
	// разбор на части: куски двигаются и вращаются целиком вокруг своего центра
	if (uExp.x > 0.001) {
		float pid = floor(aIdx * uExp.y);
		vec3 pc = texture2D(uPieceTex, vec2((pid + 0.5) / 256.0, 0.5)).xyz;
		float h1 = hash11(pid * 1.7);
		float h2 = hash11(pid * 2.9);
		float h3 = hash11(pid * 4.1);
		vec3 od = pc - uCen;
		vec3 dr = normalize(od + (vec3(h1, h2, h3) - 0.5) * 0.35 * (length(od) + 0.3) + vec3(1e-4));
		float ke = clamp((uExp.x - h2 * uExp.z) / max(1.0 - uExp.z, 0.2), 0.0, 1.0);
		ke = ke * ke * (3.0 - 2.0 * ke);
		vec3 ax = normalize(vec3(h1 - 0.5, h3 - 0.5, h2 - 0.5) + vec3(1e-3));
		float ang = ke * (h3 - 0.5) * 3.0 * uExp.w;
		vec3 qe = pos - pc;
		qe = qe * cos(ang) + cross(ax, qe) * sin(ang) + ax * dot(ax, qe) * (1.0 - cos(ang));
		pos = pc + qe + dr * ke * uExpP.x * (0.5 + 0.5 * h1);
	}
	// росток: фронт роста, почки на кромке и покачивание выросшей части
	if (uGrowP.z > 0.5) {
		gGrow = growK(base, aIdx);
		gGrowE = gGrow * (1.0 - gGrow) * 4.0;
		pos += rad * gGrowE * uGrowP.x * 0.12;
		float yG = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		pos.xz += vec2(sin(t * 1.2 + yG * 5.0), cos(t * 0.9 + yG * 4.0)) * 0.018 * uGrowP.y * gGrow * (0.3 + yG);
	}
	// желе: упругая дрожь расходится от места удара и затухает
	{
		for (int ji = 0; ji < 3; ji++) {
			float jage = uTime - uJel[ji].w;
			if (jage < 0.0 || jage > 7.0) continue;
			float jd = distance(base, uJelO[ji].xyz);
			float ja = jage - jd * 0.45;
			if (ja < 0.0) continue;
			float env = exp(-ja * uJelP.y) * sin(ja * uJelP.x);
			pos += uJel[ji].xyz * env * uJelP.z * 0.35;
			pos += (base - uJelO[ji].xyz) * env * uJelP.w * uJelP.z * 0.16 * length(uJel[ji].xyz);
		}
	}
	if (uGrav.x > 0.001) {
		vec3 gq = pos - uGravP.xyz;
		float gr = length(gq) + 1e-3;
		float gin = 1.0 - smoothstep(uGravP.w * 0.7, uGravP.w * 1.7, gr);
		float ga = smoothstep(0.0, 1.0, clamp(uGrav.x * gin, 0.0, 1.0));
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
			// вращение почти как у твёрдого диска, а разница скоростей между центром и краем ограничена и колеблется: рукава дышат, а не закручиваются в кашу со временем
			float ph0 = t * uGrav.z * 0.45;
			float ang = ga * (ph0 * 0.8 + 1.3 * sin(ph0 * 0.6) / (0.5 + gr));
			float ca = cos(ang);
			float sa = sin(ang);
			float nx = lx * ca - lz * sa;
			float nz = lx * sa + lz * ca;
			float az = atan(nz, nx);
			lh = lh * (1.0 - uGrav.w * ga) + 0.07 * gr * sin(az * 2.0 + t * 0.4) * ga;
			// спиральные рукава: плотность волной уходит от центра к краю
			float arm = sin(2.0 * az - 3.4 * log(gr + 0.15) + t * 0.25);
			float ar = 1.0 + 0.2 * arm * ga * uGrav.w;
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
		} else if (uGrav.y > 3.5) {
			// кольца: форма делится на круглые дорожки, каждая вращается как твёрдая, соседние в разные стороны
			float rr0 = length(vec2(lx, lz));
			float ringN = floor(rr0 * 5.0);
			float rr1 = mix(rr0, (ringN + 0.5) / 5.0, ga * 0.85);
			float dirR = mod(ringN, 2.0) < 0.5 ? 1.0 : -1.0;
			float az1 = atan(lz, lx) + dirR * t * uGrav.z * (0.25 + 0.5 / (0.4 + rr1)) * ga;
			lx = cos(az1) * rr1;
			lz = sin(az1) * rr1;
			lh = lh * (1.0 - uGrav.w * ga);
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
		// сила растёт мягче линейной: на максимуме точки уходят заметно, но форма ещё читается
		float ca = pow(uCurl.x, 1.45) * 0.055;
		float thr = snoise(base * 1.8 + t * 0.3) * 0.5 + 0.5;
		float det = smoothstep(0.35, 0.85, thr + min(uCurl.x, 1.0) * 0.12);
		vec3 cn = curlNoise(base * uCurl.y + vec3(t * 0.4, t * 0.3, t * 0.5) * uCurlP.x) * det * ca;
		if (uCurlP.z > 1.5) {
			// кольца: горизонтальные слои вращаются вокруг формы, соседние в разные стороны
			float yc = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
			float band = floor(yc * 8.0 + 0.001);
			float sg = mod(band, 2.0) < 0.5 ? 1.0 : -1.0;
			float ang = sg * sin(t * uCurlP.x * 0.7 + band * 0.8) * min(uCurl.x, 2.0) * 0.55;
			vec3 q = pos - uCen;
			float cs = cos(ang);
			float sn = sin(ang);
			q.xz = vec2(q.x * cs - q.z * sn, q.x * sn + q.z * cs);
			pos = uCen + q;
			cn = vec3(0.0);
		} else if (uCurlP.z > 0.5) {
			vec3 fd = vec3(cos(uCurlP.y), 0.35, sin(uCurlP.y));
			float ph = 0.5 + 0.5 * sin(t * uCurlP.x * 0.7 + hash11(aIdx * 3.7) * 6.2831);
			cn += fd * ph * det * ca * 0.9;
		}
		pos += cn;
	}
	if (uGlitch.x > 0.001) {
		float yg = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float spd = uGlitchP.y;
		// всплески: раз в секунду-две сбой резко усиливается на долю секунды, между ними лёгкая рябь
		float cyc = t * spd * 1.1;
		float bst = step(0.55, hash11(floor(cyc) * 3.17 + 1.3)) * (1.0 - smoothstep(0.0, 0.4, fract(cyc)));
		gBurst = bst;
		float I = uGlitch.x * (0.55 + (0.5 + uGlitchP.w * 1.6) * bst);
		float gm = uGlitchP.z;
		float tick = floor(t * 10.0 * spd);
		bool hit = false;
		if (gm < 0.5) {
			// полосы по высоте съезжают в стороны и в глубину
			float band = floor(yg * uGlitch.y);
			float r = hash11(band * 13.7 + tick);
			if (r > 0.55) {
				float shf = (r - 0.5) * 2.4 * (hash11(band + 7.0) - 0.5) * I;
				pos.x += shf * (1.0 + uFlat);
				pos.z += shf * 1.6 * (hash11(band + 3.0) - 0.5) * (1.0 + uFlat);
				hit = true;
			}
		} else if (gm < 1.5) {
			// блоки: куски объёма смещаются целиком
			vec3 cell = floor(base * vec3(4.0, uGlitch.y * 0.35, 4.0));
			float r = hash11(dot(cell, vec3(12.9, 78.2, 37.7)) + tick * 1.7);
			if (r > 0.62) {
				vec3 hv = vec3(hash11(r * 91.0), hash11(r * 57.0), hash11(r * 33.0)) - 0.5;
				pos += hv * (r - 0.55) * 1.6 * I * vec3(1.0, 0.35, 1.0);
				hit = true;
			}
		} else {
			// развёртка: тонкие строки рвутся сильнее, остальное чуть дрожит
			float row = floor(yg * uGlitch.y * 3.0);
			float r = hash11(row * 5.3 + tick * 2.3);
			if (r > 0.8) {
				pos.x += (hash11(row * 9.1 + tick) - 0.5) * 2.4 * I * (1.0 + uFlat);
				hit = true;
			}
			pos.x += (hash11(row + tick) - 0.5) * 0.02 * I;
		}
		if (hit) {
			gGl = I;
			if (uGlitchP.x > 0.5) {
				float chn = floor(hash11(aIdx * 17.3 + tick) * 3.0);
				pos.x += (chn - 1.0) * 0.09 * I;
				gCh = chn;
			}
		}
		// выпадение: во время всплеска часть точек пропадает
		gDrop = step(hash11(aIdx * 3.7 + tick), uGlitch.z * 0.4 * bst * uGlitch.x) * hit2(hit);
	}
	if (uVoxel.x > 0.01) {
		float vm = uVoxelP.x;
		float amp = uVoxelP.w;
		float g = mix(0.3, mix(0.035, 0.07, uFlat), clamp(uVoxel.x, 0.0, 1.0)) * uVoxelP.z;
		if (vm > 1.5 && vm < 2.5) g *= 1.0 + 0.35 * sin(t * uVoxelP.y * 2.0);
		vec3 cell = floor(pos / g);
		vec3 q = (cell + 0.5) * g;
		if (vm > 0.5 && vm < 1.5) {
			float h2 = hash11(dot(cell, vec3(12.9, 78.2, 37.7)));
			q.y += (h2 - 0.5) * g * 2.0 * amp * sin(t * uVoxelP.y * 1.5 + h2 * 6.2831);
		} else if (vm > 2.5 && vm < 3.5) {
			// волна: высота кубов бежит по сетке
			q.y += sin(dot(cell.xz, vec2(0.7, 0.5)) * 0.55 - t * uVoxelP.y * 2.0) * g * 1.6 * amp;
		} else if (vm > 3.5 && vm < 4.5) {
			// ступени: высота квантуется в террасы
			float stp = g * 2.0 * max(amp, 0.3);
			q.y = (floor((pos.y - uYR.x) / stp) + 0.5) * stp + uYR.x;
		} else if (vm > 4.5) {
			// разлёт: каждый куб дрожит вокруг своего места
			vec3 hv = vec3(hash11(dot(cell, vec3(12.9, 78.2, 37.7))), hash11(dot(cell, vec3(39.3, 11.1, 52.7))), hash11(dot(cell, vec3(7.7, 91.3, 23.9)))) - 0.5;
			q += hv * g * 3.0 * amp * (0.5 + 0.5 * sin(t * uVoxelP.y * 2.0 + hv.x * 12.0));
		}
		// на фото кубики получают высоту по яркости: мозаика из столбиков, видная под углом
		q.z += uFlat * (gLum - 0.5) * g * 9.0;
		pos = mix(pos, q, smoothstep(0.0, 0.25, uVoxel.x));
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
attribute vec3 aNormalB;
attribute vec3 aColorB;
attribute float aHide;
attribute float aDepth;
attribute float aPath;
uniform float uAdd;
uniform highp sampler2DArray uFrTex;
uniform sampler2D uHeroTex;
attribute vec2 aVis;
uniform vec3 uSolid;
uniform float uAtt;
uniform float uSize;
uniform float uPR;
uniform vec3 uGlyph;
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
varying float vDk;
varying float vCoc;
varying float vGl;
` + common + `
#ifdef HERO
#define HEROSIZE clamp(sqrt(uFr.z / max(uHero.z, 1.0)), 0.4, 1.0)
#else
#define HEROSIZE uFr6.x
#endif
void main() {
	if (aHide > 0.5) {
		// точка скрыта фильтром «Медиа»
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
		vColor = vec3(0.0);
		vD = 0.0;
		vCoc = 0.0;
		vGl = 0.0;
		return;
	}
	// раскадровка: цвет берётся из текстуры кадров, невидимые кадры отсекаются сразу
	vec3 frCol = vec3(1.0);
	vec3 frNrm = vec3(0.0, 0.0, 1.0);
	float frLift = 0.0;
	float frAp = -1.0;
	if (uFr.x > 0.5) {
		float fk;
		vec2 fcell;
		vec3 fp = frBlockPos(aIdx, frNrm, fk, fcell);
#ifdef HERO
		frAp = (fcell.y + fcell.x / uHero.x) / uHero.y;
#else
		frAp = (fcell.y + fcell.x / uFr2.x) / uFr2.y;
#endif
		vec3 tcol;
		vec4 sh = frShow(fk, tcol);
#ifdef HERO
		// главный кадр показывается как есть, без подсветки и затемнения
		if (uFr4.y < 0.5) sh.x = 1.0;
#endif
		bool cull = sh.x < 0.02;
		// без свечения затухание цветом дало бы чёрные точки: вместо этого точки гаснут рассыпаясь (часть выпадает), а цвет остаётся
		if (uAdd < 0.5 && sh.x < 1.0) {
			if (fract(sin(dot(fcell, vec2(39.346, 11.135)) + fk * 1.713) * 24634.6345) > sh.x) cull = true;
		}
		// без свечения цвет точек всегда как в видео: яркость кадров здесь меняется только числом точек
		if (uAdd < 0.5) sh.x = 1.0;
#ifndef HERO
		// текущий кадр рисуется густым набором точек, поэтому в блоке его место пустое
		if (uHero.w > 0.5 && abs(fk - floor(uFr4.x + 0.5)) < 0.1) cull = true;
		// прошлые и будущие кадры редеют с расстоянием от текущего: рядом все точки, далеко только часть
		float dl = abs(fk - uFr4.x);
		float keep = mix(1.0, clamp(1.0 / (1.0 + dl * 0.45), 0.08, 1.0), uFr5.y);
		float hs = fract(sin(dot(fcell, vec2(12.9898, 78.233)) + fk * 0.731) * 43758.5453);
		if (dl > 0.5 && hs > keep) cull = true;
		// длина хвоста: за ней кадры пропадают, а перед ней точки редеют тем плавнее, чем больше «плавность»
		if (uFr7.x < 0.999) {
			float tx = dl / max(uFr7.x * uFr.y, 1.0);
			if (tx >= 1.0 || hs > 1.0 - smoothstep(min(1.0 - uFr7.z, 0.999), 1.0, tx)) cull = true;
		}
#endif
		if (cull) {
			gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
			gl_PointSize = 0.0;
			vColor = vec3(0.0);
			vD = 0.0;
			vCoc = 0.0;
			vGl = 0.0;
			return;
		}
		int layer = int(mod(fk + uFr5.x, uFr.y));
#ifdef HERO
		vec3 fc = texture2D(uHeroTex, vec2((fcell.x + 0.5) / uHero.x, 1.0 - (fcell.y + 0.5) / uHero.y)).rgb;
#else
		vec3 fc = texelFetch(uFrTex, ivec3(int(fcell.x), int(fcell.y), layer), 0).rgb;
#endif
#ifndef HERO
		fc = min(fc * uFr5.w, vec3(1.6));
		// насыщенность: ноль это цвета видео, плюс сочнее, минус ближе к серому
		if (abs(uFr7.y) > 0.001) fc = max(mix(vec3(dot(fc, vec3(0.3, 0.59, 0.11))), fc, 1.0 + uFr7.y * (uFr7.y > 0.0 ? 2.0 : 1.0)), 0.0);
		// отбор по тону: остаются только светлые или только тёмные точки остальных кадров
		if (uFr6.z > 0.5) {
			float lt = pow(dot(fc, vec3(0.3, 0.59, 0.11)), 0.4545);
			if (uFr6.z < 1.5 ? lt < uFr6.w : lt > uFr6.w) {
				gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
				gl_PointSize = 0.0;
				vColor = vec3(0.0);
				vD = 0.0;
				vCoc = 0.0;
				vGl = 0.0;
				return;
			}
		}
#endif
		float l = dot(fc, vec3(0.3, 0.59, 0.11));
		frCol = (fc * (1.0 - sh.z) + tcol * (0.35 + l * 1.6) * sh.z) * sh.x;
		frLift = sh.y;
	}
	vec3 base;
	float maskV;
	gDepth = aDepth;
	gLum = uFr.x > 0.5 ? dot(frCol, vec3(0.3, 0.59, 0.11)) : dot(aColor, vec3(0.3, 0.59, 0.11));
	if (uScope.x > 0.001) {
		// акселерограф: aPath это место точки на пути пера (0..1), uScope.z это положение пера, у ещё не нарисованных точек размер падает до нуля
		bool rv = uScope.y > 1.5;
		float cm = rv ? uScope.y - 2.0 : uScope.y;
		// в раскадровке путь это строчная развёртка кадра (точки формы там не видны), иначе перо шло бы по невидимым точкам
		float ap0 = frAp >= 0.0 ? frAp : aPath;
		float ap = rv ? 1.0 - ap0 : ap0;
		if (uScopeP.w > 1.5) ap = fract(ap * uScopeP.w);
		float sAge = uScope.z - ap;
		float hideAll = (ap < uScopeP.z ? 1.0 : 0.0) * min(1.0, uScopeP.x * 4.0);
		if (sAge >= 0.0) {
			gScopeT = (cm < 0.5 ? 1.0 : exp(-sAge * 4.0 / max(uScope.w, 0.02))) * uScopeP.y;
			gScopeG = exp(-sAge * 45.0) * uScopeP.y;
			// стирание: перо идёт по следу второй раз и съедает нарисованное, на кромке светится
			if (uScopeP.z > 0.0 && ap >= uScopeP.z) gScopeG = max(gScopeG, exp(-(ap - uScopeP.z) * 45.0));
			gScopeD = hideAll;
		} else gScopeD = max(clamp(uScopeP.x * uScope.x * 1.6, 0.0, 1.0), hideAll);
	}
	vec3 pos = fxDisplace(aOrigin, aTarget, aIdx, base, maskV);
	pos += aSculpt;
	if (gScopeG > 0.01) pos += (vec3(hash11(aIdx * 13.1), hash11(aIdx * 7.7), hash11(aIdx * 3.3)) - 0.5) * gScopeG * uScopeQ.w * 0.4;
	if (uFr.x > 0.5) pos += frNrm * frLift * 0.7;
	float dkv = disK(base, aIdx);
	vDk = max(max(dkv, gDrop), 1.0 - gGrow);
	float t = uTime - uTOff;
	float disp = clamp(length(pos - base) * 1.5, 0.0, 1.0);
	float k;
	if (uColorBy < 0.5) k = clamp(disp + uBeat * 0.12, 0.0, 1.0);
	else if (uColorBy < 1.5) k = clamp((pos.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	else k = fract(aIdx * 3.0 + t * 0.03);
	vec3 col = k < 0.5 ? mix(uP0, uP1, k * 2.0) : mix(uP1, uP2, (k - 0.5) * 2.0);
	// цвет и нормаль плавно перетекают вместе с формой
	float ltC = uMorph < 0.9999 ? morphLocal(aOrigin, aTarget, aIdx) : 1.0;
	float eC = uMorph < 0.9999 ? (int(uMorphS.x + 0.5) == 2 ? smoothstep(0.5, 0.9, ltC) : morphEase(ltC)) : 1.0;
	vec3 colM = mix(aColor, aColorB, eC);
	if (uFr.x > 0.5) colM = frCol;
	vec3 nrmM = mix(aNormal, aNormalB, eC);
	if (uColorBy > 2.5 && uColorBy < 3.5) col = colM;
	else if (uColorBy > 3.5 && uColorBy < 4.5) col = uSolid;
	else if (uColorBy > 4.5) {
		vec3 wn = mat3(modelMatrix) * nrmM;
		wn = length(wn) > 0.0 ? normalize(wn) : vec3(0.0, 1.0, 0.0);
		col = pow(wn * 0.5 + 0.5, vec3(2.2));
	}
	// видимость точки при морфинге между моделями с разным числом точек: лишние плавно гаснут, недостающие проявляются
	float vm = uMorph * uMorph * (3.0 - 2.0 * uMorph);
	float vis = mix(aVis.x, aVis.y, vm);
	vColor = col * uBright * (1.0 + uBeat * 0.3) * vis;
	if (uMask.x > 0.5 && uMaskShow > 0.5) vColor = mix(vColor, uP2 * 1.4, maskV * 0.55);
	// объём: свет сверху слева по нормалям, обратная сторона формы темнее
	if (uShade > 0.001 && dot(nrmM, nrmM) > 0.01) {
		vec3 nv = normalize(normalMatrix * nrmM);
		float lit = dot(nv, normalize(vec3(-0.45, 0.65, 0.6)));
		float f = 0.18 + 1.05 * pow(clamp(lit * 0.5 + 0.5, 0.0, 1.0), 1.6);
		f *= nv.z < 0.0 ? mix(1.0, 0.55, clamp(-nv.z * 1.6, 0.0, 1.0)) : 1.0;
		vColor *= mix(1.0, f, uShade);
	}
	vGl = clamp(sqrt(max(dot(vColor, vec3(0.3, 0.59, 0.11)), 0.0)) * 0.85 + (hash11(aIdx * 1.7) - 0.5) * 0.35, 0.0, 1.0);

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
	// Исчезновение точек в местах касания: плавно гаснут без подсветки края
	float cvan = 0.0;
	if (uContact.z > 6.5 && uContact.x > 0.001) {
		cvan = contactK(base);
		vColor *= 1.0 - smoothstep(0.1, 0.8, cvan);
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
			vColor += (uSliceM.z > 0.5 ? vColor * 0.25 : uSliceC) * sl * 2.4;
		} else {
			float coord = mod(v * nLines - uSlice.y * nLines, 1.0);
			sl = (1.0 - smoothstep(uSlice.z * 0.4, uSlice.z, abs(coord - 0.5))) * uSlice.x;
			vColor += (uSliceM.z > 0.5 ? vColor * 0.25 : uSliceC) * sl * 2.2;
		}
	}
	// глубина: показ карты или окраска по глубине, блики сканера и контуров
	if (uDepth.x > 0.001) {
		if (uDepthP.w > 1.5) {
			// цвет глубины: от синего (далеко) через жёлтый к красному (близко), яркость берётся от кадра, чтобы не пропали детали
			vec3 jet = clamp(vec3(1.5 - abs(4.0 * gDepth - 3.0), 1.5 - abs(4.0 * gDepth - 2.0), 1.5 - abs(4.0 * gDepth - 1.0)), 0.0, 1.0);
			vColor = mix(vColor, jet * (0.4 + 0.95 * dot(vColor, vec3(0.3, 0.59, 0.11))), 0.88);
		} else if (uDepthP.w > 0.5) vColor = vec3(gDepth);
	}
	// акселерограф: линия окрашивается, голова пера горит
	if (uScope.x > 0.001) {
		vColor = mix(vColor, uScopeC * 1.4, uScopeQ.x * gScopeT);
		vColor += uScopeC * gScopeG * uScopeQ.z * 3.0;
	}
	// глитч: мерцание, строки-помехи и раздельные цветовые каналы
	if (gGl > 0.0) {
		vColor *= 0.55 + 0.45 * hash11(floor(uTime * 24.0) + floor(pos.y * 14.0));
		vColor *= 1.0 - 0.45 * min(gGl, 1.0) * step(0.5, fract(pos.y * 38.0));
		if (gCh > -0.5) vColor = mix(vColor, vColor * vec3(gCh < 0.5 ? 2.2 : 0.05, abs(gCh - 1.0) < 0.5 ? 2.2 : 0.05, gCh > 1.5 ? 2.2 : 0.05), min(1.0, gGl));
		// в момент всплеска сбойные места вспыхивают
		vColor += vec3(0.25, 0.3, 0.35) * gBurst * min(gGl, 1.0);
	}
	// росток: на фронте роста точки вспыхивают свежей зеленью в тон палитре
	if (uGrowP.z > 0.5) vColor += mix(vec3(0.3, 0.95, 0.4), uP2, 0.3) * pow(gGrowE, 1.6) * 0.55;
	// светящаяся кромка растворения: у горения огненная, у остальных цвета палитры, яркость задаёт настройка
	if (dkv > 0.0) {
		float edge = smoothstep(0.02, 0.25, dkv) * (1.0 - smoothstep(0.25, 0.75, dkv));
		if (uDisP.x > 0.5 && uDisP.x < 1.5) vColor += vec3(1.0, 0.42, 0.08) * edge * 2.4;
		else vColor += uP2 * edge * uDisQ.z * 2.0;
	}
	// вспышка в момент перехода: точки в пути ярче и крупнее
	float mkm = 0.0;
	if (uMorph < 0.9999 && uMorphO.z > 0.001) {
		mkm = sin(morphLocal(aOrigin, aTarget, aIdx) * PI) * uMorphO.z;
		vColor += vColor * mkm * 1.1 + uP2 * mkm * 0.25;
	}
	// после сборки по форме снизу вверх пробегает мягкая волна света и лёгкий «вздох», как будто модель села на место
	if (uSettle >= 0.0 && uSettle < 1.0) {
		float yS = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float dd = (yS - (uSettle * 1.35 - 0.15)) / 0.14;
		float band = exp(-dd * dd) * (1.0 - uSettle);
		mkm += band * 1.0;
		vColor += vColor * band * 0.9 + uP2 * band * 0.2;
		pos += normalize(vec3(pos.x, 0.0, pos.z) + vec3(1e-4)) * band * 0.03;
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

	float s = uSize * uPR * (1.0 + disp * 0.5 + uBeat * 0.2 + sl * 1.2 + mkm * 0.7) * uGlyph.y * HEROSIZE;
	s *= max(0.15, szNoise * szAudio) * (1.0 - uDisQ.w * dkv) * mix(0.3, 1.0, gGrow) * (1.0 + (uMark.x > 3.5 && uMark.x < 4.5 ? mkv * 0.9 : 0.0)) * (1.0 - 0.6 * (uMark.x > 2.5 && uMark.x < 3.5 ? smoothstep(0.35, 0.9, mkv) : 0.0)) * (1.0 - 0.7 * smoothstep(0.3, 0.8, cvan)) * (0.25 + 0.75 * vis);
	s *= (1.0 + coc * 2.4);
	s *= (1.0 + gScopeT * uScopeQ.y + gScopeG * uScopeQ.z * 2.5 + gDepthG * 0.8) * (1.0 - gScopeD);
	s *= uAtt > 0.5 ? 3.8 / max(-mv.z, 0.4) : 0.73;
	gl_PointSize = clamp(s, 1.0, 95.0);
	if (gScopeD > 0.97 || dkv > 0.97 || gDrop > 0.5 || gGrow < 0.03) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
	}
}
`;

const frag = /* glsl */ `
precision highp float;
uniform float uGlow;
uniform float uAdd;
uniform vec4 uFr;
uniform float uDens;
uniform float uGhost;
uniform float uShape;
uniform vec3 uGlyph;
uniform sampler2D uAtlas;
varying vec3 vColor;
varying float vD;
varying float vDk;
varying float vCoc;
varying float vGl;
void main() {
	vec2 c = gl_PointCoord - 0.5;
	// форма точки как на вкладке «Точки»: 0 квадрат, 1 круг, 2 шар, 3 кольцо, 4 ромб, 5 плюс
	float dm = length(c);
	float gA = 1.0;
	if (uGlyph.x > 0.5) {
		vec2 guv = vec2((floor(vGl * (uGlyph.z - 0.001)) + gl_PointCoord.x) / uGlyph.z, 1.0 - gl_PointCoord.y);
		gA = texture2D(uAtlas, guv).a;
		if (gA < 0.3) discard;
		dm = 0.0;
	}
	if (uShape < 0.5) dm = max(abs(c.x), abs(c.y));
	else if (uShape > 3.5 && uShape < 4.5) dm = abs(c.x) + abs(c.y);
	if (dm > 0.5) discard;
	if (uShape > 2.5 && uShape < 3.5 && dm < 0.29) discard;
	if (uShape > 4.5 && min(abs(c.x), abs(c.y)) > 0.16) discard;
	float r2 = dm * dm;
	float core = uGlyph.x > 0.5 ? gA : 1.0 - smoothstep(0.0, 0.25, r2);
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
		vec3 col = (vColor * (0.08 + aura * (0.2 + uGlow * 0.28)) + vColor * vD * 0.08) * uDens * uGhost * dofAlpha * sph * (1.0 - vDk);
		float ga = core * uGhost * dofAlpha * (1.0 - vDk);
		// тёмные места видео должны быть прозрачными, а не чёрными: яркость точки определяет и её непрозрачность
		if (uFr.x > 0.5) ga *= clamp(dot(vColor, vec3(0.3, 0.59, 0.11)) * 5.0, 0.0, 1.0);
		gl_FragColor = vec4(col, ga);
	} else {
		// у кадров видео точка плоская, без затемнения к краю: цвет остаётся точным
		gl_FragColor = vec4(vColor * (uFr.x > 0.5 ? 1.0 : 0.55 + 0.45 * core) * sph, dofAlpha * (1.0 - vDk));
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
attribute float aDepth;
attribute float aDepthB;
attribute float aEnd;
attribute float aSide;
uniform vec3 uP0;
uniform vec3 uP1;
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
	gDepth = aDepth;
	vec3 pA = fxDisplace(aOrigin, aTarget, aIdx, bA, mA);
	gDepth = aDepthB;
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

const scopeVert = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aTarget;
attribute float aIdx;
attribute vec3 aOriginB;
attribute vec3 aTargetB;
attribute float aIdxB;
attribute float aDepth;
attribute float aDepthB;
attribute float aEnd;
attribute float aSide;
attribute float aSeg;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform vec2 uRes;
uniform float uScopeW;
uniform float uScopeLB;
varying vec3 vC;
varying float vA;
varying float vSide;
` + common + `
void main() {
	vec3 bA, bB;
	float mA, mB;
	gDepth = aDepth;
	vec3 pA = fxDisplace(aOrigin, aTarget, aIdx, bA, mA);
	gDepth = aDepthB;
	vec3 pB = fxDisplace(aOriginB, aTargetB, aIdxB, bB, mB);
	bool rv = uScope.y > 1.5;
	float cm = rv ? uScope.y - 2.0 : uScope.y;
	float sp = rv ? 1.0 - aSeg : aSeg;
	if (uScopeP.w > 1.5) sp = fract(sp * uScopeP.w);
	float age = uScope.z - sp;
	float lit = age < 0.0 || aSeg < 0.0 ? 0.0 : (cm < 0.5 ? 1.0 : exp(-age * 4.0 / max(uScope.w, 0.02))) * uScopeP.y;
	vA = lit * step(uScopeP.z, sp) * uScope.x * min(1.0, uScope.x * 2.0) * uScopeLB;
	vC = uScopeC * (1.0 + exp(-max(age, 0.0) * 45.0) * uScopeQ.z * 2.0);
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
	c.xy += nrm * aSide * (uScopeW + 1.0) / uRes.y * c.w;
	gl_Position = c;
}
`;

const scopeFrag = /* glsl */ `
precision highp float;
varying vec3 vC;
varying float vA;
varying float vSide;
void main() {
	float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
	gl_FragColor = vec4(vC * (vA * edge), vA * edge);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
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
		this.playing = false;
		this.mode = 'ambient';
		this.bpm = 66;
		this.gain = null;
		this.step = 0;
		this.next = 0;
		this._noise = null;
	}

	/** Все источники регистрируются, чтобы при смене трека их можно было сразу остановить */
	_reg(node) {
		(this._nodes ||= new Set()).add(node);
		node.addEventListener('ended', () => this._nodes.delete(node));
		return node;
	}
	_osc() {
		return this._reg(this.ctx.createOscillator());
	}
	_src() {
		return this._reg(this.ctx.createBufferSource());
	}

	_noiseBuf() {
		if (!this._noise) {
			const n = this.ctx.sampleRate;
			const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
			const d = b.getChannelData(0);
			for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
			this._noise = b;
		}
		return this._noise;
	}

	start(mode = 'ambient') {
		this.stop();
		const P = SYNTH_PARAMS[mode] || SYNTH_PARAMS.ambient;
		this.mode = SYNTH_PARAMS[mode] ? mode : 'ambient';
		this.bpm = P.bpm;
		const c = this.ctx;
		this.gain = c.createGain();
		this.gain.gain.value = P.master;
		this.gain.connect(this.dest);
		// эхо-«реверб»: точечная восьмая с затухающей обратной связью и срезом верха
		this.send = c.createGain();
		const dl = c.createDelay(2);
		dl.delayTime.value = (60 / this.bpm) * 0.75;
		const fb = c.createGain();
		fb.gain.value = P.fb;
		const lp = c.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = 2200;
		const wet = c.createGain();
		wet.gain.value = P.wet;
		this.send.connect(dl);
		dl.connect(lp);
		lp.connect(fb);
		fb.connect(dl);
		lp.connect(wet);
		wet.connect(this.gain);
		// барабаны идут через общую шину, в брейккоре с перегрузом
		this.drums = c.createGain();
		if (P.drive) {
			const ws = c.createWaveShaper();
			const curve = new Float32Array(1024);
			for (let i = 0; i < 1024; i++) {
				const x = i / 512 - 1;
				curve[i] = Math.tanh(x * P.drive);
			}
			ws.curve = curve;
			this.drums.connect(ws);
			ws.connect(this.gain);
		} else this.drums.connect(this.gain);
		this.playing = true;
		this.step = 0;
		this.next = c.currentTime + 0.06;
		this.timer = setInterval(() => this._pump(), 25);
	}

	stop() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		const c = this.ctx;
		const g = this.gain;
		const now = c.currentTime;
		if (g) {
			try {
				g.gain.cancelScheduledValues(now);
				g.gain.setValueAtTime(g.gain.value, now);
				g.gain.linearRampToValueAtTime(0, now + 0.1);
			} catch (_) {}
			setTimeout(() => {
				try {
					g.disconnect();
				} catch (_) {}
			}, 300);
			this.gain = null;
		}
		// все ещё звучащие голоса прежнего трека останавливаем, чтобы они не накладывались на новый
		for (const n of this._nodes || []) {
			try {
				n.stop(now + 0.12);
			} catch (_) {}
		}
		this._nodes = new Set();
		this.playing = false;
	}

	_pump() {
		if (!this.playing || this.ctx.state === 'suspended') return;
		const spb = 60 / this.bpm / 4;
		let guard = 0;
		while (this.next < this.ctx.currentTime + 0.15 && guard++ < 8) {
			this._sched(this.step, this.next, spb);
			this.next += spb;
			this.step++;
		}
		if (this.next < this.ctx.currentTime - 0.5) this.next = this.ctx.currentTime + 0.05;
	}

	// ---- голоса
	_kick(t, vol = 1, f0 = 150, f1 = 42, len = 0.2) {
		const c = this.ctx;
		const o = this._osc();
		const g = c.createGain();
		o.type = 'sine';
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(f1, t + 0.09);
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + len);
		o.connect(g);
		g.connect(this.drums);
		o.start(t);
		o.stop(t + len + 0.02);
	}
	_snare(t, vol = 0.8, tone = 190, len = 0.15) {
		const c = this.ctx;
		const n = this._src();
		n.buffer = this._noiseBuf();
		const hp = c.createBiquadFilter();
		hp.type = 'highpass';
		hp.frequency.value = 1400;
		const g = c.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + len);
		n.connect(hp);
		hp.connect(g);
		g.connect(this.drums);
		n.start(t, Math.random() * 0.5);
		n.stop(t + len + 0.02);
		const o = this._osc();
		const og = c.createGain();
		o.type = 'triangle';
		o.frequency.setValueAtTime(tone, t);
		o.frequency.exponentialRampToValueAtTime(tone * 0.6, t + 0.08);
		og.gain.setValueAtTime(vol * 0.5, t);
		og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
		o.connect(og);
		og.connect(this.drums);
		o.start(t);
		o.stop(t + 0.12);
	}
	_hat(t, vol = 0.2, len = 0.04) {
		const c = this.ctx;
		const n = this._src();
		n.buffer = this._noiseBuf();
		const hp = c.createBiquadFilter();
		hp.type = 'highpass';
		hp.frequency.value = 7000;
		const g = c.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + len);
		n.connect(hp);
		hp.connect(g);
		g.connect(this.drums);
		n.start(t, Math.random() * 0.5);
		n.stop(t + len + 0.01);
	}
	_sub(t, f, len, vol) {
		const c = this.ctx;
		const o = this._osc();
		const g = c.createGain();
		o.type = 'sine';
		o.frequency.value = f;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
		g.gain.exponentialRampToValueAtTime(0.0001, t + len);
		o.connect(g);
		g.connect(this.gain);
		o.start(t);
		o.stop(t + len + 0.05);
	}
	_reese(t, f, len, vol) {
		const c = this.ctx;
		const g = c.createGain();
		const lp = c.createBiquadFilter();
		lp.type = 'lowpass';
		lp.Q.value = 4;
		lp.frequency.setValueAtTime(420, t);
		lp.frequency.exponentialRampToValueAtTime(110, t + len);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
		g.gain.exponentialRampToValueAtTime(0.0001, t + len);
		lp.connect(g);
		g.connect(this.gain);
		for (const det of [-7, 7]) {
			const o = this._osc();
			o.type = 'sawtooth';
			o.frequency.value = f;
			o.detune.value = det;
			o.connect(lp);
			o.start(t);
			o.stop(t + len + 0.05);
		}
	}
	_pad(t, freqs, len, vol) {
		const c = this.ctx;
		for (const f of freqs) {
			const g = c.createGain();
			const lp = c.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.setValueAtTime(500, t);
			lp.frequency.linearRampToValueAtTime(1500, t + len * 0.5);
			lp.frequency.linearRampToValueAtTime(600, t + len);
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(vol, t + len * 0.35);
			g.gain.exponentialRampToValueAtTime(0.0001, t + len);
			lp.connect(g);
			g.connect(this.gain);
			g.connect(this.send);
			for (const [type, det] of [['sine', 0], ['triangle', 5], ['sine', -5]]) {
				const o = this._osc();
				o.type = type;
				o.frequency.value = f;
				o.detune.value = det;
				o.connect(lp);
				o.start(t);
				o.stop(t + len + 0.05);
			}
		}
	}
	_bell(t, f, vol) {
		const c = this.ctx;
		const g = c.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
		g.connect(this.gain);
		g.connect(this.send);
		for (const [mul, a] of [[1, 1], [2.01, 0.3], [3.98, 0.12]]) {
			const o = this._osc();
			const og = c.createGain();
			o.type = 'sine';
			o.frequency.value = f * mul;
			og.gain.value = a;
			o.connect(og);
			og.connect(g);
			o.start(t);
			o.stop(t + 2.7);
		}
	}
	/** Мягкая щипковая нота (как арфа в зале): короткая атака, длинный затухающий хвост с эхом */
	_pluck(t, f, vol) {
		const c = this.ctx;
		const g = c.createGain();
		const lp = c.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.setValueAtTime(3200, t);
		lp.frequency.exponentialRampToValueAtTime(700, t + 1.4);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
		lp.connect(g);
		g.connect(this.gain);
		g.connect(this.send);
		for (const [type, mul, a] of [['triangle', 1, 1], ['sine', 2, 0.35], ['sine', 3.01, 0.12]]) {
			const o = this._osc();
			const og = c.createGain();
			o.type = type;
			o.frequency.value = f * mul;
			og.gain.value = a;
			o.connect(og);
			og.connect(lp);
			o.start(t);
			o.stop(t + 2.3);
		}
	}
	_blip(t, f, len, vol) {
		const c = this.ctx;
		const o = this._osc();
		const g = c.createGain();
		o.type = 'square';
		o.frequency.setValueAtTime(f, t);
		o.frequency.exponentialRampToValueAtTime(f * 0.5, t + len);
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + len);
		o.connect(g);
		g.connect(this.drums);
		g.connect(this.send);
		o.start(t);
		o.stop(t + len + 0.01);
	}


	_sched(step, t, spb) {
		const s = step % 32;
		const bar = Math.floor(step / 32);
		if (this.mode === 'ambient') {
			const chords = [
				[110, 220, 329.63, 392, 493.88],
				[87.31, 174.61, 261.63, 329.63, 440],
				[65.41, 130.81, 261.63, 392, 493.88],
				[98, 196, 293.66, 392, 493.88],
			];
			const ch = chords[bar % 4];
			if (s === 0) {
				this._pad(t, ch, 32 * spb + 1.8, 0.04);
				this._sub(t, ch[0] / 2, 32 * spb * 0.85, 0.22);
			}
			if (s % 2 === 0 && Math.random() < 0.14) this._bell(t, ch[2 + Math.floor(Math.random() * 3)] * (Math.random() < 0.5 ? 2 : 4), 0.07);
			if (Math.random() < 0.05) this._hat(t, 0.025, 0.03);
			return;
		}
		if (this.mode === 'deep') {
			// тихая глубина: длинные пады на ладу ре минор, мягкая бегущая нота и редкие капли с эхом
			const chords = [
				[73.42, 110, 146.83, 174.61, 220, 329.63],
				[58.27, 87.31, 146.83, 220, 261.63, 392],
				[49, 73.42, 116.54, 174.61, 220, 293.66],
				[55, 82.41, 196, 261.63, 329.63, 493.88],
			];
			const ch = chords[bar % 4];
			if (s === 0) {
				this._pad(t, ch, 32 * spb + 3, 0.03);
				this._sub(t, ch[0] / 2, 32 * spb, 0.16);
				// высокое «сияние»: две тихие октавы, плывущие над аккордом
				this._pad(t + 1.5, [ch[4] * 2, ch[5] * 2], 32 * spb, 0.012);
			}
			// неспешное арпеджио по тонам аккорда: каждый такт чуть иначе, поэтому не надоедает
			const arp = [0, 3, 6, 10, 13, 16, 19, 22, 26, 29];
			const ai = arp.indexOf(s);
			if (ai >= 0 && !(bar % 2 === 1 && ai % 3 === 2)) {
				const order = [2, 3, 4, 3, 5, 4, 3, 2, 4, 5];
				const shift = bar % 4 === 2 ? 1 : 0;
				this._pluck(t, ch[Math.min(5, order[ai] + shift)] * (ai % 4 === 3 ? 2 : 1), 0.05);
			}
			if (s % 4 === 0 && Math.random() < 0.1) this._bell(t, ch[3 + Math.floor(Math.random() * 3)] * (Math.random() < 0.5 ? 2 : 1), 0.045);
			return;
		}
		// мягкий джангл
		const roots = [41.2, 43.65, 36.71, 49];
		const root = roots[bar % 4];
		if ([0, 10, 16, 26].includes(s)) this._kick(t, 0.7, 120, 48, 0.22);
		if ([4, 12, 20, 28].includes(s)) this._snare(t, 0.4, 190, 0.14);
		if ([7, 23].includes(s) && Math.random() < 0.5) this._snare(t, 0.12, 230, 0.07);
		if (s % 4 === 2) this._hat(t, 0.07, 0.035);
		if ([0, 10, 16, 26].includes(s)) this._reese(t, s === 10 || s === 26 ? root * 2 : root, spb * 4, 0.2);
		if (s === 0) this._pad(t, [root * 4, root * 4.8, root * 6, root * 7.2, root * 9], 32 * spb + 1, 0.04);
		if (s % 8 === 5 && Math.random() < 0.4) this._bell(t, root * 12, 0.05);
	}
}

const SYNTH_PARAMS = {
	deep: { bpm: 48, master: 0.95, fb: 0.6, wet: 0.6 },
	ambient: { bpm: 66, master: 0.85, fb: 0.5, wet: 0.5 },
	jungle: { bpm: 150, master: 0.55, fb: 0.4, wet: 0.35 },
};


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
				uTint: { value: new THREE.Color(1, 1, 1) },
				uTintK: { value: 0.0 },
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
				uniform vec3 uTint;
				uniform float uTintK;
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
							// хвост постепенно уходит в цвет палитры
							prev.rgb = mix(prev.rgb, prev.rgb * uTint * 1.7, uTintK * 0.07);
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
			const tun = feedbackCfg.mode === 'tunnel';
			const zoom = tun ? feedbackCfg.zoom || 1.0 : 1.0;
			const twist = tun ? feedbackCfg.twist || 0.0 : 0.0;
			const decay = Math.min(0.99, feedbackCfg.amount || 0.92);
			this.fbMat.uniforms.uTint.value.copy(this.tint || new THREE.Color(1, 1, 1));
			this.fbMat.uniforms.uTintK.value = feedbackCfg.tint ?? 0.5;

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
		// «Живая сцена без звука» по умолчанию выключена; у тех, кто её не трогал сам, прежнее сохранённое «включено» сбрасываем
		if (!this.state.audio.idleSet) this.state.audio.idle = false;
		this.state.mask = { ...defaultState().mask }; // зона действия убрана из интерфейса: эффекты всегда работают на всей форме
		for (const l of FX_LAYERS) this.state.layers[l.id] = { ...AUDIO_DEF, ...l.def, ...this.state.layers[l.id] };
		this.state.look = { ...defaultState().look, ...this.state.look };
		// у срезов, сохранённых раньше, линии теперь по умолчанию естественного цвета модели
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
		this.post = null;
		this.camTracker = null;
		this._pointerDown = false;
	}

	// ------------------------------------------------------------ раскадровка видео
	// Кадры лежат в одной текстуре на видеокарте (слой на кадр). Положения листов, показ, подсветка, шлейф и луч считаются
	// в шейдере по одному числу «текущий кадр», поэтому на каждый кадр процессор почти ничего не делает.
	/** Открыто видео (кадры можно брать, когда оно загружено) */
	get videoLoaded() {
		const pm = this.pm;
		return !!(pm && pm.ready && pm.kind === 'video' && pm.el);
	}

	get videoReady() {
		return this.videoLoaded && this.pm.el.readyState >= 2;
	}

	/** Номера раскладок для шейдера */
	_layoutId(name) {
		return Math.max(0, ['stack', 'wall', 'film', 'tunnel'].indexOf(name));
	}

	/** Снимок кадра видео в RGBA нужного размера: пишет прямо в out (кусок общего массива), лишних копий нет */
	_frameTaker(cols, rows, el) {
		const cv = document.createElement('canvas');
		cv.width = cols;
		cv.height = rows;
		const ctx = cv.getContext('2d', { willReadFrequently: true });
		return (out) => {
			ctx.drawImage(el || this.pm.el, 0, 0, cols, rows);
			out.set(ctx.getImageData(0, 0, cols, rows).data);
			return out;
		};
	}

	/** Второй, скрытый видеоэлемент с тем же файлом: кадры снимаются с него, а то, что вы смотрите и перематываете, не трогается */
	async _capVideo() {
		const src = this.pm.el.currentSrc || this.pm.el.src;
		const v = document.createElement('video');
		v.muted = true;
		v.playsInline = true;
		v.preload = 'auto';
		v.src = src;
		await new Promise((res, rej) => {
			v.onloadeddata = res;
			v.onerror = () => rej(new Error('не удалось открыть видео для съёмки кадров'));
			setTimeout(res, 8000);
		});
		return v;
	}

	_seekTo(el, t) {
		return new Promise((res) => {
			if (Math.abs(el.currentTime - t) < 0.02 && el.readyState >= 2) return res();
			const done = () => {
				el.removeEventListener('seeked', done);
				clearTimeout(to);
				res();
			};
			const to = setTimeout(done, 900);
			el.addEventListener('seeked', done);
			el.currentTime = t;
		});
	}

	/** Снимает n кадров видео в заданном разрешении со скрытой копии (для экспорта): возвращает массив RGBA */
	async captureFramesForExport(n, cols, rows, onProgress) {
		const cap = await this._capVideo();
		try {
			const take = this._frameTaker(cols, rows, cap);
			const dur = cap.duration || this.pm.el.duration || 1;
			const out = [];
			for (let k = 0; k < n; k++) {
				await this._seekTo(cap, Math.min(Math.max(0.05, dur - 0.04), (k / Math.max(1, n - 1)) * dur));
				out.push(take(new Uint8Array(cols * rows * 4)));
				onProgress && onProgress((k + 1) / n);
			}
			return out;
		} finally {
			cap.removeAttribute('src');
			cap.load();
		}
	}

	/** Строка состояния съёмки в углу сцены (пока кадры доснимаются в фоне) */
	_capStatus(text) {
		if (!text) {
			this._capEl?.remove();
			this._capEl = null;
			return;
		}
		if (!this._capEl) {
			this._capEl = document.createElement('div');
			this._capEl.className = 'fx-cap';
			document.getElementById('viewport')?.append(this._capEl);
		}
		this._capEl.textContent = text;
	}

	/** Снимает указанные кадры со скрытого видео и сразу кладёт в слои общего массива */
	async _captureList(fr, list, onEach) {
		const take = (fr.take ||= this._frameTaker(fr.cols, fr.rows, fr.cap));
		for (const k of list) {
			if (fr.dead) return false;
			await this._seekTo(fr.cap, fr.times[k]);
			if (fr.dead) return false;
			take(fr.frames[k]);
			fr.done[k] = 1;
			onEach && onEach(k);
		}
		return true;
	}

	/** Незаснятые пока слои временно заполняются ближайшим снятым кадром: блок сразу целый, потом кадры уточняются */
	_fillGaps(fr) {
		const have = [];
		for (let k = 0; k < fr.n; k++) if (fr.done[k]) have.push(k);
		if (!have.length) return;
		for (let k = 0; k < fr.n; k++) {
			if (fr.done[k]) continue;
			let best = have[0];
			for (const j of have) if (Math.abs(j - k) < Math.abs(best - k)) best = j;
			fr.frames[k].set(fr.frames[best]);
		}
	}

	/** Дальше кадры снимаются в фоне, от редких к частым; каждый сразу появляется в блоке */
	async _refineFrames(fr, order) {
		const tex = this._frameTex;
		let count = fr.done.reduce((a, b) => a + b, 0);
		let batch = 0;
		const flush = () => {
			if (!batch || fr.dead || this._frameTex !== tex) return;
			tex.needsUpdate = true;
			batch = 0;
		};
		const ok = await this._captureList(fr, order, (k) => {
			count++;
			tex.addLayerUpdate && tex.addLayerUpdate(k);
			if (++batch >= 6) flush();
			if (count % 4 === 0) this._capStatus(`Снимаю кадры: ${Math.round((count / fr.n) * 100)}%`);
		});
		flush();
		if (!fr.dead) this._capStatus('');
		this._closeCap(fr);
		
	}

	_closeCap(fr) {
		if (!fr?.cap) return;
		fr.cap.removeAttribute('src');
		fr.cap.load();
		fr.cap = null;
		fr.take = null;
	}

	/** Общий массив кадров превращается в текстуру-массив: слой на кадр */
	_makeFrameTexture(data, cols, rows, n) {
		const tex = new THREE.DataArrayTexture(data, cols, rows, n);
		tex.format = THREE.RGBAFormat;
		tex.type = THREE.UnsignedByteType;
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.minFilter = tex.magFilter = THREE.NearestFilter;
		tex.generateMipmaps = false;
		tex.unpackAlignment = 1;
		tex.needsUpdate = true;
		return tex;
	}

	/** Выставляет параметры блока в шейдер (размер, раскладка, глубина) */
	_frameUniforms() {
		const fr = this._frames;
		const F = this.state.layers.frames;
		const u = this.shared;
		if (!fr) return;
		// материал точек пересоздаётся при смене источника и приносит заглушку вместо текстуры кадров: возвращаем настоящую
		if (this._frameTex && u.uFrTex.value !== this._frameTex) u.uFrTex.value = this._frameTex;
		const W = fr.aspect >= 1 ? 2.2 : 2.2 * fr.aspect;
		u.uFr.value.set(1, fr.n, fr.cols * fr.rows, fr.cols * fr.rows * fr.n);
		u.uFr2.value.set(fr.cols, fr.rows, W, W / fr.aspect);
		u.uFr3.value.x = F.depth;
		// после пересоздания материала раскладка в шейдере сбрасывается: возвращаем текущую
		if (!this._layoutAnim) u.uFr3.value.set(F.depth, this._layoutCur ?? 0, this._layoutCur ?? 0, 0);
	}

	/** Блок кадров: снимаем кадры, кладём в текстуру и показываем (точки перетекают из текущей формы) */
	async enableFrames() {
		if (this._framesBusy || !this.videoReady || !this.active) return;
		this._framesBusy = true;
		const F = this.state.layers.frames;
		try {
			this.app.ui.busy('Раскладываю видео на кадры', 0.05);
			const pm = this.pm;
			const aspect = (pm.el.videoWidth || 16) / (pm.el.videoHeight || 9);
			const dur = pm.el.duration || pm.duration || 1;
			const n = F.source === 'whole' && F.all === 'on' ? Math.max(4, Math.min(240, Math.round(dur * 24))) : Math.round(F.frames);
			const { cols, rows } = frameGrid(Math.max(300, F.budget / n), aspect);
			if (this._frames) {
				this._frames.dead = true;
				this._closeCap(this._frames);
			}
			const per = cols * rows * 4;
			// все кадры лежат в одном массиве (он же уходит в текстуру), у каждого кадра только ссылка на свой кусок
			const data = new Uint8Array(per * n);
			const frames = Array.from({ length: n }, (_, k) => data.subarray(k * per, (k + 1) * per));
			const fr = { frames, cols, rows, aspect, last: this._time, n, dur, head: 0, gain: 1, ts: null, done: new Uint8Array(n), times: null, cap: null, take: null, dead: false };
			let refine = null;
			if (F.source === 'whole') {
				fr.times = Array.from({ length: n }, (_, k) => Math.min(Math.max(0.05, dur - 0.04), (k / Math.max(1, n - 1)) * dur));
				fr.cap = await this._capVideo();
				// сначала редкие кадры (быстро, блок появляется сразу), остальное доснимается в фоне
				let step = 1;
				while (step * 2 <= Math.max(1, n / 12)) step *= 2;
				const first = [];
				const rest = [];
				const seen = new Set();
				const add = (k, arr) => {
					if (!seen.has(k)) {
						seen.add(k);
						arr.push(k);
					}
				};
				for (let k = 0; k < n; k += step) add(k, first);
				add(n - 1, first);
				for (let st = Math.floor(step / 2); st >= 1; st = Math.floor(st / 2)) for (let k = 0; k < n; k += st) add(k, rest);
				let got = 0;
				const ok = await this._captureList(fr, first, () => this.app.ui.busy('Раскладываю видео на кадры', 0.1 + 0.8 * (++got / first.length)));
				if (!ok || !F.on || !this.active) {
					fr.dead = true;
					this._closeCap(fr);
					return;
				}
				this._fillGaps(fr);
				refine = rest;
			} else {
				// бегущая лента начинается пустой и заполняется по ходу видео
				this._frameTaker(cols, rows)(frames[n - 1]);
				fr.done[n - 1] = 1;
			}
			if (!F.on || !this.active) {
				fr.dead = true;
				this._closeCap(fr);
				return;
			}
			fr.gain = 1;
			this._frameTex?.dispose();
			this._frameTex = this._makeFrameTexture(data, cols, rows, n);
			this.shared.uFrTex.value = this._frameTex;
			this._frames = fr;
			if (F.source === 'live') {
				// время видео, с которого снят каждый слой ленты: по нему перемотка таймлайна двигает видео вдоль ленты
				fr.ts = new Float32Array(n).fill(-1);
				fr.ts[n - 1] = pm.el.currentTime || 0;
				fr.tNew = pm.el.currentTime || 0;
			}
			// положения точек для переходов: считаем один раз, цвета не нужны (они в текстуре)
			this._frameCloud = buildFrameBlock(frames.map(() => this._blankFrame(cols, rows)), cols, rows, aspect, F.layout, F.depth, true);
			this._framesOn = true;
			this._layoutCur = this._layoutId(F.layout);
			this.shared.uFr3.value.set(F.depth, this._layoutCur, this._layoutCur, 0);
			this.cache.clear();
			this.state.look.colorBy = 'model';
			await this.setSource('frames');
			this._frameUniforms();
			this.shared.uFr5.value.x = 0;
			this._framesFit();
			if (refine) this._refineFrames(fr, refine);
		} catch (e) {
			console.error(e);
			this.app.toast('Не удалось разложить видео на кадры: ' + (e.message || e), 'error');
			F.on = false;
			this.shared.uFr.value.x = 0;
		} finally {
			this.app.ui.idle();
			this._framesBusy = false;
			this.emit();
		}
	}

	_blankFrame(cols, rows) {
		return (this._blank ||= new Uint8Array(cols * rows * 4));
	}

	async disableFrames() {
		if (!this._framesOn || this._framesBusy) return;
		const fr = this._frames;
		if (fr) {
			fr.dead = true;
			this._closeCap(fr);
		}
		this._capStatus('');
		// перед уходом переносим видимые цвета в атрибуты точек: дальше переход идёт обычным путём
		const g = this.geometry;
		if (fr && g && g.attributes.aColor && g.attributes.aColor.count === fr.cols * fr.rows * fr.n) {
			writeFrameColors(fr.frames, fr.cols, fr.rows, g.attributes.aColor.array, null, 4);
			g.attributes.aColorB.array.set(g.attributes.aColor.array);
			g.attributes.aColor.needsUpdate = g.attributes.aColorB.needsUpdate = true;
		}
		this._framesOn = false;
		this.shared.uFr.value.x = 0;
		this.shared.uHero.value.w = 0;
		if (this.hero) this.hero.visible = false;
		this._frames = null;
		this._frameCloud = null;
		this._frameTex?.dispose();
		this._frameTex = null;
		await this.setSource(this.pm.ready ? 'media' : this.hasModel ? 'model' : 'sphere');
		this.emit();
	}

	/** Поменялось число кадров, точек или источник: кадры снимаем заново (с паузой, пока двигается ползунок) */
	rebuildFramesSoon() {
		clearTimeout(this._framesT);
		this._framesT = setTimeout(async () => {
			if (!this._framesOn || this._framesBusy) return;
			this._framesOn = false;
			this.shared.uFr.value.x = 0;
			await this.enableFrames();
		}, 450);
	}

	/** Подъезжаем камерой так, чтобы весь блок помещался в кадр (для каждой раскладки свой размер) */
	_framesFit() {
		const F = this.state.layers.frames;
		const fr = this._frames;
		const nav = this.app.nav;
		if (!fr || !nav) return;
		const W = fr.aspect >= 1 ? 2.2 : 2.2 * fr.aspect;
		const H = W / fr.aspect;
		const R = { stack: Math.hypot(W / 2, H / 2, F.depth / 2), tunnel: Math.hypot(W / 2, H / 2, F.depth / 2), wall: 1.45, film: W * 1.35 }[F.layout] ?? 2;
		nav.animateTo({ distance: nav.fitDistance(R * 0.85), target: new THREE.Vector3(0, 0, 0) }, 450);
	}

	/** Поменялась раскладка или глубина: шейдер плавно перестраивает листы, а положения для переходов обновляются в фоне */
	relayoutFrames() {
		const F = this.state.layers.frames;
		const fr = this._frames;
		if (!this._framesOn || !fr) return;
		const target = this._layoutId(F.layout);
		this.shared.uFr3.value.x = F.depth;
		if (target !== this._layoutCur && !this._layoutAnim) {
			this._framesFit();
			this.shared.uFr3.value.z = target;
			this._layoutAnim = { t0: this._time, target };
		}
		clearTimeout(this._relayT);
		this._relayT = setTimeout(() => {
			if (!this._framesOn || !this._frames) return;
			this._frameCloud = buildFrameBlock(fr.frames.map(() => this._blankFrame(fr.cols, fr.rows)), fr.cols, fr.rows, fr.aspect, F.layout, F.depth, true);
			const g = this.geometry;
			if (g && g.attributes.aOrigin && g.attributes.aOrigin.count === this._frameCloud.count && !this.morphing) {
				g.attributes.aOrigin.array.set(this._frameCloud.positions);
				g.attributes.aTarget.array.set(this._frameCloud.positions);
				g.attributes.aNormal.array.set(this._frameCloud.normals);
				g.attributes.aNormalB.array.set(this._frameCloud.normals);
				g.attributes.aOrigin.needsUpdate = g.attributes.aTarget.needsUpdate = g.attributes.aNormal.needsUpdate = g.attributes.aNormalB.needsUpdate = true;
			}
		}, 350);
	}

	/** Каждый кадр: следим за видео, ведём показ, двигаем бегущую ленту. Данные точек не трогаем, только числа для шейдера */
	_framesTick() {
		const F = this.state.layers.frames;
		// настройки из прошлых версий: исчезнувшие раскладки и режимы заменяем на ближайшие
		if (!['stack', 'wall', 'film', 'tunnel'].includes(F.layout)) F.layout = 'stack';
		if (!['off', 'peel', 'projector', 'trail'].includes(F.showMode)) F.showMode = 'off';
		F.follow = 'off';
		const wantOn = F.on && this.videoReady && this.state.source !== 'sphere';
		if (wantOn && !this._framesOn && !this._framesBusy) {
			this.enableFrames();
			return;
		}
		// выключаем только когда режим отключён или видео закрыли: во время перемотки видео ненадолго «не готово», и это не повод всё сбрасывать
		if (this._framesOn && !this._framesBusy && (!F.on || !this.videoLoaded)) {
			F.on = false;
			this.disableFrames();
			return;
		}
		const fr = this._frames;
		const u = this.shared;
		if (!this._framesOn || !fr) {
			u.uFr.value.x = 0;
			return;
		}
		// шейдер берёт положения и цвета из блока, когда источник это блок (во время перехода туда он тоже включён: цвета уже из текстуры)
		u.uFr.value.x = this.state.source === 'frames' ? 1 : 0;
		this._frameUniforms();
		// плавная смена раскладки
		const an = this._layoutAnim;
		if (an) {
			const k = Math.min(1, (this._time - an.t0) / 0.7);
			u.uFr3.value.w = k;
			if (k >= 1) {
				this._layoutCur = an.target;
				u.uFr3.value.set(F.depth, an.target, an.target, 0);
				this._layoutAnim = null;
			}
		}
		// текущий кадр (дробный, поэтому показ идёт плавно, а не шагами). Его задаёт видео: крутите таймлайн, и блок следует за ним
		const idx = F.source === 'live' ? this._liveIdx(fr) : Math.max(0, Math.min(1, (this.pm.el.currentTime || 0) / Math.max(0.1, fr.dur))) * (fr.n - 1);
		fr.cur = Math.round(idx);
		const modeId = { off: 0, peel: 1, projector: 4, trail: 5 }[F.showMode] ?? 0;
		u.uFr4.value.set(idx, modeId, F.showLen, F.thin ?? 0);
		// листы рядом друг с другом не перекрываются, их разреживать незачем
		u.uFr6.value.set(F.bsize ?? 1.5, F.track === 'full' && F.source === 'whole' ? 1 : 0, { all: 0, light: 1, dark: 2 }[F.tone] ?? 0, F.toneCut ?? 0.5);
		u.uFr7.value.set(Math.max(0.05, (F.tail ?? 100) / 100), F.sat ?? 0, F.tailSoft ?? 0.6, 0);
		u.uFr5.value.y = 0;
		u.uFr5.value.z = { show: 0, dim: 1, hide: 2 }[F.future] ?? 1;
		u.uFr5.value.w = (fr.gain || 1) * (F.gain ?? 1);
		this._ensureHero(F, fr);
		this._framesFollow(F, fr);
		if (F.source === 'live') this._framesLive(F, fr);
	}

	/** Где на ленте текущее время видео: от начала ленты до её конца, дробное число между соседними кадрами */
	_liveIdx(fr) {
		const t = this.pm.el.currentTime || 0;
		if (!fr.ts || t >= fr.tNew) return fr.n - 1;
		let first = -1;
		let prev = -1;
		let tp = 0;
		for (let k = 0; k < fr.n; k++) {
			const tk = fr.ts[(k + fr.head) % fr.n];
			if (tk < 0) continue;
			if (first < 0) {
				first = k;
				if (t <= tk) return k;
			} else if (t <= tk) {
				return prev + (tk > tp ? (t - tp) / (tk - tp) : 0);
			}
			prev = k;
			tp = tk;
		}
		return fr.n - 1;
	}

	/** Густой текущий кадр: отдельный набор точек с тем же шейдером, цвет берётся прямо из видео */
	_ensureHero(F, fr) {
		const u = this.shared;
		const want = this.state.source === 'frames' && F.hero >= 5000 && this.points && !this.morphing;
		const has = this.hero && this.hero.parent === this.points;
		if (!want) {
			if (this.hero) this.hero.visible = false;
			u.uHero.value.w = 0;
			return;
		}
		const cols = Math.max(8, Math.round(Math.sqrt(F.hero * fr.aspect)));
		const rows = Math.max(8, Math.round(cols / fr.aspect));
		const count = cols * rows;
		if (!has || this._heroCount !== count) {
			if (this.hero) {
				this.hero.parent?.remove(this.hero);
				this.hero.geometry.dispose();
				this.hero.material.dispose();
				this.hero = null;
			}
			const g = new THREE.BufferGeometry();
			const z3 = () => new THREE.BufferAttribute(new Float32Array(count * 3), 3);
			const idxA = new Float32Array(count);
			for (let i = 0; i < count; i++) idxA[i] = i / count;
			g.setAttribute('position', z3());
			g.setAttribute('aOrigin', z3());
			g.setAttribute('aTarget', z3());
			g.setAttribute('aColor', z3());
			g.setAttribute('aColorB', z3());
			g.setAttribute('aSculpt', z3());
			const nrm = new Float32Array(count * 3);
			for (let i = 2; i < nrm.length; i += 3) nrm[i] = 1;
			g.setAttribute('aNormal', new THREE.BufferAttribute(nrm, 3));
			g.setAttribute('aNormalB', new THREE.BufferAttribute(nrm.slice(), 3));
			g.setAttribute('aIdx', new THREE.BufferAttribute(idxA, 1));
			g.setAttribute('aHide', new THREE.BufferAttribute(new Float32Array(count), 1));
			g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(count).fill(0.5), 1));
			g.setAttribute('aPath', new THREE.BufferAttribute(new Float32Array(count), 1));
			g.setAttribute('aVis', new THREE.BufferAttribute(new Float32Array(count * 2).fill(1), 2));
			const m = new THREE.ShaderMaterial({
				vertexShader: this.material.vertexShader,
				fragmentShader: this.material.fragmentShader,
				transparent: true,
				depthWrite: false,
				blending: this.material.blending,
				defines: { HERO: 1 },
				uniforms: { ...this.shared, uTOff: { value: 0 }, uGhost: { value: 1 } },
			});
			const h = new THREE.Points(g, m);
			h.frustumCulled = false;
			h.userData.helper = true;
			this.points.add(h);
			this.hero = h;
			this._heroCount = count;
		}
		if (!this._heroTex || this._heroTex.image !== this.pm.el) {
			this._heroTex?.dispose();
			this._heroTex = new THREE.VideoTexture(this.pm.el);
			this._heroTex.colorSpace = THREE.SRGBColorSpace;
			this._heroTex.minFilter = this._heroTex.magFilter = THREE.LinearFilter;
			this._heroTex.generateMipmaps = false;
		}
		u.uHeroTex.value = this._heroTex;
		u.uHero.value.set(cols, rows, count, 1);
		this.hero.visible = true;
		// материал главного кадра следует за основным (режим смешивания, размер, плотность)
		this.hero.material.blending = this.material.blending;
	}

	/** Следить за кадром: блок едет или поворачивается так, чтобы текущий кадр оказывался перед зрителем */
	_framesFollow(F, fr) {
		const pts = this.points;
		if (!pts || this.morphing || this.state.source !== 'frames') return;
		if (F.follow === 'on' && F.source === 'whole') {
			const idx = fr.cur;
			const t = fr.n > 1 ? idx / (fr.n - 1) : 0.5;
			const ease = 0.16;
			if (F.layout === 'stack') pts.position.z += ((0.5 - t) * F.depth - pts.position.z) * ease;
			else if (F.layout === 'spiral') pts.position.y += ((0.5 - t) * F.depth * 1.4 - pts.position.y) * ease;
			if ((F.layout === 'carousel' || F.layout === 'spiral') && !this.state.look.autoRotate) {
				let d = -((idx / fr.n) * Math.PI * 2) - pts.rotation.y;
				d = Math.atan2(Math.sin(d), Math.cos(d));
				pts.rotation.y += d * ease;
			}
			this._followed = true;
			pts.updateMatrixWorld();
		} else if (this._followed) {
			pts.position.set(0, 0, 0);
			this._followed = false;
			pts.updateMatrixWorld();
		}
	}

	/** Бегущая лента: новый кадр пишется в один слой текстуры, старые не трогаются; голова буфера сдвигается */
	_framesLive(F, fr) {
		const tv = this.pm.el.currentTime || 0;
		const lastTv = this._liveTv ?? tv;
		this._liveTv = tv;
		if (fr.ts && this.pm.playing) {
			let oldest = Infinity;
			for (const t of fr.ts) if (t >= 0 && t < oldest) oldest = t;
			// видео зациклилось или его перемотали за начало ленты: это новый проход, прежние кадры остаются как прошлое, но запись продолжается
			if (tv < lastTv - 1 && tv < 1.5 || tv < oldest - 0.3) {
				fr.ts.fill(-1);
				fr.tNew = tv - 0.05;
			}
		}
		// пока видео перемотано назад, в прошлые кадры ленты ничего не пишем: лента пополняется только когда видео идёт дальше её конца
		if (this._time - fr.last < F.step || !this.pm.playing || this.morphing || tv <= fr.tNew + 0.02 || !fr.ts) return;
		fr.last = this._time;
		const take = (fr.take ||= this._frameTaker(fr.cols, fr.rows));
		const layer = fr.head % fr.n;
		const tex = this._frameTex;
		take(fr.frames[layer]);
		tex.addLayerUpdate && tex.addLayerUpdate(layer);
		tex.needsUpdate = true;
		fr.ts[layer] = tv;
		fr.tNew = tv;
		fr.head++;
		this.shared.uFr5.value.x = fr.head % fr.n;
	}

	// ------------------------------------------------------------ анимация по ключам и блокам эффектов (секвенсор)
	/** Слои, которыми можно анимировать: эффекты формы, звука и графики */
	_animLayers() {
		return ['curl', 'spectrum', 'wave', 'twist', 'blast', 'flow', 'voxel', 'glitch', 'slice', 'feedback', 'echo', 'links', 'dissolve', 'gravity', 'scope', 'depth', 'explode'];
	}

	/** Снимок того, что можно анимировать: камера, размер, яркость, свечение и сила каждого эффекта (выключенный = 0) */
	animCapture() {
		const nav = this.app.nav;
		const L = this.state.layers;
		const layers = {};
		for (const id of this._animLayers()) layers[id] = L[id]?.on ? L[id].amount : 0;
		return { cam: { yaw: nav.yaw, pitch: nav.pitch, dist: nav.distance, tx: nav.target.x, ty: nav.target.y, tz: nav.target.z }, size: this.app.settings.point.size, bright: this.state.look.bright, glow: this.state.look.glow, layers };
	}

	get animKeys() {
		return this.state.anim.keys || (this.state.anim.keys = []);
	}

	get animClips() {
		return this.state.anim.clips || (this.state.anim.clips = []);
	}

	_animSort() {
		this.animKeys.sort((a, b) => a.t - b.t);
	}

	/** Ключ камеры и сцены на текущем времени: если рядом уже есть, обновляем его */
	animAddKey(t = this.animT) {
		const A = this.state.anim;
		if (!A.keys) A.keys = [];
		const snap = { t: Math.round(Math.min(A.dur, Math.max(0, t)) * 100) / 100, ...this.animCapture() };
		const near = A.keys.find((k) => Math.abs(k.t - snap.t) < 0.06);
		if (near) Object.assign(near, snap, { t: near.t });
		else A.keys.push(snap);
		this._animSort();
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
		return near || snap;
	}

	animUpdateKey(key) {
		Object.assign(key, this.animCapture(), { t: key.t });
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	animRemoveKey(key) {
		const A = this.state.anim;
		if (!A.keys) return;
		A.keys = A.keys.filter((k) => k !== key);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	animMoveKey(key, t) {
		key.t = Math.round(Math.min(this.state.anim.dur, Math.max(0, t)) * 100) / 100;
		this._animSort();
		this.touch();
		this.app.bus.emit('fxanim');
	}

	/** Добавить клип эффекта на дорожку времени */
	animAddClip(layerId, opts = {}) {
		const A = this.state.anim;
		if (!A.clips) A.clips = [];
		const durTotal = A.dur || 8;
		const dur = Math.max(0.3, Math.min(durTotal, opts.dur ?? 2.5));
		const defaultStart = Math.min(Math.max(0, this.animT), Math.max(0, durTotal - dur));
		const start = Math.max(0, Math.min(durTotal - 0.2, opts.start ?? defaultStart));
		const actualDur = Math.min(dur, Math.max(0.2, durTotal - start));
		const fadeIn = Math.max(0, Math.min(actualDur * 0.45, opts.fadeIn ?? 0.4));
		const fadeOut = Math.max(0, Math.min(actualDur * 0.45, opts.fadeOut ?? 0.5));
		const defAmt = this.state.layers[layerId]?.amount ?? 1.0;
		const amount = Math.max(0.05, Math.min(2.0, opts.amount ?? (defAmt > 0 ? defAmt : 1.0)));

		const clip = {
			id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
			layerId,
			start: Math.round(start * 100) / 100,
			dur: Math.round(actualDur * 100) / 100,
			fadeIn: Math.round(fadeIn * 100) / 100,
			fadeOut: Math.round(fadeOut * 100) / 100,
			amount: Math.round(amount * 100) / 100,
		};
		A.clips.push(clip);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
		return clip;
	}

	/** Изменить параметры клипа эффекта */
	animUpdateClip(clipId, patch = {}) {
		const A = this.state.anim;
		if (!A.clips) return null;
		const clip = A.clips.find((c) => c.id === clipId);
		if (!clip) return null;
		const durTotal = A.dur || 8;

		if (patch.start !== undefined) {
			clip.start = Math.max(0, Math.min(durTotal - 0.2, patch.start));
			if (clip.start + clip.dur > durTotal) {
				clip.dur = Math.max(0.2, durTotal - clip.start);
			}
		}
		if (patch.dur !== undefined) {
			clip.dur = Math.max(0.2, Math.min(durTotal - clip.start, patch.dur));
		}
		if (patch.fadeIn !== undefined) {
			clip.fadeIn = Math.max(0, Math.min(clip.dur, patch.fadeIn));
		}
		if (patch.fadeOut !== undefined) {
			clip.fadeOut = Math.max(0, Math.min(clip.dur, patch.fadeOut));
		}
		if (clip.fadeIn + clip.fadeOut > clip.dur) {
			const ratio = clip.dur / (clip.fadeIn + clip.fadeOut);
			clip.fadeIn *= ratio;
			clip.fadeOut *= ratio;
		}
		if (patch.amount !== undefined) {
			clip.amount = Math.max(0.05, Math.min(2.0, patch.amount));
		}
		if (patch.layerId !== undefined && (this.state.layers[patch.layerId] || ['morph', 'rotate', 'bloom'].includes(patch.layerId))) {
			clip.layerId = patch.layerId;
		}

		clip.start = Math.round(clip.start * 100) / 100;
		clip.dur = Math.round(clip.dur * 100) / 100;
		clip.fadeIn = Math.round(clip.fadeIn * 100) / 100;
		clip.fadeOut = Math.round(clip.fadeOut * 100) / 100;
		clip.amount = Math.round(clip.amount * 100) / 100;

		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
		return clip;
	}

	/** Удалить клип эффекта */
	animRemoveClip(clipId) {
		const A = this.state.anim;
		if (!A.clips) return;
		A.clips = A.clips.filter((c) => c.id !== clipId);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Продублировать клип эффекта со сдвигом по времени */
	animDuplicateClip(clipId) {
		const A = this.state.anim;
		if (!A.clips) return null;
		const clip = A.clips.find((c) => c.id === clipId);
		if (!clip) return null;
		const durTotal = A.dur || 8;
		let newStart = clip.start + 0.5;
		if (newStart + clip.dur > durTotal) newStart = Math.max(0, durTotal - clip.dur);
		return this.animAddClip(clip.layerId, {
			start: newStart,
			dur: clip.dur,
			fadeIn: clip.fadeIn,
			fadeOut: clip.fadeOut,
			amount: clip.amount,
		});
	}

	/** Разрезать клип по времени t на два: у первого остаётся вход, у второго выход. Возвращает правую часть или null */
	animSplitClip(clipId, t) {
		const A = this.state.anim;
		const clip = (A.clips || []).find((c) => c.id === clipId);
		if (!clip || t <= clip.start + 0.3 || t >= clip.start + clip.dur - 0.3) return null;
		const end = clip.start + clip.dur;
		const outFade = clip.fadeOut;
		const left = t - clip.start;
		clip.dur = Math.round(left * 100) / 100;
		clip.fadeIn = Math.min(clip.fadeIn, clip.dur * 0.45);
		clip.fadeOut = Math.min(0.15, clip.dur * 0.3);
		const right = this.animAddClip(clip.layerId, { start: t, dur: end - t, fadeIn: Math.min(0.15, (end - t) * 0.3), fadeOut: Math.min(outFade, (end - t) * 0.45), amount: clip.amount });
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
		return right;
	}

	/** Очистить всю дорожку анимации */
	animClear() {
		const A = this.state.anim;
		A.keys = [];
		A.clips = [];
		this.animT = 0;
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Подготавливает целевое облако точек для дорожки морфинга на таймлайне */
	async _prepareMorphTrack() {
		if (!this.geometry || this._morphTrackReady || this._morphTrackLoading) return;
		this._morphTrackLoading = true;
		try {
			const forms = this.forms();
			let targetKey = null;
			if (forms.length >= 2) {
				targetKey = forms.find((f) => f.key !== (this.curKey || this.state.source))?.key || forms[1].key;
			} else {
				targetKey = this.state.source === 'sphere' ? 'torus' : 'sphere';
			}
			const target = await this._cloudFor(targetKey);
			if (target && this.geometry) {
				const g = this.geometry;
				const t = g.attributes.aTarget;
				if (t && target.positions && target.positions.length === t.array.length) {
					t.array.set(target.positions);
					t.needsUpdate = true;
					this._morphTrackReady = true;
				}
			}
		} catch (e) {
			/* не критично */
		} finally {
			this._morphTrackLoading = false;
		}
	}

	/** Загрузить готовый режиссерский сценарий */
	animLoadPreset(id) {
		const nav = this.app?.nav;
		const baseDist = nav?.distance || 5.2;
		const tx = nav?.target?.x || 0;
		const ty = nav?.target?.y || 0;
		const tz = nav?.target?.z || 0;

		if (id === 'dust_rebirth') {
			this.animSetDuration(9);
			const A = this.state.anim;
			A.keys = [
				{ t: 0.0, cam: { yaw: 0.2, pitch: 0.25, dist: baseDist * 0.75, tx, ty, tz }, size: 2.2, bright: 0.9, glow: 0.6, layers: {} },
				{ t: 4.5, cam: { yaw: 2.1, pitch: 0.15, dist: baseDist * 1.15, tx, ty, tz }, size: 3.8, bright: 1.2, glow: 1.0, layers: {} },
				{ t: 9.0, cam: { yaw: 4.0, pitch: 0.28, dist: baseDist * 0.85, tx, ty, tz }, size: 3.0, bright: 1.0, glow: 0.8, layers: {} },
			];
			A.clips = [
				{ id: 'c_pr_1', layerId: 'dissolve', start: 0.0, dur: 3.8, fadeIn: 0.2, fadeOut: 1.0, amount: 1.0 },
				{ id: 'c_pr_2', layerId: 'curl', start: 2.2, dur: 4.5, fadeIn: 0.8, fadeOut: 1.2, amount: 0.9 },
				{ id: 'c_pr_3', layerId: 'blast', start: 5.2, dur: 3.2, fadeIn: 0.6, fadeOut: 0.8, amount: 0.75 },
				{ id: 'c_pr_4', layerId: 'wave', start: 6.2, dur: 2.8, fadeIn: 0.5, fadeOut: 0.8, amount: 0.65 },
			];
		} else if (id === 'scan_collapse') {
			this.animSetDuration(10);
			const A = this.state.anim;
			A.keys = [
				{ t: 0.0, cam: { yaw: -0.6, pitch: 0.45, dist: baseDist * 0.8, tx, ty: ty - 0.2, tz }, size: 2.8, bright: 1.0, glow: 0.7, layers: {} },
				{ t: 5.0, cam: { yaw: 1.2, pitch: 0.1, dist: baseDist * 1.2, tx, ty: ty + 0.1, tz }, size: 3.4, bright: 1.3, glow: 1.1, layers: {} },
				{ t: 10.0, cam: { yaw: 3.2, pitch: 0.35, dist: baseDist * 0.9, tx, ty, tz }, size: 3.0, bright: 1.0, glow: 0.8, layers: {} },
			];
			A.clips = [
				{ id: 'c_pr_5', layerId: 'slice', start: 0.0, dur: 4.0, fadeIn: 0.2, fadeOut: 0.8, amount: 1.0 },
				{ id: 'c_pr_6', layerId: 'links', start: 3.0, dur: 4.5, fadeIn: 0.8, fadeOut: 1.0, amount: 0.95 },
				{ id: 'c_pr_7', layerId: 'glitch', start: 5.5, dur: 3.5, fadeIn: 0.4, fadeOut: 0.8, amount: 0.85 },
				{ id: 'c_pr_8', layerId: 'bloom', start: 6.5, dur: 3.0, fadeIn: 0.5, fadeOut: 0.8, amount: 0.9 },
			];
		} else if (id === 'glitch_morph') {
			this.animSetDuration(8);
			const A = this.state.anim;
			A.keys = [
				{ t: 0.0, cam: { yaw: 0.0, pitch: 0.2, dist: baseDist, tx, ty, tz }, size: 3.2, bright: 1.0, glow: 0.8, layers: {} },
				{ t: 3.5, cam: { yaw: 1.8, pitch: -0.1, dist: baseDist * 0.75, tx, ty, tz }, size: 4.2, bright: 1.4, glow: 1.2, layers: {} },
				{ t: 8.0, cam: { yaw: 3.6, pitch: 0.2, dist: baseDist, tx, ty, tz }, size: 3.2, bright: 1.0, glow: 0.8, layers: {} },
			];
			A.clips = [
				{ id: 'c_pr_9', layerId: 'glitch', start: 0.3, dur: 3.0, fadeIn: 0.2, fadeOut: 0.6, amount: 0.95 },
				{ id: 'c_pr_10', layerId: 'morph', start: 1.5, dur: 4.5, fadeIn: 0.4, fadeOut: 0.6, amount: 1.0 },
				{ id: 'c_pr_11', layerId: 'blast', start: 2.2, dur: 3.8, fadeIn: 0.3, fadeOut: 0.9, amount: 1.0 },
				{ id: 'c_pr_12', layerId: 'bloom', start: 3.5, dur: 3.0, fadeIn: 0.4, fadeOut: 0.8, amount: 0.9 },
				{ id: 'c_pr_13', layerId: 'twist', start: 4.0, dur: 3.5, fadeIn: 0.6, fadeOut: 0.8, amount: 0.85 },
			];
		}
		this.animSeek(0);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	animSetDuration(d) {
		const A = this.state.anim;
		A.dur = Math.max(1, Math.min(120, d));
		if (A.keys) {
			for (const k of A.keys) k.t = Math.min(k.t, A.dur);
		}
		if (A.clips) {
			for (const c of A.clips) {
				c.start = Math.min(c.start, Math.max(0, A.dur - 0.2));
				c.dur = Math.min(c.dur, A.dur - c.start);
				if (c.fadeIn + c.fadeOut > c.dur) {
					c.fadeIn = Math.min(c.fadeIn, c.dur * 0.5);
					c.fadeOut = Math.min(c.fadeOut, c.dur * 0.5);
				}
			}
		}
		this.animT = Math.min(this.animT, A.dur);
		this.touch();
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Выставляет сцену по времени t: интерполяция ключей камеры + огибающие блоков эффектов */
	/** Эффекты, у которых есть блоки на таймлайне, работают только внутри своих блоков (с плавными входом и выходом); где блока нет, эффект выключен */
	_animGate(t) {
		// блоки управляют эффектами, только пока таймлайн открыт; при закрытом таймлайне эффекты работают вручную и не выключаются сами
		const clips = this.timelineOpen ? this.state.anim.clips || [] : [];
		const L = this.state.layers;
		const clipLayerIds = new Set(clips.map((c) => c.layerId));
		// как только у эффекта появляется первый блок, его ручные значения запоминаются, а сила падает до нуля: дальше им управляет только таймлайн.
		// Когда последний блок удалён, прежние значения возвращаются
		const S = (this.state.anim.saved ||= {});
		let changed = false;
		for (const id of clipLayerIds) {
			if (!L[id] || S[id]) continue;
			S[id] = { on: !!L[id].on, amount: L[id].amount };
			L[id].on = false;
			L[id].amount = 0;
			changed = true;
		}
		for (const id of Object.keys(S)) {
			if (clipLayerIds.has(id)) continue;
			if (L[id]) {
				L[id].on = S[id].on;
				L[id].amount = S[id].amount;
			}
			delete S[id];
			changed = true;
		}
		if (changed) {
			this.touch();
			this.emit();
		}
			for (const layerId of clipLayerIds) {
				if (!L[layerId]) continue;
				let maxVal = 0;
				for (const c of clips) {
					if (c.layerId !== layerId) continue;
					if (t < c.start || t > c.start + c.dur) continue;
					const elapsed = t - c.start;
					const remaining = c.start + c.dur - t;
					let env = 1.0;
					if (c.fadeIn > 0.001 && elapsed < c.fadeIn) {
						const f = Math.min(1, Math.max(0, elapsed / c.fadeIn));
						env = Math.min(env, f * f * (3 - 2 * f));
					}
					if (c.fadeOut > 0.001 && remaining < c.fadeOut) {
						const f = Math.min(1, Math.max(0, remaining / c.fadeOut));
						env = Math.min(env, f * f * (3 - 2 * f));
					}
					const val = (c.amount ?? 1.0) * env;
					if (val > maxVal) maxVal = val;
				}

				if (maxVal > 0.003) {
					L[layerId].on = true;
					L[layerId].amount = maxVal;
				} else {
					L[layerId].on = false;
				}
			}
	}

	animApply(t) {
		const A = this.state.anim;
		const keys = A.keys || [];
		const clips = A.clips || [];
		if (!keys.length && !clips.length) return;

		// 1. Плавная интерполяция камеры и вида из ключей
		if (keys.length > 0) {
			let a = keys[0];
			let b = keys[keys.length - 1];
			let u = 0;
			if (t <= keys[0].t) b = a;
			else if (t >= b.t) a = b;
			else {
				for (let i = 0; i < keys.length - 1; i++) {
					if (t >= keys[i].t && t <= keys[i + 1].t) {
						a = keys[i];
						b = keys[i + 1];
						break;
					}
				}
				const span = Math.max(1e-6, b.t - a.t);
				u = (t - a.t) / span;
				u = u * u * (3 - 2 * u);
			}
			const mix = (x, y) => x + (y - x) * u;
			const nav = this.app.nav;
			nav.cancelTween?.();
			nav.yaw = mix(a.cam.yaw, b.cam.yaw);
			nav.pitch = mix(a.cam.pitch, b.cam.pitch);
			nav.distance = Math.exp(mix(Math.log(a.cam.dist), Math.log(b.cam.dist)));
			nav.target.set(mix(a.cam.tx, b.cam.tx), mix(a.cam.ty, b.cam.ty), mix(a.cam.tz, b.cam.tz));
			nav.applyCamera();
			if (a.size !== undefined && b.size !== undefined) {
				this.app.settings.point.size = mix(a.size, b.size);
			}
			if (a.bright !== undefined && b.bright !== undefined) {
				this.state.look.bright = mix(a.bright, b.bright);
			}
			if (a.glow !== undefined && b.glow !== undefined) {
				this.state.look.glow = mix(a.glow, b.glow);
			}

			// Если блоков эффектов нет, используем старые снимки слоёв в ключах
			if (clips.length === 0 && a.layers && b.layers) {
				const L = this.state.layers;
				for (const id of this._animLayers()) {
					if (!L[id]) continue;
					const v = mix(a.layers[id] ?? 0, b.layers[id] ?? 0);
					if (v > 0.003) {
						L[id].on = true;
						L[id].amount = v;
					} else {
						L[id].on = false;
					}
				}
			}
		}

		// 2. Расчёт силы эффектов по блокам дорожки (с огибающими fade-in / fade-out)
		if (clips.length > 0) {
			const L = this.state.layers;
			const clipLayerIds = new Set(clips.map((c) => c.layerId));

			this._animGate(t);

			// Дорожка морфинга
			if (clipLayerIds.has('morph')) {
				if (!this._morphTrackReady && !this._morphTrackLoading) {
					this._prepareMorphTrack();
				}
				let mVal = 0;
				for (const c of clips) {
					if (c.layerId !== 'morph') continue;
					if (t <= c.start) continue;
					if (t >= c.start + c.dur) {
						mVal = 1.0;
						continue;
					}
					const p = (t - c.start) / Math.max(0.01, c.dur);
					mVal = Math.max(mVal, p * (c.amount ?? 1.0));
				}
				this.morph = Math.max(0, Math.min(1, mVal));
				if (this.shared?.uMorph) this.shared.uMorph.value = this.morph;
			}

			// Дорожка вращения
			if (clipLayerIds.has('rotate')) {
				let rotVal = 0;
				for (const c of clips) {
					if (c.layerId !== 'rotate') continue;
					if (t < c.start || t > c.start + c.dur) continue;
					const elapsed = t - c.start;
					const remaining = c.start + c.dur - t;
					let env = 1.0;
					if (c.fadeIn > 0.001 && elapsed < c.fadeIn) {
						const f = Math.min(1, Math.max(0, elapsed / c.fadeIn));
						env = Math.min(env, f * f * (3 - 2 * f));
					}
					if (c.fadeOut > 0.001 && remaining < c.fadeOut) {
						const f = Math.min(1, Math.max(0, remaining / c.fadeOut));
						env = Math.min(env, f * f * (3 - 2 * f));
					}
					rotVal = Math.max(rotVal, (c.amount ?? 1.0) * env);
				}
				if (rotVal > 0.001 && this.points) {
					this.points.rotation.y = t * 1.6 * rotVal;
					this.points.updateMatrixWorld();
				}
			}

			// Дорожка блума и вспышки
			if (clipLayerIds.has('bloom')) {
				let bVal = 0;
				for (const c of clips) {
					if (c.layerId !== 'bloom') continue;
					if (t < c.start || t > c.start + c.dur) continue;
					const elapsed = t - c.start;
					const remaining = c.start + c.dur - t;
					let env = 1.0;
					if (c.fadeIn > 0.001 && elapsed < c.fadeIn) {
						const f = Math.min(1, Math.max(0, elapsed / c.fadeIn));
						env = Math.min(env, f * f * (3 - 2 * f));
					}
					if (c.fadeOut > 0.001 && remaining < c.fadeOut) {
						const f = Math.min(1, Math.max(0, remaining / c.fadeOut));
						env = Math.min(env, f * f * (3 - 2 * f));
					}
					bVal = Math.max(bVal, (c.amount ?? 1.0) * env);
				}
				if (bVal > 0.001) {
					this.state.look.glow = 0.8 + bVal * 1.5;
					this.state.look.bright = 1.0 + bVal * 0.8;
					if (this.shared?.uGlow) this.shared.uGlow.value = this.state.look.glow;
					if (this.shared?.uBright) this.shared.uBright.value = this.state.look.bright;
				}
			}
		}

		clearTimeout(this._saveT);
		this._saveT = setTimeout(() => saveJSON(KEY, this.state), 500);
	}

	animSeek(t) {
		this.animT = Math.max(0, Math.min(this.state.anim.dur, t));
		this.animApply(this.animT);
		this.app.bus.emit('fxanim');
	}

	animPlay() {
		const hasKeys = this.state.anim.keys && this.state.anim.keys.length >= 2;
		const hasClips = this.state.anim.clips && this.state.anim.clips.length >= 1;
		if (!hasKeys && !hasClips) return false;
		if (this.animT >= this.state.anim.dur - 0.01) this.animT = 0;
		this.animPlaying = true;
		this.app.bus.emit('fxanim');
		return true;
	}

	animPause() {
		if (!this.animPlaying) return;
		this.animPlaying = false;
		this.emit();
		this.app.bus.emit('fxanim');
	}

	/** Проигрывает анимацию один раз с начала и записывает видео со звуком */
	animRecord() {
		const hasKeys = this.state.anim.keys && this.state.anim.keys.length >= 2;
		const hasClips = this.state.anim.clips && this.state.anim.clips.length >= 1;
		if ((!hasKeys && !hasClips) || this.recording) return false;
		this.animT = 0;
		this.animApply(0);
		this.animRec = true;
		this.startRecording();
		this.animPlaying = true;
		this.app.bus.emit('fxanim');
		return true;
	}

	_animStep(dt) {
		const A = this.state.anim;
		this.animT += dt;
		if (this.animT >= A.dur) {
			if (this.animRec) {
				this.animT = A.dur;
				this.animApply(A.dur);
				this.animRec = false;
				this.animPlaying = false;
				this.stopRecording();
				this.emit();
			} else if (A.loop) this.animT %= A.dur;
			else {
				this.animT = A.dur;
				this.animPlaying = false;
				this.emit();
			}
		}
		this.animApply(this.animT);
		this._animEmitT = (this._animEmitT || 0) + dt;
		if (this._animEmitT > 0.05) {
			this._animEmitT = 0;
			this.app.bus.emit('fxanim');
		}
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

	// ------------------------------------------------------------ фото и видео
	/** Загруженное в «Медиа» фото или видео становится источником «Фото» */
	async useMedia() {
		this.state.look.colorBy = 'model';
		// стартовые вихри и пульс портят картинку: выключаем, включить можно слева
		for (const id of ['curl', 'blast']) this.state.layers[id].on = false;
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
		const out = [];
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
		this._prefetch(keys);
	}

	morphNext() {
		const list = this.playlist || [];
		if (list.length < 2 || !this.active || this.morphing) return;
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
			t.fpsHint = () => this.app.viewport.fps || 60;
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
		makeCamMovable(this.camBox, document.getElementById('app'), document.getElementById('viewport'));
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
		let wantBreak = false, wantDis = false, grav = null, brushNow = false, sliceHand = null;
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
			} else if (a === 'slicecut') {
				sliceHand = this._ndcToLocal(focus[0] * 2 - 1, -(focus[1] * 2 - 1), new THREE.Vector3(), 0);
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
		this._handSlice = sliceHand;
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
	// ------------------------------------------------------------ отмена и повтор в режиме эффектов
	_snap() {
		const st = this.state;
		const layers = {};
		for (const id of Object.keys(st.layers)) {
			const l = { ...st.layers[id] };
			if (this._handFx?.has(id)) l.on = this._handFx.get(id); // временное включение жестом не считается правкой
			layers[id] = l;
		}
		const p = this.app.settings.point;
		return JSON.stringify({ source: st.source, count: st.count, layers, look: st.look, mask: st.mask, morphCfg: st.morphCfg, pt: { shape: p.shape, size: p.size, color: p.color, solidColor: p.solidColor, attenuate: p.attenuate } });
	}

	_histSoon() {
		if (!this.active || this._histBusy) return;
		clearTimeout(this._histT);
		this._histT = setTimeout(() => this._histCommit(), 350);
	}

	_histCommit() {
		const h = this._hist || (this._hist = { undo: [], redo: [], last: null });
		const snap = this._snap();
		if (h.last === null) h.last = snap;
		else if (snap !== h.last) {
			h.undo.push({ snap: h.last, label: this._diffLabel(h.last, snap) });
			if (h.undo.length > 100) h.undo.shift();
			h.redo.length = 0;
			h.last = snap;
		}
		this.emit();
	}

	/** Отметка удара: от неё считают время пульс, взрыв и капли-волны */
	/** Центры кусков для «Разбора»: куски это подряд идущие точки облака (оно упорядочено по пространству), центр каждого пишется в текстуру */
	_pieceUpdate(P) {
		const g = this.geometry;
		if (!g || !this.pieceTex) return;
		P = Math.max(2, Math.min(256, Math.round(P)));
		const key = P + ':' + g.attributes.position.count + ':' + this._animVer + ':' + this.cloudKey + ':' + (this.morphing ? this._time.toFixed(1) : 0);
		if (key === this._pieceKey) return;
		this._pieceKey = key;
		const a = g.attributes.aTarget.array;
		const n = g.attributes.position.count;
		const d = this.pieceTex.image.data;
		for (let p = 0; p < P; p++) {
			const s0 = Math.floor((p * n) / P), e0 = Math.max(s0 + 1, Math.floor(((p + 1) * n) / P));
			let x = 0, y = 0, z = 0;
			for (let i = s0; i < e0; i++) {
				x += a[i * 3];
				y += a[i * 3 + 1];
				z += a[i * 3 + 2];
			}
			const c = e0 - s0;
			d[p * 4] = x / c;
			d[p * 4 + 1] = y / c;
			d[p * 4 + 2] = z / c;
			d[p * 4 + 3] = 1;
		}
		this.pieceTex.needsUpdate = true;
	}

	_markBeat() {
		this._tb = this._time;
		const g = this.geometry;
		if (g) {
			const t = g.attributes.aTarget.array;
			const i = Math.floor(Math.random() * (t.length / 3)) * 3;
			(this._waveSrc ||= new THREE.Vector3()).set(t[i], t[i + 1], t[i + 2]);
		}
	}

	_diffLabel(a, b) {
		try {
			const A = JSON.parse(a), B = JSON.parse(b);
			for (const id of Object.keys(B.layers)) {
				if (JSON.stringify(A.layers[id]) !== JSON.stringify(B.layers[id])) return 'эффект «' + (FX_LAYERS.find((l) => l.id === id)?.name || id) + '»';
			}
			if (A.source !== B.source) return 'форма';
			if (A.count !== B.count) return 'число частиц';
			if (JSON.stringify(A.mask) !== JSON.stringify(B.mask)) return 'зона действия';
			if (JSON.stringify(A.morphCfg) !== JSON.stringify(B.morphCfg)) return 'морфинг';
			if (JSON.stringify(A.look) !== JSON.stringify(B.look) || JSON.stringify(A.pt) !== JSON.stringify(B.pt)) return 'вид';
		} catch (e) {
			/* не критично */
		}
		return 'настройки';
	}

	get canUndo() {
		return !!this._hist?.undo.length;
	}
	get canRedo() {
		return !!this._hist?.redo.length;
	}
	get undoLabel() {
		return this._hist?.undo.at(-1)?.label || '';
	}
	get redoLabel() {
		return this._hist?.redo.at(-1)?.label || '';
	}

	async _histApply(snap) {
		const d = JSON.parse(snap);
		const st = this.state;
		this._histBusy = true;
		try {
			for (const id of Object.keys(d.layers)) if (st.layers[id]) Object.assign(st.layers[id], d.layers[id]);
			Object.assign(st.look, d.look);
			Object.assign(st.mask, d.mask);
			Object.assign(st.morphCfg, d.morphCfg);
			Object.assign(this.app.settings.point, d.pt);
			this.app.saveSettings();
			this.touch();
			if (d.count !== st.count) await this.setCount(d.count);
			if (d.source !== st.source) await this.setSource(d.source);
		} finally {
			this._hist.last = snap;
			this._histBusy = false;
		}
		this.emit();
	}

	async undo() {
		const h = this._hist;
		if (!h || !h.undo.length) return null;
		const e = h.undo.pop();
		h.redo.push({ snap: h.last, label: e.label });
		await this._histApply(e.snap);
		return e.label;
	}

	async redo() {
		const h = this._hist;
		if (!h || !h.redo.length) return null;
		const e = h.redo.pop();
		h.undo.push({ snap: h.last, label: e.label });
		await this._histApply(e.snap);
		return e.label;
	}

	touch() {
		this._histSoon();
		clearTimeout(this._saveT);
		this._saveT = setTimeout(() => saveJSON(KEY, this.state), 250);
	}
	emit() {
		this.app.bus.emit('fx');
	}
	// ------------------------------------------------------------ акселерограф: перо бежит от точки к точке по координатам модели
	/** Строит путь пера: берёт часть точек и обходит их «ближайшим соседом», каждой точке облака даёт место на пути (aPath), а линию собирает из отрезков между соседями по пути. Остальные порядки: развёртка по высоте или по кругу */
	_scopeBuild(S, order, chaosV = 0.5) {
		const g = this.geometry;
		const T = g.attributes.aTarget.array;
		const N = g.attributes.position.count;
		const path = g.attributes.aPath;
		this._scopeDropLine();
		if (order !== 'walk') {
			let mn = Infinity, mx = -Infinity;
			for (let i = 0; i < N; i++) {
				const v = order === 'up' ? T[i * 3 + 1] : Math.atan2(T[i * 3 + 2], T[i * 3]);
				if (v < mn) mn = v;
				if (v > mx) mx = v;
			}
			const span = Math.max(mx - mn, 1e-6);
			for (let i = 0; i < N; i++) path.array[i] = ((order === 'up' ? T[i * 3 + 1] : Math.atan2(T[i * 3 + 2], T[i * 3])) - mn) / span;
			path.needsUpdate = true;
			return;
		}
		const sc = Math.max(8, Math.min(S, N));
		const ids = new Int32Array(sc);
		for (let i = 0; i < sc; i++) ids[i] = Math.floor((i * N) / sc);
		const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < sc; i++) for (let c = 0; c < 3; c++) {
			const v = T[ids[i] * 3 + c];
			if (v < mn[c]) mn[c] = v;
			if (v > mx[c]) mx[c] = v;
		}
		const ext = [0, 1, 2].map((c) => Math.max(mx[c] - mn[c], 0.03));
		const cell = Math.cbrt((ext[0] * ext[1] * ext[2]) / sc) * 1.7;
		const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
		const cx = (v, c) => Math.floor((v - mn[c]) / cell);
		const grid = new Map();
		for (let i = 0; i < sc; i++) {
			const p = ids[i] * 3;
			const k = key(cx(T[p], 0), cx(T[p + 1], 1), cx(T[p + 2], 2));
			const a = grid.get(k);
			if (a) a.push(i);
			else grid.set(k, [i]);
		}
		// обход вычёркивает посещённые точки из ячеек, поэтому для раздачи мест всем точкам облака оставляем целую копию
		const full = new Map();
		for (const [k, v] of grid) full.set(k, v.slice());
		const used = new Uint8Array(sc);
		const ord = new Int32Array(sc);
		const d2 = (i, p) => (T[ids[i] * 3] - p[0]) ** 2 + (T[ids[i] * 3 + 1] - p[1]) ** 2 + (T[ids[i] * 3 + 2] - p[2]) ** 2;
		// «хаос»: путь режется на штрихи, каждый штрих стартует в случайном месте и идёт по ближайшим точкам, с лёгкой случайностью в выборе шага
		let seed = 1234567;
		const rnd = () => {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const chaos = Math.max(0, Math.min(1, chaosV));
		const strokes = 1 + Math.round(chaos * chaos * 120);
		const strokeLen = Math.max(6, Math.ceil(sc / strokes));
		const rem = new Int32Array(sc);
		const posIn = new Int32Array(sc);
		for (let i = 0; i < sc; i++) rem[i] = posIn[i] = i;
		let remN = sc;
		const take = (j) => {
			const pj = posIn[j];
			const last = rem[--remN];
			rem[pj] = last;
			posIn[last] = pj;
			used[j] = 1;
		};
		const brk = new Uint8Array(sc + 1);
		let n = 0;
		while (n < sc) {
			if (n > 0) brk[n] = 1;
			let cur = 0;
			if (n === 0 && strokes === 1) {
				for (let i = 1; i < sc; i++) if (T[ids[i] * 3 + 1] < T[ids[cur] * 3 + 1]) cur = i;
			} else cur = rem[Math.floor(rnd() * remN)];
			take(cur);
			ord[n++] = cur;
			let prev = null;
			let left = strokeLen - 1;
			while (left > 0 && n < sc) {
				const p = [T[ids[cur] * 3], T[ids[cur] * 3 + 1], T[ids[cur] * 3 + 2]];
				const bx = cx(p[0], 0), by = cx(p[1], 1), bz = cx(p[2], 2);
				const cand = [];
				for (let r = 0; r <= 5 && cand.length < 3; r++) {
					for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
						if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
						const a = grid.get(key(bx + dx, by + dy, bz + dz));
						if (!a) continue;
						for (let q = a.length - 1; q >= 0; q--) {
							const j = a[q];
							if (used[j]) {
								a[q] = a[a.length - 1];
								a.pop();
								continue;
							}
							let d = d2(j, p);
							if (prev) d *= 1.25 - 0.25 * Math.max(-1, Math.min(1, ((T[ids[j] * 3] - p[0]) * prev[0] + (T[ids[j] * 3 + 1] - p[1]) * prev[1] + (T[ids[j] * 3 + 2] - p[2]) * prev[2]) / (Math.sqrt(d2(j, p)) * prev[3] + 1e-9)));
							cand.push([d, j]);
						}
					}
				}
				if (!cand.length) break;
				cand.sort((x, y) => x[0] - y[0]);
				// чем больше хаос, тем чаще перо выбирает не самую близкую из трёх ближайших
				let pick = 0;
				if (cand.length > 1 && rnd() < chaos * 0.75) pick = 1 + (cand.length > 2 && rnd() < 0.4 ? 1 : 0);
				const best = cand[pick][1];
				prev = [T[ids[best] * 3] - p[0], T[ids[best] * 3 + 1] - p[1], T[ids[best] * 3 + 2] - p[2], 0];
				prev[3] = Math.hypot(prev[0], prev[1], prev[2]);
				take(best);
				ord[n++] = best;
				cur = best;
				left--;
			}
		}
		const rank = new Int32Array(sc);
		for (let n = 0; n < sc; n++) rank[ord[n]] = n;
		const cut2 = (cell * 1.4) ** 2;
		for (let i = 0; i < N; i++) {
			const x = T[i * 3], y = T[i * 3 + 1], z = T[i * 3 + 2];
			const bx = cx(x, 0), by = cx(y, 1), bz = cx(z, 2);
			let best = -1, bd = Infinity;
			for (let r = 0; r <= 3 && best < 0; r++) {
				for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
					if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
					const a = full.get(key(bx + dx, by + dy, bz + dz));
					if (!a) continue;
					for (const j of a) {
						const d = (T[ids[j] * 3] - x) ** 2 + (T[ids[j] * 3 + 1] - y) ** 2 + (T[ids[j] * 3 + 2] - z) ** 2;
						if (d < bd) {
							bd = d;
							best = j;
						}
					}
				}
			}
			if (best < 0) {
				path.array[i] = 0;
				continue;
			}
			// между двумя соседними точками пути место считаем плавно, иначе проявление идёт квадратиками по ячейкам
			const rk = rank[best];
			const P = (j) => ids[ord[j]] * 3;
			let bt = 0, bj = -1;
			for (const nj of [rk - 1, rk + 1]) {
				if (nj < 0 || nj >= sc || brk[Math.max(rk, nj)]) continue;
				const p0 = ids[best] * 3, p1 = P(nj);
				const ex = T[p1] - T[p0], ey = T[p1 + 1] - T[p0 + 1], ez = T[p1 + 2] - T[p0 + 2];
				const l2 = ex * ex + ey * ey + ez * ez;
				if (l2 < 1e-12 || l2 > cut2) continue;
				const t = ((x - T[p0]) * ex + (y - T[p0 + 1]) * ey + (z - T[p0 + 2]) * ez) / l2;
				if (t > bt) {
					bt = Math.min(t, 1);
					bj = nj;
				}
			}
			path.array[i] = (rk + (bj < 0 ? 0 : (bj - rk) * bt)) / (sc - 1);
		}
		path.needsUpdate = true;
		// линия: четырёхугольник на каждый отрезок между соседями по пути; её концы идут через те же эффекты, что и сами точки
		const L = sc - 1;
		const V = L * 4;
		const O = g.attributes.aOrigin.array;
		const D = g.attributes.aDepth.array;
		const A = new Float32Array(V * 3), TA = new Float32Array(V * 3), B = new Float32Array(V * 3), TB = new Float32Array(V * 3);
		const ia = new Float32Array(V), ib = new Float32Array(V), da = new Float32Array(V), db = new Float32Array(V), end = new Float32Array(V), side = new Float32Array(V), seg = new Float32Array(V);
		const index = new Uint32Array(L * 6);
		const cut = cell * 1.4;
		for (let l = 0; l < L; l++) {
			const a = ids[ord[l]], b = ids[ord[l + 1]];
			const far = brk[l + 1] === 1 || Math.hypot(T[a * 3] - T[b * 3], T[a * 3 + 1] - T[b * 3 + 1], T[a * 3 + 2] - T[b * 3 + 2]) > cut;
			index.set([l * 4, l * 4 + 1, l * 4 + 2, l * 4 + 2, l * 4 + 1, l * 4 + 3], l * 6);
			for (let v = 0; v < 4; v++) {
				const q = l * 4 + v;
				for (let c = 0; c < 3; c++) {
					A[q * 3 + c] = O[a * 3 + c];
					TA[q * 3 + c] = T[a * 3 + c];
					B[q * 3 + c] = O[b * 3 + c];
					TB[q * 3 + c] = T[b * 3 + c];
				}
				ia[q] = a / N;
				ib[q] = b / N;
				da[q] = D[a];
				db[q] = D[b];
				end[q] = v >> 1;
				side[q] = v & 1 ? 1 : -1;
				seg[q] = far ? -1 : l / L;
			}
		}
		const lg = new THREE.BufferGeometry();
		lg.setAttribute('position', new THREE.BufferAttribute(A.slice(), 3));
		lg.setAttribute('aOrigin', new THREE.BufferAttribute(A, 3));
		lg.setAttribute('aTarget', new THREE.BufferAttribute(TA, 3));
		lg.setAttribute('aOriginB', new THREE.BufferAttribute(B, 3));
		lg.setAttribute('aTargetB', new THREE.BufferAttribute(TB, 3));
		lg.setAttribute('aIdx', new THREE.BufferAttribute(ia, 1));
		lg.setAttribute('aIdxB', new THREE.BufferAttribute(ib, 1));
		lg.setAttribute('aDepth', new THREE.BufferAttribute(da, 1));
		lg.setAttribute('aDepthB', new THREE.BufferAttribute(db, 1));
		lg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
		lg.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
		lg.setAttribute('aSeg', new THREE.BufferAttribute(seg, 1));
		lg.setIndex(new THREE.BufferAttribute(index, 1));
		const mat = new THREE.ShaderMaterial({ vertexShader: scopeVert, fragmentShader: scopeFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { ...this.shared, uTOff: { value: 0 } } });
		const line = new THREE.Mesh(lg, mat);
		line.frustumCulled = false;
		line.userData.helper = true;
		this.points.add(line);
		this._scopeLine = line;
		this._scopePath = { ids, ord, L };
	}

	/** Случайное место на текущем кадре блока раскадровки (в координатах облака): для рамок трекинга. Повторяет расстановку кадров из шейдера */
	_frameSample() {
		const u = this.shared;
		const n = u.uFr.value.y;
		const W = u.uFr2.value.z, H = u.uFr2.value.w;
		const idx = u.uFr4.value.x;
		const k = clamp(Math.round(idx), 0, Math.max(0, n - 1));
		const depth = u.uFr3.value.x;
		const uu = (Math.random() - 0.5) * 0.9, vv = (Math.random() - 0.5) * 0.9;
		const dz = u.uFr4.value.y > 0.5 && u.uFr4.value.y < 1.5 ? -1 : 1;
		const cen = u.uFr6.value.y > 0.5 ? (n - 1) * 0.5 : idx;
		const place = (lay) => {
			if (lay > 0.5 && lay < 1.5) {
				const gx = Math.ceil(Math.sqrt(n * (W / H)));
				const gy = Math.ceil(n / gx);
				const s = Math.min(2.4 / (gx * W), 2.4 / (gy * H));
				return new THREE.Vector3((k % gx - (gx - 1) * 0.5) * W * s * 1.04 + uu * W * s, ((gy - 1) * 0.5 - Math.floor(k / gx)) * H * s * 1.04 + vv * H * s, 0);
			}
			if (lay > 1.5 && lay < 2.5) return new THREE.Vector3(uu * W, vv * H, 0);
			return new THREE.Vector3(uu * W, vv * H, ((idx - cen) * depth) / Math.max(n - 1, 1) * dz);
		};
		const a = place(u.uFr3.value.y);
		const w = u.uFr3.value.w;
		if (w > 0.0001) {
			const m = w * w * (3 - 2 * w);
			a.lerp(place(u.uFr3.value.z), m);
		}
		return a;
	}

	/** Анимированный персонаж: концы отрезков линии берут текущие положения своих точек, и линия идёт по телу в любой позе */
	_scopeSyncLine() {
		const sp = this._scopePath;
		const lg = this._scopeLine?.geometry;
		if (!sp || !lg || !this.geometry) return;
		const T = this.geometry.attributes.aTarget.array;
		const { ids, ord, L } = sp;
		const names = ['aOrigin', 'aTarget', 'aOriginB', 'aTargetB'];
		const arrs = names.map((n) => lg.attributes[n].array);
		for (let l = 0; l < L; l++) {
			const a = ids[ord[l]] * 3, b = ids[ord[l + 1]] * 3;
			for (let v = 0; v < 4; v++) {
				const q = (l * 4 + v) * 3;
				for (let c = 0; c < 3; c++) {
					arrs[0][q + c] = arrs[1][q + c] = T[a + c];
					arrs[2][q + c] = arrs[3][q + c] = T[b + c];
				}
			}
		}
		for (const n of names) lg.attributes[n].needsUpdate = true;
	}

	_scopeDropLine() {
		const l = this._scopeLine;
		if (!l) return;
		l.parent?.remove(l);
		l.geometry.dispose();
		l.material.dispose();
		this._scopeLine = null;
	}

	_scopeTick(dt, S, u) {
		const amount = clamp(this._eff(S), 0, 1);
		if (amount <= 0.001 || !this.geometry || !this.points || !this.geometry.attributes.aPath) {
			u.uScope.value.set(0, 0, 0, 1);
			if (this._scopeLine) this._scopeLine.visible = false;
			this._scopeT = 0;
			return;
		}
		const order = S.order || 'walk';
		const gk = this.geometry.uuid + ':' + order + ':' + (order === 'walk' ? Math.round(S.detail) + '/' + Math.round(S.chaos * 20) : 0);
		const lost = this._scopeLine && this._scopeLine.parent !== this.points;
		if (this._scopeKey !== gk || lost) {
			// пока двигают ползунок, путь пересчитывается не чаще раза в четверть секунды
			const sameGeo = this._scopeKey && this._scopeKey.split(':')[0] === this.geometry.uuid;
			if (!sameGeo || lost || !this._scopeWait || performance.now() - this._scopeWait > 250) {
				this._scopeKey = gk;
				this._scopeWait = performance.now();
				if (lost) this._scopeLine = null;
				this._scopeBuild(Math.round(S.detail), order, S.chaos);
			}
		}
		if (this._animCloud && this._scopeLine && this._scopeAnimVer !== this._animVer) {
			this._scopeAnimVer = this._animVer;
			this._scopeSyncLine();
		}
		this._scopeT = (this._scopeT || 0) + dt * S.speed * 0.07;
		// круг: 0..0.5 перо рисует, до 0.6 готовая форма держится, затем перо идёт по ней вторым проходом и стирает; «Остаётся» замирает на готовой форме
		const once = S.loop === 'once';
		const c = once ? Math.min(this._scopeT, 0.55) : this._scopeT % 1;
		const head = Math.min(c / 0.5, 1.05);
		const env = Math.min(1, c / 0.03);
		const out = once ? 0 : Math.max(0, (c - 0.6) / 0.4) * 1.02;
		const comet = S.mode === 'comet';
		u.uScope.value.set(amount, (comet ? 1 : 0) + (S.dir === 'back' ? 2 : 0), head, S.trail);
		u.uScopeP.value.set(S.dim, env, out, S.pens);
		u.uScopeQ.value.set(S.tint, S.thick, S.glow, S.spark);
		if (S.color === 'auto' || !S.color) u.uScopeC.value.copy(u.uP2.value);
		else u.uScopeC.value.set(S.color);
		u.uScopeW.value = S.width;
		u.uScopeLB.value = S.line;
		const L = this._scopeLine;
		if (L) L.visible = order === 'walk' && S.line > 0.01 && !(u.uFr.value.x > 0.5);
	}

	get animReady() {
		return !!this._animCloud;
	}

	/** Шлейф персонажа: копии прошлых поз остаются на месте и гаснут. Снимки берутся из уже посчитанных положений точек, поэтому это почти бесплатно */
	_trailTick(T) {
		const ac = this._animCloud;
		const tr0 = this._trail;
		const hide = () => {
			if (tr0) tr0.group.visible = false;
		};
		if (!T.on || !ac || !this.geometry || !this.points || !this._animBuf || this.state.source !== 'model') return hide();
		const amount = clamp(this._eff(T), 0, 1);
		if (amount < 0.005) return hide();
		const m0 = Math.max(1000, Math.min(Math.round(T.pts), ac.count));
		const stride = Math.max(1, Math.floor(ac.count / m0));
		const mm = Math.floor(ac.count / stride);
		const n = Math.max(2, Math.round(T.count));
		let tr = this._trail;
		if (!tr || tr.group.parent !== this.points || tr.mm !== mm || tr.n !== n || tr.geo !== this.geometry) {
			if (tr) {
				tr.group.removeFromParent();
				tr.group.traverse((o) => {
					if (o.material) o.material.dispose();
					if (o.geometry) o.geometry.dispose();
				});
			}
			const col = new Float32Array(mm * 3);
			const ca = this.geometry.attributes.aColor.array;
			for (let i = 0; i < mm; i++) for (let c = 0; c < 3; c++) col[i * 3 + c] = ca[i * stride * 3 + c];
			const colAttr = new THREE.BufferAttribute(col, 3);
			const group = new THREE.Group();
			group.userData.helper = true;
			const snaps = [];
			const ghosts = [];
			const cur = new Float32Array(mm * 3);
			for (let i = 0; i < mm; i++) for (let c = 0; c < 3; c++) cur[i * 3 + c] = this._animBuf[i * stride * 3 + c];
			for (let k = 0; k <= n; k++) snaps.push(cur.slice());
			for (let k = 0; k < n; k++) {
				const g = new THREE.BufferGeometry();
				g.setAttribute('position', new THREE.BufferAttribute(snaps[k + 1], 3));
				g.setAttribute('color', colAttr);
				const mat = new THREE.ShaderMaterial({
					uniforms: { uSize: { value: 1 }, uAlpha: { value: 0 }, uTint: { value: 0 }, uTintC: { value: new THREE.Color() } },
					vertexShader: 'attribute vec3 color; uniform float uSize; uniform float uTint; uniform vec3 uTintC; varying vec3 vC; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uSize * 3.8 / max(-mv.z, 0.4), 1.0, 60.0); vC = mix(color, uTintC, uTint); }',
					fragmentShader: 'precision highp float; uniform float uAlpha; varying vec3 vC; void main() {\n if (length(gl_PointCoord - 0.5) > 0.5) discard;\n  gl_FragColor = vec4(vC, uAlpha);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
					transparent: true,
					depthWrite: false,
					blending: THREE.NormalBlending,
				});
				const p = new THREE.Points(g, mat);
				p.renderOrder = -1;
				p.frustumCulled = false;
				p.userData.helper = true;
				group.add(p);
				ghosts.push(p);
			}
			this.points.add(group);
			tr = this._trail = { group, snaps, ghosts, mm, n, stride, last: this._time, geo: this.geometry };
		}
		tr.group.visible = true;
		// новый снимок раз в «шаг» времени, пока идёт анимация; остановили анимацию, шлейф замирает
		if (this.app.anim.playing && this._time - tr.last >= T.step) {
			tr.last = this._time;
			const old = tr.snaps.pop();
			for (let i = 0; i < mm; i++) for (let c = 0; c < 3; c++) old[i * 3 + c] = this._animBuf[i * tr.stride * 3 + c];
			tr.snaps.unshift(old);
			tr.ghosts.forEach((p, k) => {
				const a = p.geometry.attributes.position;
				a.array = tr.snaps[k + 1];
				a.needsUpdate = true;
			});
		}
		const u = this.shared;
		const base = u.uSize.value * u.uPR.value * T.size;
		tr.ghosts.forEach((p, k) => {
			const mt = p.material.uniforms;
			mt.uAlpha.value = amount * Math.pow(T.fade, k + 1) * 0.75;
			mt.uSize.value = base * (1 - T.shrink * (k / Math.max(1, n - 1)));
			mt.uTint.value = T.tint;
			mt.uTintC.value.copy(u.uP2.value);
		});
	}

	/** Заранее собирает шейдер эффектов, пока вы работаете в редакторе: первый вход в «Эффекты» не подвисает на компиляции (на Windows она идёт секунды) */
	async prewarm() {
		if (this.active) return;
		// облако точек модели тоже считаем заранее: при входе остаётся только построить буферы
		try {
			if (this.hasModel && !this.pm.ready) {
				const saved = this.state.count;
				this.state.count = Math.max(20000, Math.min(2000000, this.app.settings.point.surfaceCount));
				// тихий режим: подготовка идёт в фоне и не должна показывать окно загрузки (раньше оно оставалось на экране навсегда)
				this._quiet = true;
				try {
					await this._cloudFor('model');
				} finally {
					this.state.count = saved;
					this._quiet = false;
				}
			}
		} catch (e) {
			/* не обязательно */
		}
		if (this._warmMat) return;
		try {
			const vp = this.app.viewport;
			const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: {} });
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
			const sc = new THREE.Scene();
			sc.add(new THREE.Points(g, m));
			this._warmMat = m; // материал держим живым: программа остаётся в кеше и настоящий материал берёт её готовой
			if (vp.renderer.compileAsync) await vp.renderer.compileAsync(sc, vp.camera);
			else vp.renderer.compile(sc, vp.camera);
		} catch (e) {
			/* подготовка не обязательна */
		}
	}

	// ------------------------------------------------------------ глубина (фото и видео)
	onDepthChange(fn) {
		this._dListeners.add(fn);
		return () => this._dListeners.delete(fn);
	}

	_depthEmit() {
		for (const f of this._dListeners) f();
	}

	depthInfo() {
		const ai = this.depthAI;
		const D = this._D;
		const L = this.state.layers.depth;
		return { media: !!this.pm.ready, video: this.pm.kind === 'video', src: L.src, phase: ai.phase, prog: ai.prog, device: ai.device, error: ai.error || D.err, hasMap: !!D.map, aiMap: !!D.map && D.mapSrc === 'ai', busy: D.busy };
	}

	/** Рисует текущую карту глубины серой картинкой в холст */
	drawDepthMap(cv, plain = false) {
		const m = this._D.proc || this._D.map;
		if (!m) return;
		if (cv.width !== m.w || cv.height !== m.h) {
			cv.width = m.w;
			cv.height = m.h;
		}
		const g = cv.getContext('2d');
		const id = g.createImageData(m.w, m.h);
		for (let i = 0; i < m.data.length; i++) {
			const v = Math.round(m.data[i] * 255);
			id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
			id.data[i * 4 + 3] = 255;
		}
		// полоса «остаётся на месте» подсвечена, чтобы было видно, какие участки не выдавливаются
		const L = this.state.layers.depth;
		const fc = L.focus ?? 0.5, zw = L.zone ?? 0.12;
		for (let i = 0; i < m.data.length && !plain; i++) {
			if (Math.abs(m.data[i] - fc) <= zw) {
				id.data[i * 4] = Math.min(255, id.data[i * 4] * 0.5 + 130);
				id.data[i * 4 + 1] = id.data[i * 4 + 1] * 0.55 + 55;
				id.data[i * 4 + 2] = id.data[i * 4 + 2] * 0.3;
			}
		}
		g.putImageData(id, 0, 0);
	}

	/** Нажатие «Построить карту глубины»: загружает нейросеть (если ещё нет) и считает карту для текущего кадра */
	buildDepth() {
		const D = this._D;
		D.force = true;
		D.err = '';
		if (this.depthAI.phase === 'error') this.depthAI.dispose();
		this.depthAI.init().catch(() => {});
		this._depthEmit();
	}

	saveDepthMap() {
		const m = this._D.map;
		if (!m) return;
		const cv = document.createElement('canvas');
		this.drawDepthMap(cv, true);
		cv.toBlob((b) => b && downloadBlob(b, 'depth-map.png'), 'image/png');
	}

	/** Каждый кадр: карта глубины (нейросеть или яркость), перенос на точки и плавный переход к новой карте */
	_depthTick(dt, rgb) {
		const L = this.state.layers.depth;
		const D = this._D;
		const pm = this.pm;
		const g = this.geometry;
		const n = pm.count;
		const key = pm.rec || pm.el;
		if (D.key !== key) {
			Object.assign(D, { key, map: null, mapSrc: '', aiHas: false, st: {}, tgt: null, busy: false, rgb: null, rgbN: 0, lumaN: -1, reqT: -1e9, err: '' });
			this._depthEmit();
		}
		if (rgb) {
			D.rgb = rgb;
			D.rgbN++;
		}
		if (!L.on) return;
		const ai = L.src === 'ai';
		// быстрая карта по яркости: основная при выборе «По яркости» и временная, пока нейросеть думает
		if (D.rgb && D.lumaN !== D.rgbN && (!ai || !D.aiHas)) {
			D.lumaN = D.rgbN;
			D.map = lumaDepth(D.rgb, pm.cols, pm.rows);
			D.mapSrc = 'luma';
			D.dirty = true;
			this._depthEmit();
		}
		if (!ai && D.aiHas) {
			D.aiHas = false;
			D.lumaN = -1;
		}
		if (ai && !D.busy && this.depthAI.phase !== 'error') {
			const el = pm.isRec ? null : pm.el;
			const vt = pm.isRec ? pm.t : el.currentTime || 0;
			const ready = pm.isRec ? !!D.rgb : el && (pm.kind === 'image' || el.readyState >= 2);
			const need = D.force || !D.aiHas || (pm.kind === 'video' && Math.abs(vt - D.reqT) > 0.03);
			if (ready && need) {
				D.busy = true;
				D.force = false;
				D.reqT = vt;
				const cpu = this.depthAI.device === 'wasm';
				// размер кадра для нейросети (длинная сторона): разрешение карты равно ему, на процессоре и на видео берём поменьше, чтобы карта успевала за кадром
				const side = pm.kind === 'video' ? (cpu ? 280 : 448) : cpu ? 420 : 640;
				const frame = pm.isRec ? grabRGB4(D.rgb, pm.cols, pm.rows) : grabFrame(el, side);
				if (!frame) D.busy = false;
				else {
					this.depthAI
						.estimate(frame)
						.then((r) => {
							if (D.key !== key) return;
							D.map = { w: r.w, h: r.h, data: normalizeDepth(r.data, D.st, pm.kind === 'video' ? 0.35 : 0) };
							D.mapSrc = 'ai';
							D.aiHas = true;
							D.dirty = true;
							D.err = '';
						})
						.catch((e) => {
							D.err = e.message || String(e);
						})
						.finally(() => {
							D.busy = false;
							this._depthEmit();
						});
					this._depthEmit();
				}
			}
		}
		// правка карты: размытие, яркость, контраст, тени
		const P = [L.bright ?? 0, L.contrast ?? 1, L.gamma ?? 1, L.blur ?? 0].join('|');
		if (D.map && (D.dirty || D.pSig !== P || !D.proc)) {
			D.proc = adjustDepth(D.map, { bright: L.bright, contrast: L.contrast, gamma: L.gamma, blur: L.blur });
			D.pSig = P;
			D.dirty = true;
			this._depthEmit();
		}
		// превью зоны «на месте» обновляется и при сдвиге ползунков фокуса
		const TS = (L.focus ?? 0.5) + '|' + (L.zone ?? 0.12);
		if (D.tSig !== TS) {
			D.tSig = TS;
			this._depthEmit();
		}
		// карта на сетку точек
		if (D.proc && (D.dirty || !D.tgt || D.tgt.length !== n)) {
			if (!D.tgt || D.tgt.length !== n) {
				D.tgt = new Float32Array(n);
				D.snap = true;
			}
			depthToGrid(D.proc, pm.cols, pm.rows, D.tgt);
			D.dirty = false;
			D.moving = true;
		}
		const attr = g.attributes.aDepth;
		if (!D.tgt || !attr || attr.array.length !== n) return;
		const arr = attr.array;
		if (D.geo !== g) {
			D.geo = g;
			D.snap = true;
		}
		let changed = false;
		if (D.snap) {
			arr.set(D.tgt);
			D.snap = false;
			D.moving = false;
			changed = true;
		} else if (D.moving) {
			// переход к новой карте: у видео глубина поспевает за кадром, у фото плавно «проявляется»
			const rate = 1 - Math.exp(-dt * (2.5 + (1 - L.smooth) * 18));
			const tg = D.tgt;
			let mx = 0;
			for (let i = 0; i < n; i++) {
				const d = tg[i] - arr[i];
				arr[i] += d * rate;
				const a = d < 0 ? -d : d;
				if (a > mx) mx = a;
			}
			if (mx < 0.002) D.moving = false;
			changed = true;
		}
		if (changed) {
			attr.needsUpdate = true;
			if (this.state.layers.links.on && (D._lk = ((D._lk || 0) + 1) % 5) === 0) this._syncLinks();
		}
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
		if (this.sourceType === 'video') return 'Звук видео';
		return (SYNTH_STYLES.find((s) => s.id === this.state.audio.style) || SYNTH_STYLES[0]).name;
	}

	async play() {
		this._ensureCtx();
		if (this.ctx.state === 'suspended') await this.ctx.resume();
		if (this.sourceType === 'synth') {
			this.synth.start(this.state.audio.style);
			this.playing = true;
		} else if (this.sourceType === 'video') {
			this._connectVideo();
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
		this._disconnectVideo();
		this.playing = false;
		this.emit();
	}

	/** Звук открытого видео: один раз заводим в аудиограф, дальше он идёт либо в анализатор (режим эффектов), либо прямо в колонки */
	_videoGate() {
		const el = this.pm.el;
		if (!el || this.pm.kind !== 'video') return null;
		this._ensureCtx();
		if (!el._fxNode) {
			el._fxNode = this.ctx.createMediaElementSource(el);
			el._fxGate = this.ctx.createGain();
			el._fxNode.connect(el._fxGate);
			el.muted = false;
		}
		return el._fxGate;
	}

	_connectVideo() {
		const gate = this._videoGate();
		if (!gate) return false;
		gate.disconnect();
		gate.gain.value = 1;
		gate.connect(this.bus);
		this._vidGate = gate;
		// выключение звука видео в эффектах гасит только вывод: анализ продолжает работать
		this.pm.onMute = (m) => {
			if (this.out) this.out.gain.value = m ? 0 : this.state.audio.volume;
		};
		this.pm.onMute(this.pm.muted);
		this.pm.play();
		return true;
	}

	/** Беззвучный приёмник: если узел видео ни к чему не подключён, браузер перестаёт его читать и видео зависает */
	_vidSink() {
		if (!this._sink) {
			this._sink = this.ctx.createGain();
			this._sink.gain.value = 0;
			this._sink.connect(this.ctx.destination);
		}
		return this._sink;
	}

	_disconnectVideo() {
		if (this._vidGate) {
			const gate = this._vidGate;
			try {
				gate.disconnect();
				gate.connect(this._vidSink());
			} catch (e) {
				/* уже отключён */
			}
			this._vidGate = null;
			this.pm.onMute = null;
			if (this.out) this.out.gain.value = this.state.audio.volume;
		}
	}

	/** В редакторе видео играет напрямую в колонки, минуя анализатор */
	_videoToEditor() {
		this._disconnectVideo();
		const gate = this.pm.el?._fxGate;
		if (!gate || !this.ctx) return;
		gate.disconnect();
		gate.gain.value = this.pm.muted ? 0 : 1;
		gate.connect(this.ctx.destination);
		this.pm.onMute = (m) => {
			gate.gain.value = m ? 0 : 1;
		};
	}

	async useVideoAudio() {
		if (!this.pm.ready || this.pm.kind !== 'video') throw new Error('Откройте видео на вкладке «Медиа»');
		this._ensureCtx();
		this.synth.stop();
		this._stopFile();
		this._stopMic();
		this.sourceType = 'video';
		this.touch();
		await this.play();
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
		if (!SYNTH_STYLES.some((x) => x.id === this.state.audio.style)) this.state.audio.style = 'deep';
		this._disconnectVideo();
		this._stopMic();
		this._stopFile();
		this.sourceType = 'synth';
		this.touch();
		await this.play();
	}

	async loadFile(file) {
		this._ensureCtx();
		this._disconnectVideo();
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
		this._disconnectVideo();
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
				this._markBeat();
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
		if (key === 'frames') return this._frameCloud || null;
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
		// один и тот же расчёт не запускаем дважды (предзагрузка и нажатие кнопки)
		const pend = (this._pend ||= new Map());
		if (pend.has(ck)) return pend.get(ck);
		const job = (async () => {
			let c;
			if (key === 'model') {
				c = this.modelProvider ? await this.modelProvider.get(n) : null;
				if (!c) return null;
				c = mortonSort(fitCount(normalizeCloud(c), n));
			} else if (key.startsWith('obj:')) {
				const o = this.modelProvider?.objects().find((x) => x.id === key.slice(4));
				c = o ? await this.modelProvider.getOf(o.obj, n) : null;
				if (!c || !c.count) return null;
				c = mortonSort(fitCount(normalizeCloud(c), n));
			} else {
				c = generateShapePoints(key, n);
			}
			this.cache.set(ck, c);
			return c;
		})();
		pend.set(ck, job);
		try {
			return await job;
		} finally {
			pend.delete(ck);
		}
	}

	/** Заранее готовит облака точек выбранных моделей, чтобы переход стартовал сразу, а не после паузы на расчёт */
	async _prefetch(keys) {
		const token = (this._pfT = (this._pfT || 0) + 1);
		for (const k of keys || []) {
			if (token !== this._pfT || !this.active) return;
			this._quiet = true;
			try {
				await this._cloudFor(k);
			} catch (e) {
				/* не критично: посчитаем при запуске */
			} finally {
				this._quiet = false;
			}
			await new Promise((r) => setTimeout(r, 30));
		}
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
		const model = st.source === 'model' || st.source === 'media' || st.source === 'frames' ? c : this.hasModel ? (await this._cloudFor('model').catch(() => null)) || c : c;
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
		g.setAttribute('aOrigin', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
		g.setAttribute('aTarget', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
		g.setAttribute('aNormal', new THREE.BufferAttribute(new Float32Array(c.normals), 3));
		g.setAttribute('aNormalB', new THREE.BufferAttribute(new Float32Array(c.normals), 3));
		g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(model.colors.length === c.colors.length ? model.colors : c.colors), 3));
		g.setAttribute('aColorB', new THREE.BufferAttribute(new Float32Array(g.attributes.aColor.array), 3));
		g.setAttribute('aHide', new THREE.BufferAttribute(c.hide && c.hide.length === count ? new Float32Array(c.hide) : new Float32Array(count), 1));
		g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(count).fill(0.5), 1));
		g.setAttribute('aPath', new THREE.BufferAttribute(new Float32Array(count), 1));
		g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
		g.setAttribute('aSculpt', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
		g.setAttribute('aVis', new THREE.BufferAttribute(new Float32Array(count * 2).fill(1), 2));
		this._grabs = new Map();
		// облако посажено на персонажа с анимацией: каждый кадр точки пересчитываются по позе скелета
		this._animCloud = st.source === 'model' && c.anim && c.norm ? c : null;
		this._animVer = -1;
		if (!this.specTex) {
			this.specTex = new THREE.DataTexture(new Uint8Array(64), 64, 1, THREE.RedFormat, THREE.UnsignedByteType);
			this.specTex.minFilter = this.specTex.magFilter = THREE.LinearFilter;
			this.specTex.needsUpdate = true;
		}
		if (!this.pieceTex) {
			this.pieceTex = new THREE.DataTexture(new Float32Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.FloatType);
			this.pieceTex.minFilter = this.pieceTex.magFilter = THREE.NearestFilter;
			this.pieceTex.needsUpdate = true;
			this._pieceKey = '';
		}
		const U = (v) => ({ value: v });
		// общие униформы: точки, призраки и линии читают одни и те же значения
		const shared = {
			uTime: U(0), uMorph: U(1), uMorphS: U(new THREE.Vector4(0, 0.8, 0.35, 1)), uMorphO: U(new THREE.Vector4(0, 0, 0.4, 0)), uSettle: U(-1), uFr: U(new THREE.Vector4()), uFr2: U(new THREE.Vector4(1, 1, 2.2, 1.2)), uFr3: U(new THREE.Vector4(1.6, 0, 0, 0)), uFr4: U(new THREE.Vector4(0, 0, 0.12, 0.7)), uFr5: U(new THREE.Vector4(0, 0.7, 1, 1)), uHero: U(new THREE.Vector4()), uFr6: U(new THREE.Vector4(1.5, 0, 0, 0.5)), uFr7: U(new THREE.Vector4(1, 0, 0.6, 0)), uHeroTex: U(frDummy2D()), uFrTex: U(frDummyTex()), uSize: U(3), uPR: U(1), uBeat: U(0), uColorBy: U(0), uBright: U(1), uGlow: U(0.8), uAdd: U(1), uDens: U(Math.min(1.6, Math.sqrt(150000 / count))),
			uP0: U(new THREE.Color()), uP1: U(new THREE.Color()), uP2: U(new THREE.Color()), uYR: U(new THREE.Vector2(-1, 1)),
			uShade: U(0), uGlyph: U(new THREE.Vector3(0, 1, 8)), uAtlas: U(glyphAtlas('ascii')), uMouse: U(new THREE.Vector3()), uMouseOn: U(0), uSpecTex: U(this.specTex),
			uCurl: U(new THREE.Vector4()), uSpec: U(new THREE.Vector4()), uWave: U(new THREE.Vector4()), uTwist: U(new THREE.Vector4()),
			uPulse: U(new THREE.Vector4()), uVoxel: U(new THREE.Vector4()), uJitter: U(new THREE.Vector4()), uCursor: U(new THREE.Vector4()),
			uGlitch: U(new THREE.Vector4()), uSlice: U(new THREE.Vector4()), uSliceM: U(new THREE.Vector4()), uSliceC: U(new THREE.Color()), uMark: U(new THREE.Vector4()), uMarkC: U(new THREE.Color()), uLink: U(new THREE.Vector4()), uContact: U(new THREE.Vector4()), uShockP: U(new THREE.Vector4()),
			uTrk: U(Array.from({ length: 16 }, () => new THREE.Vector4())), uImp: U(Array.from({ length: 32 }, () => new THREE.Vector4())), uShock: U(Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, -1))),
			uMask: U(new THREE.Vector4()), uMaskA: U(new THREE.Vector4()), uMaskShow: U(0),
			uPhysics: U(new THREE.Vector4()), uCollapseTime: U(0),
			uBrushHits: U(Array.from({ length: 20 }, () => new THREE.Vector4(0, 0, 0, -1))), uBrushParam: U(new THREE.Vector4()),
			uLookP2: U(new THREE.Vector4()), uDof: U(new THREE.Vector4()),
			uScopeC: U(new THREE.Color(0.24, 1, 0.48)), uScopeW: U(2.4), uScopeLB: U(1), uDepth: U(new THREE.Vector4()), uDepthP: U(new THREE.Vector4()), uDepthQ: U(new THREE.Vector4()), uFlat: U(0), uScope: U(new THREE.Vector4()), uScopeP: U(new THREE.Vector4()), uScopeQ: U(new THREE.Vector4()), uShape: U(1), uCurlP: U(new THREE.Vector4()), uSpecP: U(new THREE.Vector4()), uWaveP: U(new THREE.Vector4()), uWaveSrc: U(new THREE.Vector4()), uPulseP: U(new THREE.Vector4()), uVoxelP: U(new THREE.Vector4()), uGlitchP: U(new THREE.Vector4()), uBlast: U(new THREE.Vector4()), uFlow: U(new THREE.Vector4()), uDisP: U(new THREE.Vector4()), uSolid: U(new THREE.Color()), uAtt: U(1), uHand: U(Array.from({ length: 12 }, () => new THREE.Vector4())), uHandP: U(new THREE.Vector4()), uGrav: U(new THREE.Vector4()), uGravT: U(new THREE.Vector4()), uPhysP: U(new THREE.Vector4()), uAsm: U(0), uDis: U(new THREE.Vector4()), uDisT: U(0.8), uAnimN: U(0), uCen: U(new THREE.Vector3()), uExp: U(new THREE.Vector4()), uExpP: U(new THREE.Vector4()), uPieceTex: U(this.pieceTex), uGrow: U(new THREE.Vector4()), uGrowP: U(new THREE.Vector4()), uGrowSeed: U(new THREE.Vector3()), uJel: U(Array.from({ length: 3 }, () => new THREE.Vector4(0, 0, 0, -99))), uJelO: U(Array.from({ length: 3 }, () => new THREE.Vector4())), uJelP: U(new THREE.Vector4()),  uDisQ: U(new THREE.Vector4(0.32, 1, 0.35, 0.85)), uGravP: U(new THREE.Vector4()), uRes: U(new THREE.Vector2(1, 1)), uLinkW: U(1.8),
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
		shared.uCen.value.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2);
		this._yrBase = [bb.min.y, bb.max.y];
		// сетка на полу: форма стоит на ней, а не проходит насквозь. У анимированной модели пол идёт по самой низкой точке всего движения
		this.app.viewport.fxFloorY = c.norm && c.norm.floorY !== undefined ? c.norm.floorY : bb.min.y;
		const old = this.points;
		const rot = old ? old.rotation.clone() : null;
		if (old) this._disposePoints();
		// шлейф: до пяти призрачных копий (след, спираль, калейдоскоп), делят геометрию с основной
		this.ghosts = [1, 2, 3, 4, 5].map((k) => {
			const gm = mk({ uTOff: U(0), uGhost: U(0), uHero: U(new THREE.Vector4()) });
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
		// связи нужны только включённому эффекту: при входе в режим их подбор занимал десятки миллисекунд зря
		if (!this.state.layers.links.on) {
			this._linksStale = true;
			return;
		}
		this._linksStale = false;
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
		const da = new Float32Array(V), db = new Float32Array(V);
		const DP = g.attributes.aDepth ? g.attributes.aDepth.array : null;
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
				da[l * 4 + v] = DP ? DP[a] : 0.5;
				db[l * 4 + v] = DP ? DP[b] : 0.5;
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
		lg.setAttribute('aDepth', new THREE.BufferAttribute(da, 1));
		lg.setAttribute('aDepthB', new THREE.BufferAttribute(db, 1));
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
		const DP = this.geometry.attributes.aDepth?.array;
		if (DP && lg.attributes.aDepth) {
			const da = lg.attributes.aDepth.array, db = lg.attributes.aDepthB.array;
			for (let l = 0; l < list.length / 2; l++) {
				const a = DP[ids[list[l * 2]]], b = DP[ids[list[l * 2 + 1]]];
				for (let v = 0; v < 4; v++) {
					da[l * 4 + v] = a;
					db[l * 4 + v] = b;
				}
			}
			lg.attributes.aDepth.needsUpdate = lg.attributes.aDepthB.needsUpdate = true;
		}
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
		let target;
		try {
			target = await this._cloudFor(key);
		} finally {
			this.app.ui.idle(); // выбор формы мог показать окно загрузки: закрываем его в любом случае
		}
		if (!target) return this.emit();
		this.curKey = key;
		if (!target || target.count !== this.geometry.attributes.position.count) {
			await this._build();
			return this.emit();
		}
		const g = this.geometry;
		const o = g.attributes.aOrigin;
		const t = g.attributes.aTarget;
		// если новый переход начался до конца прежнего, считаем прежний завершённым: пути у видов сложные, середину по прямой не посчитать
		const k = this.morphing ? 1 : this.morph * this.morph * (3 - 2 * this.morph);
		for (let i = 0; i < o.array.length; i++) {
			o.array[i] = o.array[i] * (1 - k) + t.array[i] * k;
			t.array[i] = target.positions[i];
		}
		// цвета и нормали тоже перетекают: прежние берём из «второго набора», новые кладём в него, а шейдер смешивает их по ходу перехода
		g.attributes.aNormal.array.set(g.attributes.aNormalB.array);
		g.attributes.aNormalB.array.set(target.normals);
		{
			// пол сетки переезжает под новую форму
			let my = Infinity;
			const tp = target.positions;
			for (let i = 1; i < tp.length; i += 3) if (tp[i] < my) my = tp[i];
			this.app.viewport.fxFloorY = target.norm && target.norm.floorY !== undefined ? target.norm.floorY : my;
		}
		g.attributes.aNormal.needsUpdate = g.attributes.aNormalB.needsUpdate = true;
		if (target.colors && target.colors.length === g.attributes.aColor.array.length) {
			g.attributes.aColor.array.set(g.attributes.aColorB.array);
			g.attributes.aColorB.array.set(target.colors);
			g.attributes.aColor.needsUpdate = g.attributes.aColorB.needsUpdate = true;
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
		this._settleOn = false;
		this.shared.uSettle.value = -1;
		this.shared.uMorph.value = 0; // сразу, не дожидаясь кадра: иначе на один кадр мелькает новая модель
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
		this._prefetch(this.playlist);
		this.emit();
	}

	/** В сцене редактора что-то изменилось (например, добавили модель): пересобираем облако */
	_onScene() {
		if (!this.active || this._muteScene) return;
		clearTimeout(this._sceneT);
		this._sceneT = setTimeout(async () => {
			if (!this.active) return;
			this.cache.clear();
			if (this.hasModel && !(this.pm.ready && this.state.source === 'media')) {
				this.state.source = 'model';
				this.syncLookFromPoints();
			}
			this.app.ui.busy('Готовлю частицы', 0.2);
			try {
				// новая модель плавно перетекает из прежней формы: полная пересборка точек гасила сцену на кадр, и экран мигал
				if (this.geometry && this.hasModel && this.state.source === 'model') await this.setSource('model');
				else await this._build();
			} catch (e) {
				console.error(e);
			} finally {
				// окно загрузки всегда закрываем: раньше оно оставалось поверх сцены после добавления модели
				this.app.ui.idle();
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
		this.state.look.autoRotate = false; // при входе форма не крутится сама, включается в «Вид»
		this.state.layers.frames.on = false; // раскадровка включается вручную и только пока открыто видео
		this._framesOn = false;
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
		try {
			if (app.viewport.renderer.compileAsync) await app.viewport.renderer.compileAsync(app.viewport.scene, app.viewport.camera);
		} catch (e) {
			/* подготовка не обязательна */
		}
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
		document.getElementById('app').classList.remove('fx-mode', 'fx-focus');
		this.app.display.apply();
		this.app.nav.frameAll(false);
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
		if (!d || d.b !== 0) return;
		return;
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
	/** Текущий уровень звука в полосе эффекта 0..1: готовая полоса или свой диапазон спектра */
	_bandLevel(l) {
		if (l.band === 'custom') {
			const i0 = Math.max(0, Math.floor(l.lo * 64));
			const i1 = Math.min(64, Math.max(i0 + 1, Math.ceil(l.hi * 64)));
			let s = 0;
			for (let i = i0; i < i1; i++) s += this.spec[i];
			return Math.min(1, (s / (i1 - i0)) * 1.5);
		}
		return this.levels[l.band] || 0;
	}

	/** Частота (Гц) для положения на оси спектра 0..1 */
	hzAt(x) {
		const sr = this.ctx?.sampleRate || 44100;
		return Math.round(x * x * 0.275 * sr);
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
		return l.amount * (1 - l.react + l.react * b * 2) * g;
	}

	/** Заморозка: время эффектов и звук стоят, пока открыто окно экспорта; после него всё продолжается с того же места */
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

	_loop() {
		const tick = (now) => {
			if (!this.active) return;
			this._raf = requestAnimationFrame(tick);
			const capFps = this.app.settings.render.fpsCap;
			if (capFps && now - this._lastT < 1000 / capFps - 3) return;
			// пока открыто окно экспорта, время эффектов стоит на месте
			const dt = this.frozen ? 0 : Math.min(0.1, (now - this._lastT) / 1000);
			this._lastT = now;
			this._lastDt = dt;
			const st0 = this.state;
			this._time += dt;
			this._framesTick();
			if (this.animPlaying) {
				try {
					this._animStep(dt);
				} catch (e) {
					// ошибка в анимации не должна останавливать отрисовку сцены
					this.animPlaying = false;
					this.animRec = false;
					this.app.toast('Анимация остановлена: ' + (e.message || e), 'error');
				}
			}
			this._analyse(dt);
			if (!this.material) return;
			if (this.morphing) {
				this.morph = Math.min(1, this.morph + dt / Math.max(0.3, st0.morphCfg.time));
				this._syncLinks();
				if (this.morph >= 1) {
					this.morphing = false;
					this._settleOn = true;
					this._settleT = this._time;
				}
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
			if (this.post) this.post.tint = new THREE.Color(pal.c[0]);
			u.uTime.value = this._time;
			// во время перехода эффекты плавно гаснут и после сборки так же плавно возвращаются: форма собирается чисто, но эффекты остаются на обеих моделях
			{
				const m = this.morphing ? this.morph : 1;
				const sm = (a, b, x) => {
					const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
					return t * t * (3 - 2 * t);
				};
				this._fxGate = m >= 1 ? 1 : m < 0.5 ? 1 - sm(0, 0.2, m) : sm(0.6, 1, m);
				if (this._settleOn) {
					const p = (this._time - this._settleT) / 1.2;
					u.uSettle.value = p >= 1 ? -1 : p;
					if (p >= 1) this._settleOn = false;
				}
			}
			u.uMorph.value = this.morph;
			{
				const mcf = st.morphCfg;
				u.uMorphS.value.set(Math.max(0, MORPH_STYLES.findIndex((x) => x.id === mcf.style)), mcf.scatter, mcf.stagger, mcf.turns);
				u.uMorphO.value.set(Math.max(0, MORPH_SORTS.findIndex((x) => x[0] === mcf.sort)), Math.max(0, MORPH_EASES.findIndex((x) => x[0] === mcf.ease)), mcf.glow, 0);
			}
			// вид точек общий с вкладкой «Точки» редактора: форма, размер, цвет, затухание вдали
			const pset = this.app.settings.point;
			u.uSize.value = pset.size;
			u.uShape.value = this._eff(L.voxel) > 0.25 ? 0 : Math.max(0, ['square', 'circle', 'sphere', 'ring', 'diamond', 'plus'].indexOf(pset.shape));
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
			// яркость всей сцены может пульсировать в такт выбранным частотам
			u.uBright.value = look.bright * (1 + (look.brightAudio || 0) * this._bandLevel({ band: look.audioBand || 'bass' }) * 1.8);
			u.uGlow.value = look.glow;
			u.uColorBy.value = Math.max(0, COLOR_BY.findIndex((c) => c.id === look.colorBy));
			u.uP0.value.set(pal.c[0]);
			u.uP1.value.set(pal.c[1]);
			u.uP2.value.set(pal.c[2]);
			const add = look.blend === 'add';
			u.uAdd.value = add ? 1 : 0;
			const bl = add ? THREE.AdditiveBlending : THREE.NormalBlending;
			if (this.material.blending !== bl) {
				for (const m of [this.material, ...this.ghosts.map((g) => g.material), ...(this.hero ? [this.hero.material] : [])]) {
					m.blending = bl;
					m.transparent = add;
					m.depthWrite = !add;
					m.needsUpdate = true;
				}
			}
			// ритм: отметка последнего удара. Без музыки эффекты бьют сами с заданным периодом
			if (this._tb === undefined) this._tb = -9;
			if (!this.playing && this._time - this._tb > (L.blast.period || 1.6)) this._markBeat();
			u.uCurl.value.set(this._eff(L.curl), L.curl.scale, 0, 0);
			u.uCurlP.value.set(L.curl.speed, L.curl.flow, { stream: 1, orbit: 2 }[L.curl.mode] ?? 0, 0);
			u.uSpec.value.set(this._eff(L.spectrum), { wool: 0, height: 1, bars: 2, terrain: 3 }[L.spectrum.mode] ?? 0, 0, 0);
			u.uSpecP.value.set(0, L.spectrum.bars, 0, 0);
			u.uWave.value.set(this._eff(L.wave), L.wave.freq, 0, 0);
			{
				const W = L.wave;
				const wm = { rings: 0, drops: 1, plane: 2, spiral: 3, rise: 4 }[W.mode] ?? 0;
				// капли идут по своему таймеру, не зависят от «Взрыва» и от музыки; под музыку (если выбран диапазон и звук играет) капают на удар
				const useBeat = W.band !== 'none' && this.playing;
				if (this._wdT === undefined) this._wdT = -9;
				if (!this._wdSrc) this._wdSrc = new THREE.Vector3();
				if (!useBeat && this._time - this._wdT > (W.period || 1.4)) {
					this._wdT = this._time;
					const gg = this.geometry;
					if (gg) {
						const ta = gg.attributes.aTarget.array;
						const ii = Math.floor(Math.random() * (ta.length / 3)) * 3;
						this._wdSrc.set(ta[ii], ta[ii + 1], ta[ii + 2]);
					}
				}
				const sw = useBeat ? (this._waveSrc ||= new THREE.Vector3()) : this._wdSrc;
				const src = wm === 0 && W.origin === 'cursor' && this.mouseOn ? this.mouse : wm === 1 ? sw : new THREE.Vector3();
				u.uWaveSrc.value.set(src.x, src.y, src.z, W.dir);
				u.uWaveP.value.set(W.speed, wm, W.decay, useBeat ? this._tb : this._wdT);
			}
			u.uTwist.value.set(L.twist.mode === 'jelly' ? 0 : this._eff(L.twist), { twist: 0, bend: 1, taper: 2, snake: 3, breathe: 4 }[L.twist.mode] ?? 0, L.twist.speed, 0);
			{
				// «Пульс» стал видом эффекта «Взрыв»: тот же ритм и те же блоки таймлайна. Старый слой пульса работает как раньше, только у пресетов
				const B = L.blast;
				const bs = B.style || 'burst';
				const P = bs === 'burst' ? { on: false, amount: 0, mode: 'shell', delay: 0.35, speed: 1 } : { on: B.on, amount: B.amount, band: B.band, react: B.react, amode: B.amode, mode: bs, delay: B.delay ?? 0.35, speed: B.pspeed ?? 1 };
				const pm = { flat: 0, shell: 1, squash: 2 }[P.mode] ?? 1;
				u.uPulse.value.set(pm === 0 ? (bs === 'burst' ? this._eff(P) : this._eff(B)) : P.on ? P.amount : 0, 0, 0, 0);
				u.uPulseP.value.set(pm, P.delay, this._tb, P.speed);
			}
			u.uBlast.value.set(L.blast.on && (L.blast.style || 'burst') === 'burst' ? this._eff(L.blast) : 0, L.blast.decay, L.blast.random, this._tb);
			u.uFlow.value.set(this._eff(L.flow), L.flow.scale, L.flow.speed, L.flow.dir);
			u.uVoxel.value.set(clamp(this._eff(L.voxel), 0, 1), 0, 0, 0);
			u.uVoxelP.value.set({ grid: 0, lego: 1, breathe: 2, wave: 3, stairs: 4, scatter: 5 }[L.voxel.mode] ?? 0, L.voxel.speed, L.voxel.size ?? 1, L.voxel.height ?? 1);
			u.uJitter.value.set(this._eff(L.jitter), 0, 0, 0);
			// разбор на части
			{
				const X = L.explode;
				const xe = this._eff(X);
				let p = 0;
				if (X.on && xe > 0.001) {
					if (X.mode === 'loop') {
						this._exT = (this._exT || 0) + dt * X.speed * 0.25;
						const c = (this._exT % 2) / 2;
						const x = c < 0.35 ? c / 0.35 : c < 0.6 ? 1 : 1 - (c - 0.6) / 0.4;
						p = x * x * (3 - 2 * x);
					} else p = 1;
					this._pieceUpdate(X.pieces);
				}
				u.uExp.value.set(p, Math.max(2, Math.min(256, X.pieces)), X.stagger, X.spin);
				u.uExpP.value.set(xe * X.dist * 0.9, 0, 0, 0);
			}
			// желе (вид деформации): упругая дрожь расходится от толчков
			{
				const J = L.twist;
				const jOn = J.on && J.mode === 'jelly';
				const je = jOn ? this._eff(J) : 0;
				const ks = (this._jk ||= []);
				const addKick = (origin, dir) => {
					ks.unshift({ t0: this._time, o: origin.clone(), d: dir.clone() });
					ks.length = Math.min(ks.length, 3);
				};
				if (jOn && je > 0.001) {
					if (J.jmode === 'auto') {
						if (this._time - (this._jkT ?? -9) > J.jperiod && this.geometry) {
							this._jkT = this._time;
							const ta = this.geometry.attributes.aTarget.array;
							const ii = Math.floor(Math.random() * (ta.length / 3)) * 3;
							const o = new THREE.Vector3(ta[ii], ta[ii + 1], ta[ii + 2]);
							const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
							addKick(o, d);
						}
					} else if (this._animCloud) {
						// движение модели: толчок рождается от резкого изменения скорости центра (прыжок, остановка, приземление)
						const cn = u.uCen.value;
						if (!this._jc) {
							this._jc = cn.clone();
							this._jv = new THREE.Vector3();
						}
						const vel = cn.clone().sub(this._jc).divideScalar(Math.max(dt, 1e-3));
						const acc = vel.clone().sub(this._jv);
						this._jc.copy(cn);
						this._jv.copy(vel);
						const am = acc.length();
						if (am > 3.5 && this._time - (this._jkT ?? -9) > 0.15) {
							this._jkT = this._time;
							addKick(cn, acc.clone().multiplyScalar(-1 / am).multiplyScalar(Math.min(1, am / 16)));
						}
					}
				}
				for (let i = 0; i < 3; i++) {
					const k2 = ks[i];
					if (k2) {
						u.uJel.value[i].set(k2.d.x, k2.d.y, k2.d.z, k2.t0);
						u.uJelO.value[i].set(k2.o.x, k2.o.y, k2.o.z, 0);
					} else u.uJel.value[i].set(0, 0, 0, -99);
				}
				u.uJelP.value.set(J.jfreq, J.jdamp, jOn ? Math.min(1.5, je) : 0, J.jsquash);
			}
			{
				this._scopeTick(dt, L.scope, u);
			}
			// у фото, видео и блока кадров своя геометрия: направление наружу идёт по взгляду, а вертикальный размах берётся с кадра, а не с исходного облака
			u.uFlat.value = st.source === 'media' || u.uFr.value.x > 0.5 ? 1 : 0;
			if (this._yrBase) {
				if (u.uFr.value.x > 0.5) {
					const hh = u.uFr3.value.y > 0.5 && u.uFr3.value.y < 1.5 ? 1.25 : Math.max(0.3, u.uFr2.value.w * 0.5);
					u.uYR.value.set(-hh, hh);
				} else u.uYR.value.set(this._yrBase[0], this._yrBase[1]);
			}
			{
				const Dp = L.depth;
				const on = Dp.on && st.source === 'media' && this.pm.ready;
				u.uDepth.value.set(on ? clamp(this._eff(Dp), 0, 1.5) : 0, { relief: 0, layers: 1, breath: 2, wave: 3, ripple: 4, twist: 5, burst: 6 }[Dp.mode] ?? 0, Dp.speed, Dp.focus);
				u.uDepthQ.value.set(Dp.zone ?? 0.12, 0, 0, 0);
				u.uDepthP.value.set(Dp.layers, Dp.dir === 'far' ? -1 : 1, Dp.sway, { photo: 0, map: 1, heat: 2 }[Dp.view] ?? 0);
			}
			u.uGlitch.value.set(this._eff(L.glitch), L.glitch.slices, L.glitch.drop ?? 0.5, 0);
			u.uGlitchP.value.set(L.glitch.rgb === 'on' ? 1 : 0, L.glitch.speed, { bands: 0, blocks: 1, scan: 2 }[L.glitch.mode] ?? 0, L.glitch.burst ?? 0.7);
			u.uDisP.value.set({ wind: 0, burn: 1, laser: 2, layers: 3, chunks: 4, sand: 5, vortex: 6, shock: 7 }[L.dissolve.style] ?? 0, 0, 0, 0);
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
				// сила постоянная, без реакции на бит: осколки спокойно лежат на полу, пока форму не соберут обратно
				u.uPhysics.value.set(this.collapseTime > 0 ? Math.max(0.01, P.amount) : 0, P.gravity, P.bounce, P.wind);
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
			u.uSliceM.value.set(smode, sl.lift, sl.color === 'model' ? 1 : 0, 0);
			// срез рукой: плоскость среза следует за ладонью, форма проявляется по ту сторону
			const hs = this._handSlice;
			if (hs && this.camTracker?.running && this._time - (this._handsT ?? -9) < 0.4) {
				const c = { y: hs.y, x: hs.x, z: hs.z, diag: (hs.x + hs.y) * 0.707 }[sl.axis] ?? hs.y;
				u.uSlice.value.set(1, clamp((c + 1.2) / 2.4, 0, 1), Math.max(0.03, sl.width), axVal + nLines * 10);
				u.uSliceM.value.set(2, sl.lift, sl.color === 'model' ? 1 : 0, 0);
			}
			u.uSliceC.value.set(sl.color && sl.color !== 'auto' ? sl.color : pal.c[2]);

			// Look P2 & DoF
			u.uLookP2.value.set(look.sizeNoise || 0, look.sizeAudio || 0, 0, 0);
			u.uShade.value = look.shade || 0;
			const gm = GLYPH_SETS[look.glyph] ? look.glyph : 'off';
			if (gm !== this._glyphMode) {
				this._glyphMode = gm;
				if (gm !== 'off') {
					u.uAtlas.value.dispose();
					u.uAtlas.value = glyphAtlas(gm);
				}
			}
			u.uGlyph.value.set(gm === 'off' ? 0 : 1, gm === 'off' ? 1 : 2.3, u.uAtlas.value.userData?.n || 8);
			u.uDof.value.set(look.dofOn ? 1 : 0, look.dofDist || 5.2, look.dofRange || 1.4, 0);

			// курсор стоит на таймлайне: эффекты с блоками включены только там, где под курсором есть их блок
			if (!this.animPlaying && !this.animRec && (this.state.anim.clips?.length || (this.state.anim.saved && Object.keys(this.state.anim.saved).length))) this._animGate(this.animT);
			// персонаж идёт по времени таймлайна, пока таймлайн играет: дорожка «Персонаж» совпадает с тем, что видно в сцене
			{
				const A = this.app.anim;
				if (this.animPlaying && A.has) {
					if (!this._charSync) {
						this._charSync = true;
						this._charWas = A.playing;
						A.playing = false;
					}
					A.syncTime(this.animT);
				} else if (this._charSync) {
					this._charSync = false;
					A.playing = this._charWas;
				}
			}
			// персонаж с анимацией: точки идут за позой скелета
			if (!this._animCloud && this.shared.uAnimN.value) this.shared.uAnimN.value = 0;
			if (this._animCloud && st.source === 'model' && this.geometry && !this.morphing && this.app.anim.has && this._animVer !== this.app.anim.version && performance.now() - (this._animT || 0) >= (perf.tier === 'high' ? 0 : 33)) {
				this._animVer = this.app.anim.version;
				this._animT = performance.now();
				const g = this.geometry;
				const ac = this._animCloud;
				if (g.attributes.position.count === ac.count) {
					if (!this._animBuf || this._animBuf.length !== ac.count * 3) {
						this._animBuf = new Float32Array(ac.count * 3);
						this._animBufN = new Float32Array(ac.count * 3);
					}
					// нормали идут за позой вместе с точками: эффекты с направлением (толчок вдоль нормали, ветер, выдавливание) не «штырит» при повороте модели
					evalAnimPoints(ac.anim, ac.norm, this._animBuf, ac.anim.bn ? this._animBufN : null);
					// вертикальный размах формы следует за позой: эффекты по высоте (полосы, срезы, наклон) считаются от текущего роста персонажа
					{
						const b = this._animBuf;
						let mn = Infinity, mx = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
						for (let i = 1; i < b.length; i += 3) {
							if (b[i] < mn) mn = b[i];
							if (b[i] > mx) mx = b[i];
							if (b[i - 1] < x0) x0 = b[i - 1];
							if (b[i - 1] > x1) x1 = b[i - 1];
							if (b[i + 1] < z0) z0 = b[i + 1];
							if (b[i + 1] > z1) z1 = b[i + 1];
						}
						this.shared.uCen.value.set((x0 + x1) / 2, (mn + mx) / 2, (z0 + z1) / 2);
						this._yrBase = [mn, mx];
						this.shared.uYR.value.set(mn, mx);
					}
					g.attributes.aTarget.array.set(this._animBuf);
					g.attributes.aOrigin.array.set(this._animBuf);
					g.attributes.position.array.set(this._animBuf);
					g.attributes.aTarget.needsUpdate = g.attributes.aOrigin.needsUpdate = g.attributes.position.needsUpdate = true;
					if (ac.anim.bn) {
						this.shared.uAnimN.value = 1;
						g.attributes.aNormal.array.set(this._animBufN);
						g.attributes.aNormalB.array.set(this._animBufN);
						g.attributes.aNormal.needsUpdate = g.attributes.aNormalB.needsUpdate = true;
					}
					if (L.links.on && (this._alk = ((this._alk || 0) + 1) % 4) === 0) this._syncLinks();
				}
			}
			if (this._linksStale && L.links.on) this._computeLinks();
		this._trailTick(L.trail);
			// фото и видео: обновляем цвета и высоту точек по текущему кадру
			let rgbNew = null;
			if (st.source === 'media' && this.pm.ready && this.geometry && !this.morphing && this.geometry.attributes.position.count === this.pm.count) {
				const rgb = this.pm.advance(dt);
				rgbNew = rgb;
				if (rgb) {
					const g = this.geometry;
					const n = this.pm.count;
					if (!this._zbuf || this._zbuf.length !== n * 3) this._zbuf = new Float32Array(n * 3);
					const m = this.app.settings.media;
					this.pm.applyTo({ positions: this._zbuf, colors: g.attributes.aColor.array, hide: g.attributes.aHide.array }, rgb, m.relief, m.depth);
					g.attributes.aHide.needsUpdate = true;
					const a = g.attributes.position.array, o = g.attributes.aOrigin.array, t = g.attributes.aTarget.array, z = this._zbuf;
					for (let i = 2; i < n * 3; i += 3) a[i] = o[i] = t[i] = z[i];
					g.attributes.aColorB.array.set(g.attributes.aColor.array);
					g.attributes.aColor.needsUpdate = g.attributes.aColorB.needsUpdate = true;
					g.attributes.position.needsUpdate = g.attributes.aOrigin.needsUpdate = g.attributes.aTarget.needsUpdate = true;
					// нити связей держатся за точки, поэтому на каждом новом кадре видео переносим их концы
					if (L.links.on) this._syncLinks();
				}
			}
			if (st.source === 'media' && this.pm.ready && this.geometry && this.geometry.attributes.position.count === this.pm.count) this._depthTick(dt, rgbNew);
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
						// доля цикла, на которую приходится распад: поровну, дольше распад или дольше сборка
						const split = D.dir === 'out' ? 0.7 : D.dir === 'in' ? 0.3 : 0.5;
						const c = (this._disT % 2) / 2;
						const x = c < split ? c / split : 1 - (c - split) / (1 - split);
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
				// «Росток»: растворение наоборот. Ход растворения гонит фронт роста назад, поэтому форма прорастает снизу и увядает с верхушки
				const sprout = D.on && D.style === 'sprout';
				if (sprout) {
					const cyc = Math.floor((this._disT || 0) / 2);
					if (cyc !== this._dsCyc && this.geometry) {
						this._dsCyc = cyc;
						const ta = this.geometry.attributes.aTarget.array;
						const ii = Math.floor(Math.random() * (ta.length / 3)) * 3;
						u.uGrowSeed.value.set(ta[ii], ta[ii + 1], ta[ii + 2]);
					}
					u.uGrow.value.set(1 - p, { bottom: 0, point: 1, center: 2 }[D.seed] ?? 0, D.tendril, D.edge);
					u.uGrowP.value.set(D.bud, 0.5, 1, 0);
				} else u.uGrowP.value.set(0, 0, 0, 0);
				u.uDis.value.set(sprout ? 0 : p, { top: 0, noise: 1, bottom: 2, side: 3, center: 4, edges: 5 }[D.order] ?? 0, D.fall, D.wind);
				u.uDisQ.value.set(D.edge ?? 0.32, D.scatter ?? 1, D.glow ?? 0.35, D.shrink ?? 0.85);
				u.uDisT.value = D.turb;
			}
			// лепка: глина медленно возвращает форму
			if (this._sculptLive && this.geometry && !(this._grabs && this._grabs.size)) {
				const el = L.camTrack.elastic;
				// возврат глины проходит по всему массиву: делаем это раз в три кадра с поправкой на время, а не каждый кадр
				this._sculptAcc = (this._sculptAcc || 0) + dt;
				if (el > 0 && this._sculptAcc >= 0.05) {
					const arr = this.geometry.attributes.aSculpt.array;
					const k = Math.exp(-this._sculptAcc * el * 0.8);
					this._sculptAcc = 0;
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
				const mode = { orbit: 0, hole: 1, float: 2, swarm: 3, rings: 4 }[g.mode] ?? 0;
				// диск и воронка сжимают точки в тесную область: приглушаем, чтобы не выгорало
				u.uDens.value /= 1 + Math.min(1, ge) * (mode === 0 || mode === 4 ? g.flatten * 5 : mode === 1 ? 2 : mode === 3 ? 0.8 : 0);
				u.uGrav.value.set(ge, mode, g.speed, g.flatten);
				u.uGravT.value.set(g.tilt + Math.sin(this._gPrec) * 0.18 * g.precess, this._gPrec * 0.6, g.spread, g.jet);
				u.uGravP.value.set(this._gc.x, this._gc.y, this._gc.z, g.target === 'center' && !handG ? 4 : g.radius);
			}
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
					// ореол: копии чуть крупнее формы и дышат, поэтому видны, даже когда форма стоит на месте
					g.rotation.set(0, 0, 0);
					g.scale.setScalar(1 + 0.05 * k * (0.65 + 0.35 * Math.sin(this._time * 1.6 - k * 0.6)));
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
				this.hud.pickOverride = this.shared.uFr.value.x > 0.5 ? () => this._frameSample() : null;
				this.hud.follow = !!(this._animCloud && this.app.anim.has);
				this.hud.speed = T.speed ?? 1;
				this.hud.update(n, this.geometry, this.morph, this.levels, dt, tgs);
				const hex = (c) => '#' + new THREE.Color(c).getHexString(THREE.SRGBColorSpace);
				const cols = [hex(pal.c[0]), hex(pal.c[2])];
				// прозрачность рамок свой ползунок; сила на неё не влияет, кроме плавного появления и исчезновения у самого нуля (блоки таймлайна)
				if (T.on) this.hud.drawTracking(T, (T.opacity ?? 1) * Math.min(1, tr * 10), { points: this.points, camera: this.app.viewport.camera, levels: this.levels, colors: T.color && T.color !== 'auto' ? [T.color, T.color] : cols });
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
			// волна нужна только жесту ладони «волна» (камера): отдельного эффекта «Ударная волна» больше нет
			const shE = this._time - (this._waveT ?? -9) < 5 ? 0.9 : 0;
			const sh = u.uShock.value;
			for (let i = 0; i < 4; i++) {
				const s0 = this.shocks[i];
				const age = s0 ? this._time - s0.t0 : -1;
				if (s0 && age < 5) sh[i].set(s0.pos.x, s0.pos.y, s0.pos.z, age);
				else sh[i].set(0, 0, 0, -1);
			}
			u.uShockP.value.set(shE, 1.2, u.uShockP.value.z, 0);
			this.onFrame && this.onFrame(this.levels);
			this.app.viewport.invalidate();
		};
		this._raf = requestAnimationFrame(tick);
	}

	// ------------------------------------------------------------ сохранение анимации
	/** Зацикленная анимация: GIF (кадры снимаются сразу после отрисовки) или MP4 со звуком */
	async saveAnimation({ format = 'gif', seconds = 4, fps = 15, maxW = 480 }) {
		if (this.animBusy) return;
		this.animBusy = true;
		this.animProgress = { stage: 'Запись', v: 0 };
		this.emit();
		try {
			if (format === 'mp4' || format === 'webm') {
				this.startRecording();
				const t0 = performance.now();
				while (performance.now() - t0 < seconds * 1000) {
					this.animProgress = { stage: 'Запись', v: (performance.now() - t0) / (seconds * 1000) };
					this.emit();
					await new Promise((r) => setTimeout(r, 200));
				}
				this.stopRecording();
				return;
			}
			const cv = this.app.viewport.canvas;
			const W = Math.min(maxW, cv.width);
			const H = Math.round((W / cv.width) * cv.height);
			const tmp = document.createElement('canvas');
			tmp.width = W;
			tmp.height = H;
			const ctx = tmp.getContext('2d', { willReadFrequently: true });
			const bg = this.state.look.bg || '#14161b';
			const frames = [];
			const total = Math.max(2, Math.round(seconds * fps));
			let last = -1e9;
			await new Promise((resolve) => {
				const off = this.app.bus.on('rendered', () => {
					const now = performance.now();
					if (now - last < 1000 / fps - 4) return;
					last = now;
					ctx.fillStyle = bg;
					ctx.fillRect(0, 0, W, H);
					ctx.drawImage(cv, 0, 0, W, H);
					frames.push(ctx.getImageData(0, 0, W, H));
					this.animProgress = { stage: 'Запись', v: frames.length / total };
					if (frames.length >= total) {
						off && off();
						resolve();
					}
				});
			});
			this.animProgress = { stage: 'Кодирую GIF', v: 0 };
			this.emit();
			const blob = await encodeGIF(frames, W, H, Math.round(100 / fps), (v) => {
				this.animProgress = { stage: 'Кодирую GIF', v };
				this.emit();
			});
			downloadBlob(blob, 'effects.gif');
			this.app.toast(`GIF сохранён: effects.gif (${(blob.size / 1048576).toFixed(1)} МБ)`, 'ok');
		} catch (e) {
			this.app.toast('Не удалось сохранить анимацию: ' + (e.message || e), 'error');
		} finally {
			this.animBusy = false;
			this.animProgress = null;
			this.emit();
		}
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
		const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
		const ext = mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
		const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 });
		const chunks = [];
		rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		rec.onstop = () => {
			downloadBlob(new Blob(chunks, { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' }), 'effects.' + ext);
			this.app.toast(ext === 'mp4' ? 'Видео сохранено: effects.mp4' : 'Этот браузер не пишет MP4, видео сохранено как effects.webm', ext === 'mp4' ? 'ok' : 'warn');
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
