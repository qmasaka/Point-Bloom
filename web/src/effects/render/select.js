import { WebGLBackend } from './webgl/webgl-backend.js';
import { WebGPUBackend } from './webgpu/webgpu-backend.js';
import { requestGpu } from './webgpu/device.js';
export function webgpuAvailable() {
return typeof navigator !== 'undefined' && !!navigator.gpu;
}
export function pickBackendKind() {
try {
const on = new URLSearchParams(location.search).get('gpu') === '1' || localStorage.getItem('pointbloom.gpu') === '1';
if (on && webgpuAvailable()) return 'webgpu';
} catch (e) {
}
return 'webgl';
}
let gpuPromise = null;
export async function createBackend(kind, engine) {
if (kind === 'webgpu') {
gpuPromise ||= requestGpu().catch(() => null);
const gpu = await gpuPromise;
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
