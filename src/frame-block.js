// Экспериментальный режим «Раскадровка»: видео раскладывается на кадры, а кадры собираются в блок из точек.
// Каждый кадр это плоский лист из точек, его цвета берутся из соответствующего момента видео. Листы расставляются по-разному:
// стопкой (ось времени уходит вглубь), стеной, каруселью, спиралью или веером.

const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
	const c = i / 255;
	LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export const FRAME_LAYOUTS = [
	['stack', 'Стопка: время уходит вглубь'],
	['wall', 'Стена кадров'],
	['carousel', 'Карусель'],
	['spiral', 'Спираль'],
	['fan', 'Веер'],
];

/** Размер сетки одного кадра по числу точек в кадре и пропорциям видео */
export function frameGrid(density, aspect) {
	const cols = Math.max(8, Math.round(Math.sqrt(density * aspect)));
	const rows = Math.max(8, Math.round(cols / aspect));
	return { cols, rows };
}

/** Положение точки листа в кадре k из n. u, v в -0.5..0.5: местные координаты листа (ширина и высота в единицах сцены) */
function place(layout, k, n, u, v, W, H, depth, out) {
	const t = n > 1 ? k / (n - 1) : 0.5;
	let x = 0, y = 0, z = 0;
	let nx = 0, ny = 0, nz = 1;
	if (layout === 'wall') {
		const gx = Math.ceil(Math.sqrt(n * (W / H)));
		const gy = Math.ceil(n / gx);
		const s = Math.min(2.4 / (gx * W), 2.4 / (gy * H));
		const cx = k % gx, cy = Math.floor(k / gx);
		x = (cx - (gx - 1) / 2) * W * s * 1.04 + u * W * s;
		y = ((gy - 1) / 2 - cy) * H * s * 1.04 + v * H * s;
	} else if (layout === 'carousel' || layout === 'spiral') {
		const a = (k / n) * Math.PI * 2;
		const R = 0.9 + depth * 0.45;
		const s = layout === 'spiral' ? 0.5 : 0.6;
		const lx = u * W * s, ly = v * H * s;
		x = Math.sin(a) * R + Math.cos(a) * lx;
		z = Math.cos(a) * R - Math.sin(a) * lx;
		y = ly + (layout === 'spiral' ? (t - 0.5) * depth * 1.4 : 0);
		nx = Math.sin(a);
		nz = Math.cos(a);
	} else if (layout === 'fan') {
		const a = (t - 0.5) * Math.min(Math.PI * 1.2, 0.35 * depth + 0.5);
		const lx = (u + 0.5) * W * 0.9;
		x = -W * 0.45 + Math.cos(a) * lx;
		z = Math.sin(a) * lx;
		y = v * H * 0.9;
		nx = -Math.sin(a);
		nz = Math.cos(a);
	} else {
		x = u * W;
		y = v * H;
		z = (t - 0.5) * depth;
	}
	out[0] = x; out[1] = y; out[2] = z; out[3] = nx; out[4] = ny; out[5] = nz;
}

/** Облако точек из кадров: frames это массив Uint8Array RGB размера cols*rows */
export function buildFrameBlock(frames, cols, rows, aspect, layout = 'stack', depth = 1.6) {
	const n = frames.length;
	const per = cols * rows;
	const count = per * n;
	const positions = new Float32Array(count * 3);
	const normals = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const W = aspect >= 1 ? 2.2 : 2.2 * aspect;
	const H = W / aspect;
	const tmp = new Float32Array(6);
	let o = 0;
	for (let k = 0; k < n; k++) {
		const f = frames[k];
		for (let j = 0; j < rows; j++) {
			for (let i = 0; i < cols; i++) {
				const u = (i + 0.5) / cols - 0.5;
				const v = 0.5 - (j + 0.5) / rows;
				place(layout, k, n, u, v, W, H, depth, tmp);
				positions[o * 3] = tmp[0];
				positions[o * 3 + 1] = tmp[1];
				positions[o * 3 + 2] = tmp[2];
				normals[o * 3] = tmp[3];
				normals[o * 3 + 1] = tmp[4];
				normals[o * 3 + 2] = tmp[5];
				const p = (j * cols + i) * 3;
				colors[o * 3] = LUT[f[p]];
				colors[o * 3 + 1] = LUT[f[p + 1]];
				colors[o * 3 + 2] = LUT[f[p + 2]];
				o++;
			}
		}
	}
	return { positions, normals, colors, count };
}

/** Один кадр целиком в массив цветов блока: offset это номер первой точки кадра, w это яркость */
export function writeOneFrame(frame, perFrame, target, firstPoint, w, tint = 0, rgb = null) {
	let o = firstPoint * 3;
	if (!tint || !rgb) {
		for (let p = 0; p < perFrame * 3; p += 3) {
			target[o++] = LUT[frame[p]] * w;
			target[o++] = LUT[frame[p + 1]] * w;
			target[o++] = LUT[frame[p + 2]] * w;
		}
		return;
	}
	// подкраска кадра цветом луча или шлейфа: цвет кадра смешивается с заданным, яркость сохраняется
	const k = 1 - tint;
	for (let p = 0; p < perFrame * 3; p += 3) {
		const r = LUT[frame[p]], g = LUT[frame[p + 1]], b = LUT[frame[p + 2]];
		const l = 0.3 * r + 0.59 * g + 0.11 * b;
		target[o++] = (r * k + rgb[0] * (0.35 + l * 1.6) * tint) * w;
		target[o++] = (g * k + rgb[1] * (0.35 + l * 1.6) * tint) * w;
		target[o++] = (b * k + rgb[2] * (0.35 + l * 1.6) * tint) * w;
	}
}

/** Записывает цвета кадров в уже построенный блок (когда меняются только кадры, а не раскладка) */
export function writeFrameColors(frames, cols, rows, target, weights = null) {
	const per = cols * rows;
	let o = 0;
	for (let k = 0; k < frames.length; k++) {
		const f = frames[k];
		const w = weights ? weights[k] : 1;
		for (let p = 0; p < per * 3; p += 3) {
			target[o++] = LUT[f[p]] * w;
			target[o++] = LUT[f[p + 1]] * w;
			target[o++] = LUT[f[p + 2]] * w;
		}
	}
}
