// main.js — SOLMAR: Sunset Getaway. Boot, render loop, chase camera,
// input, game states (title / playing / paused / results), safehouse
// interactions, and the ?shot= scene composer used for the screenshots.
// Everything the other modules need hangs off one shared game object G.

import * as THREE from 'three';
import { buildCity, CITY, blockCenter, roadCoord } from './city.js';
import { spawnTraffic, spawnParkedCars, makeCar, distance2D, CAR_COLORS, updateTrafficCar } from './vehicles.js';
import { spawnPedestrians, updatePedestrians } from './pedestrians.js';
import { spawnPatrolCars, updatePolice, wantedForCrime, clearWanted, ensurePursuitCars } from './police.js';
import { createMissions, startMission, updateMissions, MISSIONS } from './missions.js';
import { createPlayer, updatePlayer, exitCar, tryEnterNearestCar, payOffHeat, onCrash, onPoliceRam } from './player.js';
import { createHUD, updateHUD, showToast, flashCenter, showBriefingCard, showMissionResultCard, showTitleScreen, hideTitleScreen, showResultsScreen, hideResultsScreen, showPauseMenu, updateShopList } from './hud.js';
import { createAudio, ensureAudio, setSirenSound, toggleMute, cycleStation } from './audio.js';
import { createEffects, updateEffects, addSkid, spawnBurst, showPopup } from './effects.js';
import { createActivities, updateActivities, startRace } from './activities.js';
import { createCombat, updateCombat, queuePunch, copRetaliation } from './combat.js';
import { createWorldEvents, updateWorldEvents } from './world-events.js';
import { loadSave, writeSave, clearSave, formatCash } from './save.js';

export const GAME_VERSION = '1.0.0-round3';
export const SEED = 20261119;

const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot') || null;
const AUTOSTART = params.get('autostart') === '1';

