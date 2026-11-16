// Kestrel Yard: an original container-yard map, in two shifts. The day map
// ("Kestrel Yard", dusk) runs three lanes south to north — Long Yard
// (west), Mid (centre) and Short Haul (east) — joined by a cross street,
// all feeding one bombsite at the north end. Attackers spawn at the south
// gate, defenders around the site. The night map ("Night Shift") is the
// same yard turned 90 degrees: the lanes run west to east, attackers spawn
// at the west gate and the site sits at the east end, under floodlights
// and a gantry crane — so the sightlines, rotations and holds are
// genuinely different, while the construction stays one layout described
// once and transformed. Every solid is an axis-aligned box: the same Box3
// is the movement collider, the bullet stopper and (for the tall ones) the
// sight blocker, so cover, collision and line-of-sight can never disagree.
// The module also builds the waypoint graph the bots walk and the segment
// test their vision uses.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const SITE_YARD = { minX: -9, maxX: 9, minZ: -26, maxZ: -14 };
const ATTACK_SPAWNS_YARD = [[-13, 23], [0, 24], [13, 23], [-6, 24.5], [6, 24.5]];
const DEFEND_SPAWNS_YARD = [[-11, -24], [11, -24], [-4, -25], [5, -25], [0, -21]];

// 90° clockwise: south (attackers) becomes west, north (the site)
// becomes east. The night map is the day layout through this transform,
// so the two maps share one set of placements and one nav graph.
function rotPoint(x, z) { return [-z, x]; }
function rotSite(s) {
  const corners = [
    rotPoint(s.minX, s.minZ), rotPoint(s.maxX, s.minZ),
    rotPoint(s.minX, s.maxZ), rotPoint(s.maxX, s.maxZ),
  ];
  return {
    minX: Math.min(...corners.map((c) => c[0])),
    maxX: Math.max(...corners.map((c) => c[0])),
    minZ: Math.min(...corners.map((c) => c[1])),
    maxZ: Math.max(...corners.map((c) => c[1])),
  };
}

export const SITE = SITE_YARD;
export const ATTACK_SPAWNS = ATTACK_SPAWNS_YARD;
export const DEFEND_SPAWNS = DEFEND_SPAWNS_YARD;

const NAV_NODES_YARD = [
  [-13, 23], [0, 24], [13, 23], // 0-2 attacker spawns
  [0, 16], [-19, 16], [19, 16], // 3-5 south street
  [-19, 4], [-9, 2], [0, 3], [9, 2], [19, 4], // 6-10 cross street
  [-19, -8], [0, -9], [19, -8], // 11-13 north lanes
  [-7, -19], [0, -20], [7, -19], // 14-16 the site
  [-11, -24], [11, -24], // 17-18 defender spawns
  [-19, -15], [19, -15], [0, -13], // 19-21 site entries
  [-19, -20], [19, -20], // 22-23 site flanks
];
const NAV_EDGES = [
  [0, 4], [0, 3], [2, 5], [2, 3], [1, 3], [4, 3], [5, 3],
  [4, 6], [5, 10], [3, 8], [6, 7], [7, 8], [8, 9], [9, 10],
  [6, 11], [10, 13], [8, 12], [11, 12], [12, 13],
  [11, 19], [13, 20], [12, 21], [19, 22], [20, 23],
  [22, 14], [23, 16], [21, 15], [14, 15], [15, 16],
  [14, 17], [16, 18], [17, 15], [18, 15], [19, 14], [20, 16],
];

// One map definition per shift. The night map's geometry is the yard's
// through rotPoint, so a fix to a lane lands in both maps at once; only
// the lighting and the night-only props differ.
export const MAPS = {
  yard: {
    id: 'yard', name: 'Kestrel Yard', night: false, rotate: false,
    site: SITE_YARD,
    siteCenter: { x: 0, z: -20 },
    attackSpawns: ATTACK_SPAWNS_YARD,
    defendSpawns: DEFEND_SPAWNS_YARD,
    navNodes: NAV_NODES_YARD, navEdges: NAV_EDGES,
  },
  night: {
    id: 'night', name: 'Night Shift', night: true, rotate: true,
    site: rotSite(SITE_YARD),
    siteCenter: { x: 20, z: 0 },
    attackSpawns: ATTACK_SPAWNS_YARD.map(([x, z]) => rotPoint(x, z)),
    defendSpawns: DEFEND_SPAWNS_YARD.map(([x, z]) => rotPoint(x, z)),
    navNodes: NAV_NODES_YARD.map(([x, z]) => rotPoint(x, z)),
    navEdges: NAV_EDGES,
  },
};

export function inSite(map, x, z) {
  const s = map.site;
  return x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ;
}

