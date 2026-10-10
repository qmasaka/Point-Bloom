const TAU = Math.PI * 2;
const W = 30;
const H = 24;
const K = 1.2;
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
const DRAW = {
curl: (c, t) => {
for (let k = 0; k < 3; k++) for (let i = 0; i < 9; i++) {
const a = k * 2.09 + i * 0.5 - t * 1.4;
const r = 1.5 + i * 1.25;
dot(c, Math.cos(a) * r, Math.sin(a) * r * 0.78, 1.5 + (i < 3 ? 0.4 : 0), 0.35 + (i / 9) * 0.65);
}
},
flow: (c, t) => {
for (let j = 0; j < 4; j++) {
const y0 = (j - 1.5) * 5.2;
for (let i = 0; i < 14; i++) {
const x = (i - 6.5) * 2.2;
dot(c, x, y0 + Math.sin(x * 0.4 + j) * 1.8, 1.1, 0.25);
}
const u = ((t * 0.5 + j * 0.27) % 1) * 28 - 14;
for (let k = 0; k < 6; k++) {
const x = u - k * 1.3;
if (x > -14 && x < 14) dot(c, x, y0 + Math.sin(x * 0.4 + j) * 1.8, 2.2 - k * 0.25, 1 - k * 0.15);
}
}
},
gravity: (c, t) => {
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
for (let j = 0; j < 3; j++) for (let i = 0; i < 12; i++) {
const x = (i - 5.5) * 2.4;
dot(c, x, (j - 1) * 6 + Math.sin(i * 0.8 - t * 4 + j) * 2.6, 1.6, 0.5 + j * 0.25);
}
},
pulse: (c, t) => {
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
for (let j = 0; j < 9; j++) {
const w = Math.cos(j * 0.55 + t * 1.6) * 8;
const y = (j - 4) * 2.5;
for (let i = -2; i <= 2; i++) dot(c, (i / 2) * w, y, 1.6, 0.5 + 0.5 * Math.abs(Math.cos(j * 0.55 + t * 1.6)));
}
},
voxel: (c, t) => {
for (const [x, y, i, j] of grid(4, 4, 5.2, 4.8)) dot(c, x, y, 3.4 + Math.sin(t * 3 + i + j) * 0.9, 0.55 + 0.45 * Math.sin(t * 2 + i * j));
},
depth: (c, t) => {
const k = 0.55 + 0.45 * Math.sin(t * 2);
for (let j = 0; j < 5; j++) {
for (let i = 0; i < 9; i++) {
const d = Math.exp(-(((i - 4) / 2.6) ** 2) - ((j - 2) / 1.7) ** 2);
dot(c, (i - 4) * 3.1 + (j - 2) * 0.5 * d * k, (j - 2) * 3.6 - d * 4.2 * k - 1, 1.3 + d * 1.1 * k, 0.3 + d * 0.55);
}
}
},
trail: (c, t) => {
const x0 = ((t * 0.5) % 1) * 22 - 11;
for (let k = 0; k < 5; k++) {
const x = x0 - k * 4.2;
if (x < -12) continue;
const a = Math.pow(0.7, k);
dot(c, x, -7, 2, a);
dot(c, x, -3, 2.4, a);
dot(c, x, 1, 2.4, a);
dot(c, x - 1.4 * Math.sin(t * 6 + k), 6, 1.8, a);
dot(c, x + 1.4 * Math.sin(t * 6 + k), 6, 1.8, a);
}
},
scope: (c, t) => {
const P = [[-11, 7], [-6, -2], [-9, -8], [-1, -4], [3, -9], [10, -4], [6, 3], [11, 8], [2, 5], [-3, 9]];
const k = (t * 0.5) % 1;
const seg = k * (P.length - 1);
c.globalAlpha = 0.5;
c.lineWidth = 1;
c.strokeStyle = c.fillStyle;
c.beginPath();
for (let i = 0; i <= Math.floor(seg); i++) {
if (i === 0) c.moveTo(P[0][0], P[0][1]);
else c.lineTo(P[i][0], P[i][1]);
}
const i0 = Math.floor(seg), f = seg - i0;
const hx = P[i0][0] + ((P[Math.min(i0 + 1, P.length - 1)][0] - P[i0][0]) * f);
const hy = P[i0][1] + ((P[Math.min(i0 + 1, P.length - 1)][1] - P[i0][1]) * f);
c.lineTo(hx, hy);
c.stroke();
P.forEach(([x, y], i) => dot(c, x, y, i <= seg ? 2 : 1.4, i <= seg ? 0.95 : 0.3));
dot(c, hx, hy, 3.6, 1);
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
const home = [[-10, -2], [-4, -7], [4, -6], [10, 0], [3, 7], [-5, 6]];
const pts = home.map(([x, y], i) => [x + Math.sin(t * 1.9 + i * 1.7) * 2.6, y + Math.cos(t * 1.6 + i * 2.3) * 2.6]);
const e = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [1, 5], [2, 4]];
c.strokeStyle = c.fillStyle;
c.lineWidth = 1;
c.lineCap = 'round';
for (const [i, j] of e) {
const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
c.globalAlpha = Math.max(0.12, Math.min(0.9, 1.5 - d / 11));
c.beginPath();
c.moveTo(pts[i][0], pts[i][1]);
c.lineTo(pts[j][0], pts[j][1]);
c.stroke();
}
pts.forEach((p) => dot(c, p[0], p[1], 3, 1));
},
frames: (c, t) => {
const n = 5;
const cur = (t * 1.1) % n;
const fw = 5.2;
for (let k = 0; k < n; k++) {
const d = k - cur;
const wrap = d > n / 2 ? d - n : d < -n / 2 ? d + n : d;
const lit = Math.max(0, 1 - Math.abs(wrap) * 0.9);
const tail = wrap < 0 ? Math.max(0, 1 + wrap * 0.28) * 0.5 : 0.22;
const a = Math.max(0.18, lit, tail);
const x0 = (k - 2) * 6.1 - fw / 2 + 1;
for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) dot(c, x0 + i * 1.9, (j - 1) * 2.4, 1.5, a);
}
const off = (t * 5) % 3;
for (let i = -6; i <= 6; i++) {
dot(c, i * 2.6 - off + 0.6, -7.4, 1, 0.38);
dot(c, i * 2.6 - off + 0.6, 7.4, 1, 0.38);
}
},
slice: (c, t) => {
const y = Math.sin(t * 2.2) * 8;
for (const [x, yy] of ring(30, 9)) dot(c, x * 1.2, yy, Math.abs(yy - y) < 2 ? 2.6 : 1.4, Math.abs(yy - y) < 2 ? 1 : 0.35);
for (let i = -6; i <= 6; i++) dot(c, i * 1.8, y, 1.6, 0.9);
},
feedback: (c, t) => {
for (let k = 16; k >= 0; k--) {
const tt = t * 1.8 - k * 0.09;
dot(c, Math.cos(tt) * 10, Math.sin(tt * 1.3) * 6, k === 0 ? 3.4 : 2.6 - k * 0.12, k === 0 ? 1 : 0.7 - k * 0.04);
}
},
echo: (c, t) => {
for (let k = 3; k >= 0; k--) for (const [x, y] of ring(14, 5.5)) dot(c, x * 1.15 + (k - 1.5) * 4 * Math.cos(t * 1.4), y * 0.9 + Math.sin(t * 1.4 + k) * 0.8, 1.5, 0.95 - k * 0.22);
},
cursor: (c, t) => {
const mx = Math.cos(t * 1.1) * 4;
const my = Math.sin(t * 1.4) * 2.5;
for (let j = 0; j < 7; j++) for (let i = 0; i < 11; i++) {
const x = (i - 5) * 2.6;
const y = (j - 3) * 2.8;
const dx = x - mx;
const dy = y - my;
const d = Math.hypot(dx, dy) + 0.01;
const f = Math.max(0, 1 - d / 9) * 5.5;
dot(c, x + (dx / d) * f, y + (dy / d) * f, 1.4, 0.8);
}
c.globalAlpha = 1;
c.beginPath();
c.moveTo(mx - 1, my - 3);
c.lineTo(mx - 1, my + 4.5);
c.lineTo(mx + 1, my + 2.8);
c.lineTo(mx + 3, my + 6);
c.lineTo(mx + 4.2, my + 5.3);
c.lineTo(mx + 2.4, my + 2.2);
c.lineTo(mx + 5, my + 1.8);
c.closePath();
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
holo: (c, t) => {
for (let j = 0; j < 8; j++) {
const y = j * 2.6 - 9;
const k = 0.35 + 0.65 * Math.max(0, Math.sin(y * 0.9 - t * 4));
for (let i = -6; i <= 6; i += 2) dot(c, i * 1.25 + (j === 3 && Math.sin(t * 6) > 0.7 ? 2 : 0), y, 1.3, k);
}
},
shock: (c, t) => {
const r = ((t * 5) % 15) + 1;
for (const [x, y] of ring(30, 10)) dot(c, x * 1.25, y * 0.9, 1.2, 0.3);
for (const [x, y] of ring(26, r)) dot(c, x * 1.25, y * 0.9, 1.7, 1 - r / 17);
dot(c, 0, 0, 2.4, 1);
},
camTrack: (c, t) => {
c.strokeStyle = c.fillStyle;
c.lineCap = 'round';
c.lineJoin = 'round';
c.globalAlpha = 0.28;
c.beginPath();
c.ellipse(0, 5.5, 6.6, 5.4, 0, 0, TAU);
c.fill();
const fingers = [[-5.5, 7, -1.0, 3.8, 3], [-4, 2.2, -0.22, 4.6, 3.6], [-1.4, 1, -0.07, 5, 4], [1.4, 1, 0.07, 4.6, 3.8], [4, 2.4, 0.24, 3.8, 3]];
fingers.forEach(([bx, by, a, l1, l2], i) => {
const k = 0.5 + 0.5 * Math.sin(t * 2.4 - i * 0.6);
const a1 = a + k * 0.12;
const a2 = a1 + k * 0.8;
const x1 = bx + Math.sin(a1) * l1;
const y1 = by - Math.cos(a1) * l1;
const x2 = x1 + Math.sin(a2) * l2;
const y2 = y1 - Math.cos(a2) * l2;
c.globalAlpha = 0.9;
c.lineWidth = 1.7;
c.beginPath();
c.moveTo(bx, by);
c.lineTo(x1, y1);
c.lineTo(x2, y2);
c.stroke();
dot(c, x2, y2, 2.6, 1);
});
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
export function attachPreview(canvas, id, card, getColor) {
const dpr = Math.min(2, window.devicePixelRatio || 1);
canvas.width = W * K * dpr;
canvas.height = H * K * dpr;
canvas.style.width = W * K + 'px';
canvas.style.height = H * K + 'px';
const ctx = canvas.getContext('2d');
let raf = 0;
let t0 = 0;
const paint = (t) => {
ctx.setTransform(dpr * K, 0, 0, dpr * K, 0, 0);
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
