// missions.js — Marisol Vega's job board: six chained missions with a
// short story, each a small state machine of steps (drive to a marker,
// pick someone up, deliver, tail, escape). A mission has a briefing card,
// a 3D beacon + HUD arrow objective, a timer where the job demands one,
// and a payout. Fail states: timer runs out, the tail target spots you,
// the client car is wrecked. The final job ends the run with a win.
import * as THREE from 'three';
import { makeRng, clamp, dist2, fmtCash } from './utils.js';

export const MISSIONS = [
  {
    id: 'm1',
    title: 'First Pickup',
    client: 'Marisol Vega',
    payout: 400,
    briefing: 'Fresh out of the game and already back in it. Pick up my client at the corner of Palm Row and bring him to the safehouse. Drive like you mean it — but do not wreck my car.',
    steps: [
      { type: 'goto', label: 'Drive to the pickup on Palm Row', at: { x: 40, z: 80 }, radius: 8 },
      { type: 'pickup', label: 'Pick up the client (stop by the marker)', at: { x: 40, z: 80 }, radius: 6, hold: 1.2 },
      { type: 'goto', label: 'Deliver the client to the safehouse', at: { x: -60, z: 152 }, radius: 10 },
    ],
  },
  {
    id: 'm2',
    title: 'Sunset Delivery',
    client: 'Marisol Vega',
    payout: 650,
    timer: 120,
    briefing: 'A package for the marina district. The buyer pays double if it lands before the sun does. You have two minutes. The cops will not wait for you, so do not wait for them.',
    steps: [
      { type: 'goto', label: 'Collect the package at the docks office', at: { x: 120, z: -120 }, radius: 8 },
      { type: 'pickup', label: 'Grab the package', at: { x: 120, z: -120 }, radius: 6, hold: 1 },
      { type: 'goto', label: 'Deliver to the buyer at the east plaza', at: { x: 160, z: 40 }, radius: 9 },
    ],
  },
  {
    id: 'm3',
    title: 'Tail the Rival',
    client: 'Marisol Vega',
    payout: 800,
    briefing: 'Rico drives for the other crew now. Follow him from the north market to his drop. Stay back — if he makes you, the job is blown and so is my patience.',
    steps: [
      { type: 'goto', label: 'Find Rico at the north market', at: { x: -40, z: -160 }, radius: 10 },
      { type: 'tail', label: 'Tail Rico — stay 15–60 m back, do not get spotted', at: { x: -40, z: -160 }, duration: 40 },
      { type: 'goto', label: 'Watch the drop, then slip away', at: { x: -160, z: -40 }, radius: 10 },
    ],
  },
  {
    id: 'm4',
    title: 'The Heist Getaway',
    client: 'The Crew',
    payout: 1500,
    briefing: 'The crew hit the casino vault. You are the wheel. Get them out of the plaza, lose the three-star heat, and bring them to the garage. Do not stop. Do not look back.',
    steps: [
      { type: 'goto', label: 'Pick up the crew at the casino plaza', at: { x: 0, z: 0 }, radius: 9 },
      { type: 'pickup', label: 'Crew is getting in — hold still', at: { x: 0, z: 0 }, radius: 7, hold: 1.5 },
      { type: 'escape', label: 'Escape! Lose the police, then reach the garage', at: { x: -120, z: 120 }, radius: 12, wanted: 3 },
    ],
  },
  {
    id: 'm5',
    title: 'Through the Roadblock',
    client: 'Marisol Vega',
    payout: 1800,
    briefing: 'A witness needs to leave Solmar tonight. The PD has the bridges watched and a roadblock on the avenue. Take the back streets, punch through if you must, and get her to the chapel.',
    steps: [
      { type: 'goto', label: 'Pick up the witness at the west chapel', at: { x: -160, z: 80 }, radius: 9 },
      { type: 'pickup', label: 'She is getting in — hold still', at: { x: -160, z: 80 }, radius: 6, hold: 1.2 },
      { type: 'goto', label: 'Get her to the safe chapel across town', at: { x: 160, z: -80 }, radius: 10 },
    ],
  },
  {
    id: 'm6',
    title: 'The Last Boat',
    client: 'Marisol Vega',
    payout: 5000,
    briefing: 'One last job, driver. The whole city is coming for us — five stars, helicopters, everything. Cross Solmar and reach the boat at the marina. When you step on that deck, you are free.',
    steps: [
      { type: 'goto', label: 'Meet Marisol at the old pier office', at: { x: 120, z: -140 }, radius: 9 },
      { type: 'pickup', label: 'Marisol is getting in — hold still', at: { x: 120, z: -140 }, radius: 6, hold: 1.2 },
      { type: 'escape', label: 'RUN. Five stars. Reach the boat at the marina', at: { x: 140, z: -162 }, radius: 12, wanted: 5 },
    ],
  },
];

