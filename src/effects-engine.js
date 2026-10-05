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

/** Слои-операторы. group: раздел в левой панели; extras: дополнительные параметры; relink: пересобрать связи */
export const FX_LAYERS = [
	{ id: 'curl', group: 'Движение', name: 'Вихри', icon: 'tornado', hint: 'Частицы отрываются и плывут по вихрям', max: 2, def: { on: true, amount: 0.8, band: 'bass', react: 0.6, scale: 1.8 }, extras: [{ key: 'scale', label: 'Размер вихрей', min: 0.5, max: 4, step: 0.1 }] },
	{ id: 'physics', group: 'Движение', name: 'Распад', icon: 'atom', hint: 'Форма рассыпается на частицы с физикой пола, отскоками и ветром', max: 2, def: { on: false, amount: 1.0, band: 'bass', react: 0.5, gravity: 1.2, bounce: 0.65, wind: 0.4 }, extras: [{ key: 'gravity', label: 'Гравитация', min: 0.2, max: 3.0, step: 0.1 }, { key: 'bounce', label: 'Упругость пола', min: 0.1, max: 0.95, step: 0.05 }, { key: 'wind', label: 'Ветер', min: 0.0, max: 2.0, step: 0.1 }] },
	{ id: 'spectrum', group: 'Движение', name: 'Спектр', icon: 'equalizer', hint: 'Форма вытягивается по частотам трека', max: 2, def: { on: false, amount: 0.9, band: 'none', react: 0, axis: 'angle' }, extras: [{ key: 'axis', label: 'Ось', type: 'seg', options: [['angle', 'По кругу'], ['height', 'По высоте']] }] },
	{ id: 'wave', group: 'Движение', name: 'Волны', icon: 'waves', hint: 'Круги расходятся от центра', max: 2, def: { on: false, amount: 0.7, band: 'mid', react: 0.8, freq: 5 }, extras: [{ key: 'freq', label: 'Частота', min: 1, max: 14, step: 0.5 }] },
	{ id: 'twist', group: 'Движение', name: 'Скручивание', icon: 'wind', hint: 'Форма закручивается вокруг вертикали', max: 3, def: { on: false, amount: 1, band: 'none', react: 0 }, extras: [] },
	{ id: 'pulse', group: 'Движение', name: 'Пульс', icon: 'pulse', hint: 'Форма раздувается на каждый удар', max: 2, def: { on: true, amount: 0.8, band: 'beat', react: 1 }, extras: [] },
	{ id: 'alive', group: 'Движение', name: 'Живая форма', icon: 'heartbeat', hint: 'Форма дышит, у неё бьётся сердце, и она с любопытством тянется к курсору', max: 1.5, def: { on: false, amount: 1, band: 'none', react: 0, breath: 0.6, heart: 0.7, bpm: 62, lean: 0.8 }, extras: [{ key: 'breath', label: 'Дыхание', min: 0.2, max: 2, step: 0.05 }, { key: 'heart', label: 'Сердцебиение', min: 0, max: 1.5, step: 0.05 }, { key: 'bpm', label: 'Пульс, уд/мин', min: 40, max: 140, step: 1, int: true }, { key: 'lean', label: 'Тянется к курсору', min: 0, max: 1.5, step: 0.05 }] },
	{ id: 'voxel', group: 'Движение', name: 'Воксели', icon: 'squares-four', hint: 'Точки прилипают к кубической сетке', max: 1, def: { on: false, amount: 0.6, band: 'beat', react: 1 }, extras: [] },
	{ id: 'jitter', group: 'Движение', name: 'Дрожь', icon: 'waveform', hint: 'Мелкая вибрация на высоких частотах', max: 2, def: { on: false, amount: 0.7, band: 'high', react: 1 }, extras: [] },
	{ id: 'glitch', group: 'Движение', name: 'Глитч', icon: 'lightning', hint: 'Полосы формы рывками сдвигаются в сторону', max: 2, def: { on: false, amount: 0.8, band: 'beat', react: 1, slices: 16 }, extras: [{ key: 'slices', label: 'Число полос', min: 6, max: 40, step: 1 }] },
	{ id: 'links', group: 'Графика', name: 'Связи', icon: 'share-network', hint: 'Светящиеся нити между соседними точками с бегущими импульсами', max: 2, def: { on: false, amount: 1, band: 'beat', react: 0.5, range: 0.2, width: 1.8, count: 3500, pulses: 'on', pulseSpeed: 1.6 }, extras: [{ key: 'width', label: 'Толщина нитей', min: 0.6, max: 6, step: 0.2, unit: ' px' }, { key: 'range', label: 'Длина связей', min: 0.05, max: 0.5, step: 0.01 }, { key: 'count', label: 'Узлов', min: 500, max: 8000, step: 250, relink: true, int: true }, { key: 'pulses', label: 'Импульсы света', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'pulseSpeed', label: 'Скорость импульсов', min: 0.5, max: 4.0, step: 0.2 }] },
	{ id: 'slice', group: 'Графика', name: 'Срез / Изолинии', icon: 'scan', hint: 'Топографические лазерные срезы бегут по форме', max: 2, def: { on: false, amount: 1, band: 'none', react: 0, speed: 0.5, width: 0.08, count: 4, axis: 'y' }, extras: [{ key: 'count', label: 'Число линий', min: 1, max: 12, step: 1, int: true }, { key: 'speed', label: 'Скорость', min: 0.1, max: 2, step: 0.05 }, { key: 'width', label: 'Толщина', min: 0.02, max: 0.3, step: 0.01 }, { key: 'axis', label: 'Ось', type: 'seg', options: [['y', 'Y'], ['x', 'X'], ['z', 'Z'], ['diag', 'Диаг.']] }] },
	{ id: 'feedback', group: 'Графика', name: 'Feedback-след', icon: 'spiral', hint: 'Настоящий видео-след (Feedback TOP) с затуханием, зумом и вращением', max: 1.5, def: { on: false, amount: 0.92, band: 'none', react: 0, zoom: 1.004, twist: 0.002 }, extras: [{ key: 'zoom', label: 'Зум туннеля', min: 0.98, max: 1.03, step: 0.002 }, { key: 'twist', label: 'Спираль (угол)', min: -0.02, max: 0.02, step: 0.001 }] },
	{ id: 'echo', group: 'Графика', name: 'Шлейф', icon: 'ghost', hint: 'Призрачные копии формы: тянутся следом, закручиваются спиралью или раскладываются зеркальным веером', max: 1.5, def: { on: false, amount: 0.8, band: 'beat', react: 0.5, mode: 'spiral', copies: 4, delay: 0.14, spread: 0.45, fade: 0.7 }, extras: [{ key: 'mode', label: 'Вид', type: 'seg', options: [['spiral', 'Спираль'], ['kaleido', 'Зеркала'], ['time', 'След']] }, { key: 'copies', label: 'Копий', min: 1, max: 5, step: 1, int: true }, { key: 'spread', label: 'Угол между копиями', min: 0.05, max: 1.5, step: 0.05 }, { key: 'delay', label: 'Задержка, с', min: 0.02, max: 0.6, step: 0.01 }, { key: 'fade', label: 'Затухание копий', min: 0.3, max: 0.95, step: 0.05 }] },
	{ id: 'tracking', group: 'Взаимодействие', name: 'Трекинг', icon: 'bounding-box', hint: 'Рамки захватывают подвижные участки формы и по желанию прикасаются к ней: подъём, вихрь или втягивание', max: 1.5, def: { on: false, amount: 1, band: 'bass', react: 0.4, count: 8, size: 70, shape: 'corners', color: 'auto', thick: 1.5, labels: 'on', lines: 'on', touch: 'bump', force: 1, radius: 0.35, memory: 1.5 }, extras: [{ key: 'count', label: 'Рамок', min: 2, max: 16, step: 1, int: true }, { key: 'size', label: 'Размер рамки', min: 30, max: 160, step: 5, int: true }, { key: 'shape', label: 'Форма', type: 'seg', options: [['corners', 'Углы'], ['box', 'Рамка'], ['circle', 'Круг'], ['cross', 'Прицел']] }, { key: 'color', label: 'Цвет', type: 'color' }, { key: 'thick', label: 'Толщина линий', min: 0.5, max: 4, step: 0.25 }, { key: 'labels', label: 'Подписи', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'lines', label: 'Связи рамок', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { type: 'title', label: 'Касание формы' }, { key: 'touch', label: 'Действие', type: 'seg', options: [['none', 'Нет'], ['bump', 'Подъём'], ['swirl', 'Вихрь'], ['pull', 'Втяг.']] }, { key: 'force', label: 'Сила касания', min: 0.2, max: 2, step: 0.05 }, { key: 'radius', label: 'Радиус касания', min: 0.1, max: 0.9, step: 0.01 }, { key: 'memory', label: 'Память следа, с', min: 0, max: 6, step: 0.1 }] },
	{ id: 'telemetry', group: 'Графика', name: 'Телеметрия', icon: 'speedometer', hint: 'Шкалы бас, середина, верх и столбики спектра поверх сцены', max: 1.5, def: { on: false, amount: 1, band: 'none', react: 0, audioWave: 'on' }, extras: [{ key: 'audioWave', label: 'Спектр внизу', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }] },
	{ id: 'cursor', group: 'Взаимодействие', name: 'Курсор', icon: 'cursor-click', hint: 'Мышь отталкивает или притягивает точки', max: 2, def: { on: true, amount: 1, band: 'none', react: 0, radius: 0.9, mode: 'repel' }, extras: [{ key: 'radius', label: 'Радиус', min: 0.3, max: 2, step: 0.05 }, { key: 'mode', label: 'Действие', type: 'seg', options: [['repel', 'Отталкивать'], ['attract', 'Притягивать']] }] },
	{ id: 'brush', group: 'Взаимодействие', name: 'Кисть', icon: 'paint-brush', hint: 'Рисование курсором по форме: частицы в мазках светятся и оживают, затем след высыхает', max: 2, def: { on: false, amount: 1.0, band: 'none', react: 0, radius: 0.4, dry: 3.5 }, extras: [{ key: 'radius', label: 'Радиус кисти', min: 0.1, max: 0.9, step: 0.02 }, { key: 'dry', label: 'Высыхание, с', min: 1.0, max: 8.0, step: 0.5 }] },
	{ id: 'shock', group: 'Взаимодействие', name: 'Ударная волна', icon: 'aperture', hint: 'Клик по сцене пускает круговую волну по форме', max: 2, def: { on: false, amount: 1, band: 'none', react: 0, speed: 1.2, auto: 'off' }, extras: [{ key: 'speed', label: 'Скорость волны', min: 0.4, max: 3, step: 0.05 }, { key: 'auto', label: 'Запуск', type: 'seg', options: [['off', 'Клик'], ['on', 'Клик и авто']] }] },
	{ id: 'camTrack', group: 'Взаимодействие', name: 'Руки (камера)', icon: 'hand', hint: 'Камера видит руки и пальцы: ладонь отталкивает форму, щипок притягивает, кулак тянет. Двумя руками форму можно растягивать', max: 1.5, def: { on: false, amount: 1.0, band: 'none', react: 0, mode: 'gesture', radius: 0.4, smooth: 0.5, sens: 0.6, pinch: 'rotate', stretch: 'on', trail: 'off', skeleton: 'on', preview: 'on' }, extras: [{ key: 'mode', label: 'Действие пальцев', type: 'seg', options: [['gesture', 'По жесту'], ['push', 'Толкать'], ['pull', 'Тянуть'], ['swirl', 'Вихрь']] }, { key: 'radius', label: 'Радиус пальцев', min: 0.15, max: 0.9, step: 0.05 }, { key: 'smooth', label: 'Плавность', min: 0, max: 0.95, step: 0.05 }, { key: 'sens', label: 'Чувствительность', min: 0.1, max: 1, step: 0.05 }, { type: 'title', label: 'Жесты' }, { key: 'pinch', label: 'Щипок (большой + указательный)', type: 'seg', options: [['rotate', 'Вращать'], ['wave', 'Волна'], ['none', 'Нет']] }, { key: 'stretch', label: 'Две руки', type: 'seg', options: [['on', 'Растягивают'], ['off', 'Нет']] }, { key: 'trail', label: 'След от пальцев', type: 'seg', options: [['off', 'Нет'], ['on', 'Светится']] }, { type: 'title', label: 'Показ' }, { key: 'skeleton', label: 'Руки на сцене', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'preview', label: 'Окно камеры', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }] },
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
	{ id: 'model', label: 'Модель', title: 'Цвета из текстуры модели' },
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
		mask: { mode: 'none', size: 0.5, soft: 0.4, speed: 0.5, invert: false, show: false },
		look: {
			bg: '',
			vignette: true,
			palette: 'brand',
			colorBy: 'disp',
			size: 3.5,
			glow: 0.8,
			bright: 1,
			blend: 'add',
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

const KEY = 'objglb.fx.v2';

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
	} else {
		pos -= normalize(dd + vec3(1e-4)) * k * 0.3;
	}
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
			float r = uMask.y * 1.6 + 0.15;
			maskV = 1.0 - smoothstep(r * (1.0 - soft), r, distance(base, uMaskA.xyz));
		} else if (uMask.x < 3.5) {
			float n = snoise(base * 1.6 + vec3(0.0, uMaskA.w, uMaskA.w * 0.6)) * 0.5 + 0.5;
			maskV = smoothstep(1.0 - uMask.y - soft * 0.3, 1.0 - uMask.y + soft * 0.3, n);
		} else {
			float w = uMask.y * 0.35 + 0.03;
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
	// Распад / Физика (гравитация, отскок от пола, ветер)
	if (uPhysics.x > 0.001) {
		float seed = hash11(aIdx * 1234.56 + 17.1);
		float seed2 = hash11(aIdx * 2345.67 + 39.3);
		float seed3 = hash11(aIdx * 3456.78 + 81.7);
		vec3 v0 = normalize(base + vec3(seed - 0.5, seed2 - 0.5, seed3 - 0.5) * 1.2) * (0.8 + seed * 1.5);
		float pt = max(0.0, uCollapseTime - seed * 0.35);
		float floorY = -1.25;
		vec3 pPhys = base;
		pPhys.x += (v0.x * 0.7 + uPhysics.w * 0.9) * pt + sin(pt * 2.5 + seed * 6.28) * 0.12;
		pPhys.z += v0.z * 0.7 * pt + cos(pt * 2.2 + seed2 * 6.28) * 0.12;

		float g = uPhysics.y * 3.8;
		float vy0 = max(0.3, v0.y * 1.9);
		float tBounce = max(0.15, 2.0 * vy0 / g * (1.0 - uPhysics.z * 0.25));
		float bCount = floor(pt / tBounce);
		float damp = pow(clamp(uPhysics.z, 0.1, 0.95), bCount);
		float remT = mod(pt, tBounce);
		float curVy = vy0 * damp;
		float curY = floorY + max(0.0, curVy * remT - 0.5 * g * remT * remT);
		pPhys.y = mix(base.y - 0.5 * g * pt * pt, curY, clamp(pt * 2.0, 0.0, 1.0));
		if (pPhys.y < floorY) pPhys.y = floorY + abs(sin(pt * 4.0 + seed * 3.0)) * 0.015;

		pos = mix(pos, pPhys, smoothstep(0.0, 1.0, uPhysics.x));
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
				if (uHandP.z > 0.5) {
					float a = f * abs(hs) * uHandP.x * 2.6;
					float ca = cos(a);
					float sa = sin(a);
					vec2 q = pos.xz - uHand[i].xz;
					pos.xz = uHand[i].xz + vec2(q.x * ca - q.y * sa, q.x * sa + q.y * ca);
					pos.y += f * abs(hs) * uHandP.x * 0.12;
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
uniform float uSize;
uniform float uPR;
uniform float uColorBy;
uniform float uBright;
uniform float uMaskShow;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform vec4 uSlice;
varying vec3 vColor;
varying float vD;
varying float vCoc;
` + common + `
void main() {
	vec3 base;
	float maskV;
	vec3 pos = fxDisplace(aOrigin, aTarget, aIdx, base, maskV);
	float t = uTime - uTOff;
	float disp = clamp(length(pos - base) * 1.5, 0.0, 1.0);
	float k;
	if (uColorBy < 0.5) k = clamp(disp + uBeat * 0.12, 0.0, 1.0);
	else if (uColorBy < 1.5) k = clamp((pos.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	else k = fract(aIdx * 3.0 + t * 0.03);
	vec3 col = k < 0.5 ? mix(uP0, uP1, k * 2.0) : mix(uP1, uP2, (k - 0.5) * 2.0);
	if (uColorBy > 2.5) col = aColor;
	vColor = col * uBright * (1.0 + uBeat * 0.3);
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
			if (hdst < uHandP.y) hg = max(hg, (1.0 - hdst / uHandP.y) * abs(uHand[i].w));
		}
		vColor += uP2 * hg * hg * 1.6 * uHandP.x;
	}

	// Срез / Изолинии: яркие лазерные срезы пробегают по форме
	float sl = 0.0;
	if (uSlice.x > 0.001) {
		float axCode = mod(uSlice.w, 10.0);
		float nLines = floor(uSlice.w / 10.0);
		if (nLines < 1.0) nLines = 1.0;
		float c = axCode < 0.5 ? base.y : (axCode < 1.5 ? base.x : (axCode < 2.5 ? base.z : (base.x + base.y) * 0.707));
		float lo = -1.2;
		float hi = 1.2;
		float v = clamp((c - lo) / max(hi - lo, 1e-4), 0.0, 1.0);
		float coord = mod(v * nLines - uSlice.y * nLines, 1.0);
		sl = (1.0 - smoothstep(uSlice.z * 0.4, uSlice.z, abs(coord - 0.5))) * uSlice.x;
		vColor += uP2 * sl * 2.2;
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
	s *= max(0.15, szNoise * szAudio);
	s *= (1.0 + coc * 2.4);
	s *= 3.8 / max(-mv.z, 0.4);
	gl_PointSize = clamp(s, 1.0, 95.0);
}
`;

const frag = /* glsl */ `
precision highp float;
uniform float uGlow;
uniform float uAdd;
uniform float uDens;
uniform float uGhost;
varying vec3 vColor;
varying float vD;
varying float vCoc;
void main() {
	vec2 c = gl_PointCoord - 0.5;
	float r2 = dot(c, c);
	if (r2 > 0.25) discard;
	float core = 1.0 - smoothstep(0.0, 0.25, r2);
	if (vCoc > 0.01) {
		float bokeh = 1.0 - smoothstep(0.16, 0.25, r2);
		core = mix(core, bokeh, vCoc * 0.8);
	}
	float dofAlpha = 1.0 / (1.0 + vCoc * 1.8);
	if (uAdd > 0.5) {
		float aura = pow(core, mix(1.8, 0.7, uGlow));
		vec3 col = (vColor * (0.08 + aura * (0.2 + uGlow * 0.28)) + vColor * vD * 0.08) * uDens * uGhost * dofAlpha;
		gl_FragColor = vec4(col, core * uGhost * dofAlpha);
	} else {
		gl_FragColor = vec4(vColor * (0.55 + 0.45 * core), dofAlpha);
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
			const decay = feedbackCfg.amount || 0.92;

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
		this.collapseTime = 0;
		this.brushHits = [];
		this.post = null;
		this.camTracker = null;
		this._pointerDown = false;
	}

	toggleCollapse() {
		this.isCollapsed = !this.isCollapsed;
		this.state.layers.physics.on = true;
		this.emit();
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
		this._handPtrs = [{ local: loc.clone(), s: cfg.mode === 'pull' ? -1 : 1, ndc: [this._camPos.x, this._camPos.y] }];
		if (cfg.trail === 'on' || this.state.layers.brush.on) this.addBrushHit(loc);
		if (cfg.pinch === 'wave' && f.energy > 0.16 && this._time - (this._camShockT || 0) > 0.8) {
			this._camShockT = this._time;
			this.addShock(loc);
			this._waveT = this._time;
		}
	}

	_onHands(f, cfg) {
		const hands = f.hands;
		this._hands = hands;
		this._camActive = hands.length > 0;
		const txt = hands.length ? (hands.length > 1 ? 'Вижу две руки: можно растягивать форму' : 'Вижу руку: двигайте пальцами') : 'Покажите ладонь перед камерой';
		if (this.camHint && this.camHint.textContent !== txt) this.camHint.textContent = txt;
		const ptrs = [];
		const aspect = f.aspect || 4 / 3;
		for (const hd of hands) {
			// «по жесту»: открытая ладонь толкает, кулак и щипок притягивают
			let s = cfg.mode === 'push' ? 1 : cfg.mode === 'pull' ? -1 : cfg.mode === 'swirl' ? 1 : Math.max(-1, Math.min(1, (hd.open - 0.45) * 2.2));
			if (cfg.mode === 'gesture' && hd.pinch > 0.6) s = -1;
			const list = [...hd.tips, hd.palm];
			for (let i = 0; i < list.length; i++) {
				const p = list[i];
				const nx = p[0] * 2 - 1;
				const ny = -(p[1] * 2 - 1);
				const loc = this._ndcToLocal(nx, ny, new THREE.Vector3(), 0.85);
				if (loc) ptrs.push({ local: loc, s: i === 5 ? s * 0.8 : s, ndc: [nx, ny], tip: i < 5 });
			}
			const idx = hd.tips[1];
			const ix = this._ndcToLocal(idx[0] * 2 - 1, -(idx[1] * 2 - 1), new THREE.Vector3(), 0.85);
			const st = this._handState || (this._handState = new Map());
			const prev = st.get(hd.id) || { palmX: hd.palm[0], pinch: 0 };
			if (ix) {
				if (hands[0] === hd) {
					this.mouse.copy(ix);
					this.mouseOn = true;
					this._camT = this._time;
				}
				if (cfg.trail === 'on' || this.state.layers.brush.on) for (const tp of hd.tips) {
					const q = this._ndcToLocal(tp[0] * 2 - 1, -(tp[1] * 2 - 1), new THREE.Vector3(), 0.85);
					if (q) this.addBrushHit(q);
				}
				if (cfg.pinch === 'wave' && hd.pinch > 0.8 && prev.pinch <= 0.8 && this._time - (this._camShockT || 0) > 0.5) {
					this._camShockT = this._time;
					this.addShock(ix);
					this._waveT = this._time;
				}
			}
			if (cfg.pinch === 'rotate' && hd.pinch > 0.7 && prev.pinch > 0.5) this.points.rotation.y += (hd.palm[0] - prev.palmX) * 6.5;
			st.set(hd.id, { palmX: hd.palm[0], pinch: hd.pinch });
		}
		for (const key of [...(this._handState?.keys() || [])]) if (!hands.some((h) => h.id === key)) this._handState.delete(key);
		this._stretchTarget = 1;
		if (cfg.stretch === 'on' && hands.length === 2) {
			const d = Math.hypot((hands[0].palm[0] - hands[1].palm[0]) * aspect, hands[0].palm[1] - hands[1].palm[1]);
			this._stretchTarget = clamp(0.45 + d * 2.3, 0.6, 2.4);
		}
		this._handPtrs = ptrs;
		if (hands.length) this._handsT = this._time;
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
		const n = this._n();
		const ck = key + ':' + n;
		if (this.cache.has(ck)) return this.cache.get(ck);
		let c;
		if (key === 'model') {
			c = this.modelProvider ? await this.modelProvider.get(n) : null;
			if (!c) return null;
			c = normalizeCloud(c);
		} else {
			c = generateShapePoints(key, n);
		}
		this.cache.set(ck, c);
		return c;
	}

	async _build() {
		const st = this.state;
		if (st.source === 'model' && !this.hasModel) st.source = 'sphere';
		const c = await this._cloudFor(st.source);
		const count = c.count;
		const g = new THREE.BufferGeometry();
		const idx = new Float32Array(count);
		for (let i = 0; i < count; i++) idx[i] = i / count;
		const model = st.source === 'model' ? c : this.hasModel ? (await this._cloudFor('model').catch(() => null)) || c : c;
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
		g.setAttribute('aOrigin', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
		g.setAttribute('aTarget', new THREE.BufferAttribute(new Float32Array(c.positions), 3));
		g.setAttribute('aNormal', new THREE.BufferAttribute(new Float32Array(c.normals), 3));
		g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(model.colors.length === c.colors.length ? model.colors : c.colors), 3));
		g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
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
			uGlitch: U(new THREE.Vector4()), uSlice: U(new THREE.Vector4()), uLink: U(new THREE.Vector4()), uContact: U(new THREE.Vector4()), uShockP: U(new THREE.Vector4()),
			uTrk: U(Array.from({ length: 16 }, () => new THREE.Vector4())), uImp: U(Array.from({ length: 32 }, () => new THREE.Vector4())), uShock: U(Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, -1))),
			uMask: U(new THREE.Vector4()), uMaskA: U(new THREE.Vector4()), uMaskShow: U(0),
			uPhysics: U(new THREE.Vector4()), uCollapseTime: U(0),
			uBrushHits: U(Array.from({ length: 20 }, () => new THREE.Vector4(0, 0, 0, -1))), uBrushParam: U(new THREE.Vector4()),
			uLookP2: U(new THREE.Vector4()), uDof: U(new THREE.Vector4()),
			uAlive: U(new THREE.Vector4()), uHand: U(Array.from({ length: 12 }, () => new THREE.Vector4())), uHandP: U(new THREE.Vector4()), uRes: U(new THREE.Vector2(1, 1)), uLinkW: U(1.8),
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
		if (key === 'model' && !this.hasModel) {
			this.app.toast('Нет модели: добавьте её кнопкой «Добавить модель» или откройте в редакторе', 'info');
			return;
		}
		st.source = key;
		this.touch();
		if (!this.active || !this.geometry) return this.emit();
		const target = await this._cloudFor(key);
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
		o.needsUpdate = t.needsUpdate = true;
		this.cloudKey = key;
		this.morph = 0;
		this.morphing = true;
		this._computeLinks();
		this.emit();
	}

	async setCount(n) {
		this.state.count = n;
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
		if (!this.active) return;
		clearTimeout(this._sceneT);
		this._sceneT = setTimeout(async () => {
			if (!this.active) return;
			this.cache.clear();
			if (this.hasModel) this.state.source = 'model';
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
		this._lastT = performance.now();
		this._loop();
		this.emit();
		this.play().catch(() => this.emit());
	}

	exit() {
		if (!this.active) return;
		this.active = false;
		this.stopRecording();
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
			this._time += dt;
			this._analyse(dt);
			if (!this.material) return;
			if (this.morphing) {
				this.morph = Math.min(1, this.morph + dt / 1.6);
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
			u.uSize.value = look.size;
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
					const sPx = Math.min(95, (look.size * pr * 3.8) / d);
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

			// Распад / Физика
			const physOn = L.physics ? L.physics.on : false;
			if (this.isCollapsed && physOn) {
				this.collapseProgress = Math.min(1, this.collapseProgress + dt * 0.75);
				this.collapseTime += dt;
			} else {
				this.collapseProgress = Math.max(0, this.collapseProgress - dt * 1.25);
				if (this.collapseProgress <= 0.001) this.collapseTime = 0;
			}
			const physEff = L.physics ? this._eff(L.physics) * this.collapseProgress : 0;
			u.uPhysics.value.set(physEff, L.physics ? L.physics.gravity : 1.2, L.physics ? L.physics.bounce : 0.65, L.physics ? L.physics.wind : 0.4);
			u.uCollapseTime.value = this.collapseTime;

			// Кисть
			const brE = Math.max(L.brush ? this._eff(L.brush) : 0, this.camTracker?.running && L.camTrack.trail === 'on' ? 1 : 0);
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
			u.uSlice.value.set(this._eff(sl), (this._time * sl.speed * 0.25) % 1, sl.width, axVal + nLines * 10);

			// Look P2 & DoF
			u.uLookP2.value.set(look.sizeNoise || 0, look.sizeAudio || 0, 0, 0);
			u.uDof.value.set(look.dofOn ? 1 : 0, look.dofDist || 5.2, look.dofRange || 1.4, 0);

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
				const he = running && cfg.on ? cfg.amount : 0;
				u.uHandP.value.set(fade > 0 ? he : 0, cfg.radius, cfg.mode === 'swirl' ? 1 : 0, n);
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
				const touchMode = { bump: 0, swirl: 1, pull: 2 }[T.touch];
				const ct = touchMode === undefined ? 0 : tr * T.force;
				const n = tr > 0.001 ? Math.min(16, Math.round(T.count)) : 0;
				this.hud.update(n, this.geometry, this.morph, this.levels, dt);
				const hex = (c) => '#' + new THREE.Color(c).getHexString(THREE.SRGBColorSpace);
				const cols = [hex(pal.c[0]), hex(pal.c[2])];
				if (T.on) this.hud.drawTracking(T, tr, { points: this.points, camera: this.app.viewport.camera, levels: this.levels, colors: T.color && T.color !== 'auto' ? [T.color, T.color] : cols });
				if (L.telemetry && L.telemetry.on) this.hud.drawTelemetry(L.telemetry, this._eff(L.telemetry), { levels: this.levels, spec: this.spec, colors: cols });
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
					if (it && i < n && ct > 0) arr[i].set(it.pos.x, it.pos.y, it.pos.z, it.touch);
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
				u.uContact.value.set(ct, T.radius, touchMode ?? 0, ct > 0 ? n : 0);
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
