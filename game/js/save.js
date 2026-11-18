// save.js — localStorage persistence for SOLMAR.
// The start screen offers New Game / Continue; the safehouse garage keeps
// stolen rare cars across sessions, and upgrades persist with the run.
// All storage is guarded: a private-mode browser or a quota error must
// never break the game loop.
export const SAVE_KEY = 'solmar-sunset-getaway-save-v1';

export function hasSave() {
  try {
    return window.localStorage.getItem(SAVE_KEY) !== null;
  } catch (err) {
    return false;
  }
}

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (err) {
    console.warn('solmar: save unreadable, starting fresh', err);
    return null;
  }
}

export function writeSave(state) {
  try {
    const payload = state.serialize();
    payload.savedAt = new Date().toISOString();
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn('solmar: save failed', err);
    return false;
  }
}

export function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch (err) { /* ignore */ }
}

// Autosave triggers: mission complete, garage change, entering the
// safehouse zone, and every 30 s of play. Cheap and frequent beats rare.
export class AutoSaver {
  constructor(state) {
    this.state = state;
    this.timer = 0;
    this.dirty = false;
    state.bus.on('mission-complete', () => { this.dirty = true; this.flush(); });
    state.bus.on('garage', () => { this.dirty = true; this.flush(); });
    state.bus.on('safehouse', () => { this.dirty = true; this.flush(); });
  }
  update(dt) {
    this.timer += dt;
    if (this.timer >= 30) {
      this.timer = 0;
      if (this.dirty) this.flush();
    }
  }
  markDirty() { this.dirty = true; }
  flush() {
    if (!this.dirty) return;
    if (writeSave(this.state)) this.dirty = false;
  }
}
