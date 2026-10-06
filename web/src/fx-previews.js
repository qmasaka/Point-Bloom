const TAU = Math.PI * 2;
const PTS = [];
for (let i = 0; i < 44; i++) {
const a = (i / 44) * TAU;
PTS.push({ x: Math.cos(a) * 0.82, y: Math.sin(a) * 0.82, a, h: (i * 0.618) % 1, r: 0.82 });
}
for (let i = 0; i < 20; i++) {
const a = (i / 20) * TAU + 0.3;
PTS.push({ x: Math.cos(a) * 0.42, y: Math.sin(a) * 0.42, a, h: (i * 0.371 + 0.2) % 1, r: 0.42 });
}
const FN = {
curl: (p, t) => [Math.sin(t * 2 + p.a * 3) * 0.22, Math.cos(t * 1.7 + p.a * 2) * 0.22, 1, 1],
physics: (p, t) => {
const k = (t * 0.5) % 1.6;
return [p.x * k * 0.3, p.y * k * 0.2 + Math.min(1, k * k) * 0.9 * (0.5 + p.h), 1, 1];
},
spectrum: (p, t) => {
const e = 0.5 + 0.5 * Math.sin(t * 4 + Math.floor(p.a * 3) * 1.7);
return [Math.cos(p.a) * e * 0.4, Math.sin(p.a) * e * 0.4, 1, 1];
},
wave: (p, t) => {
const d = Math.sin(p.r * 7 - t * 5) * 0.16;
return [Math.cos(p.a) * d, Math.sin(p.a) * d, 1, 1];
},
twist: (p, t) => {
const a = p.y * Math.sin(t * 1.5) * 1.1;
return [p.x * Math.cos(a) - p.y * Math.sin(a) * 0.4 - p.x, p.y * Math.cos(a * 0.4) - p.y + p.x * Math.sin(a) * 0.2, 1, 1];
},
pulse: (p, t) => {
const k = Math.max(0, Math.sin(t * 4 - p.r * 2.5));
const e = k * k * k * 0.3;
return [p.x * e, p.y * e, 1, 1 + e];
},
blast: (p, t) => {
const a = (t * 1.3) % 2;
const e = Math.exp(-a * 2.2) * Math.cos(a * 6) * (0.5 + p.h);
return [p.x * e * 0.7, p.y * e * 0.7, 1, 1];
},
cloth: (p, t) => [Math.sin(t * 3 + p.x * 4 + p.y * 3) * 0.1 + 0.12, Math.sin(t * 3.3 + p.x * 5) * 0.12 * (p.y + 1) * 0.5, 1, 1],
flow: (p, t) => {
const s = Math.sin(t * 2 + p.h * 6.28) * 0.3;
return [-Math.sin(p.a) * s, Math.cos(p.a) * s, 1, 1];
},
alive: (p, t) => {
const b = 1 + Math.sin(t * 2.2) * 0.07 + Math.max(0, Math.sin(t * 5.5)) * 0.05;
return [p.x * (b - 1), p.y * (b - 1), 1, 1];
},
dissolve: (p, t) => {
const k = Math.max(0, Math.min(1, ((t * 0.5) % 1.4) * 1.4 - (1 - (p.y + 1) / 2) * 0.9));
return [Math.sin(t * 3 + p.h * 9) * k * 0.3 + k * 0.4, -k * k * 0.5, 1 - k, 1 - k * 0.6];
},
voxel: (p, t) => {
const g = 0.32 + 0.1 * Math.sin(t * 2);
return [(Math.floor(p.x / g) + 0.5) * g - p.x, (Math.floor(p.y / g) + 0.5) * g - p.y, 1, 1.3];
},
glitch: (p, t) => {
const band = Math.floor((p.y + 1) * 4);
const r = Math.abs(Math.sin(band * 12.9 + Math.floor(t * 6) * 4.1));
return [r > 0.75 ? (r - 0.75) * 2.4 : 0, 0, 1, 1];
},
links: (p, t) => [Math.sin(t + p.a) * 0.04, 0, 1, 1],
slice: (p, t) => {
const y = ((t * 0.6) % 1) * 2 - 1;
return [0, 0, Math.abs(p.y - y) < 0.25 ? 1 : 0.28, 1 + (Math.abs(p.y - y) < 0.25 ? 0.5 : 0)];
},
feedback: (p, t) => [Math.cos(t + p.a) * 0.06, Math.sin(t + p.a) * 0.06, 1, 1],
echo: (p, t) => [Math.cos(t) * 0.1, 0, 1, 1],
tracking: (p, t) => [0, 0, 1, 1],
cursor: (p, t) => {
const mx = Math.cos(t * 1.4) * 0.6;
const my = Math.sin(t * 1.9) * 0.4;
const dx = p.x - mx;
const dy = p.y - my;
const d = Math.hypot(dx, dy) + 0.01;
const f = Math.max(0, 1 - d / 0.8);
return [(dx / d) * f * 0.35, (dy / d) * f * 0.35, 1, 1];
},
brush: (p, t) => {
const mx = Math.cos(t * 1.4) * 0.6;
const d = Math.hypot(p.x - mx, p.y);
return [0, 0, 1, 1 + Math.max(0, 1 - d / 0.7) * 0.9];
},
shock: (p, t) => {
const r = ((t * 0.7) % 1.4) * 1.2;
const e = Math.exp(-Math.pow((p.r - r) * 4, 2)) * 0.3;
return [p.x * e, p.y * e, 1, 1];
},
camTrack: (p, t) => [Math.sin(t * 2) * 0.1, Math.cos(t * 2) * 0.1, 1, 1],
gravity: (p, t) => {
const a = t * (0.6 + 0.8 / (p.r + 0.3));
return [p.x * Math.cos(a) - p.y * Math.sin(a) - p.x, (p.x * Math.sin(a) + p.y * Math.cos(a)) * 0.45 - p.y, 1, 1];
},
};
export function drawPreview(ctx, id, t, color, w, h) {
ctx.clearRect(0, 0, w, h);
const fn = FN[id] || FN.curl;
const cx = w / 2;
const cy = h / 2;
const sc = Math.min(w, h) * 0.46;
ctx.fillStyle = color;
if (id === 'feedback') {
for (let k = 5; k >= 0; k--) {
ctx.globalAlpha = 0.5 / (k + 1);
for (const p of PTS) {
const [dx, dy] = fn(p, t - k * 0.12);
ctx.fillRect(cx + (p.x + dx) * sc, cy + (p.y + dy) * sc, 1.4, 1.4);
}
}
}
if (id === 'echo') {
for (let k = 2; k >= 1; k--) {
ctx.globalAlpha = 0.25;
for (const p of PTS) ctx.fillRect(cx + (p.x * Math.cos(k * 0.5) - p.y * Math.sin(k * 0.5) * 0.3) * sc, cy + (p.y + 0.08 * k) * sc, 1.3, 1.3);
}
}
const pos = PTS.map((p) => {
const [dx, dy, a, s] = fn(p, t);
return [cx + (p.x + dx) * sc, cy + (p.y + dy) * sc, a, s];
});
if (id === 'links') {
ctx.globalAlpha = 0.5;
ctx.strokeStyle = color;
ctx.lineWidth = 0.7;
ctx.beginPath();
for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) if (Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]) < sc * 0.62) {
ctx.moveTo(pos[i][0], pos[i][1]);
ctx.lineTo(pos[j][0], pos[j][1]);
}
ctx.stroke();
}
if (id === 'tracking') {
ctx.globalAlpha = 1;
ctx.strokeStyle = color;
ctx.lineWidth = 1;
const bx = cx + Math.cos(t * 1.2) * sc * 0.45;
const by = cy + Math.sin(t * 1.6) * sc * 0.3;
const k = 3.5;
ctx.beginPath();
for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
const x = bx + sx * 6;
const y = by + sy * 5;
ctx.moveTo(x - sx * k, y);
ctx.lineTo(x, y);
ctx.lineTo(x, y - sy * k);
}
ctx.stroke();
}
for (const [x, y, a, s] of pos) {
ctx.globalAlpha = Math.max(0, Math.min(1, a)) * 0.9;
const r = 1.5 * s;
ctx.fillRect(x - r / 2, y - r / 2, r, r);
}
ctx.globalAlpha = 1;
}
export function attachPreview(canvas, id, card, getColor) {
const dpr = Math.min(2, window.devicePixelRatio || 1);
const W = 34;
const H = 24;
canvas.width = W * dpr;
canvas.height = H * dpr;
canvas.style.width = W + 'px';
canvas.style.height = H + 'px';
const ctx = canvas.getContext('2d');
let raf = 0;
let t0 = 0;
const frame = (now) => {
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
drawPreview(ctx, id, (now - t0) / 1000 + 0.6, getColor(), W, H);
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
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
drawPreview(ctx, id, 0.9, getColor(), W, H);
};
card.addEventListener('pointerenter', start);
card.addEventListener('pointerleave', stop);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
drawPreview(ctx, id, 0.9, getColor(), W, H);
return { refresh: () => !raf && drawPreview(ctx, id, 0.9, getColor(), W, H) };
}
