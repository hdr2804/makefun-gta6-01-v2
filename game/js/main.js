// main.js — SOLMAR: Sunset Getaway. Bootstrap, game loop, and the glue
// between every system: driving, crime, near-misses, props, stunt jumps,
// safehouse garage + upgrades, mission hooks, pause/phone/radio keys,
// save, and the window.__solmar debug handle the playtest drives.
import * as THREE from 'three';
import { GameState, PHASES } from './state.js';
import { City, CITY } from './city.js';
import { Player } from './player.js';
import { Vehicle, CAR_MODELS } from './vehicles.js';
import { TrafficManager } from './traffic.js';
import { PedestrianManager } from './pedestrians.js';
import { PoliceManager } from './police.js';
import { MissionManager, MISSIONS } from './missions.js';
import { ChaseCamera } from './camera.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';
import { Input } from './input.js';
import { AutoSaver, loadSave, writeSave, hasSave } from './save.js';
import { applyShotPreset, hasShotParam } from './shot.js';
import { clamp, dist2, damp } from './utils.js';

const state = new GameState();
const audio = new AudioEngine();
const input = new Input();

// --- renderer / scene ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Golden hour: warm haze on the horizon, deeper blue above.
scene.background = new THREE.Color(0xff9e57);
scene.fog = new THREE.Fog(0xe8935a, 140, 520);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

const hemi = new THREE.HemisphereLight(0xffd9a0, 0x4a3a30, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb36b, 2.6);
sun.position.set(-180, 90, 120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160;
sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160;
sun.shadow.camera.bottom = -160;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0004;
scene.add(sun);
const sunSprite = (() => {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.35, 'rgba(255,190,110,0.85)');
  grad.addColorStop(1, 'rgba(255,150,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(180, 180, 1);
  sprite.position.set(-420, 95, 260);
  scene.add(sprite);
  return sprite;
})();

// --- world systems ---------------------------------------------------------
const city = new City(scene);
const hud = new HUD(state, city);
const player = new Player(scene, city, state, audio);
const traffic = new TrafficManager(scene, city, state);
const peds = new PedestrianManager(scene, city, state);
const police = new PoliceManager(scene, city, state, audio);
const missions = new MissionManager(scene, city, state, audio, hud);
const effects = new Effects(scene);
const chaseCam = new ChaseCamera(camera, city);
const saver = new AutoSaver(state);

// Stunt ramps: wedges on four avenues. Cross one fast and the car flies.
const ramps = [];
function addRamp(x, z, heading) {
  const geo = new THREE.BoxGeometry(5, 1.2, 7);
  geo.rotateX(-0.32);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 }));
  mesh.position.set(x, 0.4, z);
  mesh.rotation.y = heading;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(5.1, 0.2, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xaa8800, emissiveIntensity: 0.5 }),
  );
  stripe.position.set(x, 1.0, z);
  stripe.rotation.y = heading;
  scene.add(stripe);
  ramps.push({ x, z, heading, used: 0 });
}
addRamp(0, 80, 0);
addRamp(80, 0, Math.PI / 2);
addRamp(-80, -80, 0);
addRamp(120, 120, Math.PI / 2);

// Starter car by the spawn + two parked cars around town (stealable).
const starterCar = player.spawnStarterCar(scene, 6, 112, Math.PI);
const parked1 = new Vehicle(scene, 'coupe', -34, 76, Math.PI / 2, 0x2f6fb0);
const parked2 = new Vehicle(scene, 'sports', 116, -76, 0, 0xd94f1e);
player.ownedCars.push(parked1, parked2);

traffic.spawnInitial(14);
peds.spawnInitial(26);
police.spawnPatrols(2);

// --- mission hooks (missions stay decoupled from peds/traffic) -------------
missions.spawnContact = (name, x, z) => peds.spawnContact(name, x, z, 0xd94f1e);
missions.removeContact = (ped) => peds.removePed(ped);
missions.spawnTail = (x, z) => {
  const v = new Vehicle(scene, 'muscle', x, z, 0, 0x1c1c1c);
  v.speed = 11;
  scene.add(v.mesh);
  const car = { vehicle: v, waypoints: null, wpIndex: 0, speed: 11 };
  // A loop of waypoints around the north of the city.
  car.waypoints = [
    { x: -40, z: -160 }, { x: -120, z: -160 }, { x: -160, z: -120 },
    { x: -160, z: -40 }, { x: -120, z: -40 }, { x: -40, z: -40 },
  ];
  tailCars.push(car);
  return car;
};
missions.removeTail = (car) => {
  const i = tailCars.indexOf(car);
  if (i >= 0) tailCars.splice(i, 1);
  car.vehicle.dispose(scene);
};
const tailCars = [];

