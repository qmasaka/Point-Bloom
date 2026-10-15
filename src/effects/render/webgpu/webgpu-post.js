import { makeLayout, packLayout } from './frame-layout.js';
import { POST_PASSES } from '../../shaders/wgsl/generated/post-passes.js';

/**
 * Пост-обработка на WebGPU: обратная связь, свечение, хроматическая аберрация, датамош.
 * Шейдеры не написаны руками: их генерирует dev/gen-wgsl.mjs из тех же GLSL (shaders/glsl/post.js), что использует WebGL.
 * Каждый проход это полноэкранный треугольник: читает текстуры, пишет в цель (текстуру или холст).
 */

/** Формат промежуточных текстур: с запасом по яркости (свечение складывается выше единицы) */
export const RT_FORMAT = 'rgba16float';

// следующий уровень мип-цепочки: каждый пиксель берёт среднее четырёх пикселей предыдущего уровня (границы нечётных размеров прижимаются к краю)
const MIP_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
	let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
	return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
	let d = vec2i(textureDimensions(src)) - 1;
	let p = vec2i(pos.xy) * 2;
	let a = textureLoad(src, min(p, d), 0);
	let b = textureLoad(src, min(p + vec2i(1, 0), d), 0);
	let c = textureLoad(src, min(p + vec2i(0, 1), d), 0);
	let e = textureLoad(src, min(p + vec2i(1, 1), d), 0);
	return (a + b + c + e) * 0.25;
}`;

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
		this.mipModule = device.createShaderModule({ code: MIP_WGSL });
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
		if (!this.mipPipeline) {
			jobs.push(
				D.createRenderPipelineAsync({
					layout: 'auto',
					vertex: { module: this.mipModule, entryPoint: 'vs' },
					fragment: { module: this.mipModule, entryPoint: 'fs', targets: [{ format: RT_FORMAT }] },
					primitive: { topology: 'triangle-list' },
				}).then((pl) => {
					this.mipPipeline = pl;
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

	/** Дозаполняет мип-уровни текстуры (нужны датамошу: он ищет движение по уменьшенным копиям кадра) */
	generateMips(enc, tex) {
		if (!this.mipPipeline) return false;
		for (let l = 1; l < tex.mipLevelCount; l++) {
			const group = this.device.createBindGroup({
				layout: this.mipPipeline.getBindGroupLayout(0),
				entries: [{ binding: 0, resource: tex.createView({ baseMipLevel: l - 1, mipLevelCount: 1 }) }],
			});
			const rp = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView({ baseMipLevel: l, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
			rp.setPipeline(this.mipPipeline);
			rp.setBindGroup(0, group);
			rp.draw(3);
			rp.end();
		}
		return true;
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

	/**
	 * Один шаг датамоша: поле движения по блокам, затем «декодирование без опорного кадра» (те же шейдеры, что в WebGL, см. PostPipeline._moshStep).
	 * Ждёт, что сцена уже нарисована в this.rts.scene (с мип-уровнями, см. rt(..., { mips: true })). Возвращает вид текстуры кадра после «сбоя».
	 */
	moshStep(enc, m, size) {
		const post = this;
		const [w, h] = size;
		const block = m.block;
		const mw = Math.max(1, Math.ceil(w / block));
		const mh = Math.max(1, Math.ceil(h / block));
		const key = block + '/' + w + 'x' + h;
		if (this.moshKey !== key) {
			this.moshKey = key;
			this.moshHist = false;
		}
		const hist = this.moshHist;
		const k = h / 1080;
		const range = 4 * block + 0.03 * h;
		const scene = post.rts.scene;
		const sceneB = post.rt('sceneB', w, h, { mips: true });
		const mvA = post.rt('mvA', mw, mh);
		const mvB = post.rt('mvB', mw, mh);
		const moshA = post.rt('moshA', w, h);
		const moshB = post.rt('moshB', w, h);
		post.generateMips(enc, scene);
		post.run(
			enc,
			'mv',
			mvB.createView(),
			[mw, mh],
			{
				uRes: size,
				uBlock: block,
				uRange: range,
				uGain: m.gain,
				uInertia: hist ? m.inertia : 0,
				uSceneMix: m.sceneMix,
				uHasPrev: hist ? 1 : 0,
				uDrift: [Math.cos(m.angle) * m.drift * 6 * k, Math.sin(m.angle) * m.drift * 6 * k],
				uFlow: m.flow * 4 * k,
				uTime: m.time,
			},
			{ uCur: scene.createView(), uPrev: sceneB.createView(), uPrevMV: mvA.createView() }
		);
		post.rts.mvA = mvB;
		post.rts.mvB = mvA;
		post.run(
			enc,
			'mosh',
			moshB.createView(),
			size,
			{
				uRes: size,
				uMVSize: [mw, mh],
				uBlock: block,
				uRange: range,
				uSmooth: m.smooth,
				uHold: m.hold,
				uResid: m.detail,
				uChroma: m.chroma,
				uQuant: m.quant,
				uStyle: m.style,
				uStale: m.stale,
				uJit: m.jit,
				uTime: m.time,
				uHasHist: hist ? 1 : 0,
				uLeak: m.leak,
			},
			{ uCur: scene.createView(), uPrevSrc: sceneB.createView(), uMoshPrev: moshA.createView(), uMV: mvB.createView() }
		);
		post.rts.moshA = moshB;
		post.rts.moshB = moshA;
		// текущий кадр становится «прошлым» для следующего шага
		post.rts.scene = sceneB;
		post.rts.sceneB = scene;
		this.moshHist = true;
		return moshB.createView();
	}

	/** Датамош выключен: его буферы не нужны, история сбрасывается */
	moshOff() {
		if (!this.moshHist && !this.rts.sceneB) return;
		this.moshHist = false;
		for (const k of ['sceneB', 'mvA', 'mvB', 'moshA', 'moshB']) {
			this.rts[k]?.destroy();
			delete this.rts[k];
		}
	}

	dispose() {
		for (const t of Object.values(this.rts)) t.destroy();
		for (const b of Object.values(this.ubufs)) b.destroy();
		this.rts = {};
	}
}
