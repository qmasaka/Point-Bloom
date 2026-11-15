(() => {
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const errors = [];
	window.addEventListener('error', (e) => errors.push('error: ' + e.message));
	window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + (e.reason && (e.reason.message || e.reason))));

	function compose(vp, canvases) {
		const c = document.createElement('canvas');
		c.width = vp.canvas.width;
		c.height = vp.canvas.height;
		const x = c.getContext('2d');
		x.fillStyle = '#0d0f12';
		x.fillRect(0, 0, c.width, c.height);
		for (const cv of canvases) x.drawImage(cv, 0, 0, c.width, c.height);
		return x.getImageData(0, 0, c.width, c.height).data;
	}

	async function one(label, setup, opts = {}) {
		const app = window.__app;
		const fx = app.ui.effectsEngine;
		const B = fx.backend;
		const vp = app.viewport;
		if (!B || B.kind !== 'webgpu') throw new Error('нужен WebGPU: откройте приложение с ?gpu=1 и войдите в «Эффекты»');
		const e0 = errors.length;
		fx.frozen = false;
		fx.state.look.blend = 'add';
		if (setup) await setup(fx);
		const g0 = B.stats.gpu;
		const l0 = B.stats.gl;
		await sleep(opts.warm ?? 1800);
		const gpuFrames = B.stats.gpu - g0;
		const glFrames = B.stats.gl - l0;
		fx.frozen = true;
		B.wakeGl();
		for (let i = 0; i < 400 && !(B.glWarm && fx._fxCovered()); i++) await sleep(50);
		B._glOnly = () => true;
		await sleep(opts.glWarm ?? 1500);
		delete B._glOnly;
		await sleep(300);
		const pair = await new Promise((r) =>
			requestAnimationFrame(() => {
				vp.render();
				const usedGpu = !B.useGl;
				const A = compose(vp, [vp.canvas, B.canvas]);
				B._glOnly = () => true;
				vp.render();
				const usedGl = B.useGl;
				const G = compose(vp, [vp.canvas]);
				delete B._glOnly;
				r({ A, G, usedGpu, usedGl });
			})
		);
		fx.frozen = false;
		const { A, G } = pair;
		let max = 0;
		let bad = 0;
		for (let i = 0; i < A.length; i += 4) {
			let m = 0;
			for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(A[i + c] - G[i + c]));
			if (m > max) max = m;
			if (m > 12) bad++;
		}
		const res = { label, gpuFrames, glFrames, bothPaths: pair.usedGpu && pair.usedGl, maxDiff: max, badPct: +((100 * bad) / (A.length / 4)).toFixed(3), errors: errors.slice(e0) };
		window.__compare.last = { A, G, res };
		if (opts.cleanup) await opts.cleanup(fx);
		return res;
	}

	async function run({ only = null } = {}) {
		const fx = window.__app.ui.effectsEngine;
		const report = [];
		const ids = Object.keys(fx.state.layers).filter((k) => (!only || only.includes(k)) && fx.state.layers[k] && 'on' in fx.state.layers[k]);
		for (const id of ids) {
			const L = fx.state.layers[id];
			const was = L.on;
			try {
				report.push(await one(id, () => (L.on = true), { cleanup: () => (L.on = was) }));
			} catch (e) {
				report.push({ label: id, failed: String(e && e.message ? e.message : e) });
				L.on = was;
			}
		}
		window.__compare.report = report;
		return report;
	}

	async function loadTestVideo({ seconds = 3, w = 320, h = 180 } = {}) {
		const cv = document.createElement('canvas');
		cv.width = w;
		cv.height = h;
		const x = cv.getContext('2d');
		const stream = cv.captureStream(30);
		const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
		const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
		const chunks = [];
		rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		const done = new Promise((r) => (rec.onstop = r));
		rec.start(100);
		const t0 = performance.now();
		await new Promise((resolve) => {
			const draw = () => {
				const t = (performance.now() - t0) / 1000;
				for (let i = 0; i < 8; i++) {
					x.fillStyle = `hsl(${(i * 45 + t * 60) % 360} 80% ${30 + i * 6}%)`;
					x.fillRect((i * w) / 8, 0, w / 8 + 1, h);
				}
				x.fillStyle = '#fff';
				x.beginPath();
				x.arc(w / 2 + Math.sin(t * 2) * w * 0.3, h / 2, h * 0.25, 0, Math.PI * 2);
				x.fill();
				if (t < seconds) setTimeout(draw, 33);
				else resolve();
			};
			draw();
		});
		rec.stop();
		await done;
		const type = (mime || 'video/webm').split(';')[0];
		const file = new File([new Blob(chunks, { type })], 'test.' + (type === 'video/mp4' ? 'mp4' : 'webm'), { type });
		await window.__app.media.load(file);
		return file;
	}

	window.__compare = { one, run, loadTestVideo, report: null, last: null };
})();
