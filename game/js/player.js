// player.js — you, the getaway driver of Solmar. On foot (walk, sprint,
// enter cars) and behind the wheel (arcade driving, stealing, near-miss
// and stunt bonuses, busted and wrecked outcomes). One module owns the
// player's body, car, health and the enter/exit dance.

import * as THREE from 'three';
import { CITY, resolveCircleCollision } from './city.js';
import { driveCar, nearestCar, carsCollide, distance2D } from './vehicles.js';
import { knockPedestrian } from './pedestrians.js';
import { wantedForCrime, clearWanted } from './police.js';
import { armorMultiplier } from './save.js';

export function createPlayer(scene, x, z) {
  const group = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: 0xffd166 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a06b });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2a2f3a });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.85, 0.3), pants);
  legs.position.y = 0.42;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.78, 0.36), jacket);
  torso.position.y = 1.22;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), skin);
  head.position.y = 1.86;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), new THREE.MeshLambertMaterial({ color: 0x1f3a5f }));
  cap.position.y = 2.08;
  const armGeo = new THREE.BoxGeometry(0.14, 0.66, 0.14);
  const armL = new THREE.Mesh(armGeo, jacket);
  armL.position.set(-0.39, 1.2, 0);
  const armR = new THREE.Mesh(armGeo, jacket);
  armR.position.set(0.39, 1.2, 0);
  group.add(legs, torso, head, cap, armL, armR);
  group.position.set(x, 0, z);
  scene.add(group);
  return {
    mesh: group,
    pos: group.position,
    heading: 0,
    mode: 'foot',
    car: null,
    speed: 0,
    walkSpeed: 5.2,
    sprintSpeed: 9.5,
    health: 100,
    carHealth: 100,
    walkPhase: 0,
    nearMissCooldown: 0,
    airtime: 0,
    lastGroundedY: 0,
    bustedTimer: 0,
    interactCooldown: 0,
    armL,
    armR,
    legs,
  };
}

export function updatePlayer(G, dt) {
  const player = G.player;
  player.interactCooldown = Math.max(0, player.interactCooldown - dt);
  player.nearMissCooldown = Math.max(0, player.nearMissCooldown - dt);
  if (player.mode === 'car' && player.car) {
    const input = readDriveInput(G);
    const result = driveCar(G, player.car, input, dt);
    player.pos.copy(player.car.pos);
    player.heading = player.car.heading;
    player.speed = player.car.speed;
    player.mesh.visible = false;
    player.mesh.position.copy(player.car.pos);
    checkCarCollisions(G, dt);
    checkNearMiss(G, dt);
    checkStuntJump(G, dt, result.speedRatio);
    if (player.lastDamageAt !== undefined && G.time - player.lastDamageAt > 3 && player.carHealth > 0) {
      player.carHealth = Math.min(100, player.carHealth + 8 * dt);
    }
    G.audio && import('./audio.js').then((a) => {
      a.setEngineSound(G.audio, result.speedRatio, true);
      a.updateRadio(G.audio, dt, true);
    });
    if (player.carHealth <= 0) {
      wreckPlayer(G, 'wrecked');
    }
  } else {
    updateOnFoot(G, dt);
    G.audio && import('./audio.js').then((a) => a.setEngineSound(G.audio, 0, false));
  }
  checkBusted(G, dt);
}

function readDriveInput(G) {
  const keys = G.keys;
  return {
    forward: keys['KeyW'] || keys['ArrowUp'],
    back: keys['KeyS'] || keys['ArrowDown'],
    left: keys['KeyA'] || keys['ArrowLeft'],
    right: keys['KeyD'] || keys['ArrowRight'],
    handbrake: keys['Space'],
  };
}

