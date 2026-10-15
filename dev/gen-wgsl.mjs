// Генератор WGSL-шейдеров для WebGPU из боевого GLSL (shaders/glsl/*.js) через dev/glsl2wgsl.mjs.
// Запуск:  node dev/gen-wgsl.mjs        (пишет src/effects/shaders/wgsl/generated/*.js; не править руками)
//
// Что получается:
//  - points-compute.js: вычислительный проход «одна точка → положение на экране, размер, цвет» (весь вершинный шейдер GLSL, переведённый как есть);
//  - points-render.js: рисование квадратов по готовым данным + фрагментный шейдер GLSL, переведённый как есть;
//  - frame-spec.js: список значений кадра (имя, тип, длина массива) для упаковки в uniform-буфер.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emitWGSL, parseGLSL, TYPE_WGSL } from './glsl2wgsl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLSL = (f) => import(pathToFileURL(path.join(ROOT, 'src/effects/shaders/glsl', f)).href);
const OUT = path.join(ROOT, 'src/effects/shaders/wgsl/generated');

const { vert } = await GLSL('vert.js');
const { frag } = await GLSL('frag.js');
const { lineVert } = await GLSL('line-vert.js');
const { lineFrag } = await GLSL('line-frag.js');
const { scopeVert } = await GLSL('scope-vert.js');
const { scopeFrag } = await GLSL('scope-frag.js');

// встроенные матрицы three.js, которых нет в тексте шейдера
const BUILTIN_UNIFORMS = [
	{ type: 'mat4', name: 'modelMatrix', len: 0 },
	{ type: 'mat4', name: 'modelViewMatrix', len: 0 },
	{ type: 'mat4', name: 'projectionMatrix', len: 0 },
	{ type: 'mat3', name: 'normalMatrix', len: 0 },
	{ type: 'vec2', name: 'uRes', len: 0 }, // размер холста в пикселях (для размера точек)
	{ type: 'float', name: 'uExposure', len: 0 }, // экспозиция тональной компрессии
];

const TEXTURES_VERT = {
	uSpecTex: { name: 'specTex', mode: 'sample', sampler: 'linSamp' },
	uPieceTex: { name: 'pieceTex', mode: 'load' },
	uHeroTex: { name: 'heroTex', mode: 'sample', sampler: 'linSamp' },
	uFrTex: { name: 'frTex', mode: 'load', array: true },
};
const TEXTURES_FRAG = { uAtlas: { name: 'atlasTex', mode: 'sample', sampler: 'linSamp' } };

function build(src, defines) {
	const prog = parseGLSL(src, { defines });
	return prog;
}

const progV = build(vert, {});
for (const u of BUILTIN_UNIFORMS) if (!progV.uniforms.find((x) => x.name === u.name)) progV.uniforms.push(u);
const progF = build(frag, {});
const MESHES = {
	links: { vert: lineVert, frag: lineFrag },
	scope: { vert: scopeVert, frag: scopeFrag },
};
for (const m of Object.values(MESHES)) {
	m.pv = build(m.vert, {});
	m.pf = build(m.frag, {});
	for (const u of BUILTIN_UNIFORMS) if (!m.pv.uniforms.find((x) => x.name === u.name)) m.pv.uniforms.push(u);
}

// значения кадра: объединение uniform'ов всех шейдеров (точки, связи, осциллограф)
const frameUniforms = [];
const seen = new Map();
for (const u of [...progV.uniforms, ...progF.uniforms, ...Object.values(MESHES).flatMap((m) => [...m.pv.uniforms, ...m.pf.uniforms])]) {
	if (/^sampler/.test(u.type)) continue;
	if (seen.has(u.name)) {
		const o = seen.get(u.name);
		if (o.type !== u.type || (o.len || 0) !== (u.len || 0)) throw new Error(`uniform ${u.name} объявлен по-разному: ${o.type}[${o.len || 0}] и ${u.type}[${u.len || 0}]`);
		continue;
	}
	seen.set(u.name, u);
	frameUniforms.push(u);
}
const memberType = (u) => {
	const t = TYPE_WGSL[u.type];
	return u.len ? `array<${t}, ${u.len}>` : t;
};
const frameStruct = `struct Frame {\n${frameUniforms.map((u) => (['float', 'vec2', 'vec3'].includes(u.type) && !u.len ? `\t@size(16) ${u.name}: ${memberType(u)},` : `\t${u.name}: ${memberType(u)},`)).join('\n')}\n}`;

