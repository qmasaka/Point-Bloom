// Материалы и текстуры: приведение к PBR (glTF), загрузка файлов, слоты, определение типа по имени.
import * as THREE from 'three';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { extOf, baseName, stripExt, clamp } from './util.js';

export const SLOTS = [
	{ key: 'map', label: 'Цвет (Base Color)', short: 'Цвет', srgb: true, tokens: ['diffuse', 'diff', 'albedo', 'basecolor', 'base', 'color', 'colour', 'col', 'bc', 'd', 'kd'] },
	{ key: 'normalMap', label: 'Нормали (Normal)', short: 'Нормали', srgb: false, tokens: ['normal', 'normalgl', 'normaldx', 'norm', 'nrm', 'nor', 'nml', 'n'] },
	{ key: 'roughnessMap', label: 'Шероховатость (Roughness)', short: 'Шероховатость', srgb: false, tokens: ['roughness', 'rough', 'rgh', 'r'] },
	{ key: 'metalnessMap', label: 'Металличность (Metallic)', short: 'Металл', srgb: false, tokens: ['metallic', 'metalness', 'metal', 'mtl', 'm'] },
	{ key: 'aoMap', label: 'Окклюзия (AO)', short: 'AO', srgb: false, tokens: ['ao', 'occlusion', 'ambientocclusion', 'ambient', 'occ'] },
	{ key: 'emissiveMap', label: 'Свечение (Emissive)', short: 'Свечение', srgb: true, tokens: ['emissive', 'emission', 'emit', 'glow', 'e', 'ke'] },
];

/** Типы карт, которые glTF не поддерживает в таком виде — не назначаем их молча как цвет */
const UNSUPPORTED_TOKENS = ['height', 'bump', 'disp', 'displacement', 'spec', 'specular', 'gloss', 'glossiness', 'opacity', 'alpha', 'mask', 'trans', 'transparency'];

export const slotByKey = (key) => SLOTS.find((s) => s.key === key);

let maxAniso = 8;
let maxTexSize = 8192;
export function setTextureLimits(aniso, maxSize) {
	maxAniso = aniso;
	maxTexSize = maxSize;
}

/** По имени файла определяет, для какого слота текстура: 'map', 'normalMap', … или 'unsupported' */
export function detectSlot(filename) {
	const base = stripExt(baseName(filename)).toLowerCase();
	const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);
	for (let i = tokens.length - 1; i >= 0; i--) {
		const t = tokens[i];
		const okShort = t.length > 2 || (i === tokens.length - 1 && tokens.length > 1);
		if (okShort) for (const slot of SLOTS) if (slot.tokens.includes(t)) return slot.key;
		if (UNSUPPORTED_TOKENS.includes(t)) return 'unsupported';
	}
	// слитные имена вроде «woodNormalGL»
	const joined = tokens.join('');
	for (const slot of SLOTS) for (const t of slot.tokens) if (t.length > 3 && joined.includes(t)) return slot.key;
	for (const t of UNSUPPORTED_TOKENS) if (t.length > 3 && joined.includes(t)) return 'unsupported';
	return 'map';
}

// ------------------------------------------------------------ загрузка файла
function mimeOf(ext) {
	if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
	return 'image/png'; // png, webp, bmp, gif, tga … → экспортируем как PNG
}

function loadHTMLImage(url) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Не удалось декодировать изображение'));
		img.src = url;
	});
}

function shrinkIfNeeded(img) {
	const w = img.width || img.naturalWidth;
	const h = img.height || img.naturalHeight;
	const m = Math.max(w, h);
	if (m <= maxTexSize) return { image: img, w, h, scaled: false };
	const k = maxTexSize / m;
	const c = document.createElement('canvas');
	c.width = Math.max(1, Math.round(w * k));
	c.height = Math.max(1, Math.round(h * k));
	c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
	return { image: c, w: c.width, h: c.height, scaled: true };
}

// Тяжёлые картинки (4K и 8K текстуры PBR) декодируются и уменьшаются в фоновом пуле потоков браузера, интерфейс при этом не замирает
const BITMAP_MIN_BYTES = 1.5 * 1024 * 1024;

