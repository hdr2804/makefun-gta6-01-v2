// hud.js — every pixel of UI: the HUD (wanted stars, cash, speed,
// objective line, timer), the canvas minimap, the title screen, pause
// menu, mission briefing cards, the phone job list, toasts, prompts and
// the results screen. The minimap is north-up 2D: player arrow, police
// dots, mission marker, traffic specks, safehouse and marina icons.
import { fmtCash, fmtTime, fmtSpeed, clamp } from './utils.js';
import { MISSIONS as _M } from './missions.js';

const STAR_ON = '★';
const STAR_OFF = '☆';

export class HUD {
  constructor(state, city) {
    this.state = state;
    this.city = city;
    this.el = {};
    const ids = ['hud', 'wanted', 'cash', 'speed', 'speedUnit', 'objective', 'objectiveArrow', 'timer',
      'toast', 'prompt', 'minimap', 'title', 'btnNew', 'btnContinue', 'pause', 'btnResume', 'btnRestartPause',
      'btnQuitTitle', 'briefing', 'briefingTitle', 'briefingClient', 'briefingText', 'briefingPayout',
      'btnStartMission', 'btnCloseBriefing', 'results', 'resultsTitle', 'resultsSub', 'resultsStats',
      'btnAgain', 'btnMenu', 'phone', 'jobList', 'btnPhone', 'btnClosePhone', 'garageInfo',
      'radioLabel', 'health', 'healthBar', 'muteBtn', 'controls'];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.minimapCtx = this.el.minimap ? this.el.minimap.getContext('2d') : null;
    this.toastTimer = null;
    this.lastWanted = -1;
    this.lastCash = -1;
    this.bindButtons();
    this.state.bus.on('wanted', ({ wanted }) => this.renderWanted(wanted));
    this.state.bus.on('cash', ({ cash }) => this.renderCash(cash));
    this.state.bus.on('mission-complete', () => this.hideBriefing());
    this.state.bus.on('run-end', (result) => this.showResults(result));
  }

