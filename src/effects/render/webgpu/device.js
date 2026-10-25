// Подключение к WebGPU: адаптер, устройство, формат холста.

/** Сколько буферов хранения нужно одному проходу расчёта (точки: 4 входа и 3 выхода, линии до 8). Это минимум, который WebGPU гарантирует любой видеокарте */
export const NEED_STORAGE_BUFFERS = 8;

const BAD_KEY = 'pointbloom.gpu.bad';

/** Запоминает, что WebGPU на этом компьютере не заработал: выбор «Авто» больше не будет его пробовать (ручной выбор в настройках остаётся в силе) */
export function markGpuBad(reason) {
	console.warn('WebGPU отключён для режима «Авто»:', reason);
	try {
		localStorage.setItem(BAD_KEY, String(reason || '1').slice(0, 200));
	} catch (e) {
		/* без хранилища отключение действует до перезагрузки страницы */
	}
}

export function gpuMarkedBad() {
	try {
		return !!localStorage.getItem(BAD_KEY);
	} catch (e) {
		return false;
	}
}

/** Есть ли WebGPU в браузере (предварительный признак, без запроса адаптера) */
export function webgpuSupported() {
	return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/**
 * Запрашивает видеокарту и устройство (allowFallback: разрешить программный адаптер). Возвращает { adapter, device, format, features } или null, если WebGPU недоступен
 * или видеокарта не тянет нужные лимиты (тогда остаётся WebGL).
 * Ошибки устройства (неверный шейдер, неправильная привязка буфера) печатаются в консоль: в WebGPU они иначе молчат.
 */
export async function requestGpu({ allowFallback = false } = {}) {
	if (!webgpuSupported()) return null;
	let adapter;
	try {
		adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
	} catch (e) {
		return null;
	}
	if (!adapter) return null;
	// программная реализация WebGPU (без видеокарты) медленнее WebGL: берётся только по прямому требованию
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
