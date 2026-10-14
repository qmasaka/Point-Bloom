import { loadJSON, saveJSON, mergeDeep } from './util.js';

const KEY = 'objglb.settings.v1';

export const DEFAULTS = {
	display: 'material', // material | solid | wire | points | normals | uv
	flat: false,
	overlays: { grid: true, axes: true, wire: false, faces: false, bbox: true },
	media: { pts: 80000, relief: 'bright', depth: 0.5, recFps: 15, recSec: 10, cutDark: 0, cutLight: 1, key: '#00ff00', keyTol: 0, edges: 0, contrast: 1, sat: 1, post: 0, invert: false },
	point: { shape: 'circle', size: 3, attenuate: true, color: 'texture', solidColor: '#ffd166', surfaceCount: 200000, source: 'surface' },
	render: { bg: 'dark', exposure: 1, env: 1, tone: 'neutral', headlight: true, fov: 40, fps: false, autoQuality: true, fpsCap: 0 },
	nav: { leftOrbit: true, trackpad: false, zoomToCursor: true, invertZoom: false, autoPersp: true, ortho: false },
	snap: { on: false, move: 0.1, rotate: 15, scale: 0.1 },
	space: 'world',
	importOpts: { weld: true, centerOrigin: true },
	exportOpts: {
		format: 'glb',
		name: '',
		only: 'all',
		scale: 1,
		up: 'y',
		place: 'keep',
		weld: true,
		texFormat: 'auto',
		maxTex: 0,
		cloud: 'mesh',
		cloudCount: 500000,
		plyBinary: true,
		web: { title: '', bg: 'dark', autoRotate: false, ar: false, usdz: false, single: false, optimize: true },
	},
};

export function loadSettings() {
	const s = mergeDeep(DEFAULTS, loadJSON(KEY, {}));
	s.display = 'material'; // режим просмотра не запоминаем: новая сессия всегда начинается с материалов
	s.overlays.wire = false;
	s.overlays.faces = false;
	return s;
}

let pending = null;
export function saveSettings(settings) {
	clearTimeout(pending);
	pending = setTimeout(() => saveJSON(KEY, settings), 200);
}
