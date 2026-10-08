import { App } from './app.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { exportModel, verifyGLB } from './exporters.js';
import { makeTextureSampler } from './pointcloud.js';
import { makeDemoFiles } from './demo.js';
import { exportForWeb } from './web-export.js';
import { runBenchmark } from './capabilities.js';
import { guardDevice } from './device-guard.js';
function revealApp() {
const done = () => {
const root = document.documentElement;
root.classList.remove('booting');
root.classList.add('booted');
const boot = document.getElementById('boot');
if (boot) {
boot.classList.add('is-done');
setTimeout(() => boot.remove(), 700);
}
setTimeout(() => root.classList.remove('booted'), 1400);
};
setTimeout(done, 4000);
const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
Promise.all([fonts, new Promise((r) => setTimeout(r, 450))]).then(() => requestAnimationFrame(() => requestAnimationFrame(done)));
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
import { iconsReady } from './icons.js';
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
