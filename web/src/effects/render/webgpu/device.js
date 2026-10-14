export function webgpuSupported() {
return typeof navigator !== 'undefined' && !!navigator.gpu;
}
export async function requestGpu() {
if (!webgpuSupported()) return null;
let adapter;
try {
adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
} catch (e) {
return null;
}
if (!adapter) return null;
const wanted = ['timestamp-query'].filter((f) => adapter.features.has(f));
let device;
try {
device = await adapter.requestDevice({ requiredFeatures: wanted });
} catch (e) {
return null;
}
device.addEventListener('uncapturederror', (e) => console.error('WebGPU:', e.error && e.error.message));
return { adapter, device, format: navigator.gpu.getPreferredCanvasFormat(), features: [...device.features] };
}
