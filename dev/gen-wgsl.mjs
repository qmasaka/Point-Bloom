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
const { shadowFrag } = await GLSL('shadow-frag.js');

const BUILTIN_UNIFORMS = [
	{ type: 'mat4', name: 'modelMatrix', len: 0 },
	{ type: 'mat4', name: 'modelViewMatrix', len: 0 },
	{ type: 'mat4', name: 'projectionMatrix', len: 0 },
	{ type: 'mat4', name: 'viewMatrix', len: 0 },
	{ type: 'mat3', name: 'normalMatrix', len: 0 },
	{ type: 'vec2', name: 'uRes', len: 0 },
	{ type: 'vec2', name: 'uPx', len: 0 },
	{ type: 'float', name: 'uExposure', len: 0 },
	{ type: 'float', name: 'uTone', len: 0 },
];

const TEXTURES_VERT = {
	uSpecTex: { name: 'specTex', mode: 'sample', sampler: 'linSamp' },
	uPieceTex: { name: 'pieceTex', mode: 'load' },
	uHeroTex: { name: 'heroTex', mode: 'sample', sampler: 'linSamp' },
	uFrTex: { name: 'frTex', mode: 'load', array: true },
	uScrTex: { name: 'scrTex', mode: 'sample', sampler: 'linSamp' },
	uScrDep: { name: 'scrDep', mode: 'sample', sampler: 'linSamp' },
	uScrMTex: { name: 'scrMTex', mode: 'load' },
	uSlitTex: { name: 'slitTex', mode: 'load', array: true },
	uSortTex: { name: 'sortTex', mode: 'load' },
};
const TEXTURES_FRAG = { uAtlas: { name: 'atlasTex', mode: 'sample', sampler: 'linSamp' } };

function build(src, defines) {
	const prog = parseGLSL(src, { defines });
	return prog;
}

const VERT_DEFINES = { VSHOOT: 1, VSCREEN: 1 };
const progV = build(vert, VERT_DEFINES);
for (const u of BUILTIN_UNIFORMS) if (!progV.uniforms.find((x) => x.name === u.name)) progV.uniforms.push(u);
const progF = build(frag, {});
const progShadow = build(vert, { ...VERT_DEFINES, SHADOW: 1 });
for (const u of BUILTIN_UNIFORMS) if (!progShadow.uniforms.find((x) => x.name === u.name)) progShadow.uniforms.push(u);
const progShadowF = build(shadowFrag, {});
const MESHES = {
	links: { vert: lineVert, frag: lineFrag },
	scope: { vert: scopeVert, frag: scopeFrag },
};
for (const m of Object.values(MESHES)) {
	m.pv = build(m.vert, {});
	m.pf = build(m.frag, {});
	for (const u of BUILTIN_UNIFORMS) if (!m.pv.uniforms.find((x) => x.name === u.name)) m.pv.uniforms.push(u);
}

