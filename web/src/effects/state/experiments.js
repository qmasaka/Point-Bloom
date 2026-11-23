const range = (key, label, min = 0, max = 1, step = 0.01, unit = '') => ({
key, label, min, max, step, ...(unit && { unit, noNorm: true, int: step === 1, digits: step === 1 ? 0 : step < 0.1 ? 2 : 1 }),
});
const seg = (key, label, options) => ({ type: 'seg', key, label, options });
const action = (label, act) => ({ type: 'button', label, act, icon: 'arrow-counter-clockwise' });
const experiment = (id, name, icon, hint, def, extras) => ({
id, name, icon, hint, group: 'Эксперименты', max: 1, def: { on: false, amount: 1, band: 'none', react: 0.65, ...def }, extras,
});
export const EXPERIMENT_LAYERS = [
experiment('autophagy', 'Голод', 'aperture', 'Складки сцепляются и разъедают соседние участки. Поворот камеры меняет ход роста.', {
style: 'fold', pull: 0.6, erosion: 0.6, speed: 1, memory: 2.5, ink: 0.3,
}, [
seg('style', 'Вид', [['fold', 'Складки'], ['vortex', 'Воронка'], ['erode', 'Эрозия']]),
range('speed', 'Скорость роста', 0.25, 2.5, 0.05, ' ×'), range('pull', 'Сцепление'), range('erosion', 'Разъедание'), range('memory', 'Память кадра', 0.2, 8, 0.1, ' с'),
action('Очистить обратную связь', 'resetAutophagy'),
]),
experiment('reactionSkin', 'Химия', 'atom', 'Колонии узора растут по поверхности. Щёлкните по модели, чтобы посеять новую.', {
style: 'spots', growth: 0.6, colony: 1.3, scale: 1, speed: 1, ink: 0.8, trigger: 'manual',
}, [
seg('style', 'Узор', [['spots', 'Пятна'], ['maze', 'Лабиринт'], ['branches', 'Жилки']]),
range('speed', 'Скорость роста', 0.25, 2.5, 0.05, ' ×'), range('colony', 'Размер колонии', 0.2, 2.4, 0.05, ' м'), range('scale', 'Размер узора', 0.5, 2, 0.05, ' ×'),
range('growth', 'Рельеф'), range('ink', 'Красители'),
seg('trigger', 'Новая колония', [['manual', 'По щелчку'], ['beat', 'По биту']]),
action('Начать заново', 'resetReactionSkin'),
]),
experiment('impossible', 'Ракурс', 'cube-focus', 'Назначьте фото углам камеры. Крутите сцену или включите вращение формы: виды сменяют друг друга по кругу.', {
blend: 0.7, arc: 0.72,
}, [
{ type: 'photos' },
range('blend', 'Плавность ракурсов'), range('arc', 'Дуга перехода', 0, 1.6, 0.01, ' ×'),
]),
{ ...experiment('causalWounds', 'Шрамы', 'spiral', '', { radius: 0.28, depth: 0.75, healing: 7, memory: 1.8, layers: 4, spacing: 0.15, roughness: 0.55, ink: 0.85, spread: 0.7 }, []), hidden: true },
{ ...experiment('phaseInterference', 'Фаза', 'waves', '', {}, []), hidden: true },
{ ...experiment('recursiveAnatomy', 'Фрактал', 'circles-four', '', { layout: 'surface', levels: 3, scale: 0.31, density: 0.82, copies: 10, spread: 1.12, rotation: 28, detail: 0.45, ink: 0.35, revealAt: 4.5 }, []), hidden: true },
];
export const EXPERIMENT_IDS = EXPERIMENT_LAYERS.filter((layer) => !layer.hidden).map((layer) => layer.id);
