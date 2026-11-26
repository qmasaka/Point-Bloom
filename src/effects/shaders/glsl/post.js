export const fbFrag = `
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

			prev.rgb = mix(prev.rgb, prev.rgb * uTint * 1.7, uTintK * 0.07);
		}
	}
	vec3 col = max(curr.rgb, prev.rgb);
	float a = max(curr.a, prev.a * uDecay);
	gl_FragColor = vec4(col, a);
}
`;

export const outFrag = `
precision highp float;
uniform sampler2D uTex;
uniform float uBloom;
uniform float uAberration;
uniform float uSat;
uniform float uMerge;
uniform float uMergeR;
uniform vec2 uRes;
varying vec2 vUv;
void main() {
	vec2 dir = vUv - vec2(0.5);
	float distSq = dot(dir, dir);
	vec2 shift = dir * (0.2 + distSq * 2.0) * uAberration * 0.05;

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

	if (uMerge > 0.01) {
		vec2 mTexel = 1.0 / uRes;
		float mRad = 1.5 + uMergeR * 9.0;
		vec4 mAcc = baseCol * 1.5;
		vec2 mGrad = vec2(0.0);
		float mW = 1.5;
		for (int i = 0; i < 20; i++) {
			float fi = float(i);
			float ang = fi * 2.399963;
			float rn = sqrt((fi + 0.5) / 20.0);
			vec2 mDir = vec2(cos(ang), sin(ang));
			vec4 mS = texture2D(uTex, vUv + mDir * rn * mRad * mTexel);
			float wgt = 1.0 - 0.7 * rn;
			mAcc += mS * wgt;
			mGrad += mDir * rn * mS.a * wgt;
			mW += wgt;
		}
		mAcc /= mW;
		mGrad /= mW;
		float mCov = mAcc.a;
		float mThr = mix(0.5, 0.24, min(uMerge, 1.0));
		float mFill = smoothstep(mThr - 0.07, mThr + 0.07, mCov);
		vec3 mBlur = mAcc.rgb / max(mAcc.a, 0.02);
		vec3 mSharp = baseCol.rgb / max(baseCol.a, 0.02);
		vec3 mCol = mix(mBlur, mSharp, smoothstep(0.25, 0.85, baseCol.a));
		float mEdge = smoothstep(0.08, 0.4, mCov) * (1.0 - smoothstep(0.5, 0.92, mCov));
		vec3 mN = normalize(vec3(-mGrad * 5.0, 1.0));
		float mLit = dot(mN, normalize(vec3(-0.4, 0.55, 0.75)));
		float mSpec = pow(max(mLit, 0.0), 22.0);
		mCol *= 1.0 + (mLit - 0.75) * 0.55 * mEdge * min(uMerge, 1.0);
		mCol += mSpec * 0.45 * mEdge * min(uMerge, 1.0);
		float mA = max(baseCol.a, mFill);
		baseCol = vec4(mCol * mA, mA);
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

	float lumP = dot(baseCol.rgb, vec3(0.3, 0.59, 0.11));
	if (abs(uSat - 1.0) > 0.001) baseCol.rgb = mix(vec3(lumP), baseCol.rgb, uSat);
	gl_FragColor = baseCol;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

export const mvFrag = `
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
float featCur(vec2 uv) {
	vec4 s = textureLod(uCur, uv, lodL);
	return dot(s.rgb, vec3(0.299, 0.587, 0.114)) + 0.5 * s.a;
}
float featPrev(vec2 uv) {
	vec4 s = textureLod(uPrev, uv, lodL);
	return dot(s.rgb, vec3(0.299, 0.587, 0.114)) + 0.5 * s.a;
}
float sad(vec2 mv) {
	float e = 0.0;
	for (int i = 0; i < 5; i++) e += abs(cc[i] - featPrev(cuv + (oo[i] - mv) / uRes));
	return e;
}
void main() {
	vec2 blockC = (floor(gl_FragCoord.xy) + 0.5) * uBlock;
	cuv = blockC / uRes;
	vec2 mv = vec2(0.0);
	if (uSceneMix > 0.001 && uHasPrev > 0.5) {

		lodL = log2(max(uBlock * 0.6, 1.0));
		float q = uBlock * 0.28;
		oo[0] = vec2(0.0); oo[1] = vec2(q, q); oo[2] = vec2(-q, q); oo[3] = vec2(q, -q); oo[4] = vec2(-q, -q);
		for (int i = 0; i < 5; i++) cc[i] = featCur(cuv + oo[i] / uRes);
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

		if (e0 - bestE < 0.02) best = vec2(0.0);
		mv = best * uSceneMix * uGain;
	}

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
`;

export const moshFrag = `
precision highp float;
uniform sampler2D uCur;
uniform sampler2D uPrevSrc;
uniform sampler2D uMoshPrev;
uniform sampler2D uMV;
uniform vec2 uRes, uMVSize;
uniform float uBlock, uRange, uSmooth, uHold, uResid, uChroma, uQuant, uStyle, uStale, uJit, uTime, uHasHist, uLeak, uCoh, uVoid, uTrail;
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

vec2 mvCoh(vec2 px) {
	vec2 m0 = mvAt(px);
	if (uCoh < 0.01) return m0;
	vec2 bc = floor(px / uBlock);
	vec2 s = vec2(0.0);
	for (int j = -1; j <= 1; j++) {
		for (int i = -1; i <= 1; i++) {
			s += fetchMV(bc + vec2(float(i), float(j)));
		}
	}
	return mix(m0, s / 9.0, uCoh);
}
void main() {
	vec4 cur = texture2D(uCur, vUv);
	float hold = uHold * uHasHist;
	if (hold < 0.002) { gl_FragColor = cur; return; }
	vec2 px = vUv * uRes;
	vec2 bid = floor(px / uBlock);
	float r = h11(bid);
	vec2 mv = mvCoh(px);
	float slot3 = floor(uTime * 3.0);
	if (uStyle > 3.5 && uStyle < 4.5) {

		float rowHit = step(0.82, h11(vec2(bid.y * 3.1, slot3)));
		mv.x += (h11(vec2(bid.y, slot3)) - 0.5) * uBlock * 8.0 * rowHit;
	}
	vec2 suv = vUv;
	if (uStyle > 4.5) {

		vec2 cell = vec2(max(uBlock * 0.5, 2.0));
		vec2 cid = floor(px / cell);
		suv = (cid + 0.5) * cell / uRes;
		mv += vec2((h11(cid + 2.3) - 0.5) * 0.6, -0.4 - h11(cid) * 1.6) * cell.x * 0.35;
	}
	float stale = 0.0;
	if (uStyle > 0.5 && uStyle < 1.5) {

		float slot = floor(uTime * 5.0);
		float rs = h11(bid + slot * 7.13);
		stale = step(1.0 - uStale, rs);
		vec2 jit = (vec2(h11(bid + 3.1 + slot), h11(bid + 9.7 + slot)) - 0.5) * 2.0 * uJit * uBlock;
		mv += jit * stale;
	}
	vec2 d = mv / uRes;
	float cs = uChroma * 0.6;
	vec4 pr = texture2D(uMoshPrev, suv - d * (1.0 + cs));
	vec4 pg = texture2D(uMoshPrev, suv - d);
	vec4 pb = texture2D(uMoshPrev, suv - d * (1.0 - cs));
	vec4 pred = vec4(pr.r, pg.g, pb.b, pg.a);
	vec4 predSrc = texture2D(uPrevSrc, vUv - d);

	float cLum = dot(cur.rgb, vec3(0.3, 0.59, 0.11));
	float keepBg = (1.0 - uVoid) * (1.0 - smoothstep(0.012, 0.07, cLum));
	if (uStyle > 2.5 && uStyle < 3.5) {

		vec4 tr = max(pred * mix(0.82, 0.988, uTrail), cur);
		gl_FragColor = clamp(mix(mix(cur, tr, hold), cur, keepBg), 0.0, 6.0);
		return;
	}
	vec4 dec = pred + (cur - predSrc) * uResid;
	float m = clamp((1.0 - hold) * 1.6 - r * 0.6, 0.0, 1.0) * (1.0 - stale);

	m = max(m, uLeak * (1.0 - stale));
	vec4 o = mix(dec, cur, m);
	if (uStyle > 3.5 && uStyle < 4.5) {

		float rb = h11(bid * 1.37 + slot3 * 3.1);
		vec4 dc = textureLod(uCur, (bid + 0.5) * uBlock / uRes, log2(uBlock));
		float yy = dot(dc.rgb, vec3(0.299, 0.587, 0.114));
		vec3 tint = rb > 0.5 ? vec3(0.15, 1.0, 0.35) : vec3(0.95, 0.2, 0.9);

		vec3 bad = mix(vec3(yy), tint * yy * 1.7, 0.6);
		float lost = step(0.9 - uStale, rb) * hold;
		o = mix(o, vec4(bad, dc.a), lost);
	}
	o = mix(o, cur, keepBg);
	if (uQuant > 0.001) {

		float q = mix(48.0, 5.0, uQuant);
		vec3 qd = floor(o.rgb * q + 0.5) / q;
		qd += (vec3(h11(bid + 1.7), h11(bid + 5.3), h11(bid + 8.9)) - 0.5) * 0.08 * uQuant;
		o.rgb = mix(o.rgb, qd, uQuant * (1.0 - m));
	}
	gl_FragColor = clamp(o, 0.0, 6.0);
}
`;

