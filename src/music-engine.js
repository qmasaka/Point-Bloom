/**
 * MusicEngine — профессиональный интерактивный движок для музыкального режима в OBJ-to-GLB.
 * Поддерживает:
 * 1. Аудиофайлы (MP3, WAV, OGG, FLAC, M4A) с перемоткой
 * 2. Встроенный процедурный Web Audio синтезатор (Synthwave, Cyberpunk, Ambient)
 * 3. Живой микрофон (Live Microphone / Audio Input)
 * 4. Частотный спектральный анализ (Sub-bass, Bass, Mids, Highs, Beat detection)
 * 5. 8 режимов анимации движения точек под музыку
 * 6. 7 цветовых спектральных палитр
 * 7. 3D спецэффекты: расширяющиеся ударные кольца (Shockwave Rings), центральное ядро и лучи
 * 8. Генераторы примитивов (Сфера, Тор, Куб, Цилиндр, ДНК-спираль, Диск Сатурна, Мёбиус, Плоскость)
 * 9. Интеграция с импортированными GLB/OBJ моделями
 */
import * as THREE from 'three';

// ── 1. Генераторы 3D-примитивов для облака точек ─────────────────────────────

export function generatePrimitive(type, count = 120000) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3).fill(1);
  const nor = new Float32Array(count * 3);

  if (type === 'sphere') {
    // Равномерное распределение Фибоначчи
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;
      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      nor[i * 3] = x; nor[i * 3 + 1] = y; nor[i * 3 + 2] = z;
    }
  } else if (type === 'torus') {
    const R = 1.0, r = 0.38;
    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * Math.PI * 2;
      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y = r * Math.sin(v);
      const z = (R + r * Math.cos(v)) * Math.sin(u);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const cx = R * Math.cos(u), cz = R * Math.sin(u);
      nor[i * 3] = (x - cx) / r; nor[i * 3 + 1] = y / r; nor[i * 3 + 2] = (z - cz) / r;
    }
  } else if (type === 'cube') {
    const h = 0.6;
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
  } else if (type === 'cylinder') {
    const r = 0.7, h = 1.2;
    for (let i = 0; i < count; i++) {
      if (Math.random() < 0.25) {
        // Крышки
        const top = Math.random() < 0.5;
        const rad = Math.sqrt(Math.random()) * r;
        const theta = Math.random() * Math.PI * 2;
        pos[i*3] = Math.cos(theta) * rad;
        pos[i*3+1] = top ? h / 2 : -h / 2;
        pos[i*3+2] = Math.sin(theta) * rad;
        nor[i*3+1] = top ? 1 : -1;
      } else {
        // Стенка
        const theta = Math.random() * Math.PI * 2;
        const y = (Math.random() - 0.5) * h;
        pos[i*3] = Math.cos(theta) * r;
        pos[i*3+1] = y;
        pos[i*3+2] = Math.sin(theta) * r;
        nor[i*3] = Math.cos(theta); nor[i*3+2] = Math.sin(theta);
      }
    }
  } else if (type === 'helix') {
    // Двойная спираль ДНК
    const turns = 4;
    const h = 1.6;
    const r = 0.65;
    for (let i = 0; i < count; i++) {
      const strand = Math.random() < 0.45 ? 0 : Math.random() < 0.82 ? 1 : 2;
      const t = Math.random();
      const angle = t * Math.PI * 2 * turns;
      const y = (t - 0.5) * h;
      if (strand === 0) {
        pos[i*3] = Math.cos(angle) * r;
        pos[i*3+1] = y;
        pos[i*3+2] = Math.sin(angle) * r;
        nor[i*3] = Math.cos(angle); nor[i*3+2] = Math.sin(angle);
      } else if (strand === 1) {
        pos[i*3] = Math.cos(angle + Math.PI) * r;
        pos[i*3+1] = y;
        pos[i*3+2] = Math.sin(angle + Math.PI) * r;
        nor[i*3] = Math.cos(angle + Math.PI); nor[i*3+2] = Math.sin(angle + Math.PI);
      } else {
        // Перекладины между спиралями
        const u = Math.random() * 2 - 1;
        pos[i*3] = Math.cos(angle) * r * u;
        pos[i*3+1] = y;
        pos[i*3+2] = Math.sin(angle) * r * u;
        nor[i*3+1] = 1;
      }
    }
  } else if (type === 'saturn') {
    // Кольца Сатурна / Аккреционный диск
    for (let i = 0; i < count; i++) {
      if (Math.random() < 0.25) {
        // Центральная сфера
        const u = Math.random(), v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const sr = 0.35;
        pos[i*3] = sr * Math.sin(phi) * Math.cos(theta);
        pos[i*3+1] = sr * Math.sin(phi) * Math.sin(theta);
        pos[i*3+2] = sr * Math.cos(phi);
        nor[i*3] = pos[i*3]/sr; nor[i*3+1] = pos[i*3+1]/sr; nor[i*3+2] = pos[i*3+2]/sr;
      } else {
        // Диск
        const rMin = 0.5, rMax = 1.35;
        const rad = Math.sqrt(Math.random() * (rMax*rMax - rMin*rMin) + rMin*rMin);
        const theta = Math.random() * Math.PI * 2;
        pos[i*3] = Math.cos(theta) * rad;
        pos[i*3+1] = (Math.random() - 0.5) * 0.04 * (rad / rMax);
        pos[i*3+2] = Math.sin(theta) * rad;
        nor[i*3+1] = 1;
      }
    }
  } else if (type === 'mobius') {
    // Лента Мёбиуса
    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = (Math.random() - 0.5) * 0.5;
      const x = (1 + (v / 2) * Math.cos(u / 2)) * Math.cos(u);
      const y = (1 + (v / 2) * Math.cos(u / 2)) * Math.sin(u);
      const z = (v / 2) * Math.sin(u / 2);
      pos[i*3] = x; pos[i*3+1] = z; pos[i*3+2] = y;
      nor[i*3] = Math.cos(u); nor[i*3+1] = Math.sin(u/2); nor[i*3+2] = Math.sin(u);
    }
  } else {
    // Плоскость / Terrain
    for (let i = 0; i < count; i++) {
      pos[i*3] = (Math.random() - 0.5) * 2.2;
      pos[i*3+1] = 0;
      pos[i*3+2] = (Math.random() - 0.5) * 2.2;
      nor[i*3+1] = 1;
    }
  }

  return { positions: pos, colors: col, normals: nor, count };
}

