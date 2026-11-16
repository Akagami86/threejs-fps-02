// Kestrel Yard — a round-based tactical FPS in three.js (Node 22, standard
// library only). The game is this directory's game/ folder: plain static
// files the browser loads as ES modules with three.js 0.187.0 from an
// import map, no build step and no network. This program hands the entry
// in: it copies game/ and screenshots/ from beside this file to /output
// and writes /output/dossier.json, the summary the judge reads, with the
// vendored make.fun library — byte for byte the scorer's own copy, so the
// gate can rebuild the dossier and compare.
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';
import { SCREENSHOTS } from './screenshots-data.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
// Screenshots on disk win when present. Otherwise fall back to the embedded
// copies in screenshots-data.ts: the GitHub snapshot route only pushes UTF-8
// text, so the binary screenshots/*.jpg cannot travel in the repository tree,
// and without any image buildDossier throws ("screenshots/ holds no image")
// and the graded run fails — that is what rejected round 2 (run_completes).
// The embedded copies decode to the same real captures, byte for byte.
const shotsDir = join(here, 'screenshots');
const hasShotsOnDisk =
  existsSync(shotsDir) && readdirSync(shotsDir).some((f) => /\.(png|jpe?g)$/i.test(f));
if (hasShotsOnDisk) {
  cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });
} else {
  for (const shot of SCREENSHOTS) {
    writeFileSync(join(out, 'screenshots', shot.name), Buffer.from(shot.base64, 'base64'));
  }
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all: game/ counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
