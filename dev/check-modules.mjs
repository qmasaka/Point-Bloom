import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

async function loadAcorn() {
	if (process.env.ACORN) return await import(pathToFileURL(path.join(process.env.ACORN, 'dist', 'acorn.mjs')).href);
	try {
		return await import('acorn');
	} catch {
		return createRequire(path.join(ROOT, 'package.json'))('acorn');
	}
}
const acorn = await loadAcorn();

const GLOBALS = new Set(
	(
		'undefined NaN Infinity globalThis window document navigator location history screen performance console localStorage sessionStorage indexedDB ' +
		'self top parent frames opener setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame requestIdleCallback cancelIdleCallback queueMicrotask ' +
		'fetch Request Response Headers URL URLSearchParams Blob File FileReader FormData AbortController AbortSignal Event EventTarget CustomEvent MessageChannel BroadcastChannel ' +
		'Object Array String Number Boolean Symbol BigInt Math JSON Date RegExp Error TypeError RangeError SyntaxError ReferenceError EvalError URIError Promise Proxy Reflect Map Set WeakMap WeakSet WeakRef ' +
		'ArrayBuffer SharedArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array BigInt64Array BigUint64Array ' +
		'parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape atob btoa structuredClone Intl TextEncoder TextDecoder ' +
		'GPUBufferUsage GPUShaderStage GPUTextureUsage GPUColorWrite GPUMapMode GPUDevice NodeFilter TreeWalker Range Selection HTMLElement HTMLCanvasElement HTMLVideoElement HTMLImageElement HTMLInputElement HTMLAudioElement HTMLMediaElement Element Node NodeList Image ImageData ImageBitmap OffscreenCanvas Path2D DOMParser XMLSerializer DOMMatrix DOMRect DOMException ' +
		'MutationObserver ResizeObserver IntersectionObserver PerformanceObserver PointerEvent MouseEvent KeyboardEvent TouchEvent WheelEvent DragEvent ClipboardEvent DataTransfer ' +
		'createImageBitmap matchMedia getComputedStyle alert confirm prompt open close focus blur ' +
		'WebGLRenderingContext WebGL2RenderingContext WebGLTexture WebGLProgram AudioContext webkitAudioContext OfflineAudioContext AudioBuffer AudioNode GainNode AnalyserNode AudioWorkletNode MediaStream MediaStreamTrack MediaRecorder MediaDevices Audio ' +
		'Worker SharedWorker ServiceWorker VideoFrame VideoEncoder VideoDecoder AudioData AudioEncoder ImageDecoder CompressionStream DecompressionStream ReadableStream WritableStream TransformStream ' +
		'XMLHttpRequest WebSocket Notification speechSynthesis FontFace CSS CSSStyleSheet ' +
		'process require module exports __dirname __filename arguments'
	).split(/\s+/)
);

function listFiles(dir) {
	const out = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...listFiles(p));
		else if (e.name.endsWith('.js')) out.push(p);
	}
	return out;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const files = listFiles(SRC);
const info = new Map();

function resolveSpec(spec, from) {
	if (spec === 'three' || spec.startsWith('three/')) return null;
	if (!spec.startsWith('.')) return null;
	return path.normalize(path.join(path.dirname(from), spec));
}

function patternNames(p, out) {
	if (!p) return;
	switch (p.type) {
		case 'Identifier':
			out.add(p.name);
			break;
		case 'ObjectPattern':
			for (const pr of p.properties) patternNames(pr.type === 'RestElement' ? pr.argument : pr.value, out);
			break;
		case 'ArrayPattern':
			for (const el of p.elements) patternNames(el, out);
			break;
		case 'RestElement':
			patternNames(p.argument, out);
			break;
		case 'AssignmentPattern':
			patternNames(p.left, out);
			break;
	}
}

const FUNC = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function hoist(node, out) {
	if (!node || typeof node.type !== 'string') return;
	switch (node.type) {
		case 'VariableDeclaration':
			for (const d of node.declarations) patternNames(d.id, out);
			break;
		case 'FunctionDeclaration':
			if (node.id) out.add(node.id.name);
			return;
		case 'ClassDeclaration':
			if (node.id) out.add(node.id.name);
			break;
		case 'CatchClause':
			patternNames(node.param, out);
			break;
		case 'FunctionExpression':
		case 'ArrowFunctionExpression':
			return;
	}
	for (const k of Object.keys(node)) {
		const v = node[k];
		if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && hoist(c, out));
		else if (v && typeof v.type === 'string') hoist(v, out);
	}
}

