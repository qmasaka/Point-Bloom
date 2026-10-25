// Подготовка облака точек: порядок, число точек, нормализация, сортировка по Мортону.

/** Растягивает или прореживает облако до ровно n точек */
/** Переставляет данные анимации точек (кость, вес, положение в позе привязки) вслед за перестановкой самих точек: src[i] это номер исходной точки */
export function reorderAnim(a, src) {
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

export function fitCount(c, n) {
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
export function normalizeCloud(c) {
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
 * Перемешивает порядок точек. У двух моделей i-я точка оказывается
 * в случайном месте формы, поэтому при морфинге модель собирается вперемешку по всей поверхности, а не квадратами-участками,
 * которые давала сортировка по кривой Мортона.
 */
export function shuffleCloud(c) {
	const n = c.count;
	const src = new Int32Array(n);
	for (let i = 0; i < n; i++) src[i] = i;
	// своё зерно у каждого облака: при одинаковом зерне две модели перемешались бы одинаково и снова совпали бы по участкам
	let s = (Math.random() * 4294967295) >>> 0 || 0x9e3779b9;
	const rnd = () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) / 4294967296;
	};
	for (let i = n - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		const t = src[i];
		src[i] = src[j];
		src[j] = t;
	}
	const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) {
		const j = src[i];
		for (let k = 0; k < 3; k++) {
			pos[i * 3 + k] = c.positions[j * 3 + k];
			nor[i * 3 + k] = c.normals[j * 3 + k];
			col[i * 3 + k] = c.colors[j * 3 + k] ?? 1;
		}
	}
	return { positions: pos, normals: nor, colors: col, count: n, anim: reorderAnim(c.anim, src), norm: c.norm, animBox: c.animBox };
}

/**
 * Упорядочивает точки облака вдоль кривой Мортона по его собственным габаритам. У двух моделей i-я точка оказывается
 * примерно в «том же месте» формы, поэтому при морфинге точки идут к ближайшим родственным местам, а не разлетаются
 * через всю сцену, и переход выглядит как перетекание, а не как перемешивание.
 */
export function mortonSort(c) {
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
