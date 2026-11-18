// world-events.js — Solmar never sits still. A director rolls a random
// city event every couple of minutes: an armored truck to rob, a street
// festival crowd, a police checkpoint, a sunset photo moment, or a rival
// crew racing through the avenues. Events pay cash, raise heat, and give
// the free-roam city a pulse between Marisol's jobs.

import * as THREE from 'three';
import { CITY, blockCenter, roadCoord, mulberry32, randomRoadPoint } from './city.js';
import { distance2D, makeCar } from './vehicles.js';
import { makePedestrian, removePedestrian } from './pedestrians.js';
import { wantedForCrime } from './police.js';

export const EVENT_DEFS = [
  { id: 'armored-truck', name: 'Armored Truck', weight: 3, cooldown: 150 },
  { id: 'festival', name: 'Street Festival', weight: 3, cooldown: 180 },
  { id: 'checkpoint', name: 'Police Checkpoint', weight: 2, cooldown: 120 },
  { id: 'photo-moment', name: 'Golden Hour Photo', weight: 2, cooldown: 200 },
  { id: 'rival-race', name: 'Rival Crew Race', weight: 2, cooldown: 160 },
];

export function createWorldEvents(G) {
  return {
    timer: 55 + Math.random() * 40,
    active: null,
    activeTimer: 0,
    doneCounts: {},
    truck: null,
    festivalPeds: [],
    checkpointCops: [],
    raceCars: [],
    photoSpot: null,
    lastEventId: null,
  };
}

function pickEvent(G) {
  const events = G.worldEvents;
  const available = EVENT_DEFS.filter((def) => def.id !== events.lastEventId);
  let total = 0;
  for (const def of available) total += def.weight;
  let roll = Math.random() * total;
  for (const def of available) {
    roll -= def.weight;
    if (roll <= 0) return def;
  }
  return available[0];
}

export function updateWorldEvents(G, dt) {
  const events = G.worldEvents;
  if (!events) return;
  if (events.active) {
    events.activeTimer -= dt;
    updateActiveEvent(G, dt);
    if (events.activeTimer <= 0) endEvent(G, false, 'The moment passed.');
    return;
  }
  events.timer -= dt;
  if (events.timer <= 0) {
    const def = pickEvent(G);
    startEvent(G, def);
  }
}

function startEvent(G, def) {
  const events = G.worldEvents;
  events.active = def;
  events.lastEventId = def.id;
  events.activeTimer = def.id === 'festival' ? 75 : 60;
  const rng = mulberry32(G.city.seed + Math.floor(G.time));
  if (def.id === 'armored-truck') {
    const spot = randomRoadPoint(G.city, rng);
    const truck = makeCar(G.scene, 'truck', 0x3a3f44, spot.x, spot.z, Math.PI / 2, { parked: false });
    truck.ai = null;
    truck.traffic = false;
    G.cars.push(truck);
    events.truck = truck;
    import('./missions.js').then((m) => m.setMarker(G, spot.x, spot.z));
    G.showPopup && G.showPopup('ARMORED TRUCK spotted — ram it until it stops, then grab the cash.', 'info');
  } else if (def.id === 'festival') {
    const plaza = blockCenter(4, 4);
    for (let i = 0; i < 16; i++) {
      const ped = makePedestrian(G.scene, plaza.x + (Math.random() - 0.5) * 40, plaza.z + (Math.random() - 0.5) * 40, { state: 'idle' });
      ped.wait = 60 + Math.random() * 30;
      G.peds.push(ped);
      events.festivalPeds.push(ped);
    }
    G.showPopup && G.showPopup('Street festival at the plaza — crowds, music, and pickpocket money if you are quick.', 'info');
  } else if (def.id === 'checkpoint') {
    const ave = { x: roadCoord(4), z: roadCoord(5) };
    import('./police.js').then((police) => {
      for (let i = -1; i <= 1; i++) {
        const cop = police.makePoliceCar(G, ave.x + i * 4, ave.z, 0);
        cop.state = 'block';
        cop.speed = 0;
        G.police.push(cop);
        events.checkpointCops.push(cop);
      }
    });
    G.wanted = Math.max(G.wanted, 1);
    G.showPopup && G.showPopup('Police checkpoint on Solmar Avenue — slip past or smash through.', 'bad');
  } else if (def.id === 'photo-moment') {
    const spot = { x: CITY.half - 50, z: 0 };
    events.photoSpot = spot;
    import('./missions.js').then((m) => m.setMarker(G, spot.x, spot.z));
    G.showPopup && G.showPopup('Golden hour at the beach — reach the photo spot before the sun drops.', 'info');
  } else if (def.id === 'rival-race') {
    const start = { x: roadCoord(2), z: roadCoord(2) };
    for (let i = 0; i < 3; i++) {
      const car = makeCar(G.scene, i === 0 ? 'sports' : 'coupe', [0xc93a2e, 0x1f3a5f, 0xd94f70][i], start.x + i * 5, start.z - i * 6, Math.PI / 2, { traffic: true });
      car.ai = { target: null, speed: 26 + i * 3, wait: 0, lane: 0 };
      G.cars.push(car);
      events.raceCars.push(car);
    }
    G.showPopup && G.showPopup('Rival crew is racing the avenues — beat them to the marina gate!', 'info');
    import('./missions.js').then((m) => m.setMarker(G, CITY.half - 52, 40));
  }
}

