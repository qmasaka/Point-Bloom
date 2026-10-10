// Набор компонентов интерфейса. Каждый возвращает { el, set(value) }, где set не вызывает onChange.
import { h, clamp, fmt } from './util.js';
import { icon } from './icons.js';

const svg = (name, size = 16) => {
	const t = document.createElement('span');
	t.className = 'ic-wrap';
	t.innerHTML = icon(name, size);
	return t;
};

export function iconButton({ icon: name, title, onClick, size = 18, cls = '', pressed }) {
	const b = h('button', { type: 'button', class: 'btn btn-icon ' + cls, 'aria-label': title, 'data-tip': title, onclick: onClick });
	b.append(svg(name, size));
	if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed));
	return b;
}

export function button({ label, icon: name, variant = 'secondary', onClick, title, cls = '', size = 16 }) {
	const b = h('button', { type: 'button', class: `btn btn-${variant} ${cls}`, 'data-tip': title, onclick: onClick });
	if (name) b.append(svg(name, size));
	if (label) b.append(h('span', { class: 'btn-label' }, label));
	return b;
}

/** Сворачиваемая секция боковой панели */
export function section(title, { actions = null, open = true, key } = {}, ...children) {
	const body = h('div', { class: 'sec-body' }, ...children);
	const head = h('button', { type: 'button', class: 'sec-head', 'aria-expanded': String(open) }, svg('caret-down', 14), h('span', { class: 'sec-title' }, title));
	const el = h('section', { class: 'sec' + (open ? '' : ' is-closed'), dataset: { key: key || title } }, h('div', { class: 'sec-bar' }, head, actions ? h('div', { class: 'sec-actions' }, actions) : null), body);
	head.addEventListener('click', () => {
		const closed = el.classList.toggle('is-closed');
		head.setAttribute('aria-expanded', String(!closed));
	});
	return { el, body };
}

export function field(label, control, { hint, wide = false } = {}) {
	return h('div', { class: 'field' + (wide ? ' field-wide' : '') }, h('label', { class: 'field-label' }, label), h('div', { class: 'field-control' }, control), hint ? h('div', { class: 'field-hint' }, hint) : null);
}

export function toggle({ value = false, onChange, label }) {
	const b = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!value), 'aria-label': label || 'Переключатель' }, h('span', { class: 'switch-knob' }));
	let v = !!value;
	b.addEventListener('click', () => {
		v = !v;
		b.setAttribute('aria-checked', String(v));
		onChange && onChange(v);
	});
	return {
		el: b,
		set(x) {
			v = !!x;
			b.setAttribute('aria-checked', String(v));
		},
	};
}

/** Строка «подпись слева, переключатель справа» */
export function switchRow(label, opts, hint) {
	const t = toggle({ ...opts, label });
	const row = h('div', { class: 'switch-row' }, h('div', { class: 'switch-text' }, h('span', { class: 'switch-label' }, label), hint ? h('span', { class: 'field-hint' }, hint) : null), t.el);
	row.addEventListener('click', (e) => {
		if (e.target.closest('.switch')) return;
		t.el.click();
	});
	return { el: row, set: t.set };
}

export function segmented({ options, value, onChange, cls = '', label }) {
	const el = h('div', { class: 'seg ' + cls, role: 'radiogroup', 'aria-label': label || '' });
	const buttons = new Map();
	let current = value;
	for (const o of options) {
		const b = h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': String(o.value === value), 'data-tip': o.title }, o.icon ? svg(o.icon, 16) : null, o.label ? h('span', { class: 'seg-label' }, o.label) : null);
		b.addEventListener('click', () => {
			if (current === o.value) return;
			set(o.value);
			onChange && onChange(o.value);
		});
		buttons.set(o.value, b);
		el.append(b);
	}
	function set(v) {
		current = v;
		for (const [val, b] of buttons) b.setAttribute('aria-checked', String(val === v));
	}
	return { el, set };
}

export function select({ options, value, onChange }) {
	const el = h('select', { class: 'select' });
	const fill = (opts) => {
		el.textContent = '';
		for (const o of opts) el.append(h('option', { value: String(o.value) }, o.label));
	};
	fill(options);
	el.value = String(value);
	el.addEventListener('change', () => onChange && onChange(el.value));
	const wrap = h('div', { class: 'select-wrap' }, el, svg('caret-down', 14));
	return {
		el: wrap,
		select: el,
		set(v) {
			el.value = String(v);
		},
		setOptions(opts, v) {
			fill(opts);
			if (v !== undefined) el.value = String(v);
		},
	};
}

