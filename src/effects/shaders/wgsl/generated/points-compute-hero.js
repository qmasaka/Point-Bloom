// Сгенерировано dev/gen-wgsl.mjs из шейдеров GLSL. Не править руками: правьте GLSL и запустите node dev/gen-wgsl.mjs.
export const pointsComputeHeroWGSL = /* wgsl */ `
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
	uLens: vec4f,
	uLensC: vec4f,
	@size(16) uTime: f32,
	@size(16) uTOff: f32,
	@size(16) uMorph: f32,
	uMorphS: vec4f,
	uMorphO: vec4f,
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
	modelMatrix: mat4x4f,
	modelViewMatrix: mat4x4f,
	projectionMatrix: mat4x4f,
	normalMatrix: mat3x3f,
	@size(16) uRes: vec2f,
	@size(16) uExposure: f32,
	@size(16) uGlow: f32,
	@size(16) uDens: f32,
	@size(16) uGhost: f32,
	@size(16) uShape: f32,
	uLink: vec4f,
	uLinkP: vec4f,
	@size(16) uLinkW: f32,
	@size(16) uScopeW: f32,
	@size(16) uScopeLB: f32,
}
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

var<private> aOrigin: vec3f;
var<private> aTarget: vec3f;
var<private> aColor: vec3f;
var<private> aIdx: f32;
var<private> aSculpt: vec3f;
var<private> aNormal: vec3f;
var<private> aNormalB: vec3f;
var<private> aPaint: vec4f;
var<private> aColorB: vec3f;
var<private> aHide: f32;
var<private> aDepth: f32;
var<private> aPath: f32;
var<private> aVis: vec2f;
var<private> vColor: vec3f;
var<private> vD: f32;
var<private> vDk: f32;
var<private> vCoc: f32;
var<private> vGl: f32;
var<private> gl_Position: vec4f;
var<private> gl_PointSize: f32;

fn glsl_mod_f(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

var<private> gGl: f32 = 0.0;
var<private> gCh: f32 = -1.0;
var<private> gDrop: f32 = 0.0;
var<private> gGrow: f32 = 1.0;
var<private> gGrowE: f32 = 0.0;
var<private> gBurst: f32 = 0.0;
var<private> gScopeG: f32 = 0.0;
var<private> gScopeT: f32 = 0.0;
var<private> gScopeD: f32 = 0.0;
var<private> gDepth: f32 = 0.5;
var<private> gDepthG: f32 = 0.0;
var<private> gNormal: vec3f = vec3f(0.0);
var<private> gLum: f32 = 0.5;
var<private> gHypW: f32 = 0.0;
var<private> gHypF: f32 = 0.0;
var<private> gChN: f32 = 0.0;

fn mod289_vec3(x_in: vec3f) -> vec3f {
	var x: vec3f = x_in;
	return (x - (floor((x * ((1.0 / 289.0)))) * 289.0));
}

fn mod289_vec4(x_in: vec4f) -> vec4f {
	var x: vec4f = x_in;
	return (x - (floor((x * ((1.0 / 289.0)))) * 289.0));
}

fn permute(x_in: vec4f) -> vec4f {
	var x: vec4f = x_in;
	return mod289_vec4((((((x * 34.0)) + 1.0)) * x));
}

fn taylorInvSqrt(r_in: vec4f) -> vec4f {
	var r: vec4f = r_in;
	return (1.79284291400159 - (0.85373472095314 * r));
}

fn snoise(v_in: vec3f) -> f32 {
	var v: vec3f = v_in;
	const C: vec2f = vec2f((1.0 / 6.0), (1.0 / 3.0));
	const D: vec4f = vec4f(0.0, 0.5, 1.0, 2.0);
	var i: vec3f = floor((v + dot(v, C.yyy)));
	var x0: vec3f = ((v - i) + dot(i, C.xxx));
	var g: vec3f = step(x0.yzx, x0.xyz);
	var l: vec3f = (1.0 - g);
	var i1: vec3f = min(g.xyz, l.zxy);
	var i2: vec3f = max(g.xyz, l.zxy);
	var x1: vec3f = ((x0 - i1) + C.xxx);
	var x2: vec3f = ((x0 - i2) + C.yyy);
	var x3: vec3f = (x0 - D.yyy);
	i = mod289_vec3(i);
	var p: vec4f = permute(((permute(((permute((i.z + vec4f(0.0, i1.z, i2.z, 1.0))) + i.y) + vec4f(0.0, i1.y, i2.y, 1.0))) + i.x) + vec4f(0.0, i1.x, i2.x, 1.0)));
	var n_: f32 = 0.142857142857;
	var ns: vec3f = ((n_ * D.wyz) - D.xzx);
	var j: vec4f = (p - (49.0 * floor(((p * ns.z) * ns.z))));
	var x_: vec4f = floor((j * ns.z));
	var y_: vec4f = floor((j - (7.0 * x_)));
	var x: vec4f = ((x_ * ns.x) + ns.yyyy);
	var y: vec4f = ((y_ * ns.x) + ns.yyyy);
	var h: vec4f = ((1.0 - abs(x)) - abs(y));
	var b0: vec4f = vec4f(x.xy, y.xy);
	var b1: vec4f = vec4f(x.zw, y.zw);
	var s0: vec4f = ((floor(b0) * 2.0) + 1.0);
	var s1: vec4f = ((floor(b1) * 2.0) + 1.0);
	var sh: vec4f = -step(h, vec4f(0.0));
	var a0: vec4f = (b0.xzyw + (s0.xzyw * sh.xxyy));
	var a1: vec4f = (b1.xzyw + (s1.xzyw * sh.zzww));
	var p0: vec3f = vec3f(a0.xy, h.x);
	var p1: vec3f = vec3f(a0.zw, h.y);
	var p2: vec3f = vec3f(a1.xy, h.z);
	var p3: vec3f = vec3f(a1.zw, h.w);
	var norm: vec4f = taylorInvSqrt(vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
	p0 *= vec3f(norm.x);
	p1 *= vec3f(norm.y);
	p2 *= vec3f(norm.z);
	p3 *= vec3f(norm.w);
	var m: vec4f = max((0.6 - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))), vec4f(0.0));
	m = (m * m);
	return (42.0 * dot((m * m), vec4f(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))));
}

fn curlNoise(p_in: vec3f) -> vec3f {
	var p: vec3f = p_in;
	const e: f32 = 0.08;
	var n1: f32 = snoise((p + vec3f(e, 0.0, 0.0)));
	var n2: f32 = snoise((p - vec3f(e, 0.0, 0.0)));
	var n3: f32 = snoise((p + vec3f(0.0, e, 0.0)));
	var n4: f32 = snoise((p - vec3f(0.0, e, 0.0)));
	var n5: f32 = snoise((p + vec3f(0.0, 0.0, e)));
	var n6: f32 = snoise((p - vec3f(0.0, 0.0, e)));
	return normalize((vec3f((((n4 - n3)) - ((n6 - n5))), (((n6 - n5)) - ((n2 - n1))), (((n2 - n1)) - ((n4 - n3)))) + 1e-5));
}

fn hash11(p_in: f32) -> f32 {
	var p: f32 = p_in;
	return fract((sin((p * 127.1)) * 43758.5453));
}

fn hit2(b_in: bool) -> f32 {
	var b: bool = b_in;
	return select(0.0, 1.0, b);
}

fn contactAt(c_in: vec3f, st_in: f32, base_in: vec3f, rad_in: vec3f, pos: ptr<function, vec3f>) {
	var c: vec3f = c_in;
	var st: f32 = st_in;
	var base: vec3f = base_in;
	var rad: vec3f = rad_in;
	var dd: vec3f = (base - c);
	var r: f32 = fr.uContact.y;
	var d2: f32 = dot(dd, dd);
	if (((d2 >= (r * r)) || (st < 0.001))) {
		return;
	}
	var f: f32 = (1.0 - (sqrt(d2) / r));
	f = ((f * f) * ((3.0 - (2.0 * f))));
	var k: f32 = ((f * st) * fr.uContact.x);
	if ((fr.uContact.z < 0.5)) {
		(*pos) += ((rad * k) * 0.4);
	} else if ((fr.uContact.z < 1.5)) {
		var ax: vec3f = normalize((c + vec3f(1e-4)));
		var a: f32 = (k * 2.4);
		var q: vec3f = ((*pos) - c);
		(*pos) = (((c + (q * cos(a))) + (cross(ax, q) * sin(a))) + ((ax * dot(ax, q)) * ((1.0 - cos(a)))));
	} else if ((fr.uContact.z < 2.5)) {
		(*pos) -= ((normalize((dd + vec3f(1e-4))) * k) * 0.3);
	} else if ((fr.uContact.z < 3.5)) {
		(*pos) += ((normalize((dd + vec3f(1e-4))) * k) * 0.3);
	} else if ((fr.uContact.z < 4.5)) {
		(*pos) += (((rad * sin(((length(dd) * 20.0) - (fr.uTime * 6.0)))) * k) * 0.14);
	} else if ((fr.uContact.z < 5.5)) {
		var hh: f32 = fract((sin(dot(base.xz, vec2f(12.9898, 78.233))) * 43758.5453));
		(*pos).y -= (((k * k) * 0.55) * ((0.6 + (0.8 * hh))));
		{ let _sw0 = ((*pos).xz + vec2f(((((hh - 0.5)) * k) * 0.06))); (*pos) = vec3f(_sw0.x, (*pos).y, _sw0.y); }
	} else if ((fr.uContact.z < 6.5)) {
		(*pos) += ((curlNoise(((base * 3.0) + (fr.uTime * 0.8))) * k) * 0.45);
	}
}

fn contactK(b_in: vec3f) -> f32 {
	var b: vec3f = b_in;
	var m: f32 = 0.0;
	var r: f32 = (fr.uContact.y * ((1.0 + (0.12 * sin((fr.uTime * 4.0))))));
	for (var i: i32 = 0; (i < 16); i++) {
		if ((f32(i) >= fr.uContact.w)) {
			break;
		}
		var d: f32 = distance(b, fr.uTrk[i].xyz);
		if ((d < r)) {
			m = max(m, (((1.0 - (d / r))) * fr.uTrk[i].w));
		}
	}
	for (var i: i32 = 0; (i < 32); i++) {
		if ((f32(i) >= fr.uShockP.z)) {
			break;
		}
		var d: f32 = distance(b, fr.uImp[i].xyz);
		if ((d < r)) {
			m = max(m, (((1.0 - (d / r))) * fr.uImp[i].w));
		}
	}
	return clamp((m * fr.uContact.x), 0.0, 1.0);
}

fn markK(b_in: vec3f) -> f32 {
	var b: vec3f = b_in;
	if (((fr.uMark.x < 0.5) || (fr.uContact.w < 0.5))) {
		return 0.0;
	}
	var m: f32 = 0.0;
	for (var i: i32 = 0; (i < 16); i++) {
		if ((f32(i) >= fr.uContact.w)) {
			break;
		}
		var d: f32 = distance(b, fr.uTrk[i].xyz);
		if ((d < fr.uMark.y)) {
			m = max(m, (1.0 - (d / fr.uMark.y)));
		}
	}
	return (((m * m) * ((3.0 - (2.0 * m)))) * fr.uMark.z);
}

fn hueRot(c_in: vec3f, a_in: f32) -> vec3f {
	var c: vec3f = c_in;
	var a: f32 = a_in;
	var k: vec3f = vec3f(0.57735);
	return (((c * cos(a)) + (cross(k, c) * sin(a))) + ((k * dot(k, c)) * ((1.0 - cos(a)))));
}

fn sliceK(b_in: vec3f) -> f32 {
	var b: vec3f = b_in;
	if ((fr.uSlice.x < 0.001)) {
		return 0.0;
	}
	var axCode: f32 = glsl_mod_f(fr.uSlice.w, 10.0);
	var nLines: f32 = max(1.0, floor((fr.uSlice.w / 10.0)));
	var c: f32 = select((select((select((((b.x + b.y)) * 0.707), b.z, (axCode < 2.5))), b.x, (axCode < 1.5))), b.y, (axCode < 0.5));
	var v: f32 = clamp((((c + 1.2)) / 2.4), 0.0, 1.0);
	var coord: f32 = glsl_mod_f(((v * nLines) - (fr.uSlice.y * nLines)), 1.0);
	return (((1.0 - smoothstep((fr.uSlice.z * 0.4), fr.uSlice.z, abs((coord - 0.5))))) * fr.uSlice.x);
}

fn disK(b_in: vec3f, idx_in: f32) -> f32 {
	var b: vec3f = b_in;
	var idx: f32 = idx_in;
	if ((fr.uDis.x < 0.001)) {
		return 0.0;
	}
	var st: f32 = fr.uDisP.x;
	var y01: f32 = clamp((((b.y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
	if (((st > 2.5) && (st < 3.5))) {
		y01 = (floor(((y01 * 12.0) + 0.001)) / 12.0);
	}
	var h: f32 = select(hash11((idx * 37.3)), hash11((floor((idx * 1800.0)) * 0.731)), (((st > 3.5) && (st < 4.5))));
	var jit: f32 = select(select(select(select(select(select(select(0.1, 0.12, (st < 6.5)), 0.18, (st < 5.5)), 0.3, (st < 4.5)), 0.0, (st < 3.5)), 0.03, (st < 2.5)), 0.28, (st < 1.5)), 0.16, (st < 0.5));
	var m: f32 = fr.uDis.y;
	var still: bool = (fr.uAnimN < 0.5);
	var ord: f32;
	if ((m < 0.5)) {
		ord = (1.0 - y01);
	} else if ((m < 1.5)) {
		ord = select(hash11((idx * 13.7)), ((snoise((b * 1.7)) * 0.5) + 0.5), still);
	} else if ((m < 2.5)) {
		ord = y01;
	} else if ((m < 3.5)) {
		ord = select(y01, clamp(((((b.x - fr.uCen.x)) * 0.3) + 0.5), 0.0, 1.0), still);
	} else {
		var r01: f32 = clamp((length((b - fr.uCen)) / max((((fr.uYR.y - fr.uYR.x)) * 0.6), 0.3)), 0.0, 1.0);
		ord = select((1.0 - r01), r01, (m < 4.5));
	}
	ord = ((ord * ((1.0 - jit))) + (h * jit));
	var w: f32 = max(fr.uDisQ.x, 0.06);
	if (((st > 1.5) && (st < 2.5))) {
		w *= 0.45;
	}
	return clamp(((((fr.uDis.x * ((1.0 + w))) - ord)) / w), 0.0, 1.0);
}

fn growK(b_in: vec3f, idx_in: f32) -> f32 {
	var b: vec3f = b_in;
	var idx: f32 = idx_in;
	var S: f32 = max((fr.uYR.y - fr.uYR.x), 0.5);
	var y01: f32 = clamp((((b.y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
	var d: f32;
	if ((fr.uGrow.y < 0.5)) {
		d = ((y01 * 0.8) + (clamp((length((b.xz - fr.uCen.xz)) / S), 0.0, 1.0) * 0.2));
	} else if ((fr.uGrow.y < 1.5)) {
		d = clamp((distance(b, fr.uGrowSeed) / ((S * 1.5))), 0.0, 1.0);
	} else {
		d = clamp((length((b - fr.uCen)) / ((S * 0.7))), 0.0, 1.0);
	}
	var nz: f32 = select(hash11((floor((idx * 700.0)) * 0.37)), ((snoise(((b * 3.0) + 7.0)) * 0.5) + 0.5), (fr.uAnimN < 0.5));
	d = clamp(((d + ((((nz - 0.5)) * 0.45) * fr.uGrow.z)) + (((hash11((idx * 9.1)) - 0.5)) * 0.03)), 0.0, 1.0);
	var w: f32 = max(fr.uGrow.w, 0.04);
	return clamp(((((fr.uGrow.x * ((1.0 + w))) - d)) / w), 0.0, 1.0);
}

fn morphLocal(A_in: vec3f, B_in: vec3f, idx_in: f32) -> f32 {
	var A: vec3f = A_in;
	var B: vec3f = B_in;
	var idx: f32 = idx_in;
	var h: f32 = hash11((idx * 3.17));
	var ord: f32 = h;
	var so: i32 = i32((fr.uMorphO.x + 0.5));
	var yN: f32 = clamp((((A.y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
	if ((so == 1)) {
		ord = ((yN * 0.85) + (h * 0.15));
	} else if ((so == 2)) {
		ord = ((((1.0 - yN)) * 0.85) + (h * 0.15));
	} else if ((so == 3)) {
		ord = ((clamp((length(A) / 1.4), 0.0, 1.0) * 0.85) + (h * 0.15));
	} else if ((so == 4)) {
		ord = ((clamp((((A.x + 1.2)) / 2.4), 0.0, 1.0) * 0.85) + (h * 0.15));
	}
	var sg: f32 = fr.uMorphS.z;
	return clamp(((fr.uMorph * ((1.0 + sg))) - (ord * sg)), 0.0, 1.0);
}

fn morphEase(x_in: f32) -> f32 {
	var x: f32 = x_in;
	var e: i32 = i32((fr.uMorphO.y + 0.5));
	if ((e == 1)) {
		return (((x * x) * x) * (((x * (((x * 6.0) - 15.0))) + 10.0)));
	}
	if ((e == 2)) {
		var c1: f32 = 1.70158;
		var y: f32 = (x - 1.0);
		return ((1.0 + (((((c1 + 1.0)) * y) * y) * y)) + ((c1 * y) * y));
	}
	return ((x * x) * ((3.0 - (2.0 * x))));
}

fn frPlace(lay_in: f32, k_in: f32, n_in: f32, u_in: f32, v_in: f32, nrm: ptr<function, vec3f>) -> vec3f {
	var lay: f32 = lay_in;
	var k: f32 = k_in;
	var n: f32 = n_in;
	var u: f32 = u_in;
	var v: f32 = v_in;
	var t: f32 = select(0.5, (k / ((n - 1.0))), (n > 1.0));
	var W: f32 = fr.uFr2.z;
	var H: f32 = fr.uFr2.w;
	var depth: f32 = fr.uFr3.x;
	(*nrm) = vec3f(0.0, 0.0, 1.0);
	if (((lay > 0.5) && (lay < 1.5))) {
		var gx: f32 = ceil(sqrt((n * ((W / H)))));
		var gy: f32 = ceil((n / gx));
		var s: f32 = min((2.4 / ((gx * W))), (2.4 / ((gy * H))));
		var cx: f32 = glsl_mod_f(k, gx);
		var cy: f32 = floor((k / gx));
		return vec3f(((((((cx - (((gx - 1.0)) * 0.5))) * W) * s) * 1.04) + ((u * W) * s)), (((((((((gy - 1.0)) * 0.5) - cy)) * H) * s) * 1.04) + ((v * H) * s)), 0.0);
	}
	var ad: f32 = (k - fr.uFr4.x);
	ad = 0.0;
	if (((lay > 1.5) && (lay < 2.5))) {
		var sc: f32 = 0.5;
		var aa: f32 = abs(ad);
		var c1: f32 = ((W * 0.54) + ((W * sc) * 0.53));
		var c: f32 = select((c1 + (((((aa - 1.0)) * W) * sc) * 1.06)), (aa * c1), (aa < 1.0));
		var s: f32 = mix(1.0, sc, min(aa, 1.0));
		return vec3f(((sign(ad) * c) + ((u * W) * s)), ((v * H) * s), 0.0);
	}
	var dz: f32 = select(1.0, -1.0, (((fr.uFr4.y > 0.5) && (fr.uFr4.y < 1.5))));
	var kz: f32 = k;
	kz = fr.uFr4.x;
	var cen: f32 = select(fr.uFr4.x, (((n - 1.0)) * 0.5), (fr.uFr6.y > 0.5));
	var ts: f32 = select(1.0, (1.0 - (0.72 * clamp((max(-ad, 0.0) / max((n - 1.0), 1.0)), 0.0, 1.0))), (lay > 2.5));
	return vec3f(((u * W) * ts), ((v * H) * ts), (((((kz - cen)) * depth) / max((n - 1.0), 1.0)) * dz));
}

fn frMix(k_in: f32, u_in: f32, v_in: f32, nrm: ptr<function, vec3f>) -> vec3f {
	var k: f32 = k_in;
	var u: f32 = u_in;
	var v: f32 = v_in;
	var nA: vec3f;
	var nB: vec3f;
	var pA: vec3f = frPlace(fr.uFr3.y, k, fr.uFr.y, u, v, &nA);
	if ((fr.uFr3.w > 0.0001)) {
		var pB: vec3f = frPlace(fr.uFr3.z, k, fr.uFr.y, u, v, &nB);
		var m: f32 = ((fr.uFr3.w * fr.uFr3.w) * ((3.0 - (2.0 * fr.uFr3.w))));
		(*nrm) = normalize(mix(nA, nB, m));
		return mix(pA, pB, m);
	}
	(*nrm) = nA;
	return pA;
}

fn frBlockPos(aIdx_in: f32, nrm: ptr<function, vec3f>, kk: ptr<function, f32>, cell: ptr<function, vec2f>) -> vec3f {
	var aIdx: f32 = aIdx_in;
	var ip: f32 = floor(((aIdx * fr.uHero.z) + 0.5));
	var ci: f32 = glsl_mod_f(ip, fr.uHero.x);
	var cj: f32 = floor((ip / fr.uHero.x));
	(*kk) = clamp(floor((fr.uFr4.x + 0.5)), 0.0, (fr.uFr.y - 1.0));
	(*cell) = vec2f(ci, cj);
	return frMix((*kk), ((((ci + 0.5)) / fr.uHero.x) - 0.5), (0.5 - (((cj + 0.5)) / fr.uHero.y)), nrm);
}

fn frShow(k_in: f32, tcol: ptr<function, vec3f>) -> vec4f {
	var k: f32 = k_in;
	var n: f32 = fr.uFr.y;
	var idx: f32 = fr.uFr4.x;
	var mode: i32 = i32((fr.uFr4.y + 0.5));
	var d: f32 = (k - idx);
	var fw: f32 = max(2.0, (n * 0.04));
	var w: f32 = 1.0;
	var lift: f32 = 0.0;
	var tint: f32 = 0.0;
	(*tcol) = fr.uP2;
	if ((mode == 0)) {
		var hl: f32 = fr.uFr4.w;
		if ((hl > 0.001)) {
			w = ((1.0 - (0.5 * hl)) + ((((0.5 + (1.4 * hl))) * max(0.0, (1.0 - (abs(d) / 2.5)))) * hl));
		}
		if ((d < -0.5)) {
			w *= (0.45 + (0.55 / ((1.0 + (0.2 * (-d))))));
		}
		if ((((d > 0.5) && (fr.uFr6.y < 0.5)) && (abs((fr.uFr3.y - 2.0)) > 0.5))) {
			w *= select(select(1.0, 0.4, (fr.uFr5.z > 0.5)), 0.0, (fr.uFr5.z > 1.5));
		}
	} else if ((mode == 1)) {
		if ((d < 0.0)) {
			w = max(0.0, (1.0 + (d / fw)));
		}
		lift = (1.0 - w);
		w *= (1.0 + (0.25 * max(0.0, (1.0 - abs(d)))));
	} else if ((mode == 2)) {
		if ((d > 0.0)) {
			w = (max(0.0, (1.0 - (d / fw))) * (select(0.0, 0.5, (d <= fw))));
			lift = (-((1.0 - w)) * 0.6);
		}
		w *= (1.0 + (0.25 * max(0.0, (1.0 - abs(d)))));
	} else if ((mode == 3)) {
		var half_: f32 = max(3.0, (n * 0.08));
		var ad: f32 = abs(d);
		w = select(max(0.0, (1.0 - (((ad - half_)) / fw))), 1.0, (ad <= half_));
		lift = ((((1.0 - w)) * sign((d + 0.0001))) * 0.8);
		w *= (1.0 + (0.25 * max(0.0, (1.0 - ad))));
	} else {
		var span: f32 = max(1.5, (n * max(0.02, fr.uFr4.z)));
		if ((mode == 4)) {
			var beam: f32 = exp(((-((d / span)) * ((d / span))) * 2.0));
			var after: f32 = select(0.0, (exp((d / ((span * 2.4)))) * 0.4), (d < 0.0));
			w = ((0.18 + (beam * 1.5)) + after);
			tint = min(0.85, (beam * 0.8));
			lift = select(0.0, -min(0.35, ((-d / n) * 1.2)), (d < 0.0));
		} else {
			var age: f32 = (-d / span);
			if ((d > 0.0)) {
				w = 0.0;
			} else {
				w = (max(0.0, (exp((-age * 1.1)) * 0.9)) + (1.35 * max(0.0, (1.0 - abs(d)))));
				var t: f32 = min(1.0, age);
				(*tcol) = select(mix(fr.uP1, fr.uP2, (((t - 0.5)) * 2.0)), mix(fr.uP0, fr.uP1, (t * 2.0)), (t < 0.5));
				tint = (min(0.9, (0.3 + (age * 0.7))) * ((1.0 - max(0.0, (1.0 - abs(d))))));
				lift = -min(0.6, (age * 0.25));
			}
		}
	}
	return vec4f(w, lift, tint, 0.0);
}

fn dzone(x_in: f32) -> f32 {
	var x: f32 = x_in;
	var a: f32 = abs(x);
	return ((sign(x) * max((a - fr.uDepthQ.x), 0.0)) / max((1.0 - fr.uDepthQ.x), 0.25));
}

fn depthShape(b_in: vec3f) -> vec3f {
	var b: vec3f = b_in;
	var t: f32 = (fr.uTime - fr.uTOff);
	var A: f32 = fr.uDepth.x;
	var sp: f32 = fr.uDepth.z;
	var dn: f32 = select((1.0 - gDepth), gDepth, (fr.uDepthP.y > 0.0));
	var fo: f32 = select((1.0 - fr.uDepth.w), fr.uDepth.w, (fr.uDepthP.y > 0.0));
	var dd: f32 = dzone((dn - fo));
	var md: i32 = i32((fr.uDepth.y + 0.5));
	if ((md == 0)) {
		b.z += ((dd * A) * 1.2);
	} else if ((md == 1)) {
		var N: f32 = max(2.0, floor((fr.uDepthP.x + 0.5)));
		var x: f32 = (dn * N);
		var dq: f32 = (((floor(x) + smoothstep(0.38, 0.62, fract(x)))) / N);
		b.z += ((dzone((dq - fo)) * A) * 1.5);
	} else if ((md == 2)) {
		b.z += (((dd * A) * 1.3) * ((0.5 + (0.5 * sin(((t * sp) * 0.9))))));
	} else if ((md == 3)) {
		b.z += (((dd * A) * 1.4) * ((0.55 + (0.45 * sin(((b.x * 3.2) - ((t * sp) * 1.6)))))));
	} else if ((md == 4)) {
		b.z += ((((dd * 0.6) + ((sin(((length(b.xy) * 9.0) - ((t * sp) * 2.2))) * 0.25) * ((0.35 + dn))))) * A);
	} else if ((md == 5)) {
		var a: f32 = (((dd * A) * 1.6) * sin(((t * sp) * 0.7)));
		var cs: f32 = cos(a);
		var sn: f32 = sin(a);
		{ let _sw1 = (mat2x2f(cs, -sn, sn, cs) * b.xz); b = vec3f(_sw1.x, b.y, _sw1.y); }
		b.z += ((dd * A) * 0.5);
	} else {
		var p: f32 = (0.5 + (0.5 * sin((((t * sp) * 0.8) - 1.5708))));
		b.z += ((dd * A) * ((0.4 + ((1.8 * p) * p))));
		{ let _sw2 = (b.xy * vec2f((1.0 + ((((dd * A) * 0.5) * p) * p)))); b = vec3f(_sw2.x, _sw2.y, b.z); }
	}
	var a: f32 = ((t * sp) * 0.8);
	{ let _sw3 = (b.xy + ((((vec2f(cos(a), (sin(a) * 0.55)) * dd) * fr.uDepthP.z) * A) * 0.4)); b = vec3f(_sw3.x, _sw3.y, b.z); }
	return b;
}

fn hyperWarp(p_in: vec3f, c_in: vec3f, R_in: f32, md_in: f32, a_in: f32, w4: ptr<function, f32>) -> vec3f {
	var p: vec3f = p_in;
	var c: vec3f = c_in;
	var R: f32 = R_in;
	var md: f32 = md_in;
	var a: f32 = a_in;
	var q: vec3f = (((p - c)) / R);
	var r2: f32 = dot(q, q);
	var h: vec4f = (vec4f((2.0 * q), (r2 - 1.0)) / ((r2 + 1.0)));
	var ca: f32 = cos(a);
	var sa: f32 = sin(a);
	if ((md < 0.5)) {
		{ let _sw4 = vec2f(((h.z * ca) - (h.w * sa)), ((h.z * sa) + (h.w * ca))); h = vec4f(h.x, h.y, _sw4.x, _sw4.y); }
	} else if ((md < 1.5)) {
		{ let _sw5 = vec2f(((h.x * ca) - (h.y * sa)), ((h.x * sa) + (h.y * ca))); h = vec4f(_sw5.x, _sw5.y, h.z, h.w); }
		{ let _sw6 = vec2f(((h.z * ca) - (h.w * sa)), ((h.z * sa) + (h.w * ca))); h = vec4f(h.x, h.y, _sw6.x, _sw6.y); }
	} else if ((md < 2.5)) {
		{ let _sw7 = vec2f(((h.x * ca) - (h.w * sa)), ((h.x * sa) + (h.w * ca))); h = vec4f(_sw7.x, h.y, h.z, _sw7.y); }
		var cb: f32 = cos((a * 0.618));
		var sb: f32 = sin((a * 0.618));
		{ let _sw8 = vec2f(((h.y * cb) - (h.z * sb)), ((h.y * sb) + (h.z * cb))); h = vec4f(h.x, _sw8.x, _sw8.y, h.w); }
	} else {
		var b: f32 = (2.4 * sin(a));
		var cb: f32 = cos(b);
		var sb: f32 = sin(b);
		{ let _sw9 = vec2f(((h.z * cb) - (h.w * sb)), ((h.z * sb) + (h.w * cb))); h = vec4f(h.x, h.y, _sw9.x, _sw9.y); }
	}
	(*w4) = h.w;
	var o: vec3f = ((h.xyz / max((1.0 - h.w), 0.03)) * R);
	var ol: f32 = length(o);
	var oc: f32 = select((1.8 + ((1.0 - exp(-((ol - 1.8)))))), ol, (ol < 1.8));
	return (c + (o * ((oc / max(ol, 1e-4)))));
}

fn chF(q_in: vec3f, n_in: f32, m_in: f32) -> f32 {
	var q: vec3f = q_in;
	var n: f32 = n_in;
	var m: f32 = m_in;
	var f: f32 = ((cos((n * q.x)) * cos((m * q.y))) - (cos((m * q.x)) * cos((n * q.y))));
	if ((fr.uFlat > 0.5)) {
		return f;
	}
	return ((((f + (cos((n * q.y)) * cos((m * q.z)))) - (cos((m * q.y)) * cos((n * q.z)))) + (cos((n * q.z)) * cos((m * q.x)))) - (cos((m * q.z)) * cos((n * q.x))));
}

fn chField(q_in: vec3f) -> f32 {
	var q: vec3f = q_in;
	if ((fr.uCh.y < 0.001)) {
		return chF(q, fr.uChA.x, fr.uChA.y);
	}
	if ((fr.uCh.y > 0.999)) {
		return chF(q, fr.uChA.z, fr.uChA.w);
	}
	return mix(chF(q, fr.uChA.x, fr.uChA.y), chF(q, fr.uChA.z, fr.uChA.w), fr.uCh.y);
}

fn fxDisplace(aOrigin_in: vec3f, aTarget_in: vec3f, aIdx_in: f32, base: ptr<function, vec3f>, maskV: ptr<function, f32>) -> vec3f {
	var aOrigin: vec3f = aOrigin_in;
	var aTarget: vec3f = aTarget_in;
	var aIdx: f32 = aIdx_in;
	var t: f32 = (fr.uTime - fr.uTOff);
	var m: f32 = ((fr.uMorph * fr.uMorph) * ((3.0 - (2.0 * fr.uMorph))));
	(*base) = aTarget;
	if (((fr.uFr.x > 0.5) && (fr.uMorph > 0.9999))) {
		var fnrm: vec3f;
		var fk: f32;
		var fcell: vec2f;
		(*base) = frBlockPos(aIdx, &fnrm, &fk, &fcell);
	}
	if ((fr.uMorph < 0.9999)) {
		var lt: f32 = morphLocal(aOrigin, aTarget, aIdx);
		var e: f32 = morphEase(lt);
		var sc: f32 = fr.uMorphS.y;
		var sty: i32 = i32((fr.uMorphS.x + 0.5));
		var mid: vec3f = (((aOrigin + aTarget)) * 0.5);
		var cn: vec3f = curlNoise(((mid * 1.8) + vec3f(0.0, (t * 0.3), 0.0)));
		var ctrl: vec3f = (mid + ((cn * sc) * 0.9));
		var rdir: vec3f = normalize((mid + vec3f(1e-3)));
		if ((sty == 1)) {
			ctrl = (mid + ((normalize((vec3f(-mid.z, 0.0, mid.x) + vec3f(1e-3))) * sc) * 0.9));
		} else if ((sty == 2)) {
			ctrl = ((mid + ((rdir * sc) * 1.6)) + ((cn * sc) * 0.4));
		} else if ((sty == 3)) {
			ctrl = (mid + ((cn * sc) * 0.3));
		} else if ((sty == 4)) {
			ctrl = ((aOrigin + vec3f(0.0, (0.9 * sc), 0.0)) + ((cn * sc) * 0.8));
		} else if ((sty == 5)) {
			ctrl = (vec3f(mid.x, (min(aOrigin.y, aTarget.y) - (1.1 * sc)), mid.z) + ((cn * sc) * 0.25));
		}
		var om: f32 = (1.0 - e);
		(*base) = ((((om * om) * aOrigin) + (((2.0 * om) * e) * ctrl)) + ((e * e) * aTarget));
		if ((sty == 2)) {
			var fl: f32 = (fr.uYR.x - 0.04);
			var h1: f32 = hash11((aIdx * 5.31));
			var h2: f32 = hash11((aIdx * 7.77));
			var h3: f32 = hash11((aIdx * 2.13));
			var dx: vec3f = normalize(((vec3f(aOrigin.x, 0.0, aOrigin.z) + (vec3f((h1 - 0.5), 0.0, (h2 - 0.5)) * 0.9)) + vec3f(1e-3, 0.0, 0.0)));
			var spd: f32 = (((0.35 + (h3 * 1.1))) * sc);
			var vy0: f32 = (((0.5 + (h2 * 1.3))) * sc);
			var te: f32 = clamp((lt / 0.45), 0.0, 1.0);
			var tau: f32 = (te * 1.6);
			var pl: vec3f = aOrigin;
			{ let _sw10 = (pl.xz + (((dx.xz * spd) * ((1.0 - exp(-3.52)))) * 1.4)); pl = vec3f(_sw10.x, pl.y, _sw10.y); }
			pl.y = (fl + (h1 * 0.03));
			var pf: vec3f = aOrigin;
			{ let _sw11 = (pf.xz + (((dx.xz * spd) * ((1.0 - exp((-2.2 * tau))))) * 1.4)); pf = vec3f(_sw11.x, pf.y, _sw11.y); }
			var yf: f32 = max((fl + (h1 * 0.03)), ((aOrigin.y + (vy0 * tau)) - ((2.1 * tau) * tau)));
			pf.y = mix(yf, pl.y, smoothstep(0.85, 1.0, te));
			var tg: f32 = clamp((((lt - 0.58)) / 0.42), 0.0, 1.0);
			var eg: f32 = ((tg * tg) * ((3.0 - (2.0 * tg))));
			var c2: vec3f = (((((pl + aTarget)) * 0.5) + vec3f(0.0, (0.5 + (0.6 * h2)), 0.0)) + ((cn * 0.2) * sc));
			var og: f32 = (1.0 - eg);
			var pg: vec3f = ((((og * og) * pl) + (((2.0 * og) * eg) * c2)) + ((eg * eg) * aTarget));
			(*base) = select((select(pg, pl, (lt < 0.58))), pf, (lt < 0.45));
		}
		if ((sty == 6)) {
			var hw4: f32;
			var q4: vec3f = mix(aOrigin, aTarget, smoothstep(0.38, 0.62, e));
			(*base) = hyperWarp(q4, fr.uCen, (1.3 * max(sc, 0.15)), select(0.0, 1.0, (fr.uMorphS.w > 1.05)), ((2.4 * sin((e * 3.1415926535))) * ((0.85 + (0.15 * hash11((aIdx * 2.7)))))), &hw4);
			gHypW = hw4;
			gHypF = max(gHypF, smoothstep(0.55, 0.97, hw4));
		}
		if ((sty == 1)) {
			var ang: f32 = (((sin((e * 3.1415926535)) * fr.uMorphS.w) * 6.2831853) * ((0.6 + (0.4 * hash11((aIdx * 1.3))))));
			var cs: f32 = cos(ang);
			var sn: f32 = sin(ang);
			{ let _sw12 = vec2f((((*base).x * cs) - ((*base).z * sn)), (((*base).x * sn) + ((*base).z * cs))); (*base) = vec3f(_sw12.x, (*base).y, _sw12.y); }
		}
	}
	if ((fr.uDepth.x > 0.001)) {
		(*base) = depthShape((*base));
	}
	var rad: vec3f = normalize(((*base) + vec3f(1e-4)));
	rad = normalize(mix(rad, vec3f(0.0, 0.0, 1.0), (0.8 * fr.uFlat)));
	if (((fr.uAnimN > 0.5) && (dot(gNormal, gNormal) > 0.01))) {
		rad = normalize(gNormal);
	}
	var pos: vec3f = (*base);
	if ((fr.uCh.x > 0.001)) {
		var chh: f32 = (max((fr.uYR.y - fr.uYR.x), 0.5) * 0.5);
		var chk: f32 = ((1.5708 * fr.uCh.z) / chh);
		var chq: vec3f = (((pos - fr.uCen)) * chk);
		var chn: vec3f = select((select(rad, normalize(gNormal), (dot(gNormal, gNormal) > 0.01))), vec3f(0.0, 0.0, 1.0), (fr.uFlat > 0.5));
		for (var ci: i32 = 0; (ci < 4); ci++) {
			var cf: f32 = chField(chq);
			var cg: vec3f = (vec3f((chField((chq + vec3f(0.02, 0.0, 0.0))) - cf), (chField((chq + vec3f(0.0, 0.02, 0.0))) - cf), (chField((chq + vec3f(0.0, 0.0, 0.02))) - cf)) / 0.02);
			cg -= (chn * dot(cg, chn));
			var cst: vec3f = ((-cf * cg) / max(dot(cg, cg), 0.01));
			var csl: f32 = length(cst);
			if ((csl > 0.7)) {
				cst *= vec3f((0.7 / csl));
			}
			chq += cst;
		}
		var cfe: f32 = abs(chField(chq));
		gChN = exp((-cfe * 5.0));
		var ctk: f32 = floor((t * 30.0));
		var cbz: vec3f = (((((vec3f(hash11(((aIdx * 3.1) + ctk)), hash11(((aIdx * 5.7) + ctk)), hash11(((aIdx * 1.3) + ctk))) - 0.5)) * ((1.0 - gChN))) * fr.uCh.w) * ((0.03 + (fr.uBeat * 0.05))));
		pos = mix(pos, ((fr.uCen + (chq / chk)) + cbz), min(fr.uCh.x, 1.0));
	}
	if ((fr.uTwist.x > 0.001)) {
		var y01t: f32 = clamp(((((*base).y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
		var tw: f32 = (fr.uTwist.x * ((1.0 + (select(0.0, (0.35 * sin(((t * fr.uTwist.z) * 2.0))), (fr.uTwist.z > 0.01))))));
		if ((fr.uTwist.y < 0.5)) {
			var a: f32 = ((pos.y * tw) * 1.6);
			var c: f32 = cos(a);
			var s: f32 = sin(a);
			{ let _sw13 = (mat2x2f(c, -s, s, c) * pos.xz); pos = vec3f(_sw13.x, pos.y, _sw13.y); }
		} else if ((fr.uTwist.y < 1.5)) {
			pos.x += (((y01t * y01t) * tw) * 0.9);
			pos.y -= ((((y01t * y01t) * y01t) * tw) * 0.16);
		} else if ((fr.uTwist.y < 2.5)) {
			{ let _sw14 = (pos.xz * vec2f((1.0 + (((tw * 0.6) * ((0.5 - y01t))) * 2.0)))); pos = vec3f(_sw14.x, pos.y, _sw14.y); }
		} else if ((fr.uTwist.y < 3.5)) {
			var sw: f32 = sin(((pos.y * 3.2) - (t * ((0.9 + fr.uTwist.z)))));
			pos.x += ((sw * tw) * 0.2);
			pos.z += ((cos(((pos.y * 3.2) - (t * ((0.9 + fr.uTwist.z))))) * tw) * 0.12);
		} else {
			{ let _sw15 = (pos.xz * vec2f((1.0 + ((tw * 0.3) * sin(((y01t * 6.2831) - (t * ((1.2 + fr.uTwist.z))))))))); pos = vec3f(_sw15.x, pos.y, _sw15.y); }
		}
	}
	if ((fr.uWave.x > 0.001)) {
		var wv: f32 = 0.0;
		if ((fr.uWaveP.y < 0.5)) {
			wv = sin((((distance((*base), fr.uWaveSrc.xyz) * fr.uWave.y) * 2.0) - ((t * 3.0) * fr.uWaveP.x)));
		} else if ((fr.uWaveP.y < 1.5)) {
			var age: f32 = (fr.uTime - fr.uWaveP.w);
			if ((age > 0.0)) {
				var d: f32 = distance((*base), fr.uWaveSrc.xyz);
				var ring: f32 = ((age * fr.uWaveP.x) * 1.3);
				wv = ((sin(((((d - ring)) * fr.uWave.y) * 2.6)) * exp((-abs((d - ring)) * 2.5))) * exp((-age * fr.uWaveP.z)));
			}
		} else if ((fr.uWaveP.y < 2.5)) {
			var wd: vec3f = vec3f(cos(fr.uWaveSrc.w), 0.0, sin(fr.uWaveSrc.w));
			wv = sin((((dot((*base), wd) * fr.uWave.y) * 2.0) - ((t * 3.0) * fr.uWaveP.x)));
		} else if ((fr.uWaveP.y < 3.5)) {
			var yw: f32 = clamp(((((*base).y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
			wv = sin((((atan2(((*base).z - fr.uCen.z), ((*base).x - fr.uCen.x)) * 3.0) + ((yw * fr.uWave.y) * 1.3)) - ((t * 3.0) * fr.uWaveP.x)));
		} else {
			wv = sin(((((*base).y * fr.uWave.y) * 2.0) - ((t * 3.0) * fr.uWaveP.x)));
		}
		pos += ((((rad * wv) * fr.uWave.x) * 0.14) * ((1.0 + (1.5 * fr.uFlat))));
	}
	if ((fr.uSpec.x > 0.001)) {
		var y01s: f32 = clamp(((((*base).y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
		if ((fr.uSpec.y < 0.5)) {
			pos += (((rad * textureSampleLevel(specTex, linSamp, vec2f((abs(atan2((*base).z, (*base).x)) / 3.1415926535), 0.5), 0.0).r) * fr.uSpec.x) * 0.7);
		} else if ((fr.uSpec.y < 1.5)) {
			pos += (((rad * textureSampleLevel(specTex, linSamp, vec2f(y01s, 0.5), 0.0).r) * fr.uSpec.x) * 0.7);
		} else if ((fr.uSpec.y < 2.5)) {
			var ub: f32 = (floor(((abs(atan2((*base).z, (*base).x)) / 3.1415926535) * fr.uSpecP.y)) / fr.uSpecP.y);
			pos += (((rad * textureSampleLevel(specTex, linSamp, vec2f(ub, 0.5), 0.0).r) * fr.uSpec.x) * 0.8);
		} else {
			var xs: f32 = clamp((abs((*base).x) / 1.2), 0.0, 1.0);
			pos.y += (((textureSampleLevel(specTex, linSamp, vec2f(xs, 0.5), 0.0).r * fr.uSpec.x) * 0.8) * ((0.35 + (0.65 * y01s))));
		}
	}
	var pe: f32 = fr.uPulse.x;
	if ((fr.uPulseP.x > 0.5)) {
		var age: f32 = ((fr.uTime - fr.uPulseP.z) - (length((*base)) * fr.uPulseP.y));
		var env: f32 = select(0.0, (exp(((-age * 3.2) * fr.uPulseP.w)) * smoothstep(0.0, 0.04, age)), (age > 0.0));
		var age2: f32 = (age - 0.2);
		env += select(0.0, ((0.55 * exp(((-age2 * 3.2) * fr.uPulseP.w))) * smoothstep(0.0, 0.04, age2)), (age2 > 0.0));
		pe = ((fr.uPulse.x * env) * 1.6);
		if ((fr.uPulseP.x > 1.5)) {
			pos.y *= (1.0 + (pe * 0.2));
			{ let _sw16 = (pos.xz * vec2f((1.0 - (pe * 0.11)))); pos = vec3f(_sw16.x, pos.y, _sw16.y); }
			pe = 0.0;
		}
	}
	pos += (((rad * pe) * 0.28) * ((1.0 + (1.5 * fr.uFlat))));
	pos *= vec3f((1.0 + (pe * 0.1)));
	if ((fr.uBlast.x > 0.001)) {
		var age: f32 = (fr.uTime - fr.uBlast.w);
		if ((age > 0.0)) {
			var env: f32 = (exp((-age * fr.uBlast.y)) * cos(((age * fr.uBlast.y) * 3.0)));
			var rnd: f32 = (0.45 + (0.55 * mix(1.0, hash11((aIdx * 7.1)), fr.uBlast.z)));
			var dir: vec3f = normalize((rad + ((((vec3f(hash11(aIdx), hash11((aIdx + 1.0)), hash11((aIdx + 2.0))) - 0.5)) * 0.7) * fr.uBlast.z)));
			pos += ((((dir * env) * rnd) * fr.uBlast.x) * 0.75);
		}
	}
	if ((fr.uFlow.x > 0.001)) {
		var fc: vec3f = curlNoise((((*base) * fr.uFlow.y) + vec3f(0.0, ((t * fr.uFlow.z) * 0.1), 0.0)));
		var tg: vec3f = normalize(((fc - (rad * dot(fc, rad))) + vec3f(1e-4)));
		tg = ((tg * cos(fr.uFlow.w)) + (cross(rad, tg) * sin(fr.uFlow.w)));
		var ph: f32 = ((t * fr.uFlow.z) + (hash11((aIdx * 5.3)) * 6.2831));
		pos += (((tg * sin(ph)) * fr.uFlow.x) * 0.24);
	}
	if (((fr.uMark.x > 3.5) && (fr.uMark.x < 5.5))) {
		var mkd: f32 = markK((*base));
		if ((fr.uMark.x < 4.5)) {
			pos += ((rad * mkd) * 0.22);
		} else {
			pos = mix(pos, (((floor((pos / 0.06)) + 0.5)) * 0.06), smoothstep(0.0, 0.4, mkd));
		}
	}
	if (((fr.uSliceM.x > 0.5) && (fr.uSliceM.x < 1.5))) {
		pos += ((rad * sliceK((*base))) * fr.uSliceM.y);
	}
	var dk: f32 = disK((*base), aIdx);
	if ((dk > 0.0)) {
		var sc: f32 = fr.uDisQ.y;
		var ds: f32 = fr.uDisP.x;
		var y01d: f32 = clamp(((((*base).y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
		var cl: f32 = floor((aIdx * 1800.0));
		var ch: f32 = hash11((cl * 0.731));
		var ch2: f32 = hash11(((cl * 1.913) + 3.1));
		var cd: vec3f = ((*base) - fr.uCen);
		var outd: vec3f = (cd / ((length(cd) + 1e-3)));
		var dsp: vec3f = select(((*base) * 1.8), (vec3f(hash11((aIdx * 1.7)), hash11((aIdx * 2.3)), hash11((aIdx * 3.1))) * 8.0), (fr.uAnimN > 0.5));
		pos += ((((curlNoise((dsp + vec3f(0.0, (-t * 0.6), (t * 0.3)))) * dk) * fr.uDisT) * 0.22) * sc);
		if ((ds < 0.5)) {
			var wv: vec3f = vec3f(((fr.uDis.w * 1.4) + 0.2), (-fr.uDis.z * 0.5), 0.3);
			var sp: f32 = (0.65 + (0.35 * sin(((y01d * 7.0) + (t * 0.8)))));
			pos += (((((wv * dk) * dk) * 1.5) * sp) * sc);
		} else if ((ds < 1.5)) {
			pos.y += (((dk * dk) * ((0.7 + (0.5 * ch)))) * sc);
			{ let _sw17 = (pos.xz + ((((vec2f(sin(((t * 1.5) + (ch * 6.0))), cos(((t * 1.3) + (ch * 5.0)))) * dk) * 0.1) * sc) + ((vec2f((fr.uDis.w * 0.5), 0.0) * dk) * sc))); pos = vec3f(_sw17.x, pos.y, _sw17.y); }
		} else if ((ds < 2.5)) {
			pos += ((((outd * dk) * 0.12) * sc) + vec3f(0.0, ((dk * 0.05) * sc), 0.0));
		} else if ((ds < 3.5)) {
			var band: f32 = floor(((y01d * 12.0) + 0.001));
			var sg: f32 = select(-1.0, 1.0, (glsl_mod_f(band, 2.0) < 0.5));
			pos.x += (((((sg * dk) * dk) * 1.7) * sc) + ((fr.uDis.w * dk) * 0.3));
			pos.y -= ((((dk * dk) * fr.uDis.z) * 0.25) * sc);
		} else if ((ds < 4.5)) {
			var mv: vec3f = vec3f(((((ch - 0.5)) * 0.9) + (fr.uDis.w * 0.3)), 0.0, (((ch2 - 0.5)) * 0.9));
			pos += ((mv * dk) * sc);
			pos.y = max((pos.y - ((((dk * dk) * ((0.5 + fr.uDis.z))) * 1.8) * sc)), (fr.uYR.x + (ch * 0.05)));
		} else if ((ds < 5.5)) {
			pos.y = max((pos.y - ((((dk * dk) * ((0.5 + fr.uDis.z))) * 2.2) * sc)), (fr.uYR.x + (hash11((aIdx * 5.1)) * 0.05)));
			pos.x += (((fr.uDis.w * dk) * 0.25) * sc);
		} else if ((ds < 6.5)) {
			var q: vec3f = ((*base) - fr.uCen);
			var ang: f32 = (((dk * dk) * ((3.2 + (fr.uDis.w * 1.2)))) * sc);
			var cs: f32 = cos(ang);
			var sn: f32 = sin(ang);
			{ let _sw18 = vec2f(((q.x * cs) - (q.z * sn)), ((q.x * sn) + (q.z * cs))); q = vec3f(_sw18.x, q.y, _sw18.y); }
			q *= vec3f((1.0 - ((0.9 * dk) * dk)));
			pos = ((fr.uCen + q) + vec3f(0.0, (((dk * dk) * 0.45) * sc), 0.0));
		} else {
			pos += (((outd * pow(dk, 0.7)) * ((1.1 + (0.3 * ch)))) * sc);
			pos.y -= ((((dk * dk) * fr.uDis.z) * 0.8) * sc);
		}
	}
	if ((fr.uExp.x > 0.001)) {
		var pid: f32 = floor((aIdx * fr.uExp.y));
		var pc: vec3f = textureLoad(pieceTex, vec2i(vec2f((((pid + 0.5)) / 256.0), 0.5) * vec2f(textureDimensions(pieceTex))), 0).xyz;
		var h1: f32 = hash11((pid * 1.7));
		var h2: f32 = hash11((pid * 2.9));
		var h3: f32 = hash11((pid * 4.1));
		var od: vec3f = (pc - fr.uCen);
		var dr: vec3f = normalize(((od + ((((vec3f(h1, h2, h3) - 0.5)) * 0.35) * ((length(od) + 0.3)))) + vec3f(1e-4)));
		var ke: f32 = clamp((((fr.uExp.x - (h2 * fr.uExp.z))) / max((1.0 - fr.uExp.z), 0.2)), 0.0, 1.0);
		ke = ((ke * ke) * ((3.0 - (2.0 * ke))));
		var ax: vec3f = normalize((vec3f((h1 - 0.5), (h3 - 0.5), (h2 - 0.5)) + vec3f(1e-3)));
		var ang: f32 = (((ke * ((h3 - 0.5))) * 3.0) * fr.uExp.w);
		var qe: vec3f = (pos - pc);
		qe = (((qe * cos(ang)) + (cross(ax, qe) * sin(ang))) + ((ax * dot(ax, qe)) * ((1.0 - cos(ang)))));
		pos = ((pc + qe) + (((dr * ke) * fr.uExpP.x) * ((0.5 + (0.5 * h1)))));
	}
	if ((fr.uGrowP.z > 0.5)) {
		gGrow = growK((*base), aIdx);
		gGrowE = ((gGrow * ((1.0 - gGrow))) * 4.0);
		pos += (((rad * gGrowE) * fr.uGrowP.x) * 0.12);
		var yG: f32 = clamp(((((*base).y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
		{ let _sw19 = (pos.xz + ((((vec2f(sin(((t * 1.2) + (yG * 5.0))), cos(((t * 0.9) + (yG * 4.0)))) * 0.018) * fr.uGrowP.y) * gGrow) * ((0.3 + yG)))); pos = vec3f(_sw19.x, pos.y, _sw19.y); }
	}
	{
		for (var ji: i32 = 0; (ji < 3); ji++) {
			var jage: f32 = (fr.uTime - fr.uJel[ji].w);
			if (((jage < 0.0) || (jage > 7.0))) {
				continue;
			}
			var jd: f32 = distance((*base), fr.uJelO[ji].xyz);
			var ja: f32 = (jage - (jd * 0.45));
			if ((ja < 0.0)) {
				continue;
			}
			var env: f32 = (exp((-ja * fr.uJelP.y)) * sin((ja * fr.uJelP.x)));
			pos += (((fr.uJel[ji].xyz * env) * fr.uJelP.z) * 0.35);
			pos += ((((((((*base) - fr.uJelO[ji].xyz)) * env) * fr.uJelP.w) * fr.uJelP.z) * 0.16) * length(fr.uJel[ji].xyz));
		}
	}
	if ((fr.uGrav.x > 0.001)) {
		var gq: vec3f = (pos - fr.uGravP.xyz);
		var gr: f32 = (length(gq) + 1e-3);
		var gin: f32 = (1.0 - smoothstep((fr.uGravP.w * 0.7), (fr.uGravP.w * 1.7), gr));
		var ga: f32 = smoothstep(0.0, 1.0, clamp((fr.uGrav.x * gin), 0.0, 1.0));
		var up: vec3f = normalize(vec3f((sin(fr.uGravT.x) * cos(fr.uGravT.y)), cos(fr.uGravT.x), (sin(fr.uGravT.x) * sin(fr.uGravT.y))));
		var ref_: vec3f = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), (abs(up.y) < 0.99));
		var e1: vec3f = normalize(cross(ref_, up));
		var e2: vec3f = cross(up, e1);
		var lx: f32 = dot(gq, e1);
		var lh: f32 = dot(gq, up);
		var lz: f32 = dot(gq, e2);
		if ((fr.uGrav.y < 0.5)) {
			var ph0: f32 = ((t * fr.uGrav.z) * 0.45);
			var ang: f32 = (ga * (((ph0 * 0.8) + ((1.3 * sin((ph0 * 0.6))) / ((0.5 + gr))))));
			var ca: f32 = cos(ang);
			var sa: f32 = sin(ang);
			var nx: f32 = ((lx * ca) - (lz * sa));
			var nz: f32 = ((lx * sa) + (lz * ca));
			var az: f32 = atan2(nz, nx);
			lh = ((lh * ((1.0 - (fr.uGrav.w * ga)))) + (((0.07 * gr) * sin(((az * 2.0) + (t * 0.4)))) * ga));
			var arm: f32 = sin((((2.0 * az) - (3.4 * log((gr + 0.15)))) + (t * 0.25)));
			var ar: f32 = (1.0 + (((0.2 * arm) * ga) * fr.uGrav.w));
			lx = (nx * ar);
			lz = (nz * ar);
		} else if ((fr.uGrav.y < 1.5)) {
			var h1: f32 = hash11((aIdx * 91.7));
			var ph: f32 = fract((((t * 0.16) * fr.uGrav.z) + h1));
			var sg: f32 = select(-1.0, 1.0, (h1 > 0.5));
			var r0: f32 = max(gr, 0.08);
			if (((ph < 0.8) || (fr.uGravT.w < 0.01))) {
				var s: f32 = clamp((ph / 0.8), 0.0, 1.0);
				var rr: f32 = ((r0 * pow((1.0 - s), 1.6)) + 0.03);
				var ang: f32 = (((s * s) * 11.0) * ga);
				var az0: f32 = atan2(lz, lx);
				var flt: f32 = (1.0 - ((fr.uGrav.w * s) * ga));
				var ha: f32 = (lh * flt);
				var k: f32 = mix(1.0, (rr / r0), ga);
				var rl: f32 = (length(vec2f(lx, lz)) * k);
				lx = (cos((az0 + ang)) * rl);
				lz = (sin((az0 + ang)) * rl);
				lh = (ha * mix(1.0, (rr / r0), ga));
			} else {
				var u: f32 = (((ph - 0.8)) / 0.2);
				var len: f32 = ((((fr.uGravT.w * ((0.4 + (h1 * 0.9)))) * u) * u) * ga);
				var az0: f32 = (atan2(lz, lx) + (t * 2.0));
				lx = ((cos(az0) * 0.05) * ((1.0 - (u * 0.5))));
				lz = ((sin(az0) * 0.05) * ((1.0 - (u * 0.5))));
				lh = (sg * ((0.08 + len)));
			}
		} else if ((fr.uGrav.y > 3.5)) {
			var rr0: f32 = length(vec2f(lx, lz));
			var ringN: f32 = floor((rr0 * 5.0));
			var rr1: f32 = mix(rr0, (((ringN + 0.5)) / 5.0), (ga * 0.85));
			var dirR: f32 = select(-1.0, 1.0, (glsl_mod_f(ringN, 2.0) < 0.5));
			var az1: f32 = (atan2(lz, lx) + ((((dirR * t) * fr.uGrav.z) * ((0.25 + (0.5 / ((0.4 + rr1)))))) * ga));
			lx = (cos(az1) * rr1);
			lz = (sin(az1) * rr1);
			lh = (lh * ((1.0 - (fr.uGrav.w * ga))));
		} else if ((fr.uGrav.y > 2.5)) {
			var q: vec3f = (((e1 * lx) + (up * lh)) + (e2 * lz));
			var ax: vec3f = normalize((vec3f((hash11((aIdx * 13.1)) - 0.5), (hash11((aIdx * 7.7)) - 0.5), (hash11((aIdx * 3.3)) - 0.5)) + vec3f(1e-3)));
			var ang: f32 = ((((t * fr.uGrav.z) * ((0.7 + (1.6 / ((gr + 0.3)))))) * ga) * ((0.6 + (0.8 * hash11((aIdx * 5.9))))));
			q = (((q * cos(ang)) + (cross(ax, q) * sin(ang))) + ((ax * dot(ax, q)) * ((1.0 - cos(ang)))));
			q *= vec3f((1.0 + (((fr.uGravT.z * 0.3) * ga) * sin(((t * 0.8) + (aIdx * 40.0))))));
			lx = dot(q, e1);
			lh = dot(q, up);
			lz = dot(q, e2);
		} else {
			var sd: f32 = (aIdx * 61.0);
			var ang: f32 = (((0.14 * fr.uGrav.z) * t) * ga);
			var ca: f32 = cos(ang);
			var sa: f32 = sin(ang);
			var nx: f32 = ((lx * ca) - (lz * sa));
			var nz: f32 = ((lx * sa) + (lz * ca));
			var amp: f32 = (0.4 + (fr.uGravT.z * 1.2));
			lx = (nx + (((ga * 0.12) * amp) * sin((((t * 0.55) * fr.uGrav.z) + (sd * 1.3)))));
			lz = (nz + (((ga * 0.12) * amp) * cos((((t * 0.5) * fr.uGrav.z) + (sd * 0.8)))));
			lh += (((ga * 0.2) * amp) * sin((((t * 0.7) * fr.uGrav.z) + sd)));
			var br: f32 = (1.0 + (((0.2 * amp) * ga) * ((0.5 + (0.5 * sin((((t * 0.35) * fr.uGrav.z) + (sd * 0.4))))))));
			lx *= br;
			lz *= br;
			lh *= br;
		}
		pos = (((fr.uGravP.xyz + (e1 * lx)) + (up * lh)) + (e2 * lz));
	}
	if ((fr.uCurl.x > 0.001)) {
		var ca: f32 = (pow(fr.uCurl.x, 1.45) * 0.055);
		var thr: f32 = ((snoise((((*base) * 1.8) + (t * 0.3))) * 0.5) + 0.5);
		var det: f32 = smoothstep(0.35, 0.85, (thr + (min(fr.uCurl.x, 1.0) * 0.12)));
		var cn: vec3f = ((curlNoise((((*base) * fr.uCurl.y) + (vec3f((t * 0.4), (t * 0.3), (t * 0.5)) * fr.uCurlP.x))) * det) * ca);
		if ((fr.uCurlP.z > 1.5)) {
			var yc: f32 = clamp(((((*base).y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
			var band: f32 = floor(((yc * 8.0) + 0.001));
			var sg: f32 = select(-1.0, 1.0, (glsl_mod_f(band, 2.0) < 0.5));
			var ang: f32 = (((sg * sin((((t * fr.uCurlP.x) * 0.7) + (band * 0.8)))) * min(fr.uCurl.x, 2.0)) * 0.55);
			var q: vec3f = (pos - fr.uCen);
			var cs: f32 = cos(ang);
			var sn: f32 = sin(ang);
			{ let _sw20 = vec2f(((q.x * cs) - (q.z * sn)), ((q.x * sn) + (q.z * cs))); q = vec3f(_sw20.x, q.y, _sw20.y); }
			pos = (fr.uCen + q);
			cn = vec3f(0.0);
		} else if ((fr.uCurlP.z > 0.5)) {
			var fd: vec3f = vec3f(cos(fr.uCurlP.y), 0.35, sin(fr.uCurlP.y));
			var ph: f32 = (0.5 + (0.5 * sin((((t * fr.uCurlP.x) * 0.7) + (hash11((aIdx * 3.7)) * 6.2831)))));
			cn += ((((fd * ph) * det) * ca) * 0.9);
		}
		pos += cn;
	}
	if ((fr.uGlitch.x > 0.001)) {
		var yg: f32 = clamp(((((*base).y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
		var spd: f32 = fr.uGlitchP.y;
		var cyc: f32 = ((t * spd) * 1.1);
		var bst: f32 = (step(0.55, hash11(((floor(cyc) * 3.17) + 1.3))) * ((1.0 - smoothstep(0.0, 0.4, fract(cyc)))));
		gBurst = bst;
		var I: f32 = (fr.uGlitch.x * ((0.55 + (((0.5 + (fr.uGlitchP.w * 1.6))) * bst))));
		var gm: f32 = fr.uGlitchP.z;
		var tick: f32 = floor(((t * 10.0) * spd));
		var hit: bool = false;
		if ((gm < 0.5)) {
			var band: f32 = floor((yg * fr.uGlitch.y));
			var r: f32 = hash11(((band * 13.7) + tick));
			if ((r > 0.55)) {
				var shf: f32 = (((((r - 0.5)) * 2.4) * ((hash11((band + 7.0)) - 0.5))) * I);
				pos.x += (shf * ((1.0 + fr.uFlat)));
				pos.z += (((shf * 1.6) * ((hash11((band + 3.0)) - 0.5))) * ((1.0 + fr.uFlat)));
				hit = true;
			}
		} else if ((gm < 1.5)) {
			var cell: vec3f = floor(((*base) * vec3f(4.0, (fr.uGlitch.y * 0.35), 4.0)));
			var r: f32 = hash11((dot(cell, vec3f(12.9, 78.2, 37.7)) + (tick * 1.7)));
			if ((r > 0.62)) {
				var hv: vec3f = (vec3f(hash11((r * 91.0)), hash11((r * 57.0)), hash11((r * 33.0))) - 0.5);
				pos += ((((hv * ((r - 0.55))) * 1.6) * I) * vec3f(1.0, 0.35, 1.0));
				hit = true;
			}
		} else {
			var row: f32 = floor(((yg * fr.uGlitch.y) * 3.0));
			var r: f32 = hash11(((row * 5.3) + (tick * 2.3)));
			if ((r > 0.8)) {
				pos.x += (((((hash11(((row * 9.1) + tick)) - 0.5)) * 2.4) * I) * ((1.0 + fr.uFlat)));
				hit = true;
			}
			pos.x += ((((hash11((row + tick)) - 0.5)) * 0.02) * I);
		}
		if (hit) {
			gGl = I;
			if ((fr.uGlitchP.x > 0.5)) {
				var chn: f32 = floor((hash11(((aIdx * 17.3) + tick)) * 3.0));
				pos.x += ((((chn - 1.0)) * 0.09) * I);
				gCh = chn;
			}
		}
		gDrop = (step(hash11(((aIdx * 3.7) + tick)), (((fr.uGlitch.z * 0.4) * bst) * fr.uGlitch.x)) * hit2(hit));
	}
	if ((fr.uVoxel.x > 0.01)) {
		var vm: f32 = fr.uVoxelP.x;
		var amp: f32 = fr.uVoxelP.w;
		var g: f32 = (mix(0.3, mix(0.035, 0.07, fr.uFlat), clamp(fr.uVoxel.x, 0.0, 1.0)) * fr.uVoxelP.z);
		if (((vm > 1.5) && (vm < 2.5))) {
			g *= (1.0 + (0.35 * sin(((t * fr.uVoxelP.y) * 2.0))));
		}
		var cell: vec3f = floor((pos / g));
		var q: vec3f = (((cell + 0.5)) * g);
		if (((vm > 0.5) && (vm < 1.5))) {
			var h2: f32 = hash11(dot(cell, vec3f(12.9, 78.2, 37.7)));
			q.y += ((((((h2 - 0.5)) * g) * 2.0) * amp) * sin((((t * fr.uVoxelP.y) * 1.5) + (h2 * 6.2831))));
		} else if (((vm > 2.5) && (vm < 3.5))) {
			q.y += (((sin(((dot(cell.xz, vec2f(0.7, 0.5)) * 0.55) - ((t * fr.uVoxelP.y) * 2.0))) * g) * 1.6) * amp);
		} else if (((vm > 3.5) && (vm < 4.5))) {
			var stp: f32 = ((g * 2.0) * max(amp, 0.3));
			q.y = ((((floor((((pos.y - fr.uYR.x)) / stp)) + 0.5)) * stp) + fr.uYR.x);
		} else if ((vm > 4.5)) {
			var hv: vec3f = (vec3f(hash11(dot(cell, vec3f(12.9, 78.2, 37.7))), hash11(dot(cell, vec3f(39.3, 11.1, 52.7))), hash11(dot(cell, vec3f(7.7, 91.3, 23.9)))) - 0.5);
			q += ((((hv * g) * 3.0) * amp) * ((0.5 + (0.5 * sin((((t * fr.uVoxelP.y) * 2.0) + (hv.x * 12.0)))))));
		}
		q.z += (((fr.uFlat * ((gLum - 0.5))) * g) * 9.0);
		pos = mix(pos, q, smoothstep(0.0, 0.25, fr.uVoxel.x));
	}
	if ((fr.uJitter.x > 0.001)) {
		pos += ((vec3f(sin(((t * 17.0) + (aIdx * 91.0))), sin(((t * 13.0) + (aIdx * 57.0))), sin(((t * 11.0) + (aIdx * 33.0)))) * fr.uJitter.x) * 0.03);
	}
	if ((fr.uHyp.x > 0.001)) {
		var hw: f32;
		var hp: vec3f = hyperWarp(pos, fr.uCen, (1.25 / max(fr.uHyp.w, 0.05)), fr.uHyp.z, (fr.uHyp.y - (fr.uTOff * fr.uHypP.w)), &hw);
		var hk: f32 = min(fr.uHyp.x, 1.0);
		pos = mix(pos, hp, hk);
		gHypW = hw;
		gHypF = (smoothstep(mix(0.99, 0.6, fr.uHypP.z), 0.997, hw) * hk);
	}
	(*maskV) = 1.0;
	if ((fr.uMask.x > 0.5)) {
		var y01: f32 = clamp(((((*base).y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
		var soft: f32 = max(fr.uMask.z, 0.02);
		if ((fr.uMask.x < 1.5)) {
			(*maskV) = smoothstep((fr.uMaskA.x - (soft * 0.5)), (fr.uMaskA.x + (soft * 0.5)), y01);
		} else if ((fr.uMask.x < 2.5)) {
			var r: f32 = ((fr.uMask.y * 1.6) + 0.01);
			(*maskV) = (1.0 - smoothstep((r * ((1.0 - soft))), r, distance((*base), fr.uMaskA.xyz)));
		} else if ((fr.uMask.x < 3.5)) {
			var n: f32 = ((snoise((((*base) * 1.6) + vec3f(0.0, fr.uMaskA.w, (fr.uMaskA.w * 0.6)))) * 0.5) + 0.5);
			(*maskV) = smoothstep(((1.0 - fr.uMask.y) - (soft * 0.3)), ((1.0 - fr.uMask.y) + (soft * 0.3)), n);
		} else {
			var w: f32 = ((fr.uMask.y * 0.35) + 0.004);
			(*maskV) = (1.0 - smoothstep(w, ((w + (soft * 0.3)) + 0.02), abs((y01 - fr.uMaskA.x))));
		}
		if ((fr.uMask.w > 0.5)) {
			(*maskV) = (1.0 - (*maskV));
		}
	}
	pos = mix((*base), pos, (*maskV));
	if ((fr.uContact.x > 0.001)) {
		for (var i: i32 = 0; (i < 16); i++) {
			if ((f32(i) >= fr.uContact.w)) {
				break;
			}
			contactAt(fr.uTrk[i].xyz, fr.uTrk[i].w, (*base), rad, &pos);
		}
		for (var i: i32 = 0; (i < 32); i++) {
			if ((f32(i) >= fr.uShockP.z)) {
				break;
			}
			contactAt(fr.uImp[i].xyz, fr.uImp[i].w, (*base), rad, &pos);
		}
	}
	if ((fr.uShockP.x > 0.001)) {
		for (var i: i32 = 0; (i < 4); i++) {
			var age: f32 = fr.uShock[i].w;
			if ((age < 0.0)) {
				continue;
			}
			var dist: f32 = distance((*base), fr.uShock[i].xyz);
			var x: f32 = (((dist - (age * fr.uShockP.y))) / 0.22);
			pos += ((((rad * exp((-x * x))) * exp((-age * 0.9))) * fr.uShockP.x) * 0.45);
		}
	}
	if ((fr.uBrushParam.x > 0.001)) {
		for (var i: i32 = 0; (i < 20); i++) {
			var age: f32 = fr.uBrushHits[i].w;
			if ((age < 0.0)) {
				continue;
			}
			var dist: f32 = distance((*base), fr.uBrushHits[i].xyz);
			var r: f32 = fr.uBrushParam.y;
			if ((dist < r)) {
				var life: f32 = (1.0 - (age / fr.uBrushParam.z));
				var infl: f32 = ((((1.0 - (dist / r))) * life) * fr.uBrushParam.x);
				pos += ((rad * infl) * 0.35);
			}
		}
	}
	if ((fr.uPhysics.x > 0.001)) {
		var seed: f32 = hash11(((aIdx * 1234.56) + 17.1));
		var seed2: f32 = hash11(((aIdx * 2345.67) + 39.3));
		var seed3: f32 = hash11(((aIdx * 3456.78) + 81.7));
		var yP: f32 = clamp(((((*base).y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
		var onset: f32 = (((((1.0 - yP)) * fr.uPhysP.y) * 1.3) + (seed * 0.3));
		var pt: f32 = max(0.0, (fr.uCollapseTime - onset));
		var radd: vec3f = normalize(((*base) + vec3f(1e-3)));
		var tang: vec3f = normalize((vec3f(-(*base).z, 0.0, (*base).x) + vec3f(1e-3, 0.0, 0.0)));
		var v0: vec3f = ((((radd * ((0.5 + (seed * 1.1)))) + ((tang * fr.uPhysP.z) * ((0.3 + (seed3 * 0.9)))))) * fr.uPhysP.x);
		var vy0: f32 = (((0.5 + (seed2 * 1.0))) * fr.uPhysP.x);
		var g: f32 = (fr.uPhysics.y * 3.8);
		var floorY: f32 = (fr.uYR.x - 0.04);
		var drag: f32 = (1.0 - exp((-pt * 1.5)));
		var pPhys: vec3f = (*base);
		pPhys.x += (((v0.x * drag) / 1.5) + ((fr.uPhysics.w * 0.5) * drag));
		pPhys.z += ((v0.z * drag) / 1.5);
		var h0: f32 = max(((*base).y - floorY), 0.0);
		var vimp: f32 = sqrt(((vy0 * vy0) + ((2.0 * g) * h0)));
		var t1: f32 = (((vy0 + vimp)) / g);
		var yy: f32;
		if ((pt < t1)) {
			yy = (((*base).y + (vy0 * pt)) - (((0.5 * g) * pt) * pt));
		} else {
			var tt: f32 = (pt - t1);
			var vy: f32 = (vimp * fr.uPhysics.z);
			var hh: f32 = 0.0;
			for (var b: i32 = 0; (b < 4); b++) {
				var T: f32 = ((2.0 * vy) / g);
				if ((tt < T)) {
					hh = ((vy * tt) - (((0.5 * g) * tt) * tt));
					break;
				}
				tt -= T;
				vy *= fr.uPhysics.z;
			}
			yy = (floorY + max(hh, 0.0));
		}
		pPhys.y = max(yy, floorY);
		var spinA: f32 = (((((1.0 - exp((-pt * 1.2)))) * fr.uPhysP.z) * ((seed2 - 0.5))) * 2.0);
		var sq: vec2f = pPhys.xz;
		var cs: f32 = cos(spinA);
		var sn: f32 = sin(spinA);
		{ let _sw21 = vec2f(((sq.x * cs) - (sq.y * sn)), ((sq.x * sn) + (sq.y * cs))); pPhys = vec3f(_sw21.x, pPhys.y, _sw21.y); }
		var strength: f32 = min(1.0, fr.uPhysics.x);
		var target_: vec3f = mix(pos, pPhys, strength);
		if ((fr.uAsm > 0.0)) {
			var s0: f32 = ((yP * 0.42) + (seed * 0.2));
			var sA: f32 = clamp(((((fr.uAsm * 1.4) - s0)) / 0.55), 0.0, 1.0);
			var eA: f32 = ((sA * sA) * ((3.0 - (2.0 * sA))));
			var side: vec3f = normalize((cross((pPhys - pos), vec3f(0.0, 1.0, 0.0)) + vec3f(1e-3)));
			target_ = mix(target_, pos, eA);
			target_ += (((side * sin((eA * 3.14159))) * 0.45) * ((seed3 - 0.3)));
			target_.y += ((sin((eA * 3.14159)) * 0.5) * ((0.4 + seed)));
		}
		pos = target_;
	}
	if ((fr.uHandP.x > 0.001)) {
		for (var i: i32 = 0; (i < 12); i++) {
			if ((f32(i) >= fr.uHandP.w)) {
				break;
			}
			var hd: vec3f = (pos - fr.uHand[i].xyz);
			var r: f32 = fr.uHandP.y;
			var d2: f32 = dot(hd, hd);
			if ((d2 < (r * r))) {
				var f: f32 = (1.0 - (sqrt(d2) / r));
				f = ((f * f) * ((3.0 - (2.0 * f))));
				var hs: f32 = fr.uHand[i].w;
				if ((hs > 1.5)) {
					hs -= 2.0;
					var a: f32 = (((f * hs) * fr.uHandP.x) * 2.6);
					var ca: f32 = cos(a);
					var sa: f32 = sin(a);
					var q: vec2f = (pos.xz - fr.uHand[i].xz);
					{ let _sw22 = (fr.uHand[i].xz + vec2f(((q.x * ca) - (q.y * sa)), ((q.x * sa) + (q.y * ca)))); pos = vec3f(_sw22.x, pos.y, _sw22.y); }
					pos.y += (((f * hs) * fr.uHandP.x) * 0.12);
				} else {
					pos += ((((normalize((hd + vec3f(1e-3))) * f) * hs) * fr.uHandP.x) * 0.75);
				}
			}
		}
	}
	if (((fr.uMouseOn > 0.5) && (fr.uCursor.x > 0.001))) {
		var tm: vec3f = (pos - fr.uMouse);
		var r2: f32 = (fr.uCursor.y * fr.uCursor.y);
		var d2: f32 = dot(tm, tm);
		if ((d2 < r2)) {
			var f: f32 = (1.0 - (d2 / r2));
			if ((fr.uCursor.z > 1.5)) {
				var vax: vec3f = normalize((vec3f(fr.modelViewMatrix[0][2], fr.modelViewMatrix[1][2], fr.modelViewMatrix[2][2]) + vec3f(1e-5)));
				var ca: f32 = (((f * f) * fr.uCursor.x) * 2.2);
				var cc: f32 = cos(ca);
				var cs: f32 = sin(ca);
				pos = (((fr.uMouse + (tm * cc)) + (cross(vax, tm) * cs)) + ((vax * dot(vax, tm)) * ((1.0 - cc))));
			} else {
				pos += (((((normalize((tm + vec3f(1e-3))) * f) * f) * fr.uCursor.x) * 0.6) * fr.uCursor.z);
			}
		}
	}
	return pos;
}

fn frLayerDepth(k_in: f32, g_in: vec2f) -> f32 {
	var k: f32 = k_in;
	var g: vec2f = g_in;
	var layer: i32 = i32(glsl_mod_f((k + fr.uFr5.x), fr.uFr.y));
	var m: vec2f = vec2f((fr.uFr2.x - 1.0), (fr.uFr2.y - 1.0));
	var p: vec2f = clamp(g, vec2f(0.0), m);
	var p0: vec2f = floor(p);
	var f: vec2f = (p - p0);
	var p1: vec2f = min((p0 + vec2f(1.0)), m);
	var d00: f32 = textureLoad(frTex, vec3i(i32(p0.x), i32(p0.y), layer).xy, vec3i(i32(p0.x), i32(p0.y), layer).z, 0).a;
	var d10: f32 = textureLoad(frTex, vec3i(i32(p1.x), i32(p0.y), layer).xy, vec3i(i32(p1.x), i32(p0.y), layer).z, 0).a;
	var d01: f32 = textureLoad(frTex, vec3i(i32(p0.x), i32(p1.y), layer).xy, vec3i(i32(p0.x), i32(p1.y), layer).z, 0).a;
	var d11: f32 = textureLoad(frTex, vec3i(i32(p1.x), i32(p1.y), layer).xy, vec3i(i32(p1.x), i32(p1.y), layer).z, 0).a;
	return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
}

fn main_() {
	if ((aHide > 0.5)) {
		gl_Position = vec4f(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
		vColor = vec3f(0.0);
		vD = 0.0;
		vCoc = 0.0;
		vGl = 0.0;
		return;
	}
	var frCol: vec3f = vec3f(1.0);
	var frNrm: vec3f = vec3f(0.0, 0.0, 1.0);
	var frLift: f32 = 0.0;
	var frAp: f32 = -1.0;
	var frDep: f32 = 0.5;
	if ((fr.uFr.x > 0.5)) {
		var fk: f32;
		var fcell: vec2f;
		var fp: vec3f = frBlockPos(aIdx, &frNrm, &fk, &fcell);
		frAp = (((fcell.y + (fcell.x / fr.uHero.x))) / fr.uHero.y);
		var tcol: vec3f;
		var sh: vec4f = frShow(fk, &tcol);
		if ((fr.uFr4.y < 0.5)) {
			sh.x = 1.0;
		}
		var cull: bool = (sh.x < 0.02);
		if (((fr.uAdd < 0.5) && (sh.x < 1.0))) {
			if ((fract((sin((dot(fcell, vec2f(39.346, 11.135)) + (fk * 1.713))) * 24634.6345)) > sh.x)) {
				cull = true;
			}
		}
		if ((fr.uAdd < 0.5)) {
			sh.x = 1.0;
		}
		if (cull) {
			gl_Position = vec4f(2.0, 2.0, 2.0, 1.0);
			gl_PointSize = 0.0;
			vColor = vec3f(0.0);
			vD = 0.0;
			vCoc = 0.0;
			vGl = 0.0;
			return;
		}
		var layer: i32 = i32(glsl_mod_f((fk + fr.uFr5.x), fr.uFr.y));
		var fc: vec3f = textureSampleLevel(heroTex, linSamp, vec2f((((fcell.x + 0.5)) / fr.uHero.x), (1.0 - (((fcell.y + 0.5)) / fr.uHero.y))), 0.0).rgb;
		var l: f32 = dot(fc, vec3f(0.3, 0.59, 0.11));
		frCol = ((((fc * ((1.0 - sh.z))) + ((tcol * ((0.35 + (l * 1.6)))) * sh.z))) * sh.x);
		frLift = sh.y;
		if ((fr.uDepth.x > 0.001)) {
			var hg: vec2f = (((((fcell + 0.5)) / fr.uHero.xy) * fr.uFr2.xy) - 0.5);
			var hk0: f32 = clamp(floor(fr.uFr4.x), 0.0, (fr.uFr.y - 1.0));
			var hk1: f32 = min((hk0 + 1.0), (fr.uFr.y - 1.0));
			frDep = mix(frLayerDepth(hk0, hg), frLayerDepth(hk1, hg), clamp((fr.uFr4.x - hk0), 0.0, 1.0));
			frDep = pow(max(clamp((((((frDep - 0.5)) * fr.uDepthQ.z) + 0.5) + fr.uDepthQ.y), 0.0, 1.0), 1e-4), fr.uDepthQ.w);
		}
	}
	var base: vec3f;
	var maskV: f32;
	gDepth = select(aDepth, frDep, (fr.uFr.x > 0.5));
	gNormal = aNormal;
	gLum = select(dot(aColor, vec3f(0.3, 0.59, 0.11)), dot(frCol, vec3f(0.3, 0.59, 0.11)), (fr.uFr.x > 0.5));
	if ((fr.uScope.x > 0.001)) {
		var rv: bool = (fr.uScope.y > 1.5);
		var cm: f32 = select(fr.uScope.y, (fr.uScope.y - 2.0), rv);
		var ap0: f32 = select(aPath, frAp, (frAp >= 0.0));
		var ap: f32 = select(ap0, (1.0 - ap0), rv);
		if ((fr.uScopeP.w > 1.5)) {
			ap = fract((ap * fr.uScopeP.w));
		}
		var sAge: f32 = (fr.uScope.z - ap);
		var hideAll: f32 = ((select(0.0, 1.0, (ap < fr.uScopeP.z))) * min(1.0, (fr.uScopeP.x * 4.0)));
		if ((sAge >= 0.0)) {
			gScopeT = ((select(exp(((-sAge * 4.0) / max(fr.uScope.w, 0.02))), 1.0, (cm < 0.5))) * fr.uScopeP.y);
			gScopeG = (exp((-sAge * 45.0)) * fr.uScopeP.y);
			if (((fr.uScopeP.z > 0.0) && (ap >= fr.uScopeP.z))) {
				gScopeG = max(gScopeG, exp((-((ap - fr.uScopeP.z)) * 45.0)));
			}
			gScopeD = hideAll;
		} else {
			gScopeD = max(clamp(((fr.uScopeP.x * fr.uScope.x) * 1.6), 0.0, 1.0), hideAll);
		}
	}
	var pos: vec3f = fxDisplace(aOrigin, aTarget, aIdx, &base, &maskV);
	pos += aSculpt;
	if ((gScopeG > 0.01)) {
		pos += (((((vec3f(hash11((aIdx * 13.1)), hash11((aIdx * 7.7)), hash11((aIdx * 3.3))) - 0.5)) * gScopeG) * fr.uScopeQ.w) * 0.4);
	}
	if ((fr.uFr.x > 0.5)) {
		pos += ((frNrm * frLift) * 0.7);
	}
	var dkv: f32 = disK(base, aIdx);
	vDk = max(max(dkv, gDrop), (1.0 - gGrow));
	var t: f32 = (fr.uTime - fr.uTOff);
	var disp: f32 = clamp((length((pos - base)) * 1.5), 0.0, 1.0);
	var k: f32;
	if ((fr.uColorBy < 0.5)) {
		k = clamp((disp + (fr.uBeat * 0.12)), 0.0, 1.0);
	} else if ((fr.uColorBy < 1.5)) {
		k = clamp((((pos.y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
	} else {
		k = fract(((aIdx * 3.0) + (t * 0.03)));
	}
	var col: vec3f = select(mix(fr.uP1, fr.uP2, (((k - 0.5)) * 2.0)), mix(fr.uP0, fr.uP1, (k * 2.0)), (k < 0.5));
	var ltC: f32 = select(1.0, morphLocal(aOrigin, aTarget, aIdx), (fr.uMorph < 0.9999));
	var eC: f32 = select(1.0, (select(morphEase(ltC), smoothstep(0.5, 0.9, ltC), (i32((fr.uMorphS.x + 0.5)) == 2))), (fr.uMorph < 0.9999));
	var colM: vec3f = mix(aColor, aColorB, eC);
	if ((fr.uFr.x > 0.5)) {
		colM = frCol;
	}
	var nrmM: vec3f = mix(aNormal, aNormalB, eC);
	if (((fr.uColorBy > 2.5) && (fr.uColorBy < 3.5))) {
		col = colM;
	} else if (((fr.uColorBy > 3.5) && (fr.uColorBy < 4.5))) {
		col = fr.uSolid;
	} else if ((fr.uColorBy > 4.5)) {
		var wn: vec3f = (mat3x3f(vec3f(fr.modelMatrix[0].xyz), vec3f(fr.modelMatrix[1].xyz), vec3f(fr.modelMatrix[2].xyz)) * nrmM);
		wn = select(vec3f(0.0, 1.0, 0.0), normalize(wn), (length(wn) > 0.0));
		col = pow(((wn * 0.5) + 0.5), vec3f(2.2));
	}
	var vm: f32 = ((fr.uMorph * fr.uMorph) * ((3.0 - (2.0 * fr.uMorph))));
	var vis: f32 = mix(aVis.x, aVis.y, vm);
	vColor = (((col * fr.uBright) * ((1.0 + (fr.uBeat * 0.3)))) * vis);
	if (((fr.uPaintP.x > 0.5) && (aPaint.w > 0.002))) {
		var pa: f32 = aPaint.w;
		var cov: f32 = (1.0 - exp((-pa * 3.4)));
		cov *= mix(1.0, (0.8 + (0.4 * hash11((aIdx * 91.7)))), fr.uPaintP.y);
		var pig: vec3f = pow(max(aPaint.rgb, vec3f(0.002)), vec3f((0.7 + (0.5 * min(pa, 1.6)))));
		vColor = select(mix(vColor, (pig * fr.uBright), cov), (vColor * mix(vec3f(1.0), (pig * 1.15), cov)), (fr.uPaintP.z > 0.5));
	}
	if (((fr.uMask.x > 0.5) && (fr.uMaskShow > 0.5))) {
		vColor = mix(vColor, (fr.uP2 * 1.4), (maskV * 0.55));
	}
	if ((fr.uCh.x > 0.001)) {
		vColor *= vec3f(mix(1.0, (0.45 + (1.1 * gChN)), min(fr.uCh.x, 1.0)));
	}
	if ((fr.uHyp.x > 0.001)) {
		var hk4: f32 = clamp((((gHypW + 1.0)) * 0.5), 0.0, 1.0);
		var hc: vec3f = select(mix(fr.uP1, fr.uP2, (((hk4 - 0.5)) * 2.0)), mix(fr.uP0, fr.uP1, (hk4 * 2.0)), (hk4 < 0.5));
		vColor = mix(vColor, ((hc * fr.uBright) * ((0.55 + (0.9 * dot(vColor, vec3f(0.3, 0.59, 0.11)))))), (fr.uHypP.y * min(fr.uHyp.x, 1.0)));
	}
	vColor *= vec3f((1.0 - (0.6 * gHypF)));
	if (((fr.uShade > 0.001) && (dot(nrmM, nrmM) > 0.01))) {
		var nv: vec3f = normalize((fr.normalMatrix * nrmM));
		var lit: f32 = dot(nv, normalize(vec3f(-0.45, 0.65, 0.6)));
		var f: f32 = (0.18 + (1.05 * pow(clamp(((lit * 0.5) + 0.5), 0.0, 1.0), 1.6)));
		f *= select(1.0, mix(1.0, 0.55, clamp((-nv.z * 1.6), 0.0, 1.0)), (nv.z < 0.0));
		vColor *= vec3f(mix(1.0, f, fr.uShade));
	}
	vGl = clamp(((sqrt(max(dot(vColor, vec3f(0.3, 0.59, 0.11)), 0.0)) * 0.85) + (((hash11((aIdx * 1.7)) - 0.5)) * 0.35)), 0.0, 1.0);
	if ((fr.uBrushParam.x > 0.001)) {
		var bGlow: f32 = 0.0;
		for (var i: i32 = 0; (i < 20); i++) {
			var age: f32 = fr.uBrushHits[i].w;
			if ((age < 0.0)) {
				continue;
			}
			var dist: f32 = distance(base, fr.uBrushHits[i].xyz);
			if ((dist < fr.uBrushParam.y)) {
				var life: f32 = (1.0 - (age / fr.uBrushParam.z));
				bGlow = max(bGlow, (((1.0 - (dist / fr.uBrushParam.y))) * life));
			}
		}
		if ((bGlow > 0.001)) {
			vColor += (((fr.uP2 * bGlow) * 2.2) * fr.uBrushParam.x);
		}
	}
	if ((fr.uHandP.x > 0.001)) {
		var hg: f32 = 0.0;
		for (var i: i32 = 0; (i < 12); i++) {
			if ((f32(i) >= fr.uHandP.w)) {
				break;
			}
			var hdst: f32 = distance(pos, fr.uHand[i].xyz);
			if ((hdst < fr.uHandP.y)) {
				hg = max(hg, (((1.0 - (hdst / fr.uHandP.y))) * (select(abs(fr.uHand[i].w), (fr.uHand[i].w - 2.0), (fr.uHand[i].w > 1.5)))));
			}
		}
		vColor += ((((fr.uP2 * hg) * hg) * 1.6) * fr.uHandP.x);
	}
	var mkv: f32 = markK(base);
	if ((mkv > 0.0)) {
		if ((fr.uMark.x < 1.5)) {
			vColor = mix(vColor, (((vec3f(1.0) - min(vColor, vec3f(1.0)))) * 1.3), mkv);
		} else if ((fr.uMark.x < 2.5)) {
			vColor = mix(vColor, (hueRot(vColor, ((fr.uTime * 2.0) + (length(base) * 6.0))) * 1.15), mkv);
		} else if ((fr.uMark.x < 3.5)) {
			var edge: f32 = (smoothstep(0.0, 0.35, mkv) * ((1.0 - smoothstep(0.35, 0.9, mkv))));
			vColor = ((vColor * ((1.0 - smoothstep(0.35, 0.9, mkv)))) + ((fr.uMarkC * edge) * 2.0));
		} else if ((fr.uMark.x < 4.5)) {
			vColor *= vec3f((1.0 + (mkv * 0.8)));
		} else if ((fr.uMark.x > 5.5)) {
			vColor += ((fr.uMarkC * mkv) * 1.8);
		}
	}
	var cvan: f32 = 0.0;
	if (((fr.uContact.z > 6.5) && (fr.uContact.x > 0.001))) {
		cvan = contactK(base);
		vColor *= vec3f((1.0 - smoothstep(0.1, 0.8, cvan)));
	}
	var sl: f32 = 0.0;
	if ((fr.uSlice.x > 0.001)) {
		var axCode: f32 = glsl_mod_f(fr.uSlice.w, 10.0);
		var nLines: f32 = max(1.0, floor((fr.uSlice.w / 10.0)));
		var c: f32 = select((select((select((((base.x + base.y)) * 0.707), base.z, (axCode < 2.5))), base.x, (axCode < 1.5))), base.y, (axCode < 0.5));
		var v: f32 = clamp((((c + 1.2)) / 2.4), 0.0, 1.0);
		if ((fr.uSliceM.x > 1.5)) {
			var d: f32 = (fr.uSlice.y - v);
			sl = (((1.0 - smoothstep(0.0, ((fr.uSlice.z * 0.3) + 0.012), abs(d)))) * fr.uSlice.x);
			vColor *= vec3f(mix(1.0, smoothstep(-0.012, 0.012, d), min(fr.uSlice.x, 1.0)));
			vColor += (((select(fr.uSliceC, (vColor * 0.25), (fr.uSliceM.z > 0.5))) * sl) * 2.4);
		} else {
			var coord: f32 = glsl_mod_f(((v * nLines) - (fr.uSlice.y * nLines)), 1.0);
			sl = (((1.0 - smoothstep((fr.uSlice.z * 0.4), fr.uSlice.z, abs((coord - 0.5))))) * fr.uSlice.x);
			vColor += (((select(fr.uSliceC, (vColor * 0.25), (fr.uSliceM.z > 0.5))) * sl) * 2.2);
		}
	}
	if ((fr.uDepth.x > 0.001)) {
		if ((fr.uDepthP.w > 1.5)) {
			var jet: vec3f = clamp(vec3f((1.5 - abs(((4.0 * gDepth) - 3.0))), (1.5 - abs(((4.0 * gDepth) - 2.0))), (1.5 - abs(((4.0 * gDepth) - 1.0)))), vec3f(0.0), vec3f(1.0));
			vColor = mix(vColor, (jet * ((0.4 + (0.95 * dot(vColor, vec3f(0.3, 0.59, 0.11)))))), 0.88);
		} else if ((fr.uDepthP.w > 0.5)) {
			vColor = vec3f(gDepth);
		}
	}
	if ((fr.uScope.x > 0.001)) {
		vColor = mix(vColor, (fr.uScopeC * 1.4), (fr.uScopeQ.x * gScopeT));
		vColor += (((fr.uScopeC * gScopeG) * fr.uScopeQ.z) * 3.0);
	}
	if ((gGl > 0.0)) {
		vColor *= vec3f((0.55 + (0.45 * hash11((floor((fr.uTime * 24.0)) + floor((pos.y * 14.0)))))));
		vColor *= vec3f((1.0 - ((0.45 * min(gGl, 1.0)) * step(0.5, fract((pos.y * 38.0))))));
		if ((gCh > -0.5)) {
			vColor = mix(vColor, (vColor * vec3f(select(0.05, 2.2, (gCh < 0.5)), select(0.05, 2.2, (abs((gCh - 1.0)) < 0.5)), select(0.05, 2.2, (gCh > 1.5)))), min(1.0, gGl));
		}
		vColor += ((vec3f(0.25, 0.3, 0.35) * gBurst) * min(gGl, 1.0));
	}
	if ((fr.uGrowP.z > 0.5)) {
		vColor += ((mix(vec3f(0.3, 0.95, 0.4), fr.uP2, 0.3) * pow(gGrowE, 1.6)) * 0.55);
	}
	if ((dkv > 0.0)) {
		var edge: f32 = (smoothstep(0.02, 0.25, dkv) * ((1.0 - smoothstep(0.25, 0.75, dkv))));
		if (((fr.uDisP.x > 0.5) && (fr.uDisP.x < 1.5))) {
			vColor += ((vec3f(1.0, 0.42, 0.08) * edge) * 2.4);
		} else {
			vColor += (((fr.uP2 * edge) * fr.uDisQ.z) * 2.0);
		}
	}
	var mkm: f32 = 0.0;
	if (((fr.uMorph < 0.9999) && (fr.uMorphO.z > 0.001))) {
		mkm = (sin((morphLocal(aOrigin, aTarget, aIdx) * 3.1415926535)) * fr.uMorphO.z);
		vColor += (((vColor * mkm) * 1.1) + ((fr.uP2 * mkm) * 0.25));
	}
	if (((fr.uSettle >= 0.0) && (fr.uSettle < 1.0))) {
		var yS: f32 = clamp((((base.y - fr.uYR.x)) / max((fr.uYR.y - fr.uYR.x), 1e-4)), 0.0, 1.0);
		var dd: f32 = (((yS - (((fr.uSettle * 1.35) - 0.15)))) / 0.14);
		var band: f32 = (exp((-dd * dd)) * ((1.0 - fr.uSettle)));
		mkm += (band * 1.0);
		vColor += (((vColor * band) * 0.9) + ((fr.uP2 * band) * 0.2));
		pos += ((normalize((vec3f(pos.x, 0.0, pos.z) + vec3f(1e-4))) * band) * 0.03);
	}
	vD = disp;
	var mv: vec4f = (fr.modelViewMatrix * vec4f(pos, 1.0));
	gl_Position = (fr.projectionMatrix * mv);
	var lensMu: f32 = 1.0;
	if ((fr.uLens.x > 0.001)) {
		if ((gl_Position.w > 1e-4)) {
			var lnd: vec2f = (gl_Position.xy / gl_Position.w);
			var lbv: vec2f = (((lnd - fr.uLensC.xy)) * vec2f(fr.uLens.w, 1.0));
			var lb: f32 = length(lbv);
			var lte: f32 = max(fr.uLens.y, 1e-4);
			var lth: f32 = (0.5 * ((lb + sqrt(((lb * lb) + ((4.0 * lte) * lte))))));
			var limg: vec2f = (fr.uLensC.xy + (((select(vec2f(0.0, 1.0), (lbv / lb), (lb > 1e-6))) * lth) / vec2f(fr.uLens.w, 1.0)));
			var lk: f32 = min(fr.uLens.x, 1.0);
			{ let _sw23 = (mix(lnd, limg, lk) * gl_Position.w); gl_Position = vec4f(_sw23.x, _sw23.y, gl_Position.z, gl_Position.w); }
			var lu: f32 = (lb / lte);
			lensMu = mix(1.0, clamp((((((lu * lu) + 2.0)) / ((((2.0 * lu) * sqrt(((lu * lu) + 4.0))) + 1e-4))) + 0.5), 1.0, 4.0), lk);
			vColor *= vec3f(mix(1.0, lensMu, 0.55));
			var lring: f32 = (((lth - lte)) / ((lte * 0.18)));
			vColor += ((((fr.uP2 * fr.uLens.z) * exp((-lring * lring))) * 0.9) * lk);
		}
	}
	var szNoise: f32 = 1.0;
	if ((fr.uLookP2.x > 0.001)) {
		szNoise = (1.0 + (fr.uLookP2.x * ((snoise(((base * 2.2) + (fr.uTime * 0.4))) * 0.75))));
	}
	var szAudio: f32 = 1.0;
	if ((fr.uLookP2.y > 0.001)) {
		var bandAudio: f32 = mix(fr.uBeat, fr.uSpec.x, step(0.0, base.y));
		szAudio = (1.0 + (fr.uLookP2.y * (((bandAudio * 1.2) * ((0.6 + (0.4 * sin((aIdx * 62.8)))))))));
	}
	var coc: f32 = 0.0;
	if ((fr.uDof.x > 0.5)) {
		var viewDist: f32 = -mv.z;
		coc = clamp((abs((viewDist - fr.uDof.y)) / max(0.05, fr.uDof.z)), 0.0, 1.0);
	}
	vCoc = coc;
	var s: f32 = ((((fr.uSize * fr.uPR) * (((((1.0 + (disp * 0.5)) + (fr.uBeat * 0.2)) + (sl * 1.2)) + (mkm * 0.7)))) * fr.uGlyph.y) * clamp(sqrt((fr.uFr.z / max(fr.uHero.z, 1.0))), 0.4, 1.0));
	s *= ((((((max(0.15, (szNoise * szAudio)) * ((1.0 - (fr.uDisQ.w * dkv)))) * mix(0.3, 1.0, gGrow)) * ((1.0 + (select(0.0, (mkv * 0.9), ((fr.uMark.x > 3.5) && (fr.uMark.x < 4.5))))))) * ((1.0 - (0.6 * (select(0.0, smoothstep(0.35, 0.9, mkv), ((fr.uMark.x > 2.5) && (fr.uMark.x < 3.5)))))))) * ((1.0 - (0.7 * smoothstep(0.3, 0.8, cvan))))) * ((0.25 + (0.75 * vis))));
	s *= ((1.0 + (coc * 2.4)));
	s *= sqrt(lensMu);
	s *= (1.0 - (0.85 * gHypF));
	s *= (((((1.0 + (gScopeT * fr.uScopeQ.y)) + ((gScopeG * fr.uScopeQ.z) * 2.5)) + (gDepthG * 0.8))) * ((1.0 - gScopeD)));
	s *= select(0.73, (3.8 / max(-mv.z, 0.4)), (fr.uAtt > 0.5));
	gl_PointSize = clamp(s, 1.0, 95.0);
	if ((((((gScopeD > 0.97) || (dkv > 0.97)) || (gDrop > 0.5)) || (gGrow < 0.03)) || (gHypF > 0.97))) {
		gl_Position = vec4f(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
	}
}


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
