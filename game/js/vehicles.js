// vehicles.js — cars of Solmar: mesh builder, arcade driving physics,
// traffic AI that cruises the road grid, and parked cars to steal.
// Every car is boxes + cylinders: no external models, no network.

import * as THREE from 'three';
import { CITY, roadCoord, nearestRoadCoord, resolveCircleCollision, mulberry32 } from './city.js';

export const CAR_COLORS = [
  { name: 'Sunset Orange', color: 0xe8641b },
  { name: 'Marina Teal', color: 0x0e7c86 },
  { name: 'Palm Green', color: 0x2f8f4e },
  { name: 'Bougainvillea Pink', color: 0xd94f70 },
  { name: 'Sand Cream', color: 0xe8dcc0 },
  { name: 'Midnight Blue', color: 0x1f3a5f },
  { name: 'Taxi Yellow', color: 0xf2c200 },
  { name: 'Coral Red', color: 0xc93a2e },
  { name: 'Graphite', color: 0x3a3f44 },
  { name: 'Sky White', color: 0xf2f2f2 },
];

export const CAR_KINDS = {
  sedan: { length: 4.4, width: 1.9, topSpeed: 34, accel: 16, name: 'Sedan' },
  coupe: { length: 4.1, width: 1.85, topSpeed: 42, accel: 19, name: 'Coupe' },
  truck: { length: 5.4, width: 2.1, topSpeed: 28, accel: 12, name: 'Pickup' },
  taxi: { length: 4.4, width: 1.9, topSpeed: 33, accel: 15, name: 'Taxi' },
  van: { length: 5.0, width: 2.0, topSpeed: 27, accel: 11, name: 'Van' },
  sports: { length: 4.2, width: 1.95, topSpeed: 48, accel: 24, name: 'Sports' },
};

let carIdCounter = 0;

export function createCarMesh(kindName, colorHex) {
  const kind = CAR_KINDS[kindName] || CAR_KINDS.sedan;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: colorHex });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1c2a33 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(kind.width, 0.75, kind.length), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(kind.width * 0.82, 0.62, kind.length * 0.48), glassMat);
  cabin.position.set(0, 1.2, -kind.length * 0.06);
  cabin.castShadow = true;
  group.add(cabin);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(kind.width * 0.9, 0.3, 0.5), bodyMat);
  nose.position.set(0, 0.45, kind.length / 2 + 0.1);
  group.add(nose);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const wheelPositions = [
    [-kind.width / 2, kind.length * 0.32], [kind.width / 2, kind.length * 0.32],
    [-kind.width / 2, -kind.length * 0.32], [kind.width / 2, -kind.length * 0.32],
  ];
  const wheels = [];
  for (const [wx, wz] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
    wheels.push(wheel);
  }
  const lightGeo = new THREE.BoxGeometry(0.34, 0.18, 0.08);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  const leftLight = new THREE.Mesh(lightGeo, lightMat);
  leftLight.position.set(-kind.width * 0.32, 0.62, kind.length / 2 + 0.36);
  const rightLight = new THREE.Mesh(lightGeo, lightMat);
  rightLight.position.set(kind.width * 0.32, 0.62, kind.length / 2 + 0.36);
  group.add(leftLight, rightLight);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const leftTail = new THREE.Mesh(lightGeo, tailMat);
  leftTail.position.set(-kind.width * 0.32, 0.62, -kind.length / 2 - 0.36);
  const rightTail = new THREE.Mesh(lightGeo, tailMat);
  rightTail.position.set(kind.width * 0.32, 0.62, -kind.length / 2 - 0.36);
  group.add(leftTail, rightTail);
  group.userData.wheels = wheels;
  return group;
}

export function makeCar(scene, kindName, colorHex, x, z, heading, opts) {
  const options = opts || {};
  const kind = CAR_KINDS[kindName] || CAR_KINDS.sedan;
  const colorEntry = CAR_COLORS.find((c) => c.color === colorHex) || CAR_COLORS[0];
  const mesh = createCarMesh(kindName, colorHex);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  scene.add(mesh);
  const car = {
    id: 'car-' + (++carIdCounter) + '-' + Math.floor(Math.random() * 1e6),
    kind: kindName,
    kindLabel: kind.name,
    color: colorHex,
    colorName: colorEntry.name,
    name: kind.name + ' · ' + colorEntry.name,
    mesh,
    pos: mesh.position,
    heading,
    speed: 0,
    steer: 0,
    vy: 0,
    topSpeed: kind.topSpeed,
    accel: kind.accel,
    length: kind.length,
    width: kind.width,
    health: 100,
    traffic: !!options.traffic,
    parked: !!options.parked,
    police: !!options.police,
    ai: options.traffic ? { target: null, speed: 9 + Math.random() * 5, wait: 0, lane: Math.random() < 0.5 ? 2.2 : -2.2 } : null,
    driver: null,
    hornTimer: 0,
    brakeLight: false,
  };
  return car;
}

