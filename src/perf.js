// Оценка мощности видеокарты один раз при запуске: от неё зависят сглаживание, разрешение отрисовки, лимит кадров и «тяжесть» стекла в интерфейсе.
// Слабые видеокарты (встроенная графика Windows и ноутбуков) получают облегчённый режим, мощные (Apple, NVIDIA, AMD) остаются как есть.

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
// мощные видеокарты: Apple, NVIDIA, дискретные Radeon, встроенная графика AMD (Radeon 680M, 780M, «Radeon Graphics») и все Intel Arc, в том числе «Arc Graphics» у Core Ultra
const strong = /Apple M|Apple GPU|NVIDIA|GeForce|RTX|GTX|Quadro|Radeon RX|Radeon Pro|Radeon\(TM\) RX|RX \d{3,4}|Arc(?:\(TM\))?(?: Pro)?(?: Graphics| [AB]\d)|Radeon.*(?:[6789]\d0M|\bGraphics\b)|Iris Xe/i.test(gpu);
// программная отрисовка почти без видеокарты: единственный случай, когда настольному браузеру нужен совсем лёгкий режим
const software = /SwiftShader|llvmpipe|Basic Render|Software/i.test(gpu);
// high: мощная карта; mid: любая другая настольная (встроенная Intel UHD и подобные); low: телефоны и программная отрисовка
const tier = mobile || software ? 'low' : strong ? 'high' : 'mid';

export const perf = {
	gpu,
	tier,
	windows,
	// сглаживание нужно на любом настольном браузере: MSAA 4x на современных ПК почти ничего не стоит
	antialias: !mobile && !software,
	// на экранах с масштабом 175–200% разрешение не занижается: картинка не мылится
	maxPR: mobile || software ? 1.5 : 2,
	// на настольных устройствах кадры не ограничиваются: браузер сам идёт в такт с монитором (120, 144, 165 Гц)
	maxFps: mobile || software ? 60 : 0,
};

// лёгкое стекло интерфейса: на слабой видеокарте размытие под панелями считается каждый кадр и заметно тормозит
if (tier !== 'high') document.documentElement.classList.add('perf-lite');
// у Windows (Chrome через Direct3D 11) размытие под панелями дороже, чем на Mac: у крупных окон стекло чуть легче
if (windows) document.documentElement.classList.add('os-win');
