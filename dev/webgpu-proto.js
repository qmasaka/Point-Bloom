// Стенд сравнения WebGL и WebGPU (этап 3). Результаты кладёт в window.__proto и в окно на странице.
import * as THREE from 'three';
import { generateShapePoints } from '../src/effects/shapes/shapes.js';
import { createFrameUniforms } from '../src/effects/render/shared/frame-uniforms.js';
import { vert } from '../src/effects/shaders/glsl/vert.js';
import { frag } from '../src/effects/shaders/glsl/frag.js';
import { FX_GUARDS, specializeFx } from '../src/effects/render/webgl/specialize.js';
import { FX_PALETTES } from '../src/effects/state/options.js';
import { requestGpu } from '../src/effects/render/webgpu/device.js';
import { WebGPUPoints } from '../src/effects/render/webgpu/webgpu-points.js';

const $ = (id) => document.getElementById(id);
const log = (s) => {
	$('log').textContent += '\n' + s;
};
const W = 640;
const H = 640;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => requestAnimationFrame(r));
window.__proto = { results: {} };

let gpu = null;
let webgl = null; // { renderer, scene, camera, material, shared, N }
let webgpu = null;

// ---------------------------------------------------------------- общая сцена
function makeShared(N, cloud, add) {
	const specTex = new THREE.DataTexture(new Uint8Array(64), 64, 1, THREE.RedFormat, THREE.UnsignedByteType);
	specTex.needsUpdate = true;
	const pieceTex = new THREE.DataTexture(new Float32Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.FloatType);
	pieceTex.needsUpdate = true;
	const shared = createFrameUniforms({ count: N, specTex, pieceTex });
	const pal = FX_PALETTES[0].c;
	shared.uP0.value.set(pal[0]);
	shared.uP1.value.set(pal[1]);
	shared.uP2.value.set(pal[2]);
	shared.uAdd.value = add ? 1 : 0;
	shared.uShape.value = 1; // круг
	shared.uTime.value = 1.7;
	shared.uPR.value = 1;
	// диапазон высоты формы
	let lo = Infinity;
	let hi = -Infinity;
	for (let i = 1; i < cloud.positions.length; i += 3) {
		lo = Math.min(lo, cloud.positions[i]);
		hi = Math.max(hi, cloud.positions[i]);
	}
	shared.uYR.value.set(lo, hi);
	// два включённых эффекта: деформация (режим «закрутка») и волны (режим «от точки»)
	shared.uTwist.value.set(0.8, 0, 0.5, 0);
	shared.uWave.value.set(1.0, 4.0, 0, 0);
	shared.uWaveP.value.set(1.0, 0, 0.8, 0);
	shared.uWaveSrc.value.set(0, 0, 0, 0);
	return shared;
}

function glslSource(salt) {
	const on = new Set(['uTwist.x>0.001', 'uWave.x>0.001']);
	let v = specializeFx(vert, (n, c, t) => (FX_GUARDS.has(n + '.' + c + '>' + t) ? on.has(n + '.' + c + '>' + t) : undefined));
	if (salt) v = v.replace('gl_Position = projectionMatrix * mv;', `gl_Position = projectionMatrix * mv * ${(1 + salt).toFixed(9)};`);
	return v;
}

function makeWebGL(N, cloud, add, shared, salt = 0, renderer = null) {
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
		vertexShader: glslSource(salt),
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
	return { renderer, scene, camera, material, pts, shared, N, geometry: g };
}

const camData = (cam) => ({ proj: cam.projectionMatrix.elements, modelView: cam.matrixWorldInverse.elements, exposure: 1 });

async function setup(N, add, { salt = 0, keepRenderer = true } = {}) {
	if (!gpu) gpu = await requestGpu();
	if (!gpu) throw new Error('WebGPU недоступен в этом браузере');
	const cloud = generateShapePoints('torus', N);
	const shared = makeShared(N, cloud, add);
	if (webgl) {
		webgl.geometry.dispose();
		webgl.material.dispose();
	}
	webgl = makeWebGL(N, cloud, add, shared, salt, keepRenderer && webgl ? webgl.renderer : null);
	if (webgpu) webgpu.dispose();
	webgpu = new WebGPUPoints(gpu, $('gpu'));
	webgpu.resize(W, H);
	webgpu.setCloud({ positions: cloud.positions, colors: cloud.colors });
	return { cloud, shared };
}

