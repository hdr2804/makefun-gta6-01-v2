// effects.js — skid marks, dust, impact sparks and screen shake.
// Skid marks are a pool of flat dark quads laid on the asphalt as the
// tyres slide; dust is a Points cloud recycled per puff; sparks are a
// second Points cloud with additive blending. Everything is pooled and
// reused — nothing allocates per frame in the hot path.
import * as THREE from 'three';
import { makeRng } from './utils.js';

const MAX_SKIDS = 220;
const MAX_DUST = 320;
const MAX_SPARKS = 160;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.rng = makeRng(555);
    // Skid marks.
    const skidGeo = new THREE.PlaneGeometry(0.32, 1.1);
    const skidMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false });
    this.skidPool = [];
    for (let i = 0; i < MAX_SKIDS; i++) {
      const m = new THREE.Mesh(skidGeo, skidMat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.position.y = 0.06;
      scene.add(m);
      this.skidPool.push(m);
    }
    this.skidIndex = 0;
    this.skidTimer = 0;
    // Dust.
    this.dustGeo = new THREE.BufferGeometry();
    this.dustPos = new Float32Array(MAX_DUST * 3);
    this.dustVel = new Float32Array(MAX_DUST * 3);
    this.dustLife = new Float32Array(MAX_DUST);
    this.dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xcbb28a, size: 1.4, transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true,
    });
    this.dust = new THREE.Points(this.dustGeo, dustMat);
    this.dust.frustumCulled = false;
    for (let i = 0; i < MAX_DUST; i++) this.dustPos[i * 3 + 1] = -100;
    scene.add(this.dust);
    this.dustIndex = 0;
    // Sparks.
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkVel = new Float32Array(MAX_SPARKS * 3);
    this.sparkLife = new Float32Array(MAX_SPARKS);
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xffc861, size: 0.7, transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.sparks = new THREE.Points(this.sparkGeo, sparkMat);
    this.sparks.frustumCulled = false;
    for (let i = 0; i < MAX_SPARKS; i++) this.sparkPos[i * 3 + 1] = -100;
    scene.add(this.sparks);
    this.sparkIndex = 0;
    this.time = 0;
  }

  laySkid(x, z, heading) {
    this.skidTimer -= 1;
    const m = this.skidPool[this.skidIndex];
    this.skidIndex = (this.skidIndex + 1) % MAX_SKIDS;
    m.position.set(x, 0.06, z);
    m.rotation.z = -heading;
    m.visible = true;
  }

  // Called while the car skids: two marks, one per rear wheel.
  skidTrail(vehicle) {
    const h = vehicle.heading;
    const px = Math.cos(h), pz = -Math.sin(h);
    const bx = vehicle.pos.x - Math.sin(h) * vehicle.model.length * 0.32;
    const bz = vehicle.pos.z - Math.cos(h) * vehicle.model.length * 0.32;
    this.laySkid(bx + px * 0.8, bz + pz * 0.8, h);
    this.laySkid(bx - px * 0.8, bz - pz * 0.8, h);
  }

  puff(x, y, z, count = 6, spread = 1.6, up = 1.2) {
    for (let n = 0; n < count; n++) {
      const i = this.dustIndex;
      this.dustIndex = (this.dustIndex + 1) % MAX_DUST;
      this.dustPos[i * 3] = x + (this.rng.next() - 0.5) * spread;
      this.dustPos[i * 3 + 1] = y + this.rng.next() * 0.4;
      this.dustPos[i * 3 + 2] = z + (this.rng.next() - 0.5) * spread;
      this.dustVel[i * 3] = (this.rng.next() - 0.5) * 1.6;
      this.dustVel[i * 3 + 1] = this.rng.next() * up;
      this.dustVel[i * 3 + 2] = (this.rng.next() - 0.5) * 1.6;
      this.dustLife[i] = this.rng.range(0.5, 1.1);
    }
    this.dustGeo.attributes.position.needsUpdate = true;
  }

  burstSparks(x, y, z, count = 14) {
    for (let n = 0; n < count; n++) {
      const i = this.sparkIndex;
      this.sparkIndex = (this.sparkIndex + 1) % MAX_SPARKS;
      this.sparkPos[i * 3] = x;
      this.sparkPos[i * 3 + 1] = y;
      this.sparkPos[i * 3 + 2] = z;
      const a = this.rng.next() * Math.PI * 2;
      const sp = this.rng.range(3, 9);
      this.sparkVel[i * 3] = Math.cos(a) * sp;
      this.sparkVel[i * 3 + 1] = this.rng.range(2, 7);
      this.sparkVel[i * 3 + 2] = Math.sin(a) * sp;
      this.sparkLife[i] = this.rng.range(0.25, 0.6);
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
  }

  update(dt) {
    this.time += dt;
    for (let i = 0; i < MAX_DUST; i++) {
      if (this.dustLife[i] <= 0) continue;
      this.dustLife[i] -= dt;
      if (this.dustLife[i] <= 0) { this.dustPos[i * 3 + 1] = -100; continue; }
      this.dustPos[i * 3] += this.dustVel[i * 3] * dt;
      this.dustPos[i * 3 + 1] += this.dustVel[i * 3 + 1] * dt;
      this.dustPos[i * 3 + 2] += this.dustVel[i * 3 + 2] * dt;
      this.dustVel[i * 3 + 1] *= (1 - dt * 1.5);
    }
    this.dustGeo.attributes.position.needsUpdate = true;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt;
      if (this.sparkLife[i] <= 0) { this.sparkPos[i * 3 + 1] = -100; continue; }
      this.sparkVel[i * 3 + 1] -= 18 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      if (this.sparkPos[i * 3 + 1] < 0.05) { this.sparkPos[i * 3 + 1] = 0.05; this.sparkVel[i * 3 + 1] *= -0.4; }
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
  }

  clear() {
    for (const m of this.skidPool) m.visible = false;
    for (let i = 0; i < MAX_DUST; i++) { this.dustLife[i] = 0; this.dustPos[i * 3 + 1] = -100; }
    for (let i = 0; i < MAX_SPARKS; i++) { this.sparkLife[i] = 0; this.sparkPos[i * 3 + 1] = -100; }
  }
}
