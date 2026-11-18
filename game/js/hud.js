// hud.js — the SOLMAR interface: speed, cash, wanted stars, mission
// objective, minimap, radio station, toasts and the objective arrow.
// The minimap is a 2D canvas, north-up, drawing roads, the player, police,
// traffic, pedestrians and the mission marker every frame.

import { CITY, blockCenter } from './city.js';
import { formatCash } from './save.js';

export function createHUD(G) {
  const hud = {
    speedEl: document.getElementById('speed-value'),
    cashEl: document.getElementById('cash-value'),
    starsEl: document.getElementById('stars'),
    objectiveEl: document.getElementById('objective-text'),
    progressEl: document.getElementById('mission-progress'),
    radioEl: document.getElementById('radio-station'),
    minimap: document.getElementById('minimap'),
    compassEl: document.getElementById('compass-glyph'),
    compassDistEl: document.getElementById('compass-dist'),
    compassWrapEl: document.getElementById('compass-arrow'),
    toastEl: document.getElementById('toast'),
    flashEl: document.getElementById('flash'),
    healthEl: document.getElementById('health-value'),
    carHealthEl: document.getElementById('car-health'),
    missionCountEl: document.getElementById('mission-count'),
    toastTimer: null,
  };
  if (hud.minimap) hud.mapCtx = hud.minimap.getContext('2d');
  return hud;
}

export function updateHUD(G) {
  const hud = G.hud;
  if (!hud) return;
  const player = G.player;
  const speedKmh = player.car ? Math.round(Math.abs(player.car.speed) * 3.6) : Math.round(Math.abs(player.speed || 0) * 3.6);
  if (hud.speedEl) hud.speedEl.textContent = speedKmh;
  if (hud.cashEl) hud.cashEl.textContent = formatCash(G.save.cash);
  if (hud.starsEl) {
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < G.wanted ? '★' : '☆';
    hud.starsEl.textContent = stars;
    hud.starsEl.className = 'stars wanted-' + G.wanted;
  }
  if (hud.healthEl) hud.healthEl.textContent = Math.round(player.health) + '';
  if (hud.carHealthEl) {
    hud.carHealthEl.style.display = player.mode === 'car' ? 'block' : 'none';
    const bar = hud.carHealthEl.querySelector('.bar-fill');
    if (bar) bar.style.width = Math.max(0, player.carHealth) + '%';
  }
  if (hud.missionCountEl) {
    hud.missionCountEl.textContent = 'Job ' + (Math.min(G.missions.index + 1, 6)) + ' / 6';
  }
  if (hud.radioEl) {
    hud.radioEl.textContent = player.mode === 'car' ? (G.audio ? stationNameSafe(G) : 'Radio off') : 'On foot';
  }
  updateObjectiveLine(G);
  drawMinimap(G);
  drawCompass(G);
}

function stationNameSafe(G) {
  try {
    const audio = G.audio;
    if (!audio || !audio.ctx) return 'Radio: ' + ['SOL 98.4', 'PALMA 101', 'MARINA 88'][audio.station % 3];
    const names = ['SOL 98.4 — Sunset FM', 'PALMA 101 — Coast Beats', 'MARINA 88 — Night Drive'];
    return names[audio.station % 3];
  } catch (err) {
    return 'Radio';
  }
}

export function updateObjectiveLine(G) {
  const hud = G.hud;
  if (!hud || !hud.objectiveEl) return;
  let text = '';
  if (G.missions.active) {
    text = G.missions.active.objective;
    if (hud.progressEl) {
      const idx = G.missions.active.index;
      if (idx === 2) {
        hud.progressEl.textContent = 'Tail: ' + Math.floor((G.missions.tailProgress / 75) * 100) + '%  ·  Spotted: ' + (G.missions.tailSpotted > 0 ? '!' : '—');
      } else if (idx === 1 || idx === 3 || idx === 5) {
        hud.progressEl.textContent = 'Time: ' + Math.max(0, Math.ceil(G.missions.timer)) + 's';
      } else {
        hud.progressEl.textContent = '';
      }
    }
  } else if (G.missions.index < 6) {
    text = 'Press M — next job: ' + nextMissionTitle(G);
  } else {
    text = 'All jobs done. Free roam — enjoy Solmar.';
  }
  if (hud.objectiveEl.textContent !== text) hud.objectiveEl.textContent = text;
}

function nextMissionTitle(G) {
  const titles = ['First Fare', 'Hot Delivery', 'Tail Job', 'The Marina Heist', 'Through the Blockade', 'The Sunset Run'];
  return titles[Math.min(G.missions.index, 5)];
}

