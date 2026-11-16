// The other seven soldiers. Each bot is a physics body from player.js, a
// three-box figure (legs, torso, head — the same parts the damage model
// prices), a gun from the shared weapons table, and a small state machine:
//
//   advance  walk the waypoint graph toward a goal (attackers: the site;
//            defenders: their hold points)
//   hold     stay on the goal, scan the lanes, shuffle between cover spots
//   engage   a visible enemy: stop or strafe, let the reaction time pass,
//            then fire bursts — accuracy falls with range and target speed
//   channel  planting or defusing: stand still and be vulnerable
//
// Vision is a real test, run a few times a second per bot: range, a facing
// cone (or arm's reach in any direction), and the world's line-of-sight
// segment test, so a bot behind a container genuinely cannot see you.
// Gunfire it cannot see still draws it: main.js reports noise and a bot
// with no target paths toward the nearest waypoint to the sound. A flash
// grenade sets blindUntil and the bot simply stands, sightless. Harbour
// Watch rotates its defence every round (see resetRound): each defender
// shifts one hold slot, so the site stack and the mid hold change hands
// and no round plays the same defence twice in a row.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './player.js';
import { WEAPONS, damageAt } from './weapons.js';
import { inSite } from './world.js';

const ATK_NAMES = ['Rook', 'Sable', 'Milo'];
const DEF_NAMES = ['Vera', 'Holt', 'Ilya', 'Bran'];
const ATK_GOALS = [15, 14, 16]; // site centre, site west, site east
const DEF_HOLDS = [21, 12, 14, 16]; // site entry, mid-north, site west, site east

