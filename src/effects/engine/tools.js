import * as THREE from 'three';
import { FX_PALETTES } from '../state/options.js';

export class ToolsPart {
	_startGrab(loc, R) {
		const T = this.geometry.attributes.aTarget.array;
		const n = T.length / 3;
		const idx = [];
		const w = [];
		const r2 = R * R;
		for (let i = 0; i < n; i++) {
			const dx = T[i * 3] - loc.x, dy = T[i * 3 + 1] - loc.y, dz = T[i * 3 + 2] - loc.z;
			const d2 = dx * dx + dy * dy + dz * dz;
			if (d2 < r2) {
				const f = 1 - Math.sqrt(d2) / R;
				idx.push(i);
				w.push(f * f * (3 - 2 * f));
			}
		}
		return { idx: Int32Array.from(idx), w: Float32Array.from(w), last: loc.clone() };
	}

	_sculptMove(gr, loc) {
		const a = this.geometry.attributes.aSculpt;
		const arr = a.array;
		const dx = loc.x - gr.last.x, dy = loc.y - gr.last.y, dz = loc.z - gr.last.z;
		for (let k = 0; k < gr.idx.length; k++) {
			const i = gr.idx[k] * 3;
			const w = gr.w[k];
			arr[i] += dx * w;
			arr[i + 1] += dy * w;
			arr[i + 2] += dz * w;
		}
		gr.last.copy(loc);
		a.needsUpdate = true;
		this._sculptLive = true;
	}

	clearSculpt() {
		const a = this.geometry?.attributes.aSculpt;
		if (!a) return;
		a.array.fill(0);
		a.needsUpdate = true;
		this._sculptLive = false;
	}

	clearBrush() {
		this.brushHits = [];
		this._dabs = [];
		this._painted = false;
		const a = this.geometry?.attributes.aPaint;
		if (a) {
			a.array.fill(0);
			a.needsUpdate = true;
		}
		this.emit();
	}

	addBrushHit(pos) {
		if (!pos || !this.geometry || !this.geometry.attributes.aPaint) return;
		const B = this.state.layers.brush;
		if (B.tool === 'scars') return;
		const sp = Math.max(0.015, B.radius * 0.28);
		const T0 = this._lastDabT ?? -9;
		if (this._lastDab && this._lastDab.distanceTo(pos) < sp && this._time - T0 < 0.4) return;
		const newStroke = this._time - T0 > 0.3;
		(this._lastDab ||= new THREE.Vector3()).copy(pos);
		this._lastDabT = this._time;
		if (newStroke) this._strokeN = (this._strokeN || 0) + 1;
		this._makeDab(pos);
	}

	_paintColor() {
		const B = this.state.layers.brush;
		let hex = B.color;
		if (!hex || hex === 'auto' || hex === 'model') {
			const pal = FX_PALETTES.find((x) => x.id === this.state.look.palette) || FX_PALETTES[0];
			hex = pal.c[(this._strokeN || 0) % 3];
		}
		return new THREE.Color(hex);
	}

