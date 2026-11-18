// audio.js — fully procedural WebAudio: no sound files, no network.
// Engine hum, two-tone sirens, skid noise, crash thumps and three radio
// stations are all synthesized live. Everything is behind a master gain
// and a mute toggle, and every call is safe before the first user gesture
// (the context is created lazily and resumed on input).
import { clamp } from './utils.js';

const STATIONS = [
  { id: 'SOL', name: 'SOL 98.4 — Sunset FM', root: 220, mode: 'major', bpm: 96 },
  { id: 'PALM', name: 'PALM 101 — Night Drive', root: 174.61, mode: 'minor', bpm: 112 },
  { id: 'BAY', name: 'BAY 88 — Golden Oldies', root: 196, mode: 'major', bpm: 80 },
];

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.stationIndex = 0;
    this.radioOn = false;
    this.radioTimer = null;
    this.radioStep = 0;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = null;
    this.sirenHigh = false;
    this.noiseBuffer = null;
    this.skidSrc = null;
    this.skidGain = null;
    this.started = false;
  }

  // Call from any user gesture (click / keydown). Safe to call twice.
  ensure() {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.buildEngine();
      this.buildSiren();
      this.buildSkid();
      this.started = true;
      return true;
    } catch (err) {
      console.warn('solmar: audio unavailable', err);
      return false;
    }
  }

  buildEngine() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 27.5;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();
  }

  buildSiren() {
    const ctx = this.ctx;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
  }

  buildSkid() {
    const ctx = this.ctx;
    this.skidSrc = ctx.createBufferSource();
    this.skidSrc.buffer = this.noiseBuffer;
    this.skidSrc.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 1.4;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skidSrc.connect(filter);
    filter.connect(this.skidGain);
    this.skidGain.connect(this.master);
    this.skidSrc.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  // speed 0..1 of top speed, throttle 0..1, inCar boolean.
  setEngine(speedNorm, throttle, inCar) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const base = 52 + speedNorm * 190 + throttle * 26;
    this.engineOsc.frequency.setTargetAtTime(base, t, 0.06);
    this.engineOsc2.frequency.setTargetAtTime(base * 0.5, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(320 + speedNorm * 1400, t, 0.1);
    const vol = inCar ? 0.05 + speedNorm * 0.075 + throttle * 0.02 : 0.012;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.08);
  }

  setSkid(amount) {
    if (!this.started) return;
    this.skidGain.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.11, this.ctx.currentTime, 0.05);
  }

  setSiren(on) {
    if (!this.started) return;
    if (on && !this.sirenTimer) {
      this.sirenTimer = window.setInterval(() => {
        this.sirenHigh = !this.sirenHigh;
        this.sirenOsc.frequency.setTargetAtTime(this.sirenHigh ? 960 : 700, this.ctx.currentTime, 0.05);
      }, 420);
      this.sirenGain.gain.setTargetAtTime(0.045, this.ctx.currentTime, 0.2);
    } else if (!on && this.sirenTimer) {
      window.clearInterval(this.sirenTimer);
      this.sirenTimer = null;
      this.sirenGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
  }

  // --- one-shot effects -------------------------------------------------
  blip(freq = 660, dur = 0.09, type = 'sine', vol = 0.12) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  crash(intensity = 1) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35 * clamp(intensity, 0.2, 1.5), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.32);
    this.blip(70, 0.22, 'sine', 0.25);
  }

  cash() {
    this.blip(880, 0.1, 'sine', 0.12);
    window.setTimeout(() => this.blip(1174, 0.12, 'sine', 0.12), 70);
    window.setTimeout(() => this.blip(1568, 0.18, 'sine', 0.12), 140);
  }

  missionStart() {
    this.blip(523, 0.12, 'triangle', 0.14);
    window.setTimeout(() => this.blip(659, 0.12, 'triangle', 0.14), 110);
    window.setTimeout(() => this.blip(784, 0.2, 'triangle', 0.14), 220);
  }

  busted() {
    this.blip(392, 0.25, 'sawtooth', 0.1);
    window.setTimeout(() => this.blip(311, 0.4, 'sawtooth', 0.1), 200);
  }

  // --- radio: a tiny step sequencer over the station's scale ------------
  toggleRadio() {
    this.radioOn = !this.radioOn;
    if (this.radioOn) this.startRadio();
    else this.stopRadio();
    return this.radioOn;
  }

  nextStation() {
    this.stationIndex = (this.stationIndex + 1) % STATIONS.length;
    if (this.radioOn) { this.stopRadio(); this.startRadio(); }
    return STATIONS[this.stationIndex];
  }

  currentStation() { return STATIONS[this.stationIndex]; }

  startRadio() {
    if (!this.started || this.radioTimer) return;
    const station = STATIONS[this.stationIndex];
    const stepMs = 60000 / station.bpm / 2; // eighth notes
    this.radioStep = 0;
    this.radioTimer = window.setInterval(() => this.radioTick(station), stepMs);
  }

  stopRadio() {
    if (this.radioTimer) { window.clearInterval(this.radioTimer); this.radioTimer = null; }
  }

  radioTick(station) {
    if (!this.started || this.muted) { this.radioStep++; return; }
    const scale = SCALES[station.mode];
    const step = this.radioStep++;
    const chordRoot = [0, 3, 4, 5][Math.floor(step / 8) % 4];
    const degree = scale[(step + chordRoot) % scale.length];
    const octave = step % 16 >= 12 ? 2 : 1;
    const freq = station.root * Math.pow(2, degree / 12) * octave;
    if (step % 2 === 0) this.blip(freq, 0.22, 'triangle', 0.05);
    if (step % 8 === 0) this.blip(station.root / 2, 0.5, 'sine', 0.06);
    if (step % 4 === 2) this.blip(freq * 1.5, 0.1, 'sine', 0.03);
  }
}
