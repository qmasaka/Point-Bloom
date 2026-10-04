// Оценка возможностей компьютера: сколько точек облака можно создать, показать и сохранить.
// Браузер не отдаёт точный объём ОЗУ, поэтому память оценивается, а скорость измеряется реальным замером.
import * as THREE from 'three';
import { loadJSON, saveJSON, yieldUI } from './util.js';
import { sampleSurface } from './pointcloud.js';

const CACHE_KEY = 'objglb.bench.v1';

/** Сколько байт на одну точку в пике: массивы на процессоре + буфер на видеокарте + копии при экспорте */
export const BYTES_PER_POINT = { cpu: 36, gpu: 36, export: 56 };
const PEAK_BYTES = BYTES_PER_POINT.cpu + BYTES_PER_POINT.gpu + BYTES_PER_POINT.export;

export function deviceInfo(app) {
	const r = app.viewport.renderer;
	const gl = r.getContext();
	const ext = gl.getExtension('WEBGL_debug_renderer_info');
	let gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
	gpu = String(gpu || 'Видеокарта не определена').replace(/ANGLE \((.*)\)/, '$1').replace(/Direct3D11 vs_5_0 ps_5_0.*$/, '').replace(/, OpenGL.*$/, '').trim();
	const ua = navigator.userAgent || '';
	const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
	const heap = performance && performance.memory ? performance.memory.jsHeapSizeLimit : null;
	return {
		gpu,
		cores: navigator.hardwareConcurrency || null,
		memGB: navigator.deviceMemory || null, // Chrome: округляется и не больше 8
		heapMB: heap ? Math.round(heap / 1048576) : null,
		maxTexture: r.capabilities.maxTextureSize,
		mobile,
		integrated: /Intel|Apple|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(gpu),
	};
}

/** Верхняя граница по памяти: сколько точек безопасно держать в одной вкладке */
export function memoryCap(info) {
	let gb;
	if (info.memGB) gb = info.memGB > 8 ? info.memGB : info.memGB === 8 ? 12 : info.memGB; // «8» в Chrome означает «8 и больше»
	else gb = info.mobile ? 3 : 8;
	let budget = gb * 1e9 * 0.18;
	if (info.heapMB) budget = Math.min(budget, info.heapMB * 1048576 * 3); // typed-массивы лежат вне кучи, но осторожность не помешает
	const cap = Math.floor(budget / PEAK_BYTES);
	return Math.max(100000, Math.min(cap, info.mobile ? 2000000 : 12000000));
}

/** Оценка без замера: по типу видеокарты и устройства */
export function guessLimits(info) {
	const cap = memoryCap(info);
	const comfort = info.mobile ? 300000 : info.integrated ? 1500000 : 5000000;
	return { cap, comfort: Math.min(comfort, cap), max: Math.min(cap, comfort * 3), measured: false, ptsPerMs: null, cpuPtsPerSec: null };
}

export function loadCachedBench(info) {
	const c = loadJSON(CACHE_KEY, null);
	if (c && c.gpu === info.gpu && c.cores === info.cores) return c;
	return null;
}

/**
 * Замер: рисуем миллион точек во внутренний буфер и засекаем время, затем засекаем скорость генерации.
 * Возвращает { ptsPerMs, cpuPtsPerSec, comfort, max, cap }.
 */
export async function runBenchmark(app, onProgress) {
	const info = deviceInfo(app);
	const r = app.viewport.renderer;
	const gl = r.getContext();
	const N = 1000000;
	onProgress && onProgress('Измеряю видеокарту', 0.1);
	await yieldUI();

	// 1. GPU: 1 млн случайных точек в offscreen-буфер 1280x720
	const rt = new THREE.WebGLRenderTarget(1280, 720, { depthBuffer: true });
	const scene = new THREE.Scene();
	const cam = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 100);
	cam.position.set(0, 0, 4);
	const pos = new Float32Array(N * 3);
	const col = new Float32Array(N * 3);
	for (let i = 0; i < N * 3; i++) {
		pos[i] = (Math.random() - 0.5) * 3;
		col[i] = Math.random();
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.BufferAttribute(col, 3));
	const pts = new THREE.Points(g, app.display.pointMat);
	pts.frustumCulled = false;
	scene.add(pts);
	app.display.updateUniforms(cam, { width: 1280, height: 720 }, app.nav);
	const px = new Uint8Array(4);
	const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
	const old = r.getRenderTarget();
	r.setRenderTarget(rt);
	r.render(scene, cam); // прогрев: загрузка буферов и компиляция шейдера
	sync();
	const t0 = performance.now();
	const frames = 6;
	for (let i = 0; i < frames; i++) {
		r.render(scene, cam);
		sync();
	}
	const msFrame = (performance.now() - t0) / frames;
	// «пустой» кадр для вычитания фиксированных затрат
	scene.remove(pts);
	const tb = performance.now();
	for (let i = 0; i < frames; i++) {
		r.render(scene, cam);
		sync();
	}
	const base = (performance.now() - tb) / frames;
	r.setRenderTarget(old);
	rt.dispose();
	g.dispose();
	const ptsPerMs = N / Math.max(0.2, msFrame - base * 0.8);

	// 2. CPU: скорость создания облака из поверхности
	onProgress && onProgress('Измеряю процессор', 0.6);
	await yieldUI();
	const ico = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 24), new THREE.MeshStandardMaterial({ color: 0xcccccc }));
	ico.updateMatrixWorld(true);
	const tc = performance.now();
	const sample = 150000;
	await sampleSurface([{ mesh: ico, mats: ico.material }], sample, { seed: 1 });
	const cpuPtsPerSec = (sample / Math.max(1, performance.now() - tc)) * 1000;
	ico.geometry.dispose();

	const cap = memoryCap(info);
	const budget60 = Math.max(0, 14 - base) * ptsPerMs * 0.7; // комфортные ~60 к/с
	const budget15 = Math.max(0, 60 - base) * ptsPerMs * 0.7; // терпимые ~15 к/с
	const comfort = Math.min(cap, roundNice(Math.max(100000, budget60)));
	const max = Math.min(cap, roundNice(Math.max(comfort, budget15)));
	const res = { gpu: info.gpu, cores: info.cores, ptsPerMs, cpuPtsPerSec, cap, comfort, max, measured: true, when: Date.now() };
	saveJSON(CACHE_KEY, res);
	onProgress && onProgress('Готово', 1);
	return res;
}

/** Красивые круглые числа: 1.2 млн, 850 тыс. */
export function roundNice(n) {
	if (n < 200000) return Math.round(n / 10000) * 10000;
	if (n < 1000000) return Math.round(n / 50000) * 50000;
	if (n < 5000000) return Math.round(n / 100000) * 100000;
	return Math.round(n / 500000) * 500000;
}

export function formatCount(n) {
	if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + ' млн';
	if (n >= 1e3) return Math.round(n / 1e3) + ' тыс.';
	return String(n);
}

/** Оценка занимаемой памяти для N точек */
export function pointMemoryMB(n) {
	return (n * PEAK_BYTES) / 1048576;
}
