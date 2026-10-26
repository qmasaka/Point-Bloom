import * as THREE from 'three';
import { perf } from '../../core/perf.js';
import { loadJSON, mergeDeep, saveJSON } from '../../core/util.js';
import { DepthAI } from '../input/depth-ai.js';
import { createBackend, pickBackendKind } from '../render/select.js';
import { defaultState, KEY } from '../state/defaults.js';
import { FX_LAYERS } from '../state/layers.js';
import { AUDIO_DEF } from '../state/options.js';
import { TrackerHud } from '../ui/fx-hud.js';
import { FramesPart } from './frames.js';
import { KeyframesPart } from './keyframes.js';
import { SourcePart } from './source.js';
import { BuildPart } from '../render/webgl/scene-build.js';
import { LinksPart } from './links.js';
import { ToolsPart } from './tools.js';
import { TrackingPart } from './tracking.js';
import { HistoryPart } from './history.js';
import { ScopeTrailPart } from './scope-trail.js';
import { ShaderCachePart } from '../render/webgl/shader-cache.js';
import { DepthPart } from './depth.js';
import { AudioPart } from './audio.js';
import { InteractionPart } from './interaction.js';
import { LoopPart } from './loop.js';
import { RecordingPart } from './recording.js';
import { ScreenPart } from './screen.js';
import { SlitPart } from './slitscan.js';
import { ChladniPart } from './chladni.js';
import { ShootsPart } from './shoots.js';
import { ShadowPart } from './shadow.js';
import { ChronoPart } from './chrono.js';
import { PixelSortPart } from './pixelsort.js';
import { TrackPickPart } from './track-pick.js';
import { mixin } from './mixin.js';
export class EffectsEngine {
constructor(app) {
this.app = app;
this.active = false;
this.state = mergeDeep(defaultState(), loadJSON(KEY, {}));
if (!this.state.audio.idleSet) this.state.audio.idle = false;
this.state.mask = { ...defaultState().mask };
for (const l of FX_LAYERS) this.state.layers[l.id] = { ...AUDIO_DEF, ...l.def, ...this.state.layers[l.id] };
{
const fl = this.state.layers.flow;
const cl = this.state.layers.curl;
if (fl && cl && fl.on && !cl.on && !this.state._m6) {
Object.assign(cl, { on: true, mode: 'surface', amount: fl.amount, fscale: fl.scale, fdir: fl.dir, speed: fl.speed, band: fl.band, react: fl.react });
fl.on = false;
}
this.state._m6 = true;
}
this.state.look = { ...defaultState().look, ...this.state.look };
if (this.state.layers.brush && this.state.layers.brush.radius > 0.3 && !this.state._m5) {
this.state.layers.brush.radius = 0.14;
this.state.layers.brush.dry = 3;
}
this.state._m5 = 1;
if (!this.state._m7 && this.state.layers.frames) {
Object.assign(this.state.layers.frames, { edge: 0, curEdge: 0, thin: 0 });
if (this.state.layers.chrono) Object.assign(this.state.layers.chrono, { count: 14, every: 0.12, fade: 0.4, bgKeep: 0, thin: 0.15, tint: 0.15, drift: 1.1, depthZ: 0.04, dkeep: 0.5, size: 1.4, budget: 480000 });
this.state._m7 = 1;
}
if (!this.state._m4) {
if (this.state.layers.slice) this.state.layers.slice.color = 'model';
this.state._m4 = 1;
}
if (this.state.look.colorBy === 'height' || this.state.look.colorBy === 'index') this.state.look.colorBy = 'disp';
if (this.state.look.palette === 'brand') this.state.look.palette = 'cyber';
const Ch = this.state.layers.chrono;
if (Ch && Ch.mask === 'any') Ch.mask = 'person';
const Dp = this.state.layers.depth;
if (Dp && !this.state._m8) {
if (['wave', 'ripple', 'twist', 'burst'].includes(Dp.mode)) Dp.mode = 'relief';
if (Dp.sway === 0.35) Dp.sway = 0;
this.state._m8 = 1;
}
this.ctx = null;
this.analyser = null;
this.bus = null;
this.out = null;
this.recDest = null;
this.freqData = null;
this.synth = null;
this.source = null;
this.micStream = null;
this.audioBuffer = null;
this.playing = false;
this.sourceType = 'synth';
this.audioName = '';
this.levels = { bass: 0, mid: 0, high: 0, beat: 0 };
this.spec = new Float32Array(64);
this._beatHist = new Float32Array(48);
this._beatIdx = 0;
this._lastBeat = 0;
this.points = null;
this.geometry = null;
this.material = null;
this.specTex = null;
this.cache = new Map();
this.cloudKey = null;
this.morph = 1;
this.morphing = false;
this.mouse = new THREE.Vector3();
this.mouseOn = false;
this._time = 0;
this._raf = null;
this._lastT = 0;
this.recording = false;
this.modelProvider = null;
this.depthAI = new DepthAI();
this._dListeners = new Set();
this.depthAI.onChange = () => this._depthEmit();
this._D = { key: null, map: null, mapSrc: '', aiHas: false, st: {}, tgt: null, geo: null, dirty: false, snap: false, moving: false, busy: false, rgb: null, rgbN: 0, lumaN: -1, reqT: -1e9, force: false, err: '', n: 0 };
app.bus.on('settings', () => this._histSoon());
app.bus.on('scene', () => {
clearTimeout(this._warmT);
if (!this.active) this.cache.clear();
this._warmT = setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(f, 60)))(() => this.prewarm()), 1200);
});
const stale = () => {
if (this.active) return;
this.cache.clear();
clearTimeout(this._warmT);
this._warmT = setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(f, 60)))(() => this.prewarm()), 900);
};
app.bus.on('material', stale);
app.bus.on('geometry', stale);
app.bus.on('pointtex', stale);
app.bus.on('pointtex', () => {
if (this.active) {
this.cache.clear();
this._onScene();
}
});
this.mediaProgress = null;
this.ghosts = [];
this.linkObj = null;
this.shocks = [];
this.onFrame = null;
this._ray = new THREE.Raycaster();
this._plane = new THREE.Plane();
this._move = (e) => this._onMove(e);
this._leave = () => (this.mouseOn = false);
this._dn = (e) => this._onDown(e);
this._up = (e) => this._onUp(e);
this.isCollapsed = false;
this.collapseProgress = 0;
this.asm = 0;
this.collapseTime = 0;
this.animT = 0;
this.animPlaying = false;
this.animRec = false;
this.brushHits = [];
this.backend = null;
this.camTracker = null;
this._pointerDown = false;
}
toggleCollapse() {
this.setCollapse(!this.isCollapsed);
}
setCollapse(v) {
if (this.isCollapsed === v) return;
this.isCollapsed = v;
if (v) this.state.layers.physics.on = true;
this.emit();
}
setColorBy(v) {
const pt = this.app.settings.point;
this._userColor = true;
this.state.look.colorBy = v;
const m = { model: 'texture', solid: 'solid', normal: 'normal' }[v];
if (m) pt.color = m;
this.app.saveSettings();
this.touch();
this.emit();
}
syncLookFromPoints() {
const m = { texture: 'model', solid: 'solid', normal: 'normal' }[this.app.settings.point.color];
const cur = this.state.look.colorBy;
if (m && ((this.state.source === 'model' && !this._userColor) || (cur !== 'disp' && cur !== 'index'))) this.state.look.colorBy = m;
}
touch() {
this._histSoon();
clearTimeout(this._saveT);
this._saveT = setTimeout(() => saveJSON(KEY, this.state), 250);
}
emit() {
this.app.bus.emit('fx');
}
get pm() {
return this.app.media.pm;
}
_n() {
const mc = this.app.media;
const inList = (this.playlist || []).map((k) => mc.entry(k)).find((e) => e && e.pm.ready);
if (this.state.source === 'media' || inList) {
const pm = this.state.source === 'media' && this.pm.ready ? this.pm : inList?.pm;
if (pm && pm.ready) {
mc.applyGrid(pm);
return pm.count;
}
}
const mp = this.modelProvider;
if (mp && mp.kind() === 'cloud') return Math.max(1000, Math.min(this.state.count, mp.total()));
return this.state.count;
}
async enter() {
if (this.active) return;
const app = this.app;
this.active = true;
this.state.look.autoRotate = false;
this.state.layers.frames.on = false;
if (this.state.layers.chrono) this.state.layers.chrono.on = false;
this._fxCur = new Set();
this._fxSeen = new Map();
this._fxBusy = false;
this._warm = new Map();
this._tgtWarm = {};
this._tgtRT = this._postOn();
this._framesOn = false;
const maxFxCount = perf.isApple ? 2000000 : perf.windows ? (perf.tier === 'high' ? 450000 : perf.tier === 'mid' ? 160000 : 100000) : perf.tier === 'high' ? 1000000 : 250000;
this.state.count = Math.max(20000, Math.min(maxFxCount, app.settings.point.surfaceCount));
const vp = app.viewport;
this._saved = { rootVisible: vp.root.visible, ortho: app.nav.ortho };
app.model.select(null);
vp.root.visible = false;
vp.fxHide = true;
if (app.nav.ortho) app.nav.setOrtho(false);
document.getElementById('app').classList.add('fx-mode');
this.state.source = this.pm.ready ? 'media' : this.hasModel ? 'model' : this.state.source === 'model' ? 'sphere' : this.state.source;
try {
await this._build();
} catch (e) {
console.error(e);
app.ui.idle();
this.active = false;
vp.root.visible = this._saved.rootVisible;
vp.fxHide = false;
document.getElementById('app').classList.remove('fx-mode', 'fx-focus');
throw e;
}
this.backend = await createBackend(pickBackendKind(app.settings.render.backend), this);
this.backend.create();
const buildPts = this.points;
if (buildPts) buildPts.visible = false;
try {
const kinds = [this._vertKind()];
if (this.linkObj && this.state.layers.links.on) kinds.push('line');
await this.backend.prepare(kinds);
} catch (e) {
}
if (buildPts && this.points === buildPts) buildPts.visible = true;
app.ui.idle();
setTimeout(() => this._prefetch(this.playlist), 400);
const stage = document.querySelector('.stage');
stage.addEventListener('pointermove', this._move);
stage.addEventListener('pointerleave', this._leave);
stage.addEventListener('pointerdown', this._dn);
stage.addEventListener('pointerup', this._up);
this._offScene = app.bus.on('scene', () => this._onScene());
this.hud = new TrackerHud(document.getElementById('viewport'));
this.app.viewport.fxGrid = !!this.state.look.grid;
this.applyBg();
this.backend.install();
app.nav.animateTo({ target: new THREE.Vector3(0, 0, 0), distance: 5.2 }, 0);
this.syncLookFromPoints();
if (this.pm.ready) {
this.state.look.colorBy = 'model';
this.pm.play();
if (this.pm.kind === 'video') this.useVideoAudio().catch(() => {});
}
this._hist = { undo: [], redo: [], last: null };
this._histT = setTimeout(() => this._histCommit(), 600);
if (this.pm.playing && this.state.source === 'media') this.pm.play();
this._lastT = performance.now();
this._loop();
this.emit();
}
exit() {
if (!this.active) return;
this.active = false;
this.animPlaying = false;
this.animRec = false;
this.stopRecording();
this.pause();
this._videoToEditor();
cancelAnimationFrame(this._raf);
this._syncPaintLock(true);
clearTimeout(this._sceneT);
this._offScene && this._offScene();
this.hud?.dispose();
this.hud = null;
this.backend?.dispose();
this.backend = null;
if (this.camTracker) {
this._stopCam();
this.camTracker = null;
}
this.app.viewport.applyRenderSettings();
const vp = this.app.viewport;
this._disposePoints();
vp.root.visible = this._saved?.rootVisible !== false;
vp.fxHide = false;
const stage = document.querySelector('.stage');
stage.removeEventListener('pointermove', this._move);
stage.removeEventListener('pointerleave', this._leave);
stage.removeEventListener('pointerdown', this._dn);
stage.removeEventListener('pointerup', this._up);
document.getElementById('app').classList.remove('fx-mode', 'fx-focus');
this.app.display.apply();
this.app.nav.frameAll(false);
vp.invalidate();
this.emit();
}
_eff(l) {
if (!l.on) return 0;
const g = this._fxGate ?? 1;
if (l.band === 'none') return l.amount * g;
const b = this._bandLevel(l);
if (l.amode === 'gate') {
const envs = (this._envs ||= new WeakMap());
let e = envs.get(l);
if (!e) {
e = { v: 0, t: this._time, open: false };
envs.set(l, e);
}
if (e.t !== this._time) {
const dt = Math.min(0.1, Math.max(0, this._time - e.t));
e.t = this._time;
e.open = b > l.thr ? true : b < l.thr * 0.8 ? false : e.open;
const tc = Math.max(0.005, e.open ? l.atk : l.rel);
e.v += ((e.open ? 1 : 0) - e.v) * (1 - Math.exp(-dt / tc));
}
return l.amount * e.v * g;
}
if (!l.react) return l.amount * g;
const lvl = this.soundActive ? b : 0.5;
return l.amount * (1 - l.react + l.react * lvl * 2) * g;
}
setFrozen(v) {
v = !!v;
if (v === !!this.frozen) return;
this.frozen = v;
const ctx = this.ctx;
if (v) {
this._ctxWasRunning = !!ctx && ctx.state === 'running';
if (this._ctxWasRunning) ctx.suspend().catch(() => {});
} else if (this._ctxWasRunning && ctx) {
ctx.resume().catch(() => {});
this._ctxWasRunning = false;
}
this.app.viewport.invalidate();
}
_syncPaintLock(off) {
const B = this.state.layers.brush;
const want = !off && this.active && !!B && B.on && B.lock !== 'off';
const nav = this.app.nav;
if (nav.paintLock === want) return;
nav.paintLock = want;
this.app.viewport.container.classList.toggle('paint-lock', want);
}
}
mixin(EffectsEngine, FramesPart, KeyframesPart, SourcePart, BuildPart, LinksPart, ToolsPart, TrackingPart, HistoryPart, ScopeTrailPart, ShaderCachePart, DepthPart, AudioPart, InteractionPart, LoopPart, RecordingPart, ScreenPart, SlitPart, ChladniPart, ShootsPart, ShadowPart, ChronoPart, PixelSortPart, TrackPickPart);
