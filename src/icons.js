// Иконки Phosphor (MIT), встроенные при сборке. Одно семейство, одна толщина.
import { ICON_PATHS, loadIcons } from './icons.generated.js';

/** Промис готовности иконок: в офлайн-версии они встроены, в веб-версии подгружаются с CDN */
export const iconsReady = loadIcons();

export function icon(name, size = 18) {
	const p = ICON_PATHS[name];
	if (!p) {
		console.warn('Нет иконки:', name);
		return '';
	}
	return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">${p}</svg>`;
}

/** Подставляет иконки в элементы с data-icon="имя" (и необязательным data-icon-size) */
export function hydrateIcons(root = document) {
	root.querySelectorAll('[data-icon]').forEach((el) => {
		if (el.dataset.iconDone) return;
		const size = parseInt(el.dataset.iconSize || '18', 10);
		el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, size));
		el.dataset.iconDone = '1';
	});
}
