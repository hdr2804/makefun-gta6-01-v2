// police.js — the Solmar Police Department: patrol cars that cruise until
// the wanted level rises, pursuit cars that chase, ram and PIT the player,
// roadblocks at 3+ stars, and a spotlight helicopter at 4–5 stars.
// Wanted decays when the player breaks line of sight and gains distance.

import * as THREE from 'three';
import { createCarMesh, distance2D } from './vehicles.js';
import { CITY, nearestRoadCoord, resolveCircleCollision, pointHitsCollider } from './city.js';

export function createPoliceCarMesh() {
  const group = createCarMesh('sedan', 0x1a1a1a);
  const barGeo = new THREE.BoxGeometry(1.1, 0.22, 0.5);
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const blueMat = new THREE.MeshBasicMaterial({ color: 0x2244ff });
  const red = new THREE.Mesh(barGeo, redMat);
  red.position.set(-0.4, 1.62, -0.1);
  const blue = new THREE.Mesh(barGeo, blueMat);
  blue.position.set(0.4, 1.62, -0.1);
  group.add(red, blue);
  group.userData.lightRed = red;
  group.userData.lightBlue = blue;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.2, 4.42), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  stripe.position.y = 0.92;
  group.add(stripe);
  return group;
}

export function makePoliceCar(G, x, z, heading) {
  const mesh = createPoliceCarMesh();
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  G.scene.add(mesh);
  const cop = {
    id: 'cop-' + Math.floor(Math.random() * 1e9),
    mesh,
    pos: mesh.position,
    heading,
    speed: 0,
    topSpeed: 40,
    accel: 22,
    length: 4.4,
    width: 1.9,
    health: 100,
    police: true,
    patrol: true,
    state: 'patrol',
    target: null,
    ramCooldown: 0,
    aimOffset: (Math.random() - 0.5) * 12,
    stuckTimer: 0,
    lastPos: { x, z },
    lightPhase: Math.random() * 10,
    siren: true,
  };
  return cop;
}

export function spawnPatrolCars(G, count) {
  for (let i = 0; i < count; i++) {
    const inter = G.city.intersections[Math.floor(Math.random() * G.city.intersections.length)];
    const cop = makePoliceCar(G, inter.x + (Math.random() - 0.5) * 6, inter.z + (Math.random() - 0.5) * 6, Math.random() * Math.PI * 2);
    cop.patrol = true;
    cop.state = 'patrol';
    G.police.push(cop);
  }
}

export function wantedForCrime(G, stars, reason) {
  if (G.state !== 'playing') return;
  const before = G.wanted;
  G.wanted = Math.min(5, G.wanted + stars);
  G.heat = Math.max(G.heat, G.wanted * 20);
  if (G.wanted > before) {
    G.hudFlash && G.hudFlash('WANTED ' + '★'.repeat(G.wanted) + ' — ' + reason);
    G.showPopup && G.showPopup('Wanted level ' + G.wanted + ': ' + reason, 'bad');
  }
  ensurePursuitCars(G);
}

export function ensurePursuitCars(G) {
  const want = G.wanted <= 0 ? 2 : Math.min(6, 1 + G.wanted);
  const pursuing = G.police.filter((c) => c.state === 'pursue').length;
  for (let i = pursuing; i < want; i++) {
    const playerPos = G.player.pos;
    const angle = Math.random() * Math.PI * 2;
    const dist = 55 + Math.random() * 40;
    const x = playerPos.x + Math.cos(angle) * dist;
    const z = playerPos.z + Math.sin(angle) * dist;
    const clampedX = Math.max(-CITY.half + 10, Math.min(CITY.half - 50, x));
    const clampedZ = Math.max(-CITY.half + 10, Math.min(CITY.half - 10, z));
    const cop = makePoliceCar(G, clampedX, clampedZ, Math.random() * Math.PI * 2);
    cop.patrol = false;
    cop.state = 'pursue';
    G.police.push(cop);
  }
  if (G.wanted >= 4 && !G.heli) spawnHelicopter(G);
  if (G.wanted < 4 && G.heli) removeHelicopter(G);
}

