import { common } from './common.js';
export const vert = `
attribute vec3 aOrigin;
attribute vec3 aTarget;
attribute vec3 aColor;
attribute float aIdx;
attribute vec3 aSculpt;
attribute vec3 aNormal;
attribute vec3 aNormalB;
attribute vec4 aPaint; // акварель на точке: rgb цвет краски, w её количество
attribute vec3 aColorB;
attribute float aHide;
attribute float aDepth;
attribute float aPath;
uniform float uAdd;
uniform highp sampler2DArray uFrTex;
uniform sampler2D uHeroTex;
attribute vec2 aVis;
uniform vec3 uSolid;
uniform float uAtt;
uniform float uSize;
uniform float uPR;
uniform vec3 uGlyph;
uniform float uColorBy;
uniform float uBright;
uniform float uMaskShow;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform vec3 uSliceC;
uniform vec3 uMarkC;
varying vec3 vColor;
varying float vD;
varying float vDk;
varying float vCoc;
varying float vGl;
` + common + `
#ifdef VSHOOT
// «Рост на ритме»: очаги роста на форме. uShootS это 24 очага (xyz место на форме, w сколько выросло)
uniform vec4 uShoot;
uniform vec4 uShootP;
uniform vec4 uShootD;
uniform vec4 uShootE;
uniform vec4 uShootC;
uniform vec4 uShootS[24];
uniform vec4 uShootN[24]; // нормаль участка (xyz) и сколько его осталось видно (w: гаснет, когда участок отломился)
uniform vec4 uShootB[6];
#endif
#ifdef VSCREEN
// «Экран»: видео играет на форме. Блок включают WebGL (shader-cache.js) и генератор WGSL (dev/gen-wgsl.mjs)
uniform vec4 uScr;
uniform vec4 uScrP;
uniform sampler2D uScrTex;
uniform vec4 uScrD; // объём по глубине: x источник (0 нет, 1 яркость, 2 карта), y сила, z знак (-1 выступает дальнее), w контраст
uniform vec4 uScrQ; // x: показывать карту глубины вместо видео
uniform sampler2D uScrDep;
// память цвета «Экрана»: текстура по номеру точки (строки по 2048), rgb хранится как корень из цвета / 4, a: сколько его осталось. Считается на процессоре (screen.js)
uniform sampler2D uScrMTex;
uniform float uScrMN;
// «Слит-скан»: x сила, y сколько прошлого (доля буфера), z голова буфера, w вид; uSlitP: направление, бегущий срез, время вглубь, ступени; uSlitG: колонки, строки, точек, кадров в буфере
uniform vec4 uSlit;
uniform vec4 uSlitP;
uniform vec4 uSlitG;
uniform highp sampler2DArray uSlitTex;
// «Пиксельная сортировка»: x сила, y как движется (0 держит, 1 волна, 2 удар, 3 дыхание), z скорость, w направление (0 строки, 1 столбцы); uSortP: точек, колонок, растяжение, свечение
uniform vec4 uSort;
uniform vec4 uSortP;
uniform highp sampler2D uSortTex;
#endif
#ifdef SHADOW
// «Тень на стене»: копия облака проецируется по лучу света на пол или стену (объект в engine/shadow.js; в WebGPU свой вариант расчёта, см. dev/gen-wgsl.mjs)
uniform vec4 uShd; // x непрозрачность, y мягкость, z цвет (0 тёмная, 1 свет палитры, 2 цвет модели), w живая тень (колыхание)
uniform vec4 uShdL; // xyz направление на свет (в мире), w: 0 пол, 1 стена
uniform vec4 uShdP; // x положение плоскости (y пола или z стены), y затухание с высотой над плоскостью
uniform vec3 uShdC; // цвет тёмной тени
#endif
#ifdef HERO
#define HEROSIZE clamp(sqrt(uFr.z / max(uHero.z, 1.0)), 0.4, 1.0)
// глубина кадра k (альфа-канал текстуры кадров) в точке g сетки кадра, билинейно: главный кадр гуще сетки кадров, и без сглаживания рельеф шёл бы ступеньками
float frLayerDepth(float k, vec2 g) {
	int layer = int(mod(k + uFr5.x, uFr.y));
	vec2 m = vec2(uFr2.x - 1.0, uFr2.y - 1.0);
	vec2 p = clamp(g, vec2(0.0), m);
	vec2 p0 = floor(p);
	vec2 f = p - p0;
	vec2 p1 = min(p0 + vec2(1.0), m);
	float d00 = texelFetch(uFrTex, ivec3(int(p0.x), int(p0.y), layer), 0).a;
	float d10 = texelFetch(uFrTex, ivec3(int(p1.x), int(p0.y), layer), 0).a;
	float d01 = texelFetch(uFrTex, ivec3(int(p0.x), int(p1.y), layer), 0).a;
	float d11 = texelFetch(uFrTex, ivec3(int(p1.x), int(p1.y), layer), 0).a;
	return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
}
#else
#define HEROSIZE uFr6.x
#endif
void main() {
	if (aHide > 0.5) {
		// точка скрыта фильтром «Медиа»
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
		vColor = vec3(0.0);
		vD = 0.0;
		vCoc = 0.0;
		vGl = 0.0;
		return;
	}
	// раскадровка: цвет берётся из текстуры кадров, невидимые кадры отсекаются сразу
	vec3 frCol = vec3(1.0);
	vec3 frNrm = vec3(0.0, 0.0, 1.0);
	float frLift = 0.0;
	float frAp = -1.0;
	float frDep = 0.5;
	if (uFr.x > 0.5) {
		float fk;
		vec2 fcell;
		vec3 fp = frBlockPos(aIdx, frNrm, fk, fcell);
#ifdef HERO
		frAp = (fcell.y + fcell.x / uHero.x) / uHero.y;
#else
		frAp = (fcell.y + fcell.x / uFr2.x) / uFr2.y;
#endif
		vec3 tcol;
		vec4 sh = frShow(fk, tcol);
#ifdef HERO
		// главный кадр показывается как есть, без подсветки и затемнения
		if (uFr4.y < 0.5) sh.x = 1.0;
#endif
		bool cull = sh.x < 0.02;
		// без свечения затухание цветом дало бы чёрные точки: вместо этого точки гаснут рассыпаясь (часть выпадает), а цвет остаётся
		if (uAdd < 0.5 && sh.x < 1.0) {
			if (fract(sin(dot(fcell, vec2(39.346, 11.135)) + fk * 1.713) * 24634.6345) > sh.x) cull = true;
		}
		// без свечения цвет точек всегда как в видео: яркость кадров здесь меняется только числом точек
		if (uAdd < 0.5) sh.x = 1.0;
#ifndef HERO
		// текущий кадр рисуется густым набором точек, поэтому в блоке его место пустое
		if (uHero.w > 0.5 && abs(fk - floor(uFr4.x + 0.5)) < 0.1) cull = true;
		// прошлые и будущие кадры редеют с расстоянием от текущего: рядом все точки, далеко только часть
		float dl = abs(fk - uFr4.x);
		float keep = mix(1.0, clamp(1.0 / (1.0 + dl * 0.45), 0.08, 1.0), uFr5.y);
		float hs = fract(sin(dot(fcell, vec2(12.9898, 78.233)) + fk * 0.731) * 43758.5453);
		if (dl > 0.5 && hs > keep) cull = true;
		// длина хвоста: за ней кадры пропадают, а перед ней точки редеют тем плавнее, чем больше «плавность»
		if (uFr7.x < 0.999) {
			float tx = dl / max(uFr7.x * uFr.y, 1.0);
			if (tx >= 1.0 || hs > 1.0 - smoothstep(min(1.0 - uFr7.z, 0.999), 1.0, tx)) cull = true;
		}
#endif
		if (cull) {
			gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
			gl_PointSize = 0.0;
			vColor = vec3(0.0);
			vD = 0.0;
			vCoc = 0.0;
			vGl = 0.0;
			return;
		}
		int layer = int(mod(fk + uFr5.x, uFr.y));
#ifdef HERO
		vec3 fc = texture2D(uHeroTex, vec2((fcell.x + 0.5) / uHero.x, 1.0 - (fcell.y + 0.5) / uHero.y)).rgb;
#else
		vec3 fc = texelFetch(uFrTex, ivec3(int(fcell.x), int(fcell.y), layer), 0).rgb;
#endif
#ifndef HERO
		fc = min(fc * uFr5.w, vec3(1.6));
		// насыщенность: ноль это цвета видео, плюс сочнее, минус ближе к серому
		if (abs(uFr7.y) > 0.001) fc = max(mix(vec3(dot(fc, vec3(0.3, 0.59, 0.11))), fc, 1.0 + uFr7.y * (uFr7.y > 0.0 ? 2.0 : 1.0)), 0.0);
		// отбор по тону: остаются только светлые или только тёмные точки остальных кадров
		if (uFr6.z > 0.5) {
			float lt = pow(dot(fc, vec3(0.3, 0.59, 0.11)), 0.4545);
			if (uFr6.z < 1.5 ? lt < uFr6.w : lt > uFr6.w) {
				gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
				gl_PointSize = 0.0;
				vColor = vec3(0.0);
				vD = 0.0;
				vCoc = 0.0;
				vGl = 0.0;
				return;
			}
		}
#endif
		float l = dot(fc, vec3(0.3, 0.59, 0.11));
		frCol = (fc * (1.0 - sh.z) + tcol * (0.35 + l * 1.6) * sh.z) * sh.x;
		frLift = sh.y;
		// «Объём по глубине» на раскадровке: у каждого кадра своя карта глубины в альфа-канале текстуры кадров
		if (uDepth.x > 0.001) {
#ifdef HERO
			// главный кадр идёт за видео: глубина плавно перетекает между соседними снятыми кадрами
			vec2 hg = (fcell + 0.5) / uHero.xy * uFr2.xy - 0.5;
			float hk0 = clamp(floor(uFr4.x), 0.0, uFr.y - 1.0);
			float hk1 = min(hk0 + 1.0, uFr.y - 1.0);
			frDep = mix(frLayerDepth(hk0, hg), frLayerDepth(hk1, hg), clamp(uFr4.x - hk0, 0.0, 1.0));
#else
			frDep = texelFetch(uFrTex, ivec3(int(fcell.x), int(fcell.y), layer), 0).a;
#endif
			// правка карты (яркость, контраст, тени) считается здесь, для каждого кадра
			frDep = pow(max(clamp((frDep - 0.5) * uDepthQ.z + 0.5 + uDepthQ.y, 0.0, 1.0), 1e-4), uDepthQ.w);
#ifndef HERO
			// остальные кадры выдавливаются слабее (настройка раскадровки), иначе в стопке они врезаются друг в друга
			float dkeep = mix(uFr7.w, 1.0, 1.0 - clamp(abs(fk - uFr4.x), 0.0, 1.0));
			frDep = mix(uDepth.w, frDep, dkeep);
#endif
		}
	}
	vec3 base;
	float maskV;
	gDepth = uFr.x > 0.5 ? frDep : aDepth;
	gNormal = aNormal;
	gLum = uFr.x > 0.5 ? dot(frCol, vec3(0.3, 0.59, 0.11)) : dot(aColor, vec3(0.3, 0.59, 0.11));
	if (uScope.x > 0.001) {
		// осциллограф: aPath это место точки на пути пера (0..1), uScope.z это положение пера, у ещё не нарисованных точек размер падает до нуля
		bool rv = uScope.y > 1.5;
		float cm = rv ? uScope.y - 2.0 : uScope.y;
		// в раскадровке путь это строчная развёртка кадра (точки формы там не видны), иначе перо шло бы по невидимым точкам
		float ap0 = frAp >= 0.0 ? frAp : aPath;
		float ap = rv ? 1.0 - ap0 : ap0;
		if (uScopeP.w > 1.5) ap = fract(ap * uScopeP.w);
		float sAge = uScope.z - ap;
		float hideAll = (ap < uScopeP.z ? 1.0 : 0.0) * min(1.0, uScopeP.x * 4.0);
		if (sAge >= 0.0) {
			gScopeT = (cm < 0.5 ? 1.0 : exp(-sAge * 4.0 / max(uScope.w, 0.02))) * uScopeP.y;
			gScopeG = exp(-sAge * 45.0) * uScopeP.y;
			// стирание: перо идёт по следу второй раз и съедает нарисованное, на кромке светится
			if (uScopeP.z > 0.0 && ap >= uScopeP.z) gScopeG = max(gScopeG, exp(-(ap - uScopeP.z) * 45.0));
			gScopeD = hideAll;
		} else gScopeD = max(clamp(uScopeP.x * uScope.x * 1.6, 0.0, 1.0), hideAll);
	}
	vec3 pos = fxDisplace(aOrigin, aTarget, aIdx, base, maskV);
	pos += aSculpt;
	if (gScopeG > 0.01) pos += (vec3(hash11(aIdx * 13.1), hash11(aIdx * 7.7), hash11(aIdx * 3.3)) - 0.5) * gScopeG * uScopeQ.w * 0.4;
	if (uFr.x > 0.5) pos += frNrm * frLift * 0.7;
	float dkv = disK(base, aIdx);
	vDk = max(max(dkv, gDrop), 1.0 - gGrow);
	float t = uTime - uTOff;
	float disp = clamp(length(pos - base) * 1.5, 0.0, 1.0);
	float k;
	if (uColorBy < 0.5) k = clamp(disp + uBeat * 0.12, 0.0, 1.0);
	else if (uColorBy < 1.5) k = clamp((pos.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	else k = fract(aIdx * 3.0 + t * 0.03);
	vec3 col = k < 0.5 ? mix(uP0, uP1, k * 2.0) : mix(uP1, uP2, (k - 0.5) * 2.0);
	// цвет и нормаль плавно перетекают вместе с формой
	float ltC = uMorph < 0.9999 ? morphLocal(aOrigin, aTarget, aIdx) : 1.0;
	float eC = uMorph < 0.9999 ? (int(uMorphS.x + 0.5) == 2 ? smoothstep(0.5, 0.9, ltC) : morphEase(ltC)) : 1.0;
	vec3 colM = mix(aColor, aColorB, eC);
	if (uFr.x > 0.5) colM = frCol;
#ifdef VSCREEN
#ifndef HERO
	// слит-скан: у точки своя задержка во времени, цвет из кадра в прошлом (между соседними кадрами плавно)
	if (uSlit.x > 0.001) {
		float sip = floor(aIdx * uSlitG.z + 0.5);
		float sci = mod(sip, uSlitG.x);
		float scj = floor(sip / uSlitG.x);
		vec2 suv0 = vec2((sci + 0.5) / uSlitG.x, (scj + 0.5) / uSlitG.y);
		int sm = int(uSlit.w + 0.5);
		float sf;
		if (sm == 0) sf = suv0.y;
		else if (sm == 1) sf = suv0.x;
		else if (sm == 2) sf = clamp(length((suv0 - 0.5) * vec2(uSlitG.x / uSlitG.y, 1.0)) * 1.25, 0.0, 1.0);
		else if (sm == 3) sf = uDepth.x > 0.001 ? 1.0 - gDepth : 1.0 - gLum;
		else sf = snoise(vec3(suv0 * vec2(uSlitG.x / uSlitG.y, 1.0) * 2.5, uTime * 0.12)) * 0.5 + 0.5;
		if (uSlitP.y > 0.001) sf = fract(sf + uTime * uSlitP.y * 0.25);
		if (uSlitP.w > 1.5) sf = floor(sf * uSlitP.w) / (uSlitP.w - 1.0);
		sf = clamp(sf, 0.0, 1.0);
		if (uSlitP.x < 0.0) sf = 1.0 - sf;
		float sd = sf * uSlit.y * (uSlitG.w - 1.0);
		float s0 = floor(sd);
		int sl0 = int(mod(uSlit.z - s0 + uSlitG.w * 8.0, uSlitG.w));
		int sl1 = int(mod(uSlit.z - s0 - 1.0 + uSlitG.w * 8.0, uSlitG.w));
		vec3 scol = mix(texelFetch(uSlitTex, ivec3(int(sci), int(scj), sl0), 0).rgb, texelFetch(uSlitTex, ivec3(int(sci), int(scj), sl1), 0).rgb, sd - s0);
		float sk = min(uSlit.x, 1.0);
		colM = mix(colM, scol, sk);
		// время вглубь: чем старше кадр точки, тем дальше она от зрителя
		pos.z -= sf * uSlit.y * uSlitP.z * 1.2 * sk;
	}
	// пиксельная сортировка: точка едет к своему месту в отсортированной полосе, вместе со своим цветом
	if (uSort.x > 0.001) {
		float qi = floor(aIdx * uSortP.x + 0.5);
		vec2 qd = texelFetch(uSortTex, ivec2(int(mod(qi, 2048.0)), int(floor(qi / 2048.0))), 0).xy;
		float qline = uSort.w > 0.5 ? mod(qi, uSortP.y) : floor(qi / uSortP.y);
		int qm = int(uSort.y + 0.5);
		float qk = 1.0;
		if (qm == 1) qk = 0.5 + 0.5 * sin(uTime * uSort.z * 1.6 - qline * 0.07);
		else if (qm == 2) qk = clamp(uBeat * 1.4, 0.0, 1.0);
		else if (qm == 3) qk = 0.5 + 0.5 * sin(uTime * uSort.z * 1.2);
		qk = qk * qk * (3.0 - 2.0 * qk) * min(uSort.x, 1.0);
		pos.xy += qd * qk * uSortP.z;
		// сдвинутые точки светятся: видны полосы сортировки
		colM *= 1.0 + min(length(qd) * 6.0, 1.0) * qk * uSortP.w;
	}
#endif
#endif
	vec3 nrmM = mix(aNormal, aNormalB, eC);
	if (uColorBy > 2.5 && uColorBy < 3.5) col = colM;
	else if (uColorBy > 3.5 && uColorBy < 4.5) col = uSolid;
	else if (uColorBy > 4.5) {
		vec3 wn = mat3(modelMatrix) * nrmM;
		wn = length(wn) > 0.0 ? normalize(wn) : vec3(0.0, 1.0, 0.0);
		col = pow(wn * 0.5 + 0.5, vec3(2.2));
	}
	// видимость точки при морфинге между моделями с разным числом точек: лишние плавно гаснут, недостающие проявляются
	float vm = uMorph * uMorph * (3.0 - 2.0 * uMorph);
	float vis = mix(aVis.x, aVis.y, vm);
	vColor = col * uBright * (1.0 + uBeat * 0.3) * vis;
	// акварель: краска, нанесённая кистью, хранится на самой точке и остаётся после мазка
	if (uPaintP.x > 0.5 && aPaint.w > 0.002) {
		float pa = aPaint.w;
		float cov = 1.0 - exp(-pa * 3.4);
		cov *= mix(1.0, 0.8 + 0.4 * hash11(aIdx * 91.7), uPaintP.y);
		vec3 pig = pow(max(aPaint.rgb, vec3(0.002)), vec3(0.7 + 0.5 * min(pa, 1.6)));
		vColor = uPaintP.z > 0.5 ? vColor * mix(vec3(1.0), pig * 1.15, cov) : mix(vColor, pig * uBright, cov);
	}
	if (uMask.x > 0.5 && uMaskShow > 0.5) vColor = mix(vColor, uP2 * 1.4, maskV * 0.55);
	// фигуры Хладни: песок на узловых линиях ярче, чем в пучностях
	if (uCh.x > 0.001) vColor *= mix(1.0, 0.45 + 1.1 * gChN, min(uCh.x, 1.0));
	// гиперпространство: цвет по четвёртой оси (у центра 3-сферы первый цвет палитры, у бесконечности последний), детали кадра сохраняются по яркости
	if (uHyp.x > 0.001) {
		float hk4 = clamp((gHypW + 1.0) * 0.5, 0.0, 1.0);
		vec3 hc = hk4 < 0.5 ? mix(uP0, uP1, hk4 * 2.0) : mix(uP1, uP2, (hk4 - 0.5) * 2.0);
		vColor = mix(vColor, hc * uBright * (0.55 + 0.9 * dot(vColor, vec3(0.3, 0.59, 0.11))), uHypP.y * min(uHyp.x, 1.0));
	}
	// точки, улетевшие в бесконечность (гиперпространство, переход «Через 4D»), тускнеют
	vColor *= 1.0 - 0.6 * gHypF;
	// объём: свет сверху слева по нормалям, обратная сторона формы темнее
	if (uShade > 0.001 && dot(nrmM, nrmM) > 0.01) {
		vec3 nv = normalize(normalMatrix * nrmM);
		float lit = dot(nv, normalize(vec3(-0.45, 0.65, 0.6)));
		float f = 0.18 + 1.05 * pow(clamp(lit * 0.5 + 0.5, 0.0, 1.0), 1.6);
		f *= nv.z < 0.0 ? mix(1.0, 0.55, clamp(-nv.z * 1.6, 0.0, 1.0)) : 1.0;
		vColor *= mix(1.0, f, uShade);
	}
	vGl = clamp(sqrt(max(dot(vColor, vec3(0.3, 0.59, 0.11)), 0.0)) * 0.85 + (hash11(aIdx * 1.7) - 0.5) * 0.35, 0.0, 1.0);

	// Кисть: свечение в следе мазка
	if (uBrushParam.x > 0.001) {
		float bGlow = 0.0;
		for (int i = 0; i < 20; i++) {
			float age = uBrushHits[i].w;
			if (age < 0.0) continue;
			float dist = distance(base, uBrushHits[i].xyz);
			if (dist < uBrushParam.y) {
				float life = 1.0 - age / uBrushParam.z;
				bGlow = max(bGlow, (1.0 - dist / uBrushParam.y) * life);
			}
		}
		if (bGlow > 0.001) vColor += uP2 * bGlow * 2.2 * uBrushParam.x;
	}

	// Руки: подсветка точек возле кончиков пальцев
	if (uHandP.x > 0.001) {
		float hg = 0.0;
		for (int i = 0; i < 12; i++) {
			if (float(i) >= uHandP.w) break;
			float hdst = distance(pos, uHand[i].xyz);
			if (hdst < uHandP.y) hg = max(hg, (1.0 - hdst / uHandP.y) * (uHand[i].w > 1.5 ? uHand[i].w - 2.0 : abs(uHand[i].w)));
		}
		vColor += uP2 * hg * hg * 1.6 * uHandP.x;
	}

	// Область трекинга: негатив, радуга, дыра, лупа, пиксели или свет вокруг рамок
	float mkv = markK(base);
	if (mkv > 0.0) {
		if (uMark.x < 1.5) vColor = mix(vColor, (vec3(1.0) - min(vColor, vec3(1.0))) * 1.3, mkv);
		else if (uMark.x < 2.5) vColor = mix(vColor, hueRot(vColor, uTime * 2.0 + length(base) * 6.0) * 1.15, mkv);
		else if (uMark.x < 3.5) {
			float edge = smoothstep(0.0, 0.35, mkv) * (1.0 - smoothstep(0.35, 0.9, mkv));
			vColor = vColor * (1.0 - smoothstep(0.35, 0.9, mkv)) + uMarkC * edge * 2.0;
		} else if (uMark.x < 4.5) vColor *= 1.0 + mkv * 0.8;
		else if (uMark.x > 5.5) vColor += uMarkC * mkv * 1.8;
	}
	// Исчезновение точек в местах касания: плавно гаснут без подсветки края
	float cvan = 0.0;
	if (uContact.z > 6.5 && uContact.x > 0.001) {
		cvan = contactK(base);
		vColor *= 1.0 - smoothstep(0.1, 0.8, cvan);
	}

	// Срез / Изолинии: лазеры, рельеф на линиях или развёртка за бегущей плоскостью
	float sl = 0.0;
	if (uSlice.x > 0.001) {
		float axCode = mod(uSlice.w, 10.0);
		float nLines = max(1.0, floor(uSlice.w / 10.0));
		float c = axCode < 0.5 ? base.y : (axCode < 1.5 ? base.x : (axCode < 2.5 ? base.z : (base.x + base.y) * 0.707));
		float v = clamp((c + 1.2) / 2.4, 0.0, 1.0);
		if (uSliceM.x > 1.5) {
			float d = uSlice.y - v;
			sl = (1.0 - smoothstep(0.0, uSlice.z * 0.3 + 0.012, abs(d))) * uSlice.x;
			vColor *= mix(1.0, smoothstep(-0.012, 0.012, d), min(uSlice.x, 1.0));
			vColor += (uSliceM.z > 0.5 ? vColor * 0.25 : uSliceC) * sl * 2.4;
		} else {
			float coord = mod(v * nLines - uSlice.y * nLines, 1.0);
			sl = (1.0 - smoothstep(uSlice.z * 0.4, uSlice.z, abs(coord - 0.5))) * uSlice.x;
			vColor += (uSliceM.z > 0.5 ? vColor * 0.25 : uSliceC) * sl * 2.2;
		}
	}
	// глубина: показ карты или окраска по глубине, блики сканера и контуров
	if (uDepth.x > 0.001) {
		if (uDepthP.w > 1.5) {
			// цвет глубины: от синего (далеко) через жёлтый к красному (близко), яркость берётся от кадра, чтобы не пропали детали
			vec3 jet = clamp(vec3(1.5 - abs(4.0 * gDepth - 3.0), 1.5 - abs(4.0 * gDepth - 2.0), 1.5 - abs(4.0 * gDepth - 1.0)), 0.0, 1.0);
			vColor = mix(vColor, jet * (0.4 + 0.95 * dot(vColor, vec3(0.3, 0.59, 0.11))), 0.88);
		} else if (uDepthP.w > 0.5) vColor = vec3(gDepth);
	}
	// осциллограф: линия окрашивается, голова пера горит
	if (uScope.x > 0.001) {
		vColor = mix(vColor, uScopeC * 1.4, uScopeQ.x * gScopeT);
		vColor += uScopeC * gScopeG * uScopeQ.z * 3.0;
	}
	// глитч: мерцание, строки-помехи и раздельные цветовые каналы
	if (gGl > 0.0) {
		vColor *= 0.55 + 0.45 * hash11(floor(uTime * 24.0) + floor(pos.y * 14.0));
		vColor *= 1.0 - 0.45 * min(gGl, 1.0) * step(0.5, fract(pos.y * 38.0));
		if (gCh > -0.5) vColor = mix(vColor, vColor * vec3(gCh < 0.5 ? 2.2 : 0.05, abs(gCh - 1.0) < 0.5 ? 2.2 : 0.05, gCh > 1.5 ? 2.2 : 0.05), min(1.0, gGl));
		// в момент всплеска сбойные места вспыхивают
		vColor += vec3(0.25, 0.3, 0.35) * gBurst * min(gGl, 1.0);
	}
	// росток: на фронте роста точки вспыхивают свежей зеленью в тон палитре
	if (uGrowP.z > 0.5) vColor += mix(vec3(0.3, 0.95, 0.4), uP2, 0.3) * pow(gGrowE, 1.6) * 0.55;
	// светящаяся кромка растворения: у горения огненная, у остальных цвета палитры, яркость задаёт настройка
	if (dkv > 0.0) {
		float edge = smoothstep(0.02, 0.25, dkv) * (1.0 - smoothstep(0.25, 0.75, dkv));
		if (uDisP.x > 0.5 && uDisP.x < 1.5) vColor += vec3(1.0, 0.42, 0.08) * edge * 2.4;
		else vColor += uP2 * edge * uDisQ.z * 2.0;
	}
	// вспышка в момент перехода: точки в пути ярче и крупнее
	float mkm = 0.0;
	if (uMorph < 0.9999 && uMorphO.z > 0.001) {
		mkm = sin(morphLocal(aOrigin, aTarget, aIdx) * PI) * uMorphO.z;
		vColor += vColor * mkm * 1.1 + uP2 * mkm * 0.25;
	}
	// размер точек в пути: в полёте они крупнее или мельче, на месте прежние
	float mfs = uMorph < 0.9999 ? mix(1.0, uMorphD.w, sin(morphLocal(aOrigin, aTarget, aIdx) * PI)) : 1.0;
	// после сборки по форме снизу вверх пробегает мягкая волна света и лёгкий «вздох», как будто модель села на место
	if (uSettle >= 0.0 && uSettle < 1.0) {
		float yS = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float dd = (yS - (uSettle * 1.35 - 0.15)) / 0.14;
		float band = exp(-dd * dd) * (1.0 - uSettle);
		mkm += band * 1.0;
		vColor += vColor * band * 0.9 + uP2 * band * 0.2;
		pos += normalize(vec3(pos.x, 0.0, pos.z) + vec3(1e-4)) * band * 0.03;
	}
#ifdef VSHOOT
	// «Рост на ритме»: uShoot = (сила, вид, радиус очага, предельная длина щупалец и шипов), uShootP = (свечение, дрожь, время, крупность оторвавшихся),
	// uShootS = 24 очага (xyz место на форме, w: у шипов сколько выросло, у видов отрыва на сколько участок отошёл), uShootN = нормаль участка и его видимость,
	// uShootD = (куда отходит: 0 наружу, 1 от центра, 2 вверх, 3 к зрителю; длина шага; особая настройка вида: ступени, размер осколков, слои, закрутка, разлёт), uShootE = (мягкость края участка, разброс длины, заострение столба).
	// Виды: 0 шипы, 1 бугры, 3 щупальца растут из очагов; отрыв участков: 2 плита, 4 столб, 5 ступени, 6 осколки, 7 слои, 8 винт, 9 пыль
	float shSzMul = 1.0;
	if (uShoot.x > 0.001) {
		vec3 bsh = base - uCen;
		vec3 nsh = dot(nrmM, nrmM) > 0.01 ? normalize(nrmM) : normalize(bsh + vec3(1e-4));
		vec3 shOff = vec3(0.0);
		float shK = 0.0;
		float hsh = hash11(aIdx * 3.77);
		bool shFam = (uShoot.y > 1.5 && uShoot.y < 2.5) || uShoot.y > 3.5;
		// у видов отрыва точка принадлежит одному участку: тому, что сильнее всего её захватил
		float bm = 0.0;
		float bd = 1.0;
		vec4 bs = vec4(0.0);
		vec4 bn = vec4(0.0, 0.0, 1.0, 1.0);
		for (int i = 0; i < 24; i++) {
			vec4 sd = uShootS[i];
			if (sd.w < 0.002) continue;
			float dsh = distance(base, sd.xyz) / uShoot.z;
			if (dsh >= 1.0) continue;
			if (shFam) {
				float m = 1.0 - smoothstep(1.0 - max(uShootE.x, 0.02), 1.0, dsh);
				if (m > bm) {
					bm = m;
					bd = dsh;
					bs = sd;
					bn = uShootN[i];
				}
				continue;
			}
			float pr = 1.0 - dsh;
			float grow = sd.w * uShoot.w;
			if (uShoot.y < 0.5) {
				pr = pr * pr * pr;
				shOff += nsh * pr * grow;
			} else if (uShoot.y < 1.5) {
				pr = pr * pr * (3.0 - 2.0 * pr);
				shOff += nsh * pr * grow * 0.55;
			} else {
				pr = pr * pr;
				float ph = uShootP.z * 2.2 + float(i) * 1.7;
				vec3 side = normalize(cross(nsh, vec3(0.31, 0.92, 0.23)) + vec3(1e-4));
				shOff += nsh * pr * grow + side * sin(ph + dsh * 9.0) * pr * grow * (0.25 + 0.6 * uShootP.y);
			}
			shK = max(shK, pr * min(sd.w * 1.5, 1.0));
		}
		if (shFam && bm > 0.0) {
			// участок отходит на bs.w (ступенями по ударам) в выбранную сторону, у каждого вида отрыва своя форма
			float d = bs.w * (1.0 - uShootE.y * hsh);
			float stp = max(uShootD.y, 0.005);
			vec3 dn = length(bn.xyz) > 0.01 ? normalize(bn.xyz) : normalize(bs.xyz - uCen + vec3(1e-4));
			if (uShootD.x > 0.5 && uShootD.x < 1.5) dn = normalize(bs.xyz - uCen + vec3(1e-4));
			else if (uShootD.x > 1.5 && uShootD.x < 2.5) dn = vec3(0.0, 1.0, 0.0);
			else if (uShootD.x > 2.5) dn = normalize(vec3(modelViewMatrix[0][2], modelViewMatrix[1][2], modelViewMatrix[2][2]) + vec3(1e-5));
			float md = uShoot.y;
			vec3 off;
			if (md < 2.5) {
				// плита: участок целиком, ровным куском
				off = dn * d * bm;
			} else if (md < 4.5) {
				// столб: точки участка растягиваются вдоль пути, участок вырастает колонной
				float tt = hash11(aIdx * 5.13);
				float pf = pow(tt, 0.75) * smoothstep(0.0, 0.6, bm);
				vec3 prel = base - bs.xyz;
				// заострение: боковые точки стягиваются к оси, чем дальше они вытянуты
				off = dn * d * pf - (prel - dn * dot(dn, prel)) * uShootE.z * clamp(d * pf * 1.5 / uShoot.z, 0.0, 1.0);
			} else if (md < 5.5) {
				// ступени: кольца участка отходят на разную высоту, вырастает ступенчатая пирамида
				float tiers = max(uShootD.z, 2.0);
				float ring = min(floor((1.0 - bd) * tiers + 0.001), tiers - 1.0);
				off = dn * d * mix(0.25, 1.0, ring / (tiers - 1.0)) * bm;
			} else if (md < 6.5) {
				// осколки: участок колется на куски, каждый отходит на свою длину и с наклоном
				vec3 cl = floor(base / max(uShoot.z * (0.08 + 0.55 * uShootD.z), 0.01));
				float hc = hash11(dot(cl, vec3(17.13, 31.71, 57.29)));
				vec3 tilt = vec3(hash11(hc * 91.0), hash11(hc * 57.0), hash11(hc * 33.0)) - 0.5;
				off = normalize(dn + tilt * 0.7) * d * (0.45 + hc * 1.1) * bm;
			} else if (md < 7.5) {
				// слои: участок расслаивается, как стопка листов: с каждым ударом поднимается ещё один слой
				float layer = floor(hash11(aIdx * 9.71) * max(uShootD.z, 2.0));
				off = dn * max(0.0, d - layer * stp * 0.75) * bm;
			} else if (md < 8.5) {
				// винт: участок выкручивается, поворачиваясь вокруг своей оси с каждым шагом
				vec3 rel = base - bs.xyz;
				float ang = d / stp * 0.6 * uShootD.z;
				float ca = cos(ang), sa = sin(ang);
				vec3 rr = rel * ca + cross(dn, rel) * sa + dn * dot(dn, rel) * (1.0 - ca);
				off = (rr - rel + dn * d) * bm;
			} else {
				// пыль: участок рассыпается, каждая точка уходит своей дорогой, но тоже ступенями
				vec3 rd = vec3(hash11(aIdx * 1.3), hash11(aIdx * 2.9), hash11(aIdx * 5.1)) - 0.5;
				off = normalize(dn + rd * uShootD.z) * d * (0.35 + hash11(aIdx * 7.7) * 1.3) * bm;
			}
			// дрожь: отошедшие точки чуть живут на месте
			off += vec3(sin(uShootP.z * 1.7 + hsh * 6.283), cos(uShootP.z * 1.3 + hsh * 4.1), sin(uShootP.z * 1.1 + hsh * 2.7)) * 0.03 * min(d, 1.0) * uShootP.y * bm;
			shOff += off;
			float stK = clamp(d / stp, 0.0, 1.0);
			shK = max(shK, bm * stK);
			shSzMul = 1.0 + bm * stK * uShootP.w;
			// отломившийся участок гаснет и мельчает
			vColor *= mix(1.0, bn.w, bm);
			shSzMul *= mix(1.0, max(bn.w, 0.05), bm);
		}
		// дрожь: живое мерцание отросшего
		if (!shFam) shOff *= 1.0 + uShootP.y * 0.1 * sin(uShootP.z * 3.0 + hsh * 6.283);
		pos += shOff * min(uShoot.x, 1.0);
		vColor += (uP2 * 1.4 + vColor * 0.3) * shK * uShootP.x * min(uShoot.x, 1.0);
	}
#endif
#ifdef VSCREEN
	// «Экран»: uScr = (сила, вид, масштаб, яркость), uScrP = (поворот, сила рельефа, смешивание с цветом формы, соотношение сторон кадра)
	// виды: 0 обёртка вокруг формы, 1 приклеено (кадр на лице формы, вращается с ней), 2 проектор (кадр на экране, форма скользит сквозь него), 3 рельеф (как «приклеено», яркое выдавливается)
	if (uScr.x > 0.001) {
		vec3 bsx = base - uCen;
		float hyx = max(uYR.y - uYR.x, 1e-4);
		float arx = max(uScrP.w, 0.05);
		vec2 suv;
		float smask = 1.0;
		if (uScr.y < 0.5) {
			// обёртка: угол вокруг оси это горизонталь кадра, высота формы это вертикаль
			suv = vec2(atan(bsx.z, bsx.x) / 6.2831853 + 0.5, clamp((base.y - uYR.x) / hyx, 0.0, 1.0));
			suv.x = fract((suv.x - 0.5) / uScr.z + 0.5);
		} else if (uScr.y < 1.5 || uScr.y > 2.5) {
			// приклеено и рельеф: кадр лежит на форме спереди, высота формы это высота кадра
			suv = vec2(0.5 + bsx.x / (hyx * arx), 0.5 + (base.y - (uYR.x + uYR.y) * 0.5) / hyx);
			suv = (suv - 0.5) / uScr.z + 0.5;
			float cr = cos(uScrP.x), sr = sin(uScrP.x);
			suv = vec2(cr * (suv.x - 0.5) - sr * (suv.y - 0.5), sr * (suv.x - 0.5) + cr * (suv.y - 0.5)) + 0.5;
			smask = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
			if (dot(nrmM, nrmM) > 0.01) smask *= smoothstep(-0.35, 0.25, nrmM.z);
		} else {
			// проектор: кадр неподвижен на экране, точки получают цвет того места кадра, над которым оказались
			vec4 cpx = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
			vec2 nd = cpx.xy / max(cpx.w, 1e-4);
			float scrAsp = projectionMatrix[1][1] / projectionMatrix[0][0];
			suv = vec2(0.5 + nd.x * 0.5 * scrAsp / arx, 0.5 + nd.y * 0.5);
			suv = (suv - 0.5) / uScr.z + 0.5;
			float cr = cos(uScrP.x), sr = sin(uScrP.x);
			suv = vec2(cr * (suv.x - 0.5) - sr * (suv.y - 0.5), sr * (suv.x - 0.5) + cr * (suv.y - 0.5)) + 0.5;
			smask = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
		}
		vec3 scr = texture2D(uScrTex, clamp(suv, 0.0, 1.0)).rgb * uScr.w;
		float slum = dot(scr, vec3(0.3, 0.59, 0.11));
		// объём по глубине: яркость кадра или карта глубины (нейросеть, своя картинка) выдавливают форму вдоль нормали
		float sdv = 0.0;
		if (uScrD.x > 0.5) {
			sdv = uScrD.x < 1.5 ? clamp(slum / max(uScr.w, 0.05), 0.0, 1.0) : texture2D(uScrDep, clamp(suv, 0.0, 1.0)).r;
			sdv = clamp((sdv - 0.5) * uScrD.w + 0.5, 0.0, 1.0);
			if (uScrD.z < 0.0) sdv = 1.0 - sdv;
			if (uScrQ.x > 0.5) scr = vec3(sdv);
		}
#ifndef HERO
		// память цвета: в кадре светлейшее из нового и запомненного (длинная выдержка), вне кадра запомненное гаснет
		vec4 smem = vec4(0.0);
		if (uScrQ.y > 0.5) {
			float smi = floor(aIdx * uScrMN + 0.5);
			smem = texelFetch(uScrMTex, ivec2(int(mod(smi, 2048.0)), int(floor(smi / 2048.0))), 0);
			smem.rgb = smem.rgb * smem.rgb * 4.0;
			scr = max(scr, smem.rgb);
		}
#endif
		vColor = mix(vColor, mix(vColor * 0.35, scr, uScrP.z), smask * uScr.x);
#ifndef HERO
		if (uScrQ.y > 0.5) vColor = mix(vColor, mix(vColor * 0.35, smem.rgb, uScrP.z), smem.a * (1.0 - smask) * uScr.x);
#endif
		if (uScrD.x > 0.5) {
			vec3 dirn = dot(nrmM, nrmM) > 0.01 ? normalize(nrmM) : normalize(bsx + vec3(1e-4));
			pos += dirn * sdv * uScrD.y * 0.45 * smask * uScr.x;
		}
	}
#endif
#ifdef SHADOW
	// тень считается в мировых координатах: стена и пол стоят на месте, даже когда форма вращается
	float shA = 0.0;
	{
		vec3 swp = (modelMatrix * vec4(pos, 1.0)).xyz;
		vec3 shN = uShdL.w < 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
		vec3 shL = normalize(uShdL.xyz);
		float shh = dot(swp, shN) - uShdP.x;
		vec3 ssp = swp - shL * (shh / max(dot(shL, shN), 0.08));
		if (uShd.w > 0.001) {
			// живая тень: колышется, как от пламени свечи
			vec3 st1 = vec3(1.0, 0.0, 0.0);
			vec3 st2 = uShdL.w < 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
			ssp += (st1 * snoise(ssp * 1.4 + vec3(0.0, uTime * 0.7, 0.0)) + st2 * snoise(ssp * 1.4 + vec3(5.0, -uTime * 0.6, 3.0))) * uShd.w * 0.12;
		}
		ssp += shN * 0.003;
		shA = uShd.x * exp(-max(shh, 0.0) * uShdP.y) * (shh < -0.03 ? 0.0 : 1.0);
		vColor = uShd.z < 0.5 ? uShdC : (uShd.z < 1.5 ? uP2 * 1.4 * uBright : colM * uBright * 1.3);
		pos = ssp;
	}
	vD = shA;
	vec4 mv = viewMatrix * vec4(pos, 1.0);
#else
	vD = disp;
	vec4 mv = modelViewMatrix * vec4(pos, 1.0);
#endif
	gl_Position = projectionMatrix * mv;

	// Масштаб по шуму и спектру (Scale POP)
	float szNoise = 1.0;
	if (uLookP2.x > 0.001) {
		szNoise = 1.0 + uLookP2.x * (snoise(base * 2.2 + uTime * 0.4) * 0.75);
	}
	float szAudio = 1.0;
	if (uLookP2.y > 0.001) {
		float bandAudio = mix(uBeat, uSpec.x, step(0.0, base.y));
		szAudio = 1.0 + uLookP2.y * (bandAudio * 1.2 * (0.6 + 0.4 * sin(aIdx * 62.8)));
	}

	// Глубина резкости (Depth of Field: CoC)
	float coc = 0.0;
	if (uDof.x > 0.5) {
		float viewDist = -mv.z;
		coc = clamp(abs(viewDist - uDof.y) / max(0.05, uDof.z), 0.0, 1.0);
	}
	vCoc = coc;

	float s = uSize * uPR * (1.0 + disp * 0.5 + uBeat * 0.2 + sl * 1.2 + mkm * 0.7) * uGlyph.y * HEROSIZE * mfs;
#ifdef VSHOOT
	s *= shSzMul;
#endif
	s *= max(0.15, szNoise * szAudio) * (1.0 - uDisQ.w * dkv) * mix(0.3, 1.0, gGrow) * (1.0 + (uMark.x > 3.5 && uMark.x < 4.5 ? mkv * 0.9 : 0.0)) * (1.0 - 0.6 * (uMark.x > 2.5 && uMark.x < 3.5 ? smoothstep(0.35, 0.9, mkv) : 0.0)) * (1.0 - 0.7 * smoothstep(0.3, 0.8, cvan)) * (0.25 + 0.75 * vis);
	s *= (1.0 + coc * 2.4);
	s *= 1.0 - 0.85 * gHypF;
	s *= (1.0 + gScopeT * uScopeQ.y + gScopeG * uScopeQ.z * 2.5 + gDepthG * 0.8) * (1.0 - gScopeD);
	s *= uAtt > 0.5 ? 3.8 / max(-mv.z, 0.4) : 0.73;
#ifdef SHADOW
	s *= mix(1.0, 2.8, uShd.y);
#endif
	gl_PointSize = clamp(s, 1.0, 95.0);
	if (gScopeD > 0.97 || dkv > 0.97 || gDrop > 0.5 || gGrow < 0.03 || gHypF > 0.97) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
	}
#ifdef TRACKPICK
	// рамки слежения: итоговое положение точки (после всех эффектов) пишется в пиксель с её номером (engine/track-pick.js)
	vColor = pos;
	gl_Position = vec4((float(gl_VertexID) + 0.5) / 16.0 * 2.0 - 1.0, 0.0, 0.0, 1.0);
	gl_PointSize = 1.0;
#endif
}
`;
