import { App } from './app/app.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { exportModel, verifyGLB } from './io/exporters.js';
import { makeTextureSampler } from './points/pointcloud.js';
import { makeDemoFiles } from './app/demo.js';
import { exportForWeb } from './io/web-export.js';
import { runBenchmark } from './core/capabilities.js';
import { guardDevice } from './app/device-guard.js';
import { initI18n } from './i18n/index.js';

initI18n();

function revealApp() {
	let revealed = false;
	const done = (animate = true) => {
		if (revealed) return;
		revealed = true;
		const root = document.documentElement;
		root.classList.remove('booting');
		if (animate && performance.now() < 6000 && document.visibilityState === 'visible') root.classList.add('booted');
		const boot = document.getElementById('boot');
		if (boot) {
			boot.classList.add('is-done');
			setTimeout(() => boot.remove(), 700);
		}
		setTimeout(() => root.classList.remove('booted'), 1400);
	};
	const early = () => done(false);
	window.addEventListener('pointerdown', early, { once: true, capture: true });
	window.addEventListener('keydown', early, { once: true, capture: true });
	window.addEventListener('drop', early, { once: true, capture: true });
	setTimeout(() => done(false), 4000);
	const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
	Promise.all([fonts, new Promise((r) => setTimeout(r, 450))]).then(() => requestAnimationFrame(() => requestAnimationFrame(() => done(true))));
}

function showFatal(e) {
	console.error(e);
	document.documentElement.classList.remove('booting');
	document.getElementById('boot')?.remove();
	const box = document.getElementById('fatal');
	if (!box) return;
	const webgl = /webgl/i.test(String(e && e.message));
	box.hidden = false;
	box.innerHTML =
		'<div class="fatal-card"><h2>' +
		(webgl ? 'Не удалось запустить 3D-графику' : 'Не удалось запустить редактор') +
		'</h2><p>' +
		(webgl ? 'Браузеру не удалось создать WebGL-контекст. Включите аппаратное ускорение в настройках браузера или откройте страницу в Chrome, Edge или Safari.' : 'Откройте консоль разработчика, чтобы увидеть подробности.') +
		'</p><code></code></div>';
	box.querySelector('code').textContent = String(e && e.message ? e.message : e);
}

import { iconsReady } from './ui/icons.js';

if ('serviceWorker' in navigator && location.protocol === 'https:') {
	window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
	e.preventDefault();
	installEvent = e;
	const b = document.getElementById('btnInstall');
	if (b) b.hidden = false;
});
window.addEventListener('appinstalled', () => {
	installEvent = null;
	const b = document.getElementById('btnInstall');
	if (b) b.hidden = true;
});
document.addEventListener('click', (e) => {
	if (e.target.closest && e.target.closest('#btnInstall') && installEvent) {
		installEvent.prompt();
		installEvent = null;
	}
});

iconsReady
	.then(() => {
		guardDevice();
		const app = new App();
		app.start();
		window.__app = app;
		revealApp();
		window.__dev = { THREE, GLTFLoader, exportModel, verifyGLB, makeTextureSampler, makeDemoFiles, exportForWeb, runBenchmark };
	})
	.catch(showFatal);
