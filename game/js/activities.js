// activities.js — things to do between jobs in Solmar: taxi fares, stunt
// ramps that launch the car into the air, a street race with checkpoints,
// and glowing sunset tokens hidden around the city. Each activity pays
// cash, feeds the save, and keeps the open world alive off-mission.

import * as THREE from 'three';
import { CITY, blockCenter, roadCoord, mulberry32 } from './city.js';
import { distance2D, makeCar } from './vehicles.js';
import { makePedestrian, removePedestrian } from './pedestrians.js';
import { formatCash } from './save.js';

export function createActivities(G) {
  const acts = {
    ramps: [],
    tokens: [],
    tokensCollected: 0,
    fare: null,
    fareCooldown: 8,
    race: null,
    raceCooldown: 20,
    raceBest: G.save.raceBest || null,
  };
  const rng = mulberry32(G.city.seed + 31337);
  const rampSpots = [
    { x: roadCoord(2), z: roadCoord(5), heading: 0 },
    { x: roadCoord(6), z: roadCoord(2), heading: Math.PI / 2 },
    { x: roadCoord(7), z: roadCoord(7), heading: Math.PI },
    { x: roadCoord(3), z: roadCoord(8), heading: -Math.PI / 2 },
  ];
  for (const spot of rampSpots) {
    const ramp = buildRamp(G.scene, spot.x, spot.z, spot.heading);
    acts.ramps.push({ mesh: ramp, x: spot.x, z: spot.z, heading: spot.heading, cooldown: 0 });
  }
  for (let i = 0; i < 12; i++) {
    const bx = Math.floor(rng() * CITY.blocks);
    const bz = Math.floor(rng() * CITY.blocks);
    const c = blockCenter(bx, bz);
    const x = c.x + (rng() - 0.5) * (CITY.blockSize - 10);
    const z = c.z + (rng() - 0.5) * (CITY.blockSize - 10);
    const token = buildToken(G.scene, x, z);
    acts.tokens.push({ mesh: token, x, z, taken: false, spin: rng() * Math.PI * 2 });
  }
  return acts;
}

function buildRamp(scene, x, z, heading) {
  const group = new THREE.Group();
  const rampMat = new THREE.MeshLambertMaterial({ color: 0xff8c42 });
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.5, 7), rampMat);
  ramp.position.y = 0.9;
  ramp.rotation.x = -0.42;
  ramp.castShadow = true;
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.4, 7), new THREE.MeshLambertMaterial({ color: 0x3a3f44 }));
  base.position.y = 0.2;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 0.8), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  stripe.position.set(0, 1.95, 3.2);
  stripe.rotation.x = -0.42;
  group.add(ramp, base, stripe);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  return group;
}

function buildToken(scene, x, z) {
  const geo = new THREE.OctahedronGeometry(0.9);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, 2.2, z);
  scene.add(mesh);
  const ringGeo = new THREE.TorusGeometry(1.5, 0.08, 8, 24);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.5 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 2.2, z);
  scene.add(ring);
  mesh.userData.ring = ring;
  return mesh;
}

export function updateActivities(G, dt) {
  const acts = G.activities;
  if (!acts) return;
  updateRamps(G, dt);
  updateTokens(G, dt);
  updateFare(G, dt);
  updateRace(G, dt);
}

function updateRamps(G, dt) {
  const player = G.player;
  if (player.mode !== 'car' || !player.car) return;
  const car = player.car;
  for (const ramp of G.activities.ramps) {
    ramp.cooldown = Math.max(0, ramp.cooldown - dt);
    if (ramp.cooldown > 0) continue;
    const d = Math.hypot(car.pos.x - ramp.x, car.pos.z - ramp.z);
    if (d < 4.5 && Math.abs(car.speed) > 18 && car.pos.y < 0.5) {
      car.vy = 8.5 + Math.abs(car.speed) * 0.14;
      ramp.cooldown = 3;
      G.effects && import('./effects.js').then((fx) => {
        fx.spawnDust(G.effects, new THREE.Vector3(car.pos.x, 0.5, car.pos.z), 10);
        fx.showPopup(G.effects, 'STUNT RAMP!', 'info');
      });
      import('./audio.js').then((a) => a.blip(G.audio, 660, 0.2, 'square', 0.08));
    }
  }
}

function updateTokens(G, dt) {
  const acts = G.activities;
  const player = G.player;
  for (const token of acts.tokens) {
    if (token.taken) continue;
    token.spin += dt * 2;
    token.mesh.rotation.y = token.spin;
    token.mesh.position.y = 2.2 + Math.sin(token.spin * 1.4) * 0.35;
    token.mesh.userData.ring.rotation.z += dt * 0.8;
    const d = Math.hypot(player.pos.x - token.x, player.pos.z - token.z);
    if (d < 2.6) {
      token.taken = true;
      token.mesh.visible = false;
      token.mesh.userData.ring.visible = false;
      acts.tokensCollected += 1;
      G.save.cash += 50;
      G.showPopup && G.showPopup('Sunset token +' + formatCash(50) + ' (' + acts.tokensCollected + '/12)', 'good');
      import('./audio.js').then((a) => a.playCash(G.audio));
      if (acts.tokensCollected >= 12) {
        G.save.cash += 500;
        G.showPopup && G.showPopup('All 12 tokens — Solmar bonus +$500!', 'good');
      }
    }
  }
}

