// pedestrians.js — Solmar's sidewalk life.
// Pedestrians stroll between sidewalk waypoints, wait at corners, and
// scatter when a car screams past or a crime happens nearby. A few named
// characters (mission contacts) are flagged and stand still at markers.
import * as THREE from 'three';
import { makeRng, clamp, dist2 } from './utils.js';

const SHIRTS = [0xd94f4f, 0x4f7ad9, 0x4fd97a, 0xd9b24f, 0x9a4fd9, 0xe8e8e8, 0x3a3a3a, 0xd97ab0, 0x4fd9c2, 0x8a6a3a];
const PANTS = [0x2b3a4a, 0x3a2b2b, 0x2b2b2b, 0x4a3a5a, 0x6b5a3a];

function makePedMesh(rng, shirt, pants) {
  const group = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: [0xe8b88a, 0xc98a5a, 0x8a5a38, 0xf0c8a0][rng.int(0, 3)], roughness: 0.8 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.8, 0.26), pantsMat);
  legs.position.y = 0.4;
  legs.castShadow = true;
  group.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 0.32), shirtMat);
  torso.position.y = 1.12;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), skinMat);
  head.position.y = 1.66;
  head.castShadow = true;
  group.add(head);
  // Hair cap.
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: [0x1a1a1a, 0x4a2a1a, 0x8a8a8a, 0x2a1a0a][rng.int(0, 3)], roughness: 1 }),
  );
  hair.position.y = 1.7;
  group.add(hair);
  group.userData.legs = legs;
  group.userData.torso = torso;
  return group;
}

export class PedestrianManager {
  constructor(scene, city, state) {
    this.scene = scene;
    this.city = city;
    this.state = state;
    this.rng = makeRng(777);
    this.peds = []; // { mesh, x, z, heading, speed, target, state, wait, name }
    this.target = 26;
    this.spawnRadius = 120;
  }

  spawnInitial(count = 26) {
    for (let i = 0; i < count; i++) this.spawnPed(true);
  }

  randomSidewalkPoint(nearX, nearZ) {
    for (let tries = 0; tries < 10; tries++) {
      const sx = this.city.nearestStreet(nearX + this.rng.range(-90, 90));
      const sz = this.city.nearestStreet(nearZ + this.rng.range(-90, 90));
      // Sidewalk: just off the road edge, on a block corner.
      const x = sx + this.rng.pick([-1, 1]) * this.rng.range(6.5, 12);
      const z = sz + this.rng.pick([-1, 1]) * this.rng.range(6.5, 12);
      if (this.city.insideCollider(x, z, 1)) continue;
      if (Math.abs(x) > 195 || Math.abs(z) > 195) continue;
      return { x, z };
    }
    return { x: nearX + 10, z: nearZ + 10 };
  }

  spawnPed(anywhere = false, opts = {}) {
    const px = this.playerPos ? this.playerPos.x : 0;
    const pz = this.playerPos ? this.playerPos.z : 0;
    const spot = opts.at || this.randomSidewalkPoint(px, pz);
    const mesh = makePedMesh(this.rng, opts.shirt ?? this.rng.pick(SHIRTS), opts.pants ?? this.rng.pick(PANTS));
    mesh.position.set(spot.x, 0, spot.z);
    this.scene.add(mesh);
    const ped = {
      mesh,
      x: spot.x,
      z: spot.z,
      heading: this.rng.range(0, Math.PI * 2),
      speed: 0,
      walkSpeed: this.rng.range(1.1, 2.1),
      target: this.randomSidewalkPoint(spot.x, spot.z),
      state: opts.fixed ? 'fixed' : 'walk',
      wait: 0,
      fleeTimer: 0,
      name: opts.name || null,
      bob: this.rng.range(0, Math.PI * 2),
    };
    if (opts.fixed) ped.target = { x: spot.x, z: spot.z };
    this.peds.push(ped);
    return ped;
  }

