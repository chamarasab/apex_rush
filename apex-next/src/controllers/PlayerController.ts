import { clamp } from '../core/config';
import type { Car } from '../cars/Car';

export type PlayerAction = 'camera' | 'reset' | 'mute' | 'pause' | 'confirm';

export class PlayerController {
  private keys: Record<string, boolean> = {};
  private onAction: (action: PlayerAction) => void;
  private touch = { left: 0, right: 0, gas: 0, brake: 0, drift: 0, nos: 0, fire: 0, rocket: 0 };
  private pad = { steer: 0, gas: 0, brake: 0, drift: false, nos: false, fire: false, rocket: false, prev: {} as Record<number, boolean> };

  readonly mouse = {
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.42,
    ndcX: 0,
    ndcY: 0.16,
    down: false,
    rightDown: false,
    moved: false,
  };

  constructor(onAction: (action: PlayerAction) => void) {
    this.onAction = onAction;
    const actions: Record<string, PlayerAction> = {
      KeyC: 'camera',
      KeyR: 'reset',
      KeyM: 'mute',
      KeyP: 'pause',
      Escape: 'pause',
      Enter: 'confirm',
    };

    window.addEventListener('contextmenu', e => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
    });

    window.addEventListener('keydown', e => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        const inUi = tag === 'BUTTON' || tag === 'A' || !!target?.closest('dialog[open]');
        if (!inUi) e.preventDefault();
      }
      if (!e.repeat && actions[e.code] && !(e.code === 'Enter' && tag === 'BUTTON')) {
        this.onAction(actions[e.code]);
      }
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });

    window.addEventListener('blur', () => {
      this.keys = {};
      this.mouse.down = false;
      this.mouse.rightDown = false;
    });

    window.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.ndcX = (e.clientX / w) * 2 - 1;
      this.mouse.ndcY = -(e.clientY / h) * 2 + 1;
      this.mouse.moved = true;
    });

    window.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      if (e.button !== 0 && e.button !== 2) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, a, input, select, dialog, .garage-panel, .card, .hud-top-actions, #touch')) {
        return;
      }
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.ndcX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      this.mouse.ndcY = -(e.clientY / Math.max(1, window.innerHeight)) * 2 + 1;
      this.mouse.moved = true;
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) {
        e.preventDefault();
        this.mouse.rightDown = true;
      }
    });

    window.addEventListener('pointerup', e => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });

    window.addEventListener('pointercancel', () => {
      this.mouse.down = false;
      this.mouse.rightDown = false;
    });

    const bind = (id: string, key: keyof typeof this.touch) => {
      const el = document.getElementById(id);
      if (!el) return;
      const set = (v: number) => (e: Event) => {
        e.preventDefault();
        this.touch[key] = v;
        el.classList.toggle('on', !!v);
      };
      el.addEventListener('pointerdown', set(1));
      el.addEventListener('pointerup', set(0));
      el.addEventListener('pointercancel', set(0));
      el.addEventListener('pointerleave', set(0));
    };

    bind('tLeft', 'left');
    bind('tRight', 'right');
    bind('tGas', 'gas');
    bind('tBrake', 'brake');
    bind('tDrift', 'drift');
    bind('tNos', 'nos');
    bind('tFire', 'fire');
    bind('tRocket', 'rocket');
  }

  pollPad(): void {
    const s = this.pad;
    let gp: Gamepad | null = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.connected) {
        gp = p;
        break;
      }
    }
    if (!gp) {
      s.steer = s.gas = s.brake = 0;
      s.drift = false;
      s.nos = false;
      s.rocket = false;
      return;
    }
    const b = (i: number) => (gp!.buttons[i] ? gp!.buttons[i].value : 0);
    const pr = (i: number) => !!(gp!.buttons[i] && gp!.buttons[i].pressed);
    const ax = gp.axes[0] || 0;
    s.steer = (Math.abs(ax) > 0.12 ? -ax : 0) + (pr(14) ? 1 : 0) - (pr(15) ? 1 : 0);
    s.gas = b(7);
    s.brake = b(6);
    s.drift = pr(0) || pr(2); // A / X
    s.nos = pr(1) || pr(3); // B / Y
    s.fire = pr(4) || pr(11); // LB / R3
    s.rocket = pr(5) || pr(10); // RB / L3

    const padMap: [number, PlayerAction][] = [
      [9, 'pause'],
      [3, 'camera'],
      [8, 'reset'],
    ];
    for (const [i, name] of padMap) {
      const now = pr(i);
      if (now && !s.prev[i]) this.onAction(name);
      s.prev[i] = now;
    }
  }

  apply(car: Car): void {
    const k = this.keys;
    const t = this.touch;
    const p = this.pad;
    const inp = car.input;

    const up = k.KeyW || k.ArrowUp ? 1 : 0;
    const sBrake = k.KeyS ? 1 : 0;
    const downArrow = !!k.ArrowDown;
    const spaceDrift = !!k.Space;

    inp.throttle = clamp(Math.max(up, t.gas, p.gas), 0, 1);
    inp.steer = clamp(
      (k.KeyA || k.ArrowLeft ? 1 : 0) - (k.KeyD || k.ArrowRight ? 1 : 0) + t.left - t.right + p.steer,
      -1,
      1
    );

    // Requested mapping: Drift = [Space or Down Arrow], NOS = [Shift]
    // Smart Down-Arrow handling: triggers Drift while moving at speed (> 4.5 m/s),
    // and smoothly acts as Brake/Reverse when nearly stopped so Arrow-key drivers can reverse cleanly.
    const downAsDrift = downArrow && car.speed > 4.5;
    const downAsReverse = downArrow && car.speed <= 4.5 && up === 0;

    inp.drift = !!(spaceDrift || downAsDrift || t.drift > 0 || p.drift);
    inp.brake = clamp(Math.max(sBrake, downAsReverse ? 1 : 0, t.brake, p.brake), 0, 1);
    inp.nos = !!(k.ShiftLeft || k.ShiftRight || t.nos > 0 || p.nos);
    inp.fire = !!(this.mouse.down || k.KeyF || k.KeyJ || t.fire > 0 || p.fire);
    inp.rocket = !!(this.mouse.rightDown || k.KeyE || k.KeyX || t.rocket > 0 || p.rocket);
  }
}

