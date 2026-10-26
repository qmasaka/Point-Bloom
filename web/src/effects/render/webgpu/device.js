export const NEED_STORAGE_BUFFERS = 8;
const BAD_KEY = 'pointbloom.gpu.bad2';
const RETRY_MS = 10 * 60 * 1000;
const GIVE_UP_MS = 7 * 24 * 3600 * 1000;
function readBad() {
try {
if (localStorage.getItem('pointbloom.gpu.bad')) localStorage.removeItem('pointbloom.gpu.bad');
const v = JSON.parse(localStorage.getItem(BAD_KEY) || 'null');
return v && typeof v === 'object' ? v : null;
} catch (e) {
return null;
}
}
export function markGpuBad(reason, hard = false) {
console.warn('WebGPU отключён для режима «Авто» на время:', reason);
const prev = readBad();
const n = (prev?.n || 0) + 1;
try {
localStorage.setItem(BAD_KEY, JSON.stringify({ n: hard ? Math.max(3, n) : n, t: Date.now(), why: String(reason || '').slice(0, 200) }));
} catch (e) {
}
}
export function markGpuGood() {
try {
if (localStorage.getItem(BAD_KEY)) localStorage.removeItem(BAD_KEY);
} catch (e) {
}
}
export function gpuMarkedBad() {
const v = readBad();
if (!v) return false;
const age = Date.now() - (v.t || 0);
return v.n >= 3 ? age < GIVE_UP_MS : age < RETRY_MS;
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