export function drawMinimap(G) {
  const hud = G.hud;
  if (!hud || !hud.mapCtx || !hud.minimap) return;
  const ctx = hud.mapCtx;
  const size = hud.minimap.width;
  const scale = size / (CITY.half * 2 + 60);
  const toMap = (x, z) => [(x + CITY.half + 30) * scale, (z + CITY.half + 30) * scale];
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(20, 32, 44, 0.92)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#2e7f9e';
  const water = toMap(CITY.half - 40, 0);
  ctx.fillRect(water[0], 0, size - water[0], size);
  ctx.fillStyle = '#e8cf9e';
  const beach = toMap(CITY.half - 52, 0);
  ctx.fillRect(beach[0], 0, water[0] - beach[0], size);
  ctx.strokeStyle = '#5a6b7a';
  ctx.lineWidth = 3;
  for (let i = 0; i <= CITY.blocks; i++) {
    const c = (roadCoordPx(i) + CITY.half + 30) * scale;
    ctx.beginPath(); ctx.moveTo(0, c); ctx.lineTo(size, c); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c, 0); ctx.lineTo(c, size); ctx.stroke();
  }
  ctx.fillStyle = '#c9a06a';
  const sh = toMap(G.city.safehouse.x, G.city.safehouse.z);
  ctx.fillRect(sh[0] - 4, sh[1] - 4, 8, 8);
  ctx.fillStyle = '#ff8fa3';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('H', sh[0] - 3, sh[1] + 4);
  const marina = toMap(G.city.marina.x, G.city.marina.z);
  ctx.fillStyle = '#118ab2';
  ctx.beginPath(); ctx.arc(marina[0], marina[1], 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText('M', marina[0] - 3, marina[1] + 3);
  if (G.missions.marker) {
    const m = toMap(G.missions.marker.x, G.missions.marker.z);
    const pulse = 5 + Math.sin(G.time * 4) * 2;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(m[0], m[1], pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('!', m[0] - 2, m[1] + 3);
  }
  ctx.fillStyle = '#9fb8c8';
  for (const car of G.cars) {
    if (car === G.player.car) continue;
    const p = toMap(car.pos.x, car.pos.z);
    ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
  }
  ctx.fillStyle = '#ff4444';
  for (const cop of G.police) {
    const p = toMap(cop.pos.x, cop.pos.z);
    ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2); ctx.fill();
  }
  if (G.heli) {
    const p = toMap(G.heli.pos.x, G.heli.pos.z);
    ctx.fillStyle = '#ff2222';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('H', p[0] - 4, p[1] + 4);
  }
  const pp = toMap(G.player.pos.x, G.player.pos.z);
  ctx.save();
  ctx.translate(pp[0], pp[1]);
  ctx.rotate(-G.player.heading);
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
}

function roadCoordPx(i) {
  const pitch = CITY.blockSize + CITY.roadWidth;
  return -CITY.half + i * pitch + CITY.roadWidth / 2;
}

export function drawCompass(G) {
  const hud = G.hud;
  if (!hud || !hud.compassEl) return;
  const marker = G.missions.marker;
  if (!marker) {
    if (hud.compassWrapEl) hud.compassWrapEl.style.opacity = '0';
    return;
  }
  const dx = marker.x - G.player.pos.x;
  const dz = marker.z - G.player.pos.z;
  const dist = Math.hypot(dx, dz);
  const worldAngle = Math.atan2(dx, dz);
  const rel = worldAngle - G.player.heading;
  if (hud.compassWrapEl) hud.compassWrapEl.style.opacity = '1';
  hud.compassEl.style.display = 'inline-block';
  hud.compassEl.style.transform = 'rotate(' + (rel * 180 / Math.PI) + 'deg)';
  if (hud.compassDistEl) hud.compassDistEl.textContent = Math.round(dist) + 'm';
}

export function showToast(G, text, kind) {
  const hud = G.hud;
  if (!hud || !hud.toastEl) return;
  hud.toastEl.textContent = text;
  hud.toastEl.className = 'toast show ' + (kind || 'info');
  clearTimeout(hud.toastTimer);
  hud.toastTimer = setTimeout(() => { hud.toastEl.className = 'toast'; }, 2600);
}

export function flashCenter(G, text) {
  const hud = G.hud;
  if (!hud || !hud.flashEl) return;
  hud.flashEl.textContent = text;
  hud.flashEl.classList.add('show');
  setTimeout(() => hud.flashEl.classList.remove('show'), 1800);
}

