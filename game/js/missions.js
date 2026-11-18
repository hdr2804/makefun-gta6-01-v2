// missions.js — the story of SOLMAR: Sunset Getaway. Six chained jobs for
// fixer Marisol Vega: pickup, timed delivery, tail, heist escape, blockade
// run, and the final five-star Sunset Run to the marina boat. Each mission
// has a briefing card, a 3D beacon + HUD arrow + minimap blip, success and
// fail screens, and a payout. Failing a mission lets you retry it.

import * as THREE from 'three';
import { CITY, blockCenter, nearestRoadCoord, resolveCircleCollision, roadCoord } from './city.js';
import { distance2D, makeCar, CAR_COLORS } from './vehicles.js';
import { makePedestrian, removePedestrian } from './pedestrians.js';
import { recordPayout, recordMissionDone, writeSave } from './save.js';

export const MISSIONS = [
  {
    id: 'm1-first-fare',
    title: 'Job 1 — First Fare',
    client: 'Marisol Vega',
    briefing: 'Fresh out of the game and already on the clock. Pick up my courier Lucia at the Coral Cafe and drop her at the north marina gate. Drive like a professional, not a tourist.',
    objective: 'Pick up Lucia at the Coral Cafe',
    payout: 400,
    par: 150,
  },
  {
    id: 'm2-hot-delivery',
    title: 'Job 2 — Hot Delivery',
    client: 'Marisol Vega',
    briefing: 'A package for the Delgado brothers, and it cannot be late. Cross town in 2 minutes 30 seconds. Traffic is your problem, not mine. The car is already warm — take the coupe by the cafe.',
    objective: 'Deliver the package before the timer runs out',
    payout: 750,
    par: 150,
  },
  {
    id: 'm3-tail-job',
    title: 'Job 3 — Tail Job',
    client: 'Marisol Vega',
    briefing: 'Rico Ferrante is meeting someone he should not meet. Follow his teal sedan from the plaza. Stay close enough to see him, far enough that he never sees you. If he spots you, the job is dead.',
    objective: 'Tail Rico without being spotted',
    payout: 900,
    par: 240,
  },
  {
    id: 'm4-marina-heist',
    title: 'Job 4 — The Marina Heist',
    client: 'Marisol Vega',
    briefing: 'The vault truck is parked behind the marina warehouse. Grab the case, and do not stop for anything. The police will be on you the second the alarm trips. Lose them, then bring the case to me.',
    objective: 'Grab the case and lose the police',
    payout: 1500,
    par: 300,
  },
  {
    id: 'm5-blockade-run',
    title: 'Job 5 — Through the Blockade',
    client: 'Marisol Vega',
    briefing: 'My client needs to cross town tonight and the police have the bridges watched. Ferry him through the roadblock on Solmar Avenue. Ram it, dodge it, slip around it — just get him through.',
    objective: 'Ferry the client through the roadblock',
    payout: 2000,
    par: 300,
  },
  {
    id: 'm6-sunset-run',
    title: 'Job 6 — The Sunset Run',
    client: 'Marisol Vega',
    briefing: 'Last job. The whole department is coming for us tonight — five stars, no deals. Drive from the safehouse to the marina boat before sunrise. Get on that boat and we are gone. Make it count.',
    objective: 'Reach the marina boat with 5 stars on you',
    payout: 5000,
    par: 420,
  },
];

export function createMissions(G) {
  return {
    index: G.save.missionIndex || 0,
    active: null,
    stage: 'idle',
    timer: 0,
    marker: null,
    beacon: null,
    targetCar: null,
    targetPed: null,
    clientPed: null,
    tailSpotted: 0,
    tailProgress: 0,
    pickupDone: false,
    dropDone: false,
    caseTaken: false,
    passedBlock: false,
    lastDistance: 0,
  };
}

export function missionObjectiveText(G) {
  const M = G.missions;
  if (!M.active) {
    const next = MISSIONS[Math.min(M.index, MISSIONS.length - 1)];
    return 'Next job: ' + next.title + ' — press M for briefing';
  }
  return M.active.objective;
}

