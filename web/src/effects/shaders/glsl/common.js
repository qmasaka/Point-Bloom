export const common = `
precision highp float;
uniform float uTime;
uniform float uTOff;
uniform float uMorph;
uniform vec4 uMorphS;
uniform vec4 uMorphO;
// x: уходящая форма это видео или фото, y: приходящая это видео или фото, z: обороты всей формы за переход, w: размер точек в пути
uniform vec4 uMorphD;
uniform float uSettle;
uniform float uBeat;
uniform vec2 uYR;
uniform vec3 uMouse;
uniform float uMouseOn;
uniform sampler2D uSpecTex;
uniform float uShade;
uniform vec4 uCurlP, uSpecP, uWaveP, uWaveSrc, uPulseP, uVoxelP, uGlitchP, uBlast, uFlow, uDisP;
float gGl = 0.0;
float gCh = -1.0;
float gDrop = 0.0;
float gGrow = 1.0;
float gGrowE = 0.0;
float gBurst = 0.0;
float gScopeG = 0.0;
float gScopeT = 0.0;
float gScopeD = 0.0;
uniform vec4 uScope, uScopeP, uScopeQ;
uniform vec3 uScopeC;
float gDepth = 0.5;
// местное время морфинга и доля распада точки: считаются один раз в fxDisplace. Видеодрайвер вставляет тело функции в каждое место вызова,
// и шесть вызовов morphLocal и два disK делали шейдер вдвое-втрое дольше в сборке (на Windows секунды при включении каждого эффекта)
float gMorphLT = 1.0;
float gDisK = 0.0;
float gDepthG = 0.0;
vec3 gNormal = vec3(0.0);
uniform vec4 uDepth, uDepthP, uDepthQ;
uniform float uFlat;
float gLum = 0.5;
uniform vec4 uCurl, uSpec, uWave, uTwist, uPulse, uVoxel, uJitter, uCursor, uMask, uMaskA, uGlitch, uContact, uShockP;
uniform vec4 uTrk[16];
uniform vec4 uHand[12];
uniform vec4 uGrav;
uniform vec4 uSlice;
uniform vec4 uSliceM;
uniform vec4 uMark;
uniform vec4 uGravT;
uniform vec4 uPhysP;
uniform float uAsm;
uniform vec4 uDis;
uniform float uDisT;
uniform float uAnimN;
uniform vec3 uCen; // центр облака (для распада, воронки и взрыва)
uniform vec4 uDisQ; // x: ширина кромки, y: сила разлёта, z: свечение кромки, w: мельчание точек
uniform vec4 uGravP;
uniform vec4 uHandP;
uniform vec4 uImp[32];
uniform vec4 uShock[4];
uniform vec4 uExp, uExpP; // разбор: x ход 0..1, y число кусков, z разброс по времени, w вращение; uExpP.x расстояние
uniform sampler2D uPieceTex; // центры кусков
uniform vec4 uGrow, uGrowP; // росток: x ход, y откуда, z усики, w ширина фронта; uGrowP: x почки, y покачивание, z включён
uniform vec3 uGrowSeed;
uniform vec4 uJel[3]; // желе: удар (направление и сила xyz, время начала w)
uniform vec4 uJelO[3]; // откуда пошла волна
uniform vec4 uJelP; // частота, затухание, сила, сплющивание
uniform vec4 uPhysics;
uniform float uCollapseTime;
uniform vec4 uBrushHits[20];
uniform vec4 uPaintP; // акварель: x включена, y зернистость, z режим (0 на бумагу, 1 прозрачно)
uniform vec4 uBrushParam;
uniform vec4 uLookP2;
uniform vec4 uDof;
uniform vec4 uHyp; // гиперпространство: x сила, y угол поворота в 4D, z вид, w кривизна (1 / радиус 3-сферы)
uniform vec4 uHypP; // y окраска по 4-й оси, z как гаснут улетевшие в бесконечность, w угловая скорость (для копий «Эха»)
float gHypW = 0.0; // где точка на 3-сфере: -1 у центра, +1 на бесконечности
float gHypF = 0.0; // насколько точка ушла в бесконечность (гаснет и мельчает)
uniform vec4 uCh; // фигуры Хладни: x сила, y переход от узора A к B, z масштаб, w дрожь песка
uniform vec4 uChA; // номера мод узора A (n, m) и узора B (n, m)
float gChN = 0.0; // насколько точка легла на узловую линию (там она светится)
#define PI 3.1415926535

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
	const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
	const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
	vec3 i = floor(v + dot(v, C.yyy));
	vec3 x0 = v - i + dot(i, C.xxx);
	vec3 g = step(x0.yzx, x0.xyz);
	vec3 l = 1.0 - g;
	vec3 i1 = min(g.xyz, l.zxy);
	vec3 i2 = max(g.xyz, l.zxy);
	vec3 x1 = x0 - i1 + C.xxx;
	vec3 x2 = x0 - i2 + C.yyy;
	vec3 x3 = x0 - D.yyy;
	i = mod289(i);
	vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
	float n_ = 0.142857142857;
	vec3 ns = n_ * D.wyz - D.xzx;
	vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
	vec4 x_ = floor(j * ns.z);
	vec4 y_ = floor(j - 7.0 * x_);
	vec4 x = x_ * ns.x + ns.yyyy;
	vec4 y = y_ * ns.x + ns.yyyy;
	vec4 h = 1.0 - abs(x) - abs(y);
	vec4 b0 = vec4(x.xy, y.xy);
	vec4 b1 = vec4(x.zw, y.zw);
	vec4 s0 = floor(b0) * 2.0 + 1.0;
	vec4 s1 = floor(b1) * 2.0 + 1.0;
	vec4 sh = -step(h, vec4(0.0));
	vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
	vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
	vec3 p0 = vec3(a0.xy, h.x);
	vec3 p1 = vec3(a0.zw, h.y);
	vec3 p2 = vec3(a1.xy, h.z);
	vec3 p3 = vec3(a1.zw, h.w);
	vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
	p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
	vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
	m = m * m;
	return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// ротор поля шума: течение без сжатия, как дым
vec3 curlNoise(vec3 p) {
	const float e = 0.08;
	float n1 = snoise(p + vec3(e, 0.0, 0.0));
	float n2 = snoise(p - vec3(e, 0.0, 0.0));
	float n3 = snoise(p + vec3(0.0, e, 0.0));
	float n4 = snoise(p - vec3(0.0, e, 0.0));
	float n5 = snoise(p + vec3(0.0, 0.0, e));
	float n6 = snoise(p - vec3(0.0, 0.0, e));
	return normalize(vec3((n4 - n3) - (n6 - n5), (n6 - n5) - (n2 - n1), (n2 - n1) - (n4 - n3)) + 1e-5);
}
float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float hit2(bool b) { return b ? 1.0 : 0.0; }

// одно касание: подъём, вихрь или втягивание вокруг точки c с силой st
void contactAt(vec3 c, float st, vec3 base, vec3 rad, inout vec3 pos) {
	vec3 dd = base - c;
	float r = uContact.y;
	float d2 = dot(dd, dd);
	if (d2 >= r * r || st < 0.001) return;
	float f = 1.0 - sqrt(d2) / r;
	f = f * f * (3.0 - 2.0 * f);
	float k = f * st * uContact.x;
	if (uContact.z < 0.5) {
		pos += rad * k * 0.4;
	} else if (uContact.z < 1.5) {
		vec3 ax = normalize(c + vec3(1e-4));
		float a = k * 2.4;
		vec3 q = pos - c;
		pos = c + q * cos(a) + cross(ax, q) * sin(a) + ax * dot(ax, q) * (1.0 - cos(a));
	} else if (uContact.z < 2.5) {
		pos -= normalize(dd + vec3(1e-4)) * k * 0.3;
	} else if (uContact.z < 3.5) {
		pos += normalize(dd + vec3(1e-4)) * k * 0.3;
	} else if (uContact.z < 4.5) {
		pos += rad * sin(length(dd) * 20.0 - uTime * 6.0) * k * 0.14;
	} else if (uContact.z < 5.5) {
		float hh = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
		pos.y -= k * k * 0.55 * (0.6 + 0.8 * hh);
		pos.xz += (hh - 0.5) * k * 0.06;
	} else if (uContact.z < 6.5) {
		pos += curlNoise(base * 3.0 + uTime * 0.8) * k * 0.45;
	}
}

// сила касания в точке (для режима «Исчезновение»): ближайшие рамки и их следы
float contactK(vec3 b) {
	float m = 0.0;
	float r = uContact.y * (1.0 + 0.12 * sin(uTime * 4.0));
	for (int i = 0; i < 16; i++) {
		if (float(i) >= uContact.w) break;
		float d = distance(b, uTrk[i].xyz);
		if (d < r) m = max(m, (1.0 - d / r) * uTrk[i].w);
	}
	for (int i = 0; i < 32; i++) {
		if (float(i) >= uShockP.z) break;
		float d = distance(b, uImp[i].xyz);
		if (d < r) m = max(m, (1.0 - d / r) * uImp[i].w);
	}
	return clamp(m * uContact.x, 0.0, 1.0);
}

// область рамок трекинга: 0 вне, 1 в центре
float markK(vec3 b) {
	if (uMark.x < 0.5 || uContact.w < 0.5) return 0.0;
	float m = 0.0;
	for (int i = 0; i < 16; i++) {
		if (float(i) >= uContact.w) break;
		float d = distance(b, uTrk[i].xyz);
		if (d < uMark.y) m = max(m, 1.0 - d / uMark.y);
	}
	return m * m * (3.0 - 2.0 * m) * uMark.z;
}

vec3 hueRot(vec3 c, float a) {
	vec3 k = vec3(0.57735);
	return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

// Срез: интенсивность линии в точке (для рельефа)
float sliceK(vec3 b) {
	if (uSlice.x < 0.001) return 0.0;
	float axCode = mod(uSlice.w, 10.0);
	float nLines = max(1.0, floor(uSlice.w / 10.0));
	float c = axCode < 0.5 ? b.y : (axCode < 1.5 ? b.x : (axCode < 2.5 ? b.z : (b.x + b.y) * 0.707));
	float v = clamp((c + 1.2) / 2.4, 0.0, 1.0);
	float coord = mod(v * nLines - uSlice.y * nLines, 1.0);
	return (1.0 - smoothstep(uSlice.z * 0.4, uSlice.z, abs(coord - 0.5))) * uSlice.x;
}

// Растворение: 0 цела, 1 унесена. Порядок отрыва зависит от режима
float disK(vec3 b, float idx) {
	if (uDis.x < 0.001) return 0.0;
	float st = uDisP.x;
	float y01 = clamp((b.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	// слои: вся полоса по высоте уходит разом, поэтому высота квантуется
	if (st > 2.5 && st < 3.5) y01 = floor(y01 * 12.0 + 0.001) / 12.0;
	// блоки: соседние точки (индекс идёт по порядку обхода пространства) держатся вместе и уходят одним куском
	float h = (st > 3.5 && st < 4.5) ? hash11(floor(idx * 1800.0) * 0.731) : hash11(idx * 37.3);
	// чем слаженнее вид, тем меньше случайности в порядке отрыва
	float jit = st < 0.5 ? 0.16 : st < 1.5 ? 0.28 : st < 2.5 ? 0.03 : st < 3.5 ? 0.0 : st < 4.5 ? 0.3 : st < 5.5 ? 0.18 : st < 6.5 ? 0.12 : 0.1;
	float m = uDis.y;
	// у анимированной модели положение в кадре меняется, поэтому порядки по оси X и пятнами берут устойчивый шум по номеру точки: иначе точки мерцали бы, пока модель движется
	bool still = uAnimN < 0.5;
	float ord;
	if (m < 0.5) ord = 1.0 - y01;
	else if (m < 1.5) ord = still ? snoise(b * 1.7) * 0.5 + 0.5 : hash11(idx * 13.7);
	else if (m < 2.5) ord = y01;
	else if (m < 3.5) ord = still ? clamp((b.x - uCen.x) * 0.3 + 0.5, 0.0, 1.0) : y01;
	else {
		float r01 = clamp(length(b - uCen) / max((uYR.y - uYR.x) * 0.6, 0.3), 0.0, 1.0);
		ord = m < 4.5 ? r01 : 1.0 - r01;
	}
	ord = ord * (1.0 - jit) + h * jit;
	float w = max(uDisQ.x, 0.06);
	if (st > 1.5 && st < 2.5) w *= 0.45;
	return clamp((uDis.x * (1.0 + w) - ord) / w, 0.0, 1.0);
}

// Росток: 0 ещё не выросла, 1 выросла. Фронт идёт от «семени»: снизу вверх, от точки или от центра, с неровностью от шума
float growK(vec3 b, float idx) {
	float S = max(uYR.y - uYR.x, 0.5);
	float y01 = clamp((b.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	float d;
	if (uGrow.y < 0.5) d = y01 * 0.8 + clamp(length(b.xz - uCen.xz) / S, 0.0, 1.0) * 0.2;
	else if (uGrow.y < 1.5) d = clamp(distance(b, uGrowSeed) / (S * 1.5), 0.0, 1.0);
	else d = clamp(length(b - uCen) / (S * 0.7), 0.0, 1.0);
	float nz = uAnimN < 0.5 ? snoise(b * 3.0 + 7.0) * 0.5 + 0.5 : hash11(floor(idx * 700.0) * 0.37);
	d = clamp(d + (nz - 0.5) * 0.45 * uGrow.z + (hash11(idx * 9.1) - 0.5) * 0.03, 0.0, 1.0);
	float w = max(uGrow.w, 0.04);
	return clamp((uGrow.x * (1.0 + w) - d) / w, 0.0, 1.0);
}

// Местное время морфинга точки 0..1: расслоение задаёт, насколько позже стартуют точки, порядок задаёт, какие первыми
float morphLocal(vec3 A, vec3 B, float idx) {
	float h = hash11(idx * 3.17);
	// «Кубики»: время старта одно на весь кубик пространства, поэтому точки уходят блоками
	int msty = int(uMorphS.x + 0.5);
	if (msty == 8) h = hash11(dot(floor((A - uCen) * 5.0), vec3(17.13, 31.71, 57.29)));
	// «Стекло»: осколок трогается целиком
	if (msty == 13) h = hash11(dot(floor((A - uCen) * 3.0), vec3(12.9, 78.2, 37.7)));
	float ord = h;
	int so = int(uMorphO.x + 0.5);
	float yN = clamp((A.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
	if (so == 1) ord = yN * 0.85 + h * 0.15;
	else if (so == 2) ord = (1.0 - yN) * 0.85 + h * 0.15;
	else if (so == 3) ord = clamp(length(A) / 1.4, 0.0, 1.0) * 0.85 + h * 0.15;
	else if (so == 4) ord = clamp((A.x + 1.2) / 2.4, 0.0, 1.0) * 0.85 + h * 0.15;
	// по карте глубины видео или фото (gDepth: 1 ближе всего): точки уходят слоями, как будто кадр режут по глубине
	else if (so == 5) ord = (1.0 - gDepth) * 0.85 + h * 0.15;
	else if (so == 6) ord = gDepth * 0.85 + h * 0.15;
	// «Рельеф (ИИ)» всегда идёт по глубине: ближние слои кадра первыми; «3D-печать» по высоте новой формы, снизу вверх
	if (msty == 10) ord = (1.0 - gDepth) * 0.8 + h * 0.2;
	if (msty == 11) ord = clamp((B.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0) * 0.92 + h * 0.08;
	float sg = uMorphS.z;
	return clamp(uMorph * (1.0 + sg) - ord * sg, 0.0, 1.0);
}
float morphEase(float x) {
	int e = int(uMorphO.y + 0.5);
	if (e == 1) return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
	if (e == 2) {
		float c1 = 1.70158;
		float y = x - 1.0;
		return 1.0 + (c1 + 1.0) * y * y * y + c1 * y * y;
	}
	return x * x * (3.0 - 2.0 * x);
}


// ───── раскадровка видео: положения листов и показ считаются здесь, без перезаписи данных на каждом кадре
uniform vec4 uFr;   // x: включено, y: кадров, z: точек в кадре, w: всего точек
uniform vec4 uFr2;  // колонки, строки, ширина листа, высота листа
uniform vec4 uFr3;  // глубина, раскладка A, раскладка B, переход A к B
uniform vec4 uFr4;  // текущий кадр (дробный), режим показа, длина луча/шлейфа, подсветка
uniform vec4 uFr5;  // x: голова кольцевого буфера (бегущая лента), y: сила редения прошлых кадров, z: будущие кадры (0 видны, 1 приглушены, 2 скрыты), w: усиление яркости
uniform vec4 uHero; // колонки, строки, точек, включено
uniform vec4 uFr6;  // x: размер точек остальных кадров, y: весь ряд кадров (1) или только пройденное (0), z: тона (0 все, 1 светлые, 2 тёмные), w: порог тонов
uniform vec4 uFr7;  // x: длина хвоста (доля всех кадров), y: насыщенность, z: плавность гашения хвоста
uniform vec4 uFr8;  // «Шлейф движения» (engine/chrono.js): x вид (0 выкл, 1 видео целиком, 2 фон текущего кадра тусклее, 3 только выделенное), y и z сдвиг шлейфа за кадр, w доля фона в шлейфе
uniform vec4 uFr9;  // «Шлейф движения»: x подкраска палитрой, y как быстро гаснет, z уход вглубь за кадр, w сколько кадров уже снято
uniform vec4 uFrE;  // рамки кадров раскадровки: x яркость рамок, y толщина (в клетках сетки кадра), z цвет (0 палитра, 1 белый), w рамка текущего кадра
// глубина кадра из альфа-канала; у шлейфа там же метка выделенного: 128 и выше это объект, глубина в младших семи битах
float frDec(float a) {
	if (uFr8.x < 0.5) return a;
	return mod(floor(a * 255.0 + 0.5), 128.0) / 127.0;
}
vec3 frPlace(float lay, float k, float n, float u, float v, out vec3 nrm) {
	float t = n > 1.0 ? k / (n - 1.0) : 0.5;
	float W = uFr2.z;
	float H = uFr2.w;
	float depth = uFr3.x;
	nrm = vec3(0.0, 0.0, 1.0);
	if (lay > 0.5 && lay < 1.5) {
		float gx = ceil(sqrt(n * (W / H)));
		float gy = ceil(n / gx);
		float s = min(2.4 / (gx * W), 2.4 / (gy * H));
		float cx = mod(k, gx);
		float cy = floor(k / gx);
		return vec3((cx - (gx - 1.0) * 0.5) * W * s * 1.04 + u * W * s, ((gy - 1.0) * 0.5 - cy) * H * s * 1.04 + v * H * s, 0.0);
	}
	// расстояние от текущего кадра в кадрах (у главного кадра ноль)
	float ad = k - uFr4.x;
#ifdef HERO
	ad = 0.0;
#endif
	if (lay > 4.5) {
		// веер: кадры на дуге барабана, текущий спереди и крупнее, соседи уходят по дуге назад и ложатся внахлёст
		float R = 2.4;
		float sc = mix(1.0, 0.7, min(abs(ad), 1.0));
		float da = min(W * 0.6 / R, 2.2 / max(1.0, (n - 1.0) * 0.5));
		float a = sign(ad) * (min(abs(ad), 1.0) * (W * 0.86 / R) + max(abs(ad) - 1.0, 0.0) * da);
		nrm = vec3(sin(a), 0.0, cos(a));
		return vec3(R * sin(a), 0.0, R * cos(a) - R) + vec3(cos(a), 0.0, -sin(a)) * u * W * sc + vec3(0.0, v * H * sc, 0.0);
	}
	if (lay > 3.5) {
		// шлейф движения: текущий кадр на месте, прошлые съезжают в сторону шлейфа и чуть уходят вглубь (у главного кадра возраст ноль)
		float age = max(0.0, -ad);
		return vec3(u * W + uFr8.y * age, v * H + uFr8.z * age, -uFr9.z * age);
	}
	if (lay > 1.5 && lay < 2.5) {
		// плёнка: кадры в ряд, текущий в центре и крупнее, соседи мельче; при перемотке лента едет
		float sc = 0.5;
		float aa = abs(ad);
		float c1 = W * 0.54 + W * sc * 0.53;
		float c = aa < 1.0 ? aa * c1 : c1 + (aa - 1.0) * W * sc * 1.06;
		float s = mix(1.0, sc, min(aa, 1.0));
		return vec3(sign(ad) * c + u * W * s, v * H * s, 0.0);
	}
	// текущий кадр стоит на месте (z = 0), прошлые уходят от него вглубь: чем дальше видео, тем длиннее стопка, при перемотке назад она укорачивается.
	// при листании пройденные кадры лежат ближе к зрителю и улетают к нему, открывая текущий
	float dz = (uFr4.y > 0.5 && uFr4.y < 1.5) ? -1.0 : 1.0;
	float kz = k;
#ifdef HERO
	kz = uFr4.x;
#endif
	// весь ряд: кадры стоят на своих местах по времени, а текущий кадр идёт сквозь них; иначе стопка отсчитывается от текущего
	float cen = uFr6.y > 0.5 ? (n - 1.0) * 0.5 : uFr4.x;
	// туннель: то же, но прошлые кадры уменьшаются с глубиной
	float ts = lay > 2.5 ? 1.0 - 0.72 * clamp(max(-ad, 0.0) / max(n - 1.0, 1.0), 0.0, 1.0) : 1.0;
	return vec3(u * W * ts, v * H * ts, (kz - cen) * depth / max(n - 1.0, 1.0) * dz);
}
// Положение точки блока по её номеру; раскладки A и B плавно перетекают друг в друга
vec3 frMix(float k, float u, float v, out vec3 nrm) {
	vec3 nA;
	vec3 nB;
	vec3 pA = frPlace(uFr3.y, k, uFr.y, u, v, nA);
	if (uFr3.w > 0.0001) {
		vec3 pB = frPlace(uFr3.z, k, uFr.y, u, v, nB);
		float m = uFr3.w * uFr3.w * (3.0 - 2.0 * uFr3.w);
		nrm = normalize(mix(nA, nB, m));
		return mix(pA, pB, m);
	}
	nrm = nA;
	return pA;
}
vec3 frBlockPos(float aIdx, out vec3 nrm, out float kk, out vec2 cell) {
#ifdef HERO
	// «главный» кадр: свой густой набор точек на месте текущего кадра
	float ip = floor(aIdx * uHero.z + 0.5);
	float ci = mod(ip, uHero.x);
	float cj = floor(ip / uHero.x);
	kk = clamp(floor(uFr4.x + 0.5), 0.0, uFr.y - 1.0);
	cell = vec2(ci, cj);
	return frMix(kk, (ci + 0.5) / uHero.x - 0.5, 0.5 - (cj + 0.5) / uHero.y, nrm);
#else
	float ip = floor(aIdx * uFr.w + 0.5);
	float k = floor(ip / uFr.z);
	float loc = ip - k * uFr.z;
	float ci = mod(loc, uFr2.x);
	float cj = floor(loc / uFr2.x);
	kk = k;
	cell = vec2(ci, cj);
	// у каждого листа сетка чуть сдвинута: точки разных кадров не выстраиваются в столбики, объём выглядит как облако
	vec2 jt = vec2(fract(sin(k * 12.9898) * 43758.5453), fract(sin(k * 78.233 + 1.7) * 24634.6345)) - 0.5;
	return frMix(k, (ci + 0.5 + jt.x * 0.9) / uFr2.x - 0.5, 0.5 - (cj + 0.5 + jt.y * 0.9) / uFr2.y, nrm);
#endif
}
// Показ кадров: x яркость, y смещение вдоль нормали, z доля подкраски; tcol цвет подкраски
vec4 frShow(float k, out vec3 tcol) {
	float n = uFr.y;
	float idx = uFr4.x;
	int mode = int(uFr4.y + 0.5);
	float d = k - idx;
	float fw = max(2.0, n * 0.04);
	float w = 1.0;
	float lift = 0.0;
	float tint = 0.0;
	tcol = uP2;
	if (mode == 0) {
		float hl = uFr4.w;
		if (hl > 0.001) w = 1.0 - 0.5 * hl + (0.5 + 1.4 * hl) * max(0.0, 1.0 - abs(d) / 2.5) * hl;
			// кадры впереди текущего (из «будущего») закрывали бы его спереди: по умолчанию приглушаем
			// прошлые кадры тускнеют с глубиной, чтобы стопка не сливалась в серую кашу
			if (d < -0.5) w *= 0.45 + 0.55 / (1.0 + 0.2 * (-d));
			// у плёнки и веера кадры впереди стоят сбоку и ничего не закрывают
			if (d > 0.5 && uFr6.y < 0.5 && abs(uFr3.y - 2.0) > 0.5 && abs(uFr3.y - 5.0) > 0.5) w *= uFr5.z > 1.5 ? 0.0 : uFr5.z > 0.5 ? 0.4 : 1.0;
	} else if (mode == 1) {
		if (d < 0.0) w = max(0.0, 1.0 + d / fw);
		lift = 1.0 - w;
		w *= 1.0 + 0.25 * max(0.0, 1.0 - abs(d));
	} else if (mode == 2) {
		if (d > 0.0) {
			w = max(0.0, 1.0 - d / fw) * (d <= fw ? 0.5 : 0.0);
			lift = -(1.0 - w) * 0.6;
		}
		w *= 1.0 + 0.25 * max(0.0, 1.0 - abs(d));
	} else if (mode == 3) {
		float half_ = max(3.0, n * 0.08);
		float ad = abs(d);
		w = ad <= half_ ? 1.0 : max(0.0, 1.0 - (ad - half_) / fw);
		lift = (1.0 - w) * sign(d + 0.0001) * 0.8;
		w *= 1.0 + 0.25 * max(0.0, 1.0 - ad);
	} else if (mode == 6) {
		// шлейф движения: копии гаснут с возрастом (чем больше «как быстро гаснет», тем короче видимая часть) и к концу подкрашиваются палитрой
		float age = max(0.0, -d);
		float a = clamp(age / max(1.0, uFr9.w), 0.0, 1.0);
		// самая свежая копия лежит прямо на живом кадре и двоила бы его: она проявляется, только отойдя от него
		w = pow(1.0 - a, 0.5 + uFr9.y * 3.0) * smoothstep(0.15, 1.0, age);
		tcol = a < 0.5 ? mix(uP0, uP1, a * 2.0) : mix(uP1, uP2, (a - 0.5) * 2.0);
		tint = uFr9.x * a;
	} else {
		float span = max(1.5, n * max(0.02, uFr4.z));
		if (mode == 4) {
			float beam = exp(-(d / span) * (d / span) * 2.0);
			float after = d < 0.0 ? exp(d / (span * 2.4)) * 0.4 : 0.0;
			w = 0.18 + beam * 1.5 + after;
			tint = min(0.85, beam * 0.8);
			lift = d < 0.0 ? -min(0.35, -d / n * 1.2) : 0.0;
		} else {
			float age = -d / span;
			if (d > 0.0) w = 0.0;
			else {
				w = max(0.0, exp(-age * 1.1) * 0.9) + 1.35 * max(0.0, 1.0 - abs(d));
				float t = min(1.0, age);
				tcol = t < 0.5 ? mix(uP0, uP1, t * 2.0) : mix(uP1, uP2, (t - 0.5) * 2.0);
				tint = min(0.9, 0.3 + age * 0.7) * (1.0 - max(0.0, 1.0 - abs(d)));
				lift = -min(0.6, age * 0.25);
			}
		}
	}
	return vec4(w, lift, tint, 0.0);
}


// Выдавливание по карте глубины: gDepth 0..1 (1 ближе всего). uDepth: сила, режим, скорость, фокус; uDepthP: слоёв, знак, покачивание, вид
// Зона на месте: точки вокруг выбранной глубины остаются плоскими, за её краями рельеф плавно нарастает
float dzone(float x) {
	float a = abs(x);
	return sign(x) * max(a - uDepthQ.x, 0.0) / max(1.0 - uDepthQ.x, 0.25);
}

vec3 depthShape(vec3 b) {
	float t = uTime - uTOff;
	float A = uDepth.x;
	float sp = uDepth.z;
	float dn = uDepthP.y > 0.0 ? gDepth : 1.0 - gDepth;
	float fo = uDepthP.y > 0.0 ? uDepth.w : 1.0 - uDepth.w;
	float dd = dzone(dn - fo);
	int md = int(uDepth.y + 0.5);
	if (md == 0) {
		// рельеф: ближнее выступает вперёд
		b.z += dd * A * 1.2;
	} else if (md == 1) {
		// ступени: глубина режется на ровные плоскости
		float N = max(2.0, floor(uDepthP.x + 0.5));
		float x = dn * N;
		float dq = (floor(x) + smoothstep(0.38, 0.62, fract(x))) / N;
		b.z += dzone(dq - fo) * A * 1.5;
	} else if (md == 2) {
		// дыхание: рельеф выдавливается и втягивается обратно
		b.z += dd * A * 1.3 * (0.5 + 0.5 * sin(t * sp * 0.9));
	} else if (md == 3) {
		// волна: глубина вспухает бегущей волной слева направо
		b.z += dd * A * 1.4 * (0.55 + 0.45 * sin(b.x * 3.2 - t * sp * 1.6));
	} else if (md == 4) {
		// рябь: по рельефу расходятся круги, у ближнего они выше
		b.z += (dd * 0.6 + sin(length(b.xy) * 9.0 - t * sp * 2.2) * 0.25 * (0.35 + dn)) * A;
	} else if (md == 5) {
		// карусель: слои разной глубины поворачиваются на разный угол вокруг вертикали
		float a = dd * A * 1.6 * sin(t * sp * 0.7);
		float cs = cos(a);
		float sn = sin(a);
		b.xz = mat2(cs, -sn, sn, cs) * b.xz;
		b.z += dd * A * 0.5;
	} else {
		// разлёт: слои по очереди вылетают к зрителю и возвращаются
		float p = 0.5 + 0.5 * sin(t * sp * 0.8 - 1.5708);
		b.z += dd * A * (0.4 + 1.8 * p * p);
		b.xy *= 1.0 + dd * A * 0.5 * p * p;
	}
	// лёгкое покачивание: сдвиг по глубине даёт параллакс, плоский кадр оживает даже без вращения камеры
	float a = t * sp * 0.8;
	b.xy += vec2(cos(a), sin(a) * 0.55) * dd * uDepthP.z * A * 0.4;
	return b;
}

// Гиперпространство: точка поднимается на 3-сферу в четырёхмерном пространстве (обратная стереографическая проекция),
// там поворачивается и проецируется обратно. Повороты, задевающие четвёртую ось, выворачивают форму через бесконечность.
// md: 0 выворот (плоскость ZW), 1 расслоение Хопфа (XY и ZW вместе: точки текут по сцепленным окружностям), 2 кувырок (XW и YZ с разной скоростью), 3 дыхание (ZW туда и обратно)
vec3 hyperWarp(vec3 p, vec3 c, float R, float md, float a, out float w4) {
	vec3 q = (p - c) / R;
	float r2 = dot(q, q);
	vec4 h = vec4(2.0 * q, r2 - 1.0) / (r2 + 1.0);
	float ca = cos(a);
	float sa = sin(a);
	if (md < 0.5) {
		h.zw = vec2(h.z * ca - h.w * sa, h.z * sa + h.w * ca);
	} else if (md < 1.5) {
		h.xy = vec2(h.x * ca - h.y * sa, h.x * sa + h.y * ca);
		h.zw = vec2(h.z * ca - h.w * sa, h.z * sa + h.w * ca);
	} else if (md < 2.5) {
		h.xw = vec2(h.x * ca - h.w * sa, h.x * sa + h.w * ca);
		float cb = cos(a * 0.618);
		float sb = sin(a * 0.618);
		h.yz = vec2(h.y * cb - h.z * sb, h.y * sb + h.z * cb);
	} else {
		float b = 2.4 * sin(a);
		float cb = cos(b);
		float sb = sin(b);
		h.zw = vec2(h.z * cb - h.w * sb, h.z * sb + h.w * cb);
	}
	w4 = h.w;
	// у полюса проекция уходит в бесконечность: даль мягко сжимается к «небесной сфере» вокруг формы, иначе точки влетали бы в камеру
	vec3 o = h.xyz / max(1.0 - h.w, 0.03) * R;
	float ol = length(o);
	// до радиуса 1.8 форма как есть, дальше расстояние плавно упирается в 2.8
	float oc = ol < 1.8 ? ol : 1.8 + (1.0 - exp(-(ol - 1.8)));
	return c + o * (oc / max(ol, 1e-4));
}

// Фигуры Хладни: поле стоячей волны на пластине (у плоских фото и видео) или в объёме; песок собирается там, где поле равно нулю
float chF(vec3 q, float n, float m) {
	float f = cos(n * q.x) * cos(m * q.y) - cos(m * q.x) * cos(n * q.y);
	if (uFlat > 0.5) return f;
	return f + cos(n * q.y) * cos(m * q.z) - cos(m * q.y) * cos(n * q.z) + cos(n * q.z) * cos(m * q.x) - cos(m * q.z) * cos(n * q.x);
}
float chField(vec3 q) {
	if (uCh.y < 0.001) return chF(q, uChA.x, uChA.y);
	if (uCh.y > 0.999) return chF(q, uChA.z, uChA.w);
	return mix(chF(q, uChA.x, uChA.y), chF(q, uChA.z, uChA.w), uCh.y);
}

// Положение одной точки после всех эффектов. base: форма без эффектов, maskV: доля эффектов в этой точке (зона)
vec3 fxDisplace(vec3 aOrigin, vec3 aTarget, float aIdx, out vec3 base, out float maskV) {
	float t = uTime - uTOff;
	float m = uMorph * uMorph * (3.0 - 2.0 * uMorph);
	base = aTarget;
	gMorphLT = uMorph < 0.9999 ? morphLocal(aOrigin, aTarget, aIdx) : 1.0;
	if (uFr.x > 0.5 && uMorph > 0.9999) {
		vec3 fnrm;
		float fk;
		vec2 fcell;
		base = frBlockPos(aIdx, fnrm, fk, fcell);
	}
	// uMorphO.w: морфинг возможен (в списке форм больше одной). Иначе весь этот блок вырезается из шейдера WebGL: он самый тяжёлый в сборке (секунды на Windows)
	if (uMorphO.w > 0.5 && uMorph < 0.9999) {
		// морфинг: у каждой точки своё время старта (порядок и расслоение), а путь идёт по дуге через опорную точку, форма которой зависит от вида перехода
		float lt = gMorphLT;
		float e = morphEase(lt);
		float sc = uMorphS.y;
		int sty = int(uMorphS.x + 0.5);
		vec3 mid = (aOrigin + aTarget) * 0.5;
		vec3 cn = curlNoise(mid * 1.8 + vec3(0.0, t * 0.3, 0.0));
		float hA = hash11(aIdx * 5.31);
		float hB = hash11(aIdx * 7.77);
		float hC = hash11(aIdx * 2.13);
		float flightK = sin(e * PI);
		// у «Течения», «Вихря» и «Сканера» путь это дуга через опорную точку; остальные виды ниже считают свой путь сами
		vec3 ctrl = mid + cn * sc * 0.9;
		if (sty == 3) ctrl = mid + cn * sc * 0.3;
		float om = 1.0 - e;
		base = om * om * aOrigin + 2.0 * om * e * ctrl + e * e * aTarget;
		if (sty == 0) {
			// течение: точки несёт живая жидкость, два масштаба вихрей (крупные завитки и мелкие нити), сильнее всего в середине пути; соседние точки текут вместе
			float fq = pow(flightK, 1.2);
			vec3 tb1 = curlNoise(base * 1.35 + vec3(0.0, 0.0, t * 0.35));
			vec3 tb2 = curlNoise(base * 3.2 - vec3(t * 0.55, 0.0, 0.0));
			base += (tb1 * 0.5 + tb2 * 0.18) * sc * fq;
		}
		if (sty == 1) {
			// вихрь: форма закручивается воронкой. Ближе к оси угол больше (внутри быстрее), по пути форма сжимается к оси и точки чуть поднимаются, потом всё раскручивается
			vec2 vxz = base.xz - uCen.xz;
			float vr = length(vxz);
			float vang = sin(e * PI) * uMorphS.w * 6.2831853 * (0.7 + 0.3 * hash11(aIdx * 1.3)) * pow(1.0 / (0.32 + vr), 0.5);
			float vcs = cos(vang);
			float vsn = sin(vang);
			vxz = vec2(vxz.x * vcs - vxz.y * vsn, vxz.x * vsn + vxz.y * vcs);
			vxz *= 1.0 - 0.38 * flightK * smoothstep(0.0, 1.1, vr);
			base.xz = uCen.xz + vxz;
			base.y += (hB - 0.3) * 0.35 * sc * flightK * flightK;
		}
		if (sty == 3) {
			// сканер: на фронте точки на миг «оцифровываются» (липнут к сетке), дрожат и светятся, за фронтом уже новая форма
			float band = smoothstep(0.0, 0.3, lt) * (1.0 - smoothstep(0.6, 1.0, lt));
			vec3 sq = (floor((base - uCen) * 20.0) + 0.5) / 20.0 + uCen;
			base = mix(base, sq, band * 0.8);
			base += (vec3(hA, hB, hC) - 0.5) * 0.045 * band;
		}
		if (sty == 4) {
			// пыль: старая форма поднимается облаком (быстро в начале, потом сопротивление воздуха), по высоте всё шире расползается; новая медленно оседает из него
			float H = (0.45 + 0.85 * hA) * sc;
			vec3 cloud = aOrigin + vec3(0.0, H, 0.0) + (cn * (0.5 + 0.7 * hB) + (vec3(hA, hC, hB) - 0.5) * 0.45) * sc * 0.8;
			float k1 = clamp(e / 0.5, 0.0, 1.0);
			float k2 = clamp((e - 0.5) / 0.5, 0.0, 1.0);
			float u1 = 1.0 - pow(1.0 - k1, 2.4);
			float u2 = 1.0 - pow(1.0 - k2, 2.0);
			vec3 p1 = mix(aOrigin, cloud, u1) + curlNoise(aOrigin * 2.0 + vec3(0.0, t * 0.4, 0.0)) * 0.12 * sc * sin(k1 * PI);
			vec3 p2 = mix(cloud, aTarget, u2) + curlNoise(cloud * 1.5 + vec3(t * 0.3, 0.0, 0.0)) * 0.1 * sc * sin(k2 * PI) * (1.0 - k2);
			base = e < 0.5 ? p1 : p2;
		}
		if (sty == 5) {
			// осыпание: точки падают с ускорением и скользят в кучу на полу (конус, как у песка), потом из кучи вырастает новая форма
			float fl5 = uYR.x - 0.02;
			float R5 = 0.55 + 0.35 * sc;
			float an5 = hA * 6.2831853;
			float rr5 = sqrt(hB) * R5;
			float hh5 = pow(max(0.0, 1.0 - rr5 / R5), 0.85) * 0.85 * (0.7 + 0.3 * hC);
			vec3 heap = vec3(uCen.x + cos(an5) * rr5, fl5 + hh5, uCen.z + sin(an5) * rr5);
			float k1 = clamp(e / 0.5, 0.0, 1.0);
			float k2 = clamp((e - 0.5) / 0.5, 0.0, 1.0);
			float fall = k1 * k1;
			float slide = 1.0 - pow(1.0 - k1, 2.0);
			vec3 p1 = vec3(mix(aOrigin.x, heap.x, slide), mix(aOrigin.y, heap.y, fall), mix(aOrigin.z, heap.z, slide));
			p1.xz += (vec2(hA, hC) - 0.5) * 0.06 * sin(k1 * PI);
			float gr = k2 * k2 * (3.0 - 2.0 * k2);
			vec3 p2 = mix(heap, aTarget, gr);
			p2.y += 0.3 * sc * sin(k2 * PI) * (0.4 + hA);
			p2 += cn * 0.12 * sin(k2 * PI);
			base = e < 0.5 ? p1 : p2;
		}
		if (sty == 2) {
			// взрыв: частицы разлетаются по баллистике с сопротивлением, падают на пол, один раз подскакивают и лежат, затем поднимаются дугой в новую форму
			float fl = uYR.x - 0.04;
			float h1 = hA;
			float h2 = hB;
			float h3 = hC;
			vec3 dx = normalize(vec3(aOrigin.x, 0.0, aOrigin.z) + vec3(h1 - 0.5, 0.0, h2 - 0.5) * 0.9 + vec3(1e-3, 0.0, 0.0));
			float spd = (0.35 + h3 * 1.1) * sc;
			float vy0 = (0.5 + h2 * 1.3) * sc;
			float te = clamp(lt / 0.45, 0.0, 1.0);
			float tau = te * 1.6;
			float gy = fl + h1 * 0.03;
			vec3 pl = aOrigin;
			pl.xz += dx.xz * spd * (1.0 - exp(-3.52)) * 1.4;
			pl.y = gy;
			vec3 pf = aOrigin;
			pf.xz += dx.xz * spd * (1.0 - exp(-2.2 * tau)) * 1.4;
			float g2 = 2.1;
			float disc = vy0 * vy0 + 4.0 * g2 * max(aOrigin.y - gy, 0.0);
			float tL = (vy0 + sqrt(disc)) / (2.0 * g2);
			float yb = aOrigin.y + vy0 * tau - g2 * tau * tau;
			if (tau > tL) {
				float vI = vy0 - 2.0 * g2 * tL;
				float v1 = -0.3 * vI;
				float tb = tau - tL;
				yb = tb < v1 / g2 ? gy + v1 * tb - g2 * tb * tb : gy;
			}
			pf.y = mix(max(yb, gy), gy, smoothstep(0.9, 1.0, te));
			float tg = clamp((lt - 0.58) / 0.42, 0.0, 1.0);
			float eg = tg * tg * (3.0 - 2.0 * tg);
			vec3 c2 = (pl + aTarget) * 0.5 + vec3(0.0, 0.5 + 0.6 * h2, 0.0) + cn * 0.2 * sc;
			float og = 1.0 - eg;
			vec3 pg = og * og * pl + 2.0 * og * eg * c2 + eg * eg * aTarget;
			base = lt < 0.45 ? pf : (lt < 0.58 ? pl : pg);
		}
		if (sty == 6) {
			// через 4D: старая форма выворачивается через бесконечность, на изнанке подменяется новой и возвращается уже ею
			float hw4;
			vec3 q4 = mix(aOrigin, aTarget, smoothstep(0.38, 0.62, e));
			base = hyperWarp(q4, uCen, 1.3 * max(sc, 0.15), uMorphS.w > 1.05 ? 1.0 : 0.0, 2.4 * sin(e * PI) * (0.85 + 0.15 * hash11(aIdx * 2.7)), hw4);
			gHypW = hw4;
			gHypF = max(gHypF, smoothstep(0.55, 0.97, hw4));
		}
		if (sty == 7) {
			// через сферу: форма стягивается в оболочку, оболочка перетекает в направления новой формы и раскрывается ею
			vec3 co7 = aOrigin - uCen;
			vec3 ct7 = aTarget - uCen;
			vec3 d17 = normalize(co7 + vec3(1e-3));
			vec3 d27 = normalize(ct7 + vec3(1e-3));
			float R7 = 0.7 + 0.5 * sc;
			float k1 = clamp(e / 0.35, 0.0, 1.0);
			float k2 = clamp((e - 0.35) / 0.3, 0.0, 1.0);
			float k3 = clamp((e - 0.65) / 0.35, 0.0, 1.0);
			k1 = k1 * k1 * (3.0 - 2.0 * k1);
			k2 = k2 * k2 * (3.0 - 2.0 * k2);
			k3 = k3 * k3 * (3.0 - 2.0 * k3);
			if (e < 0.35) base = mix(aOrigin, uCen + d17 * R7, k1);
			else if (e < 0.65) base = uCen + normalize(mix(d17, d27, k2) + vec3(1e-3)) * R7;
			else base = mix(uCen + d27 * R7, aTarget, k3);
			// по оболочке бегут волны, как по поверхности капли
			base += normalize(base - uCen + vec3(1e-3)) * 0.05 * sin(dot(d17, vec3(5.0, 7.0, 3.0)) * 2.0 + t * 3.0) * sin(clamp(e, 0.0, 1.0) * PI);
		}
		if (sty == 8) {
			// кубики: блоки точек подпрыгивают и уходят вместе, каждый блок в свой момент
			float ch8 = hash11(dot(floor((aOrigin - uCen) * 5.0), vec3(17.13, 31.71, 57.29)));
			vec3 c8 = mid + vec3(0.0, (0.35 + 0.8 * ch8) * sc, 0.0);
			base = om * om * aOrigin + 2.0 * om * e * c8 + e * e * aTarget;
		}
		if (sty == 9) {
			// сплющивание: форма схлопывается в плоскость, плоскость перетекает в плоскость новой формы и расправляется
			vec3 q9a = aOrigin - uCen;
			vec3 q9b = aTarget - uCen;
			float k1 = clamp(e / 0.4, 0.0, 1.0);
			float k2 = clamp((e - 0.4) / 0.2, 0.0, 1.0);
			float k3 = clamp((e - 0.6) / 0.4, 0.0, 1.0);
			k1 = k1 * k1 * (3.0 - 2.0 * k1);
			k2 = k2 * k2 * (3.0 - 2.0 * k2);
			k3 = k3 * k3 * (3.0 - 2.0 * k3);
			vec3 fa = vec3(0.0, q9a.y, q9a.z);
			vec3 fb = vec3(0.0, q9b.y, q9b.z);
			if (e < 0.4) base = uCen + mix(q9a, fa, k1);
			else if (e < 0.6) base = uCen + mix(fa, fb, k2);
			else base = uCen + mix(fb, q9b, k3);
		}
		if (sty == 10) {
			// рельеф по глубине (нейросеть): плоский кадр сначала вспухает объёмом по своей карте глубины, слои отслаиваются от ближних к дальним и летят к новой форме; приходящее видео так же собирается из объёма и сплющивается в кадр
			float dz = 1.6 * max(sc, 0.3);
			vec3 RA = aOrigin + vec3(0.0, 0.0, (gDepth - 0.5) * dz * uMorphD.x);
			vec3 RB = aTarget + vec3(0.0, 0.0, (gDepth - 0.5) * dz * uMorphD.y);
			float k1 = clamp(e / 0.3, 0.0, 1.0);
			float k2 = clamp((e - 0.3) / 0.4, 0.0, 1.0);
			float k3 = clamp((e - 0.7) / 0.3, 0.0, 1.0);
			k1 = k1 * k1 * (3.0 - 2.0 * k1);
			k2 = k2 * k2 * (3.0 - 2.0 * k2);
			k3 = k3 * k3 * (3.0 - 2.0 * k3);
			vec3 c10 = (RA + RB) * 0.5 + vec3(0.0, 0.0, (0.3 + gDepth) * 0.7 * sc) + cn * 0.25 * sc;
			float o10 = 1.0 - k2;
			vec3 mid10 = o10 * o10 * RA + 2.0 * o10 * k2 * c10 + k2 * k2 * RB;
			if (e < 0.3) base = mix(aOrigin, RA, k1);
			else if (e < 0.7) base = mid10;
			else base = mix(RB, aTarget, k3);
		}
		if (sty == 11) {
			// 3D-печать: старая форма стекает в печатающую головку над сценой, головка кладёт новую форму слой за слоем снизу вверх
			vec3 head = vec3(uCen.x, uYR.y + 0.45, uCen.z);
			vec3 nozzle = aTarget + vec3(0.0, 0.22, 0.0);
			float k1 = clamp(e / 0.55, 0.0, 1.0);
			float k2 = clamp((e - 0.55) / 0.45, 0.0, 1.0);
			vec3 g11 = mix(aOrigin, head, k1 * k1 * (3.0 - 2.0 * k1)) + cn * 0.15 * sc * sin(k1 * PI);
			float o11 = 1.0 - k2;
			vec3 p11 = o11 * o11 * head + 2.0 * o11 * k2 * vec3(nozzle.x, head.y, nozzle.z) + k2 * k2 * nozzle;
			p11 = mix(p11, aTarget, smoothstep(0.85, 1.0, k2));
			base = e < 0.55 ? g11 : p11;
		}
		if (sty == 12) {
			// портал: точки по спирали затягивает в светящееся кольцо в центре, и из него же по спирали выходит новая форма
			float a12 = hA * 6.2831853 + t * 2.4;
			vec3 ring = uCen + vec3(cos(a12), sin(a12), 0.0) * (0.32 + 0.06 * hB) * (0.6 + 0.4 * sc);
			float k1 = clamp(e / 0.5, 0.0, 1.0);
			float k2 = clamp((e - 0.5) / 0.5, 0.0, 1.0);
			vec3 qa = aOrigin - uCen;
			vec3 qb = aTarget - uCen;
			float sw1 = k1 * k1 * 5.0;
			float sw2 = (1.0 - k2) * (1.0 - k2) * 5.0;
			vec3 ra = uCen + vec3(qa.x * cos(sw1) - qa.y * sin(sw1), qa.x * sin(sw1) + qa.y * cos(sw1), qa.z);
			vec3 rb = uCen + vec3(qb.x * cos(sw2) - qb.y * sin(sw2), qb.x * sin(sw2) + qb.y * cos(sw2), qb.z);
			vec3 p1 = mix(ra, ring, k1 * k1 * (3.0 - 2.0 * k1));
			vec3 p2 = mix(ring, rb, k2 * k2 * (3.0 - 2.0 * k2));
			base = e < 0.5 ? p1 : p2;
		}
		if (sty == 13) {
			// стекло: форма трескается на осколки, они летят, кувыркаются и падают; потом осколки новой формы прилетают и складываются в неё
			vec3 ca = (floor((aOrigin - uCen) * 3.0) + 0.5) / 3.0 + uCen;
			vec3 cb = (floor((aTarget - uCen) * 3.0) + 0.5) / 3.0 + uCen;
			float sa = hash11(dot(floor((aOrigin - uCen) * 3.0), vec3(12.9, 78.2, 37.7)));
			float sb = hash11(dot(floor((aTarget - uCen) * 3.0), vec3(12.9, 78.2, 37.7)));
			float k1 = clamp(e / 0.6, 0.0, 1.0);
			float k2 = clamp((1.0 - e) / 0.6, 0.0, 1.0);
			vec3 da = normalize(ca - uCen + vec3(sa - 0.5, 0.3, 0.2) * 0.6 + vec3(1e-3));
			vec3 db = normalize(cb - uCen + vec3(sb - 0.5, 0.3, 0.2) * 0.6 + vec3(1e-3));
			float ra = k1 * PI * (0.8 + 1.6 * sa);
			float rb = k2 * PI * (0.8 + 1.6 * sb);
			vec3 la = aOrigin - ca;
			vec3 lb = aTarget - cb;
			la = vec3(la.x * cos(ra) - la.y * sin(ra), la.x * sin(ra) + la.y * cos(ra), la.z);
			lb = vec3(lb.x * cos(rb) - lb.y * sin(rb), lb.x * sin(rb) + lb.y * cos(rb), lb.z);
			vec3 P1 = ca + la + da * k1 * k1 * 1.3 * sc - vec3(0.0, 0.9 * k1 * k1 * k1, 0.0);
			vec3 P2 = cb + lb + db * k2 * k2 * 1.3 * sc - vec3(0.0, 0.9 * k2 * k2 * k2, 0.0);
			base = mix(P1, P2, smoothstep(0.42, 0.58, e));
		}
		if (sty == 14) {
			// магнит: точки идут пучками по силовым линиям, дугами в стороны от прямого пути, как железные опилки у полюсов
			vec3 ab = aTarget - aOrigin;
			float L14 = length(ab);
			vec3 ax = L14 > 1e-4 ? ab / L14 : vec3(0.0, 1.0, 0.0);
			vec3 n1 = normalize(cross(ax, abs(ax.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
			vec3 n2 = cross(ax, n1);
			float bund = floor(hA * 10.0) / 10.0 * 6.2831853;
			vec3 nb = n1 * cos(bund) + n2 * sin(bund);
			base = mix(aOrigin, aTarget, e) + nb * sin(e * PI) * (0.25 + 0.55 * L14) * sc * (0.85 + 0.3 * hB);
		}
		// вся форма поворачивается за переход на заданное число оборотов (целых, чтобы в конце не было скачка)
		if (abs(uMorphD.z) > 0.001) {
			float sm = uMorph * uMorph * (3.0 - 2.0 * uMorph);
			float ra = uMorphD.z * 6.2831853 * sm;
			vec3 q = base - uCen;
			base = uCen + vec3(q.x * cos(ra) - q.z * sin(ra), q.y, q.x * sin(ra) + q.z * cos(ra));
		}
	}
	if (uDepth.x > 0.001) base = depthShape(base);
	vec3 rad = normalize(base + vec3(1e-4));
	// у плоских источников (фото, видео, блок кадров) направление «наружу» это взгляд на кадр, иначе волны и импульсы лишь двигают картинку в её плоскости и почти не видны
	rad = normalize(mix(rad, vec3(0.0, 0.0, 1.0), 0.8 * uFlat));
	// движущаяся анимированная модель: «наружу» это нормаль её поверхности, а не направление от центра сцены (оно смотрит не туда, когда модель далеко от центра)
	if (uAnimN > 0.5 && dot(gNormal, gNormal) > 0.01) rad = normalize(gNormal);
	vec3 pos = base;

	if (uCh.x > 0.001) {
		// песок скатывается к ближайшей узловой линии (шаги Ньютона по полю), двигаясь только вдоль поверхности формы
		float chh = max(uYR.y - uYR.x, 0.5) * 0.5;
		float chk = 1.5708 * uCh.z / chh;
		vec3 chq = (pos - uCen) * chk;
		vec3 chn = uFlat > 0.5 ? vec3(0.0, 0.0, 1.0) : (dot(gNormal, gNormal) > 0.01 ? normalize(gNormal) : rad);
		for (int ci = 0; ci < 4; ci++) {
			float cf = chField(chq);
			vec3 cg = vec3(chField(chq + vec3(0.02, 0.0, 0.0)) - cf, chField(chq + vec3(0.0, 0.02, 0.0)) - cf, chField(chq + vec3(0.0, 0.0, 0.02)) - cf) / 0.02;
			cg -= chn * dot(cg, chn);
			vec3 cst = -cf * cg / max(dot(cg, cg), 0.01);
			float csl = length(cst);
			if (csl > 0.7) cst *= 0.7 / csl;
			chq += cst;
		}
		float cfe = abs(chField(chq));
		gChN = exp(-cfe * 5.0);
		// дрожь: песок, который ещё не улёгся, подпрыгивает (сильнее на ударе)
		float ctk = floor(t * 30.0);
		vec3 cbz = (vec3(hash11(aIdx * 3.1 + ctk), hash11(aIdx * 5.7 + ctk), hash11(aIdx * 1.3 + ctk)) - 0.5) * (1.0 - gChN) * uCh.w * (0.03 + uBeat * 0.05);
		pos = mix(pos, uCen + chq / chk + cbz, min(uCh.x, 1.0));
	}

	if (uTwist.x > 0.001) {
		float y01t = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float tw = uTwist.x * (1.0 + (uTwist.z > 0.01 ? 0.35 * sin(t * uTwist.z * 2.0) : 0.0));
		if (uTwist.y < 0.5) {
			float a = pos.y * tw * 1.6;
			float c = cos(a);
			float s = sin(a);
			pos.xz = mat2(c, -s, s, c) * pos.xz;
		} else if (uTwist.y < 1.5) {
			pos.x += y01t * y01t * tw * 0.9;
			pos.y -= y01t * y01t * y01t * tw * 0.16;
		} else if (uTwist.y < 2.5) {
			pos.xz *= 1.0 + tw * 0.6 * (0.5 - y01t) * 2.0;
		} else if (uTwist.y < 3.5) {
			// змейка: форма извивается по высоте, как лента
			float sw = sin(pos.y * 3.2 - t * (0.9 + uTwist.z));
			pos.x += sw * tw * 0.2;
			pos.z += cos(pos.y * 3.2 - t * (0.9 + uTwist.z)) * tw * 0.12;
		} else {
			// дыхание: по высоте бегут расширения и сужения
			pos.xz *= 1.0 + tw * 0.3 * sin(y01t * 6.2831 - t * (1.2 + uTwist.z));
		}
	}
	if (uWave.x > 0.001) {
		float wv = 0.0;
		if (uWaveP.y < 0.5) {
			wv = sin(distance(base, uWaveSrc.xyz) * uWave.y * 2.0 - t * 3.0 * uWaveP.x);
		} else if (uWaveP.y < 1.5) {
			float age = uTime - uWaveP.w;
			if (age > 0.0) {
				float d = distance(base, uWaveSrc.xyz);
				float ring = age * uWaveP.x * 1.3;
				wv = sin((d - ring) * uWave.y * 2.6) * exp(-abs(d - ring) * 2.5) * exp(-age * uWaveP.z);
			}
		} else if (uWaveP.y < 2.5) {
			vec3 wd = vec3(cos(uWaveSrc.w), 0.0, sin(uWaveSrc.w));
			wv = sin(dot(base, wd) * uWave.y * 2.0 - t * 3.0 * uWaveP.x);
		} else if (uWaveP.y < 3.5) {
			// спираль: гребень закручен вокруг формы и бежит вверх
			float yw = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
			wv = sin(atan(base.z - uCen.z, base.x - uCen.x) * 3.0 + yw * uWave.y * 1.3 - t * 3.0 * uWaveP.x);
		} else {
			// подъём: ровные горизонтальные гребни поднимаются снизу вверх
			wv = sin(base.y * uWave.y * 2.0 - t * 3.0 * uWaveP.x);
		}
		pos += rad * wv * uWave.x * 0.14 * (1.0 + 1.5 * uFlat);
	}
	if (uSpec.x > 0.001) {
		float y01s = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		if (uSpec.y < 0.5) {
			pos += rad * texture2D(uSpecTex, vec2(abs(atan(base.z, base.x)) / PI, 0.5)).r * uSpec.x * 0.7;
		} else if (uSpec.y < 1.5) {
			pos += rad * texture2D(uSpecTex, vec2(y01s, 0.5)).r * uSpec.x * 0.7;
		} else if (uSpec.y < 2.5) {
			float ub = floor(abs(atan(base.z, base.x)) / PI * uSpecP.y) / uSpecP.y;
			pos += rad * texture2D(uSpecTex, vec2(ub, 0.5)).r * uSpec.x * 0.8;
		} else {
			float xs = clamp(abs(base.x) / 1.2, 0.0, 1.0);
			pos.y += texture2D(uSpecTex, vec2(xs, 0.5)).r * uSpec.x * 0.8 * (0.35 + 0.65 * y01s);
		}
	}
	float pe = uPulse.x;
	if (uPulseP.x > 0.5) {
		float age = uTime - uPulseP.z - length(base) * uPulseP.y;
		float env = age > 0.0 ? exp(-age * 3.2 * uPulseP.w) * smoothstep(0.0, 0.04, age) : 0.0;
		float age2 = age - 0.2;
		env += age2 > 0.0 ? 0.55 * exp(-age2 * 3.2 * uPulseP.w) * smoothstep(0.0, 0.04, age2) : 0.0;
		pe = uPulse.x * env * 1.6;
		if (uPulseP.x > 1.5) {
			pos.y *= 1.0 + pe * 0.2;
			pos.xz *= 1.0 - pe * 0.11;
			pe = 0.0;
		}
	}
	pos += rad * pe * 0.28 * (1.0 + 1.5 * uFlat);
	pos *= 1.0 + pe * 0.1;
	if (uBlast.x > 0.001) {
		float age = uTime - uBlast.w;
		if (age > 0.0) {
			float env = exp(-age * uBlast.y) * cos(age * uBlast.y * 3.0);
			float rnd = 0.45 + 0.55 * mix(1.0, hash11(aIdx * 7.1), uBlast.z);
			vec3 dir = normalize(rad + (vec3(hash11(aIdx), hash11(aIdx + 1.0), hash11(aIdx + 2.0)) - 0.5) * 0.7 * uBlast.z);
			pos += dir * env * rnd * uBlast.x * 0.75;
		}
	}
	if (uFlow.x > 0.001) {
		vec3 fc = curlNoise(base * uFlow.y + vec3(0.0, t * uFlow.z * 0.1, 0.0));
		vec3 tg = normalize(fc - rad * dot(fc, rad) + vec3(1e-4));
		tg = tg * cos(uFlow.w) + cross(rad, tg) * sin(uFlow.w);
		float ph = t * uFlow.z + hash11(aIdx * 5.3) * 6.2831;
		pos += tg * sin(ph) * uFlow.x * 0.24;
	}
	if (uMark.x > 3.5 && uMark.x < 5.5) {
		float mkd = markK(base);
		if (uMark.x < 4.5) pos += rad * mkd * 0.22;
		else pos = mix(pos, (floor(pos / 0.06) + 0.5) * 0.06, smoothstep(0.0, 0.4, mkd));
	}
	if (uSliceM.x > 0.5 && uSliceM.x < 1.5) pos += rad * sliceK(base) * uSliceM.y;
	float dk = disK(base, aIdx);
	gDisK = dk;
	if (dk > 0.0) {
		float sc = uDisQ.y;
		float ds = uDisP.x;
		float y01d = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		// кусок: соседние точки делят номер и движутся вместе
		float cl = floor(aIdx * 1800.0);
		float ch = hash11(cl * 0.731);
		float ch2 = hash11(cl * 1.913 + 3.1);
		vec3 cd = base - uCen;
		vec3 outd = cd / (length(cd) + 1e-3);
		// лёгкая турбулентность одинакова у всех видов и по умолчанию едва заметна: форма уходит слаженно, а не шумом
		vec3 dsp = uAnimN > 0.5 ? vec3(hash11(aIdx * 1.7), hash11(aIdx * 2.3), hash11(aIdx * 3.1)) * 8.0 : base * 1.8;
		pos += curlNoise(dsp + vec3(0.0, -t * 0.6, t * 0.3)) * dk * uDisT * 0.22 * sc;
		if (ds < 0.5) {
			// ветер: вся масса тянется одним потоком в сторону, быстрее и медленнее по высоте, как полотно на ветру
			vec3 wv = vec3(uDis.w * 1.4 + 0.2, -uDis.z * 0.5, 0.3);
			float sp = 0.65 + 0.35 * sin(y01d * 7.0 + t * 0.8);
			pos += wv * dk * dk * 1.5 * sp * sc;
		} else if (ds < 1.5) {
			// горение: пепел поднимается вверх, покачиваясь пачками, а не по одной точке
			pos.y += dk * dk * (0.7 + 0.5 * ch) * sc;
			pos.xz += vec2(sin(t * 1.5 + ch * 6.0), cos(t * 1.3 + ch * 5.0)) * dk * 0.1 * sc + vec2(uDis.w * 0.5, 0.0) * dk * sc;
		} else if (ds < 2.5) {
			// лазерный срез: пока фронт проходит, точки чуть приподнимаются над поверхностью и гаснут
			pos += outd * dk * 0.12 * sc + vec3(0.0, dk * 0.05 * sc, 0.0);
		} else if (ds < 3.5) {
			// слои: полосы по высоте по очереди съезжают в стороны, чётные вправо, нечётные влево
			float band = floor(y01d * 12.0 + 0.001);
			float sg = mod(band, 2.0) < 0.5 ? 1.0 : -1.0;
			pos.x += sg * dk * dk * 1.7 * sc + uDis.w * dk * 0.3;
			pos.y -= dk * dk * uDis.z * 0.25 * sc;
		} else if (ds < 4.5) {
			// блоки: куски падают целиком, разваливаются в стороны и ложатся кучкой на пол
			vec3 mv = vec3((ch - 0.5) * 0.9 + uDis.w * 0.3, 0.0, (ch2 - 0.5) * 0.9);
			pos += mv * dk * sc;
			pos.y = max(pos.y - dk * dk * (0.5 + uDis.z) * 1.8 * sc, uYR.x + ch * 0.05);
		} else if (ds < 5.5) {
			// песок: колонны точек осыпаются прямо вниз и ложатся на пол ровной кучей
			pos.y = max(pos.y - dk * dk * (0.5 + uDis.z) * 2.2 * sc, uYR.x + hash11(aIdx * 5.1) * 0.05);
			pos.x += uDis.w * dk * 0.25 * sc;
		} else if (ds < 6.5) {
			// воронка: форма закручивается и втягивается к центру, уходя вверх
			vec3 q = base - uCen;
			float ang = dk * dk * (3.2 + uDis.w * 1.2) * sc;
			float cs = cos(ang);
			float sn = sin(ang);
			q.xz = vec2(q.x * cs - q.z * sn, q.x * sn + q.z * cs);
			q *= 1.0 - 0.9 * dk * dk;
			pos = uCen + q + vec3(0.0, dk * dk * 0.45 * sc, 0.0);
		} else {
			// взрыв: от центра идёт волна, всё за ней отлетает наружу и падает
			pos += outd * pow(dk, 0.7) * (1.1 + 0.3 * ch) * sc;
			pos.y -= dk * dk * uDis.z * 0.8 * sc;
		}
	}
	// разбор на части: куски двигаются и вращаются целиком вокруг своего центра
	if (uExp.x > 0.001) {
		// кусок это ячейка пространства вокруг формы (а не подряд идущие точки: облако перемешано для морфинга, и куски выходили кашей).
		// Сетка чуть искривлена шумом, чтобы края кусков были неровными, а не кубиками
		float eg = max(1.0, floor(pow(uExp.y, 1.0 / 3.0) + 0.5));
		float ecs = max(uYR.y - uYR.x, 0.5) * 1.15 / eg;
		vec3 eq = (base - uCen) / ecs;
		eq += vec3(sin(eq.y * 2.1 + 1.3), sin(eq.z * 1.7 + 0.4), sin(eq.x * 2.3 + 2.1)) * 0.22;
		vec3 ecell = floor(eq);
		float pid = mod(abs(dot(ecell, vec3(17.0, 59.0, 131.0))), 4093.0);
		vec3 pc = uCen + (ecell + 0.5) * ecs;
		float h1 = hash11(pid * 1.7);
		float h2 = hash11(pid * 2.9);
		float h3 = hash11(pid * 4.1);
		vec3 od = pc - uCen;
		vec3 dr = normalize(od + (vec3(h1, h2, h3) - 0.5) * 0.35 * (length(od) + 0.3) + vec3(1e-4));
		float ke = clamp((uExp.x - h2 * uExp.z) / max(1.0 - uExp.z, 0.2), 0.0, 1.0);
		ke = ke * ke * (3.0 - 2.0 * ke);
		vec3 ax = normalize(vec3(h1 - 0.5, h3 - 0.5, h2 - 0.5) + vec3(1e-3));
		float ang = ke * (h3 - 0.5) * 3.0 * uExp.w;
		vec3 qe = pos - pc;
		qe = qe * cos(ang) + cross(ax, qe) * sin(ang) + ax * dot(ax, qe) * (1.0 - cos(ang));
		pos = pc + qe + dr * ke * uExpP.x * (0.5 + 0.5 * h1);
	}
	// росток: фронт роста, почки на кромке и покачивание выросшей части
	if (uGrowP.z > 0.5) {
		gGrow = growK(base, aIdx);
		gGrowE = gGrow * (1.0 - gGrow) * 4.0;
		pos += rad * gGrowE * uGrowP.x * 0.12;
		float yG = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		pos.xz += vec2(sin(t * 1.2 + yG * 5.0), cos(t * 0.9 + yG * 4.0)) * 0.018 * uGrowP.y * gGrow * (0.3 + yG);
	}
	// желе: упругая дрожь расходится от места удара и затухает
	{
		for (int ji = 0; ji < 3; ji++) {
			float jage = uTime - uJel[ji].w;
			if (jage < 0.0 || jage > 7.0) continue;
			float jd = distance(base, uJelO[ji].xyz);
			float ja = jage - jd * 0.45;
			if (ja < 0.0) continue;
			float env = exp(-ja * uJelP.y) * sin(ja * uJelP.x);
			pos += uJel[ji].xyz * env * uJelP.z * 0.35;
			pos += (base - uJelO[ji].xyz) * env * uJelP.w * uJelP.z * 0.16 * length(uJel[ji].xyz);
		}
	}
	if (uGrav.x > 0.001) {
		vec3 gq = pos - uGravP.xyz;
		float gr = length(gq) + 1e-3;
		float gin = 1.0 - smoothstep(uGravP.w * 0.7, uGravP.w * 1.7, gr);
		float ga = smoothstep(0.0, 1.0, clamp(uGrav.x * gin, 0.0, 1.0));
		// ось диска: наклонена и медленно покачивается
		vec3 up = normalize(vec3(sin(uGravT.x) * cos(uGravT.y), cos(uGravT.x), sin(uGravT.x) * sin(uGravT.y)));
		vec3 ref = abs(up.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
		vec3 e1 = normalize(cross(ref, up));
		vec3 e2 = cross(up, e1);
		float lx = dot(gq, e1);
		float lh = dot(gq, up);
		float lz = dot(gq, e2);
		if (uGrav.y < 0.5) {
			// галактика: у центра крутится быстрее, закручиваясь в рукава; диск слегка коробится
			// вращение почти как у твёрдого диска, а разница скоростей между центром и краем ограничена и колеблется: рукава дышат, а не закручиваются в кашу со временем
			float ph0 = t * uGrav.z * 0.45;
			float ang = ga * (ph0 * 0.8 + 1.3 * sin(ph0 * 0.6) / (0.5 + gr));
			float ca = cos(ang);
			float sa = sin(ang);
			float nx = lx * ca - lz * sa;
			float nz = lx * sa + lz * ca;
			float az = atan(nz, nx);
			lh = lh * (1.0 - uGrav.w * ga) + 0.07 * gr * sin(az * 2.0 + t * 0.4) * ga;
			// спиральные рукава: плотность волной уходит от центра к краю
			float arm = sin(2.0 * az - 3.4 * log(gr + 0.15) + t * 0.25);
			float ar = 1.0 + 0.2 * arm * ga * uGrav.w;
			lx = nx * ar;
			lz = nz * ar;
		} else if (uGrav.y < 1.5) {
			// квазар: падение по спирали, сплющивание в диск, затем выброс вдоль оси двумя джетами
			float h1 = hash11(aIdx * 91.7);
			float ph = fract(t * 0.16 * uGrav.z + h1);
			float sg = h1 > 0.5 ? 1.0 : -1.0;
			float r0 = max(gr, 0.08);
			if (ph < 0.8 || uGravT.w < 0.01) {
				float s = clamp(ph / 0.8, 0.0, 1.0);
				float rr = r0 * pow(1.0 - s, 1.6) + 0.03;
				float ang = s * s * 11.0 * ga;
				float az0 = atan(lz, lx);
				float flt = 1.0 - uGrav.w * s * ga;
				float ha = lh * flt;
				float k = mix(1.0, rr / r0, ga);
				float rl = length(vec2(lx, lz)) * k;
				lx = cos(az0 + ang) * rl;
				lz = sin(az0 + ang) * rl;
				lh = ha * mix(1.0, rr / r0, ga);
			} else {
				float u = (ph - 0.8) / 0.2;
				float len = uGravT.w * (0.4 + h1 * 0.9) * u * u * ga;
				float az0 = atan(lz, lx) + t * 2.0;
				lx = cos(az0) * 0.05 * (1.0 - u * 0.5);
				lz = sin(az0) * 0.05 * (1.0 - u * 0.5);
				lh = sg * (0.08 + len);
			}
		} else if (uGrav.y > 3.5) {
			// кольца: форма делится на круглые дорожки, каждая вращается как твёрдая, соседние в разные стороны
			float rr0 = length(vec2(lx, lz));
			float ringN = floor(rr0 * 5.0);
			float rr1 = mix(rr0, (ringN + 0.5) / 5.0, ga * 0.85);
			float dirR = mod(ringN, 2.0) < 0.5 ? 1.0 : -1.0;
			float az1 = atan(lz, lx) + dirR * t * uGrav.z * (0.25 + 0.5 / (0.4 + rr1)) * ga;
			lx = cos(az1) * rr1;
			lz = sin(az1) * rr1;
			lh = lh * (1.0 - uGrav.w * ga);
		} else if (uGrav.y > 2.5) {
			// рой: каждая точка вращается вокруг центра по своей наклонной орбите
			vec3 q = e1 * lx + up * lh + e2 * lz;
			vec3 ax = normalize(vec3(hash11(aIdx * 13.1) - 0.5, hash11(aIdx * 7.7) - 0.5, hash11(aIdx * 3.3) - 0.5) + vec3(1e-3));
			float ang = t * uGrav.z * (0.7 + 1.6 / (gr + 0.3)) * ga * (0.6 + 0.8 * hash11(aIdx * 5.9));
			q = q * cos(ang) + cross(ax, q) * sin(ang) + ax * dot(ax, q) * (1.0 - cos(ang));
			q *= 1.0 + uGravT.z * 0.3 * ga * sin(t * 0.8 + aIdx * 40.0);
			lx = dot(q, e1);
			lh = dot(q, up);
			lz = dot(q, e2);
		} else {
			// невесомость: медленное вращение, покачивание в трёх осях и мягкое «дыхание» облака
			float sd = aIdx * 61.0;
			float ang = 0.14 * uGrav.z * t * ga;
			float ca = cos(ang);
			float sa = sin(ang);
			float nx = lx * ca - lz * sa;
			float nz = lx * sa + lz * ca;
			float amp = 0.4 + uGravT.z * 1.2;
			lx = nx + ga * 0.12 * amp * sin(t * 0.55 * uGrav.z + sd * 1.3);
			lz = nz + ga * 0.12 * amp * cos(t * 0.5 * uGrav.z + sd * 0.8);
			lh += ga * 0.2 * amp * sin(t * 0.7 * uGrav.z + sd);
			float br = 1.0 + 0.2 * amp * ga * (0.5 + 0.5 * sin(t * 0.35 * uGrav.z + sd * 0.4));
			lx *= br;
			lz *= br;
			lh *= br;
		}
		pos = uGravP.xyz + e1 * lx + up * lh + e2 * lz;
	}
	if (uCurl.x > 0.001) {
		// сила растёт мягче линейной: на максимуме точки уходят заметно, но форма ещё читается
		float ca = pow(uCurl.x, 1.45) * 0.055;
		float thr = snoise(base * 1.8 + t * 0.3) * 0.5 + 0.5;
		float det = smoothstep(0.35, 0.85, thr + min(uCurl.x, 1.0) * 0.12);
		vec3 cn = curlNoise(base * uCurl.y + vec3(t * 0.4, t * 0.3, t * 0.5) * uCurlP.x) * det * ca;
		if (uCurlP.z > 1.5) {
			// кольца: горизонтальные слои вращаются вокруг формы, соседние в разные стороны
			float yc = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
			float band = floor(yc * 8.0 + 0.001);
			float sg = mod(band, 2.0) < 0.5 ? 1.0 : -1.0;
			float ang = sg * sin(t * uCurlP.x * 0.7 + band * 0.8) * min(uCurl.x, 2.0) * 0.55;
			vec3 q = pos - uCen;
			float cs = cos(ang);
			float sn = sin(ang);
			q.xz = vec2(q.x * cs - q.z * sn, q.x * sn + q.z * cs);
			pos = uCen + q;
			cn = vec3(0.0);
		} else if (uCurlP.z > 0.5) {
			vec3 fd = vec3(cos(uCurlP.y), 0.35, sin(uCurlP.y));
			float ph = 0.5 + 0.5 * sin(t * uCurlP.x * 0.7 + hash11(aIdx * 3.7) * 6.2831);
			cn += fd * ph * det * ca * 0.9;
		}
		pos += cn;
	}
	if (uGlitch.x > 0.001) {
		float yg = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float spd = uGlitchP.y;
		// всплески: раз в секунду-две сбой резко усиливается на долю секунды, между ними лёгкая рябь
		float cyc = t * spd * 1.1;
		float bst = step(0.55, hash11(floor(cyc) * 3.17 + 1.3)) * (1.0 - smoothstep(0.0, 0.4, fract(cyc)));
		gBurst = bst;
		float I = uGlitch.x * (0.55 + (0.5 + uGlitchP.w * 1.6) * bst);
		float gm = uGlitchP.z;
		float tick = floor(t * 10.0 * spd);
		bool hit = false;
		if (gm < 0.5) {
			// полосы по высоте съезжают в стороны и в глубину
			float band = floor(yg * uGlitch.y);
			float r = hash11(band * 13.7 + tick);
			if (r > 0.55) {
				float shf = (r - 0.5) * 2.4 * (hash11(band + 7.0) - 0.5) * I;
				pos.x += shf * (1.0 + uFlat);
				pos.z += shf * 1.6 * (hash11(band + 3.0) - 0.5) * (1.0 + uFlat);
				hit = true;
			}
		} else if (gm < 1.5) {
			// блоки: куски объёма смещаются целиком
			vec3 cell = floor(base * vec3(4.0, uGlitch.y * 0.35, 4.0));
			float r = hash11(dot(cell, vec3(12.9, 78.2, 37.7)) + tick * 1.7);
			if (r > 0.62) {
				vec3 hv = vec3(hash11(r * 91.0), hash11(r * 57.0), hash11(r * 33.0)) - 0.5;
				pos += hv * (r - 0.55) * 1.6 * I * vec3(1.0, 0.35, 1.0);
				hit = true;
			}
		} else {
			// развёртка: тонкие строки рвутся сильнее, остальное чуть дрожит
			float row = floor(yg * uGlitch.y * 3.0);
			float r = hash11(row * 5.3 + tick * 2.3);
			if (r > 0.8) {
				pos.x += (hash11(row * 9.1 + tick) - 0.5) * 2.4 * I * (1.0 + uFlat);
				hit = true;
			}
			pos.x += (hash11(row + tick) - 0.5) * 0.02 * I;
		}
		if (hit) {
			gGl = I;
			if (uGlitchP.x > 0.5) {
				float chn = floor(hash11(aIdx * 17.3 + tick) * 3.0);
				pos.x += (chn - 1.0) * 0.09 * I;
				gCh = chn;
			}
		}
		// выпадение: во время всплеска часть точек пропадает
		gDrop = step(hash11(aIdx * 3.7 + tick), uGlitch.z * 0.4 * bst * uGlitch.x) * hit2(hit);
	}
	if (uVoxel.x > 0.01) {
		float vm = uVoxelP.x;
		float amp = uVoxelP.w;
		float g = mix(0.3, mix(0.035, 0.07, uFlat), clamp(uVoxel.x, 0.0, 1.0)) * uVoxelP.z;
		if (vm > 1.5 && vm < 2.5) g *= 1.0 + 0.35 * sin(t * uVoxelP.y * 2.0);
		vec3 cell = floor(pos / g);
		vec3 q = (cell + 0.5) * g;
		if (vm > 0.5 && vm < 1.5) {
			float h2 = hash11(dot(cell, vec3(12.9, 78.2, 37.7)));
			q.y += (h2 - 0.5) * g * 2.0 * amp * sin(t * uVoxelP.y * 1.5 + h2 * 6.2831);
		} else if (vm > 2.5 && vm < 3.5) {
			// волна: высота кубов бежит по сетке
			q.y += sin(dot(cell.xz, vec2(0.7, 0.5)) * 0.55 - t * uVoxelP.y * 2.0) * g * 1.6 * amp;
		} else if (vm > 3.5 && vm < 4.5) {
			// ступени: высота квантуется в террасы
			float stp = g * 2.0 * max(amp, 0.3);
			q.y = (floor((pos.y - uYR.x) / stp) + 0.5) * stp + uYR.x;
		} else if (vm > 4.5) {
			// разлёт: каждый куб дрожит вокруг своего места
			vec3 hv = vec3(hash11(dot(cell, vec3(12.9, 78.2, 37.7))), hash11(dot(cell, vec3(39.3, 11.1, 52.7))), hash11(dot(cell, vec3(7.7, 91.3, 23.9)))) - 0.5;
			q += hv * g * 3.0 * amp * (0.5 + 0.5 * sin(t * uVoxelP.y * 2.0 + hv.x * 12.0));
		}
		// на фото кубики получают высоту по яркости: мозаика из столбиков, видная под углом
		q.z += uFlat * (gLum - 0.5) * g * 9.0;
		pos = mix(pos, q, smoothstep(0.0, 0.25, uVoxel.x));
	}
	if (uJitter.x > 0.001) {
		pos += vec3(sin(t * 17.0 + aIdx * 91.0), sin(t * 13.0 + aIdx * 57.0), sin(t * 11.0 + aIdx * 33.0)) * uJitter.x * 0.03;
	}
	if (uHyp.x > 0.001) {
		float hw;
		vec3 hp = hyperWarp(pos, uCen, 1.25 / max(uHyp.w, 0.05), uHyp.z, uHyp.y - uTOff * uHypP.w, hw);
		float hk = min(uHyp.x, 1.0);
		pos = mix(pos, hp, hk);
		gHypW = hw;
		gHypF = smoothstep(mix(0.99, 0.6, uHypP.z), 0.997, hw) * hk;
	}
	maskV = 1.0;
	if (uMask.x > 0.5) {
		float y01 = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float soft = max(uMask.z, 0.02);
		if (uMask.x < 1.5) {
			maskV = smoothstep(uMaskA.x - soft * 0.5, uMaskA.x + soft * 0.5, y01);
		} else if (uMask.x < 2.5) {
			float r = uMask.y * 1.6 + 0.01;
			maskV = 1.0 - smoothstep(r * (1.0 - soft), r, distance(base, uMaskA.xyz));
		} else if (uMask.x < 3.5) {
			float n = snoise(base * 1.6 + vec3(0.0, uMaskA.w, uMaskA.w * 0.6)) * 0.5 + 0.5;
			maskV = smoothstep(1.0 - uMask.y - soft * 0.3, 1.0 - uMask.y + soft * 0.3, n);
		} else {
			float w = uMask.y * 0.35 + 0.004;
			maskV = 1.0 - smoothstep(w, w + soft * 0.3 + 0.02, abs(y01 - uMaskA.x));
		}
		if (uMask.w > 0.5) maskV = 1.0 - maskV;
	}
	pos = mix(base, pos, maskV);
	if (uContact.x > 0.001) {
		for (int i = 0; i < 16; i++) {
			if (float(i) >= uContact.w) break;
			contactAt(uTrk[i].xyz, uTrk[i].w, base, rad, pos);
		}
		for (int i = 0; i < 32; i++) {
			if (float(i) >= uShockP.z) break;
			contactAt(uImp[i].xyz, uImp[i].w, base, rad, pos);
		}
	}
	if (uShockP.x > 0.001) {
		for (int i = 0; i < 4; i++) {
			float age = uShock[i].w;
			if (age < 0.0) continue;
			float dist = distance(base, uShock[i].xyz);
			float x = (dist - age * uShockP.y) / 0.22;
			pos += rad * exp(-x * x) * exp(-age * 0.9) * uShockP.x * 0.45;
		}
	}
	// Кисть: рисование курсором
	if (uBrushParam.x > 0.001) {
		for (int i = 0; i < 20; i++) {
			float age = uBrushHits[i].w;
			if (age < 0.0) continue;
			float dist = distance(base, uBrushHits[i].xyz);
			float r = uBrushParam.y;
			if (dist < r) {
				float life = 1.0 - age / uBrushParam.z;
				float infl = (1.0 - dist / r) * life * uBrushParam.x;
				pos += rad * infl * 0.35;
			}
		}
	}
	// Распад: раскол сверху вниз, взрыв с закруткой, отскоки от пола; сборка дугами снизу вверх
	if (uPhysics.x > 0.001) {
		float seed = hash11(aIdx * 1234.56 + 17.1);
		float seed2 = hash11(aIdx * 2345.67 + 39.3);
		float seed3 = hash11(aIdx * 3456.78 + 81.7);
		float yP = clamp((base.y - uYR.x) / max(uYR.y - uYR.x, 1e-4), 0.0, 1.0);
		float onset = (1.0 - yP) * uPhysP.y * 1.3 + seed * 0.3;
		float pt = max(0.0, uCollapseTime - onset);
		vec3 radd = normalize(base + vec3(1e-3));
		vec3 tang = normalize(vec3(-base.z, 0.0, base.x) + vec3(1e-3, 0.0, 0.0));
		vec3 v0 = (radd * (0.5 + seed * 1.1) + tang * uPhysP.z * (0.3 + seed3 * 0.9)) * uPhysP.x;
		float vy0 = (0.5 + seed2 * 1.0) * uPhysP.x;
		float g = uPhysics.y * 3.8;
		float floorY = uYR.x - 0.04;
		float drag = 1.0 - exp(-pt * 1.5);
		vec3 pPhys = base;
		pPhys.x += v0.x * drag / 1.5 + uPhysics.w * 0.5 * drag;
		pPhys.z += v0.z * drag / 1.5;
		float h0 = max(base.y - floorY, 0.0);
		float vimp = sqrt(vy0 * vy0 + 2.0 * g * h0);
		float t1 = (vy0 + vimp) / g;
		float yy;
		if (pt < t1) {
			yy = base.y + vy0 * pt - 0.5 * g * pt * pt;
		} else {
			float tt = pt - t1;
			float vy = vimp * uPhysics.z;
			float hh = 0.0;
			for (int b = 0; b < 4; b++) {
				float T = 2.0 * vy / g;
				if (tt < T) {
					hh = vy * tt - 0.5 * g * tt * tt;
					break;
				}
				tt -= T;
				vy *= uPhysics.z;
			}
			yy = floorY + max(hh, 0.0);
		}
		pPhys.y = max(yy, floorY);
		// вращение осколков вокруг вертикали, пока летят
		float spinA = (1.0 - exp(-pt * 1.2)) * uPhysP.z * (seed2 - 0.5) * 2.0;
		vec2 sq = pPhys.xz;
		float cs = cos(spinA);
		float sn = sin(spinA);
		pPhys.xz = vec2(sq.x * cs - sq.y * sn, sq.x * sn + sq.y * cs);
		float strength = min(1.0, uPhysics.x);
		vec3 target = mix(pos, pPhys, strength);
		if (uAsm > 0.0) {
			float s0 = yP * 0.42 + seed * 0.2;
			float sA = clamp((uAsm * 1.4 - s0) / 0.55, 0.0, 1.0);
			float eA = sA * sA * (3.0 - 2.0 * sA);
			vec3 side = normalize(cross(pPhys - pos, vec3(0.0, 1.0, 0.0)) + vec3(1e-3));
			target = mix(target, pos, eA);
			target += side * sin(eA * 3.14159) * 0.45 * (seed3 - 0.3);
			target.y += sin(eA * 3.14159) * 0.5 * (0.4 + seed);
		}
		pos = target;
	}
	if (uHandP.x > 0.001) {
		for (int i = 0; i < 12; i++) {
			if (float(i) >= uHandP.w) break;
			vec3 hd = pos - uHand[i].xyz;
			float r = uHandP.y;
			float d2 = dot(hd, hd);
			if (d2 < r * r) {
				float f = 1.0 - sqrt(d2) / r;
				f = f * f * (3.0 - 2.0 * f);
				float hs = uHand[i].w;
				if (hs > 1.5) {
					hs -= 2.0;
					float a = f * hs * uHandP.x * 2.6;
					float ca = cos(a);
					float sa = sin(a);
					vec2 q = pos.xz - uHand[i].xz;
					pos.xz = uHand[i].xz + vec2(q.x * ca - q.y * sa, q.x * sa + q.y * ca);
					pos.y += f * hs * uHandP.x * 0.12;
				} else {
					pos += normalize(hd + vec3(1e-3)) * f * hs * uHandP.x * 0.75;
				}
			}
		}
	}
	if (uMouseOn > 0.5 && uCursor.x > 0.001) {
		vec3 tm = pos - uMouse;
		float r2 = uCursor.y * uCursor.y;
		float d2 = dot(tm, tm);
		if (d2 < r2) {
			float f = 1.0 - d2 / r2;
			if (uCursor.z > 1.5) {
				// вихрь: точки под курсором закручиваются вокруг оси взгляда (ось взгляда в координатах облака это третья строка modelView)
				vec3 vax = normalize(vec3(modelViewMatrix[0][2], modelViewMatrix[1][2], modelViewMatrix[2][2]) + vec3(1e-5));
				float ca = f * f * uCursor.x * 2.2;
				float cc = cos(ca);
				float cs = sin(ca);
				pos = uMouse + tm * cc + cross(vax, tm) * cs + vax * dot(vax, tm) * (1.0 - cc);
			} else pos += normalize(tm + vec3(1e-3)) * f * f * uCursor.x * 0.6 * uCursor.z;
		}
	}
	return pos;
}
`;