async function decodeBigImage(file) {
	if (typeof createImageBitmap !== 'function' || file.size < BITMAP_MIN_BYTES) return null;
	let bmp = null;
	try {
		bmp = await createImageBitmap(file);
		const m = Math.max(bmp.width, bmp.height);
		let scaled = false;
		if (m > maxTexSize) {
			const k = maxTexSize / m;
			const rw = Math.max(1, Math.round(bmp.width * k));
			const rh = Math.max(1, Math.round(bmp.height * k));
			bmp.close();
			bmp = await createImageBitmap(file, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' });
			scaled = true;
		}
		// остальной код читает текстуру как обычное изображение (миниатюры, экспорт, UV), поэтому кладём результат на холст
		const c = document.createElement('canvas');
		c.width = bmp.width;
		c.height = bmp.height;
		c.getContext('2d').drawImage(bmp, 0, 0);
		return { image: c, w: c.width, h: c.height, scaled };
	} catch (e) {
		return null;
	} finally {
		if (bmp) bmp.close();
	}
}

/** Декодирует файл изображения → { image, width, height, mime } */
export async function decodeImageFile(file) {
	const ext = extOf(file.name);
	let source;
	if (ext === 'tga') {
		const buf = new Uint8Array(await file.arrayBuffer());
		const t = new TGALoader().parse(buf);
		const c = document.createElement('canvas');
		c.width = t.width;
		c.height = t.height;
		c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.data.buffer, t.data.byteOffset, t.data.length), t.width, t.height), 0, 0);
		source = c;
	} else {
		const big = await decodeBigImage(file);
		if (big) return { image: big.image, width: big.w, height: big.h, mime: mimeOf(ext), scaled: big.scaled, ext };
		const url = URL.createObjectURL(file);
		try {
			source = await loadHTMLImage(url);
			if (source.decode) await Promise.race([source.decode().catch(() => {}), new Promise((r) => setTimeout(r, 400))]);
		} finally {
			// URL освобождаем после декодирования — картинка уже в памяти
			setTimeout(() => URL.revokeObjectURL(url), 5000);
		}
	}
	const { image, w, h, scaled } = shrinkIfNeeded(source);
	return { image, width: w, height: h, mime: mimeOf(ext), scaled, ext };
}

export function makeTexture(decoded, fileName, file) {
	const tex = new THREE.Texture(decoded.image);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.anisotropy = maxAniso;
	tex.name = stripExt(baseName(fileName));
	tex.userData = { fileName: baseName(fileName), mime: decoded.mime, width: decoded.width, height: decoded.height, ext: decoded.ext, file: decoded.scaled ? null : file };
	tex.needsUpdate = true;
	return tex;
}

export async function loadTextureFile(file) {
	return makeTexture(await decodeImageFile(file), file.name, file);
}

/** Заполняет уже созданную «пустую» текстуру (нужно MTLLoader, который ждёт синхронный результат) */
export async function fillTextureFromFile(tex, file) {
	const d = await decodeImageFile(file);
	tex.image = d.image;
	tex.name = stripExt(baseName(file.name));
	tex.userData = { fileName: baseName(file.name), mime: d.mime, width: d.width, height: d.height, ext: d.ext, file: d.scaled ? null : file };
	tex.anisotropy = maxAniso;
	tex.needsUpdate = true;
	return tex;
}

// -------------------------------------------------------------- миниатюры
export function thumbnail(tex, size = 72) {
	if (!tex || !tex.image) return null;
	const ud = tex.userData;
	if (ud.thumb && ud.thumbVersion === tex.version) return ud.thumb;
	const w = tex.image.width || tex.image.naturalWidth;
	const h = tex.image.height || tex.image.naturalHeight;
	if (!w || !h) return null;
	const k = Math.min(size / w, size / h);
	const c = document.createElement('canvas');
	c.width = Math.max(1, Math.round(w * k));
	c.height = Math.max(1, Math.round(h * k));
	const ctx = c.getContext('2d');
	ctx.drawImage(tex.image, 0, 0, c.width, c.height);
	ud.thumb = c.toDataURL('image/png');
	ud.thumbVersion = tex.version;
	return ud.thumb;
}

