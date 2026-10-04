/**
 * EffectsEngine — автономный режим эффектов в стиле TouchDesigner.
 * Реализует:
 * 1. Частицы на основе Point Cloud с локальным отрывом по полю Curl Noise (Field POP)
 * 2. Органический морфинг между формами (Модель ↔ Сфера ↔ Тор ↔ Куб ↔ ДНК ↔ Сатурн) с завихрением в полёте
 * 3. Интерактивное силовое поле курсора мыши (Mouse Repulsor)
 * 4. Сглаженную аудио-реактивность (без дрожания геометрии)
 * 5. Встроенный процедурный синтезатор, загрузку аудиофайлов и микрофон
 * 6. Кинематографичный плавающий пульт управления
 */
import * as THREE from 'three';

// ── Генераторы примитивов для морфинга ────────────────────────────────────────

export function generateShapePoints(type, count = 100000) {
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3).fill(1);

  if (type === 'sphere') {
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;
      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;
      pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;
      nor[i*3] = x; nor[i*3+1] = y; nor[i*3+2] = z;
    }
  } else if (type === 'torus') {
    const R = 1.0, r = 0.36;
    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * Math.PI * 2;
      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y = r * Math.sin(v);
      const z = (R + r * Math.cos(v)) * Math.sin(u);
      pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;
      const cx = R * Math.cos(u), cz = R * Math.sin(u);
      nor[i*3] = (x - cx) / r; nor[i*3+1] = y / r; nor[i*3+2] = (z - cz) / r;
    }
  } else if (type === 'cube') {
    const h = 0.65;
    for (let i = 0; i < count; i++) {
      const face = Math.floor(Math.random() * 6);
      const u = (Math.random() - 0.5) * h * 2;
      const v = (Math.random() - 0.5) * h * 2;
      switch (face) {
        case 0: pos[i*3]=h;  pos[i*3+1]=u; pos[i*3+2]=v; nor[i*3]=1;  break;
        case 1: pos[i*3]=-h; pos[i*3+1]=u; pos[i*3+2]=v; nor[i*3]=-1; break;
        case 2: pos[i*3]=u;  pos[i*3+1]=h; pos[i*3+2]=v; nor[i*3+1]=1;  break;
        case 3: pos[i*3]=u;  pos[i*3+1]=-h;pos[i*3+2]=v; nor[i*3+1]=-1; break;
        case 4: pos[i*3]=u;  pos[i*3+1]=v; pos[i*3+2]=h; nor[i*3+2]=1;  break;
        case 5: pos[i*3]=u;  pos[i*3+1]=v; pos[i*3+2]=-h;nor[i*3+2]=-1; break;
      }
    }
  } else if (type === 'helix') {
    const turns = 3.5, h = 1.6, r = 0.65;
    for (let i = 0; i < count; i++) {
      const strand = Math.random() < 0.45 ? 0 : Math.random() < 0.85 ? 1 : 2;
      const t = Math.random();
      const angle = t * Math.PI * 2 * turns;
      const y = (t - 0.5) * h;
      if (strand === 0) {
        pos[i*3] = Math.cos(angle) * r; pos[i*3+1] = y; pos[i*3+2] = Math.sin(angle) * r;
        nor[i*3] = Math.cos(angle); nor[i*3+2] = Math.sin(angle);
      } else if (strand === 1) {
        pos[i*3] = Math.cos(angle + Math.PI) * r; pos[i*3+1] = y; pos[i*3+2] = Math.sin(angle + Math.PI) * r;
        nor[i*3] = Math.cos(angle + Math.PI); nor[i*3+2] = Math.sin(angle + Math.PI);
      } else {
        const u = Math.random() * 2 - 1;
        pos[i*3] = Math.cos(angle) * r * u; pos[i*3+1] = y; pos[i*3+2] = Math.sin(angle) * r * u;
        nor[i*3+1] = 1;
      }
    }
  } else if (type === 'saturn') {
    for (let i = 0; i < count; i++) {
      if (Math.random() < 0.3) {
        const u = Math.random(), v = Math.random();
        const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
        const sr = 0.35;
        pos[i*3] = sr * Math.sin(phi) * Math.cos(theta);
        pos[i*3+1] = sr * Math.sin(phi) * Math.sin(theta);
        pos[i*3+2] = sr * Math.cos(phi);
        nor[i*3] = pos[i*3]/sr; nor[i*3+1] = pos[i*3+1]/sr; nor[i*3+2] = pos[i*3+2]/sr;
      } else {
        const rad = Math.sqrt(Math.random() * (1.4*1.4 - 0.5*0.5) + 0.5*0.5);
        const theta = Math.random() * Math.PI * 2;
        pos[i*3] = Math.cos(theta) * rad;
        pos[i*3+1] = (Math.random() - 0.5) * 0.04;
        pos[i*3+2] = Math.sin(theta) * rad;
        nor[i*3+1] = 1;
      }
    }
  }
  return { positions: pos, normals: nor, colors: col, count };
}

