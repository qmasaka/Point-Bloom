import * as THREE from 'three';
import { evalAnimPoints } from '../../animation/anim-controller.js';
import { perf } from '../../core/perf.js';
import { clamp } from '../../core/util.js';
import { HandTracker } from '../input/hand-tracker.js';
import { GLYPH_SETS, glyphAtlas } from '../render/webgl/textures.js';
import { COLOR_BY, FX_PALETTES, MASK_MODES, MORPH_EASES, MORPH_SORTS, MORPH_STYLES } from '../state/options.js';

export class LoopPart {
	_pieceUpdate(P) {
		const g = this.geometry;
		if (!g || !this.pieceTex) return;
		P = Math.max(2, Math.min(256, Math.round(P)));
		const key = P + ':' + g.attributes.position.count + ':' + this._animVer + ':' + this.cloudKey + ':' + (this.morphing ? this._time.toFixed(1) : 0);
		if (key === this._pieceKey) return;
		this._pieceKey = key;
		const a = g.attributes.aTarget.array;
		const n = g.attributes.position.count;
		const d = this.pieceTex.image.data;
		for (let p = 0; p < P; p++) {
			const s0 = Math.floor((p * n) / P), e0 = Math.max(s0 + 1, Math.floor(((p + 1) * n) / P));
			let x = 0, y = 0, z = 0;
			for (let i = s0; i < e0; i++) {
				x += a[i * 3];
				y += a[i * 3 + 1];
				z += a[i * 3 + 2];
			}
			const c = e0 - s0;
			d[p * 4] = x / c;
			d[p * 4 + 1] = y / c;
			d[p * 4 + 2] = z / c;
			d[p * 4 + 3] = 1;
		}
		this.pieceTex.needsUpdate = true;
	}

