/* narration-app.js — muted video + quiet BGM + Korean TTS narration + caption subtitles.
   Narration uses Web Speech API (browser TTS). Drop a real voice file to replace it. */
(function () {
  'use strict';

  const DURATION = 60;

  // Narration cues: start time + polished spoken line + scene meta for the panel.
  // Lines are lightly tightened versions of the on-screen VO copy.
  const CUES = [
    { t: 0.6,  tag: 'INTRO',                 name: '더 완성된 진화',
      vo: '기대를 넘어선 진화. 한우물의 신뢰가 EP7000N으로 다시 태어납니다.', intensity: 0.78 },
    { t: 13,   tag: 'SCENE 2 · FEATURE 01',  name: '커버 컬러의 진화',
      vo: '디자인부터 달라졌습니다. 한층 부드럽고 세련된 화이트브라운으로 공간의 품격을 높입니다.', intensity: 0.86 },
    { t: 21,   tag: 'SCENE 3 · FEATURE 02',  name: 'UV 케어 업그레이드',
      vo: '고인 물만이 아닙니다. 흐르는 물까지 실시간으로 케어하는 강력한 UV 시스템을 적용했습니다.', intensity: 0.96 },
    { t: 29.5, tag: 'SCENE 4 · FEATURE 03',  name: '잔수 문제 억제',
      vo: '출수 후 남는 잔수를 줄여, 더 위생적이고 깔끔하게 개선했습니다.', intensity: 0.80 },
    { t: 36.5, tag: 'SCENE 5 · FEATURE 04',  name: '서징 현상 해소',
      vo: '물 튐을 줄이고 정량 출수의 안정성을 높여, 부드럽고 정확한 물길을 완성했습니다.', intensity: 0.90 },
    { t: 44,   tag: 'SCENE 6 · FEATURE 05',  name: '출수 코크 소재 업그레이드',
      vo: '직접 마주하는 출수부까지, 트라이탄 소재로 위생을 한층 강화했습니다.', intensity: 0.86 },
    { t: 50.5, tag: 'SCENE 7 · CLOSING',     name: '기술의 차이가 가치의 차이',
      vo: '보이는 디자인부터 보이지 않는 기술까지. EP7000N, 한우물이 제시하는 완성형 정수 경험입니다.', intensity: 1.0 },
  ];

  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const engine = new window.BGMEngine();
  const synth = window.speechSynthesis;

  const state = {
    preset: 'warm', bgmVol: 0.22, narrVol: 1.0, rate: 0.98,
    narrOn: true, subOn: true, voiceURI: '', cueIdx: -1, spokenCue: -1,
    narrMode: 'tts',  // 'tts' | 'file'
    bgmMode: 'gen',
  };
  let voices = [];
  let narrAudio = null, narrURL = null;
  let bgmAudio = null, bgmURL = null;

  // ---- persistence ---------------------------------------------------------
  const LS = 'ep7000n_narr_v1';
  const save = () => { try { localStorage.setItem(LS, JSON.stringify({
    preset: state.preset, bgmVol: state.bgmVol, narrVol: state.narrVol, rate: state.rate,
    narrOn: state.narrOn, subOn: state.subOn, voiceURI: state.voiceURI, time: video.currentTime,
  })); } catch (e) {} };
  const load = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } };

  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const cueAt = (t) => { let i = 0; for (let k = 0; k < CUES.length; k++) if (t >= CUES[k].t) i = k; return (t < CUES[0].t) ? -1 : i; };

  // ---- build scene list + ticks -------------------------------------------
  const ticks = $('ticks'), sceneList = $('sceneList');
  CUES.forEach((c, i) => {
    if (i > 0) { const tk = document.createElement('div'); tk.className = 'tick'; tk.style.left = (c.t / DURATION * 100) + '%'; ticks.appendChild(tk); }
    const row = document.createElement('div'); row.className = 'sc'; row.dataset.i = i;
    row.innerHTML = '<div class="tm">' + fmt(c.t) + '</div><div><div class="nm">' + c.name + '</div><div class="vo">“' + c.vo + '”</div></div>';
    row.addEventListener('click', () => seekTo(c.t + 0.05));
    sceneList.appendChild(row);
  });
  const sceneRows = [...sceneList.children];

  // ---- voices --------------------------------------------------------------
  const voiceSel = $('voiceSel');
  function populateVoices() {
    voices = synth ? synth.getVoices() : [];
    const ko = voices.filter((v) => /ko(-|_)?/i.test(v.lang));
    const list = ko.length ? ko : voices;
    voiceSel.innerHTML = '';
    if (!list.length) { voiceSel.innerHTML = '<option>사용 가능한 음성 없음</option>'; return; }
    list.forEach((v) => {
      const o = document.createElement('option');
      o.value = v.voiceURI; o.textContent = v.name + (/(ko)/i.test(v.lang) ? ' · 한국어' : ' · ' + v.lang);
      voiceSel.appendChild(o);
    });
    // pick saved or first Korean
    const want = state.voiceURI && list.find((v) => v.voiceURI === state.voiceURI);
    state.voiceURI = want ? state.voiceURI : list[0].voiceURI;
    voiceSel.value = state.voiceURI;
  }
  if (synth) { populateVoices(); synth.onvoiceschanged = populateVoices; }
  voiceSel.addEventListener('change', () => { state.voiceURI = voiceSel.value; save(); });

  function speak(text) {
    if (!synth || !state.narrOn || state.narrMode !== 'tts') return;
    try { synth.cancel(); } catch (e) {}
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.voiceURI === state.voiceURI);
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'ko-KR'; }
    u.rate = state.rate; u.pitch = 1.0; u.volume = state.narrVol;
    synth.speak(u);
  }
  const stopSpeak = () => { try { synth && synth.cancel(); } catch (e) {} };

  // ---- audio start/stop ----------------------------------------------------
  function startBGM() {
    if (state.bgmMode === 'file' && bgmAudio) { try { bgmAudio.currentTime = video.currentTime; } catch (e) {} bgmAudio.volume = state.bgmVol; bgmAudio.play().catch(() => {}); }
    else { engine.setVolume(state.bgmVol); engine.start(video.currentTime); applyCue(true); }
  }
  function stopBGM() { engine.stop(); if (bgmAudio) bgmAudio.pause(); }

  function startNarr() {
    if (!state.narrOn) return;
    if (state.narrMode === 'file' && narrAudio) { try { narrAudio.currentTime = video.currentTime; } catch (e) {} narrAudio.volume = state.narrVol; narrAudio.play().catch(() => {}); }
    else { const i = cueAt(video.currentTime); if (i >= 0) { speak(CUES[i].vo); state.spokenCue = i; } }
  }
  function stopNarr() { stopSpeak(); if (narrAudio) narrAudio.pause(); }

  // ---- transport -----------------------------------------------------------
  const overlay = $('overlay'), playIcon = $('playIcon');
  const PLAY = '<path d="M0 1.5C0 .4 1.2-.2 2.1.4l15 9c.9.5.9 1.7 0 2.2l-15 9C1.2 20.2 0 19.6 0 18.5v-17z"/>';
  const PAUSE = '<rect x="1" y="1" width="5.5" height="18" rx="1.4"/><rect x="11.5" y="1" width="5.5" height="18" rx="1.4"/>';

  function play() { video.play().then(() => { startBGM(); startNarr(); }).catch(() => {}); }
  $('play').addEventListener('click', () => { video.paused ? play() : video.pause(); });
  overlay.addEventListener('click', play);
  video.addEventListener('play', () => { overlay.classList.add('hidden'); playIcon.innerHTML = PAUSE; });
  video.addEventListener('pause', () => { playIcon.innerHTML = PLAY; stopBGM(); stopNarr(); if (video.currentTime < DURATION - 0.2) overlay.classList.remove('hidden'); });
  video.addEventListener('ended', () => { stopBGM(); stopNarr(); overlay.classList.remove('hidden'); save(); });

  // ---- seeking -------------------------------------------------------------
  function seekTo(t) {
    t = Math.max(0, Math.min(DURATION - 0.05, t));
    video.currentTime = t;
    stopSpeak();
    if (!video.paused) {
      if (state.bgmMode === 'file' && bgmAudio) { try { bgmAudio.currentTime = t; } catch (e) {} } else { engine.seek(t); }
      if (state.narrMode === 'file' && narrAudio) { try { narrAudio.currentTime = t; } catch (e) {} }
    }
    state.spokenCue = cueAt(t);     // don't auto-respeak the cue we're landing inside
    updateUI(t); applyCue(true); renderSub(t);
  }
  const scrub = $('scrub'); let dragging = false;
  const scrubEv = (e) => { const r = scrub.getBoundingClientRect(); const x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width; seekTo(Math.max(0, Math.min(1, x)) * DURATION); };
  scrub.addEventListener('mousedown', (e) => { dragging = true; scrubEv(e); });
  window.addEventListener('mousemove', (e) => { if (dragging) scrubEv(e); });
  window.addEventListener('mouseup', () => { dragging = false; });
  scrub.addEventListener('touchstart', (e) => { dragging = true; scrubEv(e); }, { passive: true });
  scrub.addEventListener('touchmove', (e) => { if (dragging) scrubEv(e); }, { passive: true });
  scrub.addEventListener('touchend', () => { dragging = false; });

  // ---- toggles -------------------------------------------------------------
  const narrBtn = $('narrBtn'), narrSwitch = $('narrSwitch'), subBtn = $('subBtn'), subtitle = $('subtitle'), audioFlag = $('audioFlag');
  function setNarr(on) {
    state.narrOn = on;
    narrBtn.classList.toggle('on', on); narrSwitch.classList.toggle('on', on);
    if (!on) stopNarr(); else if (!video.paused) startNarr();
    updateFlag(); save();
  }
  narrBtn.addEventListener('click', () => setNarr(!state.narrOn));
  narrSwitch.addEventListener('click', () => setNarr(!state.narrOn));
  function setSub(on) { state.subOn = on; subBtn.classList.toggle('on', on); renderSub(); save(); }
  subBtn.addEventListener('click', () => setSub(!state.subOn));
  function updateFlag() {
    audioFlag.textContent = state.narrOn ? (state.narrMode === 'file' ? '🎙 성우 녹음' : '🎙 나래이션 ON') : '🎙 나래이션 OFF';
  }

  // ---- sliders -------------------------------------------------------------
  $('rate').addEventListener('input', (e) => { state.rate = e.target.value / 100; $('rateVal').textContent = state.rate.toFixed(1); save(); });
  $('narrVol').addEventListener('input', (e) => { state.narrVol = e.target.value / 100; $('narrVolVal').textContent = e.target.value; if (narrAudio) narrAudio.volume = state.narrVol; save(); });
  $('bgmVol').addEventListener('input', (e) => { state.bgmVol = e.target.value / 100; $('bgmVolVal').textContent = e.target.value; save(); });

  // ---- preset --------------------------------------------------------------
  const presetSeg = $('presetSeg');
  presetSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; setPreset(b.dataset.p); });
  function setPreset(p) { state.preset = p; [...presetSeg.children].forEach((b) => b.classList.toggle('active', b.dataset.p === p)); engine.setPreset(p); save(); }

  // ---- file drops ----------------------------------------------------------
  function wireDrop(dropId, inputId, fnId, onFile) {
    const drop = $(dropId), input = $(inputId), fn = $(fnId);
    input.addEventListener('change', (e) => { if (e.target.files[0]) onFile(e.target.files[0], fn); });
    drop.addEventListener('click', () => input.click());
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) onFile(f, fn); });
  }
  wireDrop('narrDrop', 'narrInput', 'narrFn', (file, fn) => {
    if (narrURL) URL.revokeObjectURL(narrURL); narrURL = URL.createObjectURL(file);
    if (!narrAudio) { narrAudio = new Audio(); narrAudio.preload = 'auto'; }
    narrAudio.src = narrURL; narrAudio.volume = state.narrVol;
    fn.textContent = '✓ ' + file.name + ' (실제 녹음 사용)';
    state.narrMode = 'file'; stopSpeak(); if (!video.paused) startNarr(); updateFlag();
  });
  wireDrop('bgmDrop', 'bgmInput', 'bgmFn', (file, fn) => {
    if (bgmURL) URL.revokeObjectURL(bgmURL); bgmURL = URL.createObjectURL(file);
    if (!bgmAudio) { bgmAudio = new Audio(); bgmAudio.loop = true; bgmAudio.preload = 'auto'; }
    bgmAudio.src = bgmURL; bgmAudio.volume = state.bgmVol;
    fn.textContent = '✓ ' + file.name;
    state.bgmMode = 'file'; engine.stop(); presetSeg.style.opacity = '.4'; presetSeg.style.pointerEvents = 'none';
    if (!video.paused) { bgmAudio.currentTime = video.currentTime; bgmAudio.play().catch(() => {}); }
  });

  // ---- subtitle + cue ------------------------------------------------------
  function renderSub(t) {
    t = (t == null) ? video.currentTime : t;
    const i = cueAt(t);
    if (!state.subOn || i < 0) { subtitle.classList.remove('show'); return; }
    const speaking = (state.narrOn && ((state.narrMode === 'tts' && synth && synth.speaking) || (state.narrMode === 'file' && narrAudio && !narrAudio.paused)));
    const dot = speaking ? '<span class="spk"><span class="speaking-dot"></span>나래이션</span>' : '';
    subtitle.innerHTML = dot + CUES[i].vo;
    subtitle.classList.add('show');
  }
  function applyCue(force) {
    const i = cueAt(video.currentTime);
    const si = Math.max(0, i);
    if (i !== state.cueIdx || force) {
      state.cueIdx = i;
      $('sceneChip').textContent = CUES[si].tag;
      $('nowName').textContent = CUES[si].name;
      sceneRows.forEach((r, k) => r.classList.toggle('active', k === si));
      if (state.bgmMode === 'gen' && !video.paused) engine.setScene(CUES[si].intensity);
    }
    // trigger narration when a NEW cue begins
    if (state.narrOn && state.narrMode === 'tts' && !video.paused && i >= 0 && i !== state.spokenCue) {
      speak(CUES[i].vo); state.spokenCue = i;
    }
  }

  // ---- loop ----------------------------------------------------------------
  function updateUI(t) {
    t = (t == null) ? video.currentTime : t;
    const pct = (t / DURATION) * 100;
    $('fill').style.width = pct + '%'; $('knob').style.left = pct + '%'; $('cur').textContent = fmt(t);
  }
  let saveTick = 0;
  function frame() {
    updateUI(); applyCue(false); renderSub();
    if (!video.paused) {
      // BGM ducking while narration speaks
      const speaking = (state.narrOn && ((state.narrMode === 'tts' && synth && synth.speaking) || (state.narrMode === 'file' && narrAudio && !narrAudio.paused)));
      if (state.bgmMode === 'gen') engine.setVolume(state.bgmVol * (speaking ? 0.5 : 1));
      else if (bgmAudio) bgmAudio.volume = state.bgmVol * (speaking ? 0.5 : 1);
      // drift correction
      if (state.bgmMode === 'file' && bgmAudio && Math.abs(bgmAudio.currentTime - video.currentTime) > 0.4) { try { bgmAudio.currentTime = video.currentTime; } catch (e) {} }
      if (state.narrMode === 'file' && narrAudio && Math.abs(narrAudio.currentTime - video.currentTime) > 0.4) { try { narrAudio.currentTime = video.currentTime; } catch (e) {} }
      if (++saveTick % 45 === 0) save();
    }
    requestAnimationFrame(frame);
  }

  // ---- init ----------------------------------------------------------------
  $('dur').textContent = fmt(DURATION);
  video.muted = true;
  video.addEventListener('loadedmetadata', () => { video.muted = true; });

  const s = load();
  if (s.preset) setPreset(s.preset);
  if (typeof s.bgmVol === 'number') { state.bgmVol = s.bgmVol; $('bgmVol').value = Math.round(s.bgmVol * 100); $('bgmVolVal').textContent = Math.round(s.bgmVol * 100); }
  if (typeof s.narrVol === 'number') { state.narrVol = s.narrVol; $('narrVol').value = Math.round(s.narrVol * 100); $('narrVolVal').textContent = Math.round(s.narrVol * 100); }
  if (typeof s.rate === 'number') { state.rate = s.rate; $('rate').value = Math.round(s.rate * 100); $('rateVal').textContent = s.rate.toFixed(1); }
  if (typeof s.narrOn === 'boolean') setNarr(s.narrOn); else setNarr(true);
  if (typeof s.subOn === 'boolean') setSub(s.subOn); else setSub(true);
  if (s.voiceURI) state.voiceURI = s.voiceURI;
  if (typeof s.time === 'number' && s.time > 0 && s.time < DURATION - 0.5) {
    const apply = () => { video.currentTime = s.time; state.spokenCue = cueAt(s.time); updateUI(s.time); renderSub(s.time); };
    if (video.readyState >= 1) apply(); else video.addEventListener('loadedmetadata', apply, { once: true });
  }
  updateFlag(); applyCue(true); updateUI(0); renderSub(0);
  requestAnimationFrame(frame);
  window.addEventListener('beforeunload', stopSpeak);
})();
