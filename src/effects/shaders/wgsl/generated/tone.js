// Сгенерировано dev/gen-wgsl.mjs из шейдеров GLSL. Не править руками: правьте GLSL и запустите node dev/gen-wgsl.mjs.
export const TONE_WGSL = /* wgsl */ `
fn toneNeutral(c0: vec3f, exposure: f32) -> vec3f {
	let startCompression = 0.8 - 0.04;
	let desaturation = 0.15;
	var color = c0 * exposure;
	let x = min(color.r, min(color.g, color.b));
	let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
	color = color - offset;
	let peak = max(color.r, max(color.g, color.b));
	if (peak < startCompression) { return color; }
	let d = 1.0 - startCompression;
	let newPeak = 1.0 - d * d / (peak + d - startCompression);
	color = color * (newPeak / peak);
	let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
	return mix(color, vec3f(newPeak), g);
}
fn rrtAndOdtFit(v: vec3f) -> vec3f {
	let a = v * (v + 0.0245786) - 0.000090537;
	let b = v * (0.983729 * v + 0.4329510) + 0.238081;
	return a / b;
}
fn toneAces(c0: vec3f, exposure: f32) -> vec3f {
	let inM = mat3x3f(vec3f(0.59719, 0.07600, 0.02840), vec3f(0.35458, 0.90834, 0.13383), vec3f(0.04823, 0.01566, 0.83777));
	let outM = mat3x3f(vec3f(1.60475, -0.10208, -0.00327), vec3f(-0.53108, 1.10813, -0.07276), vec3f(-0.07367, -0.00605, 1.07602));
	var color = c0 * (exposure / 0.6);
	color = inM * color;
	color = rrtAndOdtFit(color);
	color = outM * color;
	return saturate(color);
}
fn agxContrast(x: vec3f) -> vec3f {
	let x2 = x * x;
	let x4 = x2 * x2;
	return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn toneAgx(c0: vec3f, exposure: f32) -> vec3f {
	let rec2020ToSrgb = mat3x3f(vec3f(1.6605, -0.1246, -0.0182), vec3f(-0.5876, 1.1329, -0.1006), vec3f(-0.0728, -0.0083, 1.1187));
	let srgbToRec2020 = mat3x3f(vec3f(0.6274, 0.0691, 0.0164), vec3f(0.3293, 0.9195, 0.0880), vec3f(0.0433, 0.0113, 0.8956));
	let inset = mat3x3f(vec3f(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3f(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3f(0.0482516061458583, 0.101439036467562, 0.811302368396859));
	let outset = mat3x3f(vec3f(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3f(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3f(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
	let minEv = -12.47393;
	let maxEv = 4.026069;
	var color = c0 * exposure;
	color = srgbToRec2020 * color;
	color = inset * color;
	color = max(color, vec3f(1e-10));
	color = log2(color);
	color = (color - minEv) / (maxEv - minEv);
	color = clamp(color, vec3f(0.0), vec3f(1.0));
	color = agxContrast(color);
	color = outset * color;
	color = pow(max(vec3f(0.0), color), vec3f(2.2));
	color = rec2020ToSrgb * color;
	return clamp(color, vec3f(0.0), vec3f(1.0));
}
fn toneMap(c: vec3f, exposure: f32, mode: f32) -> vec3f {
	if (mode < 0.5) { return c; }
	if (mode < 1.5) { return toneNeutral(c, exposure); }
	if (mode < 2.5) { return toneAces(c, exposure); }
	return toneAgx(c, exposure);
}
fn linearToSrgb(v: vec3f) -> vec3f {
	return select(pow(v, vec3f(0.41666)) * 1.055 - vec3f(0.055), v * 12.92, v <= vec3f(0.0031308));
}
`;
