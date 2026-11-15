// Transient visuals, all pooled: tracers, impact sparks, thrown grenades,
// explosions and smoke. Nothing here allocates in the frame loop — pools
// are built once and recycled — and nothing here decides damage: a grenade
// reports its resting place and fuse through a callback and main.js works
// out who it hurts. Grenades bounce off the world's boxes with a cheap
// point-versus-expanded-box test per axis.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 28;
const SPARKS = 16;
const GRENADES = 6;

export function createEffects(scene, colliders) {
  const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#ffd9a0'), transparent: true, opacity: 0.85 });
  const tracers = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIdx = 0;

  const sparkGeo = new THREE.SphereGeometry(0.07, 6, 5);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true });
  const sparks = [];
  for (let i = 0; i < SPARKS; i += 1) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0 });
  }
  let sparkIdx = 0;

  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 18, 1.6);
  scene.add(boomLight);
  const boomMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb36b'), transparent: true, opacity: 0 }),
  );
  boomMesh.visible = false;
  scene.add(boomMesh);
  const smokes = [];
  const smokeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0 });
  for (let i = 0; i < 5; i += 1) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), smokeMat.clone());
    puff.visible = false;
    scene.add(puff);
    smokes.push({ mesh: puff, life: 0, seed: i * 1.37 });
  }
  let boomLife = 0;

  const grenadeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const grenades = [];
  for (let i = 0; i < GRENADES; i += 1) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.3 });
    const mesh = new THREE.Mesh(grenadeGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, vel: new THREE.Vector3(), kind: 'he', fuse: 0, active: false });
  }

  const tmp = new THREE.Vector3();

  function insideSolid(x, y, z, r) {
    for (const box of colliders) {
      if (x > box.min.x - r && x < box.max.x + r && y > box.min.y - r && y < box.max.y + r && z > box.min.z - r && z < box.max.z + r) return true;
    }
    return false;
  }

  return {
    tracer(from, to) {
      const t = tracers[tracerIdx];
      tracerIdx = (tracerIdx + 1) % TRACERS;
      const pos = t.line.geometry.attributes.position;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      t.line.visible = true;
      t.life = 0.07;
    },
    spark(point) {
      const s = sparks[sparkIdx];
      sparkIdx = (sparkIdx + 1) % SPARKS;
      s.mesh.position.copy(point);
      s.mesh.scale.setScalar(1);
      s.mesh.material.opacity = 0.95;
      s.mesh.visible = true;
      s.life = 0.16;
    },
    explosion(point, big = true) {
      boomMesh.position.copy(point);
      boomMesh.scale.setScalar(big ? 1.2 : 0.6);
      boomMesh.material.opacity = 0.85;
      boomMesh.visible = true;
      boomLight.position.copy(point).y += 1;
      boomLight.intensity = big ? 260 : 90;
      boomLife = 0.38;
      for (const puff of smokes) {
        puff.mesh.position.set(point.x + Math.sin(puff.seed) * 1.4, point.y + 0.8 + (puff.seed % 1), point.z + Math.cos(puff.seed) * 1.4);
        puff.mesh.scale.setScalar(0.8);
        puff.mesh.material.opacity = 0.34;
        puff.mesh.visible = true;
        puff.life = 1.4 + (puff.seed % 0.7);
      }
    },
    throwGrenade(from, dir, kind, onDetonate) {
      const g = grenades.find((x) => !x.active) ?? grenades[0];
      g.active = true;
      g.kind = kind;
      g.fuse = kind === 'flash' ? 1.1 : 1.5;
      g.onDetonate = onDetonate;
      g.mesh.material.color.set(kind === 'flash' ? PALETTE.ink : PALETTE.accent);
      g.mesh.position.copy(from);
      g.vel.copy(dir).multiplyScalar(15.5);
      g.vel.y += 4.2;
      g.mesh.visible = true;
    },
    activeGrenades() { return grenades.filter((g) => g.active); },
    step(dt) {
      for (const t of tracers) {
        if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.visible = false; }
      }
      for (const s of sparks) {
        if (s.life > 0) {
          s.life -= dt;
          s.mesh.scale.multiplyScalar(1 + dt * 9);
          s.mesh.material.opacity = Math.max(0, s.life / 0.16) * 0.95;
          if (s.life <= 0) s.mesh.visible = false;
        }
      }
      if (boomLife > 0) {
        boomLife -= dt;
        const k = Math.max(0, boomLife / 0.38);
        boomMesh.scale.multiplyScalar(1 + dt * 14);
        boomMesh.material.opacity = k * 0.85;
        boomLight.intensity *= Math.max(0, 1 - dt * 9);
        if (boomLife <= 0) { boomMesh.visible = false; boomLight.intensity = 0; }
      }
      for (const puff of smokes) {
        if (puff.life > 0) {
          puff.life -= dt;
          puff.mesh.scale.multiplyScalar(1 + dt * 1.5);
          puff.mesh.position.y += dt * 0.7;
          puff.mesh.material.opacity = Math.min(0.34, puff.life * 0.3);
          if (puff.life <= 0) puff.mesh.visible = false;
        }
      }
      for (const g of grenades) {
        if (!g.active) continue;
        g.fuse -= dt;
        g.vel.y -= 18 * dt;
        const p = g.mesh.position;
        const nx = p.x + g.vel.x * dt;
        if (!insideSolid(nx, p.y, p.z, 0.11)) p.x = nx; else g.vel.x *= -0.42;
        const nz = p.z + g.vel.z * dt;
        if (!insideSolid(p.x, p.y, nz, 0.11)) p.z = nz; else g.vel.z *= -0.42;
        const ny = p.y + g.vel.y * dt;
        if (ny < 0.11) {
          p.y = 0.11;
          g.vel.y = Math.abs(g.vel.y) > 1.4 ? -g.vel.y * 0.38 : 0;
          g.vel.x *= 0.72; g.vel.z *= 0.72;
        } else if (!insideSolid(p.x, ny, p.z, 0.11)) p.y = ny;
        else g.vel.y *= -0.42;
        g.mesh.rotation.x += dt * 7;
        if (g.fuse <= 0) {
          g.active = false;
          g.mesh.visible = false;
          tmp.copy(p);
          if (g.onDetonate) g.onDetonate(g.kind, tmp);
        }
      }
    },
  };
}