/** Число из текста: понимает пробелы-разделители, запятую, «2m», «500к», «1,5 млн» */
export function parseHuman(s) {
	const t = String(s).toLowerCase().replace(/\s/g, '').replace(',', '.');
	const m = /^(-?[\d.]+)(млн|м|m|тыс\.?|к|k)?/.exec(t);
	if (!m) return NaN;
	const mult = !m[2] ? 1 : /^(млн|м|m)$/.test(m[2]) ? 1e6 : 1e3;
	return parseFloat(m[1]) * mult;
}

export function slider({ min = 0, max = 1, step = 0.01, value = 0, onInput, onChange, digits = 2, unit = '', format, log = false, norm = false }) {
	let lo = min;
	let hi = max;
	// log: бегунок работает по шкале 0..1000, значение растёт по степенному закону (для больших диапазонов)
	const toPos = (v) => (log ? (Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo)) * 1000 : v);
	const fromPos = (p) => {
		if (!log) return p;
		const v = lo * Math.pow(hi / lo, p / 1000);
		return clamp(Math.round(v / step) * step, lo, hi);
	};
	const range = h('input', { type: 'range', class: 'range', min: log ? 0 : min, max: log ? 1000 : max, step: log ? 1 : step, value: toPos(value) });
	const out = h('input', { type: 'text', class: 'num-out', inputmode: 'decimal', 'aria-label': 'Значение' });
	const cur = () => fromPos(parseFloat(range.value));
	// norm: движок получает реальное значение, а на экране шкала всегда от 0 до 1, чтобы числа читались одинаково во всех настройках
	const frac = (v) => clamp(log ? Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo), 0, 1);
	const unfrac = (f) => {
		const v = log ? lo * Math.pow(hi / lo, f) : lo + f * (hi - lo);
		return clamp(Math.round(v / step) * step, lo, hi);
	};
	const show = () => (out.value = norm ? fmt(frac(cur()), 2) : format ? format(cur()) : fmt(cur(), digits) + unit);
	const paint = () => {
		const p = log ? parseFloat(range.value) / 10 : ((parseFloat(range.value) - lo) / (hi - lo)) * 100;
		range.style.setProperty('--p', clamp(p, 0, 100) + '%');
		show();
	};
	range.addEventListener('input', () => {
		paint();
		onInput && onInput(cur());
	});
	range.addEventListener('change', () => onChange && onChange(cur()));
	const commitText = () => {
		const t = parseHuman(out.value);
		const v = norm && isFinite(t) ? unfrac(clamp(t, 0, 1)) : t;
		if (isFinite(v)) {
			range.value = toPos(clamp(v, lo, hi));
			paint();
			onInput && onInput(cur());
			onChange && onChange(cur());
		} else paint();
	};
	out.addEventListener('change', commitText);
	out.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') out.blur();
	});
	out.addEventListener('focus', () => out.select());
	paint();
	return {
		el: h('div', { class: 'slider' }, range, out),
		get: cur,
		set(v) {
			range.value = toPos(v);
			paint();
		},
		setRange(a, b) {
			const v = cur();
			lo = a;
			hi = b;
			if (!log) {
				range.min = a;
				range.max = b;
			}
			range.value = toPos(clamp(v, lo, hi));
			paint();
		},
	};
}
/** Ползунок настроек эффектов: числа читаются одинаково, шкала до 1 (до 2, если так задумано). noNorm оставляет реальные величины: число точек, секунды, кадры */
export function fxSlider(o) {
	if (o.noNorm) return slider(o);
	if (o.min >= -1 && o.min <= 0.1 && o.max <= 2) return slider({ ...o, format: undefined, unit: '', digits: 2 });
	return slider({ ...o, norm: true });
}
export function numberField({ value = 0, step = 0.1, onChange, axis, digits = 4, min = -Infinity, max = Infinity, cls = '' }) {
	let v = value;
	const input = h('input', { type: 'text', class: 'num-in', inputmode: 'decimal', spellcheck: 'false', 'aria-label': axis || 'Значение' });
	const label = axis ? h('span', { class: 'num-axis ' + (cls || ''), title: 'Потяните, чтобы менять значение' }, axis) : null;
	const show = () => (input.value = fmt(v, digits));
	const commit = (nv, fire = true) => {
		nv = clamp(nv, min, max);
		if (!isFinite(nv)) return show();
		const changed = nv !== v;
		v = nv;
		show();
		if (changed && fire) onChange && onChange(v);
	};
	input.addEventListener('change', () => commit(parseFloat(input.value.replace(',', '.'))));
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') input.blur();
		else if (e.key === 'Escape') {
			show();
			input.blur();
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			commit(v + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1));
		}
	});
	input.addEventListener('focus', () => input.select());
	if (label) {
		label.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			label.setPointerCapture(e.pointerId);
			let acc = 0;
			let last = e.clientX;
			let base = v;
			const move = (ev) => {
				acc += ev.clientX - last;
				last = ev.clientX;
				const k = ev.shiftKey ? 0.1 : ev.ctrlKey || ev.metaKey ? 10 : 1;
				commit(base + (acc / 6) * step * k);
			};
			const up = () => {
				label.removeEventListener('pointermove', move);
				label.removeEventListener('pointerup', up);
				label.removeEventListener('pointercancel', up);
			};
			label.addEventListener('pointermove', move);
			label.addEventListener('pointerup', up);
			label.addEventListener('pointercancel', up);
		});
	}
	show();
	return {
		el: h('label', { class: 'num' }, label, input),
		input,
		set(x) {
			v = x;
			if (document.activeElement !== input) show();
		},
	};
}