export function showBriefingCard(G, def) {
  const card = document.getElementById('briefing');
  if (!card) return;
  card.querySelector('.briefing-title').textContent = def.title;
  card.querySelector('.briefing-client').textContent = 'From ' + def.client + ' · Payout $' + def.payout;
  card.querySelector('.briefing-text').textContent = def.briefing;
  card.classList.add('show');
  setTimeout(() => card.classList.remove('show'), 6500);
}

export function showMissionResultCard(G, success, def, detail) {
  const card = document.getElementById('mission-result');
  if (!card) return;
  card.querySelector('.result-title').textContent = success ? 'JOB COMPLETE' : 'JOB FAILED';
  card.querySelector('.result-title').className = 'result-title ' + (success ? 'good' : 'bad');
  card.querySelector('.result-job').textContent = def.title;
  card.querySelector('.result-detail').textContent = detail;
  card.classList.add('show');
  setTimeout(() => card.classList.remove('show'), 4200);
}

export function showTitleScreen(G) {
  document.body.classList.add('on-title');
  const el = document.getElementById('title-screen');
  if (el) el.classList.add('show');
  const cont = document.getElementById('continue-btn');
  if (cont) cont.style.display = G.save.missionIndex > 0 || G.save.totalEarned > 250 ? 'inline-block' : 'none';
}

export function hideTitleScreen(G) {
  document.body.classList.remove('on-title');
  const el = document.getElementById('title-screen');
  if (el) el.classList.remove('show');
}

export function showResultsScreen(G, won, reason) {
  const el = document.getElementById('results-screen');
  if (!el) return;
  el.querySelector('.results-title').textContent = won ? 'SUNSET RUN COMPLETE' : (reason === 'busted' ? 'BUSTED' : 'WRECKED');
  el.querySelector('.results-sub').textContent = won
    ? 'You made the boat. Marisol is already counting the money.'
    : (reason === 'busted' ? 'The Solmar PD caught up with you on foot.' : 'Your ride gave up the ghost in the middle of the chase.');
  el.querySelector('#stat-cash').textContent = formatCash(G.save.cash);
  el.querySelector('#stat-earned').textContent = formatCash(G.save.totalEarned);
  el.querySelector('#stat-jobs').textContent = G.save.stats.jobsDone + ' / 6';
  el.querySelector('#stat-near').textContent = String(G.save.nearMisses);
  el.querySelector('#stat-stolen').textContent = String(G.save.carsStolen);
  el.querySelector('#stat-time').textContent = Math.floor(G.time / 60) + ':' + String(Math.floor(G.time % 60)).padStart(2, '0');
  el.classList.add('show');
}

export function hideResultsScreen(G) {
  const el = document.getElementById('results-screen');
  if (el) el.classList.remove('show');
}

export function showPauseMenu(G, show) {
  const el = document.getElementById('pause-menu');
  if (!el) return;
  el.classList.toggle('show', !!show);
}

export function updateShopList(G) {
  const list = document.getElementById('shop-list');
  if (!list) return;
  list.innerHTML = '';
  const kinds = ['engine', 'armor', 'tires'];
  const names = { engine: 'Turbo Engine', armor: 'Reinforced Frame', tires: 'Grip Tires' };
  const costs = { engine: [800, 2200, 5000], armor: [600, 1800, 4200], tires: [500, 1400, 3200] };
  for (const kind of kinds) {
    const level = G.save.upgrades[kind] || 0;
    const row = document.createElement('div');
    row.className = 'shop-row';
    const label = document.createElement('span');
    label.textContent = names[kind] + ' — Lv ' + level + '/3';
    const btn = document.createElement('button');
    if (level >= 3) {
      btn.textContent = 'MAX';
      btn.disabled = true;
    } else {
      btn.textContent = 'Buy $' + costs[kind][level];
      btn.onclick = () => {
        import('./save.js').then((s) => {
          if (s.buyUpgrade(G.save, kind)) {
            G.showPopup && G.showPopup(names[kind] + ' upgraded to Lv ' + (level + 1), 'good');
            updateShopList(G);
            updateHUD(G);
          } else {
            G.showPopup && G.showPopup('Not enough cash for ' + names[kind], 'bad');
          }
        });
      };
    }
    row.appendChild(label);
    row.appendChild(btn);
    list.appendChild(row);
  }
  const garage = document.getElementById('garage-list');
  if (garage) {
    garage.textContent = G.save.garage.length === 0
      ? 'Garage empty — park a stolen car at the safehouse to keep it.'
      : G.save.garage.map((c) => c.name).join(' · ');
  }
}
