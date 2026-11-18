// state.js — the single source of truth for a SOLMAR run: phase, money,
// wanted level, mission progress, garage, upgrades and run statistics.
// Nothing here touches the DOM or three.js; every system reads and writes
// through this object so a headless playtest can drive the whole game by
// poking state and the debug handle.
import { EventBus } from './utils.js';

export const PHASES = {
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  RESULTS: 'results',
};

export const MAX_WANTED = 5;

export class GameState {
  constructor() {
    this.bus = new EventBus();
    this.resetRun();
  }

  resetRun() {
    this.phase = PHASES.TITLE;
    this.cash = 250;
    this.wanted = 0;
    this.heat = 0; // 0..100, feeds wanted stars while police are close.
    this.missionIndex = 0; // next mission to play
    this.missionsCompleted = [];
    this.missionActive = false;
    this.missionId = null;
    this.onFoot = true;
    this.carHealth = 100;
    this.playerHealth = 100;
    this.upgrades = { engine: 0, armor: 0, brakes: 0 };
    this.garage = []; // { model, color, name } rare cars parked at safehouse
    this.safehousePaidOff = false;
    this.stats = {
      distanceDriven: 0,
      distanceWalked: 0,
      nearMisses: 0,
      airtime: 0,
      topSpeed: 0,
      crimes: 0,
      carsStolen: 0,
      pedsScared: 0,
      propsSmashed: 0,
      bustedCount: 0,
      wreckedCount: 0,
      missionsWon: 0,
      missionsFailed: 0,
      payouts: 0,
      playSeconds: 0,
      collisions: 0,
    };
    this.result = null; // { kind: 'win' | 'busted' | 'wrecked', title, ... }
    this.timeScale = 1;
  }

  // Wanted level: 0..5. Raising it is a crime event (police + HUD listen).
  addHeat(amount, reason = 'crime') {
    if (this.phase !== PHASES.PLAYING) return;
    this.heat = Math.min(100, this.heat + amount);
    const stars = Math.min(MAX_WANTED, Math.ceil(this.heat / 20));
    if (stars > this.wanted) {
      this.wanted = stars;
      this.stats.crimes += 1;
      this.bus.emit('wanted', { wanted: this.wanted, reason });
    }
  }

  setWanted(stars) {
    this.wanted = Math.max(0, Math.min(MAX_WANTED, Math.round(stars)));
    this.heat = this.wanted * 20;
    this.bus.emit('wanted', { wanted: this.wanted, reason: 'set' });
  }

  // Called every frame while playing: wanted decays only when the player
  // has truly broken away (police far, no line of sight), never while a
  // pursuit is hot.
  decayWanted(dt, policeNear, policeSees) {
    if (this.wanted === 0) return;
    if (!policeNear && !policeSees) {
      this.heat = Math.max(0, this.heat - dt * 4.5);
      const stars = Math.ceil(this.heat / 20);
      if (stars < this.wanted) {
        this.wanted = stars;
        this.bus.emit('wanted', { wanted: this.wanted, reason: 'cooldown' });
      }
    }
  }

  earn(amount, label) {
    this.cash += amount;
    this.stats.payouts += amount;
    this.bus.emit('cash', { cash: this.cash, amount, label });
  }

  spend(amount) {
    if (this.cash < amount) return false;
    this.cash -= amount;
    this.bus.emit('cash', { cash: this.cash, amount: -amount, label: 'spend' });
    return true;
  }

  completeMission(id, payout) {
    this.missionsCompleted.push(id);
    this.missionActive = false;
    this.missionId = null;
    this.missionIndex = Math.max(this.missionIndex, this.missionsCompleted.length);
    this.stats.missionsWon += 1;
    if (payout > 0) this.earn(payout, 'mission ' + id);
    this.bus.emit('mission-complete', { id, payout });
  }

  failMission(id, reason) {
    this.missionActive = false;
    this.missionId = null;
    this.stats.missionsFailed += 1;
    this.bus.emit('mission-failed', { id, reason });
  }

  // End-of-run results. kind 'win' only comes from finishing the final job.
  endRun(kind, detail = {}) {
    this.phase = PHASES.RESULTS;
    this.result = {
      kind,
      title: kind === 'win' ? 'THE LAST BOAT' : kind === 'busted' ? 'BUSTED' : 'WRECKED',
      subtitle: detail.subtitle || '',
      stats: { ...this.stats },
      cash: this.cash,
      missions: this.missionsCompleted.length,
      time: this.stats.playSeconds,
    };
    if (kind === 'busted') this.stats.bustedCount += 1;
    if (kind === 'wrecked') this.stats.wreckedCount += 1;
    this.bus.emit('run-end', this.result);
  }

  // Snapshot for save.js — plain JSON, no functions, no three objects.
  serialize() {
    return {
      v: 1,
      cash: this.cash,
      missionIndex: this.missionIndex,
      missionsCompleted: this.missionsCompleted,
      upgrades: this.upgrades,
      garage: this.garage,
      safehousePaidOff: this.safehousePaidOff,
      stats: this.stats,
    };
  }

  deserialize(data) {
    if (!data || data.v !== 1) return false;
    this.cash = data.cash ?? 250;
    this.missionIndex = data.missionIndex ?? 0;
    this.missionsCompleted = Array.isArray(data.missionsCompleted) ? data.missionsCompleted : [];
    this.upgrades = { engine: 0, armor: 0, brakes: 0, ...(data.upgrades || {}) };
    this.garage = Array.isArray(data.garage) ? data.garage : [];
    this.safehousePaidOff = !!data.safehousePaidOff;
    if (data.stats) this.stats = { ...this.stats, ...data.stats };
    return true;
  }
}