// --------------------------------------------------- нормализация материалов
/** Приводит любой материал к MeshStandardMaterial (то, что корректно экспортируется в glTF) */
export function toStandard(src, report) {
	if (!src) return new THREE.MeshStandardMaterial({ name: 'Material', color: 0xcccccc, roughness: 0.8, metalness: 0 });
	if (src.isMeshStandardMaterial) return src; // включая Physical (glTF)
	const m = new THREE.MeshStandardMaterial();
	m.name = src.name || 'Material';
	if (src.color) m.color.copy(src.color);
	m.map = src.map || null;
	m.normalMap = src.normalMap || null;
	if (src.normalScale) m.normalScale.copy(src.normalScale);
	m.emissive.copy(src.emissive || new THREE.Color(0, 0, 0));
	m.emissiveMap = src.emissiveMap || null;
	m.opacity = src.opacity ?? 1;
	m.transparent = !!src.transparent || m.opacity < 1;
	m.alphaTest = src.alphaTest || 0;
	m.side = src.side ?? THREE.FrontSide;
	m.vertexColors = !!src.vertexColors;
	m.metalness = 0;
	if (src.isMeshPhongMaterial) {
		m.roughness = clamp(1 - Math.sqrt(Math.max(src.shininess, 0) / 1000), 0.04, 1);
	} else m.roughness = 0.85;
	if (src.alphaMap) m.userData.alphaMap = src.alphaMap;
	if (src.bumpMap) {
		m.userData.bumpMap = src.bumpMap;
		m.userData.bumpScale = src.bumpScale ?? 1;
	}
	if (src.isMeshBasicMaterial) m.roughness = 1;
	if (report && src.bumpMap && !src.normalMap) report.bump = (report.bump || 0) + 1;
	return m;
}

export function hasAlphaChannel(tex) {
	const img = tex && tex.image;
	if (!img) return false;
	const ext = tex.userData && tex.userData.ext;
	if (ext === 'jpg' || ext === 'jpeg' || ext === 'bmp') return false;
	const w = img.width || img.naturalWidth;
	const h = img.height || img.naturalHeight;
	const k = Math.min(1, 512 / Math.max(w, h));
	const c = document.createElement('canvas');
	c.width = Math.max(1, Math.round(w * k));
	c.height = Math.max(1, Math.round(h * k));
	const ctx = c.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(img, 0, 0, c.width, c.height);
	const d = ctx.getImageData(0, 0, c.width, c.height).data;
	let semi = 0, clear = 0;
	const n = d.length / 4;
	for (let i = 3; i < d.length; i += 4) {
		if (d[i] < 250) clear++;
		if (d[i] > 16 && d[i] < 239) semi++;
	}
	return { any: clear > 0, hard: semi / n < 0.05, ratio: clear / n };
}

/** Применяет режим прозрачности: 'opaque' | 'mask' | 'blend' */
export function setAlphaMode(material, mode, cutoff = 0.5) {
	if (mode === 'mask') {
		material.transparent = false;
		material.alphaTest = cutoff;
		material.depthWrite = true;
	} else if (mode === 'blend') {
		material.transparent = true;
		material.alphaTest = 0;
		material.depthWrite = false;
	} else {
		material.transparent = false;
		material.alphaTest = 0;
		material.opacity = 1;
		material.depthWrite = true;
	}
	material.needsUpdate = true;
}
export function getAlphaMode(material) {
	if (material.alphaTest > 0) return 'mask';
	if (material.transparent || material.opacity < 1) return 'blend';
	return 'opaque';
}