state.bus.on('scripted-pursuit', ({ count }) => police.forcePursuit(count));

// --- crime: stealing a car the police can see ------------------------------
state.bus.on('car-stolen', () => {
  const near = police.nearestDist < 60;
  const seen = police.anySees;
  if (near && seen) {
    state.addHeat(20, 'grand theft auto');
    hud.showToast('Stolen in front of the cops! ★', 'bad');
  } else {
    hud.showToast('Car stolen — keep it quiet.', 'info');
  }
});

// --- UI flow ---------------------------------------------------------------
function startNewGame() {
  state.resetRun();
  resetWorld();
  state.phase = PHASES.PLAYING;
  hud.hideTitle();
  hud.hideResults();
  hud.showHud(true);
  hud.renderCash(state.cash);
  hud.renderWanted(0);
  hud.showToast('Welcome to Solmar. Press P for jobs — Marisol is waiting.', 'info', 6000);
  audio.ensure();
}

function continueGame() {
  const data = loadSave();
  state.resetRun();
  if (data) state.deserialize(data);
  resetWorld();
  state.phase = PHASES.PLAYING;
  hud.hideTitle();
  hud.hideResults();
  hud.showHud(true);
  hud.renderCash(state.cash);
  hud.renderWanted(0);
  hud.showToast(`Welcome back. ${state.missionsCompleted.length} job(s) done, ${fmtCash2(state.cash)} in pocket.`, 'info', 5000);
  audio.ensure();
}

