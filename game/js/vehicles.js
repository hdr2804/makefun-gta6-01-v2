// vehicles.js — car meshes and arcade driving physics.
// Every car is a small group of boxes: body, cabin, wheels, headlights,
// and (for police) a light bar. No imported models, no textures: paint
// colours and shapes carry the variety. Physics is deliberately arcade:
// accelerate / brake / reverse, steering that tightens at low speed,
// a drift factor on handbrake, and simple circle collisions.
import * as THREE from 'three';
import { clamp, damp, angleLerp } from './utils.js';

export const CAR_MODELS = {
  sedan: { name: 'Sedan', length: 4.4, width: 1.9, topSpeed: 30, accel: 16, grip: 0.92, color: 0x8a2f2f },
  taxi: { name: 'Taxi', length: 4.4, width: 1.9, topSpeed: 27, accel: 15, grip: 0.92, color: 0xe8b23a },
  coupe: { name: 'Coupe', length: 4.1, width: 1.85, topSpeed: 34, accel: 19, grip: 0.95, color: 0x2f6fb0 },
  sports: { name: 'Sunset GT', length: 4.2, width: 1.95, topSpeed: 42, accel: 24, grip: 0.97, color: 0xd94f1e, rare: true },
  truck: { name: 'Truck', length: 5.6, width: 2.1, topSpeed: 22, accel: 11, grip: 0.88, color: 0x5a6b52 },
  van: { name: 'Van', length: 5.0, width: 2.0, topSpeed: 24, accel: 12, grip: 0.9, color: 0xcfc8bd },
  police: { name: 'Interceptor', length: 4.5, width: 1.95, topSpeed: 36, accel: 22, grip: 0.95, color: 0x1c1e26 },
  muscle: { name: 'Muscle', length: 4.6, width: 2.0, topSpeed: 36, accel: 20, grip: 0.9, color: 0x6a1f8a, rare: true },
};

const PAINTS = [0x8a2f2f, 0x2f6fb0, 0xd9d2c2, 0x3a3a3a, 0x2e7a4f, 0xc2a15e, 0x7a3a6e, 0x4a6b8a, 0xb0b6bd, 0xd94f1e];

export function makeCarMesh(modelKey, paintColor = null) {
  const model = CAR_MODELS[modelKey] || CAR_MODELS.sedan;
  const color = paintColor ?? model.color ?? PAINTS[Math.floor(Math.random() * PAINTS.length)];
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: 0.15, metalness: 0.7 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
  const L = model.length, W = model.width;

  const body = new THREE.Mesh(new THREE.BoxGeometry(W, 0.62, L), paint);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, 0.55, L * 0.48), glass);
  cabin.position.set(0, 1.1, -L * 0.06);
  cabin.castShadow = true;
  group.add(cabin);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.34, 0.5), paint);
  nose.position.set(0, 0.5, L * 0.42);
  group.add(nose);
  // Headlights + taillights.
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 1.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xaa0000, emissiveIntensity: 1.0 });
  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), headMat);
    head.position.set(sx * W * 0.32, 0.62, L / 2 + 0.02);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.08), tailMat);
    tail.position.set(sx * W * 0.32, 0.66, -L / 2 - 0.02);
    group.add(tail);
  }
  // Wheels.
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[-W / 2 + 0.08, L * 0.32], [W / 2 - 0.08, L * 0.32], [-W / 2 + 0.08, -L * 0.32], [W / 2 - 0.08, -L * 0.32]]) {
    const wheel = new THREE.Mesh(wheelGeo, tyre);
    wheel.position.set(wx, 0.36, wz);
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);
  }
  if (modelKey === 'police') {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.18, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }),
    );
    bar.position.set(0, 1.48, -L * 0.06);
    group.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.42), new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 2 }));
    red.position.set(-0.3, 1.5, -L * 0.06);
    group.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.42), new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x0022ff, emissiveIntensity: 2 }));
    blue.position.set(0.3, 1.5, -L * 0.06);
    group.add(blue);
    group.userData.lightRed = red;
    group.userData.lightBlue = blue;
    // White doors read as a patrol car at a glance.
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.4 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.5, L * 0.5), doorMat);
    door.position.set(0, 0.6, 0);
    group.add(door);
  }
  if (modelKey === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4), new THREE.MeshStandardMaterial({ color: 0xffe9a0, emissive: 0xffd23a, emissiveIntensity: 0.8 }));
    sign.position.set(0, 1.5, -L * 0.06);
    group.add(sign);
  }
  group.userData.wheels = wheels;
  group.userData.model = model;
  return group;
}

// Arcade vehicle: position on the XZ plane, heading, forward speed.
// Steering input -1..1, throttle -1..1, handbrake boolean.
export class Vehicle {
  constructor(scene, modelKey, x, z, heading, paintColor = null) {
    this.modelKey = modelKey;
    this.model = CAR_MODELS[modelKey] || CAR_MODELS.sedan;
    this.mesh = makeCarMesh(modelKey, paintColor);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.heading = heading;
    this.speed = 0; // m/s, signed: positive forward
    this.steer = 0;
    this.health = 100;
    this.airborne = 0; // >0 while a stunt jump is in the air
    this.airTime = 0;
    this.skidding = false;
    this.stuckTimer = 0;
    this.radius = Math.max(this.model.length, this.model.width) * 0.55;
    this.alive = true;
    this.isPolice = modelKey === 'police';
    this.upgradeMul = 1;
  }

  get forwardX() { return Math.sin(this.heading); }
  get forwardZ() { return Math.cos(this.heading); }

