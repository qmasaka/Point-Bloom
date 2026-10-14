import * as THREE from 'three';
import { waitPrograms } from './programs.js';
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
fragmentShader: `
				precision highp float;
				uniform sampler2D uScene;
				uniform sampler2D uPrev;
				uniform float uDecay;
				uniform float uZoom;
				uniform float uTwist;
				uniform float uHasPrev;
				uniform vec3 uTint;
				uniform float uTintK;
				varying vec2 vUv;
				void main() {
					vec4 curr = texture2D(uScene, vUv);
					vec4 prev = vec4(0.0);
					if (uHasPrev > 0.5) {
						vec2 c = vec2(0.5);
						vec2 p = vUv - c;
						float a = uTwist;
						mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
						vec2 pUv = (rot * p) / max(0.001, uZoom) + c;
						if (pUv.x >= 0.0 && pUv.x <= 1.0 && pUv.y >= 0.0 && pUv.y <= 1.0) {
							prev = texture2D(uPrev, pUv) * uDecay;
							// хвост постепенно уходит в цвет палитры
							prev.rgb = mix(prev.rgb, prev.rgb * uTint * 1.7, uTintK * 0.07);
						}
					}
					vec3 col = max(curr.rgb, prev.rgb);
					float a = max(curr.a, prev.a * uDecay);
					gl_FragColor = vec4(col, a);
				}
			`,
