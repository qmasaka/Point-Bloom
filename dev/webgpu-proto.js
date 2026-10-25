// Стенд сравнения WebGL и WebGPU. Результаты кладёт в window.__proto и в окно на странице.
//  compare(opts)  попиксельное сравнение картинок на одних и тех же значениях;
//  fuzz()         проверка каждого семейства эффектов на случайных значениях (ловит ошибки перевода GLSL → WGSL);
//  bench()        скорость;
//  cold()         холодная сборка шейдеров и подвисания.
import * as THREE from 'three';
import { generateShapePoints } from '../src/effects/shapes/shapes.js';
import { createFrameUniforms } from '../src/effects/render/shared/frame-uniforms.js';
import { vert } from '../src/effects/shaders/glsl/vert.js';
import { frag } from '../src/effects/shaders/glsl/frag.js';
import { FX_GUARDS, specializeFx } from '../src/effects/render/webgl/specialize.js';
import { FX_PALETTES } from '../src/effects/state/options.js';
import { requestGpu } from '../src/effects/render/webgpu/device.js';
import { WebGPUPoints } from '../src/effects/render/webgpu/webgpu-points.js';
import { missingFrameValues } from '../src/effects/render/webgpu/frame-layout.js';
import { WebGPUPost, RT_FORMAT } from '../src/effects/render/webgpu/webgpu-post.js';
import { fbFrag, outFrag } from '../src/effects/shaders/glsl/post.js';
import { POST_PASSES } from '../src/effects/shaders/wgsl/generated/post-passes.js';
import { PostPipeline } from '../src/effects/render/webgl/post-pipeline.js';
import { WebGPUTrail } from '../src/effects/render/webgpu/webgpu-trail.js';

const $ = (id) => document.getElementById(id);
const log = (s) => {
	$('log').textContent += '\n' + s;
};
const W = 640;
const H = 640;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
window.__proto = { results: {} };

// Проверка перевода шейдера: хеш fract(sin(x)*43758) хаотичен, и 1 бит разницы округления между компиляторами даёт совсем другое число.
// Для сравнения картинок он подменяется в обоих шейдерах на устойчивый, чтобы расхождения означали ошибки перевода, а не шум.
let stableHash = false;
const GLSL_HASH = 'float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453); }';
const GLSL_HASH_STABLE = 'float hash11(float p) { return fract(p * 0.7548776662 + 0.5); }';
const wgslStable = (code) => code.replace('fract((sin((p * 127.1)) * 43758.5453))', 'fract(((p * 0.7548776662) + 0.5))');
const prepOpts = (extra = {}) => ({ ...extra, mapShader: stableHash ? wgslStable : null });

let gpu = null;
let webgl = null; // { renderer, scene, camera, material, pts, shared, N, geometry }
let webgpu = null;

// ---------------------------------------------------------------- общая сцена
function makeShared(N, cloud, add) {
	const specTex = new THREE.DataTexture(new Uint8Array(64), 64, 1, THREE.RedFormat, THREE.UnsignedByteType);
	specTex.minFilter = specTex.magFilter = THREE.LinearFilter;
	specTex.needsUpdate = true;
	const pieceTex = new THREE.DataTexture(new Float32Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.FloatType);
	pieceTex.minFilter = pieceTex.magFilter = THREE.NearestFilter;
	pieceTex.needsUpdate = true;
	const shared = createFrameUniforms({ count: N, specTex, pieceTex });
	const pal = FX_PALETTES[0].c;
	shared.uP0.value.set(pal[0]);
	shared.uP1.value.set(pal[1]);
	shared.uP2.value.set(pal[2]);
	shared.uAdd.value = add ? 1 : 0;
	shared.uShape.value = 1;
	shared.uTime.value = 1.7;
	shared.uPR.value = 1;
	let lo = Infinity;
	let hi = -Infinity;
	for (let i = 1; i < cloud.positions.length; i += 3) {
		lo = Math.min(lo, cloud.positions[i]);
		hi = Math.max(hi, cloud.positions[i]);
	}
	shared.uYR.value.set(lo, hi);
	return shared;
}

/** Исходник вершинного шейдера: целиком, или урезанный под указанные условия (как в боевом движке) */
function glslSource(salt, onKeys = null) {
	let v = vert;
	if (stableHash) {
		if (!v.includes(GLSL_HASH)) throw new Error('не найден hash11 в GLSL');
		v = v.replace(GLSL_HASH, GLSL_HASH_STABLE);
	}
	if (onKeys) {
		const on = new Set(onKeys);
		v = specializeFx(v, (n, c, t) => (FX_GUARDS.has(n + '.' + c + '>' + t) ? on.has(n + '.' + c + '>' + t) : undefined));
	}
	if (salt) v = v.replace('gl_Position = projectionMatrix * mv;', `gl_Position = projectionMatrix * mv * ${(1 + salt).toFixed(9)};`);
	return v;
}