// ---------------------------------------------------------------- свой выбор цвета (вместо системного окна)
const hexToRgb = (hx) => {
	const n = parseInt(hx.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function rgbToHsv(r, g, b) {
	r /= 255;
	g /= 255;
	b /= 255;
	const mx = Math.max(r, g, b);
	const mn = Math.min(r, g, b);
	const d = mx - mn;
	let hh = 0;
	if (d) {
		if (mx === r) hh = ((g - b) / d) % 6;
		else if (mx === g) hh = (b - r) / d + 2;
		else hh = (r - g) / d + 4;
		hh *= 60;
		if (hh < 0) hh += 360;
	}
	return [hh, mx ? d / mx : 0, mx];
}
function hsvToRgb(hh, sat, v) {
	const c = v * sat;
	const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
	const m = v - c;
	const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
	return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
let openPicker = null;

export function colorField({ value = '#ffffff', onInput, onChange }) {
	let hsv = rgbToHsv(...hexToRgb(value));
	let cur = value;
	const dot = h('button', { type: 'button', class: 'cp-dot', 'aria-label': 'Выбрать цвет' });
	const hex = h('input', { type: 'text', class: 'num-in hex-in', value, spellcheck: 'false', maxlength: 7, 'aria-label': 'HEX' });
	const paintDot = () => {
		dot.style.background = cur;
		hex.value = cur;
	};
	const apply = (fire, final) => {
		cur = rgbToHex(...hsvToRgb(hsv[0], hsv[1], hsv[2]));
		paintDot();
		fire && onInput && onInput(cur);
		final && onChange && onChange(cur);
	};
	const setHex = (v, fire = true) => {
		let t = v.trim();
		if (!t.startsWith('#')) t = '#' + t;
		if (!/^#[0-9a-fA-F]{6}$/.test(t)) return false;
		cur = t.toLowerCase();
		hsv = rgbToHsv(...hexToRgb(cur));
		paintDot();
		if (fire) {
			onInput && onInput(cur);
			onChange && onChange(cur);
		}
		return true;
	};
	hex.addEventListener('change', () => {
		if (!setHex(hex.value)) hex.value = cur;
	});
	hex.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') hex.blur();
	});

	let pop = null;
	const close = () => {
		if (!pop) return;
		pop.remove();
		pop = null;
		dot.setAttribute('aria-expanded', 'false');
		document.removeEventListener('pointerdown', outside, true);
		document.removeEventListener('keydown', esc, true);
		if (openPicker === close) openPicker = null;
	};
	const outside = (e) => {
		if (pop && !pop.contains(e.target) && !dot.contains(e.target)) close();
	};
	const esc = (e) => {
		if (e.key === 'Escape') close();
	};
	const open = () => {
		if (openPicker) openPicker();
		const sv = h('canvas', { class: 'cp-sv', width: 220, height: 150 });
		const hue = h('canvas', { class: 'cp-hue', width: 220, height: 14 });
		const hexIn = h('input', { type: 'text', class: 'num-in hex-in', value: cur, spellcheck: 'false', maxlength: 7, 'aria-label': 'HEX' });
		pop = h('div', { class: 'cp-pop', role: 'dialog', 'aria-label': 'Выбор цвета' }, sv, hue, h('div', { class: 'cp-row' }, h('span', { class: 'cp-cur', style: { background: cur } }), hexIn));
		const drawSV = () => {
			const c = sv.getContext('2d');
			const w = sv.width;
			const hh = sv.height;
			c.fillStyle = `hsl(${hsv[0]}, 100%, 50%)`;
			c.fillRect(0, 0, w, hh);
			let g = c.createLinearGradient(0, 0, w, 0);
			g.addColorStop(0, '#fff');
			g.addColorStop(1, 'rgba(255,255,255,0)');
			c.fillStyle = g;
			c.fillRect(0, 0, w, hh);
			g = c.createLinearGradient(0, 0, 0, hh);
			g.addColorStop(0, 'rgba(0,0,0,0)');
			g.addColorStop(1, '#000');
			c.fillStyle = g;
			c.fillRect(0, 0, w, hh);
			const x = hsv[1] * w;
			const y = (1 - hsv[2]) * hh;
			c.lineWidth = 2;
			c.strokeStyle = '#fff';
			c.beginPath();
			c.arc(x, y, 6, 0, Math.PI * 2);
			c.stroke();
			c.strokeStyle = 'rgba(0,0,0,0.5)';
			c.lineWidth = 1;
			c.beginPath();
			c.arc(x, y, 7.5, 0, Math.PI * 2);
			c.stroke();
		};
		const drawHue = () => {
			const c = hue.getContext('2d');
			const g = c.createLinearGradient(0, 0, hue.width, 0);
			for (let k = 0; k <= 6; k++) g.addColorStop(k / 6, `hsl(${k * 60}, 100%, 50%)`);
			c.fillStyle = g;
			c.fillRect(0, 0, hue.width, hue.height);
			const x = (hsv[0] / 360) * hue.width;
			c.fillStyle = '#fff';
			c.strokeStyle = 'rgba(0,0,0,0.55)';
			c.lineWidth = 1.5;
			c.beginPath();
			c.rect(x - 3, 1, 6, hue.height - 2);
			c.fill();
			c.stroke();
		};
		const refresh = () => {
			drawSV();
			drawHue();
			hexIn.value = cur;
			pop.querySelector('.cp-cur').style.background = cur;
		};
		const drag = (el, fn) => {
			el.addEventListener('pointerdown', (e) => {
				el.setPointerCapture(e.pointerId);
				const move = (ev) => {
					const r = el.getBoundingClientRect();
					fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
					apply(true, false);
					refresh();
				};
				const up = () => {
					el.removeEventListener('pointermove', move);
					el.removeEventListener('pointerup', up);
					onChange && onChange(cur);
				};
				el.addEventListener('pointermove', move);
				el.addEventListener('pointerup', up);
				move(e);
			});
		};
		drag(sv, (x, y) => {
			hsv[1] = x;
			hsv[2] = 1 - y;
		});
		drag(hue, (x) => {
			hsv[0] = x * 359.99;
		});
		hexIn.addEventListener('change', () => {
			if (setHex(hexIn.value)) refresh();
			else hexIn.value = cur;
		});
		hexIn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') hexIn.blur();
		});
		document.body.append(pop);
		const z = parseFloat(document.documentElement.style.zoom) || 1;
		const r = dot.getBoundingClientRect();
		const pw = pop.offsetWidth;
		const ph = pop.offsetHeight;
		let left = r.left / z;
		let top = r.bottom / z + 6;
		left = Math.max(8, Math.min(window.innerWidth / z - pw - 8, left));
		if (top + ph > window.innerHeight / z - 8) top = Math.max(8, r.top / z - ph - 6);
		pop.style.left = left + 'px';
		pop.style.top = top + 'px';
		refresh();
		dot.setAttribute('aria-expanded', 'true');
		openPicker = close;
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('keydown', esc, true);
	};
	dot.addEventListener('click', () => (pop ? close() : open()));
	paintDot();
	return {
		el: h('div', { class: 'color-field' }, dot, hex),
		set(v) {
			setHex(v, false);
		},
	};
}

export function empty(text, sub) {
	return h('div', { class: 'empty-note' }, h('strong', {}, text), sub ? h('span', {}, sub) : null);
}
