import * as THREE from 'three';
import { clamp, damp, lerp, NET_LEAD, ROAD_Y, wrapPi } from '../core/config';
import { buildCarVisual, type CarVisualRig } from './carModels';
import { CAR_SPECS, type CarId, type CarSpec } from './carSpecs';
import type { Track } from '../tracks/Track';

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
  nos: boolean;
  fire: boolean;
  rocket?: boolean;
}

export interface RaceProgress {
  cp: number;
  lap: number;
  lapStart: number;
  best: number | null;
  last: number | null;
  finished: boolean;
  finishTime: number | null;
  place: number;
  progress: number;
  prevIdx: number;
  wrongT: number;
  startIdx: number;
  startLat: number;
}

export class Car {
  readonly scene: THREE.Scene;
  readonly isPlayer: boolean;
  readonly spec: CarSpec;
  readonly type: CarId;
  colorHex: string;
  underglowHex: string;

  id = '';
  name = '';
  isAI = false;
  remote = false;

  x = 0;
  y = 0;
  z = 0;
  h = 0;
  vx = 0;
  vz = 0;
  px0 = 0;
  py0 = 0;
  pz0 = 0;
  ph0 = 0;

  steer = 0;
  speed = 0;
  slip = 0;
  lat = 0;
  idx = 0;

  onGrass = false;
  surface: 'asphalt' | 'sand' | 'mud' | 'water' = 'asphalt';
  drifting = false;
  braking = false;
  nosActive = false;
  frozen = true;
  hit = 0;
  bovTrigger = false;

  // Drift & NOS state
  nos = 100; // 0..100
  driftScore = 0;
  totalDriftScore = 0;
  driftTimer = 0;
  driftCooldown = 0;
  exitBoostTimer = 0;
  wasBoosted = false;
  driftDir = 0;
  driftHold = 0;
  driftBlend = 0;

  topSpeed: number;
  accel: number;
  brakeF: number;
  grip: number;

  input: CarInput = { throttle: 0, brake: 0, steer: 0, drift: false, nos: false, fire: false, rocket: false };
  net = { x: 0, z: 0, h: 0, vx: 0, vz: 0, steer: 0, flags: 0, age: 0, hp: 100, yaw: 0, pitch: 0 };

  // Combat & bonnet-mounted turret state
  hp = 100;
  maxHp = 100;
  blasted = false;
  blastTimer = 0;
  respawnProtect = 0;
  sinceHit = 99;
  takedowns = 0;
  lastAttackerId: string | null = null;
  gunYaw = 0;
  gunPitch = 0.02;
  targetGunYaw = 0;
  targetGunPitch = 0.02;
  gunRecoil = 0;
  muzzleFlashT = 0;
  fireCd = 0;
  rocketCd = 0;
  maxRocketCd = 2.4;
  rocketBackblastT = 0;
  aiBurstTimer = 0;
  aiBurstWait = 0;

  pitch = 0;
  roll = 0;
  accPitch = 0;
  yawRate = 0;
  lastSpeed = 0;
  wheelRot = 0;
  rearWheelRot = 0;
  slopeRel = 0;
  renderH = 0;
  brakeHeat = 0;
  prevThrottle = 0;

  skidLast: [THREE.Vector3 | null, THREE.Vector3 | null] = [null, null];
  race: RaceProgress | null = null;
  tagMat: THREE.SpriteMaterial | null = null;
  tagCanvas: HTMLCanvasElement | null = null;
  tagCtx: CanvasRenderingContext2D | null = null;
  lastTagHp = -1;
  rig: CarVisualRig;
  mesh: THREE.Group;

  constructor(
    scene: THREE.Scene,
    type: CarId,
    colorHex: string,
    underglowHex = '#00e5ff',
    isPlayer = false
  ) {
    this.scene = scene;
    this.isPlayer = isPlayer;
    this.type = CAR_SPECS[type] ? type : 'r34';
    this.spec = CAR_SPECS[this.type];
    this.colorHex = colorHex;
    this.underglowHex = underglowHex;

    this.topSpeed = this.spec.top;
    this.accel = this.spec.accel;
    this.brakeF = this.spec.brake;
    this.grip = this.spec.grip;

    this.rig = buildCarVisual(this.type, colorHex, underglowHex, isPlayer);
    this.mesh = this.rig.root;
    this.mesh.rotation.order = 'YXZ';
    this.scene.add(this.mesh);
  }

