import type { Car } from '../cars/Car';
import type { Track } from '../tracks/Track';
import type { TrackId } from '../tracks/trackData';

const STORE_PREFIX = 'apexnext_best_lap_';

export function loadBestLap(trackId: TrackId): number | null {
  try {
    const v = parseFloat(localStorage.getItem(STORE_PREFIX + trackId) || '');
    return isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveBestLap(trackId: TrackId, val: number): void {
  try {
    localStorage.setItem(STORE_PREFIX + trackId, String(val));
  } catch {
    /* ignore */
  }
}

export interface RaceEvents {
  countdown: (n: number) => void;
  lap: (car: Car, lapTime: number) => void;
  finish: (car: Car) => void;
  wrongWayBlast?: (car: Car) => void;
}

export class RaceManager {
  track: Track;
  laps = 3;
  readonly NCP = 12;
  seg: number;
  cpIdx: number[];
  record: number | null = null;
  cars: Car[] = [];
  sorted: Car[] = [];
  player: Car | null = null;
  phase: 'idle' | 'countdown' | 'racing' = 'idle';
  time = 0;
  cd = 0;
  cdStage = -1;
  wrongWay = false;
  wrongWayTime = 0;
  readonly wrongWayLimit = 5.0;
  newRecord = false;

  constructor(track: Track) {
    this.track = track;
    this.seg = track.N / this.NCP;
    this.cpIdx = this.buildCheckpoints();
    this.record = loadBestLap(track.theme.id);
  }

  private buildCheckpoints(): number[] {
    const t = this.track;
    if (t.open) {
      return Array.from({ length: this.NCP }, (_, k) =>
        Math.round(t.startIdx + ((k + 1) / this.NCP) * (t.finishIdx - t.startIdx))
      );
    }
    return Array.from({ length: this.NCP }, (_, k) => Math.round(k * this.seg));
  }

  setTrack(track: Track): void {
    this.track = track;
    this.seg = track.N / this.NCP;
    this.cpIdx = this.buildCheckpoints();
    this.record = loadBestLap(track.theme.id);
  }

  reset(cars: Car[], player: Car, laps: number): void {
    this.laps = this.track.open ? 1 : laps;
    this.cars = cars;
    this.player = player;
    this.sorted = cars.slice();
    this.time = 0;
    this.phase = 'countdown';
    this.cd = 0;
    this.cdStage = -1;
    this.wrongWay = false;
    this.wrongWayTime = 0;
    this.newRecord = false;
    this.track.setCountdownLights(-1);

    for (const c of cars) {
      c.frozen = true;
      c.nos = 100;
      c.hp = c.maxHp;
      c.blasted = false;
      c.blastTimer = 0;
      c.respawnProtect = 0;
      c.sinceHit = 99;
      c.takedowns = 0;
      c.lastAttackerId = null;
      c.gunYaw = c.targetGunYaw = 0;
      c.gunPitch = c.targetGunPitch = 0.02;
      c.driftScore = 0;
      c.totalDriftScore = 0;
      c.race = {
        cp: 0,
        lap: 1,
        lapStart: 0,
        best: null,
        last: null,
        finished: false,
        finishTime: null,
        place: 0,
        progress: 0,
        prevIdx: c.idx,
        wrongT: 0,
        startIdx: c.idx,
        startLat: c.lat,
      };
    }
    this.rank();
  }

  rank(): void {
    const N = this.track.N;
    for (const c of this.cars) {
      const r = c.race!;
      if (r.finished && r.finishTime != null) {
        r.progress = 1e7 - r.finishTime;
        continue;
      }
      if (this.track.open) {
        r.progress = c.idx;
        continue;
      }
      let toNext = (this.cpIdx[r.cp % this.NCP] - c.idx + N) % N;
      if (toNext > N / 2) toNext -= N;
      r.progress = r.cp * this.seg - toNext;
    }
    this.sorted.sort((a, b) => b.race!.progress - a.race!.progress);
    this.sorted.forEach((c, i) => {
      c.race!.place = i + 1;
    });
  }

  update(dt: number, ev: RaceEvents): void {
    const t = this.track;
    const N = t.N;
    if (this.phase === 'countdown') {
      this.cd += dt;
      const stage = Math.floor(this.cd - 0.75);
      if (this.cd >= 0.75 && stage !== this.cdStage) {
        this.cdStage = stage;
        if (stage < 3) {
          this.track.setCountdownLights(stage);
          ev.countdown(3 - stage);
        } else {
          this.track.setCountdownLights(3);
          ev.countdown(0);
          this.phase = 'racing';
          for (const c of this.cars) c.frozen = false;
        }
      }
      return;
    }

    if (this.phase !== 'racing') return;
    this.time += dt;
    const fired: [Car, number][] = [];

    for (const c of this.cars) {
      const r = c.race!;
      if (!r.finished && !c.remote) {
        if (t.open) {
          if (r.cp < this.NCP && c.idx >= this.cpIdx[r.cp]) {
            if (r.cp === this.NCP - 1) {
              const lt = this.time - r.lapStart;
              r.last = lt;
              r.lapStart = this.time;
              r.best = lt;
              if (c === this.player && (this.record == null || lt < this.record)) {
                this.record = lt;
                this.newRecord = true;
                saveBestLap(this.track.theme.id, lt);
              }
              r.finished = true;
              r.finishTime = this.time;
              fired.push([c, lt]);
            }
            r.cp++;
          }
        } else {
          const cpi = this.cpIdx[r.cp % this.NCP];
          const rel = (c.idx - cpi + N) % N;
          const prel = (r.prevIdx - cpi + N) % N;
          if (prel > N / 2 && rel < 32) {
            if (r.cp % this.NCP === 0 && r.cp > 0) {
              const lt = this.time - r.lapStart;
              r.last = lt;
              r.lapStart = this.time;
              if (r.best == null || lt < r.best) r.best = lt;
              if (c === this.player && (this.record == null || lt < this.record)) {
                this.record = lt;
                this.newRecord = true;
                saveBestLap(this.track.theme.id, lt);
              }
              const done = r.cp / this.NCP;
              if (done >= this.laps) {
                r.finished = true;
                r.finishTime = this.time;
              } else {
                r.lap = done + 1;
              }
              fired.push([c, lt]);
            }
            r.cp++;
          }
        }
      }
      r.prevIdx = c.idx;
    }

    this.rank();
    for (const [c, lt] of fired) {
      ev.lap(c, lt);
      if (c.race!.finished) ev.finish(c);
    }

    const p = this.player;
    if (p && p.race) {
      const pr = p.race;
      const i = p.idx;
      const facing = Math.sin(p.h) * t.tx[i] + Math.cos(p.h) * t.tz[i];
      const velAlong = p.vx * t.tx[i] + p.vz * t.tz[i];
      const spd = Math.hypot(p.vx, p.vz);
      const goingWrongWay = (facing < -0.25 && spd > 2.5) || (velAlong < -3.0 && facing < 0);
      pr.wrongT = goingWrongWay && !pr.finished && !p.blasted ? pr.wrongT + dt : 0;
      this.wrongWayTime = pr.wrongT;
      this.wrongWay = pr.wrongT > 0.8 && !p.blasted;
      if (pr.wrongT >= this.wrongWayLimit && !p.blasted && !pr.finished) {
        pr.wrongT = 0;
        this.wrongWayTime = 0;
        this.wrongWay = false;
        ev.wrongWayBlast?.(p);
      }
    }
  }

  lastCheckpoint(car: Car): { idx: number; lat: number } {
    const r = car.race!;
    if (this.track.open) {
      return r.cp > 0
        ? { idx: this.cpIdx[Math.min(r.cp - 1, this.NCP - 1)], lat: 0 }
        : { idx: r.startIdx, lat: r.startLat };
    }
    return r.cp > 0
      ? { idx: this.cpIdx[(r.cp - 1) % this.NCP], lat: 0 }
      : { idx: r.startIdx, lat: r.startLat };
  }

  syncRespawnBehind(victim: Car, anchor: Car, respawnIdx: number, stepsBack: number): void {
    const r = victim.race;
    const ar = anchor.race;
    if (!r) return;
    const N = this.track.N;
    if (this.track.open) {
      let cp = 0;
      while (cp < this.NCP - 1 && respawnIdx >= this.cpIdx[cp]) cp++;
      r.cp = cp;
      r.prevIdx = respawnIdx;
      return;
    }
    if (ar && r.cp >= ar.cp) {
      const crossedPrev =
        ar.cp > 0 && ((anchor.idx - this.cpIdx[(ar.cp - 1) % this.NCP] + N) % N) <= stepsBack;
      const targetCp = crossedPrev ? Math.max(0, ar.cp - 1) : ar.cp;
      r.cp = targetCp;
      r.lap = Math.min(this.laps, Math.floor(r.cp / this.NCP) + 1);
    }
    r.prevIdx = respawnIdx;
  }
}

