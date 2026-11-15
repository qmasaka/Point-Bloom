import * as THREE from 'three';

export function frDummy2D() {
	const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
	t.needsUpdate = true;
	return t;
}

export function frDummyTex() {
	const t = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
	t.format = THREE.RGBAFormat;
	t.type = THREE.UnsignedByteType;
	t.needsUpdate = true;
	return t;
}

export const GLYPH_SETS = {
	ascii: ['.', '`', "'", ',', ':', ';', '-', '~', '"', '^', '_', '+', '=', '<', '>', 'i', '!', 'l', 'I', '?', '/', '\\', '|', '(', ')', '{', '}', '[', ']', '1', 't', 'f', 'j', 'r', 'x', 'n', 'u', 'v', 'c', 'z', 'X', 'Y', 'U', 'J', 'C', 'L', 'Q', '0', 'O', 'Z', 'm', 'w', 'q', 'p', 'd', 'b', 'k', 'h', 'a', 'o', '*', '#', 'M', 'W', '&', '8', '%', 'B', '@', '$'],
	digits: ['1', '7', '4', '2', '5', '3', '6', '9', '8', '0'],
	letters: ['i', 'l', 'j', 't', 'f', 'r', 'c', 's', 'v', 'x', 'z', 'n', 'u', 'e', 'a', 'o', 'y', 'k', 'h', 'd', 'b', 'p', 'q', 'g', 'm', 'w', 'I', 'L', 'T', 'J', 'V', 'A', 'X', 'Y', 'K', 'H', 'N', 'R', 'E', 'F', 'P', 'S', 'U', 'Z', 'B', 'D', 'G', 'O', 'Q', 'C', 'M', 'W'],
	blocks: ['·', '▫', '▪', '▘', '▝', '▖', '▗', '▁', '░', '▏', '▎', '▂', '▍', '▀', '▄', '▌', '▐', '▃', '▞', '▚', '▒', '▅', '▋', '▆', '▓', '▊', '▇', '▉', '■', '█'],
};

export function glyphAtlas(mode) {
	const set = GLYPH_SETS[mode] || GLYPH_SETS.ascii;
	const n = set.length;
	const cv = document.createElement('canvas');
	cv.width = n * 64;
	cv.height = 64;
	const c = cv.getContext('2d');
	c.fillStyle = '#fff';
	c.textAlign = 'center';
	c.textBaseline = 'middle';
	c.font = mode === 'digits' ? '700 54px Geist, system-ui, sans-serif' : '700 54px "Geist Mono", ui-monospace, Menlo, "Apple Symbols", monospace';
	set.forEach((g, i) => c.fillText(g, i * 64 + 32, 34));
	const tex = new THREE.CanvasTexture(cv);
	tex.minFilter = tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	tex.userData = { n };
	return tex;
}
