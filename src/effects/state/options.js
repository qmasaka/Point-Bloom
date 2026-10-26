// Справочники режима «Эффекты»: формы, полосы звука, палитры, режимы окраски, морфинга и синтезатора.

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
	{ id: 'none', label: 'Выкл', title: 'Без реакции на звук' },
	{ id: 'bass', label: 'Бас', title: 'Низкие частоты (30–250 Гц): бочка, бас' },
	{ id: 'mid', label: 'Сред.', title: 'Средние частоты (250–4000 Гц): голос, синтезатор' },
	{ id: 'high', label: 'Верх', title: 'Высокие частоты (4–12 кГц): тарелки, шипение' },
	{ id: 'beat', label: 'Удар', title: 'Удар барабана: всплеск на каждый такт' },
	{ id: 'custom', label: 'Своя', title: 'Свой диапазон частот: выберите его на полоске спектра' },
];

/** Настройки реакции на звук, общие для всех эффектов: усиление или включение по порогу, диапазон частот, скорость нарастания и спада */
export const AUDIO_DEF = { amode: 'amp', lo: 0.05, hi: 0.3, thr: 0.5, atk: 0.03, rel: 0.35 };

/** Диапазоны готовых полос на оси спектра (0..1), как их считает движок */
export const BAND_RANGE = { bass: [0.05, 0.144], mid: [0.144, 0.574], high: [0.574, 1] };

/** Быстрые диапазоны для выбора на полоске спектра */
export const FREQ_QUICK = [['Бочка', 40, 130], ['Бас', 60, 300], ['Голос', 300, 3400], ['Тарелки', 5000, 14000]];

export const FX_PALETTES = [
	{ id: 'cyber', name: 'Неон', c: ['#00f0ff', '#ff1fcb', '#ffd90f'] },
	{ id: 'plasma', name: 'Плазма', c: ['#1a2bff', '#ff4010', '#fff2cc'] },
	{ id: 'aurora', name: 'Аврора', c: ['#00f2a0', '#6d2bff', '#2bb3ff'] },
	{ id: 'ice', name: 'Лёд', c: ['#8fe3ff', '#3f7dff', '#ffffff'] },
	{ id: 'sunset', name: 'Закат', c: ['#ff3d6e', '#ff9a3d', '#ffe29a'] },
	{ id: 'mono', name: 'Моно', c: ['#6b7482', '#c9d0da', '#ffffff'] },
];

export const COLOR_BY = [
	{ id: 'disp', label: 'Палитра', title: 'Градиент выбранной палитры' },
	{ id: 'height', label: 'Высота', title: 'Градиент снизу вверх' },
	{ id: 'index', label: 'Разброс', title: 'Случайное распределение' },
	{ id: 'model', label: 'Текстура', title: 'Цвета из текстуры модели' },
	{ id: 'solid', label: 'Один цвет', title: 'Сплошная заливка цветом' },
	{ id: 'normal', label: 'Нормали', title: 'Цвет по вектору нормали' },
];

/** Что показываем в списке: «Высота» и «Разброс» дублировали палитры, а сама палитра выбирается плашками над списком, поэтому они убраны из интерфейса */
export const COLOR_BY_UI = COLOR_BY.filter((c) => ['model', 'solid', 'normal'].includes(c.id));

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
	{ id: 'hyper', name: 'Через 4D', icon: 'intersect', hint: 'Модель выворачивается через четвёртое измерение и бесконечность, на изнанке подменяется новой и возвращается уже ею. Больше одного оборота: путь по расслоению Хопфа', v: { scatter: 1, stagger: 0.3, turns: 1, sort: 'out', ease: 'smooth', glow: 0.6 } },
	{ id: 'sphere', name: 'Через сферу', icon: 'sphere', hint: 'Форма стягивается в шар, шар перетекает и раскрывается уже новой формой', v: { scatter: 1, stagger: 0.25, turns: 1, sort: 'out', ease: 'soft', glow: 0.5 } },
	{ id: 'cubes', name: 'Кубики', icon: 'cube', hint: 'Форма распадается на блоки, блоки подпрыгивают и уходят по очереди, каждый в свой момент', v: { scatter: 0.6, stagger: 1.2, turns: 1, sort: 'random', ease: 'smooth', glow: 0.3 } },
	{ id: 'flat', name: 'Сплющивание', icon: 'flip-horizontal', hint: 'Форма схлопывается в плоскость, плоскость перетекает в новую и расправляется', v: { scatter: 0.5, stagger: 0.15, turns: 1, sort: 'random', ease: 'smooth', glow: 0.4 } },
	{ id: 'relief', name: 'Рельеф (нейросеть)', icon: 'mountains', hint: 'Для видео и фото: кадр вспухает объёмом по карте глубины от нейросети, слои отслаиваются от ближних к дальним', v: { scatter: 0.9, stagger: 0.8, turns: 1, sort: 'depthnear', ease: 'soft', glow: 0.5 } },
	{ id: 'print', hidden: true, name: '3D-печать', icon: 'stack', hint: 'Старая форма стекает в печатающую головку, новая печатается слой за слоем снизу вверх', v: { scatter: 0.5, stagger: 2.4, turns: 1, sort: 'up', ease: 'smooth', glow: 0.9 } },
	{ id: 'portal', name: 'Портал', icon: 'circle', hint: 'Точки по спирали затягивает в светящееся кольцо, и из него же выходит новая форма', v: { scatter: 0.8, stagger: 0.5, turns: 1, sort: 'out', ease: 'soft', glow: 1.0 } },
	{ id: 'shatter', hidden: true, name: 'Стекло', icon: 'polygon', hint: 'Форма трескается на осколки, они кувыркаются и падают, потом осколки новой формы складываются в неё', v: { scatter: 0.8, stagger: 0.6, turns: 1, sort: 'random', ease: 'smooth', glow: 0.4 } },
	{ id: 'magnet', name: 'Магнит', icon: 'magnet', hint: 'Точки идут пучками по дугам силовых линий, как железные опилки', v: { scatter: 0.9, stagger: 0.4, turns: 1, sort: 'random', ease: 'soft', glow: 0.5 } },
];

export const MORPH_SORTS = [
	['random', 'Случайно: хаотичный порядок'],
	['up', 'Снизу вверх: вертикальный подъём'],
	['down', 'Сверху вниз: оседание точек'],
	['out', 'От центра: радиальный разлёт'],
	['side', 'Слева направо: боковой сдвиг'],
	['depthnear', 'Ближние первыми: по карте глубины (видео и фото)'],
	['depthfar', 'Дальние первыми: по карте глубины (видео и фото)'],
];

export const MORPH_EASES = [['smooth', 'Плавно'], ['soft', 'Очень мягко'], ['spring', 'С перелётом']];

export const SYNTH_STYLES = [
	{ id: 'deep', name: 'Спокойный: тёплые пады и арпеджио' },
	{ id: 'ambient', name: 'Эмбиент: атмосферный дрейф' },
	{ id: 'jungle', name: 'Джангл: ритмичный бит 150 BPM' },
];
