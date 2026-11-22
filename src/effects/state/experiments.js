const range = (key, label, min = 0, max = 1, step = 0.01, unit = ' ×') => ({
	key, label, min, max, step, unit, noNorm: true, int: step === 1, digits: step === 1 ? 0 : step < 0.1 ? 2 : 1,
});
const note = (text) => ({ type: 'note', text });
const action = (label, act, icon = 'arrow-counter-clockwise') => ({ type: 'button', label, act, icon });
const experiment = (id, name, icon, hint, def, extras) => ({
	id, name, icon, hint, group: 'Эксперименты', staticIcon: true, sound: false, max: 1, def: { on: false, amount: 1, ...def }, extras,
});

export const EXPERIMENT_LAYERS = [
	experiment('autophagy', 'Автофагия', 'aperture', 'Прошлый кадр меняет геометрию облака. Поверните камеру, чтобы изменить рост.', { feedback: 0.7, pull: 0.6, edge: 0.75, memory: 2.5, chaos: 0.32 }, [
		range('feedback', 'Сила обратной связи'), range('pull', 'Самопритяжение'), range('edge', 'Рост на контурах'),
		range('memory', 'Память кадра', 0.2, 8, 0.1, ' с'), range('chaos', 'Хаос'),
		action('Очистить обратную связь', 'resetAutophagy'),
	]),
	experiment('reactionSkin', 'Реактивная кожа', 'atom', 'Вещества обмениваются между соседними участками облака. Щёлкните по форме, чтобы посеять реакцию.', { feed: 55, kill: 61, diffusion: 1, growth: 0.55, radius: 0.22, mutation: 0.45 }, [
		range('feed', 'Подача', 18, 80, 1, ' ‰'), range('kill', 'Распад вещества', 40, 75, 1, ' ‰'),
		range('diffusion', 'Диффузия', 0.2, 1.3, 0.05), range('growth', 'Рост рельефа'), range('radius', 'Радиус посева', 0.06, 0.6, 0.01, ' м'), range('mutation', 'Мутация'),
		action('Перезапустить реакцию', 'resetReactionSkin'),
	]),
	experiment('impossible', 'Невозможная скульптура', 'cube-focus', 'Форма меняется при обходе вокруг неё и возвращается при том же ракурсе.', { angle: 0, blend: 0.7 }, [
		range('angle', 'Первый ракурс', -180, 180, 1, '°'), range('blend', 'Плавность ракурсов'),
		note('Первые две другие формы из списка морфинга становятся боковыми видами. Без них работают встроенные деформации.'),
	]),
	experiment('causalWounds', 'Раны во времени', 'spiral', 'Проведите по облаку с зажатой левой кнопкой, чтобы поднять слои его прошлых состояний.', { radius: 0.28, depth: 0.75, healing: 7, spread: 0.7 }, [
		range('radius', 'Радиус раны', 0.06, 0.7, 0.01, ' м'), range('depth', 'Глубина раны'), range('healing', 'Заживление', 1, 20, 0.5, ' с'), range('spread', 'Рост трещин'),
		action('Заживить все раны', 'resetCausalWounds'),
	]),
	experiment('phaseInterference', 'Фазовая интерференция', 'waves', 'Часть точек видна в одной форме, часть в другой. Камера и музыка перемещают границу.', { freq: 5, speed: 0.8, audio: 0.8, bias: 0.5 }, [
		range('freq', 'Частота полос', 1, 14, 1), range('speed', 'Скорость фазы', 0, 3, 0.1), range('audio', 'Влияние музыки'), range('bias', 'Доля второй формы', 0, 1),
		note('Вторая форма берётся из списка морфинга. Без неё используется отражённый двойник.'),
	]),
	experiment('recursiveAnatomy', 'Рекурсивная анатомия', 'circles-four', 'При приближении облако раскрывается в уменьшенные версии самого себя.', { levels: 3, scale: 0.31, density: 0.82 }, [
		range('levels', 'Уровни вложенности', 1, 3, 1, ''), range('scale', 'Масштаб копии', 0.16, 0.46, 0.01), range('density', 'Доля точек в копиях'),
	]),
];
