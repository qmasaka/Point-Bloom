// Операции над BufferGeometry: быстрая склейка вершин, нормали, зеркалирование и т. д.
import * as THREE from 'three';

const isPlain = (a) => a && !a.isInterleavedBufferAttribute && a.array;

/**
 * Точная (побитовая) склейка одинаковых вершин. В отличие от mergeVertices из three
 * не использует строки, поэтому на миллионах вершин в разы быстрее и ничего не «округляет».
 * Возвращает НОВУЮ геометрию (исходная не меняется).
 */
export function weldExact(geometry) {
	const pos = geometry.attributes.position;
	if (!pos) return geometry;
	const names = Object.keys(geometry.attributes);
	for (const n of names) if (!isPlain(geometry.attributes[n])) return geometry; // чересстрочные — не трогаем
	const n = pos.count;
	const attrs = names.map((name) => geometry.attributes[name]);
	// Для float-массивов сравниваем битовые представления
	const views = attrs.map((a) => (a.array instanceof Float32Array ? new Uint32Array(a.array.buffer, a.array.byteOffset, a.array.length) : a.array));
	const sizes = attrs.map((a) => a.itemSize);

	const size = 1 << Math.ceil(Math.log2(Math.max(16, n * 2)));
	const mask = size - 1;
	const table = new Int32Array(size).fill(-1);
	const rep = new Uint32Array(n); // индекс-представитель для каждой вершины
	const newId = new Int32Array(n).fill(-1);
	let unique = 0;

	const hashOf = (i) => {
		let hsh = 2166136261 >>> 0;
		for (let a = 0; a < views.length; a++) {
			const v = views[a];
			const s = sizes[a];
			const o = i * s;
			for (let k = 0; k < s; k++) {
				hsh ^= v[o + k] >>> 0;
				hsh = Math.imul(hsh, 16777619) >>> 0;
				hsh ^= hsh >>> 15;
			}
		}
		return hsh;
	};
	const equal = (i, j) => {
		for (let a = 0; a < views.length; a++) {
			const v = views[a];
			const s = sizes[a];
			const oi = i * s;
			const oj = j * s;
			for (let k = 0; k < s; k++) if (v[oi + k] !== v[oj + k]) return false;
		}
		return true;
	};

	for (let i = 0; i < n; i++) {
		let slot = hashOf(i) & mask;
		for (;;) {
			const r = table[slot];
			if (r === -1) {
				table[slot] = i;
				rep[i] = i;
				newId[i] = unique++;
				break;
			}
			if (equal(i, r)) {
				rep[i] = r;
				break;
			}
			slot = (slot + 1) & mask;
		}
	}
	if (unique === n) return geometry; // склеивать нечего

	const out = new THREE.BufferGeometry();
	out.name = geometry.name;
	for (let a = 0; a < attrs.length; a++) {
		const src = attrs[a];
		const arr = new src.array.constructor(unique * src.itemSize);
		const s = src.itemSize;
		for (let i = 0; i < n; i++) {
			const id = newId[i];
			if (id === -1) continue;
			for (let k = 0; k < s; k++) arr[id * s + k] = src.array[i * s + k];
		}
		const na = new THREE.BufferAttribute(arr, s, src.normalized);
		out.setAttribute(names[a], na);
	}
	const oldIndex = geometry.index;
	const count = oldIndex ? oldIndex.count : n;
	const idx = unique > 65535 ? new Uint32Array(count) : new Uint16Array(count);
	for (let i = 0; i < count; i++) {
		const v = oldIndex ? oldIndex.getX(i) : i;
		idx[i] = newId[rep[v]];
	}
	out.setIndex(new THREE.BufferAttribute(idx, 1));
	for (const g of geometry.groups) out.addGroup(g.start, g.count, g.materialIndex);
	out.userData = { ...geometry.userData };
	return out;
}