export function offerFare(G) {
  const acts = G.activities;
  if (!acts || acts.fare || G.missions.active) return false;
  const rng = Math.random;
  const bx = Math.floor(rng() * CITY.blocks);
  const bz = Math.floor(rng() * CITY.blocks);
  const c = blockCenter(bx, bz);
  const ped = makePedestrian(G.scene, c.x + 3, c.z, { name: 'Fare', state: 'idle', isMission: true });
  ped.wait = 9999;
  G.peds.push(ped);
  const destBlock = blockCenter(Math.floor(rng() * CITY.blocks), Math.floor(rng() * CITY.blocks));
  const fare = {
    ped,
    dest: { x: destBlock.x, z: destBlock.z },
    payout: 120 + Math.floor(rng() * 180),
    timer: 90,
    pickedUp: false,
  };
  acts.fare = fare;
  G.showPopup && G.showPopup('Taxi fare waiting — pick up the passenger (yellow marker).', 'info');
  import('./missions.js').then((m) => m.setMarker(G, ped.pos.x, ped.pos.z));
  return true;
}

function updateFare(G, dt) {
  const acts = G.activities;
  acts.fareCooldown -= dt;
  if (!acts.fare) {
    if (acts.fareCooldown <= 0 && G.state === 'playing' && !G.missions.active && G.player.mode === 'car') {
      offerFare(G);
      acts.fareCooldown = 45;
    }
    return;
  }
  const fare = acts.fare;
  fare.timer -= dt;
  if (fare.timer <= 0) {
    endFare(G, false, 'The fare got tired of waiting.');
    return;
  }
  const playerPos = G.player.pos;
  if (!fare.pickedUp) {
    if (distance2D(playerPos, fare.ped.pos) < 4.5) {
      fare.pickedUp = true;
      removePedestrian(G, fare.ped);
      fare.ped = null;
      G.showPopup && G.showPopup('Passenger aboard — ' + Math.round(fare.timer) + 's to the destination.', 'good');
      import('./missions.js').then((m) => m.setMarker(G, fare.dest.x, fare.dest.z));
    }
  } else if (distance2D(playerPos, fare.dest) < 10) {
    endFare(G, true, '');
  }
}

function endFare(G, success, reason) {
  const acts = G.activities;
  const fare = acts.fare;
  acts.fare = null;
  acts.fareCooldown = 30;
  if (fare.ped) removePedestrian(G, fare.ped);
  import('./missions.js').then((m) => { if (!G.missions.active) m.clearMarker(G); });
  if (success) {
    G.save.cash += fare.payout;
    G.showPopup && G.showPopup('Fare complete +$' + fare.payout, 'good');
    import('./audio.js').then((a) => a.playCash(G.audio));
  } else {
    G.showPopup && G.showPopup(reason, 'bad');
  }
}

export function startRace(G) {
  const acts = G.activities;
  if (!acts || acts.race || G.missions.active) return false;
  if (G.player.mode !== 'car') {
    G.showPopup && G.showPopup('Get in a car to start the street race.', 'info');
    return false;
  }
  const gates = [
    { x: roadCoord(6), z: roadCoord(2) },
    { x: roadCoord(8), z: roadCoord(5) },
    { x: roadCoord(5), z: roadCoord(8) },
    { x: roadCoord(2), z: roadCoord(6) },
    { x: roadCoord(2), z: roadCoord(2) },
  ];
  acts.race = { gates, index: 0, timer: 0, startedAt: G.time };
  G.showPopup && G.showPopup('Street race! Hit all 5 gates as fast as you can.', 'info');
  import('./missions.js').then((m) => m.setMarker(G, gates[0].x, gates[0].z));
  return true;
}

function updateRace(G, dt) {
  const acts = G.activities;
  acts.raceCooldown -= dt;
  if (!acts.race) {
    if (acts.raceCooldown <= 0 && G.state === 'playing' && !G.missions.active && G.player.mode === 'car' && Math.random() < dt * 0.02) {
      G.showPopup && G.showPopup('Press T to start a street race.', 'info');
      acts.raceCooldown = 60;
    }
    return;
  }
  const race = acts.race;
  race.timer += dt;
  const gate = race.gates[race.index];
  if (distance2D(G.player.pos, gate) < 11) {
    race.index += 1;
    import('./audio.js').then((a) => a.blip(G.audio, 1040, 0.15, 'sine', 0.12));
    if (race.index >= race.gates.length) {
      const total = race.timer;
      const best = acts.raceBest;
      const isBest = best === null || total < best;
      if (isBest) acts.raceBest = total;
      const payout = isBest ? 600 : 250;
      G.save.cash += payout;
      G.save.raceBest = acts.raceBest;
      G.showPopup && G.showPopup('Race done in ' + total.toFixed(1) + 's' + (isBest ? ' — NEW BEST!' : '') + ' +$' + payout, 'good');
      acts.race = null;
      import('./missions.js').then((m) => { if (!G.missions.active) m.clearMarker(G); });
    } else {
      G.showPopup && G.showPopup('Gate ' + race.index + '/' + race.gates.length, 'info');
      import('./missions.js').then((m) => m.setMarker(G, race.gates[race.index].x, race.gates[race.index].z));
    }
  }
  if (race.timer > 240) {
    acts.race = null;
    G.showPopup && G.showPopup('Race abandoned — too slow.', 'bad');
    import('./missions.js').then((m) => { if (!G.missions.active) m.clearMarker(G); });
  }
}

export function activitiesStatus(G) {
  const acts = G.activities;
  if (!acts) return '';
  const parts = [];
  parts.push('Tokens ' + acts.tokensCollected + '/12');
  if (acts.raceBest !== null) parts.push('Race best ' + acts.raceBest.toFixed(1) + 's');
  if (acts.fare) parts.push('Fare active');
  return parts.join(' · ');
}
