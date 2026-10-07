import { exportModel, makeZip, defaultExportName } from './exporters.js';
import { safeName } from './util.js';
export const MODEL_VIEWER_URL = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js';
const BG = { dark: '#16181d', light: '#f1f2f4', transparent: 'transparent' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function embedSnippet({ glb = 'model.glb', usdz = null, poster = 'poster.jpg', title = '3D-модель', autoRotate = true, ar = true, height = '480px' }) {
const attrs = [
`src="${glb}"`,
poster ? `poster="${poster}"` : '',
`alt="${esc(title)}"`,
'camera-controls',
'touch-action="pan-y"',
autoRotate ? 'auto-rotate' : '',
'shadow-intensity="1"',
'environment-image="neutral"',
ar ? 'ar ar-modes="webxr scene-viewer quick-look"' : '',
ar && usdz ? `ios-src="${usdz}"` : '',
`style="width:100%;height:${height}"`,
].filter(Boolean);
return `<script type="module" src="${MODEL_VIEWER_URL}"></script>\n<model-viewer ${attrs.join(' ')}></model-viewer>`;
}
function pageHtml({ title, bg, glb, usdz, poster, autoRotate, ar }) {
const attrs = [
`src="${glb}"`,
poster ? `poster="${poster}"` : '',
`alt="${esc(title)}"`,
'camera-controls',
'touch-action="pan-y"',
autoRotate ? 'auto-rotate' : '',
'shadow-intensity="1"',
'environment-image="neutral"',
ar ? 'ar ar-modes="webxr scene-viewer quick-look"' : '',
ar && usdz ? `ios-src="${usdz}"` : '',
].filter(Boolean);
return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<script type="module" src="${MODEL_VIEWER_URL}"></script>
<style>
	html, body { height: 100%; margin: 0; }
	body { background: ${BG[bg] || BG.dark}; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
	model-viewer { display: block; width: 100%; height: 100%; --progress-bar-color: #e58a45; }
</style>
</head>
<body>
<model-viewer ${attrs.join(' ')}></model-viewer>
</body>
</html>
`;
}
function blobToDataURL(blob) {
return new Promise((resolve, reject) => {
const r = new FileReader();
r.onload = () => resolve(r.result);
r.onerror = () => reject(r.error);
r.readAsDataURL(blob);
});
}
async function makePoster(app, bg) {
const vp = app.viewport;
const nav = app.nav;
const r = vp.renderer;
const W = 1200;
const H = 900;
const o = app.settings.overlays;
const keepOverlays = { grid: o.grid, axes: o.axes, bbox: o.bbox };
const helper = vp.tc.getHelper();
const helperVisible = helper.visible;
const saved = { target: nav.target.clone(), yaw: nav.yaw, pitch: nav.pitch, distance: nav.distance, ortho: nav.ortho, ref: nav.refDistance, pr: r.getPixelRatio() };
nav.cancelTween();
o.grid = o.axes = o.bbox = false;
helper.visible = false;
vp.updateSelectionBox();
const out = document.createElement('canvas');
out.width = W;
out.height = H;
const ctx = out.getContext('2d');
try {
r.setPixelRatio(1);
r.setSize(W, H, false);
vp.size = { width: W, height: H };
if (nav.ortho) nav.setOrtho(false);
const box = vp.getBounds(vp.root);
if (!box.isEmpty()) {
nav.frameBox(box, false);
nav.distance *= 0.82;
nav.applyCamera();
}
vp.render();
if (bg !== 'transparent') {
ctx.fillStyle = BG[bg] || BG.dark;
ctx.fillRect(0, 0, W, H);
}
ctx.drawImage(r.domElement, 0, 0, W, H);
} finally {
Object.assign(o, keepOverlays);
helper.visible = helperVisible;
r.setPixelRatio(saved.pr);
nav.target.copy(saved.target);
nav.yaw = saved.yaw;
nav.pitch = saved.pitch;
nav.distance = saved.distance;
nav.refDistance = saved.ref;
nav.setOrtho(saved.ortho);
vp.resize();
vp.updateSelectionBox();
vp.invalidate();
}
if (bg === 'transparent') return { blob: await new Promise((res) => out.toBlob(res, 'image/png')), ext: 'png' };
return { blob: await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.85)), ext: 'jpg' };
}
export async function exportForWeb(app, o, progress) {
const t0 = performance.now();
const w = o.web;
const name = safeName(o.name || defaultExportName(app));
const title = (w.title || '').trim() || name;
const warnings = [];
const glbOpts = {
...o,
format: 'glb',
name: 'model',
cloud: 'mesh',
weld: w.optimize ? true : o.weld,
texFormat: w.optimize ? 'jpeg' : o.texFormat,
maxTex: w.optimize ? (o.maxTex > 0 ? Math.min(o.maxTex, 2048) : 2048) : o.maxTex,
};
progress && progress('Собираю модель', 0.08);
const glb = await exportModel(app, glbOpts, (t, p) => progress && progress(t, 0.08 + p * 0.5));
progress && progress('Делаю постер', 0.65);
const poster = await makePoster(app, w.bg);
let usdz = null;
if (false) {
progress && progress('Готовлю USDZ для iPhone', 0.75);
try {
usdz = await exportModel(app, { ...glbOpts, format: 'usdz' }, () => {});
} catch (e) {
warnings.push('USDZ для iPhone не создан: ' + (e.message || e));
}
}
const posterName = 'poster.' + poster.ext;
const common = { title, bg: w.bg, autoRotate: false, ar: false };
const info = { ...glb.info, format: 'web', glbBytes: glb.info.bytes, usdzBytes: usdz ? usdz.info.bytes : 0, ms: 0 };
let blob, filename, files;
const snippet = embedSnippet({ ...common, glb: 'model.glb', poster: posterName, usdz: usdz ? 'model.usdz' : null });
if (w.single) {
progress && progress('Упаковываю в один файл', 0.85);
if (glb.blob.size > 25 * 1048576) warnings.push('Модель больше 25 МБ: один HTML-файл получится тяжёлым, лучше выбрать ZIP с файлами.');
const glbUrl = await blobToDataURL(glb.blob);
const posterUrl = await blobToDataURL(poster.blob);
const html = pageHtml({ ...common, glb: glbUrl, poster: posterUrl, usdz: null });
blob = new Blob([html], { type: 'text/html' });
filename = `${name}.html`;
files = [{ name: filename, size: blob.size }];
warnings.push('Один HTML открывается с диска двойным кликом (нужен интернет для библиотеки просмотра). Для встраивания на сайт выберите ZIP.');
} else {
progress && progress('Упаковываю архив', 0.88);
const enc = new TextEncoder();
const index = pageHtml({ ...common, glb: 'model.glb', poster: posterName, usdz: usdz ? 'model.usdz' : null });
const readme = [
'Страница с интерактивной 3D-моделью (создано в «Point Bloom»)',
'',
'Как опубликовать',
'1. Загрузите все файлы из архива в одну папку на вашем хостинге (Vercel, Netlify, GitHub Pages, обычный хостинг).',
'2. Откройте index.html по адресу сайта.',
'Двойной клик по index.html с диска не сработает: браузер не даёт читать модель с локального диска. Для проверки запустите в этой папке команду «python3 -m http.server» и откройте http://localhost:8000',
'',
'Как вставить на готовую страницу',
'Положите model.glb (и poster) рядом со страницей и вставьте этот код туда, где должна быть модель:',
'',
snippet,
'',
].join('\n');
const list = [
{ name: 'index.html', bytes: enc.encode(index) },
{ name: 'model.glb', bytes: new Uint8Array(await glb.blob.arrayBuffer()) },
{ name: posterName, bytes: new Uint8Array(await poster.blob.arrayBuffer()) },
];
if (usdz) list.push({ name: 'model.usdz', bytes: new Uint8Array(await usdz.blob.arrayBuffer()) });
list.push({ name: 'README.txt', bytes: enc.encode(readme) });
blob = makeZip(list);
filename = `${name}-web.zip`;
files = list.map((f) => ({ name: f.name, size: f.bytes.length }));
}
info.bytes = blob.size;
info.ms = Math.round(performance.now() - t0);
return { blob, filename, info, extra: { snippet, files, warnings, single: !!w.single } };
}
