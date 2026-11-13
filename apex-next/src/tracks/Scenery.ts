import * as THREE from 'three';
import { clamp, mulberry32, smooth } from '../core/config';
import { canvasTex, makeShowroomFloorTexture, makeWaterNormalMap } from '../core/textures';
import type { Track } from './Track';

export class Scenery {
  readonly scene: THREE.Scene;
  readonly track: Track;
  readonly group = new THREE.Group();

  private sky!: THREE.Mesh;
  private sun!: THREE.DirectionalLight;
  private sunDir = new THREE.Vector3();
  private clouds: THREE.InstancedMesh | null = null;
  private water: THREE.Mesh | null = null;
  private waterNormalTex: THREE.CanvasTexture | null = null;
  private showroomPad: THREE.Group | null = null;
  private cx = 0;
  private cz = 0;
  private mapSize = 2100;
  private standSpots: [number, number][] = [];
  private envRT: THREE.WebGLRenderTarget | null = null;
  private disposables: { dispose: () => void }[] = [];

  constructor(scene: THREE.Scene, track: Track, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.track = track;
    const th = track.theme;
    scene.fog = new THREE.Fog(th.fogColor, th.fogNear, th.fogFar);
    scene.add(this.group);

    this.buildSky();
    this.buildEnvironment(renderer);
    this.buildLights();
    this.buildTerrain();
    this.buildStands();
    this.buildFoliageOrRocks();
    if (th.night) this.buildStars();
    else this.buildClouds();
    if (th.sceneryStyle === 'harbor' || th.sceneryStyle === 'offroad' || th.sceneryStyle === 'expressway') {
      this.buildWater();
    }
    this.buildShowroomPad();
  }

  private buildSky(): void {
    const th = this.track.theme;
    const geo = new THREE.SphereGeometry(2000, 28, 16);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const hz = new THREE.Color(th.skyHorizon);
    const zen = new THREE.Color(th.skyZenith);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const t = Math.pow(clamp(pos.getY(i) / 2000, 0, 1), 0.55);
      c.copy(hz).lerp(zen, t);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;

    this.sunDir.set(th.sunDir[0], th.sunDir[1], th.sunDir[2]).normalize();
    const discGeo = new THREE.SphereGeometry(th.night ? 38 : 65, 16, 12);
    const discMat = new THREE.MeshBasicMaterial({ color: th.sunDiscColor, fog: false });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.copy(this.sunDir).multiplyScalar(1800);
    this.sky.add(disc);
    this.group.add(this.sky);
    this.disposables.push(geo, mat, discGeo, discMat);
  }

