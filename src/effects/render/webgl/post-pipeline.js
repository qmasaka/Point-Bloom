import * as THREE from 'three';
import { waitPrograms } from './programs.js';
import { fbFrag, moshFrag, mvFrag, outFrag } from '../../shaders/glsl/post.js';

export class PostPipeline {
	constructor(renderer) {
		this.renderer = renderer;
		this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.quadGeo = new THREE.PlaneGeometry(2, 2);
		this.width = 0;
		this.height = 0;

		const gl = renderer.getContext();
		let canHalfFloat = false;
		try {
			const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
			if (isWebGL2) {
				canHalfFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
			} else {
				canHalfFloat = !!(gl.getExtension('EXT_color_buffer_half_float') && gl.getExtension('OES_texture_half_float'));
			}
		} catch (e) {
			canHalfFloat = false;
		}

		this.targetType = canHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
		this._disabled = false;

		this._buildTargets(this.targetType);
		this._buildMosh();

		this.fbMat = new THREE.ShaderMaterial({
			uniforms: {
				uScene: { value: null },
				uPrev: { value: null },
				uDecay: { value: 0.92 },
				uZoom: { value: 1.0 },
				uTwist: { value: 0.0 },
				uHasPrev: { value: 0.0 },
				uTint: { value: new THREE.Color(1, 1, 1) },
				uTintK: { value: 0.0 },
			},
			vertexShader: `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}
			`,
			fragmentShader: fbFrag,
			depthTest: false,
			depthWrite: false,
		});
		this.fbMesh = new THREE.Mesh(this.quadGeo, this.fbMat);

		this.outMat = new THREE.ShaderMaterial({
			uniforms: {
				uTex: { value: null },
				uBloom: { value: 0.0 },
				uAberration: { value: 0.0 },
				uSat: { value: 1.0 },
				uMerge: { value: 0.0 },
				uMergeR: { value: 0.4 },
				uRes: { value: new THREE.Vector2(1, 1) },
			},
			vertexShader: `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}
			`,
			fragmentShader: outFrag,
			depthTest: false,
			depthWrite: false,
			transparent: true,
		});
		this.outMesh = new THREE.Mesh(this.quadGeo, this.outMat);

		this.quadScene = new THREE.Scene();
		this.hasHistory = false;
	}

	warm() {
		const r = this.renderer;
		const prev = r.getRenderTarget();
		const mats = new Set();
		try {
			for (const [mat, rt] of [[this.fbMat, this.rtPong], [this.outMat, null]]) {
				const sc = new THREE.Scene();
				sc.add(new THREE.Mesh(this.quadGeo, mat));
				r.setRenderTarget(rt);
				r.compile(sc, this.quadCam).forEach((m) => mats.add(m));
			}
		} catch (e) {
			return Promise.resolve();
		} finally {
			r.setRenderTarget(prev);
		}
		return waitPrograms(r, mats);
	}

