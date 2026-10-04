// Мелкие утилиты, не зависящие от three.js

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Мини-конструктор DOM: h('div', {class:'a', onclick: fn}, 'текст', childEl) */
export function h(tag, attrs, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v === undefined || v === null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
		else if (k === 'html') el.innerHTML = v;
		else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
		else if (k === 'dataset') Object.assign(el.dataset, v);
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const c of children.flat()) {
		if (c === null || c === undefined || c === false) continue;
		el.append(c.nodeType ? c : document.createTextNode(String(c)));
	}
	return el;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

export function formatBytes(n) {
	if (!isFinite(n)) return '-';
	if (n < 1024) return n + ' Б';
	if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
	if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' МБ';
	return (n / 1024 / 1024 / 1024).toFixed(2) + ' ГБ';
}

export function formatInt(n) {
	return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Число без хвоста нулей, до `digits` знаков */
export function fmt(n, digits = 3) {
	if (!isFinite(n)) return '-';
	const s = n.toFixed(digits);
	return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export const extOf = (name) => {
	const m = /\.([^.\\/]+)$/.exec(name || '');
	return m ? m[1].toLowerCase() : '';
};
export const stripExt = (name) => (name || '').replace(/\.[^.\\/]+$/, '');
export const baseName = (p) => (p || '').replace(/\\/g, '/').split('/').pop();

export function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function createEmitter() {
	const map = new Map();
	return {
		on(evt, fn) {
			if (!map.has(evt)) map.set(evt, new Set());
			map.get(evt).add(fn);
			return () => map.get(evt).delete(fn);
		},
		emit(evt, data) {
			const set = map.get(evt);
			if (set) for (const fn of [...set]) fn(data);
		},
	};
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
/** Отдаёт управление браузеру, чтобы успел перерисоваться индикатор загрузки */
export const yieldUI = () => new Promise((r) => setTimeout(r, 16));

export function debounce(fn, ms) {
	let t;
	return (...a) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...a), ms);
	};
}

/** Глубокое слияние простых объектов настроек */
export function mergeDeep(base, extra) {
	const out = Array.isArray(base) ? [...base] : { ...base };
	for (const k of Object.keys(extra || {})) {
		const v = extra[k];
		if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') out[k] = mergeDeep(base[k], v);
		else if (k in base) out[k] = v;
	}
	return out;
}

export function loadJSON(key, fallback) {
	try {
		const s = localStorage.getItem(key);
		return s ? JSON.parse(s) : fallback;
	} catch (e) {
		return fallback;
	}
}
export function saveJSON(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (e) {
		/* приватный режим / нет доступа — не страшно */
	}
}

/** Безопасное имя файла */
export function safeName(s, fallback = 'model') {
	const t = (s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim();
	return t || fallback;
}