/** Обратный порядок вершин у каждого треугольника (разворот граней) */
export function flipWinding(geometry) {
	const g = geometry.clone();
	if (g.index) {
		const a = g.index.array;
		for (let i = 0; i < a.length; i += 3) {
			const t = a[i + 1];
			a[i + 1] = a[i + 2];
			a[i + 2] = t;
		}
		g.index.needsUpdate = true;
	} else {
		for (const name of Object.keys(g.attributes)) {
			const at = g.attributes[name];
			const s = at.itemSize;
			const arr = at.array;
			for (let i = 0; i + 2 < at.count; i += 3) {
				for (let k = 0; k < s; k++) {
					const t = arr[(i + 1) * s + k];
					arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
					arr[(i + 2) * s + k] = t;
				}
			}
			at.needsUpdate = true;
		}
	}
	return g;
}

/** Разворот нормалей: развернуть грани и инвертировать векторы нормалей */
export function flipNormals(geometry) {
	const g = flipWinding(geometry);
	const n = g.attributes.normal;
	if (n) {
		for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
		n.needsUpdate = true;
	} else g.computeVertexNormals();
	return g;
}

/** Зеркалирование по оси ('x' | 'y' | 'z') в локальных координатах */
export function mirrorGeometry(geometry, axis) {
	const g = geometry.clone();
	const m = new THREE.Matrix4().makeScale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1);
	g.applyMatrix4(m);
	const f = flipWinding(g);
	return f;
}

/** Нормали для плоского затенения (каждая грань — своя нормаль). Геометрия станет неиндексированной. */
export function flatNormals(geometry) {
	const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
	g.deleteAttribute('normal');
	g.computeVertexNormals();
	return g;
}

/**
 * Сглаживание по углу (как «Auto Smooth» в Blender): соседние грани сглаживаются,
 * если угол между ними не больше angleDeg. UV-швы сохраняются.
 */
