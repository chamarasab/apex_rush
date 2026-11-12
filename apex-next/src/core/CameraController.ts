import * as THREE from 'three';
import { clamp, damp, wrapPi } from './config';
import type { Car } from '../cars/Car';

export class CameraController {
  readonly cam: THREE.PerspectiveCamera;
  mode = 0;
  h = 0;
  fov = 62;
  shake = 0;
  readonly names = ['Dynamic Chase', 'Bumper / Hood', 'Cinematic Far', 'Top-Down'];

  // Showroom interactive orbit state
  orbitYaw = 0.72;
  orbitPitch = 0.24;
  orbitDist = 7.4;
  autoSpin = true;
  private dragIdleTimer = 0;

  private _v = new THREE.Vector3();
  private _l = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.cam = camera;
  }

  next(): string {
    this.mode = (this.mode + 1) % this.names.length;
    return this.names[this.mode];
  }

  snap(car: Car): void {
    this.h = car.h;
  }

  dragOrbit(dx: number, dy: number): void {
    this.orbitYaw -= dx * 0.0075;
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.005, 0.06, 0.85);
    this.autoSpin = false;
    this.dragIdleTimer = 3.5;
  }

  updateShowroom(car: Car, dt: number): void {
    if (this.dragIdleTimer > 0) {
      this.dragIdleTimer -= dt;
      if (this.dragIdleTimer <= 0) this.autoSpin = true;
    }
    if (this.autoSpin) {
      this.orbitYaw += dt * 0.26;
    }

    const p = car.mesh.position;
    const ch = Math.cos(this.orbitPitch);
    const sh = Math.sin(this.orbitPitch);
    const r = this.orbitDist;
    this.cam.up.set(0, 1, 0);
    this.cam.position.set(
      p.x + Math.cos(this.orbitYaw) * ch * r,
      p.y + 0.9 + sh * r,
      p.z + Math.sin(this.orbitYaw) * ch * r
    );
    this.cam.lookAt(p.x, p.y + 0.65, p.z);
    if (Math.abs(this.cam.fov - 48) > 0.05) {
      this.cam.fov = damp(this.cam.fov, 48, 8, dt);
      this.cam.updateProjectionMatrix();
    }
  }

  update(car: Car, dt: number): void {
    const cam = this.cam;
    const p = car.mesh.position;
    const ratio = clamp(Math.abs(car.speed) / car.spec.top, 0, 1.35);
    const nosBoost = car.nosActive ? 1 : 0;
    let fovT = 62;
    cam.up.set(0, 1, 0);

    if (this.mode === 0) {
      // Dynamic Chase: swings behind drift tail + widens on NOS
      this.h += wrapPi(car.renderH - this.h) * (1 - Math.exp(-6.2 * dt));
      const dist = 6.5 + ratio * 2.5 + nosBoost * 0.8;
      const height = 2.4 + ratio * 0.45;
      const sh = Math.sin(this.h);
      const ch = Math.cos(this.h);
      cam.position.set(p.x - sh * dist, p.y + height, p.z - ch * dist);
      this._l.set(p.x + sh * 4.5, p.y + 1.05, p.z + ch * 4.5);
      fovT = 60 + ratio * 18 + nosBoost * 10;
    } else if (this.mode === 1) {
      // Hood / Bumper Cam
      car.mesh.updateMatrixWorld();
      cam.position.copy(car.mesh.localToWorld(this._v.set(0, car.spec.hoodCam[0], car.spec.hoodCam[1])));
      car.mesh.localToWorld(this._l.set(0, 0.9, 15));
      this.h = car.renderH;
      fovT = 72 + ratio * 14 + nosBoost * 9;
    } else if (this.mode === 2) {
      // Far Cinematic Chase
      this.h += wrapPi(car.renderH - this.h) * (1 - Math.exp(-4.5 * dt));
      const dist = 9.4 + ratio * 3.0 + nosBoost * 1.1;
      const height = 3.5 + ratio * 0.6;
      const sh = Math.sin(this.h);
      const ch = Math.cos(this.h);
      cam.position.set(p.x - sh * dist, p.y + height, p.z - ch * dist);
      this._l.set(p.x + sh * 5, p.y + 1.1, p.z + ch * 5);
      fovT = 58 + ratio * 16 + nosBoost * 8;
    } else {
      // Top-down arcade
      this.h += wrapPi(car.renderH - this.h) * (1 - Math.exp(-3.2 * dt));
      cam.position.set(p.x, p.y + 62 + ratio * 26, p.z);
      cam.up.set(Math.sin(this.h), 0, Math.cos(this.h));
      this._l.set(p.x + Math.sin(this.h) * 8, p.y, p.z + Math.cos(this.h) * 8);
      fovT = 55;
    }

    const totalShake = this.shake + (nosBoost ? 0.14 : 0);
    if (totalShake > 0.001) {
      const s = totalShake * 0.42;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.6);
    }

    cam.lookAt(this._l);
    this.fov = damp(this.fov, fovT, 5, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}

