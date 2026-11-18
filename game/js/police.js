// police.js — the wanted system and the Solmar Police Department.
// Patrol cars cruise the grid; at wanted >= 1 they pursue (ram + PIT),
// at >= 3 they set roadblocks ahead of the player, at >= 4 a helicopter
// joins with a spotlight. Busted when a cop is close and the player is
// slow or on foot; wrecked is the car's health reaching zero. Losing
// them means breaking line of sight AND distance — the state machine
// only cools the wanted level down when no unit is near or watching.
import * as THREE from 'three';
import { Vehicle } from './vehicles.js';
import { makeRng, clamp, dist2, angleDiff } from './utils.js';

export class PoliceManager {
  constructor(scene, city, state, audio) {
    this.scene = scene;
    this.city = city;
    this.state = state;
    this.audio = audio;
    this.rng = makeRng(9911);
    this.units = []; // { vehicle, mode: 'patrol'|'pursue'|'roadblock', target, stuck }
    this.heli = null; // { mesh, light, cone }
    this.roadblocks = []; // { vehicles: [], x, z }
    this.bustedTimer = 0;
    this.searchTimer = 0;
    this.spawnTimer = 0;
    this.nearestDist = Infinity;
    this.anySees = false;
    this.targetUnits = 0;
    this.state.bus.on('wanted', ({ wanted }) => this.onWantedChange(wanted));
  }

  onWantedChange(wanted) {
    this.targetUnits = wanted === 0 ? 2 : Math.min(2 + wanted, 7);
    if (wanted >= 4 && !this.heli) this.spawnHeli();
    if (wanted < 4 && this.heli) this.removeHeli();
    if (wanted >= 3) this.maybeRoadblock();
    this.audio.setSiren(wanted > 0);
    if (wanted === 0) this.clearRoadblocks();
  }

  spawnPatrols(count = 2) {
    for (let i = 0; i < count; i++) this.spawnUnit('patrol');
  }

  spawnUnit(mode) {
    const px = this.playerPos ? this.playerPos.x : 0;
    const pz = this.playerPos ? this.playerPos.z : 0;
    // Spawn on a road 60–110 m from the player, never on top of them.
    let x = 0, z = 0;
    for (let tries = 0; tries < 10; tries++) {
      const sx = this.city.nearestStreet(px + this.rng.range(-110, 110));
      const sz = this.city.nearestStreet(pz + this.rng.range(-110, 110));
      if (dist2(sx, sz, px, pz) > 55) { x = sx; z = sz; break; }
      x = sx; z = sz;
    }
    const vehicle = new Vehicle(this.scene, 'police', x, z, this.rng.range(0, Math.PI * 2));
    const unit = { vehicle, mode, stuck: 0, ramCooldown: 0, target: null };
    this.units.push(unit);
    return unit;
  }