function fmtCash2(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

function resetWorld() {
  // Player back at the spawn, on foot, starter car waiting.
  player.inCar = false;
  player.vehicle = null;
  player.mesh.visible = true;
  player.spawnAt(city.spawn.x, city.spawn.z, city.spawn.heading);
  for (const v of player.ownedCars) {
    v.health = 100; v.alive = true; v.speed = 0;
  }
  starterCar.teleport(6, 112, Math.PI);
  parked1.teleport(-34, 76, Math.PI / 2);
  parked2.teleport(116, -76, 0);
  missions.abort();
  police.clearRoadblocks();
  for (const u of [...police.units]) police.removeUnit(u);
  police.spawnPatrols(2);
  police.bustedTimer = 0;
  effects.clear();
  chaseCam.snap = true;
  state.carHealth = 100;
  state.playerHealth = 100;
}

function quitToTitle() {
  state.phase = PHASES.TITLE;
  writeSave(state);
  hud.showTitle(hasSave());
  hud.showHud(false);
  hud.showPause(false);
  hud.hideBriefing();
  hud.hideResults();
}

state.bus.on('ui-new-game', startNewGame);
state.bus.on('ui-continue', continueGame);
state.bus.on('ui-restart', () => { startNewGame(); });
state.bus.on('ui-quit-title', quitToTitle);
state.bus.on('ui-resume', () => {
  if (state.phase === PHASES.PAUSED) {
    state.phase = PHASES.PLAYING;
    hud.showPause(false);
  }
});
state.bus.on('ui-start-mission', () => {
  hud.hideBriefing();
  missions.start();
});
state.bus.on('ui-start-mission-index', ({ index }) => {
  if (index === state.missionIndex) missions.start(index);
  else hud.showToast('Finish the earlier jobs first — Marisol runs a list, not a menu.', 'info');
});
state.bus.on('ui-mute', () => {
  audio.ensure();
  audio.setMuted(!audio.muted);
  hud.showToast(audio.muted ? 'Sound off' : 'Sound on', 'info', 1500);
});
state.bus.on('ui-phone', ({ open }) => { /* phone pauses nothing; the city keeps moving */ });

input.onKeyDown = (code) => audio.ensure();

// --- per-frame gameplay ----------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;
let nearMissCooldown = 0;
let propCooldown = 0;

function playerFocus() {
  const p = player.position;
  return new THREE.Vector3(p.x, 0, p.z);
}

function checkNearMiss(dt) {
  nearMissCooldown -= dt;
  const pv = player.vehicle;
  if (!player.inCar || !pv || nearMissCooldown > 0) return;
  for (const car of traffic.cars) {
    const dx = car.vehicle.pos.x - pv.pos.x;
    const dz = car.vehicle.pos.z - pv.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const rel = Math.abs(pv.speed - car.vehicle.speed);
    if (d < 4.2 && d > 2.6 && rel > 9) {
      nearMissCooldown = 1.5;
      state.stats.nearMisses += 1;
      state.earn(25, 'near miss');
      hud.showToast('Near miss! +$25', 'good', 1500);
      audio.blip(1320, 0.08, 'sine', 0.09);
      break;
    }
  }
}

function checkProps(dt) {
  propCooldown -= dt;
  if (propCooldown > 0) return;
  const p = player.position;
  for (const prop of city.props) {
    if (!prop.alive) continue;
    const d = dist2(p.x, p.z, prop.x, prop.z);
    if (d < 1.6) {
      prop.alive = false;
      prop.mesh.visible = false;
      effects.puff(prop.x, 0.6, prop.z, 8, 1.5, 1.5);
      state.stats.propsSmashed += 1;
      if (player.inCar && Math.abs(player.forwardSpeed) > 8) {
        state.earn(5, 'prop smashed');
        propCooldown = 0.4;
      }
    }
  }
}

function checkPedCollision() {
  const pv = player.vehicle;
  if (!player.inCar || !pv || Math.abs(pv.speed) < 3) return;
  for (const ped of [...peds.peds]) {
    if (ped.state === 'fixed') continue;
    const d = dist2(ped.x, ped.z, pv.pos.x, pv.pos.z);
    if (d < 1.7) {
      peds.removePed(ped);
      effects.puff(ped.x, 1, ped.z, 10, 2, 2);
      audio.crash(0.7);
      chaseCam.addShake(0.4);
      state.addHeat(25, 'hit a pedestrian');
      hud.showToast('You hit a pedestrian! The whole city saw that.', 'bad');
      state.stats.crimes += 1;
    }
  }
}

function checkRamps(dt) {
  const pv = player.vehicle;
  if (!player.inCar || !pv) return;
  if (pv.airborne > 0) {
    pv.airborne -= dt;
    pv.airTime += dt;
    if (pv.airborne <= 0) {
      state.stats.airtime += pv.airTime;
      if (pv.airTime > 0.6) {
        const bonus = Math.round(pv.airTime * 60);
        state.earn(bonus, 'airtime');
        hud.showToast(`Airtime ${pv.airTime.toFixed(1)}s! +$${bonus}`, 'good', 2000);
      }
      pv.airTime = 0;
      effects.puff(pv.pos.x, 0.3, pv.pos.z, 8, 2, 1);
    }
    return;
  }
  for (const ramp of ramps) {
    if (performance.now() - ramp.used < 1500) continue;
    const d = dist2(pv.pos.x, pv.pos.z, ramp.x, ramp.z);
    if (d < 3.5 && Math.abs(pv.speed) > 18) {
      ramp.used = performance.now();
      pv.airborne = 0.9;
      pv.airTime = 0;
      audio.blip(520, 0.2, 'sine', 0.1);
    }
  }
}

function checkSafehouse(dt) {
  const p = player.position;
  const sh = city.safehouse;
  const d = dist2(p.x, p.z, sh.x, sh.z);
  const near = d < 16;
  if (near && player.inCar && player.vehicle) {
    const model = player.vehicle.model;
    const isRare = CAR_MODELS[player.vehicle.modelKey] && CAR_MODELS[player.vehicle.modelKey].rare;
    const already = state.garage.some((g) => g.model === player.vehicle.modelKey);
    if (isRare && !already) {
      hud.showPrompt('Press G — park this rare car in the garage');
      if (input.wasPressed('KeyG')) {
        state.garage.push({ model: player.vehicle.modelKey, color: player.vehicle.model.color, name: model.name });
        state.bus.emit('garage', {});
        hud.showToast(`${model.name} parked in the garage — it is yours now.`, 'good');
        audio.cash();
      }
    } else {
      hud.showPrompt('Safehouse — press 1/2/3 to buy upgrades (Engine $500 · Armor $400 · Brakes $300)');
      if (input.wasPressed('Digit1') && state.upgrades.engine < 3 && state.spend(500)) {
        state.upgrades.engine += 1;
        hud.showToast(`Engine upgrade ${state.upgrades.engine}/3 installed.`, 'good');
      }
      if (input.wasPressed('Digit2') && state.upgrades.armor < 3 && state.spend(400)) {
        state.upgrades.armor += 1;
        hud.showToast(`Armor upgrade ${state.upgrades.armor}/3 installed.`, 'good');
      }
      if (input.wasPressed('Digit3') && state.upgrades.brakes < 3 && state.spend(300)) {
        state.upgrades.brakes += 1;
        hud.showToast(`Brakes upgrade ${state.upgrades.brakes}/3 installed.`, 'good');
      }
    }
    if (d < 10) {
      state.bus.emit('safehouse', {});
      saver.markDirty();
    }
  } else if (near && !player.inCar) {
    hud.showPrompt('Safehouse — your garage and upgrades live here.');
  } else {
    hud.showPrompt(null);
  }
  // Pay off the heat at the safehouse: standing in the yard cools you down.
  if (near && state.wanted > 0) {
    state.heat = Math.max(0, state.heat - dt * 9);
    const stars = Math.ceil(state.heat / 20);
    if (stars < state.wanted) state.setWanted(stars);
  }
}

function updateTailCars(dt) {
  for (const car of tailCars) {
    const v = car.vehicle;
    const wp = car.waypoints[car.wpIndex % car.waypoints.length];
    const dx = wp.x - v.pos.x, dz = wp.z - v.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 6) car.wpIndex += 1;
    const wantH = Math.atan2(dx, dz);
    let diff = wantH - v.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = clamp(diff * 1.4, -1, 1);
    v.update(dt, { throttle: 0.8, steer, handbrake: false }, city, traffic.cars.map((c) => c.vehicle));
    v.syncVisual(dt);
  }
}

