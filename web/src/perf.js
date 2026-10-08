function gpuName() {
try {
const c = document.createElement('canvas');
const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
if (!gl) return '';
const ext = gl.getExtension('WEBGL_debug_renderer_info');
const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
gl.getExtension('WEBGL_lose_context')?.loseContext();
return name;
} catch (e) {
return '';
}
}
const gpu = gpuName();
const ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
const strong = /Apple M|Apple GPU|NVIDIA|GeForce|RTX|GTX|Quadro|Radeon RX|Radeon Pro|Radeon\(TM\) RX|Arc\(TM\) [AB]\d|RX \d{3,4}/i.test(gpu);
const tier = mobile ? 'low' : strong ? 'high' : 'low';
export const perf = {
gpu,
tier,
antialias: tier === 'high',
maxPR: tier === 'high' ? 2 : 1.5,
maxFps: tier === 'high' ? 0 : 60,
};
if (tier !== 'high') document.documentElement.classList.add('perf-lite');
