// city.js — Solmar, the sun-soaked coastal city of SOLMAR: Sunset Getaway.
// A seeded 9x9 block grid: roads, sidewalks, towers, shops, palms, lamps,
// destructible props, a beach and a marina on the east edge, and the
// safehouse garage. The layout is deterministic from one seed so every
// ?shot= scene composes the same way.

import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CITY = {
  blocks: 9,
  blockSize: 62,
  roadWidth: 15,
  half: 0,
};

CITY.half = (CITY.blocks * (CITY.blockSize + CITY.roadWidth)) / 2;

export function blockCenter(bx, bz) {
  const pitch = CITY.blockSize + CITY.roadWidth;
  return {
    x: -CITY.half + CITY.roadWidth / 2 + bx * pitch + CITY.blockSize / 2,
    z: -CITY.half + CITY.roadWidth / 2 + bz * pitch + CITY.blockSize / 2,
  };
}

export function roadCoord(index) {
  const pitch = CITY.blockSize + CITY.roadWidth;
  return -CITY.half + index * pitch + CITY.roadWidth / 2;
}

export function nearestRoadCoord(value) {
  let best = roadCoord(0);
  let bestDist = Infinity;
  for (let i = 0; i <= CITY.blocks; i++) {
    const c = roadCoord(i);
    const d = Math.abs(c - value);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

export function makeGroundTexture(rng) {
  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const world = CITY.half * 2;
  const toPx = (v) => ((v + CITY.half) / world) * size;
  ctx.fillStyle = '#c9a06a';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#3f6d8e';
  ctx.fillRect(toPx(CITY.half - 40), 0, size - toPx(CITY.half - 40), size);
  ctx.fillStyle = '#e8cf9e';
  ctx.fillRect(toPx(CITY.half - 52), 0, toPx(CITY.half - 40) - toPx(CITY.half - 52), size);
  ctx.fillStyle = '#8d8d84';
  ctx.fillRect(0, 0, toPx(CITY.half - 40), size);
  ctx.fillStyle = '#a9a49b';
  for (let bx = 0; bx < CITY.blocks; bx++) {
    for (let bz = 0; bz < CITY.blocks; bz++) {
      const c = blockCenter(bx, bz);
      ctx.fillRect(toPx(c.x - CITY.blockSize / 2), toPx(c.z - CITY.blockSize / 2), toPx(CITY.blockSize) - toPx(0), toPx(CITY.blockSize) - toPx(0));
    }
  }
  ctx.fillStyle = '#3a3a3d';
  for (let i = 0; i <= CITY.blocks; i++) {
    const c = roadCoord(i);
    ctx.fillRect(0, toPx(c - CITY.roadWidth / 2), toPx(CITY.half - 40), CITY.roadWidth / world * size);
    ctx.fillRect(toPx(c - CITY.roadWidth / 2), 0, CITY.roadWidth / world * size, size);
  }
  ctx.strokeStyle = '#f5d76e';
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 22]);
  for (let i = 0; i <= CITY.blocks; i++) {
    const c = roadCoord(i);
    ctx.beginPath(); ctx.moveTo(0, toPx(c)); ctx.lineTo(toPx(CITY.half - 40), toPx(c)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(toPx(c), 0); ctx.lineTo(toPx(c), size); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  for (let i = 0; i <= CITY.blocks; i++) {
    const c = roadCoord(i);
    ctx.beginPath(); ctx.moveTo(0, toPx(c - CITY.roadWidth / 2 + 1.5)); ctx.lineTo(toPx(CITY.half - 40), toPx(c - CITY.roadWidth / 2 + 1.5)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, toPx(c + CITY.roadWidth / 2 - 1.5)); ctx.lineTo(toPx(CITY.half - 40), toPx(c + CITY.roadWidth / 2 - 1.5)); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const PALETTE = [0xe8b48a, 0xf2d1a0, 0xd9a06b, 0xefc9c0, 0xcfe0e8, 0xf6e3c5, 0xe0a899, 0xbfd9c9];
const TOWER_COLORS = [0x9fb8c8, 0xd8c1a5, 0xb8c4d0, 0xe6c9a8, 0xa8b8c8];

export function buildCity(scene, seed) {
  const rng = mulberry32(seed);
  const city = {
    seed,
    rng,
    colliders: [],
    buildings: [],
    props: [],
    lamps: [],
    palms: [],
    roadPoints: [],
    intersections: [],
    safehouse: null,
    marina: null,
    beachX: CITY.half - 46,
    spawnPoints: [],
  };
  const groundTex = makeGroundTexture(rng);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.half * 2 + 120, CITY.half * 2 + 120),
    new THREE.MeshLambertMaterial({ map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(20, 0, 0);
  ground.receiveShadow = true;
  scene.add(ground);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(130, CITY.half * 2 + 140),
    new THREE.MeshLambertMaterial({ color: 0x2e7f9e })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(CITY.half + 42, -0.4, 0);
  scene.add(water);
  const pier = new THREE.Mesh(
    new THREE.BoxGeometry(46, 1.2, 14),
    new THREE.MeshLambertMaterial({ color: 0x8a6f4d })
  );
  pier.position.set(CITY.half + 18, 0.6, 40);
  pier.castShadow = true;
  scene.add(pier);
  city.marina = { x: CITY.half + 18, z: 40, boatX: CITY.half + 34, boatZ: 40 };
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, 3.4), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
  hull.position.y = 1.1;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.8, 2.6), new THREE.MeshLambertMaterial({ color: 0x118ab2 }));
  cabin.position.set(-0.5, 3, 0);
  boat.add(hull, cabin);
  boat.position.set(city.marina.boatX, 0.2, city.marina.boatZ);
  scene.add(boat);
  city.marina.boat = boat;

  for (let i = 0; i <= CITY.blocks; i++) {
    for (let j = 0; j <= CITY.blocks; j++) {
      city.intersections.push({ x: roadCoord(i), z: roadCoord(j) });
    }
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let bx = 0; bx < CITY.blocks; bx++) {
    for (let bz = 0; bz < CITY.blocks; bz++) {
      const c = blockCenter(bx, bz);
      const isDowntown = bx >= 3 && bx <= 5 && bz >= 3 && bz <= 5;
      const isBeachRow = bx === CITY.blocks - 1;
      const tower = isDowntown && rng() < 0.55;
      const count = tower ? 1 : 2 + Math.floor(rng() * 3);
      for (let k = 0; k < count; k++) {
        const w = tower ? 26 + rng() * 8 : 10 + rng() * 12;
        const d = tower ? 26 + rng() * 8 : 10 + rng() * 12;
        const h = tower ? 55 + rng() * 70 : isBeachRow ? 8 + rng() * 8 : 9 + rng() * 16;
        const ox = (rng() - 0.5) * (CITY.blockSize - w - 8);
        const oz = (rng() - 0.5) * (CITY.blockSize - d - 8);
        const x = c.x + ox;
        const z = c.z + oz;
        const color = tower ? TOWER_COLORS[Math.floor(rng() * TOWER_COLORS.length)] : PALETTE[Math.floor(rng() * PALETTE.length)];
        const mat = new THREE.MeshLambertMaterial({ color });
        const mesh = new THREE.Mesh(boxGeo, mat);
        mesh.scale.set(w, h, d);
        mesh.position.set(x, h / 2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        const roof = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x5a5148 }));
        roof.scale.set(w * 0.4, 1.2, d * 0.4);
        roof.position.set(x, h + 0.6, z);
        scene.add(roof);
        const winMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
        const winGeo = new THREE.BoxGeometry(0.3, 1.6, 2.2);
        const floors = Math.min(8, Math.floor(h / 7));
        for (let f = 0; f < floors; f++) {
          if (rng() < 0.45) continue;
          const win = new THREE.Mesh(winGeo, winMat);
          win.position.set(x + w / 2 + 0.15, 4 + f * 6.5, z + (rng() - 0.5) * (d - 4));
          scene.add(win);
        }
        city.buildings.push(mesh);
        city.colliders.push({ x: x - w / 2, z: z - d / 2, w, d, kind: 'building' });
      }
    }
  }

  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 7, 6);
  const frondGeo = new THREE.ConeGeometry(2.6, 3.2, 6);
  for (let i = 0; i < 90; i++) {
    const bx = Math.floor(rng() * CITY.blocks);
    const bz = Math.floor(rng() * CITY.blocks);
    const c = blockCenter(bx, bz);
    const edge = Math.floor(rng() * 4);
    let x = c.x, z = c.z;
    if (edge === 0) { x = c.x + (rng() - 0.5) * (CITY.blockSize - 6); z = c.z - CITY.blockSize / 2 + 2; }
    if (edge === 1) { x = c.x + (rng() - 0.5) * (CITY.blockSize - 6); z = c.z + CITY.blockSize / 2 - 2; }
    if (edge === 2) { x = c.x - CITY.blockSize / 2 + 2; z = c.z + (rng() - 0.5) * (CITY.blockSize - 6); }
    if (edge === 3) { x = c.x + CITY.blockSize / 2 - 2; z = c.z + (rng() - 0.5) * (CITY.blockSize - 6); }
    const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x7a5a38 }));
    trunk.position.set(x, 3.5, z);
    trunk.castShadow = true;
    const fronds = new THREE.Mesh(frondGeo, new THREE.MeshLambertMaterial({ color: 0x2f8f4e }));
    fronds.position.set(x, 8.2, z);
    scene.add(trunk, fronds);
    city.palms.push({ x, z });
  }

  const poleGeo = new THREE.CylinderGeometry(0.14, 0.14, 7.5, 6);
  const lampGeo = new THREE.SphereGeometry(0.55, 8, 6);
  for (const inter of city.intersections) {
    if (rng() < 0.35) continue;
    const pole = new THREE.Mesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x333333 }));
    pole.position.set(inter.x + 8.5, 3.75, inter.z + 8.5);
    const bulb = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    bulb.position.set(inter.x + 8.5, 7.6, inter.z + 8.5);
    scene.add(pole, bulb);
    city.lamps.push({ x: inter.x + 8.5, z: inter.z + 8.5 });
  }

  const propColors = [0xd96c2c, 0x3f7fbf, 0xe8b13c];
  for (let i = 0; i < 46; i++) {
    const inter = city.intersections[Math.floor(rng() * city.intersections.length)];
    const x = inter.x + (rng() - 0.5) * 10;
    const z = inter.z + (rng() - 0.5) * 10;
    const size = 1.4 + rng() * 1.4;
    const prop = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: propColors[i % 3] }));
    prop.scale.set(size, size, size);
    prop.position.set(x, size / 2, z);
    prop.rotation.y = rng() * Math.PI;
    prop.castShadow = true;
    prop.userData.destructible = true;
    scene.add(prop);
    city.props.push({ mesh: prop, x, z, r: size * 0.8, alive: true });
    city.colliders.push({ x: x - size / 2, z: z - size / 2, w: size, d: size, kind: 'prop', prop: city.props[city.props.length - 1] });
  }

  const sh = blockCenter(1, 7);
  const house = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xf2d1a0 }));
  house.scale.set(16, 7, 12);
  house.position.set(sh.x, 3.5, sh.z);
  house.castShadow = true;
  scene.add(house);
  const garageDoor = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x5a6b7a }));
  garageDoor.scale.set(9, 4.5, 0.4);
  garageDoor.position.set(sh.x, 2.25, sh.z + 6.1);
  scene.add(garageDoor);
  const sign = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xff8fa3 }));
  sign.scale.set(10, 1.6, 0.5);
  sign.position.set(sh.x, 8.2, sh.z + 6.1);
  scene.add(sign);
  city.safehouse = { x: sh.x, z: sh.z, doorX: sh.x, doorZ: sh.z + 9 };
  city.colliders.push({ x: sh.x - 8, z: sh.z - 6, w: 16, d: 12, kind: 'building' });

  // Beach life: umbrellas and loungers along the sand strip.
  const umbrellaColors = [0xff6b6b, 0xffd166, 0x118ab2, 0xef476f];
  for (let i = 0; i < 14; i++) {
    const z = -CITY.half + 20 + i * 52 + rng() * 20;
    const x = CITY.half - 47 + rng() * 4;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3, 6), new THREE.MeshLambertMaterial({ color: 0x8a6f4d }));
    pole.position.set(x, 1.5, z);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.1, 8), new THREE.MeshLambertMaterial({ color: umbrellaColors[i % 4] }));
    top.position.set(x, 3.4, z);
    const lounger = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    lounger.scale.set(1.8, 0.35, 0.8);
    lounger.position.set(x + 2.6, 0.5, z);
    scene.add(pole, top, lounger);
  }

  // Billboards over the avenues: canvas-painted ads for invented Solmar brands.
  const billboardAds = [
    { bg: '#ff8c42', fg: '#1a1210', text: 'SOLMAR SUNSET COLA' },
    { bg: '#118ab2', fg: '#ffffff', text: 'MARINA BOAT TOURS' },
    { bg: '#ef476f', fg: '#ffffff', text: 'PALMA SURF SCHOOL' },
    { bg: '#ffd166', fg: '#1a1210', text: 'TACO LUPE — OPEN LATE' },
  ];
  for (let i = 0; i < billboardAds.length; i++) {
    const ad = billboardAds[i];
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = ad.bg;
    ctx.fillRect(0, 0, 512, 160);
    ctx.fillStyle = ad.fg;
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ad.text, 256, 80, 480);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(22, 7), new THREE.MeshBasicMaterial({ map: tex }));
    const inter = city.intersections[3 + i * 17];
    board.position.set(inter.x - 12, 16, inter.z - 12);
    board.rotation.y = Math.PI / 4;
    scene.add(board);
    const postA = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 13, 6), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    postA.position.set(inter.x - 18, 6.5, inter.z - 18);
    const postB = postA.clone();
    postB.position.set(inter.x - 6, 6.5, inter.z - 6);
    scene.add(postA, postB);
  }

  for (let i = 0; i < CITY.blocks; i++) {
    city.spawnPoints.push({ x: roadCoord(i), z: roadCoord(4), heading: Math.PI / 2 });
    city.spawnPoints.push({ x: roadCoord(4), z: roadCoord(i), heading: 0 });
  }
  return city;
}

