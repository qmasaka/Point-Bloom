const KEYWORD_TYPES = new Set(['float', 'int', 'bool', 'void', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'sampler2D', 'sampler2DArray']);

function preprocess(src, defines) {
	const macros = new Map(Object.entries(defines || {}).map(([k, v]) => [k, String(v)]));
	const out = [];
	const stack = [];
	const active = () => stack.every((s) => s.active);
	for (const line of src.split('\n')) {
		const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
		if (!m) {
			out.push(active() ? line : '');
			continue;
		}
		const [, dir, rest] = m;
		if (dir === 'ifdef' || dir === 'ifndef') {
			const name = rest.trim();
			const cond = macros.has(name) === (dir === 'ifdef');
			stack.push({ active: cond, taken: cond });
		} else if (dir === 'else') {
			const s = stack[stack.length - 1];
			s.active = !s.taken;
			s.taken = true;
		} else if (dir === 'endif') {
			stack.pop();
		} else if (dir === 'define') {
			if (active()) {
				const mm = /^(\w+)(\(.*?\))?\s*(.*)$/.exec(rest.trim());
				if (mm[2]) throw new Error('#define с аргументами не поддерживается: ' + line);
				macros.set(mm[1], mm[3].replace(/\/\/.*$/, '').trim());
			}
		} else if (dir === 'include' || dir === 'version' || dir === 'extension') {
		} else throw new Error('неизвестная директива #' + dir);
		out.push('');
	}
	return { text: out.join('\n'), macros };
}

