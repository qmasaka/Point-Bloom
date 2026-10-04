// Трекинг-рамки поверх сцены: «захваченные» области облака с угловыми скобками, подписями и связями между собой.
import * as THREE from 'three';

const rnd = (a, b) => a + Math.random() * (b - a);

export class TrackerHud {
	constructor(host) {
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'fx-hud';
		host.append(this.canvas);
		this.ctx = this.canvas.getContext('2d');
		this.items = [];
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

	/** cfg: настройки слоя, alpha: итоговая сила 0..1.5, ctxInfo: { points, geometry, camera, morph, levels, colors, dt } */
	draw(cfg, alpha, info) {
		const { points, geometry, camera, morph, levels, colors, dt } = info;
		const { w, h } = this._fit();
		const ctx = this.ctx;
		ctx.clearRect(0, 0, w, h);
		if (!points || alpha < 0.02) return;
		this.t += dt;
		const want = Math.round(cfg.count);
		while (this.items.length < want) {
			const p = this._pick(geometry, morph);
			this.items.push({ id: Math.floor(rnd(1, 99)), pos: p.clone(), target: p, next: this.t + rnd(0.6, 2.6), speed: 0, conf: rnd(0.82, 0.99) });
		}
		this.items.length = want;
		const beat = levels.beat;
		const beatNew = beat > 0.9 && this.beatSeen <= 0.9;
		this.beatSeen = beat;
		const dpx = [];
		for (const it of this.items) {
			if (this.t > it.next || (beatNew && Math.random() < 0.35)) {
				it.target = this._pick(geometry, morph);
				it.next = this.t + rnd(0.8, 3);
				it.id = Math.floor(rnd(1, 99));
				it.conf = rnd(0.8, 0.99);
			}
			const before = it.pos.clone();
			it.pos.lerp(it.target, 1 - Math.exp(-dt * 7));
			it.speed += (it.pos.distanceTo(before) / Math.max(dt, 1e-3) - it.speed) * 0.2;
			const v = this._v.copy(it.pos);
			points.localToWorld(v);
			v.project(camera);
			if (v.z > 1 || v.z < -1) continue;
			dpx.push({ it, x: (v.x * 0.5 + 0.5) * w, y: (1 - (v.y * 0.5 + 0.5)) * h });
		}
		const [c0, c2] = colors;
		const size = cfg.size * (1 + levels.bass * 0.25);
		ctx.lineWidth = 1.25;
		ctx.font = '11px Geist, "Geist Variable", system-ui, sans-serif';
		ctx.textBaseline = 'top';

		// связи между рамками
		if (cfg.lines === 'on') {
			ctx.setLineDash([3, 4]);
			ctx.strokeStyle = rgba(c0, 0.5 * alpha);
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
			ctx.strokeStyle = rgba(c0, 0.95 * Math.min(1, alpha));
			ctx.beginPath();
			ctx.moveTo(x0, y0 + k); ctx.lineTo(x0, y0); ctx.lineTo(x0 + k, y0);
			ctx.moveTo(x1 - k, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + k);
			ctx.moveTo(x1, y1 - k); ctx.lineTo(x1, y1); ctx.lineTo(x1 - k, y1);
			ctx.moveTo(x0 + k, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - k);
			ctx.stroke();
			ctx.fillStyle = rgba(c2, 0.9 * Math.min(1, alpha));
			ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
			if (cfg.labels === 'on') {
				const tx = x1 + 8;
				ctx.strokeStyle = rgba(c0, 0.5 * alpha);
				ctx.beginPath();
				ctx.moveTo(x1, y0);
				ctx.lineTo(tx - 3, y0);
				ctx.stroke();
				ctx.fillStyle = rgba(c2, Math.min(1, alpha));
				ctx.fillText(`ID ${String(it.id).padStart(2, '0')}  ${Math.round(it.conf * 100)}%`, tx, y0 - 5);
				ctx.fillStyle = rgba(c2, 0.7 * Math.min(1, alpha));
				ctx.fillText(`X ${it.pos.x.toFixed(2)}  Y ${it.pos.y.toFixed(2)}`, tx, y0 + 8);
				ctx.fillText(`V ${it.speed.toFixed(2)}  Z ${it.pos.z.toFixed(2)}`, tx, y0 + 21);
			}
		}
	}
}

function rgba(hex, a) {
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}
