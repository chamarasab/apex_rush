import * as THREE from 'three';
import { clamp } from '../core/config';
import type { Car } from '../cars/Car';
import type { Particles } from '../fx/Particles';

interface Bolt {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  damage: number;
  ownerId: string;
  isPlayer: boolean;
  mesh: THREE.Mesh;
}

interface Rocket {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  life: number;
  ownerId: string;
  isPlayer: boolean;
  targetCar: Car | null;
  targetWorld: THREE.Vector3;
  mesh: THREE.Group;
}

interface Torpedo {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  life: number;
  ownerId: string;
  isPlayer: boolean;
  targetCar: Car | null;
  targetWorld: THREE.Vector3;
  climbTimer: number;
  lateralOffset: number;
  mesh: THREE.Group;
}

interface BlastEffect {
  active: boolean;
  age: number;
  dur: number;
  core: THREE.Mesh;
  ring: THREE.Mesh;
}

export interface CombatEvents {
  onFire: (car: Car) => void;
  onFireRocket?: (car: Car) => void;
  onFireTorpedo?: (car: Car) => void;
  onHit: (victim: Car, shooter: Car | null, damage: number) => void;
  onBlast: (victim: Car, shooter: Car | null, mode?: boolean | string) => void;
}

const BOLT_POOL_SIZE = 96;
const ROCKET_POOL_SIZE = 16;
const TORPEDO_POOL_SIZE = 12;
const BLAST_POOL_SIZE = 18;
const PLAYER_BOLT_DAMAGE = 24;
const AI_BOLT_DAMAGE = 8;

