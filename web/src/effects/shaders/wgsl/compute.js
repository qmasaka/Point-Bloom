import { frameStruct } from './common.js';
const head = `
${frameStruct}
@group(0) @binding(0) var<uniform> fr: Frame;
@group(0) @binding(1) var<storage, read> base: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> pos: array<vec4f>;
`;
const num = (x) => x.toFixed(9);
export const computeCopy = () => `
${head}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= arrayLength(&pos)) { return; }
	pos[i] = base[i];
}
`;
export const computeTwist = (salt = 0) => `
${head}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= arrayLength(&pos)) { return; }
	var p = pos[i].xyz;
	let b = base[i].xyz;
	let t = fr.uTime;
	let y01t = clamp((b.y - fr.uYR.x) / max(fr.uYR.y - fr.uYR.x, 1e-4), 0.0, 1.0);
	let tw = fr.uTwist.x * (1.0 + select(0.0, ${num(0.35 + salt)} * sin(t * fr.uTwist.z * 2.0), fr.uTwist.z > 0.01));
	if (fr.uTwist.y < 0.5) {
		let a = p.y * tw * 1.6;
		let c = cos(a);
		let s = sin(a);
		p = vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
	} else if (fr.uTwist.y < 1.5) {
		p.x = p.x + y01t * y01t * tw * 0.9;
		p.y = p.y - y01t * y01t * y01t * tw * 0.16;
	} else if (fr.uTwist.y < 2.5) {
		let k = 1.0 + tw * 0.6 * (0.5 - y01t) * 2.0;
		p.x = p.x * k;
		p.z = p.z * k;
	} else if (fr.uTwist.y < 3.5) {
		let sw = sin(p.y * 3.2 - t * (0.9 + fr.uTwist.z));
		p.x = p.x + sw * tw * 0.2;
		p.z = p.z + cos(p.y * 3.2 - t * (0.9 + fr.uTwist.z)) * tw * 0.12;
	} else {
		let k = 1.0 + tw * 0.3 * sin(y01t * 6.2831 - t * (1.2 + fr.uTwist.z));
		p.x = p.x * k;
		p.z = p.z * k;
	}
	pos[i] = vec4f(p, 1.0);
}
`;
export const computeWave = (salt = 0) => `
${head}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= arrayLength(&pos)) { return; }
	var p = pos[i].xyz;
	let b = base[i].xyz;
	let t = fr.uTime;
	var rad = normalize(b + vec3f(1e-4));
	rad = normalize(mix(rad, vec3f(0.0, 0.0, 1.0), 0.8 * fr.uFlat));
	var wv = 0.0;
	if (fr.uWaveP.y < 0.5) {
		wv = sin(distance(b, fr.uWaveSrc.xyz) * fr.uWave.y * 2.0 - t * 3.0 * fr.uWaveP.x);
	} else if (fr.uWaveP.y < 1.5) {
		let age = fr.uTime - fr.uWaveP.w;
		if (age > 0.0) {
			let d = distance(b, fr.uWaveSrc.xyz);
			let ring = age * fr.uWaveP.x * 1.3;
			wv = sin((d - ring) * fr.uWave.y * 2.6) * exp(-abs(d - ring) * 2.5) * exp(-age * fr.uWaveP.z);
		}
	} else if (fr.uWaveP.y < 2.5) {
		let wd = vec3f(cos(fr.uWaveSrc.w), 0.0, sin(fr.uWaveSrc.w));
		wv = sin(dot(b, wd) * fr.uWave.y * 2.0 - t * 3.0 * fr.uWaveP.x);
	} else if (fr.uWaveP.y < 3.5) {
		let yw = clamp((b.y - fr.uYR.x) / max(fr.uYR.y - fr.uYR.x, 1e-4), 0.0, 1.0);
		wv = sin(atan2(b.z - fr.uCen.z, b.x - fr.uCen.x) * 3.0 + yw * fr.uWave.y * 1.3 - t * 3.0 * fr.uWaveP.x);
	} else {
		wv = sin(b.y * fr.uWave.y * 2.0 - t * 3.0 * fr.uWaveP.x);
	}
	p = p + rad * wv * fr.uWave.x * ${num(0.14 + salt)} * (1.0 + 1.5 * fr.uFlat);
	pos[i] = vec4f(p, 1.0);
}
`;