const resV = emitWGSL(progV, {
	textures: TEXTURES_VERT,
	builtinTypes: { gl_Position: 'vec4', gl_PointSize: 'float' },
	renameFuncs: { main: 'main_' },
});
const resF = emitWGSL(progF, {
	textures: TEXTURES_FRAG,
	builtinTypes: { gl_FragColor: 'vec4', gl_PointCoord: 'vec2' },
	renameFuncs: { main: 'frag_main_' },
});

const privDecl = (list) => list.map((a) => `var<private> ${a.name}: ${TYPE_WGSL[a.type]};`).join('\n');

// вывод как у three.js: нейтральная тональная компрессия (Khronos PBR Neutral), затем перевод линейного цвета в sRGB
const TONE_FUNCS = `
fn toneNeutral(c0: vec3f, exposure: f32) -> vec3f {
	let startCompression = 0.8 - 0.04;
	let desaturation = 0.15;
	var color = c0 * exposure;
	let x = min(color.r, min(color.g, color.b));
	let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
	color = color - offset;
	let peak = max(color.r, max(color.g, color.b));
	if (peak < startCompression) { return color; }
	let d = 1.0 - startCompression;
	let newPeak = 1.0 - d * d / (peak + d - startCompression);
	color = color * (newPeak / peak);
	let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
	return mix(color, vec3f(newPeak), g);
}
fn linearToSrgb(v: vec3f) -> vec3f {
	return select(pow(v, vec3f(0.41666)) * 1.055 - vec3f(0.055), v * 12.92, v <= vec3f(0.0031308));
}
`;

// ---------------------------------------------------------------- вычислительный проход
const makeCompute = (progV, resV) => `${frameStruct}
@group(0) @binding(0) var<uniform> fr: Frame;
@group(0) @binding(1) var<storage, read> inOrigin: array<vec4f>;
@group(0) @binding(2) var<storage, read> inTarget: array<vec4f>;
@group(0) @binding(3) var<storage, read> inColorA: array<vec4f>;
@group(0) @binding(4) var<storage, read> inColorB: array<vec4f>;
@group(0) @binding(5) var<storage, read> inNormA: array<vec4f>;
@group(0) @binding(6) var<storage, read> inNormB: array<vec4f>;
@group(0) @binding(7) var<storage, read> inSculpt: array<vec4f>;
@group(0) @binding(8) var<storage, read> inPaint: array<vec4f>;
@group(0) @binding(9) var<storage, read_write> outA: array<vec4f>;
@group(0) @binding(10) var<storage, read_write> outB: array<vec4f>;
@group(0) @binding(11) var<storage, read_write> outC: array<vec4f>;
@group(0) @binding(12) var specTex: texture_2d<f32>;
@group(0) @binding(13) var linSamp: sampler;
@group(0) @binding(14) var pieceTex: texture_2d<f32>;
@group(0) @binding(15) var frTex: texture_2d_array<f32>;
@group(0) @binding(16) var heroTex: texture_2d<f32>;

${privDecl(progV.attributes)}
${privDecl(progV.varyings)}
var<private> gl_Position: vec4f;
var<private> gl_PointSize: f32;

${resV.wgsl}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	let count = arrayLength(&inOrigin);
	if (i >= count) { return; }
	let o = inOrigin[i];
	let t = inTarget[i];
	let ca = inColorA[i];
	let cb = inColorB[i];
	let na = inNormA[i];
	aOrigin = o.xyz;
	aHide = o.w;
	aTarget = t.xyz;
	aDepth = t.w;
	aColor = ca.rgb;
	aPath = ca.w;
	aColorB = cb.rgb;
	aVis = vec2f(cb.w, na.w);
	aNormal = na.xyz;
	aNormalB = inNormB[i].xyz;
	aSculpt = inSculpt[i].xyz;
	// индекс точки берётся из массива движка (aIdx = i / число точек, округлённое до float32 на CPU): хеши вида fract(sin(aIdx * k)) раздувают разницу в последнем бите до полного расхождения
	aIdx = inSculpt[i].w;
	aPaint = inPaint[i];
	main_();
	outA[i] = gl_Position;
	outB[i] = vec4f(vColor, gl_PointSize);
	outC[i] = vec4f(vD, vDk, vCoc, vGl);
}
`;
const computeWGSL = makeCompute(progV, resV);
// «герой» раскадровки (видео поверх блока): тот же шейдер с #define HERO
const progHero = build(vert, { HERO: 1 });
for (const u of BUILTIN_UNIFORMS) if (!progHero.uniforms.find((x) => x.name === u.name)) progHero.uniforms.push(u);
for (const u of progHero.uniforms) {
	const o = seen.get(u.name);
	if (!o && !/^sampler/.test(u.type)) throw new Error('в варианте HERO появился новый uniform ' + u.name);
}
const resHero = emitWGSL(progHero, { textures: TEXTURES_VERT, builtinTypes: { gl_Position: 'vec4', gl_PointSize: 'float' }, renameFuncs: { main: 'main_' } });
const computeHeroWGSL = makeCompute(progHero, resHero);