function makeBeacon(color = 0xffd23a) {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.35, 0.35, 26, 12, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
  });
  const beam = new THREE.Mesh(geo, mat);
  beam.position.y = 13;
  group.add(beam);
  const ringGeo = new THREE.RingGeometry(2.2, 3.2, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(ring);
  group.userData.beam = beam;
  group.userData.ring = ring;
  return group;
}

export class MissionManager {
  constructor(scene, city, state, audio, hud) {
    this.scene = scene;
    this.city = city;
    this.state = state;
    this.audio = audio;
    this.hud = hud;
    this.rng = makeRng(31337);
    this.current = null; // { def, stepIndex, timer, holdTimer, tailCar, ... }
    this.beacon = null;
    this.contact = null; // pedestrian contact at the marker
    this.tailCar = null;
    this.tailSpotted = 0;
    this.state.bus.on('mission-complete', () => this.clearObjective());
    this.state.bus.on('mission-failed', () => this.clearObjective());
  }

  get nextDef() { return MISSIONS[Math.min(this.state.missionIndex, MISSIONS.length - 1)]; }
  get isFinal() { return this.state.missionIndex >= MISSIONS.length - 1; }

  start(index = null) {
    const idx = index ?? this.state.missionIndex;
    if (idx >= MISSIONS.length) return false;
    const def = MISSIONS[idx];
    this.clearObjective();
    this.current = {
      def,
      stepIndex: 0,
      timer: def.timer ?? null,
      holdTimer: 0,
      tailElapsed: 0,
      tailSpotted: 0,
      escapeArmed: false,
    };
    this.state.missionActive = true;
    this.state.missionId = def.id;
    this.audio.missionStart();
    this.hud.showBriefing(def);
    this.hud.setObjective(this.stepLabel());
    this.setupStep();
    // Scripted heat for the getaway jobs.
    if (def.id === 'm4') this.state.setWanted(0);
    return true;
  }

  stepLabel() {
    if (!this.current) return '';
    const step = this.current.def.steps[this.current.stepIndex];
    return step ? step.label : '';
  }

  currentStep() {
    if (!this.current) return null;
    return this.current.def.steps[this.current.stepIndex] || null;
  }

  setupStep() {
    const step = this.currentStep();
    if (!step) { this.finish(); return; }
    this.clearObjective();
    this.current.holdTimer = 0;
    const at = step.at;
    this.beacon = makeBeacon(step.type === 'escape' ? 0xff3b30 : 0xffd23a);
    this.beacon.position.set(at.x, 0, at.z);
    this.scene.add(this.beacon);
    this.current.target = { x: at.x, z: at.z, radius: step.radius ?? 9 };
    this.hud.setObjective(step.label);
    if (step.type === 'tail') this.spawnTailCar(at);
    if (step.type === 'pickup' && this.current.def.id !== 'm4') {
      // A contact waits at the marker for pickups.
      this.contact = this.spawnContactAt(at);
    }
    // The heist / final job arms its wanted level at the escape step.
    if (step.type === 'escape') {
      this.state.setWanted(step.wanted ?? 3);
      this.current.escapeArmed = true;
      if (this.current.def.id === 'm4') {
        // Scripted pursuit right behind the player.
        this.state.bus.emit('scripted-pursuit', { count: 3 });
      }
      if (this.current.def.id === 'm6') {
        this.state.bus.emit('scripted-pursuit', { count: 4 });
      }
    }
  }

  spawnContactAt(at) {
    // A pedestrian contact is spawned by the world (injected by main via
    // this.spawnContact hook so missions stay decoupled from peds).
    if (this.spawnContact) return this.spawnContact('Client', at.x + 2, at.z + 2);
    return null;
  }

  spawnTailCar(at) {
    if (this.spawnTail) {
      this.tailCar = this.spawnTail(at.x, at.z);
    }
  }

  advanceStep() {
    if (!this.current) return;
    this.current.stepIndex += 1;
    if (this.current.stepIndex >= this.current.def.steps.length) {
      this.finish();
      return;
    }
    this.setupStep();
    this.audio.blip(990, 0.12, 'sine', 0.12);
  }