export function startMission(G, index) {
  const def = MISSIONS[index];
  if (!def) return false;
  const M = G.missions;
  cleanupMissionEntities(G);
  M.active = {
    def,
    index,
    objective: def.objective,
    stage: 'go',
    timer: def.par,
    startedAt: G.time,
  };
  M.stage = 'go';
  M.timer = def.par;
  M.index = index;
  M.pickupDone = false;
  M.dropDone = false;
  M.caseTaken = false;
  M.passedBlock = false;
  M.tailSpotted = 0;
  M.tailProgress = 0;
  const cafe = blockCenter(4, 4);
  const cafeCorner = { x: roadCoord(5) - 4, z: roadCoord(4) + 8 };
  const north = { x: roadCoord(7), z: roadCoord(1) };
  const southCorner = { x: roadCoord(3) - 4, z: roadCoord(7) + 8 };
  const plaza = blockCenter(4, 3);
  const marinaGate = { x: roadCoord(8), z: 40 };
  if (index === 0) {
    const ped = makePedestrian(G.scene, cafeCorner.x, cafeCorner.z, { name: 'Lucia', state: 'idle', isMission: true });
    ped.wait = 9999;
    M.targetPed = ped;
    G.peds.push(ped);
    setMarker(G, ped.pos.x, ped.pos.z);
    G.showBriefing && G.showBriefing(def);
  } else if (index === 1) {
    setMarker(G, north.x, north.z);
    const coupe = makeCar(G.scene, 'coupe', 0xe8641b, cafeCorner.x + 6, cafeCorner.z, Math.PI / 2, { parked: true });
    G.cars.push(coupe);
    M.targetCar = coupe;
    G.showBriefing && G.showBriefing(def);
  } else if (index === 2) {
    const rico = makeCar(G.scene, 'sedan', 0x0e7c86, plaza.x, plaza.z, 0, { traffic: false });
    rico.ai = { target: null, speed: 13, wait: 0, lane: 0 };
    G.cars.push(rico);
    M.targetCar = rico;
    setMarker(G, rico.pos.x, rico.pos.z);
    G.showBriefing && G.showBriefing(def);
  } else if (index === 3) {
    setMarker(G, marinaGate.x, marinaGate.z);
    G.showBriefing && G.showBriefing(def);
  } else if (index === 4) {
    const client = makePedestrian(G.scene, southCorner.x, southCorner.z, { name: 'The Client', state: 'idle', isMission: true });
    client.wait = 9999;
    M.clientPed = client;
    G.peds.push(client);
    setMarker(G, client.pos.x, client.pos.z);
    G.showBriefing && G.showBriefing(def);
  } else if (index === 5) {
    G.wanted = 5;
    G.heat = 100;
    import('./police.js').then((police) => police.ensurePursuitCars(G));
    setMarker(G, marinaGate.x, marinaGate.z);
    G.showBriefing && G.showBriefing(def);
  }
  G.hudFlash && G.hudFlash(def.title);
  return true;
}

export function setMarker(G, x, z) {
  clearMarker(G);
  const M = G.missions;
  M.marker = { x, z };
  const geo = new THREE.CylinderGeometry(2.2, 2.2, 0.25, 20);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85 });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.set(x, 0.15, z);
  G.scene.add(ring);
  const beamGeo = new THREE.CylinderGeometry(1.1, 1.1, 60, 12, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(x, 30, z);
  G.scene.add(beam);
  M.beacon = { ring, beam };
}

export function clearMarker(G) {
  const M = G.missions;
  if (M.beacon) {
    G.scene.remove(M.beacon.ring);
    G.scene.remove(M.beacon.beam);
    M.beacon.ring.geometry.dispose();
    M.beacon.beam.geometry.dispose();
    M.beacon = null;
  }
  M.marker = null;
}

export function cleanupMissionEntities(G) {
  const M = G.missions;
  if (M.targetPed) { removePedestrian(G, M.targetPed); M.targetPed = null; }
  if (M.clientPed) { removePedestrian(G, M.clientPed); M.clientPed = null; }
  if (M.targetCar && M.active && M.active.index === 2) {
    const idx = G.cars.indexOf(M.targetCar);
    if (idx >= 0) { G.scene.remove(M.targetCar.mesh); G.cars.splice(idx, 1); }
    M.targetCar = null;
  }
  clearMarker(G);
}

