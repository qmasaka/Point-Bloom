// Демо-модель: настоящие файлы .obj + .mtl + .png, которые идут тем же путём, что и ваши.
import * as THREE from 'three';

function objText(parts, mtlName) {
	const out = [`# Pointa demo\nmtllib ${mtlName}\n`];
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
	const base = new THREE.CylinderGeometry(1.7, 1.85, 0.16, 72, 1);
	base.translate(0, -1.62, 0);
	const obj = objText(
		[
			{ name: 'Узел', geo: knot, mtl: 'demo_knot' },
			{ name: 'Подставка', geo: base, mtl: 'demo_base' },
		],
		'demo.mtl'
	);
	const mtl = 'newmtl demo_knot\nKd 1 1 1\nNs 120\nmap_Kd demo_texture.png\n\nnewmtl demo_base\nKd 0.20 0.22 0.26\nNs 30\n';
	const png = await texturePNG();
	return [new File([obj], 'demo.obj', { type: 'text/plain' }), new File([mtl], 'demo.mtl', { type: 'text/plain' }), new File([png], 'demo_texture.png', { type: 'image/png' })];
}