function updateOnFoot(G, dt) {
  const player = G.player;
  const keys = G.keys;
  let mx = 0;
  let mz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) mz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) mz -= 1;
  if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
  const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
  const speed = sprint ? player.sprintSpeed : player.walkSpeed;
  const moving = mx !== 0 || mz !== 0;
  if (moving) {
    const len = Math.hypot(mx, mz);
    mx /= len;
    mz /= len;
    const camHeading = G.cameraHeading || 0;
    const wx = mx * Math.cos(camHeading) - mz * Math.sin(camHeading);
    const wz = mx * Math.sin(camHeading) + mz * Math.cos(camHeading);
    player.heading = Math.atan2(wx, wz);
    const nx = player.pos.x + wx * speed * dt;
    const nz = player.pos.z + wz * speed * dt;
    const oldX = player.pos.x;
    const oldZ = player.pos.z;
    player.pos.x = nx;
    player.pos.z = nz;
    const hit = resolveCircleCollision(G.city, player.pos, 0.55);
    if (hit && hit.kind === 'prop') {
      G.effects && import('./effects.js').then((fx) => fx.spawnBurst(G.effects, new THREE.Vector3(hit.prop.x, 1, hit.prop.z), 0xd96c2c, 8, 4, 3, 10));
    } else if (hit && hit.kind !== 'prop' && hit.nx !== undefined) {
      player.pos.x = oldX;
      player.pos.z = oldZ;
    } else if (hit && hit.kind === 'water') {
      player.pos.x = oldX;
      player.pos.z = oldZ;
    }
    player.walkPhase += dt * (sprint ? 13 : 9);
    player.mesh.rotation.y = player.heading;
    const swing = Math.sin(player.walkPhase) * 0.7;
    player.armL.rotation.x = swing;
    player.armR.rotation.x = -swing;
    player.legs.rotation.x = swing * 0.5;
  } else {
    player.armL.rotation.x *= 0.8;
    player.armR.rotation.x *= 0.8;
    player.legs.rotation.x *= 0.8;
  }
  if (player.interactCooldown <= 0 && (keys['KeyE'] || keys['KeyF'])) {
    player.interactCooldown = 0.5;
    tryEnterNearestCar(G);
  }
}

export function tryEnterNearestCar(G) {
  const player = G.player;
  if (player.mode !== 'foot') return false;
  const car = nearestCar(G, player.pos.x, player.pos.z, 5.5, true);
  if (!car) {
    G.showPopup && G.showPopup('No car close enough.', 'info');
    return false;
  }
  enterCar(G, car);
  return true;
}

export function enterCar(G, car) {
  const player = G.player;
  player.mode = 'car';
  player.car = car;
  player.carHealth = 100;
  car.driver = player;
  car.parked = false;
  car.traffic = false;
  car.ai = null;
  player.mesh.visible = false;
  G.save.carsStolen += car.parked === false && car.wasStolen ? 0 : 0;
  if (car.stealable !== false && !car.owned) {
    car.wasStolen = true;
    G.save.carsStolen += 1;
    const copNear = G.police.some((cop) => Math.hypot(cop.pos.x - player.pos.x, cop.pos.z - player.pos.z) < 45);
    if (copNear) {
      wantedForCrime(G, 1, 'car theft witnessed by police');
    } else {
      G.showPopup && G.showPopup('You took the ' + car.name + '.', 'info');
    }
    import('./audio.js').then((a) => a.playHorn(G.audio));
  }
  G.hudFlash && G.hudFlash(car.name);
}

export function exitCar(G) {
  const player = G.player;
  if (player.mode !== 'car' || !player.car) return false;
  const car = player.car;
  const sideX = Math.cos(car.heading);
  const sideZ = -Math.sin(car.heading);
  player.pos.set(car.pos.x + sideX * 2.4, 0, car.pos.z + sideZ * 2.4);
  player.mesh.position.copy(player.pos);
  player.mesh.visible = true;
  player.mesh.rotation.y = car.heading;
  player.mode = 'foot';
  player.car = null;
  car.driver = null;
  G.audio && import('./audio.js').then((a) => a.setEngineSound(G.audio, 0, false));
  return true;
}

