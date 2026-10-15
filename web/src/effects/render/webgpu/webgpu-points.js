import { FRAME_BYTES, packFrame } from './frame-layout.js';
import { RT_FORMAT } from './webgpu-post.js';
import { pointsComputeWGSL } from '../../shaders/wgsl/generated/points-compute.js';
import { pointsRenderWGSL } from '../../shaders/wgsl/generated/points-render.js';
const ATTR_GROUPS = {
aOrigin: ['origin'],
aHide: ['origin'],
aTarget: ['target'],
aDepth: ['target'],
aColor: ['colorA'],
aPath: ['colorA'],
aColorB: ['colorB'],
aVis: ['colorB', 'normA'],
aNormal: ['normA'],
aNormalB: ['normB'],
aSculpt: ['sculpt'],
aIdx: ['sculpt'],
aPaint: ['paint'],
};
function packGroup(group, a, n) {
const out = new Float32Array(n * 4);
const v3 = (src, dst) => {
if (!src) return;
for (let i = 0; i < n; i++) {
out[i * 4] = src[i * 3];
out[i * 4 + 1] = src[i * 3 + 1];
out[i * 4 + 2] = src[i * 3 + 2];
}
};
const w1 = (src, k = 1, off = 0) => {
if (!src) return;
for (let i = 0; i < n; i++) out[i * 4 + 3] = src[i * k + off];
};
switch (group) {
case 'origin':
v3(a.aOrigin);
w1(a.aHide);
break;
case 'target':
v3(a.aTarget);
w1(a.aDepth);
break;
case 'colorA':
v3(a.aColor);
w1(a.aPath);
break;
case 'colorB':
v3(a.aColorB);
w1(a.aVis, 2, 0);
break;
case 'normA':
v3(a.aNormal);
w1(a.aVis, 2, 1);
break;
case 'normB':
v3(a.aNormalB);
break;
case 'sculpt':
v3(a.aSculpt);
w1(a.aIdx);
break;
case 'paint':
if (a.aPaint) out.set(a.aPaint.subarray ? a.aPaint.subarray(0, n * 4) : a.aPaint);
break;
}
return out;
}
const GROUPS = ['origin', 'target', 'colorA', 'colorB', 'normA', 'normB', 'sculpt', 'paint'];
export class WebGPUPoints {
constructor(gpu, canvas) {
this.device = gpu.device;
this.format = gpu.format;
this.canvas = canvas;
this.ctx = canvas.getContext('webgpu');
this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
this.count = 0;
this.pipelines = {};
this.attrs = null;
this.bufs = {};
this.frameData = new Float32Array(FRAME_BYTES / 4);
const D = this.device;
this.texVersion = 0;
this.insts = [];
this.sampler = D.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
this.specTex = D.createTexture({ size: [64, 1], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
this.pieceTex = D.createTexture({ size: [256, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
this.frTex = D.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
this.heroTex = D.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
this.atlasTex = D.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
const C = GPUShaderStage.COMPUTE;
const V = GPUShaderStage.VERTEX;
const F = GPUShaderStage.FRAGMENT;
const ro = { type: 'read-only-storage' };
this.computeBGL = D.createBindGroupLayout({
entries: [
{ binding: 0, visibility: C, buffer: { type: 'uniform' } },
...[1, 2, 3, 4, 5, 6, 7, 8].map((binding) => ({ binding, visibility: C, buffer: ro })),
...[9, 10, 11].map((binding) => ({ binding, visibility: C, buffer: { type: 'storage' } })),
{ binding: 12, visibility: C, texture: { sampleType: 'float' } },
{ binding: 13, visibility: C, sampler: { type: 'filtering' } },
{ binding: 14, visibility: C, texture: { sampleType: 'unfilterable-float' } },
{ binding: 15, visibility: C, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
{ binding: 16, visibility: C, texture: { sampleType: 'float' } },
],
});
this.renderBGL = D.createBindGroupLayout({
entries: [
{ binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
{ binding: 1, visibility: V, buffer: ro },
{ binding: 2, visibility: V, buffer: ro },
{ binding: 3, visibility: V, buffer: ro },
{ binding: 4, visibility: F, texture: { sampleType: 'float' } },
{ binding: 5, visibility: F, sampler: { type: 'filtering' } },
],
});
this.dummyBuf = D.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
this.depth = null;
}
setCloud(attrs, count) {
const D = this.device;
const n = count ?? attrs.aOrigin.length / 3;
this.count = n;
this.attrs = attrs;
if (!attrs.aVis) attrs.aVis = new Float32Array(n * 2).fill(1);
if (!attrs.aIdx) {
attrs.aIdx = new Float32Array(n);
for (let i = 0; i < n; i++) attrs.aIdx[i] = i / n;
}
for (const g of GROUPS) {
this.bufs[g]?.destroy();
this.bufs[g] = D.createBuffer({ size: n * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
D.queue.writeBuffer(this.bufs[g], 0, packGroup(g, attrs, n));
}
for (const k of ['outA', 'outB', 'outC']) {
this.bufs[k]?.destroy();
this.bufs[k] = D.createBuffer({ size: n * 16, usage: GPUBufferUsage.STORAGE });
}
for (const it of this.insts) it.buf.destroy();
this.insts = [];
}
_inst(i) {
let it = this.insts[i];
if (it) return it;
const D = this.device;
const b = this.bufs;
const e = (binding, buf) => ({ binding, resource: { buffer: buf } });
const frameBuf = D.createBuffer({ size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const computeGroup = D.createBindGroup({
layout: this.computeBGL,
entries: [
e(0, frameBuf),
e(1, b.origin),
e(2, b.target),
e(3, b.colorA),
e(4, b.colorB),
e(5, b.normA),
e(6, b.normB),
e(7, b.sculpt),
e(8, b.paint),
e(9, b.outA),
e(10, b.outB),
e(11, b.outC),
{ binding: 12, resource: this.specTex.createView() },
{ binding: 13, resource: this.sampler },
{ binding: 14, resource: this.pieceTex.createView() },
{ binding: 15, resource: this.frTex.createView({ dimension: '2d-array' }) },
{ binding: 16, resource: this.heroTex.createView() },
],
});
const renderGroup = D.createBindGroup({
layout: this.renderBGL,
entries: [e(0, frameBuf), e(1, b.outA), e(2, b.outB), e(3, b.outC), { binding: 4, resource: this.atlasTex.createView() }, { binding: 5, resource: this.sampler }],
});
it = this.insts[i] = { buf: frameBuf, computeGroup, renderGroup };
return it;
}
updateAttributes(names) {
const groups = new Set();
for (const nm of names) for (const g of ATTR_GROUPS[nm] || []) groups.add(g);
for (const g of groups) this.device.queue.writeBuffer(this.bufs[g], 0, packGroup(g, this.attrs, this.count));
}
setSpectrum(bytes) {
this.device.queue.writeTexture({ texture: this.specTex }, bytes, { bytesPerRow: 64 }, [64, 1]);
}
setPieces(floats) {
this.device.queue.writeTexture({ texture: this.pieceTex }, floats, { bytesPerRow: 256 * 16 }, [256, 1]);
}
async prepare({ salt = 0, mapShader = null } = {}) {
const D = this.device;
const t0 = performance.now();
const salted = (code) => {
const c = salt ? code.replace('43758.5453', (43758.5453 + salt).toFixed(6)) : code;
return mapShader ? mapShader(c) : c;
};
const jobs = [];
if (this._mapped !== mapShader) {
delete this.pipelines.compute;
this._mapped = mapShader;
}
if (!this.pipelines.compute) {
const module = D.createShaderModule({ code: salted(pointsComputeWGSL) });
jobs.push(
D.createComputePipelineAsync({ layout: D.createPipelineLayout({ bindGroupLayouts: [this.computeBGL] }), compute: { module, entryPoint: 'main' } }).then((p) => {
this.pipelines.compute = p;
})
);
}
const renderLayout = D.createPipelineLayout({ bindGroupLayouts: [this.renderBGL] });
const renderModule = D.createShaderModule({ code: pointsRenderWGSL });
for (const key of ['add', 'normal', 'add-rt', 'normal-rt']) {
const mode = key;
if (this.pipelines['points-' + mode]) continue;
const module = renderModule;
const add = key.startsWith('add');
const rt = key.endsWith('-rt');
jobs.push(
D.createRenderPipelineAsync({
layout: renderLayout,
vertex: { module, entryPoint: 'vs' },
fragment: {
module,
entryPoint: rt ? 'fs_raw' : 'fs',
targets: [
{
format: rt ? RT_FORMAT : this.format,
blend: add ? { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' } } : undefined,
},
],
},
primitive: { topology: 'triangle-strip' },
depthStencil: { format: 'depth24plus', depthWriteEnabled: !add, depthCompare: 'less-equal' },
}).then((p) => {
this.pipelines['points-' + mode] = p;
})
);
}
const blockedMs = performance.now() - t0;
await Promise.all(jobs);
return { blockedMs, readyMs: performance.now() - t0 };
}
ready(add = true, rt = false) {
return !!(this.pipelines.compute && this.pipelines['points-' + (add ? 'add' : 'normal') + (rt ? '-rt' : '')]);
}
resize(w, h) {
if (this.canvas.width !== w) this.canvas.width = w;
if (this.canvas.height !== h) this.canvas.height = h;
this._depthFor(w, h);
}
_depthFor(w, h) {
if (!this.depth || this.depth.width !== w || this.depth.height !== h) {
this.depth?.destroy();
this.depth = this.device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
}
return this.depth;
}
frame(shared, extra, list = [{}], opts = {}) {
const D = this.device;
const rt = !!opts.rt;
const size = opts.size || [this.canvas.width, this.canvas.height];
const [w, h] = size;
if (!opts.view) this.resize(w, h);
const depth = this._depthFor(w, h);
const add = shared.uAdd.value > 0.5;
const enc = opts.encoder || D.createCommandEncoder();
const view = opts.view || this.ctx.getCurrentTexture().createView();
const pipe = this.pipelines['points-' + (add ? 'add' : 'normal') + (rt ? '-rt' : '')];
list.forEach((own, i) => {
const it = this._inst(i);
packFrame(shared, { uRes: [w, h], uExposure: 1, uTOff: 0, uGhost: 1, ...extra, ...own }, this.frameData);
D.queue.writeBuffer(it.buf, 0, this.frameData);
const cp = enc.beginComputePass();
cp.setPipeline(this.pipelines.compute);
cp.setBindGroup(0, it.computeGroup);
cp.dispatchWorkgroups(Math.ceil(this.count / 64));
cp.end();
const first = i === 0 && !opts.noClear;
const rp = enc.beginRenderPass({
colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: first ? 'clear' : 'load', storeOp: 'store' }],
depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: first ? 'clear' : 'load', depthStoreOp: 'store' },
});
if (pipe) {
rp.setPipeline(pipe);
rp.setBindGroup(0, it.renderGroup);
rp.draw(4, this.count);
}
rp.end();
});
if (!opts.encoder) D.queue.submit([enc.finish()]);
}
idle() {
return this.device.queue.onSubmittedWorkDone();
}
dispose() {
for (const b of Object.values(this.bufs)) b.destroy();
for (const it of this.insts) it.buf.destroy();
for (const t of [this.specTex, this.pieceTex, this.frTex, this.heroTex, this.atlasTex]) t.destroy();
this.depth?.destroy();
this.ctx.unconfigure();
}
}