function makeWebGL(cloud, add, shared, { salt = 0, onKeys = null, renderer = null } = {}) {
	const g = new THREE.BufferGeometry();
	const n = cloud.count;
	const idx = new Float32Array(n);
	for (let i = 0; i < n; i++) idx[i] = i / n;
	const A = (arr, k) => new THREE.BufferAttribute(arr, k);
	g.setAttribute('position', A(new Float32Array(cloud.positions), 3));
	g.setAttribute('aOrigin', A(new Float32Array(cloud.positions), 3));
	g.setAttribute('aTarget', A(new Float32Array(cloud.positions), 3));
	g.setAttribute('aNormal', A(new Float32Array(cloud.normals), 3));
	g.setAttribute('aNormalB', A(new Float32Array(cloud.normals), 3));
	g.setAttribute('aPaint', A(new Float32Array(n * 4), 4));
	g.setAttribute('aColor', A(new Float32Array(cloud.colors), 3));
	g.setAttribute('aColorB', A(new Float32Array(cloud.colors), 3));
	g.setAttribute('aHide', A(new Float32Array(n), 1));
	g.setAttribute('aDepth', A(new Float32Array(n).fill(0.5), 1));
	g.setAttribute('aPath', A(new Float32Array(n), 1));
	g.setAttribute('aIdx', A(idx, 1));
	g.setAttribute('aSculpt', A(new Float32Array(n * 3), 3));
	g.setAttribute('aVis', A(new Float32Array(n * 2).fill(1), 2));
	const U = (v) => ({ value: v });
	const material = new THREE.ShaderMaterial({
		vertexShader: glslSource(salt, onKeys),
		fragmentShader: frag,
		transparent: add,
		depthWrite: !add,
		blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
		uniforms: { ...shared, uTOff: U(0), uGhost: U(1) },
	});
	const pts = new THREE.Points(g, material);
	pts.frustumCulled = false;
	const scene = new THREE.Scene();
	scene.add(pts);
	if (!renderer) {
		renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
		renderer.setPixelRatio(1);
		renderer.setSize(W, H, false);
		renderer.setClearColor(0x000000, 0);
		renderer.toneMapping = THREE.NeutralToneMapping;
		renderer.toneMappingExposure = 1;
	}
	const camera = new THREE.PerspectiveCamera(40, W / H, 0.01, 1000);
	camera.position.set(0, 0, 5.2);
	camera.lookAt(0, 0, 0);
	camera.updateMatrixWorld();
	return { renderer, scene, camera, material, pts, shared, N: n, geometry: g };
}

/** Матрицы так, как их считает three.js для объекта */
function matrices() {
	const p = webgl.pts;
	p.updateMatrixWorld();
	p.modelViewMatrix.multiplyMatrices(webgl.camera.matrixWorldInverse, p.matrixWorld);
	p.normalMatrix.getNormalMatrix(p.modelViewMatrix);
	return { modelMatrix: p.matrixWorld, modelViewMatrix: p.modelViewMatrix, projectionMatrix: webgl.camera.projectionMatrix, normalMatrix: p.normalMatrix };
}

const attrsOf = (g) => Object.fromEntries(['aOrigin', 'aTarget', 'aNormal', 'aNormalB', 'aPaint', 'aColor', 'aColorB', 'aHide', 'aDepth', 'aPath', 'aSculpt', 'aVis', 'aIdx'].map((k) => [k, g.attributes[k].array]));

async function setup(N, add, { salt = 0, onKeys = null } = {}) {
	if (!gpu) gpu = await requestGpu();
	if (!gpu) throw new Error('WebGPU недоступен или не хватает лимитов видеокарты');
	const cloud = generateShapePoints('torus', N);
	const shared = makeShared(N, cloud, add);
	const renderer = webgl ? webgl.renderer : null;
	if (webgl) {
		webgl.geometry.dispose();
		webgl.material.dispose();
	}
	webgl = makeWebGL(cloud, add, shared, { salt, onKeys, renderer });
	if (webgpu) webgpu.dispose();
	webgpu = new WebGPUPoints(gpu, $('gpu'));
	webgpu.resize(W, H);
	webgpu.setCloud(attrsOf(webgl.geometry), cloud.count);
	return { cloud, shared };
}

// ---------------------------------------------------------------- сравнение картинок
const snap = (cv) => {
	const c = document.createElement('canvas');
	c.width = W;
	c.height = H;
	const x = c.getContext('2d', { willReadFrequently: true });
	x.fillStyle = '#000';
	x.fillRect(0, 0, W, H);
	x.drawImage(cv, 0, 0);
	return x.getImageData(0, 0, W, H);
};

/** Рисует кадр в оба рендера и возвращает метрики расхождения */
async function renderAndDiff() {
	// у WebGPU содержимое холста живёт только до конца задачи: снимок берётся сразу после отправки кадра, без пауз
	webgl.renderer.render(webgl.scene, webgl.camera);
	webgpu.frame(webgl.shared, matrices());
	const a = snap($('gl'));
	const b = snap($('gpu'));
	await webgpu.idle();
	const out = $('diff').getContext('2d');
	const img = out.createImageData(W, H);
	let sum = 0;
	let big = 0;
	let max = 0;
	let lit = 0;
	for (let i = 0; i < a.data.length; i += 4) {
		let d = 0;
		for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a.data[i + k] - b.data[i + k]));
		const l = Math.max(a.data[i], a.data[i + 1], a.data[i + 2], b.data[i], b.data[i + 1], b.data[i + 2]);
		if (l > 8) lit++;
		sum += d;
		if (d > 12) big++;
		max = Math.max(max, d);
		img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, d * 4);
		img.data[i + 3] = 255;
	}
	out.putImageData(img, 0, 0);
	const px = a.data.length / 4;
	return { meanAbsDiff: +(sum / px).toFixed(3), pctOverFrame: +((big / px) * 100).toFixed(3), pctOfLit: lit ? +((big / lit) * 100).toFixed(2) : 0, maxDiff: max, lit };
}