	_loop() {
		const tick = (now) => {
			if (!this.active) return;
			this._raf = requestAnimationFrame(tick);
			if (document.hidden) {
				this._lastT = now;
				return;
			}
			const off = this._recOff;
			if (off && off.busy) {
				this._lastT = now;
				return;
			}
			const capFps = this.app.settings.render.fpsCap || (perf.windows ? 60 : 0);
			if (!off && capFps && now - this._lastT < 1000 / capFps - 2) return;
			const dt = this.frozen ? 0 : off ? 1 / off.fps : Math.min(0.1, (now - this._lastT) / 1000);
			this._lastT = now;
			this._lastDt = dt;
			const st0 = this.state;
			this._time += dt;
			this._framesTick();
			this._syncPaintLock();
			if (this.animPlaying) {
				try {
					this._animStep(dt);
				} catch (e) {
					this.animPlaying = false;
					this.animRec = false;
					this.app.toast('Анимация остановлена: ' + (e.message || e), 'error');
				}
			}
			this._analyse(dt);
			if (!this.material) return;
			if (this.morphing && !this._morphHold) {
				this.morph = Math.min(1, this.morph + dt / Math.max(0.3, st0.morphCfg.time));
				if (this.morph >= 1) {
					this.morphing = false;
					this._animCloud = this._animIn || null;
					this._animIn = this._animOut = null;
					this._animVer = -1;
					this._settleOn = false;
					this._settleT = this._time;
				}
			}
			const st = this.state;
			if (this.points && st.look.autoRotate) {
				this.points.rotation.y += dt * st.look.rotSpeed;
				this.points.updateMatrixWorld();
			}
			const u = this.shared;
			const L = st.layers;
			const look = st.look;
			const pal = FX_PALETTES.find((p) => p.id === look.palette) || FX_PALETTES[0];
			if (this.backend) this.backend.setTint(new THREE.Color(pal.c[0]));
			u.uTime.value = this._time;
			{
				const m = this.morphing ? this.morph : 1;
				const sm = (a, b, x) => {
					const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
					return t * t * (3 - 2 * t);
				};
				this._fxGate = m >= 1 ? 1 : m < 0.5 ? 1 - sm(0, 0.2, m) : sm(0.6, 1, m);
				if (this._settleOn) {
					const p = (this._time - this._settleT) / 1.2;
					u.uSettle.value = p >= 1 ? -1 : p;
					if (p >= 1) this._settleOn = false;
				}
			}
			u.uMorph.value = this.morph;
			{
				const ms = this._mtStyle;
				const mcf = ms ? { ...st.morphCfg, style: MORPH_STYLES[ms.idx].id, scatter: ms.scatter, stagger: ms.stagger, turns: ms.turns, sort: ms.sort, ease: ms.ease, glow: ms.glow } : st.morphCfg;
				u.uMorphS.value.set(Math.max(0, MORPH_STYLES.findIndex((x) => x.id === mcf.style)), mcf.scatter, mcf.stagger, mcf.turns);
				u.uMorphO.value.set(Math.max(0, MORPH_SORTS.findIndex((x) => x[0] === mcf.sort)), Math.max(0, MORPH_EASES.findIndex((x) => x[0] === mcf.ease)), mcf.glow, (this.playlist?.length || 0) > 1 || this.morphing ? 1 : 0);
				u.uMorphD.value.set(this._mm?.out ? 1 : 0, this._mm?.in ? 1 : 0, Math.round(mcf.spin || 0), mcf.fsize ?? 1);
			}
			const pset = this.app.settings.point;
			u.uSize.value = pset.size;
			u.uShape.value = this._eff(L.voxel) > 0.25 ? 0 : Math.max(0, ['square', 'circle', 'sphere', 'ring', 'diamond', 'plus'].indexOf(pset.shape));
			u.uSolid.value.set(pset.solidColor);
			u.uAtt.value = pset.attenuate ? Math.max(0.05, this.app.nav.distance || 5) : 0;
			u.uPR.value = this.app.viewport.renderer.getPixelRatio();
			u.uBeat.value = this.levels.beat;
			{
				const cam = this.app.viewport.camera;
				const n = this.geometry.attributes.position.count;
				let fit = 1;
				if (cam.isPerspectiveCamera) {
					const pr = u.uPR.value;
					const d = Math.max(0.5, cam.position.length());
					const ppu = (this.app.viewport.size.height * pr) / (2 * d * Math.tan((cam.fov * Math.PI) / 360));
					const sPx = Math.min(95, (this.app.settings.point.size * pr * 3.8) / d);
					const overlap = (n * sPx * sPx) / (Math.PI * (1.1 * ppu) ** 2);
					fit = clamp(Math.sqrt(3.5 / Math.max(overlap, 1e-3)), 0.25, 1);
				}
				u.uDens.value = Math.min(1.6, Math.sqrt(150000 / Math.max(1, n))) * fit;
			}
			const sb = (this._sceneBand ||= { band: 'bass' });
			sb.band = look.audioBand || 'bass';
			const bloomK = this._animBloom || 0;
			u.uBright.value = look.bright * (1 + (look.brightAudio || 0) * this._bandLevel(sb) * 1.8) * (1 + bloomK * 0.8);
			u.uGlow.value = look.glow + bloomK * 1.5;
			u.uColorBy.value = Math.max(0, COLOR_BY.findIndex((c) => c.id === look.colorBy));
			u.uP0.value.set(pal.c[0]);
			u.uP1.value.set(pal.c[1]);
			u.uP2.value.set(pal.c[2]);
			const add = look.blend === 'add';
			u.uAdd.value = add ? 1 : 0;
			const bl = add ? THREE.AdditiveBlending : THREE.NormalBlending;
			if (this.material.blending !== bl && this._gate(add ? 'vert|add' : 'vert|norm', true)) {
				for (const m of [this.material, ...this.ghosts.map((g) => g.material), ...(this.hero ? [this.hero.material] : [])]) {
					m.blending = bl;
					m.transparent = add;
					m.depthWrite = !add;
					m.needsUpdate = true;
				}
			}
			if (this._tb === undefined) this._tb = -9;
			if (!this.playing && this._time - this._tb > (L.blast.period || 1.6)) this._markBeat();
			const curlSurf = L.curl.mode === 'surface';
			u.uCurl.value.set(curlSurf ? 0 : this._eff(L.curl), L.curl.scale, 0, 0);
			u.uCurlP.value.set(L.curl.speed, L.curl.flow, { stream: 1, orbit: 2 }[L.curl.mode] ?? 0, 0);
			u.uSpec.value.set(this._eff(L.spectrum), { wool: 0, height: 1, bars: 2, terrain: 3 }[L.spectrum.mode] ?? 0, 0, 0);
			u.uSpecP.value.set(0, L.spectrum.bars, 0, 0);
			u.uWave.value.set(this._eff(L.wave), L.wave.freq, 0, 0);
			{
				const W = L.wave;
				const wm = { rings: 0, drops: 1, plane: 2, spiral: 3, rise: 4 }[W.mode] ?? 0;
				const useBeat = W.band !== 'none' && this.playing;
				if (this._wdT === undefined) this._wdT = -9;
				if (!this._wdSrc) this._wdSrc = new THREE.Vector3();
				if (!useBeat && this._time - this._wdT > (W.period || 1.4)) {
					this._wdT = this._time;
					const gg = this.geometry;
					if (gg) {
						const ta = gg.attributes.aTarget.array;
						const ii = Math.floor(Math.random() * (ta.length / 3)) * 3;
						this._wdSrc.set(ta[ii], ta[ii + 1], ta[ii + 2]);
					}
				}
				const sw = useBeat ? (this._waveSrc ||= new THREE.Vector3()) : this._wdSrc;
				const src = wm === 0 && W.origin === 'cursor' && this.mouseOn ? this.mouse : wm === 1 ? sw : new THREE.Vector3();
				u.uWaveSrc.value.set(src.x, src.y, src.z, W.dir);
				u.uWaveP.value.set(W.speed, wm, W.decay, useBeat ? this._tb : this._wdT);
			}
			u.uTwist.value.set(L.twist.mode === 'jelly' ? 0 : this._eff(L.twist), { twist: 0, bend: 1, taper: 2, snake: 3, breathe: 4 }[L.twist.mode] ?? 0, L.twist.speed, 0);
			{
				const B = L.blast;
				const bs = B.style || 'burst';
				const P = bs === 'burst' ? { on: false, amount: 0, mode: 'shell', delay: 0.35, speed: 1 } : { on: B.on, amount: B.amount, band: B.band, react: B.react, amode: B.amode, mode: bs, delay: B.delay ?? 0.35, speed: B.pspeed ?? 1 };
				const pm = { flat: 0, shell: 1, squash: 2 }[P.mode] ?? 1;
				u.uPulse.value.set(pm === 0 ? (bs === 'burst' ? this._eff(P) : this._eff(B)) : P.on ? P.amount : 0, 0, 0, 0);
				u.uPulseP.value.set(pm, P.delay, this._tb, P.speed);
			}
			u.uBlast.value.set(L.blast.on && (L.blast.style || 'burst') === 'burst' ? this._eff(L.blast) : 0, L.blast.decay, L.blast.random, this._tb);
			if (curlSurf) u.uFlow.value.set(this._eff(L.curl), L.curl.fscale, L.curl.speed, L.curl.fdir);
			else u.uFlow.value.set(this._eff(L.flow), L.flow.scale, L.flow.speed, L.flow.dir);
			u.uVoxel.value.set(clamp(this._eff(L.voxel), 0, 1), 0, 0, 0);
			u.uVoxelP.value.set({ grid: 0, lego: 1, breathe: 2, wave: 3, stairs: 4, scatter: 5 }[L.voxel.mode] ?? 0, L.voxel.speed, L.voxel.size ?? 1, L.voxel.height ?? 1);
			u.uJitter.value.set(this._eff(L.jitter), 0, 0, 0);
			{
				const X = L.explode;
				const xe = this._eff(X);
				let p = 0;
				if (X.on && xe > 0.001) {
					if (X.mode === 'loop') {
						this._exT = (this._exT || 0) + dt * X.speed * 0.25;
						const c = (this._exT % 2) / 2;
						const x = c < 0.35 ? c / 0.35 : c < 0.6 ? 1 : 1 - (c - 0.6) / 0.4;
						p = x * x * (3 - 2 * x);
					} else p = 1;
					this._pieceUpdate(X.pieces);
				}
				u.uExp.value.set(p, Math.max(2, Math.min(256, X.pieces)), X.stagger, X.spin);
				u.uExpP.value.set(xe * X.dist * 0.9, 0, 0, 0);
			}
			{
				const J = L.twist;
				const jOn = J.on && J.mode === 'jelly';
				const je = jOn ? this._eff(J) : 0;
				const ks = (this._jk ||= []);
				const addKick = (origin, dir) => {
					ks.unshift({ t0: this._time, o: origin.clone(), d: dir.clone() });
					ks.length = Math.min(ks.length, 3);
				};
				if (jOn && je > 0.001) {
					if (J.jmode === 'auto') {
						if (this._time - (this._jkT ?? -9) > J.jperiod && this.geometry) {
							this._jkT = this._time;
							const ta = this.geometry.attributes.aTarget.array;
							const ii = Math.floor(Math.random() * (ta.length / 3)) * 3;
							const o = new THREE.Vector3(ta[ii], ta[ii + 1], ta[ii + 2]);
							const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
							addKick(o, d);
						}
					} else if (this._animCloud) {
						const cn = u.uCen.value;
						if (!this._jc) {
							this._jc = cn.clone();
							this._jv = new THREE.Vector3();
						}
						const vel = cn.clone().sub(this._jc).divideScalar(Math.max(dt, 1e-3));
						const acc = vel.clone().sub(this._jv);
						this._jc.copy(cn);
						this._jv.copy(vel);
						const am = acc.length();
						if (am > 3.5 && this._time - (this._jkT ?? -9) > 0.15) {
							this._jkT = this._time;
							addKick(cn, acc.clone().multiplyScalar(-1 / am).multiplyScalar(Math.min(1, am / 16)));
						}
					}
				}
				for (let i = 0; i < 3; i++) {
					const k2 = ks[i];
					if (k2) {
						u.uJel.value[i].set(k2.d.x, k2.d.y, k2.d.z, k2.t0);
						u.uJelO.value[i].set(k2.o.x, k2.o.y, k2.o.z, 0);
					} else u.uJel.value[i].set(0, 0, 0, -99);
				}
				u.uJelP.value.set(J.jfreq, J.jdamp, jOn ? Math.min(1.5, je) : 0, J.jsquash);
			}
			{
				this._scopeTick(dt, L.scope, u);
			}
			u.uFlat.value = st.source === 'media' || u.uFr.value.x > 0.5 ? 1 : 0;
			if (this._yrBase) {
				if (u.uFr.value.x > 0.5) {
					const hh = u.uFr3.value.y > 0.5 && u.uFr3.value.y < 1.5 ? 1.25 : Math.max(0.3, u.uFr2.value.w * 0.5);
					u.uYR.value.set(-hh, hh);
				} else u.uYR.value.set(this._yrBase[0], this._yrBase[1]);
			}
			{
				const Dp = L.depth;
				const onFr = st.source === 'frames' && this._framesOn && u.uFr.value.x > 0.5;
				const on = Dp.on && ((st.source === 'media' && this.pm.ready) || onFr);
				u.uDepth.value.set(on ? clamp(this._eff(Dp), 0, 1.5) : 0, { relief: 0, layers: 1, breath: 2 }[Dp.mode] ?? 0, Dp.speed, Dp.focus);
				if (onFr) u.uDepthQ.value.set(Dp.zone ?? 0.12, Dp.bright ?? 0, Dp.contrast ?? 1, Dp.gamma ?? 1);
				else u.uDepthQ.value.set(Dp.zone ?? 0.12, 0, 1, 1);
				u.uDepthP.value.set(Dp.layers, Dp.dir === 'far' ? -1 : 1, Dp.sway, { photo: 0, map: 1, heat: 2 }[Dp.view] ?? 0);
			}
			this._screenTick(u);
			this._chladniTick(dt, L.chladni, u);
			this._shootTick(dt, L.shoots, u);
			this._shadowTick(dt, L.shadow, u);
			{
				const H = L.hyper;
				const he0 = this._eff(H);
				this._hypK = (this._hypK || 0) + (he0 - (this._hypK || 0)) * (1 - Math.exp(-dt * 4));
				const he = this._hypK > 0.002 || he0 > 0 ? this._hypK : 0;
				const w = (H.speed ?? 0.6) * 0.9;
				if (he > 0.001) this._hypA = ((this._hypA || 0) + dt * (w + (H.kick || 0) * this.levels.beat * 3)) % (Math.PI * 2000);
				else this._hypA = 0;
				u.uHyp.value.set(he, (this._hypA || 0) + ((H.phase || 0) * Math.PI) / 180, { evert: 0, hopf: 1, tumble: 2, breathe: 3 }[H.mode] ?? 1, H.curv ?? 1);
				u.uHypP.value.set(0, H.tint ?? 0.35, H.fade ?? 0.6, w);
			}
			u.uGlitch.value.set(this._eff(L.glitch), L.glitch.slices, L.glitch.drop ?? 0.5, 0);
			u.uGlitchP.value.set(L.glitch.rgb === 'on' ? 1 : 0, L.glitch.speed, { bands: 0, blocks: 1, scan: 2 }[L.glitch.mode] ?? 0, L.glitch.burst ?? 0.7);
			u.uDisP.value.set({ wind: 0, burn: 1, laser: 2, layers: 3, chunks: 4, sand: 5, vortex: 6, shock: 7 }[L.dissolve.style] ?? 0, 0, 0, 0);
			u.uCursor.value.set(this._eff(L.cursor), L.cursor.radius, { attract: -1, swirl: 2 }[L.cursor.mode] ?? 1, 0);

			{
				const P = L.physics;
				if (this.isCollapsed && P.on) {
					this.asm = 0;
					this.collapseTime += dt;
				} else if (this.collapseTime > 0) {
					this.asm = Math.min(1, this.asm + dt / Math.max(0.5, P.asm));
					if (this.asm >= 1) {
						this.asm = 0;
						this.collapseTime = 0;
					}
				}
				u.uPhysics.value.set(this.collapseTime > 0 ? Math.max(0.01, P.amount) : 0, P.gravity, P.bounce, P.wind);
				u.uPhysP.value.set(P.burst, P.peel, P.swirl, 0);
				u.uAsm.value = this.asm;
				u.uCollapseTime.value = this.collapseTime;
			}

			const brE = Math.max(L.brush ? this._eff(L.brush) : 0, this.camTracker?.running && this._time - (this._brushHand ?? -9) < 0.4 ? 1 : 0);
			const brArr = u.uBrushHits.value;
			for (let i = 0; i < 20; i++) {
				const hit = this.brushHits[i];
				const age = hit ? this._time - hit.t0 : -1;
				if (hit && age < (L.brush ? L.brush.dry : 3.5)) {
					brArr[i].set(hit.pos.x, hit.pos.y, hit.pos.z, age);
				} else {
					brArr[i].set(0, 0, 0, -1);
				}
			}
			u.uBrushParam.value.set(0, 0.4, 3.5, 1);
			this._paintTick();
			u.uPaintP.value.set(this._painted ? 1 : 0, L.brush.grain, L.brush.mode === 'glaze' ? 1 : 0, 0);

			const sl = L.slice;
			const nLines = Math.max(1, Math.round(sl.count || 1));
			const axVal = { y: 0, x: 1, z: 2, diag: 3 }[sl.axis] ?? 0;
			const smode = { laser: 0, relief: 1, cut: 2 }[sl.mode] ?? 0;
			let sph = (this._time * sl.speed * 0.25) % 1;
			if (sl.bounce === 'on') {
				const x = (this._time * sl.speed * 0.2) % 2;
				sph = x < 1 ? x : 2 - x;
			}
			if (smode === 2) sph = sph * 1.1 - 0.05;
			u.uSlice.value.set(this._eff(sl), sph, sl.width, axVal + nLines * 10);
			u.uSliceM.value.set(smode, sl.lift, sl.color === 'model' ? 1 : 0, 0);
			const hs = this._handSlice;
			if (hs && this.camTracker?.running && this._time - (this._handsT ?? -9) < 0.4) {
				const c = { y: hs.y, x: hs.x, z: hs.z, diag: (hs.x + hs.y) * 0.707 }[sl.axis] ?? hs.y;
				u.uSlice.value.set(1, clamp((c + 1.2) / 2.4, 0, 1), Math.max(0.03, sl.width), axVal + nLines * 10);
				u.uSliceM.value.set(2, sl.lift, sl.color === 'model' ? 1 : 0, 0);
			}
			u.uSliceC.value.set(sl.color && sl.color !== 'auto' && sl.color !== 'model' ? sl.color : pal.c[2]);

			u.uLookP2.value.set(0, 0, 0, 0);
			u.uShade.value = look.shade || 0;
			const gm = GLYPH_SETS[look.glyph] ? look.glyph : 'off';
			if (gm !== this._glyphMode) {
				this._glyphMode = gm;
				if (gm !== 'off') {
					u.uAtlas.value.dispose();
					u.uAtlas.value = glyphAtlas(gm);
				}
			}
			u.uGlyph.value.set(gm === 'off' ? 0 : 1, gm === 'off' ? 1 : 2.3, u.uAtlas.value.userData?.n || 8);
			u.uDof.value.set(look.dofOn ? 1 : 0, look.dofDist || 5.2, look.dofRange || 1.4, 0);

			if (this._mtActive && !(this.timelineOpen && this._morphChain(this.state.anim.clips || []).length)) this._releaseMorphTrack();
			else if (this.timelineOpen && !this.animPlaying && !this.morphing && this._morphChain(this.state.anim.clips || []).length) this._morphTrackApply(this.state.anim.clips, this.animT);
			if (!this.animPlaying && !this.animRec && (this.state.anim.clips?.length || (this.state.anim.saved && Object.keys(this.state.anim.saved).length))) this._animGate(this.animT);
			{
				const A = this.app.anim;
				if (this.animPlaying && A.has) {
					if (!this._charSync) {
						this._charSync = true;
						this._charWas = A.playing;
						A.playing = false;
					}
					A.syncTime(this.animT);
				} else if (this._charSync) {
					this._charSync = false;
					A.playing = this._charWas;
				}
			}
			if (this.morphing && this.geometry && this.app.anim.has && (this._animIn || this._animOut) && this._animVerM !== this.app.anim.version) {
				this._animVerM = this.app.anim.version;
				const g = this.geometry;
				const n = g.attributes.position.count;
				for (const [ac, attr] of [[this._animIn, 'aTarget'], [this._animOut, 'aOrigin']]) {
					if (!ac || ac.count !== n) continue;
					const key = attr === 'aTarget' ? '_mbIn' : '_mbOut';
					if (!this[key] || this[key].length !== n * 3) this[key] = new Float32Array(n * 3);
					evalAnimPoints(ac.anim, ac.norm, this[key], null);
					g.attributes[attr].array.set(this[key]);
					g.attributes[attr].needsUpdate = true;
				}
			}
			if (!this._animCloud && this.shared.uAnimN.value) this.shared.uAnimN.value = 0;
			if (this._animCloud && st.source === 'model' && this.geometry && !this.morphing && this.app.anim.has && this._animVer !== this.app.anim.version && performance.now() - (this._animT || 0) >= (perf.tier === 'high' ? 0 : 33)) {
				this._animVer = this.app.anim.version;
				this._animT = performance.now();
				const g = this.geometry;
				const ac = this._animCloud;
				if (g.attributes.position.count === ac.count) {
					if (!this._animBuf || this._animBuf.length !== ac.count * 3) {
						this._animBuf = new Float32Array(ac.count * 3);
						this._animBufN = new Float32Array(ac.count * 3);
					}
					evalAnimPoints(ac.anim, ac.norm, this._animBuf, ac.anim.bn ? this._animBufN : null);
					{
						const b = this._animBuf;
						let mn = Infinity, mx = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
						for (let i = 1; i < b.length; i += 3) {
							if (b[i] < mn) mn = b[i];
							if (b[i] > mx) mx = b[i];
							if (b[i - 1] < x0) x0 = b[i - 1];
							if (b[i - 1] > x1) x1 = b[i - 1];
							if (b[i + 1] < z0) z0 = b[i + 1];
							if (b[i + 1] > z1) z1 = b[i + 1];
						}
						this.shared.uCen.value.set((x0 + x1) / 2, (mn + mx) / 2, (z0 + z1) / 2);
						this._yrBase = [mn, mx];
						this.shared.uYR.value.set(mn, mx);
					}
					g.attributes.aTarget.array.set(this._animBuf);
					g.attributes.aOrigin.array.set(this._animBuf);
					g.attributes.position.array.set(this._animBuf);
					g.attributes.aTarget.needsUpdate = g.attributes.aOrigin.needsUpdate = g.attributes.position.needsUpdate = true;
					if (ac.anim.bn) {
						this.shared.uAnimN.value = 1;
						g.attributes.aNormal.array.set(this._animBufN);
						g.attributes.aNormalB.array.set(this._animBufN);
						g.attributes.aNormal.needsUpdate = g.attributes.aNormalB.needsUpdate = true;
					}
					if (L.links.on && (this._alk = ((this._alk || 0) + 1) % 4) === 0) this._syncLinks();
				}
			}
			if (this._linksStale && L.links.on) this._computeLinks();
		this._trailTick(L.trail);
			if (this._mm) this._mediaMorphTick(dt);
			let rgbNew = null;
			if (st.source === 'media' && this.pm.ready && this.geometry && !this.morphing && this.geometry.attributes.position.count === this.pm.count) {
				const rgb = this.pm.advance(dt);
				rgbNew = rgb;
				if (rgb) {
					const g = this.geometry;
					const n = this.pm.count;
					if (!this._zbuf || this._zbuf.length !== n * 3) this._zbuf = new Float32Array(n * 3);
					const m = this.app.settings.media;
					this.pm.applyTo({ positions: this._zbuf, colors: g.attributes.aColor.array, hide: g.attributes.aHide.array }, rgb, m.relief, m.depth);
					g.attributes.aHide.needsUpdate = true;
					const a = g.attributes.position.array, o = g.attributes.aOrigin.array, t = g.attributes.aTarget.array, z = this._zbuf;
					for (let i = 2; i < n * 3; i += 3) a[i] = o[i] = t[i] = z[i];
					g.attributes.aColorB.array.set(g.attributes.aColor.array);
					g.attributes.aColor.needsUpdate = g.attributes.aColorB.needsUpdate = true;
					g.attributes.position.needsUpdate = g.attributes.aOrigin.needsUpdate = g.attributes.aTarget.needsUpdate = true;
					if (L.links.on) this._syncLinks();
				}
			}
			if (st.source === 'media' && this.pm.ready && this.geometry && this.geometry.attributes.position.count === this.pm.count) this._depthTick(dt, rgbNew);
			this._slitTick(rgbNew, u);
			this._sortTick(rgbNew, u);
			{
				const mc = st.morphCfg;
				if (mc.mode === 'timer' && (this.playlist?.length || 0) > 1 && !this.morphing && this._time - (this._lastMorph || 0) > mc.interval) this.morphNext();
				this._morphMusicTick(dt);
			}
			{
				const D = L.dissolve;
				let p = 0;
				if (D.on) {
					if (D.mode === 'loop') {
						this._disT = (this._disT || 0) + dt * D.speed * 0.25;
						const split = D.dir === 'out' ? 0.7 : D.dir === 'in' ? 0.3 : 0.5;
						const c = (this._disT % 2) / 2;
						const x = c < split ? c / split : 1 - (c - split) / (1 - split);
						p = clamp((x - 0.12) / 0.76, 0, 1);
					} else if (D.mode === 'button') {
						const tg = this._disTarget ? 1 : 0;
						const v = this._disV || 0;
						this._disV = v + Math.sign(tg - v) * Math.min(Math.abs(tg - v), dt * D.speed * 0.3);
						p = this._disV;
					} else p = D.progress;
					p = p * p * (3 - 2 * p) * Math.min(1, D.band && D.band !== 'none' ? this._eff(D) : D.amount);
				}
				const hand = this.camTracker?.running && this._handDis && this._time - (this._handsT ?? -9) < 0.4;
				this._disH = (this._disH || 0) + ((hand ? 1 : 0) - (this._disH || 0)) * (1 - Math.exp(-dt * Math.max(0.5, D.speed) * 1.2));
				if (this._disH > 0.002) p = Math.max(p, this._disH * this._disH * (3 - 2 * this._disH));
				const sprout = D.on && D.style === 'sprout';
				if (sprout) {
					const cyc = Math.floor((this._disT || 0) / 2);
					if (cyc !== this._dsCyc && this.geometry) {
						this._dsCyc = cyc;
						const ta = this.geometry.attributes.aTarget.array;
						const ii = Math.floor(Math.random() * (ta.length / 3)) * 3;
						u.uGrowSeed.value.set(ta[ii], ta[ii + 1], ta[ii + 2]);
					}
					u.uGrow.value.set(1 - p, { bottom: 0, point: 1, center: 2 }[D.seed] ?? 0, D.tendril, D.edge);
					u.uGrowP.value.set(D.bud, 0.5, 1, 0);
				} else u.uGrowP.value.set(0, 0, 0, 0);
				u.uDis.value.set(sprout ? 0 : p, { top: 0, noise: 1, bottom: 2, side: 3, center: 4, edges: 5 }[D.order] ?? 0, D.fall, D.wind);
				u.uDisQ.value.set(D.edge ?? 0.32, D.scatter ?? 1, D.glow ?? 0.35, D.shrink ?? 0.85);
				u.uDisT.value = D.turb;
			}
			if (this._sculptLive && this.geometry && !(this._grabs && this._grabs.size)) {
				const el = L.camTrack.elastic;
				this._sculptAcc = (this._sculptAcc || 0) + dt;
				if (el > 0 && this._sculptAcc >= 0.05) {
					const arr = this.geometry.attributes.aSculpt.array;
					const k = Math.exp(-this._sculptAcc * el * 0.8);
					this._sculptAcc = 0;
					let mx = 0;
					for (let i = 0; i < arr.length; i++) {
						arr[i] *= k;
						const a = arr[i] < 0 ? -arr[i] : arr[i];
						if (a > mx) mx = a;
					}
					this.geometry.attributes.aSculpt.needsUpdate = true;
					if (mx < 5e-4) this.clearSculpt();
				}
			}
			{
				const g = L.gravity;
				const handG = this.camTracker?.running && this._handGrav && this._time - (this._handsT ?? -9) < 0.4;
				this._gravF = (this._gravF || 0) + ((handG ? 1 : 0) - (this._gravF || 0)) * (1 - Math.exp(-dt * 5));
				const ge = Math.max(this._eff(g), this._gravF * L.camTrack.amount);
				if (!this._gc) this._gc = new THREE.Vector3();
				const tgt = handG ? this._handGrav : g.target === 'cursor' && this.mouseOn ? this.mouse : new THREE.Vector3();
				this._gc.lerp(tgt, 1 - Math.exp(-dt * 8));
				this._gPrec = (this._gPrec || 0) + dt * g.precess * 1.2;
				const mode = { orbit: 0, hole: 1, float: 2, swarm: 3, rings: 4 }[g.mode] ?? 0;
				u.uDens.value /= 1 + Math.min(1, ge) * (mode === 0 || mode === 4 ? g.flatten * 5 : mode === 1 ? 2 : mode === 3 ? 0.8 : 0);
				u.uGrav.value.set(ge, mode, g.speed, g.flatten);
				u.uGravT.value.set(g.tilt + Math.sin(this._gPrec) * 0.18 * g.precess, this._gPrec * 0.6, g.spread, g.jet);
				u.uGravP.value.set(this._gc.x, this._gc.y, this._gc.z, g.target === 'center' && !handG ? 4 : g.radius);
			}
			const vsz = this.app.viewport.size;
			u.uRes.value.set(Math.max(1, vsz.width), Math.max(1, vsz.height));
			u.uLinkW.value = L.links.width;
			const lk = this._eff(L.links);
			if (this.linkObj) {
				this.linkObj.visible = this._gate('line', lk > 0.01);
				const pulseOn = L.links.pulses === 'on' ? 1 : 0;
				const pSpeed = L.links.pulseSpeed || 1.6;
				u.uLink.value.set(lk * 1.1, L.links.range * (1 + this.levels.beat * 0.4), pSpeed, pulseOn);
				const mMode = { classic: 0, neural: 1, constellation: 2, cyber: 3, elastic: 4 }[L.links.mode] ?? 0;
				const cMode = { palette: 0, tension: 1, neon: 2, rainbow: 3 }[L.links.colorMode] ?? 0;
				const beaconsOn = L.links.beacons === 'off' ? 0 : 1;
				if (u.uLinkP) u.uLinkP.value.set(mMode, cMode, beaconsOn, this.levels.beat);
			}
			const ec = this._eff(L.echo);
			const eo = L.echo;
			const nG = Math.round(eo.copies);
			const beatK = this.levels.beat;
			this.ghosts.forEach((g, i) => {
				const k = i + 1;
				g.visible = ec > 0.01 && k <= nG;
				if (!g.visible) return;
				g.material.uniforms.uTOff.value = eo.delay * k;
				g.material.uniforms.uGhost.value = ec * 0.55 * Math.pow(eo.fade, k);
				if (eo.mode === 'kaleido') {
					g.rotation.set(0, (Math.PI * 2 * k) / (nG + 1) + this._time * 0.15, 0);
					g.scale.set(k % 2 ? -1 : 1, 1, 1);
					g.position.set(0, 0, 0);
				} else if (eo.mode === 'spiral') {
					g.rotation.set(0, k * eo.spread * (1 + beatK * 0.25), 0);
					g.scale.setScalar(1 - 0.05 * k);
					g.position.set(0, k * 0.04 * Math.sin(this._time * 0.8), 0);
				} else {
					g.rotation.set(0, 0, 0);
					g.scale.setScalar(1 + 0.05 * k * (0.65 + 0.35 * Math.sin(this._time * 1.6 - k * 0.6)));
					g.position.set(0, 0, 0);
				}
			});
			const mk = st.mask;
			const mi = Math.max(0, MASK_MODES.findIndex((m) => m.id === mk.mode));
			const T = this._time * mk.speed;
			let a0 = 0, a1 = 0, a2 = 0;
			if (mi === 1) a0 = mk.speed > 0 ? clamp(1 - mk.size + 0.35 * Math.sin(T * 1.2), 0, 1) : 1 - mk.size;
			else if (mi === 4) a0 = mk.speed > 0 ? (T * 0.3) % 1 : 0.5;
			else if (mi === 2) {
				if (mk.speed > 0) {
					a0 = Math.cos(T) * 0.9;
					a1 = Math.sin(T * 0.7) * 0.6;
					a2 = Math.sin(T) * 0.9;
				} else {
					a0 = 0.55;
					a1 = 0.25;
					a2 = 0.4;
				}
			}
			u.uMask.value.set(mi, mk.size, mk.soft, mk.invert ? 1 : 0);
			u.uMaskA.value.set(a0, a1, a2, T * 0.5);
			u.uMaskShow.value = mk.show ? 1 : 0;
			u.uMouse.value.copy(this.mouse);
			u.uMouseOn.value = this.mouseOn ? 1 : 0;
			{
				const cfg = L.camTrack;
				const running = !!this.camTracker?.running;
				const fade = clamp(1 - (this._time - (this._handsT ?? -9)) / 0.35, 0, 1);
				const ptrs = running ? this._handPtrs || [] : [];
				const n = Math.min(12, ptrs.length);
				const arr = u.uHand.value;
				for (let i = 0; i < 12; i++) {
					if (i < n) arr[i].set(ptrs[i].local.x, ptrs[i].local.y, ptrs[i].local.z, ptrs[i].s * fade);
					else arr[i].set(0, 0, 0, 0);
				}
				const he = running && cfg.on ? cfg.amount * cfg.power : 0;
				u.uHandP.value.set(fade > 0 ? he : 0, cfg.radius, 0, n);
				const sp = this._spin;
				if (sp && running) {
					if (this._time - (this._grabbing ?? -9) > 0.15) {
						const k = Math.exp(-dt * (1 - cfg.inertia) * 8);
						sp.x *= k;
						sp.y *= k;
					}
					this.points.rotation.y += sp.y * dt;
					this.points.rotation.x += sp.x * dt;
				}
				const target = running ? this._stretchTarget || 1 : 1;
				const sc = this.points.scale.x;
				if (Math.abs(sc - target) > 0.002) this.points.scale.setScalar(sc + (target - sc) * (1 - Math.exp(-dt * 6)));
			}
			if (this.camTracker?.running && this.mouseOn && this._time - (this._moveT ?? -9) > 1 && this._time - (this._camT ?? -9) > 0.7) this.mouseOn = false;
			if (this.hud) {
				this.hud.clear();
				const T = L.tracking;
				const tr = this._eff(T);
				const touchMode = { bump: 0, swirl: 1, pull: 2, push: 3, ripple: 4, melt: 5, scatter: 6, vanish: 7 }[T.touch];
				const ct = touchMode === undefined ? 0 : tr * T.force;
				const n = tr > 0.001 ? Math.min(16, Math.round(T.count)) : 0;
				let tgs = null;
				if (T.follow === 'pointer') {
					if (this.camTracker?.running && this._handPtrs?.length && this._time - (this._handsT ?? -9) < 0.4) tgs = this._handPtrs.map((q) => q.local);
					else if (this.mouseOn) tgs = [this.mouse];
				}
				this.hud.pickOverride = this.shared.uFr.value.x > 0.5 ? () => this._frameSample() : null;
				this.hud.follow = !!(this._animCloud && this.app.anim.has);
				this.hud.gpu = n > 0 && !this.hud.pickOverride ? this._trackPick(this.hud.items.map((it) => it.idx)) : null;
				this.hud.speed = T.speed ?? 1;
				this.hud.update(n, this.geometry, this.morph, this.levels, dt, tgs);
				const hex = (c) => '#' + new THREE.Color(c).getHexString(THREE.SRGBColorSpace);
				const cols = [hex(pal.c[0]), hex(pal.c[2])];
				if (T.on) this.hud.drawTracking(T, (T.opacity ?? 1) * Math.min(1, tr * 10), { points: this.points, camera: this.app.viewport.camera, levels: this.levels, colors: T.color && T.color !== 'auto' ? [T.color, T.color] : cols });
				if (look.hud) this.hud.drawTelemetry({ audioWave: look.hudSpectrum ? 'on' : 'off' }, 1, { levels: this.levels, spec: this.spec, colors: cols });
				if (this.camTracker?.running) {
					const vpSize = this.app.viewport.size;
					if (this._hands?.length && this._time - (this._handsT ?? -9) < 0.35) {
						this.hud.drawHands(this._hands, vpSize.width, vpSize.height, cols[1], L.camTrack.skeleton === 'on');
					} else if (this.mouseOn && this._time - (this._camT ?? -9) < 0.7 && !(this.camTracker instanceof HandTracker)) {
						const v = this.mouse.clone();
						this.points.localToWorld(v);
						v.project(this.app.viewport.camera);
						this.hud.drawCursor((v.x * 0.5 + 0.5) * vpSize.width, (1 - (v.y * 0.5 + 0.5)) * vpSize.height, this._camActive ? 1 : 0.4, cols[1]);
					}
				}
				const arr = u.uTrk.value;
				for (let i = 0; i < 16; i++) {
					const it = this.hud.items[i];
					if (it && i < n) arr[i].set(it.pos.x, it.pos.y, it.pos.z, ct > 0 ? it.touch : 0);
					else arr[i].set(0, 0, 0, 0);
				}
				const imp = u.uImp.value;
				let ni = 0;
				if (T.memory > 0.05 && ct > 0.001) {
					for (const m of this.hud.imprints) {
						const s0 = Math.exp(-(this._time - m.t0) / T.memory) * m.s;
						if (s0 > 0.02 && ni < 32) imp[ni++].set(m.pos.x, m.pos.y, m.pos.z, s0);
					}
				}
				for (let i = ni; i < 32; i++) imp[i].set(0, 0, 0, 0);
				this.hud.time = this._time;
				u.uContact.value.set(ct, T.radius, touchMode ?? 0, n);
				const mkMode = { none: 0, invert: 1, rainbow: 2, hole: 3, lens: 4, pixel: 5, glow: 6 }[T.mark] ?? 0;
				u.uMark.value.set(n > 0 ? mkMode : 0, T.radius, Math.min(1, tr), 0);
				u.uMarkC.value.set(T.color && T.color !== 'auto' ? T.color : pal.c[2]);
				u.uShockP.value.z = ni;
			}
			const shE = this._time - (this._waveT ?? -9) < 5 ? 0.9 : 0;
			const sh = u.uShock.value;
			for (let i = 0; i < 4; i++) {
				const s0 = this.shocks[i];
				const age = s0 ? this._time - s0.t0 : -1;
				if (s0 && age < 5) sh[i].set(s0.pos.x, s0.pos.y, s0.pos.z, age);
				else sh[i].set(0, 0, 0, -1);
			}
			u.uShockP.value.set(shE, 1.2, u.uShockP.value.z, 0);
			this.onFrame && this.onFrame(this.levels);
			this._experimentTick(dt, L);
			this._fxCheck();
			if (off) off.fresh = true;
			this.app.viewport.invalidate();
		};
		this._raf = requestAnimationFrame(tick);
	}
}
