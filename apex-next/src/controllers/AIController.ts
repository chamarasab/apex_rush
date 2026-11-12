import { clamp, damp } from '../core/config';
import type { Car } from '../cars/Car';
import type { Track } from '../tracks/Track';

export interface AIOptions {
  player?: Car | null;
  onStuck?: (car: Car) => void;
  bias?: number;
  lineUse?: number;
  pace?: number;
  wander?: number;
  delay?: number;
  cornerA: number;
  nosChance?: number;
}

export class AIController {
  readonly car: Car;
  readonly track: Track;
  player: Car | null;
  private onStuck?: (car: Car) => void;
  private bias: number;
  private lineUse: number;
  pace: number;
  private wf: number;
  private ph: number;
  private wa: number;
  private delay: number;
  private nosChance: number;
  private off: number;
  private stuck = 0;
  private v: Float32Array;
  private nosBurst = 0;

  constructor(car: Car, track: Track, o: AIOptions) {
    this.car = car;
    this.track = track;
    this.player = o.player || null;
    this.onStuck = o.onStuck;
    this.bias = o.bias || 0;
    this.lineUse = o.lineUse ?? 1;
    this.pace = o.pace ?? 1;
    this.wf = 0.25 + Math.random() * 0.3;
    this.ph = Math.random() * 6.28;
    this.wa = o.wander ?? 0.5;
    this.delay = o.delay || 0;
    this.nosChance = o.nosChance ?? 0.4;
    this.off = car.lat;

    const N = track.N;
    const v = (this.v = new Float32Array(N));
    for (let i = 0; i < N; i++) {
      v[i] = Math.min(car.topSpeed, Math.sqrt(o.cornerA / Math.max(Math.abs(track.curv[i]), 1e-4)));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        if (track.open && i === N - 1) continue;
        const n = v[(i + 1) % N];
        v[i] = Math.min(v[i], Math.sqrt(n * n + 2 * 18.5 * track.ds));
      }
    }
  }

  update(dt: number, cars: Car[], time: number): void {
    const car = this.car;
    const t = this.track;
    const N = t.N;
    const inp = car.input;
    inp.drift = false;
    inp.nos = false;

    if (car.frozen) {
      inp.throttle = inp.brake = inp.steer = 0;
      return;
    }
    if (this.delay > 0) {
      this.delay -= dt;
      inp.throttle = 0;
      return;
    }

    const speed = Math.max(0, car.speed);
    const maxOff = t.roadHalf - 1.5;

    const ahead = (idx: number, steps: number) =>
      t.open ? clamp(idx + steps, 0, N - 1) : (idx + steps) % N;

    let off =
      t.line[ahead(car.idx, Math.round(12 / t.ds))] * this.lineUse +
      this.bias +
      Math.sin(time * this.wf + this.ph) * this.wa;
    let vCap = Infinity;

    for (const o of cars) {
      if (o === car) continue;
      let di = o.idx - car.idx;
      if (!t.open) {
        if (di > N / 2) di -= N;
        else if (di < -N / 2) di += N;
      }
      const dist = di * t.ds;
      if (dist > -3 && dist < 9 + speed * 0.45) {
        const dl = o.lat - car.lat;
        if (Math.abs(dl) < 2.8) {
          const side = dl > 0 ? -1 : 1;
          let tgt = o.lat + side * 3.2;
          if (Math.abs(tgt) > maxOff) tgt = o.lat - side * 3.2;
          off = tgt;
          if (dist > 0 && dist < 7.5 && Math.abs(dl) < 2.2 && speed > o.speed) {
            vCap = Math.min(vCap, Math.max(o.speed - 1, 5));
          }
        }
      }
    }

    this.off = damp(this.off, clamp(off, -maxOff, maxOff), 2.5, dt);

    const ti = ahead(car.idx, Math.round((8 + speed * 0.4) / t.ds));
    const dx = t.px[ti] + t.lx[ti] * this.off - car.x;
    const dz = t.pz[ti] + t.lz[ti] * this.off - car.z;
    const sh = Math.sin(car.h);
    const ch = Math.cos(car.h);
    const ang = Math.atan2(dx * ch - dz * sh, dx * sh + dz * ch);
    inp.steer = clamp(ang * 2.45, -1, 1);

    // Subtle rubber-banding in solo races
    let band = 1;
    if (this.player && this.player !== car && car.race && this.player.race) {
      const gap = (car.race.progress - this.player.race.progress) * t.ds;
      band = 1 + clamp(-gap * 0.00022, -0.035, 0.045);
    }

    let vT = Math.min(
      this.v[ahead(car.idx, 3)] * this.pace * band * (1 + 0.015 * Math.sin(time * 0.4 + this.ph)),
      vCap
    );
    if (t.open && car.idx >= t.finishIdx + 4) {
      vT = 0;
    }
    if (Math.abs(ang) > 0.62) {
      vT = Math.min(vT, 19);
      if (speed > 26 && Math.abs(t.curv[car.idx]) > 0.013) inp.drift = true;
    }

    if (speed < vT - 1) {
      inp.throttle = 1;
      inp.brake = 0;
    } else if (speed > vT + 2) {
      inp.throttle = 0;
      inp.brake = clamp((speed - vT) / 8, 0.15, 1);
    } else {
      inp.throttle = 0.45;
      inp.brake = 0;
    }

    // AI NOS on straights
    if (this.nosBurst > 0) {
      this.nosBurst -= dt;
      inp.nos = true;
    } else if (
      car.nos > 55 &&
      inp.throttle > 0.8 &&
      Math.abs(ang) < 0.1 &&
      Math.abs(t.curv[ahead(car.idx, 12)]) < 0.006 &&
      Math.random() < this.nosChance * dt * 0.4
    ) {
      this.nosBurst = 1.4;
    }

    if (!car.race?.finished && speed < 2) {
      this.stuck += dt;
      if (this.stuck > 2.5) {
        this.stuck = 0;
        if (this.onStuck) this.onStuck(car);
      }
    } else {
      this.stuck = 0;
    }
  }
}

