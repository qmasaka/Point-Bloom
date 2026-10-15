import { RT_FORMAT } from './webgpu-post.js';
import { MESH_PROGRAMS } from '../../shaders/wgsl/generated/mesh-programs.js';

/**
 * Линии из треугольников (связи, осциллограф) на WebGPU. Шейдеры порождает dev/gen-wgsl.mjs из боевого GLSL (shaders/glsl/line-*.js, scope-*.js):
 * проход расчёта обрабатывает каждую вершину (весь вершинный шейдер GLSL), затем треугольники рисуются по индексам.
 * Буферы и значения кадра общие с облаком точек (WebGPUPoints): линии двигаются теми же эффектами и теми же значениями.
 */
export class WebGPUMesh {
	/** @param {import('./webgpu-points.js').WebGPUPoints} points @param {'links'|'scope'} name */
	constructor(points, name) {
		this.pts = points;
		this.device = points.device;
		this.name = name;
		this.prog = MESH_PROGRAMS[name];
		this.pipelines = {};
		this.started = false;
		this.geo = null;
		this.bufs = null;
		this.drawCount = 0;
	}

	/** Собирает конвейеры асинхронно (один раз, по первому требованию) */
	prepare() {
		if (this.started) return this.job;
		this.started = true;
		const D = this.device;
		const pts = this.pts;
		const jobs = [];
		const cm = D.createShaderModule({ code: this.prog.compute });
		jobs.push(
			D.createComputePipelineAsync({ layout: D.createPipelineLayout({ bindGroupLayouts: [pts.computeBGL] }), compute: { module: cm, entryPoint: 'main' } }).then((p) => {
				this.pipelines.compute = p;
			})
		);
		const rm = D.createShaderModule({ code: this.prog.render });
		const layout = D.createPipelineLayout({ bindGroupLayouts: [pts.renderBGL] });
		for (const rt of [false, true]) {
			jobs.push(
				D.createRenderPipelineAsync({
					layout,
					vertex: { module: rm, entryPoint: 'vs' },
					fragment: {
						module: rm,
						entryPoint: rt ? 'fs_raw' : 'fs',
						targets: [{ format: rt ? RT_FORMAT : pts.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' } } }],
					},
					primitive: { topology: 'triangle-list', cullMode: 'none' },
					depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
				}).then((p) => {
					this.pipelines[rt ? 'rt' : 'screen'] = p;
				})
			);
		}
		this.job = Promise.all(jobs).catch((e) => {
			this.failed = true;
			console.warn('WebGPU: не собралась программа «' + this.name + '», объект рисует WebGL:', e && e.message ? e.message : e);
		});
		return this.job;
	}

	ready(rt = false) {
		return !!(this.pipelines.compute && this.pipelines[rt ? 'rt' : 'screen']);
	}

	_free() {
		if (!this.bufs) return;
		for (const b of [...this.bufs.slots, this.bufs.index, this.bufs.outClip, ...this.bufs.outV]) b.destroy();
		this.bufs = null;
	}

	_alloc(geo, V, idx) {
		const D = this.device;
		const pts = this.pts;
		this._free();
		const mk = (size, usage) => D.createBuffer({ size: Math.max(16, size), usage });
		const slots = Array.from({ length: this.prog.slots }, () => mk(V * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST));
		const outClip = mk(V * 16, GPUBufferUsage.STORAGE);
		const outV = [mk(V * 16, GPUBufferUsage.STORAGE), mk(V * 16, GPUBufferUsage.STORAGE)];
		const index = mk(idx.byteLength, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);
		const frameBuf = pts._inst(0).buf;
		this.bufs = { slots, outClip, outV, index, V, frameBuf };
		this.arrays = {};
		this.versions = {};
		this.indexArr = null;
		this.indexVer = -1;
		this._groups();
		this.geo = geo;
	}

	/** Привязки зависят от общих текстур облака: пересоздаются, когда те меняются (см. WebGPUPoints.texVersion) */
	_groups() {
		const D = this.device;
		const pts = this.pts;
		const b = this.bufs;
		const e = (binding, buffer) => ({ binding, resource: { buffer } });
		const dummy = pts.dummyBuf;
		this.computeGroup = D.createBindGroup({
			layout: pts.computeBGL,
			entries: [
				e(0, b.frameBuf),
				...[1, 2, 3, 4, 5, 6, 7, 8].map((bd) => e(bd, b.slots[bd - 1] || dummy)),
				e(9, b.outClip),
				e(10, b.outV[0]),
				e(11, b.outV[1]),
				{ binding: 12, resource: pts.specTex.createView() },
				{ binding: 13, resource: pts.sampler },
				{ binding: 14, resource: pts.pieceTex.createView() },
				{ binding: 15, resource: pts.frTex.createView({ dimension: '2d-array' }) },
				{ binding: 16, resource: pts.heroTex.createView() },
			],
		});
		this.renderGroup = D.createBindGroup({
			layout: pts.renderBGL,
			entries: [e(0, b.frameBuf), e(1, b.outClip), e(2, b.outV[0]), e(3, b.outV[1]), { binding: 4, resource: pts.atlasTex.createView() }, { binding: 5, resource: pts.sampler }],
		});
		this.texVer = pts.texVersion;
		this.frameBufUsed = b.frameBuf;
	}

	/**
	 * Приводит буферы в соответствие с геометрией three.js (атрибуты и индексы по версиям). Возвращает число индексов к рисованию.
	 * @param {import('three').BufferGeometry} geo
	 */
	sync(geo) {
		const pos = geo.attributes.position;
		const index = geo.index;
		if (!pos || !index) return 0;
		const V = pos.count;
		const idxArr = index.array instanceof Uint32Array ? index.array : Uint32Array.from(index.array);
		let realloc = !this.bufs || geo !== this.geo || this.bufs.V !== V || this.bufs.frameBuf !== this.pts._inst(0).buf || idxArr.byteLength > this.bufs.index.size;
		if (!realloc) {
			for (const [name] of this.prog.attrs) if (geo.attributes[name].array !== this.arrays[name]) realloc = true;
		}
		if (realloc) this._alloc(geo, V, idxArr);
		else if (this.texVer !== this.pts.texVersion) this._groups();
		const D = this.device;
		const dirty = new Set();
		for (const [name, slot] of this.prog.attrs.map((a) => [a[0], a[1]])) {
			const a = geo.attributes[name];
			if (this.arrays[name] !== a.array || this.versions[name] !== a.version) {
				this.arrays[name] = a.array;
				this.versions[name] = a.version;
				dirty.add(slot);
			}
		}
		for (const slot of dirty) {
			const out = new Float32Array(V * 4);
			for (const [name, s, off, n] of this.prog.attrs) {
				if (s !== slot) continue;
				const src = geo.attributes[name].array;
				for (let i = 0; i < V; i++) for (let c = 0; c < n; c++) out[i * 4 + off + c] = src[i * n + c];
			}
			D.queue.writeBuffer(this.bufs.slots[slot], 0, out);
		}
		const same = index.array === this.indexArr && index.version === this.indexVer;
		if (!same) {
			D.queue.writeBuffer(this.bufs.index, 0, idxArr);
			this.indexArr = index.array;
			this.indexVer = index.version;
		}
		const total = index.count;
		const r = geo.drawRange;
		this.drawCount = Math.max(0, Math.min(total, r.count === Infinity ? total : r.count));
		return this.drawCount;
	}

	/**
	 * Дописывает проходы в список команд: расчёт вершин и рисование поверх уже нарисованного (цель и глубина загружаются как есть).
	 * Значения кадра берутся из буфера первого экземпляра облака: вызывать после WebGPUPoints.frame.
	 */
	draw(enc, view, rt) {
		if (!this.bufs || !this.drawCount || !this.ready(rt)) return;
		const pts = this.pts;
		const verts = Math.min(this.bufs.V, Math.ceil(this.drawCount / 6) * 4);
		const cp = enc.beginComputePass();
		cp.setPipeline(this.pipelines.compute);
		cp.setBindGroup(0, this.computeGroup);
		cp.dispatchWorkgroups(Math.ceil(verts / 64));
		cp.end();
		const rp = enc.beginRenderPass({
			colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
			depthStencilAttachment: { view: pts.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		});
		rp.setPipeline(this.pipelines[rt ? 'rt' : 'screen']);
		rp.setBindGroup(0, this.renderGroup);
		rp.setIndexBuffer(this.bufs.index, 'uint32');
		rp.drawIndexed(this.drawCount);
		rp.end();
	}

	dispose() {
		this._free();
	}
}
