import { common } from '../../shaders/glsl/common.js';
import { lineVert } from '../../shaders/glsl/line-vert.js';
import { scopeVert } from '../../shaders/glsl/scope-vert.js';
import { vert } from '../../shaders/glsl/vert.js';

export const FX_GUARD_RE = /^\s*if \((u[A-Za-z0-9]+)\.([xyzw]) > (\d+(?:\.\d+)?)( && [^{;]*?)?\) (\{\s*(?:\/\/.*)?|[^{]*;)\s*(?:\/\/.*)?$/;

export const FX_GUARD_SKIP = new Set(['uHero', 'uScopeP']);

export function specializeFx(src, isOn) {
	const lines = src.split('\n');
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		const m = FX_GUARD_RE.exec(lines[i]);
		if (!m || FX_GUARD_SKIP.has(m[1]) || isOn(m[1], m[2], m[3]) !== false) {
			out.push(lines[i]);
			continue;
		}
		if (m[5][0] !== '{') {
			if (/^\s*else\b/.test(lines[i + 1] || '')) out.push(lines[i]);
			continue;
		}
		let depth = 1;
		let j = i;
		let ok = true;
		let pp = 0;
		while (depth > 0 && ++j < lines.length) {
			const code = lines[j].replace(/\/\/.*$/, '');
			if (/^\s*#\s*if/.test(code)) pp++;
			else if (/^\s*#\s*endif/.test(code)) pp--;
			for (let k = 0; k < code.length; k++) {
				const ch = code[k];
				if (ch === '{') depth++;
				else if (ch === '}') {
					depth--;
					if (depth === 0 && /\belse\b/.test(code.slice(k + 1))) ok = false;
				}
			}
		}
		if (depth !== 0 || pp !== 0 || !ok || /^\s*else\b/.test(lines[j + 1] || '')) {
			out.push(lines[i]);
			continue;
		}
		i = j;
	}
	return out.join('\n');
}

export function fxGuardKeys(...srcs) {
	const keys = new Map();
	for (const src of srcs) {
		for (const line of src.split('\n')) {
			const m = FX_GUARD_RE.exec(line);
			if (m && !FX_GUARD_SKIP.has(m[1])) keys.set(m[1] + '.' + m[2] + '>' + m[3], [m[1], m[2], parseFloat(m[3])]);
		}
	}
	return keys;
}

export const FX_GUARDS = fxGuardKeys(vert, lineVert, scopeVert, common);
