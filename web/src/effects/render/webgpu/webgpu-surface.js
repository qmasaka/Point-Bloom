import { RT_FORMAT } from './webgpu-post.js';
import { TONE_WGSL } from '../../shaders/wgsl/generated/tone.js';
const WGSL = `
struct U {
	mvp: mat4x4f,
	col: vec4f,
	out: vec4f,
}
@group(0) @binding(0) var<uniform> u: U;

struct VOut {
	@builtin(position) clip: vec4f,
	@location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
	var uvs = array<vec2f, 4>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(1.0, 1.0));
	let uv = uvs[vi];
	var clip = u.mvp * vec4f(uv - 0.5, 0.0, 1.0);

	clip.z = (clip.z + clip.w) * 0.5;
	var o: VOut;
	o.clip = clip;
	o.uv = uv;
	return o;
}

${TONE_WGSL}

fn surf(uv: vec2f) -> vec4f {
	let d = length(uv - 0.5) * 2.0;
	return vec4f(u.col.rgb, u.col.a * (1.0 - smoothstep(0.25, 1.0, d)));
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
	let c = surf(in.uv);
	return vec4f(linearToSrgb(toneMap(c.rgb, u.out.x, u.out.y)), c.a);
}

@fragment
fn fs_raw(in: VOut) -> @location(0) vec4f {
	return surf(in.uv);
}
`;
export class WebGPUSurface {
constructor(device, canvasFormat) {
this.device = device;
this.format = canvasFormat;
this.pipelines = {};
this.started = false;
this.data = new Float32Array(24);
}
prepare() {
if (this.started) return this.job;
this.started = true;
const D = this.device;
const module = D.createShaderModule({ code: WGSL });
const bgl = D.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
this.ubuf = D.createBuffer({ size: this.data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
this.group = D.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: this.ubuf } }] });
const layout = D.createPipelineLayout({ bindGroupLayouts: [bgl] });
this.job = Promise.all(
[false, true].map((rt) =>
D.createRenderPipelineAsync({
layout,
vertex: { module, entryPoint: 'vs' },
fragment: {
module,
entryPoint: rt ? 'fs_raw' : 'fs',
targets: [{ format: rt ? RT_FORMAT : this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }],
},
primitive: { topology: 'triangle-strip', cullMode: 'none' },
depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
}).then((p) => {
this.pipelines[rt ? 'rt' : 'screen'] = p;
})
)
).catch((e) => {
this.failed = true;
console.warn('WebGPU: не собралась поверхность под тенью, её рисует WebGL:', e && e.message ? e.message : e);
});
return this.job;
}
ready(rt = false) {
return !!this.pipelines[rt ? 'rt' : 'screen'];
}
draw(enc, view, depthView, rt, plane, ctx) {
const U = plane.material.uniforms;
const c = U.uC.value;
const d = this.data;
d.set(ctx.mvp.elements, 0);
d.set([c.r, c.g, c.b, U.uA.value], 16);
d.set([ctx.exposure, ctx.tone, 0, 0], 20);
this.device.queue.writeBuffer(this.ubuf, 0, d);
const rp = enc.beginRenderPass({
colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
});
rp.setPipeline(this.pipelines[rt ? 'rt' : 'screen']);
rp.setBindGroup(0, this.group);
rp.draw(4);
rp.end();
}
dispose() {
this.ubuf?.destroy();
}
}
