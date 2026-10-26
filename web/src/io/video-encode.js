import { Mp4Muxer } from './mp4-muxer.js';
const AVC = ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.640028', 'avc1.4d0034', 'avc1.4d0028', 'avc1.42e034', 'avc1.42e01f'];
const HEVC = ['hvc1.1.6.L183.B0', 'hvc1.1.6.L153.B0', 'hvc1.1.6.L123.B0'];
const QP = { avc: 16, hevc: 18 };
export async function pickVideoConfig({ width, height, fps, bitrate, codec = 'h264', lossless = false }) {
if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
const fams = codec === 'h265' ? ['hevc', 'avc'] : ['avc'];
for (const fam of fams) {
for (const mode of lossless ? ['quantizer', 'variable'] : ['variable']) {
for (const c of fam === 'hevc' ? HEVC : AVC) {
const cfg = { codec: c, width, height, framerate: fps, latencyMode: 'quality', bitrateMode: mode, [fam]: { format: fam } };
if (mode !== 'quantizer') cfg.bitrate = bitrate;
try {
const r = await VideoEncoder.isConfigSupported(cfg);
if (r && r.supported) return { config: r.config || cfg, fam, quant: mode === 'quantizer' ? QP[fam] : 0 };
} catch (e) {
}
}
}
}
return null;
}
export async function pickAudioConfig(sampleRate) {
if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
const cfg = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 192000 };
try {
const r = await AudioEncoder.isConfigSupported(cfg);
return r && r.supported ? r.config || cfg : null;
} catch (e) {
return null;
}
}
const TAP_SRC = `class PbTap extends AudioWorkletProcessor {
	constructor() { super(); this.l = []; this.r = []; this.n = 0; this.z = new Float32Array(128); }
	process(inputs) {
		const i = inputs[0];
		const L = i && i[0] ? i[0] : this.z;
		const R = i && i[1] ? i[1] : L;
		this.l.push(L.slice()); this.r.push(R.slice()); this.n += L.length;
		if (this.n >= 2048) {
			const n = this.n, l = new Float32Array(n), r = new Float32Array(n);
			let o = 0;
			for (let k = 0; k < this.l.length; k++) { l.set(this.l[k], o); r.set(this.r[k], o); o += this.l[k].length; }
			this.port.postMessage({ l, r, t: currentTime - n / sampleRate }, [l.buffer, r.buffer]);
			this.l = []; this.r = []; this.n = 0;
		}
		return true;
	}
}
registerProcessor('pb-tap', PbTap);`;
async function tapAudio(ctx, node, onData) {
const mute = ctx.createGain();
mute.gain.value = 0;
mute.connect(ctx.destination);
if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
const url = URL.createObjectURL(new Blob([TAP_SRC], { type: 'text/javascript' }));
try {
await ctx.audioWorklet.addModule(url);
const w = new AudioWorkletNode(ctx, 'pb-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
w.port.onmessage = (e) => onData(e.data.l, e.data.r, e.data.t);
node.connect(w);
w.connect(mute);
return () => {
try {
node.disconnect(w);
} catch (e) {
}
w.port.onmessage = null;
w.disconnect();
mute.disconnect();
};
} catch (e) {
} finally {
URL.revokeObjectURL(url);
}
}
const sp = ctx.createScriptProcessor(2048, 2, 2);
sp.onaudioprocess = (e) => {
const ib = e.inputBuffer;
const l = new Float32Array(ib.getChannelData(0));
const r = new Float32Array(ib.numberOfChannels > 1 ? ib.getChannelData(1) : l);
onData(l, r, e.playbackTime - ib.duration);
};
node.connect(sp);
sp.connect(mute);
return () => {
try {
node.disconnect(sp);
} catch (e) {
}
sp.onaudioprocess = null;
sp.disconnect();
mute.disconnect();
};
}
export class WebCodecsRecorder {
static async create({ width, height, fps, bitrate, codec = 'h264', lossless = false, audio = null, perf0 = performance.now() }) {
const pick = await pickVideoConfig({ width, height, fps, bitrate, codec, lossless });
if (!pick) return null;
const vcfg = pick.config;
let acfg = null;
if (audio) {
acfg = await pickAudioConfig(audio.ctx.sampleRate);
if (!acfg && audio.required) return null;
}
const r = new WebCodecsRecorder();
r.fam = pick.fam;
r.quant = pick.quant;
await r._init(vcfg, acfg, audio, fps, perf0);
return r;
}
async _init(vcfg, acfg, audio, fps, perf0) {
this.fps = fps;
this.perf0 = perf0;
this.error = null;
this.frames = 0;
this.dropped = 0;
this.lastKey = -Infinity;
this.mux = new Mp4Muxer({ video: { width: vcfg.width, height: vcfg.height, codec: this.fam || 'avc' }, audio: acfg ? { sampleRate: acfg.sampleRate, channels: 2 } : null });
this.venc = new VideoEncoder({ output: (c, m) => this.mux.addVideo(c, m), error: (e) => (this.error ||= e) });
this.venc.configure(vcfg);
this.codec = vcfg.codec;
if (acfg && audio) {
this.aenc = new AudioEncoder({ output: (c, m) => this.mux.addAudio(c, m), error: () => (this.aenc = null) });
this.aenc.configure(acfg);
const ctx = audio.ctx;
const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
const ctx0 = ts && ts.contextTime ? ts.contextTime : ctx.currentTime;
const pf0 = ts && ts.performanceTime ? ts.performanceTime : performance.now();
const sr = ctx.sampleRate;
this.untap = await tapAudio(ctx, audio.node, (l, r, t) => {
if (!this.aenc || this.closed) return;
const us = Math.round(((t - ctx0) * 1000 + pf0 - this.perf0) * 1000);
if (us < 0) return;
const data = new Float32Array(l.length * 2);
data.set(l, 0);
data.set(r, l.length);
try {
const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: l.length, numberOfChannels: 2, timestamp: us, data });
this.aenc.encode(ad);
ad.close();
} catch (e) {
this.aenc = null;
}
});
}
}
addFrame(canvas, t) {
if (this.closed || this.error) return false;
if (this.venc.encodeQueueSize > 6) {
this.dropped++;
return false;
}
const key = t - this.lastKey >= 2e6;
const f = new VideoFrame(canvas, { timestamp: t, duration: Math.round(1e6 / this.fps) });
try {
this.venc.encode(f, this.quant ? { keyFrame: key, [this.fam]: { quantizer: this.quant } } : { keyFrame: key });
} finally {
f.close();
}
if (key) this.lastKey = t;
this.frames++;
return true;
}
async drain(max = 2) {
while (!this.closed && !this.error && this.venc.encodeQueueSize > max) await new Promise((r) => setTimeout(r, 4));
}
async finish() {
this.closed = true;
this.untap?.();
if (this.error) throw this.error;
await this.venc.flush();
if (this.aenc) {
try {
await this.aenc.flush();
} catch (e) {
}
}
this.venc.close();
try {
this.aenc?.close();
} catch (e) {
}
if (this.error) throw this.error;
return this.mux.finish();
}
cancel() {
this.closed = true;
this.untap?.();
try {
this.venc.close();
this.aenc?.close();
} catch (e) {
}
}
}
