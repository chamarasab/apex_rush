import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  BOT_NAMES,
  clamp,
  DIFFS,
  DT,
  PAINT_COLORS,
  ROAD_Y,
  UNDERGLOW_COLORS,
  type DiffKey,
  type QualityLevel,
} from './config';
import { CAR_IDS, CAR_SPECS } from '../cars/carSpecs';
import { Car } from '../cars/Car';
import { TRACK_IDS, TRACKS, type TrackId } from '../tracks/trackData';
import { Track } from '../tracks/Track';
import { Scenery } from '../tracks/Scenery';
import { Particles, SkidMarks } from '../fx/Particles';
import { AudioManager } from '../fx/AudioManager';
import { PlayerController, type PlayerAction } from '../controllers/PlayerController';
import { AIController } from '../controllers/AIController';
import { CameraController } from './CameraController';
import { RaceManager, loadBestLap } from './RaceManager';
import { HUD } from '../ui/HUD';
import { cleanProfile, Net, type PlayerProfile, type RaceStartConfig } from '../net/Net';
import { WeaponSystem } from '../combat/Weapons';
import { fmtTime, ordinal } from './config';

const PROFILE_KEY = 'apexnext_profile';
const QUALITY_KEY = 'apexnext_quality';

function loadProfile(): PlayerProfile {
  try {
    return cleanProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'), '');
  } catch {
    return cleanProfile(null, '');
  }
}

