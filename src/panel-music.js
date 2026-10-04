/**
 * panel-music.js — панель настроек музыкального режима в OBJ-to-GLB.
 * Организована по секциям:
 * 1. Главный запуск режима и статус
 * 2. Источник аудио (Файл, Демо-синтезатор, Микрофон)
 * 3. Источник 3D-точек (Сцена, Загрузка GLB, 8 Примитивов)
 * 4. Режимы движения и физика взаимодействия точек
 * 5. 3D-спецэффекты (Ударные кольца, Лазерные лучи, Глитч)
 * 6. Цветовые палитры и форма точек
 */
import { h, formatInt } from './util.js';
import { section, field, slider, segmented, switchRow, button } from './ui-kit.js';
import { sampleSurface } from './pointcloud.js';
import { generatePrimitive } from './music-engine.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PRIMITIVES = [
  { value: 'sphere',   label: 'Сфера' },
  { value: 'torus',    label: 'Тор' },
  { value: 'cube',     label: 'Куб' },
  { value: 'cylinder', label: 'Цилиндр' },
  { value: 'helix',    label: 'ДНК-спираль' },
  { value: 'saturn',   label: 'Кольца Сатурна' },
  { value: 'mobius',   label: 'Лента Мёбиуса' },
  { value: 'plane',    label: 'Плоскость' },
];

const MODES = [
  { value: 0, label: 'Взрыв',     title: 'Точки взрываются вдоль нормалей на бас-ударах' },
  { value: 1, label: 'Волна',     title: 'Синусоидальные стоячие волны по осям' },
  { value: 2, label: 'Вихрь',     title: 'Турбулентная воронка, ускоряющаяся на дропах' },
  { value: 3, label: 'Пульс',     title: 'Радиальные акустические импульсы из центра' },
  { value: 4, label: 'Орбита',    title: 'Точки вращаются на орбиталях с наклоном плоскостей' },
  { value: 5, label: 'Галактика', title: 'Спиральные галактические рукава с кластеризацией' },
  { value: 6, label: 'Фонтан',    title: 'Аудио-гейзер: частицы взлетают вверх и опадают' },
  { value: 7, label: 'Киматика',  title: 'Эффект стоячих волн Хладни на поверхности' },
];

const POINT_SHAPES = [
  { value: 0, label: 'Круг' },
  { value: 1, label: '3D Шар' },
  { value: 2, label: 'Кристалл' },
  { value: 3, label: 'Кольцо' },
  { value: 4, label: 'Квадрат' },
];

const COLOR_MODES = [
  { value: 1, label: 'Спектр',   title: 'Цвета кодируют частоты: бас, середина, верха' },
  { value: 0, label: 'Модель',   title: 'Цвета оригинальной 3D-модели с подсветкой энергией' },
  { value: 2, label: 'Плазма',   title: 'Тепловой градиент от синего к огненно-белому' },
  { value: 3, label: 'Киберпанк',title: 'Неоновый градиент: Cyan, Magenta, Gold' },
  { value: 6, label: 'Аврора',   title: 'Северное сияние: изумрудный, фиолетовый, индиго' },
  { value: 5, label: 'Радуга',   title: 'Динамический спектральный перелив' },
  { value: 4, label: 'Моно',     title: 'Белый футуристичный минимализм' },
];

