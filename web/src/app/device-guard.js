const FP_KEY = 'objglb.device';
function gpuName() {
try {
const c = document.createElement('canvas');
const gl = c.getContext('webgl2') || c.getContext('webgl');
if (!gl) return 'nogl';
const ext = gl.getExtension('WEBGL_debug_renderer_info');
const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
const lose = gl.getExtension('WEBGL_lose_context');
if (lose) lose.loseContext();
return String(name || 'gl');
} catch (e) {
return 'gl';
}
}
function hash(str) {
let h = 2166136261;
for (let i = 0; i < str.length; i++) {
h ^= str.charCodeAt(i);
h = Math.imul(h, 16777619);
}
return (h >>> 0).toString(36);
}
export function guardDevice() {
try {
const fp = hash([gpuName(), navigator.hardwareConcurrency || 0, navigator.platform || '', navigator.deviceMemory || 0].join('|'));
const prev = localStorage.getItem(FP_KEY);
if (prev && prev !== fp) {
for (const k of Object.keys(localStorage)) if (k.startsWith('objglb.')) localStorage.removeItem(k);
}
localStorage.setItem(FP_KEY, fp);
} catch (e) {
}
}
