function buildPalette(samples) {
	const px = [];
	for (let i = 0; i < samples.length; i += 4) px.push((samples[i] << 16) | (samples[i + 1] << 8) | samples[i + 2]);
	let boxes = [px];
	const chan = (v, c) => (v >> (16 - c * 8)) & 255;
	while (boxes.length < 256) {
		let bi = -1;
		let bestRange = 0;
		let bestC = 0;
		boxes.forEach((b, i) => {
			if (b.length < 2) return;
			for (let c = 0; c < 3; c++) {
				let mn = 255;
				let mx = 0;
				for (const v of b) {
					const x = chan(v, c);
					if (x < mn) mn = x;
					if (x > mx) mx = x;
				}
				if (mx - mn > bestRange) {
					bestRange = mx - mn;
					bi = i;
					bestC = c;
				}
			}
		});
		if (bi < 0 || bestRange < 1) break;
		const b = boxes[bi].sort((p, q) => chan(p, bestC) - chan(q, bestC));
		const mid = b.length >> 1;
		boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
	}
	const pal = new Uint8Array(256 * 3);
	boxes.forEach((b, i) => {
		let r = 0, g = 0, bl = 0;
		for (const v of b) {
			r += (v >> 16) & 255;
			g += (v >> 8) & 255;
			bl += v & 255;
		}
		const n = b.length || 1;
		pal[i * 3] = r / n;
		pal[i * 3 + 1] = g / n;
		pal[i * 3 + 2] = bl / n;
	});
	return { pal, size: boxes.length };
}

function lzw(indices) {
	const minCode = 8;
	const clear = 1 << minCode;
	const eoi = clear + 1;
	let size = minCode + 1;
	let next = eoi + 1;
	const dict = new Map();
	const out = [];
	let cur = 0;
	let bits = 0;
	const emit = (code) => {
		cur |= code << bits;
		bits += size;
		while (bits >= 8) {
			out.push(cur & 255);
			cur >>>= 8;
			bits -= 8;
		}
	};
	emit(clear);
	let prefix = indices[0];
	for (let i = 1; i < indices.length; i++) {
		const k = indices[i];
		const key = (prefix << 8) | k;
		const found = dict.get(key);
		if (found !== undefined) {
			prefix = found;
			continue;
		}
		emit(prefix);
		if (next > (1 << size) - 1 && size < 12) size++;
		if (next < 4096) dict.set(key, next++);
		else {
			emit(clear);
			dict.clear();
			next = eoi + 1;
			size = minCode + 1;
		}
		prefix = k;
	}
	emit(prefix);
	emit(eoi);
	if (bits > 0) out.push(cur & 255);
	return out;
}

export async function encodeGIF(frames, w, h, delay, onProgress) {
	const step = Math.max(1, Math.floor(frames.length / 8));
	const sample = [];
	for (let f = 0; f < frames.length; f += step) {
		const d = frames[f].data;
		for (let i = 0; i < d.length; i += 4 * 37) sample.push(d[i], d[i + 1], d[i + 2], 255);
	}
	const { pal, size } = buildPalette(Uint8Array.from(sample));
	const cache = new Map();
	const nearest = (r, g, b) => {
		const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
		let v = cache.get(key);
		if (v !== undefined) return v;
		let best = 0;
		let bd = 1e9;
		for (let i = 0; i < size; i++) {
			const dr = pal[i * 3] - r, dg = pal[i * 3 + 1] - g, db = pal[i * 3 + 2] - b;
			const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
			if (d < bd) {
				bd = d;
				best = i;
			}
		}
		cache.set(key, best);
		return best;
	};
	const bytes = [];
	const w16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
	for (const c of 'GIF89a') bytes.push(c.charCodeAt(0));
	w16(w);
	w16(h);
	bytes.push(0xf7, 0, 0);
	for (let i = 0; i < 768; i++) bytes.push(pal[i]);
	bytes.push(0x21, 0xff, 0x0b);
	for (const c of 'NETSCAPE2.0') bytes.push(c.charCodeAt(0));
	bytes.push(3, 1, 0, 0, 0);
	for (let f = 0; f < frames.length; f++) {
		const d = frames[f].data;
		const idx = new Uint8Array(w * h);
		for (let i = 0, p = 0; p < idx.length; i += 4, p++) idx[p] = nearest(d[i], d[i + 1], d[i + 2]);
		bytes.push(0x21, 0xf9, 4, 0x04);
		w16(delay);
		bytes.push(0, 0);
		bytes.push(0x2c);
		w16(0);
		w16(0);
		w16(w);
		w16(h);
		bytes.push(0, 8);
		const data = lzw(idx);
		for (let i = 0; i < data.length; i += 255) {
			const n = Math.min(255, data.length - i);
			bytes.push(n);
			for (let k = 0; k < n; k++) bytes.push(data[i + k]);
		}
		bytes.push(0);
		onProgress && onProgress((f + 1) / frames.length);
		await new Promise((r) => setTimeout(r));
	}
	bytes.push(0x3b);
	return new Blob([Uint8Array.from(bytes)], { type: 'image/gif' });
}
