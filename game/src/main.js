// Kestrel Yard — boot and the one loop. A fixed 60 Hz simulation (rounds,
// player, bots, weapons, grenades) feeds a render at the display's rate.
// This module is the only place the pieces meet: it owns combat resolution
// for every gun in the game (the player's raycasts and the bots' hit
// rolls price damage from the same table), the plant and defuse channels,
// the buy menu, the camera (first person, death fall, teammate spectate,
// marksman scope) and the deterministic ?shot= frames used for the entry's
// screenshots: ?shot=start|play|end&seed=N stages a scene, steps the real
// simulation, renders twice, freezes and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, inSite, ATTACK_SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { WEAPONS, GRENADE_PRICES, ARMOR_PRICE, damageAt, createArsenal } from './weapons.js';
import { createBots } from './bots.js';
import { createEffects } from './effects.js';
import { createRounds, PLANT_TIME, DEFUSE_TIME } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(shot ? seed * 7919 + 13 : (Date.now() % 2147483646) + 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 34, 95);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const audio = createAudio();
const effects = createEffects(scene, world.colliders);
const player = createPlayer(world.colliders, ATTACK_SPAWNS[1][0], ATTACK_SPAWNS[1][1]);
const arsenal = createArsenal(camera);

const playerC = {
  name: 'You', team: 'atk', isPlayer: true, bot: null,
  bodyState: player.state, health: 100, alive: true, armor: false,
};

// The bomb prop: a dark charge with a blinking orange light, hidden until planted.
const bombGroup = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.46, 0.22, 0.34),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5 }),
);
const bombLampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
const bombLamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), bombLampMat);
bombLamp.position.y = 0.14;
bombGroup.add(bombBox, bombLamp);
bombGroup.visible = false;
scene.add(bombGroup);

let simTime = 0;
let started = false;
let frozen = false;
let shakeT = 0;
let deathT = 0;
let beepT = 0;
let wasFiring = false;
const grenades = { he: 0, flash: 0 };
const channel = { kind: null, t: 0, bot: null };
let plantBotT = 0;
let defuseBotT = 0;
let buySignature = '';

const botsApi = createBots(scene, world, rng, { resolveShot });
const combatants = [playerC, ...botsApi.bots.map((b) => b.combatant)];
const allShootables = world.shootables.concat(botsApi.hitMeshes);

const rounds = createRounds({
  onBeginRound(n) {
    const playerDied = !playerC.alive;
    playerC.health = 100;
    playerC.alive = true;
    if (playerDied) { arsenal.dropToPistol(); playerC.armor = false; }
    else arsenal.topUp();
    arsenal.setVisible(true);
    player.teleport(ATTACK_SPAWNS[1][0], ATTACK_SPAWNS[1][1], 0);
    deathT = 0;
    botsApi.resetRound();
    bombGroup.visible = false;
    hud.setBombPlanted(false);
    channel.kind = null;
    plantBotT = 0;
    defuseBotT = 0;
    hud.setChannel(null);
    hud.banner(`ROUND ${n}`, 'Buy phase — spend with keys 1 to 7', 2200);
    buySignature = '';
  },
  onLive() {
    hud.hideBuy();
    hud.banner('ROUND LIVE', 'Plant at Site K or eliminate Harbour Watch', 1800);
  },
  onPlanted(x, z) {
    bombGroup.position.set(x, 0.11, z);
    bombGroup.visible = true;
    hud.setBombPlanted(true);
    hud.banner('BOMB PLANTED', 'Harbour Watch is coming to defuse it', 1800);
    audio.plantBeep(true);
    botsApi.hearNoise(x, z);
  },
  onExploded(x, z) {
    const p = new THREE.Vector3(x, 0.6, z);
    effects.explosion(p, true);
    audio.explosion();
    shakeT = 0.5;
    bombGroup.visible = false;
  },
  onRoundEnd(winner, reason) {
    botsApi.award(winner, 3250);
    botsApi.award(winner === 'atk' ? 'def' : 'atk', 1400);
    hud.setBombPlanted(false);
    hud.setChannel(null);
    channel.kind = null;
    const won = winner === 'atk';
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', `${reason} · Ember ${rounds.state.scoreAtk} — ${rounds.state.scoreDef} Harbour`, 3400);
    audio.roundEnd(won);
  },
  onMatchEnd(winner) {
    const won = winner === 'atk';
    hud.showOverlay(
      won ? 'VICTORY' : 'DEFEAT',
      `Final score — Ember ${rounds.state.scoreAtk} : ${rounds.state.scoreDef} Harbour Watch. ${won ? 'Kestrel Yard is yours.' : 'The yard keeps its secrets. Run it back.'}`,
      'Play again',
    );
    if (document.pointerLockElement) document.exitPointerLock();
  },
});

