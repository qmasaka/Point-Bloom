// Панель «Медиа»: фото и видео в точки, запись точечного ролика, сохранение.
// Одна и та же панель живёт во вкладке редактора и в режиме «Эффекты» (fx: true).
import { h, formatInt } from './util.js';
import { section, field, slider, segmented, switchRow, button } from './ui-kit.js';

export function createMediaPanel(app, root, { fx = false } = {}) {
	const mc = app.media;
	const pm = mc.pm;
	const md = app.settings.media;
	const save = () => app.saveSettings();
	const eng = () => app.ui.effectsEngine;

	const fileIn = h('input', { type: 'file', accept: 'image/*,video/*,.pcv', hidden: true });
	fileIn.addEventListener('change', async () => {
		const f = fileIn.files[0];
		fileIn.value = '';
		if (!f) return;
		app.ui.busy('Читаю файл', 0.3);
		try {
			await mc.load(f);
			if (fx) await eng().useMedia();
		} catch (e) {
			app.toast(e.message || 'Не удалось открыть файл', 'error');
		} finally {
			app.ui.idle();
		}
	});
	const load = button({ label: 'Открыть фото или видео…', icon: 'film-strip', variant: 'primary', cls: 'btn-block', title: 'Фото, видео или сохранённый ролик .pcv', onClick: () => fileIn.click() });
	const info = h('div', { class: 'field-hint' });
	const pts = slider({ log: true, min: 10000, max: 300000, step: 5000, value: md.pts, format: (v) => formatInt(v), onInput: (v) => { md.pts = v; }, onChange: async (v) => { if (fx) await eng().setMediaPts(v); else mc.setPts(v); } });
	const relief = segmented({ cls: 'seg-tight', options: [{ value: 'none', label: 'Плоско' }, { value: 'bright', label: 'Светлое выше' }, { value: 'dark', label: 'Тёмное выше' }], value: md.relief, onChange: (v) => { md.relief = v; mc.styleChanged(); } });
	const depth = slider({ min: 0, max: 1.5, step: 0.05, value: md.depth, digits: 2, onInput: (v) => { md.depth = v; mc.styleChanged(); }, onChange: save });
	const view = segmented({ options: [{ value: 'live', label: 'Исходник' }, { value: 'rec', label: 'Точечный ролик' }], value: pm.view, onChange: async (v) => { pm.setView(v); if (fx) await eng().setSource('media'); else mc.rebuild({ frame: false }); sync(); } });
	const play = button({ label: 'Пауза', icon: 'pause', variant: 'secondary', onClick: () => { pm.playing ? pm.pause() : pm.play(); sync(); } });
	const loop = switchRow('Повторять', { value: pm.loop, onChange: (v) => pm.setLoop(v) });
	const seek = slider({ min: 0, max: 1, step: 0.01, value: 0, digits: 1, unit: ' с', onInput: (v) => pm.seek(v), onChange: () => {} });
	const recFps = slider({ min: 5, max: 30, step: 1, value: 15, digits: 0, unit: ' к/с' });
	const recSec = slider({ min: 1, max: 30, step: 1, value: 10, digits: 0, unit: ' с' });
	const recBtn = button({ label: 'Записать в точки', icon: 'record', variant: 'primary', cls: 'btn-block', title: 'Видео проигрывается кадр за кадром и записывается как точечный ролик', onClick: () => mc.record({ fps: recFps.get(), seconds: recSec.get() }) });
	const recInfo = h('div', { class: 'field-hint' });
	const bScene = button({ label: 'Кадр в сцену (копия)', icon: 'cube', variant: 'secondary', cls: 'btn-block', title: 'Замороженный кадр отдельным облаком точек', onClick: () => mc.snapshot() });
	const bPly = button({ label: 'Текущий кадр (.ply)', icon: 'download-simple', variant: 'secondary', cls: 'btn-block', onClick: () => mc.downloadPLY() });
	const bPcv = button({ label: 'Сохранить ролик (.pcv)', icon: 'download-simple', variant: 'secondary', cls: 'btn-block', title: 'Компактный файл: его можно снова открыть здесь', onClick: () => mc.downloadPCV() });
	const bZip = button({ label: 'Кадры PLY (.zip)', icon: 'download-simple', variant: 'secondary', cls: 'btn-block', title: 'Каждый кадр как облако точек с цветом', onClick: () => mc.downloadPLYZip() });
	const closeBtn = button({ label: 'Убрать медиа', icon: 'x', variant: 'ghost', cls: 'btn-block', onClick: () => mc.close() });
	const note = h('div', { class: 'field-hint' }, fx ? 'Видео продолжает играть и в эффектах: все эффекты применяются к его точкам.' : 'Облако точек лежит в сцене: его можно двигать, менять вид на вкладке «Точки» и скачивать кнопкой «Скачать» вверху.');
	const videoBox = h('div', { class: 'sec-body', style: { padding: 0 } }, h('div', { class: 'fx-btn-row' }, play), loop.el, field('Время', seek.el));
	const recBox = h('div', { class: 'sec-body', style: { padding: 0 } }, h('div', { class: 'fx-sub' }, 'Запись в точки'), field('Кадров в секунду', recFps.el), field('Не длиннее', recSec.el), recBtn, recInfo);
	const saveBox = h('div', { class: 'fx-save-row' }, fx ? bScene : '', bPly, bPcv, bZip);
	const ptsRow = field('Точек', pts.el);
	const sec = section(fx ? 'Фото и видео' : 'Фото и видео в точки', { key: fx ? 'fx-media' : 'ed-media' }, fileIn, load, info, ptsRow, field('Рельеф', relief.el, { wide: true }), field('Глубина рельефа', depth.el), field('Показывать', view.el, { wide: true }), videoBox, recBox, h('div', { class: 'fx-sub' }, 'Сохранить'), saveBox, closeBtn, note);
	if (root) root.append(sec.el);

	function sync() {
		const ready = pm.ready;
		if (fx) sec.el.hidden = !ready;
		const hasRec = !!pm.rec;
		info.textContent = ready ? `${pm.name}: ${formatInt(pm.count)} точек${pm.kind === 'video' ? ', видео' : pm.kind === 'rec' ? ', точечный ролик' : ', фото'}` : 'Откройте фото или видео: каждая точка возьмёт цвет пикселя. Видео можно записать в точечный ролик и сохранить.';
		view.el.hidden = !hasRec || pm.kind === 'rec';
		view.set(pm.view);
		ptsRow.hidden = !ready || pm.isRec;
		pts.set(md.pts);
		relief.set(md.relief);
		depth.set(md.depth);
		const vid = pm.kind === 'video' || pm.kind === 'rec';
		videoBox.hidden = !vid;
		recBox.hidden = pm.kind !== 'video';
		play.querySelector('.btn-label').textContent = pm.playing ? 'Пауза' : 'Играть';
		seek.setRange(0, Math.max(0.1, pm.duration));
		recSec.setRange(1, Math.max(2, Math.min(30, Math.floor(pm.duration) || 10)));
		const prog = mc.progress;
		recBtn.querySelector('.btn-label').textContent = pm.recording ? 'Остановить запись' : 'Записать в точки';
		recInfo.textContent = prog ? `Записываю кадр ${prog.i} из ${prog.total}…` : hasRec ? `Записано кадров: ${pm.rec.frames.length}, ${pm.rec.fps} к/с` : 'Видео проигрывается кадр за кадром. Потом ролик можно сохранить и снова открыть.';
		saveBox.hidden = !ready;
		bPcv.hidden = !hasRec;
		bZip.hidden = !hasRec;
	}
	app.bus.on('media', sync);
	if (fx) app.bus.on('fx', sync);
	setInterval(() => {
		if ((pm.kind === 'video' || pm.kind === 'rec') && sec.el.offsetParent && !pm.recording && document.activeElement?.closest?.('.slider') == null) seek.set(pm.time);
	}, 300);
	sync();
	return { section: sec, sync };
}
