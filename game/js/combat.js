// combat.js — close-quarters trouble in Solmar. On foot you can punch
// (J or click): it knocks a pedestrian down, shoves a cop, and raises heat
// when the police see it. Cops who are shoved fight back — stay on your
// feet and they will try to bust you. Ramming is the car's own weapon and
// lives in player.js; this module owns the on-foot fight.

import * as THREE from 'three';
import { knockPedestrian } from './pedestrians.js';
import { wantedForCrime } from './police.js';

export function createCombat(G) {
  return {
    punchCooldown: 0,
    punchAnim: 0,
    lastPunchAt: -10,
    punchesThrown: 0,
    punchesLanded: 0,
    retaliation: 0,
  };
}

export function queuePunch(G) {
  G.punchQueued = true;
}

export function updateCombat(G, dt) {
  const combat = G.combat;
  if (!combat) return;
  combat.punchCooldown = Math.max(0, combat.punchCooldown - dt);
  combat.punchAnim = Math.max(0, combat.punchAnim - dt * 3);
  combat.retaliation = Math.max(0, combat.retaliation - dt);
  const wantPunch = G.punchQueued || G.keys['KeyJ'];
  G.punchQueued = false;
  if (wantPunch && G.state === 'playing' && G.player.mode === 'foot' && combat.punchCooldown <= 0) {
    throwPunch(G);
  }
  if (combat.punchAnim > 0 && G.player.armR) {
    G.player.armR.rotation.x = -2.2 * combat.punchAnim;
  }
}

export function throwPunch(G) {
  const combat = G.combat;
  const player = G.player;
  combat.punchCooldown = 0.45;
  combat.punchAnim = 1;
  combat.punchesThrown += 1;
  combat.lastPunchAt = G.time;
  const reach = 2.4;
  const fx = Math.sin(player.heading);
  const fz = Math.cos(player.heading);
  let hitSomething = false;
  for (const ped of G.peds) {
    if (ped.knocked > 0 || ped.isMission) continue;
    const dx = ped.pos.x - player.pos.x;
    const dz = ped.pos.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > reach) continue;
    const along = dx * fx + dz * fz;
    if (along < 0) continue;
    hitSomething = true;
    combat.punchesLanded += 1;
    knockPedestrian(G, ped, player.pos);
    G.effects && import('./effects.js').then((fx2) => fx2.spawnBurst(G.effects, new THREE.Vector3(ped.pos.x, 1.2, ped.pos.z), 0xff8fa3, 8, 4, 3, 9));
    import('./audio.js').then((a) => a.playCrash(G.audio, 0.3));
    const copNear = G.police.some((cop) => Math.hypot(cop.pos.x - player.pos.x, cop.pos.z - player.pos.z) < 40);
    if (copNear) wantedForCrime(G, 1, 'assault witnessed by police');
    break;
  }
  if (!hitSomething) {
    for (const cop of G.police) {
      const dx = cop.pos.x - player.pos.x;
      const dz = cop.pos.z - player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + 0.6) continue;
      const along = dx * fx + dz * fz;
      if (along < 0) continue;
      hitSomething = true;
      combat.punchesLanded += 1;
      cop.heading += 0.6;
      cop.speed = 2;
      cop.state = 'pursue';
      cop.patrol = false;
      combat.retaliation = 3;
      wantedForCrime(G, 2, 'assaulted an officer');
      G.effects && import('./effects.js').then((fx2) => {
        fx2.spawnSparks(G.effects, new THREE.Vector3(cop.pos.x, 1.2, cop.pos.z), 12);
        fx2.addShake(G.effects, 0.3);
      });
      import('./audio.js').then((a) => a.playCrash(G.audio, 0.5));
      break;
    }
  }
  if (!hitSomething) {
    import('./audio.js').then((a) => a.blip(G.audio, 180, 0.08, 'sine', 0.05));
  }
}

export function copRetaliation(G, dt) {
  const combat = G.combat;
  if (!combat || combat.retaliation <= 0) return;
  if (G.player.mode !== 'foot') return;
  for (const cop of G.police) {
    if (cop.state !== 'pursue') continue;
    const d = Math.hypot(cop.pos.x - G.player.pos.x, cop.pos.z - G.player.pos.z);
    if (d < 4) {
      G.player.bustedTimer += dt * 1.5;
      G.showPopup && G.showPopup('The officer is grabbing you — run!', 'bad');
    }
  }
}

export function combatSummary(G) {
  const combat = G.combat;
  if (!combat) return '';
  return 'Punches ' + combat.punchesLanded + '/' + combat.punchesThrown + ' landed';
}