// ---------------------------------------------------------------- рисование
const renderWGSL = `${frameStruct}
@group(0) @binding(0) var<uniform> fr: Frame;
@group(0) @binding(1) var<storage, read> outA: array<vec4f>;
@group(0) @binding(2) var<storage, read> outB: array<vec4f>;
@group(0) @binding(3) var<storage, read> outC: array<vec4f>;
@group(0) @binding(4) var atlasTex: texture_2d<f32>;
@group(0) @binding(5) var linSamp: sampler;

${progF.attributes.concat(progV.varyings).map((a) => `var<private> ${a.name}: ${TYPE_WGSL[a.type]};`).join('\n')}
var<private> gl_FragColor: vec4f;
var<private> gl_PointCoord: vec2f;

${resF.wgsl}

${TONE_FUNCS}
struct VOut {
	@builtin(position) clip: vec4f,
	@location(0) color: vec3f,
	@location(1) misc: vec3f,
	@location(2) gl: f32,
	@location(3) pc: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
	var corners = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
	let corner = corners[vi];
	let a = outA[ii];
	let b = outB[ii];
	let c = outC[ii];
	var clip = a;
	// в WebGL глубина клипа от -w до w, в WebGPU от 0 до w
	clip.z = (clip.z + clip.w) * 0.5;
	let off = corner * (b.w / fr.uRes);
	clip = vec4f(clip.xy + off * clip.w, clip.z, clip.w);
	var o: VOut;
	o.clip = clip;
	o.color = b.rgb;
	o.misc = vec3f(c.x, c.y, c.z);
	o.gl = c.w;
	o.pc = vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
	return o;
}

fn setup_in(in: VOut) {
	vColor = in.color;
	vD = in.misc.x;
	vDk = in.misc.y;
	vCoc = in.misc.z;
	vGl = in.gl;
	gl_PointCoord = in.pc;
}

// на экран: с тональной компрессией и переводом в sRGB
@fragment
fn fs(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return vec4f(linearToSrgb(toneNeutral(gl_FragColor.rgb, fr.uExposure)), gl_FragColor.a);
}

// в промежуточный буфер (дальше идёт пост-обработка): линейный цвет как есть
@fragment
fn fs_raw(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return gl_FragColor;
}
`;

