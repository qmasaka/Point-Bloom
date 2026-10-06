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
		// три рукава спирали: точки закручиваются к центру
		for (let k = 0; k < 3; k++) for (let i = 0; i < 9; i++) {
			const a = k * 2.09 + i * 0.5 - t * 1.4;
			const r = 1.5 + i * 1.25;
			dot(c, Math.cos(a) * r, Math.sin(a) * r * 0.78, 1.5 + (i < 3 ? 0.4 : 0), 0.35 + (i / 9) * 0.65);
		}
	},
	flow: (c, t) => {
		// контур формы и яркие штрихи, скользящие по поверхности вдоль линий потока
		for (const [x, y] of ring(26, 10)) dot(c, x * 1.2, y * 0.85, 1.2, 0.3);
		for (let j = 0; j < 3; j++) for (let k = 0; k < 6; k++) {
			const a = ((t * 0.9 + j * 0.34 - k * 0.045) % 1) * Math.PI - Math.PI / 2;
			dot(c, Math.sin(a) * 11 * 1.1, (j - 1) * 4.6 + Math.cos(a) * 1.5, 1.7, 1 - k * 0.15);
		}
	},
	cloth: (c, t) => {
		for (const [x, y, i, j] of grid(7, 5, 3.4, 3.6)) dot(c, x + Math.sin(t * 3 + i * 0.9 + j * 0.5) * 1.4 + 1, y + Math.sin(t * 3.2 + i * 0.9) * (1 + i * 0.35), 1.6, 1);
		c.fillRect(-12, -9, 1.2, 18);
	},
	alive: (c, t) => {
		// сердце, которое бьётся
		const b = 1 + Math.max(0, Math.sin(t * 5)) * 0.2 + Math.sin(t * 2) * 0.04;
		for (let i = 0; i < 26; i++) {
			const a = (i / 26) * TAU;
			const x = 16 * Math.pow(Math.sin(a), 3);
			const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
			dot(c, x * 0.52 * b, y * 0.52 * b + 0.5, 1.7, 1);
		}
		dot(c, 0, -1, 2, 0.7);
	},
	gravity: (c, t) => {
		// центр тяжести и орбиты, по которым кружат точки
		dot(c, 0, 0, 3.6);
		for (const [rx, ry, n, sp] of [[5, 2, 4, 1.8], [8.5, 3.6, 6, 1.2], [12, 5.2, 8, 0.8]]) {
			for (let i = 0; i < 28; i++) {
				const a = (i / 28) * TAU;
				dot(c, Math.cos(a) * rx, Math.sin(a) * ry, 0.8, 0.22);
			}
			for (let i = 0; i < n; i++) {
				const a = (i / n) * TAU + t * sp;
				dot(c, Math.cos(a) * rx, Math.sin(a) * ry, 2, 1);
			}
		}
	},
	spectrum: (c, t) => {
		for (let i = 0; i < 8; i++) {
			const h = 2 + (0.5 + 0.5 * Math.sin(t * 4 + i * 1.3)) * 10;
			for (let k = 0; k < h / 2.2; k++) dot(c, (i - 3.5) * 3.2, 9 - k * 2.2, 2, 0.5 + 0.5 * (k / (h / 2.2)));
		}
	},
	wave: (c, t) => {
		// бегущие волны воды
		for (let j = 0; j < 3; j++) for (let i = 0; i < 12; i++) {
			const x = (i - 5.5) * 2.4;
			dot(c, x, (j - 1) * 6 + Math.sin(i * 0.8 - t * 4 + j) * 2.6, 1.6, 0.5 + j * 0.25);
		}
	},
	pulse: (c, t) => {
		// кардиограмма: линия бежит, и на каждом ударе острый всплеск
		c.strokeStyle = c.fillStyle;
		c.lineWidth = 1.5;
		c.lineJoin = 'round';
		c.globalAlpha = 1;
		c.beginPath();
		for (let i = 0; i <= 40; i++) {
			const x = -13 + i * 0.65;
			const u = (((i / 40) * 1.3 - t * 0.8) % 1 + 1) % 1;
			let y = 0;
			if (u < 0.1) y = -2 * Math.sin((u / 0.1) * Math.PI);
			else if (u < 0.2) y = 11 * Math.sin(((u - 0.1) / 0.1) * Math.PI) * (u < 0.15 ? -1 : 0.55);
			if (i === 0) c.moveTo(x, y);
			else c.lineTo(x, y);
		}
		c.stroke();
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
		// лента, закрученная вдоль вертикали
		for (let j = 0; j < 9; j++) {
			const w = Math.cos(j * 0.55 + t * 1.6) * 8;
			const y = (j - 4) * 2.5;
			for (let i = -2; i <= 2; i++) dot(c, (i / 2) * w, y, 1.6, 0.5 + 0.5 * Math.abs(Math.cos(j * 0.55 + t * 1.6)));
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
		// облако из точек, соединённых нитями, и свет, бегущий по нитям
		const pts = [];
		for (let i = 0; i < 12; i++) {
			const a = (i / 12) * TAU + Math.sin(t + i) * 0.1;
			pts.push([Math.cos(a) * 10, Math.sin(a) * 7.5]);
		}
		for (let i = 0; i < 5; i++) pts.push([Math.cos(i * 1.26 + 0.6) * 4.5, Math.sin(i * 1.26 + 0.6) * 3.4]);
		const edges = [];
		pts.forEach((p, i) => pts.forEach((q, j) => {
			if (j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 7.2) edges.push([i, j]);
		}));
		c.globalAlpha = 0.7;
		c.strokeStyle = c.fillStyle;
		c.lineWidth = 0.9;
		c.beginPath();
		for (const [i, j] of edges) {
			c.moveTo(pts[i][0], pts[i][1]);
			c.lineTo(pts[j][0], pts[j][1]);
		}
		c.stroke();
		edges.forEach(([i, j], k) => {
			const u = (t * 1.3 + k * 0.37) % 1;
			if (u < 0.5) dot(c, pts[i][0] + (pts[j][0] - pts[i][0]) * u * 2, pts[i][1] + (pts[j][1] - pts[i][1]) * u * 2, 2.1, 1);
		});
		pts.forEach((p) => dot(c, p[0], p[1], 1.6, 1));
	},
	slice: (c, t) => {
		const y = Math.sin(t * 2.2) * 8;
		for (const [x, yy] of ring(30, 9)) dot(c, x * 1.2, yy, Math.abs(yy - y) < 2 ? 2.6 : 1.4, Math.abs(yy - y) < 2 ? 1 : 0.35);
		for (let i = -6; i <= 6; i++) dot(c, i * 1.8, y, 1.6, 0.9);
	},
	feedback: (c, t) => {
		// яркая точка и длинный гаснущий хвост за ней
		for (let k = 16; k >= 0; k--) {
			const tt = t * 1.8 - k * 0.09;
			dot(c, Math.cos(tt) * 10, Math.sin(tt * 1.3) * 6, k === 0 ? 3.4 : 2.6 - k * 0.12, k === 0 ? 1 : 0.7 - k * 0.04);
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
		// клик и круговая волна по форме
		const r = ((t * 5) % 15) + 1;
		for (const [x, y] of ring(30, 10)) dot(c, x * 1.25, y * 0.9, 1.2, 0.3);
		for (const [x, y] of ring(26, r)) dot(c, x * 1.25, y * 0.9, 1.7, 1 - r / 17);
		dot(c, 0, 0, 2.4, 1);
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