function counts() {
  let atkAlive = 0;
  let defAlive = 0;
  for (const c of combatants) {
    if (!c.alive) continue;
    if (c.team === 'atk') atkAlive += 1; else defAlive += 1;
  }
  return { atkAlive, defAlive };
}

function applyDamage(sourceC, targetC, dmg, part) {
  const phase = rounds.state.phase;
  if (!targetC.alive || (phase !== 'live' && phase !== 'planted')) return;
  if (sourceC && sourceC.team === targetC.team) return; // no friendly fire
  targetC.health -= dmg;
  const killed = targetC.health <= 0;
  if (targetC.isPlayer) {
    hud.damage();
    audio.hurt();
    shakeT = Math.max(shakeT, 0.14);
  }
  if (sourceC && sourceC.isPlayer) {
    hud.hitMarker(killed, shot ? 4000 : 110);
    if (killed) audio.kill(); else audio.hit();
  }
  if (targetC.bot && targetC.bot.channel) {
    targetC.bot.channel = null; // a bullet interrupts planting and defusing
    if (channel.bot === targetC.bot) { channel.kind = null; hud.setChannel(null); }
  }
  if (killed) {
    targetC.alive = false;
    targetC.health = 0;
    hud.kill(`${sourceC ? sourceC.name : 'Blast'} ▸ ${targetC.name}${part === 'head' ? ' · headshot' : ''}`);
    if (sourceC && sourceC.isPlayer) rounds.addMoney(300);
    if (targetC.isPlayer) {
      arsenal.setVisible(false);
      hud.banner('YOU ARE DOWN', 'Spectating your squad until the round ends', 2600);
    }
  }
}

// --- the player's gun ---------------------------------------------------
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const aimDir = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const rightV = new THREE.Vector3();
const hitPoint = new THREE.Vector3();

function playerFire() {
  const def = arsenal.def();
  syncCamera();
  camera.getWorldDirection(aimDir);
  rightV.set(1, 0, 0).applyQuaternion(camera.quaternion);
  muzzle.copy(camera.position).addScaledVector(aimDir, 0.55).addScaledVector(rightV, 0.2);
  muzzle.y -= 0.14;
  const spread = arsenal.spread(player.groundSpeed(), player.state.crouching, input.state.aiming);
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    const dir = new THREE.Vector3(
      aimDir.x + (rng() * 2 - 1) * spread,
      aimDir.y + (rng() * 2 - 1) * spread,
      aimDir.z + (rng() * 2 - 1) * spread,
    ).normalize();
    raycaster.set(camera.position, dir);
    const hits = raycaster.intersectObjects(allShootables, false);
    let applied = false;
    for (const hit of hits) {
      const targetC = hit.object.userData.combatant;
      if (targetC && !targetC.alive) continue; // a fallen body stops nothing
      hitPoint.copy(hit.point);
      effects.tracer(muzzle, hitPoint);
      effects.spark(hitPoint);
      if (targetC && targetC.team !== playerC.team) {
        const dmg = damageAt(def, hit.object.userData.part, hit.distance) * (targetC.armor ? 0.55 : 1);
        applyDamage(playerC, targetC, dmg, hit.object.userData.part);
      }
      applied = true;
      break;
    }
    if (!applied) {
      hitPoint.copy(camera.position).addScaledVector(dir, 70);
      effects.tracer(muzzle, hitPoint);
    }
  }
  arsenal.consume();
  player.recoil(def.kick + rng() * def.kick * 0.5, (rng() * 2 - 1) * def.kick * 0.6);
  audio.shot(arsenal.current, 0);
  botsApi.hearNoise(player.state.position.x, player.state.position.z);
}

