export const lineFrag = `
precision highp float;
uniform vec4 uLink;
uniform vec4 uLinkP;
uniform float uTime;
varying vec3 vC;
varying float vA;
varying float vEnd;
varying float vIdx;
varying float vSide;
varying float vStrain;
void main() {
	float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
	vec3 col = vC;
	float pulseA = 1.0;
	int mode = int(uLinkP.x + 0.5);
	if (uLink.w > 0.5) {
		float spd = uLink.z;
		if (mode == 0) {
			// Классика: синусоидальный импульс с искрами
			float p = sin(vEnd * 16.0 - uTime * spd * 3.5 + vIdx * 24.0);
			float spark = smoothstep(0.45, 0.98, p) * 2.8;
			pulseA = 0.5 + spark;
			col += col * spark * 1.5;
		} else if (mode == 1) {
			// Нейросеть (синапсы): асимметричные спайки действия с резким фронтом в обоих направлениях
			float t1 = fract(vEnd * 2.0 - uTime * spd * 0.95 + vIdx * 13.37);
			float spike1 = exp(-t1 * 16.0) * 4.0;
			float t2 = fract((1.0 - vEnd) * 2.0 - uTime * spd * 0.75 + vIdx * 29.11);
			float spike2 = exp(-t2 * 16.0) * 3.0;
			float syn = spike1 + spike2;
			pulseA = 0.35 + syn;
			col = mix(col, vec3(1.0), clamp(syn * 0.55, 0.0, 0.85)) + col * syn * 1.8;
		} else if (mode == 2) {
			// Созвездия: мягкое мерцание звездного скопления
			float shimmer = 0.65 + 0.35 * sin(uTime * 3.2 + vIdx * 43.0 + vEnd * 6.28);
			pulseA = shimmer;
			col = mix(col, vec3(0.9, 0.96, 1.0), 0.35 * shimmer);
		} else if (mode == 3) {
			// Киберпанк / Лазер: резкий луч с цифровыми пакетами данных
			float core = 1.0 - smoothstep(0.0, 0.32, abs(vSide));
			float bits = step(0.46, fract(vEnd * 10.0 - uTime * spd * 3.2 + vIdx * 19.3));
			pulseA = 0.55 + bits * 2.2;
			col = col * pulseA + vec3(1.0) * core * 1.6;
		} else if (mode == 4) {
			// Натяжение: волна накала с усилением от растяжения нити
			float wave = 0.5 + 0.5 * sin(vEnd * 12.0 - uTime * spd * 2.6 + vStrain * 6.0);
			pulseA = 0.5 + wave * (1.0 + vStrain * 2.2);
			col += vec3(1.0, 0.45, 0.18) * vStrain * 2.0 * wave;
		}
	}
	// Огоньки на узлах (сияющие бусины/маяки на стыках)
	if (uLinkP.z > 0.5) {
		float endDist = min(vEnd, 1.0 - vEnd);
		float dNode = length(vec2(endDist * 7.5, vSide * 0.72));
		float beacon = exp(-dNode * 3.8) * 2.6;
		col += (vec3(1.0) + vC * 0.6) * beacon;
		pulseA = max(pulseA, beacon * 1.3);
	}
	float alpha = clamp(vA * pulseA * edge, 0.0, 1.0);
	gl_FragColor = vec4(col * alpha, alpha);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;
