// WGSL: общие куски: структура значений кадра и тональная компрессия.
import { frameStructWGSL } from '../../render/webgpu/frame-layout.js';

/** Структура Frame (генерируется из render/webgpu/frame-layout.js) */
export const frameStruct = frameStructWGSL();

/**
 * Вывод цвета на холст так же, как делает three.js в WebGL: «нейтральная» тональная компрессия (Khronos PBR Neutral),
 * затем перевод из линейного цвета в sRGB. Формулы повторяют three.js (tonemapping_pars_fragment и colorspace_pars_fragment).
 */
export const outputColor = /* wgsl */ `
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

fn linearToSrgb(v: vec3f) -> vec3f {
	let lo = v * 12.92;
	let hi = pow(v, vec3f(0.41666)) * 1.055 - vec3f(0.055);
	return select(hi, lo, v <= vec3f(0.0031308));
}
`;