/** Склеивает карту прозрачности (map_d) в альфа-канал базового цвета, чтобы glTF её понял */
export function mergeAlphaIntoBaseColor(map, alphaMap) {
	if (!map || !map.image || !alphaMap || !alphaMap.image) return null;
	const w = map.image.width || map.image.naturalWidth;
	const h = map.image.height || map.image.naturalHeight;
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	const ctx = c.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(map.image, 0, 0, w, h);
	const base = ctx.getImageData(0, 0, w, h);
	const a = document.createElement('canvas');
	a.width = w;
	a.height = h;
	const actx = a.getContext('2d', { willReadFrequently: true });
	actx.drawImage(alphaMap.image, 0, 0, w, h);
	const al = actx.getImageData(0, 0, w, h).data;
	let semi = 0;
	for (let i = 0; i < base.data.length; i += 4) {
		const v = al[i]; // яркость (серая карта → R)
		base.data[i + 3] = v;
		if (v > 16 && v < 239) semi++;
	}
	ctx.putImageData(base, 0, 0);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.flipY = map.flipY;
	tex.anisotropy = maxAniso;
	tex.name = map.name;
	tex.userData = { ...map.userData, mime: 'image/png', ext: 'png', thumb: null };
	tex.repeat.copy(map.repeat);
	tex.offset.copy(map.offset);
	return { texture: tex, hard: semi / (w * h) < 0.05 };
}

/** Карта высот (bump) → карта нормалей (оператор Собеля) */
export function heightToNormalMap(height, strength = 2) {
	const img = height.image;
	const w = img.width || img.naturalWidth;
	const h = img.height || img.naturalHeight;
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	const ctx = c.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(img, 0, 0, w, h);
	const src = ctx.getImageData(0, 0, w, h).data;
	const out = ctx.createImageData(w, h);
	const L = (x, y) => {
		x = (x + w) % w;
		y = Math.min(h - 1, Math.max(0, y));
		const i = (y * w + x) * 4;
		return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
	};
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const dx = (L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1)) - (L(x - 1, y - 1) + 2 * L(x - 1, y) + L(x - 1, y + 1));
			const dy = (L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1)) - (L(x - 1, y - 1) + 2 * L(x, y - 1) + L(x + 1, y - 1));
			// +Y вверх (OpenGL): строки изображения идут сверху вниз, поэтому dy берём как есть
			let nx = -dx * strength, ny = dy * strength, nz = 1;
			const l = Math.hypot(nx, ny, nz);
			nx /= l; ny /= l; nz /= l;
			const o = (y * w + x) * 4;
			out.data[o] = (nx * 0.5 + 0.5) * 255;
			out.data[o + 1] = (ny * 0.5 + 0.5) * 255;
			out.data[o + 2] = (nz * 0.5 + 0.5) * 255;
			out.data[o + 3] = 255;
		}
	}
	ctx.putImageData(out, 0, 0);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.NoColorSpace;
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.flipY = height.flipY;
	tex.anisotropy = maxAniso;
	tex.name = (height.name || 'bump') + '_normal';
	tex.userData = { fileName: tex.name + '.png', mime: 'image/png', width: w, height: h, ext: 'png' };
	tex.repeat.copy(height.repeat);
	tex.offset.copy(height.offset);
	return tex;
}

/** Постобработка материала после загрузки текстур: bump → normal, альфа-карта → альфа-канал */
export function finalizeMaterial(m) {
	const ud = m.userData;
	if (ud.bumpMap && !m.normalMap && ud.bumpMap.image) {
		const name = (ud.bumpMap.userData && ud.bumpMap.userData.fileName) || '';
		if (detectSlot(name) === 'normalMap') {
			// «bump» на самом деле карта нормалей
			m.normalMap = ud.bumpMap;
			m.normalMap.colorSpace = THREE.NoColorSpace;
		} else {
			m.normalMap = heightToNormalMap(ud.bumpMap, 1 + Math.min(4, Math.abs(ud.bumpScale ?? 1)) * 2);
		}
	}
	delete ud.bumpMap;
	delete ud.bumpScale;
	if (ud.alphaMap && ud.alphaMap.image) {
		if (m.map && m.map.image) {
			const r = mergeAlphaIntoBaseColor(m.map, ud.alphaMap);
			if (r) {
				m.map = r.texture;
				setAlphaMode(m, r.hard ? 'mask' : 'blend');
			}
		}
	} else if (m.map && m.map.image && !m.transparent && !m.alphaTest) {
		const a = hasAlphaChannel(m.map);
		if (a && a.any && a.ratio > 0.002) setAlphaMode(m, a.hard ? 'mask' : 'blend');
	}
	delete ud.alphaMap;
	fixColorSpaces(m);
}