	_buildTargets(type) {
		for (const k of ['rtScene', 'rtSceneB', 'rtPing', 'rtPong', 'rtMoshA', 'rtMoshB', 'rtMvA', 'rtMvB']) {
			if (this[k]) this[k].dispose();
			this[k] = null;
		}
		const w = this.width || 1;
		const h = this.height || 1;
		const flat = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type };
		this.rtScene = new THREE.WebGLRenderTarget(w, h, flat);
		this.rtSceneB = new THREE.WebGLRenderTarget(w, h, flat);
		this.rtPing = new THREE.WebGLRenderTarget(w, h, flat);
		this.rtPong = new THREE.WebGLRenderTarget(w, h, flat);
		this.moshHist = false;
		this.hasHistory = false;
	}

	_buildMosh() {
		const vert = `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4(position.xy, 0.0, 1.0);
			}
		`;
		this.mvMat = new THREE.ShaderMaterial({
			uniforms: {
				uCur: { value: null },
				uPrev: { value: null },
				uPrevMV: { value: null },
				uRes: { value: new THREE.Vector2(1, 1) },
				uBlock: { value: 16 },
				uRange: { value: 64 },
				uGain: { value: 1 },
				uInertia: { value: 0.5 },
				uSceneMix: { value: 1 },
				uHasPrev: { value: 0 },
				uDrift: { value: new THREE.Vector2() },
				uFlow: { value: 0 },
				uTime: { value: 0 },
			},
			vertexShader: vert,
			fragmentShader: mvFrag,
			depthTest: false,
			depthWrite: false,
		});
		this.moshMat = new THREE.ShaderMaterial({
			uniforms: {
				uCur: { value: null },
				uPrevSrc: { value: null },
				uMoshPrev: { value: null },
				uMV: { value: null },
				uRes: { value: new THREE.Vector2(1, 1) },
				uMVSize: { value: new THREE.Vector2(1, 1) },
				uBlock: { value: 16 },
				uRange: { value: 64 },
				uSmooth: { value: 0.6 },
				uHold: { value: 0 },
				uResid: { value: 0.2 },
				uChroma: { value: 0 },
				uQuant: { value: 0 },
				uStyle: { value: 0 },
				uStale: { value: 0 },
				uJit: { value: 0 },
				uTime: { value: 0 },
				uHasHist: { value: 0 },
				uLeak: { value: 0.03 },
				uCoh: { value: 0.6 },
				uVoid: { value: 1 },
				uTrail: { value: 0.6 },
			},
			vertexShader: vert,
			fragmentShader: moshFrag,
			depthTest: false,
			depthWrite: false,
		});
		this.mvMesh = new THREE.Mesh(this.quadGeo, this.mvMat);
		this.moshMesh = new THREE.Mesh(this.quadGeo, this.moshMat);
		this.moshBlock = 0;
		this.moshHist = false;
	}

	_ensureMosh(block) {
		const w = this.width;
		const h = this.height;
		const mw = Math.max(1, Math.ceil(w / block));
		const mh = Math.max(1, Math.ceil(h / block));
		const type = this.targetType;
		const flat = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type, depthBuffer: false };
		const near = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type, depthBuffer: false };
		if (!this.rtMoshA) {
			this.rtMoshA = new THREE.WebGLRenderTarget(w, h, flat);
			this.rtMoshB = new THREE.WebGLRenderTarget(w, h, flat);
			this.moshHist = false;
		}
		if (!this.rtMvA) {
			this.rtMvA = new THREE.WebGLRenderTarget(mw, mh, near);
			this.rtMvB = new THREE.WebGLRenderTarget(mw, mh, near);
			this.moshHist = false;
		}
		if (this.moshBlock !== block || this.rtMvA.width !== mw || this.rtMvA.height !== mh) {
			this.rtMvA.setSize(mw, mh);
			this.rtMvB.setSize(mw, mh);
			this.moshBlock = block;
			this.moshHist = false;
		}
		return [mw, mh];
	}

	_moshStep(m) {
		const r = this.renderer;
		const block = m.block;
		const [mw, mh] = this._ensureMosh(block);
		const hist = this.moshHist;
		const k = this.height / 1080;
		const range = 4 * block + 0.03 * this.height;
		const mu = this.mvMat.uniforms;
		mu.uCur.value = this.rtScene.texture;
		mu.uPrev.value = this.rtSceneB.texture;
		mu.uPrevMV.value = this.rtMvA.texture;
		mu.uRes.value.set(this.width, this.height);
		mu.uBlock.value = block;
		mu.uRange.value = range;
		mu.uGain.value = m.gain;
		mu.uInertia.value = hist ? m.inertia : 0;
		mu.uSceneMix.value = m.sceneMix;
		mu.uHasPrev.value = hist ? 1 : 0;
		mu.uDrift.value.set(Math.cos(m.angle) * m.drift * 6 * k, Math.sin(m.angle) * m.drift * 6 * k);
		mu.uFlow.value = m.flow * 4 * k;
		mu.uTime.value = m.time;
		this.quadScene.clear();
		this.quadScene.add(this.mvMesh);
		r.setRenderTarget(this.rtMvB);
		r.render(this.quadScene, this.quadCam);
		let t = this.rtMvA;
		this.rtMvA = this.rtMvB;
		this.rtMvB = t;

		const u = this.moshMat.uniforms;
		u.uCur.value = this.rtScene.texture;
		u.uPrevSrc.value = this.rtSceneB.texture;
		u.uMoshPrev.value = this.rtMoshA.texture;
		u.uMV.value = this.rtMvA.texture;
		u.uRes.value.set(this.width, this.height);
		u.uMVSize.value.set(mw, mh);
		u.uBlock.value = block;
		u.uRange.value = range;
		u.uSmooth.value = m.smooth;
		u.uHold.value = m.hold;
		u.uResid.value = m.detail;
		u.uChroma.value = m.chroma;
		u.uQuant.value = m.quant;
		u.uStyle.value = m.style;
		u.uStale.value = m.stale;
		u.uJit.value = m.jit;
		u.uTime.value = m.time;
		u.uHasHist.value = hist ? 1 : 0;
		u.uLeak.value = m.leak;
		u.uCoh.value = m.coh;
		u.uVoid.value = m.void;
		u.uTrail.value = m.trail;
		this.quadScene.clear();
		this.quadScene.add(this.moshMesh);
		r.setRenderTarget(this.rtMoshB);
		r.render(this.quadScene, this.quadCam);
		t = this.rtMoshA;
		this.rtMoshA = this.rtMoshB;
		this.rtMoshB = t;
		t = this.rtScene;
		this.rtScene = this.rtSceneB;
		this.rtSceneB = t;
		this.moshHist = true;
		return this.rtMoshA.texture;
	}

	setSize(w, h, dpr = 1) {
		const rw = Math.max(1, Math.round(w * dpr));
		const rh = Math.max(1, Math.round(h * dpr));
		if (rw === this.width && rh === this.height) return;
		this.width = rw;
		this.height = rh;
		this.rtScene.setSize(rw, rh);
		this.rtSceneB.setSize(rw, rh);
		this.rtPing.setSize(rw, rh);
		this.rtPong.setSize(rw, rh);
		if (this.rtMoshA) {
			this.rtMoshA.setSize(rw, rh);
			this.rtMoshB.setSize(rw, rh);
		}
		this.moshHist = false;
		this.outMat.uniforms.uRes.value.set(rw, rh);
		this.hasHistory = false;
	}

	render(scene, camera, feedbackCfg, bloomVal, abVal, mosh, forceBuffer, grade = null) {
		const r = this.renderer;
		const dom = r.domElement;
		const dpr = r.getPixelRatio();
		this.setSize(dom.clientWidth, dom.clientHeight, dpr);

		const useFb = feedbackCfg && feedbackCfg.on && feedbackCfg.amount > 0.01;
		const useBloom = bloomVal > 0.01;
		const useAb = abVal > 0.01;
		const useMosh = !!(mosh && mosh.on);

		if ((!forceBuffer && !useFb && !useBloom && !useAb && !useMosh) || this._disabled) {
			r.setRenderTarget(null);
			r.render(scene, camera);
			this.hasHistory = false;
			return;
		}

		try {
			const needMips = useMosh;
			if (this.rtScene && this.rtScene.texture.generateMipmaps !== needMips) {
				this.rtScene.texture.generateMipmaps = needMips;
				this.rtScene.texture.minFilter = needMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
			}
			if (this.rtSceneB && this.rtSceneB.texture.generateMipmaps !== needMips) {
				this.rtSceneB.texture.generateMipmaps = needMips;
				this.rtSceneB.texture.minFilter = needMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
			}
			r.setRenderTarget(this.rtScene);
			r.clear();
			r.render(scene, camera);

			let sourceTex = this.rtScene.texture;
			if (useMosh) sourceTex = this._moshStep(mosh);
			else this.moshHist = false;
			const preFb = sourceTex;

			if (useFb) {
				const tun = feedbackCfg.mode === 'tunnel';
				const zoom = tun ? feedbackCfg.zoom || 1.0 : 1.0;
				const twist = tun ? feedbackCfg.twist || 0.0 : 0.0;
				const decay = Math.min(0.99, feedbackCfg.amount || 0.92);
				this.fbMat.uniforms.uTint.value.copy(this.tint || new THREE.Color(1, 1, 1));
				this.fbMat.uniforms.uTintK.value = feedbackCfg.tint ?? 0.5;

				this.fbMat.uniforms.uScene.value = preFb;
				this.fbMat.uniforms.uPrev.value = this.rtPing.texture;
				this.fbMat.uniforms.uDecay.value = decay;
				this.fbMat.uniforms.uZoom.value = zoom;
				this.fbMat.uniforms.uTwist.value = twist;
				this.fbMat.uniforms.uHasPrev.value = this.hasHistory ? 1.0 : 0.0;

				this.quadScene.clear();
				this.quadScene.add(this.fbMesh);
				r.setRenderTarget(this.rtPong);
				r.clear();
				r.render(this.quadScene, this.quadCam);

				const tmp = this.rtPing;
				this.rtPing = this.rtPong;
				this.rtPong = tmp;
				this.hasHistory = true;

				sourceTex = this.rtPing.texture;
			} else {
				this.hasHistory = false;
			}

			this.outMat.uniforms.uTex.value = sourceTex;
			this.outMat.uniforms.uBloom.value = bloomVal;
			this.outMat.uniforms.uAberration.value = abVal;
			this.outMat.uniforms.uSat.value = grade?.sat ?? 1;
			this.outMat.uniforms.uMerge.value = grade?.merge || 0;
			this.outMat.uniforms.uMergeR.value = grade?.mergeR ?? 0.4;

			this.quadScene.clear();
			this.quadScene.add(this.outMesh);
			r.setRenderTarget(null);
			r.render(this.quadScene, this.quadCam);
		} catch (e) {
			console.warn('PostPipeline fallback to direct render:', e);
			if (this.targetType === THREE.HalfFloatType) {
				this.targetType = THREE.UnsignedByteType;
				this._buildTargets(THREE.UnsignedByteType);
			} else {
				this._disabled = true;
			}
			r.setRenderTarget(null);
			r.render(scene, camera);
		}
	}

	dispose() {
		for (const k of ['rtScene', 'rtSceneB', 'rtPing', 'rtPong', 'rtMoshA', 'rtMoshB', 'rtMvA', 'rtMvB']) if (this[k]) this[k].dispose();
		this.mvMat.dispose();
		this.moshMat.dispose();
		this.fbMat.dispose();
		this.outMat.dispose();
		this.quadGeo.dispose();
	}
}