	_makeDab(pos) {
		const g = this.geometry;
		const B = this.state.layers.brush;
		const n = g.attributes.position.count;
		const T = g.attributes.aTarget.array;
		const cam = this.app.viewport.camera;
		const pts = this.points;
		const o = new THREE.Vector3();
		const d = new THREE.Vector3();
		if (cam.isOrthographicCamera) {
			cam.getWorldDirection(d);
			d.transformDirection(pts.matrixWorld.clone().invert());
			o.copy(pos).addScaledVector(d, -10);
		} else {
			pts.worldToLocal(cam.getWorldPosition(o));
			d.copy(pos).sub(o).normalize();
		}
		const rMax = B.radius * (1 + B.water * 1.4);
		const r2 = rMax * rMax;
		if (!this._pIdx || this._pIdx.length < n) {
			this._pIdx = new Int32Array(n);
			this._pD2 = new Float32Array(n);
			this._pDep = new Float32Array(n);
			this._pOut = new Int32Array(n);
			this._pOutD = new Float32Array(n);
		}
		const idx = this._pIdx, d2a = this._pD2, dep = this._pDep;
		let m = 0;
		let tmin = Infinity;
		const ox = o.x, oy = o.y, oz = o.z, dx = d.x, dy = d.y, dz = d.z;
		for (let i = 0; i < n; i++) {
			const vx = T[i * 3] - ox, vy = T[i * 3 + 1] - oy, vz = T[i * 3 + 2] - oz;
			const cx = vy * dz - vz * dy, cy = vz * dx - vx * dz, cz = vx * dy - vy * dx;
			const dd = cx * cx + cy * cy + cz * cz;
			if (dd < r2) {
				const t = vx * dx + vy * dy + vz * dz;
				idx[m] = i;
				d2a[m] = dd;
				dep[m] = t;
				if (t < tmin) tmin = t;
				m++;
			}
		}
		if (!m) return;
		const tlim = tmin + rMax * 0.9;
		const NB = 64;
		const cnt = new Int32Array(NB + 1);
		let k = 0;
		for (let a = 0; a < m; a++) {
			if (dep[a] > tlim) continue;
			idx[k] = idx[a];
			const b = Math.min(NB - 1, Math.floor((Math.sqrt(d2a[a]) / rMax) * NB));
			d2a[k] = b;
			cnt[b + 1]++;
			k++;
		}
		for (let b = 0; b < NB; b++) cnt[b + 1] += cnt[b];
		const out = new Int32Array(k), outD = new Float32Array(k);
		const pos2 = cnt.slice();
		for (let a = 0; a < k; a++) {
			const b = d2a[a];
			const q = pos2[b]++;
			out[q] = idx[a];
			outD[q] = ((b + 0.5) / NB) * rMax;
		}
		const col = this._paintColor();
		this._dabs.push({ idx: out, dist: outD, n: k, ptr: 0, t0: this._time, r0: B.radius, rMax, wetT: Math.max(0.3, B.dry), lr: Math.log(Math.max(1e-3, col.r)), lg: Math.log(Math.max(1e-3, col.g)), lb: Math.log(Math.max(1e-3, col.b)), tool: B.tool, pig: B.pigment * 0.75 * Math.min(1.5, Math.max(0.3, B.amount)), edge: B.edge });
		if (this._dabs.length > 40) this._dabs.shift();
	}

	_paintTick() {
		const ds = this._dabs;
		const attr = this.geometry?.attributes.aPaint;
		if (!ds || !ds.length || !attr) return;
		const arr = attr.array;
		let dirty = false;
		for (let q = ds.length - 1; q >= 0; q--) {
			const dab = ds[q];
			const age = this._time - dab.t0;
			const f = 1 - Math.exp((-4 * age) / dab.wetT);
			const radius = dab.r0 + (dab.rMax - dab.r0) * f;
			while (dab.ptr < dab.n && dab.dist[dab.ptr] <= radius) {
				const dn = dab.dist[dab.ptr] / dab.rMax;
				const i = dab.idx[dab.ptr];
				const fall = Math.pow(Math.max(0, 1 - dn * dn), 1.1);
				const edgeK = dn <= 0.55 ? 0 : Math.min(1, (dn - 0.55) / 0.45);
				const o = i * 4;
				const a0 = arr[o + 3];
				if (dab.tool === 'lift') {
					arr[o + 3] = Math.max(0, a0 - dab.pig * 3 * fall);
				} else {
					const da = dab.pig * fall * (1 + dab.edge * 2.4 * f * f * edgeK);
					const a1 = Math.min(1.6, a0 + da);
					if (a0 < 1e-4) {
						arr[o] = Math.exp(dab.lr);
						arr[o + 1] = Math.exp(dab.lg);
						arr[o + 2] = Math.exp(dab.lb);
					} else {
						const wt = da / (a0 + da);
						arr[o] = Math.exp((1 - wt) * Math.log(Math.max(arr[o], 1e-3)) + wt * dab.lr);
						arr[o + 1] = Math.exp((1 - wt) * Math.log(Math.max(arr[o + 1], 1e-3)) + wt * dab.lg);
						arr[o + 2] = Math.exp((1 - wt) * Math.log(Math.max(arr[o + 2], 1e-3)) + wt * dab.lb);
					}
					arr[o + 3] = a1;
					this._painted = true;
				}
				dab.ptr++;
				dirty = true;
			}
			if (dab.ptr >= dab.n || age > dab.wetT * 1.25) ds.splice(q, 1);
		}
		if (dirty) attr.needsUpdate = true;
	}
}