// --- the bots' guns -------------------------------------------------------
const botMuzzle = new THREE.Vector3();
const targetChest = new THREE.Vector3();
function resolveShot(bot, targetC, def) {
  const phase = rounds.state.phase;
  if (phase !== 'live' && phase !== 'planted') return;
  const bp = bot.body.position;
  botMuzzle.set(bp.x - Math.sin(bot.body.yaw) * 0.45, bp.y + 1.34, bp.z - Math.cos(bot.body.yaw) * 0.45);
  const tp = targetC.bodyState.position;
  targetChest.set(tp.x, tp.y + (targetC.bodyState.crouching ? 0.85 : 1.18), tp.z);
  const dist = botMuzzle.distanceTo(targetChest);
  const distToPlayer = Math.hypot(bp.x - player.state.position.x, bp.z - player.state.position.z);
  audio.shot(bot.weaponKey, distToPlayer);
  botsApi.hearNoise(bp.x, bp.z);
  if (!world.losClear(botMuzzle, targetChest)) {
    hitPoint.copy(botMuzzle).lerp(targetChest, 0.4);
    effects.tracer(botMuzzle, hitPoint);
    return;
  }
  let p = THREE.MathUtils.clamp(0.88 - dist * 0.017, 0.22, 0.82);
  const tSpeed = Math.hypot(targetC.bodyState.velocity.x, targetC.bodyState.velocity.z);
  if (tSpeed > 3) p *= 0.72;
  if (targetC.bodyState.crouching) p *= 0.85;
  if (bot.bodyApi.groundSpeed() > 1) p *= 0.8;
  if (def.pellets > 1) p = Math.min(0.9, p + 0.25);
  if (rng() < p) {
    const roll = rng();
    const part = roll < 0.16 ? 'head' : roll < 0.4 ? 'leg' : 'torso';
    effects.tracer(botMuzzle, targetChest);
    effects.spark(targetChest);
    const dmg = damageAt(def, part, dist) * (targetC.armor ? 0.55 : 1);
    applyDamage(bot.combatant, targetC, dmg, part);
  } else {
    hitPoint.set(
      targetChest.x + (rng() * 2 - 1) * 1.6,
      targetChest.y + (rng() * 2 - 1) * 0.9,
      targetChest.z + (rng() * 2 - 1) * 1.6,
    );
    effects.tracer(botMuzzle, hitPoint);
  }
}

// --- grenades ---------------------------------------------------------------
const throwDir = new THREE.Vector3();
function throwGrenade(kind) {
  if (grenades[kind] <= 0 || !playerC.alive) return;
  const phase = rounds.state.phase;
  if (phase !== 'live' && phase !== 'planted') return;
  grenades[kind] -= 1;
  syncCamera();
  camera.getWorldDirection(throwDir);
  const from = new THREE.Vector3().copy(camera.position).addScaledVector(throwDir, 0.4);
  effects.throwGrenade(from, throwDir.clone(), kind, (k, pos) => detonate(k, pos, playerC));
  audio.throwWhoosh();
}

