import EN from './en.js';
import EXTRA from './extra.js';
import UK from './uk.js';
import ES from './es.js';
import DE from './de.js';
import MORE from './more.js';
Object.assign(EN, EXTRA);
const DICTS = { en: EN, uk: UK, es: ES, de: DE };
for (const k of Object.keys(DICTS)) Object.assign(DICTS[k], MORE[k]);
const SUPPORTED = ['ru', 'uk', 'es', 'de'];
const CY = /[А-Яа-яЁё]/;
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-tip'];
const RU_TITLE = 'Point Bloom: студия 3D-облаков точек';
const RU_DESC = 'Превращайте 3D-модели, фото, видео и текст в живые облака точек. Добавляйте эффекты, правьте точки и экспортируйте в GLB, PLY или веб-страницу прямо в браузере.';
function detect() {
try {
const tl = new URLSearchParams(location.search).get('_x_tr_tl');
if (tl && SUPPORTED.includes(tl.slice(0, 2).toLowerCase())) return tl.slice(0, 2).toLowerCase();
} catch (_) {}
try {
for (const l of navigator.languages || [navigator.language]) {
const c = String(l || '').slice(0, 2).toLowerCase();
if (c === 'en') return 'en';
if (SUPPORTED.includes(c)) return c;
}
} catch (_) {}
return 'en';
}
export let lang = 'en';
const caches = {};
const built = {};
export const missing = new Set();
function build(code) {
if (built[code]) return built[code];
const D = DICTS[code];
const tpl = [];
const frag = new Map();
const sp = /<[^>]+>|\{\}/g;
const norm = (x) => x.replace(/&nbsp;/g, ' ');
for (const [ru, tx] of Object.entries(D)) {
if (ru.includes('{}')) {
const parts = norm(ru).split('{}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
tpl.push({ re: new RegExp('^' + parts.join('(.*?)') + '$', 's'), en: norm(tx), lit: norm(ru).replace(/\{\}/g, '').length });
const a = ru.split('{}');
const b = tx.split('{}');
if (a.length === b.length) a.forEach((x, i) => { const k = norm(x).replace(/ /g, ' ').trim(); if (k && CY.test(k) && !frag.has(k)) frag.set(k, norm(b[i]).replace(/ /g, ' ').trim()); });
}
if (/<|\{\}/.test(ru)) {
const a = ru.split(sp);
const b = tx.split(sp);
if (a.length === b.length) a.forEach((x, i) => x.trim() && CY.test(x) && !frag.has(x.trim()) && frag.set(x.trim(), b[i].trim()));
}
}
tpl.sort((x, y) => y.lit - x.lit);
const sub = Object.keys(D)
.filter((k) => !k.includes('{}') && !k.includes('<') && k.trim().length >= 2)
.sort((a, b) => b.length - a.length);
return (built[code] = { D, tpl, frag, sub });
}
export function tr(s) {
if (lang === 'ru' || typeof s !== 'string' || !CY.test(s)) return s;
const cache = (caches[lang] ||= new Map());
const hit = cache.get(s);
if (hit !== undefined) return hit;
const { D, tpl, frag, sub } = build(lang);
const lead = s.match(/^\s*/)[0];
const trail = s.match(/\s*$/)[0];
const core = s.trim();
let out = null;
if (D[core] !== undefined) {
out = D[core];
} else if (frag.has(core)) {
out = frag.get(core);
} else {
const low = core.charAt(0).toLowerCase() + core.slice(1);
const up = core.charAt(0).toUpperCase() + core.slice(1);
if (D[low] !== undefined) {
const trLow = D[low];
out = trLow.charAt(0).toUpperCase() + trLow.slice(1);
} else if (D[up] !== undefined) {
const trUp = D[up];
out = trUp.charAt(0).toLowerCase() + trUp.slice(1);
} else if (frag.has(low)) {
const frLow = frag.get(low);
out = frLow.charAt(0).toUpperCase() + frLow.slice(1);
} else if (frag.has(up)) {
const frUp = frag.get(up);
out = frUp.charAt(0).toLowerCase() + frUp.slice(1);
}
}
if (out === null) {
for (const t of tpl) {
const m = core.match(t.re);
if (m) {
let i = 0;
out = t.en.replace(/\{\}/g, () => tr(m[++i]));
break;
}
}
}
if (out === null) {
let r = core;
for (const k of sub) {
if (!r.includes(k)) continue;
let i = 0;
while ((i = r.indexOf(k, i)) >= 0) {
const before = r[i - 1];
const after = r[i + k.length];
if ((CY.test(k[0]) && CY.test(before || '')) || (CY.test(k[k.length - 1]) && CY.test(after || ''))) {
i += k.length;
continue;
}
const v = D[k];
r = r.slice(0, i) + v + r.slice(i + k.length);
i += v.length;
}
if (!CY.test(r)) break;
}
out = r;
}
const res = lead + out + trail;
cache.set(s, res);
if (res.trim() === core || (lang !== 'uk' && CY.test(res))) missing.add(lang + ':' + core);
return res;
}
const ORIG = Symbol('ru');
const ORIG_EN = Symbol('tr');
let observer = null;
let busy = false;
function textNode(n) {
const v = n.nodeValue;
if (n[ORIG] !== undefined && v === n[ORIG_EN]) return;
if (!CY.test(v)) return;
const out = tr(v);
n[ORIG] = v;
n[ORIG_EN] = out;
if (out !== v) n.nodeValue = out;
}
function attrs(el) {
for (const a of ATTRS) {
const v = el.getAttribute && el.getAttribute(a);
if (!v || !CY.test(v)) continue;
const out = tr(v);
(el.__ruAttrs ||= {})[a] = v;
if (out !== v) el.setAttribute(a, out);
}
}
function walk(root) {
if (root.nodeType === 3) return textNode(root);
if (root.nodeType !== 1) return;
const tag = root.tagName;
if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'TEXTAREA') return;
attrs(root);
const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
let n = tw.nextNode();
while (n) {
if (n.nodeType === 3) {
const p = n.parentNode && n.parentNode.tagName;
if (p !== 'SCRIPT' && p !== 'STYLE') textNode(n);
} else if (n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE') attrs(n);
n = tw.nextNode();
}
}
function applyAll() {
const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
let n = tw.currentNode;
while (n) {
if (n.nodeType === 3) {
if (n[ORIG] !== undefined) {
const out = tr(n[ORIG]);
n[ORIG_EN] = out;
if (n.nodeValue !== out) n.nodeValue = out;
} else if (CY.test(n.nodeValue) && !['SCRIPT', 'STYLE'].includes(n.parentNode && n.parentNode.tagName)) textNode(n);
} else if (n.nodeType === 1) {
if (n.__ruAttrs) for (const [a, v] of Object.entries(n.__ruAttrs)) n.setAttribute(a, tr(v));
else attrs(n);
}
n = tw.nextNode();
}
}
const EN_META = { title: '', desc: '' };
const translatorOn = () => /\btranslated-(ltr|rtl)\b/.test(document.documentElement.className);
function meta() {
const d = document.querySelector('meta[name="description"]');
if (!EN_META.title) {
EN_META.title = document.title;
EN_META.desc = d ? d.getAttribute('content') : '';
}
if (lang === 'en') {
document.title = EN_META.title;
if (d) d.setAttribute('content', EN_META.desc);
} else {
document.title = tr(RU_TITLE);
if (d) d.setAttribute('content', tr(RU_DESC));
}
if (!translatorOn()) document.documentElement.lang = lang;
}
function onMutations(list) {
if (busy || lang === 'ru') return;
busy = true;
try {
for (const m of list) {
if (m.type === 'childList') m.addedNodes.forEach((n) => walk(n));
else if (m.type === 'characterData') textNode(m.target);
else if (m.type === 'attributes') attrs(m.target);
}
} finally {
observer.takeRecords();
busy = false;
}
}
export function setLang(next) {
if (next !== 'en' && !SUPPORTED.includes(next)) return;
lang = next;
busy = true;
try {
applyAll();
} finally {
observer && observer.takeRecords();
busy = false;
}
meta();
window.dispatchEvent(new CustomEvent('langchange', { detail: next }));
}
let forced = null;
function forceLang(code) {
forced = code;
setLang(code);
document.documentElement.setAttribute('translate', 'no');
if (!document.querySelector('meta[name="google"][content="notranslate"]')) {
const m = document.createElement('meta');
m.name = 'google';
m.content = 'notranslate';
document.head.append(m);
}
}
function revertEn() {
if (!forced) return;
forced = null;
document.documentElement.removeAttribute('translate');
document.querySelector('meta[name="google"][content="notranslate"]')?.remove();
setLang('en');
}
function watchTranslator() {
const check = () => {
const code = translatorOn() ? (document.documentElement.lang || '').slice(0, 2).toLowerCase() : '';
if (SUPPORTED.includes(code)) {
if (forced !== code) forceLang(code);
} else if (forced) revertEn();
};
new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'class'] });
check();
}
export function initI18n() {
lang = detect();
observer = new MutationObserver(onMutations);
observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
busy = true;
if (lang !== 'ru') walk(document.body);
observer.takeRecords();
busy = false;
meta();
watchTranslator();
window.__i18n = { tr, missing, setLang, get lang() { return lang; } };
}