function saveProfile(p: PlayerProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function loadQuality(): QualityLevel {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    return q === 'medium' || q === 'high' || q === 'ultra' ? q : 'high';
  } catch {
    return 'high';
  }
}

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private track: Track;
  private scenery: Scenery;
  private particles: Particles;
  private skids: SkidMarks;
  private audio: AudioManager;
  private hud: HUD;
  private race: RaceManager;
  private camCtl: CameraController;
  private input: PlayerController;
  private net: Net;
  private weapons: WeaponSystem;
  private playerAimTarget = new THREE.Vector3();
  private lockedTarget: Car | null = null;
  private prevLockedTarget: Car | null = null;

  private state: 'menu' | 'race' = 'menu';
  private screen: 'menu' | 'lobby' | 'finish' | null = 'menu';
  private paused = false;
  private finishShown = false;

  private cars: Car[] = [];
  private ais: AIController[] = [];
  private carById = new Map<string, Car>();
  private player: Car | null = null;
  private autoPilot: AIController | null = null;
  private showcase: Car | null = null;

  private acc = 0;
  private last = performance.now();
  private elapsed = 0;
  private thudCd = 0;
  private gear = 1;
  private rpm = 0.2;
  private netTick = 0;
  private resultsT = 0;

  private profile: PlayerProfile = loadProfile();
  private selectedTrack: TrackId = 'tokyo';
  private laps = 3;
  private difficulty: DiffKey = 'normal';
  private botCount = 3;
  private quality: QualityLevel = loadQuality();
  private isTouch = false;

  private _w = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  ];

  private pauseDialog: HTMLDialogElement;
  private settingsDialog: HTMLDialogElement;
  private helpTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, 1, 0.35, 4500);

    // Post-processing HDR Composer with Bloom (HalfFloat avoids LDR sky blowout before OutputPass ACES tone-mapping)
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
      type: THREE.HalfFloatType,
      samples: this.quality === 'ultra' ? 4 : 0,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.42, 0.92);
    const outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(outputPass);

    this.track = new Track(this.scene, this.selectedTrack);
    this.scenery = new Scenery(this.scene, this.track, this.renderer);
    this.particles = new Particles(this.scene);
    this.skids = new SkidMarks(this.scene);
    this.audio = new AudioManager();
    this.hud = new HUD(this.track);
    this.race = new RaceManager(this.track);
    this.camCtl = new CameraController(this.camera);
    this.input = new PlayerController(a => this.action(a));
    this.weapons = new WeaponSystem(this.scene);
    this.net = new Net({
      onLobby: () => this.onLobby(),
      onLeft: id => this.onLeft(id),
      onNetClosed: r => this.onNetClosed(r),
      beginRace: (cfg, myId) => this.beginRace(cfg, myId),
      applyStates: (list, lead) => this.applyStates(list, lead),
      showLobby: () => this.showLobby(),
    });

    this.pauseDialog = document.getElementById('pauseDialog') as HTMLDialogElement;
    this.settingsDialog = document.getElementById('settingsDialog') as HTMLDialogElement;

    this.setupUI();
    this.setupShowroomDrag();
    this.applyQuality(this.quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'race' && !this.mp && !this.paused && this.player && !this.player.race?.finished) {
        this.setPaused(true);
      }
    });

    this.showMenu();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  private get mp(): boolean {
    return this.net.active;
  }

  private getProfile(): PlayerProfile {
    return cleanProfile(this.profile);
  }

  private $(id: string): HTMLElement {
    return document.getElementById(id)!;
  }

  private setupShowroomDrag(): void {
    let dragging = false;
    let lx = 0;
    let ly = 0;

    this.canvas.addEventListener('pointerdown', e => {
      if (this.state !== 'menu') return;
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
    });

    window.addEventListener('pointermove', e => {
      if (!dragging || this.state !== 'menu') return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      this.camCtl.dragOrbit(dx, dy);
    });

    window.addEventListener('pointerup', () => {
      dragging = false;
    });
  }

  private drawTrackThumb(trackId: TrackId, canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    const th = TRACKS[trackId];
    const open = !!th.open;
    const pts = new THREE.CatmullRomCurve3(
      th.points.map(p => new THREE.Vector3(p[0], p[1], p[2])),
      !open,
      'centripetal'
    ).getSpacedPoints(120);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const w = canvas.width;
    const h = canvas.height;
    const pad = 8;
    const sc = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
    const ox = (w - (maxX - minX) * sc) / 2 - minX * sc;
    const oy = (h - (maxZ - minZ) * sc) / 2 - minZ * sc;

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    pts.forEach((p, idx) => {
      const x = p.x * sc + ox;
      const y = p.z * sc + oy;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (!open) ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = th.accentHex;
    ctx.lineWidth = 3;
    ctx.stroke();

    if (open) {
      ctx.fillStyle = '#39ff14';
      ctx.beginPath();
      ctx.arc(pts[0].x * sc + ox, pts[0].z * sc + oy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd54a';
      ctx.beginPath();
      ctx.arc(pts[pts.length - 1].x * sc + ox, pts[pts.length - 1].z * sc + oy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private setupUI(): void {
    const P = this.profile;
    const pick = (box: HTMLElement, el: Element) => {
      box.querySelectorAll('.sel').forEach(e => e.classList.remove('sel'));
      el.classList.add('sel');
    };

    const nameInput = this.$('nameInput') as HTMLInputElement;
    nameInput.value = P.name;
    nameInput.addEventListener('input', () => {
      P.name = nameInput.value;
      saveProfile(P);
    });

    // 5 Requested Car Models
    const carList = this.$('carList');
    const bar = (label: string, v: number) =>
      `<div class="stat-bar"><span>${label}</span><div class="bar"><i style="width:${Math.round(clamp(v, 0.1, 1) * 100)}%"></i></div></div>`;

    for (const id of CAR_IDS) {
      const S = CAR_SPECS[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'car-card' + (id === P.type ? ' sel' : '');
      card.innerHTML =
        `<div class="car-head"><strong>${S.name}</strong><small>${S.tag}</small>` +
        `<div class="car-telemetry">${S.powerHp} HP · 0–100 ${S.zeroToHundred} · ${S.topKmh} km/h · ${S.weightKg.toLocaleString()} kg</div></div>` +
        `<div class="car-bars">${bar('SPD', S.bars.speed)}${bar('ACC', S.bars.accel)}${bar('DRF', S.bars.drift)}${bar('NOS', S.bars.nos)}</div>`;
      card.addEventListener('click', () => {
        pick(carList, card);
        P.type = id;
        // Apply iconic default paint when switching if user hasn't picked custom? Let's keep current paint or update badge
        saveProfile(P);
        this.setShowcase();
      });
      carList.appendChild(card);
    }

    // Paint swatches
    const colorsBox = this.$('colors');
    for (const c of PAINT_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sw' + (c.hex === P.color ? ' sel' : '');
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.addEventListener('click', () => {
        pick(colorsBox, b);
        P.color = c.hex;
        saveProfile(P);
        this.showcase?.setColor(c.hex);
      });
      colorsBox.appendChild(b);
    }

    // Underglow swatches
    const glowBox = this.$('underglows');
    for (const g of UNDERGLOW_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sw glow-sw' + (g.hex === P.underglow ? ' sel' : '');
      b.style.background = g.hex === 'off' ? 'transparent' : g.hex;
      if (g.hex === 'off') b.textContent = '×';
      b.title = `Underglow: ${g.name}`;
      b.setAttribute('aria-label', `Underglow ${g.name}`);
      b.addEventListener('click', () => {
        pick(glowBox, b);
        P.underglow = g.hex;
        saveProfile(P);
        this.showcase?.setUnderglow(g.hex);
      });
      glowBox.appendChild(b);
    }

    // 4 Selectable Tracks
    const trackGrid = this.$('trackGrid');
    for (const tid of TRACK_IDS) {
      const T = TRACKS[tid];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'track-card' + (tid === this.selectedTrack ? ' sel' : '');
      card.innerHTML =
        `<canvas class="track-thumb" width="76" height="54" aria-hidden="true"></canvas>` +
        `<div class="track-info"><span class="track-badge" style="color:${T.accentHex}">${T.badge}</span><strong>${T.name}</strong><small>${T.subtitle}</small></div>`;
      const thumb = card.querySelector('canvas') as HTMLCanvasElement;
      this.drawTrackThumb(tid, thumb);
      card.addEventListener('click', () => {
        pick(trackGrid, card);
        this.switchTrack(tid);
      });
      trackGrid.appendChild(card);
    }

    // Lobby track selector for host
    const lobbyTrackSel = this.$('lobbyTrackSel') as HTMLSelectElement;
    for (const tid of TRACK_IDS) {
      const opt = document.createElement('option');
      opt.value = tid;
      opt.textContent = `${TRACKS[tid].name} (${TRACKS[tid].badge})`;
      lobbyTrackSel.appendChild(opt);
    }
    lobbyTrackSel.value = this.selectedTrack;
    this.syncLapModeUI(this.selectedTrack);
    lobbyTrackSel.addEventListener('change', () => {
      const tid = lobbyTrackSel.value as TrackId;
      this.switchTrack(tid);
      if (this.net.isHost) this.net.setHostSettings(tid, TRACKS[tid].open ? 1 : this.laps);
    });

    // Difficulty, Laps, Bots
    this.$('diff').querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        pick(this.$('diff'), b);
        this.difficulty = (b as HTMLElement).dataset.d as DiffKey;
      });
    });

    this.$('lapsSeg').querySelectorAll('button[data-l]').forEach(b => {
      b.addEventListener('click', () => {
        pick(this.$('lapsSeg'), b);
        this.laps = Number((b as HTMLElement).dataset.l) || 3;
        if (this.net.isHost) this.net.setHostSettings(this.selectedTrack, this.laps);
      });
    });

    this.$('bots').querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        pick(this.$('bots'), b);
        this.botCount = Number((b as HTMLElement).dataset.n) || 0;
      });
    });

    const code = this.$('codeInput') as HTMLInputElement;
    code.addEventListener('input', () => {
      code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    code.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) this.joinGame();
    });

    this.$('startBtn').addEventListener('click', () => this.startSingle());
    this.$('hostBtn').addEventListener('click', () => this.hostGame());
    this.$('joinBtn').addEventListener('click', () => this.joinGame());
    this.$('lobbyStart').addEventListener('click', () => this.hostStart());
    this.$('lobbyLeave').addEventListener('click', () => this.leave());
    this.$('againBtn').addEventListener('click', () => (this.mp ? this.backToLobby() : this.startSingle()));
    this.$('finQuitBtn').addEventListener('click', () => this.leave());
    this.$('pauseBtn').addEventListener('click', () => this.action('pause'));

    // Settings native dialog
    this.$('settingsBtn').addEventListener('click', () => this.settingsDialog.showModal());
    this.$('hudSettingsBtn').addEventListener('click', () => this.settingsDialog.showModal());

    // Fallback light-dismiss for browsers lacking dialog[closedby="any"]
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const outside = (e: PointerEvent, dlg: HTMLDialogElement) => {
        const r = dlg.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      for (const dlg of [this.settingsDialog]) {
        let pressedOutside = false;
        dlg.addEventListener('pointerdown', e => {
          pressedOutside = outside(e, dlg);
        });
        dlg.addEventListener('pointerup', e => {
          if (pressedOutside && outside(e, dlg)) dlg.close();
        });
      }
    }

    // Quality buttons inside settings dialog
    const qualSeg = this.$('qualitySeg');
    qualSeg.querySelectorAll('button').forEach(b => {
      const q = (b as HTMLElement).dataset.q as QualityLevel;
      b.classList.toggle('sel', q === this.quality);
      b.addEventListener('click', () => {
        pick(qualSeg, b);
        this.applyQuality(q);
      });
    });

    const volRange = this.$('volRange') as HTMLInputElement;
    volRange.addEventListener('input', () => {
      this.audio.init();
      this.audio.setVolume(Number(volRange.value) / 100);
    });

    // Pause native dialog actions
    this.pauseDialog.addEventListener('cancel', e => {
      e.preventDefault();
      this.setPaused(false);
    });
    this.pauseDialog.addEventListener('close', () => {
      const val = this.pauseDialog.returnValue;
      this.pauseDialog.returnValue = '';
      if (val === 'restart' && !this.mp) this.startSingle();
      else if (val === 'quit') this.leave();
      else this.setPaused(false);
    });

    this.isTouch = matchMedia('(pointer: coarse)').matches;
    window.addEventListener(
      'touchstart',
      () => {
        if (!this.isTouch) {
          this.isTouch = true;
          this.refreshTouchUI();
        }
      },
      { passive: true }
    );
    this.refreshTouchUI();
  }

  private syncBloom(): void {
    const night = this.track?.theme.night ?? true;
    const ultra = this.quality === 'ultra';
    this.bloomPass.enabled = this.quality !== 'medium';
    this.bloomPass.threshold = night ? 0.9 : 1.04;
    this.bloomPass.strength = night ? (ultra ? 0.56 : 0.44) : (ultra ? 0.34 : 0.24);
    this.bloomPass.radius = night ? 0.46 : 0.36;
  }

  private applyQuality(q: QualityLevel): void {
    this.quality = q;
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {
      /* ignore */
    }
    this.syncBloom();
    this.renderer.shadowMap.enabled = q !== 'medium';
    this.resize();
  }

  private syncLapModeUI(id: TrackId): void {
    const isOpen = !!TRACKS[id].open;
    this.$('lapsLabel').textContent = isOpen ? 'ONE-WAY SPRINT' : 'LAPS';
    this.$('lapsSeg').querySelectorAll('button[data-l]').forEach(b => b.classList.toggle('hidden', isOpen));
    this.$('sprintLapBtn').classList.toggle('hidden', !isOpen);
  }

  private switchTrack(id: TrackId): void {
    if (this.selectedTrack === id && this.track.theme.id === id) return;
    this.selectedTrack = id;

    // Sync menu track highlight & lobby dropdown
    const cards = this.$('trackGrid').querySelectorAll('.track-card');
    TRACK_IDS.forEach((tid, i) => cards[i]?.classList.toggle('sel', tid === id));
    (this.$('lobbyTrackSel') as HTMLSelectElement).value = id;
    this.syncLapModeUI(id);

    this.track.dispose();
    this.scenery.dispose();
    this.track = new Track(this.scene, id);
    this.scenery = new Scenery(this.scene, this.track, this.renderer);
    this.syncBloom();
    this.hud.setTrack(this.track);
    this.race.setTrack(this.track);

    if (this.state === 'menu') {
      this.setShowcase();
      this.$('menuBest').textContent = fmtTime(loadBestLap(id));
    }
  }

  private refreshTouchUI(): void {
    document.body.classList.toggle('touch', this.isTouch);
    this.$('touch').classList.toggle('hidden', !(this.isTouch && this.state === 'race' && !this.finishShown));
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const maxDpr = this.quality === 'ultra' ? 2 : this.quality === 'high' ? 1.5 : 1.15;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.mat.uniforms.uScale.value = this.renderer.domElement.height * 0.8;
    this.hud.resize(w, h);
  }

  private overlay(name: 'menu' | 'lobby' | 'finish' | null): void {
    for (const id of ['menu', 'lobby', 'finish'] as const) {
      this.$(id).classList.toggle('hidden', id !== name);
    }
    this.screen = name;
  }

  private status(msg: string): void {
    this.$('netStatus').textContent = msg || '';
  }

  private clearCars(): void {
    for (const c of this.cars) c.dispose();
    if (this.showcase) {
      this.showcase.dispose();
      this.showcase = null;
    }
    this.cars = [];
    this.ais = [];
    this.carById.clear();
    this.player = null;
    this.autoPilot = null;
    this.particles.reset();
    this.skids.reset();
    this.weapons.reset();
    this.lockedTarget = null;
  }

  private place(car: Car, idx: number, lat: number): void {
    const t = this.track;
    const N = t.N;
    idx = t.open ? clamp(idx, 1, N - 2) : ((idx % N) + N) % N;
    car.x = t.px[idx] + t.lx[idx] * lat;
    car.z = t.pz[idx] + t.lz[idx] * lat;
    car.y = t.py[idx] + ROAD_Y;
    car.h = t.head[idx];
    car.vx = car.vz = 0;
    car.speed = 0;
    car.steer = 0;
    car.slip = 0;
    car.drifting = false;
    car.driftDir = 0;
    car.driftHold = 0;
    car.driftBlend = 0;
    car.exitBoostTimer = 0;
    car.idx = idx;
    car.lat = lat;
    car.slopeRel = t.slope[idx];
    car.pitch = -Math.atan(car.slopeRel);
    car.onGrass = false;
    car.surface = t.surfaceAt(idx);
    car.hp = car.maxHp;
    car.blasted = false;
    car.blastTimer = 0;
    car.sinceHit = 99;
    car.mesh.visible = true;
    car.skidLast[0] = car.skidLast[1] = null;
    car.mesh.rotation.set(car.pitch, car.h, 0);
    const n = car.net;
    n.x = car.x;
    n.z = car.z;
    n.h = car.h;
    n.vx = n.vz = 0;
    n.age = 0;
    car.syncPrev();
    if (car.race) car.race.prevIdx = idx;
  }

  private setShowcase(): void {
    if (this.showcase) this.showcase.dispose();
    const p = this.getProfile();
    this.showcase = new Car(this.scene, p.type, p.color, p.underglow, true);
    const showIdx = this.track.open ? Math.max(4, this.track.startIdx - 3) : this.track.N - 5;
    this.place(this.showcase, showIdx, 0);
    this.scenery.setShowroomPosition(
      new THREE.Vector3(this.showcase.x, this.showcase.y, this.showcase.z),
      this.showcase.h,
      this.showcase.pitch
    );
  }

  private idle(): void {
    this.clearCars();
    this.state = 'menu';
    this.paused = false;
    this.finishShown = false;
    if (this.pauseDialog.open) this.pauseDialog.close();
    this.setShowcase();
    this.$('hudTopActions').classList.add('hidden');
    this.$('pauseBtn').classList.add('hidden');
    this.hud.show(false);
    this.refreshTouchUI();
  }

  private showMenu(msg = ''): void {
    this.idle();
    this.overlay('menu');
    this.$('menuBest').textContent = fmtTime(loadBestLap(this.selectedTrack));
    this.status(msg);
  }

  private showLobby(): void {
    if (!this.net.active) return;
    if (this.state !== 'menu') this.idle();
    if (!this.net.isHost && this.net.trackId !== this.selectedTrack) {
      this.switchTrack(this.net.trackId);
    }
    this.overlay('lobby');
    this.status('');
    this.renderLobby();
  }

  private renderLobby(): void {
    const n = this.net;
    const list = this.$('playerList');
    this.$('roomCode').textContent = n.code;
    list.textContent = '';

    for (const p of n.players) {
      const row = document.createElement('div');
      row.className = 'prow' + (p.id === n.myId ? ' me' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = p.name + (p.id === n.myId ? ' (you)' : '');
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${CAR_SPECS[p.type].shortName}${p.host ? ' · HOST' : p.relay ? ' · relay' : ''}`;
      row.append(dot, nm, meta);
      list.appendChild(row);
    }

    this.$('hostCtl').classList.toggle('hidden', !n.isHost);
    this.$('clientTrackInfo').classList.toggle('hidden', n.isHost);
    const lobbyTrack = TRACKS[n.trackId];
    this.$('clientTrackName').textContent = `${lobbyTrack.name} · ${lobbyTrack.open ? '1-Way Sprint' : `${n.laps} Laps`}`;
    this.$('lobbyNote').textContent = n.isHost
      ? !n.relayUp
        ? 'Relay unavailable — strict NAT networks may not connect'
        : !n.directUp
        ? 'Direct links unavailable — players will connect via relay'
        : ''
      : n.viaRelay
      ? 'Connected via relay'
      : '';
    this.$('lobbyWait').textContent = n.isHost
      ? n.players.length < 2
        ? 'Share code with friends or start now against AI bots'
        : `${n.players.length} drivers ready`
      : n.racing
      ? 'Race in progress — joining next race'
      : 'Waiting for host to launch race…';
  }

  private hostGame(): void {
    this.audio.init();
    this.status('Creating room…');
    const raceLaps = TRACKS[this.selectedTrack].open ? 1 : this.laps;
    this.net.host(this.getProfile(), this.selectedTrack, raceLaps).then(
      () => this.showLobby(),
      e => this.status(e.message)
    );
  }

  private joinGame(): void {
    const code = (this.$('codeInput') as HTMLInputElement).value.trim().toUpperCase();
    if (code.length !== 5) {
      this.status('Enter the 5-character room code');
      return;
    }
    this.audio.init();
    this.status('Joining ' + code + '…');
    this.net.join(code, this.getProfile(), m => this.status(m)).then(
      () => this.showLobby(),
      e => this.status(e.message)
    );
  }

  private hostStart(): void {
    const n = this.net;
    if (!n.isHost || this.state === 'race') return;
    const humans = n.players.slice();
    for (let i = humans.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [humans[i], humans[j]] = [humans[j], humans[i]];
    }
    const grid = this.makeBots(this.botCount, humans.map(p => p.color));
    for (const p of humans) {
      grid.push({
        id: p.id,
        name: p.name,
        color: p.color,
        underglow: p.underglow,
        type: p.type,
        ai: false,
        skill: 1,
      });
    }
    const cfg: RaceStartConfig = {
      trackId: this.selectedTrack,
      laps: TRACKS[this.selectedTrack].open ? 1 : this.laps,
      difficulty: this.difficulty,
      grid,
    };
    n.racing = true;
    n.latest = {};
    n.broadcast({ t: 'start', ...cfg });
    this.beginRace(cfg, n.myId);
  }

  private backToLobby(): void {
    const n = this.net;
    if (!n.isHost) return;
    n.racing = false;
    n.broadcast({ t: 'tolobby' });
    n.broadcastLobby();
    this.showLobby();
  }

  private leave(): void {
    if (this.net.active) this.net.leave();
    this.showMenu();
  }

  private onLobby(): void {
    if (this.state !== 'race') this.showLobby();
  }

  private onNetClosed(reason: string): void {
    this.net.leave();
    this.showMenu(reason);
  }

  private onLeft(id: string): void {
    const car = this.carById.get(id);
    if (!car || this.state !== 'race') return;
    car.dispose();
    this.carById.delete(id);
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    this.race.sorted = this.race.sorted.filter(c => c !== car);
    this.hud.toast(`${car.name} left the race`, 2.2);
  }

  private applyStates(list: (string | number)[][], lead: number): void {
    if (this.state !== 'race') return;
    for (const a of list) {
      if (!Array.isArray(a)) continue;
      const car = this.carById.get(String(a[0]));
      if (car && car.remote) car.applyNet(a, lead);
    }
  }

  private makeBots(count: number, usedColors: string[]) {
    const free = PAINT_COLORS.map(c => c.hex).filter(c => !usedColors.includes(c));
    const bots = [];
    for (let k = 0; k < count; k++) {
      const carId = CAR_IDS[(Math.random() * CAR_IDS.length) | 0];
      const spec = CAR_SPECS[carId];
      bots.push({
        id: 'bot' + k,
        name: BOT_NAMES[k % BOT_NAMES.length],
        ai: true,
        skill: 1 - k * (0.065 / Math.max(1, count - 1)),
        color: free.length ? free[k % free.length] : spec.defaultColor,
        underglow: spec.defaultUnderglow,
        type: carId,
      });
    }
    return bots;
  }

  private startSingle(): void {
    if (this.net.active) return;
    const p = this.getProfile();
    const grid = this.makeBots(5, [p.color]);
    grid.push({ id: 'me', ...p, ai: false, skill: 1 });
    this.beginRace(
      {
        trackId: this.selectedTrack,
        laps: TRACKS[this.selectedTrack].open ? 1 : this.laps,
        difficulty: this.difficulty,
        grid,
      },
      'me'
    );
  }

  private beginRace(cfg: RaceStartConfig, myId: string): void {
    this.audio.init();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (this.track.theme.id !== cfg.trackId) this.switchTrack(cfg.trackId);

    this.clearCars();
    this.scenery.setShowroomPosition(null);

    const t = this.track;
    const D = DIFFS[cfg.difficulty] || DIFFS.normal;
    const mp = this.mp;
    const ownsBots = !mp || this.net.isHost;

    cfg.grid.forEach((e, k) => {
      const isMe = e.id === myId;
      const car = new Car(this.scene, e.type, e.color, e.underglow, isMe);
      const S = car.spec;
      car.id = e.id;
      car.name = e.name;
      car.isAI = !!e.ai;
      car.remote = !(isMe || (e.ai && ownsBots));
      if (e.ai) {
        car.topSpeed = S.top * D.top * (0.94 + 0.06 * e.skill);
        car.grip = S.grip * D.grip;
      }
      const gridIdx = t.open
        ? t.startIdx - Math.round((9 + k * 7) / t.ds)
        : t.N - Math.round((10 + k * 7) / t.ds);
      this.place(car, gridIdx, k % 2 ? -3.0 : 3.0);
      if (!isMe) car.setTag(e.name);
      else this.player = car;

      this.cars.push(car);
      this.carById.set(car.id, car);

      if (e.ai && ownsBots) {
        this.ais.push(
          new AIController(car, t, {
            cornerA: D.cornerA * e.skill * e.skill * (S.grip / 29),
            bias: (Math.random() - 0.5) * 2.5,
            lineUse: 0.75 + Math.random() * 0.25,
            wander: 0.3 + Math.random() * 0.5,
            delay: 0.05 + Math.random() * 0.35,
            nosChance: D.nosChance,
            onStuck: c => this.resetCar(c),
          })
        );
      }
    });

    if (!this.player) {
      this.leave();
      return;
    }
    if (!mp) for (const ai of this.ais) ai.player = this.player;

    this.race.reset(this.cars, this.player, cfg.laps);
    this.state = 'race';
    this.paused = false;
    this.acc = 0;
    this.finishShown = false;
    this.netTick = 0;

    this.camCtl.snap(this.player);
    this.hud.kmh = 0;
    this.hud.boardKey = null;
    this.hud.clearCountdown();
    this.overlay(null);
    this.$('hudTopActions').classList.remove('hidden');
    this.$('pauseBtn').classList.remove('hidden');
    this.hud.show(true);
    this.refreshTouchUI();

    const help = this.$('help');
    help.style.opacity = '0.88';
    clearTimeout(this.helpTimer);
    this.helpTimer = setTimeout(() => {
      help.style.opacity = '0';
    }, 10000);
  }

  private setPaused(p: boolean): void {
    if (this.state !== 'race' || this.finishShown) return;
    this.paused = p;
    this.$('pauseTitle').textContent = this.mp ? 'ONLINE RACE MENU' : 'PAUSED';
    const restartBtn = this.$('pauseRestartBtn');
    restartBtn.classList.toggle('hidden', this.mp);
    this.$('pauseQuitBtn').textContent = this.mp ? 'LEAVE ROOM' : 'QUIT TO GARAGE';

    if (p) {
      if (!this.pauseDialog.open) this.pauseDialog.showModal();
    } else if (this.pauseDialog.open) {
      this.pauseDialog.close();
    }
  }

  private resetCar(car: Car): void {
    const cp = this.race.lastCheckpoint(car);
    this.place(car, cp.idx, cp.lat);
    if (car === this.player) this.camCtl.snap(car);
  }

  private action(a: PlayerAction): void {
    this.audio.init();
    if (a === 'mute') {
      const m = this.audio.toggleMute();
      if (this.state === 'race') this.hud.toast(m ? 'Sound Muted' : 'Sound Active');
      return;
    }
    if (a === 'confirm') {
      if (this.state === 'menu' && this.screen === 'menu' && !this.settingsDialog.open) this.startSingle();
      else if (this.finishShown && !this.mp) this.startSingle();
      return;
    }
    if (this.state !== 'race') return;
    if (a === 'pause') {
      if (this.settingsDialog.open) this.settingsDialog.close();
      else this.setPaused(!this.paused);
    } else if (this.paused) return;
    else if (a === 'camera') this.hud.toast(this.camCtl.next());
    else if (a === 'reset' && this.race.phase === 'racing' && this.player && !this.player.race?.finished) {
      this.resetCar(this.player);
      this.hud.toast('Reset to checkpoint');
    }
  }

  private onPlayerFinish(): void {
    if (!this.player) return;
    this.autoPilot = new AIController(this.player, this.track, {
      cornerA: 22,
      pace: 0.65,
      wander: 0.2,
      onStuck: c => this.resetCar(c),
    });
    this.paused = false;
    if (this.pauseDialog.open) this.pauseDialog.close();
    this.finishShown = true;
    this.resultsT = 0;

    const mp = this.mp;
    const host = this.net.isHost;
    this.$('againBtn').textContent = mp ? 'BACK TO LOBBY' : 'RACE AGAIN';
    this.$('againBtn').classList.toggle('hidden', mp && !host);
    this.$('finQuitBtn').textContent = mp ? 'LEAVE ROOM' : 'GARAGE MENU';
    this.$('finNote').textContent = mp && !host ? 'Waiting for the host to return to the lobby…' : '';
    this.updateResults();

    setTimeout(() => {
      if (this.finishShown && this.state === 'race') {
        this.overlay('finish');
        this.$('hudTopActions').classList.add('hidden');
        this.$('pauseBtn').classList.add('hidden');
        this.refreshTouchUI();
      }
    }, 900);
  }

  private updateResults(): void {
    const p = this.player;
    if (!p || !p.race) return;
    const r = p.race;
    this.$('finPos').innerHTML = `${r.place}<sup>${ordinal(r.place)}</sup>`;
    this.$('finOf').textContent = `of ${this.cars.length}${r.place === 1 ? ' — WINNER!' : ''}`;
    this.$('finTime').textContent = fmtTime(r.finishTime);
    this.$('finBest').textContent = fmtTime(r.best);
    this.$('finDrift').textContent = `${Math.round(p.totalDriftScore).toLocaleString()} pts`;
    this.$('finBlasts').textContent = String(p.takedowns);
    this.$('finRecord').classList.toggle('hidden', !this.race.newRecord);

    const box = this.$('results');
    box.textContent = '';
    this.race.sorted.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'prow' + (c === p ? ' me' : '');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(i + 1);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = c.colorHex;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = `${c.name} · ${c.spec.shortName}`;
      const tm = document.createElement('span');
      tm.className = 'meta';
      tm.textContent = c.race?.finished ? fmtTime(c.race.finishTime) : 'racing…';
      row.append(n, dot, nm, tm);
      box.appendChild(row);
    });
  }

  private respawnBlastedCar(victim: Car): void {
    const t = this.track;
    const N = t.N;
    // Wrong-way self-destruct (no attacker): respawn at current track spot facing forward
    if (victim === this.player && !victim.lastAttackerId) {
      this.place(victim, victim.idx, 0);
      const rollSpd = clamp(24, 18, victim.topSpeed * 0.6);
      victim.speed = rollSpd;
      victim.vx = Math.sin(victim.h) * rollSpd;
      victim.vz = Math.cos(victim.h) * rollSpd;
      victim.respawnProtect = 2.2;
      if (victim.race) victim.race.wrongT = 0;
      this.camCtl.snap(victim);
      this.hud.toast('Respawned facing track!', 1.8);
      return;
    }

    let anchor: Car | null = victim.lastAttackerId ? this.carById.get(victim.lastAttackerId) || null : null;
    if (!anchor || anchor === victim || anchor.blasted) {
      anchor =
        this.player && this.player !== victim && !this.player.blasted
          ? this.player
          : this.cars.find(c => c !== victim && !c.blasted) || victim;
    }

    const stepsBack = Math.round((26 + Math.random() * 6) / t.ds);
    const respawnIdx = t.open
      ? clamp(anchor.idx - stepsBack, Math.max(2, t.startIdx - 12), t.finishIdx - 8)
      : (((anchor.idx - stepsBack) % N) + N) % N;
    const laneLim = Math.max(1.8, t.roadHalf - 2.0);
    const sideSign = Math.abs(anchor.lat) < 1.5 ? (Math.random() < 0.5 ? -1 : 1) : -Math.sign(anchor.lat);
    const laneLat = clamp(sideSign * (2.2 + Math.random() * 1.1), -laneLim, laneLim);

    this.place(victim, respawnIdx, laneLat);
    const rollSpd = clamp(Math.max(24, anchor.speed * 0.86), 18, victim.topSpeed * 0.88);
    victim.speed = rollSpd;
    victim.vx = Math.sin(victim.h) * rollSpd;
    victim.vz = Math.cos(victim.h) * rollSpd;
    victim.respawnProtect = 2.2;
    victim.lastAttackerId = null;

    if (anchor !== victim) {
      this.race.syncRespawnBehind(victim, anchor, respawnIdx, stepsBack);
    }
    if (victim === this.player) {
      this.camCtl.snap(victim);
      this.hud.toast('Respawned behind — Chase them down!', 1.8);
    }
  }

  private handleBlast(victim: Car, shooter: Car | null, mode: boolean | string = false): void {
    const player = this.player!;
    const isTorpedo = mode === 'torpedo';
    const isRocket = mode === true || mode === 'rocket';
    const isWrongWay = mode === 'wrongway';
    const dist = Math.hypot(victim.x - player.x, victim.z - player.z);
    this.audio.playExplosion(clamp(1 - dist / (isTorpedo ? 220 : isRocket ? 180 : 140), 0.28, 1.0));
    if (dist < (isTorpedo ? 120 : isRocket ? 90 : 65)) {
      const mult = isTorpedo ? 1.25 : isRocket ? 1.0 : 0.72;
      this.camCtl.shake = Math.min(1.0, Math.max(this.camCtl.shake, mult * (1 - dist / (isTorpedo ? 130 : isRocket ? 100 : 75))));
    }
    if (isWrongWay) {
      this.hud.toast('AUTO-EXPLODED — Wrong way for 5s!', 2.2);
    } else if (shooter === player) {
      const nosBonus = isTorpedo ? 50 : isRocket ? 35 : 25;
      player.nos = Math.min(100, player.nos + nosBonus);
      const tag = isTorpedo ? '★ TWIN ROOF TORPEDOES OBLITERATED' : isRocket ? '★ ROCKET OBLITERATED' : '★ BLASTED';
      this.hud.toast(`${tag} ${victim.name}! +${nosBonus}% NOS`, 2.6);
    } else if (victim === player) {
      const killer = shooter ? shooter.name : 'enemy fire';
      const msg = isTorpedo
        ? `OBLITERATED by ${killer}'s twin torpedoes! Respawning...`
        : isRocket
        ? `OBLITERATED by ${killer}'s rocket! Respawning...`
        : `BLASTED by ${killer}! Respawning...`;
      this.hud.toast(msg, 2.2);
    }
  }

  private step(dt: number): void {
    const race = this.race;
    const player = this.player!;
    if (player.race?.finished && this.autoPilot) {
      this.autoPilot.update(dt, this.cars, race.time);
    } else {
      this.input.apply(player);
    }

    for (const ai of this.ais) {
      if (ai.car.race?.finished) ai.pace = 0.65;
      ai.update(dt, this.cars, race.time);
    }

    for (const c of this.cars) {
      if (c.remote) c.stepRemote(dt, this.track);
      else c.step(dt, this.track, this.cars);
      if (c.blasted && c.blastTimer <= 0 && !c.remote) {
        this.respawnBlastedCar(c);
      }
    }

    if (player.bovTrigger) this.audio.playBovFlutter();
    if (player.nosActive && !player.wasBoosted) this.audio.playNosIgnite();
    player.wasBoosted = player.nosActive;

    let aimTarget: THREE.Vector3 | null = null;
    if (!player.blasted && !player.race?.finished) {
      const ndcX = this.isTouch ? 0 : this.input.mouse.ndcX;
      const ndcY = this.isTouch ? 0.14 : this.input.mouse.ndcY;
      this.lockedTarget = this.weapons.resolvePlayerAim(player, this.camera, ndcX, ndcY, this.cars, this.playerAimTarget);
      aimTarget = this.playerAimTarget;
      if (this.lockedTarget && !this.prevLockedTarget && player.type === 'interceptor') {
        this.audio.playLockTone();
      }
    } else {
      this.lockedTarget = null;
    }
    this.prevLockedTarget = this.lockedTarget;

    const combatEv = {
      onFire: (car: Car) => {
        const d = Math.hypot(car.x - player.x, car.z - player.z);
        if (car === player || d < 75) {
          this.audio.playGunshot(car === player);
        }
        if (car === player) {
          this.camCtl.shake = Math.max(this.camCtl.shake, 0.045);
        }
      },
      onFireRocket: (car: Car) => {
        const d = Math.hypot(car.x - player.x, car.z - player.z);
        if (car === player || d < 95) {
          this.audio.playRocketLaunch(car === player);
        }
        if (car === player) {
          this.camCtl.shake = Math.max(this.camCtl.shake, 0.22);
        }
      },
      onFireTorpedo: (car: Car) => {
        const d = Math.hypot(car.x - player.x, car.z - player.z);
        if (car === player || d < 120) {
          this.audio.playTorpedoLaunch(car === player);
        }
        if (car === player) {
          this.camCtl.shake = Math.max(this.camCtl.shake, 0.36);
        }
      },
      onHit: (_victim: Car, shooter: Car | null) => {
        if (shooter === player) {
          this.hud.flashHit();
          this.audio.playHitMarker();
        }
      },
      onBlast: (victim: Car, shooter: Car | null, mode?: boolean | string) =>
        this.handleBlast(victim, shooter, mode || false),
    };

    this.weapons.update(dt, this.cars, race.phase === 'racing', aimTarget, this.lockedTarget, this.particles, combatEv);

    this.collideCars();
    race.update(dt, {
      countdown: n => {
        this.hud.countdown(n ? String(n) : 'GO!', !n);
        this.audio.beep(n ? 440 : 880, n ? 0.2 : 0.6);
      },
      lap: (car, lt) => {
        if (car === this.player) {
          this.hud.toast(
            `${car.race?.finished ? 'Finish  ' : 'Lap  '}${fmtTime(lt)}${lt === this.race.record ? '  ★ RECORD' : ''}`,
            2.6
          );
          this.audio.beep(660, 0.12, 0.14);
        }
      },
      finish: car => {
        if (car === this.player) this.onPlayerFinish();
      },
      wrongWayBlast: car => {
        this.weapons.blastCar(car, null, this.particles, {
          ...combatEv,
          onBlast: victim => this.handleBlast(victim, null, 'wrongway'),
        });
      },
    });

    this.effects(dt);
    if (this.mp && ++this.netTick % 3 === 0) {
      this.net.sendStates(this.cars, this.netTick / 3);
    }
  }

  private collideCars(): void {
    const cars = this.cars;
    const R = 1.02;
    const D = R * 2;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        if (a.blasted || b.blasted) continue;
        if (a.remote && b.remote) continue;
        if (Math.abs(a.x - b.x) > 6.5 || Math.abs(a.z - b.z) > 6.5) continue;

        const ash = Math.sin(a.h) * 1.1;
        const ach = Math.cos(a.h) * 1.1;
        const bsh = Math.sin(b.h) * 1.1;
        const bch = Math.cos(b.h) * 1.1;
        let best = 0;
        let nx = 0;
        let nz = 0;

        for (const sa of [1, -1]) {
          for (const sb of [1, -1]) {
            const dx = b.x + bsh * sb - (a.x + ash * sa);
            const dz = b.z + bch * sb - (a.z + ach * sa);
            const d = Math.hypot(dx, dz);
            if (d < D && d > 1e-4 && D - d > best) {
              best = D - d;
              nx = dx / d;
              nz = dz / d;
            }
          }
        }
        if (best <= 0) continue;

        const pa = a.remote ? 0 : b.remote ? best * 0.75 : best / 2;
        const pb = b.remote ? 0 : a.remote ? best * 0.75 : best / 2;
        a.x -= nx * pa;
        a.z -= nz * pa;
        b.x += nx * pb;
        b.z += nz * pb;

        const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rv < 0) {
          const totalM = a.spec.mass + b.spec.mass;
          const jn = (-1.32 * rv) / totalM;
          if (!a.remote) {
            a.vx -= jn * b.spec.mass * nx;
            a.vz -= jn * b.spec.mass * nz;
            a.hit = Math.max(a.hit, -rv * 0.7);
          }
          if (!b.remote) {
            b.vx += jn * a.spec.mass * nx;
            b.vz += jn * a.spec.mass * nz;
            b.hit = Math.max(b.hit, -rv * 0.7);
          }
        }
      }
    }
  }

  private effects(dt: number): void {
    const P = this.particles;
    this.thudCd -= dt;
    const smokeChance = this.quality === 'ultra' ? 1.0 : this.quality === 'high' ? 0.75 : 0.45;

    for (const car of this.cars) {
      if (car.blasted) continue;
      const sh = Math.sin(car.h);
      const ch = Math.cos(car.h);
      const spd = Math.hypot(car.vx, car.vz);
      const S = car.spec;
      const sliding = car.drifting || (car.input.drift && spd > 8) || (car.input.brake > 0.8 && car.speed > 32 && car.isPlayer);

      const w = this._w;
      for (let k = 0; k < 2; k++) {
        const s = k ? -S.track : S.track;
        w[k].x = car.x + ch * s + sh * S.axleRear;
        w[k].z = car.z - sh * s + ch * S.axleRear;
        w[k].y = car.y + 0.03;
      }

      const surf = car.surface;
      const emitSmoke = (cr: number, cg: number, cb: number, vyMin: number, vySpread: number, lifeBase: number, sizeBase: number, growth = 2.6, op = 0.46) => {
        for (let k = 0; k < 2; k++) {
          if (Math.random() < (car.isPlayer ? smokeChance : 0.44 * smokeChance)) {
            P.spawn(
              w[k].x,
              w[k].y + 0.16,
              w[k].z,
              car.vx * 0.24 + (Math.random() - 0.5) * 3.0,
              vyMin + Math.random() * vySpread,
              car.vz * 0.24 + (Math.random() - 0.5) * 3.0,
              lifeBase + Math.random() * 0.4,
              sizeBase + Math.random() * 0.7,
              cr,
              cg,
              cb,
              growth,
              op
            );
          }
        }
      };

      // River water crossing splashes from all four wheels!
      if (surf === 'water' && spd > 4.5) {
        car.skidLast[0] = car.skidLast[1] = null;
        emitSmoke(0.76, 0.93, 1.0, 2.4, 3.0, 0.45, 0.9, 3.4, 0.58);
        if (Math.random() < 0.7 * smokeChance) {
          for (const sSide of [-S.track, S.track]) {
            const fx = car.x + ch * sSide + sh * S.axleFront;
            const fz = car.z - sh * sSide + ch * S.axleFront;
            P.spawn(
              fx,
              car.y + 0.20,
              fz,
              car.vx * 0.3 + ch * Math.sign(sSide) * 2.5 + (Math.random() - 0.5) * 2.0,
              2.6 + Math.random() * 2.6,
              car.vz * 0.3 - sh * Math.sign(sSide) * 2.5 + (Math.random() - 0.5) * 2.0,
              0.42 + Math.random() * 0.3,
              0.85 + Math.random() * 0.6,
              0.84,
              0.96,
              1.0,
              3.2,
              0.62
            );
          }
        }
      } else if (sliding && !car.onGrass) {
        for (let k = 0; k < 2; k++) {
          if (surf === 'asphalt') {
            const last = car.skidLast[k];
            if (!last) {
              car.skidLast[k] = new THREE.Vector3(w[k].x, w[k].y, w[k].z);
            } else if (Math.hypot(w[k].x - last.x, w[k].z - last.z) > 0.65) {
              this.skids.add(last, w[k], 0.17);
              last.set(w[k].x, w[k].y, w[k].z);
            }
          }
        }
        if (surf === 'mud') {
          emitSmoke(0.32, 0.21, 0.12, 1.6, 2.2, 0.55, 0.95, 2.4, 0.55);
        } else if (surf === 'sand') {
          emitSmoke(0.84, 0.69, 0.45, 1.3, 1.8, 0.78, 1.3, 3.0, 0.44);
        } else {
          const g = 0.84 + Math.random() * 0.14;
          emitSmoke(g, g, g, 1.1, 1.5, 0.75, 1.2, 2.8, 0.44);
        }
      } else {
        car.skidLast[0] = car.skidLast[1] = null;
        if (surf === 'mud' && spd > 9 && Math.random() < 0.75 * smokeChance) {
          emitSmoke(0.35, 0.24, 0.14, 1.5, 2.0, 0.48, 0.8, 2.2, 0.50);
        } else if (surf === 'sand' && spd > 13 && Math.random() < 0.70 * smokeChance) {
          emitSmoke(0.82, 0.67, 0.44, 1.1, 1.5, 0.68, 1.15, 2.8, 0.36);
        } else if (car.onGrass && spd > 8 && Math.random() < 0.55 * smokeChance) {
          const k = Math.random() < 0.5 ? 0 : 1;
          P.spawn(
            w[k].x,
            w[k].y + 0.15,
            w[k].z,
            car.vx * 0.3 + (Math.random() - 0.5) * 3,
            1.5 + Math.random() * 2,
            car.vz * 0.3 + (Math.random() - 0.5) * 3,
            0.5 + Math.random() * 0.4,
            0.85 + Math.random() * 0.6,
            0.46,
            0.36,
            0.22,
            2.2,
            0.45
          );
        }
      }

      // Cyan plasma exhaust particles during NOS
      if (car.nosActive && Math.random() < 0.85 * smokeChance) {
        const ex = car.x - sh * (S.length * 0.5 + 0.2);
        const ez = car.z - ch * (S.length * 0.5 + 0.2);
        P.spawn(
          ex + (Math.random() - 0.5) * 0.6,
          car.y + 0.3,
          ez + (Math.random() - 0.5) * 0.6,
          -sh * 12 + (Math.random() - 0.5) * 2,
          0.3 + Math.random() * 0.8,
          -ch * 12 + (Math.random() - 0.5) * 2,
          0.25 + Math.random() * 0.15,
          0.45 + Math.random() * 0.3,
          0.1,
          0.85,
          1.0,
          1.4,
          0.72
        );
      }

      // Sparks on wall/car impact
      if (car.hit > 0) {
        if (car.hit > 3) {
          for (let s = 0; s < 8; s++) {
            P.spawn(
              car.x + (Math.random() - 0.5) * 1.4,
              car.y + 0.45,
              car.z + (Math.random() - 0.5) * 1.4,
              car.vx * 0.4 + (Math.random() - 0.5) * 14,
              2 + Math.random() * 5,
              car.vz * 0.4 + (Math.random() - 0.5) * 14,
              0.35 + Math.random() * 0.25,
              0.32,
              1.0,
              0.68,
              0.15,
              0.1,
              0.95
            );
          }
        }
        if (car === this.player && car.hit > 2.5 && this.thudCd <= 0) {
          this.audio.thud(car.hit);
          this.camCtl.shake = Math.min(1, 0.25 + car.hit / 16);
          this.thudCd = 0.22;
        }
        car.hit = 0;
      }
    }
  }

  private updateGear(car: Car): void {
    const tops = [0.22, 0.38, 0.56, 0.77, 0.98, 1.35];
    const ratio = Math.abs(car.speed) / car.topSpeed;
    let g = 0;
    while (g < 5 && ratio > tops[g]) g++;
    const lo = g ? tops[g - 1] : 0;
    const f = clamp((ratio - lo) / (tops[g] - lo), 0, 1);
    this.gear = g + 1;
    this.rpm = g ? 0.42 + 0.58 * f : 0.15 + 0.85 * f;
  }

  private frame(now: number): void {
    requestAnimationFrame(this.frame);
    const dtReal = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += dtReal;
    this.input.pollPad();

    const running = this.state === 'race' && ((!this.paused && !this.settingsDialog.open) || this.mp);
    if (running) {
      this.acc += dtReal;
      let n = 0;
      while (this.acc >= DT && n < 5 && this.state === 'race') {
        this.step(DT);
        this.acc -= DT;
        n++;
      }
      if (n === 5) this.acc = 0;
    }

    const vdt = this.state === 'race' && !running ? 0 : dtReal;
    let focus = new THREE.Vector3();

    if (this.state === 'race' && this.player) {
      const alpha = this.acc / DT;
      const p = this.player;
      for (const c of this.cars) c.updateVisual(alpha, vdt, this.elapsed);
      if (running) {
        this.particles.update(dtReal);
        this.skids.flush();
        this.camCtl.update(p, dtReal);
        this.updateGear(p);
        this.hud.update(p, this.cars, this.race, this.gear, this.rpm, dtReal);
        this.hud.updateCrosshair(
          this.input.mouse.x,
          this.input.mouse.y,
          !!this.lockedTarget,
          !!(p.input.fire && !p.blasted && this.race.phase === 'racing'),
          !this.isTouch && !this.finishShown && !p.blasted,
          dtReal,
          p.type === 'interceptor'
        );
        if (this.finishShown && (this.resultsT -= dtReal) <= 0) {
          this.resultsT = 0.5;
          this.updateResults();
        }
      }
      focus = p.mesh.position;
      const spd = Math.hypot(p.vx, p.vz);
      this.audio.update({
        active: running,
        rpm: this.race.phase === 'countdown' ? 0.15 + p.input.throttle * 0.55 : this.rpm,
        throttle: p.input.throttle,
        screech: p.onGrass || spd < 5 ? 0 : clamp((p.slip - 3) / 8, 0, 1),
        speed: clamp(spd / p.spec.top, 0, 1.3),
        nos: p.nosActive,
        engineType: p.spec.engineType,
      });
    } else if (this.showcase) {
      const s = this.showcase;
      s.updateVisual(1, dtReal, this.elapsed);
      this.camCtl.updateShowroom(s, dtReal);
      focus = s.mesh.position;
      this.audio.update({
        active: false,
        rpm: 0,
        throttle: 0,
        screech: 0,
        speed: 0,
        nos: false,
        engineType: s.spec.engineType,
      });
    }

    this.scenery.update(vdt, this.elapsed);
    this.scenery.follow(focus, this.camera.position);

    if (this.quality === 'medium') {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }
  }
}