depthTest: false,
depthWrite: false,
});
this.fbMesh = new THREE.Mesh(this.quadGeo, this.fbMat);
this.outMat = new THREE.ShaderMaterial({
uniforms: {
uTex: { value: null },
uBloom: { value: 0.0 },
uAberration: { value: 0.0 },
uRes: { value: new THREE.Vector2(1, 1) },
},
vertexShader: `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}
			`,
fragmentShader: `
				precision highp float;
				uniform sampler2D uTex;
				uniform float uBloom;
				uniform float uAberration;
				uniform vec2 uRes;
				varying vec2 vUv;
				void main() {
					vec2 dir = vUv - vec2(0.5);
					float distSq = dot(dir, dir);
					vec2 shift = dir * distSq * uAberration * 0.04;

					vec4 baseCol;
					if (uAberration > 0.001) {
						float r = texture2D(uTex, vUv + shift).r;
						float g = texture2D(uTex, vUv).g;
						float b = texture2D(uTex, vUv - shift).b;
						float a = texture2D(uTex, vUv).a;
						baseCol = vec4(r, g, b, a);
					} else {
						baseCol = texture2D(uTex, vUv);
					}

					if (uBloom > 0.01) {
						vec2 texel = 1.0 / uRes;
						vec4 bloom = vec4(0.0);
						float rad = 3.2;
						bloom += texture2D(uTex, vUv + vec2(-rad, -rad) * texel);
						bloom += texture2D(uTex, vUv + vec2( rad, -rad) * texel);
						bloom += texture2D(uTex, vUv + vec2(-rad,  rad) * texel);
						bloom += texture2D(uTex, vUv + vec2( rad,  rad) * texel);
						bloom += texture2D(uTex, vUv + vec2( 0.0, -rad * 1.4) * texel);
						bloom += texture2D(uTex, vUv + vec2( 0.0,  rad * 1.4) * texel);
						bloom += texture2D(uTex, vUv + vec2(-rad * 1.4, 0.0) * texel);
						bloom += texture2D(uTex, vUv + vec2( rad * 1.4, 0.0) * texel);
						bloom *= 0.125;
						baseCol.rgb += bloom.rgb * uBloom * 0.85;
					}

					gl_FragColor = baseCol;
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
				}
			`,
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
fragmentShader: `
				precision highp float;
				uniform sampler2D uCur;
				uniform sampler2D uPrev;
				uniform sampler2D uPrevMV;
				uniform vec2 uRes;
				uniform vec2 uDrift;
				uniform float uBlock, uRange, uGain, uInertia, uSceneMix, uHasPrev, uFlow, uTime;
				varying vec2 vUv;
				float cc[5];
				vec2 oo[5];
				vec2 cuv;
				float lodL;
				float feat(sampler2D t, vec2 uv) {
					vec4 s = textureLod(t, uv, lodL);
					return dot(s.rgb, vec3(0.299, 0.587, 0.114)) + 0.5 * s.a;
				}
				float sad(vec2 mv) {
					float e = 0.0;
					for (int i = 0; i < 5; i++) e += abs(cc[i] - feat(uPrev, cuv + (oo[i] - mv) / uRes));
					return e;
				}
				void main() {
					vec2 blockC = (floor(gl_FragCoord.xy) + 0.5) * uBlock;
					cuv = blockC / uRes;
					vec2 mv = vec2(0.0);
					if (uSceneMix > 0.001 && uHasPrev > 0.5) {
						lodL = log2(max(uBlock * 0.3, 1.0));
						float q = uBlock * 0.28;
						oo[0] = vec2(0.0); oo[1] = vec2(q, q); oo[2] = vec2(-q, q); oo[3] = vec2(q, -q); oo[4] = vec2(-q, -q);
						for (int i = 0; i < 5; i++) cc[i] = feat(uCur, cuv + oo[i] / uRes);
						float step0 = max(1.0, uBlock * 0.5);
						float e0 = sad(vec2(0.0));
						vec2 best = vec2(0.0);
						float bestE = e0;
						for (int j = -3; j <= 3; j++) {
							for (int i = -3; i <= 3; i++) {
								if (i == 0 && j == 0) continue;
								vec2 c = vec2(float(i), float(j)) * step0;
								float e = sad(c) + 0.004 * length(vec2(float(i), float(j)));
								if (e < bestE) { bestE = e; best = c; }
							}
						}
						vec2 ctr = best;
						for (int j = -1; j <= 1; j++) {
							for (int i = -1; i <= 1; i++) {
								if (i == 0 && j == 0) continue;
								vec2 c = ctr + vec2(float(i), float(j)) * step0 * 0.5;
								float e = sad(c) + 0.004 * length(c) / step0;
								if (e < bestE) { bestE = e; best = c; }
							}
						}
						// слабое совпадение считаем шумом, а не движением
						if (e0 - bestE < 0.02) best = vec2(0.0);
						mv = best * uSceneMix * uGain;
					}
					// искусственное движение: ровный снос и течение, чтобы эффект жил и на неподвижной картинке
					vec2 g = cuv * 6.2832;
					vec2 fl = vec2(sin(g.y * 1.2 + uTime * 0.9) + sin(g.x * 0.5 - uTime * 0.6), cos(g.x * 1.2 - uTime * 0.7) + cos(g.y * 0.7 + uTime * 0.5)) * 0.5;
					mv += (uDrift + fl * uFlow) * uGain;
					if (uHasPrev > 0.5) {
						vec2 pm = (texture2D(uPrevMV, vUv).xy * 2.0 - 1.0) * uRange;
						mv = mix(mv, pm, uInertia);
					}
					mv = clamp(mv, vec2(-uRange * 0.98), vec2(uRange * 0.98));
					gl_FragColor = vec4(mv / uRange * 0.5 + 0.5, 0.0, 1.0);
				}
			`,
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
},
vertexShader: vert,
fragmentShader: `
				precision highp float;
				uniform sampler2D uCur;
				uniform sampler2D uPrevSrc;
				uniform sampler2D uMoshPrev;
				uniform sampler2D uMV;
				uniform vec2 uRes, uMVSize;
				uniform float uBlock, uRange, uSmooth, uHold, uResid, uChroma, uQuant, uStyle, uStale, uJit, uTime, uHasHist, uLeak;
				varying vec2 vUv;
				float h11(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
				vec2 fetchMV(vec2 ij) {
					ivec2 sz = ivec2(uMVSize);
					ivec2 p = clamp(ivec2(ij), ivec2(0), sz - 1);
					return (texelFetch(uMV, p, 0).xy * 2.0 - 1.0) * uRange;
				}
				vec2 mvAt(vec2 px) {
					vec2 g = px / uBlock - 0.5;
					vec2 i0 = floor(g);
					vec2 f = fract(g);
					f = mix(step(0.5, f), f, uSmooth);
					vec2 a = fetchMV(i0);
					vec2 b = fetchMV(i0 + vec2(1.0, 0.0));
					vec2 c = fetchMV(i0 + vec2(0.0, 1.0));
					vec2 d = fetchMV(i0 + vec2(1.0, 1.0));
					return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
				}
				void main() {
					vec4 cur = texture2D(uCur, vUv);
					float hold = uHold * uHasHist;
					if (hold < 0.002) { gl_FragColor = cur; return; }
					vec2 px = vUv * uRes;
					vec2 bid = floor(px / uBlock);
					float r = h11(bid);
					vec2 mv = mvAt(px);
					float stale = 0.0;
					if (uStyle > 0.5 && uStyle < 1.5) {
						// блоки: часть блоков залипает и сползает сама по себе
						float slot = floor(uTime * 5.0);
						float rs = h11(bid + slot * 7.13);
						stale = step(1.0 - uStale, rs);
						vec2 jit = (vec2(h11(bid + 3.1 + slot), h11(bid + 9.7 + slot)) - 0.5) * 2.0 * uJit * uBlock;
						mv += jit * stale;
					}
					vec2 d = mv / uRes;
					float cs = uChroma * 0.6;
					vec4 pr = texture2D(uMoshPrev, vUv - d * (1.0 + cs));
					vec4 pg = texture2D(uMoshPrev, vUv - d);
					vec4 pb = texture2D(uMoshPrev, vUv - d * (1.0 - cs));
					vec4 pred = vec4(pr.r, pg.g, pb.b, pg.a);
					vec4 predSrc = texture2D(uPrevSrc, vUv - d);
					vec4 dec = pred + (cur - predSrc) * uResid;
					float m = clamp((1.0 - hold) * 1.6 - r * 0.6, 0.0, 1.0) * (1.0 - stale);
					// понемногу картинка всегда возвращается, иначе сдвиг копится и кадр уезжает за край
					m = max(m, uLeak * (1.0 - stale));
					vec4 o = mix(dec, cur, m);
					if (uQuant > 0.001) {
						// грубое квантование цвета и сдвиг оттенка по блокам, как у перегруженного кодека
						float q = mix(48.0, 5.0, uQuant);
						vec3 qd = floor(o.rgb * q + 0.5) / q;
						qd += (vec3(h11(bid + 1.7), h11(bid + 5.3), h11(bid + 8.9)) - 0.5) * 0.08 * uQuant;
						o.rgb = mix(o.rgb, qd, uQuant * (1.0 - m));
					}
					gl_FragColor = clamp(o, 0.0, 6.0);
				}
			`,
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
render(scene, camera, feedbackCfg, bloomVal, abVal, mosh, forceBuffer) {
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
