import { WebGLBackend } from './webgl/webgl-backend.js';
import { WebGPUBackend } from './webgpu/webgpu-backend.js';
import { requestGpu } from './webgpu/device.js';

/** Есть ли в браузере WebGPU (API есть, но проверка адаптера асинхронная, поэтому это лишь предварительный признак) */
export function webgpuAvailable() {
	return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/**
 * Какой рендер-движок использовать. Пока WebGPU включается только вручную (адрес с ?gpu=1 или localStorage['pointbloom.gpu'] = '1'),
 * по умолчанию остаётся проверенный WebGL.
 */
export function pickBackendKind() {
	try {
		const on = new URLSearchParams(location.search).get('gpu') === '1' || localStorage.getItem('pointbloom.gpu') === '1';
		if (on && webgpuAvailable()) return 'webgpu';
	} catch (e) {
		/* без доступа к адресу и хранилищу остаётся WebGL */
	}
	return 'webgl';
}

let gpuPromise = null;

/** Создаёт рендер-движок указанного вида для движка эффектов. Если WebGPU не заработал, возвращает WebGL */
export async function createBackend(kind, engine) {
	if (kind === 'webgpu') {
		gpuPromise ||= requestGpu().catch(() => null);
		const gpu = await gpuPromise;
		if (gpu) {
			if (!gpu.watched) {
				gpu.watched = true;
				// потерянное устройство больше не годится: при следующем входе запрашивается новое
				gpu.device.lost.then(() => {
					gpuPromise = null;
				});
			}
			return new WebGPUBackend(engine, gpu);
		}
		gpuPromise = null;
		kind = 'webgl';
	}
	if (kind === 'webgl') return new WebGLBackend(engine);
	throw new Error('Неизвестный рендер-движок эффектов: ' + kind);
}
