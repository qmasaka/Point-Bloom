// Инвентарь эффектов для переноса на WebGPU: какие значения кадра двигает каждый эффект и сколько строк шейдера ему принадлежит.
// Запуск:  node dev/effects-inventory.mjs > docs/effects-inventory.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E = (p) => pathToFileURL(path.join(ROOT, 'src/effects', p)).href;

// заглушки браузера: core/perf.js читает document и navigator при загрузке
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', platform: '' }, configurable: true });
Object.defineProperty(globalThis, 'document', {
	value: { createElement: () => { throw new Error('нет DOM'); }, documentElement: { classList: { add() {} } } },
	configurable: true,
});

const { FX_LAYERS, FX_GROUP_NAMES } = await import(E('state/layers.js'));
const { vert } = await import(E('shaders/glsl/vert.js'));
const { lineVert } = await import(E('shaders/glsl/line-vert.js'));
const { scopeVert } = await import(E('shaders/glsl/scope-vert.js'));
const { common } = await import(E('shaders/glsl/common.js'));
const { frag } = await import(E('shaders/glsl/frag.js'));
const { lineFrag } = await import(E('shaders/glsl/line-frag.js'));
const { scopeFrag } = await import(E('shaders/glsl/scope-frag.js'));
const { FX_GUARDS, specializeFx } = await import(E('render/webgl/specialize.js'));

const lines = (s) => s.split('\n').length;
const loopSrc = fs.readFileSync(path.join(ROOT, 'src/effects/engine/loop.js'), 'utf8');
const uniSrc = fs.readFileSync(path.join(ROOT, 'src/effects/render/shared/frame-uniforms.js'), 'utf8');

// сколько строк шейдера уходит, если выключить ровно этот эффект (вырезается только его защищённый блок)
const guardSize = (src, key) => {
	const all = new Set(FX_GUARDS.keys());
	const without = new Set(all);
	without.delete(key);
	const full = specializeFx(src, (n, c, t) => (FX_GUARDS.has(n + '.' + c + '>' + t) ? all.has(n + '.' + c + '>' + t) : undefined));
	const cut = specializeFx(src, (n, c, t) => (FX_GUARDS.has(n + '.' + c + '>' + t) ? without.has(n + '.' + c + '>' + t) : undefined));
	return lines(full) - lines(cut);
};

// какие значения кадра пишет движок, когда речь об эффекте L.<id> (эвристика по тексту loop.js: строка со ссылкой на слой и на u.<имя>)
const drives = new Map(); // layerId → Set(uniform)
for (const line of loopSrc.split('\n')) {
	const ids = [...line.matchAll(/\bL\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
	const us = [...line.matchAll(/\bu\.(u[A-Za-z0-9]+)\.value/g)].map((m) => m[1]);
	if (!ids.length || !us.length) continue;
	for (const id of ids) for (const u of us) (drives.get(id) || drives.set(id, new Set()).get(id)).add(u);
}

const uniformNames = [...uniSrc.matchAll(/\b(u[A-Z][A-Za-z0-9]*): U\(/g)].map((m) => m[1]);
const guardsByUniform = new Map();
for (const key of FX_GUARDS.keys()) {
	const u = key.split('.')[0];
	(guardsByUniform.get(u) || guardsByUniform.set(u, []).get(u)).push(key);
}

const out = [];
out.push('# Инвентарь эффектов (для переноса на WebGPU)');
out.push('');
out.push('Сгенерировано `node dev/effects-inventory.mjs`. Не редактировать руками.');
out.push('');
out.push('## Шейдеры (GLSL), строк');
out.push('');
out.push('| Шейдер | Строк | Назначение |');
out.push('|---|---:|---|');
for (const [n, s, d] of [
	['common', common, 'общий код: шум, смещения всех эффектов, зоны, руки, физика'],
	['vert', vert, 'вершинный шейдер точек (подключает common)'],
	['frag', frag, 'фрагментный шейдер точек'],
	['lineVert', lineVert, 'вершинный шейдер линий «Связи»'],
	['lineFrag', lineFrag, 'фрагментный шейдер линий «Связи»'],
	['scopeVert', scopeVert, 'вершинный шейдер линии «Осциллограф»'],
	['scopeFrag', scopeFrag, 'фрагментный шейдер линии «Осциллограф»'],
]) out.push(`| ${n} | ${lines(s)} | ${d} |`);
out.push('');
out.push(`Значений кадра (uniform) всего: **${uniformNames.length}**; условий включения эффекта в шейдере: **${FX_GUARDS.size}**.`);
out.push('');
out.push('## Эффекты');
out.push('');
out.push('«Строк в vert» это размер защищённого блока шейдера, который работает только при включённом эффекте: грубая оценка веса эффекта при переносе. «Значения кадра» определены эвристически по `engine/loop.js` и могут быть неполными.');
out.push('');
out.push('| Группа | Эффект (id) | Название | Строк в vert | Условия включения | Значения кадра (по loop.js) |');
out.push('|---|---|---|---:|---|---|');
const rows = [];
for (const l of FX_LAYERS) {
	const us = [...(drives.get(l.id) || [])].sort();
	const keys = [...new Set(us.flatMap((u) => guardsByUniform.get(u) || []))];
	const size = keys.reduce((a, k) => a + guardSize(vert, k), 0);
	rows.push({ l, us, keys, size });
}
for (const g of FX_GROUP_NAMES) {
	for (const r of rows.filter((x) => x.l.group === g)) {
		out.push(`| ${g} | \`${r.l.id}\` | ${r.l.name || ''} | ${r.size || ''} | ${r.keys.map((k) => '`' + k + '`').join(' ') || ''} | ${r.us.map((u) => '`' + u + '`').join(' ')} |`);
	}
}
const others = rows.filter((x) => !FX_GROUP_NAMES.includes(x.l.group));
for (const r of others) out.push(`| (без группы) | \`${r.l.id}\` | ${r.l.name || ''} | ${r.size || ''} | ${r.keys.map((k) => '`' + k + '`').join(' ')} | ${r.us.map((u) => '`' + u + '`').join(' ')} |`);
out.push('');
out.push('## Все условия включения в шейдере');
out.push('');
out.push('| Условие | Строк в vert | в line | в scope |');
out.push('|---|---:|---:|---:|');
for (const key of [...FX_GUARDS.keys()].sort()) out.push(`| \`${key}\` | ${guardSize(vert, key) || ''} | ${guardSize(lineVert, key) || ''} | ${guardSize(scopeVert, key) || ''} |`);
out.push('');
out.push('## Значения кадра');
out.push('');
out.push(uniformNames.map((n) => '`' + n + '`').join(', '));
out.push('');
console.log(out.join('\n'));
