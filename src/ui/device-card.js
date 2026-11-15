import { h } from '../core/util.js';
import { icon } from './icons.js';
import { button } from './ui-kit.js';
import { deviceInfo, guessLimits, loadCachedBench, runBenchmark, formatCount, pointMemoryMB } from '../core/capabilities.js';

export function getDevice(app) {
	if (!app.device) {
		const info = deviceInfo(app);
		app.device = { info, limits: loadCachedBench(info) || guessLimits(info), running: false };
	}
	return app.device;
}

export function hintForCount(app, n) {
	const { limits } = getDevice(app);
	const mem = Math.round(pointMemoryMB(n));
	const memTxt = mem >= 1024 ? (mem / 1024).toFixed(1) + ' ГБ' : mem + ' МБ';
	let time = '';
	if (limits.cpuPtsPerSec) {
		const sec = n / limits.cpuPtsPerSec;
		time = sec < 1 ? ' Создание займёт меньше секунды.' : ` Создание займёт около ${Math.round(sec)} с.`;
	}
	if (n <= limits.comfort) return { level: 'ok', text: `Комфортно для вашего компьютера. Нужно около ${memTxt} памяти.${time}` };
	if (n <= limits.max) return { level: 'warn', text: `Тяжеловато: просмотр может идти рывками. Нужно около ${memTxt} памяти.${time}` };
	if (n <= limits.cap) return { level: 'warn', text: `На пределе возможностей: возможны подвисания. Нужно около ${memTxt} памяти.${time}` };
	return { level: 'bad', text: `Больше безопасного лимита по памяти (${formatCount(limits.cap)}). Вкладка может не выдержать.` };
}

export function createDeviceCard(app, { onPick, compact = false } = {}) {
	const dev = getDevice(app);
	const el = h('div', { class: 'device-card' });
	const render = () => {
		const { info, limits } = dev;
		el.textContent = '';
		const mem = info.memGB ? (info.memGB >= 8 ? '8 ГБ или больше' : info.memGB + ' ГБ') : 'не сообщается браузером';
		const measureBtn = button({
			label: limits.measured ? 'Заново' : 'Измерить',
			icon: 'gauge',
			variant: 'secondary',
			cls: 'btn-sm',
			title: 'Займёт пару секунд: рисуем миллион точек и считаем скорость',
			onClick: async () => {
				if (dev.running) return;
				dev.running = true;
				try {
					const res = await runBenchmark(app, (t, p) => app.ui.busy(t, p));
					dev.limits = res;
					app.toast(`Замер готов: комфортно до ${formatCount(res.comfort)} точек`, 'ok');
				} catch (e) {
					console.error(e);
					app.toast('Не удалось выполнить замер: ' + e.message, 'error');
				} finally {
					dev.running = false;
					app.ui.idle();
					app.viewport.invalidate();
					app.bus.emit('device');
				}
			},
		});
		const rows = [
			['Видеокарта', info.gpu],
			['Память', mem],
			['Ядра процессора', info.cores ? String(info.cores) : 'неизвестно'],
		];
		const kids = [
			h('div', { class: 'device-head' }, h('span', { class: 'device-title', html: icon('monitor', 16) }, h('b', {}, 'Ваш компьютер')), measureBtn),
			compact ? null : h('dl', { class: 'device-meta' }, ...rows.map(([a, b]) => h('div', {}, h('dt', {}, a), h('dd', {}, b)))),
			compact ? null : h(
				'div',
				{ class: 'device-limits' },
				h('div', {}, h('span', {}, 'Комфортно'), h('b', {}, 'до ' + formatCount(limits.comfort))),
				h('div', {}, h('span', {}, 'Максимум'), h('b', {}, 'до ' + formatCount(limits.max))),
				h('div', {}, h('span', {}, 'Предел'), h('b', {}, formatCount(limits.cap)))
			),
			compact
				? h('div', { class: 'device-note' }, (limits.measured ? 'Замер: ' : 'Оценка: ') + info.gpu)
				: h('div', { class: 'device-note' }, limits.measured ? 'Это результат замера на вашем компьютере.' : 'Пока это оценка по типу устройства. Нажмите «Измерить», чтобы узнать точнее.')
		];
		el.append(...kids.filter(Boolean));
		if (onPick) {
			const chip = (label, n) => h('button', { type: 'button', class: 'chip-btn', onclick: () => onPick(n) }, label, h('b', {}, formatCount(n)));
			el.append(h('div', { class: 'chip-row' }, chip('Лёгкое', Math.min(200000, limits.comfort)), chip('Комфортное', limits.comfort), chip('Максимум', limits.max)));
		}
	};
	render();
	app.bus.on('device', render);
	return el;
}
