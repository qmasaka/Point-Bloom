// Подключение к WebGPU: адаптер, устройство, формат холста.

/** Сколько буферов хранения нужно проходу расчёта точек (8 входов, 3 выхода) */
export const NEED_STORAGE_BUFFERS = 11;

/** Есть ли WebGPU в браузере (предварительный признак, без запроса адаптера) */
export function webgpuSupported() {
	return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/**
 * Запрашивает видеокарту и устройство. Возвращает { adapter, device, format, features } или null, если WebGPU недоступен
 * или видеокарта не тянет нужные лимиты (тогда остаётся WebGL).
 * Ошибки устройства (неверный шейдер, неправильная привязка буфера) печатаются в консоль: в WebGPU они иначе молчат.
 */
export async function requestGpu() {
	if (!webgpuSupported()) return null;
	let adapter;
	try {
		adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
	} catch (e) {
		return null;
	}
	if (!adapter) return null;
	const lim = adapter.limits;
	if (lim.maxStorageBuffersPerShaderStage < NEED_STORAGE_BUFFERS) return null;
	const wanted = ['timestamp-query'].filter((f) => adapter.features.has(f));
	let device;
	try {
		device = await adapter.requestDevice({
			requiredFeatures: wanted,
			requiredLimits: {
				maxStorageBuffersPerShaderStage: NEED_STORAGE_BUFFERS,
				// облака до нескольких миллионов точек: по 16 байт на точку на каждый буфер
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