const PALETTE_PRESETS = [
  { label: 'Закат',     colors: ['#e58a45', '#e0304a', '#4f3acf'] },
  { label: 'Киберпанк', colors: ['#00f0ff', '#ff0077', '#ffe600'] },
  { label: 'Океан',     colors: ['#1a8fe3', '#1ad0c8', '#0a2e5a'] },
  { label: 'Аврора',    colors: ['#00ff9d', '#9900ff', '#0066ff'] },
  { label: 'Пламя',     colors: ['#ff3300', '#ff9900', '#ffee00'] },
  { label: 'Неон',      colors: ['#ff00ff', '#00ffff', '#39ff14'] },
];

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function createMusicPanel(app, root, engine) {
  const s = engine.settings;
  let currentCloud = null;
  let currentSourceType = 'sphere';
  let targetPointCount = 120000;
  let progressTimer = null;

  // ── 1. Секция запуска ───────────────────────────────────────────────────

  const launchBtn = button({
    label: 'Запустить музыкальный режим',
    icon: 'waveform',
    variant: 'primary',
    cls: 'btn-block music-launch-btn',
    onClick: () => toggleLaunch(),
  });

  const launchHint = h('div', { class: 'field-hint' },
    'Запускает полноэкранный 3D-визуализатор. Если аудиофайл не загружен, автоматически включится встроенный демо-синтезатор Synthwave!');

  function toggleLaunch() {
    if (engine.isolated) {
      engine.stopIsolated();
    } else {
      if (!currentCloud) {
        currentCloud = generatePrimitive('sphere', targetPointCount);
        cloudStatus.textContent = `Сфера (${formatInt(currentCloud.count)} точек)`;
      }
      engine.startIsolated(currentCloud);
      if (!engine.playing) {
        engine.play();
      }
    }
    syncLaunchUI();
  }

  function syncLaunchUI() {
    const lbl = launchBtn.querySelector('.btn-label');
    if (lbl) lbl.textContent = engine.isolated ? 'Остановить музыкальный режим' : 'Запустить музыкальный режим';
    launchBtn.classList.toggle('btn-danger', engine.isolated);
    launchBtn.classList.toggle('btn-primary', !engine.isolated);
  }

  engine.on('isolated', () => syncLaunchUI());

  const secLaunch = section('Музыкальный режим', { key: 'm-launch' },
    launchHint,
    launchBtn,
  );

  // ── 2. Источник аудио ────────────────────────────────────────────────────

  const audioTypeSeg = segmented({
    options: [
      { value: 'synth', label: 'Синтезатор', title: 'Встроенный процедурный электронный бит' },
      { value: 'file',  label: 'Аудиофайл',  title: 'Загрузить свой трек (MP3, WAV, FLAC, OGG)' },
      { value: 'mic',   label: 'Микрофон',   title: 'Живой захват с микрофона' },
    ],
    value: 'synth',
    cls: 'seg-wrap',
    onChange: v => switchAudioType(v),
  });

  // Панель для файлов
  const fileInput = h('input', { type: 'file', accept: 'audio/*', hidden: true });
  document.body.appendChild(fileInput);

  const btnFileSelect = button({
    label: 'Выбрать аудиофайл',
    icon: 'music-notes',
    variant: 'secondary',
    cls: 'btn-block',
    onClick: () => fileInput.click(),
  });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    fileInput.value = '';
    try {
      app.ui.busy('Декодирую аудиофайл…');
      await engine.loadAudio(f);
      trackNameEl.textContent = f.name.replace(/\.[^.]+$/, '');
      trackDurEl.textContent = fmtTime(engine.audioBuffer.duration);
      app.ui.idle();
      updatePlayControls();
      app.toast('Аудио готово: ' + f.name, 'ok', 2000);
      if (engine.isolated) engine.play();
    } catch (e) {
      app.ui.idle();
      app.toast('Ошибка аудио: ' + e.message, 'error');
    }
  });

  // Панель для синтезатора
  const synthModeSeg = segmented({
    options: [
      { value: 'synthwave', label: '80s Synthwave (124 BPM)' },
      { value: 'cyberpunk', label: 'Cyberpunk DnB (138 BPM)' },
      { value: 'ambient',   label: 'Chill Ambient (95 BPM)' },
    ],
    value: 'synthwave',
    onChange: v => {
      if (engine.activeSourceType === 'synth' && engine.playing) {
        engine.startSynth(v);
      }
    },
  });

  // Панель для микрофона
  const micNotice = h('div', { class: 'field-hint' },
    'Подключите микрофон, чтобы точки танцевали под ваш голос, хлопки или внешнюю музыку из колонок.');

  const btnToggleMic = button({
    label: 'Включить микрофон',
    icon: 'speaker-high',
    variant: 'secondary',
    cls: 'btn-block',
    onClick: async () => {
      try {
        await engine.startMic();
        trackNameEl.textContent = 'Живой микрофон';
        trackDurEl.textContent = 'Live Audio';
        btnToggleMic.querySelector('.btn-label').textContent = 'Микрофон активен ✓';
        btnToggleMic.classList.add('btn-primary');
        app.toast('Микрофон подключен!', 'ok', 2000);
      } catch (err) {
        app.toast('Доступ к микрофону отклонен', 'warn', 3000);
      }
    },
  });

  const fileBox  = h('div', { class: 'music-source-box', hidden: true }, btnFileSelect);
  const synthBox = h('div', { class: 'music-source-box' }, synthModeSeg.el);
  const micBox   = h('div', { class: 'music-source-box', hidden: true }, micNotice, btnToggleMic);

  function switchAudioType(type) {
    fileBox.hidden = type !== 'file';
    synthBox.hidden = type !== 'synth';
    micBox.hidden = type !== 'mic';

    if (type === 'synth') {
      engine.startSynth(synthModeSeg.el.querySelector('[aria-checked="true"]')?.dataset?.val || 'synthwave');
    } else if (type === 'file') {
      if (!engine.audioBuffer) {
        fileInput.click();
      } else {
        engine.activeSourceType = 'file';
      }
    }
    updatePlayControls();
  }

  // Общий плеер (Transport bar)
  const trackNameEl = h('div', { class: 'music-track-name' }, '80s Synthwave Beat');
  const trackDurEl  = h('div', { class: 'music-track-dur' }, 'Встроенный синтезатор');

  const btnPlay = button({
    label: 'Воспроизвести',
    icon: 'play',
    variant: 'primary',
    onClick: () => {
      if (engine.playing) engine.pause();
      else engine.play();
      updatePlayControls();
    },
  });

  const btnStop = button({
    label: 'Стоп',
    icon: 'stop',
    variant: 'secondary',
    onClick: () => {
      engine.stop();
      updatePlayControls();
    },
  });

  const progressBar = h('div', { class: 'music-progress' });
  const progressFill = h('div', { class: 'music-progress-fill' });
  const progressTime = h('div', { class: 'music-progress-time' }, '0:00 / 0:00');
  progressBar.appendChild(progressFill);

  progressBar.addEventListener('click', e => {
    if (!engine.audioBuffer || engine.activeSourceType !== 'file') return;
    const r = progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    engine.seekTo(ratio * engine.audioBuffer.duration);
    syncProgress();
  });

  function syncProgress() {
    if (engine.activeSourceType === 'file' && engine.audioBuffer) {
      const dur = engine.audioBuffer.duration || 0;
      const cur = engine.currentTime;
      const pct = dur > 0 ? (cur / dur * 100).toFixed(1) : 0;
      progressFill.style.width = pct + '%';
      progressTime.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
      progressBar.hidden = false;
      progressTime.hidden = false;
    } else {
      progressBar.hidden = true;
      progressTime.hidden = true;
    }
  }

  function updatePlayControls() {
    const lbl = btnPlay.querySelector('.btn-label');
    if (lbl) lbl.textContent = engine.playing ? 'Пауза' : (engine.paused ? 'Продолжить' : 'Воспроизвести');
  }

  engine.on('play', () => {
    updatePlayControls();
    if (!progressTimer) progressTimer = setInterval(syncProgress, 250);
  });
  engine.on('pause', () => { updatePlayControls(); });
  engine.on('stop', () => {
    updatePlayControls();
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    syncProgress();
  });
  engine.on('ended', () => {
    updatePlayControls();
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    syncProgress();
  });

  const trackRow = h('div', { class: 'music-track-row' },
    h('div', { class: 'music-track-info' }, trackNameEl, trackDurEl),
    h('div', { class: 'music-transport' }, btnPlay, btnStop)
  );

  const secAudio = section('Источник звука', { key: 'm-audio' },
    audioTypeSeg.el,
    synthBox, fileBox, micBox,
    trackRow,
    h('div', { class: 'music-progress-wrap' }, progressBar, progressTime)
  );

  // ── 3. Источник 3D-точек ──────────────────────────────────────────────────

  const glbInput = h('input', { type: 'file', accept: '.glb,.gltf,.obj,.stl,.ply', hidden: true });
  document.body.appendChild(glbInput);

  const pointCountSlider = slider({
    log: true, min: 10000, max: 400000, step: 10000, value: targetPointCount,
    format: v => formatInt(v),
    onInput: v => { targetPointCount = Math.round(v); },
    onChange: () => { applyCloud(); },
  });

  const srcOptions = [
    { value: 'scene', label: 'Текущая модель' },
    ...PRIMITIVES.map(p => ({ value: p.value, label: p.label })),
    { value: 'file',  label: 'Загрузить файл' },
  ];

  const srcSeg = segmented({
    options: srcOptions,
    value: currentSourceType,
    cls: 'seg-wrap',
    onChange: v => {
      currentSourceType = v;
      if (v === 'file') {
        glbInput.click();
      } else {
        applyCloud();
      }
    },
  });

  const cloudStatus = h('div', { class: 'field-hint' }, 'Сфера (120 000 точек)');

  glbInput.addEventListener('change', async () => {
    const f = glbInput.files[0];
    if (!f) return;
    glbInput.value = '';
    await load3DFile(f);
  });

  async function load3DFile(file) {
    try {
      app.ui.busy('Загружаю 3D-модель…', 0.2);
      const ext = file.name.split('.').pop().toLowerCase();
      let entries = [];

      if (ext === 'glb' || ext === 'gltf') {
        const loader = new GLTFLoader();
        const buf = await file.arrayBuffer();
        const gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej));
        const meshes = [];
        gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
        if (!meshes.length) throw new Error('В файле нет 3D-мешей');
        entries = meshes.map(m => ({ mesh: m, mats: m.material }));
      } else {
        // Загрузка через встроенный импорт приложения
        await app.ui.handleFiles([file], { mode: 'replace' });
        const meshes = app.model.meshes();
        entries = meshes.map(m => ({ mesh: m, mats: app.display.getOriginal(m) }));
      }

      currentCloud = await sampleSurface(entries, targetPointCount, {
        onProgress: p => app.ui.busy('Создаю облако точек…', 0.2 + p * 0.75),
      });

      cloudStatus.textContent = `${file.name} (${formatInt(currentCloud.count)} точек)`;
      app.ui.idle();
      app.toast(`Облако точек создано: ${formatInt(currentCloud.count)}`, 'ok', 2000);

      if (engine.isolated) {
        engine.stopIsolated();
        engine.startIsolated(currentCloud);
      }
    } catch (e) {
      app.ui.idle();
      app.toast('Не удалось создать облако: ' + e.message, 'error');
    }
  }

  async function applyCloud() {
    const type = currentSourceType;
    try {
      if (type === 'scene') {
        const meshes = app.model.meshes().filter(m => app.viewport.isVisibleInTree(m));
        if (!meshes.length) {
          app.toast('Сцена пуста! Откройте модель или выберите примитив', 'warn', 3000);
          return;
        }
        app.ui.busy('Строю облако из сцены…', 0.1);
        const entries = meshes.map(m => ({ mesh: m, mats: app.display.getOriginal(m) }));
        currentCloud = await sampleSurface(entries, targetPointCount, {
          onProgress: p => app.ui.busy('Строю облако…', 0.1 + p * 0.85),
        });
        cloudStatus.textContent = `Модель сцены (${formatInt(currentCloud.count)} точек)`;
        app.ui.idle();
      } else if (type !== 'file') {
        currentCloud = generatePrimitive(type, targetPointCount);
        const name = PRIMITIVES.find(p => p.value === type)?.label || type;
        cloudStatus.textContent = `${name} (${formatInt(currentCloud.count)} точек)`;
      }

      if (engine.isolated && currentCloud) {
        engine.stopIsolated();
        engine.startIsolated(currentCloud);
      }
    } catch (e) {
      app.ui.idle();
      app.toast('Ошибка построения: ' + e.message, 'error');
    }
  }

  const secSource = section('Форма и 3D-модель', { key: 'm-source' },
    h('div', { class: 'field-hint' }, 'Выберите базовую форму для облака: модель из сцены, файл с диска или математический примитив.'),
    srcSeg.el,
    field('Количество точек', pointCountSlider.el),
    cloudStatus,
  );

  // ── 4. Режимы движения и физика ──────────────────────────────────────────

  const modeSeg = segmented({
    options: MODES.map(m => ({ value: String(m.value), label: m.label, title: m.title })),
    value: String(s.mode),
    cls: 'seg-wrap',
    onChange: v => { s.mode = Number(v); },
  });

  const intensSlider = slider({
    min: 0, max: 2.5, step: 0.05, value: s.intensity, digits: 2,
    onInput: v => { s.intensity = v; },
  });

  const speedSlider = slider({
    min: 0.1, max: 3.5, step: 0.1, value: s.speed, digits: 1,
    onInput: v => { s.speed = v; },
  });

  const bassSlider = slider({
    min: 0, max: 3.0, step: 0.05, value: s.bassGain, digits: 2,
    onInput: v => { s.bassGain = v; },
  });

  const midSlider = slider({
    min: 0, max: 3.0, step: 0.05, value: s.midGain, digits: 2,
    onInput: v => { s.midGain = v; },
  });

  const highSlider = slider({
    min: 0, max: 3.0, step: 0.05, value: s.highGain, digits: 2,
    onInput: v => { s.highGain = v; },
  });

  const turbSlider = slider({
    min: 0, max: 1.0, step: 0.02, value: s.turbulence, digits: 2,
    onInput: v => { s.turbulence = v; },
  });

  const autoRotateRow = switchRow('Авто-вращение камеры', {
    value: s.autoRotate,
    onChange: v => { s.autoRotate = v; },
  });

  const rotSpeedSlider = slider({
    min: 0, max: 0.8, step: 0.01, value: s.rotateSpeed, digits: 2,
    onInput: v => { s.rotateSpeed = v; },
  });

  const secMotion = section('Движение и реакция на звук', { key: 'm-motion' },
    field('Режим анимации', modeSeg.el, { wide: true }),
    field('Амплитуда разлёта', intensSlider.el),
    field('Скорость волн', speedSlider.el),
    field('Отклик на бас (Kick)', bassSlider.el),
    field('Отклик на середину', midSlider.el),
    field('Отклик на верха (Shimmer)', highSlider.el),
    field('Турбулентный шум', turbSlider.el),
    autoRotateRow.el,
    field('Скорость вращения', rotSpeedSlider.el),
  );

  // ── 5. 3D Спецэффекты (FX) ───────────────────────────────────────────────

  const shockwavesRow = switchRow('Ударные кольца (Shockwaves)', {
    value: s.shockwaves,
    onChange: v => { s.shockwaves = v; },
  }, 'При ударе бочки из центра расходятся расширяющиеся светящиеся звуковые волны');

  const beamsRow = switchRow('Аудио-лучи из центра', {
    value: s.audioBeams,
    onChange: v => { s.audioBeams = v; },
  }, 'Пульсирующие лазерные лучи эквалайзера в ядре модели');

  const glitchSlider = slider({
    min: 0, max: 1.0, step: 0.05, value: s.glitch, digits: 2,
    onInput: v => { s.glitch = v; },
  });

  const secFX = section('3D-спецэффекты и фильтры', { key: 'm-fx' },
    shockwavesRow.el,
    beamsRow.el,
    field('Хроматический глитч', glitchSlider.el, { hint: 'Расщепление точек на RGB при пиках энергии' }),
  );

  // ── 6. Цвета и форма точек ───────────────────────────────────────────────

  const shapeSeg = segmented({
    options: POINT_SHAPES.map(sh => ({ value: String(sh.value), label: sh.label })),
    value: String(s.shape),
    cls: 'seg-wrap',
    onChange: v => { s.shape = Number(v); },
  });

  const colorSeg = segmented({
    options: COLOR_MODES.map(m => ({ value: String(m.value), label: m.label, title: m.title })),
    value: String(s.colorMode),
    cls: 'seg-wrap',
    onChange: v => { s.colorMode = Number(v); },
  });

  const sizeSlider = slider({
    min: 1, max: 16, step: 0.5, value: s.size, digits: 1, unit: ' px',
    onInput: v => { s.size = v; },
  });

  // Пресеты палитр
  const palPresets = h('div', { class: 'presets' });
  for (const p of PALETTE_PRESETS) {
    const b = h('button', { type: 'button', class: 'btn' }, p.label);
    b.addEventListener('click', () => {
      s.palette = [...p.colors];
      syncPaletteInputs();
    });
    palPresets.appendChild(b);
  }

  const palInputs = s.palette.map((c, i) => {
    const inp = h('input', { type: 'color', value: c, class: 'music-color-input' });
    inp.addEventListener('input', () => { s.palette[i] = inp.value; });
    return inp;
  });

  function syncPaletteInputs() {
    palInputs.forEach((inp, i) => { inp.value = s.palette[i]; });
  }

  const secVisuals = section('Вид точек и палитра', { key: 'm-visuals' },
    field('Форма точки', shapeSeg.el, { wide: true }),
    field('Размер точек', sizeSlider.el),
    field('Цветовая схема', colorSeg.el, { wide: true }),
    h('div', { class: 'field-hint' }, 'Пресеты спектральной палитры:'),
    palPresets,
    h('div', { class: 'music-palette-inputs' }, ...palInputs),
  );

  // Собираем панель в DOM
  root.append(
    secLaunch.el,
    secAudio.el,
    secSource.el,
    secMotion.el,
    secFX.el,
    secVisuals.el,
  );

  return {
    refresh() {
      syncLaunchUI();
      updatePlayControls();
      syncProgress();
    },
  };
}
