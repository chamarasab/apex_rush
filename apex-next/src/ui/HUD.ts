import { clamp, damp, fmtTime, ordinal } from '../core/config';
import type { Car } from '../cars/Car';
import type { RaceManager } from '../core/RaceManager';
import type { Track } from '../tracks/Track';

export class HUD {
  private track: Track;
  private el: Record<string, HTMLElement>;
  private sp: CanvasRenderingContext2D;
  private mm: CanvasRenderingContext2D;
  private speedLinesCtx: CanvasRenderingContext2D;
  private speedLinesCanvas: HTMLCanvasElement;
  private mmBg!: HTMLCanvasElement;
  private mmScale = 1;
  private mmOx = 0;
  private mmOy = 0;

  private cache: Record<string, string> = {};
  private toastT = 0;
  kmh = 0;
  boardKey: string | null = null;
  private lines: { a: number; r: number; len: number; spd: number }[] = [];

  constructor(track: Track) {
    this.track = track;
    this.el = {};
    const ids = [
      'hud',
      'posNum',
      'posSuf',
      'posTot',
      'lapNum',
      'lapTot',
      'board',
      'tTotal',
      'tLap',
      'tLast',
      'tBest',
      'countdown',
      'wrongway',
      'toast',
      'help',
      'driftBadge',
      'driftPts',
      'nosFill',
      'nosPct',
      'nosTag',
      'nosWrap',
    ];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node) this.el[id] = node;
    }

    this.sp = (document.getElementById('speedo') as HTMLCanvasElement).getContext('2d')!;
    this.mm = (document.getElementById('minimap') as HTMLCanvasElement).getContext('2d')!;
    this.speedLinesCanvas = document.getElementById('speedLines') as HTMLCanvasElement;
    this.speedLinesCtx = this.speedLinesCanvas.getContext('2d')!;

    for (let i = 0; i < 42; i++) {
      this.lines.push({
        a: Math.random() * Math.PI * 2,
        r: 0.35 + Math.random() * 0.4,
        len: 40 + Math.random() * 110,
        spd: 1.4 + Math.random() * 1.8,
      });
    }

    this.buildMinimap();
  }

  setTrack(track: Track): void {
    this.track = track;
    this.buildMinimap();
  }

  resize(w: number, h: number): void {
    this.speedLinesCanvas.width = w;
    this.speedLinesCanvas.height = h;
  }

  private set(id: string, v: string): void {
    if (this.cache[id] !== v && this.el[id]) {
      this.cache[id] = v;
      this.el[id].textContent = v;
    }
  }

  private buildMinimap(): void {
    const t = this.track;
    const S = 180;
    const pad = 16;
    const sc = (this.mmScale = Math.min((S - pad * 2) / (t.maxX - t.minX), (S - pad * 2) / (t.maxZ - t.minZ)));
    this.mmOx = (S - (t.maxX - t.minX) * sc) / 2 - t.minX * sc;
    this.mmOy = (S - (t.maxZ - t.minZ) * sc) / 2 - t.minZ * sc;

    const c = (this.mmBg = document.createElement('canvas'));
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < t.N; i += 3) {
      const x = t.px[i] * sc + this.mmOx;
      const y = t.pz[i] * sc + this.mmOy;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    if (t.open) {
      g.lineTo(t.px[t.N - 1] * sc + this.mmOx, t.pz[t.N - 1] * sc + this.mmOy);
    } else {
      g.closePath();
    }
    g.strokeStyle = 'rgba(0,0,0,0.68)';
    g.lineWidth = 8.5;
    g.stroke();
    g.strokeStyle = t.theme.accentHex;
    g.lineWidth = 3.5;
    g.stroke();

    if (t.open) {
      // Green Start bar at Peliyagoda + Gold Finish bar at Katunayake
      const sx = t.px[t.startIdx] * sc + this.mmOx;
      const sy = t.pz[t.startIdx] * sc + this.mmOy;
      g.beginPath();
      g.arc(sx, sy, 4.5, 0, Math.PI * 2);
      g.fillStyle = '#39ff14';
      g.fill();

      const fi = t.finishIdx;
      const fx = t.px[fi] * sc + this.mmOx;
      const fy = t.pz[fi] * sc + this.mmOy;
      g.strokeStyle = '#ffd54a';
      g.lineWidth = 3.2;
      g.beginPath();
      g.moveTo(fx + t.lx[fi] * 7, fy + t.lz[fi] * 7);
      g.lineTo(fx - t.lx[fi] * 7, fy - t.lz[fi] * 7);
      g.stroke();
    } else {
      const x0 = t.px[0] * sc + this.mmOx;
      const y0 = t.pz[0] * sc + this.mmOy;
      g.strokeStyle = '#ffd54a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x0 + t.lx[0] * 7, y0 + t.lz[0] * 7);
      g.lineTo(x0 - t.lx[0] * 7, y0 - t.lz[0] * 7);
      g.stroke();
    }
  }

  show(v: boolean): void {
    this.el.hud?.classList.toggle('hidden', !v);
    this.speedLinesCanvas.classList.toggle('hidden', !v);
  }

  countdown(text: string, go = false): void {
    const e = this.el.countdown;
    if (!e) return;
    e.textContent = text;
    e.classList.toggle('go', go);
    e.classList.remove('pop');
    void e.offsetWidth;
    e.classList.add('pop');
  }

  clearCountdown(): void {
    this.el.countdown?.classList.remove('pop');
  }

  toast(text: string, dur = 1.6): void {
    const e = this.el.toast;
    if (!e) return;
    e.textContent = text;
    e.classList.add('show');
    this.toastT = dur;
  }

  updateBoard(sorted: Car[], player: Car): void {
    const key = sorted.map(c => c.id).join('|');
    if (key === this.boardKey || !this.el.board) return;
    this.boardKey = key;
    const b = this.el.board;
    b.textContent = '';
    sorted.forEach((c, i) => {
      const row = document.createElement('div');
      if (c === player) row.className = 'me';
      const n = document.createElement('span');
      n.textContent = String(i + 1);
      const dot = document.createElement('i');
      dot.style.background = c.colorHex;
      const nm = document.createElement('span');
      nm.textContent = c.name;
      row.append(n, dot, nm);
      b.appendChild(row);
    });
  }

  update(player: Car, cars: Car[], race: RaceManager, gear: number, rpm: number, dt: number): void {
    const r = player.race!;
    this.set('posNum', String(r.place));
    this.set('posSuf', ordinal(r.place));
    this.set('posTot', '/' + cars.length);
    this.set('lapNum', String(Math.min(race.laps, r.lap)));
    this.set('lapTot', String(race.laps));
    this.set('tTotal', fmtTime(r.finished ? r.finishTime : race.time));
    this.set('tLap', fmtTime(r.finished ? r.last : race.time - r.lapStart));
    this.set('tLast', fmtTime(r.last));
    this.set('tBest', fmtTime(race.record));

    this.updateBoard(race.sorted, player);
    this.el.wrongway?.classList.toggle('hidden', !race.wrongWay);

    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.el.toast?.classList.remove('show');
    }

    // Drift live badge
    const showDrift = player.driftScore > 20;
    this.el.driftBadge?.classList.toggle('active', showDrift);
    if (showDrift) {
      this.set('driftPts', `+${Math.round(player.driftScore).toLocaleString()}`);
    }

    // NOS Tank Bar
    const nosPct = Math.round(player.nos);
    this.set('nosPct', `${nosPct}%`);
    if (this.el.nosFill) {
      this.el.nosFill.style.setProperty('--nos-pct', `${player.nos.toFixed(1)}%`);
    }
    this.el.nosWrap?.classList.toggle('boosting', player.nosActive);
    if (this.el.nosTag) {
      this.el.nosTag.textContent = player.nosActive ? 'NOS ACTIVE!' : player.nos > 15 ? 'NOS READY [SHIFT]' : 'DRIFT TO CHARGE';
    }

    this.kmh = damp(this.kmh, Math.hypot(player.vx, player.vz) * 3.6, 12, dt);
    this.drawSpeedo(this.kmh, player.speed < -0.5 ? 'R' : String(gear), rpm, player.nosActive);
    this.drawMinimap(cars, player);
    this.drawSpeedLines(player, dt);
  }

  private drawSpeedo(kmh: number, gear: string, rpm: number, nos: boolean): void {
    const c = this.sp;
    const cx = 100;
    const cy = 102;
    const r = 80;
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const max = 360;
    const a = a0 + (a1 - a0) * clamp(kmh / max, 0, 1);

    c.clearRect(0, 0, 200, 200);
    c.beginPath();
    c.arc(cx, cy, r + 13, 0, 6.2832);
    c.fillStyle = 'rgba(7, 10, 18, 0.72)';
    c.fill();

    // Outer RPM ring
    c.lineWidth = 4;
    c.beginPath();
    c.arc(cx, cy, r + 8, a0, a0 + (a1 - a0) * clamp(rpm, 0.04, 1));
    c.strokeStyle = rpm > 0.86 ? '#ff3b3b' : '#4fe3ff';
    c.stroke();

    // Speed track background
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(cx, cy, r - 2, a0, a1);
    c.strokeStyle = 'rgba(255,255,255,0.11)';
    c.stroke();

    const g = c.createLinearGradient(20, 0, 180, 0);
    g.addColorStop(0, nos ? '#00f2ff' : '#27e0ff');
    g.addColorStop(0.6, '#ffe14a');
    g.addColorStop(1, '#ff2d55');
    c.beginPath();
    c.arc(cx, cy, r - 2, a0, Math.max(a, a0 + 0.001));
    c.strokeStyle = g;
    c.stroke();

    c.lineCap = 'butt';
    c.fillStyle = 'rgba(255,255,255,0.82)';
    c.font = '600 9px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let v = 0; v <= max; v += 20) {
      const t = a0 + (a1 - a0) * (v / max);
      const major = v % 40 === 0;
      const r1 = r - 10;
      const r2 = r - (major ? 18 : 13);
      const co = Math.cos(t);
      const si = Math.sin(t);
      c.beginPath();
      c.moveTo(cx + co * r1, cy + si * r1);
      c.lineTo(cx + co * r2, cy + si * r2);
      c.strokeStyle = major ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
      c.lineWidth = major ? 2 : 1;
      c.stroke();
      if (major) c.fillText(String(v), cx + co * (r - 29), cy + si * (r - 29));
    }

    const co = Math.cos(a);
    const si = Math.sin(a);
    c.beginPath();
    c.moveTo(cx - co * 12, cy - si * 12);
    c.lineTo(cx + co * (r - 15), cy + si * (r - 15));
    c.strokeStyle = nos ? '#00f2ff' : '#ff4c3b';
    c.lineWidth = 3.5;
    c.lineCap = 'round';
    c.stroke();

    c.beginPath();
    c.arc(cx, cy, 7, 0, 6.2832);
    c.fillStyle = '#eef2f7';
    c.fill();

    c.fillStyle = '#ffffff';
    c.font = 'italic 900 30px system-ui, sans-serif';
    c.fillText(String(Math.round(kmh)), cx, cy + 38);
    c.font = '600 10px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.65)';
    c.fillText('KM/H', cx, cy + 56);
    c.font = 'italic 800 17px system-ui, sans-serif';
    c.fillStyle = nos ? '#00f2ff' : '#4fe3ff';
    c.fillText(gear, cx, cy - 26);
  }

  private drawMinimap(cars: Car[], player: Car): void {
    const c = this.mm;
    const sc = this.mmScale;
    c.clearRect(0, 0, 180, 180);
    c.drawImage(this.mmBg, 0, 0);

    for (const car of cars) {
      if (car === player) continue;
      c.beginPath();
      c.arc(car.x * sc + this.mmOx, car.z * sc + this.mmOy, 3.8, 0, 6.2832);
      c.fillStyle = car.colorHex;
      c.fill();
      c.lineWidth = 1.2;
      c.strokeStyle = 'rgba(0,0,0,0.75)';
      c.stroke();
    }

    const px = player.x * sc + this.mmOx;
    const py = player.z * sc + this.mmOy;
    c.save();
    c.translate(px, py);
    c.rotate(-player.h + Math.PI);
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 5);
    c.lineTo(0, 2.5);
    c.lineTo(-5, 5);
    c.closePath();
    c.fillStyle = '#ffffff';
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = player.colorHex;
    c.stroke();
    c.restore();
  }

  private drawSpeedLines(player: Car, dt: number): void {
    const ctx = this.speedLinesCtx;
    const w = this.speedLinesCanvas.width;
    const h = this.speedLinesCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const speedRatio = clamp((Math.hypot(player.vx, player.vz) - 45) / 45, 0, 1);
    const intensity = player.nosActive ? Math.max(0.65, speedRatio) : speedRatio * 0.5;
    if (intensity <= 0.03) return;

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.hypot(cx, cy);

    ctx.lineCap = 'round';
    for (const l of this.lines) {
      l.r += l.spd * dt * (1 + intensity);
      if (l.r > 1.05) l.r = 0.35 + Math.random() * 0.15;
      const r0 = l.r * maxR;
      const r1 = r0 + l.len * (0.6 + intensity);
      const co = Math.cos(l.a);
      const si = Math.sin(l.a);
      ctx.beginPath();
      ctx.moveTo(cx + co * r0, cy + si * r0);
      ctx.lineTo(cx + co * r1, cy + si * r1);
      ctx.strokeStyle = player.nosActive
        ? `rgba(0, 235, 255, ${(intensity * 0.36).toFixed(3)})`
        : `rgba(255, 255, 255, ${(intensity * 0.2).toFixed(3)})`;
      ctx.lineWidth = player.nosActive ? 2.2 : 1.4;
      ctx.stroke();
    }
  }
}

