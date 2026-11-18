// pedestrians.js — the people of Solmar: sidewalk walkers, beach strollers,
// cafe crowds and mission characters, with simple sidewalk-following AI,
// panic fleeing when a car barrels at them, and knock-down reactions.

import * as THREE from 'three';
import { CITY, blockCenter, mulberry32 } from './city.js';

const SHIRT_COLORS = [0xe8641b, 0x0e7c86, 0xd94f70, 0xf2c200, 0x6a5acd, 0x2f8f4e, 0xe8dcc0, 0xc93a2e, 0x118ab2, 0xff8fa3];
const SKIN_COLORS = [0xf2c9a0, 0xd9a06b, 0x8a5a3b, 0xe8b88a, 0x6b4226];
const FIRST_NAMES = ['Lucia', 'Diego', 'Carmen', 'Mateo', 'Sofia', 'Rafael', 'Elena', 'Jorge', 'Nina', 'Pablo', 'Rosa', 'Tomas', 'Isabel', 'Hugo', 'Marta', 'Felix', 'Luna', 'Andres', 'Valeria', 'Oscar'];

export function createPedMesh(shirtColor, skinColor) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const skin = new THREE.MeshLambertMaterial({ color: skinColor });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2a2f3a });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.8, 0.28), pants);
  legs.position.y = 0.4;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.72, 0.32), shirt);
  torso.position.y = 1.16;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), skin);
  head.position.y = 1.78;
  head.castShadow = true;
  const armGeo = new THREE.BoxGeometry(0.13, 0.62, 0.13);
  const armL = new THREE.Mesh(armGeo, shirt);
  armL.position.set(-0.36, 1.15, 0);
  const armR = new THREE.Mesh(armGeo, shirt);
  armR.position.set(0.36, 1.15, 0);
  group.add(legs, torso, head, armL, armR);
  group.userData.armL = armL;
  group.userData.armR = armR;
  group.userData.legs = legs;
  return group;
}

export function makePedestrian(scene, x, z, opts) {
  const options = opts || {};
  const shirt = options.shirt !== undefined ? options.shirt : SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)];
  const skin = options.skin !== undefined ? options.skin : SKIN_COLORS[Math.floor(Math.random() * SKIN_COLORS.length)];
  const mesh = createPedMesh(shirt, skin);
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const ped = {
    id: 'ped-' + Math.floor(Math.random() * 1e9),
    name: options.name || FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)],
    mesh,
    pos: mesh.position,
    heading: Math.random() * Math.PI * 2,
    speed: 1.1 + Math.random() * 0.9,
    target: null,
    state: options.state || 'walk',
    wait: 0,
    panic: 0,
    knocked: 0,
    walkPhase: Math.random() * Math.PI * 2,
    home: { x, z },
    isMission: !!options.isMission,
    color: shirt,
  };
  return ped;
}

export function spawnPedestrians(G, count) {
  const rng = mulberry32(G.city.seed + 55);
  for (let i = 0; i < count; i++) {
    const bx = Math.floor(rng() * CITY.blocks);
    const bz = Math.floor(rng() * CITY.blocks);
    const c = blockCenter(bx, bz);
    const x = c.x + (rng() - 0.5) * (CITY.blockSize - 14);
    const z = c.z + (rng() - 0.5) * (CITY.blockSize - 14);
    const ped = makePedestrian(G.scene, x, z, {});
    ped.target = pickPedTarget(G, ped, rng);
    G.peds.push(ped);
  }
  const beachCount = Math.floor(count * 0.2);
  for (let i = 0; i < beachCount; i++) {
    const z = (rng() - 0.5) * CITY.half * 1.6;
    const ped = makePedestrian(G.scene, CITY.half - 48 + rng() * 6, z, { state: 'stroll' });
    ped.speed = 0.8 + rng() * 0.5;
    ped.target = { x: CITY.half - 48 + rng() * 6, z: z + (rng() - 0.5) * 80 };
    G.peds.push(ped);
  }
}

function pickPedTarget(G, ped, rng) {
  const r = rng || Math.random;
  const bx = Math.floor(r() * CITY.blocks);
  const bz = Math.floor(r() * CITY.blocks);
  const c = blockCenter(bx, bz);
  return {
    x: c.x + (r() - 0.5) * (CITY.blockSize - 14),
    z: c.z + (r() - 0.5) * (CITY.blockSize - 14),
  };
}