export function fixColorSpaces(m) {
	for (const slot of SLOTS) {
		const t = m[slot.key];
		if (t) t.colorSpace = slot.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	}
}

// ------------------------------------------------------------------ слоты
/** Назначает текстуру в слот материала с корректной цветовой моделью и «разумными» множителями */
export function assignTexture(material, slotKey, texture) {
	const slot = slotByKey(slotKey);
	if (!slot) return;
	const cs = slot.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	let tex = texture;
	// одна текстура в слотах с разной цветовой моделью — клонируем (Source с картинкой общий)
	if (tex.userData._slotCS && tex.userData._slotCS !== cs) {
		tex = tex.clone();
		tex.userData = { ...texture.userData, thumb: null };
	}
	tex.userData._slotCS = cs;
	tex.colorSpace = cs;
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.anisotropy = maxAniso;
	tex.needsUpdate = true;
	const had = !!material[slotKey];
	material[slotKey] = tex;
	if (!had) {
		if (slotKey === 'map') material.color.set(0xffffff);
		if (slotKey === 'roughnessMap') material.roughness = 1;
		if (slotKey === 'metalnessMap') material.metalness = 1;
		if (slotKey === 'emissiveMap') {
			material.emissive.set(0xffffff);
			material.emissiveIntensity = 1;
		}
		if (slotKey === 'aoMap') material.aoMapIntensity = 1;
	}
	if (slotKey === 'map' && !material.transparent && !material.alphaTest) {
		const a = hasAlphaChannel(tex);
		if (a && a.any && a.ratio > 0.002) setAlphaMode(material, a.hard ? 'mask' : 'blend');
	}
	material.needsUpdate = true;
	return tex;
}

export function clearTexture(material, slotKey) {
	if (!material[slotKey]) return null;
	const old = material[slotKey];
	material[slotKey] = null;
	material.needsUpdate = true;
	return old;
}

export function materialTextures(material) {
	const out = [];
	for (const s of SLOTS) if (material && material[s.key]) out.push({ slot: s, texture: material[s.key] });
	return out;
}

/** Все материалы объекта (без дублей) */
export function uniqueMaterials(list) {
	const set = new Set();
	for (const m of list) {
		if (Array.isArray(m)) m.forEach((x) => x && set.add(x));
		else if (m) set.add(m);
	}
	return [...set];
}

/** Рисует UV-развёртку меша поверх базовой текстуры */
export function drawUVLayout(canvas, geometry, material) {
	const size = canvas.width;
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, size, size);
	ctx.fillStyle = '#16181c';
	ctx.fillRect(0, 0, size, size);
	const tex = material && material.map;
	if (tex && tex.image) {
		ctx.save();
		ctx.globalAlpha = 0.7;
		ctx.drawImage(tex.image, 0, 0, size, size);
		ctx.restore();
	}
	// рамка 0..1
	ctx.strokeStyle = 'rgba(255,255,255,.35)';
	ctx.lineWidth = 1;
	ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
	const uv = geometry && geometry.attributes.uv;
	if (!uv) {
		ctx.fillStyle = '#9aa0ab';
		ctx.font = '12px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('У меша нет UV-координат', size / 2, size / 2);
		return false;
	}
	const idx = geometry.index;
	const T = Math.floor((idx ? idx.count : uv.count) / 3);
	const step = Math.max(1, Math.ceil(T / 40000));
	const flip = !tex || tex.flipY !== false; // v вверх → рисуем с инверсией по y
	const X = (u) => u * size;
	const Y = (v) => (flip ? 1 - v : v) * size;
	ctx.beginPath();
	for (let t = 0; t < T; t += step) {
		const a = idx ? idx.getX(t * 3) : t * 3;
		const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
		const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
		ctx.moveTo(X(uv.getX(a)), Y(uv.getY(a)));
		ctx.lineTo(X(uv.getX(b)), Y(uv.getY(b)));
		ctx.lineTo(X(uv.getX(c)), Y(uv.getY(c)));
		ctx.closePath();
	}
	ctx.strokeStyle = 'rgba(255,170,40,.75)';
	ctx.lineWidth = 0.7;
	ctx.stroke();
	return true;
}
