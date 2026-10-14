import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { TouchSynth } from '../audio/touch-synth.js';
import { SYNTH_STYLES } from '../state/options.js';

/** Звук: синтезатор, файл, микрофон, звук видео, анализ полос и бит. Методы подмешиваются в EffectsEngine (см. engine/index.js). */
export class AudioPart {
	_markBeat() {
		this._tb = this._time;
		const g = this.geometry;
		if (g) {
			const t = g.attributes.aTarget.array;
			const i = Math.floor(Math.random() * (t.length / 3)) * 3;
			(this._waveSrc ||= new THREE.Vector3()).set(t[i], t[i + 1], t[i + 2]);
		}
	}

	_ensureCtx() {
		if (this.ctx) return;
		const A = window.AudioContext || window.webkitAudioContext;
		this.ctx = new A();
		this.bus = this.ctx.createGain();
		this.analyser = this.ctx.createAnalyser();
		this.analyser.fftSize = 2048;
		this.analyser.smoothingTimeConstant = 0.82;
		this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
		this.out = this.ctx.createGain();
		this.out.gain.value = this.state.audio.volume;
		this.recDest = this.ctx.createMediaStreamDestination();
		this.bus.connect(this.analyser);
		this.bus.connect(this.out);
		this.out.connect(this.ctx.destination);
		this.bus.connect(this.recDest);
		this.synth = new TouchSynth(this.ctx, this.bus);
	}

	setVolume(v) {
		this.state.audio.volume = v;
		if (this.out && this.sourceType !== 'mic') this.out.gain.value = v;
		this.touch();
	}

	get trackLabel() {
		if (this.sourceType === 'mic') return 'Микрофон';
		if (this.sourceType === 'file') return this.audioName || 'Трек';
		if (this.sourceType === 'video') return 'Звук видео';
		return (SYNTH_STYLES.find((s) => s.id === this.state.audio.style) || SYNTH_STYLES[0]).name;
	}

	async play() {
		this._ensureCtx();
		if (this.ctx.state === 'suspended') {
			try {
				await this.ctx.resume();
			} catch (e) {
				/* браузер может блокировать автоплей звука до клика пользователя */
			}
		}
		if (this.sourceType === 'synth') {
			this.synth.start(this.state.audio.style);
			this.playing = true;
		} else if (this.sourceType === 'video') {
			this._connectVideo();
			this.playing = true;
		} else if (this.sourceType === 'file' && this.audioBuffer) {
			this._stopFile();
			this.source = this.ctx.createBufferSource();
			this.source.buffer = this.audioBuffer;
			this.source.loop = true;
			this.source.connect(this.bus);
			this.source.start(0);
			this.playing = true;
		}
		this.emit();
	}

	pause() {
		this.synth?.stop();
		this._stopFile();
		if (this.sourceType === 'mic') this._stopMic();
		this._disconnectVideo();
		this.playing = false;
		this.emit();
	}

	/** Звук открытого видео: один раз заводим в аудиограф, дальше он идёт либо в анализатор (режим эффектов), либо прямо в колонки */
	_videoGate() {
		const el = this.pm.el;
		if (!el || this.pm.kind !== 'video') return null;
		this._ensureCtx();
		if (!el._fxNode) {
			el._fxNode = this.ctx.createMediaElementSource(el);
			el._fxGate = this.ctx.createGain();
			el._fxNode.connect(el._fxGate);
			el.muted = false;
		}
		return el._fxGate;
	}

	_connectVideo() {
		const gate = this._videoGate();
		if (!gate) return false;
		gate.disconnect();
		gate.gain.value = 1;
		gate.connect(this.bus);
		this._vidGate = gate;
		// выключение звука видео в эффектах гасит только вывод: анализ продолжает работать
		this.pm.onMute = (m) => {
			if (this.out) this.out.gain.value = m ? 0 : this.state.audio.volume;
		};
		this.pm.onMute(this.pm.muted);
		this.pm.play();
		return true;
	}