// Slab test: does the segment a->b touch this box (t in [0,1])?
function segmentHitsBox(a, b, box) {
  let tmin = 0;
  let tmax = 1;
  const axes = ['x', 'y', 'z'];
  for (const axis of axes) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-8) {
      if (a[axis] < box.min[axis] || a[axis] > box.max[axis]) return false;
    } else {
      let t1 = (box.min[axis] - a[axis]) / d;
      let t2 = (box.max[axis] - a[axis]) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export function createWorld(scene, map) {
  const group = new THREE.Group();
  scene.add(group);

  // Placement goes through the map's transform: on the night map every
  // (x, z) is rotated 90° and every box's footprint swaps w and d, so the
  // layout below is written once, in yard coordinates.
  const P = (x, z) => (map.rotate ? rotPoint(x, z) : [x, z]);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'teal' ? 0.5 : 0.9,
      metalness: 0.04,
    });
  }
  const darkSteel = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.95 });
  const lampHeadMat = map.night
    ? new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0') })
    : materials.accent;

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, solid = true) {
    const [px, pz] = P(x, z);
    const [bw, bd] = map.rotate ? [d, w] : [w, d];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, h, bd), material);
    mesh.position.set(px, y, pz);
    mesh.castShadow = solid;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }
  const M = (name) => materials[name];
  // A shipping container: long box with a slightly proud roof slab.
  function container(x, z, alongX, name) {
    const ax = map.rotate ? !alongX : alongX;
    if (ax) {
      box(6.2, 2.6, 2.5, x, 1.3, z, M(name));
      box(6.4, 0.14, 2.7, x, 2.67, z, darkSteel);
    } else {
      box(2.5, 2.6, 6.2, x, 1.3, z, M(name));
      box(2.7, 0.14, 6.4, x, 2.67, z, darkSteel);
    }
  }
  const crate = (x, z, h = 1.1) => box(1.7, h, 1.7, x, h / 2, z, M('hairline'));
  const barrier = (x, z, alongX) => {
    const ax = map.rotate ? !alongX : alongX;
    return ax ? box(3.2, 1.05, 0.9, x, 0.52, z, M('sand')) : box(0.9, 1.05, 3.2, x, 0.52, z, M('sand'));
  };

  // Ground and the yard fence.
  box(60, 0.4, 60, 0, -0.2, 0, M('hairline'));
  box(60, 5, 0.5, 0, 2.5, -29.5, M('hairline'));
  box(60, 5, 0.5, 0, 2.5, 29.5, M('hairline'));
  box(0.5, 5, 60, -29.5, 2.5, 0, M('hairline'));
  box(0.5, 5, 60, 29.5, 2.5, 0, M('hairline'));

  // Bombsite paint and its four orange corner posts: the objective reads
  // from anywhere on the map. Written in yard coordinates; box() rotates
  // them onto the night site.
  const s = SITE_YARD;
  const paint = box(s.maxX - s.minX, 0.04, s.maxZ - s.minZ, 0, 0.02, (s.minZ + s.maxZ) / 2, M('sand'), false);
  paint.castShadow = false;
  for (const cx of [s.minX, s.maxX]) {
    for (const cz of [s.minZ, s.maxZ]) box(0.32, 1.5, 0.32, cx, 0.75, cz, M('accent'));
  }

  // West lane (Long Yard) and east lane (Short Haul).
  container(-19, 10, false, 'rust');
  container(-19, -3, false, 'moss');
  container(19, 10, false, 'moss');
  container(19, -3, false, 'rust');
  container(-19, -14.5, true, 'sand');
  container(19, -14.5, true, 'hairline');
  // Mid lane: staggered containers so mid is a duel, not a corridor.
  container(-3.4, 8, true, 'rust');
  container(3.6, -5, true, 'sand');
  container(0, 18.5, false, 'moss');
  // The site itself: hard cover to plant behind.
  container(-5.5, -23.5, true, 'rust');
  container(6.5, -17, false, 'teal');
  // Cross-street barriers and crouch crates everywhere a fight is expected.
  barrier(-10, 2, true); barrier(10, 2, true);
  crate(-8, 16); crate(8, 16); crate(-12.5, -8); crate(12.5, -8);
  crate(-4.5, -16.5); crate(3.5, -21); crate(0, -10.5); crate(-14, 19, 1.6);
  crate(14, 19, 1.6); crate(-9, -3.5); crate(9.5, 7.5); crate(-24, -10); crate(24, -10);
  // A watch platform over the site's west corner, reached by a jump.
  box(3.4, 0.5, 3.4, -13, 0.25, -20, M('hairline'));
  box(3.4, 1.0, 3.4, -13, 0.5, -23.5, M('hairline'));

  // Lamp poles down the lanes. On the night map they are floodlight
  // towers: taller poles with glowing heads, and three of them carry
  // real point lights, so the night map is lit in pools, not flat.
  const poleH = map.night ? 9 : 5.6;
  for (const [lx, lz] of [[-13, 12], [13, 12], [-13, -12], [13, -12], [0, -20]]) {
    box(0.18, poleH, 0.18, lx, poleH / 2, lz, darkSteel);
    box(0.7, 0.16, 0.7, lx, poleH + 0.05, lz, lampHeadMat);
  }
  if (map.night) {
    // Floodlights: warm pools over the site, the west street and the
    // east lane. Positions are in map (night) coordinates.
    for (const [fx, fz, fi] of [[20, 0, 120], [-12, 13, 80], [12, -13, 80]]) {
      const flood = new THREE.PointLight(new THREE.Color('#ffd9a0'), fi, 34, 1.8);
      flood.position.set(fx, 8.5, fz);
      scene.add(flood);
    }
    // A gantry crane over mid lane, its beam carrying a lit strip: the
    // night map's landmark. Legs stand clear of the waypoint nodes.
    // Written in yard coordinates: the legs land at night (0, ±6) and the
    // beam spans across mid lane.
    box(0.8, 7, 0.8, -6, 3.5, 0, darkSteel);
    box(0.8, 7, 0.8, 6, 3.5, 0, darkSteel);
    box(13, 0.9, 1.0, 0, 7, 0, darkSteel, false);
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.12, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0') }),
    );
    strip.position.set(0, 6.5, 0);
    group.add(strip);
    // Stars above the fence: the night sky is not a flat colour.
    const starCount = 220;
    const starPos = new Float32Array(starCount * 3);
    let si = 0;
    while (si < starCount) {
      const a = Math.random() * Math.PI * 2;
      const r = 90 + Math.random() * 30;
      const y = 14 + Math.random() * 60;
      starPos[si * 3] = Math.cos(a) * r;
      starPos[si * 3 + 1] = y;
      starPos[si * 3 + 2] = Math.sin(a) * r;
      si += 1;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: new THREE.Color('#cdd8ff'), size: 1.4, sizeAttenuation: false, fog: false,
    }));
    scene.add(stars);
  } else {
    const lampGlow = new THREE.PointLight(new THREE.Color('#ffb36b'), 60, 26, 1.8);
    lampGlow.position.set(0, 5.4, -20);
    scene.add(lampGlow);
    const lamp2 = new THREE.PointLight(new THREE.Color('#ffb36b'), 40, 24, 1.8);
    lamp2.position.set(-13, 5.4, 12);
    scene.add(lamp2);
  }

  // Skyline silhouettes outside the fence: the yard sits in a harbour.
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2 + 0.22;
    const dist = 44 + (i % 3) * 7;
    const h = 9 + (i * 7) % 13;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(8, h, 8), darkSteel);
    tower.position.set(Math.cos(angle) * dist, h / 2 - 0.4, Math.sin(angle) * dist);
    scene.add(tower);
  }

  if (map.night) {
    // Night lighting: cool moonlight with shadows, dim blue hemisphere,
    // faint fill — the floodlights do the warm work.
    const hemi = new THREE.HemisphereLight(new THREE.Color('#24304a'), new THREE.Color('#05070c'), 0.55);
    scene.add(hemi);
    const moon = new THREE.DirectionalLight(new THREE.Color('#93b4ff'), 1.0);
    moon.position.set(28, 42, -18);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -34; moon.shadow.camera.right = 34;
    moon.shadow.camera.top = 34; moon.shadow.camera.bottom = -34;
    moon.shadow.camera.far = 110;
    moon.shadow.bias = -0.0006;
    scene.add(moon, moon.target);
    const fill = new THREE.DirectionalLight(new THREE.Color('#3a4a6a'), 0.18);
    fill.position.set(-24, 16, 22);
    scene.add(fill);
  } else {
    // Light: low warm sun from the west, cool sky fill, dusk hemisphere.
    const hemi = new THREE.HemisphereLight(new THREE.Color('#3a465e'), new THREE.Color(PALETTE.canvas), 1.4);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(new THREE.Color('#ffb36b'), 2.5);
    sun.position.set(-34, 30, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -34; sun.shadow.camera.right = 34;
    sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
    sun.shadow.camera.far = 110;
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(new THREE.Color('#5a6f95'), 0.5);
    fill.position.set(26, 18, -20);
    scene.add(fill);
  }

  // Waypoint graph with BFS paths, built once.
  const nodes = map.navNodes;
  const adjacency = nodes.map(() => []);
  for (const [a, b] of map.navEdges) { adjacency[a].push(b); adjacency[b].push(a); }
  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const d = (nodes[i][0] - x) ** 2 + (nodes[i][1] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  function findPath(fromIdx, toIdx) {
    if (fromIdx === toIdx) return [toIdx];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [fromIdx];
    prev[fromIdx] = fromIdx;
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adjacency[cur]) {
        if (prev[next] === -1) { prev[next] = cur; queue.push(next); }
      }
      if (prev[toIdx] !== -1) break;
    }
    if (prev[toIdx] === -1) return [toIdx];
    const path = [];
    let cur = toIdx;
    while (cur !== fromIdx) { path.push(cur); cur = prev[cur]; }
    path.reverse();
    return path;
  }
  function losClear(a, b) {
    // Ignore hits in the last 8% so a target hugging cover still reads.
    const end = { x: a.x + (b.x - a.x) * 0.92, y: a.y + (b.y - a.y) * 0.92, z: a.z + (b.z - a.z) * 0.92 };
    for (const collider of colliders) if (segmentHitsBox(a, end, collider)) return false;
    return true;
  }

  return {
    colliders, shootables, group,
    nav: { nodes, nearestNode, findPath },
    losClear,
  };
}
