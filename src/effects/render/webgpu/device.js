// Подключение к WebGPU: адаптер, устройство, формат холста.

/** Сколько буферов хранения нужно одному проходу расчёта (точки: 4 входа и 3 выхода, линии до 8). Это минимум, который WebGPU гарантирует любой видеокарте */
export const NEED_STORAGE_BUFFERS = 8;

// раньше здесь лежала просто причина, и один сбой (сон компьютера, сброс драйвера) навсегда переводил «Авто» на WebGL. Теперь { n, t, why }: сколько сбоев и когда последний
const BAD_KEY = 'pointbloom.gpu.bad2';
// после одного-двух сбоев WebGPU пробуется снова через 10 минут; после трёх подряд «Авто» неделю берёт WebGL
const RETRY_MS = 10 * 60 * 1000;
const GIVE_UP_MS = 7 * 24 * 3600 * 1000;

function readBad() {
	try {
		// старая вечная отметка больше не действует
		if (localStorage.getItem('pointbloom.gpu.bad')) localStorage.removeItem('pointbloom.gpu.bad');
		const v = JSON.parse(localStorage.getItem(BAD_KEY) || 'null');
		return v && typeof v === 'object' ? v : null;
	} catch (e) {
		return null;
	}
}

/** Запоминает сбой WebGPU: «Авто» какое-то время берёт WebGL (ручной выбор в настройках остаётся в силе). hard: сбой не случайный (шейдер не собрался), сразу на неделю */
export function markGpuBad(reason, hard = false) {
	console.warn('WebGPU отключён для режима «Авто» на время:', reason);
	const prev = readBad();
	const n = (prev?.n || 0) + 1;
	try {
		localStorage.setItem(BAD_KEY, JSON.stringify({ n: hard ? Math.max(3, n) : n, t: Date.now(), why: String(reason || '').slice(0, 200) }));
	} catch (e) {
		/* без хранилища отключение действует до перезагрузки страницы */
	}
}

/** WebGPU заработал: счётчик сбоев обнуляется */
export function markGpuGood() {
	try {
		if (localStorage.getItem(BAD_KEY)) localStorage.removeItem(BAD_KEY);
	} catch (e) {
		/* не страшно */
	}
}

export function gpuMarkedBad() {
	const v = readBad();
	if (!v) return false;
	const age = Date.now() - (v.t || 0);
	return v.n >= 3 ? age < GIVE_UP_MS : age < RETRY_MS;
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
