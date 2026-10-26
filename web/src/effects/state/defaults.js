import { FX_LAYERS } from './layers.js';
import { AUDIO_DEF } from './options.js';
export function defaultState() {
const layers = {};
for (const l of FX_LAYERS) layers[l.id] = { ...AUDIO_DEF, ...l.def };
return {
source: 'sphere',
count: 150000,
layers,
media: { pts: 80000, relief: 'bright', depth: 0.5 },
morphCfg: { mode: 'manual', interval: 4, time: 2.6, order: 'seq', weight: 'auto', style: 'flow', scatter: 0.8, stagger: 0.35, turns: 1, sort: 'random', ease: 'smooth', glow: 0.4, band: 'bass', amode: 'gate', lo: 0.05, hi: 0.3, thr: 0.5, atk: 0.08, rel: 0.6, react: 0.6, gap: 1, lift: 0, spin: 0, fsize: 1 },
mask: { mode: 'none', size: 0.5, soft: 0.4, speed: 0.5, invert: false, show: false },
look: {
bg: '',
grid: false,
vignette: true,
palette: 'cyber',
colorBy: 'disp',
size: 3.5,
glow: 0.8,
bright: 1,
blend: 'normal',
hud: false,
hudSpectrum: true,
autoRotate: false,
rotSpeed: 0.25,
sizeNoise: 0.0,
sizeAudio: 0.0,
brightAudio: 0.0,
audioBand: 'bass',
glyph: 'off',
shade: 0,
bloom: 0.0,
aberration: 0.0,
dofOn: false,
dofDist: 5.2,
dofRange: 1.4,
},
audio: { style: 'deep', gain: 1.3, idle: false, idleSet: false, volume: 0.8 },
anim: { dur: 8, loop: true, keys: [], clips: [], markers: [], work: null, speed: 1, lanes: {} },
};
}
export const KEY = 'objglb.fx.v9';
