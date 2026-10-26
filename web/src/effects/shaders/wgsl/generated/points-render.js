export const pointsRenderWGSL = `
struct Frame {
	@size(16) uAdd: f32,
	@size(16) uSolid: vec3f,
	@size(16) uAtt: f32,
	@size(16) uSize: f32,
	@size(16) uPR: f32,
	@size(16) uGlyph: vec3f,
	@size(16) uColorBy: f32,
	@size(16) uBright: f32,
	@size(16) uMaskShow: f32,
	@size(16) uP0: vec3f,
	@size(16) uP1: vec3f,
	@size(16) uP2: vec3f,
	@size(16) uSliceC: vec3f,
	@size(16) uMarkC: vec3f,
	@size(16) uTime: f32,
	@size(16) uTOff: f32,
	@size(16) uMorph: f32,
	uMorphS: vec4f,
	uMorphO: vec4f,
	uMorphD: vec4f,
	@size(16) uSettle: f32,
	@size(16) uBeat: f32,
	@size(16) uYR: vec2f,
	@size(16) uMouse: vec3f,
	@size(16) uMouseOn: f32,
	@size(16) uShade: f32,
	uCurlP: vec4f,
	uSpecP: vec4f,
	uWaveP: vec4f,
	uWaveSrc: vec4f,
	uPulseP: vec4f,
	uVoxelP: vec4f,
	uGlitchP: vec4f,
	uBlast: vec4f,
	uFlow: vec4f,
	uDisP: vec4f,
	uScope: vec4f,
	uScopeP: vec4f,
	uScopeQ: vec4f,
	@size(16) uScopeC: vec3f,
	uDepth: vec4f,
	uDepthP: vec4f,
	uDepthQ: vec4f,
	@size(16) uFlat: f32,
	uCurl: vec4f,
	uSpec: vec4f,
	uWave: vec4f,
	uTwist: vec4f,
	uPulse: vec4f,
	uVoxel: vec4f,
	uJitter: vec4f,
	uCursor: vec4f,
	uMask: vec4f,
	uMaskA: vec4f,
	uGlitch: vec4f,
	uContact: vec4f,
	uShockP: vec4f,
	uTrk: array<vec4f, 16>,
	uHand: array<vec4f, 12>,
	uGrav: vec4f,
	uSlice: vec4f,
	uSliceM: vec4f,
	uMark: vec4f,
	uGravT: vec4f,
	uPhysP: vec4f,
	@size(16) uAsm: f32,
	uDis: vec4f,
	@size(16) uDisT: f32,
	@size(16) uAnimN: f32,
	@size(16) uCen: vec3f,
	uDisQ: vec4f,
	uGravP: vec4f,
	uHandP: vec4f,
	uImp: array<vec4f, 32>,
	uShock: array<vec4f, 4>,
	uExp: vec4f,
	uExpP: vec4f,
	uGrow: vec4f,
	uGrowP: vec4f,
	@size(16) uGrowSeed: vec3f,
	uJel: array<vec4f, 3>,
	uJelO: array<vec4f, 3>,
	uJelP: vec4f,
	uPhysics: vec4f,
	@size(16) uCollapseTime: f32,
	uBrushHits: array<vec4f, 20>,
	uPaintP: vec4f,
	uBrushParam: vec4f,
	uLookP2: vec4f,
	uDof: vec4f,
	uHyp: vec4f,
	uHypP: vec4f,
	uCh: vec4f,
	uChA: vec4f,
	uFr: vec4f,
	uFr2: vec4f,
	uFr3: vec4f,
	uFr4: vec4f,
	uFr5: vec4f,
	uHero: vec4f,
	uFr6: vec4f,
	uFr7: vec4f,
	uFr8: vec4f,
	uFr9: vec4f,
	uFrE: vec4f,
	uShoot: vec4f,
	uShootP: vec4f,
	uShootD: vec4f,
	uShootE: vec4f,
	uShootC: vec4f,
	uShootS: array<vec4f, 24>,
	uShootN: array<vec4f, 24>,
	uShootB: array<vec4f, 6>,
	uScr: vec4f,
	uScrP: vec4f,
	uScrD: vec4f,
	uScrQ: vec4f,
	@size(16) uScrMN: f32,
	uSlit: vec4f,
	uSlitP: vec4f,
	uSlitG: vec4f,
	uSort: vec4f,
	uSortP: vec4f,
	modelMatrix: mat4x4f,
	modelViewMatrix: mat4x4f,
	projectionMatrix: mat4x4f,
	viewMatrix: mat4x4f,
	normalMatrix: mat3x3f,
	@size(16) uRes: vec2f,
	@size(16) uPx: vec2f,
	@size(16) uExposure: f32,
	@size(16) uTone: f32,
	@size(16) uGlow: f32,
	@size(16) uDens: f32,
	@size(16) uGhost: f32,
	@size(16) uShape: f32,
	uShd: vec4f,
	uShdL: vec4f,
	uShdP: vec4f,
	@size(16) uShdC: vec3f,
	uLink: vec4f,
	uLinkP: vec4f,
	@size(16) uLinkW: f32,
	@size(16) uScopeW: f32,
	@size(16) uScopeLB: f32,
}
@group(0) @binding(0) var<uniform> fr: Frame;
@group(0) @binding(1) var<storage, read> outA: array<vec4f>;
@group(0) @binding(2) var<storage, read> outB: array<vec4f>;
@group(0) @binding(3) var<storage, read> outC: array<vec4f>;
@group(0) @binding(4) var atlasTex: texture_2d<f32>;
@group(0) @binding(5) var linSamp: sampler;

var<private> vColor: vec3f;
var<private> vD: f32;
var<private> vDk: f32;
var<private> vCoc: f32;
var<private> vGl: f32;
var<private> gl_FragColor: vec4f;
var<private> gl_PointCoord: vec2f;

fn frag_main_() {
	var c: vec2f = (gl_PointCoord - 0.5);
	var dm: f32 = length(c);
	var gA: f32 = 1.0;
	if ((fr.uGlyph.x > 0.5)) {
		var guv: vec2f = vec2f((((floor((vGl * ((fr.uGlyph.z - 0.001)))) + gl_PointCoord.x)) / fr.uGlyph.z), (1.0 - gl_PointCoord.y));
		gA = textureSampleLevel(atlasTex, linSamp, guv, 0.0).a;
		if ((gA < 0.3)) {
			discard;
		}
		dm = 0.0;
	}
	if ((fr.uShape < 0.5)) {
		dm = max(abs(c.x), abs(c.y));
	} else if (((fr.uShape > 3.5) && (fr.uShape < 4.5))) {
		dm = (abs(c.x) + abs(c.y));
	}
	if ((dm > 0.5)) {
		discard;
	}
	if ((((fr.uShape > 2.5) && (fr.uShape < 3.5)) && (dm < 0.29))) {
		discard;
	}
	if (((fr.uShape > 4.5) && (min(abs(c.x), abs(c.y)) > 0.16))) {
		discard;
	}
	var r2: f32 = (dm * dm);
	var core: f32 = select((1.0 - smoothstep(0.0, 0.25, r2)), gA, (fr.uGlyph.x > 0.5));
	if (((fr.uShape > 2.5) && (fr.uShape < 3.5))) {
		core = (1.0 - smoothstep(0.0, 0.1, abs((dm - 0.4))));
	}
	var sph: f32 = 1.0;
	if (((fr.uShape > 1.5) && (fr.uShape < 2.5))) {
		var n: vec3f = vec3f((c.x * 2.0), (-c.y * 2.0), sqrt(max(0.0, (1.0 - (4.0 * r2)))));
		sph = (0.4 + (0.75 * max(dot(n, normalize(vec3f(-0.4, 0.6, 0.7))), 0.0)));
	}
	if ((vCoc > 0.01)) {
		var bokeh: f32 = (1.0 - smoothstep(0.16, 0.25, r2));
		core = mix(core, bokeh, (vCoc * 0.8));
	}
	var dofAlpha: f32 = (1.0 / ((1.0 + (vCoc * 1.8))));
	if ((fr.uAdd > 0.5)) {
		var aura: f32 = pow(core, mix(1.8, 0.7, fr.uGlow));
		var col: vec3f = ((((((((vColor * ((0.08 + (aura * ((0.2 + (fr.uGlow * 0.28))))))) + ((vColor * vD) * 0.08))) * fr.uDens) * fr.uGhost) * dofAlpha) * sph) * ((1.0 - vDk)));
		var ga: f32 = (((core * fr.uGhost) * dofAlpha) * ((1.0 - vDk)));
		if ((fr.uFr.x > 0.5)) {
			ga *= clamp((dot(vColor, vec3f(0.3, 0.59, 0.11)) * 5.0), 0.0, 1.0);
		}
		gl_FragColor = vec4f(col, ga);
	} else {
		gl_FragColor = vec4f(((vColor * (select((0.55 + (0.45 * core)), 1.0, (fr.uFr.x > 0.5)))) * sph), (dofAlpha * ((1.0 - vDk))));
	}
}



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

// на экран: с тональной компрессией и переводом в sRGB
@fragment
fn fs(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return vec4f(linearToSrgb(toneMap(gl_FragColor.rgb, fr.uExposure, fr.uTone)), gl_FragColor.a);
}

// в промежуточный буфер (дальше идёт пост-обработка): линейный цвет как есть
@fragment
fn fs_raw(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return gl_FragColor;
}
`;
export const shadowRenderWGSL = `
struct Frame {
	@size(16) uAdd: f32,
	@size(16) uSolid: vec3f,
	@size(16) uAtt: f32,
	@size(16) uSize: f32,
	@size(16) uPR: f32,
	@size(16) uGlyph: vec3f,
	@size(16) uColorBy: f32,
	@size(16) uBright: f32,
	@size(16) uMaskShow: f32,
	@size(16) uP0: vec3f,
	@size(16) uP1: vec3f,
	@size(16) uP2: vec3f,
	@size(16) uSliceC: vec3f,
	@size(16) uMarkC: vec3f,
	@size(16) uTime: f32,
	@size(16) uTOff: f32,
	@size(16) uMorph: f32,
	uMorphS: vec4f,
	uMorphO: vec4f,
	uMorphD: vec4f,
	@size(16) uSettle: f32,
	@size(16) uBeat: f32,
	@size(16) uYR: vec2f,
	@size(16) uMouse: vec3f,
	@size(16) uMouseOn: f32,
	@size(16) uShade: f32,
	uCurlP: vec4f,
	uSpecP: vec4f,
	uWaveP: vec4f,
	uWaveSrc: vec4f,
	uPulseP: vec4f,
	uVoxelP: vec4f,
	uGlitchP: vec4f,
	uBlast: vec4f,
	uFlow: vec4f,
	uDisP: vec4f,
	uScope: vec4f,
	uScopeP: vec4f,
	uScopeQ: vec4f,
	@size(16) uScopeC: vec3f,
	uDepth: vec4f,
	uDepthP: vec4f,
	uDepthQ: vec4f,
	@size(16) uFlat: f32,
	uCurl: vec4f,
	uSpec: vec4f,
	uWave: vec4f,
	uTwist: vec4f,
	uPulse: vec4f,
	uVoxel: vec4f,
	uJitter: vec4f,
	uCursor: vec4f,
	uMask: vec4f,
	uMaskA: vec4f,
	uGlitch: vec4f,
	uContact: vec4f,
	uShockP: vec4f,
	uTrk: array<vec4f, 16>,
	uHand: array<vec4f, 12>,
	uGrav: vec4f,
	uSlice: vec4f,
	uSliceM: vec4f,
	uMark: vec4f,
	uGravT: vec4f,
	uPhysP: vec4f,
	@size(16) uAsm: f32,
	uDis: vec4f,
	@size(16) uDisT: f32,
	@size(16) uAnimN: f32,
	@size(16) uCen: vec3f,
	uDisQ: vec4f,
	uGravP: vec4f,
	uHandP: vec4f,
	uImp: array<vec4f, 32>,
	uShock: array<vec4f, 4>,
	uExp: vec4f,
	uExpP: vec4f,
	uGrow: vec4f,
	uGrowP: vec4f,
	@size(16) uGrowSeed: vec3f,
	uJel: array<vec4f, 3>,
	uJelO: array<vec4f, 3>,
	uJelP: vec4f,
	uPhysics: vec4f,
	@size(16) uCollapseTime: f32,
	uBrushHits: array<vec4f, 20>,
	uPaintP: vec4f,
	uBrushParam: vec4f,
	uLookP2: vec4f,
	uDof: vec4f,
	uHyp: vec4f,
	uHypP: vec4f,
	uCh: vec4f,
	uChA: vec4f,
	uFr: vec4f,
	uFr2: vec4f,
	uFr3: vec4f,
	uFr4: vec4f,
	uFr5: vec4f,
	uHero: vec4f,
	uFr6: vec4f,
	uFr7: vec4f,
	uFr8: vec4f,
	uFr9: vec4f,
	uFrE: vec4f,
	uShoot: vec4f,
	uShootP: vec4f,
	uShootD: vec4f,
	uShootE: vec4f,
	uShootC: vec4f,
	uShootS: array<vec4f, 24>,
	uShootN: array<vec4f, 24>,
	uShootB: array<vec4f, 6>,
	uScr: vec4f,
	uScrP: vec4f,
	uScrD: vec4f,
	uScrQ: vec4f,
	@size(16) uScrMN: f32,
	uSlit: vec4f,
	uSlitP: vec4f,
	uSlitG: vec4f,
	uSort: vec4f,
	uSortP: vec4f,
	modelMatrix: mat4x4f,
	modelViewMatrix: mat4x4f,
	projectionMatrix: mat4x4f,
	viewMatrix: mat4x4f,
	normalMatrix: mat3x3f,
	@size(16) uRes: vec2f,
	@size(16) uPx: vec2f,
	@size(16) uExposure: f32,
	@size(16) uTone: f32,
	@size(16) uGlow: f32,
	@size(16) uDens: f32,
	@size(16) uGhost: f32,
	@size(16) uShape: f32,
	uShd: vec4f,
	uShdL: vec4f,
	uShdP: vec4f,
	@size(16) uShdC: vec3f,
	uLink: vec4f,
	uLinkP: vec4f,
	@size(16) uLinkW: f32,
	@size(16) uScopeW: f32,
	@size(16) uScopeLB: f32,
}
@group(0) @binding(0) var<uniform> fr: Frame;
@group(0) @binding(1) var<storage, read> outA: array<vec4f>;
@group(0) @binding(2) var<storage, read> outB: array<vec4f>;
@group(0) @binding(3) var<storage, read> outC: array<vec4f>;
@group(0) @binding(4) var atlasTex: texture_2d<f32>;
@group(0) @binding(5) var linSamp: sampler;

var<private> vColor: vec3f;
var<private> vD: f32;
var<private> vDk: f32;
var<private> vCoc: f32;
var<private> vGl: f32;
var<private> gl_FragColor: vec4f;
var<private> gl_PointCoord: vec2f;

fn frag_main_() {
	var c: vec2f = (gl_PointCoord - 0.5);
	var r: f32 = length(c);
	if ((r > 0.5)) {
		discard;
	}
	var a: f32 = (((((1.0 - smoothstep(mix(0.3, 0.0, fr.uShd.y), 0.5, r))) * vD) * ((1.0 - vDk))) * 0.4);
	if ((a < 0.002)) {
		discard;
	}
	gl_FragColor = vec4f(vColor, a);
}



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

// на экран: с тональной компрессией и переводом в sRGB
@fragment
fn fs(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return vec4f(linearToSrgb(toneMap(gl_FragColor.rgb, fr.uExposure, fr.uTone)), gl_FragColor.a);
}

// в промежуточный буфер (дальше идёт пост-обработка): линейный цвет как есть
@fragment
fn fs_raw(in: VOut) -> @location(0) vec4f {
	setup_in(in);
	frag_main_();
	return gl_FragColor;
}
`;