export function smoothNormals(geometry, angleDeg = 60) {
	const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
	if (!(g.attributes.position.array instanceof Float32Array)) {
		const src = g.attributes.position;
		const arr = new Float32Array(src.count * 3);
		for (let i = 0; i < src.count; i++) {
			arr[i * 3] = src.getX(i);
			arr[i * 3 + 1] = src.getY(i);
			arr[i * 3 + 2] = src.getZ(i);
		}
		g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
	}
	const pos = g.attributes.position;
	const n = pos.count;
	const T = Math.floor(n / 3);
	const p = pos.array;
	// 1. нормали и площади граней
	const fn = new Float32Array(T * 3);
	const fa = new Float32Array(T);
	for (let t = 0; t < T; t++) {
		const a = t * 9;
		const ux = p[a + 3] - p[a], uy = p[a + 4] - p[a + 1], uz = p[a + 5] - p[a + 2];
		const vx = p[a + 6] - p[a], vy = p[a + 7] - p[a + 1], vz = p[a + 8] - p[a + 2];
		let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const len = Math.hypot(nx, ny, nz);
		fa[t] = len * 0.5;
		if (len > 0) {
			nx /= len; ny /= len; nz /= len;
		}
		fn[t * 3] = nx; fn[t * 3 + 1] = ny; fn[t * 3 + 2] = nz;
	}
	// 2. группы вершин с одинаковым положением (хеш по битам позиции)
	const bits = new Uint32Array(p.buffer, p.byteOffset, p.length);
	const size = 1 << Math.ceil(Math.log2(Math.max(16, n * 2)));
	const mask = size - 1;
	const table = new Int32Array(size).fill(-1);
	const group = new Int32Array(n);
	let groups = 0;
	for (let i = 0; i < n; i++) {
		const o = i * 3;
		// -0 → +0, чтобы «нули» совпадали
		const bx = bits[o] === 0x80000000 ? 0 : bits[o];
		const by = bits[o + 1] === 0x80000000 ? 0 : bits[o + 1];
		const bz = bits[o + 2] === 0x80000000 ? 0 : bits[o + 2];
		let hsh = 2166136261 >>> 0;
		hsh = Math.imul(hsh ^ bx, 16777619) >>> 0; hsh ^= hsh >>> 15;
		hsh = Math.imul(hsh ^ by, 16777619) >>> 0; hsh ^= hsh >>> 15;
		hsh = Math.imul(hsh ^ bz, 16777619) >>> 0; hsh ^= hsh >>> 15;
		let slot = hsh & mask;
		for (;;) {
			const r = table[slot];
			if (r === -1) {
				table[slot] = i;
				group[i] = groups++;
				break;
			}
			const ro = r * 3;
			const rx = bits[ro] === 0x80000000 ? 0 : bits[ro];
			const ry = bits[ro + 1] === 0x80000000 ? 0 : bits[ro + 1];
			const rz = bits[ro + 2] === 0x80000000 ? 0 : bits[ro + 2];
			if (rx === bx && ry === by && rz === bz) {
				group[i] = group[r];
				break;
			}
			slot = (slot + 1) & mask;
		}
	}
	// 3. CSR: грани, примыкающие к каждой группе
	const counts = new Uint32Array(groups + 1);
	for (let i = 0; i < T * 3; i++) counts[group[i] + 1]++;
	for (let i = 0; i < groups; i++) counts[i + 1] += counts[i];
	const fill = counts.slice(0, groups);
	const faces = new Uint32Array(T * 3);
	for (let i = 0; i < T * 3; i++) faces[fill[group[i]]++] = (i / 3) | 0;
	// 4. нормаль в каждом углу
	const cosT = Math.cos((angleDeg * Math.PI) / 180) - 1e-6;
	const out = new Float32Array(n * 3);
	for (let t = 0; t < T; t++) {
		const tx = fn[t * 3], ty = fn[t * 3 + 1], tz = fn[t * 3 + 2];
		for (let c = 0; c < 3; c++) {
			const v = t * 3 + c;
			const gi = group[v];
			let sx = 0, sy = 0, sz = 0;
			for (let k = counts[gi]; k < counts[gi + 1]; k++) {
				const f = faces[k];
				const fx = fn[f * 3], fy = fn[f * 3 + 1], fz = fn[f * 3 + 2];
				if (fx * tx + fy * ty + fz * tz >= cosT) {
					const w = fa[f];
					sx += fx * w; sy += fy * w; sz += fz * w;
				}
			}
			const len = Math.hypot(sx, sy, sz) || 1;
			out[v * 3] = sx / len; out[v * 3 + 1] = sy / len; out[v * 3 + 2] = sz / len;
		}
	}
	g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
	return weldExact(g);
}

/** Развернуть V-координату UV (v → 1 − v) */
export function flipUVV(geometry) {
	const g = geometry.clone();
	const uv = g.attributes.uv;
	if (uv) {
		const a = uv.array;
		for (let i = 1; i < a.length; i += 2) a[i] = 1 - a[i];
		uv.needsUpdate = true;
	}
	return g;
}

export function triangleCount(geometry) {
	if (!geometry) return 0;
	const idx = geometry.index;
	const n = idx ? idx.count : geometry.attributes.position ? geometry.attributes.position.count : 0;
	return Math.floor(n / 3);
}

/** Геометрия для точек: те же атрибуты, но без индекса (иначе точки рисуются по нескольку раз) */
export function pointsGeometryFrom(geometry) {
	const g = new THREE.BufferGeometry();
	for (const name of ['position', 'normal', 'uv', 'color']) {
		if (geometry.attributes[name]) g.setAttribute(name, geometry.attributes[name]);
	}
	return g;
}

/** Размер диагонали ограничивающего бокса */
export function diagonal(box) {
	return box.isEmpty() ? 0 : box.min.distanceTo(box.max);
}

export function disposeGeometry(g) {
	if (g && g.dispose) g.dispose();
}
