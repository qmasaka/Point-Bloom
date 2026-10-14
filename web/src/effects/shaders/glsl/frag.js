export const frag = `
precision highp float;
uniform float uGlow;
uniform float uAdd;
uniform vec4 uFr;
uniform float uDens;
uniform float uGhost;
uniform float uShape;
uniform vec3 uGlyph;
uniform sampler2D uAtlas;
varying vec3 vColor;
varying float vD;
varying float vDk;
varying float vCoc;
varying float vGl;
void main() {
	vec2 c = gl_PointCoord - 0.5;
	// форма точки как на вкладке «Точки»: 0 квадрат, 1 круг, 2 шар, 3 кольцо, 4 ромб, 5 плюс
	float dm = length(c);
	float gA = 1.0;
	if (uGlyph.x > 0.5) {
		vec2 guv = vec2((floor(vGl * (uGlyph.z - 0.001)) + gl_PointCoord.x) / uGlyph.z, 1.0 - gl_PointCoord.y);
		gA = texture2D(uAtlas, guv).a;
		if (gA < 0.3) discard;
		dm = 0.0;
	}
	if (uShape < 0.5) dm = max(abs(c.x), abs(c.y));
	else if (uShape > 3.5 && uShape < 4.5) dm = abs(c.x) + abs(c.y);
	if (dm > 0.5) discard;
	if (uShape > 2.5 && uShape < 3.5 && dm < 0.29) discard;
	if (uShape > 4.5 && min(abs(c.x), abs(c.y)) > 0.16) discard;
	float r2 = dm * dm;
	float core = uGlyph.x > 0.5 ? gA : 1.0 - smoothstep(0.0, 0.25, r2);
	if (uShape > 2.5 && uShape < 3.5) core = 1.0 - smoothstep(0.0, 0.1, abs(dm - 0.4));
	float sph = 1.0;
	if (uShape > 1.5 && uShape < 2.5) {
		vec3 n = vec3(c.x * 2.0, -c.y * 2.0, sqrt(max(0.0, 1.0 - 4.0 * r2)));
		sph = 0.4 + 0.75 * max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
	}
	if (vCoc > 0.01) {
		float bokeh = 1.0 - smoothstep(0.16, 0.25, r2);
		core = mix(core, bokeh, vCoc * 0.8);
	}
	float dofAlpha = 1.0 / (1.0 + vCoc * 1.8);
	if (uAdd > 0.5) {
		float aura = pow(core, mix(1.8, 0.7, uGlow));
		vec3 col = (vColor * (0.08 + aura * (0.2 + uGlow * 0.28)) + vColor * vD * 0.08) * uDens * uGhost * dofAlpha * sph * (1.0 - vDk);
		float ga = core * uGhost * dofAlpha * (1.0 - vDk);
		// тёмные места видео должны быть прозрачными, а не чёрными: яркость точки определяет и её непрозрачность
		if (uFr.x > 0.5) ga *= clamp(dot(vColor, vec3(0.3, 0.59, 0.11)) * 5.0, 0.0, 1.0);
		gl_FragColor = vec4(col, ga);
	} else {
		// у кадров видео точка плоская, без затемнения к краю: цвет остаётся точным
		gl_FragColor = vec4(vColor * (uFr.x > 0.5 ? 1.0 : 0.55 + 0.45 * core) * sph, dofAlpha * (1.0 - vDk));
	}
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;