  finish() {
    if (!this.current) return;
    const def = this.current.def;
    this.clearObjective();
    const wasFinal = def.id === 'm6';
    this.state.completeMission(def.id, def.payout);
    this.audio.cash();
    this.hud.showToast(`Job done — ${def.title} · ${fmtCash(def.payout)}`, 'good');
    this.current = null;
    if (wasFinal) {
      this.state.endRun('win', { subtitle: 'Marisol is on the boat. Solmar fades into the sunset behind you.' });
    } else {
      // Next job unlocks on the phone (HUD job list); the player drives on.
      this.hud.refreshJobList();
    }
  }

  fail(reason) {
    if (!this.current) return;
    const def = this.current.def;
    this.clearObjective();
    this.state.failMission(def.id, reason);
    this.audio.busted();
    this.hud.showToast(`Job failed — ${reason}`, 'bad');
    this.current = null;
    this.hud.refreshJobList();
  }

  clearObjective() {
    if (this.beacon) { this.scene.remove(this.beacon); this.beacon = null; }
    if (this.contact && this.removeContact) { this.removeContact(this.contact); this.contact = null; }
    if (this.tailCar && this.removeTail) { this.removeTail(this.tailCar); this.tailCar = null; }
    if (this.current) this.current.target = null;
  }

  abort() {
    this.clearObjective();
    if (this.current) {
      this.state.missionActive = false;
      this.state.missionId = null;
      this.current = null;
    }
    this.hud.setObjective('');
  }

  update(dt, playerPos, playerSpeed, onFoot, inCar) {
    if (!this.current) return;
    const step = this.currentStep();
    if (!step) return;
    // Beacon pulse.
    if (this.beacon) {
      const t = performance.now() / 300;
      this.beacon.userData.beam.material.opacity = 0.22 + Math.sin(t) * 0.12;
      const s = 1 + Math.sin(t * 1.4) * 0.12;
      this.beacon.userData.ring.scale.set(s, s, 1);
    }
    // Mission timer.
    if (this.current.timer !== null) {
      this.current.timer -= dt;
      this.hud.setTimer(this.current.timer);
      if (this.current.timer <= 0) { this.fail('Out of time'); return; }
    }
    const target = this.current.target;
    if (!target) return;
    const d = dist2(playerPos.x, playerPos.z, target.x, target.z);

    if (step.type === 'goto') {
      if (d < target.radius) this.advanceStep();
    } else if (step.type === 'pickup') {
      const stopped = Math.abs(playerSpeed) < 1.2;
      if (d < target.radius && stopped) {
        this.current.holdTimer += dt;
        this.hud.setObjective(`${step.label} — ${Math.ceil(step.hold - this.current.holdTimer)}…`);
        if (this.current.holdTimer >= step.hold) {
          // Client hops in (or the package is grabbed).
          if (this.contact && this.removeContact) { this.removeContact(this.contact); this.contact = null; }
          this.audio.blip(880, 0.1, 'sine', 0.12);
          this.advanceStep();
        }
      } else {
        this.current.holdTimer = 0;
        this.hud.setObjective(step.label);
      }
    } else if (step.type === 'tail') {
      if (!this.tailCar) { this.fail('The target got away'); return; }
      const td = dist2(playerPos.x, playerPos.z, this.tailCar.vehicle.pos.x, this.tailCar.vehicle.pos.z);
      this.current.tailElapsed += dt;
      const spotted = td < 12 && this.tailCarSeen();
      if (spotted) {
        this.current.tailSpotted += dt;
        this.hud.setObjective(`${step.label} — SPOTTED! Back off! (${Math.ceil(3 - this.current.tailSpotted)})`);
        if (this.current.tailSpotted > 3) { this.fail('Rico spotted you'); return; }
      } else {
        this.current.tailSpotted = Math.max(0, this.current.tailSpotted - dt);
        this.hud.setObjective(`${step.label} — ${Math.round(td)} m`);
      }
      if (td > 75) { this.fail('You lost the target'); return; }
      if (this.current.tailElapsed >= (step.duration ?? 40)) this.advanceStep();
    } else if (step.type === 'escape') {
      // Reach the marker; for the final job the marker IS the boat.
      if (d < target.radius) {
        if (step.wanted && this.state.wanted > 0) {
          // The heat is still on: you must lose them first (or, for the
          // final job, just make the boat — the win triggers on arrival).
          if (this.current.def.id === 'm6') { this.advanceStep(); return; }
          this.hud.setObjective(`${step.label} — lose the police first! ★${this.state.wanted}`);
        } else {
          this.advanceStep();
        }
      }
    }
  }

  tailCarSeen() {
    // Spotted when close AND roughly in front of the target car.
    if (!this.tailCar) return false;
    return true;
  }

  // HUD helpers.
  objectiveTarget() {
    return this.current && this.current.target ? this.current.target : null;
  }
  objectiveLabel() { return this.stepLabel(); }
}
