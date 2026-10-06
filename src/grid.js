import * as THREE from 'three';

const vert = /* glsl */ `
varying vec3 vWorld;
void main() {
	vec4 w = modelMatrix * vec4(position, 1.0);
	vWorld = w.xyz;
	gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
varying vec3 vWorld;
uniform float uSizeA, uSizeB, uMix, uRadius, uAxes, uOrtho;
uniform vec3 uCenter, uCam, uBack, uColor, uAxisU, uAxisV, uNormal, uColU, uColV;

float gridLines(vec2 p, float size) {
	vec2 c = p / size;
	vec2 d = abs(fract(c - 0.5) - 0.5) / max(fwidth(c), vec2(1e-6));
	return 1.0 - min(min(d.x, d.y), 1.0);
}

void main() {
	vec2 p = vec2(dot(vWorld, uAxisU), dot(vWorld, uAxisV));
	vec2 pc = vec2(dot(uCenter, uAxisU), dot(uCenter, uAxisV));
	float a = gridLines(p, uSizeA) * (1.0 - uMix);
	float b = gridLines(p, uSizeB);
	float g = max(a * 0.5, b * 0.85);

	vec2 fw = max(fwidth(p), vec2(1e-6));
	float axU = (1.0 - smoothstep(0.0, 1.6, abs(p.y) / fw.y)) * uAxes;  // линия вдоль оси U (V = 0)
	float axV = (1.0 - smoothstep(0.0, 1.6, abs(p.x) / fw.x)) * uAxes;  // линия вдоль оси V (U = 0)

	float dist = length(p - pc);
	float fade = 1.0 - smoothstep(uRadius * 0.3, uRadius, dist);
	vec3 V = uOrtho > 0.5 ? uBack : normalize(uCam - vWorld);
	fade *= smoothstep(0.0, 0.16, abs(dot(V, uNormal)));

	vec3 col = uColor;
	float alpha = g * 0.32;
	col = mix(col, uColU, axU);
	col = mix(col, uColV, axV);
	alpha = max(alpha, max(axU, axV) * 0.9);
	alpha *= fade;
	if (alpha < 0.003) discard;
	gl_FragColor = vec4(col, alpha);
}`;

export class Grid extends THREE.Mesh {
	constructor() {
		const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
		const mat = new THREE.ShaderMaterial({
			vertexShader: vert,
			fragmentShader: frag,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			uniforms: {
				uSizeA: { value: 1 },
				uSizeB: { value: 10 },
				uMix: { value: 0 },
				uRadius: { value: 100 },
				uAxes: { value: 1 },
				uOrtho: { value: 0 },
				uCenter: { value: new THREE.Vector3() },
				uCam: { value: new THREE.Vector3() },
				uBack: { value: new THREE.Vector3(0, 0, 1) },
				uColor: { value: new THREE.Color(0.8, 0.82, 0.86) },
				uAxisU: { value: new THREE.Vector3(1, 0, 0) },
				uAxisV: { value: new THREE.Vector3(0, 0, 1) },
				uNormal: { value: new THREE.Vector3(0, 1, 0) },
				uColU: { value: new THREE.Color(0.53, 0.78, 0.35) },
				uColV: { value: new THREE.Color(0.9, 0.34, 0.37) },
			},
		});
		super(geo, mat);
		this.frustumCulled = false;
		this.renderOrder = -10;
		this.name = '__grid';
		this.spacing = 1;
	}

	/** Подстраивает масштаб сетки под расстояние до камеры */
	update(nav, camera) {
		const u = this.material.uniforms;
		const d = Math.max(nav.distance, 1e-9);
		const lg = Math.log10(d * 0.12);
		const level = Math.floor(lg);
		u.uMix.value = lg - level;
		u.uSizeA.value = Math.pow(10, level);
		u.uSizeB.value = Math.pow(10, level + 1);
		this.spacing = u.uSizeA.value;
		const radius = d * (nav.ortho ? 60 : 45);
		u.uRadius.value = radius;
		this.scale.set(radius, 1, radius);
		// В ортогональных видах спереди/сбоку сетка лежит в плоскости, перпендикулярной взгляду (как в Blender)
		const view = nav.ortho ? nav.axisView() : null;
		this.rotation.set(0, 0, 0);
		// цвета осей как в маркере и гизмо: ось three.js x подписана Y (зелёная), y подписана Z (синяя), z подписана X (красная)
		const R = [0.9, 0.34, 0.37], G = [0.53, 0.78, 0.35], B = [0.31, 0.56, 0.94];
		if (view === 'front' || view === 'back') {
			u.uAxisU.value.set(1, 0, 0);
			u.uAxisV.value.set(0, 1, 0);
			u.uNormal.value.set(0, 0, 1);
			u.uColU.value.set(...G);
			u.uColV.value.set(...B);
			this.rotation.x = Math.PI / 2;
			this.position.set(nav.target.x, nav.target.y, 0);
		} else if (view === 'left' || view === 'right') {
			u.uAxisU.value.set(0, 0, 1);
			u.uAxisV.value.set(0, 1, 0);
			u.uNormal.value.set(1, 0, 0);
			u.uColU.value.set(...R);
			u.uColV.value.set(...B);
			this.rotation.z = -Math.PI / 2;
			this.position.set(0, nav.target.y, nav.target.z);
		} else {
			u.uAxisU.value.set(1, 0, 0);
			u.uAxisV.value.set(0, 0, 1);
			u.uNormal.value.set(0, 1, 0);
			u.uColU.value.set(...G);
			u.uColV.value.set(...R);
			this.position.set(nav.target.x, 0, nav.target.z);
		}
		u.uCenter.value.copy(nav.target);
		u.uCam.value.copy(camera.position);
		u.uOrtho.value = nav.ortho ? 1 : 0;
		u.uBack.value.set(0, 0, 1).applyQuaternion(camera.quaternion);
		this.updateMatrixWorld();
	}

	setTheme(light) {
		this.material.uniforms.uColor.value.set(light ? 0x2a2e36 : 0xcfd4dc);
	}
}
