// player.js — the driver on foot and behind the wheel.
// On foot: WASD runs, Shift sprints, E enters the nearest car (traffic,
// parked, or the player's own). In a car: the Vehicle physics drives.
// Stealing a car the police can see is a crime; stealing your own or an
// empty parked car is free. The player mesh is a simple driver figure so
// the on-foot moments read on camera and in the minimap.
import * as THREE from 'three';
import { clamp, dist2, angleLerp } from './utils.js';
import { Vehicle, CAR_MODELS } from './vehicles.js';

export function makePlayerMesh() {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0xd94f1e, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2b3a4a, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.8 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.82, 0.28), pants);
  legs.position.y = 0.41;
  legs.castShadow = true;
  group.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.64, 0.34), jacket);
  torso.position.y = 1.14;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  group.add(head);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.27, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.7 }),
  );
  cap.position.y = 1.86;
  group.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.24), cap.material);
  brim.position.set(0, 1.82, 0.28);
  group.add(brim);
  group.userData.legs = legs;
  group.userData.torso = torso;
  return group;
}

export class Player {
  constructor(scene, city, state, audio) {
    this.scene = scene;
    this.city = city;
    this.state = state;
    this.audio = audio;
    this.mesh = makePlayerMesh();
    this.scene.add(this.mesh);
    this.pos = new THREE.Vector3(0, 0, 120);
    this.heading = Math.PI;
    this.speed = 0; // on-foot speed
    this.inCar = false;
    this.vehicle = null; // Vehicle the player drives
    this.vehicleModel = 'sedan';
    this.bob = 0;
    this.enterCooldown = 0;
    this.ownedCars = []; // parked player cars (spawned at start / garage)
  }

  spawnAt(x, z, heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = heading;
  }

  // Give the player a starter car parked by the spawn.
  spawnStarterCar(scene, x, z, heading) {
    const v = new Vehicle(scene, 'sedan', x, z, heading, 0xd94f1e);
    this.ownedCars.push(v);
    return v;
  }

  get position() {
    if (this.inCar && this.vehicle) return this.vehicle.pos;
    return this.pos;
  }

  get forwardSpeed() {
    if (this.inCar && this.vehicle) return this.vehicle.speed;
    return this.speed;
  }

  enterCar(vehicle, stolen) {
    this.inCar = true;
    this.vehicle = vehicle;
    this.state.onFoot = false;
    this.mesh.visible = false;
    this.audio.blip(330, 0.08, 'sine', 0.08);
    if (stolen) {
      this.state.stats.carsStolen += 1;
      // A cop watching the theft makes it a crime.
      this.state.bus.emit('car-stolen', { vehicle });
    }
  }

  exitCar() {
    if (!this.vehicle) return;
    const v = this.vehicle;
    // Step out to the driver's side.
    const sideX = Math.cos(v.heading);
    const sideZ = -Math.sin(v.heading);
    const x = v.pos.x + sideX * 2.2;
    const z = v.pos.z + sideZ * 2.2;
    this.pos.set(x, 0, z);
    this.heading = v.heading;
    this.inCar = false;
    this.vehicle = null;
    this.state.onFoot = true;
    this.mesh.visible = true;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    this.enterCooldown = 0.6;
  }

  // Try to enter the nearest car: owned car, parked car, or traffic car.
  // Returns 'entered' | 'stolen' | 'none'.
  tryEnter(nearby) {
    if (this.enterCooldown > 0 || this.inCar) return 'none';
    const { owned, trafficCar } = nearby;
    if (owned) {
      this.vehicleModel = owned.modelKey;
      this.enterCar(owned, false);
      return 'entered';
    }
    if (trafficCar) {
      this.vehicleModel = trafficCar.modelKey;
      this.enterCar(trafficCar.vehicle, true);
      return 'stolen';
    }
    return 'none';
  }

  update(dt, input, cameraHeading) {
    this.enterCooldown = Math.max(0, this.enterCooldown - dt);
    if (this.inCar) return; // the Vehicle update drives the car in main.js
    // On foot: camera-relative WASD, sprint on Shift.
    const sprint = input.sprint ? 1.75 : 1;
    const walkSpeed = 5.2 * sprint;
    let mx = 0, mz = 0;
    if (input.forward) { mx += Math.sin(cameraHeading); mz += Math.cos(cameraHeading); }
    if (input.back) { mx -= Math.sin(cameraHeading); mz -= Math.cos(cameraHeading); }
    if (input.left) { mx -= Math.cos(cameraHeading); mz += Math.sin(cameraHeading); }
    if (input.right) { mx += Math.cos(cameraHeading); mz -= Math.sin(cameraHeading); }
    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0.01) {
      mx /= len; mz /= len;
      const targetHeading = Math.atan2(mx, mz);
      this.heading = angleLerp(this.heading, targetHeading, clamp(dt * 10, 0, 1));
      this.speed = walkSpeed;
      this.pos.x += mx * walkSpeed * dt;
      this.pos.z += mz * walkSpeed * dt;
      this.state.stats.distanceWalked += walkSpeed * dt;
      this.bob += dt * 11;
    } else {
      this.speed = 0;
      this.bob += dt * 2;
    }
    // Buildings block the player too.
    this.city.resolveCircle(this.pos, 0.6);
    this.pos.x = clamp(this.pos.x, -205, 205);
    this.pos.z = clamp(this.pos.z, -205, 205);
    this.mesh.position.set(this.pos.x, Math.abs(Math.sin(this.bob)) * 0.05, this.pos.z);
    this.mesh.rotation.y = this.heading;
    this.mesh.userData.torso.rotation.x = this.speed > 0 ? Math.sin(this.bob) * 0.1 : 0;
  }

  // Distance helpers for HUD prompts ("Press E to enter").
  nearestOwnedCar(maxDist = 4.5) {
    let best = null, bestD = maxDist;
    for (const v of this.ownedCars) {
      if (!v.alive) continue;
      const d = dist2(v.pos.x, v.pos.z, this.pos.x, this.pos.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }
}
