export const timeformVert = `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uRing;
uniform vec4 uG; // буфер: колонки, строки, кадров, голова
uniform vec4 uP; // сетка точек: колонки, строки, длина во времени, что оставить (0 всё, 1 движение, 2 светлое, 3 тёмное)
uniform vec4 uQ; // порог, размер точек, ширина и высота кадра
uniform vec4 uT; // x длина скульптуры (единиц сцены), y сила, z куда уходит время (0 вглубь, 1 вверх, 2 вбок), w как гаснет старое
uniform vec4 uC; // xyz цвет окраски по времени, w её сила
uniform float uPR;
varying vec3 vC;
varying float vA;
float th(float p) { return fract(sin(p * 127.1) * 43758.5453); }
void main() {
	float gx = position.x, gy = position.y, k = position.z;
	vec2 jt = vec2(th(gx * 7.1 + gy * 3.3 + k * 1.7), th(gx * 2.9 + gy * 8.3 + k * 5.1)) - 0.5;
	vec2 uv = (vec2(gx, gy) + 0.5 + jt * 0.8) / uP.xy;
	ivec2 c = ivec2(clamp(uv * uG.xy, vec2(0.0), uG.xy - 1.0));
	int L0 = int(mod(uG.w - k + uG.z * 8.0, uG.z));
	vec3 col = texelFetch(uRing, ivec3(c, L0), 0).rgb;
	float lum = dot(col, vec3(0.3, 0.59, 0.11));
	bool keep = true;
	float m = uP.w;
	if (m > 0.5 && m < 1.5) {
		// движение: точка остаётся, если в этом месте кадр отличается от предыдущего
		int L1 = int(mod(uG.w - k - 1.0 + uG.z * 8.0, uG.z));
		vec3 prev = texelFetch(uRing, ivec3(c, L1), 0).rgb;
		keep = k < uG.z - 1.5 && length(col - prev) > uQ.x * 0.35;
	} else if (m > 1.5 && m < 2.5) keep = pow(lum, 0.4545) > uQ.x;
	else if (m > 2.5) keep = pow(lum, 0.4545) < uQ.x;
	float age = k / max(uG.z - 1.0, 1.0);
	if (!keep || age > uP.z + 1e-4 || uT.y < 0.001) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
		vC = vec3(0.0);
		vA = 0.0;
		return;
	}
	vec3 p = vec3((uv.x - 0.5) * uQ.z, (0.5 - uv.y) * uQ.w, 0.0);
	float an = age / max(uP.z, 1e-3);
	float d = an * uT.x * min(uT.y, 1.0);
	if (uT.z < 0.5) p.z -= d;
	else if (uT.z < 1.5) p.y += d;
	else p.x += d;
	vec4 mv = modelViewMatrix * vec4(p, 1.0);
	gl_Position = projectionMatrix * mv;
	float fade = 1.0 - uT.w * an;
	vC = mix(col, uC.xyz * (0.4 + lum * 1.4), uC.w * an) * min(uT.y, 1.0);
	vA = clamp(fade, 0.0, 1.0);
	gl_PointSize = clamp(uQ.y * uPR * 3.8 / max(-mv.z, 0.4) * (0.4 + 0.6 * vA), 1.0, 40.0);
}
`;
export const timeformFrag = `
precision highp float;
varying vec3 vC;
varying float vA;
void main() {
	vec2 c = gl_PointCoord - 0.5;
	if (dot(c, c) > 0.25) discard;
	gl_FragColor = vec4(vC, vA);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;
