// Иконки эффектов в списке слева: у каждого своя маленькая «картинка из точек», которая оживает при наведении.
const TAU = Math.PI * 2;
const W = 30;
const H = 24;

const dot = (c, x, y, r, a = 1) => {
	c.globalAlpha = Math.max(0, Math.min(1, a));
	c.fillRect(x - r / 2, y - r / 2, r, r);
};
const ring = (n, r, off = 0) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * TAU + off) * r, Math.sin((i / n) * TAU + off) * r, i / n]);
const grid = (cols, rows, sx, sy) => {
	const out = [];
	for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push([(i - (cols - 1) / 2) * sx, (j - (rows - 1) / 2) * sy, i, j]);
	return out;
};

/** t в секундах; рисуем в системе координат с центром в середине иконки, единица = 1 px */
const DRAW = {
	curl: (c, t) => {
		for (let k = 0; k < 3; k++) for (let i = 0; i < 12; i++) {
			const a = i * 0.55 + t * (1.6 - k * 0.3) + k * 2;
			const r = 2 + i * 0.75;
			dot(c, Math.cos(a) * r * 1.1, Math.sin(a) * r * 0.8, 1.5, 1 - i / 14);
		}
	},
	flow: (c, t) => {
		for (let j = 0; j < 4; j++) for (let i = 0; i < 9; i++) {
			const x = ((i * 3.4 + t * 9 + j * 5) % 30) - 15;
			dot(c, x, (j - 1.5) * 5 + Math.sin(x * 0.35 + j) * 2.2, 1.6, 0.35 + 0.65 * Math.abs(Math.sin(x * 0.2 + t)));
		}
	},
	cloth: (c, t) => {
		for (const [x, y, i, j] of grid(7, 5, 3.4, 3.6)) dot(c, x + Math.sin(t * 3 + i * 0.9 + j * 0.5) * 1.4 + 1, y + Math.sin(t * 3.2 + i * 0.9) * (1 + i * 0.35), 1.6, 1);
		c.fillRect(-12, -9, 1.2, 18);
	},
	alive: (c, t) => {
		const b = 1 + Math.max(0, Math.sin(t * 5)) * 0.18 + Math.sin(t * 2) * 0.05;
		for (const [x, y] of ring(22, 7.5 * b)) dot(c, x, y, 1.5);
		for (const [x, y] of ring(11, 3.5 * b, 0.4)) dot(c, x, y, 1.4, 0.7);
		dot(c, 0, 0, 2.4, 1);
	},
	gravity: (c, t) => {
		dot(c, 0, 0, 3.2);
		for (const [r, n, sp] of [[4.5, 5, 1.6], [7.5, 8, 1.1], [10.5, 11, 0.7]]) for (let i = 0; i < n; i++) {
			const a = (i / n) * TAU + t * sp;
			dot(c, Math.cos(a) * r * 1.35, Math.sin(a) * r * 0.5, 1.4, 0.9);
		}
	},
	spectrum: (c, t) => {
		for (let i = 0; i < 9; i++) {
			const h = 2 + (0.5 + 0.5 * Math.sin(t * 4 + i * 1.3)) * 11;
			for (let k = 0; k < h / 2.2; k++) dot(c, (i - 4) * 3.1, 9 - k * 2.2, 1.6, 0.5 + 0.5 * (k / (h / 2.2)));
		}
	},
	wave: (c, t) => {
		dot(c, 0, 0, 2.2);
		for (let k = 0; k < 3; k++) {
			const r = ((t * 6 + k * 4.6) % 13.8) + 1;
			for (const [x, y] of ring(Math.round(8 + r * 1.4), r)) dot(c, x * 1.1, y * 0.85, 1.3, 1 - r / 15);
		}
	},
	pulse: (c, t) => {
		const e = Math.max(0, Math.sin(t * 4));
		for (let k = 0; k < 3; k++) for (const [x, y] of ring(18, 3.5 + k * 3 + e * e * e * (2 + k * 1.6))) dot(c, x * 1.1, y * 0.85, 1.4, 1 - k * 0.25);
	},
	blast: (c, t) => {
		const a = (t * 1.2) % 2;
		const e = Math.exp(-a * 2.4) * Math.cos(a * 6);
		for (let i = 0; i < 26; i++) {
			const ang = i * 2.4;
			const r = (3 + (i % 4) * 1.5) * (1 + 1.8 * e);
			dot(c, Math.cos(ang) * r * 1.2, Math.sin(ang) * r * 0.9, 1.5, 0.9);
		}
	},
	twist: (c, t) => {
		for (let j = 0; j < 8; j++) for (let k = 0; k < 2; k++) {
			const y = (j - 3.5) * 2.6;
			const a = y * 0.28 * Math.sin(t * 1.8) + k * Math.PI;
			dot(c, Math.cos(a) * 7, y, 1.6, 0.6 + 0.4 * Math.cos(a));
		}
	},
	voxel: (c, t) => {
		for (const [x, y, i, j] of grid(4, 4, 5.2, 4.8)) dot(c, x, y, 3.4 + Math.sin(t * 3 + i + j) * 0.9, 0.55 + 0.45 * Math.sin(t * 2 + i * j));
	},
	glitch: (c, t) => {
		for (let j = 0; j < 7; j++) {
			const r = Math.abs(Math.sin(j * 12.9 + Math.floor(t * 5) * 4.1));
			const sh = r > 0.7 ? (r - 0.7) * 24 : 0;
			for (let i = 0; i < 9; i++) dot(c, (i - 4) * 2.7 + sh, (j - 3) * 3, 1.7, 1);
		}
	},
	physics: (c, t) => {
		const k = (t * 0.6) % 1.5;
		for (let i = 0; i < 22; i++) {
			const x = ((i * 0.37) % 1) * 16 - 8;
			const y0 = -8 + (i % 5) * 1.5;
			const fall = Math.min(1, k * k * 1.2 * (0.6 + (i % 3) * 0.25));
			dot(c, x * (1 + fall * 0.4), y0 + fall * (16 - (i % 4) * 0.8 - (i % 5) * 1.5), 1.5, 1);
		}
		c.globalAlpha = 0.4;
		c.fillRect(-12, 9, 24, 1);
	},
	dissolve: (c, t) => {
		const p = (t * 0.45) % 1.3;
		for (let i = 0; i < 30; i++) {
			const x = ((i * 0.43) % 1) * 18 - 9;
			const y = Math.floor(i / 6) * 3.4 - 8;
			const k = Math.max(0, Math.min(1, p * 1.5 - (y + 8) / 14));
			dot(c, x + k * 5 + Math.sin(t * 3 + i) * k * 2, y - k * 4, 1.7 * (1 - k * 0.6), 1 - k);
		}
	},
	links: (c, t) => {
		const pts = ring(7, 8).map(([x, y], i) => [x * 1.2 + Math.sin(t + i) * 0.8, y + Math.cos(t * 1.2 + i) * 0.8]);
		pts.push([0, 0]);
		c.globalAlpha = 0.55;
		c.strokeStyle = c.fillStyle;
		c.lineWidth = 0.7;
		c.beginPath();
		pts.forEach((p, i) => pts.forEach((q, j) => {
			if (j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 11) {
				c.moveTo(p[0], p[1]);
				c.lineTo(q[0], q[1]);
			}
		}));
		c.stroke();
		pts.forEach((p) => dot(c, p[0], p[1], 2, 1));
	},
	slice: (c, t) => {
		const y = Math.sin(t * 2.2) * 8;
		for (const [x, yy] of ring(30, 9)) dot(c, x * 1.2, yy, Math.abs(yy - y) < 2 ? 2.6 : 1.4, Math.abs(yy - y) < 2 ? 1 : 0.35);
		for (let i = -6; i <= 6; i++) dot(c, i * 1.8, y, 1.6, 0.9);
	},
	feedback: (c, t) => {
		for (let k = 7; k >= 0; k--) {
			const tt = t - k * 0.1;
			const x = Math.cos(tt * 2.2) * 8;
			const y = Math.sin(tt * 1.5) * 5;
			dot(c, x, y, 3.4 - k * 0.3, 0.9 - k * 0.11);
		}
	},
	echo: (c, t) => {
		for (let k = 3; k >= 0; k--) for (const [x, y] of ring(14, 5.5)) dot(c, x * 1.15 + (k - 1.5) * 4 * Math.cos(t * 1.4), y * 0.9 + Math.sin(t * 1.4 + k) * 0.8, 1.5, 0.95 - k * 0.22);
	},
	cursor: (c, t) => {
		const mx = Math.cos(t * 1.6) * 6;
		const my = Math.sin(t * 2.1) * 3;
		for (const [x, y] of ring(26, 9.5)) {
			const dx = x * 1.3 - mx;
			const dy = y - my;
			const d = Math.hypot(dx, dy) + 0.01;
			const f = Math.max(0, 1 - d / 9) * 5;
			dot(c, x * 1.3 + (dx / d) * f, y + (dy / d) * f, 1.5);
		}
		c.beginPath();
		c.moveTo(mx, my);
		c.lineTo(mx + 1.5, my + 5);
		c.lineTo(mx + 3, my + 3);
		c.closePath();
		c.globalAlpha = 1;
		c.fill();
	},
	brush: (c, t) => {
		const n = 14;
		const head = (t * 1.2) % 1;
		for (let i = 0; i < n; i++) {
			const u = i / n;
			const x = (u - 0.5) * 22;
			const y = Math.sin(u * 5) * 4;
			dot(c, x, y, 1.8 + (u < head ? 1.8 : 0), u < head ? 1 : 0.25);
		}
	},
	tracking: (c, t) => {
		for (const [x, y] of ring(14, 8)) dot(c, x * 1.25, y, 1.4, 0.5);
		const bx = Math.cos(t * 1.3) * 5;
		const by = Math.sin(t * 1.7) * 3;
		c.globalAlpha = 1;
		c.lineWidth = 1.1;
		c.strokeStyle = c.fillStyle;
		c.beginPath();
		for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
			const x = bx + sx * 5.5;
			const y = by + sy * 4.5;
			c.moveTo(x - sx * 3, y);
			c.lineTo(x, y);
			c.lineTo(x, y - sy * 3);
		}
		c.stroke();
	},
	shock: (c, t) => {
		const r = ((t * 5) % 14) + 1;
		for (const [x, y] of ring(30, 10)) {
			const e = Math.exp(-Math.pow((10 - r) * 0.5, 2));
			dot(c, x * 1.25 * (1 + e * 0.25), y * (1 + e * 0.25), 1.5, 0.7 + e * 0.3);
		}
		for (const [x, y] of ring(24, r)) dot(c, x * 1.2, y * 0.9, 1.2, 1 - r / 16);
	},
	camTrack: (c, t) => {
		const wob = Math.sin(t * 2.5) * 0.15;
		for (let f = 0; f < 5; f++) {
			const a = -1.9 + f * 0.38 + wob;
			for (let k = 1; k <= 3; k++) dot(c, Math.cos(a) * k * 3.4, 6 + Math.sin(a) * k * 3.4, k === 3 ? 2.1 : 1.4, 0.55 + 0.15 * k);
		}
		for (const [x, y] of ring(9, 4)) dot(c, x, y + 6, 1.7, 0.7);
	},
};

