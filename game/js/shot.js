// shot.js — deterministic ?shot=N scene presets for the screenshots.
// Each preset composes one readable frame of the game with its own code:
// title over the golden-hour city, a mid-chase drive, an on-foot mission
// moment, and the results screen. Nothing here edits the game; it only
// sets state the game itself then renders.
import { MISSIONS } from './missions.js';

export function shotParam() {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.get('shot');
  } catch (err) {
    return null;
  }
}

export function hasShotParam() {
  return shotParam() !== null;
}

// Called once at boot (after the world exists) when ?shot= is present.
export function applyShotPreset(ctx) {
  const shot = shotParam();
  const { state, player, traffic, peds, police, missions, hud, city, starterCar, audio, chaseCam } = ctx;
  state.resetRun();
  audio.ensure && audio.ensure();

  if (shot === '1') {
    // Title screen over the city at golden hour. The HUD stays hidden and
    // the title DOM is shown; the camera orbits the city behind it.
    state.phase = 'title';
    hud.showTitle(false);
    hud.showHud(false);
    chaseCam.snap = true;
    return;
  }

  // Shots 2–4 are in-game frames: HUD on, title off.
  state.phase = 'playing';
  hud.hideTitle();
  hud.showHud(true);

  if (shot === '2') {
    // Driving mid-chase: player in the sports car on the main avenue,
    // wanted 3, police in pursuit, mission m4's escape objective live.
    player.spawnAt(0, 40, 0);
    const car = ctx.parked2; // the Sunset GT
    car.teleport(0, 40, 0);
    car.speed = 24;
    player.enterCar(car, false);
    state.cash = 2140;
    state.stats.distanceDriven = 3840;
    state.stats.nearMisses = 6;
    state.stats.topSpeed = 38;
    state.setWanted(3);
    missions.start(3); // The Heist Getaway — escape step is live after pickup? No: start at step 0.
    // Fast-forward the mission to its escape step: pick up the crew first.
    missions.current.stepIndex = 2;
    missions.setupStep();
    hud.hideBriefing(); // the briefing card would cover the chase frame
    police.forcePursuit(3);
    hud.renderCash(state.cash);
    hud.renderWanted(3);
    hud.setObjective('Escape! Lose the police, then reach the garage');
    chaseCam.snap = true;
    return;
  }

  if (shot === '3') {
    // On foot at a pickup: the player walks toward the contact on Palm
    // Row while traffic rolls past and pedestrians cross the sidewalk.
    // Camera sits behind the player, looking at the marker (40, 80).
    player.spawnAt(32, 98, Math.atan2(40 - 32, 80 - 98));
    state.cash = 650;
    state.setWanted(0);
    missions.start(0);
    hud.hideBriefing(); // the briefing card would cover the on-foot frame
    // Park a couple of traffic cars right on the avenue for the frame.
    const t1 = traffic.cars[0];
    if (t1) { t1.vehicle.teleport(46, 78, Math.PI / 2); t1.vehicle.speed = 6; t1.dir = { x: 1, z: 0 }; }
    const t2 = traffic.cars[1];
    if (t2) { t2.vehicle.teleport(38, 86, -Math.PI / 2); t2.vehicle.speed = 5; t2.dir = { x: -1, z: 0 }; }
    // A small crowd on the corner, between the player and the marker.
    for (let i = 0; i < 5; i++) {
      peds.spawnPed(false, { at: { x: 36 + i * 2.5, z: 88 - (i % 3) * 3 } });
    }
    hud.renderCash(state.cash);
    hud.setObjective('Drive to the pickup on Palm Row');
    chaseCam.yaw = -0.36;
    chaseCam.snap = true;
    return;
  }

  if (shot === '4') {
    // Results screen after the final job: stats, payout and restart.
    state.cash = 8420;
    state.stats.distanceDriven = 18400;
    state.stats.topSpeed = 41;
    state.stats.nearMisses = 14;
    state.stats.airtime = 4.8;
    state.stats.carsStolen = 3;
    state.stats.payouts = 7850;
    state.stats.playSeconds = 742;
    state.missionsCompleted = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    state.missionIndex = 6;
    state.endRun('win', { subtitle: 'Marisol is on the boat. Solmar fades into the sunset behind you.' });
    hud.showHud(false);
    return;
  }
}

export { MISSIONS };
