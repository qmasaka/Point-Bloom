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

export function slider({ min = 0, max = 1, step = 0.01, value = 0, onInput, onChange, digits = 2, unit = '', format, log = false }) {
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
	const show = () => (out.value = format ? format(cur()) : fmt(cur(), digits) + unit);
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
		const v = parseHuman(out.value);
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

export function colorField({ value = '#ffffff', onInput, onChange }) {
	const pick = h('input', { type: 'color', class: 'color-in', value, 'aria-label': 'Цвет' });
	const hex = h('input', { type: 'text', class: 'num-in hex-in', value, spellcheck: 'false', maxlength: 7, 'aria-label': 'HEX' });
	pick.addEventListener('input', () => {
		hex.value = pick.value;
		onInput && onInput(pick.value);
	});
	pick.addEventListener('change', () => onChange && onChange(pick.value));
	hex.addEventListener('change', () => {
		let s = hex.value.trim();
		if (!s.startsWith('#')) s = '#' + s;
		if (/^#[0-9a-fA-F]{6}$/.test(s)) {
			pick.value = s;
			onInput && onInput(s);
			onChange && onChange(s);
		} else hex.value = pick.value;
	});
	hex.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') hex.blur();
	});
	return {
		el: h('div', { class: 'color-field' }, h('span', { class: 'swatch' }, pick), hex),
		set(v) {
			pick.value = v;
			hex.value = v;
		},
	};
}

export function empty(text, sub) {
	return h('div', { class: 'empty-note' }, h('strong', {}, text), sub ? h('span', {}, sub) : null);
}