function updateDriving(dt) {
  const pv = player.vehicle;
  if (!pv) return;
  // Upgrades scale the car.
  pv.upgradeMul = 1 + state.upgrades.engine * 0.09;
  const drive = input.driveInput();
  const others = traffic.cars.map((c) => c.vehicle)
    .concat(police.units.map((u) => u.vehicle))
    .concat(tailCars.map((c) => c.vehicle));
  const hit = pv.update(dt, drive, city, others);
  if (hit && hit.hit) {
    const impact = hit.impact || 0;
    if (impact > 6) {
      effects.burstSparks(pv.pos.x, 0.8, pv.pos.z, Math.min(20, Math.round(impact)));
      effects.puff(pv.pos.x, 0.5, pv.pos.z, 6, 2, 1.2);
      audio.crash(clamp(impact / 25, 0.3, 1.2));
      chaseCam.addShake(clamp(impact / 30, 0.15, 0.7));
      state.stats.collisions += 1;
      if (hit.hit === 'building' && impact > 12) state.addHeat(4, 'reckless driving');
      if (hit.hit === 'car' && impact > 10) state.addHeat(6, 'hit and run');
    }
  }
  if (pv.skidding) {
    effects.skidTrail(pv);
    effects.puff(pv.pos.x - Math.sin(pv.heading) * 1.5, 0.3, pv.pos.z - Math.cos(pv.heading) * 1.5, 2, 1, 0.8);
  }
  audio.setEngine(clamp(Math.abs(pv.speed) / 42, 0, 1), drive.throttle > 0 ? drive.throttle : 0, true);
  audio.setSkid(pv.skidding ? 0.8 : 0);
  state.carHealth = pv.health;
  state.stats.distanceDriven += Math.abs(pv.speed) * dt;
  state.stats.topSpeed = Math.max(state.stats.topSpeed, Math.abs(pv.speed));
  if (!pv.alive) {
    state.endRun('wrecked', { subtitle: 'The car is scrap. Marisol is not paying for the tow.' });
    audio.crash(1.2);
  }
}

// --- the loop ----------------------------------------------------------------
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String(e.reason)));