// ---------------------------------------------------------------- линии (связи, осциллограф): по вершине на поток
const COMP = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
/** Раскладывает значения (атрибуты или переменные между шейдерами) по слотам vec4: [имя, слот, смещение, число компонент] */
function packSlots(list) {
	const slots = [];
	const out = [];
	for (const a of list) {
		const n = COMP[a.type];
		if (!n) throw new Error('тип не поддержан для упаковки: ' + a.type);
		let s = slots.findIndex((used) => used + n <= 4);
		if (s < 0) s = slots.push(0) - 1;
		out.push([a.name, s, slots[s], n]);
		slots[s] += n;
	}
	return { slots: slots.length, items: out };
}
const sw = (off, n) => 'xyzw'.slice(off, off + n);
const meshOut = {};
for (const [name, m] of Object.entries(MESHES)) {
	const ain = packSlots(m.pv.attributes);
	const vout = packSlots(m.pv.varyings);
	if (ain.slots > 8 || vout.slots > 2) throw new Error(`${name}: слишком много данных (${ain.slots} слотов атрибутов, ${vout.slots} слотов переменных)`);
	const rv = emitWGSL(m.pv, { textures: TEXTURES_VERT, builtinTypes: { gl_Position: 'vec4' }, renameFuncs: { main: 'main_' } });
	const rf = emitWGSL(m.pf, { textures: TEXTURES_FRAG, builtinTypes: { gl_FragColor: 'vec4' }, renameFuncs: { main: 'frag_main_' } });
	const inDecl = Array.from({ length: ain.slots }, (_, s) => `@group(0) @binding(${s + 1}) var<storage, read> inS${s}: array<vec4f>;`).join('\n');
	const load = Array.from({ length: ain.slots }, (_, s) => `	let s${s} = inS${s}[i];`).join('\n');
	const assign = ain.items.map(([n, s, off, c]) => `	${n} = s${s}.${sw(off, c)};`).join('\n');
	const pack = Array.from({ length: vout.slots }, (_, s) => {
		const parts = vout.items.filter((x) => x[1] === s).map(([n]) => n);
		const used = vout.items.filter((x) => x[1] === s).reduce((a, x) => a + x[3], 0);
		return `	outV${s}[i] = vec4f(${parts.join(', ')}${used < 4 ? ', ' + Array(4 - used).fill('0.0').join(', ') : ''});`;
	}).join('\n');
	const outDecl = ['@group(0) @binding(9) var<storage, read_write> outClip: array<vec4f>;', ...Array.from({ length: vout.slots }, (_, s) => `@group(0) @binding(${10 + s}) var<storage, read_write> outV${s}: array<vec4f>;`)].join('\n');
	const compute = `${frameStruct}
@group(0) @binding(0) var<uniform> fr: Frame;
${inDecl}
${outDecl}
@group(0) @binding(12) var specTex: texture_2d<f32>;
@group(0) @binding(13) var linSamp: sampler;
@group(0) @binding(14) var pieceTex: texture_2d<f32>;
@group(0) @binding(15) var frTex: texture_2d_array<f32>;
@group(0) @binding(16) var heroTex: texture_2d<f32>;

${privDecl(m.pv.attributes)}
${privDecl(m.pv.varyings)}
var<private> gl_Position: vec4f;

${rv.wgsl}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	let count = arrayLength(&inS0);
	if (i >= count) { return; }
${load}
${assign}
	main_();
	outClip[i] = gl_Position;
${pack}
}
`;
	const unpack = vout.items.map(([n, s, off, c]) => `	${n} = in.v${s}.${sw(off, c)};`).join('\n');
	const render = `${frameStruct}
@group(0) @binding(0) var<uniform> fr: Frame;
@group(0) @binding(1) var<storage, read> outClip: array<vec4f>;
${Array.from({ length: vout.slots }, (_, s) => `@group(0) @binding(${2 + s}) var<storage, read> outV${s}: array<vec4f>;`).join('\n')}
@group(0) @binding(4) var atlasTex: texture_2d<f32>;
@group(0) @binding(5) var linSamp: sampler;

${privDecl(m.pf.varyings)}
var<private> gl_FragColor: vec4f;

${rf.wgsl}

${TONE_FUNCS}
struct VOut {
	@builtin(position) clip: vec4f,
${Array.from({ length: vout.slots }, (_, s) => `	@location(${s}) v${s}: vec4f,`).join('\n')}
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
	var clip = outClip[vi];
	clip.z = (clip.z + clip.w) * 0.5;
	var o: VOut;
	o.clip = clip;
${Array.from({ length: vout.slots }, (_, s) => `	o.v${s} = outV${s}[vi];`).join('\n')}
	return o;
}

fn setup_in(in: VOut) {
${unpack}
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return vec4f(linearToSrgb(toneNeutral(gl_FragColor.rgb, fr.uExposure)), gl_FragColor.a);
}

@fragment
fn fs_raw(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return gl_FragColor;
}
`;
	meshOut[name] = { compute, render, attrs: ain.items, slots: ain.slots };
}

