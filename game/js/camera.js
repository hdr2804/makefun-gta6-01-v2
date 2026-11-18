// camera.js — the third-person chase camera.
// Lags behind the car, widens its field of view with speed, drops low
// and close on foot, and shakes on impacts. The camera never clips
// through buildings: it pulls in when a collider is between it and the
// player. Mouse drag orbits; the wheel zooms.
import * as THREE from 'three';
import { clamp, damp, angleLerp } from './utils.js';

export class ChaseCamera {
  constructor(camera, city) {
    this.camera = camera;
    this.city = city;
    this.yaw = Math.PI; // orbit around the player
    this.pitch = 0.32;
    this.distance = 9.5;
    this.targetDistance = 9.5;
    this.fov = 62;
    this.shake = 0;
    this.shakeDecay = 2.2;
    this.pos = new THREE.Vector3(0, 6, 130);
    this.look = new THREE.Vector3(0, 1.5, 120);
    this.snap = true; // first frame: jump straight to the target
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  orbit(dx, dy) {
    this.yaw -= dx * 0.005;
    this.pitch = clamp(this.pitch + dy * 0.004, 0.08, 1.1);
  }

  zoom(delta) {
    this.targetDistance = clamp(this.targetDistance + delta * 0.01, 5, 16);
  }

  // Follow the player: `focus` is a Vector3, `heading` the direction the
  // player faces, `speed` the current speed (drives FOV + distance).
  update(dt, focus, heading, speed, inCar) {
    // When the player drives, the camera trails behind the heading;
    // on foot it stays behind the orbit yaw the mouse set.
    const followHeading = inCar ? heading + Math.PI : this.yaw;
    const wantDist = inCar ? this.targetDistance + clamp(Math.abs(speed) / 40, 0, 1) * 3.5 : 7.5;
    this.distance = damp(this.distance, wantDist, 3, dt);
    const h = inCar ? angleLerp(this.yaw, heading + Math.PI, clamp(dt * 2.2, 0, 1)) : this.yaw;
    this.yaw = h;
    const cx = focus.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance;
    const cz = focus.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance;
    const cy = focus.y + 1.6 + Math.sin(this.pitch) * this.distance;
    const want = new THREE.Vector3(cx, cy, cz);
    // Pull the camera in when a building stands between it and the player.
    const steps = 8;
    let pulled = want;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = focus.x + (want.x - focus.x) * t;
      const pz = focus.z + (want.z - focus.z) * t;
      if (this.city.insideCollider(px, pz, 1.2)) {
        const tt = Math.max(0.15, (i - 1) / steps);
        pulled = new THREE.Vector3(
          focus.x + (want.x - focus.x) * tt,
          focus.y + 1.6 + (want.y - focus.y - 1.6) * tt,
          focus.z + (want.z - focus.z) * tt,
        );
        break;
      }
    }
    if (this.snap) {
      this.pos.copy(pulled);
      this.look.set(focus.x, focus.y + 1.6, focus.z);
      this.snap = false;
    } else {
      this.pos.x = damp(this.pos.x, pulled.x, 10, dt);
      this.pos.y = damp(this.pos.y, pulled.y, 10, dt);
      this.pos.z = damp(this.pos.z, pulled.z, 10, dt);
      this.look.x = damp(this.look.x, focus.x, 12, dt);
      this.look.y = damp(this.look.y, focus.y + 1.6, 12, dt);
      this.look.z = damp(this.look.z, focus.z, 12, dt);
    }
    // Speed FOV: the world rushes at you on the highway.
    const targetFov = 62 + clamp(Math.abs(speed) / 42, 0, 1) * 14;
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    // Shake: random offset that decays.
    this.shake = Math.max(0, this.shake - this.shakeDecay * dt * this.shake);
    const sx = (Math.random() - 0.5) * this.shake * 0.5;
    const sy = (Math.random() - 0.5) * this.shake * 0.5;
    this.camera.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
    this.camera.lookAt(this.look.x + sx, this.look.y + sy, this.look.z);
  }

  // Title-screen orbit: slow cinematic sweep over the city.
  orbitShot(dt, time, center = { x: 0, z: 0 }) {
    const a = time * 0.05;
    const r = 150;
    this.camera.position.set(center.x + Math.sin(a) * r, 55 + Math.sin(time * 0.11) * 8, center.z + Math.cos(a) * r);
    this.camera.lookAt(center.x, 6, center.z);
    if (Math.abs(this.camera.fov - 58) > 0.1) {
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
    }
  }
}
