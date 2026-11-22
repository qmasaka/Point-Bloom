const range = (key, label, min = 0, max = 1, step = 0.01, unit = ' ×') => ({
key, label, min, max, step, unit, noNorm: true, int: step === 1, digits: step === 1 ? 0 : step < 0.1 ? 2 : 1,
});
const seg = (key, label, options) => ({ type: 'seg', key, label, options });
const only = (control, key, ...values) => ({ ...control, when: [key, values] });
const group = (label) => ({ type: 'title', label, open: false });
const note = (text) => ({ type: 'note', text });
const action = (label, act) => ({ type: 'button', label, act, icon: 'arrow-counter-clockwise' });
const experiment = (id, name, icon, hint, def, extras) => ({
id, name, icon, hint, group: 'Эксперименты', max: 1, def: { on: false, amount: 1, band: 'none', react: 0.65, ...def }, extras,
});
const timers = [['manual', 'Вручную'], ['timer', 'По таймеру'], ['beat', 'По биту']];
const source = seg('source', 'Источник формы', [['playlist', 'Из морфинга'], ['builtin', 'Встроенная']]);
export const EXPERIMENT_LAYERS = [
experiment('autophagy', 'Голод', 'aperture', 'Прошлый кадр меняет геометрию облака. Поверните камеру, чтобы изменить рост.', {
style: 'fold', feedback: 0.7, pull: 0.6, edge: 0.75, memory: 2.5, chaos: 0.32, sample: 4, speed: 1, limit: 0.8, ink: 0.25, repeat: 'live', period: 4,
}, [
seg('style', 'Вид', [['fold', 'Складки'], ['vortex', 'Воронка'], ['erode', 'Эрозия']]),
range('feedback', 'Сила обратной связи'), range('pull', 'Самопритяжение'), range('edge', 'Рост на контурах'),
group('Отпечаток кадра'),
range('sample', 'Охват контура', 1, 8, 1, ' px'), range('limit', 'Предел деформации', 0.1, 1.5, 0.05, ' м'), range('ink', 'Свет на складках'),
group('Движение'),
range('speed', 'Скорость роста', 0.25, 2.5, 0.05), range('memory', 'Память кадра', 0.2, 8, 0.1, ' с'), range('chaos', 'Хаос'),
seg('repeat', 'Повтор', [['live', 'Непрерывно'], ['pulse', 'Волнами']]),
only(range('period', 'Период повтора', 1, 12, 0.1, ' с'), 'repeat', 'pulse'),
action('Очистить обратную связь', 'resetAutophagy'),
]),
experiment('reactionSkin', 'Химия', 'atom', 'Вещества обмениваются между соседними участками облака. Щёлкните по форме, чтобы посеять реакцию.', {
style: 'spots', feed: 55, kill: 61, diffusion: 1, balance: 0.46, growth: 0.55, radius: 0.22, mutation: 0.45, speed: 1, relief: 'out', ink: 0.75, trigger: 'manual', period: 3, seed: 0.65,
}, [
seg('style', 'Узор', [['spots', 'Пятна'], ['maze', 'Лабиринт'], ['branches', 'Ветви']]),
range('speed', 'Скорость реакции', 0.25, 2.5, 0.05), range('growth', 'Рост рельефа'),
group('Состав'),
range('feed', 'Подача', 18, 80, 1, ' ‰'), range('kill', 'Распад вещества', 40, 75, 1, ' ‰'),
range('diffusion', 'Диффузия', 0.2, 1.3, 0.05), range('balance', 'Диффузия вещества Б', 0.22, 0.75, 0.01),
group('Рельеф и свет'),
seg('relief', 'Направление рельефа', [['out', 'Наружу'], ['in', 'Внутрь'], ['both', 'В обе стороны']]),
range('mutation', 'Мутация'), range('ink', 'Яркость прожилок'),
group('Посев'),
seg('trigger', 'Запуск', timers), range('radius', 'Радиус посева', 0.06, 0.6, 0.01, ' м'), range('seed', 'Сила посева', 0.1, 1, 0.01),
only(range('period', 'Период повтора', 0.4, 10, 0.1, ' с'), 'trigger', 'timer'),
action('Перезапустить реакцию', 'resetReactionSkin'),
]),
experiment('impossible', 'Ракурс', 'cube-focus', 'Форма меняется при обходе вокруг неё и возвращается при том же ракурсе.', {
motion: 'camera', source: 'playlist', style: 'twist', angle: 0, blend: 0.7, axis: 'yaw', speed: 0.25, views: 3, arc: 0.72, tint: 1, separation: 0,
}, [
seg('motion', 'Движение', [['camera', 'Камера'], ['orbit', 'Обход'], ['swing', 'Качание']]), source,
range('views', 'Число ракурсов', 2, 3, 1, ''), range('blend', 'Плавность ракурсов'),
group('Переход'),
range('angle', 'Первый ракурс', -180, 180, 1, '°'),
only(seg('axis', 'Ось наблюдения', [['yaw', 'Горизонталь'], ['pitch', 'Вертикаль']]), 'motion', 'camera'),
only(range('speed', 'Обороты в секунду', -0.75, 0.75, 0.01, ' об/с'), 'motion', 'orbit', 'swing'),
range('arc', 'Дуга перехода', 0, 1.6, 0.01), range('separation', 'Разнос ракурсов', 0, 0.85, 0.01, ' м'),
group('Формы и цвет'),
seg('style', 'Встроенный вид', [['twist', 'Виток'], ['pleats', 'Складки'], ['prism', 'Грани']]),
only(range('tint', 'Цвет другой формы'), 'source', 'playlist'),
only(note('Первые две другие формы из списка морфинга становятся боковыми видами. Без них работают встроенные деформации.'), 'source', 'playlist'),
]),
experiment('causalWounds', 'Шрамы', 'spiral', 'Проведите по облаку с зажатой левой кнопкой, чтобы поднять слои его прошлых состояний.', {
style: 'ribbons', trigger: 'manual', radius: 0.28, depth: 0.75, healing: 7, spread: 0.7, memory: 1.8, layers: 4, spacing: 0.15, roughness: 0.55, ink: 0.85, period: 2.4,
}, [
seg('style', 'Вид', [['ribbons', 'Ленты'], ['crack', 'Трещины'], ['peel', 'Срезы']]),
range('radius', 'Радиус раны', 0.06, 0.7, 0.01, ' м'), range('depth', 'Глубина раны'), range('healing', 'Заживление', 1, 20, 0.5, ' с'),
group('Слои и память'),
range('layers', 'Число слоёв', 1, 6, 1, ''), range('memory', 'Память слоёв', 0.6, 3.6, 0.1, ' с'), range('spacing', 'Зазор слоёв', 0.04, 0.28, 0.01, ' м'),
group('Трещины и свет'),
range('spread', 'Рост трещин'), range('roughness', 'Неровность края'), range('ink', 'Яркость кромки'),
group('Запуск'),
seg('trigger', 'Повтор', timers), only(range('period', 'Период повтора', 0.4, 8, 0.1, ' с'), 'trigger', 'timer'),
action('Заживить все раны', 'resetCausalWounds'),
]),
experiment('phaseInterference', 'Фаза', 'waves', 'Часть точек видна в одной форме, часть в другой. Камера и музыка перемещают границу.', {
style: 'bands', motion: 'flow', source: 'playlist', freq: 5, speed: 0.8, bias: 0.5, angle: 0, camera: 1, jump: 55, spacing: 0, rim: 0.7, width: 0.16, tint: 0.76,
}, [
seg('style', 'Узор', [['bands', 'Полосы'], ['rings', 'Кольца'], ['spots', 'Пятна']]), source,
range('freq', 'Частота узора', 1, 14, 1), range('bias', 'Доля второй формы', 0, 1),
group('Движение'),
seg('motion', 'Ход фазы', [['flow', 'Поток'], ['swing', 'Качание'], ['beat', 'По биту']]),
only(range('speed', 'Скорость фазы', -3, 3, 0.1), 'motion', 'flow', 'swing'),
only(range('jump', 'Шаг за удар', 5, 180, 1, '°'), 'motion', 'beat'),
range('angle', 'Поворот узора', -180, 180, 1, '°'), range('camera', 'Влияние камеры'),
group('Разделение форм'),
range('spacing', 'Зазор между формами', 0, 1.1, 0.01, ' м'), range('width', 'Ширина границы', 0.02, 0.45, 0.01),
range('rim', 'Яркость границы'), range('tint', 'Цвет второй формы'),
only(note('Вторая форма берётся из списка морфинга. Без неё используется отражённый двойник.'), 'source', 'playlist'),
]),
experiment('recursiveAnatomy', 'Фрактал', 'circles-four', 'При приближении облако раскрывается в уменьшенные версии самого себя.', {
layout: 'surface', motion: 'zoom', levels: 3, scale: 0.31, density: 0.82, copies: 10, spread: 1.12, rotation: 28, detail: 0.45, ink: 0.35, revealAt: 4.5, speed: 0.35,
}, [
seg('layout', 'Раскладка копий', [['surface', 'По форме'], ['ring', 'Кольцо'], ['spiral', 'Спираль']]),
range('levels', 'Уровни вложенности', 1, 3, 1, ''), range('copies', 'Число копий', 3, 12, 1, ''), range('scale', 'Масштаб копии', 0.16, 0.46, 0.01),
group('Положение и вид'),
range('density', 'Доля точек в копиях'), range('spread', 'Разлёт копий', 0.45, 1.85, 0.01), range('rotation', 'Разворот копий', 0, 120, 1, '°'),
range('detail', 'Размер мелких точек'), range('ink', 'Различие уровней'),
group('Появление копий'),
seg('motion', 'Раскрытие', [['zoom', 'При зуме'], ['breathe', 'Дыхание'], ['fixed', 'Постоянно']]),
only(range('revealAt', 'Расстояние раскрытия', 2, 10, 0.1, ' м'), 'motion', 'zoom'),
only(range('speed', 'Ритм дыхания', 0.05, 1.5, 0.05, ' Гц'), 'motion', 'breathe'),
]),
];
export const EXPERIMENT_IDS = EXPERIMENT_LAYERS.map((layer) => layer.id);