  // A named contact who waits at a mission marker (Marisol, the client…).
  spawnContact(name, x, z, shirt) {
    return this.spawnPed(false, { at: { x, z }, fixed: true, name, shirt });
  }

  removePed(ped) {
    const i = this.peds.indexOf(ped);
    if (i >= 0) this.peds.splice(i, 1);
    this.scene.remove(ped.mesh);
  }

  // Scare every ped within radius: they flee away from (x, z).
  scare(x, z, radius = 18) {
    let count = 0;
    for (const ped of this.peds) {
      if (ped.state === 'fixed') continue;
      if (dist2(ped.x, ped.z, x, z) < radius) {
        ped.state = 'flee';
        ped.fleeTimer = this.rng.range(1.5, 3);
        const dx = ped.x - x, dz = ped.z - z;
        const d = Math.max(1, Math.sqrt(dx * dx + dz * dz));
        ped.target = { x: ped.x + (dx / d) * 30, z: ped.z + (dz / d) * 30 };
        count++;
      }
    }
    return count;
  }

  update(dt, playerPos, playerSpeed, playerVehicle) {
    this.playerPos = playerPos;
    for (const ped of [...this.peds]) {
      const distToPlayer = dist2(ped.x, ped.z, playerPos.x, playerPos.z);
      if (distToPlayer > 190 && ped.state !== 'fixed') {
        this.removePed(ped);
        this.spawnPed();
        continue;
      }
      // A fast car nearby spooks pedestrians.
      if (playerVehicle && Math.abs(playerSpeed) > 14 && distToPlayer < 12 && ped.state !== 'fixed' && ped.state !== 'flee') {
        ped.state = 'flee';
        ped.fleeTimer = 1.5;
        const dx = ped.x - playerPos.x, dz = ped.z - playerPos.z;
        const d = Math.max(1, Math.sqrt(dx * dx + dz * dz));
        ped.target = { x: ped.x + (dx / d) * 26, z: ped.z + (dz / d) * 26 };
        this.state.stats.pedsScared += 1;
      }
      if (ped.state === 'fixed') {
        ped.mesh.position.set(ped.x, 0, ped.z);
        continue;
      }
      if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        if (ped.fleeTimer <= 0) ped.state = 'walk';
      }
      if (ped.state === 'wait') {
        ped.wait -= dt;
        if (ped.wait <= 0) {
          ped.state = 'walk';
          ped.target = this.randomSidewalkPoint(ped.x, ped.z);
        }
        ped.speed = 0;
      } else {
        const dx = ped.target.x - ped.x, dz = ped.target.z - ped.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 1.2) {
          if (ped.state === 'flee') { ped.state = 'walk'; }
          else { ped.state = 'wait'; ped.wait = this.rng.range(1, 5); }
          ped.speed = 0;
        } else {
          const want = Math.atan2(dx, dz);
          let diff = want - ped.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          ped.heading += clamp(diff, -3 * dt, 3 * dt);
          const spd = ped.state === 'flee' ? ped.walkSpeed * 2.6 : ped.walkSpeed;
          ped.speed = spd;
          ped.x += Math.sin(ped.heading) * spd * dt;
          ped.z += Math.cos(ped.heading) * spd * dt;
        }
      }
      // Walk bob + mesh sync.
      ped.bob += dt * (ped.speed > 0 ? 9 : 2);
      ped.mesh.position.set(ped.x, ped.speed > 0 ? Math.abs(Math.sin(ped.bob)) * 0.06 : 0, ped.z);
      ped.mesh.rotation.y = ped.heading;
      ped.mesh.userData.torso.rotation.x = ped.speed > 0 ? Math.sin(ped.bob) * 0.08 : 0;
    }
    while (this.peds.length < this.target) this.spawnPed();
  }

  nearestPed(x, z, maxDist = 3) {
    let best = null, bestD = maxDist;
    for (const ped of this.peds) {
      const d = dist2(ped.x, ped.z, x, z);
      if (d < bestD) { bestD = d; best = ped; }
    }
    return best;
  }
}