export function updatePedestrians(G, dt) {
  const playerPos = G.player ? G.player.pos : null;
  const playerCar = G.player && G.player.car ? G.player.car : null;
  for (const ped of G.peds) {
    if (ped.knocked > 0) {
      ped.knocked -= dt;
      ped.mesh.rotation.x = ped.knocked > 0 ? -Math.PI / 2 + 0.3 : 0;
      if (ped.knocked <= 0) ped.mesh.rotation.x = 0;
      continue;
    }
    let threat = null;
    let threatDist = 9;
    if (playerCar && Math.abs(playerCar.speed) > 8) {
      const d = Math.hypot(playerCar.pos.x - ped.pos.x, playerCar.pos.z - ped.pos.z);
      if (d < threatDist) { threat = playerCar.pos; threatDist = d; }
    }
    for (const cop of G.police) {
      if (Math.abs(cop.speed) < 10) continue;
      const d = Math.hypot(cop.pos.x - ped.pos.x, cop.pos.z - ped.pos.z);
      if (d < 7) { threat = cop.pos; threatDist = d; }
    }
    if (threat) {
      ped.panic = 1.6;
      const dx = ped.pos.x - threat.x;
      const dz = ped.pos.z - threat.z;
      const len = Math.hypot(dx, dz) || 1;
      ped.heading = Math.atan2(dx / len, dz / len);
      ped.pos.x += Math.sin(ped.heading) * 4.4 * dt;
      ped.pos.z += Math.cos(ped.heading) * 4.4 * dt;
      ped.mesh.rotation.y = ped.heading;
      ped.walkPhase += dt * 14;
    } else if (ped.panic > 0) {
      ped.panic -= dt;
      ped.pos.x += Math.sin(ped.heading) * 3.2 * dt;
      ped.pos.z += Math.cos(ped.heading) * 3.2 * dt;
      ped.mesh.rotation.y = ped.heading;
      ped.walkPhase += dt * 12;
    } else if (ped.state === 'idle') {
      ped.wait -= dt;
      if (ped.wait <= 0) {
        ped.state = 'walk';
        ped.target = pickPedTarget(G, ped);
      }
      ped.walkPhase += dt * 2;
    } else {
      if (!ped.target || Math.hypot(ped.target.x - ped.pos.x, ped.target.z - ped.pos.z) < 2) {
        if (Math.random() < 0.25) {
          ped.state = 'idle';
          ped.wait = 2 + Math.random() * 6;
        } else {
          ped.target = pickPedTarget(G, ped);
        }
      } else {
        const dx = ped.target.x - ped.pos.x;
        const dz = ped.target.z - ped.pos.z;
        const desired = Math.atan2(dx, dz);
        let diff = desired - ped.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        ped.heading += Math.max(-3 * dt, Math.min(3 * dt, diff));
        ped.pos.x += Math.sin(ped.heading) * ped.speed * dt;
        ped.pos.z += Math.cos(ped.heading) * ped.speed * dt;
        ped.mesh.rotation.y = ped.heading;
        ped.walkPhase += dt * 7;
      }
    }
    const swing = Math.sin(ped.walkPhase) * 0.5;
    if (ped.mesh.userData.armL) {
      ped.mesh.userData.armL.rotation.x = swing;
      ped.mesh.userData.armR.rotation.x = -swing;
    }
    if (ped.mesh.userData.legs) ped.mesh.userData.legs.rotation.x = swing * 0.4;
  }
}

export function knockPedestrian(G, ped, fromPos) {
  if (ped.knocked > 0) return false;
  ped.knocked = 2.2;
  ped.panic = 0;
  const dx = ped.pos.x - fromPos.x;
  const dz = ped.pos.z - fromPos.z;
  const len = Math.hypot(dx, dz) || 1;
  ped.pos.x += (dx / len) * 1.2;
  ped.pos.z += (dz / len) * 1.2;
  return true;
}

export function pedsNear(G, x, z, radius) {
  const out = [];
  for (const ped of G.peds) {
    if (Math.hypot(ped.pos.x - x, ped.pos.z - z) < radius) out.push(ped);
  }
  return out;
}

export function removePedestrian(G, ped) {
  const idx = G.peds.indexOf(ped);
  if (idx >= 0) G.peds.splice(idx, 1);
  G.scene.remove(ped.mesh);
}
