import * as THREE from 'three';
import { LAYER, BACKGROUNDS } from './viewport.js';
import { pointsGeometryFrom } from '../core/geom.js';
import { bakeVertexColors, colorSignature } from '../points/pointcloud.js';

const pointVert = `
uniform float uSize;
uniform float uAttenuate;
uniform float uRef;
uniform float uCur;
uniform float uPR;
uniform float uMode;
uniform vec3 uColor;
uniform vec2 uYRange;
attribute float aHide;
attribute float aSel;
varying vec3 vColor;

vec3 ramp(float t) {

	vec3 c = vec3(0.0);
	if (t < 0.25) c = mix(vec3(0.10, 0.20, 0.85), vec3(0.05, 0.80, 0.95), t / 0.25);
	else if (t < 0.5) c = mix(vec3(0.05, 0.80, 0.95), vec3(0.30, 0.90, 0.25), (t - 0.25) / 0.25);
	else if (t < 0.75) c = mix(vec3(0.30, 0.90, 0.25), vec3(0.98, 0.88, 0.12), (t - 0.5) / 0.25);
	else c = mix(vec3(0.98, 0.88, 0.12), vec3(0.92, 0.18, 0.12), (t - 0.75) / 0.25);
	return pow(c, vec3(2.2));
}

void main() {
	if (aHide > 0.5) {

		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
		vColor = vec3(0.0);
		return;
	}
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	gl_Position = projectionMatrix * mv;
	float s = uSize * uPR;
	if (uAttenuate > 0.5) {
		bool ortho = projectionMatrix[3][3] > 0.5;
		s *= ortho ? (uRef / max(uCur, 1e-9)) : (uRef / max(-mv.z, 1e-9));
	}
	gl_PointSize = clamp(s, 1.0, 128.0);
	if (uMode < 0.5) {
		vColor = color;
	} else if (uMode < 1.5) {
		vColor = uColor;
	} else if (uMode < 2.5) {
		vec3 wn = mat3(modelMatrix) * normal;
		wn = length(wn) > 0.0 ? normalize(wn) : vec3(0.0, 1.0, 0.0);
		vColor = pow(wn * 0.5 + 0.5, vec3(2.2));
	} else {
		float wy = (modelMatrix * vec4(position, 1.0)).y;
		vColor = ramp(clamp((wy - uYRange.x) / max(uYRange.y - uYRange.x, 1e-9), 0.0, 1.0));
	}

	if (aSel > 0.5) {
		vColor = vec3(1.0, 0.42, 0.08);
		gl_PointSize = max(gl_PointSize, 3.0) + 1.5;
	}
}`;

