export const FRAME_FIELDS = [
['uTime', 'f32', 'shared'],
['uBeat', 'f32', 'shared'],
['uSize', 'f32', 'shared'],
['uPR', 'f32', 'shared'],
['uAtt', 'f32', 'shared'],
['uBright', 'f32', 'shared'],
['uGlow', 'f32', 'shared'],
['uAdd', 'f32', 'shared'],
['uDens', 'f32', 'shared'],
['uShape', 'f32', 'shared'],
['uColorBy', 'f32', 'shared'],
['uFlat', 'f32', 'shared'],
['uGlyph', 'vec3f', 'shared'],
['uFr6', 'vec4f', 'shared'],
['uYR', 'vec2f', 'shared'],
['uCen', 'vec3f', 'shared'],
['uP0', 'vec3f', 'shared'],
['uP1', 'vec3f', 'shared'],
['uP2', 'vec3f', 'shared'],
['uSolid', 'vec3f', 'shared'],
['uTwist', 'vec4f', 'shared'],
['uWave', 'vec4f', 'shared'],
['uWaveP', 'vec4f', 'shared'],
['uWaveSrc', 'vec4f', 'shared'],
['uRes', 'vec2f', 'extra'],
['uExposure', 'f32', 'extra'],
['proj', 'mat4x4f', 'extra'],
['modelView', 'mat4x4f', 'extra'],
];
const SIZE = { f32: 16, vec2f: 16, vec3f: 16, vec4f: 16, mat4x4f: 64 };
export const FRAME_BYTES = FRAME_FIELDS.reduce((a, f) => a + SIZE[f[1]], 0);
export function frameStructWGSL() {
const lines = FRAME_FIELDS.map(([n, t]) => (t === 'mat4x4f' || t === 'vec4f' ? `\t${n}: ${t},` : `\t@size(16) ${n}: ${t},`));
return `struct Frame {\n${lines.join('\n')}\n}`;
}
export function packFrame(shared, extra, out = new Float32Array(FRAME_BYTES / 4)) {
let o = 0;
for (const [name, type, src] of FRAME_FIELDS) {
const v = src === 'extra' ? extra[name] : shared[name] && shared[name].value;
if (type === 'mat4x4f') {
for (let i = 0; i < 16; i++) out[o + i] = v[i];
} else if (type === 'f32') {
out[o] = +v || 0;
} else if (v && v.isColor) {
out[o] = v.r;
out[o + 1] = v.g;
out[o + 2] = v.b;
} else if (Array.isArray(v)) {
for (let i = 0; i < v.length; i++) out[o + i] = v[i];
} else if (v) {
out[o] = v.x;
out[o + 1] = v.y;
if (v.z !== undefined) out[o + 2] = v.z;
if (v.w !== undefined) out[o + 3] = v.w;
}
o += SIZE[type] / 4;
}
return out;
}
