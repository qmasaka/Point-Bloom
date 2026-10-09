// Активность костей по времени клипа: сколько кость движется в каждый момент. По ней рисуется полоса «Персонаж» на таймлайне.
import * as THREE from 'three';

const cache = new WeakMap();

/** { n, total: Float32Array 0..1, bones: [{ name, vals: Float32Array 0..1, sum }] }, кости от самых подвижных к спокойным */
export function clipActivity(clip, N = 160) {
	if (cache.has(clip)) return cache.get(clip);
	const dur = Math.max(clip.duration, 0.01);
	const dt = dur / (N - 1);
	const byBone = new Map();
	for (const tr of clip.tracks) {
		// имя дорожки «кость.свойство»; если разбор three не справился (двоеточия и точки в именах), делим по последней точке сами
		let nodeName, propertyName;
		try {
			({ nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(tr.name));
		} catch (e) {
			const k = tr.name.lastIndexOf('.');
			nodeName = k > 0 ? tr.name.slice(0, k) : '';
			propertyName = k > 0 ? tr.name.slice(k + 1) : '';
		}
		if (!nodeName) continue;
		const isQ = tr.ValueTypeName === 'quaternion';
		if (!isQ && propertyName !== 'position') continue;
		const itp = tr.createInterpolant();
		let prev = Array.from(itp.evaluate(0));
		const arr = byBone.get(nodeName) || new Float32Array(N);
		for (let i = 1; i < N; i++) {
			const v = Array.from(itp.evaluate(dt * i));
			let d;
			if (isQ) d = 2 * Math.acos(Math.min(1, Math.abs(prev[0] * v[0] + prev[1] * v[1] + prev[2] * v[2] + prev[3] * v[3])));
			else d = Math.hypot(v[0] - prev[0], v[1] - prev[1], v[2] - prev[2]) * 2;
			arr[i] += d / dt;
			prev = v;
		}
		arr[0] = arr[1];
		byBone.set(nodeName, arr);
	}
	const bones = [];
	let gmax = 1e-6;
	for (const [name, a] of byBone) {
		// лёгкое сглаживание, чтобы полоса не рябила
		const s = new Float32Array(N);
		for (let i = 0; i < N; i++) s[i] = (a[Math.max(0, i - 1)] + a[i] * 2 + a[Math.min(N - 1, i + 1)]) / 4;
		let sum = 0;
		for (let i = 0; i < N; i++) {
			sum += s[i];
			if (s[i] > gmax) gmax = s[i];
		}
		bones.push({ name: name.replace(/^.*[:|]/, ''), vals: s, sum });
	}
	const total = new Float32Array(N);
	let tmax = 1e-6;
	for (const b of bones) {
		for (let i = 0; i < N; i++) {
			b.vals[i] = Math.min(1, b.vals[i] / gmax);
			total[i] += b.vals[i];
		}
	}
	for (let i = 0; i < N; i++) if (total[i] > tmax) tmax = total[i];
	for (let i = 0; i < N; i++) total[i] /= tmax;
	bones.sort((a, b) => b.sum - a.sum);
	const res = { n: N, total, bones };
	cache.set(clip, res);
	return res;
}