	/** Беззвучный приёмник: если узел видео ни к чему не подключён, браузер перестаёт его читать и видео зависает */
	_vidSink() {
		if (!this._sink) {
			this._sink = this.ctx.createGain();
			this._sink.gain.value = 0;
			this._sink.connect(this.ctx.destination);
		}
		return this._sink;
	}

	_disconnectVideo() {
		if (this._vidGate) {
			const gate = this._vidGate;
			try {
				gate.disconnect();
				gate.connect(this._vidSink());
			} catch (e) {
				/* уже отключён */
			}
			this._vidGate = null;
			this.pm.onMute = null;
			if (this.out) this.out.gain.value = this.state.audio.volume;
		}
	}

	/** В редакторе видео играет напрямую в колонки, минуя анализатор */
	_videoToEditor() {
		this._disconnectVideo();
		const gate = this.pm.el?._fxGate;
		if (!gate || !this.ctx) return;
		gate.disconnect();
		gate.gain.value = this.pm.muted ? 0 : 1;
		gate.connect(this.ctx.destination);
		this.pm.onMute = (m) => {
			gate.gain.value = m ? 0 : 1;
		};
	}

	async useVideoAudio() {
		if (!this.pm.ready || this.pm.kind !== 'video') throw new Error('Откройте видео на вкладке «Медиа»');
		this._ensureCtx();
		this.synth.stop();
		this._stopFile();
		this._stopMic();
		this.sourceType = 'video';
		this.touch();
		await this.play();
	}

	toggle() {
		return this.playing ? this.pause() : this.play();
	}

	_stopFile() {
		if (this.source) {
			try {
				this.source.stop();
			} catch (e) {
				/* уже остановлен */
			}
			this.source.disconnect();
			this.source = null;
		}
	}

	_stopMic() {
		if (this.micStream) {
			this.micStream.getTracks().forEach((t) => t.stop());
			this.micStream = null;
			this.micNode?.disconnect();
			if (this.out) this.out.gain.value = this.state.audio.volume;
		}
	}

	async useSynth(style) {
		if (style) this.state.audio.style = style;
		if (!SYNTH_STYLES.some((x) => x.id === this.state.audio.style)) this.state.audio.style = 'deep';
		this._disconnectVideo();
		this._stopMic();
		this._stopFile();
		this.sourceType = 'synth';
		this.touch();
		await this.play();
	}

	async loadFile(file) {
		this._ensureCtx();
		this._disconnectVideo();
		this.synth.stop();
		this._stopFile();
		this._stopMic();
		this.audioBuffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
		this.sourceType = 'file';
		this.audioName = file.name.replace(/\.[^.]+$/, '');
		await this.play();
	}

	async useMic() {
		this._ensureCtx();
		this._disconnectVideo();
		this.synth.stop();
		this._stopFile();
		this._stopMic();
		this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
		this.micNode = this.ctx.createMediaStreamSource(this.micStream);
		this.micNode.connect(this.bus);
		this.out.gain.value = 0; // не выводим микрофон в колонки: будет свист
		this.sourceType = 'mic';
		this.playing = true;
		if (this.ctx.state === 'suspended') await this.ctx.resume();
		this.emit();
	}

