// WGSL: рисование точек. Каждая точка это квадрат из двух треугольников (в WebGPU нет точек-спрайтов с размером, как gl_PointSize в WebGL).
// Формулы повторяют GLSL (shaders/glsl/vert.js и frag.js) для случая без раскадровки, глифов и глубины резкости.
import { frameStruct, outputColor } from './common.js';

// привязки: 0 значения кадра, 1 текущие позиции, 2 базовые позиции, 3 цвета (rgb и видимость)
export const pointsShader = (salt = 0) => /* wgsl */ `
${frameStruct}
${outputColor}
@group(0) @binding(0) var<uniform> fr: Frame;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> base: array<vec4f>;
@group(0) @binding(3) var<storage, read> colors: array<vec4f>;

struct VOut {
	@builtin(position) clip: vec4f,
	@location(0) color: vec3f,
	@location(1) d: f32,
	@location(2) pc: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
	var corners = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
	let corner = corners[vi];
	let p = pos[ii].xyz;
	let b = base[ii].xyz;
	let cm = colors[ii];
	let n = f32(arrayLength(&pos));
	let aIdx = f32(ii) / n;
	let t = fr.uTime;
	let disp = clamp(length(p - b) * 1.5, 0.0, 1.0);
	var k = 0.0;
	if (fr.uColorBy < 0.5) {
		k = clamp(disp + fr.uBeat * 0.12, 0.0, 1.0);
	} else if (fr.uColorBy < 1.5) {
		k = clamp((p.y - fr.uYR.x) / max(fr.uYR.y - fr.uYR.x, 1e-4), 0.0, 1.0);
	} else {
		k = fract(aIdx * 3.0 + t * 0.03);
	}
	var col = select(mix(fr.uP1, fr.uP2, (k - 0.5) * 2.0), mix(fr.uP0, fr.uP1, k * 2.0), k < 0.5);
	if (fr.uColorBy > 2.5 && fr.uColorBy < 3.5) { col = cm.rgb; }
	else if (fr.uColorBy > 3.5 && fr.uColorBy < 4.5) { col = fr.uSolid; }
	let vis = cm.w;
	let color = col * fr.uBright * (1.0 + fr.uBeat * 0.3) * vis * ${(1 + salt).toFixed(9)};

	let mv = fr.modelView * vec4f(p, 1.0);
	var clip = fr.proj * mv;
	// в WebGL глубина клипа от -w до w, в WebGPU от 0 до w
	clip.z = (clip.z + clip.w) * 0.5;

	// размер точки в пикселях (как gl_PointSize в GLSL)
	var s = fr.uSize * fr.uPR * (1.0 + disp * 0.5 + fr.uBeat * 0.2) * fr.uGlyph.y * fr.uFr6.x;
	s = s * (0.25 + 0.75 * vis);
	s = s * select(0.73, 3.8 / max(-mv.z, 0.4), fr.uAtt > 0.5);
	s = clamp(s, 1.0, 95.0);

	let off = corner * (s / fr.uRes);
	clip = vec4f(clip.xy + off * clip.w, clip.z, clip.w);

	var o: VOut;
	o.clip = clip;
	o.color = color;
	o.d = disp;
	// координата внутри точки, как gl_PointCoord: начало слева сверху
	o.pc = vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
	return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
	let c = in.pc - vec2f(0.5);
	var dm = length(c);
	// форма точки: 0 квадрат, 1 круг, 2 шар, 3 кольцо, 4 ромб, 5 плюс
	if (fr.uShape < 0.5) { dm = max(abs(c.x), abs(c.y)); }
	else if (fr.uShape > 3.5 && fr.uShape < 4.5) { dm = abs(c.x) + abs(c.y); }
	if (dm > 0.5) { discard; }
	if (fr.uShape > 2.5 && fr.uShape < 3.5 && dm < 0.29) { discard; }
	if (fr.uShape > 4.5 && min(abs(c.x), abs(c.y)) > 0.16) { discard; }
	let r2 = dm * dm;
	var core = 1.0 - smoothstep(0.0, 0.25, r2);
	if (fr.uShape > 2.5 && fr.uShape < 3.5) { core = 1.0 - smoothstep(0.0, 0.1, abs(dm - 0.4)); }
	var sph = 1.0;
	if (fr.uShape > 1.5 && fr.uShape < 2.5) {
		let nn = vec3f(c.x * 2.0, -c.y * 2.0, sqrt(max(0.0, 1.0 - 4.0 * r2)));
		sph = 0.4 + 0.75 * max(dot(nn, normalize(vec3f(-0.4, 0.6, 0.7))), 0.0);
	}
	var rgb: vec3f;
	var a: f32;
	if (fr.uAdd > 0.5) {
		let aura = pow(core, mix(1.8, 0.7, fr.uGlow));
		rgb = (in.color * (0.08 + aura * (0.2 + fr.uGlow * 0.28)) + in.color * in.d * 0.08) * fr.uDens * sph;
		a = core;
	} else {
		rgb = in.color * (0.55 + 0.45 * core) * sph;
		a = 1.0;
	}
	return vec4f(linearToSrgb(toneNeutral(rgb, fr.uExposure)), a);
}
`;