async function compare(opts = {}) {
	const N = opts.n ?? +$('n').value;
	const add = (opts.mode ?? $('mode').value) === 'add';
	stableHash = !!opts.stableHash;
	await setup(N, add, { onKeys: opts.values ? null : ['uTwist.x>0.001', 'uWave.x>0.001'] });
	if (opts.values) {
		// заданные значения: { uFlow: [1, 2, 1, 0.5], uTrk: [[x, y, z, w], ...] }; шейдер WebGL берётся целиком
		for (const [name, v] of Object.entries(opts.values)) {
			const t = webgl.shared[name].value;
			if (Array.isArray(t)) v.forEach((x, i) => t[i].set(...x));
			else if (typeof t === 'number') webgl.shared[name].value = v;
			else t.set(...(Array.isArray(v) ? v : [v]));
		}
	} else {
		// по умолчанию два включённых эффекта: деформация и волны
		webgl.shared.uTwist.value.set(0.8, 0, 0.5, 0);
		webgl.shared.uWave.value.set(1.0, 4.0, 0, 0);
		webgl.shared.uWaveP.value.set(1.0, 0, 0.8, 0);
	}
	for (const k of ['uBright', 'uColorBy', 'uShape', 'uSize', 'uBeat', 'uGlow', 'uTime']) if (opts[k] !== undefined) webgl.shared[k].value = opts[k];
	const prep = await webgpu.prepare(prepOpts());
	const d = await renderAndDiff();
	const res = { n: N, mode: add ? 'additive' : 'normal', opts: JSON.stringify(opts), ...d, pipelineBlockedMs: +prep.blockedMs.toFixed(1), pipelineReadyMs: +prep.readyMs.toFixed(1) };
	window.__proto.results.compare = res;
	log('СРАВНЕНИЕ ' + JSON.stringify(res));
	return res;
}

// ---------------------------------------------------------------- случайные значения по семействам эффектов
const FAMILIES = {
	twist: ['uTwist'],
	wave: ['uWave', 'uWaveP', 'uWaveSrc'],
	spectrum: ['uSpec', 'uSpecP', '#spec'],
	pulse: ['uPulse', 'uPulseP'],
	blast: ['uBlast'],
	flow: ['uFlow'],
	curl: ['uCurl', 'uCurlP'],
	glitch: ['uGlitch', 'uGlitchP'],
	voxel: ['uVoxel', 'uVoxelP'],
	jitter: ['uJitter'],
	mask: ['uMask', 'uMaskA', 'uMaskShow'],
	contact: ['uContact', 'uTrk', 'uShockP', 'uImp'],
	shock: ['uShockP', 'uShock'],
	brush: ['uBrushParam', 'uBrushHits'],
	physics: ['uPhysics', 'uPhysP', 'uCollapseTime', 'uAsm'],
	hands: ['uHandP', 'uHand'],
	cursor: ['uMouseOn', 'uMouse', 'uCursor'],
	gravity: ['uGrav', 'uGravT', 'uGravP'],
	dissolve: ['uDis', 'uDisP', 'uDisQ', 'uDisT'],
	explode: ['uExp', 'uExpP', '#pieces'],
	grow: ['uGrow', 'uGrowP', 'uGrowSeed'],
	jelly: ['uJel', 'uJelO', 'uJelP'],
	mark: ['uMark', 'uContact', 'uTrk'],
	slice: ['uSlice', 'uSliceM', 'uSliceC'],
	depth: ['uDepth', 'uDepthP', 'uDepthQ'],
	scope: ['uScope', 'uScopeP', 'uScopeQ', 'uScopeC'],
	morph: ['uMorph', 'uMorphS', 'uMorphO', 'uSettle'],
	look: ['uLookP2', 'uDof', 'uPaintP', 'uShade', 'uBeat'],
};
// небольшой детерминированный генератор случайных чисел: результат можно повторить
let seed = 12345;
const rnd = () => {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 4294967296;
};
// 'wild': любые значения, в том числе огромные; 'tame': правдоподобные, как в приложении; 'mode': правдоподобные, но один компонент вектора пробегает режимы 0..6
let style = 'tame';
const randComp = () => (style === 'wild' ? (rnd() < 0.45 ? Math.floor(rnd() * 7) : +(rnd() * 1.6).toFixed(3)) : +(rnd() * 1.2).toFixed(3));