export function createGame() {
  const canvas = document.getElementById('game-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffb36b);
  scene.fog = new THREE.Fog(0xffc07a, 180, 520);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(0, 40, 120);

  const sun = new THREE.DirectionalLight(0xffd9a0, 2.6);
  sun.position.set(-140, 180, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xffd9b0, 0x3a4a5a, 0.9);
  scene.add(hemi);
  const sunsetGlow = new THREE.PointLight(0xff8c42, 1.2, 400);
  sunsetGlow.position.set(320, 40, 0);
  scene.add(sunsetGlow);

  const G = {
    renderer, scene, camera, sun,
    time: 0,
    state: 'title',
    paused: false,
    keys: {},
    cameraHeading: 0,
    cameraDistance: 16.5,
    cameraHeight: 7.5,
    camPos: new THREE.Vector3(0, 40, 120),
    camLook: new THREE.Vector3(0, 0, 0),
    wanted: 0,
    heat: 0,
    seenTimer: 0,
    shot: SHOT,
    save: loadSave(),
    audio: createAudio(),
    effects: null,
    hud: null,
    city: null,
    cars: [],
    peds: [],
    police: [],
    roadblocks: [],
    heli: null,
    missions: null,
    player: null,
    errorCount: 0,
    errors: [],
    startedAt: Date.now(),
    playSeconds: 0,
    devInfo: { version: GAME_VERSION, seed: SEED },
  };
  G.effects = createEffects(scene);
  G.city = buildCity(scene, SEED);
  G.missions = createMissions(G);
  G.activities = null;
  G.combat = createCombat(G);
  G.worldEvents = createWorldEvents(G);
  G.hud = createHUD(G);

  const spawn = blockCenter(1, 7);
  G.player = createPlayer(scene, spawn.x + 6, spawn.z + 4);
  G.player.pos.set(spawn.x + 6, 0, spawn.z + 4);

  spawnTraffic(G, 26);
  spawnParkedCars(G, 16);
  spawnPedestrians(G, 42);
  spawnPatrolCars(G, 4);
  G.activities = createActivities(G);

  const starterCar = makeCar(scene, 'coupe', 0xe8641b, spawn.x + 12, spawn.z + 2, Math.PI / 2, { parked: true });
  starterCar.stealable = false;
  starterCar.owned = true;
  G.cars.push(starterCar);
  G.starterCar = starterCar;

  G.onCrash = (speed, kind) => onCrash(G, speed, kind);
  G.onPoliceRam = (cop, dist) => onPoliceRam(G, cop, dist);
  // Small debug handle for the headless playtest harness only: it drives the
  // same code paths the player uses (startMission, wanted, teleport).
  G.debug = {
    startMission: (i) => startMission(G, i),
    setWanted: (n) => { G.wanted = n; G.heat = n * 20; import('./police.js').then((p) => p.ensurePursuitCars(G)); },
    teleport: (x, z) => {
      if (G.player.car) { G.player.car.pos.set(x, 0, z); G.player.pos.copy(G.player.car.pos); }
      else { G.player.pos.set(x, 0, z); G.player.mesh.position.copy(G.player.pos); }
    },
    enterCar: () => tryEnterNearestCar(G),
    state: () => ({
      state: G.state, wanted: G.wanted, cash: G.save.cash, errors: G.errorCount,
      missionIndex: G.missions.index, missionActive: !!G.missions.active,
      mode: G.player.mode, speed: G.player.car ? Math.abs(G.player.car.speed) : 0,
      pos: { x: Math.round(G.player.pos.x), z: Math.round(G.player.pos.z) },
      police: G.police.length, peds: G.peds.length, cars: G.cars.length,
    }),
  };
  G.addSkid = (x, z, heading) => addSkid(G.effects, x, z, heading);
  G.hudFlash = (text) => flashCenter(G, text);
  G.showPopup = (text, kind) => { showPopup(G.effects, text, kind); showToast(G, text, kind); };
  G.showBriefing = (def) => showBriefingCard(G, def);
  G.showMissionResult = (success, def, detail) => showMissionResultCard(G, success, def, detail);
  G.finishGame = (won, reason) => finishGame(G, won, reason);

  window.addEventListener('keydown', (e) => {
    G.keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyM') onMissionKey(G);
    if (e.code === 'KeyP' || e.code === 'Escape') onPauseKey(G);
    if (e.code === 'KeyR' && G.state === 'results') restartGame(G);
    if (e.code === 'KeyE' && G.state === 'playing' && G.player.mode === 'car') {
      if (G.player.car && Math.abs(G.player.car.speed) < 2) exitCar(G);
    }
    if (e.code === 'KeyQ') {
      const station = cycleStation(G.audio);
      G.showPopup && G.showPopup(station, 'info');
    }
    if (e.code === 'KeyT') startRace(G);
    if (e.code === 'KeyH') { /* pay off handled in checkSafehouse */ }
    if (e.code === 'KeyN') {
      const muted = toggleMute(G.audio);
      G.showPopup && G.showPopup(muted ? 'Sound off' : 'Sound on', 'info');
    }
    if (e.code === 'Enter' && G.state === 'title') startNewGame(G);
  });
  window.addEventListener('keyup', (e) => { G.keys[e.code] = false; });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener('error', (e) => {
    G.errorCount += 1;
    G.errors.push(String(e.message || e.error || 'unknown error'));
  });
  window.addEventListener('pointerdown', () => ensureAudio(G.audio), { once: true });
  window.addEventListener('mousedown', () => { if (G.state === 'playing') queuePunch(G); });

  document.getElementById('new-game-btn').addEventListener('click', () => startNewGame(G));
  document.getElementById('continue-btn').addEventListener('click', () => continueGame(G));
  document.getElementById('resume-btn').addEventListener('click', () => onPauseKey(G));
  document.getElementById('restart-btn').addEventListener('click', () => restartGame(G));
  document.getElementById('quit-btn').addEventListener('click', () => quitToTitle(G));
  document.getElementById('payoff-btn').addEventListener('click', () => {
    if (payOffHeat(G)) updateHUD(G);
    else G.showPopup && G.showPopup(G.wanted <= 0 ? 'No heat to pay off.' : 'Not enough cash to pay off the heat.', 'bad');
  });
  document.getElementById('results-restart').addEventListener('click', () => restartGame(G));
  document.getElementById('results-title').addEventListener('click', () => quitToTitle(G));
  const shotBtn = document.getElementById('shot-skip');
  if (shotBtn) shotBtn.addEventListener('click', () => hideTitleScreen(G));

  if (SHOT) {
    composeShotScene(G, SHOT);
  } else {
    showTitleScreen(G);
    setupTitleCamera(G);
  }
  if (AUTOSTART) startNewGame(G);
  return G;
}

function onMissionKey(G) {
  if (G.state !== 'playing') return;
  if (G.missions.active) {
    G.showBriefing && G.showBriefing(G.missions.active.def);
    return;
  }
  if (G.missions.index < MISSIONS.length) {
    startMission(G, G.missions.index);
  } else {
    G.showPopup && G.showPopup('All jobs done — free roam. Enjoy Solmar.', 'good');
  }
}

function onPauseKey(G) {
  if (G.state === 'playing') {
    G.state = 'paused';
    showPauseMenu(G, true);
    updateShopList(G);
  } else if (G.state === 'paused') {
    G.state = 'playing';
    showPauseMenu(G, false);
  }
}

export function startNewGame(G) {
  G.save = clearSave();
  G.missions.index = 0;
  G.missions.active = null;
  hideTitleScreen(G);
  hideResultsScreen(G);
  G.state = 'playing';
  G.time = 0;
  G.wanted = 0;
  G.heat = 0;
  clearWanted(G, '');
  ensureAudio(G.audio);
  G.showPopup && G.showPopup('Welcome to Solmar. Press M to take your first job from Marisol.', 'info');
  updateHUD(G);
}

export function continueGame(G) {
  hideTitleScreen(G);
  hideResultsScreen(G);
  G.state = 'playing';
  G.missions.index = G.save.missionIndex || 0;
  ensureAudio(G.audio);
  G.showPopup && G.showPopup('Welcome back. Job ' + (G.missions.index + 1) + ' of 6 is waiting — press M.', 'info');
  updateHUD(G);
}

export function restartGame(G) {
  hideResultsScreen(G);
  showPauseMenu(G, false);
  const spawn = blockCenter(1, 7);
  G.player.pos.set(spawn.x + 6, 0, spawn.z + 4);
  G.player.mesh.position.copy(G.player.pos);
  G.player.mesh.visible = true;
  G.player.mode = 'foot';
  G.player.car = null;
  G.player.health = 100;
  G.player.carHealth = 100;
  G.player.heading = 0;
  G.wanted = 0;
  G.heat = 0;
  clearWanted(G, '');
  G.missions.active = null;
  G.missions.index = 0;
  G.time = 0;
  G.state = 'playing';
  ensureAudio(G.audio);
  G.showPopup && G.showPopup('Fresh run. Press M for the first job.', 'info');
  updateHUD(G);
}

export function quitToTitle(G) {
  hideResultsScreen(G);
  showPauseMenu(G, false);
  G.state = 'title';
  writeSave(G.save);
  setupTitleCamera(G);
  showTitleScreen(G);
}

export function finishGame(G, won, reason) {
  if (G.state === 'results') return;
  G.state = 'results';
  G.save.stats.playSeconds += Math.floor(G.time);
  writeSave(G.save);
  if (won) {
    G.save.stats.jobsDone = 6;
    writeSave(G.save);
  }
  import('./audio.js').then((a) => a.playMissionSting(G.audio, won));
  showResultsScreen(G, won, reason || '');
  updateHUD(G);
}

function setupTitleCamera(G) {
  G.camPos.set(-40, 90, 190);
  G.camLook.set(0, 0, 0);
  G.camera.position.copy(G.camPos);
  G.camera.lookAt(G.camLook);
}

export function updateCamera(G, dt) {
  const player = G.player;
  const cam = G.camera;
  if (G.state === 'title') {
    const t = G.time * 0.05;
    const radius = 200;
    const x = Math.cos(t) * radius;
    const z = Math.sin(t) * radius;
    cam.position.lerp(new THREE.Vector3(x, 85, z), Math.min(1, dt * 0.5));
    cam.lookAt(0, 10, 0);
    return;
  }
  const heading = player.heading;
  const speed = player.car ? Math.abs(player.car.speed) : 0;
  const speedRatio = Math.min(1, speed / 45);
  const dist = G.cameraDistance + speedRatio * 4;
  const height = G.cameraHeight + speedRatio * 1.2;
  let desired;
  if (player.mode === 'car' && player.car) {
    const back = -1;
    desired = new THREE.Vector3(
      player.car.pos.x + Math.sin(heading) * back * dist,
      height,
      player.car.pos.z + Math.cos(heading) * back * dist
    );
    G.cameraHeading = heading;
  } else {
    desired = new THREE.Vector3(
      player.pos.x + Math.sin(heading + Math.PI) * 7,
      4.2,
      player.pos.z + Math.cos(heading + Math.PI) * 7
    );
    G.cameraHeading = heading + Math.PI;
  }
  const target = player.mode === 'car' && player.car
    ? new THREE.Vector3(player.car.pos.x + Math.sin(heading) * 6, 1.8, player.car.pos.z + Math.cos(heading) * 6)
    : new THREE.Vector3(player.pos.x, 1.6, player.pos.z);
  const lerpRate = Math.min(1, dt * (player.mode === 'car' ? 4.5 : 6));
  G.camPos.lerp(desired, lerpRate);
  G.camLook.lerp(target, Math.min(1, dt * 7));
  cam.position.set(G.camPos.x + G.effects.shakeX, G.camPos.y + G.effects.shakeY, G.camPos.z);
  cam.lookAt(G.camLook);
  const fov = 62 + speedRatio * 10;
  if (Math.abs(cam.fov - fov) > 0.2) {
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
  }
}

export function checkSafehouse(G, dt) {
  const sh = G.city.safehouse;
  const d = Math.hypot(G.player.pos.x - sh.x, G.player.pos.z - sh.z);
  if (d > 14) return;
  if (G.wanted > 0 && G.player.mode === 'foot') {
    G.showPopup && G.showPopup('Safehouse: press H to pay off heat ($' + (G.wanted * 300) + ')', 'info');
    if (G.keys['KeyH']) {
      if (payOffHeat(G)) updateHUD(G);
      else G.showPopup && G.showPopup('Not enough cash.', 'bad');
    }
  }
  if (G.player.mode === 'car' && G.player.car && G.player.car.stealable !== false && !G.player.car.owned) {
    const car = G.player.car;
    import('./save.js').then((s) => {
      if (s.addGarageCar(G.save, car)) {
        car.owned = true;
        car.stealable = false;
        G.showPopup && G.showPopup('Parked the ' + car.name + ' in your garage. It is yours now.', 'good');
      }
    });
  }
}

function composeShotScene(G, shot) {
  hideTitleScreen(G);
  G.state = 'playing';
  G.time = 12;
  ensureAudio(G.audio);
  const cafe = blockCenter(4, 4);
  const ave = { x: roadCoord(4), z: roadCoord(4) };
  if (shot === 'title') {
    G.state = 'title';
    showTitleScreen(G);
    setupTitleCamera(G);
    G.camera.position.set(-30, 55, 150);
    G.camera.lookAt(40, 8, 0);
    return;
  }
  if (shot === 'chase') {
    const car = G.starterCar;
    car.pos.set(ave.x, 0, ave.z - 30);
    car.heading = 0;
    car.speed = 26;
    G.player.mode = 'car';
    G.player.car = car;
    car.driver = G.player;
    car.traffic = false;
    car.ai = null;
    G.player.pos.copy(car.pos);
    G.player.mesh.visible = false;
    G.wanted = 3;
    G.heat = 80;
    ensurePursuitCars(G);
    const chaser = G.police.find((c) => c.state === 'pursue');
    if (chaser) {
      chaser.pos.set(ave.x - 4, 0, ave.z + 14);
      chaser.heading = Math.PI;
      chaser.speed = 30;
    }
    const ahead1 = makeCar(G.scene, 'taxi', 0xf2c200, ave.x + 3, ave.z - 62, 0, { traffic: true });
    ahead1.ai = { target: null, speed: 14, wait: 0, lane: 0 };
    const ahead2 = makeCar(G.scene, 'sedan', 0x1f3a5f, ave.x - 3, ave.z - 85, 0, { traffic: true });
    ahead2.ai = { target: null, speed: 12, wait: 0, lane: 0 };
    G.cars.push(ahead1, ahead2);
    G.missions.index = 3;
    startMission(G, 3);
    G.missions.active.objective = 'Escape the police — lose 3 stars';
    G.missions.timer = 180;
    G.camera.position.set(ave.x - 14, 7, ave.z - 44);
    G.camera.lookAt(ave.x, 2, ave.z);
    return;
  }
  if (shot === 'onfoot') {
    const corner = { x: roadCoord(5) - 4, z: roadCoord(4) + 8 };
    G.player.pos.set(corner.x - 5, 0, corner.z + 6);
    G.player.mesh.position.copy(G.player.pos);
    G.player.mesh.visible = true;
    G.player.mode = 'foot';
    G.player.heading = Math.PI * 0.55;
    G.missions.index = 0;
    startMission(G, 0);
    G.camera.position.set(corner.x + 20, 8, corner.z + 24);
    G.camera.lookAt(corner.x - 4, 2, corner.z - 8);
    return;
  }
  if (shot === 'results') {
    G.save.cash = 6840;
    G.save.totalEarned = 12150;
    G.save.stats.jobsDone = 6;
    G.save.nearMisses = 23;
    G.save.carsStolen = 7;
    G.missions.index = 6;
    finishGame(G, true, '');
    G.camera.position.set(roadCoord(7), 30, roadCoord(4) - 60);
    G.camera.lookAt(G.city.marina.x, 4, G.city.marina.z);
    return;
  }
  G.state = 'title';
  showTitleScreen(G);
}

export function gameLoop(G) {
  const clock = new THREE.Clock();
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());
    if ((G.state === 'playing' || G.state === 'title') && !G.paused) {
      G.time += dt;
      G.playSeconds += dt;
      updatePlayer(G, dt);
      for (const car of G.cars) {
        if (car.traffic && car.ai) updateTrafficCar(G, car, dt);
      }
      updatePedestrians(G, dt);
      updatePolice(G, dt);
      updateMissions(G, dt);
      updateActivities(G, dt);
      updateCombat(G, dt);
      copRetaliation(G, dt);
      updateWorldEvents(G, dt);
      checkSafehouse(G, dt);
      setSirenSound(G.audio, G.wanted, dt);
      updateHUD(G);
    }
    updateEffects(G.effects, dt, G.player.car ? Math.min(1, Math.abs(G.player.car.speed) / 45) : 0);
    updateCamera(G, dt);
    G.renderer.render(G.scene, G.camera);
  }
  tick();
}

export function startGame() {
  const G = createGame();
  gameLoop(G);
  window.SOLMAR = G;
  window.__solmarReady = true;
  return G;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startGame);
} else {
  startGame();
}
