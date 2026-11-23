const PERIOD = 0.09;

export class MaterialVideo {
	constructor() {
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
		this.version = 0;
	}

	read(el, now) {
		if (!el || !this.ctx) return null;
		const sw = el.videoWidth || el.naturalWidth || el.width;
		const sh = el.videoHeight || el.naturalHeight || el.height;
		if (!sw || !sh || (el.tagName === 'VIDEO' && el.readyState < 2)) return null;
		const time = el.currentTime || 0;
		if (this.el === el && (Math.abs(time - this.time) < 1e-4 || now - this.now < PERIOD)) return null;
		if (this.el !== el) {
			this.feedId = Symbol();
			const scale = 96 / Math.max(sw, sh);
			this.w = this.canvas.width = Math.max(8, Math.round(sw * scale));
			this.h = this.canvas.height = Math.max(8, Math.round(sh * scale));
			this.aspect = sw / sh;
		}
		const { w, h } = this;
		let rgba;
		try {
			this.ctx.drawImage(el, 0, 0, w, h);
			rgba = this.ctx.getImageData(0, 0, w, h).data;
		} catch {
			return null;
		}
		this.el = el;
		this.time = time;
		this.now = now;
		this.rgba = rgba;
		this.version++;
		return this;
	}

	pixel(u, v) {
		return Math.min(this.h - 1, Math.max(0, Math.floor(v * this.h))) * this.w
			+ Math.min(this.w - 1, Math.max(0, Math.floor(u * this.w)));
	}
}