const pointFrag = `
uniform float uShape;
varying vec3 vColor;
void main() {
	vec2 c = gl_PointCoord - 0.5;
	float r2 = dot(c, c);
	vec3 col = vColor;
	if (uShape < 0.5) {

	} else if (uShape < 1.5) {
		if (r2 > 0.25) discard;
	} else if (uShape < 2.5) {

		if (r2 > 0.25) discard;
		vec3 n = vec3(c.x * 2.0, -c.y * 2.0, sqrt(max(0.0, 1.0 - 4.0 * r2)));
		float l = max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
		col *= 0.4 + 0.75 * l;
	} else if (uShape < 3.5) {
		if (r2 > 0.25 || r2 < 0.085) discard;
	} else if (uShape < 4.5) {
		if (abs(c.x) + abs(c.y) > 0.5) discard;
	} else {
		if (min(abs(c.x), abs(c.y)) > 0.16) discard;
	}
	gl_FragColor = vec4(col, 1.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

function makeUVChecker() {
	const N = 1024;
	const c = document.createElement('canvas');
	c.width = c.height = N;
	const g = c.getContext('2d');
	const cells = 16;
	const s = N / cells;
	for (let j = 0; j < cells; j++) {
		for (let i = 0; i < cells; i++) {
			const dark = (i + j) % 2 === 0;
			const hue = (i / cells) * 300;
			g.fillStyle = `hsl(${hue}, ${dark ? 55 : 40}%, ${dark ? 38 : 66}%)`;
			g.fillRect(i * s, j * s, s, s);
		}
	}
	g.fillStyle = 'rgba(255,255,255,.9)';
	g.font = `bold ${s * 0.42}px system-ui, sans-serif`;
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	for (let j = 0; j < cells; j += 2) {
		for (let i = 0; i < cells; i += 2) g.fillText(`${i / 2},${(cells - 1 - j) / 2 | 0}`, i * s + s, j * s + s);
	}
	g.strokeStyle = '#fff';
	g.lineWidth = 6;
	g.strokeRect(3, 3, N - 6, N - 6);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.anisotropy = 8;
	t.name = 'uv-checker';
	return t;
}

export const POINT_SHAPES = ['square', 'circle', 'sphere', 'ring', 'diamond', 'plus'];
const COLOR_MODE = { texture: 0, solid: 1, normal: 2, height: 3 };

export class Display {
	constructor(app) {
		this.app = app;
		this.orig = new WeakMap();
		this.overlays = new WeakMap();
		this.checker = makeUVChecker();

		this.mats = {
			solid: new THREE.MeshStandardMaterial({ color: 0xc8ccd3, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }),
			normals: new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }),
			uv: new THREE.MeshStandardMaterial({ map: this.checker, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
			wire: new THREE.MeshBasicMaterial({ color: 0xb4bcc9, wireframe: true, toneMapped: false }),
		};
		const off = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
		this.wireOverlay = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false, ...off });
		this.faceFront = new THREE.MeshBasicMaterial({ color: 0x2f6fe0, transparent: true, opacity: 0.55, side: THREE.FrontSide, depthWrite: false, toneMapped: false, ...off });
		this.faceBack = new THREE.MeshBasicMaterial({ color: 0xe5302a, transparent: true, opacity: 0.85, side: THREE.BackSide, depthWrite: false, toneMapped: false, ...off });

		this.pointMat = new THREE.ShaderMaterial({
			vertexShader: pointVert,
			fragmentShader: pointFrag,
			vertexColors: true,
			uniforms: {
				uSize: { value: 3 },
				uAttenuate: { value: 1 },
				uRef: { value: 4 },
				uCur: { value: 4 },
				uPR: { value: 1 },
				uMode: { value: 0 },
				uShape: { value: 1 },
				uColor: { value: new THREE.Color(0xffd166) },
				uYRange: { value: new THREE.Vector2(0, 1) },
			},
		});
		this.pointMat.name = '__points';
	}

	get mode() {
		return this.app.settings.display;
	}

	attach(obj) {
		if (obj.userData.helper) return;
		if (obj.isMesh) {
			if (!this.orig.has(obj)) this.orig.set(obj, obj.material);
			obj.layers.set(LAYER.MESH);
		} else if (obj.isPoints) {
			if (!this.orig.has(obj)) this.orig.set(obj, obj.material);
			obj.layers.set(LAYER.MESH);
			obj.layers.enable(LAYER.POINTS);
		}
	}

	detach(obj) {
		const ov = this.overlays.get(obj);
		if (ov) {
			for (const k of ['wire', 'faceF', 'faceB', 'points']) if (ov[k]) obj.remove(ov[k]);
			if (ov.points) ov.points.geometry.dispose();
			this.overlays.delete(obj);
		}
		this.orig.delete(obj);
	}

	getOriginal(obj) {
		return this.orig.get(obj) ?? obj.material;
	}
	setOriginal(obj, material) {
		this.orig.set(obj, material);
	}

	static stripHelpers(root) {
		const drop = [];
		root.traverse((o) => {
			if (o.userData && o.userData.helper) drop.push(o);
		});
		for (const o of drop) o.removeFromParent();
	}

	syncCameraLayers() {
		const vp = this.app.viewport;
		const s = this.app.settings;
		for (const cam of [vp.perspCam, vp.orthoCam]) {
			cam.layers.set(0);
			if (this.mode === 'points') cam.layers.enable(LAYER.POINTS);
			else {
				cam.layers.enable(LAYER.MESH);
				if (s.overlays.wire && this.mode !== 'wire') cam.layers.enable(LAYER.WIRE);
				if (s.overlays.faces) cam.layers.enable(LAYER.FACES);
			}
		}
	}

	apply() {
		const s = this.app.settings;
		const mode = this.mode;
		const light = (BACKGROUNDS[s.render.bg] || BACKGROUNDS.dark).light;
		this.mats.wire.color.set(light ? 0x2c303a : 0xb4bcc9);
		this.wireOverlay.color.set(light ? 0x000000 : 0xffffff);
		this.wireOverlay.opacity = light ? 0.35 : 0.28;
		for (const m of [this.mats.solid, this.mats.normals]) {
			if (m.flatShading !== s.flat) {
				m.flatShading = s.flat;
				m.needsUpdate = true;
			}
		}
		this.app.viewport.root.traverse((o) => {
			if (o.userData.helper) return;
			if (o.isMesh) {
				if (!this.orig.has(o)) this.attach(o);
				switch (mode) {
					case 'solid': o.material = this.mats.solid; break;
					case 'normals': o.material = this.mats.normals; break;
					case 'uv': o.material = this.mats.uv; break;
					case 'wire': o.material = this.mats.wire; break;
					default: o.material = this.orig.get(o);
				}
				this.syncOverlays(o);
			} else if (o.isPoints) {
				if (!this.orig.has(o)) this.attach(o);
				o.material = this.pointMat;
			}
		});
		this.syncCameraLayers();
		this.app.viewport.invalidate();
		this.scheduleWarmup();
	}

	scheduleWarmup() {
		const r = this.app.viewport.renderer;
		if (!r || !r.compileAsync) return;
		let mesh = null;
		this.app.viewport.root.traverse((o) => {
			if (!mesh && o.isMesh && !o.userData.helper && o.geometry) mesh = o;
		});
		if (!mesh) return;
		this._warmed = this._warmed || new WeakSet();
		if (this._warmed.has(mesh.geometry)) return;
		this._warmed.add(mesh.geometry);
		const run = async () => {
			try {
				const vp = this.app.viewport;
				if (vp.contextLost) return;
				const g = new THREE.Group();
				for (const m of [...Object.values(this.mats), this.wireOverlay, this.faceFront, this.faceBack]) g.add(new THREE.Mesh(mesh.geometry, m));
				const dummy = new THREE.BufferGeometry();
				dummy.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
				dummy.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3), 3));
				g.add(new THREE.Points(dummy, this.pointMat));
				await r.compileAsync(g, vp.camera, vp.scene);
				dummy.dispose();
			} catch (e) {
			}
		};
		const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
		idle(run, { timeout: 2500 });
	}

	syncOverlays(mesh) {
		const s = this.app.settings;
		const mode = this.mode;
		let ov = this.overlays.get(mesh);
		const need = {
			wire: s.overlays.wire && mode !== 'wire' && mode !== 'points',
			faces: s.overlays.faces && mode !== 'points',
			points: mode === 'points',
		};
		const make = (kind, geometry, material, layer) => {
			const c = new THREE.Mesh(geometry, material);
			c.userData.helper = true;
			c.name = '__' + kind;
			c.raycast = () => {};
			c.layers.set(layer);
			mesh.add(c);
			return c;
		};
		if (!ov) {
			ov = {};
			this.overlays.set(mesh, ov);
		}
		if (need.wire) {
			if (!ov.wire) ov.wire = make('wire', mesh.geometry, this.wireOverlay, LAYER.WIRE);
			else if (ov.wire.geometry !== mesh.geometry) ov.wire.geometry = mesh.geometry;
		}
		if (need.faces) {
			if (!ov.faceF) {
				ov.faceF = make('faceF', mesh.geometry, this.faceFront, LAYER.FACES);
				ov.faceB = make('faceB', mesh.geometry, this.faceBack, LAYER.FACES);
			} else if (ov.faceF.geometry !== mesh.geometry) {
				ov.faceF.geometry = ov.faceB.geometry = mesh.geometry;
			}
		}
		if (need.points) this.syncPoints(mesh, ov);
	}

	syncPoints(mesh, ov) {
		const mats = this.orig.get(mesh);
		const sig = colorSignature(mesh, mats);
		if (ov.points && ov.sig === sig && ov.geometryRef === mesh.geometry) return;
		if (ov.points) {
			ov.points.geometry.dispose();
			mesh.remove(ov.points);
			ov.points = null;
		}
		const pg = pointsGeometryFrom(mesh.geometry);
		pg.setAttribute('color', new THREE.BufferAttribute(bakeVertexColors(mesh.geometry, mats), 3));
		const pts = new THREE.Points(pg, this.pointMat);
		pts.userData.helper = true;
		pts.name = '__points';
		pts.raycast = () => {};
		pts.layers.set(LAYER.POINTS);
		pts.frustumCulled = false;
		mesh.add(pts);
		ov.points = pts;
		ov.sig = sig;
		ov.geometryRef = mesh.geometry;
	}

	updateUniforms(camera, size, nav) {
		const s = this.app.settings.point;
		const u = this.pointMat.uniforms;
		u.uSize.value = s.size;
		u.uAttenuate.value = s.attenuate ? 1 : 0;
		u.uRef.value = nav.refDistance;
		u.uCur.value = nav.distance;
		u.uPR.value = this.app.viewport.renderer.getPixelRatio();
		u.uMode.value = COLOR_MODE[s.color] ?? 0;
		u.uShape.value = Math.max(0, POINT_SHAPES.indexOf(s.shape));
		u.uColor.value.set(s.solidColor);
		const box = this.app.viewport.sceneBox;
		if (box && !box.isEmpty()) u.uYRange.value.set(box.min.y, box.max.y);
	}
}
