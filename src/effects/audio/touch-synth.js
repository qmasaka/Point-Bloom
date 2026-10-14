// Встроенный синтезатор звука для эффектов.

// ───────────────────────────────────────────────────────────── звуковой синтезатор

// ── Встроенный синтезатор музыки ─────────────────────────────────────────────
export class TouchSynth {
	constructor(ctx, dest) {
		this.ctx = ctx;
		this.dest = dest;
		this.timer = null;
		this.playing = false;
		this.mode = 'ambient';
		this.bpm = 66;
		this.gain = null;
		this.step = 0;
		this.next = 0;
		this._noise = null;
	}

	/** Все источники регистрируются, чтобы при смене трека их можно было сразу остановить */
	_reg(node) {
		(this._nodes ||= new Set()).add(node);
		node.addEventListener('ended', () => this._nodes.delete(node));
		return node;
	}
	_osc() {
		return this._reg(this.ctx.createOscillator());
	}
	_src() {
		return this._reg(this.ctx.createBufferSource());
	}

	_noiseBuf() {
		if (!this._noise) {
			const n = this.ctx.sampleRate;
			const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
			const d = b.getChannelData(0);
			for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
			this._noise = b;
		}
		return this._noise;
	}

	start(mode = 'ambient') {
		this.stop();
		const P = SYNTH_PARAMS[mode] || SYNTH_PARAMS.ambient;
		this.mode = SYNTH_PARAMS[mode] ? mode : 'ambient';
		this.bpm = P.bpm;
		const c = this.ctx;
		this.gain = c.createGain();
		this.gain.gain.value = P.master;
		this.gain.connect(this.dest);
		// эхо-«реверб»: точечная восьмая с затухающей обратной связью и срезом верха
		this.send = c.createGain();
		const dl = c.createDelay(2);
		dl.delayTime.value = (60 / this.bpm) * 0.75;
		const fb = c.createGain();
		fb.gain.value = P.fb;
		const lp = c.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = 2200;
		const wet = c.createGain();
		wet.gain.value = P.wet;
		this.send.connect(dl);
		dl.connect(lp);
		lp.connect(fb);
		fb.connect(dl);
		lp.connect(wet);
		wet.connect(this.gain);
		// барабаны идут через общую шину, в брейккоре с перегрузом
		this.drums = c.createGain();
		if (P.drive) {
			const ws = c.createWaveShaper();
			const curve = new Float32Array(1024);
			for (let i = 0; i < 1024; i++) {
				const x = i / 512 - 1;
				curve[i] = Math.tanh(x * P.drive);
			}
			ws.curve = curve;
			this.drums.connect(ws);
			ws.connect(this.gain);
		} else this.drums.connect(this.gain);
		this.playing = true;
		this.step = 0;
		this.next = c.currentTime + 0.06;
		this.timer = setInterval(() => this._pump(), 25);
	}

