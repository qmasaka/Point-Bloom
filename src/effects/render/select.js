import { WebGLBackend } from './webgl/webgl-backend.js';

/** Есть ли в браузере WebGPU (API есть, но проверка адаптера асинхронная, поэтому это лишь предварительный признак) */
export function webgpuAvailable() {
	return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/** Какой рендер-движок использовать. Пока всегда WebGL: WebGPU-реализация ещё не написана */
export function pickBackendKind() {
	return 'webgl';
}

/** Создаёт рендер-движок указанного вида для движка эффектов */
export function createBackend(kind, engine) {
	if (kind === 'webgl') return new WebGLBackend(engine);
	throw new Error('Неизвестный рендер-движок эффектов: ' + kind);
}
