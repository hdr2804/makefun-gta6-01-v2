// effects.js — particles, skid marks, dust, screen shake and floating
// score popups for SOLMAR: Sunset Getaway. All effects are pooled and
// recycled so a long chase never allocates new geometry per frame.

import * as THREE from 'three';

export function createEffects(scene) {
  const effects = {
    scene,
    particles: [],
    skids: [],
    popups: [],
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    dustTimer: 0,
  };
  const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  for (let i = 0; i < 220; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    effects.particles.push({ mesh, life: 0, maxLife: 1, vel: new THREE.Vector3(), gravity: 0, size: 1 });
  }
  return effects;
}

export function spawnBurst(effects, pos, color, count, speed, up, gravity) {
  let spawned = 0;
  for (const p of effects.particles) {
    if (spawned >= count) break;
    if (p.life > 0) continue;
    p.life = p.maxLife = 0.45 + Math.random() * 0.5;
    p.mesh.visible = true;
    p.mesh.position.copy(pos);
    p.mesh.material.color.setHex(color);
    p.mesh.material.opacity = 0.95;
    const angle = Math.random() * Math.PI * 2;
    const spread = (Math.random() - 0.5) * speed;
    p.vel.set(Math.cos(angle) * speed + spread, up + Math.random() * speed * 0.6, Math.sin(angle) * speed + spread);
    p.gravity = gravity === undefined ? 9 : gravity;
    p.size = 0.6 + Math.random() * 1.4;
    p.mesh.scale.setScalar(p.size);
    spawned++;
  }
}

export function spawnSparks(effects, pos, count) {
  spawnBurst(effects, pos, 0xffc861, count || 14, 7, 3, 14);
}

export function spawnDust(effects, pos, count) {
  spawnBurst(effects, pos, 0xcbb28a, count || 6, 1.6, 0.8, -0.4);
}

export function spawnSmoke(effects, pos, count) {
  spawnBurst(effects, pos, 0x555555, count || 8, 1.2, 2.2, -1.2);
}

export function spawnConfetti(effects, pos) {
  const colors = [0xffd166, 0xef476f, 0x06d6a0, 0x118ab2, 0xff8fa3];
  let spawned = 0;
  for (const p of effects.particles) {
    if (spawned >= 40) break;
    if (p.life > 0) continue;
    p.life = p.maxLife = 1.1 + Math.random() * 0.8;
    p.mesh.visible = true;
    p.mesh.position.copy(pos);
    p.mesh.position.x += (Math.random() - 0.5) * 4;
    p.mesh.position.z += (Math.random() - 0.5) * 4;
    p.mesh.material.color.setHex(colors[spawned % colors.length]);
    p.mesh.material.opacity = 1;
    p.vel.set((Math.random() - 0.5) * 6, 5 + Math.random() * 5, (Math.random() - 0.5) * 6);
    p.gravity = 7;
    p.size = 0.5 + Math.random() * 0.7;
    p.mesh.scale.setScalar(p.size);
    spawned++;
  }
}

export function addSkid(effects, x, z, heading) {
  const geo = new THREE.PlaneGeometry(0.55, 2.4);
  const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.55 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -heading;
  mesh.position.set(x, 0.06, z);
  effects.scene.add(mesh);
  effects.skids.push({ mesh, life: 9 });
  if (effects.skids.length > 90) {
    const old = effects.skids.shift();
    effects.scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
}

export function addShake(effects, amount) {
  effects.shake = Math.min(1.2, effects.shake + amount);
}

export function showPopup(effects, text, kind) {
  const el = document.createElement('div');
  el.className = 'popup ' + (kind || 'info');
  el.textContent = text;
  const layer = document.getElementById('popups');
  if (!layer) return;
  layer.appendChild(el);
  const life = { el, t: 0 };
  effects.popups.push(life);
  setTimeout(() => { el.classList.add('fade'); }, 1400);
  setTimeout(() => { el.remove(); }, 1900);
}

export function updateEffects(effects, dt, speedRatio) {
  for (const p of effects.particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.mesh.visible = false; p.mesh.material.opacity = 0; continue; }
    p.vel.y -= p.gravity * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.y < 0.05) { p.mesh.position.y = 0.05; p.vel.y = Math.abs(p.vel.y) * 0.3; }
    p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
    p.mesh.rotation.x += dt * 4;
    p.mesh.rotation.y += dt * 5;
  }
  for (let i = effects.skids.length - 1; i >= 0; i--) {
    const skid = effects.skids[i];
    skid.life -= dt;
    if (skid.life <= 0) {
      effects.scene.remove(skid.mesh);
      skid.mesh.geometry.dispose();
      skid.mesh.material.dispose();
      effects.skids.splice(i, 1);
    } else if (skid.life < 2) {
      skid.mesh.material.opacity = 0.55 * (skid.life / 2);
    }
  }
  if (effects.shake > 0) {
    effects.shake = Math.max(0, effects.shake - dt * 1.8);
    const s = effects.shake * effects.shake * 0.9;
    effects.shakeX = (Math.random() - 0.5) * s;
    effects.shakeY = (Math.random() - 0.5) * s;
  } else {
    effects.shakeX = 0;
    effects.shakeY = 0;
  }
  effects.dustTimer -= dt;
  if (speedRatio > 0.55 && effects.dustTimer <= 0) {
    effects.dustTimer = 0.12;
  }
}
