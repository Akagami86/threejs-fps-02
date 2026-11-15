// Bodies and the player. One physics body serves the human and every bot:
// acceleration, friction, gravity, crouch and a small jump, resolved as a
// box against the world's colliders one axis at a time, so a wall never
// swallows a body and a crate top is a floor you can stand on. The player
// wrapper adds mouse look, recoil and WASD wish-direction on top.
import * as THREE from 'three';

export const RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const STAND_EYE = 1.6;
export const CROUCH_EYE = 1.02;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.0;

export function createBody(colliders, x = 0, z = 0) {
  const body = {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    speed: 5.0,
  };
  const probe = new THREE.Box3();

  // lift keeps the feet and the crown out of the horizontal tests, so
  // standing on the floor is not read as walking into a wall.
  function overlaps(px, py, pz, height, lift) {
    probe.min.set(px - RADIUS, py + lift, pz - RADIUS);
    probe.max.set(px + RADIUS, py + height - lift, pz + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function setCrouch(want) {
    if (want && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!want && body.crouching
      && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * 0.35;
  }

  // wishX/wishZ: desired direction in world space (any length; normalised
  // here when non-zero). speedScale trims bots and wounded movement.
  function step(dt, wishX, wishZ, opts = {}) {
    setCrouch(!!opts.crouch);
    const speed = body.speed * (opts.speedScale ?? 1) * (body.crouching ? 0.48 : 1);
    const len = Math.hypot(wishX, wishZ);
    const wx = len > 0.001 ? (wishX / len) : 0;
    const wz = len > 0.001 ? (wishZ / len) : 0;
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / Math.max(speed, 0.01));
    if (len > 0.001) {
      body.velocity.x += (wx * speed - body.velocity.x) * blend;
      body.velocity.z += (wz * speed - body.velocity.z) * blend;
    } else if (body.onGround) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (opts.jump && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  function teleport(x, z, yaw) {
    body.position.set(x, 0, z);
    body.velocity.set(0, 0, 0);
    body.yaw = yaw;
    body.pitch = 0;
    body.crouching = false;
    body.height = STAND_HEIGHT;
    body.eye = STAND_EYE;
  }

  return {
    state: body,
    step,
    teleport,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
  };
}

export function createPlayer(colliders, x, z) {
  const inner = createBody(colliders, x, z);
  const body = inner.state;

  function look(dx, dy, sensitivity = 0.0021) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(body.yaw);
    const cos = Math.cos(body.yaw);
    inner.step(dt, -sin * forward + cos * strafe, -cos * forward - sin * strafe, {
      crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'),
      jump: keys.has('Space'),
    });
  }

  return { state: body, step, look, recoil, teleport: inner.teleport, groundSpeed: inner.groundSpeed };
}