function randomize(shared, names) {
	for (const nm of names) {
		if (nm === '#spec') {
			const bytes = new Uint8Array(64).map(() => Math.floor(rnd() * 256));
			webgl.shared.uSpecTex.value.image.data.set(bytes);
			webgl.shared.uSpecTex.value.needsUpdate = true;
			webgpu.setSpectrum(bytes);
			continue;
		}
		if (nm === '#pieces') {
			const f = new Float32Array(256 * 4).map(() => (rnd() - 0.5) * 2);
			webgl.shared.uPieceTex.value.image.data.set(f);
			webgl.shared.uPieceTex.value.needsUpdate = true;
			webgpu.setPieces(f);
			continue;
		}
		const u = shared[nm];
		if (!u) throw new Error('нет значения ' + nm);
		const v = u.value;
		const fill = (x) => {
			if (x.isColor) {
				x.setRGB(rnd(), rnd(), rnd());
				return;
			}
			const ks = ['x', 'y', 'z', 'w'].filter((k) => k in x);
			for (const k of ks) x[k] = randComp();
			if (style === 'mode') x[ks[Math.floor(rnd() * ks.length)]] = Math.floor(rnd() * 7);
		};
		if (Array.isArray(v)) v.forEach((x) => fill(x));
		else if (typeof v === 'number') u.value = randComp();
		else fill(v);
	}
}

/** Возвращает значения кадра в исходное состояние (нули и значения по умолчанию) */
function resetShared(N, cloud) {
	const fresh = makeShared(N, cloud, true);
	for (const k of Object.keys(fresh)) {
		const a = webgl.shared[k] && webgl.shared[k].value;
		const b = fresh[k].value;
		if (typeof b === 'number') webgl.shared[k].value = b;
		else if (a && b && !a.isTexture && a.copy) a.copy(b);
		else if (Array.isArray(a)) a.forEach((x, i) => x.copy && x.copy(b[i]));
	}
}

/**
 * Для каждого семейства эффектов несколько раз: случайные значения → картинки WebGL и WebGPU → расхождение.
 * Ошибка перевода шейдера проявляется как большое расхождение в одном из семейств.
 */
async function fuzz(opts = {}) {
	const trials = opts.trials ?? 3;
	const only = opts.only;
	const N = opts.n ?? 30000;
	const rows = [];
	stableHash = !opts.realHash;
	style = opts.style ?? 'tame';
	await setup(N, true); // полный GLSL без урезания: он выполняет все ветви
	await webgpu.prepare(prepOpts());
	const cloud = generateShapePoints('torus', N);
	const miss = missingFrameValues(webgl.shared, { modelMatrix: 1, modelViewMatrix: 1, projectionMatrix: 1, viewMatrix: 1, normalMatrix: 1, uRes: 1, uPx: 1, uExposure: 1, uTone: 1, uTOff: 1, uGhost: 1 });
	if (miss.length) log('значения кадра, которых нет в данных (будут нулями): ' + miss.join(', '));
	for (const [fam, names] of Object.entries(FAMILIES)) {
		if (only && !only.includes(fam)) continue;
		for (let t = 0; t < trials; t++) {
			resetShared(N, cloud);
			const add = t % 2 === 0;
			webgl.shared.uAdd.value = add ? 1 : 0;
			webgl.shared.uTime.value = 1.3 + t * 0.9;
			webgl.material.transparent = add;
			webgl.material.depthWrite = !add;
			webgl.material.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
			webgl.material.needsUpdate = true;
			webgl.shared.uBright.value = 0.3;
			randomize(webgl.shared, names);
			const d = await renderAndDiff();
			const vals = {};
			for (const nm of names) {
				if (nm[0] === '#') continue;
				const v = webgl.shared[nm].value;
				vals[nm] = Array.isArray(v) ? v.map((x) => [x.x, x.y, x.z, x.w]) : typeof v === 'number' ? v : v.isColor ? [v.r, v.g, v.b] : [v.x, v.y, v.z, v.w];
			}
			rows.push({ family: fam, trial: t, mode: add ? 'add' : 'normal', time: webgl.shared.uTime.value, ...d, vals });
		}
		const last = rows.slice(-trials);
		log(`${fam}: ` + last.map((r) => `${r.meanAbsDiff}/${r.pctOfLit}%`).join('  '));
	}
	window.__proto.results.fuzz = rows;
	return rows;
}


// ---------------------------------------------------------------- пост-обработка: сравнение проходов
function makeInputCanvas(seedShift = 0) {
	const c = document.createElement('canvas');
	c.width = W;
	c.height = H;
	const x = c.getContext('2d');
	x.fillStyle = '#05060a';
	x.fillRect(0, 0, W, H);
	const g = x.createLinearGradient(0, 0, W, H);
	g.addColorStop(0, '#103060');
	g.addColorStop(1, '#602010');
	x.fillStyle = g;
	x.fillRect(80 + seedShift, 120, 360, 220);
	for (let i = 0; i < 60; i++) {
		x.fillStyle = `hsl(${(i * 37 + seedShift) % 360} 90% ${40 + (i % 5) * 12}%)`;
		x.beginPath();
		x.arc(((i * 97 + seedShift * 3) % 600) + 20, ((i * 53) % 560) + 40, 3 + (i % 7), 0, 7);
		x.fill();
	}
	x.fillStyle = '#fff';
	x.font = 'bold 64px sans-serif';
	x.fillText('Point', 150 + seedShift, 300);
	return c;
}

