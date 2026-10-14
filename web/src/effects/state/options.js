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
export const AUDIO_DEF = { amode: 'amp', lo: 0.05, hi: 0.3, thr: 0.5, atk: 0.03, rel: 0.35 };
export const BAND_RANGE = { bass: [0, 0.3], mid: [0.3, 0.67], high: [0.67, 1] };
export const FREQ_QUICK = [['Бочка', 40, 130], ['Бас', 60, 300], ['Голос', 300, 3400], ['Тарелки', 5000, 14000]];
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
{ id: 'disp', label: 'Палитра', title: 'Градиент выбранной палитры' },
{ id: 'height', label: 'Высота', title: 'Градиент снизу вверх' },
{ id: 'index', label: 'Разброс', title: 'Случайное распределение' },
{ id: 'model', label: 'Текстура', title: 'Цвета из текстуры модели' },
{ id: 'solid', label: 'Один цвет', title: 'Сплошная заливка цветом' },
{ id: 'normal', label: 'Нормали', title: 'Цвет по вектору нормали' },
];
export const COLOR_BY_UI = COLOR_BY.filter((c) => ['disp', 'model', 'solid', 'normal'].includes(c.id));
export const MASK_MODES = [
{ id: 'none', label: 'Везде', title: 'Эффекты действуют на всю форму' },
{ id: 'height', label: 'Высота', title: 'Живёт верхняя часть, нижняя стоит' },
{ id: 'sphere', label: 'Сфера', title: 'Живёт область внутри шара' },
{ id: 'noise', label: 'Пятна', title: 'Живут плавающие пятна' },
{ id: 'scan', label: 'Скан', title: 'Живёт полоса, которая пробегает по форме' },
];
export const MORPH_STYLES = [
{ id: 'flow', name: 'Течение', icon: 'waves', hint: 'Точки перетекают из одной модели в другую плавными дугами', v: { scatter: 0.8, stagger: 0.35, turns: 1, sort: 'random', ease: 'smooth', glow: 0.4 } },
{ id: 'swirl', name: 'Вихрь', icon: 'tornado', hint: 'Модель закручивается вихрем и раскручивается уже в новую форму', v: { scatter: 0.7, stagger: 0.3, turns: 1.2, sort: 'out', ease: 'soft', glow: 0.5 } },
{ id: 'burst', name: 'Взрыв', icon: 'asterisk', hint: 'Модель взрывается на частицы, они падают на пол и лежат, потом собираются в новую модель', v: { scatter: 1.2, stagger: 0.25, turns: 1, sort: 'out', ease: 'smooth', glow: 0.7 } },
{ id: 'scan', name: 'Сканер', icon: 'scan', hint: 'Линия сканера идёт по модели сверху вниз и на ходу собирает за собой новую форму', v: { scatter: 0.12, stagger: 2.2, turns: 1, sort: 'down', ease: 'smooth', glow: 1.0 } },
{ id: 'dust', name: 'Пыль', icon: 'wind', hint: 'Старая форма поднимается облаком пыли, новая оседает из него', v: { scatter: 0.9, stagger: 0.55, turns: 1, sort: 'random', ease: 'soft', glow: 0.3 } },
{ id: 'sand', name: 'Осыпание', icon: 'drop', hint: 'Точки осыпаются вниз, как песок, и снизу вырастает новая форма', v: { scatter: 0.9, stagger: 0.5, turns: 1, sort: 'down', ease: 'smooth', glow: 0.2 } },
];
export const MORPH_SORTS = [
['random', 'Случайно: хаотичный порядок'],
['up', 'Снизу вверх: вертикальный подъём'],
['down', 'Сверху вниз: оседание точек'],
['out', 'От центра: радиальный разлёт'],
['side', 'Слева направо: боковой сдвиг'],
];
export const MORPH_EASES = [['smooth', 'Плавно'], ['soft', 'Очень мягко'], ['spring', 'С перелётом']];
export const SYNTH_STYLES = [
{ id: 'deep', name: 'Спокойный: тёплые пады и арпеджио' },
{ id: 'ambient', name: 'Эмбиент: атмосферный дрейф' },
{ id: 'jungle', name: 'Джангл: ритмичный бит 150 BPM' },
];
