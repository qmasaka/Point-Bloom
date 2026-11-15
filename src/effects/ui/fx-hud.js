import * as THREE from 'three';
import { HAND_LINKS, TIPS } from '../input/hand-tracker.js';
import { tr } from '../../i18n/index.js';

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
		this._dirty = true;
		const c = this.canvas;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		if (!this._ro) {
			this._size = { w: c.clientWidth, h: c.clientHeight };
			this._ro = new ResizeObserver(() => {
				this._size = { w: c.clientWidth, h: c.clientHeight };
			});
			this._ro.observe(c);
		}
		const w = this._size.w;
		const h = this._size.h;
		if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
			c.width = Math.round(w * dpr);
			c.height = Math.round(h * dpr);
		}
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		return { w, h };
	}

	clear() {
		if (!this._dirty) return;
		this._dirty = false;
		const c = this.canvas;
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.clearRect(0, 0, c.width, c.height);
	}

	dispose() {
		this._ro && this._ro.disconnect();
		this.canvas.remove();
	}

	_pick(geometry, morph) {
		if (this.pickOverride) return this.pickOverride();
		const o = geometry.attributes.aOrigin.array;
		const t = geometry.attributes.aTarget.array;
		const n = geometry.attributes.position.count;
		const i = Math.floor(Math.random() * n) * 3;
		const m = morph * morph * (3 - 2 * morph);
		return new THREE.Vector3(o[i] + (t[i] - o[i]) * m, o[i + 1] + (t[i + 1] - o[i + 1]) * m, o[i + 2] + (t[i + 2] - o[i + 2]) * m);
	}

	_pickHotspot(geometry, morph, levels) {
		const o = geometry.attributes.aOrigin.array;
		const t = geometry.attributes.aTarget.array;
		const n = geometry.attributes.position.count;
		const m = morph * morph * (3 - 2 * morph);
		let best = null;
		let bestScore = -1;
		this.lastIdx = null;
		for (let s = 0; s < 10; s++) {
			const idx = Math.floor(Math.random() * n);
			const i = idx * 3;
			const p = this.pickOverride ? this.pickOverride() : new THREE.Vector3(o[i] + (t[i] - o[i]) * m, o[i + 1] + (t[i + 1] - o[i + 1]) * m, o[i + 2] + (t[i + 2] - o[i + 2]) * m);
			let near = 9;
			for (const it of this.items) near = Math.min(near, p.distanceTo(it.target));
			const score = near + Math.random() * 0.25;
			if (score > bestScore) {
				bestScore = score;
				best = p;
				this.lastIdx = this.pickOverride ? null : idx;
			}
		}
		return best;
	}

	update(want, geometry, morph, levels, dt, targets) {
		this.t += dt;
		const sp = Math.max(0.1, this.speed || 1);
		while (this.items.length < want) {
			const p = this._pickHotspot(geometry, morph, levels);
			this.items.push({ idx: this.lastIdx, id: Math.floor(rnd(1, 99)), pos: p.clone(), target: p, next: this.t + rnd(0.8, 2.8) / sp, speed: 0, conf: rnd(0.85, 0.99), touch: 0 });
		}
		this.items.length = want;
		const oArr = geometry.attributes.aOrigin.array;
		const tArr = geometry.attributes.aTarget.array;
		const mm = morph * morph * (3 - 2 * morph);
		while (this.imprints.length > 32 || (this.imprints[0] && this.time - this.imprints[0].t0 > 8)) this.imprints.shift();
		const beatNew = levels.beat > 0.9 && this.beatSeen <= 0.9;
		this.beatSeen = levels.beat;
		this.items.forEach((it, idx) => {
			if (targets && targets.length) {
				it.target = targets[idx % targets.length];
			} else if (this.t > it.next || (beatNew && Math.random() < 0.35)) {
				if (it.touch > 0.3) this.imprints.push({ pos: it.target.clone(), t0: this.time, s: it.touch });
				it.target = this._pickHotspot(geometry, morph, levels);
				it.idx = this.lastIdx;
				it.next = this.t + rnd(1.0, 3.2) / sp;
				it.id = Math.floor(rnd(1, 99));
				it.conf = rnd(0.82, 0.99);
			}
			if (it.idx != null && !(targets && targets.length) && !this.pickOverride) {
				const i3 = it.idx * 3;
				if (i3 + 2 < tArr.length) {
					const nx = oArr[i3] + (tArr[i3] - oArr[i3]) * mm, ny = oArr[i3 + 1] + (tArr[i3 + 1] - oArr[i3 + 1]) * mm, nz = oArr[i3 + 2] + (tArr[i3 + 2] - oArr[i3 + 2]) * mm;
					if (it.carry) it.pos.set(it.pos.x + nx - it.target.x, it.pos.y + ny - it.target.y, it.pos.z + nz - it.target.z);
					it.target.set(nx, ny, nz);
					it.carry = true;
				}
			}
			const off = (it.off ||= new THREE.Vector3());
			const G = this.gpu;
			let gk = -1;
			if (G && it.idx != null && !(targets && targets.length)) gk = G.idxs.indexOf(it.idx);
			if (gk >= 0 && G.data[gk * 4 + 3] > 0.5) {
				const i3 = it.idx * 3;
				const cx = oArr[i3] + (tArr[i3] - oArr[i3]) * mm, cy = oArr[i3 + 1] + (tArr[i3 + 1] - oArr[i3 + 1]) * mm, cz = oArr[i3 + 2] + (tArr[i3 + 2] - oArr[i3 + 2]) * mm;
				const k = it.offOk ? 1 - Math.exp(-dt * 30) : 1;
				off.x += (G.data[gk * 4] - cx - off.x) * k;
				off.y += (G.data[gk * 4 + 1] - cy - off.y) * k;
				off.z += (G.data[gk * 4 + 2] - cz - off.z) * k;
				it.offOk = true;
			} else if (it.offOk) {
				off.multiplyScalar(Math.exp(-dt * 8));
			}
			const before = it.pos.clone();
			it.pos.lerp(it.target, 1 - Math.exp(-dt * Math.max(this.follow ? 20 : 0, 6.5 * sp)));
			it.speed += (it.pos.distanceTo(before) / Math.max(dt, 1e-3) - it.speed) * 0.2;
			it.touch += (1 - Math.min(1, it.pos.distanceTo(it.target) * 2.5) - it.touch) * 0.15;
		});
	}

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
			if (it.off) v.add(it.off);
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

		if (cfg.lines === 'on' && dpx.length > 1) {
			const mode = cfg.lineMode || 'nearest';
			const style = cfg.lineStyle || 'dashed';
			const pairs = [];
			const seen = new Set();
			const add = (i, j) => {
				const k = i < j ? i * 100 + j : j * 100 + i;
				if (i === j || seen.has(k)) return;
				seen.add(k);
				pairs.push([dpx[i], dpx[j]]);
			};
			if (mode === 'chain') {
				const order = dpx.map((_, i) => i).sort((a, b) => dpx[a].it.id - dpx[b].it.id);
				for (let k = 0; k < order.length - 1; k++) add(order[k], order[k + 1]);
			} else if (mode === 'all') {
				const lim = Math.min(w, h) * 0.34;
				for (let i = 0; i < dpx.length; i++) for (let j = i + 1; j < dpx.length; j++) if (Math.hypot(dpx[i].x - dpx[j].x, dpx[i].y - dpx[j].y) < lim) add(i, j);
			} else if (mode === 'hub') {
				const cx = dpx.reduce((a, d) => a + d.x, 0) / dpx.length;
				const cy = dpx.reduce((a, d) => a + d.y, 0) / dpx.length;
				const hub = { x: cx, y: cy, it: { id: -1 } };
				dpx.forEach((d) => pairs.push([hub, d]));
				ctx.fillStyle = rgba(c2, 0.8 * alpha);
				ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
			} else {
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
					if (best >= 0) add(i, best);
				}
			}
			const lwn = lw * (cfg.lineWidth || 1);
			ctx.strokeStyle = rgba(c0, (cfg.lineAlpha ?? 0.5) * alpha);
			ctx.lineWidth = style === 'dots' ? lwn * 1.8 : lwn;
			ctx.setLineDash(style === 'dashed' ? [3 * lwn + 1, 4 * lwn + 1] : style === 'dots' ? [0.1, 6 + lwn * 2] : []);
			ctx.beginPath();
			for (const [A, B] of pairs) {
				ctx.moveTo(A.x, A.y);
				if (style === 'curve') {
					const mx = (A.x + B.x) / 2;
					const my = (A.y + B.y) / 2;
					ctx.quadraticCurveTo(mx - (B.y - A.y) * 0.22, my + (B.x - A.x) * 0.22, B.x, B.y);
				} else if (style === 'elbow') {
					if (Math.abs(B.x - A.x) > Math.abs(B.y - A.y)) ctx.lineTo(B.x, A.y);
					else ctx.lineTo(A.x, B.y);
					ctx.lineTo(B.x, B.y);
				} else ctx.lineTo(B.x, B.y);
			}
			ctx.stroke();
			if (style === 'pulse') {
				const tnow = performance.now() / 1000;
				ctx.fillStyle = rgba(c2, 0.95 * Math.min(1, alpha));
				for (const [A, B] of pairs) {
					const ph = (tnow * 0.6 + (A.it.id * 0.37 + B.it.id * 0.21)) % 1;
					ctx.fillRect(A.x + (B.x - A.x) * ph - 2 * lwn, A.y + (B.y - A.y) * ph - 2 * lwn, 4 * lwn, 4 * lwn);
				}
			}
			ctx.setLineDash([]);
			ctx.lineWidth = lw;
		}

		for (const { it, x, y } of dpx) {
			const s = size * (0.8 + it.conf * 0.25);
			const k = s * 0.28;
			const x0 = x - s / 2;
			const y0 = y - s / 2;
			const x1 = x + s / 2;
			const y1 = y + s / 2;
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
					ctx.fillText(tr(t), tx, yy);
				});
			}
		}
	}

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

	drawTelemetry(cfg, alpha, info) {
		const { w, h } = this._fit();
		const ctx = this.ctx;
		if (alpha < 0.05) return;
		const [c0, c2] = info.colors;
		ctx.save();
		ctx.font = '500 10.5px Geist, "Geist Variable", ui-monospace, monospace';
		ctx.textBaseline = 'middle';

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
			ctx.fillText(tr(name), rx, y);
			ctx.fillStyle = rgba(c0, 0.18 * alpha);
			ctx.fillRect(rx + 38, y - 3, rw, 6);
			ctx.fillStyle = rgba(c0, 0.9 * alpha);
			ctx.fillRect(rx + 38, y - 3, Math.max(1, Math.min(rw, val * rw)), 6);
		});

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