export function pointHitsCollider(city, x, z, radius) {
  for (const c of city.colliders) {
    if (c.kind === 'prop' && c.prop && !c.prop.alive) continue;
    if (x + radius > c.x && x - radius < c.x + c.w && z + radius > c.z && z - radius < c.z + c.d) return c;
  }
  if (x > CITY.half - 44) return { kind: 'water', x: CITY.half - 44, z: -CITY.half, w: 44, d: CITY.half * 2 };
  if (Math.abs(x) > CITY.half + 6 || Math.abs(z) > CITY.half + 6) return { kind: 'bounds', x: -CITY.half - 6, z: -CITY.half - 6, w: CITY.half * 2 + 12, d: CITY.half * 2 + 12 };
  return null;
}

export function resolveCircleCollision(city, pos, radius) {
  const hit = pointHitsCollider(city, pos.x, pos.z, radius);
  if (!hit) return null;
  if (hit.kind === 'prop' && hit.prop && hit.prop.alive) {
    hit.prop.alive = false;
    hit.prop.mesh.visible = false;
    return { kind: 'prop', prop: hit.prop };
  }
  const cx = Math.max(hit.x, Math.min(pos.x, hit.x + hit.w));
  const cz = Math.max(hit.z, Math.min(pos.z, hit.z + hit.d));
  let dx = pos.x - cx;
  let dz = pos.z - cz;
  let dist = Math.hypot(dx, dz);
  if (dist < 0.001) { dx = 1; dz = 0; dist = 1; }
  const push = radius - dist;
  if (push > 0) {
    pos.x += (dx / dist) * push;
    pos.z += (dz / dist) * push;
  }
  return { kind: hit.kind, nx: dx / dist, nz: dz / dist };
}

export function randomRoadPoint(city, rng) {
  const inter = city.intersections[Math.floor(rng() * city.intersections.length)];
  return { x: inter.x + (rng() - 0.5) * 8, z: inter.z + (rng() - 0.5) * 8 };
}
