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

// значения кадра: объединение uniform'ов обоих шейдеров
const frameUniforms = [];
const seen = new Set();
for (const u of [...progV.uniforms, ...progF.uniforms]) {
	if (/^sampler/.test(u.type) || seen.has(u.name)) continue;
	seen.add(u.name);
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
const computeWGSL = `${frameStruct}
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
fs.writeFileSync(path.join(OUT, 'points-render.js'), `${banner}export const pointsRenderWGSL = /* wgsl */ \`\n${esc(renderWGSL)}\`;\n`);
fs.writeFileSync(path.join(OUT, 'post-passes.js'), `${banner}export const POST_PASSES = ${JSON.stringify(postOut, null, 1)};
`);
fs.writeFileSync(path.join(OUT, 'frame-spec.js'), `${banner}// имя, тип в WGSL, длина массива (0: не массив)\nexport const FRAME_SPEC = ${JSON.stringify(spec.map((s) => [s.name, s.type, s.len]))};\n`);
console.log(`готово: compute ${computeWGSL.split('\n').length} строк, render ${renderWGSL.split('\n').length} строк, значений кадра ${spec.length}`);