export function removeCar(scene, car) {
  scene.remove(car.mesh);
}

export function driveCar(G, car, input, dt) {
  const save = G.save;
  const engineMul = car.police ? 1.12 : (1 + 0.14 * (save.upgrades.engine || 0));
  const gripMul = car.police ? 1 : (1 + 0.12 * (save.upgrades.tires || 0));
  const topSpeed = car.topSpeed * engineMul;
  let throttle = 0;
  if (input.forward) throttle += 1;
  if (input.back) throttle -= 0.55;
  const targetAccel = throttle * car.accel * engineMul;
  car.speed += targetAccel * dt;
  if (!input.forward && !input.back) {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 9 * dt);
  }
  if (input.handbrake) {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 26 * dt);
  }
  car.speed = Math.max(-topSpeed * 0.45, Math.min(topSpeed, car.speed));
  const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const speedRatio = Math.min(1, Math.abs(car.speed) / topSpeed);
  const steerRate = 1.9 * gripMul * (1 - 0.45 * speedRatio);
  car.steer += (steerInput - car.steer) * Math.min(1, dt * 8);
  if (Math.abs(car.speed) > 0.4) {
    const dir = car.speed >= 0 ? 1 : -1;
    car.heading += car.steer * steerRate * dt * dir * (input.handbrake ? 1.6 : 1);
  }
  const forwardX = Math.sin(car.heading);
  const forwardZ = Math.cos(car.heading);
  const nx = car.pos.x + forwardX * car.speed * dt;
  const nz = car.pos.z + forwardZ * car.speed * dt;
  if (car.vy === undefined) car.vy = 0;
  if (car.pos.y > 0 || car.vy !== 0) {
    car.vy -= 24 * dt;
    car.pos.y += car.vy * dt;
    if (car.pos.y <= 0) {
      if (car.vy < -6) {
        G.onCrash && G.onCrash(Math.abs(car.vy), 'landing');
        G.effects && spawnLandingDust(G, car);
      }
      car.pos.y = 0;
      car.vy = 0;
    }
  }
  const oldX = car.pos.x;
  const oldZ = car.pos.z;
  car.pos.x = nx;
  car.pos.z = nz;
  const hit = resolveCircleCollision(G.city, car.pos, 1.6);
  if (hit) {
    if (hit.kind === 'prop') {
      G.effects && spawnPropSmash(G, hit.prop);
      car.speed *= 0.82;
    } else if (hit.kind === 'water') {
      car.pos.x = oldX;
      car.pos.z = oldZ;
      car.speed *= -0.25;
      G.onCrash && G.onCrash(Math.abs(car.speed), 'water');
    } else if (hit.nx !== undefined) {
      const dot = forwardX * hit.nx + forwardZ * hit.nz;
      if (dot < 0) {
        car.speed *= -0.3;
        G.onCrash && G.onCrash(Math.abs(car.speed), 'wall');
      } else {
        car.speed *= 0.6;
      }
    }
  }
  car.mesh.rotation.y = car.heading;
  const wheels = car.mesh.userData.wheels || [];
  for (const wheel of wheels) wheel.rotation.x += car.speed * dt * 2.2;
  if (wheels.length >= 2) {
    wheels[0].rotation.y = car.steer * 0.4;
    wheels[1].rotation.y = car.steer * 0.4;
  }
  if (input.handbrake && Math.abs(car.speed) > 12 && Math.random() < dt * 20) {
    G.addSkid && G.addSkid(car.pos.x - forwardX * 1.4, car.pos.z - forwardZ * 1.4, car.heading);
  }
  return { speedRatio, topSpeed };
}

function spawnPropSmash(G, prop) {
  if (!G.effects) return;
  import('./effects.js').then((fx) => {
    fx.spawnBurst(G.effects, new THREE.Vector3(prop.x, 1, prop.z), 0xd96c2c, 12, 5, 3, 10);
  });
}

function spawnLandingDust(G, car) {
  if (!G.effects) return;
  import('./effects.js').then((fx) => fx.spawnDust(G.effects, new THREE.Vector3(car.pos.x, 0.5, car.pos.z), 10));
}

export function updateTrafficCar(G, car, dt) {
  if (!car.ai) return;
  const ai = car.ai;
  if (ai.wait > 0) { ai.wait -= dt; car.speed = Math.max(0, car.speed - 20 * dt); return; }
  if (!ai.target || distance2D(car.pos, ai.target) < 6) {
    ai.target = pickTrafficTarget(G, car);
  }
  const dx = ai.target.x - car.pos.x;
  const dz = ai.target.z - car.pos.z;
  const desired = Math.atan2(dx, dz);
  let diff = desired - car.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  car.heading += Math.max(-1.6 * dt, Math.min(1.6 * dt, diff));
  const ahead = carAheadBlocked(G, car, 9);
  const targetSpeed = ahead ? 0 : ai.speed;
  car.speed += Math.max(-18 * dt, Math.min(12 * dt, targetSpeed - car.speed));
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  car.pos.x += fx * car.speed * dt;
  car.pos.z += fz * car.speed * dt;
  const hit = resolveCircleCollision(G.city, car.pos, 1.5);
  if (hit && hit.kind !== 'prop') {
    car.heading += Math.PI * 0.5;
    car.speed *= 0.4;
  }
  car.mesh.rotation.y = car.heading;
}