	_analyse(dt) {
		const a = this.state.audio;
		let bass = 0, mid = 0, high = 0, beat = 0;
		if (this.analyser && this.playing) {
			this.analyser.getByteFrequencyData(this.freqData);
			const n = this.freqData.length;
			const e1 = Math.floor(n * 0.05), e2 = Math.floor(n * 0.25), e3 = Math.floor(n * 0.7);
			let b = 0, m = 0, h = 0;
			for (let i = 0; i < e1; i++) b += this.freqData[i];
			for (let i = e1; i < e2; i++) m += this.freqData[i];
			for (let i = e2; i < e3; i++) h += this.freqData[i];
			const g = a.gain * 1.15;
			const bRaw = Math.min(1, (b / (e1 * 255)) * g);
			const mRaw = Math.min(1, (m / ((e2 - e1) * 255)) * g * 1.2);
			const hRaw = Math.min(1, (h / ((e3 - e2) * 255)) * g * 1.8);
			this._beatHist[this._beatIdx++ % this._beatHist.length] = bRaw;
			let avg = 0;
			for (const v of this._beatHist) avg += v;
			avg /= this._beatHist.length;
			const now = performance.now();
			if (bRaw > avg * 1.3 && bRaw > 0.3 && now - this._lastBeat > 190) {
				this._lastBeat = now;
				this.levels.beat = 1;
				this._markBeat();
			}
			const kA = 1 - Math.pow(0.001, dt * 6); // быстрая атака
			const kR = 1 - Math.pow(0.001, dt * 2.2); // плавный спад
			const lag = (cur, raw) => cur + (raw - cur) * (raw > cur ? kA : kR);
			bass = lag(this.levels.bass, bRaw);
			mid = lag(this.levels.mid, mRaw);
			high = lag(this.levels.high, hRaw);
			// спектр: 64 полосы по логарифмической шкале
			for (let i = 0; i < 64; i++) {
				const f0 = Math.floor(Math.pow(i / 64, 2) * n * 0.55);
				const f1 = Math.max(f0 + 1, Math.floor(Math.pow((i + 1) / 64, 2) * n * 0.55));
				let s = 0;
				for (let j = f0; j < f1; j++) s += this.freqData[j];
				const v = Math.min(1, (s / ((f1 - f0) * 255)) * g * (1 + i / 40));
				this.spec[i] += (v - this.spec[i]) * (v > this.spec[i] ? 0.6 : 0.15);
			}
		} else if (a.idle) {
			const t = this._time;
			bass = 0.3 + 0.22 * Math.sin(t * 1.3);
			mid = 0.28 + 0.2 * Math.sin(t * 1.9 + 1);
			high = 0.22 + 0.15 * Math.sin(t * 2.7 + 2);
			if (Math.sin(t * 2.2) > 0.96) this.levels.beat = Math.max(this.levels.beat, 0.8);
			for (let i = 0; i < 64; i++) this.spec[i] = 0.2 + 0.15 * Math.sin(t * 2 + i * 0.4) * Math.sin(t * 0.7 + i * 0.1);
		} else {
			const k = 1 - Math.pow(0.001, dt * 3);
			bass = this.levels.bass * (1 - k);
			mid = this.levels.mid * (1 - k);
			high = this.levels.high * (1 - k);
			for (let i = 0; i < 64; i++) this.spec[i] *= 1 - k;
		}
		beat = this.levels.beat * Math.pow(0.0008, dt);
		this.levels = { bass, mid, high, beat };
		const d = this.specTex.image.data;
		for (let i = 0; i < 64; i++) d[i] = Math.round(clamp(this.spec[i], 0, 1) * 255);
		this.specTex.needsUpdate = true;
	}

	/** Сила слоя с учётом реакции на звук: depth=0 даёт постоянное значение, depth=1 следует за полосой */
	/** Текущий уровень звука в полосе эффекта 0..1: готовая полоса или свой диапазон спектра */
	_bandLevel(l) {
		if (l.band === 'custom') {
			const i0 = Math.max(0, Math.floor(l.lo * 64));
			const i1 = Math.min(64, Math.max(i0 + 1, Math.ceil(l.hi * 64)));
			let s = 0;
			for (let i = i0; i < i1; i++) s += this.spec[i];
			return Math.min(1, (s / (i1 - i0)) * 1.5);
		}
		return this.levels[l.band] || 0;
	}

	/** Частота (Гц) для положения на оси спектра 0..1 */
	hzAt(x) {
		const sr = this.ctx?.sampleRate || 44100;
		return Math.round(x * x * 0.275 * sr);
	}
}
