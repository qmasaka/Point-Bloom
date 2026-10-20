// GLSL: фрагментный шейдер точек «Тени на стене» и поверхности, на которую она падает.

export const shadowFrag = /* glsl */ `
precision highp float;
uniform vec4 uShd;
varying vec3 vColor;
varying float vD;
varying float vDk;
varying float vCoc;
varying float vGl;
void main() {
	vec2 c = gl_PointCoord - 0.5;
	float r = length(c);
	if (r > 0.5) discard;
	// мягкая круглая точка; много точек друг на друге сгущаются в плотную тень
	float a = (1.0 - smoothstep(mix(0.3, 0.0, uShd.y), 0.5, r)) * vD * (1.0 - vDk) * 0.4;
	if (a < 0.002) discard;
	gl_FragColor = vec4(vColor, a);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

/** Поверхность (пол или стена): мягкое пятно света, края уходят в фон */
export const surfaceVert = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const surfaceFrag = /* glsl */ `
precision highp float;
uniform vec3 uC;
uniform float uA;
varying vec2 vUv;
void main() {
	float d = length(vUv - 0.5) * 2.0;
	gl_FragColor = vec4(uC, uA * (1.0 - smoothstep(0.25, 1.0, d)));
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;