  spawnHeli() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.4, 6.5),
      new THREE.MeshStandardMaterial({ color: 0x1c2a3a, roughness: 0.4, metalness: 0.5 }),
    );
    body.castShadow = true;
    group.add(body);
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 5),
      new THREE.MeshStandardMaterial({ color: 0x1c2a3a, roughness: 0.4, metalness: 0.5 }),
    );
    tail.position.set(0, 0.3, -5);
    group.add(tail);
    const rotorGeo = new THREE.BoxGeometry(11, 0.12, 0.7);
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    const rotor = new THREE.Mesh(rotorGeo, rotorMat);
    rotor.position.y = 1.1;
    group.add(rotor);
    const spot = new THREE.SpotLight(0xfff2c0, 800, 90, 0.35, 0.5, 1.2);
    spot.position.set(0, -0.5, 2);
    const spotTarget = new THREE.Object3D();
    group.add(spotTarget);
    spot.target = spotTarget;
    group.add(spot);
    this.scene.add(group);
    this.heli = { mesh: group, rotor, spot, spotTarget, angle: 0 };
  }

  removeHeli() {
    if (!this.heli) return;
    this.scene.remove(this.heli.mesh);
    this.heli = null;
  }

  maybeRoadblock() {
    if (this.roadblocks.length >= 2) return;
    if (!this.playerPos || !this.playerVehicle) return;
    const pv = this.playerVehicle;
    const ahead = 55;
    const bx = pv.pos.x + Math.sin(pv.heading) * ahead;
    const bz = pv.pos.z + Math.cos(pv.heading) * ahead;
    const sx = this.city.nearestStreet(bx);
    const sz = this.city.nearestStreet(bz);
    const cars = [];
    for (let i = -1; i <= 1; i++) {
      const perp = pv.heading + Math.PI / 2;
      const cx = sx + Math.sin(perp) * i * 4;
      const cz = sz + Math.cos(perp) * i * 4;
      const v = new Vehicle(this.scene, 'police', cx, cz, pv.heading + Math.PI / 2);
      v.speed = 0;
      cars.push(v);
    }
    this.roadblocks.push({ vehicles: cars, x: sx, z: sz, ttl: 45 });
    for (const car of cars) {
      this.units.push({ vehicle: car, mode: 'roadblock', stuck: 0, ramCooldown: 0, target: null });
    }
  }

  clearRoadblocks() {
    for (const rb of this.roadblocks) {
      for (const v of rb.vehicles) {
        const i = this.units.findIndex((u) => u.vehicle === v);
        if (i >= 0) this.units.splice(i, 1);
        v.dispose(this.scene);
      }
    }
    this.roadblocks = [];
  }

  removeUnit(unit) {
    const i = this.units.indexOf(unit);
    if (i >= 0) this.units.splice(i, 1);
    unit.vehicle.dispose(this.scene);
  }

  // Line of sight: no building between the unit and the player.
  seesPlayer(unit, playerPos) {
    const ux = unit.vehicle.pos.x, uz = unit.vehicle.pos.z;
    const dx = playerPos.x - ux, dz = playerPos.z - uz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 130) return false;
    const steps = Math.ceil(d / 4);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.city.insideCollider(ux + dx * t, uz + dz * t, 0.5)) return false;
    }
    return true;
  }

  update(dt, playerPos, playerVehicle, onFoot, playerSpeed) {
    this.playerPos = playerPos;
    this.playerVehicle = playerVehicle;
    const wanted = this.state.wanted;
    this.spawnTimer -= dt;

    // Top the roster up toward the wanted-driven target.
    const wantCount = wanted === 0 ? 2 : Math.min(2 + wanted, 7);
    if (this.units.filter((u) => u.mode !== 'roadblock').length < wantCount && this.spawnTimer <= 0) {
      this.spawnUnit(wanted > 0 ? 'pursue' : 'patrol');
      this.spawnTimer = 1.2;
    }

    let nearest = Infinity;
    let anySees = false;
    const others = this.units.map((u) => u.vehicle);
    if (playerVehicle) others.push(playerVehicle);

    for (const unit of [...this.units]) {
      const v = unit.vehicle;
      if (!v.alive) { this.removeUnit(unit); continue; }
      const dx = playerPos.x - v.pos.x;
      const dz = playerPos.z - v.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      nearest = Math.min(nearest, d);
      const sees = this.seesPlayer(unit, playerPos);
      if (sees && d < 130) anySees = true;

      if (wanted === 0 || unit.mode === 'patrol') {
        // Cruise the grid like traffic, a little faster, lights off.
        unit.mode = wanted > 0 ? 'pursue' : 'patrol';
        const targetSpeed = wanted > 0 ? 0 : 11;
        v.speed = THREE.MathUtils.damp(v.speed, targetSpeed, 2, dt);
        if (wanted === 0) {
          // Patrol: pick a street direction and follow it.
          if (!unit.patrolDir || this.rng.chance(dt * 0.15)) {
            unit.patrolDir = this.rng.pick([{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]);
          }
          const wantH = Math.atan2(unit.patrolDir.x, unit.patrolDir.z);
          v.heading += angleDiff(v.heading, wantH) * clamp(dt * 2.5, 0, 1);
          v.pos.x += Math.sin(v.heading) * v.speed * dt;
          v.pos.z += Math.cos(v.heading) * v.speed * dt;
        }
        v.syncVisual(dt);
        continue;
      }

      if (unit.mode === 'roadblock') {
        v.speed = 0;
        v.syncVisual(dt);
        // Roadblock expires; the unit rejoins the pursuit.
        const rb = this.roadblocks.find((r) => r.vehicles.includes(v));
        if (rb) {
          rb.ttl -= dt;
          if (rb.ttl <= 0 || d < 25) {
            unit.mode = 'pursue';
            const i = rb.vehicles.indexOf(v);
            if (i >= 0) rb.vehicles.splice(i, 1);
          }
        }
        continue;
      }

      // Search: a pursuer that lost sight of the player far away gives up
      // the chase and cruises to the last known position. This is what
      // makes losing the police possible at all.
      if (unit.mode === 'pursue' && d > 120 && !sees) {
        unit.searchTimer = (unit.searchTimer || 0) + dt;
        if (unit.searchTimer > 4) {
          unit.mode = 'search';
          unit.lastKnown = { x: playerPos.x, z: playerPos.z };
          unit.searchTimer = 0;
        }
      } else if (unit.mode === 'pursue') {
        unit.searchTimer = 0;
      }
      if (unit.mode === 'search') {
        const lx = unit.lastKnown ? unit.lastKnown.x : playerPos.x;
        const lz = unit.lastKnown ? unit.lastKnown.z : playerPos.z;
        const ldx = lx - v.pos.x, ldz = lz - v.pos.z;
        const ld = Math.sqrt(ldx * ldx + ldz * ldz);
        if (sees && d < 60) {
          unit.mode = 'pursue';
        } else if (ld < 10) {
          unit.mode = 'patrol';
        } else {
          const wantH = Math.atan2(ldx, ldz);
          const turn = angleDiff(v.heading, wantH);
          v.update(dt, { throttle: 0.55, steer: clamp(turn * 1.6, -1, 1), handbrake: false }, this.city, others);
          v.syncVisual(dt);
        }
        continue;
      }

      // Pursuit: steer toward the player's predicted position, ram hard.
      const predict = clamp(d / 30, 0, 1.2);
      const tx = playerPos.x + Math.sin(playerVehicle ? playerVehicle.heading : 0) * (playerVehicle ? playerVehicle.speed * predict : 0);
      const tz = playerPos.z + Math.cos(playerVehicle ? playerVehicle.heading : 0) * (playerVehicle ? playerVehicle.speed * predict : 0);
      const wantH = Math.atan2(tx - v.pos.x, tz - v.pos.z);
      const turn = angleDiff(v.heading, wantH);
      const steer = clamp(turn * 1.6, -1, 1);
      // Ram: full throttle, extra push when lined up behind the player.
      const linedUp = Math.abs(turn) < 0.35;
      const throttle = d > 6 ? 1 : (linedUp ? 1 : 0.4);
      unit.ramCooldown -= dt;
      const hit = v.update(dt, { throttle, steer, handbrake: false }, this.city, others);
      if (onFoot && d < 9) {
        // On foot, the cops pull up and stop next to you — the arrest.
        // Without this they drive straight through the player and the
        // busted timer can never accumulate.
        v.speed = THREE.MathUtils.damp(v.speed, 0, 5, dt);
      }
      if (hit && hit.hit === 'car' && hit.other === playerVehicle && unit.ramCooldown <= 0) {
        unit.ramCooldown = 1.5;
        this.state.addHeat(2, 'rammed');
      }
      // Stuck against a building: reverse out for a moment.
      if (hit && hit.hit === 'building' && Math.abs(v.speed) < 1) {
        unit.stuck += dt;
        if (unit.stuck > 0.8) {
          v.update(dt, { throttle: -1, steer: -steer, handbrake: false }, this.city, others);
          if (unit.stuck > 2) unit.stuck = 0;
        }
      } else {
        unit.stuck = 0;
      }
      v.syncVisual(dt);
      // Flash the light bar.
      const phase = (performance.now() / 180) % 2 < 1;
      if (v.mesh.userData.lightRed) v.mesh.userData.lightRed.material.emissiveIntensity = phase ? 2.5 : 0.2;
      if (v.mesh.userData.lightBlue) v.mesh.userData.lightBlue.material.emissiveIntensity = phase ? 0.2 : 2.5;
    }

    // Helicopter: hover above the player, spotlight tracking them.
    if (this.heli) {
      const h = this.heli;
      h.angle += dt * 0.6;
      const hx = playerPos.x + Math.sin(h.angle) * 18;
      const hz = playerPos.z + Math.cos(h.angle) * 18;
      h.mesh.position.set(hx, 42, hz);
      h.rotor.rotation.y += dt * 22;
      h.mesh.lookAt(playerPos.x, 0, playerPos.z);
      h.spotTarget.position.set(playerPos.x - hx, -42, playerPos.z - hz);
      h.spotTarget.updateMatrixWorld();
    }

    // Busted: a cop within 4 m while the player is slow or on foot.
    this.nearestDist = nearest;
    this.anySees = anySees;
    if (wanted > 0) {
      const slow = onFoot || Math.abs(playerSpeed) < 1.5;
      if (nearest < 4.5 && slow) {
        this.bustedTimer += dt;
        if (this.bustedTimer > 2.2) {
          this.bustedTimer = 0;
          this.state.endRun('busted', { subtitle: 'The Solmar PD took you in. Marisol will post bail — eventually.' });
        }
      } else {
        this.bustedTimer = Math.max(0, this.bustedTimer - dt * 2);
      }
      // Wanted cooldown: only when nobody is near and nobody sees us.
      // Far away it cools faster — a clean break across town shakes them.
      this.state.decayWanted(dt * (nearest > 100 ? 2.5 : 1), nearest < 70, anySees);
    } else {
      this.bustedTimer = 0;
    }

    // Roadblock TTL housekeeping.
    for (const rb of [...this.roadblocks]) {
      if (rb.vehicles.length === 0) {
        const i = this.roadblocks.indexOf(rb);
        if (i >= 0) this.roadblocks.splice(i, 1);
      }
    }
    return { nearestDist: nearest, anySees };
  }

  // Debug / shot scenes: place N pursuers right behind the player.
  forcePursuit(count = 3) {
    if (!this.playerPos) return;
    for (let i = 0; i < count; i++) {
      const u = this.spawnUnit('pursue');
      const back = (this.playerVehicle ? this.playerVehicle.heading : 0) + Math.PI;
      u.vehicle.teleport(
        this.playerPos.x + Math.sin(back + (i - 1) * 0.25) * (14 + i * 6),
        this.playerPos.z + Math.cos(back + (i - 1) * 0.25) * (14 + i * 6),
        this.playerVehicle ? this.playerVehicle.heading : 0,
      );
      u.vehicle.speed = 20;
    }
  }
}
