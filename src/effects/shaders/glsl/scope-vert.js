// GLSL: вершинный шейдер линии «Осциллограф».
import { common } from './common.js';

export const scopeVert = /* glsl */ `
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
attribute float aSeg;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform vec2 uRes;
uniform float uScopeW;
uniform float uScopeLB;
varying vec3 vC;
varying float vA;
varying float vSide;
` + common + `
void main() {
	vec3 bA, bB;
	float mA, mB;
	gDepth = aDepth;
	gNormal = vec3(0.0);
	vec3 pA = fxDisplace(aOrigin, aTarget, aIdx, bA, mA);
	gDepth = aDepthB;
	vec3 pB = fxDisplace(aOriginB, aTargetB, aIdxB, bB, mB);
	bool rv = uScope.y > 1.5;
	float cm = rv ? uScope.y - 2.0 : uScope.y;
	float sp = rv ? 1.0 - aSeg : aSeg;
	if (uScopeP.w > 1.5) sp = fract(sp * uScopeP.w);
	float age = uScope.z - sp;
	float lit = age < 0.0 || aSeg < 0.0 ? 0.0 : (cm < 0.5 ? 1.0 : exp(-age * 4.0 / max(uScope.w, 0.02))) * uScopeP.y;
	vA = lit * step(uScopeP.z, sp) * uScope.x * min(1.0, uScope.x * 2.0) * uScopeLB;
	vC = uScopeC * (1.0 + exp(-max(age, 0.0) * 45.0) * uScopeQ.z * 2.0);
	vSide = aSide;
	mat4 mvp = projectionMatrix * modelViewMatrix;
	vec4 cA = mvp * vec4(pA, 1.0);
	vec4 cB = mvp * vec4(pB, 1.0);
	vec2 sA = cA.xy / cA.w;
	vec2 sB = cB.xy / cB.w;
	vec2 dir = (sB - sA) * vec2(uRes.x / uRes.y, 1.0);
	float dl = length(dir);
	dir = dl > 1e-5 ? dir / dl : vec2(1.0, 0.0);
	vec2 nrm = vec2(-dir.y, dir.x) * vec2(uRes.y / uRes.x, 1.0);
	vec4 c = mix(cA, cB, aEnd);
	c.xy += nrm * aSide * (uScopeW + 1.0) / uRes.y * c.w;
	gl_Position = c;
}
`;
