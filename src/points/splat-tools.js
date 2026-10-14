// Сплаты из PLY живут в сцене как облако цветных точек. Здесь хранится исходный набор и пересборка по настройкам:
// сколько точек оставить, какие прозрачные отбросить, насколько растянуть глубину.
import * as THREE from 'three';

/** Запоминает исходные данные и применяет настройки по умолчанию */
export function initSplat(pts, src) {
	pts.userData.splat = { total: src.total, src, cfg: { count: src.pos.length / 3, minOp: 0.05, depth: 1 } };
	applySplat(pts);
}

/** Пересобирает геометрию по pts.userData.splat.cfg */
export function applySplat(pts) {
	const S = pts.userData.splat;
	const { pos, col, op } = S.src;
	const n = pos.length / 3;
	const keep = [];
	for (let i = 0; i < n; i++) if (op[i] >= S.cfg.minOp) keep.push(i);
	const want = Math.max(1000, Math.min(Math.round(S.cfg.count), keep.length));
	const step = keep.length / want;
	const m = Math.min(want, keep.length);
	const P = new Float32Array(m * 3);
	const C = new Float32Array(m * 3);
	for (let k = 0; k < m; k++) {
		const i = keep[Math.floor(k * step)];
		P[k * 3] = pos[i * 3];
		P[k * 3 + 1] = pos[i * 3 + 1];
		P[k * 3 + 2] = pos[i * 3 + 2];
		C[k * 3] = col[i * 3];
		C[k * 3 + 1] = col[i * 3 + 1];
		C[k * 3 + 2] = col[i * 3 + 2];
	}
	const old = pts.geometry;
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(P, 3));
	g.setAttribute('color', new THREE.BufferAttribute(C, 3));
	pts.geometry = g;
	old.dispose();
	pts.scale.z = S.cfg.depth;
	S.shown = m;
	S.available = keep.length;
}
