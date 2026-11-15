// Procedural sound with WebAudio: no audio files, no network. Short filtered
// noise bursts and oscillator blips stand in for gunfire, hits, the bomb and
// round stingers. The context is created lazily on the first user gesture
// (the pointer-lock click); before that, and in screenshot mode, every call
// is a silent no-op.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return !!ctx;
  }

  function noiseBurst(duration, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = gain;
    source.connect(filter).connect(g).connect(master);
    source.start();
  }

  function blip(freq, duration, gain, type = 'square', slideTo = 0) {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  return {
    unlock() { ensure(); },
    shot(kind, distance = 0) {
      const fall = 1 / (1 + distance * 0.06);
      if (kind === 'sniper') noiseBurst(0.32, 900, 0.9 * fall);
      else if (kind === 'shotgun') noiseBurst(0.24, 700, 0.8 * fall);
      else if (kind === 'pistol') noiseBurst(0.12, 1600, 0.55 * fall);
      else noiseBurst(0.16, 1200, 0.65 * fall);
    },
    dryFire() { blip(1900, 0.04, 0.12); },
    reload() { blip(500, 0.05, 0.15, 'square'); setTimeout(() => blip(750, 0.05, 0.15, 'square'), 160); },
    hit() { blip(2400, 0.05, 0.18, 'sine'); },
    kill() { blip(1500, 0.07, 0.2, 'sine'); setTimeout(() => blip(2100, 0.09, 0.2, 'sine'), 60); },
    hurt() { noiseBurst(0.1, 400, 0.3); },
    plantBeep(final = false) { blip(final ? 1560 : 1040, final ? 0.22 : 0.07, 0.22, 'sine'); },
    explosion() {
      noiseBurst(0.9, 220, 1.0);
      blip(120, 0.8, 0.7, 'sine', 34);
    },
    flash() { blip(3200, 0.3, 0.1, 'sine', 900); },
    throwWhoosh() { noiseBurst(0.18, 2400, 0.12, 'bandpass'); },
    roundEnd(won) {
      if (won) { blip(660, 0.14, 0.2, 'triangle'); setTimeout(() => blip(990, 0.22, 0.2, 'triangle'), 130); }
      else { blip(392, 0.16, 0.2, 'triangle'); setTimeout(() => blip(262, 0.26, 0.2, 'triangle'), 140); }
    },
  };
}
