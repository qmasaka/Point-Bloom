import { FRAME_BYTES, packFrame } from './frame-layout.js';
import { RT_FORMAT } from './webgpu-post.js';
import { pointsComputeWGSL } from '../../shaders/wgsl/generated/points-compute.js';
import { pointsComputeHeroWGSL } from '../../shaders/wgsl/generated/points-compute-hero.js';
import { pointsComputeShadowWGSL } from '../../shaders/wgsl/generated/points-compute-shadow.js';
import { pointsRenderWGSL, shadowRenderWGSL } from '../../shaders/wgsl/generated/points-render.js';

const ATTR_GROUPS = {
	aOrigin: ['origin'],
	aHide: ['origin'],
	aTarget: ['target'],
	aDepth: ['target'],
	aColor: ['colorA'],
	aPath: ['colorA'],
	aColorB: ['colorB'],
	aVis: ['colorB', 'normA', 'normB'],
	aNormal: ['normA'],
	aNormalB: ['normB'],
	aSculpt: ['sculpt'],
	aIdx: ['sculpt'],
	aPaint: ['paint'],
};

function packGroup(group, a, n, out = new Float32Array(n * 4)) {
	out = out.length === n * 4 ? out : out.subarray(0, n * 4);
	out.fill(0);
	const v3 = (src) => {
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
	const visSize = a.aVis?.length / n;
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
			w1(a.aVis, visSize, 0);
			break;
		case 'normA':
			v3(a.aNormal);
			w1(a.aVis, visSize, 1);
			break;
		case 'normB':
			v3(a.aNormalB);
			if (visSize === 3) w1(a.aVis, 3, 2);
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
const PAIR = { origin: [0, 0], target: [0, 1], colorA: [1, 0], colorB: [1, 1], normA: [2, 0], normB: [2, 1], sculpt: [3, 0], paint: [3, 1] };
const IN_BUFS = ['in0', 'in1', 'in2', 'in3'];

const BLEND_ADD = { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' } };
const BLEND_NORMAL = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };

export class WebGPUPoints {
	constructor(gpu, canvas) {
		this.device = gpu.device;
		this.format = gpu.format;
		this.canvas = canvas;
		this.ctx = canvas.getContext('webgpu');
		this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
		this.pipelines = {};
		this.layers = {};
		this.frameData = new Float32Array(FRAME_BYTES / 4);
		const D = this.device;
		this.texVersion = 0;
		this.insts = [];
		this.sampler = D.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		this.specTex = D.createTexture({ size: [64, 1], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		this.pieceTex = D.createTexture({ size: [256, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		this.frTex = D.createTexture({ size: [1, 1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		this.heroTex = this._tex2d(1, 1, 'rgba8unorm-srgb', true);
		this.atlasTex = this._tex2d(1, 1, 'rgba8unorm', true);
		this.scrTex = this._tex2d(1, 1, 'rgba8unorm-srgb', true);
		this.scrDep = this._tex2d(1, 1, 'r8unorm');
		this.scrMTex = this._tex2d(1, 1, 'rgba8unorm');
		this.slitTex = D.createTexture({ size: [1, 1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		this.sortTex = this._tex2d(1, 1, 'rg32float');
		this.experimentField = this._tex2d(1, 1, 'rgba32float');
		this.experimentShapes = this._tex2d(1, 1, 'rgba32float');
		D.queue.writeTexture({ texture: this.scrTex }, new Uint8Array([0, 0, 0, 255]), { bytesPerRow: 4 }, [1, 1]);

		const C = GPUShaderStage.COMPUTE;
		const V = GPUShaderStage.VERTEX;
		const F = GPUShaderStage.FRAGMENT;
		const ro = { type: 'read-only-storage' };
		this.computeBGL = D.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: C, buffer: { type: 'uniform' } },
				...[1, 2, 3, 4].map((binding) => ({ binding, visibility: C, buffer: ro })),
				...[9, 10, 11].map((binding) => ({ binding, visibility: C, buffer: { type: 'storage' } })),
				...this.texLayout(),
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
		this.pick = null;
	}

	_tex2d(w, h, format, external = false) {
		const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | (external ? GPUTextureUsage.RENDER_ATTACHMENT : 0);
		return this.device.createTexture({ size: [w, h], format, usage });
	}

	texLayout() {
		const C = GPUShaderStage.COMPUTE;
		const t = (binding, sampleType, viewDimension = '2d') => ({ binding, visibility: C, texture: { sampleType, viewDimension } });
		return [
			t(12, 'float'),
			{ binding: 13, visibility: C, sampler: { type: 'filtering' } },
			t(14, 'unfilterable-float'),
			t(15, 'unfilterable-float', '2d-array'),
			t(16, 'float'),
			t(17, 'float'),
			t(18, 'float'),
			t(19, 'unfilterable-float'),
			t(20, 'unfilterable-float', '2d-array'),
			t(21, 'unfilterable-float'),
			t(22, 'unfilterable-float'),
			t(23, 'unfilterable-float'),
		];
	}

	texEntries() {
		return [
			{ binding: 12, resource: this.specTex.createView() },
			{ binding: 13, resource: this.sampler },
			{ binding: 14, resource: this.pieceTex.createView() },
			{ binding: 15, resource: this.frTex.createView({ dimension: '2d-array' }) },
			{ binding: 16, resource: this.heroTex.createView() },
			{ binding: 17, resource: this.scrTex.createView() },
			{ binding: 18, resource: this.scrDep.createView() },
			{ binding: 19, resource: this.scrMTex.createView() },
			{ binding: 20, resource: this.slitTex.createView({ dimension: '2d-array' }) },
			{ binding: 21, resource: this.sortTex.createView() },
			{ binding: 22, resource: this.experimentField.createView() },
			{ binding: 23, resource: this.experimentShapes.createView() },
		];
	}

	_resize(key, w, h, format, external) {
		const cur = this[key];
		if (cur.width === w && cur.height === h) return cur;
		cur.destroy();
		this.texVersion++;
		return (this[key] = this._tex2d(w, h, format, external));
	}

	get count() {
		return this.layers.main ? this.layers.main.count : 0;
	}

	setCloud(attrs, count, layer = 'main') {
		const D = this.device;
		const n = count ?? attrs.aOrigin.length / 3;
		const L = this.layers[layer] || (this.layers[layer] = { bufs: {} });
		L.count = n;
		L.attrs = attrs;
		L.ver = (L.ver || 0) + 1;
		if (!attrs.aVis) attrs.aVis = new Float32Array(n * 2).fill(1);
		if (!attrs.aIdx) {
			attrs.aIdx = new Float32Array(n);
			for (let i = 0; i < n; i++) attrs.aIdx[i] = i / n;
		}
		for (const k of IN_BUFS) {
			L.bufs[k]?.destroy();
			L.bufs[k] = D.createBuffer({ size: n * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		}
		for (const g of GROUPS) this._writeGroup(L, g);
		for (const k of ['outA', 'outB', 'outC']) {
			L.bufs[k]?.destroy();
			L.bufs[k] = D.createBuffer({ size: n * 16, usage: GPUBufferUsage.STORAGE | (k === 'outA' ? GPUBufferUsage.COPY_SRC : 0) });
		}
	}

	_writeGroup(L, g) {
		const [b, half] = PAIR[g];
		const need = L.count * 4;
		if (!this._pack || this._pack.length < need) this._pack = new Float32Array(need);
		this.device.queue.writeBuffer(L.bufs[IN_BUFS[b]], half * L.count * 16, packGroup(g, L.attrs, L.count, this._pack), 0, need);
	}

	dropCloud(layer) {
		const L = this.layers[layer];
		if (!L) return;
		for (const b of Object.values(L.bufs)) b.destroy();
		delete this.layers[layer];
	}

	_inst(i) {
		let it = this.insts[i];
		if (!it) it = this.insts[i] = { buf: this.device.createBuffer({ size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), groups: {} };
		return it;
	}

	_groupsFor(it, layer) {
		const L = this.layers[layer];
		const g = it.groups[layer];
		if (g && g.ver === L.ver && g.tex === this.texVersion) return g;
		const D = this.device;
		const b = L.bufs;
		const e = (binding, buf) => ({ binding, resource: { buffer: buf } });
		const computeGroup = D.createBindGroup({
			layout: this.computeBGL,
			entries: [
				e(0, it.buf),
				e(1, b.in0),
				e(2, b.in1),
				e(3, b.in2),
				e(4, b.in3),
				e(9, b.outA),
				e(10, b.outB),
				e(11, b.outC),
				...this.texEntries(),
			],
		});
		const renderGroup = D.createBindGroup({
			layout: this.renderBGL,
			entries: [e(0, it.buf), e(1, b.outA), e(2, b.outB), e(3, b.outC), { binding: 4, resource: this.atlasTex.createView() }, { binding: 5, resource: this.sampler }],
		});
		return (it.groups[layer] = { computeGroup, renderGroup, ver: L.ver, tex: this.texVersion });
	}

	updateAttributes(names, layer = 'main') {
		const L = this.layers[layer];
		const groups = new Set();
		for (const nm of names) for (const g of ATTR_GROUPS[nm] || []) groups.add(g);
		for (const g of groups) this._writeGroup(L, g);
	}

	setSpectrum(bytes) {
		this.device.queue.writeTexture({ texture: this.specTex }, bytes, { bytesPerRow: 64 }, [64, 1]);
	}

	setPieces(floats) {
		this.device.queue.writeTexture({ texture: this.pieceTex }, floats, { bytesPerRow: 256 * 16 }, [256, 1]);
	}

	setFrames(data, cols, rows, n) {
		const cur = this.frTex;
		if (cur.width !== cols || cur.height !== rows || cur.depthOrArrayLayers !== n) {
			cur.destroy();
			this.frTex = this.device.createTexture({ size: [cols, rows, n], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			this.texVersion++;
		}
		this.device.queue.writeTexture({ texture: this.frTex }, data, { bytesPerRow: cols * 4, rowsPerImage: rows }, [cols, rows, n]);
	}

	setAtlas(canvas) {
		const w = canvas.width;
		const h = canvas.height;
		if (!w || !h) return;
		if (this.atlasTex.width !== w || this.atlasTex.height !== h) {
			this.atlasTex.destroy();
			this.atlasTex = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
			this.texVersion++;
		}
		this.device.queue.copyExternalImageToTexture({ source: canvas, flipY: true }, { texture: this.atlasTex }, [w, h]);
	}

	setHeroSource(source, w, h) {
		this._external('heroTex', source, w, h);
	}

	setScreenSource(source, w, h) {
		this._external('scrTex', source, w, h);
	}

	_external(key, source, w, h) {
		if (!w || !h) return;
		const tex = this._resize(key, w, h, 'rgba8unorm-srgb', true);
		const isVideo = typeof source.currentTime === 'number';
		const sig = (this._extSig ||= {});
		const prev = sig[key];
		const same = prev && prev.tex === tex && prev.source === source;
		if (same && !isVideo) return;
		if (same && isVideo) {
			const fresh = this._videoFresh(source, key);
			if (fresh === false || (fresh === undefined && prev.t === source.currentTime && source.paused)) return;
		}
		try {
			this.device.queue.copyExternalImageToTexture({ source, flipY: true }, { texture: tex, colorSpace: 'srgb' }, [w, h]);
			sig[key] = { tex, source, t: isVideo ? source.currentTime : 0 };
		} catch (e) {
		}
	}

	_videoFresh(video, key) {
		if (typeof video.requestVideoFrameCallback !== 'function') return undefined;
		const W = (this._vfc ||= new WeakMap());
		let st = W.get(video);
		if (!st) {
			st = { n: 0, seen: {}, at: performance.now() };
			W.set(video, st);
			const on = () => {
				st.n++;
				st.at = performance.now();
				video.requestVideoFrameCallback(on);
			};
			video.requestVideoFrameCallback(on);
			return true;
		}
		if (!video.paused && performance.now() - st.at > 300) return undefined;
		if (st.seen[key] === st.n) return false;
		st.seen[key] = st.n;
		return true;
	}

	setScreenDepth(data, w, h) {
		const tex = this._resize('scrDep', w, h, 'r8unorm');
		this.device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: w }, [w, h]);
	}

	setScreenMemory(data, w, h, rows = null) {
		const cur = this.scrMTex;
		const tex = this._resize('scrMTex', w, h, 'rgba8unorm');
		const [r0, r1] = rows && cur === tex ? rows : [0, h];
		if (r1 <= r0) return;
		this.device.queue.writeTexture({ texture: tex, origin: [0, r0] }, data, { offset: r0 * w * 4, bytesPerRow: w * 4 }, [w, r1 - r0]);
	}

	setSlit(data, cols, rows, M, layers = null) {
		let tex = this.slitTex;
		if (tex.width !== cols || tex.height !== rows || tex.depthOrArrayLayers !== M) {
			tex.destroy();
			tex = this.slitTex = this.device.createTexture({ size: [cols, rows, M], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			this.texVersion++;
			layers = null;
		}
		const per = cols * rows * 4;
		const write = (l, n) => this.device.queue.writeTexture({ texture: tex, origin: [0, 0, l] }, data, { offset: l * per, bytesPerRow: cols * 4, rowsPerImage: rows }, [cols, rows, n]);
		if (!layers) write(0, M);
		else for (const l of layers) write(l, 1);
	}

	setSort(data, w, h) {
		const tex = this._resize('sortTex', w, h, 'rg32float');
		this.device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: w * 8 }, [w, h]);
	}

	setExperimentTexture(key, image, row = null) {
		const { data, width, height } = image;
		const tex = this._resize(key, width, height, 'rgba32float');
		const start = row ?? 0;
		this.device.queue.writeTexture({ texture: tex, origin: [0, start] }, data, { offset: start * width * 16, bytesPerRow: width * 16 }, [width, row === null ? height : 1]);
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
								blend: add ? BLEND_ADD : undefined,
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

	prepareHero() {
		if (this.heroJob) return this.heroJob;
		const D = this.device;
		const module = D.createShaderModule({ code: pointsComputeHeroWGSL });
		this.heroJob = D.createComputePipelineAsync({ layout: D.createPipelineLayout({ bindGroupLayouts: [this.computeBGL] }), compute: { module, entryPoint: 'main' } })
			.then((p) => {
				this.pipelines.computeHero = p;
			})
			.catch((e) => {
				this.heroFailed = true;
				console.warn('WebGPU: не собрался шейдер «героя» раскадровки, его рисует WebGL:', e && e.message ? e.message : e);
			});
		return this.heroJob;
	}

	prepareShadow() {
		if (this.shadowJob) return this.shadowJob;
		const D = this.device;
		const jobs = [];
		const cm = D.createShaderModule({ code: pointsComputeShadowWGSL });
		jobs.push(
			D.createComputePipelineAsync({ layout: D.createPipelineLayout({ bindGroupLayouts: [this.computeBGL] }), compute: { module: cm, entryPoint: 'main' } }).then((p) => {
				this.pipelines.computeShadow = p;
			})
		);
		const module = D.createShaderModule({ code: shadowRenderWGSL });
		const layout = D.createPipelineLayout({ bindGroupLayouts: [this.renderBGL] });
		for (const add of [false, true]) {
			for (const rt of [false, true]) {
				jobs.push(
					D.createRenderPipelineAsync({
						layout,
						vertex: { module, entryPoint: 'vs' },
						fragment: { module, entryPoint: rt ? 'fs_raw' : 'fs', targets: [{ format: rt ? RT_FORMAT : this.format, blend: add ? BLEND_ADD : BLEND_NORMAL }] },
						primitive: { topology: 'triangle-strip' },
						depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
					}).then((p) => {
						this.pipelines['shadow-' + (add ? 'add' : 'normal') + (rt ? '-rt' : '')] = p;
					})
				);
			}
		}
		this.shadowJob = Promise.all(jobs).catch((e) => {
			this.shadowFailed = true;
			console.warn('WebGPU: не собрался шейдер «Тени на стене», её рисует WebGL:', e && e.message ? e.message : e);
		});
		return this.shadowJob;
	}

	shadowReady(rt) {
		return !!(this.pipelines.computeShadow && this.pipelines['shadow-add' + (rt ? '-rt' : '')] && this.pipelines['shadow-normal' + (rt ? '-rt' : '')]);
	}

	ready(add = true, rt = false) {
		return !!(this.pipelines.compute && this.pipelines['points-' + (add ? 'add' : 'normal') + (rt ? '-rt' : '')]);
	}

	heroReady() {
		return !!this.pipelines.computeHero;
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
		const pipeMain = this.pipelines['points-' + (add ? 'add' : 'normal') + (rt ? '-rt' : '')];
		let first = !opts.noClear;
		let slot = 1;
		list.forEach((own, i) => {
			const layer = own.layer || 'main';
			const L = this.layers[layer];
			const computePipe = own.shadow ? this.pipelines.computeShadow : layer === 'hero' ? this.pipelines.computeHero : this.pipelines.compute;
			const pipe = own.shadow ? this.pipelines['shadow-' + own.shadow + (rt ? '-rt' : '')] : pipeMain;
			if (!L || !computePipe) return;
			const main = own.main ?? (i === 0 && layer === 'main' && !own.shadow);
			const it = this._inst(main ? 0 : slot++);
			const g = this._groupsFor(it, layer);
			packFrame(shared, { uPx: [w, h], uExposure: 1, uTOff: 0, uGhost: 1, ...extra, ...own }, this.frameData);
			D.queue.writeBuffer(it.buf, 0, this.frameData);
			const cp = enc.beginComputePass();
			cp.setPipeline(computePipe);
			cp.setBindGroup(0, g.computeGroup);
			cp.dispatchWorkgroups(Math.ceil(L.count / 64));
			cp.end();
			if (main && this.pick) this._pickCopy(enc, L, own, extra);
			const rp = enc.beginRenderPass({
				colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: first ? 'clear' : 'load', storeOp: 'store' }],
				depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: first ? 'clear' : 'load', depthStoreOp: 'store' },
			});
			first = false;
			if (pipe) {
				rp.setPipeline(pipe);
				rp.setBindGroup(0, g.renderGroup);
				rp.draw(4, L.count);
			}
			rp.end();
		});
		if (first) {
			const rp = enc.beginRenderPass({
				colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
				depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
			});
			rp.end();
		}
		if (!opts.encoder) {
			D.queue.submit([enc.finish()]);
			this.pickMap();
		}
	}

	pickRequest(idxs) {
		const P = (this.pick ||= { buf: null, busy: null, want: null, res: null });
		P.want = idxs.slice(0, 16);
	}

	pickResult() {
		return this.pick ? this.pick.res : null;
	}

	_pickCopy(enc, L, own, extra) {
		const P = this.pick;
		if (P.busy || P.failed || !P.want || !own.modelViewMatrix || !extra.projectionMatrix) return;
		P.buf ||= this.device.createBuffer({ size: 16 * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
		const idxs = P.want.filter((id) => id != null && id >= 0 && id < L.count);
		idxs.forEach((id, k) => enc.copyBufferToBuffer(L.bufs.outA, id * 16, P.buf, k * 16, 16));
		P.snap = { idxs, mv: Float32Array.from(own.modelViewMatrix.elements), proj: Float32Array.from(extra.projectionMatrix.elements) };
		P.busy = 'copied';
	}

	pickMap() {
		const P = this.pick;
		if (!P || P.busy !== 'copied') return;
		P.busy = 'mapping';
		const snap = P.snap;
		P.buf
			.mapAsync(GPUMapMode.READ)
			.then(() => {
				P.res = { ...snap, clip: new Float32Array(P.buf.getMappedRange().slice(0)) };
				P.buf.unmap();
			})
			.catch(() => {
				P.failed = true;
			})
			.finally(() => (P.busy = null));
	}

	idle() {
		return this.device.queue.onSubmittedWorkDone();
	}

	dispose() {
		for (const L of Object.values(this.layers)) for (const b of Object.values(L.bufs)) b.destroy();
		this.layers = {};
		for (const it of this.insts) it.buf.destroy();
		for (const t of [this.specTex, this.pieceTex, this.frTex, this.heroTex, this.atlasTex, this.scrTex, this.scrDep, this.scrMTex, this.slitTex, this.sortTex, this.experimentField, this.experimentShapes]) t.destroy();
		this.dummyBuf.destroy();
		this.pick?.buf?.destroy();
		this.depth?.destroy();
		this.ctx.unconfigure();
	}
}