function checkCarCollisions(G, dt) {
  const player = G.player;
  const car = player.car;
  if (!car) return;
  for (const other of G.cars) {
    if (other === car || other.police) continue;
    const hit = carsCollide(car, other);
    if (!hit) continue;
    const impact = Math.abs(car.speed - other.speed);
    car.pos.x -= hit.nx * hit.push;
    car.pos.z -= hit.nz * hit.push;
    other.pos.x += hit.nx * hit.push;
    other.pos.z += hit.nz * hit.push;
    if (impact > 6) {
      car.speed *= 0.45;
      other.speed = car.speed * 0.4;
      damageCar(G, impact * 0.8, 'traffic');
      if (other.traffic && Math.random() < 0.5) {
        other.ai = null;
        other.traffic = false;
      }
    } else {
      car.speed *= 0.8;
      other.speed *= 0.8;
    }
  }
  for (const ped of G.peds) {
    if (ped.knocked > 0) continue;
    const d = Math.hypot(ped.pos.x - car.pos.x, ped.pos.z - car.pos.z);
    if (d < 2.2 && Math.abs(car.speed) > 4) {
      knockPedestrian(G, ped, car.pos);
      damageCar(G, 4, 'pedestrian');
      wantedForCrime(G, 1, 'hit a pedestrian');
      G.effects && import('./effects.js').then((fx) => fx.spawnBurst(G.effects, new THREE.Vector3(ped.pos.x, 1, ped.pos.z), 0xff8fa3, 10, 4, 3, 9));
    }
  }
  for (const cop of G.police) {
    const hit = carsCollide(car, cop);
    if (!hit) continue;
    const impact = Math.abs(car.speed - cop.speed);
    car.pos.x -= hit.nx * hit.push;
    car.pos.z -= hit.nz * hit.push;
    cop.pos.x += hit.nx * hit.push;
    cop.pos.z += hit.nz * hit.push;
    if (impact > 5) {
      car.speed *= 0.5;
      cop.speed *= 0.6;
      damageCar(G, impact * 0.9, 'police');
      if (G.wanted < 3) wantedForCrime(G, 1, 'rammed a police car');
    } else {
      car.speed *= 0.85;
      cop.speed *= 0.85;
    }
  }
}

function damageCar(G, amount, cause) {
  const player = G.player;
  if (player.lastDamageAt !== undefined && G.time - player.lastDamageAt < 0.5) return;
  const armor = armorMultiplier(G.save);
  const real = amount / armor;
  player.carHealth = Math.max(0, player.carHealth - real);
  player.lastDamageAt = G.time;
  G.effects && import('./effects.js').then((fx) => {
    fx.addShake(G.effects, Math.min(0.5, real * 0.02));
    fx.spawnSparks(G.effects, new THREE.Vector3(player.pos.x, 1, player.pos.z), 10);
  });
  import('./audio.js').then((a) => a.playCrash(G.audio, Math.min(1, real / 20)));
  if (player.carHealth < 35 && Math.random() < 0.3) {
    G.effects && import('./effects.js').then((fx) => fx.spawnSmoke(G.effects, new THREE.Vector3(player.pos.x, 1.4, player.pos.z), 5));
  }
}

export function checkNearMiss(G, dt) {
  const player = G.player;
  const car = player.car;
  if (!car || player.nearMissCooldown > 0) return;
  if (Math.abs(car.speed) < 20) return;
  for (const other of G.cars) {
    if (other === car) continue;
    const d = Math.hypot(other.pos.x - car.pos.x, other.pos.z - car.pos.z);
    if (d < 4.5 && d > 2.6) {
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const relX = other.pos.x - car.pos.x;
      const relZ = other.pos.z - car.pos.z;
      const lateral = Math.abs(relX * fz - relZ * fx);
      if (lateral > 1.8) {
        player.nearMissCooldown = 2;
        G.save.nearMisses += 1;
        G.save.cash += 25;
        G.effects && import('./effects.js').then((fx2) => fx2.showPopup(G.effects, 'NEAR MISS +$25', 'good'));
        import('./audio.js').then((a) => a.blip(G.audio, 990, 0.12, 'sine', 0.1));
        return;
      }
    }
  }
}