  // One physics step. `input` is { throttle, steer, handbrake }.
  // `city` supplies building collisions; `obstacles` is a list of other
  // vehicles (circle tests) for this step.
  update(dt, input, city, obstacles = []) {
    if (!this.alive) return;
    const model = this.model;
    const topSpeed = model.topSpeed * this.upgradeMul;
    const accel = model.accel * this.upgradeMul;

    // Steering eases toward the input; tighter at low speed.
    const speedFactor = clamp(Math.abs(this.speed) / 12, 0.15, 1);
    const targetSteer = input.steer * (1.35 - speedFactor * 0.75);
    this.steer = damp(this.steer, targetSteer, 8, dt);

    // Longitudinal: throttle accelerates, brake/reverse, drag always pulls.
    if (input.throttle > 0) {
      this.speed += accel * input.throttle * dt * (1 - Math.max(0, this.speed) / topSpeed);
    } else if (input.throttle < 0) {
      if (this.speed > 0.5) this.speed += accel * 1.6 * input.throttle * dt; // brake
      else this.speed += accel * 0.55 * input.throttle * dt; // reverse, capped below
    }
    this.speed -= this.speed * 0.45 * dt; // rolling drag
    if (input.handbrake) {
      this.speed -= this.speed * 2.2 * dt;
      this.skidding = Math.abs(this.speed) > 6;
    } else {
      this.skidding = Math.abs(this.steer) > 0.85 && Math.abs(this.speed) > 14;
    }
    this.speed = clamp(this.speed, -topSpeed * 0.45, topSpeed);

    // Heading follows the steering, scaled by speed and grip.
    const grip = input.handbrake ? model.grip * 0.45 : model.grip;
    this.heading += this.steer * (this.speed / Math.max(4, Math.abs(this.speed))) * clamp(Math.abs(this.speed) / 6, 0, 1) * 1.9 * grip * dt * (this.speed >= 0 ? 1 : -1);
    if (Math.abs(this.speed) < 0.05 && input.throttle === 0) this.speed = 0;

    // Integrate.
    const nx = this.pos.x + this.forwardX * this.speed * dt;
    const nz = this.pos.z + this.forwardZ * this.speed * dt;
    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x = nx;
    this.pos.z = nz;

    // Buildings: push out, lose speed, take damage on a hard hit.
    const before = { x: this.pos.x, z: this.pos.z };
    if (city.resolveCircle(this.pos, this.radius * 0.85)) {
      const impact = Math.abs(this.speed);
      const movedX = this.pos.x - before.x, movedZ = this.pos.z - before.z;
      if (impact > 4) {
        const dmg = (impact - 4) * 1.1;
        this.damage(dmg);
        this.speed *= 0.35;
        return { hit: 'building', impact, movedX, movedZ };
      }
      this.speed *= 0.6;
      return { hit: 'building', impact, movedX, movedZ };
    }

    // Other vehicles: soft circle push + speed exchange.
    for (const other of obstacles) {
      if (other === this || !other.alive) continue;
      const dx = this.pos.x - other.pos.x;
      const dz = this.pos.z - other.pos.z;
      const rr = this.radius + other.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (rr - d) / 2;
        const px = (dx / d) * push, pz = (dz / d) * push;
        this.pos.x += px; this.pos.z += pz;
        other.pos.x -= px; other.pos.z -= pz;
        const rel = Math.abs(this.speed - other.speed);
        if (rel > 5) {
          this.damage(rel * 0.5);
          if (typeof other.damage === 'function') other.damage(rel * 0.4);
          this.speed *= 0.55;
          return { hit: 'car', impact: rel, other };
        }
        this.speed *= 0.85;
        return { hit: 'car', impact: rel, other };
      }
    }

    // City bounds: soft wall at the edge of the map.
    const B = 205;
    if (Math.abs(this.pos.x) > B || Math.abs(this.pos.z) > B) {
      this.pos.x = clamp(this.pos.x, -B, B);
      this.pos.z = clamp(this.pos.z, -B, B);
      this.speed *= 0.5;
    }
    return { hit: null, movedX: this.pos.x - prevX, movedZ: this.pos.z - prevZ };
  }

  damage(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
      this.speed = 0;
    }
  }

  // Visual: mesh follows physics; wheels spin; body leans into turns.
  syncVisual(dt) {
    this.mesh.position.x = this.pos.x;
    this.mesh.position.z = this.pos.z;
    this.mesh.rotation.y = this.heading;
    const wheels = this.mesh.userData.wheels || [];
    for (let i = 0; i < wheels.length; i++) {
      wheels[i].rotation.x += (this.speed / 0.36) * dt;
      if (i < 2) wheels[i].rotation.y = this.steer * 0.42;
    }
    // Body roll + pitch: lean out of a turn, dive under braking.
    const targetRoll = -this.steer * clamp(Math.abs(this.speed) / 30, 0, 1) * 0.09;
    this.mesh.rotation.z = damp(this.mesh.rotation.z || 0, targetRoll, 6, dt);
    const targetPitch = clamp(-this.speed * 0.0012, -0.03, 0.03);
    this.mesh.rotation.x = damp(this.mesh.rotation.x || 0, targetPitch, 6, dt);
    // Stunt jump: the mesh lifts while airborne.
    if (this.airborne > 0) {
      const t = 1 - this.airborne / 0.9;
      this.mesh.position.y = Math.sin(t * Math.PI) * 2.2;
    } else {
      this.mesh.position.y = 0;
    }
  }

  setHeading(h) { this.heading = h; this.mesh.rotation.y = h; }
  teleport(x, z, heading) {
    this.pos.x = x; this.pos.z = z;
    this.setHeading(heading);
    this.speed = 0;
    this.syncVisual(0);
  }
  dispose(scene) { scene.remove(this.mesh); }
}
