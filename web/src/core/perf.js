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
const windows = /Windows|Win32|Win64/i.test(ua);
const isApple = /Apple M|Apple GPU/i.test(gpu) || (/Mac|iPhone|iPad|Macintosh/i.test(ua) && !windows);
const strong = /Apple M|Apple GPU|NVIDIA|GeForce|RTX|GTX|Quadro|Radeon RX|Radeon Pro|Radeon\(TM\) RX|RX \d{3,4}|Arc(?:\(TM\))?(?: Pro)?(?: Graphics| [AB]\d)|Radeon.*(?:[6789]\d0M|\bGraphics\b)|Iris Xe/i.test(gpu);
const software = /SwiftShader|llvmpipe|Basic Render|Software/i.test(gpu);
const tier = mobile || software ? 'low' : strong ? 'high' : 'mid';
export const perf = {
gpu,
tier,
windows,
isApple,
software,
antialias: !mobile && !software,
maxPR: mobile || software ? 1.5 : 2,
maxFps: mobile || software ? 60 : 0,
};
if (tier !== 'high') document.documentElement.classList.add('perf-lite');
if (windows) document.documentElement.classList.add('os-win');