export function createBots(scene, world, rng, hooks, map) {
  const colliders = world.colliders;
  const teamMats = {
    atk: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.7 }),
    def: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.7 }),
  };
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.sand), roughness: 0.65 });
  const legGeo = new THREE.BoxGeometry(0.44, 0.78, 0.27);
  const torsoGeo = new THREE.BoxGeometry(0.56, 0.74, 0.31);
  const headGeo = new THREE.SphereGeometry(0.16, 12, 9);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.52);

  const bots = [];
  const hitMeshes = [];
  const eye = new THREE.Vector3();
  const chest = new THREE.Vector3();
  const toTarget = new THREE.Vector3();

  function makeBot(name, team, index) {
    const group = new THREE.Group();
    const legs = new THREE.Mesh(legGeo, darkMat);
    legs.position.y = 0.39;
    const torso = new THREE.Mesh(torsoGeo, teamMats[team]);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.68;
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.18, 1.32, -0.3);
    group.add(legs, torso, head, gun);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(group);

    const bodyApi = createBody(colliders, 0, 0);
    const bot = {
      name, team, index, group, bodyApi,
      body: bodyApi.state,
      weaponKey: 'pistol',
      money: 800,
      mode: 'advance',
      goalNode: 0,
      path: [], pathI: 0,
      target: null, seenAt: -9, lastSeenAt: -9,
      lastSeen: new THREE.Vector3(),
      thinkT: rng() * 0.12,
      burstLeft: 0, shotT: 0, pauseT: 0,
      strafeDir: 1, strafeT: 0,
      channel: null,
      blindUntil: -1,
      investigate: -1,
      fallT: 0,
      scanYaw: 0,
      combatant: null,
    };
    const combatant = {
      name, team, isPlayer: false, bot,
      bodyState: bot.body, health: 100, alive: true, armor: false,
    };
    bot.combatant = combatant;
    for (const [mesh, part] of [[head, 'head'], [torso, 'torso'], [legs, 'leg']]) {
      mesh.userData.combatant = combatant;
      mesh.userData.part = part;
      hitMeshes.push(mesh);
    }
    bots.push(bot);
    return bot;
  }

  ATK_NAMES.forEach((n, i) => makeBot(n, 'atk', i));
  DEF_NAMES.forEach((n, i) => makeBot(n, 'def', i));

  function setPathTo(bot, nodeIdx) {
    const from = world.nav.nearestNode(bot.body.position.x, bot.body.position.z);
    bot.path = world.nav.findPath(from, nodeIdx);
    bot.pathI = 0;
    bot.goalNode = nodeIdx;
  }

  function resetRound(roundNo = 1) {
    // Harbour Watch rotates its defence every round: each defender shifts
    // one hold slot, so the site stack and the mid hold change hands and
    // no round plays the same defence twice in a row.
    const rot = ((roundNo - 1) % DEF_HOLDS.length + DEF_HOLDS.length) % DEF_HOLDS.length;
    const atkSpawns = [map.attackSpawns[0], map.attackSpawns[2], map.attackSpawns[3]];
    for (const bot of bots) {
      const c = bot.combatant;
      c.health = 100;
      c.alive = true;
      c.armor = bot.money >= 1450;
      bot.weaponKey = bot.money >= 2700 ? 'rifle' : bot.money >= 1900 ? 'burst' : bot.money >= 1200 ? 'smg' : 'pistol';
      bot.money -= WEAPONS[bot.weaponKey].price;
      if (c.armor) bot.money -= 650;
      bot.target = null;
      bot.channel = null;
      bot.blindUntil = -1;
      bot.fallT = 0;
      bot.mode = 'advance';
      bot.group.rotation.set(0, 0, 0);
      bot.group.visible = true;
      if (bot.team === 'atk') {
        const [x, z] = atkSpawns[bot.index];
        bot.bodyApi.teleport(x, z, map.rotate ? -Math.PI / 2 : 0);
        bot.isPlanter = bot.index === 0;
        setPathTo(bot, ATK_GOALS[bot.index]);
      } else {
        const [x, z] = map.defendSpawns[bot.index];
        bot.bodyApi.teleport(x, z, map.rotate ? Math.PI / 2 : Math.PI);
        bot.isPlanter = false;
        setPathTo(bot, DEF_HOLDS[(bot.index + rot) % DEF_HOLDS.length]);
      }
      bot.scanYaw = bot.body.yaw;
    }
  }

  function faceToward(bot, x, z, dt, rate = 10) {
    const want = Math.atan2(-(x - bot.body.position.x), -(z - bot.body.position.z));
    let diff = want - bot.body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.body.yaw += THREE.MathUtils.clamp(diff, -rate * dt, rate * dt);
  }

  function visibleEnemies(bot, time, combatants) {
    eye.set(bot.body.position.x, bot.body.position.y + 1.55, bot.body.position.z);
    let best = null;
    let bestDist = Infinity;
    for (const c of combatants) {
      if (!c.alive || c.team === bot.team) continue;
      const p = c.bodyState.position;
      const dx = p.x - bot.body.position.x;
      const dz = p.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 44 || dist >= bestDist) continue;
      if (dist > 5.5) {
        const fx = -Math.sin(bot.body.yaw);
        const fz = -Math.cos(bot.body.yaw);
        const dot = (dx * fx + dz * fz) / (dist || 1);
        if (dot < 0.25) continue; // outside the facing cone
      }
      chest.set(p.x, p.y + (c.bodyState.crouching ? 0.85 : 1.15), p.z);
      if (!world.losClear(eye, chest)) continue;
      best = c;
      bestDist = dist;
    }
    if (best) {
      if (bot.target !== best) bot.seenAt = time;
      bot.target = best;
      bot.lastSeen.copy(best.bodyState.position);
      bot.lastSeenAt = time;
    } else if (bot.target && time - bot.lastSeenAt > 0.4) {
      bot.target = null;
    }
    return bot.target;
  }

  function moveAlongPath(bot, dt, speedScale = 1) {
    if (bot.pathI >= bot.path.length) return true;
    const [nx, nz] = world.nav.nodes[bot.path[bot.pathI]];
    const dx = nx - bot.body.position.x;
    const dz = nz - bot.body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.8) { bot.pathI += 1; return bot.pathI >= bot.path.length; }
    faceToward(bot, nx, nz, dt, 7);
    bot.bodyApi.step(dt, dx / dist, dz / dist, { speedScale });
    return false;
  }

  function stepBot(bot, dt, time, phase, combatants) {
    const c = bot.combatant;
    // Keep the figure glued to its physics body, dead or alive.
    if (!c.alive) {
      bot.fallT = Math.min(1, bot.fallT + dt / 0.35);
      bot.group.position.copy(bot.body.position);
      bot.group.rotation.x = -bot.fallT * 1.5;
      return;
    }
    bot.group.position.copy(bot.body.position);
    bot.group.rotation.y = bot.body.yaw;
    bot.group.position.y += bot.body.crouching ? -0.18 : 0;
    if (phase === 'buy' || phase === 'over') return;
    if (time < bot.blindUntil) { bot.bodyApi.step(dt, 0, 0, {}); return; }
    if (bot.channel) {
      bot.bodyApi.step(dt, 0, 0, { crouch: bot.channel === 'plant' });
      return;
    }

    bot.thinkT -= dt;
    if (bot.thinkT <= 0) {
      bot.thinkT = 0.12;
      visibleEnemies(bot, time, combatants);
      if (!bot.target && bot.investigate >= 0) {
        setPathTo(bot, bot.investigate);
        bot.mode = 'advance';
        bot.investigate = -1;
      }
    }

    const target = bot.target;
    if (target) {
      const tp = target.bodyState.position;
      faceToward(bot, tp.x, tp.z, dt, 12);
      const dist = Math.hypot(tp.x - bot.body.position.x, tp.z - bot.body.position.z);
      // Strafe while fighting; close distance only when far.
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) { bot.strafeT = 0.6 + rng() * 0.9; bot.strafeDir = rng() < 0.5 ? -1 : 1; }
      const sx = -Math.cos(bot.body.yaw) * bot.strafeDir;
      const sz = Math.sin(bot.body.yaw) * bot.strafeDir;
      let mx = sx;
      let mz = sz;
      if (dist > 24) { mx += -Math.sin(bot.body.yaw); mz += -Math.cos(bot.body.yaw); }
      if (dist < 6) { mx -= -Math.sin(bot.body.yaw) * 0.6; mz -= -Math.cos(bot.body.yaw) * 0.6; }
      bot.bodyApi.step(dt, mx, mz, { crouch: dist > 13 && bot.burstLeft > 0, speedScale: 0.82 });
      // Fire control: reaction delay, then bursts from the shared table.
      const def = WEAPONS[bot.weaponKey];
      bot.shotT -= dt;
      bot.pauseT -= dt;
      if (time - bot.seenAt > 0.34 && bot.pauseT <= 0 && bot.shotT <= 0) {
        if (bot.burstLeft <= 0) bot.burstLeft = def.pellets > 1 ? 1 : 3 + Math.floor(rng() * 3);
        bot.burstLeft -= 1;
        bot.shotT = def.interval;
        if (bot.burstLeft <= 0) bot.pauseT = 0.45 + rng() * 0.5;
        hooks.resolveShot(bot, target, def);
      }
      return;
    }

    // No visible enemy: remember the last sighting briefly and push it.
    if (time - bot.lastSeenAt < 2.2 && bot.lastSeenAt > 0) {
      const dx = bot.lastSeen.x - bot.body.position.x;
      const dz = bot.lastSeen.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.6) {
        faceToward(bot, bot.lastSeen.x, bot.lastSeen.z, dt, 8);
        bot.bodyApi.step(dt, dx / dist, dz / dist, { speedScale: 0.95 });
        return;
      }
      bot.lastSeenAt = -9;
    }

    if (bot.mode === 'advance') {
      const arrived = moveAlongPath(bot, dt, bot.team === 'atk' ? 0.98 : 0.9);
      bot.atGoal = arrived;
      if (arrived) bot.mode = 'hold';
    } else {
      // Hold: scan across the lanes, small repositioning shuffles.
      bot.scanYaw += Math.sin(time * 0.4 + bot.index * 2.1) * dt * 0.5;
      bot.body.yaw += (bot.scanYaw - bot.body.yaw) * Math.min(1, dt * 3);
      bot.bodyApi.step(dt, 0, 0, {});
      bot.atGoal = true;
    }
    bot.atSite = bot.team === 'atk' && inSite(map, bot.body.position.x, bot.body.position.z);
  }

  return {
    bots,
    hitMeshes,
    resetRound,
    step(dt, time, phase, combatants) {
      for (const bot of bots) stepBot(bot, dt, time, phase, combatants);
    },
    hearNoise(x, z) {
      for (const bot of bots) {
        if (!bot.combatant.alive || bot.target) continue;
        const d = Math.hypot(bot.body.position.x - x, bot.body.position.z - z);
        if (d < 27 && d > 4) bot.investigate = world.nav.nearestNode(x, z);
      }
    },
    award(team, amount) {
      for (const bot of bots) if (bot.team === team) bot.money = Math.min(16000, bot.money + amount);
    },
    planter() { return bots.find((b) => b.team === 'atk' && b.isPlanter) ?? null; },
  };
}

// Re-exported so main.js prices bot hits with the same table as its own.
export { damageAt };
