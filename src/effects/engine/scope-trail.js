import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { scopeFrag } from '../shaders/glsl/scope-frag.js';

/** Эффекты «Осциллограф» (бегущая линия) и «Шлейф» (призрачные копии персонажа). Методы подмешиваются в EffectsEngine (см. engine/index.js). */
export class ScopeTrailPart {
	// ------------------------------------------------------------ осциллограф: перо бежит от точки к точке по координатам модели
	/** Строит путь пера: берёт часть точек и обходит их «ближайшим соседом», каждой точке облака даёт место на пути (aPath), а линию собирает из отрезков между соседями по пути. Остальные порядки: развёртка по высоте или по кругу */
	_scopeBuild(S, order, chaosV = 0.5) {
		const g = this.geometry;
		const T = g.attributes.aTarget.array;
		const N = g.attributes.position.count;
		const path = g.attributes.aPath;
		this._scopeDropLine();
		if (order !== 'walk') {
			let mn = Infinity, mx = -Infinity;
			for (let i = 0; i < N; i++) {
				const v = order === 'up' ? T[i * 3 + 1] : Math.atan2(T[i * 3 + 2], T[i * 3]);
				if (v < mn) mn = v;
				if (v > mx) mx = v;
			}
			const span = Math.max(mx - mn, 1e-6);
			for (let i = 0; i < N; i++) path.array[i] = ((order === 'up' ? T[i * 3 + 1] : Math.atan2(T[i * 3 + 2], T[i * 3])) - mn) / span;
			path.needsUpdate = true;
			return;
		}
		const sc = Math.max(8, Math.min(S, N));
		const ids = new Int32Array(sc);
		for (let i = 0; i < sc; i++) ids[i] = Math.floor((i * N) / sc);
		const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < sc; i++) for (let c = 0; c < 3; c++) {
			const v = T[ids[i] * 3 + c];
			if (v < mn[c]) mn[c] = v;
			if (v > mx[c]) mx[c] = v;
		}
		const ext = [0, 1, 2].map((c) => Math.max(mx[c] - mn[c], 0.03));
		const cell = Math.cbrt((ext[0] * ext[1] * ext[2]) / sc) * 1.7;
		const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
		const cx = (v, c) => Math.floor((v - mn[c]) / cell);
		const grid = new Map();
		for (let i = 0; i < sc; i++) {
			const p = ids[i] * 3;
			const k = key(cx(T[p], 0), cx(T[p + 1], 1), cx(T[p + 2], 2));
			const a = grid.get(k);
			if (a) a.push(i);
			else grid.set(k, [i]);
		}
		// обход вычёркивает посещённые точки из ячеек, поэтому для раздачи мест всем точкам облака оставляем целую копию
		const full = new Map();
		for (const [k, v] of grid) full.set(k, v.slice());
		const used = new Uint8Array(sc);
		const ord = new Int32Array(sc);
		const d2 = (i, p) => (T[ids[i] * 3] - p[0]) ** 2 + (T[ids[i] * 3 + 1] - p[1]) ** 2 + (T[ids[i] * 3 + 2] - p[2]) ** 2;
		// «хаос»: путь режется на штрихи, каждый штрих стартует в случайном месте и идёт по ближайшим точкам, с лёгкой случайностью в выборе шага
		let seed = 1234567;
		const rnd = () => {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const chaos = Math.max(0, Math.min(1, chaosV));
		const strokes = 1 + Math.round(chaos * chaos * 120);
		const strokeLen = Math.max(6, Math.ceil(sc / strokes));
		const rem = new Int32Array(sc);
		const posIn = new Int32Array(sc);
		for (let i = 0; i < sc; i++) rem[i] = posIn[i] = i;
		let remN = sc;
		const take = (j) => {
			const pj = posIn[j];
			const last = rem[--remN];
			rem[pj] = last;
			posIn[last] = pj;
			used[j] = 1;
		};
		const brk = new Uint8Array(sc + 1);
		let n = 0;
		while (n < sc) {
			if (n > 0) brk[n] = 1;
			let cur = 0;
			if (n === 0 && strokes === 1) {
				for (let i = 1; i < sc; i++) if (T[ids[i] * 3 + 1] < T[ids[cur] * 3 + 1]) cur = i;
			} else cur = rem[Math.floor(rnd() * remN)];
			take(cur);
			ord[n++] = cur;
			let prev = null;
			let left = strokeLen - 1;
			while (left > 0 && n < sc) {
				const p = [T[ids[cur] * 3], T[ids[cur] * 3 + 1], T[ids[cur] * 3 + 2]];
				const bx = cx(p[0], 0), by = cx(p[1], 1), bz = cx(p[2], 2);
				const cand = [];
				for (let r = 0; r <= 5 && cand.length < 3; r++) {
					for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
						if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
						const a = grid.get(key(bx + dx, by + dy, bz + dz));
						if (!a) continue;
						for (let q = a.length - 1; q >= 0; q--) {
							const j = a[q];
							if (used[j]) {
								a[q] = a[a.length - 1];
								a.pop();
								continue;
							}
							let d = d2(j, p);
							if (prev) d *= 1.25 - 0.25 * Math.max(-1, Math.min(1, ((T[ids[j] * 3] - p[0]) * prev[0] + (T[ids[j] * 3 + 1] - p[1]) * prev[1] + (T[ids[j] * 3 + 2] - p[2]) * prev[2]) / (Math.sqrt(d2(j, p)) * prev[3] + 1e-9)));
							cand.push([d, j]);
						}
					}
				}
				if (!cand.length) break;
				cand.sort((x, y) => x[0] - y[0]);
				// чем больше хаос, тем чаще перо выбирает не самую близкую из трёх ближайших
				let pick = 0;
				if (cand.length > 1 && rnd() < chaos * 0.75) pick = 1 + (cand.length > 2 && rnd() < 0.4 ? 1 : 0);
				const best = cand[pick][1];
				prev = [T[ids[best] * 3] - p[0], T[ids[best] * 3 + 1] - p[1], T[ids[best] * 3 + 2] - p[2], 0];
				prev[3] = Math.hypot(prev[0], prev[1], prev[2]);
				take(best);
				ord[n++] = best;
				cur = best;
				left--;
			}
		}
		const rank = new Int32Array(sc);
		for (let n = 0; n < sc; n++) rank[ord[n]] = n;
		const cut2 = (cell * 1.4) ** 2;
		for (let i = 0; i < N; i++) {
			const x = T[i * 3], y = T[i * 3 + 1], z = T[i * 3 + 2];
			const bx = cx(x, 0), by = cx(y, 1), bz = cx(z, 2);
			let best = -1, bd = Infinity;
			for (let r = 0; r <= 3 && best < 0; r++) {
				for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
					if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
					const a = full.get(key(bx + dx, by + dy, bz + dz));
					if (!a) continue;
					for (const j of a) {
						const d = (T[ids[j] * 3] - x) ** 2 + (T[ids[j] * 3 + 1] - y) ** 2 + (T[ids[j] * 3 + 2] - z) ** 2;
						if (d < bd) {
							bd = d;
							best = j;
						}
					}
				}
			}
			if (best < 0) {
				path.array[i] = 0;
				continue;
			}
			// между двумя соседними точками пути место считаем плавно, иначе проявление идёт квадратиками по ячейкам
			const rk = rank[best];
			const P = (j) => ids[ord[j]] * 3;
			let bt = 0, bj = -1;
			for (const nj of [rk - 1, rk + 1]) {
				if (nj < 0 || nj >= sc || brk[Math.max(rk, nj)]) continue;
				const p0 = ids[best] * 3, p1 = P(nj);
				const ex = T[p1] - T[p0], ey = T[p1 + 1] - T[p0 + 1], ez = T[p1 + 2] - T[p0 + 2];
				const l2 = ex * ex + ey * ey + ez * ez;
				if (l2 < 1e-12 || l2 > cut2) continue;
				const t = ((x - T[p0]) * ex + (y - T[p0 + 1]) * ey + (z - T[p0 + 2]) * ez) / l2;
				if (t > bt) {
					bt = Math.min(t, 1);
					bj = nj;
				}
			}
			path.array[i] = (rk + (bj < 0 ? 0 : (bj - rk) * bt)) / (sc - 1);
		}
		path.needsUpdate = true;
		// линия: четырёхугольник на каждый отрезок между соседями по пути; её концы идут через те же эффекты, что и сами точки
		const L = sc - 1;
		const V = L * 4;
		const O = g.attributes.aOrigin.array;
		const D = g.attributes.aDepth.array;
		const A = new Float32Array(V * 3), TA = new Float32Array(V * 3), B = new Float32Array(V * 3), TB = new Float32Array(V * 3);
		const ia = new Float32Array(V), ib = new Float32Array(V), da = new Float32Array(V), db = new Float32Array(V), end = new Float32Array(V), side = new Float32Array(V), seg = new Float32Array(V);
		const index = new Uint32Array(L * 6);
		const cut = cell * 1.4;
		for (let l = 0; l < L; l++) {
			const a = ids[ord[l]], b = ids[ord[l + 1]];
			const far = brk[l + 1] === 1 || Math.hypot(T[a * 3] - T[b * 3], T[a * 3 + 1] - T[b * 3 + 1], T[a * 3 + 2] - T[b * 3 + 2]) > cut;
			index.set([l * 4, l * 4 + 1, l * 4 + 2, l * 4 + 2, l * 4 + 1, l * 4 + 3], l * 6);
			for (let v = 0; v < 4; v++) {
				const q = l * 4 + v;
				for (let c = 0; c < 3; c++) {
					A[q * 3 + c] = O[a * 3 + c];
					TA[q * 3 + c] = T[a * 3 + c];
					B[q * 3 + c] = O[b * 3 + c];
					TB[q * 3 + c] = T[b * 3 + c];
				}
				ia[q] = a / N;
				ib[q] = b / N;
				da[q] = D[a];
				db[q] = D[b];
				end[q] = v >> 1;
				side[q] = v & 1 ? 1 : -1;
				seg[q] = far ? -1 : l / L;
			}
		}
		const lg = new THREE.BufferGeometry();
		lg.setAttribute('position', new THREE.BufferAttribute(A.slice(), 3));
		lg.setAttribute('aOrigin', new THREE.BufferAttribute(A, 3));
		lg.setAttribute('aTarget', new THREE.BufferAttribute(TA, 3));
		lg.setAttribute('aOriginB', new THREE.BufferAttribute(B, 3));
		lg.setAttribute('aTargetB', new THREE.BufferAttribute(TB, 3));
		lg.setAttribute('aIdx', new THREE.BufferAttribute(ia, 1));
		lg.setAttribute('aIdxB', new THREE.BufferAttribute(ib, 1));
		lg.setAttribute('aDepth', new THREE.BufferAttribute(da, 1));
		lg.setAttribute('aDepthB', new THREE.BufferAttribute(db, 1));
		lg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
		lg.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
		lg.setAttribute('aSeg', new THREE.BufferAttribute(seg, 1));
		lg.setIndex(new THREE.BufferAttribute(index, 1));
		const mat = new THREE.ShaderMaterial({ vertexShader: this._fxSource('scope', this._fxCur || (this._fxCur = new Set())), userData: { fxKind: 'scope' }, fragmentShader: scopeFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { ...this.shared, uTOff: { value: 0 } } });
		const line = new THREE.Mesh(lg, mat);
		line.frustumCulled = false;
		line.userData.helper = true;
		this.points.add(line);
		this._scopeLine = line;
		this._scopePath = { ids, ord, L };
	}

	/** Анимированный персонаж: концы отрезков линии берут текущие положения своих точек, и линия идёт по телу в любой позе */
	_scopeSyncLine() {
		const sp = this._scopePath;
		const lg = this._scopeLine?.geometry;
		if (!sp || !lg || !this.geometry || !lg.attributes.aOrigin) return;
		const T = this.geometry.attributes.aTarget.array;
		const { ids, ord, L } = sp;
		const a0 = lg.attributes.aOrigin.array;
		const a1 = lg.attributes.aTarget.array;
		const a2 = lg.attributes.aOriginB.array;
		const a3 = lg.attributes.aTargetB.array;
		for (let l = 0; l < L; l++) {
			const a = ids[ord[l]] * 3, b = ids[ord[l + 1]] * 3;
			const ta0 = T[a], ta1 = T[a + 1], ta2 = T[a + 2];
			const tb0 = T[b], tb1 = T[b + 1], tb2 = T[b + 2];
			for (let v = 0; v < 4; v++) {
				const q = (l * 4 + v) * 3;
				a0[q] = a1[q] = ta0;
				a0[q + 1] = a1[q + 1] = ta1;
				a0[q + 2] = a1[q + 2] = ta2;
				a2[q] = a3[q] = tb0;
				a2[q + 1] = a3[q + 1] = tb1;
				a2[q + 2] = a3[q + 2] = tb2;
			}
		}
		lg.attributes.aOrigin.needsUpdate = true;
		lg.attributes.aTarget.needsUpdate = true;
		lg.attributes.aOriginB.needsUpdate = true;
		lg.attributes.aTargetB.needsUpdate = true;
	}

	_scopeDropLine() {
		const l = this._scopeLine;
		if (!l) return;
		l.parent?.remove(l);
		l.geometry.dispose();
		l.material.dispose();
		this._scopeLine = null;
	}

	_scopeTick(dt, S, u) {
		const amount = clamp(this._eff(S), 0, 1);
		if (amount <= 0.001 || !this.geometry || !this.points || !this.geometry.attributes.aPath) {
			u.uScope.value.set(0, 0, 0, 1);
			if (this._scopeLine) this._scopeLine.visible = false;
			this._scopeT = 0;
			return;
		}
		const order = S.order || 'walk';
		const gk = this.geometry.uuid + ':' + order + ':' + (order === 'walk' ? Math.round(S.detail) + '/' + Math.round(S.chaos * 20) : 0);
		const lost = this._scopeLine && this._scopeLine.parent !== this.points;
		if (this._scopeKey !== gk || lost) {
			// пока двигают ползунок, путь пересчитывается не чаще раза в четверть секунды
			const sameGeo = this._scopeKey && this._scopeKey.split(':')[0] === this.geometry.uuid;
			if (!sameGeo || lost || !this._scopeWait || performance.now() - this._scopeWait > 250) {
				this._scopeKey = gk;
				this._scopeWait = performance.now();
				if (lost) this._scopeLine = null;
				this._scopeBuild(Math.round(S.detail), order, S.chaos);
			}
		}
		if (this._animCloud && this._scopeLine && this._scopeAnimVer !== this._animVer) {
			this._scopeAnimVer = this._animVer;
			this._scopeSyncLine();
		}
		this._scopeT = (this._scopeT || 0) + dt * S.speed * 0.07;
		// круг: 0..0.5 перо рисует, до 0.6 готовая форма держится, затем перо идёт по ней вторым проходом и стирает; «Остаётся» замирает на готовой форме
		const once = S.loop === 'once';
		const c = once ? Math.min(this._scopeT, 0.55) : this._scopeT % 1;
		const head = Math.min(c / 0.5, 1.05);
		const env = Math.min(1, c / 0.03);
		const out = once ? 0 : Math.max(0, (c - 0.6) / 0.4) * 1.02;
		const comet = S.mode === 'comet';
		u.uScope.value.set(amount, (comet ? 1 : 0) + (S.dir === 'back' ? 2 : 0), head, S.trail);
		u.uScopeP.value.set(S.dim, env, out, S.pens);
		u.uScopeQ.value.set(S.tint, S.thick, S.glow, S.spark);
		if (S.color === 'auto' || !S.color) u.uScopeC.value.copy(u.uP2.value);
		else u.uScopeC.value.set(S.color);
		u.uScopeW.value = S.width;
		u.uScopeLB.value = S.line;
		const L = this._scopeLine;
		if (L) L.visible = this._gate('scope', order === 'walk' && S.line > 0.01 && !(u.uFr.value.x > 0.5));
	}

	get animReady() {
		return !!this._animCloud;
	}

	/** Шлейф персонажа: копии прошлых поз остаются на месте и гаснут. Снимки берутся из уже посчитанных положений точек, поэтому это почти бесплатно */
	_trailTick(T) {
		const ac = this._animCloud;
		const tr0 = this._trail;
		const hide = () => {
			if (tr0) tr0.group.visible = false;
		};
		if (!T.on || !ac || !this.geometry || !this.points || !this._animBuf || this.state.source !== 'model') return hide();
		const amount = clamp(this._eff(T), 0, 1);
		if (amount < 0.005) return hide();
		const m0 = Math.max(1000, Math.min(Math.round(T.pts), ac.count));
		const stride = Math.max(1, Math.floor(ac.count / m0));
		const mm = Math.floor(ac.count / stride);
		const n = Math.max(2, Math.round(T.count));
		let tr = this._trail;
		if (!tr || tr.group.parent !== this.points || tr.mm !== mm || tr.n !== n || tr.geo !== this.geometry) {
			if (tr) {
				tr.group.removeFromParent();
				tr.group.traverse((o) => {
					if (o.material) o.material.dispose();
					if (o.geometry) o.geometry.dispose();
				});
			}
			const col = new Float32Array(mm * 3);
			const ca = this.geometry.attributes.aColor.array;
			for (let i = 0; i < mm; i++) for (let c = 0; c < 3; c++) col[i * 3 + c] = ca[i * stride * 3 + c];
			const colAttr = new THREE.BufferAttribute(col, 3);
			const group = new THREE.Group();
			group.userData.helper = true;
			const snaps = [];
			const ghosts = [];
			const cur = new Float32Array(mm * 3);
			for (let i = 0; i < mm; i++) for (let c = 0; c < 3; c++) cur[i * 3 + c] = this._animBuf[i * stride * 3 + c];
			for (let k = 0; k <= n; k++) snaps.push(cur.slice());
			for (let k = 0; k < n; k++) {
				const g = new THREE.BufferGeometry();
				g.setAttribute('position', new THREE.BufferAttribute(snaps[k + 1], 3));
				g.setAttribute('color', colAttr);
				const mat = new THREE.ShaderMaterial({
					uniforms: { uSize: { value: 1 }, uAlpha: { value: 0 }, uTint: { value: 0 }, uTintC: { value: new THREE.Color() } },
					vertexShader: 'attribute vec3 color; uniform float uSize; uniform float uTint; uniform vec3 uTintC; varying vec3 vC; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uSize * 3.8 / max(-mv.z, 0.4), 1.0, 60.0); vC = mix(color, uTintC, uTint); }',
					fragmentShader: 'precision highp float; uniform float uAlpha; varying vec3 vC; void main() {\n if (length(gl_PointCoord - 0.5) > 0.5) discard;\n  gl_FragColor = vec4(vC, uAlpha);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
					transparent: true,
					depthWrite: false,
					blending: THREE.NormalBlending,
				});
				const p = new THREE.Points(g, mat);
				p.renderOrder = -1;
				p.frustumCulled = false;
				p.userData.helper = true;
				group.add(p);
				ghosts.push(p);
			}
			this.points.add(group);
			tr = this._trail = { group, snaps, ghosts, mm, n, stride, last: this._time, geo: this.geometry };
		}
		tr.group.visible = true;
		// новый снимок раз в «шаг» времени, пока идёт анимация; остановили анимацию, шлейф замирает
		if (this.app.anim.playing && this._time - tr.last >= T.step) {
			tr.last = this._time;
			const old = tr.snaps.pop();
			for (let i = 0; i < mm; i++) for (let c = 0; c < 3; c++) old[i * 3 + c] = this._animBuf[i * tr.stride * 3 + c];
			tr.snaps.unshift(old);
			tr.ghosts.forEach((p, k) => {
				const a = p.geometry.attributes.position;
				a.array = tr.snaps[k + 1];
				a.needsUpdate = true;
			});
		}
		const u = this.shared;
		const base = u.uSize.value * u.uPR.value * T.size;
		tr.ghosts.forEach((p, k) => {
			const mt = p.material.uniforms;
			mt.uAlpha.value = amount * Math.pow(T.fade, k + 1) * 0.75;
			mt.uSize.value = base * (1 - T.shrink * (k / Math.max(1, n - 1)));
			mt.uTint.value = T.tint;
			mt.uTintC.value.copy(u.uP2.value);
		});
	}
}
