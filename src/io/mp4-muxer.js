const enc = new TextEncoder();

function box(type, ...parts) {
	const body = concat(parts.flat(Infinity).filter((p) => p != null));
	const out = new Uint8Array(8 + body.length);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, out.length);
	out.set(enc.encode(type), 4);
	out.set(body, 8);
	return out;
}

function fullBox(type, version, flags, ...parts) {
	return box(type, u8(version), u24(flags), ...parts);
}

function concat(parts) {
	let n = 0;
	for (const p of parts) n += p.length;
	const out = new Uint8Array(n);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

const u8 = (v) => new Uint8Array([v & 255]);
const u16 = (v) => new Uint8Array([(v >> 8) & 255, v & 255]);
const u24 = (v) => new Uint8Array([(v >> 16) & 255, (v >> 8) & 255, v & 255]);
function u32(v) {
	const a = new Uint8Array(4);
	new DataView(a.buffer).setUint32(0, v >>> 0);
	return a;
}
function i32(v) {
	const a = new Uint8Array(4);
	new DataView(a.buffer).setInt32(0, v | 0);
	return a;
}
function u64(v) {
	const a = new Uint8Array(8);
	const dv = new DataView(a.buffer);
	dv.setUint32(0, Math.floor(v / 2 ** 32));
	dv.setUint32(4, v >>> 0);
	return a;
}
const zeros = (n) => new Uint8Array(n);
const fixed16 = (v) => u32(Math.round(v * 65536));
const MATRIX = [fixed16(1), u32(0), u32(0), u32(0), fixed16(1), u32(0), u32(0), u32(0), u32(0x40000000)];

function descLen(n) {
	return new Uint8Array([0x80 | ((n >> 21) & 0x7f), 0x80 | ((n >> 14) & 0x7f), 0x80 | ((n >> 7) & 0x7f), n & 0x7f]);
}
function desc(tag, body) {
	return concat([u8(tag), descLen(body.length), body]);
}

export class Mp4Muxer {
	constructor({ video, audio = null }) {
		this.video = { ...video, samples: [], desc: null, scale: 90000 };
		this.audio = audio ? { ...audio, samples: [], desc: null, scale: audio.sampleRate } : null;
		this.chunks = [];
		this.size = 0;
	}

	addVideo(chunk, meta) {
		if (meta?.decoderConfig?.description && !this.video.desc) this.video.desc = toBytes(meta.decoderConfig.description);
		this._add(this.video, chunk);
	}

	addAudio(chunk, meta) {
		if (!this.audio) return;
		if (meta?.decoderConfig?.description && !this.audio.desc) this.audio.desc = toBytes(meta.decoderConfig.description);
		this._add(this.audio, chunk);
	}

	_add(track, chunk) {
		const data = new Uint8Array(chunk.byteLength);
		chunk.copyTo(data);
		track.samples.push({ data, ts: chunk.timestamp, dur: chunk.duration || 0, key: chunk.type === 'key', off: 0 });
		this.chunks.push(data);
	}

	get hasAudio() {
		return !!(this.audio && this.audio.samples.length && this.audio.desc);
	}

	finish() {
		const v = this.video;
		if (!v.samples.length) throw new Error('кадров нет');
		if (!v.desc) throw new Error('кодер не отдал описание видео (avcC/hvcC)');
		const tracks = [v];
		if (this.hasAudio) tracks.push(this.audio);
		const base = Math.min(...v.samples.map((s) => s.ts));
		for (const t of tracks) {
			for (const s of t.samples) s.ts -= base;
			if (t !== v) t.samples = t.samples.filter((s) => s.ts >= 0);
		}
		if (tracks.length > 1 && !tracks[1].samples.length) tracks.pop();
		const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode(v.codec === 'hevc' ? 'isomiso2hvc1mp41' : 'isomiso2avc1mp41'));
		let mdatSize = 0;
		for (const t of tracks) for (const s of t.samples) mdatSize += s.data.length;
		const big = mdatSize + 16 > 0xffffffff;
		const mdatHead = big ? concat([u32(1), enc.encode('mdat'), u64(mdatSize + 16)]) : concat([u32(mdatSize + 8), enc.encode('mdat')]);
		let off = ftyp.length + mdatHead.length;
		const order = [];
		for (const t of tracks) for (const s of t.samples) order.push(s);
		for (const s of order) {
			s.off = off;
			off += s.data.length;
		}
		const moov = this._moov(tracks, off > 0xffffffff);
		return new Blob([ftyp, mdatHead, ...order.map((s) => s.data), moov], { type: 'video/mp4' });
	}

	_moov(tracks, co64) {
		const movieScale = 1000;
		let movieDur = 0;
		const traks = tracks.map((t, i) => {
			const r = this._trak(t, i + 1, movieScale, co64);
			movieDur = Math.max(movieDur, r.movieDur);
			return r.box;
		});
		const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(movieScale), u32(movieDur), fixed16(1), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1));
		return box('moov', mvhd, traks);
	}

	_trak(t, id, movieScale, co64) {
		const isV = t === this.video;
		const S = t.samples;
		const scale = t.scale;
		const toT = (us) => Math.round((us * scale) / 1e6);
		const pts = S.map((s) => toT(s.ts));
		const p0 = Math.min(...pts);
		for (let i = 0; i < pts.length; i++) pts[i] -= p0;
		const delay = Math.round((p0 / scale) * movieScale);
		const sorted = [...pts].sort((a, b) => a - b);
		let shift = 0;
		for (let i = 0; i < S.length; i++) shift = Math.max(shift, sorted[i] - pts[i]);
		const dts = sorted.map((x) => x - shift);
		const durs = dts.map((d, i) => (i + 1 < dts.length ? dts[i + 1] - d : 0));
		const lastDur = S.length > 1 ? durs[S.length - 2] || toT(S[S.length - 1].dur) || 1 : toT(S[0].dur) || Math.round(scale / 30);
		durs[S.length - 1] = Math.max(1, toT(S[S.length - 1].dur) || lastDur);
		for (let i = 0; i < durs.length; i++) if (durs[i] <= 0) durs[i] = 1;
		const mediaDur = dts[dts.length - 1] + durs[durs.length - 1] - (dts[0] || 0);
		const playDur = Math.round((mediaDur / scale) * movieScale);
		const movieDur = playDur + delay;

		const stts = [];
		for (const d of durs) {
			const last = stts[stts.length - 1];
			if (last && last[1] === d) last[0]++;
			else stts.push([1, d]);
		}
		const ctts = [];
		let needCtts = false;
		for (let i = 0; i < S.length; i++) {
			const o = pts[i] - dts[i];
			if (o !== 0) needCtts = true;
			const last = ctts[ctts.length - 1];
			if (last && last[1] === o) last[0]++;
			else ctts.push([1, o]);
		}
		const stblParts = [
			fullBox('stsd', 0, 0, u32(1), isV ? this._avc1(t) : this._mp4a(t)),
			fullBox('stts', 0, 0, u32(stts.length), stts.map(([n, d]) => [u32(n), u32(d)])),
		];
		if (needCtts) stblParts.push(fullBox('ctts', 1, 0, u32(ctts.length), ctts.map(([n, o]) => [u32(n), i32(o)])));
		if (isV) {
			const keys = [];
			S.forEach((s, i) => s.key && keys.push(i + 1));
			if (keys.length < S.length) stblParts.push(fullBox('stss', 0, 0, u32(keys.length), keys.map((k) => u32(k))));
		}
		stblParts.push(
			fullBox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
			fullBox('stsz', 0, 0, u32(0), u32(S.length), S.map((s) => u32(s.data.length))),
			co64 ? fullBox('co64', 0, 0, u32(S.length), S.map((s) => u64(s.off))) : fullBox('stco', 0, 0, u32(S.length), S.map((s) => u32(s.off)))
		);
		const stbl = box('stbl', stblParts);
		const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
		const minf = box('minf', isV ? fullBox('vmhd', 0, 1, zeros(8)) : fullBox('smhd', 0, 0, zeros(4)), dinf, stbl);
		const hdlr = fullBox('hdlr', 0, 0, u32(0), enc.encode(isV ? 'vide' : 'soun'), zeros(12), enc.encode(isV ? 'VideoHandler\0' : 'SoundHandler\0'));
		const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(mediaDur), u16(0x55c4), u16(0));
		const mdia = box('mdia', mdhd, hdlr, minf);
		const tkhd = fullBox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(isV ? 0 : 0x0100), u16(0), MATRIX, fixed16(isV ? t.width : 0), fixed16(isV ? t.height : 0));
		const edits = [];
		if (delay > 0) edits.push([u32(delay), i32(-1), u16(1), u16(0)]);
		if (shift > 0 || delay > 0) edits.push([u32(playDur), u32(shift), u16(1), u16(0)]);
		const edts = edits.length ? box('edts', fullBox('elst', 0, 0, u32(edits.length), edits)) : null;
		return { box: box('trak', tkhd, edts, mdia), movieDur };
	}

	_avc1(t) {
		const name = zeros(32);
		const hevc = t.codec === 'hevc';
		return box(hevc ? 'hvc1' : 'avc1', zeros(6), u16(1), zeros(16), u16(t.width), u16(t.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), name, u16(0x18), u16(0xffff), box(hevc ? 'hvcC' : 'avcC', t.desc));
	}

	_mp4a(t) {
		const asc = t.desc;
		const dsi = desc(0x05, asc);
		const dcd = desc(0x04, concat([u8(0x40), u8(0x15), u24(0), u32(0), u32(0), dsi]));
		const sl = desc(0x06, u8(0x02));
		const es = desc(0x03, concat([u16(0), u8(0), dcd, sl]));
		return box('mp4a', zeros(6), u16(1), zeros(8), u16(t.channels), u16(16), u16(0), u16(0), u32(t.sampleRate * 65536), fullBox('esds', 0, 0, es));
	}
}

function toBytes(d) {
	if (d instanceof Uint8Array) return d.slice();
	if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
	return new Uint8Array(d.slice(0));
}