export function failMission(G, reason) {
  const M = G.missions;
  if (!M.active) return;
  const def = M.active.def;
  cleanupMissionEntities(G);
  M.active = null;
  M.stage = 'failed';
  G.save.stats.busts += reason === 'busted' ? 1 : 0;
  G.save.stats.wrecks += reason === 'wrecked' ? 1 : 0;
  writeSave(G.save);
  G.showMissionResult && G.showMissionResult(false, def, reason);
  import('./audio.js').then((a) => a.playMissionSting(G.audio, false));
}

export function completeMission(G, bonus) {
  const M = G.missions;
  if (!M.active) return;
  const def = M.active.def;
  const elapsed = G.time - M.active.startedAt;
  const timeBonus = Math.max(0, Math.round((def.par - elapsed) * 2));
  const payout = def.payout + (bonus || 0) + timeBonus;
  cleanupMissionEntities(G);
  recordPayout(G.save, payout);
  recordMissionDone(G.save, def.id);
  M.index = Math.min(MISSIONS.length, M.index + 1);
  M.active = null;
  M.stage = 'done';
  if (G.effects) {
    import('./effects.js').then((fx) => fx.spawnConfetti(G.effects, new THREE.Vector3(G.player.pos.x, 2, G.player.pos.z)));
  }
  import('./audio.js').then((a) => { a.playCash(G.audio); a.playMissionSting(G.audio, true); });
  G.showMissionResult && G.showMissionResult(true, def, 'Job complete — $' + payout + ' (time bonus $' + timeBonus + ')');
  if (M.index >= MISSIONS.length) {
    setTimeout(() => G.finishGame && G.finishGame(true), 1600);
  }
}

export function updateMissions(G, dt) {
  const M = G.missions;
  if (!M.active) return;
  const def = M.active.def;
  const idx = M.active.index;
  const playerPos = G.player.pos;
  if (M.beacon) {
    M.beacon.ring.rotation.y += dt * 1.2;
    M.beacon.ring.scale.setScalar(1 + Math.sin(G.time * 3) * 0.08);
  }
  if (idx === 1 || idx === 3 || idx === 5) {
    M.timer -= dt;
    if (M.timer <= 0) {
      failMission(G, idx === 1 ? 'Out of time — the package went cold.' : 'Out of time.');
      return;
    }
  }
  if (idx === 0) {
    if (!M.pickupDone && M.targetPed) {
      const d = distance2D(playerPos, M.targetPed.pos);
      if (d < 4) {
        M.pickupDone = true;
        removePedestrian(G, M.targetPed);
        M.targetPed = null;
        M.active.objective = 'Drop Lucia at the north marina gate';
        setMarker(G, roadCoord(8), 40);
        G.showPopup && G.showPopup('Lucia is in. Drive to the marina gate.', 'good');
        import('./audio.js').then((a) => a.blip(G.audio, 880, 0.15, 'sine', 0.12));
      }
    } else if (M.pickupDone) {
      if (distance2D(playerPos, { x: roadCoord(8), z: 40 }) < 10) {
        completeMission(G, 0);
      }
    }
  } else if (idx === 1) {
    const dest = { x: roadCoord(7), z: roadCoord(1) };
    if (distance2D(playerPos, dest) < 10) completeMission(G, 0);
  } else if (idx === 2) {
    const rico = M.targetCar;
    if (!rico) { failMission(G, 'Rico vanished.'); return; }
    setMarker(G, rico.pos.x, rico.pos.z);
    const d = distance2D(playerPos, rico.pos);
    if (d < 10) {
      M.tailSpotted += dt;
      if (M.tailSpotted > 2.5) { failMission(G, 'Rico spotted you. The job is dead.'); return; }
    } else {
      M.tailSpotted = Math.max(0, M.tailSpotted - dt);
    }
    if (d > 90) {
      failMission(G, 'You lost Rico in the city.');
      return;
    }
    if (d >= 12 && d <= 70) M.tailProgress += dt;
    if (M.tailProgress >= 75) completeMission(G, 150);
    driveTailCar(G, rico, dt);
  } else if (idx === 3) {
    if (!M.caseTaken) {
      if (distance2D(playerPos, { x: roadCoord(8), z: 40 }) < 9) {
        M.caseTaken = true;
        M.active.objective = 'Lose the police, then reach Marisol at the cafe';
        G.wanted = Math.max(G.wanted, 3);
        G.heat = 100;
        import('./police.js').then((police) => police.ensurePursuitCars(G));
        setMarker(G, roadCoord(5), roadCoord(4));
        G.showPopup && G.showPopup('Case grabbed! Lose the cops first.', 'bad');
      }
    } else if (G.wanted <= 0) {
      const cafe = { x: roadCoord(5), z: roadCoord(4) };
      if (distance2D(playerPos, cafe) < 11) completeMission(G, 0);
    }
  } else if (idx === 4) {
    if (M.clientPed) {
      const d = distance2D(playerPos, M.clientPed.pos);
      if (d < 4) {
        removePedestrian(G, M.clientPed);
        M.clientPed = null;
        M.active.objective = 'Drive the client through the roadblock on Solmar Avenue';
        const ave = { x: nearestRoadCoord(0), z: roadCoord(4) };
        setMarker(G, ave.x + 120, ave.z);
        G.wanted = Math.max(G.wanted, 3);
        G.heat = 100;
        import('./police.js').then((police) => police.ensurePursuitCars(G));
        G.showPopup && G.showPopup('Client aboard. Punch through the blockade.', 'info');
      }
    } else {
      const dest = { x: nearestRoadCoord(0) + 120, z: roadCoord(4) };
      if (!M.passedBlock && distance2D(playerPos, { x: nearestRoadCoord(0) + 40, z: roadCoord(4) }) < 14) {
        M.passedBlock = true;
        G.showPopup && G.showPopup('Through the blockade!', 'good');
      }
      if (M.passedBlock && distance2D(playerPos, dest) < 12) completeMission(G, 0);
    }
  } else if (idx === 5) {
    if (distance2D(playerPos, { x: CITY.half - 44, z: 40 }) < 12) {
      completeMission(G, 0);
    }
  }
}

