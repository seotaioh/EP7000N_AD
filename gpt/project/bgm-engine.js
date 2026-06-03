/* bgm-engine.js — procedural "bright & cheerful" electronic BGM for the EP7000N promo.
   Pure Web Audio API. No external files. Synced to a <video> by an external controller.
   Exposes window.BGMEngine. */
(function () {
  'use strict';

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---- Chord progression (bright C-major, uplifting I–V–vi–IV) -------------
  // Each entry: { pad:[midi...], bass:midi, arp:[midi...] }
  const PROG = [
    { pad: [60, 64, 67, 72], bass: 36, arp: [60, 64, 67, 72, 76] }, // C
    { pad: [62, 67, 71, 74], bass: 43, arp: [55, 59, 62, 67, 71] }, // G
    { pad: [57, 60, 64, 69], bass: 45, arp: [57, 60, 64, 69, 72] }, // Am
    { pad: [53, 57, 60, 65], bass: 41, arp: [53, 57, 60, 65, 69] }, // F
  ];
  // Sparse bell motif degrees (per bar, step -> midi) — gentle pentatonic sparkle
  const BELL = [
    { 0: 84, 6: 79, 10: 76 },
    { 2: 83, 8: 79 },
    { 0: 81, 4: 76, 12: 72 },
    { 2: 77, 8: 72, 14: 81 },
  ];

  const PRESETS = {
    bright:    { bpm: 116, gains: { pad: 0.16, bass: 0.22, arp: 0.16, kick: 0.42, hat: 0.10, bell: 0.13 }, padCut: 1500, arpWave: 'triangle', label: '밝고 경쾌' },
    warm:      { bpm: 100, gains: { pad: 0.22, bass: 0.20, arp: 0.10, kick: 0.26, hat: 0.05, bell: 0.16 }, padCut: 1100, arpWave: 'sine',     label: '따뜻한 프리미엄' },
    energetic: { bpm: 124, gains: { pad: 0.14, bass: 0.26, arp: 0.20, kick: 0.50, hat: 0.15, bell: 0.10 }, padCut: 1900, arpWave: 'sawtooth', label: '역동적 임팩트' },
  };

  function BGMEngine() {
    this.ctx = null;
    this.preset = 'bright';
    this.master = null;
    this.layers = {};            // gain nodes per layer
    this.noiseBuf = null;
    this.playing = false;
    this.ctxStart = 0;           // ctx time corresponding to songTime 0
    this.lastSched = 0;          // songTime up to which we've scheduled
    this.timer = null;
    this.sceneGain = 1;          // current scene intensity (smoothed via param ramp)
    this._sceneTarget = 1;
    this.userVol = 0.8;
    this.lookahead = 0.18;       // seconds
    this.tickMs = 25;
  }

  BGMEngine.prototype._ensure = function () {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.userVol;
    master.connect(ctx.destination);
    this.master = master;
    // per-layer gain nodes
    const names = ['pad', 'bass', 'arp', 'kick', 'hat', 'bell'];
    const g = PRESETS[this.preset].gains;
    names.forEach((n) => {
      const node = ctx.createGain();
      node.gain.value = g[n];
      node.connect(master);
      this.layers[n] = node;
    });
    // gentle master compression for glue
    if (ctx.createDynamicsCompressor) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 24; comp.ratio.value = 3;
      comp.attack.value = 0.005; comp.release.value = 0.2;
      master.disconnect();
      master.connect(comp); comp.connect(ctx.destination);
    }
    // noise buffer for hats
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  };

  BGMEngine.prototype.setPreset = function (name) {
    if (!PRESETS[name]) return;
    this.preset = name;
    if (!this.ctx) return;
    const g = PRESETS[name].gains;
    Object.keys(g).forEach((n) => {
      if (this.layers[n]) this.layers[n].gain.setTargetAtTime(g[n] * this.sceneGain, this.ctx.currentTime, 0.05);
    });
  };

  BGMEngine.prototype.setVolume = function (v) {
    this.userVol = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  };

  // scene intensity 0..1 -> scales all layer gains relative to preset
  BGMEngine.prototype.setScene = function (intensity) {
    this._sceneTarget = intensity;
    if (!this.ctx) return;
    this.sceneGain = intensity;
    const g = PRESETS[this.preset].gains;
    Object.keys(g).forEach((n) => {
      if (this.layers[n]) this.layers[n].gain.setTargetAtTime(g[n] * intensity, this.ctx.currentTime, 0.25);
    });
  };

  BGMEngine.prototype._songTime = function () {
    return this.ctx.currentTime - this.ctxStart;
  };

  BGMEngine.prototype.start = function (atSec) {
    this._ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.ctxStart = this.ctx.currentTime - (atSec || 0);
    this.lastSched = (atSec || 0);
    this.playing = true;
    const self = this;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => self._schedule(), this.tickMs);
    this._schedule();
  };

  BGMEngine.prototype.stop = function () {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.ctx) this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
    const self = this;
    setTimeout(() => { if (!self.playing && self.ctx && self.ctx.state === 'running') self.ctx.suspend(); }, 200);
  };

  BGMEngine.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if (this.master) this.master.gain.setTargetAtTime(this.userVol, this.ctx.currentTime, 0.08);
  };

  // jump music position to match a video seek
  BGMEngine.prototype.seek = function (atSec) {
    if (!this.ctx) return;
    this.ctxStart = this.ctx.currentTime - atSec;
    this.lastSched = atSec;
  };

  // light drift correction called each frame by controller
  BGMEngine.prototype.sync = function (videoSec) {
    if (!this.playing || !this.ctx) return;
    const drift = this._songTime() - videoSec;
    if (Math.abs(drift) > 0.30) this.seek(videoSec);
  };

  // ------------------------------------------------------------------- voices
  BGMEngine.prototype._pad = function (notes, t, dur) {
    const ctx = this.ctx, out = this.layers.pad;
    const p = PRESETS[this.preset];
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(p.padCut * 0.6, t);
    filt.frequency.linearRampToValueAtTime(p.padCut, t + 0.5);
    filt.Q.value = 0.6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.45);
    env.gain.setValueAtTime(1, t + dur - 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    filt.connect(env); env.connect(out);
    notes.forEach((m) => {
      [0, 1].forEach((k) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToFreq(m);
        o.detune.value = k ? 7 : -7;
        const vg = ctx.createGain(); vg.gain.value = 0.25 / notes.length;
        o.connect(vg); vg.connect(filt);
        o.start(t); o.stop(t + dur + 0.05);
      });
    });
  };

  BGMEngine.prototype._bass = function (m, t, dur) {
    const ctx = this.ctx, out = this.layers.bass;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midiToFreq(m);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = midiToFreq(m + 12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const o2g = ctx.createGain(); o2g.gain.value = 0.25;
    o.connect(env); o2.connect(o2g); o2g.connect(env); env.connect(out);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  };

  BGMEngine.prototype._arp = function (m, t) {
    const ctx = this.ctx, out = this.layers.arp;
    const o = ctx.createOscillator(); o.type = PRESETS[this.preset].arpWave; o.frequency.value = midiToFreq(m);
    const filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = midiToFreq(m) * 1.5; filt.Q.value = 1.1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(filt); filt.connect(env); env.connect(out);
    o.start(t); o.stop(t + 0.2);
  };

  BGMEngine.prototype._kick = function (t) {
    const ctx = this.ctx, out = this.layers.kick;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(125, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const env = ctx.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(env); env.connect(out);
    o.start(t); o.stop(t + 0.24);
  };

  BGMEngine.prototype._hat = function (t, open) {
    const ctx = this.ctx, out = this.layers.hat;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
    const env = ctx.createGain();
    const dur = open ? 0.12 : 0.035;
    env.gain.setValueAtTime(0.8, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp); hp.connect(env); env.connect(out);
    src.start(t); src.stop(t + dur + 0.02);
  };

  BGMEngine.prototype._bell = function (m, t) {
    const ctx = this.ctx, out = this.layers.bell;
    [1, 2.01, 3.0].forEach((mult, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midiToFreq(m) * mult;
      const env = ctx.createGain();
      const peak = i === 0 ? 1 : (i === 1 ? 0.4 : 0.18);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 - i * 0.2);
      o.connect(env); env.connect(out);
      o.start(t); o.stop(t + 1.0);
    });
  };

  // ----------------------------------------------------------------- sequencer
  BGMEngine.prototype._schedule = function () {
    if (!this.playing) return;
    const bpm = PRESETS[this.preset].bpm;
    const six = 60 / bpm / 4;               // sixteenth-note seconds
    const horizon = this._songTime() + this.lookahead;
    // schedule every 16th grid point between lastSched and horizon
    let idx = Math.ceil(this.lastSched / six);
    while (idx * six < horizon) {
      const sTime = idx * six;
      if (sTime >= this.lastSched - 1e-6) {
        const when = this.ctxStart + sTime;
        if (when > this.ctx.currentTime - 0.02) this._step(idx, when);
      }
      idx++;
    }
    this.lastSched = horizon;
  };

  BGMEngine.prototype._step = function (globalStep, when) {
    const step = ((globalStep % 16) + 16) % 16;
    const bar = Math.floor(globalStep / 16);
    const chord = PROG[bar % PROG.length];
    const bpm = PRESETS[this.preset].bpm;
    const barDur = (60 / bpm) * 4;

    // PAD: trigger at start of each bar
    if (step === 0) this._pad(chord.pad, when, barDur + 0.05);

    // BASS: root on 0 and 8, octave bounce on 11
    if (step === 0 || step === 8) this._bass(chord.bass, when, 60 / bpm * 0.9);
    else if (step === 11) this._bass(chord.bass + 12, when, 60 / bpm * 0.4);

    // KICK: four-on-floor (lighter presets handled by gain)
    if (step % 4 === 0) this._kick(when);

    // HAT: every off-8th, open hat on the last 16th of bar
    if (step % 2 === 1) this._hat(when, step === 15);

    // ARP: ascending chord tones on every 16th
    const arp = chord.arp;
    this._arp(arp[step % arp.length] + (step >= 8 ? 12 : 0) - (step >= 8 ? 12 : 0), when);

    // BELL sparkle motif
    const motif = BELL[bar % BELL.length];
    if (motif[step] != null) this._bell(motif[step], when);
  };

  window.BGMEngine = BGMEngine;
})();