// ---------------------------------------------------------------- пост-обработка: полноэкранные проходы
const { fbFrag, outFrag, mvFrag, moshFrag } = await GLSL('post.js');
const POST = { fb: fbFrag, out: outFrag, mv: mvFrag, mosh: moshFrag };
const postOut = {};
for (const [name, src] of Object.entries(POST)) {
	const prog = parseGLSL(src, {});
	prog.uniforms.push({ type: 'vec2', name: 'uTarget', len: 0 }); // размер цели в пикселях (для gl_FragCoord)
	prog.uniforms.push({ type: 'float', name: 'uExposure', len: 0 });
	const samplers = prog.uniforms.filter((u) => /^sampler/.test(u.type));
	const textures = Object.fromEntries(samplers.map((u) => [u.name, { name: 't_' + u.name, mode: 'sample', sampler: 'samp' }]));
	const res = emitWGSL(prog, {
		uniformPrefix: 'u.',
		textures,
		flipY: true,
		builtinTypes: { gl_FragColor: 'vec4', gl_FragCoord: 'vec4' },
		renameFuncs: { main: 'main_' },
	});
	const uni = prog.uniforms.filter((u) => !/^sampler/.test(u.type));
	const member = (u) => (['float', 'vec2', 'vec3'].includes(u.type) ? `\t@size(16) ${u.name}: ${TYPE_WGSL[u.type]},` : `\t${u.name}: ${TYPE_WGSL[u.type]},`);
	const struct = `struct U {\n${uni.map(member).join('\n')}\n}`;
	const texDecl = samplers.map((u, i) => `@group(0) @binding(${i + 1}) var t_${u.name}: texture_2d<f32>;`).join('\n');
	const tonemap = name === 'out';
	const wgsl = `${struct}
@group(0) @binding(0) var<uniform> u: U;
${texDecl}
@group(0) @binding(${samplers.length + 1}) var samp: sampler;
var<private> vUv: vec2f;
var<private> gl_FragColor: vec4f;
var<private> gl_FragCoord: vec4f;

${res.wgsl}
${tonemap ? TONE_FUNCS : ''}
struct VOut {
	@builtin(position) pos: vec4f,
	@location(0) uv: vec2f,
}

// один большой треугольник на весь экран; uv идёт снизу вверх, как в GLSL
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
	var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
	var o: VOut;
	o.pos = vec4f(p[vi], 0.0, 1.0);
	o.uv = p[vi] * 0.5 + vec2f(0.5);
	return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
	vUv = in.uv;
	gl_FragCoord = vec4f(in.pos.x, u.uTarget.y - in.pos.y, in.pos.z, in.pos.w);
	main_();
${tonemap ? '	return vec4f(linearToSrgb(toneNeutral(gl_FragColor.rgb, u.uExposure)), gl_FragColor.a);' : '	return gl_FragColor;'}
}
`;
	postOut[name] = { wgsl, spec: uni.map((u) => [u.name, TYPE_WGSL[u.type], u.len || 0]), textures: samplers.map((u) => u.name) };
}

// ---------------------------------------------------------------- спецификация значений кадра
const spec = frameUniforms.map((u) => ({ name: u.name, type: TYPE_WGSL[u.type], len: u.len || 0 }));

fs.mkdirSync(OUT, { recursive: true });
const banner = '// Сгенерировано dev/gen-wgsl.mjs из шейдеров GLSL. Не править руками: правьте GLSL и запустите node dev/gen-wgsl.mjs.\n';
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
fs.writeFileSync(path.join(OUT, 'points-compute.js'), `${banner}export const pointsComputeWGSL = /* wgsl */ \`\n${esc(computeWGSL)}\`;\n`);
fs.writeFileSync(path.join(OUT, 'points-compute-hero.js'), `${banner}export const pointsComputeHeroWGSL = /* wgsl */ \`\n${esc(computeHeroWGSL)}\`;\n`);
fs.writeFileSync(path.join(OUT, 'points-render.js'), `${banner}export const pointsRenderWGSL = /* wgsl */ \`\n${esc(renderWGSL)}\`;\n`);
fs.writeFileSync(path.join(OUT, 'mesh-programs.js'), `${banner}export const MESH_PROGRAMS = ${JSON.stringify(meshOut, null, 1)};
`);
fs.writeFileSync(path.join(OUT, 'post-passes.js'), `${banner}export const POST_PASSES = ${JSON.stringify(postOut, null, 1)};
`);
fs.writeFileSync(path.join(OUT, 'frame-spec.js'), `${banner}// имя, тип в WGSL, длина массива (0: не массив)\nexport const FRAME_SPEC = ${JSON.stringify(spec.map((s) => [s.name, s.type, s.len]))};\n`);
console.log(`готово: compute ${computeWGSL.split('\n').length} строк, render ${renderWGSL.split('\n').length} строк, значений кадра ${spec.length}`);