const blastCenter = new THREE.Vector3();
function detonate(kind, pos, sourceC) {
  const phase = rounds.state.phase;
  if (kind === 'flash') {
    effects.explosion(new THREE.Vector3(pos.x, pos.y + 0.4, pos.z), false);
    audio.flash();
    for (const c of combatants) {
      if (!c.alive || c === sourceC) continue;
      const cp = c.bodyState.position;
      const dist = Math.hypot(cp.x - pos.x, cp.z - pos.z);
      if (dist > 24) continue;
      blastCenter.set(cp.x, cp.y + 1.4, cp.z);
      if (!world.losClear(new THREE.Vector3(pos.x, pos.y + 0.4, pos.z), blastCenter)) continue;
      const fx = -Math.sin(c.bodyState.yaw);
      const fz = -Math.cos(c.bodyState.yaw);
      const dot = ((pos.x - cp.x) * fx + (pos.z - cp.z) * fz) / (dist || 1);
      if (dot < 0.3) continue;
      if (c.isPlayer) hud.white(0.35 + dot * 0.6);
      else if (c.bot) c.bot.blindUntil = simTime + 1.6 + dot * 2.2;
    }
    return;
  }
  effects.explosion(new THREE.Vector3(pos.x, pos.y + 0.4, pos.z), true);
  audio.explosion();
  botsApi.hearNoise(pos.x, pos.z);
  const distToPlayer = Math.hypot(player.state.position.x - pos.x, player.state.position.z - pos.z);
  if (distToPlayer < 12) shakeT = Math.max(shakeT, 0.3);
  if (phase !== 'live' && phase !== 'planted') return;
  for (const c of combatants) {
    if (!c.alive || c.team === sourceC.team) continue;
    const cp = c.bodyState.position;
    const dist = Math.hypot(cp.x - pos.x, cp.z - pos.z);
    if (dist > 5.5) continue;
    blastCenter.set(cp.x, cp.y + 1.0, cp.z);
    const covered = world.losClear(new THREE.Vector3(pos.x, pos.y + 0.35, pos.z), blastCenter);
    const dmg = (82 * Math.max(0, 1 - dist / 5.5) + 5) * (covered ? 1 : 0.45) * (c.armor ? 0.6 : 1);
    applyDamage(sourceC, c, dmg, 'torso');
  }
}

// --- buy menu -----------------------------------------------------------------
const BUY_ITEMS = [
  ['Digit1', 'smg', () => WEAPONS.smg],
  ['Digit2', 'rifle', () => WEAPONS.rifle],
  ['Digit3', 'shotgun', () => WEAPONS.shotgun],
  ['Digit4', 'sniper', () => WEAPONS.sniper],
];
function buyRow(key, label, price, owned) {
  const cls = owned ? 'owned' : rounds.state.money < price ? 'cant' : '';
  const tag = owned ? 'OWNED' : `$${price}`;
  return `<div class="buy-row ${cls}"><span>${key} · ${label}</span><span class="price">${tag}</span></div>`;
}
function refreshBuyPanel() {
  const rows = [];
  let n = 0;
  for (const [, key, get] of BUY_ITEMS) {
    n += 1;
    rows.push(buyRow(n, get().name, get().price, arsenal.has(key)));
  }
  rows.push(buyRow(5, 'HE grenade', GRENADE_PRICES.he, grenades.he > 0));
  rows.push(buyRow(6, 'Flash grenade', GRENADE_PRICES.flash, grenades.flash > 0));
  rows.push(buyRow(7, 'Armour vest', ARMOR_PRICE, playerC.armor));
  const sig = rows.join('|') + rounds.state.money;
  if (sig === buySignature) return;
  buySignature = sig;
  hud.showBuy(rows.join(''));
}
function tryBuy(tapped) {
  const map = { Digit1: 'smg', Digit2: 'rifle', Digit3: 'shotgun', Digit4: 'sniper' };
  for (const code of Object.keys(map)) {
    if (!tapped.has(code)) continue;
    const key = map[code];
    if (!arsenal.has(key) && rounds.spend(WEAPONS[key].price)) {
      arsenal.give(key);
      arsenal.select(key);
    }
  }
  if (tapped.has('Digit5') && grenades.he === 0 && rounds.spend(GRENADE_PRICES.he)) grenades.he = 1;
  if (tapped.has('Digit6') && grenades.flash === 0 && rounds.spend(GRENADE_PRICES.flash)) grenades.flash = 1;
  if (tapped.has('Digit7') && !playerC.armor && rounds.spend(ARMOR_PRICE)) playerC.armor = true;
}
function trySelect(tapped) {
  const primaries = ['rifle', 'sniper', 'smg', 'shotgun'].filter((k) => arsenal.has(k));
  if (tapped.has('Digit1')) arsenal.select('pistol');
  if (tapped.has('Digit2') && primaries[0]) arsenal.select(primaries[0]);
  if (tapped.has('Digit3') && primaries[1]) arsenal.select(primaries[1]);
  if (tapped.has('KeyQ')) {
    const owned = arsenal.ownedKeys();
    const next = owned[(owned.indexOf(arsenal.current) + 1) % owned.length];
    if (next) arsenal.select(next);
  }
}

