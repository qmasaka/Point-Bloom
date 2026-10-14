import { FRAME_BYTES, packFrame } from './frame-layout.js';
import { computeCopy, computeTwist, computeWave } from '../../shaders/wgsl/compute.js';
import { pointsShader } from '../../shaders/wgsl/points.js';

/**
 * Прототип рендера точек на WebGPU (этап 3 переноса).
 *  - позиции и цвета лежат в буферах видеокарты;
 *  - эффекты это отдельные вычислительные проходы (сейчас два: деформация и волны), собираются один раз и в фоне;
 *  - рисование: по два треугольника на точку, смешивание и тональная компрессия как в WebGL.
 * Порядок кадра: сброс позиций → включённые эффекты → рисование.
 */
export class WebGPUPoints {
	/** @param {{device: GPUDevice, format: string}} gpu результат requestGpu() @param {HTMLCanvasElement} canvas */
	constructor(gpu, canvas) {
		this.device = gpu.device;
		this.format = gpu.format;
		this.canvas = canvas;
		this.ctx = canvas.getContext('webgpu');
		this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
		this.count = 0;
		this.pipelines = {};
		this.frameData = new Float32Array(FRAME_BYTES / 4);
		this.frameBuf = this.device.createBuffer({ size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const D = this.device;
		const C = GPUShaderStage.COMPUTE;
		const V = GPUShaderStage.VERTEX;
		const F = GPUShaderStage.FRAGMENT;
		this.computeBGL = D.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: C, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
				{ binding: 2, visibility: C, buffer: { type: 'storage' } },
			],
		});
		this.renderBGL = D.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
				{ binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
				{ binding: 3, visibility: V, buffer: { type: 'read-only-storage' } },
			],
		});
		this.computeLayout = D.createPipelineLayout({ bindGroupLayouts: [this.computeBGL] });
		this.renderLayout = D.createPipelineLayout({ bindGroupLayouts: [this.renderBGL] });
		this.depth = null;
	}

	/**
	 * Загружает облако: positions и colors это Float32Array по 3 числа на точку.
	 * Базовые позиции (base) не меняются, текущие (pos) каждый кадр пересчитываются проходами эффектов.
	 */
	setCloud({ positions, colors }) {
		const D = this.device;
		const n = positions.length / 3;
		this.count = n;
		const base = new Float32Array(n * 4);
		const col = new Float32Array(n * 4);
		for (let i = 0; i < n; i++) {
			base[i * 4] = positions[i * 3];
			base[i * 4 + 1] = positions[i * 3 + 1];
			base[i * 4 + 2] = positions[i * 3 + 2];
			base[i * 4 + 3] = 1;
			col[i * 4] = colors ? colors[i * 3] : 1;
			col[i * 4 + 1] = colors ? colors[i * 3 + 1] : 1;
			col[i * 4 + 2] = colors ? colors[i * 3 + 2] : 1;
			col[i * 4 + 3] = 1; // видимость точки
		}
		for (const k of ['baseBuf', 'posBuf', 'colBuf']) this[k]?.destroy();
		const mk = (data, usage) => {
			const b = D.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
			D.queue.writeBuffer(b, 0, data);
			return b;
		};
		this.baseBuf = mk(base, GPUBufferUsage.STORAGE);
		this.posBuf = mk(base, GPUBufferUsage.STORAGE);
		this.colBuf = mk(col, GPUBufferUsage.STORAGE);
		this.computeGroup = D.createBindGroup({
			layout: this.computeBGL,
			entries: [
				{ binding: 0, resource: { buffer: this.frameBuf } },
				{ binding: 1, resource: { buffer: this.baseBuf } },
				{ binding: 2, resource: { buffer: this.posBuf } },
			],
		});
		this.renderGroup = D.createBindGroup({
			layout: this.renderBGL,
			entries: [
				{ binding: 0, resource: { buffer: this.frameBuf } },
				{ binding: 1, resource: { buffer: this.posBuf } },
				{ binding: 2, resource: { buffer: this.baseBuf } },
				{ binding: 3, resource: { buffer: this.colBuf } },
			],
		});
	}

	/**
	 * Собирает конвейеры асинхронно: главный поток не ждёт видеодрайвер (в WebGL это самое дорогое место на Windows).
	 * @param {{effects?: string[], salt?: number}} opts effects: какие вычислительные проходы нужны; salt: для проверки холодной сборки
	 * @returns {Promise<{blockedMs: number, readyMs: number}>} сколько главный поток был занят и за сколько всё стало готово
	 */
	async prepare({ effects = ['twist', 'wave'], salt = 0 } = {}) {
		const D = this.device;
		const t0 = performance.now();
		const jobs = [];
		const compute = (name, code) => {
			if (this.pipelines[name]) return;
			const module = D.createShaderModule({ code });
			jobs.push(
				D.createComputePipelineAsync({ layout: this.computeLayout, compute: { module, entryPoint: 'main' } }).then((p) => {
					this.pipelines[name] = p;
				})
			);
		};
		compute('copy', computeCopy());
		if (effects.includes('twist')) compute('twist', computeTwist(salt));
		if (effects.includes('wave')) compute('wave', computeWave(salt));
		for (const mode of ['add', 'normal']) {
			if (this.pipelines['points-' + mode]) continue;
			const module = D.createShaderModule({ code: pointsShader(salt) });
			const add = mode === 'add';
			jobs.push(
				D.createRenderPipelineAsync({
					layout: this.renderLayout,
					vertex: { module, entryPoint: 'vs' },
					fragment: {
						module,
						entryPoint: 'fs',
						targets: [
							{
								format: this.format,
								// как AdditiveBlending и «без смешивания» у three.js: SRC_ALPHA + ONE для цвета и альфы
								blend: add
									? { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' } }
									: undefined,
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

	/** Приводит размер холста и буфера глубины в порядок */
	resize(w, h) {
		if (this.canvas.width !== w) this.canvas.width = w;
		if (this.canvas.height !== h) this.canvas.height = h;
		if (!this.depth || this.depth.width !== w || this.depth.height !== h) {
			this.depth?.destroy();
			this.depth = this.device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
		}
	}

	/**
	 * Один кадр.
	 * @param {object} shared общие значения кадра (render/shared/frame-uniforms.js)
	 * @param {{proj: ArrayLike<number>, modelView: ArrayLike<number>, exposure?: number}} cam камера
	 * @param {{twist?: boolean, wave?: boolean}} on какие эффекты выполнять
	 */
	frame(shared, cam, on = {}) {
		const D = this.device;
		const w = this.canvas.width;
		const h = this.canvas.height;
		this.resize(w, h);
		packFrame(shared, { uRes: [w, h], uExposure: cam.exposure ?? 1, proj: cam.proj, modelView: cam.modelView }, this.frameData);
		D.queue.writeBuffer(this.frameBuf, 0, this.frameData);
		const enc = D.createCommandEncoder();
		const groups = Math.ceil(this.count / 64);
		const cp = enc.beginComputePass();
		cp.setBindGroup(0, this.computeGroup);
		for (const name of ['copy', on.twist && 'twist', on.wave && 'wave']) {
			if (!name || !this.pipelines[name]) continue;
			cp.setPipeline(this.pipelines[name]);
			cp.dispatchWorkgroups(groups);
		}
		cp.end();
		const add = shared.uAdd.value > 0.5;
		const rp = enc.beginRenderPass({
			colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
			depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
		});
		const pipe = this.pipelines[add ? 'points-add' : 'points-normal'];
		if (pipe) {
			rp.setPipeline(pipe);
			rp.setBindGroup(0, this.renderGroup);
			rp.draw(4, this.count);
		}
		rp.end();
		D.queue.submit([enc.finish()]);
	}

	/** Ждёт, пока видеокарта закончит все отправленные кадры (нужно для замеров) */
	idle() {
		return this.device.queue.onSubmittedWorkDone();
	}

	dispose() {
		for (const k of ['baseBuf', 'posBuf', 'colBuf', 'frameBuf']) this[k]?.destroy();
		this.depth?.destroy();
		this.ctx.unconfigure();
	}
}
