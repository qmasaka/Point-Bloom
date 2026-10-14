import { WebGLBackend } from './webgl/webgl-backend.js';
export function webgpuAvailable() {
return typeof navigator !== 'undefined' && !!navigator.gpu;
}
export function pickBackendKind() {
return 'webgl';
}
export function createBackend(kind, engine) {
if (kind === 'webgl') return new WebGLBackend(engine);
throw new Error('Неизвестный рендер-движок эффектов: ' + kind);
}
