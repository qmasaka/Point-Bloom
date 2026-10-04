import { h, formatBytes, formatInt, downloadBlob } from './util.js';
import { icon } from './icons.js';
import { section, field, segmented, select, slider, switchRow, numberField, button } from './ui-kit.js';
import { EXPORT_FORMATS, exportModel, defaultExportName, estimateExportSize } from './exporters.js';
import { exportForWeb } from './web-export.js';
import { getDevice, hintForCount } from './device-card.js';
const SCALE_PRESETS = [
{ label: 'Как есть', v: 1, tip: 'Масштаб 1' },
{ label: 'мм в м', v: 0.001, tip: 'Миллиметры в метры (×0,001)' },
{ label: 'см в м', v: 0.01, tip: 'Сантиметры в метры (×0,01)' },
{ label: 'дюймы в м', v: 0.0254, tip: 'Дюймы в метры (×0,0254)' },
{ label: 'м в мм', v: 1000, tip: 'Метры в миллиметры (×1000)' },
];
export function createExportPanel(app, root) {
const s = app.settings.exportOpts;
const w = s.web;
const save = () => app.saveSettings();
let last = null;
let running = false;
const fmtInfo = () => EXPORT_FORMATS.find((f) => f.id === s.format) || EXPORT_FORMATS[0];
const touch = () => {
save();
updateEstimate();
};
const fmtDesc = h('div', { class: 'fmt-desc' });
const ext = h('span', { class: 'ext' });
const nameInput = h('input', { type: 'text', spellcheck: 'false', 'aria-label': 'Имя файла', placeholder: 'model' });
nameInput.addEventListener('input', () => {
s.name = nameInput.value;
});
nameInput.addEventListener('keydown', (e) => {
e.stopPropagation();
if (e.key === 'Enter') run();
});
const fmt = segmented({
options: EXPORT_FORMATS.map((f) => ({ value: f.id, label: f.label, title: f.title })),
value: s.format,
cls: 'fmt',
label: 'Формат',
onChange: (v) => {
s.format = v;
touch();
syncFormat();
},
});
const PRESETS = [
{ label: 'Для сайта', icon: 'globe', tip: 'Страница с моделью и код для вставки, облегчённые текстуры', set: { format: 'web', cloud: 'mesh' }, web: { optimize: true } },
{ label: 'AR на iPhone', icon: 'device-mobile', tip: 'USDZ для просмотра в комнате через камеру', set: { format: 'usdz', cloud: 'mesh', maxTex: 2048 } },
{ label: 'Для игры', icon: 'cube', tip: 'GLB для Unity, Unreal, Godot, Three.js: склейка вершин, модель на полу', set: { format: 'glb', cloud: 'mesh', weld: true, texFormat: 'auto', maxTex: 0, place: 'floor' } },
{ label: 'Для печати', icon: 'ruler', tip: 'STL: только геометрия. Проверьте масштаб в миллиметрах', set: { format: 'stl', cloud: 'mesh', place: 'floor' } },
];
const presetRow = h('div', { class: 'chip-row' });
for (const pr of PRESETS) {
const b = h('button', { type: 'button', class: 'chip-btn', 'data-tip': pr.tip, onclick: () => applyPreset(pr) }, h('span', { class: 'ic-wrap', html: icon(pr.icon, 14) }), pr.label);
presetRow.append(b);
}
const secFormat = section('Формат', { key: 'e-format' }, field('Быстрый выбор', presetRow, { wide: true }), fmt.el, fmtDesc, field('Имя файла', h('div', { class: 'name-field' }, nameInput, ext), { wide: true }));
const webTitle = h('input', { type: 'text', class: 'num-in', style: { textAlign: 'left', fontFamily: 'var(--font)', fontSize: '13px', height: '32px' }, spellcheck: 'false', placeholder: 'Название страницы', 'aria-label': 'Название страницы' });
webTitle.value = w.title || '';
webTitle.addEventListener('input', () => {
w.title = webTitle.value;
save();
});
webTitle.addEventListener('keydown', (e) => e.stopPropagation());
const webBg = segmented({ options: [{ value: 'dark', label: 'Тёмный' }, { value: 'light', label: 'Светлый' }, { value: 'transparent', label: 'Прозрачный' }], value: w.bg, onChange: (v) => { w.bg = v; save(); } });
const webRotate = switchRow('Автовращение', { value: w.autoRotate, onChange: (v) => { w.autoRotate = v; save(); } });
const webAR = switchRow('Кнопка AR на телефоне', { value: w.ar, onChange: (v) => { w.ar = v; save(); } }, 'Модель в комнате через камеру');
const webUSDZ = switchRow('Добавить USDZ для iPhone', { value: w.usdz, onChange: (v) => { w.usdz = v; save(); } }, 'Нужен для AR на iPhone');
const webOpt = switchRow('Облегчить для сайта', { value: w.optimize, onChange: (v) => { w.optimize = v; touch(); } }, 'Текстуры до 2048 px, быстрая загрузка');
const webMode = segmented({ options: [{ value: 'zip', label: 'ZIP с файлами' }, { value: 'single', label: 'Один HTML' }], value: w.single ? 'single' : 'zip', onChange: (v) => { w.single = v === 'single'; save(); syncFormat(); } });
const webModeHint = h('div', { class: 'field-hint' });
const secWeb = section(
'Страница для сайта',
{ key: 'e-web' },
field('Название', webTitle, { wide: true }),
field('Фон', webBg.el, { wide: true }),
webRotate.el,
webAR.el,
webUSDZ.el,
webOpt.el,
field('Результат', webMode.el, { wide: true }),
webModeHint
);
function syncWebMode() {
webModeHint.textContent = w.single
? 'Один файл, открывается двойным кликом. Тяжелее ZIP.'
: 'Архив для хостинга: страница, модель, постер и код для вставки.';
webUSDZ.el.hidden = !!w.single;
}
const only = segmented({ options: [{ value: 'all', label: 'Вся сцена' }, { value: 'selected', label: 'Выбранное' }], value: s.only, onChange: (v) => { s.only = v; touch(); } });
const scale = numberField({ value: s.scale, step: 0.1, digits: 6, min: 1e-9, onChange: (v) => { s.scale = v; save(); markPresets(); } });
const presets = h('div', { class: 'presets' });
const presetBtns = SCALE_PRESETS.map((p) => {
const b = button({ label: p.label, variant: 'secondary', title: p.tip, onClick: () => {
s.scale = p.v;
scale.set(p.v);
save();
markPresets();
} });
presets.append(b);
return { b, v: p.v };
});
const markPresets = () => presetBtns.forEach(({ b, v }) => b.classList.toggle('is-active', Math.abs(s.scale - v) < 1e-12));
const up = segmented({ options: [{ value: 'y', label: 'Y вверх', title: 'Стандарт glTF, Blender при экспорте, Maya' }, { value: 'z', label: 'Z вверх', title: 'Модель из CAD, 3ds Max, Blender без конвертации осей' }], value: s.up, onChange: (v) => { s.up = v; save(); } });
const place = segmented({ options: [{ value: 'keep', label: 'Как есть' }, { value: 'center', label: 'В центр' }, { value: 'floor', label: 'На пол' }], value: s.place, onChange: (v) => { s.place = v; save(); } });
const secWhat = section(
'Преобразование',
{ key: 'e-what' },
field('Объекты', only.el),
field('Масштаб', h('div', {}, scale.el, presets), { hint: 'glTF работает в метрах' }),
field('Ось «вверх»', up.el),
field('Положение', place.el, {})
);
const weld = switchRow('Склеить одинаковые вершины', { value: s.weld, onChange: (v) => { s.weld = v; touch(); } }, 'Файл меньше в 2-3 раза');
const texFmt = segmented({ options: [{ value: 'auto', label: 'Как у файла' }, { value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }], value: s.texFormat, onChange: (v) => { s.texFormat = v; touch(); } });
const maxTex = select({
options: [
{ value: 0, label: 'Без ограничения' },
{ value: 4096, label: 'до 4096 px' },
{ value: 2048, label: 'до 2048 px' },
{ value: 1024, label: 'до 1024 px' },
{ value: 512, label: 'до 512 px' },
],
value: s.maxTex,
onChange: (v) => { s.maxTex = parseInt(v, 10); touch(); },
});
const rowTexFmt = field('Формат текстур', texFmt.el, { hint: 'JPEG легче, но без прозрачности' });
const rowMaxTex = field('Размер текстур', maxTex.el);
const secData = section('Данные', { key: 'e-data' }, weld.el, rowTexFmt, rowMaxTex);
const dev = getDevice(app);
s.cloudCount = Math.min(s.cloudCount, Math.max(100000, dev.limits.cap));
const cloud = segmented({ options: [{ value: 'mesh', label: 'Меш' }, { value: 'vertices', label: 'Вершины' }, { value: 'surface', label: 'Поверхность' }], value: s.cloud, onChange: (v) => { s.cloud = v; touch(); syncFormat(); } });
const cloudHint = h('div', { class: 'field-hint hint' });
const showCloudHint = () => {
const hh = hintForCount(app, s.cloudCount);
cloudHint.className = 'field-hint hint hint-' + hh.level;
cloudHint.textContent = hh.text;
};
const cloudCount = slider({ log: true, min: 10000, max: Math.max(100000, dev.limits.cap), step: 10000, value: s.cloudCount, format: (v) => formatInt(v), onInput: (v) => { s.cloudCount = v; showCloudHint(); }, onChange: touch });
const rowCloudCount = field('Точек', cloudCount.el);
app.bus.on('device', () => {
const cap = Math.max(100000, getDevice(app).limits.cap);
cloudCount.setRange(10000, cap);
s.cloudCount = Math.min(s.cloudCount, cap);
cloudCount.set(s.cloudCount);
showCloudHint();
});
const cloudExtra = h('div', { class: 'sec-body', style: { padding: 0 } }, rowCloudCount, cloudHint);
const secCloud = section('Облако точек', { key: 'e-cloud', open: false }, field('Экспортировать как', cloud.el), cloudExtra);
const resultBox = h('div');
const estimate = h('div', { class: 'estimate' });
const cta = h('div', { class: 'export-cta' });
const goBtn = button({ label: 'Скачать GLB', icon: 'download-simple', variant: 'primary', cls: 'btn-lg btn-block', onClick: () => run() });
cta.append(estimate, goBtn);
root.append(h('div', { class: 'result-slot' }, resultBox), secFormat.el, secWeb.el, secWhat.el, secData.el, secCloud.el, cta);
function updateEstimate() {
const f = fmtInfo();
if (!['glb', 'gltf', 'usdz', 'web'].includes(f.id) || !app.viewport.root.children.some((c) => !c.userData.helper)) {
estimate.textContent = '';
return;
}
const web = f.id === 'web';
let bytes = estimateExportSize(app, { ...s, cloud: web ? 'mesh' : s.cloud, texFormat: web && w.optimize ? 'jpeg' : s.texFormat, maxTex: web && w.optimize ? Math.min(s.maxTex || 2048, 2048) : s.maxTex });
if (f.id === 'gltf') bytes *= 1.34;
estimate.textContent = `Примерный размер файла: около ${formatBytes(bytes)}`;
}
function applyPreset(pr) {
Object.assign(s, pr.set);
if (pr.web) Object.assign(w, pr.web);
fmt.set(s.format);
weld.set(s.weld);
texFmt.set(s.texFormat);
maxTex.set(s.maxTex);
place.set(s.place);
cloud.set(s.cloud);
webOpt.set(w.optimize);
touch();
syncFormat();
app.toast('Выбрано: ' + pr.label, 'info', 1600);
}
function syncFormat() {
const f = fmtInfo();
fmtDesc.innerHTML = `<b>${f.title}.</b> ${f.hint}`;
ext.textContent = '.' + f.ext;
fmt.set(s.format);
const label = f.id === 'obj' ? 'Скачать OBJ + MTL (ZIP)' : f.id === 'web' ? (w.single ? 'Скачать HTML для сайта' : 'Скачать ZIP для сайта') : `Скачать ${f.label}`;
goBtn.querySelector('.btn-label').textContent = label;
app.ui.setExportLabel(f.id === 'obj' ? 'Скачать OBJ' : f.id === 'web' ? 'Скачать для сайта' : `Скачать ${f.label}`);
rowTexFmt.hidden = !(f.id === 'glb' || f.id === 'gltf' || f.id === 'web');
rowMaxTex.hidden = !(f.id === 'glb' || f.id === 'gltf' || f.id === 'usdz' || f.id === 'web');
secWeb.el.hidden = f.id !== 'web';
secCloud.el.hidden = f.id === 'stl' || f.id === 'usdz' || f.id === 'web';
cloudExtra.hidden = s.cloud !== 'surface';
nameInput.placeholder = defaultExportName(app);
webTitle.placeholder = defaultExportName(app);
syncWebMode();
updateEstimate();
}
function syncSelection() {
const has = !!app.model.selected;
if (!has && s.only === 'selected') s.only = 'all';
only.set(s.only);
only.el.querySelectorAll('.seg-btn')[1].disabled = !has;
nameInput.placeholder = defaultExportName(app);
webTitle.placeholder = defaultExportName(app);
updateEstimate();
}
app.bus.on('selection', syncSelection);
app.bus.on('scene', () => {
nameInput.placeholder = defaultExportName(app);
webTitle.placeholder = defaultExportName(app);
updateEstimate();
});
app.bus.on('geometry', updateEstimate);
s.name = '';
nameInput.value = '';
app.bus.on('newdoc', () => {
s.name = '';
nameInput.value = '';
last = null;
resultBox.textContent = '';
});
scale.set(s.scale);
markPresets();
showCloudHint();
syncFormat();
syncSelection();
const copy = async (text) => {
try {
await navigator.clipboard.writeText(text);
app.toast('Код скопирован в буфер обмена', 'ok', 2200);
} catch (e) {
app.toast('Не удалось скопировать автоматически, выделите код вручную', 'warn');
}
};
function showResult(r) {
const i = r.info;
const v = i.verify;
const ok = !v || v.ok;
resultBox.textContent = '';
const head = h('div', { class: 'result-head ' + (ok ? 'ok' : 'bad'), html: icon(ok ? 'check-circle' : 'warning-circle', 20) }, h('span', {}, ok ? `Готово: ${r.filename}` : `Файл создан с замечаниями: ${r.filename}`));
const grid = h(
'dl',
{ class: 'result-grid' },
...[
['Размер файла', formatBytes(i.bytes)],
['Время', i.ms < 1000 ? i.ms + ' мс' : (i.ms / 1000).toFixed(1) + ' с'],
['Треугольников', formatInt(i.tris)],
['Вершин', formatInt(i.points || i.verts)],
['Текстур', String(i.textures)],
['Объектов', String(i.meshes)],
].map(([a, b]) => h('div', {}, h('dt', {}, a), h('dd', {}, b)))
);
const box = h('div', { class: 'result' }, head, grid);
if (v) {
if (v.ok) box.append(h('div', { class: 'result-note' }, 'Проверка пройдена: структура GLB корректна, файл открывается загрузчиком glTF.'));
else box.append(h('ul', {}, ...v.problems.map((p) => h('li', {}, p))));
}
if (r.extra) {
if (r.extra.files && r.extra.files.length > 1) {
box.append(h('div', { class: 'result-files' }, ...r.extra.files.map((f) => h('div', {}, h('span', {}, f.name), h('b', {}, formatBytes(f.size))))));
}
if (!r.extra.single) {
const ta = h('textarea', { class: 'code-box', readonly: true, rows: 6, spellcheck: 'false', 'aria-label': 'Код для вставки на сайт' });
ta.value = r.extra.snippet;
ta.addEventListener('focus', () => ta.select());
box.append(h('div', { class: 'result-note' }, 'Код для вставки на готовую страницу (рядом должны лежать model.glb и постер):'), ta, button({ label: 'Скопировать код', icon: 'copy-simple', variant: 'secondary', cls: 'btn-sm', onClick: () => copy(r.extra.snippet) }));
}
for (const wmsg of r.extra.warnings || []) box.append(h('div', { class: 'result-note warn-note' }, wmsg));
}
box.append(button({ label: 'Скачать ещё раз', icon: 'download-simple', variant: 'secondary', cls: 'btn-sm', onClick: () => last && downloadBlob(last.blob, last.filename) }));
resultBox.append(box);
root.scrollTo({ top: 0, behavior: 'smooth' });
}
async function run() {
if (running) return;
running = true;
const o = { ...s, name: nameInput.value.trim() };
if (o.only === 'selected' && !app.model.selected) o.only = 'all';
try {
app.ui.busy('Готовлю экспорт', 0.02);
const progress = (t, p) => app.ui.busy(t, p);
const r = o.format === 'web' ? await exportForWeb(app, o, progress) : await exportModel(app, o, progress);
last = r;
downloadBlob(r.blob, r.filename);
showResult(r);
app.toast(`Скачан файл ${r.filename} (${formatBytes(r.info.bytes)})`, 'ok');
} catch (e) {
console.error(e);
resultBox.textContent = '';
resultBox.append(h('div', { class: 'result' }, h('div', { class: 'result-head bad', html: icon('warning-circle', 20) }, h('span', {}, 'Не удалось экспортировать')), h('div', { class: 'result-note' }, e.message || String(e))));
app.toast('Экспорт не удался: ' + (e.message || e), 'error');
} finally {
running = false;
app.ui.idle();
}
}
return { run };
}
