import { FRAME_BYTES, packFrame } from './frame-layout.js';
import { RT_FORMAT } from './webgpu-post.js';
import { pointsComputeWGSL } from '../../shaders/wgsl/generated/points-compute.js';
import { pointsComputeHeroWGSL } from '../../shaders/wgsl/generated/points-compute-hero.js';
import { pointsRenderWGSL } from '../../shaders/wgsl/generated/points-render.js';

/**
 * Рендер облака точек на WebGPU. Шейдеры не написаны руками: их генерирует dev/gen-wgsl.mjs из боевого GLSL.
 * Кадр: проход расчёта (одна точка → положение на экране, размер, цвет; это весь вершинный шейдер GLSL) → рисование квадратов по этим данным.
 *
 * Облаков может быть два («слоя»): основное и «герой» раскадровки (видео поверх блока кадров, свой вариант шейдера).
 */

// какие группы буферов зависят от каких атрибутов точек (имена как в GLSL)
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

/** Собирает один буфер из исходных массивов: по 4 числа на точку */
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
	/** @param {{device: GPUDevice, format: string}} gpu результат requestGpu() @param {HTMLCanvasElement} canvas */
	constructor(gpu, canvas) {
		this.device = gpu.device;
		this.format = gpu.format;
		this.canvas = canvas;
		this.ctx = canvas.getContext('webgpu');
		this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
		this.pipelines = {};
		this.layers = {}; // 'main' | 'hero' → { count, attrs, bufs }
		this.frameData = new Float32Array(FRAME_BYTES / 4);
		const D = this.device;
		this.texVersion = 0; // растёт, когда служебные текстуры заменяются (привязки пересоздаются, в том числе у линий)
		this.insts = []; // по набору значений на каждый рисуемый экземпляр (облако, призраки шлейфа, герой)
		this.sampler = D.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		// служебные текстуры: спектр звука (для эффекта «Спектр»), центры кусков (для «Разбора на части»), кадры раскадровки, кадр видео для «героя» и атлас символов (заглушки до первого использования)
		this.specTex = D.createTexture({ size: [64, 1], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		this.pieceTex = D.createTexture({ size: [256, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		this.frTex = D.createTexture({ size: [1, 1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		this.heroTex = D.createTexture({ size: [1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
		this.atlasTex = D.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });

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
		this.dummyBuf = D.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE }); // заглушка для неиспользуемых привязок
		this.depth = null;
	}

	get count() {
		return this.layers.main ? this.layers.main.count : 0;
	}

	/**
	 * Загружает облако. attrs: массивы как в GLSL-атрибутах (aOrigin, aTarget, aNormal, aNormalB, aColor, aColorB, aPaint, aHide, aDepth, aPath, aSculpt, aVis).
	 * Недостающие атрибуты считаются нулями; aVis по умолчанию 1, aIdx по умолчанию i / n.
	 * @param {string} [layer] 'main' (по умолчанию) или 'hero'
	 */
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
		for (const g of GROUPS) {
			L.bufs[g]?.destroy();
			L.bufs[g] = D.createBuffer({ size: n * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
			D.queue.writeBuffer(L.bufs[g], 0, packGroup(g, attrs, n));
		}
		for (const k of ['outA', 'outB', 'outC']) {
			L.bufs[k]?.destroy();
			L.bufs[k] = D.createBuffer({ size: n * 16, usage: GPUBufferUsage.STORAGE });
		}
	}

	/** Убирает облако слоя (например, «героя», когда видео закрыто) */
	dropCloud(layer) {
		const L = this.layers[layer];
		if (!L) return;
		for (const b of Object.values(L.bufs)) b.destroy();
		delete this.layers[layer];
	}

	/** Буфер значений экземпляра i (создаётся при первом обращении) */
	_inst(i) {
		let it = this.insts[i];
		if (!it) it = this.insts[i] = { buf: this.device.createBuffer({ size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), groups: {} };
		return it;
	}

	/** Привязки экземпляра для облака слоя: пересоздаются, если облако или служебные текстуры заменились */
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
			entries: [e(0, it.buf), e(1, b.outA), e(2, b.outB), e(3, b.outC), { binding: 4, resource: this.atlasTex.createView() }, { binding: 5, resource: this.sampler }],
		});
		return (it.groups[layer] = { computeGroup, renderGroup, ver: L.ver, tex: this.texVersion });
	}

	/** Перезаписывает данные точек, зависящие от изменившихся атрибутов (имена как в GLSL) */
	updateAttributes(names, layer = 'main') {
		const L = this.layers[layer];
		const groups = new Set();
		for (const nm of names) for (const g of ATTR_GROUPS[nm] || []) groups.add(g);
		for (const g of groups) this.device.queue.writeBuffer(L.bufs[g], 0, packGroup(g, L.attrs, L.count));
	}

	/** Спектр звука: 64 байта (значения 0..255) */
	setSpectrum(bytes) {
		this.device.queue.writeTexture({ texture: this.specTex }, bytes, { bytesPerRow: 64 }, [64, 1]);
	}

	/** Центры кусков для эффекта «Разбор на части»: 256 векторов по 4 числа */
	setPieces(floats) {
		this.device.queue.writeTexture({ texture: this.pieceTex }, floats, { bytesPerRow: 256 * 16 }, [256, 1]);
	}

	/**
	 * Кадры раскадровки: слои текстуры-массива (по одному кадру) в виде одного байтового массива RGBA, цвета в sRGB.
	 * Пересоздаёт текстуру, если изменился размер или число кадров.
	 */
	setFrames(data, cols, rows, n) {
		const cur = this.frTex;
		if (cur.width !== cols || cur.height !== rows || cur.depthOrArrayLayers !== n) {
			cur.destroy();
			this.frTex = this.device.createTexture({ size: [cols, rows, n], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			this.texVersion++;
		}
		this.device.queue.writeTexture({ texture: this.frTex }, data, { bytesPerRow: cols * 4, rowsPerImage: rows }, [cols, rows, n]);
	}

	/** Атлас символов для точек-букв (холст с рядом символов; переворачивается по вертикали, как текстура WebGL) */
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

	/** Кадр видео для «героя» (HTMLVideoElement, ImageBitmap, холст); переворачивается по вертикали, как текстура WebGL */
	setHeroSource(source, w, h) {
		if (!w || !h) return;
		if (this.heroTex.width !== w || this.heroTex.height !== h) {
			this.heroTex.destroy();
			this.heroTex = this.device.createTexture({ size: [w, h], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
			this.texVersion++;
		}
		try {
			this.device.queue.copyExternalImageToTexture({ source, flipY: true }, { texture: this.heroTex, colorSpace: 'srgb' }, [w, h]);
		} catch (e) {
			/* кадр видео ещё не готов: остаётся прошлый */
		}
	}

	/**
	 * Собирает конвейеры асинхронно: главный поток не ждёт видеодрайвер (в WebGL это самое дорогое место на Windows).
	 * @param {{salt?: number, mapShader?: (code: string) => string}} opts salt: для проверки холодной сборки (меняет число в шейдере, чтобы кеш не помог); mapShader: подмена текста шейдера (для проверок)
	 * @returns {Promise<{blockedMs: number, readyMs: number}>} сколько главный поток был занят и за сколько всё стало готово
	 */
	async prepare({ salt = 0, mapShader = null } = {}) {
		const D = this.device;
		const t0 = performance.now();
		const salted = (code) => {
			const c = salt ? code.replace('43758.5453', (43758.5453 + salt).toFixed(6)) : code;
			return mapShader ? mapShader(c) : c;
		};
		const jobs = [];
		if (this._mapped !== mapShader) {
			// другой вариант шейдера (только для проверок): пересобрать
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
								// как AdditiveBlending у three.js: SRC_ALPHA + ONE для цвета и альфы; непрозрачный режим без смешивания
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

	/** Вариант расчёта для «героя» раскадровки: собирается по первому требованию (это вторая большая программа) */
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

	/** Готов ли конвейер расчёта и рисования для указанного режима */
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

	/**
	 * Один кадр.
	 * @param {object} shared общие значения кадра (render/shared/frame-uniforms.js)
	 * @param {object} extra значения рендера, общие для всех экземпляров: projectionMatrix (матрица three.js), uExposure
	 * @param {object[]} [list] по записи на экземпляр (облако, призраки шлейфа, герой): { modelMatrix, modelViewMatrix, normalMatrix, uTOff, uGhost, uHero, layer: 'main' | 'hero' }; по умолчанию одно облако
	 * @param {{view?: GPUTextureView, size?: number[], rt?: boolean, noClear?: boolean, encoder?: GPUCommandEncoder}} [opts] куда рисовать: холст (по умолчанию) или текстура (rt: true, формат RT_FORMAT, без тон-маппинга);
	 *   noClear: не очищать цель и глубину (до облака уже что-то нарисовано, например шлейф);
	 *   с encoder кадр дописывается в чужой список команд (его отправит вызывающий)
	 */
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
		let first = !opts.noClear;
		list.forEach((own, i) => {
			const layer = own.layer || 'main';
			const L = this.layers[layer];
			const computePipe = layer === 'hero' ? this.pipelines.computeHero : this.pipelines.compute;
			if (!L || !computePipe) return;
			const it = this._inst(i);
			const g = this._groupsFor(it, layer);
			packFrame(shared, { uRes: [w, h], uExposure: 1, uTOff: 0, uGhost: 1, ...extra, ...own }, this.frameData);
			D.queue.writeBuffer(it.buf, 0, this.frameData);
			const cp = enc.beginComputePass();
			cp.setPipeline(computePipe);
			cp.setBindGroup(0, g.computeGroup);
			cp.dispatchWorkgroups(Math.ceil(L.count / 64));
			cp.end();
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
		// если ничего не нарисовано, цель всё равно очищается
		if (first) {
			const rp = enc.beginRenderPass({
				colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
				depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
			});
			rp.end();
		}
		if (!opts.encoder) D.queue.submit([enc.finish()]);
	}

	/** Ждёт, пока видеокарта закончит все отправленные кадры (нужно для замеров) */
	idle() {
		return this.device.queue.onSubmittedWorkDone();
	}

	dispose() {
		for (const L of Object.values(this.layers)) for (const b of Object.values(L.bufs)) b.destroy();
		this.layers = {};
		for (const it of this.insts) it.buf.destroy();
		for (const t of [this.specTex, this.pieceTex, this.frTex, this.heroTex, this.atlasTex]) t.destroy();
		this.dummyBuf.destroy();
		this.depth?.destroy();
		this.ctx.unconfigure();
	}
}