/** Цепочка «обратная связь → вывод со свечением и аберрацией» в WebGL и WebGPU на одном и том же входе */
async function postCompare(opts = {}) {
	if (!gpu) gpu = await requestGpu();
	if (!webgl) await setup(1000, true);
	const bloom = opts.bloom ?? 0.6;
	const ab = opts.ab ?? 0.5;
	const fb = opts.fb === undefined ? { decay: 0.9, zoom: 1.02, twist: 0.05, tint: [1, 0.6, 0.3], tintK: 0.5, hasPrev: 1 } : opts.fb;
	const cur = makeInputCanvas(0);
	const prev = makeInputCanvas(40);
	// ---- WebGL
	const R = webgl.renderer;
	const tex = (cv) => {
		const t = new THREE.CanvasTexture(cv);
		t.colorSpace = THREE.NoColorSpace;
		t.minFilter = t.magFilter = THREE.LinearFilter;
		t.generateMipmaps = false;
		return t;
	};
	const tCur = tex(cur);
	const tPrev = tex(prev);
	const vertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
	const quad = (mat) => {
		const sc = new THREE.Scene();
		sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
		return sc;
	};
	const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	let src = tCur;
	let rtFb = null;
	if (fb) {
		const fbMat = new THREE.ShaderMaterial({ uniforms: { uScene: { value: tCur }, uPrev: { value: tPrev }, uDecay: { value: fb.decay }, uZoom: { value: fb.zoom }, uTwist: { value: fb.twist }, uHasPrev: { value: fb.hasPrev }, uTint: { value: new THREE.Color(...fb.tint) }, uTintK: { value: fb.tintK } }, vertexShader: vertex, fragmentShader: fbFrag, depthTest: false, depthWrite: false });
		rtFb = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
		R.setRenderTarget(rtFb);
		R.clear();
		R.render(quad(fbMat), cam);
		R.setRenderTarget(null);
		src = rtFb.texture;
	}
	const outMat = new THREE.ShaderMaterial({ uniforms: { uTex: { value: src }, uBloom: { value: bloom }, uAberration: { value: ab }, uRes: { value: new THREE.Vector2(W, H) } }, vertexShader: vertex, fragmentShader: outFrag, depthTest: false, depthWrite: false, transparent: true });
	R.setRenderTarget(null);
	R.setClearColor(0x000000, 0);
	R.clear();
	R.render(quad(outMat), cam);
	// ---- WebGPU
	const D = gpu.device;
	const ctx = $('gpu').getContext('webgpu');
	ctx.configure({ device: D, format: gpu.format, alphaMode: 'premultiplied' });
	$('gpu').width = W;
	$('gpu').height = H;
	const post = new WebGPUPost(D, gpu.format);
	await post.prepare();
	const upload = (cv) => {
		const t = D.createTexture({ size: [W, H], format: RT_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
		// копирование из холста в 16-битную текстуру идёт через 8-битную промежуточную
		const t8 = D.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
		D.queue.copyExternalImageToTexture({ source: cv }, { texture: t8 }, [W, H]);
		return t8;
	};
	const gCur = upload(cur);
	const gPrev = upload(prev);
	const enc = D.createCommandEncoder();
	let source = gCur;
	if (fb) {
		const rt = post.rt('fbOut', W, H);
		post.run(enc, 'fb', rt.createView(), [W, H], { uDecay: fb.decay, uZoom: fb.zoom, uTwist: fb.twist, uHasPrev: fb.hasPrev, uTint: fb.tint, uTintK: fb.tintK }, { uScene: gCur.createView(), uPrev: gPrev.createView() });
		source = rt;
	}
	post.run(enc, 'out', ctx.getCurrentTexture().createView(), [W, H], { uBloom: bloom, uAberration: ab, uRes: [W, H] }, { uTex: source.createView() });
	D.queue.submit([enc.finish()]);
	const a = snap($('gl'));
	const b = snap($('gpu'));
	await D.queue.onSubmittedWorkDone();
	let sum = 0;
	let big = 0;
	let max = 0;
	for (let i = 0; i < a.data.length; i += 4) {
		let d = 0;
		for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a.data[i + k] - b.data[i + k]));
		sum += d;
		if (d > 8) big++;
		max = Math.max(max, d);
	}
	const px = a.data.length / 4;
	const res = { bloom, ab, fb: !!fb, meanAbsDiff: +(sum / px).toFixed(3), pctOver8: +((big / px) * 100).toFixed(3), maxDiff: max };
	log('ПОСТ ' + JSON.stringify(res));
	post.dispose();
	return res;
}


