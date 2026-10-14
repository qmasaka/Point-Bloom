// Подключение к WebGPU: адаптер, устройство, формат холста.

/** Есть ли WebGPU в браузере (предварительный признак, без запроса адаптера) */
export function webgpuSupported() {
	return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/**
 * Запрашивает видеокарту и устройство. Возвращает { adapter, device, format, features } или null, если WebGPU недоступен.
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
