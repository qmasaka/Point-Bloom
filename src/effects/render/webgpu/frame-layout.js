// Раскладка значений в uniform-буфере WebGPU.
// Список полей генерируется вместе с шейдерами (dev/gen-wgsl.mjs → shaders/wgsl/generated/*), поэтому структура в WGSL и упаковка байтов не могут разойтись.
import { FRAME_SPEC } from '../../shaders/wgsl/generated/frame-spec.js';

// сколько байт занимает поле в структуре WGSL: скаляры и короткие векторы растянуты до 16 байт, матрицы и массивы как есть
const sizeOf = (type, len) => (len ? 16 * len : type === 'mat4x4f' ? 64 : type === 'mat3x3f' ? 48 : 16);
const COUNT = { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 };

/** Строит раскладку по списку [имя, тип WGSL, длина массива] */
export function makeLayout(spec) {
	let o = 0;
	const fields = spec.map(([name, type, len]) => {
		const f = { name, type, len, offset: o };
		o += sizeOf(type, len);
		return f;
	});
	return { fields, bytes: o };
}

function writeVec(out, o, v, n) {
	if (v === undefined || v === null) return;
	if (typeof v === 'number') {
		out[o] = v;
	} else if (typeof v === 'boolean') {
		out[o] = v ? 1 : 0;
	} else if (v.isColor) {
		out[o] = v.r;
		out[o + 1] = v.g;
		out[o + 2] = v.b;
	} else if (v.isMatrix3) {
		// матрица 3x3 в WGSL занимает три колонки по 16 байт
		for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[o + c * 4 + r] = v.elements[c * 3 + r];
	} else if (v.elements) {
		for (let i = 0; i < 16; i++) out[o + i] = v.elements[i];
	} else if (ArrayBuffer.isView(v) || Array.isArray(v)) {
		for (let i = 0; i < Math.min(n, v.length); i++) out[o + i] = v[i];
	} else {
		out[o] = v.x;
		if (n > 1) out[o + 1] = v.y;
		if (n > 2) out[o + 2] = v.z;
		if (n > 3) out[o + 3] = v.w;
	}
}

/**
 * Упаковывает значения в Float32Array по раскладке.
 * @param {{fields: object[], bytes: number}} layout результат makeLayout
 * @param {object} shared значения вида { имя: { value } } (value число, вектор или цвет three.js)
 * @param {object} extra значения «как есть» ({ имя: число | вектор | массив }); они важнее shared
 * @param {Float32Array} [out] куда писать
 */
export function packLayout(layout, shared, extra, out = new Float32Array(layout.bytes / 4)) {
	for (const f of layout.fields) {
		const o = f.offset / 4;
		const v = f.name in extra ? extra[f.name] : shared && shared[f.name] && shared[f.name].value;
		if (f.len) {
			if (!v) continue;
			for (let i = 0; i < f.len; i++) writeVec(out, o + i * 4, v[i], 4);
		} else if (f.type === 'mat4x4f') {
			writeVec(out, o, v, 16);
		} else if (f.type === 'mat3x3f') {
			writeVec(out, o, v, 9);
		} else writeVec(out, o, v, COUNT[f.type]);
	}
	return out;
}

// ---- значения кадра точек
export const FRAME_LAYOUT_FULL = makeLayout(FRAME_SPEC);
/** Поля с их смещениями в байтах */
export const FRAME_LAYOUT = FRAME_LAYOUT_FULL.fields;
/** Размер буфера в байтах */
export const FRAME_BYTES = FRAME_LAYOUT_FULL.bytes;

export function packFrame(shared, extra, out) {
	return packLayout(FRAME_LAYOUT_FULL, shared, extra, out);
}

/** Имена значений, которых нет ни в общих значениях кадра, ни в «extra» (помогает ловить забытые значения при отладке) */
export function missingFrameValues(shared, extra) {
	return FRAME_LAYOUT.filter((f) => !(f.name in extra) && !(shared[f.name] && shared[f.name].value !== undefined)).map((f) => f.name);
}