export function checkStuntJump(G, dt, speedRatio) {
  const player = G.player;
  const car = player.car;
  if (!car) return;
  const airborne = car.pos.y > 0.4;
  if (airborne) {
    player.airtime += dt;
  } else if (player.airtime > 0.5) {
    const bonus = Math.round(player.airtime * 60);
    G.save.cash += bonus;
    G.save.stuntAirtime += player.airtime;
    G.effects && import('./effects.js').then((fx) => fx.showPopup(G.effects, 'AIRTIME ' + player.airtime.toFixed(1) + 's +$' + bonus, 'good'));
    player.airtime = 0;
  } else {
    player.airtime = 0;
  }
}

export function onCrash(G, speed, kind) {
  const player = G.player;
  if (player.mode === 'car' && player.car) {
    damageCar(G, speed * 0.25, kind);
  } else {
    player.health -= speed * 0.4;
    if (player.health <= 0) {
      player.health = 100;
      G.finishGame && G.finishGame(false, 'wrecked');
    }
  }
}

export function onPoliceRam(G, cop, dist) {
  const player = G.player;
  if (player.mode === 'car' && player.car) {
    damageCar(G, 5, 'ram');
    const dx = player.pos.x - cop.pos.x;
    const dz = player.pos.z - cop.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    player.car.pos.x += (dx / len) * 1.1;
    player.car.pos.z += (dz / len) * 1.1;
    player.car.speed *= 0.7;
  } else {
    player.bustedTimer += 1;
  }
}

function checkBusted(G, dt) {
  const player = G.player;
  if (G.state !== 'playing') return;
  if (G.wanted <= 0) { player.bustedTimer = 0; return; }
  if (player.mode === 'foot') {
    for (const cop of G.police) {
      if (cop.state !== 'pursue') continue;
      if (Math.hypot(cop.pos.x - player.pos.x, cop.pos.z - player.pos.z) < 3.2) {
        player.bustedTimer += dt;
        if (player.bustedTimer > 1.6) {
          G.save.stats.busts += 1;
          G.finishGame && G.finishGame(false, 'busted');
          return;
        }
      }
    }
    if (player.bustedTimer > 0) player.bustedTimer = Math.max(0, player.bustedTimer - dt * 0.5);
  } else if (player.car && Math.abs(player.car.speed) < 6) {
    let surrounded = 0;
    for (const cop of G.police) {
      if (cop.state === 'pursue' && Math.hypot(cop.pos.x - player.pos.x, cop.pos.z - player.pos.z) < 7) surrounded++;
    }
    if (surrounded >= 2 && G.wanted >= 2) {
      player.bustedTimer += dt;
      if (player.bustedTimer > 3) {
        G.save.stats.busts += 1;
        G.finishGame && G.finishGame(false, 'busted');
      }
    } else {
      player.bustedTimer = Math.max(0, player.bustedTimer - dt);
    }
  }
}

export function wreckPlayer(G, reason) {
  const player = G.player;
  if (player.mode === 'car' && player.car) {
    G.effects && import('./effects.js').then((fx) => {
      fx.spawnBurst(G.effects, new THREE.Vector3(player.pos.x, 1, player.pos.z), 0xff6b35, 30, 8, 5, 10);
      fx.addShake(G.effects, 1);
    });
    import('./audio.js').then((a) => a.playCrash(G.audio, 1));
  }
  G.save.stats.wrecks += 1;
  G.finishGame && G.finishGame(false, 'wrecked');
}

export function payOffHeat(G) {
  const cost = G.wanted * 300;
  if (G.wanted <= 0) return false;
  if (G.save.cash < cost) return false;
  G.save.cash -= cost;
  clearWanted(G, 'Heat paid off at the safehouse — $' + cost);
  return true;
}
