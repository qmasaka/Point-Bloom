export const scopeFrag = `
precision highp float;
varying vec3 vC;
varying float vA;
varying float vSide;
void main() {
	float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
	gl_FragColor = vec4(vC * (vA * edge), vA * edge);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;