// ── 2. Процедурный синтезатор музыки (Web Audio API) ─────────────────────────

class ProceduralSynth {
  constructor(ctx, destinationNode) {
    this.ctx = ctx;
    this.dest = destinationNode;
    this.timer = null;
    this.step = 0;
    this.playing = false;
    this.bpm = 124;
    this.mode = 'synthwave'; // 'synthwave' | 'cyberpunk' | 'ambient'
    this._gain = null;
  }

  start(mode = 'synthwave') {
    this.stop();
    this.mode = mode;
    this.bpm = mode === 'cyberpunk' ? 138 : mode === 'ambient' ? 95 : 124;
    this.playing = true;
    this.step = 0;

    this._gain = this.ctx.createGain();
    this._gain.gain.value = 0.55;
    this._gain.connect(this.dest);

    const intervalMs = (60 / (this.bpm * 4)) * 1000;
    this.timer = setInterval(() => this._tick(), intervalMs);
    this._tick();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this._gain) {
      try { this._gain.disconnect(); } catch (_) {}
      this._gain = null;
    }
    this.playing = false;
  }

  _tick() {
    if (!this.playing || !this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    const step = this.step % 32;

    // 1. Kick drum (Каждый 4-й шаг: 0, 4, 8, 12, 16, 20, 24, 28)
    if (step % 4 === 0 && this.mode !== 'ambient') {
      this._playKick(now);
    } else if (this.mode === 'ambient' && step % 8 === 0) {
      this._playSoftKick(now);
    }

    // 2. Snare / Clap (Шаги 4, 12, 20, 28)
    if ((step === 4 || step === 12 || step === 20 || step === 28) && this.mode !== 'ambient') {
      this._playSnare(now);
    }

    // 3. Hi-hat (Каждые 2 шага)
    if (step % 2 === 0 && this.mode !== 'ambient') {
      this._playHat(now, step % 4 === 2);
    }

    // 4. Bassline
    this._playBass(now, step);

    // 5. Synth Lead / Arpeggiator
    this._playLead(now, step);

    this.step++;
  }

  _playKick(t) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const startFreq = this.mode === 'cyberpunk' ? 160 : 130;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.09);
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain);
    gain.connect(this._gain);
    osc.start(t);
    osc.stop(t + 0.17);
  }

  _playSoftKick(t) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.22);
    gain.gain.setValueAtTime(0.65, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain);
    gain.connect(this._gain);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  _playSnare(t) {
    // Белый шум
    const bufferSize = this.ctx.sampleRate * 0.12;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(900, t);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this._gain);
    noise.start(t);
    noise.stop(t + 0.14);
  }

  _playHat(t, accent) {
    const bufferSize = this.ctx.sampleRate * 0.04;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(7500, t);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(accent ? 0.35 : 0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this._gain);
    noise.start(t);
    noise.stop(t + 0.05);
  }

  _playBass(t, step) {
    // Басовые ноты: Am (55Hz), F (43.6Hz), C (65.4Hz), G (49Hz)
    const chords = [55, 55, 43.65, 43.65, 65.4, 65.4, 49, 49];
    const freq = chords[Math.floor(step / 4) % chords.length];
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = this.mode === 'cyberpunk' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(freq, t);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, t);
    filter.frequency.exponentialRampToValueAtTime(1200, t + 0.04);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.14);

    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this._gain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  _playLead(t, step) {
    // Мелодический арпеджиатор
    const scale = [220, 261.63, 329.63, 392.0, 440, 523.25, 659.25];
    const note = scale[(step * 3) % scale.length];
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = this.mode === 'ambient' ? 'sine' : 'sawtooth';
    osc.frequency.setValueAtTime(note, t);

    const dur = this.mode === 'ambient' ? 0.45 : 0.11;
    gain.gain.setValueAtTime(this.mode === 'ambient' ? 0.2 : 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(this._gain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}

// ── 3. Шейдеры точек (Vertex + Fragment) ───────────────────────────────────

const musicVert = /* glsl */`
precision highp float;
attribute vec3 aOrigin;
attribute vec3 aNormal;
attribute float aIdx;
attribute vec3 aColor;

uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uEnergy;
uniform float uBeat;
uniform float uSize;
uniform float uPR;
uniform float uMode;
uniform float uColorMode;
uniform float uIntensity;
uniform float uSpeed;
uniform float uBassGain;
uniform float uMidGain;
uniform float uHighGain;
uniform float uTurbulence;
uniform float uGravity;
uniform float uGlitch;
uniform vec3  uPalette0;
uniform vec3  uPalette1;
uniform vec3  uPalette2;

varying vec3 vColor;
varying float vAlpha;
varying float vGlow;

#define PI 3.1415926535

vec3 hsl2rgb(float h, float s, float l) {
  float C = (1.0 - abs(2.0*l - 1.0)) * s;
  float X = C * (1.0 - abs(mod(h*6.0, 2.0) - 1.0));
  float m = l - C/2.0;
  vec3 rgb;
  float h6 = h * 6.0;
  if      (h6 < 1.0) rgb = vec3(C, X, 0.0);
  else if (h6 < 2.0) rgb = vec3(X, C, 0.0);
  else if (h6 < 3.0) rgb = vec3(0.0, C, X);
  else if (h6 < 4.0) rgb = vec3(0.0, X, C);
  else if (h6 < 5.0) rgb = vec3(X, 0.0, C);
  else               rgb = vec3(C, 0.0, X);
  return rgb + m;
}

// 3-точечный градиент палитры
vec3 paletteColor(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.5) return mix(uPalette0, uPalette1, t * 2.0);
  return mix(uPalette1, uPalette2, (t - 0.5) * 2.0);
}

void main() {
  vec3 pos = aOrigin;
  float t = uTime * uSpeed;
  float idx = aIdx;
  float intens = uIntensity;
  float glow = 0.0;

  float b = uBass * uBassGain;
  float m = uMid * uMidGain;
  float h = uHigh * uHighGain;

  // ─── Режим 0: Взрыв (Explode / Shockwave) ───
  if (uMode < 0.5) {
    float burst = b * 1.2 + uBeat * 0.9;
    float wave = sin(t * 3.0 + idx * PI * 8.0) * 0.5 + 0.5;
    float dist = (burst + wave * m * 0.4) * intens;
    pos += aNormal * dist;
    // Вибрация от высоких
    pos += aNormal * sin(t * 12.0 + idx * 30.0) * h * 0.08 * intens;
    glow = burst;
  }
  // ─── Режим 1: Волна (Harmonic Sine Wave) ───
  else if (uMode < 1.5) {
    float waveX = sin(aOrigin.x * 5.0 + t * 4.0) * b;
    float waveZ = cos(aOrigin.z * 5.0 + t * 3.5) * m;
    pos.y += (waveX + waveZ) * intens * 0.85;
    pos.x += sin(aOrigin.y * 4.0 + t * 2.0) * h * intens * 0.25;
    glow = (abs(waveX) + abs(waveZ)) * 0.5;
  }
  // ─── Режим 2: Вихрь (Vortex / Swirl) ───
  else if (uMode < 2.5) {
    float r = length(aOrigin.xz) + 0.001;
    float angle = t * (0.8 + b * 2.2) + r * 3.5 * m + idx * 0.4;
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    pos.xz = rot * aOrigin.xz;
    pos.y = aOrigin.y + sin(r * 10.0 + t * 5.0) * h * intens * 0.45;
    pos.y += uBeat * intens * 0.35 * sign(aOrigin.y);
    glow = b * 0.8 + m * 0.3;
  }
  // ─── Режим 3: Пульс (Heartbeat / Resonance) ───
  else if (uMode < 3.5) {
    float dist = length(aOrigin);
    float pulse = b * sin(dist * 7.0 - t * 6.0) * intens;
    float ripple = m * sin(dist * 14.0 - t * 9.0) * intens * 0.3;
    float shimmer = h * sin(dist * 25.0 + t * 14.0) * intens * 0.15;
    pos += aNormal * (pulse + ripple + shimmer);
    pos += aNormal * uBeat * intens * 0.65;
    glow = b;
  }
  // ─── Режим 4: Орбита (Quantum Orbit) ───
  else if (uMode < 4.5) {
    float orbitSpeed = t * (0.6 + m * 1.4);
    float tiltAmp = b * intens * 0.6;
    float phase = idx * PI * 10.0;
    float tilt = sin(phase + t * 0.6) * tiltAmp;
    mat2 rotY = mat2(cos(orbitSpeed + phase), -sin(orbitSpeed + phase),
                     sin(orbitSpeed + phase),  cos(orbitSpeed + phase));
    pos.xz = rotY * aOrigin.xz;
    pos.y = aOrigin.y + tilt + sin(phase * 2.0 + t * 4.0) * h * 0.25 * intens;
    glow = b * 0.6 + uBeat * 0.4;
  }
  // ─── Режим 5: Галактика (Spiral Galaxy) ───
  else if (uMode < 5.5) {
    float arm = idx * PI * 4.0;
    float r = length(aOrigin.xz) + 0.001;
    float spin = t * (0.5 + b * 1.1) - r * 2.2;
    float angle = arm + spin;
    vec2 polar = vec2(cos(angle), sin(angle)) * (r + uEnergy * 0.2 * intens);
    pos.xz = polar;
    pos.y = aOrigin.y + sin(r * 12.0 + t * 4.5 + arm) * h * 0.18 * intens;
    pos.xz *= 1.0 + uBeat * 0.3 * intens;
    glow = m * 0.6 + h * 0.4;
  }
  // ─── Режим 6: Аудио-фонтан (Audio Geyser) ───
  else if (uMode < 6.5) {
    float lift = (b * 1.4 + uBeat * 0.8) * intens;
    float fall = mod(t * 1.5 + idx * 5.0, 1.0);
    pos.y += lift * (1.0 - fall * fall) * 1.8;
    pos.x += aNormal.x * fall * 0.6 * intens;
    pos.z += aNormal.z * fall * 0.6 * intens;
    glow = b;
  }
  // ─── Режим 7: Киматика (Cymatics Chladni) ───
  else {
    float n1 = sin(aOrigin.x * 6.0 + t * 2.0) * sin(aOrigin.z * 6.0 + t * 2.0);
    float n2 = sin(aOrigin.x * 12.0 - t * 3.0) * sin(aOrigin.z * 12.0 - t * 3.0);
    pos.y += (n1 * b + n2 * 0.5 * m) * intens * 0.9;
    glow = abs(n1) * b;
  }

  // Дополнительная турбулентность
  if (uTurbulence > 0.01) {
    vec3 turb = vec3(
      sin(pos.y * 8.0 + t * 5.0),
      sin(pos.z * 8.0 + t * 4.0),
      cos(pos.x * 8.0 + t * 6.0)
    );
    pos += turb * uTurbulence * (m * 0.2 + h * 0.3);
  }

  // Хроматический глитч при ударах
  if (uGlitch > 0.05 && uBeat > 0.4) {
    pos.x += sin(pos.y * 30.0 + t * 20.0) * uGlitch * 0.15;
  }

  // ─── Цветовые режимы ───────────────────────────────────────────────────
  vec3 col;
  if (uColorMode < 0.5) {
    // 0: Оригинальный цвет модели с динамической подсветкой
    float bright = 0.75 + uEnergy * 0.6 + uBeat * 0.4;
    col = aColor * bright;
  } else if (uColorMode < 1.5) {
    // 1: Частотный спектр (низкие -> средние -> высокие)
    float t2 = mod(idx + b * 0.25 + m * 0.15, 1.0);
    col = paletteColor(t2) * (0.8 + uEnergy * 0.5 + uBeat * 0.3);
  } else if (uColorMode < 2.5) {
    // 2: Плазма / Тепловой
    float heat = clamp(uEnergy * 0.8 + b * 0.4 + uBeat * 0.2, 0.0, 1.0);
    col = mix(vec3(0.08, 0.15, 0.95), vec3(0.98, 0.25, 0.05), heat);
    if (heat > 0.75) col = mix(col, vec3(1.0, 0.95, 0.8), (heat - 0.75) * 4.0);
  } else if (uColorMode < 3.5) {
    // 3: Киберпанк Неон (Cyan / Magenta / Electric Yellow)
    float phase = mod(idx * 2.0 + t * 0.1, 1.0);
    vec3 neonCyan = vec3(0.05, 0.95, 1.0);
    vec3 neonPink = vec3(1.0, 0.05, 0.85);
    vec3 neonGold = vec3(1.0, 0.85, 0.05);
    col = phase < 0.5 ? mix(neonCyan, neonPink, phase * 2.0) : mix(neonPink, neonGold, (phase - 0.5) * 2.0);
    col *= 0.8 + uBeat * 0.4;
  } else if (uColorMode < 4.5) {
    // 4: Монохромный минимализм
    float v = 0.65 + uEnergy * 0.45 + uBeat * 0.35;
    col = vec3(v);
  } else if (uColorMode < 5.5) {
    // 5: Радуга по времени и пространству
    float hh = mod(idx * 0.9 + t * 0.06, 1.0);
    col = hsl2rgb(hh, 0.95, 0.55 + uBeat * 0.15);
  } else {
    // 6: Аврора (Emerald / Violet / Deep Blue)
    vec3 c1 = vec3(0.05, 0.9, 0.6);
    vec3 c2 = vec3(0.5, 0.1, 0.95);
    vec3 c3 = vec3(0.1, 0.3, 0.95);
    float tA = mod(idx + sin(t * 0.5) * 0.2, 1.0);
    col = tA < 0.5 ? mix(c1, c2, tA * 2.0) : mix(c2, c3, (tA - 0.5) * 2.0);
    col *= 0.85 + uEnergy * 0.4;
  }

  vColor = col;
  vAlpha = 0.85 + glow * 0.15;
  vGlow = glow;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float s = uSize * uPR * (1.0 + glow * 0.7 + uBeat * 0.5);
  s *= 3.8 / max(-mv.z, 0.4);
  gl_PointSize = clamp(s, 0.5, 80.0);
}
`;

const musicFrag = /* glsl */`
precision highp float;
uniform float uShape;
varying vec3 vColor;
varying float vAlpha;
varying float vGlow;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);

  // 0: Круг со свечением
  if (uShape < 0.5) {
    if (r2 > 0.25) discard;
    float core = 1.0 - smoothstep(0.0, 0.25, r2);
    float glow = 1.0 - smoothstep(0.05, 0.25, r2);
    vec3 col = vColor * (core + glow * vGlow * 0.9);
    gl_FragColor = vec4(col, vAlpha * core);
  }
  // 1: 3D Сфера с объёмным светом
  else if (uShape < 1.5) {
    if (r2 > 0.25) discard;
    vec3 n = vec3(c.x * 2.0, -c.y * 2.0, sqrt(max(0.0, 1.0 - 4.0 * r2)));
    float l = max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
    vec3 col = vColor * (0.4 + 0.85 * l + vGlow * 0.5);
    gl_FragColor = vec4(col, vAlpha);
  }
  // 2: Звезда / Кристалл (Ромб)
  else if (uShape < 2.5) {
    if (abs(c.x) + abs(c.y) > 0.5) discard;
    float d = 1.0 - (abs(c.x) + abs(c.y)) * 2.0;
    vec3 col = vColor * (d + vGlow * 0.8);
    gl_FragColor = vec4(col, vAlpha);
  }
  // 3: Кольцо (Donut ring)
  else if (uShape < 3.5) {
    if (r2 > 0.25 || r2 < 0.06) discard;
    gl_FragColor = vec4(vColor * (1.0 + vGlow * 0.6), vAlpha);
  }
  // 4: Квадрат
  else {
    gl_FragColor = vec4(vColor * (1.0 + vGlow * 0.6), vAlpha);
  }

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ── 4. Основной класс MusicEngine ──────────────────────────────────────────

export class MusicEngine {
  constructor(app) {
    this.app = app;
    this.isolated = false;

    // Web Audio
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.freqData = null;

    // Источники звука
    this.audioBuffer = null;
    this.playing = false;
    this.paused = false;
    this.pauseOffset = 0;
    this.startedAt = 0;
    this.audioName = '';

    this.synth = null;
    this.micStream = null;
    this.activeSourceType = 'none'; // 'file' | 'synth' | 'mic' | 'none'

    // Параметры анализа
    this.fftSize = 2048;
    this.smoothing = 0.82;

    // Детектор битов
    this._beatHistory = new Float32Array(32).fill(0);
    this._beatIdx = 0;
    this._lastBeatTime = 0;
    this._beatLevel = 0;

    // Настройки
    this.settings = {
      mode: 0,          // 0..7
      colorMode: 1,     // 0..6
      shape: 0,         // 0..4
      intensity: 0.8,
      speed: 1.0,
      size: 4.5,
      bassGain: 1.3,
      midGain: 1.0,
      highGain: 1.0,
      turbulence: 0.15,
      gravity: 0.5,
      glitch: 0.2,
      autoRotate: true,
      rotateSpeed: 0.18,
      shockwaves: true, // Включение 3D ударных колец
      audioBeams: true, // Включение лучей
      palette: ['#e58a45', '#4f8ff0', '#62bb8c'],
    };

    // Three.js объекты
    this._points = null;
    this._material = null;
    this._geometry = null;
    this._fxGroup = null;
    this._rings = [];
    this._beams = null;

    // Анимационный цикл
    this._time = 0;
    this._autoYaw = 0;
    this._frameId = null;
    this._overlayCanvas = null;
    this._hudEl = null;

    // Сохранение состояния сцены до входа в режим
    this._savedSceneState = null;

    // Слушатели событий
    this._listeners = [];
  }

  // ── Звуковые методы ──────────────────────────────────────────────────────

  _ensureCtx() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = this.smoothing;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.synth = new ProceduralSynth(this.ctx, this.analyser);
  }

  /** Загрузка файла пользователя */
  async loadAudio(file) {
    this._ensureCtx();
    this.stop();
    const ab = await file.arrayBuffer();
    this.audioBuffer = await this.ctx.decodeAudioData(ab);
    this.audioName = file.name.replace(/\.[^.]+$/, '');
    this.activeSourceType = 'file';
    this._emit('audioLoaded', { name: this.audioName, duration: this.audioBuffer.duration });
  }

  /** Включение синтезатора */
  startSynth(mode = 'synthwave') {
    this._ensureCtx();
    this.stop();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.synth.start(mode);
    this.activeSourceType = 'synth';
    this.audioName = mode === 'cyberpunk' ? 'Cyberpunk Drum & Bass' : mode === 'ambient' ? 'Dream Ambient' : '80s Synthwave Beat';
    this.playing = true;
    this._emit('play');
  }

  /** Включение живого микрофона */
  async startMic() {
    this._ensureCtx();
    this.stop();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micSource = this.ctx.createMediaStreamSource(this.micStream);
      // Подключаем только к анализатору, НЕ к destination
      micSource.connect(this.analyser);
      this.source = micSource;
      this.activeSourceType = 'mic';
      this.audioName = 'Живой микрофон';
      this.playing = true;
      this._emit('play');
      return true;
    } catch (e) {
      console.warn('Микрофон недоступен:', e);
      throw e;
    }
  }

  /** Воспроизведение */
  play() {
    this._ensureCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume();

    if (this.activeSourceType === 'synth') {
      this.synth.start(this.synth.mode);
      this.playing = true;
      this._emit('play');
      return;
    }

    if (!this.audioBuffer) {
      // Если аудиофайла нет, автоматически запускаем красивый синтезатор
      this.startSynth('synthwave');
      return;
    }

    if (this.playing) return;
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    const offset = this.paused ? this.pauseOffset : 0;
    this.source.start(0, offset);
    this.startedAt = this.ctx.currentTime - offset;
    this.playing = true;
    this.paused = false;

    this.source.onended = () => {
      if (this.playing && this.activeSourceType === 'file') {
        this.playing = false;
        this._emit('ended');
      }
    };
    this._emit('play');
  }

  pause() {
    if (this.activeSourceType === 'synth') {
      this.synth.stop();
      this.playing = false;
      this.paused = true;
      this._emit('pause');
      return;
    }
    if (!this.playing) return;
    this.pauseOffset = this.ctx.currentTime - this.startedAt;
    try { this.source?.stop(); } catch (_) {}
    this.source = null;
    this.playing = false;
    this.paused = true;
    this._emit('pause');
  }

  stop() {
    if (this.synth) this.synth.stop();
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.source) {
      try { this.source.stop?.(); this.source.disconnect?.(); } catch (_) {}
      this.source = null;
    }
    this.playing = false;
    this.paused = false;
    this.pauseOffset = 0;
    this._emit('stop');
  }

  get currentTime() {
    if (!this.ctx) return 0;
    if (this.activeSourceType === 'file') {
      if (this.playing) return this.ctx.currentTime - this.startedAt;
      if (this.paused) return this.pauseOffset;
    }
    return 0;
  }

  seekTo(sec) {
    if (!this.audioBuffer || this.activeSourceType !== 'file') return;
    const wasPlaying = this.playing;
    this.stop();
    this.pauseOffset = Math.max(0, Math.min(sec, this.audioBuffer.duration));
    this.paused = true;
    if (wasPlaying) this.play();
  }

  /** Анализ частот текущего кадра */
  analyse() {
    if (!this.analyser || !this.playing) {
      return { bass: 0, mid: 0, high: 0, energy: 0, beat: 0, rawFreq: null };
    }
    this.analyser.getByteFrequencyData(this.freqData);
    const n = this.freqData.length;
    const s = this.settings;

    const bassEnd = Math.floor(n * 0.05); // 0..~550Hz
    const midEnd  = Math.floor(n * 0.25); // ~550..~2700Hz
    const highEnd = Math.floor(n * 0.70); // ~2700..~15kHz

    let bassSum = 0, midSum = 0, highSum = 0;
    for (let i = 0; i < bassEnd; i++) bassSum += this.freqData[i];
    for (let i = bassEnd; i < midEnd; i++) midSum += this.freqData[i];
    for (let i = midEnd; i < highEnd; i++) highSum += this.freqData[i];

    let bass = (bassSum / (bassEnd * 255)) * s.bassGain;
    let mid  = (midSum  / ((midEnd - bassEnd) * 255)) * s.midGain;
    let high = (highSum / ((highEnd - midEnd) * 255)) * s.highGain;

    bass = Math.min(1.2, bass);
    mid  = Math.min(1.2, mid);
    high = Math.min(1.2, high);

    const energy = bass * 0.5 + mid * 0.3 + high * 0.2;

    // Динамический детектор ударов (Beat Detection)
    this._beatHistory[this._beatIdx % this._beatHistory.length] = bass;
    this._beatIdx++;
    let avg = 0;
    for (let i = 0; i < this._beatHistory.length; i++) avg += this._beatHistory[i];
    avg /= this._beatHistory.length;

    const now = performance.now();
    if (bass > avg * 1.35 && bass > 0.3 && now - this._lastBeatTime > 200) {
      this._lastBeatTime = now;
      this._beatLevel = 1.0;
      this._triggerBeatFX(bass);
    }
    this._beatLevel *= 0.88;

    return { bass, mid, high, energy, beat: this._beatLevel, rawFreq: this.freqData };
  }

  // ── 3D Спецэффекты (FX) ─────────────────────────────────────────────────

  _triggerBeatFX(intensity) {
    if (!this.settings.shockwaves || !this._rings.length) return;
    // Находим свободное кольцо
    const ring = this._rings.find(r => !r.active);
    if (ring) {
      ring.active = true;
      ring.mesh.visible = true;
      ring.radius = 0.2;
      ring.maxRadius = 3.5 * (0.8 + intensity * 0.5);
      ring.opacity = 0.9;
      ring.speed = 0.08 * (1.0 + intensity * 0.5);
      ring.mesh.scale.set(0.2, 0.2, 0.2);
    }
  }

  _initFX() {
    this._fxGroup = new THREE.Group();
    this._fxGroup.name = '__musicFX';

    // 1. Пул ударных колец
    this._rings = [];
    const ringGeo = new THREE.RingGeometry(0.95, 1.0, 48);
    for (let i = 0; i < 5; i++) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(this.settings.palette[0]),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(ringGeo, ringMat);
      mesh.rotation.x = Math.PI / 2;
      mesh.visible = false;
      this._fxGroup.add(mesh);
      this._rings.push({ mesh, active: false, radius: 0.2, maxRadius: 3.5, opacity: 0, speed: 0.08 });
    }

    // 2. Аудио-лучи (Звезда в центре)
    const beamCount = 18;
    const beamPositions = new Float32Array(beamCount * 2 * 3);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPositions, 3));
    const beamMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(this.settings.palette[1]),
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._beams = new THREE.LineSegments(beamGeo, beamMat);
    this._beams.visible = this.settings.audioBeams;
    this._fxGroup.add(this._beams);

    this.app.viewport.scene.add(this._fxGroup);
  }

  _updateFX(freq) {
    if (!this._fxGroup) return;

    // Обновление ударных колец
    for (const r of this._rings) {
      if (!r.active) continue;
      r.radius += r.speed;
      r.opacity *= 0.94;
      const s = r.radius;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = r.opacity;
      r.mesh.material.color.set(this.settings.palette[0]);
      if (r.opacity < 0.02 || r.radius > r.maxRadius) {
        r.active = false;
        r.mesh.visible = false;
      }
    }

    // Обновление аудио-лучей
    if (this._beams && this.settings.audioBeams) {
      this._beams.visible = true;
      this._beams.material.color.set(this.settings.palette[1]);
      const pos = this._beams.geometry.attributes.position.array;
      const count = 18;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2 + this._time * 0.2;
        const phi = Math.sin(i * 1.5 + this._time * 0.3) * 0.5;
        const len = 0.4 + (freq.bass * 0.8 + freq.mid * 0.5) * (0.8 + Math.sin(i + this._time * 3.0) * 0.3);
        const idx = i * 6;
        pos[idx] = 0; pos[idx+1] = 0; pos[idx+2] = 0;
        pos[idx+3] = Math.cos(theta) * Math.cos(phi) * len;
        pos[idx+4] = Math.sin(phi) * len;
        pos[idx+5] = Math.sin(theta) * Math.cos(phi) * len;
      }
      this._beams.geometry.attributes.position.needsUpdate = true;
    } else if (this._beams) {
      this._beams.visible = false;
    }
  }

  _destroyFX() {
    if (this._fxGroup) {
      this.app.viewport.scene.remove(this._fxGroup);
      this._rings.forEach(r => {
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
      });
      this._rings = [];
      this._beams?.geometry.dispose();
      this._beams?.material.dispose();
      this._beams = null;
      this._fxGroup = null;
    }
  }

  // ── Запуск и выход из режима ─────────────────────────────────────────────

  startIsolated(sourceCloud) {
    if (this.isolated) return;
    this.isolated = true;

    // 1. Сохраняем состояние корневой модели и скрываем её
    const root = this.app.viewport.root;
    this._savedSceneState = {
      rootVisible: root.visible,
    };
    root.visible = false;

    // 2. Строим Three.js геометрию точек
    this._buildPoints(sourceCloud);

    // 3. Создаём 3D спецэффекты
    this._initFX();

    // 4. Создаём оверлеи
    this._buildOverlayCanvas();
    this._buildHUD();

    // 5. Авто-фокусировка камеры
    this._frameCloud();

    // 6. Запускаем анимационный цикл
    this._startLoop();

    this._emit('isolated', true);
  }

  stopIsolated() {
    if (!this.isolated) return;
    this.isolated = false;

    this.stop();
    this._stopLoop();
    this._destroyPoints();
    this._destroyFX();
    this._destroyOverlayCanvas();
    this._destroyHUD();

    // Восстанавливаем видимость исходной модели
    if (this._savedSceneState) {
      this.app.viewport.root.visible = this._savedSceneState.rootVisible;
      this._savedSceneState = null;
    }

    this.app.viewport.invalidate();
    this._emit('isolated', false);
  }

  _frameCloud() {
    if (!this._geometry) return;
    this._geometry.computeBoundingBox();
    const box = this._geometry.boundingBox;
    if (box && !box.isEmpty()) {
      const center = new THREE.Vector3();
      box.getCenter(center);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist = Math.max(sphere.radius * 2.4, 2.0);
      this.app.nav.animateTo({ target: new THREE.Vector3(0, 0, 0), distance: dist }, 350);
    }
  }

  _buildPoints(cloud) {
    const g = new THREE.BufferGeometry();
    const n = cloud.count;
    const origins = new Float32Array(cloud.positions);
    const idxArr = new Float32Array(n);
    for (let i = 0; i < n; i++) idxArr[i] = i / n;

    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cloud.positions), 3));
    g.setAttribute('aOrigin',  new THREE.BufferAttribute(origins, 3));
    g.setAttribute('aNormal',  new THREE.BufferAttribute(new Float32Array(cloud.normals), 3));
    g.setAttribute('aColor',   new THREE.BufferAttribute(new Float32Array(cloud.colors), 3));
    g.setAttribute('aIdx',     new THREE.BufferAttribute(idxArr, 1));

    const s = this.settings;
    const mat = new THREE.ShaderMaterial({
      vertexShader: musicVert,
      fragmentShader: musicFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime:       { value: 0 },
        uBass:       { value: 0 },
        uMid:        { value: 0 },
        uHigh:       { value: 0 },
        uEnergy:     { value: 0 },
        uBeat:       { value: 0 },
        uSize:       { value: s.size },
        uPR:         { value: Math.min(window.devicePixelRatio || 1, 2) },
        uMode:       { value: s.mode },
        uColorMode:  { value: s.colorMode },
        uShape:      { value: s.shape },
        uIntensity:  { value: s.intensity },
        uSpeed:      { value: s.speed },
        uBassGain:   { value: s.bassGain },
        uMidGain:    { value: s.midGain },
        uHighGain:   { value: s.highGain },
        uTurbulence: { value: s.turbulence },
        uGravity:    { value: s.gravity },
        uGlitch:     { value: s.glitch },
        uPalette0:   { value: new THREE.Color(s.palette[0]) },
        uPalette1:   { value: new THREE.Color(s.palette[1]) },
        uPalette2:   { value: new THREE.Color(s.palette[2]) },
      },
    });

    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;

    // Центрируем геометрию
    g.computeBoundingBox();
    const center = new THREE.Vector3();
    g.boundingBox.getCenter(center);
    pts.position.copy(center.negate());

    this._geometry = g;
    this._material = mat;
    this._points = pts;

    this.app.viewport.scene.add(pts);
  }

  _destroyPoints() {
    if (this._points) {
      this.app.viewport.scene.remove(this._points);
      this._geometry?.dispose();
      this._material?.dispose();
    }
    this._points = null;
    this._geometry = null;
    this._material = null;
  }

  _updateMaterial(freq) {
    if (!this._material) return;
    const u = this._material.uniforms;
    const s = this.settings;
    u.uTime.value       = this._time;
    u.uBass.value       = freq.bass;
    u.uMid.value        = freq.mid;
    u.uHigh.value       = freq.high;
    u.uEnergy.value     = freq.energy;
    u.uBeat.value       = freq.beat;
    u.uMode.value       = s.mode;
    u.uColorMode.value  = s.colorMode;
    u.uShape.value      = s.shape;
    u.uIntensity.value  = s.intensity;
    u.uSpeed.value      = s.speed;
    u.uSize.value       = s.size;
    u.uBassGain.value   = s.bassGain;
    u.uMidGain.value    = s.midGain;
    u.uHighGain.value   = s.highGain;
    u.uTurbulence.value = s.turbulence;
    u.uGravity.value    = s.gravity;
    u.uGlitch.value     = s.glitch;
    u.uPalette0.value.set(s.palette[0]);
    u.uPalette1.value.set(s.palette[1]);
    u.uPalette2.value.set(s.palette[2]);
  }

  // ── Визуальный спектрограф на Canvas ─────────────────────────────────────

  _buildOverlayCanvas() {
    let c = document.querySelector('#musicVuCanvas');
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'musicVuCanvas';
      c.style.cssText = 'position:absolute;left:0;bottom:0;width:100%;height:70px;pointer-events:none;z-index:4;opacity:0.8;';
      document.querySelector('.stage')?.appendChild(c);
    }
    this._overlayCanvas = c;
    this._resizeOverlay();
  }

  _destroyOverlayCanvas() {
    this._overlayCanvas?.remove();
    this._overlayCanvas = null;
  }

  _resizeOverlay() {
    const c = this._overlayCanvas;
    if (!c) return;
    const pr = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * pr;
    c.height = c.offsetHeight * pr;
  }

  _drawOverlay(freq) {
    const c = this._overlayCanvas;
    if (!c || !freq.rawFreq) return;
    const pr = window.devicePixelRatio || 1;
    if (c.width !== c.offsetWidth * pr) this._resizeOverlay();
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);

    const data = freq.rawFreq;
    const bars = 120;
    const barW = W / bars;
    const step = Math.floor(data.length / bars);

    for (let i = 0; i < bars; i++) {
      let v = 0;
      for (let j = 0; j < step; j++) v += data[i * step + j];
      v = (v / (step * 255));
      const bh = v * H * 0.92;
      const hue = (i / bars) * 260;
      ctx.fillStyle = `hsla(${hue}, 85%, 55%, 0.75)`;
      ctx.fillRect(i * barW, H - bh, barW - 1, bh);
    }
  }

  // ── Интерактивный HUD поверх Viewport ────────────────────────────────────

  _buildHUD() {
    this._destroyHUD();
    const hud = document.createElement('div');
    hud.className = 'music-hud';
    hud.innerHTML = `
      <div class="music-hud-bar">
        <div class="music-hud-track">
          <span class="music-hud-badge" id="hudBadge">🎵</span>
          <span class="music-hud-title" id="hudTitle">${this.audioName || 'Готово к запуску'}</span>
        </div>
        <div class="music-hud-controls">
          <button type="button" class="btn btn-icon hud-btn" id="hudPlayBtn" title="Воспроизведение (Пробел)">
            <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3l144.08,88.14A15.74,15.74,0,0,1,240,128Z"/></svg>
          </button>
          <button type="button" class="btn btn-icon hud-btn" id="hudRotateBtn" title="Авто-вращение" aria-pressed="${this.settings.autoRotate}">
            <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.41,61.27a96,96,0,0,1,135,.79L208,76.69V48a8,8,0,0,1,16,0Z"/></svg>
          </button>
          <button type="button" class="btn btn-icon hud-btn" id="hudCloseBtn" title="Закрыть музыкальный режим (Esc)">
            <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>
          </button>
        </div>
      </div>
    `;

    document.querySelector('.stage')?.appendChild(hud);
    this._hudEl = hud;

    hud.querySelector('#hudPlayBtn')?.addEventListener('click', () => {
      if (this.playing) this.pause();
      else this.play();
      this._updateHUD();
    });

    hud.querySelector('#hudRotateBtn')?.addEventListener('click', () => {
      this.settings.autoRotate = !this.settings.autoRotate;
      hud.querySelector('#hudRotateBtn').setAttribute('aria-pressed', String(this.settings.autoRotate));
    });

    hud.querySelector('#hudCloseBtn')?.addEventListener('click', () => {
      this.stopIsolated();
    });

    this._updateHUD();
  }

  _updateHUD() {
    if (!this._hudEl) return;
    const badge = this._hudEl.querySelector('#hudBadge');
    const title = this._hudEl.querySelector('#hudTitle');
    const playBtn = this._hudEl.querySelector('#hudPlayBtn');

    if (badge) {
      badge.textContent = this.activeSourceType === 'mic' ? '🎤' : this.activeSourceType === 'synth' ? '🎹' : '🎵';
    }
    if (title) {
      title.textContent = this.audioName || 'Готово к запуску';
    }
    if (playBtn) {
      if (this.playing) {
        playBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM112,48V208a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V48A16,16,0,0,1,56,32H96A16,16,0,0,1,112,48Z"/></svg>`;
      } else {
        playBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3l144.08,88.14A15.74,15.74,0,0,1,240,128Z"/></svg>`;
      }
    }
  }

  _destroyHUD() {
    this._hudEl?.remove();
    this._hudEl = null;
  }

  // ── Анимационный цикл ────────────────────────────────────────────────────

  _startLoop() {
    if (this._frameId !== null) return;
    const vp = this.app.viewport;

    const loop = () => {
      if (!this.isolated) return;
      this._frameId = requestAnimationFrame(loop);

      const freq = this.analyse();
      this._time += 0.016 * this.settings.speed;

      // Авто-вращение
      if (this.settings.autoRotate && this._points) {
        this._autoYaw += 0.016 * this.settings.rotateSpeed;
        this._points.rotation.y = this._autoYaw;
        this._points.rotation.x = Math.sin(this._time * 0.25) * 0.06;
      }

      this._updateMaterial(freq);
      this._updateFX(freq);
      this._drawOverlay(freq);

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

  on(event, fn) {
    this._listeners.push({ event, fn });
    return () => { this._listeners = this._listeners.filter(x => x.fn !== fn); };
  }

  _emit(event, data) {
    for (const { event: e, fn } of this._listeners) if (e === event) fn(data);
    this._updateHUD();
  }

  dispose() {
    this.stopIsolated();
    this.ctx?.close();
    this.ctx = null;
  }
}
