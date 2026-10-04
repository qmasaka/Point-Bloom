/**
 * Движок эффектов для облака точек. Идея взята из TouchDesigner (POP): цепочка независимых «операторов»
 * (шум, спектр, волны, скручивание, пульс, воксели, дрожь, курсор), каждый из которых можно включить,
 * настроить и привязать к полосе звука (бас, середина, верх, бит). Вся геометрия считается на видеокарте.
 */
import * as THREE from 'three';
import { loadJSON, saveJSON, mergeDeep, downloadBlob, clamp } from './util.js';
import { TrackerHud } from './fx-hud.js';

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
	{ id: 'spectrum', group: 'Движение', name: 'Спектр', icon: 'equalizer', hint: 'Форма вытягивается по частотам трека', max: 2, def: { on: false, amount: 0.9, band: 'none', react: 0, axis: 'angle' }, extras: [{ key: 'axis', label: 'Ось', type: 'seg', options: [['angle', 'По кругу'], ['height', 'По высоте']] }] },
	{ id: 'wave', group: 'Движение', name: 'Волны', icon: 'waves', hint: 'Круги расходятся от центра', max: 2, def: { on: false, amount: 0.7, band: 'mid', react: 0.8, freq: 5 }, extras: [{ key: 'freq', label: 'Частота', min: 1, max: 14, step: 0.5 }] },
	{ id: 'twist', group: 'Движение', name: 'Скручивание', icon: 'wind', hint: 'Форма закручивается вокруг вертикали', max: 3, def: { on: false, amount: 1, band: 'none', react: 0 }, extras: [] },
	{ id: 'pulse', group: 'Движение', name: 'Пульс', icon: 'pulse', hint: 'Форма раздувается на каждый удар', max: 2, def: { on: true, amount: 0.8, band: 'beat', react: 1 }, extras: [] },
	{ id: 'voxel', group: 'Движение', name: 'Воксели', icon: 'squares-four', hint: 'Точки прилипают к кубической сетке', max: 1, def: { on: false, amount: 0.6, band: 'beat', react: 1 }, extras: [] },
	{ id: 'jitter', group: 'Движение', name: 'Дрожь', icon: 'waveform', hint: 'Мелкая вибрация на высоких частотах', max: 2, def: { on: false, amount: 0.7, band: 'high', react: 1 }, extras: [] },
	{ id: 'glitch', group: 'Движение', name: 'Глитч', icon: 'lightning', hint: 'Полосы формы рывками сдвигаются в сторону', max: 2, def: { on: false, amount: 0.8, band: 'beat', react: 1, slices: 16 }, extras: [{ key: 'slices', label: 'Число полос', min: 6, max: 40, step: 1 }] },
	{ id: 'cursor', group: 'Движение', name: 'Курсор', icon: 'cursor-click', hint: 'Мышь отталкивает или притягивает точки', max: 2, def: { on: true, amount: 1, band: 'none', react: 0, radius: 0.9, mode: 'repel' }, extras: [{ key: 'radius', label: 'Радиус', min: 0.3, max: 2, step: 0.05 }, { key: 'mode', label: 'Действие', type: 'seg', options: [['repel', 'Отталкивать'], ['attract', 'Притягивать']] }] },
	{ id: 'links', group: 'Графика', name: 'Связи', icon: 'share-network', hint: 'Линии между соседними точками, как созвездия', max: 1.5, def: { on: false, amount: 0.8, band: 'beat', react: 0.5, range: 0.18, count: 3000 }, extras: [{ key: 'range', label: 'Длина связей', min: 0.05, max: 0.5, step: 0.01 }, { key: 'count', label: 'Узлов', min: 500, max: 8000, step: 250, relink: true, int: true }] },
	{ id: 'tracking', group: 'Графика', name: 'Трекинг', icon: 'bounding-box', hint: 'Рамки с цифрами на «пойманных» областях', max: 1.5, def: { on: false, amount: 1, band: 'bass', react: 0.4, count: 8, size: 70, labels: 'on', lines: 'on' }, extras: [{ key: 'count', label: 'Рамок', min: 2, max: 24, step: 1, int: true }, { key: 'size', label: 'Размер рамки', min: 30, max: 160, step: 5, int: true }, { key: 'labels', label: 'Подписи', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }, { key: 'lines', label: 'Связи рамок', type: 'seg', options: [['on', 'Есть'], ['off', 'Нет']] }] },
	{ id: 'echo', group: 'Графика', name: 'Шлейф', icon: 'ghost', hint: 'Призрачные копии формы с задержкой', max: 1.5, def: { on: false, amount: 0.7, band: 'none', react: 0, delay: 0.18 }, extras: [{ key: 'delay', label: 'Задержка, с', min: 0.05, max: 0.6, step: 0.01 }] },
	{ id: 'slice', group: 'Графика', name: 'Срез', icon: 'scan', hint: 'Яркая плоскость пробегает по форме', max: 2, def: { on: false, amount: 1, band: 'none', react: 0, speed: 0.5, width: 0.12, axis: 'y' }, extras: [{ key: 'speed', label: 'Скорость', min: 0.1, max: 2, step: 0.05 }, { key: 'width', label: 'Толщина', min: 0.03, max: 0.4, step: 0.01 }, { key: 'axis', label: 'Ось', type: 'seg', options: [['y', 'Y'], ['x', 'X'], ['z', 'Z']] }] },
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
		look: { palette: 'brand', colorBy: 'disp', size: 3.5, glow: 0.8, bright: 1, blend: 'add', autoRotate: true, rotSpeed: 0.25 },
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
uniform vec4 uCurl, uSpec, uWave, uTwist, uPulse, uVoxel, uJitter, uCursor, uMask, uMaskA, uGlitch;
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

	// срез: яркая плоскость пробегает по форме
	float sl = 0.0;
	if (uSlice.x > 0.001) {
		float c = uSlice.w < 0.5 ? base.y : (uSlice.w < 1.5 ? base.x : base.z);
		float lo = uSlice.w < 0.5 ? uYR.x : -1.2;
		float hi = uSlice.w < 0.5 ? uYR.y : 1.2;
		float v = clamp((c - lo) / max(hi - lo, 1e-4), 0.0, 1.0);
		sl = (1.0 - smoothstep(uSlice.z * 0.4, uSlice.z, abs(v - uSlice.y))) * uSlice.x;
		vColor += uP2 * sl * 1.6;
	}
	vD = disp;
	vec4 mv = modelViewMatrix * vec4(pos, 1.0);
	gl_Position = projectionMatrix * mv;
	float s = uSize * uPR * (1.0 + disp * 0.5 + uBeat * 0.2 + sl * 1.2);
	s *= 3.8 / max(-mv.z, 0.4);
	gl_PointSize = clamp(s, 1.0, 80.0);
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
void main() {
	vec2 c = gl_PointCoord - 0.5;
	float r2 = dot(c, c);
	if (r2 > 0.25) discard;
	float core = 1.0 - smoothstep(0.0, 0.25, r2);
	if (uAdd > 0.5) {
		float aura = pow(core, mix(1.8, 0.7, uGlow));
		vec3 col = (vColor * (0.08 + aura * (0.2 + uGlow * 0.28)) + vColor * vD * 0.08) * uDens * uGhost;
		gl_FragColor = vec4(col, core * uGhost);
	} else {
		gl_FragColor = vec4(vColor * (0.55 + 0.45 * core), 1.0);
	}
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

// Связи: каждая линия соединяет две точки облака, обе двигаются теми же эффектами, что и точки
const lineVert = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aTarget;
attribute float aIdx;
attribute vec3 aOriginB;
attribute vec3 aTargetB;
attribute float aIdxB;
attribute float aEnd;
uniform vec3 uP0;
uniform vec3 uP2;
uniform float uBright;
uniform vec4 uLink;
varying vec3 vC;
varying float vA;
` + common + `
void main() {
	vec3 bA, bB;
	float mA, mB;
	vec3 pA = fxDisplace(aOrigin, aTarget, aIdx, bA, mA);
	vec3 pB = fxDisplace(aOriginB, aTargetB, aIdxB, bB, mB);
	float len = distance(pA, pB);
	vA = uLink.x * (1.0 - smoothstep(uLink.y * 0.8, uLink.y * 1.9, len));
	vC = mix(uP0, uP2, 0.35 + uBeat * 0.4) * uBright;
	vec3 pos = mix(pA, pB, aEnd);
	gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const lineFrag = /* glsl */ `
precision highp float;
varying vec3 vC;
varying float vA;
void main() {
	gl_FragColor = vec4(vC * vA, vA);
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



// ───────────────────────────────────────────────────────────── движок

export class EffectsEngine {
	constructor(app) {
		this.app = app;
		this.active = false;
		this.state = mergeDeep(defaultState(), loadJSON(KEY, {}));
		for (const l of FX_LAYERS) this.state.layers[l.id] = { ...l.def, ...this.state.layers[l.id] };

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
		this.onFrame = null;
		this._ray = new THREE.Raycaster();
		this._plane = new THREE.Plane();
		this._move = (e) => this._onMove(e);
		this._leave = () => (this.mouseOn = false);
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
			uGlitch: U(new THREE.Vector4()), uSlice: U(new THREE.Vector4()), uLink: U(new THREE.Vector4()),
			uMask: U(new THREE.Vector4()), uMaskA: U(new THREE.Vector4()), uMaskShow: U(0),
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
		// шлейф: две призрачные копии с задержкой по времени, делят геометрию с основной
		this.ghosts = [1, 2].map((k) => {
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
		const lm = new THREE.ShaderMaterial({ vertexShader: lineVert, fragmentShader: lineFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...shared, uTOff: U(0) } });
		this.linkObj = new THREE.LineSegments(lg, lm);
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
		const A = new Float32Array(L * 2 * 3), TA = new Float32Array(L * 2 * 3), B = new Float32Array(L * 2 * 3), TB = new Float32Array(L * 2 * 3);
		const ia = new Float32Array(L * 2), ib = new Float32Array(L * 2), end = new Float32Array(L * 2);
		for (let l = 0; l < L; l++) {
			const a = ids[pairs[l * 2]], b = ids[pairs[l * 2 + 1]];
			for (let v = 0; v < 2; v++) {
				const o = (l * 2 + v) * 3;
				for (let c = 0; c < 3; c++) {
					A[o + c] = O[a * 3 + c];
					TA[o + c] = T[a * 3 + c];
					B[o + c] = O[b * 3 + c];
					TB[o + c] = T[b * 3 + c];
				}
				ia[l * 2 + v] = a / N;
				ib[l * 2 + v] = b / N;
				end[l * 2 + v] = v;
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
				for (let v = 0; v < 2; v++) {
					const o = (l * 2 + v) * 3;
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
		this._offScene = app.bus.on('scene', () => this._onScene());
		this.hud = new TrackerHud(document.getElementById('viewport'));
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
		const vp = this.app.viewport;
		this._disposePoints();
		vp.root.visible = this._saved?.rootVisible !== false;
		vp.fxHide = false;
		const stage = document.querySelector('.stage');
		stage.removeEventListener('pointermove', this._move);
		stage.removeEventListener('pointerleave', this._leave);
		document.getElementById('app').classList.remove('fx-mode');
		this.app.display.apply();
		this.app.nav.frameAll(true);
		vp.invalidate();
		this.emit();
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
			const sl = L.slice;
			u.uSlice.value.set(this._eff(sl), (this._time * sl.speed * 0.25) % 1, sl.width, { y: 0, x: 1, z: 2 }[sl.axis] ?? 0);
			// связи
			const lk = this._eff(L.links);
			if (this.linkObj) {
				this.linkObj.visible = lk > 0.01;
				u.uLink.value.set(lk * 0.8, L.links.range * (1 + this.levels.beat * 0.4), 0, 0);
			}
			// шлейф
			const ec = this._eff(L.echo);
			this.ghosts.forEach((g, i) => {
				g.visible = ec > 0.01;
				g.material.uniforms.uTOff.value = L.echo.delay * (i + 1);
				g.material.uniforms.uGhost.value = (ec * 0.7) / (i + 1);
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
			// трекинг-рамки
			if (this.hud) {
				const tr = this._eff(L.tracking);
				this.hud.draw(L.tracking, tr, { points: this.points, geometry: this.geometry, camera: this.app.viewport.camera, morph: this.morph, levels: this.levels, colors: ['#' + new THREE.Color(pal.c[0]).getHexString(THREE.SRGBColorSpace), '#' + new THREE.Color(pal.c[2]).getHexString(THREE.SRGBColorSpace)], dt });
			}
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
