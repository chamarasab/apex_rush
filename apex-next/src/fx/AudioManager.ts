import { clamp } from '../core/config';
import type { CarSpec } from '../cars/carSpecs';

export interface AudioState {
  active: boolean;
  rpm: number;
  throttle: number;
  screech: number;
  speed: number;
  nos: boolean;
  engineType: CarSpec['engineType'];
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engFilter!: BiquadFilterNode;
  private engGain!: GainNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private osc3!: OscillatorNode;
  private scrGain!: GainNode;
  private windGain!: GainNode;
  private nosGain!: GainNode;
  private nosFilter!: BiquadFilterNode;
  private turboGain!: GainNode;
  private turboOsc!: OscillatorNode;
  private lastEngType = '';
  muted = false;
  volume = 0.8;

  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const buf = (this.noise = ctx.createBuffer(1, len, ctx.sampleRate));
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Multi-harmonic engine synth
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 650;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;

    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc3 = ctx.createOscillator();
    this.osc3.type = 'triangle';

    const g2 = ctx.createGain();
    g2.gain.value = 0.42;
    const g3 = ctx.createGain();
    g3.gain.value = 0.35;

    this.osc1.connect(this.engFilter);
    this.osc2.connect(g2);
    g2.connect(this.engFilter);
    this.osc3.connect(g3);
    g3.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.osc1.start();
    this.osc2.start();
    this.osc3.start();