// ── GLSL Шейдеры: Curl Noise + Fluid Dispersion + Morphing ──────────────────

const effectsVert = /* glsl */`
precision highp float;

attribute vec3 aOrigin;
attribute vec3 aTarget;
attribute vec3 aNormal;
attribute float aIdx;
attribute vec3 aColor;

uniform float uTime;
uniform float uMorph;           // 0.0 (исходная форма) .. 1.0 (целевая форма)
uniform float uDispersion;      // Сила отрыва частиц от модели
uniform float uCurlScale;       // Масштаб вихрей
uniform float uSpeed;           // Скорость эволюции шума
uniform float uBass;            // Сглаженная энергия баса [0..1]
uniform float uMid;             // Энергия средних частот
uniform float uHigh;            // Энергия верхов
uniform float uBeat;            // Импульс удара [0..1]
uniform float uSize;            // Размер точек
uniform float uPR;              // Device pixel ratio
uniform vec3  uMousePos;        // 3D позиция курсора
uniform float uMouseActive;     // 1.0 если мышь над сценой, иначе 0.0
uniform float uColorMode;       // 0..6
uniform vec3  uPalette0;
uniform vec3  uPalette1;
uniform vec3  uPalette2;

varying vec3  vColor;
varying float vAlpha;
varying float vDispersed;

#define PI 3.1415926535

// 3D Simplex-like Perlin шум для Curl Noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// Вычисление Curl Noise (ротор поля шума — без дивергенции)
vec3 curlNoise(vec3 p) {
  const float e = 0.08;
  float n1 = snoise(p + vec3(e, 0.0, 0.0));
  float n2 = snoise(p - vec3(e, 0.0, 0.0));
  float n3 = snoise(p + vec3(0.0, e, 0.0));
  float n4 = snoise(p - vec3(0.0, e, 0.0));
  float n5 = snoise(p + vec3(0.0, 0.0, e));
  float n6 = snoise(p - vec3(0.0, 0.0, e));
  float x = (n4 - n3) - (n6 - n5);
  float y = (n6 - n5) - (n2 - n1);
  float z = (n2 - n1) - (n4 - n3);
  return normalize(vec3(x, y, z));
}

vec3 paletteColor(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.5) return mix(uPalette0, uPalette1, t * 2.0);
  return mix(uPalette1, uPalette2, (t - 0.5) * 2.0);
}

void main() {
  float t = uTime * uSpeed;
  float idx = aIdx;

  // 1. Плавный морфинг между aOrigin и aTarget
  vec3 basePos = mix(aOrigin, aTarget, uMorph);

  // Возмущение в процессе морфинга (завихрение в полёте)
  float morphTurb = sin(uMorph * PI) * 0.45;
  if (morphTurb > 0.001) {
    basePos += curlNoise(basePos * 2.5 + t * 0.8) * morphTurb;
  }

  // 2. Локальный отрыв частиц (Curl Noise Dispersion)
  // Частицы отрываются не все разом, а отдельными облаками в зависимости от их индекса и шума
  float detachThreshold = snoise(basePos * 1.8 + t * 0.3) * 0.5 + 0.5;
  float audioEnergy = uBass * 1.2 + uBeat * 0.8 + uMid * 0.4;
  float isDetached = smoothstep(0.4, 0.9, detachThreshold + audioEnergy * 0.3);

  vec3 curlDir = curlNoise(basePos * uCurlScale + vec3(t * 0.4, t * 0.3, t * 0.5));
  float driftDist = isDetached * uDispersion * (0.2 + audioEnergy * 0.8);
  vec3 pos = basePos + curlDir * driftDist;

  // Лёгкое дрожание высоких частот
  pos += aNormal * sin(t * 14.0 + idx * 40.0) * uHigh * 0.03;

  // 3. Интерактивное силовое поле курсора мыши (Mouse Repulsor)
  if (uMouseActive > 0.5) {
    vec3 toMouse = pos - uMousePos;
    float distSq = dot(toMouse, toMouse);
    if (distSq < 1.2) {
      float repulse = (1.0 - distSq / 1.2) * 0.45;
      pos += normalize(toMouse + vec3(0.001)) * repulse;
    }
  }

  // 4. Окраска
  vec3 col;
  float speedNorm = length(curlDir * driftDist);
  vDispersed = isDetached * (0.3 + speedNorm);

  if (uColorMode < 0.5) {
    // Киберпанк (Cyan / Magenta / Gold)
    vec3 c1 = vec3(0.0, 0.95, 1.0);
    vec3 c2 = vec3(1.0, 0.05, 0.8);
    vec3 c3 = vec3(1.0, 0.85, 0.1);
    float p = mod(idx + uBass * 0.3, 1.0);
    col = p < 0.5 ? mix(c1, c2, p * 2.0) : mix(c2, c3, (p - 0.5) * 2.0);
    col *= 0.85 + vDispersed * 0.6;
  } else if (uColorMode < 1.5) {
    // Палитра пользователя
    float p = mod(idx + speedNorm * 0.5 + uBass * 0.2, 1.0);
    col = paletteColor(p) * (0.8 + vDispersed * 0.6);
  } else if (uColorMode < 2.5) {
    // Плазма / Тепловой
    float heat = clamp(vDispersed * 0.8 + uBass * 0.4, 0.0, 1.0);
    col = mix(vec3(0.05, 0.1, 0.9), vec3(0.98, 0.25, 0.05), heat);
    if (heat > 0.7) col = mix(col, vec3(1.0, 0.95, 0.8), (heat - 0.7) * 3.3);
  } else if (uColorMode < 3.5) {
    // Аврора (Изумруд / Фиолетовый / Индиго)
    vec3 c1 = vec3(0.0, 0.95, 0.6);
    vec3 c2 = vec3(0.6, 0.1, 0.95);
    col = mix(c1, c2, mod(idx * 2.0 + t * 0.1, 1.0));
    col *= 0.8 + uEnergy * 0.5;
  } else if (uColorMode < 4.5) {
    // Оригинальные цвета модели
    col = aColor * (0.8 + vDispersed * 0.5 + uBeat * 0.3);
  } else {
    // Монохромный минимализм
    float b = 0.7 + vDispersed * 0.4 + uBeat * 0.3;
    col = vec3(b);
  }

  vColor = col;
  vAlpha = 0.85 + vDispersed * 0.15;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float ptSize = uSize * uPR * (1.0 + vDispersed * 0.5 + uBeat * 0.3);
  ptSize *= 3.8 / max(-mv.z, 0.4);
  gl_PointSize = clamp(ptSize, 1.0, 60.0);
}
`;

