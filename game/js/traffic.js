// traffic.js — ambient traffic: cars that cruise the street grid, turn at
// intersections, stop for the car in front, and panic-brake when the
// player barrels through. Traffic cars are stealable: the player can
// walk up to one, press E, and drive it away (a crime if the police see).
import * as THREE from 'three';
import { Vehicle, CAR_MODELS } from './vehicles.js';
import { makeRng, clamp, angleDiff } from './utils.js';

const TRAFFIC_MODELS = ['sedan', 'sedan', 'taxi', 'coupe', 'van', 'truck', 'sedan', 'coupe'];
const PAINTS = [0x8a2f2f, 0x2f6fb0, 0xd9d2c2, 0x3a3a3a, 0x2e7a4f, 0xc2a15e, 0x7a3a6e, 0x4a6b8a, 0xb0b6bd, 0x5a4a7a];

export class TrafficManager {
  constructor(scene, city, state) {
    this.scene = scene;
    this.city = city;
    this.state = state;
    this.rng = makeRng(4242);
    this.cars = []; // { vehicle, dir: {x,z}, speed, targetSpeed, stopped }
    this.target = 14;
    this.spawnRadius = 170;
    this.despawnRadius = 200;
  }

  spawnInitial(count = 14) {
    for (let i = 0; i < count; i++) this.spawnCar(true);
  }

  randomRoadPoint(nearX, nearZ, minDist = 25) {
    for (let tries = 0; tries < 12; tries++) {
      const x = this.city.nearestStreet(nearX + this.rng.range(-140, 140));
      const z = this.city.nearestStreet(nearZ + this.rng.range(-140, 140));
      const dx = x - nearX, dz = z - nearZ;
      if (Math.sqrt(dx * dx + dz * dz) < minDist) continue;
      // One axis must be a street; pick a travel direction along it.
      if (this.rng.chance(0.5)) return { x, z, dir: { x: this.rng.chance(0.5) ? 1 : -1, z: 0 } };
      return { x, z, dir: { x: 0, z: this.rng.chance(0.5) ? 1 : -1 } };
    }
    return { x: 0, z: 0, dir: { x: 1, z: 0 } };
  }

  spawnCar(anywhere = false) {
    const px = this.playerPos ? this.playerPos.x : 0;
    const pz = this.playerPos ? this.playerPos.z : 0;
    const spot = this.randomRoadPoint(px, pz, anywhere ? 10 : 25);
    // Offset into the right-hand lane of the street.
    const lane = 2.4;
    const x = spot.x + (spot.dir.z !== 0 ? lane : 0) * (spot.dir.x >= 0 ? 1 : -1) * 0;
    const z = spot.z;
    const modelKey = this.rng.pick(TRAFFIC_MODELS);
    const paint = this.rng.pick(PAINTS);
    const heading = Math.atan2(spot.dir.x, spot.dir.z);
    const vehicle = new Vehicle(this.scene, modelKey, x, z, heading, paint);
    vehicle.speed = this.rng.range(7, 13);
    const car = {
      vehicle,
      dir: spot.dir,
      speed: vehicle.speed,
      targetSpeed: this.rng.range(8, 13),
      stopped: 0,
      honkTimer: 0,
      modelKey,
      stealable: true,
    };
    this.cars.push(car);
    return car;
  }

  // The player may steal a stopped-or-slow traffic car. Returns the car
  // object when one is within reach, else null.
  nearestStealable(x, z, maxDist = 4.5) {
    let best = null, bestD = maxDist;
    for (const car of this.cars) {
      if (!car.stealable || !car.vehicle.alive) continue;
      const dx = car.vehicle.pos.x - x, dz = car.vehicle.pos.z - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  removeCar(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    car.vehicle.dispose(this.scene);
  }

  update(dt, playerPos, playerVehicle) {
    this.playerPos = playerPos;
    const others = this.cars.map((c) => c.vehicle);
    if (playerVehicle) others.push(playerVehicle);

    for (const car of [...this.cars]) {
      const v = car.vehicle;
      if (!v.alive) { this.removeCar(car); continue; }
      // Despawn far away, respawn near the player to keep the streets full.
      const dx = v.pos.x - playerPos.x, dz = v.pos.z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > this.despawnRadius) { this.removeCar(car); this.spawnCar(); continue; }

      // Car ahead in the same lane? Slow down / stop.
      let ahead = null, aheadD = 18;
      for (const other of this.cars) {
        if (other === car) continue;
        const ox = other.vehicle.pos.x - v.pos.x;
        const oz = other.vehicle.pos.z - v.pos.z;
        const along = ox * car.dir.x + oz * car.dir.z;
        const side = Math.abs(ox * car.dir.z - oz * car.dir.x);
        if (along > 0 && along < aheadD && side < 3.2) { ahead = other; aheadD = along; }
      }
      // Player car ahead counts too.
      if (playerVehicle && playerVehicle.alive) {
        const ox = playerVehicle.pos.x - v.pos.x;
        const oz = playerVehicle.pos.z - v.pos.z;
        const along = ox * car.dir.x + oz * car.dir.z;
        const side = Math.abs(ox * car.dir.z - oz * car.dir.x);
        if (along > 0 && along < aheadD && side < 3.4) { aheadD = along; ahead = { vehicle: playerVehicle }; }
      }
      // Panic brake when the player is coming at us fast.
      let panic = false;
      if (playerVehicle && playerVehicle.alive) {
        const pdx = playerVehicle.pos.x - v.pos.x;
        const pdz = playerVehicle.pos.z - v.pos.z;
        const pd = Math.sqrt(pdx * pdx + pdz * pdz);
        if (pd < 14 && Math.abs(playerVehicle.speed) > 18) panic = true;
      }

      let target = car.targetSpeed;
      if (ahead) target = aheadD < 7 ? 0 : clamp((aheadD - 7) * 0.9, 0, car.targetSpeed);
      if (panic) target = 0;
      car.speed = THREE.MathUtils.damp(car.speed, target, 2.5, dt);
      v.speed = car.speed;

      // Steer along the street; at an intersection, sometimes turn.
      const atIntersection =
        Math.abs(v.pos.x - this.city.nearestStreet(v.pos.x)) < 1.2 &&
        Math.abs(v.pos.z - this.city.nearestStreet(v.pos.z)) < 1.2;
      if (atIntersection && this.rng.chance(dt * 0.9)) {
        const turn = this.rng.pick(['left', 'right', 'straight']);
        if (turn === 'left') car.dir = { x: car.dir.z, z: -car.dir.x };
        else if (turn === 'right') car.dir = { x: -car.dir.z, z: car.dir.x };
      }
      const wantHeading = Math.atan2(car.dir.x, car.dir.z);
      v.heading += angleDiff(v.heading, wantHeading) * clamp(dt * 3, 0, 1);
      v.pos.x += Math.sin(v.heading) * v.speed * dt;
      v.pos.z += Math.cos(v.heading) * v.speed * dt;
      // Keep on the road: snap the off-axis coordinate to the street.
      if (car.dir.x !== 0) v.pos.z = THREE.MathUtils.damp(v.pos.z, this.city.nearestStreet(v.pos.z) + 2.4 * (car.dir.x > 0 ? 1 : -1) * 0 + 0, 2, dt);
      v.syncVisual(dt);
    }

    // Keep the count topped up.
    while (this.cars.length < this.target) this.spawnCar();
  }

  // Freeze every traffic car (used by the results screen / shot scenes).
  freezeAll() {
    for (const car of this.cars) { car.speed = 0; car.vehicle.speed = 0; }
  }
}
