// Kestrel Yard look plan: a container yard at dusk. Warm sodium light against
// deep blue shadow, rust-red and harbour-teal containers, one signal-orange
// accent reserved for the player's team, the bomb and danger feedback.
// Every colour in the game (3D materials and the CSS in index.html) comes
// from this table, so the whole scene grades as one photograph.
export const PALETTE = {
  canvas: '#171a21', // dusk sky / page background
  surface: '#232833', // asphalt and dark steel
  hairline: '#39414f', // mid steel, crates, barriers
  ink: '#ece7da', // warm white: text, lit concrete
  muted: '#8d97a5', // cool grey: secondary text, defender trim
  accent: '#f0762a', // signal orange: attacker team, bomb, alerts
  teal: '#2e8f86', // harbour teal: defender team
  rust: '#a4442f', // container red-brown
  sand: '#c8b083', // container tan / site paint
  moss: '#5d7350', // container green
};

export function shade(name) {
  return PALETTE[name];
}