/** Датамош: несколько кадров с историей в WebGL (боевой PostPipeline) и в WebGPU (WebGPUPost.moshStep) на одном и том же движущемся входе */
async function moshCompare(opts = {}) {
	if (!gpu) gpu = await requestGpu();
	if (!webgl) await setup(1000, true);
	const frames = opts.frames ?? 5;
	const m = { on: true, hold: 1, gain: 1, block: 16, style: 0, smooth: 0.6, detail: 0.2, chroma: 0.25, quant: 0, stale: 0.2, jit: 0.4, drift: 0.3, angle: 4.7, flow: 0.2, inertia: 0.5, leak: 0.03, sceneMix: 1, time: 3.3, ...opts.m };
	const hashGl = 'fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)';
	const hashGlStable = 'fract(dot(p, vec2(0.7548776662, 0.569840291)) + 0.5)';
	const hashWg = 'fract((sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453))';
	// ---- WebGL
	const R = webgl.renderer;
	const pp = new PostPipeline(R);
	pp.setSize(W, H, 1);
	if (!pp.moshMat.fragmentShader.includes(hashGl)) throw new Error('не нашёл хеш в шейдере датамоша (WebGL)');
	pp.moshMat.fragmentShader = pp.moshMat.fragmentShader.replace(hashGl, hashGlStable);
	pp.moshMat.needsUpdate = true;
	for (const k of ['rtScene', 'rtSceneB']) {
		pp[k].texture.generateMipmaps = true;
		pp[k].texture.minFilter = THREE.LinearMipmapLinearFilter;
	}
	const vertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
	const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const quadOf = (mat) => {
		const sc = new THREE.Scene();
		sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
		return sc;
	};
	const copyMat = new THREE.ShaderMaterial({ uniforms: { uTex: { value: null } }, vertexShader: vertex, fragmentShader: 'varying vec2 vUv; uniform sampler2D uTex; void main() { gl_FragColor = texture2D(uTex, vUv); }', depthTest: false, depthWrite: false });
	const inputs = [];
	for (let f = 0; f < frames; f++) inputs.push(makeInputCanvas(f * 14));
	let src = null;
	for (let f = 0; f < frames; f++) {
		const t = new THREE.CanvasTexture(inputs[f]);
		t.colorSpace = THREE.NoColorSpace;
		t.minFilter = t.magFilter = THREE.LinearFilter;
		t.generateMipmaps = false;
		copyMat.uniforms.uTex.value = t;
		R.setRenderTarget(pp.rtScene);
		R.clear();
		R.render(quadOf(copyMat), cam);
		src = pp._moshStep(m);
	}
	const outMat = new THREE.ShaderMaterial({ uniforms: { uTex: { value: src }, uBloom: { value: 0 }, uAberration: { value: 0 }, uRes: { value: new THREE.Vector2(W, H) } }, vertexShader: vertex, fragmentShader: outFrag, depthTest: false, depthWrite: false, transparent: true });
	R.setRenderTarget(null);
	R.setClearColor(0x000000, 0);
	R.clear();
	R.render(quadOf(outMat), cam);
	// ---- WebGPU
	const D = gpu.device;
	const ctx = $('gpu').getContext('webgpu');
	ctx.configure({ device: D, format: gpu.format, alphaMode: 'premultiplied' });
	$('gpu').width = W;
	$('gpu').height = H;
	if (!POST_PASSES.mosh.wgsl.includes(hashWg)) throw new Error('не нашёл хеш в шейдере датамоша (WGSL)');
	const wgslOrig = POST_PASSES.mosh.wgsl;
	POST_PASSES.mosh.wgsl = wgslOrig.replace(hashWg, 'fract(((dot(p, vec2f(0.7548776662, 0.569840291))) + 0.5))');
	const post = new WebGPUPost(D, gpu.format);
	await post.prepare();
	POST_PASSES.mosh.wgsl = wgslOrig;
	const copyMod = D.createShaderModule({
		code: `@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f { return textureLoad(src, vec2i(pos.xy), 0); }`,
	});
	const copyPipe = await D.createRenderPipelineAsync({ layout: 'auto', vertex: { module: copyMod, entryPoint: 'vs' }, fragment: { module: copyMod, entryPoint: 'fs', targets: [{ format: RT_FORMAT }] }, primitive: { topology: 'triangle-list' } });
	let srcView = null;
	for (let f = 0; f < frames; f++) {
		const t8 = D.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
		D.queue.copyExternalImageToTexture({ source: inputs[f] }, { texture: t8 }, [W, H]);
		const enc = D.createCommandEncoder();
		const scene = post.rt('scene', W, H, { mips: true });
		const rp = enc.beginRenderPass({ colorAttachments: [{ view: scene.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
		rp.setPipeline(copyPipe);
		rp.setBindGroup(0, D.createBindGroup({ layout: copyPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: t8.createView() }] }));
		rp.draw(3);
		rp.end();
		srcView = post.moshStep(enc, m, [W, H]);
		if (f === frames - 1) post.run(enc, 'out', ctx.getCurrentTexture().createView(), [W, H], { uBloom: 0, uAberration: 0, uRes: [W, H] }, { uTex: srcView });
		D.queue.submit([enc.finish()]);
	}
	const a = snap($('gl'));
	const b = snap($('gpu'));
	await D.queue.onSubmittedWorkDone();
	let sum = 0;
	let big = 0;
	let max = 0;
	for (let i = 0; i < a.data.length; i += 4) {
		let d = 0;
		for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a.data[i + k] - b.data[i + k]));
		sum += d;
		if (d > 8) big++;
		max = Math.max(max, d);
	}
	const px = a.data.length / 4;
	const res = { frames, style: m.style, meanAbsDiff: +(sum / px).toFixed(3), pctOver8: +((big / px) * 100).toFixed(3), maxDiff: max };
	log('ДАТАМОШ ' + JSON.stringify(res));
	post.dispose();
	pp.dispose();
	return res;
}

