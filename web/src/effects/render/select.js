import { WebGLBackend } from './webgl/webgl-backend.js';
import { WebGPUBackend } from './webgpu/webgpu-backend.js';
import { requestGpu, markGpuBad, gpuMarkedBad } from './webgpu/device.js';
import { perf } from '../../core/perf.js';
export function webgpuAvailable() {
return typeof navigator !== 'undefined' && !!navigator.gpu;
}
function forcedOn() {
try {
return (new URLSearchParams(location.search).get('gpu') ?? localStorage.getItem('pointbloom.gpu')) === '1';
} catch (e) {
return false;
}
}
export function pickBackendKind(setting = 'auto') {
if (!webgpuAvailable()) return 'webgl';
try {
const q = new URLSearchParams(location.search).get('gpu') ?? localStorage.getItem('pointbloom.gpu');
if (q === '1') return 'webgpu';
if (q === '0') return 'webgl';
} catch (e) {
}
if (setting === 'webgpu') return 'webgpu';
if (setting === 'webgl') return 'webgl';
return !gpuMarkedBad() && !perf.isApple && !perf.software ? 'webgpu' : 'webgl';
}
let gpuPromise = null;
export async function createBackend(kind, engine) {
if (kind === 'webgpu') {
gpuPromise ||= requestGpu({ allowFallback: forcedOn() }).catch(() => null);
const gpu = await gpuPromise;
if (!gpu) markGpuBad('нет адаптера или не хватает лимитов видеокарты');
if (gpu) {
if (!gpu.watched) {
gpu.watched = true;
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
