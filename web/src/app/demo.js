import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
function objText(parts, mtlName) {
const out = [`# Point Bloom demo\nmtllib ${mtlName}\n`];
let v = 1, t = 1, n = 1;
for (const p of parts) {
const g = p.geo.index ? p.geo : p.geo;
const pos = g.attributes.position, uv = g.attributes.uv, nr = g.attributes.normal;
out.push(`o ${p.name}\n`);
const lines = [];
for (let i = 0; i < pos.count; i++) lines.push(`v ${pos.getX(i).toFixed(5)} ${pos.getY(i).toFixed(5)} ${pos.getZ(i).toFixed(5)}`);
for (let i = 0; i < uv.count; i++) lines.push(`vt ${uv.getX(i).toFixed(5)} ${uv.getY(i).toFixed(5)}`);
for (let i = 0; i < nr.count; i++) lines.push(`vn ${nr.getX(i).toFixed(4)} ${nr.getY(i).toFixed(4)} ${nr.getZ(i).toFixed(4)}`);
lines.push(`usemtl ${p.mtl}`, 's 1');
const idx = g.index;
for (let i = 0; i < idx.count; i += 3) {
const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
lines.push(`f ${a + v}/${a + t}/${a + n} ${b + v}/${b + t}/${b + n} ${c + v}/${c + t}/${c + n}`);
}
out.push(lines.join('\n') + '\n');
v += pos.count;
t += uv.count;
n += nr.count;
}
return out.join('');
}
function texturePNG() {
const N = 1024;
const c = document.createElement('canvas');
c.width = c.height = N;
const g = c.getContext('2d');
const grad = g.createLinearGradient(0, 0, N, 0);
const stops = [18, 346, 275, 212, 168, 18];
stops.forEach((hue, i) => grad.addColorStop(i / (stops.length - 1), `hsl(${hue} 78% 56%)`));
g.fillStyle = grad;
g.fillRect(0, 0, N, N);
const shade = g.createLinearGradient(0, 0, 0, N);
shade.addColorStop(0, 'rgba(255,255,255,0.22)');
shade.addColorStop(0.5, 'rgba(255,255,255,0)');
shade.addColorStop(1, 'rgba(0,0,0,0.28)');
g.fillStyle = shade;
g.fillRect(0, 0, N, N);
const cell = 64;
for (let y = 0; y < N / cell; y++) {
for (let x = 0; x < N / cell; x++) {
if ((x + y) % 2 === 0) {
g.fillStyle = 'rgba(255,255,255,0.10)';
g.fillRect(x * cell, y * cell, cell, cell);
}
}
}
g.strokeStyle = 'rgba(255,255,255,0.35)';
g.lineWidth = 2;
for (let i = 0; i <= N; i += cell * 2) {
g.beginPath();
g.moveTo(i, 0);
g.lineTo(i, N);
g.moveTo(0, i);
g.lineTo(N, i);
g.stroke();
}
g.fillStyle = 'rgba(10,12,16,0.78)';
g.font = '600 26px Geist, system-ui, sans-serif';
g.textAlign = 'left';
g.textBaseline = 'top';
for (let y = 0; y < N / (cell * 2); y++) {
for (let x = 0; x < N / (cell * 2); x++) g.fillText(`${x},${y}`, x * cell * 2 + 10, y * cell * 2 + 8);
}
return new Promise((res) => c.toBlob(res, 'image/png'));
}
export async function makeDemoFiles() {
const knot = new THREE.TorusKnotGeometry(0.9, 0.3, 260, 40, 2, 3);
{
const pos = knot.attributes.position, uv = knot.attributes.uv;
const rs = 40 + 1;
let len = 0;
for (let i = 0; i < 260; i++) {
const a = i * rs, b = (i + 1) * rs;
len += Math.hypot(pos.getX(b) - pos.getX(a), pos.getY(b) - pos.getY(a), pos.getZ(b) - pos.getZ(a));
}
const k = len / (2 * Math.PI * 0.3);
for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * k);
}
const obj = objText([{ name: 'Узел', geo: knot, mtl: 'demo_knot' }], 'demo.mtl');
const mtl = 'newmtl demo_knot\nKd 1 1 1\nNs 120\nmap_Kd demo_texture.png\n';
const png = await texturePNG();
return [new File([obj], 'demo.obj', { type: 'text/plain' }), new File([mtl], 'demo.mtl', { type: 'text/plain' }), new File([png], 'demo_texture.png', { type: 'image/png' })];
}
export async function makeDemoCharacterFile() {
const R = 0.35;
const bone = new THREE.Bone();
bone.name = 'Ball';
bone.position.set(0, R, 0);
const geo = new THREE.SphereGeometry(R, 56, 36);
geo.translate(0, R, 0);
const n = geo.attributes.position.count;
geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(n * 4), 4));
const sw = new Float32Array(n * 4);
for (let i = 0; i < n; i++) sw[i * 4] = 1;
geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
const cv = document.createElement('canvas');
cv.width = 1024;
cv.height = 512;
const g = cv.getContext('2d');
const grd = g.createLinearGradient(0, 0, 1024, 0);
[18, 346, 275, 212, 168, 18].forEach((hue, i, a) => grd.addColorStop(i / (a.length - 1), `hsl(${hue} 80% 56%)`));
g.fillStyle = grd;
g.fillRect(0, 0, 1024, 512);
const sh = g.createLinearGradient(0, 0, 0, 512);
sh.addColorStop(0, 'rgba(255,255,255,0.25)');
sh.addColorStop(0.5, 'rgba(255,255,255,0)');
sh.addColorStop(1, 'rgba(0,0,0,0.3)');
g.fillStyle = sh;
g.fillRect(0, 0, 1024, 512);
for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) if ((x + y) % 2 === 0) {
g.fillStyle = 'rgba(255,255,255,0.14)';
g.fillRect(x * 64, y * 64, 64, 64);
}
const tex = new THREE.CanvasTexture(cv);
tex.colorSpace = THREE.SRGBColorSpace;
tex.flipY = false;
const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05 }));
mesh.name = 'Шарик';
const root = new THREE.Group();
root.name = 'Шарик (анимация)';
root.add(bone);
root.add(mesh);
root.updateMatrixWorld(true);
mesh.bind(new THREE.Skeleton([bone]), mesh.matrixWorld);
const fps = 30;
const ts = [], pos = [], rot = [], scl = [];
const T0 = 0.9, decay = 0.72, H0 = 0.95, bounces = 7, span = 3.2;
const bounceT = Array.from({ length: bounces }, (_, k) => T0 * Math.pow(decay, k));
const total = bounceT.reduce((a, b) => a + b, 0);
const q = new THREE.Quaternion(), ax = new THREE.Vector3(0, 0, 1);
for (let f = 0; f <= Math.round(total * fps); f++) {
const t = f / fps;
let acc = 0, k = 0;
while (k < bounces - 1 && t > acc + bounceT[k]) acc += bounceT[k++];
const u = THREE.MathUtils.clamp((t - acc) / bounceT[k], 0, 1);
const h = H0 * Math.pow(decay, 2 * k) * 4 * u * (1 - u);
const x = (t / total) * span - span / 2;
const edge = Math.min(u, 1 - u) / (bounceT[k] > 0.3 ? 0.07 : 0.1);
const hit = Math.exp(-edge * edge) * Math.min(1, 0.35 + 0.65 * Math.pow(decay, k));
const sy = 1 - 0.32 * hit + 0.08 * Math.min(1, h / H0) , sxz = 1 + 0.2 * hit;
ts.push(t);
pos.push(x, R * sy + h, 0);
q.setFromAxisAngle(ax, -x / R);
rot.push(q.x, q.y, q.z, q.w);
scl.push(sxz, sy, sxz);
}
const clip = new THREE.AnimationClip('Прыжки', total, [
new THREE.VectorKeyframeTrack('Ball.position', ts, pos),
new THREE.QuaternionKeyframeTrack('Ball.quaternion', ts, rot),
new THREE.VectorKeyframeTrack('Ball.scale', ts, scl),
]);
const scene = new THREE.Scene();
scene.add(root);
const buf = await new GLTFExporter().parseAsync(scene, { binary: true, animations: [clip], trs: true });
return new File([buf], 'demo-ball.glb', { type: 'model/gltf-binary' });
}