// --- channels: plant and defuse ------------------------------------------------
function stepChannels(dt) {
  const phase = rounds.state.phase;
  // The player plants with E, anywhere inside Site K.
  if (phase === 'live' && playerC.alive && inSite(player.state.position.x, player.state.position.z)
    && input.state.keys.has('KeyE') && player.groundSpeed() < 0.6) {
    channel.kind = 'plant';
    channel.bot = null;
    channel.t += dt;
    if (Math.floor(channel.t * 2) !== Math.floor((channel.t - dt) * 2)) audio.plantBeep(false);
    hud.setChannel('PLANTING THE CHARGE', channel.t / PLANT_TIME);
    if (channel.t >= PLANT_TIME) {
      rounds.plantBomb(player.state.position.x, player.state.position.z);
      rounds.addMoney(800);
      channel.kind = null;
      hud.setChannel(null);
    }
    return;
  }
  if (channel.kind === 'plant' && !channel.bot) { channel.kind = null; channel.t = 0; hud.setChannel(null); }

  // The squad's planter plants on arrival when the site is quiet.
  const planter = botsApi.planter();
  if (phase === 'live' && planter && planter.combatant.alive && planter.atSite
    && !planter.target && planter.mode === 'hold' && !rounds.state.bombPlanted) {
    planter.channel = 'plant';
    plantBotT += dt;
    if (plantBotT >= PLANT_TIME) {
      planter.channel = null;
      plantBotT = 0;
      planter.money += 800;
      rounds.plantBomb(planter.body.position.x, planter.body.position.z);
    }
  } else if (planter && planter.channel === 'plant') {
    planter.channel = null;
    plantBotT = 0;
  }

  // Defenders converge on the bomb and the closest one defuses.
  if (phase === 'planted') {
    const bp = rounds.state.bombPos;
    let defuser = null;
    for (const bot of botsApi.bots) {
      if (bot.team !== 'def' || !bot.combatant.alive || bot.target) continue;
      const d = Math.hypot(bot.body.position.x - bp.x, bot.body.position.z - bp.z);
      if (d > 1.7) {
        bot.bodyApi.step(dt, (bp.x - bot.body.position.x) / (d || 1), (bp.z - bot.body.position.z) / (d || 1), { speedScale: 0.9 });
      } else if (!defuser) defuser = bot;
    }
    if (defuser) {
      defuser.channel = 'defuse';
      channel.bot = defuser;
      defuseBotT += dt;
      if (defuseBotT >= DEFUSE_TIME) {
        defuser.channel = null;
        channel.bot = null;
        defuseBotT = 0;
        rounds.defuseBomb();
      }
    } else {
      defuseBotT = 0;
      if (channel.bot) { channel.bot.channel = null; channel.bot = null; }
    }
  }
}