const effectsFrag = /* glsl */`
precision highp float;
varying vec3  vColor;
varying float vAlpha;
varying float vDispersed;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;

  // Мягкое свечение ядра частицы
  float core = 1.0 - smoothstep(0.0, 0.25, r2);
  float aura = 1.0 - smoothstep(0.05, 0.25, r2);
  vec3 col = vColor * (core + aura * 0.5 + vDispersed * 0.4);

  gl_FragColor = vec4(col, vAlpha * core);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ── Встроенный синтезатор музыки ─────────────────────────────────────────────

class TouchSynth {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.dest = dest;
    this.timer = null;
    this.step = 0;
    this.playing = false;
    this.bpm = 124;
    this.mode = 'synthwave';
    this.gain = null;
  }

  start(mode = 'synthwave') {
    this.stop();
    this.mode = mode;
    this.bpm = mode === 'cyberpunk' ? 138 : mode === 'ambient' ? 95 : 124;
    this.playing = true;
    this.step = 0;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.55;
    this.gain.connect(this.dest);

    const interval = (60 / (this.bpm * 4)) * 1000;
    this.timer = setInterval(() => this._tick(), interval);
    this._tick();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.gain) { try { this.gain.disconnect(); } catch (_) {} this.gain = null; }
    this.playing = false;
  }

  _tick() {
    if (!this.playing || !this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    const s = this.step % 32;

    // Kick
    if (s % 4 === 0 && this.mode !== 'ambient') {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(this.mode === 'cyberpunk' ? 160 : 130, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.09);
      g.gain.setValueAtTime(1.0, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(g); g.connect(this.gain);
      osc.start(now); osc.stop(now + 0.17);
    } else if (this.mode === 'ambient' && s % 8 === 0) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.22);
      g.gain.setValueAtTime(0.6, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(g); g.connect(this.gain);
      osc.start(now); osc.stop(now + 0.32);
    }

    // Snare / Noise
    if ((s === 4 || s === 12 || s === 20 || s === 28) && this.mode !== 'ambient') {
      const bSize = this.ctx.sampleRate * 0.12;
      const buf = this.ctx.createBuffer(1, bSize, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bSize; i++) d[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource(); noise.buffer = buf;
      const filt = this.ctx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.setValueAtTime(900, now);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.7, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      noise.connect(filt); filt.connect(g); g.connect(this.gain);
      noise.start(now); noise.stop(now + 0.14);
    }

    // Hi-hat
    if (s % 2 === 0 && this.mode !== 'ambient') {
      const bSize = this.ctx.sampleRate * 0.04;
      const buf = this.ctx.createBuffer(1, bSize, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bSize; i++) d[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource(); noise.buffer = buf;
      const filt = this.ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.setValueAtTime(7500, now);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(s % 4 === 2 ? 0.35 : 0.18, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      noise.connect(filt); filt.connect(g); g.connect(this.gain);
      noise.start(now); noise.stop(now + 0.05);
    }

    // Bass
    const chords = [55, 55, 43.65, 43.65, 65.4, 65.4, 49, 49];
    const freq = chords[Math.floor(s / 4) % chords.length];
    const bOsc = this.ctx.createOscillator();
    const bFilt = this.ctx.createBiquadFilter();
    const bGain = this.ctx.createGain();
    bOsc.type = this.mode === 'cyberpunk' ? 'sawtooth' : 'triangle';
    bOsc.frequency.setValueAtTime(freq, now);
    bFilt.type = 'lowpass'; bFilt.frequency.setValueAtTime(320, now);
    bFilt.frequency.exponentialRampToValueAtTime(1200, now + 0.04);
    bFilt.frequency.exponentialRampToValueAtTime(200, now + 0.14);
    bGain.gain.setValueAtTime(0.55, now); bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    bOsc.connect(bFilt); bFilt.connect(bGain); bGain.connect(this.gain);
    bOsc.start(now); bOsc.stop(now + 0.16);

    // Arp
    const scale = [220, 261.63, 329.63, 392.0, 440, 523.25, 659.25];
    const aNote = scale[(s * 3) % scale.length];
    const aOsc = this.ctx.createOscillator();
    const aGain = this.ctx.createGain();
    aOsc.type = this.mode === 'ambient' ? 'sine' : 'sawtooth';
    aOsc.frequency.setValueAtTime(aNote, now);
    const dur = this.mode === 'ambient' ? 0.45 : 0.11;
    aGain.gain.setValueAtTime(this.mode === 'ambient' ? 0.2 : 0.15, now);
    aGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    aOsc.connect(aGain); aGain.connect(this.gain);
    aOsc.start(now); aOsc.stop(now + dur + 0.02);

    this.step++;
  }
}

// ── Главный класс EffectsEngine ──────────────────────────────────────────────

export class EffectsEngine {
  constructor(app) {
    this.app = app;
    this.active = false;

    // Web Audio
    this.ctx = null;
    this.analyser = null;
    this.freqData = null;
    this.source = null;
    this.audioBuffer = null;
    this.audioName = '';
    this.playing = false;
    this.sourceType = 'synth'; // 'synth' | 'file' | 'mic'

    this.synth = null;
    this.micStream = null;

    // Сглаженные аудио-каналы (Lag Filter в стиле TouchDesigner)
    this.smoothBass = 0;
    this.smoothMid  = 0;
    this.smoothHigh = 0;
    this.beatDecay  = 0;
    this._beatHist  = new Float32Array(24).fill(0);
    this._beatIdx   = 0;
    this._lastBeatT = 0;

    // Three.js объекты
    this._points = null;
    this._geometry = null;
    this._material = null;
    this._hudEl = null;
    this._time = 0;
    this._frameId = null;

    // Сохранённые формы
    this.shapes = {
      model: null,
      sphere: null,
      torus: null,
      cube: null,
      helix: null,
      saturn: null,
    };
    this.currentShapeKey = 'model';
    this.targetShapeKey = 'sphere';

    // Параметры эффектов
    this.settings = {
      dispersion: 0.8,      // Сила отрыва частиц
      curlScale: 1.8,       // Масштаб вихревого поля
      speed: 1.0,           // Скорость эволюции шума
      size: 4.5,            // Размер точек
      colorMode: 0,         // 0: Киберпанк, 1: Палитра, 2: Плазма, 3: Аврора, 4: Модель, 5: Моно
      autoRotate: true,
      rotateSpeed: 0.15,
      palette: ['#00f0ff', '#ff0077', '#ffe600'],
    };

    // Морфинг
    this.morphProgress = 0;
    this.isMorphing = false;
    this.morphTarget = 0;

    // Интерактивная мышь
    this.mousePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.raycaster = new THREE.Raycaster();
    this.mousePos3D = new THREE.Vector3();
    this.mouseActive = false;

    // Обработчик мыши
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseLeave = this._handleMouseLeave.bind(this);
  }

  _ensureCtx() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.84;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.synth = new TouchSynth(this.ctx, this.analyser);
  }

  // ── Звуковые источники ───────────────────────────────────────────────────

  play() {
    this._ensureCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume();

    if (this.sourceType === 'synth') {
      this.synth.start(this.synth.mode);
      this.playing = true;
      this.audioName = this.synth.mode === 'cyberpunk' ? 'Cyberpunk DnB' : this.synth.mode === 'ambient' ? 'Chill Ambient' : '80s Synthwave';
    } else if (this.sourceType === 'file' && this.audioBuffer) {
      this.source = this.ctx.createBufferSource();
      this.source.buffer = this.audioBuffer;
      this.source.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.source.start(0);
      this.playing = true;
      this.source.onended = () => { this.playing = false; this._updateHUD(); };
    }
    this._updateHUD();
  }

  pause() {
    if (this.sourceType === 'synth') {
      this.synth?.stop();
    } else if (this.source) {
      try { this.source.stop(); } catch (_) {}
      this.source = null;
    }
    this.playing = false;
    this._updateHUD();
  }

  setSynthMode(mode) {
    this._ensureCtx();
    this.sourceType = 'synth';
    if (this.playing) this.synth.start(mode);
    else this.synth.mode = mode;
    this.audioName = mode === 'cyberpunk' ? 'Cyberpunk DnB' : mode === 'ambient' ? 'Chill Ambient' : '80s Synthwave';
    this._updateHUD();
  }

  async loadAudioFile(file) {
    this._ensureCtx();
    this.pause();
    const buf = await file.arrayBuffer();
    this.audioBuffer = await this.ctx.decodeAudioData(buf);
    this.sourceType = 'file';
    this.audioName = file.name.replace(/\.[^.]+$/, '');
    this.play();
  }

  async toggleMic() {
    this._ensureCtx();
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
      this.sourceType = 'synth';
      this.audioName = '80s Synthwave';
      this.pause();
    } else {
      this.pause();
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micSrc = this.ctx.createMediaStreamSource(this.micStream);
      micSrc.connect(this.analyser);
      this.sourceType = 'mic';
      this.audioName = 'Живой микрофон';
      this.playing = true;
    }
    this._updateHUD();
  }

  // ── Анализ звука (с фильтром сглаживания Lag) ───────────────────────────

  analyseAudio() {
    if (!this.analyser || !this.playing) {
      this.smoothBass *= 0.9;
      this.smoothMid  *= 0.9;
      this.smoothHigh *= 0.9;
      this.beatDecay  *= 0.88;
      return { bass: 0, mid: 0, high: 0, beat: 0 };
    }

    this.analyser.getByteFrequencyData(this.freqData);
    const n = this.freqData.length;

    const bEnd = Math.floor(n * 0.05);
    const mEnd = Math.floor(n * 0.25);
    const hEnd = Math.floor(n * 0.70);

    let bRaw = 0, mRaw = 0, hRaw = 0;
    for (let i = 0; i < bEnd; i++) bRaw += this.freqData[i];
    for (let i = bEnd; i < mEnd; i++) mRaw += this.freqData[i];
    for (let i = mEnd; i < hEnd; i++) hRaw += this.freqData[i];

    bRaw /= (bEnd * 255);
    mRaw /= ((mEnd - bEnd) * 255);
    hRaw /= ((hEnd - mEnd) * 255);

    // Lag Filter (мягкая атака, плавный спад)
    this.smoothBass = this.smoothBass * 0.7 + bRaw * 0.3;
    this.smoothMid  = this.smoothMid  * 0.75 + mRaw * 0.25;
    this.smoothHigh = this.smoothHigh * 0.8 + hRaw * 0.2;

    // Beat Detection
    this._beatHist[this._beatIdx % this._beatHist.length] = bRaw;
    this._beatIdx++;
    let avg = 0;
    for (let i = 0; i < this._beatHist.length; i++) avg += this._beatHist[i];
    avg /= this._beatHist.length;

    const now = performance.now();
    if (bRaw > avg * 1.35 && bRaw > 0.35 && now - this._lastBeatT > 200) {
      this._lastBeatT = now;
      this.beatDecay = 1.0;
    }
    this.beatDecay *= 0.88;

    return {
      bass: this.smoothBass,
      mid:  this.smoothMid,
      high: this.smoothHigh,
      beat: this.beatDecay,
    };
  }

  // ── Подготовка геометрии и морфинга ─────────────────────────────────────

  _preparePointData(sourceCloud) {
    const count = sourceCloud.count;
    this.shapes.model = sourceCloud;
    this.shapes.sphere = generateShapePoints('sphere', count);
    this.shapes.torus  = generateShapePoints('torus', count);
    this.shapes.cube   = generateShapePoints('cube', count);
    this.shapes.helix  = generateShapePoints('helix', count);
    this.shapes.saturn = generateShapePoints('saturn', count);

    const g = new THREE.BufferGeometry();
    const idxArr = new Float32Array(count);
    for (let i = 0; i < count; i++) idxArr[i] = i / count;

    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sourceCloud.positions), 3));
    g.setAttribute('aOrigin',  new THREE.BufferAttribute(new Float32Array(sourceCloud.positions), 3));
    g.setAttribute('aTarget',  new THREE.BufferAttribute(new Float32Array(this.shapes.sphere.positions), 3));
    g.setAttribute('aNormal',  new THREE.BufferAttribute(new Float32Array(sourceCloud.normals), 3));
    g.setAttribute('aColor',   new THREE.BufferAttribute(new Float32Array(sourceCloud.colors), 3));
    g.setAttribute('aIdx',     new THREE.BufferAttribute(idxArr, 1));

    const s = this.settings;
    const mat = new THREE.ShaderMaterial({
      vertexShader: effectsVert,
      fragmentShader: effectsFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime:         { value: 0 },
        uMorph:        { value: 0 },
        uDispersion:   { value: s.dispersion },
        uCurlScale:    { value: s.curlScale },
        uSpeed:        { value: s.speed },
        uBass:         { value: 0 },
        uMid:          { value: 0 },
        uHigh:         { value: 0 },
        uBeat:         { value: 0 },
        uSize:         { value: s.size },
        uPR:           { value: Math.min(window.devicePixelRatio || 1, 2) },
        uMousePos:     { value: new THREE.Vector3() },
        uMouseActive:  { value: 0.0 },
        uColorMode:    { value: s.colorMode },
        uPalette0:     { value: new THREE.Color(s.palette[0]) },
        uPalette1:     { value: new THREE.Color(s.palette[1]) },
        uPalette2:     { value: new THREE.Color(s.palette[2]) },
      },
    });

    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;

    // Центрируем облако
    g.computeBoundingBox();
    const box = g.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);
    pts.position.copy(center.negate());

    this._geometry = g;
    this._material = mat;
    this._points = pts;

    this.app.viewport.scene.add(pts);
  }

  /** Плавный морфинг к выбранной форме */
  morphTo(shapeKey) {
    if (!this.shapes[shapeKey] || !this._geometry) return;
    const targetData = this.shapes[shapeKey];

    // Копируем текущее интерполированное состояние в aOrigin
    const originAttr = this._geometry.attributes.aOrigin;
    const targetAttr = this._geometry.attributes.aTarget;

    const count = this._geometry.attributes.position.count;
    const pCurrent = originAttr.array;
    const pTarget  = targetAttr.array;
    const progress = this.morphProgress;

    for (let i = 0; i < count * 3; i++) {
      pCurrent[i] = pCurrent[i] * (1 - progress) + pTarget[i] * progress;
      pTarget[i] = targetData.positions[i];
    }

    originAttr.needsUpdate = true;
    targetAttr.needsUpdate = true;

    this.currentShapeKey = shapeKey;
    this.morphProgress = 0;
    this.isMorphing = true;
  }

  // ── Вход и выход из режима «Эффекты» ────────────────────────────────────

  enter(sourceCloud) {
    if (this.active) return;
    this.active = true;

    // 1. Скрываем стандартную модель и вспомогательные панели
    this.savedModelVisible = this.app.viewport.root.visible;
    this.app.viewport.root.visible = false;

    // 2. Инициализируем геометрию частиц
    this._preparePointData(sourceCloud);

    // 3. Создаём HUD и слушатели мыши
    this._buildHUD();
    const stage = document.querySelector('.stage');
    stage?.addEventListener('mousemove', this._onMouseMove);
    stage?.addEventListener('mouseleave', this._onMouseLeave);

    // 4. Фокусируем камеру
    const sphere = this._geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    this.app.nav.animateTo({ target: new THREE.Vector3(0, 0, 0), distance: Math.max(sphere.radius * 2.3, 2.2) }, 400);

    // 5. Запускаем синтезатор по умолчанию
    this.play();

    // 6. Запускаем цикл отрисовки
    this._startLoop();
  }

  exit() {
    if (!this.active) return;
    this.active = false;

    this.pause();
    this._stopLoop();

    // Восстанавливаем модель
    if (this.app.viewport.root) {
      this.app.viewport.root.visible = this.savedModelVisible !== false;
    }

    // Удаляем точки
    if (this._points) {
      this.app.viewport.scene.remove(this._points);
      this._geometry?.dispose();
      this._material?.dispose();
      this._points = null;
      this._geometry = null;
      this._material = null;
    }

    // Удаляем слушатели
    const stage = document.querySelector('.stage');
    stage?.removeEventListener('mousemove', this._onMouseMove);
    stage?.removeEventListener('mouseleave', this._onMouseLeave);

    this._destroyHUD();
    this.app.viewport.invalidate();
  }

  // ── Интерактивная мышь ──────────────────────────────────────────────────

  _handleMouseMove(e) {
    if (!this.active || !this._material) return;
    const rect = this.app.viewport.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.app.viewport.camera);
    this.mousePlane.normal.copy(this.app.viewport.camera.getWorldDirection(new THREE.Vector3()).negate());

    const intersection = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.mousePlane, intersection)) {
      this.mousePos3D.copy(intersection);
      this.mouseActive = true;
    }
  }

  _handleMouseLeave() {
    this.mouseActive = false;
  }

  // ── Главный анимационный цикл ───────────────────────────────────────────

  _startLoop() {
    const vp = this.app.viewport;

    const loop = () => {
      if (!this.active) return;
      this._frameId = requestAnimationFrame(loop);

      const audio = this.analyseAudio();
      this._time += 0.016 * this.settings.speed;

      // Плавное продвижение морфинга
      if (this.isMorphing) {
        this.morphProgress += 0.025;
        if (this.morphProgress >= 1.0) {
          this.morphProgress = 1.0;
          this.isMorphing = false;
        }
      }

      // Авто-вращение
      if (this.settings.autoRotate && this._points) {
        this._points.rotation.y += 0.008 * this.settings.rotateSpeed * 10;
        this._points.rotation.x = Math.sin(this._time * 0.2) * 0.05;
      }

      // Обновление uniforms
      if (this._material) {
        const u = this._material.uniforms;
        const s = this.settings;
        u.uTime.value        = this._time;
        u.uMorph.value       = this.morphProgress;
        u.uDispersion.value  = s.dispersion;
        u.uCurlScale.value   = s.curlScale;
        u.uSpeed.value       = s.speed;
        u.uSize.value        = s.size;
        u.uBass.value        = audio.bass;
        u.uMid.value         = audio.mid;
        u.uHigh.value        = audio.high;
        u.uBeat.value        = audio.beat;
        u.uColorMode.value   = s.colorMode;
        u.uMouseActive.value = this.mouseActive ? 1.0 : 0.0;
        u.uMousePos.value.copy(this.mousePos3D);
      }

      vp.invalidate();
    };

    this._frameId = requestAnimationFrame(loop);
  }

  _stopLoop() {
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
  }

  // ── Стильный HUD контроллера эффектов ───────────────────────────────────

  _buildHUD() {
    this._destroyHUD();
    const hud = document.createElement('div');
    hud.className = 'effects-hud';
    hud.innerHTML = `
      <div class="effects-hud-card">
        <!-- Шапка -->
        <div class="effects-hud-header">
          <div class="effects-hud-badge">✨ Режим «Эффекты»</div>
          <button type="button" class="btn btn-icon hud-close-btn" id="fxExitBtn" title="Выйти из режима (Esc)">✕</button>
        </div>

        <!-- Аудио плеер -->
        <div class="effects-hud-audio">
          <div class="effects-audio-info">
            <span class="audio-icon">🎵</span>
            <span class="audio-title" id="fxAudioTitle">${this.audioName || '80s Synthwave'}</span>
          </div>
          <div class="effects-audio-actions">
            <button type="button" class="btn btn-sm btn-primary" id="fxPlayBtn">${this.playing ? 'Пауза' : 'Плей'}</button>
            <button type="button" class="btn btn-sm btn-ghost" id="fxFileBtn" title="Загрузить свой трек">📁 Файл</button>
            <button type="button" class="btn btn-sm btn-ghost" id="fxMicBtn" title="Включить живой микрофон">🎤 Микрофон</button>
          </div>
        </div>

        <!-- Морфинг между формами -->
        <div class="effects-hud-section">
          <div class="effects-sec-label">Морфинг формы:</div>
          <div class="effects-morph-pills">
            <button type="button" class="fx-pill" data-shape="model">Модель</button>
            <button type="button" class="fx-pill active" data-shape="sphere">Сфера</button>
            <button type="button" class="fx-pill" data-shape="torus">Тор</button>
            <button type="button" class="fx-pill" data-shape="cube">Куб</button>
            <button type="button" class="fx-pill" data-shape="helix">ДНК</button>
            <button type="button" class="fx-pill" data-shape="saturn">Сатурн</button>
          </div>
        </div>

        <!-- Параметры частиц Curl Noise -->
        <div class="effects-hud-sliders">
          <div class="fx-slider-row">
            <span>Отрыв (Dispersion)</span>
            <input type="range" min="0" max="2.5" step="0.05" value="${this.settings.dispersion}" id="slDispersion">
          </div>
          <div class="fx-slider-row">
            <span>Вихри (Curl Noise)</span>
            <input type="range" min="0.5" max="4.0" step="0.1" value="${this.settings.curlScale}" id="slCurl">
          </div>
          <div class="fx-slider-row">
            <span>Размер точек</span>
            <input type="range" min="1.5" max="12.0" step="0.5" value="${this.settings.size}" id="slSize">
          </div>
        </div>

        <!-- Цветовые схемы -->
        <div class="effects-hud-section">
          <div class="effects-sec-label">Цвет:</div>
          <div class="effects-color-pills">
            <button type="button" class="fx-color-pill active" data-color="0">Киберпанк</button>
            <button type="button" class="fx-color-pill" data-color="2">Плазма</button>
            <button type="button" class="fx-color-pill" data-color="3">Аврора</button>
            <button type="button" class="fx-color-pill" data-color="4">Модель</button>
            <button type="button" class="fx-color-pill" data-color="5">Моно</button>
          </div>
        </div>
      </div>
      <input type="file" id="fxFileInput" accept="audio/*" hidden>
    `;

    document.querySelector('.stage')?.appendChild(hud);
    this._hudEl = hud;

    // Привязка событий
    hud.querySelector('#fxExitBtn')?.addEventListener('click', () => this.exit());

    hud.querySelector('#fxPlayBtn')?.addEventListener('click', () => {
      if (this.playing) this.pause();
      else this.play();
    });

    const fInput = hud.querySelector('#fxFileInput');
    hud.querySelector('#fxFileBtn')?.addEventListener('click', () => fInput?.click());
    fInput?.addEventListener('change', () => {
      if (fInput.files[0]) this.loadAudioFile(fInput.files[0]);
    });

    hud.querySelector('#fxMicBtn')?.addEventListener('click', () => this.toggleMic());

    // Морфинг
    hud.querySelectorAll('.fx-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        hud.querySelectorAll('.fx-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.morphTo(btn.dataset.shape);
      });
    });

    // Слайдеры
    hud.querySelector('#slDispersion')?.addEventListener('input', e => {
      this.settings.dispersion = parseFloat(e.target.value);
    });
    hud.querySelector('#slCurl')?.addEventListener('input', e => {
      this.settings.curlScale = parseFloat(e.target.value);
    });
    hud.querySelector('#slSize')?.addEventListener('input', e => {
      this.settings.size = parseFloat(e.target.value);
    });

    // Цвета
    hud.querySelectorAll('.fx-color-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        hud.querySelectorAll('.fx-color-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.settings.colorMode = parseInt(btn.dataset.color, 10);
      });
    });
  }

  _updateHUD() {
    if (!this._hudEl) return;
    const title = this._hudEl.querySelector('#fxAudioTitle');
    const playBtn = this._hudEl.querySelector('#fxPlayBtn');
    if (title) title.textContent = this.audioName || '80s Synthwave';
    if (playBtn) playBtn.textContent = this.playing ? 'Пауза' : 'Плей';
  }

  _destroyHUD() {
    this._hudEl?.remove();
    this._hudEl = null;
  }
}