/** Шлейф персонажа: те же точки рисует боевой материал WebGL (копия из engine/scope-trail.js) и WebGPUTrail */
async function trailCompare(opts = {}) {
	if (!gpu) gpu = await requestGpu();
	if (!webgl) await setup(1000, true);
	const mm = opts.mm ?? 3000;
	const n = opts.n ?? 4;
	const R = webgl.renderer;
	const cam = webgl.camera;
	const col = new Float32Array(mm * 3);
	const snaps = [];
	let seed = 7;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	for (let i = 0; i < col.length; i++) col[i] = rnd();
	for (let k = 0; k <= n; k++) {
		const a = new Float32Array(mm * 3);
		for (let i = 0; i < mm; i++) {
			const t = rnd() * 6.283;
			const r = 0.6 + 0.4 * rnd();
			a[i * 3] = Math.cos(t) * r + k * 0.12;
			a[i * 3 + 1] = (rnd() - 0.5) * 1.6;
			a[i * 3 + 2] = Math.sin(t) * r;
		}
		snaps.push(a);
	}
	const colAttr = new THREE.BufferAttribute(col, 3);
	const group = new THREE.Group();
	const ghosts = [];
	for (let k = 0; k < n; k++) {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(snaps[k + 1], 3));
		g.setAttribute('color', colAttr);
		const mat = new THREE.ShaderMaterial({
			uniforms: { uSize: { value: 1 }, uAlpha: { value: 0 }, uTint: { value: 0 }, uTintC: { value: new THREE.Color() } },
			vertexShader: 'attribute vec3 color; uniform float uSize; uniform float uTint; uniform vec3 uTintC; varying vec3 vC; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uSize * 3.8 / max(-mv.z, 0.4), 1.0, 60.0); vC = mix(color, uTintC, uTint); }',
			fragmentShader: 'precision highp float; uniform float uAlpha; varying vec3 vC; void main() {\n if (length(gl_PointCoord - 0.5) > 0.5) discard;\n  gl_FragColor = vec4(vC, uAlpha);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
			transparent: true,
			depthWrite: false,
			blending: THREE.NormalBlending,
		});
		const p = new THREE.Points(g, mat);
		p.renderOrder = -1;
		p.frustumCulled = false;
		group.add(p);
		ghosts.push(p);
		const mt = mat.uniforms;
		mt.uAlpha.value = 0.75 * Math.pow(0.7, k + 1);
		mt.uSize.value = 40 * (1 - 0.3 * (k / Math.max(1, n - 1)));
		mt.uTint.value = 0.4;
		mt.uTintC.value.setRGB(1, 0.5, 0.2);
	}
	group.rotation.y = 0.4;
	const scene = new THREE.Scene();
	scene.add(group);
	scene.updateMatrixWorld(true);
	cam.updateMatrixWorld(true);
	R.setRenderTarget(null);
	R.setClearColor(0x000000, 0);
	R.clear();
	R.render(scene, cam);
	// ---- WebGPU
	const D = gpu.device;
	const ctx = $('gpu').getContext('webgpu');
	ctx.configure({ device: D, format: gpu.format, alphaMode: 'premultiplied' });
	$('gpu').width = W;
	$('gpu').height = H;
	const tr = new WebGPUTrail(D, gpu.format);
	await tr.prepare();
	const trail = { group, ghosts };
	tr.sync(trail);
	const depth = D.createTexture({ size: [W, H], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
	const enc = D.createCommandEncoder();
	tr.draw(enc, ctx.getCurrentTexture().createView(), depth.createView(), false, trail, { mv: new THREE.Matrix4(), proj: cam.projectionMatrix, camera: cam, size: [W, H], exposure: R.toneMappingExposure });
	D.queue.submit([enc.finish()]);
	const a = snap($('gl'));
	const b = snap($('gpu'));
	await D.queue.onSubmittedWorkDone();
	let sum = 0;
	let big = 0;
	let max = 0;
	let lit = 0;
	for (let i = 0; i < a.data.length; i += 4) {
		let d = 0;
		for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a.data[i + k] - b.data[i + k]));
		if (a.data[i + 3] > 8 || b.data[i + 3] > 8) lit++;
		sum += d;
		if (d > 8) big++;
		max = Math.max(max, d);
	}
	const px = a.data.length / 4;
	const res = { mm, n, lit, meanAbsDiff: +(sum / px).toFixed(3), pctOver8OfLit: lit ? +((big / lit) * 100).toFixed(2) : 0, maxDiff: max };
	log('ШЛЕЙФ ' + JSON.stringify(res));
	tr.dispose();
	return res;
}

