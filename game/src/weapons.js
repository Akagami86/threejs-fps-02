// The armoury. One table describes every gun — damage, head multiplier,
// cadence, magazine, spread standing and moving, price — and both the
// player's arsenal and the bots read it, so a bot's rifle hurts exactly
// like the player's. Accuracy is the economy of the game: spread blooms
// hard while moving, shrinks crouched, and the marksman's scope (right
// mouse) trades field of view for a near-perfect shot. The arsenal owns
// the view models: low, dark shapes with a team-orange detail, a muzzle
// flash plane and a real point light for one frame of fire.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { name: 'P9 Sidearm', price: 0, damage: 26, headMult: 3.1, interval: 0.25, auto: false, mag: 12, reserve: 48, reload: 1.25, spreadStill: 0.004, spreadMove: 0.022, pellets: 1, kick: 0.010, speedScale: 1.0 },
  smg: { name: 'Kestrel SMG', price: 1200, damage: 21, headMult: 2.6, interval: 0.075, auto: true, mag: 32, reserve: 96, reload: 1.7, spreadStill: 0.009, spreadMove: 0.038, pellets: 1, kick: 0.006, speedScale: 1.05 },
  rifle: { name: 'Longshore Rifle', price: 2700, damage: 34, headMult: 3.4, interval: 0.1, auto: true, mag: 30, reserve: 90, reload: 1.9, spreadStill: 0.002, spreadMove: 0.03, pellets: 1, kick: 0.011, speedScale: 0.97 },
  shotgun: { name: 'Breaker Shotgun', price: 1100, damage: 11, headMult: 1.8, interval: 0.85, auto: false, mag: 6, reserve: 24, reload: 2.4, spreadStill: 0.045, spreadMove: 0.06, pellets: 8, kick: 0.032, speedScale: 0.99 },
  sniper: { name: 'Harbour Marksman', price: 3400, damage: 96, headMult: 2.0, interval: 1.45, auto: false, mag: 5, reserve: 20, reload: 2.6, spreadStill: 0.0006, spreadMove: 0.07, pellets: 1, kick: 0.036, speedScale: 0.94, zoom: true },
};
export const BUY_ORDER = ['smg', 'rifle', 'shotgun', 'sniper'];
export const GRENADE_PRICES = { he: 300, flash: 200 };
export const ARMOR_PRICE = 650;

export function damageAt(def, part, distance) {
  const fall = distance > 25 ? Math.max(0.45, 1 - (distance - 25) * 0.012) : 1;
  const partMult = part === 'head' ? def.headMult : part === 'leg' ? 0.72 : 1;
  return def.damage * partMult * fall;
}

const VIEW_BUILDERS = {
  pistol(g, dark, grip, accent) {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.3), dark);
    const gripM = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), grip);
    gripM.position.set(0, -0.1, 0.08);
    g.add(slide, gripM);
  },
  smg(g, dark, grip, accent) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.44), dark);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.07), grip);
    mag.position.set(0, -0.14, -0.02);
    const can = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), accent);
    can.position.set(0, 0.01, -0.3);
    g.add(body, mag, can);
  },
  rifle(g, dark, grip, accent) {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.46), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.4), grip);
    barrel.position.set(0, 0.03, -0.4);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.32);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), accent);
    sight.position.set(0, 0.09, -0.05);
    g.add(receiver, barrel, stock, sight);
  },
  shotgun(g, dark, grip, accent) {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.62), dark);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.2), grip);
    pump.position.set(0, -0.03, -0.18);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.24), grip);
    stock.position.set(0, -0.02, 0.4);
    g.add(tube, pump, stock);
  },
  sniper(g, dark, grip, accent) {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.52), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.55), grip);
    barrel.position.set(0, 0.02, -0.5);
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.2), dark);
    scope.position.set(0, 0.09, 0.02);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.01), accent);
    lens.position.set(0, 0.09, -0.09);
    g.add(receiver, barrel, scope, lens);
  },
};

export function createArsenal(camera) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.45, metalness: 0.4 });
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.75, metalness: 0.15 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.2 });

  const holder = new THREE.Group();
  holder.position.set(0.24, -0.22, -0.45);
  camera.add(holder);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.19, -1.0);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.7);
  camera.add(flashLight);

  const owned = { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } };
  let current = 'pistol';
  const state = { cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bob: 0 };

  function rebuild() {
    while (holder.children.length) holder.remove(holder.children[0]);
    const g = new THREE.Group();
    VIEW_BUILDERS[current](g, dark, grip, accent);
    holder.add(g);
  }
  rebuild();

  function def() { return WEAPONS[current]; }
  function inst() { return owned[current]; }

  return {
    state,
    get current() { return current; },
    def,
    ownedKeys() { return Object.keys(owned); },
    has(key) { return !!owned[key]; },
    give(key) {
      if (!owned[key]) owned[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
      else { owned[key].mag = WEAPONS[key].mag; owned[key].reserve = WEAPONS[key].reserve; }
    },
    topUp() {
      for (const key of Object.keys(owned)) {
        owned[key].mag = WEAPONS[key].mag;
        owned[key].reserve = Math.max(owned[key].reserve, WEAPONS[key].reserve);
      }
    },
    dropToPistol() {
      for (const key of Object.keys(owned)) if (key !== 'pistol') delete owned[key];
      owned.pistol = { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve };
      current = 'pistol';
      state.reloadLeft = 0;
      rebuild();
    },
    select(key) {
      if (!owned[key] || key === current) return false;
      current = key;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.22);
      rebuild();
      return true;
    },
    mag() { return inst().mag; },
    reserve() { return inst().reserve; },
    ready() { return inst().mag > 0 && state.cooldown === 0 && state.reloadLeft === 0; },
    wantsReload() { return inst().mag === 0 && state.reloadLeft === 0 && inst().reserve > 0; },
    consume() {
      inst().mag -= 1;
      state.cooldown = def().interval;
      state.flash = 0.055;
      state.kick = Math.min(0.09, def().kick * 4.5);
    },
    reload() {
      if (state.reloadLeft > 0 || inst().mag === def().mag || inst().reserve === 0) return false;
      state.reloadLeft = def().reload;
      return true;
    },
    spread(speed, crouching, aiming) {
      const d = def();
      let s = d.spreadStill + Math.min(1, speed / 5) * (d.spreadMove - d.spreadStill);
      if (crouching) s *= 0.6;
      if (aiming && d.zoom) s *= 0.25;
      return s;
    },
    step(dt, speed) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.flash = Math.max(0, state.flash - dt);
      state.kick += (0 - state.kick) * Math.min(1, dt * 13);
      state.bob += dt * (2 + speed * 1.6);
      holder.position.z = -0.45 + state.kick;
      holder.position.y = -0.22 + Math.sin(state.bob) * 0.006 * Math.min(1, speed);
      holder.rotation.x = state.kick * 2.0;
      flash.visible = state.flash > 0;
      flash.rotation.z = state.flash * 34;
      flashLight.intensity = state.flash > 0 ? 16 : 0;
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        holder.rotation.x = -0.5 * Math.sin(Math.min(1, (def().reload - state.reloadLeft) / def().reload) * Math.PI);
        if (state.reloadLeft === 0) {
          const need = def().mag - inst().mag;
          const take = Math.min(need, inst().reserve);
          inst().mag += take;
          inst().reserve -= take;
        }
      }
    },
    setVisible(v) { holder.visible = v; if (!v) flash.visible = false; },
  };
}