const frameUniforms = [];
const seen = new Map();
for (const u of [...progV.uniforms, ...progF.uniforms, ...progShadow.uniforms, ...progShadowF.uniforms, ...Object.values(MESHES).flatMap((m) => [...m.pv.uniforms, ...m.pf.uniforms])]) {
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
fn rrtAndOdtFit(v: vec3f) -> vec3f {
	let a = v * (v + 0.0245786) - 0.000090537;
	let b = v * (0.983729 * v + 0.4329510) + 0.238081;
	return a / b;
}
fn toneAces(c0: vec3f, exposure: f32) -> vec3f {
	let inM = mat3x3f(vec3f(0.59719, 0.07600, 0.02840), vec3f(0.35458, 0.90834, 0.13383), vec3f(0.04823, 0.01566, 0.83777));
	let outM = mat3x3f(vec3f(1.60475, -0.10208, -0.00327), vec3f(-0.53108, 1.10813, -0.07276), vec3f(-0.07367, -0.00605, 1.07602));
	var color = c0 * (exposure / 0.6);
	color = inM * color;
	color = rrtAndOdtFit(color);
	color = outM * color;
	return saturate(color);
}
fn agxContrast(x: vec3f) -> vec3f {
	let x2 = x * x;
	let x4 = x2 * x2;
	return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn toneAgx(c0: vec3f, exposure: f32) -> vec3f {
	let rec2020ToSrgb = mat3x3f(vec3f(1.6605, -0.1246, -0.0182), vec3f(-0.5876, 1.1329, -0.1006), vec3f(-0.0728, -0.0083, 1.1187));
	let srgbToRec2020 = mat3x3f(vec3f(0.6274, 0.0691, 0.0164), vec3f(0.3293, 0.9195, 0.0880), vec3f(0.0433, 0.0113, 0.8956));
	let inset = mat3x3f(vec3f(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3f(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3f(0.0482516061458583, 0.101439036467562, 0.811302368396859));
	let outset = mat3x3f(vec3f(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3f(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3f(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
	let minEv = -12.47393;
	let maxEv = 4.026069;
	var color = c0 * exposure;
	color = srgbToRec2020 * color;
	color = inset * color;
	color = max(color, vec3f(1e-10));
	color = log2(color);
	color = (color - minEv) / (maxEv - minEv);
	color = clamp(color, vec3f(0.0), vec3f(1.0));
	color = agxContrast(color);
	color = outset * color;
	color = pow(max(vec3f(0.0), color), vec3f(2.2));
	color = rec2020ToSrgb * color;
	return clamp(color, vec3f(0.0), vec3f(1.0));
}
fn toneMap(c: vec3f, exposure: f32, mode: f32) -> vec3f {
	if (mode < 0.5) { return c; }
	if (mode < 1.5) { return toneNeutral(c, exposure); }
	if (mode < 2.5) { return toneAces(c, exposure); }
	return toneAgx(c, exposure);
}
fn linearToSrgb(v: vec3f) -> vec3f {
	return select(pow(v, vec3f(0.41666)) * 1.055 - vec3f(0.055), v * 12.92, v <= vec3f(0.0031308));
}
`;

const TEX_DECL = `@group(0) @binding(12) var specTex: texture_2d<f32>;
@group(0) @binding(13) var linSamp: sampler;
@group(0) @binding(14) var pieceTex: texture_2d<f32>;
@group(0) @binding(15) var frTex: texture_2d_array<f32>;
@group(0) @binding(16) var heroTex: texture_2d<f32>;
@group(0) @binding(17) var scrTex: texture_2d<f32>;
@group(0) @binding(18) var scrDep: texture_2d<f32>;
@group(0) @binding(19) var scrMTex: texture_2d<f32>;
@group(0) @binding(20) var slitTex: texture_2d_array<f32>;
@group(0) @binding(21) var sortTex: texture_2d<f32>;`;
const makeCompute = (progV, resV) => `${frameStruct}
@group(0) @binding(0) var<uniform> fr: Frame;

@group(0) @binding(1) var<storage, read> inP0: array<vec4f>;
@group(0) @binding(2) var<storage, read> inP1: array<vec4f>;
@group(0) @binding(3) var<storage, read> inP2: array<vec4f>;
@group(0) @binding(4) var<storage, read> inP3: array<vec4f>;
@group(0) @binding(9) var<storage, read_write> outA: array<vec4f>;
@group(0) @binding(10) var<storage, read_write> outB: array<vec4f>;
@group(0) @binding(11) var<storage, read_write> outC: array<vec4f>;
${TEX_DECL}

${privDecl(progV.attributes)}
${privDecl(progV.varyings)}
var<private> gl_Position: vec4f;
var<private> gl_PointSize: f32;

${resV.wgsl}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	let count = arrayLength(&inP0) / 2u;
	if (i >= count) { return; }
	let o = inP0[i];
	let t = inP0[count + i];
	let ca = inP1[i];
	let cb = inP1[count + i];
	let na = inP2[i];
	let sc = inP3[i];
	aOrigin = o.xyz;
	aHide = o.w;
	aTarget = t.xyz;
	aDepth = t.w;
	aColor = ca.rgb;
	aPath = ca.w;
	aColorB = cb.rgb;
	aVis = vec2f(cb.w, na.w);
	aNormal = na.xyz;
	aNormalB = inP2[count + i].xyz;
	aSculpt = sc.xyz;

	aIdx = sc.w;
	aPaint = inP3[count + i];
	main_();
	outA[i] = gl_Position;
	outB[i] = vec4f(vColor, gl_PointSize);
	outC[i] = vec4f(vD, vDk, vCoc, vGl);
}
`;
const computeWGSL = makeCompute(progV, resV);
const progHero = build(vert, { ...VERT_DEFINES, HERO: 1 });
for (const u of BUILTIN_UNIFORMS) if (!progHero.uniforms.find((x) => x.name === u.name)) progHero.uniforms.push(u);
for (const u of progHero.uniforms) {
	const o = seen.get(u.name);
	if (!o && !/^sampler/.test(u.type)) throw new Error('в варианте HERO появился новый uniform ' + u.name);
}
const resHero = emitWGSL(progHero, { textures: TEXTURES_VERT, builtinTypes: { gl_Position: 'vec4', gl_PointSize: 'float' }, renameFuncs: { main: 'main_' } });
const computeHeroWGSL = makeCompute(progHero, resHero);

const makeRender = (progF, resF) => `${frameStruct}
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

	clip.z = (clip.z + clip.w) * 0.5;
	let off = corner * (b.w / fr.uPx);
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

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return vec4f(linearToSrgb(toneMap(gl_FragColor.rgb, fr.uExposure, fr.uTone)), gl_FragColor.a);
}

@fragment
fn fs_raw(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return gl_FragColor;
}
`;
const renderWGSL = makeRender(progF, resF);

const resShadow = emitWGSL(progShadow, { textures: TEXTURES_VERT, builtinTypes: { gl_Position: 'vec4', gl_PointSize: 'float' }, renameFuncs: { main: 'main_' } });
const computeShadowWGSL = makeCompute(progShadow, resShadow);
const resShadowF = emitWGSL(progShadowF, { textures: TEXTURES_FRAG, builtinTypes: { gl_FragColor: 'vec4', gl_PointCoord: 'vec2' }, renameFuncs: { main: 'frag_main_' } });
const shadowRenderWGSL = makeRender(progShadowF, resShadowF);

const COMP = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
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
	if (ain.slots + 1 + vout.slots > 8 || vout.slots > 2) throw new Error(`${name}: слишком много данных (${ain.slots} слотов атрибутов, ${vout.slots} слотов переменных)`);
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
${TEX_DECL}

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
	return vec4f(linearToSrgb(toneMap(gl_FragColor.rgb, fr.uExposure, fr.uTone)), gl_FragColor.a);
}

@fragment
fn fs_raw(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return gl_FragColor;
}
`;
	meshOut[name] = { compute, render, attrs: ain.items, slots: ain.slots, vslots: vout.slots };
}

const { fbFrag, outFrag, mvFrag, moshFrag } = await GLSL('post.js');
const POST = { fb: fbFrag, out: outFrag, mv: mvFrag, mosh: moshFrag };
const postOut = {};
for (const [name, src] of Object.entries(POST)) {
	const prog = parseGLSL(src, {});
	prog.uniforms.push({ type: 'vec2', name: 'uTarget', len: 0 });
	prog.uniforms.push({ type: 'float', name: 'uExposure', len: 0 });
	prog.uniforms.push({ type: 'float', name: 'uTone', len: 0 });
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
${tonemap ? '	return vec4f(linearToSrgb(toneMap(gl_FragColor.rgb, u.uExposure, u.uTone)), gl_FragColor.a);' : '	return gl_FragColor;'}
}
`;
	postOut[name] = { wgsl, spec: uni.map((u) => [u.name, TYPE_WGSL[u.type], u.len || 0]), textures: samplers.map((u) => u.name) };
}

const spec = frameUniforms.map((u) => ({ name: u.name, type: TYPE_WGSL[u.type], len: u.len || 0 }));

fs.mkdirSync(OUT, { recursive: true });
const banner = '';
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
fs.writeFileSync(path.join(OUT, 'points-compute.js'), `${banner}export const pointsComputeWGSL =  \`\n${esc(computeWGSL)}\`;\n`);
fs.writeFileSync(path.join(OUT, 'points-compute-hero.js'), `${banner}export const pointsComputeHeroWGSL =  \`\n${esc(computeHeroWGSL)}\`;\n`);
fs.writeFileSync(path.join(OUT, 'points-compute-shadow.js'), `${banner}export const pointsComputeShadowWGSL =  \`\n${esc(computeShadowWGSL)}\`;\n`);
fs.writeFileSync(path.join(OUT, 'points-render.js'), `${banner}export const pointsRenderWGSL =  \`\n${esc(renderWGSL)}\`;\nexport const shadowRenderWGSL =  \`\n${esc(shadowRenderWGSL)}\`;\n`);
fs.writeFileSync(path.join(OUT, 'mesh-programs.js'), `${banner}export const MESH_PROGRAMS = ${JSON.stringify(meshOut, null, 1)};
`);
fs.writeFileSync(path.join(OUT, 'post-passes.js'), `${banner}export const POST_PASSES = ${JSON.stringify(postOut, null, 1)};
`);
fs.writeFileSync(path.join(OUT, 'tone.js'), `${banner}export const TONE_WGSL =  \`${esc(TONE_FUNCS)}\`;\n`);
fs.writeFileSync(path.join(OUT, 'frame-spec.js'), `${banner}\nexport const FRAME_SPEC =${JSON.stringify(spec.map((s) => [s.name, s.type, s.len]))};\n`);
console.log(`готово: compute ${computeWGSL.split('\n').length} строк, render ${renderWGSL.split('\n').length} строк, значений кадра ${spec.length}`);
