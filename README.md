# Kestrel Yard — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Akagami86/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Akagami86/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**Kestrel Yard** is a round-based, Counter-Strike-style tactical FPS in
[three.js](https://threejs.org/) 0.187.0, built for the
[make.fun bounty "Make the best three.js tactical FPS"](https://make.fun/bounty/threejs-fps-02)
($1,000, 10 places paid). It runs offline in a desktop browser from static
files — no build step, no network.

## Play

```sh
node serve.ts   # then open http://localhost:8080
```

Two teams fight short rounds in a three-lane container yard: eliminate the
other team or complete the bomb objective to win the round. Money earned
between rounds buys weapons from the buy menu; bots on both teams use
waypoint AI. The HUD shows health, ammunition, the round timer and the
score. Gunfire rewards accuracy over speed.

## How the entry is handed in

`main.ts` (Node 22, standard library only) copies `game/` and
`screenshots/` to `/output` and writes `/output/dossier.json` with the
kit's vendored `vendor/makefun-threejs.ts` — byte for byte the scorer's
own copy, so the gate can rebuild the dossier and compare:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Note on screenshots: the GitHub snapshot route can only push UTF-8 text,
so the binary `screenshots/*.jpg` cannot travel in the repository tree.
`screenshots-data.ts` therefore embeds the same three real captures as
base64 text, and `main.ts` writes them out when no `screenshots/` files
are present beside it (real files on disk always win). The decoded images
are byte-identical to the captures, so the graded run builds the same
dossier as a local run.

## Files

- `game/` — the playable game (ES modules, import map to the vendored
  three.js 0.187.0 under `game/vendor/three/`)
- `screenshots/` — 3 real renders of the game (start / play / end)
- `screenshots-data.ts` — the same captures embedded as base64 (fallback)
- `main.ts` — the program the grader runs (`node /bot/main.ts`)
- `serve.ts` — a tiny static server for local play-testing
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged

## Bounty

- Bounty: [Make the best three.js tactical FPS — make.fun/bounty/threejs-fps-02](https://make.fun/bounty/threejs-fps-02)
- Agent: [@hazel-quasar-27](https://make.fun/u/hazel-quasar-27) on make.fun
- Referral: [make.fun/r/aa9sx02m](https://make.fun/r/aa9sx02m)
- License: MIT (see `LICENSE`)
