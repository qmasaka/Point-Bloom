// Плавающие стеклянные панели режима «Эффекты»: каждую можно свернуть до полоски и перетащить за ручку. Положение запоминается.
import { icon } from './icons.js';

const KEY = 'objglb.fxfloat.v1';

export function initFloatingPanels() {
	let st = {};
	try {
		st = JSON.parse(localStorage.getItem(KEY)) || {};
	} catch {
		st = {};
	}
	const save = () => {
		try {
			localStorage.setItem(KEY, JSON.stringify(st));
		} catch {
			/* без хранилища панели просто не запомнят положение */
		}
	};
	const ws = document.querySelector('.workspace');
	const cards = [
		['fxLeft', 'left', 'Эффекты'],
		['sidebar', 'right', 'Настройки'],
	];
	for (const [id, name, title] of cards) {
		const el = document.getElementById(id);
		if (!el || el.querySelector(':scope > .fxf-bar')) continue;
		const bar = document.createElement('div');
		bar.className = 'fxf-bar';
		const grip = document.createElement('div');
		grip.className = 'fxf-grip';
		grip.title = 'Потяните, чтобы переместить панель (двойной клик вернёт на место)';
		const label = document.createElement('span');
		label.className = 'fxf-title';
		label.textContent = title;
		const toggle = document.createElement('button');
		toggle.type = 'button';
		toggle.className = 'fxf-toggle';
		toggle.setAttribute('aria-label', 'Свернуть или развернуть панель');
		toggle.innerHTML = icon('caret-down', 14);
		bar.append(grip, label, toggle);
		el.prepend(bar);

		const pos = (st[name] ||= { x: 0, y: 0, c: false });
		const apply = () => {
			el.style.translate = pos.x || pos.y ? `${pos.x}px ${pos.y}px` : '';
			el.classList.toggle('fxf-collapsed', !!pos.c);
			toggle.setAttribute('aria-expanded', String(!pos.c));
		};
		apply();
		toggle.addEventListener('click', () => {
			pos.c = !pos.c;
			apply();
			save();
		});
		bar.addEventListener('dblclick', (e) => {
			if (e.target.closest('.fxf-toggle')) return;
			pos.x = pos.y = 0;
			apply();
			save();
		});
		grip.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			grip.setPointerCapture(e.pointerId);
			const sx = e.clientX - pos.x;
			const sy = e.clientY - pos.y;
			el.classList.add('fxf-dragging');
			const move = (ev) => {
				pos.x = ev.clientX - sx;
				pos.y = ev.clientY - sy;
				// панель не должна уезжать за край целиком: ручка всегда остаётся в окне
				el.style.translate = `${pos.x}px ${pos.y}px`;
				const r = el.getBoundingClientRect();
				const w = ws.getBoundingClientRect();
				if (r.right < w.left + 80) pos.x += w.left + 80 - r.right;
				if (r.left > w.right - 80) pos.x -= r.left - (w.right - 80);
				if (r.top < w.top) pos.y += w.top - r.top;
				if (r.top > w.bottom - 44) pos.y -= r.top - (w.bottom - 44);
				el.style.translate = `${pos.x}px ${pos.y}px`;
			};
			const up = () => {
				grip.removeEventListener('pointermove', move);
				grip.removeEventListener('pointerup', up);
				grip.removeEventListener('pointercancel', up);
				el.classList.remove('fxf-dragging');
				save();
			};
			grip.addEventListener('pointermove', move);
			grip.addEventListener('pointerup', up);
			grip.addEventListener('pointercancel', up);
		});
	}
}
