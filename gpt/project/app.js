/* player.js — controller: mutes original video, syncs procedural BGM (or a user file). */
(function () {
  'use strict';

  const DURATION = 60;
  const SCENES = [
    { t: 0,  name: '더 완성된 진화',          tag: 'INTRO',                  bgm: 'Premium clean electronic tone',   intensity: 0.78 },
    { t: 12, name: '커버 컬러의 진화',         tag: 'SCENE 2 · FEATURE 01',   bgm: 'Warm premium electronic pulse',   intensity: 0.86 },
    { t: 21, name: 'UV 케어 업그레이드',       tag: 'SCENE 3 · FEATURE 02',   bgm: 'Clean sparkle + futuristic tone', intensity: 0.96 },
    { t: 25, name: '잔수 문제 억제',           tag: 'SCENE 4 · FEATURE 03',   bgm: 'Soft water drop + ambient',       intensity: 0.80 },
    { t: 34, name: '서징 현상 해소',           tag: 'SCENE 5 · FEATURE 04',   bgm: 'Smooth flow + confident pulse',   intensity: 0.90 },
    { t: 43, name: '출수 코크 소재 업그레이드', tag: 'SCENE 6 · FEATURE 05',   bgm: 'Clean premium tone',              intensity: 0.86 },
    { t: 49, name: '기술의 차이가 가치의 차이', tag: 'SCENE 7 · CLOSING',      bgm: 'Brand signature ending',          intensity: 1.0 },
  ];
  const PRESET_LABEL = { bright: '밝고 경쾌', warm: '따뜻한 프리미엄', energetic: '역동적 임팩트' };

  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const engine = new window.BGMEngine();

  const state = {
    preset: 'bright',
    mode: 'gen',          // 'gen' | 'file'
    volume: 0.8,
    sceneIdx: -1,
  };
  let userAudio = null;   // HTMLAudioElement for custom track
  let userURL = null;

  // ---- persistence ---------------------------------------------------------
  const LS = 'ep7000n_bgm_v1';
  function save() {
    try { localStorage.setItem(LS, JSON.stringify({
      preset: state.preset, volume: state.volume, mode: state.mode, time: video.currentTime,
    })); } catch (e) {}
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; }
  }

  // ---- helpers -------------------------------------------------------------
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function sceneAt(t) { let i = 0; for (let k = 0; k < SCENES.length; k++) if (t >= SCENES[k].t) i = k; return i; }
  function sceneEnd(i) { return i < SCENES.length - 1 ? SCENES[i + 1].t : DURATION; }

  // ---- build scene UI ------------------------------------------------------
  const ticks = $('ticks'), sceneList = $('sceneList');
  SCENES.forEach((s, i) => {
    if (i > 0) { const tk = document.createElement('div'); tk.className = 'tick'; tk.style.left = (s.t / DURATION * 100) + '%'; ticks.appendChild(tk); }
    const row = document.createElement('div'); row.className = 'sc'; row.dataset.i = i;
    row.innerHTML = '<div class="bar"></div><div class="tm">' + fmt(s.t) + '</div>' +
      '<div class="info"><div class="nm">' + s.name + '</div><div class="bg">♪ ' + s.bgm + '</div></div>';
    row.addEventListener('click', () => { seekTo(s.t + 0.05); });
    sceneList.appendChild(row);
  });
  const sceneRows = [...sceneList.children];

  // ---- transport -----------------------------------------------------------
  const overlay = $('overlay'), playIcon = $('playIcon');
  const PLAY = '<path d="M0 1.5C0 .4 1.2-.2 2.1.4l15 9c.9.5.9 1.7 0 2.2l-15 9C1.2 20.2 0 19.6 0 18.5v-17z"/>';
  const PAUSE = '<rect x="1" y="1" width="5.5" height="18" rx="1.4"/><rect x="11.5" y="1" width="5.5" height="18" rx="1.4"/>';

  function isFile() { return state.mode === 'file' && userAudio; }

  function startAudio() {
    if (isFile()) {
      try { userAudio.currentTime = video.currentTime; } catch (e) {}
      userAudio.volume = state.volume; userAudio.play().catch(() => {});
    } else {
      engine.setVolume(state.volume);
      engine.start(video.currentTime);
      applyScene(true);
    }
  }
  function stopAudio() {
    engine.stop();
    if (userAudio) userAudio.pause();
  }

  function play() {
    video.play().then(() => { startAudio(); }).catch(() => {});
  }
  function pause() { video.pause(); }

  $('play').addEventListener('click', () => { video.paused ? play() : pause(); });
  overlay.addEventListener('click', () => play());

  video.addEventListener('play', () => {
    overlay.classList.add('hidden'); playIcon.innerHTML = PAUSE;
  });
  video.addEventListener('pause', () => {
    playIcon.innerHTML = PLAY; stopAudio();
    if (video.currentTime < DURATION - 0.2) overlay.classList.remove('hidden');
  });
  video.addEventListener('ended', () => { stopAudio(); overlay.classList.remove('hidden'); save(); });

  // ---- seeking -------------------------------------------------------------
  function seekTo(t) {
    t = Math.max(0, Math.min(DURATION - 0.05, t));
    video.currentTime = t;
    if (!video.paused) { if (isFile()) { try { userAudio.currentTime = t; } catch (e) {} } else { engine.seek(t); } }
    updateUI(t);
    applyScene(true);
  }
  const scrub = $('scrub');
  let dragging = false;
  function scrubToEvent(e) {
    const r = scrub.getBoundingClientRect();
    const x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width;
    seekTo(Math.max(0, Math.min(1, x)) * DURATION);
  }
  scrub.addEventListener('mousedown', (e) => { dragging = true; scrubToEvent(e); });
  window.addEventListener('mousemove', (e) => { if (dragging) scrubToEvent(e); });
  window.addEventListener('mouseup', () => { dragging = false; });
  scrub.addEventListener('touchstart', (e) => { dragging = true; scrubToEvent(e); }, { passive: true });
  scrub.addEventListener('touchmove', (e) => { if (dragging) scrubToEvent(e); }, { passive: true });
  scrub.addEventListener('touchend', () => { dragging = false; });

  // ---- preset --------------------------------------------------------------
  const presetSeg = $('presetSeg'), audioFlag = $('audioFlag');
  presetSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setPreset(b.dataset.p);
  });
  function setPreset(p) {
    state.preset = p;
    [...presetSeg.children].forEach((b) => b.classList.toggle('active', b.dataset.p === p));
    engine.setPreset(p);
    updateFlag();
    save();
  }

  // ---- volume --------------------------------------------------------------
  $('vol').addEventListener('input', (e) => {
    state.volume = e.target.value / 100;
    engine.setVolume(state.volume);
    if (userAudio) userAudio.volume = state.volume;
    save();
  });

  // ---- mode + file ---------------------------------------------------------
  const modeSwitch = $('modeSwitch'), drop = $('drop'), fileInput = $('fileInput'), fileName = $('fileName');
  modeSwitch.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.m === 'file' && !userAudio) { fileInput.click(); return; }
    setMode(b.dataset.m);
  });
  function setMode(m) {
    state.mode = m;
    [...modeSwitch.children].forEach((b) => b.classList.toggle('active', b.dataset.m === m));
    presetSeg.style.opacity = m === 'gen' ? '1' : '.4';
    presetSeg.style.pointerEvents = m === 'gen' ? 'auto' : 'none';
    if (!video.paused) { stopAudio(); startAudio(); }
    updateFlag();
    save();
  }
  function updateFlag() {
    audioFlag.textContent = state.mode === 'file'
      ? '♪ 내 음원'
      : '♪ 생성 BGM · ' + PRESET_LABEL[state.preset];
  }

  function loadFile(file) {
    if (!file) return;
    if (userURL) URL.revokeObjectURL(userURL);
    userURL = URL.createObjectURL(file);
    if (!userAudio) { userAudio = new Audio(); userAudio.preload = 'auto'; }
    userAudio.src = userURL; userAudio.volume = state.volume;
    fileName.textContent = '✓ ' + file.name;
    setMode('file');
  }
  fileInput.addEventListener('change', (e) => loadFile(e.target.files[0]));
  drop.addEventListener('click', () => fileInput.click());
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

  // ---- scene application ---------------------------------------------------
  function applyScene(force) {
    const i = sceneAt(video.currentTime);
    if (i === state.sceneIdx && !force) return;
    state.sceneIdx = i;
    const s = SCENES[i];
    $('sceneChip').textContent = s.tag;
    $('nowName').textContent = s.name;
    sceneRows.forEach((r, k) => r.classList.toggle('active', k === i));
    if (state.mode === 'gen' && !video.paused) engine.setScene(s.intensity);
  }

  // ---- UI sync loop --------------------------------------------------------
  function updateUI(t) {
    t = (t == null) ? video.currentTime : t;
    const pct = (t / DURATION) * 100;
    $('fill').style.width = pct + '%';
    $('knob').style.left = pct + '%';
    $('cur').textContent = fmt(t);
  }
  let saveTick = 0;
  function frame() {
    updateUI();
    applyScene(false);
    if (!video.paused) {
      if (isFile()) {
        if (Math.abs(userAudio.currentTime - video.currentTime) > 0.3) { try { userAudio.currentTime = video.currentTime; } catch (e) {} }
      } else {
        engine.sync(video.currentTime);
      }
      if (++saveTick % 45 === 0) save();
    }
    requestAnimationFrame(frame);
  }

  // ---- init ----------------------------------------------------------------
  $('dur').textContent = fmt(DURATION);
  video.addEventListener('loadedmetadata', () => { video.muted = true; });
  video.muted = true;

  const saved = load();
  if (saved.preset && PRESET_LABEL[saved.preset]) setPreset(saved.preset);
  if (typeof saved.volume === 'number') { state.volume = saved.volume; $('vol').value = Math.round(saved.volume * 100); }
  if (typeof saved.time === 'number' && saved.time > 0 && saved.time < DURATION - 0.5) {
    const apply = () => { video.currentTime = saved.time; updateUI(saved.time); };
    if (video.readyState >= 1) apply(); else video.addEventListener('loadedmetadata', apply, { once: true });
  }
  updateFlag();
  applyScene(true);
  updateUI(0);
  requestAnimationFrame(frame);
})();
