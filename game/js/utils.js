// utils.js — seeded random, math helpers and a tiny event bus for SOLMAR.
// Every deterministic part of the game (city layout, traffic spawn, shot
// scenes) draws from mulberry32 so a scene composes the same way twice.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range(min, max) { return min + (max - min) * next(); },
    int(min, max) { return Math.floor(min + (max - min + 1) * next()); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    chance(p) { return next() < p; },
    // Box-Muller gaussian, used for building heights and ped speeds.
    gauss(mean = 0, sd = 1) {
      const u = Math.max(next(), 1e-9);
      const v = Math.max(next(), 1e-9);
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;

// Shortest signed angular difference, in (-PI, PI].
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}
export function angleLerp(a, b, t) { return a + angleDiff(a, b) * t; }
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
// Heading (radians, 0 = +Z, turning toward +X) from a velocity vector.
export function headingFromVel(vx, vz) { return Math.atan2(vx, vz); }

// Tiny pub/sub so systems stay decoupled: missions, police and HUD listen
// to the same crime / payout / busted events the car and player emit.
export class EventBus {
  constructor() { this.map = new Map(); }
  on(event, fn) {
    if (!this.map.has(event)) this.map.set(event, []);
    this.map.get(event).push(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    const list = this.map.get(event);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(event, payload) {
    const list = this.map.get(event);
    if (!list) return;
    for (const fn of [...list]) {
      try { fn(payload); } catch (err) { console.error('bus', event, err); }
    }
  }
}

// A cheap 2D spatial hash for "who is near the player" queries (traffic,
// pedestrians, police) without an O(n^2) scan every frame.
export class SpatialHash {
  constructor(cell = 20) { this.cell = cell; this.cells = new Map(); }
  key(x, z) { return ((Math.floor(x / this.cell) + 4096) << 16) | (Math.floor(z / this.cell) + 4096); }
  clear() { this.cells.clear(); }
  insert(x, z, item) {
    const k = this.key(x, z);
    let list = this.cells.get(k);
    if (!list) { list = []; this.cells.set(k, list); }
    list.push(item);
  }
  query(x, z, radius, out = []) {
    const c = this.cell;
    const x0 = Math.floor((x - radius) / c), x1 = Math.floor((x + radius) / c);
    const z0 = Math.floor((z - radius) / c), z1 = Math.floor((z + radius) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(((cx + 4096) << 16) | (cz + 4096));
        if (list) for (const it of list) out.push(it);
      }
    }
    return out;
  }
}

// Format helpers used by the HUD and the results screen.
export function fmtCash(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
export function fmtSpeed(ms) {
  return String(Math.round(ms * 2.23694)).padStart(3, '0');
}