  bindButtons() {
    const on = (el, fn) => { if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); };
    on(this.el.btnNew, () => this.state.bus.emit('ui-new-game'));
    on(this.el.btnContinue, () => this.state.bus.emit('ui-continue'));
    on(this.el.btnResume, () => this.state.bus.emit('ui-resume'));
    on(this.el.btnRestartPause, () => this.state.bus.emit('ui-restart'));
    on(this.el.btnQuitTitle, () => this.state.bus.emit('ui-quit-title'));
    on(this.el.btnStartMission, () => this.state.bus.emit('ui-start-mission'));
    on(this.el.btnCloseBriefing, () => this.hideBriefing());
    on(this.el.btnAgain, () => this.state.bus.emit('ui-restart'));
    on(this.el.btnMenu, () => this.state.bus.emit('ui-quit-title'));
    on(this.el.btnPhone, () => this.togglePhone());
    on(this.el.btnClosePhone, () => this.togglePhone(false));
    on(this.el.muteBtn, () => this.state.bus.emit('ui-mute'));
  }

  // --- HUD ----------------------------------------------------------------
  showHud(show) {
    if (this.el.hud) this.el.hud.style.display = show ? 'block' : 'none';
  }

  renderWanted(wanted) {
    if (!this.el.wanted) return;
    let s = '';
    for (let i = 0; i < 5; i++) s += i < wanted ? STAR_ON : STAR_OFF;
    this.el.wanted.textContent = s;
    this.el.wanted.classList.toggle('hot', wanted >= 3);
    this.lastWanted = wanted;
  }

  renderCash(cash) {
    if (this.el.cash) this.el.cash.textContent = fmtCash(cash);
    this.lastCash = cash;
  }

  renderSpeed(ms, inCar) {
    if (!this.el.speed) return;
    if (inCar) {
      this.el.speed.textContent = fmtSpeed(ms);
      if (this.el.speedUnit) this.el.speedUnit.textContent = 'MPH';
    } else {
      this.el.speed.textContent = '—';
      if (this.el.speedUnit) this.el.speedUnit.textContent = 'ON FOOT';
    }
  }

  renderHealth(carHealth, playerHealth, inCar) {
    if (!this.el.healthBar) return;
    const v = inCar ? carHealth : playerHealth;
    this.el.healthBar.style.width = clamp(v, 0, 100) + '%';
    this.el.healthBar.style.background = v > 50 ? '#58d68d' : v > 25 ? '#f5b041' : '#e74c3c';
    if (this.el.health) this.el.health.textContent = inCar ? 'CAR' : 'YOU';
  }

  setObjective(text) {
    if (this.el.objective) this.el.objective.textContent = text || '';
  }

  setTimer(seconds) {
    if (!this.el.timer) return;
    if (seconds === null || seconds === undefined) { this.el.timer.textContent = ''; return; }
    this.el.timer.textContent = '⏱ ' + fmtTime(seconds);
    this.el.timer.classList.toggle('urgent', seconds < 20);
  }

  setRadio(label) {
    if (this.el.radioLabel) this.el.radioLabel.textContent = label;
  }

  showToast(text, kind = 'info', ms = 4200) {
    if (!this.el.toast) return;
    this.el.toast.textContent = text;
    this.el.toast.className = 'toast show ' + kind;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.el.toast.className = 'toast'; }, ms);
  }

  showPrompt(text) {
    if (!this.el.prompt) return;
    if (text) { this.el.prompt.textContent = text; this.el.prompt.style.display = 'block'; }
    else this.el.prompt.style.display = 'none';
  }

  // --- minimap ------------------------------------------------------------
  // Draw the city grid, roads, mission marker, safehouse, marina, traffic,
  // police and the player arrow. North-up, player-centred when zoomed.
  drawMinimap(playerPos, heading, policeUnits, trafficCars, missionTarget, opts = {}) {
    const ctx = this.minimapCtx;
    if (!ctx || !this.el.minimap) return;
    const W = this.el.minimap.width, H = this.el.minimap.height;
    const half = 200;
    const scale = W / (half * 2 + 40);
    const toX = (x) => (x + half + 20) * scale;
    const toY = (z) => (z + half + 20) * scale;
    ctx.clearRect(0, 0, W, H);
    // Sea + sand at the south edge.
    ctx.fillStyle = '#1e6f8e';
    ctx.fillRect(0, toY(-200), W, H - toY(-200));
    ctx.fillStyle = '#d9b380';
    ctx.fillRect(0, toY(-200) - 8 * scale, W, 8 * scale);
    // City ground.
    ctx.fillStyle = '#3a3532';
    ctx.fillRect(0, 0, W, toY(-200));
    // Streets.
    ctx.strokeStyle = '#565049';
    ctx.lineWidth = 4;
    for (let v = -200; v <= 200; v += 40) {
      ctx.beginPath(); ctx.moveTo(toX(v), 0); ctx.lineTo(toX(v), toY(-200)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, toY(v)); ctx.lineTo(W, toY(v)); ctx.stroke();
    }
    // Safehouse (green house) + marina (blue anchor).
    const sh = this.city.safehouse;
    ctx.fillStyle = '#58d68d';
    ctx.fillRect(toX(sh.x) - 4, toY(sh.z) - 4, 8, 8);
    const ma = this.city.marina;
    ctx.fillStyle = '#5dade2';
    ctx.beginPath(); ctx.arc(toX(ma.x), toY(ma.z), 5, 0, Math.PI * 2); ctx.fill();
    // Mission marker: pulsing diamond.
    if (missionTarget) {
      const pulse = 5 + Math.sin(performance.now() / 250) * 2;
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath();
      ctx.moveTo(toX(missionTarget.x), toY(missionTarget.z) - pulse);
      ctx.lineTo(toX(missionTarget.x) + pulse, toY(missionTarget.z));
      ctx.lineTo(toX(missionTarget.x), toY(missionTarget.z) + pulse);
      ctx.lineTo(toX(missionTarget.x) - pulse, toY(missionTarget.z));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Traffic specks.
    ctx.fillStyle = 'rgba(220,220,220,0.85)';
    for (const car of trafficCars) {
      ctx.fillRect(toX(car.vehicle.pos.x) - 1.5, toY(car.vehicle.pos.z) - 1.5, 3, 3);
    }
    // Police: blue/red flashing dots.
    const flash = Math.floor(performance.now() / 300) % 2 === 0;
    ctx.fillStyle = flash ? '#ff3b30' : '#2f6fff';
    for (const u of policeUnits) {
      ctx.beginPath(); ctx.arc(toX(u.vehicle.pos.x), toY(u.vehicle.pos.z), 4, 0, Math.PI * 2); ctx.fill();
    }
    // Player arrow.
    const px = toX(playerPos.x), py = toY(playerPos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5.5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5.5, 6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // Objective off-screen arrow at the minimap edge.
    if (missionTarget) {
      const dx = missionTarget.x - playerPos.x, dz = missionTarget.z - playerPos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 60) {
        const ax = px + (dx / d) * 62, ay = py + (dz / d) * 62;
        const ang = Math.atan2(dx, -dz);
        ctx.save();
        ctx.translate(clamp(ax, 10, W - 10), clamp(ay, 10, H - 10));
        ctx.rotate(ang);
        ctx.fillStyle = '#ffd23a';
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  // --- screens -------------------------------------------------------------
  showTitle(hasSave) {
    this.showHud(false);
    if (this.el.title) this.el.title.style.display = 'flex';
    if (this.el.btnContinue) this.el.btnContinue.style.display = hasSave ? 'block' : 'none';
    if (this.el.pause) this.el.pause.style.display = 'none';
    if (this.el.results) this.el.results.style.display = 'none';
    if (this.el.phone) this.el.phone.style.display = 'none';
  }

  hideTitle() {
    if (this.el.title) this.el.title.style.display = 'none';
  }

  showPause(show) {
    if (this.el.pause) this.el.pause.style.display = show ? 'flex' : 'none';
  }

  showBriefing(def) {
    if (!this.el.briefing) return;
    if (this.el.briefingTitle) this.el.briefingTitle.textContent = def.title;
    if (this.el.briefingClient) this.el.briefingClient.textContent = 'From ' + def.client;
    if (this.el.briefingText) this.el.briefingText.textContent = def.briefing;
    if (this.el.briefingPayout) this.el.briefingPayout.textContent = 'Payout ' + fmtCash(def.payout);
    this.el.briefing.style.display = 'flex';
    if (this.el.btnStartMission) this.el.btnStartMission.textContent = 'Start job';
  }

  hideBriefing() {
    if (this.el.briefing) this.el.briefing.style.display = 'none';
  }

  showResults(result) {
    this.showHud(false);
    if (!this.el.results) return;
    if (this.el.resultsTitle) this.el.resultsTitle.textContent = result.title;
    if (this.el.resultsSub) this.el.resultsSub.textContent = result.subtitle || '';
    const s = result.stats;
    const rows = [
      ['Missions completed', result.missions + ' / 6'],
      ['Cash', fmtCash(result.cash)],
      ['Time played', fmtTime(result.time)],
      ['Distance driven', (s.distanceDriven / 1000).toFixed(1) + ' km'],
      ['Top speed', Math.round(s.topSpeed * 2.23694) + ' mph'],
      ['Near misses', s.nearMisses],
      ['Airtime', s.airtime.toFixed(1) + ' s'],
      ['Cars stolen', s.carsStolen],
      ['Payouts earned', fmtCash(s.payouts)],
    ];
    if (this.el.resultsStats) {
      this.el.resultsStats.innerHTML = rows.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
    }
    this.el.results.style.display = 'flex';
    this.el.results.classList.toggle('win', result.kind === 'win');
  }

  hideResults() {
    if (this.el.results) this.el.results.style.display = 'none';
  }

  // --- phone / job list ----------------------------------------------------
  togglePhone(force) {
    if (!this.el.phone) return;
    const show = force !== undefined ? force : this.el.phone.style.display !== 'flex';
    this.el.phone.style.display = show ? 'flex' : 'none';
    if (show) this.refreshJobList();
    this.state.bus.emit('ui-phone', { open: show });
  }

  refreshJobList() {
    if (!this.el.jobList) return;
    const done = new Set(this.state.missionsCompleted);
    const rows = _M.map((m, i) => {
      const isDone = done.has(m.id);
      const isNext = i === this.state.missionIndex && !isDone;
      const cls = isDone ? 'done' : isNext ? 'next' : 'locked';
      const tag = isDone ? 'DONE' : isNext ? 'AVAILABLE' : 'LOCKED';
      return `<button class="job ${cls}" data-mission="${i}" ${isNext ? '' : 'disabled'}>
        <span class="job-title">${i + 1}. ${m.title}</span>
        <span class="job-meta">${m.client} · ${fmtCash(m.payout)} · ${tag}</span>
      </button>`;
    }).join('');
    this.el.jobList.innerHTML = rows;
    for (const btn of this.el.jobList.querySelectorAll('button[data-mission]')) {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.mission);
        this.togglePhone(false);
        this.state.bus.emit('ui-start-mission-index', { index: idx });
      });
    }
    if (this.el.garageInfo) {
      const rare = this.state.garage.length;
      this.el.garageInfo.textContent = rare > 0
        ? `Garage: ${rare} rare car${rare > 1 ? 's' : ''} parked at the safehouse.`
        : 'Garage: empty. Steal a rare car and park it at the safehouse to keep it.';
    }
  }
}