  // Synthesizes a procedural equirectangular reflection panorama for realistic clearcoat paint & glass
  private buildEnvironment(renderer: THREE.WebGLRenderer): void {
    const th = this.track.theme;
    const envTex = canvasTex(
      512,
      256,
      (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h);
        const zen = new THREE.Color(th.skyZenith).getStyle();
        const hor = new THREE.Color(th.skyHorizon).getStyle();
        const gnd = th.night ? '#0a0f1a' : '#262b2d';
        g.addColorStop(0, zen);
        g.addColorStop(0.45, hor);
        g.addColorStop(0.51, th.night ? '#162844' : '#6e6a60');
        g.addColorStop(0.58, gnd);
        g.addColorStop(1, th.night ? '#060910' : '#1b1d20');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);

        // Soft cloud bands across sky hemisphere for organic reflections
        c.fillStyle = th.night ? 'rgba(65, 110, 185, 0.16)' : 'rgba(255, 250, 240, 0.36)';
        for (let i = 0; i < 18; i++) {
          c.beginPath();
          c.ellipse(
            ((i * 73) % w),
            h * (0.20 + ((i * 31) % 24) * 0.01),
            24 + (i % 4) * 14,
            5 + (i % 3) * 3,
            0,
            0,
            Math.PI * 2
          );
          c.fill();
        }

        // Solar / moon specular burst
        const sx = w * 0.32;
        const sy = h * 0.25;
        const sg = c.createRadialGradient(sx, sy, 2, sx, sy, 52);
        sg.addColorStop(0, th.night ? 'rgba(215, 235, 255, 0.95)' : 'rgba(255, 252, 235, 1.0)');
        sg.addColorStop(0.35, th.night ? 'rgba(110, 175, 255, 0.35)' : 'rgba(255, 235, 190, 0.55)');
        sg.addColorStop(1, 'rgba(255, 255, 255, 0)');
        c.fillStyle = sg;
        c.beginPath();
        c.arc(sx, sy, 52, 0, Math.PI * 2);
        c.fill();

        if (th.night) {
          c.fillStyle = 'rgba(0, 229, 255, 0.72)';
          c.fillRect(40, h * 0.43, 85, 4);
          c.fillStyle = 'rgba(255, 42, 133, 0.65)';
          c.fillRect(280, h * 0.44, 70, 4);
        }
      },
      false
    );
    envTex.mapping = THREE.EquirectangularReflectionMapping;

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    this.envRT = pmrem.fromEquirectangular(envTex);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = th.night ? 1.15 : 1.35;
    envTex.dispose();
    pmrem.dispose();
  }

  private buildLights(): void {
    const th = this.track.theme;
    const hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiIntensity);
    const sun = (this.sun = new THREE.DirectionalLight(th.sunColor, th.sunIntensity));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -75;
    sc.right = 75;
    sc.top = 75;
    sc.bottom = -75;
    sc.near = 10;
    sc.far = 450;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.group.add(hemi, sun, sun.target);
  }

  follow(p: THREE.Vector3, camPos: THREE.Vector3): void {
    this.sun.position.copy(p).addScaledVector(this.sunDir, 195);
    this.sun.target.position.copy(p);
    this.sky.position.copy(camPos);
  }

  private buildTerrain(): void {
    const t = this.track;
    const cx = (this.cx = (t.minX + t.maxX) / 2);
    const cz = (this.cz = (t.minZ + t.maxZ) / 2);
    const span = Math.max(t.maxX - t.minX, t.maxZ - t.minZ);
    const size = (this.mapSize = Math.max(2100, Math.round(span + 1300)));
    const segs = size > 2600 ? 280 : 220;

    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const style = t.theme.sceneryStyle;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const h = t.terrainHeight(x, z);
      pos.setXYZ(i, x, h, z);
      const n = 0.5 + 0.5 * Math.sin(x * 0.02 + z * 0.013) * Math.cos(z * 0.017 - x * 0.006);
      const hi = clamp(h / Math.max(20, t.theme.terrainHillHeight), 0, 1);

      if (style === 'alpine') {
        // Green valley -> rocky slopes -> snowy peaks
        if (hi > 0.72) {
          col[i * 3] = 1.15;
          col[i * 3 + 1] = 1.18;
          col[i * 3 + 2] = 1.24;
        } else if (hi > 0.45) {
          col[i * 3] = 0.72 + 0.1 * n;
          col[i * 3 + 1] = 0.74 + 0.1 * n;
          col[i * 3 + 2] = 0.78 + 0.1 * n;
        } else {
          col[i * 3] = 0.85 + 0.15 * n;
          col[i * 3 + 1] = 0.94 + 0.12 * n;
          col[i * 3 + 2] = 0.82 + 0.1 * n;
        }
      } else if (style === 'offroad') {
        // Muddy dark riverbanks -> moist loam -> golden sun-baked desert sand dunes
        if (h < 0.28) {
          col[i * 3] = 0.42 + 0.08 * n;
          col[i * 3 + 1] = 0.34 + 0.06 * n;
          col[i * 3 + 2] = 0.25 + 0.04 * n;
        } else if (h < 1.35) {
          const tMix = smooth(0.28, 1.35, h);
          col[i * 3] = 0.46 + tMix * (0.58 + 0.14 * n);
          col[i * 3 + 1] = 0.37 + tMix * (0.52 + 0.11 * n);
          col[i * 3 + 2] = 0.27 + tMix * (0.41 + 0.08 * n);
        } else {
          col[i * 3] = 1.02 + 0.16 * n + hi * 0.12;
          col[i * 3 + 1] = 0.88 + 0.12 * n - hi * 0.04;
          col[i * 3 + 2] = 0.68 + 0.08 * n - hi * 0.08;
        }
      } else if (style === 'expressway') {
        // Muthurajawela wetland silt banks -> lush tropical emerald palms & grass
        if (h < 0.22) {
          col[i * 3] = 0.45 + 0.08 * n;
          col[i * 3 + 1] = 0.52 + 0.08 * n;
          col[i * 3 + 2] = 0.34 + 0.05 * n;
        } else {
          const tMix = smooth(0.22, 1.8, h);
          col[i * 3] = 0.48 + tMix * (0.28 + 0.14 * n);
          col[i * 3 + 1] = 0.56 + tMix * (0.44 + 0.14 * n);
          col[i * 3 + 2] = 0.36 + tMix * (0.22 + 0.08 * n);
        }
      } else if (style === 'canyon') {
        col[i * 3] = 0.95 + 0.22 * n + hi * 0.2;
        col[i * 3 + 1] = 0.78 + 0.15 * n - hi * 0.08;
        col[i * 3 + 2] = 0.65 + 0.1 * n - hi * 0.12;
      } else if (style === 'deathrace') {
        // Scorched cratered wasteland: dark burnt basalt -> scorched red-brown iron oxide dirt
        col[i * 3] = 0.52 + 0.16 * n + hi * 0.14;
        col[i * 3 + 1] = 0.24 + 0.08 * n;
        col[i * 3 + 2] = 0.15 + 0.05 * n - hi * 0.04;
      } else if (style === 'city') {
        col[i * 3] = 0.72 + 0.15 * n;
        col[i * 3 + 1] = 0.75 + 0.15 * n;
        col[i * 3 + 2] = 0.92 + 0.15 * n;
      } else {
        col[i * 3] = 0.86 + 0.16 * n;
        col[i * 3 + 1] = 0.9 + 0.14 * n;
        col[i * 3 + 2] = 0.82 + 0.1 * n;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();

    const tex = t.grassTex.clone();
    tex.needsUpdate = true;
    const rep = Math.round((this.mapSize / 2100) * 220);
    tex.repeat.set(rep, rep);
    const mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, tex, mat);
  }

  private buildStands(): void {
    const t = this.track;
    const N = t.N;
    const crowd = canvasTex(
      512,
      16,
      (c, w) => {
        c.fillStyle = '#484f59';
        c.fillRect(0, 0, w, 16);
        const cols = ['#e53935', '#1e88e5', '#fdd835', '#fafafa', '#43a047', '#fb8c00', '#00e5ff', '#ec6fa8'];
        for (let x = 2; x < w; x += 6) {
          if (Math.random() < 0.12) continue;
          c.fillStyle = cols[(Math.random() * cols.length) | 0];
          c.fillRect(x, 6, 4, 10);
          c.fillStyle = '#e8b796';
          c.fillRect(x + 1, 2, 2, 4);
        }
      },
      false
    );

    const grey = new THREE.MeshStandardMaterial({ color: 0x67707c, roughness: 0.75 });
    const crowdMat = new THREE.MeshLambertMaterial({ map: crowd });
    const roofMat = new THREE.MeshStandardMaterial({
      color: this.track.theme.accentHex,
      roughness: 0.4,
      metalness: 0.3,
    });
    const baseGeo = new THREE.BoxGeometry(14, 1.6, 60);
    const tierGeo = new THREE.BoxGeometry(2.2, 1.2, 60);
    const roofGeo = new THREE.BoxGeometry(15, 0.45, 62);
    const postGeo = new THREE.BoxGeometry(0.4, 10.5, 0.4);
    const mats = [crowdMat, grey, grey, grey, grey, grey];
    this.disposables.push(crowd, grey, crowdMat, roofMat, baseGeo, tierGeo, roofGeo, postGeo);

    this.standSpots = [];
    const standIdxs = t.open
      ? [clamp(t.startIdx + Math.round(20 / t.ds), 6, N - 10), clamp(t.finishIdx - Math.round(30 / t.ds), 6, N - 10)]
      : [N - Math.round(56 / t.ds), Math.round(62 / t.ds)];
    for (const idx of standIdxs) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(baseGeo, grey);
      base.position.set(-6, 0, 0);
      g.add(base);
      for (let k = 0; k < 6; k++) {
        const tier = new THREE.Mesh(tierGeo, mats);
        tier.position.set(-k * 2.2, 1.4 + k * 1.2, 0);
        tier.castShadow = true;
        tier.receiveShadow = true;
        g.add(tier);
      }
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.set(-6, 11, 0);
      roof.castShadow = true;
      g.add(roof);
      for (const pz of [-29, 0, 29]) {
        const post = new THREE.Mesh(postGeo, grey);
        post.position.set(-12.6, 5.6, pz);
        g.add(post);
      }
      const off = -(t.barrierOff + 7.5);
      const x = t.px[idx] + t.lx[idx] * off;
      const z = t.pz[idx] + t.lz[idx] * off;
      g.position.set(x, t.py[idx] - 0.8, z);
      g.rotation.y = t.head[idx];
      this.group.add(g);
      this.standSpots.push([x - t.lx[idx] * 6, z - t.lz[idx] * 6]);
    }
  }

  private buildFoliageOrRocks(): void {
    const t = this.track;
    const style = t.theme.sceneryStyle;
    const rnd = mulberry32(202611);
    const spots: [number, number, number, number, number, number][] = [];
    const tmp = { d: 0, y: 0, i: 0 };

    const tryAdd = (x: number, z: number) => {
      if (t.nearestInfo(x, z, tmp).d < t.barrierOff + 5.5) return;
      for (const s of this.standSpots) if (Math.hypot(x - s[0], z - s[1]) < 44) return;
      if (style === 'expressway' && Math.hypot(x - 40, z + 1320) < 175) return;
      const h = t.terrainHeight(x, z);
      if ((style === 'offroad' || style === 'expressway') && h < 0.35) return;
      spots.push([x, h - 0.3, z, 0.78 + rnd() * 1.0, rnd() * 6.28, rnd()]);
    };

    const roadTreeProb = style === 'city' ? 0.35 : style === 'offroad' ? 0.25 : style === 'deathrace' ? 0.20 : 0.72;
    for (let i = 0; i < t.N; i += 6) {
      for (const s of [-1, 1]) {
        if (rnd() < roadTreeProb) {
          const off = s * (t.barrierOff + 7 + rnd() * 26);
          tryAdd(t.px[i] + t.lx[i] * off, t.pz[i] + t.lz[i] * off);
        }
      }
    }
    const scatterCount = style === 'city' ? 180 : style === 'offroad' ? 160 : style === 'expressway' ? 560 : style === 'deathrace' ? 140 : 420;
    const scatterSpan = this.mapSize * 0.72;
    for (let k = 0; k < scatterCount; k++) {
      tryAdd(this.cx + (rnd() - 0.5) * scatterSpan, this.cz + (rnd() - 0.5) * scatterSpan);
    }

    if (!spots.length) return;

    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.36, 2.9, 7);
    trunkGeo.translate(0, 1.45, 0);
    const c1 = new THREE.IcosahedronGeometry(2.15, 1);
    c1.scale(1.12, 0.86, 1.04);
    c1.translate(0, 4.05, 0);
    const c2 = new THREE.IcosahedronGeometry(1.55, 1);
    c2.scale(1.06, 0.95, 1.0);
    c2.translate(0.75, 5.45, 0.35);
    const c3 = new THREE.IcosahedronGeometry(1.38, 1);
    c3.scale(1.0, 0.92, 1.08);
    c3.translate(-0.72, 4.95, -0.45);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3624, roughness: 0.94, metalness: 0.02 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.02 });
    this.disposables.push(trunkGeo, c1, c2, c3, trunkMat, leafMat);

    const meshes = [
      new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length),
      new THREE.InstancedMesh(c1, leafMat, spots.length),
      new THREE.InstancedMesh(c2, leafMat, spots.length),
      new THREE.InstancedMesh(c3, leafMat, spots.length),
    ];

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();

    spots.forEach((sp, i) => {
      p.set(sp[0], sp[1], sp[2]);
      q.setFromAxisAngle(Y, sp[4]);
      s.set(sp[3], sp[3] * (0.9 + sp[5] * 0.3), sp[3]);
      m.compose(p, q, s);
      if (style === 'offroad') {
        if (sp[1] < 2.0) col.setHSL(0.28 + sp[5] * 0.05, 0.44, 0.24 + sp[5] * 0.08);
        else col.setHSL(0.21 + sp[5] * 0.05, 0.28, 0.26 + sp[5] * 0.08);
      } else if (style === 'expressway') col.setHSL(0.29 + sp[5] * 0.06, 0.52, 0.21 + sp[5] * 0.09);
      else if (style === 'deathrace') col.setHSL(0.06 + sp[5] * 0.04, 0.45, 0.12 + sp[5] * 0.06);
      else if (style === 'canyon') col.setHSL(0.22 + sp[5] * 0.06, 0.32, 0.22 + sp[5] * 0.08);
      else if (style === 'city') col.setHSL(0.32 + sp[5] * 0.06, 0.28, 0.14 + sp[5] * 0.06);
      else col.setHSL(0.29 + sp[5] * 0.07, 0.36, 0.20 + sp[5] * 0.09);

      meshes.forEach((im, k) => {
        im.setMatrixAt(i, m);
        if (k) im.setColorAt(i, col);
      });
    });

    meshes.forEach(im => {
      im.castShadow = true;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.group.add(im);
    });

    // Canyon, offroad & deathrace desert sandstone / basalt rocks
    if (style === 'canyon' || style === 'offroad' || style === 'deathrace') {
      const isOffroad = style === 'offroad';
      const isDeathRace = style === 'deathrace';
      const rockGeo = new THREE.DodecahedronGeometry(1, isOffroad ? 1 : 0);
      const rockMat = new THREE.MeshStandardMaterial({
        color: isDeathRace ? 0x241d1a : isOffroad ? 0xb5895a : 0xa85534,
        roughness: 0.94,
        metalness: isDeathRace ? 0.28 : 0.0,
      });
      this.disposables.push(rockGeo, rockMat);
      const rocks: [number, number, number, number][] = [];
      const count = isDeathRace ? 110 : isOffroad ? 85 : 55;
      for (let k = 0; k < count; k++) {
        const x = this.cx + (rnd() - 0.5) * 1400;
        const z = this.cz + (rnd() - 0.5) * 1400;
        if (t.nearestInfo(x, z, tmp).d < (isDeathRace ? t.barrierOff + 10 : isOffroad ? t.barrierOff + 8 : 42)) continue;
        const ry = t.terrainHeight(x, z);
        if (isOffroad && ry < 0.25) continue;
        rocks.push([x, ry, z, isDeathRace ? 3.5 + rnd() * 12 : isOffroad ? 2.8 + rnd() * 7.5 : 8 + rnd() * 18]);
      }
      if (rocks.length) {
        const rockIm = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
        rocks.forEach((rk, i) => {
          p.set(rk[0], rk[1] + rk[3] * (isOffroad ? 0.28 : 0.4), rk[2]);
          q.setFromAxisAngle(Y, rnd() * 6.28);
          s.set(rk[3], rk[3] * (0.65 + rnd() * (isOffroad ? 0.55 : 1.1)), rk[3] * 0.85);
          m.compose(p, q, s);
          rockIm.setMatrixAt(i, m);
        });
        rockIm.instanceMatrix.needsUpdate = true;
        rockIm.castShadow = true;
        rockIm.receiveShadow = true;
        this.group.add(rockIm);
      }
    }

    // Desert Saguaro cacti clusters on dry offroad dunes
    if (style === 'offroad') {
      const cactusSpots: [number, number, number, number, number][] = [];
      for (let k = 0; k < 140; k++) {
        const x = this.cx + (rnd() - 0.5) * 1250;
        const z = this.cz + (rnd() - 0.5) * 1250;
        if (t.nearestInfo(x, z, tmp).d < t.barrierOff + 5.5) continue;
        const cy = t.terrainHeight(x, z);
        if (cy < 1.0) continue;
        cactusSpots.push([x, cy - 0.1, z, 0.8 + rnd() * 0.85, rnd() * 6.28]);
      }
      if (cactusSpots.length) {
        const stemGeo = new THREE.CylinderGeometry(0.24, 0.28, 3.6, 8);
        stemGeo.translate(0, 1.8, 0);
        const armL = new THREE.CylinderGeometry(0.16, 0.18, 1.35, 7);
        armL.translate(0.55, 2.35, 0);
        const armR = new THREE.CylinderGeometry(0.15, 0.17, 1.15, 7);
        armR.translate(-0.52, 2.75, 0);
        const cactusMat = new THREE.MeshStandardMaterial({ color: 0x3b6e3c, roughness: 0.86, metalness: 0.02 });
        this.disposables.push(stemGeo, armL, armR, cactusMat);

        const cMeshes = [
          new THREE.InstancedMesh(stemGeo, cactusMat, cactusSpots.length),
          new THREE.InstancedMesh(armL, cactusMat, cactusSpots.length),
          new THREE.InstancedMesh(armR, cactusMat, cactusSpots.length),
        ];
        cactusSpots.forEach((cs, i) => {
          p.set(cs[0], cs[1], cs[2]);
          q.setFromAxisAngle(Y, cs[4]);
          s.set(cs[3], cs[3], cs[3]);
          m.compose(p, q, s);
          cMeshes.forEach(im => im.setMatrixAt(i, m));
        });
        cMeshes.forEach(im => {
          im.castShadow = true;
          im.instanceMatrix.needsUpdate = true;
          this.group.add(im);
        });
      }
    }

    // Tropical Sri Lankan coconut palms lining Kelani / Negombo Lagoon / E03 Expressway
    if (style === 'expressway') {
      const palmSpots: [number, number, number, number, number][] = [];
      for (let i = 0; i < t.N; i += 7) {
        for (const s of [-1, 1]) {
          if (rnd() < 0.62) {
            const off = s * (t.barrierOff + 5.5 + rnd() * 22);
            const x = t.px[i] + t.lx[i] * off;
            const z = t.pz[i] + t.lz[i] * off;
            if (Math.hypot(x - 40, z + 1320) < 175) continue;
            const py = t.terrainHeight(x, z);
            if (py < 0.25) continue;
            palmSpots.push([x, py - 0.15, z, 0.85 + rnd() * 0.55, rnd() * 6.28]);
          }
        }
      }
      if (palmSpots.length) {
        const trunkG = new THREE.CylinderGeometry(0.16, 0.34, 8.2, 6);
        trunkG.translate(0, 4.1, 0);
        const frondGeo = new THREE.ConeGeometry(2.6, 2.2, 6);
        frondGeo.scale(1.25, 0.55, 1.25);
        frondGeo.translate(0, 8.2, 0);
        const pTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6b5239, roughness: 0.92 });
        const pLeafMat = new THREE.MeshStandardMaterial({ color: 0x2f8a36, roughness: 0.84 });
        this.disposables.push(trunkG, frondGeo, pTrunkMat, pLeafMat);

        const trunks = new THREE.InstancedMesh(trunkG, pTrunkMat, palmSpots.length);
        const crowns = new THREE.InstancedMesh(frondGeo, pLeafMat, palmSpots.length);
        palmSpots.forEach((ps, i) => {
          p.set(ps[0], ps[1], ps[2]);
          q.setFromAxisAngle(Y, ps[4]);
          s.set(ps[3], ps[3], ps[3]);
          m.compose(p, q, s);
          trunks.setMatrixAt(i, m);
          crowns.setMatrixAt(i, m);
        });
        trunks.castShadow = true;
        crowns.castShadow = true;
        trunks.instanceMatrix.needsUpdate = true;
        crowns.instanceMatrix.needsUpdate = true;
        this.group.add(trunks, crowns);
      }
    }
  }

  private buildClouds(): void {
    const rnd = mulberry32(77);
    const CL = 18;
    const PUFFS = 6;
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: this.track.theme.sceneryStyle === 'canyon' ? 0xffdfb8 : 0xffffff,
      fog: false,
      transparent: true,
      opacity: 0.88,
    });
    this.disposables.push(geo, mat);

    const im = (this.clouds = new THREE.InstancedMesh(geo, mat, CL * PUFFS));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    let n = 0;

    for (let c = 0; c < CL; c++) {
      const a = rnd() * 6.28;
      const r = 300 + rnd() * 900;
      const x = this.cx + Math.cos(a) * r;
      const z = this.cz + Math.sin(a) * r;
      const y = 260 + rnd() * 140;
      for (let k = 0; k < PUFFS; k++) {
        p.set(x + (rnd() - 0.5) * 110, y + (rnd() - 0.5) * 14, z + (rnd() - 0.5) * 60);
        s.set(34 + rnd() * 30, 13 + rnd() * 9, 24 + rnd() * 20);
        m.compose(p, q, s);
        im.setMatrixAt(n++, m);
      }
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    this.group.add(im);
  }

  private buildStars(): void {
    const rnd = mulberry32(909);
    const count = 800;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = rnd() * Math.PI * 0.46;
      const r = 1750;
      pos[i * 3] = Math.cos(theta) * Math.cos(phi) * r;
      pos[i * 3 + 1] = Math.sin(phi) * r;
      pos[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xe6f2ff, size: 3.5, sizeAttenuation: false, fog: false });
    const stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false;
    this.sky.add(stars);
    this.disposables.push(geo, mat);
  }

  private buildWater(): void {
    const style = this.track.theme.sceneryStyle;
    const isRiver = style === 'offroad';
    const isLagoon = style === 'expressway';
    const wSize = Math.max(2400, this.mapSize + 300);
    const geo = new THREE.PlaneGeometry(wSize, wSize);
    geo.rotateX(-Math.PI / 2);
    const norm = (this.waterNormalTex = makeWaterNormalMap());
    const rep = Math.round((wSize / 2400) * (isRiver ? 64 : 42));
    norm.repeat.set(rep, rep);
    const mat = new THREE.MeshStandardMaterial({
      color: isRiver ? 0x167d75 : isLagoon ? 0x0b6b68 : 0x065480,
      normalMap: norm,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: isRiver ? 0.14 : isLagoon ? 0.12 : 0.08,
      metalness: isRiver ? 0.65 : isLagoon ? 0.74 : 0.84,
      envMapIntensity: 1.45,
      transparent: isRiver,
      opacity: isRiver ? 0.85 : 1,
      depthWrite: !isRiver,
    });
    const water = (this.water = new THREE.Mesh(geo, mat));
    water.position.set(this.cx, isRiver ? 0.08 : isLagoon ? -0.05 : -0.45, this.cz);
    this.group.add(water);
    this.disposables.push(geo, mat, norm);
  }

  private buildShowroomPad(): void {
    const padGroup = (this.showroomPad = new THREE.Group());
    padGroup.rotation.order = 'YXZ';
    const floorTex = makeShowroomFloorTexture();
    floorTex.repeat.set(4, 4);
    const ringGeo = new THREE.RingGeometry(2.8, 3.25, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.track.theme.accentHex),
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const discGeo = new THREE.CircleGeometry(3.2, 48);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      map: floorTex,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    padGroup.add(new THREE.Mesh(ringGeo, ringMat), new THREE.Mesh(discGeo, discMat));
    this.group.add(padGroup);
    this.disposables.push(floorTex, ringGeo, ringMat, discGeo, discMat);
  }

  setShowroomPosition(pos: THREE.Vector3 | null, heading = 0, pitch = 0): void {
    if (!this.showroomPad) return;
    if (!pos) {
      this.showroomPad.visible = false;
      return;
    }
    this.showroomPad.visible = true;
    this.showroomPad.position.set(pos.x, pos.y + 0.025, pos.z);
    this.showroomPad.rotation.set(pitch, heading, 0);
  }

  update(dt: number, elapsed: number): void {
    if (this.clouds) this.clouds.position.x += dt * 1.4;
    if (this.water) {
      const style = this.track.theme.sceneryStyle;
      const isRiver = style === 'offroad';
      const isLagoon = style === 'expressway';
      this.water.position.y =
        (isRiver ? 0.08 : isLagoon ? -0.05 : -0.45) + Math.sin(elapsed * 1.5) * (isRiver ? 0.02 : 0.06);
    }
    if (this.waterNormalTex) {
      this.waterNormalTex.offset.x = (elapsed * 0.018) % 1;
      this.waterNormalTex.offset.y = (elapsed * 0.011) % 1;
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    if (this.scene.environment === this.envRT?.texture) this.scene.environment = null;
    this.envRT?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

