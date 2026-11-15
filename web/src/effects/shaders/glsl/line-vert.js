import { common } from './common.js';
export const lineVert = `
attribute vec3 aOrigin;
attribute vec3 aTarget;
attribute float aIdx;
attribute vec3 aOriginB;
attribute vec3 aTargetB;
attribute float aIdxB;
attribute float aDepth;
attribute float aDepthB;
attribute float aEnd;
attribute float aSide;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform float uBright;
uniform vec4 uLink;
uniform vec4 uLinkP;
uniform vec2 uRes;
uniform float uLinkW;
varying vec3 vC;
varying float vA;
varying float vEnd;
varying float vIdx;
varying float vSide;
varying float vStrain;
` + common + `
void main() {
	vec3 bA, bB;
	float mA, mB;
	gDepth = aDepth;
	gNormal = vec3(0.0);
	vec3 pA = fxDisplace(aOrigin, aTarget, aIdx, bA, mA);
	gDepth = aDepthB;
	vec3 pB = fxDisplace(aOriginB, aTargetB, aIdxB, bB, mB);
	float maxLen = uLink.y * 1.9;
	float len = distance(pA, pB);
	if (len > maxLen) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	float strain = clamp((len - uLink.y * 0.4) / max(uLink.y * 1.3, 0.01), 0.0, 1.0);
	vStrain = strain;
	vec3 col = mix(uP0, uP2, 0.35 + uBeat * 0.4) * uBright;
	if (uLinkP.y > 0.5 && uLinkP.y < 1.5) {

		vec3 cyan = vec3(0.12, 0.88, 0.9);
		vec3 gold = vec3(1.0, 0.76, 0.18);
		vec3 ruby = vec3(1.0, 0.22, 0.28);
		col = strain < 0.5 ? mix(cyan, gold, strain * 2.0) : mix(gold, ruby, (strain - 0.5) * 2.0);
		col *= uBright * (1.1 + uBeat * 0.35);
	} else if (uLinkP.y > 1.5 && uLinkP.y < 2.5) {

		col = mix(vec3(0.08, 0.72, 1.0), vec3(1.0, 0.08, 0.76), fract(aIdx * 7.13 + aEnd * 0.5));
		col *= uBright * 1.35;
	} else if (uLinkP.y > 2.5) {

		col = (0.5 + 0.5 * cos(6.2831853 * (aIdx + aEnd * 0.35 + uTime * 0.18 + vec3(0.0, 0.33, 0.67)))) * uBright * 1.25;
	}
	vC = col;
	vA = uLink.x * (1.0 - smoothstep(uLink.y * 0.8, maxLen, len));
	vEnd = aEnd;
	vIdx = aIdx;
	vSide = aSide;
	mat4 mvp = projectionMatrix * modelViewMatrix;
	vec4 cA = mvp * vec4(pA, 1.0);
	vec4 cB = mvp * vec4(pB, 1.0);
	if (cA.w < 0.02 || cB.w < 0.02) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	vec2 sA = cA.xy / cA.w;
	vec2 sB = cB.xy / cB.w;
	vec2 dir = (sB - sA) * vec2(uRes.x / uRes.y, 1.0);
	float dl = length(dir);
	dir = dl > 1e-5 ? dir / dl : vec2(1.0, 0.0);
	vec2 nrm = vec2(-dir.y, dir.x) * vec2(uRes.y / uRes.x, 1.0);
	vec4 c = mix(cA, cB, aEnd);
	float flare = 1.0;
	if (uLinkP.z > 0.5) {
		float endDist = min(aEnd, 1.0 - aEnd);
		flare += (1.0 - smoothstep(0.0, 0.18, endDist)) * 1.9;
	}
	float baseW = uLinkW;
	if (uLinkP.x > 1.5 && uLinkP.x < 2.5) baseW = max(0.65, uLinkW * 0.6);
	c.xy += nrm * aSide * (baseW * flare + 1.0) / uRes.y * c.w;
	gl_Position = c;
}
`;
