// The DOM HUD: crosshair, hit marker, health, armour, money, ammunition,
// the round clock and team score, a killfeed, centre banners, the buy
// panel, a channel bar for planting and defusing, damage and flash
// overlays, and the sniper scope. It never touches the simulation;
// main.js pushes numbers in and reads the play callback out. Updates are
// cached so identical values never touch the DOM twice.
export function createHud() {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const play = el('play');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const healthFill = el('health-fill');
  const healthNum = el('health-num');
  const armorTag = el('armor-tag');
  const money = el('money');
  const timer = el('timer');
  const scoreLine = el('score-line');
  const hitmarker = el('hitmarker');
  const feed = el('killfeed');
  const bannerBox = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const buyPanel = el('buy-panel');
  const buyRows = el('buy-rows');
  const channel = el('channel');
  const channelLabel = el('channel-label');
  const channelFill = el('channel-fill');
  const damageFlash = el('damage-flash');
  const whiteFlash = el('white-flash');
  const scope = el('scope');
  const bombTag = el('bomb-tag');

  let hitTimer = 0;
  let bannerTimer = 0;
  const cache = new Map();
  function set(key, apply) {
    return (value) => {
      if (cache.get(key) === value) return;
      cache.set(key, value);
      apply(value);
    };
  }

  return {
    setAmmo: set('ammo', ([mag, reserve, name]) => {
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      el('ammo').classList.toggle('empty', mag === 0);
    }),
    setHealth: set('health', ([hp, armor]) => {
      healthFill.style.width = `${Math.max(0, hp)}%`;
      healthFill.style.background = hp <= 30 ? 'var(--accent)' : 'var(--ink)';
      healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      armorTag.textContent = armor ? 'ARMOURED' : '';
    }),
    setMoney: set('money', (n) => { money.textContent = `$${n}`; }),
    setTimer: set('timer', ([text, urgent]) => {
      timer.textContent = text;
      timer.classList.toggle('urgent', !!urgent);
    }),
    setScore: set('score', (text) => { scoreLine.textContent = text; }),
    setBombPlanted(on) { bombTag.hidden = !on; },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed
        ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)'
        : 'translate(-50%, -50%) rotate(45deg)';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on'), holdMs);
    },
    kill(text) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.textContent = text;
      feed.prepend(row);
      while (feed.children.length > 5) feed.lastChild.remove();
      setTimeout(() => row.remove(), 4200);
    },
    banner(big, sub = '', holdMs = 2400) {
      bannerTitle.textContent = big;
      bannerSub.textContent = sub;
      bannerBox.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerBox.classList.remove('on'), holdMs);
    },
    showBuy(html) { buyRows.innerHTML = html; buyPanel.hidden = false; },
    hideBuy() { buyPanel.hidden = true; },
    setChannel(label, frac) {
      if (frac === null || frac === undefined) { channel.hidden = true; return; }
      channel.hidden = false;
      channelLabel.textContent = label;
      channelFill.style.width = `${Math.round(frac * 100)}%`;
    },
    damage() {
      damageFlash.classList.add('on');
      setTimeout(() => damageFlash.classList.remove('on'), 130);
    },
    white(strength = 1) {
      whiteFlash.style.transition = 'none';
      whiteFlash.style.opacity = String(Math.min(1, strength));
      requestAnimationFrame(() => {
        whiteFlash.style.transition = 'opacity 2.6s ease-out';
        whiteFlash.style.opacity = '0';
      });
    },
    setScope(on) { scope.hidden = !on; },
    showOverlay(big, small, action) {
      title.textContent = big;
      copy.textContent = small;
      play.textContent = action;
      overlay.hidden = false;
    },
    hideOverlay() { overlay.hidden = true; },
    overlayVisible() { return !overlay.hidden; },
    onPlay(handler) { play.addEventListener('click', handler); },
  };
}
