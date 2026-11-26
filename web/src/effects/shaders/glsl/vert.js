import { common } from './common.js';
export const vert = `
attribute vec3 aOrigin;
attribute vec3 aTarget;
attribute vec3 aColor;
attribute float aIdx;
attribute vec3 aSculpt;
attribute vec3 aNormal;
attribute vec3 aNormalB;
attribute vec4 aPaint;
attribute vec3 aColorB;
attribute float aHide;
attribute float aDepth;
attribute float aPath;
uniform float uAdd;
uniform highp sampler2DArray uFrTex;
uniform sampler2D uHeroTex;
attribute vec3 aVis;
uniform sampler2D uExperimentField;
uniform sampler2D uExperimentShapes;
uniform vec4 uExperimentShapeInfo;
uniform vec4 uExperimentSim;
uniform vec4 uChemistry;
uniform vec4 uHist;
uniform vec4 uTsplit;
uniform vec4 uTsplit2;
uniform vec4 uMrel;
uniform vec4 uMrel2;
uniform vec4 uMrel3;
uniform vec4 uLive;
uniform vec4 uChemistryB;
uniform vec4 uExperimentTint;
uniform vec4 uImpossibleStyle;
uniform vec4 uImpossibleMix;
uniform vec4 uExperimentView;
uniform vec4 uImpossible;
uniform vec4 uRecursion;
uniform vec4 uRecursionStyle;
uniform vec4 uRecursionLook;
uniform vec3 uSolid;
uniform float uAtt;
uniform float uSize;
uniform float uPR;
uniform vec3 uGlyph;
uniform float uColorBy;
uniform float uBright;
uniform float uMaskShow;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform vec3 uSliceC;
uniform vec3 uMarkC;
varying vec3 vColor;
varying float vD;
varying float vDk;
varying float vCoc;
varying float vGl;
` + common + `
#ifdef VSHOOT

uniform vec4 uShoot;
uniform vec4 uShootP;
uniform vec4 uShootD;
uniform vec4 uShootE;
uniform vec4 uShootC;
uniform vec4 uShootS[24];
uniform vec4 uShootN[24];
uniform vec4 uShootB[6];
#endif
#ifdef VSCREEN

uniform vec4 uScr;
uniform vec4 uScrP;
uniform sampler2D uScrTex;
uniform vec4 uScrD;
uniform vec4 uScrQ;
uniform sampler2D uScrDep;

uniform sampler2D uScrMTex;
uniform float uScrMN;

uniform vec4 uSlit;
uniform vec4 uSlitP;
uniform vec4 uSlitG;
uniform highp sampler2DArray uSlitTex;

uniform vec4 uSort;
uniform vec4 uSortP;
uniform highp sampler2D uSortTex;
#endif
#ifdef SHADOW

uniform vec4 uShd;
uniform vec4 uShdL;
uniform vec4 uShdP;
uniform vec3 uShdC;
#endif
#ifdef HERO
#define HEROSIZE clamp(sqrt(uFr.z / max(uHero.z, 1.0)), 0.4, 1.0)

float frLayerDepth(float k, vec2 g) {
	int layer = int(mod(k + uFr5.x, uFr.y));
	vec2 m = vec2(uFr2.x - 1.0, uFr2.y - 1.0);
	vec2 p = clamp(g, vec2(0.0), m);
	vec2 p0 = floor(p);
	vec2 f = p - p0;
	vec2 p1 = min(p0 + vec2(1.0), m);
	float d00 = frDec(texelFetch(uFrTex, ivec3(int(p0.x), int(p0.y), layer), 0).a);
	float d10 = frDec(texelFetch(uFrTex, ivec3(int(p1.x), int(p0.y), layer), 0).a);
	float d01 = frDec(texelFetch(uFrTex, ivec3(int(p0.x), int(p1.y), layer), 0).a);
	float d11 = frDec(texelFetch(uFrTex, ivec3(int(p1.x), int(p1.y), layer), 0).a);
	return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
}

float frLayerSubj(float k, vec2 g) {
	int layer = int(mod(k + uFr5.x, uFr.y));
	vec2 p = clamp(floor(g + 0.5), vec2(0.0), vec2(uFr2.x - 1.0, uFr2.y - 1.0));
	return texelFetch(uFrTex, ivec3(int(p.x), int(p.y), layer), 0).a > 0.5 ? 1.0 : 0.0;
}
#else
#define HEROSIZE uFr6.x
#endif

float chemistryWave(vec3 p, float frequency, float t, float warp) {
	vec3 flow = vec3(snoise(p * 1.1 + t * 0.03), snoise(p * 1.1 + 7.3 - t * 0.025), snoise(p * 1.1 + 13.1));
	vec3 w = p * frequency + flow * 1.7 * warp;
	float s = cos(dot(w, vec3(0.93, 0.21, -0.3)) + t * 0.22)
		+ cos(dot(w, vec3(-0.35, 0.88, 0.32)) - t * 0.18 + 1.7)
		+ cos(dot(w, vec3(0.28, -0.41, 0.87)) + t * 0.14 + 3.1)
		+ cos(dot(w, vec3(-0.71, -0.52, -0.47)) - t * 0.16 + 4.6)
		+ cos(dot(w, vec3(0.52, 0.61, -0.6)) + t * 0.2 + 2.3)
		+ cos(dot(w, vec3(0.12, -0.83, -0.54)) - t * 0.12 + 5.4);
	return s * 0.4082;
}

float experimentHash(int seed) {
	int v = ((seed % 65521) * 25173 + 13849) % 65521;
	int m = v % 32749;
	return float((m * m + v * 31) % 65521) / 65521.0;
}

vec4 experimentCell(int id, int page) {
	return texelFetch(uExperimentField, ivec2(id % 256, id / 256 + page * 128), 0);
}

vec4 sampleExperimentField(int packed, int page) {
	int id = packed / 512;
	int fraction = packed % 512;
	float a = float(fraction % 8) / 7.0;
	float b = float((fraction / 8) % 8) / 7.0;
	float c = float(fraction / 64) / 7.0;
	int x = 1;
	int y = 32;
	int z = 1024;
	if (a < b) {
		float t = a; a = b; b = t;
		int s = x; x = y; y = s;
	}
	if (b < c) {
		float t = b; b = c; c = t;
		int s = y; y = z; z = s;
	}
	if (a < b) {
		float t = a; a = b; b = t;
		int s = x; x = y; y = s;
	}
	vec4 p0 = experimentCell(id, page);
	vec4 p1 = experimentCell(id + x, page);
	vec4 p2 = experimentCell(id + x + y, page);
	vec4 p3 = experimentCell(id + x + y + z, page);
	vec4 w = vec4(1.0 - a, a - b, b - c, c) * step(vec4(0.5), vec4(p0.w, p1.w, p2.w, p3.w));
	float total = dot(w, vec4(1.0));
	vec4 value = (p0 * w.x + p1 * w.y + p2 * w.z + p3 * w.w) / max(total, 0.001);
	return vec4(value.xyz, (value.w - 2.0) * step(0.001, total));
}

vec3 experimentColor(float value) {
	return vec3(mod(value, 256.0), mod(floor(value / 256.0), 256.0), floor(value / 65536.0)) / 255.0;
}

vec3 experimentYaw(vec3 p, float angle) {
	float c = cos(angle);
	float s = sin(angle);
	return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
}

vec3 histColor(int cx, int cy, float age) {
	int slot = int(mod(uHist.z - floor(age) + uHist.w * 8.0, uHist.w));
	return texelFetch(uSlitTex, ivec3(cx, cy, slot), 0).rgb;
}

vec3 experimentPalette(float t) {
	t = clamp(t, 0.0, 1.0);
	return t < 0.5 ? mix(uP0, uP1, t * 2.0) : mix(uP1, uP2, (t - 0.5) * 2.0);
}

vec3 viewForm(int id, vec3 p, vec3 n, int pointId, float yaw) {
	vec3 c = uCen;
	vec3 d = p - c;
	if (id == 1) return experimentYaw(p, p.y * 2.4 + p.x * 0.8);
	if (id == 2) return vec3(p.x + 0.3 * sin(p.y * 7.0), p.y * 0.85 + p.z * 0.35, -p.z * 0.35 + 0.47 * sin(p.x * 6.7 + p.y * 3.2));
	if (id == 3) return c + d / max(length(d), 0.001) * 0.95;
	if (id == 4) {
		vec3 view = vec3(sin(yaw), 0.0, cos(yaw));
		return p - view * dot(d, view) * 0.96;
	}
	if (id == 5) {
		float h = experimentHash(pointId * 7 + 3);
		vec3 dir = vec3(experimentHash(pointId * 11 + 5), experimentHash(pointId * 13 + 1), experimentHash(pointId * 17 + 9)) - 0.5;
		return p + n * 0.2 + dir * 0.4 * (0.75 + 0.25 * sin(uTime * 1.3 + h * 6.28));
	}
	if (id == 6) return floor(p / 0.14 + 0.5) * 0.14;
	if (id == 7) {
		float k = 0.38 + 0.62 * abs(sin(p.y * 3.2));
		return vec3(c.x + d.x * k, p.y, c.z + d.z * k);
	}
	return p;
}

void main() {
	if (aHide > 0.5) {

		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
		vColor = vec3(0.0);
		vD = 0.0;
		vCoc = 0.0;
		vGl = 0.0;
		return;
	}

	vec3 frCol = vec3(1.0);
	vec3 frNrm = vec3(0.0, 0.0, 1.0);
	float frLift = 0.0;
	float frAp = -1.0;
	float frDep = 0.5;
	if (uFr.x > 0.5) {
		float fk;
		vec2 fcell;
		vec3 fp = frBlockPos(aIdx, frNrm, fk, fcell);
#ifdef HERO
		frAp = (fcell.y + fcell.x / uHero.x) / uHero.y;
#else
		frAp = (fcell.y + fcell.x / uFr2.x) / uFr2.y;
#endif
		vec3 tcol;
		vec4 sh = frShow(fk, tcol);
#ifdef HERO

		if (uFr4.y < 0.5 || uFr8.x > 0.5) sh.x = 1.0;
#endif
		bool cull = sh.x < 0.02;

		float frBg = 0.0;
		if (uFr8.x > 0.5 && !cull) {
#ifdef HERO
			frBg = 1.0 - frLayerSubj(uFr.y - 1.0, (fcell + 0.5) / uHero.xy * uFr2.xy - 0.5);
			if (frBg > 0.5 && uLive.x < 0.02) cull = true;
#else

			if (fk < uFr.y - uFr9.w - 0.5) cull = true;
			frBg = texelFetch(uFrTex, ivec3(int(fcell.x), int(fcell.y), int(mod(fk + uFr5.x, uFr.y))), 0).a > 0.5 ? 0.0 : 1.0;
			if (frBg > 0.5 && fract(sin(dot(fcell, vec2(7.13, 3.71)) + fk * 2.31) * 51731.7) > uFr8.w) cull = true;
#endif
		}

		if (uAdd < 0.5 && sh.x < 1.0) {
			if (fract(sin(dot(fcell, vec2(39.346, 11.135)) + fk * 1.713) * 24634.6345) > sh.x) cull = true;
		}

		if (uAdd < 0.5) sh.x = 1.0;
#ifndef HERO

		if (uHero.w > 0.5 && abs(fk - floor(uFr4.x + 0.5)) < 0.1) cull = true;

		float dl = abs(fk - uFr4.x);
		float keep = mix(1.0, clamp(1.0 / (1.0 + dl * 0.45), 0.08, 1.0), uFr5.y);
		float hs = fract(sin(dot(fcell, vec2(12.9898, 78.233)) + fk * 0.731) * 43758.5453);
		if (dl > 0.5 && hs > keep) cull = true;

		if (uFr7.x < 0.999) {
			float tx = dl / max(uFr7.x * uFr.y, 1.0);
			if (tx >= 1.0 || hs > 1.0 - smoothstep(min(1.0 - uFr7.z, 0.999), 1.0, tx)) cull = true;
		}
#endif
		if (cull) {
			gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
			gl_PointSize = 0.0;
			vColor = vec3(0.0);
			vD = 0.0;
			vCoc = 0.0;
			vGl = 0.0;
			return;
		}
		int layer = int(mod(fk + uFr5.x, uFr.y));
#ifdef HERO
		vec3 fc = texture2D(uHeroTex, vec2((fcell.x + 0.5) / uHero.x, 1.0 - (fcell.y + 0.5) / uHero.y)).rgb;
#else
		vec3 fc = texelFetch(uFrTex, ivec3(int(fcell.x), int(fcell.y), layer), 0).rgb;
#endif
#ifndef HERO
		fc = min(fc * uFr5.w, vec3(1.6));

		if (abs(uFr7.y) > 0.001) fc = max(mix(vec3(dot(fc, vec3(0.3, 0.59, 0.11))), fc, 1.0 + uFr7.y * (uFr7.y > 0.0 ? 2.0 : 1.0)), 0.0);

		if (uFr6.z > 0.5) {
			float lt = pow(dot(fc, vec3(0.3, 0.59, 0.11)), 0.4545);
			if (uFr6.z < 1.5 ? lt < uFr6.w : lt > uFr6.w) {
				gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
				gl_PointSize = 0.0;
				vColor = vec3(0.0);
				vD = 0.0;
				vCoc = 0.0;
				vGl = 0.0;
				return;
			}
		}
#endif
		float l = dot(fc, vec3(0.3, 0.59, 0.11));
		frCol = (fc * (1.0 - sh.z) + tcol * (0.35 + l * 1.6) * sh.z) * sh.x;

#ifdef HERO
		if (frBg > 0.5) frCol *= uLive.x;
		vec2 frGs = uHero.xy;
		float frEw = uFrE.y * uHero.x / max(uFr2.x, 1.0);
		float frEk = uFrE.w;
#else
		if (frBg > 0.5) frCol *= 0.4;
		vec2 frGs = uFr2.xy;
		float frEw = uFrE.y;
		float frEk = uFrE.x;
#endif

		if (frEk > 0.001 && uFr8.x < 0.5) {
			vec2 ce = min(fcell, frGs - 1.0 - fcell);
			float edge = 1.0 - smoothstep(frEw * 0.5, frEw + 0.5, min(ce.x, ce.y));
			vec3 ecol = uFrE.z > 0.5 ? vec3(1.0) : uP2;
			frCol = mix(frCol, ecol * (0.9 + 0.5 * sh.x), edge * min(frEk, 1.0));
		}
		frLift = sh.y;

		if (uDepth.x > 0.001) {
#ifdef HERO

			vec2 hg = (fcell + 0.5) / uHero.xy * uFr2.xy - 0.5;
			float hk0 = clamp(floor(uFr4.x), 0.0, uFr.y - 1.0);
			float hk1 = min(hk0 + 1.0, uFr.y - 1.0);
			frDep = mix(frLayerDepth(hk0, hg), frLayerDepth(hk1, hg), clamp(uFr4.x - hk0, 0.0, 1.0));
#else
			frDep = frDec(texelFetch(uFrTex, ivec3(int(fcell.x), int(fcell.y), layer), 0).a);
#endif

			frDep = pow(max(clamp((frDep - 0.5) * uDepthQ.z + 0.5 + uDepthQ.y, 0.0, 1.0), 1e-4), uDepthQ.w);
#ifndef HERO

			float dkeep = mix(uFr7.w, 1.0, 1.0 - clamp(abs(fk - uFr4.x), 0.0, 1.0));
			frDep = mix(uDepth.w, frDep, dkeep);
#endif
		}
	}
	vec3 base;
	float maskV;
	gDepth = uFr.x > 0.5 ? frDep : aDepth;
	gNormal = aNormal;
	gLum = uFr.x > 0.5 ? dot(frCol, vec3(0.3, 0.59, 0.11)) : dot(aColor, vec3(0.3, 0.59, 0.11));
	if (uScope.x > 0.001) {

		bool rv = uScope.y > 1.5;
		float cm = rv ? uScope.y - 2.0 : uScope.y;

		float ap0 = frAp >= 0.0 ? frAp : aPath;
		float ap = rv ? 1.0 - ap0 : ap0;
		if (uScopeP.w > 1.5) ap = fract(ap * uScopeP.w);
		float sAge = uScope.z - ap;
		float hideAll = (ap < uScopeP.z ? 1.0 : 0.0) * min(1.0, uScopeP.x * 4.0);
		if (sAge >= 0.0) {
			gScopeT = (cm < 0.5 ? 1.0 : exp(-sAge * 4.0 / max(uScope.w, 0.02))) * uScopeP.y;
			gScopeG = exp(-sAge * 45.0) * uScopeP.y;

			if (uScopeP.z > 0.0 && ap >= uScopeP.z) gScopeG = max(gScopeG, exp(-(ap - uScopeP.z) * 45.0));
			gScopeD = hideAll;
		} else gScopeD = max(clamp(uScopeP.x * uScope.x * 1.6, 0.0, 1.0), hideAll);
	}
	vec3 pos = fxDisplace(aOrigin, aTarget, aIdx, base, maskV);
	pos += aSculpt;
	float experimentTint = 0.0;
	float experimentScale = 1.0;
	float sculptMix = 0.0;
	vec3 sculptColor = vec3(0.0);
	float copyShade = 0.0;
	float autoLight = 0.0;
	float bite = 0.0;
	float chemBody = 0.0;
	float chemCore = 0.0;
	float chemRim = 0.0;
	float shiftGlow = 0.0;
#ifndef HERO
	if (uExperimentSim.x > 0.5) {
		vec4 field = sampleExperimentField(int(aVis.z), 0);
		float fieldPush = length(field.xyz);
		if (fieldPush > 0.0005) {
			int fieldId = int(floor(aIdx * uExperimentView.w + 0.5));
			float fieldVary = 0.7 + 0.6 * experimentHash(fieldId * 19 + 5);
			vec3 fieldSpray = vec3(experimentHash(fieldId * 23 + 1), experimentHash(fieldId * 29 + 2), experimentHash(fieldId * 31 + 3)) - 0.5;
			pos += (field.xyz * fieldVary + fieldSpray * min(fieldPush, 0.5) * 0.45) * maskV;
		}
		experimentTint = field.w * maskV;
		if (uChemistry.x > 0.001) {
			float colony = clamp(max(0.0, field.w) * maskV, 0.0, 1.3);
			float growth = clamp(colony, 0.0, 1.0);
			vec4 spread = sampleExperimentField(int(aVis.z), 1);
			float pulse = clamp(spread.z * maskV, 0.0, 1.0);
			float wave = chemistryWave(base, uChemistry.z, uTime, uChemistryB.y);
			float cover = uChemistryB.z;
			float softness = mix(0.3, 2.2, uChemistryB.x);
			float reach = mix(1.9, mix(0.95, 0.2, cover), growth);
			float dome;
			if (uChemistry.y < 0.5) {
				chemBody = smoothstep(reach, reach + 0.14 * softness, wave);
				dome = smoothstep(reach - 0.1 * softness, reach + 0.9, wave);
				chemCore = smoothstep(reach + 0.3, reach + 0.85, wave);
			} else {
				float width = (uChemistry.y < 1.5 ? 0.2 : 0.05) * mix(0.5, 1.7, cover) * growth;
				chemBody = 1.0 - smoothstep(width, width + (uChemistry.y < 1.5 ? 0.16 : 0.1) * softness, abs(wave));
				dome = chemBody;
				chemCore = smoothstep(0.55, 1.0, chemBody);
			}
			float arrival = smoothstep(0.02, 0.2, growth);
			chemBody = max(chemBody * arrival, pulse * 0.6);
			dome = max(dome * arrival, pulse * 0.5);
			chemRim = chemBody * (1.0 - chemCore) + pulse * 0.8;
			vec3 chemNormal = uMorph < 0.9999 ? mix(aNormal, aNormalB, uMorph) : aNormalB;
			chemNormal = length(chemNormal) > 0.0 ? normalize(chemNormal) : vec3(0.0, 1.0, 0.0);
			float lift = (dome * 0.7 + chemCore * 0.3) * (0.85 + 0.25 * wave) * (1.0 + uBeat * 0.3);
			pos += chemNormal * lift * uChemistry.x;
		}
		float hungerInk = uExperimentSim.w;
		if (hungerInk > 0.001) {
			vec4 contact = sampleExperimentField(int(aVis.z), 1);
			autoLight = smoothstep(0.09, 0.75, max(contact.y, length(field.xyz))) * maskV * hungerInk;
			float grain = experimentHash(int(floor(aIdx * uExperimentView.w + 0.5)) + 931);
			bite = smoothstep(0.23, 0.66, contact.x) * smoothstep(grain * 0.85, grain * 0.85 + 0.12, contact.x) * maskV;
		}
	}
	if (uImpossible.x > 0.001) {
		float turn = fract(uExperimentView.x / 6.2831853) * 3.0;
		float width = mix(0.4, 0.9, uImpossible.z);
		int pointId = int(floor(aIdx * uExperimentView.w + 0.5));
		float lag = 1.0 - uImpossible.y * 0.5 + experimentHash(pointId * 29 + 7) * uImpossible.y;
		float first = 1.0 - smoothstep(0.06, width, min(turn, 3.0 - turn) * lag);
		float second = 1.0 - smoothstep(0.06, width, abs(turn - 1.0) * lag);
		float third = 1.0 - smoothstep(0.06, width, abs(turn - 2.0) * lag);
		shiftGlow = min(1.0, 4.0 * (first * (1.0 - first) + second * (1.0 - second) + third * (1.0 - third))) * uImpossibleMix.w * uImpossible.x * maskV;
		vec3 formNormal = uMorph < 0.9999 ? mix(aNormal, aNormalB, uMorph) : aNormalB;
		formNormal = length(formNormal) > 0.0 ? normalize(formNormal) : vec3(0.0, 1.0, 0.0);
		int idA = int(uImpossibleStyle.x + 0.5), idB = int(uImpossibleStyle.y + 0.5), idC = int(uImpossibleStyle.z + 0.5);
		vec3 targetA = base + (viewForm(idA, base, formNormal, pointId, uExperimentView.x) - base) * uImpossibleMix.x;
		vec3 targetB = base + (viewForm(idB, base, formNormal, pointId, uExperimentView.x) - base) * uImpossibleMix.y;
		vec3 targetC = base + (viewForm(idC, base, formNormal, pointId, uExperimentView.x) - base) * uImpossibleMix.z;
		int q = int(min(floor((float(pointId) + 0.5) * uExperimentShapeInfo.x / max(1.0, uExperimentView.w)), uExperimentShapeInfo.x - 1.0));
		int flags = int(uExperimentShapeInfo.z);
		int rows = int(uExperimentShapeInfo.y);
		if (idA == 8 && first > 0.0001 && (flags % 2) == 1) {
			vec4 sampleA = texelFetch(uExperimentShapes, ivec2(q % 256, q / 256), 0);
			targetA = sampleA.xyz + uCen;
			sculptColor += experimentColor(sampleA.w) * first;
			sculptMix += first;
		}
		if (idB == 8 && second > 0.0001 && ((flags / 2) % 2) == 1) {
			vec4 sampleB = texelFetch(uExperimentShapes, ivec2(q % 256, q / 256 + rows), 0);
			targetB = sampleB.xyz + uCen;
			sculptColor += experimentColor(sampleB.w) * second;
			sculptMix += second;
		}
		if (idC == 8 && third > 0.0001 && flags >= 4) {
			vec4 sampleC = texelFetch(uExperimentShapes, ivec2(q % 256, q / 256 + 2 * rows), 0);
			targetC = sampleC.xyz + uCen;
			sculptColor += experimentColor(sampleC.w) * third;
			sculptMix += third;
		}
		sculptColor /= max(sculptMix, 0.001);
		sculptMix = min(1.0, sculptMix) * uImpossible.x * maskV;
		vec3 toA = targetA - base, toB = targetB - base, toC = targetC - base;
		vec3 axis = vec3(0.28, 0.88, 0.36);
		vec3 arc = cross(axis, toA * first * (1.0 - first) + toB * second * (1.0 - second) - toC * third * (1.0 - third));
		float weights = max(1.0, first + second + third);
		pos += ((toA * first + toB * second + toC * third) / weights + arc * uImpossible.w) * uImpossible.x * maskV;
	}
	if (uRecursion.x > 0.001) {
		float nearLod = uExperimentView.z;
		int pointId = int(floor(aIdx * uExperimentView.w + 0.5));
		float draw = experimentHash(pointId * 17 + 139);
		float levelGate = min(0.97, uRecursion.w * uRecursion.x * maskV * mix(0.45, 1.0, nearLod));
		if (draw < levelGate) {
			float levelDraw = experimentHash(pointId * 29 + 719);
			float first = 1.0 - smoothstep(levelGate - 0.06, levelGate, draw);
			float secondGate = mix(0.29, 0.66, nearLod);
			float thirdGate = mix(0.04, 0.25, nearLod);
			float second = 1.0 - smoothstep(secondGate - 0.06, secondGate, levelDraw);
			float third = 1.0 - smoothstep(thirdGate - 0.035, thirdGate, levelDraw);
			int row = int(uExperimentShapeInfo.y) * 3;
			vec3 copyCenter = uCen;
			float copyScale = 1.0;
			float copyYaw = 0.0;
			float copyLayout = uRecursionStyle.w;
			for (int i = 0; i < 3; i++) {
				if (float(i) >= uRecursion.y) break;
				float weight = first * (i == 0 ? 1.0 : i == 1 ? second : third);
				if (weight <= 0.001) break;
				float copies = max(2.0, floor(uRecursionStyle.x / float(i + 1)));
				float groupId = floor(experimentHash(pointId * (41 + i * 12) + 1279 + i * 193) * copies);
				vec3 anchor = texelFetch(uExperimentShapes, ivec2(int(groupId), row), 0).xyz - uCen;
				float turn = (groupId / copies) * 6.2831853 + float(i) * 0.62;
				if (copyLayout > 1.5) {
					float height = groupId / max(1.0, copies - 1.0) - 0.5;
					anchor = vec3(cos(turn * 1.7) * 0.88, height * 1.72, sin(turn * 1.7) * 0.88);
				} else if (copyLayout > 0.5) {
					anchor = vec3(cos(turn), sin(turn * 2.0) * 0.23, sin(turn));
				}
				copyCenter += experimentYaw(anchor, copyYaw) * uRecursionStyle.y * copyScale * weight;
				copyYaw += sin(turn + 0.74) * uRecursionStyle.z * weight;
				copyScale *= mix(1.0, uRecursion.z, weight);
				experimentScale *= mix(1.0, mix(0.42, 0.96, uRecursionLook.x) + nearLod * 0.06, weight);
				copyShade += weight * uRecursionLook.y * 0.36;
			}
			pos = copyCenter + experimentYaw(pos - uCen, copyYaw) * copyScale;
		}
	}
#endif
	if (gScopeG > 0.01) pos += (vec3(hash11(aIdx * 13.1), hash11(aIdx * 7.7), hash11(aIdx * 3.3)) - 0.5) * gScopeG * uScopeQ.w * 0.4;
	if (uFr.x > 0.5) pos += frNrm * frLift * 0.7;
	float dkv = gDisK;
	vDk = max(max(max(dkv, gDrop), 1.0 - gGrow), bite);
	float t = uTime - uTOff;
	float disp = clamp(length(pos - base) * 1.5, 0.0, 1.0);
	float k;
	if (uColorBy < 0.5) k = clamp(disp + uBeat * 0.12, 0.0, 1.0);
	else if (uColorBy < 1.5) k = clamp((pos.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	else k = fract(aIdx * 3.0 + t * 0.03);
	vec3 col = k < 0.5 ? mix(uP0, uP1, k * 2.0) : mix(uP1, uP2, (k - 0.5) * 2.0);

	float ltC = uMorph < 0.9999 ? gMorphLT : 1.0;
	float eC = uMorph < 0.9999 ? (int(uMorphS.x + 0.5) == 2 ? smoothstep(0.5, 0.9, ltC) : morphEase(ltC)) : 1.0;
	vec3 colM = mix(aColor, aColorB, eC);
	if (uFr.x > 0.5) colM = frCol;
	colM = mix(colM, sculptColor, sculptMix);
#ifdef VSCREEN
#ifndef HERO

	if (uSlit.x > 0.001) {
		float sip = floor(aIdx * uSlitG.z + 0.5);
		float sci = mod(sip, uSlitG.x);
		float scj = floor(sip / uSlitG.x);
		vec2 suv0 = vec2((sci + 0.5) / uSlitG.x, (scj + 0.5) / uSlitG.y);
		int sm = int(uSlit.w + 0.5);
		float sf;
		if (sm == 0) sf = suv0.y;
		else if (sm == 1) sf = suv0.x;
		else if (sm == 2) sf = clamp(length((suv0 - 0.5) * vec2(uSlitG.x / uSlitG.y, 1.0)) * 1.25, 0.0, 1.0);
		else if (sm == 3) sf = uDepth.x > 0.001 ? 1.0 - gDepth : 1.0 - gLum;
		else sf = snoise(vec3(suv0 * vec2(uSlitG.x / uSlitG.y, 1.0) * 2.5, uTime * 0.12)) * 0.5 + 0.5;
		if (uSlitP.y > 0.001) sf = fract(sf + uTime * uSlitP.y * 0.25);
		if (uSlitP.w > 1.5) sf = floor(sf * uSlitP.w) / (uSlitP.w - 1.0);
		sf = clamp(sf, 0.0, 1.0);
		if (uSlitP.x < 0.0) sf = 1.0 - sf;
		float sd = sf * uSlit.y * (uSlitG.w - 1.0);
		float s0 = floor(sd);
		int sl0 = int(mod(uSlit.z - s0 + uSlitG.w * 8.0, uSlitG.w));
		int sl1 = int(mod(uSlit.z - s0 - 1.0 + uSlitG.w * 8.0, uSlitG.w));
		vec3 scol = mix(texelFetch(uSlitTex, ivec3(int(sci), int(scj), sl0), 0).rgb, texelFetch(uSlitTex, ivec3(int(sci), int(scj), sl1), 0).rgb, sd - s0);
		float sk = min(uSlit.x, 1.0);
		colM = mix(colM, scol, sk);

		pos.z -= sf * uSlit.y * uSlitP.z * 1.2 * sk;
	}

	if (uSort.x > 0.001) {
		float qi = floor(aIdx * uSortP.x + 0.5);
		vec2 qd = texelFetch(uSortTex, ivec2(int(mod(qi, 2048.0)), int(floor(qi / 2048.0))), 0).xy;
		float qline = uSort.w > 0.5 ? mod(qi, uSortP.y) : floor(qi / uSortP.y);
		int qm = int(uSort.y + 0.5);
		float qk = 1.0;
		if (qm == 1) qk = 0.5 + 0.5 * sin(uTime * uSort.z * 1.6 - qline * 0.07);
		else if (qm == 2) qk = clamp(uBeat * 1.4, 0.0, 1.0);
		else if (qm == 3) qk = 0.5 + 0.5 * sin(uTime * uSort.z * 1.2);
		qk = qk * qk * (3.0 - 2.0 * qk) * min(uSort.x, 1.0);
		pos.xy += qd * qk * uSortP.z;

		colM *= 1.0 + min(length(qd) * 6.0, 1.0) * qk * uSortP.w;
	}

	if (uTsplit.x > 0.001 || uMrel.x > 0.001) {
		float histTotal = uHist.x * uHist.y;
		float histIndex = floor(aIdx * histTotal + 0.5);
		int hx = int(mod(histIndex, uHist.x));
		int hy = int(floor(histIndex / uHist.x));
		ivec2 hmax = ivec2(int(uHist.x) - 1, int(uHist.y) - 1);
		if (uTsplit.x > 0.001) {
			int splitMode = int(uTsplit.y + 0.5);
			float spreadAge = uTsplit.z;
			vec2 offset = vec2(cos(uTsplit2.y), sin(uTsplit2.y)) * uTsplit2.x;
			ivec2 here = ivec2(hx, hy);
			ivec2 redAt = here;
			ivec2 blueAt = here;
			float greenAge = 0.0;
			float blueAge = 0.0;
			if (splitMode != 1) {
				greenAge = spreadAge;
				blueAge = spreadAge * 2.0;
			}
			if (splitMode != 0) {
				redAt = clamp(here + ivec2(int(floor(offset.x + 0.5)), int(floor(offset.y + 0.5))), ivec2(0), hmax);
				blueAt = clamp(here - ivec2(int(floor(offset.x + 0.5)), int(floor(offset.y + 0.5))), ivec2(0), hmax);
			}
			vec3 sr = histColor(redAt.x, redAt.y, 0.0);
			vec3 sg = histColor(hx, hy, greenAge);
			vec3 sb = histColor(blueAt.x, blueAt.y, blueAge);
			vec3 split = vec3(sr.r, sg.g, sb.b);
			vec3 neutral = (sr + sg + sb) / 3.0;
			split = neutral + (split - neutral) * (1.0 - uTsplit.w * 0.75);
			float splitLum = dot(split, vec3(0.3, 0.59, 0.11));
			split = mix(vec3(splitLum), split, uTsplit2.z) * uTsplit2.w;
			colM = mix(colM, split, min(uTsplit.x, 1.0));
		}
		if (uMrel.x > 0.001) {
			vec3 present = histColor(hx, hy, 0.0);
			float energy = 0.0;
			float energyMax = 0.0;
			for (int i = 1; i <= 4; i++) {
				vec3 past = histColor(hx, hy, float(i) * uMrel.w * 0.25);
				vec3 pastRight = histColor(min(hx + 1, hmax.x), hy, float(i) * uMrel.w * 0.25);
				vec3 pastDown = histColor(hx, min(hy + 1, hmax.y), float(i) * uMrel.w * 0.25);
				float d = length(present - past) * 0.5 + length(histColor(min(hx + 1, hmax.x), hy, 0.0) - pastRight) * 0.25 + length(histColor(hx, min(hy + 1, hmax.y), 0.0) - pastDown) * 0.25;
				energy += d * 0.25;
				energyMax = max(energyMax, d);
			}
			energy = mix(energy, energyMax, 0.4);
			energy = smoothstep(uMrel2.x, uMrel2.x + 0.12 / max(uMrel.z, 0.3), energy) * min(1.0, energy * uMrel.z * 1.4);
			energy = energy * energy * (3.0 - 2.0 * energy) * min(uMrel.x, 1.0);
			vec3 liftNormal = uMorph < 0.9999 ? mix(aNormal, aNormalB, uMorph) : aNormalB;
			liftNormal = length(liftNormal) > 0.0 ? normalize(liftNormal) : vec3(0.0, 0.0, 1.0);
			int liftMode = int(uMrel.y + 0.5);
			if (liftMode == 1) {
				float lh = experimentHash(int(floor(aIdx * uExperimentView.w + 0.5)) * 5 + 11);
				vec3 scatter = vec3(experimentHash(int(histIndex) * 3 + 1), experimentHash(int(histIndex) * 7 + 2), experimentHash(int(histIndex) * 13 + 3)) - 0.5;
				pos += (liftNormal * 0.7 + scatter * 1.2) * energy * uMrel3.x * (0.5 + lh * 0.5);
			} else if (liftMode == 2) {
				pos += vec3(0.0, 1.0, 0.0) * energy * uMrel3.x * 0.5;
			} else {
				pos += liftNormal * energy * uMrel3.x * 0.5;
			}
			vec3 hot = experimentPalette(0.55 + 0.45 * energy);
			colM = mix(colM, hot * (0.7 + 0.8 * energy), uMrel2.w * energy);
			colM *= 1.0 - uMrel2.y * (1.0 - energy) * min(uMrel.x, 1.0);
			experimentScale *= 1.0 + energy * uMrel2.z;
		}
	}
#endif
#endif
	vec3 nrmM = mix(aNormal, aNormalB, eC);
	if (uColorBy > 2.5 && uColorBy < 3.5) col = colM;
	else if (uColorBy > 3.5 && uColorBy < 4.5) col = uSolid;
	else if (uColorBy > 4.5) {
		vec3 wn = mat3(modelMatrix) * nrmM;
		wn = length(wn) > 0.0 ? normalize(wn) : vec3(0.0, 1.0, 0.0);
		col = pow(wn * 0.5 + 0.5, vec3(2.2));
	}

	float vm = uMorph * uMorph * (3.0 - 2.0 * uMorph);
	float vis = mix(aVis.x, aVis.y, vm);
	float wound = max(0.0, -experimentTint);
	float rim = smoothstep(0.05, 0.21, wound) * (1.0 - smoothstep(0.24, 0.65, wound));
	vColor = mix(col, sculptColor, sculptMix) * uBright * (1.0 + uBeat * 0.3) * vis;
	vColor *= (1.0 - 0.32 * wound - 0.2 * copyShade) * (1.0 - bite);
	vColor += (mix(uP1, uP2, 0.65) * rim * uExperimentSim.z * 0.65 + experimentPalette(uExperimentTint.x) * autoLight * 0.38) * uBright * vis;
	if (uChemistry.x > 0.001) {
		float pigment = chemBody * uExperimentSim.y;
		float hue = uExperimentTint.z;
		vec3 dye = mix(experimentPalette(hue + chemCore * 0.4), col * 1.6, uExperimentTint.w) * uBright * vis;
		vColor = mix(vColor * (1.0 - 0.38 * uExperimentSim.y), vColor * 0.4 + dye * 1.15, pigment);
		vColor += experimentPalette(hue + 0.45) * chemRim * uExperimentSim.y * (0.4 + 0.9 * uChemistry.w + uBeat * 0.4) * uBright * vis;
		experimentScale *= 1.0 + chemBody * 0.44 * uChemistryB.w + chemRim * 0.76 * uChemistryB.w;
	}
	vColor += uP2 * shiftGlow * 0.1 * uBright * vis;
	experimentScale *= (1.0 + rim * 0.23 + shiftGlow * 0.14) * (1.0 - bite * 0.78);

	if (uPaintP.x > 0.5 && aPaint.w > 0.002) {
		float pa = aPaint.w;
		float cov = 1.0 - exp(-pa * 3.4);
		cov *= mix(1.0, 0.8 + 0.4 * hash11(aIdx * 91.7), uPaintP.y);
		vec3 pig = pow(max(aPaint.rgb, vec3(0.002)), vec3(0.7 + 0.5 * min(pa, 1.6)));
		vColor = uPaintP.z > 0.5 ? vColor * mix(vec3(1.0), pig * 1.15, cov) : mix(vColor, pig * uBright, cov);
	}
	if (uMask.x > 0.5 && uMaskShow > 0.5) vColor = mix(vColor, uP2 * 1.4, maskV * 0.55);

	if (uCh.x > 0.001) vColor *= mix(1.0, 0.45 + 1.1 * gChN, min(uCh.x, 1.0));

	if (uHyp.x > 0.001) {
		float hk4 = clamp((gHypW + 1.0) * 0.5, 0.0, 1.0);
		vec3 hc = hk4 < 0.5 ? mix(uP0, uP1, hk4 * 2.0) : mix(uP1, uP2, (hk4 - 0.5) * 2.0);
		vColor = mix(vColor, hc * uBright * (0.55 + 0.9 * dot(vColor, vec3(0.3, 0.59, 0.11))), uHypP.y * min(uHyp.x, 1.0));
	}

	vColor *= 1.0 - 0.6 * gHypF;

	if (uShade > 0.001 && dot(nrmM, nrmM) > 0.01) {
		vec3 nv = normalize(normalMatrix * nrmM);
		float lit = dot(nv, normalize(vec3(-0.45, 0.65, 0.6)));
		float f = 0.18 + 1.05 * pow(clamp(lit * 0.5 + 0.5, 0.0, 1.0), 1.6);
		f *= nv.z < 0.0 ? mix(1.0, 0.55, clamp(-nv.z * 1.6, 0.0, 1.0)) : 1.0;
		vColor *= mix(1.0, f, uShade);
	}
	if ((uLookP4.y > 0.001 || uLookP4.z > 0.001) && dot(nrmM, nrmM) > 0.01) {
		vec3 nvr = normalize(normalMatrix * nrmM);
		float rimF = pow(1.0 - clamp(abs(nvr.z), 0.0, 1.0), 2.0);
		vColor += (vColor * 0.7 + 0.2) * rimF * uLookP4.y * 1.6;
		vec3 pearl = 0.5 + 0.5 * cos(6.2831853 * (rimF * 0.9 + hash11(aIdx * 0.37) * 0.15 + vec3(0.0, 0.33, 0.67)));
		float lumR = dot(vColor, vec3(0.3, 0.59, 0.11));
		vColor = mix(vColor, pearl * (0.35 + lumR * 1.3), uLookP4.z * (0.25 + 0.65 * rimF));
	}
	if (uLookP4.w > 0.001) {
		float twk = pow(0.5 + 0.5 * sin(uTime * (1.5 + hash11(aIdx * 3.1) * 4.0) + hash11(aIdx) * 40.0), 6.0);
		vColor *= 1.0 + uLookP4.w * 3.0 * twk;
	}
	vGl = clamp(sqrt(max(dot(vColor, vec3(0.3, 0.59, 0.11)), 0.0)) * 0.85 + (hash11(aIdx * 1.7) - 0.5) * 0.35, 0.0, 1.0);

	if (uBrushParam.x > 0.001) {
		float bGlow = 0.0;
		for (int i = 0; i < 20; i++) {
			float age = uBrushHits[i].w;
			if (age < 0.0) continue;
			float dist = distance(base, uBrushHits[i].xyz);
			if (dist < uBrushParam.y) {
				float life = 1.0 - age / uBrushParam.z;
				bGlow = max(bGlow, (1.0 - dist / uBrushParam.y) * life);
			}
		}
		if (bGlow > 0.001) vColor += uP2 * bGlow * 2.2 * uBrushParam.x;
	}

	if (uHandP.x > 0.001) {
		float hg = 0.0;
		for (int i = 0; i < 12; i++) {
			if (float(i) >= uHandP.w) break;
			float hdst = distance(pos, uHand[i].xyz);
			if (hdst < uHandP.y) hg = max(hg, (1.0 - hdst / uHandP.y) * (uHand[i].w > 1.5 ? uHand[i].w - 2.0 : abs(uHand[i].w)));
		}
		vColor += uP2 * hg * hg * 1.6 * uHandP.x;
	}

	float mkv = markK(base);
	if (mkv > 0.0) {
		if (uMark.x < 1.5) vColor = mix(vColor, (vec3(1.0) - min(vColor, vec3(1.0))) * 1.3, mkv);
		else if (uMark.x < 2.5) vColor = mix(vColor, hueRot(vColor, uTime * 2.0 + length(base) * 6.0) * 1.15, mkv);
		else if (uMark.x < 3.5) {
			float edge = smoothstep(0.0, 0.35, mkv) * (1.0 - smoothstep(0.35, 0.9, mkv));
			vColor = vColor * (1.0 - smoothstep(0.35, 0.9, mkv)) + uMarkC * edge * 2.0;
		} else if (uMark.x < 4.5) vColor *= 1.0 + mkv * 0.8;
		else if (uMark.x > 5.5) vColor += uMarkC * mkv * 1.8;
	}

	float cvan = 0.0;
	if (uContact.z > 6.5 && uContact.x > 0.001) {
		cvan = contactK(base);
		vColor *= 1.0 - smoothstep(0.1, 0.8, cvan);
	}

	float sl = 0.0;
	if (uSlice.x > 0.001) {
		float axCode = mod(uSlice.w, 10.0);
		float nLines = max(1.0, floor(uSlice.w / 10.0));
		float c = axCode < 0.5 ? base.y : (axCode < 1.5 ? base.x : (axCode < 2.5 ? base.z : (base.x + base.y) * 0.707));
		float v = clamp((c + 1.2) / 2.4, 0.0, 1.0);
		if (uSliceM.x > 1.5) {
			float d = uSlice.y - v;
			sl = (1.0 - smoothstep(0.0, uSlice.z * 0.3 + 0.012, abs(d))) * uSlice.x;
			vColor *= mix(1.0, smoothstep(-0.012, 0.012, d), min(uSlice.x, 1.0));
			vColor += (uSliceM.z > 0.5 ? vColor * 0.25 : uSliceC) * sl * 2.4;
		} else {
			float coord = mod(v * nLines - uSlice.y * nLines, 1.0);
			sl = (1.0 - smoothstep(uSlice.z * 0.4, uSlice.z, abs(coord - 0.5))) * uSlice.x;
			vColor += (uSliceM.z > 0.5 ? vColor * 0.25 : uSliceC) * sl * 2.2;
		}
	}

	if (uDepth.x > 0.001) {
		if (uDepthP.w > 1.5) {

			vec3 jet = clamp(vec3(1.5 - abs(4.0 * gDepth - 3.0), 1.5 - abs(4.0 * gDepth - 2.0), 1.5 - abs(4.0 * gDepth - 1.0)), 0.0, 1.0);
			vColor = mix(vColor, jet * (0.4 + 0.95 * dot(vColor, vec3(0.3, 0.59, 0.11))), 0.88);
		} else if (uDepthP.w > 0.5) vColor = vec3(gDepth);
	}

	if (uScope.x > 0.001) {
		vColor = mix(vColor, uScopeC * 1.4, uScopeQ.x * gScopeT);
		vColor += uScopeC * gScopeG * uScopeQ.z * 3.0;
	}

	if (gGl > 0.0) {
		vColor *= 0.55 + 0.45 * hash11(floor(uTime * 24.0) + floor(pos.y * 14.0));
		vColor *= 1.0 - 0.45 * min(gGl, 1.0) * step(0.5, fract(pos.y * 38.0));
		if (gCh > -0.5) vColor = mix(vColor, vColor * vec3(gCh < 0.5 ? 2.2 : 0.05, abs(gCh - 1.0) < 0.5 ? 2.2 : 0.05, gCh > 1.5 ? 2.2 : 0.05), min(1.0, gGl));

		vColor += vec3(0.25, 0.3, 0.35) * gBurst * min(gGl, 1.0);
	}

	if (uGrowP.z > 0.5) vColor += mix(vec3(0.3, 0.95, 0.4), uP2, 0.3) * pow(gGrowE, 1.6) * 0.55;

	if (dkv > 0.0) {
		float edge = smoothstep(0.02, 0.25, dkv) * (1.0 - smoothstep(0.25, 0.75, dkv));
		if (uDisP.x > 0.5 && uDisP.x < 1.5) vColor += vec3(1.0, 0.42, 0.08) * edge * 2.4;
		else vColor += uP2 * edge * uDisQ.z * 2.0;
	}

	float mkm = 0.0;
	if (uMorph < 0.9999 && uMorphO.z > 0.001) {
		mkm = sin(gMorphLT * PI) * uMorphO.z;
		vColor += vColor * mkm * 1.1 + uP2 * mkm * 0.25;
	}

	float mfs = uMorph < 0.9999 ? mix(1.0, uMorphD.w, sin(gMorphLT * PI)) : 1.0;

	if (uSettle >= 0.0 && uSettle < 1.0) {
		float yS = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float dd = (yS - (uSettle * 1.35 - 0.15)) / 0.14;
		float band = exp(-dd * dd) * (1.0 - uSettle);
		mkm += band * 1.0;
		vColor += vColor * band * 0.9 + uP2 * band * 0.2;
		pos += normalize(vec3(pos.x, 0.0, pos.z) + vec3(1e-4)) * band * 0.03;
	}
#ifdef VSHOOT

	float shSzMul = 1.0;
	if (uShoot.x > 0.001) {
		vec3 bsh = base - uCen;
		vec3 nsh = dot(nrmM, nrmM) > 0.01 ? normalize(nrmM) : normalize(bsh + vec3(1e-4));
		vec3 shOff = vec3(0.0);
		float shK = 0.0;
		float hsh = hash11(aIdx * 3.77);
		bool shFam = (uShoot.y > 1.5 && uShoot.y < 2.5) || uShoot.y > 3.5;

		float bm = 0.0;
		float bd = 1.0;
		vec4 bs = vec4(0.0);
		vec4 bn = vec4(0.0, 0.0, 1.0, 1.0);
		for (int i = 0; i < 24; i++) {
			vec4 sd = uShootS[i];
			if (sd.w < 0.002) continue;
			float dsh = distance(base, sd.xyz) / uShoot.z;
			if (dsh >= 1.0) continue;
			if (shFam) {
				float m = 1.0 - smoothstep(1.0 - max(uShootE.x, 0.02), 1.0, dsh);
				if (m > bm) {
					bm = m;
					bd = dsh;
					bs = sd;
					bn = uShootN[i];
				}
				continue;
			}
			float pr = 1.0 - dsh;
			float grow = sd.w * uShoot.w;
			if (uShoot.y < 0.5) {
				pr = pr * pr * pr;
				shOff += nsh * pr * grow;
			} else if (uShoot.y < 1.5) {
				pr = pr * pr * (3.0 - 2.0 * pr);
				shOff += nsh * pr * grow * 0.55;
			} else {
				pr = pr * pr;
				float ph = uShootP.z * 2.2 + float(i) * 1.7;
				vec3 side = normalize(cross(nsh, vec3(0.31, 0.92, 0.23)) + vec3(1e-4));
				shOff += nsh * pr * grow + side * sin(ph + dsh * 9.0) * pr * grow * (0.25 + 0.6 * uShootP.y);
			}
			shK = max(shK, pr * min(sd.w * 1.5, 1.0));
		}
		if (shFam && bm > 0.0) {

			float d = bs.w * (1.0 - uShootE.y * hsh);
			float stp = max(uShootD.y, 0.005);
			vec3 dn = length(bn.xyz) > 0.01 ? normalize(bn.xyz) : normalize(bs.xyz - uCen + vec3(1e-4));
			if (uShootD.x > 0.5 && uShootD.x < 1.5) dn = normalize(bs.xyz - uCen + vec3(1e-4));
			else if (uShootD.x > 1.5 && uShootD.x < 2.5) dn = vec3(0.0, 1.0, 0.0);
			else if (uShootD.x > 2.5) dn = normalize(vec3(modelViewMatrix[0][2], modelViewMatrix[1][2], modelViewMatrix[2][2]) + vec3(1e-5));
			float md = uShoot.y;
			vec3 off;
			if (md < 2.5) {

				off = dn * d * bm;
			} else if (md < 4.5) {

				float tt = hash11(aIdx * 5.13);
				float pf = pow(tt, 0.75) * smoothstep(0.0, 0.6, bm);
				vec3 prel = base - bs.xyz;

				off = dn * d * pf - (prel - dn * dot(dn, prel)) * uShootE.z * clamp(d * pf * 1.5 / uShoot.z, 0.0, 1.0);
			} else if (md < 5.5) {

				float tiers = max(uShootD.z, 2.0);
				float ring = min(floor((1.0 - bd) * tiers + 0.001), tiers - 1.0);
				off = dn * d * mix(0.25, 1.0, ring / (tiers - 1.0)) * bm;
			} else if (md < 6.5) {

				vec3 cl = floor(base / max(uShoot.z * (0.08 + 0.55 * uShootD.z), 0.01));
				float hc = hash11(dot(cl, vec3(17.13, 31.71, 57.29)));
				vec3 tilt = vec3(hash11(hc * 91.0), hash11(hc * 57.0), hash11(hc * 33.0)) - 0.5;
				off = normalize(dn + tilt * 0.7) * d * (0.45 + hc * 1.1) * bm;
			} else if (md < 7.5) {

				float layer = floor(hash11(aIdx * 9.71) * max(uShootD.z, 2.0));
				off = dn * max(0.0, d - layer * stp * 0.75) * bm;
			} else if (md < 8.5) {

				vec3 rel = base - bs.xyz;
				float ang = d / stp * 0.6 * uShootD.z;
				float ca = cos(ang), sa = sin(ang);
				vec3 rr = rel * ca + cross(dn, rel) * sa + dn * dot(dn, rel) * (1.0 - ca);
				off = (rr - rel + dn * d) * bm;
			} else {

				vec3 rd = vec3(hash11(aIdx * 1.3), hash11(aIdx * 2.9), hash11(aIdx * 5.1)) - 0.5;
				off = normalize(dn + rd * uShootD.z) * d * (0.35 + hash11(aIdx * 7.7) * 1.3) * bm;
			}

			off += vec3(sin(uShootP.z * 1.7 + hsh * 6.283), cos(uShootP.z * 1.3 + hsh * 4.1), sin(uShootP.z * 1.1 + hsh * 2.7)) * 0.03 * min(d, 1.0) * uShootP.y * bm;
			shOff += off;
			float stK = clamp(d / stp, 0.0, 1.0);
			shK = max(shK, bm * stK);
			shSzMul = 1.0 + bm * stK * uShootP.w;

			vColor *= mix(1.0, bn.w, bm);
			shSzMul *= mix(1.0, max(bn.w, 0.05), bm);
		}

		if (!shFam) shOff *= 1.0 + uShootP.y * 0.1 * sin(uShootP.z * 3.0 + hsh * 6.283);
		pos += shOff * min(uShoot.x, 1.0);
		vColor += (uP2 * 1.4 + vColor * 0.3) * shK * uShootP.x * min(uShoot.x, 1.0);
	}
#endif
#ifdef VSCREEN

	if (uScr.x > 0.001) {
		vec3 bsx = base - uCen;
		float hyx = max(uYR.y - uYR.x, 1e-4);
		float arx = max(uScrP.w, 0.05);
		vec2 suv;
		float smask = 1.0;
		if (uScr.y < 0.5) {

			suv = vec2(atan(bsx.z, bsx.x) / 6.2831853 + 0.5, clamp((base.y - uYR.x) / hyx, 0.0, 1.0));
			suv.x = fract((suv.x - 0.5) / uScr.z + 0.5);
		} else if (uScr.y < 1.5 || uScr.y > 2.5) {

			suv = vec2(0.5 + bsx.x / (hyx * arx), 0.5 + (base.y - (uYR.x + uYR.y) * 0.5) / hyx);
			suv = (suv - 0.5) / uScr.z + 0.5;
			float cr = cos(uScrP.x), sr = sin(uScrP.x);
			suv = vec2(cr * (suv.x - 0.5) - sr * (suv.y - 0.5), sr * (suv.x - 0.5) + cr * (suv.y - 0.5)) + 0.5;
			smask = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
			if (dot(nrmM, nrmM) > 0.01) smask *= smoothstep(-0.35, 0.25, nrmM.z);
		} else {

			vec4 cpx = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
			vec2 nd = cpx.xy / max(cpx.w, 1e-4);
			float scrAsp = projectionMatrix[1][1] / projectionMatrix[0][0];
			suv = vec2(0.5 + nd.x * 0.5 * scrAsp / arx, 0.5 + nd.y * 0.5);
			suv = (suv - 0.5) / uScr.z + 0.5;
			float cr = cos(uScrP.x), sr = sin(uScrP.x);
			suv = vec2(cr * (suv.x - 0.5) - sr * (suv.y - 0.5), sr * (suv.x - 0.5) + cr * (suv.y - 0.5)) + 0.5;
			smask = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
		}
		vec3 scr = texture2D(uScrTex, clamp(suv, 0.0, 1.0)).rgb * uScr.w;
		float slum = dot(scr, vec3(0.3, 0.59, 0.11));

		float sdv = 0.0;
		if (uScrD.x > 0.5) {
			sdv = uScrD.x < 1.5 ? clamp(slum / max(uScr.w, 0.05), 0.0, 1.0) : texture2D(uScrDep, clamp(suv, 0.0, 1.0)).r;
			sdv = clamp((sdv - 0.5) * uScrD.w + 0.5, 0.0, 1.0);
			if (uScrD.z < 0.0) sdv = 1.0 - sdv;
			if (uScrQ.x > 0.5) scr = vec3(sdv);
		}
#ifndef HERO

		vec4 smem = vec4(0.0);
		if (uScrQ.y > 0.5) {
			float smi = floor(aIdx * uScrMN + 0.5);
			smem = texelFetch(uScrMTex, ivec2(int(mod(smi, 2048.0)), int(floor(smi / 2048.0))), 0);
			smem.rgb = smem.rgb * smem.rgb * 4.0;
			scr = max(scr, smem.rgb);
		}
#endif
		vColor = mix(vColor, mix(vColor * 0.35, scr, uScrP.z), smask * uScr.x);
#ifndef HERO
		if (uScrQ.y > 0.5) vColor = mix(vColor, mix(vColor * 0.35, smem.rgb, uScrP.z), smem.a * (1.0 - smask) * uScr.x);
#endif
		if (uScrD.x > 0.5) {
			vec3 dirn = dot(nrmM, nrmM) > 0.01 ? normalize(nrmM) : normalize(bsx + vec3(1e-4));
			pos += dirn * sdv * uScrD.y * 0.45 * smask * uScr.x;
		}
	}
#endif
	if (gCrumbleLive > 0.5) {
		pos = gCrumblePos;
		vColor *= 1.0 - gCrumbleFade * 0.85;
	}
#ifdef SHADOW

	float shA = 0.0;
	{
		vec3 swp = (modelMatrix * vec4(pos, 1.0)).xyz;
		vec3 shN = uShdL.w < 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
		vec3 shL = normalize(uShdL.xyz);
		float shh = dot(swp, shN) - uShdP.x;
		vec3 ssp = swp - shL * (shh / max(dot(shL, shN), 0.08));
		if (uShd.w > 0.001) {

			vec3 st1 = vec3(1.0, 0.0, 0.0);
			vec3 st2 = uShdL.w < 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
			ssp += (st1 * snoise(ssp * 1.4 + vec3(0.0, uTime * 0.7, 0.0)) + st2 * snoise(ssp * 1.4 + vec3(5.0, -uTime * 0.6, 3.0))) * uShd.w * 0.12;
		}
		ssp += shN * 0.003;
		shA = uShd.x * exp(-max(shh, 0.0) * uShdP.y) * (shh < -0.03 ? 0.0 : 1.0);
		vColor = uShd.z < 0.5 ? uShdC : (uShd.z < 1.5 ? uP2 * 1.4 * uBright : colM * uBright * 1.3);
		pos = ssp;
	}
	vD = shA;
	vec4 mv = viewMatrix * vec4(pos, 1.0);
#else
	vD = disp;
	vec4 mv = modelViewMatrix * vec4(pos, 1.0);
#endif
#ifndef SHADOW
	if (uLookP3.x > 0.001) {
		float fogZ = (-mv.z - uLookP3.y) / max(0.2, uLookP3.y * 0.45);
		vDk = max(vDk, uLookP3.x * 0.9 * smoothstep(-0.4, 1.1, fogZ));
	}
#endif
	gl_Position = projectionMatrix * mv;

	float szNoise = 1.0;
	if (uLookP2.x > 0.001) {
		szNoise = 1.0 + uLookP2.x * (snoise(base * 2.2 + uTime * 0.4) * 0.75);
	}
	float szAudio = 1.0;
	if (uLookP2.y > 0.001) {
		float bandAudio = mix(uBeat, uSpec.x, step(0.0, base.y));
		szAudio = 1.0 + uLookP2.y * (bandAudio * 1.2 * (0.6 + 0.4 * sin(aIdx * 62.8)));
	}

	float coc = 0.0;
	if (uDof.x > 0.5) {
		float viewDist = -mv.z;
		coc = clamp(abs(viewDist - uDof.y) / max(0.05, uDof.z), 0.0, 1.0);
	}
	vCoc = coc;

	float s = uSize * uPR * (1.0 + disp * 0.5 + uBeat * 0.2 + sl * 1.2 + mkm * 0.7) * uGlyph.y * HEROSIZE * mfs;
#ifdef VSHOOT
	s *= shSzMul;
#endif
	s *= max(0.15, szNoise * szAudio) * (1.0 - uDisQ.w * dkv) * mix(0.3, 1.0, gGrow) * (1.0 + (uMark.x > 3.5 && uMark.x < 4.5 ? mkv * 0.9 : 0.0)) * (1.0 - 0.6 * (uMark.x > 2.5 && uMark.x < 3.5 ? smoothstep(0.35, 0.9, mkv) : 0.0)) * (1.0 - 0.7 * smoothstep(0.3, 0.8, cvan)) * (0.25 + 0.75 * vis);
	s *= (1.0 + coc * 2.4);
	s *= 1.0 - 0.85 * gHypF;
	s *= (1.0 + gScopeT * uScopeQ.y + gScopeG * uScopeQ.z * 2.5 + gDepthG * 0.8) * (1.0 - gScopeD);

	s *= uAtt > 0.001 ? 0.73 * uAtt / max(-mv.z, uAtt * 0.1) : 0.73;
	s *= 1.0 + 0.5 * uLookP3.z;
#ifndef SHADOW
	if (uAdd > 0.5) s *= 0.5 + uGlow;
#endif
#ifdef SHADOW
	s *= mix(1.0, 2.8, uShd.y);
#endif
	gl_PointSize = clamp(s * experimentScale * (1.0 - 0.45 * gCrumbleFade), 1.0, 95.0);
	if (gScopeD > 0.97 || dkv > 0.97 || gDrop > 0.5 || gGrow < 0.03 || gHypF > 0.97 || bite > 0.97) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
	}
#ifdef TRACKPICK

	vColor = pos;
	gl_Position = vec4((float(gl_VertexID) + 0.5) / 16.0 * 2.0 - 1.0, 0.0, 0.0, 1.0);
	gl_PointSize = 1.0;
#endif
}
`;
