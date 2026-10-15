// Дымовой тест режима «Эффекты»: загружает демо-модель, входит в режим, по очереди включает и выключает каждый эффект,
// заходит в редактор и обратно. Для каждого шага собирает: ошибки в консоли, долгие задачи главного потока, паузы в WebGL-вызовах
// и самые долгие кадры. Нужен, чтобы после каждого шага переноса кода убедиться, что ничего не сломалось и не стало медленнее.
//
// Как запускать: открыть приложение в Chrome (python -m http.server 8765, затем http://localhost:8765/index.html),
// вставить файл целиком в консоль браузера (или выполнить через DevTools MCP). Тест идёт в фоне; готовность и результат:
//     window.__smoke.done   → true, когда закончил
//     window.__smoke.report → итог (JSON), там же report.problems: пустой список = всё хорошо
(() => {
	const S = (window.__smoke = { done: false, steps: [], errors: [], report: null });
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const q = (s, root = document) => [...root.querySelectorAll(s)];
	const clickText = (sel, text) => {
		const el = q(sel).find((e) => e.innerText && e.innerText.trim() === text);
		if (!el) throw new Error('не найден элемент: ' + text);
		el.click();
	};

	// ошибки приложения
	window.addEventListener('error', (e) => S.errors.push('error: ' + e.message));
	window.addEventListener('unhandledrejection', (e) => S.errors.push('rejection: ' + (e.reason && (e.reason.message || e.reason))));
	const oErr = console.error;
	console.error = (...a) => {
		S.errors.push('console.error: ' + a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 200));
		oErr.apply(console, a);
	};

	// потеря контекста WebGL (сброс видеопроцесса): записывается с названием шага, на котором случилась
	let currentStep = 'до начала';
	const hookCanvas = () => {
		const cv = document.querySelector('canvas.gl');
		if (!cv || cv.__smokeHooked) return;
		cv.__smokeHooked = true;
		cv.addEventListener('webglcontextlost', () => S.errors.push('потерян контекст WebGL на шаге: ' + currentStep));
		cv.addEventListener('webglcontextrestored', () => S.errors.push('контекст WebGL восстановлен (шаг: ' + currentStep + ')'));
	};
	hookCanvas();

	// долгие задачи, кадры, паузы WebGL
	const lt = [];
	try {
		new PerformanceObserver((l) => l.getEntries().forEach((e) => lt.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
	} catch (e) {}
	const ft = [];
	let last = performance.now();
	(function f(t) {
		ft.push(t - last);
		last = t;
		requestAnimationFrame(f);
	})(last);
	const glStall = [];
	const P = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
	if (P && !P.__smokePatched) {
		const srcOf = new WeakMap();
		const shaders = new WeakMap();
		const oSS = P.shaderSource;
		P.shaderSource = function (s, src) {
			srcOf.set(s, src);
			return oSS.call(this, s, src);
		};
		const oAS = P.attachShader;
		P.attachShader = function (p, s) {
			(shaders.get(p) || shaders.set(p, []).get(p)).push(s);
			return oAS.call(this, p, s);
		};
		const o = P.getProgramInfoLog;
		P.getProgramInfoLog = function (p) {
			const t = performance.now();
			const r = o.call(this, p);
			const d = performance.now() - t;
			if (d > 60) {
				const vs = ((shaders.get(p) || []).map((s) => srcOf.get(s) || '')[0] || '').length;
				glStall.push(Math.round(d) + 'мс (вершинный шейдер ' + vs + ' симв.)');
				if (d > 1000) S.errors.push('блокировка WebGL ' + Math.round(d) + ' мс: ' + new Error().stack.split('\n').slice(2, 9).map((x) => x.trim().replace(/https?:\/\/[^/]+\/assets\//, '')).join(' < '));
			}
			return r;
		};
		P.__smokePatched = true;
	}

	async function step(name, fn, wait = 1200) {
		currentStep = name;
		hookCanvas();
		lt.length = 0;
		glStall.length = 0;
		ft.length = 0;
		const e0 = S.errors.length;
		let ok = true;
		let note = '';
		try {
			note = (await fn()) || '';
		} catch (e) {
			ok = false;
			note = String(e && e.message ? e.message : e);
		}
		await sleep(wait);
		S.steps.push({
			name,
			ok,
			note,
			longTasks: lt.slice(),
			glStalls: glStall.slice(),
			maxFrame: Math.round(Math.max(0, ...ft)),
			errors: S.errors.slice(e0),
		});
	}

	(async () => {
		try {
			await sleep(1500);
			await step('загрузка демо-модели', () => clickText('button, div', 'Demo model'), 2500);
			const app = window.__app;
			const fx = app.ui.effectsEngine;
			await step(
				'вход в «Эффекты»',
				async () => {
					clickText('[role=tab], button, div', 'Effects');
					for (let i = 0; i < 400; i++) {
						await sleep(50);
						if (fx.active && fx.points && (fx.points.visible || (fx.backend && fx.backend.kind === 'webgpu' && fx.backend.canvas && !fx.backend.useGl))) return 'готово за ' + i * 50 + ' мс';
					}
					throw new Error('облако точек так и не появилось');
				},
				2500
			);
			const onCount = () => Object.values(fx.state.layers).filter((l) => l && l.on).length;
			const heads = q('.fx-left-list .fx-layer-head');
			for (const head of heads) {
				const name = (head.innerText || '').trim().split('\n')[0];
				const sw = q('.switch', head)[0];
				if (!sw) continue;
				const before = onCount();
				await step('включить: ' + name, () => {
					sw.click();
					return before;
				}, 1800);
				const mid = onCount();
				await step('выключить: ' + name, () => {
					sw.click();
					return mid;
				}, 800);
				const st = S.steps[S.steps.length - 2];
				st.note = 'эффектов включено: ' + before + ' → ' + mid;
			}
			// вывод через пост-обработку (буфер) и обратно на экран
			await step('свечение: включить', () => {
				fx.state.look.bloom = 0.8;
			}, 2500);
			await step('обратная связь: включить', () => {
				fx.state.layers.feedback.on = true;
				fx.state.layers.feedback.amount = 0.9;
				return 'вывод в буфер: ' + (fx._tgtRT ? 'да' : 'ещё нет');
			}, 2500);
			await step('свечение и обратная связь: выключить', () => {
				fx.state.look.bloom = 0;
				fx.state.layers.feedback.on = false;
			}, 2500);
			await step('в редактор', () => clickText('[role=tab], button, div', 'Editor'), 2000);
			await step(
				'снова в «Эффекты»',
				async () => {
					clickText('[role=tab], button, div', 'Effects');
					for (let i = 0; i < 400; i++) {
						await sleep(50);
						if (fx.active && fx.points && (fx.points.visible || (fx.backend && fx.backend.kind === 'webgpu' && fx.backend.canvas && !fx.backend.useGl))) return 'готово за ' + i * 50 + ' мс';
					}
					throw new Error('облако точек так и не появилось');
				},
				2500
			);
		} catch (e) {
			S.errors.push('тест остановился: ' + (e && e.message ? e.message : e));
		}
		const bad = S.steps.filter((s) => !s.ok || s.errors.length);
		const slow = S.steps.filter((s) => s.longTasks.some((d) => d > 150) || s.glStalls.length);
		S.report = {
			steps: S.steps.length,
			problems: [...S.errors.filter((e) => !/WebGL.*context|GL_INVALID/i.test(e)), ...bad.map((s) => s.name + ': ' + (s.note || s.errors.join('; ')))],
			slowSteps: slow.map((s) => ({ name: s.name, longTasks: s.longTasks, glStalls: s.glStalls })),
			worstFrame: Math.max(...S.steps.map((s) => s.maxFrame)),
			backend: window.__app.ui.effectsEngine.backend ? { kind: window.__app.ui.effectsEngine.backend.kind, frames: window.__app.ui.effectsEngine.backend.stats } : null,
		};
		S.done = true;
	})();
	return 'smoke started';
})();