function driveTailCar(G, rico, dt) {
  if (!rico.ai) return;
  const route = [
    { x: roadCoord(4), z: roadCoord(3) },
    { x: roadCoord(6), z: roadCoord(3) },
    { x: roadCoord(6), z: roadCoord(6) },
    { x: roadCoord(2), z: roadCoord(6) },
    { x: roadCoord(2), z: roadCoord(2) },
    { x: roadCoord(5), z: roadCoord(2) },
  ];
  if (!rico.ai.target) rico.ai.target = route[0];
  const target = rico.ai.target;
  const d = distance2D(rico.pos, target);
  if (d < 8) {
    const nextIndex = (route.indexOf(target) + 1) % route.length;
    rico.ai.target = route[nextIndex];
  }
  const desired = Math.atan2(target.x - rico.pos.x, target.z - rico.pos.z);
  let diff = desired - rico.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  rico.heading += Math.max(-1.8 * dt, Math.min(1.8 * dt, diff));
  rico.speed += Math.max(-14 * dt, Math.min(10 * dt, rico.ai.speed - rico.speed));
  rico.pos.x += Math.sin(rico.heading) * rico.speed * dt;
  rico.pos.z += Math.cos(rico.heading) * rico.speed * dt;
  const hit = resolveCircleCollision(G.city, rico.pos, 1.5);
  if (hit) { rico.heading += Math.PI * 0.4; rico.speed *= 0.5; }
  rico.mesh.rotation.y = rico.heading;
}

export function missionProgressLabel(G) {
  const M = G.missions;
  if (!M.active) return 'No active job';
  const idx = M.active.index;
  if (idx === 2) return 'Tail progress ' + Math.floor((M.tailProgress / 75) * 100) + '%';
  if (idx === 1 || idx === 3 || idx === 5) return 'Time left ' + Math.max(0, Math.ceil(M.timer)) + 's';
  return M.active.objective;
}