function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const dt = rawDt * state.timeScale;
  elapsed += dt;
  const phase = state.phase;

  // Global keys, whatever the phase.
  if (input.wasPressed('KeyM')) state.bus.emit('ui-mute');
  if (input.wasPressed('Escape')) {
    if (phase === PHASES.PLAYING) {
      state.phase = PHASES.PAUSED;
      hud.showPause(true);
    } else if (phase === PHASES.PAUSED) {
      state.phase = PHASES.PLAYING;
      hud.showPause(false);
    }
  }

  if (phase === PHASES.TITLE) {
    chaseCam.orbitShot(dt, elapsed);
    traffic.update(dt, playerFocus(), null);
    peds.update(dt, playerFocus(), 0, null);
    police.update(dt, playerFocus(), null, true, 0);
    effects.update(dt);
    // The title screen sits over a living city.
    if (input.wasPressed('Enter')) startNewGame();
  } else if (phase === PHASES.PLAYING) {
    state.stats.playSeconds += dt;
    // Camera orbit / zoom.
    const mouse = input.consumeMouse();
    if (mouse.dx || mouse.dy) chaseCam.orbit(mouse.dx, mouse.dy);
    const wheel = input.consumeWheel();
    if (wheel) chaseCam.zoom(wheel);
    // Enter / exit cars.
    if (input.wasPressed('KeyE')) {
      if (player.inCar) {
        player.exitCar();
        hud.showToast('On foot. Press E near a car to get in.', 'info', 2000);
      } else {
        const owned = player.nearestOwnedCar(4.5);
        const trafficCar = owned ? null : traffic.nearestStealable(player.pos.x, player.pos.z, 4.5);
        const result = player.tryEnter({ owned, trafficCar });
        if (result === 'stolen' && trafficCar) {
          traffic.removeCar(trafficCar);
        } else if (result === 'none') {
          hud.showToast('No car in reach.', 'info', 1500);
        }
      }
    }
    // Phone, radio.
    if (input.wasPressed('KeyP')) hud.togglePhone();
    if (input.wasPressed('KeyQ')) {
      const st = audio.nextStation();
      hud.setRadio('♪ ' + st.name);
      hud.showToast('Radio: ' + st.name, 'info', 2000);
    }
    if (input.wasPressed('KeyR')) {
      const on = audio.toggleRadio();
      hud.setRadio(on ? '♪ ' + audio.currentStation().name : 'Radio off');
      hud.showToast(on ? 'Radio on — ' + audio.currentStation().name : 'Radio off', 'info', 1500);
    }
    // Driving or walking.
    if (player.inCar) updateDriving(dt);
    else player.update(dt, input.walkInput(), chaseCam.yaw);
    // Enter-car prompt.
    if (!player.inCar && player.enterCooldown <= 0) {
      const owned = player.nearestOwnedCar(4.5);
      const tc = owned ? null : traffic.nearestStealable(player.pos.x, player.pos.z, 4.5);
      if (owned) hud.showPrompt('Press E — get in your ' + (CAR_MODELS[owned.modelKey]?.name || 'car'));
      else if (tc) hud.showPrompt('Press E — steal the ' + (CAR_MODELS[tc.modelKey]?.name || 'car'));
    }
    // World systems.
    const focus = playerFocus();
    traffic.update(dt, focus, player.vehicle);
    peds.update(dt, focus, player.forwardSpeed, player.vehicle);
    const policeInfo = police.update(dt, focus, player.vehicle, !player.inCar, player.forwardSpeed);
    missions.update(dt, focus, player.forwardSpeed, !player.inCar, player.inCar);
    updateTailCars(dt);
    effects.update(dt);
    checkNearMiss(dt);
    checkProps(dt);
    checkPedCollision();
    checkRamps(dt);
    checkSafehouse(dt);
    saver.update(dt);
    // HUD.
    hud.renderSpeed(player.forwardSpeed, player.inCar);
    hud.renderHealth(state.carHealth, state.playerHealth, player.inCar);
    hud.drawMinimap(focus, player.inCar ? player.vehicle.heading : player.heading,
      police.units, traffic.cars, missions.objectiveTarget());
    // Camera follows the player.
    chaseCam.update(dt, new THREE.Vector3(focus.x, 0, focus.z),
      player.inCar ? player.vehicle.heading : player.heading,
      player.forwardSpeed, player.inCar);
    // Wanted siren follows the heat.
    audio.setSiren(state.wanted > 0);
    if (!player.inCar) audio.setEngine(0, 0, false);
  } else if (phase === PHASES.PAUSED) {
    // Frozen frame; the pause menu is DOM.
  } else if (phase === PHASES.RESULTS) {
    traffic.freezeAll();
    effects.update(dt);
    chaseCam.orbitShot(dt, elapsed, { x: player.position.x, z: player.position.z });
  }

  input.endFrame();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- boot --------------------------------------------------------------------
player.spawnAt(city.spawn.x, city.spawn.z, city.spawn.heading);
hud.showTitle(hasSave());
hud.renderCash(state.cash);
hud.renderWanted(0);
hud.setRadio('Radio off — press R');
hud.refreshJobList();
if (hasShotParam()) {
  // Deterministic scene presets for the screenshots.
  state.phase = PHASES.PLAYING;
  hud.hideTitle();
  hud.showHud(true);
  applyShotPreset({ state, player, traffic, peds, police, missions, hud, city, starterCar, parked1, parked2, audio, chaseCam });
}
animate();

// --- debug handle for the headless playtest ----------------------------------
window.__solmar = {
  state,
  player,
  missions,
  police,
  traffic,
  peds,
  city,
  audio,
  errors,
  startNewGame,
  continueGame,
  quitToTitle,
  startMission: (i) => missions.start(i),
  setWanted: (n) => state.setWanted(n),
  teleport: (x, z, heading) => {
    if (player.inCar && player.vehicle) player.vehicle.teleport(x, z, heading);
    else player.spawnAt(x, z, heading);
  },
  shotReady: () => true,
};