export function drawPreview(ctx, id, t, color, w = W, h = H) {
	ctx.clearRect(0, 0, w, h);
	ctx.save();
	ctx.translate(w / 2, h / 2);
	ctx.fillStyle = color;
	(DRAW[id] || DRAW.curl)(ctx, t);
	ctx.restore();
	ctx.globalAlpha = 1;
}

/** Подключает иконку к canvas: движется при наведении на строку, иначе показывает один кадр */
export function attachPreview(canvas, id, card, getColor) {
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	canvas.width = W * dpr;
	canvas.height = H * dpr;
	canvas.style.width = W + 'px';
	canvas.style.height = H + 'px';
	const ctx = canvas.getContext('2d');
	let raf = 0;
	let t0 = 0;
	const paint = (t) => {
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		drawPreview(ctx, id, t, getColor(), W, H);
	};
	const frame = (now) => {
		paint((now - t0) / 1000 + 0.7);
		raf = requestAnimationFrame(frame);
	};
	const start = () => {
		if (raf) return;
		t0 = performance.now();
		raf = requestAnimationFrame(frame);
	};
	const stop = () => {
		if (!raf) return;
		cancelAnimationFrame(raf);
		raf = 0;
		paint(0.9);
	};
	card.addEventListener('pointerenter', start);
	card.addEventListener('pointerleave', stop);
	paint(0.9);
	return { refresh: () => !raf && paint(0.9) };
}