    // High-pitched turbo spool whistle
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain);
    this.turboGain.connect(this.master);
    this.turboOsc.start();

    // Looped noise helpers: tire screech, wind, and NOS jet afterburner
    const loop = (type: BiquadFilterType, freq: number, q: number): [BiquadFilterNode, GainNode] => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start();
      return [f, g];
    };

    const [, scrG] = loop('bandpass', 1550, 5.2);
    this.scrGain = scrG;

    const [, windG] = loop('lowpass', 520, 0.5);
    this.windGain = windG;

    const [nosF, nosG] = loop('bandpass', 420, 1.4);
    this.nosFilter = nosF;
    this.nosGain = nosG;
  }

  update(o: AudioState): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    if (this.lastEngType !== o.engineType) {
      this.lastEngType = o.engineType;
      if (o.engineType === 'ev') {
        this.osc1.type = 'triangle';
        this.osc2.type = 'sine';
        this.osc3.type = 'sine';
      } else {
        this.osc1.type = 'sawtooth';
        this.osc2.type = 'square';
        this.osc3.type = 'triangle';
      }
    }

    // Engine frequency profile per real-world powertrain configuration
    let baseFreq = 46;
    let span = 140;
    let harmonicRatio = 0.5;
    let thirdRatio = 1.5;

    if (o.engineType === 'ev') {
      baseFreq = 110;
      span = 420;
      harmonicRatio = 1.5;
      thirdRatio = 2.0;
    } else if (o.engineType === 'flat6') {
      baseFreq = 54;
      span = 162;
      harmonicRatio = 0.5;
      thirdRatio = 1.333;
    } else if (o.engineType === 'v8') {
      baseFreq = 35;
      span = 110;
      harmonicRatio = 0.5;
      thirdRatio = 1.33;
    } else if (o.engineType === 'v10') {
      baseFreq = 58;
      span = 195;
      harmonicRatio = 0.5;
      thirdRatio = 2.0;
    } else if (o.engineType === '2jz' || o.engineType === 'rb26') {
      baseFreq = 48;
      span = 152;
      harmonicRatio = 0.5;
      thirdRatio = 1.5;
    } else {
      baseFreq = 50;
      span = 148;
    }

    const f =
      o.engineType === 'ev'
        ? baseFreq + o.speed * span + (o.nos ? 95 : 0)
        : baseFreq + o.rpm * span + (o.nos ? 28 : 0);
    this.osc1.frequency.setTargetAtTime(f, t, 0.035);
    this.osc2.frequency.setTargetAtTime(f * harmonicRatio, t, 0.035);
    this.osc3.frequency.setTargetAtTime(f * thirdRatio, t, 0.035);
    this.engFilter.frequency.setTargetAtTime(
      380 + o.rpm * 1700 + o.throttle * 750 + (o.nos ? 900 : 0),
      t,
      0.05
    );
    this.engGain.gain.setTargetAtTime(o.active ? 0.048 + 0.048 * o.throttle + 0.03 * o.rpm : 0, t, 0.06);

    // Turbo spool & EV inverter harmonic
    const isTurbo =
      o.engineType === 'rb26' || o.engineType === '2jz' || o.engineType === 'v8' || o.engineType === 'flat6';
    const isEv = o.engineType === 'ev';
    const whineFreq = isEv
      ? 900 + o.speed * 1850 + (o.nos ? 600 : 0)
      : 2200 + o.rpm * 3400 + (o.nos ? 1200 : 0);
    const whineGain = !o.active
      ? 0
      : isEv
      ? clamp(o.speed * 0.022, 0, 0.028)
      : isTurbo
      ? clamp((o.rpm - 0.3) * 0.018 * (0.4 + o.throttle), 0, 0.025)
      : 0;
    this.turboOsc.frequency.setTargetAtTime(whineFreq, t, 0.06);
    this.turboGain.gain.setTargetAtTime(whineGain, t, 0.08);

    // Tire screech, wind, NOS afterburner
    this.scrGain.gain.setTargetAtTime(o.active ? o.screech * 0.18 : 0, t, 0.05);
    this.windGain.gain.setTargetAtTime(o.active ? o.speed * o.speed * 0.14 : 0, t, 0.1);
    this.nosFilter.frequency.setTargetAtTime(o.nos ? 760 + o.speed * 420 : 320, t, 0.06);
    this.nosGain.gain.setTargetAtTime(o.active && o.nos ? 0.24 : 0, t, 0.05);
  }

  playBovFlutter(): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Iconic JDM turbo "stu-tu-tu" blow-off flutter
    for (let k = 0; k < 3; k++) {
      const t = now + k * 0.065;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1650 - k * 240, t);
      o.frequency.exponentialRampToValueAtTime(620, t + 0.05);
      g.gain.setValueAtTime(0.065 * (1 - k * 0.24), t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.055);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.06);
    }
  }

  playNosIgnite(): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.18);
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.24);
  }

  beep(freq: number, dur: number, vol = 0.2): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  thud(strength: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = clamp(strength / 14, 0.2, 1);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(125, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    g.gain.setValueAtTime(0.6 * s, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.3);

    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 720;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5 * s, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    n.connect(f);
    f.connect(ng);
    ng.connect(this.master);
    n.start(t, Math.random());
    n.stop(t + 0.16);
  }

  playGunshot(isPlayer: boolean): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const gainScale = isPlayer ? 1.0 : 0.38;

    // Punchy breech thump
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(isPlayer ? 240 : 200, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.065);
    og.gain.setValueAtTime(0.16 * gainScale, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    o.connect(og);
    og.connect(this.master);
    o.start(t);
    o.stop(t + 0.08);

    // Muzzle crack burst
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = isPlayer ? 1450 : 1200;
    f.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18 * gainScale, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    n.connect(f);
    f.connect(ng);
    ng.connect(this.master);
    n.start(t, Math.random());
    n.stop(t + 0.08);
  }

  playHitMarker(): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1750, t);
    o.frequency.exponentialRampToValueAtTime(2450, t + 0.035);
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.05);
  }

  playExplosion(proximity = 1): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = clamp(proximity, 0.25, 1.0);

    // Sub-bass detonation drop
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(105, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.48);
    og.gain.setValueAtTime(0.55 * s, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.56);
    o.connect(og);
    og.connect(this.master);
    o.start(t);
    o.stop(t + 0.6);

    // Debris explosion roar
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1600, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.65);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.48 * s, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    n.connect(f);
    f.connect(ng);
    ng.connect(this.master);
    n.start(t, Math.random());
    n.stop(t + 0.72);
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    if (this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }
}

