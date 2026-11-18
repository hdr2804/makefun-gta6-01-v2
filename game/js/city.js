// city.js — Solmar, a sun-soaked coastal city at golden hour.
// A seeded grid: streets every 40 units, blocks of 1–4 buildings, a
// marina and beach at the south edge, a safehouse garage at the north.
// The layout is deterministic (seed 1337) so ?shot= scenes and the
// playtest always see the same streets. Buildings are box meshes with
// canvas-painted window textures; roads are flat planes with lane paint.
import * as THREE from 'three';
import { makeRng, clamp } from './utils.js';

export const CITY = {
  seed: 1337,
  half: 200, // city spans -200..200 on X and Z
  block: 40, // street pitch
  roadHalf: 5, // half-width of a street
};

const PALETTE = {
  asphalt: 0x2e2a33,
  sidewalk: 0x8a7f74,
  curb: 0x6e655c,
  sand: 0xd9b380,
  water: 0x1e6f8e,
  grass: 0x4d7a45,
};

function makeBuildingTexture(rng, base, litRatio) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 256);
  const cols = 4 + rng.int(0, 3);
  const rows = 8 + rng.int(0, 8);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wx = 10 + x * ((128 - 20) / cols);
      const wy = 12 + y * ((256 - 24) / rows);
      const ww = (128 - 20) / cols - 6;
      const wh = (256 - 24) / rows - 7;
      const lit = rng.next() < litRatio;
      g.fillStyle = lit ? '#ffd98a' : (rng.next() < 0.5 ? '#1d2733' : '#2b3a4a');
      g.fillRect(wx, wy, ww, wh);
      if (lit) {
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(wx, wy, ww, 2);
      }
    }
  }
  // Roof edge shadow and a darker ground floor.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, 128, 8);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(0, 232, 128, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRoadTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#2e2a33';
  g.fillRect(0, 0, 256, 256);
  // Asphalt speckle.
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // Centre dashed line (vertical) and edge lines.
  g.fillStyle = '#d8c25a';
  for (let y = 0; y < 256; y += 32) g.fillRect(126, y, 4, 18);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(6, 0, 3, 256);
  g.fillRect(247, 0, 3, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class City {
  constructor(scene) {
    this.scene = scene;
    this.rng = makeRng(CITY.seed);
    // Axis-aligned colliders: { minX, maxX, minZ, maxZ }.
    this.colliders = [];
    this.buildings = [];
    this.props = []; // destructible props: { mesh, pos, radius, alive }
    this.lamps = [];
    this.spawn = { x: 0, z: 120, heading: Math.PI }; // facing north into town
    this.safehouse = { x: -60, z: 140 };
    this.marina = { x: 140, z: -185 };
    this.intersections = [];
    this.build();
  }

  build() {
    const rng = this.rng;
    const scene = this.scene;
    const H = CITY.half;

    // Ground: big sand/grass base, then road planes on top.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2 + 160, H * 2 + 160),
      new THREE.MeshStandardMaterial({ color: 0x9a8a70, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // Beach + water at the south edge (negative Z is "south" here).
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2 + 160, 46),
      new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0.0, -H - 23);
    sand.receiveShadow = true;
    scene.add(sand);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2 + 160, 120),
      new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.15, metalness: 0.35 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.4, -H - 46 - 60);
    scene.add(water);
    this.water = water;

    // Streets: for every grid line, a long asphalt plane with dashes.
    const roadTex = makeRoadTexture();
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 });
    const pitch = CITY.block;
    const lines = [];
    for (let v = -H; v <= H; v += pitch) lines.push(v);
    for (const v of lines) {
      const ns = new THREE.Mesh(new THREE.PlaneGeometry(CITY.roadHalf * 2, H * 2), roadMat.clone());
      ns.material.map = roadTex.clone();
      ns.material.map.needsUpdate = true;
      ns.material.map.repeat.set(1, H / 10);
      ns.rotation.x = -Math.PI / 2;
      ns.position.set(v, 0.02, 0);
      ns.receiveShadow = true;
      scene.add(ns);
      const ew = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, CITY.roadHalf * 2), roadMat.clone());
      ew.material.map = roadTex.clone();
      ew.material.map.needsUpdate = true;
      ew.material.map.repeat.set(H / 10, 1);
      ew.rotation.x = -Math.PI / 2;
      ew.position.set(0, 0.02, v);
      ew.receiveShadow = true;
      scene.add(ew);
    }
    // Sidewalk slabs at every intersection.
    const walkMat = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 1 });
    for (const x of lines) {
      for (const z of lines) {
        const slab = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), walkMat);
        slab.rotation.x = -Math.PI / 2;
        slab.position.set(x, 0.03, z);
        slab.receiveShadow = true;
        scene.add(slab);
        this.intersections.push({ x, z });
      }
    }

    // Blocks: buildings fill the space between streets.
    const bases = ['#c98f5f', '#b98a6d', '#8fa3b0', '#a89a7d', '#c2a15e', '#7d8ea3', '#b06a52', '#9c8f88'];
    const blockCenters = [];
    for (let bx = -H + pitch / 2; bx < H; bx += pitch) {
      for (let bz = -H + pitch / 2; bz < H; bz += pitch) {
        blockCenters.push({ x: bx, z: bz });
      }
    }
    for (const bc of blockCenters) {
      // Marina block stays open: pier + boat instead of buildings.
      if (Math.abs(bc.x - this.marina.x) < 45 && Math.abs(bc.z - this.marina.z) < 45) continue;
      // Safehouse block: one low building + open yard.
      if (Math.abs(bc.x - this.safehouse.x) < 25 && Math.abs(bc.z - this.safehouse.z) < 25) {
        this.addSafehouse(bc);
        continue;
      }
      const count = rng.int(1, 4);
      for (let i = 0; i < count; i++) {
        const w = rng.range(9, 15);
        const d = rng.range(9, 15);
        const h = clamp(rng.gauss(17, 9), 7, 46);
        const ox = bc.x + (count === 1 ? 0 : rng.range(-8, 8));
        const oz = bc.z + (count === 1 ? 0 : rng.range(-8, 8));
        const base = rng.pick(bases);
        const tex = makeBuildingTexture(rng, base, 0.42);
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(ox, h / 2, oz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        this.buildings.push(mesh);
        this.colliders.push({ minX: ox - w / 2, maxX: ox + w / 2, minZ: oz - d / 2, maxZ: oz + d / 2 });
        // Rooftop box / AC unit for silhouette variety.
        if (rng.chance(0.55)) {
          const roof = new THREE.Mesh(
            new THREE.BoxGeometry(rng.range(2, 4), rng.range(1, 2.5), rng.range(2, 4)),
            new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 1 }),
          );
          roof.position.set(ox + rng.range(-2, 2), h + 0.8, oz + rng.range(-2, 2));
          scene.add(roof);
        }
      }
      // A palm or two per block, on the sidewalk corners.
      if (rng.chance(0.7)) this.addPalm(bc.x + rng.range(-14, 14), bc.z + rng.range(-14, 14));
    }

    // Street lamps along every street, every 40 units, alternating sides.
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6, metalness: 0.6 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc861, emissiveIntensity: 1.4 });
    for (const v of lines) {
      for (let u = -H + 20; u <= H - 20; u += 40) {
        this.addLamp(u, v + 6.5, lampMat, bulbMat);
        this.addLamp(v + 6.5, u, lampMat, bulbMat);
      }
    }

    // Destructible props: traffic cones, hydrants, barriers near the spawn
    // and along the main avenue so a getaway always has something to smash.
    const propSpots = [];
    for (let i = 0; i < 26; i++) {
      propSpots.push({ x: rng.range(-160, 160), z: rng.range(-160, 160), kind: 'cone' });
    }
    for (let i = 0; i < 10; i++) {
      propSpots.push({ x: rng.range(-160, 160), z: rng.range(-160, 160), kind: 'barrier' });
    }
    for (const spot of propSpots) {
      // Keep props on or beside roads, never inside a building.
      if (this.insideCollider(spot.x, spot.z, 2)) continue;
      this.addProp(spot.x, spot.z, spot.kind);
    }

    // Marina pier + the getaway boat (the final job's destination).
    this.buildMarina();
    // A few billboards for art direction.
    this.addBillboard(-40, 60, 'SOLMAR', '#ff7a3c');
    this.addBillboard(80, -40, 'SUNSET FM 98.4', '#2fb3a3');
    this.addBillboard(120, 100, 'MARISOL & CO.', '#e8b23a');
  }

  addSafehouse(bc) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8c9a3, roughness: 0.9 });
    const house = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 12), mat);
    house.position.set(bc.x, 3.5, bc.z - 4);
    house.castShadow = true;
    house.receiveShadow = true;
    this.scene.add(house);
    this.colliders.push({ minX: bc.x - 8, maxX: bc.x + 8, minZ: bc.z - 10, maxZ: bc.z + 2 });
    // Garage door (open yard in front is where rare cars park).
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(7, 4.5, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.6, metalness: 0.4 }),
    );
    door.position.set(bc.x, 2.25, bc.z + 2.1);
    this.scene.add(door);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(5, 1.2, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x243b2e, emissive: 0x1d5c3a, emissiveIntensity: 0.6 }),
    );
    sign.position.set(bc.x, 6.2, bc.z + 2.1);
    this.scene.add(sign);
    this.buildings.push(house);
  }

  buildMarina() {
    const { x, z } = this.marina;
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 1 });
    const pier = new THREE.Mesh(new THREE.BoxGeometry(26, 1, 40), pierMat);
    pier.position.set(x, 0.5, z + 8);
    pier.castShadow = true;
    pier.receiveShadow = true;
    this.scene.add(pier);
    this.colliders.push({ minX: x - 13, maxX: x + 13, minZ: z - 12, maxZ: z + 28 });
    // The getaway boat, white hull + cabin, waiting at the pier end.
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(5, 2.2, 12),
      new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.4 }),
    );
    hull.position.set(x + 9, 0.8, z - 6);
    hull.castShadow = true;
    this.scene.add(hull);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(4, 2, 5),
      new THREE.MeshStandardMaterial({ color: 0x274b63, roughness: 0.5 }),
    );
    cabin.position.set(x + 9, 2.6, z - 6);
    cabin.castShadow = true;
    this.scene.add(cabin);
    this.boat = hull;
  }

  addPalm(x, z) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.55, 7, 7),
      new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 1 }),
    );
    trunk.position.set(x, 3.5, z);
    trunk.castShadow = true;
    this.scene.add(trunk);
    const fronds = new THREE.Mesh(
      new THREE.ConeGeometry(3.2, 3.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 1 }),
    );
    fronds.position.set(x, 8.2, z);
    fronds.castShadow = true;
    this.scene.add(fronds);
  }

  addLamp(x, z, poleMat, bulbMat) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6.5, 6), poleMat);
    pole.position.set(x, 3.25, z);
    this.scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), bulbMat);
    bulb.position.set(x, 6.6, z);
    this.scene.add(bulb);
    this.lamps.push(bulb);
  }

  addProp(x, z, kind) {
    let mesh;
    if (kind === 'cone') {
      mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 1.3, 10),
        new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.8 }),
      );
      mesh.position.set(x, 0.65, z);
    } else {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.9, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.7 }),
      );
      mesh.position.set(x, 0.45, z);
      mesh.rotation.y = this.rng.range(0, Math.PI);
    }
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.props.push({ mesh, x, z, radius: kind === 'cone' ? 0.7 : 1.4, alive: true, kind });
  }

  addBillboard(x, z, text, color) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#14141c';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = color;
    g.font = 'bold 56px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 4.5),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }),
    );
    board.position.set(x, 12, z);
    board.rotation.y = this.rng.range(0, Math.PI);
    this.scene.add(board);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 9, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x333333 }),
    );
    post.position.set(x, 4.5, z);
    this.scene.add(post);
  }

  // --- collision --------------------------------------------------------
  insideCollider(x, z, pad = 0) {
    for (const c of this.colliders) {
      if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
    }
    return false;
  }

  // Push a circle (x, z, radius) out of every building AABB it overlaps.
  // Returns true when a push happened.
  resolveCircle(pos, radius) {
    let hit = false;
    for (const c of this.colliders) {
      const cx = clamp(pos.x, c.minX, c.maxX);
      const cz = clamp(pos.z, c.minZ, c.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        hit = true;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (radius - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
        } else {
          // Dead centre inside a building: shove out along the short axis.
          const left = pos.x - c.minX, right = c.maxX - pos.x;
          const top = pos.z - c.minZ, bottom = c.maxZ - pos.z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x = c.minX - radius;
          else if (m === right) pos.x = c.maxX + radius;
          else if (m === top) pos.z = c.minZ - radius;
          else pos.z = c.maxZ + radius;
        }
      }
    }
    return hit;
  }

  // Nearest street coordinate (multiple of 40) — traffic and missions
  // snap to the road grid with this.
  nearestStreet(v) { return Math.round(v / CITY.block) * CITY.block; }
  onRoad(x, z) {
    const rx = Math.abs(x - this.nearestStreet(x));
    const rz = Math.abs(z - this.nearestStreet(z));
    return rx <= CITY.roadHalf + 1 || rz <= CITY.roadHalf + 1;
  }

  // A point on a road near (x, z), for spawning traffic and mission cars.
  roadPointNear(x, z, rng) {
    const sx = this.nearestStreet(x + (rng ? rng.range(-60, 60) : 0));
    const sz = this.nearestStreet(z + (rng ? rng.range(-60, 60) : 0));
    return { x: clamp(sx, -CITY.half, CITY.half), z: clamp(sz, -CITY.half, CITY.half) };
  }
}