function freeNames(ast) {
	const free = new Map();
	const programScope = new Set();
	for (const n of ast.body) {
		if (n.type === 'ImportDeclaration') n.specifiers.forEach((s) => programScope.add(s.local.name));
		if (n.type === 'ExportNamedDeclaration' && n.declaration) hoist(n.declaration, programScope);
		else if (n.type === 'ExportDefaultDeclaration') {
			if (n.declaration.id) programScope.add(n.declaration.id.name);
		} else hoist(n, programScope);
	}

	const isDeclared = (name, scopes) => scopes.some((s) => s.has(name));

	function visit(node, parent, key, scopes) {
		if (!node || typeof node.type !== 'string') return;
		switch (node.type) {
			case 'Identifier': {
				if (parent) {
					if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
					if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) return;
					if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return;
					if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier' || parent.type === 'ExportSpecifier') return;
				}
				if (!isDeclared(node.name, scopes) && !GLOBALS.has(node.name) && !free.has(node.name)) free.set(node.name, node.loc.start.line);
				return;
			}
			case 'FunctionDeclaration':
			case 'FunctionExpression':
			case 'ArrowFunctionExpression': {
				const s = new Set();
				if (node.type === 'FunctionExpression' && node.id) s.add(node.id.name);
				node.params.forEach((p) => patternNames(p, s));
				hoist(node.body, s);
				const inner = [...scopes, s];
				node.params.forEach((p) => visitPatternExprs(p, inner));
				visit(node.body, node, 'body', inner);
				return;
			}
			case 'ClassExpression':
			case 'ClassDeclaration': {
				const s = new Set();
				if (node.id) s.add(node.id.name);
				const inner = [...scopes, s];
				if (node.superClass) visit(node.superClass, node, 'superClass', inner);
				visit(node.body, node, 'body', inner);
				return;
			}
			case 'VariableDeclarator':
				visitPatternExprs(node.id, scopes);
				if (node.init) visit(node.init, node, 'init', scopes);
				return;
			case 'CatchClause':
				visit(node.body, node, 'body', scopes);
				return;
			case 'ImportDeclaration':
				return;
			case 'ExportNamedDeclaration':
				if (node.declaration) visit(node.declaration, node, 'declaration', scopes);
				else if (!node.source) for (const sp of node.specifiers) visit(sp.local, sp, 'local', scopes);
				return;
		}
		for (const k of Object.keys(node)) {
			if (k === 'loc' || k === 'start' || k === 'end') continue;
			const v = node[k];
			if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && visit(c, node, k, scopes));
			else if (v && typeof v.type === 'string') visit(v, node, k, scopes);
		}
	}

	function visitPatternExprs(p, scopes) {
		if (!p) return;
		if (p.type === 'AssignmentPattern') {
			visitPatternExprs(p.left, scopes);
			visit(p.right, p, 'right', scopes);
		} else if (p.type === 'ObjectPattern') {
			for (const pr of p.properties) {
				if (pr.type === 'RestElement') visitPatternExprs(pr.argument, scopes);
				else {
					if (pr.computed) visit(pr.key, pr, 'key', scopes);
					visitPatternExprs(pr.value, scopes);
				}
			}
		} else if (p.type === 'ArrayPattern') p.elements.forEach((e) => visitPatternExprs(e, scopes));
		else if (p.type === 'RestElement') visitPatternExprs(p.argument, scopes);
		else if (p.type === 'MemberExpression') visit(p, null, null, scopes);
	}

	for (const n of ast.body) visit(n, ast, 'body', [programScope]);
	return free;
}

let problems = 0;
const err = (msg) => {
	problems++;
	console.log('✗ ' + msg);
};

for (const f of files) {
	const code = fs.readFileSync(f, 'utf8');
	let ast;
	try {
		ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
	} catch (e) {
		err(`${rel(f)}: синтаксическая ошибка — ${e.message}`);
		continue;
	}
	const imports = [];
	const exports = new Set();
	const reexportAll = [];
	for (const n of ast.body) {
		if (n.type === 'ImportDeclaration') {
			imports.push({ spec: n.source.value, names: n.specifiers.map((s) => ({ kind: s.type, imported: s.imported ? s.imported.name : s.type === 'ImportDefaultSpecifier' ? 'default' : '*', line: n.loc.start.line })) });
		} else if (n.type === 'ExportNamedDeclaration') {
			if (n.declaration) {
				const s = new Set();
				hoist(n.declaration, s);
				s.forEach((x) => exports.add(x));
			}
			for (const sp of n.specifiers) exports.add(sp.exported.name);
			if (n.source) imports.push({ spec: n.source.value, names: n.specifiers.map((s) => ({ kind: 'Re', imported: s.local.name, line: n.loc.start.line })) });
		} else if (n.type === 'ExportDefaultDeclaration') exports.add('default');
		else if (n.type === 'ExportAllDeclaration') {
			reexportAll.push(n.source.value);
			imports.push({ spec: n.source.value, names: [] });
		}
	}
	info.set(f, { ast, imports, exports, reexportAll, free: freeNames(ast) });
}

const exportsOf = (f, seen = new Set()) => {
	const d = info.get(f);
	if (!d || seen.has(f)) return new Set();
	seen.add(f);
	const out = new Set(d.exports);
	for (const spec of d.reexportAll) {
		const t = resolveSpec(spec, f);
		if (t) exportsOf(t, seen).forEach((x) => out.add(x));
	}
	return out;
};

const graph = new Map();
for (const [f, d] of info) {
	const deps = [];
	for (const imp of d.imports) {
		const t = resolveSpec(imp.spec, f);
		if (!t) continue;
		if (!info.has(t)) {
			err(`${rel(f)}: импорт '${imp.spec}' — такого файла нет`);
			continue;
		}
		deps.push(t);
		const ex = exportsOf(t);
		for (const n of imp.names) {
			if (n.kind === 'ImportNamespaceSpecifier') continue;
			if (!ex.has(n.imported)) err(`${rel(f)}:${n.line}: '${n.imported}' не экспортируется из ${rel(t)}`);
		}
	}
	graph.set(f, deps);
	for (const [name, line] of d.free) err(`${rel(f)}:${line}: имя '${name}' нигде не объявлено и не импортировано`);
}

const state = new Map();
const stack = [];
const cycles = [];
function dfs(f) {
	state.set(f, 1);
	stack.push(f);
	for (const t of graph.get(f) || []) {
		if (state.get(t) === 1) cycles.push([...stack.slice(stack.indexOf(t)), t].map(rel));
		else if (!state.has(t)) dfs(t);
	}
	stack.pop();
	state.set(f, 2);
}
for (const f of graph.keys()) if (!state.has(f)) dfs(f);
for (const c of cycles) err('цикл зависимостей: ' + c.join(' → '));

console.log(problems ? `\nНайдено проблем: ${problems}` : `Проверено модулей: ${files.length}. Проблем нет.`);
process.exit(problems ? 1 : 0);