	stop() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		const c = this.ctx;
		const g = this.gain;
		const now = c.currentTime;
		if (g) {
			try {
				g.gain.cancelScheduledValues(now);
				g.gain.setValueAtTime(g.gain.value, now);
				g.gain.linearRampToValueAtTime(0, now + 0.1);
			} catch (_) {}
			setTimeout(() => {
				try {
					g.disconnect();
				} catch (_) {}
			}, 300);
			this.gain = null;
		}
		// все ещё звучащие голоса прежнего трека останавливаем, чтобы они не накладывались на новый
		for (const n of this._nodes || []) {
			try {
				n.stop(now + 0.12);
			} catch (_) {}
		}
		this._nodes = new Set();
		this.playing = false;
	}

	_pump() {
		if (!this.playing || this.ctx.state === 'suspended') return;
		const spb = 60 / this.bpm / 4;
		let guard = 0;
		while (this.next < this.ctx.currentTime + 0.15 && guard++ < 8) {
			this._sched(this.step, this.next, spb);
			this.next += spb;
			this.step++;
		}
		if (this.next < this.ctx.currentTime - 0.5) this.next = this.ctx.currentTime + 0.05;
	}

	// ---- голоса
	_kick(t, vol = 1, f0 = 150, f1 = 42, len = 0.2) {
		const c = this.ctx;
		const o = this._osc();
		const g = c.createGain();
		o.type = 'sine';
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(f1, t + 0.09);
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + len);
		o.connect(g);
		g.connect(this.drums);
		o.start(t);
		o.stop(t + len + 0.02);
	}
	_snare(t, vol = 0.8, tone = 190, len = 0.15) {
		const c = this.ctx;
		const n = this._src();
		n.buffer = this._noiseBuf();
		const hp = c.createBiquadFilter();
		hp.type = 'highpass';
		hp.frequency.value = 1400;
		const g = c.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + len);
		n.connect(hp);
		hp.connect(g);
		g.connect(this.drums);
		n.start(t, Math.random() * 0.5);
		n.stop(t + len + 0.02);
		const o = this._osc();
		const og = c.createGain();
		o.type = 'triangle';
		o.frequency.setValueAtTime(tone, t);
		o.frequency.exponentialRampToValueAtTime(tone * 0.6, t + 0.08);
		og.gain.setValueAtTime(vol * 0.5, t);
		og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
		o.connect(og);
		og.connect(this.drums);
		o.start(t);
		o.stop(t + 0.12);
	}
	_hat(t, vol = 0.2, len = 0.04) {
		const c = this.ctx;
		const n = this._src();
		n.buffer = this._noiseBuf();
		const hp = c.createBiquadFilter();
		hp.type = 'highpass';
		hp.frequency.value = 7000;
		const g = c.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + len);
		n.connect(hp);
		hp.connect(g);
		g.connect(this.drums);
		n.start(t, Math.random() * 0.5);
		n.stop(t + len + 0.01);
	}
	_sub(t, f, len, vol) {
		const c = this.ctx;
		const o = this._osc();
		const g = c.createGain();
		o.type = 'sine';
		o.frequency.value = f;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
		g.gain.exponentialRampToValueAtTime(0.0001, t + len);
		o.connect(g);
		g.connect(this.gain);
		o.start(t);
		o.stop(t + len + 0.05);
	}
	_reese(t, f, len, vol) {
		const c = this.ctx;
		const g = c.createGain();
		const lp = c.createBiquadFilter();
		lp.type = 'lowpass';
		lp.Q.value = 4;
		lp.frequency.setValueAtTime(420, t);
		lp.frequency.exponentialRampToValueAtTime(110, t + len);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
		g.gain.exponentialRampToValueAtTime(0.0001, t + len);
		lp.connect(g);
		g.connect(this.gain);
		for (const det of [-7, 7]) {
			const o = this._osc();
			o.type = 'sawtooth';
			o.frequency.value = f;
			o.detune.value = det;
			o.connect(lp);
			o.start(t);
			o.stop(t + len + 0.05);
		}
	}
	_pad(t, freqs, len, vol) {
		const c = this.ctx;
		for (const f of freqs) {
			const g = c.createGain();
			const lp = c.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.setValueAtTime(500, t);
			lp.frequency.linearRampToValueAtTime(1500, t + len * 0.5);
			lp.frequency.linearRampToValueAtTime(600, t + len);
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(vol, t + len * 0.35);
			g.gain.exponentialRampToValueAtTime(0.0001, t + len);
			lp.connect(g);
			g.connect(this.gain);
			g.connect(this.send);
			for (const [type, det] of [['sine', 0], ['triangle', 5], ['sine', -5]]) {
				const o = this._osc();
				o.type = type;
				o.frequency.value = f;
				o.detune.value = det;
				o.connect(lp);
				o.start(t);
				o.stop(t + len + 0.05);
			}
		}
	}
	_bell(t, f, vol) {
		const c = this.ctx;
		const g = c.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
		g.connect(this.gain);
		g.connect(this.send);
		for (const [mul, a] of [[1, 1], [2.01, 0.3], [3.98, 0.12]]) {
			const o = this._osc();
			const og = c.createGain();
			o.type = 'sine';
			o.frequency.value = f * mul;
			og.gain.value = a;
			o.connect(og);
			og.connect(g);
			o.start(t);
			o.stop(t + 2.7);
		}
	}
	/** Мягкая щипковая нота (как арфа в зале): короткая атака, длинный затухающий хвост с эхом */
	_pluck(t, f, vol) {
		const c = this.ctx;
		const g = c.createGain();
		const lp = c.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.setValueAtTime(3200, t);
		lp.frequency.exponentialRampToValueAtTime(700, t + 1.4);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
		lp.connect(g);
		g.connect(this.gain);
		g.connect(this.send);
		for (const [type, mul, a] of [['triangle', 1, 1], ['sine', 2, 0.35], ['sine', 3.01, 0.12]]) {
			const o = this._osc();
			const og = c.createGain();
			o.type = type;
			o.frequency.value = f * mul;
			og.gain.value = a;
			o.connect(og);
			og.connect(lp);
			o.start(t);
			o.stop(t + 2.3);
		}
	}
	_blip(t, f, len, vol) {
		const c = this.ctx;
		const o = this._osc();
		const g = c.createGain();
		o.type = 'square';
		o.frequency.setValueAtTime(f, t);
		o.frequency.exponentialRampToValueAtTime(f * 0.5, t + len);
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + len);
		o.connect(g);
		g.connect(this.drums);
		g.connect(this.send);
		o.start(t);
		o.stop(t + len + 0.01);
	}


	_sched(step, t, spb) {
		const s = step % 32;
		const bar = Math.floor(step / 32);
		if (this.mode === 'ambient') {
			const chords = [
				[110, 220, 329.63, 392, 493.88],
				[87.31, 174.61, 261.63, 329.63, 440],
				[65.41, 130.81, 261.63, 392, 493.88],
				[98, 196, 293.66, 392, 493.88],
			];
			const ch = chords[bar % 4];
			if (s === 0) {
				this._pad(t, ch, 32 * spb + 1.8, 0.04);
				this._sub(t, ch[0] / 2, 32 * spb * 0.85, 0.22);
			}
			if (s % 2 === 0 && Math.random() < 0.14) this._bell(t, ch[2 + Math.floor(Math.random() * 3)] * (Math.random() < 0.5 ? 2 : 4), 0.07);
			if (Math.random() < 0.05) this._hat(t, 0.025, 0.03);
			return;
		}
		if (this.mode === 'deep') {
			// тихая глубина: длинные пады на ладу ре минор, мягкая бегущая нота и редкие капли с эхом
			const chords = [
				[73.42, 110, 146.83, 174.61, 220, 329.63],
				[58.27, 87.31, 146.83, 220, 261.63, 392],
				[49, 73.42, 116.54, 174.61, 220, 293.66],
				[55, 82.41, 196, 261.63, 329.63, 493.88],
			];
			const ch = chords[bar % 4];
			if (s === 0) {
				this._pad(t, ch, 32 * spb + 3, 0.03);
				this._sub(t, ch[0] / 2, 32 * spb, 0.16);
				// высокое «сияние»: две тихие октавы, плывущие над аккордом
				this._pad(t + 1.5, [ch[4] * 2, ch[5] * 2], 32 * spb, 0.012);
			}
			// неспешное арпеджио по тонам аккорда: каждый такт чуть иначе, поэтому не надоедает
			const arp = [0, 3, 6, 10, 13, 16, 19, 22, 26, 29];
			const ai = arp.indexOf(s);
			if (ai >= 0 && !(bar % 2 === 1 && ai % 3 === 2)) {
				const order = [2, 3, 4, 3, 5, 4, 3, 2, 4, 5];
				const shift = bar % 4 === 2 ? 1 : 0;
				this._pluck(t, ch[Math.min(5, order[ai] + shift)] * (ai % 4 === 3 ? 2 : 1), 0.05);
			}
			if (s % 4 === 0 && Math.random() < 0.1) this._bell(t, ch[3 + Math.floor(Math.random() * 3)] * (Math.random() < 0.5 ? 2 : 1), 0.045);
			return;
		}
		// мягкий джангл
		const roots = [41.2, 43.65, 36.71, 49];
		const root = roots[bar % 4];
		if ([0, 10, 16, 26].includes(s)) this._kick(t, 0.7, 120, 48, 0.22);
		if ([4, 12, 20, 28].includes(s)) this._snare(t, 0.4, 190, 0.14);
		if ([7, 23].includes(s) && Math.random() < 0.5) this._snare(t, 0.12, 230, 0.07);
		if (s % 4 === 2) this._hat(t, 0.07, 0.035);
		if ([0, 10, 16, 26].includes(s)) this._reese(t, s === 10 || s === 26 ? root * 2 : root, spb * 4, 0.2);
		if (s === 0) this._pad(t, [root * 4, root * 4.8, root * 6, root * 7.2, root * 9], 32 * spb + 1, 0.04);
		if (s % 8 === 5 && Math.random() < 0.4) this._bell(t, root * 12, 0.05);
	}
}

export const SYNTH_PARAMS = {
	deep: { bpm: 48, master: 0.95, fb: 0.6, wet: 0.6 },
	ambient: { bpm: 66, master: 0.85, fb: 0.5, wet: 0.5 },
	jungle: { bpm: 150, master: 0.55, fb: 0.4, wet: 0.35 },
};
