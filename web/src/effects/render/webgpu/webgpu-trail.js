import { RT_FORMAT } from './webgpu-post.js';
import { TONE_WGSL } from '../../shaders/wgsl/generated/tone.js';
const WGSL = `
struct U {
	mv: mat4x4f,
	proj: mat4x4f,
	tintC: vec4f,   // rgb: цвет подмеса, w: доля подмеса
	params: vec4f,  // x: размер точки в пикселях (до сжатия по расстоянию), y: прозрачность, zw: размер холста
	out: vec4f,     // x: экспозиция, y: тональная компрессия (0 нет, 1 Neutral, 2 ACES, 3 AgX)
}
@group(0) @binding(0) var<uniform> u: U;

struct VIn {
	@builtin(vertex_index) vi: u32,
	@location(0) pos: vec3f,
	@location(1) col: vec3f,
}
struct VOut {
	@builtin(position) clip: vec4f,
	@location(0) color: vec3f,
	@location(1) pc: vec2f,
}

@vertex
fn vs(in: VIn) -> VOut {
	var corners = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
	let corner = corners[in.vi];
	let mv = u.mv * vec4f(in.pos, 1.0);
	var clip = u.proj * mv;
	clip.z = (clip.z + clip.w) * 0.5;
	let size = clamp(u.params.x * 3.8 / max(-mv.z, 0.4), 1.0, 60.0);
	clip = vec4f(clip.xy + corner * (size / u.params.zw) * clip.w, clip.z, clip.w);
	var o: VOut;
	o.clip = clip;
	o.color = mix(in.col, u.tintC.rgb, u.tintC.w);
	o.pc = vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
	return o;
}

${TONE_WGSL}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
	if (length(in.pc - vec2f(0.5)) > 0.5) { discard; }
	return vec4f(linearToSrgb(toneMap(in.color, u.out.x, u.out.y)), u.params.y);
}

@fragment
fn fs_raw(in: VOut) -> @location(0) vec4f {
	if (length(in.pc - vec2f(0.5)) > 0.5) { discard; }
	return vec4f(in.color, u.params.y);
}
`;
export class WebGPUTrail {
constructor(device, canvasFormat) {
this.device = device;
this.format = canvasFormat;
this.pipelines = {};
this.started = false;
this.key = null;
this.ghosts = [];
this.colorBuf = null;
}
prepare() {
if (this.started) return this.job;
this.started = true;
const D = this.device;
const module = D.createShaderModule({ code: WGSL });
const bgl = D.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
this.bgl = bgl;
const layout = D.createPipelineLayout({ bindGroupLayouts: [bgl] });
this.job = Promise.all(
[false, true].map((rt) =>
D.createRenderPipelineAsync({
layout,
vertex: {
module,
entryPoint: 'vs',
buffers: [
{ arrayStride: 12, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
{ arrayStride: 12, stepMode: 'instance', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
],
},
fragment: {
module,
entryPoint: rt ? 'fs_raw' : 'fs',
targets: [{ format: rt ? RT_FORMAT : this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }],
},
primitive: { topology: 'triangle-strip' },
depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
}).then((p) => {
this.pipelines[rt ? 'rt' : 'screen'] = p;
})
)
);
this.job = this.job.catch((e) => {
this.failed = true;
console.warn('WebGPU: не собрался шлейф, его рисует WebGL:', e && e.message ? e.message : e);
});
return this.job;
}
ready(rt = false) {
return !!this.pipelines[rt ? 'rt' : 'screen'];
}
_free() {
for (const g of this.ghosts) {
g.pos.destroy();
g.ubuf.destroy();
}
this.colorBuf?.destroy();
this.ghosts = [];
this.colorBuf = null;
}
sync(tr) {
const D = this.device;
const first = tr.ghosts[0];
if (!first) return 0;
const n = first.geometry.attributes.position.count;
const colorAttr = first.geometry.attributes.color;
if (this.key !== tr || this.count !== n || this.ghosts.length !== tr.ghosts.length || this.colorArr !== colorAttr.array) {
this._free();
this.key = tr;
this.count = n;
this.colorArr = colorAttr.array;
this.colorBuf = D.createBuffer({ size: n * 12, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
D.queue.writeBuffer(this.colorBuf, 0, colorAttr.array);
this.ghosts = tr.ghosts.map(() => {
const ubuf = D.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
return { pos: D.createBuffer({ size: n * 12, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }), ubuf, group: D.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: ubuf } }] }), arr: null, ver: -1 };
});
}
tr.ghosts.forEach((p, k) => {
const a = p.geometry.attributes.position;
const g = this.ghosts[k];
if (g.arr !== a.array || g.ver !== a.version) {
g.arr = a.array;
g.ver = a.version;
D.queue.writeBuffer(g.pos, 0, a.array);
}
});
return n;
}
draw(enc, view, depthView, rt, tr, ctx) {
const D = this.device;
const pipe = this.pipelines[rt ? 'rt' : 'screen'];
const rp = enc.beginRenderPass({
colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: ctx.load ? 'load' : 'clear', storeOp: 'store' }],
depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: ctx.load ? 'load' : 'clear', depthStoreOp: 'store' },
});
if (pipe && this.count) {
rp.setPipeline(pipe);
const data = new Float32Array(44);
for (let k = tr.ghosts.length - 1; k >= 0; k--) {
const p = tr.ghosts[k];
const g = this.ghosts[k];
const mt = p.material.uniforms;
if (!(mt.uAlpha.value > 0.001)) continue;
ctx.mv.multiplyMatrices(ctx.camera.matrixWorldInverse, p.matrixWorld);
data.set(ctx.mv.elements, 0);
data.set(ctx.proj.elements, 16);
const c = mt.uTintC.value;
data.set([c.r, c.g, c.b, mt.uTint.value], 32);
data.set([mt.uSize.value, mt.uAlpha.value, ctx.size[0], ctx.size[1]], 36);
data.set([ctx.exposure, ctx.tone ?? 1, 0, 0], 40);
D.queue.writeBuffer(g.ubuf, 0, data);
rp.setBindGroup(0, g.group);
rp.setVertexBuffer(0, g.pos);
rp.setVertexBuffer(1, this.colorBuf);
rp.draw(4, this.count);
}
}
rp.end();
}
dispose() {
this._free();
}
}