  setColor(c: string): void {
    this.colorHex = c;
    this.rig.bodyMat.color.set(c);
  }

  setUnderglow(c: string): void {
    this.underglowHex = c;
    if (c === 'off') {
      this.rig.underglowMat.opacity = 0;
    } else {
      this.rig.underglowMat.color.set(c);
      this.rig.underglowMat.opacity = 0.62;
    }
  }

  setTag(name: string): void {
    this.name = name;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 76;
    this.tagCanvas = c;
    this.tagCtx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.tagMat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: false });
    const s = new THREE.Sprite(this.tagMat);
    s.scale.set(3.8, 1.12, 1);
    s.position.y = 2.48;
    s.renderOrder = 6;
    this.mesh.add(s);
    this.lastTagHp = -1;
    this.drawTag();
  }

  private drawTag(): void {
    const ctx = this.tagCtx;
    const c = this.tagCanvas;
    if (!ctx || !c || !this.tagMat?.map) return;
    const w = c.width;
    const h = c.height;
    const hpQuant = Math.max(0, Math.round(this.hp));
    if (hpQuant === this.lastTagHp) return;
    this.lastTagHp = hpQuant;

    ctx.clearRect(0, 0, w, h);
    ctx.font = '700 25px system-ui, -apple-system, sans-serif';
    const tw = Math.min(w - 8, Math.max(132, ctx.measureText(this.name).width + 32));
    const bx = (w - tw) / 2;
    ctx.fillStyle = 'rgba(8,12,20,.78)';
    ctx.fillRect(bx, 8, tw, 42);
    ctx.fillStyle = this.colorHex;
    ctx.fillRect(bx, 46, tw, 4);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.name, w / 2, 27, w - 20);

    // Health bar underneath name plate
    const ratio = clamp(this.hp / this.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(8,12,20,.85)';
    ctx.fillRect(bx, 54, tw, 12);
    ctx.fillStyle = ratio > 0.55 ? '#58ff7a' : ratio > 0.28 ? '#ffb347' : '#ff3b4d';
    ctx.fillRect(bx + 2, 56, Math.max(0, (tw - 4) * ratio), 8);

    this.tagMat.map.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.rig.dispose();
    if (this.tagMat) {
      this.tagMat.map?.dispose();
      this.tagMat.dispose();
    }
  }

  syncPrev(): void {
    this.px0 = this.x;
    this.py0 = this.y;
    this.pz0 = this.z;
    this.ph0 = this.h;
  }

  step(dt: number, track: Track, allCars?: Car[]): void {
    this.syncPrev();
    const inp = this.input;
    const S = this.spec;
    this.bovTrigger = false;

    this.stepCombatTimers(dt);

    const centering = Math.abs(inp.steer) < 0.05 || inp.steer * this.steer < 0;
    const steerRate = (centering ? 11.2 : 8.2) * clamp(S.driftControl, 0.9, 1.45);
    this.steer += clamp(inp.steer - this.steer, -steerRate * dt, steerRate * dt);
    this.braking = inp.brake > 0.05;

    if (this.frozen || this.blasted) {
      this.vx = this.vz = 0;
      this.speed = 0;
      this.slip = 0;
      this.drifting = false;
      this.nosActive = false;
      this.yawRate = 0;
      this.driftDir = 0;
      this.driftHold = 0;
      this.driftBlend = 0;
      return;
    }

    const sh = Math.sin(this.h);
    const ch = Math.cos(this.h);
    let vF = this.vx * sh + this.vz * ch;
    let vL = this.vx * ch - this.vz * sh;
    const speedMag = Math.hypot(vF, vL);
    const grass = this.onGrass;
    const driftKey = inp.drift;

    // Turbo blow-off valve flutter trigger when releasing gas at speed
    if (S.hasTurbo && this.prevThrottle > 0.6 && inp.throttle < 0.15 && vF > 26) {
      this.bovTrigger = true;
    }
    this.prevThrottle = inp.throttle;

    // --- NOS Boost (Shift) ---
    const canNos = inp.nos && this.nos > 1.0 && (inp.throttle > 0.05 || vF > 6) && !grass;
    this.nosActive = canNos;
    if (canNos) {
      this.nos = Math.max(0, this.nos - 24 * dt);
    } else {
      // Passive recharge + slipstream drafting recharge
      let regen = 2.4;
      if (allCars && vF > 18) {
        for (const other of allCars) {
          if (other === this || other.blasted) continue;
          const dx = other.x - this.x;
          const dz = other.z - this.z;
          const fwd = dx * sh + dz * ch;
          const side = Math.abs(dx * ch - dz * sh);
          if (fwd > 4 && fwd < 26 && side < 2.4) {
            regen += 7.5; // Slipstream drafting bonus
            break;
          }
        }
      }
      this.nos = Math.min(100, this.nos + regen * dt);
    }

    // Drift exit boost decay
    if (this.exitBoostTimer > 0) this.exitBoostTimer = Math.max(0, this.exitBoostTimer - dt);

    const boostMult = canNos ? S.nosTopBonus : this.exitBoostTimer > 0 ? 1.11 : 1.0;
    const is4x4 = S.driveType === 'AWD' || S.driveType === '4x4';
    const surf = this.surface;
    const surfTopMult =
      grass ? 0.52
      : surf === 'water' ? (is4x4 ? 0.89 : 0.80)
      : surf === 'mud' ? (is4x4 ? 0.90 : 0.82)
      : surf === 'sand' ? 0.95
      : 1.0;
    const top = this.topSpeed * surfTopMult * boostMult;
    // Instant low-end torque punch for Tri-Motor EV below 125 km/h
    const evPunch = S.evInstantTorque && vF < 34 ? 1.32 : 1.0;
    const engineForce =
      this.accel * evPunch * (inp.throttle > 0 ? inp.throttle : canNos ? 0.85 : 0) +
      (canNos ? S.nosPower : 0) +
      (this.exitBoostTimer > 0 ? 8.5 : 0);

    const surfGripMult = surf === 'mud' ? (is4x4 ? 0.78 : 0.68) : surf === 'water' ? (is4x4 ? 0.80 : 0.72) : surf === 'sand' ? 0.88 : 1.0;
    const prevDrifting = this.drifting;

    // --- Asphalt Carving + Controlled Drift Physics ---
    if (vF > 3.5 && speedMag > 3.5) {
      const driftPressed = driftKey && speedMag > 7.0;
      if (driftPressed) {
        if (this.driftDir === 0) {
          if (Math.abs(this.steer) > 0.10) {
            this.driftDir = Math.sign(this.steer);
            this.driftHold = 0;
          }
        } else {
          const alignedSteer = this.steer * this.driftDir;
          if (alignedSteer < -0.45) {
            this.driftHold += dt;
            if (this.driftHold > 0.18) {
              this.driftDir = Math.sign(this.steer);
              this.driftHold = 0;
            }
          } else {
            this.driftHold = Math.max(0, this.driftHold - dt * 2.5);
          }
        }
      } else {
        this.driftDir = 0;
        this.driftHold = 0;
      }

      const driftActive = driftPressed && (this.driftDir !== 0 || Math.abs(this.steer) > 0.14);
      this.driftBlend = damp(this.driftBlend, driftActive ? 1 : 0, driftActive ? 11.5 : 8.5, dt);

      // Modulated steer during drift: hold steer for tight apex carve, release to glide wide, countersteer for S-bends
      let carveSteer = this.steer;
      let targetBeta = this.steer * 0.035;
      const carSlideFactor = clamp(10.8 / S.driftGrip, 0.85, 1.32);
      const maxBeta = (grass ? 0.34 : 0.43) * carSlideFactor;

      if (driftActive) {
        if (this.driftDir !== 0) {
          const aligned = this.steer * this.driftDir;
          const carveFactor = aligned >= 0 ? 0.28 + 0.72 * aligned : 0.28 + aligned * 0.46;
          carveSteer = this.driftDir * carveFactor;
          const betaFactor = aligned >= 0 ? 0.56 + 0.44 * aligned : Math.max(0.18, 0.56 + aligned * 0.42);
          targetBeta = this.driftDir * maxBeta * betaFactor;
        } else {
          targetBeta = this.steer * maxBeta * 0.65;
        }
      }
      if (canNos) targetBeta *= 0.55;
      targetBeta *= this.driftBlend > 0.05 ? this.driftBlend : 1;

      // Longitudinal speed update with minimal drift scrub while on throttle
      let spd = speedMag;
      if (engineForce > 0) {
        const headRoom = clamp(1 - spd / top, -0.15, 1);
        spd += engineForce * headRoom * dt;
      }
      if (inp.brake > 0) {
        spd -= this.brakeF * inp.brake * dt;
      }
      const coastDrag = inp.throttle > 0 || canNos ? 0.00018 * spd * spd : 1.5 + 0.0012 * spd * spd;
      const grassDrag = grass && inp.throttle === 0 ? 0.85 * spd : 0;
      const mudDrag = surf === 'mud' || surf === 'water' ? (is4x4 ? 0.12 : 0.22) * spd : 0;
      const highSpdTrim = spd > 52 ? (spd - 52) * 0.34 * Math.pow(Math.abs(carveSteer), 1.35) * this.driftBlend : 0;
      const driftScrub =
        driftPressed && !canNos
          ? inp.throttle > 0
            ? (0.9 + 2.6 * Math.abs(carveSteer)) * this.driftBlend + highSpdTrim
            : spd > 6
              ? 8.2
              : 0
          : 0;
      spd = Math.max(0, spd - Math.min(spd, (coastDrag + grassDrag + mudDrag + driftScrub) * dt));

      // Velocity-vector carving guarantees turning around corners instead of sliding straight into walls
      const travelAngle = Math.atan2(this.vx, this.vz);
      const downforce = 1 + clamp(spd / 25, 0, 2.75);
      const driftCornerBonus = 1 + 0.45 * this.driftBlend;
      const baseGrip = grass ? 18.0 : this.grip * surfGripMult * downforce;
      const driftFloor = grass ? 0 : 156 * clamp(S.driftControl, 1.0, 1.42) * surfGripMult * this.driftBlend;
      const cornerGrip = Math.max(baseGrip * driftCornerBonus, driftFloor);
      const maxPathYaw = cornerGrip / Math.max(spd, 5.0);

      const steerCurve = Math.sign(carveSteer) * Math.pow(Math.abs(carveSteer), 0.9);
      const agility = (2.72 + 0.68 * this.driftBlend) * clamp(S.driftControl, 1.0, 1.40);
      const rawYaw = (steerCurve * agility) / (1 + spd / (86 + 22 * this.driftBlend));
      const pathYaw = clamp(rawYaw, -maxPathYaw, maxPathYaw);

      const newTravelAngle = travelAngle + pathYaw * dt;
      this.vx = Math.sin(newTravelAngle) * spd;
      this.vz = Math.cos(newTravelAngle) * spd;

      const curBeta = wrapPi(this.h - travelAngle);
      const betaRate = driftActive ? 6.8 * clamp(S.driftControl, 0.9, 1.45) : 9.8;
      const nextBeta = damp(curBeta, targetBeta, betaRate, dt);
      const prevH = this.h;
      this.h = wrapPi(newTravelAngle + nextBeta);
      this.yawRate = wrapPi(this.h - prevH) / Math.max(dt, 1e-4);

      vF = spd * Math.cos(nextBeta);
      vL = -spd * Math.sin(nextBeta);
      this.slip = Math.abs(vL);
      this.drifting = (this.slip > 3.8 || (driftActive && this.driftBlend > 0.35)) && spd > 7.5;

      // Track Drift Score + NOS Recharge
      if (this.drifting && !grass) {
        this.driftTimer += dt;
        this.driftCooldown = 1.1;
        const angleFactor = clamp(this.slip / 14, 0.45, 2.2);
        const spdFactor = clamp(spd / 36, 0.5, 2.0);
        const pts = 420 * angleFactor * spdFactor * dt;
        this.driftScore += pts;
        this.totalDriftScore += pts;
        this.nos = Math.min(100, this.nos + 18.0 * angleFactor * S.nosChargeRate * dt);
      } else {
        if (prevDrifting && this.driftTimer > 0.45 && !grass) {
          this.exitBoostTimer = Math.min(0.9, 0.28 + this.driftTimer * 0.22);
        }
        if (this.driftCooldown > 0) {
          this.driftCooldown -= dt;
          if (this.driftCooldown <= 0) {
            this.driftScore = 0;
            this.driftTimer = 0;
          }
        }
      }
    } else {
      // Low-speed launch, stop, and reverse kinematics
      this.driftDir = 0;
      this.driftHold = 0;
      this.driftBlend = damp(this.driftBlend, 0, 10, dt);

      if (engineForce > 0) {
        const headRoom = clamp(1 - vF / top, -0.15, 1);
        vF += engineForce * headRoom * dt;
      }
      if (inp.brake > 0) {
        if (vF > 0.8) {
          vF = Math.max(0, vF - this.brakeF * inp.brake * dt);
        } else if (inp.throttle === 0 && vF > -18) {
          vF -= 12.0 * inp.brake * dt;
        }
      }
      if (inp.throttle === 0 && inp.brake === 0) {
        vF -= Math.sign(vF) * Math.min(Math.abs(vF), 3.2 * dt);
      }
      vL *= Math.exp(-14 * dt);

      const yaw = this.steer * 2.25 * clamp(vF / 4.0, -1, 1);
      this.yawRate = yaw;
      this.h = wrapPi(this.h + yaw * dt);
      const nh = Math.sin(this.h);
      const nc = Math.cos(this.h);
      this.vx = vF * nh + vL * nc;
      this.vz = vF * nc - vL * nh;
      this.slip = Math.abs(vL);
      this.drifting = false;
      if (this.driftCooldown > 0) {
        this.driftCooldown -= dt;
        if (this.driftCooldown <= 0) {
          this.driftScore = 0;
          this.driftTimer = 0;
        }
      }
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.speed = vF;
    this.constrain(track);
  }

  private stepCombatTimers(dt: number): void {
    this.gunYaw += wrapPi(this.targetGunYaw - this.gunYaw) * (1 - Math.exp(-18 * dt));
    this.gunPitch = damp(this.gunPitch, this.targetGunPitch, 18, dt);
    this.gunRecoil = damp(this.gunRecoil, 0, 22, dt);
    if (this.muzzleFlashT > 0) this.muzzleFlashT = Math.max(0, this.muzzleFlashT - dt);
    if (this.fireCd > 0) this.fireCd = Math.max(0, this.fireCd - dt);
    if (this.rocketCd > 0) this.rocketCd = Math.max(0, this.rocketCd - dt);
    if (this.rocketBackblastT > 0) this.rocketBackblastT = Math.max(0, this.rocketBackblastT - dt);
    if (this.respawnProtect > 0) this.respawnProtect = Math.max(0, this.respawnProtect - dt);
    this.sinceHit += dt;
    if (this.blasted && this.blastTimer > 0) {
      this.blastTimer = Math.max(0, this.blastTimer - dt);
    }
    if (this.isPlayer && !this.blasted && !this.frozen && this.sinceHit > 3.5 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 6.5 * dt);
    }
    this.drawTag();
  }

  // ----- Multiplayer Packing & Dead-Reckoning -----
  pack(): (string | number)[] {
    const r = this.race!;
    const f = (n: number) => Math.round(n * 100) / 100;
    const flags =
      (this.braking ? 1 : 0) |
      (this.input.drift ? 2 : 0) |
      (this.nosActive ? 4 : 0) |
      (this.drifting ? 8 : 0) |
      (this.blasted ? 16 : 0);
    return [
      this.id,
      f(this.x),
      f(this.z),
      Math.round(this.h * 1000) / 1000,
      f(this.vx),
      f(this.vz),
      f(this.steer),
      flags,
      r.cp,
      r.lap,
      r.finished && r.finishTime ? r.finishTime : 0,
      r.best || 0,
      r.last || 0,
      Math.round(this.hp),
      f(this.gunYaw),
      f(this.gunPitch),
    ];
  }

  applyNet(a: (string | number)[], lead = NET_LEAD): void {
    for (let i = 1; i <= 6; i++) if (!Number.isFinite(Number(a[i]))) return;
    const n = this.net;
    n.h = Number(a[3]);
    n.vx = clamp(Number(a[4]), -140, 140);
    n.vz = clamp(Number(a[5]), -140, 140);
    n.x = Number(a[1]) + n.vx * lead;
    n.z = Number(a[2]) + n.vz * lead;
    n.steer = clamp(Number(a[6]), -1, 1);
    n.flags = Number(a[7]) | 0;
    n.hp = Number.isFinite(Number(a[13])) ? clamp(Number(a[13]), 0, 100) : n.hp;
    n.yaw = Number.isFinite(Number(a[14])) ? clamp(Number(a[14]), -3.14, 3.14) : n.yaw;
    n.pitch = Number.isFinite(Number(a[15])) ? clamp(Number(a[15]), -0.5, 0.8) : n.pitch;
    n.age = 0;

    const r = this.race;
    if (!r) return;
    r.cp = Math.max(0, Number(a[8]) | 0);
    r.lap = clamp(Number(a[9]) | 0, 1, 10);
    if (Number(a[10]) > 0 && !r.finished) {
      r.finished = true;
      r.finishTime = Number(a[10]);
    }
    r.best = Number(a[11]) > 0 ? Number(a[11]) : null;
    r.last = Number(a[12]) > 0 ? Number(a[12]) : null;
  }

  stepRemote(dt: number, track: Track): void {
    this.syncPrev();
    const n = this.net;
    n.age += dt;
    if (n.age > 0.6) {
      n.vx *= 0.9;
      n.vz *= 0.9;
    }
    n.x += n.vx * dt;
    n.z += n.vz * dt;
    const dx = n.x - this.x;
    const dz = n.z - this.z;
    const snap = dx * dx + dz * dz > 144;
    if (snap) {
      this.x = n.x;
      this.z = n.z;
      this.h = n.h;
      this.idx = track.locateGlobal(n.x, n.z);
      this.skidLast[0] = this.skidLast[1] = null;
    } else {
      this.x += dx * 0.28;
      this.z += dz * 0.28;
      this.h += wrapPi(n.h - this.h) * 0.28;
    }
    this.vx = n.vx;
    this.vz = n.vz;
    const sh = Math.sin(this.h);
    const ch = Math.cos(this.h);
    this.speed = this.vx * sh + this.vz * ch;
    this.slip = Math.abs(this.vx * ch - this.vz * sh);
    this.steer = n.steer;
    this.braking = !!(n.flags & 1);
    this.input.drift = !!(n.flags & 2);
    this.nosActive = !!(n.flags & 4);
    this.drifting = !!(n.flags & 8) || (this.slip > 4.2 && Math.abs(this.speed) > 7);
    this.blasted = !!(n.flags & 16);
    this.hp = n.hp;
    this.targetGunYaw = n.yaw;
    this.targetGunPitch = n.pitch;
    this.stepCombatTimers(dt);
    this.yawRate = 0;
    this.constrain(track);
    this.hit = 0;
    if (snap) this.syncPrev();
  }

  constrain(track: Track): void {
    const i = (this.idx = track.locate(this.x, this.z, this.idx));
    const lx = track.lx[i];
    const lz = track.lz[i];
    let dx = this.x - track.px[i];
    let dz = this.z - track.pz[i];
    let lat = dx * lx + dz * lz;
    const wallLim = track.wallLim;

    if (Math.abs(lat) > wallLim) {
      const s = Math.sign(lat);
      const over = Math.abs(lat) - wallLim;
      this.x -= lx * s * over;
      this.z -= lz * s * over;
      const vn = (this.vx * lx + this.vz * lz) * s;
      if (vn > 0) {
        const totalSpd = Math.hypot(this.vx, this.vz);
        // Glancing wall-glide response avoids harsh opposite-wall ping-pong
        this.vx -= 1.05 * vn * lx * s;
        this.vz -= 1.05 * vn * lz * s;
        const impactRatio = vn / Math.max(totalSpd, 8);
        const f = 1 - Math.min(0.28, vn * 0.012 + impactRatio * 0.16);
        this.vx *= f;
        this.vz *= f;
        this.hit = Math.max(this.hit, vn);
        if (this.speed > 0 && !this.remote) {
          this.h += clamp(wrapPi(track.head[i] - this.h), -0.45, 0.45) * Math.min(0.55, vn * 0.055 + 0.08);
        }
      }
      lat = s * wallLim;
      dx = this.x - track.px[i];
      dz = this.z - track.pz[i];
    }

    this.lat = lat;
    this.onGrass = Math.abs(lat) > track.roadHalf + 0.9;
    this.surface = track.surfaceAt(i);
    let along = dx * track.tx[i] + dz * track.tz[i];
    if (track.open) {
      if (i === 0 && along < 0.8) {
        const push = 0.8 - along;
        this.x += track.tx[i] * push;
        this.z += track.tz[i] * push;
        const vt = this.vx * track.tx[i] + this.vz * track.tz[i];
        if (vt < 0) {
          this.vx -= 1.2 * vt * track.tx[i];
          this.vz -= 1.2 * vt * track.tz[i];
        }
        along = 0.8;
      } else if (i === track.N - 1 && along > -0.8) {
        const push = along + 0.8;
        this.x -= track.tx[i] * push;
        this.z -= track.tz[i] * push;
        const vt = this.vx * track.tx[i] + this.vz * track.tz[i];
        if (vt > 0) {
          this.vx -= 1.2 * vt * track.tx[i];
          this.vz -= 1.2 * vt * track.tz[i];
          this.hit = Math.max(this.hit, vt * 0.6);
        }
        along = -0.8;
      }
    }
    this.y = track.py[i] + track.slope[i] * along + ROAD_Y;
    this.slopeRel = track.slope[i] * (Math.sin(this.h) * track.tx[i] + Math.cos(this.h) * track.tz[i]);
  }

  updateVisual(alpha: number, dt: number, timeSec = 0): void {
    const m = this.mesh;
    m.visible = !this.blasted;
    if (this.blasted) return;
    m.position.set(lerp(this.px0, this.x, alpha), lerp(this.py0, this.y, alpha), lerp(this.pz0, this.z, alpha));
    this.renderH = this.ph0 + wrapPi(this.h - this.ph0) * alpha;
    this.pitch = damp(this.pitch, -Math.atan(this.slopeRel), 10, dt);
    m.rotation.set(this.pitch, this.renderH, 0);

    if (dt > 0) {
      const acc = (this.speed - this.lastSpeed) / dt;
      this.lastSpeed = this.speed;
      const rollMult = this.spec.bodyRollMult ?? 1.0;
      this.accPitch = damp(this.accPitch, clamp(-acc * 0.0022 * (0.75 + rollMult * 0.25), -0.065, 0.065), 7, dt);
      this.roll = damp(this.roll, clamp(this.yawRate * this.speed * 0.0017 * rollMult, -0.11, 0.11), 8, dt);
      this.wheelRot += (this.speed * dt) / this.spec.wheelR;
      if (!(this.input.drift && this.speed > 4.5)) {
        this.rearWheelRot += (this.speed * dt) / this.spec.wheelR;
      }
      const targetHeat = this.braking && Math.abs(this.speed) > 18 ? 1 : 0;
      this.brakeHeat = damp(this.brakeHeat, targetHeat, targetHeat > 0 ? 5 : 2.2, dt);
    }

    this.rig.bodyGroup.rotation.set(this.accPitch, 0, this.roll);
    for (const w of this.rig.wheels) {
      w.spin.rotation.x = w.front ? this.wheelRot : this.rearWheelRot;
      if (w.front) w.pivot.rotation.y = this.steer * 0.44;
    }

    // Taillight braking & brake rotor thermal glow
    this.rig.tailMat.emissiveIntensity = this.braking ? 3.2 : 0.9;
    this.rig.rotorMat.emissiveIntensity = this.brakeHeat * 2.4;

    // NOS exhaust flames & point light flicker
    const showNos = this.nosActive;
    for (const f of this.rig.nosFlames) {
      f.visible = showNos;
      if (showNos) {
        const flicker = 0.82 + 0.36 * Math.sin(timeSec * 52 + this.x) + Math.random() * 0.25;
        f.scale.set(1, 1, flicker);
      }
    }
    if (this.rig.nosLight) {
      this.rig.nosLight.intensity = showNos ? 4.5 + Math.random() * 2.0 : 0;
    }

    // Articulated bonnet-mounted gun turret + recoil + muzzle flash
    if (!this.race) {
      // Gentle showroom sweep so the turret is unmistakably visible
      this.gunYaw = Math.sin(timeSec * 0.9) * 0.22;
      this.gunPitch = 0.05 + Math.sin(timeSec * 1.4) * 0.03;
    }
    this.rig.turretYaw.rotation.y = this.gunYaw;
    this.rig.turretPitch.rotation.x = -this.gunPitch;
    this.rig.turretRecoil.position.z = -this.gunRecoil;
    const showFlash = this.muzzleFlashT > 0;
    this.rig.muzzleFlash.visible = showFlash;
    if (showFlash) {
      const fs = 0.8 + Math.random() * 0.5;
      this.rig.muzzleFlash.scale.set(fs, fs, 0.85 + Math.random() * 0.55);
      this.rig.muzzleFlash.rotation.z = Math.random() * Math.PI;
    }

    if (this.rig.rocketBackblastFlash) {
      const showBb = this.rocketBackblastT > 0;
      this.rig.rocketBackblastFlash.visible = showBb;
      if (showBb) {
        const bs = 0.85 + Math.random() * 0.45;
        this.rig.rocketBackblastFlash.scale.set(bs, bs, bs);
      }
    }
  }
}

