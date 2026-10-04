import * as THREE from 'three';
const AXES = [
{ id: '+x', v: [1, 0, 0], color: '#e5565f', label: 'X', view: 'right' },
{ id: '-x', v: [-1, 0, 0], color: '#e5565f', label: '', view: 'left' },
{ id: '+y', v: [0, 1, 0], color: '#86c85a', label: 'Y', view: 'top' },
{ id: '-y', v: [0, -1, 0], color: '#86c85a', label: '', view: 'bottom' },
{ id: '+z', v: [0, 0, 1], color: '#4f8ff0', label: 'Z', view: 'front' },
{ id: '-z', v: [0, 0, -1], color: '#4f8ff0', label: '', view: 'back' },
];
export class AxisGizmo {
constructor(app, canvas) {
this.app = app;
this.canvas = canvas;
this.size = 108;
this.hover = null;
this.dragging = null;
this.items = [];
this.qInv = new THREE.Quaternion();
this.resize();
canvas.addEventListener('pointermove', (e) => this.onMove(e));
canvas.addEventListener('pointerleave', () => {
if (!this.dragging) {
this.hover = null;
this.draw();
}
});
canvas.addEventListener('pointerdown', (e) => this.onDown(e));
canvas.addEventListener('pointerup', (e) => this.onUp(e));
canvas.addEventListener('pointercancel', (e) => this.onUp(e));
canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
app.bus.on('camera', () => this.draw());
}
resize() {
const dpr = Math.min(window.devicePixelRatio || 1, 2);
this.canvas.width = this.size * dpr;
this.canvas.height = this.size * dpr;
this.canvas.style.width = this.size + 'px';
this.canvas.style.height = this.size + 'px';
this.dpr = dpr;
this.draw();
}
project() {
const q = this.app.nav.q;
this.qInv.copy(q).invert();
const R = this.size * 0.34;
const c = this.size / 2;
this.items = AXES.map((a) => {
const v = new THREE.Vector3(...a.v).applyQuaternion(this.qInv);
return { ...a, x: c + v.x * R, y: c - v.y * R, z: v.z, positive: a.id[0] === '+' };
}).sort((a, b) => a.z - b.z);
}
draw() {
const ctx = this.canvas.getContext('2d');
const dpr = this.dpr;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
ctx.clearRect(0, 0, this.size, this.size);
this.project();
const c = this.size / 2;
if (this.hover === 'bg' || this.dragging) {
ctx.beginPath();
ctx.arc(c, c, this.size * 0.46, 0, Math.PI * 2);
ctx.fillStyle = 'rgba(255,255,255,0.07)';
ctx.fill();
}
for (const it of this.items) {
if (!it.positive) continue;
ctx.beginPath();
ctx.moveTo(c, c);
ctx.lineTo(it.x, it.y);
ctx.strokeStyle = it.color;
ctx.lineWidth = 2;
ctx.globalAlpha = it.z < -0.1 ? 0.45 : 1;
ctx.stroke();
ctx.globalAlpha = 1;
}
for (const it of this.items) {
const r = it.positive ? 10.5 : 8;
const hot = this.hover === it.id;
ctx.beginPath();
ctx.arc(it.x, it.y, r, 0, Math.PI * 2);
if (it.positive) {
ctx.fillStyle = it.color;
ctx.globalAlpha = hot ? 1 : it.z < -0.1 ? 0.7 : 1;
ctx.fill();
ctx.globalAlpha = 1;
if (hot) {
ctx.strokeStyle = 'rgba(255,255,255,0.9)';
ctx.lineWidth = 1.5;
ctx.stroke();
}
ctx.fillStyle = '#14171b';
ctx.font = '600 12px Geist, system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText(it.label, it.x, it.y + 0.5);
} else {
ctx.fillStyle = hot ? it.color : 'rgba(20,23,27,0.55)';
ctx.fill();
ctx.lineWidth = 1.5;
ctx.strokeStyle = it.color;
ctx.globalAlpha = hot ? 1 : it.z < -0.1 ? 0.45 : 0.8;
ctx.stroke();
ctx.globalAlpha = 1;
}
}
}
hit(e) {
const rect = this.canvas.getBoundingClientRect();
const x = e.clientX - rect.left;
const y = e.clientY - rect.top;
for (let i = this.items.length - 1; i >= 0; i--) {
const it = this.items[i];
const r = it.positive ? 12 : 9.5;
if ((x - it.x) ** 2 + (y - it.y) ** 2 <= r * r) return it;
}
const c = this.size / 2;
if ((x - c) ** 2 + (y - c) ** 2 <= (this.size * 0.46) ** 2) return 'bg';
return null;
}
onMove(e) {
if (this.dragging) {
const dx = e.clientX - this.dragging.x;
const dy = e.clientY - this.dragging.y;
if (Math.hypot(e.clientX - this.dragging.sx, e.clientY - this.dragging.sy) > 4) this.dragging.moved = true;
this.dragging.x = e.clientX;
this.dragging.y = e.clientY;
if (this.dragging.moved) this.app.nav.orbit(dx, dy);
return;
}
const h = this.hit(e);
const id = h ? (h === 'bg' ? 'bg' : h.id) : null;
if (id !== this.hover) {
this.hover = id;
this.canvas.style.cursor = h && h !== 'bg' ? 'pointer' : h ? 'grab' : 'default';
this.draw();
}
}
onDown(e) {
const h = this.hit(e);
if (!h) return;
this.canvas.setPointerCapture(e.pointerId);
this.dragging = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, target: h };
this.canvas.style.cursor = 'grabbing';
this.draw();
}
onUp(e) {
const d = this.dragging;
if (!d) return;
this.dragging = null;
try {
this.canvas.releasePointerCapture(e.pointerId);
} catch (err) {
}
if (!d.moved && d.target && d.target !== 'bg') {
const nav = this.app.nav;
const label = nav.viewLabel();
const same = label.endsWith(({ right: 'Справа', left: 'Слева', top: 'Сверху', bottom: 'Снизу', front: 'Спереди', back: 'Сзади' })[d.target.view]);
nav.setView(d.target.view, same);
}
this.canvas.style.cursor = 'default';
this.hover = null;
this.draw();
}
}
