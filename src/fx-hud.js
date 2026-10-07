// Трекинг-рамки поверх сцены: «захваченные» подвижные области облака и кибер-телеметрия (HUD).
import * as THREE from 'three';
import { HAND_LINKS, TIPS } from './hand-tracker.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class TrackerHud {
	constructor(host) {
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'fx-hud';
		host.append(this.canvas);
		this.ctx = this.canvas.getContext('2d');
		this.items = [];
		this.imprints = [];
		this.time = 0;
		this.t = 0;
		this.beatSeen = 0;
		this._v = new THREE.Vector3();
	}

	_fit() {
		const c = this.canvas;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = c.clientWidth;
		const h = c.clientHeight;
		if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
			c.width = Math.round(w * dpr);
			c.height = Math.round(h * dpr);
		}
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		return { w, h };
	}

	clear() {
		const c = this.canvas;
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.clearRect(0, 0, c.width, c.height);
	}

	dispose() {
		this.canvas.remove();
	}

	_pick(geometry, morph) {
		const o = geometry.attributes.aOrigin.array;
		const t = geometry.attributes.aTarget.array;
		const n = geometry.attributes.position.count;
		const i = Math.floor(Math.random() * n) * 3;
		const m = morph * morph * (3 - 2 * morph);
		return new THREE.Vector3(o[i] + (t[i] - o[i]) * m, o[i + 1] + (t[i + 1] - o[i + 1]) * m, o[i + 2] + (t[i + 2] - o[i + 2]) * m);
	}

	/** Выбирает точку по всей форме: из нескольких случайных берём самую далёкую от уже занятых, чтобы рамки не скапливались */
	_pickHotspot(geometry, morph, levels) {
		const o = geometry.attributes.aOrigin.array;
		const t = geometry.attributes.aTarget.array;
		const n = geometry.attributes.position.count;
		const m = morph * morph * (3 - 2 * morph);
		let best = null;
		let bestScore = -1;
		for (let s = 0; s < 10; s++) {
			const i = Math.floor(Math.random() * n) * 3;
			const p = new THREE.Vector3(o[i] + (t[i] - o[i]) * m, o[i + 1] + (t[i + 1] - o[i + 1]) * m, o[i + 2] + (t[i + 2] - o[i + 2]) * m);
			let near = 9;
			for (const it of this.items) near = Math.min(near, p.distanceTo(it.target));
			const score = near + Math.random() * 0.25;
			if (score > bestScore) {
				bestScore = score;
				best = p;
			}
		}
		return best;
	}

	/** Симуляция «захваченных» точек: рамки динамически следуют за зонами активности */
	update(want, geometry, morph, levels, dt, targets) {
		this.t += dt;
		while (this.items.length < want) {
			const p = this._pickHotspot(geometry, morph, levels);
			this.items.push({ id: Math.floor(rnd(1, 99)), pos: p.clone(), target: p, next: this.t + rnd(0.8, 2.8), speed: 0, conf: rnd(0.85, 0.99), touch: 0 });
		}
		this.items.length = want;
		while (this.imprints.length > 32 || (this.imprints[0] && this.time - this.imprints[0].t0 > 8)) this.imprints.shift();
		const beatNew = levels.beat > 0.9 && this.beatSeen <= 0.9;
		this.beatSeen = levels.beat;
		this.items.forEach((it, idx) => {
			if (targets && targets.length) {
				it.target = targets[idx % targets.length];
			} else if (this.t > it.next || (beatNew && Math.random() < 0.35)) {
				if (it.touch > 0.3) this.imprints.push({ pos: it.target.clone(), t0: this.time, s: it.touch });
				it.target = this._pickHotspot(geometry, morph, levels);
				it.next = this.t + rnd(1.0, 3.2);
				it.id = Math.floor(rnd(1, 99));
				it.conf = rnd(0.82, 0.99);
			}
			const before = it.pos.clone();
			it.pos.lerp(it.target, 1 - Math.exp(-dt * 6.5));
			it.speed += (it.pos.distanceTo(before) / Math.max(dt, 1e-3) - it.speed) * 0.2;
			it.touch += (1 - Math.min(1, it.pos.distanceTo(it.target) * 2.5) - it.touch) * 0.15;
		});
	}

	/** Отрисовка трекинг-рамок */
	draw(cfg, alpha, info) {
		this.drawTracking(cfg, alpha, info);
	}

	drawTracking(cfg, alpha, info) {
		const { points, camera, levels, colors } = info;
		const { w, h } = this._fit();
		const ctx = this.ctx;
		if (!points || alpha < 0.02) return;
		const dpx = [];
		for (const it of this.items.slice(0, Math.round(cfg.count))) {
			const v = this._v.copy(it.pos);
			points.localToWorld(v);
			v.project(camera);
			if (v.z > 1 || v.z < -1) continue;
			dpx.push({ it, x: (v.x * 0.5 + 0.5) * w, y: (1 - (v.y * 0.5 + 0.5)) * h });
		}
		const [c0, c2] = colors;
		const size = cfg.size * (1 + levels.bass * 0.25);
		const lw = cfg.thick || 1.5;
		ctx.lineWidth = lw;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		const ls = Math.max(0.5, Math.min(3, cfg.labelSize || 1));
		const fs = 11 * ls;
		ctx.font = `${fs}px Geist, "Geist Variable", system-ui, sans-serif`;
		ctx.textBaseline = 'top';

		// связи между рамками
		if (cfg.lines === 'on') {
			ctx.setLineDash([3, 4]);
			ctx.strokeStyle = rgba(c0, 0.45 * alpha);
			for (let i = 0; i < dpx.length; i++) {
				let best = -1;
				let bd = 1e9;
				for (let j = 0; j < dpx.length; j++) {
					if (i === j) continue;
					const d = (dpx[i].x - dpx[j].x) ** 2 + (dpx[i].y - dpx[j].y) ** 2;
					if (d < bd) {
						bd = d;
						best = j;
					}
				}
				if (best < 0) continue;
				ctx.beginPath();
				ctx.moveTo(dpx[i].x, dpx[i].y);
				ctx.lineTo(dpx[best].x, dpx[best].y);
				ctx.stroke();
			}
			ctx.setLineDash([]);
		}

		for (const { it, x, y } of dpx) {
			const s = size * (0.8 + it.conf * 0.25);
			const k = s * 0.28;
			const x0 = x - s / 2;
			const y0 = y - s / 2;
			const x1 = x + s / 2;
			const y1 = y + s / 2;
			// заливка области рамки: тон или штриховка
			if (cfg.fill && cfg.fill !== 'none') {
				ctx.save();
				ctx.beginPath();
				if (cfg.shape === 'circle' || cfg.shape === 'cross') ctx.arc(x, y, s / 2, 0, Math.PI * 2);
				else ctx.rect(x0, y0, s, s);
				ctx.clip();
				ctx.fillStyle = rgba(c0, 0.14 * alpha);
				ctx.fillRect(x0, y0, s, s);
				if (cfg.fill === 'hatch') {
					ctx.strokeStyle = rgba(c0, 0.35 * alpha);
					ctx.lineWidth = 1;
					ctx.beginPath();
					for (let k = -s; k < s; k += 7) {
						ctx.moveTo(x0 + k, y1);
						ctx.lineTo(x0 + k + s, y0);
					}
					ctx.stroke();
				}
				ctx.restore();
				ctx.lineWidth = lw;
			}
			ctx.strokeStyle = rgba(c0, 0.95 * Math.min(1, alpha));
			ctx.beginPath();
			const shape = cfg.shape || 'corners';
			if (shape === 'box') {
				ctx.rect(x0, y0, s, s);
			} else if (shape === 'circle') {
				ctx.arc(x, y, s / 2, 0, Math.PI * 2);
			} else if (shape === 'cross') {
				ctx.arc(x, y, s * 0.22, 0, Math.PI * 2);
				ctx.moveTo(x - s / 2, y);
				ctx.lineTo(x - s * 0.22 - 3, y);
				ctx.moveTo(x + s * 0.22 + 3, y);
				ctx.lineTo(x + s / 2, y);
				ctx.moveTo(x, y - s / 2);
				ctx.lineTo(x, y - s * 0.22 - 3);
				ctx.moveTo(x, y + s * 0.22 + 3);
				ctx.lineTo(x, y + s / 2);
			} else {
				ctx.moveTo(x0, y0 + k); ctx.lineTo(x0, y0); ctx.lineTo(x0 + k, y0);
				ctx.moveTo(x1 - k, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + k);
				ctx.moveTo(x1, y1 - k); ctx.lineTo(x1, y1); ctx.lineTo(x1 - k, y1);
				ctx.moveTo(x0 + k, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - k);
			}
			ctx.stroke();
			ctx.fillStyle = rgba(c2, 0.9 * Math.min(1, alpha));
			ctx.fillRect(x - lw, y - lw, lw * 2, lw * 2);
			if (cfg.labels === 'on') {
				const tx = x1 + 8;
				const id = String(it.id).padStart(2, '0');
				const pc = Math.round(it.conf * 100);
				// что написано: набор строк зависит от выбранного вида подписи
				const kind = cfg.labelInfo || 'full';
				const lines = {
					full: [`ТОЧКА ${id}  ${pc}%`, `X ${it.pos.x.toFixed(2)}  Y ${it.pos.y.toFixed(2)}`, `V ${it.speed.toFixed(2)}  Z ${it.pos.z.toFixed(2)}`],
					id: [`№ ${id}`],
					conf: [`${id}  ${pc}%`],
					coords: [`X ${it.pos.x.toFixed(2)}`, `Y ${it.pos.y.toFixed(2)}`, `Z ${it.pos.z.toFixed(2)}`],
					speed: [`${id}`, `СКОРОСТЬ ${it.speed.toFixed(2)}`],
					bars: [`${id}`, 'bar:' + it.conf, 'bar:' + Math.min(1, it.speed * 0.5)],
					dist: [`${id}`, `ДО ЦЕНТРА ${it.pos.length().toFixed(2)}`],
				}[kind] || [];
				const lh = fs + 2;
				const boxH = lines.length * lh + 4;
				const w0 = Math.max(60 * ls, ...lines.map((t) => (t.startsWith('bar:') ? 70 * ls : ctx.measureText(t).width))) + 8;
				ctx.strokeStyle = rgba(c0, 0.5 * alpha);
				ctx.beginPath();
				ctx.moveTo(x1, y0);
				ctx.lineTo(tx - 3, y0);
				ctx.stroke();
				if (cfg.labelBg === 'on') {
					ctx.fillStyle = `rgba(11,13,17,${0.55 * Math.min(1, alpha)})`;
					ctx.fillRect(tx - 4, y0 - fs, w0, boxH);
				}
				lines.forEach((t, i) => {
					const yy = y0 - 5 + i * lh + (i ? 3 : 0);
					if (t.startsWith('bar:')) {
						const v = Math.max(0, Math.min(1, parseFloat(t.slice(4))));
						ctx.fillStyle = rgba(c0, 0.25 * alpha);
						ctx.fillRect(tx, yy - fs * 0.6, 64 * ls, fs * 0.45);
						ctx.fillStyle = rgba(c2, 0.9 * Math.min(1, alpha));
						ctx.fillRect(tx, yy - fs * 0.6, 64 * ls * v, fs * 0.45);
						return;
					}
					ctx.fillStyle = rgba(c2, (i ? 0.78 : 1) * Math.min(1, alpha));
					ctx.fillText(t, tx, yy);
				});
			}
		}
	}

	/** Руки с веб-камеры: скелет и кольца на кончиках пальцев поверх сцены */
	drawHands(hands, w, hgt, color, skeleton) {
		this._fit();
		const ctx = this.ctx;
		ctx.save();
		ctx.lineCap = 'round';
		for (const hd of hands) {
			const P = (i) => [hd.pts[i][0] * w, hd.pts[i][1] * hgt];
			if (skeleton) {
				ctx.strokeStyle = rgba(color, 0.35);
				ctx.lineWidth = 1.4;
				ctx.beginPath();
				for (const [a, b] of HAND_LINKS) {
					const A = P(a);
					const B = P(b);
					ctx.moveTo(A[0], A[1]);
					ctx.lineTo(B[0], B[1]);
				}
				ctx.stroke();
			}
			for (const ti of TIPS) {
				const p = P(ti);
				ctx.strokeStyle = rgba(color, 0.9);
				ctx.lineWidth = 1.6;
				ctx.beginPath();
				ctx.arc(p[0], p[1], 9 + hd.pinch * 3, 0, Math.PI * 2);
				ctx.stroke();
				ctx.fillStyle = rgba(color, 1);
				ctx.beginPath();
				ctx.arc(p[0], p[1], 2.4, 0, Math.PI * 2);
				ctx.fill();
			}
			if (hd.pinch > 0.6) {
				const a = P(4);
				const b = P(8);
				ctx.strokeStyle = rgba(color, 0.9);
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.moveTo(a[0], a[1]);
				ctx.lineTo(b[0], b[1]);
				ctx.arc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 16, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
		ctx.restore();
	}

	/** Курсор, которым управляет веб-камера: кольцо с прицелом на форме */
	drawCursor(x, y, alpha, color) {
		this._fit();
		const ctx = this.ctx;
		const pulse = 1 + Math.sin(this.time * 6) * 0.08;
		ctx.save();
		ctx.lineWidth = 2;
		ctx.strokeStyle = rgba(color, 0.9 * alpha);
		ctx.beginPath();
		ctx.arc(x, y, 22 * pulse, 0, Math.PI * 2);
		ctx.stroke();
		ctx.lineWidth = 1;
		ctx.strokeStyle = rgba(color, 0.5 * alpha);
		ctx.beginPath();
		ctx.arc(x, y, 34 * pulse, 0, Math.PI * 2);
		ctx.moveTo(x - 46, y);
		ctx.lineTo(x - 28, y);
		ctx.moveTo(x + 28, y);
		ctx.lineTo(x + 46, y);
		ctx.moveTo(x, y - 46);
		ctx.lineTo(x, y - 28);
		ctx.moveTo(x, y + 28);
		ctx.lineTo(x, y + 46);
		ctx.stroke();
		ctx.fillStyle = rgba(color, alpha);
		ctx.beginPath();
		ctx.arc(x, y, 3, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	/** Приборная накладка: три шкалы уровней слева сверху и спектр над нижней панелью */
	drawTelemetry(cfg, alpha, info) {
		const { w, h } = this._fit();
		const ctx = this.ctx;
		if (alpha < 0.05) return;
		const [c0, c2] = info.colors;
		ctx.save();
		ctx.font = '500 10.5px Geist, "Geist Variable", ui-monospace, monospace';
		ctx.textBaseline = 'middle';

		// шкалы уровней: слева сверху, в стороне от оси-гизмо
		const rx = 16;
		const ry = 18;
		const rw = 84;
		const lvls = [
			['БАС', info.levels?.bass || 0],
			['СРЕД', info.levels?.mid || 0],
			['ВЕРХ', info.levels?.high || 0],
		];
		lvls.forEach(([name, val], i) => {
			const y = ry + i * 16;
			ctx.fillStyle = rgba(c2, 0.75 * alpha);
			ctx.fillText(name, rx, y);
			ctx.fillStyle = rgba(c0, 0.18 * alpha);
			ctx.fillRect(rx + 38, y - 3, rw, 6);
			ctx.fillStyle = rgba(c0, 0.9 * alpha);
			ctx.fillRect(rx + 38, y - 3, Math.max(1, Math.min(rw, val * rw)), 6);
		});

		// спектр: над нижней панелью управления
		if (cfg.audioWave !== 'off' && info.spec && info.spec.length) {
			const ow = Math.min(420, w - 48);
			const ox = (w - ow) / 2;
			const oy = h - 78;
			const n = info.spec.length;
			const bw = ow / n;
			ctx.fillStyle = rgba(c0, 0.55 * alpha);
			for (let i = 0; i < n; i++) {
				const bh = Math.max(1.5, (info.spec[i] || 0) * 34);
				ctx.fillRect(ox + i * bw + 0.5, oy - bh, Math.max(1, bw - 1.5), bh);
			}
		}
		ctx.restore();
	}
}

function rgba(hex, a) {
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}