export function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function pickTrafficTarget(G, car) {
  const onVerticalRoad = Math.abs(car.pos.x - nearestRoadCoord(car.pos.x)) < Math.abs(car.pos.z - nearestRoadCoord(car.pos.z));
  const intersections = G.city.intersections;
  let best = null;
  let bestScore = Infinity;
  for (const inter of intersections) {
    const aligned = onVerticalRoad ? Math.abs(inter.x - nearestRoadCoord(car.pos.x)) < 2 : Math.abs(inter.z - nearestRoadCoord(car.pos.z)) < 2;
    if (!aligned) continue;
    const d = distance2D(car.pos, inter);
    if (d < 8 || d > 320) continue;
    const headingTo = Math.atan2(inter.x - car.pos.x, inter.z - car.pos.z);
    let diff = Math.abs(headingTo - car.heading);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    const score = d + diff * 60;
    if (score < bestScore) { bestScore = score; best = inter; }
  }
  if (!best) {
    const inter = intersections[Math.floor(Math.random() * intersections.length)];
    return { x: inter.x, z: inter.z };
  }
  return { x: best.x + (Math.random() - 0.5) * 4, z: best.z + (Math.random() - 0.5) * 4 };
}

function carAheadBlocked(G, car, range) {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const aheadX = car.pos.x + fx * range;
  const aheadZ = car.pos.z + fz * range;
  for (const other of G.cars) {
    if (other === car) continue;
    const dx = other.pos.x - car.pos.x;
    const dz = other.pos.z - car.pos.z;
    const along = dx * fx + dz * fz;
    if (along > 0 && along < range + 3 && Math.abs(dx * fz - dz * fx) < 2.6) return true;
  }
  const playerCar = G.player && G.player.car;
  if (playerCar && playerCar !== car) {
    const dx = playerCar.pos.x - car.pos.x;
    const dz = playerCar.pos.z - car.pos.z;
    const along = dx * fx + dz * fz;
    if (along > 0 && along < range + 3 && Math.abs(dx * fz - dz * fx) < 2.6) return true;
  }
  return false;
}

export function spawnTraffic(G, count) {
  const rng = mulberry32(G.city.seed + 77);
  const kinds = Object.keys(CAR_KINDS);
  for (let i = 0; i < count; i++) {
    const inter = G.city.intersections[Math.floor(rng() * G.city.intersections.length)];
    const vertical = rng() < 0.5;
    const x = vertical ? inter.x : inter.x + (rng() - 0.5) * 120;
    const z = vertical ? inter.z + (rng() - 0.5) * 120 : inter.z;
    const heading = vertical ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const color = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)].color;
    const car = makeCar(G.scene, kind, color, x, z, heading, { traffic: true });
    car.ai.speed = 8 + rng() * 6;
    G.cars.push(car);
  }
}

export function spawnParkedCars(G, count) {
  const rng = mulberry32(G.city.seed + 991);
  const kinds = ['sedan', 'coupe', 'sports', 'truck', 'taxi', 'van'];
  const spots = [];
  for (let i = 0; i < count; i++) {
    const inter = G.city.intersections[Math.floor(rng() * G.city.intersections.length)];
    const side = rng() < 0.5;
    const x = side ? inter.x + 5.6 : inter.x - 5.6;
    const z = inter.z + (rng() - 0.5) * 60;
    if (distance2D({ x, z }, { x: G.city.safehouse.x, z: G.city.safehouse.z }) < 18) continue;
    if (spots.some((s) => distance2D(s, { x, z }) < 12)) continue;
    spots.push({ x, z });
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const color = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)].color;
    const heading = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.2;
    const car = makeCar(G.scene, kind, color, x, z, heading, { parked: true });
    G.cars.push(car);
  }
}

export function nearestCar(G, x, z, maxDist, includeTraffic) {
  let best = null;
  let bestD = maxDist;
  for (const car of G.cars) {
    if (car.traffic && !includeTraffic) continue;
    if (car.police) continue;
    const d = Math.hypot(car.pos.x - x, car.pos.z - z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

export function carsCollide(a, b) {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const dist = Math.hypot(dx, dz);
  const minDist = 2.6;
  if (dist >= minDist || dist < 0.001) return null;
  const nx = dx / dist;
  const nz = dz / dist;
  const push = (minDist - dist) / 2;
  return { nx, nz, push, overlap: minDist - dist };
}