export function spawnHelicopter(G) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.6, 2.2), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  const tail = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.6, 0.6), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  tail.position.set(-4.2, 0.4, 0);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.1, 0.5), new THREE.MeshBasicMaterial({ color: 0x888888 }));
  rotor.position.y = 1.1;
  const spot = new THREE.Mesh(new THREE.ConeGeometry(3.2, 26, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  spot.position.set(0, -13, 0);
  spot.rotation.x = Math.PI;
  group.add(body, tail, rotor, spot);
  group.position.set(G.player.pos.x + 20, 34, G.player.pos.z + 10);
  G.scene.add(group);
  G.heli = { mesh: group, rotor, spot, pos: group.position, angle: 0 };
}

export function removeHelicopter(G) {
  if (!G.heli) return;
  G.scene.remove(G.heli.mesh);
  G.heli = null;
}

export function updatePolice(G, dt) {
  const playerPos = G.player.pos;
  const playerCar = G.player.car;
  const playerSpeed = playerCar ? Math.abs(playerCar.speed) : 0;
  for (const cop of G.police) {
    cop.lightPhase += dt * 6;
    const redOn = Math.floor(cop.lightPhase) % 2 === 0;
    if (cop.mesh.userData.lightRed) {
      cop.mesh.userData.lightRed.material.color.setHex(redOn ? 0xff2222 : 0x551111);
      cop.mesh.userData.lightBlue.material.color.setHex(redOn ? 0x111155 : 0x2244ff);
    }
    const distToPlayer = distance2D(cop.pos, playerPos);
    if (G.wanted <= 0 && cop.state === 'pursue') {
      cop.state = 'patrol';
      cop.patrol = true;
    }
    if (G.wanted > 0 && cop.state === 'patrol' && distToPlayer < 70) {
      cop.state = 'pursue';
      cop.patrol = false;
    }
    if (cop.state === 'patrol') {
      updatePatrol(G, cop, dt);
    } else {
      updatePursuit(G, cop, dt, distToPlayer, playerPos, playerCar, playerSpeed);
    }
    cop.mesh.rotation.y = cop.heading;
  }
  updateRoadblocks(G, dt);
  updateHelicopter(G, dt);
  updateWantedDecay(G, dt);
}

function updatePatrol(G, cop, dt) {
  if (!cop.target || distance2D(cop.pos, cop.target) < 7) {
    const inter = G.city.intersections[Math.floor(Math.random() * G.city.intersections.length)];
    cop.target = { x: inter.x, z: inter.z };
  }
  steerToward(cop, cop.target, dt, 1.4);
  cop.speed += Math.max(-16 * dt, Math.min(9 * dt, 10 - cop.speed));
  moveCarForward(G, cop, dt);
}

function updatePursuit(G, cop, dt, distToPlayer, playerPos, playerCar, playerSpeed) {
  const targetSpeed = Math.min(38, 22 + G.wanted * 2.2 + (playerCar ? playerSpeed * 0.4 : 0));
  const predict = playerCar ? 0.5 : 0.2;
  const aimX = playerPos.x + (playerCar ? Math.sin(playerCar.heading) * playerCar.speed * predict : 0) + cop.aimOffset;
  const aimZ = playerPos.z + (playerCar ? Math.cos(playerCar.heading) * playerCar.speed * predict : 0) + cop.aimOffset * 0.5;
  steerToward(cop, { x: aimX, z: aimZ }, dt, 2.4);
  cop.speed += Math.max(-24 * dt, Math.min(cop.accel * dt, targetSpeed - cop.speed));
  if (!playerCar && distToPlayer < 4.5) {
    cop.speed = Math.max(0, cop.speed - 30 * dt);
  }
  moveCarForward(G, cop, dt);
  cop.ramCooldown -= dt;
  if (distToPlayer < 5.5 && cop.ramCooldown <= 0) {
    cop.ramCooldown = 2.0;
    G.onPoliceRam && G.onPoliceRam(cop, distToPlayer);
  }
  if (Math.hypot(cop.pos.x - cop.lastPos.x, cop.pos.z - cop.lastPos.z) < 0.4 * dt * 10) {
    cop.stuckTimer += dt;
    if (cop.stuckTimer > 2.5) {
      cop.heading += Math.PI * 0.7;
      cop.speed = 8;
      cop.stuckTimer = 0;
    }
  } else {
    cop.stuckTimer = 0;
  }
  cop.lastPos.x = cop.pos.x;
  cop.lastPos.z = cop.pos.z;
}

function steerToward(cop, target, dt, rate) {
  const desired = Math.atan2(target.x - cop.pos.x, target.z - cop.pos.z);
  let diff = desired - cop.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  cop.heading += Math.max(-rate * dt, Math.min(rate * dt, diff));
}

function moveCarForward(G, cop, dt) {
  const fx = Math.sin(cop.heading);
  const fz = Math.cos(cop.heading);
  cop.pos.x += fx * cop.speed * dt;
  cop.pos.z += fz * cop.speed * dt;
  const hit = resolveCircleCollision(G.city, cop.pos, 1.5);
  if (hit && hit.kind !== 'prop') {
    cop.heading += Math.PI * 0.45;
    cop.speed *= 0.35;
  }
}

export function updateRoadblocks(G, dt) {
  if (!G.roadblocks) G.roadblocks = [];
  if (G.wanted >= 3 && G.roadblocks.length === 0 && G.state === 'playing') {
    const playerPos = G.player.pos;
    const angle = Math.random() * Math.PI * 2;
    const bx = playerPos.x + Math.cos(angle) * 90;
    const bz = playerPos.z + Math.sin(angle) * 90;
    const cx = Math.max(-CITY.half + 20, Math.min(CITY.half - 60, bx));
    const cz = Math.max(-CITY.half + 20, Math.min(CITY.half - 20, bz));
    const roadX = nearestRoadCoord(cx);
    const roadZ = nearestRoadCoord(cz);
    const vertical = Math.abs(cx - roadX) < Math.abs(cz - roadZ);
    const bx2 = vertical ? roadX : cx;
    const bz2 = vertical ? cz : roadZ;
    for (let i = -1; i <= 1; i++) {
      const cop = makePoliceCar(G, bx2 + (vertical ? i * 3.4 : 0), bz2 + (vertical ? 0 : i * 3.4), vertical ? Math.PI / 2 : 0);
      cop.state = 'block';
      cop.speed = 0;
      cop.patrol = false;
      G.police.push(cop);
      G.roadblocks.push(cop);
    }
    G.showPopup && G.showPopup('Roadblock ahead!', 'bad');
  }
  if (G.wanted < 3 && G.roadblocks.length > 0) {
    for (const cop of G.roadblocks) {
      const idx = G.police.indexOf(cop);
      if (idx >= 0) G.police.splice(idx, 1);
      G.scene.remove(cop.mesh);
    }
    G.roadblocks = [];
  }
}

export function updateHelicopter(G, dt) {
  if (!G.heli) return;
  const heli = G.heli;
  heli.angle += dt * 0.5;
  const px = G.player.pos.x;
  const pz = G.player.pos.z;
  heli.pos.x += ((px + Math.cos(heli.angle) * 16) - heli.pos.x) * Math.min(1, dt * 1.4);
  heli.pos.z += ((pz + Math.sin(heli.angle) * 16) - heli.pos.z) * Math.min(1, dt * 1.4);
  heli.pos.y = 34 + Math.sin(heli.angle * 2) * 2;
  heli.rotor.rotation.y += dt * 22;
  heli.mesh.rotation.y = Math.atan2(px - heli.pos.x, pz - heli.pos.z);
  const dx = px - heli.pos.x;
  const dz = pz - heli.pos.z;
  heli.spot.position.set(dx * 0.12, -13, dz * 0.12);
}

export function hasLineOfSight(G, a, b) {
  for (let t = 0.25; t < 1; t += 0.25) {
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const hit = pointHitsCollider(G.city, x, z, 0.5);
    if (hit && hit.kind === 'building') return false;
  }
  return true;
}

export function updateWantedDecay(G, dt) {
  if (G.wanted <= 0) { G.heat = 0; G.seenTimer = 0; return; }
  const playerPos = G.player.pos;
  let seen = false;
  for (const cop of G.police) {
    if (cop.state !== 'pursue') continue;
    const d = distance2D(cop.pos, playerPos);
    if (d < 35 && hasLineOfSight(G, cop.pos, playerPos)) { seen = true; break; }
  }
  if (G.heli && distance2D(G.heli.pos, playerPos) < 70) seen = true;
  if (seen) {
    G.seenTimer = 0;
    G.heat = Math.min(100, G.heat + dt * 2);
  } else {
    G.seenTimer = (G.seenTimer || 0) + dt;
    if (G.seenTimer > 2.5) {
      G.heat -= dt * 14;
      if (G.heat <= 0) {
        G.wanted -= 1;
        G.heat = G.wanted > 0 ? 60 : 0;
        G.seenTimer = 0;
        if (G.wanted > 0) G.showPopup && G.showPopup('Wanted down to ' + G.wanted + ' star' + (G.wanted > 1 ? 's' : ''), 'good');
        else G.showPopup && G.showPopup('You lost them. Heat is off.', 'good');
        if (G.wanted <= 0) {
          G.save.stats.chasesEscaped += 1;
          for (const cop of G.police) if (cop.state === 'pursue') cop.state = 'patrol';
        } else {
          for (const cop of G.police) {
            if (cop.state === 'pursue' && distance2D(cop.pos, playerPos) > 60) cop.state = 'patrol';
          }
        }
      }
    }
  }
}

export function clearWanted(G, reason) {
  G.wanted = 0;
  G.heat = 0;
  G.seenTimer = 0;
  for (const cop of G.police) {
    if (cop.state === 'pursue') cop.state = 'patrol';
  }
  if (G.roadblocks) {
    for (const cop of G.roadblocks) {
      const idx = G.police.indexOf(cop);
      if (idx >= 0) G.police.splice(idx, 1);
      G.scene.remove(cop.mesh);
    }
    G.roadblocks = [];
  }
  if (G.heli) removeHelicopter(G);
  G.showPopup && G.showPopup(reason || 'Heat cleared.', 'good');
}

export function policeNearPlayer(G, radius) {
  const out = [];
  for (const cop of G.police) {
    if (distance2D(cop.pos, G.player.pos) < radius) out.push(cop);
  }
  return out;
}
