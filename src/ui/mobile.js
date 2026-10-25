// Телефоны и планшеты: панель настроек становится нижним листом, который тянется вверх и вниз, а сцена остаётся сверху.
// На широких экранах модуль ничего не делает (стили работают только до 900 px).
const MIN = 98; // ручка и вкладки целиком: отступ снизу 8, рамка, ручка 30 и ряд вкладок 58

export function initMobile(app) {
	const root = document.getElementById('app');
	const ws = document.querySelector('.workspace');
	const sidebar = document.getElementById('sidebar');
	const fxLeft = document.getElementById('fxLeft');
	const mq = window.matchMedia('(max-width: 900px)');
	let state = 'min';

	const vh = () => (window.visualViewport ? window.visualViewport.height : window.innerHeight);
	// в альбомной ориентации телефона высоты мало: лист ниже и выше открывается почти на весь экран.
	// В книжной над раскрытым листом остаётся место под верхнюю панель и нижнюю плашку режимов, чтобы они не наезжали друг на друга
	const heights = () => (vh() < 520 ? { min: MIN, mid: Math.round(vh() * 0.58), full: Math.round(vh() - 56) } : { min: MIN, mid: Math.round(vh() * 0.46), full: Math.round(vh() - 124) });
	const setH = (px) => root.style.setProperty('--sheet-h', Math.round(px) + 'px');
	function setState(s) {
		state = s;
		root.dataset.sheet = s;
		setH(heights()[s]);
		setTimeout(() => app.viewport.resize(), 320);
	}

	function makeHandle() {
		const hd = document.createElement('div');
		hd.className = 'sheet-handle';
		const tr = (k) => (window.__i18n && window.__i18n.tr ? window.__i18n.tr(k) : k);
		hd.innerHTML = `<span class="sheet-grab" aria-hidden="true"></span><div class="sheet-switch" role="tablist"><button type="button" role="tab" data-ms="list" aria-selected="true">${tr('Эффекты')}</button><button type="button" role="tab" data-ms="settings" aria-selected="false">${tr('Настройки')}</button></div>`;
		let sy = 0, sh = 0, moved = false, drag = false;
		hd.addEventListener('pointerdown', (e) => {
			if (e.target.closest('.sheet-switch')) return;
			drag = true;
			moved = false;
			sy = e.clientY;
			sh = parseFloat(getComputedStyle(root).getPropertyValue('--sheet-h')) || heights()[state];
			hd.setPointerCapture(e.pointerId);
			ws.classList.add('dragging');
		});
		hd.addEventListener('pointermove', (e) => {
			if (!drag) return;
			const dy = sy - e.clientY;
			if (Math.abs(dy) > 5) moved = true;
			const H = heights();
			setH(Math.max(H.min, Math.min(H.full, sh + dy)));
		});
		const end = (e) => {
			if (!drag) return;
			drag = false;
			ws.classList.remove('dragging');
			const H = heights();
			if (!moved) return setState(state === 'min' ? 'mid' : state === 'mid' ? 'full' : 'min');
			const cur = parseFloat(getComputedStyle(root).getPropertyValue('--sheet-h'));
			// ближайшее из трёх положений
			setState(Object.entries(H).sort((a, b) => Math.abs(a[1] - cur) - Math.abs(b[1] - cur))[0][0]);
		};
		hd.addEventListener('pointerup', end);
		hd.addEventListener('pointercancel', end);
		hd.querySelectorAll('[data-ms]').forEach((b) =>
			b.addEventListener('click', () => {
				setMsheet(b.dataset.ms);
				if (state === 'min') setState('mid');
			})
		);
		return hd;
	}
	const hS = makeHandle();
	const hF = makeHandle();
	sidebar.insertBefore(hS, sidebar.querySelector('.tabs'));
	fxLeft.insertBefore(hF, fxLeft.firstChild);

	function updateHandleLabels() {
		const tr = (k) => (window.__i18n && window.__i18n.tr ? window.__i18n.tr(k) : k);
		document.querySelectorAll('.sheet-switch button[data-ms="list"]').forEach((b) => (b.textContent = tr('Эффекты')));
		document.querySelectorAll('.sheet-switch button[data-ms="settings"]').forEach((b) => (b.textContent = tr('Настройки')));
	}
	window.addEventListener('langchange', updateHandleLabels);

	function setMsheet(v) {
		root.dataset.msheet = v;
		document.querySelectorAll('.sheet-switch button').forEach((b) => {
			const on = b.dataset.ms === v;
			b.classList.toggle('is-on', on);
			b.setAttribute('aria-selected', String(on));
		});
	}
	setMsheet('list');

	// выбор вкладки раскрывает свёрнутый лист; выбор эффекта в списке переключает на его настройки
	sidebar.addEventListener('click', (e) => {
		if (!mq.matches) return;
		if (e.target.closest('.tab, .fx-tab, .fx-tabs .tab') && state === 'min') setState('mid');
	});
	fxLeft.addEventListener('click', (e) => {
		if (!mq.matches || e.target.closest('.sheet-handle')) return;
		if (e.target.closest('.fx-layer-head') && !e.target.closest('.switch')) {
			setMsheet('settings');
			if (state === 'min') setState('mid');
		}
	});

	// режим эффектов: список эффектов первым, редактор: лист свёрнут, пока не откроете вкладку
	let wasFx = root.classList.contains('fx-mode');
	new MutationObserver(() => {
		const fx = root.classList.contains('fx-mode');
		if (fx === wasFx) return;
		wasFx = fx;
		if (!mq.matches) return;
		if (fx) {
			setMsheet('list');
			setState('mid');
		} else setState('min');
	}).observe(root, { attributes: true, attributeFilter: ['class'] });

	function apply() {
		root.classList.toggle('is-mobile', mq.matches);
		if (mq.matches) setState(state);
		else {
			root.style.removeProperty('--sheet-h');
			delete root.dataset.sheet;
			setTimeout(() => app.viewport.resize(), 50);
		}
	}
	mq.addEventListener('change', apply);
	window.visualViewport?.addEventListener('resize', () => mq.matches && !ws.classList.contains('dragging') && setH(heights()[state]));
	apply();
}