// --- camera ----------------------------------------------------------------------
function syncCamera() {
  const body = player.state;
  if (playerC.alive) {
    camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
    camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  } else {
    deathT += FIXED_STEP;
    const mate = botsApi.bots.find((b) => b.team === 'atk' && b.combatant.alive);
    if (mate && deathT > 1.1) {
      camera.position.set(mate.body.position.x, mate.body.position.y + 1.58, mate.body.position.z);
      camera.rotation.set(0, mate.body.yaw, 0, 'YXZ');
    } else {
      camera.position.set(body.position.x, body.position.y + Math.max(0.42, body.eye - deathT * 1.4), body.position.z);
      camera.rotation.set(body.pitch - deathT * 0.25, body.yaw, deathT * 0.12, 'YXZ');
    }
  }
  if (shakeT > 0) {
    camera.position.x += (rng() * 2 - 1) * shakeT * 0.12;
    camera.position.y += (rng() * 2 - 1) * shakeT * 0.12;
  }
  const scoped = !shot && playerC.alive && input.state.aiming && arsenal.def().zoom;
  const targetFov = scoped ? 30 : 75;
  if (Math.abs(camera.fov - targetFov) > 0.4) {
    camera.fov += (targetFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
  hud.setScope(!!scoped);
  if (scoped) arsenal.setVisible(false);
  else if (playerC.alive) arsenal.setVisible(true);
}

// --- HUD sync ----------------------------------------------------------------------
const grenadeEl = document.getElementById('grenades');
let lastGrenadeText = '';
function syncHud() {
  hud.setAmmo([arsenal.mag(), arsenal.reserve(), arsenal.def().name]);
  hud.setHealth([Math.max(0, playerC.health), playerC.armor]);
  hud.setMoney(rounds.state.money);
  const s = rounds.state;
  const t = Math.ceil(s.phaseT);
  const label = s.phase === 'buy' ? `BUY ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
    : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  hud.setTimer([label, s.phaseT <= 10 && (s.phase === 'live' || s.phase === 'planted')]);
  hud.setScore(`EMBER ${s.scoreAtk} — ${s.scoreDef} HARBOUR · ROUND ${s.round}`);
  const gText = `HE ×${grenades.he} [G] · FLASH ×${grenades.flash} [F]`;
  if (gText !== lastGrenadeText) { lastGrenadeText = gText; grenadeEl.textContent = gText; }
  if (s.phase === 'buy' && started) refreshBuyPanel();
  else if (s.phase !== 'buy') hud.hideBuy();
}

// --- the fixed-step simulation ------------------------------------------------------
const input = createInput(renderer.domElement, onLockChange);
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    audio.unlock();
  } else if (started && rounds.state.phase !== 'matchover') {
    hud.showOverlay('PAUSED', 'Kestrel Yard waits. Your squad holds position.', 'Click to resume');
  }
}
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (rounds.state.phase === 'matchover') rounds.startMatch();
  input.requestLock();
});

function stepSim(dt) {
  simTime += dt;
  shakeT = Math.max(0, shakeT - dt);
  const phase = rounds.state.phase;
  const tapped = shot ? new Set() : input.takeTapped();

  if (!shot) {
    const look = input.takeLook();
    if (playerC.alive && phase !== 'matchover') player.look(look.x, look.y);
  }
  if (playerC.alive && phase !== 'matchover') player.step(dt, shot ? new Set() : input.state.keys);
  botsApi.step(dt, simTime, phase, combatants);

  if (playerC.alive && (phase === 'live' || phase === 'planted')) {
    const def = arsenal.def();
    const trigger = input.state.firing && (def.auto || !wasFiring);
    if (trigger && arsenal.ready()) playerFire();
    else if (trigger && arsenal.wantsReload()) { arsenal.reload(); audio.reload(); }
    else if (input.state.firing && !wasFiring && arsenal.state.reloadLeft === 0 && arsenal.mag() === 0) audio.dryFire();
    if (tapped.has('KeyR') && arsenal.reload()) audio.reload();
    if (tapped.has('KeyG')) throwGrenade('he');
    if (tapped.has('KeyF')) throwGrenade('flash');
    trySelect(tapped);
  }
  wasFiring = input.state.firing;
  if (phase === 'buy' && playerC.alive) tryBuy(tapped);

  arsenal.step(dt, player.groundSpeed());
  stepChannels(dt);
  effects.step(dt);
  rounds.update(dt, counts());

  if (rounds.state.bombPlanted && bombGroup.visible) {
    beepT -= dt;
    const urgent = rounds.state.phaseT < 6;
    bombLampMat.color.set(PALETTE.accent);
    bombLamp.visible = Math.sin(simTime * (urgent ? 22 : 7)) > -0.2;
    if (beepT <= 0) { audio.plantBeep(urgent); beepT = urgent ? 0.28 : 0.9; }
  }
  syncCamera();
  syncHud();
}

// --- shot staging (deterministic screenshots) -----------------------------------------
function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}
function settle(steps) {
  for (let i = 0; i < steps; i += 1) stepSim(FIXED_STEP);
}
function stageShot(name) {
  started = true;
  rounds.startMatch();
  if (name === 'start') {
    player.teleport(0, 10, Math.PI);
    settle(24);
    hud.showOverlay('Kestrel Yard', 'You lead Ember Squad: plant the charge at Site K or eliminate Harbour Watch. First to 7 rounds takes the yard.', 'Click to play');
    refreshBuyPanel();
    syncCamera();
  } else if (name === 'play') {
    hud.hideOverlay();
    arsenal.give('rifle');
    arsenal.select('rifle');
    playerC.armor = true;
    rounds.state.phase = 'live';
    rounds.state.phaseT = 76;
    player.teleport(2.5, 5.5, 0);
    const defs = botsApi.bots.filter((b) => b.team === 'def');
    defs[0].bodyApi.teleport(-1, -5, Math.PI);
    defs[0].combatant.health = 30;
    defs[0].mode = 'hold';
    defs[0].scanYaw = Math.PI;
    defs[1].bodyApi.teleport(7.5, 0.5, Math.PI * 0.82);
    defs[1].mode = 'hold';
    defs[1].scanYaw = Math.PI * 0.82;
    const rook = botsApi.bots[0];
    rook.bodyApi.teleport(0.2, 7.5, 0);
    rook.mode = 'hold';
    const chestOf = (bot) => new THREE.Vector3(bot.body.position.x, bot.body.position.y + 1.18, bot.body.position.z);
    settle(4);
    aimAt(chestOf(defs[0]));
    playerFire();
    settle(6);
    aimAt(chestOf(defs[0]));
    playerFire();
    settle(6);
    aimAt(chestOf(defs[0]));
    playerFire();
    settle(12);
    aimAt(chestOf(defs[1]));
    playerFire();
    settle(3);
    hud.banner('CONTACT — MID LANE', 'Harbour Watch is shooting back', 60000);
  } else {
    hud.hideOverlay();
    rounds.state.scoreAtk = 4;
    rounds.state.scoreDef = 3;
    rounds.state.round = 9;
    rounds.state.phase = 'live';
    rounds.state.phaseT = 60;
    rounds.plantBomb(0.5, -20);
    rounds.state.phaseT = 4.2;
    for (const bot of botsApi.bots) {
      if (bot.team === 'def') { bot.combatant.health = 0; bot.combatant.alive = false; }
    }
    player.teleport(0, -11.5, 0);
    settle(36);
    hud.banner('SITE SECURED', 'Ember takes the round · Ember 5 — 3 Harbour', 60000);
    aimAt(new THREE.Vector3(0.5, 0.7, -20));
  }
  syncHud();
  paintTwiceThenReady();
}
function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// --- the frame loop ---------------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (started || shot) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        stepSim(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    syncCamera();
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

rounds.startMatch();
syncCamera();
if (shot) stageShot(shot);
else requestAnimationFrame(frame);