function lex(text, macros) {
	const toks = [];
	let i = 0;
	const n = text.length;
	const ops = ['<<=', '>>=', '<=', '>=', '==', '!=', '&&', '||', '^^', '++', '--', '+=', '-=', '*=', '/=', '<<', '>>'];
	while (i < n) {
		const c = text[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (c === '/' && text[i + 1] === '/') {
			while (i < n && text[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && text[i + 1] === '*') {
			i = text.indexOf('*/', i + 2) + 2;
			continue;
		}
		const num = /^(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?/.exec(text.slice(i, i + 40));
		if (num && !/[A-Za-z_]/.test(text[i - 1] || '')) {
			const s = num[0];
			toks.push({ t: 'num', v: s, f: /[.eE]/.test(s) });
			i += s.length;
			continue;
		}
		const id = /^[A-Za-z_]\w*/.exec(text.slice(i, i + 80));
		if (id) {
			const name = id[0];
			if (macros.has(name) && macros.get(name) !== undefined) {
				const body = macros.get(name);
				toks.push(...lex(body, new Map([...macros].filter(([k]) => k !== name))).slice(0, -1));
			} else toks.push({ t: 'id', v: name });
			i += name.length;
			continue;
		}
		const op = ops.find((o) => text.startsWith(o, i));
		if (op) {
			toks.push({ t: 'op', v: op });
			i += op.length;
			continue;
		}
		toks.push({ t: 'op', v: c });
		i++;
	}
	toks.push({ t: 'eof', v: '' });
	return toks;
}

const PREC = { '||': 1, '^^': 1, '&&': 2, '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5, '+': 7, '-': 7, '*': 8, '/': 8, '%': 8 };

export function parseGLSL(src, { defines = {} } = {}) {
	const { text, macros } = preprocess(src, defines);
	const toks = lex(text, macros);
	let p = 0;
	const peek = (k = 0) => toks[p + k];
	const next = () => toks[p++];
	const isOp = (v, k = 0) => peek(k).t === 'op' && peek(k).v === v;
	const isId = (v, k = 0) => peek(k).t === 'id' && peek(k).v === v;
	const fail = (msg) => {
		const ctx = toks.slice(Math.max(0, p - 8), p + 8).map((t) => t.v).join(' ');
		throw new Error(msg + ' возле: ' + ctx);
	};
	const expect = (v) => {
		if (!isOp(v)) fail(`ожидалось '${v}', а найдено '${peek().v}'`);
		return next();
	};
	const isType = (k = 0) => peek(k).t === 'id' && KEYWORD_TYPES.has(peek(k).v);
	const QUAL = new Set(['const', 'uniform', 'attribute', 'varying', 'in', 'out', 'inout', 'highp', 'mediump', 'lowp', 'precision', 'flat']);

	function parseType() {
		while (peek().t === 'id' && ['highp', 'mediump', 'lowp'].includes(peek().v)) next();
		if (!isType()) fail('ожидался тип');
		return next().v;
	}

	function parsePrimary() {
		const t = peek();
		if (t.t === 'num') {
			next();
			return { k: 'num', v: t.v, f: t.f };
		}
		if (isOp('(')) {
			next();
			const e = parseExpr();
			expect(')');
			return { k: 'par', e };
		}
		if (t.t === 'id') {
			next();
			if (isOp('(')) {
				next();
				const args = [];
				if (!isOp(')')) {
					do {
						args.push(parseAssign());
					} while (isOp(',') && next());
				}
				expect(')');
				return { k: 'call', n: t.v, args };
			}
			return { k: 'id', n: t.v };
		}
		fail('неожиданный токен ' + t.v);
	}
	function parsePostfix() {
		let e = parsePrimary();
		for (;;) {
			if (isOp('.')) {
				next();
				e = { k: 'mem', e, m: next().v };
			} else if (isOp('[')) {
				next();
				const i = parseExpr();
				expect(']');
				e = { k: 'idx', e, i };
			} else if (isOp('++') || isOp('--')) {
				e = { k: 'post', op: next().v, e };
			} else return e;
		}
	}
	function parseUnary() {
		if (isOp('-') || isOp('+') || isOp('!') || isOp('++') || isOp('--')) {
			const op = next().v;
			return { k: 'un', op, e: parseUnary() };
		}
		return parsePostfix();
	}
	function parseBin(minPrec) {
		let l = parseUnary();
		for (;;) {
			const t = peek();
			const pr = t.t === 'op' ? PREC[t.v] : undefined;
			if (!pr || pr < minPrec) return l;
			next();
			const r = parseBin(pr + 1);
			l = { k: 'bin', op: t.v, l, r };
		}
	}
	function parseTern() {
		const c = parseBin(1);
		if (isOp('?')) {
			next();
			const a = parseAssign();
			expect(':');
			const b = parseAssign();
			return { k: 'tern', c, a, b };
		}
		return c;
	}
	function parseAssign() {
		const l = parseTern();
		if (['=', '+=', '-=', '*=', '/='].some((o) => isOp(o))) {
			const op = next().v;
			const r = parseAssign();
			return { k: 'asg', op, l, r };
		}
		return l;
	}
	function parseExpr() {
		return parseAssign();
	}

	function parseDeclRest(type) {
		const decls = [];
		do {
			const name = next().v;
			let arr = null;
			if (isOp('[')) {
				next();
				arr = parseExpr();
				expect(']');
			}
			let init = null;
			if (isOp('=')) {
				next();
				init = parseAssign();
			}
			decls.push({ name, arr, init });
		} while (isOp(',') && next());
		return decls;
	}
	function parseBlock() {
		expect('{');
		const body = [];
		while (!isOp('}')) body.push(parseStmt());
		expect('}');
		return { k: 'block', body };
	}
	function parseStmt() {
		if (isOp('{')) return parseBlock();
		if (isOp(';')) {
			next();
			return { k: 'empty' };
		}
		if (isId('if')) {
			next();
			expect('(');
			const cond = parseExpr();
			expect(')');
			const then = parseStmt();
			let els = null;
			if (isId('else')) {
				next();
				els = parseStmt();
			}
			return { k: 'if', cond, then, els };
		}
		if (isId('for')) {
			next();
			expect('(');
			let init = null;
			if (!isOp(';')) init = isType() || isId('const') ? parseDecl() : { k: 'expr', e: parseExpr() };
			if (init && init.k === 'expr') expect(';');
			let cond = null;
			if (!isOp(';')) cond = parseExpr();
			expect(';');
			let step = null;
			if (!isOp(')')) step = parseExpr();
			expect(')');
			return { k: 'for', init, cond, step, body: parseStmt() };
		}
		if (isId('while')) fail('while не поддерживается');
		if (isId('return')) {
			next();
			let e = null;
			if (!isOp(';')) e = parseExpr();
			expect(';');
			return { k: 'ret', e };
		}
		if (isId('break')) {
			next();
			expect(';');
			return { k: 'brk' };
		}
		if (isId('continue')) {
			next();
			expect(';');
			return { k: 'cont' };
		}
		if (isId('discard')) {
			next();
			expect(';');
			return { k: 'discard' };
		}
		if (isType() || isId('const')) return parseDecl();
		const e = parseExpr();
		expect(';');
		return { k: 'expr', e };
	}
	function parseDecl() {
		let isConst = false;
		if (isId('const')) {
			next();
			isConst = true;
		}
		const type = parseType();
		const decls = parseDeclRest(type);
		expect(';');
		return { k: 'decl', type, decls, isConst };
	}

	const prog = { uniforms: [], attributes: [], varyings: [], globals: [], funcs: [] };
	while (peek().t !== 'eof') {
		if (isId('precision')) {
			while (!isOp(';')) next();
			next();
			continue;
		}
		if (isId('uniform') || isId('attribute') || isId('varying')) {
			const q = next().v;
			const type = parseType();
			const decls = parseDeclRest(type);
			expect(';');
			for (const d of decls) {
				const rec = { type, name: d.name, len: d.arr ? Number(d.arr.v) : 0 };
				(q === 'uniform' ? prog.uniforms : q === 'attribute' ? prog.attributes : prog.varyings).push(rec);
			}
			continue;
		}
		let isConst = false;
		if (isId('const')) {
			next();
			isConst = true;
		}
		const type = parseType();
		const name = next().v;
		if (isOp('(')) {
			next();
			const params = [];
			if (!isOp(')')) {
				do {
					let qual = 'in';
					if (isId('in') || isId('out') || isId('inout')) qual = next().v;
					if (isId('const')) next();
					const pt = parseType();
					const pn = next().v;
					params.push({ type: pt, name: pn, qual });
				} while (isOp(',') && next());
			}
			expect(')');
			prog.funcs.push({ ret: type, name, params, body: parseBlock() });
		} else {
			p--;
			const decls = parseDeclRest(type);
			expect(';');
			for (const d of decls) prog.globals.push({ type, name: d.name, init: d.init, isConst, len: d.arr ? Number(d.arr.v) : 0 });
		}
	}
	return prog;
}

const TYPE_WGSL = { float: 'f32', int: 'i32', bool: 'bool', vec2: 'vec2f', vec3: 'vec3f', vec4: 'vec4f', ivec2: 'vec2i', ivec3: 'vec3i', ivec4: 'vec4i', bvec2: 'vec2<bool>', bvec3: 'vec3<bool>', bvec4: 'vec4<bool>', mat2: 'mat2x2f', mat3: 'mat3x3f', mat4: 'mat4x4f' };
const VEC_OF = { float: ['float', 1], vec2: ['float', 2], vec3: ['float', 3], vec4: ['float', 4], ivec2: ['int', 2], ivec3: ['int', 3], ivec4: ['int', 4], bvec2: ['bool', 2], bvec3: ['bool', 3], bvec4: ['bool', 4] };
const dimOf = (t) => (VEC_OF[t] ? VEC_OF[t][1] : 0);
const vecOf = (n, base = 'float') => (n === 1 ? base : base === 'float' ? 'vec' + n : base === 'int' ? 'ivec' + n : 'bvec' + n);
const RESERVED = new Set(['ref', 'sample', 'filter', 'target', 'meta', 'fn', 'let', 'var', 'type', 'enum', 'struct', 'array', 'alias', 'break', 'case', 'const', 'continue', 'default', 'diagnostic', 'discard', 'else', 'false', 'for', 'if', 'loop', 'override', 'return', 'switch', 'true', 'while', 'bitcast', 'texture', 'select', 'mix', 'step', 'sign', 'abs', 'min', 'max', 'f32', 'i32', 'u32', 'bool', 'half', 'mat', 'handle', 'priv', 'public', 'static', 'to', 'use', 'where', 'yield', 'this', 'with', 'new', 'in', 'out', 'inout', 'cast', 'common', 'sizeof', 'shared', 'attribute', 'pass', 'noinline', 'nointerpolation', 'premerge', 'regardless', 'unless', 'typedef', 'typeof', 'union', 'unsafe', 'virtual', 'volatile', 'wgsl', 'sealed', 'singular', 'smooth', 'sampler', 'fixed', 'finally', 'goto', 'inline', 'interface', 'layout', 'null', 'macro', 'mod', 'module', 'move', 'mut', 'namespace', 'package', 'packed', 'pub', 'trait', 'impl', 'extern', 'export', 'enable', 'requires', 'self', 'super', 'crate', 'as', 'async', 'await', 'dyn', 'do', 'catch', 'try', 'throw', 'asm', 'auto', 'binding', 'buffer', 'class', 'compile', 'delete', 'demote', 'dynamic', 'extends', 'final', 'friend', 'ptr', 'texel', 'location', 'builtin', 'position', 'vertex', 'fragment', 'compute', 'group', 'size', 'align', 'id', 'invariant', 'interpolate', 'workgroup', 'storage', 'uniform', 'private', 'function', 'atomic', 'vec2', 'vec3', 'vec4', 'mat2x2', 'mat3x3', 'mat4x4', 'length', 'distance', 'dot', 'cross', 'normalize', 'floor', 'fract', 'clamp', 'pow', 'exp', 'log', 'sin', 'cos', 'tan', 'sqrt']);
const safe = (n) => (RESERVED.has(n) || n.startsWith('__') ? n + '_' : n);

const SAME_AS_FIRST = new Set(['abs', 'sign', 'floor', 'ceil', 'fract', 'sqrt', 'inversesqrt', 'exp', 'exp2', 'log', 'log2', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'normalize', 'radians', 'degrees', 'round', 'trunc']);

export function emitWGSL(prog, opts = {}) {
	const {
		uniformPrefix = 'fr.',
		textures = {},
		privateNames = new Set(),
		builtinTypes = {},
		skipFuncs = new Set(),
		renameFuncs = {},
		flipY = false,
	} = opts;

	const uniforms = new Map(prog.uniforms.map((u) => [u.name, u]));
	const globalsInfo = new Map();
	for (const g of prog.globals) globalsInfo.set(g.name, { type: g.type, kind: 'global', len: g.len });
	for (const a of prog.attributes) globalsInfo.set(a.name, { type: a.type, kind: 'private' });
	for (const v of prog.varyings) globalsInfo.set(v.name, { type: v.type, kind: 'private' });
	for (const [n, t] of Object.entries(builtinTypes)) globalsInfo.set(n, { type: t, kind: 'private' });

	const byName = new Map();
	for (const f of prog.funcs) (byName.get(f.name) || byName.set(f.name, []).get(f.name)).push(f);
	const funcName = (f) => {
		const list = byName.get(f.name);
		const base = renameFuncs[f.name] || safe(f.name);
		return list.length > 1 ? base + '_' + f.params.map((p) => p.type).join('_') : base;
	};
	const pickFunc = (name, argTypes) => {
		const list = byName.get(name);
		if (!list) return null;
		if (list.length === 1) return list[0];
		return list.find((f) => f.params.length === argTypes.length && f.params.every((p, i) => p.type === argTypes[i])) || list[0];
	};

	let tmpCounter = 0;

	class Env {
		constructor(parent = null) {
			this.parent = parent;
			this.vars = new Map();
		}
		get(n) {
			for (let e = this; e; e = e.parent) if (e.vars.has(n)) return e.vars.get(n);
			return null;
		}
		set(n, info) {
			this.vars.set(n, info);
		}
	}

	const numText = (v, isF) => {
		if (!isF) return v;
		let s = v;
		if (/^\d+$/.test(s)) s += '.0';
		if (/^\.\d/.test(s)) s = '0' + s;
		if (/^\d+\.([eE]|$)/.test(s)) s = s.replace(/\.([eE]|$)/, '.0$1');
		return s;
	};

	function typeFromMember(bt, m) {
		const info = VEC_OF[bt];
		if (!info) throw new Error('доступ к полю у типа ' + bt);
		const n = m.length;
		return vecOf(n, info[0]);
	}
	const isVec = (t) => dimOf(t) > 1;
	const splat = (x, targetT) => (dimOf(targetT) > 1 && dimOf(x.t) === 1 ? `${TYPE_WGSL[targetT]}(${x.s})` : x.s);
	const widest = (...ts) => ts.reduce((a, b) => (dimOf(b) > dimOf(a) ? b : a));

	const uvText = (c) => (flipY ? `vec2f((${c}).x, 1.0 - (${c}).y)` : c);

	function emitCall(e, env) {
		const name = e.n;
		const args = e.args.map((a) => emitExpr(a, env));
		const argT = args.map((a) => a.t);
		const A = (i) => args[i].s;
		if (TYPE_WGSL[name] && name !== 'bool' && !['float', 'int'].includes(name)) {
			const w = TYPE_WGSL[name];
			if (/^mat/.test(name)) {
				if (args.length === 1 && /^mat/.test(argT[0]) && argT[0] !== name) {
					const k = Number(name[3]);
					const cols = [];
					for (let c = 0; c < k; c++) cols.push(`${TYPE_WGSL['vec' + k]}(${A(0)}[${c}].${'xyzw'.slice(0, k)})`);
					return { s: `${w}(${cols.join(', ')})`, t: name };
				}
				return { s: `${w}(${args.map((a) => a.s).join(', ')})`, t: name };
			}
			const n = dimOf(name);
			if (args.length === 1 && dimOf(argT[0]) > n) return { s: `${A(0)}.${'xyzw'.slice(0, n)}`, t: name };
			return { s: `${w}(${args.map((a) => a.s).join(', ')})`, t: name };
		}
		if (name === 'float') return { s: `f32(${A(0)})`, t: 'float' };
		if (name === 'int') return { s: `i32(${A(0)})`, t: 'int' };
		if (name === 'bool') return { s: `bool(${A(0)})`, t: 'bool' };
		switch (name) {
			case 'mod': {
				const t = widest(...argT);
				const suffix = dimOf(t) === 1 ? 'f' : String(dimOf(t));
				usedHelpers.add('mod' + suffix);
				return { s: `glsl_mod_${suffix}(${splat(args[0], t)}, ${splat(args[1], t)})`, t };
			}
			case 'min':
			case 'max': {
				const t = widest(...argT);
				return { s: `${name}(${splat(args[0], t)}, ${splat(args[1], t)})`, t };
			}
			case 'clamp': {
				const t = argT[0];
				return { s: `clamp(${A(0)}, ${splat(args[1], t)}, ${splat(args[2], t)})`, t };
			}
			case 'mix': {
				const t = widest(argT[0], argT[1]);
				const tt = dimOf(argT[2]) === 1 ? A(2) : args[2].s;
				return { s: `mix(${splat(args[0], t)}, ${splat(args[1], t)}, ${tt})`, t };
			}
			case 'step': {
				const t = argT[1];
				return { s: `step(${splat(args[0], t)}, ${A(1)})`, t };
			}
			case 'smoothstep': {
				const t = argT[2];
				return { s: `smoothstep(${splat(args[0], t)}, ${splat(args[1], t)}, ${A(2)})`, t };
			}
			case 'pow': {
				const t = widest(...argT);
				return { s: `pow(${splat(args[0], t)}, ${splat(args[1], t)})`, t };
			}
			case 'atan':
				return args.length === 2 ? { s: `atan2(${A(0)}, ${A(1)})`, t: argT[0] } : { s: `atan(${A(0)})`, t: argT[0] };
			case 'inversesqrt':
				return { s: `inverseSqrt(${A(0)})`, t: argT[0] };
			case 'length':
			case 'distance':
			case 'dot':
				return { s: `${name}(${args.map((a) => a.s).join(', ')})`, t: 'float' };
			case 'cross':
				return { s: `cross(${A(0)}, ${A(1)})`, t: 'vec3' };
			case 'reflect':
				return { s: `reflect(${A(0)}, ${A(1)})`, t: argT[0] };
			case 'texture2D':
			case 'texture': {
				const tx = textures[e.args[0].n];
				if (!tx) throw new Error('неизвестная текстура ' + e.args[0].n);
				if (tx.mode === 'sample') return { s: `textureSampleLevel(${tx.name}, ${tx.sampler}, ${uvText(A(1))}, 0.0)`, t: 'vec4' };
				return { s: `textureLoad(${tx.name}, vec2i(${A(1)} * vec2f(textureDimensions(${tx.name}))), 0)`, t: 'vec4' };
			}
			case 'textureLod': {
				const tx = textures[e.args[0].n];
				if (!tx) throw new Error('неизвестная текстура ' + e.args[0].n);
				return { s: `textureSampleLevel(${tx.name}, ${tx.sampler}, ${uvText(A(1))}, ${A(2)})`, t: 'vec4' };
			}
			case 'texelFetch': {
				const tx = textures[e.args[0].n];
				if (!tx) throw new Error('неизвестная текстура ' + e.args[0].n);
				if (tx.array) return { s: `textureLoad(${tx.name}, ${A(1)}.xy, ${A(1)}.z, ${A(2)})`, t: 'vec4' };
				if (flipY) return { s: `textureLoad(${tx.name}, vec2i((${A(1)}).x, i32(textureDimensions(${tx.name}).y) - 1 - (${A(1)}).y), ${A(2)})`, t: 'vec4' };
				return { s: `textureLoad(${tx.name}, ${A(1)}, ${A(2)})`, t: 'vec4' };
			}
		}
		if (SAME_AS_FIRST.has(name) || ['abs', 'sign', 'floor', 'ceil', 'fract', 'sqrt', 'exp', 'exp2', 'log', 'log2', 'sin', 'cos', 'tan', 'normalize'].includes(name)) {
			return { s: `${name}(${A(0)})`, t: argT[0] };
		}
		const f = pickFunc(name, argT);
		if (!f) throw new Error('неизвестная функция ' + name);
		const parts = f.params.map((pm, i) => {
			if (pm.qual === 'in') return args[i].s;
			const a = e.args[i];
			const v = a.k === 'id' ? env.get(a.n) : null;
			return v && v.ptr ? lvalueText(a, env) : `&${lvalueText(a, env)}`;
		});
		return { s: `${funcName(f)}(${parts.join(', ')})`, t: f.ret };
	}

	function lvalueText(e, env) {
		if (e.k === 'id') {
			const v = env.get(e.n) || globalsInfo.get(e.n);
			if (v && v.ptr) return safe(e.n);
			return safe(e.n);
		}
		throw new Error('в out-параметр передаётся не переменная');
	}

	function emitExpr(e, env) {
		switch (e.k) {
			case 'num':
				return { s: numText(e.v, e.f), t: e.f ? 'float' : 'int', lit: true };
			case 'par': {
				const r = emitExpr(e.e, env);
				return { s: `(${r.s})`, t: r.t };
			}
			case 'id': {
				const v = env.get(e.n);
				if (v) return { s: v.ptr ? `(*${safe(e.n)})` : safe(e.n), t: v.type };
				if (uniforms.has(e.n)) {
					const u = uniforms.get(e.n);
					return { s: uniformPrefix + e.n, t: u.type, arr: u.len };
				}
				if (globalsInfo.has(e.n)) return { s: safe(e.n), t: globalsInfo.get(e.n).type };
				if (e.n === 'true' || e.n === 'false') return { s: e.n, t: 'bool' };
				throw new Error('неизвестное имя ' + e.n);
			}
			case 'mem': {
				const b = emitExpr(e.e, env);
				return { s: `${b.s}.${e.m}`, t: typeFromMember(b.t, e.m) };
			}
			case 'idx': {
				const b = emitExpr(e.e, env);
				const i = emitExpr(e.i, env);
				if (/^mat/.test(b.t)) return { s: `${b.s}[${i.s}]`, t: 'vec' + b.t[3] };
				return { s: `${b.s}[${i.s}]`, t: b.t };
			}
			case 'un': {
				const r = emitExpr(e.e, env);
				if (e.op === '++' || e.op === '--') throw new Error('префиксный ' + e.op + ' в выражении');
				return { s: `${e.op}${r.s.startsWith('-') && e.op === '-' ? '(' + r.s + ')' : r.s}`, t: r.t };
			}
			case 'post':
				throw new Error('постфиксный ' + e.op + ' в выражении');
			case 'bin': {
				const l = emitExpr(e.l, env);
				const r = emitExpr(e.r, env);
				let t;
				if (['<', '>', '<=', '>=', '==', '!=', '&&', '||', '^^'].includes(e.op)) t = 'bool';
				else if (/^mat/.test(l.t) && isVec(r.t)) t = r.t;
				else if (isVec(l.t) && /^mat/.test(r.t)) t = l.t;
				else if (/^mat/.test(l.t)) t = l.t;
				else if (/^mat/.test(r.t)) t = r.t;
				else t = widest(l.t, r.t);
				let op = e.op;
				if (op === '^^') op = '!=';
				return { s: `(${l.s} ${op} ${r.s})`, t };
			}
			case 'tern': {
				const c = emitExpr(e.c, env);
				const a = emitExpr(e.a, env);
				const b = emitExpr(e.b, env);
				return { s: `select(${b.s}, ${a.s}, ${c.s})`, t: a.t };
			}
			case 'call':
				return emitCall(e, env);
			case 'asg':
				throw new Error('присваивание внутри выражения');
		}
		throw new Error('неизвестный узел ' + e.k);
	}

	const COMP = 'xyzw';
	function emitAssignStmt(e, env, ind) {
		const lhs = e.l;
		const op = e.op;
		if (lhs.k === 'mem' && lhs.m.length > 1) {
			const base = emitExpr(lhs.e, env);
			const n = dimOf(base.t);
			const rhs = emitExpr(e.r, env);
			const sub = emitExpr(lhs, env);
			let val = rhs.s;
			if (op !== '=') val = `(${sub.s} ${op[0]} ${splat(rhs, sub.t)})`;
			else val = splat(rhs, sub.t);
			const tmp = `_sw${tmpCounter++}`;
			const comps = [];
			const norm = [...lhs.m].map((ch) => 'xyzw'['rgba'.indexOf(ch) >= 0 ? 'rgba'.indexOf(ch) : 'stpq'.indexOf(ch) >= 0 ? 'stpq'.indexOf(ch) : 'xyzw'.indexOf(ch)]).join('');
			for (let i = 0; i < n; i++) {
				const j = norm.indexOf(COMP[i]);
				comps.push(j >= 0 ? (lhs.m.length === 1 ? tmp : `${tmp}.${COMP[j]}`) : `${base.s}.${COMP[i]}`);
			}
			return `${ind}{ let ${tmp} = ${val}; ${base.s} = ${TYPE_WGSL[base.t]}(${comps.join(', ')}); }\n`;
		}
		const l = emitExpr(lhs, env);
		const r = emitExpr(e.r, env);
		const rv = op === '=' ? splat(r, l.t) : isVec(l.t) ? splat(r, l.t) : r.s;
		return `${ind}${l.s} ${op} ${rv};\n`;
	}

	function emitBody(stmts, env, ind) {
		const inner = new Env(env);
		return stmts.map((x) => emitStmt(x, inner, ind)).join('');
	}

	function emitStmt(s, env, ind) {
		switch (s.k) {
			case 'empty':
				return '';
			case 'block': {
				const inner = new Env(env);
				return `${ind}{\n${s.body.map((x) => emitStmt(x, inner, ind + '\t')).join('')}${ind}}\n`;
			}
			case 'decl': {
				let out = '';
				for (const d of s.decls) {
					if (d.arr) throw new Error('локальные массивы не поддерживаются');
					const w = TYPE_WGSL[s.type];
					let init = null;
					if (d.init) {
						const r = emitExpr(d.init, env);
						init = splat(r, s.type);
					}
					env.set(d.name, { type: s.type });
					const kw = s.isConst && d.init ? 'const' : 'var';
					out += kw === 'const' ? `${ind}const ${safe(d.name)}: ${w} = ${init};\n` : `${ind}var ${safe(d.name)}: ${w}${init ? ' = ' + init : ''};\n`;
				}
				return out;
			}
			case 'if': {
				const c = emitExpr(s.cond, env);
				const thenBody = s.then.k === 'block' ? s.then : { k: 'block', body: [s.then] };
				let out = `${ind}if (${c.s}) {\n${emitBody(thenBody.body, env, ind + '\t')}${ind}}`;
				if (s.els) {
					if (s.els.k === 'if') out += ' else ' + emitStmt(s.els, env, ind).trimStart();
					else {
						const eb = s.els.k === 'block' ? s.els : { k: 'block', body: [s.els] };
						out += ` else {\n${emitBody(eb.body, env, ind + '\t')}${ind}}\n`;
					}
				} else out += '\n';
				return out;
			}
			case 'for': {
				const inner = new Env(env);
				let init = '';
				if (s.init) {
					if (s.init.k !== 'decl') throw new Error('инициализация for должна быть объявлением');
					const d = s.init.decls[0];
					const r = emitExpr(d.init, inner);
					inner.set(d.name, { type: s.init.type });
					init = `var ${safe(d.name)}: ${TYPE_WGSL[s.init.type]} = ${r.s}`;
				}
				const cond = s.cond ? emitExpr(s.cond, inner).s : 'true';
				let step = '';
				if (s.step) {
					if (s.step.k === 'post') step = `${emitExpr(s.step.e, inner).s}${s.step.op}`;
					else if (s.step.k === 'asg') step = emitAssignStmt(s.step, inner, '').trim().replace(/;$/, '');
					else throw new Error('неподдерживаемый шаг for');
				}
				const bodyStmts = s.body.k === 'block' ? s.body.body : [s.body];
				return `${ind}for (${init}; ${cond}; ${step}) {\n${emitBody(bodyStmts, inner, ind + '\t')}${ind}}\n`;
			}
			case 'ret':
				return s.e ? `${ind}return ${emitExpr(s.e, env).s};\n` : `${ind}return;\n`;
			case 'brk':
				return `${ind}break;\n`;
			case 'cont':
				return `${ind}continue;\n`;
			case 'discard':
				return `${ind}discard;\n`;
			case 'expr': {
				const e = s.e;
				if (e.k === 'asg') return emitAssignStmt(e, env, ind);
				if (e.k === 'post') return `${ind}${emitExpr(e.e, env).s}${e.op};\n`;
				if (e.k === 'un' && (e.op === '++' || e.op === '--')) return `${ind}${emitExpr(e.e, env).s}${e.op};\n`;
				if (e.k === 'call') {
					const r = emitExpr(e, env);
					return `${ind}${r.s};\n`;
				}
				throw new Error('выражение-оператор без действия');
			}
		}
		throw new Error('неизвестный оператор ' + s.k);
	}

	const usedHelpers = new Set();
	const out = [];

	for (const g of prog.globals) {
		const env = new Env();
		const w = g.len ? `array<${TYPE_WGSL[g.type]}, ${g.len}>` : TYPE_WGSL[g.type];
		if (g.isConst) {
			const r = emitExpr(g.init, env);
			out.push(`const ${safe(g.name)}: ${w} = ${splat(r, g.type)};`);
		} else out.push(`var<private> ${safe(g.name)}: ${w}${g.init ? ' = ' + splat(emitExpr(g.init, env), g.type) : ''};`);
	}
	const fnTexts = [];
	for (const f of prog.funcs) {
		if (skipFuncs.has(f.name)) continue;
		const env = new Env();
		const params = f.params.map((pm) => {
			const w = TYPE_WGSL[pm.type];
			if (pm.qual === 'in') return `${safe(pm.name)}_in: ${w}`;
			env.set(pm.name, { type: pm.type, ptr: true });
			return `${safe(pm.name)}: ptr<function, ${w}>`;
		});
		let prologue = '';
		for (const pm of f.params) {
			if (pm.qual === 'in') {
				env.set(pm.name, { type: pm.type });
				prologue += `\tvar ${safe(pm.name)}: ${TYPE_WGSL[pm.type]} = ${safe(pm.name)}_in;\n`;
			}
		}
		const body = f.body.body.map((s) => emitStmt(s, env, '\t')).join('');
		const ret = f.ret === 'void' ? '' : ` -> ${TYPE_WGSL[f.ret]}`;
		fnTexts.push(`fn ${funcName(f)}(${params.join(', ')})${ret} {\n${prologue}${body}}\n`);
	}

	const helpers = {
		modf: 'fn glsl_mod_f(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }',
		mod2: 'fn glsl_mod_2(x: vec2f, y: vec2f) -> vec2f { return x - y * floor(x / y); }',
		mod3: 'fn glsl_mod_3(x: vec3f, y: vec3f) -> vec3f { return x - y * floor(x / y); }',
		mod4: 'fn glsl_mod_4(x: vec4f, y: vec4f) -> vec4f { return x - y * floor(x / y); }',
	};
	const helperText = [...usedHelpers].map((h) => helpers[h]).join('\n');

	const fields = prog.uniforms.filter((u) => !/^sampler/.test(u.type));
	return {
		wgsl: [helperText, out.join('\n'), fnTexts.join('\n')].filter(Boolean).join('\n\n'),
		uniforms: fields,
		samplers: prog.uniforms.filter((u) => /^sampler/.test(u.type)),
		funcNames: Object.fromEntries(prog.funcs.map((f) => [f.name, funcName(f)])),
	};
}

export { TYPE_WGSL, dimOf };