function distSqPointToSegment(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (abLenSq > 1e-6) {
    t = clamp(((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / abLenSq, 0, 1);
  }
  const cx = ax + abx * t - px;
  const cy = ay + aby * t - py;
  const cz = az + abz * t - pz;
  return cx * cx + cy * cy + cz * cz;
}

/**
 * Manages bonnet-mounted gunfire tracers, swept car hit detection,
 * AI turret targeting, and blast explosions.
 */
export class WeaponSystem {
  private readonly scene: THREE.Scene;
  private readonly bolts: Bolt[] = [];
  private readonly rockets: Rocket[] = [];
  private readonly torpedoes: Torpedo[] = [];
  private readonly blasts: BlastEffect[] = [];

  private boltGeo: THREE.BufferGeometry;
  private playerBoltMat: THREE.MeshBasicMaterial;
  private aiBoltMat: THREE.MeshBasicMaterial;
  private rocketBodyGeo: THREE.BufferGeometry;
  private rocketConeGeo: THREE.BufferGeometry;
  private rocketFinGeo: THREE.BufferGeometry;
  private rocketFlameGeo: THREE.BufferGeometry;
  private rocketMat: THREE.MeshStandardMaterial;
  private rocketWarheadMat: THREE.MeshStandardMaterial;
  private rocketFlameMat: THREE.MeshBasicMaterial;

  private torpBodyGeo: THREE.BufferGeometry;
  private torpNoseGeo: THREE.BufferGeometry;
  private torpFinGeo: THREE.BufferGeometry;
  private torpFlameGeo: THREE.BufferGeometry;
  private torpMat: THREE.MeshStandardMaterial;
  private torpWarheadMat: THREE.MeshStandardMaterial;
  private torpFlameMat: THREE.MeshBasicMaterial;

  private blastCoreGeo: THREE.BufferGeometry;
  private blastRingGeo: THREE.BufferGeometry;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private _muzzlePos = new THREE.Vector3();
  private _muzzleTipLocal = new THREE.Vector3(0, 0.004, 1.67);
  private _rocketMuzzlePos = new THREE.Vector3();
  private _rocketTipLocal = new THREE.Vector3(0, 0.06, 1.38);
  private _torpMuzzlePos = new THREE.Vector3();
  private _fwdTarget = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _localAim = new THREE.Vector3();
  private _quat = new THREE.Quaternion();
  private _lookDir = new THREE.Vector3(0, 0, 1);
  private _toCar = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Orient bolt cylinder along +Z for clean quaternion alignment
    this.boltGeo = new THREE.CylinderGeometry(0.065, 0.055, 2.8, 6);
    this.boltGeo.rotateX(Math.PI / 2);

    this.playerBoltMat = new THREE.MeshBasicMaterial({
      color: 0xffd24d,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.aiBoltMat = new THREE.MeshBasicMaterial({
      color: 0xff5136,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    for (let i = 0; i < BOLT_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(this.boltGeo, this.playerBoltMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.bolts.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        damage: PLAYER_BOLT_DAMAGE,
        ownerId: '',
        isPlayer: false,
        mesh,
      });
    }

    // High-explosive Dicky/Spoiler Rocket projectile mesh parts
    this.rocketBodyGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.92, 8);
    this.rocketBodyGeo.rotateX(Math.PI / 2);
    this.rocketConeGeo = new THREE.ConeGeometry(0.082, 0.28, 8);
    this.rocketConeGeo.rotateX(Math.PI / 2);
    this.rocketFinGeo = new THREE.BoxGeometry(0.32, 0.015, 0.16);
    this.rocketFlameGeo = new THREE.ConeGeometry(0.065, 0.28, 6);
    this.rocketFlameGeo.rotateX(-Math.PI / 2);

    this.rocketMat = new THREE.MeshStandardMaterial({
      color: 0x242830,
      metalness: 0.8,
      roughness: 0.3,
    });
    this.rocketWarheadMat = new THREE.MeshStandardMaterial({
      color: 0xff1e00,
      emissive: new THREE.Color(0xd62800),
      emissiveIntensity: 0.45,
      metalness: 0.4,
      roughness: 0.25,
    });
    this.rocketFlameMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    for (let i = 0; i < ROCKET_POOL_SIZE; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(this.rocketBodyGeo, this.rocketMat);
      body.castShadow = true;
      const nose = new THREE.Mesh(this.rocketConeGeo, this.rocketWarheadMat);
      nose.position.z = 0.58;
      const finH = new THREE.Mesh(this.rocketFinGeo, this.rocketMat);
      finH.position.z = -0.36;
      const finV = new THREE.Mesh(this.rocketFinGeo, this.rocketMat);
      finV.position.z = -0.36;
      finV.rotation.z = Math.PI / 2;
      const flame = new THREE.Mesh(this.rocketFlameGeo, this.rocketFlameMat);
      flame.position.z = -0.58;

      group.add(body, nose, finH, finV, flame);
      group.visible = false;
      group.frustumCulled = false;
      scene.add(group);

      this.rockets.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        speed: 0,
        life: 0,
        ownerId: '',
        isPlayer: false,
        targetCar: null,
        targetWorld: new THREE.Vector3(),
        mesh: group,
      });
    }

    // Heavy Roof-Mounted Aerial Seeker Torpedoes (Exclusive to V8 Interceptor)
    this.torpBodyGeo = new THREE.CylinderGeometry(0.088, 0.088, 1.18, 10);
    this.torpBodyGeo.rotateX(Math.PI / 2);
    this.torpNoseGeo = new THREE.SphereGeometry(0.088, 10, 8);
    this.torpFinGeo = new THREE.BoxGeometry(0.38, 0.016, 0.22);
    this.torpFlameGeo = new THREE.ConeGeometry(0.068, 0.36, 6);
    this.torpFlameGeo.rotateX(-Math.PI / 2);

    this.torpMat = new THREE.MeshStandardMaterial({
      color: 0x16181f,
      metalness: 0.88,
      roughness: 0.25,
    });
    this.torpWarheadMat = new THREE.MeshStandardMaterial({
      color: 0xff1414,
      emissive: new THREE.Color(0xff0000),
      emissiveIntensity: 0.65,
      metalness: 0.3,
      roughness: 0.2,
    });
    this.torpFlameMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    for (let i = 0; i < TORPEDO_POOL_SIZE; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(this.torpBodyGeo, this.torpMat);
      body.castShadow = true;
      const nose = new THREE.Mesh(this.torpNoseGeo, this.torpWarheadMat);
      nose.position.z = 0.59;
      const finH = new THREE.Mesh(this.torpFinGeo, this.torpMat);
      finH.position.z = -0.42;
      const finV = new THREE.Mesh(this.torpFinGeo, this.torpMat);
      finV.position.z = -0.42;
      finV.rotation.z = Math.PI / 2;
      const flame = new THREE.Mesh(this.torpFlameGeo, this.torpFlameMat);
      flame.position.z = -0.72;

      group.add(body, nose, finH, finV, flame);
      group.visible = false;
      group.frustumCulled = false;
      scene.add(group);

      this.torpedoes.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        speed: 0,
        life: 0,
        ownerId: '',
        isPlayer: false,
        targetCar: null,
        targetWorld: new THREE.Vector3(),
        climbTimer: 0,
        lateralOffset: 0,
        mesh: group,
      });
    }

    this.blastCoreGeo = new THREE.SphereGeometry(1, 14, 12);
    this.blastRingGeo = new THREE.RingGeometry(0.7, 1.0, 24);
    this.blastRingGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < BLAST_POOL_SIZE; i++) {
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xff7b1a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffe270,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const core = new THREE.Mesh(this.blastCoreGeo, coreMat);
      const ring = new THREE.Mesh(this.blastRingGeo, ringMat);
      core.visible = false;
      ring.visible = false;
      scene.add(core, ring);
      this.blasts.push({ active: false, age: 0, dur: 0.6, core, ring });
    }
  }

  reset(): void {
    for (const b of this.bolts) {
      b.active = false;
      b.mesh.visible = false;
    }
    for (const r of this.rockets) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const t of this.torpedoes) {
      t.active = false;
      t.mesh.visible = false;
    }
    for (const ex of this.blasts) {
      ex.active = false;
      ex.core.visible = false;
      ex.ring.visible = false;
    }
  }

  dispose(): void {
    for (const b of this.bolts) this.scene.remove(b.mesh);
    for (const r of this.rockets) this.scene.remove(r.mesh);
    for (const t of this.torpedoes) this.scene.remove(t.mesh);
    for (const ex of this.blasts) {
      this.scene.remove(ex.core, ex.ring);
      (ex.core.material as THREE.Material).dispose();
      (ex.ring.material as THREE.Material).dispose();
    }
    this.boltGeo.dispose();
    this.playerBoltMat.dispose();
    this.aiBoltMat.dispose();
    this.rocketBodyGeo.dispose();
    this.rocketConeGeo.dispose();
    this.rocketFinGeo.dispose();
    this.rocketFlameGeo.dispose();
    this.rocketMat.dispose();
    this.rocketWarheadMat.dispose();
    this.rocketFlameMat.dispose();
    this.torpBodyGeo.dispose();
    this.torpNoseGeo.dispose();
    this.torpFinGeo.dispose();
    this.torpFlameGeo.dispose();
    this.torpMat.dispose();
    this.torpWarheadMat.dispose();
    this.torpFlameMat.dispose();
    this.blastCoreGeo.dispose();
    this.blastRingGeo.dispose();
  }

  /**
   * Computes a 3D world aim point from normalized cursor coordinates (-1..1),
   * snapping softly onto a hovered rival car if under the reticle, and aims the
   * player's bonnet turret toward it.
   */
  resolvePlayerAim(
    player: Car,
    camera: THREE.Camera,
    ndcX: number,
    ndcY: number,
    cars: Car[],
    outTarget: THREE.Vector3
  ): Car | null {
    this.ndc.set(clamp(ndcX, -1, 1), clamp(ndcY, -1, 1));
    this.raycaster.setFromCamera(this.ndc, camera);
    const ray = this.raycaster.ray;

    let locked: Car | null = null;
    let bestScore = Infinity;

    for (const c of cars) {
      if (c === player || c.blasted) continue;
      this._toCar.set(c.x - ray.origin.x, c.y + 0.68 - ray.origin.y, c.z - ray.origin.z);
      const proj = this._toCar.dot(ray.direction);
      if (proj < 3 || proj > 190) continue;
      const perpSq = this._toCar.lengthSq() - proj * proj;
      const snapR = 2.6 + proj * 0.014;
      if (perpSq < snapR * snapR && perpSq < bestScore) {
        bestScore = perpSq;
        locked = c;
      }
    }

    if (locked) {
      outTarget.set(locked.x, locked.y + 0.68, locked.z);
    } else {
      const planeY = player.y + 0.65;
      if (ray.direction.y < -0.015) {
        const t = (planeY - ray.origin.y) / ray.direction.y;
        if (t > 6 && t < 200) {
          outTarget.copy(ray.origin).addScaledVector(ray.direction, t);
        } else {
          outTarget.copy(ray.origin).addScaledVector(ray.direction, 115);
        }
      } else {
        outTarget.copy(ray.origin).addScaledVector(ray.direction, 115);
      }
    }

    this.aimCarAtWorld(player, outTarget);
    return locked;
  }

  aimCarAtWorld(car: Car, worldPt: THREE.Vector3): void {
    car.rig.turretRoot.updateMatrixWorld(true);
    this._localAim.copy(worldPt);
    car.rig.turretRoot.worldToLocal(this._localAim);
    const horiz = Math.hypot(this._localAim.x, this._localAim.z);
    if (horiz < 0.25) return;
    car.targetGunYaw = clamp(Math.atan2(this._localAim.x, this._localAim.z), -2.45, 2.45);
    car.targetGunPitch = clamp(Math.atan2(this._localAim.y - 0.10, horiz), -0.14, 0.44);
  }

  spawnExplosion(x: number, y: number, z: number, particles: Particles, scale = 1): void {
    const slot = this.blasts.find(e => !e.active) || this.blasts[0];
    slot.active = true;
    slot.age = 0;
    slot.dur = 0.65 * scale;
    slot.core.position.set(x, y + 0.65, z);
    slot.ring.position.set(x, y + 0.14, z);
    slot.core.scale.setScalar(0.6);
    slot.ring.scale.setScalar(0.8);
    slot.core.visible = true;
    slot.ring.visible = true;

    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (4 + Math.random() * 17) * scale;
      particles.spawn(
        x + (Math.random() - 0.5) * 1.1,
        y + 0.5 + Math.random() * 0.7,
        z + (Math.random() - 0.5) * 1.1,
        Math.cos(a) * sp,
        3.5 + Math.random() * 12,
        Math.sin(a) * sp,
        0.45 + Math.random() * 0.45,
        (1.6 + Math.random() * 1.4) * scale,
        1.0,
        0.38 + Math.random() * 0.48,
        0.08,
        3.8,
        0.9
      );
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 7;
      particles.spawn(
        x + (Math.random() - 0.5) * 1.4,
        y + 0.7 + Math.random() * 0.8,
        z + (Math.random() - 0.5) * 1.4,
        Math.cos(a) * sp,
        2.5 + Math.random() * 6,
        Math.sin(a) * sp,
        0.85 + Math.random() * 0.6,
        2.4 * scale,
        0.16,
        0.16,
        0.18,
        4.2,
        0.65
      );
    }
  }

  private fireFromCar(car: Car, targetWorld: THREE.Vector3 | null, ev: CombatEvents): void {
    const muzzles = car.rig.isTwin && car.rig.muzzlePoint2
      ? [car.rig.muzzlePoint, car.rig.muzzlePoint2]
      : [car.rig.muzzlePoint];

    for (const mPoint of muzzles) {
      const slot = this.bolts.find(b => !b.active);
      if (!slot) break;

      car.mesh.updateMatrixWorld(true);
      mPoint.getWorldPosition(this._muzzlePos);
      car.rig.turretRecoil.localToWorld(this._fwdTarget.copy(this._muzzleTipLocal));
      const barrelDir = this._dir.copy(this._fwdTarget).sub(this._muzzlePos).normalize();

      if (targetWorld) {
        const toTgt = this._fwdTarget.copy(targetWorld).sub(this._muzzlePos);
        const len = toTgt.length();
        if (len > 2.5) {
          toTgt.multiplyScalar(1 / len);
          if (toTgt.dot(barrelDir) > 0.88) {
            barrelDir.copy(toTgt);
          }
        }
      }

      const boltSpd = Math.max(270, Math.abs(car.speed) + 215);
      slot.active = true;
      slot.x = this._muzzlePos.x;
      slot.y = this._muzzlePos.y;
      slot.z = this._muzzlePos.z;
      slot.vx = barrelDir.x * boltSpd;
      slot.vy = barrelDir.y * boltSpd;
      slot.vz = barrelDir.z * boltSpd;
      slot.life = 0.72;
      slot.damage = car.isPlayer ? PLAYER_BOLT_DAMAGE : AI_BOLT_DAMAGE;
      slot.ownerId = car.id;
      slot.isPlayer = car.isPlayer;

      slot.mesh.material = car.isPlayer ? this.playerBoltMat : this.aiBoltMat;
      slot.mesh.position.set(slot.x, slot.y, slot.z);
      this._quat.setFromUnitVectors(this._lookDir, barrelDir);
      slot.mesh.quaternion.copy(this._quat);
      slot.mesh.visible = true;
    }

    car.gunRecoil = 0.09;
    car.muzzleFlashT = 0.055;
    car.fireCd = car.isPlayer ? 0.115 : 0.19;
    ev.onFire(car);
  }

  fireRocketFromCar(
    car: Car,
    targetWorld: THREE.Vector3 | null,
    lockedCar: Car | null,
    ev: CombatEvents,
    particles: Particles
  ): void {
    const slot = this.rockets.find(r => !r.active);
    if (!slot) return;

    car.mesh.updateMatrixWorld(true);
    car.rig.rocketMuzzlePoint.getWorldPosition(this._rocketMuzzlePos);
    car.rig.rocketLauncherPitch.localToWorld(this._fwdTarget.copy(this._rocketTipLocal));
    const launchDir = this._dir.copy(this._fwdTarget).sub(this._rocketMuzzlePos).normalize();

    if (lockedCar) {
      this._fwdTarget.set(lockedCar.x, lockedCar.y + 0.65, lockedCar.z).sub(this._rocketMuzzlePos);
      const len = this._fwdTarget.length();
      if (len > 3) {
        this._fwdTarget.multiplyScalar(1 / len);
        if (this._fwdTarget.dot(launchDir) > 0.65) {
          launchDir.copy(this._fwdTarget);
        }
      }
    } else if (targetWorld) {
      this._fwdTarget.copy(targetWorld).sub(this._rocketMuzzlePos);
      const len = this._fwdTarget.length();
      if (len > 3) {
        this._fwdTarget.multiplyScalar(1 / len);
        if (this._fwdTarget.dot(launchDir) > 0.65) {
          launchDir.copy(this._fwdTarget);
        }
      }
    }

    const initSpd = Math.max(92, Math.abs(car.speed) + 75);
    slot.active = true;
    slot.x = this._rocketMuzzlePos.x;
    slot.y = this._rocketMuzzlePos.y;
    slot.z = this._rocketMuzzlePos.z;
    slot.vx = launchDir.x * initSpd;
    slot.vy = launchDir.y * initSpd;
    slot.vz = launchDir.z * initSpd;
    slot.speed = initSpd;
    slot.life = 2.8;
    slot.ownerId = car.id;
    slot.isPlayer = car.isPlayer;
    slot.targetCar = lockedCar;
    if (targetWorld) slot.targetWorld.copy(targetWorld);
    else slot.targetWorld.copy(this._rocketMuzzlePos).addScaledVector(launchDir, 120);

    slot.mesh.position.set(slot.x, slot.y, slot.z);
    this._quat.setFromUnitVectors(this._lookDir, launchDir);
    slot.mesh.quaternion.copy(this._quat);
    slot.mesh.visible = true;

    car.rocketCd = car.isPlayer ? 2.4 : 4.5;
    car.rocketBackblastT = 0.15;

    // Launch backblast fiery smoke plume behind the vehicle launcher
    for (let i = 0; i < 9; i++) {
      particles.spawn(
        this._rocketMuzzlePos.x - launchDir.x * 0.75 + (Math.random() - 0.5) * 0.35,
        this._rocketMuzzlePos.y + (Math.random() - 0.5) * 0.25,
        this._rocketMuzzlePos.z - launchDir.z * 0.75 + (Math.random() - 0.5) * 0.35,
        -launchDir.x * (6 + Math.random() * 8) + (Math.random() - 0.5) * 2.8,
        1.2 + Math.random() * 3.2,
        -launchDir.z * (6 + Math.random() * 8) + (Math.random() - 0.5) * 2.8,
        0.35 + Math.random() * 0.25,
        1.2,
        1.0,
        0.52,
        0.14,
        2.8,
        0.82
      );
    }

    ev.onFireRocket?.(car);
  }

  fireTwinTorpedoesFromCar(
    car: Car,
    targetWorld: THREE.Vector3 | null,
    lockedCar: Car | null,
    ev: CombatEvents,
    particles: Particles
  ): void {
    if (car.type !== 'interceptor' || car.torpedoCd > 0) return;

    car.mesh.updateMatrixWorld(true);
    const muzzles = car.rig.roofTorpedoMuzzles;
    if (!muzzles || muzzles.length < 2) return;

    car.torpedoCd = car.isPlayer ? 4.8 : 7.0;
    car.roofTorpedoBackblastT = 0.22;

    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.mesh.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(car.mesh.quaternion);
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < 2; i++) {
      const slot = this.torpedoes.find(t => !t.active);
      if (!slot) break;

      const muzzle = muzzles[i];
      muzzle.getWorldPosition(this._torpMuzzlePos);

      const latSign = i === 0 ? -1 : 1;
      // Launch arcs upward into the sky and fans slightly outward
      const launchDir = new THREE.Vector3()
        .copy(fwd)
        .addScaledVector(right, latSign * 0.18)
        .addScaledVector(up, 0.42)
        .normalize();

      const initSpd = Math.max(92, Math.abs(car.speed) + 74);
      slot.active = true;
      slot.x = this._torpMuzzlePos.x;
      slot.y = this._torpMuzzlePos.y;
      slot.z = this._torpMuzzlePos.z;
      slot.vx = launchDir.x * initSpd;
      slot.vy = launchDir.y * initSpd;
      slot.vz = launchDir.z * initSpd;
      slot.speed = initSpd;
      slot.life = 4.2;
      slot.ownerId = car.id;
      slot.isPlayer = car.isPlayer;
      slot.targetCar = lockedCar;
      slot.climbTimer = 0.38;
      slot.lateralOffset = latSign * 2.2;
      if (targetWorld) slot.targetWorld.copy(targetWorld);
      else slot.targetWorld.copy(this._torpMuzzlePos).addScaledVector(fwd, 150);

      slot.mesh.position.set(slot.x, slot.y, slot.z);
      this._quat.setFromUnitVectors(this._lookDir, launchDir);
      slot.mesh.quaternion.copy(this._quat);
      slot.mesh.visible = true;

      // Heavy roof rail launch backblast
      for (let k = 0; k < 8; k++) {
        particles.spawn(
          this._torpMuzzlePos.x - fwd.x * 1.1 + (Math.random() - 0.5) * 0.25,
          this._torpMuzzlePos.y + (Math.random() - 0.5) * 0.2,
          this._torpMuzzlePos.z - fwd.z * 1.1 + (Math.random() - 0.5) * 0.25,
          -fwd.x * (8 + Math.random() * 9) + (Math.random() - 0.5) * 2.5,
          1.8 + Math.random() * 3.2,
          -fwd.z * (8 + Math.random() * 9) + (Math.random() - 0.5) * 2.5,
          0.38 + Math.random() * 0.25,
          1.4,
          0.1,
          0.85,
          0.95,
          3.2,
          0.88
        );
      }
    }

    ev.onFireTorpedo?.(car);
  }

  update(
    dt: number,
    cars: Car[],
    racing: boolean,
    playerTarget: THREE.Vector3 | null,
    lockedTarget: Car | null,
    particles: Particles,
    ev: CombatEvents
  ): void {
    const carMap = new Map<string, Car>();
    for (const c of cars) carMap.set(c.id, c);

    // 1. Handle AI turret acquisition & firing + Player firing
    if (racing) {
      for (const car of cars) {
        if (car.remote || car.blasted || car.frozen || car.race?.finished) continue;

        if (car.isPlayer) {
          if (car.input.fire && car.fireCd <= 0) {
            this.fireFromCar(car, playerTarget, ev);
          }
          if (car.input.rocket && car.rocketCd <= 0) {
            this.fireRocketFromCar(car, playerTarget, lockedTarget, ev, particles);
          }
          if (car.input.torpedo && car.type === 'interceptor' && car.torpedoCd <= 0) {
            this.fireTwinTorpedoesFromCar(car, playerTarget, lockedTarget, ev, particles);
          }
          continue;
        }

        // AI weapons: seek nearest living enemy in forward cone
        let bestTgt: Car | null = null;
        let bestDist = 78;
        const sh = Math.sin(car.h);
        const ch = Math.cos(car.h);
        for (const other of cars) {
          if (other === car || other.blasted || other.respawnProtect > 0 || other.race?.finished) continue;
          const dx = other.x - car.x;
          const dz = other.z - car.z;
          const fwd = dx * sh + dz * ch;
          const side = Math.abs(dx * ch - dz * sh);
          const dist = Math.hypot(dx, dz);
          if (fwd > 8 && dist < bestDist && side < fwd * 0.65) {
            bestDist = dist;
            bestTgt = other;
          }
        }

        if (bestTgt) {
          this._localAim.set(bestTgt.x, bestTgt.y + 0.65, bestTgt.z);
          this.aimCarAtWorld(car, this._localAim);
          if (car.aiBurstTimer > 0) {
            car.aiBurstTimer -= dt;
            if (car.fireCd <= 0) this.fireFromCar(car, this._localAim, ev);
            if (car.rocketCd <= 0 && bestDist < 60 && Math.random() < 0.28) {
              this.fireRocketFromCar(car, this._localAim, bestTgt, ev, particles);
            }
          } else {
            car.aiBurstWait -= dt;
            if (car.aiBurstWait <= 0) {
              car.aiBurstTimer = 0.42;
              car.aiBurstWait = 1.9 + Math.random() * 1.5;
            }
          }
        } else {
          car.targetGunYaw = 0;
          car.targetGunPitch = 0.02;
        }
      }
    }

    // 2. Step bullets & swept car hit detection
    const hitRadiusSq = 1.95 * 1.95;
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }

      const ax = b.x;
      const ay = b.y;
      const az = b.z;
      const bx = ax + b.vx * dt;
      const by = ay + b.vy * dt;
      const bz = az + b.vz * dt;

      let hitCar: Car | null = null;
      for (const c of cars) {
        if (c.blasted || c.id === b.ownerId) continue;
        const dSq = distSqPointToSegment(c.x, c.y + 0.68, c.z, ax, ay, az, bx, by, bz);
        if (dSq <= hitRadiusSq) {
          hitCar = c;
          break;
        }
      }

      if (hitCar) {
        b.active = false;
        b.mesh.visible = false;
        const shooter = carMap.get(b.ownerId) || null;
        this.spawnImpactSparks(hitCar.x, hitCar.y + 0.65, hitCar.z, particles);

        if (hitCar.respawnProtect <= 0 && !hitCar.remote) {
          hitCar.hp = Math.max(0, hitCar.hp - b.damage);
          hitCar.sinceHit = 0;
          hitCar.hit = Math.max(hitCar.hit, 3.2);
          ev.onHit(hitCar, shooter, b.damage);
          if (hitCar.hp <= 0) {
            this.blastCar(hitCar, shooter, particles, ev);
          }
        } else if (hitCar.respawnProtect <= 0 && shooter?.isPlayer) {
          // Visual hitmarker even against networked car pending remote damage sync
          ev.onHit(hitCar, shooter, 0);
        }
        continue;
      }

      if (by <= 0.05) {
        b.active = false;
        b.mesh.visible = false;
        this.spawnImpactSparks(bx, 0.08, bz, particles);
        continue;
      }

      b.x = bx;
      b.y = by;
      b.z = bz;
      b.mesh.position.set(bx, by, bz);
    }

    // 3. Step high-explosive Rockets: acceleration, tracking, tail flame/smoke trail & 1-hit blast
    const rocketHitRadiusSq = 2.25 * 2.25;
    for (const r of this.rockets) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.visible = false;
        this.spawnExplosion(r.x, r.y, r.z, particles, 1.25);
        continue;
      }

      // Continuous rocket motor acceleration
      r.speed = Math.min(235, r.speed + 130 * dt);
      this._dir.set(r.vx, r.vy, r.vz).normalize();

      // Soft homing toward locked rival car
      if (r.targetCar && !r.targetCar.blasted && r.targetCar.respawnProtect <= 0) {
        this._toCar.set(r.targetCar.x - r.x, r.targetCar.y + 0.65 - r.y, r.targetCar.z - r.z).normalize();
        if (this._dir.dot(this._toCar) > 0.45) {
          this._dir.lerp(this._toCar, clamp(4.8 * dt, 0, 0.45)).normalize();
        }
      }

      r.vx = this._dir.x * r.speed;
      r.vy = this._dir.y * r.speed;
      r.vz = this._dir.z * r.speed;

      const ax = r.x;
      const ay = r.y;
      const az = r.z;
      const bx = ax + r.vx * dt;
      const by = ay + r.vy * dt;
      const bz = az + r.vz * dt;

      // Fiery thruster sparks & expanding smoke plume behind rocket tail
      for (let k = 0; k < 2; k++) {
        particles.spawn(
          ax - this._dir.x * 0.45 + (Math.random() - 0.5) * 0.2,
          ay - this._dir.y * 0.45 + (Math.random() - 0.5) * 0.2,
          az - this._dir.z * 0.45 + (Math.random() - 0.5) * 0.2,
          -this._dir.x * 6 + (Math.random() - 0.5) * 2.5,
          0.8 + Math.random() * 2.5,
          -this._dir.z * 6 + (Math.random() - 0.5) * 2.5,
          0.42 + Math.random() * 0.35,
          1.6,
          1.0,
          0.42 + Math.random() * 0.4,
          0.08,
          3.2,
          0.9
        );
      }

      let hitCar: Car | null = null;
      for (const c of cars) {
        if (c.blasted || c.id === r.ownerId) continue;
        const dSq = distSqPointToSegment(c.x, c.y + 0.68, c.z, ax, ay, az, bx, by, bz);
        if (dSq <= rocketHitRadiusSq) {
          hitCar = c;
          break;
        }
      }

      if (hitCar) {
        r.active = false;
        r.mesh.visible = false;
        const shooter = carMap.get(r.ownerId) || null;
        // One Rocket Hit: Instant Obliteration & Respawn Behind!
        if (hitCar.respawnProtect <= 0 && !hitCar.remote) {
          hitCar.hp = 0;
          hitCar.sinceHit = 0;
          hitCar.hit = 4.8;
          ev.onHit(hitCar, shooter, 100);
          this.blastCar(hitCar, shooter, particles, ev, true);
        } else if (hitCar.respawnProtect <= 0 && shooter?.isPlayer) {
          ev.onHit(hitCar, shooter, 100);
        }
        continue;
      }

      if (by <= 0.05) {
        r.active = false;
        r.mesh.visible = false;
        this.spawnExplosion(bx, 0.35, bz, particles, 1.35);
        continue;
      }

      r.x = bx;
      r.y = by;
      r.z = bz;
      r.mesh.position.set(bx, by, bz);
      this._quat.setFromUnitVectors(this._lookDir, this._dir);
      r.mesh.quaternion.copy(this._quat);
    }

    // 4. Step Heavy Roof-Mounted Torpedoes: Arc climb -> Seeker Dive -> Obliteration Blast
    const torpHitRadiusSq = 2.65 * 2.65;
    for (const t of this.torpedoes) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        t.mesh.visible = false;
        this.spawnExplosion(t.x, t.y, t.z, particles, 1.8);
        continue;
      }

      // Acceleration during flight up to 260 m/s
      t.speed = Math.min(260, t.speed + 175 * dt);
      this._dir.set(t.vx, t.vy, t.vz).normalize();

      if (t.climbTimer > 0) {
        t.climbTimer -= dt;
        // In climb phase: arcs upward and fans slightly outward
        this._dir.y = Math.min(0.65, this._dir.y + 0.85 * dt);
      } else {
        // Seeker active! Aggressive homing dive on targetCar (or targetWorld)
        if (t.targetCar && !t.targetCar.blasted && t.targetCar.respawnProtect <= 0) {
          this._toCar.set(t.targetCar.x - t.x, t.targetCar.y + 0.65 - t.y, t.targetCar.z - t.z).normalize();
          this._dir.lerp(this._toCar, clamp(8.5 * dt, 0, 0.62)).normalize();
        } else if (t.targetWorld) {
          this._toCar.set(t.targetWorld.x - t.x, t.targetWorld.y + 0.65 - t.y, t.targetWorld.z - t.z).normalize();
          this._dir.lerp(this._toCar, clamp(6.2 * dt, 0, 0.45)).normalize();
        }
      }

      t.vx = this._dir.x * t.speed;
      t.vy = this._dir.y * t.speed;
      t.vz = this._dir.z * t.speed;

      const ax = t.x;
      const ay = t.y;
      const az = t.z;
      const bx = ax + t.vx * dt;
      const by = ay + t.vy * dt;
      const bz = az + t.vz * dt;

      // Cyan/plasma thruster trail & dense smoke behind torpedo
      for (let k = 0; k < 2; k++) {
        particles.spawn(
          ax - this._dir.x * 0.65 + (Math.random() - 0.5) * 0.22,
          ay - this._dir.y * 0.65 + (Math.random() - 0.5) * 0.22,
          az - this._dir.z * 0.65 + (Math.random() - 0.5) * 0.22,
          -this._dir.x * 7 + (Math.random() - 0.5) * 2.5,
          0.6 + Math.random() * 2.5,
          -this._dir.z * 7 + (Math.random() - 0.5) * 2.5,
          0.45 + Math.random() * 0.35,
          1.9,
          0.0,
          0.85,
          0.95,
          3.6,
          0.92
        );
      }

      let hitCar: Car | null = null;
      for (const c of cars) {
        if (c.blasted || c.id === t.ownerId) continue;
        const dSq = distSqPointToSegment(c.x, c.y + 0.68, c.z, ax, ay, az, bx, by, bz);
        if (dSq <= torpHitRadiusSq) {
          hitCar = c;
          break;
        }
      }

      if (hitCar) {
        t.active = false;
        t.mesh.visible = false;
        const shooter = carMap.get(t.ownerId) || null;
        // Direct Torpedo Obliteration: Instant 1-hit kill & blast respawn
        if (hitCar.respawnProtect <= 0 && !hitCar.remote) {
          hitCar.hp = 0;
          hitCar.sinceHit = 0;
          hitCar.hit = 6.0;
          ev.onHit(hitCar, shooter, 100);
          this.blastCar(hitCar, shooter, particles, ev, 'torpedo');
        } else if (hitCar.respawnProtect <= 0 && shooter?.isPlayer) {
          ev.onHit(hitCar, shooter, 100);
        }
        continue;
      }

      if (by <= 0.05) {
        t.active = false;
        t.mesh.visible = false;
        this.spawnExplosion(bx, 0.35, bz, particles, 1.75);
        continue;
      }

      t.x = bx;
      t.y = by;
      t.z = bz;
      t.mesh.position.set(bx, by, bz);
      this._quat.setFromUnitVectors(this._lookDir, this._dir);
      t.mesh.quaternion.copy(this._quat);
    }

    // 5. Step explosion spheres/shockwaves
    for (const ex of this.blasts) {
      if (!ex.active) continue;
      ex.age += dt;
      const t = ex.age / ex.dur;
      if (t >= 1) {
        ex.active = false;
        ex.core.visible = false;
        ex.ring.visible = false;
        continue;
      }
      const easeOut = 1 - Math.pow(1 - t, 3);
      ex.core.scale.setScalar(0.8 + easeOut * 4.6);
      ex.ring.scale.setScalar(1.0 + easeOut * 8.5);
      (ex.core.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.92;
      (ex.ring.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.78;
    }

    // 6. Low-HP smoke plume on heavily damaged cars
    for (const c of cars) {
      if (!c.blasted && c.hp < 45 && Math.random() < 0.45) {
        particles.spawn(
          c.x + (Math.random() - 0.5) * 0.5,
          c.y + 0.95,
          c.z + (Math.random() - 0.5) * 0.5,
          c.vx * 0.25 + (Math.random() - 0.5) * 2.5,
          2.2 + Math.random() * 2.5,
          c.vz * 0.25 + (Math.random() - 0.5) * 2.5,
          0.45 + Math.random() * 0.25,
          0.95,
          0.18,
          0.18,
          0.2,
          2.5,
          0.42
        );
      }
    }
  }

  private spawnImpactSparks(x: number, y: number, z: number, particles: Particles): void {
    for (let i = 0; i < 6; i++) {
      particles.spawn(
        x + (Math.random() - 0.5) * 0.4,
        y + (Math.random() - 0.5) * 0.4,
        z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 14,
        2 + Math.random() * 6,
        (Math.random() - 0.5) * 14,
        0.22 + Math.random() * 0.14,
        0.38,
        1.0,
        0.78,
        0.22,
        0.2,
        0.95
      );
    }
  }

  blastCar(victim: Car, shooter: Car | null, particles: Particles, ev: CombatEvents, mode: boolean | string = false): void {
    if (victim.blasted) return;
    victim.blasted = true;
    victim.blastTimer = 1.25;
    victim.hp = 0;
    victim.lastAttackerId = shooter ? shooter.id : null;
    if (shooter) shooter.takedowns++;
    const scale = mode === 'torpedo' ? 2.2 : mode ? 1.6 : 1.15;
    this.spawnExplosion(victim.x, victim.y, victim.z, particles, scale);
    ev.onBlast(victim, shooter, mode);
  }
}
