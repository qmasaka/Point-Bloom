import EN from './i18n-en.js';
import EXTRA from './i18n-extra.js';
Object.assign(EN, EXTRA);
const CY = /[А-Яа-яЁё]/;
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-tip'];
const RU_TITLE = 'Point Bloom: облака точек, эффекты и конвертер OBJ в GLB';
const RU_DESC = 'Point Bloom превращает 3D-модели, фото, видео и текст в живые облака точек. Эффекты под музыку и камеру, редактор сцены и конвертер OBJ, FBX, STL, PLY в GLB прямо в браузере.';
function detect() {
try {
if (new URLSearchParams(location.search).get('_x_tr_tl') === 'ru') return 'ru';
} catch (_) {}
return 'en';
}
export let lang = 'ru';
const cache = new Map();
let tpl = null;
let frag = null;
let sub = null;
export const missing = new Set();
function build() {
if (tpl) return;
tpl = [];
frag = new Map();
const sp = /<[^>]+>|\{\}/g;
for (const [ru, en] of Object.entries(EN)) {
if (ru.includes('{}')) {
const norm = (x) => x.replace(/&nbsp;/g, '\u00a0');
const parts = norm(ru).split('{}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
tpl.push({ re: new RegExp('^' + parts.join('(.*?)') + '$', 's'), en: norm(en) });
const a = ru.split('{}');
const b = en.split('{}');
if (a.length === b.length) a.forEach((x, i) => { const k = norm(x).replace(/\u00a0/g, ' ').trim(); if (k && CY.test(k) && !frag.has(k)) frag.set(k, norm(b[i]).replace(/\u00a0/g, ' ').trim()); });
}
if (/<|\{\}/.test(ru)) {
const a = ru.split(sp);
const b = en.split(sp);
if (a.length === b.length) a.forEach((x, i) => x.trim() && CY.test(x) && !frag.has(x.trim()) && frag.set(x.trim(), b[i].trim()));
}
}
sub = Object.keys(EN)
.filter((k) => !k.includes('{}') && !k.includes('<') && k.trim().length >= 2)
.sort((a, b) => b.length - a.length);
}
const isL = (c) => !!c && /[А-Яа-яЁёA-Za-z0-9]/.test(c);
export function tr(s) {
if (lang !== 'en' || typeof s !== 'string' || !CY.test(s)) return s;
const hit = cache.get(s);
if (hit !== undefined) return hit;
build();
const lead = s.match(/^\s*/)[0];
const trail = s.match(/\s*$/)[0];
const core = s.trim();
let out = null;
if (EN[core] !== undefined) out = EN[core];
else if (frag.has(core)) out = frag.get(core);
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
const v = EN[k];
r = r.slice(0, i) + v + r.slice(i + k.length);
i += v.length;
}
if (!CY.test(r)) break;
}
out = r;
}
const res = lead + out + trail;
cache.set(s, res);
if (CY.test(res)) missing.add(core);
return res;
}
const ORIG = Symbol('ru');
const ORIG_EN = Symbol('en');
let observer = null;
let busy = false;
function textNode(n) {
const v = n.nodeValue;
if (n[ORIG] !== undefined && v === n[ORIG_EN]) return;
if (!CY.test(v)) return;
const out = tr(v);
if (out !== v) {
n[ORIG] = v;
n[ORIG_EN] = out;
n.nodeValue = out;
}
}
function attrs(el) {
for (const a of ATTRS) {
const v = el.getAttribute && el.getAttribute(a);
if (!v || !CY.test(v)) continue;
const out = tr(v);
if (out !== v) {
(el.__ruAttrs ||= {})[a] = v;
el.setAttribute(a, out);
}
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
function restore(root) {
const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
let n = tw.currentNode;
while (n) {
if (n.nodeType === 3) {
if (n[ORIG] !== undefined && n.nodeValue === n[ORIG_EN]) n.nodeValue = n[ORIG];
n[ORIG] = undefined;
} else if (n.__ruAttrs) {
for (const [a, v] of Object.entries(n.__ruAttrs)) n.setAttribute(a, v);
n.__ruAttrs = null;
}
n = tw.nextNode();
}
}
const EN_META = { title: '', desc: '' };
function meta() {
const d = document.querySelector('meta[name="description"]');
if (!EN_META.title) {
EN_META.title = document.title;
EN_META.desc = d ? d.getAttribute('content') : '';
}
if (lang === 'ru') {
document.title = RU_TITLE;
if (d) d.setAttribute('content', RU_DESC);
} else {
document.title = EN_META.title;
if (d) d.setAttribute('content', EN_META.desc);
}
if (!translatorOn()) document.documentElement.lang = lang;
}
function onMutations(list) {
if (busy || lang !== 'en') return;
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
const translatorOn = () => /\btranslated-(ltr|rtl)\b/.test(document.documentElement.className);
let forced = false;
function forceRu() {
if (forced) return;
forced = true;
lang = 'ru';
busy = true;
try {
const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
let n = tw.currentNode;
while (n) {
if (n.nodeType === 3) {
if (n[ORIG] !== undefined) n.nodeValue = n[ORIG];
n[ORIG] = undefined;
} else if (n.__ruAttrs) {
for (const [a, v] of Object.entries(n.__ruAttrs)) n.setAttribute(a, v);
n.__ruAttrs = null;
}
n = tw.nextNode();
}
} finally {
observer && observer.takeRecords();
busy = false;
}
document.documentElement.setAttribute('translate', 'no');
if (!document.querySelector('meta[name="google"][content="notranslate"]')) {
const m = document.createElement('meta');
m.name = 'google';
m.content = 'notranslate';
document.head.append(m);
}
meta();
window.dispatchEvent(new CustomEvent('langchange', { detail: 'ru' }));
}
function revertEn() {
if (!forced) return;
forced = false;
document.documentElement.removeAttribute('translate');
document.querySelector('meta[name="google"][content="notranslate"]')?.remove();
setLang('en');
}
function watchTranslator() {
const check = () => {
if (translatorOn() && /^ru\b/i.test(document.documentElement.lang || '')) forceRu();
else if (forced && (!translatorOn() || !/^ru\b/i.test(document.documentElement.lang || ''))) revertEn();
};
new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'class'] });
check();
}
export function setLang(next) {
if (next !== 'ru' && next !== 'en') return;
lang = next;
busy = true;
try {
if (next === 'en') walk(document.body);
else restore(document.body);
} finally {
observer && observer.takeRecords();
busy = false;
}
meta();
window.dispatchEvent(new CustomEvent('langchange', { detail: next }));
}
export function initI18n() {
lang = detect();
observer = new MutationObserver(onMutations);
observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
if (lang === 'en') {
busy = true;
walk(document.body);
observer.takeRecords();
busy = false;
}
meta();
watchTranslator();
window.__i18n = { tr, missing, setLang, get lang() { return lang; } };
}
