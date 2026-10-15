export const NEED_STORAGE_BUFFERS = 11;
const BAD_KEY = 'pointbloom.gpu.bad';
export function markGpuBad(reason) {
console.warn('WebGPU отключён для режима «Авто»:', reason);
try {
localStorage.setItem(BAD_KEY, String(reason || '1').slice(0, 200));
} catch (e) {
}
}
export function gpuMarkedBad() {
try {
return !!localStorage.getItem(BAD_KEY);
} catch (e) {
return false;
}
}
export function webgpuSupported() {
return typeof navigator !== 'undefined' && !!navigator.gpu;
}
export async function requestGpu({ allowFallback = false } = {}) {
if (!webgpuSupported()) return null;
let adapter;
try {
adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
} catch (e) {
return null;
}
if (!adapter) return null;
if (adapter.isFallbackAdapter && !allowFallback) return null;
const lim = adapter.limits;
if (lim.maxStorageBuffersPerShaderStage < NEED_STORAGE_BUFFERS) return null;
const wanted = ['timestamp-query'].filter((f) => adapter.features.has(f));
let device;
try {
device = await adapter.requestDevice({
requiredFeatures: wanted,
requiredLimits: {
maxStorageBuffersPerShaderStage: NEED_STORAGE_BUFFERS,
maxStorageBufferBindingSize: Math.min(lim.maxStorageBufferBindingSize, 1 << 30),
maxBufferSize: Math.min(lim.maxBufferSize, 1 << 30),
},
});
} catch (e) {
return null;
}
device.addEventListener('uncapturederror', (e) => console.error('WebGPU:', e.error && e.error.message));
return { adapter, device, format: navigator.gpu.getPreferredCanvasFormat(), features: [...device.features] };
}