// ---------------------------------------------------------------- сравнение картинок
async function compare(opts = {}) {
	const N = opts.n ?? +$('n').value;
	const add = (opts.mode ?? $('mode').value) === 'add';
	await setup(N, add);
	for (const k of ['uBright', 'uColorBy', 'uShape', 'uSize', 'uBeat', 'uGlow', 'uTime']) if (opts[k] !== undefined) webgl.shared[k].value = opts[k];
	const prep = await webgpu.prepare({ effects: ['twist', 'wave'] });
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
	// у WebGPU содержимое холста живёт только до конца задачи: снимок берётся сразу после отправки кадра, без пауз
	webgl.renderer.render(webgl.scene, webgl.camera);
	webgpu.frame(webgl.shared, camData(webgl.camera), { twist: true, wave: true });
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
	const res = { n: N, mode: add ? 'additive' : 'normal', opts: JSON.stringify(opts), meanAbsDiff: +(sum / px).toFixed(3), pctDiffOver12: +((big / px) * 100).toFixed(3), maxDiff: max, litPixels: lit, pctOfLitDiffOver12: lit ? +((big / lit) * 100).toFixed(2) : 0, pipelineBlockedMs: +prep.blockedMs.toFixed(1), pipelineReadyMs: +prep.readyMs.toFixed(1) };
	window.__proto.results.compare = res;
	log('СРАВНЕНИЕ ' + JSON.stringify(res));
	return res;
}

// ---------------------------------------------------------------- скорость
async function bench() {
	const rows = [];
	for (const N of [50000, 200000, 1000000, 2000000]) {
		for (const add of [true, false]) {
			await setup(N, add);
			await webgpu.prepare({ effects: ['twist', 'wave'] });
			const gl = webgl.renderer.getContext();
			const px = new Uint8Array(4);
			const K = N >= 1000000 ? 40 : 100;
			// WebGL
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
			// WebGPU
			let bestGPU = Infinity;
			for (let rep = 0; rep < 3; rep++) {
				for (let i = 0; i < 3; i++) webgpu.frame(webgl.shared, camData(webgl.camera), { twist: true, wave: true });
				await webgpu.idle();
				const t0 = performance.now();
				for (let i = 0; i < K; i++) {
					webgl.shared.uTime.value = i * 0.016;
					webgpu.frame(webgl.shared, camData(webgl.camera), { twist: true, wave: true });
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
	await webgpu.prepare({ effects: ['twist', 'wave'] });
	// поток кадров: ловим самые долгие паузы, пока идёт сборка
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
	// WebGL: новый шейдер, сборка и первый кадр
	watching = 'gl';
	const { cloud } = { cloud: generateShapePoints('torus', N) };
	const shared = makeShared(N, cloud, add);
	webgl.geometry.dispose();
	webgl.material.dispose();
	const w2 = makeWebGL(N, cloud, add, shared, salt, webgl.renderer);
	const t0 = performance.now();
	w2.renderer.compile(w2.scene, w2.camera);
	w2.renderer.render(w2.scene, w2.camera);
	const gl = w2.renderer.getContext();
	gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
	const glBlocked = performance.now() - t0;
	webgl = w2;
	await sleep(400);
	// WebGPU: новые шейдеры
	watching = 'gpu';
	webgpu.dispose();
	webgpu = new WebGPUPoints(gpu, $('gpu'));
	webgpu.resize(W, H);
	webgpu.setCloud({ positions: cloud.positions, colors: cloud.colors });
	const t1 = performance.now();
	const prep = await webgpu.prepare({ effects: ['twist', 'wave'], salt });
	webgpu.frame(shared, camData(webgl.camera), { twist: true, wave: true });
	await webgpu.idle();
	const gpuReady = performance.now() - t1;
	await sleep(400);
	watching = null;
	const res = {
		n: N,
		mode: add ? 'additive' : 'normal',
		webgl: { mainThreadBlockedMs: +glBlocked.toFixed(1), longestFrameGapMs: +gaps.gl.toFixed(1) },
		webgpu: { mainThreadBlockedMs: +prep.blockedMs.toFixed(1), readyAfterMs: +gpuReady.toFixed(1), longestFrameGapMs: +gaps.gpu.toFixed(1) },
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
requestGpu().then((g) => {
	gpu = g;
	log(g ? 'WebGPU: ' + (g.adapter.info ? g.adapter.info.vendor + ' ' + g.adapter.info.architecture : '') + ', формат холста ' + g.format + ', возможности: ' + g.features.join(', ') : 'WebGPU недоступен');
});
