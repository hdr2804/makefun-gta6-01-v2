// save.js — progression persistence for SOLMAR: Sunset Getaway.
// Keeps cash, mission progress, owned garage cars and car upgrades in localStorage
// under one key, versioned so an old save never crashes a new build.

export const SAVE_KEY = 'solmar-sunset-getaway-save-v1';

export function defaultSave() {
  return {
    version: 1,
    cash: 250,
    missionIndex: 0,
    missionsDone: [],
    bestPayout: 0,
    totalEarned: 0,
    carsStolen: 0,
    nearMisses: 0,
    stuntAirtime: 0,
    garage: [],
    upgrades: { engine: 0, armor: 0, tires: 0 },
    safehousePaidOff: false,
    stats: { chasesEscaped: 0, busts: 0, wrecks: 0, jobsDone: 0, playSeconds: 0 },
    createdAt: Date.now(),
  };
}

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return defaultSave();
    const fresh = defaultSave();
    const merged = Object.assign(fresh, parsed);
    merged.upgrades = Object.assign({ engine: 0, armor: 0, tires: 0 }, parsed.upgrades || {});
    merged.stats = Object.assign(fresh.stats, parsed.stats || {});
    if (!Array.isArray(merged.garage)) merged.garage = [];
    if (!Array.isArray(merged.missionsDone)) merged.missionsDone = [];
    return merged;
  } catch (err) {
    return defaultSave();
  }
}

export function writeSave(save) {
  try {
    save.savedAt = Date.now();
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch (err) {
    return false;
  }
}

export function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch (err) { /* storage unavailable */ }
  return defaultSave();
}

export function hasSave() {
  try { return !!window.localStorage.getItem(SAVE_KEY); } catch (err) { return false; }
}

export const UPGRADE_COSTS = {
  engine: [800, 2200, 5000],
  armor: [600, 1800, 4200],
  tires: [500, 1400, 3200],
};

export const UPGRADE_NAMES = {
  engine: 'Turbo Engine',
  armor: 'Reinforced Frame',
  tires: 'Grip Tires',
};

export function upgradeLevel(save, kind) {
  return Math.max(0, Math.min(3, save.upgrades[kind] || 0));
}

export function upgradeCost(save, kind) {
  const level = upgradeLevel(save, kind);
  if (level >= 3) return null;
  return UPGRADE_COSTS[kind][level];
}

export function buyUpgrade(save, kind) {
  const cost = upgradeCost(save, kind);
  if (cost === null || save.cash < cost) return false;
  save.cash -= cost;
  save.upgrades[kind] = upgradeLevel(save, kind) + 1;
  writeSave(save);
  return true;
}

export function engineMultiplier(save) {
  return 1 + 0.14 * upgradeLevel(save, 'engine');
}

export function armorMultiplier(save) {
  return 1 + 0.25 * upgradeLevel(save, 'armor');
}

export function gripMultiplier(save) {
  return 1 + 0.12 * upgradeLevel(save, 'tires');
}

export function addGarageCar(save, car) {
  if (!car || !car.id) return false;
  if (save.garage.some((entry) => entry.id === car.id)) return false;
  if (save.garage.length >= 6) save.garage.shift();
  save.garage.push({ id: car.id, name: car.name, color: car.color, kind: car.kind, parkedAt: Date.now() });
  writeSave(save);
  return true;
}

export function recordPayout(save, amount) {
  save.cash += amount;
  save.totalEarned += amount;
  save.bestPayout = Math.max(save.bestPayout, amount);
  save.stats.jobsDone += 1;
  writeSave(save);
}

export function recordMissionDone(save, missionId) {
  if (!save.missionsDone.includes(missionId)) save.missionsDone.push(missionId);
  save.missionIndex = Math.max(save.missionIndex, save.missionsDone.length);
  writeSave(save);
}

export function formatCash(amount) {
  const value = Math.round(amount);
  return '$' + value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
