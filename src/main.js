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

// перевод включается до сборки интерфейса: всё, что он создаст, переведётся сразу
initI18n();

/** Плавное открытие: пока всё строится, виден экран загрузки, потом он гаснет, а панели выезжают на места */
function revealApp() {
	let revealed = false;
	// animate=false: интерфейс просто появляется. Выезд панелей нужен только при обычном открытии: если открытие затянулось (вкладка была в фоне, страница занята) или пользователь уже что-то делает, повторять его поверх модели нельзя, это и было миганием после добавления файла
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
	setTimeout(() => done(false), 4000); // страховка: если вкладка скрыта и кадры не рисуются, интерфейс всё равно покажется
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

// установка как приложения отключена: сайт открывается только во вкладке, а ранее поставленные сервис-воркеры снимаются
if ('serviceWorker' in navigator) {
	navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
}

iconsReady
	.then(() => {
		guardDevice(); // на другом устройстве сайт начинает с исходных настроек
		const app = new App();
		app.start();
		window.__app = app; // удобно для отладки из консоли
		revealApp();
		window.__dev = { THREE, GLTFLoader, exportModel, verifyGLB, makeTextureSampler, makeDemoFiles, exportForWeb, runBenchmark }; // для отладки и автотестов
	})
	.catch(showFatal);
