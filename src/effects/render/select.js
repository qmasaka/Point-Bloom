import { WebGLBackend } from './webgl/webgl-backend.js';
import { WebGPUBackend } from './webgpu/webgpu-backend.js';
import { requestGpu, markGpuBad, gpuMarkedBad } from './webgpu/device.js';
import { perf } from '../../core/perf.js';

/** Есть ли в браузере WebGPU (API есть, но проверка адаптера асинхронная, поэтому это лишь предварительный признак) */
export function webgpuAvailable() {
	return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/** Включён ли WebGPU вручную (адрес или localStorage): тогда он нужен даже на программном адаптере */
function forcedOn() {
	try {
		return (new URLSearchParams(location.search).get('gpu') ?? localStorage.getItem('pointbloom.gpu')) === '1';
	} catch (e) {
		return false;
	}
}

/**
 * Какой рендер-движок использовать.
 *  - Адрес с ?gpu=1 или ?gpu=0 (и localStorage['pointbloom.gpu'] = '1' | '0') важнее всего: для проверок.
 *  - Настройка «Движок отрисовки» (settings.render.backend): 'webgpu' или 'webgl' выбирают явно.
 *  - 'auto': на Windows и Linux WebGPU, если он есть и раньше не ломался (там WebGL подвисал на сборке шейдеров); на Mac остаётся WebGL, который и так работает быстро.
 * Если WebGPU не заработает на лету (потеря устройства, ошибка шейдера), кадры сами идут через WebGL, см. WebGPUBackend.
 * @param {string} [setting] значение settings.render.backend
 */
export function pickBackendKind(setting = 'auto') {
	if (!webgpuAvailable()) return 'webgl';
	try {
		const q = new URLSearchParams(location.search).get('gpu') ?? localStorage.getItem('pointbloom.gpu');
		if (q === '1') return 'webgpu';
		if (q === '0') return 'webgl';
	} catch (e) {
		/* без доступа к адресу и хранилищу остаётся выбор по настройке */
	}
	if (setting === 'webgpu') return 'webgpu';
	if (setting === 'webgl') return 'webgl';
	return !gpuMarkedBad() && !perf.isApple && !perf.software ? 'webgpu' : 'webgl';
}

let gpuPromise = null;

/** Создаёт рендер-движок указанного вида для движка эффектов. Если WebGPU не заработал, возвращает WebGL */
export async function createBackend(kind, engine) {
	if (kind === 'webgpu') {
		gpuPromise ||= requestGpu({ allowFallback: forcedOn() }).catch(() => null);
		const gpu = await gpuPromise;
		if (!gpu) markGpuBad('нет адаптера или не хватает лимитов видеокарты');
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
