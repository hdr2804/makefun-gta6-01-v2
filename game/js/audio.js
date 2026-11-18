// audio.js — procedural WebAudio for SOLMAR: Sunset Getaway.
// No audio files: engine hum, sirens, impacts, cash register and three radio
// stations are all synthesized live. Everything is guarded so the game plays
// fine in a headless browser with no audio device and no user gesture yet.

export function createAudio() {
  const audio = {
    ctx: null,
    master: null,
    engineOsc: null,
    engineGain: null,
    sirenOsc: null,
    sirenGain: null,
    sirenTimer: 0,
    radioTimer: 0,
    radioOn: true,
    station: 0,
    muted: false,
    started: false,
  };
  return audio;
}

export function ensureAudio(audio) {
  if (audio.ctx) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    return audio.ctx;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audio.ctx = new Ctx();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = audio.muted ? 0 : 0.5;
    audio.master.connect(audio.ctx.destination);
    audio.engineOsc = audio.ctx.createOscillator();
    audio.engineOsc.type = 'sawtooth';
    audio.engineOsc.frequency.value = 55;
    audio.engineGain = audio.ctx.createGain();
    audio.engineGain.gain.value = 0;
    const engineFilter = audio.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    audio.engineOsc.connect(engineFilter);
    engineFilter.connect(audio.engineGain);
    audio.engineGain.connect(audio.master);
    audio.engineOsc.start();
    audio.sirenOsc = audio.ctx.createOscillator();
    audio.sirenOsc.type = 'triangle';
    audio.sirenOsc.frequency.value = 700;
    audio.sirenGain = audio.ctx.createGain();
    audio.sirenGain.gain.value = 0;
    audio.sirenOsc.connect(audio.sirenGain);
    audio.sirenGain.connect(audio.master);
    audio.sirenOsc.start();
    audio.started = true;
  } catch (err) {
    audio.ctx = null;
  }
  return audio.ctx;
}

export function setEngineSound(audio, speedRatio, inCar) {
  if (!audio.ctx || !audio.engineOsc) return;
  const now = audio.ctx.currentTime;
  const target = inCar ? 0.05 + 0.11 * speedRatio : 0.0;
  audio.engineGain.gain.setTargetAtTime(target, now, 0.08);
  audio.engineOsc.frequency.setTargetAtTime(48 + 150 * speedRatio, now, 0.1);
}

export function setSirenSound(audio, wanted, dt) {
  if (!audio.ctx || !audio.sirenOsc) return;
  const now = audio.ctx.currentTime;
  if (wanted <= 0) {
    audio.sirenGain.gain.setTargetAtTime(0, now, 0.2);
    return;
  }
  audio.sirenTimer += dt;
  const phase = Math.floor(audio.sirenTimer * 1.6) % 2;
  const freq = phase === 0 ? 715 : 960;
  audio.sirenOsc.frequency.setTargetAtTime(freq, now, 0.05);
  audio.sirenGain.gain.setTargetAtTime(0.028 + 0.006 * wanted, now, 0.15);
}

export function blip(audio, freq, duration, type, volume) {
  if (!audio.ctx || !audio.master) return;
  try {
    const now = audio.ctx.currentTime;
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume || 0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (duration || 0.12));
    osc.connect(gain);
    gain.connect(audio.master);
    osc.start(now);
    osc.stop(now + (duration || 0.12) + 0.02);
  } catch (err) { /* audio unavailable */ }
}

export function playCrash(audio, strength) {
  if (!audio.ctx || !audio.master) return;
  try {
    const now = audio.ctx.currentTime;
    const buffer = audio.ctx.createBuffer(1, audio.ctx.sampleRate * 0.18, audio.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = audio.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = audio.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = audio.ctx.createGain();
    gain.gain.value = Math.min(0.5, 0.12 + strength * 0.3);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audio.master);
    source.start(now);
  } catch (err) { /* audio unavailable */ }
}

export function playCash(audio) {
  blip(audio, 1320, 0.09, 'sine', 0.14);
  setTimeout(() => blip(audio, 1760, 0.14, 'sine', 0.14), 90);
  setTimeout(() => blip(audio, 2210, 0.18, 'sine', 0.1), 180);
}

export function playMissionSting(audio, success) {
  const notes = success ? [523, 659, 784, 1047] : [392, 330, 262, 196];
  notes.forEach((freq, i) => setTimeout(() => blip(audio, freq, 0.22, 'triangle', 0.13), i * 110));
}

export function playHorn(audio) {
  blip(audio, 370, 0.25, 'square', 0.07);
  blip(audio, 466, 0.25, 'square', 0.05);
}

const STATIONS = [
  { name: 'SOL 98.4 — Sunset FM', root: 220, chords: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [7, 10, 14]] },
  { name: 'PALMA 101 — Coast Beats', root: 196, chords: [[0, 5, 7], [0, 3, 7], [5, 8, 12], [3, 7, 11]] },
  { name: 'MARINA 88 — Night Drive', root: 174, chords: [[0, 3, 7, 10], [5, 8, 12], [0, 7, 12], [3, 7, 10]] },
];

export function stationName(audio) {
  return STATIONS[audio.station % STATIONS.length].name;
}

export function cycleStation(audio) {
  audio.station = (audio.station + 1) % STATIONS.length;
  audio.radioTimer = 0;
  return stationName(audio);
}

export function updateRadio(audio, dt, inCar) {
  if (!audio.ctx || !audio.radioOn || !inCar) return;
  audio.radioTimer += dt;
  if (audio.radioTimer < 0.42) return;
  audio.radioTimer = 0;
  const station = STATIONS[audio.station % STATIONS.length];
  const beat = Math.floor(audio.ctx.currentTime / 0.42) % 8;
  const chord = station.chords[Math.floor(beat / 2) % station.chords.length];
  const note = chord[beat % chord.length];
  const freq = station.root * Math.pow(2, note / 12);
  blip(audio, freq, 0.34, 'sine', 0.035);
  if (beat % 2 === 0) blip(audio, station.root / 2, 0.3, 'triangle', 0.045);
}

export function toggleMute(audio) {
  audio.muted = !audio.muted;
  if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.5;
  return audio.muted;
}
