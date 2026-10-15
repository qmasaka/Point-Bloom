import { makeLayout, packLayout } from './frame-layout.js';
import { POST_PASSES } from '../../shaders/wgsl/generated/post-passes.js';

/**
 * Пост-обработка на WebGPU: обратная связь, свечение, хроматическая аберрация, датамош.
 * Шейдеры не написаны руками: их генерирует dev/gen-wgsl.mjs из тех же GLSL (shaders/glsl/post.js), что использует WebGL.
 * Каждый проход это полноэкранный треугольник: читает текстуры, пишет в цель (текстуру или холст).
 */

/** Формат промежуточных текстур: с запасом по яркости (свечение складывается выше единицы) */
export const RT_FORMAT = 'rgba16float';

export class WebGPUPost {
	/** @param {GPUDevice} device @param {string} canvasFormat формат холста: в него пишет последний проход */
	constructor(device, canvasFormat) {
		this.device = device;
		this.canvasFormat = canvasFormat;
		this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		this.pipelines = {};
		this.layouts = {};
		this.ubufs = {};
		this.data = {};
		for (const [name, p] of Object.entries(POST_PASSES)) {
			this.layouts[name] = makeLayout(p.spec);
			this.ubufs[name] = device.createBuffer({ size: Math.max(16, this.layouts[name].bytes), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			this.data[name] = new Float32Array(Math.max(16, this.layouts[name].bytes) / 4);
		}
		this.rts = {};
		this.size = [0, 0];
	}

	/** Собирает конвейеры асинхронно (главный поток не ждёт драйвер) */
	async prepare() {
		const D = this.device;
		const t0 = performance.now();
		const jobs = [];
		for (const [name, p] of Object.entries(POST_PASSES)) {
			if (this.pipelines[name]) continue;
			const module = D.createShaderModule({ code: p.wgsl });
			jobs.push(
				D.createRenderPipelineAsync({
					layout: 'auto',
					vertex: { module, entryPoint: 'vs' },
					fragment: { module, entryPoint: 'fs', targets: [{ format: name === 'out' ? this.canvasFormat : RT_FORMAT }] },
					primitive: { topology: 'triangle-list' },
				}).then((pl) => {
					this.pipelines[name] = pl;
				})
			);
		}
		const blockedMs = performance.now() - t0;
		await Promise.all(jobs);
		return { blockedMs, readyMs: performance.now() - t0 };
	}

	ready(name) {
		return !!this.pipelines[name];
	}

	/** Создаёт (или пересоздаёт при смене размера) промежуточную текстуру с именем key */
	rt(key, w, h, { mips = false } = {}) {
		const cur = this.rts[key];
		const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
		if (cur && cur.width === w && cur.height === h && cur.mipLevelCount === levels) return cur;
		cur?.destroy();
		const t = this.device.createTexture({
			size: [w, h],
			format: RT_FORMAT,
			mipLevelCount: levels,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
		});
		this.rts[key] = t;
		return t;
	}

	/**
	 * Выполняет проход.
	 * @param {GPUCommandEncoder} enc
	 * @param {string} name fb | out | mv | mosh
	 * @param {GPUTextureView} target куда рисовать
	 * @param {[number, number]} targetSize размер цели в пикселях
	 * @param {object} values значения uniform: { uDecay: 0.9, uTint: [r,g,b], ... }
	 * @param {Record<string, GPUTextureView>} textures текстуры по именам из шейдера (uScene, uPrev, ...)
	 * @param {boolean} [clear] очистить цель перед рисованием
	 */
	run(enc, name, target, targetSize, values, textures, clear = true) {
		const pass = POST_PASSES[name];
		const pipeline = this.pipelines[name];
		if (!pipeline) return false;
		packLayout(this.layouts[name], null, { uTarget: targetSize, uExposure: 1, ...values }, this.data[name]);
		this.device.queue.writeBuffer(this.ubufs[name], 0, this.data[name]);
		const entries = [{ binding: 0, resource: { buffer: this.ubufs[name] } }];
		pass.textures.forEach((tn, i) => {
			if (!textures[tn]) throw new Error(`проход ${name}: не передана текстура ${tn}`);
			entries.push({ binding: i + 1, resource: textures[tn] });
		});
		entries.push({ binding: pass.textures.length + 1, resource: this.sampler });
		const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
		const rp = enc.beginRenderPass({ colorAttachments: [{ view: target, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: clear ? 'clear' : 'load', storeOp: 'store' }] });
		rp.setPipeline(pipeline);
		rp.setBindGroup(0, group);
		rp.draw(3);
		rp.end();
		return true;
	}

	dispose() {
		for (const t of Object.values(this.rts)) t.destroy();
		for (const b of Object.values(this.ubufs)) b.destroy();
		this.rts = {};
	}
}