function updateActiveEvent(G, dt) {
  const events = G.worldEvents;
  const def = events.active;
  if (!def) return;
  if (def.id === 'armored-truck' && events.truck) {
    const truck = events.truck;
    if (truck.health <= 30) {
      const payout = 800 + Math.floor(Math.random() * 400);
      G.save.cash += payout;
      G.showPopup && G.showPopup('Truck cracked! +$' + payout, 'good');
      wantedForCrime(G, 2, 'armored truck robbery');
      endEvent(G, true, '');
    } else if (distance2D(G.player.pos, truck.pos) > 160) {
      endEvent(G, false, 'The truck got away.');
    }
  } else if (def.id === 'festival') {
    if (G.player.mode === 'foot') {
      for (const ped of events.festivalPeds) {
        if (distance2D(G.player.pos, ped.pos) < 2.5 && ped.knocked <= 0) {
          const take = 15 + Math.floor(Math.random() * 30);
          G.save.cash += take;
          G.showPopup && G.showPopup('Lifted $' + take + ' in the crowd.', 'good');
          ped.knocked = 0.1;
          break;
        }
      }
    }
  } else if (def.id === 'photo-moment' && events.photoSpot) {
    if (distance2D(G.player.pos, events.photoSpot) < 8) {
      G.save.cash += 200;
      G.showPopup && G.showPopup('Golden hour captured — postcard sold for $200.', 'good');
      endEvent(G, true, '');
    }
  } else if (def.id === 'rival-race') {
    if (distance2D(G.player.pos, { x: CITY.half - 52, z: 40 }) < 10) {
      let beat = true;
      for (const car of events.raceCars) {
        if (distance2D(car.pos, { x: CITY.half - 52, z: 40 }) < 12) beat = false;
      }
      if (beat) {
        G.save.cash += 700;
        G.showPopup && G.showPopup('You beat the rival crew! +$700', 'good');
        endEvent(G, true, '');
      }
    }
    for (const car of events.raceCars) {
      if (car.ai) {
        import('./vehicles.js').then((v) => v.updateTrafficCar(G, car, dt));
      }
    }
  } else if (def.id === 'checkpoint') {
    if (distance2D(G.player.pos, { x: roadCoord(4), z: roadCoord(5) }) > 90) {
      endEvent(G, true, 'Slipped past the checkpoint.');
    }
  }
}

export function endEvent(G, success, reason) {
  const events = G.worldEvents;
  if (!events.active) return;
  const def = events.active;
  events.doneCounts[def.id] = (events.doneCounts[def.id] || 0) + 1;
  events.active = null;
  events.timer = 90 + Math.random() * 90;
  if (events.truck) {
    const idx = G.cars.indexOf(events.truck);
    if (idx >= 0) { G.scene.remove(events.truck.mesh); G.cars.splice(idx, 1); }
    events.truck = null;
  }
  for (const ped of events.festivalPeds) removePedestrian(G, ped);
  events.festivalPeds = [];
  for (const cop of events.checkpointCops) {
    const idx = G.police.indexOf(cop);
    if (idx >= 0) G.police.splice(idx, 1);
    G.scene.remove(cop.mesh);
  }
  events.checkpointCops = [];
  for (const car of events.raceCars) {
    const idx = G.cars.indexOf(car);
    if (idx >= 0) { G.scene.remove(car.mesh); G.cars.splice(idx, 1); }
  }
  events.raceCars = [];
  events.photoSpot = null;
  if (!success && reason) G.showPopup && G.showPopup(reason, 'info');
  if (!G.missions.active) import('./missions.js').then((m) => m.clearMarker(G));
}

export function worldEventsSummary(G) {
  const events = G.worldEvents;
  if (!events) return '';
  const done = Object.entries(events.doneCounts).map(([k, v]) => k + '×' + v).join(', ');
  return done ? 'City events: ' + done : 'No city events yet';
}