// ---------------------------------------------------------------- скорость
async function bench() {
	const rows = [];
	for (const N of [50000, 200000, 1000000, 2000000]) {
		for (const add of [true, false]) {
			await setup(N, add, { onKeys: ['uTwist.x>0.001', 'uWave.x>0.001'] });
			webgl.shared.uTwist.value.set(0.8, 0, 0.5, 0);
			webgl.shared.uWave.value.set(1.0, 4.0, 0, 0);
			webgl.shared.uWaveP.value.set(1.0, 0, 0.8, 0);
			await webgpu.prepare();
			const gl = webgl.renderer.getContext();
			const px = new Uint8Array(4);
			const K = N >= 1000000 ? 40 : 100;
			let bestGL = Infinity;
			for (let rep = 0; rep < 3; rep++) {
				for (let i = 0; i < 3; i++) webgl.renderer.render(webgl.scene, webgl.camera);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
				const t0 = performance.now();
				for (let i = 0; i < K; i++) {
					webgl.shared.uTime.value = i * 0.016;
					webgl.renderer.render(webgl.scene, webgl.camera);
				}
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
				bestGL = Math.min(bestGL, (performance.now() - t0) / K);
			}
			let bestGPU = Infinity;
			for (let rep = 0; rep < 3; rep++) {
				for (let i = 0; i < 3; i++) webgpu.frame(webgl.shared, matrices());
				await webgpu.idle();
				const t0 = performance.now();
				for (let i = 0; i < K; i++) {
					webgl.shared.uTime.value = i * 0.016;
					webgpu.frame(webgl.shared, matrices());
				}
				await webgpu.idle();
				bestGPU = Math.min(bestGPU, (performance.now() - t0) / K);
			}
			const row = { n: N, mode: add ? 'additive' : 'normal', webglMs: +bestGL.toFixed(2), webgpuMs: +bestGPU.toFixed(2), speedup: +(bestGL / bestGPU).toFixed(2) };
			rows.push(row);
			log('СКОРОСТЬ ' + JSON.stringify(row));
		}
	}
	window.__proto.results.bench = rows;
	return rows;
}

// ---------------------------------------------------------------- холодная сборка и подвисания
async function cold() {
	const N = +$('n').value;
	const add = $('mode').value === 'add';
	await setup(N, add);
	await webgpu.prepare();
	const gaps = { gl: 0, gpu: 0 };
	let watching = null;
	let last = performance.now();
	const tick = (t) => {
		if (watching) gaps[watching] = Math.max(gaps[watching], t - last);
		last = t;
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	await sleep(300);
	const salt = 1e-6 * (1 + Math.random() * 1000);
	watching = 'gl';
	const cloud = generateShapePoints('torus', N);
	const shared = makeShared(N, cloud, add);
	webgl.geometry.dispose();
	webgl.material.dispose();
	// боевой шейдер, как в движке: урезанный под два эффекта
	const w2 = makeWebGL(cloud, add, shared, { salt, onKeys: ['uTwist.x>0.001', 'uWave.x>0.001'], renderer: webgl.renderer });
	const t0 = performance.now();
	w2.renderer.compile(w2.scene, w2.camera);
	w2.renderer.render(w2.scene, w2.camera);
	const gl = w2.renderer.getContext();
	gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
	const glBlocked = performance.now() - t0;
	webgl = w2;
	await sleep(400);
	watching = 'gpu';
	webgpu.dispose();
	webgpu = new WebGPUPoints(gpu, $('gpu'));
	webgpu.resize(W, H);
	webgpu.setCloud(attrsOf(webgl.geometry), cloud.count);
	const t1 = performance.now();
	const prep = await webgpu.prepare({ salt });
	webgpu.frame(shared, matrices());
	await webgpu.idle();
	const gpuReady = performance.now() - t1;
	await sleep(400);
	watching = null;
	const res = {
		n: N,
		mode: add ? 'additive' : 'normal',
		webgl: { shader: 'урезан до 2 эффектов', mainThreadBlockedMs: +glBlocked.toFixed(1), longestFrameGapMs: +gaps.gl.toFixed(1) },
		webgpu: { shader: 'весь шейдер (все эффекты)', mainThreadBlockedMs: +prep.blockedMs.toFixed(1), readyAfterMs: +gpuReady.toFixed(1), longestFrameGapMs: +gaps.gpu.toFixed(1) },
	};
	window.__proto.results.cold = res;
	log('ХОЛОДНАЯ СБОРКА ' + JSON.stringify(res));
	return res;
}

$('bCompare').onclick = () => compare().catch((e) => log('ОШИБКА ' + e.message));
$('bBench').onclick = () => bench().catch((e) => log('ОШИБКА ' + e.message));
$('bCold').onclick = () => cold().catch((e) => log('ОШИБКА ' + e.message));
window.__proto.compare = compare;
window.__proto.bench = bench;
window.__proto.cold = cold;
window.__proto.fuzz = fuzz;
window.__proto.postCompare = postCompare;
window.__proto.moshCompare = moshCompare;
window.__proto.trailCompare = trailCompare;
window.__proto.dbg = { get webgl() { return webgl; }, get webgpu() { return webgpu; }, renderAndDiff, setup, resetShared };
requestGpu().then((g) => {
	gpu = g;
	log(g ? 'WebGPU: ' + (g.adapter.info ? g.adapter.info.vendor + ' ' + g.adapter.info.architecture : '') + ', формат холста ' + g.format : 'WebGPU недоступен или не хватает лимитов видеокарты');
});
